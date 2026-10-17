import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/* ★ 관을 늘릴 때 **여기도 고쳐야 합니다.** 건강상품관을 만들었을 때
 *   이 배열을 놓쳐, DB 에는 있는데 API 가 "허용되지 않은 값" 으로
 *   막았습니다. 검정이 gwans 표와 대조합니다. */
const GWAN = ['MNY', 'MAL', 'BIZ', 'HLT'] as const;
const FEE_BEARER = ['BUYER', 'SELLER', 'NEGOTIABLE'] as const;
const LISTING_STATUS = ['DRAFT','IN_REVIEW','PUBLISHED','REJECTED','SUSPENDED','ARCHIVED'] as const;
/* 20260930 — POPULAR 추가, 소문자 별칭(new · best · fee) 허용.
 * 사용자 웹이 보내는 값과 서버가 받는 값이 달라 목록 3종이 404, '베스트' 가 500 이었습니다. */
/* v10.31 — 시안 정렬 「마감임박 · 소개비율」 = DEADLINE · FEE_RATIO (별칭 deadline · ratio) */
const SORT = ['RECENT', 'RELEVANCE', 'FEE_DESC', 'POPULAR', 'DEADLINE', 'FEE_RATIO', 'AMOUNT_ASC', 'AMOUNT_DESC',
  'new', 'recent', 'best', 'popular', 'fee', 'deadline', 'ratio'] as const;

/* ── 요청 ───────────────────────────────────────────────── */

/* v10.31 — 시안 SUPPORT · WISH · HANDOVER 목록 그대로 */
export const CONTRACT_SUPPORT = ['계약서 검토 지원', '세무 · 회계 지원', '인수 인계 지원', '교육 지원', '지원 없음'] as const;
export class ListingAddressDto {
  @ApiPropertyOptional({ maxLength: 10 }) @IsOptional() @IsString() @MaxLength(10) zip?: string;
  @ApiPropertyOptional({ maxLength: 120 }) @IsOptional() @IsString() @MaxLength(120) road?: string;
  @ApiPropertyOptional({ maxLength: 120 }) @IsOptional() @IsString() @MaxLength(120) detail?: string;
  @ApiPropertyOptional({ maxLength: 20 }) @IsOptional() @IsString() @MaxLength(20) sido?: string;
  @ApiPropertyOptional({ maxLength: 30 }) @IsOptional() @IsString() @MaxLength(30) sigungu?: string;
}
export class ListingBizInfoDto {
  @ApiPropertyOptional({ maxLength: 40, example: '99.2m² (약 30평)' }) @IsOptional() @IsString() @MaxLength(40) size?: string;
  @ApiPropertyOptional({ maxLength: 40, example: '8,000만원 내외' }) @IsOptional() @IsString() @MaxLength(40) sales?: string;
  @ApiPropertyOptional({ maxLength: 40, example: '협의 가능' }) @IsOptional() @IsString() @MaxLength(40) premium?: string;
  @ApiPropertyOptional({ enum: ['즉시 인계 희망', '협의 후 결정', '3개월 내', '6개월 내', '기한 없음'] })
  @IsOptional() @IsIn(['즉시 인계 희망', '협의 후 결정', '3개월 내', '6개월 내', '기한 없음']) wish?: string;
  @ApiPropertyOptional({ enum: ['운영 교육 지원', '거래처 승계', '직원 승계', '설비 · 집기 포함', '지원 없음'] })
  @IsOptional() @IsIn(['운영 교육 지원', '거래처 승계', '직원 승계', '설비 · 집기 포함', '지원 없음']) handover?: string;
  @ApiPropertyOptional({ maxLength: 60, example: '운영 노하우 전수' }) @IsOptional() @IsString() @MaxLength(60) etc?: string;
}

export class CreateListingDto {
  @ApiProperty({ enum: GWAN })
  @IsIn(GWAN) gwanCode!: string;

  @ApiProperty({ format: 'uuid', description: '승인된 업종만 허용됩니다' })
  @IsUUID('all') categoryId!: string;

  @ApiProperty({ minLength: 5, maxLength: 100 })
  @IsString() @MinLength(5) @MaxLength(100) title!: string;

  @ApiPropertyOptional({
    maxLength: 5000,
    description: '30자 미만이면 자동검수를 통과하지 못하고 사람이 봅니다',
  })
  @IsOptional() @IsString() @MaxLength(5000) body?: string;

