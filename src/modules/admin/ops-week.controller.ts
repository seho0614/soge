import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import type { Request } from 'express';
import { ErrorDto } from '../../common/dto/common.dto';
import { Principal, Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { AppError, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { maskMail } from '../../common/mail/mail-admin.service';
import { opsAlertWeekly } from './ops-alert-weekly';
import { parseApplyItems } from './apply-checks';
import { APP_VERSION } from '../../common/app-version';

/* ---------------------------------------------------------------------
 * v10.374 ~ 376 (D240 · docs/509 ~ 511)
 *   ADMIN·SUPER   GET  /admin/apply-checks?version=          운영 적용 확인표(지금 판 기본 · 항목마다 지금 상태)
 *   SUPER         POST /admin/apply-checks                   항목 넣기(판마다 한 번 · 절차서 4-1 표 붙여 넣기 · 감사 APPLY_CHECKS_SET)
 *   ADMIN·SUPER   POST /admin/apply-checks/{id}/mark         맞음 · 다름 · 메모(쌓기만 · 다름이면 운영 알림 APPLY_CHECK_NG · 감사 APPLY_CHECK_MARK)
 *   ADMIN·SUPER   GET  /admin/ops-alerts/weekly              운영 알림 주간 통계(지난주 월 ~ 일 · 한국)
 *   공개          POST /auth/withdraw/cancel                 탈퇴 유예 중 「탈퇴 취소」(이메일 · 비밀번호 · 감사 ACCOUNT_WITHDRAW_CANCEL)
 * ------------------------------------------------------------------- */

export class ApplyChecksDto {
  @ApiProperty({ example: 'v10.372', description: '판' }) @Matches(/^v\d+\.\d+$/) version!: string;
  @ApiProperty({ description: '절차서 4-1 표(| # | 곳 | 맞으면 |)를 그대로 붙여 넣거나 한 줄에 한 항목(60개까지)' }) @IsString() @Length(2, 30000) text!: string;
}
export class ApplyMarkDto {
  @ApiProperty({ enum: ['OK', 'NG'] }) @IsIn(['OK', 'NG']) result!: string;
  @ApiPropertyOptional({ example: '「소개리드」 줄이 없음', description: '메모(300자까지 · 다름이면 권함)' }) @IsOptional() @IsString() @Length(0, 600) memo?: string;
}
export class WithdrawCancelDto {
  @ApiProperty({ example: 'me@example.com' }) @IsEmail() email!: string;
  @ApiProperty() @IsString() @Length(1, 100) password!: string;
}

@ApiTags('ADM')
@Controller('api/v1')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class OpsWeekController {
  constructor(private readonly db: DatabaseService) {}

  /* ── ② 운영 적용 확인표 ── */
  @Get('admin/apply-checks')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'version', required: false, description: '판(비우면 지금 판 — 운영 적용 기록의 가장 최근 줄 · 없으면 VERSION)' })
  @ApiOperation({ summary: '운영 적용 확인표 (v10.374)', description: '그 판 항목 · 항목마다 가장 최근 표시(맞음 · 다름 · 메모 · 누가 가림 · 때) · 완료 수 · 다름 수 · 최근 판 5개 · 넣을 수 있는가(SUPER).' })
  @ApiOkResponse({ type: Object })
  async checks(@Req() req: Request, @Query('version') vIn?: string) {
    const p = (req as any).principal as Principal | undefined;
    const version = /^v\d+\.\d+$/.test(String(vIn ?? '')) ? String(vIn) : await this.currentVersion();
    const rows = await this.db.query<Record<string, unknown> & { by: string | null; result: string | null }>(
      `SELECT c.id::text AS id, c.item_no AS "no", c.item, m.result, m.memo, m.marked_at AS "markedAt", a.email::text AS by,
              (SELECT count(*)::int FROM ops_apply_marks x WHERE x.check_id = c.id) AS marks
         FROM ops_apply_checks c
         LEFT JOIN LATERAL (SELECT * FROM ops_apply_marks x WHERE x.check_id = c.id ORDER BY x.marked_at DESC, x.id DESC LIMIT 1) m ON true
         LEFT JOIN accounts a ON a.id = m.marked_by
        WHERE c.version = $1 ORDER BY c.item_no`, [version]);
    const versions = await this.db.query<{ version: string; n: number }>(
      `SELECT version, count(*)::int AS n FROM ops_apply_checks GROUP BY version ORDER BY max(created_at) DESC LIMIT 5`);
    return {
      version, items: rows.map((r) => ({ ...r, by: maskMail(r.by) })), total: rows.length,
      done: rows.filter((r) => r.result).length, ng: rows.filter((r) => r.result === 'NG').length, versions, canSet: (p?.roles ?? []).includes('SUPER'),
    };
  }

  @Post('admin/apply-checks')
  @HttpCode(200)
  @ApiBearerAuth()
  @Roles('SUPER')
  @Audit('APPLY_CHECKS_SET', 'SETTING')
  @ApiOperation({ summary: '운영 적용 확인표 항목 넣기 (v10.374 · SUPER)', description: '판마다 한 번(고치기 · 지우기 없음). 표 줄(| 1 | 곳 | 맞으면 |)이면 곳 · 맞으면을 한 항목으로, 아니면 한 줄 = 한 항목. 머리 · 구분 줄은 뺌 · 60개까지.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'APPLY_CHECKS_EXIST — 그 판은 이미 넣음' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'APPLY_CHECKS_EMPTY · APPLY_CHECKS_TOO_MANY' })
  async setChecks(@Body() dto: ApplyChecksDto) {
    const items = parseApplyItems(dto.text);
    if (!items.length) throw new PolicyViolation('APPLY_CHECKS_EMPTY', '항목을 찾지 못했습니다(표 줄이나 한 줄에 한 항목).');
    if (items.length > 60) throw new PolicyViolation('APPLY_CHECKS_TOO_MANY', '항목은 60개까지입니다.');
    const [has] = await this.db.query(`SELECT 1 FROM ops_apply_checks WHERE version = $1 LIMIT 1`, [dto.version]);
    if (has) throw new AppError(409, { code: 'APPLY_CHECKS_EXIST', message: '그 판의 확인표는 이미 넣었습니다(고치기 없음).' });
    await this.db.transaction(async () => {
      for (const [i, t] of items.entries()) {
        await this.db.query(`INSERT INTO ops_apply_checks (version, item_no, item, created_by) VALUES ($1, $2, $3, $4)`, [dto.version, i + 1, t, RequestCtx.actorId() ?? null]);
      }
    });
    return { ok: true, version: dto.version, count: items.length, note: `${dto.version} 확인표에 ${items.length}개 항목을 넣었습니다.` };
  }

  @Post('admin/apply-checks/:id/mark')
  @HttpCode(200)
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @Audit('APPLY_CHECK_MARK', 'SETTING')
  @ApiParam({ name: 'id', example: 1 })
  @ApiOperation({ summary: '운영 적용 확인표 표시 (v10.374)', description: '맞음 · 다름(쌓기만 · 가장 최근이 지금 상태). 다름이면 운영 알림 APPLY_CHECK_NG(경고 · 판 · 항목).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  async mark(@Param('id', ParseIntPipe) id: number, @Body() dto: ApplyMarkDto) {
    const memo = (dto.memo ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || null;
    const [c] = await this.db.query<{ version: string; item_no: number; item: string }>(`SELECT version, item_no, item FROM ops_apply_checks WHERE id = $1`, [id]);
    if (!c) throw new AppError(404, { code: 'NOT_FOUND', message: '그 항목이 없습니다.' });
    await this.db.query(`INSERT INTO ops_apply_marks (check_id, result, memo, marked_by) VALUES ($1, $2, $3, $4)`, [id, dto.result, memo, RequestCtx.actorId() ?? null]);
    if (dto.result === 'NG') {
      await this.db.query(
        `INSERT INTO ops_alerts (alert_code, severity, title, detail) VALUES ('APPLY_CHECK_NG', 'WARN', $1, $2::jsonb)`,
        [`운영 적용 확인 「다름」 — ${c.version} ${c.item_no}번 ${c.item.slice(0, 60)}${memo ? ` · ${memo.slice(0, 60)}` : ''}`, JSON.stringify({ version: c.version, no: c.item_no, checkId: String(id) })]).catch(() => undefined);
    }
    return { ok: true, id: String(id), result: dto.result, note: dto.result === 'NG' ? '「다름」으로 적고 운영 알림을 남겼습니다.' : '「맞음」으로 적었습니다.' };
  }

  /* ── ③ 운영 알림 주간 통계 ── */
  @Get('admin/ops-alerts/weekly')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '운영 알림 주간 통계 (v10.375)', description: '지난주(월 ~ 일 · 한국) 종류별 수 · 급한 것 수 · 확인까지 평균 분 · 아직 확인 안 한 것 · 잠시 끈 횟수 · 보고 한 줄.' })
  @ApiOkResponse({ type: Object })
  weekly() { return opsAlertWeekly(this.db); }

  /* ── ④ 탈퇴 취소 ── */
  @Post('auth/withdraw/cancel')
  @HttpCode(200)
  @Audit('ACCOUNT_WITHDRAW_CANCEL', 'ACCOUNT')
  @ApiOperation({ summary: '탈퇴 취소 (v10.376 · 유예 중)', description: '설정 member.withdraw_grace_days 가 켜져 있고 탈퇴한 지 그 날 수 안 · 파기 전이면 이메일 · 비밀번호로 계정을 되살림(등록 카드 · 구독은 다시). 틀리면 로그인 실패와 같이 셈.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'INVALID_CREDENTIALS' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'WITHDRAW_CANCEL_CLOSED — 유예가 꺼졌거나 지남 · 탈퇴한 계정이 아님' })
  async cancelWithdraw(@Body() dto: WithdrawCancelDto) {
    const email = dto.email.trim().toLowerCase();
    const [a] = await this.db.query<{ id: string; password_hash: string; status: string; open: boolean }>(
      `SELECT id::text AS id, password_hash, status,
              (withdrawn_at IS NOT NULL AND purged_at IS NULL AND fn_setting_int('member.withdraw_grace_days', 0) > 0
               AND withdrawn_at > now() - make_interval(days => fn_setting_int('member.withdraw_grace_days', 0))) AS open
         FROM accounts WHERE email = $1`, [email]);
    if (!a || !a.password_hash || !(await bcrypt.compare(dto.password, a.password_hash))) {
      await this.db.query(`SELECT fn_login_fail($1, $2)`, [email, 'withdraw-cancel']).catch(() => undefined);
      throw new AppError(403, { code: 'INVALID_CREDENTIALS', message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }
    if (a.status !== 'WITHDRAWN' || !a.open) throw new AppError(409, { code: 'WITHDRAW_CANCEL_CLOSED', message: '탈퇴를 취소할 수 있는 기간이 아닙니다.' });
    await this.db.transaction(async () => {
      await this.db.query(`UPDATE accounts SET withdrawn_at = NULL, retention_until = NULL, status = 'ACTIVE' WHERE id = $1`, [a.id]);
      await this.db.query(`UPDATE account_withdrawals SET canceled_at = now() WHERE account_id = $1`, [a.id]);
    });
    return { ok: true, note: '탈퇴를 취소했습니다. 다시 로그인해 주십시오(내려간 매물 · 요청은 다시 올리고, 카드 · 구독은 다시 등록 · 신청해 주십시오).' };
  }

  /** 지금 판 — 돌고 있는 API 의 VERSION(운영 적용 기록과 같은 값) */
  private async currentVersion(): Promise<string> {
    return String(APP_VERSION).match(/v\d+\.\d+/)?.[0] ?? 'v0.0';
  }
}
