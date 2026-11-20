import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

/**
 * v10.528 ~ 531 (D280 · docs/666 ~ 669) ㊿ 고객센터 · 회원 — 운영 화면 › 회원
 *   SB-ADM-CSX-010 AI 답변 초안(CsxAiDrafts) · 답변함 안 상자(CsxDraftBox)
 *   SB-ADM-CSX-020 이탈 위험 신호(CsxChurn)
 *   SB-ADM-CSX-030 메일 문구(CsxMailTemplates)
 *   SB-ADM-CSX-040 계정 합치기(CsxMerges)
 * 새 CSS 없음 — 기존 class(card · tbl · btn-* · ad-nt · muted · dim)만 · 색은 쓰지 않음(다크 모드 그대로).
 */

interface Settings {
  aiDraft: boolean; aiDraftAuto: boolean; aiDraftModel: string; aiDraftBatch: number;
  churn: boolean; churnMinPrevDays: number; churnDropPct: number; mailTemplates: boolean; accountMerge: boolean;
}
type SetKey = keyof Settings;
const SET_LABEL: Record<SetKey, string> = {
  aiDraft: 'AI 초안(csx.ai_draft)', aiDraftAuto: '자동 초안(매시간)', aiDraftModel: 'AI 초안 모델(비우면 기본)', aiDraftBatch: '자동 초안 한 번에(1 ~ 20)',
  churn: '이탈 위험 신호(csx.churn)', churnMinPrevDays: '앞 60일 최소 활동일(1 ~ 60)', churnDropPct: '줄어든 비율 기준 %(10 ~ 99)',
  mailTemplates: '고친 메일 문구 쓰기(csx.mail_templates)', accountMerge: '계정 합치기(csx.account_merge)',
};

