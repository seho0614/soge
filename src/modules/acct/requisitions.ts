import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { assertStepsDone, recordFinal } from './approval';   // v10.424 (D253) 결재선

/* ---------------------------------------------------------------------
 * v10.410 (D249 · docs/547) 품의 · 전자결재
 *   쓰기 전에 지출 품의(운영자 누구나 · 제목 · 금액 · 계정 · 사유 · 쓸 날) → SUPER 결재(승인 · 반려 · 본인 품의 불가 — DB 가 막음)
 *   → 승인된 품의를 ⑫ 매입(acct_purchases) 또는 경비 청구(acct_expense_claims) 하나에 「씀」으로 연결(SUPER · PAYOUT).
 *   연결 금액(매입 합계 · 경비 금액)이 품의 금액 × (1 + acct.req_tolerance_pct%) 를 넘으면 막음 — 다시 품의.
 *   품의 하나에 매입 · 경비 하나(같은 매입 · 경비를 두 품의에 못 씀 · DB 고유 색인) · 상태 앞으로만 · 내용 고치지 않음 · 지우지 않음.
 *   목록 — SUPER · PAYOUT 은 모두, 나머지 운영자는 자기 것만.
 * ------------------------------------------------------------------- */

export const REQ_STATE_KO: Record<string, string> = { REQUESTED: '결재 기다림', APPROVED: '승인', REJECTED: '반려', USED: '씀', CANCELED: '취소' };
const n = (v: unknown) => Number(v ?? 0);
const has = async (db: DatabaseService, t: string) => (await db.query<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${t}`]))[0]?.ok === true;
const isDay = (d?: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const rejectNote = (r: string | undefined) => {
  const t = (r ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('REQ_REASON', '반려 사유는 2 ~ 200자입니다.');
  return t;
};

export interface ReqInput { title: string; amount: number; accountRole: string; reason: string; neededOn?: string }

/** POST /admin/acct/requisitions — 운영자 누구나 */
export async function addRequisition(db: DatabaseService, b: ReqInput, actor: string | null) {
  if (!actor) throw new Forbidden('REQ_LOGIN', '로그인이 필요합니다.');
  const title = (b.title ?? '').replace(/\s+/g, ' ').trim();
  if (title.length < 2 || title.length > 100) throw new PolicyViolation('REQ_TITLE', '품의 제목은 2 ~ 100자입니다.');
  const amount = Math.round(Number(b.amount));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000_000) throw new PolicyViolation('REQ_AMOUNT', '품의 금액은 1원 ~ 100억 원입니다.');
  const reason = (b.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 400) throw new PolicyViolation('REQ_REASON', '품의 사유는 2 ~ 400자입니다.');
  if (b.neededOn && !isDay(b.neededOn)) throw new PolicyViolation('REQ_DATE', '쓸 날(YYYY-MM-DD)이 맞지 않습니다.');
  const [acc] = await db.query<{ kind: string }>(`SELECT kind FROM acct_accounts WHERE role = $1`, [b.accountRole]);
  if (!acc || !['EXPENSE', 'ASSET'].includes(acc.kind) || ['CASH', 'PG_RECV', 'AR', 'VAT_IN'].includes(b.accountRole)) throw new PolicyViolation('REQ_ACCOUNT', '비용 또는 자산 계정을 고르십시오.');
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO acct_requisitions (requester, title, amount, account_role, reason, needed_on) VALUES ($1, $2, $3::bigint, $4, $5, $6::date) RETURNING id::text AS id`,
    [actor, title, amount, b.accountRole, reason, b.neededOn || null]);
  return { ok: true, id: r!.id, note: '품의를 올렸습니다 — SUPER 결재를 기다립니다.' };
}

async function load(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 품의입니다.');
  const [r] = await db.query<{ id: string; requester: string; state: string; amount: string; account_role: string }>(
    `SELECT id::text AS id, requester::text AS requester, state, amount::text AS amount, account_role FROM acct_requisitions WHERE id = $1::bigint`, [id]);
  if (!r) throw new NotFound('없는 품의입니다.');
  return r;
}