  @ApiPropertyOptional({
    minimum: 0, example: 3000000,
    description: '희망 소개비. 플랫폼이 계산하지 않습니다 (A-12). 최종 금액은 당사자 합의입니다',
  })
  @IsOptional() @IsInt() @Min(0) desiredFee?: number;

  @ApiPropertyOptional({ enum: FEE_BEARER })
  @IsOptional() @IsIn(FEE_BEARER) feeBearer?: string;

  @ApiPropertyOptional({ type: [String], description: '시 · 도 코드(법정동 10자리 · GET /market/regions). 첫 것이 카드의 지역입니다' })
  @IsOptional() @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) regionCodes?: string[];

  @ApiPropertyOptional({ type: [String], description: 'v10.31 — 사진 파일 id(POST /files · purpose LISTING_IMAGE → complete 를 마친 것 · 내가 올린 것만) · 10장까지. 첫 장이 대표 사진. 수정에서 빼면 사진을 그대로 둡니다' })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) mediaKeys?: string[];

  /* v10.31 (w1) — 시안 등록 폼(SB-HOM-REG-010)의 칸. 모두 선택 — 예전 화면 · 다른 관 화면은 보내지 않아도 됩니다 */
  @ApiPropertyOptional({ maxLength: 60, description: '한줄 소개(카드 · 상세 부제)' }) @IsOptional() @IsString() @MaxLength(60) summary?: string;
  @ApiPropertyOptional({ enum: CONTRACT_SUPPORT, description: '계약 지원' }) @IsOptional() @IsIn(CONTRACT_SUPPORT) contractSupport?: string;
  @ApiPropertyOptional({ maxLength: 60, example: '평일 10:00 ~ 18:00' }) @IsOptional() @IsString() @MaxLength(60) contactHours?: string;
  @ApiPropertyOptional({ type: () => ListingAddressDto, description: '소재지 — 상세주소는 본인 · 운영만 봅니다' })
  @IsOptional() @ValidateNested() @Type(() => ListingAddressDto) address?: ListingAddressDto;
  @ApiPropertyOptional({ type: () => ListingBizInfoDto, description: '거래 및 운영 정보' })
  @IsOptional() @ValidateNested() @Type(() => ListingBizInfoDto) bizInfo?: ListingBizInfoDto;

  /* v10.31 (w2) — 관 화면 카드 */
  @ApiPropertyOptional({ minimum: 0, example: 62000000, description: 'v10.31 — 거래(희망) 금액(원). 소개비율 정렬의 분모 · 플랫폼이 계산하지 않습니다(A-12)' })
  @IsOptional() @IsInt() @Min(0) dealAmount?: number;

  @ApiPropertyOptional({ maxLength: 30, example: '수원시', description: 'v10.31 — 시군구(글자)' })
  @IsOptional() @IsString() @MaxLength(30) regionDetail?: string;
}

export class UpdateListingDto extends CreateListingDto {
  @ApiProperty({
    description: '낙관적 잠금. 서버 version 과 다르면 409. 수정은 재검수를 유발합니다',
    example: 3,
  })
  @IsInt() version!: number;
}

export class ListingQueryDto {
  @ApiPropertyOptional({ enum: GWAN }) @IsOptional() @IsIn(GWAN) gwanCode?: string;
  @ApiPropertyOptional({ enum: GWAN, description: 'gwanCode 의 별칭 (예전 화면 호환)' })
  @IsOptional() @IsIn(GWAN) gwan?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID('all') categoryId?: string;
  @ApiPropertyOptional({ description: '제목 부분 일치' }) @IsOptional() @IsString() keyword?: string;
  /* v10.31 (w1 · 공유) — 통합 검색(SB-HOM-SRC-010)은 시안대로 「제목 · 업종에 그 낱말이 든 것」만. 빼면 전과 같음(제목 + 본문) */
  @ApiPropertyOptional({ enum: ['TITLE'], description: 'TITLE 이면 keyword 를 제목 · 업종 이름에서만 찾습니다(본문 제외)' })
  @IsOptional() @IsIn(['TITLE']) match?: string;
  @ApiPropertyOptional({ enum: ['URGENT','VERIFIED_DOC'], description: '배지 필터' })
  @IsOptional() @IsString() badge?: string;
  @ApiPropertyOptional({ enum: SORT, default: 'RECENT' })
  @IsOptional() @IsIn(SORT) sort?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional() @IsInt() @Min(1) @Max(50) limit?: number;

