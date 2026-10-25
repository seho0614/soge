/** SB-HLT-CAT-030 성분별 인덱스 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';
import { Msgs } from '@/i18n/Msgs';
import type { HltIngredient } from '@/components/health/types';
import { IngredientGrid } from '@/components/health/IngredientGrid';
import { Crumb, HltEmpty, HltNav } from '@/components/health/HltParts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('hlt');
  return { title: t('meta.title', { title: t('common.byIng') }) };
}

/**
 * 건강식품에서 비교하는 단위는 상품이 아니라 **성분 × 함량 × 가격**입니다 — 그래서 성분이 1차 축입니다.
 *
 * 상품이 없는 성분도 **숨기지 않고** 회색으로 둡니다 — 숨기면 "왜 없냐"는 문의가 옵니다(시안).
 * 상품 수 · 최저가는 서버가 성분–상품 연결 표로 셉니다(GET /health/ingredients, D002).
 */
export default async function HltIngredients() {
  const ings = await apiGet<HltIngredient[]>('/health/ingredients', 60).catch(() => null);
  const t = await getTranslations('hlt.ingredients');
  const tc = await getTranslations('hlt.common');

  return (
    <><div className="hlt">
      <HltNav on="ing" />
      <Crumb items={[{ label: tc('byIng') }]} />
      <div className="page-head"><h1>{tc('byIng')}</h1></div>
      <p className="hint">
        {t.rich('hint', { b: (c) => <b>{c}</b> })}
      </p>

      {ings === null ? (
        <p className="form-error" role="alert">{t('loadFail')}</p>
      ) : ings.length === 0 ? (
        <HltEmpty msg={t('empty')} href="/health/c/ALL" label={tc('viewAllProducts')} />
      ) : (
        <Msgs ns={['hlt']}><IngredientGrid ings={ings} /></Msgs>
      )}
      <p className="hint hlt-gap">{t.rich('foot', { b: (c) => <b>{c}</b> })}</p>
    </div><i hidden data-root-end="" /></>
  );
}
