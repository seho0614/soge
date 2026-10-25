import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { getTranslations } from 'next-intl/server';
import { me } from '@/lib/session';
import { Msgs } from '@/i18n/Msgs';
import { PlazaHero } from '@/components/community/Plaza';
import { FoodWriteForm } from '@/components/community/FoodWriteForm';
import '@/styles/plaza.css';
import '@/styles/food.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('plaza'))('food.writeTitle') };
}

/**
 * SB-HOM-CMU-052 우리동네 맛집 › 소개하기 — GET /me/community/food/search · POST /me/community/food (v10.47 · D100)
 *
 * 가게는 카카오에서 찾아 고릅니다(이름을 직접 적지 않음 — 같은 가게가 한 줄로 모이게).
 * 가게 화면의 「이 가게 소개하기」로 오면 ?kakao= · ?name= 으로 이미 골라진 채 열립니다(이미 등록된 가게만 서버가 받음).
 * 첫 글 검수 · 링크 · 도배 · 금칙어는 소개광장 글과 같습니다.
 */
export default async function FoodWritePage({ searchParams }: { searchParams: Promise<{ kakao?: string; name?: string }> }) {
  const p = await me();
  const sp = await searchParams;
  const self = `/community/food/write${sp.kakao ? `?kakao=${encodeURIComponent(sp.kakao)}&name=${encodeURIComponent(sp.name ?? '')}` : ''}`;
  if (!p) redirect(`/login?next=${encodeURIComponent(self)}`);
  const m = await apiGet<{ enabled: boolean }>('/community/food', 60).catch(() => null);
  const t = await getTranslations('plaza.food');
  const kakao = /^[0-9]{1,20}$/.test(sp.kakao ?? '') ? sp.kakao! : null;

  return (
    <><div className="plz">
      <PlazaHero small />
      <div className="plz-body">
        <div className="plz-narrow">
          <h1>{t('writeH')}</h1>
          <p className="lead">{t.rich('writeLead', { b: (c) => <b>{c}</b> })}</p>
          {!m?.enabled
            ? <p className="plz-empty">{t('soon')} <Link href="/community">{t('toPlaza')}</Link></p>
            : <Msgs ns={['plaza']}><FoodWriteForm preset={kakao ? { kakaoId: kakao, name: (sp.name ?? '').slice(0, 80) } : null} /></Msgs>}
        </div>
      </div>
    </div></>
  );
}
