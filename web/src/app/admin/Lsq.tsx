/* ===== v10.602 ~ 608 (docs/744 ~ 750) 17차 매물 · 소개몰 — web/src/app/admin/Lsq.tsx 새 파일 =====
 *   LsqBulk        검수 › 매물 일괄 등록 — 스위치 · 줄 수 · 최근 30일 묶음 · 등록 매물 상태 · 최근 묶음 50(가린 이름)
 *   LsqReviewAsk   검수 › 거래 후기 요청 — 스위치 · 며칠 뒤 · 다시 묻기 · 요청 · 전환 · 날마다 · 하루 일 지금 한 번(SUPER)
 *   LsqSearchClick 검수 › 검색 클릭 분석 — 스위치 · 보관 · 낱말 100 · 순위 분포 · 많이 눌린 매물(누가 눌렀는지 없음)
 *   LsqRegion      검수 › 지역별 소개 페이지 — 스위치 · 문턱 · 공개될 지역 수 · 지역 표
 *   LsqSubRetry    소개몰 › 정기 배송 결제 다시 시도 — 스위치 · 간격표 · 실패 중 · 지금 다시 결제(운영)
 *   LsqTrack       소개몰 › 배송 추적 — 스위치 · 방식(ASSUME · LIVE) · 배송 완료 반영 · 준비 상태 · 최근 조회 · 주문 하나 단계 · 지금 한 번(SUPER)
 *   LsqReturnEv    소개몰 › 반품 사진 · 판정 — 스위치 · 장수 · 신청 목록 · 사진(기존 파일 열기) · 판정 기록 · 검수 판정 · 메모 · 사진 가리기
 * (adminMenu · App.tsx 연결 줄은 patches/1_lsq_wiring.md) · 기존 클래스(card · tbl · btn-sm · warn-text · muted)만 — 새 CSS 없음 · 인라인은 폭 · 허용 글자 크기만
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { isSuperNow } from './OpsStaffBoxes';

const num = (v: unknown) => (v == null || v === '' ? '—' : Number(v).toLocaleString('ko-KR'));

interface Settings {
  bulkOn: boolean; bulkMaxRows: number; reviewAskOn: boolean; reviewAskDays: number; reviewAskAgain: number;
  searchClickOn: boolean; searchClickKeepDays: number; regionOn: boolean; regionMin: number;
  subRetryOn: boolean; subRetryDays: number[]; trackOn: boolean; trackMode: string; trackAutoDeliver: boolean;
  returnPhotosOn: boolean; returnPhotoMax: number;
}
type Key = Exclude<keyof Settings, 'subRetryDays' | 'trackMode'>;

/** 설정 한 상자 — 스위치 · 숫자 · 사유(SUPER 만 저장 · 보낸 칸만) */
function SettingsBox({ s, keys, onDone, tag }: { s: Settings; keys: Array<[Key, string, number?, number?]>; onDone: () => void; tag: string }) {
  const a = useAct();
  const [v, setV] = useState<Partial<Settings>>({});
  const [reason, setReason] = useState('');
  const sup = isSuperNow();
  const save = () => void a.run(`set${tag}`, () => api('/admin/lsq/settings', { method: 'PUT', body: JSON.stringify({ ...v, reason }) }), () => { setV({}); setReason(''); onDone(); });
  return (
    <div className="card" data-lsq-settings={tag}>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl"><tbody>
        {keys.map(([k, label, lo, hi]) => {
          const cur = (v[k] ?? s[k]) as boolean | number;
          return (
            <tr key={k}><td>{label}</td><td>
              {typeof s[k] === 'boolean'
                ? <label><input type="checkbox" disabled={!sup} checked={!!cur} onChange={(e) => setV({ ...v, [k]: e.target.checked } as Partial<Settings>)} data-lsq-switch={k} /> {cur ? '켜짐' : '꺼짐'}</label>
                : <input type="number" disabled={!sup} min={lo} max={hi} value={Number(cur)} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) } as Partial<Settings>)} style={{ width: 120 }} />}
            </td></tr>
          );
        })}
        {tag === 'sub' && (
          <tr><td>다시 시도 간격표(실패 차례마다 며칠 뒤 · 1 ~ 14 · 다섯 칸까지)</td><td>
            <input disabled={!sup} defaultValue={s.subRetryDays.join(',')} style={{ width: 120 }} data-lsq-sub-days=""
              onChange={(e) => setV({ ...v, subRetryDays: e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0) })} />
          </td></tr>
        )}
        {tag === 'track' && (
          <tr><td>방식(lsq.track_mode)</td><td>
            <select disabled={!sup} value={v.trackMode ?? s.trackMode} onChange={(e) => setV({ ...v, trackMode: e.target.value })} data-lsq-track-mode="">
              <option value="ASSUME">ASSUME — 간주(밖으로 부르지 않음)</option><option value="LIVE">LIVE — 택배사 조회(키 필요)</option>
            </select>
          </td></tr>
        )}
      </tbody></table>
      {sup ? (
        <p>
          <input placeholder="사유(2 ~ 200자 · 설정 바뀜 기록)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 320 }} />{' '}
          <button className="btn-sm" disabled={!Object.keys(v).length || reason.trim().length < 2 || a.busy === `set${tag}`} onClick={save} data-lsq-save={tag}>저장</button>
        </p>
      ) : <p className="muted">설정은 SUPER 만 바꿉니다.</p>}
    </div>
  );
}

