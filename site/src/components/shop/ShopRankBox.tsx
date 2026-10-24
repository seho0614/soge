'use client';
/**
 * v10.31 (시안 「오늘의 건강상품」 오른쪽 순위 상자) — 탭 3개: 실시간 인기 · 새로 올라온 상품 · 많이 찾는 상품.
 *   실시간 인기 = GET /health/rankings sales(최근 7일 판매 수량 · 하루 1회 집계) · 새로 올라온 상품 = 판매 중 상품을 올린 순서 ·
 *   많이 찾는 상품 = rankings orders(최근 7일 주문 건수). 값은 모두 서버 값 — 탭에 자료가 없으면 그 사실을 적습니다(지어내지 않음).
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { HltProduct } from '@/components/health/types';
import { krw } from '@/components/health/util';
import { ProductArt } from '@/components/health/ProductArt';

type Row = HltProduct & { rank?: number };
/* v10.97 — 탭 이름 · 순위 근거는 사전 shop.rank.tabs.* · shop.rank.basis.* (키 = 탭 코드) */
const TABS = ['hot', 'fresh', 'many'] as const;
type Tab = (typeof TABS)[number];
const Chev = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
);

export function ShopRankBox({ hot, fresh, many, madeAt, periods }: { hot: Row[]; fresh: Row[]; many: Row[]; madeAt?: string; periods?: { hot: string; many: string } }) {
  const t = useTranslations('shop');
  const first: Tab = hot.length ? 'hot' : many.length ? 'many' : 'fresh';
  const [tab, setTab] = useState<Tab>(first);
  const rows = (tab === 'hot' ? hot : tab === 'many' ? many : fresh).slice(0, 5);
  return (
    <div className="shop-rankbox" data-shop-rank="1">
      <div className="shop-tabs" role="tablist">
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} data-stab={k} onClick={() => setTab(k)}>{t(`rank.tabs.${k}`)}</button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="shop-basis" data-rank-empty={tab}>{t('rank.empty')}</p>
      ) : (
        <ol className="shop-rank">
          {rows.map((p, i) => (
            <li key={p.code}>
              <Link href={`/health/p/${encodeURIComponent(p.code)}`} data-rank-pid={p.code}>
                <span className="shop-no">{p.rank ?? i + 1}</span>
                <span className="th"><ProductArt p={p} size={60} /></span>
                <span className="tx"><b>{p.name}</b><span>{krw(p.price)}{p.offPct ? <i>{p.offPct}%</i> : null}</span></span>
                <Chev />
              </Link>
            </li>
          ))}
        </ol>
      )}
      {/* v10.31 검정 — 순위의 기간(한국 날짜)을 함께 적습니다(v10.28 D037 「기준 · 기간 · 집계 날짜」 — fix_1028_ui C-U1) */}
      <p className="shop-basis" data-basis="1">{t('rank.basisLabel', { basis: t(`rank.basis.${tab}`) })}{tab !== 'fresh' && periods?.[tab as 'hot' | 'many'] ? ` · ${periods[tab as 'hot' | 'many']}` : ''}{madeAt && tab !== 'fresh' ? ` · ${t('madeAt', { date: madeAt })}` : ''}</p>
    </div>
  );
}
