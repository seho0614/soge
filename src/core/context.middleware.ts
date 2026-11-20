import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestCtx } from './request-context';

/** v10.103 — 사용자 웹이 보내는 화면 언어(X-Lang · 두 글자). 한국어 · 모양이 다른 값은 없는 것으로 */
const langOf = (v: string | string[] | undefined) => {
  const s = (Array.isArray(v) ? v[0] : v ?? '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(s) && s !== 'ko' ? s : undefined;
};

/** v10.546 (D285) — 사용자 웹이 보내는 기기 표지(X-Device-Mark · 무작위 값 16 ~ 64자 · sfx/device.ts DEVICE_MARK_RE 와 같음). 모양이 다르면 없는 것으로 · 원래 값은 어디에도 남기지 않음 */
const markOf = (v: string | string[] | undefined) => {
  const s = (Array.isArray(v) ? v[0] : v ?? '').trim();
  return /^[A-Za-z0-9-]{16,64}$/.test(s) ? s : undefined;
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
        deviceMark: markOf(req.headers['x-device-mark']),   // v10.546 (D285) 로그인 · 가입 때 사용자 웹이 넘김 — sfx.device_watch on 일 때만 해시로 쌓음
      },
      () => next(),
    );
  }
}
