import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, n, ymd } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';
import { SubTabs, type SubTab } from '../../../components/SubTabs';
import type { Gwan, Manage, STab } from './shared';

const STABS: SubTab<STab>[] = [
  { key: 'basic', label: '기본 정보', screen: 'SB-ADM-SIT-030' },
  { key: 'status', label: '공개 상태', screen: 'SB-ADM-SIT-030' },
  { key: 'order', label: '노출 순서', screen: 'SB-ADM-SIT-030' },
  { key: 'landing', label: '로그인 랜딩', screen: 'SB-ADM-SIT-030' },
  { key: 'stats', label: '현황', screen: 'SB-ADM-SIT-030' },
  { key: 'fixed', label: '고정 항목', screen: 'SB-ADM-SIT-030' },
  { key: 'category', label: '업종', screen: 'SB-ADM-SIT-030' },
  { key: 'open', label: '오픈 점검', screen: 'SB-ADM-SIT-030' },
];

export function GwanSettings({ code, created, onPick, onGo, initialTab }: {
  code: string | null; created: string | null; onPick: (c: string) => void; onGo?: (t: string) => void; initialTab?: STab }) {
  const manage = useApi<Manage[]>('/admin/gwans/manage');
  const [g, setG] = useState<Gwan | null>(null);
  const [gErr, setGErr] = useState<unknown>(null);
  const [tab, setTab] = useState<STab>(initialTab ?? 'basic');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [sort, setSort] = useState('');
  const [forNew, setForNew] = useState(false);
  const a = useAct();

  const cur = code ?? manage.data?.[0]?.code ?? null;
  const load = () => {
    if (!cur) return;
    setGErr(null);
    api<Gwan>(`/admin/gwans/${cur}`).then((d) => {
      setG(d); setName(d.name); setDesc(d.description ?? ''); setSort(String(d.sortOrder));
    }).catch(setGErr);
  };
  useEffect(load, [cur]);

  if (manage.error) return <ErrorView error={manage.error} onRetry={manage.reload} />;
  if (gErr) return <ErrorView error={gErr} onRetry={load} />;
  if (!manage.data || !g) return <p className="muted">불러오는 중…</p>;

  const m = manage.data.find((x) => x.code === g.code);
  const after = () => { load(); manage.reload(); };
  const patch = (body: Record<string, unknown>, ok: string) =>
    a.run('patch', () => api(`/admin/gwans/${g.code}`, { method: 'PATCH', body: JSON.stringify(body) }), after, ok);

  function saveOrder() {
    const v = Number(sort);
    if (!Number.isInteger(v) || v < 0) { a.setErr('순서는 0 이상의 정수입니다.'); return; }
    const items = manage.data!.map((x) => ({ code: x.code, sortOrder: x.code === g!.code ? v : x.sortOrder }));
    void a.run('order', () => api('/admin/gwans/order', { method: 'PATCH', body: JSON.stringify({ items }) }),
      after, '순서를 저장했습니다.');
  }
  function setLanding(on: boolean) {
    void a.run('landing', () => api('/admin/gwans/landing', {
      method: 'PATCH', body: JSON.stringify({ gwanCode: on ? g!.code : null, forNewMember: forNew }),
    }), after, on ? `${g!.name}을(를) 로그인 후 랜딩으로 지정했습니다.` : '랜딩을 메인으로 돌렸습니다.');
  }

  const checks: Array<[string, boolean, string]> = [
    ['업종 1종 이상 승인', g.categories > 0, `${g.categories}종 승인됨`],
    ['설명 입력', !!g.description, g.description ? '입력됨' : '비어 있음 — 메인 카드가 빕니다'],
    ['검수 대기 없음', g.reviewPending === 0, `대기 ${g.reviewPending}건`],
    ['공개 상태', g.isActive, g.isActive ? '운영중' : '준비중'],
  ];

  return (
    <>
      <div className="search-row" style={{ alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{g.name} <span className="muted">{g.code}</span> · 관 설정</h2>
        <select className="sel" style={{ marginBottom: 0, marginLeft: 'auto' }} value={g.code}
                aria-label="관 선택" onChange={(e) => { a.clear(); onPick(e.target.value); }}>
          {manage.data.map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}
        </select>
      </div>
      <p className="lead">코드와 소개 대상은 생성 후 바꿀 수 없습니다. 나머지는 배포 없이 즉시 반영됩니다.</p>
      <SubTabs tabs={STABS} value={tab} onChange={(t) => { a.clear(); setTab(t); }} />
      {created === g.code && !a.msg && !a.err && (
        <p className="form-ok">새 관 {g.name}({g.code})을(를) 만들었습니다. 준비중(비활성)입니다 — 업종을 붙인 뒤 &lsquo;공개 상태&rsquo;에서 여십시오.</p>
      )}
      <Flash msg={a.msg} err={a.err} />

      {tab === 'basic' && (
        <>
        {/* v10.31 — 시안 「항목 · 값 · 변경」 표 + 「저장 · 관 중지」 */}
        <div className="ad-tw"><table className="tbl" data-gwan-props>
          <thead><tr><th>항목</th><th>값</th><th>변경</th></tr></thead>
          <tbody>
            <tr><td><b>코드</b></td><td className="mono">{g.code}</td><td className="dim">생성 후 변경 불가</td></tr>
            <tr><td><b>서브도메인</b></td><td className="mono">{g.code.toLowerCase()}.sogaebank.com</td><td className="dim">변경 시 리다이렉트 필요</td></tr>
            <tr><td><b>인증 게이트</b></td><td>등록 · 1:1 문의 시작 시 (서버 게이트)</td><td className="dim">즉시 반영</td></tr>
            <tr><td><b>공개 상태</b></td><td>{g.isActive ? '운영중' : '준비중'}</td><td className="dim">즉시 반영 — 「공개 상태」 탭</td></tr>
          </tbody>
        </table></div>
        <div className="ad-nt info"><b>서브도메인을 바꾸면 기존 주소에서 리다이렉트를 걸어야 합니다.</b> 검색엔진에 색인된 주소가 끊깁니다.</div>
        <div className="card pad">
          <div className="form-grid">
            <label><span>관 이름</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span>설명</span><input value={desc} onChange={(e) => setDesc(e.target.value)} />
            </label>
          </div>
          <div className="acts">
            <button className="btn-ok" disabled={a.busy === 'patch' || name.trim().length < 2}
                    onClick={() => void patch({ name: name.trim(), description: desc.trim() }, '저장했습니다. 바로 반영됩니다.')}>
              저장
            </button>
            {g.isActive && <button className="btn-no" disabled={a.busy === 'patch'} onClick={() => {
              if (!confirm(`${g.name}을(를) 중지합니다.\n신규만 막히고 진행 중 거래는 끝까지 갑니다.`)) return;
              void patch({ isActive: false }, '관을 중지했습니다.');
            }}>관 중지</button>}
          </div>
        </div>
        </>
      )}

      {tab === 'status' && (
        <div className="card pad">
          <p>지금 <b>{g.isActive ? '운영중(노출)' : '준비중(숨김)'}</b> · 승인 업종 {g.categories}종</p>
          <div className="acts">
            <button className={g.isActive ? 'btn-no' : 'btn-ok'} disabled={a.busy === 'patch'}
                    onClick={() => {
                      if (g.isActive && !confirm(`${g.name}을(를) 중지합니다.\n신규만 막히고 진행 중 거래는 끝까지 갑니다.`)) return;
                      void patch({ isActive: !g.isActive }, g.isActive ? '관을 중지했습니다.' : '관을 열었습니다.');
                    }}>
              {g.isActive ? '관 중지' : '관 열기'}
            </button>
          </div>
          <p className="hint">
            <b>승인된 업종이 없으면 열 수 없습니다</b> — 등록 폼의 선택지가 비어 사용자가 막힙니다(서버가 422 로 거절).
            중지하면 등록 · 노출이 즉시 멈추지만 매물은 지우지 않습니다.
          </p>
        </div>
      )}

      {tab === 'order' && (
        <div className="card pad">
          <div className="form-grid">
            <label><span>노출 순서 (작을수록 앞)</span>
              <input type="number" min={0} value={sort} onChange={(e) => setSort(e.target.value)} />
            </label>
          </div>
          <div className="acts">
            <button className="btn-ok" disabled={a.busy === 'order'} onClick={saveOrder}>순서 저장</button>
          </div>
          <p className="hint">다른 관의 순서는 그대로 두고 함께 보냅니다 — 서버는 한 번에 전체를 받습니다.</p>
        </div>
      )}

      {tab === 'landing' && (
        <div className="card pad">
          <p>{m?.isLanding ? <b>이 관이 로그인 후 랜딩입니다.</b> : '이 관은 랜딩이 아닙니다.'}
            {m?.isNewMemberLanding && <> <b>신규 가입자 첫 화면으로도 지정돼 있습니다.</b></>}</p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={forNew} onChange={(e) => setForNew(e.target.checked)} /> 신규 가입자 첫 화면으로 지정 (끄면 기존 회원 로그인 후)
          </label>
          <div className="acts">
            <button className="btn-ok" disabled={!g.isActive || a.busy === 'landing'} onClick={() => setLanding(true)}>
              이 관을 랜딩으로
            </button>
            {(forNew ? m?.isNewMemberLanding : m?.isLanding) && (
              <button className="btn-plain" disabled={a.busy === 'landing'} onClick={() => setLanding(false)}>
                메인으로 되돌리기
              </button>
            )}
          </div>
          {!g.isActive && <p className="hint"><b>중지된 관은 랜딩으로 지정할 수 없습니다.</b></p>}
        </div>
      )}

      {tab === 'stats' && (
        <table className="tbl">
          <tbody>
            <tr><th>노출 중인 등록</th><td className="num-cell">{n(g.publishedListings)}</td></tr>
            <tr><th>승인 업종</th><td className="num-cell">{n(g.categories)}</td></tr>
            <tr><th>검수 대기</th><td className="num-cell">{g.reviewPending > 0 ? <b className="warn-text">{n(g.reviewPending)}</b> : 0}</td></tr>
            <tr><th>연 날</th><td>{ymd(g.openedAt)}</td></tr>
            <tr><th>순서</th><td className="num-cell">{g.sortOrder}</td></tr>
          </tbody>
        </table>
      )}

      {tab === 'fixed' && (
        <>
          <table className="tbl">
            <thead><tr><th>항목</th><th>값</th><th>변경</th></tr></thead>
            <tbody>
              <tr><td><b>코드</b></td><td className="mono">{g.code}</td><td><span className="badge badge-urgent">생성 후 변경 불가</span></td></tr>
              <tr><td><b>소개 대상</b></td><td>{/^\[(.+?)\]/.exec(g.description ?? '')?.[1] ?? '설명 참조'}</td><td><span className="badge badge-urgent">생성 후 변경 불가</span></td></tr>
              <tr><td><b>상위 관</b></td><td>{m?.isHub ? '예' : '아니오'}</td><td><span className="badge badge-urgent">DB 고정 — 상위는 하나</span></td></tr>
            </tbody>
          </table>
          <p className="hint">
            코드가 바뀌면 소개코드 · 정산 기록이 가리키는 곳이 사라집니다. 소개 대상이 바뀌면 요율과 게이트가 달라집니다.
          </p>
        </>
      )}

      {tab === 'category' && (
        <div className="card pad">
          <p>승인된 업종 <b>{g.categories}</b>종 {g.categories === 0 && <b className="warn-text">— 이 상태로는 열 수 없습니다</b>}</p>
          {onGo && <button className="btn-plain" onClick={() => onGo('category')}>업종 승인 화면으로</button>}
          <p className="hint">카테고리가 등급을 결정합니다 (A-11). 업종은 관에 종속되고 관마다 다릅니다.</p>
        </div>
      )}

      {tab === 'open' && (
        <>
          <table className="tbl">
            <thead><tr><th>점검</th><th>결과</th><th>내용</th></tr></thead>
            <tbody>
              {checks.map(([t, ok, d]) => (
                <tr key={t}>
                  <td><b>{t}</b></td>
                  <td>{ok ? <span className="st ok">통과</span> : <span className="st no">미통과</span>}</td>
                  <td className="muted">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {onGo && <div className="acts"><button className="btn-plain" onClick={() => onGo('checklist')}>전체 오픈 체크리스트</button></div>}
        </>
      )}

      <p className="card warn">
        <b>관을 중지해도 등록은 지워지지 않습니다.</b> 목록에서만 빠지며 다시 열면 그대로 돌아옵니다.
      </p>
    </>
  );
}
