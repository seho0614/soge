import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { HealthAdminService } from './health-admin.service';

export class OptionInputDto {
  @ApiPropertyOptional({ description: '개월 수(1 ~ 36). 비우면 「단품」(한 달 단가를 보이지 않음)', nullable: true })
  @IsOptional() @IsInt() @Min(1) @Max(36) months?: number | null;
  @ApiProperty({ description: '결제 금액(원)' }) @IsInt() @Min(1) @Max(100_000_000) price!: number;
  @ApiPropertyOptional({ description: '재고' }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000) stock?: number;
  @ApiPropertyOptional({ description: '꼬리 글자(「1+1」 등 · 10자까지 · 계산에 쓰지 않음)' }) @IsOptional() @IsString() @MaxLength(10) tag?: string;
}

export class OptionPatchDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(1) @Max(36) months?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100_000_000) price?: number;
  @ApiPropertyOptional({ description: '재고(입고 · 조정) — 변경 기록에 남습니다' }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000) stock?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) tag?: string;
  @ApiPropertyOptional({ description: '켬/끔 — 주문이 있는 옵션은 지우지 않고 끕니다' }) @IsOptional() @StrictBoolean() active?: boolean;
  @ApiPropertyOptional({ description: '바꾼 까닭(변경 기록)' }) @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class MainIngredientDto {
  @ApiProperty({ description: '성분 코드(성분군이 아닌 것)' }) @IsString() @MaxLength(20) code!: string;
  @ApiPropertyOptional({ description: '함량 표제(「3,000mg」 · 화장품은 용량 「50ml」)' }) @IsOptional() @IsString() @MaxLength(30) amount?: string;
}

export class ProductCreateDto {
  @ApiProperty({ description: '상품 코드 — 주소에 쓰입니다(영문 · 숫자 · 붙임표 2 ~ 40자 · 등록 뒤 못 바꿈)' })
  @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9-]{1,39}$/) code!: string;
  @ApiProperty() @IsString() @MaxLength(80) name!: string;
  @ApiProperty({ description: '갈래 코드 — HLT_FOOD · HLT_COSMETIC …' }) @IsString() categoryCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) summary?: string;
  @ApiPropertyOptional({ description: '정가 — 대표 옵션(가장 짧은 개월 수)의 정상가' }) @IsOptional() @IsInt() @Min(1) listPrice?: number;
  @ApiPropertyOptional({ enum: ['신규입점', '특별가격'] }) @IsOptional() @IsIn(['신규입점', '특별가격']) badge?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) caution?: string;
  @ApiPropertyOptional({ description: '상품정보제공고시 값 { 항목 이름: 값 }' }) @IsOptional() @IsObject() notice?: Record<string, string>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) adCopy?: string;
  @ApiPropertyOptional({ enum: ['BOX', 'POUCH', 'BOTTLE'] }) @IsOptional() @IsIn(['BOX', 'POUCH', 'BOTTLE']) artForm?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{3,10}$/) artTone?: string;
  @ApiPropertyOptional({ type: MainIngredientDto }) @IsOptional() @ValidateNested() @Type(() => MainIngredientDto) mainIngredient?: MainIngredientDto;
  @ApiProperty({ type: [OptionInputDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => OptionInputDto) options!: OptionInputDto[];
}

export class ProductPatchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() categoryCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) summary?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(1) listPrice?: number | null;
  @ApiPropertyOptional({ enum: ['신규입점', '특별가격', ''] }) @IsOptional() @IsIn(['신규입점', '특별가격', '']) badge?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) caution?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() notice?: Record<string, string>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) adCopy?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) reviewNo?: string;
  @ApiPropertyOptional({ enum: ['BOX', 'POUCH', 'BOTTLE', ''] }) @IsOptional() @IsIn(['BOX', 'POUCH', 'BOTTLE', '']) artForm?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^([A-Z]{3,10})?$/) artTone?: string;
  @ApiPropertyOptional({ format: 'uuid', description: '올리기를 마친 상품 사진(POST /files · purpose PRODUCT_IMAGE)' }) @IsOptional() @IsUUID() imageFileId?: string;
  @ApiPropertyOptional({ type: MainIngredientDto }) @IsOptional() @ValidateNested() @Type(() => MainIngredientDto) mainIngredient?: MainIngredientDto;
}

export class ProductStatusDto {
  @ApiProperty({ enum: ['ON_SALE', 'STOPPED', 'DRAFT', 'SOLD_OUT'] }) @IsIn(['ON_SALE', 'STOPPED', 'DRAFT', 'SOLD_OUT']) status!: string;
}

