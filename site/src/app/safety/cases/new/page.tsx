import type { Metadata } from 'next';
import { apiGet } from '@/lib/api';
import { me } from '@/lib/session';
import { BackBar } from '@/components/common/BackBar';
import type { MarketRegions } from '@/components/market/types';
import { SafetyCaseForm } from '@/components/gwan/SafetyCaseForm';
import Link from 'next/link';
import { Msgs } from '@/i18n/Msgs';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('plaza'))('cases.newTitle') };
}

/**
 * v10.31 (w2) — 사고예방 「✏ 피해 사례 작성하기」(시안 scSafe 게시판의 단추). POST /safety/cases.
 *   본인인증 회원 · 하루 3건 · 연락처 · 이메일 · 계좌번호는 서버가 저장 전에 가립니다 · 작성자는 공개하지 않습니다.
 */
export default async function Page() {
  const [viewer, regions] = await Promise.all([me().catch(() => null), apiGet<MarketRegions>('/market/regions', 300).catch(() => null)]);
  const t = await getTranslations('plaza.cases');
  const g0 = await getTranslations('gwan');
  return (
    <><div className="gw" data-gw="MNY">
      <div className="gw-wrap" style={{ paddingTop: 16 }}><BackBar href="/money/verified#cases" label={g0('qm.verified')} wrap={false} /></div>
      <div className="gw-wrap" style={{ paddingTop: 14, paddingBottom: 20 }}>
        <div className="gw-panel" style={{ padding: '22px 24px' }}>
          <h1 className="gw-dtt" style={{ margin: '0 0 4px' }}>{t('newH')}</h1>
          <p className="gw-ls" style={{ margin: '0 0 14px' }}>{t('newLead')}</p>
          {!viewer ? (
            <p className="gw-axempty">{t.rich('newLogin', { b: (c) => <b>{c}</b> })} <Link className="gw-bo gw-sm" href="/login?next=/safety/cases/new">{t('login')}</Link></p>
          ) : <Msgs ns={['detail']}><SafetyCaseForm regions={regions?.all ?? []} /></Msgs>}
        </div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
