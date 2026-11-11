import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

interface Alert {
  id: string; code: string; severity: 'INFO' | 'WARN' | 'CRITICAL'; title: string; detail: unknown; raisedAt: string;
  acknowledgedAt: string | null; acknowledgedBy: string | null; ackNote: string | null;
  mailedAt?: string | null;   /* v10.197 (D175) 급한 알림을 메일로 보낸 시각 */
  remailedAt?: string | null; /* v10.198 (D176) 12시간 넘게 확인 안 해 다시 보낸 시각 */
  resolvedAt?: string | null; resolveNote?: string | null;   /* v10.199 (D177) 원인이 없어져 정기 작업이 적은 「풀림」 */
}
interface Code { code: string; open: number; resolved?: number; last7d: number; lastAt: string; openSeverity: string | null }
interface Data { items: Alert[]; total: number; resolvedHidden?: number; page: number; size: number; pages: number; codes: Code[] }
/* v10.198 (D176 · docs/312) — 급한 알림 메일 준비 상태 */
interface MailStatus {
  ready: boolean; reason: 'NO_SMTP' | 'NOT_VERIFIED' | 'NO_FROM' | null; to: string | null;
  lastJob: { at: string; pending: number; mailed: number; reason: string | null } | null;
  lastTest: { at: string; ok: boolean; reason: string | null } | null;
  /* v10.200 (D178 · docs/316) — 텔레그램 */
  push?: { ready: boolean; reason: 'NO_TOKEN' | 'NO_CHAT' | null; chat: string | null;
           lastJob: { at: string; pending: number; pushed: number; reason: string | null } | null;
           lastTest: { at: string; ok: boolean; reason: string | null } | null;
           /* v10.201 (D179) — 하루 요약 텔레그램 */
           digest?: { on: boolean; last: { at: string; pushed: boolean; reason: string | null } | null } };
}
interface Chat { id: string; type: string; title: string }
/* v10.234 (docs/375) — 텔레그램 첫 차례 미리보기 */
interface Preview {
  ready: boolean; reason: string | null; pending: number; critical: number; again: number; backlog: number;
  parts: { n: number; chars: number; text: string }[]; included: number; more: number; maxParts: number; maxChars: number; note: string;
}
const WHY: Record<string, string> = {
  NO_SMTP: '메일 설정 없음(SMTP 사용자 이름 · 비밀번호)', NOT_VERIFIED: '메일 스위치 꺼짐(외부 연동 › 메일)', NO_FROM: '보내는 주소 없음',
  NO_TO: '받는 주소 없음', MAIL_NOT_READY: '메일 준비 안 됨',
  NO_TOKEN: '봇 토큰 없음(외부 연동 › 연동 키 › 메일 칸)', NO_CHAT: '받을 대화방 없음(대화방 찾기)',   // v10.200 (D178)
  OFF: '하루 요약 텔레그램 꺼짐',   // v10.201 (D179)
  SEND_AUTH: '봇 토큰이 맞지 않음', SEND_NETWORK: '텔레그램으로 나가는 길 막힘', SEND_TIMEOUT: '텔레그램 응답 없음', SEND_REJECTED: '텔레그램이 거절(대화방 번호 확인)',
};
const why = (r: string | null) => (r ? WHY[r] ?? WHY[r.replace(/^MAIL_NOT_READY_/, '')] ?? r : '');