  /* ── v10.31 (시안 기준) ── */
  @ApiPropertyOptional({ description: '시 · 도 코드(GET /market/regions) 또는 ETC(시안 「기타 지역」 — 지역으로 찾기 9곳 밖). 매물 지역이 없으면 인증 사업장 주소로 봅니다' })
  @IsOptional() @IsString() @MaxLength(12) regionCode?: string;
  @ApiPropertyOptional({ enum: ['RE', 'EQUIP', 'CONSULT'], description: '안심소개 축(부동산 · 기계 · 설비 · 시설 · 생활 · 금융 상담)' })
  @IsOptional() @IsIn(['RE', 'EQUIP', 'CONSULT']) axis?: string;
  @ApiPropertyOptional({ enum: ['ANY', 'BUY', 'SELL'], description: '급구 · 급매 표시가 있는 것만 — BUY 급구 · SELL 급매 · ANY 둘 다' })
  @IsOptional() @IsIn(['ANY', 'BUY', 'SELL']) urgent?: string;
  @ApiPropertyOptional({ enum: ['RE', 'CAR', 'BIZ', 'MACHINE', 'LIFE'], description: '분류 묶음(급구 · 급매 화면: 부동산 · 자동차 · 창업/프랜차이즈 · 기계/설비 · 생활/기타)' })
  @IsOptional() @IsIn(['RE', 'CAR', 'BIZ', 'MACHINE', 'LIFE']) group?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 500, description: '쪽 번호(시안 「1 · 2 · …」). 주면 total · pageCount 가 함께 오고 nextCursor 는 null' })
  @IsOptional() @IsInt() @Min(1) @Max(500) page?: number;
  @ApiPropertyOptional({ enum: ['1'], description: '1 이면 커서 목록에도 total 을 싣습니다' })
  @IsOptional() @IsIn(['1', 'true']) withTotal?: string;
}

/** v10.31 — 급구 · 급매 표시 신청 */
export class ListingBadgeRequestDto {
  @ApiProperty({ enum: ['URGENT', 'URGENT_SALE'], description: 'URGENT 급구(급하게 구함) · URGENT_SALE 급매(빠르게 팖)' })
  @IsIn(['URGENT', 'URGENT_SALE']) type!: string;
  @ApiProperty({ minLength: 5, maxLength: 200, description: '급한 사유(검수자가 봅니다)' })
  @IsString() @MinLength(5) @MaxLength(200) reason!: string;
  @ApiProperty({ format: 'date', example: '2026-10-20', description: '기한 — 최대 정책값(urgent_max_days)일까지' })
  @IsString() @MaxLength(30) until!: string;
}

/** v10.31 — 사진 붙이기 */
export class AddPhotoDto {
  @ApiProperty({ format: 'uuid', description: '올리기를 마친 LISTING_IMAGE 파일 id' })
  @IsUUID('all') fileId!: string;
}

/* ── 응답 ───────────────────────────────────────────────── */

export class ListingBadgeDto {
  @ApiProperty({ enum: ['URGENT','VERIFIED_DOC'] }) type!: string;
  @ApiProperty({ example: '급구', description: '표시 문구. code_labels 가 정본입니다' }) label!: string;
  @ApiPropertyOptional({ format: 'date-time', description: '급구만. 이후 자동 해제' }) validUntil?: string;
}

export class ListingOwnerDto {
  @ApiProperty({ example: '㈜대한기계' }) companyName!: string;
  @ApiProperty({ description: '사업자 인증 완료 여부. 품질 보증이 아니라 사실 표시입니다' })
  verified!: boolean;
  @ApiProperty({ example: 12, description: '성사 확정 건수' }) confirmedDeals!: number;
}

/** 상세의 등록자 — 공개 실적이 붙습니다 (v10.21 · D023). 목록 카드에는 싣지 않습니다. */
export class ListingOwnerDetailDto extends ListingOwnerDto {
  @ApiProperty({ format: 'date-time', description: '가입일' }) joinedAt!: string;
  @ApiProperty({ example: 128, description: '소개자로 참여한 거래 수(총 소개)' }) totalDeals!: number;
  @ApiProperty({ nullable: true, example: 32.8, description: '성사율(%) · 소수 1자리. 총 소개가 0 이면 null' })
  successRate!: number | null;
  @ApiProperty({
    nullable: true, example: 15680000,
    description: '누적수익(정산받은 소개비 합계 · 원). **본인이 공개를 켠 경우에만** 값이 있고, 아니면 null 입니다',
  })
  settledAmount!: number | null;
  @ApiProperty({ description: '누적수익 공개 여부 (마이 > 내 정보에서 본인이 켭니다)' }) earningsPublic!: boolean;
  @ApiProperty({ example: 3, description: '받은 후기 수' }) reviewCount!: number;
  @ApiProperty({ nullable: true, example: 4.7, description: '평균 평점(1~5) · 후기가 없으면 null' })
  rating!: number | null;
}

