import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, n, ymd } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';
import { SubTabs, type SubTab } from '../../../components/SubTabs';
import { categoryCheck, type Gwan, type Manage, type STab } from './shared';

/* v10.646 (D309 · docs/791) 등록 폼 문구 — 소개합니다(OFFER) · 찾습니다(REQUEST). 하나도 없으면 관을 열 수 없음(NO_FORM_COPY) */
interface FormCopy { role: string; subject: string; titleHint: string; bodyHint: string; notice: string | null }
const ROLES = [['OFFER', '소개합니다(파는 쪽 · 매물 등록)'], ['REQUEST', '찾습니다(구하는 쪽 · 소개받기 요청)']] as const;
function FormCopyTab({ code }: { code: string }) {
  const fc = useApi<FormCopy[]>(`/admin/gwans/${code}/form-copy`);
  const [ed, setEd] = useState<Record<string, FormCopy>>({});
  const a = useAct();
  useEffect(() => {
    const m: Record<string, FormCopy> = {};
    for (const [r] of ROLES) m[r] = fc.data?.find((x) => x.role === r) ?? { role: r, subject: '', titleHint: '', bodyHint: '', notice: '' };
    setEd(m);
  }, [fc.data]);
  if (fc.error) return <ErrorView error={fc.error} onRetry={fc.reload} />;
  if (!fc.data) return <p className="muted">불러오는 중…</p>;
  const set = (r: string, k: keyof FormCopy, v: string) => setEd({ ...ed, [r]: { ...ed[r]!, [k]: v } });
  return (
    <>
      <p className="lead">사용자 웹 등록 폼의 머리 · 칸 안내입니다. <b>둘 중 하나 이상 있어야 관을 열 수 있습니다.</b> 영어 등 번역은 관 관리 › 번역 검수에서 합니다.</p>
      <Flash msg={a.msg} err={a.err} />
      {ROLES.map(([r, label]) => {
        const v = ed[r]; if (!v) return null;
        const saved = fc.data!.some((x) => x.role === r);
        const ok = v.subject.trim() && v.titleHint.trim() && v.bodyHint.trim();
        return (
          <div key={r} className="card pad" data-gwan-form={r}>
            <h3 style={{ marginTop: 0 }}>{label} <span className="dim">{saved ? '· 저장됨' : '· 아직 없음'}</span></h3>
            <div className="form-grid">
              <label><span>무엇을 등록하나(폼 머리 · 40자)</span><input value={v.subject} maxLength={40} placeholder="예) 배움 · 강의" onChange={(e) => set(r, 'subject', e.target.value)} /></label>
              <label><span>제목 칸 안내(200자)</span><input value={v.titleHint} maxLength={200} placeholder="예) 무엇을 가르치는지 한 줄로" onChange={(e) => set(r, 'titleHint', e.target.value)} /></label>
              <label style={{ gridColumn: '1 / -1' }}><span>본문 칸 안내(1,000자)</span><textarea rows={3} value={v.bodyHint} maxLength={1000} placeholder="예) 대상 · 기간 · 장소 · 비용을 적어 주세요" onChange={(e) => set(r, 'bodyHint', e.target.value)} /></label>
              <label style={{ gridColumn: '1 / -1' }}><span>주의 한 줄(선택 · 500자)</span><input value={v.notice ?? ''} maxLength={500} onChange={(e) => set(r, 'notice', e.target.value)} /></label>
            </div>
            <div className="acts">
              <button className="btn-ok" disabled={!ok || a.busy === `fc${r}`} data-gwan-form-save={r}
                      onClick={() => void a.run(`fc${r}`, () => api(`/admin/gwans/${code}/form-copy/${r}`, { method: 'PUT',
                        body: JSON.stringify({ subject: v.subject.trim(), titleHint: v.titleHint.trim(), bodyHint: v.bodyHint.trim(), notice: (v.notice ?? '').trim() || undefined }) }),
                        fc.reload, '저장했습니다. 사용자 웹 등록 폼에 바로 반영됩니다.')}>저장</button>
            </div>
          </div>
        );
      })}
    </>
  );
}

/* v10.647 (docs/792) 처음 관의 사용자 웹 주소(site/src/lib/format.ts FIXED_GWAN_PATH 와 같게) — 나머지 관은 g/<코드 소문자> */
const GWAN_WEB_PATH: Record<string, string> = { MNY: 'money', MAL: 'mall', BIZ: 'biz', HLT: 'health', LED: 'lead' };

