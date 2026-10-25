'use client';
import { ymdKst } from '@/lib/format';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useFmt } from '@/lib/useFmt';

/** GET /me/subscription/detail */
export interface SubDetail {
  subscribed: boolean;
  planName?: string; monthlyPrice?: number; status?: 'ACTIVE' | 'PAST_DUE';
  periodStart?: string; periodEnd?: string; cancelAt?: string | null;
  autoRenew?: boolean; nextChargeAt?: string | null; chargeInFlight?: boolean;
  /* v10.27 (G-189) — 요금제 예약(다음 결제일부터) */
  planCode?: string; isPromo?: boolean; hasBillingKey?: boolean;
  nextPlanCode?: string | null; nextPlanName?: string | null; nextPlanPrice?: number | null; nextChargeAmount?: number | null;
  notice?: string | null;
  refund?: RefundView;
}
export interface RefundView {
  refundId: string; state: 'REQUESTED' | 'PROCESSING' | 'UNKNOWN' | 'SUCCEEDED' | 'FAILED';
  label: string; amount: number; requestedAt: string; refundedAt?: string | null;
  failureReason?: string | null; stub?: boolean; note: string;
}
/** GET /me/subscription/refund-eligible */
export interface RefundEligible { eligible: boolean; reason?: string }

const day = (v?: string | null) => (v ? ymdKst(v) : '—');

/**
 * SB-MYP-SUB-010 「내 구독」 — 자동 갱신 해지 · 해지 철회 · 환불 (v10.18 · D022)
 *
 * 화면은 **서버가 준 상태를 그대로** 보여 줍니다. 환불은 세 가지 말만 씁니다.
 *   환불 완료            결제사가 결제 취소를 확인한 뒤
 *   환불 결과 확인 중    결제사 답을 받지 못했을 때 — 다시 신청하지 않고 「다시 확인」만 누를 수 있습니다
 *   환불 실패            결제사가 거절 — 구독과 결제는 그대로
 * 「접수되었습니다」처럼 끝났는지 알 수 없는 말을 쓰지 않습니다.
 */
