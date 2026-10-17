'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KakaoPinMap, loadKakaoMaps, mapConfig, type MapPin } from '@/components/map/KakaoMap';

/**
 * v10.47 (D100 · docs/98) — 우리동네 맛집 지도 + 목록 (SB-HOM-CMU-050)
 *
 *   지도를 옮기면 보이는 네 모서리로 GET /community/food/places 를 다시 읽습니다(0.3초 기다렸다가 · 마지막 것만).
 *   동네 고르기 — ① 가게가 있는 동네 칩(서버가 준 시 · 구) ② 동네 이름 입력(브라우저의 카카오 주소 검색) ③ 「현재 위치로」(설정이 켜졌을 때만)
 *   ★ 이용자 위치는 서버로 보내지 않습니다. 「현재 위치로」도 브라우저가 지도를 옮길 뿐이고, 서버는 지도 범위만 받습니다.
 */

interface Pin { id: string; name: string; category: string | null; address: string | null; region: string; lat: number; lng: number; count: number; picks: number }
interface Region { sido: string; sigungu: string; count: number; lat: number; lng: number }

const START = { lat: 37.5665, lng: 126.978, level: 6 };   // 서울시청 — 동네를 고르기 전 처음 자리

export function FoodMap({ regions, geolocation, loggedIn }: { regions: Region[]; geolocation: boolean; loggedIn: boolean }) {
  const first = regions[0];
  const [items, setItems] = useState<Pin[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [q, setQ] = useState('');
  const [town, setTown] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [on, setOn] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mapRef = useRef<{ moveTo: (lat: number, lng: number, level?: number) => void } | null>(null);
  const bounds = useRef<{ swLat: number; swLng: number; neLat: number; neLng: number } | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qRef = useRef('');
  qRef.current = q;

  const load = useCallback(() => {
    const b = bounds.current;
    if (!b) return;
    const my = ++seq.current;
    const qs = new URLSearchParams({
      swLat: b.swLat.toFixed(6), swLng: b.swLng.toFixed(6), neLat: b.neLat.toFixed(6), neLng: b.neLng.toFixed(6),
    });
    if (qRef.current.trim()) qs.set('q', qRef.current.trim());
    setLoading(true);
    fetch(`/api/v1/community/food/places?${qs}`, { headers: { Accept: 'application/json' } })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (my !== seq.current) return;
        if (!ok) { setMsg(d?.message ?? '가게를 불러오지 못했습니다.'); setItems([]); return; }
        setMsg(null); setItems(d.items ?? []); setTruncated(!!d.truncated);
      })
      .catch(() => { if (my === seq.current) setMsg('가게를 불러오지 못했습니다. 잠시 후 다시 해 주십시오.'); })
      .finally(() => { if (my === seq.current) setLoading(false); });
  }, []);

  const onBounds = useCallback((b: { swLat: number; swLng: number; neLat: number; neLng: number }) => {
    bounds.current = b;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(load, 300);
  }, [load]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function goTown(e?: React.FormEvent) {
    e?.preventDefault();
    const t = town.trim();
    if (!t) return;
    setMsg(null);
    try {
      const c = await mapConfig();
      if (!c.jsKey) return;
      const kakao = await loadKakaoMaps(c.jsKey);
      new kakao.maps.services.Geocoder().addressSearch(t, (r: { x: string; y: string }[], st: string) => {
        if (st === kakao.maps.services.Status.OK && r[0]) mapRef.current?.moveTo(Number(r[0].y), Number(r[0].x), 5);
        else setMsg(`「${t}」을(를) 찾지 못했습니다 — 예) 분당구 정자동 · 마포구 연남동`);
      });
    } catch { setMsg('동네를 찾지 못했습니다.'); }
  }

  function here() {
    if (!navigator.geolocation) { setMsg('이 브라우저는 현재 위치를 지원하지 않습니다.'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => mapRef.current?.moveTo(p.coords.latitude, p.coords.longitude, 4),   // 지도만 옮김 — 서버로 보내지 않음
      () => setMsg('현재 위치를 쓸 수 없습니다(브라우저에서 위치 권한을 막았거나 꺼져 있음).'),
      { maximumAge: 60_000, timeout: 8000 });
  }

  const pins: MapPin[] = items.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, title: p.name, count: p.count }));

  return (
    <>
      <form className="fd-bar" onSubmit={goTown} role="search" aria-label="동네 고르기">
        <input value={town} onChange={(e) => setTown(e.target.value)} placeholder="동네 이름 — 예) 분당구 정자동" aria-label="동네 이름" maxLength={40} />
        <button type="submit">동네로 이동</button>
        {geolocation && <button type="button" onClick={here} title="브라우저 안에서 지도만 옮깁니다 — 위치를 저장하지 않습니다">📍 현재 위치로</button>}
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); load(); } }}
               placeholder="가게 이름" aria-label="가게 이름으로 거르기" maxLength={40} />
        <button type="button" onClick={load}>거르기</button>
      </form>
      {regions.length > 0 && (
        <div className="fd-chips" aria-label="가게가 있는 동네">
          {regions.slice(0, 12).map((r) => (
            <button key={`${r.sido} ${r.sigungu}`} type="button" className="fd-chip" onClick={() => mapRef.current?.moveTo(r.lat, r.lng, 6)}>
              {r.sido} {r.sigungu}<em>{r.count}</em>
            </button>
          ))}
        </div>
      )}
      <div className="fd-grid">
        <KakaoPinMap pins={pins} center={first ? { lat: first.lat, lng: first.lng, level: 6 } : START} height={440}
          onBounds={onBounds} onPick={setOn} mapRef={mapRef}
          fallback={<p className="fd-empty">지도를 불러오지 못했습니다. 잠시 후 새로 고침해 주십시오.</p>} />
        <div>
          <ul className="fd-list" aria-live="polite" aria-busy={loading}>
            {items.length === 0 ? (
              <li className="fd-empty">{loading ? '불러오는 중…' : '이 지도 안에는 아직 소개된 맛집이 없습니다. 첫 소개를 남겨 주십시오.'}</li>
            ) : items.map((p) => (
              <li key={p.id} className={on === p.id ? 'on' : undefined}>
                <Link href={`/community/food/${p.id}`}>
                  <div className="fd-nm">{p.name}{p.picks > 0 && <span className="fd-badge pick">동네픽</span>}</div>
                  <div className="fd-sub">{[p.category?.split('>').pop()?.trim(), p.region].filter(Boolean).join(' · ')}</div>
                  <div className="fd-cnt">이웃 추천 {p.count}</div>
                </Link>
              </li>
            ))}
          </ul>
          {truncated && <p className="fd-note">가게가 많아 200곳까지만 보입니다 — 지도를 확대하십시오.</p>}
          {msg && <p className="fd-note" role="alert">{msg}</p>}
          <p className="fd-note">
            {loggedIn ? <Link className="fd-cta" href="/community/food/write">맛집 소개하기</Link>
              : <Link className="fd-cta" href="/login?next=/community/food/write">로그인하고 맛집 소개하기</Link>}
          </p>
        </div>
      </div>
    </>
  );
}
