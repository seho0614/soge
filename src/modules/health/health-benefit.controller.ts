import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles, RequireGate } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { GIFT_KINDS, createTier, giftCheck, giftClose, giftDetail, giftIssue, giftLookup, giftView, mallTierJob, myBenefits, pointAdjust, pointsView, setMemberTier, tiersView, updateTier } from './health-benefit';
import { SUB_CYCLES, createSub, mallSubscribeJob, mySubs, subAction, subsView } from './health-subscribe';

/* ---------------------------------------------------------------------
 * v10.479 ~ 482 (D267 · docs/617 ~ 620) 소개몰 회원 혜택 — 적립금 · 회원 등급 · 정기 배송 · 상품권
 *   운영(HealthBenefitController · api/v1/admin/health · 클래스 @Roles ADMIN · SUPER — 소개몰 운영과 같게)
 *     적립금  GET /points · POST /points/adjust
 *     등급    GET /tiers · POST /tiers · PUT /tiers/{code} · PUT /tiers/member/{accountId} · POST /tiers/run
 *     정기 배송 GET /subscriptions · POST /subscriptions/{id}/state · POST /subscriptions/run
 *     상품권  GET /giftcards · POST /giftcards · GET /giftcards/{id} · POST /giftcards/{id}/close · POST /giftcards/lookup
 *   회원(HealthBenefitMeController · api/v1/me/health · 메서드마다 @Roles — 본인 것만)
 *     GET /benefits · POST /giftcards/check · GET /subscriptions · POST /subscriptions · POST /subscriptions/{id}/action
 *   주문서(POST /health/orders): usePoints · giftCode(선택) — health-shop.dto · health-checkout.service 패치(㉝ 쿠폰 다음)
 *   ★ 회원 화면(site/)은 이번 판에 없음 — 「주문 받기」를 켤 때(서버는 준비 · 운영 화면에서 확인)
 * ------------------------------------------------------------------- */

const GIFT_IN = /^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/;   // 대문자로 바꾼 뒤 health-benefit GIFT_CODE 로 다시 봄
const MEMBER_ROLES = ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER'] as const;

export class HltPointAdjustDto {
  @ApiProperty({ format: 'uuid', description: '회원' }) @IsUUID() accountId!: string;
  @ApiProperty({ enum: ['ADD', 'SUB'], description: '지급 · 회수' }) @IsIn(['ADD', 'SUB']) direction!: string;
  @ApiProperty({ example: 3000, description: '1원 ~ 100만 원' }) @IsInt() @Min(1) @Max(1_000_000) amount!: number;
  @ApiProperty({ example: '배송 지연 보상' }) @IsString() @Length(2, 200) reason!: string;
}
export class HltTierNewDto {
  @ApiProperty({ example: 'VIP', description: '영문 대문자로 시작 · 대문자 · 숫자 · 밑줄 2 ~ 20자(바꾸지 못함)' }) @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,19}$/) code!: string;
  @ApiProperty({ example: 'VIP' }) @IsString() @Length(1, 30) name!: string;
  @ApiProperty({ example: 3000000, description: '기간 구매액(원) 기준' }) @IsInt() @Min(0) @Max(1_000_000_000) minAmount!: number;
  @ApiProperty({ example: 5, description: '적립률 0 ~ 20(소수 한 자리)' }) @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(20) earnRate!: number;
  @ApiPropertyOptional({ example: '구매확정 적립 5%' }) @IsOptional() @IsString() @Length(0, 200) benefit?: string;
  @ApiPropertyOptional({ example: 40 }) @IsOptional() @IsInt() @Min(0) @Max(9999) sort?: number;
}
export class HltTierEditDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) minAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(20) earnRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) benefit?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(9999) sort?: number;
  @ApiPropertyOptional({ description: '끄기는 그 등급 회원이 없을 때만' }) @IsOptional() @IsBoolean() active?: boolean;
}
export class HltTierMemberDto {
  @ApiPropertyOptional({ example: 'GOLD', description: '빈 글자 = 운영이 정한 등급 풀기' }) @IsOptional() @IsString() @Matches(/^([A-Z][A-Z0-9_]{1,19})?$/) tierCode?: string;
  @ApiProperty({ example: '우수 고객 감사' }) @IsString() @Length(2, 200) reason!: string;
}
export class HltSubStateDto {
  @ApiProperty({ enum: ['ACTIVE', 'PAUSED', 'CANCELED'] }) @IsIn(['ACTIVE', 'PAUSED', 'CANCELED']) state!: string;
  @ApiProperty({ example: '회원 요청(전화)' }) @IsString() @Length(2, 200) reason!: string;
}
export class HltGiftIssueDto {
  @ApiProperty({ enum: [...GIFT_KINDS], description: '판매(대금 받음 · 선수금) · 판촉(무상)' }) @IsIn(GIFT_KINDS as unknown as string[]) kind!: string;
  @ApiProperty({ example: 50000, description: '액면 1천 ~ 100만 원' }) @IsInt() @Min(1000) @Max(1_000_000) amount!: number;
  @ApiProperty({ example: 10, description: '1 ~ 100장' }) @IsInt() @Min(1) @Max(100) count!: number;
  @ApiPropertyOptional({ example: 1825, description: '유효 기간(일 · 365 ~ 3650 · 비우면 설정 mall.giftcard_valid_days)' }) @IsOptional() @IsInt() @Min(365) @Max(3650) validDays?: number;
  @ApiPropertyOptional({ example: '주식회사 ○○' }) @IsOptional() @IsString() @Length(0, 40) buyerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class HltGiftCloseDto {
  @ApiProperty({ enum: ['VOID', 'REFUND'], description: '무효(안 쓴 것만) · 잔액 환불 기록(판매 상품권)' }) @IsIn(['VOID', 'REFUND']) action!: string;
  @ApiProperty({ example: '구매자 요청 · 계좌로 돌려드림' }) @IsString() @Length(2, 200) reason!: string;
}
export class HltGiftCodeDto {
  @ApiProperty({ example: 'ABCD-EFGH-JKLM-NPQR', description: '4자씩 네 묶음(붙임표 있어도 · 없어도)' }) @IsString() @Matches(GIFT_IN) code!: string;
}
export class HltSubNewDto {
  @ApiProperty({ example: 'OMEGA3-60' }) @IsString() @Length(1, 40) productCode!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() optionId?: string;
  @ApiProperty({ example: 1, description: '1 ~ 10' }) @IsInt() @Min(1) @Max(10) qty!: number;
  @ApiProperty({ format: 'uuid', description: '본인 배송지' }) @IsUUID() addressId!: string;
  @ApiProperty({ enum: [...SUB_CYCLES], description: '주기(일)' }) @IsIn(SUB_CYCLES as unknown as number[]) cycleDays!: number;
  @ApiPropertyOptional({ example: '2026-12-01', description: '첫 결제일(내일 ~ 60일 뒤 · 비우면 내일)' }) @IsOptional() @IsString() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) firstOn?: string;
}
export class HltSubActionDto {
  @ApiProperty({ enum: ['SKIP', 'PAUSE', 'RESUME', 'CANCEL'], description: '건너뛰기(다시 누르면 풀기) · 멈춤 · 다시 · 해지' }) @IsIn(['SKIP', 'PAUSE', 'RESUME', 'CANCEL']) action!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) reason?: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/health')
