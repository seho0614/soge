import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { useHashSub } from '../../lib/hashSub';

interface Signal {
  code: string; view: string; note: string; count: number; ok: boolean;
  lastReview: { reviewedAt: string; verdict: string; reason: string } | null;
}
interface Signals { items: Signal[]; overdue: Array<{ code: string; signalCount: number; lastReviewed: string | null }>; note: string | null }
interface Review { id: string; signalCode: string; verdict: string; reason: string; actionTaken: string | null; reviewedAt: string; reviewedBy: string }
interface Reviews { items: Review[]; thinCount: number; note: string | null }
/** v10.32 — GET /admin/audit/policy (보관 · 확인 기한 · 임계) */
interface Policy { retentionDays: number | null; reviewSlaHours: number | null; thresholds: Array<{ code: string; threshold: number; windowHrs: number; active: boolean }> }

const VERDICT: Record<string, string> = {
  NORMAL: '정상', WATCH: '지켜봄', ESCALATED: '윗선 보고', ACTION_TAKEN: '조치함',
};

/**
 * SB-ADM-AUD-010 감사
 *
 * 감시 뷰가 있었지만 **보려면 터미널을 열어야** 했습니다. 운영이 직접 봐야 밤중에 일이 생겨도 대응합니다.
 * 0이 아니라고 곧바로 유출은 아닙니다 — 무엇을 보았는지 확인한 뒤 판단을 남깁니다.
 * 판단 사유가 열 자 미만이면 부실 기록으로 잡힙니다(v_audit_review_thin).
 */
/* v10.32 — 시안대로 두 화면으로 나눕니다: 「감사」(SB-ADM-AUD-010 · #/gov-audit) · 「감사 기록」(SB-ADM-AUD-020 · #/gov-audit/logs).
 * 전에는 감사 기록 수백 줄이 감사 쪽 아래에 붙어 있었습니다. 「기록 보기」 ↔ 「← 감사 징후」로 오갑니다. */
export function Audit() {
  const [view, setView] = useHashSub<'signals' | 'logs'>('signals', ['signals', 'logs']);
  const go = (v: 'signals' | 'logs') => {
    history.pushState(null, '', `#/gov-audit/${v}`);
    window.dispatchEvent(new Event('bo-sub'));
    window.scrollTo(0, 0);
    setView(v);
  };
  return view === 'logs' ? <AuditLogs onBack={() => go('signals')} /> : <AuditSignals onLogs={() => go('logs')} />;
}

