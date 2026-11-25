/* e3 (docs/010) 소개뱅크 src/modules/lsx/bump.ts 에서 LSX_SOURCES 와 그것이 쓰는 선언만 옮김(R3) — 글자 그대로 · R1 · R2 · 나머지는 소개뱅크에 남음 */
import { Source, cr, dr, reverse, vatSplit } from '../acct/journal';

const num = (v: unknown) => Number(v ?? 0);

const bumpLines = (amt: number, vat: unknown, split: boolean) => {
  if (vat == null) {
    if (!split) return [dr('PG_RECV', amt), cr('REV_BUMP', amt)];
    const v = vatSplit(amt);
    return [dr('PG_RECV', amt), cr('REV_BUMP', v.supply), cr('VAT_OUT', v.vat)];
  }
  return [dr('PG_RECV', amt), cr('REV_BUMP', amt - num(vat)), ...(num(vat) > 0 ? [cr('VAT_OUT', num(vat))] : [])];
};

export const LSX_SOURCES: Source[] = [
  {
    name: 'LSX_BUMP_PAID', label: '끌어올리기 결제',
    sql: `SELECT p.id::text AS key, p.paid_at AS at, p.amount::bigint AS amt, nullif(p.vat, 0)::bigint AS vat, NULL::text AS party
            FROM svc.lsx_bump_payments p
           WHERE p.amount > 0 AND p.paid_at >= fn_acct_from() AND fn_acct_stub_ok(p.stub)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'LSX_BUMP_PAID' AND e.source_key = p.id::text)
           ORDER BY p.paid_at LIMIT 500`,
    build: (r, c) => ({ memo: '매물 끌어올리기 결제', evidence: 'CARD_PG', lines: bumpLines(num(r.amt), r.vat, c.subVat) }),
  },
  {
    name: 'LSX_BUMP_REFUND', label: '끌어올리기 환불',
    sql: `SELECT p.id::text AS key, p.refunded_at AS at, p.amount::bigint AS amt, nullif(p.vat, 0)::bigint AS vat, NULL::text AS party
            FROM svc.lsx_bump_payments p
           WHERE p.refunded_at IS NOT NULL AND p.refund_amount = p.amount AND fn_acct_stub_ok(p.stub)
             AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'LSX_BUMP_PAID' AND e.source_key = p.id::text)
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'LSX_BUMP_REFUND' AND e.source_key = p.id::text)
           ORDER BY p.refunded_at LIMIT 500`,
    build: (r, c) => ({ memo: '매물 끌어올리기 환불', evidence: 'CARD_PG', lines: reverse(bumpLines(num(r.amt), r.vat, c.subVat)) }),
  },
];
