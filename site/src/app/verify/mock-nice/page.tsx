import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { VerifyMockNice } from '@/components/VerifyMockNice';
import '@/styles/proto-w1.css';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('join.verifyMock'))('title'), robots: { index: false } };
}

type Q = { token_version_id?: string; enc_data?: string; integrity_value?: string };

/** v10.141 (D137 · docs/214) — SB-HOM-AUT-030 안 · 가짜 표준창(점검판 MOCK 전용 · 운영에서는 서버가 403) */
export default async function VerifyMockNicePage({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const t = await getTranslations('join.verifyMock');
  if (!(await me())) redirect('/login');
  const one = (v?: string) => (typeof v === 'string' ? v.slice(0, 8000) : '');
  return (
    <div className="w1 w1-wrap w1-vfy auth-wrap" data-screen="SB-HOM-AUT-030">
      <div className="w1-aih"><h1>{t('title')}</h1></div>
      <Msgs ns={['join']}><VerifyMockNice fields={{ token_version_id: one(q.token_version_id), enc_data: one(q.enc_data), integrity_value: one(q.integrity_value) }} /></Msgs>
    </div>
  );
}
