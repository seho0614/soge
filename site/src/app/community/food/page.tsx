import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { getTranslations } from 'next-intl/server';
import { me } from '@/lib/session';
import { Msgs } from '@/i18n/Msgs';
import { PlazaHero, PlazaTabs } from '@/components/community/Plaza';
import { FoodMap } from '@/components/community/FoodMap';
import '@/styles/plaza.css';
import '@/styles/food.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('plaza'))('food.title') };
}

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
  const t = await getTranslations('plaza.food');
  return (
    <><div className="plz">
      <PlazaHero small />
      <div className="plz-body">
        <PlazaTabs cur="food" />
        <div className="fd-head">
          <div>
            <h1>{t('h')}</h1>
            <p>{t('lead')}</p>
          </div>
        </div>
        {!m?.enabled ? (
          <p className="plz-empty">{t('soon')} <Link href="/community">{t('toPlaza')}</Link></p>
        ) : (
          <>
            <Msgs ns={['plaza']}><FoodMap regions={m.regions} geolocation={m.geolocation} loggedIn={!!p} /></Msgs>
            <p className="fd-note">
              {t('note')}
            </p>
          </>
        )}
      </div>
    </div></>
  );
}
