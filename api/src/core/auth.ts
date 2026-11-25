import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Forbidden, Unauthorized } from './errors';
import { Introspect, SgbClient } from './sgb-client';

/* ---------------------------------------------------------------------
 * e1.2 (docs/002) ERP 로그인 확인 · 권한 — 모든 길에 걸림(전역 가드) · @Public 만 빼기
 *   ① Authorization: Bearer <소개뱅크 운영자 증표> → 소개뱅크 introspect(60초 기억)
 *   ② active · staff · mfaOk(2단계 · 패스키 확인 마침) 아니면 401 / 403
 *   ③ @Task('acct', 'VIEW') — SUPER 는 늘 통과(2026-10-21 결정) · 소개뱅크 판정 방식을 그대로 따름:
 *        perm.decide = GROUPS 이거나 perm.enforce = ON → 업무 권한 목록(task:LEVEL)에 있어야 함
 *        그 밖(ROLE 판정) → @Roles 의 운영 역할이면 통과(@Roles 없으면 ADMIN 만)
 * ------------------------------------------------------------------- */

export const PUBLIC_KEY = 'erp_public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const TASK_KEY = 'erp_task';
export const Task = (task: string, level: 'VIEW' | 'EDIT' | 'APPROVE' | 'EXPORT') => SetMetadata(TASK_KEY, { task, level });
export const ROLES_KEY = 'erp_roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export interface ErpPrincipal {
  accountId: string; name: string | null; roles: string[]; super: boolean;
  perm: { enforce: string; decide: string; tasks: string[] };
}

/** 판정만(시험이 그대로 부름) */
export function decide(p: Introspect, need?: { task: string; level: string }, roles?: string[]): { ok: true } | { ok: false; status: 401 | 403; code: string; message: string } {
  if (!p.active) {
    return p.reason === 'NOT_STAFF'
      ? { ok: false, status: 403, code: 'ERP_NOT_STAFF', message: 'ERP 는 운영자 계정만 쓸 수 있습니다.' }
      : { ok: false, status: 401, code: 'UNAUTHENTICATED', message: '로그인이 필요합니다 — 운영 화면에서 「ERP 열기」로 들어오십시오.' };
  }
  if (!p.mfaOk) return { ok: false, status: 403, code: 'MFA_REQUIRED', message: '2단계 인증(또는 패스키) 확인 뒤에만 ERP 를 쓸 수 있습니다.' };
  if (p.super) return { ok: true };
  const rs = roles?.length ? roles : ['ADMIN'];
  const groups = p.perm?.decide === 'GROUPS' || p.perm?.enforce === 'ON';
  if (need) {
    const has = (p.perm?.tasks ?? []).includes(`${need.task}:${need.level}`);
    if (groups ? has : (has || (p.roles ?? []).some((r) => rs.includes(r)))) return { ok: true };
    return { ok: false, status: 403, code: 'PERM_DENIED', message: '이 업무의 권한이 없습니다 — SUPER 에게 권한그룹을 요청하십시오.' };
  }
  if ((p.roles ?? []).some((r) => rs.includes(r))) return { ok: true };
  return { ok: false, status: 403, code: 'FORBIDDEN', message: '권한이 없습니다.' };
}

@Injectable()
export class ErpAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly sgb: SgbClient) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const h = String(req.headers?.authorization ?? '');
    if (!h.startsWith('Bearer ') || h.length < 20) throw Unauthorized('UNAUTHENTICATED', '로그인이 필요합니다 — 운영 화면에서 「ERP 열기」로 들어오십시오.');
    const p = await this.sgb.introspect(h.slice(7));
    const r = decide(p, this.reflector.getAllAndOverride(TASK_KEY, targets), this.reflector.getAllAndOverride(ROLES_KEY, targets));
    if (!r.ok) throw r.status === 401 ? Unauthorized(r.code, r.message) : Forbidden(r.code, r.message);
    req.erp = { accountId: p.accountId!, name: p.name ?? null, roles: p.roles ?? [], super: !!p.super, perm: p.perm ?? { enforce: 'OFF', decide: 'ROLE', tasks: [] } } as ErpPrincipal;
    return true;
  }
}
