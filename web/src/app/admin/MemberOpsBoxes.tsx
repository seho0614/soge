import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

/* ---------------------------------------------------------------------
 * v10.361 ~ 364 (D237 · docs/495 ~ 498)
 *   MemberNotesBox    회원 상세 · 1:1 문의 — 운영 메모(쌓기만) · 「이 사람 다시 가입 · 인증 막기」(SUPER · 회원 상세만)
 *   SignupBlocksBox   위험감지 › 「위험감지」 — 가입 차단 목록 · 더하기 · 풀기(SUPER)
 *   WithdrawStatsBox  회원 › 「회원」 — 탈퇴 사유 통계
 *   TodoBox           첫 화면 — 내 역할의 「오늘 할 일」
 * ------------------------------------------------------------------- */

interface Note { id: string; body: string; important: boolean; createdAt: string; by: string | null }

export function MemberNotesBox({ accountId, compact }: { accountId: string; compact?: boolean }) {
  const q = useApi<{ rows: Note[]; important: number; total: number }>(`/admin/accounts/${accountId}/notes`, [accountId]);
  const a = useAct();
  const [body, setBody] = useState('');
  const [imp, setImp] = useState(false);
  const sup = tokenRoles().includes('SUPER');
  if (q.error || !q.data) return null;
  const d = q.data;
  const rows = compact ? d.rows.filter((r) => r.important).concat(d.rows.filter((r) => !r.important)).slice(0, 3) : d.rows;
  const add = () => void a.run('add', () => api(`/admin/accounts/${accountId}/notes`, { method: 'POST', body: JSON.stringify({ body, important: imp }) }), () => { setBody(''); setImp(false); q.reload(); });
  const block = () => {
    const reason = prompt('이 사람(본인인증 기준)의 다시 가입 · 본인인증을 막습니다. 사유를 적으십시오(2 ~ 200자).');
    if (!reason) return;
    void a.run('block', () => api('/admin/signup-blocks', { method: 'POST', body: JSON.stringify({ kind: 'PERSON', accountId, reason }) }));
  };
  return (
    <div className={compact ? 'ad-nt info' : 'card'} data-member-notes={`${d.total}|${d.important}`}>
      <Flash msg={a.msg} err={a.err} />
      <b>운영 메모</b> <small className="dim">운영진만 · 회원에게 안 보임 · 고치기 없음(새 메모로 바로잡음){d.important ? ` · 중요 ${d.important}` : ''}</small>
      {rows.length === 0 ? <p className="muted">메모가 없습니다.</p> : (
        <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
          {rows.map((r) => (
            <li key={r.id} data-member-note={r.important ? 'imp' : 'n'}>
              {r.important && <b className="warn-text">중요 </b>}<span style={{ whiteSpace: 'pre-line' }}>{r.body}</span> <small className="dim">{ymdhm(r.createdAt)}{r.by ? ` · ${r.by}` : ''}</small>
            </li>
          ))}
        </ul>
      )}
      {compact ? (d.total > rows.length && <small className="dim">메모 {d.total}개 중 {rows.length}개 — 회원 › 회원 상세에서 모두</small>) : (
        <p>
          <textarea name="member-note" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={2} style={{ width: '100%' }} placeholder="메모(2 ~ 1,000자)" />
          <label><input type="checkbox" name="member-note-imp" checked={imp} onChange={(e) => setImp(e.target.checked)} /> 중요</label>{' '}
          <button className="btn-sm btn-ok" disabled={a.busy === 'add' || body.trim().length < 2} onClick={add} data-member-note-add="">메모 남기기</button>
          {sup && <>{' '}<button className="btn-sm btn-plain" disabled={a.busy === 'block'} onClick={block} data-member-block="">이 사람 다시 가입 · 인증 막기</button></>}
        </p>
      )}
    </div>
  );
}

interface Blocks {
  active: Array<{ id: string; kind: string; value: string; label: string | null; reason: string; expiresAt: string | null; createdAt: string; by: string | null; expired: boolean }>;
  removed: Array<{ id: string; kind: string; value: string; label: string | null; reason: string; removedAt: string; removedReason: string }>;
  hits: Array<{ kind: string; today: number; d7: number }>; canEdit: boolean;
}
const KIND_KO: Record<string, string> = { EMAIL_DOMAIN: '이메일 도메인', IP_CIDR: 'IP 대역', PERSON: '사람(본인인증)' };

