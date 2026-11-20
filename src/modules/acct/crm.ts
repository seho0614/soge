import { DatabaseService } from '../../db/database.service';
import { AppError, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { createDoc } from './salesdocs';

/* ---------------------------------------------------------------------
 * v10.466 (D264 · docs/604) 영업 기회 CRM — 대표 11/20 「㉝ 영업 · 자금 · 소개몰」
 *   거래처(acct_parties)마다 영업 기회 한 줄 — 단계 상담(LEAD) → 견적(QUOTE · ㉓ 견적서 연결) → 계약(CONTRACT) → 성사(WON) · 실패(LOST · 사유)
 *   예상 매출 · 담당(운영자) · 다음 할 일 · 날짜 · 예상 마감일 · 메모 · 기록(쌓기만)
 *   열린 단계끼리는 앞뒤로 옮길 수 있음(영업은 되돌아가기도 함) · 성사는 끝(고치지 않음 · DB 도 막음) · 실패는 「다시 열기」로 상담부터
 *   견적: 같은 거래처의 견적서를 연결하거나, 없으면 기회 이름 · 예상 매출(공급가 · 과세)로 견적서 초안을 만들어 연결 → 회계 › 견적 · 명세서에서 이어 씀
 *   다음 할 일 알림: 매일 08:50 · 날짜가 오늘이거나 지난 열린 기회 → 운영 알림 SAL_OPP_DUE(기회 · 날짜마다 한 번 · 닫거나 날짜를 바꾸면 풀림) · sales.opp_remind
 *   파이프라인: 단계별 건수 · 예상 매출 · 가중 매출(단계 확률 — 상담 10 · 견적 30 · 계약 70%, 회사 기준 아님 · 화면 참고용) · 이번 달 성사 · 최근 90일 성사율
 *   API 는 /admin/sales/ 아래 — 세무사(ACCOUNTANT) 읽기 규칙(/admin/acct/ 만)에 들지 않음(거래처 담당자 · 영업 메모가 있어서)
 * ------------------------------------------------------------------- */

export const OPP_STAGES = ['LEAD', 'QUOTE', 'CONTRACT', 'WON', 'LOST'] as const;
export const OPEN_STAGES = ['LEAD', 'QUOTE', 'CONTRACT'];
export const OPP_STAGE_KO: Record<string, string> = { LEAD: '상담', QUOTE: '견적', CONTRACT: '계약', WON: '성사', LOST: '실패' };
const WEIGHT: Record<string, number> = { LEAD: 10, QUOTE: 30, CONTRACT: 70, WON: 100, LOST: 0 };   // 화면 참고용 가중치(회사 정책 값 아님)
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const idOk = (id: string) => { if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 영업 기회입니다.'); return String(id); };
const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export interface OppIn { partyId: string; title: string; expectedAmount?: number; ownerId?: string; nextAction?: string; nextActionOn?: string; expectedCloseOn?: string; memo?: string }
export interface OppPatch { title?: string; expectedAmount?: number; ownerId?: string; nextAction?: string; nextActionOn?: string; expectedCloseOn?: string; memo?: string }

async function log(db: DatabaseService, oppId: string, kind: string, actor: string | null, x: { from?: string | null; to?: string | null; note?: string | null } = {}) {
  await db.query(`INSERT INTO sal_opp_logs (opp_id, kind, from_stage, to_stage, note, actor) VALUES ($1::bigint, $2, $3, $4, $5, $6::uuid)`,
    [oppId, kind, x.from ?? null, x.to ?? null, x.note ? x.note.slice(0, 400) : null, actor]);
}

async function staffOk(db: DatabaseService, id: string | undefined | null) {
  if (!id) return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) throw new PolicyViolation('SAL_OWNER', '담당자를 다시 고르십시오.');
  const [s] = await db.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = $1::uuid AND r.role IN ('SUPER', 'ADMIN', 'PAYOUT') AND (r.expires_at IS NULL OR r.expires_at > now())) AS ok`, [id]);
  if (!s?.ok) throw new PolicyViolation('SAL_OWNER', '담당자는 운영자(SUPER · ADMIN · PAYOUT)만 정합니다.');
  return id;
}
const dayOk = (v: string | undefined, msg: string) => {
  if (v == null || v === '') return null;
  if (!YMD.test(v)) throw new PolicyViolation('SAL_DATE', msg);
  return v;
};
const amountOk = (v: unknown) => {
  if (v == null) return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000_000_000) throw new PolicyViolation('SAL_AMOUNT', '예상 매출은 0 ~ 1조 원 정수입니다.');
  return n;
};

/** GET /admin/sales/opps — 목록 · 파이프라인 요약 · 거래처 · 담당자 후보 */
export async function listOpps(db: DatabaseService, q: { stage?: string; owner?: string; q?: string }) {
  const stage = (OPP_STAGES as readonly string[]).includes(q.stage ?? '') ? q.stage! : q.stage === 'OPEN' ? 'OPEN' : '';
  const owner = /^[0-9a-fA-F-]{36}$/.test(q.owner ?? '') ? q.owner! : '';
  const word = clean(q.q, 40);
  const items = await db.query<Record<string, any>>(
    `SELECT o.id::text AS id, o.party_id::text AS "partyId", p.name AS "partyName", o.title, o.stage, o.expected_amount::bigint AS "expectedAmount",
            o.owner_id::text AS "ownerId", a.name AS "ownerName", o.next_action AS "nextAction", o.next_action_on::text AS "nextActionOn",
            o.expected_close_on::text AS "expectedCloseOn", o.quote_doc_id::text AS "quoteDocId", d.doc_no AS "quoteDocNo", o.closed_at AS "closedAt", o.updated_at AS "updatedAt",
            (o.stage IN ('LEAD', 'QUOTE', 'CONTRACT') AND o.next_action_on IS NOT NULL AND o.next_action_on <= $4::date) AS due
       FROM sal_opps o JOIN acct_parties p ON p.id = o.party_id LEFT JOIN accounts a ON a.id = o.owner_id LEFT JOIN acct_sales_docs d ON d.id = o.quote_doc_id
      WHERE ($1::text = '' OR ($1::text = 'OPEN' AND o.stage IN ('LEAD', 'QUOTE', 'CONTRACT')) OR o.stage = $1::text)
        AND ($2::text = '' OR o.owner_id::text = $2::text)
        AND ($3::text = '' OR o.title ILIKE '%' || $3::text || '%' OR p.name ILIKE '%' || $3::text || '%')
      ORDER BY (o.stage IN ('WON', 'LOST')), o.next_action_on NULLS LAST, o.updated_at DESC LIMIT 300`, [stage, owner, word, kstToday()]);
  const ym = kstToday().slice(0, 7);
  const sum = await db.query<{ stage: string; n: number; amt: string }>(
    `SELECT stage, count(*)::int AS n, coalesce(sum(expected_amount), 0)::text AS amt FROM sal_opps WHERE stage IN ('LEAD', 'QUOTE', 'CONTRACT') GROUP BY stage`);
  const [m] = await db.query<{ won: number; won_amt: string; lost: number; w90: number; l90: number; overdue: number; today: number }>(
    `SELECT count(*) FILTER (WHERE stage = 'WON' AND to_char(closed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = $1)::int AS won,
            coalesce(sum(expected_amount) FILTER (WHERE stage = 'WON' AND to_char(closed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = $1), 0)::text AS won_amt,
            count(*) FILTER (WHERE stage = 'LOST' AND to_char(closed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = $1)::int AS lost,
            count(*) FILTER (WHERE stage = 'WON' AND closed_at > now() - interval '90 days')::int AS w90,
            count(*) FILTER (WHERE stage = 'LOST' AND closed_at > now() - interval '90 days')::int AS l90,
            count(*) FILTER (WHERE stage IN ('LEAD', 'QUOTE', 'CONTRACT') AND next_action_on < $2::date)::int AS overdue,
            count(*) FILTER (WHERE stage IN ('LEAD', 'QUOTE', 'CONTRACT') AND next_action_on = $2::date)::int AS today
       FROM sal_opps`, [ym, kstToday()]);
  const pipeline = OPEN_STAGES.map((s) => {
    const r = sum.find((x) => x.stage === s);
    const amount = Number(r?.amt ?? 0);
    return { stage: s, label: OPP_STAGE_KO[s], count: Number(r?.n ?? 0), amount, weighted: Math.round(amount * WEIGHT[s] / 100), weight: WEIGHT[s] };
  });
  const w90 = Number(m?.w90 ?? 0), l90 = Number(m?.l90 ?? 0);
  const parties = await db.query(`SELECT id::text AS id, name FROM acct_parties WHERE state = 'ACTIVE' AND kind IN ('CUSTOMER', 'BOTH') ORDER BY name LIMIT 500`);
  const staff = await db.query(
    `SELECT DISTINCT a.id::text AS id, a.name FROM accounts a JOIN account_roles r ON r.account_id = a.id
      WHERE r.role IN ('SUPER', 'ADMIN', 'PAYOUT') AND (r.expires_at IS NULL OR r.expires_at > now()) ORDER BY a.name LIMIT 200`);
  return {
    items, stages: OPP_STAGE_KO, pipeline, parties, staff,
    summary: { open: pipeline.reduce((s, x) => s + x.count, 0), openAmount: pipeline.reduce((s, x) => s + x.amount, 0), weighted: pipeline.reduce((s, x) => s + x.weighted, 0),
               wonThisMonth: Number(m?.won ?? 0), wonAmountThisMonth: Number(m?.won_amt ?? 0), lostThisMonth: Number(m?.lost ?? 0),
               winRate90: w90 + l90 ? Math.round((w90 * 1000) / (w90 + l90)) / 10 : null, overdue: Number(m?.overdue ?? 0), dueToday: Number(m?.today ?? 0) },
    note: '가중 매출은 단계 확률(상담 10 · 견적 30 · 계약 70%)을 곱한 참고 값입니다. 성사 금액은 예상 매출 기준이며 실제 매출은 거래명세서 · 전표가 기준입니다.',
  };
}

/** GET /admin/sales/opps/{id} — 한 기회 · 기록 · 연결한 견적서 */
export async function oppDetail(db: DatabaseService, idIn: string) {
  const id = idOk(idIn);
  const [o] = await db.query<Record<string, any>>(
    `SELECT o.id::text AS id, o.party_id::text AS "partyId", p.name AS "partyName", p.contact_name AS "contactName", o.title, o.stage, o.expected_amount::bigint AS "expectedAmount",
            o.owner_id::text AS "ownerId", a.name AS "ownerName", o.next_action AS "nextAction", o.next_action_on::text AS "nextActionOn", o.expected_close_on::text AS "expectedCloseOn",
            o.memo, o.lost_reason AS "lostReason", o.closed_at AS "closedAt", o.created_at AS "createdAt", o.updated_at AS "updatedAt",
            o.quote_doc_id::text AS "quoteDocId", d.doc_no AS "quoteDocNo", d.state AS "quoteState", d.total::bigint AS "quoteTotal"
       FROM sal_opps o JOIN acct_parties p ON p.id = o.party_id LEFT JOIN accounts a ON a.id = o.owner_id LEFT JOIN acct_sales_docs d ON d.id = o.quote_doc_id
      WHERE o.id = $1::bigint`, [id]);
  if (!o) throw new NotFound('없는 영업 기회입니다.');
  const logs = await db.query(
    `SELECT l.id::text AS id, l.kind, l.from_stage AS "from", l.to_stage AS "to", l.note, a.name AS actor, l.created_at AS "createdAt"
       FROM sal_opp_logs l LEFT JOIN accounts a ON a.id = l.actor WHERE l.opp_id = $1::bigint ORDER BY l.id DESC LIMIT 100`, [id]);
  const quotes = await db.query(
    `SELECT id::text AS id, doc_no AS "docNo", title, total::bigint AS total, state FROM acct_sales_docs
      WHERE kind = 'QUOTE' AND party_id = $1::bigint AND superseded_by IS NULL AND state <> 'CANCELED' ORDER BY issued_on DESC, created_at DESC LIMIT 30`, [o.partyId]);
  return { opp: o, logs, quotes, stages: OPP_STAGE_KO, stageKo: OPP_STAGE_KO[o.stage] ?? o.stage };
}

/** POST /admin/sales/opps — 새 기회(상담) */
export async function createOpp(db: DatabaseService, b: OppIn, actor: string | null) {
  if (!actor) throw new AppError(403, { code: 'FORBIDDEN', message: '로그인한 운영자만 만듭니다.' });
  const title = clean(b.title, 200);
  if (title.length < 2 || title.length > 120) throw new PolicyViolation('SAL_TITLE', '기회 이름은 2 ~ 120자입니다.');
  if (!/^\d{1,18}$/.test(String(b.partyId ?? ''))) throw new NotFound('없는 거래처입니다.');
  const [p] = await db.query<{ state: string }>(`SELECT state FROM acct_parties WHERE id = $1::bigint`, [b.partyId]);
  if (!p) throw new NotFound('없는 거래처입니다.');
  if (p.state !== 'ACTIVE') throw new PolicyViolation('SAL_PARTY', '거래를 닫은 거래처입니다.');
  const owner = await staffOk(db, b.ownerId || actor);
  const amount = amountOk(b.expectedAmount);
  const nextOn = dayOk(b.nextActionOn, '다음 할 일 날짜가 바르지 않습니다.'), closeOn = dayOk(b.expectedCloseOn, '예상 마감 날짜가 바르지 않습니다.');
  return db.transaction(async () => {
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO sal_opps (party_id, title, expected_amount, owner_id, next_action, next_action_on, expected_close_on, memo, created_by)
       VALUES ($1::bigint, $2, $3::bigint, $4::uuid, $5, $6::date, $7::date, $8, $9::uuid) RETURNING id::text AS id`,
      [b.partyId, title, amount, owner, clean(b.nextAction, 200) || null, nextOn, closeOn, clean(b.memo, 400) || null, actor]);
    await log(db, r!.id, 'CREATE', actor, { to: 'LEAD', note: title });
    return { ok: true, id: r!.id, stage: 'LEAD', note: `영업 기회 「${title}」을 만들었습니다(상담).` };
  });
}

