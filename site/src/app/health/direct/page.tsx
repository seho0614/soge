/** SB-HLT-HUB-020 직판관 */
import type { Metadata } from 'next';
import { apiGet } from '@/lib/api';
import type { HltProduct } from '@/components/health/types';
import { Crumb, HltEmpty, HltNav, ProductGrid, SellerBox } from '@/components/health/HltParts';
import { getTranslations } from 'next-intl/server';


export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('order'))('meta.direct') };
}

/**
 * 직판관.
 *
 * 건강몰은 **전 상품이 직판**입니다(판매자 hlt_sellers 가 DIRECT 하나).
 * 상품 목록 응답에 판매자 필드가 없어 따로 거르지 않습니다 — 입점 판매가
 * 생기면 API 에 판매자 유형이 와야 여기서 거를 수 있습니다.
 */
export default async function HltDirect() {
  const t = await getTranslations('order');
  const list = await apiGet<HltProduct[]>('/health/products', 30).catch(() => null);

  return (
    <><div className="hlt">
      <HltNav on="direct" />
      <Crumb items={[{ label: t('directPage.title') }]} />
      <div className="page-head"><h1>{t('directPage.title')} <span className="hlt-bdg direct">{t('common.direct')}</span></h1></div>
      <SellerBox compact />
      {list === null ? (
        <p className="form-error" role="alert">{t('directPage.loadFail')}</p>
      ) : list.length === 0 ? (
        <HltEmpty msg={t('directPage.empty')} href="/health" label={t('directPage.home')} />
      ) : (
        <>
          <p className="hint">{t('directPage.total', { n: String(list.length) })}</p>
          <ProductGrid list={list} />
        </>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
