/* e3 (docs/010) 소개뱅크 src/modules/acct/accrual.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { DatabaseService } from '../../db/database.service';
import { NotFound, StateConflict } from '../../core/errors';
import type { Source } from './journal';

/* ---------------------------------------------------------------------
 * v10.439 (D257 · docs/576) 고정비 자동 전표 — 대표 11/19 「다음개발」
 *   계약(⑯ acct_contracts)의 달 금액을 매달 1일 미지급 비용으로(발생주의):
 *     CONTRACT_ACCRUE      차변 계약 비용 계정(공급가) / 대변 미지급금(AP)
 *     CONTRACT_ACCRUE_REV  그 달 실제 매입(⑫)이 들어와 맞추면 반대 — 비용이 두 번 잡히지 않게(매입 전표가 비용 · 부가세를 잡음)
 *   맞춤: 같은 거래처 사업자번호 · 같은 달 발행 · 취소 안 된 매입 하나(자동) 또는 SUPER 가 고름(수동).
 *   다음 달 말까지 매입이 없으면 ACCT_ACCRUAL_UNMATCHED(계약 · 달마다 한 번 · 맞추면 풀림).
 *   스위치 acct.contract_accrue 처음 off — off 면 새 줄을 만들지 않고 맞춤 · 알림만.
 * ------------------------------------------------------------------- */

const n = (v: unknown) => Number(v ?? 0);
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const prevYm = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const KIND_ROLE: Record<string, string> = { RENT: 'EXP_RENT', SERVER: 'EXP_FEE', SERVICE: 'EXP_FEE', SUBSCRIPTION: 'EXP_FEE', OTHER: 'EXP_ETC' };

export const ACCRUAL_SOURCES: Source[] = [
  {
    name: 'CONTRACT_ACCRUE', label: '고정비(계약) 미지급',
    sql: `SELECT a.id::text AS key, ((a.ym || '-01')::timestamp AT TIME ZONE 'Asia/Seoul') AS at, a.amount::bigint AS amt, a.account_role AS role,
                 coalesce(p.name, c.title) AS party, c.title, a.ym
            FROM acct_contract_accruals a JOIN acct_contracts c ON c.id = a.contract_id LEFT JOIN acct_parties p ON p.id = c.party_id
           WHERE ((a.ym || '-01')::timestamp AT TIME ZONE 'Asia/Seoul') >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'CONTRACT_ACCRUE' AND e.source_key = a.id::text)
           ORDER BY a.id LIMIT 500`,
    build: (r) => ({ memo: `고정비 ${r.title ?? ''} ${r.ym ?? ''}`.trim(), evidence: 'NONE',
      lines: [{ role: String(r.role), debit: n(r.amt), credit: 0 }, { role: 'AP', debit: 0, credit: n(r.amt) }] }),
  },
  {
    name: 'CONTRACT_ACCRUE_REV', label: '고정비(계약) 미지급 되돌림(매입 맞춤)',
    sql: `SELECT a.id::text AS key, coalesce(a.matched_at, now()) AS at, a.amount::bigint AS amt, a.account_role AS role,
                 coalesce(p.name, c.title) AS party, c.title, a.ym, a.purchase_id::text AS pid
            FROM acct_contract_accruals a JOIN acct_contracts c ON c.id = a.contract_id LEFT JOIN acct_parties p ON p.id = c.party_id
           WHERE a.state = 'MATCHED'
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'CONTRACT_ACCRUE' AND e.source_key = a.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'CONTRACT_ACCRUE_REV' AND e.source_key = a.id::text)
           ORDER BY a.id LIMIT 500`,
    build: (r) => ({ memo: `고정비 되돌림 ${r.title ?? ''} ${r.ym ?? ''} · 매입 ${r.pid ?? ''}`.trim(), evidence: 'NONE',
      lines: [{ role: 'AP', debit: n(r.amt), credit: 0 }, { role: String(r.role), debit: 0, credit: n(r.amt) }] }),
  },
];

async function setting(db: DatabaseService, key: string) {
  const [r] = await db.query<{ value: string | null }>(`SELECT value FROM erp_site_settings WHERE key = $1`, [key]);
  return r?.value ?? null;
}

