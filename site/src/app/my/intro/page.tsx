import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { ymdKst } from '@/lib/format';
import { MyHead, Note, GwanTag } from '@/components/my/ui';
import { IntroAnswer } from '@/components/my/IntroAnswer';
import { IntroProfileChips } from '@/components/my/IntroProfileChips';
import { getTranslations } from 'next-intl/server';
import { getFmt } from '@/lib/getFmt';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('myDeal'))('intro.title') };
}

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
  const t = await getTranslations('myDeal');
  const f = await getFmt();
  const b_ = (c: React.ReactNode) => <b>{c}</b>;

  const [act, matchedRes, prof] = await Promise.all([
    apiGet<Act>('/me/introducer/activity', 0).catch(() => null),
    apiGet<{ items?: Matched[]; answered?: Answered[]; note?: string | null; registered?: boolean } | Matched[]>('/me/introducer/matched', 0).catch(() => null),
    apiGet<Profile>('/me/introducer/profile', 0).catch(() => null),
  ]);
  const answered = !Array.isArray(matchedRes) ? (matchedRes?.answered ?? []) : [];
  const matched = Array.isArray(matchedRes) ? matchedRes : (matchedRes?.items ?? []);
  const note = !Array.isArray(matchedRes) ? matchedRes?.note : null;
  const reg = act && act.registered !== false;
  const rate = act?.consentRate != null ? `${act.consentRate}%` : '—';

  return (
    <><div data-intro-home="">
      <MyHead title={t('intro.title')}
        sub={t('intro.sub')}
        right={<span className="my-ls">{reg ? act?.gradeLabel ?? act?.grade ?? '' : t('intro.noProfile')}</span>} />

      {reg ? (
        <div className="my-subnow" data-intro-grade="">
          <div><span className="my-ls">{t('intro.grade')}</span><b className="big">{act?.gradeLabel ?? act?.grade ?? '—'}</b><span className="my-ls">{act?.nextGrade ?? t('intro.topGrade')}</span></div>
          <div><span className="my-ls">{t('intro.valid')}</span><b className="big">{t('intro.count', { n: String(act?.validConnections ?? 0) })}</b>
            <span className="my-ls">{t('intro.rate', { rate })}{act?.avgRating != null ? t('intro.avg', { v: String(act.avgRating) }) : ''}</span></div>
          <Link className="my-bo" href="/my/intro/activity">{t('intro.activity')}</Link>
        </div>
      ) : (
        <Note kind="warn" data-intro-unreg=""><b>{t('intro.needProfile')}</b> {t('intro.unregHint')}</Note>
      )}

      <Note kind="info">{t.rich('intro.gradeNote', { b: b_ })}</Note>

      <h2 className="my-s2">{t('intro.matchedH')} <em>{matched.length}</em></h2>
      {matched.length === 0 ? (
        <Note kind="warn"><b>{t('intro.noMatch')}</b> {f.srv(note?.replace(/^지금은 맞는 요청이 없습니다\.\s*/, ''), !Array.isArray(matchedRes) && matchedRes?.registered === false ? t('intro.regToMatch') : t('intro.widen'))   /* v10.125 — 서버 글이 영어로 올 수 있어 글자 대신 registered 로 */}</Note>
      ) : (
        <div className="my-reqs">
          {matched.slice(0, 20).map((m) => {
            const id = m.requestId ?? m.id ?? '';
            return (
              <div key={id} className="my-req" data-intro-req={id}>
                <div className="my-rh"><b>{m.title ?? m.summary ?? t('intro.noTitle')}</b>{m.urgent ? <span className="my-bg no">{t('intro.urgent')}</span> : m.gwan ? <GwanTag code={m.gwan} /> : m.gwanName ? <span className="my-bg wait">{m.gwanName}</span> : null}</div>
                <p className="my-ls">{[m.region, m.category, m.createdAt ? t('intro.posted', { d: ymdKst(m.createdAt) }) : m.postedAt ? ymdKst(m.postedAt) : '', m.closesAt ? t('intro.closes', { d: ymdKst(m.closesAt) }) : ''].filter(Boolean).join(' · ')}</p>
                {m.body && <p>{m.body}</p>}
                {id && <IntroAnswer requestId={id} />}
              </div>
            );
          })}
        </div>
      )}

      {answered.length > 0 && (
        <>
          <h2 className="my-s2">{t('intro.answeredH')} <em>{answered.length}</em></h2>
          <div className="my-reqs" data-intro-answered="">
            {answered.map((a) => (
              <div key={a.requestId} className="my-req done">
                <div className="my-rh"><b>{a.title}</b>{a.gwan && <GwanTag code={a.gwan} />}</div>
                <p className="my-ls">{[a.category, a.createdAt ? t('intro.posted', { d: ymdKst(a.createdAt) }) : ''].filter(Boolean).join(' · ')}</p>
                {a.body && <p>{a.body}</p>}
                <div className="my-ansd">
                  <span className="my-bg ok">{a.answerLabel}{a.invites > 0 ? t('intro.invited') : ''}</span>
                  {a.invites > 0
                    ? <Link className="my-bo sm" href="/my/intro/invite">{t('intro.inviteStatus')}</Link>
                    : a.answer === 'KNOW' && <Link className="my-bo sm" href={`/my/intro/invite?request=${encodeURIComponent(a.requestId)}`}>{t('intro.sendInvite')}</Link>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="my-s2" id="mine">{t('intro.mine')}</h2>
      <IntroProfileChips categories={prof?.categories ?? []} regions={prof?.regions ?? []} />

      {/* 개발에만 있던 할 일 바로가기 — 시안 바로가기 칸 모양으로 남깁니다 */}
      <h2 className="my-s2">{t('intro.todo')}</h2>
      <div className="my-mgrid">
        <Link className="my-mcard" href="/my/intro/invite"><b>{t('intro.sendInvite')}</b><span>{t('intro.todoInvite')}</span></Link>
        <Link className="my-mcard" href="/my/intro/activity"><b>{t('intro.todoAct')}</b><span>{t('intro.todoActDesc')}</span></Link>
        <Link className="my-mcard" href="/my/deals"><b>{t('intro.todoDeals')}</b><span>{t('intro.todoDealsDesc')}</span></Link>
      </div>

      {/* 소개코드가 언제 잡히는지 모르면 소개비를 못 받습니다. 이것이 소개자가 가장 자주 놓치는 지점입니다. */}
      <Note kind="warn">
        {t.rich('intro.codeNote', { b: b_ })}
      </Note>
    </div><i hidden data-root-end="" /></>
  );
}
