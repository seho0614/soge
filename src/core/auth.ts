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

/* ★ 2026-10-21 결정 — SUPER 는 모든 권한을 가집니다. 정산 지급(PAYOUT 전용 API)도, 앞으로 새로 생기는 권한도 포함입니다.
 *   @Roles 마다 'SUPER' 를 적지 않고, 권한 검사(AuthGuard · hasRole)가 SUPER 를 항상 통과시킵니다.
 *   게이트(본인인증 · 유효 구독)는 권한이 아니라 자격이라 SUPER 도 그대로 봅니다(2026-10-01 Q5 「역할만 열고 자격은 열지 않음」).
 *   DB 쪽 역할 검사는 fn_has_role(D104)이 같은 규칙입니다. 감사 기록은 SUPER 도 똑같이 남습니다(actorRole = SUPER). */
export const isSuper = (roles: readonly string[] | undefined | null): boolean => !!roles?.includes('SUPER');
export const hasRole = (roles: readonly string[] | undefined | null, ...want: string[]): boolean =>
  isSuper(roles) || want.some((r) => !!roles?.includes(r));

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
  /** v10.48 (D102) — accounts.token_version. 로그인 증표의 tv 와 다르면 그 증표는 무효입니다 */
  tokenVersion?: number;
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
      if (!hasRole(principal.roles, ...required)) {
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
      /* SUPER 로 통과한 요청은 감사 기록에 SUPER 로 남깁니다 — 누가 최고 권한으로 했는지 가려야 합니다 */
      c.actorRole = isSuper(principal.roles) ? 'SUPER' : principal.roles[0];
    }
    return true;
  }
}
