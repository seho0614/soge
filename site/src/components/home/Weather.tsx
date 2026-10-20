'use client';
/**
 * v10.49 (D103 · docs/101) — 메인 「오늘의 날씨」 한 줄 띠 (SB-HOM-MAIN-010 · 011 · 히어로 바로 아래)
 *
 *   지역 ▾ | 지금 기온 · 하늘 | 오늘 최저 · 최고 | 강수확률 | 습도 | 기상청 제공 · N시 관측
 *
 * 자료는 page.tsx 가 GET /weather/today?region= 로 받아 넘깁니다(10분 캐시). available=false 면 HomeView 가 이 띠를 그리지 않습니다.
 * 지역을 고르면 쿠키(WX_COOKIE · 1년)에 적고 화면을 새로 받습니다 — 위치 허용 창은 띄우지 않습니다(대표 결정 2026-10-20).
 * 시각 글자(observedAt)는 서버가 만든 것을 그대로 씁니다 — 서버와 브라우저의 시계가 달라 수화가 어긋나지 않게.
 */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { WX_COOKIE, type WeatherToday } from './types';

function WxIcon({ name }: { name: NonNullable<WeatherToday['icon']> }) {
  const p = { width: 30, height: 30, viewBox: '0 0 32 32', fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  const cloud = <path d="M10 24h13a5 5 0 0 0 .6-9.96A7 7 0 0 0 10.2 15 4.5 4.5 0 0 0 10 24Z" stroke="#7C8AA5" fill="#EEF2F8" />;
  switch (name) {
    case 'sun':
      return (<svg {...p}><circle cx="16" cy="16" r="6" fill="#FFC53D" stroke="#F5A300" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} x1="16" y1="3.5" x2="16" y2="6.5" stroke="#F5A300" transform={`rotate(${a} 16 16)`} />)}</svg>);
    case 'partly':
      return (<svg {...p}><circle cx="12" cy="11" r="5" fill="#FFC53D" stroke="#F5A300" />{cloud}</svg>);
    case 'cloud':
      return <svg {...p}>{cloud}</svg>;
    case 'rain':
      return (<svg {...p}><g transform="translate(0 -4)">{cloud}</g>
        {[11, 16, 21].map((x) => <line key={x} x1={x} y1="23" x2={x - 1.5} y2="28" stroke="#3B82F6" />)}</svg>);
    case 'snow':
      return (<svg {...p}><g transform="translate(0 -4)">{cloud}</g>
        {[11, 16, 21].map((x) => <circle key={x} cx={x} cy="26" r="1.4" fill="#93C5FD" stroke="#60A5FA" strokeWidth={1} />)}</svg>);
    default:
      return (<svg {...p}><g transform="translate(0 -4)">{cloud}</g>
        <line x1="11" y1="23" x2="9.5" y2="28" stroke="#3B82F6" /><circle cx="16" cy="26" r="1.4" fill="#93C5FD" stroke="#60A5FA" strokeWidth={1} />
        <line x1="21" y1="23" x2="19.5" y2="28" stroke="#3B82F6" /></svg>);
  }
}

export function Weather({ w }: { w: WeatherToday }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function pick(code: string) {
    try { document.cookie = `${WX_COOKIE}=${encodeURIComponent(code)}; path=/; max-age=31536000; samesite=lax`; } catch { /* 쿠키를 막은 브라우저 — 이번만 처음 지역 */ }
    start(() => router.refresh());
  }

  return (
    <section className="home-wx" aria-labelledby="home-wx-h" data-weather={w.region}>
      <div className="home-in">
        <div className={`home-wxin${pending ? ' busy' : ''}`} aria-busy={pending}>
          <h2 id="home-wx-h" className="home-wxt">오늘의 날씨</h2>
          <select className="home-wxsel" value={w.region} aria-label="날씨 지역 고르기" disabled={pending}
                  onChange={(e) => pick(e.target.value)}>
            {w.regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
          </select>
          <span className="home-wxnow">
            {w.icon && <WxIcon name={w.icon} />}
            <b>{w.temp}°</b>{w.label && <span>{w.label}</span>}
          </span>
          {(w.min !== null || w.max !== null) && (
            <span className="home-wxi">최저 <b>{w.min ?? '–'}°</b> · 최고 <b>{w.max ?? '–'}°</b></span>
          )}
          {w.pop !== null && <span className="home-wxi">강수 <b>{w.pop}%</b></span>}
          {w.humidity !== null && <span className="home-wxi">습도 <b>{w.humidity}%</b></span>}
          <span className="home-wxsrc">{w.source} 제공{w.observedAt ? ` · ${w.observedAt} 기준` : ''}</span>
        </div>
      </div>
    </section>
  );
}