const SEV: Record<string, string> = { CRITICAL: '긴급', WARN: '경고', INFO: '안내' };
/* 알림 종류 이름 — 모르는 종류는 코드 그대로 */
const NAME: Record<string, string> = {
  SERVER_ERROR_SPIKE: '서버 오류 몰림', SLOW_API: '느린 응답', UPLOADS_BACKUP_STALE: '올린 파일 백업 멈춤', UPLOADS_BACKUP_SKIPPED: '올린 파일 백업 건너뜀',
  POLL_HIDDEN_BY_REPORTS: '회원 투표 신고 감춤', DAILY_DIGEST: '하루 요약', STUB_PAYMENT_ORDER: '시험 결제 주문', SIGNUP_SPIKE: '가입 급증',
  PII_REVIEW_DUE: '개인정보 접속기록 점검',
  SETTING_CHANGED: '중요 설정 바뀜',   // v10.195 (D174) — 주문 받기 · 가입 · 2단계 인증 · 간주 · 기능 스위치
  UPLOADS_BACKUP_OFFSITE_FAILED: '백업 디스크 밖 올리기 실패', UPLOADS_BACKUP_FAILED: '올린 파일 백업 실패', UPLOADS_BACKUP_BAD: '올린 파일 백업 묶음 깨짐',   // v10.197 · v10.198
  ORDER_OPEN_EXPIRED: '주문 받기 저절로 꺼짐', ORDER_OPEN_NO_END: '주문 받기 꺼질 시각 없음', REVIEW_SLA_BREACH: '검수 기한 넘김', DISK_LOW: '디스크 모자람',   // v10.199 (D177)
  STAFF_LOGIN_NEW: '운영자 낯선 로그인',   // v10.201 (D179) — 30일에 없던 IP 대역 · 브라우저
  STAFF_IP_PASS_NEW: '접속 인증 처음 보는 대역', STAFF_IP_LOCKED: '접속 인증번호 5번 틀림', STAFF_IP_DAY_LIMIT: '접속 인증번호 하루 한도',   // v10.228 (D197)
  INTEGRATION_OVERDUE: '외부 연동 예상일 지남',   // v10.235 (docs/375)
  AGENT_LIVE: 'AI 사용 가능해짐', AGENT_READY_GAP: 'AI 준비 덜 됨', AGENT_CAP_NEAR: 'AI 월 상한 가까움', AGENT_STEP_READY: 'AI 다음 단계 켤 수 있음',   // v10.204 (D181 · docs/326) · v10.205 (D182 · docs/328)
  /* v10.203 (docs/322 4절) — 화면에 영어 코드로만 보이던 21종 */
  AGENT_CAP_REACHED: 'AI 월 상한 닿음', AGENT_CHAT_HANDOFF: 'AI 상담 담당자 연결', K_VALUE_BREACH: '검수 부담(k값) 경보',
  LEAD_ASSIGN_FAILED: '리드 배정 오류', LEAD_CASH_AUTO_FAILED: '리드 이용료 자동 충전 실패', LEAD_UNMATCHED: '보낼 업체 없는 상담 신청',
  NOTIFY_STUCK: '회원 알림 못 나감', PII_PURGE_FAILED: '개인정보 파기 실패', PII_PURGE_MISSED: '개인정보 파기 안 돎', PII_PURGE_OVERDUE: '파기 기한 넘긴 개인정보',
  POSTING_SUSPENDED: '등록 잠시 막음(반려 3회)', PRIVACY_REQUEST_DUE: '개인정보 권리 요청 기한', PROMO_EXPIRY_UNNOTIFIED: '프로모션 만료 안내 못 함',
  RESTRICTION_ENFORCED: '제한업종 노출 중단', RISK_DETECTED: '위험 탐지', RISK_RULE_BROKEN: '위험 탐지 규칙 고장', ROLE_REVIEW_DUE: '운영자 권한 점검',
  SETTLEMENT_AUDIT_FAILED: '정산 점검 이상', SUBSCRIPTION_BILLING_FAILED: '정기결제 실패', SUBSCRIPTION_BILLING_REVIEW: '정기결제 확인 필요', SUBSCRIPTION_CARD_UNUSABLE: '구독 카드 교체 필요',
};

/**
 * SB-ADM-OPS-010 운영 알림 (v10.179 · D168 · docs/279)
 *
 * 정기 작업 · 스크립트가 남긴 운영 알림을 보고 「확인」합니다. 확인은 한 번만(누가 · 언제 · 메모가 남고 되돌릴 수 없음).
 * 알림 내용은 바꾸거나 지우지 않습니다. 「지켜보기」의 「확인 안 한 알림」 칸 · 대시보드 긴급 경보가 여기로 옵니다.
 */
