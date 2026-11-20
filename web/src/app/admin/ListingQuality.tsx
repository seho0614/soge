/* ===== v10.524 ~ 527 (D279 · docs/662 ~ 665) ㊾ 매물 2 — web/src/app/admin/ListingQuality.tsx 새 파일 =====
 *   LsyDups    검수 › 매물 중복 의심(SB-ADM-LSY-010) — 점수 높은 짝 · 짝 보기(두 매물 나란히 · 같은 사진 표시) · 같은 매물 · 다른 매물(사유) · 지금 보기
 *   LsyPhotos  검수 › 사진 품질(SB-ADM-LSY-020) — 경고 · 연락처 글자 의심 · 모두 · 사진 열기 · 다시 보기
 *   LsyVideos  검수 › 매물 동영상(SB-ADM-LSY-030) — 검수 대기 · 영상 열기 · 승인 · 반려(사유)
 *   LsyTriage  위험감지 › 신고 분류(SB-ADM-LSY-040) — 급함 순 · 규칙 · AI 제안 · 확정(그대로 · 바꿔서) · AI 일치율
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md) · CSS 는 기존 클래스만(tbl · card pad · btn-sm · btn-plain · muted · warn-text · num) — 새 색 없음
 */
import { Fragment, useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

const post = (path: string, body: unknown, method = 'POST') => api(path, { method, body: JSON.stringify(body) });
const openFile = (fid: string) => void api<{ url?: string }>(`/files/${fid}?disposition=inline`).then((r) => { if (r.url) window.open(r.url, '_blank', 'noopener'); }).catch(() => undefined);
const kb = (v: string | number | null | undefined) => (v == null ? '—' : `${Math.round(Number(v) / 1024).toLocaleString('ko-KR')}KB`);

interface Settings {
  dupDetect: boolean; dupThreshold: number; dupWindowDays: number; dupQueue: boolean;
  photoCheck: boolean; photoAi: boolean; photoMinPx: number; photoBatch: number;
  video: boolean; videoMaxMb: number; videoMaxSec: number; reportTriage: boolean; reportAi: boolean; aiModel: string;
}
interface Overview { settings: Settings; counts: { dupPending: number; photoWarn: number; photoContact: number; videoPending: number; triageOpen: number; triageU1: number } }

/** 설정 바꾸기(SUPER) — 바꾼 칸만 · 사유 */
function LsySettingsBox({ fields, s, onDone }: { fields: Array<[keyof Settings, string, 'bool' | 'int' | 'text']>; s: Settings; onDone: () => void }) {
  const a = useAct();
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(([k]) => [k, String(s[k])])));
  const [reason, setReason] = useState('');
  const save = () => {
    const body: Record<string, unknown> = { reason };
    for (const [k, , t] of fields) {
      const v = f[k] ?? '';
      if (v === String(s[k])) continue;
      body[k] = t === 'bool' ? v === 'true' : t === 'int' ? Number(v) : v;
    }
    void a.run('set', () => post('/admin/lsy/settings', body, 'PUT'), onDone);
  };
  return (
    <div className="card pad" data-lsy-settings="">
      <Flash msg={a.msg} err={a.err} />
      <b>설정(SUPER)</b>{' '}
      {fields.map(([k, label, t]) => (
        <label key={k} style={{ marginRight: 12 }}>
          {label}{' '}
          {t === 'bool' ? (
            <select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-lsy-set={k}><option value="false">끔</option><option value="true">켬</option></select>
          ) : (
            <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} size={t === 'text' ? 18 : 6} data-lsy-set={k} />
          )}
        </label>
      ))}
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(2자 이상 · 전체 설정 기록에 남음)" size={28} />{' '}
      <button className="btn-sm" disabled={a.busy === 'set' || reason.trim().length < 2} onClick={save} data-lsy-settings-save="">저장</button>
    </div>
  );
}

