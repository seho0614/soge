/* ===== v10.573 ~ 576 (docs/715 ~ 718) 11차 회원 · 거래 — web/src/app/admin/Mtr.tsx 새 파일 =====
 *   MtrAppeals  위험감지 › 이의 제기(SB-ADM-MTR-010) — 열린 것 기한 순 · 신고 목록(신고한 사람 없음) · 받아들임 · 받아들이지 않음(사유)
 *   MtrReviews  위험감지 › 가짜 후기 의심(SB-ADM-MTR-020) — 점수 순 · 신호 · 같은 대상 다른 후기 · 가짜 · 문제없음(사유) · 지금 보기
 *   MtrTrust    회원 › 소개자 신뢰 점수(SB-ADM-MTR-030) — 분포 · 한 사람 찾기 · 산식(SUPER 고침) · 지금 셈
 *   MtrDormant  회원 › 휴면 계정(SB-ADM-MTR-040) — 알림 · 휴면 · 풀림 · 미리 보기 · 풀기(SUPER)
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md) · CSS 는 기존 클래스만(tbl · card pad · btn-sm · btn-plain · muted · warn-text · num) — 새 색 없음
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

const post = (path: string, body: unknown, method = 'POST') => api(path, { method, body: JSON.stringify(body) });

interface Settings {
  appeal: boolean; appealDays: number; appealSlaHours: number;
  reviewWatch: boolean; reviewThreshold: number; reviewBurstCount: number; reviewBurstHours: number; reviewSimilarPct: number; reviewScanDays: number;
  trust: boolean; dormant: boolean; dormantDays: number; dormantNoticeDays: number; dormantMail: boolean;
}
interface Overview { settings: Settings; counts: { appealOpen: number; appealOverdue: number; reviewOpen: number; trustCounted: number; dormantNoticed: number; dormant: number } }

/** 설정 바꾸기(SUPER) — 바꾼 칸만 · 사유 */
function MtrSettingsBox({ fields, s, onDone }: { fields: Array<[keyof Settings, string, 'bool' | 'int']>; s: Settings; onDone: () => void }) {
  const a = useAct();
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(([k]) => [k, String(s[k])])));
  const [reason, setReason] = useState('');
  const save = () => {
    const body: Record<string, unknown> = { reason };
    for (const [k, , t] of fields) {
      const v = f[k] ?? '';
      if (v === String(s[k])) continue;
      body[k] = t === 'bool' ? v === 'true' : Number(v);
    }
    void a.run('set', () => post('/admin/mtr/settings', body, 'PUT'), onDone);
  };
  return (
    <div className="card pad" data-mtr-settings="">
      <Flash msg={a.msg} err={a.err} />
      <b>설정(SUPER)</b>{' '}
      {fields.map(([k, label, t]) => (
        <label key={k} style={{ marginRight: 12 }}>
          {label}{' '}
          {t === 'bool' ? (
            <select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-mtr-set={k}><option value="false">끔</option><option value="true">켬</option></select>
          ) : (
            <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} size={6} data-mtr-set={k} />
          )}
        </label>
      ))}
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(2자 이상 · 전체 설정 기록에 남음)" size={28} />{' '}
      <button className="btn-sm" disabled={a.busy === 'set' || reason.trim().length < 2} onClick={save} data-mtr-settings-save="">저장</button>
    </div>
  );
}

/* ═════════════ 이의 제기 ═════════════ */
const TT_KO: Record<string, string> = { LISTING: '매물', POST: '소개광장 글', COMMENT: '댓글' };
const NOW_KO: Record<string, string> = { REJECTED: '반려', SUSPENDED: '정지', HIDDEN: '감춤', PUBLISHED: '게시', IN_REVIEW: '검수 대기', DELETED: '작성자가 지움', ARCHIVED: '내림' };
const RST_KO: Record<string, string> = { OPEN: '처리 전', QUEUED: '검수 대기', UPHELD: '인정', DISMISSED: '기각' };
interface ApRow { id: string; targetType: string; targetId: string; body: string; targetState: string | null; state: string; dueAt: string; overdue: boolean; createdAt: string;
  decisionNote: string | null; decidedAt: string | null; restored: string | null; dismissedReports: number; authorHead: string; targetTitle: string | null; targetNow: string | null;
  hiddenReason: string | null; reports: Array<{ reasonCode: string; label: string | null; state: string; detail: string; resolution: string | null; createdAt: string }> }
