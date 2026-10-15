import type { Metadata } from 'next';
import Link from 'next/link';
import { ymdKst } from '@/lib/format';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { MyHead, Note, Empty, Table } from '@/components/my/ui';

export const metadata: Metadata = { title: '내 이벤트 참여' };

interface J {
  code: string; title: string; benefit: string; endsAt: string;
  joinedAt: string; grantedAt?: string; grantNote?: string;
}

/**
 * SB-MYP-EVT-010 내 이벤트 참여
 *
 * 받았는지 못 받았는지 **여기서 알 수 있어야** 합니다.
 * v10.29 — 시안(scMyEvt) 배치: 표(이벤트 · 혜택 · 상태 · 참여) → 안내.
 */
export default async function MyEventsPage() {
  const p = await me();
  if (!p) redirect('/login');

  const rows = await apiGet<J[]>('/me/events', 0).catch(() => [] as J[]);
  const waiting = rows.filter((r) => !r.grantedAt).length;

  return (
    <>
      <MyHead title="내 이벤트 참여"
        sub={waiting > 0 ? `참여하신 이벤트와 지급 상태입니다. 확인 중인 참여가 ${waiting}건 있습니다.` : '참여하신 이벤트와 지급 상태입니다.'} />
      {rows.length === 0 ? (
        <Empty>참여하신 이벤트가 없습니다. <Link href="/money/event">진행 중인 이벤트 보기 ›</Link></Empty>
      ) : (
        <Table head={['이벤트', '혜택', '상태', '참여']}>
          {rows.map((r) => (
            <tr key={r.code}>
              <td><b>{r.title}</b></td>
              <td>{r.benefit}</td>
              <td>
                {r.grantedAt
                  ? <><span className="my-bg ok">지급됨</span>{r.grantNote ? <span className="my-ls blk">{r.grantNote}</span> : null}</>
                  : <span className="my-bg wait">확인 중</span>}
              </td>
              <td>{ymdKst(r.joinedAt)}</td>
            </tr>
          ))}
        </Table>
      )}
      <Note kind="info"><b>참여하셨다고 바로 받으시는 것은 아닙니다.</b> 운영이 확인한 뒤 드리며, 드린 뒤에는 알림이 갑니다.</Note>
    </>
  );
}
