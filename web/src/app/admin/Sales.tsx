/* ===== v10.466 · 467 (D264 · docs/604 · 605) 영업 · 자금 — web/src/app/admin/Sales.tsx 새 파일 =====
 * 대표 11/20 「㉝ 영업 · 자금 · 소개몰」.
 *   SalCrm        회계 › 영업 기회 (설정 · 보고 묶음) — 파이프라인 · 기회 목록 · 만들기 · 단계 · 견적서 잇기 · 메모 · 다음 할 일
 *   AcctBankFeed  회계 › 은행 자동 조회 (자금 묶음) — 켜짐 · 방식 · 등록 계좌(끝 4자리) · 지금 조회 · 기록
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md)
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

const won = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const kstDay = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);

/* ── v10.466 영업 기회 ── */
interface OppRow { id: string; partyId: string; partyName: string; title: string; stage: string; expectedAmount: number; ownerId: string | null; ownerName: string | null;
  nextAction: string | null; nextActionOn: string | null; expectedCloseOn: string | null; quoteDocId: string | null; quoteDocNo: string | null; closedAt: string | null; due: boolean }
interface OppList { items: OppRow[]; stages: Record<string, string>; parties: Array<{ id: string; name: string }>; staff: Array<{ id: string; name: string }>;
  pipeline: Array<{ stage: string; label: string; count: number; amount: number; weighted: number; weight: number }>;
  summary: { open: number; openAmount: number; weighted: number; wonThisMonth: number; wonAmountThisMonth: number; lostThisMonth: number; winRate90: number | null; overdue: number; dueToday: number }; note: string }
interface OppDetail { opp: OppRow & { memo: string | null; lostReason: string | null; contactName: string | null; quoteState: string | null; quoteTotal: number | null };
  logs: Array<{ id: string; kind: string; from: string | null; to: string | null; note: string | null; actor: string | null; createdAt: string }>;
  quotes: Array<{ id: string; docNo: string; title: string; total: number; state: string }>; stages: Record<string, string> }
const NEXT_STAGE: Record<string, string[]> = { LEAD: ['QUOTE', 'CONTRACT', 'WON', 'LOST'], QUOTE: ['LEAD', 'CONTRACT', 'WON', 'LOST'], CONTRACT: ['QUOTE', 'WON', 'LOST'], LOST: ['LEAD'], WON: [] };
const LOG_KO: Record<string, string> = { CREATE: '만듦', STAGE: '단계', NOTE: '메모', EDIT: '고침', QUOTE: '견적' };
const EMPTY_OPP = { partyId: '', title: '', expectedAmount: '', ownerId: '', nextAction: '', nextActionOn: '', expectedCloseOn: '' };

