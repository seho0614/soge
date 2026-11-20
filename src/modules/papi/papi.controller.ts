import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { ErrorDto } from '../../common/dto/common.dto';
import { StrictBoolean } from '../../common/strict-boolean';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { MailService } from '../../common/mail/mail.service';
import { PapiPrincipal, PapiScope, PartnerApiKeyGuard } from './guard';
import {
  PAPI_EVENTS, PAPI_SCOPES, createHook, disableHook, hookEvents, issueKey, papiOverview, papiRequests, retryEvent, revokeKey, rotateHookSecret,
  setPapiSettings, testHook, updateKey,
} from './keys';
import { papiCash, papiDocs, papiLead, papiLeads, papiMe, papiServices } from './resources';
import { papiHookSendJob } from './hooks';
import { pbulkCancel, pbulkConfirm, pbulkDetail, pbulkList, pbulkMatchJob, pbulkPreview, setPbulkSettings } from './bulk';

/* ---------------------------------------------------------------------
 * v10.521 · 522 (D278 · docs/659 · 660) 파트너 오픈 API · 직원 일괄 등록
 *
 *   운영 화면 › 파트너사 › 오픈 API(SB-ADM-OAPI-010)
 *     ADMIN · PARTNER_MAL  GET /admin/papi · /admin/papi/requests · /admin/papi/hooks/{id}/events
 *                          POST /admin/papi/keys/{id}/revoke · /admin/papi/hooks/{id}/disable · /test · /admin/papi/events/{id}/retry
 *     SUPER                POST /admin/papi/keys(원문 한 번) · PUT /admin/papi/keys/{id} · POST /admin/papi/hooks(비밀값 한 번) · /hooks/{id}/rotate
 *                          POST /admin/papi/run · PUT /admin/papi/settings
 *   운영 화면 › 파트너사 › 직원 일괄 등록(SB-ADM-OAPI-020)
 *     ADMIN · PARTNER_MAL  GET /admin/pbulk · /admin/pbulk/{id} · POST /admin/pbulk/preview · /{id}/confirm · /{id}/cancel
 *     SUPER                POST /admin/pbulk/run · PUT /admin/pbulk/settings
 *   파트너 시스템(API 키 · 회원 로그인 아님)  GET /api/partner/v1/me · /leads · /leads/{deliveryId} · /services · /cash · /docs
 *     ★ 주소가 /api/v1 아래가 아님 — 화면 목록(screens.json)에는 「/api/partner/v1/…」 그대로 적음(gen-docs · verify-docs 패치 · NOTES 2-4)
 *   키 원문 · 웹훅 비밀값이 응답에 실리는 API 는 @Audit 을 달지 않음 — 서비스가 원문 없이 감사 기록을 남김
 * ------------------------------------------------------------------- */

const PTN_STAFF = ['ADMIN', 'PARTNER_MAL'] as const;   // SUPER 는 늘 통과(2026-10-21 결정)

