import { Body, Controller, Delete, Get, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import {
  IssueCodeDto, LedgerEntryDto, PlanDto, RefCodeQuotaDto, RefCodeQuotaQueryDto, ReferralCodeDto,
  SubscribeDto, SubscribeResultDto, ReservationCancelResultDto,
} from './billing.dto';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { IdempotencyInterceptor } from '../../core/idempotency.interceptor';

/** SB-MYP-SUB-010 / 020 */
@ApiTags('MYP')
export class SuccessFeeDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) dealId!: string;
  @ApiProperty({ description: '청구 시점의 회원 등급' }) planCode!: string;
  @ApiProperty({ description: '건당 정액. 요율이 아닙니다' }) amount!: number;
  @ApiProperty({ enum: ['BILLED', 'PAID', 'WAIVED', 'CANCELLED'] }) status!: string;
  @ApiProperty() statusLabel!: string;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional({ nullable: true }) settledAt?: string | null;
}

export class FeatureFlagDto {
  @ApiProperty({ example: 'referral_fee' }) feature!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty() description!: string;
}

@Controller('api/v1')
export class BillingController {
  constructor(private readonly svc: BillingService) {}

  @Get('subscription-plans')
  @ApiOperation({
    summary: '요금제',
    description: '구독 가치는 코드 판매가 아니라 시장 노출입니다 — 슬롯·열람 한도·우선노출.',
  })
  @ApiOkResponse({ type: PlanDto, isArray: true })
  plans() { return this.svc.plans(); }

