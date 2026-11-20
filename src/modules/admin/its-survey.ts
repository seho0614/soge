import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { dayOk } from './its-keys';

/* ---------------------------------------------------------------------
 * v10.493 (D270 · docs/631) 사내 설문 — 대표 11/20 「㊵ 사무 · 보안」
 *   만들기 · 고치기 · 열기 · 마감 · 취소 · 결과 · CSV = ADMIN · SUPER / 답하기 = 대상 역할에 든 운영 계정(비우면 운영 계정 모두)
 *   질문 유형 SINGLE(하나) · MULTI(여럿) · SCALE(1 ~ N 점) · TEXT(글 1000자) · 30개까지 · 기간 92일까지 · 익명(처음 켬)
 *   두 번 내기 막기 = its_survey_takers(낸 사실만 · 시각 없음) · 답 = its_survey_answers(익명이면 계정 칸 없음 · 번호 무작위 · 시각 없음)
 *   익명 설문의 결과 · CSV 는 **마감 뒤 · 응답 수가 its.survey_min_count(처음 3) 이상일 때만** — 받는 중에 들여다보며 한 사람 답을 가려내지 못하게
 *     · 글 답은 가나다순(낸 차례 아님) · 낸 사람 이름 목록은 이름을 밝히는 설문에서만
 *   답 넣기 API 에는 감사 기록 · 권한 주소 맵을 붙이지 않음. CSV 는 내려받기 승인(ITS_SURVEY · ExportGate)
 *   정기 작업 its_office_daily(매일 08:55) — 기간 지난 받는 중 설문을 마감
 * ------------------------------------------------------------------- */

export interface Viewer { id: string; roles: string[] }
export const SURVEY_QTYPES = ['SINGLE', 'MULTI', 'SCALE', 'TEXT'] as const;
export const SURVEY_QTYPE_KO: Record<string, string> = { SINGLE: '하나 고르기', MULTI: '여럿 고르기', SCALE: '점수', TEXT: '글' };
export const SURVEY_STATE_KO: Record<string, string> = { DRAFT: '고치는 중', OPEN: '받는 중', CLOSED: '마감', CANCELED: '취소' };
export const SURVEY_ROLES = ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'] as const;   // DB CHECK its_surveys.audience 와 같음
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400e3);
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

export interface QuestionInput { type?: string; body?: string; options?: string[]; scaleMax?: number | null; required?: boolean }
export interface SurveyInput { title?: string; intro?: string | null; anonymous?: boolean; audience?: string[]; opensOn?: string; closesOn?: string; questions?: QuestionInput[] }
export interface Q { id: string; ord: number; qtype: string; body: string; options: string[]; scale_max: number | null; required: boolean }
export interface S { id: string; title: string; intro: string | null; is_anon: boolean; audience: string[]; opens_on: string; closes_on: string; state: string;
  created_by: string; creator: string | null; created_at: string; opened_at: string | null; closed_at: string | null; cancel_note: string | null }

const SEL = `SELECT s.id::text AS id, s.title, s.intro, s.is_anon, s.audience, s.opens_on::text AS opens_on, s.closes_on::text AS closes_on, s.state,
                    s.created_by::text AS created_by, coalesce(a.name, a.email) AS creator, s.created_at, s.opened_at, s.closed_at, s.cancel_note
               FROM its_surveys s LEFT JOIN accounts a ON a.id = s.created_by`;

