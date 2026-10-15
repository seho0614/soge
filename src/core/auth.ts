import {
  CanActivate, ExecutionContext, Injectable, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Forbidden } from './errors';
import { RequestCtx } from './request-context';

export type Role =
  | 'GUEST' | 'MEMBER' | 'BIZ_OWNER' | 'BIZ_STAFF'
  /* ★ PAYOUT — 지급 전담. ADMIN 과 함께 가질 수 없습니다(C710).
   *   승인하는 사람과 돈을 보내는 사람을 나눕니다. */
  | 'REVIEWER' | 'ADMIN' | 'PAYOUT' | 'SUPER';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** 인증 게이트 — 본인인증 · 유효 구독. v10.39 — 사업자 인증 게이트(BUSINESS_VERIFIED)는 P2P(v10.37) 뒤 쓰는 곳이 없어 뺐습니다. */
export const GATE_KEY = 'gate';
export type Gate = 'IDENTITY_VERIFIED' | 'ACTIVE_SUBSCRIPTION';
export const RequireGate = (...gates: Gate[]) => SetMetadata(GATE_KEY, gates);

export interface Principal {
  accountId: string;
  roles: Role[];
  identityVerifiedAt: Date | null;
  businessVerifiedAt: Date | null;
  hasActiveSubscription: boolean;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const principal: Principal | undefined = req.principal;

    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    const gates = this.reflector.getAllAndOverride<Gate[]>(GATE_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]) ?? [];

    if (required?.length) {
      if (!principal) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
      if (!required.some((r) => principal.roles.includes(r))) {
        throw new Forbidden('FORBIDDEN', '권한이 없습니다.');
      }
    }

    for (const gate of gates) {
      if (!principal) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
      if (gate === 'IDENTITY_VERIFIED' && !principal.identityVerifiedAt) {
        throw new Forbidden('IDENTITY_REQUIRED', '본인인증이 필요합니다.');
      }
      if (gate === 'ACTIVE_SUBSCRIPTION' && !principal.hasActiveSubscription) {
        // INV-8 — 유효 구독 없이 코드 발급 불가
        throw new Forbidden('SUBSCRIPTION_REQUIRED', '유효한 구독이 필요합니다.');
      }
    }

    const c = RequestCtx.get();
    if (c && principal) {
      c.actorId = principal.accountId;
      c.actorRole = principal.roles[0];
    }
    return true;
  }
}