/** 등록자(소개자) 후기 한 건. 누구나 보므로 작성자는 이름 첫 글자만 내보냅니다. */
export class ListingReviewDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '김○○', description: '작성자 표시명 — 이름 첫 글자만' }) authorName!: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) rating!: number;
  @ApiProperty({ nullable: true, description: '연락처·이메일은 마스킹된 상태로 옵니다' }) body!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ListingReviewListDto {
  @ApiProperty({ example: 3, description: '받은 후기 전체 수' }) count!: number;
  @ApiProperty({ nullable: true, example: 4.7, description: '평균 평점 · 후기가 없으면 null' }) average!: number | null;
  @ApiProperty({ type: [ListingReviewDto], description: '최근 20건' }) items!: ListingReviewDto[];
}

/** 목록 카드. 금액이 시각적 정점이 되도록 앞에 둡니다. */
export class ListingCardDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: GWAN }) gwanCode!: string;
  @ApiProperty() categoryName!: string;
  @ApiProperty() title!: string;

  @ApiProperty({ nullable: true, example: 3000000, description: '원 단위 정수' })
  desiredFee!: number | null;
  @ApiProperty({ nullable: true, example: '매수인 부담' }) feeBearerLabel!: string | null;

  @ApiProperty({ type: ListingOwnerDto }) owner!: ListingOwnerDto;
  @ApiProperty({ type: [ListingBadgeDto] }) badges!: ListingBadgeDto[];

  @ApiProperty({
    description: '유료 우선노출 여부. true 면 label 을 반드시 함께 표시해야 합니다 (전상법)',
  })
  isAd!: boolean;
  @ApiProperty({ nullable: true, example: '광고' }) adLabel!: string | null;

  @ApiProperty({ nullable: true, format: 'date-time' }) publishedAt!: string | null;
  @ApiProperty() likeCount!: number;
  @ApiProperty({ description: '요청자가 관심 등록했는지' }) liked!: boolean;
  /* v10.31 — 시안 검색 결과 표의 「등급 · 조회」 */
  @ApiPropertyOptional({ example: 'G1' }) gradeCode?: string;
  @ApiPropertyOptional({ example: '골든', nullable: true, description: '등급 이름(가칭 — 골든 · 실버 · 브론즈)' }) gradeLabel?: string | null;
  @ApiPropertyOptional({ example: 1284 }) viewCount?: number;

  /* ── v10.31 (시안 카드) ── */
  @ApiProperty({ example: 4471, description: '사람이 읽는 매물번호(시안 「L-4471」)' }) listingNo!: number;
  @ApiProperty({ nullable: true, description: '한줄 소개' }) summary!: string | null;
  @ApiProperty({ nullable: true, example: 62000000, description: '거래(희망) 금액(원)' }) dealAmount!: number | null;
  @ApiProperty({ description: '안심소개 부동산 축(RE) — 소개비가 아니라 노출료(A-07)' }) isRealty!: boolean;
  @ApiProperty({ nullable: true, description: '지역 {sidoCode, sido, sigungu} — 매물 지역이 없으면 인증 사업장 주소' }) region!: { sidoCode: string | null; sido: string; sigungu: string | null } | null;
  @ApiProperty({ nullable: true, example: '/api/v1/listings/{id}/photos/0', description: '대표 사진 주소 — 없으면 null(분류 그림)' }) thumbUrl!: string | null;
  @ApiProperty({ example: 5, description: '사진 장수' }) photoCount!: number;
  @ApiProperty({ nullable: true, example: 87.9, description: '소개 신뢰도(등록자 · 0~100 · v_account_trust)' }) trustScore!: number | null;
  @ApiProperty({ nullable: true, description: '급구 · 급매 {kind: BUY|SELL, label, until}' }) urgent!: { kind: string; label: string; until: string } | null;
}

