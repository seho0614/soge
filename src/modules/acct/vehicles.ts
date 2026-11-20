import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.475 (D266 · docs/613) 업무용 차량 운행기록부 — 대표 11/20 「㊱」
 *   차량 · 운행(출퇴근 · 업무 · 비업무 · 계기판 전 · 후) · 비용(주유 · 정비 · 보험 · 세금 · 리스 · 감가상각 상당액 · 통행료 · 기타)
 *   해마다(1 ~ 12월) 업무 사용 비율 · 손금 인정 셈 — 일반 원칙(법인세법 시행령 50조의2 · 세무사 확인 · 값은 SUPER 가 설정에서 고침):
 *     운행기록부 있음(그해 운행 줄 ≥ 1) : 업무 사용 비율 = (출퇴근 + 업무) 거리 ÷ 전체 거리
 *     운행기록부 없음                    : 비율 = min(1, acct.vehicle_nolog_limit × 보유 달 ÷ 12 ÷ 관련 비용)
 *     업무 사용 금액 = 관련 비용 × 비율 · 그중 감가상각비(상당액) 몫이 acct.vehicle_dep_limit × 보유 달 ÷ 12 를 넘으면 넘은 몫은 그해 불인정(다음 해 이월)
 *     업무전용 자동차보험이 없으면(승용차 · 법인) 관련 비용 모두 불인정
 *     구분 EXCLUDED(경차 · 9인승 이상 · 화물 등)는 규정 대상 아님 → 모두 인정
 *   전표는 만들지 않음 — 비용 전표는 ⑫ 매입 · 경비 청구가 이미 잡음(같은 매입을 비용에 걸 수 있음 · 한 번만). 이 대장은 운행기록부 서식 · 세무조정 자료.
 *   운전자 · 부서는 이름 글자만(주민번호 · 연락처 없음) · /admin/acct/ 아래라 세무사(ACCOUNTANT)가 읽음(운행기록부는 세무 증빙).
 * ------------------------------------------------------------------- */

