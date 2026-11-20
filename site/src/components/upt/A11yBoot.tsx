/**
 * v10.500 (D272 · docs/638) 웹 접근성 — 보기 설정을 그리기 전에 붙임(깜박임 없게)
 *   이 브라우저 localStorage 「sgb_a11y」 = {"font":"m|l|xl","contrast":"off|high"} → <html data-a11y-font · data-a11y-contrast>
 *   읽지 못하면(사생활 보호 창 · 막힘) 아무것도 하지 않음. 서버에 보내지 않음.
 *   ★ 글은 고정된 짧은 스크립트(값을 끼워 넣지 않음) — 보고만 하는 CSP(next.config)는 'unsafe-inline' 을 허용함.
 */
const BOOT = `(function(){try{var v=JSON.parse(localStorage.getItem('sgb_a11y')||'{}'),d=document.documentElement;`
  + `if(v.font==='l'||v.font==='xl')d.setAttribute('data-a11y-font',v.font);`
  + `if(v.contrast==='high')d.setAttribute('data-a11y-contrast','high');}catch(e){}})();`;

export function A11yBoot() {
  return <script id="sgb-a11y-boot" dangerouslySetInnerHTML={{ __html: BOOT }} />;
}
