/* ===== v10.458 ~ 461 (D262 · docs/596 ~ 599) ㉛ 인사 3 — web/src/app/admin/HrPeople.tsx 새 파일 =====
 * 대표 11/20 「다음개발 ㉛」.
 *   HrTraining   회계 › 인사 › 의무교육     — 종류마다 기간 · 직원별 이수 · 집합 등록 · 제출 확인 · 무효 · 종류 고치기(SUPER)
 *   HrContracts  회계 › 인사 › 근로계약서   — 양식(새 판) · 초안 · 보내기(간주 · 전자계약) · 상태 확인 · 취소 · 서명본 인쇄
 *   HrReviews    회계 › 인사 › 인사 평가    — 분기 차례 · 다음 단계 · 직원별 목표 · 자기 · 상사 점수 · 등급
 *   HrRecruit    회계 › 인사 › 채용         — 공고 · 지원자(서류) · 단계 · 면접 · 합격 → 직원 대장 · 지금 파기
 *   MyHrMore     사무 › 내 인사(아래)       — 의무교육 제출 · 받은 계약서 서명 · 분기 목표 · 자기 평가
 * (adminMenu · App.tsx 연결은 patches/1_wiring.md)
 */
import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { openFile, uploadFile } from '../../lib/files';

const kstDay = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);
const isSuper = () => tokenRoles().includes('SUPER');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const ST_TR: Record<string, string> = { SUBMITTED: '제출', CONFIRMED: '확인', VOID: '무효' };
const ST_BD: Record<string, string> = { DONE: '모두 이수', OVERDUE: '기한 지남', DUE: '기한 가까움', OPEN: '진행' };
const ST_CT: Record<string, string> = { DRAFT: '초안', SENT: '서명 기다림', SIGNED: '서명함', CANCELED: '취소' };
const ST_RV: Record<string, string> = { GOALS: '목표', REVIEW: '평가', CLOSED: '닫음' };
const ST_AP: Record<string, string> = { APPLIED: '지원', SCREEN: '서류', INTERVIEW: '면접', OFFER: '제안', HIRED: '합격', REJECTED: '불합격', WITHDRAWN: '철회' };
const MODE_KO: Record<string, string> = { ASSUME: '간주', STUB: '시험(STUB)', MOCK: '시험(MOCK)', HTTP: '전자계약 업체' };

