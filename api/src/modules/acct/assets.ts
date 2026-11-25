/* e3 (docs/010) 소개뱅크 src/modules/acct/assets.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import type { Line, Source } from './journal';

/* ---------------------------------------------------------------------
 * v10.398 (D246 · docs/535) 고정자산 대장 · 감가상각
 *   넣는 길 — ① 직접(낸 방법 CASH · AP 면 취득 전표 · NONE 은 기초 잔액에 이미 있음) ② ⑫ 매입에서 넘기기(매입 계정이 비용이면 「자산으로 넘기기」 전표)
 *   상각 — 취득 달부터 달마다(월할) · 정액: (취득가 − 잔존 − 시스템 전 상각) ÷ 남은 달(반올림 차이는 누적으로 맞춤) ·
 *          정률: 장부가 × 연 상각률 ÷ 12(마지막 달에 잔존까지) · 연 상각률 = 1 − (잔존 ÷ 취득가)^(12 ÷ 내용연수 달) · 잔존 0 이면 5% 로 셈
 *   정기 작업 acct_depreciation(매일) — 끝난 달까지 · 전표 시작 달(acct.start_on) 전 달은 만들지 않음(시스템 전 상각에 넣을 것)
 *   처분 — 처분 달 전까지 상각 → 받은 돈 + 누계액 − 취득가 = 처분 이익(+) · 손실(−) · 되돌리지 않음
 *   내용연수 · 방법 · 상각률은 초안 — 세무사 확인(법인세법 기준내용연수 · 신고한 상각 방법).
 * ------------------------------------------------------------------- */

const dr = (role: string, n: number): Line => ({ role, debit: n, credit: 0 });
const cr = (role: string, n: number): Line => ({ role, debit: 0, credit: n });
const num = (v: unknown) => Number(v ?? 0);
const ymIdx = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const idxYm = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
const kstYm = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);

export interface AssetRow { id: string; name: string; acquired_on: string; cost: number; residual: number; life_months: number; method: string; prior_depr: number; prior_months: number; state?: string }

/** 연 상각률(정률) — 초안 */
export const decliningRate = (cost: number, residual: number, lifeMonths: number) => {
  const floor = Math.max(residual, Math.round(cost * 0.05));
  return 1 - Math.pow(floor / cost, 12 / lifeMonths);
};

/** 달마다 상각 계획(취득 달 + 시스템 전 달수부터 내용연수 끝까지) */
export function depreciationPlan(a: AssetRow): Array<{ ym: string; amount: number; bookAfter: number }> {
  const cost = num(a.cost), residual = num(a.residual), life = num(a.life_months), pm = num(a.prior_months);
  const n = life - pm;
  let book = cost - num(a.prior_depr);
  const start = ymIdx(String(a.acquired_on).slice(0, 7)) + pm;
  const out: Array<{ ym: string; amount: number; bookAfter: number }> = [];
  if (n <= 0 || book <= residual) return out;
  const remain = book - residual;
  const rate = a.method === 'DECLINING' ? decliningRate(cost, residual, life) : 0;
  for (let j = 0; j < n; j++) {
    let amt = a.method === 'DECLINING'
      ? (j === n - 1 ? book - residual : Math.round((book * rate) / 12))
      : Math.round((remain * (j + 1)) / n) - Math.round((remain * j) / n);
    amt = Math.max(0, Math.min(amt, book - residual));
    book -= amt;
    if (amt > 0) out.push({ ym: idxYm(start + j), amount: amt, bookAfter: book });
    if (book <= residual) break;
  }
  return out;
}

async function startYm(db: DatabaseService) {
  const [s] = await db.query<{ value: string | null }>(`SELECT value FROM erp_site_settings WHERE key = 'acct.start_on'`);
  return (s?.value ?? '2026-11-01').slice(0, 7);
}

