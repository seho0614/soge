import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { clean, dayOrNull, filesOk, idOk, kstToday, rolesOf } from './lgl-common';

/* ---------------------------------------------------------------------
 * ㊴ 법무 (D269 · docs/625) — v10.487 계약 검토 요청 · 대표 11/20
 *   요청(운영 관리자 · 계약서 파일 LGL_DOC 1 ~ 5개 · 종류 새 계약 · 갱신 · 변경 · 해지 · 상대 · 금액 · 검토 희망일 · ⑯ 기존 계약 연결 가능)
 *   → 검토 의견(요청한 사람이 아닌 운영 관리자 · 위험 낮음 · 보통 · 높음 · 외부 변호사 의견 옮김 표시 · 수정본 파일 3개 · 쌓기만) → 상태 REVIEWED
 *   → 승인 · 반려(SUPER · 요청한 사람 아님 · 반려는 사유 · DB 가 막음) · 결정 전 취소(요청한 사람 · SUPER).
 *   승인 뒤 계약 대장(회계 › 매입 · 경비 › 계약)에 넣은 계약을 연결(한 번 · 바꾸지 않음).
 *   기존 결재선(approval.ts DOC_KINDS)에는 넣지 않음 — 돈이 나가는 문서가 아니고 fn_acct_doc_info 를 고치지 않으려고(docs/625 4절).
 * ------------------------------------------------------------------- */

export const REVIEW_KINDS = ['NEW', 'RENEW', 'CHANGE', 'TERMINATE'] as const;
export const REVIEW_RISKS = ['LOW', 'MID', 'HIGH'] as const;
export const REVIEW_STATES = ['REQUESTED', 'REVIEWED', 'APPROVED', 'REJECTED', 'CANCELED'] as const;

async function contractOk(db: DatabaseService, id: string | undefined) {
  if (!id) return null;
  idOk(id, '계약');
  const [c] = await db.query(`SELECT 1 FROM acct_contracts WHERE id = $1::bigint`, [id]);
  if (!c) throw new PolicyViolation('LGL_REVIEW_LINK', '계약 대장에 없는 계약입니다.');
  return id;
}

/** GET /admin/legal/reviews?state= — 요청 목록 · 의견 수 · 가장 높은 위험 · 늦음 · 계약 대장(연결 고르기용 최근 200) */
export async function reviewBoard(db: DatabaseService, stateIn?: string) {
  const state = (REVIEW_STATES as readonly string[]).includes(stateIn ?? '') ? stateIn! : null;
  const today = kstToday();
  const items = await db.query<Record<string, unknown> & { wantedOn: string | null; state: string }>(
    `SELECT r.id::text AS id, r.title, r.kind, r.counterparty, r.contract_id::text AS "contractId", c.title AS "contractTitle", r.amount::bigint AS amount,
            r.wanted_on::text AS "wantedOn", r.state, r.requested_by::text AS "requestedBy", coalesce(a.name, a.email) AS "requestedByName", r.created_at AS "createdAt",
            r.decided_at AS "decidedAt", r.decide_note AS "decideNote", coalesce(d.name, d.email) AS "decidedByName",
            (SELECT count(*)::int FROM lgl_review_opinions o WHERE o.review_id = r.id) AS opinions,
            (SELECT max(CASE o.risk WHEN 'HIGH' THEN 3 WHEN 'MID' THEN 2 ELSE 1 END) FROM lgl_review_opinions o WHERE o.review_id = r.id) AS "riskLevel"
       FROM lgl_contract_reviews r LEFT JOIN accounts a ON a.id = r.requested_by LEFT JOIN accounts d ON d.id = r.decided_by LEFT JOIN acct_contracts c ON c.id = r.contract_id
      WHERE ($1::text IS NULL OR r.state = $1::text)
      ORDER BY (r.state IN ('REQUESTED', 'REVIEWED')) DESC, r.wanted_on NULLS LAST, r.id DESC LIMIT 300`, [state]);
  const contracts = await db.query(`SELECT id::text AS id, title, state, end_on::text AS "endOn" FROM acct_contracts ORDER BY id DESC LIMIT 200`);
  return {
    items: items.map((x) => ({ ...x, amount: x.amount == null ? null : Number(x.amount), late: ['REQUESTED', 'REVIEWED'].includes(x.state) && !!x.wantedOn && x.wantedOn < today })),
    contracts, kinds: REVIEW_KINDS, risks: REVIEW_RISKS,
    waiting: items.filter((x) => ['REQUESTED', 'REVIEWED'].includes(x.state)).length,
    note: '요청한 사람이 아닌 운영자가 의견을 쓰고, SUPER(요청한 사람 아님)가 승인 · 반려합니다. 검토 희망일이 지나면 운영 알림(LGL_REVIEW_LATE)이 뜹니다.',
  };
}

