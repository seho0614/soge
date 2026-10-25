'use client';
/**
 * v10.31 (W5 · SB-PTC-CTR-400) — 리드 이용료 선불 충전 · 자동 청구 · 환불
 *
 *   충전   POST /partner/cash/charges(주문 — 금액 · 등급 할인은 서버가 정함) → 결제
 *          결제창 키(NEXT_PUBLIC_TOSS_CLIENT_KEY)가 없으면 **시험 결제(스텁)** — 구독 결제 · 소개몰과 같은 방식(서버도 결제사 키가 없으면 스텁으로 승인).
 *          키가 있으면 토스 결제창 → /partner/cash/pay 에서 서버가 승인 확인(POST /partner/cash/charges/confirm).
 *   자동   PUT /partner/cash/auto — 「○원 미만이면 ○원 청구」(등록된 카드 · 구독 결제와 같은 빌링키)
 *   환불   POST /partner/cash/refunds — 유상 잔액만(보너스는 환불 대상 아님 · 환불한 충전의 보너스는 회수)
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './act';
import { useTranslations } from 'next-intl';
import { useFmt } from '@/lib/useFmt';

const CLIENT_KEY = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? '';
const TOSS_SDK = 'https://js.tosspayments.com/v1/payment';
type TossPaymentsFn = (clientKey: string) => { requestPayment: (m: string, p: Record<string, unknown>) => Promise<unknown> };
let sdk: Promise<TossPaymentsFn> | null = null;
function loadToss(): Promise<TossPaymentsFn> {
  const w = window as unknown as { TossPayments?: TossPaymentsFn };
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
/** v10.102 (2-5c) — 화면 언어에 묶은 원 표기(ko 「1,000원」 · en 「₩1,000」) */
const useWon = () => { const fm = useFmt(); return (n: number | null | undefined) => fm.won(n ?? 0); };

export function ChargeForm({ min, max, room, bonusRate, canMoney }: { min: number; max: number; room: number; bonusRate: number; canMoney: boolean }) {
  const t = useTranslations('partnerOps.cashPanel');
  const won = useWon();
  const router = useRouter();
  const [amount, setAmount] = useState<number>(Math.min(Math.max(300000, min), Math.max(min, Math.min(max, room))));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<['ok' | 'err', string] | null>(null);
  const presets = [100000, 300000, 500000, 1000000].filter((v) => v >= min && v <= max);
  const bonus = Math.floor(amount * bonusRate);

  async function charge() {
    setBusy(true); setMsg(null);
    try {
      const c = await api<{ orderId: string; amount: number; orderName: string }>('POST', '/partner/cash/charges', { amount });
      if (!CLIENT_KEY) {
        const r = await api<{ note: string }>('POST', '/partner/cash/charges/confirm',
          { orderId: c.orderId, paymentKey: `stub_${crypto.randomUUID()}`, amount: c.amount });
        setMsg(['ok', r.note ?? t('charged')]);
        router.refresh();
        return;
      }
      const Toss = await loadToss();
      await Toss(CLIENT_KEY).requestPayment('카드', {
        amount: c.amount, orderId: c.orderId, orderName: c.orderName,
        successUrl: `${window.location.origin}/partner/cash/pay`,
        failUrl: `${window.location.origin}/partner/cash?pay=fail`,
      });
    } catch (e) {
      const x = e as { code?: string; message?: string };
      setMsg(['err', x?.code === 'USER_CANCEL' ? t('canceled') : (x?.message ?? t('chargeFail'))]);
    } finally { setBusy(false); }
  }

  if (!canMoney) return <p className="pt-ls">{t('noPerm')}</p>;
  return (
    <div data-cash-charge>
      <div className="pt-row">
        <div className="pt-amt-pre">
          {presets.map((v) => (
            <button key={v} type="button" className={`pt-chip${v === amount ? ' on' : ''}`} onClick={() => setAmount(v)}>{won(v)}</button>
          ))}
        </div>
        <label>{t('direct')}
          <input className="pt-input" type="number" inputMode="numeric" min={min} max={max} step={1000} value={amount}
                 onChange={(e) => setAmount(Math.floor(Number(e.target.value) || 0))} style={{ width: 140 }} />
        </label>
        <button type="button" className="pt-bp" onClick={() => void charge()} disabled={busy || amount < min || amount > max || amount > room}>
          {busy ? t('paying') : t('chargeBtn', { amt: won(amount) })}
        </button>
      </div>
      <p className="pt-ls" style={{ marginTop: 6 }}>
        {t('chargeInfo', { pct: String(Math.round(bonusRate * 100)), bonus: won(bonus), min: won(min), max: won(max), room: won(room) })}
        {!CLIENT_KEY && <> · {t.rich('stubInfo', { b: (c) => <b>{c}</b> })}</>}
      </p>
      {msg && <p className={`pt-msg ${msg[0]}`} role="status">{msg[1]}</p>}
    </div>
  );
}

