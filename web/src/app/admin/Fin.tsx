/* ===== v10.453 ~ 456 (D261 · docs/590 ~ 593) 자금 · 영업 — web/src/app/admin/Fin.tsx 새 파일 =====
 * 대표 11/20 「㉘ · ㉙」.
 *   FinCardLimits   회계 › 법인카드 한도 (자금 묶음)   — 카드별 · 사람별 이번 달 사용 · 한도 정하기(SUPER) · 바꾼 기록
 *   FinTransfers    회계 › 대량 이체     (자금 묶음)   — 묶음 만들기 · 줄 넣기 · 두 사람 승인 · 보내기(처음 꺼짐 · 간주) · 취소
 *   FinTargets      회계 › 매출 목표     (설정 · 보고) — 전체 · 부서 · 담당자 목표 · 실적 · 달성률 · 정하기(SUPER)
 *   FinPartyLedger  회계 › 거래처 원장   (장부 묶음)   — 거래처별 받을 돈 · 갚을 돈 요약 · 한 거래처 줄 · CSV(내려받기 승인)
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md)
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { exportTicket } from './OpsSafetyBoxes';

const won = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const kstDay = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);
const kstYm = () => kstDay().slice(0, 7);
const pctText = (p: number | null | undefined) => (p == null ? '—' : `${p}%`);
const save = (filename: string, csv: string) => {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/* ── v10.453 법인카드 한도 ── */
interface CardRow { tail: string; name: string | null; holderId: string | null; holderName: string | null; limit: number | null; active: boolean; used: number; count: number; pct: number | null; level: 'OK' | 'NEAR' | 'OVER' | 'NONE' }
interface CardView { ym: string; alertOn: boolean; alertPct: number; items: CardRow[]; holders: Array<{ holderId: string | null; holderName: string; cards: number; limit: number; used: number }>;
  total: { used: number; limit: number }; staff: Array<{ id: string; name: string }>; changes: Array<{ id: string; tail: string; reason: string; changedBy: string | null; changedAt: string; after: { monthlyLimit: number } }>; note: string; canEdit: boolean }
const LEVEL_KO: Record<string, string> = { OK: '여유', NEAR: '기준 넘음', OVER: '한도 넘음', NONE: '한도 없음' };

