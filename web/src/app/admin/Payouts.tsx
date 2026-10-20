import { useState } from 'react';
import { api, ApiFailure, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';
import { won } from '../../lib/format';

interface Row {
  kind: 'PARTNER' | 'HEALTH'; id: string; sub?: string; payee: string;
  from?: string; to?: string; amount: number; status?: string;
  ready?: boolean; blocker?: string | null; bankName?: string | null; last4?: string | null; holder?: string | null;
  paidAt?: string; ref?: string; paidBy?: string;
}
interface Desk {
  queue: Row[]; drafts: Row[]; paid: Row[];
  summary: { waiting: number; ready: number; readyAmount: number; drafts: number };
  note: string;
}
interface Recv {
  id: string; invoiceNo: string; advertiser: string; total: number; paid: number; unpaid: number;
  dueDate: string; overdueDays: number; status: string;
}

const KIND = { PARTNER: '제휴 수수료', HEALTH: '소개몰 판매자' } as const;
const d = (s?: string) => (s ? new Date(s).toLocaleDateString('ko-KR') : '—');

/**
 * SB-ADM-PAY-010 지급 데스크 (2026-10-01 결정 Q1)
 *
 * 확정은 운영(ADMIN · SUPER), 지급 기록은 지급 담당(PAYOUT)이 합니다.
 * 같은 사람이 둘 다 할 수 없습니다 — 서버와 DB 가 막고, 화면은 버튼을 역할에 맞게만 보여 줍니다.
 * 소개비는 여기 없습니다. 당사자끼리 직접 지급합니다(INV-11).
 */
export function Payouts() {
  const roles = tokenRoles();
  /* 2026-10-21 결정 — SUPER 는 확정 · 지급 · 입금 기록 단추를 모두 봅니다. 자기가 확정한 건의 지급은 서버 · DB 가 막습니다(2인 원칙) */
  const isSuper = roles.includes('SUPER');
  const isPayout = isSuper || roles.includes('PAYOUT');
  const canConfirm = isSuper || roles.includes('ADMIN');
  const desk = useApi<Desk>('/admin/payouts');
  const recv = useApi<Recv[]>('/admin/ad-receivables');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [inAmt, setInAmt] = useState<Record<string, string>>({});

  async function act(key: string, fn: () => Promise<{ note?: string }>, reload: () => void) {
    setBusy(key); setErr(null); setMsg(null);
    try { const r = await fn(); setMsg(r?.note ?? '처리했습니다.'); reload(); }
    catch (e) { setErr(e instanceof ApiFailure ? e.body.message : '처리하지 못했습니다.'); }
    finally { setBusy(null); }
  }
  const confirmRow = (r: Row) => act(r.id, () =>
    api(`/admin/payouts/${r.kind.toLowerCase()}/${r.id}/confirm`, { method: 'POST', body: '{}' }), desk.reload);
  const payRow = (r: Row) => {
    const ref = (refs[r.id] ?? '').trim();
    if (!ref) { setErr('이체 참조(은행 거래번호)를 적어 주십시오.'); return; }
    if (!confirm(`${r.payee} 에 ${won(r.amount)} 지급을 기록합니다.\n되돌릴 수 없습니다.`)) return;
    return act(r.id, () => api(`/admin/payouts/${r.kind.toLowerCase()}/${r.id}/pay`,
      { method: 'POST', body: JSON.stringify({ ref }) }), desk.reload);
  };
  const recordIn = (v: Recv) => {
    const amount = Number(inAmt[v.id] ?? v.unpaid);
    if (!amount || amount < 1) { setErr('입금액을 적어 주십시오.'); return; }
    return act(v.id, () => api(`/admin/ad-invoices/${v.id}/payments`,
      { method: 'POST', body: JSON.stringify({ amount, method: 'TRANSFER' }) }), recv.reload);
  };

  if (desk.error) return <ErrorView error={desk.error} onRetry={desk.reload} />;
  if (desk.loading || !desk.data) return <p className="muted">불러오는 중…</p>;
  const { queue, drafts, paid, summary, note } = desk.data;

  return (
    <>
      <p className="lead">{note} <strong>소개비는 여기 없습니다</strong> — 당사자끼리 직접 지급합니다.</p>
      <div className="kpis">
        <div className="kpi"><div className="k">지급 대기</div><div className="v">{summary.waiting}</div></div>
        <div className="kpi"><div className="k">바로 보낼 수 있음</div><div className="v">{summary.ready}</div>
          <div className="n">{won(summary.readyAmount)}</div></div>
        <div className="kpi"><div className="k">확정 전</div><div className="v">{summary.drafts}</div><div className="n">DRAFT</div></div>
        {/* v10.31 — 시안 넷째 칸 「광고비 미수금」 */}
        <div className="kpi"><div className="k">광고비 미수금</div><div className="v">{recv.data?.length ?? '—'}</div>
          <div className="n">{won((recv.data ?? []).reduce((a, v) => a + Number(v.unpaid || 0), 0))}</div></div>
      </div>
      {/* 시안의 「시연 — 지금 보는 사람(운영 · 지급 담당)」 전환 칩은 시연용입니다 — 실제 화면은 로그인한 계정의 역할로 단추가 갈립니다 */}
      <div className="ad-nt info">지금 보는 사람: <b>{isSuper ? '최고 관리자 (SUPER — 확정 · 지급 모두)' : roles.includes('PAYOUT') ? '지급 담당 (PAYOUT)' : '운영 (ADMIN)'}</b> — 단추는 역할에 맞는 것만 보입니다.</div>
      {err && <p className="form-error" role="alert">{err}</p>}
      {msg && <p className="notice">{msg}</p>}

      <h3 className="sec">지급 대기 (확정됨) <em>{queue.length}</em></h3>
      {queue.length === 0 && <p className="muted">확정된 지급이 없습니다.</p>}
      {queue.map((r) => (
        <div key={r.id} className="card row">
          <div className="row-main">
            <span className="money">{won(r.amount)}</span>
            <span className="dim"> {KIND[r.kind]} · {r.payee} · {d(r.from)} ~ {d(r.to)}</span>
            {r.bankName && <span className="dim"> · {r.bankName} ****{r.last4} ({r.holder})</span>}
            {!r.ready && <div className="form-error">지급 불가 — {r.blocker}</div>}
          </div>
          <div className="row-act">
            {isPayout ? (
              <>
                <input placeholder="이체 참조 (은행 거래번호)" value={refs[r.id] ?? ''}
                  onChange={(e) => setRefs({ ...refs, [r.id]: e.target.value })} disabled={!r.ready} />
                <button className="btn-ok" disabled={!r.ready || busy === r.id} onClick={() => void payRow(r)}>지급 기록</button>
              </>
            ) : <span className="dim">지급은 지급 담당이 합니다</span>}
          </div>
        </div>
      ))}

      <h3 className="sec">확정 전 (DRAFT) <em>{drafts.length}</em></h3>
      {drafts.length === 0 && <p className="muted">확정할 정산이 없습니다.</p>}
      {drafts.map((r) => (
        <div key={r.id} className="card row">
          <div className="row-main">
            <span className="money">{won(r.amount)}</span>
            <span className="dim"> {KIND[r.kind]} · {r.payee} · {d(r.from)} ~ {d(r.to)}</span>
          </div>
          <div className="row-act">
            {canConfirm
              ? <button className="btn-ok" disabled={busy === r.id} onClick={() => void confirmRow(r)}>확정</button>
              : <span className="dim">확정은 운영이 합니다</span>}
          </div>
        </div>
      ))}

      <h3 className="sec">광고비 미수금 <em>{recv.data?.length ?? 0}</em></h3>
      {recv.error ? <ErrorView error={recv.error} onRetry={recv.reload} /> : null}
      {recv.data && recv.data.length === 0 && <p className="muted">미수금이 없습니다.</p>}
      {recv.data?.map((v) => (
        <div key={v.id} className="card row">
          <div className="row-main">
            <span className="money">{won(v.unpaid)}</span>
            <span className="dim"> {v.invoiceNo} · {v.advertiser} · 기한 {d(v.dueDate)}
              {v.overdueDays > 0 ? ` · ${v.overdueDays}일 연체` : ''}</span>
          </div>
          <div className="row-act">
            {isPayout ? (
              <>
                <input type="number" placeholder={String(v.unpaid)} value={inAmt[v.id] ?? ''}
                  onChange={(e) => setInAmt({ ...inAmt, [v.id]: e.target.value })} />
                <button className="btn-ok" disabled={busy === v.id} onClick={() => void recordIn(v)}>입금 기록</button>
              </>
            ) : <span className="dim">입금 기록은 지급 담당이 합니다</span>}
          </div>
        </div>
      ))}

      <h3 className="sec">최근 지급 <em>{paid.length}</em></h3>
      <table className="tbl">
        <thead><tr><th>종류</th><th>받는 곳</th><th>금액</th><th>지급일</th><th>이체 참조</th><th>지급자</th></tr></thead>
        <tbody>
          {paid.map((r) => (
            <tr key={r.id}>
              <td>{KIND[r.kind]}</td><td>{r.payee}</td>
              <td className="num-cell money-cell">{won(r.amount)}</td>
              <td>{d(r.paidAt)}</td><td className="dim">{r.ref ?? '—'}</td><td className="dim">{r.paidBy ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ad-nt warn"><b>지급 기록은 되돌릴 수 없습니다.</b> 은행에서 실제로 보낸 뒤, 그 거래번호(이체 참조)를 적어 기록하십시오. 계좌 인증이 끝나지 않은 곳은 「지급 불가」로 잠깁니다.</div>
    </>
  );
}