/** POST /admin/acct/requisitions/{id}/decide — SUPER · 승인 · 반려(사유) · 본인 불가 */
export async function decideRequisition(db: DatabaseService, id: string, approve: boolean, note: string | undefined, actor: string | null) {
  const r = await load(db, id);
  if (r.state !== 'REQUESTED') throw new StateConflict('REQ_STATE', '결재를 기다리는 품의가 아닙니다.');
  if (actor && r.requester === actor) throw new PolicyViolation('REQ_SELF', '본인 품의는 결재할 수 없습니다.');
  const t = approve ? ((note ?? '').trim().slice(0, 200) || null) : rejectNote(note);
  if (approve) await assertStepsDone(db, 'REQ', id);   // v10.424 (D253) — 결재선이 있으면 앞 단계가 끝나야 승인
  await db.transaction(async () => {   // 상태 바꿈 · 결재 기록을 한 거래로(기록이 막히면 상태도 그대로)
    await db.query(`UPDATE acct_requisitions SET state = $2, decided_by = $3, decided_at = now(), decide_note = $4 WHERE id = $1::bigint AND state = 'REQUESTED'`,
      [id, approve ? 'APPROVED' : 'REJECTED', actor, t]);
    await recordFinal(db, 'REQ', id, actor, approve, t);   // v10.424 — 결재선이 있으면 마지막 줄
  });
  return { ok: true, id, state: approve ? 'APPROVED' : 'REJECTED', note: approve ? '품의를 승인했습니다 — 매입 · 경비 청구에 연결할 수 있습니다.' : '품의를 반려했습니다.' };
}

/** POST /admin/acct/requisitions/{id}/cancel — 올린 사람(결재 전 · 승인 뒤 쓰기 전) 또는 SUPER */
export async function cancelRequisition(db: DatabaseService, id: string, actor: string | null) {
  const r = await load(db, id);
  const [me] = actor ? await db.query<{ sup: boolean }>(`SELECT fn_has_role($1::uuid, 'SUPER') AS sup`, [actor]) : [];
  const isSuper = me?.sup === true;
  if (!isSuper && r.requester !== actor) throw new Forbidden('REQ_OWNER', '본인 품의만 취소할 수 있습니다.');
  if (!['REQUESTED', 'APPROVED'].includes(r.state)) throw new StateConflict('REQ_STATE', '취소할 수 없는 품의입니다(반려 · 씀 · 취소).');
  await db.query(`UPDATE acct_requisitions SET state = 'CANCELED' WHERE id = $1::bigint AND state IN ('REQUESTED', 'APPROVED')`, [id]);
  return { ok: true, id, note: '품의를 취소했습니다.' };
}

