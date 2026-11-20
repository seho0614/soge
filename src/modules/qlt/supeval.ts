import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.494 (D271 · docs/632) 협력사(공급사) 평가 — 대표 11/20 「㊶ ①」
 *
 *   대상: ⑯ 거래처 대장(acct_parties) 중 매입처(SUPPLIER · BOTH) · 분기(YYYY-Qn)마다 한 줄(qlt_sup_evals).
 *   납기(자동) — ㉑ 국내 발주 중 그 분기에 입고한 것: 납기일(qlt_po_due · 없으면 발주일 + qlt.po_lead_days) ≥ 입고일이면 제때
 *                점수 = 제때 ÷ 입고 발주 × 100(반올림) · 그 분기 입고가 없으면 사람이 넣음(넣지 않으면 100)
 *   품질(제안) — 100 − 10 × 그 분기 클레임 수(반려 뺌 · 0 아래 없음) · 고칠 수 있음
 *   가격 · 대응 — 사람이 0 ~ 100
 *   합계 = 가중 합(qlt.eval_weights 처음 30,40,15,15 · 합 100) · 등급 = qlt.eval_grades(처음 90,80,70) 이상 A · B · C · 나머지 D
 *   확정(FINAL)하면 고치지 않음(DB 도 막음). 숫자는 일반 기준(회사가 바꿀 수 있음 — 설정은 SUPER).
 * ------------------------------------------------------------------- */

export const PERIOD_RE = /^[0-9]{4}-Q[1-4]$/;
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const n = (v: unknown) => Number(v ?? 0);
const idOk = (s?: string) => typeof s === 'string' && /^\d{1,18}$/.test(s);
const isDay = (s?: string) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** 지금 분기(한국 날짜) */
export function thisPeriod() {
  const d = kstToday();
  return `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
}
/** 분기 → 첫날 · 끝날 */
function periodRange(p: string) {
  const y = Number(p.slice(0, 4)), q = Number(p.slice(6, 7));
  const m0 = (q - 1) * 3;
  const from = new Date(Date.UTC(y, m0, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m0 + 3, 0)).toISOString().slice(0, 10);
  return { from, to };
}

async function evalSettings(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key IN ('qlt.po_lead_days', 'qlt.eval_weights', 'qlt.eval_grades')`);
  const m = new Map(rows.map((r) => [r.key, r.value ?? '']));
  const lead = Number(m.get('qlt.po_lead_days'));
  let w = String(m.get('qlt.eval_weights') ?? '').split(',').map(Number);
  if (w.length !== 4 || w.some((x) => !Number.isInteger(x) || x < 0) || w.reduce((a, x) => a + x, 0) !== 100) w = [30, 40, 15, 15];
  let g = String(m.get('qlt.eval_grades') ?? '').split(',').map(Number);
  if (g.length !== 3 || g.some((x) => !Number.isInteger(x) || x < 0 || x > 100) || !(g[0]! >= g[1]! && g[1]! >= g[2]!)) g = [90, 80, 70];
  return { lead: Number.isInteger(lead) && lead >= 1 && lead <= 90 ? lead : 7, weights: w, grades: g };
}

export function gradeOf(total: number, g: number[]) {
  return total >= g[0]! ? 'A' : total >= g[1]! ? 'B' : total >= g[2]! ? 'C' : 'D';
}

