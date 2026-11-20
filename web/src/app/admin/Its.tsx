/* ===== ㊵ 사무 · 보안 (D270 · docs/628 ~ 631) — web/src/app/admin/Its.tsx 새 파일 =====
 * 대표 11/20 「㊵ 사무 · 보안」.
 *   IntegKeyLife  외부 연동 › 연동 키 아래 구역(SUPER) — 키마다 만료일 · 교체 주기 · 마지막 교체 · 다음 기한 · 「바꿨음」(키 값 · 끝 4자리 없음)
 *   ItsAssets     사무 › IT 자산 · 구독 — 라이선스 수 · 담당 · 갱신일 · 달 비용 → 자금 흐름 예정 · 해지
 *   ItsSuggest    사무 › 제안함        — 제안 쓰기(익명 = 쓴 사람 · 시각 저장 안 함 · 접수 번호 한 번) · 내 제안 · 접수 번호로 보기 · 검토(ADMIN · SUPER)
 *   ItsSurvey     사무 › 사내 설문     — 답할 설문 · 답하기 / 관리(ADMIN · SUPER): 만들기 · 질문 · 열기 · 마감 · 결과(익명은 마감 뒤 · 최소 응답 수) · CSV(내려받기 승인)
 * (adminMenu · App.tsx · IntegrationKeys 연결 줄은 patches/1_wiring.md · 왼쪽 트리 AdminTree 는 고치지 않음 · 색은 토큰만)
 */
import { useState } from 'react';
import { api, tokenRoles } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymd, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';
import { exportTicket } from './OpsSafetyBoxes';

const won = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const kstDay = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);
const isManager = () => tokenRoles().some((r) => r === 'SUPER' || r === 'ADMIN');
const save = (filename: string, csv: string) => {
  const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); el.download = filename; el.click(); URL.revokeObjectURL(el.href);
};
const pill = (bg: string, fg: string) => ({ background: bg, color: fg, padding: '1px 7px', borderRadius: 'var(--r-sm)', fontSize: 12 });

/* ── v10.490 연동 키 만료 · 교체(외부 연동 › 연동 키 아래) ── */
interface LifeRow { code: string; integration: string; name: string; label: string; source: 'ADMIN' | 'ENV' | 'NONE'; keyUpdatedAt: string | null; expiresOn: string | null; rotateDays: number | null;
  rotatedAt: string | null; rotateSource: string | null; ownerNote: string | null; due: string | null; left: number | null; level: 'OVER' | 'SOON' | 'OK' | 'UNSET' }
interface LifeView { today: string; days: number[]; rows: LifeRow[]; counts: { over: number; soon: number; unset: number }; alertOn: boolean; note: string }
const LEVEL_KO: Record<LifeRow['level'], string> = { OVER: '기한 지남', SOON: '곧 기한', OK: '여유', UNSET: '기한 없음' };
const LEVEL_STYLE: Record<LifeRow['level'], ReturnType<typeof pill>> = {
  OVER: pill('var(--danger-w)', 'var(--danger)'), SOON: pill('var(--or-l)', 'var(--ink)'), OK: pill('var(--g50)', 'var(--ink-2)'), UNSET: pill('var(--g50)', 'var(--ink-3)'),
};
const SRC_KO: Record<LifeRow['source'], string> = { ADMIN: '화면에서 넣음', ENV: '.env', NONE: '없음' };

