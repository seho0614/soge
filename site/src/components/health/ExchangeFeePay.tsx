'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { needsLogin } from './util';
import { useFmt } from '@/lib/useFmt';
import { useTossClientKey } from '@/lib/useTossClientKey';

/** 토스 결제창 클라이언트 키 — PayForm 과 같은 값. 없으면 시험 결제(스텁)입니다 */
const TOSS_SDK = 'https://js.tosspayments.com/v1/payment';
/** 교환 배송비는 카드 · 계좌이체만 받습니다(서버 FeePayDto · hlt_exchange_fees CHECK) — 가상계좌는 입금을 기다려야 해 받지 않습니다 */
/* v10.99 — 화면 이름은 사전 order.payMethod.* · toss 는 결제창에 보내는 값이라 한국어 그대로 */
const FEE_METHODS = [{ code: 'CARD', toss: '카드' }, { code: 'TRANSFER', toss: '계좌이체' }] as const;

type TossFn = (k: string) => { requestPayment: (m: string, p: Record<string, unknown>) => Promise<unknown> };
function loadToss(): Promise<TossFn> {
  const w = window as unknown as { TossPayments?: TossFn };
  if (w.TossPayments) return Promise.resolve(w.TossPayments);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TOSS_SDK; s.async = true;
    s.onload = () => (w.TossPayments ? resolve(w.TossPayments) : reject(new Error('SDK')));
    s.onerror = () => reject(new Error('SDK'));
    document.head.appendChild(s);
  });
}

type ConfirmRes = { ok: true; note: string } | { ok: false; status: number; code: string; message: string };