export function SubscriptionManage({ detail, eligible }: { detail: SubDetail | null; eligible: RefundEligible | null }) {
  const router = useRouter();
  const t = useTranslations('billing.manage');
  const tc = useTranslations('billing.common');
  const fm = useFmt();
  const won = (n?: number) => fm.won(n, '—');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [reason, setReason] = useState('');

  if (!detail || (!detail.subscribed && !detail.refund)) return null;

  const rf = detail.refund;
  const refundOpen = !!rf && ['REQUESTED', 'PROCESSING', 'UNKNOWN'].includes(rf.state);
  const paid = Number(detail.monthlyPrice ?? 0) > 0;

  async function post(act: string, path: string, body: unknown, ask?: string) {
    if (ask && !confirm(ask)) return;
    setBusy(act); setMsg(null);
    try {
      const r = await fetch(`/api/v1/me/subscription/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg({ kind: 'err', text: j?.message ?? t('errGeneric') });
      } else if (path === 'refund') {
        /* 201 환불 완료 · 202 환불 결과 확인 중 — 서버가 준 말을 그대로 */
        setMsg({ kind: r.status === 201 ? 'ok' : 'err', text: `${j?.label ?? ''}${j?.note ? ` — ${j.note}` : ''}` });
      } else {
        setMsg({ kind: 'ok', text: j?.note ?? t('done') });
      }
      router.refresh();
    } catch {
      setMsg({ kind: 'err', text: tc('network') });
    } finally {
      setBusy(null);
    }
  }

  async function unreserve() {
    setBusy('unreserve'); setMsg(null);
    try {
      const r = await fetch('/api/v1/subscriptions/reservation', { method: 'DELETE' });
      const j = await r.json().catch(() => null);
      setMsg(r.ok ? { kind: 'ok', text: j?.note ?? t('unreserved') } : { kind: 'err', text: j?.message ?? t('failShort') });
      router.refresh();
    } catch {
      setMsg({ kind: 'err', text: tc('network') });
    } finally { setBusy(null); }
  }

  function askRefund() {
    if (!reason.trim()) { setMsg({ kind: 'err', text: t('needReason') }); return; }
    void post('refund', 'refund', { reason: reason.trim() },
      t('askRefund'));
  }

  return (
    <section className="card sub-manage" data-sub-manage>
      <h2>{t('title')}</h2>

      {detail.subscribed ? (
        <table className="tbl">
          <tbody>
            <tr><th>{t('thPlan')}</th><td>{detail.planName} <span className="dim">{paid ? tc('monthly', { price: won(detail.monthlyPrice) }) : tc('free')}</span></td></tr>
            <tr>
              <th>{t('thStatus')}</th>
              <td data-sub-status={detail.status}>
                {detail.status === 'PAST_DUE' ? <strong className="warn-text">{t('pastDue')}</strong> : t('active')}
              </td>
            </tr>
            <tr><th>{t('thPeriod')}</th><td>{day(detail.periodStart)} ~ {day(detail.periodEnd)}</td></tr>
            <tr>
              <th>{t('thRenew')}</th>
              <td>{detail.autoRenew ? t('renewOn') : t('canceled', { date: day(detail.cancelAt) })}</td>
            </tr>
            <tr><th>{t('thNext')}</th><td>{detail.nextChargeAt ? `${day(detail.nextChargeAt)}${detail.nextChargeAmount ? ` · ${won(detail.nextChargeAmount)}` : ''}` : t('noNext')}</td></tr>
            {detail.nextPlanCode ? (
              <tr data-sub-reserved={detail.nextPlanCode}>
                <th>{t('thReserved')}</th>
                <td>
                  {t('from', { date: day(detail.periodEnd) })}<b>{detail.nextPlanName}</b>{' '}
                  <span className="dim">{Number(detail.nextPlanPrice ?? 0) > 0 ? tc('monthly', { price: won(detail.nextPlanPrice ?? 0) }) : tc('free')}</span>{' '}
                  <button type="button" className="btn-sm" data-act="unreserve" disabled={!!busy} onClick={() => void unreserve()}>
                    {busy === 'unreserve' ? tc('processing') : t('unreserve')}
                  </button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : (
        <p className="dim">{t('none')}</p>
      )}

      {detail.notice ? <div className="note warn" data-sub-notice>{detail.notice}</div> : null}

      {rf ? (
        <div className={`note ${rf.state === 'SUCCEEDED' ? 'info' : 'warn'}`} data-refund-state={rf.state}>
          <b>{rf.label}</b> <span className="dim">{t('requested', { amount: won(rf.amount), date: day(rf.requestedAt) })}</span>
          {rf.state === 'FAILED' && rf.failureReason ? <> — {rf.failureReason}</> : null}
          <br />{rf.note}
        </div>
      ) : null}

      {detail.subscribed ? (
        <div className="invite-actions">
          {refundOpen ? (
            /* 확인 중에는 새 신청 · 해지를 받지 않습니다 — 같은 환불이 두 번 들어가지 않게 */
            <button type="button" className="btn-primary" data-act="refund-check" disabled={!!busy}
              onClick={() => void post('refund-check', 'refund', {})}>
              {busy === 'refund-check' ? t('checking') : t('refundCheck')}
            </button>
          ) : (
            <>
              {paid && detail.autoRenew ? (
                <button type="button" className="btn ghost" data-act="cancel" disabled={!!busy}
                  onClick={() => void post('cancel', 'cancel', { reason: '회원 해지' },
                    t('askCancel'))}>
                  {busy === 'cancel' ? tc('processing') : t('cancelBtn')}
                </button>
              ) : null}
              {detail.cancelAt && detail.status === 'ACTIVE' ? (
                <button type="button" className="btn ghost" data-act="resume" disabled={!!busy}
                  onClick={() => void post('resume', 'resume', {})}>
                  {busy === 'resume' ? tc('processing') : t('resume')}
                </button>
              ) : null}
              {/* v10.31 (시안 「환불 사유 · 환불 신청」 — 유료 구독이면 늘 보임) — 조건이 안 되면 단추는 누를 수 없고 까닭을 바로 아래에 적습니다(판정은 서버) */}
              {paid ? (
                <>
                  <input className="inp" name="refundReason" maxLength={200} placeholder={t('reasonPh')}
                    value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('reasonAria')} />
                  <button type="button" className="btn ghost" data-act="refund" disabled={!!busy || eligible?.eligible === false}
                    title={eligible?.eligible === false ? eligible.reason ?? t('cantRefund') : ''} onClick={askRefund}>
                    {busy === 'refund' ? t('refundBusy') : t('refundBtn')}
                  </button>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {detail.subscribed && paid && !refundOpen && eligible && !eligible.eligible && eligible.reason ? (
        <p className="hint" data-refund-why>{t('why', { reason: eligible.reason })}</p>
      ) : null}

      {msg ? <p className={msg.kind === 'ok' ? 'form-ok' : 'form-error'} data-sub-msg role="status">{msg.text}</p> : null}
    </section>
  );
}
