import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { LPX_AMOUNT_RE, LPX_DATE_RE, LPX_GWAN_RE, LPX_POSITIONS, LPX_YM_RE, LpxSettingsInput, setLpxSettings } from './common';
import { acceptOffer, adminOffers, counterOffer, makeOffer, myOffers, offerBoxFor, rejectOffer, reofferOffer, withdrawOffer } from './offers';
import { adminAway, endAway, myAway, setAway } from './away';
import { adminMark, listingExtras } from './watermark';
import { adminStats, publicStats, statsRunNow } from './stats';
import { lpxHourlyJob } from './jobs';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * v10.549 ~ 552 (D286 · docs/687 ~ 690) (56) 매물 3 — 대표 11/21
 *   LpxController  api/v1 (한 컨트롤러 · 메서드마다 @Roles — check-acl 은 공개 구역 site 만 표시 없이 둠)
 *     공개(로그인 없음 · 개인정보 없음)  GET /site/lpx/listings/{id}(워터마크 표시 정보 · 자리 비움 · 가격 제안 켜짐 · 그 칸 시세) · GET /site/lpx/price-stats
 *     회원                               GET /lpx/listings/{id}/offer · POST /lpx/listings/{id}/offers · GET /lpx/me/offers
 *                                        POST /lpx/offers/{id}/accept · /reject · /counter · /reoffer · /withdraw(되제안 · 다시 제안 합쳐 lpx.offer_counter_max 번 · 대표 11/21)
 *                                        GET · PUT /lpx/me/away · POST /lpx/me/away/end
 *     운영(ADMIN · SUPER — 검수 › 매물 3)  GET /admin/lpx/offers · /watermark · /away · /stats · POST /admin/lpx/offers/run · /stats/run(SUPER) · PUT /admin/lpx/settings(SUPER)
 *   ★ 세무사(ACCOUNTANT)는 /admin/acct/ 접두가 아니라 보지 않음(규칙 8 · 회계 자료 아님)
 * ------------------------------------------------------------------- */

const MEMBER = ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'] as const;
const me = () => RequestCtx.actorId() ?? '';

