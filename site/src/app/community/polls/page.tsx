import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { apiGetVisitor } from '@/lib/api';
import { Msgs } from '@/i18n/Msgs';
import type { Poll } from '@/components/community/poll';
import { PollList } from '@/components/community/PollList';
import { PlazaHero, PlazaTabs } from '@/components/community/Plaza';
import '@/styles/poll.css';
import '@/styles/plaza.css';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('plaza'))('polls.title') };
}

/**
 * SB-HOM-CMU-040 소개광장 「이건 어때?」 투표 — GET /community/polls · POST /community/polls/{id}/vote (D021)
 *
 * 메인 「이건 어때?」의 「전체보기」가 여기로 옵니다. 열린 투표가 먼저, 마감된 투표가 뒤에 나옵니다.
 * ★ apiGetVisitor 입니다 — 「내가 고른 보기」가 사람(계정 · 방문자 쿠키)마다 달라 캐시하면 안 됩니다.
 * 비로그인도 투표합니다(사장님 결정 2026-10-02). 투표를 만드는 것은 운영 화면 「투표 관리」에서 합니다.
 */
export default async function PollsPage() {
  const polls = await apiGetVisitor<Poll[]>('/community/polls').catch(() => null);
  const open = polls?.filter((p) => p.open).length ?? 0;
  const t = await getTranslations('plaza.polls');

  return (
    <><div className="plz">
      <PlazaHero small />
      <div className="plz-body">
      <PlazaTabs cur="polls" />
      <div className="page-head">
        <h1>{t('h')}</h1>
        <Link href="/community">{t('toPlaza')}</Link>
      </div>
      <p className="lead">{t('lead')}</p>
      <div className="notice">
        {t.rich('notice', { b: (c) => <b>{c}</b> })}
      </div>

      {polls === null ? (
        <p className="form-error" role="alert">{t('loadFail')}</p>
      ) : polls.length === 0 ? (
        <p className="empty">{t('empty')}</p>
      ) : (
        <>
          <p className="dim" data-poll-count={polls.length}>{t('count', { open: String(open), closed: String(polls.length - open) })}</p>
          <Msgs ns={['plaza']}><PollList polls={polls} /></Msgs>
        </>
      )}
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
