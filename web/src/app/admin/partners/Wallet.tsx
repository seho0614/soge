import { useApi } from '../../../lib/useApi';
import { n } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { CashWallets, CashInvoices, CashRules } from '../PartnerCash';

interface FeeRow {
  partnerId: string; company: string; grade: string;
  unpaid: number | string; unpaidCap: number | string; voided: number | string;
}

/* ── SB-ADM-PTN-080 이용료 · 등급 ────────────────────────────────── */
const RATIO: Array<[string, number, string]> = [
  ['S', 1.0, '확정'], ['A+', 0.85, '확정'], ['A', 0.72, '확정'], ['A-', 0.6, '확정'],
  ['B+', 0.48, '미응답'], ['B', 0.33, '미응답'], ['B-', 0.22, '미응답'], ['C', 0.12, '발송실패'],
];

export function Wallet({ onGo }: { onGo?: (tab: string) => void }) {
  const fees = useApi<FeeRow[]>('/admin/partners/fees');
  if (fees.error) return <ErrorView error={fees.error} onRetry={fees.reload} />;
  if (!fees.data) return <p className="muted">불러오는 중…</p>;
  const rows = fees.data;

  /* v10.31 (10/10 시안 · scAdmPtnW) — 시안 순서: 안내 → 입금 확인 대기 → 등급별 확인비용 비율 → 법률 · 세무 월 정액 노출.
   * 리드 이용료는 W5 가 선불 충전 잔액으로 바꿨습니다(D070) — 잔액 · 원장 · 세금계산서 구역은 W5 API(/admin/partner-center/cash · lead-cash-invoices · rules)를 씁니다(v10.31 합침으로 연결). */
  return (
    <>
      <div className="ad-nt">PG · 가상계좌 입금대사가 연동되어 있지 않아 본사가 수기로 확인합니다(T-19). 리드 이용료 자동 충전은 파트너가 등록한 카드로 결제합니다(정기 작업 lead_cash_auto · 30분마다 — 실패는 1시간 뒤 다시).</div>
      <h2 className="ad-s2">입금 확인 대기 · 선불 충전 잔액</h2>
      <CashWallets />
      <h3 className="sec">후불 미청구 · 한도 <small className="dim">선불 전환 전 발생분</small></h3>
      {rows.length === 0 && <p className="muted">이용료가 발생한 파트너가 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>파트너</th><th>등급</th><th>미청구</th><th>한도</th><th>무효</th><th>수신</th></tr></thead>
          <tbody>
            {rows.map((f) => {
              const over = Number(f.unpaid) >= Number(f.unpaidCap);
              return (
                <tr key={f.partnerId}>
                  <td>{f.company}</td><td>{f.grade}</td>
                  <td className="num-cell">{n(f.unpaid)}원</td>
                  <td className="num-cell">{n(f.unpaidCap)}원</td>
                  <td className="num-cell">{n(f.voided)}</td>
                  <td>{over ? <b className="warn-text">중지</b> : '정상'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

<h3 className="sec">등급별 확인비용 비율</h3>
      <table className="tbl">
        <thead><tr><th>등급</th><th>비율</th><th>붙는 조건</th></tr></thead>
        <tbody>
          {RATIO.map(([g, r, c]) => (
            <tr key={g}><td><b>{g}</b></td><td className="num-cell">{Math.round(r * 100)}%</td><td className="muted">{c}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="card warn">
        <b>파트너는 최고 확인비용 하나만 정하고, 나머지 7등급은 비율표가 채웁니다.</b> 어느 등급이 붙을지는
        알림톡 수신 결과가 정하는데, 알림톡 · SMS 연동 전이라 신뢰 판정이 항상 통과로 채워집니다(T-10).
        지금 등급은 신뢰할 수 없습니다.
      </p>
      <h3 className="sec">충전 보너스 비율 · 파트너 등급 기준</h3>
      <CashRules />
      <h3 className="sec">리드 이용료 세금계산서 발행 요청</h3>
      <CashInvoices />
      <h2 className="ad-s2">법률 · 세무 월 정액 노출 — 월 노출료 기준 금액</h2>
      <div className="ad-nt info">
        월 노출료 기준 금액(directory.monthly_fee)과 「입금 확인 → 노출 켜기」는 같은 API 를 쓰는 「법률·세무 정액 노출」 화면에 있습니다 — 두 곳에 두지 않습니다.
        {onGo && <> <button className="btn-plain btn-sm" onClick={() => onGo('directory')}>기준 금액 · 노출 켜기로</button></>}
      </div>
    </>
  );
}