/* v10.663 (D314 · docs/795) 아이콘 · 대표 색 — 서버 GWAN_ICONS · GWAN_COLORS 와 같게 · 색 값은 디자인 시트(sgb-tokens.css) */
const ICONS: Array<[string, string]> = [['book', '책'], ['home', '집'], ['briefcase', '가방'], ['heart', '하트'], ['car', '자동차'], ['tool', '공구'],
  ['leaf', '잎'], ['star', '별'], ['cart', '장바구니'], ['people', '사람들'], ['gift', '선물'], ['map', '지도']];
const COLORS: Array<[string, string, string]> = [['money', '주황(소개장터)', '#ffa03e'], ['mall', '청록(안심소개)', '#0f766e'], ['biz', '보라(소개창업)', '#6d28d9'],
  ['shop', '초록(소개몰)', '#16a34a'], ['plaza', '진한 주황(소개광장)', '#fd580a'], ['navy', '남색', '#00245a'], ['link', '파랑', '#156afd']];
const TARGETS: Array<[string, string]> = [['GOODS', '상품 · 서비스'], ['ASSET', '자산 · 매물'], ['BIZ', '사업 기회']];

/* v10.689 (docs/800) 이 관 금칙어 — 개수 · 정책 › 금칙어로 바로 가기(금칙어는 관별 칸이 있는 그 화면에서 고침) */
function BannedLink({ code, onGo }: { code: string; onGo?: (t: string) => void }) {
  const st = useApi<{ now: { bannedWords?: number } }>(`/admin/gwans/${code}/stats?days=7`);
  if (!st.data) return null;
  return (
    <p className="card pad" data-gwan-banned>이 관 금칙어 <b>{st.data.now.bannedWords ?? 0}</b>개 <span className="dim">(모든 관 공통 금칙어는 따로)</span>
      {onGo && <> · <button className="btn-sm" onClick={() => onGo('policy')}>정책 › 금칙어로</button></>}</p>
  );
}

/* v10.680 (D318 · docs/799) 관 담당자 — 운영 계정 5명까지 · 순서대로(첫째 = 그 관 페이지 문의의 처음 담당 · 7일 초안 알림에 이름) */
function Managers({ code }: { code: string }) {
  const m = useApi<{ items: Array<{ accountId: string; name: string; email: string }>; candidates: Array<{ accountId: string; name: string; email: string }> }>(`/admin/gwans/${code}/managers`);
  const [pick, setPick] = useState<string[] | null>(null);
  const a = useAct();
  useEffect(() => { if (m.data) setPick(m.data.items.map((x) => x.accountId)); }, [m.data]);
  if (m.error) return <ErrorView error={m.error} onRetry={m.reload} />;
  if (!m.data || !pick) return null;
  const name = (id: string) => { const c = m.data!.candidates.find((x) => x.accountId === id) ?? m.data!.items.find((x) => x.accountId === id); return c ? `${c.name} (${c.email})` : id; };
  return (
    <div className="card pad" data-gwan-managers>
      <h3 style={{ marginTop: 0 }}>관 담당자 <span className="dim">— 5명까지 · 첫째가 이 관 페이지 「문의 받기」 문의의 처음 담당 · 7일 지난 초안 알림에 이름</span></h3>
      <Flash msg={a.msg} err={a.err} />
      <ol style={{ margin: '0 0 8px' }}>{pick.map((id, i) => <li key={id}>{name(id)} {i > 0 && <button className="btn-sm" onClick={() => { const n = [...pick]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; setPick(n); }} aria-label="위로">↑</button>} <button className="btn-sm btn-no" onClick={() => setPick(pick.filter((x) => x !== id))}>빼기</button></li>)}</ol>
      <div className="acts">
        {pick.length < 5 && <select value="" aria-label="담당자 더하기" onChange={(e) => { if (e.target.value) setPick([...pick, e.target.value]); }}>
          <option value="">담당자 더하기…</option>{m.data.candidates.filter((c) => !pick.includes(c.accountId)).map((c) => <option key={c.accountId} value={c.accountId}>{c.name} ({c.email})</option>)}</select>}
        <button className="btn-ok" disabled={a.busy === 'mgr'} data-gwan-managers-save onClick={() => void a.run('mgr', () => api(`/admin/gwans/${code}/managers`, { method: 'PUT', body: JSON.stringify({ accountIds: pick }) }), m.reload, '담당자를 저장했습니다.')}>저장</button>
      </div>
    </div>
  );
}