/** 거래처들의 그 분기 납기 · 클레임 셈(party 를 주면 그 하나) */
async function metrics(db: DatabaseService, period: string, lead: number, partyId?: string) {
  const { from, to } = periodRange(period);
  const rows = await db.query<{ party_id: string; po_count: number; on_time: number; late_days: number; late_count: number; recv_qty: number; claims: number }>(
    `WITH po AS (
       SELECT o.party_id, o.id, o.received_on, coalesce(d.due_on, o.ordered_on + $3::int) AS due
         FROM acct_pos o LEFT JOIN qlt_po_due d ON d.po_id = o.id
        WHERE o.state = 'RECEIVED' AND o.received_on BETWEEN $1::date AND $2::date AND ($4::text IS NULL OR o.party_id::text = $4)
     )
     SELECT p.id::text AS party_id,
            (SELECT count(*) FROM po WHERE po.party_id = p.id)::int AS po_count,
            (SELECT count(*) FROM po WHERE po.party_id = p.id AND po.received_on <= po.due)::int AS on_time,
            coalesce((SELECT sum(po.received_on - po.due) FROM po WHERE po.party_id = p.id AND po.received_on > po.due), 0)::int AS late_days,
            (SELECT count(*) FROM po WHERE po.party_id = p.id AND po.received_on > po.due)::int AS late_count,
            coalesce((SELECT sum(l.qty) FROM po JOIN acct_po_lines l ON l.po_id = po.id WHERE po.party_id = p.id), 0)::int AS recv_qty,
            (SELECT count(*) FROM qlt_claims c WHERE c.party_id = p.id AND c.state <> 'REJECTED' AND c.received_on BETWEEN $1::date AND $2::date)::int AS claims
       FROM acct_parties p
      WHERE p.kind IN ('SUPPLIER', 'BOTH') AND ($4::text IS NULL OR p.id::text = $4)`, [from, to, lead, partyId ?? null]);
  return new Map(rows.map((r) => {
    const po = n(r.po_count), on = n(r.on_time), lateN = n(r.late_count);
    return [r.party_id, {
      poCount: po, onTime: on, lateAvg: lateN ? Math.round((n(r.late_days) / lateN) * 10) / 10 : 0, recvQty: n(r.recv_qty), claims: n(r.claims),
      delivery: po ? Math.round((on * 100) / po) : null, quality: Math.max(0, 100 - 10 * n(r.claims)),
    }];
  }));
}

/** GET /admin/qlt/suppliers?period= — 매입처마다 그 분기 납기 · 클레임 · 제안 점수 · 저장한 평가 */
export async function listSuppliers(db: DatabaseService, period?: string) {
  const p = PERIOD_RE.test(period ?? '') ? period! : thisPeriod();
  const s = await evalSettings(db);
  const mt = await metrics(db, p, s.lead);
  const parties = await db.query<{ id: string; name: string; kind: string; state: string; bizStatus: string | null }>(
    `SELECT id::text AS id, name, kind, state, biz_status AS "bizStatus" FROM acct_parties WHERE kind IN ('SUPPLIER', 'BOTH') ORDER BY state, lower(name) LIMIT 500`);
  const evals = await db.query<Record<string, unknown>>(
    `SELECT id::text AS id, party_id::text AS "partyId", delivery_score AS delivery, quality_score AS quality, price_score AS price, response_score AS response,
            total::float8 AS total, grade, state, memo, confirmed_at AS "confirmedAt" FROM qlt_sup_evals WHERE period = $1`, [p]);
  const byParty = new Map(evals.map((e) => [String(e.partyId), e]));
  const items = parties
    .map((x) => ({ ...x, metrics: mt.get(x.id) ?? null, eval: byParty.get(x.id) ?? null }))
    .filter((x) => x.state === 'ACTIVE' || x.eval || (x.metrics?.poCount ?? 0) > 0);
  const grades: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const e of evals) grades[String(e.grade)] = (grades[String(e.grade)] ?? 0) + 1;
  return { period: p, items, grades, weights: s.weights, gradeCut: s.grades, leadDays: s.lead, openPos: await openPos(db),
    note: `납기는 그 분기에 입고한 국내 발주로 자동 셉니다(납기일이 없으면 발주일 + ${s.lead}일). 품질은 클레임 수로 제안하고, 가격 · 대응은 직접 매깁니다.` };
}

