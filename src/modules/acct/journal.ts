import { DatabaseService } from '../../db/database.service';

/* ---------------------------------------------------------------------
 * v10.382 (D242 · docs/518) 자동 전표 — 정기 작업 acct_journal(매시간)
 *
 *   돈 흐름마다 전표 한 장(acct_entries · source + source_key 고유 · 다시 돌려도 한 번).
 *   시작일(acct.start_on) 뒤 · 시험 결제(stub)는 acct.include_stub 이 on 일 때만.
 *   전표 날짜 = 돈이 움직인 한국 날짜 · 그 달을 마감했으면 오늘 날짜(late).
 *   규칙(계정 · 부가세 나눔)은 초안 — 세무사 확인 뒤 계정 코드만 운영 화면에서 고칩니다(역할은 그대로).
 *
 *   회사 장부에 넣지 않는 것: 회원끼리 소개비(settlements · 회사가 맡지 않음) · 입점 판매 대금(판매자 돈 · 수수료만) ·
 *   리드 캐시 보너스(현금이 아님) · 리드 캐시 사용(11/19 대표 「충전 때 매출」이라 쓸 때는 전표 없음) · 성공 수수료(스위치 off · 받는 길 없음).
 * ------------------------------------------------------------------- */

/* v10.392 (D245) — 계정 역할은 acct_accounts 표(더하는 계정 U_ · ⑫ 매입 · 경비 · 재고 계정)라 글자로 둠 */
export type Role = string;
export interface Line { role: Role; debit: number; credit: number }
export type Evidence = 'TAX_INVOICE' | 'CARD_PG' | 'CASH' | 'NONE' | 'CARD' | 'SIMPLE';
export interface Draft { key: string; at: string; memo: string; party: string | null; evidence: Evidence; lines: Line[] }
export type Row = Record<string, any> & { key: string; at: string; party: string | null };

export const dr = (role: Role, n: number): Line => ({ role, debit: n, credit: 0 });
export const cr = (role: Role, n: number): Line => ({ role, debit: 0, credit: n });
/** 부가세 포함 금액 → 공급가 · 세액(공급가 = 반올림(합계 ÷ 1.1)) */
export const vatSplit = (total: number) => { const supply = Math.round(total / 1.1); return { supply, vat: total - supply }; };
/** 매출 줄(대변) — 부가세를 나누면 공급가 · 부가세예수금 두 줄 */
const revenue = (rev: Role, total: number, split: boolean): Line[] => {
  if (!split) return [cr(rev, total)];
  const v = vatSplit(total);
  return [cr(rev, v.supply), cr('VAT_OUT', v.vat)];
};
/** v10.385 (D243) — 부가세를 따로 받은 것(공급가 · 부가세 칸이 있음)은 그 값 그대로, 없으면 전처럼(설정에 따라 ÷ 1.1) */
const revenueSep = (rev: Role, total: number, vat: unknown, split: boolean): Line[] =>
  vat == null ? revenue(rev, total, split) : [cr(rev, total - n(vat)), ...(n(vat) > 0 ? [cr('VAT_OUT', n(vat))] : [])];
/** 반대 전표(차변 ↔ 대변) */
export const reverse = (ls: Line[]): Line[] => ls.map((l) => ({ role: l.role, debit: l.credit, credit: l.debit }));
const n = (v: unknown) => Number(v ?? 0);

export interface Ctx { subVat: boolean; commissionVat: boolean }

export interface Source { name: string; label: string; sql: string; build: (r: Row, c: Ctx) => Omit<Draft, 'key' | 'at' | 'party'> | null }

