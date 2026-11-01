import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { HealthSellerService } from './health-seller.service';
import { HealthSettleService } from './health-settle.service';
import { OptionInputDto, OptionPatchDto, ProductCreateDto, ProductPatchDto } from './health-admin.controller';
import { AdvanceDto, ShipDto } from './health-orders.controller';
import { ReturnDecideDto } from './health-shop.dto';
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
export class HltSettleInvoiceDto {
  @ApiProperty({ description: '세금계산서 승인번호(국세청 연동 전 · 운영이 적음)' }) @IsString() @MaxLength(40) invoiceNo!: string;
}
export class CommissionRateDto {
  @ApiProperty({ description: '판매수수료율(%) — 0 ~ 50', minimum: 0, maximum: 50 }) @IsNumber() @Min(0) @Max(50) rate!: number;
  @ApiPropertyOptional({ description: '바꾼 까닭' }) @IsOptional() @IsString() @MaxLength(200) note?: string;
}
export class SubmerchantDto {
  @ApiPropertyOptional({ description: '결제대행사 화면에서 받은 하위가맹점 번호(비우면 결제대행사에 등록 — 연동 전이라 간주 모드에서만 시험 번호)' })
  @IsOptional() @IsString() @MaxLength(60) submerchantId?: string;
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
  constructor(private readonly svc: HealthSellerService, private readonly settle: HealthSettleService) {}

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

  /* ── v10.167 (docs/258) 주문 · 발송 · 반품 ── */