export const PLATE_RE = /^([가-힣]{2})?[0-9]{2,3}[가-힣][0-9]{4}$/;   // DB CHECK acct_vehicles.plate 와 같음(빈칸은 걷어 내고 봄)
export const CAR_CLASSES = ['PASSENGER', 'EXCLUDED'] as const;
export const OWNERSHIPS = ['OWNED', 'LEASE', 'RENT'] as const;
export const TRIP_PURPOSES = ['COMMUTE', 'BUSINESS', 'PERSONAL'] as const;
export const COST_KINDS = ['FUEL', 'REPAIR', 'INSURANCE', 'TAX', 'LEASE', 'DEPRECIATION', 'TOLL', 'OTHER'] as const;
export const PURPOSE_KO: Record<string, string> = { COMMUTE: '출퇴근', BUSINESS: '업무', PERSONAL: '비업무' };
export const COST_KO: Record<string, string> = { FUEL: '주유', REPAIR: '정비', INSURANCE: '보험', TAX: '자동차세', LEASE: '리스 · 렌트료', DEPRECIATION: '감가상각(상당액)', TOLL: '통행료 · 주차', OTHER: '기타' };
export const CLASS_KO: Record<string, string> = { PASSENGER: '업무용승용차(규정 대상)', EXCLUDED: '대상 아님(경차 · 9인승 이상 · 화물 등)' };
export const OWN_KO: Record<string, string> = { OWNED: '자가', LEASE: '리스', RENT: '렌트' };

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const isDay = (d?: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const n = (v: unknown) => Number(v ?? 0);
const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null;
const idOk = (id: string, what = '없는 차량입니다.') => { if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound(what); return id; };
const reasonOk = (r?: string) => {
  const t = (r ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  return t;
};

async function limits(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key IN ('acct.vehicle_nolog_limit', 'acct.vehicle_dep_limit', 'acct.policy_basis')`);
  const v = (k: string, d: number) => { const x = Number(rows.find((r) => r.key === k)?.value ?? d); return Number.isFinite(x) && x >= 0 ? Math.trunc(x) : d; };
  return { nolog: v('acct.vehicle_nolog_limit', 15_000_000), dep: v('acct.vehicle_dep_limit', 8_000_000),
           basis: rows.find((r) => r.key === 'acct.policy_basis')?.value ?? 'GENERAL_2026' };
}

/** 그해 보유 달 수(1일이라도 있으면 한 달 · 월할) */
export function heldMonths(year: number, acquiredOn: string, disposedOn: string | null) {
  const from = acquiredOn > `${year}-01-01` ? acquiredOn : `${year}-01-01`;
  const to = disposedOn && disposedOn < `${year}-12-31` ? disposedOn : `${year}-12-31`;
  if (to < from) return 0;
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
}

export interface VehicleYearIn { carClass: string; bizInsurance: boolean; acquiredOn: string; disposedOn: string | null; totalKm: number; bizKm: number; trips: number; cost: number; dep: number }
/** 해 셈(순수 함수 · 시험이 같은 값을 다시 셈) */
export function vehicleYear(year: number, v: VehicleYearIn, lim: { nolog: number; dep: number }) {
  const months = heldMonths(year, v.acquiredOn, v.disposedOn);
  const logKept = v.trips > 0 && v.totalKm > 0;
  if (v.carClass === 'EXCLUDED') {
    return { year, months, logKept, ratio: 1, bizCost: v.cost, depBiz: v.dep, depLimit: null as number | null, depOver: 0, allowed: v.cost, disallowed: 0,
             rule: 'EXCLUDED', note: '업무용승용차 규정 대상이 아닌 차량 — 관련 비용을 모두 인정(일반 원칙 · 세무사 확인).' };
  }
  if (!v.bizInsurance) {
    return { year, months, logKept, ratio: 0, bizCost: 0, depBiz: 0, depLimit: Math.round(lim.dep * months / 12), depOver: 0, allowed: 0, disallowed: v.cost,
             rule: 'NO_INSURANCE', note: '업무전용 자동차보험이 없음 — 관련 비용을 모두 인정하지 않습니다(법인 · 일반 원칙 · 세무사 확인).' };
  }
  const nologCap = Math.round(lim.nolog * months / 12);
  const ratio = logKept ? Math.min(1, v.bizKm / v.totalKm) : (v.cost <= 0 ? 1 : Math.min(1, nologCap / v.cost));
  const bizCost = Math.round(v.cost * ratio);
  const depBiz = Math.round(v.dep * ratio);
  const depLimit = Math.round(lim.dep * months / 12);
  const depOver = Math.max(0, depBiz - depLimit);
  const allowed = bizCost - depOver;
  return { year, months, logKept, ratio: Math.round(ratio * 10000) / 10000, bizCost, depBiz, depLimit, depOver, allowed, disallowed: v.cost - allowed,
           rule: logKept ? 'LOG' : 'NO_LOG',
           note: logKept ? '운행기록부 거리 비율로 셈 — 감가상각비 한도를 넘은 몫은 다음 해로 이월(일반 원칙 · 세무사 확인).'
                         : `운행기록부가 없어 비용 ${nologCap.toLocaleString('ko-KR')}원(보유 ${months}달)까지만 인정 — 일반 원칙 · 세무사 확인.` };
}

async function yearNumbers(db: DatabaseService, id: string, year: number) {
  const [t] = await db.query<{ total: string; biz: string; trips: number }>(
    `SELECT coalesce(sum(distance), 0)::text AS total, coalesce(sum(distance) FILTER (WHERE purpose IN ('COMMUTE', 'BUSINESS')), 0)::text AS biz, count(*)::int AS trips
       FROM acct_vehicle_trips WHERE vehicle_id = $1::bigint AND state = 'ACTIVE' AND trip_on BETWEEN $2::date AND $3::date`, [id, `${year}-01-01`, `${year}-12-31`]);
  const byKind = await db.query<{ kind: string; amt: string; cnt: number; liters: string | null }>(
    `SELECT kind, sum(amount)::text AS amt, count(*)::int AS cnt, sum(liters)::text AS liters
       FROM acct_vehicle_costs WHERE vehicle_id = $1::bigint AND state = 'ACTIVE' AND cost_on BETWEEN $2::date AND $3::date GROUP BY kind`, [id, `${year}-01-01`, `${year}-12-31`]);
  const cost = byKind.reduce((a, r) => a + n(r.amt), 0);
  const dep = n(byKind.find((r) => r.kind === 'DEPRECIATION')?.amt);
  return { totalKm: n(t?.total), bizKm: n(t?.biz), trips: n(t?.trips), cost, dep,
           byKind: byKind.map((r) => ({ kind: r.kind, label: COST_KO[r.kind] ?? r.kind, amount: n(r.amt), count: r.cnt, liters: r.liters == null ? null : n(r.liters) })) };
}

const VCOLS = `v.id::text AS id, v.plate, v.name, v.car_class AS "carClass", v.ownership, v.acquired_on::text AS "acquiredOn", v.disposed_on::text AS "disposedOn",
               v.acquire_cost::bigint AS "acquireCost", v.biz_insurance AS "bizInsurance", v.insurance_until::text AS "insuranceUntil", v.active, v.memo, v.created_at AS "createdAt"`;

/** GET /admin/acct/vehicles?year= — 차량 목록 · 그해 셈 */
export async function listVehicles(db: DatabaseService, yearIn?: string) {
  const year = /^\d{4}$/.test(yearIn ?? '') ? Number(yearIn) : Number(kstToday().slice(0, 4));
  const lim = await limits(db);
  const rows = await db.query<any>('SELECT ' + VCOLS + ' FROM acct_vehicles v ORDER BY v.active DESC, v.plate LIMIT 200');
  const items: any[] = [];
  for (const r of rows) {
    const y = await yearNumbers(db, r.id, year);
    const calc = vehicleYear(year, { carClass: r.carClass, bizInsurance: r.bizInsurance, acquiredOn: r.acquiredOn, disposedOn: r.disposedOn, ...y }, lim);
    items.push({ ...r, acquireCost: n(r.acquireCost), classKo: CLASS_KO[r.carClass], ownershipKo: OWN_KO[r.ownership], totalKm: y.totalKm, bizKm: y.bizKm, trips: y.trips, cost: y.cost, calc,
                 insuranceSoon: !!r.insuranceUntil && r.insuranceUntil <= new Date(Date.now() + 9 * 3600e3 + 30 * 86400e3).toISOString().slice(0, 10) });
  }
  return { year, items, limits: lim, kinds: COST_KO, purposes: PURPOSE_KO, classes: CLASS_KO, ownerships: OWN_KO,
    total: { cost: items.reduce((a, x) => a + x.cost, 0), allowed: items.reduce((a, x) => a + x.calc.allowed, 0), disallowed: items.reduce((a, x) => a + x.calc.disallowed, 0) },
    note: '운행기록부(출퇴근 · 업무 · 비업무 거리)로 업무 사용 비율을 셉니다. 비용 한도 · 감가상각비 한도는 일반 원칙 값(정책 › 전체 설정 acct.vehicle_nolog_limit · acct.vehicle_dep_limit · SUPER) — 세무사 확인. 전표는 매입 · 경비 청구가 잡고 여기는 손금 인정 셈만입니다.' };
}

/** GET /admin/acct/vehicles/{id}?year= — 그해 운행 · 비용 · 셈 · 운행기록부 서식 줄 */
export async function vehicleDetail(db: DatabaseService, id: string, yearIn?: string) {
  idOk(id);
  const year = /^\d{4}$/.test(yearIn ?? '') ? Number(yearIn) : Number(kstToday().slice(0, 4));
  const [v] = await db.query<any>('SELECT ' + VCOLS + ' FROM acct_vehicles v WHERE v.id = $1::bigint', [id]);
  if (!v) throw new NotFound('없는 차량입니다.');
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const trips = await db.query<any>(
    `SELECT id::text AS id, trip_on::text AS "tripOn", driver, dept, purpose, from_place AS "fromPlace", to_place AS "toPlace", odo_start AS "odoStart", odo_end AS "odoEnd",
            distance, memo, state, cancel_note AS "cancelNote", created_at AS "createdAt"
       FROM acct_vehicle_trips WHERE vehicle_id = $1::bigint AND trip_on BETWEEN $2::date AND $3::date ORDER BY trip_on, odo_start, id LIMIT 2000`, [id, from, to]);
  const costs = await db.query<any>(
    `SELECT c.id::text AS id, c.cost_on::text AS "costOn", c.kind, c.amount::bigint AS amount, c.liters::float8 AS liters, c.purchase_id::text AS "purchaseId", c.memo, c.state,
            c.cancel_note AS "cancelNote", p.item AS "purchaseItem"
       FROM acct_vehicle_costs c LEFT JOIN acct_purchases p ON p.id = c.purchase_id
      WHERE c.vehicle_id = $1::bigint AND c.cost_on BETWEEN $2::date AND $3::date ORDER BY c.cost_on, c.id LIMIT 2000`, [id, from, to]);
  const lim = await limits(db);
  const y = await yearNumbers(db, id, year);
  const calc = vehicleYear(year, { carClass: v.carClass, bizInsurance: v.bizInsurance, acquiredOn: v.acquiredOn, disposedOn: v.disposedOn, ...y }, lim);
  /* 계기판 끊김 — 쓰는 줄을 날짜 · 출발 계기판 차례로 놓고 앞 줄 도착 ≠ 이 줄 출발이면 표시(막지는 않음 · 다른 차를 탄 날 등) */
  const act = trips.filter((t: any) => t.state === 'ACTIVE');
  const gaps: Array<{ tripId: string; prevEnd: number; start: number }> = [];
  for (let i = 1; i < act.length; i++) if (n(act[i].odoStart) !== n(act[i - 1].odoEnd)) gaps.push({ tripId: act[i].id, prevEnd: n(act[i - 1].odoEnd), start: n(act[i].odoStart) });
  /* 국세청 「업무용승용차 운행기록부」 서식 차례(사용일자 · 부서 · 성명 · 주행 전 · 후 계기판 · 주행거리 · 출퇴근용 · 일반 업무용 · 비고) */
  const log = act.map((t: any) => ({ date: t.tripOn, dept: t.dept ?? '', driver: t.driver, before: n(t.odoStart), after: n(t.odoEnd), km: n(t.distance),
    commute: t.purpose === 'COMMUTE' ? n(t.distance) : 0, business: t.purpose === 'BUSINESS' ? n(t.distance) : 0,
    note: [t.fromPlace && t.toPlace ? `${t.fromPlace} → ${t.toPlace}` : t.fromPlace ?? t.toPlace ?? '', t.purpose === 'PERSONAL' ? '비업무' : '', t.memo ?? ''].filter(Boolean).join(' · ') }));
  return { vehicle: { ...v, acquireCost: n(v.acquireCost), classKo: CLASS_KO[v.carClass], ownershipKo: OWN_KO[v.ownership] }, year,
           trips: trips.map((t: any) => ({ ...t, purposeKo: PURPOSE_KO[t.purpose] })), costs: costs.map((c: any) => ({ ...c, amount: n(c.amount), kindKo: COST_KO[c.kind] })),
           byKind: y.byKind, totalKm: y.totalKm, bizKm: y.bizKm, calc, limits: lim, gaps, log,
           lastOdo: act.length ? n(act[act.length - 1].odoEnd) : null };
}

export interface VehicleIn { plate?: string; name?: string; carClass?: string; ownership?: string; acquiredOn?: string; disposedOn?: string; acquireCost?: number; bizInsurance?: boolean; insuranceUntil?: string; active?: boolean; memo?: string }

/** POST /admin/acct/vehicles */
export async function addVehicle(db: DatabaseService, b: VehicleIn, actor: string | null) {
  const plate = String(b.plate ?? '').replace(/\s+/g, '');
  if (!PLATE_RE.test(plate)) throw new PolicyViolation('VEH_PLATE', '차량 번호 형식이 아닙니다(예: 12가3456 · 123가4567 · 서울12가3456).');
  const name = clean(b.name, 40);
  if (!name) throw new PolicyViolation('VEH_NAME', '차량 이름(차종)을 넣으십시오.');
  if (!(CAR_CLASSES as readonly string[]).includes(b.carClass ?? 'PASSENGER')) throw new PolicyViolation('VEH_CLASS', '차량 구분을 고르십시오.');
  if (!(OWNERSHIPS as readonly string[]).includes(b.ownership ?? 'OWNED')) throw new PolicyViolation('VEH_OWNERSHIP', '소유 방식을 고르십시오.');
  if (!isDay(b.acquiredOn) || b.acquiredOn! > kstToday()) throw new PolicyViolation('VEH_DATE', '취득(계약)일(YYYY-MM-DD · 앞날 안 됨)을 넣으십시오.');
  if (b.insuranceUntil && !isDay(b.insuranceUntil)) throw new PolicyViolation('VEH_DATE', '보험 만기일이 맞지 않습니다.');
  const [dup] = await db.query(`SELECT 1 FROM acct_vehicles WHERE plate = $1`, [plate]);
  if (dup) throw new StateConflict('VEH_PLATE_DUP', '이미 넣은 차량 번호입니다.');
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO acct_vehicles (plate, name, car_class, ownership, acquired_on, acquire_cost, biz_insurance, insurance_until, memo, created_by)
     VALUES ($1, $2, $3, $4, $5::date, $6::bigint, $7, $8::date, $9, $10) RETURNING id::text AS id`,
    [plate, name, b.carClass ?? 'PASSENGER', b.ownership ?? 'OWNED', b.acquiredOn, Math.max(0, Math.trunc(n(b.acquireCost))), !!b.bizInsurance, b.insuranceUntil || null, clean(b.memo, 200), actor]);
  return { ok: true, id: r!.id, note: b.bizInsurance ? '차량을 넣었습니다.' : '차량을 넣었습니다 — 업무전용 자동차보험이 없으면(승용차) 비용이 인정되지 않습니다. 가입했으면 표시하십시오.' };
}

/** PUT /admin/acct/vehicles/{id} — 보낸 칸만(번호는 못 고침) */
export async function updateVehicle(db: DatabaseService, id: string, b: VehicleIn) {
  idOk(id);
  const [cur] = await db.query<any>('SELECT ' + VCOLS + ' FROM acct_vehicles v WHERE v.id = $1::bigint', [id]);
  if (!cur) throw new NotFound('없는 차량입니다.');
  if (b.plate !== undefined && String(b.plate).replace(/\s+/g, '') !== cur.plate) throw new StateConflict('VEH_PLATE_FIXED', '차량 번호는 바꾸지 않습니다(새 차량으로 넣으십시오).');
  /* 보낸 칸만 바꿈(안 보낸 칸은 undefined — 그대로) · SQL 은 고정 · 값은 $n 만 */
  const has = (v: unknown) => v !== undefined;
  let name: string | null = null, disposed: string | null = null, cost: number | null = null, insUntil: string | null = null;
  if (has(b.name)) { name = clean(b.name, 40); if (!name) throw new PolicyViolation('VEH_NAME', '차량 이름(차종)을 넣으십시오.'); }
  if (has(b.carClass) && !(CAR_CLASSES as readonly string[]).includes(String(b.carClass))) throw new PolicyViolation('VEH_CLASS', '차량 구분을 고르십시오.');
  if (has(b.ownership) && !(OWNERSHIPS as readonly string[]).includes(String(b.ownership))) throw new PolicyViolation('VEH_OWNERSHIP', '소유 방식을 고르십시오.');
  if (has(b.acquiredOn) && (!isDay(b.acquiredOn) || b.acquiredOn! > kstToday())) throw new PolicyViolation('VEH_DATE', '취득(계약)일(YYYY-MM-DD · 앞날 안 됨)을 넣으십시오.');
  if (has(b.disposedOn)) {
    disposed = b.disposedOn || null;
    if (disposed && (!isDay(disposed) || disposed < (b.acquiredOn ?? cur.acquiredOn))) throw new PolicyViolation('VEH_DATE', '처분일은 취득일 뒤 날짜입니다.');
  }
  if (has(b.acquireCost)) { cost = Math.trunc(n(b.acquireCost)); if (cost < 0 || cost > 10_000_000_000) throw new PolicyViolation('VEH_COST', '취득가가 맞지 않습니다.'); }
  if (has(b.insuranceUntil)) { insUntil = b.insuranceUntil || null; if (insUntil && !isDay(insUntil)) throw new PolicyViolation('VEH_DATE', '보험 만기일이 맞지 않습니다.'); }
  const keys: Array<keyof VehicleIn> = ['name', 'carClass', 'ownership', 'acquiredOn', 'disposedOn', 'acquireCost', 'bizInsurance', 'insuranceUntil', 'active', 'memo'];
  if (!keys.some((k) => has(b[k]))) throw new PolicyViolation('VEH_EMPTY', '바꿀 칸이 없습니다.');
  await db.query(
    `UPDATE acct_vehicles
        SET name            = CASE WHEN $2  THEN $3 ELSE name END,
            car_class       = CASE WHEN $4  THEN $5 ELSE car_class END,
            ownership       = CASE WHEN $6  THEN $7 ELSE ownership END,
            acquired_on     = CASE WHEN $8  THEN $9::date ELSE acquired_on END,
            disposed_on     = CASE WHEN $10 THEN $11::date ELSE disposed_on END,
            acquire_cost    = CASE WHEN $12 THEN $13::bigint ELSE acquire_cost END,
            biz_insurance   = CASE WHEN $14 THEN $15::boolean ELSE biz_insurance END,
            insurance_until = CASE WHEN $16 THEN $17::date ELSE insurance_until END,
            active          = CASE WHEN $18 THEN $19::boolean ELSE active END,
            memo            = CASE WHEN $20 THEN $21 ELSE memo END
      WHERE id = $1::bigint`,
    [id, has(b.name), name, has(b.carClass), b.carClass ?? null, has(b.ownership), b.ownership ?? null, has(b.acquiredOn), b.acquiredOn ?? null,
     has(b.disposedOn), disposed, has(b.acquireCost), cost, has(b.bizInsurance), !!b.bizInsurance, has(b.insuranceUntil), insUntil,
     has(b.active), !!b.active, has(b.memo), clean(b.memo, 200)]);
  return { ok: true, id, note: '차량 정보를 고쳤습니다.' };
}

export interface TripIn { tripOn: string; driver: string; dept?: string; purpose: string; fromPlace?: string; toPlace?: string; odoStart: number; odoEnd: number; memo?: string }

/** POST /admin/acct/vehicles/{id}/trips — 운행 한 줄(앞 줄 도착 계기판과 다르면 안내만) */
export async function addTrip(db: DatabaseService, id: string, b: TripIn, actor: string | null) {
  idOk(id);
  const [v] = await db.query<{ acquired_on: string; disposed_on: string | null; active: boolean }>(
    `SELECT acquired_on::text AS acquired_on, disposed_on::text AS disposed_on, active FROM acct_vehicles WHERE id = $1::bigint`, [id]);
  if (!v) throw new NotFound('없는 차량입니다.');
  if (!v.active) throw new StateConflict('VEH_INACTIVE', '끈 차량에는 운행을 넣지 않습니다.');
  if (!isDay(b.tripOn) || b.tripOn > kstToday() || b.tripOn < v.acquired_on || (v.disposed_on && b.tripOn > v.disposed_on)) throw new PolicyViolation('VEH_DATE', '운행일은 취득일부터 오늘(처분일)까지입니다.');
  const driver = clean(b.driver, 40);
  if (!driver) throw new PolicyViolation('VEH_DRIVER', '운전자 이름을 넣으십시오.');
  if (!(TRIP_PURPOSES as readonly string[]).includes(b.purpose)) throw new PolicyViolation('VEH_PURPOSE', '목적(출퇴근 · 업무 · 비업무)을 고르십시오.');
  const s = Math.trunc(n(b.odoStart)), e = Math.trunc(n(b.odoEnd));
  if (s < 0 || e > 9_999_999 || e <= s || e - s > 3000) throw new PolicyViolation('VEH_ODO', '계기판 거리는 도착이 출발보다 크고 한 번에 3,000km 까지입니다.');
  const [prev] = await db.query<{ odo_end: number }>(
    `SELECT odo_end FROM acct_vehicle_trips WHERE vehicle_id = $1::bigint AND state = 'ACTIVE' AND (trip_on, odo_start) < ($2::date, $3::int) ORDER BY trip_on DESC, odo_start DESC, id DESC LIMIT 1`,
    [id, b.tripOn, s]);
  const [r] = await db.query<{ id: string; distance: number }>(
    `INSERT INTO acct_vehicle_trips (vehicle_id, trip_on, driver, dept, purpose, from_place, to_place, odo_start, odo_end, memo, created_by)
     VALUES ($1::bigint, $2::date, $3, $4, $5, $6, $7, $8::int, $9::int, $10, $11) RETURNING id::text AS id, distance`,
    [id, b.tripOn, driver, clean(b.dept, 40), b.purpose, clean(b.fromPlace, 60), clean(b.toPlace, 60), s, e, clean(b.memo, 200), actor]);
  const gap = prev && n(prev.odo_end) !== s;
  return { ok: true, id: r!.id, distance: n(r!.distance), gap: gap ? { prevEnd: n(prev!.odo_end), start: s } : null,
           note: gap ? `운행을 넣었습니다(${n(r!.distance)}km) — 앞 운행 도착 계기판 ${n(prev!.odo_end).toLocaleString('ko-KR')}km 와 이어지지 않습니다. 빠진 운행이 있으면 넣으십시오.`
                     : `운행을 넣었습니다(${n(r!.distance)}km).` };
}

export interface CostIn { costOn: string; kind: string; amount: number; liters?: number; purchaseId?: string; memo?: string }

/** POST /admin/acct/vehicles/{id}/costs */
export async function addCost(db: DatabaseService, id: string, b: CostIn, actor: string | null) {
  idOk(id);
  const [v] = await db.query<{ acquired_on: string }>(`SELECT acquired_on::text AS acquired_on FROM acct_vehicles WHERE id = $1::bigint`, [id]);
  if (!v) throw new NotFound('없는 차량입니다.');
  if (!isDay(b.costOn) || b.costOn > kstToday()) throw new PolicyViolation('VEH_DATE', '비용 날짜(YYYY-MM-DD · 앞날 안 됨)를 넣으십시오.');
  if (!(COST_KINDS as readonly string[]).includes(b.kind)) throw new PolicyViolation('VEH_COST_KIND', '비용 종류를 고르십시오.');
  const amt = Math.trunc(n(b.amount));
  if (amt < 1 || amt > 10_000_000_000) throw new PolicyViolation('VEH_COST', '금액은 1원 이상입니다.');
  const liters = b.liters == null ? null : Number(b.liters);
  if (liters != null && (!(liters > 0) || liters > 10000)) throw new PolicyViolation('VEH_COST', '주유량(L)이 맞지 않습니다.');
  let purchaseId: string | null = null;
  if (b.purchaseId) {
    if (!/^\d{1,18}$/.test(b.purchaseId)) throw new PolicyViolation('VEH_PURCHASE', '없는 매입입니다.');
    const [p] = await db.query(`SELECT 1 FROM acct_purchases WHERE id = $1::bigint`, [b.purchaseId]);
    if (!p) throw new PolicyViolation('VEH_PURCHASE', '없는 매입입니다.');
    const [used] = await db.query(`SELECT 1 FROM acct_vehicle_costs WHERE purchase_id = $1::bigint AND state = 'ACTIVE'`, [b.purchaseId]);
    if (used) throw new StateConflict('VEH_PURCHASE_USED', '이미 다른 차량 비용에 건 매입입니다.');
    purchaseId = b.purchaseId;
  }
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO acct_vehicle_costs (vehicle_id, cost_on, kind, amount, liters, purchase_id, memo, created_by)
     VALUES ($1::bigint, $2::date, $3, $4::bigint, $5::numeric, $6::bigint, $7, $8) RETURNING id::text AS id`,
    [id, b.costOn, b.kind, amt, liters, purchaseId, clean(b.memo, 200), actor]);
  return { ok: true, id: r!.id, note: '비용을 넣었습니다 — 전표는 매입 · 경비 청구가 잡습니다(여기는 손금 인정 셈).' };
}

/** POST …/trips/{tripId}/cancel · …/costs/{costId}/cancel — 사유 */
export async function cancelVehicleLine(db: DatabaseService, id: string, what: 'trip' | 'cost', lineId: string, reason: string) {
  idOk(id); idOk(lineId, what === 'trip' ? '없는 운행입니다.' : '없는 비용입니다.');
  const t = reasonOk(reason);
  const r = what === 'trip'
    ? await db.query(`UPDATE acct_vehicle_trips SET state = 'CANCELED', cancel_note = $3, canceled_at = now() WHERE id = $2::bigint AND vehicle_id = $1::bigint AND state = 'ACTIVE' RETURNING id`, [id, lineId, t])
    : await db.query(`UPDATE acct_vehicle_costs SET state = 'CANCELED', cancel_note = $3, canceled_at = now() WHERE id = $2::bigint AND vehicle_id = $1::bigint AND state = 'ACTIVE' RETURNING id`, [id, lineId, t]);
  if (!r.length) {
    const [x] = what === 'trip'
      ? await db.query(`SELECT 1 FROM acct_vehicle_trips WHERE id = $2::bigint AND vehicle_id = $1::bigint`, [id, lineId])
      : await db.query(`SELECT 1 FROM acct_vehicle_costs WHERE id = $2::bigint AND vehicle_id = $1::bigint`, [id, lineId]);
    if (!x) throw new NotFound(what === 'trip' ? '없는 운행입니다.' : '없는 비용입니다.');
    throw new StateConflict('VEH_LINE_STATE', '이미 취소한 줄입니다.');
  }
  return { ok: true, id: lineId, note: what === 'trip' ? '운행을 취소했습니다.' : '비용을 취소했습니다.' };
}
