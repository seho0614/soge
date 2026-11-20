/* ===== v10.509 ~ 512 (D275 · docs/647 ~ 650) ㊺ 기록 · 안전 · 운영 — web/src/app/admin/Opx.tsx 새 파일 =====
 *   OpxArchive   위험감지 › 기록 장기 보관(SB-ADM-OPX-010 · SUPER) — 묶음 · 지문 · 복원 확인 · 「디스크 밖 보관 아님」 경고
 *   OpxRisk      위험감지 › 이상 거래 점수(SB-ADM-OPX-020) — 검수 대기 · 계정별 점수 · 규칙(고치기 SUPER)
 *   OpxBulk      회원 › 일괄 처리(SB-ADM-OPX-030) — 검수 · 신고 · 1:1 문의 · 회원 여러 줄 골라 한 번에(최대 100 · 사유)
 *   OpxSwitches  정책 › 기능 스위치 한눈에(SB-ADM-OPX-040) — 읽기만 · 「전체 설정」으로 가는 길
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md) · CSS 는 기존 클래스만(tbl · card pad · btn-sm · btn-plain · muted · warn-text) — 새 색 없음
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

const num = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));
const post = (path: string, body: unknown, method = 'POST') => api(path, { method, body: JSON.stringify(body) });
const kb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.ceil(b / 1024)}KB`);

/* ═════════════ 기록 장기 보관 ═════════════ */
interface ArcItem { id: string; source: string; sourceKo: string; month: string; rows: number; bytes: number; sha256: string; manifest: string; auditSeq: string | null;
  createdAt: string; verifyOk: boolean | null; verifiedAt: string | null; s3: boolean; disposedAt: string | null; purgedAt: string | null }
interface ArcView { on: boolean; keepMonths: number; purgeMonths: number; minMonths: number; dir: string; freeMB: number | null; offsite: boolean;
  s3: { state: string; bucket: string | null; prefix: string }; counts: { bundles: number; disposed: number; rows: number }; items: ArcItem[]; warnings: string[]; note: string }

export function OpxArchive() {
  const q = useApi<ArcView>('/admin/opx/archive');
  const a = useAct();
  const d = q.data;
  return (
    <section data-opx-archive={d ? d.counts.bundles : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && d.warnings.map((w) => <div key={w} className="card pad warn" data-opx-archive-warn=""><span className="warn-text">{w}</span></div>)}
      {d && (
        <p>
          <b>{d.on ? '켜짐' : '꺼짐'}</b> · 보관 <b>{d.keepMonths}개월</b>(최소 {d.minMonths}) · DB 원래 줄 정리 <b>{d.purgeMonths ? `${d.purgeMonths}개월 뒤` : '지우지 않음'}</b>
          {' '}· 디스크 밖 <b data-opx-s3={d.s3.state}>{d.s3.state === 'ON' ? `S3 ${d.s3.bucket}/${d.s3.prefix}` : d.s3.state === 'NOT_READY' ? '준비 안 됨' : '꺼짐'}</b>
          {' '}· 보관 폴더 <code>{d.dir}</code>{d.freeMB != null && <> · 여유 {num(d.freeMB)}MB</>}{' '}
          <button className="btn-sm" disabled={!d.on || a.busy === 'run'} onClick={() => void a.run('run', () => post('/admin/opx/archive/run', {}), q.reload, (r: unknown) => `묶음 ${(r as { made?: number }).made ?? 0}개를 만들었습니다.`)} data-opx-archive-run="">지금 돌리기</button>
        </p>
      )}
      {d && <p className="muted">{d.note} 설정은 정책 › 「전체 설정」의 opx.archive · opx.archive_s3 · opx.archive_keep_months · opx.archive_db_purge_months.</p>}
      {d && (
        <table className="tbl"><thead><tr><th>달</th><th>기록</th><th className="num">줄</th><th className="num">크기</th><th>sha256</th><th>목록 지문</th><th>복원 확인</th><th>S3</th><th>상태</th><th /></tr></thead>
          <tbody>{d.items.map((r) => (
            <tr key={r.id} data-opx-bundle={r.source}>
              <td>{r.month}</td><td>{r.sourceKo}</td><td className="num">{num(r.rows)}</td><td className="num">{kb(r.bytes)}</td>
              <td><code title={r.sha256}>{r.sha256.slice(0, 12)}…</code></td><td><code title={`${r.manifest} · 감사 사슬 #${r.auditSeq ?? '—'}`}>{r.manifest.slice(0, 12)}…</code></td>
              <td>{r.verifyOk == null ? '—' : r.verifyOk ? <>맞음 <small className="muted">{ymdhm(r.verifiedAt)}</small></> : <span className="warn-text">실패</span>}</td>
              <td>{r.s3 ? '올림' : '—'}</td>
              <td>{r.disposedAt ? <span className="muted">파기 {ymdhm(r.disposedAt)}</span> : r.purgedAt ? <span className="muted">DB 정리함</span> : '보관'}</td>
              <td>{!r.disposedAt && <button className="btn-sm btn-plain" disabled={a.busy === `v${r.id}`} onClick={() => void a.run(`v${r.id}`, () => post(`/admin/opx/archive/${r.id}/verify`, {}), q.reload, (x: unknown) => ((x as { ok?: boolean }).ok ? '복원 확인 — 맞음' : '복원 확인 — 실패(운영 알림)'))} data-opx-verify={r.id}>복원 확인</button>}</td>
            </tr>))}</tbody></table>
      )}
      {d && !d.items.length && <p className="muted" data-opx-archive-empty="">아직 묶음이 없습니다{d.on ? ' — 매일 04:20 지난 달부터 묶습니다.' : ' — opx.archive 를 켜면 매일 04:20 지난 달부터 묶습니다.'}</p>}
    </section>
  );
}

