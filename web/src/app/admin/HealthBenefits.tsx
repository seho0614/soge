/* ===== v10.479 ~ 482 (D267 · docs/617 ~ 620) 소개몰 회원 혜택 — web/src/app/admin/HealthBenefits.tsx 새 파일 =====
 * 대표 11/20 「㊲」 — 「주문 받기」가 꺼진 지금은 운영 화면 · 서버 준비 먼저(회원 화면은 주문 API 의 usePoints · giftCode 와 /me/health/* 만).
 *   HealthPoints     소개몰 › 적립금 — 스위치 · 남은 합(충당부채) · 30일 안 소멸 · 최근 기록 · 회원 찾기 · 지급 · 회수
 *   HealthTiers      소개몰 › 회원 등급 — 등급 표 · 만들기 · 고치기 · 끄기 · 운영이 정한 회원 · 지금 다시 셈 · 바뀐 기록
 *   HealthSubscribe  소개몰 › 정기 배송 — 스위치 · 방식(간주 · 실제) · 목록 · 멈춤 · 다시 · 해지 · 지금 돌리기 · 최근 회차
 *   HealthGiftcards  소개몰 › 상품권 — 발행(코드는 한 번만 보임) · 목록 · 코드로 찾기 · 무효 · 잔액 환불 기록
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md) · 색 · 글자는 기존 클래스(card · tbl · btn-sm · warn-text · muted)만 — 어두운 테마 그대로
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

const won = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('ko-KR'));
const KIND_KO: Record<string, string> = { EARN: '적립', USE: '사용', RESTORE: '되돌림', REVOKE: '반품 회수', EXPIRE: '소멸', ADJUST_ADD: '운영 지급', ADJUST_SUB: '운영 회수',
  ISSUE: '발행', VOID: '무효', REFUND: '잔액 환불' };
const STATE_KO: Record<string, string> = { ACTIVE: '진행', PAUSED: '멈춤', CANCELED: '해지', EXPIRED: '소멸', VOID: '무효', REFUNDED: '환불' };

interface Txn { id: string; kind: string; amount: number; orderNo: string | null; reason: string | null; createdAt: string; member?: string }

/* ── 적립금 ── */
interface PointsView { on: boolean; ordersOpen: boolean; rate: number; validDays: number; minUse: number; outstanding: number; expiringSoon: number; members: number;
  earned30: number; used30: number; expired30: number; recent: Txn[]; note: string;
  member: null | { accountId: string; member: string; balance: number; lots: Array<{ id: string; source: string; amount: number; remaining: number; expiresAt: string; closedReason: string | null }>; txns: Txn[] } }