interface ApView { state: string; on: boolean; appealDays: number; slaHours: number; counts: { open: number; overdue: number; accepted: number; rejected: number }; rows: ApRow[] }

function AppealDecide({ row, onDone }: { row: ApRow; onDone: () => void }) {
  const a = useAct();
  const [note, setNote] = useState('');
  const go = (accept: boolean) => {
    if (accept && !window.confirm(row.targetType === 'LISTING' ? '받아들이면 매물을 검수 대기로 돌리고 이 매물 신고를 기각으로 닫습니다. 할까요?' : '받아들이면 다시 보이게 하고 이 대상 신고를 기각으로 닫습니다. 할까요?')) return;
    void a.run(accept ? 'y' : 'n', () => post(`/admin/mtr/appeals/${row.id}/decide`, { accept, note }), onDone);
  };
  return (
    <span data-mtr-appeal-decide={row.id}>
      <Flash msg={a.msg} err={a.err} />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="사유(작성자에게 보임 · 2자 이상)" size={26} />{' '}
      <button className="btn-sm" disabled={!!a.busy || note.trim().length < 2} onClick={() => go(true)} data-mtr-appeal-accept={row.id}>받아들임</button>{' '}
      <button className="btn-sm btn-plain" disabled={!!a.busy || note.trim().length < 2} onClick={() => go(false)} data-mtr-appeal-reject={row.id}>받아들이지 않음</button>
    </span>
  );
}

export function MtrAppeals() {
  const [state, setState] = useState('OPEN');
  const q = useApi<ApView>(`/admin/mtr/appeals?state=${state}`, [state]);
  const ov = useApi<Overview>('/admin/mtr/overview');
  const d = q.data; const o = ov.data;
  const reload = () => { q.reload(); ov.reload(); };
  return (
    <section data-mtr-appeals={state}>
      {d && <p className={d.on ? 'muted' : 'warn-text'}>이의 제기 {d.on ? '켬' : '꺼짐'} · 내려간 뒤 {d.appealDays}일 안 · 처리 기한 {d.slaHours}시간 · 열린 {d.counts.open} · 기한 넘김 {d.counts.overdue} · 최근 30일 받아들임 {d.counts.accepted} · 받아들이지 않음 {d.counts.rejected}</p>}
      <p>{(['OPEN', 'ACCEPTED', 'REJECTED'] as const).map((s) => (
        <button key={s} className={`btn-sm${state === s ? '' : ' btn-plain'}`} onClick={() => setState(s)} data-mtr-appeal-state={s}>
          {{ OPEN: '처리 전', ACCEPTED: '받아들임', REJECTED: '받아들이지 않음' }[s]}</button>))}</p>
      {d && (d.rows.length ? (
        <table className="tbl"><thead><tr><th>기한</th><th>대상</th><th>신고</th><th>이의</th><th>결정</th></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.id} data-mtr-appeal-row={r.id}>
              <td className={r.overdue ? 'warn-text' : ''}>{ymdhm(r.dueAt)}{r.overdue ? ' · 넘김' : ''}</td>
              <td>{TT_KO[r.targetType] ?? r.targetType} · {r.targetTitle ?? '—'}<br /><small className="muted">낼 때 {NOW_KO[r.targetState ?? ''] ?? r.targetState ?? '—'} · 지금 {NOW_KO[r.targetNow ?? ''] ?? r.targetNow ?? '—'}{r.hiddenReason ? ` · 감춘 사유: ${r.hiddenReason}` : ''}</small></td>
              <td><ul>{r.reports.map((x, i) => <li key={i}>{x.label ?? x.reasonCode} · {RST_KO[x.state] ?? x.state}{x.detail ? ` · ${x.detail}` : ''}{x.resolution ? <><br /><small className="muted">처리: {x.resolution}</small></> : null}</li>)}</ul></td>
              <td>{r.authorHead} · {ymdhm(r.createdAt)}<br />{r.body}</td>
              <td>{r.state === 'OPEN' ? <AppealDecide row={r} onDone={reload} />
                : <span className="muted">{ymdhm(r.decidedAt)} · {r.decisionNote}{r.restored ? ` · ${NOW_KO[r.restored] ?? r.restored}` : ''}{r.dismissedReports ? ` · 신고 ${r.dismissedReports}건 기각` : ''}</span>}</td>
            </tr>))}</tbody></table>
      ) : <p className="muted">해당하는 이의 제기가 없습니다.</p>)}
      {o && <MtrSettingsBox s={o.settings} onDone={reload} fields={[['appeal', '이의 제기', 'bool'], ['appealDays', '낼 수 있는 날', 'int'], ['appealSlaHours', '처리 기한(시간)', 'int']]} />}
    </section>
  );
}

