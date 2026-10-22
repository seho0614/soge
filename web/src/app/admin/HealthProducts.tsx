import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAct, n, ymdhm } from '../../lib/act';
import { uploadFile } from '../../lib/files';
import { ErrorView } from '../../components/ErrorView';
import { Flash } from '../../components/Flash';
import { SubTabs, type SubTab } from '../../components/SubTabs';

/**
 * 소개몰 상품 (v10.26 · D027) — 10/8 확인한 제안 그림 ⑤ 대로.
 *   GET/POST /admin/health/products · PATCH /admin/health/products/{code} · POST …/status · POST/PATCH …/options · GET …/history
 *   GET/POST/PATCH /admin/health/ingredients · GET /admin/health/sale-categories
 *   v10.31 (합침) — GET/POST /admin/health/promos · PATCH /admin/health/promos/{id}(소개몰 메인 특가 배너 · 사용자 웹 GET /health/promos)
 *
 * 시안 · 개발분 모두 상품 · 재고를 넣는 화면이 없었습니다(G-147). 본사 운영자만 씁니다(입점 판매자용은 v10.28).
 * 상품의 값 · 재고는 옵션에서 계산됩니다 — 결제 금액 · 재고는 옵션 줄에서 바꿉니다. 바꾼 것은 「변경 기록」에 남습니다.
 * 판매 시작 때 DB 가 판매 범위(잠긴 갈래) · 옵션 · 금지 표현을 봅니다 — 막히면 그 이유가 그대로 보입니다.
 */
type K = 'products' | 'ingredients' | 'categories' | 'promos';
const TABS: SubTab<K>[] = [
  { key: 'products', label: '상품', screen: 'SB-ADM-HPR-010' },
  { key: 'ingredients', label: '성분 · 고민', screen: 'SB-ADM-HPR-020' },
  { key: 'categories', label: '갈래 · 판매 범위', screen: 'SB-ADM-HPR-030' },
  { key: 'promos', label: '특가 배너', screen: 'SB-ADM-HPR-010' },   // v10.31 (합침) — 소개몰 메인 「오늘의 건강상품」(hlt_promos · w3 D061)
];
const ST: Record<string, string> = { DRAFT: '초안', ON_SALE: '판매 중', SOLD_OUT: '품절', STOPPED: '판매 중지' };
const FORM: Record<string, string> = { BOX: '상자', POUCH: '파우치', BOTTLE: '병' };
const TONES = ['', 'GOLD', 'BLUE', 'COBALT', 'DARK', 'GREEN', 'ORANGE', 'PLUM', 'TEAL', 'ROSE'];   // 시안의 그림 색(ART_SKIN) 9가지

interface Opt { id: string; months: number | null; price: number | string; stock: number; tag: string | null; label: string; active: boolean; unit?: number | null }
interface Row {
  code: string; name: string; status: string; category: string; categoryCode: string; price: number | string; listPrice: number | null;
  offPct: number | null; stock: number; badge: string | null; sellerType: string | null; imageUrl: string | null;
  art: { form: string | null; tone: string | null }; mainIngredient: { code: string; name: string; amount: string | null } | null; options: Opt[] | null;
}
interface Detail extends Row {
  summary: string | null; caution: string | null; cautionTitle: string; adCopy: string | null; reviewNo: string | null;
  notice: Record<string, string>; noticeItems: Array<{ label: string; auto: string | null }>; imageFileId: string | null;
}
interface Cat { code: string; name: string; state: string; note: string | null; onSale: number; total: number; noticeGroup: string | null; commissionRate: string | null }
interface Ing { code: string; name: string; aliases: string[] | null; isGroup: boolean; parent: string | null; featured: boolean; excipient: boolean; onSale: number }

export function HealthProducts() {
  const [tab, setTab] = useState<K>('products');
  return (
    <section data-screen="SB-ADM-HPR-010">
      {/* v10.29 — 화면 제목 · 설명은 위 공통 제목 줄(App · adminMenu PAGE)이 그립니다 */}
      <p className="lead">「판매 시작」 때 갈래의 판매 범위(잠김 · 팔지 않음) · 옵션 · 금지 표현을 서버가 검사합니다.</p>
      <SubTabs tabs={TABS} value={tab} onChange={setTab} />
      {tab !== 'promos' && <OnePage focus={tab} />}
      {tab === 'promos' && <Promos />}
    </section>
  );
}