/* ═════════════ 매물 중복 의심 ═════════════ */
const CONTACT_KO: Record<string, string> = { NONE: '—', SAME_OWNER: '같은 주인', SAME_PHONE: '같은 전화(계정)', SAME_TEXT_PHONE: '같은 전화(글)' };
const LSTATE_KO: Record<string, string> = { PUBLISHED: '게시', IN_REVIEW: '검수 중', DRAFT: '임시', REJECTED: '반려', SUSPENDED: '정지', ARCHIVED: '내림' };
interface DupRow { id: string; score: number; textScore: number; photoShared: number; contact: string; state: string; foundAt: string; decidedAt: string | null; decideReason: string | null;
  queued: boolean; aId: string; aNo: number; aTitle: string; aStatus: string; bId: string; bNo: number; bTitle: string; bStatus: string; newerId: string }
interface DupView { state: string; on: boolean; threshold: number; queue: boolean; counts: Record<string, number>; rows: DupRow[] }
interface DupSide { id: string; listingNo: number; title: string; bodyHead: string; status: string; category: string | null; gwanCode: string; createdAt: string; owner: string; phoneTail: string | null;
  photos: { fileId: string; same: boolean }[] }
interface DupDetail { id: number; score: number; textScore: number; photoShared: number; contact: string; state: string; newerId: string; a: DupSide | null; b: DupSide | null; sameOwner: boolean }

function DupPair({ id, onDone }: { id: string; onDone: () => void }) {
  const d = useApi<DupDetail>(`/admin/lsy/dups/${id}`, [id]);
  const a = useAct();
  const [reason, setReason] = useState('');
  const x = d.data;
  const side = (s: DupSide | null, newer: boolean) => s && (
    <div className="card pad" style={{ flex: 1, minWidth: 260 }} data-lsy-dup-side={s.id}>
      <b>L-{s.listingNo} {s.title}</b> {newer && <small className="warn-text">나중 매물</small>}
      <p className="muted">{s.gwanCode} · {s.category ?? '—'} · {LSTATE_KO[s.status] ?? s.status} · {ymdhm(s.createdAt)} · 주인 {s.owner}{s.phoneTail ? ` · 전화 끝 ${s.phoneTail}` : ''}</p>
      <p style={{ whiteSpace: 'pre-wrap' }}>{s.bodyHead || '—'}</p>
      <p>{s.photos.map((p, i) => (
        <button key={p.fileId} className={`btn-sm${p.same ? '' : ' btn-plain'}`} onClick={() => openFile(p.fileId)} data-lsy-dup-photo={p.same ? 'same' : ''}>사진 {i + 1}{p.same ? ' (같음)' : ''}</button>))}
        {!s.photos.length && <span className="muted">사진 없음</span>}</p>
    </div>
  );
  return (
    <div data-lsy-dup-pair={id}>
      <Flash msg={a.msg} err={a.err} />
      {x && <>
        <p className="muted">점수 {x.score} · 글 {x.textScore} · 같은 사진 {x.photoShared}장 · {CONTACT_KO[x.contact] ?? x.contact}{x.sameOwner ? ' · 같은 주인' : ''}</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{side(x.a, x.newerId === x.a?.id)}{side(x.b, x.newerId === x.b?.id)}</div>
        {x.state === 'PENDING' && <p>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(2자 이상)" size={30} />{' '}
          <button className="btn-sm" disabled={!!a.busy || reason.trim().length < 2} onClick={() => void a.run('s', () => post(`/admin/lsy/dups/${id}/decide`, { verdict: 'SAME', reason }), onDone)} data-lsy-dup-same={id}>같은 매물</button>{' '}
          <button className="btn-sm btn-plain" disabled={!!a.busy || reason.trim().length < 2} onClick={() => void a.run('d', () => post(`/admin/lsy/dups/${id}/decide`, { verdict: 'DIFFERENT', reason }), onDone)} data-lsy-dup-diff={id}>다른 매물</button>
          <span className="muted"> 내림 · 반려는 검수 큐 · 신고 처리에서 합니다.</span></p>}
      </>}
    </div>
  );
}