/* ═════════════ 가짜 후기 의심 ═════════════ */
interface RvRow { id: string; kind: string; reviewId: string; targetKey: string; signals: string[]; score: number; detail: Record<string, unknown>; state: string; hidden: boolean; note: string | null;
  decidedAt: string | null; createdAt: string; author: string; authorHead: string; authorJoined: string; rating: number | null; body: string | null; productName: string | null; reviewState: string | null }
interface RvView { state: string; on: boolean; threshold: number; burstCount: number; burstHours: number; similarPct: number; scanDays: number;
  points: Record<string, number>; signalNames: Record<string, string>; counts: { open: number; fake: number; ok: number }; rows: RvRow[] }
interface RvDetail { id: number; kind: string; reviewId: string; others: Array<{ id: string; rating: number; body: string; createdAt: string; author: string; flagState: string | null; self: boolean }> }

function ReviewDecide({ row, onDone }: { row: RvRow; onDone: () => void }) {
  const a = useAct();
  const [note, setNote] = useState('');
  const [hide, setHide] = useState(false);
  return (
    <span data-mtr-review-decide={row.id}>
      <Flash msg={a.msg} err={a.err} />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="사유(2자 이상)" size={20} />{' '}
      {row.kind === 'HLT' && <label><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> 가짜면 리뷰 가림</label>}{' '}
      <button className="btn-sm" disabled={!!a.busy || note.trim().length < 2} onClick={() => void a.run('f', () => post(`/admin/mtr/reviews/${row.id}/decide`, { verdict: 'FAKE', note, hide: row.kind === 'HLT' && hide }), onDone)} data-mtr-review-fake={row.id}>가짜</button>{' '}
      <button className="btn-sm btn-plain" disabled={!!a.busy || note.trim().length < 2} onClick={() => void a.run('o', () => post(`/admin/mtr/reviews/${row.id}/decide`, { verdict: 'OK', note }), onDone)} data-mtr-review-ok={row.id}>문제없음</button>
    </span>
  );
}

/** 같은 대상의 다른 후기(최근 20) — 열 때만 부름 */
function ReviewOthers({ id }: { id: string }) {
  const q = useApi<RvDetail>(`/admin/mtr/reviews/${id}`, [id]);
  if (!q.data) return null;
  return (
    <div className="card pad" data-mtr-review-detail={id}>
      <b>같은 대상의 다른 후기(최근 20)</b>
      <ul>{q.data.others.map((x) => <li key={x.id}>{x.self ? '▶ ' : ''}{ymdhm(x.createdAt)} · {x.author} · 별 {x.rating}{x.flagState ? ` · ${x.flagState}` : ''} — {x.body || '—'}</li>)}</ul>
    </div>
  );
}

