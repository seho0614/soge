import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';

/**
 * v10.46 (D099 · docs/96) — 매물 검수 · 소재지 좌표 (SB-ADM-REV-020 안의 한 구역)
 *
 * 검수 대상이 매물일 때만 ReviewDecide 가 그립니다. 지도 사용이 꺼져 있으면(처음 값) 아무것도 그리지 않습니다 — 화면은 전과 같습니다.
 * 정확 좌표 핀은 검수자만 봅니다(사용자 화면의 남에게는 시 · 구 둘레 원).
 * 키는 화면이 들고 있지 않습니다 — JS 키는 열 때 서버(GET /site-settings/map)에서 받습니다.
 */

interface Geo { enabled: boolean; hasAddress: boolean; status: string; lat: number | null; lng: number | null;
  failKind: string | null; tries: number; geocodedAt: string | null }

const ST: Record<string, string> = { NONE: '좌표 없음', PENDING: '찾는 중', OK: '좌표 있음', FAILED: '실패', NOT_FOUND: '주소로 못 찾음' };

/* eslint-disable @typescript-eslint/no-explicit-any */
let sdkP: Promise<any> | null = null;
function loadSdk(key: string): Promise<any> {
  const w = window as any;
  if (w.kakao?.maps?.Map) return Promise.resolve(w.kakao);
  sdkP ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    s.async = true;
    s.onload = () => { const k = (window as any).kakao; if (k?.maps?.load) k.maps.load(() => res(k)); else { sdkP = null; rej(new Error('SDK')); } };
    s.onerror = () => { sdkP = null; rej(new Error('SDK')); };
    document.head.appendChild(s);
  });
  return sdkP;
}

export function ListingGeoPanel({ listingId }: { listingId: string }) {
  const [g, setG] = useState<Geo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { api<Geo>(`/admin/listings/${listingId}/geo`).then(setG).catch(() => setG(null)); }, [listingId]);

  useEffect(() => {
    if (!g?.enabled || g.lat == null || g.lng == null || !box.current) return;
    const lat = g.lat, lng = g.lng;
    let dead = false;
    api<{ enabled: boolean; jsKey: string | null }>('/site-settings/map')
      .then((c) => (c.enabled && c.jsKey ? loadSdk(c.jsKey) : null))
      .then((kakao) => {
        if (dead || !kakao || !box.current) return;
        const pos = new kakao.maps.LatLng(lat, lng);
        const map = new kakao.maps.Map(box.current, { center: pos, level: 3 });
        new kakao.maps.Marker({ position: pos }).setMap(map);
      })
      .catch(() => { if (!dead) setMsg('지도를 불러오지 못했습니다 — 카카오 콘솔의 사이트 도메인(admin.sogaebank.com)을 확인하십시오.'); });
    return () => { dead = true; };
  }, [g?.enabled, g?.lat, g?.lng]);

  if (!g || !g.enabled) return null;

  const retry = () => {
    setBusy(true); setMsg(null);
    api<Geo>(`/admin/listings/${listingId}/geo/retry`, { method: 'POST' })
      .then((r) => { setG(r); setMsg(r.status === 'OK' ? '좌표를 찾았습니다.' : `다시 찾지 못했습니다(${r.failKind ?? r.status}).`); })
      .catch((e) => setMsg(e?.message ?? '실패했습니다.'))
      .finally(() => setBusy(false));
  };
  const canRetry = g.hasAddress && (g.status === 'FAILED' || g.status === 'NOT_FOUND' || g.status === 'NONE');

  return (
    <div data-listing-geo>
      <h3 className="ad-s3">소재지 좌표</h3>
      <div className="ad-dsum">
        <div><span>상태</span><b>{ST[g.status] ?? g.status}{g.failKind ? ` · ${g.failKind}` : ''}</b></div>
        <div><span>좌표</span><b className="mono">{g.lat != null && g.lng != null ? `${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}` : '—'}</b></div>
        <div><span>시도</span><b>{g.tries}회</b></div>
      </div>
      {g.lat != null && g.lng != null && (
        <div ref={box} role="img" aria-label="매물 소재지 지도"
             style={{ height: 200, borderRadius: 'var(--sgb-r-sm)', border: '1px solid var(--line)', overflow: 'hidden', margin: '8px 0' }} />
      )}
      {canRetry && <button className="btn-sm" disabled={busy} onClick={retry}>다시 변환</button>}
      {msg && <p className="hint" role="status">{msg}</p>}
    </div>
  );
}
