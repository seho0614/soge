import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

interface Watch {
  signups: number; logins: number; posts: number; listings: number; orders: number; paidOrders: number; stubPaidOrders: number;
  openAlerts: number; orderOpen: 'on' | 'off'; assumePayment: 'on' | 'off'; directOnSale: number; warn?: string; digestTo?: string;
  signupOpen?: 'on' | 'off'; noticeBar?: string;
  serverErrorsHour?: number;   // v10.174 (D163) — API 가 지난 1시간 보낸 서버 오류(5xx)
  rateLimitedHour?: { n: number; ips: number };   // v10.176 (D165) — 지난 1시간 요청 한도(429)에 걸린 요청 · IP 수
  cspDay?: { n: number; top: Array<{ directive: string; blocked: string; n: number; page: string }> };   // v10.177 — 보안 정책 「보고만 하기」 24시간
  slowSql?: { n: number; thresholdMs: number; top: Array<{ sql: string; n: number; maxMs: number }> };   // v10.179 — 300ms 넘은 DB 조회(1시간)
  slowHour?: { n: number; p95: number; top: Array<{ path: string; p95: number; n: number }> }; slowLimitMs?: number;   // v10.178 (D167) — 지난 1시간 API 응답 p95(ms)
  uploadsBackup?: { count: number; last: string | null; lastAt: string | null; lastKB: number | null; ageHours: number | null; stale: boolean };   // v10.177
  stubOrders: Array<{ orderNo: string; total: number | string; status: string; paidAt: string }>;
  /* v10.182 (D171 · docs/285) — 서버 디스크 · 메모리 · 올린 파일 · 백업 폴더(10분마다 잰 값) */
  server?: {
    at: string; disk: { path: string; totalGB: number; freeGB: number; usedPct: number } | null; mem: { totalMB: number; availMB: number; usedPct: number };
    uploads: { MB: number; files: number; partial: boolean } | null; backup: { MB: number; files: number; partial: boolean } | null;
    top?: { at: string; items: Array<{ path: string; GB: number; hint: string }>; partial: boolean } | null;   // v10.186 — 많이 차지하는 폴더 5개
  };
  diskWarnPct?: number;
}

/**
 * v10.170 (D159 · docs/262) — 운영 화면 첫 화면 「공개 직후 지켜보기」
 *
 * 사용자 웹을 전체 공개(11/1)한 뒤 오늘 들어온 것 · **시험 결제(stub)로 결제 완료된 주문**(돈을 받지 않은 주문) · 확인 안 한 운영 알림.
 * 「주문 받기」(mall.order_open)를 여기서 바로 끄고 켭니다(SUPER — 사이트 설정과 같은 API · 감사 기록).
 */
const NOTICE_DEFAULT = '시범 운영 중입니다 — 소개몰 결제 등 일부 기능은 시험 모드로 동작합니다.';

