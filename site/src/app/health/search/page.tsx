/** SB-HLT-CAT-020 검색 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import type { HltIngredient, HltProduct } from '@/components/health/types';
import { Crumb, HltEmpty, HltNav, ProductGrid } from '@/components/health/HltParts';
import { SearchBox } from '@/components/health/SearchBox';

export const metadata: Metadata = { title: '검색 · 소개몰' };

type Props = { searchParams: Promise<{ q?: string }> };

/* 시안의 인기 검색어(v10.26 시안 그대로). 지금 살 수 있는 상품이 있는 말만 보여 드립니다 — 눌러도 결과가 없으면 안 되기 때문입니다
 * (견본 상품을 넣지 않는 서버에서는 줄어듭니다). 판정은 성분 목록의 상품 수 · 최저가(GET /health/ingredients)로 합니다. */
const POPULAR = ['비타민C', '유산균', '루테인', '마그네슘', '콜라겐'];

/**
 * 건강몰 검색은 **상품명·성분**으로 찾습니다. 본체 검색(업종·등록 제목)과
 * 찾는 것이 달라 따로 둡니다 — 시안 주석 그대로.
 */
export default async function HltSearch({ searchParams }: Props) {
  const q = ((await searchParams).q ?? '').trim().slice(0, 50);
  /* v10.83 — 한 글자는 「두 글자 이상」(전: 한 글자 낱말을 건너뛰어 판매 중 상품이 전부 나옴) */
  const short = !!q && q.replace(/\s/g, '').length < 2;
  const ings = q ? [] : await apiGet<HltIngredient[]>('/health/ingredients', 60).catch(() => [] as HltIngredient[]);
  const popular = POPULAR.filter((w) => ings.some((g) => g.name === w && g.productCount > 0 && g.minPrice != null));
  const list = q && !short
    ? await apiGet<HltProduct[]>(`/health/products?keyword=${encodeURIComponent(q)}`, 30).catch(() => null)
    : [];

  return (
    <><div className="hlt">
      <HltNav on="search" />
      <Crumb items={[{ label: '검색' }]} />
      <div className="page-head"><h1>검색</h1></div>

      <SearchBox key={q} q={q} />

      {!q ? (popular.length === 0 ? null :
        <section className="hlt-box" data-popular>
          <h3>인기 검색어</h3>
          <div className="hlt-chips">
            {popular.map((w) => (
              <Link key={w} className="hlt-chip" href={`/health/search?q=${encodeURIComponent(w)}`}>{w}</Link>
            ))}
          </div>
        </section>
      ) : short ? (
        <HltEmpty msg="두 글자 이상 입력해 주세요." href="/health/search" label="검색어 지우기" />
      ) : list === null ? (
        <p className="form-error" role="alert">검색하지 못했습니다. 잠시 뒤 다시 시도해 주십시오.</p>
      ) : list.length === 0 ? (
        <HltEmpty msg={`‘${q}’ 에 대한 결과가 없습니다.`} href="/health/search" label="검색어 지우기" />
      ) : (
        <>
          <p className="hint">‘{q}’ 결과 {list.length}개</p>
          <ProductGrid list={list} />
        </>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
