'use client';
/** v10.31 — 메인 머리줄의 로그아웃(시안). 서버 동작(lib/session logout — httpOnly 쿠키를 지움) 뒤 화면을 다시 그립니다 */
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { logout } from '@/lib/session';
import { useTranslations } from 'next-intl';

export function HomeLogout() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const h = useTranslations('header');
  return (
    <button type="button" className="home-pill" disabled={busy} onClick={() => start(async () => { await logout(); router.refresh(); })}>
      {busy ? h('loggingOut') : h('logout')}
    </button>
  );
}
