import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGetVisitor } from '@/lib/api';
import type { Poll } from '@/components/community/poll';
import { PollList } from '@/components/community/PollList';
import { PlazaHero, PlazaTabs } from '@/components/community/Plaza';
import '@/styles/poll.css';
import '@/styles/plaza.css';

export const metadata: Metadata = { title: '이건 어때? · 소개광장' };

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

  return (
    <><div className="plz">
      <PlazaHero small />
      <div className="plz-body">
      <PlazaTabs cur="polls" />
      <div className="page-head">
        <h1>이건 어때?</h1>
        <Link href="/community">소개광장으로</Link>
      </div>
      <p className="lead">여러분의 의견을 알려 주세요. 실제 사용자들의 생각이 더 나은 선택을 만듭니다.</p>
      <div className="notice">
        <b>로그인 없이 투표하실 수 있습니다.</b> 한 사람이 한 번만 투표할 수 있고, 넣은 표는 바꿀 수 없습니다.
        결과는 투표한 뒤에 보입니다. 참여 수는 <b>실제로 투표한 수</b>입니다.
      </div>

      {polls === null ? (
        <p className="form-error" role="alert">투표를 불러오지 못했습니다. 잠시 후 새로고침해 주십시오.</p>
      ) : polls.length === 0 ? (
        <p className="empty">지금 열린 투표가 없습니다. 곧 새 투표가 올라옵니다.</p>
      ) : (
        <>
          <p className="dim" data-poll-count={polls.length}>진행 중 {open}건 · 마감 {polls.length - open}건</p>
          <PollList polls={polls} />
        </>
      )}
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
