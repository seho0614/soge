import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { clean, dayOrNull, filesOk, idOk, kstToday, reasonOk } from './lgl-common';

/* ---------------------------------------------------------------------
 * ㊴ 법무 (D269 · docs/626) — v10.488 소송 · 분쟁 사건 대장 · 대표 11/20
 *   회사가 당사자인 사건만(회원끼리 거래 분쟁은 거래 › 분쟁).
 *   사건 — 번호 · 종류(민사 · 형사 · 행정 · 노동 · 조정 · 소비자 · 그 밖) · 우리 쪽 · 상대 · 기관 · 대리인 · 소가 · 서류(LGL_DOC 10개) · 메모.
 *   기일 — 변론 · 기한 · 조정 · 그 밖 · 예정 → 끝남(결과 한 줄) · 취소 · 7 · 1일 전(lgl.hearing_alert_days) 운영 알림 LGL_HEARING_DUE.
 *   비용 — 대리인 보수 · 인지 · 송달료 · 공탁 · 그 밖 · 경비 청구(⑫) 또는 매입 전표 하나에 연결(전표는 그 화면이 만듦 · 같은 전표 두 번 연결 막음) · 무효만.
 *   결과 — 이김 · 짐 · 일부 · 합의 · 취하 · 각하 · 그 밖 · 끝내면 되돌리지 않음 · 남은 예정 기일은 함께 취소.
 * ------------------------------------------------------------------- */

export const CASE_KINDS = ['CIVIL', 'CRIMINAL', 'ADMIN', 'LABOR', 'MEDIATION', 'CONSUMER', 'ETC'] as const;
export const CASE_SIDES = ['PLAINTIFF', 'DEFENDANT', 'APPLICANT', 'RESPONDENT', 'ETC'] as const;
export const CASE_RESULTS = ['WIN', 'LOSE', 'PARTIAL', 'SETTLED', 'WITHDRAWN', 'DISMISSED', 'ETC'] as const;
export const HEARING_KINDS = ['HEARING', 'DEADLINE', 'MEDIATION', 'ETC'] as const;
export const COST_KINDS = ['COUNSEL', 'STAMP', 'SERVICE', 'DEPOSIT', 'ETC'] as const;
export const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

const inList = (v: string | undefined, list: readonly string[], dflt: string) => (list.includes(v ?? '') ? v! : dflt);
const amountOk = (v: number | null | undefined, max: number, field: string) => {
  if (v === undefined || v === null) return v ?? null;
  if (!Number.isInteger(v) || v < 0 || v > max) throw new PolicyViolation('LGL_AMOUNT', `${field}이(가) 바르지 않습니다.`);
  return v;
};
/** 기일 시각 — 시간대 없으면 한국 시각으로 봄 */
function atOk(v: string | undefined) {
  if (!v || !AT_RE.test(v)) throw new PolicyViolation('LGL_HEARING_AT', '기일 시각(YYYY-MM-DDTHH:MM)이 바르지 않습니다.');
  const s = /Z|[+-]\d{2}:\d{2}$/.test(v) ? v : `${v}+09:00`;
  if (Number.isNaN(Date.parse(s))) throw new PolicyViolation('LGL_HEARING_AT', '기일 시각(YYYY-MM-DDTHH:MM)이 바르지 않습니다.');
  return new Date(s).toISOString();
}