async function lockOpp(db: DatabaseService, id: string) {
  const [o] = await db.query<{ stage: string; party_id: string; title: string; expected_amount: string; quote_doc_id: string | null }>(
    `SELECT stage, party_id::text AS party_id, title, expected_amount::text AS expected_amount, quote_doc_id::text AS quote_doc_id FROM sal_opps WHERE id = $1::bigint FOR UPDATE`, [id]);
  if (!o) throw new NotFound('없는 영업 기회입니다.');
  return o;
}

/** PUT /admin/sales/opps/{id} — 이름 · 예상 매출 · 담당 · 다음 할 일 · 날짜 · 메모(열린 기회만 · 보낸 칸만 바꿈 — 안 보낸 칸(undefined)은 옛 값 그대로) */
export async function updateOpp(db: DatabaseService, idIn: string, b: OppPatch, actor: string | null) {
  const id = idOk(idIn);
  const changed: string[] = [];
  const has = (k: keyof OppPatch, label: string) => { const y = b[k] !== undefined; if (y) changed.push(label); return y; };
  const hTitle = has('title', '이름'), hAmt = has('expectedAmount', '예상 매출'), hOwner = has('ownerId', '담당'), hAct = has('nextAction', '다음 할 일'),
        hOn = has('nextActionOn', '다음 할 날짜'), hClose = has('expectedCloseOn', '예상 마감'), hMemo = has('memo', '메모');
  if (!changed.length) throw new PolicyViolation('SAL_EMPTY', '바꿀 칸이 없습니다.');
  const title = hTitle ? clean(b.title, 200) : null;
  if (hTitle && (title!.length < 2 || title!.length > 120)) throw new PolicyViolation('SAL_TITLE', '기회 이름은 2 ~ 120자입니다.');
  const amt = hAmt ? amountOk(b.expectedAmount) : null;
  const owner = hOwner ? await staffOk(db, b.ownerId || null) : null;
  const on = hOn ? dayOk(b.nextActionOn, '다음 할 일 날짜가 바르지 않습니다.') : null, close = hClose ? dayOk(b.expectedCloseOn, '예상 마감 날짜가 바르지 않습니다.') : null;
  return db.transaction(async () => {
    const o = await lockOpp(db, id);
    if (!OPEN_STAGES.includes(o.stage)) throw new StateConflict('SAL_OPP_STATE', '닫힌 영업 기회는 고치지 않습니다(실패는 다시 열고 고치십시오).');
    await db.query(
      `UPDATE sal_opps SET title = CASE WHEN $2::boolean THEN $3 ELSE title END,
              expected_amount = CASE WHEN $4::boolean THEN $5::bigint ELSE expected_amount END,
              owner_id = CASE WHEN $6::boolean THEN $7::uuid ELSE owner_id END,
              next_action = CASE WHEN $8::boolean THEN $9 ELSE next_action END,
              next_action_on = CASE WHEN $10::boolean THEN $11::date ELSE next_action_on END,
              expected_close_on = CASE WHEN $12::boolean THEN $13::date ELSE expected_close_on END,
              memo = CASE WHEN $14::boolean THEN $15 ELSE memo END
        WHERE id = $1::bigint`,
      [id, hTitle, title, hAmt, amt, hOwner, owner, hAct, hAct ? clean(b.nextAction, 200) || null : null, hOn, on, hClose, close, hMemo, hMemo ? clean(b.memo, 400) || null : null]);
    await log(db, id, 'EDIT', actor, { note: changed.join(' · ') });
    return { ok: true, id, changed, note: '영업 기회를 고쳤습니다.' };
  });
}

