/**
 * 결제창(토스) 공개 키(v10.128 · docs/192) — 운영 화면 › 외부 연동 › 「연동 키」에서 넣은 값을 API 가 줍니다(없으면 서버 .env).
 *   빌드 때 굳히던 NEXT_PUBLIC_TOSS_CLIENT_KEY 를 대신합니다 — 키를 바꿔도 다시 빌드할 필요가 없습니다.
 *   const { key, ready } = useTossClientKey();   key 가 '' 이면 시험 결제(스텁) · ready 전에는 결제 단추를 막습니다.
 *   API 를 못 부르면 결제 단추를 막아 둡니다(빌드 때 값으로 결제하면 서버 승인과 어긋날 수 있음). 1분 동안 기억합니다.
 */
'use client';
import { useEffect, useState } from 'react';

const KEEP_MS = 60_000;
let once: { at: number; p: Promise<string | null> } | null = null;

function load(): Promise<string | null> {
  if (!once || Date.now() - once.at > KEEP_MS) {
    const p = fetch('/api/v1/site-settings/payment', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b: { clientKey?: string | null }) => b.clientKey ?? '')
      .catch(() => { once = null; return null; });   // null = 못 받음
    once = { at: Date.now(), p };
  }
  return once.p;
}

export function useTossClientKey(): { key: string; ready: boolean } {
  const [state, setState] = useState({ key: '', ready: false });
  useEffect(() => {
    let live = true;
    void load().then((key) => { if (live && key !== null) setState({ key, ready: true }); });
    return () => { live = false; };
  }, []);
  return state;
}
