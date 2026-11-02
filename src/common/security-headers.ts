import type { INestApplication } from '@nestjs/common';

/**
 * v10.176 (D165 · docs/273) — API 보안 머리글. 운영(main.ts)과 점검판(scripts/dev-server.js)이 같이 부릅니다.
 *   API 는 JSON 만 내보내므로 남의 화면에 끼워 보이기 · 파일 종류 추측을 모두 막습니다.
 *   HSTS 는 HTTPS 로 받았을 때만 브라우저가 따릅니다(점검판 http 에서는 무시됨). X-Powered-By(express) 는 숨김
 */
export function applySecurityHeaders(app: INestApplication): void {
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
}
