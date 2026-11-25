/* e3 (docs/010) 소개뱅크 src/modules/acct/corptax.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.407 (D248 · docs/544) 법인세 추정 미리보기
 *   올해(사업연도) 전표의 수익 − 비용 = 회계 이익을 과세표준으로 보고(세무조정 없음) 세율 구간(acct.corp_tax_brackets)대로 셉니다.
 *   ① 지금까지(YTD) · ② 1년으로 늘린 값(YTD ÷ 지난 달 수 × 12) · ③ 중간예납 가결산 추정(상반기 이익 × 2 의 세액 ÷ 2) · 지방소득세(acct.corp_local_rate %).
 *   기한: 중간예납 = 사업연도 시작 6개월 기간 끝 달의 2개월 뒤 말일 · 확정 신고 = 사업연도 끝 달의 3개월 뒤 말일(주말 · 공휴일이면 다음 영업일).
 *   해 마감 · 풀기 전표(⑭ YEAR_CLOSE · YEAR_REOPEN)는 손익에서 뺍니다. 손익 계정은 기초 잔액이 없어 전표 줄만 셉니다(⑬ trialBalance 와 같은 값).
 *   세율 · 계산은 초안 — 세무조정(기업업무추진비 한도 · 감가상각 한도 · 이월결손금 · 공제 · 감면)은 세무사가 합니다.
 * ------------------------------------------------------------------- */

export interface Bracket { upTo: number | null; rate: number }

export function parseBrackets(v: string | null | undefined): Bracket[] {
  const def = '200000000:9,20000000000:19,300000000000:21,*:24';
  const parts = (v && /^([0-9]{1,15}:[0-9]{1,2}(\.[0-9])?,){0,9}\*:[0-9]{1,2}(\.[0-9])?$/.test(v) ? v : def).split(',');
  const out = parts.map((p) => { const [a, r] = p.split(':'); return { upTo: a === '*' ? null : Number(a), rate: Number(r) }; });
  /* 상한은 올라가는 순서여야 함 — 아니면 기본값 */
  for (let i = 1; i < out.length - 1; i++) if ((out[i].upTo ?? Infinity) <= (out[i - 1].upTo ?? Infinity)) return parseBrackets(def);
  return out;
}

/** 누진 세액(원 · 내림) */
export function corpTax(base: number, br: Bracket[]): number {
  if (base <= 0) return 0;
  let tax = 0, prev = 0;
  for (const b of br) {
    const top = b.upTo ?? Infinity;
    if (base > prev) tax += (Math.min(base, top) - prev) * b.rate / 100;
    prev = top;
    if (base <= top) break;
  }
  return Math.floor(tax);
}

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);   // m = 1 ~ 12
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

async function settings(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM erp_site_settings WHERE key IN ('acct.corp_tax_brackets', 'acct.corp_local_rate', 'acct.corp_fiscal_end')`);
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const end = Math.min(12, Math.max(1, Number(v('acct.corp_fiscal_end') ?? 12) || 12));
  return { brackets: parseBrackets(v('acct.corp_tax_brackets')), local: Math.min(99, Math.max(0, Number(v('acct.corp_local_rate') ?? 10) || 0)), fiscalEnd: end, raw: v('acct.corp_tax_brackets') };
}

/** 오늘이 속한 사업연도 [시작, 끝] */
export function fiscalYear(today: string, fiscalEnd: number) {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const endY = m > fiscalEnd ? y + 1 : y;
  const startM = fiscalEnd === 12 ? 1 : fiscalEnd + 1, startY = fiscalEnd === 12 ? endY : endY - 1;
  return { start: `${startY}-${String(startM).padStart(2, '0')}-01`, end: lastDay(endY, fiscalEnd), startY, startM, endY };
}

async function profit(db: DatabaseService, from: string, to: string) {
  const [r] = await db.query<{ rev: string; exp: string }>(
    `SELECT coalesce(sum(l.credit - l.debit) FILTER (WHERE a.kind = 'REVENUE'), 0)::text AS rev,
            coalesce(sum(l.debit - l.credit) FILTER (WHERE a.kind = 'EXPENSE'), 0)::text AS exp
       FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id JOIN acct_accounts a ON a.role = l.role
      WHERE e.entry_date BETWEEN $1::date AND $2::date AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')`, [from, to]);
  const revenue = Number(r?.rev ?? 0), expense = Number(r?.exp ?? 0);
  return { revenue, expense, profit: revenue - expense };
}