/* v10.660 (D314) 준비중 관 지우기 — 운영 화면에서 만들고 한 번도 안 연 관만 · 확인 글자 = 관 코드 */
function DeleteGwan({ g, onDone }: { g: Gwan; onDone: () => void }) {
  const [c, setC] = useState('');
  const a = useAct();
  if (!g.deletable) return null;
  return (
    <div className="card pad" data-gwan-delete>
      <h3 style={{ marginTop: 0 }}>이 관 지우기 <span className="dim">— 한 번도 열지 않은 준비중 관만</span></h3>
      <p className="hint">업종 · 등록 폼 문구 · 관 페이지 · 번역도 함께 지워집니다. <b>되돌릴 수 없습니다.</b> 매물 · 요청 · 공지 등이 있거나 로그인 랜딩이면 서버가 막습니다.</p>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts">
        <input value={c} onChange={(e) => setC(e.target.value.toUpperCase())} placeholder={`확인: ${g.code} 입력`} aria-label="확인 글자" style={{ width: 160 }} />
        <button className="btn-no" disabled={c !== g.code || a.busy === 'del'} data-gwan-delete-go
                onClick={() => { if (confirm(`${g.name}(${g.code})을(를) 지웁니다. 되돌릴 수 없습니다.`)) void a.run('del', () => api(`/admin/gwans/${g.code}`, { method: 'DELETE', body: JSON.stringify({ confirm: c }) }), onDone, '지웠습니다.'); }}>관 지우기</button>
      </div>
    </div>
  );
}

const STABS: SubTab<STab>[] = [
  { key: 'basic', label: '기본 정보', screen: 'SB-ADM-SIT-030' },
  { key: 'form', label: '등록 폼 문구', screen: 'SB-ADM-SIT-030' },   // v10.646 (D309 · docs/791)
  { key: 'status', label: '공개 상태', screen: 'SB-ADM-SIT-030' },
  { key: 'order', label: '노출 순서', screen: 'SB-ADM-SIT-030' },
  { key: 'landing', label: '로그인 랜딩', screen: 'SB-ADM-SIT-030' },
  { key: 'stats', label: '현황', screen: 'SB-ADM-SIT-030' },
  { key: 'fixed', label: '고정 항목', screen: 'SB-ADM-SIT-030' },
  { key: 'category', label: '업종', screen: 'SB-ADM-SIT-030' },
  { key: 'open', label: '오픈 점검', screen: 'SB-ADM-SIT-030' },
];

/* v10.672 (D316 · docs/797) 관 현황판 — 최근 7 · 30 · 90일(서울 날짜) 합 · 지금 숫자 · 날마다 막대 */
interface Stats { days: number; total: { views: number; listings: number; published: number; requests: number; inquiries?: number };
  now: { liveListings: number; categories: number; reviewPending: number; publishedPages: number; liveRequests: number; openInquiries?: number; bannedWords?: number };
  rows: Array<{ day: string; views: number; listings: number; published: number; requests: number; inquiries?: number }> }
