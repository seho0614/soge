/* ===== v10.513 ~ 516 (D276 · docs/651 ~ 654) ㊻ 매물 — web/src/app/admin/ListingOps.tsx 새 파일 =====
 *   LsxExpiry   검수 › 매물 만료 · 연장(SB-ADM-LSX-010) — 임박 · 지남 · 만료로 내림 · 연장 요청 승인 · 반려 · 만료일 바꾸기 · 한꺼번에 유예(SUPER)
 *   LsxBump     검수 › 끌어올리기(SB-ADM-LSX-020) — 방식(OFF · FREE · PAID) · 무료 횟수 · 간격 · 금액 · 효과 시간 · 운영 바로잡기(SUPER · 사유 종류 둘) · 결제 · 환불(SUPER)
 *   LsxSummary  검수 › 매물 AI 요약(SB-ADM-LSX-030) — 초안 읽고 고쳐 승인 · 반려 · 다시 만들기 · 스위치
 *   LsxSaved    검수 › 저장한 검색(SB-ADM-LSX-040) — 모은 숫자 · 스위치 · 개수
 *   LsxExpiryPick 검수 상세(ReviewDecide)의 「만료 기간」 고르기 — 1 · 3 · 6 · 12개월 · 직접 날짜 · 기본 6(대표 결정 11/20)
 * (adminMenu · App.tsx · ReviewDecide 연결 줄은 patches/1_wiring.md) · CSS 는 기존 클래스만(tbl · card pad · btn-sm · btn-plain · muted · warn-text · num) — 새 색 없음
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymd, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

const num = (v: number | string | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));
const post = (path: string, body: unknown, method = 'POST') => api(path, { method, body: JSON.stringify(body) });
const MONTHS = [1, 3, 6, 12];

interface Settings {
  savedSearch: boolean; savedSearchMax: number; expiry: boolean; expiryDefaultMonths: number; expiryWarnDays: number;
  bumpMode: 'OFF' | 'FREE' | 'PAID'; bumpFreeCount: number; bumpPeriodDays: number; bumpMinHours: number; bumpPrice: number; bumpEffectHours: number;
  aiSummary: boolean; aiSummaryModel: string; aiSummaryBatch: number;
}
interface Overview {
  settings: Settings;
  saved: { searches: number; accounts: number; notify: number; digests7: number; byGwan: { gwan: string; n: number }[]; words: { keyword: string; n: number }[] };
  expiry: { soon: number; past: number; expired30: number; requests: number; backfill: number } | null;
  bump: { live: number; d7: number } | null;
  summary: { draft: number; approved: number; failed: number } | null;
  choices: { defaultMonths: number; months: number[]; maxMonths: number; on: boolean; warnDays: number };
}

/** 설정 바꾸기(SUPER) — 바꾼 칸만 보냄 · 사유 */
function SettingsBox({ fields, s, onDone }: { fields: Array<[keyof Settings, string, 'bool' | 'int' | 'mode' | 'text']>; s: Settings; onDone: () => void }) {
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
    void a.run('set', () => post('/admin/lsx/settings', body, 'PUT'), onDone);
  };
  return (
    <div className="card pad" data-lsx-settings="">
      <Flash msg={a.msg} err={a.err} />
      <b>설정(SUPER)</b>{' '}
      {fields.map(([k, label, t]) => (
        <label key={k} style={{ marginRight: 12 }}>
          {label}{' '}
          {t === 'bool' ? (
            <select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-lsx-set={k}><option value="false">끔</option><option value="true">켬</option></select>
          ) : t === 'mode' ? (
            <select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-lsx-set={k}><option value="OFF">끔(OFF)</option><option value="FREE">무료(FREE)</option><option value="PAID">유료(PAID)</option></select>
          ) : (
            <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} size={t === 'text' ? 18 : 6} data-lsx-set={k} />
          )}
        </label>
      ))}
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(2자 이상 · 전체 설정 기록에 남음)" size={28} />{' '}
      <button className="btn-sm" disabled={a.busy === 'set' || reason.trim().length < 2} onClick={save} data-lsx-settings-save="">저장</button>
    </div>
  );
}