/** GET /admin/legal/cases?state= — 사건 목록 · 다음 기일 · 비용 합 */
export async function caseBoard(db: DatabaseService, stateIn?: string) {
  const state = ['OPEN', 'CLOSED'].includes(stateIn ?? '') ? stateIn! : null;
  const items = await db.query<Record<string, unknown>>(
    `SELECT c.id::text AS id, c.case_ref AS "caseRef", c.title, c.kind, c.our_side AS "ourSide", c.counterparty, c.forum, c.counsel,
            c.claim_amount::bigint AS "claimAmount", c.opened_on::text AS "openedOn", c.state, c.result, c.closed_on::text AS "closedOn",
            (SELECT min(h.held_at) FROM lgl_case_hearings h WHERE h.case_id = c.id AND h.state = 'PLANNED' AND h.held_at >= now() - interval '1 day') AS "nextAt",
            (SELECT count(*)::int FROM lgl_case_hearings h WHERE h.case_id = c.id AND h.state = 'PLANNED' AND h.held_at < now()) AS "pastPlanned",
            (SELECT coalesce(sum(x.amount), 0)::bigint FROM lgl_case_costs x WHERE x.case_id = c.id AND x.state = 'ACTIVE') AS "costTotal"
       FROM lgl_cases c WHERE ($1::text IS NULL OR c.state = $1::text)
      ORDER BY (c.state = 'CLOSED'), "nextAt" NULLS LAST, c.id DESC LIMIT 300`, [state]);
  const upcoming = await db.query(
    `SELECT h.id::text AS id, h.case_id::text AS "caseId", c.title, h.held_at AS "heldAt", h.kind, h.place
       FROM lgl_case_hearings h JOIN lgl_cases c ON c.id = h.case_id
      WHERE h.state = 'PLANNED' AND h.held_at >= now() AND h.held_at < now() + interval '60 days' ORDER BY h.held_at LIMIT 50`);
  return {
    items: items.map((x) => ({ ...x, claimAmount: x.claimAmount == null ? null : Number(x.claimAmount), costTotal: Number(x.costTotal ?? 0) })),
    upcoming, kinds: CASE_KINDS, sides: CASE_SIDES, results: CASE_RESULTS, hearingKinds: HEARING_KINDS, costKinds: COST_KINDS,
    note: '회사가 당사자인 사건만 넣습니다(회원끼리 거래 분쟁은 거래 › 분쟁). 기일 7 · 1일 전에 운영 알림(LGL_HEARING_DUE)이 뜨고 사내 일정에도 보입니다.',
  };
}

export async function caseOne(db: DatabaseService, id: string) {
  const [c] = await db.query<Record<string, unknown>>(
    `SELECT c.id::text AS id, c.case_ref AS "caseRef", c.title, c.kind, c.our_side AS "ourSide", c.counterparty, c.forum, c.counsel,
            c.claim_amount::bigint AS "claimAmount", c.opened_on::text AS "openedOn", c.file_ids::text[] AS "fileIds", c.memo, c.state, c.result,
            c.result_note AS "resultNote", c.closed_on::text AS "closedOn", c.created_at AS "createdAt"
       FROM lgl_cases c WHERE c.id = $1::bigint`, [idOk(id, '사건')]);
  if (!c) throw new NotFound('없는 사건입니다.');
  const hearings = await db.query(
    `SELECT id::text AS id, held_at AS "heldAt", kind, place, note, state, outcome FROM lgl_case_hearings WHERE case_id = $1::bigint ORDER BY held_at`, [id]);
  const costs = await db.query<Record<string, unknown>>(
    `SELECT x.id::text AS id, x.kind, x.amount::bigint AS amount, x.paid_on::text AS "paidOn", x.expense_claim_id::text AS "expenseClaimId", x.purchase_id::text AS "purchaseId",
            e.state AS "claimState", p.state AS "purchaseState", x.note, x.state, x.void_reason AS "voidReason", x.created_at AS "createdAt"
       FROM lgl_case_costs x LEFT JOIN acct_expense_claims e ON e.id = x.expense_claim_id LEFT JOIN acct_purchases p ON p.id = x.purchase_id
      WHERE x.case_id = $1::bigint ORDER BY x.id`, [id]);
  return { case: { ...c, claimAmount: c.claimAmount == null ? null : Number(c.claimAmount) }, hearings,
           costs: costs.map((x) => ({ ...x, amount: Number(x.amount) })), costTotal: costs.filter((x) => x.state === 'ACTIVE').reduce((a, x) => a + Number(x.amount), 0) };
}

export interface CaseInput { caseRef?: string; title?: string; kind?: string; ourSide?: string; counterparty?: string; forum?: string; counsel?: string; claimAmount?: number | null; openedOn?: string; fileIds?: string[]; memo?: string }

