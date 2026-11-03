import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { OpsAlertsService } from './ops-alerts.service';
import { PiiReviewService } from './pii-review.service';
import { RoleReviewService } from './role-review.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

export class OpsAlertAckDto {
  @ApiPropertyOptional({ example: '디스크 정리 뒤 백업 다시 돎', description: '확인 메모(선택 · 200자)' })
  @IsOptional() @IsString() @Length(0, 200) note?: string;
}

export class OpsAlertAckCodeDto extends OpsAlertAckDto {
  @ApiProperty({ example: 'SLOW_API', description: '이 종류의 확인 안 한 알림을 모두 확인' })
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,59}$/, { message: '알림 종류 형식이 맞지 않습니다.' }) code!: string;
}

export class PiiReviewDto {
  @ApiProperty({ example: '2026-10', description: '점검한 달(끝난 달만)' })
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: '달은 YYYY-MM 으로 적어 주십시오.' }) month!: string;

  @ApiProperty({ example: '살펴볼 것 0명 — 이상 없음', description: '점검 메모(5 ~ 1000자) — 무엇을 보고 어떻게 판단했는지' })
  @IsString() @Length(5, 1000) note!: string;
}

export class RoleReviewDto {
  @ApiProperty({ example: '2026-Q4', description: '점검한 분기(이번 분기 또는 지난 분기)' })
  @IsString() @Matches(/^\d{4}-Q[1-4]$/, { message: '분기는 2026-Q4 처럼 적어 주십시오.' }) quarter!: string;

  @ApiProperty({ example: '운영자 3명 · 오래 안 쓴 계정 없음 · 2단계 모두 등록', description: '점검 메모(5 ~ 1000자)' })
  @IsString() @Length(5, 1000) note!: string;
}

/* ---------------------------------------------------------------------
 * v10.179 (D168 · docs/279) — 운영 알림 목록 · 확인(SB-ADM-OPS-010) · 개인정보 접속기록 월 점검(SB-ADM-PII-010 · SUPER)
 * ------------------------------------------------------------------- */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class OpsReviewController {
  constructor(private readonly alerts: OpsAlertsService, private readonly pii: PiiReviewService, private readonly roles: RoleReviewService) {}

  @Get('ops-alerts')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '운영 알림 목록', description: '기본은 확인 안 한 것(state=all 이면 전부) · 종류(code) · 등급(severity) 거르기 · 종류별 확인 안 한 수 · 지난 7일 수(codes).' })
  @ApiQuery({ name: 'state', required: false, enum: ['open', 'all'] })
  @ApiQuery({ name: 'code', required: false }) @ApiQuery({ name: 'severity', required: false, enum: ['INFO', 'WARN', 'CRITICAL'] })
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'size', required: false })
  @ApiOkResponse({ type: Object })
  list(@Query() q: Record<string, unknown>) { return this.alerts.list(q); }

  @Post('ops-alerts/ack-code')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '같은 종류 한꺼번에 확인', description: '이 종류의 확인 안 한 알림을 모두 확인(누가 · 언제 · 메모). 알림 내용은 바뀌지 않음.' })
  @ApiOkResponse({ type: Object })
  ackCode(@Body() dto: OpsAlertAckCodeDto) { return this.alerts.ackCode(dto.code, dto.note); }

  @Post('ops-alerts/:id/ack')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '운영 알림 확인', description: '한 번만 — 이미 확인했으면 409 ALERT_ACKED. 확인 기록 · 알림 내용은 바꿀 수 없음(DB).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto }) @ApiResponse({ status: 409, type: ErrorDto, description: 'ALERT_ACKED' })
  ack(@Param('id') id: string, @Body() dto: OpsAlertAckDto) { return this.alerts.ack(id, dto.note); }

  @Get('pii-review')
  @Roles('SUPER')
  @ApiOperation({ summary: '개인정보 접속기록 — 지난 12달', description: '달마다 조회 수 · 점검 여부 · 끝난 달인지.' })
  @ApiOkResponse({ type: Object })
  piiMonths() { return this.pii.months(); }

  @Get('pii-review/:month')
  @Roles('SUPER')
  @ApiOperation({ summary: '개인정보 접속기록 — 한 달', description: '운영자별 본 수 · 대상 수 · 하루 최다 · 밤 조회 · 내려받기 · 「살펴볼 것」 · 대상 종류별 · 점검 기록.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PII_REVIEW_MONTH' })
  piiMonth(@Param('month') month: string) { return this.pii.detail(month); }

  @Post('pii-review')
  @Roles('SUPER')
  @Audit('PII_REVIEW', 'PII')
  @ApiOperation({ summary: '개인정보 접속기록 점검 완료', description: '끝난 달만 · 한 달에 한 번 · 요약을 함께 남김 · 고칠 수 없음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PII_REVIEW_DONE' }) @ApiResponse({ status: 422, type: ErrorDto, description: 'PII_REVIEW_OPEN_MONTH · PII_REVIEW_MONTH' })
  piiReview(@Body() dto: PiiReviewDto) { return this.pii.review(dto.month, dto.note); }

  /* ── v10.180 (D169 · docs/281) — 운영자 권한 점검(SB-ADM-ROLE-010 · SUPER) · 파기 기록(SB-ADM-PURGE-010) ── */

  @Get('role-review')
  @Roles('SUPER')
  @ApiOperation({ summary: '운영자 권한 — 운영자 · 최근 권한 변경 · 분기 점검', description: '운영 역할 계정마다 역할 · 받은 날 · 마지막 로그인 · 2단계 등록 · 오래 안 씀(ops.role_idle_days) · 최근 권한 변경 50건 · 지난 4분기 점검 여부.' })
  @ApiOkResponse({ type: Object })
  async roleReview() {
    const [operators, changes, quarters] = await Promise.all([this.roles.operators(), this.roles.changes(), this.roles.quarters()]);
    return { ...operators, changes, quarters };
  }

  @Post('role-review')
  @Roles('SUPER')
  @Audit('ROLE_REVIEW', 'ROLE')
  @ApiOperation({ summary: '운영자 권한 점검 완료', description: '이번 분기 또는 지난 분기 · 분기에 한 번 · 그때 요약을 함께 남김 · 고칠 수 없음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ROLE_REVIEW_DONE' }) @ApiResponse({ status: 422, type: ErrorDto, description: 'ROLE_REVIEW_QUARTER_RANGE · ROLE_REVIEW_NOTE' })
  roleReviewDone(@Body() dto: RoleReviewDto) { return this.roles.review(dto.quarter, dto.note); }

  @Get('purge-log')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '파기 실행 기록', description: '매일 03:00 개인정보 파기(pii_purge)가 지운 건수 — 날짜별 · 달별 · 마지막 실행 · 지금 기한 넘긴 건수. 건수만(개인정보 없음).' })
  @ApiQuery({ name: 'days', required: false, description: '기본 60 · 최대 400' })
  @ApiOkResponse({ type: Object })
  purgeLog(@Query('days') days?: string) { return this.roles.purges(Number(days) || 60); }
}
