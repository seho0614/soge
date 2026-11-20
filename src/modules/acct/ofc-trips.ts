import { DatabaseService } from '../../db/database.service';
import { hasRole } from '../../core/auth';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { addRequisition, REQ_STATE_KO } from './requisitions';   // v10.410 (D249) 품의 — 출장 신청이 품의 하나를 함께 만듦(결재선 · 결재함 그대로)
import { createExpense } from './expense';   // v10.393 (D245) 경비 청구 — 여비 정산이 청구 하나를 만듦(승인 · 지급 · 전표 그대로)
import type { Viewer } from './ofc-calendar';

/* ---------------------------------------------------------------------
 * v10.464 (D263 · docs/602) 출장 신청(품의) → 다녀온 뒤 여비 정산 → 경비 청구 — 대표 11/20 「㉜ 사무 2」
 *   신청: 가는 곳 · 지역(서울 · 광역시 · 그 밖) · 목적 · 가는 날 · 오는 날 · 교통비 예상
 *         예상 = 일비 × 날수 + 식비 × 날수 + 숙박 상한(지역) × 박수 + 교통비 예상 — 그때 기준을 basis 로 남김
 *         → 품의(acct_requisitions · 계정 EXP_TRAVEL 여비교통비 · 쓸 날 = 가는 날) 하나를 같은 거래로 → 결재선 · 결재함 · SUPER 결재 그대로
 *   정산: 출장 간 본인만 · 오는 날이 지난 뒤 · 품의가 승인(또는 앞 청구가 반려 · 취소)일 때
 *         금액 = 일비 × 날수 + 식비 × 날수 + min(실제 숙박비, 상한 × 실제 박수) + 실제 교통비(신청 때 기준 값)
 *         → 경비 청구(acct_expense_claims · EXP_TRAVEL · 간이(부가세 0 · 공제 안 함) · requisition_id = 출장 품의) 하나 → 승인 · 지급 · 전표는 경비 청구 그대로
 *   두 번 청구 막기: 서비스가 먼저 409 OFC_TRIP_DOUBLE · DB(fn_ofc_trip_settle_guard · claim_id 고유 · 품의 금액 가드 REQ_OVER)가 뒷받침
 *   기준(일비 · 식비 · 숙박 상한)은 일반 원칙 값(공무원 여비 규정 참고 · 확인 필요) · SUPER 가 고침(PUT /admin/office/trip-standards · 사유)
 * ------------------------------------------------------------------- */

export const TRIP_REGIONS = ['SEOUL', 'METRO', 'OTHER'] as const;
export const TRIP_REGION_KO: Record<string, string> = { SEOUL: '서울', METRO: '광역시', OTHER: '그 밖' };
export const TRIP_STATE_KO: Record<string, string> = { PLANNED: '신청', SETTLED: '정산함', CANCELED: '취소' };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const dayOk = (d?: string | null) => !!d && YMD.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const won = (n: number) => n.toLocaleString('ko-KR');
const intIn = (v: unknown, lo: number, hi: number) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
const isSuper = (v: Viewer) => v.roles.includes('SUPER');
const seesAll = (v: Viewer) => hasRole(v.roles, 'PAYOUT');   // SUPER 포함(hasRole)

export interface TripStandards { perDiem: number; meal: number; lodgingCaps: Record<string, number> }