const Wait = ({ v, tag }: { v: { error?: unknown }; tag: string }) => <section data-lsq-tab={tag}>{v.error ? <p className="warn-text">읽지 못했습니다.</p> : '…'}</section>;

/* ── v10.602 매물 일괄 등록 ── */
interface BulkView { settings: Settings; summary30: Record<string, number>; recent: Array<{ id: string; state: string; member: string; rows: number; valid: number; made: number; failed: number; createdAt: string }>; note: string }
const JOB_KO: Record<string, string> = { PREVIEW: '미리보기', DONE: '확정', EXPIRED: '기한 지남' };
export function LsqBulk() {
  const v = useApi<BulkView>('/admin/lsq/bulk');
  const d = v.data;
  if (!d) return <Wait v={v} tag="bulk" />;
  const s = d.summary30;
  return (
    <section data-lsq-tab="bulk" data-lsq-bulk={d.recent.length}>
      <p className={d.settings.bulkOn ? '' : 'warn-text'}>{d.settings.bulkOn ? '일괄 등록 켜짐 — 회원이 나의공간 › 내 매물 › 일괄 등록에서 CSV 를 올립니다.' : '일괄 등록 꺼짐(처음) — 회원 화면에 「준비 중」만 보입니다.'}</p>
      <SettingsBox s={d.settings} tag="bulk" onDone={v.reload} keys={[['bulkOn', '매물 일괄 등록(lsq.bulk)'], ['bulkMaxRows', '한 번에 받는 줄 수', 10, 200]]} />
      <p>최근 30일 — 묶음 {num(s.jobs)}(확정 {num(s.done)}) · 줄 {num(s.rows)} · 등록 {num(s.made)} · 실패 {num(s.failed)} · 등록 매물: 검수 대기 {num(s.inReview)} · 게시 {num(s.published)} · 반려 {num(s.rejected)}</p>
      <table className="tbl"><thead><tr><th>번호</th><th>회원</th><th>상태</th><th>줄</th><th>등록 가능</th><th>등록</th><th>실패</th><th>올린 때</th></tr></thead><tbody>
        {d.recent.length === 0 ? <tr><td colSpan={8} className="muted">아직 일괄 등록이 없습니다.</td></tr> : d.recent.map((r) => (
          <tr key={r.id}><td>{r.id}</td><td>{r.member}</td><td>{JOB_KO[r.state] ?? r.state}</td><td>{r.rows}</td><td>{r.valid}</td><td>{r.made}</td><td>{r.failed}</td><td>{ymdhm(r.createdAt)}</td></tr>
        ))}
      </tbody></table>
      <p className="muted">{d.note}</p>
    </section>
  );
}

