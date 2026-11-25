/* e3 (docs/010) 소개뱅크 src/modules/qlt/claims.ts 에서 QLT_SOURCES 와 그것이 쓰는 선언만 옮김(R3) — 글자 그대로 · R1 · R2 · 나머지는 소개뱅크에 남음 */
import type { Source } from '../acct/journal';

const n = (v: unknown) => Number(v ?? 0);

export const QLT_SOURCES: Source[] = [
  {
    name: 'QLT_SUP_RETURN', label: '공급사 반품(품질 클레임)',
    sql: `SELECT m.id::text AS key, (m.moved_on::timestamp AT TIME ZONE 'Asia/Seoul') AS at, (-m.amount)::bigint AS amt, -m.qty AS qty, pa.name AS party,
                 fn_hlt_option_label(o.months, o.tag) AS label, split_part(m.source_key, ':', 2) AS claim
            FROM acct_stock_moves m JOIN svc.hlt_product_options o ON o.id = m.option_id
            LEFT JOIN qlt_claims c ON m.source_key LIKE 'QC:%' AND c.id::text = split_part(m.source_key, ':', 2)
            LEFT JOIN acct_parties pa ON pa.id = c.party_id
           WHERE m.kind = 'SUP_RETURN' AND m.amount <> 0 AND (m.moved_on::timestamp AT TIME ZONE 'Asia/Seoul') >= fn_acct_from()
             AND NOT EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'QLT_SUP_RETURN' AND e.source_key = m.id::text)
           ORDER BY m.id LIMIT 500`,
    build: (r) => ({ memo: `공급사 반품 ${r.label ?? ''} ${r.qty}개 (클레임 ${r.claim ?? ''})`.trim(), evidence: 'NONE',
      lines: [{ role: 'AP', debit: Math.abs(n(r.amt)), credit: 0 }, { role: 'INVENTORY', debit: 0, credit: Math.abs(n(r.amt)) }] }),
  },
];