async function minCount(db: DatabaseService) {
  const [r] = await db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'its.survey_min_count'`);
  const n = Number(r?.value ?? 3);
  return Number.isInteger(n) && n >= 2 && n <= 20 ? n : 3;
}
async function questions(db: DatabaseService, sid: string) {
  return db.query<Q>(`SELECT id::text AS id, ord, qtype, body, options, scale_max, required FROM its_survey_questions WHERE survey_id = $1::bigint ORDER BY ord`, [sid]);
}
const qOut = (q: Q) => ({ id: q.id, ord: q.ord, type: q.qtype, typeKo: SURVEY_QTYPE_KO[q.qtype] ?? q.qtype, body: q.body, options: q.options, scaleMax: q.scale_max, required: q.required });
/** 대상 계정 수(쓰는 중 · 운영 역할 · 대상 역할 — 비우면 운영 역할 모두) */
async function eligible(db: DatabaseService, audience: string[]) {
  const roles = audience.length ? audience : [...SURVEY_ROLES];
  const [r] = await db.query<{ n: number }>(
    `SELECT count(DISTINCT a.id)::int AS n FROM accounts a JOIN account_roles r ON r.account_id = a.id WHERE a.status = 'ACTIVE' AND r.role = ANY($1::text[])`, [roles]);
  return r?.n ?? 0;
}
const inAudience = (s: { audience: string[] }, v: Viewer) => (s.audience.length ? s.audience : [...SURVEY_ROLES]).some((r) => v.roles.includes(r));

function checkSurvey(b: SurveyInput, base?: S) {
  const title = b.title === undefined && base ? base.title : clean(b.title);
  if (title.length < 2 || title.length > 100) throw new PolicyViolation('ITS_SURVEY_TITLE', '설문 제목은 2 ~ 100자입니다.');
  const intro = b.intro === undefined ? base?.intro ?? null : (b.intro == null ? null : String(b.intro).trim() || null);
  if (intro && intro.length > 1000) throw new PolicyViolation('ITS_SURVEY_TITLE', '안내 글은 1000자까지입니다.');
  const audience = b.audience === undefined ? base?.audience ?? [] : [...new Set((b.audience ?? []).map(String))];
  if (audience.some((r) => !(SURVEY_ROLES as readonly string[]).includes(r))) throw new PolicyViolation('ITS_SURVEY_AUDIENCE', '대상 역할이 맞지 않습니다.');
  const opensOn = b.opensOn === undefined && base ? base.opens_on : String(b.opensOn ?? '');
  const closesOn = b.closesOn === undefined && base ? base.closes_on : String(b.closesOn ?? '');
  if (!dayOk(opensOn) || !dayOk(closesOn)) throw new PolicyViolation('ITS_SURVEY_DATE', '시작일 · 마감일(YYYY-MM-DD)이 맞지 않습니다.');
  if (closesOn < opensOn || diffDays(closesOn, opensOn) > 92) throw new PolicyViolation('ITS_SURVEY_DATE', '마감일은 시작일부터 92일 안입니다.');
  const isAnon = b.anonymous === undefined ? base?.is_anon ?? true : b.anonymous === true;
  return { title, intro, audience, opensOn, closesOn, isAnon };
}
function checkQuestions(qs: QuestionInput[] | undefined) {
  const list = qs ?? [];
  if (list.length < 1 || list.length > 30) throw new PolicyViolation('ITS_SURVEY_QUESTION', '질문은 1 ~ 30개입니다.');
  return list.map((q, i) => {
    const type = String(q.type ?? '');
    if (!(SURVEY_QTYPES as readonly string[]).includes(type)) throw new PolicyViolation('ITS_SURVEY_QUESTION', `${i + 1}번 질문의 유형을 고르십시오.`);
    const body = clean(q.body);
    if (body.length < 2 || body.length > 300) throw new PolicyViolation('ITS_SURVEY_QUESTION', `${i + 1}번 질문은 2 ~ 300자입니다.`);
    let options: string[] = [], scaleMax: number | null = null;
    if (type === 'SINGLE' || type === 'MULTI') {
      options = (q.options ?? []).map(clean).filter(Boolean);
      if (options.length < 2 || options.length > 12 || options.some((o) => o.length > 80) || new Set(options).size !== options.length) {
        throw new PolicyViolation('ITS_SURVEY_QUESTION', `${i + 1}번 질문의 보기는 서로 다른 2 ~ 12개(각 80자까지)입니다.`);
      }
    } else if (type === 'SCALE') {
      scaleMax = Number(q.scaleMax ?? 5);
      if (!Number.isInteger(scaleMax) || scaleMax < 3 || scaleMax > 10) throw new PolicyViolation('ITS_SURVEY_QUESTION', `${i + 1}번 질문의 점수는 1 ~ 3 에서 1 ~ 10 까지입니다.`);
    }
    return { ord: i + 1, type, body, options, scaleMax, required: q.required !== false };
  });
}
async function putQuestions(db: DatabaseService, sid: string, qs: ReturnType<typeof checkQuestions>) {
  await db.query(`DELETE FROM its_survey_questions WHERE survey_id = $1::bigint`, [sid]);
  for (const q of qs) {
    await db.query(`INSERT INTO its_survey_questions (survey_id, ord, qtype, body, options, scale_max, required) VALUES ($1::bigint, $2::int, $3, $4, $5::text[], $6::int, $7)`,
      [sid, q.ord, q.type, q.body, q.options, q.scaleMax, q.required]);
  }
}

async function loadSurvey(db: DatabaseService, id: string, lock = false) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('설문이 없습니다.');
  const [s] = await db.query<S>(SEL + ` WHERE s.id = $1::bigint` + (lock ? ' FOR UPDATE OF s' : ''), [id]);
  if (!s) throw new NotFound('설문이 없습니다.');
  return s;
}

/** GET /admin/its/surveys — 관리 목록(응답 수 · 대상 수) */
export async function listSurveys(db: DatabaseService) {
  const rows = await db.query<S & { takers: number; qn: number }>(
    `SELECT x.*, (SELECT count(*)::int FROM its_survey_takers t WHERE t.survey_id = x.id::bigint) AS takers,
            (SELECT count(*)::int FROM its_survey_questions q WHERE q.survey_id = x.id::bigint) AS qn
       FROM (${SEL}) x ORDER BY (x.state IN ('DRAFT', 'OPEN')) DESC, x.closes_on DESC, x.id DESC LIMIT 200`);
  const items = [];
  for (const s of rows) {
    items.push({ id: s.id, title: s.title, anonymous: s.is_anon, audience: s.audience, opensOn: s.opens_on, closesOn: s.closes_on, state: s.state, stateKo: SURVEY_STATE_KO[s.state] ?? s.state,
                 creator: s.creator, questions: s.qn, takers: s.takers, eligible: s.state === 'DRAFT' || s.state === 'OPEN' ? await eligible(db, s.audience) : null });
  }
  return { items, roles: SURVEY_ROLES, types: SURVEY_QTYPE_KO, states: SURVEY_STATE_KO, minCount: await minCount(db),
           note: '익명 설문은 쓴 사람을 답에 저장하지 않고, 결과는 마감 뒤 응답이 설정 수(처음 3) 이상일 때만 보입니다. 고치는 중(DRAFT)일 때만 질문을 바꿉니다.' };
}

/** GET /admin/its/surveys/{id}(관리 화면이 결과와 함께 씀) — 질문까지 */
export async function surveyDetail(db: DatabaseService, id: string) {
  const s = await loadSurvey(db, id);
  return { id: s.id, title: s.title, intro: s.intro, anonymous: s.is_anon, audience: s.audience, opensOn: s.opens_on, closesOn: s.closes_on, state: s.state,
           questions: (await questions(db, s.id)).map(qOut) };
}

/** POST /admin/its/surveys — 고치는 중(DRAFT)으로 만듦 */
export async function createSurvey(db: DatabaseService, b: SurveyInput, v: Viewer) {
  const s = checkSurvey(b);
  const qs = checkQuestions(b.questions);
  return db.transaction(async () => {
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO its_surveys (title, intro, is_anon, audience, opens_on, closes_on, created_by) VALUES ($1, $2, $3, $4::text[], $5::date, $6::date, $7::uuid) RETURNING id::text AS id`,
      [s.title, s.intro, s.isAnon, s.audience, s.opensOn, s.closesOn, v.id]);
    await putQuestions(db, r!.id, qs);
    return { ok: true, id: r!.id, note: '설문을 만들었습니다(고치는 중) — 「열기」를 누르면 대상에게 보입니다.' };
  });
}

