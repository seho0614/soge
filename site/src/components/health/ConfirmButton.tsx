'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ymdKst } from '@/lib/format';

/**
 * v10.28 (D035) 구매확정 — 배송 완료 주문. 누르지 않아도 배송 완료 7일(청약철회 기간이 더 길면 그 기간) 뒤 자동으로 확정됩니다.
 * 확정 뒤에도 상품 하자 · 표시와 다름 · 오배송은 받으신 날부터 3개월 안에 신청하실 수 있습니다(전자상거래법 17조).
 */
export function ConfirmButton({ no, due }: { no: string; due: string | null }) {
  const t = useTranslations('order');
  const router = useRouter();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dk = due ? ymdKst(due) : '';      /* G-201 규칙 — 서버 · 브라우저가 같은 글자(toLocale… 쓰지 않음) */
  const dueText = dk ? t('confirm.due', { m: String(Number(dk.slice(5, 7))), d: String(Number(dk.slice(8, 10))) }) : null;

  async function go() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/v1/me/health/orders/${encodeURIComponent(no)}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setErr(d?.message ?? t('confirm.fail')); return; }
      setAsk(false); router.refresh();
    } finally { setBusy(false); }
  }

  if (!ask) return <button type="button" className="hlt-btn sm pri" onClick={() => setAsk(true)} data-confirm={no}
    title={dueText ? t('confirm.autoTitle', { due: dueText }) : undefined}>{t('confirm.btn')}</button>;
  return (
    <span className="confirm-inline" role="group" aria-label={t('confirm.aria')} data-confirm-ask={no}>
      <span>{t('confirm.ask')}{dueText ? t('confirm.askAuto', { due: dueText }) : ''}</span>
      <button type="button" className="hlt-btn sm pri" disabled={busy} onClick={go} data-confirm-yes>{busy ? t('confirm.confirming') : t('confirm.btn')}</button>
      <button type="button" className="hlt-btn sm" disabled={busy} onClick={() => setAsk(false)}>{t('confirm.cancel')}</button>
      {err && <span className="warn-text" role="alert">{err}</span>}
    </span>
  );
}
