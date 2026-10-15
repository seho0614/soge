import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

/* ★ 관을 늘릴 때 **여기도 고쳐야 합니다.** 건강상품관을 만들었을 때
 *   이 배열을 놓쳐, DB 에는 있는데 API 가 "허용되지 않은 값" 으로
 *   막았습니다. 검정이 gwans 표와 대조합니다. */
const GWAN = ['MNY', 'MAL', 'BIZ', 'HLT'] as const;
const LABOR = ['NOT_APPLICABLE','REVIEW_REQUIRED','APPLICABLE'] as const;
const CAT_STATUS = ['PENDING','APPROVED','REJECTED','ARCHIVED'] as const;

export class GwanDto {
  @ApiProperty({ enum: GWAN }) code!: string;
  @ApiProperty({ example: '소개장터' }) name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ example: 1240, description: '노출 중인 매물 수' }) listingCount!: number;
}

export class CategoryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: GWAN }) gwanCode!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({
    enum: ['G1','G2','G3'],
    description: '등급은 카테고리가 결정합니다. 등록자가 고르지 않습니다 (A-11)',
  })
  gradeCode!: string;
  @ApiProperty({ nullable: true, enum: ['BUYER','SELLER','NEGOTIABLE'] })
  feeBearer!: string | null;
  @ApiPropertyOptional({
    example: 3.0, description: '참고 요율. 소개비 산정에 쓰지 않습니다 (A-12)',
  })
  guideRate?: number | null;
}

export class AdminCategoryDto extends CategoryDto {
  @ApiProperty({ enum: CAT_STATUS }) status!: string;
  @ApiProperty({
    nullable: true, enum: LABOR,
    description: '직업안정법 판정. 없으면 승인 불가, APPLICABLE 이면 승인 자체가 거부됩니다 (A-14)',
  })
  laborLawFlag!: string | null;
  @ApiProperty({ nullable: true, description: '제한업종 코드' }) restrictedCode!: string | null;
  @ApiProperty({ example: 32, description: '이 업종의 매물 수' }) listingCount!: number;
}

export class ApproveCategoryDto {
  @ApiProperty({ enum: CAT_STATUS })
  @IsIn(CAT_STATUS) status!: string;

  @ApiProperty({
    enum: LABOR,
    description: '승인하려면 필수. APPLICABLE 은 승인할 수 없습니다',
  })
  @IsIn(LABOR) laborLawFlag!: string;

  @ApiPropertyOptional({ description: '판정 근거 메모' })
  @IsOptional() @IsString() laborLawMemo?: string;

  @ApiPropertyOptional({ enum: ['BUYER','SELLER','NEGOTIABLE'] })
  @IsOptional() @IsString() feeBearer?: string;

  @ApiPropertyOptional({ enum: ['G1','G2','G3'] })
  @IsOptional() @IsString() gradeCode?: string;

  @ApiPropertyOptional({ description: '제한업종에 연결할 경우' })
  @IsOptional() @IsString() restrictedCode?: string;
}

export class RestrictedIndustryDto {
  @ApiProperty({ example: 'INSURANCE' }) code!: string;
  @ApiProperty({ example: '보험' }) name!: string;
  @ApiProperty({ example: '보험업법 — 모집 자격 없는 자의 중개 금지' }) legalBasis!: string;
  @ApiProperty({ enum: GWAN }) gwanCode!: string;
  @ApiProperty({ enum: ['BLOCK','GATED','ALLOW'] }) mode!: string;
  @ApiProperty({
    description: '차단 시 사용자에게 그대로 보여 주는 문구. 관리자가 수정합니다',
  })
  blockMessage!: string;
  @ApiProperty() isActive!: boolean;
}

export class PolicyBundleDto {
  @ApiProperty({ type: [RestrictedIndustryDto] }) restrictedIndustries!: RestrictedIndustryDto[];
  @ApiProperty({ example: 42 }) bannedWordCount!: number;
  @ApiProperty({
    description: '자동검수 정책. 켜고 끄고 임계값을 바꾸면 배포 없이 반영됩니다',
  })
  autoReviewPolicies!: Record<string, { enabled: boolean; numValue: number | null; description: string }>;
}

export class UpdateRestrictionDto {
  @ApiProperty({ enum: GWAN }) @IsString() gwanCode!: string;
  @ApiProperty({ enum: ['BLOCK','GATED','ALLOW'] })
  @IsIn(['BLOCK','GATED','ALLOW']) mode!: string;
  @ApiPropertyOptional({ description: '차단 안내 문구' })
  @IsOptional() @IsString() blockMessage?: string;
}

export class CodeBundleDto {
  @ApiProperty({ enum: ['USER','ADMIN'] }) audience!: string;
  @ApiProperty({
    description: '도메인별 코드 목록. 프런트 부팅 시 한 번 받고 이후 로컬에서 씁니다',
    example: { 'listing.status': [{ code: 'PUBLISHED', label: '노출 중', tone: 'success' }] },
  })
  domains!: Record<string, unknown[]>;
}

export class FooterLinkDto {
  @ApiProperty({ enum: ['LEGAL','SUPPORT','GUIDE'] }) section!: string;
  @ApiProperty({ example: '이용약관' }) label!: string;
  @ApiProperty({ enum: ['TERM','SCREEN','URL','NONE'] }) targetType!: string;
  @ApiProperty({ nullable: true, example: 'SERVICE' }) targetRef!: string | null;
  @ApiProperty({
    description: 'false 면 목적지가 없습니다. 점선 + tip 으로 표시하고 숨기지 마십시오',
  })
  available!: boolean;
  @ApiProperty({ nullable: true, description: '못 누르는 이유' }) tip!: string | null;
}

export class UpdateAutoReviewDto {
  @ApiPropertyOptional({ description: '끄면 그 사유로는 사람에게 보내지 않습니다' })
  @IsOptional() enabled?: boolean;
  @ApiPropertyOptional({ description: '임계값. 고액 기준·본문 길이 등' })
  @IsOptional() numValue?: number;
}