const ASSET_SELECT = `SELECT a.id::text AS id, a.name, a.category, a.acquired_on::text AS acquired_on, a.cost::float8 AS cost, a.residual::float8 AS residual, a.life_months,
       a.method, a.account_role AS "accountRole", a.pay_role AS "payRole", a.purchase_id::text AS "purchaseId", a.from_role AS "fromRole",
       a.prior_depr::float8 AS prior_depr, a.prior_months, a.state, a.disposed_on::text AS "disposedOn", a.dispose_amount::float8 AS "disposeAmount",
       a.dispose_reason AS "disposeReason", a.memo, a.created_at AS "createdAt",
       coalesce((SELECT sum(d.amount) FROM acct_depreciations d WHERE d.asset_id = a.id), 0)::float8 AS depr,
       (SELECT max(d.ym) FROM acct_depreciations d WHERE d.asset_id = a.id) AS "lastYm"
  FROM acct_assets a`;

/** 대장 — 자산마다 취득가 · 누계액(시스템 전 + 시스템) · 장부가 · 다음 달 상각 · 시작 전 빠진 상각 경고 */
export async function listAssets(db: DatabaseService, state?: string) {
  const rows = await db.query<AssetRow & Record<string, any>>(`${ASSET_SELECT} ${state === 'DISPOSED' || state === 'ACTIVE' ? `WHERE a.state = '${state}'` : ''} ORDER BY a.state, a.acquired_on DESC, a.id DESC LIMIT 500`);
  const sy = await startYm(db), now = kstYm();
  const items = rows.map((a) => {
    const plan = depreciationPlan(a);
    const acc = num(a.prior_depr) + num(a.depr);
    const next = plan.find((p) => p.ym >= now && p.ym > (a.lastYm ?? ''));
    const gap = plan.filter((p) => p.ym < sy).reduce((s, p) => s + p.amount, 0);
    return { ...a, accumulated: acc, book: num(a.cost) - acc, next: next ?? null, planTotal: plan.reduce((s, p) => s + p.amount, 0),
             gapBeforeStart: gap, warn: gap > 0 ? `전표 시작 달(${sy}) 전 상각 ${gap.toLocaleString('ko-KR')}원은 만들지 않습니다 — 시스템 전 상각액 · 달수에 넣고 기초 잔액(감가상각누계액)과 맞추십시오.` : '' };
  });
  const sum = (f: (x: typeof items[number]) => number) => items.filter((x) => x.state === 'ACTIVE').reduce((s, x) => s + f(x), 0);
  return { items, total: { count: items.filter((x) => x.state === 'ACTIVE').length, cost: sum((x) => num(x.cost)), accumulated: sum((x) => x.accumulated), book: sum((x) => x.book) }, startYm: sy,
           note: '내용연수 · 상각 방법 · 상각률은 초안입니다 — 세무사 확인(기준내용연수 · 신고한 방법). 처음 넣은 값은 상각을 시작하면 고칠 수 없습니다.' };
}

export async function assetDetail(db: DatabaseService, id: string) {
  const [a] = await db.query<AssetRow & Record<string, any>>(`${ASSET_SELECT} WHERE a.id = $1::bigint`, [id]);
  if (!a) throw new NotFound('없는 고정자산입니다.');
  const done = await db.query<{ ym: string; amount: number; bookAfter: number }>(
    `SELECT ym, amount::float8 AS amount, book_after::float8 AS "bookAfter" FROM acct_depreciations WHERE asset_id = $1::bigint ORDER BY ym`, [id]);
  const doneYm = new Set(done.map((d) => d.ym));
  return { asset: a, done, plan: depreciationPlan(a).map((p) => ({ ...p, done: doneYm.has(p.ym) })) };
}

export interface AssetIn { name: string; category?: string; acquiredOn?: string; cost?: number; residual?: number; lifeMonths: number; method: string; accountRole?: string;
  payRole?: string; purchaseId?: string; priorDepr?: number; priorMonths?: number; memo?: string }