/** POST /admin/sales/opps/{id}/stage — 단계 바꾸기 · 실패는 사유 · 성사는 끝 · 실패 → 상담(다시 열기) */
export async function setOppStage(db: DatabaseService, idIn: string, to: string, noteIn: string | undefined, actor: string | null) {
  const id = idOk(idIn);
  if (!(OPP_STAGES as readonly string[]).includes(to)) throw new PolicyViolation('SAL_STAGE', '모르는 단계입니다.');
  const note = clean(noteIn, 200);
  return db.transaction(async () => {
    const o = await lockOpp(db, id);
    if (o.stage === to) throw new StateConflict('SAL_OPP_STATE', '이미 그 단계입니다.');
    if (o.stage === 'WON') throw new StateConflict('SAL_OPP_STATE', '성사한 영업 기회는 바꾸지 않습니다.');
    if (o.stage === 'LOST' && to !== 'LEAD') throw new StateConflict('SAL_OPP_STATE', '실패한 기회는 「다시 열기」(상담)로만 엽니다.');
    if (to === 'LOST' && note.length < 2) throw new PolicyViolation('SAL_REASON', '실패 사유를 2자 이상 적어 주십시오.');
    if (o.stage === 'LOST' && note.length < 2) throw new PolicyViolation('SAL_REASON', '다시 여는 사유를 2자 이상 적어 주십시오.');
    if (to === 'WON' || to === 'LOST') {
      await db.query(`UPDATE sal_opps SET stage = $2, closed_at = now(), lost_reason = $3 WHERE id = $1::bigint`, [id, to, to === 'LOST' ? note : null]);
    } else {
      await db.query(`UPDATE sal_opps SET stage = $2, closed_at = NULL, lost_reason = NULL WHERE id = $1::bigint`, [id, to]);
    }
    await log(db, id, 'STAGE', actor, { from: o.stage, to, note: note || null });
    return { ok: true, id, stage: to, note: `단계를 바꿨습니다(${o.stage} → ${to}).` };
  });
}

