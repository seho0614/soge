import type { Metadata } from 'next';
import { apiGet, apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { won, ymdKst } from '@/lib/format';
import type { Plan } from '@/components/mal/types';
import type { RefCode, RefQuota } from '@/components/refcode/types';
import { GWAN_PATH } from '@/lib/format';
import { RefShare, refScope } from '@/components/refcode/RefShare';
import { siteOrigin } from '@/components/refcode/origin';
import { CopyLink } from '@/components/refcode/CopyLink';
import '@/styles/mal.css';
import Link from 'next/link';
import { BackBar } from '@/components/common/BackBar';
import '@/components/refcode/refcode.css';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('join.give'))('title') };
}

type Props = { searchParams: Promise<{ pay?: string; code?: string; message?: string }> };

/**
 * SB-MAL-GIV-010 안심소개 「소개하기 안내」 (시안 `malgive` · `scGive`) — SB-MAL-MAIN-010 하위
 *
 * 일반 회원은 안심소개에 매물을 직접 올리지 않고 소개코드로 소개합니다.
 * 요금제 숫자(무료 포함 건수 · 추가 단가 · 상위 요금제 건수)는 GET /subscription-plans 그대로.
 *
 * ★ D010 (10/2 「소개코드는 시안대로」) — 「준비 중」이던 소개코드를 실제로 받습니다.
 *   · 「소개코드 공유」(RefShare) — 이번 달 코드를 받거나 다시 보여 주고, 무료분이 없으면 추가 결제
 *     (GET /me/referral-codes/quota → POST /referral-codes). 매물 상세(/mall/{id})에도 같은 버튼이 있습니다.
 *   · 이번 달 무료분은 GET /me/referral-codes/quota (본인인증 1명당 · 같은 CI 계정 합산).
 *   · 내 소개코드 목록과 유입 수(touches)는 GET /me/referral-codes.
 *   · 토스 결제창 실패 주소는 ?pay=fail(&code=&message= — 토스가 붙임)입니다.
 *
 * ★ D012 (10/2 「소개코드는 매물별로」 · 운영 설정 refcode.scope — GET /site-settings/public)
 *   · listing(기본): 코드는 매물마다 따로입니다. 이 화면에는 매물 없이 누르는 공유 버튼을 두지 않고
 *     「매물 상세에서 소개코드 공유를 누르십시오」 안내와 내 소개코드 목록(매물 제목 · 매물로 가는 링크 · 공유 링크 · 유입 수)을 둡니다.
 *   · all: 전처럼 여기서 바로 받아 안심소개 전체 링크로 보냅니다.
 *
 * v10.29 — 시안 scGive 배치(돌아가기 · 제목 · 판 3개 · 아래 단추 줄)로 그립니다. 글 · 숫자 · API 는 그대로입니다.
 */
