'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import '@/styles/kmap.css';

/**
 * v10.46 (docs/96) — 카카오 지도 부품.
 *
 * ── 키는 빌드에 넣지 않습니다 ─────────────────────────────────────────
 * JavaScript 키는 운영 화면(외부 연동 › MAP)에서 넣고, 화면이 열릴 때 GET /api/v1/site-settings/map 으로 받습니다.
 * 그래서 키를 바꿔도 다시 빌드할 필요가 없습니다. 운영 화면 값이 없으면 서버가 .env 의 NEXT_PUBLIC_KAKAO_JS_KEY 를 줍니다.
 * 둘 다 없거나 「사용」이 꺼져 있으면 enabled=false — 이 부품은 아무것도 그리지 않고 fallback 을 보여 줍니다.
 *
 * ── 정밀도 ─────────────────────────────────────────────────────────────
 *   EXACT   핀 — 등록자 본인 · 운영 · 공개된 영업장(맛집)
 *   REGION  시 · 구 둘레 원 · 핀 없음 · 레벨 7 보다 가깝게 확대하지 못함(골목이 보이지 않게)
 * 서버가 정밀도를 정해 내려 줍니다(남에게는 REGION 만). 이 부품은 받은 대로 그릴 뿐 좌표를 바꾸지 않습니다.
 *
 * ── 받는 시점 ──────────────────────────────────────────────────────────
 * 지도 칸이 화면에 들어올 때 처음 받습니다. 지도 호출 수(kakao.maps.Map 생성)가 쿼터로 세어지므로
 * 보지 않는 지도는 만들지 않습니다. SDK 는 한 페이지에 한 번만 받습니다.
 *
 * ── 실패해도 화면은 그대로 ─────────────────────────────────────────────
 * SDK 를 못 받거나(차단 · 도메인 미등록 · 「카카오맵」 사용 꺼짐) 주소를 못 찾으면 fallback 을 보여 줍니다.
 * 카카오 로고 · 저작권 표시는 가리지 않습니다(이용 조건).
 */

export type GeoPrecision = 'EXACT' | 'REGION';
export interface MapGeo { precision: GeoPrecision; lat: number; lng: number; radiusM?: number; label?: string }
export interface MapPin { id: string; lat: number; lng: number; title: string; count?: number }

interface MapConfig { enabled: boolean; jsKey: string | null }

/* eslint-disable @typescript-eslint/no-explicit-any */
type KakaoNS = any;

let cfgP: Promise<MapConfig> | null = null;
export function mapConfig(): Promise<MapConfig> {
  cfgP ??= fetch('/api/v1/site-settings/map', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : { enabled: false, jsKey: null }))
    .then((c: MapConfig) => ({ enabled: !!c.enabled && !!c.jsKey, jsKey: c.jsKey ?? null }))
    .catch(() => { cfgP = null; return { enabled: false, jsKey: null }; });
  return cfgP;
}