export function MtrReviews() {
  const [state, setState] = useState('OPEN');
  const [open, setOpen] = useState<string | null>(null);
  const q = useApi<RvView>(`/admin/mtr/reviews?state=${state}`, [state]);
  const ov = useApi<Overview>('/admin/mtr/overview');
  const scan = useAct();
  const d = q.data; const o = ov.data;
  const reload = () => { q.reload(); ov.reload(); };
  return (
    <section data-mtr-reviews={state}>
      {d && <p className={d.on ? 'muted' : 'warn-text'}>가짜 후기 탐지 {d.on ? '켬(매시간)' : '꺼짐'} · 기준 {d.threshold}점 · 몰림 {d.burstHours}시간 안 {d.burstCount}건 · 비슷한 문장 {d.similarPct}% · 최근 {d.scanDays}일 · 점수 {Object.entries(d.points).map(([k, v]) => `${d.signalNames[k] ?? k} ${v}`).join(' · ')} · 자동 삭제 없음</p>}
      <p>{(['OPEN', 'FAKE', 'OK'] as const).map((s) => (
        <button key={s} className={`btn-sm${state === s ? '' : ' btn-plain'}`} onClick={() => setState(s)} data-mtr-review-state={s}>
          {{ OPEN: '확인 전', FAKE: '가짜', OK: '문제없음' }[s]} {d?.counts[s === 'OPEN' ? 'open' : s === 'FAKE' ? 'fake' : 'ok'] ?? 0}</button>))}{' '}
        <button className="btn-sm btn-plain" disabled={!!scan.busy} onClick={() => void scan.run('s', () => api('/admin/mtr/reviews/scan', { method: 'POST', body: '{}' }), reload, (r: unknown) => { const x = r as { scanned: number; flagged: number; added: number }; return `본 후기 ${x.scanned} · 의심 ${x.flagged} · 새로 ${x.added}`; })} data-mtr-review-scan="">지금 보기</button>
        <Flash msg={scan.msg} err={scan.err} /></p>
      {d && (d.rows.length ? (
        <table className="tbl"><thead><tr><th>점수</th><th>신호</th><th>후기</th><th>작성자</th><th>결정</th></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.id} data-mtr-review-row={r.id}>
              <td className="num"><b>{r.score}</b></td>
              <td>{r.signals.map((x) => d.signalNames[x] ?? x).join(' · ')}</td>
              <td>{r.kind === 'DEAL' ? '거래 후기' : `소개몰 리뷰 · ${r.productName ?? ''}`} · 별 {r.rating ?? '—'}{r.reviewState === 'HIDDEN' ? ' · 가려짐' : ''}<br /><small className="muted">{r.body || '—'}</small><br />
                <button className="btn-sm btn-plain" onClick={() => setOpen(open === r.id ? null : r.id)} data-mtr-review-open={r.id}>같은 대상 후기</button></td>
              <td>{r.author} · {r.authorHead}<br /><small className="muted">가입 {ymdhm(r.authorJoined)}</small></td>
              <td>{r.state === 'OPEN' ? <ReviewDecide row={r} onDone={reload} /> : <span className="muted">{ymdhm(r.decidedAt)} · {r.note}{r.hidden ? ' · 가림' : ''}</span>}</td>
            </tr>))}</tbody></table>
      ) : <p className="muted">해당하는 의심 후기가 없습니다.</p>)}
      {open && <ReviewOthers id={open} />}
      {o && <MtrSettingsBox s={o.settings} onDone={reload} fields={[['reviewWatch', '탐지', 'bool'], ['reviewThreshold', '기준 점수', 'int'], ['reviewBurstCount', '몰림 건수', 'int'], ['reviewBurstHours', '몰림 시간', 'int'], ['reviewSimilarPct', '비슷함 %', 'int'], ['reviewScanDays', '보는 날', 'int']]} />}
    </section>
  );
}

/* ═════════════ 소개자 신뢰 점수 ═════════════ */
interface TrustItem { code: string; label: string; max: number; got: number; basis: Record<string, unknown> }
interface TrustRule { code: string; label: string; points: string; fullAt: string | null; note: string | null; sort: number; updatedAt: string }
interface TrustView { on: boolean; rules: TrustRule[]; bands: Array<{ from: number; to: number; n: number }>; counted: number; avg: number | null; lastComputedAt: string | null; note: string }
interface TrustOne { accountId: string; email: string; nameHead: string; status: string; joinedAt: string; score: number; sample: number; items: TrustItem[]; snapshot: { score: number; computedAt: string } | null }

/** 근거 한 줄 — 칸마다 근거 수를 글로 */
export function trustBasisText(it: TrustItem): string {
  const b = it.basis as Record<string, number | boolean | null>;
  switch (it.code) {
    case 'IDENTITY': case 'BUSINESS': return b.verified ? '마침' : '안 함';
    case 'DEAL': return `성사 ${b.deals ?? 0}건 / 기준 ${b.fullAt ?? '—'}건`;
    case 'REVIEW': return `후기 ${b.reviews ?? 0}건 · 평균 ${b.avg ?? 0} / 기준 ${b.fullAt ?? '—'}건`;
    case 'RESPONSE': return b.enough ? `대화 ${b.conversations ?? 0}건 · 첫 답 가운데 ${b.medianHours ?? 0}시간 / 기준 ${b.fullAt ?? '—'}시간` : `대화 ${b.conversations ?? 0}건 — 3건 미만(표본 부족)`;
    case 'REPORT': return `인정된 신고 ${b.upheld ?? 0}건(1년) / 기준 ${b.fullAt ?? '—'}건`;
    default: return '모든 회원 같음';
  }
}

