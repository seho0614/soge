import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MyListingDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ example: '노출 중' }) statusLabel!: string;
  @ApiProperty({ nullable: true }) desiredFee!: number | null;
  @ApiProperty({ description: '수정 시 함께 보냅니다 (낙관적 잠금)' }) version!: number;
  @ApiProperty({ nullable: true, format: 'date-time' }) publishedAt!: string | null;
  @ApiProperty({ nullable: true, description: '검수 상태' }) reviewStatus!: string | null;
  @ApiProperty({ nullable: true, description: '반려 사유. 재제출 동선의 근거입니다' })
  rejectReasonLabel!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time', description: 'SLA 24h' })
  slaDueAt!: string | null;
}

export class MyDealDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true }) title!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty() statusLabel!: string;
  @ApiProperty({ nullable: true }) agreedFee!: number | null;
  @ApiProperty({ enum: ['BUYER','SELLER','INTRODUCER'], description: '이 거래에서 내 역할' })
  myPart!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ nullable: true, format: 'date-time' }) confirmedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) attributedCode?: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) listingId?: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) conversationId?: string | null;
  @ApiPropertyOptional({ description: '내가 성사 확정을 눌렀는지' }) iConfirmed?: boolean;
  @ApiPropertyOptional({ description: '대금 지급 신고가 있는지' }) paymentReported?: boolean;
  @ApiPropertyOptional({ description: '내가 후기를 썼는지' }) iReviewed?: boolean;
}

export class MySettlementDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) dealId!: string;
  @ApiProperty({ description: '공제 없이 소개비 전액입니다 (INV-9)' }) amount!: number;
  @ApiProperty() status!: string;
  @ApiProperty() statusLabel!: string;
  @ApiProperty({ format: 'date-time' }) requestedAt!: string;
  @ApiProperty({ nullable: true, format: 'date-time' }) paidAt!: string | null;
  @ApiPropertyOptional({ description: '분쟁으로 보류된 경우' }) heldByDispute?: boolean;
  @ApiProperty({ enum: ['BUSINESS', 'PERSON'], description: 'v10.28 — 사업자로 받음 · 개인으로 받음(INV-10R)' }) payee!: string;
}

/** v10.28 — 받을 소개비(정산 줄이 아직 없는 성사 거래) */
export class MySettlementDueDto {
  @ApiProperty({ format: 'uuid' }) dealId!: string;
  @ApiProperty({ description: '약정한 소개비(INV-9)' }) amount!: number;
  @ApiProperty({ nullable: true, format: 'date-time' }) confirmedAt!: string | null;
  @ApiProperty({ nullable: true }) title!: string | null;
}

export class MyInquiryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() category!: string;
  @ApiProperty() title!: string;
  @ApiProperty() status!: string;
  @ApiProperty() statusLabel!: string;
  @ApiProperty({ nullable: true }) answer!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class NotificationDto {
  @ApiProperty() id!: number;
  @ApiProperty() eventCode!: string;
  @ApiProperty({ nullable: true }) title!: string | null;
  @ApiProperty() body!: string;
  @ApiProperty({ nullable: true }) linkUrl!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) readAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class MySubscriptionDto {
  @ApiProperty({ nullable: true }) planCode!: string | null;
  @ApiProperty({ nullable: true }) planName!: string | null;
  @ApiProperty({ nullable: true }) status!: string | null;
  @ApiProperty({ nullable: true }) statusLabel!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) currentPeriodEnd!: string | null;
  @ApiProperty({ description: '발급한 소개코드 수' }) codesIssued!: number;
  @ApiProperty({ nullable: true, description: '포함 코드 수. null 은 무제한' })
  includedCodes!: number | null;
  @ApiProperty({ description: '이번 주기 요청 열람 사용' }) requestViewsUsed!: number;
  @ApiProperty({ nullable: true }) requestViewsPerMonth!: number | null;
  @ApiProperty({ description: '노출 중인 리스팅' }) publishedListings!: number;
  @ApiProperty({ nullable: true }) listingSlots!: number | null;
  @ApiProperty({ description: '프로모션 여부' }) isPromo!: boolean;
  @ApiProperty({ nullable: true, format: 'date-time' }) promoEndsAt!: string | null;
}

