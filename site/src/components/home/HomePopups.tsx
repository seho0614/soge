'use client';
/**
 * v10.517 (D277 · docs/655) SB-HOM-PRX-010 메인 팝업 공지 — page.tsx 가 GET /popups 로 받은 것만 그립니다(보는 사람 대상 · 순서는 서버).
 *   여러 개면 하나씩(「다음」 · n / 전체) · 「오늘 하루 안 보기」는 그 팝업만 이 브라우저에서 오늘 숨김 · 「닫기」는 이번 화면에서만.
 *   글은 글자 그대로(HTML 아님) · 단추 주소는 서버가 / 또는 https:// 만 받음. 디자인 값은 sgb-tokens 토큰만(styles/popup.css).
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { HomePopup } from './popupTypes';
import { readPopupHidden, writePopupHidden } from './popupHide';
import '@/styles/popup.css';

export function HomePopups({ items }: { items: HomePopup[] }) {
  const t = useTranslations('main.popup');
  const [left, setLeft] = useState<HomePopup[]>([]);
  const key = items.map((p) => p.id).join(',');
  /* 숨김은 브라우저에서만 읽음(서버 그림과 어긋나지 않게 처음에는 아무것도 그리지 않음) */
  useEffect(() => {
    const hidden = readPopupHidden();
    setLeft(items.filter((p) => !hidden.includes(p.id)));
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  const cur = left[0];
  useEffect(() => {
    if (!cur) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLeft((l) => l.slice(1)); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cur]);
  if (!cur) return null;
  const total = items.length, idx = total - left.length + 1;
  const next = () => setLeft((l) => l.slice(1));
  const ext = !!cur.linkUrl && cur.linkUrl.startsWith('https://');
  return (
    <div className="hpop-dim" data-home-popups={left.length}>
      <div className="hpop" role="dialog" aria-modal="true" aria-labelledby={`hpop-t-${cur.id}`} data-home-popup={cur.id}>
        <h2 className="hpop-t" id={`hpop-t-${cur.id}`}>{cur.title}</h2>
        {cur.body && <p className="hpop-b">{cur.body}</p>}
        {cur.linkUrl && (ext
          ? <a className="hpop-go" href={cur.linkUrl} target="_blank" rel="noopener noreferrer" data-home-popup-link>{cur.linkLabel || t('more')}</a>
          : <Link className="hpop-go" href={cur.linkUrl} onClick={next} data-home-popup-link>{cur.linkLabel || t('more')}</Link>)}
        <div className="hpop-ft">
          <button type="button" className="hpop-x" onClick={() => { writePopupHidden(cur.id); next(); }} data-home-popup-hide>{t('hideToday')}</button>
          {total > 1 && <span className="hpop-n" aria-label={t('countAria', { n: idx, total })}>{t('count', { n: idx, total })}</span>}
          <button type="button" className="hpop-x hpop-close" onClick={next} aria-label={t('closeAria')} data-home-popup-close>{left.length > 1 ? t('next') : t('close')}</button>
        </div>
      </div>
    </div>
  );
}
