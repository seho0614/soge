import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { RequireGate, Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { sendImage } from '../file/attach-images';
import { ListingService } from '../listing/listing.service';
import { LsqSettingsInput, setLsqSettings } from './common';
import { adminBulk, bulkConfirm, bulkPreview, myBulk, myBulkJob } from './bulk';
import { adminReviewAsks } from './review-ask';
import { adminSearchClicks, LSQ_GWAN_RE, searchClick } from './search-click';
import { adminRegions, publicRegionListings, publicRegions } from './region';
import { adminSubRetry, mySubFails, retrySubNow } from './sub-retry';
import { adminTracking, adminTrackingOrder, myTracking, trackJob } from './tracking';
import {
  addPhoto, adminEvidence, adminHidePhoto, adminReturns, adminVerdict, LSQ_CONDITIONS, LSQ_FAULTS, myEvidence, photoBytes, sellerReturns, sellerVerdict, VerdictIn,
} from './return-evidence';
import { lsqDailyJob } from './jobs';

/* ---------------------------------------------------------------------
 * v10.602 ~ 608 (docs/744 ~ 750) 17차 매물 · 소개몰 — 대표 11/21 「모두 개발진행」
 *   LsqController  api/v1 (한 컨트롤러 · 메서드마다 @Roles — check-acl 은 공개 구역 site 만 표시 없이 둠)
 *     공개(로그인 없음 · 개인정보 없음)  POST /site/lsq/search-click · GET /site/lsq/regions · GET /site/lsq/regions/listings
 *     회원   GET /lsq/me/bulk · GET /lsq/me/bulk/{id} · POST /lsq/me/bulk/preview · POST /lsq/me/bulk/{id}/confirm(본인인증)
 *            GET /lsq/me/subscriptions/fails · POST /lsq/me/subscriptions/{id}/retry · GET /lsq/me/orders/{no}/tracking
 *            GET /lsq/returns/{id}/evidence · POST /lsq/returns/{id}/photos · GET /lsq/returns/{id}/photos/{pid}(구매 회원 · 그 주문의 입점 판매자)
 *            GET /lsq/seller/returns · POST /lsq/returns/{id}/verdicts(입점 판매자)
 *     운영(ADMIN · SUPER)  검수 › 매물 일괄 등록 · 거래 후기 요청 · 검색 클릭 분석 · 지역별 소개 페이지 / 소개몰 › 정기 배송 결제 다시 시도 · 배송 추적 · 반품 사진 · 판정
 *            PUT /admin/lsq/settings · POST /admin/lsq/daily/run · POST /admin/lsq/tracking/run 은 SUPER
 *   ★ 세무사(ACCOUNTANT)는 /admin/acct/ 접두가 아니라 보지 않음(규칙 8 · 회계 자료 아님)
 * ------------------------------------------------------------------- */

const MEMBER = ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'] as const;
const me = () => RequestCtx.actorId() ?? '';

export class LsqBulkPreviewDto {
  @ApiProperty({ example: 'gwan,category,title\nMNY,카페,역세권 카페 양도합니다', description: 'CSV 글(UTF-8 · 200KB · 첫 줄 칸 이름 — gwan · category · title 필수)' }) @IsString() @MaxLength(200000) csv!: string;
  @ApiPropertyOptional({ example: 'listings.csv', description: '파일 이름(기록용 · 120자)' }) @IsOptional() @IsString() @MaxLength(120) fileName?: string;
}
export class LsqSearchClickDto {
  @ApiProperty({ example: '카페 양도', description: '검색어(서버가 정규화 · 숫자 3자리 이상 · @ 든 말은 버림)' }) @IsString() @Length(1, 80) q!: string;
  @ApiPropertyOptional({ format: 'uuid', description: '누른 매물(게시 중인 것만 셈)' }) @IsOptional() @IsUUID('all') listingId?: string;
  @ApiProperty({ example: 3, description: '결과 안 순위(1 ~ 100)' }) @IsInt() @Min(1) @Max(100) pos!: number;
  @ApiPropertyOptional({ example: 'ALL', description: '관 탭(ALL · MNY …) — DB CHECK 와 같은 글자' }) @IsOptional() @IsString() @Matches(LSQ_GWAN_RE) gwan?: string;
}
export class LsqReturnPhotoDto {
  @ApiProperty({ format: 'uuid', description: 'POST /files(purpose RETURN_PHOTO) → complete 를 마친 내 파일' }) @IsUUID('all') fileId!: string;
  @ApiPropertyOptional({ example: '포장 뜯기 전 사진', description: '한 줄 메모(200자 · 연락처 가림)' }) @IsOptional() @IsString() @MaxLength(200) note?: string;
}
export class LsqVerdictDto {
  @ApiProperty({ enum: ['INSPECT', 'NOTE'], description: 'INSPECT = 상품 상태 · 책임(둘 다 필수) · NOTE = 메모(2 ~ 500자)' }) @IsIn(['INSPECT', 'NOTE']) kind!: 'INSPECT' | 'NOTE';
  @ApiPropertyOptional({ enum: LSQ_CONDITIONS }) @IsOptional() @IsIn(LSQ_CONDITIONS as unknown as string[]) condition?: string;
  @ApiPropertyOptional({ enum: LSQ_FAULTS }) @IsOptional() @IsIn(LSQ_FAULTS as unknown as string[]) fault?: string;
  @ApiPropertyOptional({ example: '포장 훼손 · 내용물 이상 없음', description: '메모(500자)' }) @IsOptional() @IsString() @MaxLength(500) note?: string;
  @ApiPropertyOptional({ example: true, description: '회원에게 보임(처음 true · false 면 판매자 · 운영만)' }) @IsOptional() @IsBoolean() visibleToBuyer?: boolean;
}
export class LsqSettingsDto {
  @ApiPropertyOptional({ description: 'lsq.bulk' }) @IsOptional() @IsBoolean() bulkOn?: boolean;
  @ApiPropertyOptional({ example: 50 }) @IsOptional() @IsInt() @Min(10) @Max(200) bulkMaxRows?: number;
  @ApiPropertyOptional({ description: 'lsq.review_ask' }) @IsOptional() @IsBoolean() reviewAskOn?: boolean;
  @ApiPropertyOptional({ example: 3 }) @IsOptional() @IsInt() @Min(1) @Max(14) reviewAskDays?: number;
  @ApiPropertyOptional({ example: 7, description: '0 = 다시 묻지 않음' }) @IsOptional() @IsInt() @Min(0) @Max(30) reviewAskAgain?: number;
  @ApiPropertyOptional({ description: 'lsq.search_click' }) @IsOptional() @IsBoolean() searchClickOn?: boolean;
  @ApiPropertyOptional({ example: 180 }) @IsOptional() @IsInt() @Min(30) @Max(730) searchClickKeepDays?: number;
  @ApiPropertyOptional({ description: 'lsq.region_pages' }) @IsOptional() @IsBoolean() regionOn?: boolean;
  @ApiPropertyOptional({ example: 3 }) @IsOptional() @IsInt() @Min(1) @Max(50) regionMin?: number;
  @ApiPropertyOptional({ description: 'lsq.sub_retry' }) @IsOptional() @IsBoolean() subRetryOn?: boolean;
  @ApiPropertyOptional({ example: [1, 3, 5], description: '실패 차례마다 며칠 뒤(1 ~ 14 · 다섯 칸까지)' }) @IsOptional() @IsArray() @ArrayMaxSize(5) @IsInt({ each: true }) @Min(1, { each: true }) @Max(14, { each: true }) subRetryDays?: number[];
  @ApiPropertyOptional({ description: 'lsq.track' }) @IsOptional() @IsBoolean() trackOn?: boolean;
  @ApiPropertyOptional({ enum: ['ASSUME', 'LIVE'] }) @IsOptional() @IsIn(['ASSUME', 'LIVE']) trackMode?: string;
  @ApiPropertyOptional({ description: 'lsq.track_auto_deliver' }) @IsOptional() @IsBoolean() trackAutoDeliver?: boolean;
  @ApiPropertyOptional({ description: 'lsq.return_photos' }) @IsOptional() @IsBoolean() returnPhotosOn?: boolean;
  @ApiPropertyOptional({ example: 5 }) @IsOptional() @IsInt() @Min(1) @Max(10) returnPhotoMax?: number;
  @ApiProperty({ example: '대표 확인 · 매물 일괄 등록 켬' }) @IsString() @Length(2, 200) reason!: string;
}

const verdictIn = (dto: LsqVerdictDto): VerdictIn => {
  const d: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dto)) if (v !== undefined) d[k] = v;   // 규칙 11
  return d as unknown as VerdictIn;
};

