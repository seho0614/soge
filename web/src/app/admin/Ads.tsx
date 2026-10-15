import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { SubTabs, type SubTab } from '../../components/SubTabs';

/* 2026-10-02 — 서버 응답은 slot · regulated 입니다(실측).
 * 전에는 slotCode · isRegulated 로 읽어 슬롯이 전부 '—', 심의 필요가 한 건도 안 떴습니다. */
interface Creative {
  code: string; advertiser: string; category: string; title?: string;
  slot: string | null; status: string;
  regulated: boolean; reviewConfirmedAt: string | null;
  attributionEnabled?: boolean; segments?: string[];
}
interface Stat {
  creative_code: string; impressions: number; clicks: number; ctr: string | null;
}
interface Adv {
  id: string; code: string; name: string; status: string;
  contactPhone?: string | null; bookings?: number; billed?: number; collected?: number; unpaid?: number;
}

const ST: Record<string, string> = {
  ACTIVE: '노출 중', PAUSED: '중지', BLOCKED: '차단', DRAFT: '준비',
};
/* 슬롯 · 세그먼트 코드는 ad_slots · ad_segments 에 있고 목록 API 가 없어 여기 둡니다(보고서 참조) */
const SLOTS = ['HERO', 'ENTRY', 'FLOAT', 'RECS', 'INFEED', 'DTAIL', 'GHERO'];
const SEGS = ['SEG-A', 'SEG-B', 'SEG-C', 'SEG-D', 'SEG-E', 'SEG-F'];

type View = 'creatives' | 'advertisers' | 'internal';
const TABS: SubTab<View>[] = [
  { key: 'creatives', label: '소재 · 슬롯', screen: 'SB-ADM-ADS-010' },
  { key: 'advertisers', label: '광고주', screen: 'SB-ADS-PLT-010' },
  { key: 'internal', label: '플랫폼 연동 (내부)', screen: 'SB-ADM-ADS-020' },
];

/**
 * SB-ADM-ADS-010 광고 관리
 * SB-ADS-PLT-010 광고주 · 소재 관리
 * SB-ADM-ADS-020 광고 플랫폼 연동 (내부)
 *
 * 광고는 추천 순위에 섞이지 않고 별도 슬롯에만 나갑니다.
 * 노출 순위가 대가에 따른 것이면 표시해야 하는데(표시광고법),
 * 섞으면 표시로도 해결되지 않습니다 — 그래서 슬롯을 나눠 두었습니다.
 */
export function Ads() {
  const [view, setView] = useState<View>('creatives');
  return (
    <section>
      <SubTabs tabs={TABS} value={view} onChange={setView} />
      {view === 'creatives' && <Creatives />}
      {view === 'advertisers' && <Advertisers />}
      {view === 'internal' && <Internal />}
    </section>
  );
}

/* ── 소재 · 슬롯 (ADS-010 · PLT-010) ─────────────────────────────── */
interface SlotRow { code: string; name: string; placement: string; width: number | null; height: number | null; inRanking: boolean; isActive: boolean; current: string | null }

