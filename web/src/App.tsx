import { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken, takeHandoffCode, ApiFailure, MENU } from './lib';
import { Handoff } from './pages/Handoff';
import { Jobs } from './pages/Jobs';

interface Me { accountId: string; name: string | null; roles: string[]; super: boolean; perm: { decide: string; enforce: string; tasks: string[] } }

/* e1.4 (docs/004) ERP 화면 틀 — 넘겨받기 → 내 정보 → 메뉴(E3 ~ 에서 채움) · 로그인 없으면 운영 화면으로 안내 */
export function App() {
  const [code] = useState(() => takeHandoffCode(location.hash));
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState('home');
  const loadMe = useCallback(() => {
    if (!getToken()) { setErr('로그인이 필요합니다 — 소개뱅크 운영 화면 › 외부 연동 › ERP 연동 › 「ERP 열기」로 들어오십시오.'); return; }
    api<Me>('/me').then((m) => { setMe(m); setErr(null); })
      .catch((e) => { if (e instanceof ApiFailure && e.status === 401) setToken(null); setErr(e instanceof ApiFailure ? e.message : '내 정보를 불러오지 못했습니다.'); });
  }, []);
  useEffect(() => { if (!code) loadMe(); }, [code, loadMe]);

  if (code && !me && !err) return <Handoff code={code} onDone={loadMe} />;
  if (!me) return <main className="erp-center" data-erp-login="need"><h1>소개뱅크 ERP</h1><p className="warn-text">{err ?? '불러오는 중…'}</p></main>;
  return (
    <div className="erp-shell" data-erp-me={me.accountId}>
      <header className="erp-head">
        <b>소개뱅크 ERP</b>
        <span className="dim">{me.name ?? '운영자'} · {me.super ? 'SUPER' : me.roles.join(' · ')}</span>
        <button className="btn-plain" onClick={() => { setToken(null); setMe(null); setErr('로그아웃했습니다.'); }} data-erp-logout>로그아웃</button>
      </header>
      <nav className="erp-nav">
        <button className={tab === 'home' ? 'on' : ''} onClick={() => setTab('home')}>첫 화면</button>
        {MENU.map((m) => <button key={m.key} className={tab === m.key ? 'on' : ''} onClick={() => setTab(m.key)} data-erp-menu={m.key}>{m.label}</button>)}
      </nav>
      <main className="erp-main">
        {tab === 'home' && <section><h2>첫 화면</h2><p>ERP 분리 첫 단계(E1)입니다. 회계 · 세무는 E3, 인사 · 사무는 E4, 그룹웨어는 E4G 에서 이 메뉴로 옮겨 옵니다.</p>
          <p className="dim">권한 판정 {me.perm.decide} · 업무 권한 {me.perm.tasks.length}개</p></section>}
        {tab === 'jobs' && <Jobs isSuper={me.super} />}
        {tab !== 'home' && tab !== 'jobs' && <section data-erp-soon={tab}><h2>{MENU.find((m) => m.key === tab)?.label}</h2><p className="dim">준비 중 — {MENU.find((m) => m.key === tab)?.phase} 에서 옮겨 옵니다.</p></section>}
      </main>
    </div>
  );
}