/* 각 조회는 아직 전표가 없는 것만(NOT EXISTS) · 시작일 뒤 · 500건씩 */
export const SOURCES: Source[] = [
  {
    name: 'SUB_PAID', label: '구독 결제',
    sql: `SELECT i.id::text AS key, i.paid_at AS at, i.amount::bigint AS amt, i.vat::bigint AS vat, NULL::text AS party
            FROM subscription_invoices i
           WHERE i.status IN ('PAID', 'REFUNDED') AND i.paid_at IS NOT NULL AND i.amount > 0 AND i.paid_at >= fn_acct_from() AND fn_acct_stub_ok(i.is_stub)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'SUB_PAID' AND e.source_key = i.id::text)
           ORDER BY i.paid_at LIMIT 500`,
    build: (r, c) => ({ memo: '구독 결제', evidence: 'CARD_PG', lines: [dr('PG_RECV', n(r.amt)), ...revenueSep('REV_SUB', n(r.amt), r.vat, c.subVat)] }),
  },
  {
    name: 'SUB_REFUND', label: '구독 환불',
    sql: `SELECT r.id::text AS key, r.completed_at AS at, r.amount::bigint AS amt, NULL::text AS party,
                 (SELECT i.vat::bigint FROM subscription_invoices i WHERE i.id = r.invoice_id AND i.amount = r.amount) AS vat
            FROM subscription_refunds r
           WHERE r.state = 'SUCCEEDED' AND r.completed_at IS NOT NULL AND r.amount > 0 AND r.completed_at >= fn_acct_from() AND fn_acct_stub_ok(r.is_stub)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'SUB_REFUND' AND e.source_key = r.id::text)
           ORDER BY r.completed_at LIMIT 500`,
    build: (r, c) => ({ memo: '구독 환불', evidence: 'CARD_PG', lines: reverse([dr('PG_RECV', n(r.amt)), ...revenueSep('REV_SUB', n(r.amt), r.vat, c.subVat)]) }),
  },
  {
    name: 'REFCODE_PAID', label: '소개코드 결제',
    sql: `SELECT p.payment_key AS key, p.paid_at AS at, p.amount::bigint AS amt, nullif(p.vat, 0)::bigint AS vat, NULL::text AS party
            FROM referral_code_payments p
           WHERE p.paid_at IS NOT NULL AND p.amount > 0 AND p.paid_at >= fn_acct_from() AND fn_acct_stub_ok(p.stub)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'REFCODE_PAID' AND e.source_key = p.payment_key)
           ORDER BY p.paid_at LIMIT 500`,
    build: (r, c) => ({ memo: '소개코드 결제', evidence: 'CARD_PG', lines: [dr('PG_RECV', n(r.amt)), ...revenueSep('REV_REFCODE', n(r.amt), r.vat, c.subVat)] }),
  },
  {
    name: 'AD_INVOICE', label: '광고 청구',
    sql: `SELECT i.id::text AS key, i.created_at AS at, i.amount::bigint AS supply, i.vat::bigint AS vat, i.total::bigint AS total, a.name AS party, i.invoice_no AS no
            FROM ad_invoices i LEFT JOIN advertisers a ON a.id = i.advertiser_id
           WHERE i.status <> 'VOID' AND i.total > 0 AND i.created_at >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'AD_INVOICE' AND e.source_key = i.id::text)
           ORDER BY i.created_at LIMIT 500`,
    build: (r) => ({ memo: `광고 청구 ${r.no ?? ''}`.trim(), evidence: 'TAX_INVOICE',
      lines: [dr('AR', n(r.total)), cr('REV_AD', n(r.supply)), ...(n(r.vat) > 0 ? [cr('VAT_OUT', n(r.vat))] : [])] }),
  },
  {
    name: 'AD_VOID', label: '광고 청구 취소',
    sql: `SELECT i.id::text AS key, now() AS at, i.amount::bigint AS supply, i.vat::bigint AS vat, i.total::bigint AS total, a.name AS party, i.invoice_no AS no
            FROM ad_invoices i LEFT JOIN advertisers a ON a.id = i.advertiser_id
           WHERE i.status = 'VOID' AND i.total > 0
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'AD_INVOICE' AND e.source_key = i.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'AD_VOID' AND e.source_key = i.id::text)
           ORDER BY i.id LIMIT 500`,
    build: (r) => ({ memo: `광고 청구 취소 ${r.no ?? ''}`.trim(), evidence: 'TAX_INVOICE',
      lines: reverse([dr('AR', n(r.total)), cr('REV_AD', n(r.supply)), ...(n(r.vat) > 0 ? [cr('VAT_OUT', n(r.vat))] : [])]) }),
  },
  {
    name: 'AD_PAYMENT', label: '광고비 입금',
    sql: `SELECT p.id::text AS key, p.paid_at AS at, p.amount::bigint AS amt, a.name AS party, p.method
            FROM ad_payments p JOIN ad_invoices i ON i.id = p.invoice_id LEFT JOIN advertisers a ON a.id = i.advertiser_id
           WHERE p.amount > 0 AND p.paid_at >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'AD_PAYMENT' AND e.source_key = p.id::text)
           ORDER BY p.paid_at LIMIT 500`,
    build: (r) => ({ memo: `광고비 입금(${r.method ?? ''})`, evidence: 'NONE', lines: [dr('CASH', n(r.amt)), cr('AR', n(r.amt))] }),
  },
  {
    name: 'MALL_SALE', label: '소개몰 직판 결제',
    sql: `SELECT p.id::text AS key, p.approved_at AS at, p.amount::bigint AS amt, o.order_no AS no, NULL::text AS party,
                 (coalesce((SELECT sum(it.amount) FROM hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0) * (o.goods_amount - o.discount_amount) / nullif(o.goods_amount, 0))::bigint AS exempt
            FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id JOIN hlt_sellers s ON s.id = o.seller_id AND s.type = 'DIRECT'
           WHERE p.state IN ('PAID', 'CANCELED') AND p.approved_at IS NOT NULL AND p.amount > 0 AND p.approved_at >= fn_acct_from() AND fn_acct_stub_ok(p.stub)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_SALE' AND e.source_key = p.id::text)
           ORDER BY p.approved_at LIMIT 500`,
    build: (r) => ({ memo: `소개몰 주문 ${r.no ?? ''}`.trim(), evidence: 'CARD_PG', lines: mallLines(n(r.amt), n(r.exempt)) }),
  },
  {
    name: 'MALL_REFUND', label: '소개몰 직판 취소 · 환불',
    sql: `SELECT p.id::text AS key, p.canceled_at AS at, coalesce(p.canceled_amount, p.amount)::bigint AS amt, p.amount::bigint AS paid, o.order_no AS no, NULL::text AS party,
                 (coalesce((SELECT sum(it.amount) FROM hlt_order_items it WHERE it.order_id = o.id AND it.tax_type = 'EXEMPT'), 0) * (o.goods_amount - o.discount_amount) / nullif(o.goods_amount, 0))::bigint AS exempt
            FROM hlt_payments p JOIN hlt_orders o ON o.id = p.order_id JOIN hlt_sellers s ON s.id = o.seller_id AND s.type = 'DIRECT'
           WHERE p.canceled_at IS NOT NULL AND coalesce(p.canceled_amount, p.amount) > 0 AND p.approved_at IS NOT NULL
             AND p.canceled_at >= fn_acct_from() AND fn_acct_stub_ok(p.stub)
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_SALE' AND e.source_key = p.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'MALL_REFUND' AND e.source_key = p.id::text)
           ORDER BY p.canceled_at LIMIT 500`,
    build: (r) => {
      const amt = n(r.amt), paid = n(r.paid) || amt;
      const ex = Math.min(amt, Math.round(amt * Math.min(n(r.exempt), paid) / paid));   // 면세 몫은 결제 때 비율대로
      return { memo: `소개몰 취소 · 환불 ${r.no ?? ''}`.trim(), evidence: 'CARD_PG', lines: reverse(mallLines(amt, ex)) };
    },
  },
  {
    name: 'COMMISSION', label: '입점 수수료',
    sql: `SELECT st.id::text AS key, st.confirmed_at AS at, st.commission::bigint AS amt, nullif(st.commission_vat, 0)::bigint AS vat, s.name AS party, st.period_from::text || ' ~ ' || st.period_to::text AS period
            FROM hlt_settlements st JOIN hlt_sellers s ON s.id = st.seller_id AND s.type <> 'DIRECT'
           WHERE st.status IN ('CONFIRMED', 'PAID') AND st.confirmed_at IS NOT NULL AND st.commission > 0 AND st.confirmed_at >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'COMMISSION' AND e.source_key = st.id::text)
           ORDER BY st.confirmed_at LIMIT 500`,
    build: (r, c) => {
      const amt = n(r.amt);
      /* v10.386 (D243) — 정산에서 수수료 부가세를 뺀 정산서는 그 값 그대로 */
      if (r.vat != null) return { memo: `입점 수수료 ${r.period ?? ''}`.trim(), evidence: 'TAX_INVOICE', lines: [dr('AR', amt + n(r.vat)), cr('REV_COMMISSION', amt), cr('VAT_OUT', n(r.vat))] };
      const total = c.commissionVat ? amt : amt + Math.round(amt * 0.1);
      return { memo: `입점 수수료 ${r.period ?? ''}`.trim(), evidence: 'TAX_INVOICE', lines: [dr('AR', total), ...revenue('REV_COMMISSION', total, true)] };
    },
  },
  {
    name: 'LEAD_CHARGE', label: '리드 캐시 충전(매출)',
    sql: `SELECT c.id::text AS key, c.approved_at AS at, (c.amount + c.vat)::bigint AS amt, nullif(c.vat, 0)::bigint AS vat, b.company_name AS party
            FROM lead_cash_charges c LEFT JOIN partners pt ON pt.id = c.partner_id LEFT JOIN businesses b ON b.id = pt.business_id
           WHERE c.state = 'DONE' AND c.approved_at IS NOT NULL AND c.amount > 0 AND c.approved_at >= fn_acct_from() AND fn_acct_stub_ok(c.stub)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'LEAD_CHARGE' AND e.source_key = c.id::text)
           ORDER BY c.approved_at LIMIT 500`,
    /* 11/19 대표 「충전 때 매출」 — 충전 금액(부가세 포함)을 그때 매출 · 보너스 캐시는 매출 아님 · 쓸 때는 전표 없음 */
    /* v10.387 (D243) — 부가세 별도 충전은 결제 = 충전 금액(매출) + 부가세 */
    build: (r) => ({ memo: '리드 캐시 충전', evidence: 'TAX_INVOICE', lines: [dr('PG_RECV', n(r.amt)), ...revenueSep('REV_LEAD', n(r.amt), r.vat, true)] }),
  },
  {
    name: 'LEAD_REFUND', label: '리드 캐시 환급',
    sql: `SELECT e.id::text AS key, e.created_at AS at, b.company_name AS party,
                 (SELECT coalesce(-sum(l.amount), 0) FROM lead_cash_lines l WHERE l.entry_id = e.id AND l.account = 'PG_CLEARING')::bigint AS amt,
                 /* v10.387 (D243) — 부가세 별도 충전에서 돌려준 몫: 공급가 · 부가세 따로 · 그 전 충전 몫은 ÷ 1.1 */
                 (SELECT coalesce(sum(p.amount) FILTER (WHERE c.vat > 0), 0) FROM lead_cash_refund_parts p JOIN lead_cash_charges c ON c.id = p.charge_id
                   WHERE e.ref_type = 'REFUND' AND p.refund_id::text = e.ref_id AND p.ok)::bigint AS sep_supply,
                 (SELECT coalesce(sum(p.vat) FILTER (WHERE c.vat > 0), 0) FROM lead_cash_refund_parts p JOIN lead_cash_charges c ON c.id = p.charge_id
                   WHERE e.ref_type = 'REFUND' AND p.refund_id::text = e.ref_id AND p.ok)::bigint AS sep_vat
            FROM lead_cash_entries e LEFT JOIN partners pt ON pt.id = e.partner_id LEFT JOIN businesses b ON b.id = pt.business_id
           WHERE e.kind = 'REFUND_PAID' AND e.created_at >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries x WHERE x.source = 'LEAD_REFUND' AND x.source_key = e.id::text)
           ORDER BY e.created_at LIMIT 500`,
    /* 환급(현금 충전분) — 충전 매출의 반대 */
    build: (r) => {
      if (n(r.amt) <= 0) return null;
      const sepS = Math.min(n(r.sep_supply), n(r.amt)), sepV = n(r.sep_vat), old = n(r.amt) - sepS;
      const v = vatSplit(old);
      const ls: Line[] = [dr('PG_RECV', n(r.amt) + sepV), cr('REV_LEAD', sepS + v.supply), ...(sepV + v.vat > 0 ? [cr('VAT_OUT', sepV + v.vat)] : [])];
      return { memo: '리드 캐시 환급', evidence: 'TAX_INVOICE', lines: reverse(ls) };
    },
  },
  {
    name: 'DIRECTORY', label: '정액 노출 입금',
    sql: `SELECT d.id::text AS key, d.created_at AS at, d.supply::bigint AS supply, d.vat::bigint AS vat, d.total::bigint AS total, d.buyer_name AS party
            FROM consult_directory_invoices d
           WHERE d.total > 0 AND d.created_at >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'DIRECTORY' AND e.source_key = d.id::text)
           ORDER BY d.created_at LIMIT 500`,
    build: (r) => ({ memo: '정액 노출', evidence: 'TAX_INVOICE',
      lines: [dr('CASH', n(r.total)), cr('REV_DIRECTORY', n(r.supply)), ...(n(r.vat) > 0 ? [cr('VAT_OUT', n(r.vat))] : [])] }),
  },
  {
    name: 'POINT_CASHOUT', label: '포인트 출금(원천징수)',
    sql: `SELECT c.id::text AS key, c.paid_at AS at, c.points::bigint AS gross, c.withholding::bigint AS wht, c.net_amount::bigint AS net, NULL::text AS party
            FROM point_cashouts c
           WHERE c.status = 'PAID' AND c.paid_at IS NOT NULL AND c.points > 0 AND c.paid_at >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'POINT_CASHOUT' AND e.source_key = c.id::text)
           ORDER BY c.paid_at LIMIT 500`,
    build: (r) => ({ memo: '추천 보상 포인트 출금', evidence: 'NONE',
      lines: [dr('EXP_PROMO', n(r.gross)), ...(n(r.wht) > 0 ? [cr('WHT', n(r.wht))] : []), cr('CASH', n(r.net))] }),
  },
];

