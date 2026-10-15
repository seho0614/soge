import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';   // v10.31 검정 — 참 · 거짓 입력은 받은 값 그대로(G-134 · "false" 글자가 true 로 바뀌지 않게)
import { Type } from 'class-transformer';

/* ★ 관을 늘릴 때 **여기도 고쳐야 합니다.** 건강상품관을 만들었을 때
 *   이 배열을 놓쳐, DB 에는 있는데 API 가 "허용되지 않은 값" 으로
 *   막았습니다. 검정이 gwans 표와 대조합니다. */
const GWAN = ['MNY', 'MAL', 'BIZ', 'HLT'] as const;
const REQ_STATUS = ['DRAFT','IN_REVIEW','PUBLISHED','REJECTED','CLOSED','ARCHIVED'] as const;

export class RequestAddressDto {
  @ApiPropertyOptional({ maxLength: 10 }) @IsOptional() @IsString() @MaxLength(10) zip?: string;
  @ApiPropertyOptional({ maxLength: 120 }) @IsOptional() @IsString() @MaxLength(120) road?: string;
  @ApiPropertyOptional({ maxLength: 120 }) @IsOptional() @IsString() @MaxLength(120) detail?: string;
}

export class CreateRequestDto {
  @ApiProperty({ enum: GWAN }) @IsIn(GWAN) gwanCode!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID('all') categoryId?: string;
  @ApiProperty({ minLength: 5, maxLength: 100 })
  @IsString() @MinLength(5) @MaxLength(100) title!: string;
  @ApiPropertyOptional({ maxLength: 3000 }) @IsOptional() @IsString() body?: string;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsInt() @Min(0) budgetMin?: number;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsInt() @Min(0) budgetMax?: number;
  @ApiPropertyOptional({
    minimum: 0, description: '이 요청을 해결해 주면 지급할 소개비. 당사자 합의로 확정됩니다',
  })
  @IsOptional() @IsInt() @Min(0) offeredFee?: number;

  /* v10.31 — 시안 등록 폼(scReqNew)의 칸 */
  @ApiPropertyOptional({ maxLength: 40, description: '지역(시 · 구). 비우면 주소에서 채웁니다' })
  @IsOptional() @IsString() @MaxLength(40) region?: string;
  @ApiPropertyOptional({ type: () => RequestAddressDto, description: '희망 지역 주소 — 상세주소는 요청자 본인 · 운영만 봅니다' })
  @IsOptional() @ValidateNested() @Type(() => RequestAddressDto) address?: RequestAddressDto;
  @ApiPropertyOptional({ maxLength: 60, example: '주 5회 · 1,200평' }) @IsOptional() @IsString() @MaxLength(60) quantity?: string;
  @ApiPropertyOptional({ maxLength: 60, example: '평일 10:00 ~ 18:00' }) @IsOptional() @IsString() @MaxLength(60) contactHours?: string;
  @ApiPropertyOptional({ default: true, description: '예산 공개' }) @IsOptional() @StrictBoolean() budgetOpen?: boolean;
  @ApiPropertyOptional({ default: false, description: '회사명 비공개' }) @IsOptional() @StrictBoolean() companyBlind?: boolean;
  @ApiPropertyOptional({ enum: ['ALL', 'MEMBER', 'VERIFIED'], default: 'ALL', description: '공개 범위' })
  @IsOptional() @IsIn(['ALL', 'MEMBER', 'VERIFIED']) visibility?: string;
  @ApiPropertyOptional({ type: [String], maxItems: 5, description: '대표 · 상세 이미지(파일 키)' })
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) imageKeys?: string[];
}


export class CreateProposalDto {
  @ApiPropertyOptional({
    format: 'uuid', description: '내 매물을 붙여 제안하는 경우',
  })
  @IsOptional() @IsUUID('all') listingId?: string;

  @ApiProperty({ minLength: 10, maxLength: 1000 })
  @IsString() @MinLength(10) @MaxLength(1000) message!: string;

  /* v10.31 — 시안 「소개할 업체 · 업체와의 관계」 */
  @ApiPropertyOptional({ maxLength: 60, description: '소개할 업체' })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) companyName?: string;
  @ApiPropertyOptional({ enum: ['CLIENT', 'PARTNER', 'ACQUAINTANCE', 'OWN', 'OTHER'], description: '업체와의 관계' })
  @IsOptional() @IsIn(['CLIENT', 'PARTNER', 'ACQUAINTANCE', 'OWN', 'OTHER']) relation?: string;
}

export class DecideProposalDto {
  @ApiProperty({ enum: ['ACCEPT', 'REJECT'] }) @IsIn(['ACCEPT', 'REJECT']) decision!: string;
}

export class RequestCardDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: GWAN }) gwanCode!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) categoryName!: string | null;
  @ApiProperty({ nullable: true }) budgetMin!: number | null;
  @ApiProperty({ nullable: true }) budgetMax!: number | null;
  @ApiProperty({ nullable: true }) offeredFee!: number | null;
  @ApiProperty({ enum: REQ_STATUS }) status!: string;
  @ApiProperty({ example: '모집 중' }) statusLabel!: string;
  @ApiProperty({ example: 4 }) proposalCount!: number;
  @ApiProperty({ nullable: true, format: 'date-time' }) closesAt!: string | null;
}

export class RequestDetailDto extends RequestCardDto {
  @ApiProperty({ nullable: true }) body!: string | null;
  @ApiProperty({
    description: '열람 시 구독 한도가 차감됩니다. 같은 요청 재열람은 무료입니다',
  })
  viewCharged!: boolean;
  @ApiPropertyOptional({
    nullable: true,
    description: '열람 한도 상태(로그인 · 남의 요청일 때). enabled=false 면 홍보 기간(제한 없음). ' +
      'basis: OFF · FREE(무료 요금제 · 구독 없음 — 이번 달) · PLAN(유료 요금제 — 구독 기간). limit 이 null 이면 무제한',
    example: { enabled: true, basis: 'FREE', limit: 5, used: 2, remaining: 3 },
  })
  viewLimit?: { enabled: boolean; basis: string; limit: number | null; used: number; remaining: number | null } | null;
  @ApiProperty({ description: '제안 가능 여부' }) canPropose!: boolean;
  @ApiPropertyOptional({ enum: ['IDENTITY_REQUIRED','OWN_REQUEST','ALREADY_PROPOSED'] })
  proposeBlockReason?: string;
}

export class ProposalDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() proposerName!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ enum: ['PROPOSED','ACCEPTED','REJECTED','WITHDRAWN'] }) status!: string;
  @ApiProperty({ example: '제안됨' }) statusLabel!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
