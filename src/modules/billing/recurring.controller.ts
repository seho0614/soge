import { Body, Controller, Delete, Get, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { RecurringBillingService } from './recurring.service';
import { RecurringRefundService } from './recurring-refund.service';
import { PayoutAccountService } from './payout-account.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

export class RefundRequestDto {
  @ApiPropertyOptional({ description: '환불 사유. 새로 신청할 때는 **비워 둘 수 없습니다**(DB 가 강제합니다). 진행 중인 환불의 결과를 다시 확인할 때는 없어도 됩니다' })
  @IsOptional() @IsString()
  reason?: string;
}

export class RefundEligibleDto {
  @ApiProperty({ description: '환불 가능한가' }) eligible!: boolean;
  @ApiProperty({ description: '가능·불가 이유. 화면에 그대로 보여 주십시오' }) reason!: string;
  @ApiPropertyOptional({ description: '결제일' }) paidOn?: string;
  @ApiPropertyOptional({ description: '이번 기간에 쓴 열람 수' }) used?: number;
}

export class RefundResultDto {
  @ApiProperty({ format: 'uuid', description: '환불 요청 번호' }) refundId!: string;
  @ApiProperty({ enum: ['SUCCEEDED', 'UNKNOWN', 'PROCESSING', 'REQUESTED', 'FAILED'],
    description: 'SUCCEEDED 결제사 취소 확인(환불 완료) · UNKNOWN/PROCESSING/REQUESTED 결과 확인 중 · FAILED 결제사 거절' })
  state!: string;
  @ApiProperty({ enum: ['환불 완료', '환불 결과 확인 중', '환불 실패'], description: '화면에 그대로 보여 주십시오' }) label!: string;
  @ApiProperty({ example: 49000 }) amount!: number;
  @ApiProperty() requestedAt!: string;
  @ApiPropertyOptional({ nullable: true, description: '환불 완료 시각 — 결제사 취소를 확인한 때. 완료 전에는 null' }) refundedAt?: string | null;
  @ApiPropertyOptional({ description: '연동 전(스텁)이면 true — 실제 환불이 아닙니다' }) stub?: boolean;
  @ApiProperty() note!: string;
}

export class CancelResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: '이 날짜까지 이용할 수 있습니다' }) periodEnd!: string;
  @ApiProperty({ description: '해지한 시각' }) cancelAt!: string;
  @ApiProperty({ example: true }) cancelled!: boolean;
  @ApiProperty({ description: '이미 해지한 구독이었는가 — 그때의 결과를 그대로 돌려줍니다' }) alreadyCancelled!: boolean;
  @ApiProperty({ description: '해지 전에 시작되어 결제사에서 진행 중인 청구가 있는가 — 그 청구는 되돌릴 수 없습니다(승인되면 한 기간 연장)' }) chargeInFlight!: boolean;
  @ApiProperty() note!: string;
}

export class BillingReviewDto {
  @ApiProperty({ type: 'array', items: { type: 'object' }, description: '결제사 결과를 아직 확정하지 못한 청구(PENDING)' }) pendingInvoices!: unknown[];
  @ApiProperty({ type: 'array', items: { type: 'object' }, description: '끝나지 않은 구독 환불' }) openRefunds!: unknown[];
  @ApiProperty({ type: 'array', items: { type: 'object' }, description: '끝나지 않았거나 결제 결과가 불명확한 요청(구독 시작 · 소개코드 발급)' }) openRequests!: unknown[];
  @ApiProperty() note!: string;
}

export class BillingKeyDto {
  @ApiProperty({ description: '결제창이 돌려준 authKey. 카드번호가 아닙니다' })
  @IsString() authKey!: string;
}

export class PolicyValueDto {
  @ApiProperty({ description: '유예 1~30일 · 재시도 1~24회', example: '7' })
  @IsString() value!: string;
}

export class CancelDto {
  @ApiPropertyOptional({ description: '해지 사유 (선택)' })
  @IsOptional() @IsString() reason?: string;
}