/* ═════════════ 이상 거래 점수 ═════════════ */
interface Reason { code: string; name: string; points: number; value: number }
interface CaseRow { id: string; accountId: string; email: string | null; status: string; score: number; reasons: Reason[]; state: string; openedAt: string; decidedAt: string | null; note: string | null; decidedBy: string | null }
interface ScoreRow { id: string; email: string | null; status: string; score: number; reasons: Reason[]; via: string; computedAt: string; open: boolean }
interface RuleRow { code: string; name: string; description: string; param: number; paramLabel: string; points: number; active: boolean }
const reasonText = (rs: Reason[]) => rs.map((r) => `${r.name} +${r.points}`).join(' · ') || '—';

function RuleEdit({ r, onDone }: { r: RuleRow; onDone: () => void }) {
  const a = useAct();
  const [f, setF] = useState({ points: String(r.points), param: String(r.param), active: r.active });
  return (
    <span data-opx-rule-form={r.code}>
      <Flash msg={a.msg} err={a.err} />
      <input type="number" value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} style={{ width: 56 }} aria-label="점수" />{' '}
      <input type="number" value={f.param} onChange={(e) => setF({ ...f, param: e.target.value })} style={{ width: 64 }} aria-label="기준값" /> {r.paramLabel}{' '}
      <label><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> 켬</label>{' '}
      <button className="btn-sm" disabled={a.busy === 's'} onClick={() => void a.run('s', () => post(`/admin/opx/risk/rules/${r.code}`, { points: Number(f.points), param: Number(f.param), active: f.active }, 'PUT'), onDone)} data-opx-rule-save={r.code}>저장</button>
    </span>
  );
}

