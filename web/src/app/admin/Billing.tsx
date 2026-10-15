import { useState } from 'react';
import { api, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';

interface Policy {
  key: string; stored: string; effective: number; meaning: string;
  pattern: string; example: string; description: string;
}
interface Overdue {
  id: string; accountId: string; planCode: string; status: string;
  periodEnd: string; attempt: number | null; failureReason: string | null;
  hasBillingKey: boolean;
}
interface Attempt {
  subscription_id: string; plan_code: string;
  tries: number; paid: number; retryable: number; terminal: number;
  last_attempt: string; last_detail: string | null; cap: number;
}
/** 확인이 필요한 것 — 결제사 결과가 확정되지 않은 청구 · 끝나지 않은 환불 · 끝나지 않은 요청 (v10.18 · D022) */
interface Review {
  pendingInvoices: Array<{ invoiceId: string; subscriptionId: string; amount: number; attempt: number;
    orderId: string | null; pgStatus: string | null; claimedAt: string | null; waitingMinutes: number | null }>;
  openRefunds: Array<{ refundId: string; subscriptionId: string; amount: number; state: string;
    pgStatus: string | null; attempts: number; requestedAt: string; waitingMinutes: number | null }>;
  openRequests: Array<{ route: string; state: string; attempts: number; startedAt: string;
    payRef: { paymentKey?: string; orderId?: string; amount?: number } | null; waitingMinutes: number | null }>;
  note: string;
}
const PG_NOTE: Record<string, string> = {
  AMOUNT_MISMATCH: '금액이 다르게 승인됨 — 자동으로 닫지 않습니다',
  PAID_NOT_APPLIED: '승인됐으나 기간에 반영 못 함',
  CANCELED: '결제사에서 취소된 결제', PARTIAL_CANCELED: '결제사에서 일부 취소된 결제',
  NOT_FOUND_YET: '결제사에 아직 없음(확인 중)', CANCELED_NOT_RECORDED: '결제사는 취소함 · 기록 대기',
  LOOKUP_FAILED: '결제사 조회 실패', NO_RESPONSE: '결제사 응답 없음',
};
const waited = (m: number | null) => (m == null ? '—' : m >= 1440 ? `${Math.floor(m / 1440)}일` : m >= 60 ? `${Math.floor(m / 60)}시간` : `${m}분`);

interface NoticeMissing {
  subscription_id: string; account_id: string; plan_code: string;
  due_at: string; last_failure: string | null;
}

/**
 * SB-ADM-BIL-010 청구 관리
 *
 * 구독료가 매출의 전부입니다. 이 화면이 곧 매출 감시입니다.
 *
 * 정책 값(유예 일수 · 재시도 횟수)은 코드가 아니라 설정에 있어
 * 여기서 바꾸면 배포 없이 즉시 반영됩니다.
 * 허용 범위와 설명은 API 가 함께 내려주므로 화면에서 따로 만들지 않습니다 —
 * 범위를 바꿀 때 두 곳을 고쳐야 하면 반드시 한쪽이 뒤처집니다.
 */
export function Billing() {
  const policy = useApi<Policy[]>('/admin/billing/policy');
  const overdue = useApi<Overdue[]>('/admin/billing/overdue');
  const attempts = useApi<Attempt[]>('/admin/billing/attempts-today');
  const missing = useApi<NoticeMissing[]>('/admin/billing/notice-missing');
  const review = useApi<Review>('/admin/billing/review');

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save(key: string) {
    const value = draft[key];
    /* v10.31 (10/10 결함) — 빈 칸으로 「저장」을 누르면 아무 말 없이 무시돼 저장된 줄 알았습니다. 안내합니다 */
    if (value === undefined || value.trim() === '') {
      setMsg(null);
      setErr(`${key} — 바꿀 값을 칸에 적은 뒤 저장하십시오. 회색 글자는 지금 값을 보여 주는 예시일 뿐이라 저장되지 않았습니다.`);
      return;
    }
    setBusy(key); setErr(null); setMsg(null);
    try {
      const r = await api(`/admin/billing/policy/${key}`, {
        method: 'PATCH', body: JSON.stringify({ value }),
      });
      setMsg(`${key} → ${(r as any).effective}. ${(r as any).note}`);
      setDraft((d) => ({ ...d, [key]: '' }));
      policy.reload();
    } catch (e) {
      // DB 가 형식을 검사합니다. 그 메시지에 허용 범위가 들어 있으므로 그대로 보여 줍니다.
      setErr(e instanceof ApiFailure ? e.body.message : '변경하지 못했습니다.');
    } finally { setBusy(null); }
  }

  async function runCharge() {
    if (!confirm('지금 자동 청구를 실행합니다. 같은 기간을 두 번 청구하지는 않습니다.')) return;
    setBusy('run'); setErr(null); setMsg(null);
    try {
      const r: any = await api('/admin/billing/charge-due', { method: 'POST' });
      setMsg(`대상 ${r.total} · 성공 ${r.paid} · 실패 ${r.failed} · 수단없음 ${r.skipped}`
        + ` · 결과 확인 중 ${r.pending ?? 0}`
        + (r.recovered ? ` · 조회로 확인 ${r.recovered}` : '')
        + (r.refunds?.checked ? ` · 환불 대조 ${r.refunds.checked}(완료 ${r.refunds.succeeded})` : '')
        + (r.review ? ` · 사람 확인 필요 ${r.review}` : ''));
      overdue.reload(); attempts.reload(); missing.reload(); review.reload();
    } catch (e) {
      setErr(e instanceof ApiFailure ? e.body.message : '실행하지 못했습니다.');
    } finally { setBusy(null); }
  }

  /* v10.31 — 시안 「지금 대조」: 새 청구 없이 환불 · 불명확 청구만 결제사에 물어 닫습니다(시안의 「처음 상태로(시연)」는 시연용이라 두지 않음) */
  async function reconcile() {
    setBusy('rec'); setErr(null); setMsg(null);
    try {
      const r: any = await api('/admin/billing/reconcile', { method: 'POST' });
      setMsg(`대조 — 청구 결과 확인 ${r.recovered ?? 0} · 아직 불명확 ${r.pending ?? 0} · 환불 확인 ${r.refunds?.checked ?? 0}(완료 ${r.refunds?.succeeded ?? 0})${r.errors ? ` · 오류 ${r.errors}` : ''}`);
      review.reload(); overdue.reload();
    } catch (e) {
      setErr(e instanceof ApiFailure ? e.body.message : '대조하지 못했습니다.');
    } finally { setBusy(null); }
  }
  /* 허용 범위 — 서버 설명의 「(1~30)」을 그대로 씁니다 */
  const range = (desc: string) => /\((\d+\s*~\s*\d+)\)/.exec(desc)?.[1] ?? '—';

  if (policy.error) return <ErrorView error={policy.error} />;
  if (policy.loading || !policy.data) return <p className="muted">불러오는 중…</p>;

  const notice = missing.data ?? [];
  const past = overdue.data ?? [];
  const rv = review.data;
  const rvCount = rv ? rv.pendingInvoices.length + rv.openRefunds.length + rv.openRequests.length : 0;

  return (
    <>
      <div className="ad-dact end" style={{ marginTop: 0 }}>
        <span className="dim" style={{ marginRight: 'auto', fontSize: 13 }}>갱신일이 지난 구독을 2시간마다 자동 청구합니다 — 해지 예약된 구독은 청구하지 않습니다.</span>
        <button className="btn-ok" disabled={busy === 'run'} onClick={runCharge} data-charge-run>지금 청구 실행</button>
      </div>
      {msg && <p className="form-ok">{msg}</p>}
      {err && <p className="form-error">{err}</p>}

      {/* 안내가 나가지 않은 건이 가장 위험합니다.
          이용자가 모른 채 유예 기간이 지나가면 구독이 조용히 만료됩니다. */}
      {notice.length > 0 && (
        <div className="card warn">
          <h3 className="sec">안내 미도달 <em>{notice.length}</em></h3>
          <p className="dim">
            청구가 실패했는데 안내가 나가지 않았습니다. 이용자는 이 사실을 모릅니다 —
            유예 기간이 그냥 지나가면 구독이 만료됩니다.
          </p>
          <table className="tbl">
            <thead><tr><th>요금제</th><th>갱신일</th><th>마지막 실패</th></tr></thead>
            <tbody>
              {notice.map((n) => (
                <tr key={n.subscription_id}>
                  <td>{n.plan_code}</td>
                  <td>{new Date(n.due_at).toLocaleDateString('ko-KR')}</td>
                  <td className="dim">
                    {n.last_failure ? new Date(n.last_failure).toLocaleString('ko-KR') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 결제사의 실제 결과와 우리 기록이 아직 맞춰지지 않은 것. 비어 있어야 정상입니다.
          배치가 결제사에 조회해 닫으며, 금액 불일치처럼 자동으로 닫지 않는 것은 사람이 봐야 합니다. */}
      <div className={rvCount > 0 ? 'card warn' : 'card'} data-billing-review>
        <h3 className="sec">결제 · 환불 확인 필요 <em>{rvCount}</em></h3>
        {review.error ? <p className="form-error">확인 목록을 불러오지 못했습니다.</p> : null}
        <p className="dim">비어 있어야 정상입니다. 청구 · 환불은 배치가 결제사에 조회해 닫습니다 — 하루 넘게 남아 있으면 결제사 관리자 화면과 대조해 주십시오.</p>
        {rv && rvCount === 0 && <p className="muted">결과가 확정되지 않은 청구 · 환불 · 요청이 없습니다.</p>}
        {rv && rvCount > 0 && (
          <>
            <p className="dim">{rv.note}</p>
            <table className="tbl">
              <thead><tr><th>구분</th><th>상태</th><th>금액</th><th>기다린 시간</th><th>주문번호 · 결제 키</th></tr></thead>
              <tbody>
                {rv.pendingInvoices.map((i) => (
                  <tr key={i.invoiceId}>
                    <td>정기결제 청구 <span className="dim">({i.attempt}번째 시도)</span></td>
                    <td>{i.pgStatus && PG_NOTE[i.pgStatus]
                      ? <strong className="warn-text">{PG_NOTE[i.pgStatus]}</strong> : '결제사 결과 확인 중'}</td>
                    <td className="num-cell">{Number(i.amount).toLocaleString('ko-KR')}</td>
                    <td>{waited(i.waitingMinutes)}</td>
                    <td className="dim">{i.orderId ?? '—'}</td>
                  </tr>
                ))}
                {rv.openRefunds.map((r) => (
                  <tr key={r.refundId}>
                    <td>구독 환불 <span className="dim">({r.attempts}번째 시도)</span></td>
                    <td>{r.pgStatus && PG_NOTE[r.pgStatus] ? PG_NOTE[r.pgStatus] : '환불 결과 확인 중'}</td>
                    <td className="num-cell">{Number(r.amount).toLocaleString('ko-KR')}</td>
                    <td>{waited(r.waitingMinutes)}</td>
                    <td className="dim">{r.refundId.slice(0, 8)}</td>
                  </tr>
                ))}
                {rv.openRequests.map((q, n) => (
                  <tr key={`${q.route}-${q.startedAt}-${n}`}>
                    <td>요청 <span className="dim">{q.route}</span></td>
                    <td>{q.state === 'UNKNOWN'
                      ? <strong className="warn-text">결제 결과 불명확 — 같은 요청이 다시 오면 대조합니다</strong> : '처리 중'}</td>
                    <td className="num-cell">{q.payRef?.amount != null ? Number(q.payRef.amount).toLocaleString('ko-KR') : '—'}</td>
                    <td>{waited(q.waitingMinutes)}</td>
                    <td className="dim">{q.payRef?.orderId ?? q.payRef?.paymentKey ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <div className="acts" style={{ marginTop: 8 }}>
          <button className="btn-plain btn-sm" disabled={busy === 'rec'} onClick={reconcile} data-reconcile>지금 대조</button>
        </div>
      </div>

      <h3 className="sec">청구 정책</h3>
      <p className="dim">
        코드가 아니라 설정에 있습니다. 바꾸면 배포 없이 즉시 반영됩니다.
        저장된 값과 실제 동작 값이 다르면 설정이 먹지 않은 것입니다.
      </p>
      <table className="tbl">
        <thead>
          <tr><th>항목</th><th>현재</th><th>동작</th><th>허용</th><th>변경</th><th>설명</th></tr>
        </thead>
        <tbody>
          {policy.data.map((p) => (
            <tr key={p.key}>
              <td>{p.meaning}</td>
              <td className="num-cell">{p.stored}</td>
              <td className="num-cell">
                {/* 둘이 다르면 설정이 반영되지 않은 것입니다. 숨기지 않고 표시합니다. */}
                {String(p.effective) === p.stored
                  ? p.effective
                  : <strong className="warn-text">{p.effective}</strong>}
              </td>
              <td className="num-cell">{range(p.description)}</td>
              <td>
                <input
                  className="inp-sm"
                  value={draft[p.key] ?? ''}
                  placeholder={p.example}
                  onChange={(e) => setDraft((d) => ({ ...d, [p.key]: e.target.value }))}
                />
                <button className="btn-sm" disabled={busy === p.key}
                        onClick={() => save(p.key)}>저장</button>
              </td>
              <td className="dim">{p.description}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="sec">
        청구 실패 <em>{past.length}</em>
      </h3>
      {past.length === 0 && <p className="muted">밀린 청구가 없습니다.</p>}
      {past.length > 0 && (
        <table className="tbl">
          <thead>
            <tr><th>요금제</th><th>갱신일</th><th>시도</th><th>사유</th><th>결제수단</th></tr>
          </thead>
          <tbody>
            {past.map((o) => (
              <tr key={o.id}>
                <td>{o.planCode}</td>
                <td>{new Date(o.periodEnd).toLocaleDateString('ko-KR')}</td>
                <td className="num-cell">{o.attempt ?? '—'}</td>
                <td className="dim">{o.failureReason ?? '—'}</td>
                <td>
                  {o.hasBillingKey
                    ? '등록됨'
                    : <strong className="warn-text">없음 — 청구 불가</strong>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="sec">오늘 시도 <em>{(attempts.data ?? []).length}</em></h3>
      <p className="dim">
        한도에 걸려 밀린 건이 보입니다. 카드 만료처럼 재시도해도 결과가 같은 실패는
        하루 1회로 줄어듭니다 — 같은 카드에 승인 요청을 반복하면 카드사 이상거래 탐지에 걸립니다.
      </p>
      {(attempts.data ?? []).length === 0 && <p className="muted">오늘 시도한 건이 없습니다.</p>}
      {(attempts.data ?? []).length > 0 && (
        <table className="tbl">
          <thead>
            <tr><th>요금제</th><th>시도</th><th>성공</th><th>재시도</th><th>카드교체</th><th>마지막 사유</th></tr>
          </thead>
          <tbody>
            {(attempts.data ?? []).map((a) => (
              <tr key={a.subscription_id}>
                <td>{a.plan_code}</td>
                <td className="num-cell">
                  {a.tries} / {a.cap}
                  {a.tries >= a.cap && <span className="dim"> (한도)</span>}
                </td>
                <td className="num-cell">{a.paid}</td>
                <td className="num-cell">{a.retryable}</td>
                <td className="num-cell">
                  {a.terminal > 0 ? <strong className="warn-text">{a.terminal}</strong> : 0}
                </td>
                <td className="dim">{a.last_detail ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