export function IntegKeyLife() {
  const q = useApi<LifeView>('/admin/integration-keys/life');
  const a = useAct();
  const [ed, setEd] = useState<{ id: string; expiresOn: string; rotateDays: string; ownerNote: string } | null>(null);
  const d = q.data;
  if (q.error || !d) return null;
  const id = (r: LifeRow) => `${r.code}/${r.name}`;
  const saveLife = (r: LifeRow) => ed && void a.run(`s${id(r)}`, () => api(`/admin/integration-keys/life/${r.code}/${r.name}`, { method: 'PUT',
    body: JSON.stringify({ expiresOn: ed.expiresOn || null, rotateDays: ed.rotateDays ? Number(ed.rotateDays) : null, ownerNote: ed.ownerNote || null }) }), () => { setEd(null); q.reload(); });
  const rotated = (r: LifeRow) => {
    const exp = prompt(`${r.integration} · ${r.name} — 화면 밖(.env 등)에서 키를 바꿨으면 새 키 만료일(YYYY-MM-DD · 모르면 비움)을 적으십시오.`, '');
    if (exp === null) return;
    void a.run(`r${id(r)}`, () => api(`/admin/integration-keys/life/${r.code}/${r.name}/rotated`, { method: 'POST', body: JSON.stringify({ expiresOn: exp.trim() || null }) }), q.reload);
  };
  return (
    <div data-key-life={d.rows.length} style={{ marginTop: 16 }}>
      <h2 className="ad-s2">키 만료 · 교체 <em>{d.counts.over + d.counts.soon}</em> <small className="dim">v10.490 · 알림 {d.alertOn ? `켜짐(${d.days.join(' · ')}일 전)` : '꺼짐'}</small></h2>
      <Flash msg={a.msg} err={a.err} />
      {d.counts.over > 0 && <div className="ad-nt warn" data-key-life-over={d.counts.over}><b>기한이 지난 키가 {d.counts.over}개 있습니다.</b> 업체 콘솔에서 새 키를 받아 위 「연동 키」에 넣으십시오.</div>}
      <div className="ad-nt info">{d.note}</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead><tr><th>연동 · 키</th><th>어디서</th><th>마지막 교체</th><th>만료일</th><th>주기</th><th>다음 기한</th><th>담당 메모</th><th /></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={id(r)} data-key-life-row={id(r)} data-level={r.level}>
              <td>{r.integration} · {r.label}<br /><small className="mono dim">{r.name}</small></td>
              <td>{SRC_KO[r.source]}</td>
              <td>{r.rotatedAt ? <>{ymd(r.rotatedAt)} <small className="dim">{r.rotateSource === 'MANUAL' ? '바꿨음' : '화면'}</small></> : '—'}</td>
              {ed?.id === id(r) ? (
                <>
                  <td><input type="date" value={ed.expiresOn} onChange={(e) => setEd({ ...ed, expiresOn: e.target.value })} aria-label="만료일" /></td>
                  <td><input type="number" min={7} max={1095} value={ed.rotateDays} onChange={(e) => setEd({ ...ed, rotateDays: e.target.value })} placeholder="일" style={{ width: 72 }} aria-label="교체 주기(일)" /></td>
                  <td>—</td>
                  <td><input value={ed.ownerNote} onChange={(e) => setEd({ ...ed, ownerNote: e.target.value })} placeholder="담당 · 어디서 받는지(키 값 금지)" size={20} aria-label="담당 메모" /></td>
                  <td><button className="btn-sm" disabled={a.busy === `s${id(r)}`} onClick={() => saveLife(r)} data-key-life-save="">저장</button>{' '}
                      <button className="btn-sm btn-plain" onClick={() => setEd(null)}>닫기</button></td>
                </>
              ) : (
                <>
                  <td>{r.expiresOn ?? '—'}</td>
                  <td>{r.rotateDays ? `${r.rotateDays}일` : '—'}</td>
                  <td><span style={LEVEL_STYLE[r.level]}>{LEVEL_KO[r.level]}</span>{r.due && <> {r.due}{r.left != null && <small className="dim"> ({r.left < 0 ? `${-r.left}일 지남` : `${r.left}일 남음`})</small>}</>}</td>
                  <td><small>{r.ownerNote ?? ''}</small></td>
                  <td><button className="btn-sm btn-plain" onClick={() => setEd({ id: id(r), expiresOn: r.expiresOn ?? '', rotateDays: r.rotateDays ? String(r.rotateDays) : '', ownerNote: r.ownerNote ?? '' })} data-key-life-edit={id(r)}>고치기</button>{' '}
                      <button className="btn-sm btn-plain" disabled={a.busy === `r${id(r)}`} onClick={() => rotated(r)}>바꿨음</button></td>
                </>
              )}
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}

/* ── v10.491 IT 자산 · SaaS 구독 ── */
interface Asset { id: string; kind: string; kindKo: string; name: string; vendor: string | null; assetTag: string | null; seats: number; seatsUsed: number; seatsFree: number; ownerId: string | null; owner: string | null;
  billingCycle: string; cycleKo: string; costAmount: number; monthly: number; renewOn: string | null; renewLeft: number | null; autoRenew: boolean; cashPlan: boolean; cashPlanId: string | null;
  memo: string | null; state: string; canceledOn: string | null; cancelReason: string | null }
interface AssetView { state: string; items: Asset[]; kinds: Record<string, string>; cycles: Record<string, string>; staff: Array<{ id: string; name: string }>;
  totals: { monthly: number; yearly: number; seats: number; seatsFree: number; byKind: Record<string, number> }; soon: number; note: string }
const BLANK_ASSET = { id: '', kind: 'SAAS', name: '', vendor: '', assetTag: '', seats: '0', seatsUsed: '0', ownerId: '', billingCycle: 'MONTHLY', costAmount: '0', renewOn: kstDay(30), autoRenew: true, cashPlan: true, memo: '' };

export function ItsAssets() {
  const [st, setSt] = useState('ACTIVE');
  const q = useApi<AssetView>(`/admin/its/assets?state=${st}`, [st]);
  const a = useAct();
  const [f, setF] = useState<typeof BLANK_ASSET | null>(null);
  const d = q.data;
  const body = (x: typeof BLANK_ASSET) => ({ name: x.name, vendor: x.vendor || null, assetTag: x.assetTag || null, seats: Number(x.seats || 0), seatsUsed: Number(x.seatsUsed || 0),
    ownerId: x.ownerId || null, billingCycle: x.billingCycle, costAmount: Number(x.costAmount || 0), renewOn: x.renewOn || null, autoRenew: x.autoRenew, cashPlan: x.cashPlan, memo: x.memo || null });
  const submit = () => f && void a.run('save', () => (f.id
    ? api(`/admin/its/assets/${f.id}`, { method: 'PUT', body: JSON.stringify(body(f)) })
    : api('/admin/its/assets', { method: 'POST', body: JSON.stringify({ kind: f.kind, ...body(f) }) })), () => { setF(null); q.reload(); });
  const cancel = (x: Asset) => {
    const reason = prompt(`「${x.name}」를 해지할까요? 사유(2 ~ 200자) — 이은 자금 흐름 예정도 취소됩니다.`);
    if (!reason || reason.trim().length < 2) return;
    void a.run(`c${x.id}`, () => api(`/admin/its/assets/${x.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }), q.reload);
  };
  const edit = (x: Asset) => setF({ id: x.id, kind: x.kind, name: x.name, vendor: x.vendor ?? '', assetTag: x.assetTag ?? '', seats: String(x.seats), seatsUsed: String(x.seatsUsed), ownerId: x.ownerId ?? '',
    billingCycle: x.billingCycle, costAmount: String(x.costAmount), renewOn: x.renewOn ?? '', autoRenew: x.autoRenew, cashPlan: x.cashPlan, memo: x.memo ?? '' });
  return (
    <section data-its-assets={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <div className="acts">
        {['ACTIVE', 'CANCELED', 'ALL'].map((s) => <button key={s} className={`btn-sm${st === s ? '' : ' btn-plain'}`} onClick={() => setSt(s)}>{s === 'ACTIVE' ? '쓰는 중' : s === 'CANCELED' ? '해지' : '모두'}</button>)}{' '}
        <button className="btn-sm" onClick={() => setF({ ...BLANK_ASSET })} data-its-asset-add="">자산 넣기</button>
      </div>
      {d && (
        <>
          <p data-its-asset-totals={d.totals.monthly}><b>달 비용 {won(d.totals.monthly)}원</b> <small className="dim">(1년 약 {won(d.totals.yearly)}원 · 라이선스 {won(d.totals.seats)}개 중 남는 {won(d.totals.seatsFree)}개 · 30일 안 갱신 {d.soon}건)</small></p>
          {f && (
            <div className="card pad" data-its-asset-form={f.id || 'new'}>
              {!f.id && <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="종류">{Object.entries(d.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}{' '}
              <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="이름(예: Google Workspace)" size={22} aria-label="이름" />{' '}
              <input value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} placeholder="공급사" size={12} aria-label="공급사" />{' '}
              <input value={f.assetTag} onChange={(e) => setF({ ...f, assetTag: e.target.value })} placeholder="자산 번호" size={10} aria-label="자산 번호" /><br />
              <label>라이선스 <input type="number" min={0} value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} style={{ width: 72 }} /></label>{' '}
              <label>쓰는 수 <input type="number" min={0} value={f.seatsUsed} onChange={(e) => setF({ ...f, seatsUsed: e.target.value })} style={{ width: 72 }} /></label>{' '}
              <select value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })} aria-label="담당"><option value="">담당 없음</option>{d.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select><br />
              <select value={f.billingCycle} onChange={(e) => setF({ ...f, billingCycle: e.target.value, costAmount: e.target.value === 'FREE' ? '0' : f.costAmount })} aria-label="결제 주기">{Object.entries(d.cycles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
              <label>한 번 금액(원 · 부가세 포함) <input type="number" min={0} value={f.costAmount} disabled={f.billingCycle === 'FREE'} onChange={(e) => setF({ ...f, costAmount: e.target.value })} style={{ width: 120 }} /></label>{' '}
              <label>다음 갱신일 <input type="date" value={f.renewOn} onChange={(e) => setF({ ...f, renewOn: e.target.value })} /></label>{' '}
              <label><input type="checkbox" checked={f.autoRenew} onChange={(e) => setF({ ...f, autoRenew: e.target.checked })} /> 자동 갱신</label>{' '}
              <label><input type="checkbox" checked={f.cashPlan} onChange={(e) => setF({ ...f, cashPlan: e.target.checked })} data-its-asset-cashplan="" /> 자금 계획에 넣기</label><br />
              <input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="메모" size={40} aria-label="메모" />{' '}
              <button className="btn-sm" disabled={f.name.trim().length < 2 || a.busy === 'save'} onClick={submit} data-its-asset-save="">저장</button>{' '}
              <button className="btn-sm btn-plain" onClick={() => setF(null)}>닫기</button>
            </div>
          )}
          {!d.items.length ? <p className="muted">자산이 없습니다.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr><th>종류</th><th>이름</th><th>라이선스</th><th>담당</th><th>결제</th><th>달 비용</th><th>갱신일</th><th>자금 계획</th><th /></tr></thead>
                <tbody>{d.items.map((x) => (
                  <tr key={x.id} data-its-asset-row={x.id} data-state={x.state}>
                    <td>{x.kindKo}</td>
                    <td>{x.name}{x.vendor && <small className="dim"> · {x.vendor}</small>}{x.assetTag && <><br /><small className="mono dim">{x.assetTag}</small></>}</td>
                    <td>{x.seats ? `${x.seatsUsed} / ${x.seats}` : '—'}</td>
                    <td>{x.owner ?? '—'}</td>
                    <td>{x.cycleKo} {x.costAmount ? `${won(x.costAmount)}원` : ''}</td>
                    <td>{x.monthly ? `${won(x.monthly)}원` : '—'}</td>
                    <td>{x.state === 'CANCELED' ? <small className="dim">해지 {x.canceledOn} · {x.cancelReason}</small>
                      : <>{x.renewOn ?? '—'}{x.renewLeft != null && <small className="dim" style={x.renewLeft <= 7 ? { color: 'var(--danger)' } : undefined}> ({x.renewLeft < 0 ? `${-x.renewLeft}일 지남` : `${x.renewLeft}일`}{x.autoRenew ? ' · 자동' : ''})</small>}</>}</td>
                    <td>{x.cashPlanId ? <small>예정 #{x.cashPlanId}</small> : <small className="dim">{x.cashPlan ? '없음' : '넣지 않음'}</small>}</td>
                    <td>{x.state === 'ACTIVE' && <><button className="btn-sm btn-plain" onClick={() => edit(x)}>고치기</button>{' '}
                      <button className="btn-sm btn-plain" disabled={a.busy === `c${x.id}`} onClick={() => cancel(x)}>해지</button></>}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
          <p className="muted">{d.note}</p>
        </>
      )}
    </section>
  );
}

/* ── v10.492 사내 제안 · 건의함 ── */
interface Sug { id: string; category: string; categoryKo: string; title: string; body?: string; isAnon: boolean; createdOn: string; state: string; stateKo: string; answer?: string | null; answeredAt?: string | null; author?: string | null }
interface SugReview { state: string; items: Sug[]; counts: Record<string, number>; states: Record<string, string>; categories: Record<string, string>; note: string }
interface SugDetail extends Sug { answeredBy: string | null; log: Array<{ id: string; from: string; to: string; note: string | null; at: string; actor: string | null }>; next: Array<{ state: string; label: string; needAnswer: boolean }> }
const SUG_CATS: Record<string, string> = { WORK: '업무 방식', SYSTEM: '시스템 · 도구', WELFARE: '복지 · 환경', SAFETY: '안전 · 보안', OTHER: '그 밖' };
const BLANK_SUG = { category: 'WORK', title: '', body: '', anonymous: true };

export function ItsSuggest() {
  const mine = useApi<{ items: Sug[]; note: string }>('/admin/its/suggestions/mine');
  const a = useAct();
  const [f, setF] = useState({ ...BLANK_SUG });
  const [receipt, setReceipt] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [found, setFound] = useState<Sug | null>(null);
  const send = () => void a.run('send', async () => {
    const r = await api<{ ok: boolean; anonymous: boolean; receiptCode?: string; note: string }>('/admin/its/suggestions', { method: 'POST', body: JSON.stringify(f) });
    setReceipt(r.receiptCode ?? null); setF({ ...BLANK_SUG });
    return r;
  }, mine.reload);
  const look = () => void a.run('look', async () => { const r = await api<Sug>('/admin/its/suggestions/lookup', { method: 'POST', body: JSON.stringify({ code: code.trim() }) }); setFound(r); return { note: `「${r.title}」 — ${r.stateKo}` }; });
  return (
    <section data-its-suggest="">
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad" data-its-sug-form="">
        <b>제안 쓰기</b>{' '}
        <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="분류">{Object.entries(SUG_CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="제목(2 ~ 100자)" size={30} aria-label="제목" /><br />
        <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="내용(10 ~ 3000자)" rows={4} style={{ width: '100%' }} aria-label="내용" /><br />
        <label data-its-sug-anon=""><input type="checkbox" checked={f.anonymous} onChange={(e) => setF({ ...f, anonymous: e.target.checked })} /> 익명으로 — 쓴 사람 · 시각을 <b>저장하지 않습니다</b>(날짜만 · 검토하는 사람도 알 수 없음)</label>{' '}
        <button className="btn-sm" disabled={f.title.trim().length < 2 || f.body.trim().length < 10 || a.busy === 'send'} onClick={send} data-its-sug-send="">내기</button>
        {receipt && <p className="ad-nt warn" data-its-sug-receipt={receipt}>접수 번호 <b className="mono">{receipt}</b> — 지금 한 번만 보입니다. 적어 두면 아래 「접수 번호로 보기」에서 진행 · 답변을 봅니다.</p>}
      </div>
      <div className="card pad">
        <b>접수 번호로 보기</b> <small className="dim">익명 제안</small>{' '}
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH-JKLM" size={16} className="mono" aria-label="접수 번호" />{' '}
        <button className="btn-sm btn-plain" disabled={code.trim().length < 12 || a.busy === 'look'} onClick={look} data-its-sug-look="">보기</button>
        {found && <p data-its-sug-found={found.state}><b>{found.title}</b> <small className="dim">{found.categoryKo} · {found.createdOn}</small> · {found.stateKo}{found.answer && <><br />답변: {found.answer}</>}</p>}
      </div>
      <div className="card pad" data-its-sug-mine={mine.data?.items.length ?? ''}>
        <b>내 제안</b> <small className="dim">{mine.data?.note}</small>
        {mine.data && (!mine.data.items.length ? <p className="muted">이름을 밝힌 제안이 없습니다.</p> : (
          <table className="tbl"><tbody>{mine.data.items.map((s) => (
            <tr key={s.id}><td>{s.createdOn}</td><td>{s.categoryKo}</td><td>{s.title}</td><td>{s.stateKo}</td><td><small>{s.answer ?? ''}</small></td></tr>))}</tbody></table>))}
      </div>
      {isManager() && <ItsSuggestReview />}
    </section>
  );
}

function ItsSuggestReview() {
  const [st, setSt] = useState('OPEN');
  const q = useApi<SugReview>(`/admin/its/suggestions?state=${st}`, [st]);
  const a = useAct();
  const [sel, setSel] = useState<SugDetail | null>(null);
  const [ans, setAns] = useState('');
  const open = (id: string) => void a.run(`o${id}`, async () => { const r = await api<SugDetail>(`/admin/its/suggestions/${id}`); setSel(r); setAns(r.answer ?? ''); return { note: '' }; }, undefined, () => '');
  const decide = (to: string) => sel && void a.run('dec', () => api(`/admin/its/suggestions/${sel.id}/decide`, { method: 'POST', body: JSON.stringify({ to, answer: ans.trim() || null }) }),
    () => { q.reload(); open(sel.id); });
  const d = q.data;
  return (
    <div className="card pad" data-its-sug-review={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <b>검토</b>{' '}
      {d && ['OPEN', 'ALL', ...Object.keys(d.states)].map((s) => (
        <button key={s} className={`btn-sm${st === s ? '' : ' btn-plain'}`} onClick={() => setSt(s)}>{s === 'OPEN' ? '열린 것' : s === 'ALL' ? '모두' : `${d.states[s]} ${d.counts[s] ?? 0}`}</button>))}
      {d && <p className="muted">{d.note}</p>}
      {d && (!d.items.length ? <p className="muted">제안이 없습니다.</p> : (
        <table className="tbl"><tbody>{d.items.map((s) => (
          <tr key={s.id} data-its-sug-row={s.state}><td>{s.createdOn}</td><td>{s.categoryKo}</td><td><button className="btn-sm btn-plain" onClick={() => open(s.id)}>{s.title}</button></td>
            <td>{s.isAnon ? <small className="dim">익명</small> : s.author}</td><td>{s.stateKo}</td></tr>))}</tbody></table>))}
      {sel && (
        <div className="card pad" data-its-sug-detail={sel.state}>
          <b>{sel.title}</b> <small className="dim">{sel.categoryKo} · {sel.createdOn} · {sel.isAnon ? '익명(쓴 사람 저장 안 됨)' : sel.author} · {sel.stateKo}</small>
          <p style={{ whiteSpace: 'pre-wrap' }}>{sel.body}</p>
          {sel.next.length > 0 && (
            <>
              <textarea value={ans} onChange={(e) => setAns(e.target.value)} placeholder="답변(채택 · 반영 안 함 · 실행 끝은 꼭)" rows={3} style={{ width: '100%' }} aria-label="답변" /><br />
              {sel.next.map((n) => <button key={n.state} className="btn-sm" disabled={a.busy === 'dec' || (n.needAnswer && ans.trim().length < 2)} onClick={() => decide(n.state)} data-its-sug-to={n.state}>{n.label}</button>)}{' '}
            </>
          )}
          <button className="btn-sm btn-plain" onClick={() => setSel(null)}>닫기</button>
          {sel.log.length > 0 && <ul>{sel.log.map((l) => <li key={l.id}><small className="dim">{ymdhm(l.at)} · {l.actor}</small> {d?.states[l.from] ?? l.from} → {d?.states[l.to] ?? l.to}{l.note ? ` · ${l.note}` : ''}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}

/* ── v10.493 사내 설문 ── */
interface Question { id?: string; ord?: number; type: string; typeKo?: string; body: string; options: string[]; scaleMax: number | null; required: boolean }
interface MySurvey { id: string; title: string; anonymous: boolean; closesOn: string; questions: number; taken: boolean }
interface SurveyForm { id: string; title: string; intro: string | null; anonymous: boolean; closesOn: string; taken: boolean; questions: Question[] }
interface SurveyRow { id: string; title: string; anonymous: boolean; audience: string[]; opensOn: string; closesOn: string; state: string; stateKo: string; creator: string | null; questions: number; takers: number; eligible: number | null }
interface Results { id: string; title: string; anonymous: boolean; state: string; stateKo: string; responses: number | null; takers: number | null; eligible: number; minCount: number; hidden: string | null; hiddenNote: string | null;
  questions: Array<Question & { answered: number; counts?: number[]; dist?: number[]; avg?: number | null; texts?: string[] }>; respondents: string[] | null }
const QTYPE_KO: Record<string, string> = { SINGLE: '하나 고르기', MULTI: '여럿 고르기', SCALE: '점수', TEXT: '글' };
const ROLE_KO: Record<string, string> = { SUPER: '최고 관리자', ADMIN: '운영 관리자', PAYOUT: '지급 담당', REVIEWER: '검수 담당', PARTNER_MAL: '안심 파트너 담당', PARTNER_AFF: '제휴 파트너 담당' };
const blankQ = (): Question => ({ type: 'SINGLE', body: '', options: ['', ''], scaleMax: null, required: true });
const BLANK_SV = { id: '', title: '', intro: '', anonymous: true, audience: [] as string[], opensOn: kstDay(), closesOn: kstDay(14), questions: [blankQ()] };

function Bar({ n, of }: { n: number; of: number }) {
  const w = of ? Math.round((n / of) * 100) : 0;
  return <span style={{ display: 'inline-block', width: 120, height: 8, background: 'var(--g50)', borderRadius: 'var(--r-sm)', verticalAlign: 'middle' }}><span style={{ display: 'block', width: `${w}%`, height: 8, background: 'var(--pp)', borderRadius: 'var(--r-sm)' }} /></span>;
}

export function ItsSurvey() {
  const my = useApi<{ items: MySurvey[]; note: string }>('/admin/its/my-surveys');
  const a = useAct();
  const [form, setForm] = useState<SurveyForm | null>(null);
  const [ans, setAns] = useState<Record<string, unknown>>({});
  const openForm = (id: string) => void a.run(`f${id}`, async () => { const r = await api<SurveyForm>(`/admin/its/my-surveys/${id}`); setForm(r); setAns({}); return { note: '' }; }, undefined, () => '');
  const send = () => form && void a.run('ans', () => api(`/admin/its/my-surveys/${form.id}/answer`, { method: 'POST', body: JSON.stringify({ answers: ans }) }), () => { setForm(null); my.reload(); });
  const setA = (qid: string, v: unknown) => setAns((m) => ({ ...m, [qid]: v }));
  return (
    <section data-its-survey="">
      <Flash msg={a.msg} err={a.err} />
      <div className="card pad" data-its-my-survey={my.data?.items.length ?? ''}>
        <b>답할 설문</b> <small className="dim">{my.data?.note}</small>
        {my.data && (!my.data.items.length ? <p className="muted">지금 답할 설문이 없습니다.</p> : (
          <table className="tbl"><tbody>{my.data.items.map((s) => (
            <tr key={s.id}><td>{s.title}</td><td>{s.anonymous ? '익명' : '이름 밝힘'}</td><td>~ {s.closesOn}</td><td>질문 {s.questions}</td>
              <td>{s.taken ? <small className="dim">냈음</small> : <button className="btn-sm" onClick={() => openForm(s.id)} data-its-survey-take={s.id}>답하기</button>}</td></tr>))}</tbody></table>))}
      </div>
      {form && (
        <div className="card pad" data-its-survey-form={form.id}>
          <b>{form.title}</b> <small className="dim">{form.anonymous ? '익명 — 답에 이름이 남지 않습니다' : '이름을 밝히는 설문'} · ~ {form.closesOn}</small>
          {form.intro && <p>{form.intro}</p>}
          <ol>{form.questions.map((q) => (
            <li key={q.id} data-its-q={q.type} style={{ marginBottom: 8 }}>
              {q.body}{q.required && <small style={{ color: 'var(--danger)' }}> *</small>}<br />
              {q.type === 'SINGLE' && q.options.map((o, i) => <label key={i} style={{ marginRight: 12 }}><input type="radio" name={`q${q.id}`} checked={ans[q.id!] === i} onChange={() => setA(q.id!, i)} /> {o}</label>)}
              {q.type === 'MULTI' && q.options.map((o, i) => {
                const cur = (ans[q.id!] as number[] | undefined) ?? [];
                return <label key={i} style={{ marginRight: 12 }}><input type="checkbox" checked={cur.includes(i)} onChange={(e) => setA(q.id!, e.target.checked ? [...cur, i] : cur.filter((x) => x !== i))} /> {o}</label>;
              })}
              {q.type === 'SCALE' && Array.from({ length: q.scaleMax ?? 5 }, (_, i) => i + 1).map((n) => <label key={n} style={{ marginRight: 8 }}><input type="radio" name={`q${q.id}`} checked={ans[q.id!] === n} onChange={() => setA(q.id!, n)} /> {n}</label>)}
              {q.type === 'TEXT' && <textarea rows={2} style={{ width: '100%' }} value={String(ans[q.id!] ?? '')} onChange={(e) => setA(q.id!, e.target.value)} aria-label={q.body} />}
            </li>))}</ol>
          <button className="btn-sm" disabled={a.busy === 'ans'} onClick={send} data-its-survey-send="">내기</button>{' '}
          <button className="btn-sm btn-plain" onClick={() => setForm(null)}>닫기</button>
        </div>
      )}
      {isManager() && <ItsSurveyAdmin />}
    </section>
  );
}

function ItsSurveyAdmin() {
  const q = useApi<{ items: SurveyRow[]; roles: string[]; minCount: number; note: string }>('/admin/its/surveys');
  const a = useAct();
  const [ed, setEd] = useState<typeof BLANK_SV | null>(null);
  const [res, setRes] = useState<Results | null>(null);
  const d = q.data;
  const payload = (x: typeof BLANK_SV) => ({ title: x.title, intro: x.intro || null, anonymous: x.anonymous, audience: x.audience, opensOn: x.opensOn, closesOn: x.closesOn,
    questions: x.questions.map((qq) => ({ type: qq.type, body: qq.body, options: qq.type === 'SINGLE' || qq.type === 'MULTI' ? qq.options.filter((o) => o.trim()) : [], scaleMax: qq.type === 'SCALE' ? qq.scaleMax ?? 5 : null, required: qq.required })) });
  const saveSv = () => ed && void a.run('sv', () => (ed.id ? api(`/admin/its/surveys/${ed.id}`, { method: 'PUT', body: JSON.stringify(payload(ed)) })
    : api('/admin/its/surveys', { method: 'POST', body: JSON.stringify(payload(ed)) })), () => { setEd(null); q.reload(); });
  const edit = (s: SurveyRow) => void a.run(`e${s.id}`, async () => {
    const r = await api<{ id: string; title: string; intro: string | null; anonymous: boolean; audience: string[]; opensOn: string; closesOn: string; questions: Question[] }>(`/admin/its/surveys/${s.id}`);
    setEd({ id: r.id, title: r.title, intro: r.intro ?? '', anonymous: r.anonymous, audience: r.audience, opensOn: r.opensOn, closesOn: r.closesOn,
            questions: r.questions.map((x) => ({ type: x.type, body: x.body, options: x.options.length ? x.options : ['', ''], scaleMax: x.scaleMax, required: x.required })) });
    return { note: '' };
  }, undefined, () => '');
  const move = (s: SurveyRow, to: 'open' | 'close' | 'cancel') => {
    let body: string | undefined;
    if (to === 'cancel') { const r = prompt(`「${s.title}」 설문을 취소할까요? 사유(2 ~ 200자)`); if (!r || r.trim().length < 2) return; body = JSON.stringify({ reason: r }); }
    else if (!confirm(to === 'open' ? `「${s.title}」을 열까요? 연 뒤에는 질문을 바꿀 수 없습니다.` : `「${s.title}」을 지금 마감할까요?`)) return;
    void a.run(`${to}${s.id}`, () => api(`/admin/its/surveys/${s.id}/${to}`, { method: 'POST', body }), q.reload);
  };
  const results = (s: SurveyRow) => void a.run(`res${s.id}`, async () => { const r = await api<Results>(`/admin/its/surveys/${s.id}/results`); setRes(r); return { note: '' }; }, undefined, () => '');
  const csv = (s: SurveyRow) => void a.run(`csv${s.id}`, async () => {
    const t = await exportTicket(('ITS_SURVEY' as string) as Parameters<typeof exportTicket>[0])   // v10.493 — OpsSafetyBoxes 의 대상 글자 목록은 고치지 않음(서버 EXPORT_TARGETS 에 ITS_SURVEY);
    if (!t) throw new Error('내려받기 승인 전입니다 — 위험감지 › 감사 › 「내려받기 승인」에서 확인하십시오.');
    const r = await api<{ csv: string; filename: string; note: string }>(`/admin/its/surveys/${s.id}/export?ticket=${t}`);
    save(r.filename, r.csv); return r;
  }, undefined, (r) => r?.note ?? '');
  const setQ = (i: number, patch: Partial<Question>) => ed && setEd({ ...ed, questions: ed.questions.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  return (
    <div className="card pad" data-its-survey-admin={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      <b>설문 관리</b>{' '}<button className="btn-sm" onClick={() => setEd({ ...BLANK_SV, questions: [blankQ()] })} data-its-survey-new="">설문 만들기</button>
      {d && <p className="muted">{d.note}</p>}
      {ed && (
        <div className="card pad" data-its-survey-edit={ed.id || 'new'}>
          <input value={ed.title} onChange={(e) => setEd({ ...ed, title: e.target.value })} placeholder="설문 제목" size={30} aria-label="설문 제목" />{' '}
          <label><input type="checkbox" checked={ed.anonymous} onChange={(e) => setEd({ ...ed, anonymous: e.target.checked })} /> 익명</label>{' '}
          <input type="date" value={ed.opensOn} onChange={(e) => setEd({ ...ed, opensOn: e.target.value })} aria-label="시작일" /> ~{' '}
          <input type="date" value={ed.closesOn} onChange={(e) => setEd({ ...ed, closesOn: e.target.value })} aria-label="마감일" /><br />
          <textarea value={ed.intro} onChange={(e) => setEd({ ...ed, intro: e.target.value })} placeholder="안내 글(선택)" rows={2} style={{ width: '100%' }} aria-label="안내 글" /><br />
          <small className="dim">대상(비우면 운영 계정 모두):</small>{' '}
          {(d?.roles ?? []).map((r) => <label key={r} style={{ marginRight: 8 }}><input type="checkbox" checked={ed.audience.includes(r)} onChange={(e) => setEd({ ...ed, audience: e.target.checked ? [...ed.audience, r] : ed.audience.filter((x) => x !== r) })} /> {ROLE_KO[r] ?? r}</label>)}
          <ol>{ed.questions.map((qq, i) => (
            <li key={i} data-its-survey-q={i}>
              <select value={qq.type} onChange={(e) => setQ(i, { type: e.target.value, scaleMax: e.target.value === 'SCALE' ? 5 : null })} aria-label="질문 유형">{Object.entries(QTYPE_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
              <input value={qq.body} onChange={(e) => setQ(i, { body: e.target.value })} placeholder="질문" size={36} aria-label="질문" />{' '}
              <label><input type="checkbox" checked={qq.required} onChange={(e) => setQ(i, { required: e.target.checked })} /> 꼭</label>{' '}
              <button className="btn-sm btn-plain" disabled={ed.questions.length <= 1} onClick={() => setEd({ ...ed, questions: ed.questions.filter((_, k) => k !== i) })}>빼기</button>
              {(qq.type === 'SINGLE' || qq.type === 'MULTI') && (
                <div>{qq.options.map((o, k) => <input key={k} value={o} onChange={(e) => setQ(i, { options: qq.options.map((x, j) => (j === k ? e.target.value : x)) })} placeholder={`보기 ${k + 1}`} size={12} aria-label={`보기 ${k + 1}`} />)}{' '}
                  <button className="btn-sm btn-plain" disabled={qq.options.length >= 12} onClick={() => setQ(i, { options: [...qq.options, ''] })}>보기 더하기</button></div>)}
              {qq.type === 'SCALE' && <label> 1 ~ <input type="number" min={3} max={10} value={qq.scaleMax ?? 5} onChange={(e) => setQ(i, { scaleMax: Number(e.target.value) })} style={{ width: 56 }} /> 점</label>}
            </li>))}</ol>
          <button className="btn-sm btn-plain" disabled={ed.questions.length >= 30} onClick={() => setEd({ ...ed, questions: [...ed.questions, blankQ()] })} data-its-survey-addq="">질문 더하기</button>{' '}
          <button className="btn-sm" disabled={ed.title.trim().length < 2 || a.busy === 'sv'} onClick={saveSv} data-its-survey-save="">저장</button>{' '}
          <button className="btn-sm btn-plain" onClick={() => setEd(null)}>닫기</button>
        </div>
      )}
      {d && (!d.items.length ? <p className="muted">설문이 없습니다.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>설문</th><th>상태</th><th>기간</th><th>낸 사람</th><th /></tr></thead>
            <tbody>{d.items.map((s) => (
              <tr key={s.id} data-its-survey-row={s.state}>
                <td>{s.title} <small className="dim">{s.anonymous ? '익명' : '이름 밝힘'} · 질문 {s.questions}{s.audience.length ? ` · ${s.audience.map((r) => ROLE_KO[r] ?? r).join(', ')}` : ''}</small></td>
                <td>{s.stateKo}</td><td>{s.opensOn} ~ {s.closesOn}</td>
                <td>{s.takers}{s.eligible != null ? ` / ${s.eligible}` : ''}</td>
                <td>
                  {s.state === 'DRAFT' && <><button className="btn-sm btn-plain" onClick={() => edit(s)}>고치기</button>{' '}<button className="btn-sm" onClick={() => move(s, 'open')} data-its-survey-open={s.id}>열기</button>{' '}</>}
                  {s.state === 'OPEN' && <button className="btn-sm btn-plain" onClick={() => move(s, 'close')}>마감</button>}{' '}
                  {(s.state === 'DRAFT' || s.state === 'OPEN') && <button className="btn-sm btn-plain" onClick={() => move(s, 'cancel')}>취소</button>}{' '}
                  {s.state !== 'DRAFT' && <button className="btn-sm btn-plain" onClick={() => results(s)} data-its-survey-res={s.id}>결과</button>}{' '}
                  {s.state === 'CLOSED' && <button className="btn-sm btn-plain" disabled={a.busy === `csv${s.id}`} onClick={() => csv(s)}>CSV</button>}
                </td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}
      {res && (
        <div className="card pad" data-its-survey-results={res.hidden ?? 'shown'}>
          <b>{res.title}</b> <small className="dim">{res.stateKo} · {res.anonymous ? '익명' : '이름 밝힘'} · 응답 {res.responses ?? '—'} / 대상 {res.eligible}</small>{' '}
          <button className="btn-sm btn-plain" onClick={() => setRes(null)}>닫기</button>
          {res.hidden ? <p className="ad-nt info" data-its-survey-hidden={res.hidden}>{res.hiddenNote}</p> : (
            <ol>{res.questions.map((x) => (
              <li key={x.id} style={{ marginBottom: 8 }}>{x.body} <small className="dim">{x.typeKo} · 답 {x.answered}</small>
                {x.counts && <table className="tbl"><tbody>{x.options.map((o, i) => <tr key={i}><td>{o}</td><td><Bar n={x.counts![i] ?? 0} of={res.responses ?? 0} /></td><td>{x.counts![i]}</td></tr>)}</tbody></table>}
                {x.dist && <p>평균 <b>{x.avg ?? '—'}</b> / {x.scaleMax} · {x.dist.map((c, i) => `${i + 1}점 ${c}`).join(' · ')}</p>}
                {x.texts && (x.texts.length ? <ul>{x.texts.map((t, i) => <li key={i}><small>{t}</small></li>)}</ul> : <p className="muted">글 답이 없습니다.</p>)}
              </li>))}</ol>)}
          {res.respondents && <p><small className="dim">낸 사람(이름 밝힘): {res.respondents.join(', ')}</small></p>}
        </div>
      )}
    </div>
  );
}
