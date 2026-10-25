'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';

/**
 * v10.47 (D100 · docs/98) — 맛집 소개 글 쓰기 (SB-HOM-CMU-052)
 *
 *   ① 가게 찾기  GET /me/community/food/search?q= — 서버가 카카오를 대신 부름 · 음식점 · 카페만 · 1분 30회
 *   ② 고르기     찾은 결과에서 하나(서버가 10분 동안 기억 — 고른 가게가 그 결과에 있어야 저장됨)
 *   ③ 글         제목 · 소개 · 추천 메뉴(선택) · 광고 · 협찬 여부(대가를 받았으면 반드시)
 *   ④ 저장       POST /me/community/food → 가게 화면으로(첫 글이면 「확인 후 올라갑니다」)
 */

interface Found { kakaoId: string; name: string; category: string | null; address: string | null }

export function FoodWriteForm({ preset }: { preset: { kakaoId: string; name: string } | null }) {
  const t = useTranslations('plaza.food');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pick, setPick] = useState<Found | null>(preset ? { kakaoId: preset.kakaoId, name: preset.name, category: null, address: null } : null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [menu, setMenu] = useState('');
  const [sponsored, setSponsored] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    const k = q.trim();
    if ([...k].length < 2) { setNote(t('qShort')); return; }
    setBusy(true); setNote(null); setErr(null);
    try {
      const r = await fetch(`/api/v1/me/community/food/search?q=${encodeURIComponent(k)}`, { headers: { Accept: 'application/json' } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setFound([]); setNote(d.message ?? t('searchFail')); return; }
      setFound(d.items ?? []);
      setNote(d.note ?? ((d.items ?? []).length === 0 ? t('searchNone') : null));
    } catch { setNote(t('searchRetry')); }
    finally { setBusy(false); }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!pick) { setErr(t('pickFirst')); return; }
    if (title.trim().length < 2) { setErr(t('titleShort')); return; }
    if (body.trim().length < 10) { setErr(t('bodyShort')); return; }
    start(async () => {
      const r = await fetch('/api/v1/me/community/food', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kakaoPlaceId: pick.kakaoId, title: title.trim(), body: body.trim(), menu: menu.trim() || undefined, sponsored }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message ?? t('saveFail')); return; }
      router.push(`/community/food/${d.placeId}?posted=${d.state === 'PENDING' ? 'wait' : '1'}`);
    });
  }

  return (
    <div className="fd-form">
      {pick ? (
        <div className="fd-pick" data-food-pick>
          <b>{pick.name}</b>{pick.address && <span className="dim"> · {pick.address}</span>}
          {!preset && <> <button type="button" className="btn-sm" onClick={() => { setPick(null); }}>{t('pickOther')}</button></>}
        </div>
      ) : (
        <>
          <form className="fd-bar" onSubmit={search} role="search" aria-label={t('find')}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('findPh')} aria-label={t('findLabel')} maxLength={40} autoFocus />
            <button type="submit" disabled={busy}>{busy ? t('finding') : t('find')}</button>
          </form>
          {found && found.length > 0 && (
            <ul className="fd-res" aria-label={t('found')}>
              {found.map((f) => (
                <li key={f.kakaoId}>
                  <button type="button" onClick={() => setPick(f)}>
                    <div className="fd-nm">{f.name}</div>
                    <div className="fd-sub">{[f.category?.split('>').pop()?.trim(), f.address].filter(Boolean).join(' · ')}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {note && <p className="fd-note" role="status">{note}</p>}
        </>
      )}

      <form className="fd-form" onSubmit={submit}>
        <label>{t('fTitle')}<input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder={t('fTitlePh')} /></label>
        <label>{t('fBody')}<textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={3000} placeholder={t('fBodyPh')} /></label>
        <label>{t('fMenu')} <span className="dim">{t('optional')}</span><input type="text" value={menu} onChange={(e) => setMenu(e.target.value)} maxLength={60} placeholder={t('fMenuPh')} /></label>
        <label className="fd-chk"><input type="checkbox" checked={sponsored} onChange={(e) => setSponsored(e.target.checked)} />
          <span>{t.rich('sponsoredChk', { b: (c) => <b>{c}</b> })}</span></label>
        <div className="notice warn">
          {t.rich('firstNote', { b: (c) => <b>{c}</b> })}
        </div>
        {err && <p className="form-error" role="alert">{err}</p>}
        <p><button type="submit" className="fd-cta" disabled={pending}>{pending ? t('posting') : t('submit')}</button></p>
      </form>
    </div>
  );
}