export function OpxRisk({ isSuper }: { isSuper: boolean }) {
  const [view, setView] = useState<'cases' | 'scores' | 'rules'>('cases');
  const [state, setState] = useState('OPEN');
  const cases = useApi<{ state: string; items: CaseRow[] }>(`/admin/opx/risk/cases?state=${state}`, [state]);
  const scores = useApi<{ items: ScoreRow[]; counts: { total: number; high: number; open: number } }>('/admin/opx/risk/scores?min=1');
  const rules = useApi<{ rules: RuleRow[]; on: boolean; threshold: number; note: string }>('/admin/opx/risk/rules');
  const a = useAct();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [edit, setEdit] = useState<string | null>(null);
  const decide = (id: string, result: string) => void a.run(`d${id}`, () => post(`/admin/opx/risk/cases/${id}/decide`, { result, note: notes[id] ?? '' }), () => { cases.reload(); scores.reload(); });
  return (
    <section data-opx-risk={view}>
      <Flash msg={a.msg} err={a.err} />
      <p>
        {(['cases', 'scores', 'rules'] as const).map((v) => <button key={v} className={`btn-sm ${view === v ? '' : 'btn-plain'}`} onClick={() => setView(v)} data-opx-risk-view={v}>{v === 'cases' ? '검수 대기' : v === 'scores' ? '계정별 점수' : '규칙'}</button>)}{' '}
        {rules.data && <span className="muted">점수 셈 <b>{rules.data.on ? '켜짐' : '꺼짐'}</b> · 기준 {rules.data.threshold}점{scores.data && <> · 센 계정 {num(scores.data.counts.total)} · 기준 넘음 {num(scores.data.counts.high)} · 열린 검수 대기 {num(scores.data.counts.open)}</>}</span>}
      </p>
      <p className="muted">점수는 운영 화면에만 있고 회원에게는 보이지 않습니다. 정지 · 매물 내림 같은 조치는 회원 · 검수 화면에서 하고 여기서 「조치함」으로 끝냅니다.</p>
      {view === 'cases' && (
        <>
          <p><select value={state} onChange={(e) => setState(e.target.value)} aria-label="상태" data-opx-case-state=""><option value="OPEN">열림</option><option value="CLEARED">문제없음</option><option value="ACTIONED">조치함</option></select></p>
          <table className="tbl"><thead><tr><th>#</th><th>계정</th><th className="num">점수</th><th>까닭</th><th>열린 때</th><th>{state === 'OPEN' ? '끝내기' : '판단'}</th></tr></thead>
            <tbody>{(cases.data?.items ?? []).map((c) => (
              <tr key={c.id} data-opx-case={c.id}>
                <td>{c.id}</td><td>{c.email}{c.status !== 'ACTIVE' && <small className="muted"> ({c.status === 'SUSPENDED' ? '정지' : c.status})</small>}</td><td className="num"><b>{c.score}</b></td>
                <td>{reasonText(c.reasons)}</td><td>{ymdhm(c.openedAt)}</td>
                <td>{c.state === 'OPEN'
                  ? <><input value={notes[c.id] ?? ''} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} placeholder="판단 사유" size={14} aria-label="판단 사유" />{' '}
                    <button className="btn-sm btn-plain" disabled={a.busy === `d${c.id}`} onClick={() => decide(c.id, 'CLEARED')} data-opx-case-clear={c.id}>문제없음</button>{' '}
                    <button className="btn-sm" disabled={a.busy === `d${c.id}`} onClick={() => decide(c.id, 'ACTIONED')} data-opx-case-act={c.id}>조치함</button></>
                  : <>{c.state === 'CLEARED' ? '문제없음' : '조치함'} · {c.note} <small className="muted">{c.decidedBy} {ymdhm(c.decidedAt)}</small></>}</td>
              </tr>))}</tbody></table>
          {cases.data && !cases.data.items.length && <p className="muted">없습니다.</p>}
        </>
      )}
      {view === 'scores' && (
        <table className="tbl"><thead><tr><th>계정</th><th className="num">점수</th><th>까닭</th><th>셈</th><th /></tr></thead>
          <tbody>{(scores.data?.items ?? []).map((s) => (
            <tr key={s.id} data-opx-score={s.score}>
              <td>{s.email}{s.open && <small className="warn-text"> 검수 대기</small>}</td><td className="num"><b>{s.score}</b></td><td>{reasonText(s.reasons)}</td>
              <td><small className="muted">{s.via === 'EVENT' ? '등록 · 신고 때' : s.via === 'SWEEP' ? '매일' : '직접'} {ymdhm(s.computedAt)}</small></td>
              <td><button className="btn-sm btn-plain" disabled={a.busy === `r${s.id}`} onClick={() => void a.run(`r${s.id}`, () => post(`/admin/opx/risk/recompute/${s.id}`, {}), scores.reload)}>다시 셈</button></td>
            </tr>))}</tbody></table>
      )}
      {view === 'rules' && rules.data && (
        <>
          <p className="muted">{rules.data.note}</p>
          <table className="tbl"><thead><tr><th>규칙</th><th>뜻</th><th className="num">점수</th><th className="num">기준값</th><th>켬</th><th /></tr></thead>
            <tbody>{rules.data.rules.map((r) => (
              <tr key={r.code} data-opx-rule={r.code}>
                <td>{r.name} <small className="muted">{r.code}</small></td><td>{r.description}</td><td className="num">{r.points}</td><td className="num">{r.param} {r.paramLabel}</td><td>{r.active ? '켬' : '끔'}</td>
                <td>{isSuper && (edit === r.code ? <RuleEdit r={r} onDone={() => { setEdit(null); rules.reload(); }} /> : <button className="btn-sm btn-plain" onClick={() => setEdit(r.code)} data-opx-rule-edit={r.code}>고치기</button>)}</td>
              </tr>))}</tbody></table>
        </>
      )}
    </section>
  );
}