export function AutoForm({ on, below, amount, engine, card, min, max, canMoney }: {
  on: boolean; below: number | null; amount: number | null; engine: boolean; card: { company: string | null; last4: string | null } | null;
  min: number; max: number; canMoney: boolean;
}) {
  const t = useTranslations('partnerOps.cashPanel');
  const won = useWon();
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [b, setB] = useState<number>(below ?? 100000);
  const [a, setA] = useState<number>(amount ?? 300000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<['ok' | 'err', string] | null>(null);
  async function save(next: boolean) {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ note: string }>('PUT', '/partner/cash/auto', next ? { on: true, below: b, amount: a } : { on: false });
      setMsg(['ok', r.note]); setEdit(false); router.refresh();
    } catch (e) { setMsg(['err', (e as Error).message]); } finally { setBusy(false); }
  }
  return (
    <div data-cash-auto>
      <div className="pt-subnow">
        <div><span className="pt-ls">{t('setting')}</span>
          <b>{below != null && amount != null ? t('rule', { below: won(below), amt: won(amount) }) : t('unset')}</b>
          <span className="pt-ls">{on ? t('on') : t('off')}</span></div>
        <div><span className="pt-ls">{t('engine')}</span>
          <b>{engine ? t('engineOn') : t('engineNone')}</b>
          <span className="pt-ls">{engine ? t('card', { company: card?.company ?? '', last4: card?.last4 ?? '' }) : t('noCard')}</span></div>
        {canMoney ? <button type="button" className="pt-bo" onClick={() => setEdit(!edit)}>{t('change')}</button> : <span className="pt-ls">{t('permOnly')}</span>}
      </div>
      {edit && (
        <div className="pt-fset" style={{ marginTop: 10 }}>
          <div className="pt-row">
            <label>{t('belowLabel')}
              <input className="pt-input" type="number" min={1000} step={1000} value={b} onChange={(e) => setB(Math.floor(Number(e.target.value) || 0))} style={{ width: 140 }} />
            </label>
            <label>{t('amtLabel')}
              <input className="pt-input" type="number" min={min} max={max} step={1000} value={a} onChange={(e) => setA(Math.floor(Number(e.target.value) || 0))} style={{ width: 140 }} />
            </label>
            <button type="button" className="pt-bp" disabled={busy} onClick={() => void save(true)}>{t('saveOn')}</button>
            {on && <button type="button" className="pt-bo" disabled={busy} onClick={() => void save(false)}>{t('turnOff')}</button>}
          </div>
          {!engine && <p className="pt-ls" style={{ marginTop: 6 }}>{t.rich('cardNote', { a: (c) => <a href="/my/subscription">{c}</a> })}</p>}
        </div>
      )}
      {msg && <p className={`pt-msg ${msg[0]}`} role="status">{msg[1]}</p>}
    </div>
  );
}

export function RefundForm({ refundable, canMoney }: { refundable: number; canMoney: boolean }) {
  const t = useTranslations('partnerOps.cashPanel');
  const won = useWon();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number>(refundable);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<['ok' | 'err', string] | null>(null);
  async function go() {
    if (!confirm(t('refundConfirm', { amt: won(amount) }))) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ note: string }>('POST', '/partner/cash/refunds', { amount, reason });
      setMsg(['ok', r.note]); setOpen(false); router.refresh();
    } catch (e) { setMsg(['err', (e as Error).message]); } finally { setBusy(false); }
  }
  if (!canMoney) return null;
  return (
    <div data-cash-refund>
      {!open
        ? <button type="button" className="pt-bo" disabled={refundable <= 0} onClick={() => { setAmount(refundable); setOpen(true); }}>
            {t('refundBtn')}{refundable > 0 ? ` ${t('refundMax', { amt: won(refundable) })}` : ''}</button>
        : (
          <div className="pt-fset">
            <div className="pt-row">
              <label>{t('refundAmt')}
                <input className="pt-input" type="number" min={1} max={refundable} value={amount} onChange={(e) => setAmount(Math.floor(Number(e.target.value) || 0))} style={{ width: 140 }} />
              </label>
              <label style={{ flex: 1, minWidth: 200 }}>{t('reason')}
                <input className="pt-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('reasonPh')} />
              </label>
              <button type="button" className="pt-bp" disabled={busy || amount <= 0 || amount > refundable || reason.trim().length < 2} onClick={() => void go()}>
                {busy ? t('refunding') : t('refundReq')}</button>
              <button type="button" className="pt-bo" onClick={() => setOpen(false)}>{t('close')}</button>
            </div>
          </div>
        )}
      {msg && <p className={`pt-msg ${msg[0]}`} role="status">{msg[1]}</p>}
    </div>
  );
}

/** 결제창에서 돌아온 뒤 승인 확인 — 한 번만 */
export function CashPayConfirm({ paymentKey, orderId, amount }: { paymentKey: string; orderId: string; amount: number }) {
  const t = useTranslations('partnerOps.cashPanel');
  const [st, setSt] = useState<['wait' | 'ok' | 'err', string]>(['wait', t('checking')]);
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return; sent.current = true;
    void api<{ note: string }>('POST', '/partner/cash/charges/confirm', { orderId, paymentKey, amount })
      .then((r) => setSt(['ok', r.note ?? t('charged')]))
      .catch((e) => setSt(['err', (e as Error).message]));
  }, [paymentKey, orderId, amount]);
  return (
    <div data-cash-pay={st[0]}>
      <p className={`pt-msg ${st[0] === 'err' ? 'err' : 'ok'}`} role="status">{st[1]}</p>
      {st[0] !== 'wait' && <p><a className="pt-bp" href="/partner/cash">{t('backToCash')}</a></p>}
    </div>
  );
}
