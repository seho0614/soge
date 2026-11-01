import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { HealthSellerService } from './health-seller.service';
import { OptionInputDto, OptionPatchDto, ProductCreateDto, ProductPatchDto } from './health-admin.controller';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/* v10.166 (D156 · docs/257) — 소개몰 판매자센터(상품 등록 → 운영 검수 · 배송비 · 반품비) · 운영 검수 */

export class SellerShippingDto {
  @ApiProperty({ description: '기본 배송비(원) — 0 이면 무료' }) @IsInt() @Min(0) @Max(50000) shipFee!: number;
  @ApiPropertyOptional({ description: '이 금액 이상 사면 배송비 무료(비우면 없음)', nullable: true }) @IsOptional() @IsInt() @Min(1) @Max(10_000_000) freeShipOver?: number | null;
  @ApiProperty({ description: '회원 사정(단순 변심) 왕복 반품비 — 6,000원 상한(입점 약관 제15조)' }) @IsInt() @Min(0) @Max(6000) returnShipFee!: number;
}
export class SellerStatusDto {
  @ApiProperty({ enum: ['ON_SALE', 'STOPPED', 'SOLD_OUT'] }) @IsIn(['ON_SALE', 'STOPPED', 'SOLD_OUT']) status!: string;
}
export class ProductReviewDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) @IsIn(['APPROVE', 'REJECT']) decision!: string;
  @ApiPropertyOptional({ description: '반려 사유(반려면 꼭) — 판매자에게 그대로 보임' }) @IsOptional() @IsString() @MaxLength(500) note?: string;
}

@ApiTags('HEALTH')
@ApiBearerAuth()
@Controller('api/v1')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class HealthSellerController {
  constructor(private readonly svc: HealthSellerService) {}

  @Get('me/health/seller/center')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '판매자센터', description: '판매자 정보 · 배송 설정 · 상품 수 · 검수 대기 · 지급 가능(하위가맹점) 여부.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, description: 'NOT_SELLER', type: ErrorDto })
  center() { return this.svc.center(); }

  @Patch('me/health/seller/shipping')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '배송비 · 반품비', description: '반품비(회원 사정 왕복)는 6,000원을 넘을 수 없습니다.' })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_SELLER_SHIPPING', 'HLT_SELLER')
  shipping(@Body() dto: SellerShippingDto) { return this.svc.shipping(dto); }

  @Get('me/health/seller/products')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '내 상품', description: '상태 · 검수 상태 · 반려 사유.' })
  @ApiOkResponse({ type: Object, isArray: true })
  products() { return this.svc.products(); }

  @Post('me/health/seller/products')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '상품 등록(초안)', description: '코드는 「판매자 코드-입력한 코드」가 됩니다. 판매는 검수 통과 뒤.' })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_SELLER_PRODUCT_CREATE', 'HLT_PRODUCT')
  create(@Body() dto: ProductCreateDto) { return this.svc.create(dto); }

  @Get('me/health/seller/products/:code')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '내 상품 하나' })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: Object })
  product(@Param('code') code: string) { return this.svc.product(code); }

  @Patch('me/health/seller/products/:code')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '내 상품 고치기', description: '글 · 갈래 · 고시를 바꾸면 다시 검수를 받아야 합니다(판매 중이면 초안으로).' })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_SELLER_PRODUCT_UPDATE', 'HLT_PRODUCT')
  update(@Param('code') code: string, @Body() dto: ProductPatchDto) { return this.svc.update(code, dto); }

  @Post('me/health/seller/products/:code/submit')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '검수 요청' })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'ALREADY_SUBMITTED · ALREADY_APPROVED', type: ErrorDto })
  @Audit('HLT_SELLER_PRODUCT_SUBMIT', 'HLT_PRODUCT')
  submit(@Param('code') code: string) { return this.svc.submit(code); }

  @Post('me/health/seller/products/:code/status')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '판매 시작 · 중지 · 품절', description: '판매 시작은 검수 통과 · 판매자 승인 · 하위가맹점 등록 · 입점 켜짐이 모두 있어야 합니다(DB 가 봄).' })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_SELLER_PRODUCT_STATUS', 'HLT_PRODUCT')
  status(@Param('code') code: string, @Body() dto: SellerStatusDto) { return this.svc.status(code, dto.status); }

  @Post('me/health/seller/products/:code/options')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '옵션 더하기' })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: Object })
  addOption(@Param('code') code: string, @Body() dto: OptionInputDto) { return this.svc.addOption(code, dto); }

  @Patch('me/health/seller/products/:code/options/:optionId')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '옵션 고치기', description: '결제 금액 · 재고 · 켬/끔 — 검수 없이 바뀌고 변경 기록에 남습니다.' })
  @ApiParam({ name: 'code' }) @ApiParam({ name: 'optionId', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  updateOption(@Param('code') code: string, @Param('optionId', ParseUUIDPipe) optionId: string, @Body() dto: OptionPatchDto) {
    return this.svc.updateOption(code, optionId, dto);
  }

  /* ── 운영 ── */

  @Get('admin/health/product-reviews')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '입점 상품 검수 대기', description: '오래된 것부터 · 판매자 · 갈래 · 고시 · 옵션 수 · 지급 가능 여부.' })
  @ApiOkResponse({ type: Object, isArray: true })
  reviewQueue() { return this.svc.reviewQueue(); }

  @Post('admin/health/product-reviews/:code')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '입점 상품 검수', description: '통과하면 판매자가 「판매 시작」을 할 수 있습니다. 반려 사유는 판매자에게 그대로 보입니다.' })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'NOT_SUBMITTED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'REASON_REQUIRED', type: ErrorDto })
  @Audit('HLT_PRODUCT_REVIEW', 'HLT_PRODUCT')
  review(@Param('code') code: string, @Body() dto: ProductReviewDto) { return this.svc.review(code, dto.decision, dto.note); }
}