export function HealthPoints() {
  const [email, setEmail] = useState('');
  const [q, setQ] = useState('');
  const v = useApi<PointsView>(`/admin/health/points${q ? `?email=${encodeURIComponent(q)}` : ''}`, [q]);
  const a = useAct();
  const [f, setF] = useState({ direction: 'ADD', amount: '', reason: '' });
  const d = v.data;
  const adjust = () => d?.member && void a.run('adj', () => api('/admin/health/points/adjust', { method: 'POST', body: JSON.stringify({
    accountId: d.member!.accountId, direction: f.direction, amount: Number(f.amount), reason: f.reason }) }), () => { setF({ direction: 'ADD', amount: '', reason: '' }); v.reload(); });
  return (
    <section data-hlt-points={d ? (d.on ? 'on' : 'off') : ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className={d.on ? '' : 'warn-text'}>적립금 {d.on ? '켜짐' : '꺼짐(mall.points)'} · 기본 적립률 {d.rate}% · 유효 {won(d.validDays)}일 · 최소 사용 {won(d.minUse)}원 · 주문 받기 {d.ordersOpen ? '켜짐' : '꺼짐'} — {d.note}</p>
          <table className="tbl"><tbody>
            <tr><th>남은 합(충당부채)</th><td className="num">{won(d.outstanding)}원</td><th>가진 회원</th><td className="num">{won(d.members)}</td><th>30일 안 소멸</th><td className="num">{won(d.expiringSoon)}원</td></tr>
            <tr><th>최근 30일 적립 · 지급</th><td className="num">{won(d.earned30)}원</td><th>사용</th><td className="num">{won(d.used30)}원</td><th>소멸 · 회수</th><td className="num">{won(d.expired30)}원</td></tr>
          </tbody></table>
          <p data-hlt-point-find="">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="회원 이메일" size={28} />{' '}
            <button className="btn-sm btn-plain" disabled={!email.includes('@')} onClick={() => setQ(email.trim())}>찾기</button>{' '}
            {q && <button className="btn-sm btn-plain" onClick={() => { setQ(''); setEmail(''); }}>닫기</button>}
          </p>
          {d.member && (
            <div className="card pad" data-hlt-point-member={d.member.balance}>
              <b>{d.member.member}</b> · 남은 적립금 <b>{won(d.member.balance)}원</b>
              <p data-hlt-point-adjust="">
                <select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })} aria-label="지급 · 회수"><option value="ADD">지급</option><option value="SUB">회수</option></select>{' '}
                <input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="원" style={{ width: 100 }} />{' '}
                <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="사유(2자 이상)" size={24} />{' '}
                <button className="btn-sm" disabled={!(Number(f.amount) >= 1) || f.reason.trim().length < 2 || a.busy === 'adj'} onClick={adjust}>적용</button>
              </p>
              <table className="tbl"><thead><tr><th>묶음</th><th>근거</th><th className="num">금액</th><th className="num">남음</th><th>소멸</th><th>닫힘</th></tr></thead>
                <tbody>{d.member.lots.map((l) => <tr key={l.id}><td>{l.id}</td><td>{l.source === 'EARN' ? '적립' : l.source === 'ADMIN' ? '운영 지급' : '되돌림'}</td><td className="num">{won(l.amount)}</td>
                  <td className="num">{won(l.remaining)}</td><td>{ymdhm(l.expiresAt)}</td><td>{l.closedReason === 'EXPIRED' ? '소멸' : l.closedReason === 'REVOKED' ? '회수' : '—'}</td></tr>)}</tbody></table>
              <TxnTable rows={d.member.txns} />
            </div>
          )}
          <h4>최근 기록</h4>
          <TxnTable rows={d.recent} withMember />
        </>
      )}
    </section>
  );
}

function TxnTable({ rows, withMember }: { rows: Txn[]; withMember?: boolean }) {
  return (
    <table className="tbl"><thead><tr><th>때</th>{withMember && <th>회원</th>}<th>종류</th><th className="num">금액</th><th>주문</th><th>사유</th></tr></thead>
      <tbody>{rows.map((t) => <tr key={t.id}><td>{ymdhm(t.createdAt)}</td>{withMember && <td>{t.member}</td>}<td>{KIND_KO[t.kind] ?? t.kind}</td>
        <td className="num">{won(t.amount)}</td><td>{t.orderNo ?? '—'}</td><td>{t.reason ?? ''}</td></tr>)}</tbody></table>
  );
}

/* ── 회원 등급 ── */
interface Tier { code: string; name: string; minAmount: number; earnRate: number; benefit: string | null; sort: number; active: boolean; members: number }
interface TiersView { on: boolean; months: number; tiers: Tier[]; manual: Array<{ accountId: string; member: string; tierCode: string; reason: string | null; at: string }>;
  changes: Array<{ id: string; member: string; from: string | null; to: string | null; amount: number; byJob: boolean; reason: string | null; at: string }>; note: string }