/** 여비 기준(설정) — 없거나 모양이 틀리면 일반 원칙 값 */
export async function tripStandards(db: DatabaseService): Promise<TripStandards> {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key IN ('ofc.trip_per_diem', 'ofc.trip_meal', 'ofc.trip_lodging_caps')`);
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const caps: Record<string, number> = { SEOUL: 100000, METRO: 80000, OTHER: 70000 };
  for (const part of String(v('ofc.trip_lodging_caps') ?? '').split(',')) {
    const [k, n] = part.split(':');
    if (k && (TRIP_REGIONS as readonly string[]).includes(k) && /^\d{1,7}$/.test(n ?? '')) caps[k] = Number(n);
  }
  const num = (k: string, d: number) => (/^\d{1,7}$/.test(v(k) ?? '') ? Number(v(k)) : d);
  return { perDiem: num('ofc.trip_per_diem', 25000), meal: num('ofc.trip_meal', 25000), lodgingCaps: caps };
}

/** 예상 · 정산 셈 — 날수 = 오는 날 − 가는 날 + 1 · 박수(처음) = 날수 − 1 */
export function tripCalc(s: { perDiem: number; meal: number; lodgingCap: number }, days: number, nights: number, transport: number, lodgingActual?: number | null) {
  const perDiemTotal = s.perDiem * days, mealTotal = s.meal * days, lodgingLimit = s.lodgingCap * nights;
  const lodgingAllowed = lodgingActual == null ? lodgingLimit : Math.min(lodgingActual, lodgingLimit);
  return { days, nights, perDiem: s.perDiem, meal: s.meal, lodgingCap: s.lodgingCap, perDiemTotal, mealTotal, lodgingLimit,
           lodgingActual: lodgingActual ?? null, lodgingAllowed, transport, total: perDiemTotal + mealTotal + lodgingAllowed + transport };
}

export interface TripInput { destination?: string; region?: string; purpose?: string; departOn?: string; returnOn?: string; transportEst?: number }

/** POST /admin/office/trips — 출장 신청 + 품의(같은 거래) */
export async function createTrip(db: DatabaseService, b: TripInput, v: Viewer) {
  const dest = clean(b.destination);
  if (dest.length < 2 || dest.length > 60) throw new PolicyViolation('OFC_TRIP_DEST', '가는 곳은 2 ~ 60자입니다.');
  const region = (TRIP_REGIONS as readonly string[]).includes(b.region ?? '') ? String(b.region) : null;
  if (!region) throw new PolicyViolation('OFC_TRIP_REGION', '지역(서울 · 광역시 · 그 밖)을 고르십시오.');
  const purpose = clean(b.purpose);
  if (purpose.length < 2 || purpose.length > 300) throw new PolicyViolation('OFC_TRIP_PURPOSE', '출장 목적은 2 ~ 300자입니다.');
  const dep = String(b.departOn ?? ''), ret = String(b.returnOn || b.departOn || '');
  if (!dayOk(dep) || !dayOk(ret)) throw new PolicyViolation('OFC_TRIP_DATE', '가는 날 · 오는 날(YYYY-MM-DD)이 맞지 않습니다.');
  if (ret < dep) throw new PolicyViolation('OFC_TRIP_DATE', '오는 날이 가는 날보다 앞입니다.');
  if (diffDays(dep, ret) > 30) throw new PolicyViolation('OFC_TRIP_DATE', '출장 하나는 31일까지입니다.');
  if (dep < addDays(kstToday(), -30)) throw new PolicyViolation('OFC_TRIP_DATE', '30일보다 오래된 출장은 신청하지 않습니다(경비 청구로 올리십시오).');
  const transport = intIn(b.transportEst ?? 0, 0, 10_000_000);
  if (transport == null) throw new PolicyViolation('OFC_TRIP_AMOUNT', '교통비 예상은 0 ~ 1천만 원 정수입니다.');
  const s = await tripStandards(db);
  const days = diffDays(dep, ret) + 1;
  const basis = tripCalc({ perDiem: s.perDiem, meal: s.meal, lodgingCap: s.lodgingCaps[region] ?? 0 }, days, days - 1, transport);
  if (basis.total < 1 || basis.total > 100_000_000) throw new PolicyViolation('OFC_TRIP_AMOUNT', '예상 금액은 1원 ~ 1억 원입니다(경비 청구 한도).');
  return db.transaction(async () => {
    const req = await addRequisition(db, { title: `출장 ${dest} ${dep}~${ret}`.slice(0, 100), amount: basis.total, accountRole: 'EXP_TRAVEL',
                                           reason: `출장 — ${purpose}`.slice(0, 400), neededOn: dep }, v.id);
    const [t] = await db.query<{ id: string }>(
      `INSERT INTO ofc_trips (traveler, destination, region, purpose, depart_on, return_on, transport_est, estimate, basis, requisition_id)
       VALUES ($1::uuid, $2, $3, $4, $5::date, $6::date, $7::bigint, $8::bigint, $9::jsonb, $10::bigint) RETURNING id::text AS id`,
      [v.id, dest, region, purpose, dep, ret, transport, basis.total, JSON.stringify(basis), req.id]);
    return { ok: true, id: t!.id, requisitionId: req.id, estimate: basis.total, basis,
             note: `출장을 신청했습니다 — 품의 ${req.id}번(예상 ${won(basis.total)}원)이 결재를 기다립니다(사무 › 결재함 · 회계 › 품의).` };
  });
}

interface TripRow { id: string; traveler: string; who: string | null; destination: string; region: string; purpose: string; depart_on: string; return_on: string;
  transport_est: string; estimate: string; basis: Record<string, number>; requisition_id: string; rstate: string; ramount: string; state: string; claim_id: string | null;
  cstate: string | null; settled_at: string | null; canceled_at: string | null; cancel_note: string | null; created_at: string }
const SELECT = `SELECT t.id::text AS id, t.traveler::text AS traveler, coalesce(a.name, a.email) AS who, t.destination, t.region, t.purpose,
                       t.depart_on::text AS depart_on, t.return_on::text AS return_on, t.transport_est::text AS transport_est, t.estimate::text AS estimate, t.basis,
                       t.requisition_id::text AS requisition_id, r.state AS rstate, r.amount::text AS ramount, t.state, t.claim_id::text AS claim_id, c.state AS cstate,
                       t.settled_at, t.canceled_at, t.cancel_note, t.created_at
                  FROM ofc_trips t JOIN acct_requisitions r ON r.id = t.requisition_id LEFT JOIN accounts a ON a.id = t.traveler
                       LEFT JOIN acct_expense_claims c ON c.id = t.claim_id`;

function shape(r: TripRow, v: Viewer, today: string) {
  const claimDead = !r.claim_id || r.cstate === 'REJECTED' || r.cstate === 'CANCELED';
  const canSettle = r.traveler === v.id && r.state !== 'CANCELED' && claimDead && (r.rstate === 'APPROVED' || r.rstate === 'USED') && r.return_on <= today;
  const why = r.state === 'CANCELED' ? '취소한 출장' : !claimDead ? '이미 여비를 청구함' : r.rstate === 'REQUESTED' ? '품의 결재 기다림'
            : r.rstate === 'REJECTED' ? '품의 반려' : r.rstate === 'CANCELED' ? '품의 취소' : r.return_on > today ? `오는 날(${r.return_on}) 뒤에 정산` : r.traveler !== v.id ? '출장 간 본인이 정산' : null;
  return { id: r.id, travelerId: r.traveler, traveler: r.who, destination: r.destination, region: r.region, regionKo: TRIP_REGION_KO[r.region] ?? r.region, purpose: r.purpose,
           departOn: r.depart_on, returnOn: r.return_on, transportEst: Number(r.transport_est), estimate: Number(r.estimate), basis: r.basis,
           requisitionId: r.requisition_id, reqState: r.rstate, reqStateKo: REQ_STATE_KO[r.rstate] ?? r.rstate, state: r.state, stateKo: TRIP_STATE_KO[r.state] ?? r.state,
           claimId: r.claim_id, claimState: r.cstate, settledAt: r.settled_at, canceledAt: r.canceled_at, cancelNote: r.cancel_note, createdAt: r.created_at,
           mine: r.traveler === v.id, canSettle, settleBlock: canSettle ? null : why,
           canCancel: r.state === 'PLANNED' && (r.traveler === v.id || isSuper(v)) && ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELED'].includes(r.rstate) };
}

/** GET /admin/office/trips?view=mine|all — 본인(SUPER · 지급 담당은 모두) + 기준 */
export async function listTrips(db: DatabaseService, v: Viewer, viewIn?: string) {
  const view = viewIn === 'all' && seesAll(v) ? 'all' : 'mine';
  const today = kstToday();
  const rows = await db.query<TripRow>(`${SELECT} WHERE ($1 = 'all' OR t.traveler = $2::uuid) ORDER BY t.depart_on DESC, t.id DESC LIMIT 300`, [view, v.id]);
  const s = await tripStandards(db);
  return { view, today, items: rows.map((r) => shape(r, v, today)), standards: s, regions: TRIP_REGION_KO, canAll: seesAll(v), canEditStandards: isSuper(v),
           note: '출장 신청은 품의로 결재(결재선 · 결재함 그대로)를 받고, 다녀온 뒤 여비 정산이 경비 청구로 올라갑니다(승인 · 지급 · 전표는 경비 청구 그대로). 일비 · 식비 · 숙박 상한은 일반 원칙 값(확인 필요)이며 SUPER 가 고칩니다.' };
}

async function loadTrip(db: DatabaseService, id: string, v: Viewer, lock = false) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('출장이 없습니다.');
  const [r] = await db.query<TripRow>(`${SELECT} WHERE t.id = $1::bigint${lock ? ' FOR UPDATE OF t' : ''}`, [id]);
  if (!r || !(r.traveler === v.id || seesAll(v))) throw new NotFound('출장이 없습니다.');
  return r;
}

/** GET /admin/office/trips/{id} — 정산 기록(청구 상태) */
export async function tripDetail(db: DatabaseService, id: string, v: Viewer) {
  const r = await loadTrip(db, id, v);
  const settlements = await db.query(
    `SELECT s.id::text AS id, s.claim_id::text AS "claimId", c.state AS "claimState", s.amount::bigint AS amount, s.detail, s.created_at AS "createdAt"
       FROM ofc_trip_settlements s JOIN acct_expense_claims c ON c.id = s.claim_id WHERE s.trip_id = $1::bigint ORDER BY s.id`, [r.id]);
  return { ...shape(r, v, kstToday()), settlements, standards: await tripStandards(db) };
}

/** POST /admin/office/trips/{id}/cancel — 정산 전 · 본인 · SUPER · 품의도 취소(결재 전 · 승인 뒤 쓰기 전) */
export async function cancelTrip(db: DatabaseService, id: string, reasonIn: string, v: Viewer) {
  const reason = clean(reasonIn);
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('OFC_TRIP_REASON', '취소 사유는 2 ~ 200자입니다.');
  return db.transaction(async () => {
    const r = await loadTrip(db, id, v, true);
    if (!(r.traveler === v.id || isSuper(v))) throw new Forbidden('OFC_TRIP_WHO', '출장 간 본인 또는 SUPER 가 취소합니다.');
    if (r.state !== 'PLANNED') throw new StateConflict('OFC_TRIP_STATE', '정산했거나 취소한 출장은 취소하지 않습니다.');
    if (r.rstate === 'USED') throw new StateConflict('OFC_TRIP_STATE', '여비를 이미 청구한 출장입니다.');
    if (r.rstate === 'REQUESTED' || r.rstate === 'APPROVED') {
      await db.query(`UPDATE acct_requisitions SET state = 'CANCELED' WHERE id = $1::bigint AND state IN ('REQUESTED', 'APPROVED')`, [r.requisition_id]);
    }
    await db.query(`UPDATE ofc_trips SET state = 'CANCELED', canceled_at = now(), cancel_note = $2 WHERE id = $1::bigint`, [r.id, reason]);
    return { ok: true, id: r.id, note: '출장을 취소했습니다 — 품의도 취소했습니다.' };
  });
}

export interface TripSettleInput { transport?: number; lodging?: number; nights?: number; memo?: string | null; attachments?: string[] }

/** POST /admin/office/trips/{id}/settle — 다녀온 뒤 본인이 여비 정산 → 경비 청구 하나 */
export async function settleTrip(db: DatabaseService, id: string, b: TripSettleInput, v: Viewer) {
  const transport = intIn(b.transport ?? 0, 0, 10_000_000), lodging = intIn(b.lodging ?? 0, 0, 10_000_000);
  if (transport == null || lodging == null) throw new PolicyViolation('OFC_TRIP_AMOUNT', '교통비 · 숙박비는 0 ~ 1천만 원 정수입니다.');
  const memo = clean(b.memo).slice(0, 300);
  const files = [...new Set((b.attachments ?? []).filter(Boolean).map(String))];
  if (files.length > 3) throw new PolicyViolation('TOO_MANY_FILES', '증빙 파일은 3개까지입니다.');
  if (files.some((f) => !UUID.test(f))) throw new PolicyViolation('FILE_INVALID', '증빙 파일을 확인해 주십시오(본인이 올린 증빙 · 올리기 끝난 것).');
  const today = kstToday();
  return db.transaction(async () => {
    const r = await loadTrip(db, id, v, true);
    if (r.traveler !== v.id) throw new Forbidden('OFC_TRIP_WHO', '여비 정산은 출장 간 본인이 합니다.');
    if (r.state === 'CANCELED') throw new StateConflict('OFC_TRIP_STATE', '취소한 출장입니다.');
    const [live] = await db.query<{ id: string }>(
      `SELECT s.claim_id::text AS id FROM ofc_trip_settlements s JOIN acct_expense_claims c ON c.id = s.claim_id
        WHERE s.trip_id = $1::bigint AND c.state IN ('REQUESTED', 'APPROVED', 'PAID') LIMIT 1`, [r.id]);
    if (live) throw new StateConflict('OFC_TRIP_DOUBLE', `이 출장은 이미 여비를 청구했습니다(경비 청구 ${live.id}번) — 반려 · 취소된 뒤에만 다시 정산합니다.`);
    if (!(r.rstate === 'APPROVED' || r.rstate === 'USED')) throw new StateConflict('OFC_TRIP_STATE', `품의가 승인되지 않았습니다(${REQ_STATE_KO[r.rstate] ?? r.rstate}).`);
    if (r.return_on > today) throw new PolicyViolation('OFC_TRIP_EARLY', `오는 날(${r.return_on})이 지난 뒤에 정산합니다.`);
    const days = Number(r.basis?.days ?? diffDays(r.depart_on, r.return_on) + 1);
    const nights = b.nights == null ? Math.max(0, days - 1) : intIn(b.nights, 0, Math.max(0, days - 1));
    if (nights == null) throw new PolicyViolation('OFC_TRIP_NIGHTS', `박수는 0 ~ ${Math.max(0, days - 1)}박입니다.`);
    const calc = tripCalc({ perDiem: Number(r.basis?.perDiem ?? 0), meal: Number(r.basis?.meal ?? 0), lodgingCap: Number(r.basis?.lodgingCap ?? 0) }, days, nights, transport, lodging);
    if (calc.total < 1 || calc.total > 100_000_000) throw new PolicyViolation('OFC_TRIP_AMOUNT', '정산 금액은 1원 ~ 1억 원입니다.');
    const [st] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'acct.req_tolerance_pct'`);
    const tol = Math.min(50, Math.max(0, Number(st?.v ?? 10) || 0));
    const limit = Math.floor(Number(r.ramount) * (100 + tol) / 100);
    if (calc.total > limit) throw new PolicyViolation('OFC_TRIP_OVER', `정산 금액(${won(calc.total)}원)이 품의 금액(${won(Number(r.ramount))}원 · 허용 ${tol}%)보다 큽니다 — 출장을 다시 신청하거나 차액은 따로 경비 청구로 품의를 받으십시오.`);
    const item = `출장 여비 ${r.destination} ${r.depart_on}~${r.return_on}`.slice(0, 100);
    const lines = `일비 ${won(calc.perDiem)}×${days}일 · 식비 ${won(calc.meal)}×${days}일 · 숙박 ${won(calc.lodgingAllowed)}(${nights}박 · 상한 ${won(calc.lodgingCap)}) · 교통 ${won(transport)}`;
    const c = await createExpense(db, { spentOn: r.return_on, accountRole: 'EXP_TRAVEL', amount: calc.total, vat: 0, evidence: 'SIMPLE', item,
                                       memo: `${lines}${memo ? ` · ${memo}` : ''}`.slice(0, 400), attachments: files, requisitionId: r.requisition_id }, v.id);
    const claimId = String(c.id);
    await db.query(`INSERT INTO ofc_trip_settlements (trip_id, claim_id, amount, detail, created_by) VALUES ($1::bigint, $2::bigint, $3::bigint, $4::jsonb, $5::uuid)`,
      [r.id, claimId, calc.total, JSON.stringify(calc), v.id]);
    await db.query(`UPDATE ofc_trips SET state = 'SETTLED', claim_id = $2::bigint, settled_at = now() WHERE id = $1::bigint`, [r.id, claimId]);
    return { ok: true, id: r.id, claimId, amount: calc.total, detail: calc,
             note: `여비 ${won(calc.total)}원을 경비 청구(${claimId}번)로 올렸습니다 — SUPER 승인 뒤 지급 · 전표는 경비 청구 그대로입니다.` };
  });
}

