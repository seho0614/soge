import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiGet, ApiFailure } from '@/lib/api';
import { me } from '@/lib/session';
import { Msgs } from '@/i18n/Msgs';
import { BackBar } from '@/components/common/BackBar';
import { DmRoom, type DmThread } from './DmRoom';
import '@/styles/mbx.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('mbx.dm'))('title') };
}
type Props = { params: Promise<{ id: string }> };

/**
 * v10.504 (D273 · docs/642) SB-MYP-MBX-050 회원 대화
 *   글만 · 보내기 전 연락처 · 계좌 · 메일 · 플랫폼 밖 거래 표현 경고(「고치겠습니다 · 그래도 보내기」) · 차단 · 신고.
 *   대금은 거래 화면의 절차로 — 플랫폼은 대금을 맡지 않고(INV-11) 소개비를 대금에서 빼지 않습니다(INV-9).
 */
export default async function DmRoomPage({ params }: Props) {
  const { id } = await params;
  if (!(await me())) redirect(`/login?next=/my/messages/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let th: DmThread;
  try {
    th = await apiGet<DmThread>(`/me/dm/${id}`, 0);
  } catch (e) {
    if (e instanceof ApiFailure && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const t = await getTranslations('mbx.dm');
  return (
    <div data-screen="SB-MYP-MBX-050">
      <BackBar href="/my/messages" label={t('back')} wrap={false} />
      <Msgs ns={['mbx']}><DmRoom initial={th} /></Msgs>
    </div>
  );
}
