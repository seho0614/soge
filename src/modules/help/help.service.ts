import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation } from '../../core/errors';
import { maskMail } from '../../common/mail/mail-admin.service';

/** 설명서 한 절(### 제목 아래 글) — AI 상담 출처 · 사용자 웹 #m번호 */
export interface HelpSection { id: string; heading: string; text: string }

export const HELP_MANUAL = 'USER_MANUAL';
export const HELP_MAX_CHARS = 20000;

/**
 * v10.203 (D180 · docs/324) — 사용자 설명서(help_docs)
 *
 *   대표 11/6 「사용자 설명서는 AI 학습」 → 「설명서 본문을 AI 자료로 통째」.
 *   판을 쌓기만 합니다(고치면 새 판 · 옛 판은 남음 · DB 가 고치기 · 지우기를 막음).
 *   AI 상담은 FAQ · 공지 · 약관(4만 자)과 따로 이 본문(2만 자까지)을 읽고, 답의 출처로 절 번호(m1 · m2 …)를 붙입니다.
 */
@Injectable()
export class HelpService {
  constructor(private readonly db: DatabaseService) {}

  /** ### 제목마다 한 절 — 번호는 위에서부터 m1, m2 … (사용자 웹 #m번호 · AI 출처가 같은 번호를 씀) */
  static sections(body: string): HelpSection[] {
    const out: HelpSection[] = [];
    let cur: HelpSection | null = null;
    for (const line of body.split('\n')) {
      const h = /^###\s+(.+?)\s*$/.exec(line);
      if (h) { cur = { id: `m${out.length + 1}`, heading: h[1]!, text: '' }; out.push(cur); continue; }
      if (/^##\s/.test(line)) { cur = null; continue; }
      if (cur) cur.text += line + '\n';
    }
    for (const s of out) s.text = s.text.trim();
    return out;
  }

  async current(code = HELP_MANUAL) {
    const [r] = await this.db.query<{ version: number; title: string; body: string; chars: number; createdAt: string }>(
      `SELECT version, title, body, chars, created_at AS "createdAt" FROM v_help_doc_current WHERE code = $1`, [code]);
    return r ?? null;
  }

  /** 공개 — 사용자 웹 /guide/manual */
  async publicManual() {
    const r = await this.current();
    if (!r) throw new NotFound('사용자 설명서가 아직 없습니다.');
    return { title: r.title, version: r.version, updatedAt: r.createdAt, body: r.body,
             sections: HelpService.sections(r.body).map((s) => ({ id: s.id, heading: s.heading })) };
  }

  /** 운영 — 지금 판 + 판 목록(고친 사람은 앞 두 글자만) */
  async adminManual() {
    const r = await this.current();
    const versions = await this.db.query<{ version: number; chars: number; note: string | null; by: string | null; createdAt: string }>(
      `SELECT h.version, char_length(h.body) AS chars, h.note, a.email AS by, h.created_at AS "createdAt"
         FROM help_docs h LEFT JOIN accounts a ON a.id = h.created_by
        WHERE h.code = $1 ORDER BY h.version DESC LIMIT 50`, [HELP_MANUAL]);
    return {
      code: HELP_MANUAL, maxChars: HELP_MAX_CHARS,
      current: r ? { version: r.version, title: r.title, body: r.body, chars: r.chars, updatedAt: r.createdAt, sections: HelpService.sections(r.body).length } : null,
      versions: versions.map((v) => ({ ...v, by: maskMail(v.by) })),
    };
  }

  async version(v: number) {
    const [r] = await this.db.query<{ version: number; title: string; body: string; note: string | null; createdAt: string }>(
      `SELECT version, title, body, note, created_at AS "createdAt" FROM help_docs WHERE code = $1 AND version = $2`, [HELP_MANUAL, v]);
    if (!r) throw new NotFound('그 판이 없습니다.');
    return r;
  }

  /** 새 판 저장(SUPER — 컨트롤러가 막음) · 지금 판과 같으면 만들지 않음 */
  async save(body: string, note?: string) {
    const text = String(body ?? '').replace(/\r\n/g, '\n').trim() + '\n';
    if (text.length < 100) throw new PolicyViolation('HELP_TOO_SHORT', '설명서 본문이 너무 짧습니다(100자 이상).');
    if (text.length > HELP_MAX_CHARS) {
      throw new PolicyViolation('HELP_TOO_LONG', `설명서는 ${HELP_MAX_CHARS.toLocaleString('ko-KR')}자까지입니다(지금 ${text.length.toLocaleString('ko-KR')}자) — AI 상담이 읽는 양의 한도입니다.`);
    }
    if (!HelpService.sections(text).length) {
      throw new PolicyViolation('HELP_NO_SECTION', '「### 제목」으로 시작하는 절이 하나도 없습니다 — 절 제목이 AI 답의 출처와 화면 목차가 됩니다.');
    }
    return this.db.transaction(async () => {
      await this.db.query(`SELECT pg_advisory_xact_lock(hashtext('help_docs:' || $1))`, [HELP_MANUAL]);   // 두 사람이 같이 저장해도 판 번호가 겹치지 않게
      const [cur] = await this.db.query<{ version: number; body: string; title: string }>(
        `SELECT version, body, title FROM v_help_doc_current WHERE code = $1`, [HELP_MANUAL]);
      if (cur && cur.body === text) return { ok: true, version: cur.version, chars: text.length, note: '바뀐 내용이 없어 새 판을 만들지 않았습니다.' };
      const [r] = await this.db.query<{ version: number }>(
        `INSERT INTO help_docs (code, version, title, body, note, created_by)
         SELECT $1, coalesce(max(version), 0) + 1, $2, $3, nullif($4, ''), $5 FROM help_docs WHERE code = $1
         RETURNING version`,
        [HELP_MANUAL, cur?.title ?? '사용자 설명서', text, (note ?? '').trim().slice(0, 200), RequestCtx.actorId() ?? null]);
      return { ok: true, version: r!.version, chars: text.length,
               note: `사용자 설명서 ${r!.version}판으로 저장했습니다 — AI 상담은 10분 안에 새 판을 읽습니다.` };
    });
  }
}
