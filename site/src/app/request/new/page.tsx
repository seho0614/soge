import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { BackBar } from '@/components/common/BackBar';
import { RoleTabs } from '@/components/gwan/GwParts';
import type { Cat, Gwan } from '@/components/form/RegParts';
import { RequestForm } from './RequestForm';
import { gradeLabels } from '@/lib/grades';
import { getLocale, getTranslations } from 'next-intl/server';
import { isGwanKey } from '@/i18n/keys';
import { Msgs } from '@/i18n/Msgs';
import '@/styles/proto-w1.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('forms.reqPage'))('title') };
}

const REQ_GWANS = ['MNY', 'MAL', 'BIZ'];

/** SB-HOM-REQ-010 소개받기 등록하기 — v10.31 시안 scReqNew(← 이전 화면 · 3단추 · 안내 · 4구역 폼) */
export default async function NewRequest({ searchParams }: { searchParams: Promise<{ g?: string }> }) {
  const p = await me();
  if (!p) redirect('/login?next=/request/new');
  if (!p.identityVerifiedAt) redirect('/verify?next=/request/new');
  const sp = await searchParams;
  const t = await getTranslations('forms');
  const th = await getTranslations('header');
  const locale = await getLocale();

  const [gw, labels, ...lists] = await Promise.all([
    apiGet<Array<Gwan & { isActive: boolean }>>('/gwans', 300).catch(() => []),
    gradeLabels(),
    ...REQ_GWANS.map((g) => apiGet<Cat[]>(`/categories?gwanCode=${g}`, 300).catch(() => [] as Cat[])),
  ]);
  const gwans = gw.filter((g) => g.isActive && REQ_GWANS.includes(g.code)).map((g) => ({ code: g.code, name: locale !== 'ko' && isGwanKey(g.code) ? th(`gwan.${g.code}`) : g.name }));   // 관 이름 — 한국어는 서버 이름, 다른 언어만 사전(2-2 규칙)
  /* 제한업종(다단계 · 대부 등)은 고르기에서 뺍니다 — 골라 봐야 등록 때 막힙니다 */
  const cats = (lists as Array<Array<Cat & { restrictedCode?: string | null }>>).flat().filter((c) => !c.restrictedCode);

  return (
    <div className="w1 w1-wrap" data-screen="SB-HOM-REQ-010">
      <BackBar href="/request" label={t('common.prev')} wrap={false} />
      <div style={{ marginTop: 12 }}>
        <RoleTabs on="want" note={t('reqPage.note')} />
      </div>
      <Msgs ns={['forms']}><RequestForm gwans={gwans} cats={cats} gradeLabels={labels}
        initialGwan={REQ_GWANS.includes(sp.g ?? '') ? sp.g : undefined} /></Msgs>
    </div>
  );
}
