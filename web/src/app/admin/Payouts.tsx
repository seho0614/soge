import { useState } from 'react';
import { api, ApiFailure, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';
import { won } from '../../lib/format';

interface Row {
  kind: 'PARTNER' | 'HEALTH' | 'POINT'; id: string; sub?: string; payee: string;
  from?: string; to?: string; amount: number; status?: string;
  ready?: boolean; blocker?: string | null; bankName?: string | null; last4?: string | null; holder?: string | null;
  paidAt?: string; ref?: string; paidBy?: string;
}
interface Desk {
  queue: Row[]; drafts: Row[]; paid: Row[];
  pointSetting: { min: number; taxRate: string | null; taxIdOn: boolean };
  summary: { waiting: number; ready: number; readyAmount: number; drafts: number };
  note: string;
}
interface Recv {
  id: string; invoiceNo: string; advertiser: string; total: number; paid: number; unpaid: number;
  dueDate: string; overdueDays: number; status: string;
}

const KIND = { PARTNER: '제휴 수수료', HEALTH: '소개몰 판매자', POINT: '포인트 출금' } as const;
const d = (s?: string) => (s ? new Date(s).toLocaleDateString('ko-KR') : '—');

/**
 * SB-ADM-PAY-010 지급 데스크 (2026-10-01 결정 Q1)
 *
 * 확정은 운영(ADMIN · SUPER), 지급 기록은 지급 담당(PAYOUT)이 합니다.
 * 같은 사람이 둘 다 할 수 없습니다 — 서버와 DB 가 막고, 화면은 버튼을 역할에 맞게만 보여 줍니다.
 * 소개비는 여기 없습니다. 당사자끼리 직접 지급합니다(INV-11).
 * v10.219 (D190 · docs/352) — 회원 포인트 출금(POINT): 회원 신청 → 확정(ADMIN) 또는 반려(사유) → 지급(PAYOUT · 다른 사람).
 *   출금 기준(최소 금액 · 원천징수율 — 비어 있으면 신청을 받지 않음)은 맨 위 칸 · 바꾸기는 SUPER(운영 설정 point.cashout_*).
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
  const [why, setWhy] = useState<Record<string, string>>({});
  const [ps, setPs] = useState<{ min: string; rate: string; reason: string } | null>(null);
  const [month, setMonth] = useState(() => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7));

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
  const rejectRow = (r: Row) => {
    const reason = (why[r.id] ?? '').trim();
    if (reason.length < 2) { setErr('반려 사유를 2자 이상 적어 주십시오.'); return; }
    return act(r.id, () => api(`/admin/payouts/point/${r.id}/reject`,
      { method: 'POST', body: JSON.stringify({ reason }) }), desk.reload);
  };
  const savePoint = () => {
    if (!ps || !desk.data) return;
    const cur = desk.data.pointSetting;
    const reason = ps.reason.trim() || undefined;
    return act('pset', async () => {
      if (ps.min.trim() !== String(cur.min)) await api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'point.cashout_min', value: ps.min.trim(), reason }) });
      if (ps.rate.trim() !== (cur.taxRate ?? '')) await api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'point.cashout_tax_rate', value: ps.rate.trim(), reason }) });
      setPs(null);
      return { note: '포인트 출금 기준을 저장했습니다. 이미 들어온 신청은 신청 때 원천징수율 그대로입니다.' };
    }, desk.reload);
  };
  /* 신고 자료 — 주민등록번호 원문이 들어 있는 파일이라 지급 담당 · SUPER 만(서버도 막음) · 받은 기록은 개인정보 접속기록에 남음 */
  const download = () => act('report', async () => {
    const r = await api<{ csv: string; filename: string; note: string }>(`/admin/payouts/point-report?month=${encodeURIComponent(month)}`);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }));
    a.download = r.filename; a.click(); URL.revokeObjectURL(a.href);
    return { note: r.note };
  }, () => undefined);
  const toggleTaxId = (on: boolean) => act('taxid', () => api('/admin/site-settings', {
    method: 'PATCH', body: JSON.stringify({ key: 'point.cashout_tax_id', value: on ? 'on' : 'off', reason: on ? '처리방침 게시 확인 — 주민등록번호 받기 켬' : '주민등록번호 받기 끔' }),
  }).then(() => ({ note: on ? '주민등록번호 받기를 켰습니다 — 등록하지 않은 회원은 출금 신청을 못 합니다.' : '주민등록번호 받기를 껐습니다.' })), desk.reload);
  const recordIn = (v: Recv) => {
    const amount = Number(inAmt[v.id] ?? v.unpaid);
    if (!amount || amount < 1) { setErr('입금액을 적어 주십시오.'); return; }
    return act(v.id, () => api(`/admin/ad-invoices/${v.id}/payments`,
      { method: 'POST', body: JSON.stringify({ amount, method: 'TRANSFER' }) }), recv.reload);
  };

  if (desk.error) return <ErrorView error={desk.error} onRetry={desk.reload} />;
  if (desk.loading || !desk.data) return <p className="muted">불러오는 중…</p>;
  const { queue, drafts, paid, summary, note, pointSetting } = desk.data;
  const period = (r: Row) => (r.kind === 'POINT' ? `신청 ${d(r.from)}` : `${d(r.from)} ~ ${d(r.to)}`);

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

      <div className="card pad" data-point-setting={pointSetting.taxRate ?? ''}>
        <b>포인트 출금 기준</b> 최소 {won(pointSetting.min)} · 원천징수율 {pointSetting.taxRate == null
          ? <span className="st warn">비어 있음 — 출금 신청을 받지 않음</span> : <b>{pointSetting.taxRate}%</b>}
        <div className="hint">원천징수 = 소득세(10원 미만 버림) + 지방소득세(소득세의 10% · 10원 미만 버림). 신청할 때의 비율이 그 신청에 남습니다.</div>
        <div data-point-taxid={pointSetting.taxIdOn ? 'on' : 'off'}>주민등록번호 받기 {pointSetting.taxIdOn ? <span className="st ok">켜짐</span> : <span className="st">꺼짐</span>}
          <span className="hint"> — 처리방침에 「주민등록번호(암호화)」 수집 줄이 게시돼야 켤 수 있습니다. 켜면 등록하지 않은 회원은 출금 신청을 못 합니다.</span>
          {isSuper && <> <button className="btn-sm" disabled={busy === 'taxid'} onClick={() => void toggleTaxId(!pointSetting.taxIdOn)}>{pointSetting.taxIdOn ? '끄기' : '켜기'} (SUPER)</button></>}
        </div>
        {isPayout && (
          <div className="search-row" data-point-report="">
            <b>신고 자료 내려받기</b> <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="신고 달" />
            <button className="btn-plain" disabled={busy === 'report' || !/^\d{4}-\d{2}$/.test(month)} onClick={() => void download()}>CSV 내려받기</button>
            <span className="hint">그달 지급된 포인트 출금 · 소득세 · 지방소득세 · 주민등록번호 — 개인정보가 들어 있어 받은 기록이 남습니다.</span>
          </div>
        )}
        {isSuper && !ps && <button className="btn-sm" onClick={() => setPs({ min: String(pointSetting.min), rate: pointSetting.taxRate ?? '', reason: '' })}>바꾸기 (SUPER)</button>}
        {isSuper && ps && (
          <div className="form-grid" style={{ marginTop: 8 }}>
            <label><span>최소 출금(원)</span><input type="number" min={1000} value={ps.min} onChange={(e) => setPs({ ...ps, min: e.target.value })} /></label>
            <label><span>원천징수율(% · 0 ~ 50)</span><input value={ps.rate} placeholder="예: 8.8" onChange={(e) => setPs({ ...ps, rate: e.target.value })} /></label>
            <label><span>사유(운영 알림에 남음)</span><input value={ps.reason} maxLength={300} onChange={(e) => setPs({ ...ps, reason: e.target.value })} /></label>
            <div className="acts"><button className="btn-ok" disabled={busy === 'pset'} onClick={() => void savePoint()}>저장</button> <button className="btn-plain" onClick={() => setPs(null)}>그만두기</button></div>
          </div>
        )}
      </div>

      <h3 className="sec">지급 대기 (확정됨) <em>{queue.length}</em></h3>
      {queue.length === 0 && <p className="muted">확정된 지급이 없습니다.</p>}
      {queue.map((r) => (
        <div key={r.id} className="card row">
          <div className="row-main">
            <span className="money">{won(r.amount)}</span>
            <span className="dim"> {KIND[r.kind]} · {r.payee} · {period(r)}</span>
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
            {r.kind === 'POINT' && (isPayout || canConfirm) && <RejectBox r={r} why={why} setWhy={setWhy} busy={busy} onReject={rejectRow} />}
          </div>
        </div>
      ))}

      <h3 className="sec">확정 전 (DRAFT · 포인트 출금 신청) <em>{drafts.length}</em></h3>
      {drafts.length === 0 && <p className="muted">확정할 정산이 없습니다.</p>}
      {drafts.map((r) => (
        <div key={r.id} className="card row">
          <div className="row-main">
            <span className="money">{won(r.amount)}</span>
            <span className="dim"> {KIND[r.kind]} · {r.payee} · {period(r)}</span>
          </div>
          <div className="row-act">
            {canConfirm
              ? <button className="btn-ok" disabled={busy === r.id} onClick={() => void confirmRow(r)}>확정</button>
              : <span className="dim">확정은 운영이 합니다</span>}
            {r.kind === 'POINT' && canConfirm && <RejectBox r={r} why={why} setWhy={setWhy} busy={busy} onReject={rejectRow} />}
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

/** 포인트 출금 반려 — 사유 필수 · 포인트는 회원의 출금 가능 잔액으로 돌아감 */
function RejectBox({ r, why, setWhy, busy, onReject }: {
  r: Row; why: Record<string, string>; setWhy: (v: Record<string, string>) => void; busy: string | null; onReject: (r: Row) => void;
}) {
  return (
    <span data-point-reject={r.id}>
      <input placeholder="반려 사유" value={why[r.id] ?? ''} maxLength={300} onChange={(e) => setWhy({ ...why, [r.id]: e.target.value })} />
      <button className="btn-plain" disabled={busy === r.id} onClick={() => onReject(r)}>반려</button>
    </span>
  );
}
