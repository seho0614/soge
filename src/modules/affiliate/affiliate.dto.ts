import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';

/* ── 파트너 ─────────────────────────────────────────────────── */

export class CreateLinkDto {
  @ApiProperty({ description: '어느 제휴상품 링크인가' })
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({ example: '블로그', description: '어디에 뿌릴 링크인지 메모' })
  @IsOptional() @IsString() @Length(1, 40)
  label?: string;
}

export class AffiliateInquiryDto {
  @ApiProperty() @IsString() @Length(2, 100)
  subject!: string;

  @ApiProperty() @IsString() @Length(5, 5000)
  body!: string;
}

export class AffiliatePayoutAccountDto {
  @ApiProperty({ example: '004' }) @IsString() @Length(3, 3)
  bankCode!: string;

  @ApiProperty({ example: '국민은행' }) @IsString() @Length(1, 30)
  bankName!: string;

  @ApiProperty({ example: '123456-01-234567' }) @IsString() @Length(6, 30)
  accountNo!: string;

  @ApiProperty({ example: '김도현' }) @IsString() @Length(2, 30)
  holderName!: string;
}

/** 1원 인증 확인 (D001) — 통장 입금자명에 찍힌 코드 */
export class VerifySettlementAccountDto {
  @ApiProperty({ example: 'SGB01', description: '입금자명에 찍힌 코드 (대소문자 무시)' })
  @IsString() @Length(2, 20)
  @Matches(/^\s*[A-Za-z0-9가-힣]+\s*$/, { message: '코드는 글자와 숫자만 적으십시오.' })
  code!: string;
}

/* ── 운영 ───────────────────────────────────────────────────── */

export class CreateProductDto {
  @ApiProperty({ example: 'AP-001' }) @IsString() @Length(2, 40)
  code!: string;

  @ApiProperty({ example: '태양광 상담 신청' }) @IsString() @Length(2, 100)
  name!: string;

  /* ★ 건당 정액입니다. 비율이 아닙니다 — 비율로 하면 주문 금액을
   *   알아야 하는데, 우리는 그 거래의 당사자가 아닙니다. */
  @ApiProperty({ example: 50000, description: '건당 수수료(원)' })
  @IsInt() @Min(1)
  commission!: number;

  @ApiProperty({ example: 'https://eng633.co.kr/' })
  @IsString() @Length(8, 300)
  landingUrl!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 60)
  advertiser?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 1000)
  description?: string;
}

export class UpdateProductDto {
  @ApiPropertyOptional({ description: '바꿔도 **이미 생긴 주문에는 소급하지 않습니다**' })
  @IsOptional() @IsInt() @Min(1)
  commission?: number;

  @ApiPropertyOptional({ enum: ['DRAFT', 'ON_SALE', 'SOLD_OUT', 'STOPPED'] })
  @IsOptional() @IsIn(['DRAFT', 'ON_SALE', 'SOLD_OUT', 'STOPPED'])
  status?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(8, 300)
  landingUrl?: string;
}

export class SetGoalDto {
  @ApiPropertyOptional({ description: '개인별 목표 — 등급 일괄보다 우선합니다' })
  @IsOptional() @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional({ description: '등급 일괄 목표' })
  @IsOptional() @IsString() @Length(1, 20)
  grade?: string;

  @ApiProperty({ example: '2026-10' }) @IsString() @Length(7, 7)
  periodYm!: string;

  @ApiProperty({ example: 3000000 }) @IsInt() @Min(1)
  target!: number;

  @ApiPropertyOptional({ example: 300000, description: '달성 시 지급' })
  @IsOptional() @IsInt() @Min(0)
  reward?: number;
}

export class ReviewMaterialDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  state!: string;

  @ApiPropertyOptional({ description: '반려면 반드시 적으십시오' })
  @IsOptional() @IsString() @Length(2, 300)
  reason?: string;
}

export class DecideApplicationDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  state!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 300)
  reason?: string;
}

export class SettleRunDto {
  @ApiProperty({ enum: ['AFFILIATE', 'REFERRAL'], description: '트랙별로 따로 돕니다' })
  @IsIn(['AFFILIATE', 'REFERRAL'])
  track!: string;

  @ApiProperty({ example: '2026-09-01' }) @IsString()
  periodFrom!: string;

  @ApiProperty({ example: '2026-09-30' }) @IsString()
  periodTo!: string;
}

/* ── 마케팅자료 · 파트너가이드 등록 (D007) ─────────────────────── */

export class CreateMaterialDto {
  @ApiProperty({ example: '가을 태양광 상담 배너' }) @IsString() @Length(2, 100)
  title!: string;

  @ApiProperty({ enum: ['IMAGE', 'BANNER', 'COPY', 'VIDEO', 'DOC'],
    description: 'COPY 는 문구만(body 필수). 나머지는 파일 필수 — 이미지 · 배너 JPG/PNG, 영상 MP4, 문서 PDF/JPG/PNG' })
  @IsIn(['IMAGE', 'BANNER', 'COPY', 'VIDEO', 'DOC'])
  kind!: string;

  @ApiPropertyOptional({ description: '문구 · 설명. 파트너가 복사해 씁니다 — 회사가 한 말이 됩니다' })
  @IsOptional() @IsString() @Length(5, 5000)
  body?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'POST /files (purpose=MARKETING_MATERIAL) 로 올린 READY 파일' })
  @IsOptional() @IsUUID()
  fileId?: string;
}

export class CreateGuideDto {
  @ApiProperty({ example: '처음 링크 만들기' }) @IsString() @Length(2, 100)
  title!: string;

  @ApiProperty() @IsString() @Length(5, 10000)
  body!: string;

  @ApiPropertyOptional({ example: 10, description: '작을수록 위' }) @IsOptional() @IsInt() @Min(0) @Max(9999)
  sortOrder?: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'POST /files (purpose=PARTNER_GUIDE) 로 올린 READY 파일' })
  @IsOptional() @IsUUID()
  fileId?: string;
}

export class UpdateGuideDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 100)
  title?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(5, 10000)
  body?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(9999)
  sortOrder?: number;

  @ApiPropertyOptional({ description: '끄면 파트너에게 안 보이고 첨부도 내려받을 수 없습니다' })
  @IsOptional() @StrictBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ format: 'uuid', description: '첨부 바꾸기' }) @IsOptional() @IsUUID()
  fileId?: string;

  @ApiPropertyOptional({ description: 'true 면 첨부를 뗍니다' }) @IsOptional() @StrictBoolean()
  removeFile?: boolean;
}
