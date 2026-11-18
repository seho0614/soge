import { useEffect, useRef, useState } from 'react';
import { setToken } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { siteHref } from '../../lib/siteUrl';

interface Info { idleMin: number; refreshDays: number; password: { changedAt: string | null; days: number | null; maxDays: number; old: boolean } }

/**
 * 운영자 세션 (v10.357 · 360 · D236 · docs/491 · 494) — 운영 화면 맨 위(로그인한 동안)
 *
 * ① 자동 로그아웃: ops.admin_idle_min(처음 30분) 동안 마우스 · 자판 · 누름 · 스크롤이 없으면 1분 전 띠 → 로그아웃.
 *    탭이 여러 개면 가장 최근에 만진 때를 함께 봄(localStorage) — 저장소가 막힌 브라우저는 이 탭만.
 * ④ 비밀번호를 바꾼 지 90일이 넘으면 띠 — 바꾸기는 사용자 웹 › 나의공간 › 계정(막지는 않음).
 */
const KEY = 'sgb_bo_last_act';
const now = () => Date.now();
function lastAct(mine: number) {
  try { return Math.max(mine, Number(localStorage.getItem(KEY)) || 0); } catch { return mine; }
}

export function StaffSession() {
  const q = useApi<Info>('/auth/staff-session');
  const mine = useRef(now());
  const [left, setLeft] = useState<number | null>(null);
  const idleMs = (q.data?.idleMin ?? 30) * 60_000;

  useEffect(() => {
    const touch = () => {
      mine.current = now();
      try { localStorage.setItem(KEY, String(mine.current)); } catch { /* 저장소가 막힌 브라우저 */ }
    };
    const ev = ['mousemove', 'keydown', 'mousedown', 'scroll', 'touchstart'] as const;
    ev.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    touch();
    const t = setInterval(() => {
      const rest = idleMs - (now() - lastAct(mine.current));
      if (rest <= 0) { setToken(null, null); return; }
      setLeft(rest <= 60_000 ? Math.ceil(rest / 1000) : null);
    }, 1000);
    return () => { ev.forEach((e) => window.removeEventListener(e, touch)); clearInterval(t); };
  }, [idleMs]);

  const pw = q.data?.password;
  return (
    <>
      {left != null && (
        <div className="bo-order-live" role="alert" data-idle-warn={left}>
          <b>{left}초 뒤 자동 로그아웃합니다</b> — {q.data?.idleMin ?? 30}분 동안 움직임이 없었습니다. 마우스를 움직이거나 자판을 누르면 이어집니다.
        </div>
      )}
      {pw?.old && (
        <div className="ad-nt warn" data-pw-old-bar={pw.days ?? ''} style={{ margin: '8px 16px' }}>
          <b>비밀번호를 바꾼 지 {pw.days}일이 지났습니다</b>(운영 역할은 {pw.maxDays}일마다 권함 · 12자 이상 · 최근 3개는 다시 못 씀) —{' '}
          <a href="#/my-password" data-pw-old-go="">권한 계층 › 내 비밀번호에서 바꾸기</a>{' · '}
          <a href={siteHref('/my/account')} target="_blank" rel="noreferrer">사용자 웹 › 나의공간 › 계정에서 바꾸기</a>
        </div>
      )}
    </>
  );
}
