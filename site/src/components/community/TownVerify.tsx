'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

/**
 * v10.164 (D154 · docs/253) — 소개광장 「동네 인증」
 *   설정이 꺼져 있으면(community.town_verify · 처음 off) 아무것도 그리지 않음.
 *   휴대폰 위치를 한 번 받아 서버로 보내면 서버가 행정동 이름 · 코드만 저장(좌표는 저장하지 않음 · 30일).
 *   위치기반서비스 이용약관에 동의하지 않았으면 서버가 422 TOWN_CONSENT_REQUIRED — 약관 화면으로 안내.
 */
interface Mine { enabled: boolean; consent: boolean; town: { admName: string; expiresAt: string } | null }

export function TownVerify({ loggedIn }: { loggedIn: boolean }) {
  const t = useTranslations('plaza.town');
  const [on, setOn] = useState(false);
  const [mine, setMine] = useState<Mine | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/v1/community/town/config').then((r) => r.json()).then((d: { enabled?: boolean }) => setOn(!!d?.enabled)).catch(() => setOn(false));
  }, []);
  useEffect(() => {
    if (!on || !loggedIn) return;
    fetch('/api/v1/me/town').then((r) => (r.ok ? r.json() : null)).then((d: Mine | null) => setMine(d)).catch(() => setMine(null));
  }, [on, loggedIn]);

  if (!on) return null;
  const short = (n: string) => n.split(/\s+/).pop() ?? n;

  function verify() {
    setMsg(null);
    if (!navigator.geolocation) { setMsg(t('noGeo')); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(async (p) => {
      const r = await fetch('/api/v1/me/town/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: p.coords.latitude, lng: p.coords.longitude }),
      });
      const d = await r.json().catch(() => null) as (Mine & { message?: string; code?: string }) | null;
      setBusy(false);
      if (!r.ok) { setMsg(d?.code === 'TOWN_CONSENT_REQUIRED' ? t('needConsent') : d?.message ?? t('fail')); return; }
      setMine(d);
      setMsg(t('done', { town: short(d?.town?.admName ?? '') }));
    }, () => { setBusy(false); setMsg(t('denied')); }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
  }

  return (
    <div className="notice" data-town-verify={mine?.town ? 'verified' : 'none'}>
      <div>
        <strong>{t('title')}</strong>{' '}
        {mine?.town
          ? <span data-town-name>{t('mine', { town: short(mine.town.admName), date: mine.town.expiresAt.slice(0, 10) })}</span>
          : <span className="hint">{t('help')}</span>}
        <p className="hint">{t('privacy')}</p>
        {loggedIn
          ? <button className="btn-sm" disabled={busy} onClick={verify} data-town-verify-go>{busy ? t('busy') : mine?.town ? t('again') : t('go')}</button>
          : <Link className="btn-sm" href="/login">{t('login')}</Link>}
        {mine && !mine.consent && <> <Link className="btn-sm" href="/terms/LOCATION">{t('terms')}</Link></>}
        {msg && <p className="hint" role="status" data-town-msg>{msg}</p>}
      </div>
    </div>
  );
}

/** 글 목록 · 글에서 쓴 사람 옆 「○○동 인증」 */
export function TownBadge({ town }: { town?: string | null }) {
  const t = useTranslations('plaza.town');
  if (!town) return null;
  return <span className="badge" data-town-badge title={t('badgeTip')}>{t('badge', { town })}</span>;
}
