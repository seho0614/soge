import { useApi } from '../../lib/useApi';
import { n } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';

interface Res {
  roles: Array<{ role: string; description: string; count: number | string }>;
  conflict: Array<Record<string, unknown>>;
  note: string | null;
}

const GATES: Array<[string, string]> = [
  ['IDENTITY_VERIFIED', '본인인증 전에는 소개 · 계약을 막습니다 (INV-7)'],
  ['BIZ_VERIFIED', '사업자 인증 전에는 판매 등록을 막습니다'],
  ['BROKER_VERIFIED', '중개사 인증 전에는 부동산 중개를 막습니다 (A-07)'],
  ['SUBSCRIPTION', '구독 한도를 넘으면 막습니다'],
];

/**
 * SB-ADM-ACL-010 권한 계층
 *
 * 역할 8종과 가진 사람 수. **PAYOUT 과 ADMIN 은 함께 가질 수 없습니다** —
 * 승인하는 사람과 돈을 보내는 사람을 나눕니다(C710). 한 사람이 둘 다 하면 아무도 못 막습니다.
 */
export function Acl() {
  const r = useApi<Res>('/admin/acl');
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const d = r.data;

  return (
    <>
      <h2>권한 계층 <em>{d.roles.length}</em></h2>
      <table className="tbl">
        <thead><tr><th>역할</th><th>무엇을 할 수 있나</th><th>인원</th></tr></thead>
        <tbody>
          {d.roles.map((x) => (
            <tr key={x.role}>
              <td className="mono"><b>{x.role}</b></td>
              <td>{x.description}</td>
              <td className="num-cell">{x.role === 'GUEST' ? '—' : n(x.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`card ${d.conflict.length ? 'warn' : ''}`}>
        <b>PAYOUT 과 ADMIN 은 함께 가질 수 없습니다.</b> 승인하는 사람과 돈을 보내는 사람을 나눕니다 —
        한 사람이 둘 다 하면 아무도 못 막습니다(C710). 지금 겸직 <b>{d.conflict.length}명</b>입니다.
        {d.note && <> {d.note}</>}
      </p>

      <h3 className="sec">게이트</h3>
      <table className="tbl">
        <thead><tr><th>게이트</th><th>무엇을 막나</th></tr></thead>
        <tbody>{GATES.map(([g, t]) => <tr key={g}><td className="mono">{g}</td><td>{t}</td></tr>)}</tbody>
      </table>
      <p className="card"><b>역할은 &ldquo;누구인가&rdquo;, 게이트는 &ldquo;무엇을 마쳤나&rdquo;입니다.</b> ADMIN 이라도 본인인증을 안 하면 게이트에 막힙니다.</p>
    </>
  );
}
