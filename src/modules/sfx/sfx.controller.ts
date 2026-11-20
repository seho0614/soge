import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { deviceDetail, deviceOverview } from './device';
import { RET_DATE_RE, retentionDestroy, retentionDestroyed, retentionEdit, retentionList, retentionRuleEdit, retentionRules, retentionSync } from './retention';
import { TM_TEXT_MAX, tmBackfill, tmEdit, tmList } from './tm';

/* ---------------------------------------------------------------------
 * v10.546 ~ 548 (D285 · docs/684 ~ 686) (55) 운영 · 보안 — 운영 화면 api/v1/admin/sfx
 *   v10.546 같은 기기 여러 계정  GET /device · GET /device/{mark}(감사 SFX_DEVICE_VIEW)                         ADMIN · SUPER
 *   v10.547 서류 보관 기한      GET /retention/rules · GET /retention · GET /retention/destroyed · POST /retention/sync  ADMIN · SUPER
 *                              PUT /retention/rules/{code} · PUT /retention/{fileId} · POST /retention/{fileId}/destroy   SUPER
 *   v10.548 번역 메모리         GET /tm · PUT /tm/{id} · POST /tm/backfill                                         ADMIN · SUPER
 *   ★ 세무사(ACCOUNTANT)는 /admin/acct/ 접두가 아니라 보지 않음(규칙 8) · 회원 API 없음(사용자 웹은 기기 표지 쿠키만 · site/src/lib/session.ts)
 * ------------------------------------------------------------------- */

const actor = () => RequestCtx.actorId() ?? null;

export class SfxRetRuleEditDto {
  @ApiPropertyOptional({ example: 60, description: '보관 개월 1 ~ 600(법정 최소 밑이면 422 SFX_RET_MIN)' }) @IsOptional() @IsInt() @Min(1) @Max(600) months?: number;
  @ApiPropertyOptional({ example: true, description: '켜기 — 끄면 대장 맞추기가 그 용도를 새로 넣지 않음(이미 있는 줄은 그대로)' }) @IsOptional() @IsBoolean() active?: boolean;
}
export class SfxRetEditDto {
  @ApiPropertyOptional({ example: '2026-03-31', description: '기준일 YYYY-MM-DD(2000-01-01 ~ 오늘) — 만료일 = 기준일 + 보관 개월' }) @IsOptional() @IsString() @Matches(RET_DATE_RE) baseDate?: string;
  @ApiPropertyOptional({ example: true, description: '법정 보관(보존) 걸기 true · 풀기 false — 걸린 서류는 어떤 화면에서도 지우지 못함' }) @IsOptional() @IsBoolean() hold?: boolean;
  @ApiPropertyOptional({ example: '세무조사 자료 보존 요청(2026-11)', description: '보존 까닭 2 ~ 300자(걸 때 필수)' }) @IsOptional() @IsString() @Length(0, 300) holdReason?: string;
  @ApiProperty({ example: '퇴직일로 기준일 고침', description: '사유 2 ~ 300자(감사 기록)' }) @IsString() @Length(2, 300) reason!: string;
}
export class SfxRetDestroyDto {
  @ApiProperty({ example: '보관 기한(5년) 지남 · 세무 신고 끝', description: '파기 사유 2 ~ 300자(파기 기록 · 감사 기록)' }) @IsString() @Length(2, 300) reason!: string;
  @ApiProperty({ example: '파기', description: '확인 — 「파기」 두 글자(다르면 422 SFX_RET_CONFIRM)' }) @IsString() @Length(1, 10) confirm!: string;
}
export class SfxTmEditDto {
  @ApiPropertyOptional({ example: 'Two-room office near the station', description: `번역 1 ~ ${TM_TEXT_MAX}자 — 고치면 사람 번역(HUMAN)` }) @IsOptional() @IsString() @Length(1, TM_TEXT_MAX) text?: string;
  @ApiPropertyOptional({ example: false, description: '끄면 자동 번역이 이 줄을 쓰지 않음' }) @IsOptional() @IsBoolean() active?: boolean;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/sfx')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class SfxAdminController {
  constructor(private readonly db: DatabaseService) {}