/** POST /admin/sales/opps/{id}/quote — 같은 거래처 견적서 연결(docId) · 없으면 견적서 초안을 만들어 연결 · 상담이면 견적 단계로 */
export async function linkOppQuote(db: DatabaseService, idIn: string, docId: string | undefined, actor: string | null) {
  const id = idOk(idIn);
  const [o0] = await db.query<{ stage: string; party_id: string; title: string; expected_amount: string }>(
    `SELECT stage, party_id::text AS party_id, title, expected_amount::text AS expected_amount FROM sal_opps WHERE id = $1::bigint`, [id]);   // 미리 보기(아래 트랜잭션에서 다시 잠금)
  if (!o0) throw new NotFound('없는 영업 기회입니다.');
  if (!OPEN_STAGES.includes(o0.stage)) throw new StateConflict('SAL_OPP_STATE', '닫힌 영업 기회에는 견적서를 잇지 않습니다.');
  let doc = docId ?? '';
  let made: string | null = null;
  if (doc) {
    if (!/^[0-9a-fA-F-]{36}$/.test(doc)) throw new PolicyViolation('SAL_QUOTE', '견적서를 다시 고르십시오.');
    const [d] = await db.query<{ kind: string; party: string; state: string }>(`SELECT kind, party_id::text AS party, state FROM acct_sales_docs WHERE id = $1::uuid`, [doc]);
    if (!d) throw new NotFound('없는 견적서입니다.');
    if (d.kind !== 'QUOTE' || d.party !== o0.party_id) throw new PolicyViolation('SAL_QUOTE', '같은 거래처의 견적서만 연결합니다.');
    if (d.state === 'CANCELED') throw new PolicyViolation('SAL_QUOTE', '취소한 견적서는 연결하지 않습니다.');
  } else {
    const amt = Number(o0.expected_amount);
    if (!(amt > 0)) throw new PolicyViolation('SAL_QUOTE', '예상 매출이 0원이라 견적서 초안을 만들 수 없습니다 — 금액을 넣거나 만든 견적서를 고르십시오.');
    const r = await createDoc(db, { kind: 'QUOTE', partyId: o0.party_id, title: o0.title.slice(0, 120), lines: [{ item: o0.title.slice(0, 120), qty: 1, unitPrice: amt, taxType: 'TAXABLE' }] }, actor);
    doc = r.id; made = r.docNo;
  }
  return db.transaction(async () => {
    const o = await lockOpp(db, id);
    if (!OPEN_STAGES.includes(o.stage)) throw new StateConflict('SAL_OPP_STATE', '닫힌 영업 기회에는 견적서를 잇지 않습니다.');
    const toQuote = o.stage === 'LEAD';
    await db.query(`UPDATE sal_opps SET quote_doc_id = $2::uuid, stage = CASE WHEN stage = 'LEAD' THEN 'QUOTE' ELSE stage END WHERE id = $1::bigint`, [id, doc]);
    await log(db, id, 'QUOTE', actor, { from: toQuote ? 'LEAD' : null, to: toQuote ? 'QUOTE' : null, note: made ? `견적서 초안 ${made} 만듦` : '견적서 연결' });
    return { ok: true, id, quoteDocId: doc, stage: toQuote ? 'QUOTE' : o.stage,
             note: made ? `견적서 초안 ${made} 을 만들어 연결했습니다 — 회계 › 견적 · 명세서에서 품목을 고치십시오.` : '견적서를 연결했습니다.' };
  });
}

