import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/** 받는 대상 · 칸 — DB 함수 fn_i18n_source(D115)와 같은 목록입니다 */
export const I18N_FIELDS: Record<string, string[]> = {
  NOTICE: ['title', 'body'], FAQ: ['question', 'answer'], TERM: ['title', 'body'],
  LISTING: ['title', 'body'], REQUEST: ['title', 'body'], POST: ['title', 'body'], COMMENT: ['body'],
};
const STATUSES = ['DRAFT', 'APPROVED', 'AUTO_APPROVED', 'MACHINE', 'REJECTED'];

/**
 * 다국어 1단계 기반 (v10.93 · D115 · docs/148 · docs/150).
 *
 * 지금은 운영자가 번역을 직접 넣고(엔진 MANUAL) 승인하는 데까지입니다 — 손님 화면은 바뀌지 않습니다(i18n.enabled off).
 * 원문은 건드리지 않습니다. 번역 줄은 원문 해시를 갖고 있어, 원문이 고쳐지면 낡음이 되고 승인할 수 없습니다.
 */
@Injectable()
export class I18nService {
  constructor(private readonly db: DatabaseService) {}
  private get me() { return RequestCtx.actorId(); }

  private async setting(key: string): Promise<string | null> {
    const [r] = await this.db.query<{ value: string }>(`SELECT value FROM site_settings WHERE key = $1`, [key]);
    return r?.value ?? null;
  }

  /** 손님 화면 — 다국어 켜짐 여부 · 켜진 언어(꺼져 있으면 한국어만) · v10.95 */
  async langs() {
    const enabled = (await this.setting('i18n.enabled')) === 'on';
    const items = await this.db.query<{ code: string; name: string; rtl: boolean }>(
      `SELECT code, native AS name, rtl FROM i18n_langs WHERE is_active ORDER BY sort_order, code`);
    return { enabled, items: enabled ? items : items.filter((x) => x.code === 'ko') };
  }

