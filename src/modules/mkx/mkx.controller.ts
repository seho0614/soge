import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { IntegrationSecretService } from '../../common/integration/secret.service';
import { myPush, pushAdminView, pushMakeKeys, pushRunNow, pushSubscribe, pushTestMine, pushUnsubscribe } from './webpush';
import { rebuyAdminView, rebuyDeleteRule, rebuyRunNow, rebuySetRule } from './rebuy';
import { gbAdminList, gbCancel, gbCreate, gbJoin, gbJoinsOf, gbMine, gbOpen, gbPublicList, gbRunNow, gbUpdate } from './groupbuy';
import { applyOptout080, optout080Hook, rotateOptoutToken, smsAdminView } from './sms';

/* ---------------------------------------------------------------------
 * v10.538 ~ 541 (D283 · docs/676 ~ 679) (53) 회원 · 소개몰 — 대표 11/20
 *   MkxAdminController   api/v1/admin/mkx  (ADMIN · SUPER — 키 · 토큰은 SUPER)
 *     웹 푸시   GET /push · POST /push/keys(SUPER) · POST /push/run
 *     재구매    GET /rebuy · PUT /rebuy/rules/{code} · DELETE /rebuy/rules/{code} · POST /rebuy/run
 *     공동구매  GET /groupbuys · GET /groupbuys/{id}/joins · POST /groupbuys · PUT /groupbuys/{id} · POST /groupbuys/{id}/open · /cancel · POST /groupbuys/run
 *     문자      GET /sms · POST /sms/optout080 · POST /sms/optout080/token(SUPER)
 *   MkxMemberController  api/v1/me  (회원 본인)
 *     GET /push · POST /push/subscribe · /unsubscribe · /test · GET /health/groupbuys
 *   MkxPublicController  api/v1  (공개 구역 health · site)
 *     GET /health/groupbuys(목록 · 로그인 없이) · POST /health/groupbuys/{id}/join(회원) · POST /site/optout080(080 대행사 웹훅 · 토큰)
 *   ★ 세무사(ACCOUNTANT)는 /admin/acct/ 접두가 아니라 보지 않음(규칙 8) · 회원 이름은 가린 값 · 번호는 끝 4자리
 * ------------------------------------------------------------------- */

const PCODE = /^[A-Za-z0-9_-]{1,40}$/;   // common.ts PRODUCT_CODE_RE 와 같음

