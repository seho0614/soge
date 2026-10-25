import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { LinkCreateForm } from '@/components/partners/LinkCreateForm';
import { krw, ymd } from '@/components/partners/fmt';
import type { AffProduct } from '@/components/partners/types';

import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('affiliate'))('products.title') };
}

/**
 * SB-AFC-REC-010 추천상품 — GET /partner/affiliate/products
 *
 * ★ 판매 중(ON_SALE)인 것만 옵니다. 행마다 바로 링크를 만들 수 있게 둡니다(POST /partner/affiliate/links).
 * ★ 수수료는 건당 정액 — 주문 금액과 무관합니다.
 */
export default async function PartnerProductsPage() {
  const p = await me();
  if (!p) redirect('/login');
  const t = await getTranslations('affiliate');

  const rows = await apiGetPersonal<AffProduct[]>('/partner/affiliate/products').catch(() => null);

  return (
    <>
      <div className="page-head"><h1>{t('products.title')}</h1></div>
      <p className="lead">{t('products.lead')}</p>
      <div className="notice">{t.rich('products.flat', { b: (c) => <b>{c}</b> })}</div>

      {rows === null ? (
        <p className="form-error" role="alert">{t('products.loadFail')}</p>
      ) : rows.length === 0 ? (
        <p className="empty">{t('products.empty')}</p>
      ) : (
        <table className="tbl">
          <thead><tr><th>{t('common.colProduct')}</th><th>{t('products.colAdvertiser')}</th><th className="num">{t('common.colCommission')}</th><th>{t('products.colPeriod')}</th><th>{t('products.colLink')}</th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id}>
                <td><strong>{x.name}</strong>{x.description && <div className="dim">{x.description}</div>}</td>
                <td>{x.advertiser ?? <span className="dim">—</span>}</td>
                <td className="num">{krw(x.commission)}</td>
                <td>{x.endedAt ? `~ ${ymd(x.endedAt)}` : t('products.always')}</td>
                <td><LinkCreateForm products={[]} fixed={x.id} compact /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="notice warn">
        {t.rich('products.priceLock', { b: (c) => <b>{c}</b> })}
      </div>
    </>
  );
}
