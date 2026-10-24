import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthCatalogService } from './health-catalog.service';
import { HealthCheckoutService } from './health-checkout.service';
import { HealthPaymentService } from './health-payment.service';
import { HealthReturnService } from './health-return.service';
import { HealthSettleService } from './health-settle.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles, RequireGate } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { OptionalIdempotencyInterceptor } from '../../core/idempotency.interceptor';
import { CartAddDto, CartQtyDto, FeePayDto, ConvertDto, OrderCreateDto, AddressDto, ReturnCreateDto, ReturnDecideDto, PayConfirmDto, RefundDto, HltProductDto, HltSaleCategoryDto, HltOrderDto } from './health-shop.dto';

/**
 * 건강몰 — **직판**입니다.
 *
 * ── 다른 관과 다릅니다 ──────────────────────────────────────────────
 * 소개장터 · 안심소개 · 소개창업은 저희가 **중개만** 하고 거래의
 * 당사자가 아니지만, **소개몰(옛 이름 건강상품관 · 소개뱅크몰)은 저희가 직접 팝니다.**
 *
 * 상품의 하자 · 배송 · 반품 · 환불 책임이 **저희에게** 있습니다.
 *
 * ── 청약철회 7일 ────────────────────────────────────────────────────
 * 받으신 날부터 7일 안이면 이유를 묻지 않습니다(전자상거래법 17조).
 * 다만 **식품은 개봉하면 반품 불가**이고, 그 판정을 저희가 합니다.
 */
@ApiTags('HEALTH-SHOP')
@Controller('api/v1')
export class HealthShopController {
  constructor(
    private readonly catalog: HealthCatalogService,
    private readonly checkout: HealthCheckoutService,
    private readonly payments: HealthPaymentService,
    private readonly returns: HealthReturnService,
    private readonly settle: HealthSettleService,
  ) {}

  @Get('health/products')
  @ApiOperation({
    summary: '상품 목록',
    description: '판매 중인 것만 나옵니다. 재고가 0이면 품절로 표시됩니다.',
  })
  @ApiQuery({ name: 'category', required: false, description: '카테고리 코드' })
  @ApiQuery({ name: 'keyword', required: false })
  @ApiQuery({ name: 'ingredient', required: false, description: '성분 코드 — 그 성분이 든 상품' })
  @ApiQuery({ name: 'concern', required: false, description: '고민 코드 — 그 고민에 묶인 성분이 하나라도 든 상품' })
  @ApiOkResponse({ type: HltProductDto, isArray: true })
  products(@Query('category') category?: string, @Query('keyword') keyword?: string,
           @Query('ingredient') ingredient?: string, @Query('concern') concern?: string) {
    return this.catalog.products(category, keyword, ingredient, concern);
  }

  @Get('health/categories')
  @ApiOperation({
    summary: '취급 갈래',
    description:
      '소개몰이 직접 파는 상품의 갈래와 상태입니다(D025). **잠금(LOCKED)** 은 준비 중 — 화면에 자물쇠와 안내를 보입니다. ' +
      '**판매하지 않음(NOT_SOLD)** 은 갈래 단추에 넣지 않고 이용안내에 적습니다.\n\n' +
      '회원 간 도매 · 납품 매물의 등록 규칙과는 별개입니다.',
  })
  @ApiOkResponse({ type: HltSaleCategoryDto, isArray: true })
  categories() { return this.catalog.categories(); }

