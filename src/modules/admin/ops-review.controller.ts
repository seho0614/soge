import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
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

export class OpsAlertAckBulkDto extends OpsAlertAckDto {
  @ApiProperty({ enum: ['resolved', 'older'], description: 'resolved 풀린 것 모두 · older 정한 시간보다 오래된 INFO · WARN 모두(둘 다 CRITICAL 은 뺌)' })
  @IsIn(['resolved', 'older']) scope!: string;
  @ApiPropertyOptional({ enum: [6, 24, 72], description: 'older 일 때 — 몇 시간 넘은 것' })
  @IsOptional() @IsIn([6, 24, 72]) hours?: number;
}
export class OpsAlertAckBulkResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ enum: ['resolved', 'older'] }) scope!: string;
  @ApiPropertyOptional({ nullable: true }) hours!: number | null;
  @ApiProperty({ description: '확인한 수(미리 보기면 확인할 수)' }) count!: number;
  @ApiProperty() note!: string;
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
 * v10.179 (D168 · docs/279) — 운영 알림 목록 · 확인(SB-ADM-OPS-010 · v10.198 메일 준비 상태 · 시험 메일) · 개인정보 접속기록 월 점검(SB-ADM-PII-010 · SUPER)
 * ------------------------------------------------------------------- */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class OpsReviewController {
  constructor(private readonly alerts: OpsAlertsService, private readonly pii: PiiReviewService, private readonly roles: RoleReviewService) {}

  @Get('ops-alerts')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '운영 알림 목록', description: '기본은 확인 안 한 것(state=all 이면 전부) · 종류(code) · 등급(severity) 거르기 · 종류별 확인 안 한 수 · 지난 7일 수(codes). v10.199 — 확인 안 한 것만 볼 때 원인이 없어진(풀린) 알림은 기본으로 뺌(resolved=show 면 같이 · resolvedHidden = 뺀 수).' })
  @ApiQuery({ name: 'state', required: false, enum: ['open', 'all'] })
  @ApiQuery({ name: 'resolved', required: false, enum: ['hide', 'show'] })
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

  /* v10.232 (docs/371) — 종류를 가리지 않고 한꺼번에 확인(CRITICAL 은 빼고 · 미리 보기는 읽기만) */
  @Get('ops-alerts/ack-bulk/preview')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '한꺼번에 확인 — 몇 건인지 미리 보기', description: 'scope=resolved 풀린 것 · scope=older&hours=6|24|72 그보다 오래된 INFO · WARN. 확인 안 한 것만 · CRITICAL 은 뺌 · 읽기만(v10.232).' })
  @ApiQuery({ name: 'scope', enum: ['resolved', 'older'] }) @ApiQuery({ name: 'hours', required: false, enum: [6, 24, 72] })
  @ApiOkResponse({ type: OpsAlertAckBulkResultDto })
  @ApiResponse({ status: 422, description: 'ACK_BULK_SCOPE', type: ErrorDto })
  ackBulkPreview(@Query('scope') scope: string, @Query('hours') hours?: string) { return this.alerts.ackBulk(scope, hours === undefined ? undefined : Number(hours), undefined, true); }

  @Post('ops-alerts/ack-bulk')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '한꺼번에 확인', description: '풀린 것 모두 또는 정한 시간보다 오래된 INFO · WARN 모두를 확인(누가 · 언제 · 메모 하나). CRITICAL 은 빼서 하나씩 · 종류별로 확인. 알림 내용은 바뀌지 않음 · 감사 기록 OPS_ALERT_ACK_BULK(v10.232).' })
  @ApiOkResponse({ type: OpsAlertAckBulkResultDto })
  @ApiResponse({ status: 422, description: 'ACK_BULK_SCOPE', type: ErrorDto })
  @Audit('OPS_ALERT_ACK_BULK', 'OPS_ALERT')
  ackBulk(@Body() dto: OpsAlertAckBulkDto) { return this.alerts.ackBulk(dto.scope, dto.hours, dto.note, false); }

  @Post('ops-alerts/:id/ack')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '운영 알림 확인', description: '한 번만 — 이미 확인했으면 409 ALERT_ACKED. 확인 기록 · 알림 내용은 바꿀 수 없음(DB).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto }) @ApiResponse({ status: 409, type: ErrorDto, description: 'ALERT_ACKED' })
  ack(@Param('id') id: string, @Body() dto: OpsAlertAckDto) { return this.alerts.ack(id, dto.note); }

  /* ── v10.198 (D176 · docs/312) — 급한 알림 메일 준비 상태 · 시험 메일 ── */

  @Get('ops-alerts/mail-status')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '급한 알림 메일 — 준비 상태', description: '메일 준비 여부 · 안 된 까닭(NO_SMTP · NOT_VERIFIED · NO_FROM) · 받는 주소(ops.digest_to · 가림) · 마지막 정기 작업(launch_watch) 메일 결과 · 마지막 시험 메일.' })
  @ApiOkResponse({ type: Object })
  mailStatus() { return this.alerts.mailStatus(); }

  @Post('ops-alerts/mail-test')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('OPS_MAIL_TEST', 'OPS_ALERT')
  @ApiOperation({ summary: '급한 알림 메일 — 시험 메일', description: '급한 알림 메일과 같은 길(받는 주소 ops.digest_to · 메일 준비)로 한 통 · 1분에 한 번 · 못 보내도 200 으로 까닭(NO_TO · MAIL_NOT_READY_* · SEND_*) · 감사 기록 OPS_MAIL_TEST.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'MAIL_TEST_WAIT' })
  mailTest() { return this.alerts.mailTest(); }

  /* ── v10.200 (D178 · docs/316) — 급한 알림 텔레그램 시험 · 대화방 찾기(준비 상태는 mail-status 의 push) ── */

  @Get('ops-alerts/push-preview')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '급한 알림 텔레그램 — 첫 차례 미리보기', description: 'v10.234 — 지금 켜면 다음 정기 작업이 보낼 글(최대 3통 · 통마다 알림 수 · 글자 수 · 글 그대로) · 대기 수 · CRITICAL · 다시 알림 · 남는 수(다음 차례). 읽기만 — 보내지 않고 「보냄」도 적지 않음. 준비 안 됨이어도 글은 보여 줌(ready · reason).' })
  @ApiOkResponse({ type: Object })
  pushPreview() { return this.alerts.pushPreview(); }

  @Post('ops-alerts/push-test')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('OPS_PUSH_TEST', 'OPS_ALERT')
  @ApiOperation({ summary: '급한 알림 텔레그램 — 시험 메시지', description: '급한 알림과 같은 길(봇 토큰 TELEGRAM_BOT_TOKEN · 대화방 ops.telegram_chat)로 한 통 · 1분에 한 번 · 못 보내도 200 으로 까닭(NO_TOKEN · NO_CHAT · SEND_*) · 감사 기록 OPS_PUSH_TEST.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PUSH_TEST_WAIT' })
  pushTest() { return this.alerts.pushTest(); }

  @Post('ops-alerts/push-find-chat')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '급한 알림 텔레그램 — 대화방 찾기', description: '봇에게 최근 말을 건 대화방(최대 10곳 · 번호 · 종류 · 이름)을 돌려줌. 고른 번호는 설정 ops.telegram_chat 에 넣음(사이트 설정 API). 봇 토큰이 없으면 reason NO_TOKEN.' })
  @ApiOkResponse({ type: Object })
  pushFindChat() { return this.alerts.pushFindChat(); }

  /* ── v10.237 (D200 · docs/377) — 급한 알림 슬랙 시험 · 첫 차례 미리보기(준비 상태는 mail-status 의 slack) ── */

  @Get('ops-alerts/slack-preview')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '급한 알림 슬랙 — 첫 차례 미리보기', description: 'v10.237 — 지금 켜면 다음 정기 작업이 슬랙으로 보낼 글(텔레그램 미리보기와 같은 글 · 칸만 slack_pushed_at). 읽기만 — 보내지 않고 「보냄」도 적지 않음. 웹훅 주소가 없어도 글은 보여 줌(ready · reason).' })
  @ApiOkResponse({ type: Object })
  slackPreview() { return this.alerts.slackPreview(); }

  @Post('ops-alerts/slack-test')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('OPS_SLACK_TEST', 'OPS_ALERT')
  @ApiOperation({ summary: '급한 알림 슬랙 — 시험 메시지', description: '급한 알림과 같은 길(웹훅 주소 SLACK_WEBHOOK_URL)로 한 통 · 1분에 한 번 · 못 보내도 200 으로 까닭(NO_WEBHOOK · SEND_*) · 감사 기록 OPS_SLACK_TEST.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SLACK_TEST_WAIT' })
  slackTest() { return this.alerts.slackTest(); }

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

  /* ── v10.180 (D169 · docs/281) — 운영자 권한 점검(SB-ADM-ROLE-010 · SUPER) · 파기 기록(SB-ADM-PRG-010) ── */

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