export class MkxPushKeysDto {
  @ApiPropertyOptional({ description: 'true 면 이미 있는 키를 바꿈(모든 구독 GONE · 회원이 다시 켜야 함)' }) @IsOptional() @IsBoolean() force?: boolean;
}
export class MkxPushSubscribeDto {
  @ApiProperty({ description: '브라우저 PushSubscription.endpoint(알려진 푸시 서비스 https 주소 · 1,000자 안)' }) @IsString() @MaxLength(1000) endpoint!: string;
  @ApiProperty({ description: 'keys.p256dh(base64url 80 ~ 100자)' }) @IsString() @Matches(/^[A-Za-z0-9_-]{80,100}$/) p256dh!: string;
  @ApiProperty({ description: 'keys.auth(base64url 16 ~ 32자)' }) @IsString() @Matches(/^[A-Za-z0-9_-]{16,32}$/) auth!: string;
  @ApiPropertyOptional({ description: '브라우저 이름(보이기만 · 40자)' }) @IsOptional() @IsString() @MaxLength(80) ua?: string;
}
export class MkxPushUnsubscribeDto {
  @ApiProperty() @IsString() @MaxLength(1000) endpoint!: string;
}
export class MkxRebuyRuleDto {
  @ApiProperty({ example: 30, description: '사용 일수 7 ~ 730(개월 옵션이 있으면 개월 × 30일이 먼저)' }) @IsInt() @Min(7) @Max(730) useDays!: number;
  @ApiPropertyOptional({ example: 7, description: '며칠 전에 알릴지 0 ~ 60(사용 일수보다 작게)' }) @IsOptional() @IsInt() @Min(0) @Max(60) beforeDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional({ description: '메모 200자' }) @IsOptional() @IsString() @MaxLength(200) memo?: string;
}
export class MkxGbNewDto {
  @ApiProperty({ example: 'HV-001' }) @IsString() @Matches(PCODE) productCode!: string;
  @ApiPropertyOptional({ format: 'uuid', description: '옵션(켠 옵션이 하나면 비워도 됨)' }) @IsOptional() @IsUUID() optionId?: string;
  @ApiProperty({ example: '11월 비타민 공동구매' }) @IsString() @Length(2, 80) title!: string;
  @ApiProperty({ example: 19000, description: '할인가(원 · 지금 옵션 값보다 낮게)' }) @IsInt() @Min(1) dealPrice!: number;
  @ApiProperty({ example: 20, description: '목표 인원(결제를 마친 사람 수) 2 ~ 10,000' }) @IsInt() @Min(2) @Max(10000) targetCount!: number;
  @ApiPropertyOptional({ example: 100, description: '최대 인원(목표 이상 · 비우면 없음)' }) @IsOptional() @IsInt() @Min(2) @Max(100000) maxCount?: number;
  @ApiPropertyOptional({ example: 2, description: '한 분 수량 상한 1 ~ 10(처음 1)' }) @IsOptional() @IsInt() @Min(1) @Max(10) perMemberMax?: number;
  @ApiProperty({ example: '2026-11-30T15:00:00Z', description: '기한(지금부터 1시간 ~ 60일)' }) @IsISO8601() endsAt!: string;
}
export class MkxGbEditDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) title?: string;
  @ApiPropertyOptional({ description: '초안일 때만' }) @IsOptional() @IsInt() @Min(1) dealPrice?: number;
  @ApiPropertyOptional({ description: '초안일 때만' }) @IsOptional() @IsInt() @Min(2) @Max(10000) targetCount?: number;
  @ApiPropertyOptional({ description: '초안일 때만' }) @IsOptional() @IsInt() @Min(2) @Max(100000) maxCount?: number;
  @ApiPropertyOptional({ description: '초안일 때만' }) @IsOptional() @IsInt() @Min(1) @Max(10) perMemberMax?: number;
  @ApiPropertyOptional({ description: '기한(모집 중에는 늘리기만)' }) @IsOptional() @IsISO8601() endsAt?: string;
}
export class MkxReasonDto {
  @ApiProperty({ example: '재고 부족', description: '사유 2 ~ 200자(감사 기록)' }) @IsString() @Length(2, 200) reason!: string;
}
export class MkxGbJoinDto {
  @ApiPropertyOptional({ example: 1, description: '수량(한 분 상한 안 · 처음 1)' }) @IsOptional() @IsInt() @Min(1) @Max(10) qty?: number;
  @ApiPropertyOptional({ format: 'uuid', description: '배송지(비우면 기본 배송지)' }) @IsOptional() @IsUUID() addressId?: string;
}
export class MkxOptoutPasteDto {
  @ApiProperty({ description: '080 대행사가 준 거부 번호(줄 · 쉼표로 나눔 · 1,000개까지)' }) @IsString() @Length(10, 20000) phones!: string;
}
export class MkxOptoutHookDto {
  @ApiProperty({ type: [String], description: '거부 번호 1 ~ 1,000개' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @IsString({ each: true }) phones!: string[];
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/mkx')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class MkxAdminController {
  constructor(private readonly db: DatabaseService, private readonly secrets: IntegrationSecretService) {}

  /* ── ① 웹 푸시 (v10.538) ── */
  @Get('push')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '웹 푸시 현황 (v10.538)', description: '스위치(push.enabled · push.send · 처음 off) · 방식(ASSUME) · 키 준비 · 구독 수 · 7일 보낸 결과 · 최근 50(가린 이름).' })
  @ApiOkResponse({ type: Object })
  push() { return pushAdminView(this.db); }

