'use client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * 성분 상세의 정렬 고르기 — 시안 SB-HLT-CAT-040 의 「정렬」 고르기 칸.
 * 고르면 주소(?sort=)를 바꿔 서버가 다시 정렬합니다(GET /health/ingredients/{code}?sort=unit|name).
 * 시안의 「리뷰 많은 순」 「별점 높은 순」은 후기 자료가 생기는 v10.27 에서 넣습니다.
 */
export function IngSort({ base, sort, amt }: { base: string; sort: string; amt?: string }) {
  const router = useRouter();
  const t = useTranslations('hlt.sort');
  return (
    <select id="ingSort" className="hlt-sel" value={sort} aria-label={t('aria')}
      onChange={(e) => {
        const q = new URLSearchParams();
        if (e.target.value !== 'unit') q.set('sort', e.target.value);
        if (amt) q.set('amt', amt);
        router.push(`${base}${q.size ? `?${q}` : ''}`);
      }}>
      <option value="unit">{t('unit')}</option>
      <option value="name">{t('name')}</option>
    </select>
  );
}
