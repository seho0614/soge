import type { INestApplication } from '@nestjs/common';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { cspReportRoute } from './csp-report';

const parseSnsText = express.text({ type: 'text/plain', limit: '256kb' });

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
  /* v10.177 (docs/275) — 사용자 웹의 보안 정책 「보고만 하기」 보고 받기(Nest 앞 · 로그인 · 요청 한도 없음 · 메모리 24시간만) */
  app.use('/api/v1/csp-report', ...cspReportRoute);
  /* v10.209 (D186) — AWS SNS 는 본문을 text/plain 으로 보냄 — 반송 알림 주소에만 글 그대로 읽기(컨트롤러가 받은 글로 서명 검사).
     ★ 이름이 다른 함수로 감쌈(express 본문 읽기 함수 이름을 Nest 가 보고 전체 API 본문 읽기를 건너뛰는 일 — csp-report.ts 참고) */
  app.use('/api/v1/webhooks/ses', function sesSnsBody(req: Request, res: Response, next: NextFunction) { parseSnsText(req, res, next); });
}
