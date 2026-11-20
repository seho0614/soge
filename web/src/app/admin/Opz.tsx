/* ===== v10.556 · 557 (D288 · docs/694 · 695) (58) 운영 4 — web/src/app/admin/Opz.tsx 새 파일 =====
 *   OpzNewsletter  회원 › 월간 뉴스레터 — 설정(SUPER) · 호 목록 · 초안 만들기 · 고르기 · 틀 · 미리보기 · 나에게 시험 · 보내기(SUPER) · 취소
 *   OpzIncident    위험감지 › 장애 대응 — 설정(SUPER) · 오늘 당번 · 열 거리 · 런북 · 장애 열기 · 단계 체크 · 진행 기록 · 상태 · 공지 잇기 · 되돌아보기
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md) · 기존 클래스(card · tbl · btn-sm · warn-text · muted)만 — 새 CSS 없음 · 어두운 테마 그대로
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { isSuperNow } from './OpsStaffBoxes';

const put = (path: string, body: unknown) => api(path, { method: 'PUT', body: JSON.stringify(body) });
const post = (path: string, body: unknown = {}) => api(path, { method: 'POST', body: JSON.stringify(body) });

/** 스위치 · 숫자 설정(SUPER 만 저장 · 사유) */
function SwitchBox({ path, rows, cur, onDone, tag }: { path: string; rows: Array<[string, string, number?, number?]>; cur: Record<string, boolean | number>; onDone: () => void; tag: string }) {
  const a = useAct();
  const [v, setV] = useState<Record<string, boolean | number>>({});
  const [reason, setReason] = useState('');
  const sup = isSuperNow();
  return (
    <div className="card" data-opz-settings={tag}>
      <Flash msg={a.msg} err={a.err} />
      <table className="tbl"><tbody>
        {rows.map(([k, label, lo, hi]) => {
          const x = v[k] ?? cur[k];
          return (
            <tr key={k}><td>{label}</td><td>
              {typeof cur[k] === 'boolean'
                ? <label><input type="checkbox" disabled={!sup} checked={!!x} onChange={(e) => setV({ ...v, [k]: e.target.checked })} /> {x ? '켜짐' : '꺼짐'}</label>
                : <input type="number" disabled={!sup} min={lo} max={hi} value={Number(x)} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} style={{ width: 100 }} />}
            </td></tr>
          );
        })}
      </tbody></table>
      {sup ? (
        <p>
          <input placeholder="사유(2 ~ 200자 · 설정 바뀜 기록)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 320 }} />{' '}
          <button className="btn-sm" disabled={!Object.keys(v).length || reason.trim().length < 2 || a.busy === 's'}
            onClick={() => void a.run('s', () => put(path, { ...v, reason }), () => { setV({}); setReason(''); onDone(); })} data-opz-save={tag}>저장</button>
        </p>
      ) : <p className="muted">설정은 SUPER 만 바꿉니다.</p>}
    </div>
  );
}

/* ── 월간 뉴스레터 ── */
interface NlSettings { nlOn: boolean; nlItems: number; nlListingDays: number; irOn: boolean; irPageNow: boolean; irReviewDays: number }
interface NlList {
  settings: NlSettings; ym: string; canSend: boolean; note: string; campaign: { enabled: boolean; mode: string; contactSet: boolean };
  items: Array<{ id: string; ym: string; title: string; state: string; campaignState: string | null; sendMode: string | null; total: number | null; sent: number | null; assumed: number | null; skipped: number | null; failed: number | null; unsubscribed: number }>;
}
interface Cand { id: string; title: string; picked: boolean; gwanName?: string; publishedAt?: string; startsAt?: string; endsAt?: string }
interface NlDetail {
  issue: { id: string; ym: string; title: string; subject: string; intro: string; frame: string; noticeIds: string[]; listingIds: string[]; eventIds: string[]; state: string; campaignId: string | null };
  campaign: { state: string; sendMode: string | null; lastNote: string | null } | null;
  audience: { willSend: number; consented: number; stale: number; noAddr: number; suppressed: number; nightOk: number } | null;
  candidates: { notices: Cand[]; listings: Cand[]; events: Cand[] };
  rendered: { length: number; tooLong: boolean; max: number; counts: Record<string, number> };
  preview: { subject: string | null; text: string } | null; problems: string[]; vars: string[]; frameDefault: string;
  campaignReady: { enabled: boolean; mode: string; contactSet: boolean }; canSend: boolean;
}
const NL_KO: Record<string, string> = { DRAFT: '초안', QUEUED: '보냄', CANCELED: '취소' };