  @Get('me/health/seller/orders')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '내 주문', description: '발송할 것 먼저. 받는 분 정보는 발송 전 · 배송 중에만 보입니다(배송 · 반품 · 응대 목적으로만 — 입점 약관 제22조).' })
  @ApiQuery({ name: 'status', required: false, enum: ['PAID', 'SHIPPED', 'DELIVERED', 'CONFIRMED'] })
  @ApiOkResponse({ type: Object })
  orders(@Query('status') status?: string) { return this.svc.orders(status); }

  @Post('me/health/seller/orders/:no/ship')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '발송 처리', description: '택배사 · 송장번호 → 「배송중」. 내 판매자의 주문만.' })
  @ApiParam({ name: 'no' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'NOT_SHIPPABLE · CANCEL_REQUESTED', type: ErrorDto })
  @Audit('HLT_SELLER_ORDER_SHIP', 'HLT_ORDER')
  ship(@Param('no') no: string, @Body() dto: ShipDto) { return this.svc.ship(no, dto.carrier, dto.trackingNo); }

  @Post('me/health/seller/orders/:no/tracking')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '송장 고치기', description: '배송중일 때만(전 기록은 남음).' })
  @ApiParam({ name: 'no' })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_SELLER_ORDER_TRACKING', 'HLT_ORDER')
  fixTracking(@Param('no') no: string, @Body() dto: ShipDto) { return this.svc.fixTracking(no, dto.carrier, dto.trackingNo); }

  @Post('me/health/seller/orders/:no/advance')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '배송 단계', description: '간선 이동 · 배송 완료(구매확정 · 반품 기한의 기준).' })
  @ApiParam({ name: 'no' })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_SELLER_ORDER_ADVANCE', 'HLT_ORDER')
  advance(@Param('no') no: string, @Body() dto: AdvanceDto) { return this.svc.advance(no, dto.state); }

  @Get('me/health/seller/returns')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '내 주문의 취소 · 반품 · 교환 신청', description: '접수된 것 먼저.' })
  @ApiOkResponse({ type: Object, isArray: true })
  returns() { return this.svc.returns(); }

  @Post('me/health/seller/returns/:id/decide')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '취소 · 반품 승인 · 반려', description: '운영과 같은 규칙 — 재고 · 환불 · 판매자 반품비 · 교환 배송비. 반려 사유는 회원에게 보이고, 회원이 이의를 내면 운영이 중재합니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'ALREADY_DECIDED · ALREADY_SHIPPED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'NOTE_REQUIRED · OPENED_REQUIRED · CANCEL_NOT_OPENED', type: ErrorDto })
  @Audit('HLT_SELLER_RETURN_DECIDE', 'HLT_RETURN')
  decideReturn(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnDecideDto) {
    return this.svc.decideReturn(id, dto.state, dto.note, dto.opened, dto.sellerFault);
  }

  /* ── v10.168 (docs/259) 정산 ── */

  @Get('me/health/seller/settlements')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '내 정산서', description: '주 1회 마감(월요일) · 매출 · 수수료 · 환불 조정 · 이월 · 지급액 · 세금계산서 상태. 지급은 결제대행사가 합니다.' })
  @ApiOkResponse({ type: Object, isArray: true })
  settlements() { return this.svc.settlements(); }

  @Get('me/health/seller/settlements/:id')
  @Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '정산 명세', description: '주문별 매출 · 수수료 · 지급액 · 환불 조정(입점 약관 제19조).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object, isArray: true })
  settlement(@Param('id', ParseUUIDPipe) id: string) { return this.svc.settlement(id); }

  @Post('admin/health/settlements/:id/invoice')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '판매수수료 세금계산서 발행 기록', description: '국세청 연동 전이라 발행한 승인번호를 적습니다. 방향은 설정 mall.invoice_direction(세무사 확인 뒤).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'NOT_REQUESTED', type: ErrorDto })
  @Audit('HLT_SETTLE_INVOICE', 'HLT_SETTLEMENT')
  invoice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HltSettleInvoiceDto) { return this.settle.markInvoice(id, dto.invoiceNo); }

  @Patch('admin/health/commission-rates/:categoryCode')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '갈래 판매수수료율', description: '갈래 기본값(판매자 개별 요율이 있으면 그것이 먼저). 바꾼 기록은 DB 가 남기고, 바꾼 뒤 주문부터 적용됩니다(주문 때 요율을 박음).' })
  @ApiParam({ name: 'categoryCode', description: '소개몰 갈래 코드(HLT_FOOD …)' })
  @ApiOkResponse({ type: Object, isArray: true })
  @Audit('HLT_COMMISSION_RATE', 'HLT_COMMISSION')
  rate(@Param('categoryCode') categoryCode: string, @Body() dto: CommissionRateDto) { return this.settle.setCommissionRate(categoryCode, dto.rate, dto.note); }

  /* ── v10.169 (docs/260) 하위가맹점 · 확정 · 지급 요청(간주 모드) ── */

  @Post('admin/health/sellers/:id/submerchant')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '하위가맹점 번호', description: '결제대행사 화면에서 받은 번호를 적거나, 비우면 결제대행사에 등록합니다(연동 전이라 간주 모드에서만 시험 번호).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, description: 'PG_SUBMERCHANT_NOT_READY', type: ErrorDto })
  @Audit('HLT_SELLER_SUBMERCHANT', 'HLT_SELLER')
  submerchant(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmerchantDto) { return this.settle.registerSubmerchant(id, dto.submerchantId); }

  @Post('admin/health/settlements/:id/confirm')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '정산서 확정', description: '판매자가 정산서를 볼 시간을 둔 뒤 확정합니다(마감 → 확정). 지급액이 0 보다 커야 합니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'NOT_CONFIRMABLE', type: ErrorDto })
  @Audit('HLT_SETTLE_CONFIRM', 'HLT_SETTLEMENT')
  confirm(@Param('id', ParseUUIDPipe) id: string) { return this.settle.confirmSettlement(id); }

  @Post('admin/health/settlements/:id/payout')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '지급 요청', description: '확정된 입점 정산서를 결제대행사에 판매자 하위가맹점으로 지급하도록 요청합니다. 회사는 돈을 보관하지 않습니다. 연동 전이라 간주 모드에서만 시험으로 「지급됨」.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'NOT_CONFIRMED · DIRECT_NO_PAYOUT', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'NO_SUBMERCHANT · PG_PAYOUT_NOT_READY', type: ErrorDto })
  @Audit('HLT_SETTLE_PAYOUT', 'HLT_SETTLEMENT')
  payout(@Param('id', ParseUUIDPipe) id: string) { return this.settle.payout(id); }

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
