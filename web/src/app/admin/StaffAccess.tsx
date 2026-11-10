import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api, tokenRoles } from '../../lib/api';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import type { IpStatus } from '../../components/IpGate';

type Allow = { id: string; ip: string; memo: string; createdAt: string; createdBy: string | null };
type Staff = { id: string; email: string; name: string | null; roles: string[]; personalChat: boolean; phoneLast4: string | null; receive: string | null; todayPasses: number; lastVerifiedAt: string | null };
type Row = { at: string; kind: string; email: string; ip: string | null; channel: string };
type Overview = { on: boolean; mode: string; sms: { ready: boolean }; telegram: { ready: boolean; reason: string | null; opsChat: string | null }; allow: Allow[]; staff: Staff[]; recent: Row[]; myIp: string | null; myIpFull: string | null };

const CH: Record<string, string> = { TELEGRAM_ME: '개인 텔레그램', TELEGRAM_OPS: '운영 대화방', SMS: '문자' };
const MODE: Record<string, string> = { TELEGRAM: '텔레그램', SMS: '문자(휴대폰)', SMS_THEN_TELEGRAM: '문자 · 안 되면 텔레그램' };
const KIND: Record<string, string> = { VERIFIED: '인증함', SENT: '번호 보냄', USED: '번호 씀', EXPIRED: '번호 만료', LOCKED: '5번 틀려 막힘' };

/**
 * SB-ADM-SIP-010 운영 화면 접속 인증 (v10.226 · D195 · docs/363)
 *
 *   모든 운영 역할 — 내 상태 · 내 인증번호 받을 곳(개인 텔레그램 대화 번호).
 *   ADMIN · SUPER — 스위치(켜기 SUPER) · 허용 IP(SUPER) · 운영자별 받을 곳(SUPER) · 오늘 인증 · 최근 14일 기록.
 *   운영 Nginx 의 IP 제한은 그대로(대표 11/10 — 문자 연동 뒤 풂 · docs/363 5절).
 */