/* ═════════════ 검수 상세의 만료 기간 고르기 ═════════════ */
export interface LsxExpiryValue { expiryMonths?: number; expiresOn?: string }
export function LsxExpiryPick({ value, onChange }: { value: LsxExpiryValue; onChange: (v: LsxExpiryValue) => void }) {
  const [def, setDef] = useState<number>(6);
  const [mode, setMode] = useState<string>('');
  useEffect(() => {
    api<Overview>('/admin/lsx/overview').then((o) => { setDef(o.choices.defaultMonths); }).catch(() => undefined);
  }, []);
  const cur = mode || String(value.expiryMonths ?? (value.expiresOn ? 'DATE' : def));
  return (
    <label style={{ display: 'grid', gap: 4, marginTop: 12 }} data-lsx-expiry-pick={cur}>
      <span className="dim">노출 만료 (승인 때 · 기본 {def}개월)</span>
      <span>
        <select value={cur} onChange={(e) => {
          const v = e.target.value; setMode(v);
          onChange(v === 'DATE' ? { expiresOn: value.expiresOn } : { expiryMonths: Number(v) });
        }} aria-label="만료 기간">
          {MONTHS.map((m) => <option key={m} value={String(m)}>{m}개월{m === def ? ' (기본)' : ''}</option>)}
          <option value="DATE">직접 날짜</option>
        </select>{' '}
        {cur === 'DATE' && <input type="date" value={value.expiresOn ?? ''} onChange={(e) => onChange({ expiresOn: e.target.value || undefined })} aria-label="만료일" data-lsx-expiry-date="" />}
      </span>
    </label>
  );
}

/* ═════════════ 매물 만료 · 연장 ═════════════ */
interface ExpRow { listingId: string; title: string; listingNo: number; status: string; expiresAt: string | null; setKind?: string; expiredAt?: string | null; openRequest?: string | null;
  id?: string; months?: number; note?: string | null; createdAt?: string }
interface ExpView { view: string; settings: { on: boolean; warnDays: number; defaultMonths: number }; rows: ExpRow[] }
const KIND_KO: Record<string, string> = { DEFAULT: '기본', REVIEW: '검수 승인', ADMIN: '운영 변경', EXTEND: '연장 승인', BACKFILL: '처음 적용', GRACE: '유예' };

function SetExpiry({ row, onDone }: { row: ExpRow; onDone: () => void }) {
  const a = useAct();
  const [m, setM] = useState('3');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const restore = (row.status === 'ARCHIVED' || row.status === 'IN_REVIEW') && !!row.expiredAt;   // 대표 결정 11/20 — 내용이 바뀌었으면 서버가 검수 대기로
  const go = () => void a.run('x', () => post(`/admin/lsx/expiry/${row.listingId}`, { ...(m === 'DATE' ? { expiresOn: date } : { months: Number(m) }), reason, ...(restore ? { restore: true } : {}) }, 'PUT'), onDone,
    (r) => { const x = r as { restored?: boolean; queued?: boolean } | undefined; return x?.restored ? '만료일을 바꾸고 다시 게시했습니다.' : x?.queued ? '만료일을 바꿨습니다 — 내용이 바뀌어 검수 대기로 보냈습니다.' : '만료일을 바꿨습니다.'; });
  return (
    <span data-lsx-setexp={row.listingId}>
      <Flash msg={a.msg} err={a.err} />
      <select value={m} onChange={(e) => setM(e.target.value)} aria-label="기간">{MONTHS.map((x) => <option key={x} value={String(x)}>+{x}개월</option>)}<option value="DATE">직접 날짜</option></select>{' '}
      {m === 'DATE' && <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />}{' '}
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유" size={14} />{' '}
      <button className="btn-sm" disabled={a.busy === 'x' || reason.trim().length < 2} onClick={go}>{restore ? '연장 · 다시 게시' : '바꾸기'}</button>
    </span>
  );
}

