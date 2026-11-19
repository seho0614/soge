import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { NotFound } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { maskIp, uaKind } from './login-history';

/* ---------------------------------------------------------------------
 * v10.380 (D241 · docs/516) 내 로그인 기기
 *   로그인 한 번 = login_sessions 한 줄(IP 앞 두 마디 · 브라우저 종류만) · 증표(access · refresh)에 sid.
 *   기기별 로그아웃 = revoked_at — 그 sid 를 가진 증표는 다음 요청부터 비로그인(refresh 도 막힘).
 *   v10.380 전에 받은 증표(sid 없음)는 만료될 때까지 그대로 쓰이고 목록에 나오지 않습니다.
 *
 *   로그인한 누구나   GET  /me/sessions               지금 쓰는 기기(이 판 증표 · 끊지 않음 · 14일 안에 씀) · 지금 이 기기 표시
 *   로그인한 누구나   POST /me/sessions/{id}/revoke   그 기기 로그아웃(감사 SESSION_REVOKE) · 이 기기면 이 화면도 로그아웃
 * ------------------------------------------------------------------- */

const ANY_SIGNED_IN = ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'] as const;   // v10.437 세무사

/** 새 기기 줄 — 남기지 못하면 sid 없이(로그인은 그대로) */
export async function createSession(db: DatabaseService, accountId: string, tv: number): Promise<string | undefined> {
  const c = RequestCtx.get();
  try {
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO login_sessions (account_id, tv, ip_masked, ua_kind) VALUES ($1, $2, $3, $4) RETURNING id::text AS id`,
      [accountId, tv, maskIp(c?.clientIp ?? c?.ip), uaKind(c?.userAgent)]);
    return r?.id;
  } catch {
    return undefined;
  }
}

/** 이 기기 줄을 이어 쓸 수 있는가(같은 계정 · 같은 판 번호 · 끊지 않음) */
export async function sessionReusable(db: DatabaseService, sid: string, accountId: string, tv: number): Promise<boolean> {
  const [r] = await db.query<{ ok: boolean }>(
    `SELECT true AS ok FROM login_sessions WHERE id = $1::uuid AND account_id = $2 AND tv = $3 AND revoked_at IS NULL`, [sid, accountId, tv]).catch(() => []);
  return !!r?.ok;
}

/** 요청마다 — 끊긴 기기면 false · 5분마다 마지막으로 쓴 때를 고침 */
export async function sessionAlive(db: DatabaseService, sid: string, accountId: string): Promise<boolean> {
  const [r] = await db.query<{ ok: boolean; stale: boolean }>(
    `SELECT (revoked_at IS NULL) AS ok, (last_seen_at < now() - interval '5 minutes') AS stale FROM login_sessions WHERE id = $1::uuid AND account_id = $2`,
    [sid, accountId]).catch(() => []);
  if (!r) return false;
  if (r.ok && r.stale) void db.query(`UPDATE login_sessions SET last_seen_at = now() WHERE id = $1::uuid`, [sid]).catch(() => undefined);
  return !!r.ok;
}

@ApiTags('MYP')
@ApiBearerAuth()
@Controller('api/v1')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class LoginSessionsController {
  constructor(private readonly db: DatabaseService) {}

  @Get('me/sessions')
  @Roles(...ANY_SIGNED_IN)
  @ApiOperation({ summary: '내 로그인 기기 (v10.380)', description: '지금 로그인된 기기 — 처음 로그인 · 마지막으로 쓴 때 · IP 앞 두 마디 · 브라우저 종류 · 지금 이 기기. 끊은 기기 · 비밀번호를 바꾸기 전 기기 · 14일 넘게 안 쓴 기기는 빠짐. v10.380 전에 받은 로그인은 목록에 없음.' })
  @ApiOkResponse({ type: Object })
  async list() {
    const me = RequestCtx.actorId();
    const cur = RequestCtx.get()?.sid ?? null;
    const items = await this.db.query<{ id: string; current: boolean }>(
      `SELECT s.id::text AS id, s.ua_kind AS "uaKind", s.ip_masked AS "ipMasked", s.created_at AS "createdAt", s.last_seen_at AS "lastSeenAt",
              (s.id::text = $2) AS current
         FROM login_sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.account_id = $1 AND s.revoked_at IS NULL AND s.tv = a.token_version AND s.last_seen_at > now() - interval '14 days'
        ORDER BY (s.id::text = $2) DESC, s.last_seen_at DESC
        LIMIT 30`, [me, cur ?? '']);
    return { items, currentKnown: !!cur, note: cur ? null : '지금 이 기기는 v10.380 전에 로그인해 목록에 없습니다 — 다시 로그인하면 보입니다.' };
  }

  @Post('me/sessions/:id/revoke')
  @HttpCode(200)
  @Roles(...ANY_SIGNED_IN)
  @Audit('SESSION_REVOKE', 'ACCOUNT')
  @ApiParam({ name: 'id', example: '00000000-0000-4000-8000-000000000000' })
  @ApiOperation({ summary: '그 기기 로그아웃 (v10.380)', description: '내 기기 줄만 · 그 기기의 증표는 다음 요청부터 비로그인(다시 받기도 막힘). 지금 이 기기면 이 화면도 로그아웃됩니다. 감사 SESSION_REVOKE.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 없거나 이미 끊음' })
  async revoke(@Param('id', ParseUUIDPipe) id: string) {
    const me = RequestCtx.actorId();
    const r = await this.db.query(
      `UPDATE login_sessions SET revoked_at = now(), revoked_reason = '본인이 끊음' WHERE id = $1::uuid AND account_id = $2 AND revoked_at IS NULL RETURNING id`, [id, me]);
    if (!r.length) throw new NotFound('없거나 이미 로그아웃한 기기입니다.');
    const current = id === RequestCtx.get()?.sid;
    return { ok: true, current, note: current ? '이 기기에서 로그아웃했습니다.' : '그 기기에서 로그아웃했습니다 — 그 기기는 다음 화면부터 로그인이 풀립니다.' };
  }
}
