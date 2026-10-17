import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { me } from '@/lib/session';
import { PlazaHero } from '@/components/community/Plaza';
import { FoodWriteForm } from '@/components/community/FoodWriteForm';
import '@/styles/plaza.css';
import '@/styles/food.css';

export const metadata: Metadata = { title: '맛집 소개하기 · 소개광장' };

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
  const kakao = /^[0-9]{1,20}$/.test(sp.kakao ?? '') ? sp.kakao! : null;

  return (
    <><div className="plz">
      <PlazaHero small />
      <div className="plz-body">
        <div className="plz-narrow">
          <h1>맛집 소개하기</h1>
          <p className="lead">직접 다녀온 가게를 이웃에게 소개해 주십시오. <b>가게는 카카오맵에서 찾아 고릅니다.</b></p>
          {!m?.enabled
            ? <p className="plz-empty">우리동네 맛집은 준비 중입니다. <Link href="/community">소개광장으로</Link></p>
            : <FoodWriteForm preset={kakao ? { kakaoId: kakao, name: (sp.name ?? '').slice(0, 80) } : null} />}
        </div>
      </div>
    </div></>
  );
}