  @Post('subscriptions')
  @ApiBearerAuth()
  /* v10.37 (D095 · 10/13 대표 지시) — 모든 업무는 개인 회원(본인인증)도 합니다. 사업자만은 안심소개 · 소개몰 · 소개창업 등록뿐 */
  @Roles('MEMBER', 'BIZ_OWNER')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '중복 결제 방어' })
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: '구독 시작 · 변경',
    description:
      '계정당 활성 구독은 1건입니다. 기존 구독이 있으면 플랜만 바꿉니다 — ' +
      '해지 후 재가입으로 처리하면 **미성사 소개코드가 실효됩니다.** ' +
      '**v10.27(G-189) — 유료 구독 중에 다른 요금제를 고르면 예약입니다**(reserved:true · 지금 결제 없음 · ' +
      '다음 결제일에 새 요금제로 청구 · 적용). 올리기 예약은 등록된 카드가 필요합니다(422 BILLING_KEY_REQUIRED). ' +
      '해지 예약 중이면 409 CANCEL_SCHEDULED. 구독이 없거나 무료 · 프로모션 · 연체면 예전처럼 지금 결제하고 오늘부터 시작합니다.',
  })
  @ApiOkResponse({ type: SubscribeResultDto })
  @ApiResponse({
    status: 422, type: ErrorDto,
    description: 'PAYMENT_REQUIRED — 유료 요금제는 결제 승인 후 적용됩니다',
  })
  @Audit('SUBSCRIPTION_CHANGE', 'SUBSCRIPTION')
  subscribe(@Body() dto: SubscribeDto) {
    return this.svc.subscribe(dto.planCode, dto.paymentKey, dto.orderId);
  }

  @Delete('subscriptions/reservation')
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER')
  @ApiOperation({
    summary: '요금제 예약 거두기',
    description: '다음 결제일에 바꾸기로 한 요금제 예약을 지웁니다. 다음 결제일에도 지금 요금제로 이어집니다(G-189).',
  })
  @Audit('SUBSCRIPTION_RESERVE_CANCEL', 'SUBSCRIPTION')
  @ApiOkResponse({ type: ReservationCancelResultDto })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 이용 중인 구독이 없음' })
  cancelReservation() { return this.svc.cancelReservation(); }

  @Post('referral-codes')
  @ApiBearerAuth()
  /* ★ D010 (10/2 「소개코드는 시안대로」) — 일반 회원(MEMBER)도 받습니다.
   *   전에는 BIZ_OWNER + ACTIVE_SUBSCRIPTION 게이트라 일반 회원은 403 이었습니다.
   *   구독이 없으면 서비스가 무료 BASIC 을 열고 발급합니다 — 그래서 게이트를 뗐습니다.
   *   「구독 없는 코드」는 여전히 DB(trg_refcode_inv8)가 막고, 「결제 없는 무료 요금제 초과 코드」는
   *   trg_refcode_extra_paid 가 막습니다. 비로그인은 @Roles 가 막습니다(401 성격의 403 UNAUTHENTICATED). */
  @Roles('MEMBER', 'BIZ_OWNER')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: '소개코드 발급',
    description:
      '유효 구독이 없으면 **무료 BASIC 구독을 열고** 발급합니다(월 0원). 구독 없는 코드는 DB 가 막습니다 (INV-8).\n\n' +
      '**무료(BASIC)** — 본인인증 1명당 월 포함 건수(매월 1일 · 이월 없음 · 같은 CI 계정 합산, 본인인증 전 0건). ' +
      '넘는 수만큼 `건당 extra_code_price` 를 **결제 승인 후에만** 발급합니다: paymentKey · orderId · amount 를 함께 보내십시오' +
      '(키가 없는 환경은 `stub_…` 시험 결제). 결제 정보가 없으면 422 EXTRA_PAYMENT_REQUIRED(details: extraCount · unitPrice · amount · freeRemaining).\n\n' +
      '**유료(STANDARD · PRO)** — 월 포함 수(구독 단위)를 넘으면 무료 요금제와 같이 **결제 승인 후에만** 발급합니다(D011 — 전에는 표시만 하고 청구처가 없었습니다).\n\n' +
      '**매물별(D012 · 운영 설정 `refcode.scope`, 기본 listing)** — listingId 필수 · 한 번에 1건. 게시 중인 남의 매물만, 보험 · 의료(소개 금지 업종) 매물은 안 됩니다. ' +
      '같은 매물에 이미 받은 코드가 있으면 **새로 만들지 않고 그 코드를** 돌려줍니다(`reused:true` — 무료분 · 결제를 쓰지 않음). ' +
      '월 무료분은 「이번 달 새로 받은 매물 코드」 수 기준입니다. `refcode.scope=all` 이면 코드가 매물에 묶이지 않습니다(전 동작).',
  })
  @ApiOkResponse({ type: ReferralCodeDto, isArray: true })
  @ApiResponse({ status: 422, type: ErrorDto,
    description: 'EXTRA_PAYMENT_REQUIRED · AMOUNT_MISMATCH · PAYMENT_FAILED · SUBSCRIPTION_REQUIRED(유료 구독 기간 만료) · ' +
      'LISTING_REQUIRED(scope=listing 인데 매물 없음) · ONE_CODE_PER_LISTING(count≥2) · OWN_LISTING · NO_INTRO_CATEGORY(보험 · 의료)' })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 없는 매물' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PAYMENT_KEY_USED — 이미 발급에 쓴 결제키 · 주문번호 / LISTING_NOT_PUBLISHED — 게시 중이 아닌 매물' })
  @Audit('REFERRAL_CODE_ISSUE', 'REFERRAL_CODE')
  issue(@Body() dto: IssueCodeDto) {
    return this.svc.issueCodes(dto.listingId, dto.count ?? 1,
      { paymentKey: dto.paymentKey, orderId: dto.orderId, amount: dto.amount });
  }

  @Get('me/referral-codes')
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER')   // D010 — 일반 회원도 자기 코드를 봅니다
  @ApiOperation({ summary: '내 소개코드', description: 'touches 는 이 코드로 들어온 유입 수입니다(같은 방문자 · 같은 코드는 24시간에 1번). 매물별 코드는 매물 id · 제목 · 관 코드가 함께 옵니다(D012).' })
  @ApiOkResponse({ type: ReferralCodeDto, isArray: true })
  codes() { return this.svc.codes(); }

  @Get('me/referral-codes/quota')
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER')
  @ApiOperation({
    summary: '이번 달 소개코드 현황',
    description:
      '「소개코드 공유」 버튼이 먼저 봅니다 — 이번 달 받은 코드(current)가 있으면 **새로 발급하지 않고 그 코드를** 보여 주고, ' +
      '포함분(freeRemaining)이 있으면 발급, 다 썼으면(paymentRequired — 모든 요금제) 추가 결제를 안내합니다. ' +
      '구독이 없으면 발급 때 열릴 무료 BASIC 기준입니다(subscribed:false). 조회만 하며 아무것도 만들지 않습니다.\n\n' +
      '**D012** — `refcode.scope=listing`(기본)이면 `?listingId=` 로 부릅니다: current 는 **그 매물의 내 코드**(달과 무관), ' +
      'blocked 는 그 매물에 받을 수 없는 까닭입니다. listingId 없이 부르면 current 는 null 이고 남은 무료분만 옵니다.',
  })
  @ApiOkResponse({ type: RefCodeQuotaDto })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 없는 매물(listingId)' })
  quota(@Query() q: RefCodeQuotaQueryDto) { return this.svc.quota(q.listingId); }

  @Get('me/success-fees')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '내 성사 수수료',
    description:
      '거래가 성사되면 회원 등급에 따라 **건당 정액**으로 청구됩니다. ' +
      '거래 금액을 플랫폼이 보유하지 않으므로 요율제가 아닙니다(INV-11). ' +
      '이것은 소개비가 아니며, 소개비는 당사자끼리 정합니다.',
  })
  @ApiOkResponse({ type: SuccessFeeDto, isArray: true })
  successFees() { return this.svc.successFees(); }

  @Get('features')
  @ApiOperation({
    summary: '기능 스위치',
    description: '소개비·성사 수수료 등 기능의 현재 상태. 화면은 이 값을 읽어 분기합니다.',
  })
  @ApiOkResponse({ type: FeatureFlagDto, isArray: true })
  features() { return this.svc.features(); }

  @Get('me/ledger')
  @ApiBearerAuth()
  /* v10.37 (D095 · 10/13 대표 지시) — 모든 업무는 개인 회원(본인인증)도 합니다. 사업자만은 안심소개 · 소개몰 · 소개창업 등록뿐 */
  @Roles('MEMBER', 'BIZ_OWNER')
  @ApiOperation({
    summary: '원장',
    description:
      '**구독료와 초과 코드 요금만 흐릅니다.** 소개비는 여기 들어오지 않습니다 — ' +
      'entry_type 에 REFERRAL_FEE 가 없고, 그것이 INV-9·11 을 지키는 방식입니다.',
  })
  @ApiOkResponse({ type: LedgerEntryDto, isArray: true })
  ledger(@Query('limit') limit?: number) { return this.svc.ledger(limit ?? 50); }
}
