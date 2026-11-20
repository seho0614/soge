/**
 * v10.470 (docs/608) — 운영 화면 다크 모드 · 상단바 오른쪽 해 · 달 단추(대표 11/20 ㉞).
 *   · 고른 테마는 이 브라우저에만(localStorage 'sgb.admTheme' = 'light' | 'dark') — 못 읽으면(사생활 창 · 막힌 저장소) 밝게 · 이번 창에서만.
 *   · 처음은 밝게 — 운영체제 「어두운 모드」를 따라가지 않음(사람이 고를 때만 어둡게).
 *   · <html data-theme="light|dark"> 하나만 바꿈 → 색은 tokens.css 의 :root[data-theme='dark'] 토큰 · app.css 끝 「v10.470 다크 모드」 묶음이 맡음.
 *   · 다른 탭에서 바꾸면(storage 이벤트) 이 탭도 따라 바뀜.
 *   · 사용자 웹(site/)은 건드리지 않음 — 이 파일은 운영 화면(web/)만 씀.
 */
import { useEffect, useState } from 'react';

export type AdmTheme = 'light' | 'dark';
export const THEME_KEY = 'sgb.admTheme';

export function readTheme(): AdmTheme {
  try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}

export function applyTheme(t: AdmTheme) {
  document.documentElement.dataset.theme = t;
}

/** main.tsx 가 화면을 그리기 전에 부름 — 어둡게 고른 사람에게 밝은 화면이 한 번 번쩍이지 않게 */
export function initTheme() {
  applyTheme(readTheme());
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<AdmTheme>(readTheme);

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === THEME_KEY) setTheme(readTheme()); };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);

  const dark = theme === 'dark';
  const flip = () => {
    const next: AdmTheme = dark ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* 저장이 막힌 브라우저 — 이번 창에서만 */ }
    setTheme(next);
  };
  const label = dark ? '밝은 화면으로' : '어두운 화면으로';
  return (
    <button type="button" className="ad-btn ad-theme" onClick={flip} aria-pressed={dark} aria-label={label} title={label}
            data-theme-toggle={theme}>
      <span aria-hidden="true">{dark ? '☀' : '☾'}</span>
    </button>
  );
}
