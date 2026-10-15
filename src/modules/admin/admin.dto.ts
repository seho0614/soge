import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class BadgeRequestDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['URGENT', 'VERIFIED_DOC'] }) badgeType!: string;
  @ApiProperty() badgeLabel!: string;
  @ApiProperty({ format: 'uuid' }) listingId!: string;
  @ApiProperty() listingTitle!: string;
  @ApiProperty() ownerName!: string;
  @ApiProperty({ nullable: true, description: '급구 신청 사유' }) urgentReason!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) validUntil!: string | null;
  @ApiProperty({ nullable: true, description: '증빙 서류' }) evidence!: unknown;
  @ApiProperty({ format: 'date-time' }) requestedAt!: string;
  @ApiProperty({ format: 'uuid', description: '검수 항목 id. 이걸로 승인·반려합니다' })
  reviewItemId!: string;
}

export class DisputeAdminDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) dealId!: string;
  @ApiProperty() reasonCode!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty() statusLabel!: string;
  @ApiProperty() raisedByName!: string;
  @ApiProperty({ nullable: true, description: '보류된 정산 금액' }) heldAmount!: number | null;
  @ApiProperty({ format: 'date-time' }) openedAt!: string;
  @ApiProperty({ description: 'v10.32 — 접수 때 붙인 증빙 [{fileId, name}] · 내려받기 GET /files/{fileId}',
    type: 'array', items: { type: 'object', properties: { fileId: { type: 'string', format: 'uuid' }, name: { type: 'string' } } } })
  evidence!: { fileId: string; name: string }[];
  @ApiPropertyOptional({ enum: ['BUYER', 'SELLER', 'INTRODUCER'], nullable: true, description: 'v10.32 — 신청한 쪽(시안 「신청」 칸)' })
  raisedSide?: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true, description: 'v10.32 — 종결 시각(state=all)' }) closedAt?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'v10.32 — 처리 결과' }) resolution?: string | null;
  @ApiPropertyOptional({ description: 'v10.32 — 진행 중이면서 접수 72시간 지남' }) over72h?: boolean;
}

/** v10.32 — GET /admin/disputes/summary (시안 숫자 4칸) */
export class DisputeSummaryDto {
  @ApiProperty({ description: '처리 중(접수 · 검토 중)' }) open!: number;
  @ApiProperty({ description: '종결(처리 완료 · 기각)' }) closed!: number;
  @ApiProperty({ description: '이번 달 접수' }) openedThisMonth!: number;
  @ApiProperty({ description: '72시간 넘김(진행 중)' }) over72h!: number;
}

export class ResolveDisputeDto {
  @ApiProperty({ enum: ['IN_REVIEW', 'RESOLVED', 'REJECTED'] })
  @IsIn(['IN_REVIEW', 'RESOLVED', 'REJECTED']) status!: string;

  @ApiPropertyOptional({ maxLength: 1000, description: '처리 결과. 당사자에게 전달됩니다' })
  @IsOptional() @IsString() @MaxLength(1000) resolution?: string;
}

export class AuditSampleDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) targetId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) desiredFee!: number | null;
  @ApiProperty({ format: 'date-time' }) decidedAt!: string;
  @ApiProperty({ description: '자동 승인이 옳았는지 아직 확인하지 않음' }) pending!: boolean;
}

export class CodeLabelDto {
  @ApiProperty({ example: 'listing.status' }) domain!: string;
  @ApiProperty({ example: 'PUBLISHED' }) code!: string;
  @ApiProperty({ example: '노출 중' }) label!: string;
  @ApiProperty({ nullable: true }) shortLabel!: string | null;
  @ApiProperty({ nullable: true }) uiTone!: string | null;
  @ApiProperty() audience!: string;
  @ApiProperty() isActive!: boolean;
}

export class UpdateCodeLabelDto {
  @ApiProperty({ description: '화면에 보이는 문구. 배포 없이 바뀝니다' })
  @IsString() label!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() shortLabel?: string;
}

export class AdminSummaryDto {
  @ApiProperty({ description: '검수 대기' }) reviewPending!: number;
  @ApiProperty({ description: 'SLA 위반' }) slaBreached!: number;
  @ApiProperty({ description: '지난 7일 자동화율 (%)' }) autoRatePct!: number | null;
  @ApiProperty({ description: '정산 지급 대기' }) settlementPending!: number;
  @ApiProperty({ description: '미처리 분쟁' }) disputesOpen!: number;
  @ApiProperty({ description: '미확인 CRITICAL 경보' }) criticalAlerts!: number;
  @ApiProperty({ description: '오픈 차단 항목' }) openBlockers!: number;
  @ApiProperty({ nullable: true, description: '이번 달 k값. 1.30 이 경보선입니다' })
  kValue!: number | null;
}

