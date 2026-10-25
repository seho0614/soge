'use client';
/** v10.31 — 성향 등록 해지(시안 「등록 해지」) — DELETE /api/v1/me/profile 뒤 성향 화면으로 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export function ProfileDrop() {
  const router = useRouter();
  const t = useTranslations('join.ai.drop');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="w1-bo" disabled={busy} onClick={async () => {
        if (!window.confirm(t('confirm'))) return;
        setBusy(true); setErr(null);
        const r = await fetch('/api/v1/me/profile', { method: 'DELETE' }).catch(() => null);
        if (!r || !r.ok) { setErr(t('failed')); setBusy(false); return; }
        router.push('/ai/profile/done'); router.refresh();
      }}>{busy ? t('working') : t('submit')}</button>
      {err && <span className="w1-err" role="alert">{err}</span>}
    </>
  );
}
