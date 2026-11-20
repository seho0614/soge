/* ===== v10.538 ~ 541 (D283 · docs/676 ~ 679) (53) 회원 · 소개몰 — web/src/app/admin/Mkx.tsx 새 파일 =====
 * 대표 11/20 「(53)」 — 「주문 받기」가 꺼진 지금은 운영 화면 관리부터(회원 화면은 나의공간 › 웹 푸시 · 소개몰 공동구매 목록만).
 *   MkxPush      회원 › 웹 푸시 — 스위치 · 방식 · 키(만들기 SUPER) · 구독 수 · 7일 결과 · 최근 기록 · 지금 한 번 보내기
 *   MkxSms       회원 › 문자 마케팅 — 소개몰 대상 수 · 7일 상한 · 문자 캠페인 바이트 · 예상 비용 · 080 수신 거부 붙여 넣기 · 웹훅 토큰(SUPER)
 *   MkxRebuy     소개몰 › 재구매 알림 — 규칙(상품 · 사용 일수 · 며칠 전) · 14일 안 알릴 줄 · 기록 · 지금 한 번
 *   MkxGroupbuy  소개몰 › 공동구매 — 초안 만들기 · 열기 · 취소(사유) · 참여자 · 지금 한 번 처리
 * 스위치 · 상한 · 단가는 정책 › 전체 설정(push.* · mkx.*)에서 바꿈(사유 · 바뀐 기록) · 색 · 글자는 기존 클래스(tbl · btn-sm · warn-text · muted)만 — 어두운 테마 그대로
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

const won = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));
const ST_PUSH: Record<string, string> = { SENT: '보냄', ASSUMED: '간주', FAILED: '실패', GONE: '없어진 기기', SKIPPED: '건너뜀' };

/* ── ① 웹 푸시 ── */
interface PushView {
  settings: { enabled: boolean; send: boolean; mode: string; subject: string; dailyMax: number; quiet: boolean; pwa: boolean };
  keys: { publicSet: boolean; privateSet: boolean; publicKey: string | null; tag: string | null }; ready: boolean; missing: string[];
  counts: { active: number; members: number; gone: number; off: number }; week: Array<{ state: string; n: number }>; reasons: Array<{ reason: string; n: number }>;
  recent: Array<{ id: string; at: string; state: string; reason: string | null; status: number | null; test: boolean; name: string | null; event: string | null; ua: string | null }>;
  canKeys: boolean; note: string;
}
export function MkxPush() {
  const v = useApi<PushView>('/admin/mkx/push');
  const a = useAct();
  const d = v.data;
  const keys = (force: boolean) => (!force || confirm('키를 바꾸면 켜져 있던 모든 기기가 꺼지고 회원이 다시 켜야 합니다. 바꿀까요?'))
    && void a.run('keys', () => api('/admin/mkx/push/keys', { method: 'POST', body: JSON.stringify({ force }) }), v.reload);
  return (
    <section data-mkx-push={d ? (d.settings.send ? 'on' : 'off') : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className={d.settings.enabled && d.settings.send ? '' : 'warn-text'}>
            구독 받기 {d.settings.enabled ? '켜짐' : '꺼짐(push.enabled)'} · 보내기 {d.settings.send ? '켜짐' : '꺼짐(push.send)'} · 방식 <b data-mkx-push-mode={d.settings.mode}>{d.settings.mode}</b>
            {' '}· 앱처럼 설치 {d.settings.pwa ? '켜짐' : '꺼짐(site.pwa — 서비스 워커 없음)'} · 밤 쉬기 {d.settings.quiet ? '켜짐' : '꺼짐'} · 회원 하루 {d.settings.dailyMax}통
          </p>
          <table className="tbl"><tbody>
            <tr><th>VAPID 키</th><td>{d.keys.publicSet && d.keys.privateSet ? <>있음 <span className="muted">(…{d.keys.tag})</span></> : <span className="warn-text">없음</span>}</td>
              <th>보낸 곳 연락처</th><td>{d.settings.subject || <span className="warn-text">없음(push.vapid_subject)</span>}</td>
              <th>LIVE 준비</th><td>{d.ready ? '됨' : <span className="warn-text">안 됨 — {d.missing.join(' · ')}</span>}</td></tr>
            <tr><th>켠 기기</th><td className="num">{won(d.counts.active)}대 · 회원 {won(d.counts.members)}명</td><th>없어진 · 끈 기기</th><td className="num">{won(d.counts.gone)} · {won(d.counts.off)}</td>
              <th>7일</th><td>{d.week.map((w) => `${ST_PUSH[w.state] ?? w.state} ${w.n}`).join(' · ') || '없음'}</td></tr>
          </tbody></table>
          <p>
            {d.canKeys && !(d.keys.publicSet && d.keys.privateSet) && <button className="btn-sm" disabled={a.busy === 'keys'} onClick={() => keys(false)} data-mkx-push-keys="">키 만들기</button>}{' '}
            {d.canKeys && d.keys.publicSet && <button className="btn-sm btn-plain" disabled={a.busy === 'keys'} onClick={() => keys(true)}>키 새로 만들기</button>}{' '}
            <button className="btn-sm btn-plain" disabled={a.busy === 'run' || !d.settings.send} onClick={() => void a.run('run', () => api('/admin/mkx/push/run', { method: 'POST' }), v.reload)}>지금 한 번 보내기</button>
          </p>
          {d.reasons.length > 0 && <p className="muted">7일 못 보낸 까닭 — {d.reasons.map((r) => `${r.reason} ${r.n}`).join(' · ')}</p>}
          <table className="tbl"><thead><tr><th>때</th><th>회원</th><th>알림 종류</th><th>기기</th><th>결과</th></tr></thead>
            <tbody>{d.recent.map((r) => (
              <tr key={r.id}><td>{ymdhm(r.at)}</td><td>{r.name ?? '—'}</td><td>{r.test ? '시험' : r.event ?? '—'}</td><td>{r.ua ?? '—'}</td>
                <td>{ST_PUSH[r.state] ?? r.state}{r.reason ? <span className="muted"> {r.reason}</span> : null}{r.status ? <span className="muted"> {r.status}</span> : null}</td></tr>))}
              {d.recent.length === 0 && <tr><td colSpan={5} className="muted">보낸 기록이 없습니다.</td></tr>}
            </tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── ② 재구매 알림 ── */
interface RebuyView {
  settings: { on: boolean; dailyMax: number; lateDays: number }; night: boolean; today: string;
  rules: Array<{ code: string; name: string; status: string; useDays: number; beforeDays: number; active: boolean; memo: string | null; next14: number; sent30: number }>;
  counts: { due: number; sent30: number; skipped30: number }; reasons: Array<{ reason: string; n: number }>;
  recent: Array<{ id: string; at: string; state: string; reason: string | null; dueOn: string; notifyOn: string; code: string; product: string; name: string | null }>; note: string;
}
const RB_WHY: Record<string, string> = { NO_CONSENT: '광고 동의 없음', REBOUGHT: '이미 다시 삼', NOT_ON_SALE: '판매 중 아님', INACTIVE: '쓰지 않는 계정', TOO_LATE: '너무 늦음', OPTED_OUT: '알림 끔' };
export function MkxRebuy() {
  const v = useApi<RebuyView>('/admin/mkx/rebuy');
  const a = useAct();
  const [f, setF] = useState({ code: '', useDays: '30', beforeDays: '7' });
  const d = v.data;
  const save = (code: string, useDays: number, beforeDays: number, active: boolean) =>
    void a.run(`r${code}`, () => api(`/admin/mkx/rebuy/rules/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify({ useDays, beforeDays, active }) }), v.reload);
  return (
    <section data-mkx-rebuy={d ? (d.settings.on ? 'on' : 'off') : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className={d.settings.on ? '' : 'warn-text'}>재구매 알림 {d.settings.on ? '켜짐' : '꺼짐(mkx.rebuy)'} · 하루 {won(d.settings.dailyMax)}통 · 늦게 보내기 {d.settings.lateDays}일까지
            {' '}· 지금 알릴 줄 {won(d.counts.due)} · 30일 보냄 {won(d.counts.sent30)} · 건너뜀 {won(d.counts.skipped30)}{d.night ? ' · 지금은 밤(21 ~ 8시)이라 보내지 않음' : ''}</p>
          <p>
            <input placeholder="상품 코드" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.trim() })} aria-label="상품 코드" />{' '}
            <label>사용 일수 <input type="number" min={7} max={730} value={f.useDays} onChange={(e) => setF({ ...f, useDays: e.target.value })} /></label>{' '}
            <label>며칠 전 <input type="number" min={0} max={60} value={f.beforeDays} onChange={(e) => setF({ ...f, beforeDays: e.target.value })} /></label>{' '}
            <button className="btn-sm" disabled={!f.code || a.busy === `r${f.code}`} onClick={() => save(f.code, Number(f.useDays), Number(f.beforeDays), true)} data-mkx-rebuy-save="">규칙 저장</button>{' '}
            <button className="btn-sm btn-plain" disabled={a.busy === 'run' || !d.settings.on || d.night} onClick={() => void a.run('run', () => api('/admin/mkx/rebuy/run', { method: 'POST' }), v.reload)}>지금 한 번</button>
          </p>
          <p className="muted">개월 옵션(1 · 3 · 6개월 분)이 있는 상품은 개월 × 30일이 먼저이고, 사용 일수는 개월이 없는 옵션에 씁니다. 수량만큼 곱합니다.</p>
          <table className="tbl"><thead><tr><th>상품</th><th className="num">사용 일수</th><th className="num">며칠 전</th><th>켜짐</th><th className="num">14일 안</th><th className="num">30일 보냄</th><th /></tr></thead>
            <tbody>{d.rules.map((r) => (
              <tr key={r.code} data-mkx-rebuy-rule={r.code}>
                <td>{r.name} <span className="muted">{r.code}{r.status !== 'ON_SALE' ? ` · ${r.status}` : ''}</span></td>
                <td className="num">{r.useDays}</td><td className="num">{r.beforeDays}</td><td>{r.active ? '켜짐' : '꺼짐'}</td><td className="num">{won(r.next14)}</td><td className="num">{won(r.sent30)}</td>
                <td>
                  <button className="btn-sm btn-plain" onClick={() => save(r.code, r.useDays, r.beforeDays, !r.active)}>{r.active ? '끄기' : '켜기'}</button>{' '}
                  <button className="btn-sm btn-plain" onClick={() => confirm(`${r.name} 규칙을 지웁니다.`) && void a.run(`d${r.code}`, () => api(`/admin/mkx/rebuy/rules/${encodeURIComponent(r.code)}`, { method: 'DELETE' }), v.reload)}>지우기</button>
                </td>
              </tr>))}
              {d.rules.length === 0 && <tr><td colSpan={7} className="muted">규칙이 없습니다 — 위에서 상품 코드와 사용 일수를 넣으십시오.</td></tr>}
            </tbody></table>
          {d.reasons.length > 0 && <p className="muted">30일 건너뜀 — {d.reasons.map((r) => `${RB_WHY[r.reason] ?? r.reason} ${r.n}`).join(' · ')}</p>}
          <table className="tbl"><thead><tr><th>때</th><th>회원</th><th>상품</th><th>다 쓰는 날 · 알릴 날</th><th>결과</th></tr></thead>
            <tbody>{d.recent.map((r) => (
              <tr key={r.id}><td>{ymdhm(r.at)}</td><td>{r.name ?? '—'}</td><td>{r.product}</td><td>{r.dueOn} · {r.notifyOn}</td>
                <td>{r.state === 'SENT' ? '보냄' : `건너뜀 · ${RB_WHY[r.reason ?? ''] ?? r.reason}`}</td></tr>))}
              {d.recent.length === 0 && <tr><td colSpan={5} className="muted">기록이 없습니다.</td></tr>}
            </tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── ③ 공동구매 ── */
interface GbItem { id: string; title: string; state: string; listPrice: number; dealPrice: number; targetCount: number; maxCount: number | null; perMemberMax: number; endsAt: string;
  code: string; name: string; optionLabel: string; paid: number; taken: number; cancelFiled: number; cancelOpen: number; cancelReason: string | null }
interface GbView { on: boolean; orderOpen: boolean; items: GbItem[]; products: Array<{ code: string; name: string; optionId: string; optionLabel: string; price: number; stock: number }>; states: Record<string, string>; note: string }
interface GbJoins { id: string; title: string; rows: Array<{ id: string; name: string | null; orderNo: string; status: string; paid: boolean; qty: number; total: number; returnState: string | null }> }
export function MkxGroupbuy() {
  const v = useApi<GbView>('/admin/mkx/groupbuys');
  const a = useAct();
  const [f, setF] = useState({ opt: '', title: '', dealPrice: '', targetCount: '10', maxCount: '', perMemberMax: '1', endsAt: '' });
  const [joins, setJoins] = useState<GbJoins | null>(null);
  const d = v.data;
  const create = () => {
    const p = d?.products.find((x) => x.optionId === f.opt);
    if (!p) return a.setErr('상품 옵션을 고르십시오.');
    const body: Record<string, unknown> = { productCode: p.code, optionId: p.optionId, title: f.title, dealPrice: Number(f.dealPrice), targetCount: Number(f.targetCount),
      perMemberMax: Number(f.perMemberMax), endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : '' };
    if (f.maxCount) body.maxCount = Number(f.maxCount);
    void a.run('new', () => api('/admin/mkx/groupbuys', { method: 'POST', body: JSON.stringify(body) }), v.reload);
  };
  const cancel = (g: GbItem) => {
    const reason = prompt(`「${g.title}」을(를) 취소합니다. 연 공동구매면 참여 주문마다 취소 신청이 들어갑니다. 사유(2자 이상):`, '');
    if (reason && reason.trim().length >= 2) void a.run(`c${g.id}`, () => api(`/admin/mkx/groupbuys/${g.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }), v.reload);
  };
  const showJoins = async (id: string) => { try { setJoins(await api<GbJoins>(`/admin/mkx/groupbuys/${id}/joins`)); } catch { a.setErr('참여자를 읽지 못했습니다.'); } };
  return (
    <section data-mkx-groupbuy={d ? (d.on ? 'on' : 'off') : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className={d.on && d.orderOpen ? '' : 'warn-text'}>공동구매 {d.on ? '켜짐' : '꺼짐(mkx.groupbuy)'} · 주문 받기 {d.orderOpen ? '켜짐' : '꺼짐(mall.order_open — 회원이 참여할 수 없음)'}{' '}
            <button className="btn-sm btn-plain" disabled={a.busy === 'run'} onClick={() => void a.run('run', () => api('/admin/mkx/groupbuys/run', { method: 'POST' }), v.reload)}>지금 한 번 처리</button></p>
          <p>
            <select value={f.opt} onChange={(e) => setF({ ...f, opt: e.target.value })} aria-label="상품 옵션">
              <option value="">직판 상품 옵션 고르기</option>
              {d.products.map((p) => <option key={p.optionId} value={p.optionId}>{p.name} · {p.optionLabel} · {won(p.price)}원 · 재고 {p.stock}</option>)}
            </select>{' '}
            <input placeholder="이름" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="공동구매 이름" />{' '}
            <label>할인가 <input type="number" min={1} value={f.dealPrice} onChange={(e) => setF({ ...f, dealPrice: e.target.value })} /></label>{' '}
            <label>목표 <input type="number" min={2} value={f.targetCount} onChange={(e) => setF({ ...f, targetCount: e.target.value })} /></label>{' '}
            <label>최대 <input type="number" min={2} value={f.maxCount} onChange={(e) => setF({ ...f, maxCount: e.target.value })} /></label>{' '}
            <label>한 분 <input type="number" min={1} max={10} value={f.perMemberMax} onChange={(e) => setF({ ...f, perMemberMax: e.target.value })} /></label>{' '}
            <label>기한 <input type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></label>{' '}
            <button className="btn-sm" disabled={a.busy === 'new'} onClick={create} data-mkx-gb-new="">초안 만들기</button>
          </p>
          <table className="tbl"><thead><tr><th>공동구매</th><th>상태</th><th className="num">정가 → 할인가</th><th className="num">결제 / 목표</th><th className="num">자리</th><th>기한</th><th>취소 신청</th><th /></tr></thead>
            <tbody>{d.items.map((g) => (
              <tr key={g.id} data-mkx-gb-row={g.state}>
                <td>{g.title} <span className="muted">{g.name} · {g.optionLabel}</span></td>
                <td>{d.states[g.state] ?? g.state}{g.cancelReason ? <span className="muted"> {g.cancelReason}</span> : null}</td>
                <td className="num">{won(g.listPrice)} → <b>{won(g.dealPrice)}</b></td>
                <td className="num">{g.paid} / {g.targetCount}</td><td className="num">{g.taken}{g.maxCount ? ` / ${g.maxCount}` : ''}</td><td>{ymdhm(g.endsAt)}</td>
                <td>{g.cancelFiled ? `${g.cancelFiled}건(처리 대기 ${g.cancelOpen})` : '—'}</td>
                <td>
                  {g.state === 'DRAFT' && <button className="btn-sm" disabled={!d.on || a.busy === `o${g.id}`} onClick={() => void a.run(`o${g.id}`, () => api(`/admin/mkx/groupbuys/${g.id}/open`, { method: 'POST' }), v.reload)}>열기</button>}{' '}
                  {['DRAFT', 'OPEN', 'SUCCESS'].includes(g.state) && <button className="btn-sm btn-plain" onClick={() => cancel(g)}>취소</button>}{' '}
                  {g.state !== 'DRAFT' && <button className="btn-sm btn-plain" onClick={() => void showJoins(g.id)}>참여자</button>}
                </td>
              </tr>))}
              {d.items.length === 0 && <tr><td colSpan={8} className="muted">공동구매가 없습니다.</td></tr>}
            </tbody></table>
          {joins && (
            <>
              <h3>참여자 — {joins.title} <button className="btn-sm btn-plain" onClick={() => setJoins(null)}>닫기</button></h3>
              <table className="tbl"><thead><tr><th>회원</th><th>주문</th><th>상태</th><th className="num">수량</th><th className="num">금액</th><th>취소 신청</th></tr></thead>
                <tbody>{joins.rows.map((r) => (
                  <tr key={r.id}><td>{r.name ?? '—'}</td><td>{r.orderNo}</td><td>{r.status}{r.paid ? ' · 결제' : ' · 결제 전'}</td><td className="num">{r.qty}</td><td className="num">{won(r.total)}</td><td>{r.returnState ?? '—'}</td></tr>))}
                  {joins.rows.length === 0 && <tr><td colSpan={6} className="muted">참여자가 없습니다.</td></tr>}
                </tbody></table>
            </>
          )}
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── ④ 문자 마케팅 ── */
interface SmsView {
  settings: { weeklyMax: number; priceSms: number; priceLms: number; hook: boolean; tokenSet: boolean };
  campaign: { enabled: boolean; mode: string; smsName: string; optoutPhone: string; smsFrom: string };
  audiences: { buyers: number; buyersNight: number; rebuy: number; rebuyNight: number }; cap: { capped7: number; atCap: number };
  campaigns: Array<{ id: string; title: string; state: string; audience: string; queued: number; bytes: number; type: string; unit: number; cost: number | null }>;
  optouts: Array<{ id: string; phone: string; source: string; accounts: number; withdrew: number; stopped: number; at: string }>; optout7: { n: number; w: number }; canToken: boolean; note: string;
}
export function MkxSms() {
  const v = useApi<SmsView>('/admin/mkx/sms');
  const a = useAct();
  const [phones, setPhones] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const d = v.data;
  const rotate = async () => {
    const reason = prompt('080 웹훅 토큰을 새로 만듭니다(옛 토큰은 바로 못 씀). 사유(2자 이상):', '');
    if (!reason || reason.trim().length < 2) return;
    const r = await a.run('tok', () => api<{ token: string }>('/admin/mkx/sms/optout080/token', { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }), v.reload);
    if (r?.token) setToken(r.token);
  };
  return (
    <section data-mkx-sms={d ? String(d.settings.weeklyMax) : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className={d.campaign.enabled ? '' : 'warn-text'}>캠페인 보내기 {d.campaign.enabled ? '켜짐' : '꺼짐(campaign.enabled)'} · 방식 {d.campaign.mode} · 앞머리 「(광고){d.campaign.smsName}」 ·
            {' '}080 {d.campaign.optoutPhone || <span className="warn-text">없음(문자 막힘)</span>} · 발신 {d.campaign.smsFrom || <span className="warn-text">없음</span>}</p>
          <table className="tbl"><tbody>
            <tr><th>소개몰 구매 회원(MALL_BUYERS)</th><td className="num">{won(d.audiences.buyers)}명 · 야간 동의 {won(d.audiences.buyersNight)}</td>
              <th>재구매 시기 회원(MALL_REBUY)</th><td className="num">{won(d.audiences.rebuy)}명 · 야간 동의 {won(d.audiences.rebuyNight)}</td></tr>
            <tr><th>회원별 7일 상한</th><td>{d.settings.weeklyMax ? `${d.settings.weeklyMax}통` : '없음'} · 지금 상한인 회원 {won(d.cap.atCap)} · 7일 상한으로 뺀 줄 {won(d.cap.capped7)}</td>
              <th>단가(단문 · 장문)</th><td>{d.settings.priceSms ? `${d.settings.priceSms}원` : '모름'} · {d.settings.priceLms ? `${d.settings.priceLms}원` : '모름'}</td></tr>
          </tbody></table>
          <p className="muted">대상 수는 마케팅 수신 동의 · 휴대폰이 있는 회원입니다. 캠페인에서 대상을 「소개몰 구매 회원」 · 「재구매 시기 회원」으로 고르면 됩니다.</p>
          <table className="tbl"><thead><tr><th>문자 캠페인</th><th>상태</th><th>대상</th><th className="num">바이트</th><th>종류</th><th className="num">대기</th><th className="num">예상 비용</th></tr></thead>
            <tbody>{d.campaigns.map((c) => (
              <tr key={c.id}><td>{c.title}</td><td>{c.state}</td><td>{c.audience}</td><td className="num">{c.bytes}</td><td>{c.type}</td><td className="num">{won(c.queued)}</td><td className="num">{c.cost == null ? '단가 모름' : `${won(c.cost)}원`}</td></tr>))}
              {d.campaigns.length === 0 && <tr><td colSpan={7} className="muted">초안 · 대기 중인 문자 캠페인이 없습니다.</td></tr>}
            </tbody></table>
          <h3>080 수신 거부 반영</h3>
          <p className="muted">080 대행사가 준 거부 번호를 붙여 넣으면 그 번호 회원의 마케팅 · 야간 광고 동의를 철회하고 대기 문자를 멈춥니다(번호는 끝 4자리만 남김). 7일 {d.optout7.n}건 · 철회 {d.optout7.w}건 ·
            {' '}웹훅 {d.settings.hook ? '켜짐' : '꺼짐(mkx.optout080_hook)'} · 토큰 {d.settings.tokenSet ? '있음' : '없음'}</p>
          <p>
            <textarea rows={3} cols={40} value={phones} onChange={(e) => setPhones(e.target.value)} placeholder="01012345678 한 줄에 하나" aria-label="거부 번호" />{' '}
            <button className="btn-sm" disabled={phones.trim().length < 10 || a.busy === 'opt'} data-mkx-optout=""
              onClick={() => void a.run('opt', () => api('/admin/mkx/sms/optout080', { method: 'POST', body: JSON.stringify({ phones }) }), () => { setPhones(''); v.reload(); })}>반영</button>{' '}
            {d.canToken && <button className="btn-sm btn-plain" disabled={a.busy === 'tok'} onClick={() => void rotate()}>웹훅 토큰 새로 만들기</button>}
          </p>
          {token && <p className="warn-text">새 토큰(다시 보이지 않음): <code>{token}</code></p>}
          <table className="tbl"><thead><tr><th>때</th><th>번호</th><th>어디서</th><th className="num">찾은 회원</th><th className="num">철회</th><th className="num">멈춘 문자</th></tr></thead>
            <tbody>{d.optouts.map((o) => (
              <tr key={o.id}><td>{ymdhm(o.at)}</td><td>{o.phone}</td><td>{o.source === 'HOOK' ? '웹훅' : '붙여 넣기'}</td><td className="num">{o.accounts}</td><td className="num">{o.withdrew}</td><td className="num">{o.stopped}</td></tr>))}
              {d.optouts.length === 0 && <tr><td colSpan={6} className="muted">기록이 없습니다.</td></tr>}
            </tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}
