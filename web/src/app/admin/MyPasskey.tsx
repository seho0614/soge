/* ===== v10.484 (D268 · docs/622) 운영자 패스키 — web/src/app/admin/MyPasskey.tsx 새 파일 =====
 * 권한 계층 › 내 2단계 인증 화면 아래 「패스키」 구역(SB-ADM-SCU-020 · 새 탭 아님 — 옛 시험이 보는 메뉴 글자를 바꾸지 않으려고)
 *   모든 운영 역할  내 패스키 등록 · 이름 · 끄기 · 지금 확인
 *   SUPER           설정(켜기 · 방식 EXTRA / REPLACE_MFA · 도메인) · 모든 운영자 패스키 · 남의 패스키 끄기(분실 · 퇴사)
 * (App.tsx 연결 줄은 patches/1_wiring.md)
 */
import { useState } from 'react';
import { api, setToken, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { passkeySupported, registerPasskey, verifyPasskey, type PasskeyStatus } from '../../lib/passkey';

const MODE: Record<string, string> = { EXTRA: '추가 확인(비밀번호 · 2단계 인증 뒤 한 번 더)', REPLACE_MFA: '2단계 인증 대신(인증 앱 번호 없이)' };
const ALG: Record<number, string> = { [-7]: 'ES256', [-8]: 'EdDSA', [-257]: 'RS256' };
interface StaffKeys { settings: { on: boolean; mode: string; rpId: string; hours: number };
  items: Array<{ id: string; email: string; name: string | null; label: string; alg: number; rpId: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null; revokeReason: string | null; me: boolean }> }

function SuperBox({ onChange }: { onChange: () => void }) {
  const q = useApi<StaffKeys>('/admin/passkeys');
  const a = useAct();
  const [f, setF] = useState<{ rpId: string; mode: string; reason: string } | null>(null);
  const d = q.data;
  if (!d) return null;
  const s = d.settings;
  const save = (body: Record<string, unknown>) => void a.run('pol', () => api('/admin/passkeys/policy', { method: 'PUT', body: JSON.stringify(body) }), () => { setF(null); q.reload(); onChange(); });
  return (
    <div className="card pad" data-passkey-super={s.on ? 'on' : 'off'}>
      <Flash msg={a.msg} err={a.err} />
      <b>패스키 설정(최고 관리자)</b>
      <table className="tbl"><tbody>
        <tr><th>켜짐</th><td data-passkey-on={s.on ? 'on' : 'off'}>{s.on ? '켜짐' : '꺼짐(처음)'}</td></tr>
        <tr><th>방식</th><td data-passkey-mode={s.mode}>{MODE[s.mode] ?? s.mode}</td></tr>
        <tr><th>도메인</th><td className="mono">{s.rpId || <span className="warn-text">비어 있음 — 켜기 전에 넣어야 함</span>}</td></tr>
        <tr><th>확인 유효</th><td>{s.hours}시간(2단계 인증과 같음 · admin.mfa_hours)</td></tr>
      </tbody></table>
      {f == null ? (
        <p><button className="btn-sm" onClick={() => setF({ rpId: s.rpId || location.hostname.replace(/^admin\./, ''), mode: s.mode, reason: '' })} data-passkey-edit="">설정 바꾸기</button></p>
      ) : (
        <p data-passkey-form="">
          <label>도메인 <input className="inp" value={f.rpId} onChange={(e) => setF({ ...f, rpId: e.target.value.trim().toLowerCase() })} placeholder="sogaebank.com" /></label>{' '}
          <label>방식 <select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{Object.entries(MODE).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>{' '}
          <label>사유 <input className="inp" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="2 ~ 200자" /></label>{' '}
          <button className="btn-sm" disabled={!!a.busy} onClick={() => save({ rpId: f.rpId, mode: f.mode, reason: f.reason })} data-passkey-save="">저장</button>{' '}
          <button className="btn-sm" disabled={!!a.busy} onClick={() => { if (confirm(s.on ? '패스키를 끕니다 — 확인 · 등록이 멈춥니다.' : '패스키를 켭니다 — 운영자가 등록할 수 있게 됩니다.')) save({ on: !s.on, reason: f.reason || (s.on ? '패스키 끔' : '패스키 켬') }); }} data-passkey-toggle="">{s.on ? '끄기' : '켜기'}</button>{' '}
          <button className="btn-sm btn-plain" onClick={() => setF(null)}>닫기</button>
        </p>
      )}
      <small className="dim">REPLACE_MFA 는 패스키 확인을 「2단계 확인됨」으로 봅니다(세무사 포함). 도메인을 바꾸면 그 전 패스키는 쓸 수 없습니다.</small>
      <table className="tbl" data-passkey-staff={d.items.length}><thead><tr><th>운영자</th><th>이름</th><th>알고리즘</th><th>도메인</th><th>만든 때</th><th>마지막 씀</th><th>상태</th><th></th></tr></thead>
        <tbody>{d.items.map((k) => (
          <tr key={k.id}><td>{k.name ?? ''} <span className="mono">{k.email}</span>{k.me ? ' · 나' : ''}</td><td>{k.label}</td><td>{ALG[k.alg] ?? k.alg}</td><td className="mono">{k.rpId}</td>
            <td>{ymdhm(k.createdAt)}</td><td>{ymdhm(k.lastUsedAt)}</td><td>{k.revokedAt ? <span className="dim">끔 · {k.revokeReason}</span> : '씀'}</td>
            <td>{!k.revokedAt && !k.me && <button className="btn-sm btn-plain" onClick={() => {
              const why = prompt('끄는 사유(5 ~ 200자 · 예: 노트북 분실)') ?? '';
              if (why.trim().length >= 5) void a.run('rv' + k.id, () => api(`/admin/passkeys/${k.id}/revoke`, { method: 'POST', body: JSON.stringify({ reason: why }) }), q.reload);
            }}>끄기</button>}</td></tr>
        ))}</tbody></table>
    </div>
  );
}

export function MyPasskey() {
  const q = useApi<PasskeyStatus>('/auth/passkey');
  const a = useAct();
  const [label, setLabel] = useState('');
  const isSuper = tokenRoles().includes('SUPER');
  const s = q.data;
  if (!s) return null;
  return (
    <section data-my-passkey={s.enrolled} id="passkey">
      <h3 className="sec">패스키(지문 · 얼굴 · 보안 키)</h3>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl"><tbody>
        <tr><th>지금 설정</th><td data-passkey-state={s.on ? 'on' : 'off'}>{s.on ? `켜짐 · ${MODE[s.mode] ?? s.mode}` : '꺼짐 — 최고 관리자가 켜야 등록할 수 있습니다'}{s.on && !s.rpReady ? ' · 도메인이 비어 있음' : ''}</td></tr>
        <tr><th>이 기기 확인</th><td data-passkey-verified={s.verified ? '1' : '0'}>{s.verified ? `확인함(${s.hours}시간 안)` : '확인 안 함'}{!s.sessionKnown ? ' · 옛 로그인(다시 로그인하면 기록됨)' : ''}</td></tr>
      </tbody></table>
      {!!s.items.length && (
        <table className="tbl" data-passkey-mine={s.items.length}><thead><tr><th>이름</th><th>알고리즘</th><th>만든 때</th><th>마지막 씀</th><th></th></tr></thead>
          <tbody>{s.items.map((k) => (
            <tr key={k.id}><td>{k.label}{!k.usable && <span className="warn-text"> · 다른 도메인({k.rpId}) — 쓸 수 없음</span>}</td><td>{ALG[k.alg] ?? k.alg}</td><td>{ymdhm(k.createdAt)}</td><td>{ymdhm(k.lastUsedAt)}</td>
              <td><button className="btn-sm btn-plain" onClick={() => { if (confirm(`패스키 「${k.label}」를 끕니다.`)) void a.run('off' + k.id, () => api(`/auth/passkey/${k.id}/revoke`, { method: 'POST', body: JSON.stringify({ reason: '본인이 끔' }) }), q.reload); }}>끄기</button></td></tr>
          ))}</tbody></table>
      )}
      {s.canRegister && (
        <p data-passkey-register="">
          <input className="inp" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="이름(예: 사무실 노트북 지문)" />{' '}
          <button className="btn-ok" disabled={!!a.busy || !label.trim() || !passkeySupported()} onClick={() => void a.run('reg', () => registerPasskey(label.trim()), () => { setLabel(''); q.reload(); })} data-passkey-add="">패스키 등록</button>
          {!passkeySupported() && <small className="warn-text"> 이 브라우저는 패스키를 지원하지 않습니다.</small>}
        </p>
      )}
      {s.on && s.enrolled > 0 && (
        <p><button className="btn-sm" disabled={!!a.busy} onClick={() => void a.run('ver', async () => { const r = await verifyPasskey(); if (r.accessToken && r.refreshToken) setToken(r.accessToken, r.refreshToken); return r; }, q.reload)} data-passkey-check="">지금 패스키로 확인</button></p>
      )}
      <div className="ad-nt info">패스키는 이 계정의 비밀번호를 대신하지 않습니다 — 로그인은 늘 비밀번호로 하고, 그 뒤 확인 단계에서 씁니다. 기기를 잃어버렸으면 최고 관리자에게 「끄기」를 요청하십시오.</div>
      {isSuper && <SuperBox onChange={q.reload} />}
    </section>
  );
}
