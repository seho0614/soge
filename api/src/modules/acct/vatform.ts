/* e3 (docs/010) 소개뱅크 src/modules/acct/vatform.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.400 (D247 · docs/537) 부가세 신고서 미리보기 — 일반과세자 신고서 칸을 전표 · 매입 관리로 채움
 *   매출: 전표 VAT_OUT 이 있는 돈 흐름의 공급가(수익 계정) · 증빙별로 칸을 나눔
 *     (1) 과세 세금계산서 발급분 = 증빙 TAX_INVOICE
 *     (3) 과세 신용카드 · 현금영수증 발행분 = CARD_PG · CASH
 *     (4) 과세 기타(정규영수증 외) = 그 밖
 *     (5)(6) 영세율 — (6) 수출 매출(v10.428 REV_EXPORT) · (5) 영세율 세금계산서는 아직 없음(0) · 면세 수입금액(소개몰 면세 상품)은 따로
 *   매입: 전표 VAT_IN(공제되는 매입 부가세)을 증빙별로
 *     (10) 세금계산서 수취분 일반매입 = TAX_INVOICE 중 고정자산(⑬ FIXED_ASSET) 아닌 것 · (11) 고정자산 매입 = 같은 전표에 FIXED_ASSET 차변
 *     (14) 그 밖의 공제매입세액(신용카드매출전표 등 수령명세서) = CARD · CARD_PG · CASH
 *     (16) 공제받지 못할 매입세액 = ⑫ 매입 관리 불공제(간이영수증 · 기업업무추진비 등) — 참고 칸(납부세액 셈에는 이미 빠짐)
 *   납부(환급)세액 = 매출세액 − 매입세액 − 전자신고 세액공제(확정 신고 분기 · acct.vat_efile_credit) · 예정고지 · 감면은 세무사가 넣음.
 *   미리보기일 뿐 — 실제 신고는 세무사 · 홈택스. 신고서 칸 번호는 서식 개정마다 바뀔 수 있어 「세무사 확인」.
 * ------------------------------------------------------------------- */

export function vatQuarter(q?: string) {
  let y: number, k: number;
  const m = /^(\d{4})-([1-4])$/.exec(q ?? '');
  if (m) { y = Number(m[1]); k = Number(m[2]); }
  else if (q) return null;
  else { const d = new Date(Date.now() + 9 * 3600e3); y = d.getUTCFullYear(); k = Math.floor(d.getUTCMonth() / 3) + 1; }
  const from = `${y}-${String(k * 3 - 2).padStart(2, '0')}-01`;
  const to = k === 4 ? `${y + 1}-01-01` : `${y}-${String(k * 3 + 1).padStart(2, '0')}-01`;
  /* 1기 예정(1분기) · 1기 확정(2분기) · 2기 예정(3분기) · 2기 확정(4분기) */
  const label = `${y}년 ${k <= 2 ? 1 : 2}기 ${k % 2 === 1 ? '예정' : '확정'}`;
  return { q: `${y}-${k}`, from, to, label, final: k % 2 === 0, year: y, k };
}

const n = (v: unknown) => Number(v ?? 0);

