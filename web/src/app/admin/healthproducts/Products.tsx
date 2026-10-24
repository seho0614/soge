import { useEffect, useState } from 'react';
import { useApi } from '../../../lib/useApi';
import { n } from '../../../lib/act';
import { ErrorView } from '../../../components/ErrorView';
import { ST, type Cat } from './shared';
import { FORM, type Opt } from './Edit';

export interface Row {
  code: string; name: string; status: string; category: string; categoryCode: string; price: number | string; listPrice: number | null;
  offPct: number | null; stock: number; badge: string | null; sellerType: string | null; imageUrl: string | null;
  art: { form: string | null; tone: string | null }; mainIngredient: { code: string; name: string; amount: string | null } | null; options: Opt[] | null;
}

function Thumb({ r }: { r: Pick<Row, 'imageUrl' | 'art'> }) {
  if (r.imageUrl) return <img src={r.imageUrl} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 'var(--sgb-r-sm)' }} />;
  if (!r.art?.form) return <span className="dim">사진 없음</span>;
  return <span className="mono" style={{ display: 'inline-block', width: 34, height: 34, lineHeight: '34px', textAlign: 'center', borderRadius: 'var(--sgb-r-sm)', background: 'var(--sgb-bg)', fontSize: 12 }}>{FORM[r.art.form] ?? r.art.form}</span>;
}

export function Products({ cats: catList, pick, onPick, onEdit }: { cats: Cat[]; pick: string | null; onPick: (c: string) => void; onEdit: (c: string) => void }) {
  const [q, setQ] = useState(''); const [cat, setCat] = useState(''); const [st, setSt] = useState('');
  const [path, setPath] = useState('/admin/health/products');
  const list = useApi<{ items: Row[]; total: number }>(path);
  const find = () => {
    const p = new URLSearchParams(); if (q.trim()) p.set('q', q.trim()); if (cat) p.set('category', cat); if (st) p.set('status', st);
    setPath('/admin/health/products' + (p.toString() ? `?${p}` : ''));
  };
  /* v10.32 — 처음에는 첫 상품을 「상품 고치기」(읽기)로 펼칩니다(시안 p01) */
  useEffect(() => { const it = list.data?.items ?? []; if (!pick && it.length) onPick((it.find((r) => r.status === 'ON_SALE') ?? it[0]!).code); }, [list.data, pick, onPick]);
  return (
    <>
      <div className="acts" style={{ marginTop: 0, marginBottom: 12 }}>
        <select className="sel" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="갈래">
          <option value="">갈래 전체</option>
          {catList.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <select className="sel" value={st} onChange={(e) => setSt(e.target.value)} aria-label="상태">
          <option value="">상태 전체</option>
          {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className="sel" style={{ minWidth: 240 }} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find()}
               placeholder="상품 이름 · 코드 · 성분" aria-label="찾기" />
        <button className="btn-sm btn-plain" onClick={find}>찾기</button>
      </div>
      {!!list.error && <ErrorView error={list.error} onRetry={list.reload} />}
      {list.data && list.data.items.length === 0 && <p className="muted">해당 상품이 없습니다.</p>}
      {(list.data?.items ?? []).length > 0 && (
        <div className="ad-tw"><table className="tbl" data-products={list.data!.total}>
          <thead><tr><th>그림</th><th>코드</th><th>상품 이름 / 성분 | 함량</th><th>갈래</th><th>판매자</th><th className="num-cell">대표 판매가</th>
            <th className="num-cell">정가 (할인율)</th><th>옵션 · 재고</th><th>상태</th><th></th></tr></thead>
          <tbody>
            {list.data!.items.map((r) => {
              const soldOpt = (r.options ?? []).filter((o) => o.active && o.stock === 0).length;
              return (
                <tr key={r.code} data-product={r.code} className={pick === r.code ? 'hl' : undefined}>
                  <td><Thumb r={r} /></td>
                  <td className="mono">{r.code}</td>
                  <td><button className="linkbtn" onClick={() => onPick(r.code)} title="아래 「상품 고치기」에 펼칩니다"><b>{r.name}</b></button><br /><span className="dim">{r.mainIngredient ? `${r.mainIngredient.name} | ${r.mainIngredient.amount ?? '—'}` : '—'}</span></td>
                  <td>{r.category}</td>
                  <td>{r.sellerType === 'DIRECT' ? '직판' : r.sellerType ?? '—'}</td>
                  <td className="num-cell">{n(r.price)}원</td>
                  <td className="num-cell">{r.listPrice ? `${n(r.listPrice)}원${r.offPct ? ` (${r.offPct}%)` : ''}` : <span className="dim">—</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{(r.options ?? []).filter((o) => o.active).map((o) => <span key={o.id}>{o.months ? `${o.months}개월` : '단품'} <b className={o.stock === 0 ? 'warn-text' : ''}>{o.stock}</b><br /></span>)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}><span className={`st ${r.status === 'ON_SALE' ? 'ok' : 'no'}`}>{ST[r.status] ?? r.status}</span>
                    {soldOpt > 0 && r.status === 'ON_SALE' && <><br /><span className="pill pill-warning" style={{ marginLeft: 0 }}>옵션 {soldOpt}개 품절</span></>}</td>
                  <td><button className="btn-sm btn-plain" style={{ whiteSpace: 'nowrap' }} onClick={() => onEdit(r.code)}>수정</button></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
      <p className="hint" style={{ marginTop: 8 }}>대표 판매가 = 가장 짧은 개월 수 옵션의 결제 금액 · 할인율 = 정가 대비 대표 판매가(정가가 더 클 때만) · 재고는 옵션마다 따로 셉니다.</p>
      {/* v10.32 — 시안 자리: 표 아래 「+ 상품 등록」 · 파란 띠 */}
      <div className="ad-dact" style={{ marginTop: 8 }}><button className="btn-ok" onClick={() => onEdit('__new')} data-act="product-new">+ 상품 등록</button></div>
      <div className="ad-nt info"><b>새 상품은 초안으로 만들어집니다.</b> 판매 시작은 옵션이 하나 이상 있어야 합니다. 잠긴 갈래(건강기능식품)와 팔지 않는 갈래의 상품은 판매를 시작할 수 없습니다.</div>
    </>
  );
}
