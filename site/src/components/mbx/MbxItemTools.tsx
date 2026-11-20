'use client';
/**
 * v10.501 ~ 503 (D273 · docs/639 ~ 641) — 매물 상세(SB-{G}-DTL-010) · 소개몰 상품 상세(SB-HLT-PRD-010) 아래 작은 줄
 *   [최근 본] [비교에 담기 / 비교하기 (n)] [가격 알림 받기]
 *   · 본 것 적기: 로그인 회원은 서버(POST /me/recent) · 아니면 이 브라우저(localStorage) — 스위치(mbx.recent)가 꺼져 있으면 아무것도 적지 않음
 *   · 비교함: 이 브라우저에만 · 같은 종류(매물 · 상품)만 4개까지 — 스위치(mbx.compare)가 켜져 있을 때만 단추
 *   · 가격 알림: 로그인 회원 · 매물은 관심 목록에 담은 것만(서버가 422 MBX_NEED_FAVORITE) — 스위치(mbx.price_alert)가 켜져 있을 때만 단추
 *   스위치는 GET /site/mbx/switches(공개) — 넷 다 꺼져 있으면(처음) 이 줄은 아무것도 그리지 않습니다(지금 화면 그대로).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import '@/styles/mbx.css';
import { COMPARE_MAX, localCompare, mergeLocalRecent, pushLocalRecent, saveCompare, type MbxType } from './mbxLocal';

interface Switches { recent: boolean; compare: boolean; priceAlert: boolean; dm: boolean }

export function MbxItemTools({ type, id, title, loggedIn }: { type: MbxType; id: string; title: string; loggedIn: boolean }) {
  const t = useTranslations('mbx.tools');
  const [sw, setSw] = useState<Switches | null>(null);
  const [inCmp, setInCmp] = useState(false);
  const [cmpN, setCmpN] = useState(0);
  const [alertOn, setAlertOn] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch('/api/v1/site/mbx/switches').then((r) => (r.ok ? r.json() : null)).then((d: Switches | null) => {
      if (!live || !d) return;
      setSw(d);
      if (d.recent) {
        if (loggedIn) {
          void mergeLocalRecent();
          void fetch('/api/v1/me/recent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, key: id }) }).catch(() => null);
        } else pushLocalRecent({ type, key: id, title });
      }
      if (d.priceAlert && loggedIn) {
        fetch('/api/v1/me/price-alerts').then((r) => (r.ok ? r.json() : null)).then((w: { items?: Array<{ type: string; key: string }> } | null) => {
          if (live && w?.items) setAlertOn(w.items.some((x) => x.type === type && x.key === id));
        }).catch(() => null);
      }
    }).catch(() => null);
    const sync = () => { const c = localCompare(); setCmpN(c.items.length); setInCmp(c.type === type && c.items.some((x) => x.key === id)); };
    sync();
    window.addEventListener('sgb-mbx-cmp', sync);
    return () => { live = false; window.removeEventListener('sgb-mbx-cmp', sync); };
  }, [type, id, title, loggedIn]);

  if (!sw || (!sw.recent && !sw.compare && !sw.priceAlert)) return null;

  function toggleCompare() {
    setMsg(null);
    const c = localCompare();
    if (inCmp) { saveCompare({ type: c.type, items: c.items.filter((x) => x.key !== id) }); return; }
    if (c.type && c.type !== type && c.items.length) {
      if (!window.confirm(t('compareOther'))) return;
      saveCompare({ type, items: [{ key: id, title }] });
      return;
    }
    if (c.items.length >= COMPARE_MAX) { setMsg(t('compareFull', { max: String(COMPARE_MAX) })); return; }
    saveCompare({ type, items: [...c.items, { key: id, title: title.slice(0, 80) }] });
  }

  async function toggleAlert() {
    setMsg(null);
    if (!loggedIn) { setMsg(t('loginFirst')); return; }
    setBusy(true);
    try {
      /* 메서드를 글자 그대로 둡니다 — 매트릭스(scripts/gen-matrix.js)가 소스를 읽어 「화면 → API」를 잇기 때문입니다. */
      const r = alertOn
        ? await fetch(`/api/v1/me/price-alerts/${type}/${encodeURIComponent(id)}`, { method: 'DELETE' })
        : await fetch('/api/v1/me/price-alerts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, key: id }) });
      const d = await r.json().catch(() => null) as { code?: string; message?: string } | null;
      if (!r.ok) { setMsg(d?.code === 'MBX_NEED_FAVORITE' ? t('alertNeedLike') : d?.message ?? t('failed')); return; }
      setAlertOn(!alertOn);
      setMsg(alertOn ? t('alertRemoved') : t('alertAdded'));
    } finally { setBusy(false); }
  }

  return (
    <div className="mbx-tools" data-mbx-tools={type}>
      {sw.recent && <Link className="mbx-btn" href="/recent" prefetch={false} data-mbx-recent-link="">{t('recent')}</Link>}
      {sw.compare && (
        <>
          <button type="button" className={`mbx-btn${inCmp ? ' on' : ''}`} aria-pressed={inCmp} onClick={toggleCompare} data-mbx-cmp-toggle="">
            {inCmp ? t('compareOn') : t('compareAdd')}</button>
          {cmpN > 0 && <Link className="mbx-btn" href="/compare" prefetch={false} data-mbx-cmp-go={cmpN}>{t('compareGo', { n: String(cmpN) })}</Link>}
        </>
      )}
      {sw.priceAlert && (
        <button type="button" className={`mbx-btn${alertOn ? ' on' : ''}`} aria-pressed={alertOn} disabled={busy} onClick={() => void toggleAlert()} data-mbx-alert-toggle="">
          {alertOn ? t('alertOn') : t('alertOff')}</button>
      )}
      {msg && <span className="mbx-msg" role="status">{msg}</span>}
    </div>
  );
}
