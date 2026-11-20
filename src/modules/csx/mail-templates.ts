import { Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { checkMailTemplate, MAIL_DEFAULTS, mailDef, renderMailTemplate } from './mail-render';
import { csxSettings } from './common';

/* ---------------------------------------------------------------------
 * v10.530 (D280 · docs/668) 메일 문구 템플릿 편집 — 운영 화면 › 회원 › 메일 문구(SB-ADM-CSX-030)
 *   표 csx_mail_template_defs(종류 · 자리값 · 꼭 넣을 것) · csx_mail_templates(지금 판 · 고친 것인지) · csx_mail_template_versions(판 기록 · 쌓기만)
 *   읽기 ADMIN · SUPER / 고치기 · 되돌리기 · 코드 기본값으로 SUPER(사유 2 ~ 200자 · 판 기록 · 감사)
 *   발송하는 곳은 csxMail(…, fallback) — 스위치(csx.mail_templates) 꺼짐 · 고친 판 없음 · 검사에 걸림 · DB 오류이면 코드 기본값 그대로(메일은 늘 나감)
 * ------------------------------------------------------------------- */

const log = new Logger('CsxMail');
export interface CsxMailDb { query<T = any>(sql: string, params?: unknown[]): Promise<T[]> }

/** 발송하는 곳에서 — 고친 판이 쓸 만하면 그것 · 아니면 fallback(코드 기본값) 그대로 */
export async function csxMail(db: CsxMailDb, code: string, vars: Record<string, unknown>, fallback: { subject: string; text: string }): Promise<{ subject: string; text: string }> {
  try {
    const [r] = await db.query<{ sw: string | null; subject: string | null; body: string | null }>(
      `SELECT (SELECT value FROM site_settings WHERE key = 'csx.mail_templates') AS sw, t.subject, t.body
         FROM csx_mail_templates t WHERE t.code = $1 AND t.is_custom`, [code]);
    if (!r || r.sw !== 'on' || !r.subject || !r.body) return fallback;
    if (checkMailTemplate(code, r.subject, r.body).length) { log.warn(`메일 문구 ${code} 검사에 걸려 코드 기본값으로 보냄`); return fallback; }
    return renderMailTemplate(r.subject, r.body, vars);
  } catch (e: any) {
    log.warn(`메일 문구 ${code} 읽기 실패 — 코드 기본값으로 보냄: ${String(e?.message ?? e).slice(0, 120)}`);
    return fallback;
  }
}

/** 알림 메일 틀(NOTIFY_MAIL) — 쓸 만한 고친 판이 있으면 {subject, body} · 아니면 null(코드 그대로) */
export async function csxNotifyTemplate(db: CsxMailDb): Promise<{ subject: string; body: string } | null> {
  try {
    const [r] = await db.query<{ sw: string | null; subject: string | null; body: string | null }>(
      `SELECT (SELECT value FROM site_settings WHERE key = 'csx.mail_templates') AS sw, t.subject, t.body
         FROM csx_mail_templates t WHERE t.code = 'NOTIFY_MAIL' AND t.is_custom`);
    if (!r || r.sw !== 'on' || !r.subject || !r.body || checkMailTemplate('NOTIFY_MAIL', r.subject, r.body).length) return null;
    return { subject: r.subject, body: r.body };
  } catch { return null; }
}

/* ── 운영 ── */
export async function mailTemplateList(db: DatabaseService) {
  const s = await csxSettings(db);
  const cur = await db.query<{ code: string; isCustom: boolean; version: number; subject: string | null; updatedAt: string | null; updatedBy: string | null }>(
    `SELECT t.code, t.is_custom AS "isCustom", t.version, t.subject, t.updated_at AS "updatedAt", a.email::text AS "updatedBy"
       FROM csx_mail_templates t LEFT JOIN accounts a ON a.id = t.updated_by`);
  return {
    on: s.mailTemplates,
    rows: MAIL_DEFAULTS.map((d) => {
      const c = cur.find((x) => x.code === d.code);
      return { code: d.code, name: d.name, who: d.who, vars: d.vars, required: d.required, subjectRequired: d.subjectRequired,
               isCustom: !!c?.isCustom, version: c?.version ?? 0, subject: c?.isCustom ? c.subject : d.subject, updatedAt: c?.updatedAt ?? null };
    }),
    note: '스위치가 꺼져 있으면 고친 문구가 있어도 코드 기본 문구로 보냅니다. 고친 문구가 검사에 걸리면 그 메일도 코드 기본 문구로 나갑니다.',
  };
}

export async function mailTemplateOne(db: DatabaseService, code: string) {
  const d = mailDef(code);
  if (!d) throw new NotFound('없는 메일 종류입니다.');
  const [c] = await db.query<{ isCustom: boolean; version: number; subject: string | null; body: string | null }>(
    `SELECT is_custom AS "isCustom", version, subject, body FROM csx_mail_templates WHERE code = $1`, [code]);
  const versions = await db.query(
    `SELECT v.version, v.kind, v.subject, v.body, v.from_version AS "fromVersion", v.note, v.created_at AS "createdAt", a.email::text AS "by"
       FROM csx_mail_template_versions v LEFT JOIN accounts a ON a.id = v.created_by
      WHERE v.code = $1 ORDER BY v.version DESC LIMIT 30`, [code]);
  return {
    code, name: d.name, who: d.who, where: d.where, vars: d.vars, required: d.required, subjectRequired: d.subjectRequired, sample: d.sample,
    defaults: { subject: d.subject, body: d.body },
    current: c?.isCustom ? { subject: c.subject, body: c.body } : { subject: d.subject, body: d.body },
    isCustom: !!c?.isCustom, version: c?.version ?? 0, versions,
  };
}

/** 미리보기 — 검사 결과 + 보기 값으로 채운 제목 · 본문(보내지 않음) */
export function mailTemplatePreview(code: string, d: { subject?: string; body?: string }) {
  const def = mailDef(code);
  if (!def) throw new NotFound('없는 메일 종류입니다.');
  const subject = d.subject ?? def.subject, body = d.body ?? def.body;
  const problems = checkMailTemplate(code, subject, body);
  return { ok: problems.length === 0, problems, preview: renderMailTemplate(subject, body, def.sample) };
}

function needTplNote(raw: unknown) {
  const n = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (n.length < 2 || n.length > 200) throw new PolicyViolation('CSX_TPL_NOTE', '바꾸는 까닭을 2 ~ 200자로 적어 주십시오.');
  return n;
}

async function bump(db: DatabaseService, code: string, row: { subject: string | null; body: string | null; isCustom: boolean }, kind: 'SAVE' | 'REVERT' | 'RESET', note: string, fromVersion: number | null) {
  const me = RequestCtx.actorId() ?? null;
  return db.transaction(async () => {
    const [cur] = await db.query<{ version: number }>(`SELECT version FROM csx_mail_templates WHERE code = $1 FOR UPDATE`, [code]);
    if (!cur) throw new NotFound('없는 메일 종류입니다.');
    const next = Number(cur.version) + 1;
    await db.query(
      `UPDATE csx_mail_templates SET subject = $2, body = $3, is_custom = $4, version = $5, updated_by = $6, updated_at = now() WHERE code = $1`,
      [code, row.subject, row.body, row.isCustom, next, me]);
    await db.query(
      `INSERT INTO csx_mail_template_versions (code, version, kind, subject, body, from_version, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [code, next, kind, row.subject, row.body, fromVersion, note, me]);
    return next;
  });
}

/** 고쳐 저장(SUPER) — 검사 통과해야 · 같은 글이면 409 */
export async function mailTemplateSave(db: DatabaseService, code: string, d: { subject: string; body: string; note: string }) {
  const def = mailDef(code);
  if (!def) throw new NotFound('없는 메일 종류입니다.');
  const subject = String(d.subject ?? '').trim(), body = String(d.body ?? '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
  const problems = checkMailTemplate(code, subject, body);
  if (problems.length) throw new PolicyViolation('CSX_TPL_CHECK', problems[0]!, { problems });
  const note = needTplNote(d.note);
  const [c] = await db.query<{ isCustom: boolean; subject: string | null; body: string | null }>(
    `SELECT is_custom AS "isCustom", subject, body FROM csx_mail_templates WHERE code = $1`, [code]);
  const nowSubject = c?.isCustom ? c.subject : def.subject, nowBody = c?.isCustom ? c.body : def.body;
  if (nowSubject === subject && nowBody === body) throw new StateConflict('CSX_TPL_SAME', '지금 문구와 같습니다.');
  const v = await bump(db, code, { subject, body, isCustom: true }, 'SAVE', note, null);
  return { ok: true, code, version: v, note: `${def.name} 문구를 ${v}판으로 저장했습니다.` };
}

/** 지난 판으로 되돌리기(SUPER) — 그 판 글을 새 판으로(지난 기록은 그대로) */
export async function mailTemplateRevert(db: DatabaseService, code: string, d: { version: number; note: string }) {
  const def = mailDef(code);
  if (!def) throw new NotFound('없는 메일 종류입니다.');
  const note = needTplNote(d.note);
  const [old] = await db.query<{ kind: string; subject: string | null; body: string | null }>(
    `SELECT kind, subject, body FROM csx_mail_template_versions WHERE code = $1 AND version = $2::int`, [code, d.version]);
  if (!old) throw new NotFound('그 판이 없습니다.');
  if (old.kind === 'RESET' || !old.subject || !old.body) {
    const v = await bump(db, code, { subject: null, body: null, isCustom: false }, 'RESET', note, Number(d.version));
    return { ok: true, code, version: v, note: `코드 기본 문구로 되돌렸습니다(${v}판).` };
  }
  const problems = checkMailTemplate(code, old.subject, old.body);
  if (problems.length) throw new PolicyViolation('CSX_TPL_CHECK', `그 판은 지금 검사에 걸립니다 — ${problems[0]}`, { problems });
  const v = await bump(db, code, { subject: old.subject, body: old.body, isCustom: true }, 'REVERT', note, Number(d.version));
  return { ok: true, code, version: v, note: `${d.version}판 문구로 되돌렸습니다(${v}판).` };
}

/** 코드 기본 문구로(SUPER) */
export async function mailTemplateReset(db: DatabaseService, code: string, d: { note: string }) {
  const def = mailDef(code);
  if (!def) throw new NotFound('없는 메일 종류입니다.');
  const note = needTplNote(d.note);
  const [c] = await db.query<{ isCustom: boolean }>(`SELECT is_custom AS "isCustom" FROM csx_mail_templates WHERE code = $1`, [code]);
  if (!c?.isCustom) throw new StateConflict('CSX_TPL_DEFAULT', '이미 코드 기본 문구입니다.');
  const v = await bump(db, code, { subject: null, body: null, isCustom: false }, 'RESET', note, null);
  return { ok: true, code, version: v, note: `코드 기본 문구로 되돌렸습니다(${v}판).` };
}