export class LpxOfferDto {
  @ApiProperty({ example: '78000000', description: '희망 가격(원 · 100원 ~ 13자리 · DB CHECK 와 같은 글자)' }) @IsString() @Matches(LPX_AMOUNT_RE) amount!: string;
  @ApiPropertyOptional({ example: '이번 달 안에 계약 가능합니다', description: '한 줄 메모(200자 · 연락처는 가려서 저장)' }) @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class LpxCounterDto {
  @ApiProperty({ example: '82000000', description: '되제안 · 다시 제안 가격(원 · 되제안 · 다시 제안 합쳐 lpx.offer_counter_max 번까지)' }) @IsString() @Matches(LPX_AMOUNT_RE) amount!: string;
  @ApiPropertyOptional({ example: '82,000,000원이면 바로 진행합니다', description: '한 줄 메모(200자)' }) @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class LpxAwayDto {
  @ApiProperty({ example: '2026-11-25', description: '시작 날짜(한국 · 오늘부터)' }) @IsString() @Matches(LPX_DATE_RE) startsOn!: string;
  @ApiProperty({ example: '2026-11-30', description: '끝 날짜(그날까지 · lpx.away_max_days 일 안)' }) @IsString() @Matches(LPX_DATE_RE) endsOn!: string;
  @ApiPropertyOptional({ example: '출장 중이라 12/1 에 답을 드립니다', description: '매물 상세 · 자동 안내에 보이는 한 줄(200자 · 연락처 가림)' }) @IsOptional() @IsString() @Length(0, 200) message?: string;
}
export class LpxStatsRunDto {
  @ApiPropertyOptional({ example: '2026-10', description: '이 달만 다시 셈(비우면 이번 달 · 지난달 · 빠진 달)' }) @IsOptional() @IsString() @Matches(LPX_YM_RE) ym?: string;
}
export class LpxSettingsDto {
  @ApiPropertyOptional({ description: 'lpx.offer' }) @IsOptional() @StrictBoolean() offerOn?: boolean;
  @ApiPropertyOptional({ example: ['MNY', 'HLT'], description: 'lpx.offer_gwans — 가격 제안을 쓰는 관(빈 배열 = 모두 끔 · 30개까지)' }) @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @Matches(LPX_GWAN_RE, { each: true }) offerGwans?: string[];
  @ApiPropertyOptional({ example: 7 }) @IsOptional() @IsInt() @Min(1) @Max(14) offerDays?: number;
  @ApiPropertyOptional({ example: 30, description: '거래 금액의 몇 % 아래는 받지 않음(0 = 하한 없음)' }) @IsOptional() @IsInt() @Min(0) @Max(99) offerMinPct?: number;
  @ApiPropertyOptional({ example: 20 }) @IsOptional() @IsInt() @Min(1) @Max(50) offerMemberMax?: number;
  @ApiPropertyOptional({ example: 3, description: 'lpx.offer_counter_max — 되제안 · 다시 제안 합친 횟수(1 ~ 5 · DB 트리거가 넘는 것을 막음)' }) @IsOptional() @IsInt() @Min(1) @Max(5) offerCounterMax?: number;
  @ApiPropertyOptional({ description: 'lpx.watermark' }) @IsOptional() @StrictBoolean() markOn?: boolean;
  @ApiPropertyOptional({ enum: LPX_POSITIONS }) @IsOptional() @IsIn(LPX_POSITIONS as unknown as string[]) markPos?: string;
  @ApiPropertyOptional({ example: 35 }) @IsOptional() @IsInt() @Min(10) @Max(60) markOpacity?: number;
  @ApiPropertyOptional({ description: 'lpx.away' }) @IsOptional() @StrictBoolean() awayOn?: boolean;
  @ApiPropertyOptional({ example: 30 }) @IsOptional() @IsInt() @Min(1) @Max(90) awayMaxDays?: number;
  @ApiPropertyOptional({ description: 'lpx.stats' }) @IsOptional() @StrictBoolean() statsOn?: boolean;
  @ApiPropertyOptional({ example: 5, description: '공개 칸 최소 매물 수(5 아래로 못 내림)' }) @IsOptional() @IsInt() @Min(5) @Max(50) statsMin?: number;
  @ApiPropertyOptional({ example: 12 }) @IsOptional() @IsInt() @Min(3) @Max(24) statsMonths?: number;
  @ApiProperty({ example: '법무 확인 끝 · 가격 제안 소개장터부터 켬' }) @IsString() @Length(2, 200) reason!: string;
}

@ApiTags('LPX')
@ApiBearerAuth()
@Controller('api/v1')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class LpxController {
  constructor(private readonly db: DatabaseService) {}

  /* ── 공개 ── */
  @Get('site/lpx/listings/:id')
  @ApiOperation({ summary: '매물 상세 덧붙임 정보 (v10.549 ~ 552 · 공개)', description: '사진 워터마크 표시 정보(원본 사진은 그대로) · 판매자 자리 비움(끝 날짜 · 안내 글) · 가격 제안 칸 켜짐 · 같은 관 · 업종 · 지역 최근 달 가운데값 — 게시 중 매물만 · 개인정보 없음.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  extras(@Param('id') id: string) { return listingExtras(this.db, id); }

  @Get('site/lpx/price-stats')
  @ApiOperation({ summary: '지역별 시세 통계 (v10.552 · 공개)', description: '관 · 업종 · 시 · 도 · 시 · 구 칸의 달별 거래(희망) 금액 가운데값 · 아래 칸 최근 달 — 집계만 · 매물 lpx.stats_min(5) 개 미만 칸은 숨김 · 꺼져 있으면 enabled false.' })
  @ApiQuery({ name: 'gwan', required: true, example: 'MNY' }) @ApiQuery({ name: 'category', required: false, description: "업종 id 또는 'ALL'" })
  @ApiQuery({ name: 'sido', required: false }) @ApiQuery({ name: 'sigungu', required: false })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LPX_STATS_GWAN · LPX_STATS_CATEGORY' })
  priceStats(@Query('gwan') gwan?: string, @Query('category') category?: string, @Query('sido') sido?: string, @Query('sigungu') sigungu?: string) {
    return publicStats(this.db, { gwan, category, sido, sigungu });
  }

  /* ── v10.549 가격 제안(회원) ── */
  @Get('lpx/listings/:id/offer')
  @Roles(...MEMBER)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '매물 가격 제안 칸 (v10.549)', description: '켜졌는지(스위치 · 관별 · 게시 중 · 거래 금액 있음) · 거래 금액 · 하한 · 기한 일수 · 내 열린 제안 · 내 매물이면 own · 기다리는 제안 수.' })
  @ApiOkResponse({ type: Object })
  offerBox(@Param('id') id: string) { return offerBoxFor(this.db, id, me()); }

  @Post('lpx/listings/:id/offers')
  @HttpCode(200)
  @Roles(...MEMBER)
  @Audit('LPX_OFFER', 'LISTING')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '가격 제안하기 (v10.549)', description: '게시 중 · 거래 금액 있는 매물 · 회원당 열린 제안 하나 · 자기 매물 안 됨 · 하한 lpx.offer_min_pct · 기한 lpx.offer_days · 주인에게 알림 · 주인이 자리 비움이면 안내(LPX_AWAY_AUTO).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LPX_OFFER_OFF · LPX_LISTING · LPX_OFFER_ALREADY' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LPX_GWAN_OFF · LPX_OFFER_SELF · LPX_NO_PRICE · LPX_AMOUNT · LPX_AMOUNT_LOW · LPX_OFFER_LIMIT' })
  offer(@Param('id') id: string, @Body() dto: LpxOfferDto) { return makeOffer(this.db, id, me(), dto.amount, dto.memo); }

  @Get('lpx/me/offers')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '나의공간 › 가격 제안 (v10.549)', description: '보낸 제안 100 · 받은 제안 100(가린 이름) · 기한 · 할 수 있는 일.' })
  @ApiOkResponse({ type: Object })
  mine() { return myOffers(this.db, me()); }

