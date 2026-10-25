'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * 입점 신청 폼.
 *
 * 업종·지역은 신청 뒤에도 바꿀 수 있습니다 — 처음부터 다 정하라고
 * 하면 **결정을 미루다 신청 자체를 안 합니다.**
 */
export function ApplyForm() {
  const router = useRouter();
  const t = useTranslations('join.applyForm');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/v1/partner/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setErr(t('failed'));
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn-primary" disabled={busy}
        onClick={() => void submit()}>
        {busy ? t('working') : t('submit')}
      </button>
      {err ? <p className="form-error">{err}</p> : null}
      <p className="hint">
        {t.rich('hint', { b: (c) => <b>{c}</b> })}
      </p>
    </div>
  );
}
