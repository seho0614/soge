/** SB-HLT-CAT-040 성분 상세 — v10.26 시안(spec/proto.html SB-HLT-CAT-040) */
import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet, ApiFailure } from '@/lib/api';
import type { HltIngredientDetail } from '@/components/health/types';
import { Crumb, HltEmpty, HltNav, ProductGrid } from '@/components/health/HltParts';
import { IngSort } from '@/components/health/IngSort';
import { krw } from '@/components/health/util';

export const metadata: Metadata = { title: '성분 상세 · 소개몰' };

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ sort?: string; amt?: string }> };

/**
 * 성분 상세 — GET /health/ingredients/{code}?sort= (그 성분이 든 상품 · 그 성분을 많이 찾는 고민).
 *
 * 기본 정렬은 **월 단가 낮은 순**입니다 — 성분 페이지에 온 분은 무엇을 살지는 이미 정하셨고 "얼마인지"를 보러 오셨습니다(시안).
 * 성분군이면 아래 성분의 상품을 모아 보여 드립니다. 함량이 2가지 이상이면 함량 단추로 거릅니다(?amt=).
 * 시안과 다른 곳: 「자격 필요」 표 없음(10/8 B-6) · 리뷰 · 별점 정렬은 v10.27.
 */
export default async function HltIngredientDetail({ params, searchParams }: Props) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  const sp = await searchParams;
  const sort = sp.sort === 'name' || sp.sort === 'NAME' ? 'name' : 'unit';

  let g: HltIngredientDetail | null = null;
  let missing = false;
  try {
    g = await apiGet<HltIngredientDetail>(`/health/ingredients/${encodeURIComponent(code)}?sort=${sort}`, 60);
  } catch (e) {
    missing = e instanceof ApiFailure && e.status < 500;
  }

  if (!g && !missing) {
    return (
      <><div className="hlt">
        <HltNav on="ing" back="/health/ingredients" />
        <p className="form-error" role="alert">성분 정보를 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.</p>
      </div><i hidden data-root-end="" /></>
    );
  }
  if (!g) {
    return (
      <><div className="hlt">
        <HltNav on="ing" back="/health/ingredients" />
        <Crumb items={[{ href: '/health/ingredients', label: '성분별' }, { label: '없는 성분' }]} />
        <HltEmpty msg="없는 성분입니다." href="/health/ingredients" label="성분별 보기" />
      </div><i hidden data-root-end="" /></>
    );
  }

  const list = g.products;
  const amts = g.amounts ?? [];
  const amt = sp.amt && amts.includes(sp.amt) ? sp.amt : undefined;
  const shown = amt ? list.filter((p) => p.ingAmount === amt) : list;
  const inStock = list.filter((p) => !p.soldOut);
  const enc = encodeURIComponent(g.code);
  const base = `/health/i/${enc}`;
  const href = (a?: string) => {
    const q = new URLSearchParams();
    if (sort !== 'unit') q.set('sort', sort);
    if (a) q.set('amt', a);
    return `${base}${q.size ? `?${q}` : ''}`;
  };

  return (
    <><div className="hlt" data-screen="SB-HLT-CAT-040">
      <HltNav on="ing" back="/health/ingredients" />
      <Crumb items={[{ href: '/health/ingredients', label: '성분별' }, { label: g.name }]} />
      <div className="page-head"><h1>{g.name}{g.needsLicense && <> <span className="hlt-bdg st" data-license="">자격 필요</span></>}</h1></div>
      {g.aliases && g.aliases.length > 0 && <p className="hint">다른 이름 · {g.aliases.join(' · ')}</p>}
      {g.note && <p className="lead">{g.note}</p>}
      {g.minUnit != null ? (
        <div className="hlt-u26 big" data-unit="1" style={{ marginTop: 8 }}>최저 <b>월 {krw(g.minUnit)}</b> · 상품 {list.length}개</div>
      ) : inStock.length > 0 ? (
        <p className="hlt-unit">최저 <b>{krw(Math.min(...inStock.map((p) => Number(p.price))))}</b> · 상품 {list.length}개</p>
      ) : null}

      {g.isGroup && (g.children ?? []).length > 0 && (
        <div className="hlt-chips" data-ing-children>
          <span className="hint">아래 성분</span>
          {(g.children ?? []).map((c) => <Link key={c.code} className="hlt-chip" href={`/health/i/${encodeURIComponent(c.code)}`}>{c.name}</Link>)}
        </div>
      )}

      {amts.length > 1 && (
        <section className="hlt-sec" data-amounts>
          <h2>함량</h2>
          <div className="hlt-chips">
            <Link className={`hlt-chip${amt ? '' : ' on'}`} href={href()}>전체</Link>
            {amts.map((a) => <Link key={a} className={`hlt-chip${amt === a ? ' on' : ''}`} href={href(a)} data-amt={a}>{a}</Link>)}
          </div>
        </section>
      )}

      <div className="hlt-chips" style={{ marginTop: 16 }}>
        <label htmlFor="ingSort" className="hint">정렬</label>
        <IngSort base={base} sort={sort} amt={amt} />
        <span className="hint">여기 기본값은 <b>월 단가순</b>입니다 — 성분 페이지에 온 분은 무엇을 살지는 이미 정하셨습니다.</span>
      </div>

      <p className="hint" style={{ margin: '14px 0 10px' }}>{shown.length}개</p>
      {shown.length === 0
        ? <HltEmpty msg="이 성분은 아직 취급하지 않습니다." href="/health/ingredients" label="성분별 보기" />
        : <ProductGrid list={shown} />}

      {g.concerns.length > 0 && (
        <section className="hlt-sec">
          <h2>{g.name} 를 많이 찾는 고민</h2>
          <div className="hlt-chips">
            {g.concerns.map((c) => <Link key={c.code} className="hlt-chip" href={`/health/w/${encodeURIComponent(c.code)}`}>{c.icon} {c.name}</Link>)}
          </div>
          <p className="hint">같은 성분이 여러 고민에 걸립니다 — 고민과 성분은 다대다입니다.</p>
        </section>
      )}
      <p className="hint hlt-gap">
        성분이 같아도 제조사는 다를 수 있습니다. 성분과 함량은 상품에 표시된 값 그대로입니다.
      </p>
    </div><i hidden data-root-end="" /></>
  );
}