/* v10.32 — 시안(scAdmHpr) 배치: 한 쪽에 상품 표 → 상품 고치기(고른 상품 · 읽기) → 변경 기록 → 성분 · 고민 → 갈래 · 판매 범위를 다 펼칩니다.
 * 전에는 상품 · 성분 · 갈래가 칩마다 따로 열렸습니다. 칩은 그대로 두고, 누르면 이 쪽의 그 구역으로 내려갑니다.
 * 입력이 있는 고치기 화면(SB-ADM-HPR-011 · 옵션 저장 · 그림 · 고시 · 판매 시작)은 「고치기」 · 「수정」이 엽니다(그대로). */
function OnePage({ focus }: { focus: K }) {
  const cats = useApi<Cat[]>('/admin/health/sale-categories');
  const [edit, setEdit] = useState<string | null>(null);   // 상품 코드 · '__new' = 등록
  const [pick, setPick] = useState<string | null>(null);
  const ingRef = useRef<HTMLDivElement>(null);
  const catRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (edit) return;
    const el = focus === 'ingredients' ? ingRef.current : focus === 'categories' ? catRef.current : null;
    if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 300);
    else window.scrollTo(0, 0);
  }, [focus, edit]);
  if (edit) return <Edit code={edit === '__new' ? null : edit} cats={cats.data ?? []} onDone={(c) => { setEdit(c ?? null); if (c) setPick(c); }} />;
  return (
    <>
      <div className="ad-nt info"><b>상품의 값 · 재고는 옵션에서 계산됩니다.</b> 대표 판매가 = 가장 짧은 개월 수 옵션의 결제 금액 · 재고 = 켠 옵션 재고의 합. 결제 금액 · 재고는 옵션 줄에서 바꿉니다.</div>
      <h3 className="ad-s2">상품 <span className="ad-sid">SB-ADM-HPR-010</span></h3>
      <Products cats={cats.data ?? []} pick={pick} onPick={setPick} onEdit={setEdit} />
      {pick && <Preview code={pick} cats={cats.data ?? []} onEdit={() => setEdit(pick)} />}
      <div ref={ingRef} style={{ scrollMarginTop: 12 }}><Ingredients /></div>
      <div ref={catRef} style={{ scrollMarginTop: 12 }}><Categories /></div>
    </>
  );
}