/* ── v10.603 거래 후기 요청 ── */
interface AskView { settings: Settings; summary30: Record<string, number | string | null>; daily: Array<{ day: string; asked: number; reviewed: number }>; note: string }
export function LsqReviewAsk() {
  const v = useApi<AskView>('/admin/lsq/review-asks');
  const a = useAct();
  const d = v.data;
  if (!d) return <Wait v={v} tag="review" />;
  const s = d.summary30;
  return (
    <section data-lsq-tab="review" data-lsq-review={d.daily.length}>
      <Flash msg={a.msg} err={a.err} />
      <SettingsBox s={d.settings} tag="review" onDone={v.reload} keys={[['reviewAskOn', '성사 뒤 후기 요청(lsq.review_ask)'], ['reviewAskDays', '성사 확정 뒤 며칠', 1, 14], ['reviewAskAgain', '처음 요청 뒤 며칠 지나 한 번 더(0 = 없음)', 0, 30]]} />
      <p>최근 30일 — 성사 {num(s.confirmed)} · 요청 {num(s.asked)}(다시 {num(s.again)}) · 요청 뒤 후기 {num(s.reviewed)}({s.reviewedPct ?? '—'}% · 평균 {s.avgDays ?? '—'}일) · 전체 후기 {num(s.reviews)}
        {isSuperNow() && <>{' '}<button className="btn-sm" disabled={a.busy === 'run'} onClick={() => void a.run('run', () => api<{ review?: { asked: number; again: number } }>('/admin/lsq/daily/run', { method: 'POST' }), v.reload,
          (r) => `후기 요청 ${r?.review?.asked ?? 0} · 다시 ${r?.review?.again ?? 0}`)} data-lsq-daily-run="">하루 일 지금 한 번</button></>}</p>
      <table className="tbl"><thead><tr><th>날</th><th>요청</th><th>후기 씀</th></tr></thead><tbody>
        {d.daily.length === 0 ? <tr><td colSpan={3} className="muted">아직 요청이 없습니다.</td></tr> : d.daily.map((r) => <tr key={r.day}><td>{r.day}</td><td>{r.asked}</td><td>{r.reviewed}</td></tr>)}
      </tbody></table>
      <p className="muted">{d.note}</p>
    </section>
  );
}

/* ── v10.604 검색 클릭 분석 ── */
interface ClickView { settings: Settings; days: number; summary: { clicks: number; terms: number; avgPos: string | null; top3Pct: string | null };
  terms: Array<{ term: string; clicks: number; avgPos: string | null; top3Pct: string | null; searches: number | null }>; positions: Array<{ pos: string; clicks: number }>;
  items: Array<{ listingId: string; title: string; gwanCode: string; clicks: number; terms: string | null }>; note: string }
export function LsqSearchClick() {
  const [days, setDays] = useState('7');
  const v = useApi<ClickView>(`/admin/lsq/search-clicks?days=${days}`);
  const d = v.data;
  if (!d) return <Wait v={v} tag="click" />;
  return (
    <section data-lsq-tab="click" data-lsq-click={d.summary.clicks}>
      <SettingsBox s={d.settings} tag="click" onDone={v.reload} keys={[['searchClickOn', '검색 클릭 분석(lsq.search_click)'], ['searchClickKeepDays', '보관 일수', 30, 730]]} />
      <p>{['1', '7', '30', '90'].map((x) => <button key={x} className={`btn-sm${x === days ? '' : ' btn-plain'}`} onClick={() => setDays(x)}>{x}일</button>)}
        {' '}클릭 {num(d.summary.clicks)} · 낱말 {num(d.summary.terms)} · 평균 순위 {d.summary.avgPos ?? '—'} · 1 ~ 3위 {d.summary.top3Pct ?? '—'}%</p>
      <p className="muted">순위 분포 — {d.positions.map((p) => `${p.pos}위 ${p.clicks}`).join(' · ') || '없음'}</p>
      <table className="tbl"><thead><tr><th>낱말</th><th>클릭</th><th>평균 순위</th><th>1 ~ 3위</th><th>검색(누적)</th></tr></thead><tbody>
        {d.terms.length === 0 ? <tr><td colSpan={5} className="muted">아직 클릭이 없습니다.</td></tr> : d.terms.map((r) => (
          <tr key={r.term}><td>{r.term}</td><td>{r.clicks}</td><td>{r.avgPos ?? '—'}</td><td>{r.top3Pct ?? '—'}%</td><td>{num(r.searches)}</td></tr>
        ))}
      </tbody></table>
      <table className="tbl"><thead><tr><th>많이 눌린 매물</th><th>관</th><th>클릭</th><th>많은 낱말</th></tr></thead><tbody>
        {d.items.map((r) => <tr key={r.listingId}><td>{r.title}</td><td>{r.gwanCode}</td><td>{r.clicks}</td><td>{r.terms ?? ''}</td></tr>)}
      </tbody></table>
      <p className="muted">{d.note}</p>
    </section>
  );
}