export class MyDisputeDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) dealId!: string;
  @ApiProperty() reasonCode!: string;
  @ApiProperty({ description: 'v10.32 — 유형 글자(code_labels dispute.reason)' }) reasonLabel!: string;
  @ApiProperty({ nullable: true, description: 'v10.32 — 거래 이름(매물 · 요청 제목)' }) dealTitle!: string | null;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty() statusLabel!: string;
  @ApiProperty({ nullable: true, description: '처리 결과' }) resolution!: string | null;
  @ApiProperty({ format: 'date-time' }) openedAt!: string;
  @ApiProperty({ nullable: true, format: 'date-time' }) closedAt!: string | null;
  @ApiProperty({ description: 'v10.32 — 접수 때 붙인 증빙 수' }) evidenceCount!: number;
}

export class MarkReadResultDto {
  @ApiProperty({ example: 3, description: '읽음 처리된 알림 수' }) updated!: number;
}

export class ContractListDto {
  @ApiProperty() dealId!: string;
  @ApiProperty() contractId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() counterpart!: string;
  @ApiProperty() state!: string;
  @ApiProperty() stateLabel!: string;
  @ApiProperty() buyerAgreed!: boolean;
  @ApiProperty() sellerAgreed!: boolean;
  @ApiProperty() buyerSigned!: boolean;
  @ApiProperty() sellerSigned!: boolean;
  @ApiPropertyOptional() fee?: number | null;
  @ApiProperty({ description: '3일 넘게 멈춤' }) stalled!: boolean;
  @ApiProperty() updatedAt!: string;
}

/* ── 프로필 수정 ────────────────────────────────────────────────
 *
 * ★ 이메일은 여기 없습니다. **로그인 수단**이라 바꾸면 계정을
 *   잃을 수 있습니다 — 별도 절차로 합니다. */
export class UpdateProfileDto {
  @ApiProperty({ example: '김도현', description: '이름' })
  @IsString() @Length(2, 40)
  name!: string;

  @ApiPropertyOptional({ example: '010-1234-5678', description: '연락처' })
  @IsOptional() @IsString() @Matches(/^0\d{1,2}-?\d{3,4}-?\d{4}$/, {
    message: '연락처 형식이 맞지 않습니다.',
  })
  phone?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      '누적수익(정산받은 소개비 합계)을 내 매물 상세의 「소개자 실적」에 공개할지. ' +
      '기본은 꺼짐이고, 보내지 않으면 지금 설정을 그대로 둡니다 (v10.21 · D023).',
  })
  /* ★ 받은 값 그대로 봅니다. 전역 설정(enableImplicitConversion)은 문자열을 불리언으로 바꾸는데,
   *   그러면 "false" · "no" 같은 **비어 있지 않은 문자열이 전부 true** 가 됩니다.
   *   공개 설정이 그렇게 켜지면 안 되므로, 참 · 거짓이 아닌 값은 400 으로 돌려보냅니다. */
  @IsOptional() @StrictBoolean()
  earningsPublic?: boolean;
}

/* ── 사업자 정보 수정 ──────────────────────────────────────────
 *
 * ★ 사업자등록번호는 여기 없습니다. 그것을 바꾸는 것은 **다른
 *   사업자가 되는 것**이라, 고치는 게 아니라 다시 등록해야 합니다. */
export class UpdateBusinessDto {
  @ApiPropertyOptional({ example: '운양푸드', description: '상호' })
  @IsOptional() @IsString() @Length(1, 60)
  companyName?: string;

  @ApiPropertyOptional({ example: '이사장', description: '대표자' })
  @IsOptional() @IsString() @Length(1, 40)
  ceoName?: string;

  @ApiPropertyOptional({ example: '도소매', description: '업태' })
  @IsOptional() @IsString() @Length(1, 60)
  bizType?: string;

  @ApiPropertyOptional({ example: '식자재', description: '종목' })
  @IsOptional() @IsString() @Length(1, 60)
  bizItem?: string;

  @ApiPropertyOptional({ example: '경기 김포시 운양동 ***', description: '주소' })
  @IsOptional() @IsString() @Length(1, 200)
  address?: string;
}

