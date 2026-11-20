import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { COUPON_KINDS, couponsView, couponUses, createCoupon, createPromotion, promotionDetail, quoteForAdmin, updateCoupon, updatePromotion } from './health-coupon';

/* ---------------------------------------------------------------------
 * v10.469 (D264 · docs/607) 소개몰 할인 쿠폰 · 기획전 — 운영 화면 › 소개몰 › 쿠폰 · 기획전
 *   GET /admin/health/coupons · POST /admin/health/coupons · PUT /admin/health/coupons/{id} · GET /admin/health/coupons/{id}/uses
 *   POST /admin/health/coupons/quote(할인 미리 셈 · 쓰지 않음)
 *   POST /admin/health/promotions · GET /admin/health/promotions/{id} · PUT /admin/health/promotions/{id}
 *   역할: 소개몰 운영과 같게 ADMIN · SUPER(클래스 @Roles — 통합 검정 check:acl 이 읽음)
 *   회원 쪽: 주문(POST /health/orders)에 couponCode(선택) — mall.coupon on 일 때만 · 직판 주문만(health-checkout.service 패치)
 * ------------------------------------------------------------------- */

const CODE = /^[A-Z0-9-]{4,20}$/;   // DB CHECK hlt_coupons.code 와 같음

export class HltCouponNewDto {
  @ApiProperty({ example: 'WELCOME-5000', description: '영문 대문자 · 숫자 · 붙임표 4 ~ 20자(바꾸지 못함)' }) @IsString() @Matches(CODE) code!: string;
  @ApiProperty({ example: '첫 주문 5천 원 할인' }) @IsString() @Length(2, 60) name!: string;
  @ApiProperty({ enum: COUPON_KINDS }) @IsIn(COUPON_KINDS as unknown as string[]) kind!: string;
  @ApiPropertyOptional({ example: 5000, description: '정액(FIXED) 할인 원' }) @IsOptional() @IsInt() @Min(1) @Max(10_000_000) amount?: number;
  @ApiPropertyOptional({ example: 10, description: '정률(RATE) 1 ~ 90%' }) @IsOptional() @IsInt() @Min(1) @Max(90) rate?: number;
  @ApiPropertyOptional({ example: 10000, description: '정률 최대 할인 원(비우면 없음)' }) @IsOptional() @IsInt() @Min(1) @Max(10_000_000) maxDiscount?: number;
  @ApiPropertyOptional({ example: 30000, description: '최소 주문(쿠폰이 걸린 상품 금액 · 배송비 빼고)' }) @IsOptional() @IsInt() @Min(0) @Max(100_000_000) minOrder?: number;
  @ApiPropertyOptional({ example: 500, description: '전체 한도(장 · 비우면 없음)' }) @IsOptional() @IsInt() @Min(1) @Max(1_000_000) totalLimit?: number;
  @ApiPropertyOptional({ example: 1, description: '한 사람 한도(처음 1)' }) @IsOptional() @IsInt() @Min(1) @Max(100) perMemberLimit?: number;
  @ApiProperty({ example: '2026-12-01T00:00:00+09:00' }) @IsString() @Length(10, 40) startsAt!: string;
  @ApiProperty({ example: '2027-01-01T00:00:00+09:00' }) @IsString() @Length(10, 40) endsAt!: string;
  @ApiPropertyOptional({ example: '1', description: '기획전 번호 — 그 상품에만 할인' }) @IsOptional() @IsString() @Matches(/^(\d{1,18})?$/) promotionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class HltCouponEditDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 60) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10_000_000) amount?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(90) rate?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10_000_000) maxDiscount?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000_000) minOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1_000_000) totalLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100) perMemberLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(10, 40) startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(10, 40) endsAt?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'PAUSED'] }) @IsOptional() @IsIn(['ACTIVE', 'PAUSED']) state?: string;
  @ApiPropertyOptional({ description: '빈 글자 = 기획전 떼기' }) @IsOptional() @IsString() @Matches(/^(\d{1,18})?$/) promotionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class HltCouponQuoteItemDto {
  @ApiProperty({ example: 'OMEGA3-60' }) @IsString() @Length(1, 40) productCode!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() optionId?: string;
  @ApiProperty({ example: 2 }) @IsInt() @Min(1) @Max(99) qty!: number;
}
export class HltCouponQuoteDto {
  @ApiProperty({ example: 'WELCOME-5000' }) @IsString() @Matches(/^[A-Za-z0-9-]{4,20}$/) code!: string;
  @ApiProperty({ type: [HltCouponQuoteItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => HltCouponQuoteItemDto) items!: HltCouponQuoteItemDto[];
  @ApiPropertyOptional({ format: 'uuid', description: '회원 — 주면 한 사람 한도까지 봄' }) @IsOptional() @Matches(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/) accountId?: string;   // 개발 시드 고정 번호(2222…)도 받음 — validator 13.15 의 IsUUID('all') 은 판 숫자가 없는 번호를 거절
}
export class HltPromoNewDto {
  @ApiProperty({ example: '연말 면역 기획전' }) @IsString() @Length(2, 60) title!: string;
  @ApiProperty({ example: '2026-12-01' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) startsOn!: string;
  @ApiProperty({ example: '2026-12-31' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) endsOn!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) memo?: string;
  @ApiPropertyOptional({ type: [String], description: '상품 코드 목록(200개까지)' }) @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) productCodes?: string[];
}
export class HltPromoEditDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 60) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) startsOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) endsOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) memo?: string;
  @ApiPropertyOptional({ type: [String], description: '보내면 상품 목록을 통째로 바꿈' }) @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) productCodes?: string[];
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/health')
@Roles('ADMIN', 'SUPER')   // 통합 검정(check:acl)은 @Controller 아래의 클래스 @Roles 를 읽습니다(G-208)
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class HealthCouponController {
  constructor(private readonly db: DatabaseService) {}

  @Get('coupons')
  @ApiOperation({ summary: '소개몰 쿠폰 · 기획전 목록 (v10.469)', description: '쿠폰(쓴 수 · 되돌린 수 · 할인 합 · 지금 쓸 수 있는지) · 기획전(상품 수) · 쿠폰 받기 스위치(mall.coupon) · 주문 받기.' })
  @ApiOkResponse({ type: Object })
  list() { return couponsView(this.db); }

  @Post('coupons')
  @HttpCode(200)
  @Audit('HLT_COUPON_ADD', 'SETTING')
  @ApiOperation({ summary: '쿠폰 만들기 (v10.469)', description: '정액 · 정률(최대 할인) · 최소 주문 · 전체 · 한 사람 한도 · 기간 · 기획전 상품만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'COUPON_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'COUPON_CODE · COUPON_NAME · COUPON_KIND · COUPON_AMOUNT · COUPON_RATE · COUPON_MIN · COUPON_LIMIT_IN · COUPON_PERIOD_IN' })
  create(@Body() dto: HltCouponNewDto) { return createCoupon(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('coupons/quote')
  @HttpCode(200)
  @ApiOperation({ summary: '쿠폰 할인 미리 셈 (v10.469)', description: '쓰지 않음 · 쿠폰 받기가 꺼져도 · 지금 판매가 · 회원을 주면 한 사람 한도까지.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'COUPON_CODE · COUPON_PERIOD · COUPON_DIRECT_ONLY · COUPON_MIN_ORDER · COUPON_LIMIT · COUPON_MEMBER_LIMIT · COUPON_NO_ITEM · COUPON_ITEMS' })
  quote(@Body() dto: HltCouponQuoteDto) { return quoteForAdmin(this.db, dto); }

  @Put('coupons/:id')
  @Audit('HLT_COUPON_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '쿠폰 고치기 · 멈춤 (v10.469)', description: '보낸 칸만 · 쓴 뒤에는 할인 모양(금액 · 비율 · 최대 · 최소 주문 · 기획전)을 못 바꿈(409) · 기간 · 한도 · 이름 · 멈춤은 언제나.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'COUPON_USED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'COUPON_NAME · COUPON_AMOUNT · COUPON_RATE · COUPON_MIN · COUPON_LIMIT_IN · COUPON_PERIOD_IN · COUPON_STATE' })
  edit(@Param('id') id: string, @Body() dto: HltCouponEditDto) { return updateCoupon(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Get('coupons/:id/uses')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '쿠폰 쓴 기록 (v10.469)', description: '주문 번호 · 주문 상태 · 할인 · 가린 이름 · 되돌림(취소 · 반품).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  uses(@Param('id') id: string) { return couponUses(this.db, id); }

  @Post('promotions')
  @HttpCode(200)
  @Audit('HLT_PROMO_ADD', 'SETTING')
  @ApiOperation({ summary: '기획전 만들기 (v10.469)', description: '이름 · 기간 · 상품 코드 목록(선택).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PROMO_TITLE · PROMO_DATE · PROMO_PRODUCTS' })
  createPromo(@Body() dto: HltPromoNewDto) { return createPromotion(this.db, dto, RequestCtx.actorId() ?? null); }

  @Get('promotions/:id')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '기획전 자세히 (v10.469)', description: '기간 · 켬 · 상품(직판 · 입점 표시) · 걸린 쿠폰.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  promo(@Param('id') id: string) { return promotionDetail(this.db, id); }

  @Put('promotions/:id')
  @Audit('HLT_PROMO_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '기획전 고치기 (v10.469)', description: '이름 · 기간 · 켬 · 메모 · 상품 목록(보내면 통째로 바꿈).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PROMO_TITLE · PROMO_DATE · PROMO_PRODUCTS' })
  editPromo(@Param('id') id: string, @Body() dto: HltPromoEditDto) { return updatePromotion(this.db, id, dto); }
}