export async function vatForm(db: DatabaseService, q?: string) {
  const r = vatQuarter(q);
  if (!r) throw new PolicyViolation('ACCT_PERIOD', '분기는 YYYY-1 ~ YYYY-4 입니다.');
  /* 매출 — 돈 흐름(전표)마다 수익 공급가 · VAT_OUT · 면세 */
  const sales = await db.query<{ evidence: string; supply: string; vat: string; exempt: string }>(
    `SELECT e.evidence,
            coalesce(sum(l.credit - l.debit) FILTER (WHERE a.kind = 'REVENUE' AND l.role <> 'REV_MALL_EXEMPT' AND l.role NOT IN ('GAIN_DISPOSAL')), 0)::text AS supply,
            coalesce(sum(l.credit - l.debit) FILTER (WHERE l.role = 'VAT_OUT'), 0)::text AS vat,
            coalesce(sum(l.credit - l.debit) FILTER (WHERE l.role = 'REV_MALL_EXEMPT'), 0)::text AS exempt
       FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id JOIN acct_accounts a ON a.role = l.role
      WHERE e.entry_date >= $1::date AND e.entry_date < $2::date AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')
        AND EXISTS (SELECT 1 FROM acct_lines v WHERE v.entry_id = e.id AND v.role IN ('VAT_OUT', 'REV_MALL_EXEMPT'))
      GROUP BY e.evidence`, [r.from, r.to]);
  const pick = (f: (ev: string) => boolean) => sales.filter((x) => f(x.evidence)).reduce((a, x) => ({ supply: a.supply + n(x.supply), vat: a.vat + n(x.vat) }), { supply: 0, vat: 0 });
  const s1 = pick((e) => e === 'TAX_INVOICE'), s3 = pick((e) => e === 'CARD_PG' || e === 'CASH' || e === 'CARD'), s4 = pick((e) => !['TAX_INVOICE', 'CARD_PG', 'CASH', 'CARD'].includes(e));
  const exempt = sales.reduce((a, x) => a + n(x.exempt), 0);
  /* v10.428 (D254) — 영세율 · 기타(6) = 수출 매출(REV_EXPORT · 부가세 0 · 수출신고필증) · 영세율 세금계산서(5 · 내국신용장 · 구매확인서)는 아직 없음(0) */
  const [zx] = await db.query<{ s: string }>(
    `SELECT coalesce(sum(l.credit - l.debit), 0)::text AS s FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id
      WHERE l.role = 'REV_EXPORT' AND e.entry_date >= $1::date AND e.entry_date < $2::date AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')`, [r.from, r.to]).catch(() => [{ s: '0' }]);
  const s6 = { supply: n(zx?.s), vat: 0 };
  const outTotal = { supply: s1.supply + s3.supply + s4.supply + s6.supply, vat: s1.vat + s3.vat + s4.vat };

  /* 매입 — VAT_IN 차변(공제) · 같은 전표에 FIXED_ASSET 이 있으면 고정자산 */
  const buys = await db.query<{ evidence: string; fixed: boolean; vat: string; supply: string }>(
    `SELECT evidence, fixed, sum(vat)::text AS vat, sum(supply)::text AS supply FROM (
       SELECT e.id, e.evidence, EXISTS (SELECT 1 FROM acct_lines f WHERE f.entry_id = e.id AND f.role = 'FIXED_ASSET' AND f.debit > 0) AS fixed,
              coalesce(sum(l.debit - l.credit) FILTER (WHERE l.role = 'VAT_IN'), 0) AS vat,
              coalesce(sum(l.debit - l.credit) FILTER (WHERE l.role <> 'VAT_IN' AND l.debit > 0), 0) AS supply
         FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id
        WHERE e.entry_date >= $1::date AND e.entry_date < $2::date
          AND EXISTS (SELECT 1 FROM acct_lines v WHERE v.entry_id = e.id AND v.role = 'VAT_IN')
        GROUP BY e.id, e.evidence) x
      GROUP BY evidence, fixed`, [r.from, r.to]);
  const pb = (f: (x: typeof buys[number]) => boolean) => buys.filter(f).reduce((a, x) => ({ supply: a.supply + n(x.supply), vat: a.vat + n(x.vat) }), { supply: 0, vat: 0 });
  const b10 = pb((x) => x.evidence === 'TAX_INVOICE' && !x.fixed), b11 = pb((x) => x.evidence === 'TAX_INVOICE' && x.fixed);
  const b14 = pb((x) => x.evidence !== 'TAX_INVOICE');
  /* 불공제(참고) — ⑫ 매입 관리에서 deductible = false */
  const has = await db.query<{ ok: boolean }>(`SELECT to_regclass('public.acct_purchases') IS NOT NULL AS ok`);
  let b16 = { supply: 0, vat: 0, count: 0 };
  if (has[0]?.ok) {
    const [x] = await db.query<{ s: string; v: string; c: number }>(
      `SELECT coalesce(sum(supply), 0)::text AS s, coalesce(sum(vat), 0)::text AS v, count(*)::int AS c
         FROM acct_purchases WHERE state = 'ACTIVE' AND NOT deductible AND vat > 0 AND issued_on >= $1::date AND issued_on < $2::date`, [r.from, r.to]);
    b16 = { supply: n(x?.s), vat: n(x?.v), count: n(x?.c) };
  }
  const inTotal = { supply: b10.supply + b11.supply + b14.supply, vat: b10.vat + b11.vat + b14.vat };
  const [st] = await db.query<{ v: string | null }>(`SELECT value AS v FROM erp_site_settings WHERE key = 'acct.vat_efile_credit'`);
  const payable = outTotal.vat - inTotal.vat;
  const efile = r.final && payable > 0 ? Math.min(payable, Math.max(0, Number(st?.v ?? 10000) || 0)) : 0;
  const lines = [
    { no: '1', group: '매출', label: '과세 · 세금계산서 발급분', ...s1 },
    { no: '2', group: '매출', label: '과세 · 매입자발행 세금계산서', supply: 0, vat: 0 },
    { no: '3', group: '매출', label: '과세 · 신용카드 · 현금영수증 발행분', ...s3 },
    { no: '4', group: '매출', label: '과세 · 기타(정규영수증 외 매출분)', ...s4 },
    { no: '5', group: '매출', label: '영세율 · 세금계산서 발급분', supply: 0, vat: 0 },
    { no: '6', group: '매출', label: '영세율 · 기타(수출 · v10.428)', ...s6 },
    { no: '9', group: '매출', label: '매출 합계(매출세액)', ...outTotal },
    { no: '10', group: '매입', label: '세금계산서 수취분 · 일반매입', ...b10 },
    { no: '11', group: '매입', label: '세금계산서 수취분 · 고정자산 매입', ...b11 },
    { no: '14', group: '매입', label: '그 밖의 공제매입세액(신용카드 · 현금영수증 수령)', ...b14 },
    { no: '15', group: '매입', label: '매입 합계(공제 매입세액)', ...inTotal },
    { no: '16', group: '참고', label: '공제받지 못할 매입세액(⑫ 매입 관리 불공제 · 이미 빠짐)', supply: b16.supply, vat: b16.vat },
    { no: '다', group: '납부', label: '납부(환급)세액 = 매출세액 − 매입세액', supply: 0, vat: payable },
    { no: '라', group: '납부', label: '전자신고 세액공제(확정 신고)', supply: 0, vat: -efile },
    { no: '마', group: '납부', label: '차가감 납부할 세액(예정고지 · 감면 전)', supply: 0, vat: payable - efile },
  ];
  return { ok: true as const, q: r.q, label: r.label, from: r.from, to: r.to, final: r.final, lines, exempt, payable, efile, due: payable - efile,
    note: '전표 · 매입 관리로 채운 미리보기입니다 — 예정고지세액 · 감면 · 가산세 · 영세율은 넣지 않았습니다. 실제 신고는 세무사 · 홈택스에서 하고, 칸 번호 · 공제액은 세무사 확인이 필요합니다.' };
}

/** CSV 줄 — 칸 번호 · 나눔 · 이름 · 공급가 · 세액 */
export function vatFormRows(f: Awaited<ReturnType<typeof vatForm>>) {
  return { head: ['칸', '나눔', '항목', '금액(공급가)', '세액'], rows: [...f.lines.map((l) => [l.no, l.group, l.label, l.supply, l.vat]), ['', '참고', '면세 수입금액(소개몰 면세 상품)', f.exempt, '']] };
}
