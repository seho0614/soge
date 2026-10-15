import { useEffect, useState } from 'react';

/**
 * v10.31 — 하위 탭을 주소(#/탭/하위)에 남깁니다. 대시보드 「다른 운영 화면」의 「메인 운영 · 관 노출」처럼
 * 하위 탭으로 바로 들어가고, 새로 고침 · 뒤로 가기에도 같은 하위 탭이 열립니다.
 */
export const hashSub = (): string | null => decodeURIComponent(location.hash.replace(/^#\/?/, '').split('/')[1] ?? '') || null;

export function useHashSub<K extends string>(def: K, allowed: readonly K[]): [K, (k: K) => void] {
  const pick = () => { const h = hashSub(); return (h && (allowed as readonly string[]).includes(h) ? h : def) as K; };
  const [v, setV] = useState<K>(pick);
  useEffect(() => {
    const on = () => setV(pick());
    window.addEventListener('hashchange', on); window.addEventListener('popstate', on); window.addEventListener('bo-sub', on);
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on); window.removeEventListener('bo-sub', on); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const set = (k: K) => {
    setV(k);
    const tab = location.hash.replace(/^#\/?/, '').split('/')[0] ?? '';
    if (tab) history.replaceState(null, '', `#/${tab}/${k}`);
    /* v10.32 — 제목 줄(App · SUB_PAGE)이 하위 화면을 따라가게 알립니다. 같은 값으로 다시 읽으므로 되돌이 없음 */
    window.dispatchEvent(new Event('bo-sub'));
  };
  return [v, set];
}
