'use client';
/**
 * v10.31 (시안 myntf 「수신 설정」 표) — 종류 · 인앱 · 이메일 · 수신거부.
 * GET /me/notification-prefs 로 받은 표를 그리고, 수신거부할 수 있는 종류만 인앱 칸을 끄고 켤 수 있습니다(PATCH /me/notification-prefs).
 * 돈 · 계약이 걸린 알림은 「불가」와 까닭을 보입니다. 이메일은 도메인 인증 전이라 「미준비」.
 */
import { useState } from 'react';

export interface Pref { eventCode: string; name: string; optoutAllowed: boolean; reason: string | null; inapp: boolean; email: boolean }

export function NotificationPrefs({ items, emailReady }: { items: Pref[]; emailReady: boolean }) {
  const [rows, setRows] = useState(items);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  async function toggle(p: Pref) {
    setBusy(p.eventCode); setMsg(null);
    try {
      const r = await fetch('/api/v1/me/notification-prefs', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventCode: p.eventCode, channel: 'INAPP', enabled: !p.inapp }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setMsg({ ok: false, t: j?.message ?? '바꾸지 못했습니다.' }); return; }
      setRows((xs) => xs.map((x) => (x.eventCode === p.eventCode ? { ...x, inapp: !p.inapp } : x)));
      setMsg({ ok: true, t: `「${p.name}」 — ${j?.note ?? '바꿨습니다.'}` });
    } catch { setMsg({ ok: false, t: '연결하지 못했습니다. 잠시 뒤 다시 시도해 주십시오.' }); }
    finally { setBusy(null); }
  }

  return (
    <div data-ntf-prefs="">
      <div className="my-tw">
        <table className="my-tb2 my-prefs">
          <thead><tr><th>종류</th><th>인앱</th><th>이메일</th><th>수신거부</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.eventCode} data-pref={p.eventCode}>
                <td>{p.name}</td>
                <td>
                  {p.optoutAllowed ? (
                    <label className="my-sw">
                      <input type="checkbox" checked={p.inapp} disabled={busy === p.eventCode} onChange={() => toggle(p)} aria-label={`${p.name} 인앱 알림`} />
                      {p.inapp ? '켬' : '끔'}
                    </label>
                  ) : '켬'}
                </td>
                <td>{emailReady ? (p.email ? '켬' : '끔') : <span className="my-ls">미준비</span>}</td>
                <td>{p.optoutAllowed ? <span className="my-ls">가능</span> : <><b>불가</b> <span className="my-ls">{p.reason ?? '돈 · 계약이 걸린 안내'}</span></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <p className={`my-ls ${msg.ok ? '' : 'warnx'}`} role="status">{msg.t}</p>}
    </div>
  );
}
