import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { me } from '@/lib/session';
import { apiGetPersonal } from '@/lib/api';
import { Msgs } from '@/i18n/Msgs';
import { PlazaHero } from '@/components/community/Plaza';
import { PollCreateForm, type PollReady } from '@/components/community/PollCreateForm';
import '@/styles/poll.css';
import '@/styles/plaza.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('plaza'))('pollNew.title') };
}

/**
 * SB-HOM-CMU-041 소개광장 투표 만들기 (v10.177 · D166 · docs/275)
 *
 * API: GET /community/my-polls/ready · POST /community/my-polls (PollCreateForm)
 * 회원이 「궁금해요」 · 「써본 의견」 투표를 만듭니다. 막는 것은 DB(fn_poll_member_guard) — 여기서는 못 만드는 까닭을 먼저 보여 줄 뿐입니다.
 */
export default async function PollNewPage() {
  const p = await me();
  if (!p) redirect('/login?next=/community/polls/new');
  const ready = await apiGetPersonal<PollReady>('/community/my-polls/ready').catch(() => null);
  const t = await getTranslations('plaza.pollNew');
  const why = !ready ? t('fail')
    : ready.reason === 'OFF' ? t('off')
    : ready.reason === 'LOGIN' ? t('login')
    : ready.reason === 'NEW' ? t('new', { h: String(ready.minAgeHours) })
    : ready.reason === 'LIMIT' ? t('limit', { n: String(ready.dailyLimit) })
    : null;
  return (
    <><div className="plz">
      <PlazaHero small />
      <div className="plz-body" data-screen="SB-HOM-CMU-041">
        <div className="page-head">
          <h1>{t('h')}</h1>
          <Link href="/community/polls">{t('back')}</Link>
        </div>
        <p className="lead">{t('lead')}</p>
        {why ? <p className="notice" role="alert" data-poll-ready={ready?.reason ?? 'ERR'}>{why}</p>
          : <Msgs ns={['plaza']}><PollCreateForm ready={ready!} /></Msgs>}
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
