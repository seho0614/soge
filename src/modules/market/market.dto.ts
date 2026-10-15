import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';   // v10.31 검정 — 참 · 거짓 입력은 받은 값 그대로(G-134 · "false" 글자가 true 로 바뀌지 않게)

/* v10.31 (w2) — 관 화면 시안 구역의 요청 본문 */

export class PatchRequestExtraDto {
  @ApiPropertyOptional({ enum: ['GOODS', 'SERVICE', 'EXPERT', 'COMPANY', 'USED', ''], description: '요청 종류(빈 값 = 지움)' })
  @IsOptional() @IsIn(['GOODS', 'SERVICE', 'EXPERT', 'COMPANY', 'USED', '']) kind?: string;
  @ApiPropertyOptional({ description: '시 · 도 코드(GET /market/regions) · 빈 값 = 지움' })
  @IsOptional() @IsString() @MaxLength(12) regionCode?: string;
  @ApiPropertyOptional({ maxLength: 30, example: '성남시' })
  @IsOptional() @IsString() @MaxLength(30) regionDetail?: string;
  @ApiPropertyOptional({ format: 'uuid', description: '올리기를 마친 REQUEST_IMAGE 파일 id · 빈 값 = 지움' })
  @IsOptional() @IsString() @MaxLength(36) photoFileId?: string;
}

export class CreateStoryDto {
  @ApiProperty({ format: 'uuid', description: '성사 확정(CONFIRMED · SETTLED) 거래' }) @IsUUID('all') dealId!: string;
  @ApiProperty({ minLength: 5, maxLength: 80 }) @IsString() @MinLength(5) @MaxLength(80) headline!: string;
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) summary?: string;
  @ApiPropertyOptional({ type: [String], description: '베스트매칭 이유(최대 5)' })
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @MaxLength(80, { each: true }) reasons?: string[];
  @ApiPropertyOptional({ description: '작을수록 앞(1위)' }) @IsOptional() @IsInt() @Min(1) @Max(1000) sortRank?: number;
}

export class UpdateStoryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(5) @MaxLength(80) headline?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) summary?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @MaxLength(80, { each: true }) reasons?: string[];
  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'HIDDEN'], description: 'PUBLISHED 는 두 당사자 동의 뒤에만(DB)' })
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED', 'HIDDEN']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1000) sortRank?: number;
}

export class StoryConsentDto {
  @ApiProperty({ description: 'true 동의 · false 철회(공개 중이면 내립니다)' }) @StrictBoolean() consent!: boolean;
  @ApiPropertyOptional({ maxLength: 300, description: '매도자 한마디(매도자만)' }) @IsOptional() @IsString() @MinLength(5) @MaxLength(300) comment?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number;
}

export class BrokerExtraDto {
  @ApiPropertyOptional({ example: '공인중개사협회' }) @IsOptional() @IsString() @MaxLength(60) guaranteeOrg?: string;
  @ApiPropertyOptional({ example: '제2026-12345호' }) @IsOptional() @IsString() @MaxLength(60) guaranteeCertNo?: string;
  @ApiPropertyOptional({ example: 200000000, description: '보증 금액(원)' }) @IsOptional() @IsInt() @Min(1) guaranteeAmount?: number;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) guaranteeFrom?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) guaranteeUntil?: string;
  @ApiPropertyOptional({ type: [String], enum: ['REG_CERT', 'GUARANTEE', 'LICENSE', 'ETC'] })
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsIn(['REG_CERT', 'GUARANTEE', 'LICENSE', 'ETC'], { each: true }) submittedDocs?: string[];
  @ApiPropertyOptional({ type: [String], description: '올리기를 마친 BROKER_DOC 파일 id' })
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsUUID('all', { each: true }) docFileIds?: string[];
}

export class SafetyCaseDto {
  @ApiProperty({ enum: ['CONTRACT', 'PAYMENT', 'GOODS', 'PRIVACY', 'ETC'], description: '계약사기 · 대금사기 · 물품/서비스 사기 · 개인정보/보이스피싱 · 기타 사기' })
  @IsIn(['CONTRACT', 'PAYMENT', 'GOODS', 'PRIVACY', 'ETC']) type!: string;
  @ApiProperty({ minLength: 5, maxLength: 80 }) @IsString() @MinLength(5) @MaxLength(80) title!: string;
  @ApiProperty({ minLength: 20, maxLength: 3000, description: '연락처 · 이메일 · 계좌번호는 저장 전에 가립니다' })
  @IsString() @MinLength(20) @MaxLength(3000) body!: string;
  @ApiPropertyOptional({ description: '시 · 도 코드' }) @IsOptional() @IsString() @MaxLength(12) regionCode?: string;
}

