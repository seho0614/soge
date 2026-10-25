'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/** 결제창에서 돌아온 뒤 서버 승인 — 한 번만 보냅니다(같은 결제 키를 두 번 보내도 서버가 막지만, 새로고침 때 다시 묻지 않게 요청 키를 고정). */
export function SubPayConfirm({ paymentKey, orderId, plan }: { paymentKey: string; orderId: string; plan: string }) {
  const t = useTranslations('billing.payConfirm');
  const [st, setSt] = useState<{ k: 'wait' | 'ok' | 'err'; t: string }>({ k: 'wait', t: t('checking') });
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return; sent.current = true;
    (async () => {
      try {
        const r = await fetch('/api/v1/subscriptions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `subpay-${orderId}` },
          body: JSON.stringify({ planCode: plan, paymentKey, orderId }),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok) { setSt({ k: 'err', t: j?.message ?? t('failed') }); return; }
        setSt({ k: 'ok', t: j?.reserved ? (j?.note ?? t('reserved')) : t('started') });
      } catch { setSt({ k: 'err', t: t('network') }); }
    })();
  }, [paymentKey, orderId, plan]);
  return (
    <div data-subpay={st.k}>
      <p className={st.k === 'err' ? 'form-error' : st.k === 'ok' ? 'form-ok' : 'dim'} role="status">{st.t}</p>
      {st.k !== 'wait' && <p><a className="cta-primary as-link" href="/my/subscription">{t('back')}</a></p>}
    </div>
  );
}