export class IngredientCreateDto {
  @ApiProperty({ description: '영문 대문자 · 숫자 · 붙임표 2 ~ 20자' }) @Matches(/^[A-Z][A-Z0-9-]{1,19}$/) code!: string;
  @ApiProperty() @IsString() @MaxLength(40) name!: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) aliases?: string[];
  @ApiPropertyOptional({ description: '성분군(묶음) — 상품에는 쓰지 않고 아래 성분을 모읍니다' }) @IsOptional() @StrictBoolean() isGroup?: boolean;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() featured?: boolean;
  @ApiPropertyOptional({ description: '상위 성분군 코드(2단까지)' }) @IsOptional() @IsString() parent?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sort?: number;
}

export class IngredientPatchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) name?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) aliases?: string[];
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() featured?: boolean;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() parent?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sort?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

/* v10.31 (합침) — 소개몰 「오늘의 건강상품」 특가 배너(hlt_promos · w3 D061) 운영 편집 */
export class PromoCreateDto {
  @ApiProperty({ example: '지금 가장 많이 찾는 건강상품', description: '작은 머리 글(30자)' }) @IsString() @MaxLength(30) tag!: string;
  @ApiProperty({ example: '환절기 면역력 강화', description: '제목(40자)' }) @IsString() @MaxLength(40) title!: string;
  @ApiPropertyOptional({ example: '비타민C 특가전', description: '제목 강조(40자)', nullable: true }) @IsOptional() @IsString() @MaxLength(40) titleEm?: string | null;
  @ApiPropertyOptional({ description: '설명(80자)', nullable: true }) @IsOptional() @IsString() @MaxLength(80) body?: string | null;
  @ApiProperty({ example: '/health/i/VITC', description: '누르면 갈 소개몰 주소(/health 로 시작)' }) @IsString() @Matches(/^\/health(\/|$)/) @MaxLength(200) linkUrl!: string;
  @ApiPropertyOptional({ example: '지금 바로 보기' }) @IsOptional() @IsString() @MaxLength(20) cta?: string;
  @ApiPropertyOptional({ description: '견본 문구 표시(광고 심의 확인 전이면 켬 — 화면에 「견본 문구」가 붙습니다)', default: true }) @IsOptional() @StrictBoolean() isSample?: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @StrictBoolean() isActive?: boolean;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) @IsOptional() @IsDateString() startsAt?: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) @IsOptional() @IsDateString() endsAt?: string | null;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
}
export class PromoPatchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) tag?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) title?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(40) titleEm?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(80) body?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^\/health(\/|$)/) @MaxLength(200) linkUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) cta?: string;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() isSample?: boolean;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() isActive?: boolean;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) @IsOptional() @IsDateString() startsAt?: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) @IsOptional() @IsDateString() endsAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
}


/**
 * 운영 화면 「소개몰 상품」 (v10.26) — 본사 운영자(ADMIN · SUPER)만.
 * 상품은 초안으로 등록 → 「판매 시작」. 값 · 재고는 옵션에서 바꿉니다(상품의 값 · 재고는 옵션에서 계산). 바꾼 것은 변경 기록에 남습니다.
 */
@ApiTags('HEALTH-ADMIN')
@ApiBearerAuth()
@Controller('api/v1/admin/health')
@Roles('ADMIN', 'SUPER')   // 통합 검정(check:acl)은 @Controller 아래의 클래스 @Roles 를 읽습니다 — 위에 두면 「표시 없음」으로 걸림(G-208)
export class HealthAdminController {
  constructor(private readonly svc: HealthAdminService) {}

