import { useState } from 'react';
import { api, ApiFailure } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { ymdKst } from '../../lib/format';
import { ErrorView } from '../../components/ErrorView';

/**
 * v10.156 (docs/237) — SB-ADM-SIT-070 사이트 기본 정보 · 법정 고지 › 「약관」 구역(SUPER)
 *
 *   명세에는 있던 약관 목록 · 게시(GET /admin/terms · PATCH /admin/terms/{code}/publish)를 화면에 붙임 — 전에는 서버 스크립트로만 게시.
 *   ① 약관별 판 · 상태 · 시행일 · 필수 · 〔미확정〕 표시 수 · 처리방침은 「국외 이전 조항」(AI 켜기 조건 · D149) 있음 / 없음
 *   ② 「본문 보기」 — 법무가 읽고 확인하는 글 그대로
 *   ③ 시행일 한 칸 + 줄마다 「게시」 — 〔미확정〕이 남았거나 이미 게시 · 보관된 판은 단추가 잠김 · 확인 창(법무 확인 · 되돌릴 수 없음) · 감사 TERM_PUBLISH
 *   서버가 다시 검사합니다(TERM_HOLES · EFFECTIVE_DATE_IN_PAST · TERM_ARCHIVED). 본문의 〔시행일〕은 서버가 시행일로 채웁니다.
 */

interface Term {
  code: string; version: string; title: string; body: string; status: string;
  isRequired: boolean; blockedBy: string | null; effectiveFrom: string | null;
}

const STATUS: Record<string, string> = { DRAFT: '초안', LEGAL_REVIEW: '법무 검토', PUBLISHED: '게시', ARCHIVED: '보관' };
const holes = (b: string) => (b.match(/〔[^〕]*〕/g) ?? []).filter((m) => m !== '〔시행일〕');
const aiClause = (b: string) => /(^|\n)#{1,4}[^\n]*국외 이전/.test(b);

export function TermsPanel() {
  const { data, error, reload } = useApi<Term[]>('/admin/terms');
  const [open, setOpen] = useState<string | null>(null);
  const [day, setDay] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);

  async function publish(t: Term) {
    if (!day) { setRes({ ok: false, text: '시행일을 먼저 넣으십시오.' }); return; }
    if (!window.confirm(`「${t.title}」 ${t.version} 을 시행일 ${day} 로 게시할까요?\n\n`
      + '게시하면 이용자와의 계약 조건이 되고, 되돌려도 이미 받은 동의 기록은 남습니다.\n법무 확인을 마친 글입니까?')) return;
    const key = `${t.code}:${t.version}`;
    setBusy(key); setRes(null);
    try {
      const r = await api<{ code: string; version: string; remainingBlockers: number }>(`/admin/terms/${t.code}/publish`,
        { method: 'PATCH', body: JSON.stringify({ version: t.version, effectiveFrom: day }) });
      setRes({ ok: true, text: `${t.title} ${r.version} 을 게시했습니다(시행 ${day}). 남은 오픈 차단 ${r.remainingBlockers}건.` });
      reload();
    } catch (e) {
      setRes({ ok: false, text: e instanceof ApiFailure ? e.body.message : '게시하지 못했습니다.' });
    } finally { setBusy(null); }
  }

  if (error) return <div data-terms-panel><h2 className="ad-s2">약관</h2><ErrorView error={error} /></div>;
  if (!data) return null;
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);   // 한국 날짜 — 과거는 서버가 거절
  return (
    <div data-terms-panel style={{ marginTop: 16 }}>
      <h2 className="ad-s2">약관 <small className="dim">법무 확인을 마친 글만 게시 — 게시하면 가입 · 바닥줄에 나가고 오픈 차단(약관)이 줄어듭니다</small></h2>
      <div className="row-actions" style={{ marginBottom: 8 }}>
        <label>시행일 <input type="date" min={today} value={day} onChange={(e) => setDay(e.target.value)} aria-label="시행일" data-terms-date /></label>
        <span className="muted">오늘 이후 · 오픈일에 맞추는 것을 권함(오픈 체크리스트 › 오픈일)</span>
      </div>
      {res && <p className={res.ok ? 'form-ok' : 'warn-text'} role="status" data-terms-result={res.ok ? 'ok' : 'fail'}>{res.text}</p>}
      <div className="ad-tw">
        <table className="tbl">
          <thead><tr><th>약관</th><th>판</th><th>상태</th><th>시행일</th><th>확인</th><th></th></tr></thead>
          <tbody>
            {data.map((t) => {
              const key = `${t.code}:${t.version}`;
              const h = holes(t.body);
              const can = (t.status === 'DRAFT' || t.status === 'LEGAL_REVIEW') && h.length === 0 && !!t.body.trim();
              return [
                <tr key={key} data-term-row={key} data-status={t.status} data-holes={h.length}>
                  <td><b>{t.title}</b><span className="ad-ls mono">{t.code}{t.isRequired ? ' · 필수' : ''}</span></td>
                  <td>{t.version}</td>
                  <td>{STATUS[t.status] ?? t.status}</td>
                  <td>{t.effectiveFrom && t.status !== 'DRAFT' && t.status !== 'LEGAL_REVIEW' ? ymdKst(t.effectiveFrom) : '-'}</td>
                  <td>
                    {h.length > 0 ? <span className="warn-text" data-term-holes>〔미확정〕 {h.length}곳</span> : <span className="muted">미확정 없음</span>}
                    {t.code === 'PRIVACY' && <><br /><span className={aiClause(t.body) ? 'muted' : 'warn-text'} data-term-ai={aiClause(t.body) ? 'y' : 'n'}>
                      국외 이전 조항 {aiClause(t.body) ? '있음(AI 켜기 조건)' : '없음'}</span></>}
                    {t.blockedBy && <><br /><span className="ad-ls">{t.blockedBy}</span></>}
                  </td>
                  <td className="row-actions">
                    <button className="btn-sm" onClick={() => setOpen(open === key ? null : key)} data-term-view>{open === key ? '본문 닫기' : '본문 보기'}</button>
                    {(t.status === 'DRAFT' || t.status === 'LEGAL_REVIEW') && (
                      <button className="btn-ok btn-sm" disabled={!can || !day || busy === key} onClick={() => void publish(t)} data-term-publish
                              title={h.length ? '〔미확정〕 표시를 먼저 채우십시오' : !day ? '시행일을 먼저 넣으십시오' : '게시'}>게시</button>
                    )}
                  </td>
                </tr>,
                open === key && (
                  <tr key={key + ':body'} data-term-body={key}>
                    <td colSpan={6}><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 420, overflow: 'auto', margin: 0, fontSize: 13 }}>{t.body || '(본문 없음)'}</pre></td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