export function LaunchWatch() {
  const w = useApi<Watch>('/admin/launch-watch');
  const a = useAct();
  const [digest, setDigest] = useState<string | null>(null);
  /* v10.195 (D174 · docs/306) — 간주 결제가 켜져 있을 때 주문 받기 켜기는 사유 · 확인 문구(서버가 검사 · SUPER 만) */
  const [openForm, setOpenForm] = useState(false);
  const [openReason, setOpenReason] = useState('');
  const [openConfirm, setOpenConfirm] = useState('');
  if (w.error || !w.data) return null;
  const d = w.data;
  const toggle = () => {
    const to = d.orderOpen === 'on' ? 'off' : 'on';
    if (to === 'on' && d.assumePayment === 'on') { setOpenForm((v) => !v); return; }
    if (!confirm(to === 'off' ? '소개몰 주문 · 결제를 막습니다(상품 보기 · 담기는 됨). 결제대행사 연결 전 시험 결제 주문을 막으려면 끄십시오.' : '소개몰 주문 · 결제를 엽니다. 결제대행사가 연결되지 않았으면 시험 결제 주문이 생깁니다.')) return;
    void a.run('order', () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'mall.order_open', value: to }) }), w.reload,
      to === 'off' ? '주문 받기를 껐습니다.' : '주문 받기를 켰습니다.');
  };
  const openWithReason = () => {
    void a.run('order', () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'mall.order_open', value: 'on', reason: openReason, confirm: openConfirm }) }),
      () => { setOpenForm(false); setOpenReason(''); setOpenConfirm(''); w.reload(); }, '주문 받기를 켰습니다 — 운영 알림에 사유가 남았습니다.');
  };
  /* v10.173 (D162 · docs/266) — 가입 잠시 막기 · 사용자 웹 안내 띠 · 시험 결제 주문 정리 */
  const setting = (key: string, value: string, done: string) =>
    a.run(key, () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key, value }) }), w.reload, done);
  const toggleSignup = () => {
    const to = d.signupOpen === 'off' ? 'on' : 'off';
    if (!confirm(to === 'off' ? '새 가입을 잠시 막습니다(가입 화면에 안내 · 기존 회원 로그인은 그대로).' : '새 가입을 다시 받습니다.')) return;
    void setting('signup.open', to, to === 'off' ? '새 가입을 잠시 막았습니다.' : '새 가입을 다시 받습니다.');
  };
  const toggleNotice = () => {
    if (d.noticeBar) {
      if (!confirm('사용자 웹 맨 위 안내 띠를 내립니다.')) return;
      void setting('site.notice_bar', '', '안내 띠를 내렸습니다.');
      return;
    }
    const text = prompt('사용자 웹 맨 위에 보일 안내(200자 안 · 영어 화면 글은 사이트 설정 site.notice_bar_en)', NOTICE_DEFAULT);
    if (!text?.trim()) return;
    void setting('site.notice_bar', text.trim(), '안내 띠를 올렸습니다.');
  };
  const cancelStub = () => {
    if (!confirm('시험 결제로 결제 완료된 주문 중 발송 전 주문을 모두 취소하고, 주문한 분께 알림을 보냅니다. 돈은 받지 않았으므로 환불은 없습니다.')) return;
    void a.run('stub', () => api<{ ok: boolean; note: string }>('/admin/launch-watch/stub-orders/cancel', { method: 'POST', body: '{}' }), w.reload);
  };
  const showDigest = () => {
    if (digest !== null) { setDigest(null); return; }
    void a.run('digest', async () => { setDigest((await api<{ text: string }>('/admin/launch-watch/digest')).text); }, undefined, '어제 요약을 지금 계산했습니다(알림 · 메일은 남기지 않음).');
  };
  const tiles: Array<[string, number, boolean?]> = [
    ['오늘 가입', d.signups], ['오늘 로그인', d.logins], ['소개광장 글', d.posts], ['매물', d.listings],
    ['소개몰 주문', d.orders], ['결제 완료', d.paidOrders], ['시험 결제 주문', d.stubPaidOrders, d.stubPaidOrders > 0], ['확인 안 한 알림', d.openAlerts, d.openAlerts > 0],
    ['서버 오류(1시간)', d.serverErrorsHour ?? 0, (d.serverErrorsHour ?? 0) > 0],
    ['한도 걸림(1시간)', d.rateLimitedHour?.n ?? 0, (d.rateLimitedHour?.n ?? 0) > 0],
    ['정책 보고(24시간)', d.cspDay?.n ?? 0],
    ['느린 응답 p95 ms(1시간)', d.slowHour?.p95 ?? 0, !!d.slowLimitMs && (d.slowHour?.p95 ?? 0) >= d.slowLimitMs],
  ];
  const ub = d.uploadsBackup;
  return (
    <section className="card pad" data-launch-watch="">
      <h3 className="sec">공개 직후 지켜보기 <small className="dim">오늘 · 한국 시간</small></h3>
      <Flash msg={a.msg} err={a.err} />
      <div className="ad-tiles">
        {tiles.map(([k, v, warn]) => (
          <div key={k} className={`ad-tile${warn ? ' warn' : ''}`} data-watch={k}><span className="tl">{k}</span><b>{n(v)}</b></div>
        ))}
      </div>
      {/* v10.182 (D171) — 서버 디스크 · 메모리 */}
      {d.server && (() => {
        const sv = d.server; const dk = sv.disk; const lim = d.diskWarnPct ?? 85;
        const mb = (x: { MB: number; partial: boolean } | null) => (x ? `${x.MB >= 1024 ? `${(x.MB / 1024).toFixed(1)}GB` : `${n(x.MB)}MB`}${x.partial ? '(대략)' : ''}` : '없음');
        return (<>
          <p className={dk && lim > 0 && dk.usedPct >= lim ? 'card warn' : 'hint'} data-server-health={dk ? String(dk.usedPct) : 'none'}>
            서버 디스크 {dk ? <><b>{dk.usedPct}%</b> 사용 · 남은 <b>{dk.freeGB}GB</b> / {dk.totalGB}GB</> : '잴 수 없음'}
            {' · '}메모리 {sv.mem.usedPct}%(쓸 수 있는 {n(sv.mem.availMB)}MB)
            {' · '}올린 파일 {mb(sv.uploads)} · 백업 묶음 {mb(sv.backup)}
            <small className="dim"> · {ymdhm(sv.at)} 잼 · 기준 {lim}%(ops.disk_warn_pct) 넘으면 운영 알림 DISK_LOW</small>
            {dk && lim > 0 && dk.usedPct >= lim && <> — 옛 판 · 오래된 백업 묶음을 정리하거나 디스크(EBS)를 늘리십시오.</>}
          </p>
          {(sv.top?.items.length ?? 0) > 0 && (   /* v10.186 (docs/292) — 많이 차지하는 폴더 5개 · 지우기는 사람이 cleanup.sh 로 */
            <details data-disk-top={sv.top!.items.length}>
              <summary>디스크를 많이 차지하는 폴더 5개{sv.top!.partial ? '(권한 없는 곳은 대략)' : ''} · {ymdhm(sv.top!.at)} 잼(1시간마다)</summary>
              <table className="tbl">
                <thead><tr><th>폴더</th><th>크기</th><th>줄이는 길</th></tr></thead>
                <tbody>{sv.top!.items.map((t) => <tr key={t.path}><td><code>{t.path}</code></td><td>{t.GB}GB</td><td>{t.hint || '-'}</td></tr>)}</tbody>
              </table>
              <p className="hint">정리는 서버에서 <code>bash ~/sgb/deploy/aws/cleanup.sh</code>(목록만 보기) → 맞으면 <code>--apply</code>. 올린 파일 · DB 는 지우지 않습니다.</p>
            </details>
          )}
        </>);
      })()}
      {/* v10.179 (D168) — 운영 알림 목록 · 확인 화면 · v10.182 — 최근 서버 오류 */}
      <p className="hint"><a href="#/ops-alerts" data-ops-alerts-link="">운영 알림 보기 · 확인 →</a> · <a href="#/server-errors" data-server-errors-link="">최근 서버 오류 →</a>{(d.slowSql?.n ?? 0) > 0 && <> · 느린 조회(300ms 넘음 · 1시간) <b data-slow-sql={d.slowSql!.n}>{n(d.slowSql!.n)}건</b></>}</p>
      {(d.slowSql?.top.length ?? 0) > 0 && (
        <details data-slow-sql-top="">
          <summary>느린 조회 5개(SQL 모양 · 넘긴 값은 담지 않음)</summary>
          <table className="tbl">
            <thead><tr><th>SQL 모양</th><th>건수</th><th>가장 느림(ms)</th></tr></thead>
            <tbody>{d.slowSql!.top.map((r) => <tr key={r.sql}><td className="mono" style={{ fontSize: 12 }}>{r.sql}</td><td className="num-cell">{n(r.n)}</td><td className="num-cell">{n(r.maxMs)}</td></tr>)}</tbody>
          </table>
        </details>
      )}
      {d.warn && <p className="card warn" data-watch-warn="">{d.warn}</p>}
      <p>
        소개몰 주문 받기 <b data-order-open={d.orderOpen}>{d.orderOpen === 'on' ? '켜짐' : '꺼짐'}</b> · 간주 결제 {d.assumePayment === 'on' ? '켜짐(시험 결제)' : '꺼짐'} · 판매 중 직판 상품 {n(d.directOnSale)}개{' '}
        <button className={d.orderOpen === 'on' ? 'btn-no' : 'btn-ok'} disabled={a.busy === 'order'} onClick={toggle} data-order-toggle="">{d.orderOpen === 'on' ? '주문 받기 끄기' : '주문 받기 켜기'}</button>
      </p>
      {openForm && d.orderOpen !== 'on' && (
        <div className="card warn" data-order-open-form="">
          <p>간주 결제가 켜져 있어 <b>돈을 받지 않은 「결제 완료」 주문</b>이 생깁니다. 결제대행사 연결 전에는 켜지 않는 것이 원칙입니다. 시연 · 시험 주문이 꼭 필요하면 최고 관리자(SUPER)가 사유와 확인 문구를 넣으십시오 — 운영 알림에 남습니다.</p>
          <label>사유(10자 이상) <input value={openReason} maxLength={300} onChange={(e) => setOpenReason(e.target.value)} data-order-open-reason="" /></label>{' '}
          <label>확인 문구 「시험 결제 주문을 받습니다」 <input value={openConfirm} maxLength={50} onChange={(e) => setOpenConfirm(e.target.value)} data-order-open-confirm="" /></label>{' '}
          <button className="btn-no" disabled={a.busy === 'order' || openReason.trim().length < 10 || openConfirm.trim() !== '시험 결제 주문을 받습니다'} onClick={openWithReason} data-order-open-submit="">그래도 켜기</button>{' '}
          <button className="btn-plain" onClick={() => setOpenForm(false)}>그만두기</button>
        </div>
      )}
      {/* v10.171 (D160) — 매일 09:00 어제 요약(운영 알림 · 메일이 준비됐으면 이 주소로) · 1시간 가입 급증 알림 */}
      <p className="hint" data-digest-to={d.digestTo ?? ''}>하루 요약: 매일 09:00 운영 알림{d.digestTo ? ` · 메일 ${d.digestTo}(메일 발송이 준비된 뒤)` : ''} · 1시간 가입 급증 알림(사이트 설정 ops.signup_spike_per_hour) · 10분 서버 오류 몰림 알림(ops.server_error_per_10min){' '}
        {/* v10.172 — 어제 요약을 지금 보기(알림 · 메일은 남기지 않음) */}
        <button className="btn-plain" disabled={a.busy === 'digest'} onClick={showDigest} data-digest-show="">{digest !== null ? '요약 닫기' : '어제 요약 보기'}</button></p>
      {digest !== null && <pre className="card pad" data-digest-text="">{digest}</pre>}
      <p data-abuse-tools="">
        새 가입 <b data-signup-open={d.signupOpen ?? 'on'}>{d.signupOpen === 'off' ? '막힘' : '받는 중'}</b>{' '}
        <button className={d.signupOpen === 'off' ? 'btn-ok' : 'btn-no'} disabled={a.busy === 'signup.open'} onClick={toggleSignup} data-signup-toggle="">{d.signupOpen === 'off' ? '가입 다시 받기' : '가입 잠시 막기'}</button>
        {' · '}사용자 웹 안내 띠 <b data-notice-on={d.noticeBar ? 'on' : 'off'}>{d.noticeBar ? '보임' : '없음'}</b>{' '}
        <button className="btn-plain" disabled={a.busy === 'site.notice_bar'} onClick={toggleNotice} data-notice-toggle="">{d.noticeBar ? '안내 띠 내리기' : '안내 띠 올리기'}</button>
      </p>
      {d.noticeBar && <p className="hint" data-notice-text="">안내 띠: {d.noticeBar}</p>}
      {/* v10.177 (docs/275) — 올린 파일 백업(uploads-backup.sh 묶음) · 36시간 넘게 새 묶음이 없으면 경고(하루 요약 때 운영 알림 UPLOADS_BACKUP_STALE) */}
      <p className={ub?.stale ? 'card warn' : 'hint'} data-uploads-backup={ub ? (ub.count === 0 ? 'none' : ub.stale ? 'stale' : 'ok') : 'none'}>
        올린 파일 백업: {!ub || ub.count === 0 ? '아직 묶음 없음 — 예약(cron)을 걸었는지 확인(docs/273 4절)' : `마지막 ${ub.last} · ${ub.ageHours}시간 전 · ${n(ub.lastKB ?? 0)}KB · 남은 묶음 ${ub.count}개${ub.stale ? ' — 36시간 넘게 새 묶음이 없습니다. cron · 디스크를 확인하십시오' : ''}`}
      </p>
      {/* v10.178 (D167) — 느린 응답: 지난 1시간 요청 수 · 느린 주소 5곳(주소별 p95) · 기준 ops.slow_p95_ms(10분 p95 가 넘으면 운영 알림 SLOW_API) */}
      {(d.slowHour?.top.length ?? 0) > 0 && (
        <details data-slow-top="">
          <summary>느린 주소(1시간 · 요청 {n(d.slowHour!.n)}건 · 기준 {n(d.slowLimitMs ?? 0)}ms)</summary>
          <table className="tbl">
            <thead><tr><th>주소</th><th>p95(ms)</th><th>요청</th></tr></thead>
            <tbody>{d.slowHour!.top.map((r) => <tr key={r.path}><td className="mono">{r.path}</td><td className="num-cell">{n(r.p95)}</td><td className="num-cell">{n(r.n)}</td></tr>)}</tbody>
          </table>
        </details>
      )}
      {/* v10.177 — 보안 정책 「보고만 하기」: 화면은 막지 않고 브라우저 보고만 모음(메모리 24시간). 1 ~ 2주 본 뒤 정책을 걸지 판단 */}
      {(d.cspDay?.top.length ?? 0) > 0 && (
        <details data-csp-top="">
          <summary>정책 보고 많이 걸린 출처(24시간 · 화면은 막지 않음)</summary>
          <table className="tbl">
            <thead><tr><th>규칙</th><th>출처</th><th>건수</th><th>최근 화면</th></tr></thead>
            <tbody>{d.cspDay!.top.map((r) => <tr key={`${r.directive}|${r.blocked}`}><td className="mono">{r.directive}</td><td className="mono">{r.blocked}</td><td className="num-cell">{n(r.n)}</td><td className="muted">{r.page}</td></tr>)}</tbody>
          </table>
        </details>
      )}
      {d.stubOrders.length > 0 && (
        <p><button className="btn-no" disabled={a.busy === 'stub'} onClick={cancelStub} data-stub-cancel="">시험 결제 주문 정리(발송 전 취소 · 알림)</button></p>
      )}
      {d.stubOrders.length > 0 && (
        <table className="tbl">
          <thead><tr><th>시험 결제 주문</th><th>금액</th><th>상태</th><th>결제 시각</th></tr></thead>
          <tbody>{d.stubOrders.map((o) => <tr key={o.orderNo}><td className="mono">{o.orderNo}</td><td className="num-cell">{n(o.total)}</td><td>{o.status}</td><td className="muted">{ymdhm(o.paidAt)}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  );
}
