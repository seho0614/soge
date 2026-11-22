import type { INestApplication } from '@nestjs/common';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { cspReportRoute } from './csp-report';

const parseSnsText = express.text({ type: 'text/plain', limit: '256kb' });
/* v10.633 (docs/777) 매물 CSV 일괄 등록 미리보기만 본문 300KB(CSV 200KB · JSON 으로 감싸면 줄바꿈 · 따옴표가 늘어남) — 다른 API 는 그대로 100KB */
const parseBulkJson = express.json({ limit: '300kb' });

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
  /* v10.633 (docs/777) — 매물 CSV 일괄 등록 미리보기: 화면 안내 「200KB」 인데 서버 기본 본문 한도(100KB)에 먼저 걸려 500(→ v10.632 413) 이던 것.
     ★ 이름이 다른 함수로 감쌈(위와 같은 까닭) · 넘으면 413 PAYLOAD_TOO_LARGE · JSON 이 깨지면 400(Nest 오류 모양과 같게) */
  app.use('/api/v1/lsq/me/bulk/preview',
    function lsqBulkBody(req: Request, res: Response, next: NextFunction) { parseBulkJson(req, res, next); },
    function lsqBulkBodyError(err: { status?: number; type?: string } | undefined, _req: Request, res: Response, next: NextFunction) {
      if (!err) return next();
      if (err.status === 413 || err.type === 'entity.too.large') {
        res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: '보내는 글이 너무 큽니다(CSV 200KB 까지) — 나눠서 올리십시오.' });
        return;
      }
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'CSV 본문을 읽지 못했습니다.' });
    });
}