  @Post('push/keys')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('MKX_PUSH_KEYS', 'INTEGRATION')
  @ApiOperation({ summary: '웹 푸시 VAPID 키 만들기 (v10.538 · SUPER)', description: '외부 연동 WEBPUSH 키 두 개를 만들어 연동 키에 저장. 이미 있으면 force 일 때만 바꿈(모든 구독 GONE).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'MKX_PUSH_KEY_EXISTS' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'INTEG_SECRET_FORMAT' })
  pushKeys(@Body() dto: MkxPushKeysDto) { return pushMakeKeys(this.db, (c, n, v) => this.secrets.set(c, n, v), dto.force === true); }

  @Post('push/run')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @ApiOperation({ summary: '웹 푸시 지금 한 번 보내기 (v10.538)', description: '정기 작업 mkx_push_send 와 같은 일 — push.send on 일 때만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKX_PUSH_SEND_OFF' })
  pushRun() { return pushRunNow(this.db); }

  /* ── ② 재구매 알림 (v10.539) ── */
  @Get('rebuy')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '재구매 알림 현황 (v10.539)', description: '스위치(mkx.rebuy · 처음 off) · 상품 규칙 · 14일 안 알릴 줄 · 30일 보냄 · 건너뜀 까닭 · 최근 100.' })
  @ApiOkResponse({ type: Object })
  rebuy() { return rebuyAdminView(this.db); }

  @Put('rebuy/rules/:code')
  @Roles('ADMIN', 'SUPER')
  @Audit('MKX_REBUY_RULE', 'HLT_PRODUCT')
  @ApiParam({ name: 'code', description: '소개몰 상품 코드' })
  @ApiOperation({ summary: '재구매 알림 규칙 저장 (v10.539)', description: '상품마다 사용 일수 · 며칠 전 · 켜기.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKX_REBUY_DAYS · MKX_REBUY_BEFORE' })
  rebuyRule(@Param('code') code: string, @Body() dto: MkxRebuyRuleDto) { return rebuySetRule(this.db, code, dto, RequestCtx.actorId() ?? null); }

  @Delete('rebuy/rules/:code')
  @Roles('ADMIN', 'SUPER')
  @ApiParam({ name: 'code', description: '소개몰 상품 코드' })
  @ApiOperation({ summary: '재구매 알림 규칙 지우기 (v10.539)', description: '보낸 기록은 남음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION_ERROR' })
  rebuyRuleDel(@Param('code') code: string) { return rebuyDeleteRule(this.db, code); }

  @Post('rebuy/run')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @ApiOperation({ summary: '재구매 알림 지금 한 번 (v10.539)', description: 'mkx.rebuy on · 21 ~ 8시 아님일 때만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKX_REBUY_OFF · MKX_REBUY_NIGHT' })
  rebuyRun() { return rebuyRunNow(this.db); }

