'use client';
/**
 * 소개장터 메인 — 맨 위 오른쪽 광고 칸(GHERO · 관 랜딩 상단). v10.29
 *
 * 소재는 서버 컴포넌트가 GET /ads/serve?slot=GHERO 로 받아 넘깁니다(성향에 따라 달라 캐시하지 않음). 여기서는 기록만 합니다 —
 * 노출은 이 칸이 화면에 처음 보일 때 한 번(POST /ads/{id}/impression), 클릭은 단추를 누를 때(POST /ads/{id}/click). 과금 근거라 빠뜨리면 안 됩니다
 * (메인의 HERO 칸 — components/home/HeroPromo — 과 같은 규칙).
 * 「광고」 표시와 광고주 이름을 붙입니다(INV-11 · 표시광고법).
 *
 * 그림의 광고는 사진 한 장(글자 · 단추가 사진에 박혀 있음)인데, 서버의 소재는 글자뿐입니다(사진 칸이 없음). 그래서 같은 자리 · 같은 크기 · 같은 둥글기의 칸에
 * 남색 바탕으로 글자를 놓습니다. 그림의 「1 / 3」 · 화살표는 넣지 않았습니다 — 이 칸의 소재는 한 번에 하나입니다.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AdServe } from '@/components/home/types';

/* 시안 화면 키 → 실제 경로(HeroPromo 와 같은 표). 서버 소재의 landing_route 는 시안 키(reg 등)이거나 / 로 시작하는 경로입니다. */
const ROUTE: Record<string, string> = { reg: '/register', regb: '/request/new', reqn: '/request/new', reql: '/request', aiprf: '/ai/profile', commu: '/community' };
function landing(r: string | null | undefined): string | null {
  if (!r) return null;
  if (r.startsWith('/') && !r.startsWith('//')) return r;
  return ROUTE[r] ?? null;
}

export function MoneyAd({ ad }: { ad: AdServe }) {
  const t = useTranslations('money');
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const sent = useRef(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  /* 노출 기록 — 칸이 화면에 절반 넘게 보일 때 한 번만 */
  useEffect(() => {
    const el = box.current;
    if (!el || !ad.id || sent.current) return;
    const send = () => {
      if (sent.current) return;
      sent.current = true;
      fetch(`/api/v1/ads/${encodeURIComponent(ad.id!)}/impression?slot=GHERO`, { method: 'POST' }).catch(() => {});
    };
    if (typeof IntersectionObserver === 'undefined') { send(); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { send(); io.disconnect(); } }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [ad.id]);

  async function onCta() {
    if (!ad.id || busy) return;
    setBusy(true);
    await fetch(`/api/v1/ads/${encodeURIComponent(ad.id)}/click?slot=GHERO`, { method: 'POST' }).catch(() => {});
    setBusy(false);
    const to = landing(ad.landingRoute);
    /* 목적지가 지금 화면(/money)이면 옮기지 않고 아래 매물 목록으로 내립니다 */
    if (to === '/money') { document.getElementById('mny-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (to) { router.push(to); return; }
    setMsg(t('ad.preparing', { advertiser: ad.advertiser ?? t('ad.advertiser') }));
  }

  return (
    <div className="mny-ad is-text" ref={box} data-adbox="GHERO" data-ad-code={ad.code ?? ''} role="complementary" aria-label={t('ad.aria', { advertiser: ad.advertiser ?? '' })}>
      <span className="mny-ad-tag">{ad.label ?? t('ad.tag')}</span>
      <span className="mny-ad-adv">{ad.advertiser}</span>
      <h2>{ad.title}</h2>
      {ad.body && <p>{ad.body}</p>}
      <button type="button" className="mny-ad-cta" onClick={onCta} disabled={busy}>
        {ad.cta ?? t('ad.more')}
        <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M1 5h12M9 1l4 4-4 4" /></svg>
      </button>
      {msg && <p className="mny-ad-msg" role="status">{msg}</p>}
    </div>
  );
}
