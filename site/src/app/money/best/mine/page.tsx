import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { BackBar } from '@/components/common/BackBar';
import { GwFrame } from '@/components/gwan/GwParts';
import { StoryConsent } from '@/components/gwan/StoryConsent';
import { Msgs } from '@/i18n/Msgs';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('plaza'))('mine.title') };
}

interface Mine { id: string; headline: string; status: string; title: string; side: 'SELLER' | 'BUYER'; consentAt: string | null; sellerComment: string | null; sellerRating: number | null }

/**
 * v10.31 (w2) — 베스트매칭 사례 공개 동의(내가 거래 당사자인 사례). GET /me/success-stories · POST /market/success-stories/{id}/consent
 *   두 당사자가 모두 동의해야 공개됩니다 · 매도자는 한마디 · 별점을 함께 남깁니다 · 철회하면 공개 중인 사례를 내립니다.
 */
export default async function Page() {
  const viewer = await me().catch(() => null);
  const rows = viewer ? await apiGetPersonal<Mine[]>('/me/success-stories').catch(() => [] as Mine[]) : [];
  const t = await getTranslations('plaza.mine');
  const g0 = await getTranslations('gwan');
  return (
    <><GwFrame code="MNY">
      <div className="gw-wrap" style={{ paddingTop: 16 }}><BackBar href="/money/best" label={g0('qm.best')} wrap={false} /></div>
      <div className="gw-wrap" style={{ paddingTop: 14, paddingBottom: 20 }}>
        <div className="gw-panel" style={{ padding: '22px 24px' }}>
          <h1 className="gw-dtt" style={{ margin: '0 0 4px' }}>{t('h')}</h1>
          <p className="gw-ls" style={{ margin: '0 0 14px' }}>{t('lead')}</p>
          {!viewer ? <p className="gw-axempty"><b>{t('loginNeed')}</b><Link className="gw-bo gw-sm" href="/login?next=/money/best/mine">{t('login')}</Link></p>
            : rows.length === 0 ? <p className="gw-axempty">{t.rich('empty', { b: (c) => <b>{c}</b> })}</p>
            : <Msgs ns={['detail']}><div className="gw-axrows">{rows.map((r) => <StoryConsent key={r.id} row={r} />)}</div></Msgs>}
        </div>
      </div>
    </GwFrame><i hidden data-root-end="" /></>
  );
}
