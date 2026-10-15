import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class IdentityVerifyDto {
  @ApiPropertyOptional({ enum: ['PASS', 'IPIN'], default: 'PASS' })
  @IsOptional() @IsString() provider?: string;
}

export class IdentityResultDto {
  @ApiProperty() success!: boolean;
  @ApiProperty({
    description: 'true 면 실제 확인이 이루어지지 않았습니다. 화면에 표시하십시오',
  })
  stub!: boolean;
  @ApiProperty({ nullable: true, format: 'date-time' }) verifiedAt!: string | null;
}

export class SearchResultDto {
  @ApiProperty({ description: '매물' }) listings!: unknown[];
  @ApiProperty({ description: '소개받기 요청' }) requests!: unknown[];
  @ApiProperty() total!: number;
}

export class PublicProposeFeeDto {
  @ApiProperty({ minimum: 0, description: '제안 금액. 공제 없이 그대로 지급됩니다' })
  @IsInt() @Min(0) amount!: number;

  @ApiPropertyOptional({
    description: '2차 제안부터 필수입니다 — 왜 바꾸는지가 분쟁의 근거가 됩니다',
  })
  @IsOptional() @IsString() reasonCode?: string;
}

export class CreateInquiryDto {
  @ApiProperty() @IsString() category!: string;
  @ApiProperty({ minLength: 2 }) @IsString() @MinLength(2) title!: string;
  @ApiProperty({ minLength: 5, maxLength: 4000, description: '챗봇 상담원 연결은 대화가 붙어 길어질 수 있어 4000자까지' })
  @IsString() @MinLength(5) @MaxLength(4000) body!: string;
  @ApiPropertyOptional({ description: '비로그인 문의는 필수' })
  @IsOptional() @IsString() email?: string;
  /* v10.31 — 시안 「관련 거래」(거래 · 정산 문의) · 챗봇에서 넘어온 문의 */
  @ApiPropertyOptional({ format: 'uuid', description: '관련 거래 — 내가 당사자 · 소개자인 거래만' })
  @IsOptional() @IsUUID('all') dealId?: string;
  @ApiPropertyOptional({ enum: ['FORM', 'BOT'], default: 'FORM' }) @IsOptional() @IsIn(['FORM', 'BOT']) channel?: string;
  /* v10.31 — 시안 「첨부파일 — 이미지 · PDF 10MB까지 (최대 3개)」 — POST /files(INQUIRY_ATTACHMENT)로 올린 내 파일 id */
  @ApiPropertyOptional({ type: [String], maxItems: 3 }) @IsOptional() @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) attachmentKeys?: string[];
}

export class FaqDto {
  @ApiProperty() category!: string;
  @ApiProperty() question!: string;
  @ApiProperty() answer!: string;
}

export class CreateDisputeDto {
  @ApiProperty({ format: 'uuid' }) @IsString() dealId!: string;
  @ApiProperty({
    enum: ['FEE_DISAGREE', 'NOT_INTRODUCED', 'CONTRACT_ISSUE', 'PAYMENT_ISSUE', 'OTHER'],
  })
  @IsIn(['FEE_DISAGREE', 'NOT_INTRODUCED', 'CONTRACT_ISSUE', 'PAYMENT_ISSUE', 'OTHER'])
  reasonCode!: string;
  @ApiProperty({ minLength: 5 }) @IsString() @MinLength(5) description!: string;
  /* v10.32 — 시안 「증빙 붙이기」(계약서 · 대화 · 사진) — POST /files(INQUIRY_ATTACHMENT)로 올린 내 파일 id · 3개까지.
   *   dispute_messages.attachment_key 에 남고 올린 사람과 운영만 봅니다(GET /files/{id}). */
  @ApiPropertyOptional({ type: [String], maxItems: 3 }) @IsOptional() @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) evidenceKeys?: string[];
}

export const REVIEW_TAGS = ['연락이 빨랐습니다', '조건을 정확히 알려줬습니다', '현장을 잘 압니다', '무리한 권유가 없었습니다', '사후 확인까지 해줬습니다'] as const;
export class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiPropertyOptional({ maxLength: 1000, description: '내용 — 칩을 고르지 않았으면 10자 이상(빈 후기 막음 · v10.31)' })
  @IsOptional() @IsString() @MaxLength(1000) body?: string;
  /* v10.31 — 시안 「무엇이 좋았습니까」 */
  @ApiPropertyOptional({ type: [String], enum: REVIEW_TAGS, description: '무엇이 좋았습니까(복수)' })
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsIn(REVIEW_TAGS, { each: true }) tags?: string[];
}

export class RequestSettlementDto {
  // 계좌 필드가 없습니다. 플랫폼이 이체하지 않으므로 받을 이유가 없습니다(INV-11).
  @ApiProperty({ format: 'uuid' }) @IsUUID() dealId!: string;   // v10.27 (G-120) — uuid 가 아니면 400
}
