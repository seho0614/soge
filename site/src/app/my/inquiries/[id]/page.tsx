import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { me } from '@/lib/session';
import { ChatPanel } from '@/components/ChatPanel';
import { GWAN_PATH } from '@/lib/format';
import { MyHead } from '@/components/my/ui';
import { getTranslations } from 'next-intl/server';
import { Msgs } from '@/i18n/Msgs';   // v10.101 — 아래 부품이 쓰는 사전 묶음(deal · docs/159)

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.inq'))('roomTitle') };
}

interface Conv {
  id: string; targetType: string; targetId: string; role: 'SENT' | 'RECEIVED';
  title: string | null; gwanCode: string | null; counterpartName: string; dealId: string | null;
}

/** v10.27 (G-193 ②) — 받은 문의에 답하는 자리. 당사자가 아니면 목록이 비어 404 입니다. */
export default async function InquiryRoom({ params }: { params: Promise<{ id: string }> }) {
  if (!(await me())) redirect('/login');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const list = await apiGet<Conv[]>(`/me/conversations?id=${id}`, 0).catch(() => [] as Conv[]);
  const c = list[0];
  if (!c) notFound();
  const t = await getTranslations('my.inq');

  return (
    <><div data-inq-room={c.id}>
      {/* v10.29 — 나의공간 틀 안에서 시안 머리 모양으로. 대화(ChatPanel)는 그대로 */}
      <MyHead title={c.title ?? t('deleted')}
        sub={<>
          {c.role === 'RECEIVED' ? t('asker') : t('receiver')} {c.counterpartName}
          {c.targetType === 'LISTING' && <> · <Link href={`/${GWAN_PATH[c.gwanCode ?? ''] ?? 'money'}/${c.targetId}`}>{t('viewListing')}</Link></>}
          {c.dealId && <> · <Link href={`/deal/${c.dealId}/contract`} data-inq-deal={c.dealId}>{t('viewDeal')}</Link></>}
        </>}
        right={<Link className="my-bo" href={`/my/inquiries?tab=${c.role === 'SENT' ? 'sent' : 'received'}`}>‹ {c.role === 'SENT' ? t('sent') : t('received')}</Link>} />
      <Msgs ns={['deal']}><ChatPanel conversationId={c.id} /></Msgs>
    </div><i hidden data-root-end="" /></>
  );
}