export class AdminBusinessDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() bizRegNo!: string;
  @ApiProperty() companyName!: string;
  @ApiProperty() ceoName!: string;
  @ApiProperty({ nullable: true }) ntsStatus!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time', description: 'null 이면 미승인 (INV-10)' })
  verifiedAt!: string | null;
  @ApiProperty() accountName!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class AdminDealDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true }) title!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty() statusLabel!: string;
  @ApiProperty({ nullable: true }) agreedFee!: number | null;
  @ApiProperty({ nullable: true }) introducerName!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ nullable: true, format: 'date-time' }) confirmedAt!: string | null;
}

export class AdminSettlementDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) dealId!: string;
  @ApiProperty({ description: '공제 없는 소개비 전액 (INV-9)' }) amount!: number;
  @ApiProperty() status!: string;
  @ApiProperty() statusLabel!: string;
  @ApiProperty() payeeName!: string;
  @ApiProperty({ format: 'date-time' }) requestedAt!: string;
  @ApiProperty({ nullable: true, format: 'date-time' }) paidAt!: string | null;
  @ApiPropertyOptional({ example: 'S-2026-0311', description: 'v10.31 — 정산번호(표시용)' }) no?: string;
  @ApiPropertyOptional({ nullable: true, description: '귀속 소개코드' }) refCode?: string | null;
  @ApiPropertyOptional({ nullable: true, description: '계약서에 적힌 거래금액(없으면 null)' }) dealAmount?: number | null;
  @ApiPropertyOptional({ nullable: true, description: '부가세 — 사업자 수령일 때 소개비의 10%' }) vat?: number | null;
  @ApiPropertyOptional({ nullable: true, description: '받을 계좌(가림) — 개인 수령만. 사업자는 당사자끼리 확인' }) payoutAccount?: string | null;
  @ApiPropertyOptional({ nullable: true, description: '승인을 막는 이유(분쟁 · 계좌 미확인 · 예금주 불일치)' }) blockReason?: string | null;
  @ApiPropertyOptional({ nullable: true }) approvedAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) approvedByName?: string | null;
}

/**
 * 정산 승인 · 반려.
 *
 * v10.31 (10/10 시안 기준 지시) — 시안 「신청 → 승인 → 지급 실행」대로 APPROVED 를 다시 받습니다.
 * 승인은 정산서 확인일 뿐 자금 이동이 아닙니다(INV-11 유지 — 지급은 당사자 직접 · 지급 표시는 당사자만).
 * 2인 원칙 · 분쟁 · 받을 계좌 확인은 DB 트리거(fn_settlement_approval)가 집행합니다.
 */
export class DecideSettlementDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'], description: '승인 또는 반려' })
  @IsIn(['APPROVED', 'REJECTED']) status!: string;
  @ApiPropertyOptional({ description: '반려 사유(반려일 때 필수)' })
  @IsOptional() @IsString() rejectReason?: string;
}

export class SiteSettingDto {
  @ApiProperty() key!: string;
  @ApiProperty({ nullable: true }) value!: string | null;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ description: 'true 이면 값이 있고 형식도 맞아야 오픈됩니다' })
  isRequiredForOpen!: boolean;
  @ApiProperty({ nullable: true, example: '123-45-67890', description: '입력 예시' })
  valueExample!: string | null;
  @ApiProperty({ description: '자리표시자·형식 오류가 있는가' }) hasIssue!: boolean;
  @ApiProperty({ nullable: true, description: '무엇이 문제인지' }) issue!: string | null;
}

export class ReviewReasonDto {
  @ApiProperty({ example: 'THIN_CONTENT' }) code!: string;
  @ApiProperty({ example: '설명이 부족합니다' }) label!: string;
  @ApiProperty({ enum: ['CONTENT','DOCUMENT','POLICY','OTHER'] }) category!: string;
}

export class UpdateSettingDto {
  @ApiProperty() @IsString() key!: string;
  @ApiProperty() @IsString() value!: string;
}

export class UpdateSiteSettingDto {
  @ApiProperty() @IsString() key!: string;
  @ApiProperty() @IsString() value!: string;
}

/** v10.31 — 사유 하나만 받는 처리(사업자 반려 등) */
export class ReasonDto {
  @ApiProperty({ description: '사유(2자 이상)' }) @IsString() reason!: string;
}

/** v10.31 — 회원 상태 변경 */
export class AccountStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] }) @IsIn(['ACTIVE', 'SUSPENDED']) status!: string;
  @ApiProperty({ description: '사유(2자 이상)' }) @IsString() reason!: string;
}
