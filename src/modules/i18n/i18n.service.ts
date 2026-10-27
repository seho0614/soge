import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/** 받는 대상 · 칸 — DB 함수 fn_i18n_source(D115)와 같은 목록입니다 */
export const I18N_FIELDS: Record<string, string[]> = {
  NOTICE: ['title', 'body'], FAQ: ['question', 'answer'], TERM: ['title', 'body'],
  LISTING: ['title', 'body'], REQUEST: ['title', 'body'], POST: ['title', 'body'], COMMENT: ['body'],
  CATEGORY: ['name'], HLT_PRODUCT: ['name', 'summary'],   // v10.103 · D117
  PROFILE_Q: ['question'], PROFILE_OPT: ['label'], AD_SEGMENT: ['name', 'description'],   // v10.118 · D124 관심 성향
  FOOTER_LINK: ['label'], SETTING: ['value'], POLL: ['title', 'description'], POLL_OPT: ['label', 'sub'],   // v10.119 · D125
  INGREDIENT: ['name'], HLT_CONCERN: ['name'],
  NOTIFY_EVENT: ['name', 'legal_basis'], REPORT_REASON: ['label'], PLAN: ['name', 'features'],   // v10.123 · D126 DB 기준표 문구
  INTRO_GRADE: ['name', 'criteria', 'benefit', 'next_hint'], GWAN_FORM: ['subject', 'title_hint', 'body_hint', 'notice'],
  UI_MESSAGE: ['message'], AD_PLACEMENT: ['title', 'body', 'cta'],
};
/** SETTING 대상으로 번역하는 설정 키 — DB 함수 fn_i18n_source(D125)와 같음 */
export const I18N_SETTING_KEYS = ['legal.intermediary_notice', 'legal.direct_notice'];
/** 손님 화면에 나가는 상태 — 승인 · 자동 승인 · 기계 번역(게시판 글 · 댓글만 · 3-3) */
const LIVE = ['APPROVED', 'AUTO_APPROVED', 'MACHINE'];
const liveOf = (type: string) => (['POST', 'COMMENT'].includes(type) ? LIVE : ['APPROVED', 'AUTO_APPROVED']);   // 운영 글 · 약관은 사람 · 자동 승인만
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

  /* ── 손님 화면에 번역 얹기 (v10.103 · 3-1 · docs/161) ───────────── */

  private live: { at: number; enabled: boolean; langs: Set<string> } | null = null;
  /** 지금 요청의 화면 언어 — 다국어가 켜져 있고 그 언어가 켜져 있을 때만(아니면 null = 원문) · 설정은 30초 기억 */
  async activeLang(): Promise<string | null> {
    return this.langIfActive(RequestCtx.lang());
  }

  /** v10.125 — 그 언어가 지금 켜져 있으면 그대로, 아니면 null(오류 출구처럼 요청 문맥이 없을 수 있는 곳에서) */
  async langIfActive(lang: string | null | undefined): Promise<string | null> {
    if (!lang) return null;
    if (!this.live || Date.now() - this.live.at > 30_000) {
      const enabled = (await this.setting('i18n.enabled')) === 'on';
      const rows = await this.db.query<{ code: string }>(`SELECT code FROM i18n_langs WHERE is_active AND code <> 'ko'`);
      this.live = { at: Date.now(), enabled, langs: new Set(rows.map((r) => r.code)) };
    }
    return this.live.enabled && this.live.langs.has(lang) ? lang : null;
  }

  /**
   * 승인 · 낡지 않은 번역을 원문 대신 넣습니다. 원문이 고쳐진(낡은) 줄 · 승인 전 줄은 쓰지 않아 원문이 그대로 나갑니다.
   *   rows    API 가 내보낼 줄들(그 자리에서 고침 · 같은 배열을 돌려줌)
   *   type    대상(NOTICE · FAQ · TERM · CATEGORY · HLT_PRODUCT …)
   *   idOf    줄 → 대상 번호(공지 id · 약관 「코드@판」 · 분류 id · 상품 코드)
   *   fields  { 줄의 칸 이름: 번역 칸 }  예) { title: 'title', body: 'body' } · { categoryName: 'name' }
   *   mark    번역을 하나라도 넣은 줄에 true 로 둘 칸 이름(약관 「참고용 번역」 표시 등)
   * 한국어 · 다국어 꺼짐이면 아무것도 하지 않습니다(손님 화면은 전과 같음).
   */
  async overlay<T extends Record<string, any>>(rows: T[], type: string, idOf: (r: T) => string | null | undefined,
    fields: Record<string, string>, mark?: string): Promise<T[]> {
    if (!rows.length) return rows;
    const lang = await this.activeLang();
    if (!lang) return rows;
    const ids = [...new Set(rows.map(idOf).filter((x): x is string => !!x))];
    if (!ids.length) return rows;
    const tr = await this.db.query<{ target_id: string; field: string; text: string }>(
      `SELECT target_id, field, text FROM v_translation_state
        WHERE target_type = $1 AND lang = $2 AND target_id = ANY($3::text[]) AND field = ANY($4::text[])
          AND status = ANY($5::text[]) AND NOT is_stale AND NOT source_missing`,
      [type, lang, ids, [...new Set(Object.values(fields))], liveOf(type)]);
    if (!tr.length) return rows;
    const m = new Map(tr.map((x) => [`${x.target_id}\u0000${x.field}`, x.text]));
    const markOn = 'body' in fields ? 'body' : null;   // 본문이 있으면 본문이 얹혔을 때만 표시(제목만 번역된 약관에 「참고용 번역」이 붙지 않게)
    for (const r of rows) {
      const id = idOf(r);
      if (!id) continue;
      let hit = false;
      for (const [k, f] of Object.entries(fields)) {
        const t = m.get(`${id}\u0000${f}`);
        if (t != null && r[k] != null) { (r as any)[k] = t; if (!markOn || k === markOn) hit = true; }
      }
      if (hit && mark) (r as any)[mark] = true;
    }
    return rows;
  }

  /** v10.119 — 상품 줄의 대표 성분(mainIngredient · { code, name }) 이름에 성분 번역(INGREDIENT · D125)을 얹음 */
  async overlayMainIngredient(rows: Array<Record<string, any>>) {
    await this.overlay(rows.map((r) => r?.mainIngredient).filter((g): g is Record<string, any> => !!g?.code), 'INGREDIENT', (g) => g.code, { name: 'name' });
    return rows;
  }

  /** 한 줄짜리 — overlay 와 같음 */
  async overlayOne<T extends Record<string, any>>(row: T | null | undefined, type: string, idOf: (r: T) => string | null | undefined,
    fields: Record<string, string>, mark?: string): Promise<T | null | undefined> {
    if (!row) return row;
    await this.overlay([row], type, idOf, fields, mark);
    return row;
  }

  /**
   * 숨겨 실은 번호 칸(idKey · 예: _cid = 분류 id)으로 얹고 그 칸은 지웁니다 — 응답 모양은 전과 같음(v10.103 · 3-1).
   * 한국어 · 다국어 꺼짐이어도 칸은 지웁니다.
   */
  async overlayBy<T extends Record<string, any>>(rows: T[], type: string, idKey: string,
    fields: Record<string, string>, mark?: string): Promise<T[]> {
    try { await this.overlay(rows, type, (r) => (r[idKey] == null ? null : String(r[idKey])), fields, mark); }
    finally { for (const r of rows) delete (r as any)[idKey]; }
    return rows;
  }

  /**
   * v10.105 — 분류 번호 없이 업종 이름(글자)만 있는 줄(업체 대표 업종 · 성사 사례 스냅숏 등)에 분류 이름 번역을 얹음.
   *   같은 이름의 분류가 여럿이면 번역이 있는 것 하나를 씀. 한국어 · 다국어 꺼짐이면 아무것도 하지 않음.
   */
  async overlayCategoryNames<T extends Record<string, any>>(rows: T[], key: string): Promise<T[]> {
    if (!rows.length || !(await this.activeLang())) return rows;
    const names = [...new Set(rows.map((r) => r[key]).filter((x): x is string => typeof x === 'string' && !!x))];
    if (!names.length) return rows;
    const cats = await this.db.query<{ id: string; name: string }>(`SELECT id::text, name FROM categories WHERE name = ANY($1::text[])`, [names]);
    const byId = cats.map((c) => ({ name: c.name, id: c.id, name2: c.name }));
    await this.overlay(byId, 'CATEGORY', (c) => c.id, { name2: 'name' });
    const tr = new Map(byId.filter((c) => c.name2 !== c.name).map((c) => [c.name, c.name2]));
    for (const r of rows) { const t = tr.get(r[key]); if (t) (r as any)[key] = t; }
    return rows;
  }

  private catNames = new Map<string, { at: number; map: Map<string, string> }>();
  /**
   * v10.107 — 업종(분류) 이름 → 그 언어 번역 표(승인 · 자동 승인 · 낡지 않은 것만) · 언어마다 60초 기억.
   *   응답 출구(CategoryNameInterceptor)가 categoryName 같은 칸을 바꿀 때 씁니다. 같은 이름의 분류가 여럿이면 번역이 있는 것 하나.
   */
  async categoryNameMap(lang: string): Promise<Map<string, string>> {
    const c = this.catNames.get(lang);
    if (c && Date.now() - c.at < 60_000) return c.map;
    const rows = await this.db.query<{ name: string; text: string }>(
      `SELECT c.name, t.text FROM categories c
         JOIN v_translation_state t ON t.target_type = 'CATEGORY' AND t.target_id = c.id::text AND t.field = 'name' AND t.lang = $1
        WHERE t.status = ANY($2::text[]) AND NOT t.is_stale AND NOT t.source_missing`, [lang, liveOf('CATEGORY')]);
    const map = new Map(rows.filter((r) => r.text && r.text !== r.name).map((r) => [r.name, r.text]));
    this.catNames.set(lang, { at: Date.now(), map });
    return map;
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
    this.live = null;   // v10.103 — 끄고 켠 것을 손님 화면 번역에 바로(30초 기억을 비움)
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

  /**
   * 원문 목록 — 운영 글(공지 · 자주 묻는 질문 · 약관 · 분류 이름 · 소개몰 상품)을 고르고 그 언어 번역 상태를 함께 봄 (v10.103 · 3-1)
   *   칸마다 status(없으면 null) · 낡음 · 번역 번호 · 번역문 · 반려 사유. 등록 글 · 게시판은 3-2 · 3-3 에서 자동으로 줄이 생기므로 여기 없음.
   */
  async catalog(q: { targetType: string; lang: string; q?: string; page?: number; size?: number }) {
    const SRC: Record<string, { from: string; id: string; label: string; gwan: string; order: string }> = {
      NOTICE: { from: 'notices s', id: 's.id::text', label: 's.title', gwan: 's.gwan_code', order: 's.created_at DESC' },
      FAQ: { from: 'faqs s', id: 's.id::text', label: 's.question', gwan: 's.gwan_code', order: 's.sort_order, s.updated_at DESC' },
      TERM: { from: 'terms s', id: "s.code || '@' || s.version", label: 's.title', gwan: 's.gwan_code', order: 's.code, s.version DESC' },
      CATEGORY: { from: 'categories s', id: 's.id::text', label: 's.name', gwan: 's.gwan_code', order: 's.gwan_code, s.name' },
      HLT_PRODUCT: { from: 'hlt_products s', id: 's.code', label: 's.name', gwan: "'HLT'", order: 's.created_at DESC' },
      /* v10.118 (D124) — 관심 성향 문항 · 보기 · 세그먼트 */
      PROFILE_Q: { from: 'profile_questions s', id: 's.code', label: 's.question', gwan: 'NULL::text', order: 's.sort_order' },
      PROFILE_OPT: { from: 'profile_options s', id: "s.question_code || ':' || s.code", label: 's.label', gwan: 'NULL::text', order: 's.question_code, s.sort_order' },
      AD_SEGMENT: { from: 'ad_segments s', id: 's.code', label: 's.name', gwan: 'NULL::text', order: 's.sort_order' },
      /* v10.119 (D125) — 바닥줄 링크 · 법정 고지 · 투표 · 소개몰 성분 · 고민 */
      FOOTER_LINK: { from: 'footer_links s', id: 's.id::text', label: 's.label', gwan: 'NULL::text', order: 's.sort_order' },
      SETTING: { from: `(SELECT key, value FROM site_settings WHERE key IN ('${I18N_SETTING_KEYS.join("','")}')) s`, id: 's.key', label: 's.value', gwan: 'NULL::text', order: 's.key' },
      POLL: { from: 'polls s', id: 's.id::text', label: 's.title', gwan: 'NULL::text', order: 's.created_at DESC' },
      POLL_OPT: { from: 'poll_options s', id: 's.id::text', label: "(SELECT p.title FROM polls p WHERE p.id = s.poll_id) || ' › ' || s.label", gwan: 'NULL::text', order: 's.poll_id, s.sort' },
      INGREDIENT: { from: '(SELECT * FROM ingredients WHERE NOT is_excipient) s', id: 's.code', label: 's.name', gwan: "'HLT'", order: 's.sort, s.name' },
      HLT_CONCERN: { from: 'hlt_concerns s', id: 's.code', label: 's.name', gwan: "'HLT'", order: 's.sort, s.code' },
      /* v10.123 (D126) — 알림 종류 · 신고 사유 · 요금제 · 소개자 등급 · 업무 등록 안내 · 화면 고정 문구 · 광고 자리 소재 */
      NOTIFY_EVENT: { from: 'notification_event_policies s', id: 's.event_code', label: 's.name', gwan: 'NULL::text', order: 's.name' },
      REPORT_REASON: { from: 'report_reasons s', id: 's.code', label: 's.label', gwan: 's.gwan_code', order: 's.gwan_code NULLS FIRST, s.sort_order' },
      PLAN: { from: 'subscription_plans s', id: 's.code', label: 's.name', gwan: 'NULL::text', order: 's.monthly_price' },
      INTRO_GRADE: { from: 'introducer_grades s', id: 's.code', label: 's.name', gwan: 'NULL::text', order: 's.sort_order' },
      GWAN_FORM: { from: 'gwan_form_copy s', id: "s.gwan_code || ':' || s.role", label: "s.gwan_code || ' › ' || s.subject || ' (' || s.role || ')'", gwan: 's.gwan_code', order: 's.gwan_code, s.role DESC' },
      UI_MESSAGE: { from: 'ui_messages s', id: 's.code', label: 's.message', gwan: 'NULL::text', order: 's.code' },
      AD_PLACEMENT: { from: 'ad_placements s', id: 's.id::text', label: "coalesce(s.creative_code, s.slot_code) || ' › ' || coalesce(s.title, '')", gwan: 'NULL::text', order: 's.creative_code NULLS LAST, s.slot_code' },
    };
    const src = SRC[q.targetType];
    if (!src) throw new PolicyViolation('I18N_FIELD', `원문 목록이 없는 대상입니다 (${q.targetType}).`);
    if (!/^[a-z]{2}$/.test(q.lang) || q.lang === 'ko') throw new PolicyViolation('LANG_UNKNOWN', '번역할 언어를 고르십시오.');
    const size = Math.min(Math.max(q.size ?? 20, 1), 100), page = Math.max(q.page ?? 1, 1);
    const kw = q.q?.trim() ? `%${q.q.trim()}%` : null;
    const [{ total }] = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM ${src.from} ${kw ? `WHERE ${src.label} ILIKE $1` : ''}`, kw ? [kw] : []);
    const p: unknown[] = [q.targetType, q.lang, I18N_FIELDS[q.targetType]];
    if (kw) p.push(kw);
    const where = kw ? `WHERE ${src.label} ILIKE $4` : '';
    const items = await this.db.query(
      `SELECT ${src.id} AS "targetId", ${src.label} AS label, ${src.gwan} AS "gwanCode",
              (SELECT coalesce(json_agg(json_build_object('field', f, 'id', v.id::text, 'status', v.status, 'isStale', v.is_stale, 'text', v.text, 'rejectReason', v.reject_reason)
                                        ORDER BY array_position($3::text[], f)), '[]'::json)
                 FROM unnest($3::text[]) f
                 LEFT JOIN v_translation_state v ON v.target_type = $1 AND v.lang = $2 AND v.target_id = ${src.id} AND v.field = f) AS fields
         FROM ${src.from} ${where}
        ORDER BY ${src.order} LIMIT ${size} OFFSET ${(page - 1) * size}`, p);
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
