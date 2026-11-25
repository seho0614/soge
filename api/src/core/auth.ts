import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Forbidden, Unauthorized } from './errors';
import { Introspect, SgbClient } from './sgb-client';
import { RequestCtx } from './request-context';
import { Optional } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { accountantOnly, logAccountantAccess } from '../modules/acct/accountant';

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

/* e3.1 (docs/010) 소개뱅크 core/auth.ts 와 같은 이름(옮겨 온 회계 코드가 씀) — Role · isSuper · hasRole · Principal(req.principal) */
export type Role = 'MEMBER' | 'REVIEWER' | 'ADMIN' | 'PAYOUT' | 'SUPER' | 'PARTNER_MAL' | 'PARTNER_AFF' | 'ACCOUNTANT' | string;
export const isSuper = (roles: readonly string[] | undefined | null): boolean => !!roles?.includes('SUPER');
export const hasRole = (roles: readonly string[] | undefined | null, ...want: string[]): boolean => isSuper(roles) || !!roles?.some((r) => want.includes(r));
export interface Principal {
  accountId: string; roles: Role[];
  identityVerifiedAt: Date | null; businessVerifiedAt: Date | null; hasActiveSubscription: boolean;
  mfaPending?: boolean;
}

export interface ErpPrincipal {
  accountId: string; name: string | null; roles: string[]; super: boolean;
  perm: { enforce: string; decide: string; tasks: string[] };
}

/** 판정만(시험이 그대로 부름) */
/* ts-node strict:false(dev-server · 소개뱅크와 같음)에서는 ok: true | false 유니온을 갈라 보지 못함 → 실패 모양을 따로 둠(11/25 점검판 기동 실패) */
export type DecideFail = { ok: false; status: 401 | 403; code: string; message: string };
export function decide(p: Introspect, need?: { task: string; level: string }, roles?: string[]): { ok: true } | DecideFail {
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
  constructor(private readonly reflector: Reflector, private readonly sgb: SgbClient, @Optional() private readonly db?: DatabaseService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const h = String(req.headers?.authorization ?? '');
    if (!h.startsWith('Bearer ') || h.length < 20) throw Unauthorized('UNAUTHENTICATED', '로그인이 필요합니다 — 운영 화면에서 「ERP 열기」로 들어오십시오.');
    const p = await this.sgb.introspect(h.slice(7));
    const needRoles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, targets);
    /* e3.5 (docs/011) 소개뱅크 core/auth accountantRead 와 같음 — 세무사만인 계정은 회계(/api/v1/admin/acct/) GET 중 지급 담당이 볼 수 있는 것만 · 접속 기록 */
    const acctOnly = !!p.active && accountantOnly(p.roles);
    const acctRead = acctOnly && !!p.mfaOk && req.method === 'GET' && String(req.originalUrl ?? req.url ?? '').startsWith('/api/v1/admin/acct/') && !!needRoles?.includes('PAYOUT');
    const r = acctRead ? { ok: true as const } : decide(p, this.reflector.getAllAndOverride(TASK_KEY, targets), needRoles);
    if (acctOnly && this.db) void logAccountantAccess(this.db, p.accountId!, String(req.method ?? 'GET'), String(req.originalUrl ?? req.url ?? ''), RequestCtx.get()?.ip ?? null);
    if (!r.ok) { const f = r as DecideFail; throw f.status === 401 ? Unauthorized(f.code, f.message) : new Forbidden(f.code, f.message); }
    req.erp = { accountId: p.accountId!, name: p.name ?? null, roles: p.roles ?? [], super: !!p.super, perm: p.perm ?? { enforce: 'OFF', decide: 'ROLE', tasks: [] } } as ErpPrincipal;
    /* e3.1 — 옮겨 온 코드가 보는 req.principal · RequestCtx 행위자(감사 · 결재 · 작성자) */
    req.principal = { accountId: p.accountId!, roles: (p.roles ?? []) as Role[], identityVerifiedAt: null, businessVerifiedAt: null, hasActiveSubscription: false, mfaPending: false } as Principal;
    const c = RequestCtx.get();
    if (c) { c.actorId = p.accountId!; c.actorRole = (p.roles ?? []).includes('SUPER') ? 'SUPER' : (p.roles ?? [])[0]; }
    return true;
  }
}
