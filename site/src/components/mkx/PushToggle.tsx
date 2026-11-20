'use client';
/**
 * v10.538 (D283 · docs/676) 이 브라우저 웹 푸시 켜기 · 끄기 · 시험 — 글자는 서버 화면이 넘김(사전 묶음을 브라우저로 보내지 않음)
 *   켜기: 알림 허락 → 이미 등록된 서비스 워커(/sw.js · site.pwa)의 pushManager.subscribe(VAPID 공개 키) → POST /api/v1/me/push/subscribe
 *   서비스 워커가 없으면(앱처럼 설치 꺼짐 · 개발 화면) 안내만 — 여기서 따로 등록하지 않음(PwaRegister 가 정본)
 */
import { useEffect, useState } from 'react';

type L = Record<'on' | 'off' | 'test' | 'busy' | 'unsupported' | 'noWorker' | 'denied' | 'turnedOn' | 'turnedOff' | 'failed' | 'here', string>;

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
const b64u = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '');
function uaName(): string {
  const u = navigator.userAgent;
  const b = /Edg\//.test(u) ? 'Edge' : /Chrome\//.test(u) ? 'Chrome' : /Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : 'Browser';
  const o = /Android/.test(u) ? 'Android' : /iPhone|iPad/.test(u) ? 'iOS' : /Windows/.test(u) ? 'Windows' : /Mac OS/.test(u) ? 'macOS' : '';
  return `${b}${o ? ` (${o})` : ''}`;
}

export function PushToggle({ publicKey, labels }: { publicKey: string; labels: L }) {
  const [state, setState] = useState<'checking' | 'unsupported' | 'noworker' | 'off' | 'on'>('checking');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setState('unsupported'); return; }
    navigator.serviceWorker.getRegistration('/').then(async (reg) => {
      if (!reg) { setState('noworker'); return; }
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? 'on' : 'off');
    }).catch(() => setState('noworker'));
  }, []);

  async function turnOn() {
    setBusy(true); setMsg(null);
    try {
      if ((await Notification.requestPermission()) !== 'granted') { setMsg(labels.denied); return; }
      const reg = await navigator.serviceWorker.getRegistration('/');
      if (!reg) { setState('noworker'); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const r = await fetch('/api/v1/me/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint, p256dh: b64u(sub.getKey('p256dh')), auth: b64u(sub.getKey('auth')), ua: uaName() }) });
      const j = await r.json().catch(() => null);
      if (!r.ok) { await sub.unsubscribe().catch(() => undefined); setMsg(j?.message ?? labels.failed); return; }
      setState('on'); setMsg(labels.turnedOn);
    } catch { setMsg(labels.failed); } finally { setBusy(false); }
  }

  async function turnOff() {
    setBusy(true); setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await fetch('/api/v1/me/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
        await sub.unsubscribe().catch(() => undefined);
      }
      setState('off'); setMsg(labels.turnedOff);
    } catch { setMsg(labels.failed); } finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/v1/me/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json().catch(() => null);
      setMsg(j?.note ?? j?.message ?? (r.ok ? labels.turnedOn : labels.failed));
    } catch { setMsg(labels.failed); } finally { setBusy(false); }
  }

  if (state === 'checking') return null;
  if (state === 'unsupported') return <p className="my-ls" data-mkx-push-state="unsupported">{labels.unsupported}</p>;
  if (state === 'noworker') return <p className="my-ls" data-mkx-push-state="noworker">{labels.noWorker}</p>;
  return (
    <div data-mkx-push-state={state}>
      <p>
        <b>{labels.here}</b>{' '}
        {state === 'on'
          ? <button type="button" className="my-bo" disabled={busy} onClick={() => void turnOff()}>{busy ? labels.busy : labels.off}</button>
          : <button type="button" className="my-bp" disabled={busy} onClick={() => void turnOn()}>{busy ? labels.busy : labels.on}</button>}{' '}
        {state === 'on' && <button type="button" className="my-bo sm" disabled={busy} onClick={() => void test()}>{labels.test}</button>}
      </p>
      {msg && <p className="my-ls" role="status">{msg}</p>}
    </div>
  );
}
