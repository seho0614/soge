'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
      if (!r.ok) { setMsg(['err', j?.message ?? '예약하지 못했습니다.']); return; }
      setMsg(['ok', j?.note ?? `${nextDay}부터 ${ro(p.name)} 바뀝니다.`]); setPick(null);
      router.refresh();
    } catch { setMsg(['err', '연결하지 못했습니다. 잠시 후 다시 시도해 주십시오.']); }
    finally { setBusy(false); }
  }

  async function pay(p: PlanLite) {
    if (!agree) { setMsg(['err', '환불 조건 확인 칸을 체크해 주십시오.']); return; }
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
        if (!r.ok) { setMsg(['err', j?.message ?? '결제가 승인되지 않았습니다.']); return; }
        setMsg(['ok', `결제가 승인되었습니다(시험 결제 · ${won(p.monthlyPrice)}) — 오늘부터 ${p.name} 요금제입니다.`]); setPick(null); setAgree(false);
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
      setMsg(['err', x?.code === 'USER_CANCEL' ? '결제를 취소하셨습니다.' : (x?.message ?? '결제창을 열지 못했습니다. 잠시 뒤 다시 시도해 주십시오.')]);
    } finally { setBusy(false); }
  }

  function button(p: PlanLite) {
    if (!canSubscribe) return null;
    if (p.code === curCode) return <span className="badge verified" data-plan-current={p.code}>지금 요금제</span>;
    if (detail?.nextPlanCode === p.code) return <span className="badge" data-plan-reserved={p.code}>{nextDay}부터 예약됨</span>;
    if (reserveMode && detail?.cancelAt) return <span className="dim">해지 예약을 거두면 바꿀 수 있습니다</span>;
    const k = kindOf(p);
    /* 구독이 없을 때 무료(베이직)는 결제 없이 시작 — 소개코드를 처음 받을 때도 서버가 열어 줍니다 */
    return (
      <button type="button" className={pick === p.code ? 'btn-primary on' : 'btn-primary'} data-plan-pick={p.code} aria-expanded={pick === p.code}
              onClick={() => { setPick(pick === p.code ? null : p.code); setAgree(false); setMsg(null); }}>
        {k === 'NEW' ? (Number(p.monthlyPrice) > 0 ? '이 요금제로' : '무료로 시작') : '이 요금제로 (다음 결제일부터)'}
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
            <strong className="plan-nm">{pl.name}{pl.code === curCode && <span className="plan-using">이용 중</span>}</strong>
            <div className="money">{Number(pl.monthlyPrice) === 0 ? '무료' : <>{won(pl.monthlyPrice)}<small className="plan-per">/월</small></>}</div>
            <ul>{(pl.lines ?? []).map((l) => <li key={l.k} data-plan-line={l.k} {...(l.k === 'view' ? { 'data-view-limit': pl.code } : {})}>{l.t}</li>)}</ul>
            {pl.note && <p className="plan-note">{pl.note}</p>}
            <div className="plan-btn">{button(pl)}</div>
          </div>
        ))}
      </div>
      {!canSubscribe && (
        <p className="notice" data-plan-needbiz>요금제 결제는 <b>회원 본인 계정</b>(개인 · 사업자 대표)으로 할 수 있습니다. 직원 계정으로는 고르실 수 없습니다.</p>
      )}

      {to && k && (
        <section className="card sub-pay" data-plan-panel={k}>
          <h2>{k === 'NEW' ? `${to.name} 구독 시작` : k === 'UP' ? `${ro(to.name)} 올리기 — 예약` : `${ro(to.name)} 내리기 — 예약`}</h2>
          <table className="tbl"><tbody>
            <tr><th>지금 요금제</th><td>{cur ? `${cur.name} · 월 ${won(cur.monthlyPrice)}` : '없음'}{reserveMode && ` · 다음 결제일 ${nextDay}`}</td></tr>
            <tr><th>바꿀 요금제</th><td>{to.name} · {Number(to.monthlyPrice) > 0 ? `월 ${won(to.monthlyPrice)}` : '무료'}</td></tr>
            <tr><th>적용</th><td>{k === 'NEW' ? `오늘부터 30일${Number(to.monthlyPrice) > 0 ? ` · 그 뒤 월 ${won(to.monthlyPrice)} 자동 결제` : ''}` : <><b>{nextDay}(다음 결제일)부터</b> {to.name} · 그 전까지는 {cur?.name} 그대로</>}</td></tr>
            <tr><th>이번에 결제할 금액</th><td data-plan-amount>{k === 'NEW' ? (Number(to.monthlyPrice) > 0 ? won(to.monthlyPrice) : '없음(무료)') : '지금 결제 없음'}</td></tr>
          </tbody></table>

          {k === 'NEW' && Number(to.monthlyPrice) > 0 ? (
            <>
              <div className="note warn"><b>환불은 결제 당일에만 가능합니다.</b> 결제하시는 순간부터 요청을 열람하실 수 있어, <b>한 건이라도 열람하시면 당일이어도 환불되지 않습니다</b> — 열람한 연락처는 되돌릴 수 없기 때문입니다.</div>
              <label className="agree-line"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-plan-agree /> 위 금액 · 자동 결제 · 환불 조건을 확인했습니다 <b className="warn-text">(필수)</b></label>
              <div className="invite-actions">
                <button type="button" className="btn-primary" disabled={busy || !agree} onClick={() => void pay(to)} data-plan-pay>
                  {busy ? '결제하는 중…' : `${won(to.monthlyPrice)} 결제하기`}
                </button>
                <button type="button" className="btn ghost" onClick={() => setPick(null)}>닫기</button>
              </div>
              {!CLIENT_KEY && <p className="hint">결제사 키가 없는 환경이라 <b>시험 결제</b>입니다 — 실제 돈은 오가지 않습니다.</p>}
            </>
          ) : k === 'NEW' ? (
            <div className="invite-actions">
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void reserve(to)} data-plan-free>{busy ? '처리 중…' : '무료로 시작'}</button>
              <button type="button" className="btn ghost" onClick={() => setPick(null)}>닫기</button>
            </div>
          ) : (
            <>
              <div className="note info">
                <b>지금 결제하는 돈은 없습니다.</b> {nextDay}부터 {ro(to.name)} 바뀝니다{Number(to.monthlyPrice) > 0 ? `(월 ${won(to.monthlyPrice)})` : '(무료)'}.
                그 전까지 {cur?.name}의 혜택이 그대로이고, 예약은 그 전에 거둘 수 있습니다.
                {k === 'UP' && <> 그날 등록하신 카드로 새 월 회비가 결제되고, <b>결제가 되어야</b> 바뀝니다{!detail?.hasBillingKey && <> — <a href="/my/payment">결제 수단</a>을 먼저 등록해 주십시오</>}.</>}
                {k === 'DOWN' && Number(to.monthlyPrice) < Number(cur?.monthlyPrice ?? 0) && ' 요금제를 내리면 다음 결제일부터 노출 슬롯이 줄어 넘치는 매물이 내려갑니다.'}
              </div>
              <div className="invite-actions">
                <button type="button" className="btn-primary" disabled={busy} onClick={() => void reserve(to)} data-plan-reserve>{busy ? '처리 중…' : `${nextDay}부터 바꾸기`}</button>
                <button type="button" className="btn ghost" onClick={() => setPick(null)}>닫기</button>
              </div>
            </>
          )}
        </section>
      )}
      {msg && <p className={msg[0] === 'ok' ? 'form-ok' : 'form-error'} role={msg[0] === 'ok' ? 'status' : 'alert'} data-plan-msg={msg[0]}>{msg[1]}</p>}
    </>
  );
}
