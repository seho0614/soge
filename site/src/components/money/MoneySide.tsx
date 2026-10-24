'use client';
/** 소개장터 메인 — 왼쪽 「전체 카테고리」. 묶음(상품 · 서비스)을 눌러 접고 폅니다. 조회는 없습니다(이름 · 가는 곳은 menu.ts). v10.30
 *  now = 지금 아래 목록을 거르고 있는 낱말(주소의 ?keyword=). 같은 낱말의 줄에 「지금 고른 것」 표시(aria-current)를 답니다. */
import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MnyPic } from './pics';
import { SIDE_GROUPS, SIDE_PLAIN, listHref } from './menu';
import type { MarketRegions } from '@/components/market/types';

/** v10.31 — 「지역으로 찾기」: 시안 순서 9곳 + 기타 지역. 누르면 아래 목록을 그 시 · 도로 거릅니다(/money?region=…#mny-list · 다시 누르면 풂) */
const regionHref = (code: string, now?: string) => (code && code !== now ? `/money?region=${code}#mny-list` : '/money#mny-list');

export function MoneySide({ now = '', regions, region }: { now?: string; regions?: MarketRegions | null; region?: string }) {
  const t = useTranslations('money');
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(SIDE_GROUPS.map((g) => [g.key, true])));
  return (
    <aside className="mny-side" aria-labelledby="mny-side-t">
      <h2 className="mny-side-h" id="mny-side-t">{t('side.title')}</h2>
      <div className="mny-side-b">
        {SIDE_GROUPS.map((g) => (
          <div key={g.key}>
            <button type="button" className={`mny-sg${g.on ? ' is-on' : ''}`} aria-expanded={open[g.key]} aria-controls={`mny-sl-${g.key}`}
              onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}>
              <MnyPic name={g.pic} />{t(`side.group.${g.key}`)}<i className="mny-chev" aria-hidden />
            </button>
            <ul className="mny-sl" id={`mny-sl-${g.key}`} hidden={!open[g.key]}>
              {g.items.map(([nm, kw]) => <li key={nm}><Link href={listHref(kw)} data-mny-kw={kw} aria-current={kw && kw === now ? 'true' : undefined}>{t(`side.items.${nm}`)}</Link></li>)}
            </ul>
          </div>
        ))}
        <div>
          {SIDE_PLAIN.map(([pic, nm, href, kw]) => (
            <Link key={nm} className="mny-sg is-plain" href={href} data-mny-kw={kw || undefined} aria-current={kw && kw === now ? 'true' : undefined}><MnyPic name={pic} />{t(`side.plain.${nm}`)}<i className="mny-chev" aria-hidden /></Link>
          ))}
        </div>
        <hr />
        <div>
          <div className="mny-sg is-region"><MnyPic name="side_region" />{t('side.byRegion')}</div>
          <ul className="mny-sl is-region" data-mny-regions={regions?.items.length ?? 0}>
            {(regions ? [...regions.items, regions.etc] : []).map((r) => (
              <li key={r.code}><Link href={regionHref(r.code, region)} data-region={r.code} aria-current={region === r.code ? 'true' : undefined}
                title={r.code === 'ETC' && regions ? t('side.etcTip', { list: regions.etc.includes.join(' · '), n: String(r.count ?? 0) }) : t('side.countTip', { n: String(r.count ?? 0) })}>{r.name}</Link></li>
            ))}
            {!regions && <li><span className="mny-sl-none">{t('side.regionFail')}</span></li>}
          </ul>
        </div>
      </div>
    </aside>
  );
}