export function FinCardLimits() {
  const [ym, setYm] = useState(kstYm());
  const q = useApi<CardView>(`/admin/acct/card-limits?ym=${ym}`, [ym]);
  const a = useAct();
  const [ed, setEd] = useState<{ tail: string; name: string; holderId: string; monthlyLimit: string; active: boolean; reason: string } | null>(null);
  const d = q.data;
  const open = (r?: CardRow) => setEd({ tail: r?.tail.startsWith('(') ? '' : r?.tail ?? '', name: r?.name ?? '', holderId: r?.holderId ?? '', monthlyLimit: String(r?.limit ?? ''), active: r?.active ?? true, reason: '' });
  const saveEd = () => ed && void a.run('card', () => api(`/admin/acct/card-limits/${encodeURIComponent(ed.tail)}`, { method: 'PUT', body: JSON.stringify({ name: ed.name, holderId: ed.holderId, monthlyLimit: Number(ed.monthlyLimit), active: ed.active, reason: ed.reason }) }), () => { setEd(null); q.reload(); });
  return (
    <section data-fin-card={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts">
        <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} aria-label="달" />{' '}
        {d?.canEdit && <button className="btn-sm" onClick={() => open()} data-fin-card-add="">카드 한도 넣기</button>}
      </div>
      {d && (
        <>
          <p className={d.alertOn ? '' : 'warn-text'}>알림 {d.alertOn ? `켜짐 — 한도의 ${d.alertPct}% · 한도 넘음(매일 09:40)` : '꺼짐 — 정책 › 전체 설정 acct.card_alert'} · 이번 달 합계 <b>{won(d.total.used)}</b> / 한도 합 {won(d.total.limit)}</p>
          <table className="tbl"><thead><tr><th>카드</th><th>이름</th><th>쓰는 사람</th><th className="num">사용</th><th className="num">한도</th><th className="num">%</th><th>상태</th><th className="num">건수</th><th /></tr></thead>
            <tbody>{d.items.map((r) => (
              <tr key={r.tail} data-fin-card-row={r.level}><td>{r.tail}</td><td>{r.name ?? <small className="dim">—</small>}</td><td>{r.holderName ?? <small className="dim">정하지 않음</small>}</td>
                <td className="num">{won(r.used)}</td><td className="num">{won(r.limit)}</td><td className="num">{pctText(r.pct)}</td>
                <td>{r.level === 'OVER' || r.level === 'NEAR' ? <b className="warn-text">{LEVEL_KO[r.level]}</b> : LEVEL_KO[r.level]}</td><td className="num">{r.count}</td>
                <td>{d.canEdit && !r.tail.startsWith('(') && <button className="btn-sm btn-plain" onClick={() => open(r)}>고치기</button>}</td></tr>))}</tbody></table>
          <h4>쓰는 사람별</h4>
          <table className="tbl"><thead><tr><th>사람</th><th className="num">카드</th><th className="num">사용</th><th className="num">한도 합</th></tr></thead>
            <tbody>{d.holders.map((h) => <tr key={h.holderId ?? '-'} data-fin-card-holder=""><td>{h.holderName}</td><td className="num">{h.cards}</td><td className="num">{won(h.used)}</td><td className="num">{won(h.limit)}</td></tr>)}</tbody></table>
          {ed && (
            <div className="card pad" data-fin-card-edit="">
              <input value={ed.tail} onChange={(e) => setEd({ ...ed, tail: e.target.value })} placeholder="끝 4자리" size={6} aria-label="카드 끝 4자리" />{' '}
              <input value={ed.name} onChange={(e) => setEd({ ...ed, name: e.target.value })} placeholder="카드 이름" size={16} />{' '}
              <select value={ed.holderId} onChange={(e) => setEd({ ...ed, holderId: e.target.value })} aria-label="쓰는 사람"><option value="">쓰는 사람 정하지 않음</option>{d.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>{' '}
              <input type="number" value={ed.monthlyLimit} onChange={(e) => setEd({ ...ed, monthlyLimit: e.target.value })} placeholder="달 한도" style={{ width: 120 }} />{' '}
              <label><input type="checkbox" checked={ed.active} onChange={(e) => setEd({ ...ed, active: e.target.checked })} /> 씀</label>{' '}
              <input value={ed.reason} onChange={(e) => setEd({ ...ed, reason: e.target.value })} placeholder="사유(2자 이상)" size={20} />{' '}
              <button className="btn-sm" disabled={!ed.tail || !ed.name || !Number(ed.monthlyLimit) || ed.reason.trim().length < 2 || a.busy === 'card'} onClick={saveEd} data-fin-card-save="">저장</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => setEd(null)}>닫기</button>
            </div>
          )}
          <details><summary>바꾼 기록</summary>{d.changes.map((c) => <p key={c.id}><small className="dim">{ymdhm(c.changedAt)}</small> {c.tail} · {won(c.after?.monthlyLimit)} · {c.reason} · {c.changedBy ?? ''}</p>)}</details>
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── v10.454 대량 이체 ── */
interface TBatch { id: string; title: string; payOn: string; state: string; mode: string | null; itemCount: number; total: number; createdBy: string | null; createdById: string; approvals: number; failed: number; pending?: number; sentAt: string | null }
interface TList { on: boolean; mode: string; max: number; ready: boolean; provider?: string; env?: string; states: Record<string, string>; results?: Record<string, string>; items: TBatch[]; payRoles: Array<{ role: string; name: string }>; note: string; me: string | null }
interface TDetail { batch: TBatch & { createdAt: string; approvedAt: string | null; sentBy: string | null; cancelNote: string | null }; stateKo: string;
  lines: Array<{ id: string; payee: string; bankCode: string; account: string; amount: number; payRole: string; payRoleName: string | null; memo: string | null; result: string | null; resultCode: string | null; resultMsg: string | null; bankRspCode?: string | null; tranId?: string | null; entryId: string | null }>;
  approvals: Array<{ approverId: string; approver: string | null; note: string | null; approvedAt: string }> }
const EMPTY_ITEM = { payee: '', bankCode: '', accountNo: '', amount: '', payRole: 'AP', memo: '' };

export function FinTransfers() {
  const q = useApi<TList>('/admin/fin/transfers');
  const a = useAct();
  const [sel, setSel] = useState<string | null>(null);
  const det = useApi<TDetail | null>(sel ? `/admin/fin/transfers/${sel}` : '/admin/fin/transfers', [sel]);
  const [nb, setNb] = useState({ title: '', payOn: kstDay() });
  const [it, setIt] = useState({ ...EMPTY_ITEM });
  const d = q.data, t = sel ? (det.data as TDetail | null) : null;
  const reload = () => { q.reload(); det.reload(); };
  const mine = !!(d?.me && t?.batch?.createdById === d.me);
  const iApproved = !!(d?.me && (t?.approvals ?? []).some((x) => x.approverId === d.me));
  return (
    <section data-fin-transfer={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className={d.on ? '' : 'warn-text'} data-fin-transfer-on={d.on ? 'on' : 'off'}>보내기 {d.on ? '켜짐' : '꺼짐(acct.transfer)'} · 방식 <b>{d.mode === 'LIVE' ? `LIVE(금융결제원 오픈뱅킹 · ${d.env === 'PROD' ? '운영' : '시험 서버'})` : '간주(ASSUME · 금융결제원에 보내지 않음)'}</b>{!d.ready && <b className="warn-text"> · 금융결제원 키 · 이용기관코드 · 약정계좌 없음</b>} · 한 묶음 상한 {won(d.max)}원</p>
          <div className="card pad">
            <b>새 묶음</b> <input value={nb.title} onChange={(e) => setNb({ ...nb, title: e.target.value })} placeholder="묶음 이름(예: 11월 25일 거래처 대금)" size={28} />{' '}
            <input type="date" value={nb.payOn} onChange={(e) => setNb({ ...nb, payOn: e.target.value })} aria-label="지급일" />{' '}
            <button className="btn-sm" disabled={nb.title.trim().length < 2} onClick={() => void a.run('new', () => api<{ id: string }>('/admin/fin/transfers', { method: 'POST', body: JSON.stringify(nb) }), undefined).then((r) => { if (r) { setNb({ title: '', payOn: kstDay() }); setSel((r as { id: string }).id); q.reload(); } })} data-fin-transfer-new="">만들기</button>
          </div>
          <table className="tbl"><thead><tr><th>번호</th><th>이름</th><th>지급일</th><th className="num">줄</th><th className="num">합계</th><th>상태</th><th>승인</th><th>만든 사람</th></tr></thead>
            <tbody>{d.items.map((b) => (
              <tr key={b.id} className={sel === b.id ? 'on' : ''} onClick={() => setSel(b.id)} style={{ cursor: 'pointer' }} data-fin-transfer-row={b.state}>
                <td>{b.id}</td><td>{b.title}</td><td>{b.payOn}</td><td className="num">{b.itemCount}</td><td className="num">{won(b.total)}</td>
                <td>{d.states[b.state] ?? b.state}{b.mode === 'ASSUME' && <small className="dim"> 간주</small>}{b.failed > 0 && <b className="warn-text"> 실패 {b.failed}</b>}{(b.pending ?? 0) > 0 && <b className="warn-text"> 결과 모름 {b.pending}</b>}</td><td>{b.approvals} / 2</td><td>{b.createdBy ?? ''}</td></tr>))}</tbody></table>
          {t && t.batch && Array.isArray(t.lines) && (
            <div className="card pad" data-fin-transfer-detail={t.batch.state}>
              <b>{t.batch.id}. {t.batch.title}</b> · {t.batch.payOn} · {t.stateKo} · {t.batch.itemCount}줄 {won(t.batch.total)}원 · 승인 {t.approvals.map((x) => x.approver).join(', ') || '없음'}
              <table className="tbl"><thead><tr><th>받는 분</th><th>은행</th><th>계좌</th><th className="num">금액</th><th>낸 계정</th><th>표시</th><th>결과</th><th /></tr></thead>
                <tbody>{t.lines.map((l) => (
                  <tr key={l.id} data-fin-transfer-line={l.result ?? ''}><td>{l.payee}</td><td>{l.bankCode}</td><td>{l.account}</td><td className="num">{won(l.amount)}</td><td>{l.payRoleName ?? l.payRole}</td><td>{l.memo ?? ''}</td>
                    <td>{l.result ? `${(d.results ?? { OK: '성공', FAIL: '실패', ASSUMED: '간주', HOLD: '보내지 않음', PENDING: '처리 중' })[l.result] ?? l.result}${l.resultMsg ? ` · ${l.resultMsg}` : ''}` : (t.batch.state === 'CHECKING' ? '결과 모름' : '')}{l.entryId && <small className="dim"> 전표 {l.entryId}</small>}</td>
                    <td>{t.batch.state === 'DRAFT' && <button className="btn-sm btn-plain" onClick={() => void a.run(`rm${l.id}`, () => api(`/admin/fin/transfers/${t.batch.id}/items/${l.id}/remove`, { method: 'POST' }), reload)}>빼기</button>}</td></tr>))}</tbody></table>
              {t.batch.state === 'DRAFT' && (
                <p data-fin-transfer-additem="">
                  <input value={it.payee} onChange={(e) => setIt({ ...it, payee: e.target.value })} placeholder="받는 분" size={12} />{' '}
                  <input value={it.bankCode} onChange={(e) => setIt({ ...it, bankCode: e.target.value })} placeholder="은행 코드 3자리" size={6} />{' '}
                  <input value={it.accountNo} onChange={(e) => setIt({ ...it, accountNo: e.target.value })} placeholder="계좌번호" size={16} autoComplete="off" />{' '}
                  <input type="number" value={it.amount} onChange={(e) => setIt({ ...it, amount: e.target.value })} placeholder="금액" style={{ width: 110 }} />{' '}
                  <select value={it.payRole} onChange={(e) => setIt({ ...it, payRole: e.target.value })} aria-label="낸 계정">{d.payRoles.map((r) => <option key={r.role} value={r.role}>{r.name}</option>)}</select>{' '}
                  <input value={it.memo} onChange={(e) => setIt({ ...it, memo: e.target.value })} placeholder="통장 표시" size={10} maxLength={20} />{' '}
                  <button className="btn-sm" disabled={!it.payee || !/^[0-9]{3}$/.test(it.bankCode) || !it.accountNo || !Number(it.amount)}
                    onClick={() => void a.run('item', () => api(`/admin/fin/transfers/${t.batch.id}/items`, { method: 'POST', body: JSON.stringify({ items: [{ ...it, amount: Number(it.amount) }] }) }), () => { setIt({ ...EMPTY_ITEM }); reload(); })} data-fin-transfer-item-add="">줄 넣기</button>
                </p>
              )}
              <div className="acts">
                {t.batch.state === 'DRAFT' && <button className="btn-sm" disabled={mine || iApproved || !t.lines.length} title={mine ? '만든 사람은 승인하지 않습니다' : ''}
                  onClick={() => { if (confirm(`${t.batch.title} ${won(t.batch.total)}원을 승인할까요?`)) void a.run('apv', () => api(`/admin/fin/transfers/${t.batch.id}/approve`, { method: 'POST', body: JSON.stringify({}) }), reload); }} data-fin-transfer-approve="">승인</button>}{' '}
                {t.batch.state === 'APPROVED' && <button className="btn-sm" disabled={!d.on}
                  onClick={() => { if (confirm(`${t.batch.itemCount}줄 ${won(t.batch.total)}원을 ${d.mode === 'LIVE' ? '금융결제원으로 보낼까요(먼저 받는 분 이름을 확인하고, 이름이 다른 줄은 보내지 않습니다)' : '간주로 처리할까요(금융결제원에 보내지 않음)'}?`)) void a.run('send', () => api(`/admin/fin/transfers/${t.batch.id}/send`, { method: 'POST' }), reload); }} data-fin-transfer-send="">보내기</button>}{' '}
                {t.batch.state === 'CHECKING' && <button className="btn-sm" onClick={() => void a.run('chk', () => api(`/admin/fin/transfers/${t.batch.id}/check`, { method: 'POST' }), reload)} data-fin-transfer-check="">결과 조회</button>}{' '}
                {['DRAFT', 'APPROVED'].includes(t.batch.state) && <button className="btn-sm btn-plain" onClick={() => { const reason = prompt('취소 사유(2자 이상)'); if (reason) void a.run('cx', () => api(`/admin/fin/transfers/${t.batch.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }), reload); }}>취소</button>}
              </div>
            </div>
          )}
          <p className="muted">{d.note} 만든 사람이 아닌 두 사람이 승인해야 보낼 수 있습니다. 계좌번호는 암호로 저장되고 끝 4자리만 보입니다. 「결과 모름」 줄은 다시 보내지 않고 「결과 조회」로만 확정합니다(이중 이체 막기).</p>
        </>
      )}
    </section>
  );
}

/* ── v10.455 매출 목표 ── */
interface TgRow { key: string; label: string; target: number | null; memo: string | null; actual: number; rate: number | null; docs?: number }
interface TgView { ym: string; total: { target: number | null; memo: string | null; actual: number; rate: number | null }; depts: TgRow[]; untagged: number; owners: TgRow[];
  staff: Array<{ id: string; name: string }>; changes: Array<{ id: string; axis: string; targetKey: string; before: number | null; after: number; reason: string; changedBy: string | null; changedAt: string }>; note: string; canEdit: boolean }

export function FinTargets() {
  const [ym, setYm] = useState(kstYm());
  const q = useApi<TgView>(`/admin/acct/sales-targets?ym=${ym}`, [ym]);
  const a = useAct();
  const [ed, setEd] = useState<{ axis: string; deptId?: string; ownerId?: string; label: string; amount: string; reason: string } | null>(null);
  const d = q.data;
  const row = (axis: string, r: TgRow) => (
    <tr key={`${axis}${r.key}`} data-fin-target-row={axis}><td>{r.label}{r.docs != null && <small className="dim"> 명세서 {r.docs}</small>}</td><td className="num">{won(r.target)}</td><td className="num">{won(r.actual)}</td><td className="num">{r.rate == null ? '—' : `${r.rate}%`}</td>
      <td>{d?.canEdit && <button className="btn-sm btn-plain" onClick={() => setEd({ axis, ...(axis === 'DEPT' ? { deptId: r.key } : axis === 'OWNER' ? { ownerId: r.key } : {}), label: r.label, amount: String(r.target ?? ''), reason: '' })}>목표</button>}</td></tr>);
  return (
    <section data-fin-target={d?.ym ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts"><input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} aria-label="달" /></div>
      {d && (
        <>
          <table className="tbl"><thead><tr><th>구분</th><th className="num">목표</th><th className="num">실적</th><th className="num">달성률</th><th /></tr></thead>
            <tbody>
              {row('TOTAL', { key: '', label: '회사 전체', ...d.total })}
              <tr><th colSpan={5}>부서</th></tr>
              {d.depts.map((r) => row('DEPT', r))}
              {d.untagged > 0 && <tr><td className="dim">정하지 않음(꼬리표 없음)</td><td /><td className="num">{won(d.untagged)}</td><td /><td /></tr>}
              <tr><th colSpan={5}>담당자</th></tr>
              {d.owners.map((r) => row('OWNER', r))}
            </tbody></table>
          {d.canEdit && (
            <p><select defaultValue="" onChange={(e) => { const s = d.staff.find((x) => x.id === e.target.value); if (s) setEd({ axis: 'OWNER', ownerId: s.id, label: s.name, amount: '', reason: '' }); }} aria-label="담당자 목표 넣기">
              <option value="">담당자 목표 넣기…</option>{d.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></p>
          )}
          {ed && (
            <div className="card pad" data-fin-target-edit="">
              <b>{d.ym} {ed.label}</b> <input type="number" value={ed.amount} onChange={(e) => setEd({ ...ed, amount: e.target.value })} placeholder="목표(원)" style={{ width: 140 }} />{' '}
              <input value={ed.reason} onChange={(e) => setEd({ ...ed, reason: e.target.value })} placeholder="사유(2자 이상)" size={20} />{' '}
              <button className="btn-sm" disabled={ed.amount === '' || ed.reason.trim().length < 2} onClick={() => void a.run('tg', () => api('/admin/acct/sales-targets', { method: 'PUT', body: JSON.stringify({ ym: d.ym, axis: ed.axis, deptId: ed.deptId, ownerId: ed.ownerId, amount: Number(ed.amount), reason: ed.reason }) }), () => { setEd(null); q.reload(); })} data-fin-target-save="">저장</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => setEd(null)}>닫기</button>
            </div>
          )}
          <details><summary>바꾼 기록</summary>{d.changes.map((c) => <p key={c.id}><small className="dim">{ymdhm(c.changedAt)}</small> {c.axis} {c.targetKey} · {won(c.before)} → {won(c.after)} · {c.reason} · {c.changedBy ?? ''}</p>)}</details>
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── v10.456 거래처별 원장 ── */
interface PSum { from: string; to: string; items: Array<{ partyId: string | null; party: string; inBook: boolean; ar: { open: number; inc: number; dec: number; close: number }; ap: { open: number; inc: number; dec: number; close: number }; lines: number }>; total: { ar: number; ap: number }; notInBook: number; note: string }
interface PDet { party: { id: string; name: string }; from: string; to: string; opening: Record<string, number>; closing: Record<string, number>; roles: Record<string, string>;
  rows: Array<{ entryId: string; date: string; source: string; memo: string | null; role: string; roleKo: string; increase: number; decrease: number; balance: number }>; note: string }

export function FinPartyLedger() {
  const [from, setFrom] = useState(`${kstYm()}-01`);
  const [to, setTo] = useState(kstDay());
  const [pid, setPid] = useState<string | null>(null);
  const s = useApi<PSum>(`/admin/acct/party-ledger?from=${from}&to=${to}`, [from, to]);
  const p = useApi<PDet | null>(pid ? `/admin/acct/party-ledger/${pid}?from=${from}&to=${to}` : `/admin/acct/party-ledger?from=${from}&to=${to}`, [pid, from, to]);
  const a = useAct();
  const det = pid ? (p.data as PDet | null) : null;
  const csv = () => pid && void a.run('csv', async () => {
    const t = await exportTicket('ACCT_LEDGER');
    if (!t) throw new Error('내려받기 승인 전입니다 — 위험감지 › 감사 › 「내려받기 승인」에서 확인하십시오.');
    const r = await api<{ filename: string; csv: string; note: string }>(`/admin/acct/party-ledger/${pid}/export?from=${from}&to=${to}&ticket=${t}`);
    save(r.filename, r.csv); return r;
  }, undefined, (r) => r.note);
  const d = s.data;
  return (
    <section data-fin-party={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts">
        <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="시작일" /> ~ <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="끝일" />{' '}
        {pid && <><button className="btn-sm btn-plain" onClick={() => setPid(null)}>요약으로</button>{' '}<button className="btn-sm" disabled={a.busy === 'csv'} onClick={csv} data-fin-party-csv="">CSV</button></>}
      </div>
      {!pid && d && (
        <>
          <p>받을 돈 기말 합 <b>{won(d.total.ar)}</b> · 갚을 돈 기말 합 <b>{won(d.total.ap)}</b>{d.notInBook > 0 && <span className="warn-text"> · 거래처 대장에 없는 이름 {d.notInBook}</span>}</p>
          <table className="tbl"><thead><tr><th>거래처</th><th className="num">받을 돈 기초</th><th className="num">늘어남</th><th className="num">줄어듦</th><th className="num">기말</th><th className="num">갚을 돈 기초</th><th className="num">늘어남</th><th className="num">줄어듦</th><th className="num">기말</th></tr></thead>
            <tbody>{d.items.map((x) => (
              <tr key={x.party} data-fin-party-row={x.inBook ? 'book' : 'nobook'} onClick={() => x.partyId && setPid(x.partyId)} style={{ cursor: x.partyId ? 'pointer' : 'default' }}>
                <td>{x.party}{!x.inBook && <small className="warn-text"> 대장 없음</small>}</td>
                <td className="num">{won(x.ar.open)}</td><td className="num">{won(x.ar.inc)}</td><td className="num">{won(x.ar.dec)}</td><td className="num"><b>{won(x.ar.close)}</b></td>
                <td className="num">{won(x.ap.open)}</td><td className="num">{won(x.ap.inc)}</td><td className="num">{won(x.ap.dec)}</td><td className="num"><b>{won(x.ap.close)}</b></td></tr>))}</tbody></table>
          <p className="muted">{d.note}</p>
        </>
      )}
      {det && det.party && Array.isArray(det.rows) && (
        <div data-fin-party-detail={det.rows.length}>
          <h4>{det.party.name} · {det.from} ~ {det.to}</h4>
          <p>기초 {Object.entries(det.opening).map(([k, v]) => `${det.roles[k]} ${won(v)}`).join(' · ')}</p>
          <table className="tbl"><thead><tr><th>날짜</th><th>전표</th><th>돈 흐름</th><th>내용</th><th>계정</th><th className="num">늘어남</th><th className="num">줄어듦</th><th className="num">잔액</th></tr></thead>
            <tbody>{det.rows.map((r, i) => <tr key={`${r.entryId}-${i}`}><td>{r.date}</td><td>{r.entryId}</td><td>{r.source}</td><td>{r.memo ?? ''}</td><td>{r.roleKo}</td><td className="num">{won(r.increase)}</td><td className="num">{won(r.decrease)}</td><td className="num">{won(r.balance)}</td></tr>)}</tbody></table>
          <p>기말 {Object.entries(det.closing).map(([k, v]) => `${det.roles[k]} ${won(v)}`).join(' · ')}</p>
          <p className="muted">{det.note}</p>
        </div>
      )}
    </section>
  );
}