export function HealthTiers() {
  const v = useApi<TiersView>('/admin/health/tiers');
  const a = useAct();
  const [f, setF] = useState({ code: '', name: '', minAmount: '', earnRate: '', benefit: '' });
  const [edit, setEdit] = useState<Tier | null>(null);
  const [m, setM] = useState({ accountId: '', tierCode: '', reason: '' });
  const d = v.data;
  const create = () => void a.run('tn', () => api('/admin/health/tiers', { method: 'POST', body: JSON.stringify({ code: f.code.trim().toUpperCase(), name: f.name,
    minAmount: Number(f.minAmount || 0), earnRate: Number(f.earnRate || 0), benefit: f.benefit || undefined }) }), () => { setF({ code: '', name: '', minAmount: '', earnRate: '', benefit: '' }); v.reload(); });
  const save = () => edit && void a.run('te', () => api(`/admin/health/tiers/${edit.code}`, { method: 'PUT', body: JSON.stringify({ name: edit.name, minAmount: Number(edit.minAmount),
    earnRate: Number(edit.earnRate), benefit: edit.benefit ?? '', sort: Number(edit.sort), active: edit.active }) }), () => { setEdit(null); v.reload(); });
  return (
    <section data-hlt-tiers={d?.tiers.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className={d.on ? '' : 'warn-text'}>회원 등급 {d.on ? '켜짐' : '꺼짐(mall.tiers)'} · 기간 최근 {d.months}개월 — {d.note}{' '}
            <button className="btn-sm btn-plain" disabled={a.busy === 'run'} onClick={() => void a.run('run', () => api<{ accounts: number; changed: number }>('/admin/health/tiers/run', { method: 'POST' }), v.reload,
              (r) => `다시 셈 — 회원 ${r?.accounts ?? 0} · 바뀜 ${r?.changed ?? 0}`)} data-hlt-tier-run="">지금 다시 셈</button></p>
          <table className="tbl"><thead><tr><th>코드</th><th>이름</th><th className="num">기준 구매액</th><th className="num">적립률</th><th>혜택</th><th className="num">회원</th><th>상태</th><th /></tr></thead>
            <tbody>{d.tiers.map((t) => <tr key={t.code} data-hlt-tier-row={t.code}><td>{t.code}</td><td>{t.name}</td><td className="num">{won(t.minAmount)}</td><td className="num">{t.earnRate}%</td>
              <td>{t.benefit ?? ''}</td><td className="num">{t.members}</td><td>{t.active ? '켬' : '끔'}</td>
              <td><button className="btn-sm btn-plain" onClick={() => setEdit({ ...t })}>고치기</button></td></tr>)}</tbody></table>
          {edit && (
            <div className="card pad" data-hlt-tier-edit={edit.code}>
              <b>{edit.code}</b>{' '}
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} size={10} aria-label="이름" />{' '}
              <input type="number" value={edit.minAmount} onChange={(e) => setEdit({ ...edit, minAmount: Number(e.target.value) })} style={{ width: 110 }} aria-label="기준 구매액" />{' '}
              <input type="number" step="0.1" value={edit.earnRate} onChange={(e) => setEdit({ ...edit, earnRate: Number(e.target.value) })} style={{ width: 70 }} aria-label="적립률" />{' '}
              <input value={edit.benefit ?? ''} onChange={(e) => setEdit({ ...edit, benefit: e.target.value })} size={20} aria-label="혜택" />{' '}
              <label><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> 켬</label>{' '}
              <button className="btn-sm" onClick={save}>저장</button> <button className="btn-sm btn-plain" onClick={() => setEdit(null)}>닫기</button>
            </div>
          )}
          <div className="card pad" data-hlt-tier-new="">
            <b>새 등급</b>{' '}
            <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="코드(VIP)" size={10} maxLength={20} />{' '}
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="이름" size={10} />{' '}
            <input type="number" value={f.minAmount} onChange={(e) => setF({ ...f, minAmount: e.target.value })} placeholder="기준 구매액" style={{ width: 110 }} />{' '}
            <input type="number" step="0.1" value={f.earnRate} onChange={(e) => setF({ ...f, earnRate: e.target.value })} placeholder="적립률 %" style={{ width: 80 }} />{' '}
            <input value={f.benefit} onChange={(e) => setF({ ...f, benefit: e.target.value })} placeholder="혜택 글" size={20} />{' '}
            <button className="btn-sm" disabled={!/^[A-Z][A-Z0-9_]{1,19}$/.test(f.code) || !f.name.trim() || a.busy === 'tn'} onClick={create}>만들기</button>
          </div>
          <div className="card pad" data-hlt-tier-member="">
            <b>운영이 정하기</b>{' '}
            <input value={m.accountId} onChange={(e) => setM({ ...m, accountId: e.target.value.trim() })} placeholder="회원 id(uuid · 적립금 화면에서 찾기)" size={36} />{' '}
            <select value={m.tierCode} onChange={(e) => setM({ ...m, tierCode: e.target.value })} aria-label="등급"><option value="">풀기(자동)</option>{d.tiers.filter((t) => t.active).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select>{' '}
            <input value={m.reason} onChange={(e) => setM({ ...m, reason: e.target.value })} placeholder="사유" size={18} />{' '}
            <button className="btn-sm" disabled={m.accountId.length !== 36 || m.reason.trim().length < 2} onClick={() => void a.run('tm', () => api(`/admin/health/tiers/member/${m.accountId}`, { method: 'PUT', body: JSON.stringify({ tierCode: m.tierCode, reason: m.reason }) }),
              () => { setM({ accountId: '', tierCode: '', reason: '' }); v.reload(); })}>적용</button>
          </div>
          {!!d.manual.length && <p className="muted">운영이 정한 회원: {d.manual.map((x) => `${x.member}(${x.tierCode})`).join(' · ')}</p>}
          <h4>최근 바뀐 기록</h4>
          <table className="tbl"><thead><tr><th>때</th><th>회원</th><th>전</th><th>뒤</th><th className="num">기간 구매액</th><th>누가</th></tr></thead>
            <tbody>{d.changes.map((c) => <tr key={c.id}><td>{ymdhm(c.at)}</td><td>{c.member}</td><td>{c.from ?? '—'}</td><td>{c.to ?? '—'}</td><td className="num">{won(c.amount)}</td><td>{c.byJob ? '다시 셈' : `운영(${c.reason ?? ''})`}</td></tr>)}</tbody></table>
        </>
      )}
    </section>
  );
}

