import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';

interface Res {
  kpis: { tables: number; views: number; routes: number; protectedRoutes: number; publicRoutes: number; roles: number;
          watchViews: number; systems: number; gwanVarRoutes: number; aclMode: string; payoutGate: string };
  systems: { code: string; gwan: string; subdomain: string; routes: number; protected: number; public: number; ops: number }[];
  checks: { code: string; label: string; n: number }[];
  note: string;
}
const SYS: Record<string, string> = { GWAN_VAR: '(관가변)' };

/**
 * SB-ADM-ITG-010 통합 현황 (v10.31 — 시안 integ 「테이블 · 라우트 · 권한 지표 카드 + 체계 7개 표 + 분리 점검」)
 *
 * 숫자는 손으로 적지 않습니다 — 서버가 지금 DB(information_schema)와 등록된 라우트(데코레이터 @Roles · @RequireGate)에서 셉니다.
 * 시안의 「ACL 모드 OBSERVE」는 개발과 다릅니다 — 개발은 데코레이터 방식(표시 없는 라우트는 공개 · check-acl 이 공개 구역 밖 무표시를 막음).
 */
export function Integ() {
  const r = useApi<Res>('/admin/integration-status');
  if (r.error) return <ErrorView error={r.error} onRetry={r.reload} />;
  if (!r.data) return <p className="muted">불러오는 중…</p>;
  const k = r.data.kpis;
  const bad = r.data.checks.filter((c) => c.n > 0).length;
  /* v10.32 — 시안 stat(): 칸 폭 150 이상 자동 채움(1280 에서 7 + 2) · 강조 칸 노랑(#fdf6e3) · 지급 게이트 닫힘 초록(#e9f7ef) / 열림 빨강 */
  const card = (t: string, v: string | number, s: string, cls = '') => (
    <div className={cls || undefined}><span>{t}</span><b>{typeof v === 'number' ? v.toLocaleString('ko-KR') : v}</b><small>{s}</small></div>
  );
  return (
    <>
      <div className="ad-stat" data-integ-kpis>
        {card('테이블', k.tables, `감시 뷰 포함 뷰 ${k.views}`)}
        {card('등록 라우트', k.routes, '서버에 등록된 실측')}
        {card('보호 라우트', k.protectedRoutes, `@Roles · @RequireGate — 공개 ${k.publicRoutes}`, 'hi')}
        {card('권한', k.roles, '쓰이는 역할 수')}
        {card('불변식 감시 뷰', k.watchViews, '위반 · 어긋남 · 누출 뷰')}
        {card('체계', k.systems, '관 별로 갈랐습니다', 'hi')}
        {card('관가변 라우트', k.gwanVarRoutes, 'gwan_code 가 체계를 정함', 'hi')}
        {card('ACL 방식', k.aclMode === 'DECORATOR' ? '데코레이터' : k.aclMode, '표시 없으면 공개 — 공개 구역 밖은 검정이 막음', 'hi')}
        {card('지급 게이트', k.payoutGate === 'OPEN' ? '열림' : '닫힘', '외부 송출 퍼블리셔 지급', k.payoutGate === 'OPEN' ? 'bad' : 'ok')}
      </div>
      {/* v10.32 — 시안: 위 띠 노랑 · 관은 데이터 띠 노랑 · 마지막 띠 파랑 */}
      <div className="ad-nt warn"><b>{r.data.note}</b></div>

      <h2 className="ad-s2">체계 {r.data.systems.length - 1}개 — 관 별로 갈랐습니다</h2>
      <div className="ad-tw"><table className="tbl" data-integ-systems>
        <thead><tr><th>체계</th><th>관</th><th>서브도메인</th><th className="num-cell">라우트</th><th className="num-cell">보호</th><th className="num-cell">공개</th><th className="num-cell">운영 전용</th></tr></thead>
        <tbody>{r.data.systems.map((x) => (
          <tr key={x.code}><td><b>{SYS[x.code] ?? x.code}</b></td><td>{x.gwan}</td><td className="mono">{x.subdomain}</td>
            <td className="num-cell">{x.routes}</td><td className="num-cell">{x.protected}</td><td className="num-cell">{x.public}</td><td className="num-cell">{x.ops}</td></tr>
        ))}</tbody>
      </table></div>
      <div className="ad-nt warn">
        <b>관은 주소가 아니라 데이터입니다.</b> POST /api/v1/listings 하나가 소개장터 · 안심소개 · 소개창업을 함께 섬깁니다 — 그래서 라우트마다 체계를 하나씩 박지 않고
        고정(한 체계) · 관가변(요청의 gwan_code 가 정함) · 공통으로 나눕니다.
      </div>

      <h2 className="ad-s2">분리 점검 — 전부 0 이어야 합니다 {bad > 0 && <span className="ad-bg no">위반 {bad}</span>}</h2>
      <div className="ad-tw"><table className="tbl" data-integ-checks>
        <thead><tr><th>점검</th><th className="num-cell">위반</th></tr></thead>
        <tbody>{r.data.checks.map((c) => (
          <tr key={c.code} className={c.n > 0 ? 'bad' : undefined}><td>{c.label}</td><td className="num-cell">{c.n > 0 ? <span className="ad-bg no">{c.n}건</span> : <span className="ad-bg ok">0</span>}</td></tr>
        ))}</tbody>
      </table></div>
      <div className="ad-nt info">
        <b>세 가지가 통합에서 정해졌습니다.</b> ① 관 분리 축은 주소가 아니라 데이터(gwan_code)입니다. ② INV-9 · INV-11 은 폐기가 아니라 범위 한정입니다 —
        소개비 보호는 그대로 두고 광고 · 판매만 면제했습니다. ③ 권한은 라우트마다 데코레이터로 붙이고, 공개 구역 밖의 무표시 라우트는 검정(check-acl)이 막습니다.
      </div>
    </>
  );
}
