'use client';
/**
 * 추가 소개코드 결제 승인 — 토스 결제창 성공 주소(/mall/give/pay)에서 한 번 부릅니다 (D010 · D012).
 * POST /referral-codes { listingId, paymentKey, orderId, amount } — 매물 확인 · 금액 대조 · 승인 · 발급은 서버가 합니다.
 * 같은 결제키를 다시 보내면 서버가 409 PAYMENT_KEY_USED 로 막습니다(새로고침해도 두 번 발급되지 않습니다).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CopyLink } from './CopyLink';
import { issueCode } from './RefShareButton';

export function RefPayConfirm({ paymentKey, orderId, amount, base, listingId }:
  { paymentKey: string; orderId: string; amount: number; base: string; listingId?: string }) {
  const t = useTranslations('refcode');
  const once = useRef(false);
  const [code, setCode] = useState<string | null>(null);
  const [reused, setReused] = useState(false);
  const [err, setErr] = useState<{ code?: string; message: string } | null>(null);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    void (async () => {
      try {
        const res = await issueCode({ paymentKey, orderId, amount, ...(listingId ? { listingId } : {}) }, t('button.issueFail'));
        if (res.ok) { setReused(!!res.codes[0]?.reused); setCode(res.code); }
        else setErr({ code: res.err.code, message: res.err.message ?? t('button.payNotApproved') });
      } catch {
        setErr({ message: t('pay.requestFail') });
      }
    })();
  }, [paymentKey, orderId, amount, listingId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) {
    return (
      <div className="rc-box" role="alert" data-refpay-error={err.code ?? 'ERR'}>
        <p className="rc-err">{err.code === 'PAYMENT_KEY_USED' ? t('pay.alreadyUsed') : err.message}</p>
        <div className="rc-act"><a className="rc-btn ghost" href="/mall/give">{t('pay.myCodes')}</a></div>
      </div>
    );
  }
  if (!code) return <div className="rc-box" role="status" aria-live="polite"><p>{t('pay.confirming')}</p></div>;
  return (
    <div className="rc-box" data-refshare-code={code}>
      {reused
        /* D012 — 그 매물에 이미 받은 코드가 있으면 서버가 결제를 승인하지 않고 그 코드를 돌려줍니다(새로고침 포함) */
        ? <p>{t.rich('pay.reused', { code, c: (ch) => <span className="rc-code">{ch}</span> })}</p>
        : <p>{t.rich('pay.issued', { code, c: (ch) => <span className="rc-code">{ch}</span> })}</p>}
      <CopyLink text={`${base}?ref=${code}`} />
      <div className="rc-act"><a className="rc-btn ghost" href="/mall/give">{t('pay.myCodes')}</a></div>
    </div>
  );
}
