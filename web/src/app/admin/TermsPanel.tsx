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
 *
 * v10.157 (docs/239) — 줄마다 「고치기」: 법무가 〔미확정〕을 채운 글을 화면에서 저장(PUT /admin/terms/{code} · 감사 TERM_DRAFT)
 *   초안 · 법무 검토 판은 그 판에 · 게시 · 보관 판은 새 번호로만(서버 422 TERM_LOCKED · DB D150) · 「바뀐 곳 보기」 줄 비교 · 남은 〔미확정〕 목록
 *
 * v10.161 (docs/246 · D151) — 시행일 지키기: 시행일이 미래면 「시행 예정」(앞 판은 시행일까지 게시 그대로 · 재동의는 시행일부터)
 *   · 줄마다 「예정 취소」(시행일 전 · 동의 기록 없을 때 · PATCH /admin/terms/{code}/unschedule · 감사 TERM_UNSCHEDULE)
 *   · 게시 확인 창에 이용약관 제14조(7일 전 · 불리한 변경 30일 전) 경고 · 운영 화면 메뉴 「관 관리 › 약관」 에서도 엶
 */

interface Term {
  code: string; version: string; title: string; body: string; status: string;
  isRequired: boolean; blockedBy: string | null; effectiveFrom: string | null; changeNote?: string | null;
  /** v10.161 — 시행 예정(게시됐지만 시행일 전 · 앞 판이 아직 시행 중) */ scheduled?: boolean;
  /** v10.162 — 대상 · 불리한 변경 */ audience?: string; isAdverse?: boolean;
}

const STATUS: Record<string, string> = { DRAFT: '초안', LEGAL_REVIEW: '법무 검토', PUBLISHED: '게시', ARCHIVED: '보관' };
const holes = (b: string) => (b.match(/〔[^〕]*〕/g) ?? []).filter((m) => m !== '〔시행일〕');
const aiClause = (b: string) => /(^|\n)#{1,4}[^\n]*국외 이전/.test(b);
const editable = (st: string) => st === 'DRAFT' || st === 'LEGAL_REVIEW';
const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
/** v10.161 — 시행일이 아직 오지 않은 게시 판(시행 예정 · 처음 게시한 판 포함) */
const future = (t: Term) => t.status === 'PUBLISHED' && !!t.effectiveFrom && Date.parse(t.effectiveFrom) > Date.now();
const verNum = (v: string) => v.split('.').map((x) => Number(x) || 0);
const verCmp = (a: string, b: string) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; } return 0; };
/** 게시 · 보관 판을 고치면 그 약관의 가장 높은 번호 다음(1.0 · 1.1 → 1.2) */
function nextVersion(all: Term[], code: string) {
  const top = all.filter((t) => t.code === code).map((t) => t.version).sort(verCmp).pop() ?? '1.0';
  const n = verNum(top); if (n.length < 2) n.push(0); n[n.length - 1] = (n[n.length - 1] ?? 0) + 1; return n.join('.');
}
/** 줄 단위 비교(LCS) — 바뀐 줄만 돌려줌 */
function lineDiff(a: string, b: string): { t: '+' | '-'; n: number; s: string }[] {
  const x = a.split('\n'), y = b.split('\n');
  if (x.length * y.length > 4_000_000) return [{ t: '+', n: 0, s: '(글이 너무 길어 비교하지 않습니다)' }];
  const W = y.length + 1, L = new Uint32Array((x.length + 1) * W);
  const g = (i: number, j: number) => L[i * W + j] ?? 0;
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i * W + j] = x[i] === y[j] ? g(i + 1, j + 1) + 1 : Math.max(g(i + 1, j), g(i, j + 1));
  const out: { t: '+' | '-'; n: number; s: string }[] = [];
  let i = 0, j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { i++; j++; }
    else if (j < y.length && (i >= x.length || g(i, j + 1) >= g(i + 1, j))) { out.push({ t: '+', n: j + 1, s: y[j] ?? '' }); j++; }
    else { out.push({ t: '-', n: i + 1, s: x[i] ?? '' }); i++; }
  }
  return out;
}

interface Edit { key: string; code: string; from: string; version: string; title: string; body: string; orig: string; diff: boolean; note: string; origNote: string }

