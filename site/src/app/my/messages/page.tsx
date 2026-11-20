import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';
import { me } from '@/lib/session';
import { Msgs } from '@/i18n/Msgs';
import { MyHead } from '@/components/my/ui';
import { DmStart } from './DmStart';
import '@/styles/mbx.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('mbx.dm'))('title') };
}

interface Th { id: string; basisType: string; status: string; blocked: boolean; blockedByMe: boolean; lastMessageAt: string | null; createdAt: string;
  title: string | null; preview: string | null; unread: number; otherName: string }
const SIDES = ['BUYER', 'SELLER', 'INTRODUCER', 'INITIATOR', 'COUNTERPART'] as const;
type Side = (typeof SIDES)[number];
const sideOf = (s: string): Side => ((SIDES as readonly string[]).includes(s) ? (s as Side) : 'COUNTERPART');
interface Partner { basisType: 'DEAL' | 'INQUIRY'; basisId: string; side: string; title: string | null; otherName: string; threadId: string | null }

/**
 * v10.504 (D273 · docs/642) SB-MYP-MBX-040 회원 대화함
 *   내 대화(상대 김OO · 마지막 글 · 안 읽은 수) · 대화를 열 수 있는 상대(내 거래의 사는 쪽 · 파는 쪽 · 소개자 · 문의 상대).
 *   거래 · 문의가 없는 사람과는 대화를 열 수 없습니다. 스위치(mbx.dm)가 꺼져 있으면 새로 열기 · 보내기를 막습니다(읽기는 됨).
 */
export default async function MessagesPage() {
  if (!(await me())) redirect('/login?next=/my/messages');
  const [list, partners, t] = await Promise.all([
    apiGet<{ enabled: boolean; retentionDays: number; items: Th[] }>('/me/dm', 0).catch(() => ({ enabled: false, retentionDays: 365, items: [] as Th[] })),
    apiGet<{ items: Partner[] }>('/me/dm/partners', 0).catch(() => ({ items: [] as Partner[] })),
    getTranslations('mbx.dm'),
  ]);
  const fresh = partners.items.filter((p) => !p.threadId).slice(0, 30);
  return (
    <div data-screen="SB-MYP-MBX-040">
      <MyHead title={t('title')} sub={t('sub')} />
      {!list.enabled && <p className="mbx-note warn" data-mbx-dm-off="">{t('off')}</p>}
      <p className="mbx-note">{t('notice', { days: String(list.retentionDays) })}</p>
      {list.items.length === 0 ? <div className="mbx-empty" data-mbx-dm-empty="">{t('empty')}</div> : (
        <ul className="mbx-list" data-mbx-dm-list={list.items.length}>
          {list.items.map((x) => (
            <li key={x.id} data-mbx-dm-thread={x.id}>
              <span className="mbx-badge">{x.basisType === 'DEAL' ? t('deal') : t('inquiry')}</span>
              <div className="t">
                <Link href={`/my/messages/${x.id}`}><b>{x.otherName} · {x.title ?? '—'}</b></Link>
                <span className="m">{x.preview ?? t('noMessage')}{x.status === 'LOCKED' ? ` · ${t('locked')}` : ''}{x.blocked ? ` · ${t('blocked')}` : ''}</span>
              </div>
              {x.unread > 0 && <span className="mbx-badge hot">{t('unread', { n: String(x.unread) })}</span>}
            </li>
          ))}
        </ul>
      )}
      <h2 className="mbx-h1 mbx-gap">{t('partnersHead')}</h2>
      {fresh.length === 0 ? <div className="mbx-empty">{t('partnersEmpty')}</div> : (
        <ul className="mbx-list" data-mbx-dm-partners={fresh.length}>
          {fresh.map((p) => (
            <li key={`${p.basisType}:${p.basisId}:${p.side}`}>
              <span className="mbx-badge">{p.basisType === 'DEAL' ? t('deal') : t('inquiry')}</span>
              <div className="t"><b>{p.otherName} · {p.title ?? '—'}</b><span className="m">{t(('side.' + sideOf(p.side)) as `side.${Side}`)}</span></div>
              {list.enabled && <Msgs ns={['mbx']}><DmStart basisType={p.basisType} basisId={p.basisId} side={p.side} /></Msgs>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