export class HideDto {
  @ApiProperty({ minLength: 2, maxLength: 200 }) @IsString() @MinLength(2) @MaxLength(200) reason!: string;
}

export class BizAxisItemDto {
  @ApiProperty({ enum: ['JOB', 'SVC', 'POL', 'EDU'] }) @IsIn(['JOB', 'SVC', 'POL', 'EDU']) kind!: string;
  @ApiProperty({ example: '초단기', description: '구분(정규 · 초단기 · 창업컨설팅 · 회사운영 · 정책 · 강의 …)' })
  @IsString() @MinLength(1) @MaxLength(12) badge!: string;
  @ApiPropertyOptional({ description: '공고만 — 초단기(마감 임박)' }) @IsOptional() @StrictBoolean() hot?: boolean;
  @ApiProperty({ minLength: 5, maxLength: 100 }) @IsString() @MinLength(5) @MaxLength(100) title!: string;
  @ApiPropertyOptional({ maxLength: 60, example: '일 132,000원' }) @IsOptional() @IsString() @MaxLength(60) price?: string;
  @ApiPropertyOptional({ maxLength: 80 }) @IsOptional() @IsString() @MaxLength(80) cond?: string;
  @ApiPropertyOptional({ maxLength: 120 }) @IsOptional() @IsString() @MaxLength(120) sub?: string;
  @ApiPropertyOptional({ maxLength: 3000 }) @IsOptional() @IsString() @MaxLength(3000) description?: string;
  @ApiPropertyOptional({ description: '내용표 [[항목, 값], …]', type: 'array', items: { type: 'array', items: { type: 'string' } } })
  @IsOptional() @IsArray() @ArrayMaxSize(20) spec?: string[][];
  @ApiPropertyOptional({ maxLength: 60 }) @IsOptional() @IsString() @MaxLength(60) org?: string;
  @ApiPropertyOptional({ maxLength: 40 }) @IsOptional() @IsString() @MaxLength(40) region?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(9999) headcount?: number;
  @ApiPropertyOptional({ maxLength: 40 }) @IsOptional() @IsString() @MaxLength(40) period?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) due?: string;
  @ApiPropertyOptional({ description: '정책 원문 — 공고명' }) @IsOptional() @IsString() @MaxLength(120) sourceTitle?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) sourceOrg?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) sourceScale?: string;
  @ApiPropertyOptional({ description: 'https 주소만' }) @IsOptional() @Matches(/^https:\/\/\S{4,500}$/) sourceUrl?: string;
  @ApiPropertyOptional({ description: '지원 내용 표 [[항목, 내용], …]', type: 'array', items: { type: 'array', items: { type: 'string' } } })
  @IsOptional() @IsArray() @ArrayMaxSize(20) sourceRows?: string[][];
  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED'] }) @IsOptional() @IsIn(['DRAFT', 'PUBLISHED']) status?: string;
}

export class BizAxisStatusDto {
  @ApiProperty({ enum: ['PUBLISHED', 'CLOSED', 'HIDDEN'] }) @IsIn(['PUBLISHED', 'CLOSED', 'HIDDEN']) status!: string;
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class BizAxisRequestDto {
  @ApiPropertyOptional({ maxLength: 1000, description: '요청 내용(연락처는 가립니다 — 회신은 1:1 대화로)' })
  @IsOptional() @IsString() @MaxLength(1000) memo?: string;
}

export class BizAxisAnswerDto {
  @ApiProperty({ minLength: 2, maxLength: 1000 }) @IsString() @MinLength(2) @MaxLength(1000) answer!: string;
}

export class QuickMatchDto {
  @ApiProperty({ enum: ['TODAY', 'TOMORROW', 'WEEK'], description: '언제까지(오늘 · 내일 · 이번 주)' })
  @IsIn(['TODAY', 'TOMORROW', 'WEEK']) when!: string;
  @ApiProperty({ minimum: 1, maximum: 500, description: '몇 분' }) @IsInt() @Min(1) @Max(500) headcount!: number;
  @ApiProperty({ minLength: 2, maxLength: 40, example: '물류센터 피킹' }) @IsString() @MinLength(2) @MaxLength(40) task!: string;
  @ApiProperty({ minLength: 2, maxLength: 60, example: '경기 김포시 운양동' }) @IsString() @MinLength(2) @MaxLength(60) place!: string;
  @ApiPropertyOptional({ description: '시 · 도 코드(없으면 장소 글자에서 시 · 도를 찾습니다)' }) @IsOptional() @IsString() @MaxLength(12) regionCode?: string;
}