export function LsyDups() {
  const [state, setState] = useState('PENDING');
  const q = useApi<DupView>(`/admin/lsy/dups?state=${state}`, [state]);
  const ov = useApi<Overview>('/admin/lsy/overview');
  const a = useAct();
  const [open, setOpen] = useState<string | null>(null);
  const [lid, setLid] = useState('');
  const d = q.data; const o = ov.data;
  const reload = () => { q.reload(); ov.reload(); };
  return (
    <section data-lsy-dups={state}>
      <Flash msg={a.msg} err={a.err} />
      {d && <p className={d.on ? 'muted' : 'warn-text'}>중복 탐지 {d.on ? '켬' : '꺼짐'} · 기준 {d.threshold}점 · 검수 대기에 올리기 {d.queue ? '켬' : '끔'} · 사진 지문(SHA-256) · 글 겹침 · 같은 연락처로 매시간 견줍니다. 자동으로 내리지 않습니다.</p>}
      <p>{(['PENDING', 'SAME', 'DIFFERENT'] as const).map((s) => (
        <button key={s} className={`btn-sm${state === s ? '' : ' btn-plain'}`} onClick={() => setState(s)} data-lsy-dup-state={s}>
          {{ PENDING: '확인 대기', SAME: '같은 매물', DIFFERENT: '다른 매물' }[s]} {d?.counts[s] ?? 0}</button>))}
        {' '}<input value={lid} onChange={(e) => setLid(e.target.value)} placeholder="매물 id(uuid) 지금 보기" size={30} />{' '}
        <button className="btn-sm btn-plain" disabled={!!a.busy || !/^[0-9a-fA-F-]{36}$/.test(lid)} onClick={() => void a.run('scan', () => post('/admin/lsy/dups/scan', { listingId: lid }), reload)} data-lsy-dup-scan="">지금 보기</button></p>
      {d && (d.rows.length ? (
        <table className="tbl"><thead><tr><th>점수</th><th>매물 A</th><th>매물 B</th><th>신호</th><th>찾은 때</th><th /></tr></thead>
          <tbody>{d.rows.map((r) => (<Fragment key={r.id}>
            <tr data-lsy-dup-row={r.id}>
              <td className="num"><b>{r.score}</b></td>
              <td>L-{r.aNo} {r.aTitle} <small className="muted">{LSTATE_KO[r.aStatus] ?? r.aStatus}</small></td>
              <td>L-{r.bNo} {r.bTitle} <small className="muted">{LSTATE_KO[r.bStatus] ?? r.bStatus}</small></td>
              <td>글 {r.textScore} · 사진 {r.photoShared} · {CONTACT_KO[r.contact] ?? r.contact}{r.queued ? ' · 검수 대기 올림' : ''}</td>
              <td>{ymdhm(r.foundAt)}{r.decideReason ? ` · ${r.decideReason}` : ''}</td>
              <td><button className="btn-sm btn-plain" onClick={() => setOpen(open === r.id ? null : r.id)} data-lsy-dup-open={r.id}>{open === r.id ? '닫기' : '짝 보기'}</button></td>
            </tr>
            {open === r.id && <tr><td colSpan={6}><DupPair id={r.id} onDone={() => { setOpen(null); reload(); }} /></td></tr>}
          </Fragment>))}</tbody></table>
      ) : <p className="muted">해당하는 짝이 없습니다.</p>)}
      {o && <LsySettingsBox s={o.settings} onDone={reload} fields={[['dupDetect', '중복 탐지', 'bool'], ['dupThreshold', '기준 점수', 'int'], ['dupWindowDays', '견줄 기간(일)', 'int'], ['dupQueue', '검수 대기 올리기', 'bool']]} />}
    </section>
  );
}

/* ═════════════ 사진 품질 ═════════════ */
interface PhotoRow { id: string; listingId: string; listingNo: number; title: string; status: string; fileId: string; width: number | null; height: number | null; bytes: string; ratio: string | null;
  bpp: string | null; warnings: string[]; aiState: string; aiContact: boolean | null; aiKinds: string[]; aiNote: string | null; aiEngine: string | null; checkedAt: string }
interface PhotoView { view: string; on: boolean; aiOn: boolean; minPx: number; batch: number; counts: { total: number; warn: number; contact: number; todo: number }; labels: Record<string, string>; rows: PhotoRow[] }

