/* ===== v10.469 (D264 · docs/607) 소개몰 할인 쿠폰 · 기획전 — web/src/app/admin/HealthCoupons.tsx 새 파일 =====
 * 대표 11/20 「㉝ ④」 — 「주문 받기」가 꺼진 지금은 운영 화면 먼저(회원 화면은 주문 API 의 couponCode 만).
 *   HealthCoupons  소개몰 › 쿠폰 · 기획전 — 쿠폰 목록 · 만들기 · 멈춤 · 쓴 기록 · 할인 미리 셈 · 기획전 만들기 · 상품 묶음
 * (adminMenu · App.tsx 연결 줄은 patches/1_wiring.md)
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, ymdhm } from '../../lib/act';
import { Flash } from '../../components/Flash';

const won = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const kstDay = (add = 0) => new Date(Date.now() + 9 * 3600e3 + add * 86400e3).toISOString().slice(0, 10);

interface Coupon { id: string; code: string; name: string; kind: string; amount: number | null; rate: number | null; maxDiscount: number | null; minOrder: number; totalLimit: number | null; perMemberLimit: number;
  startsAt: string; endsAt: string; state: string; promotionId: string | null; promotionTitle: string | null; live: boolean; used: number; restored: number; discountSum: number }
interface Promo { id: string; title: string; startsOn: string; endsOn: string; active: boolean; live: boolean; products: number }
interface View { coupons: Coupon[]; promotions: Promo[]; couponOn: boolean; ordersOpen: boolean; note: string }
interface Uses { code: string; items: Array<{ id: string; orderNo: string; orderStatus: string; total: number; discount: number; state: string; member: string; usedAt: string; restoredAt: string | null; restoreReason: string | null }> }
interface PromoDetail { promotion: Promo & { memo: string | null }; products: Array<{ id: string; code: string; name: string; status: string; sellerType: string | null }>; coupons: Array<{ id: string; code: string; name: string; state: string }> }

const EMPTY = { code: '', name: '', kind: 'FIXED', amount: '', rate: '', maxDiscount: '', minOrder: '', totalLimit: '', perMemberLimit: '1', startsOn: kstDay(), endsOn: kstDay(30), promotionId: '' };
const numOr = (v: string) => (v.trim() === '' ? undefined : Number(v));
const shape = (c: Coupon) => (c.kind === 'FIXED' ? `${won(c.amount)}원` : `${c.rate}%${c.maxDiscount ? ` (최대 ${won(c.maxDiscount)})` : ''}`);

function PromoBox({ id, onDone }: { id: string; onDone: () => void }) {
  const q = useApi<PromoDetail>(`/admin/health/promotions/${id}`, [id]);
  const a = useAct();
  const [codes, setCodes] = useState<string | null>(null);
  const d = q.data;
  if (!d) return null;
  const save = () => void a.run('pp', () => api(`/admin/health/promotions/${id}`, { method: 'PUT', body: JSON.stringify({ productCodes: (codes ?? '').split(/[\s,]+/).filter(Boolean) }) }), () => { setCodes(null); q.reload(); onDone(); });
  return (
    <div className="card pad" data-hlt-promo-view={d.products.length}>
      <Flash msg={a.msg} err={a.err} />
      <b>{d.promotion.title}</b> · {d.promotion.startsOn} ~ {d.promotion.endsOn} · {d.promotion.active ? '켬' : '끔'}{' '}
      <button className="btn-sm btn-plain" onClick={() => void a.run('pa', () => api(`/admin/health/promotions/${id}`, { method: 'PUT', body: JSON.stringify({ active: !d.promotion.active }) }), () => { q.reload(); onDone(); })}>{d.promotion.active ? '끄기' : '켜기'}</button>
      <table className="tbl"><thead><tr><th>상품 코드</th><th>이름</th><th>상태</th><th>판매</th></tr></thead>
        <tbody>{d.products.map((p) => <tr key={p.id}><td>{p.code}</td><td>{p.name}</td><td>{p.status}</td><td>{p.sellerType === 'DIRECT' ? '직판' : <span className="warn-text">입점(쿠폰 할인 없음)</span>}</td></tr>)}</tbody></table>
      {codes == null ? <button className="btn-sm btn-plain" onClick={() => setCodes(d.products.map((p) => p.code).join(' '))} data-hlt-promo-edit="">상품 바꾸기</button> : (
        <p><textarea value={codes} onChange={(e) => setCodes(e.target.value)} rows={3} cols={60} placeholder="상품 코드(띄어쓰기 · 쉼표로 나눔)" />{' '}
          <button className="btn-sm" onClick={save} data-hlt-promo-save="">상품 저장</button> <button className="btn-sm btn-plain" onClick={() => setCodes(null)}>닫기</button></p>
      )}
      {!!d.coupons.length && <p className="muted">걸린 쿠폰: {d.coupons.map((c) => `${c.code}(${c.state})`).join(' · ')}</p>}
    </div>
  );
}

export function HealthCoupons() {
  const q = useApi<View>('/admin/health/coupons');
  const a = useAct();
  const [f, setF] = useState({ ...EMPTY });
  const [uses, setUses] = useState<Uses | null>(null);
  const [pf, setPf] = useState({ title: '', startsOn: kstDay(), endsOn: kstDay(30), productCodes: '' });
  const [pSel, setPSel] = useState<string | null>(null);
  const [sim, setSim] = useState({ code: '', items: '' });
  const [simOut, setSimOut] = useState<string | null>(null);
  const d = q.data;
  const create = () => void a.run('new', () => api('/admin/health/coupons', { method: 'POST', body: JSON.stringify({
    code: f.code.trim().toUpperCase(), name: f.name, kind: f.kind, amount: f.kind === 'FIXED' ? numOr(f.amount) : undefined, rate: f.kind === 'RATE' ? numOr(f.rate) : undefined,
    maxDiscount: f.kind === 'RATE' ? numOr(f.maxDiscount) : undefined, minOrder: numOr(f.minOrder), totalLimit: numOr(f.totalLimit), perMemberLimit: numOr(f.perMemberLimit),
    startsAt: `${f.startsOn}T00:00:00+09:00`, endsAt: `${f.endsOn}T23:59:59+09:00`, promotionId: f.promotionId || undefined }) }), () => { setF({ ...EMPTY }); q.reload(); });
  const quote = () => void a.run('sim', async () => {
    const items = sim.items.split(/[\s,]+/).filter(Boolean).map((t) => { const [productCode, qty] = t.split('*'); return { productCode, qty: Number(qty || 1) }; });
    const r = await api<{ discount: number; goods: number; after: number; note: string }>('/admin/health/coupons/quote', { method: 'POST', body: JSON.stringify({ code: sim.code.trim(), items }) });
    setSimOut(r.note); return r;
  }, undefined, (r) => (r as { note?: string })?.note ?? '셈했습니다.');
  return (
    <section data-hlt-coupons={d?.coupons.length ?? ''}>
      <Flash msg={a.msg} err={a.err} />
      {d && (
        <>
          <p className={d.couponOn ? '' : 'warn-text'} data-hlt-coupon-on={d.couponOn ? 'on' : 'off'}>주문서 쿠폰 받기 {d.couponOn ? '켜짐' : '꺼짐(mall.coupon)'} · 주문 받기 {d.ordersOpen ? '켜짐' : '꺼짐(mall.order_open)'} — {d.note}</p>
          <div className="card pad" data-hlt-coupon-new="">
            <b>새 쿠폰</b>{' '}
            <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="코드(영문 대문자 · 숫자)" size={14} maxLength={20} />{' '}
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="이름" size={16} />{' '}
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="종류"><option value="FIXED">정액</option><option value="RATE">정률</option></select>{' '}
            {f.kind === 'FIXED'
              ? <input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="할인 원" style={{ width: 100 }} />
              : <><input type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="%" style={{ width: 60 }} />{' '}
                <input type="number" value={f.maxDiscount} onChange={(e) => setF({ ...f, maxDiscount: e.target.value })} placeholder="최대 할인" style={{ width: 100 }} /></>}{' '}
            <input type="number" value={f.minOrder} onChange={(e) => setF({ ...f, minOrder: e.target.value })} placeholder="최소 주문" style={{ width: 100 }} />{' '}
            <input type="number" value={f.totalLimit} onChange={(e) => setF({ ...f, totalLimit: e.target.value })} placeholder="전체 한도" style={{ width: 90 }} />{' '}
            <input type="number" value={f.perMemberLimit} onChange={(e) => setF({ ...f, perMemberLimit: e.target.value })} placeholder="한 사람" style={{ width: 70 }} />{' '}
            <input type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} aria-label="시작" />~<input type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} aria-label="끝" />{' '}
            <select value={f.promotionId} onChange={(e) => setF({ ...f, promotionId: e.target.value })} aria-label="기획전"><option value="">모든 직판 상품</option>{d.promotions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>{' '}
            <button className="btn-sm" disabled={!/^[A-Z0-9-]{4,20}$/.test(f.code) || f.name.trim().length < 2 || a.busy === 'new'} onClick={create} data-hlt-coupon-save="">만들기</button>
          </div>
          <table className="tbl"><thead><tr><th>코드</th><th>이름</th><th>할인</th><th className="num">최소 주문</th><th>한도</th><th>기간</th><th>기획전</th><th className="num">씀</th><th className="num">할인 합</th><th>상태</th><th /></tr></thead>
            <tbody>{d.coupons.map((c) => (
              <tr key={c.id} data-hlt-coupon-row={c.live ? 'live' : c.state}>
                <td>{c.code}</td><td>{c.name}</td><td>{shape(c)}</td><td className="num">{won(c.minOrder)}</td><td>{c.totalLimit ?? '없음'} · 1인 {c.perMemberLimit}</td>
                <td><small>{ymdhm(c.startsAt)} ~ {ymdhm(c.endsAt)}</small></td><td>{c.promotionTitle ?? '—'}</td><td className="num">{c.used}{c.restored ? <small className="dim"> (되돌림 {c.restored})</small> : ''}</td>
                <td className="num">{won(c.discountSum)}</td><td>{c.live ? '쓸 수 있음' : c.state === 'PAUSED' ? '멈춤' : '기간 밖'}</td>
                <td><button className="btn-sm btn-plain" onClick={() => void a.run(`s${c.id}`, () => api(`/admin/health/coupons/${c.id}`, { method: 'PUT', body: JSON.stringify({ state: c.state === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }) }), q.reload)} data-hlt-coupon-toggle={c.id}>{c.state === 'ACTIVE' ? '멈춤' : '다시 씀'}</button>{' '}
                  <button className="btn-sm btn-plain" onClick={() => void a.run(`u${c.id}`, async () => { const r = await api<Uses>(`/admin/health/coupons/${c.id}/uses`); setUses(r); return r; }, undefined, () => '쓴 기록을 열었습니다.')}>쓴 기록</button></td></tr>))}</tbody></table>
          {uses && (
            <div className="card pad" data-hlt-coupon-uses={uses.items.length}>
              <b>{uses.code} 쓴 기록</b> <button className="btn-sm btn-plain" onClick={() => setUses(null)}>닫기</button>
              <table className="tbl"><thead><tr><th>주문</th><th>회원</th><th className="num">할인</th><th className="num">결제 금액</th><th>상태</th><th>때</th></tr></thead>
                <tbody>{uses.items.map((u) => <tr key={u.id}><td>{u.orderNo}</td><td>{u.member}</td><td className="num">{won(u.discount)}</td><td className="num">{won(u.total)}</td>
                  <td>{u.state === 'USED' ? '씀' : `되돌림(${u.restoreReason ?? ''})`}</td><td>{ymdhm(u.usedAt)}</td></tr>)}</tbody></table>
            </div>
          )}
          <p data-hlt-coupon-sim="">
            <b>할인 미리 셈</b> <input value={sim.code} onChange={(e) => setSim({ ...sim, code: e.target.value.toUpperCase() })} placeholder="쿠폰 코드" size={14} />{' '}
            <input value={sim.items} onChange={(e) => setSim({ ...sim, items: e.target.value })} placeholder="상품코드*수량 (띄어쓰기로 여럿)" size={30} />{' '}
            <button className="btn-sm btn-plain" disabled={!sim.code || !sim.items.trim()} onClick={quote} data-hlt-coupon-quote="">셈하기</button> {simOut && <small>{simOut}</small>}
          </p>
          <h4>기획전</h4>
          <div className="card pad" data-hlt-promo-new="">
            <input value={pf.title} onChange={(e) => setPf({ ...pf, title: e.target.value })} placeholder="기획전 이름" size={18} />{' '}
            <input type="date" value={pf.startsOn} onChange={(e) => setPf({ ...pf, startsOn: e.target.value })} aria-label="시작" />~<input type="date" value={pf.endsOn} onChange={(e) => setPf({ ...pf, endsOn: e.target.value })} aria-label="끝" />{' '}
            <input value={pf.productCodes} onChange={(e) => setPf({ ...pf, productCodes: e.target.value })} placeholder="상품 코드(띄어쓰기로 여럿 · 나중에도 됨)" size={30} />{' '}
            <button className="btn-sm" disabled={pf.title.trim().length < 2} onClick={() => void a.run('pn', () => api('/admin/health/promotions', { method: 'POST', body: JSON.stringify({ title: pf.title, startsOn: pf.startsOn, endsOn: pf.endsOn,
              productCodes: pf.productCodes.split(/[\s,]+/).filter(Boolean) }) }), () => { setPf({ title: '', startsOn: kstDay(), endsOn: kstDay(30), productCodes: '' }); q.reload(); })} data-hlt-promo-save-new="">기획전 만들기</button>
          </div>
          <table className="tbl"><thead><tr><th>기획전</th><th>기간</th><th className="num">상품</th><th>상태</th></tr></thead>
            <tbody>{d.promotions.map((p) => <tr key={p.id} className={pSel === p.id ? 'on' : ''} onClick={() => setPSel(p.id)} style={{ cursor: 'pointer' }} data-hlt-promo-row={p.live ? 'live' : 'off'}>
              <td>{p.title}</td><td>{p.startsOn} ~ {p.endsOn}</td><td className="num">{p.products}</td><td>{p.live ? '진행 중' : p.active ? '기간 밖' : '끔'}</td></tr>)}</tbody></table>
          {pSel && <PromoBox id={pSel} onDone={q.reload} />}
        </>
      )}
    </section>
  );
}
