/** v10.499 (D272 · docs/637) 공개 설정 site.pwa(처음 off) — layout 이 서비스 워커 등록(PwaRegister)에 넘김 */
export const pwaOn = (s: Record<string, string | null>) => (s['site.pwa'] ?? '').trim() === 'on';
