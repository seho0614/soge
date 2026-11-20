import { createHash, randomBytes } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { switchOn } from './its-keys';

/* ---------------------------------------------------------------------
 * v10.492 (D270 · docs/630) 사내 제안 · 건의함 — 대표 11/20 「㊵ 사무 · 보안」
 *   운영 계정 누구나 제안(분류 · 제목 · 내용) — 「익명으로」를 고르면 **쓴 사람 · 시각을 저장하지 않음**
 *     · 넣는 문장에 계정 번호를 보내지 않고(author_id NULL) · DB 트리거가 한 번 더 지움 · 날짜만 · 번호는 무작위 uuid
 *     · 쓴 사람만 받는 접수 번호(12자 · 한 번만 보여 줌) — DB 에는 sha256 만 · 이 번호로 진행 · 답변을 봄
 *     · 이 API 들에는 감사 기록(@Audit) · 권한 주소 맵 · 운영 알림 시각을 붙이지 않음(누가 언제 불렀는지가 남지 않게)
 *   검토(ADMIN · SUPER): 접수 → 검토 중 → 채택 → 실행 끝 · 반영 안 함 — 채택 · 반영 안 함 · 끝은 답변이 있어야 · 기록(its_suggestion_log · 검토한 사람만)
 *   매일 08:55 「접수」 그대로인 수를 운영 알림 ITS_SUGGEST_WAITING(수만 · 하루 한 번)
 * ------------------------------------------------------------------- */

