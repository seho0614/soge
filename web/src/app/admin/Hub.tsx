import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';

interface Gwan {
  code: string; name: string; description: string | null;
  isActive: boolean; sortOrder: number;
  publishedListings: number; categories: number; reviewPending: number;
}
interface HubRes { gwans: Gwan[] }

/**
 * SB-ADM-SIT-050 통합 허브
 *
 * (2026-10-02) 공유 경계(SB-ADM-SIT-060)는 관 관리 › 공유 경계로 옮겼습니다 —
 * 같은 표가 두 곳에 있으면 한쪽만 고쳐집니다.
 *
 * 관을 열기 전에 **응답할 공급이 있는지** 봅니다.
 * 업종이 0인 관을 열면 빈 목록만 보이고, 이용자는 서비스가
 * 고장 난 것으로 봅니다 — 서버가 그것을 막습니다.
 *
 * 공유 경계는 **한 관을 바꿨는데 다른 관이 함께 바뀌는 일**을 막습니다.
 */
export function Hub({ onGo }: { onGo?: (tab: string) => void }) {
  const hub = useApi<HubRes>('/admin/hub');

  if (hub.error) return <ErrorView error={hub.error} onRetry={hub.reload} />;

  const gwans = hub.data?.gwans ?? [];

  return (
    <section>
      {/* v10.31 (시안 scAdmHub) — 「허브가 하는 일 / 하지 않는 일」 두 카드 + 안내. 아래 관별 현황 표는 개발에만 */}
      <div className="ad-cards" data-hub-two>
        <div className="ad-panel"><h3>허브가 하는 일</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
            <li>관으로 보내는 카드 {gwans.filter((g) => g.isActive).length}장 (관이 늘면 자동으로 늘어남)</li>
            <li>통합 검색 — 여러 관을 한 번에</li><li>공통 프로모션 · 통계</li><li>비로그인 · 로그인 메인</li>
          </ul></div>
        <div className="ad-panel"><h3>허브가 하지 않는 일</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
            <li>관에 속한 목록 · 상세를 직접 갖지 않음 — 허브에는 매물이 등록되지 않습니다(서버가 막음)</li>
            <li>자체 업종 · 등급 없음</li><li>자체 소개비 정책 없음</li>
          </ul></div>
      </div>
      <div className="ad-nt info"><b>통합 메인은 관이 아닙니다 (C-10).</b> 루트 도메인은 어느 관에도 속하지 않습니다.</div>
      <h2 className="ad-s2">관별 현황 <em>{gwans.length}</em></h2>

      <table className="tbl">
        <thead>
          <tr>
            <th>관</th><th>노출</th><th>승인 업종</th>
            <th>노출 등록</th><th>검수 대기</th>
          </tr>
        </thead>
        <tbody>
          {gwans.map(g => (
            <tr key={g.code}>
              <td>
                <b>{g.name}</b>
                <span className="muted"> {g.code}</span>
              </td>
              <td>
                {g.isActive
                  ? <span className="badge badge-verified">노출</span>
                  : <span className="badge badge-urgent">숨김</span>}
              </td>
              <td className="num-cell">
                {g.categories === 0
                  ? <b className="form-error">0</b>
                  : g.categories}
              </td>
              <td className="num-cell">{g.publishedListings}</td>
              <td className="num-cell">
                {g.reviewPending > 0
                  ? <b className="form-error">{g.reviewPending}</b>
                  : 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="card warn">
        <b>승인 업종이 0인 관은 열 수 없습니다.</b> 열어도 빈 목록만 보이고
        이용자는 서비스가 고장 난 것으로 봅니다 — 서버가 막습니다.
      </p>

      <p className="card">
        <b>검수 대기가 쌓인 관을 숨기지 마십시오.</b> 숨겨도 큐는 남는데
        승인해도 보이지 않아 &ldquo;왜 안 올라오냐&rdquo;는 문의가 옵니다.
      </p>

      {onGo && (
        <p className="card">
          <b>공유 경계 · 영향 범위</b>는 관 관리 › 공유 경계에서 봅니다.{' '}
          <button className="linkbtn" onClick={() => onGo('gwans')}>관 관리로</button>
        </p>
      )}
    </section>
  );
}
