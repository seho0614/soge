/**
 * v10.29 — 소개장터 퀵메뉴 화면(성공현황 · 베스트매칭 · 급구급매 · 사고예방 · 이벤트존)의 공통 틀 — 시안 scWin · scBest · scUrg · scSafe 의 골격.
 *   검색줄 + 띠 광고 → 큰 제목 · 설명 + 퀵메뉴(지금 칸 표시) → 왼쪽(지역 설정 · 상품 분류 · 내 목록 · 등록) / 오른쪽(화면마다 다름) → 아래 안내 6칸
 * 왼쪽 상품 분류를 누르면 소개장터 첫 화면이 그 분류로 걸러집니다(시안 catGwan 과 같은 동작).
 * v10.31 (w2) — 지역 설정 칸은 서버의 시 · 도(GET /market/regions)로 고르고(?region=), 그 지역으로 거르는 화면(급구 · 급매)은 region 을 받습니다.
 *   제한 업종 분류는 공개 분류 목록에서 숨깁니다(등록 화면과 같은 규칙).
 */
import { apiGet } from '@/lib/api';
import type { MarketRegions } from '@/components/market/types';
import { Features, GwFrame, GwSide, QuickHead, SearchRow, type GwCategory } from './GwParts';

export async function QuickFrame({ active, title, sub, aside, children, features = true, region }: {
  active: string; title: string; sub: string; aside?: React.ReactNode; children: React.ReactNode; features?: boolean; region?: string;
}) {
  const [cats, regions] = await Promise.all([
    apiGet<(GwCategory & { restricted?: boolean })[]>('/categories?gwanCode=MNY', 300).catch(() => []),
    apiGet<MarketRegions>('/market/regions?gwanCode=MNY', 300).catch(() => null),
  ]);
  return (
    <GwFrame code="MNY">
      <div className="gw-wrap" style={{ paddingTop: 13 }} data-quick={active}>
        <SearchRow code="MNY" aside={aside} />
        <QuickHead title={title} sub={sub} active={active} />
        <div className="gw-body2"><div className="gw-lay">
          <GwSide code="MNY" cats={cats.filter((c) => !c.restricted)} regions={regions?.all} region={region} />
          <div>{children}</div>
        </div></div>
        {features && <Features />}
      </div>
    </GwFrame>
  );
}
