/** SB-HLT-CAT-010 전체제품 · 카테고리 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';
import type { HltCategory, HltProduct, HltSaleCategory } from '@/components/health/types';
import { Crumb, HltEmpty, HltNav, ProductGrid } from '@/components/health/HltParts';

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('hlt');
  return { title: t('meta.title', { title: t('common.allProducts') }) };
}

/**
 * 카테고리는 **자격·심의를 거는 축**입니다(시안). 소비자 진열축은 성분·고민입니다.
 *
 * v10.25 (2026-10-08 「시안을 기준으로」 · D025)
 *   · 갈래 단추 = **열린 갈래(상품이 있는 것) + 잠긴 갈래 🔒** — GET /health/categories. 「전체」 단추와 팔지 않는 갈래는 없습니다(시안).
 *   · `ALL`(메뉴의 「전체제품」)은 시안처럼 첫 열린 갈래를 엽니다.
 *   · 잠긴 갈래는 「준비 중」 안내와 「열린 품목 보기」, 팔지 않는 갈래는 그 까닭을 보입니다(주소로 바로 온 경우).
 * 모르는 코드는 API 에 보내지 않습니다 — 빈 목록이 "상품이 없다" 로 읽히기 때문입니다.
 */
export default async function HltCategoryPage({ params }: Props) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw).toUpperCase();
  const t = await getTranslations('hlt.category');
  const tc = await getTranslations('hlt.common');
  const [sale, cats] = await Promise.all([
    apiGet<HltSaleCategory[]>('/health/categories', 60).catch(() => null),
    apiGet<HltCategory[]>('/categories?gwanCode=HLT', 300).catch(() => [] as HltCategory[]),
  ]);
  const opens = (sale ?? []).filter((c) => c.state === 'OPEN' && c.productCount > 0);
  const locks = (sale ?? []).filter((c) => c.state === 'LOCKED');
  if (code === 'ALL' && opens[0]) redirect(`/health/c/${opens[0].code}`);

  const mine = (sale ?? []).find((c) => c.code === code);
  const cat = cats.find((c) => c.code === code);
  const closed = mine && mine.state !== 'OPEN' ? mine : null;
  const list = cat && !closed
    ? await apiGet<HltProduct[]>(`/health/products?category=${encodeURIComponent(code)}`, 30).catch(() => null)
    : [];
  const title = code === 'ALL' ? tc('allProducts') : cat?.name ?? t('fallback');
  const firstOpen = opens[0] ? `/health/c/${opens[0].code}` : '/health';

  return (
    <><div className="hlt">
      <HltNav on="cat" />
      <Crumb items={[{ label: title }]} />
      <div className="page-head"><h1>{title}</h1></div>
      <p className="hint">
        {t.rich('hint', { b: (c) => <b>{c}</b>, ing: (c) => <Link href="/health/ingredients">{c}</Link>, con: (c) => <Link href="/health/concerns">{c}</Link> })}
      </p>

      <div className="hlt-chips" data-sale-cats>
        {opens.map((c) => (
          <Link key={c.code} href={`/health/c/${c.code}`} className={`hlt-chip${c.code === code ? ' on' : ''}`}>{c.name}</Link>
        ))}
        {locks.map((c) => (
          /* 시안과 같게 누를 수 없습니다 — 안내는 풍선 글(주소로 바로 오면 아래의 안내가 나옵니다) */
          <span key={c.code} className={`hlt-chip lock${c.code === code ? ' on' : ''}`} aria-disabled="true" title={c.note ?? tc('preparing')}>{c.name} 🔒</span>
        ))}
      </div>
      {/* 남기기로 한 것(10/8) — 팔지 않는 품목 안내로 가는 길. 전에는 갈래 단추(의약품 · 의료 서비스)를 눌러야 보였습니다 */}
      <p className="hint">{t.rich('notSold', { link: (c) => <Link href="/health/guide#not-sold">{c}</Link> })}</p>

      {closed ? (
        <div className="hlt-empty" data-closed={closed.state}>
          <p>{closed.state === 'LOCKED' ? '🔒 ' : ''}{closed.note}</p>
          <Link className="hlt-btn" href={firstOpen}>{t('openItems')}</Link>
        </div>
      ) : !cat ? (
        <HltEmpty msg={t('missing')} href={firstOpen} label={t('openItems')} />
      ) : list === null ? (
        <p className="form-error" role="alert">{tc('loadFailProduct')}</p>
      ) : list.length === 0 ? (
        t.has(`notSoldBy.${code}` as never)
          ? <div className="notice">{t(`notSoldBy.${code}` as never)}</div>
          : <HltEmpty msg={t('empty', { title })} href={firstOpen} label={t('openItems')} />
      ) : (
        <>
          <p className="hint">{t('total', { n: String(list.length) })}</p>
          <ProductGrid list={list} />
          <p className="hint hlt-gap">{t('totalPage', { n: String(list.length) })}</p>
        </>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
