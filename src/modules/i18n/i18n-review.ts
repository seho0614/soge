import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { APP_VERSION } from '../../common/app-version';
import { SERVER_TEXT_EN } from '../../common/i18n/server-text.en';
import { SERVER_TEXT_JA, SERVER_TEXT_JA_META } from '../../common/i18n/server-text.ja';
import { SERVER_TEXT_ZH, SERVER_TEXT_ZH_META } from '../../common/i18n/server-text.zh';
import { DRAFT_LANG_CODES, DraftLang, SITE_DRAFTS } from './lang-drafts';

/* ---------------------------------------------------------------------
 * v10.523 (D278 · docs/661) 일본어 · 중국어(간체) 검수 — 운영 화면 › 관 관리 › 일본어 · 중국어 검수(SB-ADM-OAPI-030)
 *
 *   언어마다: 켜짐(i18n_langs.is_active) · 다국어 전체(i18n.enabled) · 사용자 웹 사전(문장 수 · 초안 표시) · 서버 문장(일본어 · 중국어 수 / 영어 수 · 초안 표시)
 *            · DB 문구 번역(content_translations 상태별 수 · 기존 「번역」 탭에서 승인) · 검수 기록 · 켤 수 있는지
 *   검수 기록(SUPER) — 범위(SITE · SERVER · DB) · 승인 · 반려 · 검수자 이름 · 메모 · 이 판(VERSION) — 쌓기만(DB 가 고치기 · 지우기를 막음)
 *   켜기 · 끄기는 기존 「번역」 탭 · POST /admin/i18n/langs/{code} 그대로 — DB 트리거가 SITE · SERVER 승인 전에는 막음(I18N_REVIEW)
 * ------------------------------------------------------------------- */

const SERVER: Record<DraftLang, { dict: Record<string, string>; meta: { state: string; draftVersion: string; reviewedVersion: string | null } }> = {
  ja: { dict: SERVER_TEXT_JA, meta: SERVER_TEXT_JA_META },
  zh: { dict: SERVER_TEXT_ZH, meta: SERVER_TEXT_ZH_META },
};
export const REVIEW_SCOPES = ['SITE', 'SERVER', 'DB'] as const;
export const REVIEW_VERDICTS = ['APPROVED', 'REJECTED'] as const;

const langOf = (code: string): DraftLang => {
  if (!(DRAFT_LANG_CODES as readonly string[]).includes(code)) throw new NotFound('검수 대상 언어(ja · zh)가 아닙니다.');
  return code as DraftLang;
};

export async function i18nReviewOverview(db: DatabaseService) {
  const [en] = await db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'i18n.enabled'`);
  const langs = await db.query<{ code: string; native: string; isActive: boolean }>(
    `SELECT code, native, is_active AS "isActive" FROM i18n_langs WHERE code = ANY($1::text[]) ORDER BY sort_order`, [[...DRAFT_LANG_CODES]]);
  const tr = await db.query<{ lang: string; status: string; n: number }>(
    `SELECT lang, status, count(*)::int AS n FROM content_translations WHERE lang = ANY($1::text[]) GROUP BY lang, status`, [[...DRAFT_LANG_CODES]]);
  const reviews = await db.query<{ id: string; lang: string; scope: string; verdict: string; reviewer: string; dictVersion: string; note: string | null; createdAt: string }>(
    `SELECT id::text AS id, lang, scope, verdict, reviewer, dict_version AS "dictVersion", note, created_at AS "createdAt"
       FROM i18n_lang_reviews WHERE lang = ANY($1::text[]) ORDER BY id DESC LIMIT 60`, [[...DRAFT_LANG_CODES]]);
  const enCount = Object.keys(SERVER_TEXT_EN).length;
  const items = DRAFT_LANG_CODES.map((code) => {
    const l = langs.find((x) => x.code === code);
    const mine = reviews.filter((r) => r.lang === code);
    const latest = Object.fromEntries(REVIEW_SCOPES.map((s) => [s, mine.find((r) => r.scope === s) ?? null]));
    const ok = (s: string) => (latest[s] as { verdict: string } | null)?.verdict === 'APPROVED';
    return {
      code, native: l?.native ?? code, exists: !!l, isActive: !!l?.isActive,
      site: SITE_DRAFTS[code],
      server: { keys: Object.keys(SERVER[code].dict).length, enKeys: enCount, ...SERVER[code].meta },
      db: Object.fromEntries(tr.filter((x) => x.lang === code).map((x) => [x.status, x.n])),
      latest, reviews: mine.slice(0, 20),
      canActivate: ok('SITE') && ok('SERVER'),
    };
  });
  return {
    enabled: (en?.value ?? '') === 'on', version: APP_VERSION, items,
    canRecord: RequestCtx.get()?.actorRole === 'SUPER',
    note: '일본어 · 중국어 사전은 기계 번역 초안입니다 — 검수자가 고친 뒤 사이트 · 서버 문장 「승인」을 남겨야 켤 수 있습니다(빠진 문장은 영어로 나갑니다).',
  };
}

export async function recordI18nReview(db: DatabaseService, code: string, d: { scope: string; verdict: string; reviewer: string; note?: string }, actor: string | null) {
  const lang = langOf(code);
  if (!(REVIEW_SCOPES as readonly string[]).includes(d.scope)) throw new PolicyViolation('I18N_REVIEW_SCOPE', '범위는 SITE · SERVER · DB 중 하나입니다.');
  if (!(REVIEW_VERDICTS as readonly string[]).includes(d.verdict)) throw new PolicyViolation('I18N_REVIEW_VERDICT', '판정은 APPROVED · REJECTED 중 하나입니다.');
  const reviewer = String(d.reviewer ?? '').replace(/\s+/g, ' ').trim();
  if (reviewer.length < 2 || reviewer.length > 60) throw new PolicyViolation('I18N_REVIEW_WHO', '검수자 이름은 2 ~ 60자입니다.');
  const note = d.note === undefined ? null : String(d.note).trim().slice(0, 500) || null;
  if (d.verdict === 'REJECTED' && !note) throw new PolicyViolation('I18N_REVIEW_NOTE', '반려에는 고칠 곳을 메모로 남기십시오.');
  const ver = /^v10\.[0-9]{3}$/.test(APP_VERSION) ? APP_VERSION : 'v10.523';
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO i18n_lang_reviews (lang, scope, verdict, reviewer, dict_version, note, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text AS id`,
    [lang, d.scope, d.verdict, reviewer, ver, note, actor]);
  return { ok: true, id: row.id, lang, scope: d.scope, verdict: d.verdict, dictVersion: ver, note: d.verdict === 'APPROVED' ? '검수 승인을 남겼습니다.' : '검수 반려를 남겼습니다.' };
}
