import { useEffect, useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useHashSub } from '../../lib/hashSub';
import { useApi } from '../../lib/useApi';
import { useAct, ymd } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { SubTabs, type SubTab } from '../../components/SubTabs';

interface Section {
  code: string; name: string; sortOrder: number;
  isActive: boolean; isLocked: boolean; description: string | null;
}
interface Copy { slot: string; text: string; note: string | null }
interface MainNotice {
  id: string; title: string; startsAt: string | null;
  endsAt: string | null; showing: boolean;
}
interface Notice {
  id: string; gwanCode: string | null; title: string; body: string;
  isPinned: boolean; publishedAt: string | null;
}
interface Placement {
  id: string; slotCode: string | null; advertiserName: string | null;
  startsAt: string | null; endsAt: string | null; status: string;
  impressions: number; clicks: number;
}
interface Gwan {
  code: string; name: string; isActive: boolean; sortOrder: number;
  publishedListings: number; categories: number; reviewPending: number;
  parentCode?: string | null; parentName?: string | null; isHub?: boolean;
}
interface Layout { sections: string[]; gwanOrder: string[] }

const SLOT: Record<string, string> = {
  HERO_TITLE: '메인 제목', HERO_SUB: '부제', HERO_CTA: '행동 버튼',
};
const LAYOUT_SEC: Record<string, string> = {
  gwan_nav: '관 바로가기', latest: '최신 등록', notice: '공지',
};

type View = 'banner' | 'gwan' | 'layout' | 'content';
const TABS: SubTab<View>[] = [
  { key: 'banner', label: '배너 · 공지', screen: 'SB-ADM-MAIN-010' },
  { key: 'gwan', label: '관 노출', screen: 'SB-ADM-MAIN-020' },
  { key: 'layout', label: '화면 구성', screen: 'SB-ADM-MAIN-030' },
  { key: 'content', label: '콘텐츠', screen: 'SB-ADM-MAIN-040' },
];

/**
 * SB-ADM-MAIN-010 메인 운영 · 배너/광고
 * SB-ADM-MAIN-020 메인 운영 · 관 노출
 * SB-ADM-MAIN-030 메인 운영 · 화면 구성
 * SB-ADM-MAIN-040 메인 운영 · 콘텐츠
 *
 * 구역 순서·노출과 문구를 여기서 바꿉니다. **배포가 필요 없습니다.**
 * 코드에 있으면 "성공 사례를 위로 올려 달라" 같은 요청마다 배포해야 하고,
 * 그러면 아무도 안 바꿉니다.
 *
 * ★ 레지스트리는 ADMIN · SUPER 인데 서버(`/admin/main/*` · `/admin/layout` ·
 *   `/admin/gwans` · `/admin/notices`)는 SUPER 만 받습니다(2026-10-02 실측).
 *   탭은 서버에 맞춰 SUPER 에게만 보입니다 — 보고서에 적었습니다.
 */
export function MainOps({ onGo }: { onGo?: (tab: string) => void } = {}) {
  /* v10.31 (10/10 matrix) — 배너 · 광고(MAIN-010)는 운영(ADMIN)에게도, 관 노출 · 화면 구성 · 콘텐츠(MAIN-020~040)는 SUPER 만 */
  const isSuper = tokenRoles().includes('SUPER');
  const tabs = TABS.filter((t) => t.key === 'banner' || isSuper);
  const [view, setView] = useHashSub<View>('banner', tabs.map((t) => t.key));
  return (
    <section>
      {tabs.length > 1 && <SubTabs tabs={tabs} value={view} onChange={setView} />}
      {view === 'banner' && <Banner onGo={onGo} />}
      {view === 'gwan' && isSuper && <GwanExposure onGo={onGo} />}
      {view === 'layout' && isSuper && <LayoutView />}
      {view === 'content' && isSuper && <Content />}
    </section>
  );
}

interface Creative { code: string; advertiser: string; category: string; title?: string; slot: string | null; status: string; regulated: boolean; reviewConfirmedAt: string | null; segments?: string[] }
interface Slot { code: string; name: string; placement: string; width: number | null; height: number | null; inRanking: boolean; isActive: boolean; current: string | null }
const AST: Record<string, [string, string]> = {
  ACTIVE: ['노출 중', 'ok'], PAUSED: ['중지', ''], BLOCKED: ['등록 불가', 'no'], DRAFT: ['준비', ''], SCHEDULED: ['예약', 'wait'], ENDED: ['종료', ''],
};

