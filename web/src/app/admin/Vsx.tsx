/* ===== v10.542 ~ 545 (D284 · docs/680 ~ 683) (54) 매물 · 파트너 — web/src/app/admin/Vsx.tsx 새 파일 =====
 *   VsxVisits     검수 › 매물 방문 예약 — 스위치 · 관별 스위치(SUPER · 처음 모두 꺼짐 · 대표 11/21) · 값 · 최근 30일 수 · 최근 예약 100(가린 이름 · 노쇼 횟수는 여기서만) · 정기 작업 지금 한 번(SUPER)
 *   VsxMap        검수 › 지도 매물 묶음 — 스위치(공개 API) · 격자 단계(법무 확인 뒤) · 최소 수 · 단계별 미리보기(꺼져 있어도)
 *   VsxPapiBill   파트너사 › 오픈 API 사용량 · 청구 — 과금 스위치 · 무료 · 단가 · 만드는 날 · 달별 파트너 사용량 · 초안 확정 · 무효(SUPER)
 *   VsxPtnExport  파트너사 › 파트너 자료 내려받기 — 스위치 · 최대 줄 · 내려받기 기록 · 승인 요청(승인은 위험감지 › 감사)
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md) · 기존 클래스(card · tbl · btn-sm · warn-text · muted)만 — 새 CSS 없음 · 어두운 테마 그대로
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { isSuperNow } from './OpsStaffBoxes';

const won = (v: unknown) => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));
const prevYm = () => { const d = new Date(Date.now() + 9 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

interface Settings { visitOn: boolean; visitGwans: string[]; slotDays: number; maxOpen: number; mapOn: boolean; mapGrid: boolean; mapMin: number; exportOn: boolean; exportMaxRows: number;
  billOn: boolean; billFreeCalls: number; billPrice1k: number; billDay: number }

/** 설정 한 줄 — 스위치 · 숫자 · 사유(SUPER 만 저장) */
function SettingsBox({ s, keys, onDone, tag }: { s: Settings; keys: Array<[keyof Settings, string, number?, number?]>; onDone: () => void; tag: string }) {
  const a = useAct();
  const [v, setV] = useState<Partial<Settings>>({});
  const [reason, setReason] = useState('');
  const sup = isSuperNow();
  const save = () => void a.run(`set${tag}`, () => api('/admin/vsx/settings', { method: 'PUT', body: JSON.stringify({ ...v, reason }) }), () => { setV({}); setReason(''); onDone(); });
  return (
    <div className="card" data-vsx-settings={tag}>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl"><tbody>
        {keys.map(([k, label, lo, hi]) => {
          const cur = (v[k] ?? s[k]) as boolean | number;
          return (
            <tr key={k}><td>{label}</td><td>
              {typeof s[k] === 'boolean'
                ? <label><input type="checkbox" disabled={!sup} checked={!!cur} onChange={(e) => setV({ ...v, [k]: e.target.checked } as Partial<Settings>)} /> {cur ? '켜짐' : '꺼짐'}</label>
                : <input type="number" disabled={!sup} min={lo} max={hi} value={Number(cur)} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) } as Partial<Settings>)} style={{ width: 120 }} />}
            </td></tr>
          );
        })}
      </tbody></table>
      {sup ? (
        <p>
          <input placeholder="사유(2 ~ 200자 · 설정 바뀜 기록)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 320 }} />{' '}
          <button className="btn-sm" disabled={!Object.keys(v).length || reason.trim().length < 2 || a.busy === `set${tag}`} onClick={save} data-vsx-save={tag}>저장</button>
        </p>
      ) : <p className="muted">설정은 SUPER 만 바꿉니다.</p>}
    </div>
  );
}

/* ── 매물 방문 예약 ── */
interface VisitView { settings: Settings; gwans: Array<{ code: string; name: string; on: boolean }>; summary30: Record<string, number>;
  recent: Array<{ id: string; state: string; cancelBy: string | null; createdAt: string; startsAt: string; title: string; gwanCode: string; visitor: string; noshow180: number }>; note: string }