/**
 * SB-MYP-SUB-010 구독 관리 · 결제 수단
 *
 * 자동 청구의 규칙은 하나로 요약됩니다 —
 * **해지하면 청구하지 않고, 해지하지 않으면 자동 청구합니다.**
 */

export class BillingKeyResultDto {
  @ApiPropertyOptional({ example: '신한' }) cardCompany?: string;
  @ApiPropertyOptional({ example: '4821', description: '뒤 4자리만 — 카드번호는 저장하지 않습니다' })
  cardLast4?: string;
  @ApiPropertyOptional() registeredAt?: string;
  @ApiPropertyOptional() note?: string;
}
export class BillingOkDto {
  @ApiPropertyOptional() removed?: boolean;
  @ApiPropertyOptional({ description: '유료 구독이 유지 중이면 경고가 옵니다' }) warning?: string;
}


export class SubscriptionDetailDto {
  @ApiPropertyOptional() planCode?: string;
  @ApiPropertyOptional() status?: string;
  @ApiPropertyOptional({ description: '해지 예약이면 이 날짜까지 이용하실 수 있습니다' })
  periodEnd?: string;
  @ApiPropertyOptional() cancelAtPeriodEnd?: boolean;
  @ApiPropertyOptional({ description: '정기결제 결과를 결제사에서 확인하는 중인가' }) chargeInFlight?: boolean;
  @ApiPropertyOptional({ type: RefundResultDto, description: '가장 최근 환불 요청의 상태 — 환불 완료 · 환불 결과 확인 중 · 환불 실패. 구독이 환불로 끝난 뒤에도 나옵니다' })
  refund?: RefundResultDto;
  @ApiPropertyOptional({ nullable: true, description: '지금 알아야 할 것(해지됨 · 결제 실패 · 결과 확인 중 …)' }) notice?: string | null;
}
export class InvoiceListDto {
  @ApiProperty({ type: 'array', items: { type: 'object' } }) invoices!: unknown[];
}

export class PayoutAccountDto {
  @ApiProperty({ description: '은행 코드 3자리. 예) 004 국민' }) @IsString() bankCode!: string;
  @ApiProperty({ description: '은행명' }) @IsString() bankName!: string;
  @ApiProperty({ description: '계좌번호. 하이픈 있어도 됩니다' }) @IsString() accountNo!: string;
  @ApiProperty({ description: '예금주' }) @IsString() holderName!: string;
}

@ApiTags('MY')
@ApiBearerAuth()
@Controller('api/v1/me')
/* ★ /me/** 는 **본인 것만** 보이는 자리입니다.
 *   표시가 없으면 토큰 없이도 200 이 나가고, 나중에 그 안에
 *   개인정보를 담는 순간 조용히 샙니다.
 *   역할이 아니라 **로그인 여부**만 봅니다 — 특정 역할을 요구하면
 *   사업자가 못 들어가는 곳이 생깁니다. */
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'SUPER')
export class RecurringController {
  constructor(
    private readonly svc: RecurringBillingService,
    private readonly refunds: RecurringRefundService,     // v10.45 — 구독 환불
    private readonly payout: PayoutAccountService,        // v10.45 — 정산 계좌 · 1원 인증
  ) {}

  @Get('subscription/detail')
  @ApiOperation({
    summary: '내 구독 상세',
    description:
      '다음 청구일과 자동 갱신 여부를 함께 냅니다. ' +
      '해지 예약됐거나 결제 수단이 없으면 그 사실을 `notice` 로 알립니다. ' +
      '환불을 신청했으면 `refund` 에 상태(환불 완료 · 환불 결과 확인 중 · 환불 실패)가 나옵니다.',
  })
  @ApiOkResponse({ type: SubscriptionDetailDto })
  detail() { return this.svc.mySubscription(); }