/** GET /admin/acct/accruals?ym= — 계약마다 규칙 · 그 달 줄 · 맞춤 */
export async function accrualView(db: DatabaseService, ymIn?: string) {
  const ym = ymIn && /^\d{4}-(0[1-9]|1[0-2])$/.test(ymIn) ? ymIn : kstToday().slice(0, 7);
  const on = (await setting(db, 'acct.contract_accrue')) === 'on';
  const contracts = await db.query(
    `SELECT c.id::text AS id, c.title, c.kind, c.monthly_amount::bigint AS "monthlyAmount", c.start_on::text AS "startOn", c.end_on::text AS "endOn", c.state,
            p.name AS party, p.biz_no AS "bizNo",
            r.account_role AS "accountRole", coalesce(r.vat_included, true) AS "vatIncluded", coalesce(r.enabled, true) AS enabled, (r.contract_id IS NOT NULL) AS "hasRule",
            a.id::text AS "accrualId", a.amount::bigint AS amount, a.state AS "accrualState", a.purchase_id::text AS "purchaseId", a.matched_by AS "matchedBy"
       FROM acct_contracts c LEFT JOIN acct_parties p ON p.id = c.party_id
       LEFT JOIN acct_contract_accrual_rules r ON r.contract_id = c.id
       LEFT JOIN acct_contract_accruals a ON a.contract_id = c.id AND a.ym = $1
      WHERE c.monthly_amount > 0 ORDER BY c.state, c.title`, [ym]);
  const unmatched = await db.query(
    `SELECT a.id::text AS id, a.ym, a.amount::bigint AS amount, c.title FROM acct_contract_accruals a JOIN acct_contracts c ON c.id = a.contract_id
      WHERE a.state = 'ACCRUED' AND a.ym < $1 ORDER BY a.ym, a.id LIMIT 50`, [ym]);
  return { ym, on, contracts, unmatched,
    kindRole: KIND_ROLE,
    note: '계약 달 금액을 매달 1일 미지급 비용으로 잡고, 같은 거래처의 그 달 매입이 들어오면 되돌립니다(비용 두 번 막기). 부가세 포함 금액이면 ÷ 1.1 을 비용으로 잡습니다.' };
}

/** PUT /admin/acct/accruals/rules/{contractId} — 규칙(SUPER) */
export async function setAccrualRule(db: DatabaseService, contractId: string, b: { accountRole?: string; vatIncluded?: boolean; enabled?: boolean }, actor: string | null) {
  const [c] = await db.query<{ kind: string }>(`SELECT kind FROM acct_contracts WHERE id = $1::bigint`, [contractId]);
  if (!c) throw new NotFound('없는 계약입니다.');
  const role = (b.accountRole ?? KIND_ROLE[c.kind] ?? 'EXP_ETC').trim();
  await db.query(
    `INSERT INTO acct_contract_accrual_rules (contract_id, account_role, vat_included, enabled, updated_by) VALUES ($1::bigint, $2, $3, $4, $5)
     ON CONFLICT (contract_id) DO UPDATE SET account_role = EXCLUDED.account_role, vat_included = EXCLUDED.vat_included, enabled = EXCLUDED.enabled,
            updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [contractId, role, b.vatIncluded !== false, b.enabled !== false, actor]);
  return { ok: true, contractId, accountRole: role, note: '고정비 규칙을 정했습니다 — 다음 달 줄부터(이미 만든 줄은 그대로).' };
}

/** POST /admin/acct/accruals/{id}/match — 매입 고르기(SUPER) */
export async function matchAccrual(db: DatabaseService, id: string, purchaseId: string) {
  const [a] = await db.query<{ state: string; ym: string }>(`SELECT state, ym FROM acct_contract_accruals WHERE id = $1::bigint`, [id]);
  if (!a) throw new NotFound('없는 고정비 줄입니다.');
  if (a.state !== 'ACCRUED') throw new StateConflict('ACCRUAL_MATCHED', '이미 맞춘 고정비 줄입니다.');
  const [p] = await db.query(`SELECT 1 FROM acct_purchases WHERE id = $1::bigint AND state <> 'CANCELED'`, [purchaseId]);
  if (!p) throw new NotFound('없는 매입입니다.');
  const [used] = await db.query(`SELECT 1 FROM acct_contract_accruals WHERE purchase_id = $1::bigint`, [purchaseId]);
  if (used) throw new StateConflict('ACCRUAL_PURCHASE_USED', '다른 고정비 줄에 맞춘 매입입니다.');
  await db.query(`UPDATE acct_contract_accruals SET state = 'MATCHED', purchase_id = $2::bigint, matched_by = 'MANUAL', matched_at = now() WHERE id = $1::bigint`, [id, purchaseId]);
  await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = '매입 맞춤' WHERE alert_code = 'ACCT_ACCRUAL_UNMATCHED' AND resolved_at IS NULL AND detail->>'accrualId' = $1`, [id]);
  return { ok: true, id, purchaseId, note: '매입과 맞췄습니다 — 다음 전표 작업에서 미지급 비용을 되돌립니다.' };
}

