/** SB-HLT-CAT-050 고민별 인덱스 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';
import type { HltConcern } from '@/components/health/types';
import { Crumb, HltEmpty, HltNav } from '@/components/health/HltParts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('hlt');
  return { title: t('meta.title', { title: t('common.byConcern') }) };
}

/**
 * 고민별 인덱스 — GET /health/concerns
 *
 * 고민은 별도 분류가 아니라 **성분을 다시 묶은 것**입니다(시안). 묶음은 서버 표
 * (hlt_concerns · hlt_concern_ingredients)이고, 연결 성분이 없는 고민은 서버가 내보내지 않습니다.
 */
export default async function HltConcerns() {
  const list = await apiGet<HltConcern[]>('/health/concerns', 300).catch(() => null);
  const t = await getTranslations('hlt.concerns');
  const tc = await getTranslations('hlt.common');

  return (
    <><div className="hlt">
      <HltNav on="concern" />
      <Crumb items={[{ label: tc('byConcern') }]} />
      <div className="page-head"><h1>{tc('byConcern')}</h1></div>
      <p className="hint">{t.rich('hint', { b: (c) => <b>{c}</b> })}</p>

      {list === null ? (
        <p className="form-error" role="alert">{t('loadFail')}</p>
      ) : list.length === 0 ? (
        <HltEmpty msg={t('empty')} href="/health/ingredients" label={tc('viewByIng')} />
      ) : (
        <div className="hlt-igrid">
          {list.map((c) => (
            <Link key={c.code} href={`/health/w/${encodeURIComponent(c.code)}`} className="hlt-icard">
              <span className="nm">{c.icon} {c.name}</span>
              <span className="pr">
                {t('ingCount', { n: String(c.ingredientCount) })}
                {c.stockedIngredientCount < c.ingredientCount && <span className="hint"> {t('stocked', { n: String(c.stockedIngredientCount) })}</span>}
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* v10.31 (시안 「문구 규칙」 노란 안내 상자) — 검정(site_mall V-16): 내부 규칙 번호(INV-H4)는 이용자 화면에 내보내지 않음 */}
      <div className="hlt-note warn hlt-gap" data-wording-rule="">
        <b>{t('ruleTitle')}</b><br />
        {t.rich('ruleBody', { b: (c) => <b>{c}</b>, br: () => <br /> })}
      </div>
      <div className="notice hlt-gap">
        {t.rich('notice', { b: (c) => <b>{c}</b> })}
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
