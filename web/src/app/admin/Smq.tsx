/* ===== v10.577 ~ 579 (docs/719 ~ 721) 12차 소개몰 · 파트너 — web/src/app/admin/Smq.tsx 새 파일 =====
 * 대표 11/21 「16개 모두 동시에」 — 스위치는 모두 처음 꺼짐(smq.qna · smq.penalty · smq.penalty_exposure)
 *   SmqQna          소개몰 › 상품 문의 답 관리 — 답할 것 · 기한 넘김 · 운영 확인 대기 · 직판은 여기서 답(기존 답 주소) · 문의 · 답 보이기 · 가리기
 *   SmqTenantReady2 소개몰 › 소개몰 판매자 1차 점검 · 요율 시뮬레이션 아래 — 입점 열기 2차 점검(읽기만)
 *   SmqGrades       소개몰 › 판매자 평가 · 패널티 — 달 고르기 · 판매자별 숫자 · 등급 · 경고 · 노출 제한 승인 · 반려 · 풀기 · 기준(SUPER 고침)
 * (adminMenu · App.tsx · HealthSellerTab 연결 줄은 patches/1_wiring.md) · 색 · 글자는 기존 클래스(card · tbl · btn-sm · btn-plain · warn-text · muted · st ok/no/wait)만
 */
import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';

const nn = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));
const pc = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);

/* ── ① 상품 문의 답 관리 (v10.577) ── */
interface QnaRow { id: string; body: string; isPrivate: boolean; state: string; holdWord: string | null; hiddenReason: string | null; createdAt: string; dueAt: string | null; overdue: boolean;
  answer: string | null; answerKind: string | null; answerState: string; answerHoldWord: string | null; answerHiddenReason: string | null; answeredAt: string | null;
  productCode: string; productName: string; sellerType: string; sellerName: string | null; writer: string }
interface QnaView { on: boolean; dueHours: number; view: string; counts: { open: number; overdue: number; pending: number }; items: QnaRow[]; note: string }
const QST_KO: Record<string, string> = { VISIBLE: '보임', PENDING: '운영 확인 대기', HIDDEN: '가림' };

