/** SB-HLT-CAT-040 성분 상세 — v10.26 시안(spec/proto.html SB-HLT-CAT-040) */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiGet, ApiFailure } from '@/lib/api';
import type { HltIngredientDetail } from '@/components/health/types';
import { Crumb, HltEmpty, HltNav, ProductGrid } from '@/components/health/HltParts';
import { IngSort } from '@/components/health/IngSort';
import { krw } from '@/components/health/util';
import { Msgs } from '@/i18n/Msgs';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('hlt');
  return { title: t('meta.title', { title: t('ingredient.title') }) };
}

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ sort?: string; amt?: string }> };

/**
 * 성분 상세 — GET /health/ingredients/{code}?sort= (그 성분이 든 상품 · 그 성분을 많이 찾는 고민).
 *
 * 기본 정렬은 **월 단가 낮은 순**입니다 — 성분 페이지에 온 분은 무엇을 살지는 이미 정하셨고 "얼마인지"를 보러 오셨습니다(시안).
 * 성분군이면 아래 성분의 상품을 모아 보여 드립니다. 함량이 2가지 이상이면 함량 단추로 거릅니다(?amt=).
 * 시안과 다른 곳: 「자격 필요」 표 없음(10/8 B-6) · 리뷰 · 별점 정렬은 v10.27.
 */
export default async function HltIngredientDetail({ params, searchParams }: Props) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  const sp = await searchParams;
  const sort = sp.sort === 'name' || sp.sort === 'NAME' ? 'name' : 'unit';
  const t = await getTranslations('hlt.ingredient');
  const tc = await getTranslations('hlt.common');

  let g: HltIngredientDetail | null = null;
  let missing = false;
  try {
    g = await apiGet<HltIngredientDetail>(`/health/ingredients/${encodeURIComponent(code)}?sort=${sort}`, 60);
  } catch (e) {
    missing = e instanceof ApiFailure && e.status < 500;
  }

  if (!g && !missing) {
    return (
      <><div className="hlt">
        <HltNav on="ing" back="/health/ingredients" />
        <p className="form-error" role="alert">{t('loadFail')}</p>
      </div><i hidden data-root-end="" /></>
    );
  }
  if (!g) {
    return (
      <><div className="hlt">
        <HltNav on="ing" back="/health/ingredients" />
        <Crumb items={[{ href: '/health/ingredients', label: tc('byIng') }, { label: t('missing') }]} />
        <HltEmpty msg={t('missingMsg')} href="/health/ingredients" label={tc('viewByIng')} />
      </div><i hidden data-root-end="" /></>
    );
  }

  const list = g.products;
  const amts = g.amounts ?? [];
  const amt = sp.amt && amts.includes(sp.amt) ? sp.amt : undefined;
  const shown = amt ? list.filter((p) => p.ingAmount === amt) : list;
  const inStock = list.filter((p) => !p.soldOut);
  const enc = encodeURIComponent(g.code);
  const base = `/health/i/${enc}`;
  const href = (a?: string) => {
    const q = new URLSearchParams();
    if (sort !== 'unit') q.set('sort', sort);
    if (a) q.set('amt', a);
    return `${base}${q.size ? `?${q}` : ''}`;
  };

  return (
    <><div className="hlt" data-screen="SB-HLT-CAT-040">
      <HltNav on="ing" back="/health/ingredients" />
      <Crumb items={[{ href: '/health/ingredients', label: tc('byIng') }, { label: g.name }]} />
      <div className="page-head"><h1>{g.name}{g.needsLicense && <> <span className="hlt-bdg st" data-license="">{tc('license')}</span></>}</h1></div>
      {g.aliases && g.aliases.length > 0 && <p className="hint">{t('aliases', { list: g.aliases.join(' · ') })}</p>}
      {g.note && <p className="lead">{g.note}</p>}
      {g.minUnit != null ? (
        <div className="hlt-u26 big" data-unit="1" style={{ marginTop: 8 }}>{t.rich('minMonth', { amt: krw(g.minUnit), n: String(list.length), b: (c) => <b>{c}</b> })}</div>
      ) : inStock.length > 0 ? (
        <p className="hlt-unit">{t.rich('minPrice', { amt: krw(Math.min(...inStock.map((p) => Number(p.price)))), n: String(list.length), b: (c) => <b>{c}</b> })}</p>
      ) : null}

      {g.isGroup && (g.children ?? []).length > 0 && (
        <div className="hlt-chips" data-ing-children>
          <span className="hint">{t('children')}</span>
          {(g.children ?? []).map((c) => <Link key={c.code} className="hlt-chip" href={`/health/i/${encodeURIComponent(c.code)}`}>{c.name}</Link>)}
        </div>
      )}

      {amts.length > 1 && (
        <section className="hlt-sec" data-amounts>
          <h2>{t('amounts')}</h2>
          <div className="hlt-chips">
            <Link className={`hlt-chip${amt ? '' : ' on'}`} href={href()}>{tc('all')}</Link>
            {amts.map((a) => <Link key={a} className={`hlt-chip${amt === a ? ' on' : ''}`} href={href(a)} data-amt={a}>{a}</Link>)}
          </div>
        </section>
      )}

      <div className="hlt-chips" style={{ marginTop: 16 }}>
        <label htmlFor="ingSort" className="hint">{t('sort')}</label>
        <Msgs ns={['hlt']}><IngSort base={base} sort={sort} amt={amt} /></Msgs>
        <span className="hint">{t.rich('sortNote', { b: (c) => <b>{c}</b> })}</span>
      </div>

      <p className="hint" style={{ margin: '14px 0 10px' }}>{tc('count', { n: String(shown.length) })}</p>
      {shown.length === 0
        ? <HltEmpty msg={t('notCarried')} href="/health/ingredients" label={tc('viewByIng')} />
        : <ProductGrid list={shown} />}

      {g.concerns.length > 0 && (
        <section className="hlt-sec">
          <h2>{t('concernsTitle', { name: g.name })}</h2>
          <div className="hlt-chips">
            {g.concerns.map((c) => <Link key={c.code} className="hlt-chip" href={`/health/w/${encodeURIComponent(c.code)}`}>{c.icon} {c.name}</Link>)}
          </div>
          <p className="hint">{t('manyToMany')}</p>
        </section>
      )}
      <p className="hint hlt-gap">
        {t('mfr')}
      </p>
    </div><i hidden data-root-end="" /></>
  );
}