/* ── SB-ADM-MAIN-010 배너 · 공지 ─────────────────────────────────── */
function Banner({ onGo }: { onGo?: (tab: string) => void }) {
  const ads = useApi<Placement[]>('/admin/ads');
  const notices = useApi<MainNotice[]>('/admin/main/notices');
  /* v10.31 — 시안 「슬롯 4 · 소재 4」 표. 슬롯 · 소재는 광고 관리와 같은 자료(/admin/ad-creatives) */
  const slots = useApi<Slot[]>('/admin/ad-creatives/slots');
  const creatives = useApi<Creative[]>('/admin/ad-creatives');
  const [pick, setPick] = useState<{ code: string; slot: string } | null>(null);
  const a = useAct();
  const assign = () => pick && a.run('assign', () => api(`/admin/ad-creatives/${pick.code}/assign`, {
    /* 세그먼트는 그대로 둡니다(서버 assign 이 보낸 목록으로 바꾸므로 지금 값을 같이 보냄) */
    method: 'POST', body: JSON.stringify({ slot: pick.slot || null, segments: (creatives.data ?? []).find((c) => c.code === pick.code)?.segments ?? [] }),
  }), () => { setPick(null); slots.reload(); creatives.reload(); }, pick.slot ? `${pick.code} 를 ${pick.slot} 에 붙였습니다.` : `${pick.code} 를 슬롯에서 뗐습니다.`);

  if (ads.error) return <ErrorView error={ads.error} onRetry={ads.reload} />;
  const mainSlots = (slots.data ?? []).filter((x) => ['HERO', 'ENTRY', 'FLOAT', 'RECS'].includes(x.code));
  const cr = creatives.data ?? [];
  const regulated = cr.filter((c) => c.regulated && (c.status === 'BLOCKED' || !c.reviewConfirmedAt));

  return (
    <>
      <div className="ad-dact end" style={{ marginTop: 0 }}>
        <button className="btn-ok" onClick={() => setPick(pick ? null : { code: cr.find((c) => c.status !== 'BLOCKED')?.code ?? '', slot: 'HERO' })} data-assign-open>소재 지정</button>
      </div>
      {pick && (
        <div className="ad-panel" data-assign-form>
          <h3>소재 지정 <small>슬롯에 붙일 소재를 고릅니다 — 규제 소재는 DB 가 거부합니다</small></h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={pick.code} onChange={(e) => setPick({ ...pick, code: e.target.value })} aria-label="소재">
              {cr.filter((c) => c.status !== 'BLOCKED').map((c) => <option key={c.code} value={c.code}>{c.code} · {c.advertiser} · {c.title ?? c.category}</option>)}
            </select>
            <select value={pick.slot} onChange={(e) => setPick({ ...pick, slot: e.target.value })} aria-label="슬롯">
              <option value="">슬롯에서 떼기</option>
              {(slots.data ?? []).map((x) => <option key={x.code} value={x.code}>{x.code} · {x.placement || x.name}</option>)}
            </select>
            <button className="btn-ok btn-sm" disabled={!pick.code || a.busy === 'assign'} onClick={() => void assign()}>지정</button>
            <button className="btn-plain btn-sm" onClick={() => setPick(null)}>닫기</button>
          </div>
          <span className="ad-ls">세그먼트까지 고르려면 광고 관리에서 「배정」을 쓰십시오{onGo && <> — <button className="linkbtn" onClick={() => onGo('ads')}>광고 관리로</button></>}.</span>
        </div>
      )}
      <Flash msg={a.msg} err={a.err} />
      <div className="ad-nt info">
        <b>광고는 순위에 끼지 않습니다.</b> 노출 순위가 대가에 따른 것이면 표시해야 하고(표시광고법), 그래서 슬롯을 나눠 두었습니다 — 섞으면 표시로도 해결되지 않습니다.
      </div>

      <h2 className="ad-s2">슬롯 <em>{mainSlots.length}</em></h2>
      <div className="ad-tw"><table className="tbl" data-main-slots>
        <thead><tr><th>슬롯</th><th>위치</th><th>규격</th><th>현재 소재</th><th>순위 포함</th></tr></thead>
        <tbody>
          {mainSlots.map((x) => (
            <tr key={x.code}><td className="mono"><b>{x.code}</b></td><td>{x.placement || x.name}</td>
              <td className="mono">{x.width && x.height ? `${x.width}×${x.height}` : '—'}</td>
              <td className="mono">{x.current ?? '—'}</td><td>{x.inRanking ? '예' : '아니오'}</td></tr>
          ))}
          {!mainSlots.length && <tr><td colSpan={5} className="muted">슬롯이 없습니다.</td></tr>}
        </tbody>
      </table></div>

      <h2 className="ad-s2">소재 <em>{cr.length}</em></h2>
      <div className="ad-tw"><table className="tbl" data-main-creatives>
        <thead><tr><th>코드</th><th>광고주</th><th>분류</th><th>슬롯</th><th>상태</th></tr></thead>
        <tbody>
          {cr.map((c) => {
            const st = c.regulated && !c.reviewConfirmedAt && c.status !== 'BLOCKED' ? ['심의 필요', 'wait'] : AST[c.status] ?? [c.status, ''];
            return (
              <tr key={c.code}><td className="mono"><b>{c.code}</b></td><td>{c.advertiser}</td><td>{c.category}</td>
                <td className="mono">{c.slot ?? '—'}</td><td><span className={`ad-bg ${st[1]}`}>{st[0]}</span></td></tr>
            );
          })}
        </tbody>
      </table></div>
      <div className="ad-nt warn">
        <b>규제 소재는 DB 가 거부합니다.</b> 대부 · 다단계는 아예 불가하고, 의료는 심의필 확인 후에만 슬롯에 붙습니다.
        {regulated.length > 0 && <> 지금 규제 소재 {regulated.length}건이 슬롯 밖에 있습니다.</>}
      </div>

      {/* 아래는 개발에만 — 관별 배너 게재(site 의 /admin/ads)와 메인 공지 */}
      <h2 className="ad-s2">배너 · 광고 게재 <em>{(ads.data ?? []).length}</em></h2>
      {ads.data && ads.data.length === 0 && <p className="muted">게재 중인 배너가 없습니다.</p>}
      {ads.data && ads.data.length > 0 && (
        <table className="tbl">
          <thead><tr><th>슬롯</th><th>광고주</th><th>기간</th><th>상태</th><th>노출</th><th>클릭</th></tr></thead>
          <tbody>
            {ads.data.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.slotCode ?? '—'}</td>
                <td>{p.advertiserName ?? <span className="muted">(자사)</span>}</td>
                <td className="muted">{ymd(p.startsAt)} ~ {p.endsAt ? ymd(p.endsAt) : '무기한'}</td>
                <td>{p.status}</td>
                <td className="num-cell">{p.impressions}</td>
                <td className="num-cell">{p.clicks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>메인 공지 <em>{(notices.data ?? []).length}</em></h2>
      {notices.data && notices.data.length === 0 && <p className="muted">메인에 걸린 공지가 없습니다. 콘텐츠 탭에서 등록합니다.</p>}
      {(notices.data ?? []).length > 0 && (
        <table className="tbl">
          <thead><tr><th>제목</th><th>기간</th><th>게시</th></tr></thead>
          <tbody>
            {(notices.data ?? []).map((nt) => (
              <tr key={nt.id}>
                <td>{nt.title}</td>
                <td className="muted">{ymd(nt.startsAt)} ~ {nt.endsAt ? ymd(nt.endsAt) : '무기한'}</td>
                <td>{nt.showing
                  ? <span className="badge badge-verified">게시 중</span>
                  : <span className="badge badge-urgent">대기</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="card">
        <b>기간이 지난 공지는 자동으로 내려갑니다.</b> 손으로 지울 필요가 없고, 지난 공지도 기록으로 남습니다.
      </p>
    </>
  );
}

/* ── SB-ADM-MAIN-020 관 노출 ─────────────────────────────────────── */
function GwanExposure({ onGo }: { onGo?: (tab: string) => void }) {
  const list = useApi<Gwan[]>('/admin/gwans');
  const a = useAct();

  async function toggle(g: Gwan) {
    // 숨기면 그 관의 등록이 목록에서 빠집니다. 지워지는 것은 아닙니다.
    if (g.isActive && !confirm(
      `${g.name}을(를) 숨깁니다.\n\n이미 올라온 등록은 지워지지 않지만 목록에서 보이지 않게 됩니다. 진행하시겠습니까?`)) return;
    await a.run(g.code, () => api(`/admin/gwans/${g.code}/visibility`, {
      method: 'PATCH', body: JSON.stringify({ isActive: !g.isActive }),
    }), list.reload, `${g.name} ${g.isActive ? '숨김' : '노출'}으로 바꿨습니다.`);
  }

  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  if (!list.data) return <p className="muted">불러오는 중…</p>;
  const rows = [...list.data].sort((x, y) => x.sortOrder - y.sortOrder);

  return (
    <>
      <div className="ad-chk"><b>노출 {rows.filter((g) => g.isActive).length} / {rows.length}</b>
        <span className="ad-bg">순서는 관 관리에서 바꿉니다</span>
        {onGo && <button className="linkbtn" onClick={() => onGo('gwans')}>관 관리로</button>}</div>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl">
        <thead><tr><th>관</th><th>상위</th><th>순서</th><th>노출</th><th>등록 수</th><th>승인 업종</th><th>검수 대기</th><th>처리</th></tr></thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.code}>
              <td><b>{g.name}</b> <span className="muted">{g.code}</span>{g.parentCode == null && g.isHub && <span className="ad-bg pp"> 상위</span>}</td>
              <td>{g.parentName ?? (g.parentCode ?? '—')}</td>
              <td className="num-cell">{g.sortOrder}</td>
              <td>{g.isActive
                ? <span className="badge badge-verified">노출</span>
                : <span className="badge badge-urgent">숨김</span>}</td>
              <td className="num-cell">{g.publishedListings}</td>
              <td className="num-cell">{g.categories === 0 ? <b className="warn-text">0</b> : g.categories}</td>
              <td className="num-cell">{g.reviewPending > 0 ? <b className="warn-text">{g.reviewPending}</b> : 0}</td>
              <td>
                <button className="btn-sm" disabled={a.busy === g.code} onClick={() => void toggle(g)}>
                  {g.isActive ? '숨기기' : '노출하기'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="card">
        <b>상위 관은 하나만 둘 수 있습니다.</b> 둘이면 메인에서 무엇을 앞에 둘지 매번 다툽니다 — DB 가 막습니다.
      </p>
      <p className="card warn">
        <b>관을 숨기면 그 관의 등록이 보이지 않습니다.</b> 이미 올라온 건은 지워지지 않고 목록에서만 빠집니다.
        승인된 업종이 0인 관은 노출할 수 없습니다 — 서버가 막습니다.
      </p>
    </>
  );
}

/* ── SB-ADM-MAIN-030 화면 구성 ───────────────────────────────────── */
function LayoutView() {
  const sections = useApi<Section[]>('/admin/main/sections');
  const layout = useApi<Layout>('/admin/layout');
  const [secs, setSecs] = useState<string[]>([]);
  const [order, setOrder] = useState<Record<string, string>>({});
  const a = useAct();

  useEffect(() => { if (layout.data) setSecs(layout.data.sections); }, [layout.data]);

  if (sections.error) return <ErrorView error={sections.error} onRetry={sections.reload} />;
  if (layout.error) return <ErrorView error={layout.error} onRetry={layout.reload} />;
  if (!sections.data || !layout.data) return <p className="muted">불러오는 중…</p>;

  const rows = [...sections.data].sort((x, y) => x.sortOrder - y.sortOrder);
  const active = rows.filter((s) => s.isActive).length;

  const toggle = (s: Section) => a.run(s.code, () => api(`/admin/main/sections/${s.code}`, {
    method: 'PATCH', body: JSON.stringify({ isActive: !s.isActive }),
  }), sections.reload, `${s.name} ${s.isActive ? '숨김' : '노출'}으로 바꿨습니다.`);

  async function saveOrder() {
    const changed = rows.filter((s) => order[s.code] !== undefined && Number(order[s.code]) !== s.sortOrder);
    for (const s of changed) {
      const v = Number(order[s.code]);
      if (!Number.isInteger(v)) { a.setErr('순서는 정수로 적어 주십시오.'); return; }
      const r = await a.run('order', () => api(`/admin/main/sections/${s.code}`, {
        method: 'PATCH', body: JSON.stringify({ sortOrder: v }),
      }));
      if (r === undefined) return;
    }
    setOrder({}); sections.reload();
    a.clear(); a.setMsg('구역 순서를 저장했습니다. 바로 반영됩니다.');
  }
  const move = (i: number, d: number) => setSecs((p) => {
    const nx = [...p]; const j = i + d; if (j < 0 || j >= nx.length) return p;
    const t = nx[i]!; nx[i] = nx[j]!; nx[j] = t; return nx;
  });
  async function saveLayout() {
    const sent = [...secs];
    const r = await a.run('layout', () => api<Layout>('/admin/layout', {
      method: 'PATCH', body: JSON.stringify({ sections: sent, gwanOrder: layout.data!.gwanOrder }),
    }), layout.reload, '화면 구성을 저장했습니다. 바로 반영됩니다.');
    /* ★ 2026-10-02 실측 — 서버가 200 을 주면서 보낸 값을 버리고 기존 값을 저장합니다
     *   (LayoutDto 에 검증 데코레이터가 없어 whitelist 가 필드를 모두 지웁니다). 성공으로 보이면 안 됩니다. */
    if (r && r.sections.join() !== sent.join()) {
      a.setErr('서버가 200 을 돌려줬지만 바꾼 순서를 반영하지 않았습니다(서버 결함 — 보고됨). 화면은 서버 값으로 되돌렸습니다.');
    }
  }
  return (
    <>
      <div className="ad-dact end" style={{ marginTop: 0 }}>
        <span className="ad-chk" style={{ margin: '0 auto 0 0' }}><b>구역 {active} / {rows.length}</b></span>
        <button className="btn-ok" disabled={Object.keys(order).length === 0 || a.busy === 'order'}
                onClick={() => void saveOrder()} data-order-save>순서 저장</button>
      </div>
      {active === 0 && <p className="card warn"><b>켜진 구역이 없어 메인이 빕니다.</b></p>}
      <Flash msg={a.msg} err={a.err} />

      <table className="tbl">
        <thead><tr><th>구역</th><th>순서</th><th>노출</th><th>설명</th><th>처리</th></tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.code}>
              <td><b>{s.name}</b>{s.isLocked && <span className="badge badge-verified"> 고정</span>}</td>
              <td>
                <input className="inp-sm" type="number" aria-label={`${s.name} 순서`}
                       value={order[s.code] ?? String(s.sortOrder)}
                       onChange={(e) => setOrder((p) => ({ ...p, [s.code]: e.target.value }))} />
              </td>
              <td>{s.isActive
                ? <span className="badge badge-verified">노출</span>
                : <span className="badge badge-urgent">숨김</span>}</td>
              <td className="muted">{s.description}</td>
              <td>
                {s.isLocked
                  ? <span className="muted">끌 수 없음</span>
                  : <button className="btn-sm" disabled={a.busy === s.code} onClick={() => void toggle(s)}>
                      {s.isActive ? '숨기기' : '노출하기'}
                    </button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="card">
        <b>&lsquo;소개하고 벌기&rsquo;는 끌 수 없습니다.</b> 메인 최상단이 곧 서비스의 첫인상이고,
        그것을 끄면 무엇을 하는 곳인지 알 수 없는 화면이 됩니다 — DB 가 막습니다.
      </p>

      <h2 className="ad-s2">하단 구성 <small className="dim">개발에만</small></h2>
      <p className="lead">구역 아래에 붙는 묶음의 순서입니다.</p>
      <table className="tbl">
        <thead><tr><th>순서</th><th>묶음</th><th>이동</th></tr></thead>
        <tbody>
          {secs.map((s, i) => (
            <tr key={s}>
              <td className="num-cell">{i + 1}</td>
              <td>{LAYOUT_SEC[s] ?? s} <span className="mono">{s}</span></td>
              <td>
                <button className="btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${s} 위로`}>▲</button>{' '}
                <button className="btn-sm" disabled={i === secs.length - 1} onClick={() => move(i, 1)} aria-label={`${s} 아래로`}>▼</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">관 순서: {layout.data.gwanOrder.join(' · ')} — 관 관리에서 바꿉니다.</p>
      <div className="acts">
        <button className="btn-ok" disabled={a.busy === 'layout' || secs.join() === layout.data.sections.join()}
                onClick={() => void saveLayout()}>구성 저장</button>
      </div>
      <p className="hint">
        <b>저장하면 그 시점의 관 순서가 함께 고정됩니다.</b> 저장 전에는 서버가 노출 중인 관을 순서대로 자동으로 채웁니다.
      </p>
    </>
  );
}

/* ── SB-ADM-MAIN-040 콘텐츠 ──────────────────────────────────────── */
function Content() {
  const copy = useApi<Copy[]>('/admin/main/copy');
  const notices = useApi<Notice[]>('/admin/notices');
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [f, setF] = useState({ title: '', body: '', isPinned: false, publish: false });
  const a = useAct();

  const saveCopy = (slot: string) => {
    const text = edit[slot];
    if (!text?.trim()) return;
    // 금칙어가 걸리면 어느 표현인지 서버가 알려줍니다.
    void a.run(slot, () => api(`/admin/main/copy/${slot}`, { method: 'PATCH', body: JSON.stringify({ text }) }),
      () => { setEdit((p) => { const nx = { ...p }; delete nx[slot]; return nx; }); copy.reload(); },
      '문구를 바꿨습니다. 바로 반영됩니다.');
  };
  const addNotice = () => {
    if (f.title.trim().length < 2 || !f.body.trim()) { a.setErr('제목(2자 이상)과 본문을 적어 주십시오.'); return; }
    void a.run('notice', () => api('/admin/notices', {
      method: 'POST',
      body: JSON.stringify({
        title: f.title.trim(), body: f.body.trim(), isPinned: f.isPinned,
        // 비우면 초안입니다. 게시를 고르면 지금 시각으로 공개됩니다.
        publishedAt: f.publish ? new Date().toISOString() : undefined,
      }),
    }), () => { setF({ title: '', body: '', isPinned: false, publish: false }); notices.reload(); },
    f.publish ? '공지를 게시했습니다.' : '초안으로 저장했습니다. 게시 시각이 없어 공개되지 않습니다.');
  };

  if (copy.error) return <ErrorView error={copy.error} onRetry={copy.reload} />;

  return (
    <>
      <div className="ad-dact end" style={{ marginTop: 0 }}>
        <button className="btn-ok" onClick={() => document.getElementById('notice-form')?.scrollIntoView({ behavior: 'smooth' })} data-notice-open>공지 등록</button>
      </div>
      <h2 className="ad-s2">메인 문구</h2>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl">
        <thead><tr><th>자리</th><th>문구</th><th>수정</th></tr></thead>
        <tbody>
          {(copy.data ?? []).map((c) => (
            <tr key={c.slot}>
              <td className="muted">{SLOT[c.slot] ?? c.note ?? c.slot}</td>
              <td>
                <input aria-label={`${SLOT[c.slot] ?? c.slot} 문구`} value={edit[c.slot] ?? c.text}
                       onChange={(e) => setEdit((p) => ({ ...p, [c.slot]: e.target.value }))} />
              </td>
              <td>
                <button className="btn-sm" disabled={!edit[c.slot] || a.busy === c.slot}
                        onClick={() => saveCopy(c.slot)}>수정</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="card warn">
        <b>운영 문구에도 금칙어가 적용됩니다.</b> 예외를 두면 &ldquo;우리는 되고 너희는 안 되냐&rdquo;가 됩니다.
        걸리면 어느 표현인지 그대로 알려드립니다.
      </p>

      <h2 className="ad-s2">공지 <em>{(notices.data ?? []).length}</em></h2>
      {notices.error ? <ErrorView error={notices.error} onRetry={notices.reload} /> : null}
      {notices.data && notices.data.length === 0 && <p className="muted">등록된 공지가 없습니다.</p>}
      {(notices.data ?? []).length > 0 && (
        <table className="tbl">
          <thead><tr><th>제목</th><th>관</th><th>고정</th><th>게시</th></tr></thead>
          <tbody>
            {(notices.data ?? []).map((nt) => (
              <tr key={nt.id}>
                <td>{nt.title}</td>
                <td className="muted">{nt.gwanCode ?? '전 관'}</td>
                <td>{nt.isPinned ? '고정' : '—'}</td>
                <td>{nt.publishedAt
                  ? <span className="badge badge-verified">{ymd(nt.publishedAt)}</span>
                  : <span className="badge badge-urgent">초안</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="ad-s2" id="notice-form">공지 등록</h3>
      <div className="card pad">
        <div className="form-grid">
          <label><span>제목</span><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}><span>본문</span>
            <textarea rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          </label>
        </div>
        <div className="acts">
          <label><input type="checkbox" checked={f.isPinned} onChange={(e) => setF({ ...f, isPinned: e.target.checked })} /> 상단 고정</label>
          <label><input type="checkbox" checked={f.publish} onChange={(e) => setF({ ...f, publish: e.target.checked })} /> 지금 게시</label>
          <button className="btn-ok" disabled={a.busy === 'notice'} onClick={addNotice}>공지 등록</button>
        </div>
        <p className="hint">&lsquo;지금 게시&rsquo;를 고르지 않으면 초안으로 남고 이용자에게 보이지 않습니다.</p>
      </div>
    </>
  );
}