/** GET /admin/qlt/suppliers/{id} — 한 매입처의 평가 지난 기록 · 최근 발주 납기 · 클레임 */
export async function supplierDetail(db: DatabaseService, id: string) {
  if (!idOk(id)) throw new NotFound('없는 거래처입니다.');
  const [p] = await db.query<{ id: string; name: string; kind: string; state: string }>(`SELECT id::text AS id, name, kind, state FROM acct_parties WHERE id = $1::bigint`, [id]);
  if (!p) throw new NotFound('없는 거래처입니다.');
  const s = await evalSettings(db);
  const evals = await db.query(
    `SELECT id::text AS id, period, po_count AS "poCount", on_time AS "onTime", late_days::float8 AS "lateAvg", claim_count AS claims,
            delivery_score AS delivery, quality_score AS quality, price_score AS price, response_score AS response, weights, total::float8 AS total, grade, state, memo,
            confirmed_at AS "confirmedAt" FROM qlt_sup_evals WHERE party_id = $1::bigint ORDER BY period DESC LIMIT 40`, [id]);
  const pos = await db.query<Record<string, unknown>>(
    `SELECT o.id::text AS id, o.title, o.state, o.ordered_on::text AS "orderedOn", d.due_on::text AS "dueSet", (coalesce(d.due_on, o.ordered_on + $2::int))::text AS due,
            o.received_on::text AS "receivedOn", CASE WHEN o.received_on IS NOT NULL THEN greatest(o.received_on - coalesce(d.due_on, o.ordered_on + $2::int), 0) END AS "lateDays"
       FROM acct_pos o LEFT JOIN qlt_po_due d ON d.po_id = o.id WHERE o.party_id = $1::bigint ORDER BY o.ordered_on DESC, o.id DESC LIMIT 50`, [id, s.lead]);
  const claims = await db.query(
    `SELECT c.id::text AS id, c.received_on::text AS "receivedOn", c.defect_type AS "defectType", c.title, c.qty, c.state, p.name AS product
       FROM qlt_claims c JOIN hlt_products p ON p.id = c.product_id WHERE c.party_id = $1::bigint ORDER BY c.received_on DESC, c.id DESC LIMIT 50`, [id]);
  return { party: p, evals, pos: pos.map((x) => ({ ...x, lateDays: x.lateDays == null ? null : n(x.lateDays) })), claims, leadDays: s.lead };
}

export interface EvalInput { partyId: string; period: string; priceScore: number; responseScore: number; qualityScore?: number; deliveryScore?: number; memo?: string }

