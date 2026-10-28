import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { EsignMockSign } from '@/components/EsignMockSign';
import '@/styles/proto-w1.css';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('myDeal.esignMock'))('title'), robots: { index: false } };
}

type Q = { deal?: string; role?: string };

/** v10.143 (D139 · docs/217) — SB-MYP-CTR-020 안 · 가짜 전자서명 화면(점검판 MOCK 전용 · 운영에서는 서버가 403) */
export default async function EsignMockSignPage({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const t = await getTranslations('myDeal.esignMock');
  const deal = typeof q.deal === 'string' && /^[0-9a-f-]{36}$/i.test(q.deal) ? q.deal : '';
  if (!(await me())) redirect(`/login?next=${encodeURIComponent(`/contract/mock-sign?deal=${deal}`)}`);
  return (
    <div className="w1 w1-wrap w1-vfy auth-wrap" data-screen="SB-MYP-CTR-020">
      <div className="w1-aih"><h1>{t('title')}</h1></div>
      <Msgs ns={['myDeal']}><EsignMockSign dealId={deal} /></Msgs>
    </div>
  );
}
