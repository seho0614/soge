'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { needsLogin } from './util';
import type { HltPayment } from './types';

/**
 * 결제 승인 — POST /health/orders/{no}/pay/confirm { paymentKey, amount } (D006)
 *
 * 결제창(토스) 성공 주소 · 시험 결제(스텁) 버튼이 같이 씁니다.
 * ★ 금액 대조는 서버가 합니다(주문 금액 ≠ amount 면 422 AMOUNT_MISMATCH). 화면은 받은 값을 그대로 보냅니다.
 * 같은 paymentKey 로 두 번 불러도 서버가 같은 결과를 돌려줍니다 — 새로고침해도 안전합니다.
 */
export async function confirmPay(orderNo: string, paymentKey: string, amount: number):
  Promise<{ ok: true; pay: HltPayment } | { ok: false; status: number; code: string; message: string }> {
  const r = await fetch(`/api/v1/health/orders/${encodeURIComponent(orderNo)}/pay/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `confirm-${paymentKey}` },
    body: JSON.stringify({ paymentKey, amount }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) {
    return { ok: false, status: r.status, code: d?.code ?? String(r.status),
      message: r.status >= 500 ? '결제 승인 요청을 보내지 못했습니다. 잠시 뒤 다시 시도해 주십시오.' : d?.message ?? '결제가 승인되지 않았습니다.' };
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
  const router = useRouter();
  const once = useRef(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (once.current) return;          // 개발 모드 StrictMode 의 두 번 실행 방지 (서버도 멱등입니다)
    once.current = true;
    void (async () => {
      try {
        const res = await confirmPay(orderNo, paymentKey, amount);
        if (!res.ok && needsLogin(res.status, res.code)) { router.replace('/login'); return; }
        router.replace(afterConfirmUrl(orderNo, res));
      } catch {
        setErr('결제 승인 요청을 보내지 못했습니다. 이 화면을 새로고침하시면 다시 확인합니다 — 두 번 결제되지 않습니다.');
      }
    })();
  }, [orderNo, paymentKey, amount, router]);

  return err ? (
    <div className="hlt-box hlt-fail" role="alert">
      <b>{err}</b>
      <div className="hlt-btns">
        <Link className="hlt-btn" href={`/my/health/orders/${encodeURIComponent(orderNo)}`}>주문 상세</Link>
      </div>
    </div>
  ) : (
    <div className="hlt-box" role="status" aria-live="polite">
      <b>결제를 확인하고 있습니다…</b>
      <p className="hint">창을 닫지 마십시오. 확인되면 주문 완료 화면으로 넘어갑니다.</p>
    </div>
  );
}
