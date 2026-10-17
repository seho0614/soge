import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { me } from '@/lib/session';
import { PlazaHero, PlazaTabs } from '@/components/community/Plaza';
import { FoodMap } from '@/components/community/FoodMap';
import '@/styles/plaza.css';
import '@/styles/food.css';

export const metadata: Metadata = { title: '우리동네 맛집 · 소개광장' };

interface Meta { enabled: boolean; geolocation: boolean; regions: { sido: string; sigungu: string; count: number; lat: number; lng: number }[] }

/**
 * SB-HOM-CMU-050 소개광장 › 우리동네 맛집 — GET /community/food · GET /community/food/places (v10.47 · D100 · docs/98)
 *
 * 이웃이 소개한 가게를 지도와 목록으로 봅니다. 비로그인도 봅니다 — 소개 글쓰기만 로그인입니다.
 * 지도 사용(map.enabled)이 꺼져 있으면 「준비 중」만 보입니다(소개광장 탭에도 나오지 않음).
 */
export default async function FoodPage() {
  const [m, p] = await Promise.all([
    apiGet<Meta>('/community/food', 60).catch(() => null),
    me(),
  ]);
  return (
    <><div className="plz">
      <PlazaHero small />
      <div className="plz-body">
        <PlazaTabs cur="food" />
        <div className="fd-head">
          <div>
            <h1>우리동네 맛집</h1>
            <p>이웃이 직접 다녀와 소개한 가게입니다. 추천 수는 공개된 소개 글 수입니다 — 별점이나 광고 순위가 아닙니다.</p>
          </div>
        </div>
        {!m?.enabled ? (
          <p className="plz-empty">우리동네 맛집은 준비 중입니다. <Link href="/community">소개광장으로</Link></p>
        ) : (
          <>
            <FoodMap regions={m.regions} geolocation={m.geolocation} loggedIn={!!p} />
            <p className="fd-note">
              「동네픽」은 소개뱅크 운영팀이 소개한 가게입니다. 「광고 · 협찬」은 쓴 사람이 대가를 받았다고 밝힌 글입니다.
              가게 정보는 카카오맵에서 가져온 이름 · 주소뿐이고, 영업시간 · 메뉴 · 전화는 「카카오맵에서 보기」에서 확인하십시오.
            </p>
          </>
        )}
      </div>
    </div></>
  );
}
