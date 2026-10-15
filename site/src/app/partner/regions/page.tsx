import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { me } from '@/lib/session';
import { apiGet } from '@/lib/api';
import { RegionEditor } from '@/components/partner/RegionEditor';
import { Note, Pgh } from '@/components/partner/ui';

export const metadata: Metadata = { title: '서비스 지역' };   // v10.31 (W5 · 10/10 시안 기준) — 화면 이름을 시안 「서비스 지역」 하나로

interface Region { sido: string; sigungu: string }

/**
 * SB-PTC-CTR-230 — 켠 지역에서만 리드를 받습니다.
 * v10.29 — 시안 scPtnRegion 배치(「영업 중 N곳」 칩 → 「꺼둔 지역 N곳」 칩 → 안내). 칩을 누르면 켜고 끕니다(RegionEditor).
 */
export default async function RegionsPage() {
  const p = await me();
  if (!p) redirect('/login');

  const list = await apiGet<Region[]>('/partner/regions', 0).catch(() => []);

  return (
    <><Pgh title="서비스 지역" sub="켠 지역에서만 리드가 들어옵니다. 시·군·구 단위입니다." />

      {list.length === 0 ? (
        <Note kind="warn"><b>켜진 지역이 없어 리드가 오지 않습니다.</b> 최소 한 곳은 켜셔야 합니다.</Note>
      ) : (
        <Note kind="ok">현재 {list.length}개 지역에서 리드를 받습니다.</Note>
      )}

      {/* v10.27 (G-192) — 켜고 끄기 · 더하기 · 저장(전에는 보기만 있었음) */}
      <RegionEditor initial={list} />

      <Note kind="info">
        <b>상세주소는 쓰지 않습니다.</b> 매칭은 시·군·구까지만 봅니다 —
        동·호수는 그 자체로 특정 개인을 가리킬 수 있어 어디에도 넣지 않습니다.
      </Note>
      <Note kind="plain">
        <b>리드가 적은 지역을 켜 두셔도 손해는 없습니다.</b> 열람하지 않으면
        이용료가 발생하지 않습니다 — 받는 것은 무료입니다.
      </Note>
      <div className="pt-dact"><Link className="pt-bo" href="/partner/services">내 서비스로</Link></div>
    <i hidden data-root-end="" /></>
  );
}
