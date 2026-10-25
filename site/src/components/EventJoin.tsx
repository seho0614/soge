'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * 이벤트 참여.
 *
 * 무엇을 받는지 누르기 전에 한 번 더 보여 줍니다 —
 * 참여하고 나서 "뭐였더라" 하면 기대가 어긋납니다.
 */
export function EventJoin({ code, full, benefit }:
  { code: string; full: boolean; benefit: string }) {
  const router = useRouter();
  const t = useTranslations('join.eventJoin');
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
      setDone(d?.note ?? t('joined'));
      router.refresh();
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      setErr(/로그인|UNAUTH|401/.test(m)
        ? t('needLogin')
        : m || t('failed'));
    }
    setBusy(false);
  }

  if (done) return <div className="note ok" style={{ margin: '12px 0 0' }}>{done}</div>;

  return (
    <div style={{ marginTop: 12 }}>
      <button type="button" className="btn-primary" disabled={busy || full}
        onClick={() => void join()}>
        {full ? t('full') : busy ? t('working') : t('submit')}
      </button>
      {err ? <p className="form-error">{err}</p> : null}
      <p className="hint">{t.rich('benefit', { benefit, b: (c) => <b>{c}</b> })}</p>
    </div>
  );
}
