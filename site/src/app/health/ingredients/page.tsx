/** SB-HLT-CAT-030 성분별 인덱스 */
import type { Metadata } from 'next';
import { apiGet } from '@/lib/api';
import type { HltIngredient } from '@/components/health/types';
import { IngredientGrid } from '@/components/health/IngredientGrid';
import { Crumb, HltEmpty, HltNav } from '@/components/health/HltParts';

export const metadata: Metadata = { title: '성분별 · 소개몰' };

/**
 * 건강식품에서 비교하는 단위는 상품이 아니라 **성분 × 함량 × 가격**입니다 — 그래서 성분이 1차 축입니다.
 *
 * 상품이 없는 성분도 **숨기지 않고** 회색으로 둡니다 — 숨기면 "왜 없냐"는 문의가 옵니다(시안).
 * 상품 수 · 최저가는 서버가 성분–상품 연결 표로 셉니다(GET /health/ingredients, D002).
 */
export default async function HltIngredients() {
  const ings = await apiGet<HltIngredient[]>('/health/ingredients', 60).catch(() => null);

  return (
    <><div className="hlt">
      <HltNav on="ing" />
      <Crumb items={[{ label: '성분별' }]} />
      <div className="page-head"><h1>성분별</h1></div>
      <p className="hint">
        건강식품에서 비교하는 단위는 상품이 아니라 <b>성분 × 함량 × 월 단가</b>입니다. 그래서 성분이 1차 축입니다.
      </p>

      {ings === null ? (
        <p className="form-error" role="alert">성분 목록을 불러오지 못했습니다. 잠시 뒤 다시 열어 주십시오.</p>
      ) : ings.length === 0 ? (
        <HltEmpty msg="등록된 성분이 아직 없습니다." href="/health/c/ALL" label="전체제품 보기" />
      ) : (
        <IngredientGrid ings={ings} />
      )}
      <p className="hint hlt-gap">상품이 없는 성분도 <b>숨기지 않고</b> 회색으로 둡니다 — 숨기면 &quot;왜 없냐&quot;는 문의가 옵니다.</p>
    </div><i hidden data-root-end="" /></>
  );
}