export async function reviewOne(db: DatabaseService, id: string) {
  const [r] = await db.query(
    `SELECT r.id::text AS id, r.title, r.kind, r.counterparty, r.contract_id::text AS "contractId", c.title AS "contractTitle", c.state AS "contractState",
            r.amount::bigint AS amount, r.wanted_on::text AS "wantedOn", r.summary, r.file_ids::text[] AS "fileIds", r.state,
            r.requested_by::text AS "requestedBy", coalesce(a.name, a.email) AS "requestedByName", r.created_at AS "createdAt",
            r.decided_at AS "decidedAt", r.decide_note AS "decideNote", coalesce(d.name, d.email) AS "decidedByName"
       FROM lgl_contract_reviews r LEFT JOIN accounts a ON a.id = r.requested_by LEFT JOIN accounts d ON d.id = r.decided_by LEFT JOIN acct_contracts c ON c.id = r.contract_id
      WHERE r.id = $1::bigint`, [idOk(id, '검토 요청')]);
  if (!r) throw new NotFound('없는 검토 요청입니다.');
  const opinions = await db.query(
    `SELECT o.id::text AS id, o.risk, o.body, o.outside, o.file_ids::text[] AS "fileIds", coalesce(a.name, a.email) AS author, o.created_at AS "createdAt"
       FROM lgl_review_opinions o LEFT JOIN accounts a ON a.id = o.author WHERE o.review_id = $1::bigint ORDER BY o.id`, [id]);
  return { review: { ...r, amount: (r as { amount?: unknown }).amount == null ? null : Number((r as { amount?: unknown }).amount) }, opinions };
}

