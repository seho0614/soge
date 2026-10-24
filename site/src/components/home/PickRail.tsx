'use client';
/**
 * SB-HOM-MAIN-010 · 011 — 「오늘의 PICK」 가로 줄. 카드는 Sections 가 그린 것을 그대로 받습니다.
 * 오른쪽 화살표는 한 화면만큼 밀고, 끝에 닿으면 처음으로 돌아갑니다.
 * 카드가 한 화면에 다 들어와 넘길 것이 없으면(그림의 5장) 「전체보기」와 같은 곳으로 갑니다 — 눌러도 아무 일이 없으면 안 됩니다.
 * 자바스크립트가 없어도 손으로 밀 수 있습니다.
 */
import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Line } from './Icons';

export function PickRail({ children, label, more }: { children: React.ReactNode; label: string; more: string }) {
  const t = useTranslations('main');
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  function next() {
    const el = ref.current; if (!el) return;
    if (el.scrollWidth <= el.clientWidth + 8) { router.push(more); return; }
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
    el.scrollTo({ left: end ? 0 : el.scrollLeft + Math.round(el.clientWidth * 0.8), behavior: 'smooth' });
  }
  return (
    <div className="home-railw">
      <div className="home-rail" ref={ref} role="list" aria-label={label} tabIndex={0}>{children}</div>
      <button type="button" className="home-railnext" aria-label={t('sec.railNext')} data-more={more} onClick={next}><Line name="chev" size={20} w={2.6} /></button>
    </div>
  );
}
