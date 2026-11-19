/* ===== ⑳ v10.424 ~ 427 (D253 · docs/561 ~ 564) 운영 화면 「사무」 — web/src/app/admin/Office.tsx 로 새 파일 =====
 * 결재함 · 결재선 · 사내 문서함(새 메뉴 그룹 admoff 「사무」) · 분기 · 연 예산(회계 › 예산 탭 아래 상자)
 */
import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { openFile, uploadFile } from '../../lib/files';

const won = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const isSuper = () => tokenRoles().includes('SUPER');
const KIND_KO: Record<string, string> = { REQ: '품의', EXPENSE: '경비 청구', MANUAL: '수동 전표' };
const ROLE_KO: Record<string, string> = { SUPER: 'SUPER', ADMIN: '운영(ADMIN)', PAYOUT: '지급 담당', REVIEWER: '검수', PARTNER_MAL: '안심 파트너 담당', PARTNER_AFF: '제휴 파트너 담당' };
const WHERE: Record<string, string> = { REQ: '회계 › 품의', EXPENSE: '회계 › 경비 청구', MANUAL: '회계 › 수동 전표' };

/* ── v10.424 내 결재함 ── */
interface InboxItem { kind: string; id: string; amount: number; title: string; who: string | null; created_at: string; step: number; of: number; final: boolean; kindKo: string }
export function ApprovalInbox() {
  const q = useApi<{ items: InboxItem[]; count: number; note: string }>('/admin/acct/approvals/inbox');
  const a = useAct();
  const step = (it: InboxItem, approve: boolean) => {
    const note = approve ? (prompt('의견(비워도 됨)') ?? null) : prompt('반려 사유(꼭)');
    if (note === null) return;
    void a.run(`s${it.kind}${it.id}`, () => api(`/admin/acct/approvals/${it.kind}/${it.id}/step`, { method: 'POST', body: JSON.stringify({ approve, note }) }), q.reload);
  };
  return (
    <section data-apv-inbox={q.data?.count ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {q.data && (
        <>
          <p className="muted">{q.data.note}</p>
          {!q.data.items.length ? <p className="muted">결재할 문서가 없습니다.</p> : (
            <table className="tbl"><thead><tr><th>종류</th><th>제목</th><th>올린 사람</th><th className="num">금액</th><th>단계</th><th>올린 때</th><th /></tr></thead>
              <tbody>{q.data.items.map((it) => (
                <tr key={`${it.kind}${it.id}`} data-apv-item={it.kind}>
                  <td>{it.kindKo}</td><td>{it.title}</td><td>{it.who ?? ''}</td><td className="num">{won(it.amount)}</td>
                  <td>{it.step}/{it.of}{it.final && <small className="dim"> 마지막(SUPER)</small>}</td><td>{ymdhm(it.created_at)}</td>
                  <td>{it.final ? <small className="dim">{WHERE[it.kind]}에서 승인 · 반려</small> : (
                    <><button className="btn-sm" disabled={a.busy === `s${it.kind}${it.id}`} onClick={() => step(it, true)} data-apv-approve={it.id} data-perm="approve">결재</button>{' '}
                      <button className="btn-sm btn-plain" disabled={a.busy === `s${it.kind}${it.id}`} onClick={() => step(it, false)} data-perm="approve">반려</button></>
                  )}</td></tr>))}</tbody></table>
          )}
        </>
      )}
    </section>
  );
}

/* ── v10.424 결재선 ── */
interface LStep { role?: string; account?: string }
interface Line { id: string; docKind: string; upto: string | null; steps: LStep[] }
interface Lines { lines: Line[]; changes: Array<{ id: string; docKind: string; reason: string; createdAt: string; actor: string | null }>; staff: Array<{ id: string; name: string }>; roles: string[]; kinds: Array<{ code: string; label: string }>; note: string }
export function ApprovalLines() {
  const q = useApi<Lines>('/admin/acct/approval-lines');
  const a = useAct();
  const [kind, setKind] = useState('REQ');
  const [draft, setDraft] = useState<Array<{ upto: string; steps: LStep[] }> | null>(null);
  const [reason, setReason] = useState('');
  const d = q.data;
  const cur = (d?.lines ?? []).filter((l) => l.docKind === kind);
  const edit = () => setDraft(cur.map((l) => ({ upto: l.upto ?? '', steps: l.steps })));
  const stepText = (s: LStep) => (s.role ? ROLE_KO[s.role] ?? s.role : d?.staff.find((x) => x.id === s.account)?.name ?? '지정 사람');
  const save = () => draft && void a.run('lines', () => api('/admin/acct/approval-lines', { method: 'PUT',
    body: JSON.stringify({ docKind: kind, reason, lines: draft.map((l) => ({ upto: l.upto ? Number(l.upto) : null, steps: l.steps })) }) }), () => { setDraft(null); setReason(''); q.reload(); });
  return (
    <section data-apv-lines={d?.lines.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className="muted">{d.note}</p>
          <p>{d.kinds.map((k) => <button key={k.code} className={`btn-sm ${k.code === kind ? '' : 'btn-plain'}`} onClick={() => { setKind(k.code); setDraft(null); }} data-apv-kind={k.code}>{k.label}</button>)}</p>
          {!draft ? (
            <>
              {cur.length ? (
                <table className="tbl"><thead><tr><th>금액</th><th>단계</th></tr></thead>
                  <tbody>{cur.map((l) => <tr key={l.id}><td>{l.upto ? `${won(Number(l.upto))}원 이하` : '그 위 전부'}</td><td>{l.steps.map(stepText).join(' → ')}</td></tr>)}</tbody></table>
              ) : <p className="muted">{KIND_KO[kind]} 결재선이 없습니다 — SUPER 한 번으로 결재합니다.</p>}
              {isSuper() && <button className="btn-sm" onClick={edit} data-apv-edit="">고치기</button>}
            </>
          ) : (
            <div className="card pad" data-apv-draft="">
              {draft.map((l, i) => (
                <div key={i}>
                  <input value={l.upto} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, upto: e.target.value.replace(/[^0-9]/g, '') } : x)))} placeholder="금액 상한(비우면 그 위 전부)" size={18} />{' '}
                  {l.steps.map((s, k) => (
                    <select key={k} value={s.role ? `r:${s.role}` : `a:${s.account}`} onChange={(e) => {
                      const v = e.target.value; const ns: LStep = v.startsWith('r:') ? { role: v.slice(2) } : { account: v.slice(2) };
                      setDraft(draft.map((x, j) => (j === i ? { ...x, steps: x.steps.map((y, m) => (m === k ? ns : y)) } : x)));
                    }}>
                      {d.roles.map((r) => <option key={r} value={`r:${r}`}>{ROLE_KO[r] ?? r}</option>)}
                      {d.staff.map((p) => <option key={p.id} value={`a:${p.id}`}>{p.name}</option>)}
                    </select>
                  ))}{' '}
                  <button className="btn-sm btn-plain" disabled={l.steps.length >= 5} onClick={() => setDraft(draft.map((x, j) => (j === i ? { ...x, steps: [{ role: 'ADMIN' }, ...x.steps] } : x)))}>앞에 단계 더함</button>{' '}
                  <button className="btn-sm btn-plain" disabled={l.steps.length <= 1} onClick={() => setDraft(draft.map((x, j) => (j === i ? { ...x, steps: x.steps.slice(1) } : x)))}>첫 단계 뺌</button>{' '}
                  <button className="btn-sm btn-plain" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>구간 지움</button>
                </div>
              ))}
              <p><button className="btn-sm btn-plain" disabled={draft.length >= 6} onClick={() => setDraft([...draft, { upto: '', steps: [{ role: 'SUPER' }] }])}>구간 더함</button>
                <small className="dim"> 마지막 단계는 SUPER 여야 합니다.</small></p>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(꼭)" size={24} />{' '}
              <button className="btn-sm" disabled={a.busy === 'lines' || reason.trim().length < 2} onClick={save}>저장</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => setDraft(null)}>닫기</button>
            </div>
          )}
          {!!d.changes.length && (
            <details><summary>결재선 바꾼 기록 {d.changes.length}</summary>
              <table className="tbl"><tbody>{d.changes.map((c) => <tr key={c.id}><td>{ymdhm(c.createdAt)}</td><td>{KIND_KO[c.docKind] ?? c.docKind}</td><td>{c.reason}</td><td>{c.actor ?? ''}</td></tr>)}</tbody></table>
            </details>
          )}
        </>
      )}
    </section>
  );
}