@Roles('ADMIN', 'SUPER')   // 통합 검정(check:acl)은 @Controller 아래의 클래스 @Roles 를 읽습니다(G-208)
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class HealthBenefitController {
  constructor(private readonly db: DatabaseService) {}

  /* ── 적립금 (v10.479) ── */
  @Get('points')
  @ApiQuery({ name: 'email', required: false, description: '회원 이메일 — 주면 그 회원의 묶음 · 기록' })
  @ApiOperation({ summary: '소개몰 적립금 (v10.479)', description: '스위치 · 적립률 · 유효 기간 · 남은 합(충당부채) · 30일 안 소멸 · 최근 30일 적립 · 사용 · 소멸 · 기록 50 · 회원 찾기.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  points(@Query('email') email?: string) { return pointsView(this.db, email); }

  @Post('points/adjust')
  @HttpCode(200)
  @Audit('HLT_POINT_ADJUST', 'ACCOUNT')
  @ApiOperation({ summary: '적립금 운영 지급 · 회수 (v10.479)', description: '지급은 새 묶음(유효 기간 설정대로) · 회수는 소멸이 가까운 묶음부터 · 모자라면 422 · 사유 · 감사 기록.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_POINT_SHORT · HLT_POINT_AMOUNT · HLT_POINT_REASON · HLT_POINT_DIR' })
  adjust(@Body() dto: HltPointAdjustDto) { return pointAdjust(this.db, dto, RequestCtx.actorId() ?? null); }

  /* ── 회원 등급 (v10.480) ── */
  @Get('tiers')
  @ApiOperation({ summary: '소개몰 회원 등급 (v10.480)', description: '등급(회원 수) · 운영이 정한 회원 · 최근 바뀐 기록 · 스위치 · 기간.' })
  @ApiOkResponse({ type: Object })
  tiers() { return tiersView(this.db); }

  @Post('tiers')
  @HttpCode(200)
  @Audit('HLT_TIER_ADD', 'SETTING')
  @ApiOperation({ summary: '회원 등급 만들기 (v10.480)', description: '코드(바꾸지 못함) · 이름 · 기준 구매액 · 적립률 · 혜택 글 · 순서.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HLT_TIER_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_TIER_CODE · HLT_TIER_NAME · HLT_TIER_MIN · HLT_TIER_RATE · HLT_TIER_SORT' })
  createTier(@Body() dto: HltTierNewDto) { return createTier(this.db, dto, RequestCtx.actorId() ?? null); }

  @Put('tiers/member/:accountId')
  @Audit('HLT_TIER_MEMBER', 'ACCOUNT')
  @ApiParam({ name: 'accountId', format: 'uuid' })
  @ApiOperation({ summary: '회원 등급 운영이 정하기 · 풀기 (v10.480)', description: '정하면 다시 셈에서 건너뜀 · 빈 코드 = 풀기 · 사유 · 바뀐 기록.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_TIER_CODE · HLT_TIER_REASON' })
  setMember(@Param('accountId') accountId: string, @Body() dto: HltTierMemberDto) { return setMemberTier(this.db, accountId, dto, RequestCtx.actorId() ?? null); }

  @Put('tiers/:code')
  @Audit('HLT_TIER_EDIT', 'SETTING')
  @ApiParam({ name: 'code', example: 'GOLD' })
  @ApiOperation({ summary: '회원 등급 고치기 · 끄기 (v10.480)', description: '보낸 칸만 · 코드는 그대로 · 끄기는 그 등급 회원이 없을 때만(409).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HLT_TIER_IN_USE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_TIER_NAME · HLT_TIER_MIN · HLT_TIER_RATE · HLT_TIER_SORT' })
  editTier(@Param('code') code: string, @Body() dto: HltTierEditDto) { return updateTier(this.db, code, dto, RequestCtx.actorId() ?? null); }

  @Post('tiers/run')
  @HttpCode(200)
  @Audit('HLT_TIER_RUN', 'SETTING')
  @ApiOperation({ summary: '회원 등급 지금 다시 셈 (v10.480)', description: '정기 작업 mall_tier_recalc 와 같음 · 스위치가 꺼져 있어도 셈(알림은 켜져 있을 때만).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'POLICY' })
  runTiers() { return mallTierJob(this.db, { force: true }); }

  /* ── 정기 배송 (v10.481) ── */
  @Get('subscriptions')
  @ApiQuery({ name: 'state', required: false, enum: ['ACTIVE', 'PAUSED', 'CANCELED'] })
  @ApiOperation({ summary: '소개몰 정기 배송 (v10.481)', description: '스위치 · 결제 방식(간주 · 실제) · 상태별 수 · 오늘 결제일 · 목록 200 · 최근 회차 50.' })
  @ApiOkResponse({ type: Object })
  subs(@Query('state') state?: string) { return subsView(this.db, state); }

  @Post('subscriptions/run')
  @HttpCode(200)
  @Audit('HLT_SUB_RUN', 'SETTING')
  @ApiOperation({ summary: '정기 배송 지금 돌리기 (v10.481)', description: '정기 작업 mall_subscribe 와 같음 — 정기 배송 · 주문 받기가 켜져 있을 때만 · 날짜마다 한 번.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'POLICY' })
  runSubs() { return mallSubscribeJob(this.db); }

  @Post('subscriptions/:id/state')
  @HttpCode(200)
  @Audit('HLT_SUB_STATE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '정기 배송 멈춤 · 다시 · 해지 (v10.481)', description: '운영 · 사유 필수 · 해지는 끝.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HLT_SUB_CANCELED · HLT_SUB_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_SUB_REASON' })
  subState(@Param('id') id: string, @Body() dto: HltSubStateDto) {
    const action = dto.state === 'PAUSED' ? 'PAUSE' : dto.state === 'ACTIVE' ? 'RESUME' : 'CANCEL';
    return subAction(this.db, null, id, { action, reason: dto.reason }, true);
  }

  /* ── 상품권 (v10.482) ── */
  @Get('giftcards')
  @ApiQuery({ name: 'state', required: false, enum: ['ACTIVE', 'EXPIRED', 'VOID', 'REFUNDED'] })
  @ApiOperation({ summary: '소개몰 상품권 (v10.482)', description: '스위치 · 남은 잔액 합(선수금) · 발행 · 사용 합 · 상품권 200(끝 4자리 · 코드 원문 없음).' })
  @ApiOkResponse({ type: Object })
  gifts(@Query('state') state?: string) { return giftView(this.db, state); }

  @Post('giftcards')
  @HttpCode(200)
  @Audit('HLT_GIFT_ISSUE', 'SETTING')
  @ApiOperation({ summary: '상품권 발행 (v10.482)', description: '판매 · 판촉 · 액면 · 1 ~ 100장 · 유효 기간 — 응답에 코드(이번 한 번만 · DB 에는 지문).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_GIFT_KIND · HLT_GIFT_AMOUNT · HLT_GIFT_COUNT · HLT_GIFT_DAYS' })
  issue(@Body() dto: HltGiftIssueDto) { return giftIssue(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('giftcards/lookup')
  @HttpCode(200)
  @Audit('HLT_GIFT_LOOKUP', 'SETTING')
  @ApiOperation({ summary: '상품권 코드로 찾기 (v10.482)', description: '운영 · 받기 스위치가 꺼져도 · 잔액 · 상태 · 유효 기간.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_GIFT_CODE' })
  lookup(@Body() dto: HltGiftCodeDto) { return giftLookup(this.db, dto.code); }

  @Get('giftcards/:id')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '상품권 자세히 (v10.482)', description: '상품권 · 기록(발행 · 사용 · 되돌림 · 소멸 · 무효 · 환불).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  gift(@Param('id') id: string) { return giftDetail(this.db, id); }

  @Post('giftcards/:id/close')
  @HttpCode(200)
  @Audit('HLT_GIFT_CLOSE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '상품권 무효 · 잔액 환불 기록 (v10.482)', description: '무효는 한 번도 안 쓴 것만(409) · 잔액 환불은 판매 상품권만(돈은 따로 보냄) · 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HLT_GIFT_STATE · HLT_GIFT_USED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_GIFT_ACTION · HLT_GIFT_REASON · HLT_GIFT_PROMO_REFUND · HLT_GIFT_EMPTY' })
  close(@Param('id') id: string, @Body() dto: HltGiftCloseDto) { return giftClose(this.db, id, dto, RequestCtx.actorId() ?? null); }
}

@ApiTags('HEALTH-SHOP')
@ApiBearerAuth()
@Controller('api/v1/me/health')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class HealthBenefitMeController {
  constructor(private readonly db: DatabaseService) {}

  @Get('benefits')
  /* ★ 본인 것만 — 로그인 여부를 봅니다 */
  @Roles(...MEMBER_ROLES)
  @ApiOperation({ summary: '내 소개몰 혜택 (v10.479)', description: '적립금 남은 합 · 30일 안 소멸 · 회원 등급 · 최근 기록 · 스위치(적립금 · 등급 · 정기 배송 · 상품권).' })
  @ApiOkResponse({ type: Object })
  mine() { return myBenefits(this.db, RequestCtx.actorId()!); }

  @Post('giftcards/check')
  @HttpCode(200)
  @Roles(...MEMBER_ROLES)
  @ApiOperation({ summary: '상품권 잔액 보기 (v10.482)', description: '상품권 받기(mall.giftcard)가 켜져 있을 때 · 끝 4자리 · 잔액 · 유효 기간.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_GIFT_OFF · HLT_GIFT_CODE' })
  giftCheck(@Body() dto: HltGiftCodeDto) { return giftCheck(this.db, dto.code); }

  @Get('subscriptions')
  @Roles(...MEMBER_ROLES)
  @ApiOperation({ summary: '내 정기 배송 (v10.481)', description: '정기 배송 · 최근 회차 5 · 카드 등록 여부 · 주기.' })
  @ApiOkResponse({ type: Object })
  subs() { return mySubs(this.db, RequestCtx.actorId()!); }

  @Post('subscriptions')
  @HttpCode(200)
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @RequireGate('IDENTITY_VERIFIED')
  @Audit('HLT_SUB_ADD', 'HLT_ORDER')
  @ApiOperation({ summary: '정기 배송 신청 (v10.481)', description: '정기 배송(mall.subscribe)이 켜져 있을 때 · 직판 상품 옵션 · 수량 1 ~ 10 · 본인 배송지 · 주기 · 첫 결제일.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HLT_SUB_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_SUB_OFF · HLT_SUB_QTY · HLT_SUB_CYCLE · HLT_SUB_FIRST · HLT_SUB_ADDRESS · HLT_SUB_DIRECT_ONLY · HLT_SUB_NO_CARD · NOT_ON_SALE · OPTION_REQUIRED' })
  createSub(@Body() dto: HltSubNewDto) { return createSub(this.db, RequestCtx.actorId()!, dto); }

  @Post('subscriptions/:id/action')
  @HttpCode(200)
  @Roles(...MEMBER_ROLES)
  @Audit('HLT_SUB_ACTION', 'HLT_ORDER')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '내 정기 배송 건너뛰기 · 멈춤 · 다시 · 해지 (v10.481)', description: '건너뛰기는 다음 한 번(다시 누르면 풀기) · 해지는 끝.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HLT_SUB_CANCELED · HLT_SUB_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_SUB_ACTION' })
  subAct(@Param('id') id: string, @Body() dto: HltSubActionDto) { return subAction(this.db, RequestCtx.actorId()!, id, dto); }
}
