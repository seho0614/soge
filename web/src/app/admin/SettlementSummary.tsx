import { useApi } from '../../lib/useApi';
import { n, ymd } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';

/* ── v10.255 (docs/388) 회원 정산 내역 한눈에(운영 · ADMIN · SUPER · 읽기만) ─────────────
 *   GET /admin/accounts/{id}/settlement-summary — 소개비 정산 · 포인트(규칙별) · 출금 · 제휴 파트너 정산 · 소개몰 판매자 정산.
 *   **연 기록이 감사 로그에 남습니다**(ACCOUNT_SETTLEMENT_VIEW). 다른 회원(추천한 분 · 추천받은 분)의 금액은 없음. */
type Sum = { status: string; n: number; amount: number };
interface Summary {
  intro: { sums: Sum[]; paid: number; waiting: number; items: Array<{ id: string; dealId: string; amount: number; status: string; requestedAt: string; paidAt: string | null; held: boolean }> };
  points: { total: number; redeemable: number; byRule: Array<{ code: string; name: string | null; n: number; points: number }>;
    cashout: { paid: number; items: Array<{ id: string; points: number; netAmount: number; status: string; requestedAt: string; paidAt: string | null }> } };
  affiliate: { paid: number; items: Array<{ id: string; track: string; from: string; to: string; gross: number; withholding: number; net: number; state: string; paidAt: string | null }> } | null;
  seller: { paid: number; items: Array<{ id: string; seller: string; from: string; to: string; gross: number; commission: number; net: number; status: string; paidAt: string | null }> } | null;
  note: string;
}
const ST: Record<string, string> = { REQUESTED: '신청됨', PAID: '지급됨', HELD: '보류', REJECTED: '반려', CONFIRMED: '확정', CANCELED: '취소', DRAFT: '작성 중', CARRIED: '넘김' };
const won = (v: number) => `${n(v)}원`;
const d = (s: string | null) => (s ? ymd(s) : '—');

export function SettlementSummary({ id, name }: { id: string; name?: string }) {
  const q = useApi<Summary>(`/admin/accounts/${id}/settlement-summary`);
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  const s = q.data;
  if (!s) return <p className="muted">불러오는 중…</p>;
  return (
    <div className="card pad" data-settle-summary={id}>
      <h3 className="sec">{name ? `${name} — ` : ''}정산 내역 <small className="dim">연 기록이 감사 로그에 남습니다</small></h3>
      <p data-settle-totals={`${s.intro.paid}|${s.points.total}|${s.points.cashout.paid}`}>
        받은 소개비 <b>{won(s.intro.paid)}</b>(기다리는 것 {won(s.intro.waiting)}) · 포인트 <b>{n(s.points.total)}P</b>(현금화 가능 {n(s.points.redeemable)}P)
        · 포인트 출금 받은 돈 <b>{won(s.points.cashout.paid)}</b>
        {s.affiliate && <> · 제휴 정산 받은 돈 <b>{won(s.affiliate.paid)}</b></>}
        {s.seller && <> · 소개몰 판매 정산 받은 돈 <b>{won(s.seller.paid)}</b></>}
      </p>
      {s.intro.items.length > 0 && (
        <table className="tbl" data-settle-intro=""><thead><tr><th>거래</th><th>금액</th><th>상태</th><th>신청</th><th>지급</th></tr></thead>
          <tbody>{s.intro.items.map((x) => <tr key={x.id}><td className="mono">{x.dealId.slice(0, 8)}</td><td className="num-cell">{won(x.amount)}</td><td>{ST[x.status] ?? x.status}{x.held ? ' · 분쟁 보류' : ''}</td><td>{d(x.requestedAt)}</td><td>{d(x.paidAt)}</td></tr>)}</tbody></table>
      )}
      {s.points.byRule.length > 0 && (
        <table className="tbl" data-settle-points=""><thead><tr><th>포인트 받은 까닭</th><th>건수</th><th>포인트</th></tr></thead>
          <tbody>{s.points.byRule.map((r) => <tr key={r.code}><td>{r.name ?? r.code} <span className="mono dim">{r.code}</span></td><td className="num-cell">{n(r.n)}</td><td className="num-cell">{n(r.points)}P</td></tr>)}</tbody></table>
      )}
      {s.points.cashout.items.length > 0 && (
        <table className="tbl" data-settle-cashout=""><thead><tr><th>출금 신청</th><th>포인트</th><th>받는 돈</th><th>상태</th><th>지급</th></tr></thead>
          <tbody>{s.points.cashout.items.map((x) => <tr key={x.id}><td>{d(x.requestedAt)}</td><td className="num-cell">{n(x.points)}P</td><td className="num-cell">{won(x.netAmount)}</td><td>{ST[x.status] ?? x.status}</td><td>{d(x.paidAt)}</td></tr>)}</tbody></table>
      )}
      {s.affiliate && (
        <table className="tbl" data-settle-affiliate=""><thead><tr><th>제휴 정산 기간</th><th>구분</th><th>합계</th><th>원천징수</th><th>받는 돈</th><th>상태</th><th>지급</th></tr></thead>
          <tbody>{s.affiliate.items.map((x) => <tr key={x.id}><td>{x.from} ~ {x.to}</td><td>{x.track}</td><td className="num-cell">{won(x.gross)}</td><td className="num-cell">{won(x.withholding)}</td><td className="num-cell">{won(x.net)}</td><td>{ST[x.state] ?? x.state}</td><td>{d(x.paidAt)}</td></tr>)}</tbody></table>
      )}
      {s.seller && (
        <table className="tbl" data-settle-seller=""><thead><tr><th>판매자</th><th>기간</th><th>매출</th><th>수수료</th><th>받는 돈</th><th>상태</th><th>지급</th></tr></thead>
          <tbody>{s.seller.items.map((x) => <tr key={x.id}><td>{x.seller}</td><td>{x.from} ~ {x.to}</td><td className="num-cell">{won(x.gross)}</td><td className="num-cell">{won(x.commission)}</td><td className="num-cell">{won(x.net)}</td><td>{ST[x.status] ?? x.status}</td><td>{d(x.paidAt)}</td></tr>)}</tbody></table>
      )}
      {!s.intro.items.length && !s.points.byRule.length && !s.points.cashout.items.length && !s.affiliate && !s.seller && <p className="muted" data-settle-none="">정산 · 포인트 기록이 없습니다.</p>}
      <p className="hint">{s.note}</p>
    </div>
  );
}
