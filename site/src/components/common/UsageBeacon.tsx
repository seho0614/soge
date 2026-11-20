'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * v10.508 (D274 · docs/646) 회원 화면 사용 통계 — 화면이 바뀔 때 화면 주소만 한 번 보냄(POST /api/v1/site/usage/beat).
 *
 *   보내는 것: 지금 화면 주소(p) · 이 탭에서 처음 들어온 화면(e) · 둘째 화면인지(s) · 완료 화면이면 목표(g) — 그뿐입니다.
 *   보내지 않는 것: 계정 · 검색어 등 물음표 뒤 · 방문자 번호 · 브라우저 정보(서버도 저장하지 않음 · 주소의 번호는 서버가 :id 로 묶음).
 *   이 탭 안에서만 쓰는 메모(sessionStorage sgb_usage — 처음 화면 · 몇째 화면 · 표본 여부)는 탭을 닫으면 사라지고 서버로 가지 않습니다. 쿠키는 만들지 않습니다.
 *   site.usage_stats 가 꺼져 있거나 브라우저 「추적 안 함」(DNT) · GPC 이면 아무것도 하지 않습니다. 표본(site.usage_sample)은 탭마다 한 번 정함.
 */
const KEY = 'sgb_usage';
interface Memo { in: boolean; e: string | null; n: number; last: string | null }

function goalOf(path: string, search: string, last: string | null): string | undefined {
  const q = new URLSearchParams(search);
  if (path === '/signup/done') return 'SIGNUP';
  if (path === '/health/order/done') return 'ORDER';
  if (path === '/support/done') return 'INQUIRY';
  if (path.startsWith('/community/') && q.has('posted')) return 'POST';
  if (path === '/my/listings' && (q.has('published') || q.has('review'))) return 'LISTING';
  if (last?.startsWith('/request/new') && /^\/request\/[^/]+$/.test(path) && path !== '/request/new') return 'REQUEST';
  return undefined;
}

export function UsageBeacon({ settings }: { settings: Record<string, string | null> }) {
  const path = usePathname();
  const on = settings['site.usage_stats'] === 'on';
  const sample = Math.min(100, Math.max(1, Number(settings['site.usage_sample'] ?? 100) || 100));
  useEffect(() => {
    if (!on || !path || path.startsWith('/api')) return;
    try {
      const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
      if (nav.doNotTrack === '1' || nav.globalPrivacyControl === true) return;
      const raw = sessionStorage.getItem(KEY);
      let m: Memo = raw ? (JSON.parse(raw) as Memo) : { in: Math.random() * 100 < sample, e: null, n: 0, last: null };
      if (!m.in) { sessionStorage.setItem(KEY, JSON.stringify(m)); return; }
      const full = path + window.location.search;
      if (m.last === full) return;
      const body: { p: string; e?: string; s?: boolean; g?: string } = { p: path };
      if (m.e) { body.e = m.e; if (m.n === 1) body.s = true; }
      const g = goalOf(path, window.location.search, m.last);
      if (g) body.g = g;
      m = { ...m, e: m.e ?? path, n: m.n + 1, last: full };
      sessionStorage.setItem(KEY, JSON.stringify(m));
      const json = JSON.stringify(body);
      const sent = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/api/v1/site/usage/beat', new Blob([json], { type: 'application/json' }));
      if (!sent) void fetch('/api/v1/site/usage/beat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true }).catch(() => undefined);
    } catch { /* 저장소가 막힌 브라우저(사생활 보호 모드 등) — 보내지 않음 */ }
  }, [on, sample, path]);
  return null;
}