function TrustRulesBox({ rules, onDone }: { rules: TrustRule[]; onDone: () => void }) {
  const a = useAct();
  const [f, setF] = useState<Record<string, { points: string; fullAt: string }>>(() => Object.fromEntries(rules.map((r) => [r.code, { points: r.points, fullAt: r.fullAt ?? '' }])));
  const [reason, setReason] = useState('');
  const save = () => {
    const out: Array<{ code: string; points?: number; fullAt?: number }> = [];
    for (const r of rules) {
      const v = f[r.code]!; const x: { code: string; points?: number; fullAt?: number } = { code: r.code };
      if (v.points !== r.points) x.points = Number(v.points);
      if (r.fullAt !== null && v.fullAt !== r.fullAt) x.fullAt = Number(v.fullAt);
      if (x.points !== undefined || x.fullAt !== undefined) out.push(x);
    }
    void a.run('r', () => post('/admin/mtr/trust/rules', { rules: out, reason }, 'PUT'), onDone);
  };
  return (
    <div className="card pad" data-mtr-trust-rules="">
      <Flash msg={a.msg} err={a.err} />
      <b>산식(SUPER 가 고침 · 초안)</b>
      <table className="tbl"><thead><tr><th>칸</th><th>점수</th><th>다 주는 기준</th><th>설명</th></tr></thead>
        <tbody>{rules.map((r) => (
          <tr key={r.code}>
            <td>{r.label}</td>
            <td><input value={f[r.code]?.points ?? ''} onChange={(e) => setF({ ...f, [r.code]: { ...f[r.code]!, points: e.target.value } })} size={5} data-mtr-rule-points={r.code} /></td>
            <td>{r.fullAt === null ? '—' : <input value={f[r.code]?.fullAt ?? ''} onChange={(e) => setF({ ...f, [r.code]: { ...f[r.code]!, fullAt: e.target.value } })} size={6} data-mtr-rule-full={r.code} />}</td>
            <td><small className="muted">{r.note}</small></td>
          </tr>))}</tbody></table>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(2자 이상)" size={28} />{' '}
      <button className="btn-sm" disabled={!!a.busy || reason.trim().length < 2} onClick={save} data-mtr-rules-save="">산식 저장</button>
    </div>
  );
}

export function MtrTrust() {
  const q = useApi<TrustView>('/admin/mtr/trust');
  const ov = useApi<Overview>('/admin/mtr/overview');
  const [email, setEmail] = useState('');
  const [one, setOne] = useState<TrustOne | null>(null);
  const a = useAct();
  const d = q.data; const o = ov.data;
  const reload = () => { q.reload(); ov.reload(); };
  return (
    <section data-mtr-trust="">
      {d && <p className={d.on ? 'muted' : 'warn-text'}>신뢰 점수 {d.on ? '켬(매일 · 나의공간에 보임)' : '꺼짐(운영 미리 보기만)'} · 센 회원 {d.counted} · 평균 {d.avg ?? '—'} · 마지막 셈 {ymdhm(d.lastComputedAt)} — {d.note}</p>}
      {d && (
        <table className="tbl" data-mtr-trust-bands=""><thead><tr><th>점수</th><th>회원 수</th></tr></thead>
          <tbody>{d.bands.map((b) => (
            <tr key={b.from}><td className="num">{b.from} ~ {b.to}</td><td className="num">{b.n}</td></tr>))}</tbody></table>
      )}
      <p>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="회원 이메일" size={28} data-mtr-trust-email="" />{' '}
        <button className="btn-sm" disabled={!!a.busy || !email.includes('@')} onClick={() => void a.run('l', () => api<TrustOne>(`/admin/mtr/trust/lookup?email=${encodeURIComponent(email.trim())}`).then((r) => { setOne(r); return r; }), undefined, '셈했습니다.')} data-mtr-trust-lookup="">점수 보기</button>{' '}
        <button className="btn-sm btn-plain" disabled={!!a.busy} onClick={() => void a.run('c', () => post('/admin/mtr/trust/recompute', {}), reload, (r: unknown) => `${(r as { computed: number }).computed}명 셈`)} data-mtr-trust-recompute="">지금 셈</button>
      </p>
      <Flash msg={a.msg} err={a.err} />
      {one && (
        <div className="card pad" data-mtr-trust-one={one.accountId}>
          <b>{one.email} · {one.nameHead} · {one.status}</b> — <b className="num">{one.score}</b>점 (표본 {one.sample}){one.snapshot ? <small className="muted"> · 하루 셈 {one.snapshot.score}점({ymdhm(one.snapshot.computedAt)})</small> : null}
          <table className="tbl"><thead><tr><th>칸</th><th>얻음 / 만점</th><th>근거</th></tr></thead>
            <tbody>{one.items.map((it) => <tr key={it.code}><td>{it.label}</td><td className="num">{it.got} / {it.max}</td><td>{trustBasisText(it)}</td></tr>)}</tbody></table>
        </div>
      )}
      {d && <TrustRulesBox key={d.rules.map((r) => r.updatedAt).join()} rules={d.rules} onDone={reload} />}
      {o && <MtrSettingsBox s={o.settings} onDone={reload} fields={[['trust', '신뢰 점수(나의공간 보임)', 'bool']]} />}
    </section>
  );
}

