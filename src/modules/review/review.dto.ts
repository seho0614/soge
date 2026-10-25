import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const TARGET_TYPES = ['LISTING','REQUEST','LEAD_SERVICE','MEDICAL','BUSINESS','CATEGORY','LISTING_BADGE'] as const;
const REVIEW_STATUS = ['QUEUED','IN_PROGRESS','APPROVED','REJECTED'] as const;

export class SubmitReviewDto {
  @ApiProperty({ enum: TARGET_TYPES })
  @IsIn(TARGET_TYPES)
  targetType!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  targetId!: string;

  @ApiPropertyOptional({ enum: ['MNY', 'MAL', 'BIZ', 'HLT'] })
  @IsOptional() @IsString()
  gwanCode?: string;
}

export class DecideReviewDto {
  @ApiProperty({ enum: ['APPROVED','REJECTED'] })
  @IsIn(['APPROVED','REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({
    example: 'THIN_CONTENT',
    description: '반려 시 필수. review_reason_codes 의 코드값. 자유서술이면 사유 분포를 볼 수 없습니다',
  })
  @IsOptional() @IsString()
  reasonCode?: string;

  @ApiPropertyOptional({ maxLength: 1000, description: '검수자 메모. 선택' })
  @IsOptional() @IsString() @MaxLength(1000)
  memo?: string;
}

export class ReviewQueueQueryDto {
  @ApiPropertyOptional({ enum: ['MNY', 'MAL', 'BIZ', 'HLT'] })
  @IsOptional() @IsString()
  gwanCode?: string;

  @ApiPropertyOptional({ enum: REVIEW_STATUS })
  @IsOptional() @IsIn(REVIEW_STATUS)
  status?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  cursor?: string;
}

export class ReviewItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: TARGET_TYPES }) targetType!: string;
  @ApiProperty({ format: 'uuid' }) targetId!: string;
  @ApiProperty({ nullable: true }) gwanCode!: string | null;
  @ApiProperty({ format: 'date-time' }) submittedAt!: Date;
  @ApiProperty({ format: 'date-time', description: 'SLA 24시간' }) slaDueAt!: Date;
  @ApiProperty({ enum: REVIEW_STATUS }) status!: string;

  @ApiProperty({ enum: ['MANUAL','AUTO'], description: 'AUTO 는 규칙이 판정한 건' })
  decisionMode!: string;

  @ApiProperty({
    isArray: true, type: String, nullable: true,
    example: ['HIGH_FEE','FIRST_LISTING'],
    description: '사람이 봐야 하는 이유. 비면 자동 승인 대상이었음',
  })
  manualReasons!: string[] | null;

  @ApiProperty({ nullable: true }) rejectReasonCode!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time' }) decidedAt!: Date | null;

  /* v10.106 (D120) — AI 검수 보조 의견(참고만 · 결정은 사람) */
  @ApiPropertyOptional({ enum: ['APPROVE', 'REJECT', 'UNSURE'], nullable: true, description: 'AI 제안(참고 · AI 는 결정하지 않음)' }) aiSuggestion?: string | null;
  @ApiPropertyOptional({ isArray: true, type: String, nullable: true, description: 'AI 가 고른 반려 사유 코드(review_reason_codes 안)' }) aiReasonCodes?: string[] | null;
  @ApiPropertyOptional({ nullable: true, description: 'AI 설명(짧게)' }) aiNote?: string | null;
  @ApiPropertyOptional({ nullable: true }) aiModel?: string | null;
}

export class ReviewDecisionResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: REVIEW_STATUS }) status!: string;
  @ApiProperty({ example: 'PUBLISHED', description: '검수 대상의 전이 결과' }) targetStatus!: string;
}

export class ReviewThroughputDto {
  @ApiProperty({ format: 'date' }) day!: string;
  @ApiProperty() submitted!: number;
  @ApiProperty() decided!: number;
  @ApiProperty() pending!: number;
  @ApiProperty({ description: 'SLA 24시간 초과 건' }) slaBreached!: number;
  @ApiProperty({ nullable: true }) avgHours!: number | null;
}
