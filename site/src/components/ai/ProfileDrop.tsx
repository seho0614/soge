'use client';
/** v10.31 — 성향 등록 해지(시안 「등록 해지」) — DELETE /api/v1/me/profile 뒤 성향 화면으로 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ProfileDrop() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="w1-bo" disabled={busy} onClick={async () => {
        if (!window.confirm('등록한 성향을 지우시겠습니까? 저장된 답이 바로 삭제되고 전체 공개 광고로 돌아갑니다.')) return;
        setBusy(true); setErr(null);
        const r = await fetch('/api/v1/me/profile', { method: 'DELETE' }).catch(() => null);
        if (!r || !r.ok) { setErr('지우지 못했습니다.'); setBusy(false); return; }
        router.push('/ai/profile/done'); router.refresh();
      }}>{busy ? '지우는 중…' : '등록 해지'}</button>
      {err && <span className="w1-err" role="alert">{err}</span>}
    </>
  );
}