/** PUT /admin/its/surveys/{id} — 고치는 중이면 모두(질문은 보낸 목록으로 바꿈) · 받는 중이면 마감일 늦추기만 */
export async function updateSurvey(db: DatabaseService, id: string, b: SurveyInput) {
  return db.transaction(async () => {
    const cur = await loadSurvey(db, id, true);
    if (cur.state === 'OPEN') {
      const others = [b.title, b.intro, b.anonymous, b.audience, b.opensOn, b.questions].some((x) => x !== undefined);
      if (others) throw new StateConflict('ITS_SURVEY_STATE', '받는 중인 설문은 마감일만 늦출 수 있습니다.');
      const closesOn = String(b.closesOn ?? '');
      if (!dayOk(closesOn) || closesOn < cur.closes_on || diffDays(closesOn, cur.opens_on) > 92) throw new PolicyViolation('ITS_SURVEY_DATE', '마감일은 지금보다 늦게 · 시작일부터 92일 안으로만 바꿉니다.');
      await db.query(`UPDATE its_surveys SET closes_on = $2::date WHERE id = $1::bigint`, [id, closesOn]);
      return { ok: true, id, note: '마감일을 늦췄습니다.' };
    }
    if (cur.state !== 'DRAFT') throw new StateConflict('ITS_SURVEY_STATE', '마감 · 취소한 설문은 바꾸지 않습니다.');
    const s = checkSurvey(b, cur);
    await db.query(`UPDATE its_surveys SET title = $2, intro = $3, is_anon = $4, audience = $5::text[], opens_on = $6::date, closes_on = $7::date WHERE id = $1::bigint`,
      [id, s.title, s.intro, s.isAnon, s.audience, s.opensOn, s.closesOn]);
    if (b.questions !== undefined) await putQuestions(db, id, checkQuestions(b.questions));
    return { ok: true, id, note: '고쳤습니다.' };
  });
}

