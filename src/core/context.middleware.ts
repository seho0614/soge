import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestCtx } from './request-context';

/** v10.103 — 사용자 웹이 보내는 화면 언어(X-Lang · 두 글자). 한국어 · 모양이 다른 값은 없는 것으로 */
const langOf = (v: string | string[] | undefined) => {
  const s = (Array.isArray(v) ? v[0] : v ?? '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(s) && s !== 'ko' ? s : undefined;
};

@Injectable()
export class ContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
    res.setHeader('x-request-id', requestId);

    RequestCtx.run(
      {
        requestId,
        ip: req.ip,
        clientIp: (String(req.headers['x-forwarded-for'] ?? '').split(',')[0] ?? '').trim() || req.ip,
        userAgent: req.headers['user-agent'],
        lang: langOf(req.headers['x-lang']) ?? langOf(/(?:^|;\s*)sgb_lang=([a-z]{2})(?:;|$)/.exec(String(req.headers.cookie ?? ''))?.[1]),   // 브라우저가 직접 부르면 쿠키
      },
      () => next(),
    );
  }
}