function OppView({ id, list, onDone }: { id: string; list: OppList; onDone: () => void }) {
  const q = useApi<OppDetail>(`/admin/sales/opps/${id}`, [id]);
  const a = useAct();
  const [note, setNote] = useState('');
  const [ed, setEd] = useState<{ nextAction: string; nextActionOn: string; expectedAmount: string; ownerId: string } | null>(null);
  const [qd, setQd] = useState('');
  const d = q.data;
  if (!d) return null;
  const o = d.opp;
  const after = () => { q.reload(); onDone(); };
  const post = (k: string, path: string, body: unknown) => void a.run(k, () => api(path, { method: 'POST', body: JSON.stringify(body) }), after);
  const stage = (to: string) => {
    let n: string | null = '';
    if (to === 'LOST' || o.stage === 'LOST') { n = prompt(to === 'LOST' ? '실패 사유(2자 이상)' : '다시 여는 사유(2자 이상)'); if (!n) return; }
    else if (to === 'WON' && !confirm(`「${o.title}」을 성사로 닫을까요? 성사는 다시 고치지 않습니다.`)) return;
    post(`st${to}`, `/admin/sales/opps/${id}/stage`, { stage: to, note: n || undefined });
  };
  return (
    <div className="card pad" data-sal-opp-view={o.stage}>
      <Flash msg={a.msg} err={a.err} />
      <b>{o.title}</b> · {o.partyName}{o.contactName ? ` (${o.contactName})` : ''} · <b>{d.stages[o.stage] ?? o.stage}</b> · 예상 {won(o.expectedAmount)}원 · 담당 {o.ownerName ?? '없음'}
      {o.lostReason && <small className="warn-text"> · 실패 사유 {o.lostReason}</small>}
      <div className="acts">
        {(NEXT_STAGE[o.stage] ?? []).map((s) => <button key={s} className={s === 'WON' ? 'btn-sm' : 'btn-sm btn-plain'} disabled={a.busy === `st${s}`} onClick={() => stage(s)} data-sal-opp-stage={s}>{o.stage === 'LOST' ? '다시 열기' : `${d.stages[s]}(으)로`}</button>)}{' '}
        {['LEAD', 'QUOTE', 'CONTRACT'].includes(o.stage) && <button className="btn-sm btn-plain" onClick={() => setEd({ nextAction: o.nextAction ?? '', nextActionOn: o.nextActionOn ?? '', expectedAmount: String(o.expectedAmount ?? ''), ownerId: o.ownerId ?? '' })}>고치기</button>}
      </div>
      {ed && (
        <p data-sal-opp-edit="">
          <input value={ed.nextAction} onChange={(e) => setEd({ ...ed, nextAction: e.target.value })} placeholder="다음 할 일" size={24} />{' '}
          <input type="date" value={ed.nextActionOn} onChange={(e) => setEd({ ...ed, nextActionOn: e.target.value })} aria-label="다음 할 날짜" />{' '}
          <input type="number" value={ed.expectedAmount} onChange={(e) => setEd({ ...ed, expectedAmount: e.target.value })} placeholder="예상 매출" style={{ width: 130 }} />{' '}
          <select value={ed.ownerId} onChange={(e) => setEd({ ...ed, ownerId: e.target.value })} aria-label="담당"><option value="">담당 없음</option>{list.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>{' '}
          <button className="btn-sm" onClick={() => void a.run('ed', () => api(`/admin/sales/opps/${id}`, { method: 'PUT', body: JSON.stringify({ nextAction: ed.nextAction, nextActionOn: ed.nextActionOn, expectedAmount: Number(ed.expectedAmount || 0), ownerId: ed.ownerId }) }), () => { setEd(null); after(); })} data-sal-opp-save="">저장</button>{' '}
          <button className="btn-sm btn-plain" onClick={() => setEd(null)}>닫기</button>
        </p>
      )}
      <p>
        다음 할 일 {o.nextAction ?? '—'} {o.nextActionOn && <b className={o.due ? 'warn-text' : ''}>{o.nextActionOn}</b>} · 예상 마감 {o.expectedCloseOn ?? '—'} · 견적서 {o.quoteDocNo ? <b>{o.quoteDocNo}({o.quoteState} · {won(o.quoteTotal)}원)</b> : '없음'}
      </p>
      {['LEAD', 'QUOTE', 'CONTRACT'].includes(o.stage) && (
        <p data-sal-opp-quote="">
          <select value={qd} onChange={(e) => setQd(e.target.value)} aria-label="견적서"><option value="">견적서 초안 새로 만들기(예상 매출 · 과세 한 줄)</option>{d.quotes.map((x) => <option key={x.id} value={x.id}>{x.docNo} · {x.title} · {won(x.total)}</option>)}</select>{' '}
          <button className="btn-sm btn-plain" onClick={() => post('q', `/admin/sales/opps/${id}/quote`, { docId: qd || undefined })} data-sal-opp-quote-link="">견적서 잇기</button>
        </p>
      )}
      <p><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="메모(통화 · 방문 기록)" size={40} />{' '}
        <button className="btn-sm btn-plain" disabled={note.trim().length < 2} onClick={() => void a.run('n', () => api(`/admin/sales/opps/${id}/note`, { method: 'POST', body: JSON.stringify({ note }) }), () => { setNote(''); q.reload(); })} data-sal-opp-note="">남기기</button></p>
      <details open><summary>기록 {d.logs.length}</summary>{d.logs.map((l) => <p key={l.id}><small className="dim">{ymdhm(l.createdAt)}</small> {LOG_KO[l.kind] ?? l.kind}{l.from || l.to ? ` ${d.stages[l.from ?? ''] ?? ''} → ${d.stages[l.to ?? ''] ?? ''}` : ''} {l.note ?? ''} <small className="dim">{l.actor ?? ''}</small></p>)}</details>
    </div>
  );
}

export function SalCrm() {
  const [stage, setStage] = useState('OPEN');
  const [word, setWord] = useState('');
  const q = useApi<OppList>(`/admin/sales/opps?stage=${stage}${word ? `&q=${encodeURIComponent(word)}` : ''}`, [stage, word]);
  const a = useAct();
  const [f, setF] = useState({ ...EMPTY_OPP });
  const [sel, setSel] = useState<string | null>(null);
  const d = q.data;
  const create = () => void a.run('new', () => api<{ id: string }>('/admin/sales/opps', { method: 'POST', body: JSON.stringify({ ...f, expectedAmount: Number(f.expectedAmount || 0),
    ownerId: f.ownerId || undefined, nextAction: f.nextAction || undefined, nextActionOn: f.nextActionOn || undefined, expectedCloseOn: f.expectedCloseOn || undefined }) }), undefined)
    .then((r) => { if (r && (r as { id?: string }).id) { setF({ ...EMPTY_OPP }); setSel((r as { id: string }).id); q.reload(); } });
  return (
    <section data-sal-crm={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <div className="acts" data-sal-pipeline="">
            {d.pipeline.map((p) => <span key={p.stage} className="card pad" data-sal-pipe={p.stage}><b>{p.label}</b> {p.count}건 · {won(p.amount)}원 <small className="dim">(가중 {p.weight}% {won(p.weighted)})</small></span>)}
            <span className="card pad" data-sal-won="">이번 달 성사 <b>{d.summary.wonThisMonth}</b>건 · {won(d.summary.wonAmountThisMonth)}원 · 실패 {d.summary.lostThisMonth} · 90일 성사율 {d.summary.winRate90 == null ? '—' : `${d.summary.winRate90}%`}</span>
            {(d.summary.overdue > 0 || d.summary.dueToday > 0) && <b className="warn-text" data-sal-due="">다음 할 일 오늘 {d.summary.dueToday} · 지남 {d.summary.overdue}</b>}
          </div>
          <div className="card pad" data-sal-new="">
            <b>새 기회</b>{' '}
            <select value={f.partyId} onChange={(e) => setF({ ...f, partyId: e.target.value })} aria-label="거래처"><option value="">거래처 고르기</option>{d.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{' '}
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="기회 이름" size={22} />{' '}
            <input type="number" value={f.expectedAmount} onChange={(e) => setF({ ...f, expectedAmount: e.target.value })} placeholder="예상 매출" style={{ width: 120 }} />{' '}
            <select value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })} aria-label="담당"><option value="">담당 = 나</option>{d.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>{' '}
            <input value={f.nextAction} onChange={(e) => setF({ ...f, nextAction: e.target.value })} placeholder="다음 할 일" size={16} />{' '}
            <input type="date" value={f.nextActionOn} min={kstDay()} onChange={(e) => setF({ ...f, nextActionOn: e.target.value })} aria-label="다음 할 날짜" />{' '}
            <button className="btn-sm" disabled={!f.partyId || f.title.trim().length < 2 || a.busy === 'new'} onClick={create} data-sal-new-save="">만들기</button>
          </div>
          <p>
            <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="단계"><option value="OPEN">열린 기회</option><option value="">모두</option>{Object.entries(d.stages).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
            <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="이름 · 거래처 찾기" size={18} />
          </p>
          <table className="tbl"><thead><tr><th>거래처</th><th>기회</th><th>단계</th><th className="num">예상 매출</th><th>담당</th><th>다음 할 일</th><th>견적서</th></tr></thead>
            <tbody>{d.items.map((o) => (
              <tr key={o.id} className={sel === o.id ? 'on' : ''} onClick={() => setSel(o.id)} style={{ cursor: 'pointer' }} data-sal-opp-row={o.stage}>
                <td>{o.partyName}</td><td>{o.title}</td><td>{d.stages[o.stage] ?? o.stage}</td><td className="num">{won(o.expectedAmount)}</td><td>{o.ownerName ?? ''}</td>
                <td>{o.nextAction ?? ''} {o.nextActionOn && <span className={o.due ? 'warn-text' : 'dim'}>{o.nextActionOn}</span>}</td><td>{o.quoteDocNo ?? ''}</td></tr>))}</tbody></table>
          {sel && <OppView id={sel} list={d} onDone={q.reload} />}
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── v10.467 은행 거래내역 자동 조회 ── */
interface FeedView { on: boolean; mode: string; days: number; ready: boolean; canEdit: boolean; note: string;
  accounts: Array<{ id: string; label: string; bankStd: string; account: string; active: boolean; lastRunAt: string | null; lastResult: string | null; lastError: string | null }>;
  runs: Array<{ id: string; label: string; account: string; from: string; to: string; mode: string; result: string; total: number; added: number; dup: number; error: string | null; runBy: string | null; createdAt: string }> }

export function AcctBankFeed() {
  const q = useApi<FeedView>('/admin/acct/bank-feed');
  const a = useAct();
  const [f, setF] = useState({ label: '', bankStd: '', fintechNum: '', last4: '' });
  const [rg, setRg] = useState({ from: '', to: '' });
  const d = q.data;
  return (
    <section data-acct-bankfeed={d?.accounts.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className={d.on ? '' : 'warn-text'} data-acct-bankfeed-on={d.on ? 'on' : 'off'}>자동 조회 {d.on ? '켜짐(매일 06:40)' : '꺼짐(acct.bank_feed)'} · 방식 <b>{d.mode === 'LIVE' ? 'LIVE(금융결제원 거래내역조회)' : '간주(ASSUME · 금융결제원에 묻지 않음)'}</b>{!d.ready && <b className="warn-text"> · 사용자 토큰 · 키 · 이용기관코드 없음</b>} · 한 번에 {d.days}일</p>
          <table className="tbl"><thead><tr><th>이름</th><th>은행</th><th>계좌</th><th>쓰는지</th><th>마지막</th><th /></tr></thead>
            <tbody>{d.accounts.map((x) => (
              <tr key={x.id} data-acct-bankfeed-acc={x.active ? 'on' : 'off'}><td>{x.label}</td><td>{x.bankStd}</td><td>{x.account}</td><td>{x.active ? '씀' : '끔'}</td>
                <td>{x.lastRunAt ? `${ymdhm(x.lastRunAt)} ${x.lastResult === 'OK' ? '성공' : '실패'}` : '—'}{x.lastError && <small className="warn-text"> {x.lastError}</small>}</td>
                <td>{d.canEdit && <button className="btn-sm btn-plain" onClick={() => void a.run(`t${x.id}`, () => api(`/admin/acct/bank-feed/accounts/${x.id}`, { method: 'PUT', body: JSON.stringify({ active: !x.active }) }), q.reload)}>{x.active ? '끄기' : '켜기'}</button>}{' '}
                  {d.on && x.active && <button className="btn-sm btn-plain" onClick={() => void a.run(`r${x.id}`, () => api('/admin/acct/bank-feed/run', { method: 'POST', body: JSON.stringify({ accountId: x.id }) }), q.reload)}>이 계좌 조회</button>}</td></tr>))}</tbody></table>
          {d.canEdit && (
            <div className="card pad" data-acct-bankfeed-add="">
              <b>계좌 등록</b>{' '}
              <input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="이름(예: 기업은행 운영)" size={16} />{' '}
              <input value={f.bankStd} onChange={(e) => setF({ ...f, bankStd: e.target.value })} placeholder="은행 표준코드 3자리" size={8} />{' '}
              <input value={f.fintechNum} onChange={(e) => setF({ ...f, fintechNum: e.target.value })} placeholder="핀테크이용번호" size={26} autoComplete="off" />{' '}
              <input value={f.last4} onChange={(e) => setF({ ...f, last4: e.target.value })} placeholder="끝 4자리" size={5} />{' '}
              <button className="btn-sm" disabled={!f.label || !/^[0-9]{3}$/.test(f.bankStd) || !f.fintechNum || !/^[0-9]{4}$/.test(f.last4)}
                onClick={() => void a.run('add', () => api('/admin/acct/bank-feed/accounts', { method: 'POST', body: JSON.stringify(f) }), () => { setF({ label: '', bankStd: '', fintechNum: '', last4: '' }); q.reload(); })} data-acct-bankfeed-save="">등록</button>
              <p className="muted">핀테크이용번호는 회사 계좌를 금융결제원 오픈뱅킹에 등록할 때 받은 번호입니다(암호문으로만 저장 · 화면은 끝 4자리).</p>
            </div>
          )}
          <p data-acct-bankfeed-run="">
            <input type="date" value={rg.from} onChange={(e) => setRg({ ...rg, from: e.target.value })} aria-label="시작" />{' ~ '}
            <input type="date" value={rg.to} max={kstDay()} onChange={(e) => setRg({ ...rg, to: e.target.value })} aria-label="끝" />{' '}
            <button className="btn-sm" disabled={!d.on || a.busy === 'run'} title={d.on ? '' : '정책 › 전체 설정 acct.bank_feed 를 켜야 합니다'}
              onClick={() => void a.run('run', () => api('/admin/acct/bank-feed/run', { method: 'POST', body: JSON.stringify({ from: rg.from || undefined, to: rg.to || undefined }) }), q.reload)} data-acct-bankfeed-runall="">지금 조회(모든 계좌)</button>
            <small className="dim"> 들여온 줄은 회계 › 은행 맞추기에서 전표와 맞춥니다.</small>
          </p>
          <table className="tbl"><thead><tr><th>때</th><th>계좌</th><th>기간</th><th>방식</th><th>결과</th><th className="num">새로</th><th className="num">이미 있음</th><th>누가</th></tr></thead>
            <tbody>{d.runs.map((r) => <tr key={r.id} data-acct-bankfeed-runrow={r.result}><td>{ymdhm(r.createdAt)}</td><td>{r.label} {r.account}</td><td>{r.from} ~ {r.to}</td><td>{r.mode === 'LIVE' ? 'LIVE' : '간주'}</td>
              <td>{r.result === 'OK' ? '성공' : <b className="warn-text">실패 {r.error ?? ''}</b>}</td><td className="num">{r.added}</td><td className="num">{r.dup}</td><td>{r.runBy ?? '정기 작업'}</td></tr>)}</tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}
