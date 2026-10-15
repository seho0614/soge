import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const DEAL_STATUS = ['INQUIRY','NEGOTIATING','CONTRACTED','PAYMENT_REPORTED',
                     'CONFIRMED','SETTLED','DISPUTED','CANCELLED'] as const;

/* ── 문의 ─────────────────────────────────────────────── */

export class StartConversationDto {
  @ApiProperty({ enum: ['LISTING','REQUEST'] })
  @IsIn(['LISTING','REQUEST']) targetType!: string;

  /* ★ IsUUID() 는 기본이 v4 전용입니다.
   *
   * v4 만 받으면 **다른 방식으로 만든 id 가 전부 거부됩니다** —
   * 픽스처는 물론이고, 외부에서 들여온 데이터나 순차 UUID 도
   * 400 이 납니다. 형식만 맞으면 받습니다. */
  @ApiProperty({ format: 'uuid' }) @IsUUID('all') targetId!: string;

  @ApiProperty({ minLength: 5, maxLength: 1000, description: '첫 메시지' })
  @IsString() @MinLength(5) @MaxLength(1000) message!: string;
}

export class SendMessageDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString() @MinLength(1) @MaxLength(2000) body!: string;

  @ApiPropertyOptional({ description: 'S3 key' })
  @IsOptional() @IsString() attachmentKey?: string;
}

export class MessageDto {
  @ApiProperty() id!: string;
  @ApiProperty({ format: 'uuid' }) senderId!: string;
  @ApiProperty() body!: string;
  @ApiProperty({
    description: '연락처가 마스킹된 메시지. 대화가 플랫폼 밖으로 나가면 귀속이 끊깁니다',
  })
  masked!: boolean;
  @ApiProperty({ nullable: true, format: 'date-time' }) readAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ConversationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['LISTING','REQUEST'] }) targetType!: string;
  @ApiProperty({ format: 'uuid' }) targetId!: string;
  @ApiProperty() targetTitle!: string;
  @ApiProperty() counterpartName!: string;
  @ApiProperty({ enum: ['OPEN','DEAL_CREATED','CLOSED'] }) status!: string;
  @ApiProperty({ nullable: true, format: 'uuid', description: 'Deal 이 생성된 경우' })
  dealId!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) lastMessageAt!: string | null;
}

/* ── 거래 ─────────────────────────────────────────────── */

export class ProposeFeeDto {
  @ApiProperty({ minimum: 0, example: 3000000, description: '제안 금액. 원 단위 정수' })
  @IsInt() @Min(0) amount!: number;

  @ApiPropertyOptional({
    description: '2차 이후 제안은 사유가 필수입니다. 번복의 근거로 남습니다 (D-03)',
  })
  @IsOptional() @IsString() reasonCode?: string;
}

export class FeeAgreementDto {
  @ApiProperty() version!: number;
  @ApiProperty({ example: 3000000 }) amount!: number;
  @ApiProperty({ enum: ['PROPOSED','AGREED','LOCKED','SUPERSEDED'] }) state!: string;
  @ApiProperty({ nullable: true, format: 'date-time' }) agreedByBuyerAt!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) agreedBySellerAt!: string | null;
  @ApiProperty({ nullable: true }) reasonCode!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ReportPaymentDto {
  @ApiProperty({ enum: ['BANK_TRANSFER','CASH','OTHER'] })
  @IsIn(['BANK_TRANSFER','CASH','OTHER']) method!: string;

  @ApiPropertyOptional({ description: '증빙 파일 S3 key' })
  @IsOptional() @IsString() evidenceKey?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500) memo?: string;
}

export class DealDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: DEAL_STATUS }) status!: string;
  @ApiProperty({ example: '협의 중' }) statusLabel!: string;
  @ApiProperty({ nullable: true }) listingTitle!: string | null;
  @ApiProperty() buyerName!: string;
  @ApiProperty() sellerName!: string;
  @ApiProperty({ nullable: true, description: '소개자. 귀속 판정 결과입니다' })
  introducerName!: string | null;
  @ApiProperty({
    nullable: true, example: 'ABC123',
    description: '귀속된 소개코드. 확정 시점에 스냅샷으로 고정됩니다 (INV-2)',
  })
  attributedCode!: string | null;
  @ApiProperty({ example: 1, description: '항상 1 입니다 (INV-1)' }) tier!: number;
  @ApiProperty({ nullable: true, description: '합의된 소개비. LOCKED 합의와 항상 일치합니다' })
  agreedFee!: number | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) confirmedAt!: string | null;
  @ApiProperty({
    nullable: true, enum: ['BOTH','AUTO','CONTRACT'],
    description: 'CONTRACT = 계약서 양측 서명으로 자동 확정 (A-15)',
  })
  confirmMode!: string | null;
  @ApiProperty({ type: [String], example: ['BUYER'], description: '확인 완료한 당사자' })
  confirmedParties!: string[];
}

