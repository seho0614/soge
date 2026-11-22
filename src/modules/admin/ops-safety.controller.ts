import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { ErrorDto } from '../../common/dto/common.dto';
import { Principal, Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { PiiAccess } from '../../core/pii-audit.interceptor';
import { PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { maskMail } from '../../common/mail/mail-admin.service';
import { EXPORT_TARGETS, ExportApprovalService } from './export-approval';
import { ACTIVITY_KINDS, memberActivity } from './member-activity';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * v10.365 ~ 368 (D238 · docs/500 ~ 503)
 *   ADMIN·SUPER   GET  /admin/accounts/{id}/activity?kind=      회원 활동 한 줄 기록(최근 100 · 종류 거르기 · 개인정보 접속기록)
 *   PAYOUT·SUPER  GET  /admin/export-requests                   내려받기 승인(기다림 · 내 요청 · 최근 결정)
 *   PAYOUT·SUPER  GET  /admin/export-requests/ready?target=     이 대상의 내 승인 번호
 *   PAYOUT·SUPER  POST /admin/export-requests                   내려받기 요청(사유 · 하루 10건 · 감사 EXPORT_REQUEST)
 *   SUPER         POST /admin/export-requests/{id}/decide       승인 · 거절(감사 EXPORT_DECIDE)
 *   ADMIN·SUPER   GET  /admin/restore-drills                    DB 복원 시험 기록 · 마지막 · 지난 날
 *   SUPER         POST /admin/restore-drills                    복원 시험 적기(감사 RESTORE_DRILL_ADD)
 * ------------------------------------------------------------------- */

export class ExportRequestDto {
  @ApiProperty({ enum: [...EXPORT_TARGETS] }) @IsIn([...EXPORT_TARGETS]) target!: string;
  @ApiProperty({ example: '11월 원천징수 신고', description: '사유(2 ~ 200자)' }) @IsString() @Length(1, 400) reason!: string;
}
export class ExportDecideDto {
  @ApiProperty({ description: 'true 승인 · false 거절' }) @StrictBoolean() approve!: boolean;
  @ApiPropertyOptional({ example: '신고 기한 확인', description: '메모(200자까지)' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
}
export class RestoreDrillDto {
  @ApiProperty({ example: '2026-11-18', description: '시험한 날(오늘 · 지난 1년 안)' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) drillDate!: string;
  @ApiProperty({ example: 'rds:sgb-db-2026-11-18-03-10', description: '복원한 스냅샷 이름' }) @IsString() @Length(2, 100) snapshot!: string;
  @ApiProperty({ example: 25, description: '복원에 걸린 분(1 ~ 1440)' }) @IsInt() @Min(1) @Max(1440) minutes!: number;
  @ApiProperty({ description: '행 수 대조가 맞았는가' }) @StrictBoolean() rowsMatch!: boolean;
  @ApiProperty({ description: '이상 없이 끝났는가' }) @StrictBoolean() ok!: boolean;
  @ApiPropertyOptional({ example: '새 DB 지움', description: '메모(500자까지)' }) @IsOptional() @IsString() @Length(0, 500) note?: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class OpsSafetyController {
  constructor(private readonly db: DatabaseService, private readonly exports: ExportApprovalService) {}

  /* ── ① 회원 활동 한 줄 기록 ── */
  @Get('accounts/:id/activity')
  @Roles('ADMIN', 'SUPER')
  @PiiAccess('ACCOUNT', '회원 활동 기록')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'kind', required: false, enum: [...ACTIVITY_KINDS], description: '하나만 보기(비우면 모두)' })
  @ApiOperation({ summary: '회원 활동 한 줄 기록 (v10.365)', description: '가입 · 본인인증 · 로그인 · 1:1 문의 · 받은 신고 · 한 신고 · 등록 정지 · 운영 메모 · 권한 바뀜 · 탈퇴를 최근 순 100줄. 종류별 수. 본문 · 연락처 없음 · 열면 개인정보 접속기록.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 회원 없음' })
  activity(@Param('id', ParseUUIDPipe) id: string, @Query('kind') kind?: string) {
    return memberActivity(this.db, id, kind);
  }

  /* ── ② 개인정보 대량 내려받기 승인 ── */
  @Get('export-requests')
  @Roles('PAYOUT', 'SUPER', 'ACCOUNTANT')   // v10.437 (D257) 세무사 — 자기 요청만
  @ApiOperation({ summary: '내려받기 승인 (v10.366)', description: '기다리는 요청(SUPER) · 내 요청 최근 20 · 최근 결정 20(SUPER) · 오늘 내 요청 수 / 하루 10 · 결정할 수 있는가 · 다른 SUPER 수.' })
  @ApiOkResponse({ type: Object })
  exportList(@Req() req: Request) {
    const p = (req as any).principal as Principal | undefined;
    return this.exports.list((p?.roles ?? []) as string[]);
  }

  @Get('export-requests/ready')
  @Roles('PAYOUT', 'SUPER', 'ACCOUNTANT')   // v10.437 (D257)
  @ApiQuery({ name: 'target', enum: [...EXPORT_TARGETS] })
  @ApiOperation({ summary: '내 내려받기 승인 번호 (v10.366)', description: '이 대상에서 승인되고 안 쓴 번호(24시간 안) · 기다리는 요청 번호.' })
  @ApiOkResponse({ type: Object })
  exportReady(@Query('target') target: string) { return this.exports.ready(String(target ?? '')); }

  @Post('export-requests')
  @HttpCode(200)
  @Roles('PAYOUT', 'SUPER', 'ACCOUNTANT')   // v10.437 (D257) — 대상마다 역할은 export-approval TARGET_ROLES
  @Audit('EXPORT_REQUEST', 'SETTING')
  @ApiOperation({ summary: '내려받기 요청 (v10.366)', description: '사유 필수 · 하루 10건. SUPER 가 요청자 한 명뿐이면 스스로 승인(solo). 같은 대상의 기다림 · 안 쓴 승인이 있으면 그것을 돌려줌.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_TARGET · EXPORT_REASON · EXPORT_DAILY_LIMIT' })
  exportRequest(@Body() dto: ExportRequestDto, @Req() req: Request) {
    const p = (req as any).principal as Principal | undefined;
    return this.exports.request(dto.target, dto.reason, (p?.roles ?? []) as string[]);
  }

  @Post('export-requests/:id/decide')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('EXPORT_DECIDE', 'SETTING')
  @ApiParam({ name: 'id', example: 1 })
  @ApiOperation({ summary: '내려받기 승인 · 거절 (v10.366 · SUPER)', description: '자기 요청은 다른 SUPER 가(SUPER 가 자기 한 명이면 스스로).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'EXPORT_DECIDED — 이미 결정됨' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_SELF_APPROVE' })
  exportDecide(@Param('id', ParseIntPipe) id: number, @Body() dto: ExportDecideDto) {
    return this.exports.decide(id, dto.approve, dto.note);
  }

  /* ── ④ DB 복원 시험 기록 ── */
  @Get('restore-drills')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: 'DB 복원 시험 기록 (v10.368)', description: '최근 12번 · 마지막 시험 · 지난 날 · 주기(설정 ops.restore_drill_days) · 넘김 · 적을 수 있는가(SUPER).' })
  @ApiOkResponse({ type: Object })
  async drills(@Req() req: Request) {
    const p = (req as any).principal as Principal | undefined;
    const rows = await this.db.query<Record<string, unknown> & { by: string | null }>(
      `SELECT d.id::text AS id, to_char(d.drill_date, 'YYYY-MM-DD') AS "drillDate", d.snapshot, d.minutes, d.rows_match AS "rowsMatch", d.ok, d.note,
              d.created_at AS "createdAt", a.email::text AS by
         FROM restore_drills d LEFT JOIN accounts a ON a.id = d.created_by ORDER BY d.drill_date DESC, d.id DESC LIMIT 12`);
    const [s] = await this.db.query<{ days: number | null; due: number }>(
      `SELECT ((now() AT TIME ZONE 'Asia/Seoul')::date - (SELECT max(drill_date) FROM restore_drills))::int AS days,
              coalesce((SELECT CASE WHEN value ~ '^[0-9]+$' THEN value::int END FROM site_settings WHERE key = 'ops.restore_drill_days'), 30) AS due`);
    const days = s?.days == null ? null : Number(s.days);
    const due = Number(s?.due ?? 30);
    return {
      rows: rows.map((r) => ({ ...r, by: maskMail(r.by) })), last: rows[0] ?? null, daysSince: days, dueDays: due,
      overdue: days == null || days > due, canEdit: (p?.roles ?? []).includes('SUPER'),
    };
  }

  @Post('restore-drills')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('RESTORE_DRILL_ADD', 'SETTING')
  @ApiOperation({ summary: 'DB 복원 시험 적기 (v10.368 · SUPER)', description: '쌓기만(고치기 · 지우기 없음). 날짜는 오늘 · 지난 1년 안. 적으면 운영 알림 RESTORE_DRILL_DUE 가 풀림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'RESTORE_DRILL_DATE · RESTORE_DRILL_SNAPSHOT' })
  async addDrill(@Body() dto: RestoreDrillDto) {
    const snap = dto.snapshot.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{1,99}$/.test(snap)) throw new PolicyViolation('RESTORE_DRILL_SNAPSHOT', '스냅샷 이름은 영문 · 숫자 · - · : · . · _ 로 2 ~ 100자입니다.');
    const [d] = await this.db.query<{ ok: boolean }>(
      `SELECT ($1::date <= (now() AT TIME ZONE 'Asia/Seoul')::date AND $1::date > (now() AT TIME ZONE 'Asia/Seoul')::date - 366) AS ok`, [dto.drillDate]).catch(() => [{ ok: false }]);
    if (!d?.ok) throw new PolicyViolation('RESTORE_DRILL_DATE', '시험한 날은 오늘이나 지난 1년 안이어야 합니다.');
    const note = (dto.note ?? '').trim().slice(0, 500) || null;
    const [r] = await this.db.query<{ id: string }>(
      `INSERT INTO restore_drills (drill_date, snapshot, minutes, rows_match, ok, note, created_by) VALUES ($1::date, $2, $3, $4, $5, $6, $7) RETURNING id::text AS id`,
      [dto.drillDate, snap, dto.minutes, dto.rowsMatch, dto.ok, note, RequestCtx.actorId() ?? null]);
    await this.db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = '복원 시험 기록됨' WHERE alert_code = 'RESTORE_DRILL_DUE' AND resolved_at IS NULL`);
    return { ok: true, id: r!.id, note: dto.ok ? '복원 시험을 적었습니다.' : '복원 시험을 적었습니다 — 이상이 있다고 적었으니 원인을 운영 게시판에 남겨 주십시오.' };
  }
}