  /* ── 같은 기기 여러 계정 (v10.546) ── */
  @Get('device')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '같은 기기 여러 계정 (v10.546)', description: '스위치(sfx.device_watch · 처음 off) · 기준 · 보관 · 최근 30일 계정 2개 이상인 기기 표지(해시 앞 16자) · 열린 경보. 자동 정지 없음.' })
  @ApiOkResponse({ type: Object })
  device() { return deviceOverview(this.db); }

  @Get('device/:mark')
  @Roles('ADMIN', 'SUPER')
  @Audit('SFX_DEVICE_VIEW', 'ACCOUNT')
  @ApiParam({ name: 'mark', example: '3fa85f6457174562', description: '기기 표지(해시 앞 16자)' })
  @ApiOperation({ summary: '기기 표지 한 개의 계정 (v10.546)', description: '같은 표지로 가입 · 로그인한 계정(가린 이메일 · 이름 · 상태 · 가입일 · 처음 · 마지막) · 경보. 감사 기록.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  deviceOne(@Param('mark') mark: string) { return deviceDetail(this.db, mark); }

  /* ── 서류 보관 기한 (v10.547) ── */
  @Get('retention/rules')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '서류 보관 기간 표 (v10.547)', description: '용도(HR_DOC · LGL_DOC · ACCT_EVIDENCE · CORP_DOC)마다 개월 · 법정 최소 · 근거 · 대장 수(보관 · 곧 만료 · 지남 · 보존 · 파기 · 대장에 없음) · 알림 스위치.' })
  @ApiOkResponse({ type: Object })
  rules() { return retentionRules(this.db); }

  @Put('retention/rules/:code')
  @Roles('SUPER')
  @Audit('SFX_RET_RULE', 'SETTING')
  @ApiParam({ name: 'code', example: 'ACCT_EVIDENCE' })
  @ApiOperation({ summary: '보관 기간 고치기 (v10.547 · SUPER)', description: '개월 · 켜기만 — 법정 최소 밑으로 못 내림 · 보관 중인 서류 만료일 다시 셈.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SFX_RET_MIN · SFX_RET_NOTHING' })
  ruleEdit(@Param('code') code: string, @Body() dto: SfxRetRuleEditDto) {
    const v: { months?: number; active?: boolean } = {};
    if (dto.months !== undefined) v.months = dto.months;
    if (dto.active !== undefined) v.active = dto.active;
    return retentionRuleEdit(this.db, code, v, actor());
  }

  @Get('retention')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'state', required: false, enum: ['KEEP', 'DESTROYED', 'GONE', 'ALL'] })
  @ApiQuery({ name: 'purpose', required: false, enum: ['ACCT_EVIDENCE', 'HR_DOC', 'LGL_DOC', 'CORP_DOC'] })
  @ApiQuery({ name: 'due', required: false, enum: ['soon', 'over'], description: 'soon 알림 일수 안 · over 지남' })
  @ApiQuery({ name: 'hold', required: false, enum: ['1'], description: '법정 보관(보존)만' })
  @ApiOperation({ summary: '서류 보관 대장 (v10.547)', description: '서류마다 기준일 · 만료일 · 남은 날 · 보존 · 상태 — 만료일 순 200.' })
  @ApiOkResponse({ type: Object })
  list(@Query('state') state?: string, @Query('purpose') purpose?: string, @Query('due') due?: string, @Query('hold') hold?: string) {
    return retentionList(this.db, { state, purpose, due, hold });
  }

  @Post('retention/sync')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @Audit('SFX_RET_SYNC', 'FILE')
  @ApiOperation({ summary: '보관 대장 맞추기 (v10.547)', description: '표에 있는 용도의 READY 파일 중 대장에 없는 것을 넣고(기준일 = 올린 날) 지운 파일은 없어짐(GONE)으로. 다시 눌러도 같음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '없음' })
  sync() { return retentionSync(this.db); }

  @Get('retention/destroyed')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '서류 파기 기록 (v10.547)', description: '파기한 서류(가린 이름 · 용도 · 기준일 · 만료일 · 사유 · 누가 · 저장소 지움) — 최근 200 · 쌓기만.' })
  @ApiOkResponse({ type: Object })
  destroyed() { return retentionDestroyed(this.db); }

  @Put('retention/:fileId')
  @Roles('SUPER')
  @Audit('SFX_RET_EDIT', 'FILE')
  @ApiParam({ name: 'fileId', format: 'uuid' })
  @ApiOperation({ summary: '보관 대장 고치기 (v10.547 · SUPER)', description: '기준일 · 법정 보관(보존) 걸기 · 풀기 — 사유 · 감사 기록. 파기했거나 없어진 줄은 409.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SFX_RET_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SFX_RET_NOTHING · SFX_RET_BASE · SFX_RET_HOLD_REASON · SFX_RET_REASON' })
  edit(@Param('fileId') fileId: string, @Body() dto: SfxRetEditDto) {
    const v: { baseDate?: string; hold?: boolean; holdReason?: string; reason: string } = { reason: dto.reason };
    if (dto.baseDate !== undefined) v.baseDate = dto.baseDate;
    if (dto.hold !== undefined) v.hold = dto.hold;
    if (dto.holdReason !== undefined) v.holdReason = dto.holdReason;
    return retentionEdit(this.db, fileId, v, actor());
  }

  @Post('retention/:fileId/destroy')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('SFX_RET_DESTROY', 'FILE')
  @ApiParam({ name: 'fileId', format: 'uuid' })
  @ApiOperation({ summary: '서류 파기 (v10.547 · SUPER)', description: '보관 기한이 지나고 보존이 없는 서류만 — 「파기」 입력 · 사유 · 파일 지움 · 파기 기록(쌓기만) · 저장소 바이트 지움. 다른 대장에 붙은 서류는 409.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SFX_RET_STATE · SFX_RET_HOLD · SFX_RET_NOT_DUE · SFX_RET_ATTACHED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SFX_RET_CONFIRM · SFX_RET_REASON' })
  destroy(@Param('fileId') fileId: string, @Body() dto: SfxRetDestroyDto) {
    return retentionDestroy(this.db, fileId, { reason: dto.reason, confirm: dto.confirm }, actor());
  }

  /* ── 번역 메모리 (v10.548) ── */
  @Get('tm')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'q', required: false, description: '원문 · 번역 글자(100자까지)' })
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiQuery({ name: 'origin', required: false, enum: ['HUMAN', 'MACHINE'] })
  @ApiQuery({ name: 'active', required: false, enum: ['1', '0'] })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiOperation({ summary: '번역 메모리 찾기 (v10.548)', description: '스위치(sfx.tm · 처음 off) · 수(사람 · 엔진 · 끈 줄 · 쓰인 횟수) · 원문 · 번역 찾기 50줄씩.' })
  @ApiOkResponse({ type: Object })
  tm(@Query('q') q?: string, @Query('lang') lang?: string, @Query('origin') origin?: string, @Query('active') active?: string, @Query('page') page?: string) {
    return tmList(this.db, { q, lang, origin, active, page });
  }

  @Put('tm/:id')
  @Roles('ADMIN', 'SUPER')
  @Audit('SFX_TM_EDIT', 'I18N')
  @ApiParam({ name: 'id', example: '12' })
  @ApiOperation({ summary: '번역 메모리 고치기 · 끄기 (v10.548)', description: '번역을 고치면 사람 번역(HUMAN) — 엔진 번역이 덮지 못함 · 끄면 자동 번역이 쓰지 않음 · 이미 저장된 번역은 그대로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SFX_TM_NOTHING · SFX_TM_TEXT · SFX_TM_BANNED' })
  tmUpdate(@Param('id') id: string, @Body() dto: SfxTmEditDto) {
    const v: { text?: string; active?: boolean } = {};
    if (dto.text !== undefined) v.text = dto.text;
    if (dto.active !== undefined) v.active = dto.active;
    return tmEdit(this.db, id, v, actor());
  }

  @Post('tm/backfill')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @Audit('SFX_TM_BACKFILL', 'I18N')
  @ApiOperation({ summary: '지금 번역으로 번역 메모리 채우기 (v10.548)', description: '지금 원문과 같은 승인 · 자동 승인 번역 최근 2000줄(소개광장 글 · 댓글 빼고) — 다시 눌러도 같음 · 꺼져 있으면 422.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SFX_TM_OFF' })
  backfill() { return tmBackfill(this.db); }
}
