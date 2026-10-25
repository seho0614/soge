'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { needsLogin } from './util';
import type { HltPayment } from './types';

/**
 * 결제 승인 — POST /health/orders/{no}/pay/confirm { paymentKey, amount } (D006)
 *
 * 결제창(토스) 성공 주소 · 시험 결제(스텁) 버튼이 같이 씁니다.
 * ★ 금액 대조는 서버가 합니다(주문 금액 ≠ amount 면 422 AMOUNT_MISMATCH). 화면은 받은 값을 그대로 보냅니다.
 * 같은 paymentKey 로 두 번 불러도 서버가 같은 결과를 돌려줍니다 — 새로고침해도 안전합니다.
 */
/* v10.99 — tx: 화면 사전의 글자(서버 오류 · 승인 거절 기본 문구) — 부르는 쪽이 useTranslations 로 넘깁니다 */
export async function confirmPay(orderNo: string, paymentKey: string, amount: number, tx: { server: string; rejected: string }):
  Promise<{ ok: true; pay: HltPayment } | { ok: false; status: number; code: string; message: string }> {
  const r = await fetch(`/api/v1/health/orders/${encodeURIComponent(orderNo)}/pay/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `confirm-${paymentKey}` },
    body: JSON.stringify({ paymentKey, amount }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) {
    return { ok: false, status: r.status, code: d?.code ?? String(r.status),
      message: r.status >= 500 ? tx.server : d?.message ?? tx.rejected };
  }
  return { ok: true, pay: d as HltPayment };
}

/** 승인 결과 → 주문 완료 / 주문 실패 주소 */
export function afterConfirmUrl(orderNo: string, res: Awaited<ReturnType<typeof confirmPay>>) {
  if (res.ok) {
    const q = new URLSearchParams({ no: orderNo, m: res.pay.method, st: res.pay.state });
    return `/health/order/done?${q}`;
  }
  const q = new URLSearchParams({ step: 'pay', no: orderNo, code: res.code, msg: res.message });
  return `/health/order/fail?${q}`;
}

/** 결제창 성공 주소에서 한 번 승인하고 넘어갑니다 */
export function PayConfirm({ orderNo, paymentKey, amount }: { orderNo: string; paymentKey: string; amount: number }) {
  const t = useTranslations('order');
  const router = useRouter();
  const once = useRef(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (once.current) return;          // 개발 모드 StrictMode 의 두 번 실행 방지 (서버도 멱등입니다)
    once.current = true;
    void (async () => {
      try {
        const res = await confirmPay(orderNo, paymentKey, amount, { server: t('common.confirmReqFail'), rejected: t('common.notApproved') });
        if (!res.ok && needsLogin(res.status, res.code)) { router.replace('/login'); return; }
        router.replace(afterConfirmUrl(orderNo, res));
      } catch {
        setErr(t('common.confirmReqFailRefresh'));
      }
    })();
  }, [orderNo, paymentKey, amount, router, t]);

  return err ? (
    <div className="hlt-box hlt-fail" role="alert">
      <b>{err}</b>
      <div className="hlt-btns">
        <Link className="hlt-btn" href={`/my/health/orders/${encodeURIComponent(orderNo)}`}>{t('common.orderDetail')}</Link>
      </div>
    </div>
  ) : (
    <div className="hlt-box" role="status" aria-live="polite">
      <b>{t('common.checking')}</b>
      <p className="hint">{t('pay.closeHint')}</p>
    </div>
  );
}