export const SUGGEST_CATEGORIES = ['WORK', 'SYSTEM', 'WELFARE', 'SAFETY', 'OTHER'] as const;
export const SUGGEST_CATEGORY_KO: Record<string, string> = { WORK: '업무 방식', SYSTEM: '시스템 · 도구', WELFARE: '복지 · 환경', SAFETY: '안전 · 보안', OTHER: '그 밖' };
export const SUGGEST_STATES = ['RECEIVED', 'REVIEWING', 'ADOPTED', 'DECLINED', 'DONE'] as const;
export const SUGGEST_STATE_KO: Record<string, string> = { RECEIVED: '접수', REVIEWING: '검토 중', ADOPTED: '채택', DECLINED: '반영 안 함', DONE: '실행 끝' };
const NEXT: Record<string, string[]> = { RECEIVED: ['REVIEWING', 'ADOPTED', 'DECLINED'], REVIEWING: ['RECEIVED', 'ADOPTED', 'DECLINED'], ADOPTED: ['DONE'], DECLINED: [], DONE: [] };
const NEED_ANSWER = ['ADOPTED', 'DECLINED', 'DONE'];
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const RECEIPT_RE = /^[A-Za-z0-9-]{12,20}$/;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 헷갈리는 글자(0 · O · 1 · I) 뺌
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const receiptKey = (code: string) => createHash('sha256').update(code.toUpperCase().replace(/[^A-Z0-9]/g, ''), 'utf8').digest('hex');
function newReceipt() {
  const b = randomBytes(12);
  const s = Array.from(b, (x) => ALPHA[x % ALPHA.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export interface SuggestInput { category?: string; title?: string; body?: string; anonymous?: boolean }

/** POST /admin/its/suggestions — 익명이면 쓴 사람을 넣지 않음(번호를 보내지 않음 · DB 도 지움) */
export async function submitSuggestion(db: DatabaseService, b: SuggestInput, me: string) {
  const category = String(b.category ?? '');
  if (!(SUGGEST_CATEGORIES as readonly string[]).includes(category)) throw new PolicyViolation('ITS_SUGGEST_CATEGORY', '분류를 고르십시오.');
  const title = clean(b.title);
  if (title.length < 2 || title.length > 100) throw new PolicyViolation('ITS_SUGGEST_TITLE', '제목은 2 ~ 100자입니다.');
  const body = String(b.body ?? '').trim();
  if (body.length < 10 || body.length > 3000) throw new PolicyViolation('ITS_SUGGEST_BODY', '내용은 10 ~ 3000자입니다.');
  if (b.anonymous === true) {
    const code = newReceipt();
    await db.query(
      `INSERT INTO its_suggestions (category, title, body, is_anon, author_id, receipt_hash) VALUES ($1, $2, $3, true, NULL, $4)`,
      [category, title, body, receiptKey(code)]);
    return { ok: true, anonymous: true, receiptCode: code,
             note: '익명으로 냈습니다 — 쓴 사람 · 시각은 저장하지 않았습니다. 아래 접수 번호는 지금 한 번만 보입니다. 적어 두면 「접수 번호로 보기」에서 진행 · 답변을 볼 수 있습니다.' };
  }
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO its_suggestions (category, title, body, is_anon, author_id) VALUES ($1, $2, $3, false, $4::uuid) RETURNING id::text AS id`,
    [category, title, body, me]);
  return { ok: true, anonymous: false, id: r!.id, note: '제안을 냈습니다 — 「내 제안」에서 진행 · 답변을 봅니다.' };
}

const PUB = `SELECT s.id::text AS id, s.category, s.title, s.body, s.is_anon AS "isAnon", s.created_on::text AS "createdOn", s.state, s.answer, s.answered_at AS "answeredAt"
               FROM its_suggestions s`;
const dress = <T extends { category: string; state: string }>(r: T) => ({ ...r, categoryKo: SUGGEST_CATEGORY_KO[r.category] ?? r.category, stateKo: SUGGEST_STATE_KO[r.state] ?? r.state });

/** GET /admin/its/suggestions/mine — 이름을 밝힌 내 제안만(익명은 접수 번호로) */
export async function mySuggestions(db: DatabaseService, me: string) {
  const rows = await db.query<any>(PUB + ` WHERE s.author_id = $1::uuid ORDER BY s.created_on DESC, s.created_at DESC LIMIT 200`, [me]);
  return { items: rows.map(dress), categories: SUGGEST_CATEGORY_KO, note: '이름을 밝힌 제안만 보입니다 — 익명 제안은 쓴 사람을 저장하지 않아 「접수 번호로 보기」로만 찾습니다.' };
}

/** POST /admin/its/suggestions/lookup — 접수 번호(익명) → 진행 · 답변 */
export async function lookupSuggestion(db: DatabaseService, codeIn: string) {
  const code = String(codeIn ?? '').trim();
  if (!RECEIPT_RE.test(code)) throw new PolicyViolation('ITS_SUGGEST_RECEIPT', '접수 번호(예: ABCD-EFGH-JKLM)를 넣으십시오.');
  const [r] = await db.query<any>(PUB + ` WHERE s.receipt_hash = $1`, [receiptKey(code)]);
  if (!r) throw new NotFound('그 접수 번호의 제안이 없습니다.');
  return dress(r);
}

/** GET /admin/its/suggestions?state=&q= — 검토(ADMIN · SUPER) · 익명은 쓴 사람 「익명」(저장된 것이 없음) */
export async function reviewList(db: DatabaseService, stateIn?: string, qIn?: string) {
  const state = (SUGGEST_STATES as readonly string[]).includes(stateIn ?? '') ? String(stateIn) : stateIn === 'ALL' ? 'ALL' : 'OPEN';
  const q = clean(qIn).slice(0, 40);
  const rows = await db.query<any>(
    `SELECT s.id::text AS id, s.category, s.title, s.is_anon AS "isAnon", s.created_on::text AS "createdOn", s.state, s.answered_at AS "answeredAt",
            CASE WHEN s.is_anon THEN NULL ELSE coalesce(a.name, a.email) END AS author
       FROM its_suggestions s LEFT JOIN accounts a ON a.id = s.author_id
      WHERE ($1 = 'ALL' OR ($1 = 'OPEN' AND s.state IN ('RECEIVED', 'REVIEWING', 'ADOPTED')) OR s.state = $1)
        AND ($2 = '' OR s.title ILIKE '%' || $2 || '%')
      ORDER BY (s.state = 'RECEIVED') DESC, s.created_on DESC, s.title LIMIT 500`, [state, q]);
  const counts = await db.query<{ state: string; n: number }>(`SELECT state, count(*)::int AS n FROM its_suggestions GROUP BY state`);
  return { state, items: rows.map(dress), counts: Object.fromEntries(SUGGEST_STATES.map((s) => [s, counts.find((c) => c.state === s)?.n ?? 0])),
           states: SUGGEST_STATE_KO, categories: SUGGEST_CATEGORY_KO,
           note: '익명 제안은 쓴 사람 · 넣은 시각이 저장되지 않습니다(날짜만). 채택 · 반영 안 함 · 실행 끝은 답변을 적어야 하고, 쓴 사람은 「내 제안」 · 접수 번호로 답변을 봅니다.' };
}

async function load(db: DatabaseService, id: string, lock = false) {
  if (!UUID.test(String(id ?? ''))) throw new NotFound('제안이 없습니다.');
  const [r] = await db.query<any>(
    `SELECT s.id::text AS id, s.category, s.title, s.body, s.is_anon AS "isAnon", s.created_on::text AS "createdOn", s.state, s.answer, s.answered_at AS "answeredAt",
            CASE WHEN s.is_anon THEN NULL ELSE coalesce(a.name, a.email) END AS author, coalesce(b.name, b.email) AS "answeredBy"
       FROM its_suggestions s LEFT JOIN accounts a ON a.id = s.author_id LEFT JOIN accounts b ON b.id = s.answered_by
      WHERE s.id = $1::uuid` + (lock ? ' FOR UPDATE OF s' : ''), [id]);
  if (!r) throw new NotFound('제안이 없습니다.');
  return r;
}

/** GET /admin/its/suggestions/{id} — 내용 · 검토 기록 · 옮길 수 있는 상태 */
export async function suggestionDetail(db: DatabaseService, id: string) {
  const r = await load(db, id);
  const log = await db.query(
    `SELECT l.id::text AS id, l.from_state AS "from", l.to_state AS "to", l.note, l.at, coalesce(a.name, a.email) AS actor
       FROM its_suggestion_log l LEFT JOIN accounts a ON a.id = l.actor WHERE l.suggestion_id = $1::uuid ORDER BY l.id LIMIT 200`, [r.id]);
  return { ...dress(r), log, next: (NEXT[r.state] ?? []).map((s) => ({ state: s, label: SUGGEST_STATE_KO[s], needAnswer: NEED_ANSWER.includes(s) })) };
}

/** POST /admin/its/suggestions/{id}/decide — 상태 옮김 · 답변(검토한 사람만 남음) */
export async function decideSuggestion(db: DatabaseService, id: string, b: { to?: string; answer?: string | null }, actor: string) {
  const to = String(b.to ?? '');
  if (!(SUGGEST_STATES as readonly string[]).includes(to)) throw new PolicyViolation('ITS_SUGGEST_STATE', '옮길 상태를 고르십시오.');
  const ans = b.answer == null ? '' : String(b.answer).trim();
  if (ans && (ans.length < 2 || ans.length > 2000)) throw new PolicyViolation('ITS_SUGGEST_ANSWER', '답변은 2 ~ 2000자입니다.');
  return db.transaction(async () => {
    const r = await load(db, id, true);
    if (!(NEXT[r.state] ?? []).includes(to)) throw new StateConflict('ITS_SUGGEST_STATE', `「${SUGGEST_STATE_KO[r.state] ?? r.state}」에서 「${SUGGEST_STATE_KO[to] ?? to}」로는 옮길 수 없습니다.`);
    const answer = ans || r.answer || '';
    if (NEED_ANSWER.includes(to) && !answer) throw new PolicyViolation('ITS_SUGGEST_ANSWER', '채택 · 반영 안 함 · 실행 끝은 답변을 적어야 합니다.');
    await db.query(
      `UPDATE its_suggestions SET state = $2, answer = CASE WHEN $3 = '' THEN answer ELSE $3 END,
              answered_at = CASE WHEN $3 = '' THEN answered_at ELSE now() END, answered_by = CASE WHEN $3 = '' THEN answered_by ELSE $4::uuid END
        WHERE id = $1::uuid`, [r.id, to, ans, actor]);
    await db.query(`INSERT INTO its_suggestion_log (suggestion_id, from_state, to_state, note, actor) VALUES ($1::uuid, $2, $3, $4, $5::uuid)`,
      [r.id, r.state, to, ans || null, actor]);
    return { ok: true, id: r.id, state: to, note: `「${SUGGEST_STATE_KO[to]}」로 옮겼습니다.` };
  });
}

/** 정기 작업(its_office_daily) 한 몫 — 「접수」 그대로인 수 → ITS_SUGGEST_WAITING(하루 하나 · 제목 · 쓴 사람 없이) · 0 이거나 꺼지면 풀림 */
export async function itsSuggestWaitingJob(db: DatabaseService) {
  const on = await switchOn(db, 'its.suggest_alert');
  const [c] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM its_suggestions WHERE state = 'RECEIVED'`);
  const n = on ? c?.n ?? 0 : 0;
  const day = kstToday();
  const resolved = await db.query(
    `UPDATE ops_alerts SET resolved_at = now(), resolve_note = '검토 시작 · 날 바뀜 · 알림 꺼짐'
      WHERE alert_code = 'ITS_SUGGEST_WAITING' AND resolved_at IS NULL AND ($1::int = 0 OR coalesce(detail->>'day', '') <> $2) RETURNING id`, [n, day]);
  let made = 0;
  if (n > 0) {
    const r = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'ITS_SUGGEST_WAITING', 'INFO', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ITS_SUGGEST_WAITING' AND detail->>'day' = $3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [`검토를 기다리는 제안 ${n}건 — 사무 › 제안함`, JSON.stringify({ day, count: n }), day]);
    made = r.length;
  }
  return { on, waiting: n, made, resolved: resolved.length };
}