/** 주말 · 공휴일이면 다음 영업일(month.ts bizDay 와 같은 방식) */
async function bizDay(db: DatabaseService, d: string) {
  const [r] = await db.query<{ d: string }>(
    `WITH RECURSIVE x(d, n) AS (SELECT $1::date, 0 UNION ALL SELECT d + 1, n + 1 FROM x WHERE NOT fn_is_business_day(d) AND n < 30)
     SELECT d::text AS d FROM x ORDER BY n DESC LIMIT 1`, [d]);
  return r?.d ?? d;
}

export interface CorpDeadline { key: string; kind: 'CORP'; label: string; due: string; base: string; daysLeft: number }

/** 법인세 기한(지나지 않은 것 · 가까운 2개) — month.ts deadlines() 에 붙이는 용도 */
export async function corpDeadlines(db: DatabaseService, today = kstToday()): Promise<CorpDeadline[]> {
  const s = await settings(db);
  const out: CorpDeadline[] = [];
  for (const off of [-1, 0, 1]) {
    const fy = fiscalYear(today, s.fiscalEnd);
    const sy = fy.startY + off, sm = fy.startM;
    /* 중간예납: 시작 6개월 기간 끝 달 + 2개월 말일 */
    const mid = new Date(Date.UTC(sy, sm - 1 + 5 + 2, 1));
    const midBase = lastDay(mid.getUTCFullYear(), mid.getUTCMonth() + 1);
    /* 확정: 끝 달 + 3개월 말일 */
    const fin = new Date(Date.UTC(sy, sm - 1 + 11 + 3, 1));
    const finBase = lastDay(fin.getUTCFullYear(), fin.getUTCMonth() + 1);
    const fyLabel = sm === 1 ? `${sy}년` : `${sy}.${sm} 시작 사업연도`;
    for (const c of [{ k: 'MID', base: midBase, label: `법인세 중간예납(${fyLabel})` }, { k: 'FINAL', base: finBase, label: `법인세 확정 신고 · 납부(${fyLabel})` }]) {
      const due = await bizDay(db, c.base);
      if (due < today || out.some((o) => o.key === `CORP_${c.k}:${c.base}`)) continue;
      out.push({ key: `CORP_${c.k}:${c.base}`, kind: 'CORP', label: c.label, due, base: c.base, daysLeft: Math.round((Date.parse(due) - Date.parse(today)) / 86400e3) });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due)).slice(0, 2);
}

/** GET /admin/acct/corptax — 올해 추정 */
export async function corpTaxPreview(db: DatabaseService, today = kstToday()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new PolicyViolation('ACCT_CORPTAX', '날짜가 바르지 않습니다.');
  const s = await settings(db);
  const fy = fiscalYear(today, s.fiscalEnd);
  const to = today < fy.end ? today : fy.end;
  const ytd = await profit(db, fy.start, to);
  const months = Math.max(1, (Number(to.slice(0, 4)) - fy.startY) * 12 + (Number(to.slice(5, 7)) - fy.startM) + 1);
  const annual = Math.round(ytd.profit / months * 12);
  const h1End = lastDay(new Date(Date.UTC(fy.startY, fy.startM - 1 + 5, 1)).getUTCFullYear(), new Date(Date.UTC(fy.startY, fy.startM - 1 + 5, 1)).getUTCMonth() + 1);
  const h1 = await profit(db, fy.start, h1End < to ? h1End : to);
  const calc = (base: number) => { const t = corpTax(base, s.brackets); return { base, tax: t, local: Math.floor(t * s.local / 100), total: t + Math.floor(t * s.local / 100) }; };
  const interim = (() => { const t = corpTax(h1.profit * 2, s.brackets); const half = Math.floor(t / 2); return { base: h1.profit, tax: half, local: 0, total: half }; })();
  return {
    fiscalYear: { start: fy.start, end: fy.end }, asOf: to, months,
    ytd: { ...ytd, ...calc(ytd.profit) }, annualized: { profit: annual, ...calc(annual) }, interim, firstHalfComplete: to >= h1End,
    brackets: s.brackets, localRate: s.local, deadlines: await corpDeadlines(db, today),
    note: '회계 이익을 그대로 과세표준으로 본 추정입니다(세무조정 · 이월결손금 · 공제 · 감면 없음). 중간예납은 가결산 방식 추정이고, 직전 연도 세액의 절반 방식과 다를 수 있습니다. 세율 구간은 설정(acct.corp_tax_brackets)이며 초안이라 세무사 확인이 필요합니다. 전표는 시스템을 지난 돈만 담깁니다.',
  };
}