/** PUT /admin/office/trip-standards — SUPER · 사유(설정 바뀜 기록은 site_settings 트리거가 남김) */
export async function setTripStandards(db: DatabaseService, b: { perDiem?: number; meal?: number; seoul?: number; metro?: number; other?: number; reason?: string }) {
  const reason = clean(b.reason);
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('OFC_TRIP_REASON', '사유는 2 ~ 200자입니다.');
  const cur = await tripStandards(db);
  const pick = (x: unknown, d: number, name: string) => {
    if (x === undefined || x === null) return d;
    const n = intIn(x, 0, 9_999_999);
    if (n == null) throw new PolicyViolation('OFC_TRIP_STANDARD', `${name}은(는) 0 ~ 9,999,999원 정수입니다.`);
    return n;
  };
  const perDiem = pick(b.perDiem, cur.perDiem, '일비'), meal = pick(b.meal, cur.meal, '식비');
  const caps = { SEOUL: pick(b.seoul, cur.lodgingCaps.SEOUL ?? 0, '서울 숙박 상한'), METRO: pick(b.metro, cur.lodgingCaps.METRO ?? 0, '광역시 숙박 상한'), OTHER: pick(b.other, cur.lodgingCaps.OTHER ?? 0, '그 밖 숙박 상한') };
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    await db.query(`UPDATE site_settings SET value = $1 WHERE key = 'ofc.trip_per_diem'`, [String(perDiem)]);
    await db.query(`UPDATE site_settings SET value = $1 WHERE key = 'ofc.trip_meal'`, [String(meal)]);
    await db.query(`UPDATE site_settings SET value = $1 WHERE key = 'ofc.trip_lodging_caps'`, [`SEOUL:${caps.SEOUL},METRO:${caps.METRO},OTHER:${caps.OTHER}`]);
  });
  return { ok: true, standards: await tripStandards(db), note: '여비 기준을 바꿨습니다 — 새로 신청하는 출장부터 씁니다(이미 신청한 출장은 신청 때 기준).' };
}