/* ── 계약서 인쇄(새 창) ── */
interface ContractView { id: string; name: string; title: string; body: string; docHash: string; state: string; signMode: string | null; signedAt: string | null; signerName: string | null; legal: string }
function printContract(c: ContractView) {
  const w = window.open('', '_blank', 'width=760,height=1000');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(c.title)}</title><style>
    body{font-family:sans-serif;margin:24px;color:#111} h1{font-size:20px;text-align:center} pre{white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.7}
    .sig{border-top:1px solid #444;margin-top:16px;padding-top:8px;font-size:12px} @media print{button{display:none}}</style></head><body>
    <h1>${esc(c.title)}</h1><pre>${esc(c.body)}</pre>
    <div class="sig">상태 ${esc(ST_CT[c.state] ?? c.state)} · 서명 ${esc(c.signerName ?? '—')} · ${esc(c.signedAt ? new Date(c.signedAt).toLocaleString('ko-KR') : '—')}<br>
    서명 길 ${esc(MODE_KO[c.signMode ?? ''] ?? '—')} — ${esc(c.legal)}<br>문서 지문(SHA-256) ${esc(c.docHash)}</div>
    <p><button onclick="window.print()">인쇄</button></p></body></html>`);
  w.document.close();
}

/* ── v10.458 의무교육 ── */
interface Kind { code: string; name: string; basis: string | null; cycleMonths: number; minHours: number; active: boolean; sort: number }
interface BoardRow { employeeId: string; name: string; hours: number; pending: number; done: boolean }
interface Board { kind: string; name: string; period: string; dueOn: string; minHours: number; daysLeft: number; state: string; done: number; total: number; rows: BoardRow[] }
interface Pending { id: string; name: string; kindName: string; period: string; doneOn: string; hours: number; provider: string | null; fileId: string | null; note: string | null }
interface Recent { id: string; name: string; kindName: string; period: string; doneOn: string; hours: number; state: string; voidReason: string | null; fileId: string | null }
export function HrTraining() {
  const [year, setYear] = useState(kstDay().slice(0, 4));
  const q = useApi<{ year: number; dueDays: number; kinds: Kind[]; boards: Board[]; pending: Pending[]; recent: Recent[]; note: string }>(`/admin/hr/training?year=${year}`, [year]);
  const a = useAct();
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [f, setF] = useState({ kind: '', doneOn: kstDay(), hours: '1', method: 'CLASS', provider: '', note: '' });
  const [file, setFile] = useState<File | null>(null);
  const [rs, setRs] = useState<Record<string, string>>({});
  const [kd, setKd] = useState<Kind | null>(null);
  const d = q.data;
  const emps = d ? [...new Map(d.boards.flatMap((b) => b.rows).map((r) => [r.employeeId, r.name])).entries()] : [];
  const picked = Object.keys(sel).filter((k) => sel[k]);
  const post = (key: string, path: string, body: unknown) => void a.run(key, () => api(path, { method: 'POST', body: JSON.stringify(body) }), () => q.reload());
  return (
    <section data-hr-training={d ? d.boards.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      <p><label>해 <input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 90 }} /></label></p>
      {d && <p className="muted">{d.note}</p>}
      {d && (
        <table className="tbl" data-hr-boards={d.boards.length}><thead><tr><th>교육</th><th>기간</th><th>기한</th><th>최소</th><th>이수</th><th>상태</th><th>미이수</th></tr></thead>
          <tbody>{d.boards.map((b) => <tr key={`${b.kind}${b.period}`} data-hr-board={b.state}><td>{b.name}</td><td>{b.period}</td><td>{b.dueOn}</td><td>{b.minHours}시간</td>
            <td>{b.done}/{b.total}</td><td className={b.state === 'OVERDUE' || b.state === 'DUE' ? 'warn-text' : ''}>{ST_BD[b.state] ?? b.state}</td>
            <td><small>{b.rows.filter((r) => !r.done).map((r) => `${r.name}(${r.hours}${r.pending ? ' · 제출 ' + r.pending : ''})`).join(', ') || '—'}</small></td></tr>)}</tbody></table>
      )}
      {d && (
        <div className="card pad" data-hr-train-add=""><b>이수 등록(집합 교육 · 여러 명)</b>
          <p>{emps.map(([id, name]) => <label key={id} style={{ marginRight: 8 }}><input type="checkbox" checked={!!sel[id]} onChange={(e) => setSel({ ...sel, [id]: e.target.checked })} /> {name}</label>)}</p>
          <p><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="교육"><option value="">교육 종류</option>{d.kinds.filter((k) => k.active).map((k) => <option key={k.code} value={k.code}>{k.name}</option>)}</select>{' '}
            <input type="date" value={f.doneOn} max={kstDay()} onChange={(e) => setF({ ...f, doneOn: e.target.value })} aria-label="이수일" />{' '}
            <input type="number" step="0.5" min="0.5" max="40" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} style={{ width: 70 }} aria-label="시간" />시간{' '}
            <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="CLASS">집합</option><option value="ONLINE">온라인</option><option value="ETC">그 밖</option></select>{' '}
            <input value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} placeholder="교육 기관" size={14} />{' '}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="증빙" />{' '}
            <button className="btn-sm" disabled={a.busy === 'add' || !f.kind || !picked.length} data-hr-train-save=""
              onClick={() => void a.run('add', async () => {
                const up = file ? await uploadFile(file, 'HR_DOC') : null;
                return api('/admin/hr/training/records', { method: 'POST', body: JSON.stringify({ employeeIds: picked, kind: f.kind, doneOn: f.doneOn, hours: Number(f.hours), method: f.method,
                  ...(f.provider ? { provider: f.provider } : {}), ...(up ? { fileId: up.fileId } : {}), ...(f.note ? { note: f.note } : {}) }) });
              }, () => { setSel({}); setFile(null); q.reload(); })}>등록</button></p>
        </div>
      )}
      {d && !!d.pending.length && (
        <div className="card pad" data-hr-train-pending={d.pending.length}><b>확인 기다리는 제출 {d.pending.length}</b>
          <table className="tbl"><tbody>{d.pending.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.kindName} · {p.period}</td><td>{p.doneOn} · {p.hours}시간</td><td>{p.provider ?? ''}</td>
            <td>{p.fileId && <button className="btn-sm btn-plain" onClick={() => void openFile(p.fileId!)}>증빙</button>}</td>
            <td><input value={rs[p.id] ?? ''} onChange={(e) => setRs({ ...rs, [p.id]: e.target.value })} placeholder="돌려보낼 사유" size={12} />{' '}
              <button className="btn-sm" disabled={a.busy === `c${p.id}`} onClick={() => post(`c${p.id}`, `/admin/hr/training/records/${p.id}/decide`, { decision: 'CONFIRM' })}>확인</button>{' '}
              <button className="btn-sm btn-plain" disabled={a.busy === `r${p.id}` || (rs[p.id] ?? '').trim().length < 2} onClick={() => post(`r${p.id}`, `/admin/hr/training/records/${p.id}/decide`, { decision: 'REJECT', reason: rs[p.id] })}>돌려보냄</button></td></tr>)}</tbody></table>
        </div>
      )}
      {d && !!d.recent.length && (
        <details data-hr-train-recent={d.recent.length}><summary>{d.year} 기록 {d.recent.length}</summary>
          <table className="tbl"><tbody>{d.recent.map((r) => <tr key={r.id}><td>{r.name}</td><td>{r.kindName} · {r.period}</td><td>{r.doneOn} · {r.hours}시간</td>
            <td>{ST_TR[r.state] ?? r.state}{r.voidReason ? <small className="dim"> · {r.voidReason}</small> : ''}</td>
            <td>{r.fileId && <button className="btn-sm btn-plain" onClick={() => void openFile(r.fileId!)}>증빙</button>}</td>
            <td>{r.state === 'CONFIRMED' && <button className="btn-sm btn-plain" disabled={a.busy === `v${r.id}`} onClick={() => { const why = prompt('무효로 하는 사유(2자 이상)'); if (why && why.trim().length >= 2) post(`v${r.id}`, `/admin/hr/training/records/${r.id}/void`, { reason: why }); }}>무효</button>}</td></tr>)}</tbody></table>
        </details>
      )}
      {d && (
        <details data-hr-train-kinds={d.kinds.length}><summary>교육 종류 · 주기(일반 원칙 값{isSuper() ? ' · SUPER 고침' : ''})</summary>
          <table className="tbl"><thead><tr><th>코드</th><th>이름</th><th>주기</th><th>최소</th><th>근거</th><th>쓰기</th><th></th></tr></thead>
            <tbody>{d.kinds.map((k) => <tr key={k.code}><td>{k.code}</td><td>{k.name}</td><td>{k.cycleMonths === 6 ? '반기' : '연'}</td><td>{k.minHours}시간</td><td><small>{k.basis ?? ''}</small></td><td>{k.active ? '씀' : '안 씀'}</td>
              <td>{isSuper() && <button className="btn-sm btn-plain" onClick={() => setKd({ ...k })}>고침</button>}</td></tr>)}</tbody></table>
          {isSuper() && <p><button className="btn-sm btn-plain" onClick={() => setKd({ code: '', name: '', basis: '', cycleMonths: 12, minHours: 1, active: true, sort: 100 })}>종류 더하기</button></p>}
          {kd && (
            <div className="card pad" data-hr-kind-edit={kd.code}>
              <input value={kd.code} onChange={(e) => setKd({ ...kd, code: e.target.value.toUpperCase() })} placeholder="코드(영문 대문자)" size={18} />{' '}
              <input value={kd.name} onChange={(e) => setKd({ ...kd, name: e.target.value })} placeholder="이름" size={22} />{' '}
              <select value={kd.cycleMonths} onChange={(e) => setKd({ ...kd, cycleMonths: Number(e.target.value) })}><option value={12}>연</option><option value={6}>반기</option></select>{' '}
              <input type="number" step="0.5" min="0.5" max="40" value={kd.minHours} onChange={(e) => setKd({ ...kd, minHours: Number(e.target.value) })} style={{ width: 70 }} />시간{' '}
              <input value={kd.basis ?? ''} onChange={(e) => setKd({ ...kd, basis: e.target.value })} placeholder="근거" size={30} />{' '}
              <label><input type="checkbox" checked={kd.active} onChange={(e) => setKd({ ...kd, active: e.target.checked })} /> 씀</label>{' '}
              <button className="btn-sm" disabled={a.busy === 'kd' || !kd.code} onClick={() => void a.run('kd', () => api(`/admin/hr/training/kinds/${encodeURIComponent(kd.code)}`, { method: 'PUT',
                body: JSON.stringify({ name: kd.name, basis: kd.basis ?? '', cycleMonths: kd.cycleMonths, minHours: kd.minHours, active: kd.active }) }), () => { setKd(null); q.reload(); })}>저장</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => setKd(null)}>닫기</button>
            </div>
          )}
        </details>
      )}
    </section>
  );
}

/* ── v10.459 근로계약서 ── */
interface Tpl { id: string; code: string; version: number; name: string; kind: string; body: string; active: boolean; latest: boolean }
interface Ct { id: string; employeeId: string; name: string; title: string; state: string; signMode: string | null; sentAt: string | null; signedAt: string | null; cancelReason: string | null; templateCode: string; templateVersion: number }
const TERM_LABEL: Array<[string, string]> = [['company', '회사'], ['startOn', '시작일'], ['endOn', '끝(비우면 정함 없음)'], ['place', '일하는 곳'], ['duties', '하는 일'], ['workTime', '근로시간'],
  ['breakTime', '휴게'], ['workDays', '근무일'], ['holiday', '주휴일'], ['wageType', '임금 형태'], ['wage', '임금(원)'], ['payDay', '지급일'], ['payMethod', '지급 방법']];
export function HrContracts() {
  const [st, setSt] = useState('');
  const q = useApi<{ items: Ct[]; signMode: string; ready: boolean; employees: Array<{ id: string; name: string; linked: boolean }>; note: string }>(`/admin/hr/contracts${st ? `?state=${st}` : ''}`, [st]);
  const t = useApi<{ items: Tpl[]; note: string }>('/admin/hr/contracts/templates', []);
  const a = useAct();
  const [nc, setNc] = useState<{ employeeId: string; templateId: string; title: string; terms: Record<string, string> }>({ employeeId: '', templateId: '', title: '', terms: { startOn: kstDay(1), payDay: '25', wageType: '월급' } });
  const [nt, setNt] = useState<{ code: string; name: string; body: string } | null>(null);
  const d = q.data;
  const act = (key: string, path: string, body: unknown = {}) => void a.run(key, () => api(path, { method: 'POST', body: JSON.stringify(body) }), () => q.reload());
  const show = (id: string) => void a.run(`p${id}`, async () => { const c = await api<ContractView>(`/admin/hr/contracts/${id}`); printContract(c); return c; }, undefined, () => '계약서를 새 창에 열었습니다.');
  return (
    <section data-hr-contracts={d ? d.items.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && <p className={d.ready ? 'muted' : 'warn-text'} data-hr-sign-mode={d.signMode}>서명 길 <b>{MODE_KO[d.signMode] ?? d.signMode}</b> — {d.note}</p>}
      <p><label>상태 <select value={st} onChange={(e) => setSt(e.target.value)}><option value="">모두</option>{Object.entries(ST_CT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></p>
      {d && (
        <table className="tbl"><thead><tr><th>직원</th><th>제목</th><th>양식</th><th>상태</th><th>서명 길</th><th>서명</th><th></th></tr></thead>
          <tbody>{d.items.map((c) => <tr key={c.id} data-hr-contract={c.state}><td>{c.name}</td><td>{c.title}</td><td>{c.templateCode} {c.templateVersion}판</td>
            <td>{ST_CT[c.state] ?? c.state}{c.cancelReason ? <small className="dim"> · {c.cancelReason}</small> : ''}</td><td>{MODE_KO[c.signMode ?? ''] ?? '—'}</td><td>{c.signedAt ? ymdhm(c.signedAt) : '—'}</td>
            <td><button className="btn-sm btn-plain" onClick={() => show(c.id)}>보기 · 인쇄</button>{' '}
              {c.state === 'DRAFT' && <button className="btn-sm" disabled={a.busy === `s${c.id}`} onClick={() => act(`s${c.id}`, `/admin/hr/contracts/${c.id}/send`)}>보내기</button>}{' '}
              {c.state === 'SENT' && c.signMode === 'HTTP' && <button className="btn-sm btn-plain" disabled={a.busy === `k${c.id}`} onClick={() => act(`k${c.id}`, `/admin/hr/contracts/${c.id}/check`)}>상태 확인</button>}{' '}
              {(c.state === 'DRAFT' || c.state === 'SENT') && <button className="btn-sm btn-plain" disabled={a.busy === `x${c.id}`}
                onClick={() => { const why = prompt('취소 사유(2자 이상)'); if (why && why.trim().length >= 2) act(`x${c.id}`, `/admin/hr/contracts/${c.id}/cancel`, { reason: why }); }}>취소</button>}</td></tr>)}</tbody></table>
      )}
      {d && t.data && (
        <div className="card pad" data-hr-contract-new=""><b>새 계약서(초안)</b>
          <p><select value={nc.employeeId} onChange={(e) => setNc({ ...nc, employeeId: e.target.value })} aria-label="직원"><option value="">직원</option>{d.employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.linked ? '' : ' (계정 연결 없음)'}</option>)}</select>{' '}
            <select value={nc.templateId} onChange={(e) => setNc({ ...nc, templateId: e.target.value })} aria-label="양식"><option value="">양식</option>{t.data.items.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code} {x.version}판)</option>)}</select>{' '}
            <input value={nc.title} onChange={(e) => setNc({ ...nc, title: e.target.value })} placeholder="제목(비우면 양식 이름)" size={20} /></p>
          <p>{TERM_LABEL.map(([k, l]) => <label key={k} style={{ marginRight: 8 }}>{l} <input type={k === 'startOn' || k === 'endOn' ? 'date' : 'text'} value={nc.terms[k] ?? ''} size={k === 'payDay' ? 3 : 14}
            onChange={(e) => setNc({ ...nc, terms: { ...nc.terms, [k]: e.target.value } })} /></label>)}</p>
          <button className="btn-sm" disabled={a.busy === 'nc' || !nc.employeeId || !nc.templateId || !nc.terms.startOn} data-hr-contract-create=""
            onClick={() => void a.run('nc', () => api('/admin/hr/contracts', { method: 'POST', body: JSON.stringify({ employeeId: nc.employeeId, templateId: nc.templateId, ...(nc.title ? { title: nc.title } : {}),
              terms: Object.fromEntries(Object.entries(nc.terms).filter(([, v]) => String(v).trim() !== '')) }) }), () => q.reload())}>초안 만들기</button>
        </div>
      )}
      {t.data && (
        <details data-hr-templates={t.data.items.length}><summary>양식 {t.data.items.length}</summary>
          <p className="muted">{t.data.note}</p>
          <table className="tbl"><tbody>{t.data.items.map((x) => <tr key={x.id}><td>{x.code} {x.version}판</td><td>{x.name}</td><td>{x.active ? '씀' : '안 씀'}</td>
            <td>{x.latest && <button className="btn-sm btn-plain" onClick={() => setNt({ code: x.code, name: x.name, body: x.body })}>새 판으로 고치기</button>}</td></tr>)}</tbody></table>
          <p><button className="btn-sm btn-plain" onClick={() => setNt({ code: '', name: '', body: '' })}>새 양식</button></p>
          {nt && (
            <div className="card pad" data-hr-template-edit={nt.code}>
              <input value={nt.code} onChange={(e) => setNt({ ...nt, code: e.target.value.toUpperCase() })} placeholder="코드" size={14} />{' '}
              <input value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} placeholder="이름" size={30} />
              <p><textarea value={nt.body} onChange={(e) => setNt({ ...nt, body: e.target.value })} rows={14} style={{ width: '100%' }} aria-label="본문" /></p>
              <button className="btn-sm" disabled={a.busy === 'nt' || !nt.code || nt.body.length < 20} onClick={() => void a.run('nt', () => api('/admin/hr/contracts/templates', { method: 'POST', body: JSON.stringify(nt) }), () => { setNt(null); t.reload(); })}>새 판 저장</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => setNt(null)}>닫기</button>
            </div>
          )}
        </details>
      )}
    </section>
  );
}

/* ── v10.460 인사 평가 ── */
interface Goal { id: string; title: string; measure: string | null; weight: number; selfScore: number | null; selfNote: string | null; mgrScore: number | null; mgrNote: string | null }
interface Cyc { id: string; year: number; quarter: number; title: string; state: string; goalDue: string | null; reviewDue: string | null; withGoals?: number; selfDone?: number; graded?: number }
interface Person { employeeId: string; name: string; goals: Goal[]; weightSum: number; selfAvg: number | null; mgrAvg: number | null; suggested: string | null;
  result: { selfComment: string | null; selfSubmittedAt: string | null; mgrComment: string | null; grade: string | null } | null }
export function HrReviews() {
  const q = useApi<{ items: Cyc[]; grades: string[]; note: string }>('/admin/hr/reviews', []);
  const [cid, setCid] = useState('');
  const dq = useApi<{ cycle: Cyc; people: Person[]; grades: string[] } | null>(cid ? `/admin/hr/reviews/${cid}` : '/admin/hr/reviews', [cid]);
  const a = useAct();
  const now = kstDay();
  const [nc, setNc] = useState({ year: Number(now.slice(0, 4)), quarter: Math.floor((Number(now.slice(5, 7)) - 1) / 3) + 1 });
  const [mg, setMg] = useState<Record<string, { scores: Record<string, number>; comment: string; grade: string }>>({});
  const d = q.data;
  const det = cid && dq.data && 'people' in dq.data ? dq.data : null;
  return (
    <section data-hr-reviews={d ? d.items.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && <p className="muted">{d.note}</p>}
      <p><input type="number" min={2000} max={2100} value={nc.year} onChange={(e) => setNc({ ...nc, year: Number(e.target.value) })} style={{ width: 90 }} aria-label="해" />년{' '}
        <select value={nc.quarter} onChange={(e) => setNc({ ...nc, quarter: Number(e.target.value) })} aria-label="분기">{[1, 2, 3, 4].map((x) => <option key={x} value={x}>{x}분기</option>)}</select>{' '}
        <button className="btn-sm" disabled={a.busy === 'nc'} data-hr-cycle-create="" onClick={() => void a.run('nc', () => api('/admin/hr/reviews', { method: 'POST', body: JSON.stringify(nc) }), () => q.reload())}>평가 차례 만들기</button></p>
      {d && (
        <table className="tbl"><thead><tr><th>차례</th><th>상태</th><th>목표 적음</th><th>자기 평가</th><th>등급</th><th></th></tr></thead>
          <tbody>{d.items.map((c) => <tr key={c.id} data-hr-cycle={c.state}><td><button className="btn-sm btn-plain" onClick={() => setCid(c.id)}>{c.title}</button></td><td>{ST_RV[c.state] ?? c.state}</td>
            <td>{c.withGoals}</td><td>{c.selfDone}</td><td>{c.graded}</td>
            <td>{c.state !== 'CLOSED' && <button className="btn-sm" disabled={a.busy === `a${c.id}`}
              onClick={() => { if (confirm(c.state === 'GOALS' ? '평가 단계로 넘길까요? 목표는 더 못 고칩니다.' : '차례를 닫을까요? 닫으면 못 고치고 직원에게 결과가 보입니다.')) void a.run(`a${c.id}`, () => api(`/admin/hr/reviews/${c.id}/advance`, { method: 'POST', body: '{}' }), () => { q.reload(); dq.reload(); }); }}>
              {c.state === 'GOALS' ? '평가 단계로' : '닫기'}</button>}</td></tr>)}</tbody></table>
      )}
      {det && (
        <div data-hr-cycle-detail={det.people.length}>
          <h3>{det.cycle.title} · {ST_RV[det.cycle.state]}</h3>
          {det.people.map((p) => {
            const m = mg[p.employeeId] ?? { scores: {}, comment: '', grade: '' };
            return (
              <div key={p.employeeId} className="card pad" data-hr-person={p.employeeId}>
                <b>{p.name}</b> <small className="dim">목표 {p.goals.length} · 가중치 {p.weightSum} · 자기 {p.selfAvg ?? '—'} · 상사 {p.mgrAvg ?? '—'} · 제안 {p.suggested ?? '—'} · 등급 {p.result?.grade ?? '—'}
                  {p.result?.selfSubmittedAt ? ' · 자기 평가 제출' : ''}</small>
                <table className="tbl"><tbody>{p.goals.map((g) => <tr key={g.id}><td>{g.title}<br /><small className="dim">{g.measure ?? ''}</small></td><td>{g.weight}</td>
                  <td>자기 {g.selfScore ?? '—'}{g.selfNote ? <small className="dim"> · {g.selfNote}</small> : ''}</td>
                  <td>상사 {det.cycle.state === 'REVIEW'
                    ? <select value={m.scores[g.id] ?? g.mgrScore ?? ''} onChange={(e) => setMg({ ...mg, [p.employeeId]: { ...m, scores: { ...m.scores, [g.id]: Number(e.target.value) } } })} aria-label="상사 점수">
                        <option value="">—</option>{[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>{s}</option>)}</select>
                    : (g.mgrScore ?? '—')}</td></tr>)}</tbody></table>
                {p.result?.selfComment && <p><small>자기 의견: {p.result.selfComment}</small></p>}
                {det.cycle.state === 'REVIEW' && !!p.goals.length && (
                  <p><input value={m.comment} onChange={(e) => setMg({ ...mg, [p.employeeId]: { ...m, comment: e.target.value } })} placeholder={p.result?.mgrComment ?? '상사 의견'} size={30} />{' '}
                    <select value={m.grade} onChange={(e) => setMg({ ...mg, [p.employeeId]: { ...m, grade: e.target.value } })} aria-label="등급"><option value="">등급(나중에)</option>{det.grades.map((g) => <option key={g} value={g}>{g}</option>)}</select>{' '}
                    <button className="btn-sm" disabled={a.busy === `m${p.employeeId}`} data-hr-mgr-save={p.employeeId}
                      onClick={() => void a.run(`m${p.employeeId}`, () => api(`/admin/hr/reviews/${det.cycle.id}/employees/${p.employeeId}`, { method: 'PUT', body: JSON.stringify({
                        scores: Object.entries(m.scores).filter(([, s]) => s >= 1).map(([goalId, score]) => ({ goalId, score })), ...(m.comment ? { comment: m.comment } : {}), ...(m.grade ? { grade: m.grade } : {}) }) }),
                        () => { setMg({ ...mg, [p.employeeId]: { scores: {}, comment: '', grade: '' } }); dq.reload(); q.reload(); })}>상사 평가 저장</button></p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ── v10.461 채용 ── */
interface Posting { id: string; title: string; dept: string | null; empType: string; opensOn: string; closesOn: string; state: string; stages: Record<string, number> }
interface Applicant { id: string; name: string; email: string | null; phone: string | null; source: string; memo: string | null; fileIds: string[]; stage: string; decideNote: string | null; employeeId: string | null; purgeDueOn: string | null; purgedAt: string | null }
interface Iv { id: string; applicantId: string; name?: string; postingTitle?: string; at: string; place: string | null; interviewers: string | null; result: string | null; note?: string | null }
export function HrRecruit() {
  const q = useApi<{ postings: Posting[]; interviews: Iv[]; purge: { waiting: number; nextOn: string | null; purged: number; retentionDays: number }; note: string }>('/admin/hr/recruit', []);
  const [pid, setPid] = useState('');
  const dq = useApi<{ posting: Posting; applicants: Applicant[]; interviews: Iv[] } | null>(pid ? `/admin/hr/recruit/postings/${pid}` : '/admin/hr/recruit', [pid]);
  const a = useAct();
  const [np, setNp] = useState({ title: '', dept: '', empType: 'REGULAR', opensOn: kstDay(), closesOn: kstDay(30) });
  const [na, setNa] = useState({ name: '', email: '', phone: '', source: 'DIRECT', memo: '' });
  const [files, setFiles] = useState<FileList | null>(null);
  const [iv, setIv] = useState<Record<string, string>>({});
  const d = q.data;
  const det = pid && dq.data && 'applicants' in dq.data ? dq.data : null;
  const reload = () => { q.reload(); dq.reload(); };
  const post = (key: string, path: string, body: unknown) => void a.run(key, () => api(path, { method: 'POST', body: JSON.stringify(body) }), reload);
  return (
    <section data-hr-recruit={d ? d.postings.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && <p className="muted">{d.note} 파기 기다림 {d.purge.waiting}{d.purge.nextOn ? ` · 다음 ${d.purge.nextOn}` : ''} · 지금까지 파기 {d.purge.purged}</p>}
      <div className="card pad" data-hr-posting-new=""><b>새 공고</b>{' '}
        <input value={np.title} onChange={(e) => setNp({ ...np, title: e.target.value })} placeholder="제목" size={20} />{' '}
        <input value={np.dept} onChange={(e) => setNp({ ...np, dept: e.target.value })} placeholder="부서" size={8} />{' '}
        <select value={np.empType} onChange={(e) => setNp({ ...np, empType: e.target.value })}><option value="REGULAR">정규</option><option value="FIXED_TERM">계약</option><option value="PART_TIME">시간제</option><option value="INTERN">인턴</option></select>{' '}
        <input type="date" value={np.opensOn} onChange={(e) => setNp({ ...np, opensOn: e.target.value })} aria-label="시작" /> ~ <input type="date" value={np.closesOn} onChange={(e) => setNp({ ...np, closesOn: e.target.value })} aria-label="마감" />{' '}
        <button className="btn-sm" disabled={a.busy === 'np' || np.title.trim().length < 2} onClick={() => post('np', '/admin/hr/recruit/postings', { ...np, ...(np.dept ? {} : { dept: undefined }), state: 'OPEN' })}>열기</button></div>
      {d && (
        <table className="tbl"><thead><tr><th>공고</th><th>기간</th><th>상태</th><th>지원자</th><th></th></tr></thead>
          <tbody>{d.postings.map((p) => <tr key={p.id} data-hr-posting={p.state}><td><button className="btn-sm btn-plain" onClick={() => setPid(p.id)}>{p.title}</button>{p.dept ? <small className="dim"> · {p.dept}</small> : ''}</td>
            <td>{p.opensOn} ~ {p.closesOn}</td><td>{p.state === 'OPEN' ? '모집 중' : p.state === 'DRAFT' ? '초안' : '마감'}</td>
            <td><small>{Object.entries(p.stages ?? {}).map(([k, v]) => `${ST_AP[k] ?? k} ${v}`).join(' · ') || '—'}</small></td>
            <td>{p.state !== 'CLOSED' && <button className="btn-sm btn-plain" disabled={a.busy === `c${p.id}`} onClick={() => void a.run(`c${p.id}`, () => api(`/admin/hr/recruit/postings/${p.id}`, { method: 'PUT', body: JSON.stringify({ state: p.state === 'DRAFT' ? 'OPEN' : 'CLOSED' }) }), reload)}>{p.state === 'DRAFT' ? '열기' : '마감'}</button>}</td></tr>)}</tbody></table>
      )}
      {d && !!d.interviews.length && (
        <details open data-hr-interviews={d.interviews.length}><summary>다가오는 면접 {d.interviews.length}</summary>
          <table className="tbl"><tbody>{d.interviews.map((x) => <tr key={x.id}><td>{ymdhm(x.at)}</td><td>{x.name} · {x.postingTitle}</td><td>{x.place ?? ''}</td><td>{x.interviewers ?? ''}</td><td>{x.result ?? ''}</td></tr>)}</tbody></table>
        </details>
      )}
      {det && (
        <div className="card pad" data-hr-applicants={det.applicants.length}><b>{det.posting.title} — 지원자 {det.applicants.length}</b>
          {det.posting.state !== 'DRAFT' && (
            <p data-hr-applicant-new=""><input value={na.name} onChange={(e) => setNa({ ...na, name: e.target.value })} placeholder="이름" size={8} />{' '}
              <input value={na.email} onChange={(e) => setNa({ ...na, email: e.target.value })} placeholder="메일" size={18} />{' '}
              <input value={na.phone} onChange={(e) => setNa({ ...na, phone: e.target.value })} placeholder="휴대폰" size={12} />{' '}
              <select value={na.source} onChange={(e) => setNa({ ...na, source: e.target.value })}><option value="DIRECT">직접</option><option value="JOBSITE">채용 사이트</option><option value="REFERRAL">추천</option><option value="ETC">그 밖</option></select>{' '}
              <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFiles(e.target.files)} aria-label="서류(3개)" />{' '}
              <button className="btn-sm" disabled={a.busy === 'na' || !na.name.trim() || (!na.email.trim() && !na.phone.trim())}
                onClick={() => void a.run('na', async () => {
                  const ups: string[] = [];
                  for (const fl of Array.from(files ?? []).slice(0, 3)) ups.push((await uploadFile(fl, 'HR_DOC')).fileId);
                  return api('/admin/hr/recruit/applicants', { method: 'POST', body: JSON.stringify({ postingId: det.posting.id, name: na.name, source: na.source, ...(na.email ? { email: na.email } : {}),
                    ...(na.phone ? { phone: na.phone } : {}), ...(na.memo ? { memo: na.memo } : {}), fileIds: ups }) });
                }, () => { setNa({ name: '', email: '', phone: '', source: 'DIRECT', memo: '' }); setFiles(null); reload(); })}>지원자 넣기</button></p>
          )}
          <table className="tbl"><thead><tr><th>이름</th><th>연락처</th><th>서류</th><th>단계</th><th>면접</th><th></th></tr></thead>
            <tbody>{det.applicants.map((p) => {
              const end = ['HIRED', 'REJECTED', 'WITHDRAWN'].includes(p.stage);
              return <tr key={p.id} data-hr-applicant={p.stage}><td>{p.name}</td><td><small>{p.email ?? ''} {p.phone ?? ''}</small></td>
                <td>{p.fileIds.map((f, i) => <button key={f} className="btn-sm btn-plain" onClick={() => void openFile(f)}>서류 {i + 1}</button>)}</td>
                <td>{ST_AP[p.stage] ?? p.stage}{p.purgeDueOn && !p.purgedAt ? <small className="dim"> · 파기 {p.purgeDueOn}</small> : ''}{p.purgedAt ? <small className="dim"> · 파기함</small> : ''}{p.employeeId ? <small> · 직원 {p.employeeId}</small> : ''}</td>
                <td><small>{det.interviews.filter((x) => x.applicantId === p.id).map((x) => `${ymdhm(x.at)}${x.result ? ' ' + x.result : ''}`).join(', ')}</small>
                  {!end && <><br /><input type="datetime-local" value={iv[p.id] ?? ''} onChange={(e) => setIv({ ...iv, [p.id]: e.target.value })} aria-label="면접 시각" />{' '}
                    <button className="btn-sm btn-plain" disabled={!iv[p.id] || a.busy === `i${p.id}`} onClick={() => post(`i${p.id}`, `/admin/hr/recruit/applicants/${p.id}/interviews`, { at: `${iv[p.id]}:00+09:00` })}>면접 잡기</button></>}</td>
                <td>{!end && <>
                  <select defaultValue="" onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) post(`s${p.id}`, `/admin/hr/recruit/applicants/${p.id}/stage`, { stage: v }); }} aria-label="단계">
                    <option value="">단계 바꾸기</option>{['SCREEN', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'].map((s) => <option key={s} value={s}>{ST_AP[s]}</option>)}</select>{' '}
                  <button className="btn-sm" disabled={a.busy === `h${p.id}`} onClick={() => { const j = prompt('입사일(YYYY-MM-DD)', kstDay(14)); if (j) { const b = prompt('월 기본급(원 · 나중에 급여에서 고쳐도 됨)', '0'); post(`h${p.id}`, `/admin/hr/recruit/applicants/${p.id}/hire`, { joinedOn: j, monthlyBase: Number(b || 0) }); } }}>합격 → 직원 대장</button></>}
                  {(p.stage === 'REJECTED' || p.stage === 'WITHDRAWN') && !p.purgedAt && <button className="btn-sm btn-plain" disabled={a.busy === `x${p.id}`}
                    onClick={() => { if (confirm('지금 파기할까요? 서류 · 연락처가 지워지고 되돌릴 수 없습니다.')) post(`x${p.id}`, `/admin/hr/recruit/applicants/${p.id}/purge`, {}); }}>지금 파기</button>}</td></tr>;
            })}</tbody></table>
        </div>
      )}
    </section>
  );
}

/* ── 사무 › 내 인사(아래) — 의무교육 · 근로계약서 · 평가 ── */
interface MyMore { linked: boolean; note?: string; employee?: { id: string; name: string };
  training?: { items: Array<{ kind: string; name: string; period: string; dueOn: string; minHours: number; hours: number; pending: number; done: boolean }>;
    records: Array<{ id: string; kindName: string; period: string; doneOn: string; hours: number; state: string; voidReason: string | null }> };
  contracts?: Array<{ id: string; title: string; state: string; signMode: string | null; sentAt: string | null; signedAt: string | null; signUrl: string | null }>;
  reviews?: Array<{ cycle: Cyc; goals: Goal[]; selfAvg: number | null; result: { selfComment: string | null; selfSubmittedAt: string | null; mgrComment: string | null; mgrAvg: number | null; grade: string | null } | null }> }
export function MyHrMore() {
  const q = useApi<MyMore>('/admin/me/hr/more', []);
  const a = useAct();
  const [tr, setTr] = useState({ kind: '', doneOn: kstDay(), hours: '1', provider: '' });
  const [tf, setTf] = useState<File | null>(null);
  const [sig, setSig] = useState<{ c: ContractView; name: string; agree: boolean } | null>(null);
  const [gd, setGd] = useState<Record<string, Array<{ title: string; measure: string; weight: number }>>>({});
  const [sf, setSf] = useState<Record<string, { scores: Record<string, number>; comment: string }>>({});
  const d = q.data;
  if (!d || !d.linked) return null;
  return (
    <section data-my-hr-more={d.employee?.id ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d.training && (
        <div className="card pad" data-my-training={d.training.items.filter((x) => !x.done).length}><b>법정 의무교육</b>
          <table className="tbl"><tbody>{d.training.items.map((x) => <tr key={x.kind}><td>{x.name}</td><td>{x.period} · 기한 {x.dueOn}</td><td>{x.hours}/{x.minHours}시간</td>
            <td className={x.done ? '' : 'warn-text'}>{x.done ? '이수' : x.pending ? `확인 기다림 ${x.pending}` : '미이수'}</td></tr>)}</tbody></table>
          <p><select value={tr.kind} onChange={(e) => setTr({ ...tr, kind: e.target.value })} aria-label="교육"><option value="">교육</option>{d.training.items.map((x) => <option key={x.kind} value={x.kind}>{x.name}</option>)}</select>{' '}
            <input type="date" value={tr.doneOn} max={kstDay()} onChange={(e) => setTr({ ...tr, doneOn: e.target.value })} aria-label="이수일" />{' '}
            <input type="number" step="0.5" min="0.5" max="40" value={tr.hours} onChange={(e) => setTr({ ...tr, hours: e.target.value })} style={{ width: 70 }} aria-label="시간" />시간{' '}
            <input value={tr.provider} onChange={(e) => setTr({ ...tr, provider: e.target.value })} placeholder="교육 기관" size={12} />{' '}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setTf(e.target.files?.[0] ?? null)} aria-label="이수증" />{' '}
            <button className="btn-sm" disabled={a.busy === 'tr' || !tr.kind || !tf} data-my-training-submit=""
              onClick={() => void a.run('tr', async () => {
                const up = await uploadFile(tf!, 'HR_DOC');
                return api('/admin/me/hr/training', { method: 'POST', body: JSON.stringify({ kind: tr.kind, doneOn: tr.doneOn, hours: Number(tr.hours), ...(tr.provider ? { provider: tr.provider } : {}), fileId: up.fileId }) });
              }, () => { setTf(null); q.reload(); })}>이수 제출</button></p>
          {!!d.training.records.length && <details><summary>내 이수 기록 {d.training.records.length}</summary>
            <table className="tbl"><tbody>{d.training.records.map((r) => <tr key={r.id}><td>{r.kindName} · {r.period}</td><td>{r.doneOn} · {r.hours}시간</td><td>{ST_TR[r.state] ?? r.state}{r.voidReason ? <small className="dim"> · {r.voidReason}</small> : ''}</td></tr>)}</tbody></table></details>}
        </div>
      )}
      {!!d.contracts?.length && (
        <div className="card pad" data-my-contracts={d.contracts.length}><b>근로계약서</b>
          <table className="tbl"><tbody>{d.contracts.map((c) => <tr key={c.id} data-my-contract={c.state}><td>{c.title}</td><td>{ST_CT[c.state] ?? c.state}</td><td>{c.signedAt ? ymdhm(c.signedAt) : ''}</td>
            <td><button className="btn-sm btn-plain" onClick={() => void a.run(`v${c.id}`, async () => { const v = await api<ContractView>(`/admin/me/hr/contracts/${c.id}`); if (c.state === 'SENT' && v.signMode !== 'HTTP') setSig({ c: v, name: '', agree: false }); else printContract(v); return v; }, undefined, () => (c.state === 'SENT' ? '계약서를 열었습니다.' : '서명본을 새 창에 열었습니다.'))}>
              {c.state === 'SENT' && c.signMode !== 'HTTP' ? '읽고 서명' : '보기 · 인쇄'}</button>{c.state === 'SENT' && c.signMode === 'HTTP' && c.signUrl && <a href={c.signUrl} target="_blank" rel="noreferrer"> 업체 화면에서 서명</a>}</td></tr>)}</tbody></table>
          {sig && (
            <div className="card pad" data-my-sign={sig.c.id}>
              <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}>{sig.c.body}</pre>
              <p className="warn-text"><small>{sig.c.legal}</small></p>
              <label><input type="checkbox" checked={sig.agree} onChange={(e) => setSig({ ...sig, agree: e.target.checked })} /> 내용을 읽고 동의합니다</label>{' '}
              <input value={sig.name} onChange={(e) => setSig({ ...sig, name: e.target.value })} placeholder="서명(이름)" size={10} aria-label="서명 이름" />{' '}
              <button className="btn-sm" disabled={a.busy === 'sg' || !sig.agree || !sig.name.trim()} data-my-sign-go=""
                onClick={() => void a.run('sg', () => api(`/admin/me/hr/contracts/${sig.c.id}/sign`, { method: 'POST', body: JSON.stringify({ signerName: sig.name, agree: true, docHash: sig.c.docHash }) }), () => { setSig(null); q.reload(); })}>서명</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => setSig(null)}>닫기</button>
            </div>
          )}
        </div>
      )}
      {!!d.reviews?.length && (
        <div className="card pad" data-my-reviews={d.reviews.length}><b>분기 목표 · 평가</b>
          {d.reviews.map((r) => {
            const cid = r.cycle.id;
            const draft = gd[cid] ?? r.goals.map((g) => ({ title: g.title, measure: g.measure ?? '', weight: g.weight }));
            const sum = draft.reduce((s, g) => s + (Number(g.weight) || 0), 0);
            const s = sf[cid] ?? { scores: {}, comment: '' };
            return (
              <div key={cid} data-my-cycle={r.cycle.state}>
                <p><b>{r.cycle.title}</b> <small className="dim">{ST_RV[r.cycle.state]}{r.result?.grade ? ` · 등급 ${r.result.grade} · 상사 평균 ${r.result.mgrAvg ?? '—'}` : ''}</small></p>
                {r.cycle.state === 'GOALS' ? (
                  <div>
                    {draft.map((g, i) => <p key={i}><input value={g.title} onChange={(e) => setGd({ ...gd, [cid]: draft.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} placeholder="목표" size={24} />{' '}
                      <input value={g.measure} onChange={(e) => setGd({ ...gd, [cid]: draft.map((x, j) => (j === i ? { ...x, measure: e.target.value } : x)) })} placeholder="재는 법" size={16} />{' '}
                      <input type="number" min={1} max={100} value={g.weight} onChange={(e) => setGd({ ...gd, [cid]: draft.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)) })} style={{ width: 64 }} aria-label="가중치" />{' '}
                      <button className="btn-sm btn-plain" onClick={() => setGd({ ...gd, [cid]: draft.filter((_, j) => j !== i) })}>빼기</button></p>)}
                    <p><button className="btn-sm btn-plain" disabled={draft.length >= 10} onClick={() => setGd({ ...gd, [cid]: [...draft, { title: '', measure: '', weight: 0 }] })}>목표 더하기</button>{' '}
                      <small className={sum === 100 ? 'dim' : 'warn-text'}>가중치 합 {sum}/100</small>{' '}
                      <button className="btn-sm" disabled={a.busy === `g${cid}` || sum !== 100 || !draft.length} data-my-goals-save={cid}
                        onClick={() => void a.run(`g${cid}`, () => api(`/admin/me/hr/reviews/${cid}/goals`, { method: 'PUT', body: JSON.stringify({ goals: draft.map((g) => ({ title: g.title, weight: g.weight, ...(g.measure ? { measure: g.measure } : {}) })) }) }), () => q.reload())}>목표 저장</button></p>
                  </div>
                ) : (
                  <table className="tbl"><tbody>{r.goals.map((g) => <tr key={g.id}><td>{g.title}</td><td>{g.weight}</td>
                    <td>자기 {r.cycle.state === 'REVIEW' && !r.result?.selfSubmittedAt
                      ? <select value={s.scores[g.id] ?? g.selfScore ?? ''} onChange={(e) => setSf({ ...sf, [cid]: { ...s, scores: { ...s.scores, [g.id]: Number(e.target.value) } } })} aria-label="자기 점수">
                          <option value="">—</option>{[1, 2, 3, 4, 5].map((x) => <option key={x} value={x}>{x}</option>)}</select>
                      : (g.selfScore ?? '—')}</td><td>{r.cycle.state === 'CLOSED' ? `상사 ${g.mgrScore ?? '—'}` : ''}</td></tr>)}</tbody></table>
                )}
                {r.cycle.state === 'REVIEW' && !r.result?.selfSubmittedAt && !!r.goals.length && (
                  <p><input value={s.comment} onChange={(e) => setSf({ ...sf, [cid]: { ...s, comment: e.target.value } })} placeholder={r.result?.selfComment ?? '자기 평가 의견'} size={30} />{' '}
                    {[false, true].map((submit) => <button key={String(submit)} className={submit ? 'btn-sm' : 'btn-sm btn-plain'} disabled={a.busy === `s${cid}`} data-my-self={submit ? 'submit' : 'save'}
                      onClick={() => { if (submit && !confirm('제출하면 고칠 수 없습니다. 제출할까요?')) return; void a.run(`s${cid}`, () => api(`/admin/me/hr/reviews/${cid}/self`, { method: 'POST', body: JSON.stringify({
                        scores: Object.entries(s.scores).filter(([, v]) => v >= 1).map(([goalId, score]) => ({ goalId, score })), ...(s.comment ? { comment: s.comment } : {}), submit }) }), () => { setSf({ ...sf, [cid]: { scores: {}, comment: '' } }); q.reload(); }); }}>
                      {submit ? '제출' : '저장'}</button>)}</p>
                )}
                {r.cycle.state === 'CLOSED' && r.result?.mgrComment && <p><small>상사 의견: {r.result.mgrComment}</small></p>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