/* ── v10.605 지역별 소개 페이지 ── */
interface RegionView { settings: Settings; pages: { sidos: number; sigungus: number; below: number; noRegion: number }; rows: Array<{ sido: string; sigungu: string | null; n: number; open: boolean }>; note: string }
export function LsqRegion() {
  const v = useApi<RegionView>('/admin/lsq/regions');
  const d = v.data;
  if (!d) return <Wait v={v} tag="region" />;
  return (
    <section data-lsq-tab="region" data-lsq-region={d.pages.sidos}>
      <p className={d.settings.regionOn ? '' : 'warn-text'}>{d.settings.regionOn ? '지역 페이지 켜짐 — 사용자 웹 /area 와 사이트 지도에 지역 주소가 나갑니다.' : '지역 페이지 꺼짐(처음) — /area 는 「준비 중」 · 사이트 지도에 지역 주소 없음.'}</p>
      <SettingsBox s={d.settings} tag="region" onDone={v.reload} keys={[['regionOn', '지역별 소개 페이지(lsq.region_pages)'], ['regionMin', '지역 페이지 최소 매물 수', 1, 50]]} />
      <p>공개될 시 · 도 {d.pages.sidos} · 시 · 군 · 구 {d.pages.sigungus} · 문턱 아래 {d.pages.below} · 지역 모름 매물 {d.pages.noRegion}</p>
      <table className="tbl"><thead><tr><th>시 · 도</th><th>시 · 군 · 구</th><th>게시 매물</th><th>페이지</th></tr></thead><tbody>
        {d.rows.map((r) => <tr key={`${r.sido}|${r.sigungu ?? ''}`}><td>{r.sido}</td><td>{r.sigungu ?? '—'}</td><td>{r.n}</td><td>{r.open ? '공개' : '문턱 아래'}</td></tr>)}
      </tbody></table>
      <p className="muted">{d.note}</p>
    </section>
  );
}

/* ── v10.606 정기 배송 결제 다시 시도 ── */
interface SubView { settings: Settings; subscribe: { on: boolean; mode: string };
  failing: Array<{ id: string; state: string; failCount: number; nextOn: string; productName: string; member: string; lastReason: string | null }>;
  fails: Array<{ subId: string; day: string; attempt: number; reason: string | null; nextTryOn: string | null; paused: boolean; notified: boolean }>;
  log: Array<{ subId: string; who: string; result: string; detail: string | null; createdAt: string }>; note: string }
export function LsqSubRetry() {
  const v = useApi<SubView>('/admin/lsq/sub-retry');
  const a = useAct();
  const d = v.data;
  if (!d) return <Wait v={v} tag="sub" />;
  return (
    <section data-lsq-tab="sub" data-lsq-sub={d.failing.length}>
      <Flash msg={a.msg} err={a.err} />
      <p className="muted">정기 배송 {d.subscribe.on ? '켜짐' : '꺼짐'} · 청구 방식 {d.subscribe.mode}{d.subscribe.mode === 'ASSUME' ? '(간주 — 결제대행사를 부르지 않음)' : ''}</p>
      <SettingsBox s={d.settings} tag="sub" onDone={v.reload} keys={[['subRetryOn', '결제 실패 다시 시도 간격 · 회원 알림 · 지금 다시 결제(lsq.sub_retry)']]} />
      <table className="tbl"><thead><tr><th>번호</th><th>회원</th><th>상품</th><th>상태</th><th>실패</th><th>다음 결제일</th><th>마지막 사유</th><th></th></tr></thead><tbody>
        {d.failing.length === 0 ? <tr><td colSpan={8} className="muted">결제가 실패한 정기 배송이 없습니다.</td></tr> : d.failing.map((r) => (
          <tr key={r.id}><td>{r.id}</td><td>{r.member}</td><td>{r.productName}</td><td>{r.state === 'PAUSED' ? '멈춤' : '진행'}</td><td>{r.failCount}</td><td>{r.nextOn}</td><td>{r.lastReason ?? '—'}</td>
            <td><button className="btn-sm" disabled={a.busy === r.id} onClick={() => void a.run(r.id, () => api(`/admin/lsq/sub-retry/${r.id}/run`, { method: 'POST' }), v.reload)} data-lsq-sub-run={r.id}>지금 다시 결제</button></td></tr>
        ))}
      </tbody></table>
      <p className="muted">최근 실패 — {d.fails.slice(0, 10).map((f) => `${f.subId}번 ${f.day} ${f.attempt}차${f.paused ? ' 멈춤' : f.nextTryOn ? ` → ${f.nextTryOn}` : ''}`).join(' · ') || '없음'}</p>
      <p className="muted">지금 다시 기록 — {d.log.slice(0, 10).map((l) => `${l.subId}번 ${l.who === 'MEMBER' ? '회원' : '운영'} ${l.result}`).join(' · ') || '없음'}</p>
      <p className="muted">{d.note}</p>
    </section>
  );
}

