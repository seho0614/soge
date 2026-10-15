import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { won } from '../../lib/format';
import { ErrorView } from '../../components/ErrorView';
import { openFile } from '../../lib/files';

interface Dispute {
  id: string; dealId: string; reasonCode: string; description: string | null;
  status: string; statusLabel: string; raisedByName: string;
  heldAmount: number | null; openedAt: string;
  reasonLabel?: string; dealTitle?: string | null; gwanName?: string | null; refCode?: string | null;
  agreedFee?: number | null; dealStatusLabel?: string; ageDays?: number;
  /** v10.32 — 접수 때 붙인 증빙(시안 「증빙 붙이기」) */
  evidence?: { fileId: string; name: string }[];
  /** v10.32 — 신청한 쪽 · 종결 시각 · 처리 결과 · 72시간 넘김(GET /admin/disputes?state=all) */
  raisedSide?: 'BUYER' | 'SELLER' | 'INTRODUCER' | null; closedAt?: string | null; resolution?: string | null; over72h?: boolean;
}
/** v10.32 — GET /admin/disputes/summary (시안 숫자 4칸) */
interface Summary { open: number; closed: number; openedThisMonth: number; over72h: number }

const SIDE: Record<string, string> = { BUYER: '매수 측', SELLER: '매도 측', INTRODUCER: '소개자' };
const isClosed = (d: Dispute) => d.status === 'RESOLVED' || d.status === 'REJECTED';
/* 시안 tone: 종결 ok · 소명 대기 wait · 그 밖 off(회색) — 개발 상태로는 접수됨 = 기다림 · 검토 중 = 회색 · 처리 완료 · 기각 = 종결 */
const tone = (d: Dispute) => (isClosed(d) ? 'ok' : d.status === 'OPEN' ? 'wait' : '');
const mmdd = (iso: string) => { const t = new Date(iso); return `${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

/**
 * SB-ADM-DSP-010 분쟁 처리
 * v10.32 — 시안(scAdmDspt) 모양: 숫자 4칸(처리 중 · 종결 · 이번 달 접수 · 72시간 넘김 — 실제 행 수) → 노란 띠(플랫폼은 거래 당사자 아님)
 *   → 표(접수 번호 · 거래 · 신청 · 유형 · 상태 · 정산 · 접수 · 처리 — 흰 테두리 단추) → 처리 칸(고른 분쟁 · 없으면 파란 띠) → 파란 띠.
 *   개발에만 있는 것(관 · 소개코드 · 설명 · 증빙 N건 · 보류 정산 금액 · 처리 폼 · 증빙 단추)은 같은 칸 안 작은 줄 · 처리 칸에 둡니다.
 *   표에는 진행 중 + 최근 30일 종결(state=all)을 냅니다. 종결된 분쟁은 처리 칸에서 결과만 봅니다(고칠 수 없음).
 */
export function Disputes() {
  const [rows, setRows] = useState<Dispute[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => Promise.all([
    api<Dispute[]>('/admin/disputes?state=all').then(setRows),
    api<Summary>('/admin/disputes/summary').then(setSum),
  ]).catch(setErr);
  useEffect(() => { void load(); }, []);

  async function resolve(id: string, status: string, resolution: string) {
    setBusy(true);
    try {
      await api(`/admin/disputes/${id}`, {
        method: 'PATCH', body: JSON.stringify({ status, resolution }),
      });
      setOpen(null);
      await load();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  if (err) return <ErrorView error={err} onRetry={() => { setErr(null); void load(); }} />;

  const sel = rows.find((d) => d.id === open);
  const no = (d: Dispute) => `D-${d.dealId.slice(0, 6).toUpperCase()}`;
  const tiles: Array<[string, number | undefined]> = [
    ['처리 중', sum?.open], ['종결', sum?.closed], ['이번 달 접수', sum?.openedThisMonth], ['72시간 넘김', sum?.over72h],
  ];
  return (
    <section data-disputes>
      <div className="ad-tiles" data-dispute-tiles>
        {tiles.map(([k, v]) => (
          <div key={k} className="ad-tile"><span className="tl">{k}</span><b>{v ?? '—'}</b><span className="tu">건</span></div>
        ))}
      </div>
      <div className="ad-nt warn">
        <b>플랫폼은 거래 당사자가 아닙니다.</b> 누가 옳은지 판정하지 않고, 양측 소명을 받아 기록하고 조정안을 보냅니다.
        {(sum?.over72h ?? 0) > 0 && <> 접수 72시간이 넘은 분쟁 {sum!.over72h}건은 정산이 보류된 채로 남아 있습니다.</>}
      </div>
      <div className="ad-tw"><table className="tbl">
        <thead><tr><th>접수 번호</th><th>거래</th><th>신청</th><th>유형</th><th>상태</th><th>정산</th><th>접수</th><th>처리</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8} className="muted">진행 중인 분쟁이 없습니다.</td></tr>}
          {rows.map((d) => (
            <tr key={d.id} className={d.over72h ? 'hl' : undefined} data-dispute={d.id}>
              <td className="mono" style={{ whiteSpace: 'nowrap' }}><b>{no(d)}</b></td>
              <td style={{ minWidth: 220 }}>{d.dealTitle ?? '—'}
                {(d.gwanName || d.refCode) && <span className="ad-ls">{[d.gwanName, d.refCode && `소개코드 ${d.refCode}`].filter(Boolean).join(' · ')}</span>}
                {d.description && <span className="ad-ls">{d.description}</span>}
                {(d.evidence?.length ?? 0) > 0 && <span className="ad-ls" data-evidence-n={d.evidence!.length}>증빙 {d.evidence!.length}건</span>}</td>
              <td style={{ minWidth: 92 }}>{d.raisedSide ? `${SIDE[d.raisedSide]} (${d.raisedByName})` : d.raisedByName}</td>
              <td>{d.reasonLabel ?? d.reasonCode}</td>
              <td><span className={`ad-bg ${tone(d)}`}>{d.statusLabel}</span></td>
              <td>{isClosed(d) ? '정산 다시 열림' : '정산 멈춤'}
                {!isClosed(d) && (d.heldAmount != null
                  ? <span className="ad-ls">보류 {won(d.heldAmount)}</span>
                  : d.agreedFee != null && <span className="ad-ls">약정 {won(d.agreedFee)}</span>)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{mmdd(d.openedAt)}{!isClosed(d) && <span className="ad-ls">{d.ageDays ?? 0}일째</span>}</td>
              <td><button className="btn-sm" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? '보는 중' : '처리'}</button></td>
            </tr>
          ))}
        </tbody>
      </table></div>

      {sel ? (
        <div className="card pad" data-dispute-open={sel.id}>
          <h3 className="ad-s2" style={{ marginTop: 0 }}>{no(sel)} 처리</h3>
          <p className="ad-ls" style={{ margin: '0 0 10px' }}>
            {sel.dealTitle ?? '—'} · {sel.raisedSide ? `${SIDE[sel.raisedSide]} (${sel.raisedByName})` : sel.raisedByName} · {sel.reasonLabel ?? sel.reasonCode}
          </p>
          {(sel.evidence?.length ?? 0) > 0 && (
            <p style={{ margin: '0 0 8px', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }} data-evidence="">
              <b>증빙</b>
              {sel.evidence!.map((f) => (
                <button key={f.fileId} type="button" className="btn-plain btn-sm"
                  onClick={() => void openFile(f.fileId).catch((e) => setErr(e))}>{f.name}</button>
              ))}
            </p>
          )}
          {isClosed(sel) ? (
            <div className="ad-nt ok" style={{ marginBottom: 0 }}>
              <b>종결된 분쟁입니다.</b> 처리 기록은 고치거나 지울 수 없습니다.{sel.resolution && <> 처리 결과 — {sel.resolution}</>}
            </div>
          ) : (
            <form style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }} onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              void resolve(sel.id, String(fd.get('status')), String(fd.get('resolution')));
            }}>
              <select name="status" defaultValue="RESOLVED" aria-label="처리 상태">
                <option value="IN_REVIEW">검토 중으로</option>
                <option value="RESOLVED">처리 완료 — 보류 정산 풀림</option>
                <option value="REJECTED">기각 — 보류 정산 풀림</option>
              </select>
              <textarea name="resolution" rows={2} placeholder="처리 결과 (당사자에게 전달됩니다)" style={{ flex: 1, minWidth: 260 }} />
              <button className="btn-ok" disabled={busy}>저장</button>
              <button type="button" className="btn-plain" onClick={() => setOpen(null)}>취소</button>
            </form>
          )}
        </div>
      ) : (
        <div className="ad-nt info"><b>「처리」를 누르면</b> 그 분쟁의 검토 · 처리 완료 · 기각을 할 수 있습니다.</div>
      )}
      <div className="ad-nt info">
        <b>분쟁 중인 거래는 정산 승인이 막힙니다</b>(정산 승인 화면). 종결되면 다시 열립니다 — 풀린 정산은 「승인 대기」로 돌아가 운영 승인을 다시 거칩니다.
        처리할 때마다 감사 기록이 남습니다. 여기서 하는 일은 분쟁 개입이지 성사 확정이 아닙니다(INV-4).
      </div>
    </section>
  );
}
