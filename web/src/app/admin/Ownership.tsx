import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymd } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { openFile, fmtSize, TYPE_LABEL } from '../../lib/files';

interface Item {
  id: string; listingId: string; title: string; docKey: string | null;
  docFileId: string | null; docFileType: string | null; docFileSize: number | string | null;
  issuedOn: string | null; hasEncumbrance: boolean; applicant: string;
  createdAt: string; docAgeDays: number;
}
interface Queue { items: Item[]; note: string | null }

/**
 * SB-ADM-OWN-010 소유 확인 대기
 *
 * 등기사항증명서를 직접 보고 판단합니다. **자동 승인 경로가 없습니다.**
 * 발급일이 30일을 넘으면 받지 않습니다 — 그 사이 소유권이 이전됐을 수 있습니다.
 * 근저당이 있어도 막지 않습니다. 소유자인 것은 맞기 때문입니다 — 다만 매물에 표시됩니다.
 *
 * D007 — 「문서 열기」가 GET /files/{id} 로 5분짜리 주소를 받아 새 창에 엽니다. 연 기록(FILE_OPEN)이 감사에 남습니다.
 *        파일 없이 이름만 낸 옛 제출은 「파일 없음」 — 승인하지 말고 다시 내라고 거절하십시오.
 */
export function Ownership() {
  const q = useApi<Queue>('/admin/ownership-queue');
  const a = useAct();

  function open(it: Item) {
    a.clear();
    void openFile(it.docFileId!).catch((e) => a.setErr(e instanceof Error ? e.message : '문서를 열지 못했습니다.'));
  }

  function decide(it: Item, ok: boolean) {
    const reason = ok ? undefined : prompt('거절 사유 — 안 적으면 같은 서류가 다시 올라옵니다') ?? '';
    if (!ok && (!reason || reason.trim().length < 2)) { a.setErr('거절하실 때는 사유를 두 자 이상 적으십시오.'); return; }
    if (ok && !it.docFileId && !confirm('올린 파일이 없는 제출입니다(이름만). 문서를 보지 않고 승인하시겠습니까?\n보통은 거절하고 파일을 다시 내게 합니다.')) return;
    if (ok && !confirm(`'${it.title}' 소유 확인을 승인합니다.\n등기부의 소유자 이름이 신청자(${it.applicant})와 같은지 직접 확인하셨습니까?`)) return;
    void a.run(it.id, () => api(`/admin/ownership/${it.id}/decide`, {
      method: 'POST', body: JSON.stringify({ state: ok ? 'VERIFIED' : 'REJECTED', reason: reason?.trim() }),
    }), q.reload, ok ? '확인했습니다. 신청자가 매물을 공개할 수 있습니다.' : '거절했습니다. 사유가 신청자에게 갑니다.');
  }

  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const rows = q.data.items;

  return (
    <section>
      <h2>확인 대기 <em>{rows.length}</em></h2>
      <p className="lead">{q.data.note ?? '등기사항증명서를 직접 보고 판단하십시오.'}</p>
      <p className="card warn">
        <b>자동 승인이 없습니다.</b> 「문서 열기」로 등기사항증명서를 열어 소유자 이름이 신청자와 같은지 직접 확인하십시오.
        <b> 발급일이 30일을 넘으면 받지 않습니다</b> — 그 사이 소유권이 이전됐을 수 있습니다.
      </p>
      <Flash msg={a.msg} err={a.err} />
      {rows.length === 0 && <p className="muted">확인을 기다리는 서류가 없습니다.</p>}
      {rows.length > 0 && (
        <table className="tbl">
          <thead><tr><th>매물</th><th>신청자</th><th>서류</th><th>발급일</th><th>경과</th><th>근저당</th><th>처리</th></tr></thead>
          <tbody>
            {rows.map((it) => {
              const stale = it.docAgeDays > 30;
              return (
                <tr key={it.id}>
                  <td><b>{it.title}</b></td>
                  <td>{it.applicant}</td>
                  <td>
                    {it.docFileId
                      ? <><button className="btn-sm" onClick={() => open(it)} data-file-id={it.docFileId}>문서 열기</button>
                          <div className="dim mono">{it.docKey} · {TYPE_LABEL[it.docFileType ?? ''] ?? ''} {fmtSize(it.docFileSize)}</div></>
                      : <><span className="st no">파일 없음</span> <span className="mono dim">{it.docKey ?? '—'}</span></>}
                  </td>
                  <td className="muted">{ymd(it.issuedOn)}</td>
                  <td className="num-cell">{stale ? <b className="warn-text">{it.docAgeDays}일</b> : `${it.docAgeDays}일`}</td>
                  <td>{it.hasEncumbrance ? <span className="badge badge-urgent">있음</span> : <span className="dim">없음</span>}</td>
                  <td>
                    {stale
                      ? <><span className="st no">발급 30일 초과</span>{' '}
                          <button className="btn-no" disabled={a.busy === it.id} onClick={() => decide(it, false)}>거절</button></>
                      : <>
                          <button className="btn-sm" disabled={a.busy === it.id} onClick={() => decide(it, true)}>승인</button>{' '}
                          <button className="btn-no" disabled={a.busy === it.id} onClick={() => decide(it, false)}>거절</button>
                        </>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="card">
        <b>근저당이 있어도 막지 않습니다.</b> 소유자인 것은 맞기 때문입니다. 다만 <b>매수인이 알아야 할 사실</b>이라 매물에 표시됩니다.
      </p>
      <div className="ad-nt warn"><b>거절하실 때는 사유를 적으십시오.</b> 안 적으면 같은 서류가 다시 올라옵니다.</div>
    </section>
  );
}