export function LsyPhotos() {
  const [view, setView] = useState('WARN');
  const q = useApi<PhotoView>(`/admin/lsy/photos?view=${view}`, [view]);
  const ov = useApi<Overview>('/admin/lsy/overview');
  const a = useAct();
  const d = q.data; const o = ov.data;
  const reload = () => { q.reload(); ov.reload(); };
  return (
    <section data-lsy-photos={view}>
      <Flash msg={a.msg} err={a.err} />
      {d && <p className={d.on ? 'muted' : 'warn-text'}>사진 검사 {d.on ? '켬' : '꺼짐'} · 연락처 글자 AI {d.aiOn ? '켬' : '꺼짐'} · 짧은 변 {d.minPx}px 이상 · 매시간 {d.batch}장 · 경고만 보이고 검수 · 게시를 막지 않습니다. 흐림은 파일 크기로 어림한 값입니다.</p>}
      <p>{(['WARN', 'CONTACT', 'ALL'] as const).map((v) => (
        <button key={v} className={`btn-sm${view === v ? '' : ' btn-plain'}`} onClick={() => setView(v)} data-lsy-photo-view={v}>
          {{ WARN: '경고', CONTACT: '연락처 의심', ALL: '모두' }[v]} {d ? { WARN: d.counts.warn, CONTACT: d.counts.contact, ALL: d.counts.total }[v] : 0}</button>))}
        {d && <span className="muted"> AI 대기 {d.counts.todo}</span>}</p>
      {d && (d.rows.length ? (
        <table className="tbl"><thead><tr><th>매물</th><th>크기</th><th>비율 · 비트</th><th>경고</th><th>AI</th><th /></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.id} data-lsy-photo-row={r.id}>
              <td>L-{r.listingNo} {r.title}</td>
              <td className="num">{r.width ?? '—'} × {r.height ?? '—'} · {kb(r.bytes)}</td>
              <td className="num">{r.ratio ?? '—'} · {r.bpp ?? '—'}</td>
              <td className={r.warnings.length ? 'warn-text' : 'muted'}>{r.warnings.map((w) => d.labels[w] ?? w).join(' · ') || '없음'}</td>
              <td>{r.aiState === 'DONE' ? `${r.aiContact ? '의심' : '없음'}${r.aiKinds.length ? ` (${r.aiKinds.join(', ')})` : ''}${r.aiEngine === 'MOCK' ? ' · 시험 엔진' : ''}` : r.aiState}{r.aiNote ? ` · ${r.aiNote}` : ''}</td>
              <td><button className="btn-sm btn-plain" onClick={() => openFile(r.fileId)} data-lsy-photo-open={r.id}>열기</button>{' '}
                <button className="btn-sm btn-plain" disabled={!!a.busy} onClick={() => void a.run(`r${r.id}`, () => post('/admin/lsy/photos/recheck', { listingId: r.listingId }), reload)} data-lsy-photo-recheck={r.id}>다시 보기</button></td>
            </tr>))}</tbody></table>
      ) : <p className="muted">해당하는 사진이 없습니다.</p>)}
      {o && <LsySettingsBox s={o.settings} onDone={reload} fields={[['photoCheck', '사진 검사', 'bool'], ['photoAi', '연락처 글자 AI', 'bool'], ['photoMinPx', '짧은 변(px)', 'int'], ['photoBatch', '한 번에', 'int'], ['aiModel', '모델(비우면 검수 보조 모델)', 'text']]} />}
    </section>
  );
}

/* ═════════════ 매물 동영상 ═════════════ */
interface VideoRow { id: string; listingId: string; listingNo: number; title: string; listingStatus: string; fileId: string; state: string; durationMs: number; width: number | null; height: number | null;
  bytes: string; createdAt: string; decidedAt: string | null; decideReason: string | null }
interface VideoView { state: string; on: boolean; maxMb: number; maxSec: number; counts: Record<string, number>; rows: VideoRow[] }

function VideoDecide({ row, onDone }: { row: VideoRow; onDone: () => void }) {
  const a = useAct();
  const [reason, setReason] = useState('');
  return (
    <span data-lsy-video-decide={row.id}>
      <Flash msg={a.msg} err={a.err} />
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="반려 사유(회원에게 보임)" size={22} />{' '}
      <button className="btn-sm" disabled={!!a.busy} onClick={() => void a.run('ok', () => post(`/admin/lsy/videos/${row.id}/decide`, { approve: true, reason: reason || undefined }), onDone)} data-lsy-video-ok={row.id}>승인 · 공개</button>{' '}
      <button className="btn-sm btn-plain" disabled={!!a.busy || reason.trim().length < 2} onClick={() => void a.run('no', () => post(`/admin/lsy/videos/${row.id}/decide`, { approve: false, reason }), onDone)} data-lsy-video-no={row.id}>반려</button>
    </span>
  );
}