function AuditSignals({ onLogs }: { onLogs: () => void }) {
  const sig = useApi<Signals>('/admin/audit/signals');
  const rev = useApi<Reviews>('/admin/audit/reviews');
  const pol = useApi<Policy>('/admin/audit/policy');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: '', verdict: 'NORMAL', reason: '', actionTaken: '' });
  const a = useAct();

  const submit = () => {
    const code = f.code;
    if (!code) { a.setErr('어느 징후를 확인했는지 고르십시오.'); return; }
    if (f.reason.trim().length < 10) { a.setErr('판단 사유를 열 자 이상 적으십시오. "이상 없음" 은 나중에 아무 근거가 되지 않습니다.'); return; }
    if (f.verdict === 'ACTION_TAKEN' && f.actionTaken.trim().length < 2) { a.setErr('조치하셨다면 무엇을 했는지 적으십시오.'); return; }
    void a.run(code, () => api('/admin/audit/reviews', {
      method: 'POST',
      body: JSON.stringify({ signalCode: code, verdict: f.verdict, reason: f.reason.trim(), actionTaken: f.actionTaken.trim() || undefined }),
    }), () => { setOpen(false); setF({ code: '', verdict: 'NORMAL', reason: '', actionTaken: '' }); sig.reload(); rev.reload(); },
    '판단을 기록했습니다.');
  };

  if (sig.error) return <ErrorView error={sig.error} onRetry={sig.reload} />;
  if (!sig.data) return <p className="muted">불러오는 중…</p>;
  const items = sig.data.items;
  const hot = items.filter((s) => !s.ok).length;
  const th = (code: string) => pol.data?.thresholds.find((t) => t.code === code);
  const ret = pol.data?.retentionDays;
  const retText = ret == null ? '—' : ret % 365 === 0 ? `${ret / 365}년` : `${ret}일`;
  const thin = rev.data?.thinCount ?? 0;

  return (
    <section>
      {/* v10.29 — 화면 제목 · 설명은 위 공통 제목 줄(App · adminMenu PAGE)이 그립니다 */}
      {/* v10.32 — 시안(scAdmAud .kpi4 > .kc)은 숫자 4칸을 세로 4줄(흰 줄 · 왼쪽 값 · 오른쪽 이름)로 그립니다 */}
      <div className="kpi4 ad-krows" data-audit-kpi>
        <div><b className={hot ? 'bad' : 'good'}>{hot}</b><span>징후</span></div>
        <div><b className={sig.data.overdue.length ? 'bad' : 'good'}>{sig.data.overdue.length}</b><span>확인 밀림</span></div>
        <div><b>{rev.data?.items.length ?? 0}</b><span>확인 기록</span></div>
        <div><b>{retText}</b><span>보관</span></div>
      </div>
      {sig.data.overdue.length > 0 && sig.data.note && <div className="ad-nt warn">{sig.data.note}</div>}
      <div className="ad-nt info"><b>0이 아니라고 곧바로 유출은 아닙니다.</b> 무엇을 보았는지 확인한 뒤 판단하십시오 — 야근이나 정산 처리일 수 있습니다.</div>

      <h3 className="ad-s2">감시 항목 {items.length}종</h3>
      <div className="ad-tw"><table className="tbl" data-audit-signals>
        <thead><tr><th>항목</th><th>무엇을 보나</th><th>임계</th><th className="num-cell">건수</th><th>최근 판단</th></tr></thead>
        <tbody>
          {items.map((s) => {
            const t = th(s.code);
            return (
              <tr key={s.code}>
                <td className="mono">{s.code}</td>
                <td>{s.note}</td>
                <td>{t ? `${t.threshold}건${t.windowHrs !== 24 ? ` / ${t.windowHrs}시간` : ''}` : '—'}</td>
                <td className="num-cell">{s.ok ? 0 : <b className="warn-text">{s.count}</b>}</td>
                <td className="muted">{s.lastReview ? `${VERDICT[s.lastReview.verdict] ?? s.lastReview.verdict} · ${ymdhm(s.lastReview.reviewedAt)}` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <div className="ad-nt warn"><b>임계값은 운영이 바꿀 수 있습니다.</b> 너무 낮으면 매일 뜨고, 너무 높으면 아무것도 안 뜹니다 — 한 달쯤 보고 조정하십시오.</div>

      <h3 className="ad-s2">확인 기록</h3>
      {rev.error ? <ErrorView error={rev.error} onRetry={rev.reload} /> : null}
      {rev.data && rev.data.items.length === 0 && <p className="ad-empty">아직 남긴 판단이 없습니다.</p>}
      {(rev.data?.items.length ?? 0) > 0 && (
        <div className="ad-tw"><table className="tbl">
          <thead><tr><th>징후</th><th>판단</th><th>사유</th><th>조치</th><th>확인자</th><th>일시</th></tr></thead>
          <tbody>
            {rev.data!.items.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.signalCode}</td>
                <td>{r.verdict === 'NORMAL' ? <span className="ad-bg ok">정상</span> : <span className="ad-bg wait">{VERDICT[r.verdict] ?? r.verdict}</span>}</td>
                <td>{r.reason}</td><td className="muted">{r.actionTaken ?? '—'}</td>
                <td>{r.reviewedBy}</td><td className="muted">{ymdhm(r.reviewedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <div className="ad-nt warn"><b>판단 사유를 반드시 적으십시오.</b> &ldquo;이상 없음&rdquo; 같은 말은 나중에 <b>아무 근거가 되지 않습니다</b> — 열 자 미만이면 부실 기록으로 잡힙니다{thin > 0 ? ` (지금 부실 기록 ${thin}건)` : ''}.</div>
      <div className="ad-nt info"><b>조치하셨다면 무엇을 했는지도 적으십시오.</b> 적지 않으면 조치로 인정되지 않습니다.</div>

      <Flash msg={a.msg} err={a.err} />
      {open && (
        <div className="ad-panel" data-audit-form>
          <div className="form-grid">
            <label><span>징후</span>
              <select value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} aria-label="징후">
                <option value="">고르십시오</option>
                {items.map((s) => <option key={s.code} value={s.code}>{s.code}{s.ok ? '' : ` · ${s.count}건`}</option>)}
              </select>
            </label>
            <label><span>판단</span>
              <select value={f.verdict} onChange={(e) => setF({ ...f, verdict: e.target.value })}>
                {Object.entries(VERDICT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label style={{ gridColumn: 'span 2' }}><span>판단 사유 (열 자 이상)</span>
              <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
            </label>
            <label style={{ gridColumn: 'span 2' }}><span>조치 (했다면)</span>
              <input value={f.actionTaken} onChange={(e) => setF({ ...f, actionTaken: e.target.value })} />
            </label>
          </div>
          <div className="acts"><button className="btn-ok" disabled={!!a.busy} onClick={submit}>판단 기록</button>
            <button className="btn-plain" onClick={() => setOpen(false)}>닫기</button></div>
        </div>
      )}
      <div className="ad-dact">
        <button className="btn-ok" onClick={() => { a.clear(); setOpen(!open); }} data-audit-review>징후 확인</button>
        <button className="btn-plain" onClick={onLogs} data-audit-logs>기록 보기</button>
      </div>

      <h3 className="ad-s2">보관</h3>
      <div className="ad-tw"><table className="tbl" data-audit-retention>
        <thead><tr><th>항목</th><th>값</th><th>근거</th></tr></thead>
        <tbody>
          <tr><td>감사 기록</td><td>{ret == null ? '—' : `${retText} (${ret}일)`}</td><td className="muted">분쟁이 늦게 옵니다 · audit.retention_days</td></tr>
          <tr><td>확인 기한</td><td>{pol.data?.reviewSlaHours != null ? `${pol.data.reviewSlaHours}시간` : '—'}</td><td className="muted">밀리면 아무도 안 봅니다 · audit.review_sla_hours</td></tr>
        </tbody>
      </table></div>
      <div className="ad-nt info"><b>필요 이상으로 오래 두는 것도 위반입니다.</b> 보관 기간을 넘긴 기록은 감시 뷰(v_audit_over_retention)가 잡습니다.</div>
    </section>
  );
}

/* ── SB-ADM-AUD-020 감사 기록 — 「기록 보기」가 여는 화면: 일시 · 행위 · 대상 · 역할 · 누가 ──
 * v10.288 (D215 · docs/413) 찾기 키움 — 사람(이름 · 이메일 일부) · 행위(앞부분) · 대상(종류 · 번호) · 기간(최대 1년) · 100줄씩 넘김 · 줄 누르면 상세(전 · 후 · IP) · CSV(SUPER · 1만 줄) */
interface LogRow { id: string; at: string; action: string; targetType: string | null; targetId: string | null; role: string | null; actor: string | null; ip: string | null }
interface LogPage { items: LogRow[]; total: number; page: number; pageSize: number; from: string | null; to: string | null }
interface LogDetail extends LogRow { userAgent: string | null; before: unknown; after: unknown }
function AuditLogs({ onBack }: { onBack: () => void }) {
  const isSuper = tokenRoles().includes('SUPER');
  const [f, setF] = useState({ who: '', action: '', target: '', from: '', to: '' });
  const [kind, setKind] = useState('');
  const [cond, setCond] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ ...cond, ...(kind ? { kind } : {}), page: String(page) }).toString();
  const logs = useApi<LogPage>(`/admin/audit/search?${qs}`);
  const [open, setOpen] = useState<LogDetail | null>(null);
  const a = useAct();
  const filter = (e: React.FormEvent) => {
    e.preventDefault();
    setCond(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)));
    setPage(1); setOpen(null);
  };
  const show = async (id: string) => { try { setOpen(await api<LogDetail>(`/admin/audit/logs/${id}`)); } catch (e) { a.setErr(String((e as Error).message ?? e)); } };
  const csv = () => void a.run('csv', async () => {
    const r = await api<{ filename: string; csv: string; note: string }>(`/admin/audit/export?${new URLSearchParams({ ...cond, ...(kind ? { kind } : {}) }).toString()}`);
    const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8' })); el.download = r.filename; el.click(); URL.revokeObjectURL(el.href);
    return r;
  }, undefined, (r) => r.note);
  const d = logs.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const js = (v: unknown) => (v == null ? '—' : JSON.stringify(v, null, 2));
  return (
    <section data-audit-logs-view>
      <Flash msg={a.msg} err={a.err} />
      {/* v10.31 — 시안 거르기 칩(전체 · 운영 · 회원 · 개인정보 열람). 서버 kind= */}
      <div className="ad-flt" role="tablist" aria-label="감사 기록 거르기">
        {([['', '전체'], ['OPS', '운영'], ['MEMBER', '회원'], ['PII', '개인정보 열람']] as const).map(([k, t]) => (
          <button key={k || 'all'} role="tab" className={kind === k ? 'on' : ''} aria-selected={kind === k}
                  onClick={() => { setKind(k); setPage(1); }} data-audit-kind={k || 'ALL'}>{t}</button>
        ))}
      </div>
      <form className="search-row" onSubmit={filter} data-audit-search>
        <input value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} placeholder="행위 (예: ACCOUNT_VIEW · 앞부분도)" aria-label="행위" />
        <input value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })} placeholder="사람 (이름 · 이메일 일부)" aria-label="사람" data-audit-who />
        <input value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="대상 (종류 예: ACCOUNT · 번호)" aria-label="대상" data-audit-target />
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="시작" data-audit-from />
        <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="끝" data-audit-to />
        <button className="btn-ok" type="submit">기록 보기</button>
      </form>
      <div className="acts">
        <span className="dim" data-audit-total={d?.total ?? ''}>{d ? `${d.from ?? '처음'} ~ ${d.to ?? '지금'} · 모두 ${d.total}줄` : ''}</span>
        {isSuper && <button className="btn-sm" disabled={a.busy === 'csv' || !d?.total} onClick={csv} data-audit-csv>CSV 받기(1만 줄까지)</button>}
      </div>
      {logs.error ? <ErrorView error={logs.error} onRetry={logs.reload} /> : null}
      {!d && !logs.error && <p className="muted">불러오는 중…</p>}
      {d && d.items.length === 0 && <p className="ad-empty">해당 기간에 기록이 없습니다.</p>}
      {d && d.items.length > 0 && (
        <div className="ad-tw"><table className="tbl" data-audit-log-table>
          <thead><tr><th>일시</th><th>행위</th><th>대상</th><th>역할</th><th>누가</th></tr></thead>
          <tbody>
            {d.items.map((l) => (
              <tr key={l.id} data-audit-row={l.id} onClick={() => void show(l.id)} style={{ cursor: 'pointer' }}>
                <td className="muted">{ymdhm(l.at)}</td><td className="mono">{l.action}</td>
                <td className="muted">{l.targetType ?? '—'}{l.targetId ? ` · ${l.targetId.slice(0, 8)}` : ''}</td>
                <td>{l.role ?? '—'}</td><td>{l.actor ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {d && pages > 1 && (
        <div className="acts" data-audit-pages={pages}>
          <button className="btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>앞</button>
          <span className="dim">{page} / {pages}</span>
          <button className="btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>뒤</button>
        </div>
      )}
      {open && (
        <div className="card pad" data-audit-detail={open.id}>
          <div className="acts"><b className="mono">{open.action}</b><span className="dim">{ymdhm(open.at)} · {open.actor ?? '—'} · {open.role ?? '—'} · IP {open.ip ?? '—'}</span>
            <button className="btn-sm" onClick={() => setOpen(null)}>닫기</button></div>
          <p className="dim">대상 {open.targetType ?? '—'} {open.targetId ?? ''} · {open.userAgent ?? ''}</p>
          {open.before != null && <><h4>전</h4><pre className="mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>{js(open.before)}</pre></>}
          <h4>내용(응답)</h4><pre className="mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto' }} data-audit-after>{js(open.after)}</pre>
        </div>
      )}
      <div className="ad-nt info"><b>감사 기록은 고치거나 지울 수 없습니다.</b> DB 가 막습니다(바꾸기 · 지우기 모두 거절). 보관 3년(1095일) — 분쟁이 늦게 옵니다. CSV 를 받으면 그 조건 · 줄 수가 감사 기록(AUDIT_LOG_EXPORT)에 남습니다.</div>
      <div className="ad-nt warn"><b>개인정보를 본 기록에는 사유가 함께 남습니다.</b> 사유 없이 본 기록은 징후(NO_REASON)로 잡힙니다.</div>
      <div className="ad-dact"><button className="btn-plain" onClick={onBack} data-audit-back>← 감사 징후</button></div>
    </section>
  );
}
