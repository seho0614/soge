import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuthService } from './auth.service';
import { PrincipalService } from './principal.service';
import { MfaService, OPS_ROLES } from './mfa.service';
import { StaffIpService } from './staff-ip.service';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { accountantOnly, logAccountantAccess } from '../acct/accountant';   // v10.437 (D257) 세무사 접속 기록
import { passkeyPending } from './passkey';   // v10.484 (D268) 운영자 패스키

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
    private readonly mfa: MfaService,
    private readonly staffIp: StaffIpService,
    private readonly db: DatabaseService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const { sub, tv, ma, sid } = this.auth.verify(header.slice(7));
        const principal = await this.principals.load(sub);
        /* v10.48 (D102) — 비밀번호 변경 · 재설정 · 탈퇴 뒤에는 그 전 증표의 판 번호(tv)가 맞지 않아 비로그인으로 봅니다
         * v10.380 (D241 · docs/516) — 「내 로그인 기기」에서 끊은 기기(sid)의 증표도 비로그인 · sid 없는 옛 증표는 그대로 */
        if (principal && (principal.tokenVersion ?? 0) === tv && (!sid || (await this.auth.sessionAlive(sid, sub)))) {
          /* v10.180 (D169) — 운영자 2단계 인증: 확인 시각 · 아직 필요한지(운영 역할일 때만 설정을 봄) */
          principal.mfaAt = ma;
          /* 보안 점검(11/19) — 설정을 못 읽으면 운영 역할은 2단계를 요구(막힘 쪽 · 세무사 같은 외부 사람이 비밀번호만으로 들어오지 않게) */
          principal.mfaPending = await this.mfa.pending(principal, ma).catch(() => principal.roles.some((r) => (OPS_ROLES as readonly string[]).includes(r)));
          /* v10.226 (D195) — 운영 화면 접속 인증: 허용 IP 밖이면 그날 인증했는지(운영 역할 · 켜짐일 때만 DB 를 봄) */
          principal.ipPending = await this.staffIp.pending(principal).catch(() => false);
          /* v10.484 (D268) — 패스키 EXTRA: 등록한 운영자 · 이 기기(sid) 확인 여부(꺼짐 · REPLACE_MFA · 회원이면 DB 를 부르지 않음) */
          principal.passkeyPending = await passkeyPending(this.db, principal, sid).catch(() => false);
          (req as any).principal = principal;
          const c = RequestCtx.get();
          if (c) { c.actorId = principal.accountId; c.actorRole = principal.roles[0]; c.sid = sid; }
          /* v10.437 (D257) — 세무사만인 계정이 운영 화면 API 를 부르면 한 줄(기다리지 않음 · 실패 무시) */
          if (accountantOnly(principal.roles) && String(req.originalUrl ?? req.url ?? '').startsWith('/api/v1/admin')) {
            void logAccountantAccess(this.db, principal.accountId, req.method, String(req.originalUrl ?? req.url ?? ''), c?.ip ?? null);
          }
        }
      } catch {
        // 무효 토큰은 비로그인으로 취급합니다. 가드가 필요한 곳에서만 막습니다
      }
    }
    next();
  }
}