/* ── 정기 배송 ── */
interface Sub { id: string; state: string; qty: number; cycleDays: number; nextOn: string; skipNext: boolean; failCount: number; runs: number; productCode: string; productName: string;
  optionLabel: string; amount: number; member: string; cancelReason: string | null }
interface SubsView { on: boolean; mode: string; retry: number; ordersOpen: boolean; counts: { active: number; paused: number; canceled: number; due: number }; items: Sub[];
  runs: Array<{ id: string; subId: string; runOn: string; state: string; amount: number; stub: boolean; detail: string | null; orderNo: string | null }>; note: string }

export function HealthSubscribe() {
  const [st, setSt] = useState('');
  const v = useApi<SubsView>(`/admin/health/subscriptions${st ? `?state=${st}` : ''}`, [st]);
  const a = useAct();
  const d = v.data;
  const act = (s: Sub, state: string) => {
    const reason = window.prompt(`${s.id}번 정기 배송 — ${STATE_KO[state]} 사유`);
    if (!reason || reason.trim().length < 2) return;
    void a.run(`s${s.id}`, () => api(`/admin/health/subscriptions/${s.id}/state`, { method: 'POST', body: JSON.stringify({ state, reason }) }), v.reload);
  };
  return (
    <section data-hlt-subs={d?.items.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className={d.on && d.ordersOpen ? '' : 'warn-text'}>정기 배송 {d.on ? '켜짐' : '꺼짐(mall.subscribe)'} · 주문 받기 {d.ordersOpen ? '켜짐' : '꺼짐'} · 결제 {d.mode === 'LIVE' ? '실제(LIVE)' : '간주(ASSUME)'} · 실패 {d.retry}번이면 멈춤 — {d.note}</p>
          <p>진행 {d.counts.active} · 멈춤 {d.counts.paused} · 해지 {d.counts.canceled} · 오늘 결제일 {d.counts.due}{' '}
            <select value={st} onChange={(e) => setSt(e.target.value)} aria-label="상태"><option value="">모두</option><option value="ACTIVE">진행</option><option value="PAUSED">멈춤</option><option value="CANCELED">해지</option></select>{' '}
            <button className="btn-sm btn-plain" disabled={a.busy === 'run'} onClick={() => void a.run('run', () => api<{ paid: number; skipped: number; failed: number; note?: string }>('/admin/health/subscriptions/run', { method: 'POST' }), v.reload,
              (r) => r?.note ?? `결제 ${r?.paid ?? 0} · 건너뜀 ${r?.skipped ?? 0} · 실패 ${r?.failed ?? 0}`)} data-hlt-sub-run="">지금 돌리기</button></p>
          <table className="tbl"><thead><tr><th>번호</th><th>회원</th><th>상품</th><th className="num">수량</th><th className="num">금액</th><th>주기</th><th>다음 결제일</th><th>상태</th><th className="num">회차</th><th /></tr></thead>
            <tbody>{d.items.map((s) => <tr key={s.id} data-hlt-sub-row={s.state}><td>{s.id}</td><td>{s.member}</td><td>{s.productName} <small className="dim">{s.optionLabel}</small></td><td className="num">{s.qty}</td>
              <td className="num">{won(s.amount)}</td><td>{s.cycleDays}일</td><td>{s.nextOn}{s.skipNext ? <small className="warn-text"> 건너뜀</small> : ''}</td>
              <td>{STATE_KO[s.state] ?? s.state}{s.failCount ? <small className="warn-text"> 실패 {s.failCount}</small> : ''}</td><td className="num">{s.runs}</td>
              <td>{s.state === 'ACTIVE' && <button className="btn-sm btn-plain" onClick={() => act(s, 'PAUSED')}>멈춤</button>}
                {s.state === 'PAUSED' && <button className="btn-sm btn-plain" onClick={() => act(s, 'ACTIVE')}>다시</button>}{' '}
                {s.state !== 'CANCELED' && <button className="btn-sm btn-plain" onClick={() => act(s, 'CANCELED')}>해지</button>}</td></tr>)}</tbody></table>
          <h4>최근 회차</h4>
          <table className="tbl"><thead><tr><th>날짜</th><th>정기 배송</th><th>결과</th><th className="num">금액</th><th>주문</th><th>내용</th></tr></thead>
            <tbody>{d.runs.map((r) => <tr key={r.id}><td>{r.runOn}</td><td>{r.subId}</td><td>{({ ORDERED: '주문함', PAID: '결제됨', SKIPPED: '건너뜀', FAILED: '실패' } as Record<string, string>)[r.state] ?? r.state}{r.stub ? <small className="dim"> (간주)</small> : ''}</td>
              <td className="num">{won(r.amount)}</td><td>{r.orderNo ?? '—'}</td><td>{r.detail ?? ''}</td></tr>)}</tbody></table>
        </>
      )}
    </section>
  );
}

