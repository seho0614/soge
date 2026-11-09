'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useFmt } from '@/lib/useFmt';
import { ymdKst } from '@/lib/format';

export interface Cashout {
  cashable: number; min: number; taxRate: string | null; identityVerified: boolean; open: boolean;
  taxIdOn: boolean; taxIdMask: string | null;
  blocker: 'TAX_UNSET' | 'IDENTITY' | 'OPEN' | 'ACCOUNT' | 'TAX_ID' | 'BELOW_MIN' | null;
  accounts: Array<{ id: string; bankName: string; last4: string | null; holderName: string; isStub: boolean }>;
  requests: Array<{ id: string; points: number; withholding: number; netAmount: number; status: 'REQUESTED' | 'CONFIRMED' | 'PAID' | 'REJECTED' | 'CANCELED';
    bankName: string; last4: string | null; requestedAt: string; paidAt: string | null; closedReason: string | null }>;
}

/* 서버(fn_point_cashout_new)와 같은 셈 — 소득세(비율의 10/11 · 10원 미만 버림) + 지방소득세(소득세의 10% · 10원 미만 버림) */
const taxOf = (points: number, rate: number) => {
  const income = Math.floor(Math.round((points * rate * 10) / 1.1) / 10000) * 10;
  return income + Math.floor(income / 100) * 10;
};

/**
 * v10.219 (D190 · docs/352) — 포인트 출금 신청. GET/POST /me/points/cashout · POST …/:id/cancel
 * 현금화 가능 포인트를 확인된 본인 계좌로 — 운영 확정 · 지급 담당 이체 뒤 「지급됨」. 잔액 · 최소 · 계좌 · 원천징수율은 서버 · DB 가 다시 막습니다.
 */
export function CashoutBox({ c }: { c: Cashout }) {
  const router = useRouter();
  const t = useTranslations('myDeal.cashout');
  const [pending, start] = useTransition();
  const [pts, setPts] = useState(String(c.cashable >= c.min ? c.cashable : c.min));
  const [acc, setAcc] = useState(c.accounts[0]?.id ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [tid, setTid] = useState('');
  const [tidOpen, setTidOpen] = useState(!c.taxIdMask);
  const rate = c.taxRate == null ? null : Number(c.taxRate);
  const n = Math.floor(Number(pts) || 0);
  const tax = rate == null ? 0 : taxOf(n, rate);
  const f = useFmt();
  const fmt = (v: number) => f.won(v);

  function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null); setInfo(null);
    start(async () => {
      const r = await fetch('/api/v1/me/points/cashout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ points: n, payoutAccountId: acc }) });
      const d = await r.json().catch(() => null);
      if (r.status === 401) { router.push('/login'); return; }
      if (!r.ok) { setErr(d?.message ?? t('fail')); return; }
      setInfo(d?.note ?? t('sent')); router.refresh();
    });
  }
  function saveTaxId(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null); setInfo(null);
    start(async () => {
      const r = await fetch('/api/v1/me/points/cashout/tax-id', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taxId: tid }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? t('fail')); return; }
      setTid(''); setTidOpen(false); setInfo(d?.note ?? t('taxIdSaved')); router.refresh();
    });
  }
  function cancel(id: string) {
    setErr(null); setInfo(null);
    start(async () => {
      const r = await fetch(`/api/v1/me/points/cashout/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? t('fail')); return; }
      setInfo(d?.note ?? t('canceled')); router.refresh();
    });
  }

  return (
    <section className="my-card" data-cashout-box="" data-cashout-blocker={c.blocker ?? ''}>
      <h2 className="my-s2">{t('title')}</h2>
      <p className="my-ls">{t('lead', { v: fmt(c.cashable), min: fmt(c.min), rate: rate == null ? '—' : `${c.taxRate}%` })}</p>
      {c.taxIdOn && (
        <div data-cashout-taxid={c.taxIdMask ? 'set' : 'none'}>
          <p className="my-ls">{t('taxId')} {c.taxIdMask ? <b>{c.taxIdMask}</b> : t('taxIdNone')}
            {c.taxIdMask && !tidOpen && <> <button type="button" className="my-bo" onClick={() => setTidOpen(true)}>{t('taxIdEdit')}</button></>}</p>
          {tidOpen && (
            <form onSubmit={saveTaxId} className="p2form" data-cashout-taxid-form="">
              <label className="fld"><span>{t('taxIdLabel')}</span>
                <input inputMode="numeric" autoComplete="off" maxLength={14} placeholder="000000-0000000" value={tid} onChange={(e) => setTid(e.target.value)} /></label>
              <p className="my-ls">{t('taxIdNotice')}</p>
              <div className="my-btns"><button type="submit" className="my-bp" disabled={pending || tid.replace(/\D/g, '').length !== 13}>{t('taxIdSave')}</button></div>
            </form>
          )}
        </div>
      )}
      {c.blocker && <p className="my-ls" data-cashout-why="">{t(`why.${c.blocker}`)}</p>}
      {!c.blocker && (
        <form onSubmit={send} className="p2form" data-cashout-form="">
          <label className="fld"><span>{t('points')}</span>
            <input type="number" min={c.min} max={c.cashable} step={1} value={pts} onChange={(e) => setPts(e.target.value)} data-cashout-points="" /></label>
          <label className="fld"><span>{t('account')}</span>
            <select value={acc} onChange={(e) => setAcc(e.target.value)} data-cashout-account="">
              {c.accounts.map((a) => <option key={a.id} value={a.id}>{a.bankName} ****{a.last4 ?? ''} ({a.holderName})</option>)}
            </select></label>
          <p className="my-ls" data-cashout-preview={`${tax}|${n - tax}`}>{t('preview', { tax: fmt(tax), net: fmt(Math.max(n - tax, 0)) })}</p>
          <div className="my-btns"><button type="submit" className="my-bp" disabled={pending || n < c.min || n > c.cashable || !acc} data-cashout-submit="">{t('submit')}</button></div>
        </form>
      )}
      {err && <div className="my-nt warn" role="alert" data-cashout-err="">{err}</div>}
      {info && <div className="my-nt ok" role="status" data-cashout-done="">{info}</div>}
      {c.requests.length > 0 && (
        <div className="my-tbl-w">
          <table className="my-tbl" data-cashout-list="">
            <thead><tr><th>{t('colDate')}</th><th>{t('colPoints')}</th><th>{t('colTax')}</th><th>{t('colNet')}</th><th>{t('colState')}</th><th /></tr></thead>
            <tbody>
              {c.requests.map((r) => (
                <tr key={r.id} data-cashout-row={r.status}>
                  <td className="my-ls">{ymdKst(r.requestedAt)}</td>
                  <td className="my-num">{fmt(r.points)}</td>
                  <td className="my-num">{fmt(r.withholding)}</td>
                  <td className="my-num">{fmt(r.netAmount)}</td>
                  <td><span className={`my-bg ${r.status === 'PAID' ? 'ok' : 'wait'}`}>{t(`st.${r.status}`)}</span>
                    {r.closedReason && <span className="my-ls"> · {r.closedReason}</span>}</td>
                  <td>{r.status === 'REQUESTED' && <button type="button" className="my-bo" disabled={pending} onClick={() => cancel(r.id)}>{t('cancel')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="my-ls">{t('note')}</p>
    </section>
  );
}
