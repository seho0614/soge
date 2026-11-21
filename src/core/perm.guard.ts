import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Forbidden } from './errors';
import { Principal, ROLES_KEY, isSuper } from './auth';
import { DatabaseService } from '../db/database.service';
import { PERM_OPS, effective, logDenied, permMode, routeNeeds } from '../modules/admin/perm.service';
import { groupsApplicable, groupsDecide, logDiff, permDecideMode } from '../modules/admin/perm-mode';   // v10.564 (D291)
import { prrNoteUse } from '../modules/admin/prr-use';   // v10.566 업무 사용 기록(권한 정기 점검 「안 쓴 권한그룹」)

/* ---------------------------------------------------------------------
 * v10.442 (D258 · docs/579) 업무별 권한 검사 — AuthGuard(역할 · 2단계 · 접속 인증) 다음 단계
 *   · 운영 역할만 요구하는 API(@Roles 가 PERM_OPS 안)만 · 회원 API 는 보지 않음
 *   · SUPER 는 늘 통과 · perm_route_map 에 없는 주소는 지금처럼 @Roles 만(빠짐 없이 안전)
 *   · perm.enforce OFF → 안 봄 · SHADOW(처음) → 막지 않고 「막혔을 것」만 perm_shadow_log · ON → 403 PERM_DENIED
 *   · 같은 주소가 여러 업무(탭)에 걸리면 하나라도 그 수준이 있으면 통과
 * ------------------------------------------------------------------- */
@Injectable()
export class PermGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly db: DatabaseService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const principal: Principal | undefined = req.principal;
    if (!principal || isSuper(principal.roles)) return true;
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required?.length || !required.every((r) => PERM_OPS.includes(r))) return true;
    prrNoteUse(this.db, principal.accountId, String(req.method), String(req.originalUrl ?? req.url ?? ''));   // v10.566 — 계정 · 업무 · 날짜만 · 하루 한 번 · 실패해도 요청 그대로
    /* v10.564 (D291 · docs/706) perm.mode — GROUPS: 역할로 통과한 요청도 권한그룹이 정함(표에 없는 주소는 역할 그대로) · COMPARE: 역할은 열었는데 권한그룹은 막으면 「다름(ROLE_ONLY)」 */
    if (groupsApplicable(principal.roles, required)) {
      const pm = await permDecideMode(this.db);
      const url = String(req.originalUrl ?? req.url ?? '');
      if (pm === 'GROUPS') {
        if (req.permGroupsOk) return true;
        const g = await groupsDecide(this.db, principal.accountId, String(req.method), url);
        if (g === false) throw new Forbidden('PERM_DENIED', '이 업무의 권한이 없습니다 — SUPER 에게 권한그룹을 요청하십시오.');
        return true;
      }
      if (pm === 'COMPARE' && await groupsDecide(this.db, principal.accountId, String(req.method), url).catch(() => null) === false) {   // 비교 실패는 요청을 막지 않음
        await logDiff(this.db, principal.accountId, String(req.method), url, 'ROLE_ONLY');
      }
    }
    const mode = await permMode(this.db);
    if (mode === 'OFF') return true;
    const need = await routeNeeds(this.db, String(req.method).toUpperCase(), String(req.originalUrl ?? req.url ?? ''));
    if (!need.length) return true;
    let eff: Set<string>;
    try { eff = await effective(this.db, principal.accountId); }
    catch (e) {
      /* 보안 점검(11/19) — 권한 조회 오류: SHADOW 는 기록만(기존 @Roles 는 이미 통과) · ON 은 막힘 쪽 */
      if (mode === 'ON') throw e;
      console.warn('[perm] effective 실패(SHADOW · 통과):', String((e as Error)?.message ?? e).slice(0, 200));
      return true;
    }
    if (need.some((n) => eff.has(`${n.task}:${n.level}`))) return true;
    await logDenied(this.db, principal.accountId, need, mode);
    if (mode === 'ON') throw new Forbidden('PERM_DENIED', '이 업무의 권한이 없습니다 — SUPER 에게 권한그룹을 요청하십시오.');
    return true;
  }
}
