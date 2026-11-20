import { getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';

/**
 * v10.516 (D276 · docs/654) 매물 상세의 「AI 요약 · 운영자 확인」 — 운영자가 승인한 3줄만(매물 판이 같을 때 · 스위치 켬).
 *   없으면 아무것도 그리지 않음. 서버 부품(로그인 없이 · 공개 응답 · 60초 캐시).
 */
export async function AiSummary({ listingId }: { listingId: string }) {
  const d = await apiGet<{ lines: string[] | null }>(`/site/lsx/listings/${listingId}/summary`, 60).catch(() => ({ lines: null }));
  if (!d.lines?.length) return null;
  const t = await getTranslations('lsx');
  return (
    <div className="gw-dsec" data-lsx-ai-summary="">
      <h4>{t('aiLabel')}</h4>
      <ul>{d.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      <p><small>{t('aiNote')}</small></p>
    </div>
  );
}
