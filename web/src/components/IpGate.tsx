import { useState } from 'react';
import { ApiFailure, api, setToken } from '../lib/api';

/**
 * 운영 화면 접속 인증 (v10.226 · D195 · docs/363 · SB-ADM-SIP-010)
 *
 *   설정(admin.ip_verify)이 켜졌고 허용 IP 밖에서 오늘 처음 들어오면 이 화면만 — 텔레그램으로 6자리를 받아 넣음.
 *   맞으면 그 IP 는 한국 시간 그날 자정까지. 2단계 인증(MfaGate)을 마친 뒤에 나옵니다.
 */
export interface IpStatus { on: boolean; required: boolean; verified: boolean; ip: string | null; channel: string | null; ready: boolean; mode?: string }

const CH: Record<string, string> = { TELEGRAM_ME: '내 텔레그램', TELEGRAM_OPS: '운영 텔레그램 대화방', SMS: '내 휴대폰 문자' };
const msgOf = (e: unknown, f: string) => (e instanceof ApiFailure ? e.body.message : f);

export function IpGate({ status, onDone }: { status: IpStatus; onDone: () => void }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ channel: string; minutes: number; phoneLast4?: string }>('/auth/ip-verify/send', { method: 'POST' });
      setSent(true); setNote(`${CH[r.channel] ?? r.channel}${r.phoneLast4 ? `(끝 ${r.phoneLast4})` : ''}(으)로 보냈습니다 — ${r.minutes}분 안에 넣으십시오.`);
    } catch (e) { setMsg(msgOf(e, '보내지 못했습니다.')); } finally { setBusy(false); }
  }
  async function confirm(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await api('/auth/ip-verify/confirm', { method: 'POST', body: JSON.stringify({ code: code.trim() }) });
      onDone();
    } catch (err) { setMsg(msgOf(err, '확인하지 못했습니다.')); } finally { setBusy(false); }
  }
  return (
    <main className="bo-login" data-ip-gate="">
      <section className="bo-login-card" aria-labelledby="ip-title">
        <p className="bo-login-brand"><span className="d" aria-hidden />소개뱅크 <b>운영</b></p>
        <h1 id="ip-title">접속 인증</h1>
        <p className="bo-login-sub">처음 쓰는 곳({status.ip ?? '주소 모름'})에서 접속했습니다. 인증번호를 받아 넣으면 오늘 자정까지 이곳에서 운영 화면을 씁니다.</p>
        {!status.ready
          ? <p role="alert" className="bo-login-err" data-ip-noready="">인증번호를 받을 곳이 없습니다 — 최고 관리자에게 텔레그램 받을 곳 등록을 요청하십시오.</p>
          : <p><button type="button" className="sgb-btn bo-login-go" onClick={send} disabled={busy} data-ip-send="">
              {sent ? '번호 다시 받기' : `인증번호 받기(${CH[status.channel ?? ''] ?? '텔레그램'})`}</button></p>}
        {note && <p className="bo-login-sub" data-ip-sent="">{note}</p>}
        {sent && (
          <form onSubmit={confirm} className="bo-login-form" data-ip-confirm="">
            <label>인증번호<input name="ip-code" inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={6}
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></label>
            <button type="submit" className="sgb-btn sgb-btn--pri bo-login-go" disabled={busy || code.length !== 6}>{busy ? '확인 중…' : '확인'}</button>
          </form>
        )}
        {msg && <p role="alert" className="bo-login-err">{msg}</p>}
        <p className="bo-login-foot"><button type="button" className="btn-plain" onClick={() => setToken(null, null)} data-ip-logout="">다른 계정으로 로그인</button></p>
      </section>
    </main>
  );
}
