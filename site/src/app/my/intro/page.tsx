import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { MyHead, Note, GwanTag } from '@/components/my/ui';
import { IntroAnswer } from '@/components/my/IntroAnswer';
import { IntroProfileChips } from '@/components/my/IntroProfileChips';

export const metadata: Metadata = { title: '소개 활동' };

interface Act {
  registered?: boolean; note?: string;
  grade?: string; responses?: number; invitesSent?: number;
  invitesConsented?: number; validConnections?: number;
  consentRate?: string | number | null; avgRating?: string | number | null;
  /* v10.31 — 등급 이름 · 다음 등급 조건(시안 「유효 연결 3건이면 전문 소개자」) */
  gradeLabel?: string; nextGrade?: string | null;
}
/** v10.31 — 답한 요청(시안 「제가 알아요 · 초대 발송」 표시 · 초대 현황) */
interface Answered { requestId: string; title: string; gwan?: string; category?: string | null; body?: string; createdAt?: string; answerLabel: string; answer: string; invites: number; respondedAt: string }
interface Profile { registered: boolean; categories: { code: string; name: string }[]; regions: { code: string; name: string }[] }
/** GET /me/introducer/matched → { items: [{ requestId, title, gwan, categoryId, closesAt }], note }
 *  v10.29 — 전에는 화면이 id · summary · gwanName 을 읽어 제목이 빈 줄로 나왔습니다(서버 이름과 다름). 둘 다 받습니다. */
interface Matched { requestId?: string; id?: string; title?: string; summary?: string; gwan?: string; gwanName?: string; closesAt?: string | null; postedAt?: string;
  /* v10.31 — 업종 · 본문 · 올린 때 · 급구(마감 3일 안) · 지역(요청에 지역 칸이 없어 null) */
  category?: string | null; body?: string; createdAt?: string; urgent?: boolean; region?: string | null }

/**
 * SB-MYP-INT-010 소개자 홈
 *
 * 소개자는 **다음에 무엇을 할지** 보러 옵니다. 맞는 요청을 먼저 보여 줍니다.
 * v10.29 — 시안(scIntroHome) 배치: 등급 · 유효 연결 한 줄(활동 내역 단추) → 등급 기준 안내 → 내게 맞는 요청(응답 단추 4개)
 *   → 개발에만 있던 할 일 바로가기 · 소개코드 안내.
 *   v10.31 — 등급 상자의 「다음 등급 조건」(서버 nextGrade) · 요청 카드의 업종 · 올린 때 · 본문 · 급구 · 답한 요청(제가 알아요 · 초대 현황) ·
 *   「내 소개 분야 · 지역」 칩과 「+ 분야 추가 · + 지역 추가」(GET · PATCH /me/introducer/profile)를 그립니다.
 */