/** POST /admin/sales/opps/{id}/note — 메모 한 줄(통화 · 방문 기록) */
export async function addOppNote(db: DatabaseService, idIn: string, noteIn: string, actor: string | null) {
  const id = idOk(idIn);
  const note = clean(noteIn, 400);
  if (note.length < 2) throw new PolicyViolation('SAL_NOTE', '메모는 2 ~ 400자입니다.');
  const [o] = await db.query(`SELECT 1 FROM sal_opps WHERE id = $1::bigint`, [id]);
  if (!o) throw new NotFound('없는 영업 기회입니다.');
  await log(db, id, 'NOTE', actor, { note });
  return { ok: true, id, note: '메모를 남겼습니다.' };
}

/** 정기 작업 sal_opp_remind(매일 08:50) — 다음 할 날짜가 된 열린 기회 → 운영 알림 SAL_OPP_DUE(기회 · 날짜마다 한 번) · 닫았거나 날짜를 바꾼 알림은 풀음 */
export async function salOppRemindJob(db: DatabaseService) {
  const [sw] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'sales.opp_remind'`);
  const on = (sw?.v ?? 'on') === 'on';
  const due = on ? await db.query<{ id: string; title: string; party: string; owner: string | null; on_: string; action: string | null }>(
    `SELECT o.id::text AS id, o.title, p.name AS party, a.name AS owner, o.next_action_on::text AS on_, o.next_action AS action
       FROM sal_opps o JOIN acct_parties p ON p.id = o.party_id LEFT JOIN accounts a ON a.id = o.owner_id
      WHERE o.stage IN ('LEAD', 'QUOTE', 'CONTRACT') AND o.next_action_on IS NOT NULL AND o.next_action_on <= $1::date
      ORDER BY o.next_action_on, o.id LIMIT 300`, [kstToday()]) : [];
  const want = new Map(due.map((x) => [`${x.id}|${x.on_}`, x]));
  const open = await db.query<{ id: string; key: string }>(`SELECT id::text AS id, detail->>'key' AS key FROM ops_alerts WHERE alert_code = 'SAL_OPP_DUE' AND resolved_at IS NULL`);
  let resolved = 0;
  for (const x of open) if (!want.has(String(x.key ?? ''))) {
    await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2 WHERE id = $1::bigint`, [x.id, on ? '닫았거나 날짜 바뀜' : '알림 끔']);
    resolved++;
  }
  const made: string[] = [];
  for (const [key, x] of want) {
    const title = `영업 기회 다음 할 일 — ${x.party} · ${x.title} · ${x.on_}${x.action ? ` · ${x.action}` : ''}${x.owner ? ` (담당 ${x.owner})` : ''} — 회계 › 영업 기회`.slice(0, 300);
    const ins = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'SAL_OPP_DUE', 'INFO', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'SAL_OPP_DUE' AND detail->>'key' = $3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [title, JSON.stringify({ key, opp: x.id, on: x.on_, owner: x.owner }), key]);
    if (ins.length) made.push(key);
  }
  return { on, due: due.length, made, resolved };
}
