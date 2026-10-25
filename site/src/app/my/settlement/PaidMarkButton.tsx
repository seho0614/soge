'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * v10.31 (합침 · w6 정산 승인 단계 D080) — 「받았음 표시」 POST /me/settlements/{id}/paid.
 * 운영이 정산서를 확인해 **승인된 건(APPROVED · 「승인됨 · 지급 대기」)만** 그립니다 — 승인 전 표시는 DB 가 막습니다(422 STL_PAID).
 * 당사자가 남기는 기록이며 플랫폼이 지급을 확인한 것이 아닙니다(INV-11). 한 번 찍으면 바꿀 수 없습니다.
 */
export function PaidMarkButton({ id }: { id: string }) {
  const router = useRouter();
  const t = useTranslations('myDeal');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    if (!window.confirm(t('paid.confirm'))) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/v1/me/settlements/${id}/paid`, { method: 'POST' });
      const d = await r.json().catch(() => null);
      if (r.status === 401) { router.push('/login'); return; }
      if (!r.ok) { setErr(d?.message ?? t('paid.fail')); return; }
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <span className="acts" data-stl-paid-wrap={id}>
      <button type="button" className="btn-sm p2primary" disabled={busy} onClick={go} data-stl-paid={id}>{busy ? t('paid.busy') : t('paid.btn')}</button>
      {err && <span className="form-error" role="alert">{err}</span>}
    </span>
  );
}
