import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../lib/useApi';
import { n, ymdhm } from '../../lib/act';
import { ErrorView } from '../../components/ErrorView';
import { SubTabs, type SubTab } from '../../components/SubTabs';
import { ST, type Cat } from './healthproducts/shared';
import { FORM, type Detail, Edit, FIELD } from './healthproducts/Edit';
import { Products } from './healthproducts/Products';
import { Ingredients } from './healthproducts/Ingredients';
import { Categories } from './healthproducts/Categories';
import { Promos } from './healthproducts/Promos';

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
