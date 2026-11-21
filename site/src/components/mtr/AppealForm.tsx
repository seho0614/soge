'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * v10.573 (docs/715) 이의 내기 — 대상 하나 · 10 ~ 1000자 · POST /me/mtr/appeals
 *   서버가 기간 · 한 번 · 내 것인지를 다시 봄(이 화면은 글자 수만)
 */
export function AppealForm({ targetType, targetId, min, max }: { targetType: string; targetId: string; min: number; max: number }) {
  const t = useTranslations('mtr');
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setErr(null); setMsg(null);
    if (body.trim().length < min) { setErr(t('short')); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/v1/me/mtr/appeals', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, body: body.trim() }) });
      const b = (await r.json().catch(() => ({}))) as { message?: string };
      if (!r.ok) { setErr(b.message ?? t('fail')); return; }
      setMsg(t('sent')); setBody(''); router.refresh();
    } catch {
      setErr(t('fail'));
    } finally { setBusy(false); }
  };
  return (
    <div className="my-appeal-form" data-mtr-appeal-form={targetId}>
      <label>
        <span>{t('write')}</span>
        <textarea value={body} maxLength={max} rows={4} onChange={(e) => setBody(e.target.value)} disabled={busy} data-mtr-appeal-body={targetId} />
      </label>
      <p><button type="button" className="btn-sm" disabled={busy || body.trim().length < min} onClick={() => void send()} data-mtr-appeal-send={targetId}>{busy ? t('sending') : t('send')}</button>
        {' '}<small>{body.trim().length} / {max}</small></p>
      {msg && <p role="status">{msg}</p>}
      {err && <p role="alert" className="warn-text">{err}</p>}
    </div>
  );
}
