import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';
import type { Gwan, Manage, STab } from './shared';

/* ── SB-ADM-SIT-010 · GWN-010 관 목록 ────────────────────────────── */
export function GwanList({ isSuper, onOpen, onGo, onNew }: {
  isSuper: boolean; onOpen: (c: string, t?: STab) => void; onGo?: (t: string) => void; onNew: () => void;
}) {
  const manage = useApi<Manage[]>('/admin/gwans/manage');
  const [stats, setStats] = useState<Gwan[] | null>(null);
  const [order, setOrder] = useState<Record<string, string>>({});
  const [landing, setLanding] = useState<string>('');
  const [forNew, setForNew] = useState(false);
  const a = useAct();

  /* 현황(노출 등록 · 검수 대기)은 SUPER 만 부를 수 있습니다 */
  useEffect(() => {
    if (!isSuper) return;
    api<Gwan[]>('/admin/gwans').then(setStats).catch(() => setStats([]));
  }, [isSuper]);
  /* v10.36 — 「신규 가입자 첫 화면」을 켜면 그 설정의 지금 값을 보여 줍니다(전에는 늘 기존 회원 값만 보여 저장이 안 된 것처럼 보였습니다) */
  useEffect(() => {
    setLanding(manage.data?.find((g) => (forNew ? g.isNewMemberLanding : g.isLanding))?.code ?? '');
  }, [manage.data, forNew]);

  if (manage.error) return <ErrorView error={manage.error} onRetry={manage.reload} />;
  if (!manage.data) return <p className="muted">불러오는 중…</p>;

  const rows = [...manage.data].sort((x, y) => x.sortOrder - y.sortOrder);
  const byCode = new Map((stats ?? []).map((g) => [g.code, g]));
  const dirty = Object.keys(order).length > 0;

  function saveOrder() {
    const items = rows.map((g) => ({ code: g.code, sortOrder: Number(order[g.code] ?? g.sortOrder) }));
    if (items.some((i) => !Number.isInteger(i.sortOrder) || i.sortOrder < 0)) {
      a.setErr('순서는 0 이상의 정수로 적어 주십시오.'); return;
    }
    // 한 번에 전체를 보냅니다 — 하나씩 바꾸면 중간에 순서가 겹칩니다
    void a.run('order', () => api('/admin/gwans/order', { method: 'PATCH', body: JSON.stringify({ items }) }),
      () => { setOrder({}); manage.reload(); }, '순서를 저장했습니다. 메뉴와 목록 순서가 함께 바뀝니다.');
  }
  function saveLanding() {
    void a.run('landing', () => api('/admin/gwans/landing', {
      method: 'PATCH', body: JSON.stringify({ gwanCode: landing || null, forNewMember: forNew }),
    }), manage.reload, landing ? '로그인 후 랜딩을 바꿨습니다.' : '로그인 후 메인으로 보냅니다.');
  }

  /* v10.31 — 시안 ↑ ↓ 단추: 순서를 한 칸씩 옮겨 초안에 넣고, 「순서 저장」이 한 번에 보냅니다 */
  const ord = (g: Manage) => Number(order[g.code] ?? g.sortOrder);
  const sorted = [...rows].sort((x, y) => ord(x) - ord(y));
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= sorted.length) return;
    const nx = [...sorted]; const t = nx[i]!; nx[i] = nx[j]!; nx[j] = t;
    setOrder(Object.fromEntries(nx.map((g, k) => [g.code, String(k)])));
  };
  const sub = (c: string) => `${c.toLowerCase()}.sogaebank.com`;

  return (
    <>
      {isSuper && <div className="ad-dact" style={{ marginTop: 0 }}><button className="btn-ok" onClick={onNew}>새 관 만들기</button></div>}
      <Flash msg={a.msg} err={a.err} />

      <div className="ad-tw"><table className="tbl" data-gwan-list>
        <thead>
          <tr>
            <th>관</th><th>코드 · 서브도메인</th><th>상태</th><th>업종</th><th>등록 건수</th>
            {isSuper && <th>오픈일</th>}{isSuper && <th>검수 대기</th>}<th>랜딩</th><th>순서</th>{isSuper && <th />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((g, i) => {
            const st = byCode.get(g.code);
            return (
              <tr key={g.code}>
                <td><b>{g.name}</b>{g.isHub && <span className="ad-bg pp" style={{ marginLeft: 6 }}>상위</span>}</td>
                <td className="mono">{g.code}{!g.isHub && <> · {sub(g.code)}</>}</td>
                <td>{g.isActive
                  ? <span className="ad-bg ok">운영중</span>
                  : <span className="ad-bg wait">{g.categories === 0 ? '준비중' : '숨김'}</span>}</td>
                <td className="num-cell">{g.categories === 0 ? <b className="warn-text">0종</b> : `${g.categories}종`}</td>
                <td className="num-cell">{(st?.publishedListings ?? g.listings).toLocaleString('ko-KR')}</td>
                {isSuper && <td>{st?.openedAt ? new Date(st.openedAt).toLocaleDateString('ko-KR') : '—'}</td>}
                {isSuper && <td className="num-cell">{(st?.reviewPending ?? 0) > 0 ? <b className="warn-text">{st?.reviewPending}</b> : 0}</td>}
                <td>{g.isLanding || g.isNewMemberLanding
                  ? <>{g.isLanding && <b>랜딩</b>}{g.isLanding && g.isNewMemberLanding && ' · '}{g.isNewMemberLanding && <b>신규 가입자</b>}</>
                  : <span className="muted">—</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${g.name} 위로`}>↑</button>{' '}
                  <button className="btn-sm" disabled={i === sorted.length - 1} onClick={() => move(i, 1)} aria-label={`${g.name} 아래로`}>↓</button>{' '}
                  <input className="inp-sm" type="number" min={0} aria-label={`${g.name} 순서`} style={{ width: 56 }}
                         value={order[g.code] ?? String(g.sortOrder)}
                         onChange={(e) => setOrder((p) => ({ ...p, [g.code]: e.target.value }))} />
                </td>
                {isSuper && (
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-sm" onClick={() => onOpen(g.code)}>설정</button>
                    {!g.isActive && <> <button className="btn-sm" onClick={() => onOpen(g.code, 'open')} data-gwan-check={g.code}>오픈 점검</button></>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table></div>

      <div className="acts">
        <button className="btn-ok" disabled={!dirty || a.busy === 'order'} onClick={saveOrder}>순서 저장</button>
        {dirty && <button className="btn-plain" onClick={() => setOrder({})}>되돌리기</button>}
        {isSuper && onGo && (
          <button className="btn-plain" onClick={() => onGo('mainops/gwan')}>노출 전환 — 메인 운영 › 관 노출</button>
        )}
      </div>
      <p className="hint">순서는 <b>한 번에 전체를 보냅니다.</b> 하나씩 바꾸면 중간에 순서가 겹쳐 표시가 들쭉날쭉해집니다.</p>

      <h3 className="ad-s2">로그인 후 첫 화면</h3>
      <div className="card pad">
        <div className="form-grid">
          <label>
            <span>도착할 화면</span>
            <select value={landing} onChange={(e) => setLanding(e.target.value)} aria-label="로그인 후 랜딩">
              <option value="">통합 메인 (기본)</option>
              {rows.filter((g) => g.isActive && !g.isHub).map((g) => (
                <option key={g.code} value={g.code}>{g.name} 메인</option>
              ))}
            </select>
          </label>
          <label className="chk" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={forNew} onChange={(e) => setForNew(e.target.checked)} />
            <span>신규 가입자 첫 화면으로 지정 (끄면 기존 회원 로그인 후)</span>
          </label>
        </div>
        <div className="acts">
          <button className="btn-ok" disabled={a.busy === 'landing'} onClick={saveLanding}>저장</button>
        </div>
        <p className="hint">
          <b>중지된 관은 지정할 수 없습니다</b> — 로그인하자마자 &ldquo;중지 상태&rdquo; 화면을 보게 됩니다.
          신규 가입자 첫 화면은 <b>가입 완료 화면의 「시작하기」</b>가 그 관 메인으로 보냅니다(v10.37).
          그래서 목록에는 노출 중인 관만 나옵니다.
        </p>
      </div>

      <p className="card">
        <b>검수 대기가 쌓인 관을 숨기지 마십시오.</b> 숨겨도 검수 큐는 그대로 남는데,
        승인해도 이용자에게 보이지 않아 &ldquo;왜 안 올라오냐&rdquo;는 문의가 옵니다.
      </p>
      <p className="card">
        <b>승인된 업종이 없는 관은 열 수 없습니다.</b> 서버가 막습니다 — 열어도 빈 목록만
        보이고, 이용자는 서비스가 고장 난 것으로 봅니다.
      </p>
      <div className="ad-nt info">
        <b>관 URL은 관마다 서브도메인입니다 (C-10).</b> 루트 도메인은 어느 관에도 속하지 않는 통합 메인입니다. 로그인 세션은 상위 도메인 쿠키로 관을 넘나듭니다.
      </div>
      {/* v10.31 — 시안 아래 바로가기 4장 */}
      {onGo && (
        <div className="ad-mgrid" data-sit-links>
          {isSuper && <button className="ad-mcard" onClick={() => onGo('hub')}><b>통합 메인 관리</b><span>관으로 보내는 허브. 관이 늘면 카드가 자동으로 늘어납니다.</span></button>}
          {isSuper && <button className="ad-mcard" onClick={() => onGo('gwans/scope')}><b>관 공통 경계</b><span>관을 나눠도 나누지 않는 것들. 흔들리면 정산이 깨집니다.</span></button>}
          {isSuper && <button className="ad-mcard" onClick={() => onGo('siteinfo')}><b>사이트 기본 정보 · 법정 고지</b><span>푸터 고지의 원본. 비면 화면에 TBD 로 나갑니다.</span></button>}
          <button className="ad-mcard" onClick={() => onGo('gwan-ux')}><b>관 UI/UX 관리</b><span>관마다 다른 축과 UI 유형. 안심소개 3축 · 소개창업 4축을 켜고 끕니다.</span></button>
        </div>
      )}
    </>
  );
}