  /* ── ③ 공동구매 (v10.540) ── */
  @Get('groupbuys')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'state', required: false, enum: ['DRAFT', 'OPEN', 'SUCCESS', 'FAILED', 'CANCELED', 'CLOSED'] })
  @ApiOperation({ summary: '공동구매 목록 (v10.540)', description: '스위치(mkx.groupbuy · 처음 off) · 주문 받기 · 공동구매(결제 참여 · 자리 · 취소 신청) · 고를 수 있는 직판 상품 옵션.' })
  @ApiOkResponse({ type: Object })
  groupbuys(@Query('state') state?: string) { return gbAdminList(this.db, state); }

  @Get('groupbuys/:id/joins')
  @Roles('ADMIN', 'SUPER')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: '공동구매 참여자 (v10.540)', description: '가린 이름 · 주문 번호 · 결제 · 취소 신청 상태.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  joinsGb(@Param('id') id: string) { return gbJoinsOf(this.db, id); }

  @Post('groupbuys/run')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @ApiOperation({ summary: '공동구매 지금 한 번 처리 (v10.540)', description: '정기 작업 mkx_groupbuy 와 같은 일 — 확정 · 실패(취소 신청) · 마감.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION_ERROR' })
  runGb() { return gbRunNow(this.db); }

  @Post('groupbuys')
  @Roles('ADMIN', 'SUPER')
  @Audit('MKX_GB_CREATE', 'HLT_PRODUCT')
  @ApiOperation({ summary: '공동구매 초안 만들기 (v10.540)', description: '직판 상품 옵션 하나 · 할인가 · 목표 · 최대 인원 · 한 분 수량 · 기한.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKX_GB_PRODUCT · MKX_GB_OPTION · MKX_GB_PRICE · MKX_GB_TARGET · MKX_GB_MAX · MKX_GB_QTY · MKX_GB_ENDS · MKX_GB_TITLE' })
  newGb(@Body() dto: MkxGbNewDto) { return gbCreate(this.db, dto, RequestCtx.actorId() ?? null); }

  @Put('groupbuys/:id')
  @Roles('ADMIN', 'SUPER')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: '공동구매 고치기 (v10.540)', description: '초안은 모두 · 모집 중은 이름 · 기한 늘리기만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'MKX_GB_STATE · MKX_GB_FIXED · MKX_GB_ENDS' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKX_GB_PRICE · MKX_GB_TARGET · MKX_GB_MAX · MKX_GB_QTY · MKX_GB_ENDS · MKX_GB_TITLE' })
  editGb(@Param('id') id: string, @Body() dto: MkxGbEditDto) { return gbUpdate(this.db, id, dto); }

  @Post('groupbuys/:id/open')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @Audit('MKX_GB_OPEN', 'HLT_PRODUCT')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: '공동구매 열기 (v10.540)', description: 'mkx.groupbuy on · 직판 · 판매 중 · 할인가 < 옵션 값 · 같은 옵션 모집 중 없음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'MKX_GB_STATE · MKX_GB_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKX_GB_OFF · MKX_GB_PRODUCT · MKX_GB_PRICE · MKX_GB_ENDS' })
  openGb(@Param('id') id: string) { return gbOpen(this.db, id); }

  @Post('groupbuys/:id/cancel')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @Audit('MKX_GB_CANCEL', 'HLT_PRODUCT')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: '공동구매 취소 (v10.540)', description: '사유 · 연 것이면 참여 주문마다 기존 취소 신청(환불은 소개몰 › 주문 · 취소 처리).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'MKX_GB_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKX_GB_REASON' })
  cancelGb(@Param('id') id: string, @Body() dto: MkxReasonDto) { return gbCancel(this.db, id, dto.reason); }

  /* ── ④ 문자 마케팅 (v10.541) ── */
  @Get('sms')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '문자 마케팅 현황 (v10.541)', description: '소개몰 대상 수(동의 · 휴대폰 · 야간 동의) · 회원별 7일 상한 · 문자 캠페인 바이트 · 예상 비용 · 080 수신 거부 반영 기록.' })
  @ApiOkResponse({ type: Object })
  sms() { return smsAdminView(this.db); }

  @Post('sms/optout080')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @Audit('MKX_OPTOUT080', 'CONSENT')
  @ApiOperation({ summary: '080 수신 거부 번호 반영 (v10.541)', description: '080 대행사가 준 번호를 붙여 넣으면 그 번호 회원의 마케팅 · 야간 광고 동의 철회 · 대기 문자 멈춤 · 처리 결과 알림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKX_OPTOUT_EMPTY' })
  optoutPaste(@Body() dto: MkxOptoutPasteDto) { return applyOptout080(this.db, dto.phones, 'PASTE', RequestCtx.actorId() ?? null); }

  @Post('sms/optout080/token')
  @Roles('SUPER')
  @HttpCode(200)
  @ApiOperation({ summary: '080 웹훅 토큰 새로 만들기 (v10.541 · SUPER)', description: '원문은 응답에 한 번만 · DB 에는 지문만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKX_REASON' })
  optoutToken(@Body() dto: MkxReasonDto) { return rotateOptoutToken(this.db, dto.reason); }
}

@ApiTags('ME')
@ApiBearerAuth()
@Controller('api/v1/me')
@ApiResponse({ status: 403, description: '로그인 필요', type: ErrorDto })
export class MkxMemberController {
  constructor(private readonly db: DatabaseService) {}