export function SmqQna() {
  const [view, setView] = useState('open');
  const v = useApi<QnaView>(`/admin/smq/qna?view=${view}`, [view]);
  const a = useAct();
  const [text, setText] = useState<Record<string, string>>({});
  const d = v.data;
  if (v.error) return <ErrorView error={v.error} />;
  const answer = (r: QnaRow) => {
    const t = (text[r.id] ?? '').trim();
    if (t.length >= 2) void a.run(`a${r.id}`, () => api(`/admin/health/qna/${r.id}/answer`, { method: 'POST', body: JSON.stringify({ answer: t }) }), () => { setText({ ...text, [r.id]: '' }); v.reload(); });
  };
  const decide = (r: QnaRow, target: 'QUESTION' | 'ANSWER', action: 'SHOW' | 'HIDE') => {
    const reason = action === 'HIDE' ? prompt('가리는 사유(2자 이상):', '') : '';
    if (action === 'HIDE' && !(reason && reason.trim().length >= 2)) return;
    void a.run(`d${r.id}`, () => api(`/admin/smq/qna/${r.id}/decide`, { method: 'POST', body: JSON.stringify(action === 'HIDE' ? { target, action, reason: reason!.trim() } : { target, action }) }), v.reload);
  };
  return (
    <section data-smq-qna={d ? (d.on ? 'on' : 'off') : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && <p className={d.on ? '' : 'warn-text'}>{d.note}</p>}
      <p data-smq-qna-filter="">
        {[['open', `답할 것 ${d ? nn(d.counts.open) : ''}`], ['overdue', `기한 넘김 ${d ? nn(d.counts.overdue) : ''}`], ['pending', `운영 확인 대기 ${d ? nn(d.counts.pending) : ''}`], ['all', '모두']]
          .map(([k, l]) => <button key={k} className={`btn-sm ${view === k ? '' : 'btn-plain'}`} onClick={() => setView(k ?? 'open')}>{l}</button>)}
      </p>
      {d && (
        <table className="tbl"><thead><tr><th>문의</th><th>답</th><th /></tr></thead>
          <tbody>{d.items.map((r) => (
            <tr key={r.id} data-smq-qna-row={r.overdue ? 'overdue' : r.state}>
              <td style={{ maxWidth: 380 }}>
                <div>{r.productName} <span className="muted">{r.sellerType === 'DIRECT' ? '직판' : r.sellerName ?? ''}</span></div>
                <div className="muted">{r.writer} · {ymdhm(r.createdAt)}{r.isPrivate ? ' · 비밀글' : ''} · 기한 {ymdhm(r.dueAt)}{r.overdue ? <span className="st no"> 넘김</span> : null}</div>
                <div>{r.body}</div>
                {r.state !== 'VISIBLE' && <div className="warn-text">문의 {QST_KO[r.state] ?? r.state}{r.holdWord ? ` · 걸린 말 「${r.holdWord}」` : ''}{r.hiddenReason ? ` · 사유 ${r.hiddenReason}` : ''}</div>}
              </td>
              <td style={{ maxWidth: 380 }}>
                {r.answer ? <div><span className="muted">{r.answerKind === 'SELLER' ? '판매자' : '운영'} · {QST_KO[r.answerState] ?? r.answerState} · {ymdhm(r.answeredAt)}</span>
                  {r.answerHoldWord ? <span className="warn-text"> · 걸린 말 「{r.answerHoldWord}」</span> : null}
                  {r.answerHiddenReason ? <span className="muted"> · 사유 {r.answerHiddenReason}</span> : null}
                  <div>{r.answer}</div></div> : <span className="muted">답 없음</span>}
                {r.state === 'VISIBLE' && (
                  <textarea rows={2} cols={44} value={text[r.id] ?? ''} onChange={(e) => setText({ ...text, [r.id]: e.target.value })}
                    placeholder={r.sellerType === 'DIRECT' ? '운영 답(2 ~ 2,000자)' : '입점 상품 — 보통 판매자가 답합니다(운영 답은 판매자 답을 바꿈)'} aria-label="운영 답" />
                )}
              </td>
              <td>
                {r.state === 'VISIBLE' && <button className="btn-sm" disabled={a.busy === `a${r.id}`} onClick={() => answer(r)} data-smq-qna-answer="">{r.answer ? '답 고치기' : '답하기'}</button>}{' '}
                {r.state !== 'VISIBLE' && <button className="btn-sm btn-plain" disabled={a.busy === `d${r.id}`} onClick={() => decide(r, 'QUESTION', 'SHOW')}>문의 보이기</button>}{' '}
                {r.state !== 'HIDDEN' && <button className="btn-sm btn-plain" disabled={a.busy === `d${r.id}`} onClick={() => decide(r, 'QUESTION', 'HIDE')}>문의 가리기</button>}{' '}
                {r.answer && r.answerState !== 'VISIBLE' && <button className="btn-sm btn-plain" disabled={a.busy === `d${r.id}`} onClick={() => decide(r, 'ANSWER', 'SHOW')}>답 보이기</button>}{' '}
                {r.answer && r.answerState !== 'HIDDEN' && <button className="btn-sm btn-plain" disabled={a.busy === `d${r.id}`} onClick={() => decide(r, 'ANSWER', 'HIDE')}>답 가리기</button>}
              </td>
            </tr>))}
            {d.items.length === 0 && <tr><td colSpan={3} className="muted">없습니다.</td></tr>}
          </tbody></table>
      )}
    </section>
  );
}

