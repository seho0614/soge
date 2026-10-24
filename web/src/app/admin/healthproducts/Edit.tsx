import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/useApi';
import { useAct, n, ymdhm } from '../../../lib/act';
import { uploadFile } from '../../../lib/files';
import { ErrorView } from '../../../components/ErrorView';
import { Flash } from '../../../components/Flash';
import { ST, type Cat, type Ing } from './shared';
import type { Row } from './Products';

export const FORM: Record<string, string> = { BOX: '상자', POUCH: '파우치', BOTTLE: '병' };

const TONES = ['', 'GOLD', 'BLUE', 'COBALT', 'DARK', 'GREEN', 'ORANGE', 'PLUM', 'TEAL', 'ROSE'];   // 시안의 그림 색(ART_SKIN) 9가지

export interface Opt { id: string; months: number | null; price: number | string; stock: number; tag: string | null; label: string; active: boolean; unit?: number | null }

export interface Detail extends Row {
  summary: string | null; caution: string | null; cautionTitle: string; adCopy: string | null; reviewNo: string | null;
  notice: Record<string, string>; noticeItems: Array<{ label: string; auto: string | null }>; imageFileId: string | null;
}

export function Edit({ code, cats, onDone }: { code: string | null; cats: Cat[]; onDone: (code?: string | null) => void }) {
  const a = useAct();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const isNew = !code;
  /* 입력 칸 */
  type F = { code: string; name: string; categoryCode: string; summary: string; listPrice: string; badge: string; caution: string; adCopy: string; artForm: string; artTone: string; ing: string; amount: string };
  const [f, setF] = useState<F>({ code: '', name: '', categoryCode: 'HLT_FOOD', summary: '', listPrice: '', badge: '', caution: '', adCopy: '',
    artForm: '', artTone: '', ing: '', amount: '' });
  const [notice, setNotice] = useState<Record<string, string>>({});
  const [newOpts, setNewOpts] = useState<Array<{ months: string; price: string; stock: string; tag: string }>>([{ months: code ? '' : '3', price: '', stock: '0', tag: '' }]);
  const [optEdit, setOptEdit] = useState<Record<string, { price: string; stock: string; tag: string }>>({});
  const [file, setFile] = useState<File | null>(null);
  const ings = useApi<Ing[]>('/admin/health/ingredients');
  const hist = useApi<Array<{ createdAt: string; actor: string | null; field: string; before: string | null; after: string | null; note: string | null; optionLabel: string | null }>>(code ? `/admin/health/products/${code}/history` : '/admin/health/products?status=__none');

  const load = () => { if (!code) return; api<Detail>(`/admin/health/products/${code}`).then((x) => {
    setD(x); setErr(null);
    setF({ code: x.code, name: x.name, categoryCode: x.categoryCode, summary: x.summary ?? '', listPrice: x.listPrice ? String(x.listPrice) : '', badge: x.badge ?? '',
      caution: x.caution ?? '', adCopy: x.adCopy ?? '', artForm: x.art?.form ?? '', artTone: x.art?.tone ?? '', ing: x.mainIngredient?.code ?? '', amount: x.mainIngredient?.amount ?? '' });
    setNotice(x.notice ?? {});
    setOptEdit(Object.fromEntries((x.options ?? []).map((o) => [o.id, { price: String(o.price), stock: String(o.stock), tag: o.tag ?? '' }])));
  }).catch(setErr); };
  useEffect(load, [code]);

  const set = (k: keyof F) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(/,/g, '')));

  const save = () => void a.run('save', async () => {
    const body: Record<string, unknown> = {
      name: f.name.trim(), summary: f.summary, listPrice: num(f.listPrice) ?? null, badge: f.badge, caution: f.caution, adCopy: f.adCopy,
      artForm: f.artForm, artTone: f.artTone, notice,
      ...(f.ing ? { mainIngredient: { code: f.ing, amount: f.amount } } : {}),
    };
    if (isNew) {
      const r = await api<{ code: string; note: string }>('/admin/health/products', { method: 'POST', body: JSON.stringify({
        code: f.code.trim(), categoryCode: f.categoryCode, ...body, listPrice: num(f.listPrice), badge: f.badge || undefined, artForm: f.artForm || undefined, artTone: f.artTone || undefined,
        options: newOpts.filter((o) => o.price.trim()).map((o) => ({ months: num(o.months) ?? null, price: num(o.price), stock: num(o.stock) ?? 0, tag: o.tag })) }) });
      if (file) await uploadFile(file, 'PRODUCT_IMAGE').then((u) => api(`/admin/health/products/${r.code}`, { method: 'PATCH', body: JSON.stringify({ imageFileId: u.fileId }) }));
      onDone(r.code);
      return r;
    }
    if (f.categoryCode !== d?.categoryCode) body.categoryCode = f.categoryCode;
    if (file) { const u = await uploadFile(file, 'PRODUCT_IMAGE'); body.imageFileId = u.fileId; }
    const r = await api<Detail>(`/admin/health/products/${code}`, { method: 'PATCH', body: JSON.stringify(body) });
    setFile(null); load(); hist.reload();
    return { ...r, note: '저장했습니다 — 사용자 웹에 바로 반영됩니다.' };
  });
  const status = (s: string) => void a.run('st', () => api<{ note: string }>(`/admin/health/products/${code}/status`, { method: 'POST', body: JSON.stringify({ status: s }) }), () => { load(); hist.reload(); });
  const saveOpt = (o: Opt) => {
    const e = optEdit[o.id]; if (!e) return;
    void a.run(`o-${o.id}`, () => api(`/admin/health/products/${code}/options/${o.id}`, { method: 'PATCH', body: JSON.stringify({ price: num(e.price), stock: num(e.stock), tag: e.tag }) }),
      () => { load(); hist.reload(); }, '옵션을 저장했습니다.');
  };
  const toggleOpt = (o: Opt) => void a.run(`o-${o.id}`, () => api(`/admin/health/products/${code}/options/${o.id}`, { method: 'PATCH', body: JSON.stringify({ active: !o.active }) }), () => { load(); hist.reload(); },
    o.active ? '옵션을 껐습니다 — 손님에게 보이지 않습니다.' : '옵션을 켰습니다.');
  const addOpt = () => { const o = newOpts[0]; if (!o?.price.trim()) return;
    void a.run('addopt', () => api(`/admin/health/products/${code}/options`, { method: 'POST', body: JSON.stringify({ months: num(o.months) ?? null, price: num(o.price), stock: num(o.stock) ?? 0, tag: o.tag }) }),
      () => { setNewOpts([{ months: '', price: '', stock: '0', tag: '' }]); load(); hist.reload(); }, '옵션을 더했습니다.'); };

  if (err) return <ErrorView error={err} onRetry={load} />;
  if (!isNew && !d) return <p className="muted">불러오는 중…</p>;
  const noticeItems = d?.noticeItems ?? [];
  const unit = (price: string, months: string) => { const p = num(price), m = num(months); return p && m ? `${n(Math.round(p / m))}원` : '—'; };
  return (
    <div data-screen="SB-ADM-HPR-011" data-edit={code ?? 'new'}>
      <p className="lead"><button className="btn-sm btn-plain" onClick={() => onDone(null)}>← 상품 목록</button>
        {' '}{isNew ? '상품 등록 — 초안으로 만들어집니다. 판매 시작은 등록 뒤에 합니다.' : <>상품 수정 <span className="mono">{code}</span> <span className={`st ${d!.status === 'ON_SALE' ? 'ok' : 'no'}`}>{ST[d!.status]}</span> — 저장하면 사용자 웹에 바로 반영됩니다.</>}</p>
      <Flash msg={a.msg} err={a.err} />
      <h3 className="sec">① 기본</h3>
      <div className="card pad"><div className="form-grid">
        <label>상품 코드 (주소에 쓰임 · 등록 뒤 못 바꿈)<input value={f.code} onChange={set('code')} disabled={!isNew} placeholder="예: VITC-1000" /></label>
        <label>상품 이름<input value={f.name} onChange={set('name')} maxLength={80} /></label>
        <label>갈래<select value={f.categoryCode} onChange={set('categoryCode')}>
          {cats.map((c) => <option key={c.code} value={c.code} disabled={c.state === 'NOT_SOLD'}>{c.name}{c.state === 'LOCKED' ? ' (잠김 — 판매 시작 불가)' : c.state === 'NOT_SOLD' ? ' (팔지 않음)' : ''}</option>)}
        </select></label>
        <label>판매자<select disabled><option>소개뱅크 직판관 (직판)</option></select></label>
        <label>표제 성분 (카드 · 상세의 「성분 | 함량」)<select value={f.ing} onChange={set('ing')}>
          <option value="">(없음)</option>
          {(ings.data ?? []).filter((g) => !g.isGroup && !g.excipient).map((g) => <option key={g.code} value={g.code}>{g.name} ({g.code})</option>)}
        </select></label>
        <label>함량 표제 (화장품은 용량)<input value={f.amount} onChange={set('amount')} maxLength={30} placeholder="3,000mg" /></label>
        <label style={{ gridColumn: 'span 2' }}>한 줄 설명<input value={f.summary} onChange={set('summary')} maxLength={120} /></label>
        <label>정가 (대표 옵션 기준 · 비우면 할인율을 안 보임)<input value={f.listPrice} onChange={set('listPrice')} inputMode="numeric" /></label>
        <label>배지<select value={f.badge} onChange={set('badge')}><option value="">없음</option><option>신규입점</option><option value="특별가격">특별가격 (메인 「이번 주 특별 할인」에 나옴)</option></select></label>
        <label>기능성 표시 문구 (잠긴 갈래를 열 때만)<input value={f.adCopy} onChange={set('adCopy')} maxLength={300} /></label>
      </div></div>

      <h3 className="sec">② 옵션 · 재고 <span className="right muted">한 달 단가 = 결제 금액 ÷ 개월 수 (자동)</span></h3>
      <table className="tbl" data-options>
        <thead><tr><th style={{ width: 90 }}>개월 수</th><th style={{ width: 150 }}>결제 금액</th><th className="num-cell" style={{ width: 110 }}>한 달 단가</th><th style={{ width: 100 }}>꼬리 글자</th>
          <th style={{ width: 100 }}>재고</th><th>화면에 보이는 이름</th><th style={{ width: 70 }}>판매</th><th style={{ width: 130 }}></th></tr></thead>
        <tbody>
          {(d?.options ?? []).map((o) => {
            const e = optEdit[o.id] ?? { price: String(o.price), stock: String(o.stock), tag: o.tag ?? '' };
            const ch = (k: 'price' | 'stock' | 'tag') => (ev: { target: { value: string } }) => setOptEdit({ ...optEdit, [o.id]: { ...e, [k]: ev.target.value } });
            return (
              <tr key={o.id} data-option={o.id} className={o.active ? '' : 'off'}>
                <td>{o.months ?? '단품'}</td>
                <td><input value={e.price} onChange={ch('price')} inputMode="numeric" aria-label="결제 금액" /></td>
                <td className="num-cell">{o.months ? unit(e.price, String(o.months)) : '—'}</td>
                <td><input value={e.tag} onChange={ch('tag')} maxLength={10} aria-label="꼬리 글자" /></td>
                <td><input value={e.stock} onChange={ch('stock')} inputMode="numeric" aria-label="재고" /></td>
                <td className="muted">{o.label}</td>
                <td><span className={`st ${o.active ? 'ok' : 'no'}`}>{o.active ? '켬' : '끔'}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}><button className="btn-sm btn-ok" disabled={a.busy === `o-${o.id}`} onClick={() => saveOpt(o)}>저장</button>{' '}
                  <button className="btn-sm btn-plain" disabled={a.busy === `o-${o.id}`} onClick={() => toggleOpt(o)}>{o.active ? '끄기' : '켜기'}</button></td>
              </tr>
            );
          })}
          {newOpts.map((o, i) => {
            const ch = (k: 'months' | 'price' | 'stock' | 'tag') => (ev: { target: { value: string } }) => setNewOpts(newOpts.map((x, j) => (j === i ? { ...x, [k]: ev.target.value } : x)));
            return (
              <tr key={`new-${i}`} data-new-option>
                <td><input value={o.months} onChange={ch('months')} inputMode="numeric" placeholder="단품" aria-label="개월 수" /></td>
                <td><input value={o.price} onChange={ch('price')} inputMode="numeric" placeholder="결제 금액" aria-label="새 옵션 결제 금액" /></td>
                <td className="num-cell">{unit(o.price, o.months)}</td>
                <td><input value={o.tag} onChange={ch('tag')} maxLength={10} aria-label="새 옵션 꼬리 글자" /></td>
                <td><input value={o.stock} onChange={ch('stock')} inputMode="numeric" aria-label="새 옵션 재고" /></td>
                <td className="muted">{(o.months ? `${o.months}개월 분` : '단품') + (o.tag ? ` ${o.tag}` : '')}</td>
                <td colSpan={2}>{!isNew && <button className="btn-sm btn-ok" disabled={a.busy === 'addopt' || !o.price.trim()} onClick={addOpt}>옵션 더하기</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="acts">
        {isNew && <button className="btn-sm btn-plain" onClick={() => setNewOpts([...newOpts, { months: '', price: '', stock: '0', tag: '' }])}>+ 옵션 줄 더하기</button>}
        <span className="hint" style={{ margin: 0 }}>개월 수를 비우면 「단품」입니다(한 달 단가를 보이지 않음 — 운동 용품 등). 주문이 있는 옵션은 지우지 않고 「끄기」로 둡니다.</span>
      </div>

      <h3 className="sec">③ 상품 그림</h3>
      <div className="card pad"><div className="form-grid">
        <label>사진 올리기 (JPG · PNG · 5MB 까지 · 권리를 가진 사진만){d?.imageUrl && <img src={d.imageUrl} alt="지금 사진" style={{ width: 80, marginTop: 6 }} />}
          <input type="file" accept="image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <label>사진이 없을 때 그리는 그림 — 꼴<select value={f.artForm} onChange={set('artForm')}><option value="">(없음)</option>{Object.entries(FORM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>색<select value={f.artTone} onChange={set('artTone')}>{TONES.map((t) => <option key={t} value={t}>{t || '자동'}</option>)}</select></label>
      </div><p className="hint" style={{ margin: '8px 0 0' }}>그린 그림에는 성분 이름 · 함량만 적습니다 — 「건강기능식품」 「GMP」 글자는 넣지 않습니다(갈래가 건강기능식품이 아닌 상품에 붙으면 안 됨).</p></div>

      <h3 className="sec">④ 상품정보제공고시 · 주의사항 <span className="right muted">{noticeItems.length ? `갈래 「${cats.find((c) => c.code === f.categoryCode)?.name ?? ''}」 → ${noticeItems.length}항목` : '저장하면 갈래의 항목이 나옵니다'}</span></h3>
      <table className="tbl" data-notice><tbody>
        {noticeItems.map((it) => (
          <tr key={it.label}><th style={{ width: 230 }}>{it.label}</th>
            <td><input value={notice[it.label] ?? ''} onChange={(e) => setNotice({ ...notice, [it.label]: e.target.value })}
                       placeholder={it.auto === 'NAME' ? '비우면 상품 이름' : it.auto === 'CS_TEL' ? '비우면 대표 전화' : it.auto === 'AMOUNT' ? '비우면 함량 표제' : '비우면 「상세 설명 참조」로 보입니다'} /></td></tr>
        ))}
        <tr><th style={{ width: 230 }}>{d?.cautionTitle ?? '주의사항'}</th><td><input value={f.caution} onChange={set('caution')} maxLength={500} /></td></tr>
      </tbody></table>
      {!isNew && <p className="hint" style={{ marginTop: 6 }}>항목 이름은 갈래 묶음(식품 · 건강기능식품 · 화장품)을 따릅니다. 현행 고시와 다르면 알려 주십시오 — 자료라 코드 수정 없이 바꿉니다.</p>}

      <div className="acts">
        <button className="btn-ok btn-sm" disabled={a.busy === 'save'} onClick={save} data-act="product-save">{isNew ? '등록(초안)' : '저장'}</button>
        {!isNew && d!.status !== 'ON_SALE' && <button className="btn-sm btn-ok" disabled={a.busy === 'st'} onClick={() => status('ON_SALE')} data-act="product-start">판매 시작</button>}
        {!isNew && d!.status === 'ON_SALE' && <button className="btn-sm btn-no" disabled={a.busy === 'st'} onClick={() => confirm('판매를 멈춥니다 — 손님에게 보이지 않습니다. 장바구니 · 주문 기록은 그대로입니다.') && status('STOPPED')} data-act="product-stop">판매 중지</button>}
        {!isNew && d!.status === 'ON_SALE' && <span className="muted">사용자 웹 주소 <span className="mono">/health/p/{code}</span></span>}
      </div>

      {!isNew && <>
        <h3 className="sec">변경 기록</h3>
        {!!hist.error && <ErrorView error={hist.error} onRetry={hist.reload} />}
        <table className="tbl" data-history><thead><tr><th>언제</th><th>누가</th><th>무엇을</th></tr></thead><tbody>
          {(Array.isArray(hist.data) ? hist.data : []).map((h, i) => (
            <tr key={i}><td>{ymdhm(h.createdAt)}</td><td>{h.actor ?? '—'}</td>
              <td>{h.optionLabel ? `${h.optionLabel} · ` : ''}{FIELD[h.field] ?? h.field}{h.before != null || h.after != null ? ` ${h.before ?? '—'} → ${h.after ?? '—'}` : ''}{h.note ? ` (${h.note})` : ''}</td></tr>
          ))}
          {Array.isArray(hist.data) && hist.data.length === 0 && <tr><td colSpan={3} className="muted">기록이 없습니다.</td></tr>}
        </tbody></table>
      </>}
    </div>
  );
}

export const FIELD: Record<string, string> = {
  created: '등록', status: '상태', name: '이름', summary: '한 줄 설명', listPrice: '정가', badge: '배지', caution: '주의사항', notice: '고시',
  adCopy: '기능성 문구', reviewNo: '심의필 번호', artForm: '그림 꼴', artTone: '그림 색', imageFileId: '사진', category: '갈래',
  'option.add': '옵션 더함', 'option.price': '결제 금액', 'option.stock': '재고', 'option.tag': '꼬리 글자', 'option.months': '개월 수', 'option.active': '켬/끔',
};
