'use client';
/**
 * SB-MAL-DTL-010 · SB-MAL-GIV-010 「소개코드 공유」 (D010 · D012 — 10/2 「소개코드는 매물별로」)
 *
 * 누르면
 *   ① GET /me/referral-codes/quota?listingId= — **그 매물의 내 코드**(current)가 있으면 새로 받지 않고 그 코드를 보여 줍니다.
 *      (같은 매물은 몇 번을 눌러도 같은 코드 — 무료분 · 결제를 쓰지 않습니다)
 *      그 매물에 받을 수 없으면(blocked — 보험 · 의료 · 본인 매물 · 게시 끝) 까닭을 보여 줍니다.
 *   ② 이번 달 무료분(새 매물 기준)이 남았으면 POST /referral-codes { listingId } 로 받습니다(구독이 없으면 서버가 무료 BASIC 을 엽니다).
 *   ③ 포함분을 다 썼으면(모든 요금제 — D011) 「추가 1건 결제」를 안내합니다.
 *      결제창 키(NEXT_PUBLIC_TOSS_CLIENT_KEY)가 없으면 **시험 결제(스텁)** — 소개몰 PayForm 과 같은 방식입니다.
 *      키가 있으면 토스 결제창 → /mall/give/pay?listing= 에서 서버가 승인하고 발급합니다.
 * 공유 링크는 `{사이트}/{관}/{매물}?ref=코드` — 이 링크로 들어온 사람이 90일 안에 **그 매물에** 문의하면 소개자로 기록됩니다.
 * 운영 설정 refcode.scope=all 이면 코드가 매물에 묶이지 않습니다(전 동작 — current 는 이번 달 받은 코드).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CopyLink } from './CopyLink';
import type { ApiErr, RefCode, RefQuota } from './types';
import { useFmt } from '@/lib/useFmt';

const CLIENT_KEY = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? '';
const TOSS_SDK = 'https://js.tosspayments.com/v1/payment';
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

const needsLogin = (status: number, code?: string) => status === 401 || (status === 403 && code === 'UNAUTHENTICATED');

/** 소개코드 발급 — 결제 정보가 있으면 추가분 결제 승인 후 발급 · failMsg: 코드가 오지 않았을 때 문구(사전 refcode.button.issueFail) */
export async function issueCode(body: Record<string, unknown>, failMsg: string):
  Promise<{ ok: true; code: string; codes: RefCode[] } | { ok: false; status: number; err: ApiErr }> {
  const r = await fetch('/api/v1/referral-codes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ count: 1, ...body }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) return { ok: false, status: r.status, err: (d ?? {}) as ApiErr };
  const codes = (Array.isArray(d) ? d : []) as RefCode[];
  const first = codes[0];
  if (!first) return { ok: false, status: 500, err: { message: failMsg } };
  return { ok: true, code: first.code, codes };
}

/** 그 매물에 소개코드를 받을 수 없는 까닭 → 화면 문구 (서버 quota.blocked) */
const BLOCKED = {
  NO_INTRO_CATEGORY: 'noIntroCategory',
  OWN_LISTING: 'ownListing',
  LISTING_NOT_PUBLISHED: 'listingNotPublished',
} as const;

type View =
  | { k: 'idle' }
  | { k: 'shown'; code: string; reused: boolean; paid?: boolean; stub?: boolean; perListing?: boolean }
  | { k: 'pay'; q: RefQuota }
  | { k: 'msg'; text: string };

export function RefShareButton({ base, listingId }:
  { base: string; listingId?: string; identityVerified?: boolean }) {
  const t = useTranslations('refcode');
  const f = useFmt();
  const won = (n: number) => f.won(n);
  const router = useRouter();
  const [view, setView] = useState<View>({ k: 'idle' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function open() {
    setErr(null); setBusy(true);
    try {
      const qs = listingId ? `?listingId=${encodeURIComponent(listingId)}` : '';
      const r = await fetch(`/api/v1/me/referral-codes/quota${qs}`, { cache: 'no-store' });
      const q = (await r.json().catch(() => null)) as (RefQuota & ApiErr) | null;
      if (!r.ok || !q) {
        if (needsLogin(r.status, q?.code)) { router.push('/login'); return; }
        setErr(q?.message ?? t('button.quotaFail'));
        return;
      }
      const perListing = q.scope !== 'all';
      if (perListing && !listingId) {
        setView({ k: 'msg', text: t('button.perListingGuide') });
        return;
      }
      if (q.blocked) { setView({ k: 'msg', text: t(`button.blocked.${(BLOCKED as Record<string, (typeof BLOCKED)[keyof typeof BLOCKED]>)[q.blocked] ?? 'other'}`) }); return; }
      if (q.current) { setView({ k: 'shown', code: q.current.code, reused: true, perListing }); return; }
      if (q.freeRemaining > 0) {
        const res = await issueCode(listingId ? { listingId } : {}, t('button.issueFail'));
        if (res.ok) { setView({ k: 'shown', code: res.code, reused: !!res.codes[0]?.reused, perListing }); return; }
        if (needsLogin(res.status, res.err.code)) { router.push('/login'); return; }
        if (res.err.code === 'EXTRA_PAYMENT_REQUIRED') { setView({ k: 'pay', q: { ...q, freeRemaining: 0 } }); return; }
        setErr(res.err.message ?? t('button.issueFail'));
        return;
      }
      if (q.paymentRequired) { setView({ k: 'pay', q }); return; }
      setView({ k: 'msg', text: q.includedCodes > 0
        ? t('button.allUsedIncluded', { plan: q.planName, n: String(q.includedCodes) })
        : t('button.noFreePlan', { plan: q.planName, price: won(q.extraCodePrice) }) });
    } catch {
      setErr(t('button.requestFail'));
    } finally { setBusy(false); }
  }

  async function pay(q: RefQuota) {
    setErr(null); setBusy(true);
    const amount = q.extraCodePrice;
    const orderId = `rcx-${crypto.randomUUID()}`;
    try {
      /* 시험 결제(스텁) — 결제창 키가 없을 때. 서버도 키가 없으면 stub:true 로 승인하고 돈은 오가지 않습니다 */
      if (!CLIENT_KEY) {
        const res = await issueCode({ ...(listingId ? { listingId } : {}), paymentKey: `stub_${crypto.randomUUID()}`, orderId, amount }, t('button.issueFail'));
        if (res.ok) {
          const again = !!res.codes[0]?.reused;   // 그 사이 같은 매물 코드를 이미 받았으면 결제하지 않고 그 코드를 돌려줍니다
          setView({ k: 'shown', code: res.code, reused: again, paid: !again, stub: !again, perListing: q.scope !== 'all' });
          return;
        }
        if (needsLogin(res.status, res.err.code)) { router.push('/login'); return; }
        setErr(res.err.message ?? t('button.payNotApproved'));
        return;
      }
      /* 토스 결제창 — 성공하면 /mall/give/pay 로 돌아와 서버가 승인 · 발급합니다 */
      const TossPayments = await loadToss();
      const origin = window.location.origin;
      const back = new URLSearchParams(listingId ? { listing: listingId } : {});
      await TossPayments(CLIENT_KEY).requestPayment('카드', {
        amount, orderId, orderName: '소개코드 추가 1건',   // 결제 기록 값 — 언어와 상관없이 같게(결제수단 '카드' 와 같음)
        successUrl: `${origin}/mall/give/pay?${back}`,
        failUrl: `${origin}/mall/give?pay=fail`,
      });
    } catch (e) {
      const x = e as { code?: string; message?: string };
      setErr(x?.code === 'USER_CANCEL' ? t('button.payCanceled') : (x?.message ?? t('button.payOpenFail')));
    } finally { setBusy(false); }
  }

  return (
    <div data-refshare-state={view.k}>
      {view.k === 'idle' && (
        <div className="rc-act">
          <button type="button" className="rc-btn" disabled={busy} onClick={() => void open()} data-refshare-open="1">
            {busy ? t('button.checking') : t('button.share')}
          </button>
        </div>
      )}

      {view.k === 'shown' && (
        <div data-refshare-code={view.code}>
          <p>
            {t('button.myCode')} <span className="rc-code">{view.code}</span>
            {view.reused && <span className="rc-tag">{view.perListing ? t('button.tagListing') : t('button.tagMonth')}</span>}
            {view.paid && <span className="rc-tag">{view.stub ? t('button.tagStubPaid') : t('button.tagPaid')}</span>}
          </p>
          <CopyLink text={`${base}?ref=${view.code}`} />
          <p className="rc-note">{t('button.feeNote')}</p>
        </div>
      )}

      {view.k === 'pay' && (
        <div className="rc-warn" data-refshare-pay="1">
          {!view.q.freePlan ? (
            /* D011 — 유료 요금제도 포함 건수를 넘으면 결제 후 발급합니다 */
            <p>{t('button.paidPlanUsed', { plan: view.q.planName, n: String(view.q.includedCodes) })}{view.q.scope !== 'all' && ' ' + t('button.newListingPay')}</p>
          ) : view.q.includedCodes <= 0 ? (
            /* v10.31 (합침 · w3 D060) — 무료 요금제 포함 소개코드 0건(시안) */
            <p data-refshare-nofree="1">{t('button.noFree', { price: won(view.q.extraCodePrice) })}{!view.q.identityVerified && <>{' '}{t.rich('button.noFreeVerify', { a: (c) => <a href="/verify">{c}</a> })}</>}</p>
          ) : view.q.identityVerified ? (
            <p>{t('button.freeUsed', { n: String(view.q.includedCodes) })}{view.q.scope !== 'all' && ' ' + t('button.newListingPay')}</p>
          ) : (
            <p>{t.rich('button.unverified', { n: String(view.q.includedCodes), a: (c) => <a href="/verify">{c}</a> })}</p>
          )}
          {!CLIENT_KEY && (
            <p className="rc-note">{t.rich('button.stubNote', { b: (c) => <b>{c}</b> })}</p>
          )}
          <div className="rc-act">
            <button type="button" className="rc-btn" disabled={busy} onClick={() => void pay(view.q)} data-refshare-paybtn="1">
              {busy ? t('button.paying') : CLIENT_KEY ? t('button.payBtn', { price: won(view.q.extraCodePrice) }) : t('button.payBtnStub', { price: won(view.q.extraCodePrice) })}
            </button>
            <a className="rc-btn ghost" href="/my/subscription/upgrade">{t('button.plans')}</a>
          </div>
        </div>
      )}

      {view.k === 'msg' && <p data-refshare-msg="1">{view.text} <a href="/mall/give">{t('button.giveLink')}</a></p>}

      {err && <p className="rc-err" role="alert">{err}</p>}
    </div>
  );
}