/** POST /admin/qlt/suppliers/evals — 평가 저장(초안 · 같은 분기는 덮어씀 · 납기는 입고 자료가 있으면 늘 자동) */
export async function saveEval(db: DatabaseService, b: EvalInput, actor: string | null) {
  if (!idOk(b.partyId)) throw new NotFound('없는 거래처입니다.');
  if (!PERIOD_RE.test(b.period ?? '')) throw new PolicyViolation('QLT_EVAL', '분기는 YYYY-Q1 ~ Q4 모양입니다.');
  if (b.period > thisPeriod()) throw new PolicyViolation('QLT_EVAL', '앞 분기는 평가하지 않습니다.');
  const [p] = await db.query<{ kind: string; name: string }>(`SELECT kind, name FROM acct_parties WHERE id = $1::bigint`, [b.partyId]);
  if (!p) throw new NotFound('없는 거래처입니다.');
  if (!['SUPPLIER', 'BOTH'].includes(p.kind)) throw new PolicyViolation('QLT_PARTY', '매입처(공급사) 거래처만 평가합니다.');
  const score = (v: unknown) => {
    const x = Math.round(Number(v));
    if (!(Number.isInteger(x) && x >= 0 && x <= 100)) throw new PolicyViolation('QLT_EVAL', '점수는 0 ~ 100 입니다.');
    return x;
  };
  const s = await evalSettings(db);
  const m = (await metrics(db, b.period, s.lead, b.partyId)).get(b.partyId)!;
  const delivery = m.delivery ?? (b.deliveryScore == null ? 100 : score(b.deliveryScore));
  const quality = b.qualityScore == null ? m.quality : score(b.qualityScore);
  const price = score(b.priceScore), response = score(b.responseScore);
  const w = s.weights;
  const total = Math.round(((delivery * w[0]! + quality * w[1]! + price * w[2]! + response * w[3]!) / 100) * 10) / 10;
  const grade = gradeOf(total, s.grades);
  const [cur] = await db.query<{ state: string }>(`SELECT state FROM qlt_sup_evals WHERE party_id = $1::bigint AND period = $2`, [b.partyId, b.period]);
  if (cur?.state === 'FINAL') throw new StateConflict('QLT_EVAL_STATE', '확정한 평가는 고치지 않습니다.');
  const memo = String(b.memo ?? '').trim().slice(0, 400) || null;
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO qlt_sup_evals (party_id, period, po_count, on_time, late_days, claim_count, delivery_score, quality_score, price_score, response_score, weights, total, grade, memo, created_by)
     VALUES ($1::bigint, $2, $3::int, $4::int, $5::numeric, $6::int, $7::int, $8::int, $9::int, $10::int, $11, $12::numeric, $13, $14, $15)
     ON CONFLICT (party_id, period) DO UPDATE SET po_count = EXCLUDED.po_count, on_time = EXCLUDED.on_time, late_days = EXCLUDED.late_days, claim_count = EXCLUDED.claim_count,
       delivery_score = EXCLUDED.delivery_score, quality_score = EXCLUDED.quality_score, price_score = EXCLUDED.price_score, response_score = EXCLUDED.response_score,
       weights = EXCLUDED.weights, total = EXCLUDED.total, grade = EXCLUDED.grade, memo = EXCLUDED.memo
     RETURNING id::text AS id`,
    [b.partyId, b.period, m.poCount, m.onTime, m.lateAvg, m.claims, delivery, quality, price, response, w.join(','), total, grade, memo, actor]);
  return { ok: true, id: r!.id, period: b.period, delivery, quality, price, response, total, grade,
    deliveryAuto: m.poCount > 0,
    note: m.poCount
      ? `${p.name} ${b.period} 평가를 저장했습니다 — 합계 ${total}점 · ${grade} 등급(납기는 입고 자료로 자동). 확정하면 고치지 않습니다.`
      : `${p.name} ${b.period} 평가를 저장했습니다 — 합계 ${total}점 · ${grade} 등급(그 분기 입고가 없어 납기는 직접). 확정하면 고치지 않습니다.` };
}

/** POST /admin/qlt/suppliers/evals/{id}/confirm — 확정(고치지 않음) */
export async function confirmEval(db: DatabaseService, id: string, actor: string | null) {
  if (!idOk(id)) throw new NotFound('없는 평가입니다.');
  const [e] = await db.query<{ state: string; period: string }>(`SELECT state, period FROM qlt_sup_evals WHERE id = $1::bigint`, [id]);
  if (!e) throw new NotFound('없는 평가입니다.');
  if (e.state === 'FINAL') throw new StateConflict('QLT_EVAL_STATE', '이미 확정한 평가입니다.');
  await db.query(`UPDATE qlt_sup_evals SET state = 'FINAL', confirmed_by = $2, confirmed_at = now() WHERE id = $1::bigint`, [id, actor]);
  return { ok: true, id, state: 'FINAL', note: `${e.period} 평가를 확정했습니다.` };
}

/** PUT /admin/qlt/pos/{id}/due — 국내 발주 납기일(발주 상태일 때만) */
export async function setPoDue(db: DatabaseService, id: string, dueOn: string, actor: string | null) {
  if (!idOk(id)) throw new NotFound('없는 발주입니다.');
  if (!isDay(dueOn)) throw new PolicyViolation('QLT_PO_DUE', '납기일(YYYY-MM-DD)을 넣으십시오.');
  const [po] = await db.query<{ state: string; ordered_on: string; title: string }>(`SELECT state, ordered_on::text AS ordered_on, title FROM acct_pos WHERE id = $1::bigint`, [id]);
  if (!po) throw new NotFound('없는 발주입니다.');
  if (po.state !== 'ORDERED') throw new StateConflict('QLT_PO_STATE', '발주 상태인 것만 납기일을 넣고 고칩니다(입고 · 취소 뒤에는 그대로).');
  if (dueOn < po.ordered_on) throw new PolicyViolation('QLT_PO_DUE', '납기일은 발주일 뒤여야 합니다.');
  await db.query(
    `INSERT INTO qlt_po_due (po_id, due_on, set_by) VALUES ($1::bigint, $2::date, $3)
     ON CONFLICT (po_id) DO UPDATE SET due_on = EXCLUDED.due_on, set_by = EXCLUDED.set_by`, [id, dueOn, actor]);
  return { ok: true, id, dueOn, note: `발주 ${id}번(${po.title}) 납기일을 ${dueOn} 로 넣었습니다.` };
}

/** 납기일을 넣을 수 있는 발주(발주 상태) — 화면 고르기용 */
export async function openPos(db: DatabaseService) {
  const s = await evalSettings(db);
  return db.query(
    `SELECT o.id::text AS id, o.title, p.name AS "partyName", o.ordered_on::text AS "orderedOn", d.due_on::text AS "dueSet", (coalesce(d.due_on, o.ordered_on + $1::int))::text AS due
       FROM acct_pos o JOIN acct_parties p ON p.id = o.party_id LEFT JOIN qlt_po_due d ON d.po_id = o.id
      WHERE o.state = 'ORDERED' ORDER BY o.ordered_on DESC, o.id DESC LIMIT 200`, [s.lead]);
}
