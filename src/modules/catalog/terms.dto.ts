import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';

const TERM_STATUS = ['DRAFT', 'LEGAL_REVIEW', 'PUBLISHED', 'ARCHIVED'] as const;

export class TermDetailDto {
  @ApiProperty({ example: 'SERVICE' }) code!: string;
  @ApiProperty({ example: '1.0' }) version!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ description: '미작성이면 빈 문자열' }) body!: string;
  @ApiProperty({ enum: TERM_STATUS }) status!: string;
  @ApiProperty({ description: '필수 약관은 미발행 시 오픈을 막습니다' }) isRequired!: boolean;
  @ApiProperty({
    nullable: true,
    example: 'B-12 · C-07 통신판매중개자 지위 확정 후 조항 확정',
    description: '무엇 때문에 못 쓰는지. 법무 회신이 오면 이 항목이 해소됩니다',
  })
  blockedBy!: string | null;
  @ApiProperty({ nullable: true, format: 'date-time', description: '미발행이면 infinity' })
  effectiveFrom!: string | null;
}

/** 법무 회신 반영. 초안 저장과 발행을 나눕니다. */
export class UpsertTermDto {
  @ApiProperty({ example: '1.1', description: '기존 버전을 덮지 않고 새 버전을 만듭니다' })
  @IsString() version!: string;

  @ApiProperty({ minLength: 10 })
  @IsString() title!: string;

  @ApiProperty({ minLength: 50, description: '약관 전문' })
  @IsString() @MinLength(50) body!: string;

  @ApiPropertyOptional({ description: '필수 동의 여부. 미지정이면 기존 값 유지' })
  @IsOptional() @StrictBoolean() isRequired?: boolean;
}

export class PublishTermDto {
  @ApiProperty({ example: '1.1' })
  @IsString() version!: string;

  @ApiProperty({
    format: 'date-time',
    description: '시행일. 과거로 넣지 마십시오 — 동의 이력의 기준이 됩니다',
  })
  @IsDateString() effectiveFrom!: string;
}

export class TermPublishResultDto {
  @ApiProperty() code!: string;
  @ApiProperty() version!: string;
  @ApiProperty({ enum: TERM_STATUS }) status!: string;
  @ApiProperty({
    example: 12,
    description: '발행 후 남은 오픈 차단 항목 수. 0 이 되면 이 관문은 통과입니다',
  })
  remainingBlockers!: number;
}

export class OpenBlockerDto {
  @ApiProperty({ enum: ['SETTING', 'TERM', 'FOOTER', 'INTEGRATION', 'ASSUME', 'READY'] }) kind!: string;
  @ApiProperty() item!: string;
  @ApiProperty() reason!: string;
}

/** v10.146 (D142 · docs/225) — 오픈 준비 점검 한 줄. required 이고 ok 가 아니면 오픈 차단(READY)에도 올라갑니다. */
export class OpenReadinessDto {
  @ApiProperty({ example: 'IDENTITY' }) code!: string;
  @ApiProperty({ example: '본인인증 방식' }) label!: string;
  @ApiProperty({ description: 'true 꼭(오픈 차단) · false 권장(꺼져 있어도 오픈은 됨)' }) required!: boolean;
  @ApiProperty() ok!: boolean;
  @ApiProperty({ example: 'identity.provider = STUB' }) nowValue!: string;
  @ApiProperty({ example: 'NICE 계약 → 키 3개 → 방식 NICE (docs/214)' }) todo!: string;
  @ApiProperty({ nullable: true, description: '고칠 운영 화면 탭', example: 'integrations' }) go!: string | null;
}

/** v10.150 (D144 · docs/230) — 오픈일 넣기 */
export class SetOpenDateDto {
  @ApiProperty({ example: '2026-12-15', description: '오픈일(YYYY-MM-DD · 한국 시간 · 오늘 이후). 빈 문자열이면 지움(홍보 기간 종료일은 그대로 둠)' })
  @IsString() @Matches(/^$|^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/, { message: '날짜는 YYYY-MM-DD 형식입니다.' })
  date!: string;
}

/** v10.150 — 오픈일과 그에 맞춘 날짜들(서버가 계산 · 한국 시간) */
export class OpenDateDto {
  @ApiProperty({ nullable: true, example: '2026-12-15' }) openDate!: string | null;
  @ApiProperty({ nullable: true, example: '2027-03-15', description: '홍보 기간 종료일(request.view.limit_from) — 이날부터 요청 열람 한도가 자동 적용' }) promoEndsOn!: string | null;
  @ApiProperty({ nullable: true, example: '2026-12-08', description: '약관 게시 마감(시행 7일 전 · 약관 제14조)' }) termsPublishBy!: string | null;
  @ApiProperty({ nullable: true, example: '2026-11-15', description: '불리한 변경이 있으면 게시 마감(시행 30일 전)' }) termsUnfavorableBy!: string | null;
  @ApiProperty({ nullable: true, description: '오늘부터 오픈일까지 남은 날(한국 시간)' }) daysLeft!: number | null;
  @ApiProperty({ description: '게시된 약관 중 시행일이 오픈일과 다른 것 수(오픈일이 있을 때만)' }) termsOtherDate!: number;
}