/* ═════════════ 일괄 처리 ═════════════ */
type Kind = 'REVIEW' | 'REPORT' | 'INQUIRY' | 'MEMBER';
interface Row { id: string; label: string; sub: string }
const KIND_KO: Record<Kind, string> = { REVIEW: '검수', REPORT: '신고', INQUIRY: '1:1 문의', MEMBER: '회원' };
const ACTIONS: Record<Kind, Array<[string, string]>> = {
  REVIEW: [['APPROVE', '승인'], ['REJECT', '반려']], REPORT: [['UPHOLD', '인정'], ['DISMISS', '기각']],
  INQUIRY: [['CLOSE', '닫기'], ['REOPEN', '다시 열기'], ['ASSIGN', '담당 정하기']], MEMBER: [['SUSPEND', '정지'], ['ACTIVATE', '정상으로']],
};
const PATH: Record<Kind, string> = { REVIEW: '/admin/opx/bulk/reviews', REPORT: '/admin/opx/bulk/reports', INQUIRY: '/admin/opx/bulk/inquiries', MEMBER: '/admin/opx/bulk/members' };
const LIST: Record<Kind, string> = { REVIEW: '/admin/reviews?status=QUEUED', REPORT: '/admin/report-queue', INQUIRY: '/admin/inquiries?status=OPEN', MEMBER: '/admin/accounts?limit=100' };

function rowsOf(kind: Kind, data: unknown): Row[] {
  const list = (Array.isArray(data) ? data : ((data as { items?: unknown[] } | null)?.items ?? [])) as Array<Record<string, unknown>>;
  return list.map((r) => {
    const s = (k: string) => (r[k] == null ? '' : String(r[k]));
    if (kind === 'REVIEW') return { id: s('id'), label: `${s('targetType')} ${s('gwanCode')}`, sub: `접수 ${ymdhm(s('submittedAt'))} · 기한 ${ymdhm(s('slaDueAt'))}` };
    if (kind === 'REPORT') return { id: s('id'), label: `${s('reasonLabel') || s('reasonCode')} · ${s('targetType')}`, sub: `${ymdhm(s('createdAt'))} · 같은 대상 ${s('sameTarget')}건` };
    if (kind === 'INQUIRY') return { id: s('id'), label: s('title'), sub: `${s('categoryLabel') || s('category')} · ${s('email')} · ${ymdhm(s('createdAt'))}` };
    return { id: s('id'), label: `${s('name')} ${s('email')}`, sub: `${s('status') === 'SUSPENDED' ? '정지' : '정상'} · 가입 ${ymdhm(s('createdAt'))}` };
  });
}

