/**
 * v10.29 — 시안의 일반 화면 머리줄(proto_lite.html header() — 관 화면 H() 가 그리는 것) 그대로.
 *
 *   왼쪽   로고 무늬(파랑 · 초록 네 조각) + 「소개뱅크」 → 메인
 *   가운데 관 목록(실제 /gwans — 주소가 있는 관만: 소개장터 · 안심소개 · 소개창업 · 소개몰) + 고정 메뉴(소개광장 · 이용안내)
 *   오른쪽 HdAuth — 로그인 전: 🔔 · 로그인 · 무료 회원가입(보라) / 로그인 뒤: 👤 · 나의공간 · 고객센터 · 🔔 · 로그아웃
 *          + 개발에만 있던 「소개받기 · 파트너센터 · 나의공간」 링크와 검색(돋보기 → 같은 검색 팝업)을 같은 묶음 안에 둡니다.
 *
 * 시안에 있으나 넣지 않은 것: 언어 선택(🇰🇷 한국어) — 실제 웹에 다국어 기능이 없음(diffs 기록).
 * v10.31 — 「이용안내」는 새로 만든 이용안내 화면(/guide · SB-HOM-ETC-010)으로.
 * 서버 컴포넌트 — 조회는 layout 이 한 번 한 관 목록을 받아 씁니다.
 */
import Link from 'next/link';
import type { Gwan } from '@/lib/types';
import { GWAN_PATH } from '@/lib/format';
import { HdNav } from './HdNav';
import { HdAuth } from '@/components/HdAuth';

export function Logo() {
  return (
    <Link className="pc-lg" href="/" aria-label="소개뱅크 메인으로">
      <svg width="26" height="26" viewBox="0 0 28 28" aria-hidden="true">
        <path d="M4.5 9A4.5 4.5 0 0 1 9 4.5h3v3.6H9.3A1.2 1.2 0 0 0 8.1 9.3V12H4.5V9Z" fill="#2563EB" />
        <path d="M23.5 19a4.5 4.5 0 0 1-4.5 4.5h-3v-3.6h2.7a1.2 1.2 0 0 0 1.2-1.2V16h3.6v3Z" fill="#2563EB" />
        <path d="M23.5 9A4.5 4.5 0 0 0 19 4.5h-3v3.6h2.7A1.2 1.2 0 0 1 19.9 9.3V12h3.6V9Z" fill="#10B981" />
        <path d="M4.5 19A4.5 4.5 0 0 0 9 23.5h3v-3.6H9.3A1.2 1.2 0 0 1 8.1 18.7V16H4.5v3Z" fill="#10B981" />
      </svg>
      <span className="t">소개뱅크</span>
    </Link>
  );
}

export function SiteHeader({ gwans }: { gwans: Gwan[] }) {
  /* 20260930 — 주소가 없는 관(허브 EARN 등)은 뺍니다(href="/undefined" 방지) */
  const menu = gwans.filter((g) => GWAN_PATH[g.code]).map((g) => ({ href: `/${GWAN_PATH[g.code]}`, label: g.name }));
  return (
    <header className="pc-hd">
      <div className="pc-wrap pc-hdin">
        <Logo />
        <HdNav items={[
          ...menu,
          { href: '/community', label: '소개광장' },
          { href: '/guide', label: '이용안내' },
        ]} />
        <div className="pc-hr"><HdAuth /></div>
      </div>
    </header>
  );
}