export default async function MalGivePage({ searchParams }: Props) {
  const sp = await searchParams;
  const t = await getTranslations('join.give');
  const [plans, p, origin, scope] = await Promise.all([
    apiGet<Plan[]>('/subscription-plans', 300).catch(() => [] as Plan[]),
    me().catch(() => null),
    siteOrigin(),
    refScope(),
  ]);
  const perListing = scope === 'listing';
  /** 코드의 공유 링크 — 매물 코드는 그 매물 화면, 매물에 안 묶인 코드(옛 코드 · scope=all)는 안심소개 전체 */
  const shareUrl = (c: RefCode) =>
    c.listingId ? `${origin}/${(c.gwanCode && GWAN_PATH[c.gwanCode]) || 'mall'}/${c.listingId}?ref=${c.code}` : `${origin}/mall?ref=${c.code}`;
  const listingHref = (c: RefCode) => `/${(c.gwanCode && GWAN_PATH[c.gwanCode]) || 'mall'}/${c.listingId}`;
  const [quota, codes] = p
    ? await Promise.all([
        apiGetPersonal<RefQuota>('/me/referral-codes/quota').catch(() => null),
        apiGetPersonal<RefCode[]>('/me/referral-codes').catch(() => null),
      ])
    : [null, null];
  const basic = plans.find((x) => x.code === 'BASIC');
  const upper = plans.filter((x) => x.code !== 'BASIC');
  const payFail = sp.pay === 'fail';

  return (
    <><div className="gw">
      <div className="gw-wrap gw-aiw">
        <BackBar href="/mall" label={t('back')} wrap={false} />
        <div className="gw-pgh"><div><h1>{t('title')}</h1><p>{t('sub')}</p></div></div>

        {payFail && (
          <div className="gw-nt gw-warn" role="alert" data-pay-fail="1">
            <b>{t('payFailB')}{sp.message ? ` — ${sp.message.slice(0, 120)}` : ''}.</b> {t('payFailTail')}
          </div>
        )}

        <div className="gw-panel">
          <div className="gw-sh2" style={{ padding: '0 0 10px' }}>
            <b>{t('p1Title')}</b>
            <span className="gw-ls">{t('p1Sub')}</span>
          </div>
          <ol className="gw-nsteps">
            <li className="gw-on"><span className="gw-n">1</span><div><b>{t('s1B')}</b>
              <p>{perListing
                ? t('s1Listing')
                : t('s1All')}</p>
              <Link className="gw-bo gw-sm" href="/mall">{t('browse')}</Link></div></li>
            <li><span className="gw-n">2</span><div><b>{t('s2B')}</b>
              <p>{perListing ? t('s2Listing') : t('s2All')}</p></div></li>
            <li><span className="gw-n">3</span><div><b>{t('s3B')}</b>
              <p>{t('s3P')}</p></div></li>
          </ol>
        </div>

        <div className="gw-panel" style={{ marginTop: 12 }}>
          <div className="gw-sh2" style={{ padding: '0 0 8px' }}><b>{t('freeTitle')}</b><span className="gw-ls">{t('freeMember', { plan: basic?.name ?? 'BASIC' })}</span></div>
          {basic ? (
            <>
              {/* v10.31 — W3(D060 · 시안 기준)가 BASIC 포함 소개코드를 0건으로 바꾸면 「무료 소개코드 없음 · 건당 금액」 글이 나옵니다(서버 값 그대로) */}
              {basic.includedCodes > 0 ? (
                <p data-plan="BASIC"><b>{t('monthly', { n: String(basic.includedCodes) })}{perListing && t('newListings', { n: String(basic.includedCodes) })}</b>{t('monthlyTail', { n: String(basic.includedCodes) })}</p>
              ) : (
                <p data-plan="BASIC"><b>{t('noFree', { price: won(basic.extraCodePrice) })}</b>{t('noFreeTail')}</p>
              )}
              <p className="gw-ls">
                {perListing && t('perListingNote')}{t('moreA', { price: won(basic.extraCodePrice) })}
                {upper.length > 0 && <> {t('moreUpper', { list: upper.map((u) => u.includedCodes > 0 ? t('upperItem', { name: u.name, n: String(u.includedCodes) }) : u.name).join(' · ') })}</>}{t('moreB')}
              </p>
            </>
          ) : (
            <p className="gw-ls">{t.rich('noPlans', { a: (c) => <Link href="/my/subscription">{c}</Link> })}</p>
          )}
          {quota && (
            <p className="gw-mine" data-my-quota={quota.freeRemaining}>
              {t.rich('myPlan', { plan: quota.planName, b: (c) => <b>{c}</b> })}{!quota.subscribed && t('planFreeStart')}
              {quota.includedCodes > 0 ? <>
                {' · '}{t(perListing ? 'usageListing' : 'usageAll', { used: String(quota.usedThisMonth), inc: String(quota.includedCodes) })}
                {quota.countScope === 'CI' && t('ciSum')}
                {!quota.identityVerified && t('noIdFree')}
              </> : <>{' · '}{t('noFree', { price: won(quota.extraCodePrice) })}</>}
            </p>
          )}
          {/* scope=listing 이면 여기서는 받지 않습니다 — 위 1단계의 안내 · 「매물 보러 가기」로 매물 상세에서 받습니다 */}
          {!perListing && <RefShare path="/mall" title={t('refShareTitle')} />}
        </div>

        {p && (
          <div className="gw-panel" style={{ marginTop: 12 }} data-my-codes={codes ? codes.length : -1}>
            <div className="gw-sh2" style={{ padding: '0 0 8px' }}><b>{t('myCodes')}</b><span className="gw-ls">{perListing ? t('perListingPrefix') : ''}{t('touchNote')}</span></div>
            {codes === null ? (
              <p className="gw-ls">{t('codesFail')}</p>
            ) : codes.length === 0 ? (
              <p className="gw-ls">{t.rich('codesEmpty', { b: (c) => <b>{c}</b> })}</p>
            ) : (
              <ul className="rc-list">
                {codes.map((c) => (
                  <li key={c.code} data-code={c.code} data-listing={c.listingId ?? ''}>
                    {c.listingId ? (
                      <div><a href={listingHref(c)} data-code-listing="1"><b>{c.listingTitle ?? t('listing')}</b></a>
                        {c.listingStatus && c.listingStatus !== 'PUBLISHED' && <span className="rc-tag">{t('ended')}</span>}</div>
                    ) : (
                      <div><b>{t('allListings')}</b> <span className="rc-meta">{t('unbound')}</span></div>
                    )}
                    <span className="rc-code">{c.code}</span>
                    {c.isExtra && <span className="rc-tag">{c.paid ? (c.paymentStub ? t('extraStub') : t('extraPaid', { amount: won(c.extraAmount ?? 0) })) : t('over')}</span>}
                    {c.revokedAt && <span className="rc-tag">{t('revoked')}</span>}
                    {c.thisMonth && !c.revokedAt && <span className="rc-tag">{t('thisMonth')}</span>}
                    <div className="rc-meta">
                      {t('issued', { date: ymdKst(c.issuedAt) })}
                      {' · '}{t.rich('touches', { n: String(c.touches ?? 0), b: (x) => <b data-touches={c.touches ?? 0}>{x}</b> })}
                    </div>
                    {!c.revokedAt && <CopyLink text={shareUrl(c)} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!p && (
          /* v10.31 (w2 · 시안 scGive) — 시안의 「내 소개코드」 구역은 로그인하지 않은 분에게도 자리를 둡니다(목록은 로그인 뒤) */
          <div className="gw-panel" style={{ marginTop: 12 }} data-my-codes="guest">
            <div className="gw-sh2" style={{ padding: '0 0 8px' }}><b>{t('myCodes')}</b><span className="gw-ls">{t('touchNote')}</span></div>
            <p className="gw-ls">{t.rich('guest', { login: (c) => <Link href="/login?next=/mall/give">{c}</Link>, signup: (c) => <Link href="/signup">{c}</Link> })}</p>
          </div>
        )}

        <div className="gw-prfact">
          <Link className="gw-bp" href="/mall">{t('browse')}</Link>
          <Link className="gw-bo" href="/partner/apply">{t('partnerApply')}</Link>
        </div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
