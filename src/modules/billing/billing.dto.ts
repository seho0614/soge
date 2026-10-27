import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

const PLANS = ['BASIC', 'STANDARD', 'PRO'] as const;

export class PlanDto {
  @ApiProperty({ enum: PLANS }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'v10.124 — 원래(한국어) 이름. 번역된 화면에서도 결제사 주문 이름은 이것으로' }) nameKo!: string;
  @ApiProperty({ description: '월 요금 (원)' }) monthlyPrice!: number;
  @ApiProperty({ description: '포함 소개코드 수' }) includedCodes!: number;
  @ApiProperty({ nullable: true, description: 'null 은 무제한' })
  requestViewsPerMonth!: number | null;
  @ApiProperty({ nullable: true, description: 'null 은 무제한' }) listingSlots!: number | null;
  @ApiProperty({ description: '우선노출 슬롯' }) prioritySlotCount!: number;
  @ApiProperty({ description: '초과 코드 단가 (원). 거래 금액과 무관한 정액입니다' })
  extraCodePrice!: number;
}

export class SubscribeDto {
  @ApiProperty({ enum: PLANS })
  @IsIn(PLANS) planCode!: string;

  @ApiPropertyOptional({
    description: 'PG 결제 승인 키. 무료 플랜은 비웁니다',
  })
  @IsOptional() @IsString() paymentKey?: string;
  /** 토스 결제창이 돌려준 주문번호. 승인 시 금액 대조에 씁니다 */
  @IsOptional() @IsString() orderId?: string;
}

export class SubscribeResultDto {
  @ApiProperty({ format: 'uuid' }) subscriptionId!: string;
  @ApiProperty() planCode!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ format: 'date-time' }) currentPeriodEnd!: string;
  @ApiProperty({ description: '프로모션 적용 여부' }) isPromo!: boolean;
  @ApiPropertyOptional({ description: 'G-189 — 요금제 예약이면 true(지금 결제 없음 · effectiveAt 부터 적용)' }) reserved?: boolean;
  @ApiPropertyOptional({ nullable: true, description: '예약한 요금제' }) nextPlanCode?: string | null;
  @ApiPropertyOptional({ format: 'date-time', description: '예약 요금제가 적용되는 때(다음 결제일)' }) effectiveAt?: string;
}

export class IssueCodeDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: '소개할 매물. 운영 설정 refcode.scope=listing(기본)이면 **필수**입니다(없으면 422 LISTING_REQUIRED) — ' +
      '코드는 그 매물에 묶이고, 같은 매물에 이미 받은 코드가 있으면 그 코드를 돌려줍니다(reused). scope=all 이면 받기만 하고 저장하지 않습니다',
  })
  @IsOptional() @IsUUID('all', { message: 'listingId 는 uuid 여야 합니다.' }) listingId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 10, default: 1, description: 'refcode.scope=listing 이면 1 만 됩니다(매물마다 1건 — 2 이상은 422 ONE_CODE_PER_LISTING)' })
  @IsOptional() @IsInt() @Min(1) @Max(10) count?: number;

  /* ── D010 — 무료 요금제의 추가 코드 결제 (무료분을 넘을 때만 씁니다) ── */
  @ApiPropertyOptional({
    description: '추가 소개코드 결제 승인 키(토스 결제창이 돌려준 값). 키가 없는 환경은 `stub_` 로 시작하는 시험 결제 키. ' +
      '무료분 안에서는 비웁니다. 한 번 쓴 키는 다시 쓸 수 없습니다(409 PAYMENT_KEY_USED)',
    example: 'stub_6f1c2d3e',
  })
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,200}$/, { message: '결제 키 형식이 올바르지 않습니다.' })
  paymentKey?: string;

  @ApiPropertyOptional({ description: '결제창 주문번호(영문·숫자·-·_ 6~64자). 비우면 서버가 만듭니다', example: 'rcx-1a2b3c4d' })
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{6,64}$/, { message: '주문번호 형식이 올바르지 않습니다.' })
  orderId?: string;

  @ApiPropertyOptional({ description: '결제 금액(원). 보내면 서버 계산(초과 건수 × 단가)과 대조합니다 — 다르면 422 AMOUNT_MISMATCH', example: 30000 })
  @IsOptional() @IsInt() @Min(1) amount?: number;
}

export class ReferralCodeDto {
  @ApiProperty({ example: 'A3K9QZ' }) code!: string;
  @ApiProperty({ nullable: true, format: 'uuid', description: '이 코드가 소개하는 매물(D012). null = 옛 코드 · scope=all 로 받은 코드 — 모든 매물에 통합니다' })
  listingId!: string | null;
  @ApiPropertyOptional({ nullable: true, description: '매물 제목 (내 소개코드 목록)' }) listingTitle?: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'MAL', description: '매물의 관 코드 — 화면이 공유 링크 경로를 만듭니다: {사이트}/{관 경로}/{매물}?ref=코드' })
  gwanCode?: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'PUBLISHED', description: '매물 상태 (내 소개코드 목록)' }) listingStatus?: string | null;
  @ApiPropertyOptional({ description: '발급 응답 전용 — 그 매물에 이미 받은 코드를 그대로 돌려줌(새로 만들지 않음 · 무료분 · 결제 소모 없음)' })
  reused?: boolean;
  @ApiProperty({ description: '포함 건수를 넘은 추가 코드' }) isExtra!: boolean;
  @ApiProperty({ format: 'date-time' }) issuedAt!: string;
  @ApiPropertyOptional({ nullable: true, format: 'date-time', description: '구독 해지 시 실효' })
  revokedAt?: string | null;
  @ApiPropertyOptional({ nullable: true, description: '추가 코드 결제 금액(건당, 원). 결제 없이 표시만 된 초과(유료 요금제)는 null' })
  extraAmount?: number | null;
  @ApiPropertyOptional({ description: '결제로 받은 추가 코드인가' }) paid?: boolean;
  @ApiPropertyOptional({ nullable: true, description: '시험 결제(스텁)로 받은 코드 — 실제 돈이 오가지 않음' })
  paymentStub?: boolean | null;
  @ApiPropertyOptional({ description: '이번 달(한국 시각) 받은 코드' }) thisMonth?: boolean;
  @ApiPropertyOptional({ description: '이 코드로 들어온 유입(같은 방문자는 24시간에 1번). 어느 화면으로 들어왔든 셉니다 — 소개자 판정은 그 매물 거래에서만 됩니다' })
  touches?: number;
}