export function OpsAlerts() {
  const [state, setState] = useState<'open' | 'all'>('open');
  const [code, setCode] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);   /* v10.199 (D177) — 풀린 알림도 보기 */
  const q = useApi<Data>(`/admin/ops-alerts?state=${state}${code ? `&code=${code}` : ''}&page=${page}${showResolved ? '&resolved=show' : ''}`);
  const a = useAct();
  const ms = useApi<MailStatus>('/admin/ops-alerts/mail-status');
  const isSuper = tokenRoles().includes('SUPER');
  const mailTest = () => void a.run('mail-test', () => api('/admin/ops-alerts/mail-test', { method: 'POST', body: '{}' })).then(ms.reload);
  /* v10.200 (D178) — 텔레그램 시험 · 대화방 찾기(고르면 사이트 설정 ops.telegram_chat) */
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [bulkHours, setBulkHours] = useState(24);   /* v10.232 — 한꺼번에 확인 기준 시간 */
  const pushTest = () => void a.run('push-test', () => api('/admin/ops-alerts/push-test', { method: 'POST', body: '{}' })).then(ms.reload);
  const findChat = () => void a.run('push-find', async () => {
    const r = await api<{ ok: boolean; chats: Chat[]; note: string }>('/admin/ops-alerts/push-find-chat', { method: 'POST', body: '{}' });
    setChats(r.ok ? r.chats : null);
    return r;
  });
  const pickChat = (c: Chat) => void a.run('push-pick', () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'ops.telegram_chat', value: c.id }) }),
    () => { setChats(null); ms.reload(); }, `받을 대화방을 「${c.title || c.id}」(으)로 정했습니다 — 「시험 메시지」로 확인하십시오.`);
  /* v10.201 (D179) — 하루 요약도 텔레그램으로(설정 ops.telegram_digest) */
  const flipDigest = (on: boolean) => void a.run('push-digest', () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'ops.telegram_digest', value: on ? 'off' : 'on' }) }),
    ms.reload, on ? '하루 요약은 텔레그램으로 보내지 않습니다.' : '하루 요약도 텔레그램으로 보냅니다(매일 아침 하루 요약 작업 때).');

  const ack = (x: Alert) => {
    const note = prompt(`「${x.title.slice(0, 40)}」을(를) 확인합니다.\n메모(선택 · 200자) — 무엇을 했는지`, '') ;
    if (note === null) return;
    void a.run(x.id, () => api(`/admin/ops-alerts/${x.id}/ack`, { method: 'POST', body: JSON.stringify({ note: note.trim() || undefined }) }), q.reload, '확인했습니다.');
  };
  const ackCode = (c: Code) => {
    const note = prompt(`${NAME[c.code] ?? c.code} 확인 안 한 알림 ${c.open + (c.resolved ?? 0)}건(풀린 것 ${c.resolved ?? 0}건 포함)을 모두 확인합니다.\n메모(선택 · 200자)`, '');
    if (note === null) return;
    void a.run(`code:${c.code}`, () => api<{ note: string }>('/admin/ops-alerts/ack-code', { method: 'POST', body: JSON.stringify({ code: c.code, note: note.trim() || undefined }) }), q.reload);
  };

  /* v10.232 (docs/371) — 한꺼번에 확인: 몇 건인지 먼저 보이고 메모 하나 · CRITICAL 은 서버가 뺌 */
  const ackBulk = async (scope: 'resolved' | 'older') => {
    const qs = scope === 'older' ? `scope=older&hours=${bulkHours}` : 'scope=resolved';
    const pv = await api<{ count: number }>(`/admin/ops-alerts/ack-bulk/preview?${qs}`).catch(() => null);
    if (!pv) return void a.run('bulk', () => api(`/admin/ops-alerts/ack-bulk/preview?${qs}`));
    if (pv.count === 0) return void a.run('bulk', async () => ({ ok: false, note: '확인할 알림이 없습니다(CRITICAL 은 빼고 셈).' }));
    const what = scope === 'older' ? `${bulkHours}시간 넘은 INFO · WARN` : '풀린 알림';
    const note = prompt(`${what} ${pv.count}건을 모두 확인합니다(CRITICAL 은 빼고).\n메모(선택 · 200자)`, '');
    if (note === null) return;
    void a.run('bulk', () => api<{ note: string }>('/admin/ops-alerts/ack-bulk', { method: 'POST', body: JSON.stringify({ scope, hours: scope === 'older' ? bulkHours : undefined, note: note.trim() || undefined }) }), q.reload,
      (r) => r.note);
  };

  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const d = q.data;
  return (
    <section data-ops-alerts="">
      <Flash msg={a.msg} err={a.err} />
      {ms.data && (
        <p className="card pad" data-mail-status={ms.data.ready ? 'ready' : 'not-ready'}>
          <b>급한 알림 메일</b>{' '}
          {ms.data.ready ? <b>준비됨</b> : <b className="warn-text">준비 안 됨 — {why(ms.data.reason)}</b>}
          {' · '}받는 주소 {ms.data.to ? <span className="mono">{ms.data.to}</span> : <b className="warn-text">없음(하루 요약 받는 주소)</b>}
          {ms.data.lastJob && <span data-mail-last-job=""> · 마지막 정기 작업 {ymdhm(ms.data.lastJob.at)} — 보냄 {n(ms.data.lastJob.mailed)} · 남음 {n(ms.data.lastJob.pending)}{ms.data.lastJob.reason ? ` · ${why(ms.data.lastJob.reason)}` : ''}</span>}
          {ms.data.lastTest && <span data-mail-last-test=""> · 마지막 시험 메일 {ymdhm(ms.data.lastTest.at)} {ms.data.lastTest.ok ? '보냄' : `못 보냄(${why(ms.data.lastTest.reason)})`}</span>}
          {isSuper && <>{' '}<button className="btn-sm" disabled={a.busy === 'mail-test'} onClick={mailTest} data-mail-test="">시험 메일 보내기</button></>}
        </p>
      )}
      {ms.data?.push && ((p: NonNullable<MailStatus['push']>) => {
        return (
          <div className="card pad" data-push-status={p.ready ? 'ready' : 'not-ready'}>
            <b>급한 알림 텔레그램</b>{' '}
            {p.ready ? <b>준비됨</b> : <b className="warn-text">준비 안 됨 — {why(p.reason)}</b>}
            {p.chat && <> · 대화방 <span className="mono">{p.chat}</span></>}
            {p.lastJob && <span data-push-last-job=""> · 마지막 정기 작업 {ymdhm(p.lastJob.at)} — 보냄 {n(p.lastJob.pushed)} · 남음 {n(p.lastJob.pending)}{p.lastJob.reason ? ` · ${why(p.lastJob.reason)}` : ''}</span>}
            {p.lastTest && <span data-push-last-test=""> · 마지막 시험 {ymdhm(p.lastTest.at)} {p.lastTest.ok ? '보냄' : `못 보냄(${why(p.lastTest.reason)})`}</span>}
            {isSuper && <>{' '}<button className="btn-sm" disabled={a.busy === 'push-find'} onClick={findChat} data-push-find="">대화방 찾기</button>
              {' '}<button className="btn-sm" disabled={a.busy === 'push-test'} onClick={pushTest} data-push-test="">시험 메시지 보내기</button></>}
            {chats && chats.length > 0 && (
              <ul data-push-chats={chats.length}>
                {chats.map((c) => <li key={c.id}><button className="btn-plain" onClick={() => pickChat(c)} data-push-chat={c.id}>{c.title || '(이름 없음)'} · {c.type} · <span className="mono">{c.id}</span></button></li>)}
              </ul>
            )}
            {p.digest && (
              <span data-push-digest={p.digest.on ? 'on' : 'off'}> · 하루 요약 {p.digest.on ? <b>받음</b> : '안 받음'}
                {p.digest.last && <span data-push-digest-last=""> (마지막 {ymdhm(p.digest.last.at)} {p.digest.last.pushed ? '보냄' : `못 보냄 — ${why(p.digest.last.reason)}`})</span>}
                {isSuper && <>{' '}<button className="btn-sm ghost" disabled={a.busy === 'push-digest'} onClick={() => flipDigest(p.digest!.on)} data-push-digest-flip="">{p.digest.on ? '하루 요약 끄기' : '하루 요약도 받기'}</button></>}
              </span>
            )}
            <PushPreview />
            <small className="dim"> 메일과 같은 알림(긴급 · 중요 설정 바뀜 · 주문 받기 저절로 꺼짐 · 백업 실패 · 운영자 낯선 로그인)을 같은 기준으로 보냅니다 — 메일이 준비 안 돼도 갑니다. 알림 내용은 보내지 않고 제목만.</small>
          </div>
        );
      })(ms.data.push)}
      <section className="card pad">
        <h3 className="sec">종류별 <small className="dim">확인 안 한 수 · 지난 7일</small></h3>
        <p data-ack-bulk="">
          <b>한꺼번에 확인</b>{' '}
          <button className="btn-sm" disabled={a.busy === 'bulk'} onClick={() => void ackBulk('resolved')} data-ack-bulk-resolved="">풀린 것 모두 확인</button>{' '}
          <select value={bulkHours} onChange={(e) => setBulkHours(Number(e.target.value))} aria-label="몇 시간 넘은 것" data-ack-bulk-hours="">
            {[6, 24, 72].map((h) => <option key={h} value={h}>{h}시간</option>)}
          </select>{' '}
          <button className="btn-sm" disabled={a.busy === 'bulk'} onClick={() => void ackBulk('older')} data-ack-bulk-older="">넘은 INFO · WARN 모두 확인</button>
          <small className="dim"> CRITICAL 은 빼고 확인합니다 — CRITICAL 은 아래에서 하나씩 · 종류별로. 텔레그램을 켜기 전에 쌓인 알림을 정리할 때 씁니다.</small>
        </p>
        {d.codes.length === 0 ? <p className="muted">확인할 알림이 없습니다.</p> : (
          <table className="tbl" data-alert-codes="">
            <thead><tr><th>종류</th><th>확인 안 함</th><th>풀림</th><th>지난 7일</th><th>가장 최근</th><th>처리</th></tr></thead>
            <tbody>{d.codes.map((c) => (
              <tr key={c.code} data-alert-code={c.code}>
                <td><button className="btn-plain" onClick={() => { setCode(code === c.code ? '' : c.code); setPage(1); }}>{NAME[c.code] ?? c.code}</button> <small className="dim mono">{c.code}</small></td>
                <td className="num-cell">{c.open > 0 ? <b className={c.openSeverity === 'INFO' ? '' : 'warn-text'}>{n(c.open)}</b> : 0}</td>
                <td className="num-cell muted" data-code-resolved={c.resolved ?? 0}>{n(c.resolved ?? 0)}</td>
                <td className="num-cell">{n(c.last7d)}</td><td className="muted">{ymdhm(c.lastAt)}</td>
                <td>{(c.open > 0 || (c.resolved ?? 0) > 0) && <button className="btn-sm" disabled={a.busy === `code:${c.code}`} onClick={() => ackCode(c)} data-ack-code="">모두 확인</button>}</td>
              </tr>))}</tbody>
          </table>
        )}
      </section>
      <p>
        <label><input type="radio" name="alert-state" checked={state === 'open'} onChange={() => { setState('open'); setPage(1); }} /> 확인 안 한 것</label>{' '}
        <label><input type="radio" name="alert-state" checked={state === 'all'} onChange={() => { setState('all'); setPage(1); }} /> 전부</label>
        {code && <> · 종류 <b>{NAME[code] ?? code}</b> <button className="btn-plain" onClick={() => setCode('')}>모든 종류</button></>}
        {' '}<span className="dim">{n(d.total)}건</span>
        {state === 'open' && <>{' · '}<label data-show-resolved=""><input type="checkbox" checked={showResolved} onChange={(e) => { setShowResolved(e.target.checked); setPage(1); }} /> 풀린 것도 보기{!showResolved && (d.resolvedHidden ?? 0) > 0 ? `(${n(d.resolvedHidden ?? 0)}건 숨김)` : ''}</label></>}
      </p>
      {d.items.length === 0 ? <p className="muted">알림이 없습니다.</p> : (
        <table className="tbl" data-alert-list="">
          <thead><tr><th>때</th><th>등급</th><th>종류</th><th>내용</th><th>확인</th></tr></thead>
          <tbody>{d.items.map((x) => (
            <tr key={x.id} data-alert={x.id} data-acked={x.acknowledgedAt ? '1' : '0'}>
              <td className="muted">{ymdhm(x.raisedAt)}{x.mailedAt && <><br /><span data-mailed="">메일 보냄 {ymdhm(x.mailedAt)}</span></>}{x.remailedAt && <><br /><span data-remailed="">다시 보냄 {ymdhm(x.remailedAt)}</span></>}{x.resolvedAt && <><br /><span className="muted" data-resolved="" title={x.resolveNote ?? ''}>풀림 {ymdhm(x.resolvedAt)}{x.resolveNote ? ` · ${x.resolveNote}` : ''}</span></>}</td>
              <td>{x.severity === 'INFO' ? SEV[x.severity] : <b className="warn-text">{SEV[x.severity]}</b>}</td>
              <td>{NAME[x.code] ?? x.code}</td>
              <td>
                {x.title}{' '}
                {x.detail != null && <button className="btn-plain" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? '접기' : '자세히'}</button>}
                {open === x.id && <pre className="card pad" style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(x.detail, null, 1)}</pre>}
              </td>
              <td>{x.acknowledgedAt
                ? <span className="muted">{x.acknowledgedBy ?? '—'} · {ymdhm(x.acknowledgedAt)}{x.ackNote ? ` · ${x.ackNote}` : ''}</span>
                : <button className="btn-sm" disabled={a.busy === x.id} onClick={() => ack(x)} data-ack="">확인</button>}</td>
            </tr>))}</tbody>
        </table>
      )}
      {d.pages > 1 && <p><button className="btn-plain" disabled={page <= 1} onClick={() => setPage(page - 1)}>앞</button> {page} / {d.pages} <button className="btn-plain" disabled={page >= d.pages} onClick={() => setPage(page + 1)}>뒤</button></p>}
      <div className="ad-nt info">확인은 한 번만 됩니다 — 누가 · 언제 · 메모가 남고 되돌릴 수 없습니다. 알림 내용은 바뀌지 않습니다. 긴급(CRITICAL)이 확인 안 된 채 남아 있으면 배포 점검(postcheck)이 실패로 봅니다. 긴급 · 중요 설정 바뀜은 10분 안에 하루 요약 받는 주소로 메일이 갑니다(메일이 준비됐을 때 · 같은 종류는 1시간에 1통). 올린 파일 백업 실패 · 묶음 깨짐도 메일이 가고, 긴급을 12시간 넘게 확인하지 않으면 한 번 더 갑니다. 원인이 없어진 알림(백업 멈춤 → 새 묶음 · 검수 기한 넘김 → 0건 · 디스크 → 기준 아래 · 주문 받기 → 꺼짐)은 정기 작업이 「풀림」을 적어 확인 안 한 수 · 메일 · 배포 점검에서 빠집니다(확인 기록은 따로).</div>
    </section>
  );
}

