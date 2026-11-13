import { useState } from 'react';
import { useApi } from '../../lib/useApi';

interface Rate { categoryCode: string; rate: string | number; note: string | null }

/**
 * SB-ADM-HSL-010 소개몰 판매자 › 판매수수료율 시뮬레이션 (v10.270 · docs/402) — **계산만 · 저장하지 않음**
 *
 *   입점 약관 제17조는 요율을 입점 유형(브랜드 직영관 · 일반 입점)으로 정하므로 두 유형으로 셉니다.
 *   실제 적용은 「소개몰 정산」의 갈래 요율 · 판매자 요율(fn_hlt_rate_for · 기본 10%)입니다 — 아래에 지금 갈래 요율을 함께 보여 줍니다(읽기만).
 *   판매수수료 = 판매액 × 요율 ÷ 100 버림(DB 주문 줄과 같은 식) · 결제대행 수수료는 판매자 몫에서 뺌(약관 제19조).
 */
function rateSim(rows: Array<{ n: number; sales: number; rate: number }>, pg: number) {
  const per = rows.map((r) => {
    const total = r.n * r.sales;
    const fee = Math.floor((total * r.rate) / 100);
    const pgFee = Math.floor((total * pg) / 100);
    const perSeller = r.n ? Math.floor((r.sales * r.rate) / 100) : 0;
    return { total, fee, pgFee, net: total - fee - pgFee, perSeller };
  });
  const fee = per.reduce((a, x) => a + x.fee, 0);
  return { per, fee, year: fee * 12, vat: Math.floor(fee / 10), sales: per.reduce((a, x) => a + x.total, 0), net: per.reduce((a, x) => a + x.net, 0) };
}

export function HealthRateSim() {
  const q = useApi<Rate[]>('/admin/health/commission-rates');
  const [v, setV] = useState({ bn: '5', bs: '3000000', br: '10', gn: '20', gs: '1000000', gr: '10', pg: '3' });
  const num = (s: string) => Math.max(0, Number(s.replace(/[^0-9.]/g, '')) || 0);
  const r = rateSim([
    { n: Math.floor(num(v.bn)), sales: Math.floor(num(v.bs)), rate: num(v.br) },
    { n: Math.floor(num(v.gn)), sales: Math.floor(num(v.gs)), rate: num(v.gr) },
  ], num(v.pg));
  const won = (x: number) => `${x.toLocaleString('ko-KR')}원`;
  const inp = (k: keyof typeof v, w = 70) => (
    <input value={v[k]} onChange={(e) => setV((o) => ({ ...o, [k]: e.target.value }))} inputMode="decimal" style={{ width: w }} data-hlt-sim-in={k} />
  );
  const TYPES: Array<[string, 'b' | 'g']> = [['브랜드 직영관', 'b'], ['일반 입점', 'g']];
  return (
    <div className="card pad" data-hlt-sim={`${r.fee}|${r.year}`} style={{ margin: '10px 0' }}>
      <b>판매수수료율 시뮬레이션</b> <span className="dim">— 계산만 · 저장하지 않음 · 입점 약관 제17조(입점 유형별 요율) 정할 때</span>
      <table className="tbl" style={{ marginTop: 6 }}>
        <thead><tr><th>입점 유형</th><th>판매자 수</th><th>한 판매자 한 달 판매액(원)</th><th>요율(%)</th><th>한 달 판매액</th><th>회사 수수료</th><th>판매자 한 명 수수료</th><th>판매자가 받는 합계</th></tr></thead>
        <tbody>
          {TYPES.map(([t, p], i) => (
            <tr key={p} data-hlt-sim-row={p}>
              <td>{t}</td><td>{inp(`${p}n` as keyof typeof v, 60)}</td><td>{inp(`${p}s` as keyof typeof v, 110)}</td><td>{inp(`${p}r` as keyof typeof v, 50)}</td>
              <td>{won(r.per[i]!.total)}</td><td><b>{won(r.per[i]!.fee)}</b></td><td>{won(r.per[i]!.perSeller)}</td><td>{won(r.per[i]!.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ margin: '6px 0' }}><label>결제대행 수수료(%) — 판매자 몫에서 뺌 {inp('pg', 50)}</label></p>
      <table className="tbl"><tbody>
        <tr><th>회사 수수료 · 한 달</th><td data-hlt-sim-out="month"><b>{won(r.fee)}</b></td></tr>
        <tr><th>회사 수수료 · 1년(12달 같은 판매액)</th><td data-hlt-sim-out="year"><b>{won(r.year)}</b></td></tr>
        <tr><th>수수료에 부가세가 별도라면</th><td data-hlt-sim-out="vat">세금계산서 부가세 {won(r.vat)} · 합계 {won(r.fee + r.vat)}(한 달)</td></tr>
        <tr><th>전체 판매액 · 판매자가 받는 합계</th><td>{won(r.sales)} · {won(r.net)}(한 달)</td></tr>
      </tbody></table>
      <p className="dim" style={{ marginTop: 4 }} data-hlt-sim-rates={q.data ? q.data.length : ''}>
        지금 갈래 요율(실제 적용 · 바꾸기는 「소개몰 정산」): {q.data && q.data.length ? q.data.map((x) => `${x.categoryCode} ${Number(x.rate)}%`).join(' · ') : '갈래별로 정한 값 없음 — 모두 기본 10%'}
        {' '}· 환불 · 쿠폰 · 반품비는 넣지 않은 어림입니다.
      </p>
    </div>
  );
}
