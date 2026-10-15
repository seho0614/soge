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
import { CopyLink } from './CopyLink';
import type { ApiErr, RefCode, RefQuota } from './types';

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

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const needsLogin = (status: number, code?: string) => status === 401 || (status === 403 && code === 'UNAUTHENTICATED');

/** 소개코드 발급 — 결제 정보가 있으면 추가분 결제 승인 후 발급 */
export async function issueCode(body: Record<string, unknown>):
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
  if (!first) return { ok: false, status: 500, err: { message: '소개코드를 받지 못했습니다.' } };
  return { ok: true, code: first.code, codes };
}

/** 그 매물에 소개코드를 받을 수 없는 까닭 → 화면 문구 (서버 quota.blocked) */
const BLOCKED: Record<string, string> = {
  NO_INTRO_CATEGORY: '보험·의료 매물에는 소개자를 둘 수 없어 소개코드를 받을 수 없습니다 (의료법 27조 · 보험업법).',
  OWN_LISTING: '본인 매물에는 소개코드를 받을 수 없습니다.',
  LISTING_NOT_PUBLISHED: '게시 중인 매물에만 소개코드를 받을 수 있습니다.',
};

type View =
  | { k: 'idle' }
  | { k: 'shown'; code: string; reused: boolean; paid?: boolean; stub?: boolean; perListing?: boolean }
  | { k: 'pay'; q: RefQuota }
  | { k: 'msg'; text: string };