  /** 회원이 고른 언어 — 켜진 언어만 · v10.95 */
  async setMyLang(lang: string) {
    if (!this.me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
    const [l] = await this.db.query<{ code: string }>(`SELECT code FROM i18n_langs WHERE code = $1 AND is_active`, [lang]);
    if (!l) throw new PolicyViolation('LANG_NOT_ACTIVE', '지금은 고를 수 없는 언어입니다.');
    await this.db.query(`UPDATE accounts SET preferred_lang = $2 WHERE id = $1`, [this.me, lang]);
    return { ok: true, lang };
  }

  /* ── 운영 화면 ─────────────────────────────────────────────── */

  async adminLangs() {
    const items = await this.db.query(
      `SELECT l.code, l.name, l.native, l.rtl, l.is_active AS "isActive", l.sort_order AS "sortOrder",
              (SELECT count(*)::int FROM content_translations t WHERE t.lang = l.code) AS translations
         FROM i18n_langs l ORDER BY l.sort_order, l.code`);
    return { enabled: (await this.setting('i18n.enabled')) === 'on', engine: await this.setting('i18n.engine'), items };
  }

  async setLangActive(code: string, isActive: boolean) {
    if (code === 'ko' && !isActive) throw new StateConflict('LANG_KO_FIXED', '한국어(원문)는 끌 수 없습니다.');
    const [r] = await this.db.query<{ code: string }>(
      `UPDATE i18n_langs SET is_active = $2 WHERE code = $1 RETURNING code`, [code, isActive]);
    if (!r) throw new NotFound('없는 언어입니다.');
    return { ok: true, code, isActive };
  }

  async list(q: { lang?: string; status?: string; targetType?: string; stale?: boolean; page?: number; size?: number }) {
    const size = Math.min(Math.max(q.size ?? 20, 1), 100), page = Math.max(q.page ?? 1, 1);
    const w: string[] = [], p: unknown[] = [];
    if (q.lang) { p.push(q.lang); w.push(`lang = $${p.length}`); }
    if (q.status) { p.push(q.status); w.push(`status = $${p.length}`); }
    if (q.targetType) { p.push(q.targetType); w.push(`target_type = $${p.length}`); }
    if (q.stale !== undefined) { p.push(q.stale); w.push(`is_stale = $${p.length}`); }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    const [{ total }] = await this.db.query<{ total: number }>(`SELECT count(*)::int AS total FROM v_translation_state ${where}`, p);
    const items = await this.db.query(
      `SELECT id::text, target_type AS "targetType", target_id AS "targetId", field, lang, text, status, engine,
              left(source_text, 300) AS "sourceText", source_missing AS "sourceMissing", is_stale AS "isStale",
              translated_at AS "translatedAt", approved_at AS "approvedAt", reject_reason AS "rejectReason"
         FROM v_translation_state ${where}
        ORDER BY translated_at DESC, id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, p);
    return { items, total, page, size, pages: Math.max(1, Math.ceil(total / size)) };
  }

  /** 원문 미리 보기 — 번역 넣기 전에 */
  async source(targetType: string, targetId: string, field: string) {
    this.assertField(targetType, field);
    const [s] = await this.db.query<{ src: string | null; gwan: string | null }>(
      `SELECT src, gwan FROM fn_i18n_source($1, $2, $3)`, [targetType, targetId, field]);
    if (!s || s.src == null) throw new NotFound('원문이 없습니다.');
    return { targetType, targetId, field, sourceText: s.src, gwanCode: s.gwan };
  }

  /** 번역 넣기 · 고치기(엔진 MANUAL) — 넣으면 다시 「승인 대기」 */
  async upsert(dto: { targetType: string; targetId: string; field: string; lang: string; text: string }) {
    this.assertField(dto.targetType, dto.field);
    if (dto.lang === 'ko') throw new PolicyViolation('LANG_KO_SOURCE', '한국어는 원문입니다 — 번역할 언어를 고르십시오.');
    const [l] = await this.db.query(`SELECT 1 FROM i18n_langs WHERE code = $1`, [dto.lang]);
    if (!l) throw new PolicyViolation('LANG_UNKNOWN', '없는 언어입니다.');
    const [s] = await this.db.query<{ src: string | null }>(`SELECT src FROM fn_i18n_source($1, $2, $3)`, [dto.targetType, dto.targetId, dto.field]);
    if (!s || s.src == null) throw new NotFound('원문이 없습니다.');
    const [r] = await this.db.query<{ id: string }>(
      `INSERT INTO content_translations (target_type, target_id, field, lang, text, source_hash, status, engine, translated_by)
       VALUES ($1, $2, $3, $4, $5, md5($6), 'DRAFT', 'MANUAL', $7)
       ON CONFLICT (target_type, target_id, field, lang) DO UPDATE
         SET text = EXCLUDED.text, source_hash = EXCLUDED.source_hash, status = 'DRAFT', engine = 'MANUAL',
             translated_by = EXCLUDED.translated_by, translated_at = now(), approved_by = NULL, approved_at = NULL, reject_reason = NULL
       RETURNING id::text`,
      [dto.targetType, dto.targetId, dto.field, dto.lang, dto.text.trim(), s.src, this.me ?? null]);
    return { ok: true, id: r.id, status: 'DRAFT' };
  }

  /** 승인 — 낡은 줄 · 원문이 없는 줄 · 번역문에 차단 금칙어가 든 줄은 안 됨 */
  async approve(id: string) {
    const [t] = await this.db.query<any>(`SELECT * FROM v_translation_state WHERE id = $1::bigint`, [id]);
    if (!t) throw new NotFound('없는 번역입니다.');
    if (t.source_missing) throw new StateConflict('SOURCE_MISSING', '원문이 없어졌습니다 — 승인할 수 없습니다.');
    if (t.is_stale) throw new StateConflict('TRANSLATION_STALE', '원문이 고쳐졌습니다 — 번역을 다시 넣은 뒤 승인하십시오.');
    if (t.status === 'APPROVED') throw new StateConflict('ALREADY_APPROVED', '이미 승인한 번역입니다.');
    const blocked = await this.db.query<{ word: string }>(
      `SELECT word FROM fn_check_banned_words($1, $2) WHERE severity = 'BLOCK'`, [t.text, t.gwan_code]);
    if (blocked.length) {
      throw new PolicyViolation('BANNED_WORD', `번역문에 금칙어가 있습니다: ${blocked.map((b) => b.word).join(', ')}`, { words: blocked.map((b) => b.word) });
    }
    await this.db.query(
      `UPDATE content_translations SET status = 'APPROVED', approved_by = $2, approved_at = now(), reject_reason = NULL WHERE id = $1::bigint`,
      [id, this.me ?? null]);
    return { ok: true, id, status: 'APPROVED' };
  }

  async reject(id: string, reason: string) {
    const [r] = await this.db.query<{ id: string }>(
      `UPDATE content_translations SET status = 'REJECTED', reject_reason = $2, approved_by = $3, approved_at = now()
        WHERE id = $1::bigint RETURNING id::text`, [id, reason.trim(), this.me ?? null]);
    if (!r) throw new NotFound('없는 번역입니다.');
    return { ok: true, id, status: 'REJECTED', reason: reason.trim() };
  }

  private assertField(targetType: string, field: string) {
    if (!I18N_FIELDS[targetType]?.includes(field)) {
      throw new PolicyViolation('I18N_FIELD', `번역할 수 없는 칸입니다 (${targetType}.${field}).`);
    }
  }

  static readonly STATUSES = STATUSES;
}