  @Get('push')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '내 웹 푸시 (v10.538)', description: '켤 수 있는지(push.enabled) · 앱처럼 설치(site.pwa) · 공개 키 · 켠 기기.' })
  @ApiOkResponse({ type: Object })
  mine() { return myPush(this.db, RequestCtx.actorId()!); }

  @Post('push/subscribe')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
  @HttpCode(200)
  @ApiOperation({ summary: '이 브라우저 웹 푸시 켜기 (v10.538)', description: '알려진 푸시 서비스 주소만 · 기기 10개까지 · 같은 브라우저를 다른 회원이 켜면 앞 회원 줄을 지움.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKX_PUSH_OFF · MKX_PUSH_NO_KEY · MKX_PUSH_ENDPOINT · MKX_PUSH_KEYS · MKX_PUSH_MAX' })
  subscribe(@Body() dto: MkxPushSubscribeDto) { return pushSubscribe(this.db, RequestCtx.actorId()!, dto); }

  @Post('push/unsubscribe')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
  @HttpCode(200)
  @ApiOperation({ summary: '이 브라우저 웹 푸시 끄기 (v10.538)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION_ERROR' })
  unsubscribe(@Body() dto: MkxPushUnsubscribeDto) { return pushUnsubscribe(this.db, RequestCtx.actorId()!, dto.endpoint); }

  @Post('push/test')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
  @HttpCode(200)
  @ApiOperation({ summary: '내 기기로 시험 알림 (v10.538)', description: '켠 기기 모두 · 하루 5번 · 지금 방식(ASSUME 이면 기록만).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'MKX_PUSH_NONE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKX_PUSH_OFF · MKX_PUSH_TEST_LIMIT' })
  test() { return pushTestMine(this.db, RequestCtx.actorId()!); }

  @Get('health/groupbuys')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '내 공동구매 참여 (v10.540)' })
  @ApiOkResponse({ type: Object })
  myGroupbuys() { return gbMine(this.db, RequestCtx.actorId()!); }
}

@ApiTags('HEALTH')
@Controller('api/v1')
export class MkxPublicController {
  constructor(private readonly db: DatabaseService) {}

  @Get('health/groupbuys')
  @ApiOperation({ summary: '모집 중인 공동구매 (공개 · v10.540)', description: 'mkx.groupbuy off 면 빈 목록 · 정가 · 할인가 · 목표 · 결제 참여 수 · 기한.' })
  @ApiOkResponse({ type: Object })
  list() { return gbPublicList(this.db); }

  @Post('health/groupbuys/:id/join')
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
  @HttpCode(200)
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: '공동구매 참여 (v10.540)', description: '할인가 주문 하나를 만듦(주문 받기 · mkx.groupbuy on) — 결제는 내 주문에서. 회원 하나에 한 번.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'MKX_GB_CLOSED · MKX_GB_JOINED · MKX_GB_STOCK · NOT_ON_SALE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKX_GB_OFF · ORDERS_CLOSED · MKX_GB_QTY · BAD_ADDRESS · MKX_GB_FULL' })
  join(@Param('id') id: string, @Body() dto: MkxGbJoinDto) { return gbJoin(this.db, RequestCtx.actorId()!, id, dto); }

  @Post('site/optout080')
  @HttpCode(200)
  @ApiHeader({ name: 'X-Optout-Token', required: true, description: '운영 화면에서 만든 080 웹훅 토큰' })
  @ApiOperation({ summary: '080 수신 거부 웹훅 (v10.541 · 080 대행사)', description: 'mkx.optout080_hook on · 토큰(지문 대조)일 때만. 응답은 수만(개인정보 없음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'MKX_OPTOUT_HOOK_OFF · MKX_OPTOUT_TOKEN' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKX_OPTOUT_EMPTY' })
  optout(@Headers('x-optout-token') token: string | undefined, @Body() dto: MkxOptoutHookDto) { return optout080Hook(this.db, token, dto.phones); }
}