/* v10.32 — 시안 「상품 고치기 — 코드 이름」 읽기용 표(① 기본 · ② 옵션 · 재고 · ③ 그림 · ④ 고시 · 주의사항) + 변경 기록. 값을 바꾸는 것은 「고치기」 화면 */
function Preview({ code, cats, onEdit }: { code: string; cats: Cat[]; onEdit: () => void }) {
  const d = useApi<Detail>(`/admin/health/products/${code}`);
  const hist = useApi<Array<{ createdAt: string; actor: string | null; field: string; before: string | null; after: string | null; note: string | null; optionLabel: string | null }>>(`/admin/health/products/${code}/history`);
  if (d.error) return <ErrorView error={d.error} onRetry={d.reload} />;
  if (!d.data) return <p className="muted">불러오는 중…</p>;
  const x = d.data;
  const cat = cats.find((c) => c.code === x.categoryCode);
  const filled = (x.noticeItems ?? []).filter((it) => (x.notice?.[it.label] ?? '').trim()).length;
  const opts = x.options ?? [];
  return (
    <div data-hpr-preview={code}>
      <h3 className="ad-s2" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>상품 고치기 — {x.code} {x.name}
        <span className={`ad-bg ${x.status === 'ON_SALE' ? 'ok' : ''}`}>{ST[x.status] ?? x.status}</span>
        <span style={{ flex: 1 }} /><button className="btn-sm btn-ok" onClick={onEdit} data-act="product-open-edit">고치기</button></h3>
      <div className="ad-tw"><table className="tbl kv">
        <thead><tr><th colSpan={2}>① 기본</th></tr></thead>
        <tbody>
          <tr><th>이름 · 한 줄 설명</th><td>{x.name}{x.summary ? ` · ${x.summary}` : ''}</td></tr>
          <tr><th>갈래 · 판매자</th><td>{x.category}{cat && cat.state !== 'OPEN' ? ' 🔒' : ''} · {x.sellerType === 'DIRECT' ? '소개뱅크 직판관' : x.sellerType ?? '—'}</td></tr>
          <tr><th>정가 · 배지</th><td>{x.listPrice ? `${n(x.listPrice)}원` : '—'} · {x.badge ?? '배지 없음'}</td></tr>
          <tr><th>대표 성분 | 함량</th><td>{x.mainIngredient ? `${x.mainIngredient.name} | ${x.mainIngredient.amount ?? '—'}` : '—'}</td></tr>
          <tr><th>기능성 문구 · 심의필 번호</th><td>{x.adCopy || '—'} · {x.reviewNo ?? '심의필 없음'}</td></tr>
        </tbody>
      </table></div>
      <div className="ad-tw"><table className="tbl">
        <thead><tr><th>② 옵션 · 재고</th><th>개월 수</th><th className="num-cell">결제 금액</th><th className="num-cell">한 달 단가</th><th className="num-cell">재고</th><th>꼬리 글자</th><th>켬</th></tr></thead>
        <tbody>
          {opts.length === 0 && <tr><td colSpan={7} className="muted">옵션이 없습니다 — 판매를 시작하려면 옵션이 하나 이상 있어야 합니다.</td></tr>}
          {opts.map((o, i) => (
            <tr key={o.id}><td>{i + 1}</td><td>{o.months ?? '단품'}</td><td className="num-cell">{n(o.price)}</td>
              <td className="num-cell">{o.months ? n(Math.round(Number(o.price) / o.months)) : '—'}</td>
              <td className={`num-cell${o.stock === 0 ? ' warn-text' : ''}`}>{o.stock}</td><td>{o.tag ?? ''}</td><td>{o.active ? '켬' : '끔'}</td></tr>
          ))}
        </tbody>
      </table></div>
      <div className="ad-tw"><table className="tbl kv">
        <thead><tr><th colSpan={2}>③ 그림 · ④ 고시 · 주의사항</th></tr></thead>
        <tbody>
          <tr><th>그림</th><td>{x.imageUrl ? '올린 사진' : x.art?.form ? `사진이 없어 그린 그림(${FORM[x.art.form] ?? x.art.form}${x.art.tone ? ` · ${x.art.tone}` : ''})` : '사진 · 그림 없음'} — 사진은 jpg · png 5MB 까지</td></tr>
          <tr><th>상품정보제공고시</th><td>갈래 묶음의 항목 {x.noticeItems?.length ?? 0}개 중 {filled}개 적음 · 비우면 「상세 설명 참조」</td></tr>
          <tr><th>{x.cautionTitle ?? '주의사항'}</th><td>{x.caution || '—'}</td></tr>
        </tbody>
      </table></div>
      <h3 className="ad-s2">변경 기록</h3>
      {!!hist.error && <ErrorView error={hist.error} onRetry={hist.reload} />}
      <div className="ad-tw"><table className="tbl" data-history>
        <thead><tr><th>때</th><th>누가</th><th>항목</th><th>전</th><th>후</th></tr></thead>
        <tbody>
          {(Array.isArray(hist.data) ? hist.data : []).slice(0, 10).map((h, i) => (
            <tr key={i}><td className="muted">{ymdhm(h.createdAt)}</td><td>{h.actor ?? '—'}</td>
              <td>{h.optionLabel ? `${h.optionLabel} · ` : ''}{FIELD[h.field] ?? h.field}{h.note ? ` (${h.note})` : ''}</td><td>{h.before ?? '—'}</td><td>{h.after ?? '—'}</td></tr>
          ))}
          {Array.isArray(hist.data) && hist.data.length === 0 && <tr><td colSpan={5} className="muted">기록이 없습니다.</td></tr>}
        </tbody>
      </table></div>
      <div className="ad-nt info"><b>결제 금액 · 재고 · 상태를 바꾼 기록은 고칠 수 없습니다(DB 가 막습니다).</b> 누가 언제 무엇을 바꿨는지 남습니다.</div>
    </div>
  );
}

function Thumb({ r }: { r: Pick<Row, 'imageUrl' | 'art'> }) {
  if (r.imageUrl) return <img src={r.imageUrl} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6 }} />;
  if (!r.art?.form) return <span className="dim">사진 없음</span>;
  return <span className="mono" style={{ display: 'inline-block', width: 34, height: 34, lineHeight: '34px', textAlign: 'center', borderRadius: 6, background: 'var(--sgb-bg)', fontSize: 10 }}>{FORM[r.art.form] ?? r.art.form}</span>;
}