  @Post('subscription/cancel')
  @ApiOperation({
    summary: '구독 해지',
    description:
      '**즉시 끊지 않습니다.** 이미 낸 기간은 그대로 쓸 수 있고, ' +
      '기간이 끝나면 만료됩니다. 그 이후로는 청구되지 않습니다.\n\n' +
      '**결제 실패(PAST_DUE) 상태에서도 해지할 수 있습니다** — 재시도 청구가 멈춥니다. ' +
      '이미 해지한 구독이면 오류가 아니라 그때의 결과를 돌려줍니다(`alreadyCancelled`). ' +
      '해지 전에 시작되어 결제사에서 진행 중인 청구가 있으면 `chargeInFlight` 로 알립니다.',
  })
  @ApiResponse({ status: 201, type: CancelResultDto })
  @ApiResponse({ status: 409, description: 'NOT_CANCELLABLE — 이용 중인 구독이 없음', type: ErrorDto })
  @Audit('SUBSCRIPTION_CANCEL', 'SUBSCRIPTION')
  cancel(@Body() dto: CancelDto) { return this.svc.cancel(dto?.reason); }

  @Get('subscription/refund-eligible')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '환불 가능 여부',
    description:
      '**환불은 결제 당일에만 가능합니다.** 구독을 켜면 그 순간부터 ' +
      '리드를 열람할 수 있어, 하루만 써도 남의 연락처를 다 보고 ' +
      '환불받는 일이 생깁니다.\n\n' +
      '당일이어도 **한 건이라도 열람하셨으면 환불되지 않습니다** — ' +
      '열람한 연락처는 되돌릴 수 없습니다.',
  })
  @ApiOkResponse({ type: RefundEligibleDto })
  refundEligible() { return this.refunds.refundEligible(); }

  @Post('subscription/refund')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '구독 환불',
    description:
      '결제 당일 · 미이용에 한합니다. 조건은 **DB 가 집행**하므로 ' +
      '앱을 고쳐도 우회되지 않습니다.\n\n' +
      '**결제사가 결제 취소를 확인한 뒤에만 「환불 완료」입니다.**\n' +
      '- `201` 환불 완료 — 결제사 취소 확인 · 구독 종료\n' +
      '- `202` 환불 결과 확인 중 — 결제사 답을 받지 못함. 다시 요청하거나 기다리면(배치) 결제사에 조회해 닫습니다. **다시 눌러도 취소는 한 번만 나갑니다**\n' +
      '- `422 REFUND_FAILED` 환불 실패 — 결제사가 거절. 구독 · 결제는 그대로\n' +
      '- `422 REFUND_NOT_ELIGIBLE` 당일이 아님 · 이미 이용\n\n' +
      '진행 중인 환불(확인 중)이 있으면 새로 접수하지 않고 **그 요청의 결과를 다시 확인**합니다 — 이때 `reason` 은 없어도 됩니다.',
  })
  @ApiResponse({ status: 201, description: '환불 완료', type: RefundResultDto })
  @ApiResponse({ status: 202, description: '환불 결과 확인 중', type: RefundResultDto })
  @ApiResponse({ status: 409, description: 'NO_SUBSCRIPTION', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'REFUND_NOT_ELIGIBLE(당일 아님 · 이미 이용) · REFUND_FAILED(결제사 거절) · REFUND_REASON_REQUIRED', type: ErrorDto })
  @Audit('SUBSCRIPTION_REFUND', 'SUBSCRIPTION')
  async refund(@Body() dto: RefundRequestDto, @Res({ passthrough: true }) res: Response) {
    const out = await this.refunds.refund(dto.reason);
    /* 완료가 아니면 202 — 「접수는 됐고 결과는 아직」 */
    if (out.state !== 'SUCCEEDED') res.status(202);
    return out;
  }

  @Post('subscription/resume')
  @ApiOperation({ summary: '해지 철회', description: '기간이 남아 있으면 자동 갱신으로 돌아갑니다.' })
  @ApiResponse({ status: 409, description: 'NOT_RESUMABLE', type: ErrorDto })
  @Audit('SUBSCRIPTION_RESUME', 'SUBSCRIPTION')
  resume() { return this.svc.resume(); }

  @Get('subscription/invoices')
  @ApiOperation({ summary: '청구 내역', description: '실패 건은 사유와 시도 횟수를 함께 냅니다.' })
  @ApiOkResponse({ type: InvoiceListDto })
  invoices() { return this.svc.invoices(); }

  @Get('billing-key')
  @ApiOperation({
    summary: '등록된 결제 수단',
    description: '카드사와 마지막 4자리만 냅니다. **빌링키는 응답에 담지 않습니다.**',
  })
  @ApiOkResponse({ type: BillingKeyResultDto })
  billingKey() { return this.svc.myBillingKey(); }

  @Post('billing-key')
  @ApiOperation({
    summary: '결제 수단 등록',
    description:
      '결제창이 돌려준 `authKey` 로 빌링키를 발급받습니다. ' +
      '**카드번호는 우리 서버에 들어오지 않습니다** — 결제창이 직접 받습니다. ' +
      '계정당 활성 결제수단은 하나이며, 새로 등록하면 이전 것이 내려갑니다.',
  })
  @ApiResponse({ status: 422, description: 'BILLING_KEY_FAILED', type: ErrorDto })
  @Audit('BILLING_KEY_REGISTER', 'BILLING')
  register(@Body() dto: BillingKeyDto) { return this.svc.registerBillingKey(dto.authKey); }

  @Delete('billing-key')
  @ApiOperation({
    summary: '결제 수단 삭제',
    description: '유료 구독이 유지 중이면 다음 갱신이 실패한다는 경고를 함께 냅니다.',
  })
  @Audit('BILLING_KEY_REMOVE', 'BILLING')
  @ApiOkResponse({ type: BillingOkDto })
  remove() { return this.svc.removeBillingKey(); }
  /* ── 정산 계좌 · 1원 인증 ──────────────────────────────────────── */

  @Get('payout-accounts')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '정산 계좌',
    description: '**인증된 계좌로만 지급됩니다.** 인증 전 계좌도 목록에는 보입니다.',
  })
  @ApiOkResponse({ type: Object, isArray: true })
  payoutAccounts() { return this.payout.payoutAccounts(); }

  @Post('payout-accounts')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '정산 계좌 등록 · 1원 보내기',
    description:
      '1원을 보내고 **입금자명에 찍힌 코드**를 확인하시면 인증됩니다.\n\n' +
      '계좌번호는 손으로 치는 것이라 한 자리만 틀려도 남의 계좌로 갑니다 — ' +
      '예금주 이름만 대조하면 동명이인이 걸립니다.',
  })
  @ApiResponse({ status: 422, description: 'PAYOUT · 형식 오류 등', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('PAYOUT_ACCOUNT_ADD', 'PAYOUT_ACCOUNT')
  addPayoutAccount(@Body() dto: PayoutAccountDto) { return this.payout.addPayoutAccount(dto); }

  @Post('payout-accounts/:id/verify')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '1원 인증 확인',
    description:
      '**다섯 번 틀리면 막힙니다.** 남의 계좌를 찍어 보는 것을 막기 위해서입니다 — ' +
      '막히시면 고객센터로 연락 주십시오.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 422, description: '코드 불일치 · 시도 초과', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('PAYOUT_ACCOUNT_VERIFY', 'PAYOUT_ACCOUNT')
  verifyPayoutAccount(@Param('id') id: string, @Body() dto: { code: string }) {
    return this.payout.verifyPayoutAccount(id, dto.code);
  }

}

/** 운영 — 청구 현황 */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/billing')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class BillingAdminController {
  constructor(private readonly svc: RecurringBillingService) {}

  @Get('overdue')
  @ApiOperation({
    summary: '청구 실패 구독',
    description:
      '즉시 끊지 않고 유예 기간(7일)을 둡니다. ' +
      '카드 한도 초과 한 번으로 서비스가 끊기면 이용자가 잃는 것이 더 큽니다.',
  })
  overdue() { return this.svc.overdue(); }

  @Get('policy')
  @ApiOperation({
    summary: '청구 정책',
    description:
      '유예 일수와 재시도 횟수입니다. **코드가 아니라 설정에 있습니다** — 배포 없이 바뀝니다. ' +
      '저장된 값(`stored`)과 실제 동작에 쓰이는 값(`effective`)을 나란히 냅니다. ' +
      '둘이 다르면 설정이 먹지 않은 것입니다.',
  })
  policy() { return this.svc.policy(); }

  @Patch('policy/:key')
  @ApiOperation({
    summary: '청구 정책 변경',
    description:
      '유예 1~30일 · 재시도 1~24회. 범위 밖 값은 DB 가 거부합니다. ' +
      '즉시 반영되며 배포가 필요 없습니다.',
  })
  @ApiParam({ name: 'key', example: 'billing.grace_days' })
  @ApiResponse({ status: 422, description: 'SETTING — 형식 위반', type: ErrorDto })
  @Audit('BILLING_POLICY_UPDATE', 'SETTING')
  updatePolicy(@Param('key') key: string, @Body() dto: PolicyValueDto) {
    return this.svc.updatePolicy(key, dto.value);
  }

  @Get('notice-missing')
  @ApiOperation({
    summary: '안내 미도달 구독',
    description:
      '청구가 실패했는데 안내가 나가지 않은 구독입니다. ' +
      '**비어 있어야 정상입니다** — 비어 있지 않으면 이용자가 모른 채 만료로 갑니다.',
  })
  noticeMissing() { return this.svc.noticeMissing(); }

  @Get('attempts-today')
  @ApiOperation({
    summary: '오늘 청구 시도 현황',
    description:
      '한도(기본 10회/일)에 걸려 밀린 건이 보입니다. ' +
      '카드 만료처럼 재시도해도 결과가 같은 실패는 하루 1회로 줄어듭니다 — ' +
      '같은 카드에 승인 요청을 반복하면 카드사 이상거래 탐지에 걸립니다.',
  })
  attempts() { return this.svc.attemptsToday(); }

  @Post('charge-due')
  @ApiOperation({
    summary: '자동 청구 즉시 실행',
    description:
      '평소에는 스케줄러가 돕니다. 이 경로는 수동 확인용입니다. ' +
      '**같은 기간을 두 번 청구하지 않습니다** — DB 유일 제약이 막습니다.\n\n' +
      '순서: 끝나지 않은 환불 대조 → 결과 불명확 청구 대조(주문번호로 결제사 조회) → 해지한 결제 실패 구독 만료 → 새 청구. ' +
      '결제사 답을 받지 못한 청구는 실패로 적지 않고 `pending` 으로 남깁니다.',
  })
  @Audit('BILLING_CHARGE_RUN', 'BILLING')
  run() { return this.svc.chargeDue(); }

  @Post('reconcile')
  @ApiOperation({ summary: '지금 대조(새 청구 없음)', description: 'v10.31 — 끝나지 않은 환불 · 결과 불명확 청구만 결제사에 물어 닫습니다. 새 청구는 보내지 않습니다.' })
  @Audit('BILLING_RECONCILE', 'BILLING')
  reconcile() { return this.svc.reconcileNow(); }

  @Get('review')
  @ApiOperation({
    summary: '확인이 필요한 청구 · 환불 · 요청',
    description:
      '결제사 결과를 아직 확정하지 못한 청구(PENDING) · 끝나지 않은 구독 환불 · 끝나지 않았거나 결제 결과가 불명확한 요청입니다. ' +
      '**비어 있어야 정상입니다.** 배치가 결제사에 조회해 닫으며, 금액 불일치(`AMOUNT_MISMATCH`)처럼 자동으로 닫지 않는 것은 사람이 봐야 합니다.',
  })
  @ApiOkResponse({ type: BillingReviewDto })
  review() { return this.svc.review(); }

}
