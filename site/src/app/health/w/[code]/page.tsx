/** SB-HLT-CAT-060 고민 상세 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet, ApiFailure } from '@/lib/api';
import type { HltConcernDetail } from '@/components/health/types';
import { Crumb, HltEmpty, HltNav, ProductGrid } from '@/components/health/HltParts';

export const metadata: Metadata = { title: '고민 상세 · 소개몰' };

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ ing?: string }> };

/**
 * 고민 상세 — GET /health/concerns/{code}. 성분 칩으로 좁힙니다.
 * 상품마다 든 성분 코드가 함께 와서 칩 선택은 받은 목록 안에서 거릅니다.
 */
export default async function HltConcernDetail({ params, searchParams }: Props) {
  const { code } = await params;
  const pick = (await searchParams).ing;

  let c: HltConcernDetail | null = null;
  let missing = false;
  try {
    c = await apiGet<HltConcernDetail>(`/health/concerns/${encodeURIComponent(decodeURIComponent(code))}`, 60);
  } catch (e) {
    missing = e instanceof ApiFailure && e.status < 500;
  }

  if (!c && missing) {
    return (
      <><div className="hlt">
        <HltNav on="concern" back="/health/concerns" />
        <Crumb items={[{ href: '/health/concerns', label: '고민별' }, { label: '없는 고민' }]} />
        <HltEmpty msg="없는 고민입니다." href="/health/concerns" label="고민별 보기" />
      </div><i hidden data-root-end="" /></>
    );
  }
  if (!c) {
    return (
      <><div className="hlt">
        <HltNav on="concern" back="/health/concerns" />
        <p className="form-error" role="alert">상품을 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.</p>
      </div><i hidden data-root-end="" /></>
    );
  }

  const list = pick ? c.products.filter((p) => p.ingredients.includes(pick)) : c.products;

  return (
    <><div className="hlt">
      <HltNav on="concern" back="/health/concerns" />
      <Crumb items={[{ href: '/health/concerns', label: '고민별' }, { label: c.name }]} />
      <div className="page-head"><h1>{c.icon} {c.name}</h1></div>
      <p className="hint">{c.name} 고민으로 <b>많이 찾는 성분</b>입니다.</p>
      {c.note && <p className="lead">{c.note}</p>}

      <section className="hlt-sec">
        <h2>성분 고르기</h2>
        <div className="hlt-chips">
          <Link className={`hlt-chip${pick ? '' : ' on'}`} href={`/health/w/${encodeURIComponent(c.code)}`}>전체</Link>
          {c.ingredients.map((g) => (g.productCount
            ? <Link key={g.code} className={`hlt-chip${pick === g.code ? ' on' : ''}`}
                href={`/health/w/${encodeURIComponent(c!.code)}?ing=${encodeURIComponent(g.code)}`}>{g.name} <span className="hint">{g.productCount}</span></Link>
            : <span key={g.code} className="hlt-chip lock" aria-disabled="true"
                title={g.locked ? '이 성분의 상품은 준비 중인 갈래에 있습니다' : '준비 중입니다'}>{g.name} 🔒</span>))}
        </div>
      </section>

      <p className="hint">{list.length}개</p>
      {list.length === 0
        ? <HltEmpty msg="이 고민에 연결된 상품이 아직 없습니다." href="/health/concerns" label="고민별 보기" />
        : <ProductGrid list={list} />}

      <div className="notice hlt-gap">
        건강기능식품은 질병의 예방이나 치료를 위한 의약품이 아닙니다. 복용 중인 약이 있으시면 의사나 약사와 상의하십시오.
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