  @Get('products')
  @ApiOperation({ summary: '소개몰 상품 목록(모든 상태 · 옵션 · 재고)' })
  @ApiQuery({ name: 'q', required: false }) @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'ON_SALE', 'SOLD_OUT', 'STOPPED'] })
  @ApiOkResponse({ type: Object })
  list(@Query('q') q?: string, @Query('category') category?: string, @Query('status') status?: string) { return this.svc.list(q, category, status); }

  @Post('products')
  @ApiOperation({ summary: '상품 등록(초안)', description: '늘 초안(DRAFT)으로 만듭니다. 판매 시작은 /status. 금지 표현이 있으면 422 BANNED_WORD.' })
  @ApiResponse({ status: 409, description: 'DUPLICATE_CODE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'BAD_CATEGORY · BANNED_WORD · BAD_INGREDIENT', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_PRODUCT_CREATE', 'HLT_PRODUCT')
  create(@Body() dto: ProductCreateDto) { return this.svc.create(dto); }

  @Get('products/:code')
  @ApiOperation({ summary: '상품 하나(수정 화면)' }) @ApiParam({ name: 'code' })
  @ApiResponse({ status: 409, description: 'NOT_FOUND', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  get(@Param('code') code: string) { return this.svc.get(code); }

  @Patch('products/:code')
  @ApiOperation({ summary: '상품 고치기', description: '글 · 정가 · 배지 · 그림 · 고시 · 갈래 · 표제 성분. 값 · 재고는 옵션에서 바꿉니다.' }) @ApiParam({ name: 'code' })
  @ApiResponse({ status: 422, description: 'BANNED_WORD · BAD_IMAGE · BAD_CATEGORY · HLTP', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_PRODUCT_UPDATE', 'HLT_PRODUCT')
  update(@Param('code') code: string, @Body() dto: ProductPatchDto) { return this.svc.update(code, dto); }

  @Post('products/:code/status')
  @ApiOperation({ summary: '판매 시작 · 판매 중지 · 초안으로', description: '판매 시작은 DB 가 판매 범위(잠금 · 미판매 갈래) · 옵션 · 금지 표현을 봅니다(422 HLTP).' }) @ApiParam({ name: 'code' })
  @ApiResponse({ status: 422, description: 'HLTP — 잠긴 갈래 · 옵션 없음 등', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_PRODUCT_STATUS', 'HLT_PRODUCT')
  setStatus(@Param('code') code: string, @Body() dto: ProductStatusDto) { return this.svc.setStatus(code, dto.status); }

  @Post('products/:code/options')
  @ApiOperation({ summary: '옵션 더하기' }) @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_OPTION_ADD', 'HLT_PRODUCT')
  addOption(@Param('code') code: string, @Body() dto: OptionInputDto) { return this.svc.addOption(code, dto); }

  @Patch('products/:code/options/:optionId')
  @ApiOperation({ summary: '옵션 고치기(결제 금액 · 재고 · 꼬리 글자 · 켬/끔)', description: '재고 · 결제 금액을 바꾸면 변경 기록에 남습니다.' })
  @ApiParam({ name: 'code' }) @ApiParam({ name: 'optionId', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_OPTION_UPDATE', 'HLT_PRODUCT')
  updateOption(@Param('code') code: string, @Param('optionId') optionId: string, @Body() dto: OptionPatchDto) { return this.svc.updateOption(code, optionId, dto); }

  @Get('products/:code/history')
  @ApiOperation({ summary: '상품 변경 기록' }) @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: Object, isArray: true })
  history(@Param('code') code: string) { return this.svc.history(code); }

  @Get('ingredients')
  @ApiOperation({ summary: '성분 목록(군 · 많이 찾는 · 판매 중 상품 수)' })
  @ApiOkResponse({ type: Object, isArray: true })
  ingredients() { return this.svc.ingredients(); }

  @Post('ingredients')
  @ApiOperation({ summary: '성분 더하기', description: '성분군은 2단까지(군 → 성분) — DB 가 막습니다(HLTI).' })
  @ApiResponse({ status: 409, description: 'DUPLICATE_CODE', type: ErrorDto })
  @ApiOkResponse({ type: Object, isArray: true })
  @Audit('HLT_INGREDIENT_ADD', 'INGREDIENT')
  addIngredient(@Body() dto: IngredientCreateDto) { return this.svc.addIngredient(dto); }

  @Patch('ingredients/:code')
  @ApiOperation({ summary: '성분 고치기(이름 · 다른 이름 · 많이 찾는 · 군)' }) @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: Object, isArray: true })
  @Audit('HLT_INGREDIENT_UPDATE', 'INGREDIENT')
  updateIngredient(@Param('code') code: string, @Body() dto: IngredientPatchDto) { return this.svc.updateIngredient(code, dto); }

  @Get('sale-categories')
  @ApiOperation({ summary: '갈래 · 판매 범위(읽기)', description: '열림 · 잠김 · 팔지 않음. 갈래를 여는 것은 신고 · 심의 체계를 갖춘 뒤 DB 마이그레이션으로 합니다(화면에서 바꾸지 않음).' })
  @ApiOkResponse({ type: Object, isArray: true })
  saleCategories() { return this.svc.saleCategories(); }

  /* v10.31 (합침) — 특가 배너(hlt_promos). 사용자 웹은 GET /health/promos(기간 안 · 켠 것)로 읽습니다 */
  @Get('promos')
  @ApiOperation({ summary: '특가 배너 목록(전부)', description: '소개몰 메인 「오늘의 건강상품」 배너. 켬/끔 · 기간 · 견본 문구 표시를 함께 봅니다.' })
  @ApiOkResponse({ type: Object, isArray: true })
  promos() { return this.svc.promos(); }

  @Post('promos')
  @ApiOperation({ summary: '특가 배너 더하기', description: '건강기능식품 기능성 문구는 인정 범위 · 광고 심의를 확인하기 전이면 isSample 을 켜 둡니다(화면에 「견본 문구」).' })
  @ApiResponse({ status: 422, description: '형식(주소는 /health 로 시작 · 끝이 시작보다 뒤)', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_PROMO_CREATE', 'HLT_PROMO')
  addPromo(@Body() dto: PromoCreateDto) { return this.svc.addPromo(dto); }

  @Patch('promos/:id')
  @ApiOperation({ summary: '특가 배너 고치기 · 켬/끔' }) @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_PROMO_UPDATE', 'HLT_PROMO')
  updatePromo(@Param('id') id: string, @Body() dto: PromoPatchDto) { return this.svc.updatePromo(id, { ...dto }); }
}
