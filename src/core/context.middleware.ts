import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestCtx } from './request-context';

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
      },
      () => next(),
    );
  }
}