export default async function IntroHome() {
  const p = await me();
  if (!p) redirect('/login');

  const [act, matchedRes, prof] = await Promise.all([
    apiGet<Act>('/me/introducer/activity', 0).catch(() => null),
    apiGet<{ items?: Matched[]; answered?: Answered[]; note?: string | null } | Matched[]>('/me/introducer/matched', 0).catch(() => null),
    apiGet<Profile>('/me/introducer/profile', 0).catch(() => null),
  ]);
  const answered = !Array.isArray(matchedRes) ? (matchedRes?.answered ?? []) : [];
  const matched = Array.isArray(matchedRes) ? matchedRes : (matchedRes?.items ?? []);
  const note = !Array.isArray(matchedRes) ? matchedRes?.note : null;
  const reg = act && act.registered !== false;
  const rate = act?.consentRate != null ? `${act.consentRate}%` : '—';

  return (
    <><div data-intro-home="">
      <MyHead title="소개 활동"
        sub="등록하신 분야와 지역에 맞는 요청만 보여드립니다. 아는 곳이 있으면 '제가 알아요'를 누르시면 됩니다."
        right={<span className="my-ls">{reg ? act?.gradeLabel ?? act?.grade ?? '' : '소개자 프로필 전'}</span>} />

      {reg ? (
        <div className="my-subnow" data-intro-grade="">
          <div><span className="my-ls">등급</span><b className="big">{act?.gradeLabel ?? act?.grade ?? '—'}</b><span className="my-ls">{act?.nextGrade ?? '가장 높은 등급입니다'}</span></div>
          <div><span className="my-ls">유효 연결</span><b className="big">{act?.validConnections ?? 0}건</b>
            <span className="my-ls">수락률 {rate}{act?.avgRating != null ? ` · 평균 ${act.avgRating}점` : ''}</span></div>
          <Link className="my-bo" href="/my/intro/activity">활동 내역</Link>
        </div>
      ) : (
        <Note kind="warn" data-intro-unreg=""><b>{act?.note ?? '소개자 프로필을 먼저 등록해 주십시오.'}</b> 아래 「내 소개 분야」에서 분야 · 지역을 추가하시면 프로필이 만들어지고 맞춤 요청과 등급이 나옵니다.</Note>
      )}

      <Note kind="info"><b>등급은 보낸 건수가 아니라 수락률과 만족도로 정해집니다.</b> 아는 곳에만 보내는 편이 등급에 낫습니다.</Note>

      <h2 className="my-s2">내게 맞는 요청 <em>{matched.length}</em></h2>
      {matched.length === 0 ? (
        <Note kind="warn"><b>지금은 맞는 요청이 없습니다.</b> {note?.replace(/^지금은 맞는 요청이 없습니다\.\s*/, '') || '분야와 지역을 넓히면 더 많이 보실 수 있습니다.'}</Note>
      ) : (
        <div className="my-reqs">
          {matched.slice(0, 20).map((m) => {
            const id = m.requestId ?? m.id ?? '';
            return (
              <div key={id} className="my-req" data-intro-req={id}>
                <div className="my-rh"><b>{m.title ?? m.summary ?? '(제목 없음)'}</b>{m.urgent ? <span className="my-bg no">급구</span> : m.gwan ? <GwanTag code={m.gwan} /> : m.gwanName ? <span className="my-bg wait">{m.gwanName}</span> : null}</div>
                <p className="my-ls">{[m.region, m.category, m.createdAt ? `${ymdKst(m.createdAt)} 등록` : m.postedAt ? ymdKst(m.postedAt) : '', m.closesAt ? `${ymdKst(m.closesAt)} 마감` : ''].filter(Boolean).join(' · ')}</p>
                {m.body && <p>{m.body}</p>}
                {id && <IntroAnswer requestId={id} />}
              </div>
            );
          })}
        </div>
      )}

      {answered.length > 0 && (
        <>
          <h2 className="my-s2">답한 요청 <em>{answered.length}</em></h2>
          <div className="my-reqs" data-intro-answered="">
            {answered.map((a) => (
              <div key={a.requestId} className="my-req done">
                <div className="my-rh"><b>{a.title}</b>{a.gwan && <GwanTag code={a.gwan} />}</div>
                <p className="my-ls">{[a.category, a.createdAt ? `${ymdKst(a.createdAt)} 등록` : ''].filter(Boolean).join(' · ')}</p>
                {a.body && <p>{a.body}</p>}
                <div className="my-ansd">
                  <span className="my-bg ok">{a.answerLabel}{a.invites > 0 ? ' · 초대 발송' : ''}</span>
                  {a.invites > 0
                    ? <Link className="my-bo sm" href="/my/intro/invite">초대 현황</Link>
                    : a.answer === 'KNOW' && <Link className="my-bo sm" href={`/my/intro/invite?request=${encodeURIComponent(a.requestId)}`}>초대 보내기</Link>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="my-s2" id="mine">내 소개 분야</h2>
      <IntroProfileChips categories={prof?.categories ?? []} regions={prof?.regions ?? []} />

      {/* 개발에만 있던 할 일 바로가기 — 시안 바로가기 칸 모양으로 남깁니다 */}
      <h2 className="my-s2">할 일</h2>
      <div className="my-mgrid">
        <Link className="my-mcard" href="/my/intro/invite"><b>초대 보내기</b><span>아는 곳에 링크를 전달합니다</span></Link>
        <Link className="my-mcard" href="/my/intro/activity"><b>활동 · 포인트</b><span>지금까지의 기록을 봅니다</span></Link>
        <Link className="my-mcard" href="/my/deals"><b>소개 내역</b><span>진행 중인 거래를 봅니다</span></Link>
      </div>

      {/* 소개코드가 언제 잡히는지 모르면 소개비를 못 받습니다. 이것이 소개자가 가장 자주 놓치는 지점입니다. */}
      <Note kind="warn">
        <b>소개코드는 1:1 대화가 시작되는 순간 발급됩니다.</b> 전화나 카톡으로만 진행하시면 <b>소개자가 누구인지 증명할 수 없어 소개비를 받지 못합니다.</b> 반드시 초대 링크로 연결하십시오.
        귀속은 첫 접촉으로부터 90일입니다. <b>소개비는 전액 소개자에게</b> 갑니다 — 플랫폼은 한 푼도 떼지 않습니다.
      </Note>
    </div><i hidden data-root-end="" /></>
  );
}