/** 관별 스위치 — 방문 예약을 쓰는 관(vsx.gwans) · SUPER 만 저장 · 사유 */
function GwanBox({ gwans, onDone }: { gwans: VisitView['gwans']; onDone: () => void }) {
  const a = useAct();
  const [on, setOn] = useState<string[] | null>(null);
  const [reason, setReason] = useState('');
  const sup = isSuperNow();
  const cur = on ?? gwans.filter((g) => g.on).map((g) => g.code);
  const save = () => void a.run('gw', () => api('/admin/vsx/settings', { method: 'PUT', body: JSON.stringify({ visitGwans: cur, reason }) }), () => { setOn(null); setReason(''); onDone(); });
  return (
    <div className="card" data-vsx-gwans={cur.length}>
      <Flash msg={a.msg} err={a.err} />
      <p>관별 방문 예약(vsx.gwans · 처음 모두 꺼짐) — 꺼진 관 매물은 칸 열기 · 예약을 서버와 DB 가 막습니다.</p>
      <p>{gwans.map((g) => (
        <label key={g.code} style={{ marginRight: 12 }}>
          <input type="checkbox" disabled={!sup} checked={cur.includes(g.code)} data-vsx-gwan={g.code}
            onChange={(e) => setOn(e.target.checked ? [...cur, g.code] : cur.filter((x) => x !== g.code))} /> {g.name}({g.code})
        </label>
      ))}</p>
      {sup ? (
        <p>
          <input placeholder="사유(2 ~ 200자 · 설정 바뀜 기록)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 320 }} />{' '}
          <button className="btn-sm" disabled={on === null || reason.trim().length < 2 || a.busy === 'gw'} onClick={save} data-vsx-gwan-save="">관별 저장</button>
        </p>
      ) : <p className="muted">관별 설정은 SUPER 만 바꿉니다.</p>}
    </div>
  );
}
const V_KO: Record<string, string> = { REQUESTED: '요청', CONFIRMED: '확정', CANCELLED: '취소', NOSHOW: '노쇼', DONE: '방문 끝' };

export function VsxVisits() {
  const v = useApi<VisitView>('/admin/vsx/visits');
  const a = useAct();
  const d = v.data;
  if (!d) return <section data-vsx-visits="">{v.error ? <p className="warn-text">읽지 못했습니다.</p> : '…'}</section>;
  const s = d.summary30;
  return (
    <section data-vsx-visits={d.recent.length}>
      <Flash msg={a.msg} err={a.err} />
      <p className={d.settings.visitOn ? '' : 'warn-text'} data-vsx-visit-switch={d.settings.visitOn ? 'on' : 'off'}>
        {d.settings.visitOn ? '방문 예약 켜짐 — 매물 주인이 칸을 열고 회원이 고릅니다.' : '방문 예약 꺼짐(처음) — 켜기 전까지 매물 상세 · 나의공간에 아무것도 보이지 않습니다.'}
      </p>
      <GwanBox gwans={d.gwans} onDone={v.reload} />
      <SettingsBox s={d.settings} tag="visit" onDone={v.reload} keys={[['visitOn', '방문 예약(vsx.enabled)'], ['slotDays', '칸을 열 수 있는 앞 날 수', 1, 90], ['maxOpen', '매물 하나 앞 칸 수', 1, 200]]} />
      <p>최근 30일 — 요청 {won(s.requested)} · 확정 {won(s.confirmed)} · 취소 {won(s.cancelled)}(저절로 {won(s.expired)}) · 노쇼 {won(s.noshow)} · 방문 끝 {won(s.done)} · 열린 앞 칸 {won(s.openSlots)}
        {isSuperNow() && <>{' '}<button className="btn-sm" disabled={a.busy === 'run'} onClick={() => void a.run('run', () => api<{ on?: boolean; expired?: number; reminded?: number }>('/admin/vsx/visits/run', { method: 'POST' }), v.reload,
          (r) => (r?.on === false ? '꺼져 있어 아무것도 하지 않았습니다.' : `저절로 취소 ${r?.expired ?? 0} · 전날 알림 ${r?.reminded ?? 0}`))}>정기 작업 지금 한 번</button></>}
      </p>
      <table className="tbl" data-vsx-visit-list={d.recent.length}><thead><tr><th>번호</th><th>매물</th><th>관</th><th>방문</th><th>회원</th><th>노쇼(180일 · 운영만)</th><th>상태</th><th>요청한 때</th></tr></thead><tbody>
        {d.recent.length === 0 ? <tr><td colSpan={8} className="muted">아직 방문 예약이 없습니다.</td></tr> : d.recent.map((r) => (
          <tr key={r.id}><td>{r.id}</td><td>{r.title}</td><td>{r.gwanCode}</td><td>{ymdhm(r.startsAt)}</td><td>{r.visitor}</td><td>{r.noshow180 > 0 ? <span className="warn-text">{r.noshow180}</span> : 0}</td>
            <td>{V_KO[r.state] ?? r.state}{r.state === 'CANCELLED' && r.cancelBy ? `(${r.cancelBy === 'SYSTEM' ? '저절로' : r.cancelBy === 'OWNER' ? '주인' : '회원'})` : ''}</td><td>{ymdhm(r.createdAt)}</td></tr>
        ))}
      </tbody></table>
      <p className="muted">{d.note}</p>
    </section>
  );
}

