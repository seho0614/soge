/**
 * SB-MAL-DTL-010 · SB-MAL-GIV-010 「소개코드 공유」 칸 (D010 · D012)
 *
 * 로그인 · 본인인증 상태에 따라 안내를 나누고, 로그인했으면 버튼(RefShareButton)을 둡니다.
 *  · 비로그인 → 로그인 안내
 *  · 본인인증 전 → 본인인증 안내(무료분은 본인인증 1명당) — 버튼은 두되 결제한 추가분만 받을 수 있습니다
 * 공유 링크의 기준 주소: path(기본 /mall) 앞에 사이트 주소(SITE_ORIGIN 또는 요청 호스트)를 붙입니다.
 *
 * ★ D012 (10/2 「소개코드는 매물별로」) — 운영 설정 refcode.scope (GET /site-settings/public)
 *   listing(기본): 코드는 매물마다 따로입니다. listingId 가 있는 자리(매물 상세)에만 버튼을 둡니다.
 *                  listingId 없이 쓰면 「매물 상세에서 받으십시오」 안내만 나옵니다.
 *   all: 코드가 매물에 묶이지 않습니다(전 동작).
 * 무료 건수는 GET /subscription-plans 의 BASIC 포함 건수 그대로입니다(화면에 숫자를 박지 않습니다).
 */
import { getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api';
import { me } from '@/lib/session';
import { siteOrigin } from './origin';
import { RefShareButton } from './RefShareButton';
import './refcode.css';
import { getFmt } from '@/lib/getFmt';

interface Plan { code: string; includedCodes: number; extraCodePrice?: number }

/** 운영 설정 refcode.scope — 못 읽으면 기본(listing) */
export async function refScope(): Promise<'listing' | 'all'> {
  const s = await apiGet<Record<string, string>>('/site-settings/public', 30).catch(() => ({} as Record<string, string>));
  return s['refcode.scope'] === 'all' ? 'all' : 'listing';
}

export async function RefShare({ path = '/mall', listingId, title: titleProp }:
  { path?: string; listingId?: string; title?: string }) {
  const t = await getTranslations('refcode.share');
  const f = await getFmt();
  const title = titleProp ?? t('title');
  const [p, origin, scope, plans] = await Promise.all([
    me().catch(() => null), siteOrigin(), refScope(),
    apiGet<Plan[]>('/subscription-plans', 300).catch(() => [] as Plan[]),
  ]);
  const basicPlan = plans.find((x) => x.code === 'BASIC');
  const freeN = basicPlan?.includedCodes;
  /* v10.31 (합침 · w3 D060) — 무료 요금제 포함 소개코드 0건(시안)이면 「무료 소개코드 없음 · 건당 금액」 */
  const extra = basicPlan?.extraCodePrice != null ? f.won(basicPlan.extraCodePrice) : t('flatRate');
  const perListing = scope === 'listing';

  if (perListing && !listingId) {
    return (
      <section className="rc-box" data-refshare="guide" aria-label={t('title')}>
        <h3>{title}</h3>
        <p>{t('guide')}</p>
        <div className="rc-act"><a className="rc-btn" href="/mall">{t('browseListings')}</a></div>
      </section>
    );
  }

  return (
    <section className="rc-box" data-refshare="1" data-refshare-scope={scope} aria-label={t('title')}>
      <h3>{title}</h3>
      {perListing ? (
        <p>
          {t.rich('perListingLead', { b: (c) => <b>{c}</b> })}
          {' '}{freeN == null ? t('freeUnknown')
            : freeN > 0 ? t('freeN', { n: String(freeN) })
            : t('freeNone', { extra })}
          {' '}{t('perListingTail')}
        </p>
      ) : (
        <p>{listingId ? t('allWithListing') : t('allNoListing')}</p>
      )}
      {!p ? (
        <div className="rc-act" data-refshare-login="1">
          <a className="rc-btn" href="/login">{t('loginGet')}</a>
          <a className="rc-btn ghost" href="/signup">{t('signup')}</a>
        </div>
      ) : (
        <>
          {!p.identityVerifiedAt && (
            <p className="rc-warn" data-refshare-verify="1">
              {freeN === 0
                ? <>{t('verifyNoFree', { extra })}{' '}</>
                : <>{freeN != null ? t('verifyFreeN', { n: String(freeN) }) : t('verifyFree')}{' '}</>}
              <a href="/verify">{t('verifyLink')}</a>
            </p>
          )}
          <RefShareButton base={`${origin}${path}`} listingId={listingId} identityVerified={!!p.identityVerifiedAt} />
        </>
      )}
    </section>
  );
}
