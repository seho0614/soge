import { getTranslations } from 'next-intl/server';
import { lpxExtras } from './extras';
import '@/styles/lpx.css';

/**
 * v10.551 (D286 · docs/689) 매물 상세 「판매자 자리 비움」 띠 — 서버 부품
 *   판매자가 켠 기간(한국 날짜) 안이고 스위치(lpx.away · 처음 off)가 켜져 있을 때만 · 끝 날짜가 지나면 저절로 안 보임
 *   안내 글은 판매자가 공개하려고 쓴 한 줄(서버가 연락처를 가려 저장)
 */
export async function LpxAwayNote({ listingId }: { listingId: string }) {
  const x = await lpxExtras(listingId);
  if (!x.away) return null;
  const t = await getTranslations('lpx.away');
  const md = (d: string) => d.slice(5).replace('-', '/');
  return (
    <div className="lpx-away" role="note" data-lpx-away={x.away.endsOn}>
      <b>{t('title', { until: md(x.away.endsOn) })}</b>
      {x.away.message && <span className="lpx-away-msg">{x.away.message}</span>}
      <small>{t('note')}</small>
    </div>
  );
}