export class RefCodeCurrentDto {
  @ApiProperty({ example: 'A3K9QZ' }) code!: string;
  @ApiProperty() isExtra!: boolean;
  @ApiProperty({ format: 'date-time' }) issuedAt!: string;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) listingId?: string | null;
}

export class RefCodeQuotaQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: '매물 — refcode.scope=listing 일 때 그 매물의 내 코드(current)와 발급 가능 여부(blocked)를 봅니다' })
  @IsOptional() @IsUUID('all', { message: 'listingId 는 uuid 여야 합니다.' }) listingId?: string;
}

export class RefCodeListingDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ example: 'MAL' }) gwanCode!: string;
}

export class RefCodeQuotaDto {
  @ApiProperty({ enum: ['listing', 'all'], description: '운영 설정 refcode.scope — listing: 매물마다 코드가 따로 · all: 매물에 묶지 않음' }) scope!: string;
  @ApiProperty({ description: '유효 구독이 있는가. 없으면 아래 값은 발급 때 열릴 무료 BASIC 기준' }) subscribed!: boolean;
  @ApiProperty({ enum: PLANS }) planCode!: string;
  @ApiProperty() planName!: string;
  @ApiProperty({ description: '무료 요금제(월 0원) — 추가분은 결제 후 발급' }) freePlan!: boolean;
  @ApiProperty({ description: '월 포함(무료) 건수' }) includedCodes!: number;
  @ApiProperty({ description: '이번 달 쓴 무료분 (BASIC 은 같은 본인인증(CI) 계정 합산)' }) usedThisMonth!: number;
  @ApiProperty({ description: '이번 달 남은 무료분 — 본인인증 전이면 0' }) freeRemaining!: number;
  @ApiProperty({ description: '추가 1건 단가(원)' }) extraCodePrice!: number;
  @ApiProperty() identityVerified!: boolean;
  @ApiProperty({ enum: ['CI', 'ACCOUNT', 'SUBSCRIPTION', 'NONE'], description: '무료분을 세는 단위 — CI(본인인증 1명) · ACCOUNT(스텁 인증) · SUBSCRIPTION(유료) · NONE(본인인증 전)' })
  countScope!: string;
  @ApiPropertyOptional({ type: RefCodeCurrentDto, nullable: true,
    description: '화면이 새로 발급하지 않고 다시 보여 줄 코드. scope=listing: **그 매물의 내 코드**(달과 무관 · listingId 없이 부르면 null) · scope=all: 이번 달 받은 코드 중 가장 최근' })
  current!: RefCodeCurrentDto | null;
  @ApiPropertyOptional({ type: RefCodeListingDto, nullable: true, description: 'listingId 로 부른 매물(게시 중일 때만)' })
  listing!: RefCodeListingDto | null;
  @ApiPropertyOptional({ nullable: true, enum: ['LISTING_NOT_PUBLISHED', 'OWN_LISTING', 'NO_INTRO_CATEGORY'],
    description: '그 매물에 소개코드를 받을 수 없는 까닭 — 게시 중 아님 · 본인 매물 · 소개 금지 업종(보험 · 의료). 받을 수 있으면 null' })
  blocked!: string | null;
  @ApiProperty({ description: '이번 달 포함 건수를 다 써서 추가는 결제가 필요함 (모든 요금제 — D011)' }) paymentRequired!: boolean;
  @ApiProperty({ description: '결제 키가 없는 환경 — 시험 결제(stub_…)로 진행' }) paymentStub!: boolean;
}

export class LedgerEntryDto {
  @ApiProperty() id!: number;
  @ApiProperty({ enum: ['SUBSCRIPTION','EXTRA_CODE','LEAD_VIEW','TOPUP','REFUND','ADJUST'] })
  entryType!: string;
  @ApiProperty({ enum: ['DEBIT','CREDIT'] }) direction!: string;
  @ApiProperty() amount!: number;
  @ApiProperty({ description: '기록 시점 잔액' }) balanceAfter!: number;
  @ApiProperty({ nullable: true }) memo!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

/* v10.27 (G-189) 요금제 예약 거두기 결과 */
export class ReservationCancelResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ format: 'uuid' }) subscriptionId!: string;
  @ApiProperty({ description: '이어지는 지금 요금제' }) planCode!: string;
  @ApiProperty() note!: string;
}