/* ── ② 입점 열기 2차 점검 (v10.578) ── */
interface R2Row { key: string; group: string; label: string; state: 'ok' | 'todo' | 'info'; now: string }
interface R2 { ready: boolean; todo: number; groups: Array<{ g: string; title: string }>; rows: R2Row[]; note: string }
const MARK2: Record<R2Row['state'], { cls: string; text: string }> = { ok: { cls: 'st ok', text: '준비됨' }, todo: { cls: 'st no', text: '막힘' }, info: { cls: 'st wait', text: '값' } };

export function SmqTenantReady2() {
  const q = useApi<R2>('/admin/smq/tenant-ready2');
  if (q.error) return <ErrorView error={q.error} />;
  const d = q.data;
  if (!d) return null;
  return (
    <div data-smq-ready2={d.ready ? '1' : '0'}>
      <h3 className="sec">입점 열기 2차 점검</h3>
      <p className="muted">{d.note} — 막힘 {d.todo}곳</p>
      {d.groups.map(({ g, title }) => (
        <div key={g} data-smq-ready2-group={g}>
          <p><b>{title}</b></p>
          <table className="tbl"><tbody>
            {d.rows.filter((r) => r.group === g).map((r) => (
              <tr key={r.key} data-smq-ready2-row={r.key} data-state={r.state}>
                <th>{r.label}</th><td><span className={MARK2[r.state].cls}>{MARK2[r.state].text}</span></td><td>{r.now}</td>
              </tr>))}
          </tbody></table>
        </div>
      ))}
    </div>
  );
}

/* ── ③ 판매자 평가 · 패널티 (v10.579) ── */
interface Rules { latePct: number; cancelPct: number; qnaPct: number; minOrders: number; shipDays: number; limitMonths: number; limitDays: number; qnaDueHours: number }
interface GradeRow { id: string | null; sellerId: string; sellerCode: string; sellerName: string; sellerStatus: string; orders: number; lateShip: number; sellerCancels: number; qnaTotal: number; qnaLate: number;
  latePct: number | null; cancelPct: number | null; qnaPct: number | null; grade: string; level: string; over: string[]; computedAt: string | null; notifiedAt: string | null }
interface LimitRow { id: string; sellerId: string; sellerName: string; state: string; reason: string; fromOn: string | null; untilOn: string | null; proposedAt: string; decidedAt: string | null;
  decideNote: string | null; liftedAt: string | null; liftNote: string | null; inEffect: boolean }
