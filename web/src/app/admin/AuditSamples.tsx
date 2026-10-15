import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { won } from '../../lib/format';
import { ErrorView } from '../../components/ErrorView';

interface Sample {
  id: string; targetId: string; title: string;
  desiredFee: number | null; decidedAt: string; pending: boolean; memo?: string | null;
}
interface Sum { autoApproved: number; sampled: number; mismatch: number; pending: number; ratePct: number | null }

/**
 * SB-ADM-REV-040 표본 감사.
 *
 * 자동 승인 건의 5% 입니다. 표본 감사 없이 자동화하면 오판을 영원히 모릅니다.
 * 부적정으로 기록하면 해당 매물의 노출이 중단됩니다.
 */
export function AuditSamples() {
  const [rows, setRows] = useState<Sample[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [sum, setSum] = useState<Sum | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => Promise.all([
    api<Sample[]>('/admin/auto-review/samples').then(setRows),
    api<Sum>('/admin/auto-review/samples/summary').then(setSum).catch(() => setSum(null)),
  ]).catch(setErr);
  async function resample() {
    setBusy('re'); setMsg(null);
    try { const r = await api<{ note: string }>('/admin/auto-review/samples/resample', { method: 'POST', body: '{}' }); setMsg(r.note); await load(); }
    catch (e) { setErr(e); } finally { setBusy(null); }
  }
  useEffect(() => { void load(); }, []);

  async function record(id: string, correct: boolean) {
    setBusy(id);
    try {
      const memo = correct ? undefined : prompt('부적정 사유를 적어 주세요') ?? '';
      await api(`/admin/auto-review/samples/${id}`, {
        method: 'POST', body: JSON.stringify({ correct, memo }),
      });
      await load();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  }

  if (err) return <ErrorView error={err} onRetry={() => { setErr(null); void load(); }} />;

  /* v10.31 — 시안(scAdmRev4): 「표본 다시 뽑기」 · 숫자 4칸(자동 승인 · 표본 · 불일치 · 표본율 — 최근 30일, 서버 요약) · 표(등록 · 자동 판정 · 재검 결과 · 일치) */
  const result = (s: Sample) => (s.pending ? '미검토' : s.memo?.startsWith('감사: 부적정') ? `반려 — ${s.memo.replace('감사: 부적정 — ', '') || '부적정'}` : '승인');
  return (
    <section data-audit-samples>
      <div className="ad-dact end" style={{ marginTop: 0 }}>
        <button className="btn-ok" disabled={busy === 're'} onClick={resample} data-resample>표본 다시 뽑기</button>
      </div>
      {msg && <p className="form-ok" role="status">{msg}</p>}
      <div className="ad-rw">
        <div className="ad-rc"><span>자동 승인</span><b>{sum ? `${sum.autoApproved}건` : '—'}</b><small>최근 30일</small></div>
        <div className="ad-rc"><span>표본</span><b>{sum ? `${sum.sampled}건` : `${rows.length}건`}</b><small>재검 대기 {sum?.pending ?? rows.filter((r) => r.pending).length}</small></div>
        <div className={`ad-rc${sum?.mismatch ? ' no' : ''}`}><span>불일치</span><b>{sum ? `${sum.mismatch}건` : '—'}</b><small>부적정으로 기록한 표본</small></div>
        <div className="ad-rc"><span>표본율</span><b>{sum?.ratePct != null ? `${sum.ratePct}%` : '—'}</b><small>자동검수 규칙에서 바꿉니다</small></div>
      </div>
      <div className="ad-nt info">
        <b>자동 승인이 많을수록 표본을 늘려야 합니다.</b> 통과율이 높다고 규칙이 맞는 것은 아닙니다 — 규칙이 느슨해도 통과율은 올라갑니다. 부적정으로 기록하면 그 매물의 노출이 중단됩니다.
      </div>

      <h2 className="ad-s2">표본 <em>{rows.length}</em></h2>
      {rows.length === 0 ? (
        <p className="ad-empty">감사 대상이 없습니다 — 「표본 다시 뽑기」로 최근 30일 자동 승인 건에서 뽑습니다.</p>
      ) : (
        <div className="ad-tw"><table className="tbl">
          <thead><tr><th>등록</th><th className="num-cell">희망 소개비</th><th>자동 판정</th><th>재검 결과</th><th>일치</th><th /></tr></thead>
          <tbody>
            {rows.map((s) => {
              const bad = !!s.memo?.startsWith('감사: 부적정');
              return (
                <tr key={s.id} className={bad ? 'bad' : undefined}>
                  <td><b>{s.title}</b></td>
                  <td className="num-cell money-sm">{won(s.desiredFee)}</td>
                  <td>승인 · {new Date(s.decidedAt).toLocaleDateString('ko-KR')}</td>
                  <td>{result(s)}</td>
                  <td>{s.pending ? '—' : bad ? <span className="ad-bg no">불일치</span> : <span className="ad-bg ok">일치</span>}</td>
                  <td>
                    {s.pending && (
                      <div className="row-actions" style={{ marginTop: 0 }}>
                        <button className="btn-ok btn-sm" disabled={busy === s.id} onClick={() => record(s.id, true)}>적정</button>
                        <button className="btn-no btn-sm" disabled={busy === s.id} onClick={() => record(s.id, false)}>부적정</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}

      <div className="ad-nt warn">
        <b>불일치가 나오면 규칙을 고쳐야 합니다.</b> 표본만 다시 보고 넘어가면 같은 것이 계속 통과됩니다.
      </div>
    </section>
  );
}