let sdkP: Promise<KakaoNS> | null = null;
export function loadKakaoMaps(jsKey: string): Promise<KakaoNS> {
  const w = window as unknown as { kakao?: KakaoNS };
  if (w.kakao?.maps?.Map) return Promise.resolve(w.kakao);
  sdkP ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(jsKey)}&autoload=false&libraries=services`;
    s.async = true;
    s.onload = () => {
      const k = (window as unknown as { kakao?: KakaoNS }).kakao;
      if (!k?.maps?.load) { sdkP = null; reject(new Error('SDK')); return; }
      k.maps.load(() => resolve(k));
    };
    s.onerror = () => { sdkP = null; reject(new Error('SDK')); };
    document.head.appendChild(s);
  });
  return sdkP;
}

/** 칸이 화면에 들어오면 true. IntersectionObserver 가 없는 브라우저는 바로 true. */
function useVisible(ref: React.RefObject<HTMLElement | null>) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || on) return;
    if (typeof IntersectionObserver === 'undefined') { setOn(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setOn(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, on]);
  return on;
}

const REGION_MIN_LEVEL = 7;
const REGION_RADIUS = 2000;

interface Props {
  /** 서버가 준 좌표. null 이면 fallback */
  geo?: MapGeo | null;
  /** 미리보기 — 좌표 대신 주소 글자(등록 화면 · 본인만). 브라우저에서 찾고 저장하지 않습니다 */
  previewAddress?: string;
  /** 미리보기를 원으로(요청 등록 — 희망 지역) */
  previewPrecision?: GeoPrecision;
  height?: number;
  /** 지도를 그리지 못할 때 보여 줄 것(지금의 안내 칸) */
  fallback?: React.ReactNode;
  /** 지도 아래 한 줄 안내 */
  caption?: React.ReactNode;
  className?: string;
}

export function KakaoMap({ geo, previewAddress, previewPrecision = 'EXACT', height = 200, fallback = null, caption, className }: Props) {
  /* 「사용」이 켜져 있다고 확인되기 전까지는 지금 화면(fallback)을 그대로 둡니다 — 꺼져 있으면 화면이 한 번도 바뀌지 않습니다 */
  const t = useTranslations('refcode.map');
  const watch = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const visible = useVisible(watch);
  const [state, setState] = useState<'idle' | 'show' | 'ready' | 'off'>('idle');
  const [kakao, setKakao] = useState<KakaoNS>(null);
  const want = !!geo || !!previewAddress?.trim();
  /* 같은 좌표 · 주소로는 한 번만 그립니다(지도 생성 = 카카오 쿼터 1건) */
  const drawn = useRef<string | null>(null);
  const drawKey = geo ? `${geo.precision}:${geo.lat}:${geo.lng}` : `${previewPrecision}:${previewAddress ?? ''}`;

  useEffect(() => {
    if (!visible || !want || kakao) return;
    let dead = false;
    (async () => {
      try {
        const c = await mapConfig();
        if (!c.enabled || !c.jsKey) { if (!dead) setState('off'); return; }
        const k = await loadKakaoMaps(c.jsKey);
        if (!dead) { setKakao(k); setState('show'); }
      } catch { if (!dead) setState('off'); }
    })();
    return () => { dead = true; };
  }, [visible, want, kakao]);

  useEffect(() => {
    if (!kakao || !want || state !== 'show') return;
    if (drawn.current === drawKey && box.current?.childElementCount) { setState('ready'); return; }
    let dead = false;
    (async () => {
      let g: MapGeo | null = geo ?? null;
      if (!g && previewAddress) {
        g = await new Promise<MapGeo | null>((res) => {
          new kakao.maps.services.Geocoder().addressSearch(previewAddress, (r: { x: string; y: string }[], st: string) =>
            res(st === kakao.maps.services.Status.OK && r[0] ? { precision: previewPrecision, lat: Number(r[0].y), lng: Number(r[0].x) } : null));
        });
      }
      if (dead) return;
      if (!g || !box.current) { setState('off'); return; }
      draw(kakao, box.current, g);
      drawn.current = drawKey;
      setState('ready');
    })().catch(() => { if (!dead) setState('off'); });
    return () => { dead = true; };
  }, [kakao, state, want, drawKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 주소 · 좌표가 바뀌면 다시 그립니다(그려 둔 것과 다를 때만) */
  useEffect(() => { if (kakao && want && drawn.current !== drawKey && (state === 'ready' || state === 'off')) setState('show'); }, [drawKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!want || state === 'idle' || state === 'off') return <div ref={watch} data-kmap-watch="">{fallback}</div>;
  return (
    <div className={`kmap${className ? ' ' + className : ''}`} data-kmap={geo?.precision ?? previewPrecision}>
      <div ref={box} className="kmap-box" style={{ height }} role="img"
           aria-label={(geo?.precision ?? previewPrecision) === 'REGION' ? t('regionAria', { label: geo?.label ?? '' }) : t('locationAria')} />
      {state === 'show' && <div className="kmap-wait" aria-hidden="true">{t('loading')}</div>}
      {caption && <div className="kmap-cap">{caption}</div>}
    </div>
  );
}

function draw(kakao: KakaoNS, el: HTMLElement, g: MapGeo) {
  el.innerHTML = '';
  const center = new kakao.maps.LatLng(g.lat, g.lng);
  if (g.precision === 'REGION') {
    const map = new kakao.maps.Map(el, { center, level: 8 });
    map.setMinLevel?.(REGION_MIN_LEVEL);
    new kakao.maps.Circle({
      center, radius: g.radiusM ?? REGION_RADIUS,
      strokeWeight: 2, strokeColor: '#1F5FD1', strokeOpacity: 0.8, fillColor: '#1F5FD1', fillOpacity: 0.12,
    }).setMap(map);
  } else {
    const map = new kakao.maps.Map(el, { center, level: 3 });
    new kakao.maps.Marker({ position: center }).setMap(map);
  }
}

/**
 * 여러 핀(맛집 지도 · v10.47 에서 씁니다). 지도를 옮기면 onBounds 로 화면 네 모서리를 알려 줍니다.
 * 핀은 서버가 준 공개 장소(영업장)만 — 개인 위치는 여기에 오지 않습니다.
 */
export function KakaoPinMap({ pins, center, height = 420, onBounds, onPick, fallback = null, className, mapRef }: {
  pins: MapPin[]; center: { lat: number; lng: number; level?: number };
  height?: number; fallback?: React.ReactNode; className?: string;
  onBounds?: (b: { swLat: number; swLng: number; neLat: number; neLng: number }) => void;
  onPick?: (id: string) => void;
  /** 바깥에서 지도를 옮길 때(동네 고르기 · 현재 위치로) */
  mapRef?: React.MutableRefObject<{ moveTo: (lat: number, lng: number, level?: number) => void } | null>;
}) {
  const t = useTranslations('refcode.map');
  const box = useRef<HTMLDivElement>(null);
  const visible = useVisible(box);
  const [state, setState] = useState<'idle' | 'ready' | 'off'>('idle');
  const mapObj = useRef<KakaoNS>(null);
  const kakaoObj = useRef<KakaoNS>(null);
  const markers = useRef<KakaoNS[]>([]);
  const cb = useRef({ onBounds, onPick });
  cb.current = { onBounds, onPick };

  useEffect(() => {
    if (!visible) return;
    let dead = false;
    (async () => {
      try {
        const c = await mapConfig();
        if (!c.enabled || !c.jsKey) { if (!dead) setState('off'); return; }
        const kakao = await loadKakaoMaps(c.jsKey);
        if (dead || !box.current) return;
        const map = new kakao.maps.Map(box.current, { center: new kakao.maps.LatLng(center.lat, center.lng), level: center.level ?? 5 });
        mapObj.current = map; kakaoObj.current = kakao;
        const emit = () => {
          const b = map.getBounds(); const sw = b.getSouthWest(); const ne = b.getNorthEast();
          cb.current.onBounds?.({ swLat: sw.getLat(), swLng: sw.getLng(), neLat: ne.getLat(), neLng: ne.getLng() });
        };
        kakao.maps.event.addListener(map, 'idle', emit);
        if (mapRef) mapRef.current = { moveTo: (lat, lng, level) => { if (level) map.setLevel(level); map.setCenter(new kakao.maps.LatLng(lat, lng)); } };
        setState('ready');
        emit();
      } catch { if (!dead) setState('off'); }
    })();
    return () => { dead = true; };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapObj.current, kakao = kakaoObj.current;
    if (state !== 'ready' || !map || !kakao) return;
    markers.current.forEach((m) => m.setMap(null));
    markers.current = pins.map((p) => {
      const m = new kakao.maps.Marker({ position: new kakao.maps.LatLng(p.lat, p.lng), title: p.count ? t('pinTitle', { title: p.title, n: String(p.count) }) : p.title });
      m.setMap(map);
      kakao.maps.event.addListener(m, 'click', () => cb.current.onPick?.(p.id));
      return m;
    });
  }, [pins, state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'off') return <>{fallback}</>;
  return (
    <div className={`kmap${className ? ' ' + className : ''}`} data-kmap="PINS">
      <div ref={box} className="kmap-box" style={{ height }} role="application" aria-label={t('pinAria')} />
      {state === 'idle' && <div className="kmap-wait" aria-hidden="true">{t('loading')}</div>}
    </div>
  );
}
