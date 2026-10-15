'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 입점 신청 폼.
 *
 * 업종·지역은 신청 뒤에도 바꿀 수 있습니다 — 처음부터 다 정하라고
 * 하면 **결정을 미루다 신청 자체를 안 합니다.**
 */
export function ApplyForm() {
  const router = useRouter();
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
      setErr('접수하지 못했습니다. 잠시 후 다시 눌러 주십시오.');
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn-primary" disabled={busy}
        onClick={() => void submit()}>
        {busy ? '접수하는 중…' : '입점 신청하기'}
      </button>
      {err ? <p className="form-error">{err}</p> : null}
      <p className="hint">
        업종과 지역은 <b>신청 뒤에 정하셔도 됩니다</b>.
      </p>
    </div>
  );
}
