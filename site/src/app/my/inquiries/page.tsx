import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { me } from '@/lib/session';
import { ago } from '@/lib/format';
import { MyHead, Tabs, Note, Empty } from '@/components/my/ui';

export const metadata: Metadata = { title: '문의 · 대화' };

interface Conv {
  id: string; targetType: string; targetId: string; role: 'SENT' | 'RECEIVED';
  title: string | null; targetStatus: string | null; counterpartName: string;
  lastBody: string | null; lastAt: string | null; lastMine: boolean | null;
  unread: number; dealId: string | null; dealStatus: string | null; createdAt: string;
}

/**
 * v10.27 (G-193 ②) — 받은 문의함.
 * 전에는 문의를 보내기만 하고, 매물 주인이 받은 문의를 볼 곳이 없었습니다(API 도 없었음).
 * 받은 문의 · 보낸 문의 두 칸으로 나누고, 매물별로 거를 수 있습니다(?listing=).
 */
export default async function MyInquiries({ searchParams }: { searchParams: Promise<{ tab?: string; listing?: string }> }) {
  if (!(await me())) redirect('/login');
  const sp = await searchParams;
  const tab = sp.tab === 'sent' ? 'sent' : 'received';
  const listing = sp.listing && /^[0-9a-f-]{36}$/i.test(sp.listing) ? sp.listing : null;
  const qs = `role=${tab === 'sent' ? 'SENT' : 'RECEIVED'}${listing ? `&listingId=${listing}` : ''}&limit=100`;
  const [rows, rcv, snt] = await Promise.all([
    apiGet<Conv[]>(`/me/conversations?${qs}`, 0).catch(() => [] as Conv[]),
    apiGet<Conv[]>('/me/conversations?role=RECEIVED&limit=100', 0).catch(() => [] as Conv[]),
    apiGet<Conv[]>('/me/conversations?role=SENT&limit=100', 0).catch(() => [] as Conv[]),
  ]);
  const unreadR = rcv.reduce((n, c) => n + (c.unread || 0), 0);
  const unreadS = snt.reduce((n, c) => n + (c.unread || 0), 0);

  const q = listing ? `&listing=${listing}` : '';
  return (
    <><div data-inquiries={tab}>
      {/* v10.29 — 나의공간 틀 안에서 시안 모양(머리 · 탭 · 행)으로. 기능(받은/보낸 · 매물별 거르기 · 대화 열기)은 그대로 */}
      <MyHead title="문의 · 대화"
        sub="1:1 대화는 플랫폼 안에서만 이어집니다 — 연락처를 적으면 가려집니다. 조건이 맞으면 대화 안에서 「계약서 요청하기」로 거래를 엽니다." />

      <Tabs label="문의 구분" cur={tab} items={[
        { k: 'received', t: '받은 문의', n: rcv.length, href: `/my/inquiries?tab=received${q}`, data: 'received',
          extra: unreadR > 0 ? <span className="my-dot" title="안 읽음">{unreadR}</span> : undefined },
        { k: 'sent', t: '보낸 문의', n: snt.length, href: `/my/inquiries?tab=sent${q}`, data: 'sent',
          extra: unreadS > 0 ? <span className="my-dot" title="안 읽음">{unreadS}</span> : undefined },
      ]} />

      {listing && (
        <Note kind="info" data-inq-filter="">
          매물 한 건의 문의만 보고 있습니다. <Link href={`/my/inquiries?tab=${tab}`}>전체 보기</Link>
        </Note>
      )}

      {rows.length === 0 ? (
        <Empty>{tab === 'received' ? '받은 문의가 없습니다.' : '보낸 문의가 없습니다.'}</Empty>
      ) : (
        <div>
          {rows.map((c) => (
            <div key={c.id} className="my-lrow" data-inq-row={c.id}>
              <div className="my-lt">
                <div className="my-lh">
                  {c.unread > 0 && <span className="my-bg no" title="안 읽음">새 {c.unread}</span>}
                  {c.targetStatus && c.targetStatus !== 'PUBLISHED' && <span className="my-ck">대상이 게시 중이 아님</span>}
                  <span className="my-ck">{tab === 'received' ? '문의한 분' : '받는 분'} {c.counterpartName}</span>
                </div>
                <Link className="my-lnk" href={`/my/inquiries/${c.id}`}>{c.title ?? '(삭제된 대상)'}</Link>
                <span className="my-ls blk">{c.lastMine ? '나: ' : `${c.counterpartName}: `}{c.lastBody ?? ''}</span>
              </div>
              <div className="my-lstat"><span>{ago(c.lastAt ?? c.createdAt)}</span></div>
              <div className="my-lact">
                <Link className="my-bp sm" href={`/my/inquiries/${c.id}`}>대화 열기</Link>
                {c.dealId && <Link className="my-bo sm" href={`/deal/${c.dealId}/contract`} data-inq-deal={c.dealId}>거래 보기</Link>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