/* ── v10.425 사내 문서함 ── */
interface CDoc { id: string; category: string; categoryKo: string; title: string; memo: string | null; state: string; versionNo: number | null; fileId: string | null; fileName: string | null;
  issuedOn: string | null; expiresOn: string | null; daysLeft: number | null; due: boolean; expired: boolean; versions: number }
interface CDocs { items: CDoc[]; dueDays: number; categories: Array<{ code: string; label: string }>; count: { active: number; due: number; expired: number }; note: string }
export function CorpDocs() {
  const [state, setState] = useState('ACTIVE');
  const q = useApi<CDocs>(`/admin/corp-docs?state=${state}`, [state]);
  const a = useAct();
  const [f, setF] = useState({ category: 'REGISTRY', title: '', issuedOn: '', expiresOn: '', note: '' });
  const [file, setFile] = useState<File | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const canAdd = tokenRoles().some((r) => r === 'SUPER' || r === 'ADMIN');
  const add = () => file && void a.run('add', async () => {
    const up = await uploadFile(file, 'CORP_DOC');
    return api('/admin/corp-docs', { method: 'POST', body: JSON.stringify({ ...f, fileId: up.fileId }) });
  }, () => { setF({ category: 'REGISTRY', title: '', issuedOn: '', expiresOn: '', note: '' }); setFile(null); q.reload(); });
  const addVer = (id: string) => file && void a.run(`v${id}`, async () => {
    const up = await uploadFile(file, 'CORP_DOC');
    return api(`/admin/corp-docs/${id}/versions`, { method: 'POST', body: JSON.stringify({ fileId: up.fileId, issuedOn: f.issuedOn, expiresOn: f.expiresOn, note: f.note }) });
  }, () => { setVer(null); setFile(null); q.reload(); });
  const archive = (id: string) => { const reason = prompt('보관 끝 사유(꼭 · 되돌리지 않음)'); if (reason) void a.run(`x${id}`, () => api(`/admin/corp-docs/${id}/archive`, { method: 'POST', body: JSON.stringify({ reason }) }), q.reload); };
  const d = q.data;
  return (
    <section data-corp-docs={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className="muted">{d.note} 만료 {d.dueDays}일 전부터 운영 알림(CORP_DOC_DUE).</p>
          <p>보관 중 {d.count.active} · <span className={d.count.due ? 'warn-text' : ''}>만료 다가옴 {d.count.due}</span> · 만료 지남 {d.count.expired}{' '}
            <button className="btn-sm btn-plain" onClick={() => setState(state === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE')}>{state === 'ACTIVE' ? '보관 끝 문서 보기' : '보관 중 문서 보기'}</button></p>
          {canAdd && (
            <div className="card pad" data-corp-doc-form="">
              <b>{ver ? `새 판 올리기 — 문서 ${ver}` : '문서 넣기'}</b><br />
              {!ver && <><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{d.categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select>{' '}
                <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="제목" size={24} />{' '}</>}
              <label>발급일 <input type="date" value={f.issuedOn} onChange={(e) => setF({ ...f, issuedOn: e.target.value })} /></label>{' '}
              <label>만료일 <input type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /></label>{' '}
              <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-corp-doc-file="" />{' '}
              <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="메모" size={14} />{' '}
              {ver ? <><button className="btn-sm" disabled={!file || a.busy === `v${ver}`} onClick={() => addVer(ver)}>새 판 올리기</button> <button className="btn-sm btn-plain" onClick={() => setVer(null)}>닫기</button></>
                : <button className="btn-sm" disabled={!file || f.title.trim().length < 2 || a.busy === 'add'} onClick={add}>넣기</button>}
            </div>
          )}
          <table className="tbl"><thead><tr><th>분류</th><th>제목</th><th>판</th><th>파일</th><th>발급일</th><th>만료일</th><th /></tr></thead>
            <tbody>{d.items.map((x) => (
              <tr key={x.id} data-corp-doc={x.due ? 'due' : 'ok'}>
                <td>{x.categoryKo}</td><td>{x.title}{x.memo && <small className="dim"> {x.memo}</small>}</td><td>{x.versionNo ?? '—'}판 <small className="dim">(모두 {x.versions})</small></td>
                <td>{x.fileId && <button className="btn-sm btn-plain" onClick={() => void openFile(x.fileId!)}>{x.fileName ?? '열기'}</button>}</td>
                <td>{x.issuedOn ?? '—'}</td>
                <td>{x.expiresOn ?? '—'}{x.daysLeft != null && <small className={x.due ? 'warn-text' : 'dim'}> {x.expired ? `${-x.daysLeft}일 지남` : `${x.daysLeft}일 남음`}</small>}</td>
                <td>{x.state === 'ACTIVE' && canAdd && <button className="btn-sm btn-plain" onClick={() => setVer(x.id)} data-corp-doc-ver={x.id}>새 판</button>}{' '}
                  {x.state === 'ACTIVE' && isSuper() && <button className="btn-sm btn-plain" onClick={() => archive(x.id)}>보관 끝</button>}</td></tr>))}</tbody></table>
        </>
      )}
    </section>
  );
}

/* ── v10.427 분기 · 연 예산(회계 › 예산 아래 상자) ── */
interface PItem { role: string; name: string; kind: string; quarters: Array<{ q: number; budget: number; actual: number }>; year: { budget: number; actual: number };
  ytd: { budget: number; actual: number; diff: number; pct: number | null }; over: boolean }
interface Period { year: number; upto: number; items: PItem[]; total: Record<string, number>; note: string }
export function BudgetPeriod() {
  const [year, setYear] = useState(Number(new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 4)));
  const q = useApi<Period>(`/admin/acct/budget/period?year=${year}`, [year]);
  const a = useAct();
  const [f, setF] = useState({ role: '', amount: '', split: 'EVEN', reason: '' });
  const d = q.data;
  const put = () => void a.run('year', () => api('/admin/acct/budget/year', { method: 'POST', body: JSON.stringify({ year, split: f.split, reason: f.reason, items: [{ role: f.role, amount: Number(f.amount) }] }) }),
    () => { setF({ role: '', amount: '', split: 'EVEN', reason: '' }); q.reload(); });
  return (
    <div className="card pad" data-budget-period={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <b>분기 · 연 예산</b>{' '}
      <button className="btn-sm btn-plain" onClick={() => setYear(year - 1)}>← {year - 1}</button> <b>{year}</b> <button className="btn-sm btn-plain" onClick={() => setYear(year + 1)}>{year + 1} →</button>
      {d && (
        <>
          <p className="muted">{d.note}</p>
          <p>비용 누계(1 ~ {d.upto}월) {won(d.total.expenseYtdActual)} / 예산 {won(d.total.expenseYtdBudget)} · 연 예산 {won(d.total.expenseYearBudget)} ·
            매출 누계 {won(d.total.revenueYtdActual)} / 목표 {won(d.total.revenueYtdBudget)}</p>
          <table className="tbl"><thead><tr><th>계정</th>{[1, 2, 3, 4].map((n) => <th key={n} className="num">{n}분기 예산 / 실적</th>)}<th className="num">연 예산</th><th className="num">누계 실적 / 예산</th></tr></thead>
            <tbody>{d.items.map((x) => (
              <tr key={x.role} data-budget-period-row={x.over ? 'over' : 'ok'}>
                <td>{x.name} <small className="dim">{x.kind === 'REVENUE' ? '매출' : '비용'}</small></td>
                {x.quarters.map((qq) => <td key={qq.q} className="num">{won(qq.budget)} / {won(qq.actual)}</td>)}
                <td className="num">{won(x.year.budget)}</td>
                <td className={`num ${x.over ? 'warn-text' : ''}`}>{won(x.ytd.actual)} / {won(x.ytd.budget)}{x.ytd.pct != null && ` (${x.ytd.pct}%)`}</td></tr>))}</tbody></table>
          {isSuper() && (
            <p data-budget-year-form="">연 목표 넣기 <input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value.toUpperCase() })} placeholder="계정(예: EXP_RENT)" size={14} />{' '}
              <input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^0-9]/g, '') })} placeholder="연 금액" size={12} />{' '}
              <select value={f.split} onChange={(e) => setF({ ...f, split: e.target.value })}><option value="EVEN">달마다 똑같이</option><option value="LAST_YEAR">지난해 비율대로</option></select>{' '}
              <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="사유(꼭)" size={16} />{' '}
              <button className="btn-sm" disabled={!f.role || !f.amount || f.reason.trim().length < 2 || a.busy === 'year'} onClick={put}>달로 나눠 넣기</button>
              <small className="dim"> 올해는 이번 달부터 · 지난달까지는 그대로</small></p>
          )}
        </>
      )}
    </div>
  );
}