function DecideExtend({ row, onDone }: { row: ExpRow; onDone: () => void }) {
  const a = useAct();
  const [reason, setReason] = useState('');
  const d = (approve: boolean) => void a.run(approve ? 'ok' : 'no', () => post(`/admin/lsx/extend-requests/${row.id}/decide`, { approve, reason }), onDone);
  return (
    <span data-lsx-extend={row.id}>
      <Flash msg={a.msg} err={a.err} />
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(승인 · 반려 모두)" size={18} />{' '}
      <button className="btn-sm" disabled={!!a.busy || reason.trim().length < 2} onClick={() => d(true)} data-lsx-extend-ok={row.id}>승인 +{row.months}개월</button>{' '}
      <button className="btn-sm btn-plain" disabled={!!a.busy || reason.trim().length < 2} onClick={() => d(false)} data-lsx-extend-no={row.id}>반려</button>
    </span>
  );
}

export function LsxExpiry() {
  const [view, setView] = useState('SOON');
  const [q, setQ] = useState('');
  const list = useApi<ExpView>(`/admin/lsx/expiry?view=${view}&q=${encodeURIComponent(q)}`, [view, q]);
  const ov = useApi<Overview>('/admin/lsx/overview');
  const a = useAct();
  const [open, setOpen] = useState<string | null>(null);
  const [grace, setGrace] = useState({ days: '30', reason: '' });
  const o = ov.data; const d = list.data;
  return (
    <section data-lsx-expiry={view}>
      <Flash msg={a.msg} err={a.err} />
      {o && <p className={o.settings.expiry ? 'muted' : 'warn-text'} data-lsx-expiry-on={String(o.settings.expiry)}>
        만료 스위치 {o.settings.expiry ? '켬 — 예고 알림 · 날짜 지나면 내림(지우지 않음)' : '꺼짐 — 날짜만 저장 · 표시(내리지 않음)'} · 승인 기본 {o.settings.expiryDefaultMonths}개월 · 예고 {o.settings.expiryWarnDays}일 전
        {o.expiry && <> · 임박 {o.expiry.soon} · 지남(게시 중) {o.expiry.past} · 만료로 내림 30일 {o.expiry.expired30} · 연장 요청 {o.expiry.requests} · 처음 적용 {o.expiry.backfill}</>}
      </p>}
      <p>
        {(['SOON', 'PAST', 'EXPIRED', 'REQUESTS', 'ALL'] as const).map((v) => (
          <button key={v} className={`btn-sm${view === v ? '' : ' btn-plain'}`} onClick={() => setView(v)} data-lsx-view={v}>
            {{ SOON: '곧 끝남', PAST: '날짜 지남', EXPIRED: '만료로 내림', REQUESTS: '연장 요청', ALL: '전체' }[v]}
          </button>))}{' '}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="매물 제목" size={16} />
      </p>
      {d && (view === 'REQUESTS' ? (
        <table className="tbl"><thead><tr><th>매물</th><th>상태</th><th>지금 만료일</th><th className="num">요청</th><th>메모</th><th>요청 시각</th><th /></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.id} data-lsx-req-row={r.id}>
              <td>{r.title} <small className="muted">L-{r.listingNo}</small></td><td>{r.status}{r.expiredAt ? ' · 만료로 내림' : ''}</td><td>{ymd(r.expiresAt)}</td>
              <td className="num">{r.months}개월</td><td>{r.note ?? '—'}</td><td>{ymdhm(r.createdAt)}</td>
              <td><DecideExtend row={r} onDone={() => { list.reload(); ov.reload(); }} /></td>
            </tr>))}</tbody></table>
      ) : (
        <table className="tbl"><thead><tr><th>매물</th><th>상태</th><th>만료일</th><th>정한 곳</th><th>연장 요청</th><th /></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.listingId} data-lsx-exp-row={r.listingId}>
              <td>{r.title} <small className="muted">L-{r.listingNo}</small></td><td>{r.status}{r.expiredAt ? ' · 만료로 내림' : ''}</td>
              <td>{ymd(r.expiresAt)}</td><td>{KIND_KO[r.setKind ?? ''] ?? r.setKind}</td><td>{r.openRequest ? '있음' : '—'}</td>
              <td>{open === r.listingId ? <SetExpiry row={r} onDone={() => { setOpen(null); list.reload(); ov.reload(); }} />
                : <button className="btn-sm btn-plain" onClick={() => setOpen(r.listingId)} data-lsx-exp-open={r.listingId}>만료일 바꾸기</button>}</td>
            </tr>))}</tbody></table>
      ))}
      {d && !d.rows.length && <p className="muted">해당하는 매물이 없습니다.</p>}
      <div className="card pad">
        <b>한꺼번에 유예(SUPER)</b> <span className="muted">스위치를 처음 켜기 전 — 지났거나 N일 안에 끝나는 게시 매물을 오늘 + N일로(한꺼번에 내려가지 않게).</span><br />
        <input value={grace.days} onChange={(e) => setGrace({ ...grace, days: e.target.value })} size={4} aria-label="유예 일수" />일{' '}
        <input value={grace.reason} onChange={(e) => setGrace({ ...grace, reason: e.target.value })} placeholder="사유" size={20} />{' '}
        <button className="btn-sm" disabled={!!a.busy || grace.reason.trim().length < 2}
          onClick={() => void a.run('g', () => post('/admin/lsx/expiry/grace', { days: Number(grace.days), reason: grace.reason }), () => { list.reload(); ov.reload(); }, (r) => `${(r as { moved?: number } | undefined)?.moved ?? 0}건을 미뤘습니다.`)}
          data-lsx-grace="">유예</button>
      </div>
      {o && <SettingsBox s={o.settings} onDone={ov.reload} fields={[['expiry', '만료 스위치', 'bool'], ['expiryDefaultMonths', '기본 개월', 'int'], ['expiryWarnDays', '예고 일', 'int']]} />}
    </section>
  );
}