export function StaffAccess() {
  const me = useApi<IpStatus>('/auth/ip-verify');
  const roles = tokenRoles();
  const isSuper = roles.includes('SUPER');
  const canSee = isSuper || roles.includes('ADMIN');
  const ov = useApi<Overview>(canSee ? '/admin/staff-access' : '/auth/ip-verify');   // 운영 역할 중 ADMIN · SUPER 아니면 쓰지 않음(403 을 남기지 않게 같은 상태 주소)
  const a = useAct();
  const [myChat, setMyChat] = useState('');
  const [ip, setIp] = useState('');
  const [memo, setMemo] = useState('');
  const [chats, setChats] = useState<Record<string, string>>({});
  const [phone, setPhone] = useState('');
  const [pcode, setPcode] = useState('');
  const [psent, setPsent] = useState(false);
  const [mode, setMode] = useState('');
  const reload = () => { me.reload(); ov.reload(); };
  const d = ov.data;
  return (
    <section data-staff-access="">
      {me.data && (
        <table className="tbl"><tbody>
          <tr><th>접속 인증</th><td data-ip-on={me.data.on ? '1' : '0'}>{me.data.on ? '켜짐 — 허용 IP 밖에서는 그날 한 번 인증번호' : '꺼짐 — 오픈 전(인증 없이)'}</td></tr>
          <tr><th>지금 접속 주소</th><td>{me.data.ip ?? '모름'} · {me.data.verified ? '들어올 수 있음' : '인증 필요'}</td></tr>
          <tr><th>내 받을 곳</th><td data-my-receive={me.data.channel ?? ''}>{me.data.channel ? CH[me.data.channel] : '없음'}</td></tr>
        </tbody></table>
      )}
      <p data-my-chat="">
        <label>내 텔레그램 대화 번호{' '}
          <input name="my-chat" value={myChat} onChange={(e) => setMyChat(e.target.value.trim())} placeholder="예: 123456789 · 비우면 운영 대화방" inputMode="numeric" maxLength={21} />
        </label>{' '}
        <button className="btn-sm" disabled={a.busy === 'my-chat'} data-my-chat-save=""
          onClick={() => void a.run('my-chat', () => api('/me/staff/telegram', { method: 'PUT', body: JSON.stringify({ chat: myChat || null }) }), () => { setMyChat(''); reload(); }, '저장했습니다.')}>저장</button>
        <small className="dim"> 봇에게 먼저 아무 말이나 보낸 뒤, 최고 관리자가 「외부 연동 › 텔레그램 대화방 찾기」로 번호를 알려 줍니다.</small>
      </p>
      {/* v10.227 (D196) — 내 휴대폰: 그 번호로 받은 확인 번호를 넣어야 등록 */}
      <p data-my-phone="">
        <label>내 휴대폰{' '}
          <input name="my-phone" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^0-9-]/g, ''))} placeholder="010-0000-0000" inputMode="tel" maxLength={13} />
        </label>{' '}
        <button className="btn-sm" disabled={a.busy === 'phone' || phone.replace(/\D/g, '').length < 10} data-my-phone-send=""
          onClick={() => void a.run('phone', () => api<{ phoneLast4: string; minutes: number }>('/me/staff/phone', { method: 'POST', body: JSON.stringify({ phone }) }), () => setPsent(true),
            (r) => `끝 ${r.phoneLast4} 휴대폰으로 확인 번호를 보냈습니다 — ${r.minutes}분 안에 넣으십시오.`)}>확인 번호 받기</button>
        {psent && <>{' '}
          <input name="my-phone-code" value={pcode} onChange={(e) => setPcode(e.target.value.replace(/\D/g, ''))} placeholder="6자리" inputMode="numeric" maxLength={6} style={{ width: 90 }} />{' '}
          <button className="btn-ok" disabled={a.busy === 'pconfirm' || pcode.length !== 6} data-my-phone-confirm=""
            onClick={() => void a.run('pconfirm', () => api('/me/staff/phone/confirm', { method: 'POST', body: JSON.stringify({ code: pcode }) }), () => { setPsent(false); setPcode(''); setPhone(''); reload(); }, '휴대폰을 등록했습니다.')}>확인</button>
        </>}
        <small className="dim"> 문자 길(알림톡)이 준비돼야 받습니다 · 기록에는 끝 4자리만</small>
      </p>

      {canSee && d && (<>
        <h3 className="sec">스위치</h3>
        <p data-ip-switch="">
          <b>{d.on ? '켜짐' : '꺼짐'}</b> · 텔레그램 {d.telegram.ready ? `준비됨(운영 대화방 ${d.telegram.opsChat})` : d.telegram.reason === 'NO_TOKEN' ? '봇 토큰 없음' : '운영 대화방 없음(개인 대화만)'}{' '}
          {isSuper && (
            <button className={d.on ? 'btn-no' : 'btn-ok'} disabled={a.busy === 'switch'} data-ip-toggle=""
              onClick={() => {
                const next = d.on ? 'off' : 'on';
                if (!confirm(next === 'on'
                  ? '접속 인증을 켭니다. 허용 IP 밖의 운영자는 다음 요청부터 그날 한 번 인증번호(텔레그램)를 넣어야 합니다. 지금 접속 주소가 허용 목록에 없으면 나도 인증해야 합니다.'
                  : '접속 인증을 끕니다(오픈 전 상태). 비밀번호만으로 어디서든 운영 화면에 들어올 수 있게 됩니다.')) return;
                void a.run('switch', () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'admin.ip_verify', value: next }) }), reload);
              }}>{d.on ? '끄기' : '켜기'}</button>
          )}
          <small className="dim"> 켜기는 최고 관리자 · 봇 토큰과 모든 운영자의 받을 곳이 있어야 켜짐 · 바꾸면 운영 알림 「중요 설정 바뀜」</small>
        </p>
        <p data-ip-mode={d.mode}>
          보내는 길 <b>{MODE[d.mode] ?? d.mode}</b> · 문자 {d.sms.ready ? '준비됨' : '준비 안 됨(알림톡 방식 · 키 · 템플릿 승인 · 켜기)'}{' '}
          {isSuper && <>
            <select name="ip-mode" value={mode || d.mode} onChange={(e) => setMode(e.target.value)}>
              {Object.entries(MODE).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>{' '}
            <button className="btn-sm" disabled={a.busy === 'mode' || !mode || mode === d.mode} data-ip-mode-save=""
              onClick={() => void a.run('mode', () => api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'admin.ip_verify_channel', value: mode }) }), () => { setMode(''); reload(); })}>바꾸기</button>
          </>}
          <small className="dim"> 켜진 채 바꾸면 새 길로 모든 운영자가 받을 수 있어야 바뀜</small>
        </p>

        <h3 className="sec">허용 IP <small className="dim">— 여기서는 인증 없이</small></h3>
        <table className="tbl" data-ip-allow=""><thead><tr><th>IP</th><th>메모</th><th>더한 사람 · 때</th>{isSuper && <th />}</tr></thead><tbody>
          {d.allow.length === 0 && <tr><td colSpan={4} className="dim">없음 — 켜면 모든 곳에서 인증</td></tr>}
          {d.allow.map((x) => (
            <tr key={x.id} data-ip-allow-row={x.ip}><td>{x.ip}</td><td>{x.memo}</td><td>{x.createdBy ?? '-'} · {ymdhm(x.createdAt)}</td>
              {isSuper && <td><button className="btn-sm" disabled={a.busy === `rm${x.id}`}
                onClick={() => { if (confirm(`${x.ip}(${x.memo})를 허용 목록에서 뺍니다.`)) void a.run(`rm${x.id}`, () => api(`/admin/staff-access/allow/${x.id}`, { method: 'DELETE' }), reload); }}>빼기</button></td>}
            </tr>
          ))}
        </tbody></table>
        {isSuper && (
          <p data-ip-allow-form="">
            <input name="allow-ip" value={ip} onChange={(e) => setIp(e.target.value.trim())} placeholder="IP 예: 121.168.92.13" maxLength={45} />{' '}
            <input name="allow-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모 예: 집" maxLength={100} />{' '}
            <button className="btn-ok" disabled={a.busy === 'add' || !ip || !memo.trim()} data-ip-allow-add=""
              onClick={() => void a.run('add', () => api('/admin/staff-access/allow', { method: 'POST', body: JSON.stringify({ ip, memo }) }), () => { setIp(''); setMemo(''); reload(); })}>더하기</button>{' '}
            {d.myIpFull && <button className="btn-sm" onClick={() => setIp(d.myIpFull!)} data-ip-mine="">지금 주소 넣기</button>}
          </p>
        )}

        <h3 className="sec">운영자별 받을 곳 · 오늘 인증</h3>
        <table className="tbl" data-ip-staff=""><thead><tr><th>운영자</th><th>역할</th><th>받을 곳</th><th>휴대폰</th><th>오늘</th><th>마지막 인증</th>{isSuper && <th>개인 대화 번호(SUPER)</th>}</tr></thead><tbody>
          {d.staff.map((s) => (
            <tr key={s.id} data-ip-staff-row={s.email}>
              <td>{s.email}</td><td>{s.roles.join(' · ')}</td>
              <td className={s.receive ? '' : 'warn-text'}>{s.receive ? CH[s.receive] : '없음'}</td>
              <td data-ip-staff-phone={s.phoneLast4 ?? ''}>{s.phoneLast4 ? `끝 ${s.phoneLast4}` : '-'}{isSuper && s.phoneLast4 && <>{' '}<button className="btn-sm" disabled={a.busy === `p${s.id}`}
                onClick={() => { if (confirm(`${s.email} 의 휴대폰(끝 ${s.phoneLast4})을 지웁니다.`)) void a.run(`p${s.id}`, () => api(`/admin/staff-access/${s.id}/phone`, { method: 'DELETE' }), reload); }}>지우기</button></>}</td>
              <td>{s.todayPasses}</td><td>{s.lastVerifiedAt ? ymdhm(s.lastVerifiedAt) : '-'}</td>
              {isSuper && <td>
                <input name={`chat-${s.id}`} value={chats[s.id] ?? ''} onChange={(e) => setChats({ ...chats, [s.id]: e.target.value.trim() })} placeholder={s.personalChat ? '등록됨 · 바꾸려면 입력' : '비우면 운영 대화방'} maxLength={21} style={{ width: 150 }} />{' '}
                <button className="btn-sm" disabled={a.busy === `c${s.id}`}
                  onClick={() => void a.run(`c${s.id}`, () => api(`/admin/staff-access/${s.id}/telegram`, { method: 'PUT', body: JSON.stringify({ chat: chats[s.id] || null }) }), () => { setChats({ ...chats, [s.id]: '' }); reload(); }, '저장했습니다.')}>저장</button>{' '}
                <button className="btn-sm" disabled={a.busy === `t${s.id}` || !s.receive}
                  onClick={() => void a.run(`t${s.id}`, () => api<{ ok: boolean; reason: string | null }>(`/admin/staff-access/${s.id}/test`, { method: 'POST' }), undefined, (r) => r.ok ? '시험 글을 보냈습니다.' : `보내지 못했습니다(${r.reason})`)}>시험</button>
              </td>}
            </tr>
          ))}
        </tbody></table>

        <h3 className="sec">최근 14일 기록</h3>
        <p className="dim" data-ip-alert-note="">처음 보는 대역에서 통과 · 번호 5번 틀림 · 하루 10번 닿음은 운영 알림(급한 알림 메일 · 텔레그램)으로도 갑니다.</p>
        <table className="tbl" data-ip-recent=""><thead><tr><th>때</th><th>일</th><th>운영자</th><th>주소</th><th>받은 곳</th></tr></thead><tbody>
          {d.recent.length === 0 && <tr><td colSpan={5} className="dim">없음</td></tr>}
          {d.recent.map((r, i) => <tr key={i}><td>{ymdhm(r.at)}</td><td className={r.kind === 'LOCKED' ? 'warn-text' : ''}>{KIND[r.kind] ?? r.kind}</td><td>{r.email}</td><td>{r.ip ?? '-'}</td><td>{CH[r.channel] ?? r.channel}</td></tr>)}
        </tbody></table>
      </>)}
      <Flash msg={a.msg} err={a.err} />
      <div className="ad-nt info">운영 서버 Nginx 의 IP 제한(집 IP 하나)은 그대로입니다 — 문자 인증을 붙인 뒤 풉니다(docs/363). 그 전에도 사용자 웹 주소를 거친 운영 API 는 이 인증이 막습니다.</div>
    </section>
  );
}
