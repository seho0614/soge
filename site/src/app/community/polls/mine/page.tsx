import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { Msgs } from '@/i18n/Msgs';
import { PlazaHero } from '@/components/community/Plaza';
import { MyPollList, type MyPoll } from '@/components/community/MyPollList';
import '@/styles/poll.css';
import '@/styles/plaza.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('plaza'))('pollMine.title') };
}

/**
 * SB-HOM-CMU-042 내 투표 (v10.177 · D166 · docs/275)
 *
 * API: GET /community/my-polls · POST /community/my-polls/{id}/close · DELETE /community/my-polls/{id} (MyPollList)
 * 감춘 투표도 보입니다(신고 3건 · 운영 감춤). 표가 없을 때만 지울 수 있고, 그 밖에는 마감만 됩니다.
 */
export default async function MyPollsPage({ searchParams }: { searchParams: Promise<{ made?: string }> }) {
  const p = await me();
  if (!p) redirect('/login?next=/community/polls/mine');
  const { made } = await searchParams;
  const polls = await apiGetPersonal<MyPoll[]>('/community/my-polls').catch(() => null);
  const t = await getTranslations('plaza');
  return (
    <><div className="plz">
      <PlazaHero small />
      <div className="plz-body" data-screen="SB-HOM-CMU-042">
        <div className="page-head">
          <h1>{t('pollMine.h')}</h1>
          <Link href="/community/polls">{t('pollNew.back')}</Link>
        </div>
        {made && <p className="notice" role="status" data-poll-made="">{t('pollNew.ok')}</p>}
        {polls === null ? <p className="form-error" role="alert">{t('polls.loadFail')}</p>
          : polls.length === 0 ? <p className="empty">{t('pollMine.empty')}</p>
          : <Msgs ns={['plaza']}><MyPollList polls={polls} /></Msgs>}
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
