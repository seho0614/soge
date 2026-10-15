'use client';
/**
 * 추가 소개코드 결제 승인 — 토스 결제창 성공 주소(/mall/give/pay)에서 한 번 부릅니다 (D010 · D012).
 * POST /referral-codes { listingId, paymentKey, orderId, amount } — 매물 확인 · 금액 대조 · 승인 · 발급은 서버가 합니다.
 * 같은 결제키를 다시 보내면 서버가 409 PAYMENT_KEY_USED 로 막습니다(새로고침해도 두 번 발급되지 않습니다).
 */
import { useEffect, useRef, useState } from 'react';
import { CopyLink } from './CopyLink';
import { issueCode } from './RefShareButton';

export function RefPayConfirm({ paymentKey, orderId, amount, base, listingId }:
  { paymentKey: string; orderId: string; amount: number; base: string; listingId?: string }) {
  const once = useRef(false);
  const [code, setCode] = useState<string | null>(null);
  const [reused, setReused] = useState(false);
  const [err, setErr] = useState<{ code?: string; message: string } | null>(null);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    void (async () => {
      try {
        const res = await issueCode({ paymentKey, orderId, amount, ...(listingId ? { listingId } : {}) });
        if (res.ok) { setReused(!!res.codes[0]?.reused); setCode(res.code); }
        else setErr({ code: res.err.code, message: res.err.message ?? '결제가 승인되지 않았습니다.' });
      } catch {
        setErr({ message: '결제 승인 요청을 보내지 못했습니다. 이 화면을 새로고침하시면 다시 확인합니다 — 두 번 발급되지 않습니다.' });
      }
    })();
  }, [paymentKey, orderId, amount, listingId]);

  if (err) {
    return (
      <div className="rc-box" role="alert" data-refpay-error={err.code ?? 'ERR'}>
        <p className="rc-err">{err.code === 'PAYMENT_KEY_USED' ? '이미 이 결제로 소개코드를 받으셨습니다.' : err.message}</p>
        <div className="rc-act"><a className="rc-btn ghost" href="/mall/give">내 소개코드 보기</a></div>
      </div>
    );
  }
  if (!code) return <div className="rc-box" role="status" aria-live="polite"><p>결제를 확인하고 있습니다… 창을 닫지 마십시오.</p></div>;
  return (
    <div className="rc-box" data-refshare-code={code}>
      {reused
        /* D012 — 그 매물에 이미 받은 코드가 있으면 서버가 결제를 승인하지 않고 그 코드를 돌려줍니다(새로고침 포함) */
        ? <p>이 매물에는 이미 받은 소개코드 <span className="rc-code">{code}</span>가 있습니다. 이번 결제는 승인하지 않았습니다.</p>
        : <p>추가 소개코드 <span className="rc-code">{code}</span>를 받았습니다.</p>}
      <CopyLink text={`${base}?ref=${code}`} />
      <div className="rc-act"><a className="rc-btn ghost" href="/mall/give">내 소개코드 보기</a></div>
    </div>
  );
}