/* ── v10.607 배송 추적 ── */
interface TrackView { settings: Settings; ready: { mode: string; keySet: boolean; notReady: boolean }; counts: Record<string, number>;
  recent: Array<{ orderNo: string; status: string; trackingNo: string; polls: number; polledAt: string | null; lastStatus: string | null; lastError: string | null; deliveredAppliedAt: string | null }>; note: string }
const TS_KO: Record<string, string> = { PICKED: '집화', IN_TRANSIT: '이동 중', OUT_FOR_DELIVERY: '배송 출발', DELIVERED: '배송 완료', FAILED: '배송 문제', UNKNOWN: '확인 중' };
export function LsqTrack() {
  const v = useApi<TrackView>('/admin/lsq/tracking');
  const a = useAct();
  const [no, setNo] = useState('');
  const [ev, setEv] = useState<{ orderNo: string; events: Array<{ status: string; place: string | null; at: string; source: string }> } | null>(null);
  const d = v.data;
  if (!d) return <Wait v={v} tag="track" />;
  const c = d.counts;
  return (
    <section data-lsq-tab="track" data-lsq-track-mode={d.ready.mode}>
      <Flash msg={a.msg} err={a.err} />
      {d.ready.notReady && <p className="warn-text">LIVE 인데 택배사 조회 키 · 주소가 없습니다 — 외부 연동 › 연동 키(CARRIER_TRACK_KEY)를 넣거나 ASSUME 으로 두십시오.</p>}
      <SettingsBox s={d.settings} tag="track" onDone={v.reload} keys={[['trackOn', '배송 추적(lsq.track)'], ['trackAutoDeliver', '택배사 「배송 완료」를 주문에 넣기(LIVE 만 · lsq.track_auto_deliver)']]} />
      <p>배송중 {num(c.shipping)} · 24시간 조회 {num(c.polled24h)} · 단계 {num(c.events24h)} · 오류 {num(c.errors)} · 30일 배송 완료 반영 {num(c.delivered30)} · 키 {d.ready.keySet ? '있음' : '없음'}
        {isSuperNow() && <>{' '}<button className="btn-sm" disabled={a.busy === 'run'} onClick={() => void a.run('run', () => api<{ polled: number; events: number }>('/admin/lsq/tracking/run', { method: 'POST' }), v.reload,
          (r) => `조회 ${r?.polled ?? 0} · 새 단계 ${r?.events ?? 0}`)} data-lsq-track-run="">지금 한 번</button></>}</p>
      <p><input placeholder="주문 번호" value={no} onChange={(e) => setNo(e.target.value)} style={{ width: 200 }} />{' '}
        <button className="btn-sm" disabled={!no.trim()} onClick={() => void a.run('one', () => api<NonNullable<typeof ev>>(`/admin/lsq/tracking/orders/${encodeURIComponent(no.trim())}`).then((r) => { setEv(r); return r; }), undefined, (r) => `단계 ${r?.events.length ?? 0}`)}>단계 보기</button></p>
      {ev && <ul data-lsq-track-events={ev.events.length}>{ev.events.map((e, i) => <li key={i}>{ymdhm(e.at)} · {TS_KO[e.status] ?? e.status} · {e.place ?? ''}{e.source === 'ASSUME' ? ' (간주)' : ''}</li>)}</ul>}
      <table className="tbl"><thead><tr><th>주문</th><th>상태</th><th>송장</th><th>조회</th><th>마지막</th><th>단계</th><th>오류</th><th>배송 완료 반영</th></tr></thead><tbody>
        {d.recent.length === 0 ? <tr><td colSpan={8} className="muted">아직 조회한 주문이 없습니다.</td></tr> : d.recent.map((r) => (
          <tr key={r.orderNo}><td>{r.orderNo}</td><td>{r.status}</td><td>{r.trackingNo}</td><td>{r.polls}</td><td>{ymdhm(r.polledAt)}</td><td>{TS_KO[r.lastStatus ?? ''] ?? r.lastStatus ?? '—'}</td><td>{r.lastError ?? ''}</td><td>{ymdhm(r.deliveredAppliedAt)}</td></tr>
        ))}
      </tbody></table>
      <p className="muted">{d.note}</p>
    </section>
  );
}

