'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ymdKst } from '@/lib/format';
import type { SubDetail } from './SubscriptionManage';

/**
 * SB-MYP-SUB-010 요금제 고르기 · 구독 결제 (v10.27 · G-189 · 10/8 답 ③ 「3 맞음」)
 *
 *   처음 유료(구독 없음 · 무료 · 프로모션 · 결제 실패 중) → 월 회비 전액을 지금 결제하고 오늘부터 30일.
 *   유료 구독 중에 올리기 · 내리기                        → **예약** — 지금 결제 없음 · 다음 결제일부터 새 요금제.
 *     올리기 예약은 다음 결제일에 등록된 카드로 새 월 회비를 결제하므로 카드가 있어야 합니다(서버가 422 BILLING_KEY_REQUIRED).
 *   결제창 키(NEXT_PUBLIC_TOSS_CLIENT_KEY)가 없으면 **시험 결제(스텁)** — 소개몰 · 소개코드 추가 결제와 같은 방식.
 *   키가 있으면 토스 결제창 → /my/subscription/pay 에서 서버가 승인합니다.
 * 환불 조건(결제 당일 · 열람 전)은 결제 전에 보이고, 확인 칸을 체크해야 결제됩니다.
 */
export interface PlanLite { code: string; name: string; monthlyPrice: number; lines?: { k: string; t: string }[]; note?: string }

const CLIENT_KEY = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? '';
const TOSS_SDK = 'https://js.tosspayments.com/v1/payment';
type TossPaymentsFn = (clientKey: string) => { requestPayment: (m: string, p: Record<string, unknown>) => Promise<unknown> };
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
const won = (n: number) => `${Number(n).toLocaleString('ko-KR')}원`;
/* 받침이 있으면 「으로」(ㄹ 받침은 「로」) */
const ro = (n: string) => { const c = n.charCodeAt(n.length - 1) - 0xac00; if (c < 0 || c > 11171) return `${n}(으)로`; const j = c % 28; return n + (j === 0 || j === 8 ? '로' : '으로'); };

type Kind = 'NEW' | 'UP' | 'DOWN';