function StatsBoard({ code }: { code: string }) {
  const [days, setDays] = useState(30);
  const st = useApi<Stats>(`/admin/gwans/${code}/stats?days=${days}`);
  if (st.error) return <ErrorView error={st.error} onRetry={st.reload} />;
  const d = st.data;
  const max = Math.max(1, ...(d?.rows ?? []).map((r) => Math.max(r.views, r.listings, r.requests)));
  const bar = (v: number, c: string) => <span style={{ display: 'inline-block', height: 8, width: `${(v / max) * 100}%`, minWidth: v ? 2 : 0, background: c, borderRadius: 2, verticalAlign: 'middle' }} />;
  return (
    <div data-gwan-stats>
      <div className="search-row"><label>기간 <select value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>7일</option><option value={30}>30일</option><option value={90}>90일</option></select></label></div>
      {!d ? <p className="muted">불러오는 중…</p> : (<>
        <table className="tbl"><tbody>
          <tr><th>최근 {d.days}일 페이지 방문</th><td className="num-cell">{n(d.total.views)}</td><th>지금 노출 중 매물</th><td className="num-cell">{n(d.now.liveListings)}</td></tr>
          <tr><th>최근 {d.days}일 새 매물</th><td className="num-cell">{n(d.total.listings)}</td><th>지금 노출 중 요청</th><td className="num-cell">{n(d.now.liveRequests)}</td></tr>
          <tr><th>최근 {d.days}일 새로 노출된 매물</th><td className="num-cell">{n(d.total.published)}</td><th>승인 업종</th><td className="num-cell">{n(d.now.categories)}</td></tr>
          <tr><th>최근 {d.days}일 새 요청</th><td className="num-cell">{n(d.total.requests)}</td><th>검수 대기</th><td className="num-cell">{d.now.reviewPending > 0 ? <b className="warn-text">{n(d.now.reviewPending)}</b> : 0}</td></tr>
          <tr><th>게시된 관 페이지</th><td className="num-cell">{n(d.now.publishedPages)}</td><th>관 페이지 문의(답변 대기)</th><td className="num-cell" data-gwan-stats-inq>{n(d.total.inquiries ?? 0)} ({d.now.openInquiries ?? 0})</td></tr>
        </tbody></table>
        <p className="dim">날마다 — <span style={{ color: 'var(--sgb-link, #156afd)' }}>■</span> 방문 · <span style={{ color: 'var(--sgb-mall, #0f766e)' }}>■</span> 새 매물 · <span style={{ color: 'var(--sgb-money, #ffa03e)' }}>■</span> 새 요청</p>
        <table className="tbl"><tbody>{d.rows.slice().reverse().map((r) => (
          <tr key={r.day}><td className="mono" style={{ width: 100 }}>{r.day}</td>
            <td>{bar(r.views, 'var(--sgb-link, #156afd)')} {r.views}<br />{bar(r.listings, 'var(--sgb-mall, #0f766e)')} {r.listings}<br />{bar(r.requests, 'var(--sgb-money, #ffa03e)')} {r.requests}</td></tr>))}</tbody></table>
      </>)}
    </div>
  );
}

/* v10.668 (docs/796) 새 관 열기 길잡이 — 운영 화면에서 만든 관(소개 대상 있음) · 단계마다 됨 · 안 됨 · 바로 가기(전: 탭 8개를 직접 돌아다님) */
function OpenGuide({ g, onTab, onGo, onPages }: { g: Gwan; onTab: (t: STab) => void; onGo?: (t: string) => void; onPages?: (c: string) => void }) {
  const fc = useApi<Array<{ role: string }>>(`/admin/gwans/${g.code}/form-copy`);
  const pg = useApi<Array<{ slug: string; lang?: string; status: string }>>(`/admin/gwans/${g.code}/pages`);
  if (!g.introTarget || g.isHub) return null;
  const home = (pg.data ?? []).find((x) => x.slug === 'home' && (x.lang ?? 'ko') === 'ko');
  const steps: Array<{ k: string; t: string; done: boolean | null; need: boolean; note: string; go?: () => void }> = [
    { k: 'make', t: '① 관 만들기', done: true, need: true, note: `${g.name}(${g.code})` },
    { k: 'desc', t: '② 설명 · 아이콘 · 색', done: !!g.description, need: true, note: g.description ? `설명 있음${g.icon ? ' · 아이콘' : ''}${g.color ? ' · 색' : ''}` : '설명이 비면 메인 카드가 빕니다', go: () => onTab('basic') },
    { k: 'form', t: '③ 등록 폼 문구', done: fc.data ? fc.data.length > 0 : null, need: true, note: fc.data ? (fc.data.length ? fc.data.map((x) => (x.role === 'OFFER' ? '소개합니다' : '찾습니다')).join(' · ') : '없으면 열 수 없음(NO_FORM_COPY)') : '확인 중', go: () => onTab('form') },
    { k: 'cat', t: '④ 업종 승인', done: g.categories > 0, need: true, note: g.categories > 0 ? `${g.categories}종 승인됨` : '없으면 열 수 없음 · 다른 관 업종 가져오기도 됨(다른 관리자 승인)', go: onGo ? () => onGo('category') : undefined },
    { k: 'page', t: '⑤ 첫 화면 페이지(선택)', done: pg.data ? home?.status === 'PUBLISHED' : null, need: false, note: pg.data ? (home ? (home.status === 'PUBLISHED' ? '게시됨' : '초안 — 게시 전') : '없으면 제목 + 매물 목록') : '확인 중', go: onPages ? () => onPages(g.code) : undefined },
    { k: 'open', t: '⑥ 관 열기', done: g.isActive, need: true, note: g.isActive ? '운영중' : '①~④ 가 되면 「공개 상태」에서', go: () => onTab('status') },
  ];
  const left = steps.filter((x) => x.need && x.done === false).length;
  return (
    <div className="card pad" data-gwan-open-guide>
      <h3 style={{ marginTop: 0 }}>새 관 열기 길잡이 <span className="dim">— {g.isActive ? '열림' : left ? `남은 단계 ${left}` : '열 준비 끝'}</span></h3>
      <table className="tbl"><tbody>
        {steps.map((x) => (
          <tr key={x.k} data-guide-step={x.k}>
            <td><b>{x.t}</b></td>
            <td>{x.done === null ? <span className="dim">…</span> : x.done ? <span className="st ok">됨</span> : <span className={x.need ? 'st no' : 'st'}>{x.need ? '안 됨' : '선택'}</span>}</td>
            <td className="muted">{x.note}</td>
            <td>{x.go && !x.done && <button className="btn-sm" onClick={x.go}>바로 가기</button>}</td>
          </tr>))}
      </tbody></table>
    </div>
  );
}