/** 설정 상자 — 보기는 운영 관리자 · 바꾸기는 SUPER(사유) */
function CsxSettingsBox({ keys, isSuper }: { keys: SetKey[]; isSuper: boolean }) {
  const q = useApi<{ settings: Settings; counts: Record<string, number> }>('/admin/csx/overview');
  const a = useAct();
  const [edit, setEdit] = useState<Partial<Settings> | null>(null);
  const [reason, setReason] = useState('');
  if (q.error || !q.data) return null;
  const s = q.data.settings;
  const put = (k: SetKey, v: unknown) => setEdit({ ...(edit ?? {}), [k]: v } as Partial<Settings>);
  const save = () => {
    if (!edit) return;
    const body: Record<string, unknown> = { reason };
    for (const k of keys) if (edit[k] !== undefined && edit[k] !== s[k]) body[k] = edit[k];
    void a.run('set', () => api('/admin/csx/settings', { method: 'PUT', body: JSON.stringify(body) }), () => { setEdit(null); setReason(''); q.reload(); });
  };
  return (
    <div className="card" data-csx-settings={keys.join('|')}>
      <Flash msg={a.msg} err={a.err} />
      <p>
        {keys.map((k) => (
          <span key={k} style={{ marginRight: 16 }}>
            {SET_LABEL[k]} <b data-csx-set={k}>{typeof s[k] === 'boolean' ? (s[k] ? '켬' : '끔') : String(s[k] || '—')}</b>
          </span>
        ))}
        {isSuper && !edit && <button className="btn-plain btn-sm" onClick={() => setEdit({ ...s })} data-csx-set-edit="">설정 바꾸기(SUPER)</button>}
      </p>
      {edit && (
        <div>
          {keys.map((k) => (
            <p key={k}>
              <label>{SET_LABEL[k]}{' '}
                {typeof s[k] === 'boolean'
                  ? <input type="checkbox" checked={!!edit[k]} onChange={(e) => put(k, e.target.checked)} />
                  : typeof s[k] === 'number'
                    ? <input type="number" value={Number(edit[k] ?? 0)} onChange={(e) => put(k, Number(e.target.value))} style={{ width: 90 }} />
                    : <input value={String(edit[k] ?? '')} onChange={(e) => put(k, e.target.value)} />}
              </label>
            </p>
          ))}
          <p>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="바꾸는 까닭(2 ~ 200자 · 「전체 설정」 기록에 남음)" style={{ width: '60%' }} />{' '}
            <button className="btn-ok" disabled={a.busy === 'set' || reason.trim().length < 2} onClick={save} data-csx-set-save="">저장</button>{' '}
            <button className="btn-plain btn-sm" onClick={() => setEdit(null)}>취소</button>
          </p>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── v10.528 AI 답변 초안 ───────────────────────── */
interface DraftRow { id: string; inquiryId: string; no: string; title: string; inquiryStatus: string; state: string; bodyHead: string; model: string | null; engine: string | null; note: string | null; createdAt: string; usedAt: string | null; answered: boolean }
const D_ST: Record<string, string> = { QUEUED: '줄 섬', PENDING: '만드는 중', DRAFT: '초안', USED: '답변 칸에 넣음', DISCARDED: '버림', FAILED: '실패' };

export function CsxAiDrafts({ isSuper }: { isSuper: boolean }) {
  const [st, setSt] = useState('');
  const q = useApi<{ on: boolean; auto: boolean; allowed: boolean; reason: string | null; monthUsd: string | null; counts: Record<string, number>; rows: DraftRow[] }>(`/admin/csx/ai-drafts${st ? `?state=${st}` : ''}`);
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const d = q.data;
  return (
    <section data-csx-drafts={d.rows.length}>
      <CsxSettingsBox keys={['aiDraft', 'aiDraftAuto', 'aiDraftModel', 'aiDraftBatch']} isSuper={isSuper} />
      <p className="muted" data-csx-ai-allowed={d.allowed ? 'on' : (d.reason ?? 'off')}>
        AI 통로 CSX_DRAFT {d.allowed ? '열림' : `닫힘(${d.reason ?? '—'})`} · 이번 달 이 통로 비용 {d.monthUsd ?? '—'} USD
      </p>
      <p>
        {['', 'DRAFT', 'USED', 'DISCARDED', 'FAILED'].map((k) => (
          <button key={k || 'all'} className={`btn-sm ${st === k ? 'btn-ok' : 'btn-plain'}`} onClick={() => setSt(k)} data-csx-draft-state={k || 'ALL'}>
            {k ? D_ST[k] : '모두'} {k ? (d.counts[k] ?? 0) : ''}
          </button>
        ))}
      </p>
      <table className="tbl">
        <thead><tr><th>문의번호</th><th>제목</th><th>초안 앞부분</th><th>상태</th><th>만든 때</th></tr></thead>
        <tbody>
          {d.rows.length === 0 && <tr><td colSpan={5} className="muted">초안이 없습니다. 1:1 문의 답변함에서 「AI 초안 만들기」를 누르면 여기에 쌓입니다.</td></tr>}
          {d.rows.map((r) => (
            <tr key={r.id} data-csx-draft-row={r.id}>
              <td className="mono">{r.no}</td>
              <td>{r.title}{r.answered && <small className="dim"> · 답변함</small>}</td>
              <td className="muted" style={{ whiteSpace: 'pre-wrap' }}>{r.bodyHead}{r.note ? ` · ${r.note}` : ''}</td>
              <td>{D_ST[r.state] ?? r.state}{r.engine === 'MOCK' && <small className="dim"> · 시험 엔진</small>}</td>
              <td className="muted">{ymdhm(r.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ad-nt info">
        초안은 회원에게 보이지 않습니다. 답변함에서 초안을 「답변 칸에 넣기」로 옮긴 뒤 금액 · 기한 · 법률 문구를 약관 · 화면과 맞게 고쳐 「답변 보내기」로 보냅니다.
        AI 는 자주 묻는 질문 · 답변 틀 · 같은 분류의 지난 답변만 참고합니다(회원 이름 · 메일 · 연락처는 보내지 않음).
      </div>
    </section>
  );
}

/** 답변함(InquiryDesk) 한 건 화면 안 상자 — 초안 만들기 · 답변 칸에 넣기 · 버리기 */
export function CsxDraftBox({ inquiryId, closed, onUse }: { inquiryId: string; closed: boolean; onUse: (text: string) => void }) {
  const q = useApi<{ on: boolean; draft: { id: string; state: string; body: string | null; note: string | null; engine: string | null; createdAt: string } | null }>(`/admin/csx/inquiries/${inquiryId}/ai-draft`);
  const a = useAct();
  if (q.error || !q.data || !q.data.on) return null;
  const dr = q.data.draft;
  const live = dr && dr.state === 'DRAFT';
  return (
    <div className="card" data-csx-draft-box={dr?.state ?? 'NONE'}>
      <Flash msg={a.msg} err={a.err} />
      <p>
        <b>AI 답변 초안</b> <small className="dim">회원에게 보이지 않음 · 고쳐서 보냄</small>{' '}
        {!closed && !live && <button className="btn-plain btn-sm" disabled={a.busy === 'make'} data-csx-draft-make=""
          onClick={() => void a.run('make', () => api(`/admin/csx/inquiries/${inquiryId}/ai-draft`, { method: 'POST' }), q.reload)}>{a.busy === 'make' ? '만드는 중…' : 'AI 초안 만들기'}</button>}
      </p>
      {live && dr && (
        <>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', padding: 12, borderRadius: 'var(--r-sm)' }} className="card" data-csx-draft-body="">{dr.body}</pre>
          <p>
            <button className="btn-ok btn-sm" disabled={a.busy === 'use'} data-csx-draft-use=""
              onClick={() => { if (!confirm('답변 칸의 글을 이 초안으로 바꿉니다(아직 보내지 않음).')) return; const t = dr.body ?? ''; void a.run('use', () => api(`/admin/csx/ai-drafts/${dr.id}/used`, { method: 'POST' }), () => { onUse(t); q.reload(); }); }}>답변 칸에 넣기</button>{' '}
            <button className="btn-plain btn-sm" disabled={a.busy === 'drop'} data-csx-draft-discard=""
              onClick={() => void a.run('drop', () => api(`/admin/csx/ai-drafts/${dr.id}/discard`, { method: 'POST' }), q.reload)}>버리기</button>
            <small className="dim"> · {ymdhm(dr.createdAt)}{dr.engine === 'MOCK' ? ' · 시험 엔진' : ''}</small>
          </p>
        </>
      )}
      {dr && dr.state === 'FAILED' && <p className="muted">{dr.note ?? '초안을 받지 못했습니다.'}</p>}
      {dr && dr.state === 'USED' && <p className="muted">초안을 답변 칸에 넣었습니다({ymdhm(dr.createdAt)}).</p>}
    </div>
  );
}

/* ───────────────────────── v10.529 이탈 위험 신호 ───────────────────────── */
interface ChurnRow { accountId: string; email: string | null; nameHead: string; prevDays: number; recentDays: number; lastActiveOn: string | null; score: number; level: string; joinedAt: string; marketing: boolean; listings: number }
interface ChurnData { on: boolean; minPrevDays: number; dropPct: number; page: number; more: boolean; counts: { high: number; mid: number; consented: number }; builtAt: string | null; trend: Array<{ day: string; high: number; mid: number }>; rows: ChurnRow[]; note: string }

export function CsxChurn({ isSuper }: { isSuper: boolean }) {
  const [f, setF] = useState({ level: '', page: 1 });
  const q = useApi<ChurnData>(`/admin/csx/churn?page=${f.page}${f.level ? `&level=${f.level}` : ''}`);
  const a = useAct();
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const d = q.data;
  return (
    <section data-csx-churn={`${d.counts.high}|${d.counts.mid}`}>
      <CsxSettingsBox keys={['churn', 'churnMinPrevDays', 'churnDropPct']} isSuper={isSuper} />
      <Flash msg={a.msg} err={a.err} />
      <p>
        <button className={`btn-sm ${!f.level ? 'btn-ok' : 'btn-plain'}`} onClick={() => setF({ level: '', page: 1 })}>모두 {d.counts.high + d.counts.mid}</button>{' '}
        <button className={`btn-sm ${f.level === 'HIGH' ? 'btn-ok' : 'btn-plain'}`} onClick={() => setF({ level: 'HIGH', page: 1 })} data-csx-churn-high="">높음 {d.counts.high}</button>{' '}
        <button className={`btn-sm ${f.level === 'MID' ? 'btn-ok' : 'btn-plain'}`} onClick={() => setF({ level: 'MID', page: 1 })}>중간 {d.counts.mid}</button>{' '}
        <span className="muted">마케팅 동의 {d.counts.consented}명 · 셈 {ymdhm(d.builtAt)}</span>{' '}
        <button className="btn-plain btn-sm" disabled={!d.on || a.busy === 'redo'} data-csx-churn-rebuild=""
          onClick={() => void a.run('redo', () => api('/admin/csx/churn/rebuild', { method: 'POST' }), q.reload)}>지금 다시 셈</button>
      </p>
      <table className="tbl">
        <thead><tr><th>회원</th><th>앞 60일 활동일</th><th>최근 30일</th><th>마지막 활동</th><th>줄어든 정도</th><th>마케팅 동의</th><th>게시 매물</th></tr></thead>
        <tbody>
          {d.rows.length === 0 && <tr><td colSpan={7} className="muted">{d.on ? '지금 이탈 위험으로 보이는 회원이 없습니다.' : '이탈 위험 신호가 꺼져 있습니다(csx.churn).'}</td></tr>}
          {d.rows.map((r) => (
            <tr key={r.accountId} data-csx-churn-row={r.level}>
              <td>{r.nameHead} · {r.email ?? '—'}<br /><small className="dim">가입 {ymdhm(r.joinedAt)}</small></td>
              <td>{r.prevDays}</td><td>{r.recentDays}</td><td className="muted">{r.lastActiveOn ?? '—'}</td>
              <td><b>{r.score}</b> · {r.level === 'HIGH' ? '높음' : '중간'}</td>
              <td>{r.marketing ? '동의' : <span className="muted">없음 — 안내 안 감</span>}</td>
              <td>{r.listings}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {f.page > 1 && <button className="btn-plain btn-sm" onClick={() => setF({ ...f, page: f.page - 1 })}>← 앞 쪽</button>}{' '}
        {d.more && <button className="btn-plain btn-sm" onClick={() => setF({ ...f, page: f.page + 1 })}>다음 쪽 →</button>}
      </p>
      {d.trend.length > 0 && <p className="muted" data-csx-churn-trend={d.trend.length}>최근 30일: {d.trend.map((t) => `${String(t.day).slice(5, 10)} ${t.high}/${t.mid}`).join(' · ')}</p>}
      <div className="ad-nt info">
        {d.note} 이 목록은 운영 화면 안에서만 봅니다(가린 메일 · 이름 첫 글자 · 내려받기 없음). 활동한 날 = 로그인 · 매물 등록 · 거래 시작 · 1:1 문의.
      </div>
    </section>
  );
}

/* ───────────────────────── v10.530 메일 문구 ───────────────────────── */
interface TplRow { code: string; name: string; who: string; vars: string[]; required: string[]; subjectRequired: string[]; isCustom: boolean; version: number; subject: string; updatedAt: string | null }
interface TplOne {
  code: string; name: string; who: string; where: string; vars: string[]; required: string[]; subjectRequired: string[]; sample: Record<string, string>;
  defaults: { subject: string; body: string }; current: { subject: string; body: string }; isCustom: boolean; version: number;
  versions: Array<{ version: number; kind: string; subject: string | null; body: string | null; fromVersion: number | null; note: string; createdAt: string; by: string | null }>;
}

export function CsxMailTemplates({ isSuper }: { isSuper: boolean }) {
  const q = useApi<{ on: boolean; rows: TplRow[]; note: string }>('/admin/csx/mail-templates');
  const [open, setOpen] = useState<string | null>(null);
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  return (
    <section data-csx-mailtpl={q.data.rows.length}>
      <CsxSettingsBox keys={['mailTemplates']} isSuper={isSuper} />
      <table className="tbl">
        <thead><tr><th>메일</th><th>받는 사람</th><th>제목</th><th>자리값</th><th>판</th></tr></thead>
        <tbody>
          {q.data.rows.map((r) => (
            <tr key={r.code} data-csx-tpl-row={r.code}>
              <td><button className="linkbtn" onClick={() => setOpen(open === r.code ? null : r.code)} data-csx-tpl-open={r.code}>{r.name}</button>
                {r.isCustom && <span className="badge badge-verified"> 고친 문구</span>}</td>
              <td className="muted">{r.who}</td>
              <td className="muted">{r.subject}</td>
              <td className="mono">{r.vars.map((v) => `{${v}}`).join(' ')}</td>
              <td>{r.version}{r.updatedAt && <><br /><small className="dim">{ymdhm(r.updatedAt)}</small></>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && <CsxMailTemplateOne code={open} isSuper={isSuper} onChanged={q.reload} />}
      <div className="ad-nt info">{q.data.note} 주소(http · https)는 글에 직접 쓰지 않고 자리값({'{link}'} · {'{base}'})으로만 넣습니다.</div>
    </section>
  );
}

function CsxMailTemplateOne({ code, isSuper, onChanged }: { code: string; isSuper: boolean; onChanged: () => void }) {
  const q = useApi<TplOne>(`/admin/csx/mail-templates/${code}`);
  const a = useAct();
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [pv, setPv] = useState<{ ok: boolean; problems: string[]; preview: { subject: string; text: string } } | null>(null);
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const d = q.data;
  const s = subject ?? d.current.subject, b = body ?? d.current.body;
  const after = () => { setSubject(null); setBody(null); setNote(''); setPv(null); q.reload(); onChanged(); };
  const preview = () => void a.run('pv', () => api<{ ok: boolean; problems: string[]; preview: { subject: string; text: string } }>(`/admin/csx/mail-templates/${code}/preview`, { method: 'POST', body: JSON.stringify({ subject: s, body: b }) }),
    undefined, (r) => { setPv(r); return r.ok ? '검사 통과 — 아래가 보기 값으로 채운 메일입니다.' : '검사에 걸렸습니다.'; });
  return (
    <div className="card" data-csx-tpl-one={code}>
      <Flash msg={a.msg} err={a.err} />
      <h3 className="sec">{d.name} <small className="dim">{d.who} · {d.isCustom ? `고친 문구 ${d.version}판` : '코드 기본 문구'} · 보내는 곳 {d.where}</small></h3>
      <p className="muted">쓸 수 있는 자리값: <span className="mono">{d.vars.map((v) => `{${v}}`).join(' ')}</span>
        {d.required.length > 0 && <> · 본문에 꼭: <span className="mono">{d.required.map((v) => `{${v}}`).join(' ')}</span></>}
        {d.subjectRequired.length > 0 && <> · 제목에 꼭: <span className="mono">{d.subjectRequired.map((v) => `{${v}}`).join(' ')}</span></>}</p>
      <p><input name="csx-tpl-subject" value={s} onChange={(e) => setSubject(e.target.value)} maxLength={120} readOnly={!isSuper} style={{ width: '100%' }} /></p>
      <p><textarea name="csx-tpl-body" value={b} onChange={(e) => setBody(e.target.value)} rows={10} maxLength={4000} readOnly={!isSuper} style={{ width: '100%' }} /></p>
      <p>
        <button className="btn-plain btn-sm" disabled={a.busy === 'pv'} onClick={preview} data-csx-tpl-preview="">미리보기 · 검사</button>{' '}
        {isSuper && <>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="바꾸는 까닭(2 ~ 200자)" style={{ width: '40%' }} />{' '}
          <button className="btn-ok btn-sm" disabled={a.busy === 'save' || note.trim().length < 2} data-csx-tpl-save=""
            onClick={() => { if (!confirm('이 문구로 저장합니다 — 스위치가 켜져 있으면 다음 메일부터 이 문구로 나갑니다.')) return; void a.run('save', () => api(`/admin/csx/mail-templates/${code}`, { method: 'PUT', body: JSON.stringify({ subject: s, body: b, note }) }), after); }}>저장(새 판)</button>{' '}
          {d.isCustom && <button className="btn-plain btn-sm" disabled={a.busy === 'reset' || note.trim().length < 2} data-csx-tpl-reset=""
            onClick={() => { if (!confirm('코드 기본 문구로 되돌립니다.')) return; void a.run('reset', () => api(`/admin/csx/mail-templates/${code}/reset`, { method: 'POST', body: JSON.stringify({ note }) }), after); }}>코드 기본 문구로</button>}
        </>}
      </p>
      {pv && (
        <div className="card" data-csx-tpl-pv={pv.ok ? 'ok' : 'bad'}>
          {pv.problems.length > 0 && <ul className="plain">{pv.problems.map((p) => <li key={p} className="warn-text">{p}</li>)}</ul>}
          <p><b>{pv.preview.subject}</b></p>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{pv.preview.text}</pre>
        </div>
      )}
      <details>
        <summary>코드 기본 문구 보기</summary>
        <p className="muted">{d.defaults.subject}</p>
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }} className="muted">{d.defaults.body}</pre>
      </details>
      <details data-csx-tpl-versions={d.versions.length}>
        <summary>판 기록 {d.versions.length}</summary>
        <table className="tbl">
          <thead><tr><th>판</th><th>종류</th><th>까닭</th><th>누가 · 언제</th><th></th></tr></thead>
          <tbody>
            {d.versions.map((v) => (
              <tr key={v.version}>
                <td>{v.version}</td>
                <td>{v.kind === 'SAVE' ? '저장' : v.kind === 'REVERT' ? `되돌림(${v.fromVersion}판)` : '코드 기본값'}</td>
                <td className="muted">{v.note}</td>
                <td className="muted">{v.by ?? '—'} · {ymdhm(v.createdAt)}</td>
                <td>{isSuper && v.version !== d.version && <button className="btn-plain btn-sm" disabled={a.busy === `rv-${v.version}` || note.trim().length < 2}
                  onClick={() => { if (!confirm(`${v.version}판 문구로 되돌립니다(새 판으로 저장).`)) return; void a.run(`rv-${v.version}`, () => api(`/admin/csx/mail-templates/${code}/revert`, { method: 'POST', body: JSON.stringify({ version: v.version, note }) }), after); }}>이 판으로</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {isSuper && <p className="muted">되돌리기도 위 「바꾸는 까닭」 칸을 채운 뒤 누릅니다.</p>}
      </details>
    </div>
  );
}

/* ───────────────────────── v10.531 계정 합치기 ───────────────────────── */
interface Blocker { code: string; label: string; n: number }
interface Check { ok: boolean; blockers: Blocker[]; moves: Record<string, number>; keeps: Record<string, number>; identity: { match: boolean; adapter: string | null } }
interface Found { id: string; email: string | null; nameHead: string; status: string; identity: string | null }
interface MergeRow { id: string; state: string; reason: string; plan: Check; result: Record<string, unknown> | null; requestedAt: string; decidedAt: string | null; decideNote: string | null; source: string | null; target: string | null; requestedBy: string | null; decidedBy: string | null; items: number }
const M_ST: Record<string, string> = { REQUESTED: '승인 대기', DONE: '합침', REJECTED: '반려', CANCELED: '취소', FAILED: '실패' };
const MOVE_KO: Record<string, string> = { listings: '매물', requests: '요청', inquiries: '1:1 문의', favorites: '관심', pointsNonCash: '포인트(현금화 안 됨)', pointsCashable: '포인트(현금화 가능)' };
const KEEP_KO: Record<string, string> = { deals: '거래', settlements: '정산', cashouts: '포인트 출금', payoutAccounts: '지급 계좌', mallOrders: '소개몰 주문' };

export function CsxMerges({ isSuper }: { isSuper: boolean }) {
  const q = useApi<{ on: boolean; confirmWord: string; counts: Record<string, number>; rows: MergeRow[]; warn: string }>('/admin/csx/merges');
  const a = useAct();
  const [mail, setMail] = useState({ s: '', t: '' });
  const [found, setFound] = useState<{ s: Found | null; t: Found | null }>({ s: null, t: null });
  const [chk, setChk] = useState<Check | null>(null);
  const [reason, setReason] = useState('');
  if (q.error) return <ErrorView error={q.error} onRetry={q.reload} />;
  if (!q.data) return <p className="muted">불러오는 중…</p>;
  const d = q.data;
  const find = (side: 's' | 't') => void a.run(`f-${side}`, () => api<Found>(`/admin/csx/merges/find?email=${encodeURIComponent(mail[side].trim())}`),
    undefined, (r) => { setFound((x) => (side === 's' ? { ...x, s: r } : { ...x, t: r })); setChk(null); return '계정을 찾았습니다.'; });
  const check = () => { if (!found.s || !found.t) return; void a.run('chk', () => api<Check>('/admin/csx/merges/check', { method: 'POST', body: JSON.stringify({ sourceId: found.s!.id, targetId: found.t!.id }) }),
    undefined, (r) => { setChk(r); return r.ok ? '합칠 수 있습니다 — 사유를 적고 요청하십시오.' : '합칠 수 없습니다 — 아래 까닭을 먼저 정리하십시오.'; }); };
  const request = () => { if (!found.s || !found.t) return; void a.run('req', () => api('/admin/csx/merges', { method: 'POST', body: JSON.stringify({ sourceId: found.s!.id, targetId: found.t!.id, reason }) }),
    () => { setChk(null); setFound({ s: null, t: null }); setMail({ s: '', t: '' }); setReason(''); q.reload(); }); };
  const approve = (r: MergeRow) => {
    const w = prompt(`되돌릴 수 없습니다.\n${r.source} → ${r.target}\n옛 계정은 쓸 수 없게 되고 거래 · 정산 기록은 옛 계정에 남습니다.\n계속하려면 「${d.confirmWord}」를 입력하십시오.`);
    if (w === null) return;
    void a.run(`ok-${r.id}`, () => api(`/admin/csx/merges/${r.id}/approve`, { method: 'POST', body: JSON.stringify({ confirm: w }) }), q.reload);
  };
  const reject = (r: MergeRow) => { const n = prompt('반려 사유(2 ~ 300자)'); if (!n) return; void a.run(`no-${r.id}`, () => api(`/admin/csx/merges/${r.id}/reject`, { method: 'POST', body: JSON.stringify({ note: n }) }), q.reload); };
  const cancel = (r: MergeRow) => { if (!confirm('이 합치기 요청을 취소합니다.')) return; void a.run(`cc-${r.id}`, () => api(`/admin/csx/merges/${r.id}/cancel`, { method: 'POST' }), q.reload); };
  const pair = (rec: Record<string, unknown> | null | undefined, ko: Record<string, string>) =>
    Object.entries(rec ?? {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${ko[k] ?? k} ${String(v)}`).join(' · ');

  return (
    <section data-csx-merges={d.rows.length}>
      <CsxSettingsBox keys={['accountMerge']} isSuper={isSuper} />
      <Flash msg={a.msg} err={a.err} />
      <div className="ad-nt warn" data-csx-merge-warn="">{d.warn} 본인인증(실명)이 같은 두 계정만 합칩니다 — 운영 역할 · 회사 소속 · 진행 중 거래 · 정산 · 출금이 있으면 막습니다.</div>
      <div className="card" data-csx-merge-form="">
        <h3 className="sec">합치기 요청</h3>
        <p>
          <label>옛 계정(합쳐 없어질 쪽) 메일 <input name="csx-merge-s" value={mail.s} onChange={(e) => setMail({ ...mail, s: e.target.value })} placeholder="메일 주소 전체" /></label>{' '}
          <button className="btn-plain btn-sm" disabled={!mail.s.includes('@') || a.busy === 'f-s'} onClick={() => find('s')} data-csx-merge-find-s="">찾기</button>{' '}
          {found.s && <span data-csx-merge-found-s={found.s.status}>{found.s.nameHead} · {found.s.email} · {found.s.status} · 본인인증 {found.s.identity ?? '없음'}</span>}
        </p>
        <p>
          <label>남길 계정 메일 <input name="csx-merge-t" value={mail.t} onChange={(e) => setMail({ ...mail, t: e.target.value })} placeholder="메일 주소 전체" /></label>{' '}
          <button className="btn-plain btn-sm" disabled={!mail.t.includes('@') || a.busy === 'f-t'} onClick={() => find('t')} data-csx-merge-find-t="">찾기</button>{' '}
          {found.t && <span data-csx-merge-found-t={found.t.status}>{found.t.nameHead} · {found.t.email} · {found.t.status} · 본인인증 {found.t.identity ?? '없음'}</span>}
        </p>
        <p><button className="btn-plain" disabled={!found.s || !found.t || a.busy === 'chk'} onClick={check} data-csx-merge-check="">미리 확인</button></p>
        {chk && (
          <div data-csx-merge-check-result={chk.ok ? 'ok' : 'blocked'}>
            <p>본인인증 {chk.identity.match ? `같음(${chk.identity.adapter})` : '같지 않음'}</p>
            {chk.blockers.length > 0 && <ul className="plain">{chk.blockers.map((b) => <li key={b.code} className="warn-text" data-csx-merge-blocker={b.code}>{b.label}{b.n > 1 ? ` (${b.n})` : ''}</li>)}</ul>}
            <p className="muted">옮길 것: {pair(chk.moves, MOVE_KO)}</p>
            <p className="muted">옛 계정에 남는 기록: {pair(chk.keeps, KEEP_KO)}</p>
            {chk.ok && <p>
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="사유(2 ~ 300자 · 예: 회원 요청 1:1 문의 번호)" style={{ width: '60%' }} />{' '}
              <button className="btn-ok" disabled={!d.on || reason.trim().length < 2 || a.busy === 'req'} onClick={request} data-csx-merge-request="">합치기 요청</button>
              {!d.on && <small className="dim"> · 스위치가 꺼져 있어 요청할 수 없습니다</small>}
            </p>}
          </div>
        )}
      </div>
      <table className="tbl">
        <thead><tr><th>번호</th><th>옛 계정 → 남길 계정</th><th>사유</th><th>옮길 것 · 결과</th><th>상태</th><th></th></tr></thead>
        <tbody>
          {d.rows.length === 0 && <tr><td colSpan={6} className="muted">합치기 요청이 없습니다.</td></tr>}
          {d.rows.map((r) => (
            <tr key={r.id} data-csx-merge-row={r.state}>
              <td className="mono">#{r.id}</td>
              <td>{r.source} → {r.target}<br /><small className="dim">요청 {r.requestedBy} · {ymdhm(r.requestedAt)}</small></td>
              <td className="muted">{r.reason}</td>
              <td className="muted">{r.state === 'DONE' && r.result ? pair(r.result, MOVE_KO) : pair(r.plan?.moves, MOVE_KO)}</td>
              <td>{M_ST[r.state] ?? r.state}{r.decidedBy && <><br /><small className="dim">{r.decidedBy} · {ymdhm(r.decidedAt)}{r.decideNote ? ` · ${r.decideNote}` : ''}</small></>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {r.state === 'REQUESTED' && isSuper && <button className="btn-ok btn-sm" disabled={a.busy === `ok-${r.id}`} onClick={() => approve(r)} data-csx-merge-approve={r.id}>승인 · 합치기</button>}{' '}
                {r.state === 'REQUESTED' && isSuper && <button className="btn-plain btn-sm" disabled={a.busy === `no-${r.id}`} onClick={() => reject(r)}>반려</button>}{' '}
                {r.state === 'REQUESTED' && <button className="btn-plain btn-sm" disabled={a.busy === `cc-${r.id}`} onClick={() => cancel(r)}>취소</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