/** 넣기 — purchaseId 가 있으면 매입에서(취득일 · 취득가 · 이름은 매입 값) */
export async function addAsset(db: DatabaseService, b: AssetIn, actor: string | null) {
  const life = Math.round(Number(b.lifeMonths));
  if (!Number.isFinite(life) || life < 1 || life > 600) throw new PolicyViolation('ACCT_ASSET', '내용연수는 1 ~ 600달입니다.');
  if (b.method !== 'STRAIGHT' && b.method !== 'DECLINING') throw new PolicyViolation('ACCT_ASSET', '상각 방법은 정액(STRAIGHT) · 정률(DECLINING)입니다.');
  let name = (b.name ?? '').trim(), acquired = b.acquiredOn ?? '', cost = Math.round(Number(b.cost ?? 0)), pay = b.payRole ?? 'NONE', from: string | null = null, pid: string | null = null;
  if (b.purchaseId) {
    const [p] = await db.query<{ id: string; issued_on: string; item: string; supply: number; total: number; deductible: boolean; account_role: string; state: string; kind: string; used: boolean }>(
      `SELECT p.id::text AS id, p.issued_on::text AS issued_on, p.item, p.supply::float8 AS supply, p.total::float8 AS total, p.deductible, p.account_role, p.state, a.kind,
              EXISTS (SELECT 1 FROM acct_assets x WHERE x.purchase_id = p.id) AS used
         FROM acct_purchases p JOIN acct_accounts a ON a.role = p.account_role WHERE p.id = $1::bigint`, [b.purchaseId]);
    if (!p) throw new NotFound('없는 매입입니다.');
    if (p.state !== 'ACTIVE') throw new PolicyViolation('ACCT_ASSET', '취소한 매입은 자산으로 넘길 수 없습니다.');
    if (p.used) throw new PolicyViolation('ACCT_ASSET_DUP', '이미 고정자산으로 넘긴 매입입니다.');
    name = name || p.item; acquired = p.issued_on; cost = p.deductible ? p.supply : p.total; pay = 'PURCHASE'; pid = p.id;
    from = p.kind === 'EXPENSE' ? p.account_role : null;   // 비용으로 잡은 매입이면 자산으로 옮기는 전표 · 자산 계정이면 전표 없음
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(acquired) || Number.isNaN(Date.parse(acquired))) throw new PolicyViolation('ACCT_DATE', '날짜는 YYYY-MM-DD 로 적어 주십시오.');
    if (!Number.isFinite(cost) || cost < 1) throw new PolicyViolation('ACCT_ASSET', '취득가는 1원 이상 정수입니다.');
    if (!['CASH', 'AP', 'NONE'].includes(pay)) throw new PolicyViolation('ACCT_ASSET', '낸 방법은 보통예금(CASH) · 미지급금(AP) · 기초 잔액에 있음(NONE)입니다.');
  }
  if (name.length < 1 || name.length > 120) throw new PolicyViolation('ACCT_ASSET', '자산 이름은 1 ~ 120자입니다.');
  const residual = Math.round(Number(b.residual ?? 0)), pd = Math.round(Number(b.priorDepr ?? 0)), pmn = Math.round(Number(b.priorMonths ?? 0));
  if (!(residual >= 0 && residual < cost)) throw new PolicyViolation('ACCT_ASSET', '잔존가치는 0 이상 취득가 미만입니다.');
  if (!(pd >= 0 && pd <= cost - residual && pmn >= 0 && pmn <= life)) throw new PolicyViolation('ACCT_ASSET', '시스템 전 상각액 · 달수가 범위를 넘습니다.');
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO acct_assets (name, category, acquired_on, cost, residual, life_months, method, account_role, pay_role, purchase_id, from_role, prior_depr, prior_months, memo, created_by)
     VALUES ($1, nullif($2, ''), $3::date, $4, $5, $6, $7, coalesce(nullif($8, ''), 'FIXED_ASSET'), $9, $10::bigint, $11, $12, $13, nullif($14, ''), $15) RETURNING id::text AS id`,
    [name, (b.category ?? '').trim().slice(0, 40), acquired, cost, residual, life, b.method, (b.accountRole ?? '').trim(), pay, pid, from, pd, pmn, (b.memo ?? '').trim().slice(0, 200), actor]);
  return { ok: true, id: r!.id, note: pid ? '매입을 고정자산으로 넘겼습니다 — 다음 전표 작업에서 자산으로 옮기고 달마다 상각합니다.' : '고정자산을 넣었습니다 — 끝난 달부터 달마다 상각합니다.' };
}

/** 한 자산 상각 채우기(untilYm 전 달까지 · 전표 시작 달 전은 뺌) */
async function fillAsset(db: DatabaseService, a: AssetRow, untilYm: string, sy: string) {
  let n = 0;
  for (const p of depreciationPlan(a)) {
    if (p.ym >= untilYm) break;
    if (p.ym < sy) continue;
    const r = await db.query(`INSERT INTO acct_depreciations (asset_id, ym, amount, book_after) VALUES ($1::bigint, $2, $3, $4) ON CONFLICT (asset_id, ym) DO NOTHING RETURNING id`,
      [a.id, p.ym, p.amount, p.bookAfter]);
    n += r.length;
  }
  return n;
}

/** 정기 작업 acct_depreciation — 쓰는 자산마다 끝난 달(이번 달 전)까지 */
export async function depreciationJob(db: DatabaseService) {
  const sy = await startYm(db), now = kstYm();
  const rows = await db.query<AssetRow>(`${ASSET_SELECT} WHERE a.state = 'ACTIVE'`);
  let made = 0;
  for (const a of rows) made += await fillAsset(db, a, now, sy);
  return { assets: rows.length, made, untilYm: now };
}

/** 처분 — 처분 달 전까지 상각 → 처분(되돌리지 않음) · 전표는 acct_journal 이 ASSET_DISPOSE */
export async function disposeAsset(db: DatabaseService, id: string, b: { disposedOn?: string; amount?: number; receiveRole?: string; reason?: string }) {
  const reason = (b.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  const day = b.disposedOn ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new PolicyViolation('ACCT_DATE', '날짜는 YYYY-MM-DD 로 적어 주십시오.');
  const amount = Math.round(Number(b.amount ?? 0));
  if (!Number.isFinite(amount) || amount < 0) throw new PolicyViolation('ACCT_ASSET', '처분 금액은 0 이상 정수입니다.');
  const role = b.receiveRole === 'AR' ? 'AR' : 'CASH';
  const [a] = await db.query<AssetRow & { state: string }>(`${ASSET_SELECT} WHERE a.id = $1::bigint`, [id]);
  if (!a) throw new NotFound('없는 고정자산입니다.');
  if (a.state !== 'ACTIVE') throw new PolicyViolation('ACCT_ASSET_DISPOSED', '처분한 고정자산은 고칠 수 없습니다.');
  if (day < a.acquired_on) throw new PolicyViolation('ACCT_ASSET', '처분일이 취득일보다 이릅니다.');
  const sy = await startYm(db);
  await db.transaction(async () => {
    await fillAsset(db, a, day.slice(0, 7), sy);
    await db.query(`UPDATE acct_assets SET state = 'DISPOSED', disposed_on = $2::date, dispose_amount = $3, dispose_role = $4, dispose_reason = $5 WHERE id = $1::bigint`, [id, day, amount, role, reason]);
  });
  const [x] = await db.query<{ acc: number }>(`SELECT (prior_depr + coalesce((SELECT sum(amount) FROM acct_depreciations WHERE asset_id = $1::bigint), 0))::float8 AS acc FROM acct_assets WHERE id = $1::bigint`, [id]);
  const gain = amount + num(x?.acc) - num(a.cost);
  return { ok: true, id, accumulated: num(x?.acc), book: num(a.cost) - num(x?.acc), gain,
           note: gain >= 0 ? `처분했습니다 — 처분 이익 ${gain.toLocaleString('ko-KR')}원(다음 전표 작업에서 전표).` : `처분했습니다 — 처분 손실 ${(-gain).toLocaleString('ko-KR')}원(다음 전표 작업에서 전표).` };
}

/* ── 전표(sources.ts ALL_SOURCES 에 붙임) ── */
export const ASSET_SOURCES: Source[] = [
  {
    name: 'ASSET_ACQUIRE', label: '고정자산 취득(직접)',
    sql: `SELECT a.id::text AS key, greatest(((a.acquired_on + time '12:00') AT TIME ZONE 'Asia/Seoul'), fn_acct_from()) AS at, a.name AS party,
                 a.cost::bigint AS cost, a.account_role AS asset_role, a.pay_role
            FROM acct_assets a
           WHERE a.pay_role IN ('CASH', 'AP')
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'ASSET_ACQUIRE' AND e.source_key = a.id::text)
           ORDER BY a.id LIMIT 500`,
    build: (r) => ({ memo: `고정자산 취득 ${r.party ?? ''}`.trim(), evidence: 'NONE', lines: [dr(String(r.asset_role ?? 'FIXED_ASSET'), num(r.cost)), cr(String(r.pay_role), num(r.cost))] }),
  },
  {
    name: 'ASSET_FROM_PURCHASE', label: '매입 → 고정자산',
    sql: `SELECT a.id::text AS key, a.created_at AS at, a.name AS party, a.cost::bigint AS cost, a.account_role AS asset_role, a.from_role
            FROM acct_assets a
           WHERE a.pay_role = 'PURCHASE' AND a.from_role IS NOT NULL AND a.created_at >= fn_acct_from()
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'PURCHASE' AND e.source_key = a.purchase_id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'ASSET_FROM_PURCHASE' AND e.source_key = a.id::text)
           ORDER BY a.id LIMIT 500`,
    build: (r) => ({ memo: `매입을 고정자산으로 ${r.party ?? ''}`.trim(), evidence: 'NONE', lines: [dr(String(r.asset_role ?? 'FIXED_ASSET'), num(r.cost)), cr(String(r.from_role), num(r.cost))] }),
  },
  {
    name: 'DEPRECIATION', label: '감가상각',
    sql: `SELECT d.id::text AS key, ((to_date(d.ym || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date + time '18:00') AT TIME ZONE 'Asia/Seoul' AS at,
                 a.name AS party, d.amount::bigint AS amt, d.ym
            FROM acct_depreciations d JOIN acct_assets a ON a.id = d.asset_id
           WHERE NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'DEPRECIATION' AND e.source_key = d.id::text)
           ORDER BY d.ym, d.id LIMIT 500`,
    build: (r) => ({ memo: `감가상각 ${r.ym ?? ''} ${r.party ?? ''}`.trim(), evidence: 'NONE', lines: [dr('EXP_DEPR', num(r.amt)), cr('ACC_DEPR', num(r.amt))] }),
  },
  {
    name: 'ASSET_DISPOSE', label: '고정자산 처분',
    sql: `SELECT a.id::text AS key, greatest(((a.disposed_on + time '12:00') AT TIME ZONE 'Asia/Seoul'), fn_acct_from()) AS at, a.name AS party,
                 a.cost::bigint AS cost, a.account_role AS asset_role, a.dispose_amount::bigint AS amt, a.dispose_role,
                 (a.prior_depr + coalesce((SELECT sum(d.amount) FROM acct_depreciations d WHERE d.asset_id = a.id), 0))::bigint AS acc
            FROM acct_assets a
           WHERE a.state = 'DISPOSED'
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'ASSET_DISPOSE' AND e.source_key = a.id::text)
           ORDER BY a.id LIMIT 500`,
    build: (r) => {
      const cost = num(r.cost), acc = num(r.acc), amt = num(r.amt), gain = amt + acc - cost;
      const ls: Line[] = [...(acc > 0 ? [dr('ACC_DEPR', acc)] : []), ...(amt > 0 ? [dr(String(r.dispose_role ?? 'CASH'), amt)] : []),
        ...(gain < 0 ? [dr('LOSS_DISPOSAL', -gain)] : []), cr(String(r.asset_role ?? 'FIXED_ASSET'), cost), ...(gain > 0 ? [cr('GAIN_DISPOSAL', gain)] : [])];
      return { memo: `고정자산 처분 ${r.party ?? ''}`.trim(), evidence: 'NONE', lines: ls };
    },
  },
];