/** 정기 작업 acct_accrual — 이번 달 줄 · 자동 맞춤 · 빠진 매입 알림 */
export async function acctAccrualJob(db: DatabaseService, today = kstToday()) {
  const ym = today.slice(0, 7);
  const on = (await setting(db, 'acct.contract_accrue')) === 'on';
  let made = 0;
  if (on) {
    const rows = await db.query<{ id: string; kind: string; amt: string; role: string | null; vat: boolean | null; enabled: boolean | null }>(
      `SELECT c.id::text AS id, c.kind, c.monthly_amount::text AS amt, r.account_role AS role, r.vat_included AS vat, r.enabled
         FROM acct_contracts c LEFT JOIN acct_contract_accrual_rules r ON r.contract_id = c.id
        WHERE c.state = 'ACTIVE' AND c.monthly_amount > 0 AND c.start_on <= ($1 || '-01')::date + interval '1 month' - interval '1 day'
          AND (c.end_on IS NULL OR c.end_on >= ($1 || '-01')::date)
          AND NOT EXISTS (SELECT 1 FROM acct_contract_accruals a WHERE a.contract_id = c.id AND a.ym = $1)`, [ym]);
    for (const c of rows) {
      if (c.enabled === false) continue;
      const total = n(c.amt), amount = c.vat === false ? total : Math.round(total / 1.1);
      if (amount <= 0) continue;
      const ins = await db.query(
        `INSERT INTO acct_contract_accruals (contract_id, ym, account_role, amount) VALUES ($1::bigint, $2, $3, $4) ON CONFLICT (contract_id, ym) DO NOTHING RETURNING id`,
        [c.id, ym, c.role ?? KIND_ROLE[c.kind] ?? 'EXP_ETC', amount]);
      made += ins.length;
    }
  }
  /* 자동 맞춤 — 같은 거래처 사업자번호 · 같은 달 발행 · 취소 안 됨 · 아직 안 쓴 매입 하나뿐일 때 */
  const cands = await db.query<{ id: string; pid: string }>(
    `SELECT a.id::text AS id, min(pu.id)::text AS pid
       FROM acct_contract_accruals a JOIN acct_contracts c ON c.id = a.contract_id JOIN acct_parties p ON p.id = c.party_id
       JOIN acct_purchases pu ON pu.supplier_biz_no = p.biz_no AND to_char(pu.issued_on, 'YYYY-MM') = a.ym AND pu.state <> 'CANCELED'
      WHERE a.state = 'ACCRUED' AND p.biz_no IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM acct_contract_accruals x WHERE x.purchase_id = pu.id)
      GROUP BY a.id HAVING count(pu.id) = 1`);
  let matched = 0;
  for (const m of cands) {
    try {
      const r = await db.query(
        `UPDATE acct_contract_accruals SET state = 'MATCHED', purchase_id = $2::bigint, matched_by = 'AUTO', matched_at = now()
          WHERE id = $1::bigint AND state = 'ACCRUED' RETURNING id`, [m.id, m.pid]);
      matched += r.length;
    } catch { /* 같은 매입을 두 줄이 노리면 하나만(고유 색인) */ }
  }
  await db.query(
    `UPDATE ops_alerts o SET resolved_at = now(), resolve_note = '매입 맞춤'
      WHERE o.alert_code = 'ACCT_ACCRUAL_UNMATCHED' AND o.resolved_at IS NULL
        AND EXISTS (SELECT 1 FROM acct_contract_accruals a WHERE a.id::text = o.detail->>'accrualId' AND a.state = 'MATCHED')`);
  /* 다음 달 말까지 매입이 안 들어온 줄 — 지난달보다 앞선 달 */
  const late = await db.query<{ id: string; ym: string; title: string; amount: string }>(
    `SELECT a.id::text AS id, a.ym, c.title, a.amount::text AS amount FROM acct_contract_accruals a JOIN acct_contracts c ON c.id = a.contract_id
      WHERE a.state = 'ACCRUED' AND a.ym < $1 ORDER BY a.ym LIMIT 30`, [prevYm(ym)]);
  let alerted = 0;
  for (const l of late) {
    const r = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'ACCT_ACCRUAL_UNMATCHED', 'WARN', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ACCT_ACCRUAL_UNMATCHED' AND detail->>'accrualId' = $3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [`고정비 「${l.title}」 ${l.ym} 매입(세금계산서 · 영수증)이 아직 없습니다 — 회계 › 고정비`, JSON.stringify({ accrualId: l.id, ym: l.ym }), l.id]);
    alerted += r.length;
  }
  return { on, ym, made, matched, alerted };
}