/** 직판 결제 — 면세 상품 몫 · 나머지(과세 상품 · 배송비)는 부가세 나눔 */
function mallLines(amt: number, exempt: number): Line[] {
  const ex = Math.max(0, Math.min(amt, exempt));
  return [dr('PG_RECV', amt), ...(ex > 0 ? [cr('REV_MALL_EXEMPT', ex)] : []), ...(amt - ex > 0 ? revenue('REV_MALL', amt - ex, true) : [])];
}

/* v10.392 (D245) 규칙 고치기 — 돈 흐름마다 계정 자리 바꾸기 · 증빙 바꾸기(SUPER · 다음 전표부터 · 같은 종류 계정만 · DB 가 막음) */
export interface Overrides { maps: Map<string, string>; ev: Map<string, Evidence> }
export async function ruleOverrides(db: DatabaseService): Promise<Overrides> {
  const has = await db.query<{ ok: boolean }>(`SELECT to_regclass('public.acct_rule_maps') IS NOT NULL AS ok`);
  if (!has[0]?.ok) return { maps: new Map(), ev: new Map() };
  const m = await db.query<{ source: string; from_role: string; to_role: string }>(`SELECT source, from_role, to_role FROM acct_rule_maps`);
  const e = await db.query<{ source: string; evidence: Evidence }>(`SELECT source, evidence FROM acct_rule_evidence`);
  return { maps: new Map(m.map((x) => [`${x.source}:${x.from_role}`, x.to_role])), ev: new Map(e.map((x) => [x.source, x.evidence])) };
}
export function applyRule<T extends { evidence: Evidence; lines: Line[] }>(source: string, b: T, ov: Overrides): T {
  return { ...b, evidence: ov.ev.get(source) ?? b.evidence, lines: b.lines.map((l) => ({ ...l, role: ov.maps.get(`${source}:${l.role}`) ?? l.role })) };
}