  @Get('health/products/:code')
  @ApiOperation({
    summary: '상품 상세',
    description: '**청약철회 조건이 함께 옵니다** — 사시기 전에 아셔야 나중에 다투지 않습니다.',
  })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: HltProductDto })
  product(@Param('code') code: string) { return this.catalog.product(code); }

  @Get('health/ingredients')
  @ApiOperation({
    summary: '성분별 인덱스',
    description: '취급 상품 수(`productCount`)와 재고 있는 상품의 최저가(`minPrice`)가 함께 옵니다. 상품이 없는 성분도 나옵니다.',
  })
  @ApiOkResponse({ type: Object, isArray: true })
  ingredients() { return this.catalog.ingredients(); }

  @Get('health/ingredients/:code')
  @ApiOperation({
    summary: '성분 상세',
    description: '그 성분이 든 상품(`products`)과 그 성분을 **많이 찾는** 고민(`concerns`). 효능을 뜻하지 않습니다.',
  })
  @ApiParam({ name: 'code' })
  @ApiResponse({ status: 409, description: 'NOT_FOUND', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @ApiQuery({ name: 'sort', required: false, enum: ['unit', 'name'], description: 'unit = 한 달 단가 낮은 순(기본) · name = 이름순' })
  ingredient(@Param('code') code: string, @Query('sort') sort?: string) { return this.catalog.ingredient(code, sort); }

  @Get('health/suggest')
  @ApiOperation({
    summary: '검색 제안(자동완성)',
    description: '성분 이름과 상품 이름을 제안합니다(v10.26). **살 수 있는 것만** — 판매 중 상품이 있는 성분 · 재고 있는 판매 중 상품. 앞에서부터 맞는 낱말이 먼저 · 8줄까지. 빈 낱말이면 빈 목록.',
  })
  @ApiQuery({ name: 'q', required: false })
  @ApiOkResponse({ type: Object, isArray: true })
  suggest(@Query('q') q?: string) { return this.catalog.suggest(q); }

  @Get('health/products/:code/image')
  @ApiOperation({ summary: '상품 사진', description: '운영 화면에서 올린 상품 사진(JPG · PNG). 판매 중(품절 포함) 상품만 — 없으면 409 NOT_FOUND(화면은 그린 그림을 씁니다).' })
  @ApiParam({ name: 'code' })
  @ApiResponse({ status: 409, description: 'NOT_FOUND', type: ErrorDto })
  @ApiOkResponse({ description: '그림 바이트', content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/png': { schema: { type: 'string', format: 'binary' } } } })
  async productImage(@Param('code') code: string, @Res() res: Response) {
    const { stream, contentType, size } = await this.catalog.productImage(code);
    res.status(200);
    res.setHeader('Content-Type', contentType); res.setHeader('Content-Length', String(size));
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  @Get('health/concerns')
  @ApiOperation({
    summary: '고민별 인덱스',
    description:
      '고민은 별도 분류가 아니라 **많이 찾는 성분을 다시 묶은 것**입니다. 이름은 상태 표현만 씁니다(질병명 금지).\n\n' +
      '연결 성분이 없는 고민은 나오지 않습니다.',
  })
  @ApiOkResponse({ type: Object, isArray: true })
  concerns() { return this.catalog.concerns(); }

  @Get('health/concerns/:code')
  @ApiOperation({
    summary: '고민 상세',
    description: '많이 찾는 성분(`ingredients`, 성분별 상품 수)과 상품(`products`, 상품마다 든 성분 코드 `ingredients`).',
  })
  @ApiParam({ name: 'code' })
  @ApiResponse({ status: 409, description: 'NOT_FOUND', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  concern(@Param('code') code: string) { return this.catalog.concern(code); }

  @Get('health/promos')
  @ApiOperation({
    summary: '소개몰 메인 특가 배너 (v10.31 · 시안 「오늘의 건강상품」)',
    description: '운영이 바꾸는 배너. isSample=true 면 「견본 문구 — 광고 심의 확인 전」을 붙입니다(건강기능식품 기능성 문구는 심의 뒤에 씀).',
  })
  @ApiOkResponse({ type: Object, isArray: true })
  promos() { return this.catalog.promos(); }

  @Post('health/orders')
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: '있으면 같은 키의 주문은 한 번만 만들고 같은 응답을 돌려줍니다(G-171)' })
  @ApiHeader({ name: 'X-Visitor-Key', required: false, description: '사이트 방문자 쿠키 — 제휴 링크 귀속(클릭 후 72시간)에만 씁니다(G-190)' })
  @UseInterceptors(OptionalIdempotencyInterceptor)
  @ApiOperation({
    summary: '주문',
    description:
      '**재고를 넘겨 살 수 없습니다.** 주문 시점의 청약철회 규칙이 함께 ' +
      '저장됩니다 — 상품 규칙이 나중에 바뀌어도 사실 때 규칙이 적용됩니다.',
  })
  @ApiResponse({ status: 422, description: 'HLTO · 재고 부족 등', type: ErrorDto })
  @ApiOkResponse({ type: HltOrderDto })
  @Audit('HLT_ORDER_CREATE', 'HLT_ORDER')
  order(@Body() dto: OrderCreateDto, @Headers('x-visitor-key') visitorKey?: string) { return this.checkout.order(dto, visitorKey); }

  @Get('me/health/orders')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 주문' })
  @ApiOkResponse({ type: HltOrderDto, isArray: true })
  myOrders() { return this.checkout.myOrders(); }

  @Get('me/health/orders/:no')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({ summary: '주문 상세 · 배송 조회' })
  @ApiParam({ name: 'no' })
  @ApiOkResponse({ type: HltOrderDto })
  myOrder(@Param('no') no: string) { return this.checkout.myOrder(no); }

  @Get('me/health/addresses')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({ summary: '배송지 목록' })
  @ApiOkResponse({ type: Object, isArray: true })
  addresses() { return this.checkout.addresses(); }

  @Post('me/health/addresses')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({ summary: '배송지 추가' })
  @ApiOkResponse({ type: Object })
  addAddress(@Body() dto: AddressDto) { return this.checkout.addAddress(dto); }

  @Patch('me/health/addresses/:id/default')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({ summary: '기본 배송지로', description: '계정당 기본 배송지는 하나입니다 — 이전 기본은 내려갑니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'NOT_FOUND', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  setDefaultAddress(@Param('id') id: string) { return this.checkout.setDefaultAddress(id); }

  @Delete('me/health/addresses/:id')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '배송지 지우기',
    description:
      '**진행 중인 주문이 가리키면 지울 수 없습니다**(409 ADDRESS_IN_USE). 지난 주문이 가리키면 목록에서만 감춥니다 — ' +
      '주문 내역의 배송지는 남습니다. 기본 배송지를 지우면 가장 최근 배송지가 기본이 됩니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'ADDRESS_IN_USE · NOT_FOUND', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_ADDRESS_DELETE', 'HLT_ADDRESS')
  deleteAddress(@Param('id') id: string) { return this.checkout.deleteAddress(id); }

  @Post('me/health/returns')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '취소 · 반품 신청',
    description:
      '**받으신 날부터 7일 안이면 이유를 묻지 않습니다**(전자상거래법 17조).\\n\\n' +
      '다만 식품은 개봉하면 반품이 어렵습니다 — 여시기 전에 확인해 주십시오.\\n\\n' +
      '**상품이 상했거나 다른 것이 왔으면 여셨더라도 돌려받으실 수 있습니다.**\n\n' +
      '서버가 판정합니다(fn_hlt_return_judge): 취소는 발송 전만(HLT_CANCEL_AFTER_SHIP), 반품·교환은 발송 후만' +
      '(HLT_RETURN_BEFORE_SHIP), 받은 날부터 withdrawal_rules.days 일 — 하자·오배송·표시와 다름은 3개월' +
      '(HLT_WITHDRAWAL_EXPIRED).',
  })
  @ApiResponse({ status: 422, description: 'HLT_CANCEL_AFTER_SHIP · HLT_RETURN_BEFORE_SHIP · HLT_WITHDRAWAL_EXPIRED', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_RETURN_REQUEST', 'HLT_RETURN')
  requestReturn(@Body() dto: ReturnCreateDto) { return this.returns.requestReturn(dto); }

  @Get('me/health/returns')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({ summary: '취소 · 반품 내역' })
  @ApiOkResponse({ type: Object, isArray: true })
  myReturns() { return this.returns.myReturns(); }
  /* ── 장바구니 ──────────────────────────────────────────────────── */

  @Get('me/health/cart')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '장바구니',
    description:
      '합계와 배송비를 **서버가 계산해** 내려보냅니다 — 앱에서 계산하면 ' +
      '화면과 주문서가 갈립니다.\n\n' +
      '담아 둔 사이 품절될 수 있어 `hasProblem` 을 함께 봅니다.',
  })
  @ApiOkResponse({ type: Object })
  cart() { return this.checkout.cart(); }

  @Post('me/health/cart')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '장바구니에 담기',
    description:
      '**재고를 잡지 않습니다** — 담아 놓고 안 사는 분 때문에 실제 사실 ' +
      '분이 못 사면 안 되기 때문입니다. 주문하실 때 다시 확인합니다.',
  })
  @ApiResponse({ status: 422, description: 'HLTC · 재고 부족 등', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  addToCart(@Body() dto: CartAddDto) { return this.checkout.addToCart(dto); }

  @Patch('me/health/cart/:code')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({ summary: '수량 바꾸기', description: '0으로 두시면 빠집니다.' })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: Object })
  setQty(@Param('code') code: string, @Body() dto: CartQtyDto) {
    return this.checkout.setQty(code, dto.qty);
  }

  @Patch('me/health/cart/lines/:optionId')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({ summary: '장바구니 줄(옵션) 수량 바꾸기', description: '0 으로 두시면 빠집니다(v10.26 — 같은 상품의 옵션마다 줄이 따로입니다).' })
  @ApiParam({ name: 'optionId', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  setLineQty(@Param('optionId') optionId: string, @Body() dto: CartQtyDto) {
    return this.checkout.setLineQty(optionId, dto.qty);
  }

  @Post('me/health/cart/ack-prices')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: '바뀐 값 확인(「확인했습니다」)', description: '담은 뒤 값이 바뀐 줄의 「담을 때 값」을 지금 값으로 맞춥니다 — 그 뒤 주문할 수 있습니다(v10.26).' })
  @ApiOkResponse({ type: Object })
  ackPrices() { return this.checkout.ackPrices(); }

  /* ── 교환 배송비 (v10.26 · 약관 제3조) ───────────────────────────── */

  @Post('me/health/returns/:id/fee/pay')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({ summary: '교환 배송비 결제 준비', description: '회원 사정 교환의 왕복 배송비(6,000원). 카드 · 계좌이체. 결제창에 넘길 orderId · amount · orderName 을 줍니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'NOT_FOUND · NO_FEE · ALREADY_DECIDED · ALREADY_PAID', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_XFEE_PAY', 'HLT_RETURN')
  payExchangeFee(@Param('id') id: string, @Body() dto: FeePayDto) { return this.returns.payExchangeFee(id, dto.method); }

  @Post('me/health/returns/:id/fee/confirm')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({ summary: '교환 배송비 결제 승인', description: '결제창 성공 뒤 paymentKey · amount 로 승인합니다. 금액은 신청의 교환 배송비와 대조합니다(다르면 422 AMOUNT_MISMATCH). 같은 paymentKey 는 같은 결과.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'NOT_FOUND · NO_FEE · NO_READY_PAYMENT · PAYMENT_KEY_MISMATCH', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'AMOUNT_MISMATCH · PAY_REJECTED', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_XFEE_CONFIRM', 'HLT_RETURN')
  confirmExchangeFee(@Param('id') id: string, @Body() dto: PayConfirmDto) { return this.returns.confirmExchangeFee(id, dto.paymentKey, dto.amount); }

  /* ── 결제 ──────────────────────────────────────────────────────── */

  @Post('health/orders/:no/pay')
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '결제',
    description:
      '**카드번호는 저희 쪽에 남지 않습니다** — PG 가 처리하고 저희는 ' +
      '거래번호만 받습니다.\n\n' +
      '승인되면 주문 상태가 **자동으로** 바뀝니다.',
  })
  @ApiParam({ name: 'no' })
  @ApiResponse({ status: 422, description: '이미 결제됨 등', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_PAY', 'HLT_ORDER')
  pay(@Param('no') no: string, @Body() dto: { method: string }) {
    return this.payments.pay(no, dto.method);
  }

  @Post('health/orders/:no/pay/confirm')
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '결제 승인 (토스 결제창 성공 뒤)',
    description:
      '결제창이 성공 주소로 넘겨준 `paymentKey` · `amount` 로 승인합니다.\n\n' +
      '· **금액은 주문 금액과 대조합니다** — 다르면 PG 를 부르지 않고 422 AMOUNT_MISMATCH.\n' +
      '· 승인되면 결제 PAID → 주문 PAID(트리거). 가상계좌는 입금 대기(READY + `vbank`) — 입금은 웹훅으로 반영됩니다.\n' +
      '· **같은 paymentKey 로 다시 불러도 같은 결과**입니다(`again:true`).\n' +
      '· 결제 키가 없는 환경에서는 스텁이 승인하고 `stub:true` 가 남습니다 — 화면은 "시험 결제" 로 표시합니다.',
  })
  @ApiParam({ name: 'no' })
  @ApiResponse({ status: 409, description: 'NOT_FOUND · ALREADY · NO_READY_PAYMENT · VBANK_WAITING · PAYMENT_KEY_MISMATCH', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'AMOUNT_MISMATCH · PAY_REJECTED(PG 거절 — 주문은 결제 대기로 남음)', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_PAY_CONFIRM', 'HLT_ORDER')
  confirmPay(@Param('no') no: string, @Body() dto: PayConfirmDto) {
    return this.payments.confirmPay(no, dto.paymentKey, dto.amount);
  }

  /* ── 토스 웹훅 ─────────────────────────────────────────────────────
   * ★ 공개 주소입니다(토스가 로그인하지 않습니다). 그래서 **본문을 믿지 않고**
   *   PG 에서 결제를 다시 조회해 반영합니다. 소개몰 결제가 아니면 받기만 합니다. */
  @Post('webhooks/toss')
  @HttpCode(200)
  @ApiOperation({
    summary: '토스페이먼츠 웹훅 (PAYMENT_STATUS_CHANGED · DEPOSIT_CALLBACK)',
    description:
      '**로그인 없는 공개 주소**입니다. 본문에서는 어느 결제인지(`paymentKey` · `orderId`)만 읽고, ' +
      '상태는 PG 에 다시 조회(GET /v1/payments/{paymentKey})한 값으로 반영합니다.\n\n' +
      '가상계좌 입금(DONE) → 결제 완료 · 입금 전 만료/취소 → 결제만 닫음(주문은 결제 대기) · ' +
      '이미 반영된 상태면 아무것도 하지 않습니다(재전송 안전). 조회 실패면 502 — 토스가 다시 보냅니다.',
  })
  @ApiResponse({ status: 502, description: 'PG_LOOKUP_FAILED — 토스가 재전송합니다', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  tossWebhook(@Body() body: any) { return this.payments.tossWebhook(body); }

  /* ── 배송 ──────────────────────────────────────────────────────── */

  @Get('me/health/orders/:no/shipments')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '배송 조회',
    description: '언제 무엇이 있었는지 남습니다 — "안 왔다" 는 문의에 답하기 위해서입니다.',
  })
  @ApiParam({ name: 'no' })
  @ApiOkResponse({ type: Object, isArray: true })
  shipments(@Param('no') no: string) { return this.checkout.shipments(no); }

  /* ── 판매자 정산 (운영) ───────────────────────────────────────── */

  @Get('admin/health/sellers')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '소개몰 판매자',
    description:
      '**하위가맹점 ID 가 없으면 지급이 안 됩니다** — 집계만 되고 ' +
      '돈을 보낼 곳이 없습니다. PG 계약 뒤에 채우십시오.',
  })
  @ApiOkResponse({ type: Object, isArray: true })
  hltSellers() { return this.settle.hltSellers(); }

  @Get('admin/health/settlements')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '주별 정산',
    description:
      '**배송 완료 + 청약철회 7일**이 지난 건만 집계합니다.\n\n' +
      '배송 완료로 집계하면 반품될 때마다 되돌려야 합니다 — 그래서 ' +
      '주 정산이어도 실제 지급은 2~3주 뒤입니다.',
  })
  @ApiOkResponse({ type: Object })
  hltSettlements() { return this.settle.hltSettlements(); }

  @Post('admin/health/settlements/close')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '주 정산 마감',
    description:
      '지난 주 확정분을 집계해 정산서를 만듭니다.\n\n' +
      '**음수면 지급이 아니라 이월합니다** — 판매자 계좌에서 빼 올 수 없습니다.',
  })
  @ApiResponse({ status: 422, description: 'HLTS · 합계 불일치 등', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_SETTLE_CLOSE', 'HLT_SETTLEMENT')
  closeSettlement(@Body() dto: { periodFrom: string }) {
    return this.settle.closeSettlement(dto.periodFrom);
  }

  @Get('admin/health/returns')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '취소 · 반품 신청 목록', description: '기본은 접수(REQUESTED)만. `state=ALL` 이면 전부.' })
  @ApiQuery({ name: 'state', required: false, enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED', 'ALL'] })
  @ApiOkResponse({ type: Object, isArray: true })
  adminReturns(@Query('state') state?: string) { return this.returns.adminReturns(state); }

  @Post('admin/health/returns/:id/decide')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '취소 · 반품 승인 · 반려',
    description:
      '승인하면 주문이 **취소(CANCELED) · 반품(RETURNED)** 으로 바뀌고 재고가 **한 번만** 되돌아갑니다(트리거).\n\n' +
      '반려는 사유가 필요합니다. 식품 개봉 여부 같은 판단은 여기서 합니다.\n\n' +
      '**반품 승인은 `opened`(개봉 여부)가 필수**입니다 — `true` 면 주문은 반품 완료지만 재고로 되돌리지 않습니다' +
      '(`restockSkipped:"OPENED"`). 발송 전 취소에는 `opened:true` 를 줄 수 없습니다.\n\n' +
      '결제된 주문이면 승인과 함께 **환불**합니다(REFUNDED). 환불이 실패하면 승인에 머물고 `ok:false` · `refund.error` 가 옵니다 — ' +
      '`POST /admin/health/returns/{id}/refund` 로 다시 시도합니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'ALREADY_DECIDED · ALREADY_SHIPPED · NOT_FOUND', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'NOTE_REQUIRED · OPENED_REQUIRED · CANCEL_NOT_OPENED', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_RETURN_DECIDE', 'HLT_RETURN')
  decideReturn(@Param('id') id: string, @Body() dto: ReturnDecideDto) {
    return this.returns.decideReturn(id, dto.state, dto.note, dto.opened, dto.sellerFault);
  }

  @Post('admin/health/returns/:id/convert')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '교환 → 반품으로 바꾸기',
    description: '교환할 상품이 14일 안에 입고되지 않았거나 회원이 원할 때(약관 제3조). 교환 신청은 반려로 닫히고 같은 사유의 반품 신청이 생깁니다 — 청약철회 기간은 교환을 신청한 때로 봅니다. 낸 교환 배송비는 돌려드립니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'NOT_FOUND · ALREADY_DECIDED · ORDER_CLOSED', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_EXCHANGE_CONVERT', 'HLT_RETURN')
  convertExchange(@Param('id') id: string, @Body() dto: ConvertDto) { return this.returns.convertExchange(id, dto.note); }

  @Post('admin/health/returns/:id/fee-refund')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '교환 배송비 환불 (다시 시도)', description: '반려 · 회사 사정 판정 · 반품으로 바꿈 때 환불이 실패한 교환 배송비를 다시 돌려드립니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'NOT_FOUND · NOT_REFUNDABLE · NOT_DECIDED', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_XFEE_REFUND', 'HLT_RETURN')
  retryExchangeFeeRefund(@Param('id') id: string) { return this.returns.retryExchangeFeeRefund(id); }

  @Post('admin/health/returns/:id/refund')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '환불 (다시 시도)',
    description:
      '승인된 취소·반품의 결제를 PG 에서 취소하고 **환불 완료(REFUNDED)** 로 닫습니다. 승인 때 환불이 실패한 건을 다시 시도할 때 씁니다.\n\n' +
      '이미 환불됐으면 같은 결과(`again:true`). PG 에는 신청 id 로 Idempotency-Key 를 붙여 두 번 취소되지 않습니다.\n\n' +
      '가상계좌로 입금된 결제는 `refundReceiveAccount`(환불 받을 계좌)가 필요합니다 — 저장하지 않습니다.\n\n' +
      '반품 배송비는 약관에 금액이 없어 차감하지 않습니다(전액 환불).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'NOT_FOUND · NOT_APPROVED · NOT_REFUNDABLE · NOT_PAID · ORDER_OPEN', type: ErrorDto })
  @ApiResponse({ status: 502, description: 'REFUND_FAILED — PG 거절 · 연결 실패. 승인 상태로 남습니다', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('HLT_REFUND', 'HLT_RETURN')
  refund(@Param('id') id: string, @Body() dto: RefundDto) {
    return this.returns.refund(id, dto.refundReceiveAccount);
  }

  @Get('admin/health/commission-rates')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '판매수수료율',
    description:
      '**소개뱅크가 정합니다** — 판매자가 아닙니다.\n\n' +
      '바꾸시면 이력이 남고, **이미 판매된 건에는 적용되지 않습니다.**',
  })
  @ApiOkResponse({ type: Object, isArray: true })
  commissionRates() { return this.settle.commissionRates(); }

}
