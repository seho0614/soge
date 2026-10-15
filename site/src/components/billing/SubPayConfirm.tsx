'use client';
import { useEffect, useRef, useState } from 'react';

/** 결제창에서 돌아온 뒤 서버 승인 — 한 번만 보냅니다(같은 결제 키를 두 번 보내도 서버가 막지만, 새로고침 때 다시 묻지 않게 요청 키를 고정). */
export function SubPayConfirm({ paymentKey, orderId, plan }: { paymentKey: string; orderId: string; plan: string }) {
  const [st, setSt] = useState<{ k: 'wait' | 'ok' | 'err'; t: string }>({ k: 'wait', t: '결제를 확인하는 중입니다…' });
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
        if (!r.ok) { setSt({ k: 'err', t: j?.message ?? '결제를 확인하지 못했습니다.' }); return; }
        setSt({ k: 'ok', t: j?.reserved ? (j?.note ?? '요금제를 예약했습니다.') : '결제가 승인되어 구독이 시작되었습니다.' });
      } catch { setSt({ k: 'err', t: '연결하지 못했습니다. 잠시 뒤 이 화면을 새로고침해 주십시오 — 같은 결제는 두 번 청구되지 않습니다.' }); }
    })();
  }, [paymentKey, orderId, plan]);
  return (
    <div data-subpay={st.k}>
      <p className={st.k === 'err' ? 'form-error' : st.k === 'ok' ? 'form-ok' : 'dim'} role="status">{st.t}</p>
      {st.k !== 'wait' && <p><a className="cta-primary as-link" href="/my/subscription">구독 · 소개코드로</a></p>}
    </div>
  );
}