/* ── 상품권 ── */
interface Gift { id: string; tail: string; batchNo: string; kind: string; face: number; balance: number; state: string; expiresAt: string; expired: boolean; buyerName: string | null; memo: string | null; issuedAt: string }
interface GiftsView { on: boolean; validDays: number; active: number; outstanding: number; soldOutstanding: number; issued: number; used: number; cards: Gift[]; note: string }

export function HealthGiftcards() {
  const [st, setSt] = useState('');
  const v = useApi<GiftsView>(`/admin/health/giftcards${st ? `?state=${st}` : ''}`, [st]);
  const a = useAct();
  const [f, setF] = useState({ kind: 'PROMO', amount: '10000', count: '1', buyerName: '', memo: '' });
  const [codes, setCodes] = useState<Array<{ id: string; code: string }> | null>(null);
  const [look, setLook] = useState('');
  const [found, setFound] = useState<string | null>(null);
  const d = v.data;
  const issue = () => void a.run('gi', async () => {
    const r = await api<{ codes: Array<{ id: string; code: string }>; note: string }>('/admin/health/giftcards', { method: 'POST', body: JSON.stringify({ kind: f.kind, amount: Number(f.amount), count: Number(f.count),
      buyerName: f.buyerName || undefined, memo: f.memo || undefined }) });
    setCodes(r.codes); return r;
  }, v.reload);
  const close = (g: Gift, action: string) => {
    const reason = window.prompt(`끝 ${g.tail} 상품권 — ${action === 'VOID' ? '무효' : '잔액 환불'} 사유`);
    if (!reason || reason.trim().length < 2) return;
    void a.run(`c${g.id}`, () => api(`/admin/health/giftcards/${g.id}/close`, { method: 'POST', body: JSON.stringify({ action, reason }) }), v.reload);
  };
  return (
    <section data-hlt-gifts={d?.cards.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className={d.on ? '' : 'warn-text'}>상품권 받기 {d.on ? '켜짐' : '꺼짐(mall.giftcard)'} · 유효 {won(d.validDays)}일 — {d.note}</p>
          <p>쓸 수 있음 {won(d.active)}장 · 남은 잔액 {won(d.outstanding)}원(판매분 선수금 {won(d.soldOutstanding)}원) · 발행 합 {won(d.issued)}원 · 사용 {won(d.used)}원</p>
          <div className="card pad" data-hlt-gift-new="">
            <b>발행</b>{' '}
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="종류"><option value="PROMO">판촉(무상)</option><option value="SOLD">판매(대금 받음)</option></select>{' '}
            <input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="액면" style={{ width: 100 }} />원 ×{' '}
            <input type="number" value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} style={{ width: 60 }} aria-label="장 수" />장{' '}
            <input value={f.buyerName} onChange={(e) => setF({ ...f, buyerName: e.target.value })} placeholder="산 사람(선택)" size={14} />{' '}
            <input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="메모" size={16} />{' '}
            <button className="btn-sm" disabled={!(Number(f.amount) >= 1000) || !(Number(f.count) >= 1) || a.busy === 'gi'} onClick={issue}>발행</button>
          </div>
          {codes && (
            <div className="card pad" data-hlt-gift-codes={codes.length}>
              <b className="warn-text">코드는 지금 한 번만 보입니다 — 복사해 두십시오.</b> <button className="btn-sm btn-plain" onClick={() => setCodes(null)}>닫기</button>
              <pre>{codes.map((c) => c.code).join('\n')}</pre>
            </div>
          )}
          <p data-hlt-gift-lookup="">
            <input value={look} onChange={(e) => setLook(e.target.value.toUpperCase())} placeholder="상품권 코드로 찾기" size={22} />{' '}
            <button className="btn-sm btn-plain" disabled={look.replace(/-/g, '').length !== 16} onClick={() => void a.run('lk', async () => {
              const r = await api<{ tail: string; balance: number; state: string; expiresAt: string }>('/admin/health/giftcards/lookup', { method: 'POST', body: JSON.stringify({ code: look }) });
              setFound(`끝 ${r.tail} · 잔액 ${won(r.balance)}원 · ${STATE_KO[r.state] ?? r.state} · ${ymdhm(r.expiresAt)}까지`); return r;
            }, undefined, () => '찾았습니다.')}>찾기</button> {found && <small>{found}</small>}
          </p>
          <p><select value={st} onChange={(e) => setSt(e.target.value)} aria-label="상태"><option value="">모두</option><option value="ACTIVE">쓸 수 있음</option><option value="EXPIRED">소멸</option><option value="VOID">무효</option><option value="REFUNDED">환불</option></select></p>
          <table className="tbl"><thead><tr><th>끝 4자리</th><th>묶음</th><th>종류</th><th className="num">액면</th><th className="num">잔액</th><th>유효</th><th>상태</th><th>산 사람</th><th /></tr></thead>
            <tbody>{d.cards.map((g) => <tr key={g.id} data-hlt-gift-row={g.state}><td>{g.tail}</td><td><small>{g.batchNo}</small></td><td>{g.kind === 'SOLD' ? '판매' : '판촉'}</td><td className="num">{won(g.face)}</td>
              <td className="num">{won(g.balance)}</td><td>{ymdhm(g.expiresAt)}{g.expired && g.state === 'ACTIVE' ? <small className="warn-text"> 지남</small> : ''}</td><td>{STATE_KO[g.state] ?? g.state}</td><td>{g.buyerName ?? ''}</td>
              <td>{g.state === 'ACTIVE' && <><button className="btn-sm btn-plain" onClick={() => close(g, 'VOID')}>무효</button>{g.kind === 'SOLD' && <> <button className="btn-sm btn-plain" onClick={() => close(g, 'REFUND')}>잔액 환불</button></>}</>}</td></tr>)}</tbody></table>
        </>
      )}
    </section>
  );
}