export function OpxBulk({ roles }: { roles: string[] }) {
  const admin = roles.includes('ADMIN') || roles.includes('SUPER');
  const kinds = (['REVIEW', 'REPORT', 'INQUIRY', 'MEMBER'] as Kind[]).filter((k) => admin || k === 'REVIEW');
  const [kind, setKind] = useState<Kind>(kinds[0] ?? 'REVIEW');
  const list = useApi<unknown>(LIST[kind], [kind]);
  const runs = useApi<{ items: Array<{ id: string; kind: string; action: string; reason: string; total: number; ok: number; failed: number; createdAt: string; who: string | null }>; max: number }>('/admin/opx/bulk/runs');
  const a = useAct();
  const [pick, setPick] = useState<string[]>([]);
  const [action, setAction] = useState(ACTIONS[kind][0]![0]);
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [assignee, setAssignee] = useState('');
  const [last, setLast] = useState<Array<{ id: string; ok: boolean; code?: string; message?: string }>>([]);
  const rows = rowsOf(kind, list.data);
  const toggle = (id: string) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 100 ? p : [...p, id]));
  const go = () => void a.run('b', async () => {
    const r = await post(PATH[kind], { ids: pick, action, reason, ...(kind === 'REVIEW' && action === 'REJECT' ? { reasonCode: code } : {}), ...(kind === 'INQUIRY' && action === 'ASSIGN' ? { assigneeId: assignee } : {}) }) as { results?: Array<{ id: string; ok: boolean; code?: string; message?: string }> };
    setLast(r.results ?? []); return r;
  }, () => { setPick([]); list.reload(); runs.reload(); });
  return (
    <section data-opx-bulk={kind}>
      <Flash msg={a.msg} err={a.err} />
      <p>{kinds.map((k) => <button key={k} className={`btn-sm ${kind === k ? '' : 'btn-plain'}`} onClick={() => { setKind(k); setPick([]); setAction(ACTIONS[k][0]![0]); setLast([]); }} data-opx-bulk-kind={k}>{KIND_KO[k]}</button>)}</p>
      <p className="muted">줄을 골라(한 번 최대 100) 처리와 사유를 넣습니다. 한 줄씩 그 화면의 한 건 처리와 똑같이 돌고, 감사 기록도 줄마다 남습니다. 실패한 줄은 아래에 까닭이 나옵니다.{kind === 'REPORT' && ' 신고 처리 내용(사유)은 신고한 사람에게 그대로 전달됩니다.'}</p>
      <div className="card pad" data-opx-bulk-form="">
        <b>{pick.length}줄 고름</b>{' '}
        <button className="btn-sm btn-plain" onClick={() => setPick(rows.slice(0, 100).map((r) => r.id))} data-opx-bulk-all="">보이는 줄 모두(100까지)</button>{' '}
        <button className="btn-sm btn-plain" onClick={() => setPick([])}>고름 풀기</button>{' '}
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="처리" data-opx-bulk-action="">{ACTIONS[kind].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{' '}
        {kind === 'REVIEW' && action === 'REJECT' && <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="반려 사유 코드" size={14} aria-label="반려 사유 코드" />}
        {kind === 'INQUIRY' && action === 'ASSIGN' && <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="담당 운영자 번호(빈칸 = 없음)" size={20} aria-label="담당" />}{' '}
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(2자 이상)" size={24} aria-label="사유" data-opx-bulk-reason="" />{' '}
        <button className="btn-sm" disabled={!pick.length || reason.trim().length < 2 || a.busy === 'b'} onClick={go} data-opx-bulk-go="">{pick.length}줄 처리</button>
      </div>
      {!!last.filter((r) => !r.ok).length && (
        <div className="card pad warn" data-opx-bulk-fail={last.filter((r) => !r.ok).length}>
          {last.filter((r) => !r.ok).map((r) => <div key={r.id}><code>{r.id.slice(0, 8)}</code> <span className="warn-text">{r.code}</span> {r.message}</div>)}
        </div>
      )}
      <table className="tbl"><thead><tr><th /><th>대상</th><th>내용</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} data-opx-bulk-row={r.id}>
            <td><input type="checkbox" checked={pick.includes(r.id)} onChange={() => toggle(r.id)} aria-label="고르기" /></td><td>{r.label}</td><td><small className="muted">{r.sub}</small></td>
          </tr>))}</tbody></table>
      {list.data != null && !rows.length && <p className="muted">처리할 줄이 없습니다.</p>}
      {runs.data && !!runs.data.items.length && (
        <details><summary>최근 일괄 처리 {runs.data.items.length}번</summary>
          <table className="tbl"><thead><tr><th>#</th><th>종류</th><th>처리</th><th>사유</th><th className="num">됨</th><th className="num">실패</th><th>누가 · 언제</th></tr></thead>
            <tbody>{runs.data.items.map((r) => <tr key={r.id}><td>{r.id}</td><td>{KIND_KO[r.kind as Kind] ?? r.kind}</td><td>{r.action}</td><td>{r.reason}</td><td className="num">{r.ok}</td><td className="num">{r.failed}</td><td>{r.who} {ymdhm(r.createdAt)}</td></tr>)}</tbody></table>
        </details>
      )}
    </section>
  );
}