/** POST /admin/its/surveys/{id}/open · close · cancel */
export async function moveSurvey(db: DatabaseService, id: string, to: 'OPEN' | 'CLOSED' | 'CANCELED', reasonIn?: string) {
  return db.transaction(async () => {
    const s = await loadSurvey(db, id, true);
    const ok = (to === 'OPEN' && s.state === 'DRAFT') || (to === 'CLOSED' && s.state === 'OPEN') || (to === 'CANCELED' && (s.state === 'DRAFT' || s.state === 'OPEN'));
    if (!ok) throw new StateConflict('ITS_SURVEY_STATE', `「${SURVEY_STATE_KO[s.state] ?? s.state}」 설문은 그렇게 옮길 수 없습니다.`);
    if (to === 'OPEN') {
      if (s.closes_on < kstToday()) throw new PolicyViolation('ITS_SURVEY_DATE', '마감일이 지났습니다 — 마감일을 고친 뒤 여십시오.');
      const [q] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM its_survey_questions WHERE survey_id = $1::bigint`, [id]);
      if (!q?.n) throw new PolicyViolation('ITS_SURVEY_EMPTY', '질문이 하나도 없는 설문은 열지 않습니다.');
      await db.query(`UPDATE its_surveys SET state = 'OPEN', opened_at = now() WHERE id = $1::bigint`, [id]);
      return { ok: true, id, state: 'OPEN', note: `열었습니다 — ${s.opens_on} ~ ${s.closes_on} 동안 대상에게 「사무 › 사내 설문」에 보입니다.` };
    }
    if (to === 'CLOSED') {
      await db.query(`UPDATE its_surveys SET state = 'CLOSED', closed_at = now() WHERE id = $1::bigint`, [id]);
      return { ok: true, id, state: 'CLOSED', note: '마감했습니다 — 결과를 볼 수 있습니다.' };
    }
    const reason = clean(reasonIn);
    if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('ITS_SURVEY_REASON', '취소 사유는 2 ~ 200자입니다.');
    await db.query(`UPDATE its_surveys SET state = 'CANCELED', cancel_note = $2 WHERE id = $1::bigint`, [id, reason]);
    return { ok: true, id, state: 'CANCELED', note: '취소했습니다(받은 답은 지우지 않고 결과는 보이지 않습니다).' };
  });
}

/** GET /admin/its/my-surveys — 내가 답할 수 있는 받는 중 설문 · 낸 것 표시 */
export async function mySurveys(db: DatabaseService, v: Viewer) {
  const today = kstToday();
  const rows = await db.query<S & { taken: boolean; qn: number }>(
    `SELECT x.*, EXISTS (SELECT 1 FROM its_survey_takers t WHERE t.survey_id = x.id::bigint AND t.account_id = $2::uuid) AS taken,
            (SELECT count(*)::int FROM its_survey_questions q WHERE q.survey_id = x.id::bigint) AS qn
       FROM (${SEL}) x WHERE x.state = 'OPEN' AND x.opens_on::date <= $1::date AND x.closes_on::date >= $1::date ORDER BY x.closes_on, x.id`, [today, v.id]);
  const items = rows.filter((s) => inAudience(s, v)).map((s) => ({ id: s.id, title: s.title, anonymous: s.is_anon, closesOn: s.closes_on, questions: s.qn, taken: s.taken }));
  return { today, items, note: '익명 설문은 낸 사실만 남고(두 번 내기 막기), 무엇을 골랐는지는 누가 냈는지와 이어지지 않게 저장됩니다. 낸 답은 고칠 수 없습니다.' };
}

/** GET /admin/its/my-surveys/{id} — 답할 질문(대상이 아니거나 받는 중이 아니면 「없음」) */
export async function surveyForm(db: DatabaseService, id: string, v: Viewer) {
  const s = await loadSurvey(db, id);
  const today = kstToday();
  if (s.state !== 'OPEN' || today < s.opens_on || today > s.closes_on || !inAudience(s, v)) throw new NotFound('지금 답할 수 있는 설문이 없습니다.');
  const [t] = await db.query(`SELECT 1 FROM its_survey_takers WHERE survey_id = $1::bigint AND account_id = $2::uuid`, [s.id, v.id]);
  return { id: s.id, title: s.title, intro: s.intro, anonymous: s.is_anon, closesOn: s.closes_on, taken: !!t, questions: (await questions(db, s.id)).map(qOut) };
}

/** 답 모양 검사 — DB fn_its_survey_answer_guard 와 같은 규칙 */
function checkAnswers(qs: Q[], raw: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const known = new Set(qs.map((q) => q.id));
  for (const k of Object.keys(raw ?? {})) if (!known.has(k)) throw new PolicyViolation('ITS_SURVEY_ANSWER', '이 설문에 없는 질문의 답이 있습니다.');
  for (const q of qs) {
    const v = raw?.[q.id];
    const empty = v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
    if (empty) { if (q.required) throw new PolicyViolation('ITS_SURVEY_ANSWER', `${q.ord}번 질문은 꼭 답해야 합니다.`); continue; }
    const idx = (x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < q.options.length;
    if (q.qtype === 'SINGLE') { if (!idx(v)) throw new PolicyViolation('ITS_SURVEY_ANSWER', `${q.ord}번 질문의 답을 고르십시오.`); out[q.id] = v; }
    else if (q.qtype === 'MULTI') {
      if (!Array.isArray(v) || !v.every(idx) || new Set(v).size !== v.length) throw new PolicyViolation('ITS_SURVEY_ANSWER', `${q.ord}번 질문의 답을 고르십시오.`);
      out[q.id] = [...v].sort((a, b) => (a as number) - (b as number));
    } else if (q.qtype === 'SCALE') {
      if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > (q.scale_max ?? 5)) throw new PolicyViolation('ITS_SURVEY_ANSWER', `${q.ord}번 질문의 점수가 범위 밖입니다.`);
      out[q.id] = v;
    } else {
      const t = String(v).trim();
      if (t.length > 1000) throw new PolicyViolation('ITS_SURVEY_ANSWER', `${q.ord}번 질문의 글은 1000자까지입니다.`);
      out[q.id] = t;
    }
  }
  return out;
}

/** POST /admin/its/my-surveys/{id}/answer — 낸 사실(takers) + 답(익명이면 계정 없이) 한 번에 · 두 번이면 409 */
export async function answerSurvey(db: DatabaseService, id: string, raw: Record<string, unknown>, v: Viewer) {
  const s = await loadSurvey(db, id);
  const today = kstToday();
  if (s.state !== 'OPEN' || today < s.opens_on || today > s.closes_on || !inAudience(s, v)) throw new NotFound('지금 답할 수 있는 설문이 없습니다.');
  const answers = checkAnswers(await questions(db, s.id), raw);
  return db.transaction(async () => {
    const t = await db.query(`INSERT INTO its_survey_takers (survey_id, account_id) VALUES ($1::bigint, $2::uuid) ON CONFLICT DO NOTHING RETURNING survey_id`, [s.id, v.id]);
    if (!t.length) throw new StateConflict('ITS_SURVEY_TAKEN', '이미 낸 설문입니다(낸 답은 고칠 수 없습니다).');
    await db.query(`INSERT INTO its_survey_answers (survey_id, account_id, answers) VALUES ($1::bigint, $2::uuid, $3::jsonb)`,
      [s.id, s.is_anon ? null : v.id, JSON.stringify(answers)]);
    return { ok: true, id: s.id, note: s.is_anon ? '냈습니다 — 익명 설문이라 답에 이름이 남지 않습니다.' : '냈습니다.' };
  });
}

/** 결과 셈(관리 화면 · CSV 공통) — 익명은 마감 뒤 · 최소 응답 수 이상만 */
async function tally(db: DatabaseService, id: string) {
  const s = await loadSurvey(db, id);
  const qs = await questions(db, s.id);
  const min = await minCount(db);
  const rows = await db.query<{ answers: Record<string, unknown>; account_id: string | null; who: string | null }>(
    `SELECT x.answers, x.account_id::text AS account_id, coalesce(a.name, a.email) AS who
       FROM its_survey_answers x LEFT JOIN accounts a ON a.id = x.account_id WHERE x.survey_id = $1::bigint`, [s.id]);
  const n = rows.length;
  const [tk] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM its_survey_takers WHERE survey_id = $1::bigint`, [s.id]);
  let hidden: null | 'OPEN' | 'MIN' | 'CANCELED' = null;
  if (s.state === 'CANCELED') hidden = 'CANCELED';
  else if (s.is_anon && s.state !== 'CLOSED') hidden = 'OPEN';
  else if (s.is_anon && n < min) hidden = 'MIN';
  const per = hidden ? [] : qs.map((q) => {
    const vals = rows.map((r) => r.answers?.[q.id]).filter((x) => x !== undefined && x !== null && x !== '');
    if (q.qtype === 'SINGLE' || q.qtype === 'MULTI') {
      const counts = q.options.map((_, i) => vals.filter((x) => (Array.isArray(x) ? x.includes(i) : x === i)).length);
      return { ...qOut(q), answered: vals.length, counts };
    }
    if (q.qtype === 'SCALE') {
      const nums = vals.map(Number).filter((x) => Number.isInteger(x));
      const dist = Array.from({ length: q.scale_max ?? 5 }, (_, i) => nums.filter((x) => x === i + 1).length);
      return { ...qOut(q), answered: nums.length, dist, avg: nums.length ? Math.round((nums.reduce((a, x) => a + x, 0) / nums.length) * 100) / 100 : null };
    }
    const texts = vals.map(String).filter((t) => t.trim()).sort((a, b) => a.localeCompare(b, 'ko'));
    return { ...qOut(q), answered: texts.length, texts };
  });
  return { s, qs, rows, n, takers: tk?.n ?? 0, min, hidden, per };
}

const HIDE_KO: Record<string, string> = {
  OPEN: '익명 설문은 마감한 뒤에 결과를 봅니다(받는 중에 들여다보며 한 사람의 답을 가려내지 못하게).',
  MIN: '응답이 너무 적어 결과를 감춥니다 — 누가 무엇을 골랐는지 짐작할 수 있습니다.',
  CANCELED: '취소한 설문은 결과를 보이지 않습니다.',
};

/** GET /admin/its/surveys/{id}/results */
export async function surveyResults(db: DatabaseService, id: string) {
  const t = await tally(db, id);
  return {
    id: t.s.id, title: t.s.title, anonymous: t.s.is_anon, state: t.s.state, stateKo: SURVEY_STATE_KO[t.s.state] ?? t.s.state, opensOn: t.s.opens_on, closesOn: t.s.closes_on,
    responses: t.hidden === 'MIN' ? null : t.n, takers: t.hidden === 'MIN' ? null : t.takers, eligible: await eligible(db, t.s.audience), minCount: t.min,
    hidden: t.hidden, hiddenNote: t.hidden ? (t.hidden === 'MIN' ? `${HIDE_KO.MIN} (최소 ${t.min}명)` : HIDE_KO[t.hidden]) : null,
    questions: t.per, respondents: !t.s.is_anon && !t.hidden ? t.rows.map((r) => r.who).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), 'ko')) : null,
  };
}