function Picker({ label, list, sel, setSel, tag }: { label: string; list: Cand[]; sel: string[]; setSel: (v: string[]) => void; tag: string }) {
  return (
    <div data-opz-pick={tag}>
      <b>{label}</b> <span className="muted">({sel.length} / 10)</span>
      {!list.length && <p className="muted">후보가 없습니다.</p>}
      {list.map((c) => (
        <div key={c.id}><label>
          <input type="checkbox" checked={sel.includes(c.id)} onChange={(e) => setSel(e.target.checked ? [...sel, c.id].slice(0, 10) : sel.filter((x) => x !== c.id))} />{' '}
          {c.gwanName ? `[${c.gwanName}] ` : ''}{c.title}{c.startsAt ? ` (${ymdhm(c.startsAt)} ~ ${ymdhm(c.endsAt)})` : ''}
        </label></div>
      ))}
    </div>
  );
}

function NlEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const d = useApi<NlDetail>(`/admin/opz/newsletters/${id}`);
  const a = useAct();
  const [f, setF] = useState<Record<string, unknown>>({});
  const [confirm, setConfirm] = useState('');
  const [at, setAt] = useState('');
  const [why, setWhy] = useState('');
  const x = d.data;
  if (!x) return <div className="card">{d.error ? <p className="warn-text">읽지 못했습니다.</p> : '…'}</div>;
  const draft = x.issue.state === 'DRAFT';
  const val = <K extends keyof NlDetail['issue']>(k: K) => (f[k as string] ?? x.issue[k]) as NlDetail['issue'][K];
  const done = () => { setF({}); d.reload(); onDone(); };
  return (
    <div className="card" data-opz-nl-editor={x.issue.id}>
      <Flash msg={a.msg} err={a.err} />
      <h3>{x.issue.ym} · {x.issue.title} <span className="muted">({NL_KO[x.issue.state] ?? x.issue.state}{x.campaign ? ` · 캠페인 ${x.campaign.state}` : ''})</span></h3>
      {x.problems.length > 0 && <p className="warn-text">{x.problems.join(' · ')}</p>}
      <p data-opz-nl-length={x.rendered.length}>본문 {x.rendered.length.toLocaleString('ko-KR')} / {x.rendered.max.toLocaleString('ko-KR')}자{x.rendered.tooLong && <b className="warn-text"> — 넘음(시험 · 보내기 막힘)</b>}</p>
      {draft && (
        <>
          <p><input value={String(val('title'))} onChange={(e) => setF({ ...f, title: e.target.value })} style={{ width: 280 }} placeholder="호 이름" />{' '}
            <input value={String(val('subject'))} onChange={(e) => setF({ ...f, subject: e.target.value })} style={{ width: 320 }} placeholder="메일 제목(앞에 (광고)가 붙음)" /></p>
          <p><textarea rows={3} value={String(val('intro'))} onChange={(e) => setF({ ...f, intro: e.target.value })} style={{ width: '100%' }} placeholder="첫 인사(500자 · 주소 · 수신 거부 글 금지)" /></p>
          <details><summary>틀 고치기 — 자리값 {x.vars.map((v) => `{${v}}`).join(' ')}</summary>
            <textarea rows={10} value={String(val('frame'))} onChange={(e) => setF({ ...f, frame: e.target.value })} style={{ width: '100%' }} data-opz-nl-frame="" />
            <button className="btn-sm" onClick={() => setF({ ...f, frame: x.frameDefault })}>기본 틀로</button>
          </details>
          <Picker label="이달의 공지" tag="notices" list={x.candidates.notices} sel={val('noticeIds')} setSel={(v) => setF({ ...f, noticeIds: v })} />
          <Picker label="인기 매물" tag="listings" list={x.candidates.listings} sel={val('listingIds')} setSel={(v) => setF({ ...f, listingIds: v })} />
          <Picker label="진행 중인 이벤트" tag="events" list={x.candidates.events} sel={val('eventIds')} setSel={(v) => setF({ ...f, eventIds: v })} />
          <p>
            <button className="btn-sm" disabled={!Object.keys(f).length || a.busy === 'u'} onClick={() => void a.run('u', () => put(`/admin/opz/newsletters/${id}`, f), done)} data-opz-nl-save="">저장</button>{' '}
            <button className="btn-sm" disabled={!!Object.keys(f).length || x.rendered.tooLong || a.busy === 't'} onClick={() => void a.run('t', () => post(`/admin/opz/newsletters/${id}/test`), () => d.reload())} data-opz-nl-test="">나에게 시험</button>
          </p>
        </>
      )}
      {x.audience && <p className="muted">받을 사람(지금 기준) {x.audience.willSend}명 · 동의 {x.audience.consented} · 2년 넘음 {x.audience.stale} · 받는 곳 없음 {x.audience.noAddr} · 반송 {x.audience.suppressed} · 야간 동의 {x.audience.nightOk}</p>}
      {x.preview && (
        <details open data-opz-nl-preview=""><summary>미리보기 — {x.preview.subject}</summary>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{x.preview.text}</pre>
        </details>
      )}
      <p className="muted">캠페인 보내기 {x.campaignReady.enabled ? '켜짐' : '꺼짐'} · 방식 {x.campaignReady.mode}{x.campaignReady.mode === 'ASSUME' ? '(보내지 않고 기록만)' : ''} · 보낸 곳 연락처 {x.campaignReady.contactSet ? '있음' : '없음'}</p>
      {draft && x.canSend && (
        <p data-opz-nl-sendbox="">
          <input placeholder="예약 시각(비우면 바로 · 예 2026-11-25T10:00)" value={at} onChange={(e) => setAt(e.target.value)} style={{ width: 280 }} />{' '}
          <input placeholder="「보내기」" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ width: 100 }} />{' '}
          <button className="btn-sm" disabled={confirm.trim() !== '보내기' || x.rendered.tooLong || !!Object.keys(f).length || a.busy === 'send'}
            onClick={() => void a.run('send', () => post(`/admin/opz/newsletters/${id}/send`, { confirm, scheduledAt: at ? new Date(at).toISOString() : undefined }), done)} data-opz-nl-send="">보내기(SUPER)</button>
        </p>
      )}
      {x.issue.state !== 'CANCELED' && (draft || x.canSend) && (
        <p>
          <input placeholder="취소 사유(2 ~ 200자)" value={why} onChange={(e) => setWhy(e.target.value)} style={{ width: 240 }} />{' '}
          <button className="btn-sm" disabled={why.trim().length < 2 || a.busy === 'c'} onClick={() => void a.run('c', () => post(`/admin/opz/newsletters/${id}/cancel`, { reason: why }), done)}>호 취소</button>
        </p>
      )}
    </div>
  );
}

