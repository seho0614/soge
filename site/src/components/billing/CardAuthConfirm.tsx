'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/** v10.148 (docs/228) — 카드 등록 창에서 돌아온 뒤 서버 등록(POST /me/billing-key) · 한 번만 보냄 */
export function CardAuthConfirm({ authKey }: { authKey: string }) {
  const t = useTranslations('deal.payMethod');
  const [st, setSt] = useState<{ k: 'wait' | 'ok' | 'err'; t: string }>({ k: 'wait', t: t('cardChecking') });
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return; sent.current = true;
    (async () => {
      try {
        const r = await fetch('/api/v1/me/billing-key', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ authKey }),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok) { setSt({ k: 'err', t: j?.message ?? t('regFail') }); return; }
        setSt({ k: 'ok', t: t('cardOk') });
      } catch { setSt({ k: 'err', t: t('regFail') }); }
    })();
  }, [authKey]);
  return (
    <div data-card-auth={st.k}>
      <p className={st.k === 'err' ? 'form-error' : st.k === 'ok' ? 'form-ok' : 'dim'} role="status">{st.t}</p>
      {st.k !== 'wait' && <p><a className="cta-primary as-link" href="/my/payment">{t('cardBack')}</a></p>}
    </div>
  );
}
