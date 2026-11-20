'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTossClientKey } from '@/lib/useTossClientKey';
import { lsxCall, kstDate, kstShort } from './api';

export interface ToolItem {
  id: string; title: string; status: string; listingNo: number; liveUntil: string | null; lastBumpAt: string | null;
  expiresAt: string | null; expiredByDate: boolean; daysLeft: number | null;
  request: { state: string; months: number | null; rejectReason: string | null } | null;
  summary: { state: string; lines: string[] | null } | null;
}
export interface ToolPolicy { expiryOn: boolean; warnDays: number; bumpMode: string; effectHours: number; minHours: number; freeCount: number; freeLeft: number; periodDays: number; aiSummary: boolean }

const TOSS_SDK = 'https://js.tosspayments.com/v1/payment';
type TossFn = (clientKey: string) => { requestPayment: (method: string, params: Record<string, unknown>) => Promise<unknown> };
let sdk: Promise<TossFn> | null = null;
function loadToss(): Promise<TossFn> {
  const w = window as unknown as { TossPayments?: TossFn };
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
 * v10.514 · 515 (D276) 매물 관리 도구 한 줄 — 만료일 · 연장 요청 · 끌어올리기(FREE · PAID)
 *   PAID: 서버가 422 LSX_BUMP_PAYMENT_REQUIRED(금액 · 주문 번호)를 주면 결제창(키 없으면 시험 결제 stub_…) → 승인 뒤에만 끌어올림
 */
export function ToolsRow({ item, policy }: { item: ToolItem; policy: ToolPolicy }) {
  const t = useTranslations('lsx');
  const router = useRouter();
  const { key, ready } = useTossClientKey();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [months, setMonths] = useState('3');

  async function extend() {
    setBusy(true); setMsg(null);
    try {
      const r = await lsxCall(`/me/lsx/listings/${item.id}/extend-request`, 'POST', { months: Number(months) });
      setMsg(r.ok ? { ok: true, text: t('extendSent') } : { ok: false, text: r.body.message ?? t('saveFail') });
      if (r.ok) router.refresh();
    } finally { setBusy(false); }
  }

  async function bump() {
    setBusy(true); setMsg(null);
    try {
      let r = await lsxCall<{ stub?: boolean }>(`/me/lsx/listings/${item.id}/bump`, 'POST', {});
      if (!r.ok && r.body.code === 'LSX_BUMP_PAYMENT_REQUIRED') {
        const d = r.body.details as { amount: number; orderId: string; orderName: string } | undefined;
        if (!d) { setMsg({ ok: false, text: t('bumpFail') }); return; }
        if (!key) {
          /* 시험 결제(스텁) — 결제창 키가 없을 때. 서버도 키가 없으면 stub 으로 승인하고 돈은 오가지 않습니다 */
          r = await lsxCall<{ stub?: boolean }>(`/me/lsx/listings/${item.id}/bump`, 'POST', { paymentKey: `stub_${crypto.randomUUID()}`, orderId: d.orderId, amount: d.amount });
        } else {
          const Toss = await loadToss();
          const origin = window.location.origin;
          await Toss(key).requestPayment('카드', {
            amount: d.amount, orderId: d.orderId, orderName: d.orderName,
            successUrl: `${origin}/my/listing-tools/bump-pay?listing=${item.id}`,
            failUrl: `${origin}/my/listing-tools?pay=fail`,
          });
          return;
        }
      }
      if (r.ok) { setMsg({ ok: true, text: r.body.stub ? `${t('bumpDone')} (${t('bumpStub')})` : t('bumpDone') }); router.refresh(); }
      else setMsg({ ok: false, text: r.body.message ?? t('bumpFail') });
    } catch (e) {
      const x = e as { code?: string; message?: string };
      setMsg({ ok: false, text: x?.code === 'USER_CANCEL' ? t('payCanceled') : (x?.message ?? t('bumpFail')) });
    } finally { setBusy(false); }
  }

  const live = item.liveUntil && new Date(item.liveUntil).getTime() > Date.now();
  return (
    <div className="my-lrow" data-lsx-tool={item.id}>
      <div className="my-lt">
        <b>{item.title}</b> <small>L-{item.listingNo}</small>
        <div>
          {item.expiredByDate ? <span className="warn-text">{t('expiredByDate')}</span>
            : item.expiresAt ? <span data-lsx-expires={item.daysLeft ?? ''}>{t('expires', { date: kstDate(item.expiresAt) })} · {t('expiresLeft', { n: String(item.daysLeft ?? 0) })}</span>
            : <span>{t('expiresNone')}</span>}
          {live && <> · <span data-lsx-live="">{t('bumpLive', { date: kstShort(item.liveUntil) })}</span></>}
          {item.summary && <> · <span>{item.summary.state === 'APPROVED' ? t('aiStateApproved') : t('aiStateDraft')}</span></>}
        </div>
        {item.request?.state === 'REJECTED' && item.request.rejectReason && <div className="warn-text">{t('extendRejected', { reason: item.request.rejectReason })}</div>}
        {msg && <div className={msg.ok ? '' : 'warn-text'} role="status">{msg.text}</div>}
      </div>
      <div>
        {item.request?.state === 'REQUESTED' ? <span>{t('extendOpen')}</span> : (
          <span>
            <select value={months} onChange={(e) => setMonths(e.target.value)} aria-label={t('extendBtn')}>
              {[1, 3, 6, 12].map((m) => <option key={m} value={String(m)}>{t('extendMonths', { n: String(m) })}</option>)}
            </select>{' '}
            <button type="button" className="btn-sm" disabled={busy} onClick={extend} data-lsx-extend-req={item.id}>{t('extendBtn')}</button>
          </span>
        )}{' '}
        {policy.bumpMode !== 'OFF' && item.status === 'PUBLISHED' && (
          <button type="button" className="btn-sm" disabled={busy || (policy.bumpMode === 'PAID' && !ready) || (policy.bumpMode === 'FREE' && policy.freeLeft <= 0)}
            onClick={bump} data-lsx-bump-btn={item.id}>{t('bumpBtn')}</button>
        )}
      </div>
    </div>
  );
}
