'use client';
/**
 * v10.500 (D272 · docs/638) 웹 접근성 도구 — 화면 왼쪽 아래 「보기 설정」
 *   글자 크기(보통 · 크게 · 아주 크게) · 대비(보통 · 고대비) · 처음대로 — 이 브라우저에만(localStorage sgb_a11y · 서버에 보내지 않음)
 *   <html data-a11y-font="l|xl"> · <html data-a11y-contrast="high"> 만 바꾸고 모양은 styles/upt.css(토큰만)
 *   키보드: 단추 Tab → Enter/Space 로 열기 · Esc 로 닫고 단추로 돌아옴 · 고른 값은 aria-pressed
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

type V = { font: 'm' | 'l' | 'xl'; contrast: 'off' | 'high' };
const KEY = 'sgb_a11y';
const DEF: V = { font: 'm', contrast: 'off' };

function read(): V {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<V>;
    return { font: v.font === 'l' || v.font === 'xl' ? v.font : 'm', contrast: v.contrast === 'high' ? 'high' : 'off' };
  } catch { return DEF; }
}
function apply(v: V) {
  const d = document.documentElement;
  if (v.font === 'm') d.removeAttribute('data-a11y-font'); else d.setAttribute('data-a11y-font', v.font);
  if (v.contrast === 'high') d.setAttribute('data-a11y-contrast', 'high'); else d.removeAttribute('data-a11y-contrast');
}

export function A11yTools() {
  const t = useTranslations('upt');
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<V>(DEF);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => { setV(read()); }, []);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const set = (n: V) => {
    setV(n); apply(n);
    try { if (n.font === 'm' && n.contrast === 'off') localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* 저장 못 해도 이 화면에는 적용 */ }
  };
  const fonts: Array<[V['font'], 'fontM' | 'fontL' | 'fontXL']> = [['m', 'fontM'], ['l', 'fontL'], ['xl', 'fontXL']];

  return (
    <div className="a11y-tools" data-a11y-tools={open ? 'open' : 'closed'}>
      <button ref={btn} type="button" className="a11y-fab" aria-expanded={open} aria-controls="a11y-panel" onClick={() => setOpen((x) => !x)} data-a11y-open="">
        {t('a11yBtn')}
      </button>
      {open && (
        <div ref={panel} id="a11y-panel" className="a11y-panel" role="dialog" aria-label={t('a11yTitle')}>
          <p className="a11y-h">{t('a11yTitle')}</p>
          <div className="a11y-row" role="group" aria-label={t('a11yFont')}>
            <span>{t('a11yFont')}</span>
            {fonts.map(([k, lb]) => (
              <button key={k} type="button" aria-pressed={v.font === k} onClick={() => set({ ...v, font: k })} data-a11y-font-set={k}>{t(lb)}</button>
            ))}
          </div>
          <div className="a11y-row" role="group" aria-label={t('a11yContrast')}>
            <span>{t('a11yContrast')}</span>
            <button type="button" aria-pressed={v.contrast === 'off'} onClick={() => set({ ...v, contrast: 'off' })}>{t('contrastOff')}</button>
            <button type="button" aria-pressed={v.contrast === 'high'} onClick={() => set({ ...v, contrast: 'high' })} data-a11y-contrast-set="high">{t('contrastHigh')}</button>
          </div>
          <div className="a11y-row">
            <button type="button" onClick={() => set(DEF)} data-a11y-reset="">{t('a11yReset')}</button>
            <button type="button" onClick={() => { setOpen(false); btn.current?.focus(); }}>{t('a11yClose')}</button>
          </div>
          <p className="a11y-note">{t('a11yNote')}</p>
        </div>
      )}
    </div>
  );
}
