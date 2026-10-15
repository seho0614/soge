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
import { apiGet } from '@/lib/api';
import { me } from '@/lib/session';
import { siteOrigin } from './origin';
import { RefShareButton } from './RefShareButton';
import './refcode.css';

interface Plan { code: string; includedCodes: number; extraCodePrice?: number }

/** 운영 설정 refcode.scope — 못 읽으면 기본(listing) */
export async function refScope(): Promise<'listing' | 'all'> {
  const s = await apiGet<Record<string, string>>('/site-settings/public', 30).catch(() => ({} as Record<string, string>));
  return s['refcode.scope'] === 'all' ? 'all' : 'listing';
}

export async function RefShare({ path = '/mall', listingId, title = '소개코드 공유' }:
  { path?: string; listingId?: string; title?: string }) {
  const [p, origin, scope, plans] = await Promise.all([
    me().catch(() => null), siteOrigin(), refScope(),
    apiGet<Plan[]>('/subscription-plans', 300).catch(() => [] as Plan[]),
  ]);
  const basicPlan = plans.find((x) => x.code === 'BASIC');
  const freeN = basicPlan?.includedCodes;
  /* v10.31 (합침 · w3 D060) — 무료 요금제 포함 소개코드 0건(시안)이면 「무료 소개코드 없음 · 건당 금액」 */
  const extra = basicPlan?.extraCodePrice != null ? `${Number(basicPlan.extraCodePrice).toLocaleString('ko-KR')}원` : '정액';
  const perListing = scope === 'listing';

  if (perListing && !listingId) {
    return (
      <section className="rc-box" data-refshare="guide" aria-label="소개코드 공유">
        <h3>{title}</h3>
        <p>소개코드는 매물마다 따로 받습니다. 소개할 매물 상세에서 「소개코드 공유」를 누르십시오.</p>
        <div className="rc-act"><a className="rc-btn" href="/mall">매물 보러 가기</a></div>
      </section>
    );
  }

  return (
    <section className="rc-box" data-refshare="1" data-refshare-scope={scope} aria-label="소개코드 공유">
      <h3>{title}</h3>
      {perListing ? (
        <p>
          필요한 사람에게 이 매물을 소개하세요. 소개코드는 <b>매물마다 따로</b>입니다 — 같은 매물은 다시 눌러도 같은 코드이고,
          {freeN == null ? ' 이번 달 새 매물은 요금제 포함 건수까지 무료입니다.'
            : freeN > 0 ? ` 이번 달 새 매물 ${freeN}건은 무료입니다(무료 회원 · 본인인증 1명당).`
            : ` 무료 회원은 무료 소개코드 없이 건당 ${extra}으로 받습니다(유료 요금제는 포함 건수까지).`}
          {' '}상대가 소개 링크로 들어와 90일 안에 이 매물에 문의하면 소개자로 기록됩니다.
        </p>
      ) : (
        <p>필요한 사람에게 {listingId ? '이 매물을' : '안심소개 매물을'} 소개하세요. 상대가 소개 링크로 들어와 90일 안에 문의하면 소개자로 기록됩니다.</p>
      )}
      {!p ? (
        <div className="rc-act" data-refshare-login="1">
          <a className="rc-btn" href="/login">로그인하고 소개코드 받기</a>
          <a className="rc-btn ghost" href="/signup">회원가입</a>
        </div>
      ) : (
        <>
          {!p.identityVerifiedAt && (
            <p className="rc-warn" data-refshare-verify="1">
              {freeN === 0
                ? <>본인인증 전입니다 — 소개코드는 본인인증 뒤에 받습니다(무료 소개코드 없음 · 건당 {extra}). </>
                : <>본인인증 전입니다 — 무료 소개코드{freeN != null ? `(월 ${freeN}건)` : ''}는 본인인증 1명당 드립니다. </>}
              <a href="/verify">본인인증 하기</a>
            </p>
          )}
          <RefShareButton base={`${origin}${path}`} listingId={listingId} identityVerified={!!p.identityVerifiedAt} />
        </>
      )}
    </section>
  );
}
