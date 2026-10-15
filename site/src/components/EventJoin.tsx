'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 이벤트 참여.
 *
 * 무엇을 받는지 누르기 전에 한 번 더 보여 줍니다 —
 * 참여하고 나서 "뭐였더라" 하면 기대가 어긋납니다.
 */
export function EventJoin({ code, full, benefit }:
  { code: string; full: boolean; benefit: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function join() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/v1/events/${code}/join`, { method: 'POST' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.message ?? String(r.status));
      }
      const d = await r.json();
      setDone(d?.note ?? '참여되었습니다.');
      router.refresh();
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      setErr(/로그인|UNAUTH|401/.test(m)
        ? '먼저 로그인하셔야 참여하실 수 있습니다.'
        : m || '참여하지 못했습니다. 잠시 후 다시 시도해 주십시오.');
    }
    setBusy(false);
  }

  if (done) return <div className="note ok" style={{ margin: '12px 0 0' }}>{done}</div>;

  return (
    <div style={{ marginTop: 12 }}>
      <button type="button" className="btn-primary" disabled={busy || full}
        onClick={() => void join()}>
        {full ? '정원이 찼습니다' : busy ? '참여하는 중…' : '참여하기'}
      </button>
      {err ? <p className="form-error">{err}</p> : null}
      <p className="hint">받으실 것: <b>{benefit}</b></p>
    </div>
  );
}
