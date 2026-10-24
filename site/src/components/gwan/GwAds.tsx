'use client';
/**
 * v10.31 (w2) — 관 화면의 광고 칸 2종 · 시안 그대로.
 *   GwFloatAd  오른쪽 아래 떠 있는 광고(시안 floatHTML · .adfloat · 칸 FLOAT 「우측 하단 플로팅 배너」) — 관 랜딩 · 전체 목록.
 *              ✕ 를 누르면 그 세션 동안 뜨지 않습니다(칸 설명 그대로).
 *   MoneyBand  소개장터 메인 「공급자 등록」 위의 가로 띠(시안 band_ad · 칸 GBAND 「관 랜딩 띠」).
 * 소재는 서버 컴포넌트가 GET /ads/serve?slot=… 로 받아 넘깁니다(사람마다 달라 캐시하지 않음). 여기서는 기록만 합니다 —
 *   노출은 칸이 처음 보일 때 한 번(POST /ads/{id}/impression), 클릭은 단추를 누를 때(POST /ads/{id}/click). 과금 근거입니다(메인 HeroPromo · MoneyAd 와 같은 규칙).
 *   「광고」 표시와 광고주 이름을 붙입니다(표시광고법 · INV-11). 소재가 없으면 칸을 그리지 않습니다(견본을 띄우지 않음).
 */
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AdServe } from '@/components/home/types';

const ROUTE: Record<string, string> = { reg: '/register', regb: '/request/new', reqn: '/request/new', reql: '/request', aiprf: '/ai/profile', commu: '/community' };
function landing(r: string | null | undefined): string | null {
  if (!r) return null;
  if (r.startsWith('/') && !r.startsWith('//')) return r;
  return ROUTE[r] ?? null;
}

function useAdLog(ad: AdServe | null, slot: string) {
  const box = useRef<HTMLElement>(null);
  const sent = useRef(false);
  useEffect(() => {
    const el = box.current;
    if (!el || !ad?.id || sent.current) return;
    const send = () => {
      if (sent.current) return;
      sent.current = true;
      fetch(`/api/v1/ads/${encodeURIComponent(ad.id!)}/impression?slot=${slot}`, { method: 'POST' }).catch(() => {});
    };
    if (typeof IntersectionObserver === 'undefined') { send(); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { send(); io.disconnect(); } }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [ad?.id, slot]);
  return box;
}

function useClick(ad: AdServe | null, slot: string) {
  const router = useRouter();
  const t = useTranslations('gwan.ad');
  const [msg, setMsg] = useState('');
  async function go() {
    if (!ad?.id) return;
    await fetch(`/api/v1/ads/${encodeURIComponent(ad.id)}/click?slot=${slot}`, { method: 'POST' }).catch(() => {});
    const to = landing(ad.landingRoute);
    if (to) { router.push(to); return; }
    setMsg(t('notReady', { advertiser: ad.advertiser ?? t('advertiser') }));
  }
  return { go, msg };
}

const FKEY = 'gw.floatClosed';

export function GwFloatAd({ ad }: { ad: AdServe | null }) {
  const t = useTranslations('gwan.ad');
  const [closed, setClosed] = useState(true);
  useEffect(() => { try { setClosed(sessionStorage.getItem(FKEY) === '1'); } catch { setClosed(false); } }, []);
  const box = useAdLog(closed ? null : ad, 'FLOAT');
  const { go, msg } = useClick(ad, 'FLOAT');
  if (!ad?.id || ad.empty || closed) return null;
  return (
    /* .gw 변수(색 · 그림자)를 받도록 감쌉니다 — 소개장터 메인(.mny)처럼 .gw 밖에서도 같은 모양 */
    <div className="gw gw-floatwrap">
    <aside className="gw-adfloat" ref={box as React.RefObject<HTMLElement>} data-adbox="FLOAT" data-ad-code={ad.code ?? ''} aria-label={t('aria', { advertiser: ad.advertiser ?? '' })}>
      <div className="gw-adlab">{ad.label ?? t('label')}</div>
      <button type="button" className="gw-adx" aria-label={t('close')} onClick={() => { try { sessionStorage.setItem(FKEY, '1'); } catch { /* 그대로 */ } setClosed(true); }}>✕</button>
      <b>{ad.title}</b><span>{ad.advertiser}</span>
      <button type="button" className="gw-bo gw-sm" onClick={() => void go()}>{ad.cta ?? t('more')}</button>
      {msg && <p className="gw-admsg" role="status">{msg}</p>}
    </aside>
    </div>
  );
}

export function MoneyBand({ ad }: { ad: AdServe | null }) {
  const t = useTranslations('gwan.ad');
  const box = useAdLog(ad, 'GBAND');
  const { go, msg } = useClick(ad, 'GBAND');
  if (!ad?.id || ad.empty) return null;
  return (
    <section className="mny-band is-text" ref={box as React.RefObject<HTMLElement>} data-adbox="GBAND" data-ad-code={ad.code ?? ''} aria-label={t('aria', { advertiser: ad.advertiser ?? '' })}>
      <span className="mny-band-tag">{ad.label ?? t('label')}</span>
      <div className="mny-band-t"><b>{ad.title}</b>{ad.body && <span>{ad.body}</span>}</div>
      <span className="mny-band-adv">{ad.advertiser}</span>
      <button type="button" className="mny-band-cta" onClick={() => void go()}>
        {ad.cta ?? t('more')}
        <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M1 5h12M9 1l4 4-4 4" /></svg>
      </button>
      {msg && <p className="mny-band-msg" role="status">{msg}</p>}
    </section>
  );
}
