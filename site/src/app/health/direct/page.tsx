/** SB-HLT-HUB-020 직판관 */
import type { Metadata } from 'next';
import { apiGet } from '@/lib/api';
import type { HltProduct } from '@/components/health/types';
import { Crumb, HltEmpty, HltNav, ProductGrid, SellerBox } from '@/components/health/HltParts';

export const metadata: Metadata = { title: '직판관 · 소개몰' };

/**
 * 직판관.
 *
 * 건강몰은 **전 상품이 직판**입니다(판매자 hlt_sellers 가 DIRECT 하나).
 * 상품 목록 응답에 판매자 필드가 없어 따로 거르지 않습니다 — 입점 판매가
 * 생기면 API 에 판매자 유형이 와야 여기서 거를 수 있습니다.
 */
export default async function HltDirect() {
  const list = await apiGet<HltProduct[]>('/health/products', 30).catch(() => null);

  return (
    <><div className="hlt">
      <HltNav on="direct" />
      <Crumb items={[{ label: '직판관' }]} />
      <div className="page-head"><h1>직판관 <span className="hlt-bdg direct">직판</span></h1></div>
      <SellerBox compact />
      {list === null ? (
        <p className="form-error" role="alert">상품을 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.</p>
      ) : list.length === 0 ? (
        <HltEmpty msg="등록된 상품이 없습니다." href="/health" label="소개몰 홈" />
      ) : (
        <>
          <p className="hint">전체 {list.length}개</p>
          <ProductGrid list={list} />
        </>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
