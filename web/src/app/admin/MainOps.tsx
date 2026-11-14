import { useEffect, useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useHashSub } from '../../lib/hashSub';
import { useApi } from '../../lib/useApi';
import { useAct, ymd, ymdhm } from '../../lib/act';
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
  isPinned: boolean; publishedAt: string | null; grades?: string[];
  /* v10.280 ~ 282 (D211) */
  endsAt?: string | null; endedReason?: string | null; status?: 'DRAFT' | 'SCHEDULED' | 'LIVE' | 'ENDED' | 'TAKEN_DOWN';
  notify?: boolean; notifiedAt?: string | null; notifiedCount?: number | null; rateNotice?: boolean; revisions?: number; notifying?: boolean;
  /* v10.292 · 293 (docs/415) 걸러진 전체 수 · 펼쳐 본 회원 · 볼 수 있는 회원(전체 공개 · 관리자만이면 null) */
  total?: number; reads?: number; target?: number | null;
}
interface NoticeRev { id: string; action: 'EDIT' | 'UNPUBLISH' | 'REPUBLISH'; before: Record<string, unknown>; reason: string | null; at: string; by: string | null }
const NT_STATUS: Record<string, [string, string]> = {
  DRAFT: ['초안', 'badge-urgent'], SCHEDULED: ['예약', ''], LIVE: ['게시 중', 'badge-verified'], ENDED: ['끝남', ''], TAKEN_DOWN: ['내림', ''],
};
const REV_ACTION: Record<string, string> = { EDIT: '고침', UNPUBLISH: '내림', REPUBLISH: '다시 게시' };
/** v10.282 — 날짜 · 시각 칸은 한국 시각으로 읽음 */
const kstAt = (v: string) => `${v}:00+09:00`;
const kstEnd = (d: string) => `${d}T23:59:59+09:00`;
/** v10.279 (D210) 공지 열람 등급 — 코드 · 규칙 고정 · 이름 · 순서 · 사용 여부만 바꿈 */
interface NoticeGrade { code: string; name: string; rule: string; sortOrder: number; isActive: boolean; notices: number }
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
  /* v10.292 (docs/415) 상태 걸러 보기 · 제목 찾기 · 50줄씩 넘기기 */
  const [nf, setNf] = useState({ status: '', q: '', page: 1 });
  const [qIn, setQIn] = useState('');
  const nq = new URLSearchParams({ ...(nf.status ? { status: nf.status } : {}), ...(nf.q ? { q: nf.q } : {}), ...(nf.page > 1 ? { page: String(nf.page) } : {}) }).toString();
  const notices = useApi<Notice[]>(`/admin/notices${nq ? `?${nq}` : ''}`);
  const nTotal = (notices.data ?? [])[0]?.total ?? 0;
  const nPages = Math.max(1, Math.ceil(nTotal / 50));
  const grades = useApi<NoticeGrade[]>('/admin/notice-grades');   // v10.279 (D210)
  const sets = useApi<{ key: string; value: string | null }[]>('/admin/site-settings');   // v10.285 (D212) 공지 알림 기준
  const [lim, setLim] = useState<Record<string, string>>({});
  const setVal = (k: string) => lim[k] ?? (sets.data ?? []).find((x) => x.key === k)?.value ?? '';
  const saveLim = (k: string) => {
    const v = setVal(k).trim();
    if (!/^[1-9]\d{0,6}$/.test(v)) { a.setErr('1 이상의 정수를 적어 주십시오.'); return; }
    void a.run(`lim:${k}`, () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: k, value: v }) }),
      () => { setLim((p) => { const nx = { ...p }; delete nx[k]; return nx; }); sets.reload(); }, '공지 알림 기준을 바꿨습니다.');
  };
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [f, setF] = useState({ title: '', body: '', isPinned: false, mode: 'now' as 'now' | 'schedule' | 'draft', at: '', end: '', notify: false });
  const [pick, setPick] = useState<string[]>([]);
  const [ed, setEd] = useState<null | { id: string; title: string; body: string; grades: string[]; isPinned: boolean; end: string; notify: boolean; reason: string; locked: boolean; published: boolean }>(null);
  const [revOf, setRevOf] = useState<string | null>(null);
  const [revs, setRevs] = useState<NoticeRev[]>([]);
  const a = useAct();
  const gname = (c: string) => (grades.data ?? []).find((g) => g.code === c)?.name ?? c;
  const togglePick = (c: string) => setPick((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  /* v10.285 (D212) — 받는 사람이 기준 이상이면 확인 문구 「모두에게 알림」(취소하면 null) */
  const askBulk = async (gs: string[]): Promise<{ ok: boolean; confirm?: string; note?: string }> => {
    const au = await api<{ count: number; note: string; needsConfirm?: boolean; confirmText?: string; confirmMin?: number }>(`/admin/notices/audience?grades=${encodeURIComponent(gs.join(','))}`);
    if (!au.needsConfirm) return { ok: true, note: au.note };
    const typed = prompt(`${au.note}\n받는 사람이 ${au.confirmMin}명 이상입니다 — 보내려면 「${au.confirmText}」을(를) 그대로 입력하십시오.`);
    if (typed === null) return { ok: false };
    return { ok: true, confirm: typed.trim(), note: au.note };
  };
  const publishDraft = async (nt: Notice) => {
    const again = nt.status === 'ENDED' || nt.status === 'TAKEN_DOWN';
    let notifyConfirm: string | undefined;
    if (!again && nt.notify && !nt.notifiedAt && !nt.notifying) {
      try { const b = await askBulk(nt.grades ?? []); if (!b.ok) return; notifyConfirm = b.confirm; } catch (e) { a.setErr(String((e as Error).message ?? e)); return; }
    }
    if (!confirm(`「${nt.title}」 공지를 ${again ? '다시 ' : '지금 '}게시합니다 — 볼 수 있는 등급: ${(nt.grades ?? []).map(gname).join(' · ')}${nt.notify && !nt.notifiedAt ? '\n그 등급 회원에게 알림이 갑니다.' : ''}\n게시할까요?`)) return;
    void a.run(`pub:${nt.id}`, () => api<{ note: string }>(`/admin/notices/${nt.id}/publish`, { method: 'POST', body: JSON.stringify(notifyConfirm ? { notifyConfirm } : {}) }), notices.reload, (r) => r.note);
  };
  /* v10.280 (D211) 내리기 · 고치기 · 고친 기록 */
  const takeDown = (nt: Notice) => {
    const reason = prompt(nt.status === 'SCHEDULED' ? `「${nt.title}」 예약을 풀어 초안으로 돌립니다 — 사유(2자 이상)` : `「${nt.title}」 공지를 내립니다 — 어디에도 보이지 않게 됩니다. 사유(2자 이상)`);
    if (reason === null) return;
    if (reason.trim().length < 2) { a.setErr('사유를 2자 이상 적어 주십시오.'); return; }
    void a.run(`down:${nt.id}`, () => api<{ note: string }>(`/admin/notices/${nt.id}/unpublish`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }),
      () => { notices.reload(); if (revOf === nt.id) void loadRevs(nt.id); }, (r) => r.note);
  };
  const startEdit = (nt: Notice) => setEd({
    id: nt.id, title: nt.title, body: nt.body, grades: nt.grades ?? [], isPinned: nt.isPinned,
    end: nt.endsAt ? new Date(nt.endsAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) : '', notify: !!nt.notify, reason: '',
    locked: !!nt.rateNotice && (nt.status === 'LIVE' || nt.status === 'ENDED' || nt.status === 'TAKEN_DOWN'),
    published: nt.status !== 'DRAFT' && nt.status !== 'SCHEDULED',
  });
  const saveEdit = async () => {
    if (!ed) return;
    let notifyConfirm: string | undefined;   // v10.285 — 알림을 켜면 받는 사람 수 확인
    if (!ed.locked && !ed.published && ed.notify) {
      try { const b = await askBulk(ed.grades); if (!b.ok) return; notifyConfirm = b.confirm; } catch (e) { a.setErr(String((e as Error).message ?? e)); return; }
    }
    const body: Record<string, unknown> = ed.locked ? { isPinned: ed.isPinned } : {
      title: ed.title.trim(), body: ed.body.trim(), grades: ed.grades, isPinned: ed.isPinned,
      endsAt: ed.end ? kstEnd(ed.end) : null, notify: ed.notify,
    };
    if (ed.reason.trim()) body.reason = ed.reason.trim();
    if (notifyConfirm) body.notifyConfirm = notifyConfirm;
    void a.run(`edit:${ed.id}`, () => api<{ note: string }>(`/admin/notices/${ed.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
      () => { const id = ed.id; setEd(null); notices.reload(); if (revOf === id) void loadRevs(id); }, (r) => r.note);
  };
  const loadRevs = async (id: string) => { try { setRevs(await api<NoticeRev[]>(`/admin/notices/${id}/revisions`)); } catch { setRevs([]); } };
  const toggleRevs = (id: string) => { if (revOf === id) { setRevOf(null); return; } setRevOf(id); void loadRevs(id); };
  const editGrade = (g: NoticeGrade, what: 'name' | 'sort' | 'active') => {
    let body: Record<string, unknown> = {};
    if (what === 'name') { const v = prompt(`${g.code} 등급 이름(1 ~ 30자)`, g.name); if (v === null || !v.trim()) return; body = { name: v.trim() }; }
    if (what === 'sort') { const v = prompt(`${g.name} 순서(작을수록 앞 · 0 이상 정수)`, String(g.sortOrder)); if (v === null || !/^\d+$/.test(v.trim())) return; body = { sortOrder: Number(v) }; }
    if (what === 'active') body = { isActive: !g.isActive };
    void a.run(`grade:${g.code}`, () => api(`/admin/notice-grades/${g.code}`, { method: 'PATCH', body: JSON.stringify(body) }), grades.reload, '공지 등급을 바꿨습니다.');
  };

  const saveCopy = (slot: string) => {
    const text = edit[slot];
    if (!text?.trim()) return;
    // 금칙어가 걸리면 어느 표현인지 서버가 알려줍니다.
    void a.run(slot, () => api(`/admin/main/copy/${slot}`, { method: 'PATCH', body: JSON.stringify({ text }) }),
      () => { setEdit((p) => { const nx = { ...p }; delete nx[slot]; return nx; }); copy.reload(); },
      '문구를 바꿨습니다. 바로 반영됩니다.');
  };
  const noAudience = pick.includes('PUBLIC') || !pick.some((g) => g !== 'STAFF');   // v10.281 — 전체 공개 · 관리자만이면 알림 없음
  const addNotice = async () => {
    if (f.title.trim().length < 2 || !f.body.trim()) { a.setErr('제목(2자 이상)과 본문을 적어 주십시오.'); return; }
    if (!pick.length) { a.setErr('볼 수 있는 등급을 하나 이상 골라 주십시오.'); return; }   // v10.279 (D210)
    if (f.mode === 'schedule' && !f.at) { a.setErr('예약 게시 날짜 · 시각을 정해 주십시오.'); return; }
    const publishedAt = f.mode === 'now' ? new Date().toISOString() : f.mode === 'schedule' ? kstAt(f.at) : undefined;
    const notify = f.notify && !noAudience;
    let notifyConfirm: string | undefined;
    if (notify) {   // v10.281 — 보내기 전에 받는 사람 수 · v10.285 많으면 확인 문구
      try {
        const b = await askBulk(pick);
        if (!b.ok) return;
        notifyConfirm = b.confirm;
        if (!notifyConfirm && !confirm(`${b.note}\n${f.mode === 'now' ? '등록하면 바로' : f.mode === 'schedule' ? '예약 시각이 되면' : '게시할 때'} 알림이 갑니다. 등록할까요?`)) return;
      } catch (e) { a.setErr(String((e as Error).message ?? e)); return; }
    }
    void a.run('notice', () => api('/admin/notices', {
      method: 'POST',
      body: JSON.stringify({
        title: f.title.trim(), body: f.body.trim(), isPinned: f.isPinned, grades: pick, publishedAt,
        endsAt: f.end ? kstEnd(f.end) : undefined, notify, ...(notifyConfirm ? { notifyConfirm } : {}),
      }),
    }), () => { setF({ title: '', body: '', isPinned: false, mode: 'now', at: '', end: '', notify: false }); setPick([]); notices.reload(); grades.reload(); },
    f.mode === 'now' ? '공지를 게시했습니다.' : f.mode === 'schedule' ? '예약했습니다 — 그 시각에 저절로 게시됩니다.' : '초안으로 저장했습니다. 게시 시각이 없어 공개되지 않습니다.');
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

      <h2 className="ad-s2">공지 <em data-notice-total={nTotal}>{nTotal}</em></h2>
      <div className="acts" data-notice-filter>
        <select aria-label="공지 상태" value={nf.status} onChange={(e) => setNf({ ...nf, status: e.target.value, page: 1 })} data-notice-filter-status>
          <option value="">상태 모두</option>
          {Object.entries(NT_STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
        </select>
        <input aria-label="제목 찾기" placeholder="제목에 든 글자" value={qIn} maxLength={100} onChange={(e) => setQIn(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setNf({ ...nf, q: qIn.trim(), page: 1 }); }} data-notice-q />
        <button className="btn-sm" onClick={() => setNf({ ...nf, q: qIn.trim(), page: 1 })} data-notice-q-go>찾기</button>
        {(nf.status || nf.q) && <button className="btn-sm" onClick={() => { setQIn(''); setNf({ status: '', q: '', page: 1 }); }} data-notice-filter-clear>모두 보기</button>}
        <span className="dim" data-notice-page={`${nf.page}/${nPages}`}>{nf.page} / {nPages}쪽 · 50줄씩</span>
        <button className="btn-sm" disabled={nf.page <= 1} onClick={() => setNf({ ...nf, page: nf.page - 1 })} data-notice-prev>앞</button>
        <button className="btn-sm" disabled={nf.page >= nPages} onClick={() => setNf({ ...nf, page: nf.page + 1 })} data-notice-next>뒤</button>
      </div>
      {notices.error ? <ErrorView error={notices.error} onRetry={notices.reload} /> : null}
      {notices.data && notices.data.length === 0 && <p className="muted" data-notice-none>{nf.status || nf.q ? '고른 조건에 맞는 공지가 없습니다.' : '등록된 공지가 없습니다.'}</p>}
      {(notices.data ?? []).length > 0 && (
        <table className="tbl">
          <thead><tr><th>제목</th><th>관</th><th>볼 수 있는 등급</th><th>고정</th><th>상태</th><th>알림</th><th title="공지를 펼쳐 본 회원 / 볼 수 있는 활동 중 회원">읽음</th><th /></tr></thead>
          <tbody>
            {(notices.data ?? []).map((nt) => {
              const st = NT_STATUS[nt.status ?? (nt.publishedAt ? 'LIVE' : 'DRAFT')] ?? ['—', ''];
              const lockedLive = !!nt.rateNotice && nt.status === 'LIVE';
              return (
              <tr key={nt.id} data-notice-row={nt.id} data-notice-status={nt.status}>
                <td>{nt.title}{nt.rateNotice ? <span className="dim"> · 수수료율 공지</span> : null}</td>
                <td className="muted">{nt.gwanCode ?? '전 관'}</td>
                <td data-notice-grades={(nt.grades ?? []).join(',')}>{(nt.grades ?? []).map(gname).join(' · ') || '—'}</td>
                <td>{nt.isPinned ? '고정' : '—'}</td>
                <td>
                  <span className={`badge ${st[1]}`}>{st[0]}</span>{' '}
                  <span className="dim">
                    {nt.status === 'SCHEDULED' ? ymdhm(nt.publishedAt) : nt.publishedAt ? ymd(nt.publishedAt) : ''}
                    {nt.endsAt ? ` ~ ${ymd(nt.endsAt)}` : ''}
                  </span>
                  {nt.status === 'TAKEN_DOWN' && nt.endedReason ? <div className="dim">사유: {nt.endedReason}</div> : null}
                </td>
                <td className="dim" data-notice-notify={nt.notify ? (nt.notifiedAt ? 'sent' : nt.notifying ? 'sending' : 'wait') : 'off'}>
                  {nt.notify ? (nt.notifiedAt ? `보냄 ${nt.notifiedCount ?? 0}명` : nt.notifying ? `보내는 중 ${nt.notifiedCount ?? 0}명(10분마다 이어 보냄)` : '게시되면 보냄') : '—'}
                </td>
                <td className="num-cell" data-notice-reads={nt.reads ?? 0} data-notice-target={nt.target ?? ''}>
                  {nt.status === 'DRAFT' || nt.status === 'SCHEDULED' ? '—' : `읽음 ${nt.reads ?? 0}${nt.target != null ? ` / 대상 ${nt.target}` : ''}`}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {nt.status !== 'LIVE' && (
                    <button className="btn-sm" disabled={a.busy === `pub:${nt.id}`} onClick={() => void publishDraft(nt)} data-notice-publish={nt.id}>
                      {nt.status === 'ENDED' || nt.status === 'TAKEN_DOWN' ? '다시 게시' : '게시'}</button>)}{' '}
                  <button className="btn-sm" onClick={() => startEdit(nt)} data-notice-edit={nt.id}>고치기</button>{' '}
                  {(nt.status === 'LIVE' || nt.status === 'SCHEDULED') && !lockedLive && (
                    <button className="btn-sm" disabled={a.busy === `down:${nt.id}`} onClick={() => takeDown(nt)} data-notice-down={nt.id}>내리기</button>)}{' '}
                  <button className="btn-sm" onClick={() => toggleRevs(nt.id)} data-notice-revs={nt.id}>고친 기록 {nt.revisions ?? 0}</button>
                </td>
              </tr>);
            })}
          </tbody>
        </table>
      )}

      {revOf && (
        <div className="card pad" data-notice-rev-list={revs.length}>
          <b>고친 기록</b> <span className="dim">— 고치기 · 내리기 · 다시 게시 때 그 전 내용(고칠 수 없음)</span>
          {revs.length === 0 ? <p className="dim">기록이 없습니다.</p> : (
            <table className="tbl"><thead><tr><th>때</th><th>한 일</th><th>한 사람</th><th>사유</th><th>그 전 내용</th></tr></thead>
              <tbody>{revs.map((r) => (
                <tr key={r.id}><td className="dim">{ymdhm(r.at)}</td><td>{REV_ACTION[r.action] ?? r.action}</td><td>{r.by ?? '—'}</td><td>{r.reason ?? '—'}</td>
                  <td className="dim" style={{ maxWidth: 420, whiteSpace: 'pre-wrap' }}>{
                    r.action === 'EDIT' ? `제목: ${String(r.before.title ?? '')}\n등급: ${((r.before.grades as string[] | undefined) ?? []).map(gname).join(' · ')}\n본문: ${String(r.before.body ?? '').slice(0, 200)}`
                      : `게시 ${ymd(r.before.publishedAt as string | null)}${r.before.endsAt ? ` ~ ${ymd(r.before.endsAt as string)}` : ''}`}</td></tr>))}
              </tbody></table>)}
        </div>
      )}

      {ed && (
        <div className="card pad" data-notice-edit-form={ed.id}>
          <b>공지 고치기</b>
          {ed.locked ? <p className="card warn" data-notice-locked>게시한 수수료율 변경 공지는 제목 · 본문 · 등급 · 기간을 고치거나 내릴 수 없습니다(입점 약관 제17조 4항 공지 기록). 「상단 고정」만 바꿀 수 있습니다.</p> : (
            <>
              <div className="form-grid">
                <label><span>제목</span><input value={ed.title} onChange={(e) => setEd({ ...ed, title: e.target.value })} data-edit-title /></label>
                <label><span>끝 날짜(비우면 계속)</span><input type="date" value={ed.end} onChange={(e) => setEd({ ...ed, end: e.target.value })} /></label>
                <label style={{ gridColumn: '1 / -1' }}><span>본문</span><textarea rows={3} value={ed.body} onChange={(e) => setEd({ ...ed, body: e.target.value })} /></label>
              </div>
              <div className="acts"><b>볼 수 있는 등급</b>
                {(grades.data ?? []).filter((g) => g.isActive || ed.grades.includes(g.code)).map((g) => (
                  <label key={g.code}><input type="checkbox" checked={ed.grades.includes(g.code)}
                    onChange={() => setEd({ ...ed, grades: ed.grades.includes(g.code) ? ed.grades.filter((x) => x !== g.code) : [...ed.grades, g.code] })} /> {g.name}</label>))}
              </div>
              {!ed.published && <div className="acts"><label><input type="checkbox" checked={ed.notify} onChange={(e) => setEd({ ...ed, notify: e.target.checked })} /> 게시되면 알림 보냄</label></div>}
            </>)}
          <div className="acts">
            <label><input type="checkbox" checked={ed.isPinned} onChange={(e) => setEd({ ...ed, isPinned: e.target.checked })} /> 상단 고정</label>
            {ed.published && <label style={{ flex: 1 }}><span>고치는 사유(게시한 공지는 필수)</span> <input value={ed.reason} onChange={(e) => setEd({ ...ed, reason: e.target.value })} data-edit-reason /></label>}
          </div>
          <div className="acts">
            <button className="btn-ok" disabled={a.busy === `edit:${ed.id}`} onClick={() => void saveEdit()} data-notice-save>저장</button>
            <button className="btn-sm" onClick={() => setEd(null)}>닫기</button>
          </div>
        </div>
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
        </div>
        {/* v10.282 (D211) 지금 게시 · 예약 · 초안 · 끝 날짜 */}
        <div className="acts" data-notice-mode={f.mode}>
          <b>게시</b>
          <label><input type="radio" name="ntmode" checked={f.mode === 'now'} onChange={() => setF({ ...f, mode: 'now' })} data-mode="now" /> 지금 게시</label>
          <label><input type="radio" name="ntmode" checked={f.mode === 'schedule'} onChange={() => setF({ ...f, mode: 'schedule' })} data-mode="schedule" /> 예약</label>
          {f.mode === 'schedule' && <input type="datetime-local" aria-label="예약 게시 시각" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} data-notice-at />}
          <label><input type="radio" name="ntmode" checked={f.mode === 'draft'} onChange={() => setF({ ...f, mode: 'draft' })} data-mode="draft" /> 초안</label>
          <label><span>끝 날짜(비우면 계속)</span> <input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} data-notice-end /></label>
        </div>
        <div className="acts" data-notice-grade-pick>
          <b>볼 수 있는 등급</b>
          {(grades.data ?? []).filter((g) => g.isActive).map((g) => (
            <label key={g.code} title={g.rule}><input type="checkbox" checked={pick.includes(g.code)} onChange={() => togglePick(g.code)} data-grade-pick={g.code} /> {g.name}</label>
          ))}
        </div>
        {/* v10.281 (D211) 새 공지 알림 */}
        <div className="acts">
          <label title={noAudience ? '「전체 공개」 · 「관리자」 등급 공지는 알림을 보내지 않습니다' : ''}>
            <input type="checkbox" checked={f.notify && !noAudience} disabled={noAudience} onChange={(e) => setF({ ...f, notify: e.target.checked })} data-notice-notify-pick /> 그 등급 회원에게 알림 보냄
          </label>
          {noAudience && pick.length > 0 && <span className="dim">— 「전체 공개」 · 「관리자」 등급 공지는 알림을 보내지 않습니다</span>}
        </div>
        <div className="acts">
          <button className="btn-ok" disabled={a.busy === 'notice'} onClick={() => void addNotice()} data-notice-submit>공지 등록</button>
        </div>
        <p className="hint">「예약」은 정한 시각(한국)에 저절로 게시되고, 「끝 날짜」가 지나면 저절로 내려갑니다. 「초안」은 이용자에게 보이지 않습니다(위 목록 「게시」로 나중에 게시). 알림은 「내 알림」으로 가며 받는 분이 끌 수 있습니다. 고른 등급 중 하나라도 맞는 사람만 봅니다 — 「관리자」만 고르면 운영 화면 첫 화면 「관리자 공지」에만 보이고 사용자 웹에는 나오지 않습니다.</p>
      </div>

      {/* v10.285 (D212) 공지 알림 기준 — 확인 문구 · 한 번에 보내는 수 */}
      <h3 className="ad-s2">공지 알림 기준</h3>
      <div className="card pad" data-notice-notify-limits>
        <div className="form-grid">
          {([['notice.notify_confirm_min', '확인 문구를 받는 기준(명 이상)'], ['notice.notify_batch', '한 번에 보내는 수(명) — 나머지는 10분마다']] as const).map(([k, label]) => (
            <label key={k}><span>{label}</span>
              <input inputMode="numeric" value={setVal(k)} onChange={(e) => setLim((p) => ({ ...p, [k]: e.target.value }))} data-notice-limit={k} />
              <button className="btn-sm" disabled={a.busy === `lim:${k}` || lim[k] === undefined} onClick={() => saveLim(k)}>저장</button>
            </label>))}
        </div>
        <p className="hint">받는 사람이 기준 이상이면 등록 · 게시 때 「모두에게 알림」을 입력해야 보냅니다. 다 보내면 운영 알림 「공지 알림 n명 보냄」(INFO)이 남습니다.</p>
      </div>

      {/* v10.279 (D210) 공지 등급 관리 — 코드 · 판단 규칙은 고정 */}
      <h3 className="ad-s2">공지 등급 관리</h3>
      {grades.error ? <ErrorView error={grades.error} onRetry={grades.reload} /> : (
        <table className="tbl" data-notice-grades-admin={(grades.data ?? []).length}>
          <thead><tr><th>순서</th><th>등급</th><th>코드</th><th>누가 보나(고정 규칙)</th><th>쓰인 공지</th><th>사용</th><th /></tr></thead>
          <tbody>
            {(grades.data ?? []).map((g) => (
              <tr key={g.code} data-notice-grade={g.code}>
                <td className="num-cell">{g.sortOrder}</td>
                <td><b>{g.name}</b></td>
                <td className="mono dim">{g.code}</td>
                <td className="dim">{g.rule}</td>
                <td className="num-cell">{g.notices}건</td>
                <td>{g.isActive ? '사용' : <span className="badge badge-urgent">쓰지 않음</span>}</td>
                <td>
                  <button className="btn-sm" disabled={a.busy === `grade:${g.code}`} onClick={() => editGrade(g, 'name')}>이름</button>{' '}
                  <button className="btn-sm" disabled={a.busy === `grade:${g.code}`} onClick={() => editGrade(g, 'sort')}>순서</button>{' '}
                  <button className="btn-sm" disabled={a.busy === `grade:${g.code}`} onClick={() => editGrade(g, 'active')} data-grade-toggle={g.code}>{g.isActive ? '끄기' : '켜기'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