/** POST /admin/acct/requisitions/{id}/use — 승인된 품의를 매입 · 경비 청구 하나에 연결(SUPER · PAYOUT) */
export async function useRequisition(db: DatabaseService, id: string, kind: string, refId: string, actor: string | null) {
  const r = await load(db, id);
  if (r.state !== 'APPROVED') throw new StateConflict('REQ_STATE', '승인된 품의만 연결합니다.');
  if (!['PURCHASE', 'EXPENSE'].includes(kind)) throw new PolicyViolation('REQ_USE', '연결할 것(매입 · 경비 청구)을 고르십시오.');
  if (!/^\d{1,18}$/.test(refId ?? '')) throw new PolicyViolation('REQ_USE', '매입 · 경비 청구 번호가 맞지 않습니다.');
  const table = kind === 'PURCHASE' ? 'acct_purchases' : 'acct_expense_claims';
  if (!(await has(db, table))) throw new PolicyViolation('REQ_USE', '매입 · 경비 청구 표가 아직 없습니다.');
  const [x] = kind === 'PURCHASE'
    ? await db.query<{ amt: string; ok: boolean }>(`SELECT total::text AS amt, state = 'ACTIVE' AS ok FROM acct_purchases WHERE id = $1::bigint`, [refId])
    : await db.query<{ amt: string; ok: boolean }>(`SELECT amount::text AS amt, state IN ('REQUESTED', 'APPROVED', 'PAID') AS ok FROM acct_expense_claims WHERE id = $1::bigint`, [refId]);
  if (!x) throw new PolicyViolation('REQ_USE', '없는 매입 · 경비 청구입니다.');
  if (!x.ok) throw new PolicyViolation('REQ_USE', '취소 · 반려된 매입 · 경비 청구에는 연결하지 않습니다.');
  const [st] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'acct.req_tolerance_pct'`);
  const tol = Math.min(50, Math.max(0, Number(st?.v ?? 10) || 0));
  const limit = Math.floor(n(r.amount) * (100 + tol) / 100);
  if (n(x.amt) > limit) throw new PolicyViolation('REQ_OVER', `품의 금액(${n(r.amount).toLocaleString('ko-KR')}원 · 허용 ${tol}%)보다 큽니다 — 다시 품의하십시오.`);
  const [dup] = await db.query<{ id: string }>(`SELECT id::text AS id FROM acct_requisitions WHERE used_kind = $1 AND used_ref = $2::bigint`, [kind, refId]);
  if (dup) throw new StateConflict('REQ_USED', `이미 다른 품의(${dup.id}번)에 연결한 것입니다.`);
  /* v10.417 (D251) — 매입 · 경비 쪽 requisition_id 로 붙임: 합계 한도 · USED 는 DB 트리거(fn_acct_req_link_guard · fn_acct_req_link_used) */
  const [linked] = await db.query<{ r: string | null }>(`SELECT requisition_id::text AS r FROM ${table} WHERE id = $1::bigint`, [refId]);
  if (linked?.r && linked.r !== String(id)) throw new StateConflict('REQ_USED', `이미 다른 품의(${linked.r}번)에 연결한 것입니다.`);
  if (!linked?.r) await db.query(`UPDATE ${table} SET requisition_id = $1::bigint WHERE id = $2::bigint AND requisition_id IS NULL`, [id, refId]);
  return { ok: true, id, usedAmount: n(x.amt), note: '품의를 연결했습니다.' };
}

/** GET /admin/acct/requisitions?state= — SUPER · PAYOUT 모두 · 나머지 자기 것 */
export async function listRequisitions(db: DatabaseService, actor: string | null, state?: string) {
  const [me] = actor ? await db.query<{ all: boolean; sup: boolean }>(`SELECT fn_has_role($1::uuid, 'PAYOUT') AS "all", fn_has_role($1::uuid, 'SUPER') AS sup`, [actor]) : [];
  const all = me?.all === true, canDecide = me?.sup === true;
  const items = await db.query(
    `SELECT r.id::text AS id, r.requester::text AS "requesterId", a.email AS requester, a.name AS "requesterName", r.title, r.amount::bigint AS amount,
            r.account_role AS "accountRole", ac.name AS "accountName", r.reason, r.needed_on::text AS "neededOn", r.state,
            d.email AS "decidedBy", r.decided_at AS "decidedAt", r.decide_note AS "decideNote",
            r.used_kind AS "usedKind", r.used_ref::text AS "usedRef", r.used_amount::bigint AS "usedAmount", r.used_at AS "usedAt", r.created_at AS "createdAt",
            sp.spent::bigint AS spent, sp.limit_amount::bigint AS "limitAmount", (sp.limit_amount - sp.spent)::bigint AS remaining, sp.links   -- v10.417 (D251)
       FROM acct_requisitions r JOIN accounts a ON a.id = r.requester JOIN acct_accounts ac ON ac.role = r.account_role LEFT JOIN accounts d ON d.id = r.decided_by
            LEFT JOIN v_acct_req_spend sp ON sp.id = r.id
      WHERE ($1::boolean OR r.requester = $2::uuid) AND ($3::text = '' OR r.state = $3)
      ORDER BY (r.state = 'REQUESTED') DESC, r.created_at DESC LIMIT 300`,
    [all, actor, Object.keys(REQ_STATE_KO).includes(state ?? '') ? state : '']);
  const accounts = await db.query(
    `SELECT role, name, kind FROM acct_accounts WHERE kind IN ('EXPENSE', 'ASSET') AND role <> ALL(ARRAY['CASH', 'PG_RECV', 'AR', 'VAT_IN']) ORDER BY kind DESC, sort, role`);
  const [st] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'acct.req_tolerance_pct'`);
  return { items, accounts, states: REQ_STATE_KO, all, canDecide, me: actor, tolerancePct: Number(st?.v ?? 10),
           waiting: items.filter((x: any) => x.state === 'REQUESTED').length,
           note: '품의 → SUPER 결재(본인 품의 불가) → 승인된 품의를 매입 · 경비 청구에 연결합니다. 품의 금액보다 허용 비율 넘게 쓰면 다시 품의해야 합니다.' };
}