export function LsyVideos() {
  const [state, setState] = useState('PENDING');
  const q = useApi<VideoView>(`/admin/lsy/videos?state=${state}`, [state]);
  const ov = useApi<Overview>('/admin/lsy/overview');
  const d = q.data; const o = ov.data;
  const reload = () => { q.reload(); ov.reload(); };
  return (
    <section data-lsy-videos={state}>
      {d && <p className={d.on ? 'muted' : 'warn-text'}>매물 동영상 {d.on ? '켬' : '꺼짐'} · {d.maxMb}MB · {d.maxSec}초까지(서버가 MP4 머리로 잼) · 승인한 것만 매물 상세에 보입니다.</p>}
      <p>{(['PENDING', 'APPROVED', 'REJECTED', 'REPLACED', 'REMOVED'] as const).map((s) => (
        <button key={s} className={`btn-sm${state === s ? '' : ' btn-plain'}`} onClick={() => setState(s)} data-lsy-video-state={s}>
          {{ PENDING: '검수 대기', APPROVED: '승인', REJECTED: '반려', REPLACED: '바뀜', REMOVED: '뺌' }[s]} {d?.counts[s] ?? 0}</button>))}</p>
      {d && (d.rows.length ? (
        <table className="tbl"><thead><tr><th>매물</th><th>길이 · 크기</th><th>올린 때</th><th>영상</th><th /></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.id} data-lsy-video-row={r.id}>
              <td>L-{r.listingNo} {r.title} <small className="muted">{LSTATE_KO[r.listingStatus] ?? r.listingStatus}</small></td>
              <td className="num">{(r.durationMs / 1000).toFixed(1)}초 · {r.width ?? '—'} × {r.height ?? '—'} · {kb(r.bytes)}</td>
              <td>{ymdhm(r.createdAt)}</td>
              <td><button className="btn-sm btn-plain" onClick={() => openFile(r.fileId)} data-lsy-video-open={r.id}>열기</button></td>
              <td>{r.state === 'PENDING' ? <VideoDecide row={r} onDone={reload} /> : <span className="muted">{ymdhm(r.decidedAt)}{r.decideReason ? ` · ${r.decideReason}` : ''}</span>}</td>
            </tr>))}</tbody></table>
      ) : <p className="muted">해당하는 동영상이 없습니다.</p>)}
      {o && <LsySettingsBox s={o.settings} onDone={reload} fields={[['video', '매물 동영상', 'bool'], ['videoMaxMb', '최대(MB)', 'int'], ['videoMaxSec', '최대(초)', 'int']]} />}
    </section>
  );
}

/* ═════════════ 신고 분류 ═════════════ */
interface TriRow { id: string; reportId: string; reportState: string; targetType: string; targetId: string; reasonCode: string; reasonLabel: string | null; detail: string; reportedAt: string;
  ruleKind: string; ruleUrgency: string; ruleWhy: string | null; aiState: string; aiKind: string | null; aiUrgency: string | null; aiWhy: string | null; aiEngine: string | null;
  state: string; kind: string | null; urgency: string | null; note: string | null; decidedAt: string | null; sortUrgency: string }
interface TriView { view: string; on: boolean; aiOn: boolean; kinds: Record<string, string>; urgencies: Record<string, string>;
  counts: { open: number; suggested: number; u1: number; agree: number; judged: number }; rows: TriRow[] }

