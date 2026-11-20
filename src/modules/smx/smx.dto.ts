import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * v10.553 ~ 555 (D287 · docs/691 ~ 693) (57) 소개몰 3 — 입력 · 응답 형식
 *   ★ DTO 이름은 src 전체에서 고유(Smx 앞머리) · 쓰는 DTO 를 먼저 적음(ts-node 선언 순서 — 규칙 4)
 *   ★ 주문 입력 OrderCreateDto 는 health-shop.dto.ts 에 그대로 두고 bundles 칸만 이 파일의 SmxOrderBundleInDto 로 더함
 *     (test_v1096 이 health-shop.dto.ts 의 DTO 수 14 를 봄 — 새 DTO 를 그 파일에 만들지 않음)
 *   정규식은 DB CHECK 와 같음(규칙 2): 묶음 코드 ck_hlt_bundle_code · 우편번호 ck_smx_rz_from/to
 * ------------------------------------------------------------------- */

/** 주문에 담는 묶음 한 줄 — POST /health/orders 의 bundles[] */
export class SmxOrderBundleInDto {
  @ApiProperty({ example: 'SET-VITA-2', description: '묶음 코드(대문자 · 숫자 · - · 3 ~ 30자)' })
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9-]{2,29}$/) code!: string;
  @ApiProperty({ example: 1, description: '묶음 수량(1 ~ 20 · 묶음마다 한 번에 살 수 있는 수 안)' })
  @IsInt() @Min(1) @Max(20) qty!: number;
}

/** 묶음 구성 한 줄(운영) */
export class SmxBundleItemInDto {
  @ApiProperty({ format: 'uuid', description: '직판 상품의 옵션 번호' }) @IsUUID() optionId!: string;
  @ApiProperty({ example: 1, description: '구성 수량(1 ~ 20)' }) @IsInt() @Min(1) @Max(20) qty!: number;
}

/** 묶음 만들기 · 고치기(운영) — 구성은 판매 중이 아닐 때만 바뀜(DB) */
export class SmxBundleSaveDto {
  @ApiProperty({ example: 'SET-VITA-2' }) @IsString() @Matches(/^[A-Z0-9][A-Z0-9-]{2,29}$/) code!: string;
  @ApiProperty({ example: '비타민 두 달 세트' }) @IsString() @Length(2, 60) name!: string;
  @ApiPropertyOptional({ example: '아침 · 저녁 두 가지를 한 번에', description: '한 줄 설명(200자)' }) @IsOptional() @IsString() @MaxLength(200) summary?: string;
  @ApiProperty({ example: 39000, description: '묶음가(원 · 1 ~ 100,000,000)' }) @IsInt() @Min(1) @Max(100000000) price!: number;
  @ApiPropertyOptional({ example: 5, description: '한 주문에 살 수 있는 묶음 수(1 ~ 20 · 처음 5)' }) @IsOptional() @IsInt() @Min(1) @Max(20) maxPerOrder?: number;
  @ApiProperty({ type: [SmxBundleItemInDto], description: '구성(1 ~ 10줄 · 판매 시작은 2줄 이상 · 수량 1 인 줄 하나 이상)' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SmxBundleItemInDto) items!: SmxBundleItemInDto[];
}

export class SmxBundleStateDto {
  @ApiProperty({ enum: ['ON_SALE', 'STOPPED'], description: '판매 시작 · 다시 판매(ON_SALE) · 멈춤(STOPPED)' }) @IsIn(['ON_SALE', 'STOPPED']) state!: 'ON_SALE' | 'STOPPED';
}

/** 도서산간 구역 만들기 · 고치기(운영) */
export class SmxRemoteZoneSaveDto {
  @ApiProperty({ example: '제주특별자치도' }) @IsString() @Length(2, 40) name!: string;
  @ApiProperty({ enum: ['JEJU', 'ISLAND', 'MOUNTAIN', 'OTHER'] }) @IsIn(['JEJU', 'ISLAND', 'MOUNTAIN', 'OTHER']) kind!: string;
  @ApiProperty({ example: '63000', description: '우편번호 처음(5자리 · 포함)' }) @IsString() @Matches(/^[0-9]{5}$/) zipFrom!: string;
  @ApiProperty({ example: '63644', description: '우편번호 끝(5자리 · 포함)' }) @IsString() @Matches(/^[0-9]{5}$/) zipTo!: string;
  @ApiProperty({ example: 3000, description: '추가 배송비(원 · 0 ~ 100,000)' }) @IsInt() @Min(0) @Max(100000) fee!: number;
  @ApiPropertyOptional({ description: '켬(처음 true)' }) @IsOptional() @StrictBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: '메모(200자)' }) @IsOptional() @IsString() @MaxLength(200) memo?: string;
}

/** 답글 쓰기 · 고치기(판매자 · 운영) */
export class SmxReplySaveDto {
  @ApiProperty({ example: '소중한 리뷰 고맙습니다. 다음에도 꼼꼼히 챙기겠습니다.', description: '2 ~ 1,000자' }) @IsString() @Length(2, 1000) body!: string;
}

/** 답글 보이기 · 가리기(운영) */
export class SmxReplyDecideDto {
  @ApiProperty({ enum: ['SHOW', 'HIDE'] }) @IsIn(['SHOW', 'HIDE']) action!: 'SHOW' | 'HIDE';
  @ApiPropertyOptional({ description: '가리는 사유(HIDE 때 2 ~ 200자 · 답글 쓴 쪽에 보임)' }) @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/** 공개 리뷰 목록 줄의 답글(smx.review_reply on · 보이는 답글만) */
export class SmxReplyViewDto {
  @ApiProperty({ enum: ['SELLER', 'STAFF'] }) kind!: string;
  @ApiPropertyOptional({ nullable: true, description: '입점 판매자 이름(운영자 답글은 null — 화면이 「소개몰」로 보임)' }) byName!: string | null;
  @ApiProperty() body!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
  @ApiProperty({ description: '고친 적이 있음' }) edited!: boolean;
}
