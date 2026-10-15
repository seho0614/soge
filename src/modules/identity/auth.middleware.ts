import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuthService } from './auth.service';
import { PrincipalService } from './principal.service';
import { RequestCtx } from '../../core/request-context';

/**
 * 토큰 → principal.
 *
 * 토큰의 클레임을 그대로 쓰지 않고 DB 에서 다시 조립합니다.
 * 사업자 승인·구독 만료가 토큰보다 먼저 반영되어야 하기 때문입니다.
 * 조회 1회 비용보다 "만료됐는데 15분간 통과"가 더 비쌉니다.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private readonly auth: AuthService,
    private readonly principals: PrincipalService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const { sub } = this.auth.verify(header.slice(7));
        const principal = await this.principals.load(sub);
        if (principal) {
          (req as any).principal = principal;
          const c = RequestCtx.get();
          if (c) { c.actorId = principal.accountId; c.actorRole = principal.roles[0]; }
        }
      } catch {
        // 무효 토큰은 비로그인으로 취급합니다. 가드가 필요한 곳에서만 막습니다
      }
    }
    next();
  }
}
