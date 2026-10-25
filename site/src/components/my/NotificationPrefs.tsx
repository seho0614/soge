'use client';
/**
 * v10.31 (시안 myntf 「수신 설정」 표) — 종류 · 인앱 · 이메일 · 수신거부.
 * GET /me/notification-prefs 로 받은 표를 그리고, 수신거부할 수 있는 종류만 인앱 칸을 끄고 켤 수 있습니다(PATCH /me/notification-prefs).
 * 돈 · 계약이 걸린 알림은 「불가」와 까닭을 보입니다. 이메일은 도메인 인증 전이라 「미준비」.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';

export interface Pref { eventCode: string; name: string; optoutAllowed: boolean; reason: string | null; inapp: boolean; email: boolean }

export function NotificationPrefs({ items, emailReady }: { items: Pref[]; emailReady: boolean }) {
  const t = useTranslations('my.prefs');
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
      if (!r.ok) { setMsg({ ok: false, t: j?.message ?? t('failed') }); return; }
      setRows((xs) => xs.map((x) => (x.eventCode === p.eventCode ? { ...x, inapp: !p.inapp } : x)));
      setMsg({ ok: true, t: t('done', { name: p.name, note: j?.note ?? t('changed') }) });
    } catch { setMsg({ ok: false, t: t('network') }); }
    finally { setBusy(null); }
  }

  return (
    <div data-ntf-prefs="">
      <div className="my-tw">
        <table className="my-tb2 my-prefs">
          <thead><tr><th>{t('thKind')}</th><th>{t('thInapp')}</th><th>{t('thEmail')}</th><th>{t('thOptout')}</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.eventCode} data-pref={p.eventCode}>
                <td>{p.name}</td>
                <td>
                  {p.optoutAllowed ? (
                    <label className="my-sw">
                      <input type="checkbox" checked={p.inapp} disabled={busy === p.eventCode} onChange={() => toggle(p)} aria-label={t('inappAria', { name: p.name })} />
                      {p.inapp ? t('on') : t('off')}
                    </label>
                  ) : t('on')}
                </td>
                <td>{emailReady ? (p.email ? t('on') : t('off')) : <span className="my-ls">{t('notReady')}</span>}</td>
                <td>{p.optoutAllowed ? <span className="my-ls">{t('allowed')}</span> : <><b>{t('notAllowed')}</b> <span className="my-ls">{p.reason ?? t('reasonDefault')}</span></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <p className={`my-ls ${msg.ok ? '' : 'warnx'}`} role="status">{msg.t}</p>}
    </div>
  );
}