function Creatives() {
  const list = useApi<Creative[]>('/admin/ad-creatives');
  /* v10.31 (10/10 시안 기준 · scAdmAd) — 위 칩 「소재 · 슬롯 배치 · 타겟 매트릭스」, 줄마다 「중지」, 엔진 4칸 */
  const slotsApi = useApi<SlotRow[]>('/admin/ad-creatives/slots');
  const [chip, setChip] = useState<'c' | 's' | 'm'>('c');
  const stats = useApi<Stat[]>('/admin/ad-creatives/stats');
  const [edit, setEdit] = useState<string | null>(null);
  const [slot, setSlot] = useState<string>('');
  const [segs, setSegs] = useState<string[]>([]);
  const a = useAct();

  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  if (!list.data) return <p className="muted">불러오는 중…</p>;

  const rows = list.data;
  const pending = rows.filter((c) => c.regulated && !c.reviewConfirmedAt && c.status !== 'BLOCKED');
  const byCode = new Map((stats.data ?? []).map((s) => [s.creative_code, s]));

  const openEdit = (c: Creative) => {
    a.clear(); setEdit(edit === c.code ? null : c.code); setSlot(c.slot ?? ''); setSegs(c.segments ?? []);
  };
  const toggleStatus = (c: Creative) => a.run(`st-${c.code}`, () => api(`/admin/ad-creatives/${c.code}/status`, {
    method: 'PATCH', body: JSON.stringify({ status: c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }),
  }), list.reload, c.status === 'ACTIVE' ? `${c.code} 노출을 멈췄습니다.` : `${c.code} 를 다시 노출합니다.`);
  const assign = (code: string) => a.run(code, () => api(`/admin/ad-creatives/${code}/assign`, {
    method: 'POST', body: JSON.stringify({ slot: slot || null, segments: segs }),
  }), () => { setEdit(null); list.reload(); }, slot ? `${code} 를 ${slot} 에 배정했습니다.` : `${code} 배정을 풀었습니다.`);

  function confirmReview(code: string) {
    const reviewNo = prompt(`${code} 의 심의필 번호 — 발급처에서 조회한 번호를 적어 주십시오`) ?? '';
    if (!reviewNo.trim()) return;
    void a.run(code, () => api(`/admin/ad-creatives/${code}/review-confirm`, {
      method: 'POST', body: JSON.stringify({ reviewNo: reviewNo.trim() }),
    }), list.reload, '심의필을 확인했습니다. 이제 슬롯에 배정할 수 있습니다.');
  }

  /* 귀속을 켜면 그 광고주의 **그 광고 건에만** 적용됩니다. 다른 건은 딸려오지 않습니다. */
  function toggleAttr(code: string, enabled: boolean) {
    if (enabled && !confirm(
      `${code} 광고로 들어온 소개를 광고주에게 귀속하시겠습니까?\n\n` +
      '이 광고 건에만 적용됩니다. 소개자가 따로 연결한 건은 영향받지 않습니다.')) return;
    void a.run(code, () => api(`/admin/ad-creatives/${code}/attribution`, {
      method: 'PATCH', body: JSON.stringify({ enabled }),
    }), list.reload, enabled ? `${code} 귀속을 켰습니다.` : `${code} 귀속을 껐습니다.`);
  }

  const slotRows = slotsApi.data ?? [];
  const segUse = SEGS.map((g) => ({ g, items: rows.filter((c) => (c.segments ?? []).includes(g)) }));
  return (
    <>
      <div className="ad-flt" role="tablist" aria-label="광고 보기">
        {([['c', '소재', rows.length], ['s', '슬롯 배치', slotRows.length], ['m', '타겟 매트릭스', SEGS.length]] as const).map(([k, t, n]) => (
          <button key={k} role="tab" className={chip === k ? 'on' : ''} aria-selected={chip === k} onClick={() => setChip(k)} data-ad-chip={k}>{t}<i>{n}</i></button>
        ))}
      </div>
      {chip === 's' && (
        <div className="ad-tw"><table className="tbl" data-ad-slots>
          <thead><tr><th>슬롯</th><th>이름 · 위치</th><th>규격</th><th>지금 붙은 소재</th><th>순위 포함</th><th>사용</th></tr></thead>
          <tbody>{slotRows.map((x) => (
            <tr key={x.code}><td className="mono"><b>{x.code}</b></td><td>{x.name}<span className="ad-ls">{x.placement}</span></td>
              <td className="mono">{x.width && x.height ? `${x.width}×${x.height}` : '—'}</td><td className="mono">{x.current ?? '—'}</td>
              <td>{x.inRanking ? '예' : '아니오'}</td><td>{x.isActive ? '켬' : '끔'}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {chip === 'm' && (
        <div className="ad-tw"><table className="tbl" data-ad-matrix>
          <thead><tr><th>세그먼트</th>{SLOTS.map((x) => <th key={x} className="mono">{x}</th>)}<th className="num-cell">소재</th></tr></thead>
          <tbody>{segUse.map(({ g, items }) => (
            <tr key={g}><td className="mono"><b>{g}</b></td>
              {SLOTS.map((x) => <td key={x} className="mono">{items.filter((c) => c.slot === x).map((c) => c.code).join(' ') || '—'}</td>)}
              <td className="num-cell">{items.length}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {chip === 'c' && <>
      <h2>광고 소재 <em>{rows.length}</em></h2>
      {pending.length > 0 && (
        <p className="card warn">
          <b>심의 확인이 필요한 규제 소재 {pending.length}건.</b> 확인 전에는 어떤 슬롯에도 붙지 않습니다 — DB 가 막습니다.
        </p>
      )}
      <p className="card">
        <b>광고는 추천 순위에 끼지 않습니다.</b> 슬롯이 따로 있고, <code>ad_slots.in_ranking</code> 이 CHECK 로
        false 에 고정돼 있어 누가 바꾸려 해도 저장되지 않습니다.
      </p>
      <Flash msg={a.msg} err={a.err} />

      <table className="tbl">
        <thead>
          <tr><th>소재</th><th>광고주</th><th>분야</th><th>슬롯</th><th>세그먼트</th><th>상태</th><th>귀속</th><th>노출</th><th>클릭</th><th>처리</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const s = byCode.get(c.code);
            const needReview = c.regulated && !c.reviewConfirmedAt;
            return (
              <FragmentRow key={c.code}>
                <tr>
                  <td>
                    <b className="mono">{c.code}</b>
                    {needReview && <span className="badge badge-urgent"> 심의 필요</span>}
                    {c.title && <div className="dim">{c.title}</div>}
                  </td>
                  <td>{c.advertiser}</td>
                  <td className="muted">{c.category}</td>
                  <td className="mono">{c.slot ?? '—'}</td>
                  <td className="mono">{(c.segments ?? []).join(' ') || '—'}</td>
                  <td><span className={`badge ${c.status === 'ACTIVE' ? 'badge-verified' : 'badge-urgent'}`}>{ST[c.status] ?? c.status}</span></td>
                  {/* 광고 귀속(INV-AD12). 무엇이 켜져 있는지 모르면 소개자들이 이유 없이 손해를 봅니다. */}
                  <td>
                    <button className={`btn-sm ${c.attributionEnabled ? 'warn-text' : ''}`} disabled={a.busy === c.code}
                            title={c.attributionEnabled ? '이 광고로 들어온 소개가 광고주에게 귀속됩니다' : '광고 클릭은 귀속을 만들지 않습니다 (기본)'}
                            onClick={() => toggleAttr(c.code, !c.attributionEnabled)}>
                      {c.attributionEnabled ? '켜짐' : '꺼짐'}
                    </button>
                  </td>
                  <td className="num-cell">{n(s?.impressions)}</td>
                  <td className="num-cell">{n(s?.clicks)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {(c.status === 'ACTIVE' || c.status === 'PAUSED') && (
                      <button className="btn-sm" disabled={a.busy === `st-${c.code}`} onClick={() => void toggleStatus(c)} style={{ marginRight: 4 }}>
                        {c.status === 'ACTIVE' ? '중지' : '다시 노출'}</button>)}
                    {c.status === 'BLOCKED' && <span className="dim">규제 심사 대기</span>}
                    {needReview && c.status !== 'BLOCKED'
                      ? <button className="btn-sm" disabled={a.busy === c.code} onClick={() => confirmReview(c.code)}>심의필 확인</button>
                      : <button className="btn-sm" disabled={c.status === 'BLOCKED'} onClick={() => openEdit(c)}>
                          {edit === c.code ? '닫기' : '배정'}
                        </button>}
                  </td>
                </tr>
                {edit === c.code && (
                  <tr>
                    <td colSpan={10}>
                      <div className="form-grid">
                        <label><span>슬롯</span>
                          <select value={slot} onChange={(e) => setSlot(e.target.value)} aria-label="슬롯">
                            <option value="">배정 해제</option>
                            {SLOTS.map((x) => <option key={x} value={x}>{x}</option>)}
                          </select>
                        </label>
                        <div>
                          <span className="dim">세그먼트</span>
                          <div className="acts" style={{ marginTop: 4 }}>
                            {SEGS.map((x) => (
                              <label key={x} className="dim">
                                <input type="checkbox" checked={segs.includes(x)}
                                       onChange={(e) => setSegs((p) => e.target.checked ? [...p, x] : p.filter((y) => y !== x))} /> {x}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="acts">
                        <button className="btn-ok" disabled={a.busy === c.code} onClick={() => void assign(c.code)}>배정 저장</button>
                      </div>
                    </td>
                  </tr>
                )}
              </FragmentRow>
            );
          })}
        </tbody>
      </table>

      <p className="card warn">
        <b>대부 · 다단계는 등록 자체가 불가능합니다.</b> 의료는 심의필 번호를 확인한 뒤에만 슬롯에 붙습니다.
        번호만 받지 말고 발급처에서 조회하십시오 — 의료법 제27조 · 제56조는 과태료 대상입니다.
      </p>
      <p className="card"><b>광고주에게는 집계된 숫자만 갑니다.</b> 회원 식별자나 성향 분류는 전달되지 않습니다.</p>
      </>}
      <div className="ad-rw" data-engine>
        <div className="ad-rc"><span>엔진</span><b style={{ fontSize: 14 }}>지정 방식</b><small>점수도 경매도 없습니다 — 운영이 슬롯과 세그먼트를 직접 고릅니다.</small></div>
        <div className="ad-rc"><span>어떻게 계산하나</span><b style={{ fontSize: 14 }}>슬롯 1 · 세그먼트 여럿</b><small>회원의 성향과 겹치는 소재를 먼저 쓰고, 없으면 기본, 그것도 없으면 그 자리를 비웁니다.</small></div>
        <div className="ad-rc warn"><span>한계</span><b style={{ fontSize: 14 }}>빈도 조절 · 예산 소진 · 경매 없음</b><small>노출 · 클릭은 ad_events 에 서버가 셉니다. 과금은 광고 과금(기간 · 정액)으로 따로 합니다.</small></div>
        <div className="ad-rc"><span>다음 단계</span><b style={{ fontSize: 14 }}>슬롯 경매</b><small>카테고리 · 지역별 동적 단가로 갈 자리입니다. 그때는 노출 로그와 예산 차감이 서버에 먼저 있어야 합니다.</small></div>
      </div>
    </>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }

/* ── 광고주 (PLT-010) ────────────────────────────────────────────── */
function Advertisers() {
  const list = useApi<Adv[]>('/admin/advertisers');
  const [f, setF] = useState({ code: '', name: '', bizRegNo: '', contactPhone: '' });
  const a = useAct();

  const create = () => {
    if (!f.code.trim() || !f.name.trim()) { a.setErr('광고주 코드와 이름을 적어 주십시오.'); return; }
    void a.run('new', () => api('/admin/advertisers', {
      method: 'POST',
      body: JSON.stringify({
        code: f.code.trim(), name: f.name.trim(),
        bizRegNo: f.bizRegNo.trim() || undefined, contactPhone: f.contactPhone.trim() || undefined,
      }),
    }), () => { setF({ code: '', name: '', bizRegNo: '', contactPhone: '' }); list.reload(); }, '광고주를 등록했습니다.');
  };
  const setStatus = (v: Adv, status: string) => {
    if (status === 'BLOCKED' && !confirm(`${v.name} 을(를) 차단합니다.\n나가고 있는 광고도 함께 멈춥니다.`)) return;
    void a.run(v.id, () => api(`/admin/advertisers/${v.id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    }), list.reload, `${v.name} 상태를 바꿨습니다.`);
  };

  if (list.error) return <ErrorView error={list.error} onRetry={list.reload} />;
  const rows = list.data ?? [];

  return (
    <>
      <h2>광고주 <em>{rows.length}</em></h2>
      <p className="lead">광고주는 회원 계정과 별개입니다 — 대행사가 여러 광고주를 대신 집행하기도 합니다.</p>
      <Flash msg={a.msg} err={a.err} />
      {!list.data && <p className="muted">불러오는 중…</p>}
      {list.data && rows.length === 0 && <p className="muted">등록된 광고주가 없습니다. 아래에서 등록합니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>광고주</th><th>연락처</th><th>청구</th><th>미수</th><th>상태</th><th>처리</th></tr></thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td><b>{v.name}</b> <span className="mono">{v.code}</span></td>
                <td className="muted">{v.contactPhone ?? '—'}</td>
                <td className="num-cell">{n(v.billed)}원</td>
                <td className="num-cell">{Number(v.unpaid ?? 0) > 0 ? <b className="warn-text">{n(v.unpaid)}원</b> : '—'}</td>
                <td>{v.status === 'ACTIVE' ? '정상' : v.status === 'PAUSED' ? '중지' : '차단'}</td>
                <td>
                  <select className="sel" style={{ marginBottom: 0 }} value={v.status} disabled={a.busy === v.id}
                          aria-label={`${v.name} 상태`} onChange={(e) => setStatus(v, e.target.value)}>
                    <option value="ACTIVE">정상</option><option value="PAUSED">중지</option><option value="BLOCKED">차단</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="sec">광고주 등록</h3>
      <div className="card pad">
        <div className="form-grid">
          <label><span>코드</span><input value={f.code} placeholder="ADV-001" onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
          <label><span>이름</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label><span>사업자등록번호</span><input value={f.bizRegNo} placeholder="000-00-00000" onChange={(e) => setF({ ...f, bizRegNo: e.target.value })} /></label>
          <label><span>연락처</span><input value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></label>
        </div>
        <div className="acts"><button className="btn-ok" disabled={a.busy === 'new'} onClick={create}>등록</button></div>
      </div>
      <p className="card"><b>광고주를 차단하면 나가던 광고도 함께 멈춥니다.</b> 광고주는 막았는데 광고는 계속 나가면 막은 의미가 없습니다.</p>
    </>
  );
}

/* ── SB-ADM-ADS-020 광고 플랫폼 연동 (내부) ──────────────────────── */
function Internal() {
  const [acc, setAcc] = useState('');
  const [biz, setBiz] = useState('');
  const [res, setRes] = useState<Array<[string, string]>>([]);

  /* 이 두 API 는 분리된 광고 서비스(sgb-ads)가 **내부 키**로 부릅니다.
   * 사람 토큰으로는 막히는 것이 정상입니다 — 여기서는 그 차단이 살아 있는지 점검합니다. */
  /* 주소를 호출하는 쪽에 그대로 적습니다 — 매트릭스가 어떤 API 를 부르는지 읽을 수 있게 */
  async function probe(req: Promise<Response>, label: string) {
    const r = await req.catch(() => null);
    const body = r ? await r.json().catch(() => ({})) as { code?: string; message?: string } : {};
    const line = !r ? '응답 없음'
      : r.status === 403 && body.code === 'INTERNAL_KEY_INVALID' ? '정상 — 내부 키 없이 막힘 (403 INTERNAL_KEY_INVALID)'
      : r.ok ? '★ 내부 키 없이 열림 — 명부가 샙니다. 즉시 확인하십시오'
      : `${r.status} ${body.message ?? ''}`;
    setRes((p) => [[label, line] as [string, string], ...p].slice(0, 6));
  }

  return (
    <>
      <h2>광고 플랫폼 연동 (내부)</h2>
      <p className="lead">광고는 본체와 같은 DB 를 씁니다. 분리된 광고 서비스는 성향 · 사업자 실재를 본체에 물어봅니다.</p>
      <table className="tbl">
        <thead><tr><th>내부 API</th><th>무엇을 돌려주나</th><th>막는 것</th></tr></thead>
        <tbody>
          <tr><td className="mono">GET /internal/accounts/{'{id}'}/ad-profile</td><td>세그먼트 · 동의 여부 (동의 없으면 segment 가 null)</td><td>내부 키</td></tr>
          <tr><td className="mono">GET /internal/businesses/{'{id}'}</td><td>사업자 실재 · 휴폐업 여부</td><td>내부 키</td></tr>
        </tbody>
      </table>
      <p className="card">
        <b>성향과 사업자 실재는 본체가 정본입니다.</b> 광고 쪽에 복제하면 동의를 철회했는데 거기 남아 있는 일이
        생기고, 그건 INV-AD 위반입니다. 그래서 복제하지 않고 물어보게 합니다.
      </p>

      <h3 className="sec">차단 점검</h3>
      <p className="hint">운영자 토큰 없이 부릅니다. <b>403 INTERNAL_KEY_INVALID 가 나와야 정상입니다</b> — 열리면 id 를 바꿔 가며 회원 사업자 명부를 긁을 수 있습니다.</p>
      <div className="card pad">
        <div className="form-grid">
          <label><span>회원 id</span><input value={acc} onChange={(e) => setAcc(e.target.value)} placeholder="UUID" /></label>
          <label><span>사업자 id</span><input value={biz} onChange={(e) => setBiz(e.target.value)} placeholder="UUID" /></label>
        </div>
        <div className="acts">
          <button className="btn-plain" disabled={!acc.trim()} onClick={() => void probe(fetch(`/api/v1/internal/accounts/${encodeURIComponent(acc.trim())}/ad-profile`), '성향 조회')}>성향 조회 점검</button>
          <button className="btn-plain" disabled={!biz.trim()} onClick={() => void probe(fetch(`/api/v1/internal/businesses/${encodeURIComponent(biz.trim())}`), '사업자 확인')}>사업자 확인 점검</button>
        </div>
        {res.length > 0 && (
          <table className="tbl" style={{ marginTop: 12 }}>
            <tbody>{res.map(([l, r], i) => <tr key={i}><th>{l}</th><td>{r}</td></tr>)}</tbody>
          </table>
        )}
      </div>

      <h3 className="sec">분리할 시점</h3>
      <table className="tbl">
        <thead><tr><th>신호</th><th>무엇이 일어나나</th></tr></thead>
        <tbody>
          <tr><td>노출 하루 10만</td><td>DB 부하가 보이기 시작합니다</td></tr>
          <tr><td>소재 교체 주 3회</td><td>본체 배포와 부딪힙니다</td></tr>
          <tr><td>광고 담당이 따로</td><td>배포 권한이 갈립니다</td></tr>
        </tbody>
      </table>
    </>
  );
}