interface GradeView { on: boolean; exposureOn: boolean; rules: Rules; minQna: number; ym: string; preview: boolean; items: GradeRow[]; limits: LimitRow[]; note: string }
const LV_KO: Record<string, string> = { OK: '보통', WARN: '경고', LIMIT: '노출 제한 제안' };
const LM_KO: Record<string, string> = { PROPOSED: '제안', ACTIVE: '적용', REJECTED: '반려', LIFTED: '풀림' };
const RULE_KO: Array<[keyof Rules, string, string]> = [
  ['latePct', '배송 지연 기준(퍼센트 · 1 ~ 100)', '1 ~ 100'], ['cancelPct', '판매자 사정 취소 · 반품 기준(퍼센트)', '1 ~ 100'], ['qnaPct', '문의 답 늦음 기준(퍼센트)', '1 ~ 100'],
  ['minOrders', '평가 표본 주문 수', '1 ~ 1000'], ['shipDays', '발송 기한(일)', '1 ~ 14'], ['limitMonths', '노출 제한 제안 — 잇달아 경고 달 수', '2 ~ 6'],
  ['limitDays', '노출 제한 기간(일)', '1 ~ 90'], ['qnaDueHours', '상품 문의 답 기한(시간)', '1 ~ 168'],
];
const prevYm = () => { const k = new Date(Date.now() + 9 * 3600e3); const d = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() - 1, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

export function SmqGrades() {
  const [ym, setYm] = useState(prevYm());
  const v = useApi<GradeView>(`/admin/smq/grades?ym=${ym}`, [ym]);
  const a = useAct();
  const isSuper = tokenRoles().includes('SUPER');
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const d = v.data;
  if (v.error) return <ErrorView error={v.error} />;
  const recalc = () => void a.run('recalc', () => api<{ saved?: number; sellers?: number }>('/admin/smq/grades/recalc', { method: 'POST', body: JSON.stringify({ ym }) }), v.reload,
    (r) => `${ym} — 판매자 ${r?.sellers ?? 0}명 셈 · 저장 ${r?.saved ?? 0}줄(알린 줄은 그대로).`);
  const decide = (l: LimitRow, action: 'APPROVE' | 'REJECT' | 'LIFT') => {
    const note = prompt(action === 'APPROVE' ? '메모(선택):' : '사유(2자 이상 · 기록에 남음):', '');
    if (note === null || (action !== 'APPROVE' && note.trim().length < 2)) return;
    void a.run(`l${l.id}`, () => api(`/admin/smq/limits/${l.id}/decide`, { method: 'POST', body: JSON.stringify({ action, note: note.trim() || undefined }) }), v.reload);
  };
  const saveRules = () => {
    if (!edit) return;
    const body: Record<string, unknown> = {};
    for (const [k] of RULE_KO) if (edit[k] !== undefined && edit[k] !== String(d?.rules[k] ?? '')) body[k] = edit[k]!.trim();
    if (edit.exposure !== undefined && (edit.exposure === 'on') !== d?.exposureOn) body.exposure = edit.exposure === 'on';
    if (!Object.keys(body).length) { a.setErr('바뀐 값이 없습니다.'); return; }
    void a.run('rules', () => api('/admin/smq/rules', { method: 'PUT', body: JSON.stringify(body) }), () => { setEdit(null); v.reload(); }, '기준을 바꿨습니다 — 다음 셈부터 씁니다.');
  };
  return (
    <section data-smq-grades={d ? (d.on ? 'on' : 'off') : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && <p className={d.on ? '' : 'warn-text'}>{d.note} {d.exposureOn ? '' : '· 노출 제한 실제 적용 꺼짐(승인해도 목록에는 그대로).'}</p>}
      <p data-smq-grade-filter="">
        <label>달 <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} aria-label="평가 달" /></label>{' '}
        <button className="btn-sm btn-plain" disabled={a.busy === 'recalc'} onClick={recalc}>다시 셈(끝난 달 저장)</button>
        {d?.preview && <span className="st wait"> 미리보기</span>}
      </p>
      {d && (
        <div className="card" data-smq-rules="">
          <p><b>기준(일반 초안)</b> — 배송 지연 {d.rules.latePct}% · 판매자 사정 취소 · 반품 {d.rules.cancelPct}% · 문의 답 늦음 {d.rules.qnaPct}% 넘으면 기준 넘음 ·
            주문 {d.rules.minOrders}건 · 문의 {d.minQna}건 미만은 그 기준을 판정하지 않음 · 발송 기한 {d.rules.shipDays}일 · 잇달아 {d.rules.limitMonths}달 경고면 노출 제한 제안(승인 뒤 {d.rules.limitDays}일) · 문의 답 기한 {d.rules.qnaDueHours}시간
            {isSuper && !edit && <>{' '}<button className="btn-sm btn-plain" data-smq-rules-edit="" onClick={() => setEdit({ ...Object.fromEntries(RULE_KO.map(([k]) => [k, String(d.rules[k])])), exposure: d.exposureOn ? 'on' : 'off' })}>기준 고치기(SUPER)</button></>}
          </p>
          {edit && (
            <div data-smq-rules-form="">
              {RULE_KO.map(([k, label, range]) => (
                <p key={k}><label>{label} <input value={edit[k] ?? ''} size={5} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} aria-label={label} /> <span className="muted">{range}</span></label></p>))}
              <p><label>노출 제한 실제 적용 <select value={edit.exposure ?? 'off'} onChange={(e) => setEdit({ ...edit, exposure: e.target.value })}><option value="off">꺼짐</option><option value="on">켜짐(입점 약관에 기준을 적은 뒤)</option></select></label></p>
              <button className="btn-sm" disabled={a.busy === 'rules'} onClick={saveRules}>저장</button>{' '}<button className="btn-sm btn-plain" onClick={() => setEdit(null)}>취소</button>
            </div>
          )}
        </div>
      )}
      {d && d.limits.length > 0 && (
        <>
          <h3 className="sec">노출 제한</h3>
          <table className="tbl" data-smq-limits={d.limits.length}><thead><tr><th>판매자</th><th>상태</th><th>사유</th><th>기간</th><th /></tr></thead>
            <tbody>{d.limits.map((l) => (
              <tr key={l.id} data-smq-limit-row={l.state}>
                <td>{l.sellerName}</td>
                <td>{LM_KO[l.state] ?? l.state}{l.state === 'ACTIVE' ? (l.inEffect ? <span className="st no"> 목록에서 빠짐</span> : <span className="muted"> (실제 적용 꺼짐)</span>) : null}</td>
                <td>{l.reason}{l.decideNote ? <div className="muted">{l.decideNote}</div> : null}{l.liftNote ? <div className="muted">풀기: {l.liftNote}</div> : null}</td>
                <td>{l.fromOn ? `${l.fromOn} ~ ${l.untilOn}` : `제안 ${ymdhm(l.proposedAt)}`}</td>
                <td>
                  {l.state === 'PROPOSED' && <><button className="btn-sm" disabled={a.busy === `l${l.id}`} onClick={() => decide(l, 'APPROVE')}>승인</button>{' '}
                    <button className="btn-sm btn-plain" disabled={a.busy === `l${l.id}`} onClick={() => decide(l, 'REJECT')}>반려</button></>}
                  {l.state === 'ACTIVE' && <button className="btn-sm btn-plain" disabled={a.busy === `l${l.id}`} onClick={() => decide(l, 'LIFT')}>풀기</button>}
                </td>
              </tr>))}
            </tbody></table>
        </>
      )}
      {d && (
        <table className="tbl" data-smq-grade-rows={d.items.length}>
          <thead><tr><th>판매자</th><th className="num">주문</th><th className="num">배송 지연</th><th className="num">판매자 사정 취소</th><th className="num">문의 답 늦음</th><th>등급</th><th>판정</th></tr></thead>
          <tbody>{d.items.map((r) => (
            <tr key={r.sellerId} data-smq-grade-row={r.level}>
              <td>{r.sellerName} <span className="muted">{r.sellerCode}{r.sellerStatus === 'PAUSED' ? ' · 정지' : ''}</span></td>
              <td className="num">{nn(r.orders)}</td>
              <td className="num">{nn(r.lateShip)} <span className={r.over.includes('late') ? 'st no' : 'muted'}>{pc(r.latePct)}</span></td>
              <td className="num">{nn(r.sellerCancels)} <span className={r.over.includes('cancel') ? 'st no' : 'muted'}>{pc(r.cancelPct)}</span></td>
              <td className="num">{nn(r.qnaLate)} / {nn(r.qnaTotal)} <span className={r.over.includes('qna') ? 'st no' : 'muted'}>{pc(r.qnaPct)}</span></td>
              <td><b>{r.grade === 'N' ? '표본 부족' : r.grade}</b></td>
              <td>{LV_KO[r.level] ?? r.level}{r.notifiedAt ? <span className="muted"> · 알림 {ymdhm(r.notifiedAt)}</span> : null}</td>
            </tr>))}
            {d.items.length === 0 && <tr><td colSpan={7} className="muted">입점 판매자가 없습니다.</td></tr>}
          </tbody>
        </table>
      )}
    </section>
  );
}