export function OpzNewsletter() {
  const v = useApi<NlList>('/admin/opz/newsletters');
  const a = useAct();
  const [open, setOpen] = useState<string | null>(null);
  const d = v.data;
  if (!d) return <section data-opz-nl="">{v.error ? <p className="warn-text">읽지 못했습니다.</p> : '…'}</section>;
  const has = d.items.some((x) => x.ym === d.ym && x.state !== 'CANCELED');
  return (
    <section data-opz-nl="">
      <Flash msg={a.msg} err={a.err} />
      <p className="muted">{d.note}</p>
      <SwitchBox path="/admin/opz/newsletter-settings" tag="nl" onDone={v.reload}
        cur={{ nlOn: d.settings.nlOn, nlItems: d.settings.nlItems, nlListingDays: d.settings.nlListingDays }}
        rows={[['nlOn', '뉴스레터 보내기(opz.nl_enabled · 처음 꺼짐)'], ['nlItems', '묶음마다 처음 고를 수', 1, 10], ['nlListingDays', '인기 매물 — 최근 며칠 안 게시', 7, 90]]} />
      <p className="muted">캠페인 보내기 {d.campaign.enabled ? '켜짐' : '꺼짐'} · 방식 {d.campaign.mode} · 보낸 곳 연락처 {d.campaign.contactSet ? '있음' : '없음'} — 회원 › 문자 · 메일 캠페인에서 바꿉니다.</p>
      {!has && <p><button className="btn-sm" disabled={a.busy === 'n'} onClick={() => void a.run('n', () => post('/admin/opz/newsletters', {}), v.reload)} data-opz-nl-new="">이번 달({d.ym}) 초안 만들기</button></p>}
      <table className="tbl" data-opz-nl-list={d.items.length}>
        <thead><tr><th>달</th><th>이름</th><th>상태</th><th>캠페인</th><th>보냄 · 간주</th><th>건너뜀 · 실패</th><th>수신 거부</th><th /></tr></thead>
        <tbody>
          {d.items.map((x) => (
            <tr key={x.id}>
              <td>{x.ym}</td><td>{x.title}</td><td>{NL_KO[x.state] ?? x.state}</td><td>{x.campaignState ?? '—'}{x.sendMode ? ` · ${x.sendMode}` : ''}</td>
              <td>{x.sent ?? 0} · {x.assumed ?? 0}</td><td>{x.skipped ?? 0} · {x.failed ?? 0}</td><td>{x.unsubscribed}</td>
              <td><button className="btn-sm" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? '닫기' : '열기'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && <NlEditor key={open} id={open} onDone={v.reload} />}
    </section>
  );
}

/* ── 장애 대응 ── */
interface Rb { id: string; code: string; title: string; kind: string; sevDefault: string; parts: string[]; summary: string; isActive: boolean; version: number; steps: number }
interface Board {
  settings: NlSettings; isSuper: boolean; note: string; sevs: string[]; kinds: string[]; parts: string[];
  oncall: { accountId: string | null; email: string | null; name: string | null; chat: boolean }; telegram: { ready: boolean; reason: string | null };
  runbooks: Rb[];
  open: Array<{ id: string; title: string; sev: string; state: string; openedAt: string; runbook: string; steps: number; done: number; pageResult: string | null; uptIncidentId: string | null }>;
  closed: Array<{ id: string; title: string; sev: string; closedAt: string; runbook: string; minutes: number; hasReview: boolean; reviewFinalizedAt: string | null }>;
  suggestions: { uptIncidents: Array<{ id: string; title: string; level: string; startedAt: string }>; alerts: Array<{ id: string; code: string; title: string; raisedAt: string }> };
}
interface IrDetail {
  incident: { id: string; title: string; sev: string; state: string; runbook: string; openedAt: string; closedAt: string | null; pageResult: string | null; uptIncidentId: string | null; oncallName: string | null; minutesOpen: number; minutesToMitigate: number };
  steps: Array<{ id: string; ord: number; title: string; detail: string; doneAt: string | null; doneBy: string | null }>;
  logs: Array<{ id: string; kind: string; body: string; at: string; actor: string | null }>;
  review: { summary: string; cause: string; impact: string; wentWell: string; improve: string; actions: string; finalizedAt: string | null } | null;
  upt: { id: string; title: string; level: string; state: string } | null;
}
const IR_KO: Record<string, string> = { OPEN: '열림', MITIGATED: '누그러뜨림', CLOSED: '끝' };

function OpenBox({ b, onDone }: { b: Board; onDone: (id?: string) => void }) {
  const a = useAct();
  const [rb, setRb] = useState(''); const [title, setTitle] = useState(''); const [sev, setSev] = useState('');
  const [src, setSrc] = useState(''); const [upt, setUpt] = useState(false); const [note, setNote] = useState('');
  return (
    <div className="card" data-opz-ir-openbox="">
      <Flash msg={a.msg} err={a.err} />
      <b>장애 열기</b>{!b.settings.irOn && <span className="warn-text"> — 꺼져 있음(opz.ir_enabled)</span>}
      <p>
        <select value={rb} onChange={(e) => setRb(e.target.value)} data-opz-ir-runbook="">
          <option value="">런북 고르기</option>
          {b.runbooks.filter((r) => r.isActive).map((r) => <option key={r.id} value={r.id}>{r.title} ({r.sevDefault})</option>)}
        </select>{' '}
        <select value={sev} onChange={(e) => setSev(e.target.value)}><option value="">정도(런북 기본)</option>{b.sevs.map((s) => <option key={s}>{s}</option>)}</select>{' '}
        <input placeholder="제목(비우면 런북 이름)" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: 260 }} />
      </p>
      <p>
        <select value={src} onChange={(e) => setSrc(e.target.value)}>
          <option value="">운영 알림에서 열기(선택)</option>
          {b.suggestions.alerts.map((x) => <option key={x.id} value={x.id}>#{x.id} {x.title}</option>)}
        </select>{' '}
        <label><input type="checkbox" checked={upt} onChange={(e) => setUpt(e.target.checked)} /> 장애 공지도 올리기(사용자 웹 맨 위 띠)</label>
      </p>
      <p><input placeholder="메모(선택)" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%' }} /></p>
      <button className="btn-sm" disabled={!rb || !b.settings.irOn || a.busy === 'o'} data-opz-ir-open=""
        onClick={() => void a.run('o', () => post('/admin/opz/incidents', { runbookId: rb, title: title || undefined, sev: sev || undefined, sourceAlertId: src || undefined, uptNotice: upt, note: note || undefined }),
          () => { setRb(''); setTitle(''); setSev(''); setSrc(''); setUpt(false); setNote(''); onDone(); })}>열고 당번 호출</button>
    </div>
  );
}

function IrView({ id, b, onDone }: { id: string; b: Board; onDone: () => void }) {
  const d = useApi<IrDetail>(`/admin/opz/incidents/${id}`);
  const a = useAct();
  const [note, setNote] = useState(''); const [resolve, setResolve] = useState(true);
  const [rv, setRv] = useState<Record<string, string>>({}); const [cf, setCf] = useState(''); const [uptNo, setUptNo] = useState('');
  const x = d.data;
  if (!x) return <div className="card">{d.error ? <p className="warn-text">읽지 못했습니다.</p> : '…'}</div>;
  const i = x.incident; const closed = i.state === 'CLOSED';
  const done = () => { d.reload(); onDone(); };
  const RV: Array<[string, string]> = [['summary', '요약(무엇이 · 얼마나)'], ['cause', '원인'], ['impact', '영향'], ['wentWell', '잘된 것'], ['improve', '고칠 것'], ['actions', '할 일(누가 · 언제)']];
  return (
    <div className="card" data-opz-ir-view={i.id}>
      <Flash msg={a.msg} err={a.err} />
      <h3>#{i.id} {i.sev} · {i.title} <span className="muted">({IR_KO[i.state] ?? i.state} · {i.runbook} · {i.minutesOpen}분 · 당번 {i.oncallName ?? '없음'} · 호출 {i.pageResult ?? '—'})</span></h3>
      <p className="muted">장애 공지: {x.upt ? `#${x.upt.id} ${x.upt.title} (${x.upt.level} · ${x.upt.state})` : '이은 공지 없음'}</p>
      {!closed && !x.upt && (
        <p>
          <button className="btn-sm" disabled={a.busy === 'uc'} onClick={() => void a.run('uc', () => put(`/admin/opz/incidents/${id}/upt`, { create: true }), done)}>공지 올리기</button>{' '}
          <select value={uptNo} onChange={(e) => setUptNo(e.target.value)}><option value="">열린 공지와 잇기</option>{b.suggestions.uptIncidents.map((u) => <option key={u.id} value={u.id}>#{u.id} {u.title}</option>)}</select>{' '}
          <button className="btn-sm" disabled={!uptNo || a.busy === 'ul'} onClick={() => void a.run('ul', () => put(`/admin/opz/incidents/${id}/upt`, { uptIncidentId: uptNo }), done)}>잇기</button>
        </p>
      )}
      <table className="tbl" data-opz-ir-steps={x.steps.length}><tbody>
        {x.steps.map((s) => (
          <tr key={s.id}>
            <td><input type="checkbox" disabled={closed || a.busy === `s${s.id}`} checked={!!s.doneAt} data-opz-ir-step={s.ord}
              onChange={(e) => void a.run(`s${s.id}`, () => post(`/admin/opz/incidents/${id}/steps/${s.id}`, { done: e.target.checked }), done)} /></td>
            <td><b>{s.ord}. {s.title}</b><div className="muted">{s.detail}</div></td>
            <td className="muted">{s.doneAt ? `${ymdhm(s.doneAt)} · ${s.doneBy ?? ''}` : ''}</td>
          </tr>
        ))}
      </tbody></table>
      {!closed && (
        <>
          <p><input placeholder="진행 기록(2 ~ 1,000자)" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '70%' }} />{' '}
            <button className="btn-sm" disabled={note.trim().length < 2 || a.busy === 'n'} onClick={() => void a.run('n', () => post(`/admin/opz/incidents/${id}/notes`, { body: note }), () => { setNote(''); done(); })}>더하기</button>{' '}
            {b.settings.irPageNow && <button className="btn-sm" disabled={a.busy === 'p'} onClick={() => void a.run('p', () => post(`/admin/opz/incidents/${id}/page`), done)}>당번 다시 호출</button>}</p>
          <p>
            {i.state === 'OPEN' && <button className="btn-sm" disabled={a.busy === 'm'} onClick={() => void a.run('m', () => post(`/admin/opz/incidents/${id}/state`, { state: 'MITIGATED' }), done)}>누그러뜨림</button>}{' '}
            <label><input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)} /> 이은 공지도 끝냄</label>{' '}
            <button className="btn-sm" disabled={a.busy === 'x'} data-opz-ir-close="" onClick={() => void a.run('x', () => post(`/admin/opz/incidents/${id}/state`, { state: 'CLOSED', resolveNotice: resolve }), done)}>끝</button>
          </p>
        </>
      )}
      {closed && (
        <div data-opz-ir-review={x.review?.finalizedAt ? 'final' : x.review ? 'draft' : 'none'}>
          <b>되돌아보기</b>{x.review?.finalizedAt && <span className="muted"> — 확정 {ymdhm(x.review.finalizedAt)}</span>}
          {RV.map(([k, label]) => (
            <p key={k}><textarea rows={2} disabled={!!x.review?.finalizedAt} placeholder={label} style={{ width: '100%' }}
              value={rv[k] ?? String((x.review as unknown as Record<string, unknown> | null)?.[k] ?? '')} onChange={(e) => setRv({ ...rv, [k]: e.target.value })} /></p>
          ))}
          {!x.review?.finalizedAt && (
            <p>
              <button className="btn-sm" disabled={!Object.keys(rv).length || a.busy === 'r'} onClick={() => void a.run('r', () => put(`/admin/opz/incidents/${id}/review`, rv), () => { setRv({}); done(); })}>저장</button>{' '}
              <input placeholder="「확정」" value={cf} onChange={(e) => setCf(e.target.value)} style={{ width: 80 }} />{' '}
              <button className="btn-sm" disabled={!x.review || cf.trim() !== '확정' || a.busy === 'f'} onClick={() => void a.run('f', () => post(`/admin/opz/incidents/${id}/review/finalize`, { confirm: cf }), done)}>확정(잠김)</button>
            </p>
          )}
        </div>
      )}
      <details><summary>진행 기록 {x.logs.length}줄</summary>
        <table className="tbl"><tbody>{x.logs.map((l) => <tr key={l.id}><td className="muted">{ymdhm(l.at)}</td><td>{l.kind}</td><td style={{ whiteSpace: 'pre-wrap' }}>{l.body}</td><td className="muted">{l.actor ?? ''}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}

function RunbookEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const d = useApi<{ runbook: Rb; steps: Array<{ ord: number; title: string; detail: string }> }>(`/admin/opz/runbooks/${id}`);
  const a = useAct();
  const [steps, setSteps] = useState<Array<{ title: string; detail: string }> | null>(null);
  const x = d.data;
  if (!x) return <div className="card">…</div>;
  const cur = steps ?? x.steps.map((s) => ({ title: s.title, detail: s.detail }));
  const set = (i: number, k: 'title' | 'detail', v: string) => setSteps(cur.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  return (
    <div className="card" data-opz-rb-editor={x.runbook.code}>
      <Flash msg={a.msg} err={a.err} />
      <b>{x.runbook.title}</b> <span className="muted">({x.runbook.code} · 판 {x.runbook.version} · {x.runbook.isActive ? '켜짐' : '꺼짐'})</span>
      {cur.map((s, i) => (
        <p key={i}>{i + 1}. <input value={s.title} onChange={(e) => set(i, 'title', e.target.value)} style={{ width: 280 }} />{' '}
          <input value={s.detail} onChange={(e) => set(i, 'detail', e.target.value)} style={{ width: '50%' }} />{' '}
          <button className="btn-sm" disabled={cur.length <= 1} onClick={() => setSteps(cur.filter((_, j) => j !== i))}>빼기</button></p>
      ))}
      <p>
        <button className="btn-sm" disabled={cur.length >= 30} onClick={() => setSteps([...cur, { title: '', detail: '' }])}>단계 더하기</button>{' '}
        <button className="btn-sm" disabled={!steps || a.busy === 'rb'} onClick={() => void a.run('rb', () => put(`/admin/opz/runbooks/${id}`, { steps: cur }), () => { setSteps(null); d.reload(); onDone(); })}>단계 저장(판 +1)</button>{' '}
        <button className="btn-sm" disabled={a.busy === 'ra'} onClick={() => void a.run('ra', () => put(`/admin/opz/runbooks/${id}`, { isActive: !x.runbook.isActive }), () => { d.reload(); onDone(); })}>{x.runbook.isActive ? '끄기' : '켜기'}</button>
      </p>
    </div>
  );
}

export function OpzIncident() {
  const v = useApi<Board>('/admin/opz/incidents');
  const [open, setOpen] = useState<string | null>(null);
  const [rb, setRb] = useState<string | null>(null);
  const b = v.data;
  if (!b) return <section data-opz-ir="">{v.error ? <p className="warn-text">읽지 못했습니다.</p> : '…'}</section>;
  return (
    <section data-opz-ir="">
      <p className="muted">{b.note}</p>
      <SwitchBox path="/admin/opz/incident-settings" tag="ir" onDone={v.reload}
        cur={{ irOn: b.settings.irOn, irPageNow: b.settings.irPageNow, irReviewDays: b.settings.irReviewDays }}
        rows={[['irOn', '장애 대응 열기(opz.ir_enabled · 처음 꺼짐)'], ['irPageNow', '열 때 당번 개인 텔레그램 바로(opz.ir_page_now · 처음 꺼짐)'], ['irReviewDays', '되돌아보기 기한(일)', 1, 14]]} />
      <p data-opz-ir-oncall={b.oncall.accountId ? 'yes' : 'no'}>오늘 당번: {b.oncall.accountId ? `${b.oncall.name ?? ''} ${b.oncall.email ?? ''} · 개인 텔레그램 ${b.oncall.chat ? '있음' : '없음'}` : '없음(위험감지 › 운영 알림에서 정함)'} · 텔레그램 {b.telegram.ready ? '준비됨' : `준비 안 됨(${b.telegram.reason ?? ''})`}</p>
      {(b.suggestions.uptIncidents.length > 0 || b.suggestions.alerts.length > 0) && (
        <div className="card" data-opz-ir-suggest="">
          <b>열 거리</b>
          {b.suggestions.alerts.map((x) => <div key={`a${x.id}`}>운영 알림 #{x.id} {x.code} · {x.title} · {ymdhm(x.raisedAt)}</div>)}
          {b.suggestions.uptIncidents.map((x) => <div key={`u${x.id}`}>장애 공지 #{x.id} {x.level} · {x.title} · {ymdhm(x.startedAt)}</div>)}
        </div>
      )}
      <OpenBox b={b} onDone={v.reload} />
      <h3>열린 장애</h3>
      <table className="tbl" data-opz-ir-open-list={b.open.length}><tbody>
        {b.open.map((x) => (
          <tr key={x.id}><td>#{x.id}</td><td>{x.sev}</td><td>{x.title}</td><td>{IR_KO[x.state] ?? x.state}</td><td>{x.done} / {x.steps}</td><td className="muted">{ymdhm(x.openedAt)}</td>
            <td><button className="btn-sm" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? '닫기' : '열기'}</button></td></tr>
        ))}
        {!b.open.length && <tr><td className="muted">열린 장애가 없습니다.</td></tr>}
      </tbody></table>
      <h3>끝난 장애(30)</h3>
      <table className="tbl"><tbody>
        {b.closed.map((x) => (
          <tr key={x.id}><td>#{x.id}</td><td>{x.sev}</td><td>{x.title}</td><td>{x.minutes}분</td><td>{x.reviewFinalizedAt ? '되돌아보기 확정' : x.hasReview ? '되돌아보기 쓰는 중' : <span className="warn-text">되돌아보기 없음</span>}</td>
            <td><button className="btn-sm" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? '닫기' : '열기'}</button></td></tr>
        ))}
      </tbody></table>
      {open && <IrView key={open} id={open} b={b} onDone={v.reload} />}
      <h3>런북</h3>
      <table className="tbl" data-opz-rb-list={b.runbooks.length}><tbody>
        {b.runbooks.map((r) => (
          <tr key={r.id}><td>{r.code}</td><td>{r.title}</td><td>{r.kind}</td><td>{r.sevDefault}</td><td>단계 {r.steps}</td><td>판 {r.version}</td><td>{r.isActive ? '켜짐' : '꺼짐'}</td>
            <td><button className="btn-sm" onClick={() => setRb(rb === r.id ? null : r.id)}>{rb === r.id ? '닫기' : '고치기'}</button></td></tr>
        ))}
      </tbody></table>
      {rb && <RunbookEditor key={rb} id={rb} onDone={v.reload} />}
    </section>
  );
}