/**
 * v10.234 (docs/375) — 「지금 켜면 첫 차례」 미리보기. 누를 때만 읽음(읽기만 — 보내지 않고 「보냄」도 적지 않음).
 * 정기 작업과 같은 글 만들기라 켠 뒤 처음 오는 글과 같음(그 사이 새 알림이 생기면 달라짐).
 */
function PushPreview() {
  const [d, setD] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => {
    setBusy(true); setErr(null);
    api<Preview>('/admin/ops-alerts/push-preview').then(setD, (e) => setErr(String(e?.message ?? e))).finally(() => setBusy(false));
  };
  return (
    <div data-push-preview={d ? d.parts.length : ''}>
      <button className="btn-sm ghost" disabled={busy} onClick={load} data-push-preview-load="">{d ? '미리보기 새로' : '지금 켜면 첫 차례 미리보기'}</button>
      {err && <small className="warn-text"> 읽지 못했습니다 — {err}</small>}
      {d && (
        <>
          <p data-push-preview-note="">
            {d.note}
            {d.pending > 0 && <small className="dim"> 대기 {n(d.pending)}건(CRITICAL {n(d.critical)}{d.again ? ` · 다시 알림 ${n(d.again)}` : ''}) · 같은 기준 전체 {n(d.backlog)}건 · 한 차례 최대 {d.maxParts}통 · 한 통 {n(d.maxChars)}자</small>}
            {!d.ready && d.pending > 0 && <small className="dim"> — 지금은 준비 안 됨이라 보내지 않습니다.</small>}
          </p>
          {d.parts.map((p, i) => (
            <details key={i} data-push-preview-part={i + 1}>
              <summary>{i + 1}/{d.parts.length}통 — 알림 {n(p.n)}건 · {n(p.chars)}자</summary>
              <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{p.text}</pre>
            </details>
          ))}
        </>
      )}
    </div>
  );
}
