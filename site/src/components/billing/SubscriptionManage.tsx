'use client';
import { ymdKst } from '@/lib/format';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
const won = (n?: number) => (n == null ? '—' : `${Number(n).toLocaleString('ko-KR')}원`);

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
        setMsg({ kind: 'err', text: j?.message ?? '처리하지 못했습니다. 잠시 후 다시 시도해 주십시오.' });
      } else if (path === 'refund') {
        /* 201 환불 완료 · 202 환불 결과 확인 중 — 서버가 준 말을 그대로 */
        setMsg({ kind: r.status === 201 ? 'ok' : 'err', text: `${j?.label ?? ''}${j?.note ? ` — ${j.note}` : ''}` });
      } else {
        setMsg({ kind: 'ok', text: j?.note ?? '처리했습니다.' });
      }
      router.refresh();
    } catch {
      setMsg({ kind: 'err', text: '연결하지 못했습니다. 잠시 후 다시 시도해 주십시오.' });
    } finally {
      setBusy(null);
    }
  }

  async function unreserve() {
    setBusy('unreserve'); setMsg(null);
    try {
      const r = await fetch('/api/v1/subscriptions/reservation', { method: 'DELETE' });
      const j = await r.json().catch(() => null);
      setMsg(r.ok ? { kind: 'ok', text: j?.note ?? '예약을 거두었습니다.' } : { kind: 'err', text: j?.message ?? '처리하지 못했습니다.' });
      router.refresh();
    } catch {
      setMsg({ kind: 'err', text: '연결하지 못했습니다. 잠시 후 다시 시도해 주십시오.' });
    } finally { setBusy(null); }
  }

  function askRefund() {
    if (!reason.trim()) { setMsg({ kind: 'err', text: '환불 사유를 적어 주십시오.' }); return; }
    void post('refund', 'refund', { reason: reason.trim() },
      '환불을 신청하시겠습니까?\n\n결제사에서 결제 취소가 확인되면 구독이 바로 끝납니다.');
  }

  return (
    <section className="card sub-manage" data-sub-manage>
      <h2>내 구독</h2>

      {detail.subscribed ? (
        <table className="tbl">
          <tbody>
            <tr><th>요금제</th><td>{detail.planName} <span className="dim">{paid ? `월 ${won(detail.monthlyPrice)}` : '무료'}</span></td></tr>
            <tr>
              <th>상태</th>
              <td data-sub-status={detail.status}>
                {detail.status === 'PAST_DUE' ? <strong className="warn-text">결제 실패</strong> : '이용 중'}
              </td>
            </tr>
            <tr><th>이용 기간</th><td>{day(detail.periodStart)} ~ {day(detail.periodEnd)}</td></tr>
            <tr>
              <th>자동 갱신</th>
              <td>{detail.autoRenew ? '자동 갱신' : `해지함 (${day(detail.cancelAt)})`}</td>
            </tr>
            <tr><th>다음 청구</th><td>{detail.nextChargeAt ? `${day(detail.nextChargeAt)}${detail.nextChargeAmount ? ` · ${won(detail.nextChargeAmount)}` : ''}` : '청구 예정 없음'}</td></tr>
            {detail.nextPlanCode ? (
              <tr data-sub-reserved={detail.nextPlanCode}>
                <th>요금제 예약</th>
                <td>
                  {day(detail.periodEnd)}부터 <b>{detail.nextPlanName}</b>{' '}
                  <span className="dim">{Number(detail.nextPlanPrice ?? 0) > 0 ? `월 ${won(detail.nextPlanPrice ?? 0)}` : '무료'}</span>{' '}
                  <button type="button" className="btn-sm" data-act="unreserve" disabled={!!busy} onClick={() => void unreserve()}>
                    {busy === 'unreserve' ? '처리 중…' : '예약 거두기'}
                  </button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : (
        <p className="dim">이용 중인 구독이 없습니다.</p>
      )}

      {detail.notice ? <div className="note warn" data-sub-notice>{detail.notice}</div> : null}

      {rf ? (
        <div className={`note ${rf.state === 'SUCCEEDED' ? 'info' : 'warn'}`} data-refund-state={rf.state}>
          <b>{rf.label}</b> <span className="dim">{won(rf.amount)} · 신청 {day(rf.requestedAt)}</span>
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
              {busy === 'refund-check' ? '확인 중…' : '환불 결과 다시 확인'}
            </button>
          ) : (
            <>
              {paid && detail.autoRenew ? (
                <button type="button" className="btn ghost" data-act="cancel" disabled={!!busy}
                  onClick={() => void post('cancel', 'cancel', { reason: '회원 해지' },
                    '자동 갱신을 해지하시겠습니까?\n\n이미 결제한 기간은 그대로 이용하실 수 있고, 이후로는 청구되지 않습니다.')}>
                  {busy === 'cancel' ? '처리 중…' : '자동 갱신 해지'}
                </button>
              ) : null}
              {detail.cancelAt && detail.status === 'ACTIVE' ? (
                <button type="button" className="btn ghost" data-act="resume" disabled={!!busy}
                  onClick={() => void post('resume', 'resume', {})}>
                  {busy === 'resume' ? '처리 중…' : '해지 철회'}
                </button>
              ) : null}
              {/* v10.31 (시안 「환불 사유 · 환불 신청」 — 유료 구독이면 늘 보임) — 조건이 안 되면 단추는 누를 수 없고 까닭을 바로 아래에 적습니다(판정은 서버) */}
              {paid ? (
                <>
                  <input className="inp" name="refundReason" maxLength={200} placeholder="환불 사유 (필수)"
                    value={reason} onChange={(e) => setReason(e.target.value)} aria-label="환불 사유" />
                  <button type="button" className="btn ghost" data-act="refund" disabled={!!busy || eligible?.eligible === false}
                    title={eligible?.eligible === false ? eligible.reason ?? '지금은 환불할 수 없습니다.' : ''} onClick={askRefund}>
                    {busy === 'refund' ? '결제사에 확인하는 중…' : '환불 신청'}
                  </button>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {detail.subscribed && paid && !refundOpen && eligible && !eligible.eligible && eligible.reason ? (
        <p className="hint" data-refund-why>환불: {eligible.reason}</p>
      ) : null}

      {msg ? <p className={msg.kind === 'ok' ? 'form-ok' : 'form-error'} data-sub-msg role="status">{msg.text}</p> : null}
    </section>
  );
}
