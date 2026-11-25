/* e3 (docs/010) 소개뱅크 src/modules/acct/whtformula.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
/* ---------------------------------------------------------------------
 * v10.418 (D251 · docs/555) 근로소득 간이세액 산식 근사 — 대표 11/19 「일반적인 원칙에 의해서 적용」
 *   국세청 간이세액표(acct_wht_table)가 없을 때만 씀 · 표를 올리면 표가 우선.
 *   소득세법 시행령 별표2 간이세액표 작성 방식을 줄여 셈(자녀세액공제는 뺌 → 표와 몇천 ~ 1.5만 원 차이 · 연말정산에서 정산).
 *   1) 연 총급여 = 월 과세 급여 × 12
 *   2) 근로소득공제(500만 70% · 1,500만 40% · 4,500만 15% · 1억 5% · 초과 2% · 한도 2,000만)
 *   3) 인적공제 150만 × 공제 대상 가족 수(본인 포함 · 최소 1)
 *   4) 연금보험료 공제(국민연금 본인 몫 × 12) · 특별소득공제 등(간이세액표 산식 — 가족 1 · 2 · 3명 이상 · 총급여 구간별 · 1.2억 넘으면 0)
 *   5) 기본세율(2023 ~ · 1,400만 6% · 5,000만 15% · 8,800만 24% · 1.5억 35% · 3억 38% · 5억 40% · 10억 42% · 초과 45%)
 *   6) 근로소득세액공제(산출 130만 이하 55% · 초과 71.5만 + 30% · 총급여 구간별 한도)
 *   7) 연 결정세액 ÷ 12 · 10원 미만 버림
 * ------------------------------------------------------------------- */
const floor10 = (x: number) => Math.max(0, Math.floor(x / 10) * 10);

export function earnedIncomeDeduction(g: number) {
  const d = g <= 5_000_000 ? g * 0.7
    : g <= 15_000_000 ? 3_500_000 + (g - 5_000_000) * 0.4
    : g <= 45_000_000 ? 7_500_000 + (g - 15_000_000) * 0.15
    : g <= 100_000_000 ? 12_000_000 + (g - 45_000_000) * 0.05
    : 14_750_000 + (g - 100_000_000) * 0.02;
  return Math.min(d, 20_000_000);
}

const BRACKETS: Array<[number, number, number]> = [   // [이하, 세율, 누진공제]
  [14_000_000, 0.06, 0], [50_000_000, 0.15, 1_260_000], [88_000_000, 0.24, 5_760_000], [150_000_000, 0.35, 15_440_000],
  [300_000_000, 0.38, 19_940_000], [500_000_000, 0.40, 25_940_000], [1_000_000_000, 0.42, 35_940_000], [Infinity, 0.45, 65_940_000],
];
export function basicTax(base: number) {
  if (base <= 0) return 0;
  const [, rate, minus] = BRACKETS.find(([upto]) => base <= upto)!;
  return base * rate - minus;
}

export function earnedTaxCredit(tax: number, gross: number) {
  const c = tax <= 1_300_000 ? tax * 0.55 : 715_000 + (tax - 1_300_000) * 0.3;
  const cap = gross <= 33_000_000 ? 740_000
    : gross <= 70_000_000 ? Math.max(660_000, 740_000 - (gross - 33_000_000) * 0.008)
    : gross <= 120_000_000 ? Math.max(500_000, 660_000 - (gross - 70_000_000) * 0.5)
    : Math.max(200_000, 500_000 - (gross - 120_000_000) * 0.5);
  return Math.min(c, cap);
}

/** 간이세액표 「특별소득공제 등」(연) — 공제 대상 가족 수 · 연 총급여 */
export function specialDeduction(g: number, dep: number) {
  if (g > 120_000_000) return 0;
  if (dep >= 3) {
    if (g <= 30_000_000) return 5_000_000 + g * 0.07;
    if (g <= 45_000_000) return 5_000_000 + g * 0.07 - (g - 30_000_000) * 0.05;
    if (g <= 70_000_000) return 5_000_000 + g * 0.05 + (g - 40_000_000) * 0.04;
    return 5_000_000 + g * 0.03 + (g - 40_000_000) * 0.04;
  }
  const [a, r1, r3, r4] = dep === 2 ? [3_600_000, 0.04, 0.02, 0.01] : [3_100_000, 0.04, 0.015, 0.005];
  if (g <= 30_000_000) return a + g * r1;
  if (g <= 45_000_000) return a + g * r1 - (g - 30_000_000) * 0.05;
  if (g <= 70_000_000) return a + g * r3;
  return a + g * r4;
}

/** 월 소득세(지방소득세 빼고) 근사 — taxable 월 과세 급여 · dependents 공제 대상 가족(본인 포함) · np 월 국민연금 본인 몫 */
export function estimateMonthlyWht(taxable: number, dependents: number, np: number) {
  if (taxable <= 0) return 0;
  const g = taxable * 12;
  const income = g - earnedIncomeDeduction(g);
  const base = income - 1_500_000 * Math.max(1, dependents) - np * 12 - specialDeduction(g, Math.max(1, dependents));
  const tax = basicTax(base);
  const finalTax = Math.max(0, tax - earnedTaxCredit(tax, g));
  return floor10(finalTax / 12);
}
