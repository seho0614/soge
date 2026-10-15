import { useState } from 'react';
import { api, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ErrorView } from '../../components/ErrorView';
import { Pills } from '../../components/Pills';
import { label } from '../../lib/codes';
import { won } from '../../lib/format';

interface Settlement {
  id: string; dealId: string; amount: number; status: string;
  payeeName?: string; requestedAt: string;
  paidMarkedBy?: string | null; paidMarkedAt?: string | null;
  /* v10.31 — 시안 표 칸(서버 GET /admin/settlements) */
  no?: string; refCode?: string | null; dealAmount?: number | null; vat?: number | null;
  payoutAccount?: string | null; blockReason?: string | null; approvedAt?: string | null; approvedByName?: string | null;
  taxInvoiceIssuedAt?: string | null; taxInvoiceNo?: string | null;   // v10.31 (합침 · w3) — 세금계산서 발행 표시
}
type St = 'wait' | 'approved' | 'paid' | 'held' | 'rejected' | 'all';

/**
 * SB-ADM-STL-010 정산 승인
 *
 * v10.31 (10/10 시안 기준 지시 · 정책 변경) — 시안 「신청 → 승인 → 지급 실행」대로 「승인」을 다시 넣었습니다.
 *   전(v10.30): 플랫폼은 승인하지 않는다(INV-11) — 반려만.
 *   후(v10.31): 운영이 정산서(금액 = 약정 소개비 · 분쟁 없음 · 받을 계좌 확인)를 승인 → 당사자(지불 측)가 직접 지급하고 지급 표시.
 *   INV-11(자금 수탁 금지)의 보호는 그대로입니다 — 승인은 돈을 받거나 보내는 일이 아니고, 지급 표시는 여전히 당사자만,
 *   승인자는 운영(ADMIN · SUPER)이며 그 거래의 당사자는 승인할 수 없고(2인 원칙 · DB 트리거), 승인 기록은 지울 수 없습니다.
 *   분쟁 보류 · 받을 계좌 미확인 · 예금주 불일치 건은 「승인 불가」로 잠기고 사유가 보입니다.
 */
