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

export const metadata: Metadata = { title: '안심소개에서 소개하기' };

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
        <BackBar href="/mall" label="안심소개" wrap={false} />
        <div className="gw-pgh"><div><h1>안심소개에서 소개하기</h1><p>일반 회원 안내</p></div></div>

        {payFail && (
          <div className="gw-nt gw-warn" role="alert" data-pay-fail="1">
            <b>결제가 완료되지 않았습니다{sp.message ? ` — ${sp.message.slice(0, 120)}` : ''}.</b> 소개코드는 발급되지 않았습니다.
          </div>
        )}

        <div className="gw-panel">
          <div className="gw-sh2" style={{ padding: '0 0 10px' }}>
            <b>매물을 직접 올리지 않아도 됩니다</b>
            <span className="gw-ls">안심소개 매물은 입점 승인을 받은 인증업체만 올립니다</span>
          </div>
          <ol className="gw-nsteps">
            <li className="gw-on"><span className="gw-n">1</span><div><b>매물에서 소개코드를 받습니다</b>
              <p>{perListing
                ? '소개할 매물 상세의 「소개코드 공유」를 누릅니다. 소개코드는 매물마다 따로이고, 같은 매물은 다시 눌러도 같은 코드입니다.'
                : '소개할 매물 상세의 「소개코드 공유」를 누릅니다. 아래에서 바로 받아 안심소개 전체 링크로 보낼 수도 있습니다.'}</p>
              <Link className="gw-bo gw-sm" href="/mall">매물 보러 가기</Link></div></li>
            <li><span className="gw-n">2</span><div><b>필요한 사람에게 보냅니다</b>
              <p>{perListing ? '상대가 코드로 그 매물에 문의하면 90일 동안 소개자로 기록됩니다.' : '상대가 코드로 문의하면 90일 동안 소개자로 기록됩니다.'}</p></div></li>
            <li><span className="gw-n">3</span><div><b>거래가 성사되면 소개비를 받습니다</b>
              <p>소개비는 당사자에게 직접 받습니다 — 소개뱅크는 대금을 맡지 않습니다.</p></div></li>
          </ol>
        </div>

        <div className="gw-panel" style={{ marginTop: 12 }}>
          <div className="gw-sh2" style={{ padding: '0 0 8px' }}><b>이번 달 무료 소개코드</b><span className="gw-ls">무료({basic?.name ?? 'BASIC'}) 회원</span></div>
          {basic ? (
            <>
              {/* v10.31 — W3(D060 · 시안 기준)가 BASIC 포함 소개코드를 0건으로 바꾸면 「무료 소개코드 없음 · 건당 금액」 글이 나옵니다(서버 값 그대로) */}
              {basic.includedCodes > 0 ? (
                <p data-plan="BASIC"><b>월 {basic.includedCodes}건{perListing && ` (새 매물 ${basic.includedCodes}건)`}</b> · 매월 1일에 지급하고 남은 건은 넘어가지 않습니다 · 본인인증 1명당 {basic.includedCodes}건입니다.</p>
              ) : (
                <p data-plan="BASIC"><b>무료 소개코드 없음 · 건당 {won(basic.extraCodePrice)}</b> · 필요할 때 건마다 받습니다.</p>
              )}
              <p className="gw-ls">
                {perListing && '소개코드는 매물마다 따로 받습니다. '}더 필요하면 건당 {won(basic.extraCodePrice)}으로 추가하거나
                {upper.length > 0 && <> {upper.map((u) => u.includedCodes > 0 ? `${u.name}(월 ${u.includedCodes}건)` : u.name).join(' · ')}로</>} 바꿀 수 있습니다. 요금은 변경될 수 있습니다.
              </p>
            </>
          ) : (
            <p className="gw-ls">요금제 정보를 불러오지 못했습니다. <Link href="/my/subscription">구독 · 소개코드</Link>에서 확인하십시오.</p>
          )}
          {quota && (
            <p className="gw-mine" data-my-quota={quota.freeRemaining}>
              내 요금제: <b>{quota.planName}</b>{!quota.subscribed && ' (첫 소개코드를 받을 때 무료로 시작)'}
              {quota.includedCodes > 0 ? <>
                {' · '}이번 달 {perListing ? '새 매물 ' : ''}무료 소개코드 {quota.usedThisMonth} / {quota.includedCodes}건 사용
                {quota.countScope === 'CI' && ' (같은 본인인증 계정 합산)'}
                {!quota.identityVerified && ' · 본인인증 전이라 무료분이 없습니다'}
              </> : <>{' · '}무료 소개코드 없음 · 건당 {won(quota.extraCodePrice)}</>}
            </p>
          )}
          {/* scope=listing 이면 여기서는 받지 않습니다 — 위 1단계의 안내 · 「매물 보러 가기」로 매물 상세에서 받습니다 */}
          {!perListing && <RefShare path="/mall" title="소개코드 받기 · 공유" />}
        </div>

        {p && (
          <div className="gw-panel" style={{ marginTop: 12 }} data-my-codes={codes ? codes.length : -1}>
            <div className="gw-sh2" style={{ padding: '0 0 8px' }}><b>내 소개코드</b><span className="gw-ls">{perListing ? '매물마다 따로 · ' : ''}유입은 같은 방문자를 24시간에 한 번 셉니다</span></div>
            {codes === null ? (
              <p className="gw-ls">내 소개코드를 불러오지 못했습니다. 잠시 뒤 새로고침해 주십시오.</p>
            ) : codes.length === 0 ? (
              <p className="gw-ls">아직 받은 소개코드가 없습니다. <b>매물 상세에서 「소개코드 공유」</b>를 누르면 그 매물의 코드가 여기에 쌓입니다.</p>
            ) : (
              <ul className="rc-list">
                {codes.map((c) => (
                  <li key={c.code} data-code={c.code} data-listing={c.listingId ?? ''}>
                    {c.listingId ? (
                      <div><a href={listingHref(c)} data-code-listing="1"><b>{c.listingTitle ?? '매물'}</b></a>
                        {c.listingStatus && c.listingStatus !== 'PUBLISHED' && <span className="rc-tag">게시 끝</span>}</div>
                    ) : (
                      <div><b>모든 매물</b> <span className="rc-meta">매물에 묶이지 않은 코드</span></div>
                    )}
                    <span className="rc-code">{c.code}</span>
                    {c.isExtra && <span className="rc-tag">{c.paid ? (c.paymentStub ? '추가 · 시험 결제' : `추가 · ${won(c.extraAmount ?? 0)}`) : '초과'}</span>}
                    {c.revokedAt && <span className="rc-tag">실효</span>}
                    {c.thisMonth && !c.revokedAt && <span className="rc-tag">이번 달</span>}
                    <div className="rc-meta">
                      받은 날 {ymdKst(c.issuedAt)}
                      {' · '}유입 <b data-touches={c.touches ?? 0}>{c.touches ?? 0}</b>회
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
            <div className="gw-sh2" style={{ padding: '0 0 8px' }}><b>내 소개코드</b><span className="gw-ls">유입은 같은 방문자를 24시간에 한 번 셉니다</span></div>
            <p className="gw-ls">로그인하시면 받은 소개코드와 유입 수가 여기에 나옵니다. <Link href="/login?next=/mall/give">로그인</Link> · <Link href="/signup">회원가입</Link></p>
          </div>
        )}

        <div className="gw-prfact">
          <Link className="gw-bp" href="/mall">매물 보러 가기</Link>
          <Link className="gw-bo" href="/partner/apply">업체이신가요? 입점 신청</Link>
        </div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
