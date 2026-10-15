import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';
import { FinanceCosts } from './FinanceCosts';

interface Daily {
  day: string; signups: number; bizVerified: number;
  requests: number; listings: number; deals: number; revenue: string;
}
interface Signal { signal: string; value: number; meaning: string }
interface NotAgreed {
  accounts: number; items: number; note: string;
  byTerm: Array<{ code: string; title: string; accounts: number }>;
}
interface Pending {
  code: string; title: string; dependsOn: string; risk: string; note: string;
}
interface Revenue {
  thisMonth: string; lastMonth: string; paidCount: number; note: string;
  plans: Array<{ code: string; name: string; monthlyFee: string; active: number }>;
}

/**
 * SB-ADM-DSH-010 하위 — 경영 지표
 *
 * 운영이 매일 보는 숫자입니다. SQL 을 짜야 알 수 있으면 아무도 안 봅니다.
 *
 * 어긋남 신호가 위에 옵니다 — **시스템은 정상인데 사업이 새는 형태**라
 * 오류로는 안 잡히고 숫자로만 보입니다.
 */
export function Reports() {
  const daily = useApi<Daily[]>('/admin/reports/daily');
  const signals = useApi<Signal[]>('/admin/reports/signals');
  const rev = useApi<Revenue>('/admin/reports/revenue');
  const pend = useApi<Pending[]>('/admin/reports/pending');
  const na = useApi<NotAgreed>('/admin/reports/not-agreed');

  if (daily.error) return <ErrorView error={daily.error} onRetry={daily.reload} />;

  const sig = (signals.data ?? []).filter(s => s.value > 0);
  const rows = daily.data ?? [];
  const thisM = Number(rev.data?.thisMonth ?? 0);
  const lastM = Number(rev.data?.lastMonth ?? 0);
  const diff = lastM > 0 ? Math.round(((thisM - lastM) / lastM) * 100) : null;

  return (
    <section>
      <h2>어긋남 신호 <em>{sig.length}</em></h2>

      {sig.length === 0 ? (
        <p className="form-ok">신호 없음 — 지금은 새는 곳이 보이지 않습니다.</p>
      ) : (
        <table className="tbl">
          <thead><tr><th>신호</th><th>건수</th><th>무슨 뜻인가</th></tr></thead>
          <tbody>
            {sig.map(s => (
              <tr key={s.signal}>
                <td><b>{s.signal}</b></td>
                <td className="num-cell"><b className="form-error">{s.value}</b></td>
                <td className="muted">{s.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="card">
        <b>여기 뜨는 것은 오류가 아닙니다.</b> 시스템은 정상인데 사업이 새는
        형태라 로그로는 안 잡힙니다 — 숫자로만 보입니다.
      </p>

      {(na.data?.accounts ?? 0) > 0 && (
        <>
          <h2>약관 미동의 <em>{na.data?.accounts}명</em></h2>
          <p className="card warn">
            <b>{na.data?.note}</b> 동의 없이 서비스를 쓰는 사람이 쌓이면,
            분쟁이 생겼을 때 &ldquo;무엇에 동의했는가&rdquo;를 답할 수 없습니다.
          </p>
          <table className="tbl">
            <thead><tr><th>약관</th><th>미동의</th></tr></thead>
            <tbody>
              {(na.data?.byTerm ?? []).map(t => (
                <tr key={t.code}>
                  <td>{t.title}</td>
                  <td className="num-cell"><b className="form-error">{t.accounts}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>결정 대기 <em>{(pend.data ?? []).length}</em></h2>

      <p className="card warn">
        <b>여기 있는 것 위에 무언가를 쌓지 마십시오.</b> 오픈을 막지는 않지만,
        회신 결과에 따라 <b>작업이 통째로 버려질 수 있습니다.</b>
      </p>

      <table className="tbl">
        <thead><tr><th>위험</th><th>항목</th><th>무엇에 걸려 있나</th><th>내용</th></tr></thead>
        <tbody>
          {(pend.data ?? []).map(d => (
            <tr key={d.code}>
              <td>
                <span className={`badge ${d.risk === 'HIGH' ? 'badge-urgent' : 'verified'}`}>
                  {d.risk}
                </span>
              </td>
              <td><b>{d.title}</b></td>
              <td className="muted">{d.dependsOn}</td>
              <td className="muted">{d.note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>매출</h2>
      <div className="grid">
        <div className="card">
          <span className="muted">이번 달</span>
          <b className="money">{thisM.toLocaleString()}원</b>
          {diff !== null && (
            <span className={diff < 0 ? 'form-error' : 'muted'}>
              지난달 대비 {diff > 0 ? '+' : ''}{diff}%
            </span>
          )}
        </div>
        <div className="card">
          <span className="muted">지난 달</span>
          <b className="money">{lastM.toLocaleString()}원</b>
        </div>
        <div className="card">
          <span className="muted">결제 건수</span>
          <b>{rev.data?.paidCount ?? 0}건</b>
        </div>
      </div>

      <table className="tbl">
        <thead><tr><th>요금제</th><th>월 회비</th><th>활성 구독</th></tr></thead>
        <tbody>
          {(rev.data?.plans ?? []).map(p => (
            <tr key={p.code}>
              <td><b>{p.name}</b></td>
              <td className="num-cell">{Number(p.monthlyFee).toLocaleString()}원</td>
              <td className="num-cell">{p.active}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="card">
        <b>{rev.data?.note}</b>
      </p>

      {/* v10.31 — 대시보드 「활주로」의 비용 입력 칸(운영 설정) */}
      <div id="finance-costs"><FinanceCosts /></div>

      <h2>최근 30일</h2>
      <table className="tbl">
        <thead>
          <tr>
            <th>날짜</th><th>가입</th><th>사업자 인증</th>
            <th>요청</th><th>등록</th><th>거래</th><th>매출</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(d => (
            <tr key={d.day}>
              <td className="muted">
                {new Date(d.day).toLocaleDateString('ko-KR',
                  { month: 'numeric', day: 'numeric' })}
              </td>
              <td className="num-cell">{d.signups}</td>
              <td className="num-cell">{d.bizVerified}</td>
              <td className="num-cell">{d.requests}</td>
              <td className="num-cell">{d.listings}</td>
              <td className="num-cell">{d.deals}</td>
              <td className="num-cell">{Number(d.revenue).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="card warn">
        <b>0으로 떨어진 날이 있으면 그날 무언가 멈춘 것입니다.</b> 특히 매출이
        0인 날이 이어지면 <code>subscription_billing</code> 배치를 먼저 보십시오.
      </p>
    </section>
  );
}
