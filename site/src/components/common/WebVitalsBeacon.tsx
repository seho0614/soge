'use client';
import { useRef } from 'react';
import { useReportWebVitals } from 'next/web-vitals';

/**
 * v10.588 (docs/730) 14차 운영 ④ 화면 속도(웹 바이탈) — 브라우저가 잰 값 하나씩 POST /api/v1/site/vitals.
 *
 *   보내는 것: 지금 화면 주소(p · 물음표 뒤 없음) · 지표 이름(n — LCP · INP · CLS · FCP · TTFB) · 값(v) — 그뿐입니다.
 *   보내지 않는 것: 계정 · 방문자 번호 · 브라우저 정보 · 쿠키(서버도 저장하지 않음 · 주소의 번호는 서버가 :id 로 묶음).
 *   이 탭 안에서만 쓰는 메모(sessionStorage sgb_vitals — 표본 여부)는 탭을 닫으면 사라지고 서버로 가지 않습니다.
 *   ops2.web_vitals 가 꺼져 있거나(처음 off) 브라우저 「추적 안 함」(DNT) · GPC 이면 아무것도 하지 않습니다(UsageBeacon 과 같은 규칙).
 */
const KEY = 'sgb_vitals';
const WANT = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'];

function sampled(sample: number): boolean {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === '1' || raw === '0') return raw === '1';
    const yes = Math.random() * 100 < sample;
    sessionStorage.setItem(KEY, yes ? '1' : '0');
    return yes;
  } catch { return false; }   // 저장소가 막힌 브라우저 — 보내지 않음
}

export function WebVitalsBeacon({ settings }: { settings: Record<string, string | null> }) {
  const on = settings['ops2.web_vitals'] === 'on';
  const sample = Math.min(100, Math.max(1, Number(settings['ops2.web_vitals_sample'] ?? 10) || 10));
  const conf = useRef({ on, sample });
  conf.current = { on, sample };
  useReportWebVitals((m) => {
    const c = conf.current;
    if (!c.on || !WANT.includes(m.name)) return;
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.doNotTrack === '1' || nav.globalPrivacyControl === true) return;
    const path = window.location.pathname;
    if (!path || path.startsWith('/api') || !sampled(c.sample)) return;
    const v = m.name === 'CLS' ? Math.round(m.value * 10000) / 10000 : Math.round(m.value);
    const json = JSON.stringify({ p: path, n: m.name, v });
    try {
      const sent = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/api/v1/site/vitals', new Blob([json], { type: 'application/json' }));
      if (!sent) void fetch('/api/v1/site/vitals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true, credentials: 'omit' }).catch(() => undefined);
    } catch { /* 보내기 실패는 무시 */ }
  });
  return null;
}