export function GwanSettings({ code, created, onPick, onGo, initialTab, onPages }: {
  code: string | null; created: string | null; onPick: (c: string) => void; onGo?: (t: string) => void; initialTab?: STab; onPages?: (c: string) => void }) {
  const manage = useApi<Manage[]>('/admin/gwans/manage');
  const [g, setG] = useState<Gwan | null>(null);
  const [gErr, setGErr] = useState<unknown>(null);
  const [tab, setTab] = useState<STab>(initialTab ?? 'basic');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [sort, setSort] = useState('');
  const [forNew, setForNew] = useState(false);
  const [parent, setParent] = useState('');   // v10.646 (D309) 상위 관(허브)
  const [icon, setIcon] = useState('');   // v10.663 (D314)
  const [color, setColor] = useState('');
  const [target, setTarget] = useState('');   // v10.660 (D314) 준비중일 때만 바꿈
  const a = useAct();

  const cur = code ?? manage.data?.[0]?.code ?? null;
  const load = () => {
    if (!cur) return;
    setGErr(null);
    api<Gwan>(`/admin/gwans/${cur}`).then((d) => {
      setG(d); setName(d.name); setDesc(d.description ?? ''); setSort(String(d.sortOrder)); setParent(d.parentCode ?? '');
      setIcon(d.icon ?? ''); setColor(d.color ?? ''); setTarget(d.introTarget ?? '');
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
    ['업종 1종 이상 승인', ...categoryCheck(g)],   // v10.642 (docs/786) 허브 · 리드관
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
      <p className="lead">코드는 바꿀 수 없습니다. 소개 대상은 한 번도 열지 않은 준비중 관만 바꿉니다. 나머지는 배포 없이 즉시 반영됩니다.</p>
      <OpenGuide key={`${g.code}-${g.isActive}-${g.categories}`} g={g} onTab={(t) => { a.clear(); setTab(t); }} onGo={onGo} onPages={onPages} />
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
            <tr><td><b>소개 대상</b></td><td>{g.introTarget === 'GOODS' ? '상품 · 서비스' : g.introTarget === 'ASSET' ? '자산 · 매물' : g.introTarget === 'BIZ' ? '사업 기회' : '정하지 않음(처음 관)'}</td><td className="dim">{g.introTarget && !g.openedAt && !g.isActive ? '준비중이라 아래에서 바꿀 수 있음' : '한 번 연 관 · 처음 관은 변경 불가'}</td></tr>
            <tr><td><b>상위 관(허브)</b></td><td>{g.isHub ? '허브 관 자신' : g.parentName ? `${g.parentName} (${g.parentCode})` : '없음'}</td><td className="dim">아래에서 바꿈 · 허브 관만 고를 수 있음</td></tr>
            {/* v10.647 (docs/792) 실제 사용자 웹 주소 — 처음 관은 고정 주소(/money 등) · 새 관은 /g/<코드 소문자> · 허브는 주소 없음(전: 「서브도메인 edu.sogaebank.com」 — 쓰지 않는 주소) */}
            <tr><td><b>사용자 웹 주소</b></td><td className="mono">{g.isHub ? '없음(허브 관 — 하위 관 묶음)' : `sogaebank.com/${GWAN_WEB_PATH[g.code] ?? `g/${g.code.toLowerCase()}`}`}</td><td className="dim">코드로 정해짐 · 바꿀 수 없음</td></tr>
            <tr><td><b>인증 게이트</b></td><td>등록 · 1:1 문의 시작 시 (서버 게이트)</td><td className="dim">즉시 반영</td></tr>
            <tr><td><b>공개 상태</b></td><td>{g.isActive ? '운영중' : '준비중'}</td><td className="dim">즉시 반영 — 「공개 상태」 탭</td></tr>
          </tbody>
        </table></div>
        <div className="card pad">
          <div className="form-grid">
            <label><span>관 이름</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
            {!g.isHub && (
              <label><span>상위 관(허브)</span>
                <select value={parent} onChange={(e) => setParent(e.target.value)} data-gwan-parent>
                  <option value="">없음</option>
                  {manage.data.filter((x) => x.isHub && x.code !== g.code).map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}
                </select>
              </label>
            )}
            <label style={{ gridColumn: '1 / -1' }}>
              <span>설명</span><input value={desc} onChange={(e) => setDesc(e.target.value)} />
            </label>
            {/* v10.663 (D314) 아이콘 · 대표 색 — 사용자 웹 관 머리 · 메인 새 관 카드 */}
            <label><span>아이콘</span>
              <select value={icon} onChange={(e) => setIcon(e.target.value)} data-gwan-icon><option value="">없음(기본 모양)</option>{ICONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label><span>대표 색</span>
              <select value={color} onChange={(e) => setColor(e.target.value)} data-gwan-color style={color ? { borderLeft: `8px solid ${COLORS.find((x) => x[0] === color)?.[2]}` } : undefined}>
                <option value="">없음(기본 색)</option>{COLORS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            {g.introTarget && !g.openedAt && !g.isActive && (   /* v10.660 (D314) */
              <label><span>소개 대상(준비중일 때만)</span>
                <select value={target} onChange={(e) => setTarget(e.target.value)} data-gwan-target>{TARGETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>)}
          </div>
          <div className="acts">
            <button className="btn-ok" disabled={a.busy === 'patch' || name.trim().length < 2}
                    onClick={() => void patch({ name: name.trim(), description: desc.trim(), ...(g.isHub ? {} : { parentCode: parent }), icon, color,
                      ...(g.introTarget && !g.openedAt && !g.isActive && target && target !== g.introTarget ? { introTarget: target } : {}) }, '저장했습니다. 바로 반영됩니다.')}>
              저장
            </button>
            {g.isActive && <button className="btn-no" disabled={a.busy === 'patch'} onClick={() => {
              if (!confirm(`${g.name}을(를) 중지합니다.\n신규만 막히고 진행 중 거래는 끝까지 갑니다.`)) return;
              void patch({ isActive: false }, '관을 중지했습니다.');
            }}>관 중지</button>}
          </div>
        </div>
        <BannedLink code={g.code} onGo={onGo} />
        <Managers code={g.code} />
        <DeleteGwan g={g} onDone={() => { manage.reload(); const next = manage.data?.find((x) => x.code !== g.code)?.code; if (next) onPick(next); }} />
        </>
      )}

      {tab === 'form' && <FormCopyTab code={g.code} />}

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

      {tab === 'stats' && <StatsBoard code={g.code} />}
      {tab === 'stats' && <p className="dim">연 날 {ymd(g.openedAt)} · 노출 순서 {g.sortOrder}</p>}

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
          {g.isHub || g.consultCategories != null
            ? <p data-cat-basis={g.isHub ? 'hub' : 'consult'}>{categoryCheck(g)[1]}</p>   /* v10.642 (docs/786) */
            : <p>승인된 업종 <b>{g.categories}</b>종 {g.categories === 0 && <b className="warn-text">— 이 상태로는 열 수 없습니다</b>}</p>}
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
