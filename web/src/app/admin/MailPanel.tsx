import { useEffect, useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { ymdKst } from '../../lib/format';

/**
 * v10.140 (D136 · docs/211 · 설계 docs/210) — 외부 연동 › 「메일」 (SB-ADM-SIT-080 안의 한 구역 · 보기 ADMIN · 연결 확인 · 시험 메일 SUPER)
 *
 *   ① 준비 상태 다섯 줄 — 주소 · 사용자 이름 · 비밀번호 · 보내는 주소 · 스위치(notify.email_verified). 값은 보이지 않음(어디서 왔는지만)
 *   ② 「연결 확인」 — SES 에 붙어 첫 인사만(메일 안 보냄) · ③ 「시험 메일」 — 스위치가 꺼져 있어도 보냄(회원 알림은 그대로 안 나감 · 하루 한도)
 *   ④ 발송 기록 — 알림 메일 보냄 · 실패 · 대기 · 실패 까닭 · 최근 실패(주소 가림)
 *   ⑤ v10.154 (D147 · docs/234) — 「메일 켜기 전 시험 메일 확인」 줄(SUPER 가 바꿈) · 마지막 시험 메일 결과 — 켜져 있으면 7일 안 성공이 있어야 스위치를 켬
 *   ⑥ v10.209 (D186 · docs/334) — 반송 · 수신 거부 주소(받기 스위치 · SNS 주제 · 막힌 주소 가림 · 풀기 SUPER · 사유)
 *   사용자 이름 · 비밀번호는 위 「연동 키」(메일 줄)에서 넣습니다 — 운영 .env 수정 · 재시작 없이. 순서는 docs/167(절차서 v1.3).
 */

interface KeyState { set: boolean; source: 'ADMIN' | 'ENV' | 'NONE' }
interface Status {
  host: { value: string; source: 'ENV' | 'DEFAULT'; port: number }; user: KeyState; pass: KeyState;
  from: { set: boolean; value: string | null; source: 'SETTING' | 'ENV' | 'NONE' };
  switchOn: boolean; configured: boolean; ready: boolean; test: { limit: number; used: number; left: number };
  requireTest: boolean; lastTestOkAt: string | null; lastTest: { ok: boolean; errorKind: string | null; detail: string | null; at: string } | null;
}
interface Deliveries { days: number; sent: number; failed: number; queued: number; reasons: { reason: string; n: number }[]; recent: { at: string; event: string; reason: string | null; to: string | null }[] }
type Result = { ok: boolean; text: string } | null;
interface Suppressions {
  feedback: { switchOn: boolean; topicSet: boolean; lastAt: string | null };
  counts: { active: number; bounce: number; complaint: number; released: number };
  week: { bounce: number; complaint: number; delivery: number };
  items: { id: string; email: string; reason: 'BOUNCE' | 'COMPLAINT'; detail: string | null; hits: number; firstAt: string; lastAt: string; releasedAt: string | null; releaseNote: string | null }[];
}

const SRC: Record<string, string> = { ADMIN: '연동 키(이 화면)', ENV: '.env', NONE: '없음', DEFAULT: '기본값(서울 SES)', SETTING: '사이트 설정 notify.mail_from' };
const KIND: Record<string, string> = {
  AUTH: '사용자 이름 · 비밀번호가 맞지 않습니다(SES 「SMTP 자격 증명」 값인지 확인).',
  REJECTED: 'SES 가 거절했습니다 — 샌드박스 중이면 SES 에서 인증한 주소로만 갑니다 · 보내는 도메인이 「확인됨」인지 확인.',
  TIMEOUT: '시간 안에 응답이 없습니다 — 서버에서 465 로 나가는 길을 확인.', NETWORK: '연결하지 못했습니다 — 서버에서 465 로 나가는 길 · 주소를 확인.',
  BAD_INPUT: '받는 주소 · 보내는 주소 형식을 확인.',
};

export function MailPanel() {
  const isSuper = tokenRoles().includes('SUPER');
  const [st, setSt] = useState<Status | null>(null);
  const [dv, setDv] = useState<Deliveries | null>(null);
  const [days, setDays] = useState(7);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<Result>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sp, setSp] = useState<Suppressions | null>(null);
  const [spState, setSpState] = useState<'active' | 'released'>('active');

  const load = () => api<Status>('/admin/mail/status').then(setSt).catch((e) => setErr(e?.message ?? '불러오지 못했습니다.'));
  useEffect(() => { void load(); }, []);
  useEffect(() => { api<Deliveries>(`/admin/mail/deliveries?days=${days}`).then(setDv).catch(() => setDv(null)); }, [days]);
  const loadSp = () => api<Suppressions>(`/admin/mail/suppressions?state=${spState}`).then(setSp).catch(() => setSp(null));
  useEffect(() => { void loadSp(); }, [spState]);

  async function release(id: string, email: string) {
    const note = window.prompt(`${email} 를 풀까요? 다시 알림 메일이 나갑니다(다시 반송되면 다시 막힘). 푸는 사유를 적어 주십시오(2 ~ 300자).`);
    if (note === null) return;
    setBusy(`rel-${id}`); setRes(null);
    try {
      await api(`/admin/mail/suppressions/${id}/release`, { method: 'POST', body: JSON.stringify({ note }) });
      setRes({ ok: true, text: `${email} 를 풀었습니다 — 감사 기록에 남습니다.` }); void loadSp();
    } catch (e) { setRes({ ok: false, text: (e as Error)?.message ?? '풀지 못했습니다.' }); }
    finally { setBusy(null); }
  }

  async function connect() {
    setBusy('connect'); setRes(null);
    try {
      const r = await api<{ ok: boolean; host: string; port: number; ms: number; errorKind?: string; error?: string }>('/admin/mail/connect', { method: 'POST', body: '{}' });
      setRes(r.ok ? { ok: true, text: `연결됨 — ${r.host}:${r.port} (${r.ms}ms). 메일은 보내지 않았습니다.` } : { ok: false, text: `${KIND[r.errorKind ?? ''] ?? '연결하지 못했습니다.'} (${r.error ?? ''})` });
    } catch (e) { setRes({ ok: false, text: (e as Error)?.message ?? '실패했습니다.' }); }
    finally { setBusy(null); }
  }
  async function test() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim())) { setRes({ ok: false, text: '받을 이메일 주소를 넣으십시오.' }); return; }
    if (!window.confirm(`${to.trim()} 로 시험 메일을 한 통 보낼까요? 회원 알림은 보내지 않습니다.`)) return;
    setBusy('test'); setRes(null);
    try {
      const r = await api<{ ok: boolean; to: string; errorKind: string | null; error: string | null; left: number }>('/admin/mail/test', { method: 'POST', body: JSON.stringify({ to: to.trim() }) });
      setRes(r.ok ? { ok: true, text: `보냄 — ${r.to}. 받은편지함(스팸함 아님)에 왔는지 · 원본 보기에서 spf · dkim · dmarc = pass 인지 확인하십시오. 오늘 남은 시험 ${r.left}통.` }
        : { ok: false, text: `보내지 못함 — ${KIND[r.errorKind ?? ''] ?? r.error ?? ''} 오늘 남은 시험 ${r.left}통.` });
      void load();
    } catch (e) { setRes({ ok: false, text: (e as Error)?.message ?? '실패했습니다.' }); }
    finally { setBusy(null); }
  }

  async function flipRequire() {
    const next = st?.requireTest ? 'off' : 'on';
    if (next === 'off' && !window.confirm('「메일 켜기 전 시험 메일 확인」을 끌까요? 시험 메일 없이 메일 스위치를 켤 수 있게 됩니다(설정이 틀리면 회원에게 「보냈습니다」인데 메일이 안 나갑니다).')) return;
    setBusy('require'); setRes(null);
    try {
      await api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'notify.require_mail_test', value: next }) });
      setRes({ ok: true, text: next === 'on' ? '시험 메일 확인을 켰습니다.' : '시험 메일 확인을 껐습니다 — 감사 기록에 남습니다.' }); void load();
    } catch (e) { setRes({ ok: false, text: (e as Error)?.message ?? '바꾸지 못했습니다.' }); }
    finally { setBusy(null); }
  }

  if (err) return <div data-mail-panel><h2 className="ad-s2">메일</h2><p className="warn-text" role="alert">{err}</p></div>;
  if (!st) return null;
  const row = (key: string, label: string, ok: boolean, now: string, fix: string) => (
    <tr key={key} data-mail-row={key} data-ok={ok ? 'y' : 'n'}><td>{label}</td><td>{ok ? '✓' : '✗'}</td><td>{now}</td><td className="muted">{ok ? '' : fix}</td></tr>
  );
  return (
    <div data-mail-panel>
      <h2 className="ad-s2">메일 <small className="dim">인증번호 · 알림 · 비밀번호 찾기 메일(Amazon SES) — 순서는 docs/167</small></h2>
      <p className="hint" data-mail-ready={st.ready ? 'y' : 'n'}>
        {st.ready ? '회원에게 메일이 나가고 있습니다.' : st.configured ? '설정은 다 있습니다 — 시험 메일로 받은편지함 도착을 확인한 뒤 사이트 설정 notify.email_verified 를 켜십시오(샌드박스 해제 뒤).' : '아직 메일을 보낼 수 없습니다 — ✗ 줄을 채우십시오.'}
      </p>
      <table className="tbl">
        <thead><tr><th>항목</th><th></th><th>지금</th><th>채우는 곳</th></tr></thead>
        <tbody>
          {row('host', 'SMTP 주소', true, `${st.host.value}:${st.host.port} · ${SRC[st.host.source]}`, '')}
          {row('user', 'SMTP 사용자 이름', st.user.set, SRC[st.user.source] ?? st.user.source, '위 「연동 키」 › 메일 · SMTP 사용자 이름')}
          {row('pass', 'SMTP 비밀번호', st.pass.set, SRC[st.pass.source] ?? st.pass.source, '위 「연동 키」 › 메일 · SMTP 비밀번호')}
          {row('from', '보내는 주소', st.from.set, st.from.value ? `${st.from.value} · ${SRC[st.from.source]}` : '없음', '사이트 설정 notify.mail_from = no-reply@mail.sogaebank.com')}
          {row('switch', '알림 메일 스위치', st.switchOn, st.switchOn ? '켜짐' : '꺼짐(회원에게 안 나감)', '시험 메일 확인 · 샌드박스 해제 뒤 사이트 설정 notify.email_verified = on')}
        </tbody>
      </table>
      <p className="hint" data-mail-check={st.lastTestOkAt ? 'ok' : 'none'}>
        마지막 시험 메일: {st.lastTest ? `${ymdKst(st.lastTest.at)} ${st.lastTest.ok ? '성공' : `실패(${st.lastTest.errorKind ?? ''})`} — ${st.lastTest.detail ?? ''}` : '없음'}
        {st.lastTestOkAt ? ` · 7일 안 성공 있음(${ymdKst(st.lastTestOkAt)})` : ' · 7일 안 성공 없음'}
      </p>
      <p className="hint" data-mail-require-test={st.requireTest ? 'on' : 'off'}>
        메일 켜기 전 시험 메일 확인 — <b>{st.requireTest ? '켜짐' : '꺼짐'}</b>
        {st.requireTest ? ' (설정 · 7일 안 시험 메일 성공이 있어야 알림 메일 스위치를 켤 수 있음)' : ' (설정 · 시험 없이 스위치를 켤 수 있음)'}
        {isSuper && <>{' '}<button className="btn-sm" disabled={busy === 'require'} onClick={() => void flipRequire()} data-mail-require-flip>{st.requireTest ? '끄기' : '켜기'}</button></>}
      </p>
      {isSuper && (
        <div className="row-actions" style={{ marginTop: 10 }}>
          <button className="btn-sm" disabled={busy === 'connect'} onClick={() => void connect()} data-mail-connect>연결 확인</button>
          <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="시험 메일 받을 주소" size={28} aria-label="시험 메일 받을 주소" data-mail-to />
          <button className="btn-sm" disabled={busy === 'test' || !st.configured || st.test.left <= 0} onClick={() => void test()} data-mail-test>시험 메일 보내기</button>
          <span className="muted">오늘 남은 시험 {st.test.left} / {st.test.limit}통</span>
        </div>
      )}
      {res && <p className={res.ok ? 'form-ok' : 'warn-text'} role="status" data-mail-result={res.ok ? 'ok' : 'fail'}>{res.text}</p>}
      {dv && (
        <div data-mail-deliveries style={{ marginTop: 12 }}>
          <h3 className="sec">알림 메일 발송 기록{' '}
            {[1, 7, 30].map((d) => <button key={d} className={`btn-sm${d === days ? ' on' : ''}`} onClick={() => setDays(d)} aria-pressed={d === days}>{d}일</button>)}</h3>
          <p>보냄 <b data-mail-stat="sent">{dv.sent}</b> · 실패 <b data-mail-stat="failed">{dv.failed}</b> · 대기 <b data-mail-stat="queued">{dv.queued}</b>
            {dv.reasons.length > 0 && <> — 실패 까닭 {dv.reasons.map((r) => `${r.reason} ${r.n}`).join(' · ')}</>}</p>
          {dv.recent.length > 0 && (
            <table className="tbl"><thead><tr><th>알림 시각</th><th>알림</th><th>받는 주소</th><th>까닭</th></tr></thead>
              <tbody>{dv.recent.map((r, i) => <tr key={i} data-mail-fail><td>{ymdKst(r.at)}</td><td>{r.event}</td><td>{r.to ?? '-'}</td><td>{r.reason ?? '-'}</td></tr>)}</tbody></table>
          )}
          <p className="hint">특정 회원에게만 안 가는데 기록이 「보냄」이면 SES 억제 목록에 그 주소가 있는지 보십시오(docs/167 4절).</p>
        </div>
      )}
      {sp && (
        <div data-mail-suppress style={{ marginTop: 12 }}>
          <h3 className="sec">반송 · 수신 거부 주소{' '}
            {(['active', 'released'] as const).map((k) => <button key={k} className={`btn-sm${k === spState ? ' on' : ''}`} onClick={() => setSpState(k)} aria-pressed={k === spState}>{k === 'active' ? '막힘' : '푼 주소'}</button>)}</h3>
          <p className="hint" data-mail-feedback={sp.feedback.switchOn && sp.feedback.topicSet ? 'on' : 'off'}>
            받기 — <b>{sp.feedback.switchOn ? '켜짐' : '꺼짐'}</b> · SNS 주제 {sp.feedback.topicSet ? '있음' : '없음'}
            {sp.feedback.lastAt ? ` · 마지막 알림 ${ymdKst(sp.feedback.lastAt)}` : ' · 받은 알림 없음'}
            {!(sp.feedback.switchOn && sp.feedback.topicSet) && ' — SES 에서 SNS 주제를 만들고 사이트 설정 notify.ses_topic_arn 을 넣은 뒤 notify.ses_feedback 을 켜십시오(docs/334).'}
          </p>
          <p>막힌 주소 <b data-mail-suppress-stat="active">{sp.counts.active}</b>(영구 반송 {sp.counts.bounce} · 수신 거부 {sp.counts.complaint}) · 푼 주소 {sp.counts.released}
            {' '}— 최근 7일 받은 알림: 반송 {sp.week.bounce} · 수신 거부 {sp.week.complaint}</p>
          {sp.items.length > 0 ? (
            <table className="tbl"><thead><tr><th>주소</th><th>까닭</th><th>횟수</th><th>마지막</th><th>{spState === 'active' ? '' : '푼 사유'}</th></tr></thead>
              <tbody>{sp.items.map((r) => (
                <tr key={r.id} data-mail-suppress-row={r.reason}>
                  <td>{r.email}</td><td>{r.reason === 'BOUNCE' ? '영구 반송' : '수신 거부'}{r.detail ? ` · ${r.detail}` : ''}</td><td>{r.hits}</td><td>{ymdKst(r.lastAt)}</td>
                  <td>{spState === 'active'
                    ? (isSuper && <button className="btn-sm" disabled={busy === `rel-${r.id}`} onClick={() => void release(r.id, r.email)} data-mail-suppress-release>풀기</button>)
                    : <span className="muted">{r.releaseNote ?? ''}</span>}</td>
                </tr>))}</tbody></table>
          ) : <p className="muted">{spState === 'active' ? '막힌 주소가 없습니다.' : '푼 주소가 없습니다.'}</p>}
          <p className="hint">막힌 주소에는 알림 메일을 보내지 않고 발송 기록에 「SUPPRESSED」로 남깁니다. 수신 거부는 회원이 스팸 신고를 한 것이라 함부로 풀지 마십시오.</p>
        </div>
      )}
    </div>
  );
}
