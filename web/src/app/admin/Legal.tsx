/* ===== v10.486 ~ 489 (D269 · docs/624 ~ 627) ㊴ 법무 — web/src/app/admin/Legal.tsx 새 파일 =====
 * 대표 11/20 「지금 바로 동시 착수」.
 *   LglLicenses   사무 › 인허가        — 회사 인허가 · 신고 · 다음 갱신일 · 갱신 기록 · 끝냄 · 종류(SUPER) · 다가오는 법무 기한
 *   LglReviews    사무 › 계약 검토     — 요청(계약서 파일) · 검토 의견 · 승인 · 반려(SUPER) · 취소 · 계약 대장 연결
 *   LglCases      사무 › 소송 · 분쟁   — 사건 · 기일(끝남 · 취소) · 비용(경비 청구 · 매입 연결) · 결과
 *   LglInsurance  사무 › 회사 보험     — 증권 · 만기 · 갱신 · 달마다 전표 계획 · 보험료 전표 초안(지급 담당 · SUPER)
 * 파일은 법무 전용 파일 용도 LGL_DOC(올림 SUPER · ADMIN). 글자 12 · 13 · 14 · 모서리 · 색은 기존 클래스만(# 색 없음 · 어두운 테마 그대로).
 * (adminMenu · App.tsx 연결은 patches/1_wiring.md)
 */
import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { openFile, uploadFile } from '../../lib/files';

const kstDay = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);
const roles = () => tokenRoles();
const isSuper = () => roles().includes('SUPER');
const canUpload = () => roles().some((r) => r === 'SUPER' || r === 'ADMIN');
const post = (path: string, body: unknown) => api(path, { method: 'POST', body: JSON.stringify(body) });
const put = (path: string, body: unknown) => api(path, { method: 'PUT', body: JSON.stringify(body) });
async function uploadAll(files: File[]): Promise<string[]> {
  const ids: string[] = [];
  for (const f of files) ids.push((await uploadFile(f, 'LGL_DOC')).fileId);
  return ids;
}
function FileButtons({ ids }: { ids: string[] | null | undefined }) {
  if (!ids?.length) return <>—</>;
  return <>{ids.map((id, i) => <button key={id} className="btn-sm btn-plain" onClick={() => void openFile(id)}>서류 {i + 1}</button>)}</>;
}
function FilePick({ onPick, max, tag }: { onPick: (f: File[]) => void; max: number; tag: string }) {
  return <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg" data-lgl-file={tag} aria-label="서류"
    onChange={(e) => onPick(Array.from(e.target.files ?? []).slice(0, max))} />;
}
const left = (d: number | null | undefined) => (d == null ? '' : d < 0 ? `${-d}일 지남` : `${d}일 남음`);

/* ── 다가오는 법무 기한(인허가 탭 위) ── */
interface DueItem { key: string; kind: string; title: string; day: string; time: string | null; tab: string; overdue: boolean }
function LglDueBox() {
  const q = useApi<{ items: DueItem[]; overdue: number; note: string }>('/admin/legal/due?days=60', []);
  const d = q.data;
  if (!d) return null;
  return (
    <details className="card pad" data-lgl-due={d.items.length} open={d.overdue > 0}>
      <summary>다가오는 법무 기한 {d.items.length}{d.overdue ? <span className="warn-text"> · 지남 {d.overdue}</span> : ''}</summary>
      <p className="muted">{d.note}</p>
      <table className="tbl"><tbody>{d.items.map((x) => <tr key={x.key}><td>{x.day}{x.time ? ` ${x.time}` : ''}</td><td className={x.overdue ? 'warn-text' : ''}>{x.title}</td>
        <td><a href={`#/${x.tab}`}>열기</a></td></tr>)}</tbody></table>
    </details>
  );
}

/* ── v10.486 인허가 ── */
interface Kind { code: string; name: string; authority: string | null; cycleMonths: number | null; basis: string | null; active: boolean; sort: number }
interface Lic { id: string; kind: string; kindName: string; title: string; licenseRef: string | null; authority: string | null; registeredOn: string | null; cycleMonths: number | null;
  nextDueOn: string | null; ownerName: string | null; fileIds: string[]; memo: string | null; state: string; closeReason: string | null; lastDoneOn: string | null; daysLeft: number | null; overdue: boolean; stage: number | null }
