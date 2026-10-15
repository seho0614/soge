/** v10.29 — 시안 「사용자 화면으로」. 운영 화면(5173)과 사용자 웹(5174)이 다른 주소라 짝을 찾아 갑니다.
 *  VITE_SITE_URL 이 있으면 그것을, 없으면 개발 포트(5173 → 5174 · 52xx → 51xx) · 운영 도메인(admin. 을 뗀 주소) 순서로.
 *  v10.31 — 바닥줄 링크(약관 · 고객센터 등)도 이 주소로 보냅니다(전에는 운영 화면 주소의 /terms/… 로 가 운영 첫 화면이 열림). */
export function siteUrl(): string {
  const env = (import.meta.env as Record<string, string | undefined>).VITE_SITE_URL;
  if (env) return env.endsWith('/') ? env : `${env}/`;
  const { protocol, hostname, port } = location;
  if (port === '5173') return `${protocol}//${hostname}:5174/`;
  if (/^52\d\d$/.test(port)) return `${protocol}//${hostname}:51${port.slice(2)}/`;
  return `${protocol}//${hostname.replace(/^admin\./, '')}/`;
}
/** 사용자 웹의 경로를 절대 주소로 */
export const siteHref = (path: string) => siteUrl().replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`);