/** 정기 작업 acct_journal — 근거마다 한 거래(전표 + 줄 · 차변 = 대변은 DB 가 거래 끝에 확인) */
export async function runJournal(db: DatabaseService, sources: Source[] = SOURCES) {   // v10.392 — ⑫ 매입 · 경비 · 재고는 sources.ts ALL_SOURCES
  const [s] = await db.query<{ sv: string | null; cv: string | null }>(
    `SELECT (SELECT value FROM site_settings WHERE key = 'acct.sub_vat_included') AS sv, (SELECT value FROM site_settings WHERE key = 'acct.commission_vat_included') AS cv`);
  const ctx: Ctx = { subVat: (s?.sv ?? 'on') === 'on', commissionVat: (s?.cv ?? 'on') === 'on' };
  const ov = await ruleOverrides(db);
  const made: Record<string, number> = {}, failed: Array<{ source: string; key: string; why: string }> = [];
  for (const src of sources) {
    const rows = await db.query<Row>(src.sql);
    for (const r of rows) {
      const b0 = src.build(r, ctx);
      const b = b0 ? applyRule(src.name, b0, ov) : null;
      const lines = (b?.lines ?? []).filter((l) => l.debit > 0 || l.credit > 0);
      if (!b || lines.length < 2) continue;
      try {
        const done = await db.transaction(async () => {
          const [e] = await db.query<{ id: string }>(
            `WITH d AS (SELECT ($1::timestamptz AT TIME ZONE 'Asia/Seoul')::date AS day)
             INSERT INTO acct_entries (entry_date, source, source_key, memo, party, evidence, late)
             SELECT CASE WHEN EXISTS (SELECT 1 FROM acct_closings c WHERE c.ym = to_char(d.day, 'YYYY-MM')) THEN (now() AT TIME ZONE 'Asia/Seoul')::date ELSE d.day END,
                    $2, $3, $4, $5, $6, EXISTS (SELECT 1 FROM acct_closings c WHERE c.ym = to_char(d.day, 'YYYY-MM'))
               FROM d
             ON CONFLICT (source, source_key) DO NOTHING RETURNING id::text AS id`,
            [r.at, src.name, r.key, b.memo.slice(0, 200), r.party ? String(r.party).slice(0, 120) : null, b.evidence]);
          if (!e) return false;
          await db.query(
            `INSERT INTO acct_lines (entry_id, role, debit, credit)
             SELECT $1::bigint, x.role, x.debit, x.credit FROM jsonb_to_recordset($2::jsonb) AS x(role text, debit bigint, credit bigint)`,
            [e.id, JSON.stringify(lines)]);
          return true;
        });
        // 셈은 COMMIT(차변 = 대변 미룬 검사) 지난 뒤에만
        if (done) made[src.name] = (made[src.name] ?? 0) + 1;
      } catch (err) {
        failed.push({ source: src.name, key: r.key, why: String((err as Error)?.message ?? err).slice(0, 160) });
      }
    }
  }
  return { made, total: Object.values(made).reduce((a, b) => a + b, 0), failed: failed.slice(0, 20), failedCount: failed.length };
}
