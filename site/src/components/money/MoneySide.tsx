'use client';
/** 소개장터 메인 — 왼쪽 「전체 카테고리」. 묶음(상품 · 서비스)을 눌러 접고 폅니다. 조회는 없습니다(이름 · 가는 곳은 menu.ts). v10.30
 *  now = 지금 아래 목록을 거르고 있는 낱말(주소의 ?keyword=). 같은 낱말의 줄에 「지금 고른 것」 표시(aria-current)를 답니다. */
import Link from 'next/link';
import { useState } from 'react';
import { MnyPic } from './pics';
import { SIDE_GROUPS, SIDE_PLAIN, listHref } from './menu';
import type { MarketRegions } from '@/components/market/types';

/** v10.31 — 「지역으로 찾기」: 시안 순서 9곳 + 기타 지역. 누르면 아래 목록을 그 시 · 도로 거릅니다(/money?region=…#mny-list · 다시 누르면 풂) */
const regionHref = (code: string, now?: string) => (code && code !== now ? `/money?region=${code}#mny-list` : '/money#mny-list');

export function MoneySide({ now = '', regions, region }: { now?: string; regions?: MarketRegions | null; region?: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(SIDE_GROUPS.map((g) => [g.key, true])));
  return (
    <aside className="mny-side" aria-labelledby="mny-side-t">
      <h2 className="mny-side-h" id="mny-side-t">전체 카테고리</h2>
      <div className="mny-side-b">
        {SIDE_GROUPS.map((g) => (
          <div key={g.key}>
            <button type="button" className={`mny-sg${g.on ? ' is-on' : ''}`} aria-expanded={open[g.key]} aria-controls={`mny-sl-${g.key}`}
              onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}>
              <MnyPic name={g.pic} />{g.name}<i className="mny-chev" aria-hidden />
            </button>
            <ul className="mny-sl" id={`mny-sl-${g.key}`} hidden={!open[g.key]}>
              {g.items.map(([t, kw]) => <li key={t}><Link href={listHref(kw)} data-mny-kw={kw} aria-current={kw && kw === now ? 'true' : undefined}>{t}</Link></li>)}
            </ul>
          </div>
        ))}
        <div>
          {SIDE_PLAIN.map(([pic, t, href, kw]) => (
            <Link key={t} className="mny-sg is-plain" href={href} data-mny-kw={kw || undefined} aria-current={kw && kw === now ? 'true' : undefined}><MnyPic name={pic} />{t}<i className="mny-chev" aria-hidden /></Link>
          ))}
        </div>
        <hr />
        <div>
          <div className="mny-sg is-region"><MnyPic name="side_region" />지역으로 찾기</div>
          <ul className="mny-sl is-region" data-mny-regions={regions?.items.length ?? 0}>
            {(regions ? [...regions.items, regions.etc] : []).map((r) => (
              <li key={r.code}><Link href={regionHref(r.code, region)} data-region={r.code} aria-current={region === r.code ? 'true' : undefined}
                title={r.code === 'ETC' && regions ? `${regions.etc.includes.join(' · ')} · 지역 미상 — ${r.count ?? 0}건` : `${r.count ?? 0}건`}>{r.name}</Link></li>
            ))}
            {!regions && <li><span className="mny-sl-none">지역 목록을 불러오지 못했습니다.</span></li>}
          </ul>
        </div>
      </div>
    </aside>
  );
}