export class PapiKeyIssueDto {
  @ApiProperty({ description: '파트너 id(uuid)' }) @IsString() @Matches(/^[0-9a-f-]{36}$/i) partnerId!: string;
  @ApiProperty({ example: '상담 연동 서버' }) @IsString() @Length(2, 60) name!: string;
  @ApiProperty({ enum: PAPI_SCOPES, isArray: true, example: ['leads:read'] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @IsIn(PAPI_SCOPES as unknown as string[], { each: true }) scopes!: string[];
  @ApiPropertyOptional({ example: 60, description: '1분 사용 한도(1 ~ 600 · 비우면 papi.default_rate)' }) @IsOptional() @IsInt() @Min(1) @Max(600) ratePerMin?: number;
  @ApiPropertyOptional({ example: 365, description: '기한(일 · 1 ~ 730 · 비우면 365)' }) @IsOptional() @IsInt() @Min(1) @Max(730) days?: number;
}
export class PapiKeyEditDto {
  @ApiPropertyOptional({ example: '상담 연동 서버(새)' }) @IsOptional() @IsString() @Length(2, 60) name?: string;
  @ApiPropertyOptional({ enum: PAPI_SCOPES, isArray: true }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @IsIn(PAPI_SCOPES as unknown as string[], { each: true }) scopes?: string[];
  @ApiPropertyOptional({ example: 120 }) @IsOptional() @IsInt() @Min(1) @Max(600) ratePerMin?: number;
}
export class PapiReasonDto {
  @ApiProperty({ example: '파트너 연동 서버 교체' }) @IsString() @Length(2, 200) reason!: string;
}
export class PapiHookNewDto {
  @ApiProperty({ description: '파트너 id(uuid)' }) @IsString() @Matches(/^[0-9a-f-]{36}$/i) partnerId!: string;
  @ApiProperty({ example: 'https://partner.example.com/sgb/webhook', description: 'https 만 · 300자 · 내부망 · 사설 주소 안 됨' })
  @IsString() @Length(12, 300) @Matches(/^https:\/\/[A-Za-z0-9.-]+(:[0-9]{2,5})?(\/[!-~]*)?$/) url!: string;
  @ApiProperty({ enum: PAPI_EVENTS, isArray: true, example: ['lead.delivered'] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2) @IsIn(PAPI_EVENTS as unknown as string[], { each: true }) events!: string[];
}
export class PapiSettingsDto {
  @ApiPropertyOptional({ description: 'papi.enabled' }) @IsOptional() @StrictBoolean() enabled?: boolean;
  @ApiPropertyOptional({ description: 'papi.hook_enabled' }) @IsOptional() @StrictBoolean() hookEnabled?: boolean;
  @ApiPropertyOptional({ enum: ['ASSUME', 'LIVE'] }) @IsOptional() @IsIn(['ASSUME', 'LIVE']) hookMode?: string;
  @ApiPropertyOptional({ example: 60 }) @IsOptional() @IsInt() @Min(1) @Max(600) defaultRate?: number;
  @ApiPropertyOptional({ example: 90 }) @IsOptional() @IsInt() @Min(30) @Max(365) logKeepDays?: number;
  @ApiProperty({ example: '보안 검토 끝 · 첫 파트너 연동' }) @IsString() @Length(2, 200) reason!: string;
}
export class PapiReqQueryDto {
  @ApiPropertyOptional({ example: '1' }) @IsOptional() @IsString() @Matches(/^[0-9]{1,18}$/) keyId?: string;
  @ApiPropertyOptional({ enum: ['1', '0'], description: '1 = 실패(400 넘음)만' }) @IsOptional() @IsIn(['1', '0']) failed?: string;
}
export class PapiLeadsQueryDto {
  @ApiPropertyOptional({ enum: ['DELIVERED', 'VIEWED', 'EXPIRED'] }) @IsOptional() @IsIn(['DELIVERED', 'VIEWED', 'EXPIRED']) state?: string;
  @ApiPropertyOptional({ example: '2026-11-20T00:00:00Z', description: '이 시각 뒤 배정만(ISO 8601)' }) @IsOptional() @IsString() @Length(10, 40) since?: string;
  @ApiPropertyOptional({ example: 50, description: '1 ~ 100(처음 50)' }) @IsOptional() @IsInt() @Min(1) @Max(100) limit?: number;
}
export class PbulkPreviewDto {
  @ApiProperty({ description: '파트너 id(uuid)' }) @IsString() @Matches(/^[0-9a-f-]{36}$/i) partnerId!: string;
  @ApiProperty({ example: 'email,can_settle\nkim@example.com,N\nlee@example.com,Y', description: 'CSV 글(200KB · 칸은 email · can_settle 둘뿐)' }) @IsString() @Length(5, 200000) csv!: string;
  @ApiPropertyOptional({ example: 'staff_202611.csv' }) @IsOptional() @IsString() @Length(1, 120) fileName?: string;
}
export class PbulkConfirmDto {
  @ApiProperty({ example: '등록', description: '확인 글자 「등록」' }) @IsString() @Length(1, 10) confirm!: string;
}
export class PbulkReasonDto {
  @ApiProperty({ example: '파일을 잘못 올림' }) @IsString() @Length(2, 200) reason!: string;
}
export class PbulkSettingsDto {
  @ApiPropertyOptional({ description: 'pbulk.invite_mail' }) @IsOptional() @StrictBoolean() inviteMail?: boolean;
  @ApiPropertyOptional({ example: 200 }) @IsOptional() @IsInt() @Min(10) @Max(1000) maxRows?: number;
  @ApiPropertyOptional({ example: 30 }) @IsOptional() @IsInt() @Min(7) @Max(90) pendingDays?: number;
  @ApiProperty({ example: '법무 확인 끝 · 초대 메일 켬' }) @IsString() @Length(2, 200) reason!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@Roles(...PTN_STAFF)
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class PapiAdminController {
  constructor(private readonly db: DatabaseService) {}

  @Get('papi')
  @ApiOperation({ summary: '파트너 오픈 API 한눈에 (v10.521)', description: '설정(켜짐 · 웹훅 · 방식 · 한도 · 보관) · 키 200(앞머리 · 범위 · 한도 · 기한 · 24시간 호출 · 오류) · 웹훅 100(주소 · 일 · 비밀값 끝 4자 · 연속 실패 · 대기 · 포기) · 활동 중 파트너 · 24시간 호출 · 막힘 · 틀린 키.' })
  @ApiOkResponse({ type: Object })
  overview() { return papiOverview(this.db); }

  @Get('papi/requests')
  @ApiOperation({ summary: '파트너 API 요청 기록 (v10.521)', description: '최근 200줄 — 키 · 주소 · 응답 코드 · 걸린 시간 · 막힌 까닭 · IP 지문(하루마다 바뀜 · 원래 IP 없음).' })
  @ApiOkResponse({ type: Object })
  requests(@Query() q: PapiReqQueryDto) { return papiRequests(this.db, { keyId: q.keyId, failed: q.failed === '1' }); }

  @Post('papi/keys')
  @Roles('SUPER')
  @HttpCode(200)
  /* 감사 기록은 서비스가 직접(응답에 키 원문이 있어 @Audit 을 달지 않음) */
  @ApiOperation({ summary: '파트너 API 키 발급 (v10.521 · SUPER)', description: '활동 중 파트너 · 이름 · 범위(읽기 3종) · 1분 한도 · 기한 — 키 원문은 이 응답에 한 번만(DB 에는 앞머리 · sha256 지문만) · 파트너마다 살아 있는 키 5개까지.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PAPI_PARTNER_INACTIVE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PAPI_PARTNER · PAPI_NAME · PAPI_SCOPE · PAPI_RATE · PAPI_DAYS · PAPI_KEY(5개 넘음)' })
  issue(@Body() dto: PapiKeyIssueDto) { return issueKey(this.db, dto, RequestCtx.actorId() ?? null); }

  @Put('papi/keys/:id')
  @Roles('SUPER')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '파트너 API 키 고치기 (v10.521 · SUPER)', description: '이름 · 범위 · 1분 한도(살아 있는 키만 · 기한은 늘리지 않음 — 새 키를 발급).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PAPI_KEY_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PAPI_NAME · PAPI_SCOPE · PAPI_RATE · PAPI_NOTHING' })
  edit(@Param('id') id: string, @Body() dto: PapiKeyEditDto) {
    return updateKey(this.db, id, { name: dto.name, scopes: dto.scopes, ratePerMin: dto.ratePerMin });
  }

  @Post('papi/keys/:id/revoke')
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '파트너 API 키 거두기 (v10.521)', description: '사유 2 ~ 200자 · 바로 401 PAPI_KEY_REVOKED · 되살리지 않음(감사 기록은 서비스가 직접).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PAPI_KEY_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PAPI_REASON' })
  revoke(@Param('id') id: string, @Body() dto: PapiReasonDto) { return revokeKey(this.db, id, dto.reason, RequestCtx.actorId() ?? null); }

  @Post('papi/hooks')
  @Roles('SUPER')
  @HttpCode(200)
  @ApiOperation({ summary: '파트너 웹훅 만들기 (v10.521 · SUPER)', description: '파트너마다 하나 · https · 내부망 주소 안 됨 · 받을 일(lead.delivered · lead.state_changed) — 서명 비밀값은 이 응답에 한 번만(DB 는 암호문).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PAPI_HOOK_EXISTS · PAPI_PARTNER_INACTIVE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PAPI_PARTNER · PAPI_HOOK_URL · PAPI_HOOK_EVENTS' })
  hookNew(@Body() dto: PapiHookNewDto) { return createHook(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('papi/hooks/:id/rotate')
  @Roles('SUPER')
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '웹훅 서명 비밀값 바꾸기 (v10.521 · SUPER)', description: '새 비밀값은 이 응답에 한 번만 · 이 뒤 보내는 줄부터 새 값으로 서명.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PAPI_HOOK_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  hookRotate(@Param('id') id: string) { return rotateHookSecret(this.db, id); }

  @Post('papi/hooks/:id/disable')
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '웹훅 끄기 (v10.521)', description: '사유 2 ~ 200자 · 보내지 않은 줄은 취소 · 되살리지 않음(새로 만듦).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PAPI_HOOK_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PAPI_REASON' })
  hookOff(@Param('id') id: string, @Body() dto: PapiReasonDto) { return disableHook(this.db, id, dto.reason, RequestCtx.actorId() ?? null); }

  @Post('papi/hooks/:id/test')
  @HttpCode(200)
  @Audit('PAPI_HOOK_TEST', 'PARTNER')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '웹훅 시험(ping) (v10.521)', description: '시험 줄 하나 — 웹훅 보내기가 켜져 있으면 1분 안에(ASSUME 이면 간주).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PAPI_HOOK_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  hookTest(@Param('id') id: string) { return testHook(this.db, id); }

  @Get('papi/hooks/:id/events')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '웹훅 보낸 줄 (v10.521)', description: '최근 100줄 — 일 · 몸통(배정 번호 · 상태 · 시각) · 상태 · 시도 · 다음 시각 · 마지막 응답.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  hookEvents(@Param('id') id: string) { return hookEvents(this.db, id); }

  @Post('papi/events/:id/retry')
  @HttpCode(200)
  @Audit('PAPI_EVENT_RETRY', 'PARTNER')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '웹훅 줄 다시 보내기 (v10.521)', description: '실패 · 포기 줄을 처음부터 다시(살아 있는 웹훅만).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PAPI_EVENT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  retry(@Param('id') id: string) { return retryEvent(this.db, id); }

  @Post('papi/run')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('PAPI_HOOK_RUN', 'SETTING')
  @ApiOperation({ summary: '웹훅 지금 한 번 보내기 (v10.521 · SUPER)', description: '정기 작업 papi_hook_send 와 같음 — 꺼져 있으면 아무것도 안 함(on: false).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'POLICY' })
  run() { return papiHookSendJob(this.db); }

  @Put('papi/settings')
  @Roles('SUPER')
  @Audit('PAPI_SETTINGS', 'SETTING')
  @ApiOperation({ summary: '오픈 API 설정 (v10.521 · SUPER)', description: '켜기(보안 검토 뒤) · 웹훅 보내기 · 방식(ASSUME · LIVE) · 처음 1분 한도 · 요청 기록 보관 · 사유(설정 바뀜 기록).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PAPI_REASON · PAPI_MODE · PAPI_RATE · PAPI_KEEP · PAPI_NOTHING' })
  settings(@Body() dto: PapiSettingsDto) {
    return setPapiSettings(this.db, { enabled: dto.enabled, hookEnabled: dto.hookEnabled, hookMode: dto.hookMode, defaultRate: dto.defaultRate, logKeepDays: dto.logKeepDays, reason: dto.reason });
  }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@Roles(...PTN_STAFF)
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class PbulkAdminController {
  constructor(private readonly db: DatabaseService, private readonly mail: MailService) {}

  @Get('pbulk')
  @ApiOperation({ summary: '직원 일괄 등록 묶음 (v10.522)', description: '설정(초대 메일 · 줄 수 · 가입 대기 기한) · 최근 묶음 100(회사 · 결과 수 · 가입 대기 · 짝 맞춤) · 활동 중 파트너 · 받는 칸(email · can_settle).' })
  @ApiOkResponse({ type: Object })
  list() { return pbulkList(this.db); }

  @Get('pbulk/:id')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '일괄 등록 묶음 한 건 (v10.522)', description: '줄마다 가린 이메일 · 정산 권한 · 결과 · 상태 · 메일 · 기한.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  detail(@Param('id') id: string) { return pbulkDetail(this.db, id); }

  @Post('pbulk/preview')
  @HttpCode(200)
  /* 감사 기록은 서비스가 직접(묶음 · 결과 수 · 이메일 원문 없음) */
  @ApiOperation({ summary: '일괄 등록 미리보기 (v10.522)', description: 'CSV(email · can_settle) → 줄마다 결과(MEMBER · PENDING · DUPLICATE · INVALID · ALREADY · OTHER_BUSINESS · SELF) — 아직 초대 없음 · 하루 안에 확정 · 이메일은 가린 값만 돌려줌.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PBULK_PARTNER_INACTIVE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PBULK_PARTNER · PBULK_EMPTY · PBULK_TOO_BIG · PBULK_TOO_MANY · PBULK_COLUMNS' })
  preview(@Body() dto: PbulkPreviewDto) { return pbulkPreview(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('pbulk/:id/confirm')
  @HttpCode(200)
  /* 감사 기록은 서비스가 줄마다(PBULK_ROW) */
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '일괄 등록 확정 (v10.522)', description: '확인 글자 「등록」 — 가입 회원은 직원 초대(받아들이면 합류) · 미가입은 가입 대기 · 나머지 건너뜀 · 줄마다 감사 기록 · 초대 메일은 pbulk.invite_mail on 일 때만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PBULK_STATE · PBULK_PARTNER_INACTIVE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PBULK_CONFIRM' })
  confirm(@Param('id') id: string, @Body() dto: PbulkConfirmDto) { return pbulkConfirm(this.db, id, dto.confirm, RequestCtx.actorId() ?? null); }

  @Post('pbulk/:id/cancel')
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '일괄 등록 취소 (v10.522)', description: '미리보기 묶음만 · 사유 2 ~ 200자 · 원문 이메일 지움.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PBULK_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PBULK_REASON' })
  cancel(@Param('id') id: string, @Body() dto: PbulkReasonDto) { return pbulkCancel(this.db, id, dto.reason); }

  @Post('pbulk/run')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('PBULK_RUN', 'SETTING')
  @ApiOperation({ summary: '일괄 등록 짝 맞춤 지금 한 번 (v10.522 · SUPER)', description: '정기 작업 pbulk_match 와 같음 — 가입 대기 짝 맞춤 · 기한 지남 · 미리보기 취소 · 초대 메일(켜져 있을 때).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'POLICY' })
  run() { return pbulkMatchJob(this.db, this.mail); }

  @Put('pbulk/settings')
  @Roles('SUPER')
  @Audit('PBULK_SETTINGS', 'SETTING')
  @ApiOperation({ summary: '일괄 등록 설정 (v10.522 · SUPER)', description: '초대 메일(법무 확인 뒤) · 한 번에 받는 줄 수 · 가입 대기 기한 · 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PBULK_REASON · PBULK_MAX · PBULK_DAYS · PBULK_NOTHING' })
  settings(@Body() dto: PbulkSettingsDto) {
    return setPbulkSettings(this.db, { inviteMail: dto.inviteMail, maxRows: dto.maxRows, pendingDays: dto.pendingDays, reason: dto.reason });
  }
}

/* ★ 파트너 시스템이 부르는 주소 — 회원 로그인이 아니라 API 키(PartnerApiKeyGuard · check-acl 은 @UseGuards 로 봄) · 읽기만 */
@ApiTags('PAPI')
@Controller('api/partner/v1')
@UseGuards(PartnerApiKeyGuard)
@ApiHeader({ name: 'X-Partner-Key', required: true, description: '파트너 API 키 sgbp_xxxxxxxx_…(운영 화면에서 발급 · 원문은 한 번만)' })
@ApiResponse({ status: 401, description: 'PAPI_KEY_INVALID · PAPI_KEY_REVOKED · PAPI_KEY_EXPIRED', type: ErrorDto })
@ApiResponse({ status: 403, description: 'PAPI_PARTNER_INACTIVE · PAPI_SCOPE', type: ErrorDto })
@ApiResponse({ status: 429, description: 'PAPI_RATE_LIMIT(Retry-After)', type: ErrorDto })
@ApiResponse({ status: 503, description: 'PAPI_OFF(papi.enabled off)', type: ErrorDto })
export class PapiPartnerController {
  constructor(private readonly db: DatabaseService) {}

  @Get('me')
  @ApiOperation({ summary: '내 키 · 회사 (파트너 API v1)', description: '회사 · 등급 · 상태 · 키 이름 · 앞머리 · 범위 · 1분 한도 · 기한 · 웹훅(호스트 · 일).' })
  @ApiOkResponse({ type: Object })
  me(@Req() req: Request & { papi: PapiPrincipal }) { return papiMe(this.db, req.papi); }

  @Get('leads')
  @PapiScope('leads:read')
  @ApiOperation({ summary: '배정 리드 목록 (파트너 API v1 · leads:read)', description: '회수 뺌 · 상태 · since · limit(1 ~ 100) — 연락처는 싣지 않음(파트너센터에서 열람).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PAPI_QUERY' })
  leads(@Req() req: Request & { papi: PapiPrincipal }, @Query() q: PapiLeadsQueryDto) { return papiLeads(this.db, req.papi, q); }

  @Get('leads/:deliveryId')
  @PapiScope('leads:read')
  @ApiParam({ name: 'deliveryId', description: '배정 번호(uuid)' })
  @ApiOperation({ summary: '배정 리드 한 건 (파트너 API v1 · leads:read)', description: '목록 칸 + 예상 확인비용 · 이용료 상태 — 연락처 없음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  lead(@Req() req: Request & { papi: PapiPrincipal }, @Param('deliveryId') deliveryId: string) { return papiLead(this.db, req.papi, deliveryId); }

  @Get('services')
  @PapiScope('services:read')
  @ApiOperation({ summary: '내 서비스 (파트너 API v1 · services:read)', description: '서비스 200 — 이름 · 상태 · 업종 · 만든 때.' })
  @ApiOkResponse({ type: Object })
  services(@Req() req: Request & { papi: PapiPrincipal }) { return papiServices(this.db, req.papi); }

  @Get('cash')
  @PapiScope('cash:read')
  @ApiOperation({ summary: '리드 이용료 (파트너 API v1 · cash:read)', description: '리드를 받을 수 있는지 · 잔액(충전 · 결제는 파트너센터).' })
  @ApiOkResponse({ type: Object })
  cash(@Req() req: Request & { papi: PapiPrincipal }) { return papiCash(this.db, req.papi); }

  @Get('docs')
  @ApiOperation({ summary: '파트너 API 안내 (v1)', description: '주소 · 범위 · 오류 코드 · 웹훅 머리글 · 서명 확인법 · 재시도.' })
  @ApiOkResponse({ type: Object })
  docs() { return papiDocs(); }
}