function TriConfirm({ row, kinds, urgencies, onDone }: { row: TriRow; kinds: Record<string, string>; urgencies: Record<string, string>; onDone: () => void }) {
  const a = useAct();
  const sugK = row.aiState === 'DONE' && row.aiKind ? row.aiKind : row.ruleKind;
  const sugU = row.aiState === 'DONE' && row.aiUrgency ? row.aiUrgency : row.ruleUrgency;
  const [k, setK] = useState(row.kind ?? sugK);
  const [u, setU] = useState(row.urgency ?? sugU);
  return (
    <span data-lsy-tri-confirm={row.id}>
      <Flash msg={a.msg} err={a.err} />
      <select value={k} onChange={(e) => setK(e.target.value)} aria-label="종류">{Object.entries(kinds).map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select>{' '}
      <select value={u} onChange={(e) => setU(e.target.value)} aria-label="급함">{Object.entries(urgencies).map(([c, l]) => <option key={c} value={c}>{c} {l}</option>)}</select>{' '}
      <button className="btn-sm" disabled={!!a.busy} onClick={() => void a.run('c', () => post(`/admin/lsy/triage/${row.id}/confirm`, { kind: k, urgency: u }), onDone)} data-lsy-tri-ok={row.id}>{row.state === 'CONFIRMED' ? '바꾸기' : '확정'}</button>
    </span>
  );
}

export function LsyTriage() {
  const [view, setView] = useState('OPEN');
  const q = useApi<TriView>(`/admin/lsy/triage?view=${view}`, [view]);
  const ov = useApi<Overview>('/admin/lsy/overview');
  const d = q.data; const o = ov.data;
  const reload = () => { q.reload(); ov.reload(); };
  return (
    <section data-lsy-triage={view}>
      {d && <p className={d.on ? 'muted' : 'warn-text'}>신고 분류 {d.on ? '켬' : '꺼짐'} · AI 제안 {d.aiOn ? '켬' : '꺼짐'} · 10분마다 · 열린 신고 {d.counts.open} · 즉시(U1) {d.counts.u1} · AI 일치(30일) {d.counts.judged ? `${Math.round((d.counts.agree / d.counts.judged) * 100)}%(${d.counts.agree}/${d.counts.judged})` : '—'} · 처리(인정 · 기각)는 「신고 처리」에서 합니다.</p>}
      <p>{(['OPEN', 'SUGGESTED', 'CONFIRMED'] as const).map((v) => (
        <button key={v} className={`btn-sm${view === v ? '' : ' btn-plain'}`} onClick={() => setView(v)} data-lsy-tri-view={v}>
          {{ OPEN: '열린 신고', SUGGESTED: '확정 전', CONFIRMED: '확정' }[v]}</button>))}</p>
      {d && (d.rows.length ? (
        <table className="tbl"><thead><tr><th>급함</th><th>신고</th><th>규칙 제안</th><th>AI 제안</th><th>확정</th></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.id} data-lsy-tri-row={r.sortUrgency}>
              <td className={r.sortUrgency === 'U1' ? 'warn-text' : ''}><b>{r.sortUrgency}</b> {d.urgencies[r.sortUrgency] ?? ''}</td>
              <td>{r.targetType} · {r.reasonLabel ?? r.reasonCode} · {ymdhm(r.reportedAt)}<br /><small className="muted">{r.detail || '—'}</small></td>
              <td>{d.kinds[r.ruleKind] ?? r.ruleKind} · {r.ruleUrgency}<br /><small className="muted">{r.ruleWhy ?? ''}</small></td>
              <td>{r.aiState === 'DONE' ? <>{d.kinds[r.aiKind ?? ''] ?? r.aiKind} · {r.aiUrgency}{r.aiEngine === 'MOCK' ? ' · 시험 엔진' : ''}<br /><small className="muted">{r.aiWhy ?? ''}</small></> : <span className="muted">{r.aiState}</span>}</td>
              <td>{['OPEN', 'QUEUED'].includes(r.reportState) ? <TriConfirm row={r} kinds={d.kinds} urgencies={d.urgencies} onDone={reload} />
                : <span className="muted">{r.kind ? `${d.kinds[r.kind] ?? r.kind} · ${r.urgency}` : '—'} (처리됨)</span>}</td>
            </tr>))}</tbody></table>
      ) : <p className="muted">해당하는 신고가 없습니다.</p>)}
      {o && <LsySettingsBox s={o.settings} onDone={reload} fields={[['reportTriage', '신고 분류', 'bool'], ['reportAi', 'AI 제안', 'bool'], ['aiModel', '모델(비우면 검수 보조 모델)', 'text']]} />}
    </section>
  );
}