/** POST /admin/legal/reviews — 요청 */
export async function addReview(db: DatabaseService, b: { title?: string; kind?: string; counterparty?: string; contractId?: string; amount?: number; wantedOn?: string; summary?: string; fileIds?: string[] }, actor: string | null) {
  if (!actor) throw new Forbidden('LGL_ACTOR', '로그인한 운영자만 요청합니다.');
  const title = clean(b.title, 100);
  if (!title || title.length < 2) throw new PolicyViolation('LGL_TITLE', '계약 이름은 2 ~ 100자입니다.');
  const kind = (REVIEW_KINDS as readonly string[]).includes(b.kind ?? '') ? b.kind! : 'NEW';
  if (b.amount !== undefined && b.amount !== null && (!Number.isInteger(b.amount) || b.amount < 0 || b.amount > 100_000_000_000)) throw new PolicyViolation('LGL_AMOUNT', '금액은 0원 ~ 1,000억 원 정수입니다.');
  const wanted = dayOrNull(b.wantedOn, '검토 희망일');
  if (wanted && wanted < kstToday()) throw new PolicyViolation('LGL_DATE', '검토 희망일은 오늘부터입니다.');
  const contract = await contractOk(db, b.contractId);
  if (kind !== 'NEW' && !contract) throw new PolicyViolation('LGL_REVIEW_LINK', '갱신 · 변경 · 해지는 계약 대장의 계약을 고르십시오.');
  const files = await filesOk(db, b.fileIds, 5, 1);
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO lgl_contract_reviews (title, kind, counterparty, contract_id, amount, wanted_on, summary, file_ids, requested_by)
     VALUES ($1, $2, $3, $4::bigint, $5::bigint, $6::date, $7, $8::uuid[], $9::uuid) RETURNING id::text AS id`,
    [title, kind, clean(b.counterparty, 120), contract, b.amount ?? null, wanted, clean(b.summary, 2000), files, actor]);
  return { ok: true, id: r!.id, state: 'REQUESTED', note: `계약 검토 요청 「${title}」을(를) 올렸습니다 — 다른 운영자가 의견을 쓰고 SUPER 가 결정합니다.` };
}

async function lockReview(db: DatabaseService, id: string) {
  const [r] = await db.query<{ id: string; state: string; requestedBy: string; title: string }>(
    `SELECT id::text AS id, state, requested_by::text AS "requestedBy", title FROM lgl_contract_reviews WHERE id = $1::bigint FOR UPDATE`, [idOk(id, '검토 요청')]);
  if (!r) throw new NotFound('없는 검토 요청입니다.');
  return r;
}

/** POST /admin/legal/reviews/{id}/opinions — 검토 의견(요청한 사람 아님) · 첫 의견이면 REVIEWED */
export async function addOpinion(db: DatabaseService, id: string, b: { risk?: string; body?: string; outside?: boolean; fileIds?: string[] }, actor: string | null) {
  if (!actor) throw new Forbidden('LGL_ACTOR', '로그인한 운영자만 의견을 씁니다.');
  const body = (b.body ?? '').trim().slice(0, 4000);
  if (body.length < 2) throw new PolicyViolation('LGL_OPINION', '의견은 2 ~ 4000자입니다.');
  const risk = (REVIEW_RISKS as readonly string[]).includes(b.risk ?? '') ? b.risk! : 'MID';
  const files = await filesOk(db, b.fileIds, 3);
  return db.transaction(async () => {
    const r = await lockReview(db, id);
    if (r.requestedBy === actor) throw new Forbidden('LGL_SELF', '요청한 사람은 자기 요청에 검토 의견을 쓰지 않습니다.');
    if (!['REQUESTED', 'REVIEWED'].includes(r.state)) throw new StateConflict('LGL_REVIEW_STATE', '결정 · 취소한 요청에는 의견을 달지 않습니다.');
    const [o] = await db.query<{ id: string }>(
      `INSERT INTO lgl_review_opinions (review_id, author, risk, body, outside, file_ids) VALUES ($1::bigint, $2::uuid, $3, $4, $5::boolean, $6::uuid[]) RETURNING id::text AS id`,
      [r.id, actor, risk, body, b.outside === true, files]);
    if (r.state === 'REQUESTED') await db.query(`UPDATE lgl_contract_reviews SET state = 'REVIEWED' WHERE id = $1::bigint`, [r.id]);
    return { ok: true, id: o!.id, state: 'REVIEWED', note: `「${r.title}」에 검토 의견을 남겼습니다 — SUPER 가 승인 · 반려합니다.` };
  });
}

/** POST /admin/legal/reviews/{id}/decide — 승인 · 반려(SUPER · 요청한 사람 아님 · 의견 뒤) */
export async function decideReview(db: DatabaseService, id: string, b: { approve?: boolean; note?: string }, actor: string | null) {
  if (!actor || !(await rolesOf(db, actor)).includes('SUPER')) throw new Forbidden('LGL_ROLE', '계약 검토 승인 · 반려는 SUPER 만 합니다.');
  const note = clean(b.note, 400);
  if (b.approve !== true && (!note || note.length < 2)) throw new PolicyViolation('LGL_REASON', '반려는 사유를 2자 이상 적습니다.');
  return db.transaction(async () => {
    const r = await lockReview(db, id);
    if (r.requestedBy === actor) throw new Forbidden('LGL_SELF', '자기가 올린 검토 요청은 승인 · 반려하지 않습니다.');
    if (r.state === 'REQUESTED') throw new StateConflict('LGL_REVIEW_STATE', '검토 의견이 하나도 없습니다 — 의견을 먼저 받으십시오.');
    if (r.state !== 'REVIEWED') throw new StateConflict('LGL_REVIEW_STATE', '이미 결정 · 취소한 요청입니다.');
    const st = b.approve === true ? 'APPROVED' : 'REJECTED';
    await db.query(`UPDATE lgl_contract_reviews SET state = $2, decided_by = $3::uuid, decided_at = now(), decide_note = $4 WHERE id = $1::bigint`, [r.id, st, actor, note]);
    await db.query(
      `UPDATE ops_alerts SET resolved_at = now(), resolve_note = '결정'
        WHERE alert_code = 'LGL_REVIEW_LATE' AND resolved_at IS NULL AND detail->>'key' = $1::text`, [`REV:${r.id}`]);
    return { ok: true, id: r.id, state: st, note: st === 'APPROVED' ? '승인했습니다 — 계약을 맺으면 계약 대장에 넣고 여기서 연결하십시오.' : '반려했습니다.' };
  });
}

/** POST /admin/legal/reviews/{id}/cancel — 결정 전 취소(요청한 사람 · SUPER) */
export async function cancelReview(db: DatabaseService, id: string, actor: string | null) {
  const sup = (await rolesOf(db, actor)).includes('SUPER');
  return db.transaction(async () => {
    const r = await lockReview(db, id);
    if (r.requestedBy !== actor && !sup) throw new Forbidden('LGL_ROLE', '요청한 사람이나 SUPER 만 취소합니다.');
    if (!['REQUESTED', 'REVIEWED'].includes(r.state)) throw new StateConflict('LGL_REVIEW_STATE', '이미 결정 · 취소한 요청입니다.');
    await db.query(`UPDATE lgl_contract_reviews SET state = 'CANCELED', decided_by = $2::uuid, decided_at = now() WHERE id = $1::bigint`, [r.id, actor]);
    await db.query(
      `UPDATE ops_alerts SET resolved_at = now(), resolve_note = '취소'
        WHERE alert_code = 'LGL_REVIEW_LATE' AND resolved_at IS NULL AND detail->>'key' = $1::text`, [`REV:${r.id}`]);
    return { ok: true, id: r.id, state: 'CANCELED', note: '검토 요청을 취소했습니다.' };
  });
}

/** POST /admin/legal/reviews/{id}/link — ⑯ 계약 대장 연결(한 번 · 승인 · 검토 중인 것만) */
export async function linkReview(db: DatabaseService, id: string, contractId: string) {
  const contract = await contractOk(db, contractId);
  return db.transaction(async () => {
    const [r] = await db.query<{ state: string; cid: string | null }>(
      `SELECT state, contract_id::text AS cid FROM lgl_contract_reviews WHERE id = $1::bigint FOR UPDATE`, [idOk(id, '검토 요청')]);
    if (!r) throw new NotFound('없는 검토 요청입니다.');
    if (r.cid) throw new StateConflict('LGL_REVIEW_LINK', '이미 계약을 연결했습니다(바꾸지 않음).');
    if (['REJECTED', 'CANCELED'].includes(r.state)) throw new StateConflict('LGL_REVIEW_STATE', '반려 · 취소한 요청에는 계약을 연결하지 않습니다.');
    await db.query(`UPDATE lgl_contract_reviews SET contract_id = $2::bigint WHERE id = $1::bigint`, [id, contract]);
    return { ok: true, id, contractId: contract, note: '계약 대장의 계약과 연결했습니다.' };
  });
}

/** 계약 대장 한 줄에 붙은 검토(회계 › 계약 화면에서 쓸 수 있게 내보냄 · 지금은 법무 화면만 씀) */
export async function reviewsOfContract(db: DatabaseService, contractId: string) {
  return db.query(
    `SELECT id::text AS id, title, kind, state, decided_at AS "decidedAt" FROM lgl_contract_reviews WHERE contract_id = $1::bigint ORDER BY id DESC LIMIT 20`, [idOk(contractId, '계약')]);
}
