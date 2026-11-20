'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { lsxCall } from './api';

/** v10.515 (D276) 결제창 성공 뒤 — 서버가 결제를 승인(confirm)하고 그 뒤에만 끌어올림. 금액은 서버가 대조(다르면 422) */
export function BumpPayConfirm({ listingId, paymentKey, orderId, amount }: { listingId: string; paymentKey: string; orderId: string; amount: number }) {
  const t = useTranslations('lsx');
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return; once.current = true;
    void lsxCall(`/me/lsx/listings/${listingId}/bump`, 'POST', { paymentKey, orderId, amount })
      .then((r) => setState(r.ok ? { ok: true, text: t('bumpDone') } : { ok: false, text: r.body.message ?? t('bumpFail') }))
      .catch(() => setState({ ok: false, text: t('bumpFail') }));
  }, [listingId, paymentKey, orderId, amount]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div data-lsx-pay-confirm={state ? (state.ok ? 'ok' : 'fail') : 'busy'}>
      <p className={state && !state.ok ? 'warn-text' : ''} role="status">{state ? state.text : t('payBusy')}</p>
      <Link className="my-bp" href="/my/listing-tools">{t('payBack')}</Link>
    </div>
  );
}
