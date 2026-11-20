import { getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';

/**
 * v10.526 (D279 · docs/664) 매물 상세의 동영상 — 운영자가 승인한 영상만(스위치 켬 · 매물 게시 중).
 *   없으면 아무것도 그리지 않음. 서버 부품(로그인 없이 · 공개 응답 · 60초 캐시 — 주소는 5분 동안 유효).
 */
export async function ListingVideo({ listingId }: { listingId: string }) {
  const d = await apiGet<{ video: { url: string; contentType: string; durationSec: number; width: number | null; height: number | null } | null }>(
    `/site/lsy/listings/${listingId}/video`, 60).catch(() => ({ video: null }));
  if (!d.video) return null;
  const t = await getTranslations('lsy');
  return (
    <div className="gw-dsec" data-lsy-video="">
      <h4>{t('videoHead')}</h4>
      <video controls preload="metadata" playsInline style={{ width: '100%', maxHeight: 480 }} aria-label={t('videoHead')}>
        <source src={d.video.url} type={d.video.contentType} />
      </video>
      <p><small>{t('videoNote', { sec: String(d.video.durationSec) })}</small></p>
    </div>
  );
}