/* ── v10.608 반품 사진 · 판정 ── */
interface RetList { settings: Settings; conditions: string[]; faults: string[];
  items: Array<{ id: string; kind: string; state: string; reason: string; orderNo: string; sellerType: string; member: string; createdAt: string; photos: number; inspections: number }>; note: string }
interface RetOne { returnId: string; state: string; photos: Array<{ id: string; side: string; note: string | null; hidden: boolean; fileId?: string }>;
  verdicts: Array<{ id: string; kind: string; side: string; fromState: string | null; toState: string | null; condition: string | null; fault: string | null; note: string | null; visibleToBuyer: boolean; createdAt: string }> }
const COND_KO: Record<string, string> = { UNOPENED: '뜯지 않음', OPENED: '개봉', USED: '사용함', DAMAGED: '훼손', MISSING: '구성품 빠짐', WRONG_ITEM: '다른 상품' };
const FAULT_KO: Record<string, string> = { BUYER: '회원', SELLER: '판매자', CARRIER: '택배사', UNKNOWN: '알 수 없음' };
const SIDE_KO: Record<string, string> = { BUYER: '회원', SELLER: '판매자', ADMIN: '운영', SYSTEM: '자동' };
const RST_KO: Record<string, string> = { REQUESTED: '접수', APPROVED: '승인', REJECTED: '반려', REFUNDED: '환불' };
const KIND_KO: Record<string, string> = { CANCEL: '취소', RETURN: '반품', EXCHANGE: '교환', STATE: '상태', INSPECT: '검수', NOTE: '메모' };
const openFile = (fid: string) => void api<{ url?: string }>(`/files/${fid}?disposition=inline`).then((r) => { if (r.url) window.open(r.url, '_blank', 'noopener'); }).catch(() => undefined);