export function RefShareButton({ base, listingId }:
  { base: string; listingId?: string; identityVerified?: boolean }) {
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
        setErr(q?.message ?? '소개코드 현황을 불러오지 못했습니다. 잠시 뒤 다시 눌러 주십시오.');
        return;
      }
      const perListing = q.scope !== 'all';
      if (perListing && !listingId) {
        setView({ k: 'msg', text: '소개코드는 매물마다 따로 받습니다. 소개할 매물 상세에서 「소개코드 공유」를 눌러 주십시오.' });
        return;
      }
      if (q.blocked) { setView({ k: 'msg', text: BLOCKED[q.blocked] ?? '이 매물에는 소개코드를 받을 수 없습니다.' }); return; }
      if (q.current) { setView({ k: 'shown', code: q.current.code, reused: true, perListing }); return; }
      if (q.freeRemaining > 0) {
        const res = await issueCode(listingId ? { listingId } : {});
        if (res.ok) { setView({ k: 'shown', code: res.code, reused: !!res.codes[0]?.reused, perListing }); return; }
        if (needsLogin(res.status, res.err.code)) { router.push('/login'); return; }
        if (res.err.code === 'EXTRA_PAYMENT_REQUIRED') { setView({ k: 'pay', q: { ...q, freeRemaining: 0 } }); return; }
        setErr(res.err.message ?? '소개코드를 받지 못했습니다.');
        return;
      }
      if (q.paymentRequired) { setView({ k: 'pay', q }); return; }
      setView({ k: 'msg', text: q.includedCodes > 0
        ? `이번 달 ${q.planName} 포함 소개코드(${q.includedCodes}건)를 모두 받았습니다. 받은 코드는 「안심소개에서 소개하기」에서 다시 볼 수 있습니다.`
        : `${q.planName} 요금제에는 무료 소개코드가 없습니다 · 건당 ${q.extraCodePrice.toLocaleString('ko-KR')}원으로 받습니다. 받은 코드는 「안심소개에서 소개하기」에서 다시 볼 수 있습니다.` });
    } catch {
      setErr('요청을 보내지 못했습니다. 잠시 뒤 다시 눌러 주십시오.');
    } finally { setBusy(false); }
  }

  async function pay(q: RefQuota) {
    setErr(null); setBusy(true);
    const amount = q.extraCodePrice;
    const orderId = `rcx-${crypto.randomUUID()}`;
    try {
      /* 시험 결제(스텁) — 결제창 키가 없을 때. 서버도 키가 없으면 stub:true 로 승인하고 돈은 오가지 않습니다 */
      if (!CLIENT_KEY) {
        const res = await issueCode({ ...(listingId ? { listingId } : {}), paymentKey: `stub_${crypto.randomUUID()}`, orderId, amount });
        if (res.ok) {
          const again = !!res.codes[0]?.reused;   // 그 사이 같은 매물 코드를 이미 받았으면 결제하지 않고 그 코드를 돌려줍니다
          setView({ k: 'shown', code: res.code, reused: again, paid: !again, stub: !again, perListing: q.scope !== 'all' });
          return;
        }
        if (needsLogin(res.status, res.err.code)) { router.push('/login'); return; }
        setErr(res.err.message ?? '결제가 승인되지 않았습니다.');
        return;
      }
      /* 토스 결제창 — 성공하면 /mall/give/pay 로 돌아와 서버가 승인 · 발급합니다 */
      const TossPayments = await loadToss();
      const origin = window.location.origin;
      const back = new URLSearchParams(listingId ? { listing: listingId } : {});
      await TossPayments(CLIENT_KEY).requestPayment('카드', {
        amount, orderId, orderName: '소개코드 추가 1건',
        successUrl: `${origin}/mall/give/pay?${back}`,
        failUrl: `${origin}/mall/give?pay=fail`,
      });
    } catch (e) {
      const x = e as { code?: string; message?: string };
      setErr(x?.code === 'USER_CANCEL' ? '결제를 취소하셨습니다.' : (x?.message ?? '결제창을 열지 못했습니다. 잠시 뒤 다시 시도해 주십시오.'));
    } finally { setBusy(false); }
  }

  return (
    <div data-refshare-state={view.k}>
      {view.k === 'idle' && (
        <div className="rc-act">
          <button type="button" className="rc-btn" disabled={busy} onClick={() => void open()} data-refshare-open="1">
            {busy ? '확인 중…' : '소개코드 공유'}
          </button>
        </div>
      )}

      {view.k === 'shown' && (
        <div data-refshare-code={view.code}>
          <p>
            내 소개코드 <span className="rc-code">{view.code}</span>
            {view.reused && <span className="rc-tag">{view.perListing ? '이 매물에 받은 코드' : '이번 달 받은 코드'}</span>}
            {view.paid && <span className="rc-tag">{view.stub ? '시험 결제로 추가' : '결제로 추가'}</span>}
          </p>
          <CopyLink text={`${base}?ref=${view.code}`} />
          <p className="rc-note">소개비는 거래 당사자에게 직접 받습니다 — 소개뱅크는 대금을 맡지 않습니다.</p>
        </div>
      )}

      {view.k === 'pay' && (
        <div className="rc-warn" data-refshare-pay="1">
          {!view.q.freePlan ? (
            /* D011 — 유료 요금제도 포함 건수를 넘으면 결제 후 발급합니다 */
            <p>이번 달 {view.q.planName} 요금제에 포함된 소개코드({view.q.includedCodes}건)를 모두 받았습니다.{view.q.scope !== 'all' && ' 새 매물의 코드는 추가 결제 후 받습니다.'}</p>
          ) : view.q.includedCodes <= 0 ? (
            /* v10.31 (합침 · w3 D060) — 무료 요금제 포함 소개코드 0건(시안) */
            <p data-refshare-nofree="1">무료 소개코드 없음 · 건당 {view.q.extraCodePrice.toLocaleString('ko-KR')}원 — 필요할 때 건마다 받습니다.{!view.q.identityVerified && <> 받으려면 먼저 <a href="/verify">본인인증</a>을 해 주십시오.</>}</p>
          ) : view.q.identityVerified ? (
            <p>이번 달 무료 소개코드({view.q.includedCodes}건)를 모두 받았습니다.{view.q.scope !== 'all' && ' 새 매물의 코드는 추가 결제 후 받습니다.'}</p>
          ) : (
            <p>본인인증 전에는 무료 소개코드가 없습니다. <a href="/verify">본인인증</a>을 하시면 매월 {view.q.includedCodes}건을 무료로 받습니다.</p>
          )}
          {!CLIENT_KEY && (
            <p className="rc-note">결제 연동 키가 없는 환경입니다 — <b>시험 결제(스텁)</b>로 진행합니다. 실제 돈은 오가지 않습니다.</p>
          )}
          <div className="rc-act">
            <button type="button" className="rc-btn" disabled={busy} onClick={() => void pay(view.q)} data-refshare-paybtn="1">
              {busy ? '결제 요청 중…' : CLIENT_KEY ? `추가 1건 ${won(view.q.extraCodePrice)} 결제` : `추가 1건 ${won(view.q.extraCodePrice)} 시험 결제(스텁)`}
            </button>
            <a className="rc-btn ghost" href="/my/subscription/upgrade">요금제 보기</a>
          </div>
        </div>
      )}

      {view.k === 'msg' && <p data-refshare-msg="1">{view.text} <a href="/mall/give">안심소개에서 소개하기</a></p>}

      {err && <p className="rc-err" role="alert">{err}</p>}
    </div>
  );
}
