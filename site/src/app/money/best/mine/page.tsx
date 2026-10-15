import type { Metadata } from 'next';
import Link from 'next/link';
import { apiGetPersonal } from '@/lib/api';
import { me } from '@/lib/session';
import { BackBar } from '@/components/common/BackBar';
import { GwFrame } from '@/components/gwan/GwParts';
import { StoryConsent } from '@/components/gwan/StoryConsent';

export const metadata: Metadata = { title: '베스트매칭 공개 동의' };

interface Mine { id: string; headline: string; status: string; title: string; side: 'SELLER' | 'BUYER'; consentAt: string | null; sellerComment: string | null; sellerRating: number | null }

/**
 * v10.31 (w2) — 베스트매칭 사례 공개 동의(내가 거래 당사자인 사례). GET /me/success-stories · POST /market/success-stories/{id}/consent
 *   두 당사자가 모두 동의해야 공개됩니다 · 매도자는 한마디 · 별점을 함께 남깁니다 · 철회하면 공개 중인 사례를 내립니다.
 */
export default async function Page() {
  const viewer = await me().catch(() => null);
  const rows = viewer ? await apiGetPersonal<Mine[]>('/me/success-stories').catch(() => [] as Mine[]) : [];
  return (
    <><GwFrame code="MNY">
      <div className="gw-wrap" style={{ paddingTop: 16 }}><BackBar href="/money/best" label="베스트매칭" wrap={false} /></div>
      <div className="gw-wrap" style={{ paddingTop: 14, paddingBottom: 20 }}>
        <div className="gw-panel" style={{ padding: '22px 24px' }}>
          <h1 className="gw-dtt" style={{ margin: '0 0 4px' }}>베스트매칭 사례 공개 동의</h1>
          <p className="gw-ls" style={{ margin: '0 0 14px' }}>성사된 내 거래가 베스트매칭 후보로 뽑히면 여기에 나옵니다. 금액 · 기간 · 과정은 거래 기록 그대로, 이름은 나가지 않습니다.</p>
          {!viewer ? <p className="gw-axempty"><b>로그인이 필요합니다.</b><Link className="gw-bo gw-sm" href="/login?next=/money/best/mine">로그인</Link></p>
            : rows.length === 0 ? <p className="gw-axempty"><b>동의를 기다리는 사례가 없습니다.</b>운영이 고른 사례가 생기면 알림으로 알려 드립니다.</p>
            : <div className="gw-axrows">{rows.map((r) => <StoryConsent key={r.id} row={r} />)}</div>}
        </div>
      </div>
    </GwFrame><i hidden data-root-end="" /></>
  );
}
