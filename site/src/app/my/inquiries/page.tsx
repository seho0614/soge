import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { me } from '@/lib/session';
import { ago } from '@/lib/format';
import { MyHead, Tabs, Note, Empty } from '@/components/my/ui';
import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('my.inq'))('title') };
}

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
  const t = await getTranslations('my.inq');
  const f = await getFmt();
  return (
    <><div data-inquiries={tab}>
      {/* v10.29 — 나의공간 틀 안에서 시안 모양(머리 · 탭 · 행)으로. 기능(받은/보낸 · 매물별 거르기 · 대화 열기)은 그대로 */}
      <MyHead title={t('title')}
        sub={t('sub')} />

      <Tabs label={t('tabsAria')} cur={tab} items={[
        { k: 'received', t: t('received'), n: rcv.length, href: `/my/inquiries?tab=received${q}`, data: 'received',
          extra: unreadR > 0 ? <span className="my-dot" title={t('unread')}>{unreadR}</span> : undefined },
        { k: 'sent', t: t('sent'), n: snt.length, href: `/my/inquiries?tab=sent${q}`, data: 'sent',
          extra: unreadS > 0 ? <span className="my-dot" title={t('unread')}>{unreadS}</span> : undefined },
      ]} />

      {listing && (
        <Note kind="info" data-inq-filter="">
          {t('filtered')} <Link href={`/my/inquiries?tab=${tab}`}>{t('all')}</Link>
        </Note>
      )}

      {rows.length === 0 ? (
        <Empty>{tab === 'received' ? t('emptyReceived') : t('emptySent')}</Empty>
      ) : (
        <div>
          {rows.map((c) => (
            <div key={c.id} className="my-lrow" data-inq-row={c.id}>
              <div className="my-lt">
                <div className="my-lh">
                  {c.unread > 0 && <span className="my-bg no" title={t('unread')}>{t('newN', { n: String(c.unread) })}</span>}
                  {c.targetStatus && c.targetStatus !== 'PUBLISHED' && <span className="my-ck">{t('notPublished')}</span>}
                  <span className="my-ck">{tab === 'received' ? t('asker') : t('receiver')} {c.counterpartName}</span>
                </div>
                <Link className="my-lnk" href={`/my/inquiries/${c.id}`}>{c.title ?? t('deleted')}</Link>
                <span className="my-ls blk">{c.lastMine ? t('me') : `${c.counterpartName}: `}{c.lastBody ?? ''}</span>
              </div>
              <div className="my-lstat"><span>{f.ago(c.lastAt ?? c.createdAt, ago(c.lastAt ?? c.createdAt))}</span></div>
              <div className="my-lact">
                <Link className="my-bp sm" href={`/my/inquiries/${c.id}`}>{t('open')}</Link>
                {c.dealId && <Link className="my-bo sm" href={`/deal/${c.dealId}/contract`} data-inq-deal={c.dealId}>{t('viewDeal')}</Link>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div><i hidden data-root-end="" /></>
  );
}
