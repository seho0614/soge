import { useApi } from '../../../lib/useApi';
import { ErrorView } from '../../../components/ErrorView';
import type { Gwan } from './shared';

interface Scope { key: string; description: string | null; scope: string; affects: string }

/* ── SB-ADM-SIT-060 공유 경계 · 영향 범위 ────────────────────────── */
const COMMON: Array<[string, boolean, string]> = [
  ['회원 · 사업자 인증', true, '가입은 한 번, 전 관 공통'],
  ['소개코드 · 귀속', true, '코드 체계가 갈리면 정산이 깨집니다'],
  ['정산 · 지급', true, '계좌와 세금계산서는 회원 단위'],
  ['구독', true, '요금제는 계정 단위 (B-13R)'],
  ['업종 · 등급', false, '관에 종속됩니다'],
  ['소개비 부담 주체', false, '관마다 하나로 고정'],
];

export function GwanScope() {
  const gwans = useApi<Gwan[]>('/admin/gwans');
  const scope = useApi<Scope[]>('/admin/scope');

  if (scope.error) return <ErrorView error={scope.error} onRetry={scope.reload} />;
  if (!scope.data || !gwans.data) return <p className="muted">불러오는 중…</p>;

  const rows = scope.data;
  const global = rows.filter((r) => r.scope === 'GLOBAL');
  const perGwan = rows.filter((r) => r.scope !== 'GLOBAL');

  return (
    <>
      <h2>공유 경계 · 영향 범위</h2>
      <p className="lead">관을 나눠도 나누지 않는 것들입니다. 이 경계가 흔들리면 정산이 깨집니다.</p>

      <table className="tbl">
        <thead><tr><th>항목</th><th>경계</th><th>이유</th></tr></thead>
        <tbody>
          {COMMON.map(([t, one, why]) => (
            <tr key={t}>
              <td><b>{t}</b></td>
              <td>{one ? <span className="badge badge-verified">관을 나눠도 하나</span>
                       : <span className="badge badge-urgent">관마다 다름</span>}</td>
              <td className="muted">{why}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="card warn">
        <b>전 관 공통 설정을 바꾸면 모든 관({gwans.data.length}개)이 함께 바뀝니다.</b> 한 관만 바꾸려던 것이
        전체에 퍼지는 일이 여기서 생깁니다.
      </p>

      <h3 className="sec">모든 관에 적용 <em>{global.length}</em></h3>
      <table className="tbl">
        <thead><tr><th>설정</th><th>설명</th><th>영향</th></tr></thead>
        <tbody>
          {global.map((r) => (
            <tr key={r.key}>
              <td><span className="mono">{r.key}</span></td>
              <td className="muted">{r.description}</td>
              <td><b className="warn-text">{r.affects}</b></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="sec">관별 적용 <em>{perGwan.length}</em></h3>
      {perGwan.length === 0
        ? <p className="muted">관별로만 적용되는 설정이 없습니다.</p>
        : (
          <table className="tbl">
            <thead><tr><th>설정</th><th>설명</th><th>범위</th></tr></thead>
            <tbody>
              {perGwan.map((r) => (
                <tr key={r.key}>
                  <td><span className="mono">{r.key}</span></td>
                  <td className="muted">{r.description}</td>
                  <td>{r.affects}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <p className="card">
        <b>금칙어는 같은 표인데 행마다 범위가 다릅니다.</b> 관 코드가 비어 있으면 전 관 공통이고,
        값이 있으면 그 관에만 적용됩니다. 정책 화면에서 관 열을 확인하십시오.
      </p>
    </>
  );
}