  @Post('lpx/offers/:id/accept')
  @HttpCode(200)
  @Roles(...MEMBER)
  @Audit('LPX_OFFER_ACCEPT', 'LISTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '가격 제안 수락 (v10.549)', description: '매물 주인은 답을 기다리는 제안을 · 회원은 되제안을 — 거래는 만들지 않고 「1:1 문의」로 기존 거래 흐름을 안내(next).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LPX_OFFER_STATE · LPX_OFFER_EXPIRED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  accept(@Param('id') id: string) { return acceptOffer(this.db, id, me()); }

  @Post('lpx/offers/:id/reject')
  @HttpCode(200)
  @Roles(...MEMBER)
  @Audit('LPX_OFFER_REJECT', 'LISTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '가격 제안 거절 (v10.549)', description: '매물 주인은 답을 기다리는 제안을 · 회원은 되제안을 · 상대에게 알림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LPX_OFFER_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  reject(@Param('id') id: string) { return rejectOffer(this.db, id, me()); }

  @Post('lpx/offers/:id/counter')
  @HttpCode(200)
  @Roles(...MEMBER)
  @Audit('LPX_OFFER_COUNTER', 'LISTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '되제안 (v10.549 · 매물 주인)', description: '답을 기다리는 제안에 · 다시 제안과 합쳐 lpx.offer_counter_max(처음 3)번까지 · 기한은 그때부터 다시 · 회원에게 알림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LPX_OFFER_STATE · LPX_OFFER_EXPIRED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LPX_AMOUNT · LPX_COUNTER_SAME · LPX_COUNTER_LIMIT' })
  counter(@Param('id') id: string, @Body() dto: LpxCounterDto) { return counterOffer(this.db, id, me(), dto.amount, dto.memo); }

  @Post('lpx/offers/:id/reoffer')
  @HttpCode(200)
  @Roles(...MEMBER)
  @Audit('LPX_OFFER_REOFFER', 'LISTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '다시 제안 (v10.549 · 제안한 회원)', description: '판매자 되제안에 새 금액으로 · 되제안과 합쳐 lpx.offer_counter_max(처음 3)번까지 · 하한 그대로 · 기한 다시 · 판매자에게 알림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LPX_OFFER_STATE · LPX_OFFER_EXPIRED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LPX_AMOUNT · LPX_AMOUNT_LOW · LPX_COUNTER_SAME · LPX_COUNTER_LIMIT' })
  reoffer(@Param('id') id: string, @Body() dto: LpxCounterDto) { return reofferOffer(this.db, id, me(), dto.amount, dto.memo); }

  @Post('lpx/offers/:id/withdraw')
  @HttpCode(200)
  @Roles(...MEMBER)
  @Audit('LPX_OFFER_WITHDRAW', 'LISTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '가격 제안 거두기 (v10.549 · 제안한 회원)', description: '열린 제안(답 기다림 · 되제안 받음)만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LPX_OFFER_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  withdraw(@Param('id') id: string) { return withdrawOffer(this.db, id, me()); }

  /* ── v10.551 자리 비움(회원 · 매물 주인) ── */
  @Get('lpx/me/away')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '나의공간 › 자리 비움 (v10.551)', description: '지금 켜 둔 자리 비움(보이는 중인지 · 보낸 자동 안내 수) · 지난 10 · 최대 일수 · 스위치.' })
  @ApiOkResponse({ type: Object })
  away() { return myAway(this.db, me()); }

  @Put('lpx/me/away')
  @Roles(...MEMBER)
  @Audit('LPX_AWAY_SET', 'ACCOUNT')
  @ApiOperation({ summary: '자리 비움 켜기 · 바꾸기 (v10.551)', description: '시작 · 끝 날짜(오늘부터 · lpx.away_max_days 일까지) · 한 줄 안내 — 지금 것이 있으면 닫고 새로 · 끝 날짜가 지나면 저절로 풀림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LPX_AWAY_OFF' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LPX_AWAY_DATE · LPX_AWAY_LONG' })
  setAway(@Body() dto: LpxAwayDto) { return setAway(this.db, me(), { startsOn: dto.startsOn, endsOn: dto.endsOn, message: dto.message }); }

  @Post('lpx/me/away/end')
  @HttpCode(200)
  @Roles(...MEMBER)
  @Audit('LPX_AWAY_END', 'ACCOUNT')
  @ApiOperation({ summary: '자리 비움 끝내기 (v10.551)', description: '켜 둔 자리 비움을 바로 닫음 — 매물 상세 안내가 사라짐.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LPX_AWAY_NONE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  endAway() { return endAway(this.db, me()); }

  /* ── 운영 ── */
  @Get('admin/lpx/offers')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '매물 가격 제안 한눈에 (v10.549)', description: '설정 · 관별 스위치 · 최근 30일 상태별 수 · 수락 금액 평균(거래 금액 대비 %) · 최근 제안 100(가린 이름 · 메모 없음).' })
  @ApiOkResponse({ type: Object })
  adminOffers() { return adminOffers(this.db); }

  @Post('admin/lpx/offers/run')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('LPX_HOURLY_RUN', 'SITE_SETTING')
  @ApiOperation({ summary: '매물 3 정기 작업 지금 한 번 (v10.549 · 551 · SUPER)', description: 'lpx_hourly 와 같음 — 기한 지난 · 내려간 매물의 열린 가격 제안 만료(알림) · 끝 날짜 지난 자리 비움 정리.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음(쓰지 않음)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '없음(쓰지 않음)' })
  hourlyRun() { return lpxHourlyJob(this.db); }

  @Get('admin/lpx/watermark')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '매물 사진 워터마크 (v10.550)', description: '설정 · 표시 정보 · 게시 중 사진 수 · 미리 볼 매물 하나 — 원본 사진은 그대로(화면 겹침 표시).' })
  @ApiOkResponse({ type: Object })
  adminMark() { return adminMark(this.db); }

  @Get('admin/lpx/away')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '판매자 자리 비움 한눈에 (v10.551)', description: '설정 · 켜 둔 수 · 보이는 중 · 최근 30일 만든 수 · 자동 안내 수(길별) · 최근 100(가린 이름 · 기간 · 안내 글 없음).' })
  @ApiOkResponse({ type: Object })
  adminAway() { return adminAway(this.db); }

  @Get('admin/lpx/stats')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'ym', required: false, description: 'YYYY-MM(비우면 이번 달 · 한국)' })
  @ApiOperation({ summary: '지역별 시세 통계 (v10.552)', description: '설정 · 달별 칸 수(5개 미만 칸 수) · 그 달 매물 많은 칸 100(가운데값).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LPX_STATS_YM' })
  adminStats(@Query('ym') ym?: string) { return adminStats(this.db, ym); }

  @Post('admin/lpx/stats/run')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('LPX_STATS_RUN', 'SITE_SETTING')
  @ApiOperation({ summary: '시세 통계 지금 셈 (v10.552 · SUPER)', description: 'ym 을 보내면 그 달만 · 비우면 이번 달 · 지난달 · 빠진 달(스위치와 상관없이 — 켜기 전 미리 봄 · 공개는 스위치를 따름).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음(쓰지 않음)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LPX_STATS_YM' })
  statsRun(@Body() dto: LpxStatsRunDto) { return statsRunNow(this.db, dto.ym); }

  @Put('admin/lpx/settings')
  @Roles('SUPER')
  @Audit('LPX_SETTINGS', 'SITE_SETTING')
  @ApiOperation({ summary: '(56) 매물 3 설정 (v10.549 ~ 552 · SUPER)', description: '가격 제안(관별 · 기한 · 하한 · 개수 · 되제안 횟수) · 사진 워터마크(자리 · 진하기) · 자리 비움(최대 일수) · 시세 통계(최소 수 · 달 수) — 사유는 설정 바뀜 기록 · 보낸 칸만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음(쓰지 않음)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LPX_REASON · LPX_SETTING_VALUE · LPX_GWANS · LPX_NOTHING' })
  settings(@Body() dto: LpxSettingsDto) {
    const d: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto)) if (v !== undefined) d[k] = v;   // 규칙 11 — 안 보낸 칸은 덮지 않음
    return setLpxSettings(this.db, d as unknown as LpxSettingsInput);
  }
}