/* ═════════════ 끌어올리기 ═════════════ */
interface BumpView {
  settings: { mode: string; freeCount: number; periodDays: number; minHours: number; price: number; effectHours: number };
  summary: { live: number; d7: number; free7: number; paid7: number; admin7: number; paid30: number };
  recent: Array<{ id: string; kind: string; listingId: string; title: string; listingNo: number; sortAt: string; until: string; reason: string | null; reasonKind: string | null; createdAt: string; amount: number | null; stub: boolean | null; refundedAt: string | null; live: boolean }>;
  payments: Array<{ id: string; listingId: string; title: string; supply: number; vat: number; amount: number; stub: boolean; paidAt: string; refundedAt: string | null; refundReason: string | null }>;
}
const BK: Record<string, string> = { FREE: '무료', PAID: '유료', ADMIN: '운영' };
const MODE_KO: Record<string, string> = { OFF: '끔', FREE: '무료', PAID: '유료' };
const RK: Record<string, string> = { FIX_ERROR: '오류 바로잡기', MEMBER_REQUEST: '회원 요청 대신' };

export function LsxBump() {
  const q = useApi<BumpView>('/admin/lsx/bumps');
  const ov = useApi<Overview>('/admin/lsx/overview');
  const a = useAct();
  const [f, setF] = useState({ listingId: '', reasonKind: 'FIX_ERROR', reason: '' });
  const [rf, setRf] = useState<Record<string, string>>({});
  const d = q.data; const o = ov.data;
  const reload = () => { q.reload(); ov.reload(); };
  return (
    <section data-lsx-bump={d?.settings.mode ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && <p className="muted">
        방식 <b data-lsx-bump-mode={d.settings.mode}>{MODE_KO[d.settings.mode] ?? d.settings.mode}</b> · 무료 {d.settings.freeCount}회 / {d.settings.periodDays}일 · 간격 {d.settings.minHours}시간
        · 1회 {d.settings.price > 0 ? `${num(d.settings.price)}원 + 부가세` : '금액 정하지 않음'} · 효과 {d.settings.effectHours}시간(무료 · 유료 · 운영 같은 상한 — 최신순에서만 · 지나면 원래 자리)
        · 지금 효과 {d.summary.live} · 7일 {d.summary.d7}(무료 {d.summary.free7} · 유료 {d.summary.paid7} · 운영 {d.summary.admin7}) · 30일 결제 {num(d.summary.paid30)}원
      </p>}
      <div className="card pad">
        <b>운영 끌어올리기 — 바로잡기용(SUPER)</b> <span className="muted">대표 결정 11/20 — 「오류 바로잡기」 · 「회원 요청 대신」 때만 · 글 사유 · 감사 기록 · 목록에 「끌어올림」 표시.</span><br />
        <input value={f.listingId} onChange={(e) => setF({ ...f, listingId: e.target.value })} placeholder="매물 번호(uuid)" size={38} />{' '}
        <select value={f.reasonKind} onChange={(e) => setF({ ...f, reasonKind: e.target.value })} aria-label="사유 종류" data-lsx-admin-bump-kind="">
          <option value="FIX_ERROR">오류 바로잡기</option><option value="MEMBER_REQUEST">회원 요청 대신</option>
        </select>{' '}
        <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="사유" size={20} />{' '}
        <button className="btn-sm" disabled={!!a.busy || f.reason.trim().length < 2 || f.listingId.length !== 36}
          onClick={() => void a.run('b', () => post('/admin/lsx/bumps', f), () => { setF({ listingId: '', reasonKind: 'FIX_ERROR', reason: '' }); reload(); }, '끌어올렸습니다.')} data-lsx-admin-bump="">끌어올리기</button>
      </div>
      {d && (
        <table className="tbl"><thead><tr><th>시각</th><th>종류</th><th>매물</th><th>효과 끝</th><th className="num">금액</th><th>사유</th></tr></thead>
          <tbody>{d.recent.map((r) => (
            <tr key={r.id} data-lsx-bump-row={r.kind}>
              <td>{ymdhm(r.createdAt)}</td><td>{BK[r.kind] ?? r.kind}{r.live && <small className="muted"> 효과 중</small>}</td>
              <td>{r.title} <small className="muted">L-{r.listingNo}</small></td><td>{ymdhm(r.until)}</td>
              <td className="num">{r.amount != null ? `${num(r.amount)}${r.stub ? ' (시험)' : ''}${r.refundedAt ? ' 환불' : ''}` : '—'}</td><td>{r.reasonKind ? `${RK[r.reasonKind] ?? r.reasonKind} · ` : ''}{r.reason ?? '—'}</td>
            </tr>))}</tbody></table>)}
      {d && d.payments.length > 0 && (
        <table className="tbl"><thead><tr><th>결제</th><th>매물</th><th className="num">공급가</th><th className="num">부가세</th><th className="num">합계</th><th>환불</th></tr></thead>
          <tbody>{d.payments.map((p) => (
            <tr key={p.id} data-lsx-pay-row={p.id}>
              <td>{ymdhm(p.paidAt)}{p.stub && <small className="muted"> 시험 결제</small>}</td><td>{p.title}</td>
              <td className="num">{num(p.supply)}</td><td className="num">{num(p.vat)}</td><td className="num">{num(p.amount)}</td>
              <td>{p.refundedAt ? `${ymd(p.refundedAt)} · ${p.refundReason ?? ''}` : (
                <span><input value={rf[p.id] ?? ''} onChange={(e) => setRf({ ...rf, [p.id]: e.target.value })} placeholder="환불 사유(SUPER)" size={14} />{' '}
                  <button className="btn-sm btn-plain" disabled={!!a.busy || (rf[p.id] ?? '').trim().length < 2}
                    onClick={() => { if (window.confirm('이 결제를 환불할까요? 결제사 취소 · 효과도 끝납니다.')) void a.run(`r${p.id}`, () => post(`/admin/lsx/bump-payments/${p.id}/refund`, { reason: rf[p.id] }), reload); }}
                    data-lsx-refund={p.id}>환불</button></span>)}</td>
            </tr>))}</tbody></table>)}
      <p className="muted">유료 방식 · 금액 · 「끌어올린 뒤 환불 없음」 문구는 대표 결정 · 법무 확인 거리입니다. 유료 끌어올림은 목록에 「유료 끌어올림」으로 표시됩니다(전자상거래법 — 대가에 따른 순위 표시).</p>
      {o && <SettingsBox s={o.settings} onDone={reload} fields={[['bumpMode', '방식', 'mode'], ['bumpFreeCount', '무료 횟수', 'int'], ['bumpPeriodDays', '기간(일)', 'int'], ['bumpMinHours', '간격(시간)', 'int'],
        ['bumpPrice', '1회 금액(공급가)', 'int'], ['bumpEffectHours', '효과(시간)', 'int']]} />}
    </section>
  );
}

