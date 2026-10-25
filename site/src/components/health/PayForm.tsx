'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { codeText, needsLogin, PAY_METHODS, serverPayMethod } from './util';
import { afterConfirmUrl, confirmPay } from './PayConfirm';
import type { HltPayment } from './types';
import { useFmt } from '@/lib/useFmt';

/** 토스 결제창 클라이언트 키 — 빌드 때 들어갑니다. 없으면 시험 결제(스텁)로 진행합니다 */
const CLIENT_KEY = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? '';
/** 토스페이먼츠 결제창 SDK v1 (공식) */
const TOSS_SDK = 'https://js.tosspayments.com/v1/payment';
/** 우리 수단 코드 → 결제창 수단 이름 */
const TOSS_METHOD: Record<string, string> = { CARD: '카드', EASY: '카드', TRANSFER: '계좌이체', VBANK: '가상계좌' };   // 간편결제는 카드 · 간편결제 결제창에서 고릅니다

type TossPaymentsFn = (clientKey: string) => {
  requestPayment: (method: string, params: Record<string, unknown>) => Promise<unknown>;
};
declare global { interface Window { TossPayments?: TossPaymentsFn } }

let sdk: Promise<TossPaymentsFn> | null = null;
function loadToss(): Promise<TossPaymentsFn> {
  if (window.TossPayments) return Promise.resolve(window.TossPayments);
  sdk ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TOSS_SDK; s.async = true;
    s.onload = () => (window.TossPayments ? resolve(window.TossPayments) : reject(new Error('SDK')));
    s.onerror = () => { sdk = null; reject(new Error('SDK')); };
    document.head.appendChild(s);
  });
  return sdk;
}

/**
 * 결제 (D006 — 토스 표준 결제창)
 *
 *  1) POST /health/orders/{no}/pay { method } — 결제 준비(READY)
 *  2) 결제창(토스 SDK v1 requestPayment) — 성공하면 /health/order/pay/success 로 돌아와 서버가 승인합니다.
 *     실패·취소면 /health/order/fail (토스가 code · message 를 붙여 줍니다)
 *  ★ 클라이언트 키가 없으면 결제창 대신 **시험 결제(스텁)** 버튼입니다. 서버가 stub:true 로 승인하고
 *    실제 돈은 오가지 않습니다 — 주문 완료 화면에 "시험 결제" 로 보입니다.
 */
export function PayForm({ orderNo, total, initialMethod, buyerName }:
  { orderNo: string; total: number; initialMethod: string; buyerName?: string }) {
  const t = useTranslations('order');
  const f = useFmt();
  const router = useRouter();
  const [method, setMethod] = useState(PAY_METHODS.some((m) => m.code === initialMethod) ? initialMethod : 'CARD');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function fail(code: string, msg: string) {
    const q = new URLSearchParams({ step: 'pay', no: orderNo, code, msg });
    router.push(`/health/order/fail?${q}`);
  }

  function pay() {
    setErr(null);
    start(async () => {
      /* 1) 결제 준비 */
      const r = await fetch(`/api/v1/health/orders/${encodeURIComponent(orderNo)}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ method: serverPayMethod(method) }),
      });
      const d = (await r.json().catch(() => null)) as (HltPayment & { code?: string; message?: string }) | null;
      if (!r.ok) {
        if (needsLogin(r.status, d?.code)) { router.push('/login'); return; }
        if (r.status >= 500) { setErr(t('common.payReqFail')); return; }
        fail(d?.code ?? String(r.status), d?.message ?? t('common.notApproved'));
        return;
      }
      /* 가상계좌가 이미 발급돼 입금을 기다리는 중 — 안내 화면으로 */
      if (d?.pgStatus === 'WAITING_FOR_DEPOSIT') {
        router.push(`/health/order/done?${new URLSearchParams({ no: orderNo, m: d.method, st: d.state })}`);
        return;
      }
      const amount = Number(d?.amount ?? total);

      /* 2-a) 시험 결제(스텁) — 클라이언트 키가 없을 때 */
      if (!CLIENT_KEY) {
        const res = await confirmPay(orderNo, `stub_${crypto.randomUUID()}`, amount, { server: t('common.confirmReqFail'), rejected: t('common.notApproved') });
        if (!res.ok && needsLogin(res.status, res.code)) { router.push('/login'); return; }
        router.push(afterConfirmUrl(orderNo, res));
        return;
      }

      /* 2-b) 토스 결제창 — 성공하면 페이지가 성공 주소로 넘어갑니다 */
      try {
        const TossPayments = await loadToss();
        const origin = window.location.origin;
        await TossPayments(CLIENT_KEY).requestPayment(TOSS_METHOD[method] ?? '카드', {
          amount,
          orderId: orderNo,
          orderName: d?.orderName ?? `소개몰 주문 ${orderNo}`,
          ...(buyerName ? { customerName: buyerName } : {}),
          successUrl: `${origin}/health/order/pay/success`,
          failUrl: `${origin}/health/order/fail?${new URLSearchParams({ step: 'pay', no: orderNo })}`,
        });
      } catch (e) {
        const x = e as { code?: string; message?: string };
        if (x?.code === 'USER_CANCEL') { setErr(t('common.userCancel')); return; }
        if (!x?.code) { setErr(t('common.windowFail')); return; }
        fail(x.code, x.message ?? t('common.notApproved'));
      }
    });
  }

  return (
    <>
      <div className="hlt-chips" role="radiogroup" aria-label={t('common.payMethod')}>
        {PAY_METHODS.map((m) => (
          <button key={m.code} type="button" role="radio" aria-checked={method === m.code}
            className={`hlt-chip${method === m.code ? ' on' : ''}`} onClick={() => setMethod(m.code)}>{codeText(t, 'payMethod', m.code, m.label)}</button>
        ))}
      </div>
      {method === 'EASY' && <p className="hint" data-easy-note="">{t('pay.easyNote')}</p>}
      {!CLIENT_KEY && (
        <p className="notice" role="note">
          {t.rich('common.stubNotice', { b: (c) => <b>{c}</b> })}
        </p>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
      <button type="button" className="cta-primary" disabled={pending} onClick={pay}>
        {pending ? t('common.requesting') : CLIENT_KEY ? t('common.payBtn', { amount: f.won(total, '-') }) : t('common.stubBtn', { amount: f.won(total, '-') })}
      </button>
    </>
  );
}