interface LicBoard { items: Lic[]; kinds: Kind[]; alertDays: number[]; count: { active: number; due: number; overdue: number }; note: string }
export function LglLicenses() {
  const [state, setState] = useState('ACTIVE');
  const q = useApi<LicBoard>(`/admin/legal/licenses?state=${state}`, [state]);
  const a = useAct();
  const blank = { kind: 'MAIL_ORDER', title: '', licenseRef: '', authority: '', registeredOn: '', nextDueOn: '', memo: '' };
  const [f, setF] = useState(blank);
  const [files, setFiles] = useState<File[]>([]);
  const [rn, setRn] = useState<{ id: string; doneOn: string; nextDueOn: string; note: string } | null>(null);
  const [kd, setKd] = useState<Kind | null>(null);
  const d = q.data;
  const add = () => void a.run('add', async () => {
    const fileIds = await uploadAll(files);
    const body: Record<string, unknown> = { kind: f.kind, fileIds };
    for (const k of ['title', 'licenseRef', 'authority', 'registeredOn', 'nextDueOn', 'memo'] as const) if (f[k].trim()) body[k] = f[k].trim();
    return post('/admin/legal/licenses', body);
  }, () => { setF(blank); setFiles([]); q.reload(); });
  const renew = () => rn && void a.run(`r${rn.id}`, async () => {
    const fileIds = await uploadAll(files);
    return post(`/admin/legal/licenses/${rn.id}/renew`, { doneOn: rn.doneOn, ...(rn.nextDueOn ? { nextDueOn: rn.nextDueOn } : {}), ...(rn.note ? { note: rn.note } : {}), fileIds });
  }, () => { setRn(null); setFiles([]); q.reload(); });
  const close = (id: string) => { const reason = prompt('끝내는 사유(폐업 · 반납 등 · 되돌리지 않음)'); if (reason && reason.trim().length >= 2) void a.run(`c${id}`, () => post(`/admin/legal/licenses/${id}/close`, { reason }), q.reload); };
  return (
    <section data-lgl-licenses={d ? d.items.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      <LglDueBox />
      {d && (
        <>
          <p className="muted">{d.note}</p>
          <p>유효 {d.count.active} · <span className={d.count.due ? 'warn-text' : ''}>알림 차례 {d.count.due}</span> · 갱신일 지남 {d.count.overdue}{' '}
            <button className="btn-sm btn-plain" onClick={() => setState(state === 'ACTIVE' ? 'CLOSED' : 'ACTIVE')}>{state === 'ACTIVE' ? '끝낸 것 보기' : '유효한 것 보기'}</button></p>
          <div className="card pad" data-lgl-license-form="">
            <b>인허가 넣기</b><br />
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="종류">{d.kinds.filter((k) => k.active).map((k) => <option key={k.code} value={k.code}>{k.name}{k.cycleMonths ? ` · ${k.cycleMonths}달` : ''}</option>)}</select>{' '}
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="이름(비우면 종류 이름)" size={20} />{' '}
            <input value={f.licenseRef} onChange={(e) => setF({ ...f, licenseRef: e.target.value })} placeholder="신고 · 등록 번호" size={16} />{' '}
            <input value={f.authority} onChange={(e) => setF({ ...f, authority: e.target.value })} placeholder="기관" size={12} />{' '}
            <label>신고일 <input type="date" value={f.registeredOn} onChange={(e) => setF({ ...f, registeredOn: e.target.value })} /></label>{' '}
            <label>다음 갱신일 <input type="date" value={f.nextDueOn} onChange={(e) => setF({ ...f, nextDueOn: e.target.value })} /></label>{' '}
            {canUpload() && <FilePick onPick={setFiles} max={5} tag="license" />}{' '}
            <button className="btn-sm" disabled={a.busy === 'add'} onClick={add} data-lgl-license-save="">넣기</button>
          </div>
          {rn && (
            <div className="card pad" data-lgl-renew={rn.id}>
              <b>갱신 · 재신고 · 납부 기록</b>{' '}
              <label>처리일 <input type="date" value={rn.doneOn} max={kstDay()} onChange={(e) => setRn({ ...rn, doneOn: e.target.value })} /></label>{' '}
              <label>다음 갱신일(비우면 주기대로) <input type="date" value={rn.nextDueOn} onChange={(e) => setRn({ ...rn, nextDueOn: e.target.value })} /></label>{' '}
              <input value={rn.note} onChange={(e) => setRn({ ...rn, note: e.target.value })} placeholder="메모" size={14} />{' '}
              {canUpload() && <FilePick onPick={setFiles} max={5} tag="renew" />}{' '}
              <button className="btn-sm" disabled={a.busy === `r${rn.id}`} onClick={renew}>기록</button> <button className="btn-sm btn-plain" onClick={() => setRn(null)}>닫기</button>
            </div>
          )}
          <table className="tbl" data-lgl-license-list={d.items.length}><thead><tr><th>종류</th><th>이름 · 번호</th><th>기관</th><th>신고일</th><th>주기</th><th>다음 갱신일</th><th>서류</th><th /></tr></thead>
            <tbody>{d.items.map((x) => (
              <tr key={x.id} data-lgl-license={x.stage != null ? 'due' : 'ok'}>
                <td>{x.kindName}</td><td>{x.title}{x.licenseRef && <small className="dim"> {x.licenseRef}</small>}{x.memo && <><br /><small className="dim">{x.memo}</small></>}</td>
                <td>{x.authority ?? '—'}</td><td>{x.registeredOn ?? '—'}</td><td>{x.cycleMonths ? `${x.cycleMonths}달` : '없음'}</td>
                <td>{x.nextDueOn ?? '—'}{x.daysLeft != null && <small className={x.stage != null ? 'warn-text' : 'dim'}> {left(x.daysLeft)}</small>}{x.lastDoneOn && <><br /><small className="dim">지난 처리 {x.lastDoneOn}</small></>}</td>
                <td><FileButtons ids={x.fileIds} /></td>
                <td>{x.state === 'ACTIVE' ? <><button className="btn-sm btn-plain" onClick={() => setRn({ id: x.id, doneOn: kstDay(), nextDueOn: '', note: '' })}>갱신 기록</button>{' '}
                  <button className="btn-sm btn-plain" disabled={a.busy === `c${x.id}`} onClick={() => close(x.id)}>끝냄</button></> : <small className="dim">끝냄 · {x.closeReason}</small>}</td></tr>))}</tbody></table>
          <details data-lgl-kinds={d.kinds.length}><summary>인허가 종류 · 갱신 주기(일반 원칙 값 · 법무 확인{isSuper() ? ' · SUPER 고침' : ''})</summary>
            <table className="tbl"><thead><tr><th>코드</th><th>이름</th><th>기관</th><th>주기</th><th>근거</th><th>쓰기</th><th /></tr></thead>
              <tbody>{d.kinds.map((k) => <tr key={k.code}><td>{k.code}</td><td>{k.name}</td><td>{k.authority ?? '—'}</td><td>{k.cycleMonths ? `${k.cycleMonths}달` : '없음'}</td><td><small>{k.basis ?? ''}</small></td>
                <td>{k.active ? '씀' : '안 씀'}</td><td>{isSuper() && <button className="btn-sm btn-plain" onClick={() => setKd({ ...k })}>고침</button>}</td></tr>)}</tbody></table>
            {isSuper() && <p><button className="btn-sm btn-plain" onClick={() => setKd({ code: '', name: '', authority: '', cycleMonths: null, basis: '', active: true, sort: 100 })}>종류 더하기</button></p>}
            {kd && (
              <div className="card pad" data-lgl-kind-edit={kd.code}>
                <input value={kd.code} onChange={(e) => setKd({ ...kd, code: e.target.value.toUpperCase() })} placeholder="코드(영문 대문자)" size={16} />{' '}
                <input value={kd.name} onChange={(e) => setKd({ ...kd, name: e.target.value })} placeholder="이름" size={20} />{' '}
                <input value={kd.authority ?? ''} onChange={(e) => setKd({ ...kd, authority: e.target.value })} placeholder="기관" size={14} />{' '}
                <input type="number" min={1} max={120} value={kd.cycleMonths ?? ''} onChange={(e) => setKd({ ...kd, cycleMonths: e.target.value ? Number(e.target.value) : null })} placeholder="주기(달)" style={{ width: 90 }} />{' '}
                <input value={kd.basis ?? ''} onChange={(e) => setKd({ ...kd, basis: e.target.value })} placeholder="근거" size={30} />{' '}
                <label><input type="checkbox" checked={kd.active} onChange={(e) => setKd({ ...kd, active: e.target.checked })} /> 씀</label>{' '}
                <button className="btn-sm" disabled={a.busy === 'kd' || !kd.code} onClick={() => void a.run('kd', () => put(`/admin/legal/license-kinds/${encodeURIComponent(kd.code)}`,
                  { name: kd.name, authority: kd.authority ?? '', cycleMonths: kd.cycleMonths, basis: kd.basis ?? '', active: kd.active }), () => { setKd(null); q.reload(); })}>저장</button>{' '}
                <button className="btn-sm btn-plain" onClick={() => setKd(null)}>닫기</button>
              </div>
            )}
          </details>
        </>
      )}
    </section>
  );
}

/* ── v10.487 계약 검토 ── */
const RV_ST: Record<string, string> = { REQUESTED: '요청', REVIEWED: '의견 있음', APPROVED: '승인', REJECTED: '반려', CANCELED: '취소' };
const RV_KIND: Record<string, string> = { NEW: '새 계약', RENEW: '갱신', CHANGE: '변경', TERMINATE: '해지' };
const RISK: Record<string, string> = { LOW: '낮음', MID: '보통', HIGH: '높음' };
interface Rv { id: string; title: string; kind: string; counterparty: string | null; contractId: string | null; contractTitle: string | null; amount: number | null; wantedOn: string | null;
  state: string; requestedBy: string; requestedByName: string | null; opinions: number; riskLevel: number | null; late: boolean; decideNote: string | null }
interface RvOne { review: Rv & { summary: string | null; fileIds: string[] }; opinions: Array<{ id: string; risk: string; body: string; outside: boolean; fileIds: string[]; author: string | null; createdAt: string }> }
export function LglReviews() {
  const [state, setState] = useState('');
  const q = useApi<{ items: Rv[]; contracts: Array<{ id: string; title: string; state: string }>; waiting: number; note: string }>(`/admin/legal/reviews${state ? `?state=${state}` : ''}`, [state]);
  const a = useAct();
  const blank = { title: '', kind: 'NEW', counterparty: '', contractId: '', amount: '', wantedOn: kstDay(7), summary: '' };
  const [f, setF] = useState(blank);
  const [files, setFiles] = useState<File[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const one = useApi<RvOne>(open ? `/admin/legal/reviews/${open}` : '/admin/legal/reviews?state=CANCELED', [open]);
  const [op, setOp] = useState({ risk: 'MID', body: '', outside: false });
  const d = q.data;
  const reload = () => { q.reload(); one.reload(); };
  const add = () => void a.run('add', async () => {
    const fileIds = await uploadAll(files);
    return post('/admin/legal/reviews', { title: f.title, kind: f.kind, fileIds, ...(f.counterparty ? { counterparty: f.counterparty } : {}), ...(f.contractId ? { contractId: f.contractId } : {}),
      ...(f.amount ? { amount: Number(f.amount) } : {}), ...(f.wantedOn ? { wantedOn: f.wantedOn } : {}), ...(f.summary ? { summary: f.summary } : {}) });
  }, () => { setF(blank); setFiles([]); q.reload(); });
  const r = open && one.data && 'review' in one.data ? one.data : null;
  return (
    <section data-lgl-reviews={d ? d.items.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className="muted">{d.note}</p>
          <p>기다림 {d.waiting}{' '}<select value={state} onChange={(e) => setState(e.target.value)} aria-label="상태"><option value="">모두</option>{Object.entries(RV_ST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></p>
          {canUpload() && (
            <div className="card pad" data-lgl-review-form="">
              <b>계약 검토 요청</b><br />
              <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="계약 이름" size={22} />{' '}
              <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="종류">{Object.entries(RV_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
              <input value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} placeholder="상대" size={14} />{' '}
              <select value={f.contractId} onChange={(e) => setF({ ...f, contractId: e.target.value })} aria-label="계약 대장"><option value="">계약 대장(갱신 · 변경 · 해지는 꼭)</option>{d.contracts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>{' '}
              <input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="금액(원)" style={{ width: 110 }} />{' '}
              <label>희망일 <input type="date" value={f.wantedOn} min={kstDay()} onChange={(e) => setF({ ...f, wantedOn: e.target.value })} /></label><br />
              <textarea value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} placeholder="보아 줄 곳(손해배상 · 해지 · 기간 …)" rows={2} cols={60} />{' '}
              <FilePick onPick={setFiles} max={5} tag="review" />{' '}
              <button className="btn-sm" disabled={a.busy === 'add' || f.title.trim().length < 2 || !files.length} onClick={add} data-lgl-review-save="">요청</button>
            </div>
          )}
          <table className="tbl" data-lgl-review-list={d.items.length}><thead><tr><th>계약</th><th>종류</th><th>상대</th><th>희망일</th><th>의견</th><th>상태</th><th /></tr></thead>
            <tbody>{d.items.map((x) => (
              <tr key={x.id} data-lgl-review={x.state}>
                <td>{x.title}{x.contractTitle && <><br /><small className="dim">계약 대장 · {x.contractTitle}</small></>}</td><td>{RV_KIND[x.kind] ?? x.kind}</td><td>{x.counterparty ?? '—'}</td>
                <td className={x.late ? 'warn-text' : ''}>{x.wantedOn ?? '—'}</td><td>{x.opinions}{x.riskLevel === 3 ? <span className="warn-text"> · 위험 높음</span> : ''}</td>
                <td>{RV_ST[x.state] ?? x.state}{x.decideNote && <small className="dim"> · {x.decideNote}</small>}</td>
                <td><button className="btn-sm btn-plain" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? '닫기' : '보기'}</button></td></tr>))}</tbody></table>
          {r && (
            <div className="card pad" data-lgl-review-one={r.review.id}>
              <b>{r.review.title}</b> <small className="dim">{RV_ST[r.review.state]} · 요청 {r.review.requestedByName ?? ''}{r.review.amount != null ? ` · ${n(r.review.amount)}원` : ''}</small>
              {r.review.summary && <p>{r.review.summary}</p>}
              <p>계약서 <FileButtons ids={r.review.fileIds} /></p>
              <table className="tbl"><tbody>{r.opinions.map((o) => <tr key={o.id}><td>{o.author ?? ''}{o.outside ? <small className="dim"> · 외부 변호사 의견</small> : ''}</td>
                <td className={o.risk === 'HIGH' ? 'warn-text' : ''}>위험 {RISK[o.risk] ?? o.risk}</td><td style={{ whiteSpace: 'pre-wrap' }}>{o.body}</td><td><FileButtons ids={o.fileIds} /></td></tr>)}</tbody></table>
              {['REQUESTED', 'REVIEWED'].includes(r.review.state) && (
                <p data-lgl-opinion-form="">
                  <select value={op.risk} onChange={(e) => setOp({ ...op, risk: e.target.value })} aria-label="위험">{Object.entries(RISK).map(([k, v]) => <option key={k} value={k}>위험 {v}</option>)}</select>{' '}
                  <label><input type="checkbox" checked={op.outside} onChange={(e) => setOp({ ...op, outside: e.target.checked })} /> 외부 변호사 의견</label><br />
                  <textarea value={op.body} onChange={(e) => setOp({ ...op, body: e.target.value })} placeholder="검토 의견(요청한 사람은 못 씀)" rows={3} cols={70} /><br />
                  <button className="btn-sm" disabled={a.busy === 'op' || op.body.trim().length < 2} onClick={() => void a.run('op', () => post(`/admin/legal/reviews/${r.review.id}/opinions`, op), () => { setOp({ risk: 'MID', body: '', outside: false }); reload(); })}>의견 남기기</button>{' '}
                  {isSuper() && r.review.state === 'REVIEWED' && <>
                    <button className="btn-sm" disabled={a.busy === 'ok'} onClick={() => void a.run('ok', () => post(`/admin/legal/reviews/${r.review.id}/decide`, { approve: true }), reload)}>승인</button>{' '}
                    <button className="btn-sm btn-plain" disabled={a.busy === 'no'} onClick={() => { const note = prompt('반려 사유(2자 이상)'); if (note && note.trim().length >= 2) void a.run('no', () => post(`/admin/legal/reviews/${r.review.id}/decide`, { approve: false, note }), reload); }}>반려</button>{' '}</>}
                  <button className="btn-sm btn-plain" disabled={a.busy === 'cx'} onClick={() => { if (confirm('검토 요청을 취소할까요?')) void a.run('cx', () => post(`/admin/legal/reviews/${r.review.id}/cancel`, {}), reload); }}>취소</button>
                </p>
              )}
              {!r.review.contractId && !['REJECTED', 'CANCELED'].includes(r.review.state) && (
                <p>계약 대장 연결 <select onChange={(e) => { const cid = e.target.value; if (cid) void a.run('ln', () => post(`/admin/legal/reviews/${r.review.id}/link`, { contractId: cid }), reload); }} defaultValue="" aria-label="연결">
                  <option value="">고르기</option>{d.contracts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select> <small className="dim">(한 번 · 바꾸지 않음)</small></p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ── v10.488 소송 · 분쟁 ── */
const CASE_KIND: Record<string, string> = { CIVIL: '민사', CRIMINAL: '형사', ADMIN: '행정', LABOR: '노동', MEDIATION: '조정 · 중재', CONSUMER: '소비자 분쟁', ETC: '그 밖' };
const SIDE: Record<string, string> = { PLAINTIFF: '원고', DEFENDANT: '피고', APPLICANT: '신청인', RESPONDENT: '피신청인', ETC: '그 밖' };
const RESULT: Record<string, string> = { WIN: '이김', LOSE: '짐', PARTIAL: '일부', SETTLED: '합의', WITHDRAWN: '취하', DISMISSED: '각하', ETC: '그 밖' };
const HKIND: Record<string, string> = { HEARING: '변론', DEADLINE: '기한', MEDIATION: '조정', ETC: '그 밖' };
const COST: Record<string, string> = { COUNSEL: '대리인 보수', STAMP: '인지', SERVICE: '송달료', DEPOSIT: '공탁', ETC: '그 밖' };
interface Cs { id: string; caseRef: string | null; title: string; kind: string; ourSide: string; counterparty: string | null; forum: string | null; counsel: string | null; claimAmount: number | null;
  openedOn: string; state: string; result: string | null; closedOn: string | null; nextAt: string | null; pastPlanned: number; costTotal: number }
interface CsOne { case: Cs & { fileIds: string[]; memo: string | null; resultNote: string | null };
  hearings: Array<{ id: string; heldAt: string; kind: string; place: string | null; note: string | null; state: string; outcome: string | null }>;
  costs: Array<{ id: string; kind: string; amount: number; paidOn: string; expenseClaimId: string | null; purchaseId: string | null; note: string | null; state: string; voidReason: string | null }>; costTotal: number }
const kst = (s: string) => new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' });
export function LglCases() {
  const [state, setState] = useState('OPEN');
  const q = useApi<{ items: Cs[]; upcoming: Array<{ id: string; caseId: string; title: string; heldAt: string; kind: string }>; note: string }>(`/admin/legal/cases?state=${state}`, [state]);
  const a = useAct();
  const blank = { caseRef: '', title: '', kind: 'CIVIL', ourSide: 'DEFENDANT', counterparty: '', forum: '', counsel: '', claimAmount: '', openedOn: kstDay() };
  const [f, setF] = useState(blank);
  const [files, setFiles] = useState<File[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const one = useApi<CsOne>(open ? `/admin/legal/cases/${open}` : '/admin/legal/cases?state=CLOSED', [open]);
  const [hf, setHf] = useState({ at: `${kstDay(14)}T10:00`, kind: 'HEARING', place: '', note: '' });
  const [cf, setCf] = useState({ kind: 'COUNSEL', amount: '', paidOn: kstDay(), link: 'NONE', linkId: '', note: '' });
  const d = q.data;
  const reload = () => { q.reload(); one.reload(); };
  const add = () => void a.run('add', async () => {
    const fileIds = await uploadAll(files);
    const body: Record<string, unknown> = { title: f.title, kind: f.kind, ourSide: f.ourSide, openedOn: f.openedOn, fileIds };
    for (const k of ['caseRef', 'counterparty', 'forum', 'counsel'] as const) if (f[k].trim()) body[k] = f[k].trim();
    if (f.claimAmount) body.claimAmount = Number(f.claimAmount);
    return post('/admin/legal/cases', body);
  }, () => { setF(blank); setFiles([]); q.reload(); });
  const c = open && one.data && 'case' in one.data ? one.data : null;
  return (
    <section data-lgl-cases={d ? d.items.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className="muted">{d.note}</p>
          {!!d.upcoming.length && <p data-lgl-upcoming={d.upcoming.length}>60일 안 기일 — {d.upcoming.slice(0, 5).map((h) => `${kst(h.heldAt)} ${h.title}(${HKIND[h.kind] ?? h.kind})`).join(' · ')}</p>}
          <p><button className="btn-sm btn-plain" onClick={() => setState(state === 'OPEN' ? 'CLOSED' : 'OPEN')}>{state === 'OPEN' ? '끝낸 사건 보기' : '진행 중 사건 보기'}</button></p>
          <div className="card pad" data-lgl-case-form="">
            <b>사건 넣기</b><br />
            <input value={f.caseRef} onChange={(e) => setF({ ...f, caseRef: e.target.value })} placeholder="사건 번호" size={14} />{' '}
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="사건 이름" size={20} />{' '}
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="종류">{Object.entries(CASE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
            <select value={f.ourSide} onChange={(e) => setF({ ...f, ourSide: e.target.value })} aria-label="우리 쪽">{Object.entries(SIDE).map(([k, v]) => <option key={k} value={k}>우리 {v}</option>)}</select>{' '}
            <input value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} placeholder="상대" size={12} />{' '}
            <input value={f.forum} onChange={(e) => setF({ ...f, forum: e.target.value })} placeholder="법원 · 기관" size={14} />{' '}
            <input value={f.counsel} onChange={(e) => setF({ ...f, counsel: e.target.value })} placeholder="대리인" size={12} />{' '}
            <input type="number" min={0} value={f.claimAmount} onChange={(e) => setF({ ...f, claimAmount: e.target.value })} placeholder="소가(원)" style={{ width: 110 }} />{' '}
            <label>시작일 <input type="date" value={f.openedOn} max={kstDay()} onChange={(e) => setF({ ...f, openedOn: e.target.value })} /></label>{' '}
            {canUpload() && <FilePick onPick={setFiles} max={10} tag="case" />}{' '}
            <button className="btn-sm" disabled={a.busy === 'add' || f.title.trim().length < 2} onClick={add} data-lgl-case-save="">넣기</button>
          </div>
          <table className="tbl" data-lgl-case-list={d.items.length}><thead><tr><th>사건</th><th>종류 · 우리 쪽</th><th>상대 · 기관</th><th>다음 기일</th><th className="num">비용</th><th>상태</th><th /></tr></thead>
            <tbody>{d.items.map((x) => (
              <tr key={x.id} data-lgl-case={x.state}>
                <td>{x.title}{x.caseRef && <small className="dim"> {x.caseRef}</small>}</td><td>{CASE_KIND[x.kind] ?? x.kind} · {SIDE[x.ourSide] ?? x.ourSide}</td>
                <td>{x.counterparty ?? '—'}<br /><small className="dim">{x.forum ?? ''}</small></td>
                <td>{x.nextAt ? kst(x.nextAt) : '—'}{x.pastPlanned ? <small className="warn-text"> · 결과 안 적은 기일 {x.pastPlanned}</small> : ''}</td>
                <td className="num">{n(x.costTotal)}</td><td>{x.state === 'OPEN' ? '진행' : `끝남 · ${RESULT[x.result ?? ''] ?? x.result}`}</td>
                <td><button className="btn-sm btn-plain" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? '닫기' : '보기'}</button></td></tr>))}</tbody></table>
          {c && (
            <div className="card pad" data-lgl-case-one={c.case.id}>
              <b>{c.case.title}</b> <small className="dim">{c.case.caseRef ?? ''} · 대리인 {c.case.counsel ?? '—'} · 소가 {c.case.claimAmount != null ? `${n(c.case.claimAmount)}원` : '—'}</small>
              <p>서류 <FileButtons ids={c.case.fileIds} />{c.case.memo && <><br /><small className="dim">{c.case.memo}</small></>}</p>
              <b>기일</b>
              <table className="tbl" data-lgl-hearings={c.hearings.length}><tbody>{c.hearings.map((h) => <tr key={h.id} data-lgl-hearing={h.state}><td>{kst(h.heldAt)}</td><td>{HKIND[h.kind] ?? h.kind}</td><td>{h.place ?? ''}</td>
                <td>{h.note ?? ''}{h.outcome && <small className="dim"> · {h.outcome}</small>}</td><td>{h.state === 'PLANNED' ? '예정' : h.state === 'DONE' ? '끝남' : '취소'}</td>
                <td>{h.state === 'PLANNED' && c.case.state === 'OPEN' && <>
                  <button className="btn-sm btn-plain" onClick={() => { const outcome = prompt('결과 한 줄(다음 기일 지정 등)') ?? ''; void a.run(`hd${h.id}`, () => put(`/admin/legal/hearings/${h.id}`, { state: 'DONE', ...(outcome ? { outcome } : {}) }), reload); }}>끝남</button>{' '}
                  <button className="btn-sm btn-plain" onClick={() => { if (confirm('기일을 취소할까요?')) void a.run(`hc${h.id}`, () => put(`/admin/legal/hearings/${h.id}`, { state: 'CANCELED' }), reload); }}>취소</button></>}</td></tr>)}</tbody></table>
              {c.case.state === 'OPEN' && (
                <p data-lgl-hearing-form="">
                  <input type="datetime-local" value={hf.at} onChange={(e) => setHf({ ...hf, at: e.target.value })} aria-label="기일" />{' '}
                  <select value={hf.kind} onChange={(e) => setHf({ ...hf, kind: e.target.value })} aria-label="기일 종류">{Object.entries(HKIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
                  <input value={hf.place} onChange={(e) => setHf({ ...hf, place: e.target.value })} placeholder="장소" size={12} />{' '}
                  <input value={hf.note} onChange={(e) => setHf({ ...hf, note: e.target.value })} placeholder="메모" size={14} />{' '}
                  <button className="btn-sm" disabled={a.busy === 'h'} onClick={() => void a.run('h', () => post(`/admin/legal/cases/${c.case.id}/hearings`, { at: hf.at, kind: hf.kind, ...(hf.place ? { place: hf.place } : {}), ...(hf.note ? { note: hf.note } : {}) }), reload)}>기일 넣기</button>
                </p>
              )}
              <b>비용 {n(c.costTotal)}원</b>
              <table className="tbl" data-lgl-costs={c.costs.length}><tbody>{c.costs.map((x) => <tr key={x.id} data-lgl-cost={x.state}><td>{x.paidOn}</td><td>{COST[x.kind] ?? x.kind}</td><td className="num">{n(x.amount)}</td>
                <td>{x.expenseClaimId ? `경비 청구 ${x.expenseClaimId}` : x.purchaseId ? `매입 ${x.purchaseId}` : '전표 연결 없음'}{x.note && <small className="dim"> · {x.note}</small>}</td>
                <td>{x.state === 'ACTIVE' ? <button className="btn-sm btn-plain" onClick={() => { const reason = prompt('무효 사유(2자 이상)'); if (reason && reason.trim().length >= 2) void a.run(`cv${x.id}`, () => post(`/admin/legal/costs/${x.id}/void`, { reason }), reload); }}>무효</button>
                  : <small className="dim">무효 · {x.voidReason}</small>}</td></tr>)}</tbody></table>
              <p data-lgl-cost-form="">
                <select value={cf.kind} onChange={(e) => setCf({ ...cf, kind: e.target.value })} aria-label="비용 종류">{Object.entries(COST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
                <input type="number" min={1} value={cf.amount} onChange={(e) => setCf({ ...cf, amount: e.target.value })} placeholder="금액(원)" style={{ width: 110 }} />{' '}
                <input type="date" value={cf.paidOn} max={kstDay()} onChange={(e) => setCf({ ...cf, paidOn: e.target.value })} aria-label="낸 날" />{' '}
                <select value={cf.link} onChange={(e) => setCf({ ...cf, link: e.target.value })} aria-label="전표"><option value="NONE">전표 나중에</option><option value="CLAIM">경비 청구 번호</option><option value="PURCHASE">매입 번호</option></select>{' '}
                {cf.link !== 'NONE' && <input value={cf.linkId} onChange={(e) => setCf({ ...cf, linkId: e.target.value.replace(/\D/g, '') })} placeholder="번호" size={6} />}{' '}
                <input value={cf.note} onChange={(e) => setCf({ ...cf, note: e.target.value })} placeholder="메모(착수금 등)" size={12} />{' '}
                <button className="btn-sm" disabled={a.busy === 'cost' || !Number(cf.amount)} onClick={() => void a.run('cost', () => post(`/admin/legal/cases/${c.case.id}/costs`, {
                  kind: cf.kind, amount: Number(cf.amount), paidOn: cf.paidOn, ...(cf.note ? { note: cf.note } : {}),
                  ...(cf.link === 'CLAIM' && cf.linkId ? { expenseClaimId: cf.linkId } : {}), ...(cf.link === 'PURCHASE' && cf.linkId ? { purchaseId: cf.linkId } : {}) }),
                  () => { setCf({ kind: 'COUNSEL', amount: '', paidOn: kstDay(), link: 'NONE', linkId: '', note: '' }); reload(); })}>비용 넣기</button>
              </p>
              {c.case.state === 'OPEN' ? (
                <p>결과 <select defaultValue="" aria-label="결과" onChange={(e) => { const result = e.target.value; if (!result) return; const resultNote = prompt('결과 한 줄(되돌리지 않음)') ?? '';
                  void a.run('close', () => post(`/admin/legal/cases/${c.case.id}/close`, { result, ...(resultNote ? { resultNote } : {}) }), reload); }}>
                  <option value="">고르면 끝냄</option>{Object.entries(RESULT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></p>
              ) : <p>결과 {RESULT[c.case.result ?? ''] ?? c.case.result} · {c.case.closedOn}{c.case.resultNote && <small className="dim"> · {c.case.resultNote}</small>}</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ── v10.489 회사 보험 ── */
const INS_KIND: Record<string, string> = { FIRE: '화재', LIABILITY: '배상책임', PRODUCT: '생산물 배상', CYBER: '사이버 · 개인정보', DNO: '임원 배상', CAR: '자동차', GUARANTEE: '보증', EMPLOYEE: '직원(단체)', ETC: '그 밖' };
const POST_KO: Record<string, string> = { PAY: '낼 때', AMORT: '달마다 넘김', MONTHLY: '월납' };
interface Pol { id: string; kind: string; title: string; insurer: string; policyRef: string | null; coverage: number | null; premium: number; startsOn: string; endsOn: string; payMode: string; bookMode: string;
  renewedFrom: string | null; renewedBy: string | null; fileIds: string[]; state: string; endReason: string | null; daysLeft: number; due: boolean; expired: boolean }
interface PolOne { policy: Pol; plan: Array<{ kind: string; ym: string; amount: number; on: string; manualId: string | null; manualState: string | null }> }
export function LglInsurance() {
  const [state, setState] = useState('ACTIVE');
  const q = useApi<{ items: Pol[]; alertDays: number; count: { active: number; due: number; expired: number; premiumActive: number }; note: string }>(`/admin/legal/insurance?state=${state}`, [state]);
  const a = useAct();
  const blank = { kind: 'LIABILITY', title: '', insurer: '', policyRef: '', coverage: '', premium: '', startsOn: kstDay(), endsOn: '', payMode: 'LUMP', bookMode: 'PREPAID', renewedFrom: '' };
  const [f, setF] = useState(blank);
  const [files, setFiles] = useState<File[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const one = useApi<PolOne>(open ? `/admin/legal/insurance/${open}` : '/admin/legal/insurance?state=ENDED', [open]);
  const d = q.data;
  const reload = () => { q.reload(); one.reload(); };
  const admin = roles().some((r) => r === 'SUPER' || r === 'ADMIN');
  const fin = roles().some((r) => r === 'SUPER' || r === 'PAYOUT');
  const add = () => void a.run('add', async () => {
    const fileIds = await uploadAll(files);
    return post('/admin/legal/insurance', { kind: f.kind, title: f.title, insurer: f.insurer, premium: Number(f.premium), startsOn: f.startsOn, endsOn: f.endsOn, payMode: f.payMode,
      bookMode: f.payMode === 'MONTHLY' ? 'EXPENSE' : f.bookMode, fileIds, ...(f.policyRef ? { policyRef: f.policyRef } : {}), ...(f.coverage ? { coverage: Number(f.coverage) } : {}),
      ...(f.renewedFrom ? { renewedFrom: f.renewedFrom } : {}) });
  }, () => { setF(blank); setFiles([]); q.reload(); });
  const renewOf = (p: Pol) => setF({ ...blank, kind: p.kind, title: p.title, insurer: p.insurer, premium: String(p.premium), startsOn: p.endsOn, payMode: p.payMode, bookMode: p.bookMode, renewedFrom: p.id });
  const p = open && one.data && 'policy' in one.data ? one.data : null;
  return (
    <section data-lgl-insurance={d ? d.items.length : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className="muted">{d.note}</p>
          <p>유효 {d.count.active} · 보험료 합 {n(d.count.premiumActive)}원 · <span className={d.count.due ? 'warn-text' : ''}>만기 다가옴 {d.count.due}</span> · 만기 지남 {d.count.expired}{' '}
            <button className="btn-sm btn-plain" onClick={() => setState(state === 'ACTIVE' ? 'ENDED' : 'ACTIVE')}>{state === 'ACTIVE' ? '끝낸 증권 보기' : '유효한 증권 보기'}</button></p>
          {admin && (
            <div className="card pad" data-lgl-policy-form="">
              <b>{f.renewedFrom ? `갱신 증권 넣기 — 옛 증권 ${f.renewedFrom}` : '증권 넣기'}</b><br />
              <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="종류">{Object.entries(INS_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
              <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="증권 이름" size={18} />{' '}
              <input value={f.insurer} onChange={(e) => setF({ ...f, insurer: e.target.value })} placeholder="보험사" size={12} />{' '}
              <input value={f.policyRef} onChange={(e) => setF({ ...f, policyRef: e.target.value })} placeholder="증권 번호" size={12} />{' '}
              <input type="number" min={0} value={f.coverage} onChange={(e) => setF({ ...f, coverage: e.target.value })} placeholder="보장(원)" style={{ width: 120 }} />{' '}
              <input type="number" min={1} value={f.premium} onChange={(e) => setF({ ...f, premium: e.target.value })} placeholder="보험료(원)" style={{ width: 110 }} />{' '}
              <label>시작 <input type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} /></label>{' '}
              <label>만기 <input type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} /></label>{' '}
              <select value={f.payMode} onChange={(e) => setF({ ...f, payMode: e.target.value })} aria-label="내는 방법"><option value="LUMP">일시납</option><option value="MONTHLY">월납</option></select>{' '}
              {f.payMode === 'LUMP' && <select value={f.bookMode} onChange={(e) => setF({ ...f, bookMode: e.target.value })} aria-label="회계 처리"><option value="PREPAID">선급비용(기간 배분)</option><option value="EXPENSE">바로 비용</option></select>}{' '}
              {canUpload() && <FilePick onPick={setFiles} max={5} tag="policy" />}{' '}
              <button className="btn-sm" disabled={a.busy === 'add' || f.title.trim().length < 2 || !f.insurer.trim() || !Number(f.premium) || !f.endsOn} onClick={add} data-lgl-policy-save="">넣기</button>
              {f.renewedFrom && <> <button className="btn-sm btn-plain" onClick={() => setF(blank)}>갱신 그만</button></>}
            </div>
          )}
          <table className="tbl" data-lgl-policy-list={d.items.length}><thead><tr><th>종류</th><th>증권</th><th>보험사</th><th className="num">보험료</th><th>기간</th><th>처리</th><th>서류</th><th /></tr></thead>
            <tbody>{d.items.map((x) => (
              <tr key={x.id} data-lgl-policy={x.due ? 'due' : 'ok'}>
                <td>{INS_KIND[x.kind] ?? x.kind}</td><td>{x.title}{x.policyRef && <small className="dim"> {x.policyRef}</small>}</td><td>{x.insurer}</td><td className="num">{n(x.premium)}</td>
                <td>{x.startsOn} ~ {x.endsOn}{x.state === 'ACTIVE' && <small className={x.due ? 'warn-text' : 'dim'}> {x.renewedBy ? `갱신함(${x.renewedBy})` : left(x.daysLeft)}</small>}</td>
                <td>{x.payMode === 'MONTHLY' ? '월납' : '일시납'} · {x.bookMode === 'PREPAID' ? '선급비용' : '바로 비용'}</td><td><FileButtons ids={x.fileIds} /></td>
                <td><button className="btn-sm btn-plain" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? '닫기' : '전표 계획'}</button>{' '}
                  {x.state === 'ACTIVE' && admin && !x.renewedBy && <button className="btn-sm btn-plain" onClick={() => renewOf(x)}>갱신</button>}{' '}
                  {x.state === 'ACTIVE' && admin && <button className="btn-sm btn-plain" onClick={() => { const reason = prompt('끝내는 사유(해지 · 만기 등)'); if (reason && reason.trim().length >= 2) void a.run(`e${x.id}`, () => post(`/admin/legal/insurance/${x.id}/end`, { reason }), q.reload); }}>끝냄</button>}
                  {x.state === 'ENDED' && <small className="dim">끝냄 · {x.endReason}</small>}</td></tr>))}</tbody></table>
          {p && (
            <div className="card pad" data-lgl-plan={p.plan.length}>
              <b>{p.policy.title} — 보험료 전표 계획</b> <small className="dim">초안은 수동 전표 요청으로 올라가고, 쓴 사람이 아닌 SUPER 가 회계 › 장부 › 수동 전표에서 승인합니다.</small>
              <table className="tbl"><thead><tr><th>달</th><th>종류</th><th className="num">금액</th><th>전표 날짜</th><th>초안</th><th /></tr></thead>
                <tbody>{p.plan.map((x) => <tr key={`${x.kind}${x.ym}`} data-lgl-plan-row={x.manualId ? 'made' : 'todo'}><td>{x.ym}</td><td>{POST_KO[x.kind] ?? x.kind}</td><td className="num">{n(x.amount)}</td><td>{x.on}</td>
                  <td>{x.manualId ? `수동 전표 ${x.manualId} · ${x.manualState === 'APPROVED' ? '승인' : '요청'}` : '—'}</td>
                  <td>{!x.manualId && fin && (x.kind !== 'AMORT' || x.on <= kstDay()) && <button className="btn-sm btn-plain" disabled={a.busy === `j${x.kind}${x.ym}`}
                    onClick={() => void a.run(`j${x.kind}${x.ym}`, () => post(`/admin/legal/insurance/${p.policy.id}/journal`, { kind: x.kind, ...(x.kind === 'PAY' ? {} : { ym: x.ym }) }), reload)}>초안 만들기</button>}</td></tr>)}</tbody></table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
