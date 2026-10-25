/** SB-HLT-ETC-010 이용안내 · 청약철회 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalMarkdown } from '@/components/health/LegalMarkdown';
import { getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';
import type { HltSaleCategory, HltTerm } from '@/components/health/types';
import { Crumb, HltNav, SellerBox } from '@/components/health/HltParts';
import { RETURN_SHIP_ROUND_TRIP, RETURN_WINDOW_DAYS } from '@/components/health/util';
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('hlt');
  return { title: t('meta.title', { title: t('guide.title') }) };
}

/**
 * 이용안내 · 청약철회.
 *
 * 약관 본문은 GET /terms 의 HLT_SALE(건강상품 판매 약관)을 **그대로** 보여 드립니다 —
 * 법정 고지 문구를 화면에 하드코딩하면 고칠 때마다 배포가 필요하고, 그 사이가 곧 위반 기간입니다.
 * 위의 요약 표는 시안의 안내를 약관과 같은 내용으로 줄인 것입니다.
 */
export default async function HltGuide() {
  const [terms, cats] = await Promise.all([
    apiGet<HltTerm[]>('/terms', 300).catch(() => null),
    apiGet<HltSaleCategory[]>('/health/categories', 60).catch(() => [] as HltSaleCategory[]),
  ]);
  const sale = terms?.find((t) => t.code === 'HLT_SALE');
  /* v10.25 (D025) — 팔지 않는 갈래 · 준비 중인 갈래의 안내 글은 서버 값입니다(갈래를 열면 여기서도 사라집니다) */
  const notSold = cats.filter((c) => c.state === 'NOT_SOLD');
  const locked = cats.filter((c) => c.state === 'LOCKED');
  const t = await getTranslations('hlt.guide');
  const f = await getFmt();

  return (
    <><div className="hlt">
      <HltNav on="guide" />
      <Crumb items={[{ label: t('title') }]} />
      <div className="page-head"><h1>{t('title')}</h1></div>

      <section className="hlt-box">
        <h3>{t('whatTitle')}</h3>
        <p>
          {t.rich('whatBody', { b: (c) => <b>{c}</b> })}
        </p>
      </section>

      <section className="hlt-box">
        <h3>{t('wdTitle')}</h3>
        <table className="tbl hlt-tbl">
          <tbody>
            <tr><th>{t('period')}</th><td>{t('periodVal', { days: String(RETURN_WINDOW_DAYS) })}</td></tr>
            <tr><th>{t('preShip')}</th><td>{t('preShipVal')}</td></tr>
            <tr><th>{t('postShip')}</th><td>{t('postShipVal')}</td></tr>
            <tr><th>{t('change')}</th><td>{t('changeVal', { amt: f.won(RETURN_SHIP_ROUND_TRIP, '-') })}</td></tr>
            <tr><th>{t('defect')}</th><td>{t('defectVal')}</td></tr>
            <tr><th>{t('blocked')}</th><td>{t('blockedVal')}</td></tr>
            <tr><th>{t('refund')}</th><td>{t('refundVal')}</td></tr>
          </tbody>
        </table>
        <div className="hlt-btns">
          <Link className="hlt-btn" href="/my/health/returns/new">{t('returnBtn')}</Link>
          <Link className="hlt-btn" href="/my/health/orders">{t('ordersBtn')}</Link>
        </div>
      </section>

      <section className="hlt-box">
        <h3>{t('shipTitle')}</h3>
        <p>{t.rich('shipBody', { b: (c) => <b>{c}</b> })}</p>
      </section>

      <section className="hlt-box" id="not-sold">
        <h3>{t('notSoldTitle')}</h3>
        <table className="tbl hlt-tbl">
          <tbody>
            <tr><th>{t('drug')}</th><td>{t('drugVal')}</td></tr>
            {notSold.map((c) => <tr key={c.code}><th>{c.name}</th><td>{c.note}</td></tr>)}
            <tr><th>{t('medSvc')}</th><td>{t('medSvcVal')}</td></tr>
          </tbody>
        </table>
        {locked.map((c) => <p key={c.code} className="hint">🔒 {c.note}</p>)}
      </section>

      <section className="hlt-box">
        <h3>{t('adTitle')}</h3>
        <p>
          {t('adBody')}
        </p>
      </section>

      <SellerBox />

      <article className="doc hlt-gap">
        {sale ? (
          <>
            <h1>{sale.title}</h1>
            <p className="doc-meta">{t.rich('version', { v: String(sale.version), link: (c) => <Link href="/terms/HLT_SALE">{c}</Link> })}</p>
            {/* v10.31 (결함-중) — 마크다운 기호를 그대로 보이던 것을 그려서 보입니다(글은 DB 약관 그대로) */}
            <LegalMarkdown body={sale.body} className="doc-body hlt-legal-md" />
          </>
        ) : terms === null ? (
          <p className="form-error" role="alert">{t('termsFail')}</p>
        ) : (
          <p className="stub-note">{t('termsNone')}</p>
        )}
      </article>
    </div><i hidden data-root-end="" /></>
  );
}