/* ═════════════ 매물 AI 요약 ═════════════ */
interface SumRow { id: string; listingId: string; title: string; listingNo: number; version: number; currentVersion: number; state: string; body: string | null;
  model: string | null; engine: string | null; note: string | null; createdAt: string; decidedAt: string | null; decideReason: string | null; memberSummary: string; bodyHead: string }
interface SumView { state: string; on: boolean; batch: number; model: string; counts: Record<string, number>; rows: SumRow[] }

function SumDecide({ row, onDone }: { row: SumRow; onDone: () => void }) {
  const a = useAct();
  const [lines, setLines] = useState<string[]>(() => { const l = (row.body ?? '').split('\n'); return [l[0] ?? '', l[1] ?? '', l[2] ?? '']; });
  const [reason, setReason] = useState('');
  const old = row.version !== row.currentVersion;
  return (
    <div data-lsx-sum-edit={row.id}>
      <Flash msg={a.msg} err={a.err} />
      {lines.map((l, i) => <div key={i}><input value={l} maxLength={80} size={60} onChange={(e) => setLines(lines.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`${i + 1}줄`} /></div>)}
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="메모 · 반려 사유" size={30} />{' '}
      <button className="btn-sm" disabled={!!a.busy || old || lines.some((x) => !x.trim())} onClick={() => void a.run('ok', () => post(`/admin/lsx/summaries/${row.id}/decide`, { approve: true, lines, reason: reason || undefined }), onDone)} data-lsx-sum-ok={row.id}>승인 · 공개</button>{' '}
      <button className="btn-sm btn-plain" disabled={!!a.busy || reason.trim().length < 2} onClick={() => void a.run('no', () => post(`/admin/lsx/summaries/${row.id}/decide`, { approve: false, reason }), onDone)} data-lsx-sum-no={row.id}>반려</button>
      {old && <span className="warn-text"> 매물이 고쳐져 옛 판입니다 — 다시 만들기</span>}
    </div>
  );
}

export function LsxSummary() {
  const [state, setState] = useState('DRAFT');
  const q = useApi<SumView>(`/admin/lsx/summaries?state=${state}`, [state]);
  const ov = useApi<Overview>('/admin/lsx/overview');
  const a = useAct();
  const d = q.data; const o = ov.data;
  return (
    <section data-lsx-summary={state}>
      <Flash msg={a.msg} err={a.err} />
      {d && <p className={d.on ? 'muted' : 'warn-text'}>AI 요약 {d.on ? '켬' : '꺼짐'} · 매시간 최대 {d.batch}건 · AI 전체 스위치 · 월 상한 안에서만 · 초안은 회원 · 손님에게 보이지 않고 승인한 것만 매물 상세에 「AI 요약 · 운영자 확인」으로 보입니다.</p>}
      <p>{(['DRAFT', 'APPROVED', 'REJECTED', 'FAILED', 'QUEUED'] as const).map((s) => (
        <button key={s} className={`btn-sm${state === s ? '' : ' btn-plain'}`} onClick={() => setState(s)} data-lsx-sum-state={s}>
          {{ DRAFT: '초안', APPROVED: '승인', REJECTED: '반려', FAILED: '실패', QUEUED: '줄 선 것' }[s]} {d?.counts[s] ?? 0}</button>))}</p>
      {d && d.rows.map((r) => (
        <div key={r.id} className="card pad" data-lsx-sum-row={r.state}>
          <b>{r.title}</b> <small className="muted">L-{r.listingNo} · 판 {r.version}{r.version !== r.currentVersion ? ` (지금 ${r.currentVersion})` : ''} · {r.engine === 'MOCK' ? '시험 엔진' : r.model ?? '—'} · {ymdhm(r.createdAt)}</small>
          <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{r.memberSummary ? `한줄 소개: ${r.memberSummary}\n` : ''}{r.bodyHead}</p>
          {r.state === 'DRAFT' ? <SumDecide row={r} onDone={() => { q.reload(); ov.reload(); }} />
            : <p style={{ whiteSpace: 'pre-wrap' }}>{r.body ?? r.note ?? '—'}{r.decideReason ? `\n(사유: ${r.decideReason})` : ''}</p>}
          {r.state !== 'QUEUED' && <button className="btn-sm btn-plain" disabled={!!a.busy}
            onClick={() => void a.run(`q${r.id}`, () => post('/admin/lsx/summaries/request', { listingId: r.listingId }), q.reload)} data-lsx-sum-redo={r.id}>다시 만들기</button>}
        </div>))}
      {d && !d.rows.length && <p className="muted">해당하는 요약이 없습니다.</p>}
      {o && <SettingsBox s={o.settings} onDone={() => { q.reload(); ov.reload(); }} fields={[['aiSummary', 'AI 요약', 'bool'], ['aiSummaryBatch', '한 번에', 'int'], ['aiSummaryModel', '모델(비우면 검수 보조 모델)', 'text']]} />}
    </section>
  );
}

/* ═════════════ 저장한 검색 ═════════════ */
export function LsxSaved() {
  const ov = useApi<Overview>('/admin/lsx/overview');
  const o = ov.data;
  return (
    <section data-lsx-saved={o?.saved.searches ?? ''}>
      {o && <>
        <p className={o.settings.savedSearch ? 'muted' : 'warn-text'}>저장한 검색 {o.settings.savedSearch ? '켬' : '꺼짐'} · 사람마다 {o.settings.savedSearchMax}개 · 매일 08:10 새 매물 묶음 알림(회원 알림 설정 따름) · 누가 무엇을 저장했는지는 보이지 않습니다.</p>
        <table className="tbl"><tbody>
          <tr><th>저장한 검색</th><td className="num">{num(o.saved.searches)}</td><th>저장한 회원</th><td className="num">{num(o.saved.accounts)}</td></tr>
          <tr><th>알림 켠 검색</th><td className="num">{num(o.saved.notify)}</td><th>7일 보낸 묶음</th><td className="num">{num(o.saved.digests7)}</td></tr>
        </tbody></table>
        <p className="muted">관별: {o.saved.byGwan.map((g) => `${g.gwan} ${g.n}`).join(' · ') || '—'}</p>
        <p className="muted">많이 저장한 검색어(3명 이상): {o.saved.words.map((w) => `${w.keyword} ${w.n}`).join(' · ') || '—'}</p>
        <SettingsBox s={o.settings} onDone={ov.reload} fields={[['savedSearch', '저장한 검색', 'bool'], ['savedSearchMax', '사람마다', 'int']]} />
      </>}
    </section>
  );
}