/** POST /admin/legal/cases — 사건 넣기 */
export async function addCase(db: DatabaseService, b: CaseInput, actor: string | null) {
  const title = clean(b.title, 100);
  if (!title || title.length < 2) throw new PolicyViolation('LGL_TITLE', '사건 이름은 2 ~ 100자입니다.');
  const opened = dayOrNull(b.openedOn, '시작일') ?? kstToday();
  if (opened > kstToday()) throw new PolicyViolation('LGL_DATE', '시작일은 오늘까지입니다.');
  const files = await filesOk(db, b.fileIds, 10);
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO lgl_cases (case_ref, title, kind, our_side, counterparty, forum, counsel, claim_amount, opened_on, file_ids, memo, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::bigint, $9::date, $10::uuid[], $11, $12::uuid) RETURNING id::text AS id`,
    [clean(b.caseRef, 60), title, inList(b.kind, CASE_KINDS, 'CIVIL'), inList(b.ourSide, CASE_SIDES, 'DEFENDANT'), clean(b.counterparty, 120), clean(b.forum, 100),
     clean(b.counsel, 120), amountOk(b.claimAmount, 1_000_000_000_000, '소가'), opened, files, clean(b.memo, 2000), actor]);
  return { ok: true, id: r!.id, note: `사건 「${title}」을(를) 대장에 넣었습니다 — 기일 · 비용을 이어서 넣으십시오.` };
}

async function lockCase(db: DatabaseService, id: string) {
  const [c] = await db.query<{ id: string; state: string; title: string; openedOn: string }>(
    `SELECT id::text AS id, state, title, opened_on::text AS "openedOn" FROM lgl_cases WHERE id = $1::bigint FOR UPDATE`, [idOk(id, '사건')]);
  if (!c) throw new NotFound('없는 사건입니다.');
  return c;
}

/** PUT /admin/legal/cases/{id} — 번호 · 우리 쪽 · 상대 · 기관 · 대리인 · 소가 · 서류 · 메모(종류 · 시작일은 못 바꿈 · 끝낸 것 못 고침) */
export async function updateCase(db: DatabaseService, id: string, b: CaseInput) {
  return db.transaction(async () => {
    const c = await lockCase(db, id);
    if (c.state !== 'OPEN') throw new StateConflict('LGL_CASE_STATE', '끝낸 사건은 고치지 않습니다.');
    const title = b.title === undefined ? undefined : clean(b.title, 100);
    if (title !== undefined && (!title || title.length < 2)) throw new PolicyViolation('LGL_TITLE', '사건 이름은 2 ~ 100자입니다.');
    const files = b.fileIds === undefined ? null : await filesOk(db, b.fileIds, 10);
    await db.query(
      `UPDATE lgl_cases SET title = coalesce($2, title), case_ref = CASE WHEN $3::boolean THEN $4 ELSE case_ref END,
              our_side = coalesce($5, our_side), counterparty = CASE WHEN $6::boolean THEN $7 ELSE counterparty END,
              forum = CASE WHEN $8::boolean THEN $9 ELSE forum END, counsel = CASE WHEN $10::boolean THEN $11 ELSE counsel END,
              claim_amount = CASE WHEN $12::boolean THEN $13::bigint ELSE claim_amount END, file_ids = coalesce($14::uuid[], file_ids),
              memo = CASE WHEN $15::boolean THEN $16 ELSE memo END
        WHERE id = $1::bigint`,
      [c.id, title ?? null, b.caseRef !== undefined, clean(b.caseRef, 60), b.ourSide === undefined ? null : inList(b.ourSide, CASE_SIDES, 'ETC'),
       b.counterparty !== undefined, clean(b.counterparty, 120), b.forum !== undefined, clean(b.forum, 100), b.counsel !== undefined, clean(b.counsel, 120),
       b.claimAmount !== undefined, amountOk(b.claimAmount, 1_000_000_000_000, '소가'), files, b.memo !== undefined, clean(b.memo, 2000)]);
    return { ok: true, id: c.id, note: '사건을 고쳤습니다.' };
  });
}

/** POST /admin/legal/cases/{id}/hearings — 기일 넣기 */
export async function addHearing(db: DatabaseService, id: string, b: { at?: string; kind?: string; place?: string; note?: string }, actor: string | null) {
  const at = atOk(b.at);
  return db.transaction(async () => {
    const c = await lockCase(db, id);
    if (c.state !== 'OPEN') throw new StateConflict('LGL_CASE_STATE', '끝낸 사건에는 기일을 넣지 않습니다.');
    const [h] = await db.query<{ id: string }>(
      `INSERT INTO lgl_case_hearings (case_id, held_at, kind, place, note, created_by) VALUES ($1::bigint, $2::timestamptz, $3, $4, $5, $6::uuid) RETURNING id::text AS id`,
      [c.id, at, inList(b.kind, HEARING_KINDS, 'HEARING'), clean(b.place, 100), clean(b.note, 400), actor]);
    return { ok: true, id: h!.id, note: `「${c.title}」에 기일을 넣었습니다 — 며칠 전에 운영 알림이 뜹니다.` };
  });
}

/** PUT /admin/legal/hearings/{id} — 기일 고치기 · 끝남(결과 한 줄) · 취소(예정일 때만 · 되돌리지 않음) */
export async function updateHearing(db: DatabaseService, id: string, b: { at?: string; kind?: string; place?: string; note?: string; state?: string; outcome?: string }) {
  idOk(id, '기일');
  const at = b.at === undefined ? null : atOk(b.at);
  if (b.state !== undefined && !['PLANNED', 'DONE', 'CANCELED'].includes(b.state)) throw new PolicyViolation('LGL_HEARING_STATE', '기일 상태는 예정 · 끝남 · 취소 중 하나입니다.');
  return db.transaction(async () => {
    const [h] = await db.query<{ state: string; caseState: string }>(
      `SELECT h.state, c.state AS "caseState" FROM lgl_case_hearings h JOIN lgl_cases c ON c.id = h.case_id WHERE h.id = $1::bigint FOR UPDATE OF h`, [id]);
    if (!h) throw new NotFound('없는 기일입니다.');
    if (h.state !== 'PLANNED') throw new StateConflict('LGL_HEARING_STATE', '끝남 · 취소한 기일은 고치지 않습니다.');
    if (h.caseState !== 'OPEN') throw new StateConflict('LGL_CASE_STATE', '끝낸 사건의 기일은 고치지 않습니다.');
    await db.query(
      `UPDATE lgl_case_hearings SET held_at = coalesce($2::timestamptz, held_at), kind = coalesce($3, kind), place = CASE WHEN $4::boolean THEN $5 ELSE place END,
              note = CASE WHEN $6::boolean THEN $7 ELSE note END, state = coalesce($8, state), outcome = CASE WHEN $9::boolean THEN $10 ELSE outcome END
        WHERE id = $1::bigint`,
      [id, at, b.kind === undefined ? null : inList(b.kind, HEARING_KINDS, 'ETC'), b.place !== undefined, clean(b.place, 100), b.note !== undefined, clean(b.note, 400),
       b.state ?? null, b.outcome !== undefined, clean(b.outcome, 400)]);
    if ((b.state && b.state !== 'PLANNED') || at) {
      await db.query(
        `UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2
          WHERE alert_code = 'LGL_HEARING_DUE' AND resolved_at IS NULL AND left(detail->>'key', char_length($1::text)) = $1::text`,
        [`HEAR:${id}:`, b.state === 'DONE' ? '기일 끝남' : b.state === 'CANCELED' ? '기일 취소' : '기일 바뀜']);
    }
    return { ok: true, id, state: b.state ?? 'PLANNED', note: b.state === 'DONE' ? '기일을 끝남으로 적었습니다.' : b.state === 'CANCELED' ? '기일을 취소했습니다.' : '기일을 고쳤습니다.' };
  });
}

/** POST /admin/legal/cases/{id}/costs — 비용 줄(경비 청구 또는 매입 하나에 연결 · 둘 다 아니면 메모만) */
export async function addCost(db: DatabaseService, id: string, b: { kind?: string; amount?: number; paidOn?: string; expenseClaimId?: string; purchaseId?: string; note?: string }, actor: string | null) {
  if (!Number.isInteger(b.amount) || (b.amount as number) <= 0 || (b.amount as number) > 10_000_000_000) throw new PolicyViolation('LGL_AMOUNT', '금액은 1원 ~ 100억 원 정수입니다.');
  const paid = dayOrNull(b.paidOn, '낸 날');
  if (!paid || paid > kstToday()) throw new PolicyViolation('LGL_DATE', '낸 날이 바르지 않습니다(오늘까지).');
  if (b.expenseClaimId && b.purchaseId) throw new PolicyViolation('LGL_COST_LINK', '경비 청구와 매입 중 하나만 연결합니다.');
  const claim = b.expenseClaimId ? idOk(b.expenseClaimId, '경비 청구') : null;
  const purchase = b.purchaseId ? idOk(b.purchaseId, '매입') : null;
  if (claim) {
    const [e] = await db.query<{ state: string }>(`SELECT state FROM acct_expense_claims WHERE id = $1::bigint`, [claim]);
    if (!e) throw new PolicyViolation('LGL_COST_LINK', '없는 경비 청구입니다.');
    if (!['REQUESTED', 'APPROVED', 'PAID'].includes(e.state)) throw new PolicyViolation('LGL_COST_LINK', '반려 · 취소한 경비 청구에는 연결하지 않습니다.');
  }
  if (purchase) {
    const [p] = await db.query<{ state: string }>(`SELECT state FROM acct_purchases WHERE id = $1::bigint`, [purchase]);
    if (!p) throw new PolicyViolation('LGL_COST_LINK', '없는 매입입니다.');
    if (p.state !== 'ACTIVE') throw new PolicyViolation('LGL_COST_LINK', '취소한 매입에는 연결하지 않습니다.');
  }
  return db.transaction(async () => {
    const c = await lockCase(db, id);
    const [dup] = await db.query(
      `SELECT 1 FROM lgl_case_costs WHERE state = 'ACTIVE' AND (($1::bigint IS NOT NULL AND expense_claim_id = $1::bigint) OR ($2::bigint IS NOT NULL AND purchase_id = $2::bigint))`, [claim, purchase]);
    if (dup) throw new StateConflict('LGL_COST_DUP', '그 전표는 이미 다른 사건 비용에 연결했습니다.');
    const [x] = await db.query<{ id: string }>(
      `INSERT INTO lgl_case_costs (case_id, kind, amount, paid_on, expense_claim_id, purchase_id, note, created_by)
       VALUES ($1::bigint, $2, $3::bigint, $4::date, $5::bigint, $6::bigint, $7, $8::uuid) RETURNING id::text AS id`,
      [c.id, inList(b.kind, COST_KINDS, 'ETC'), b.amount, paid, claim, purchase, clean(b.note, 200), actor]);
    return { ok: true, id: x!.id, note: `「${c.title}」 비용 ${Number(b.amount).toLocaleString('ko-KR')}원을 넣었습니다${claim || purchase ? '(전표 연결)' : ' — 전표는 회계 › 경비 청구 · 매입에서 올리고 연결하십시오'}.` };
  });
}

/** POST /admin/legal/costs/{id}/void — 비용 줄 무효(사유) */
export async function voidCost(db: DatabaseService, id: string, reasonIn: string) {
  idOk(id, '비용 줄');
  const reason = reasonOk(reasonIn);
  const r = await db.query(`UPDATE lgl_case_costs SET state = 'VOID', void_reason = $2 WHERE id = $1::bigint AND state = 'ACTIVE' RETURNING id`, [id, reason]);
  if (!r.length) {
    const [x] = await db.query(`SELECT 1 FROM lgl_case_costs WHERE id = $1::bigint`, [id]);
    if (!x) throw new NotFound('없는 비용 줄입니다.');
    throw new StateConflict('LGL_COST_STATE', '이미 무효한 비용 줄입니다.');
  }
  return { ok: true, id, note: '비용 줄을 무효로 했습니다(기록은 남음 · 연결했던 전표는 그대로).' };
}

/** POST /admin/legal/cases/{id}/close — 결과 적고 끝냄(되돌리지 않음 · 남은 예정 기일 취소) */
export async function closeCase(db: DatabaseService, id: string, b: { result?: string; resultNote?: string; closedOn?: string }) {
  if (!(CASE_RESULTS as readonly string[]).includes(b.result ?? '')) throw new PolicyViolation('LGL_CASE_RESULT', '결과를 고르십시오.');
  const closed = dayOrNull(b.closedOn, '끝난 날') ?? kstToday();
  if (closed > kstToday()) throw new PolicyViolation('LGL_DATE', '끝난 날은 오늘까지입니다.');
  return db.transaction(async () => {
    const c = await lockCase(db, id);
    if (c.state !== 'OPEN') throw new StateConflict('LGL_CASE_STATE', '이미 끝낸 사건입니다.');
    if (closed < c.openedOn) throw new PolicyViolation('LGL_DATE', '끝난 날이 시작일보다 앞입니다.');
    const left = await db.query(`UPDATE lgl_case_hearings SET state = 'CANCELED', outcome = coalesce(outcome, '사건 끝남') WHERE case_id = $1::bigint AND state = 'PLANNED' RETURNING id::text AS id`, [c.id]);
    await db.query(`UPDATE lgl_cases SET state = 'CLOSED', result = $2, result_note = $3, closed_on = $4::date WHERE id = $1::bigint`, [c.id, b.result, clean(b.resultNote, 1000), closed]);
    for (const h of left as Array<{ id: string }>) {
      await db.query(
        `UPDATE ops_alerts SET resolved_at = now(), resolve_note = '사건 끝남'
          WHERE alert_code = 'LGL_HEARING_DUE' AND resolved_at IS NULL AND left(detail->>'key', char_length($1::text)) = $1::text`, [`HEAR:${h.id}:`]);
    }
    return { ok: true, id: c.id, canceledHearings: left.length, note: `「${c.title}」을(를) 끝냈습니다${left.length ? ` — 남은 예정 기일 ${left.length}개는 취소` : ''}.` };
  });
}
