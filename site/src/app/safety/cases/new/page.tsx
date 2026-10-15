import type { Metadata } from 'next';
import { apiGet } from '@/lib/api';
import { me } from '@/lib/session';
import { BackBar } from '@/components/common/BackBar';
import type { MarketRegions } from '@/components/market/types';
import { SafetyCaseForm } from '@/components/gwan/SafetyCaseForm';
import Link from 'next/link';

export const metadata: Metadata = { title: '피해 사례 작성' };

/**
 * v10.31 (w2) — 사고예방 「✏ 피해 사례 작성하기」(시안 scSafe 게시판의 단추). POST /safety/cases.
 *   본인인증 회원 · 하루 3건 · 연락처 · 이메일 · 계좌번호는 서버가 저장 전에 가립니다 · 작성자는 공개하지 않습니다.
 */
export default async function Page() {
  const [viewer, regions] = await Promise.all([me().catch(() => null), apiGet<MarketRegions>('/market/regions', 300).catch(() => null)]);
  return (
    <><div className="gw" data-gw="MNY">
      <div className="gw-wrap" style={{ paddingTop: 16 }}><BackBar href="/money/verified#cases" label="사고예방" wrap={false} /></div>
      <div className="gw-wrap" style={{ paddingTop: 14, paddingBottom: 20 }}>
        <div className="gw-panel" style={{ padding: '22px 24px' }}>
          <h1 className="gw-dtt" style={{ margin: '0 0 4px' }}>피해 사례 작성하기</h1>
          <p className="gw-ls" style={{ margin: '0 0 14px' }}>겪으신 일을 나누면 같은 피해를 막을 수 있습니다. 작성자는 공개되지 않습니다.</p>
          {!viewer ? (
            <p className="gw-axempty"><b>로그인이 필요합니다.</b>본인인증을 마친 회원이 쓸 수 있습니다. <Link className="gw-bo gw-sm" href="/login?next=/safety/cases/new">로그인</Link></p>
          ) : <SafetyCaseForm regions={regions?.all ?? []} />}
        </div>
      </div>
    </div><i hidden data-root-end="" /></>
  );
}
