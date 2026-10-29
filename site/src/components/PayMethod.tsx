'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTossClientKey } from '@/lib/useTossClientKey';

/* v10.148 (docs/228 · 리허설에서 발견) — 실연동(간주 꺼짐 + 결제창 키)에서는 토스 카드 등록 창 → /my/payment/card 에서 서버 등록.
 *   그 전에는 authKey 를 빈 값으로 보내 간주를 끄면 카드 등록이 늘 실패했습니다. */
const TOSS_SDK = 'https://js.tosspayments.com/v1/payment';
type BillingFn = (clientKey: string) => { requestBillingAuth: (m: string, p: Record<string, unknown>) => Promise<unknown> };
let sdk: Promise<BillingFn> | null = null;
function loadToss(): Promise<BillingFn> {
  const w = window as unknown as { TossPayments?: BillingFn };
  if (w.TossPayments) return Promise.resolve(w.TossPayments);
  sdk ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TOSS_SDK; s.async = true;
    s.onload = () => (w.TossPayments ? resolve(w.TossPayments) : reject(new Error('SDK')));
    s.onerror = () => { sdk = null; reject(new Error('SDK')); };
    document.head.appendChild(s);
  });
  return sdk;
}

/**
 * 결제 수단 등록·삭제.
 *
 * 간주 상태에서는 **버튼을 눌러도 아무 일이 일어나지 않는다는 것**을
 * 먼저 알립니다. 되는 척하면 등록한 줄 알고 넘어갑니다.
 */
export function PayMethod({ registered, assumed, customerKey }:
  { registered: boolean; assumed: boolean; customerKey: string }) {
  const router = useRouter();
  const t = useTranslations('deal.payMethod');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { key: CLIENT_KEY, ready: keyReady } = useTossClientKey();

  async function register() {
    if (assumed && !confirm(t('assumed'))) return;
    setBusy(true); setErr(null);
    /* 실연동 — 토스 카드 등록 창. customerKey 는 서버가 빌링키를 받을 때 쓰는 값(계정 번호)과 같아야 합니다 */
    if (!assumed && CLIENT_KEY) {
      try {
        const TossPayments = await loadToss();
        const origin = window.location.origin;
        await TossPayments(CLIENT_KEY).requestBillingAuth('카드', {
          customerKey, successUrl: `${origin}/my/payment/card`, failUrl: `${origin}/my/payment?card=fail`,
        });
      } catch {
        setErr(t('regFail'));
        setBusy(false);
      }
      return;
    }
    try {
      const r = await fetch('/api/v1/me/billing-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        /* ★ 20260930 — 서버는 authKey 가 필수입니다. 빈 본문을 보내 **간주 상태에서도 늘 실패**
         *   했습니다(400). 간주 상태에서는 시연용 키를 보내 서버 스텁이 처리하게 하고,
         *   실연동 뒤에는 토스 결제창이 돌려준 authKey 를 넣어야 합니다(미구현 — 보고서 참조). */
        /* 간주 · 결제창 키 없음(서버도 시험 결제) → 시험 키 */
        body: JSON.stringify({ authKey: `${assumed ? 'assumed' : 'stub'}_${Date.now()}` }),
      });
      if (!r.ok) throw new Error(String(r.status));
      router.refresh();
      setBusy(false);      // v10.26 (G-179) — 성공한 뒤에도 풀어야 합니다. 전에는 단추가 「처리 중…」에서 멈췄습니다(화면만 새로 받고 이 칸은 그대로 남음)
    } catch {
      setErr(t('regFail'));
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(t('removeAsk'))) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/v1/me/billing-key', { method: 'DELETE' });
      if (!r.ok) throw new Error(String(r.status));
      router.refresh();
      setBusy(false);
    } catch {
      /* 미납이 있으면 서버가 막습니다 — 그 이유를 알려야 합니다. */
      setErr(t('removeFail'));
      setBusy(false);
    }
  }

  return (
    <div className="invite-actions">
      <button type="button" className="btn-primary" disabled={busy || (!assumed && !keyReady)}
        onClick={() => void register()} data-pay-register="">
        {busy ? t('busy') : registered ? t('change') : t('register')}
      </button>
      {registered ? (
        <button type="button" className="btn ghost" disabled={busy}
          onClick={() => void remove()}>
          {t('remove')}
        </button>
      ) : null}
      {err ? <p className="form-error">{err}</p> : null}
    </div>
  );
}