/* ═════════════ 기능 스위치 한눈에 ═════════════ */
interface SwRow { key: string; group: string; value: string; initial: string | null; changed: boolean; state: string; choices: string[]; cond: string | null; docRef: string | null;
  who: string | null; description: string | null; lastAt: string | null; lastBy: string | null; lastReason: string | null }
interface SwView { items: SwRow[]; counts: { all: number; on: number; assume: number; changed: number; noCond: number; docOnly: number }; note: string }

export function OpxSwitches({ onGo }: { onGo?: (t: 'settings') => void }) {
  const q = useApi<SwView>('/admin/opx/switches');
  const [text, setText] = useState('');
  const [only, setOnly] = useState('');
  const d = q.data;
  const items = (d?.items ?? []).filter((r) => (!text || r.key.includes(text) || (r.description ?? '').includes(text) || (r.cond ?? '').includes(text))
    && (!only || (only === 'changed' ? r.changed : only === 'nocond' ? !r.cond : r.state === only)));
  return (
    <section data-opx-switches={d ? d.counts.all : ''}>
      {d && <p>스위치 <b>{d.counts.all}</b> · 켜짐 {d.counts.on} · 간주 {d.counts.assume} · 처음과 다름 <b>{d.counts.changed}</b> · 켤 조건 없음 {d.counts.noCond}{' '}
        {onGo && <button className="btn-sm btn-plain" onClick={() => onGo('settings')} data-opx-go-settings="">「전체 설정」에서 고치기</button>}</p>}
      {d && <p className="muted">{d.note}</p>}
      <p>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="키 · 설명 · 조건 찾기" size={20} aria-label="찾기" data-opx-sw-search="" />{' '}
        <select value={only} onChange={(e) => setOnly(e.target.value)} aria-label="거르기" data-opx-sw-filter="">
          <option value="">모두</option><option value="ON">켜짐</option><option value="OFF">꺼짐</option><option value="ASSUME">간주</option><option value="changed">처음과 다름</option><option value="nocond">켤 조건 없음</option>
        </select>
      </p>
      <table className="tbl"><thead><tr><th>설정 키</th><th>지금</th><th>처음</th><th>켤 조건 · 문서</th><th>마지막 바꿈</th></tr></thead>
        <tbody>{items.map((r) => (
          <tr key={r.key} data-opx-sw={r.key} data-opx-sw-state={r.state}>
            <td><code>{r.key}</code>{r.description && <div><small className="muted">{r.description.slice(0, 90)}{r.description.length > 90 ? '…' : ''}</small></div>}</td>
            <td><b>{r.value || '(빈 값)'}</b> <small className="muted">{r.choices.join(' · ')}</small></td>
            <td>{r.initial ?? '—'}{r.changed && <small className="warn-text"> 바뀜</small>}</td>
            <td>{r.cond ?? <span className="muted">—</span>}{r.docRef && <small className="muted"> ({r.docRef})</small>}</td>
            <td>{r.lastAt ? <><small>{ymdhm(r.lastAt)} · {r.lastBy ?? '—'}</small>{r.lastReason && <div><small className="muted">{r.lastReason}</small></div>}</> : <span className="muted">바뀐 적 없음</span>}</td>
          </tr>))}</tbody></table>
    </section>
  );
}