/** 교환 배송비 승인 — POST /me/health/returns/{id}/fee/confirm (금액 대조 · 같은 paymentKey 는 같은 결과는 서버가 합니다) */
/* v10.99 — tx: 화면 사전의 기본 문구(부르는 쪽이 useTranslations 로 넘깁니다) */
type FeeTx = { server: string; rejected: string; approved: string };
export async function confirmExchangeFee(id: string, paymentKey: string, amount: number, tx: FeeTx): Promise<ConfirmRes> {
  const r = await fetch(`/api/v1/me/health/returns/${encodeURIComponent(id)}/fee/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `xfee-${paymentKey}` },
    body: JSON.stringify({ paymentKey, amount }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) {
    return { ok: false, status: r.status, code: d?.code ?? String(r.status),
      message: r.status >= 500 ? tx.server : d?.message ?? tx.rejected };
  }
  return { ok: true, note: d?.note ?? tx.approved };
}

/**
 * 교환 배송비 결제 (v10.26 · A-1 ① — 회원 사정 교환은 접수 때 왕복 배송비를 온라인으로 결제)
 *
 *  1) POST /me/health/returns/{id}/fee/pay { method } — 결제 준비(READY)
 *  2) 키가 없으면 시험 결제(스텁) 승인, 있으면 토스 결제창 → /my/health/returns/{id}/fee 로 돌아와 승인
 * 반려되거나 회사 사정으로 판정되면 서버가 돌려드립니다(PG 취소).
 */
export function ExchangeFeePay({ returnId, amount, onPaid }: { returnId: string; amount: number; onPaid?: (note: string) => void }) {
  const { key: CLIENT_KEY, ready: keyReady } = useTossClientKey();   // v10.128 — 운영 화면 키(빌드 불필요)
  const t = useTranslations('order');
  const f = useFmt();
  const tx: FeeTx = { server: t('common.confirmReqFail'), rejected: t('common.notApproved'), approved: t('fee.approved') };
  const router = useRouter();
  const [method, setMethod] = useState('CARD');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [paid, setPaid] = useState<string | null>(null);

  function pay() {
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/v1/me/health/returns/${encodeURIComponent(returnId)}/fee/pay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        if (needsLogin(r.status, d?.code)) { router.push('/login'); return; }
        setErr(r.status >= 500 ? t('common.payReqFail') : d?.message ?? t('fee.startFail'));
        return;
      }
      const amt = Number(d?.amount ?? amount);
      if (!CLIENT_KEY) {
        const res = await confirmExchangeFee(returnId, `stub_${crypto.randomUUID()}`, amt, tx);
        if (!res.ok) {
          if (needsLogin(res.status, res.code)) { router.push('/login'); return; }
          setErr(res.message); return;
        }
        /* router.refresh() 를 하지 않습니다 — 새로 그리면 이 화면이 「이미 결제하셨습니다」 / 「이미 접수된 신청」으로 바뀌어 승인 안내가 사라집니다(ReturnForm 과 같은 까닭) */
        setPaid(res.note); onPaid?.(res.note);
        return;
      }
      try {
        const T = await loadToss();
        const back = `${window.location.origin}/my/health/returns/${encodeURIComponent(returnId)}/fee`;
        await T(CLIENT_KEY).requestPayment(FEE_METHODS.find((m) => m.code === method)?.toss ?? '카드', {
          amount: amt, orderId: d?.orderId, orderName: d?.orderName ?? '소개몰 교환 배송비',
          successUrl: back, failUrl: `${back}?fail=1`,
        });
      } catch (e) {
        const x = e as { code?: string; message?: string };
        setErr(x?.code === 'USER_CANCEL' ? t('common.userCancel')
          : x?.message ?? t('common.windowFail'));
      }
    });
  }

  if (paid) {
    return (
      <>
        <p className="ok-note" role="status" data-fee-paid>{paid}</p>
        <div className="hlt-btns"><Link className="hlt-btn pri" href="/my/health/returns">{t('common.returnsList')}</Link></div>
      </>
    );
  }

  return (
    <div className="hlt-box" data-fee-pay={returnId}>
      <h3>{t('fee.title')}</h3>
      <div className="hlt-sum tot"><span>{t('common.feeRound')}</span><span>{f.won(amount, '-')}</span></div>
      <div className="hlt-chips" role="radiogroup" aria-label={t('common.payMethod')}>
        {FEE_METHODS.map((m) => (
          <button key={m.code} type="button" role="radio" aria-checked={method === m.code}
            className={`hlt-chip${method === m.code ? ' on' : ''}`} onClick={() => setMethod(m.code)}>{t(`payMethod.${m.code}`)}</button>
        ))}
      </div>
      {!CLIENT_KEY && (
        <p className="notice" role="note">{t.rich('common.stubNotice', { b: (c) => <b>{c}</b> })}</p>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
      <button type="button" className="cta-primary" disabled={!keyReady || pending} onClick={pay}>
        {pending ? t('common.requesting') : CLIENT_KEY ? t('common.payBtn', { amount: f.won(amount, '-') }) : t('common.stubBtn', { amount: f.won(amount, '-') })}
      </button>
      <p className="hint">{t('fee.note')}</p>
    </div>
  );
}

/** 결제창 성공 주소에서 한 번 승인합니다 */
export function ExchangeFeeConfirm({ returnId, paymentKey, amount }: { returnId: string; paymentKey: string; amount: number }) {
  const t = useTranslations('order');
  const once = useRef(false);
  const router = useRouter();
  const [res, setRes] = useState<ConfirmRes | null>(null);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    void confirmExchangeFee(returnId, paymentKey, amount, { server: t('common.confirmReqFail'), rejected: t('common.notApproved'), approved: t('fee.approved') })
      .then((r) => { if (!r.ok && needsLogin(r.status, r.code)) { router.replace('/login'); return; } setRes(r); })
      .catch(() => setRes({ ok: false, status: 0, code: 'NETWORK', message: t('common.confirmReqFailRefresh') }));
  }, [returnId, paymentKey, amount, router, t]);
  if (!res) return <div className="hlt-box" role="status" aria-live="polite"><b>{t('common.checking')}</b></div>;
  return (
    <>
      {res.ok
        ? <p className="ok-note" role="status" data-fee-paid>{res.note}</p>
        : <div className="hlt-box hlt-fail" role="alert"><b>{res.message}</b></div>}
      <div className="hlt-btns"><Link className="hlt-btn pri" href="/my/health/returns">{t('common.returnsList')}</Link></div>
    </>
  );
}
