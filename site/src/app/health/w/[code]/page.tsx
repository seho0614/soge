/** SB-HLT-CAT-060 고민 상세 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiGet, ApiFailure } from '@/lib/api';
import type { HltConcernDetail } from '@/components/health/types';
import { Crumb, HltEmpty, HltNav, ProductGrid } from '@/components/health/HltParts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('hlt');
  return { title: t('meta.title', { title: t('concern.title') }) };
}

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ ing?: string }> };

/**
 * 고민 상세 — GET /health/concerns/{code}. 성분 칩으로 좁힙니다.
 * 상품마다 든 성분 코드가 함께 와서 칩 선택은 받은 목록 안에서 거릅니다.
 */
export default async function HltConcernDetail({ params, searchParams }: Props) {
  const { code } = await params;
  const pick = (await searchParams).ing;
  const t = await getTranslations('hlt.concern');
  const tc = await getTranslations('hlt.common');

  let c: HltConcernDetail | null = null;
  let missing = false;
  try {
    c = await apiGet<HltConcernDetail>(`/health/concerns/${encodeURIComponent(decodeURIComponent(code))}`, 60);
  } catch (e) {
    missing = e instanceof ApiFailure && e.status < 500;
  }

  if (!c && missing) {
    return (
      <><div className="hlt">
        <HltNav on="concern" back="/health/concerns" />
        <Crumb items={[{ href: '/health/concerns', label: tc('byConcern') }, { label: t('missing') }]} />
        <HltEmpty msg={t('missingMsg')} href="/health/concerns" label={tc('viewByConcern')} />
      </div><i hidden data-root-end="" /></>
    );
  }
  if (!c) {
    return (
      <><div className="hlt">
        <HltNav on="concern" back="/health/concerns" />
        <p className="form-error" role="alert">{tc('loadFailProduct')}</p>
      </div><i hidden data-root-end="" /></>
    );
  }

  const list = pick ? c.products.filter((p) => p.ingredients.includes(pick)) : c.products;

  return (
    <><div className="hlt">
      <HltNav on="concern" back="/health/concerns" />
      <Crumb items={[{ href: '/health/concerns', label: tc('byConcern') }, { label: c.name }]} />
      <div className="page-head"><h1>{c.icon} {c.name}</h1></div>
      <p className="hint">{t.rich('hint', { name: c.name, b: (c) => <b>{c}</b> })}</p>
      {c.note && <p className="lead">{c.note}</p>}

      <section className="hlt-sec">
        <h2>{t('pickIng')}</h2>
        <div className="hlt-chips">
          <Link className={`hlt-chip${pick ? '' : ' on'}`} href={`/health/w/${encodeURIComponent(c.code)}`}>{tc('all')}</Link>
          {c.ingredients.map((g) => (g.productCount
            ? <Link key={g.code} className={`hlt-chip${pick === g.code ? ' on' : ''}`}
                href={`/health/w/${encodeURIComponent(c!.code)}?ing=${encodeURIComponent(g.code)}`}>{g.name} <span className="hint">{g.productCount}</span></Link>
            : <span key={g.code} className="hlt-chip lock" aria-disabled="true"
                title={g.locked ? t('lockedTitle') : tc('preparing')}>{g.name} 🔒</span>))}
        </div>
      </section>

      <p className="hint">{tc('count', { n: String(list.length) })}</p>
      {list.length === 0
        ? <HltEmpty msg={t('empty')} href="/health/concerns" label={tc('viewByConcern')} />
        : <ProductGrid list={list} />}

      <div className="notice hlt-gap">
        {tc('notMedicine')}
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
