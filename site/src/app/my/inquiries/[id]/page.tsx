import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { me } from '@/lib/session';
import { ChatPanel } from '@/components/ChatPanel';
import { GWAN_PATH } from '@/lib/format';
import { MyHead } from '@/components/my/ui';

export const metadata: Metadata = { title: '1:1 대화' };

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

  return (
    <><div data-inq-room={c.id}>
      {/* v10.29 — 나의공간 틀 안에서 시안 머리 모양으로. 대화(ChatPanel)는 그대로 */}
      <MyHead title={c.title ?? '(삭제된 대상)'}
        sub={<>
          {c.role === 'RECEIVED' ? '문의한 분' : '받는 분'} {c.counterpartName}
          {c.targetType === 'LISTING' && <> · <Link href={`/${GWAN_PATH[c.gwanCode ?? ''] ?? 'money'}/${c.targetId}`}>매물 보기</Link></>}
          {c.dealId && <> · <Link href={`/deal/${c.dealId}/contract`} data-inq-deal={c.dealId}>거래 보기</Link></>}
        </>}
        right={<Link className="my-bo" href={`/my/inquiries?tab=${c.role === 'SENT' ? 'sent' : 'received'}`}>‹ {c.role === 'SENT' ? '보낸 문의' : '받은 문의'}</Link>} />
      <ChatPanel conversationId={c.id} />
    </div><i hidden data-root-end="" /></>
  );
}
