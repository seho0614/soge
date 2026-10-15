'use client';
/**
 * SB-HOM-MAIN-010 · 011 — 히어로 오른쪽 카드(넘겨 보는 안내 · HERO 광고) — v10.13 「hero 페이지」 디자인.
 *
 * 첫 장은 HERO 광고입니다(소재가 있을 때). 소재는 서버 컴포넌트가 GET /ads/serve?slot=HERO 로 받아 넘깁니다
 * (성향에 따라 달라 캐시하지 않음). 여기서는 기록만 합니다 — 노출은 그 장이 화면에 처음 보일 때 한 번
 * (POST /ads/{id}/impression), 클릭은 버튼을 누를 때(POST /ads/{id}/click). 과금 근거라 빠뜨리면 안 됩니다.
 * 광고에는 「광고」 표시와 광고주 이름을 붙입니다 — 안내 카드와 섞여 보이면 안 됩니다(INV-11).
 *
 * 목적지(landingRoute)가 있는 소재만 그 화면으로 보냅니다. 외부 광고주 소재는 아직 랜딩이 없어
 * 클릭을 기록하고 안내만 띄웁니다 — 전과 같은 동작입니다.
 *
 * 나머지 장은 안내입니다(page.tsx 가 살아 있는 관만 골라 넘깁니다). 그림은 「2 / 5」 장(전문가 포트폴리오)을 보여 주므로
 * 처음에 그 장을 엽니다(start). 그 장의 그림은 주신 그림에서 그대로 잘라 낸 것(art)이고, 나머지 장은 그림 속 사진을 액자에 넣습니다(imgs).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { AdServe } from './types';
import { Line } from './Icons';

export interface PromoSlide { k: string; tag: string; title: string; desc: string; cta: string; href: string; art?: string; imgs?: string[] }

/* 시안 화면 키 → 실제 경로. 서버 소재의 landing_route 는 시안 키(reg 등)로 들어 있습니다. */
const ROUTE: Record<string, string> = {
  reg: '/register', regb: '/request/new', reqn: '/request/new', reql: '/request',
  aiprf: '/ai/profile', commu: '/community',
};
function landing(r: string | null | undefined): string | null {
  if (!r) return null;
  if (r.startsWith('/') && !r.startsWith('//')) return r;
  return ROUTE[r] ?? null;
}
const lines = (s: string) => s.split('\n').map((x, i) => <span key={i}>{x}</span>);

export function HeroPromo({ ad, slides, start = 0 }: { ad: AdServe | null; slides: PromoSlide[]; start?: number }) {
  const router = useRouter();
  const n = slides.length + (ad ? 1 : 0);
  const [i, setI] = useState(start < slides.length + (ad ? 1 : 0) ? start : 0);
  const [hold, setHold] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const sent = useRef(false);
  const onAd = !!ad && i === 0;

  /* 노출 기록 — 광고 장이 보일 때 한 번만 */
  useEffect(() => {
    if (!onAd || sent.current || !ad?.id) return;
    sent.current = true;
    fetch(`/api/v1/ads/${encodeURIComponent(ad.id)}/impression?slot=HERO`, { method: 'POST' }).catch(() => {});
  }, [onAd, ad?.id]);

  /* 7초마다 다음 장 — 올려 두었거나(hold) 「움직임 줄이기」를 켠 사람에게는 넘기지 않습니다 */
  useEffect(() => {
    if (n < 2 || hold) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % n), 7000);
    return () => window.clearInterval(t);
  }, [n, hold]);

  async function onAdCta() {
    if (!ad?.id || busy) return;
    setBusy(true);
    await fetch(`/api/v1/ads/${encodeURIComponent(ad.id)}/click?slot=HERO`, { method: 'POST' }).catch(() => {});
    setBusy(false);
    const to = landing(ad.landingRoute);
    if (to) { router.push(to); return; }
    /* v10.31 — 랜딩 주소가 없는 소재는 광고주 랜딩 미리보기(SB-ADS-LND-010 · 시안 adland)로 */
    router.push(`/ad/${encodeURIComponent(ad.id)}?from=home`);
  }

  if (n === 0) return null;
  const s = ad ? slides[i - 1] : slides[i];

  return (
    <aside className="home-promo" aria-label="소개뱅크 안내" aria-roledescription="carousel"
      onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
      <div className={`home-ps${onAd ? ' ad' : ''}`} data-slide={onAd ? 'ad' : s?.k} {...(onAd ? { 'data-adbox': 'HERO' } : {})}>
        <div className="home-ptop">
          <span className="home-ptag">{onAd ? (ad!.label ?? '광고') : s!.tag}</span>
          {n > 1 && (
            <span className="home-pnav">
              <span className="home-pno" aria-live="polite">{i + 1} / {n}</span>
              <button type="button" className="home-pnext" aria-label="다음 안내" onClick={() => { setI((x) => (x + 1) % n); setMsg(''); }}>
                <Line name="chev" size={16} w={2.6} />
              </button>
            </span>
          )}
        </div>

        {onAd ? (
          <div className="home-pbody">
            {ad!.advertiser && <span className="home-padv">{ad!.advertiser}</span>}
            <h2>{ad!.title}</h2>
            {ad!.body && <p>{ad!.body}</p>}
            {ad!.cta && (
              <button type="button" className="home-pcta" onClick={onAdCta} disabled={busy}>
                {ad!.cta} <Line name="arrow" size={18} w={2.4} />
              </button>
            )}
            {msg && <p className="home-pmsg" role="status">{msg}</p>}
            <p className="home-pwhy">
              {ad!.matchedSegment ? '관심 성향에 맞춘 광고입니다. ' : '성향 분석 전이라 전체 공개 광고가 나갑니다. '}
              <Link href="/ai/profile">성향 {ad!.matchedSegment ? '바꾸기' : '분석하기'}</Link>
              {ad!.code && <span className="home-pcode">{ad!.code}</span>}
            </p>
          </div>
        ) : s && (
          <div className="home-pbody has-art">
            <h2>{lines(s.title)}</h2>
            <p>{lines(s.desc)}</p>
            <Link className="home-pcta" href={s.href}>{s.cta} <Line name="arrow" size={18} w={2.4} /></Link>
            <span className="home-part" aria-hidden="true">
              {s.art ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="home-partimg" src={`/home/${s.art}`} alt="" loading="eager" />
              ) : (s.imgs ?? []).slice(0, 2).map((src, k) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src} className={`home-pf f${k}`} src={`/home/${src}`} alt="" loading="eager" />
              ))}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
