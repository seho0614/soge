import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Fragment } from 'react';
import { apiGet } from '@/lib/api';
import type { Gwan } from '@/lib/types';
import { GWAN_PATH } from '@/lib/format';
import { GwanIcon, gwanColor, gwanHeadStyle } from '@/components/gwan/GwanLook';
import { getLayout, layOrder } from '@/lib/layout';
import { LayBlocks } from '@/components/layout/LayBlocks';

/**
 * SB-HOM-HUB-010 — 허브(소개하고 벌기) 사용자 웹 페이지 /earn (v10.702 · D322 · docs/810)
 *
 * 대표 11/24 「허브?」 → 다음개발 「허브 사용자 웹 페이지」. 허브 관(EARN · is_hub)은 매물을 직접 갖지 않고 하위 관을 묶음.
 * 허브가 열려 있을 때만(GET /gwans 에 EARN) — 아니면 404. 하위 관 카드는 열린 하위 관(parentCode = EARN)만.
 * 제목 · 설명 · 이용 안내 글 · 구역 순서 · 숨기기 · 블록은 운영 화면 › 관 관리 › 페이지 목록 › 「소개하고 벌기(허브) 메인」(꾸밀 페이지 EARN).
 * 글이 비어 있으면 관 이름 · 설명(운영 화면 관 설정)을 씀 — 새 사전 글을 더하지 않음.
 */
export async function generateMetadata(): Promise<Metadata> {
  const gwans = await apiGet<Gwan[]>('/gwans', 300).catch(() => [] as Gwan[]);
  const hub = gwans.find((g) => g.code === 'EARN' && g.isHub);
  return { title: hub?.name ?? 'EARN', description: hub?.description ?? undefined };
}

export default async function HubPage({ searchParams }: { searchParams: Promise<{ lp?: string }> }) {
  const gwans = await apiGet<Gwan[]>('/gwans', 60).catch(() => [] as Gwan[]);
  const hub = gwans.find((g) => g.code === 'EARN' && g.isHub);
  if (!hub) notFound();
  const lay = await getLayout('EARN', (await searchParams).lp);
  const kids = gwans.filter((g) => g.parentCode === 'EARN' && !g.isHub && g.isActive !== false);
  const tx = lay?.texts ?? {};
  const ins = (at: string) => <LayBlocks code="MNY" blocks={lay?.inserts[at]} at={at} />;
  return (
    <><div className="gw-wrap" style={{ paddingTop: 16, paddingBottom: 24 }} data-screen="SB-HOM-HUB-010" data-hub="EARN">
      <div className="page-head" style={gwanHeadStyle(hub.color)}>
        <h1 style={{ color: gwanColor(hub.color) }}><GwanIcon name={hub.icon} size={26} /> {tx.title || hub.name}</h1>
        {(tx.desc || hub.description) && <p>{tx.desc || hub.description}</p>}
      </div>
      {ins('_top')}
      {layOrder(lay, ['cards', 'guide']).map(({ key, show }) => (
        <Fragment key={key}>
          {show && key === 'cards' && (
            <section className="gp" data-hub-cards={kids.length} aria-label={hub.name}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {kids.map((g) => (
                  <Link key={g.code} href={`/${GWAN_PATH[g.code]}`} className="card pad" data-hub-card={g.code} style={{ display: 'block', textDecoration: 'none' }}>
                    <b style={{ color: gwanColor(g.color) }}><GwanIcon name={g.icon} size={22} /> {g.name}</b>
                    {g.description && <p className="dim" style={{ margin: '6px 0 0' }}>{g.description}</p>}
                  </Link>
                ))}
              </div>
            </section>
          )}
          {show && key === 'guide' && tx.guide && <section className="gp-text" data-hub-guide=""><p style={{ whiteSpace: 'pre-line' }}>{tx.guide}</p></section>}
          {ins(key)}
        </Fragment>
      ))}
    </div><i hidden data-root-end="" /></>
  );
}