function RetDetail({ id, onDone }: { id: string; onDone: () => void }) {
  const v = useApi<RetOne>(`/admin/lsq/returns/${id}`);
  const a = useAct();
  const [kind, setKind] = useState<'INSPECT' | 'NOTE'>('INSPECT');
  const [cond, setCond] = useState('OPENED');
  const [fault, setFault] = useState('UNKNOWN');
  const [note, setNote] = useState('');
  const [visible, setVisible] = useState(true);
  const d = v.data;
  if (!d) return <div className="card">…</div>;
  const done = () => { v.reload(); onDone(); };
  return (
    <div className="card" data-lsq-ret-detail={id}>
      <Flash msg={a.msg} err={a.err} />
      <p>사진 {d.photos.length}장 — {d.photos.map((p, i) => (
        <span key={p.id}>
          <button className={`btn-sm${p.hidden ? ' btn-plain' : ''}`} onClick={() => p.fileId && openFile(p.fileId)} data-lsq-ret-photo={p.id}>{SIDE_KO[p.side] ?? p.side} {i + 1}{p.hidden ? '(가림)' : ''}</button>
          {!p.hidden && <button className="btn-sm btn-plain" disabled={a.busy === `h${p.id}`} onClick={() => void a.run(`h${p.id}`, () => api(`/admin/lsq/returns/${id}/photos/${p.id}/hide`, { method: 'POST' }), done)}>가리기</button>}{' '}
        </span>))}{!d.photos.length && <span className="muted">없음</span>}</p>
      <table className="tbl"><thead><tr><th>때</th><th>기록</th><th>누가</th><th>내용</th><th>회원</th></tr></thead><tbody>
        {d.verdicts.map((x) => (
          <tr key={x.id}><td>{ymdhm(x.createdAt)}</td><td>{KIND_KO[x.kind] ?? x.kind}</td><td>{SIDE_KO[x.side] ?? x.side}</td>
            <td>{[x.toState ? `${x.fromState ? `${RST_KO[x.fromState] ?? x.fromState} → ` : ''}${RST_KO[x.toState] ?? x.toState}` : null,
              x.condition ? `상태 ${COND_KO[x.condition] ?? x.condition}` : null, x.fault ? `책임 ${FAULT_KO[x.fault] ?? x.fault}` : null, x.note].filter(Boolean).join(' · ')}</td>
            <td>{x.visibleToBuyer ? '보임' : '안 보임'}</td></tr>
        ))}
      </tbody></table>
      <p>
        <select value={kind} onChange={(e) => setKind(e.target.value as 'INSPECT' | 'NOTE')}><option value="INSPECT">검수 판정</option><option value="NOTE">메모</option></select>{' '}
        {kind === 'INSPECT' && <>
          <select value={cond} onChange={(e) => setCond(e.target.value)}>{Object.entries(COND_KO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{' '}
          <select value={fault} onChange={(e) => setFault(e.target.value)}>{Object.entries(FAULT_KO).map(([k, l]) => <option key={k} value={k}>책임 {l}</option>)}</select>{' '}
        </>}
        <input placeholder="메모(500자)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} style={{ width: 260 }} />{' '}
        <label><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> 회원에게 보임</label>{' '}
        <button className="btn-sm" disabled={a.busy === 'v' || (kind === 'NOTE' && note.trim().length < 2)} data-lsq-ret-verdict=""
          onClick={() => void a.run('v', () => api(`/admin/lsq/returns/${id}/verdicts`, { method: 'POST', body: JSON.stringify({ kind, condition: kind === 'INSPECT' ? cond : undefined, fault: kind === 'INSPECT' ? fault : undefined, note: note.trim() || undefined, visibleToBuyer: visible }) }), () => { setNote(''); done(); })}>남기기</button>
      </p>
      <p className="muted">승인 · 반려 · 환불은 소개몰 › 주문 › 취소 · 반품에서 그대로 합니다(상태 바뀜은 자동으로 기록).</p>
    </div>
  );
}

export function LsqReturnEv() {
  const [state, setState] = useState('');
  const v = useApi<RetList>(`/admin/lsq/returns${state ? `?state=${state}` : ''}`);
  const [open, setOpen] = useState<string | null>(null);
  const d = v.data;
  if (!d) return <Wait v={v} tag="ret" />;
  return (
    <section data-lsq-tab="ret" data-lsq-ret={d.items.length}>
      <SettingsBox s={d.settings} tag="ret" onDone={v.reload} keys={[['returnPhotosOn', '반품 사진 · 판매자 판정(lsq.return_photos)'], ['returnPhotoMax', '한쪽 최대 장수', 1, 10]]} />
      <p>{['', 'REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED'].map((x) => <button key={x} className={`btn-sm${x === state ? '' : ' btn-plain'}`} onClick={() => setState(x)}>{x ? RST_KO[x] : '전체'}</button>)}</p>
      <table className="tbl"><thead><tr><th>주문</th><th>종류</th><th>상태</th><th>판매</th><th>회원</th><th>사진</th><th>검수 기록</th><th>신청</th><th></th></tr></thead><tbody>
        {d.items.length === 0 ? <tr><td colSpan={9} className="muted">신청이 없습니다.</td></tr> : d.items.map((r) => (
          <tr key={r.id}><td>{r.orderNo}</td><td>{KIND_KO[r.kind] ?? r.kind}</td><td>{RST_KO[r.state] ?? r.state}</td><td>{r.sellerType === 'DIRECT' ? '직판' : '입점'}</td><td>{r.member}</td><td>{r.photos}</td><td>{r.inspections}</td><td>{ymdhm(r.createdAt)}</td>
            <td><button className="btn-sm" onClick={() => setOpen(open === r.id ? null : r.id)} data-lsq-ret-open={r.id}>{open === r.id ? '접기' : '자세히'}</button></td></tr>
        ))}
      </tbody></table>
      {open && <RetDetail key={open} id={open} onDone={v.reload} />}
      <p className="muted">{d.note}</p>
    </section>
  );
}