export class IssueContractDto {
  @ApiPropertyOptional({ default: 'STD_V1', description: '계약서 양식 코드' })
  @IsOptional() @IsString() templateCode?: string;
}

export class ContractDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: '다운로드는 서명 URL 로 별도 발급합니다' }) documentKey!: string;
  @ApiProperty({
    description: '계약서에 실린 소개비. 발급 시점에 LOCKED 로 고정됩니다 (D-03)',
  })
  lockedFee!: number;
  @ApiProperty({ nullable: true, format: 'date-time' }) signedByBuyerAt!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) signedBySellerAt!: string | null;
}

export class SignResultDto {
  @ApiProperty({ enum: ['BUYER','SELLER'] }) signedAs!: string;
  @ApiProperty({ description: '양측 서명이 끝났는지' }) bothSigned!: boolean;
  @ApiProperty({
    enum: DEAL_STATUS,
    description: '양측 서명이면 CONFIRMED 로 자동 전이됩니다',
  })
  dealStatus!: string;
  @ApiProperty({
    nullable: true, format: 'uuid',
    description: '자동 생성된 정산. 소개자가 개인이면 null 이고 전환 안내가 발송됩니다 (INV-10)',
  })
  settlementId!: string | null;
}

export class ContractTermsDto {
  @ApiProperty({ description: '합의 금액(원 · 부가세 별도)' })
  @IsInt() @Min(0) amount!: number;
  @ApiProperty({ description: '인도 · 이행 예정일 (YYYY-MM-DD)' })
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate!: string;
  @ApiPropertyOptional({ maxLength: 2000, description: '특약' })
  @IsOptional() @IsString() @MaxLength(2000) special?: string;
  /* v10.31 (시안 표준계약서 제2조 · 제8조) */
  @ApiPropertyOptional({ enum: ['GOODS', 'SERVICE'], description: '거래 유형 — 물품 · 용역(제2조). 용역은 판매 쪽이 인증된 사업자여야 합니다(A-09)' })
  @IsOptional() @IsIn(['GOODS', 'SERVICE']) kind?: string;
  @ApiPropertyOptional({ maxLength: 200, description: '인도 장소(제2조)' })
  @IsOptional() @IsString() @MaxLength(200) place?: string;
  @ApiPropertyOptional({ maxLength: 100, description: '관할법원(제8조) — 비우면 민사소송법에 따름' })
  @IsOptional() @IsString() @MaxLength(100) court?: string;
}

export class AgreeContractDto {
  @ApiProperty({ type: ContractTermsDto })
  @ValidateNested() @Type(() => ContractTermsDto)
  terms!: ContractTermsDto;
}

export class ContractDraftTermsDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) amount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) dueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) special?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['GOODS', 'SERVICE']) kind?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) place?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) court?: string;
}

/** v10.31 (시안 「임시 저장」) — 보내지 않고 내 쪽에만 남깁니다. 빈칸이 있어도 됩니다 */
export class DraftContractDto {
  @ApiProperty({ description: '조건(금액 · 이행일 · 특약 · 유형 · 장소 · 관할) — 빈칸 허용' })
  @ValidateNested() @Type(() => ContractDraftTermsDto)
  terms!: ContractDraftTermsDto;
}
export class CounterContractDto {
  @ApiProperty({ minLength: 5, maxLength: 1000, description: '무엇을 고쳐야 하는지' })
  @IsString() @MinLength(5) @MaxLength(1000) memo!: string;
  @ApiPropertyOptional({ type: ContractTermsDto, description: '제안 조건' })
  @IsOptional() @ValidateNested() @Type(() => ContractTermsDto) terms?: ContractTermsDto;
}

export class CancelContractDto {
  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class ContractStateDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['DRAFT','SENT','COUNTER','AGREED','SIGNED','FULFILLED','CANCELLED'] })
  state!: string;
  @ApiProperty() buyerAgreed!: boolean;
  @ApiProperty() sellerAgreed!: boolean;
  @ApiProperty() buyerSigned!: boolean;
  @ApiProperty() sellerSigned!: boolean;
  @ApiPropertyOptional() terms?: any;
  @ApiProperty({ description: '3일 넘게 멈춤' }) stalled!: boolean;
}
