'use client';
/**
 * v10.599 (docs/741) SB-MYP-GRW-020 나의공간 › 알림 「하루 요약 받기」 — GET · PUT /api/v1/me/grw/digest
 *   서버 화면이 지금 값과 글자(grw.digest 사전)를 넘겨 줌 · 스위치(grw.digest)가 꺼져 있으면 서버 화면이 그리지 않음
 */
import { useState } from 'react';

type L = Record<'title' | 'on' | 'off' | 'turnOn' | 'turnOff' | 'note' | 'mailWait' | 'failed', string>;

export function DigestToggle({ initial, emailReady, labels }: { initial: boolean; emailReady: boolean; labels: L }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  async function flip() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/v1/me/grw/digest', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !on }) });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setMsg({ ok: false, t: j?.message ?? labels.failed }); return; }
      setOn(!on); setMsg({ ok: true, t: j?.note ?? '' });
    } catch { setMsg({ ok: false, t: labels.failed }); } finally { setBusy(false); }
  }
  return (
    <div className="card p2pad" data-screen="SB-MYP-GRW-020" data-grw-digest={on ? 'on' : 'off'}>
      <p><b>{labels.title}</b> — {on ? labels.on : labels.off}{' '}
        <button type="button" className="my-bo sm" disabled={busy} onClick={() => void flip()} data-grw-digest-toggle="">{on ? labels.turnOff : labels.turnOn}</button></p>
      <p className="my-ps">{labels.note}{!emailReady && <> {labels.mailWait}</>}</p>
      {msg && <p className={msg.ok ? 'my-ps' : 'warn-text'} role={msg.ok ? 'status' : 'alert'}>{msg.t}</p>}
    </div>
  );
}