export function SignupBlocksBox() {
  const q = useApi<Blocks>('/admin/signup-blocks');
  const a = useAct();
  const [kind, setKind] = useState('EMAIL_DOMAIN');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('');
  if (q.error || !q.data) return null;
  const d = q.data;
  const add = () => void a.run('add', () => api('/admin/signup-blocks', { method: 'POST', body: JSON.stringify({ kind, value, reason, ...(days ? { expiresDays: Number(days) } : {}) }) }), () => { setValue(''); setReason(''); q.reload(); });
  const remove = (id: string) => {
    const r = prompt('이 차단을 풉니다. 사유를 적으십시오(2 ~ 200자).');
    if (r) void a.run(`rm${id}`, () => api(`/admin/signup-blocks/${id}/remove`, { method: 'POST', body: JSON.stringify({ reason: r }) }), q.reload);
  };
  const today = d.hits.reduce((s, h) => s + h.today, 0), d7 = d.hits.reduce((s, h) => s + h.d7, 0);
  return (
    <div className="card" data-signup-blocks={d.active.length}>
      <Flash msg={a.msg} err={a.err} />
      <h3 className="sec">가입 차단 목록 <small className="dim">걸리면 가입 · 본인인증을 이유 없이 거절 · 막힌 수 오늘 {today} · 7일 {d7} · 사람 단위는 회원 상세에서</small></h3>
      <table className="tbl"><thead><tr><th>종류</th><th>값</th><th>사유</th><th>기한</th><th>더한 사람 · 때</th>{d.canEdit && <th />}</tr></thead><tbody>
        {d.active.length === 0 && <tr><td colSpan={6} className="dim">없음</td></tr>}
        {d.active.map((b) => (
          <tr key={b.id} data-signup-block={b.kind} className={b.expired ? 'muted' : undefined}>
            <td>{KIND_KO[b.kind] ?? b.kind}</td><td>{b.kind === 'PERSON' ? b.label ?? b.value : b.value}</td><td>{b.reason}</td>
            <td>{b.expiresAt ? `${ymdhm(b.expiresAt)}${b.expired ? ' (지남)' : ''}` : '없음'}</td><td className="dim">{b.by ?? '-'} · {ymdhm(b.createdAt)}</td>
            {d.canEdit && <td><button className="btn-sm" disabled={a.busy === `rm${b.id}`} onClick={() => remove(b.id)} data-signup-unblock={b.id}>풀기</button></td>}
          </tr>
        ))}
      </tbody></table>
      {d.canEdit && (
        <p>
          <select name="block-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="EMAIL_DOMAIN">이메일 도메인</option><option value="IP_CIDR">IP 대역</option>
          </select>{' '}
          <input name="block-value" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === 'IP_CIDR' ? '203.0.113.0/24' : 'spam.example'} maxLength={100} />{' '}
          <input name="block-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" maxLength={200} />{' '}
          <select name="block-days" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="">기한 없음</option>{[7, 30, 90, 365].map((n) => <option key={n} value={n}>{n}일</option>)}
          </select>{' '}
          <button className="btn-sm btn-ok" disabled={a.busy === 'add' || !value.trim() || reason.trim().length < 2} onClick={add} data-signup-block-add="">차단 더하기</button>
        </p>
      )}
      {d.removed.length > 0 && <details><summary className="dim">최근 푼 것 {d.removed.length}</summary>
        <ul>{d.removed.map((b) => <li key={b.id}>{KIND_KO[b.kind]} {b.kind === 'PERSON' ? b.label : b.value} — {b.reason} → 풂 {ymdhm(b.removedAt)} · {b.removedReason}</li>)}</ul></details>}
    </div>
  );
}

interface Wd { months: number; total: number; medianDays: number | null; hadDeal: number; monthly: Array<{ month: string; n: number }>; reasons: Array<{ code: string; label: string; n: number }>; memos: Array<{ at: string; memo: string }> }

export function WithdrawStatsBox() {
  const [open, setOpen] = useState(false);
  const q = useApi<Wd>(open ? '/admin/reports/withdrawals?months=6' : '/admin/reports/withdrawals?months=3', [open]);
  if (q.error || !q.data) return null;
  const d = q.data;
  return (
    <details className="card" data-withdraw-stats={d.total} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><b>탈퇴 사유 통계</b> <small className="dim">최근 {d.months}달 탈퇴 {d.total}명{d.reasons[0] ? ` · 1위 ${d.reasons[0].label} ${d.reasons[0].n}` : ''}</small></summary>
      <p>월별: {d.monthly.length ? d.monthly.map((m) => `${m.month} ${m.n}`).join(' · ') : '없음'} · 가입 뒤 탈퇴까지 가운데 {d.medianDays ?? '—'}일 · 거래 있던 회원 {d.hadDeal}</p>
      <p>사유: {d.reasons.length ? d.reasons.map((r) => `${r.label} ${r.n}`).join(' · ') : '없음'}</p>
      {d.memos.length > 0 && <ul data-withdraw-memos={d.memos.length}>{d.memos.map((m, i) => <li key={i}><small className="dim">{ymdhm(m.at)}</small> {m.memo}</li>)}</ul>}
    </details>
  );
}

interface Todo { items: Array<{ key: string; label: string; n: number; oldest: string | null; over: number; tab: string }>; total: number }

export function TodoBox({ onGo, canGo }: { onGo: (tab: string) => void; canGo?: (tab: string) => boolean }) {
  const q = useApi<Todo>('/admin/todo');
  if (q.error || !q.data) return null;
  const items = q.data.items.filter((x) => x.n > 0);
  return (
    <div className="card" data-todo={q.data.total}>
      <b>오늘 할 일</b> <small className="dim">내 역할에 맞는 것만 · 누르면 그 화면</small>
      {items.length === 0 ? <p className="muted" data-todo-none="">지금 할 일이 없습니다.</p> : (
        <table className="tbl" style={{ marginTop: 6 }}><tbody>
          {items.map((x) => (
            <tr key={x.key} data-todo-row={x.key}>
              <td>{x.label}</td><td><b>{x.n}</b>{x.over ? <span className="warn-text"> · 넘김 {x.over}</span> : null}</td>
              <td className="dim">{x.oldest ? `가장 오래된 것 ${ymdhm(x.oldest)}` : ''}</td>
              <td>{(!canGo || canGo(x.tab)) && <button className="linkbtn" onClick={() => onGo(x.tab)} data-todo-go={x.tab}>열기</button>}</td>
            </tr>
          ))}
        </tbody></table>
      )}
    </div>
  );
}