export class ListingDetailDto extends ListingCardDto {
  @ApiProperty({ type: ListingOwnerDetailDto, description: '등록자 + 공개 실적' }) declare owner: ListingOwnerDetailDto;
  @ApiProperty({ example: 342, description: '조회 수' }) declare viewCount: number;
  @ApiProperty({ nullable: true }) body!: string | null;
  @ApiProperty({ enum: LISTING_STATUS }) status!: string;
  @ApiProperty({ example: '노출 중' }) statusLabel!: string;
  @ApiProperty({ type: [String], description: 'v10.31 — 사진 공개 주소(GET /listings/{id}/photos/{n})' }) mediaUrls!: string[];
  @ApiProperty({ type: [String], description: 'v10.31 — 사진 줄 id(주인이 뗄 때 · DELETE /listings/{id}/photos/{mediaId})' }) mediaIds!: string[];
  @ApiProperty({ type: [String], description: '「시도 시군구」 한 줄' }) regionNames!: string[];
  @ApiProperty({ nullable: true }) regionCode!: string | null;
  @ApiProperty({ nullable: true }) regionDetail!: string | null;
  @ApiProperty({ format: 'uuid' }) categoryId!: string;
  @ApiProperty({ nullable: true }) feeBearer!: string | null;
  @ApiProperty({ description: 'v10.31 — 소개 신뢰도와 항목(사업자 인증 · 본인인증 · 성사 · 성사율 · 평점 · 분쟁)' }) trust!: Record<string, unknown>;
  @ApiProperty({ example: 3, description: '수정 시 이 값을 함께 보냅니다' }) version!: number;
  @ApiProperty({ description: '문의 가능 여부. false 면 reason 을 안내합니다' }) canInquire!: boolean;
  @ApiPropertyOptional({
    enum: ['IDENTITY_REQUIRED','OWN_LISTING'],
    description: 'canInquire=false 인 이유',
  })
  inquireBlockReason?: string;
  /* v10.46 (docs/96) */
  @ApiPropertyOptional({ type: () => ListingGeoDto, nullable: true,
    description: '지도 좌표. 지도 사용이 꺼져 있으면 null. 남에게는 REGION(시 · 구 중심 · 반경)만 — 정확 좌표(EXACT)는 등록자 본인에게만' })
  geo?: ListingGeoDto | null;
}

/** v10.46 (docs/96) — 매물 상세의 지도 좌표 */
export class ListingGeoDto {
  @ApiProperty({ enum: ['REGION', 'EXACT'] }) precision!: string;
  @ApiPropertyOptional({ enum: ['OK', 'PENDING', 'FAILED', 'NOT_FOUND'], description: 'EXACT(본인)일 때만' }) status?: string;
  @ApiPropertyOptional({ example: 37.5172 }) lat?: number;
  @ApiPropertyOptional({ example: 127.0473 }) lng?: number;
  @ApiPropertyOptional({ example: 2000, description: 'REGION 일 때 원 반지름(m)' }) radiusM?: number;
  @ApiPropertyOptional({ example: '서울 강남구', description: 'REGION 일 때 시 · 구 이름' }) label?: string;
}

/** 목록 응답. 광고와 일반을 섞지 않습니다 — 섞으면 프런트가 라벨을 빠뜨립니다. */
export class ListingListDto {
  @ApiProperty({ type: [ListingCardDto], description: '유료 우선노출 영역. 라벨 필수' })
  promoted!: ListingCardDto[];
  @ApiProperty({ type: [ListingCardDto], description: '기본 목록. 구독 가중치 미적용' })
  organic!: ListingCardDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;
  @ApiProperty({ example: '광고 영역은 유료 노출입니다.' }) adNotice!: string;
  @ApiPropertyOptional({ description: 'v10.31 — page 또는 withTotal 을 줬을 때 같은 조건의 전체 건수' }) total?: number;
  @ApiPropertyOptional() page?: number;
  @ApiPropertyOptional() pageCount?: number;
}

export class CreateListingResultDto {
  @ApiProperty({ format: 'uuid' }) listingId!: string;
  @ApiProperty({ format: 'uuid' }) reviewId!: string;
  @ApiProperty({ enum: LISTING_STATUS, example: 'IN_REVIEW' }) status!: string;
  @ApiProperty({
    example: false,
    description: '자동검수로 즉시 노출된 경우 true. 이때 status 는 PUBLISHED',
  })
  autoApproved!: boolean;
}