/* ═════════════ 휴면 계정 ═════════════ */
const VIA_KO: Record<string, string> = { LOGIN: '로그인', SOCIAL: '간편 로그인', PW_RESET: '비밀번호 재설정', ADMIN: '운영(SUPER)', STATUS: '상태 바꿈' };
interface DmRow { accountId: string; email: string; status: string; state: string; basisAt: string; noticedAt: string | null; noticeMailedAt: string | null; dormantAt: string | null;
  restoredAt: string | null; restoredVia: string | null; lastLoginAt: string | null; joinedAt: string }
interface DmView { view: string; on: boolean; days: number; noticeDays: number; mail: boolean; counts: { noticed: number; dormant: number; restored30: number; vault: number };
  preview: { notice: number; old: number }; rows: DmRow[]; note: string }

function WakeBox({ row, onDone }: { row: DmRow; onDone: () => void }) {
  const a = useAct();
  const [reason, setReason] = useState('');
  return (
    <span data-mtr-wake={row.accountId}>
      <Flash msg={a.msg} err={a.err} />
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="본인 확인 방법 · 까닭(5자 이상)" size={24} />{' '}
      <button className="btn-sm" disabled={!!a.busy || reason.trim().length < 5} onClick={() => void a.run('w', () => post(`/admin/mtr/dormant/${row.accountId}/wake`, { reason }), onDone)}>풀기(SUPER)</button>
    </span>
  );
}

export function MtrDormant({ isSuper }: { isSuper: boolean }) {
  const [view, setView] = useState('NOTICED');
  const q = useApi<DmView>(`/admin/mtr/dormant?view=${view}`, [view]);
  const ov = useApi<Overview>('/admin/mtr/overview');
  const d = q.data; const o = ov.data;
  const reload = () => { q.reload(); ov.reload(); };
  return (
    <section data-mtr-dormant={view}>
      {d && <p className={d.on ? 'muted' : 'warn-text'}>휴면 {d.on ? '켬(매일 04:40)' : '꺼짐'} · 미접속 {d.days}일 · 알림 {d.noticeDays}일 전 · 메일 {d.mail ? '켬' : '꺼짐'} · 알림 {d.counts.noticed} · 휴면 {d.counts.dormant} · 최근 30일 풀림 {d.counts.restored30} · 지금 켜면 알림 대상 {d.preview.notice}명 · 기준일 지난 {d.preview.old}명</p>}
      {d && <p className="warn-text">{d.note}</p>}
      <p>{(['NOTICED', 'DORMANT', 'RESTORED'] as const).map((v) => (
        <button key={v} className={`btn-sm${view === v ? '' : ' btn-plain'}`} onClick={() => setView(v)} data-mtr-dormant-view={v}>
          {{ NOTICED: '알림 보냄', DORMANT: '휴면', RESTORED: '풀림' }[v]}</button>))}</p>
      {d && (d.rows.length ? (
        <table className="tbl"><thead><tr><th>회원</th><th>마지막 로그인</th><th>알림</th><th>휴면</th><th>풀림</th><th /></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.accountId} data-mtr-dormant-row={r.state}>
              <td>{r.email} · {r.status}</td>
              <td>{ymdhm(r.lastLoginAt ?? r.joinedAt)}</td>
              <td>{ymdhm(r.noticedAt)}{r.noticeMailedAt ? ' · 메일' : ''}</td>
              <td>{ymdhm(r.dormantAt)}</td>
              <td>{r.restoredAt ? `${ymdhm(r.restoredAt)} · ${VIA_KO[r.restoredVia ?? ''] ?? r.restoredVia}` : '—'}</td>
              <td>{isSuper && r.state === 'DORMANT' ? <WakeBox row={r} onDone={reload} /> : null}</td>
            </tr>))}</tbody></table>
      ) : <p className="muted">해당하는 회원이 없습니다.</p>)}
      {o && <MtrSettingsBox s={o.settings} onDone={reload} fields={[['dormant', '휴면', 'bool'], ['dormantDays', '미접속 일', 'int'], ['dormantNoticeDays', '알림 일 전', 'int'], ['dormantMail', '알림 메일', 'bool']]} />}
    </section>
  );
}