export function Settlements() {
  const { data, error, loading, reload } = useApi<Settlement[]>('/admin/settlements');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [st, setSt] = useState<St>('wait');
  const [why, setWhy] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);

  async function decide(s: Settlement, status: 'APPROVED' | 'REJECTED') {
    setBusy(s.id); setErr(null); setOk(null);
    try {
      await api(`/admin/settlements/${s.id}`, {
        method: 'PATCH', body: JSON.stringify(status === 'APPROVED' ? { status } : { status, rejectReason: why[s.id] }),
      });
      setOk(status === 'APPROVED'
        ? `${s.no ?? '정산'} 승인 — 소개비 ${won(s.amount)}. 지급은 당사자가 직접 하고 지급 표시도 당사자가 남깁니다.`
        : `${s.no ?? '정산'} 반려했습니다.`);
      setRejecting(null); reload();
    } catch (e) {
      setErr(e instanceof ApiFailure ? e.body.message : '처리하지 못했습니다.');
    } finally { setBusy(null); }
  }

  if (error) return <ErrorView error={error} />;
  if (loading || !data) return <p className="muted">불러오는 중…</p>;

  const by = (x: string) => data.filter((s) => s.status === x);
  const waiting = by('REQUESTED'), approved = by('APPROVED'), paid = by('PAID'), held = by('HELD'), rejected = by('REJECTED');
  const list = st === 'wait' ? waiting : st === 'approved' ? approved : st === 'paid' ? paid : st === 'held' ? held : st === 'rejected' ? rejected : data;
  const sum = list.reduce((a, s) => a + Number(s.amount || 0), 0);
  const ymd = (s?: string | null) => (s ? new Date(s).toLocaleDateString('ko-KR') : '—');

  return (
    <>
      <Pills label="정산 상태" value={st} onChange={setSt}
             items={[['wait', '승인 대기', waiting.length], ['approved', '승인됨 · 지급 대기', approved.length], ['paid', '지급 완료', paid.length],
                     ['held', '보류', held.length], ['rejected', '반려', rejected.length], ['all', '전체', data.length]]} />
      {err && <p className="form-error">{err}</p>}
      {ok && <p className="form-ok" role="status">{ok}</p>}

      <div className="ad-tw">
        <table className="tbl" data-settlements>
          <thead>
            <tr><th>정산번호</th><th>소개자</th><th>소개코드</th><th className="num-cell">거래금액</th><th className="num-cell">소개비</th>
                <th className="num-cell">부가세</th><th>입금 계좌</th><th /></tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={8} className="muted">{st === 'wait' ? '승인을 기다리는 정산이 없습니다.' : '해당하는 정산이 없습니다.'}</td></tr>}
            {list.map((s) => (
              <tr key={s.id} className={s.blockReason ? 'bad' : undefined} data-stl={s.id}>
                <td className="mono"><b>{s.no ?? s.id.slice(0, 8)}</b><span className="ad-ls">{label('settlement.status', s.status)} · {ymd(s.requestedAt)}</span></td>
                <td><b>{s.payeeName ?? '수취인'}</b></td>
                <td className="mono">{s.refCode ?? '—'}</td>
                <td className="num-cell">{s.dealAmount != null ? won(s.dealAmount) : <span className="dim">계약서에 없음</span>}</td>
                <td className="num-cell money-cell">{won(s.amount)}</td>
                <td className="num-cell">{s.vat != null ? won(s.vat) : <span className="dim">—</span>}</td>
                <td>
                  {s.payoutAccount ?? <span className="dim">{s.vat != null ? '당사자끼리 확인(사업자)' : '—'}</span>}
                  {s.blockReason && <span className="ad-ls" style={{ color: 'var(--danger)' }}>{s.blockReason}</span>}
                  {s.status === 'APPROVED' && <span className="ad-ls">승인 {ymd(s.approvedAt)} · {s.approvedByName ?? '운영'} — 당사자 지급 대기</span>}
                  {s.status === 'PAID' && <span className="ad-ls">당사자 지급 표시 {ymd(s.paidMarkedAt)}</span>}
                  {s.taxInvoiceIssuedAt && <span className="ad-ls" data-tax-invoice="">세금계산서 발행 표시 {ymd(s.taxInvoiceIssuedAt)}{s.taxInvoiceNo ? ` · ${s.taxInvoiceNo}` : ''}</span>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {s.status === 'REQUESTED' && (s.blockReason
                    ? <button className="btn-plain btn-sm" disabled title={s.blockReason}>승인 불가</button>
                    : <button className="btn-ok btn-sm" disabled={busy === s.id} onClick={() => decide(s, 'APPROVED')} data-stl-approve>승인</button>)}
                  {(s.status === 'REQUESTED' || s.status === 'APPROVED') && (
                    <button className="btn-no btn-sm" disabled={busy === s.id} style={{ marginLeft: 6 }}
                            onClick={() => setRejecting(rejecting === s.id ? null : s.id)}>반려</button>
                  )}
                  {rejecting === s.id && (
                    <span style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <input value={why[s.id] ?? ''} placeholder="반려 사유" aria-label="반려 사유"
                             onChange={(e) => setWhy((w) => ({ ...w, [s.id]: e.target.value }))} />
                      <button className="btn-no btn-sm" disabled={!(why[s.id] ?? '').trim() || busy === s.id} onClick={() => decide(s, 'REJECTED')}>반려하기</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {list.length > 0 && (
        <div className="ad-nt info" data-stl-sum><b>{list.length}건 · 소개비 합계 {won(sum)}</b> — 공제 없이 전액 지급됩니다 (INV-9).</div>
      )}
      <div className="ad-nt warn">
        <b>예금주명이 회원 이름과 다르면 승인이 막힙니다.</b> 받을 계좌 확인(1원 확인)이 끝나지 않은 건은 수동 검증 대기로 남습니다.
        분쟁이 접수된 거래는 정산이 보류되고 사유가 표시됩니다.
      </div>
      <div className="ad-nt info">
        <b>승인은 정산서 확인입니다 — 플랫폼이 돈을 받거나 보내지 않습니다 (INV-11).</b> 승인되면 지불 측이 소개자에게 직접 보내고 지급 표시를 남깁니다.
        승인한 사람 · 시각은 지울 수 없는 기록으로 남고, 그 거래의 당사자는 자기 정산을 승인할 수 없습니다.
      </div>
    </>
  );
}