/* ── v10.27 (G-195) 나의공간 첫 화면 요약 ─────────────────────── */
export class MyHomeDto {
  @ApiProperty({ nullable: true }) name!: string | null;
  @ApiProperty({ format: 'date-time', description: '가입일' }) since!: string;
  @ApiProperty({ nullable: true, format: 'date-time' }) identityVerifiedAt!: string | null;
  @ApiProperty({ nullable: true }) companyName!: string | null;
  @ApiProperty({ nullable: true }) bizRegNo!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) businessVerifiedAt!: string | null;
  @ApiProperty({ description: '진행 중인 거래' }) openDeals!: number;
  @ApiProperty({ description: '확정 · 정산된 거래' }) closedDeals!: number;
  @ApiProperty() allDeals!: number;
  @ApiProperty({ description: '정산 대기(신청 · 보류)' }) settlePending!: number;
  @ApiProperty({ description: '받은 소개비 합계(지급 완료)' }) earned!: number;
  @ApiProperty() listings!: number;
  @ApiProperty({ description: '이행 전 계약' }) contracts!: number;
  @ApiProperty() conversations!: number;
  @ApiProperty() unreadMessages!: number;
  @ApiProperty() favorites!: number;
  @ApiProperty() unreadNotifications!: number;
  @ApiProperty({ nullable: true }) planCode!: string | null;
  @ApiProperty({ nullable: true }) planName!: string | null;
  @ApiProperty({ nullable: true, description: '거래신용(소개 신뢰도 0~99 · 인증 · 초대 동의율 · 성사 · 거래 후기 · 인정된 신고) — v10.31' }) trustScore!: number | null;
  @ApiProperty({ nullable: true, description: '화면 표기 「거래신용 812」 = trustScore ×10 정수' }) trustCredit!: number | null;
  @ApiProperty({ description: '거래신용 표본(초대 · 연결 · 성사 · 후기 수) — 적으면 점수가 덜 움직입니다' }) trustSample!: number;
  @ApiProperty({ type: [String], description: '활동지역 — 소개자 프로필 지역, 없으면 내 매물 등록 지역 많은 순 2곳' }) regions!: string[];
  @ApiProperty({ nullable: true, enum: ['PROFILE', 'LISTINGS'] }) regionsBasis!: string | null;
}

/** v10.31 — 알림 수신 설정 한 줄 */
export class NotificationPrefDto {
  @ApiProperty() eventCode!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'false 면 수신거부할 수 없는 알림(돈 · 계약)' }) optoutAllowed!: boolean;
  @ApiProperty({ nullable: true, description: '수신거부할 수 없는 까닭' }) reason!: string | null;
  @ApiProperty() inapp!: boolean;
  @ApiProperty() email!: boolean;
}
export class NotificationPrefsDto {
  @ApiProperty({ description: '이메일 발송 준비(도메인 인증) — false 면 이메일은 보내지 않습니다' }) emailReady!: boolean;
  @ApiProperty({ type: [NotificationPrefDto] }) items!: NotificationPrefDto[];
}
export class SetNotificationPrefDto {
  @ApiProperty({ example: 'MESSAGE_RECEIVED' }) @IsString() @MaxLength(60) eventCode!: string;
  @ApiProperty({ enum: ['INAPP', 'EMAIL'] }) @IsIn(['INAPP', 'EMAIL']) channel!: string;
  @ApiProperty() @StrictBoolean() enabled!: boolean;
}
export class TaxInvoiceDto {
  @ApiPropertyOptional({ maxLength: 40, description: '국세청 승인번호(선택)' }) @IsOptional() @IsString() @MaxLength(40) no?: string;
}

/* ── v10.27 (G-193) 받은 문의 · 보낸 문의 ─────────────────────── */
export class MyConversationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'LISTING' }) targetType!: string;
  @ApiProperty({ format: 'uuid' }) targetId!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ enum: ['SENT', 'RECEIVED'] }) role!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) gwanCode!: string | null;
  @ApiProperty({ nullable: true }) targetStatus!: string | null;
  @ApiProperty({ description: '상대 이름 — 첫 글자만(화○○)' }) counterpartName!: string;
  @ApiProperty({ nullable: true }) lastBody!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) lastAt!: string | null;
  @ApiProperty() lastMine!: boolean;
  @ApiProperty({ description: '내가 안 읽은 상대 메시지 수' }) unread!: number;
  @ApiProperty({ nullable: true, format: 'uuid' }) dealId!: string | null;
  @ApiProperty({ nullable: true }) dealStatus!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