export function TermsPanel() {
  const { data, error, reload } = useApi<Term[]>('/admin/terms');
  /* v10.161 — 재동의 시점 스위치(terms.reconsent_before_effective · 기본 off = 시행일부터 · 법무 판단 뒤에만 on) */
  const st = useApi<{ key: string; value: string | null }[]>('/admin/site-settings');
  const early = st.data?.find((s) => s.key === 'terms.reconsent_before_effective')?.value === 'on';
  /* v10.162 (D152) — 시행 예정 게시 때 회원 알림(terms.notify_members · 기본 on) */
  const notifyOn = (st.data?.find((s) => s.key === 'terms.notify_members')?.value ?? 'on') === 'on';
  const [open, setOpen] = useState<string | null>(null);
  const [day, setDay] = useState('');
  const [adverse, setAdverse] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const [ed, setEd] = useState<Edit | null>(null);

  function startEdit(t: Term, all: Term[]) {
    setOpen(null); setRes(null);
    setEd({ key: `${t.code}:${t.version}`, code: t.code, from: t.version, version: editable(t.status) ? t.version : nextVersion(all, t.code),
            title: t.title, body: t.body, orig: t.body, diff: false,
            /* v10.159 — 새 판이면 바뀐 점을 새로 적음(재동의 화면 「바뀐 점」) · 초안을 고칠 때는 적어 둔 것 */
            note: editable(t.status) ? (t.changeNote ?? '') : '', origNote: editable(t.status) ? (t.changeNote ?? '') : '' });
  }

  async function save(e: Edit) {
    const isNew = e.version !== e.from;
    if (!window.confirm(isNew ? `「${e.title}」 을 새 판 ${e.version} 으로 저장할까요?\n(${e.from} 은 그대로 남습니다 · 저장만으로는 게시되지 않습니다)`
      : `「${e.title}」 ${e.version} 초안을 고쳐 저장할까요?\n(저장만으로는 게시되지 않습니다)`)) return;
    setBusy(e.key); setRes(null);
    try {
      const r = await api<{ code: string; version: string; holes: number }>(`/admin/terms/${e.code}`,
        { method: 'PUT', body: JSON.stringify({ version: e.version, title: e.title, body: e.body, ...(e.note.trim() ? { changeNote: e.note.trim() } : {}) }) });
      setRes({ ok: true, text: `${e.title} ${r.version} 을 저장했습니다(법무 검토 · 게시 전). ${r.holes ? `〔미확정〕 ${r.holes}곳 남음 — 채워야 게시할 수 있습니다.` : '〔미확정〕 없음 — 시행일을 넣고 게시할 수 있습니다.'}` });
      setEd(null); reload();
    } catch (err) {
      setRes({ ok: false, text: err instanceof ApiFailure ? err.body.message : '저장하지 못했습니다.' });
    } finally { setBusy(null); }
  }

  async function publish(t: Term, all: Term[]) {
    if (!day) { setRes({ ok: false, text: '시행일을 먼저 넣으십시오.' }); return; }
    /* v10.161 — 앞 판이 있으면 시행일까지 그대로 시행 · 재동의는 시행일부터. 이용약관 제14조 고지 기간 경고 */
    const prev = all.find((u) => u.code === t.code && u.status === 'PUBLISHED' && !u.scheduled);
    const lead = Math.round((Date.parse(day) - Date.parse(todayKst())) / 86_400_000);
    const lines = [`「${t.title}」 ${t.version} 을 시행일 ${day} 로 게시할까요?`, ''];
    if (prev && lead > 0) lines.push(`지금 시행 중인 ${prev.version} 은 ${day} 전날까지 그대로 시행되고, 회원 재동의는 ${day} 부터 받습니다. 그동안 사용자 웹에 「바뀔 약관」 알림이 나갑니다.`, '');
    if (prev && lead < 7) lines.push(`⚠ 시행일까지 ${lead}일 — 이용약관 제14조는 시행 7일 전 고지(회원에게 불리한 변경은 30일 전)입니다.`, '');
    else if (prev && lead < 30 && !adverse) lines.push(`회원에게 불리한 변경이면 30일 전 고지가 필요합니다(지금 ${lead}일 전) — 불리하면 「회원에게 불리한 변경」을 고르십시오.`, '');
    if (prev && adverse) lines.push('「회원에게 불리한 변경」 — 시행일이 30일 안이면 서버가 거절합니다.', '');
    if (prev && lead > 0 && notifyOn && t.audience !== 'PARTNER') lines.push('게시하면 회원마다 「약관 변경 안내」 알림이 갑니다(사이트 안 · 메일 · 알림톡은 켜진 뒤).', '');
    lines.push('게시하면 이용자와의 계약 조건이 되고, 되돌려도 이미 받은 동의 기록은 남습니다.', '법무 확인을 마친 글입니까?');
    if (!window.confirm(lines.join('\n'))) return;
    const key = `${t.code}:${t.version}`;
    setBusy(key); setRes(null);
    try {
      const r = await api<{ code: string; version: string; remainingBlockers: number; scheduled?: boolean; notified?: number }>(`/admin/terms/${t.code}/publish`,
        { method: 'PATCH', body: JSON.stringify({ version: t.version, effectiveFrom: day, adverse }) });
      setRes({ ok: true, text: r.scheduled
        ? `${t.title} ${r.version} 을 시행 예정으로 게시했습니다(시행 ${day} · 그때까지 앞 판 시행 · 재동의는 ${day} 부터 · 회원 알림 ${r.notified ?? 0}건). 남은 오픈 차단 ${r.remainingBlockers}건.`
        : `${t.title} ${r.version} 을 게시했습니다(시행 ${day}). 남은 오픈 차단 ${r.remainingBlockers}건.` });
      reload();
    } catch (e) {
      setRes({ ok: false, text: e instanceof ApiFailure ? e.body.message : '게시하지 못했습니다.' });
    } finally { setBusy(null); }
  }

  async function flipEarly() {
    const to = early ? 'off' : 'on';
    if (!window.confirm(to === 'on'
      ? '재동의를 「게시 즉시」로 바꿀까요?\n\n시행일 전이라도 새 판을 게시하는 순간 회원에게 재동의 화면이 뜹니다. 이용약관 제14조(시행일부터 적용)와 어긋날 수 있어 법무 판단 뒤에만 바꾸십시오.'
      : '재동의를 「시행일부터」(기본 · 이용약관 제14조)로 되돌릴까요?')) return;
    setBusy('early'); setRes(null);
    try {
      await api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'terms.reconsent_before_effective', value: to }) });
      setRes({ ok: true, text: `재동의 시점을 「${to === 'on' ? '게시 즉시' : '시행일부터'}」로 바꿨습니다.` });
      st.reload(); reload();
    } catch (e) {
      setRes({ ok: false, text: e instanceof ApiFailure ? e.body.message : '바꾸지 못했습니다.' });
    } finally { setBusy(null); }
  }

  /** v10.162 (D152) — 회원 알림 스위치(SUPER · 서버 TERMS_SETTING_SUPER) */
  async function flipNotify() {
    const to = notifyOn ? 'off' : 'on';
    if (!window.confirm(to === 'off'
      ? '시행 예정 게시 때 회원 알림을 보내지 않을까요?\n\n이용약관 제14조의 고지는 사용자 웹 알림(바닥줄 · 약관 화면)만으로 하게 됩니다.'
      : '시행 예정 게시 때 회원마다 「약관 변경 안내」 알림을 보낼까요?')) return;
    setBusy('notify'); setRes(null);
    try {
      await api('/admin/site-settings', { method: 'PATCH', body: JSON.stringify({ key: 'terms.notify_members', value: to }) });
      setRes({ ok: true, text: `회원 알림을 「${to === 'on' ? '보냄' : '보내지 않음'}」으로 바꿨습니다.` });
      st.reload();
    } catch (e) {
      setRes({ ok: false, text: e instanceof ApiFailure ? e.body.message : '바꾸지 못했습니다.' });
    } finally { setBusy(null); }
  }

  /** v10.161 — 시행 예정 판 게시 취소(시행일 전 · 동의 기록 없을 때 · 서버가 다시 검사) */
  async function unschedule(t: Term) {
    if (!window.confirm(`「${t.title}」 ${t.version} 의 시행 예정(${t.effectiveFrom ? ymdKst(t.effectiveFrom) : ''})을 취소할까요?\n\n`
      + '법무 검토 판으로 돌아가고, 본문의 시행일은 〔시행일〕로 되돌립니다. 지금 시행 중인 판은 그대로입니다.')) return;
    const key = `${t.code}:${t.version}`;
    setBusy(key); setRes(null);
    try {
      const r = await api<{ notified?: number }>(`/admin/terms/${t.code}/unschedule`, { method: 'PATCH', body: JSON.stringify({ version: t.version }) });
      setRes({ ok: true, text: `${t.title} ${t.version} 의 시행 예정을 취소했습니다(법무 검토 판으로 · 취소 안내 알림 ${r.notified ?? 0}건).` });
      reload();
    } catch (e) {
      setRes({ ok: false, text: e instanceof ApiFailure ? e.body.message : '취소하지 못했습니다.' });
    } finally { setBusy(null); }
  }

  if (error) return <div data-terms-panel><h2 className="ad-s2">약관</h2><ErrorView error={error} /></div>;
  if (!data) return null;
  const today = todayKst();   // 한국 날짜 — 과거는 서버가 거절
  return (
    <div data-terms-panel style={{ marginTop: 16 }}>
      <h2 className="ad-s2">약관 <small className="dim">법무 확인을 마친 글만 게시 — 게시하면 가입 · 바닥줄에 나가고 오픈 차단(약관)이 줄어듭니다</small></h2>
      <div className="row-actions" style={{ marginBottom: 8 }}>
        <label>시행일 <input type="date" min={today} value={day} onChange={(e) => setDay(e.target.value)} aria-label="시행일" data-terms-date /></label>
        <span className="muted">오늘 이후 · 오픈일에 맞추는 것을 권함(오픈 체크리스트 › 오픈일)</span>
        <label title="이용약관 제14조 — 회원에게 불리한 변경은 시행 30일 전 고지"><input type="checkbox" checked={adverse} onChange={(e) => setAdverse(e.target.checked)} data-terms-adverse /> 회원에게 불리한 변경(30일 전 고지)</label>
      </div>
      {st.data && (
        <p className={early ? 'warn-text' : 'muted'} data-terms-reconsent={early ? 'early' : 'effective'}>
          새 판 재동의: <b>{early ? '게시 즉시(시행일 전에도)' : '시행일부터 — 그전에는 사용자 웹에 「바뀔 약관」 알림(이용약관 제14조)'}</b>{' '}
          <button className="btn-sm ghost" disabled={busy === 'early'} onClick={() => void flipEarly()} data-terms-reconsent-flip>{early ? '시행일부터로 되돌리기' : '게시 즉시로 바꾸기(법무 판단 뒤)'}</button>
        </p>
      )}
      {st.data && (
        <p className="muted" data-terms-notify={notifyOn ? 'on' : 'off'}>
          시행 예정 게시 때 회원 알림: <b>{notifyOn ? '보냄 — 회원마다 「약관 변경 안내」 1건(이용약관 제14조 고지)' : '보내지 않음'}</b>{' '}
          <button className="btn-sm ghost" disabled={busy === 'notify'} onClick={() => void flipNotify()} data-terms-notify-flip>{notifyOn ? '보내지 않기' : '보내기'}</button>
        </p>
      )}
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
                <tr key={key} data-term-row={key} data-status={t.status} data-holes={h.length} data-scheduled={t.scheduled ? 'y' : undefined}>
                  <td><b>{t.title}</b><span className="ad-ls mono">{t.code}{t.isRequired ? ' · 필수' : ''}</span></td>
                  <td>{t.version}</td>
                  <td>{t.scheduled ? <b data-term-scheduled>시행 예정</b> : (STATUS[t.status] ?? t.status)}{future(t) && !t.scheduled && <span className="ad-ls">시행일 전(첫 판)</span>}</td>
                  <td>{t.effectiveFrom && t.status !== 'DRAFT' && t.status !== 'LEGAL_REVIEW' ? ymdKst(t.effectiveFrom) : '-'}</td>
                  <td>
                    {h.length > 0 ? <span className="warn-text" data-term-holes>〔미확정〕 {h.length}곳</span> : <span className="muted">미확정 없음</span>}
                    {t.code === 'PRIVACY' && <><br /><span className={aiClause(t.body) ? 'muted' : 'warn-text'} data-term-ai={aiClause(t.body) ? 'y' : 'n'}>
                      국외 이전 조항 {aiClause(t.body) ? '있음(AI 켜기 조건)' : '없음'}</span></>}
                    {t.blockedBy && <><br /><span className="ad-ls">{t.blockedBy}</span></>}
                  </td>
                  <td className="row-actions">
                    <button className="btn-sm" onClick={() => setOpen(open === key ? null : key)} data-term-view>{open === key ? '본문 닫기' : '본문 보기'}</button>
                    <button className="btn-sm" onClick={() => (ed?.key === key ? setEd(null) : startEdit(t, data))} data-term-edit
                            title={editable(t.status) ? '이 초안을 고쳐 저장' : '게시 · 보관된 판은 고칠 수 없어 새 판 번호로 저장'}>{ed?.key === key ? '고치기 닫기' : '고치기'}</button>
                    {(t.status === 'DRAFT' || t.status === 'LEGAL_REVIEW') && (
                      <button className="btn-ok btn-sm" disabled={!can || !day || busy === key} onClick={() => void publish(t, data)} data-term-publish
                              title={h.length ? '〔미확정〕 표시를 먼저 채우십시오' : !day ? '시행일을 먼저 넣으십시오' : '게시'}>게시</button>
                    )}
                    {future(t) && (
                      <button className="btn-sm" disabled={busy === key} onClick={() => void unschedule(t)} data-term-unschedule
                              title="시행일 전 · 동의 기록이 없을 때만 — 법무 검토 판으로 되돌림">예정 취소</button>
                    )}
                  </td>
                </tr>,
                open === key && (
                  <tr key={key + ':body'} data-term-body={key}>
                    <td colSpan={6}><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 420, overflow: 'auto', margin: 0, fontSize: 13 }}>{t.body || '(본문 없음)'}</pre></td>
                  </tr>
                ),
                ed?.key === key && (() => {
                  const eh = holes(ed.body);
                  const changed = ed.body !== ed.orig || ed.title !== t.title || ed.note !== ed.origNote;
                  const d = ed.diff ? lineDiff(ed.orig, ed.body) : [];
                  const clash = ed.version !== ed.from && data.some((u) => u.code === ed.code && u.version === ed.version);
                  return (
                    <tr key={key + ':edit'} data-term-editor={key}>
                      <td colSpan={6}>
                        <div className="row-actions" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
                          <label>판 <input className="inp-sm" style={{ width: 72 }} value={ed.version} onChange={(e) => setEd({ ...ed, version: e.target.value.trim() })} aria-label="판 번호" data-term-ver /></label>
                          <label style={{ flex: 1, minWidth: 240 }}>제목 <input className="sel" style={{ width: '80%' }} value={ed.title} onChange={(e) => setEd({ ...ed, title: e.target.value })} aria-label="제목" data-term-title /></label>
                          <span className="muted">{editable(t.status) && ed.version === ed.from ? `${ed.from} 초안을 고침` : `${ed.from} 은 그대로 두고 새 판 ${ed.version} 으로`}</span>
                        </div>
                        <textarea value={ed.body} onChange={(e) => setEd({ ...ed, body: e.target.value })} rows={18} style={{ width: '100%', fontSize: 13, fontFamily: 'inherit' }} aria-label="약관 본문" data-term-text />
                        <label style={{ display: 'block', margin: '6px 0' }}>바뀐 점(회원 재동의 화면에 보임 · 300자)
                          <input className="sel" style={{ width: '100%' }} maxLength={300} value={ed.note} placeholder="예: 제6조 국외 이전 — AI 상담 질문을 받는 곳 · 보관 기간을 적음"
                                 onChange={(e) => setEd({ ...ed, note: e.target.value })} aria-label="바뀐 점" data-term-note /></label>
                        {ed.version !== ed.from && !ed.note.trim() && <p className="warn-text" data-term-note-warn>바뀐 점을 적지 않으면 회원 재동의 화면의 「바뀐 점」이 「—」로 나옵니다.</p>}
                        <p className={eh.length ? 'warn-text' : 'muted'} data-term-edit-holes={eh.length}>
                          {eh.length ? `〔미확정〕 ${eh.length}곳 남음: ${eh.slice(0, 8).join(' · ')}${eh.length > 8 ? ' …' : ''} — 법무가 정한 글로 바꾸십시오(〔시행일〕은 게시할 때 채워짐)` : '〔미확정〕 없음'}
                        </p>
                        {clash && <p className="warn-text" data-term-clash>{ed.version} 판이 이미 있습니다 — 다른 번호를 적으십시오.</p>}
                        <div className="row-actions">
                          <button className="btn-sm" disabled={!changed} onClick={() => setEd({ ...ed, diff: !ed.diff })} data-term-diff-btn>{ed.diff ? '비교 닫기' : '바뀐 곳 보기'}</button>
                          <button className="btn-ok btn-sm" disabled={!changed || clash || !ed.version || ed.body.trim().length < 50 || busy === key} onClick={() => void save(ed)} data-term-save>저장(게시 아님)</button>
                          <button className="btn-sm" onClick={() => setEd(null)}>취소</button>
                          {!changed && <span className="muted">고친 곳이 없습니다</span>}
                        </div>
                        {ed.diff && (
                          <div style={{ maxHeight: 320, overflow: 'auto', marginTop: 8, fontSize: 13 }} data-term-diff={d.length}>
                            {d.length === 0 ? <p className="muted">본문은 같습니다(제목 · 바뀐 점만 바뀜)</p> : d.map((x, i) => (
                              <div key={i} style={{ whiteSpace: 'pre-wrap', color: x.t === '+' ? 'var(--ok)' : 'var(--danger)' }} data-diff-line={x.t}>
                                <span className="mono">{x.t} {x.n}</span> {x.s || ' '}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })(),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