/* ── 지도 매물 묶음 ── */
interface MapItem { key: string; label: string; lat: number | null; lng: number | null; n: number }
interface MapView { settings: Settings; map: { enabled: boolean }; preview: { mode: string; level: number; items: MapItem[]; total: number; merged: number; note: string } }

export function VsxMap() {
  const [level, setLevel] = useState(8);
  const v = useApi<MapView>(`/admin/vsx/map?level=${level}`, [level]);
  const d = v.data;
  if (!d) return <section data-vsx-map="">{v.error ? <p className="warn-text">읽지 못했습니다.</p> : '…'}</section>;
  return (
    <section data-vsx-map={d.preview.mode}>
      <p className={d.settings.mapOn ? '' : 'warn-text'} data-vsx-map-switch={d.settings.mapOn ? 'on' : 'off'}>
        {d.settings.mapOn ? '공개 API(GET /listings/map/clusters) 켜짐.' : '공개 API 꺼짐(처음) — 아래는 운영 미리보기입니다.'}
        {' '}지도 사용 · 카카오 키 {d.map.enabled ? '있음' : '없음 → 공개 API 는 좌표 없이 시 · 구 목록만'}
      </p>
      <SettingsBox s={d.settings} tag="map" onDone={v.reload} keys={[['mapOn', '지도 묶음 공개 API(map.cluster_enabled)'], ['mapGrid', '격자 단계(map.cluster_grid · 법무 확인 뒤)'], ['mapMin', '격자 최소 매물 수', 2, 20]]} />
      <p>
        <label>지도 단계 <input type="number" min={1} max={14} value={level} onChange={(e) => setLevel(Math.min(14, Math.max(1, Number(e.target.value) || 8)))} style={{ width: 80 }} /></label>
        {' '}<span className="muted">10 ~ 14 시 · 도 · 7 ~ 9 시 · 구 · 1 ~ 6 격자(켰을 때 · 화면 범위가 있을 때) — 미리보기는 화면 범위 없이 셈</span>
      </p>
      <p data-vsx-map-mode={d.preview.mode}>방식 {d.preview.mode} · 묶음 {d.preview.items.length} · 매물 {won(d.preview.total)} · {d.preview.note}</p>
      <table className="tbl"><thead><tr><th>묶음</th><th>가운데</th><th>매물 수</th></tr></thead><tbody>
        {d.preview.items.slice(0, 100).map((x) => <tr key={x.key}><td>{x.label || x.key}</td><td>{x.lat == null ? '—' : `${x.lat}, ${x.lng}`}</td><td>{won(x.n)}</td></tr>)}
      </tbody></table>
      <p className="muted">공개 결과에는 묶음 가운데 · 수만 실립니다(매물 id · 제목 · 주소 · 매물 좌표 없음 · 결정 map-kakao #3).</p>
    </section>
  );
}

/* ── 오픈 API 사용량 · 청구 ── */
interface Est { billable: number; supply: number; vat: number; sum: number }
interface UsageRow { partnerId: string; company: string; ok: number; free: number; err: number; keys: number; madeAt: string; estimate: Est }
interface Draft { id: string; company: string; ym: string; callsTotal: number; freeCalls: number; callsBillable: number; price1k: number; supply: number; vat: number; total: number;
  state: string; madeAt: string; remadeAt: string | null; confirmedAt: string | null; confirmedBy: string | null; voidAt: string | null; voidReason: string | null }
interface UsageView { ym: string; settings: Settings; items: UsageRow[]; drafts: Draft[]; note: string }
const B_KO: Record<string, string> = { DRAFT: '초안', CONFIRMED: '확정', VOID: '무효' };

export function VsxPapiBill() {
  const [ym, setYm] = useState(prevYm());
  const v = useApi<UsageView>(`/admin/vsx/papi-usage?ym=${ym}`, [ym]);
  const a = useAct();
  const d = v.data;
  const sup = isSuperNow();
  const confirmBill = (b: Draft) => {
    const w = prompt(`${b.company} ${b.ym} 청구서 ${won(b.total)}원(부가세 포함)을 확정합니다. 확정 뒤에는 무효로만 바꿉니다. 「확정」을 적으십시오.`);
    if (w) void a.run(`c${b.id}`, () => api(`/admin/vsx/papi-bills/${b.id}/confirm`, { method: 'POST', body: JSON.stringify({ confirm: w }) }), v.reload);
  };
  const voidBill = (b: Draft) => {
    const r = prompt('무효 사유(2 ~ 200자)');
    if (r) void a.run(`v${b.id}`, () => api(`/admin/vsx/papi-bills/${b.id}/void`, { method: 'POST', body: JSON.stringify({ reason: r }) }), v.reload);
  };
  return (
    <section data-vsx-papi-bill={d ? d.items.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      <p>
        <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} aria-label="달" />{' '}
        {sup && <button className="btn-sm" disabled={a.busy === 'run'} onClick={() => void a.run('run', () => api<{ bill?: { made?: number; remade?: number } }>('/admin/vsx/papi-usage/run', { method: 'POST', body: JSON.stringify({ ym }) }), v.reload,
          (r) => `모았습니다 · 초안 새로 ${r?.bill?.made ?? 0} · 다시 셈 ${r?.bill?.remade ?? 0}`)} data-vsx-bill-run="">이 달 다시 모으기 · 초안 다시 셈</button>}
      </p>
      {d && (
        <>
          <p className={d.settings.billOn ? '' : 'warn-text'} data-vsx-bill-switch={d.settings.billOn ? 'on' : 'off'}>
            {d.settings.billOn ? `과금 켜짐 — 매달 ${d.settings.billDay}일부터 지난달 초안을 만듭니다.` : '과금 꺼짐(처음) — 하루 사용량은 모으지만 초안은 만들지 않습니다(위 단추로 사람이 만들 수는 있음).'}
          </p>
          <SettingsBox s={d.settings} tag="bill" onDone={v.reload} keys={[['billOn', '월 청구서 초안(papi.bill_enabled)'], ['billFreeCalls', '달 무료 호출 수', 0, 10000000], ['billPrice1k', '1,000건 단가(원 · 부가세 별도)', 0, 100000], ['billDay', '초안 만드는 날', 1, 28]]} />
          <h4>{d.ym} 파트너별 사용량</h4>
          <table className="tbl" data-vsx-usage={d.items.length}><thead><tr><th>회사</th><th>과금 대상</th><th>안내</th><th>오류</th><th>키</th><th>지금 값으로 예상(공급가 + 부가세)</th></tr></thead><tbody>
            {d.items.length === 0 ? <tr><td colSpan={6} className="muted">이 달 사용량이 없습니다.</td></tr> : d.items.map((r) => (
              <tr key={r.partnerId}><td>{r.company}</td><td>{won(r.ok)}</td><td>{won(r.free)}</td><td>{won(r.err)}</td><td>{r.keys}</td>
                <td>{r.estimate.billable > 0 ? `${won(r.estimate.supply)} + ${won(r.estimate.vat)} = ${won(r.estimate.sum)}원` : '무료 안'}</td></tr>
            ))}
          </tbody></table>
          <h4>청구서 초안</h4>
          <table className="tbl" data-vsx-drafts={d.drafts.length}><thead><tr><th>회사</th><th>과금 건수</th><th>단가</th><th>공급가</th><th>부가세</th><th>합계</th><th>상태</th><th /></tr></thead><tbody>
            {d.drafts.length === 0 ? <tr><td colSpan={8} className="muted">초안이 없습니다.</td></tr> : d.drafts.map((b) => (
              <tr key={b.id}><td>{b.company}</td><td>{won(b.callsBillable)} / {won(b.callsTotal)}</td><td>{won(b.price1k)}</td><td>{won(b.supply)}</td><td>{won(b.vat)}</td><td>{won(b.total)}</td>
                <td>{B_KO[b.state] ?? b.state}{b.confirmedAt ? ` · ${ymdhm(b.confirmedAt)} ${b.confirmedBy ?? ''}` : ''}{b.voidReason ? ` · ${b.voidReason}` : ''}</td>
                <td>{sup && b.state === 'DRAFT' && <button className="btn-sm" disabled={a.busy === `c${b.id}`} onClick={() => confirmBill(b)}>확정</button>}
                  {sup && b.state !== 'VOID' && <>{' '}<button className="btn-sm" disabled={a.busy === `v${b.id}`} onClick={() => voidBill(b)}>무효</button></>}</td></tr>
            ))}
          </tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── 파트너 자료 내려받기 ── */
interface ExpView { settings: { exportOn: boolean; exportMaxRows: number }; logs: Array<{ id: string; kind: string; rows: number; from: string | null; to: string | null; ticket: string | null; at: string; company: string }>;
  requests: Array<{ id: string; reason: string; state: string; requestedAt: string; decidedAt: string | null; usedAt: string | null }>; note: string }
const R_KO: Record<string, string> = { PENDING: '승인 기다림', APPROVED: '승인', REJECTED: '거절' };

export function VsxPtnExport() {
  const v = useApi<ExpView>('/admin/vsx/ptn-exports');
  const s = useApi<{ settings: Settings }>('/admin/vsx/map');
  const d = v.data;
  return (
    <section data-vsx-ptn-export={d ? d.logs.length : ''}>
      {d && (
        <>
          <p className={d.settings.exportOn ? '' : 'warn-text'} data-vsx-export-switch={d.settings.exportOn ? 'on' : 'off'}>
            {d.settings.exportOn ? '파트너센터 자료 내려받기 켜짐.' : '파트너센터 자료 내려받기 꺼짐(처음).'}
          </p>
          {s.data && <SettingsBox s={s.data.settings} tag="export" onDone={() => { v.reload(); s.reload(); }} keys={[['exportOn', '파트너 자료 내려받기(ptn.export_enabled)'], ['exportMaxRows', '리드 CSV 최대 줄', 100, 20000]]} />}
          <h4>승인 요청(리드 CSV)</h4>
          <table className="tbl"><thead><tr><th>번호</th><th>사유</th><th>상태</th><th>요청</th><th>결정</th><th>받음</th></tr></thead><tbody>
            {d.requests.length === 0 ? <tr><td colSpan={6} className="muted">요청이 없습니다.</td></tr> : d.requests.map((r) => (
              <tr key={r.id}><td>{r.id}</td><td>{r.reason}</td><td>{R_KO[r.state] ?? r.state}</td><td>{ymdhm(r.requestedAt)}</td><td>{ymdhm(r.decidedAt)}</td><td>{ymdhm(r.usedAt)}</td></tr>
            ))}
          </tbody></table>
          <h4>내려받기 기록</h4>
          <table className="tbl" data-vsx-export-logs={d.logs.length}><thead><tr><th>때</th><th>회사</th><th>종류</th><th>줄</th><th>기간</th><th>승인 번호</th></tr></thead><tbody>
            {d.logs.length === 0 ? <tr><td colSpan={6} className="muted">기록이 없습니다.</td></tr> : d.logs.map((x) => (
              <tr key={x.id}><td>{ymdhm(x.at)}</td><td>{x.company}</td><td>{x.kind === 'LEADS' ? '리드' : '성과'}</td><td>{won(x.rows)}</td><td>{x.from ?? '—'} ~ {x.to ?? '—'}</td><td>{x.ticket ?? '—'}</td></tr>
            ))}
          </tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}