export function PlanPicker({ plans, detail, canSubscribe }: { plans: PlanLite[]; detail: SubDetail | null; canSubscribe: boolean }) {
  const router = useRouter();
  const t = useTranslations('billing.plan');
  const tc = useTranslations('billing.common');
  const locale = useLocale();
  /* 한국어만 조사(으로 · 로)를 붙입니다 */
  const roN = (n: string) => (locale === 'ko' ? ro(n) : n);
  const [pick, setPick] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<[ 'ok' | 'err', string ] | null>(null);

  const subscribed = !!detail?.subscribed;
  const curCode = subscribed ? detail?.planCode ?? null : null;
  const cur = plans.find((p) => p.code === curCode) ?? null;
  const curPaid = !!cur && Number(cur.monthlyPrice) > 0;
  /* 예약이 되는 경우 — 서버(billing.service reservePlan)와 같은 조건 */
  const reserveMode = subscribed && detail?.status === 'ACTIVE' && !detail?.isPromo && curPaid
    && !!detail?.periodEnd && new Date(detail.periodEnd).getTime() > Date.now();
  const nextDay = ymdKst(detail?.periodEnd);

  const kindOf = (p: PlanLite): Kind => (!reserveMode ? 'NEW' : Number(p.monthlyPrice) > Number(cur?.monthlyPrice ?? 0) ? 'UP' : 'DOWN');

  async function reserve(p: PlanLite) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/v1/subscriptions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ planCode: p.code }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setMsg(['err', j?.message ?? t('reserveFail')]); return; }
      setMsg(['ok', j?.note ?? t('reservedMsg', { date: nextDay, plan: roN(p.name) })]); setPick(null);
      router.refresh();
    } catch { setMsg(['err', tc('network')]); }
    finally { setBusy(false); }
  }

  async function pay(p: PlanLite) {
    if (!agree) { setMsg(['err', t('needAgree')]); return; }
    setBusy(true); setMsg(null);
    const orderId = `sub-${crypto.randomUUID()}`;
    try {
      if (!CLIENT_KEY) {
        /* 시험 결제 — 서버도 결제사 키가 없으면 stub 으로 승인하고 돈은 오가지 않습니다 */
        const r = await fetch('/api/v1/subscriptions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ planCode: p.code, paymentKey: `stub_${crypto.randomUUID()}`, orderId }),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok) { setMsg(['err', j?.message ?? t('notApproved')]); return; }
        setMsg(['ok', t('stubOk', { amount: won(p.monthlyPrice), plan: p.name })]); setPick(null); setAgree(false);
        router.refresh();
        return;
      }
      const TossPayments = await loadToss();
      const origin = window.location.origin;
      await TossPayments(CLIENT_KEY).requestPayment('카드', {
        amount: Number(p.monthlyPrice), orderId, orderName: `${p.name} 구독료`,
        successUrl: `${origin}/my/subscription/pay?plan=${encodeURIComponent(p.code)}`,
        failUrl: `${origin}/my/subscription?pay=fail`,
      });
    } catch (e) {
      const x = e as { code?: string; message?: string };
      setMsg(['err', x?.code === 'USER_CANCEL' ? t('userCancel') : (x?.message ?? t('openFail'))]);
    } finally { setBusy(false); }
  }

  function button(p: PlanLite) {
    if (!canSubscribe) return null;
    if (p.code === curCode) return <span className="badge verified" data-plan-current={p.code}>{t('current')}</span>;
    if (detail?.nextPlanCode === p.code) return <span className="badge" data-plan-reserved={p.code}>{t('reservedBadge', { date: nextDay })}</span>;
    if (reserveMode && detail?.cancelAt) return <span className="dim">{t('unreserveFirst')}</span>;
    const k = kindOf(p);
    /* 구독이 없을 때 무료(베이직)는 결제 없이 시작 — 소개코드를 처음 받을 때도 서버가 열어 줍니다 */
    return (
      <button type="button" className={pick === p.code ? 'btn-primary on' : 'btn-primary'} data-plan-pick={p.code} aria-expanded={pick === p.code}
              onClick={() => { setPick(pick === p.code ? null : p.code); setAgree(false); setMsg(null); }}>
        {k === 'NEW' ? (Number(p.monthlyPrice) > 0 ? t('pickPaid') : t('startFree')) : t('pickNext')}
      </button>
    );
  }

  const to = plans.find((p) => p.code === pick) ?? null;
  const k = to ? kindOf(to) : null;

  return (
    <>
      <div className="grid plans" id="plans" data-plan-grid>
        {plans.map((pl) => (
          <div key={pl.code} className={pl.code === curCode ? 'card plan on' : 'card plan'} data-plan={pl.code}>
            {/* v10.32 — 시안: 이름 옆 「이용 중」 칩 · 값 뒤 「/월」 */}
            <strong className="plan-nm">{pl.name}{pl.code === curCode && <span className="plan-using">{t('using')}</span>}</strong>
            <div className="money">{Number(pl.monthlyPrice) === 0 ? tc('free') : <>{won(pl.monthlyPrice)}<small className="plan-per">{t('perMonth')}</small></>}</div>
            <ul>{(pl.lines ?? []).map((l) => <li key={l.k} data-plan-line={l.k} {...(l.k === 'view' ? { 'data-view-limit': pl.code } : {})}>{l.t}</li>)}</ul>
            {pl.note && <p className="plan-note">{pl.note}</p>}
            <div className="plan-btn">{button(pl)}</div>
          </div>
        ))}
      </div>
      {!canSubscribe && (
        <p className="notice" data-plan-needbiz>{t.rich('needBiz', { b: (c) => <b>{c}</b> })}</p>
      )}

      {to && k && (
        <section className="card sub-pay" data-plan-panel={k}>
          <h2>{k === 'NEW' ? t('hNew', { plan: to.name }) : k === 'UP' ? t('hUp', { plan: roN(to.name) }) : t('hDown', { plan: roN(to.name) })}</h2>
          <table className="tbl"><tbody>
            <tr><th>{t('thCur')}</th><td>{cur ? t('curVal', { plan: cur.name, price: won(cur.monthlyPrice) }) : t('none')}{reserveMode && t('nextPay', { date: nextDay })}</td></tr>
            <tr><th>{t('thTo')}</th><td>{to.name} · {Number(to.monthlyPrice) > 0 ? tc('monthly', { price: won(to.monthlyPrice) }) : tc('free')}</td></tr>
            <tr><th>{t('thApply')}</th><td>{k === 'NEW' ? `${t('applyNew')}${Number(to.monthlyPrice) > 0 ? t('applyAuto', { price: won(to.monthlyPrice) }) : ''}` : <>{t.rich('applyReserve', { b: (c) => <b>{c}</b>, date: nextDay, plan: to.name, cur: cur?.name ?? '' })}</>}</td></tr>
            <tr><th>{t('thAmount')}</th><td data-plan-amount>{k === 'NEW' ? (Number(to.monthlyPrice) > 0 ? won(to.monthlyPrice) : t('noneFree')) : t('noPayNow')}</td></tr>
          </tbody></table>

          {k === 'NEW' && Number(to.monthlyPrice) > 0 ? (
            <>
              <div className="note warn">{t.rich('refundWarn', { b: (c) => <b>{c}</b> })}</div>
              <label className="agree-line"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-plan-agree /> {t('agree')} <b className="warn-text">{t('required')}</b></label>
              <div className="invite-actions">
                <button type="button" className="btn-primary" disabled={busy || !agree} onClick={() => void pay(to)} data-plan-pay>
                  {busy ? t('paying') : t('payBtn', { amount: won(to.monthlyPrice) })}
                </button>
                <button type="button" className="btn ghost" onClick={() => setPick(null)}>{tc('close')}</button>
              </div>
              {!CLIENT_KEY && <p className="hint">{t.rich('stubHint', { b: (c) => <b>{c}</b> })}</p>}
            </>
          ) : k === 'NEW' ? (
            <div className="invite-actions">
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void reserve(to)} data-plan-free>{busy ? tc('processing') : t('startFree')}</button>
              <button type="button" className="btn ghost" onClick={() => setPick(null)}>{tc('close')}</button>
            </div>
          ) : (
            <>
              <div className="note info">
                {t.rich('reserveInfo', { b: (c) => <b>{c}</b>, date: nextDay, plan: roN(to.name), cur: cur?.name ?? '',
                  fee: Number(to.monthlyPrice) > 0 ? t('feeMonthly', { price: won(to.monthlyPrice) }) : t('feeFree') })}
                {k === 'UP' && <> {detail?.hasBillingKey
                  ? t.rich('upInfo', { b: (c) => <b>{c}</b> })
                  : t.rich('upInfoNoKey', { b: (c) => <b>{c}</b>, a: (c) => <a href="/my/payment">{c}</a> })}</>}
                {k === 'DOWN' && Number(to.monthlyPrice) < Number(cur?.monthlyPrice ?? 0) && <> {t('downInfo')}</>}
              </div>
              <div className="invite-actions">
                <button type="button" className="btn-primary" disabled={busy} onClick={() => void reserve(to)} data-plan-reserve>{busy ? tc('processing') : t('changeBtn', { date: nextDay })}</button>
                <button type="button" className="btn ghost" onClick={() => setPick(null)}>{tc('close')}</button>
              </div>
            </>
          )}
        </section>
      )}
      {msg && <p className={msg[0] === 'ok' ? 'form-ok' : 'form-error'} role={msg[0] === 'ok' ? 'status' : 'alert'} data-plan-msg={msg[0]}>{msg[1]}</p>}
    </>
  );
}
