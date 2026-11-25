import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RequestCtx } from './request-context';

/* e3.1 (docs/010) 요청마다 RequestCtx 를 엶 — 행위자는 ErpAuthGuard 가 로그인 확인 뒤 채움(같은 그릇) · ip 는 Nginx X-Forwarded-For 첫 값 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: any, _res: any, next: () => void) {
    const xff = String(req.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim();
    RequestCtx.run({ requestId: randomUUID(), ip: xff || req.ip, clientIp: xff || req.ip, userAgent: String(req.headers?.['user-agent'] ?? '').slice(0, 300) }, next);
  }
}
