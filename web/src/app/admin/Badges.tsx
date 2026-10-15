import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ErrorView } from '../../components/ErrorView';
import { useApi } from '../../lib/useApi';

interface Issued { id: string; ownerName: string; badgeLabel: string; listingTitle: string; status: string; decidedAt: string; validUntil: string | null; rejectReasonCode: string | null }

interface Badge {
  id: string; badgeType: string; badgeLabel: string;
  listingId: string; listingTitle: string; ownerName: string;
  urgentReason: string | null; validUntil: string | null;
  evidence: unknown; requestedAt: string; reviewItemId: string;
}

/**
 * SB-ADM-BDG-010 배지 신청 검수.
 *
 * 배지는 전건 수동입니다 — 눈에 띄게 만드는 장치라 남용 유인이 큽니다.
 * 승인·반려는 검수 API 를 그대로 씁니다(같은 큐입니다).
 */
export function Badges() {
  const [rows, setRows] = useState<Badge[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api<Badge[]>('/admin/badges').then(setRows).catch(setErr);
  useEffect(() => { void load(); }, []);

  async function decide(b: Badge, decision: 'APPROVED' | 'REJECTED') {
    setBusy(b.id);
    try {
      await api(`/admin/reviews/${b.reviewItemId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          decision,
          ...(decision === 'REJECTED'
            ? { reasonCode: b.badgeType === 'URGENT' ? 'URGENT_NO_REASON' : 'BADGE_DOC_MISSING' }
            : {}),
        }),
      });
      await load();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  }

  /* v10.31 — 시안 「발급 이력」 · 노출 순위 경고 */
  const hist = useApi<Issued[]>('/admin/badges/history');
  if (err) return <ErrorView error={err} onRetry={() => { setErr(null); void load(); }} />;

  /* v10.29 — 시안(scAdmBdg)처럼 표로. 승인 · 반려는 그대로 검수 API */
  return (
    <section data-badges>
      <h2 className="sec-title">배지 신청 <span className="cnt">{rows.length}</span></h2>
      <div className="ad-nt info">
        <b>배지는 자동검수 대상이 아닙니다 — 전건 확인이 필요합니다.</b> 서류 확인 배지는 서류의 존재와 일치만 확인합니다. 거래의 안전을 보증하지 않습니다.
      </div>

      {rows.length === 0 ? (
        <p className="ad-empty">대기 중인 신청이 없습니다.</p>
      ) : (
        <table className="tbl">
          <thead><tr><th>배지</th><th>매물</th><th>사업자</th><th>사유 · 기한</th><th>신청</th><th /></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td><span className={`badge badge-${b.badgeType.toLowerCase()}`}>{b.badgeLabel}</span></td>
                <td><b>{b.listingTitle}</b></td>
                <td>{b.ownerName}</td>
                <td>
                  {b.urgentReason && <div>{b.urgentReason}</div>}
                  {b.validUntil && <div className="dim">기한 {new Date(b.validUntil).toLocaleDateString('ko-KR')} 까지</div>}
                  {!b.urgentReason && !b.validUntil && <span className="dim">—</span>}
                </td>
                <td className="dim">{new Date(b.requestedAt).toLocaleDateString('ko-KR')}</td>
                <td>
                  <div className="row-actions" style={{ marginTop: 0 }}>
                    <button className="btn-ok btn-sm" disabled={busy === b.id}
                            onClick={() => decide(b, 'APPROVED')}>승인</button>
                    <button className="btn-no btn-sm" disabled={busy === b.id}
                            onClick={() => decide(b, 'REJECTED')}>반려</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="ad-nt warn"><b>배지는 노출 순위에 영향을 줍니다.</b> 근거 없이 주면 이용자가 배지를 믿지 않게 되고, 그러면 배지 자체가 쓸모없어집니다.</div>

      <h2 className="ad-s2">발급 이력 <em>{(hist.data ?? []).length}</em></h2>
      <div className="ad-tw"><table className="tbl" data-badge-history>
        <thead><tr><th>사업자</th><th>배지</th><th>매물</th><th>결과</th><th>발급</th><th>만료</th></tr></thead>
        <tbody>
          {(hist.data ?? []).length === 0 && <tr><td colSpan={6} className="muted">처리한 배지가 없습니다.</td></tr>}
          {(hist.data ?? []).map((h) => (
            <tr key={h.id}><td>{h.ownerName}</td><td>{h.badgeLabel}</td><td>{h.listingTitle}</td>
              <td>{h.status === 'REJECTED' ? <span className="ad-bg no">반려</span> : h.status === 'EXPIRED' ? <span className="ad-bg">만료</span> : <span className="ad-bg ok">발급</span>}</td>
              <td>{new Date(h.decidedAt).toLocaleDateString('ko-KR')}</td><td>{h.validUntil ? new Date(h.validUntil).toLocaleDateString('ko-KR') : '—'}</td></tr>
          ))}
        </tbody>
      </table></div>
    </section>
  );
}
