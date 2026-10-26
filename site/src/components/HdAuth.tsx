'use client';
/**
 * 기본 머리줄의 오른쪽 묶음 — v10.26 (G-181) 로그인 칸 · v10.29 시안 모양(proto_lite.html header() 의 .hr).
 *
 * 시안 그대로:
 *   로그인 전   🔔 · [로그인](테두리 단추) · [무료 회원가입](보라 단추)
 *   로그인 뒤   👤 회원 | 나의공간 | 고객센터 · 🔔 · [로그아웃]
 * 개발에만 있던 것 — 없애지 않고 같은 묶음 안에(diffs 기록):
 *   「소개받기 · 파트너센터」(언제나) · 「나의공간」(로그인 전에도) · 검색 돋보기(같은 검색 팝업을 엶)
 * v10.31 — 시안 「관리자 페이지」(보라 단추)를 운영 역할에게만 보입니다(/go/admin → BO). 권한 검사는 BO · 서버가 합니다.
 *
 * 머리줄은 서버에서 한 번 그려 모든 사람에게 같은 것을 내보내고(쿠키를 읽지 않음), 사람마다 다른 이 칸만 브라우저에서 받습니다:
 *   GET /cart-count → 로그인했는지(in). 로그인했으면 GET /api/v1/me/summary → 안 읽은 알림 수(🔔 배지).
 *   v10.31 (w3 결함 · 공유 파일 작게) — 답이 오기 전에는 「모름」 상태로 로그인 · 회원가입 · 로그아웃 단추를 그리지 않고(자리만 둠),
 *   지난번에 받은 답(sessionStorage)이 있으면 그것으로 바로 그립니다. 전에는 처음에 로그인 전 모양으로 그려, 로그인한 사람에게도
 *   서버가 느리면 「로그인 · 무료 회원가입」이 잠깐(또는 오래) 보였습니다. 화면을 옮길 때마다 다시 받습니다.
 * v10.31 (w1) — 이름: 시안 「👤 이름」 — /me/summary 의 displayName(인증 사업자면 회사명 · 아니면 이름). 본인 것만 보입니다.
 * 로그아웃은 서버 동작(lib/session.ts 의 logout — httpOnly 쿠키 두 개를 지움)입니다.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { logout } from '@/lib/session';
import { clearDraft } from '@/lib/profileDraft';
import { SearchBox } from '@/components/search/SearchBox';
import { isOps } from '@/components/common/links';
import { useTranslations } from 'next-intl';

export function HdAuth() {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [inn, setIn] = useState<boolean | null>(null);     // null = 아직 모름
  const [unread, setUnread] = useState(0);
  const [name, setName] = useState<string | null>(null);
  const [ops, setOps] = useState(false);
  const [busy, start] = useTransition();
  const t = useTranslations('header');

  useEffect(() => {
    let live = true;
    try { const k = sessionStorage.getItem('sgb.hd.in'); if (k === '1' || k === '0') setIn((v) => (v === null ? k === '1' : v)); } catch { /* 저장소를 못 쓰면 답을 기다립니다 */ }
    fetch('/cart-count', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (j) => {
        if (!live || !j) return;
        const yes = j.in === true;
        setIn(yes);
        try { sessionStorage.setItem('sgb.hd.in', yes ? '1' : '0'); } catch { /* 없어도 됨 */ }
        if (!yes) { setUnread(0); return; }
        const s = await fetch('/api/v1/me/summary', { credentials: 'same-origin', cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (!live) return;
        setUnread(Number(s?.unreadNotifications) > 0 ? Number(s.unreadNotifications) : 0);
        setName(typeof s?.displayName === 'string' && s.displayName.trim() ? s.displayName.trim() : null);
        setOps(isOps(s?.principal?.roles));
      })
      .catch(() => { if (live) setIn((v) => (v === null ? false : v)); /* 못 받으면 로그인하지 않은 모양 */ });
    return () => { live = false; };
  }, [pathname]);

  function out() {
    start(async () => {
      clearDraft();   // v10.120 — 로그인 전 성향 답이 같은 탭의 다음 계정에 채워지지 않게
      await logout();
      setIn(false);
      try { sessionStorage.setItem('sgb.hd.in', '0'); } catch { /* 없어도 됨 */ }
      setUnread(0);
      router.refresh();      // 로그인해야 보이는 화면이면 서버가 로그인 화면으로 보냅니다
    });
  }

  const on = (href: string) => (pathname === href || pathname.startsWith(href + '/') ? 'on' : undefined);
  const bell = (
    <Link href="/my/notifications" className="pc-bell" title={t('bell')} aria-label={unread ? t('bellUnread', { n: unread }) : t('bell')}>
      🔔{unread > 0 && <i>{unread > 9 ? '9+' : unread}</i>}
    </Link>
  );
  /* 개발에만 있는 링크 */
  const dev = (
    <>
      <Link href="/request" className={['txt dev', on('/request')].filter(Boolean).join(' ')}>{t('request')}</Link>
      <span className="sep">|</span>
      <Link href="/partners" className={['txt dev', on('/partners')].filter(Boolean).join(' ')}>{t('partners')}</Link>
      <span className="sep">|</span>
    </>
  );

  if (inn === null) {
    /* 아직 모름 — 로그인 여부에 따라 달라지는 단추는 그리지 않고 공통 칸만(자리 흔들림을 줄이려 빈 자리) */
    return (
      <>
        {dev}
        <Link href="/my" className={['txt', on('/my')].filter(Boolean).join(' ')}>{t('my')}</Link>
        <SearchBox variant="header" />
        {bell}
        <span className="hd-wait" aria-hidden style={{ display: 'inline-block', minWidth: 150 }} data-hd-wait="" />
      </>
    );
  }
  if (inn) {
    return (
      <>
        {dev}
        <span className="who" title={name ?? undefined}>👤 {name ? (name.length > 12 ? name.slice(0, 12) + '…' : name) : t('member')}</span><span className="sep">|</span>
        <Link href="/my" className={['txt', on('/my')].filter(Boolean).join(' ')}>{t('my')}</Link>
        <span className="sep">|</span>
        <Link href="/support/new" className={['txt', on('/support')].filter(Boolean).join(' ')}>{t('support')}</Link>
        <SearchBox variant="header" />
        {bell}
        <button type="button" className="pc-bo hd-out" onClick={out} disabled={busy}>{busy ? t('loggingOut') : t('logout')}</button>
        {ops && <a href="/go/admin" className="pc-bp hd-adm">{t('admin')}</a>}
      </>
    );
  }
  return (
    <>
      {dev}
      <Link href="/my" className={['txt dev', on('/my')].filter(Boolean).join(' ')}>{t('my')}</Link>
      <SearchBox variant="header" />
      {bell}
      <Link href="/login" className="pc-bo">{t('login')}</Link>
      <Link href="/signup" className="pc-bp">{t('signup')}</Link>
    </>
  );
}
