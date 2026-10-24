'use client';
/**
 * v10.29 — 관 화면의 브라우저 쪽 작은 부품들(시안 동작 그대로).
 *  · RegionPanel — 시안 「📍 지역 설정」 + 「접속위치 유지」 단추(누르면 「✓ 접속위치 유지 중」).
 *      v10.31 — 고르면 목록을 그 시 · 도로 실제로 거릅니다(주소 ?region=시도코드 · GET /listings?regionCode=). 목록은 서버(GET /market/regions)가 줍니다.
 *      「접속위치 유지」를 켜 두면 고른 지역을 이 브라우저에 기억했다가, 다음에 지역 없이 들어오면 그 지역으로 시작합니다(시안 안내 그대로).
 *  · SortSelect — 시안 목록 아래 정렬 칸. 고르면 주소(?sort=)를 바꿉니다.
 *  · GradeCat — 「상품 구분」을 고르면 「상품 분류 선택」을 그 구분의 분류로 좁힙니다(시안 findPanel).
 *  · ShareButton — 상세 맨 아래 「↗ 공유하기」(주소 복사).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { REGION_ALL } from './gw';

const RKEY = 'gw.region';
const KKEY = 'gw.keepLoc';
function read(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function write(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 화면은 그대로 */ } }

/** 주소의 region 만 바꾸고(쪽 · 커서는 처음으로) 이동 */
function withRegion(code: string) {
  const u = new URL(window.location.href);
  if (code) u.searchParams.set('region', code); else u.searchParams.delete('region');
  u.searchParams.delete('cursor'); u.searchParams.delete('p');
  return u.pathname + (u.search ? u.search : '') + u.hash;
}

export function RegionPanel({ regions, current }: { regions?: { code: string; name: string }[]; current?: string }) {
  const router = useRouter();
  const t = useTranslations('gwan.region');
  const list = [{ ...REGION_ALL, name: t('all') }, ...(regions ?? [])];
  const [keep, setKeep] = useState(false);
  useEffect(() => {
    const k = read(KKEY) === '1';
    setKeep(k);
    /* 접속위치 유지 — 주소에 지역이 없으면 기억한 지역으로 시작 */
    if (k && !current && !new URL(window.location.href).searchParams.has('region')) {
      const r = read(RKEY);
      if (r && list.some((x) => x.code === r)) router.replace(withRegion(r));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="gw-panel gw-loc">
      <div className="gw-lh">{t('head')}</div>
      <select aria-label={t('aria')} value={current ?? ''} onChange={(e) => { write(RKEY, e.target.value); router.push(withRegion(e.target.value)); }}>
        {list.map((r) => <option key={r.code || 'all'} value={r.code}>{r.name}</option>)}
      </select>
      <button type="button" className={`gw-keep${keep ? ' gw-on' : ''}`} aria-pressed={keep}
              title={t('keepTitle')}
              onClick={() => { const v = !keep; setKeep(v); write(KKEY, v ? '1' : '0'); if (v) write(RKEY, current ?? ''); }}>
        {keep ? t('keepOn') : t('keepOff')}
      </button>
    </div>
  );
}

export function SortSelect({ value, options, hrefs, className = 'gw-sortsel' }: {
  value: string; options: [string, string][]; hrefs: Record<string, string>; className?: string;
}) {
  const router = useRouter();
  const tr = useTranslations('gwan.client');
  const ts = useTranslations('gwan.sort'), ko = useLocale() === 'ko';   // v10.97 — 다른 언어만 정렬 이름을 사전에서(한국어는 받은 이름 그대로 · 화면마다 이름이 다름)
  return (
    <select className={className} aria-label={tr('sortAria')} value={value}
            onChange={(e) => router.push(hrefs[e.target.value] ?? '#')}>
      {options.map(([v, t]) => <option key={v} value={v}>{!ko && ts.has(v as never) ? ts(v as never) : t}</option>)}
    </select>
  );
}

/** 상품 구분 → 상품 분류 좁히기. 서버에 보내는 이름(grade · cat)은 그대로입니다. */
export function GradeCat({ grades, cats, grade, cat, allcat }: {
  grades: { code: string; label: string }[];
  cats: { id: string; name: string; gradeCode: string }[];
  grade?: string; cat?: string; allcat: string;
}) {
  const t = useTranslations('gwan.client');
  const [g, setG] = useState(grade ?? '');
  const shown = g ? cats.filter((c) => c.gradeCode === g) : cats;
  return (
    <>
      <div className="gw-fgrp"><span className="gw-flb"><label htmlFor="f-grade">{t('gradeLabel')}</label></span>
        <select id="f-grade" name="grade" value={g} onChange={(e) => setG(e.target.value)}>
          <option value="">{t('all')}</option>
          {grades.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
        </select>
      </div>
      <div className="gw-fgrp"><span className="gw-flb"><label htmlFor="f-cat">{t('catLabel')}</label></span>
        <select id="f-cat" name="cat" defaultValue={cat ?? ''} key={g}>
          <option value="">{allcat}</option>
          {shown.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
    </>
  );
}

export function ShareButton({ path, className = 'gw-bo' }: { path: string; className?: string }) {
  const t = useTranslations('gwan.client');
  const [done, setDone] = useState(false);
  async function go() {
    const url = location.origin + path;
    try {
      if (navigator.share) await navigator.share({ url });
      else { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1800); }
    } catch { /* 사용자가 닫음 */ }
  }
  return <button type="button" className={className} onClick={() => void go()}>{done ? t('copied') : t('share')}</button>;
}