const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s; };
const csv = (head: string[], rows: unknown[][]) => '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

/** GET /admin/its/surveys/{id}/export?ticket= — 내려받기 승인(ITS_SURVEY) · 익명은 집계 · 글 답(가나다순)만 · 이름을 밝히는 설문은 사람마다 한 줄 */
export async function surveyExport(db: DatabaseService, id: string) {
  const t = await tally(db, id);
  if (t.hidden) throw new PolicyViolation('ITS_SURVEY_HIDDEN', t.hidden === 'MIN' ? `${HIDE_KO.MIN} (최소 ${t.min}명)` : HIDE_KO[t.hidden]!);
  const rows: unknown[][] = [];
  let head: string[];
  if (t.s.is_anon) {
    head = ['질문 번호', '질문', '유형', '보기 · 점수 · 글', '수'];
    for (const q of t.per as Array<any>) {
      if (q.counts) q.options.forEach((o: string, i: number) => rows.push([q.ord, q.body, q.typeKo, o, q.counts[i]]));
      else if (q.dist) { q.dist.forEach((c: number, i: number) => rows.push([q.ord, q.body, q.typeKo, `${i + 1}점`, c])); rows.push([q.ord, q.body, q.typeKo, '평균', q.avg ?? '']); }
      else for (const tx of q.texts as string[]) rows.push([q.ord, q.body, q.typeKo, tx, '']);
    }
    rows.push(['', '응답 수', '', '', t.n]);
  } else {
    head = ['이름', ...t.qs.map((q) => `${q.ord}. ${q.body}`)];
    const fmt = (q: Q, v: unknown) => {
      if (v === undefined || v === null) return '';
      if (q.qtype === 'SINGLE') return q.options[Number(v)] ?? '';
      if (q.qtype === 'MULTI') return (Array.isArray(v) ? v : []).map((i) => q.options[Number(i)] ?? '').join(' / ');
      return String(v);
    };
    for (const r of [...t.rows].sort((a, b) => String(a.who ?? '').localeCompare(String(b.who ?? ''), 'ko'))) rows.push([r.who ?? '', ...t.qs.map((q) => fmt(q, r.answers?.[q.id]))]);
  }
  return { csv: csv(head, rows), filename: `사내설문_${t.s.id}_${t.s.closes_on}.csv`, responses: t.n,
           note: t.s.is_anon ? '익명 설문 — 집계와 글 답(가나다순)만 담았습니다.' : '사람마다 한 줄(이름을 밝히는 설문)입니다.' };
}

/** 정기 작업(its_office_daily) 한 몫 — 기간 지난 받는 중 설문 마감 */
export async function itsSurveyCloseJob(db: DatabaseService) {
  const r = await db.query(`UPDATE its_surveys SET state = 'CLOSED', closed_at = now() WHERE state = 'OPEN' AND closes_on < (now() AT TIME ZONE 'Asia/Seoul')::date RETURNING id`);
  return { closed: r.length };
}