function Products({ cats: catList, pick, onPick, onEdit }: { cats: Cat[]; pick: string | null; onPick: (c: string) => void; onEdit: (c: string) => void }) {
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

function Edit({ code, cats, onDone }: { code: string | null; cats: Cat[]; onDone: (code?: string | null) => void }) {
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
const FIELD: Record<string, string> = {
  created: '등록', status: '상태', name: '이름', summary: '한 줄 설명', listPrice: '정가', badge: '배지', caution: '주의사항', notice: '고시',
  adCopy: '기능성 문구', reviewNo: '심의필 번호', artForm: '그림 꼴', artTone: '그림 색', imageFileId: '사진', category: '갈래',
  'option.add': '옵션 더함', 'option.price': '결제 금액', 'option.stock': '재고', 'option.tag': '꼬리 글자', 'option.months': '개월 수', 'option.active': '켬/끔',
};

function Ingredients() {
  const list = useApi<Ing[]>('/admin/health/ingredients');
  const a = useAct();
  const [nw, setNw] = useState({ code: '', name: '', aliases: '', parent: '', isGroup: false });
  const groups = (list.data ?? []).filter((g) => g.isGroup);
  const patch = (g: Ing, body: Record<string, unknown>, ok: string) => void a.run(g.code, () => api(`/admin/health/ingredients/${g.code}`, { method: 'PATCH', body: JSON.stringify(body) }), list.reload, ok);
  const add = () => void a.run('add', () => api('/admin/health/ingredients', { method: 'POST', body: JSON.stringify({
    code: nw.code.trim().toUpperCase(), name: nw.name.trim(), aliases: nw.aliases.split(',').map((x) => x.trim()).filter(Boolean), parent: nw.parent || undefined, isGroup: nw.isGroup }) }),
    () => { setNw({ code: '', name: '', aliases: '', parent: '', isGroup: false }); list.reload(); }, '성분을 더했습니다.');
  return (
    <div data-screen="SB-ADM-HPR-020">
      <Flash msg={a.msg} err={a.err} />
      <h3 className="ad-s2">성분 · 고민 <em>{(list.data ?? []).filter((g) => !g.excipient).length}</em> <span className="ad-sid">SB-ADM-HPR-020</span></h3>
      <div className="word-add">
        <input value={nw.code} onChange={(e) => setNw({ ...nw, code: e.target.value })} placeholder="코드(영문)" aria-label="성분 코드" />
        <input value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} placeholder="이름" aria-label="성분 이름" />
        <input value={nw.aliases} onChange={(e) => setNw({ ...nw, aliases: e.target.value })} placeholder="다른 이름(쉼표로)" aria-label="다른 이름" />
        <select value={nw.parent} onChange={(e) => setNw({ ...nw, parent: e.target.value })} aria-label="성분군"><option value="">성분군 없음</option>{groups.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}</select>
        <label className="muted"><input type="checkbox" checked={nw.isGroup} onChange={(e) => setNw({ ...nw, isGroup: e.target.checked })} /> 성분군(묶음)</label>
        <button className="btn-sm btn-ok" disabled={a.busy === 'add' || !nw.code.trim() || !nw.name.trim()} onClick={add}>+ 성분 더하기</button>
      </div>
      {!!list.error && <ErrorView error={list.error} onRetry={list.reload} />}
      <div className="ad-tw"><table className="tbl" data-ingredients>
        <thead><tr><th>코드</th><th>이름</th><th>다른 이름 (검색에 쓰임)</th><th>성분군</th><th>많이 찾는 성분</th><th className="num-cell">판매 중 상품</th></tr></thead>
        <tbody>
          {(list.data ?? []).filter((g) => !g.excipient).map((g) => (
            <tr key={g.code} data-ingredient={g.code}>
              <td className="mono">{g.code}</td><td><b>{g.name}</b></td><td className="muted">{(g.aliases ?? []).join(' · ') || '—'}</td>
              <td>{g.isGroup ? '군(묶음)' : g.parent ? `▸ ${groups.find((x) => x.code === g.parent)?.name ?? g.parent}` : '—'}</td>
              <td>{g.isGroup ? '—' : <label><input type="checkbox" checked={g.featured} disabled={a.busy === g.code}
                onChange={() => patch(g, { featured: !g.featured }, g.featured ? '「많이 찾는 성분」에서 뺐습니다.' : '「많이 찾는 성분」에 넣었습니다.')} /> {g.featured ? '켬' : ''}</label>}</td>
              <td className="num-cell">{g.onSale}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="ad-nt info"><b>성분 트리는 2단까지입니다(군 → 성분).</b> 「많이 찾는 성분」을 켠 성분이 사용자 웹 「성분별」의 첫 구역에 나옵니다. 고민 이름은 광고 문구로 읽히므로 금지 표현 검사를 거칩니다.</div>
    </div>
  );
}

function Categories() {
  const list = useApi<Cat[]>('/admin/health/sale-categories');
  const STATE: Record<string, string> = { OPEN: '열림', LOCKED: '잠김', NOT_SOLD: '팔지 않음' };
  return (
    <div data-screen="SB-ADM-HPR-030">
      <h3 className="ad-s2">갈래 · 판매 범위 <span className="ad-sid">SB-ADM-HPR-030</span></h3>
      {!!list.error && <ErrorView error={list.error} onRetry={list.reload} />}
      <div className="ad-tw"><table className="tbl" data-sale-categories>
        <thead><tr><th>갈래</th><th>판매 범위</th><th>안내(손님에게 보임)</th><th className="num-cell">판매 중 / 전체</th><th>고시 묶음</th><th className="num-cell">수수료율</th></tr></thead>
        <tbody>
          {(list.data ?? []).map((c) => (
            <tr key={c.code} data-category={c.code}>
              <td><b>{c.name}</b> <span className="mono">{c.code}</span></td>
              <td><span className={`ad-bg ${c.state === 'OPEN' ? 'ok' : c.state === 'LOCKED' ? '' : 'no'}`}>{STATE[c.state] ?? c.state}</span></td>
              <td className="muted">{c.note ?? '—'}</td>
              <td className="num-cell">{c.onSale} / {c.total}</td>
              <td>{c.noticeGroup ?? <span className="dim">없음</span>}</td>
              <td className="num-cell">{c.commissionRate != null ? `${Number(c.commissionRate)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="ad-nt warn"><b>판매 범위는 이 화면에서 바꾸지 않습니다.</b> 잠긴 갈래(건강기능식품)는 영업신고 · 표시 · 광고 심의 체계를 갖춘 뒤 DB 마이그레이션으로 엽니다(실수로 여는 일을 막음). 여기서는 읽기만 합니다.</div>
    </div>
  );
}

interface Promo {
  id: string; tag: string; title: string; titleEm: string | null; body: string | null; linkUrl: string; cta: string;
  isSample: boolean; isActive: boolean; startsAt: string | null; endsAt: string | null; sortOrder: number; live: boolean;
}
const EMPTY_PROMO = { tag: '', title: '', titleEm: '', body: '', linkUrl: '/health', cta: '지금 바로 보기', startsAt: '', endsAt: '', sortOrder: '0', isSample: true };
const dt = (s: string) => (s ? new Date(s).toISOString() : null);

/** v10.31 (합침) — 소개몰 「오늘의 건강상품」 특가 배너(hlt_promos). 켬 · 기간 안인 것이 사용자 웹에 나옵니다(최대 5개 · 순서대로). */
function Promos() {
  const list = useApi<Promo[]>('/admin/health/promos');
  const a = useAct();
  const [nw, setNw] = useState(EMPTY_PROMO);
  const patch = (p: Promo, body: Record<string, unknown>, ok: string) =>
    void a.run(p.id, () => api(`/admin/health/promos/${p.id}`, { method: 'PATCH', body: JSON.stringify(body) }), list.reload, ok);
  const add = () => void a.run('add', () => api('/admin/health/promos', { method: 'POST', body: JSON.stringify({
    tag: nw.tag.trim(), title: nw.title.trim(), titleEm: nw.titleEm.trim() || null, body: nw.body.trim() || null, linkUrl: nw.linkUrl.trim(),
    cta: nw.cta.trim() || undefined, isSample: nw.isSample, startsAt: dt(nw.startsAt), endsAt: dt(nw.endsAt), sortOrder: Number(nw.sortOrder) || 0 }) }),
    () => { setNw(EMPTY_PROMO); list.reload(); }, '배너를 더했습니다.');
  return (
    <div data-screen="SB-ADM-HPR-010" data-hlt-promos="">
      <Flash msg={a.msg} err={a.err} />
      <h3 className="sec">특가 배너 <em>{(list.data ?? []).filter((p) => p.live).length}</em> 노출 중</h3>
      <div className="word-add" style={{ flexWrap: 'wrap' }}>
        <input value={nw.tag} onChange={(e) => setNw({ ...nw, tag: e.target.value })} placeholder="머리 글(30자)" aria-label="머리 글" maxLength={30} />
        <input value={nw.title} onChange={(e) => setNw({ ...nw, title: e.target.value })} placeholder="제목(40자)" aria-label="제목" maxLength={40} />
        <input value={nw.titleEm} onChange={(e) => setNw({ ...nw, titleEm: e.target.value })} placeholder="제목 강조(선택)" aria-label="제목 강조" maxLength={40} />
        <input value={nw.body} onChange={(e) => setNw({ ...nw, body: e.target.value })} placeholder="설명(80자 · 선택)" aria-label="설명" maxLength={80} />
        <input value={nw.linkUrl} onChange={(e) => setNw({ ...nw, linkUrl: e.target.value })} placeholder="/health/…" aria-label="이동 주소" />
        <input value={nw.cta} onChange={(e) => setNw({ ...nw, cta: e.target.value })} placeholder="단추 글" aria-label="단추 글" maxLength={20} />
        <label className="muted">시작 <input type="datetime-local" value={nw.startsAt} onChange={(e) => setNw({ ...nw, startsAt: e.target.value })} aria-label="시작" /></label>
        <label className="muted">끝 <input type="datetime-local" value={nw.endsAt} onChange={(e) => setNw({ ...nw, endsAt: e.target.value })} aria-label="끝" /></label>
        <input value={nw.sortOrder} onChange={(e) => setNw({ ...nw, sortOrder: e.target.value })} aria-label="순서" style={{ width: 60 }} />
        <label className="muted"><input type="checkbox" checked={nw.isSample} onChange={(e) => setNw({ ...nw, isSample: e.target.checked })} /> 견본 문구(광고 심의 확인 전)</label>
        <button className="btn-sm btn-ok" disabled={a.busy === 'add' || !nw.tag.trim() || !nw.title.trim() || !/^\/health(\/|$)/.test(nw.linkUrl.trim())} onClick={add}>+ 배너 더하기</button>
      </div>
      {!!list.error && <ErrorView error={list.error} onRetry={list.reload} />}
      <table className="tbl" data-promos>
        <thead><tr><th>순서</th><th>머리 글 · 제목</th><th>이동</th><th>기간</th><th>견본 문구</th><th>상태</th><th /></tr></thead>
        <tbody>
          {(list.data ?? []).map((p) => (
            <tr key={p.id} data-promo={p.id}>
              <td className="num-cell">{p.sortOrder}</td>
              <td><span className="muted">{p.tag}</span><br /><b>{p.title}</b>{p.titleEm && <> <em>{p.titleEm}</em></>}{p.body && <div className="dim">{p.body}</div>}</td>
              <td className="mono">{p.linkUrl}<div className="dim">{p.cta}</div></td>
              <td>{p.startsAt ? ymdhm(p.startsAt) : '처음부터'} ~ {p.endsAt ? ymdhm(p.endsAt) : '끝 없음'}</td>
              <td><label><input type="checkbox" checked={p.isSample} disabled={a.busy === p.id}
                onChange={() => patch(p, { isSample: !p.isSample }, p.isSample ? '견본 표시를 뗐습니다(심의 확인 뒤).' : '견본 표시를 붙였습니다.')} /> {p.isSample ? '붙임' : ''}</label></td>
              <td><span className={`st ${p.live ? 'ok' : 'no'}`}>{p.live ? '노출 중' : p.isActive ? '기간 밖' : '꺼짐'}</span></td>
              <td><button className="btn-sm" disabled={a.busy === p.id} onClick={() => patch(p, { isActive: !p.isActive }, p.isActive ? '배너를 껐습니다.' : '배너를 켰습니다.')}>{p.isActive ? '끄기' : '켜기'}</button></td>
            </tr>
          ))}
          {list.data && list.data.length === 0 && <tr><td colSpan={7} className="dim">배너가 없습니다 — 사용자 웹 소개몰 메인의 특가 배너 자리가 비어 보입니다.</td></tr>}
        </tbody>
      </table>
      <p className="hint" style={{ marginTop: 8 }}>건강기능식품 기능성 문구는 인정 범위 · 광고 심의를 확인한 뒤 「견본 문구」 표시를 뗍니다. 주소는 소개몰(/health) 안만 받습니다.</p>
    </div>
  );
}