@ApiTags('LSQ')
@ApiBearerAuth()
@Controller('api/v1')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class LsqController {
  constructor(private readonly db: DatabaseService, private readonly listings: ListingService) {}

  /* ── 공개 ── */
  @Post('site/lsq/search-click')
  @HttpCode(200)
  @ApiOperation({ summary: '검색 결과 클릭 보내기 (v10.604 · 공개)', description: '로그인 없이 · 날 × 정규화 낱말 × 관 × 순위 수만 더함(계정 · IP · 브라우저 정보 · 쿠키 저장 없음) · lsq.search_click 이 꺼져 있거나 DNT · GPC · 로봇이면 ok:false(오류 아님).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음(쓰지 않음)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LSQ_CLICK_POS · LSQ_CLICK_GWAN · LSQ_CLICK_LISTING' })
  click(@Body() dto: LsqSearchClickDto, @Headers('user-agent') ua?: string, @Headers('dnt') dnt?: string, @Headers('sec-gpc') gpc?: string,
        @Headers('x-forwarded-for') xff?: string, @Ip() ip?: string) {
    return searchClick(this.db, { q: dto.q, listingId: dto.listingId, pos: dto.pos, gwan: dto.gwan }, { ua, dnt, gpc, ip: (xff?.split(',')[0]?.trim() || ip) ?? '' });
  }

  @Get('site/lsq/regions')
  @ApiOperation({ summary: '지역별 소개 — 지역 목록 (v10.605 · 공개)', description: '시 · 도와 그 아래 시 · 군 · 구의 게시 매물 수(lsq.region_min 개 이상만) · 사이트 지도도 씀 · 꺼져 있으면 enabled false.' })
  @ApiOkResponse({ type: Object })
  regions() { return publicRegions(this.db); }

  @Get('site/lsq/regions/listings')
  @ApiOperation({ summary: '지역별 소개 — 그 지역 매물 (v10.605 · 공개)', description: '시 · 도(필수) · 시 · 군 · 구 · 관 · 쪽(30개씩) — 제목 · 한줄 소개 · 업종 · 금액 · 게시일만(등록자 · 연락처 · 상세 주소 없음) · 관별 수 · 많은 업종 10.' })
  @ApiQuery({ name: 'sido', required: true, example: '경기도' }) @ApiQuery({ name: 'sigungu', required: false, example: '수원시' })
  @ApiQuery({ name: 'gwan', required: false, example: 'MNY' }) @ApiQuery({ name: 'page', required: false, example: '1' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: '매물이 문턱보다 적은 지역' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LSQ_REGION_SIDO · LSQ_REGION_SIGUNGU' })
  regionListings(@Query('sido') sido?: string, @Query('sigungu') sigungu?: string, @Query('gwan') gwan?: string, @Query('page') page?: string) {
    return publicRegionListings(this.db, { sido, sigungu, gwan, page });
  }

  /* ── v10.602 매물 CSV 일괄 등록(회원) ── */
  @Get('lsq/me/bulk')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '나의공간 › 매물 일괄 등록 (v10.602)', description: '스위치 · 한 번 줄 수 · 칸 이름 · 양식 CSV · 최근 묶음 10.' })
  @ApiOkResponse({ type: Object })
  bulkMine() { return myBulk(this.db, me()); }

  @Get('lsq/me/bulk/:id')
  @Roles(...MEMBER)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '일괄 등록 묶음 하나 (v10.602)', description: '줄마다 결과(VALID · INVALID · CREATED · FAILED) · 등록한 매물 상태(검수 대기 · 게시 · 반려).' })
  @ApiOkResponse({ type: Object })
  bulkJob(@Param('id') id: string) { return myBulkJob(this.db, me(), id); }

  @Post('lsq/me/bulk/preview')
  @HttpCode(200)
  @Roles(...MEMBER)
  @Audit('LSQ_BULK_PREVIEW', 'LISTING', { pick: ['jobId', 'rows', 'valid', 'invalid'] })
  @ApiOperation({ summary: 'CSV 미리보기 (v10.602)', description: '줄마다 판정(관 · 업종 · 제목 · 금액 · 지역) · 연락처 가림 · 24시간 안에 확정 · lsq.bulk_max_rows 줄 · 200KB.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LSQ_BULK_OFF' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LSQ_BULK_EMPTY · LSQ_BULK_TOO_BIG · LSQ_BULK_HEAD · LSQ_BULK_COLUMNS · LSQ_BULK_TOO_MANY' })
  bulkPreview(@Body() dto: LsqBulkPreviewDto) { return bulkPreview(this.db, me(), dto.csv, dto.fileName); }

  @Post('lsq/me/bulk/:id/confirm')
  @HttpCode(200)
  @Roles(...MEMBER)
  @RequireGate('IDENTITY_VERIFIED')
  @Audit('LSQ_BULK_CONFIRM', 'LISTING', { pick: ['jobId', 'made', 'failed', 'autoApproved'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: 'CSV 확정 — 검수 큐로 (v10.602)', description: 'VALID 줄만 하나씩 기존 매물 등록(POST /listings 와 같은 함수 · 검수 큐 · 자동검수 · 제한업종 · 금칙어 · 슬롯 한도는 DB 가 판정) · 한 줄 실패해도 나머지는 계속 · 두 번 눌러도 한 번만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: '본인인증 필요' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LSQ_BULK_OFF · LSQ_BULK_STATE · LSQ_BULK_EXPIRED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  bulkConfirm(@Param('id') id: string) { return bulkConfirm(this.db, this.listings, me(), id); }

  /* ── v10.606 정기 배송 다시 결제(회원) ── */
  @Get('lsq/me/subscriptions/fails')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '결제가 실패한 내 정기 배송 (v10.606)', description: '실패 수 · 다음 시도일 · 마지막 실패 사유 · 간격표 · 스위치.' })
  @ApiOkResponse({ type: Object })
  subFails() { return mySubFails(this.db, me()); }

  @Post('lsq/me/subscriptions/:id/retry')
  @HttpCode(200)
  @Roles(...MEMBER)
  @Audit('LSQ_SUB_RETRY', 'HLT_ORDER', { pick: ['id', 'result'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '정기 배송 지금 다시 결제 (v10.606)', description: '카드를 바꾼 뒤 · 내 것 · 실패한 것만 · 오늘 회차가 없을 때 · 실패로 멈춘 것은 다시 켬 · 청구는 기존 정기 배송 그대로(mall.subscribe_mode).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LSQ_SUB_RETRY_OFF · LSQ_SUB_NOT_FAILED · LSQ_SUB_CANCELED · LSQ_SUB_TRIED_TODAY' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  subRetry(@Param('id') id: string) { return retrySubNow(this.db, id, me(), 'MEMBER', me()); }

  /* ── v10.607 배송 추적(회원) ── */
  @Get('lsq/me/orders/:no/tracking')
  @Roles(...MEMBER)
  @ApiParam({ name: 'no', example: 'H20261121-0001' })
  @ApiOperation({ summary: '내 주문 택배사 단계 (v10.607)', description: '택배사 조회로 쌓인 단계(장소 · 시각) · 간주(ASSUME)면 source 표시 · 꺼져 있으면 빈 목록.' })
  @ApiOkResponse({ type: Object })
  tracking(@Param('no') no: string) { return myTracking(this.db, me(), no); }

  /* ── v10.608 반품 사진 · 판정 기록(회원 · 입점 판매자) ── */
  @Get('lsq/returns/:id/evidence')
  @Roles(...MEMBER)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '반품 · 교환 사진 · 판정 기록 (v10.608)', description: '구매 회원은 회원에게 보이는 기록만 · 입점 판매자는 모두 · 사진 주소 · 더 붙일 수 있는지.' })
  @ApiOkResponse({ type: Object })
  evidence(@Param('id') id: string) { return myEvidence(this.db, me(), id); }

  @Post('lsq/returns/:id/photos')
  @HttpCode(200)
  @Roles(...MEMBER)
  @Audit('LSQ_RETURN_PHOTO', 'HLT_RETURN', { pick: ['photoId'] })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '반품 사진 붙이기 (v10.608)', description: '구매 회원 · 그 주문의 입점 판매자 · 열린 신청(REQUESTED · APPROVED) · 내가 올린 RETURN_PHOTO · 한쪽 lsq.return_photo_max 장.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LSQ_RETURN_PHOTO_OFF · LSQ_RETURN_CLOSED · LSQ_RETURN_PHOTO_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LSQ_RETURN_PHOTO_FILE · LSQ_RETURN_PHOTO_MAX' })
  photo(@Param('id') id: string, @Body() dto: LsqReturnPhotoDto) { return addPhoto(this.db, me(), id, dto.fileId, dto.note); }

  @Get('lsq/returns/:id/photos/:pid')
  @Roles(...MEMBER)
  @ApiParam({ name: 'id', format: 'uuid' }) @ApiParam({ name: 'pid', example: '1' })
  @ApiOperation({ summary: '반품 사진 보기 (v10.608)', description: '그 신청의 회원 · 판매자만 · 운영이 가린 사진은 없음(409 NOT_FOUND).' })
  @ApiOkResponse({ description: '그림 바이트' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'NOT_FOUND' })
  async photoView(@Param('id') id: string, @Param('pid') pid: string, @Res() res: Response) {
    sendImage(res, await photoBytes(this.db, me(), id, pid));
  }

  @Get('lsq/seller/returns')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '판매자센터 › 반품 사진 · 판정 (v10.608)', description: '내 입점 주문의 반품 · 교환 신청 100(사진 수 · 기록 수).' })
  @ApiOkResponse({ type: Object })
  sellerReturns() { return sellerReturns(this.db, me()); }

  @Post('lsq/returns/:id/verdicts')
  @HttpCode(200)
  @Roles(...MEMBER)
  @Audit('LSQ_RETURN_VERDICT', 'HLT_RETURN', { pick: ['verdictId'] })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '판매자 검수 판정 · 메모 (v10.608)', description: '그 주문의 입점 판매자만 · INSPECT(상품 상태 · 책임) · NOTE · 회원에게 보이면 알림 · 승인 · 반려 · 환불은 바꾸지 않음(근거 기록).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'LSQ_NOT_SELLER' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LSQ_RETURN_PHOTO_OFF' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LSQ_VERDICT_KIND · LSQ_VERDICT_CONDITION · LSQ_VERDICT_FAULT · LSQ_VERDICT_NOTE' })
  sellerVerdict(@Param('id') id: string, @Body() dto: LsqVerdictDto) { return sellerVerdict(this.db, me(), id, verdictIn(dto)); }

  /* ── 운영 ── */
  @Get('admin/lsq/bulk')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '매물 일괄 등록 한눈에 (v10.602)', description: '설정 · 최근 30일 묶음 · 줄 · 등록 · 실패 · 등록 매물 상태(검수 대기 · 게시 · 반려) · 최근 묶음 50(가린 이름 · 글 없음).' })
  @ApiOkResponse({ type: Object })
  adminBulk() { return adminBulk(this.db); }

  @Get('admin/lsq/review-asks')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '거래 후기 요청 (v10.603)', description: '설정 · 최근 30일 요청 · 다시 요청 · 요청 뒤 쓴 후기(전환율 · 평균 일수) · 성사 · 후기 수 · 날마다.' })
  @ApiOkResponse({ type: Object })
  adminReviewAsks() { return adminReviewAsks(this.db); }

  @Post('admin/lsq/daily/run')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('LSQ_DAILY_RUN', 'SITE_SETTING')
  @ApiOperation({ summary: '17차 하루 일 지금 한 번 (v10.603 · SUPER)', description: 'lsq_daily 와 같음 — 후기 요청(lsq.review_ask on) · 미리보기 지난 CSV 묶음 정리 · 보관 지난 검색 클릭 정리.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음(쓰지 않음)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '없음(쓰지 않음)' })
  dailyRun() { return lsqDailyJob(this.db); }

  @Get('admin/lsq/search-clicks')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'days', required: false, enum: ['1', '7', '30', '90'] })
  @ApiOperation({ summary: '검색 클릭 분석 (v10.604)', description: '최근 N일 클릭 · 낱말 수 · 평균 순위 · 1 ~ 3위 비율 · 낱말 100(검색 수와 나란히) · 순위 분포 · 많이 눌린 매물 50 — 누가 눌렀는지 없음.' })
  @ApiOkResponse({ type: Object })
  adminClicks(@Query('days') days?: string) { return adminSearchClicks(this.db, days); }

  @Get('admin/lsq/regions')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '지역별 소개 페이지 (v10.605)', description: '설정 · 공개될 시 · 도 · 시 · 군 · 구 수 · 문턱 아래 · 지역 모름 매물 수 · 지역 표 100.' })
  @ApiOkResponse({ type: Object })
  adminRegions() { return adminRegions(this.db); }

  @Get('admin/lsq/sub-retry')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '정기 배송 결제 다시 시도 (v10.606)', description: '설정 · 정기 배송 방식 · 실패 중 100(가린 이름) · 최근 실패 50 · 「지금 다시」 기록 30.' })
  @ApiOkResponse({ type: Object })
  adminSubRetry() { return adminSubRetry(this.db); }

  @Post('admin/lsq/sub-retry/:id/run')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @Audit('LSQ_SUB_RETRY_ADMIN', 'HLT_ORDER', { pick: ['id', 'result'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '정기 배송 지금 다시 결제 — 운영 (v10.606)', description: '실패한 것만 · 오늘 회차가 없을 때 · 그 한 건만 기존 정기 배송 작업으로 청구(스위치와 상관없이).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LSQ_SUB_NOT_FAILED · LSQ_SUB_CANCELED · LSQ_SUB_TRIED_TODAY' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  adminSubRun(@Param('id') id: string) { return retrySubNow(this.db, id, null, 'ADMIN', RequestCtx.actorId() ?? null); }

  @Get('admin/lsq/tracking')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '배송 추적 (v10.607)', description: '설정 · 준비 상태(키 · 방식) · 배송중 · 24시간 조회 · 오류 · 30일 배송 완료 반영 · 최근 조회 50.' })
  @ApiOkResponse({ type: Object })
  adminTracking() { return adminTracking(this.db); }

  @Get('admin/lsq/tracking/orders/:no')
  @Roles('ADMIN', 'SUPER')
  @ApiParam({ name: 'no', example: 'H20261121-0001' })
  @ApiOperation({ summary: '주문 하나의 택배사 단계 (v10.607)', description: '쌓인 단계 100(간주 · LIVE 표시).' })
  @ApiOkResponse({ type: Object })
  adminTrackingOrder(@Param('no') no: string) { return adminTrackingOrder(this.db, no); }

  @Post('admin/lsq/tracking/run')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('LSQ_TRACK_RUN', 'SITE_SETTING')
  @ApiOperation({ summary: '배송 추적 지금 한 번 (v10.607 · SUPER)', description: 'lsq_track 과 같음 — 스위치와 상관없이 지금 방식(처음 ASSUME)으로 한 번(켜기 전 미리 봄).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음(쓰지 않음)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '없음(쓰지 않음)' })
  trackRun() { return trackJob(this.db, true); }

  @Get('admin/lsq/returns')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'state', required: false, enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED'] })
  @ApiOperation({ summary: '반품 사진 · 판정 목록 (v10.608)', description: '신청 100(사진 수 · 검수 기록 수 · 가린 이름) · 상태 거르기 · 상품 상태 · 책임 목록.' })
  @ApiOkResponse({ type: Object })
  adminReturns(@Query('state') state?: string) { return adminReturns(this.db, state); }

  @Get('admin/lsq/returns/:id')
  @Roles('ADMIN', 'SUPER')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '반품 하나의 사진 · 판정 기록 (v10.608)', description: '가린 사진 포함 · 회원에게 안 보이는 기록 포함.' })
  @ApiOkResponse({ type: Object })
  adminEvidence(@Param('id') id: string) { return adminEvidence(this.db, id); }

  @Post('admin/lsq/returns/:id/verdicts')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @Audit('LSQ_RETURN_VERDICT_ADMIN', 'HLT_RETURN', { pick: ['verdictId'] })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '운영 검수 판정 · 메모 (v10.608)', description: 'INSPECT(상품 상태 · 책임) · NOTE · 회원에게 보이면 알림 · 쌓기만(고치기 없음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음(쓰지 않음)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LSQ_VERDICT_KIND · LSQ_VERDICT_CONDITION · LSQ_VERDICT_FAULT · LSQ_VERDICT_NOTE' })
  adminVerdict(@Param('id') id: string, @Body() dto: LsqVerdictDto) { return adminVerdict(this.db, RequestCtx.actorId() ?? null, id, verdictIn(dto)); }

  @Post('admin/lsq/returns/:id/photos/:pid/hide')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @Audit('LSQ_RETURN_PHOTO_HIDE', 'HLT_RETURN')
  @ApiParam({ name: 'id', format: 'uuid' }) @ApiParam({ name: 'pid', example: '1' })
  @ApiOperation({ summary: '반품 사진 가리기 (v10.608)', description: '지우지 않고 회원 · 판매자에게 안 보이게(기록은 남음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LSQ_PHOTO_HIDDEN' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  adminHide(@Param('id') id: string, @Param('pid') pid: string) { return adminHidePhoto(this.db, RequestCtx.actorId() ?? null, id, pid); }

  @Put('admin/lsq/settings')
  @Roles('SUPER')
  @Audit('LSQ_SETTINGS', 'SITE_SETTING')
  @ApiOperation({ summary: '17차 매물 · 소개몰 설정 (v10.602 ~ 608 · SUPER)', description: '일괄 등록 · 후기 요청 · 검색 클릭 · 지역 페이지 · 정기 배송 다시 시도 · 배송 추적(방식 · 배송 완료 반영) · 반품 사진 — 사유는 설정 바뀜 기록 · 보낸 칸만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음(쓰지 않음)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LSQ_REASON · LSQ_SETTING_VALUE · LSQ_NOTHING' })
  settings(@Body() dto: LsqSettingsDto) {
    const d: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto)) if (v !== undefined) d[k] = v;   // 규칙 11 — 안 보낸 칸은 덮지 않음
    return setLsqSettings(this.db, d as unknown as LsqSettingsInput);
  }
}
