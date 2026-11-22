import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { StrictBoolean } from '../../common/strict-boolean';
import { Roles } from '../../core/auth';
import { DatabaseService } from '../../db/database.service';
import { grwSettings, grwSwitches, me, setGrwSettings, TIER_POINTS_RE } from './common';
import { funnelView, signupStepBeat } from './funnel';
import { firstStepsStats, hideFirstSteps, myFirstSteps } from './first-steps';
import { digestStats, myDigest, setMyDigest } from './digest';
import { tierView } from './tier';
import { fillStats, myListingFill, myListingsFill } from './fill';

/* ---------------------------------------------------------------------
 * v10.597 ~ 601 (docs/739 ~ 743) 16차 회원 · 성장
 *   공개(로그인 없이 · 개인정보 없음)  GET /site/grw/switches · POST /site/grw/signup-step(가입 단계 수만 · grw.signup_steps off 면 받지 않음)
 *   회원                              GET /me/grw/first-steps · POST /me/grw/first-steps/hide
 *                                     GET · PUT /me/grw/digest
 *                                     GET /me/grw/listings · GET /me/grw/listings/{id}/fill
 *   운영(회원 › 회원 성장)             GET /admin/grw/overview · PUT /admin/grw/settings(SUPER)
 *                                     GET /admin/grw/funnel · /first-steps · /digest · /tier · /fill(숫자만 · 여러 단계 보상 최근 줄은 가린 이름)
 *   세무사(ACCOUNTANT)는 /admin/acct/ 밖이라 보지 않음(회원 행동 숫자)
 * ------------------------------------------------------------------- */

const MEMBER = ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'] as const;

export class GrwStepDto {
  @ApiProperty({ example: 3, minimum: 1, maximum: 5, description: '가입 화면 단계(1 유형 · 2 기업 인증 · 3 정보 · 4 약관 · 5 관심 성향)' })
  @IsInt() @Min(1) @Max(5) s!: number;
}
export class GrwHideDto {
  @ApiProperty({ example: true, description: 'true = 그만 보기 · false = 다시 보기' }) @StrictBoolean() hidden!: boolean;   // v10.617 받은 값 그대로("x" 400)
}
export class GrwDigestDto {
  @ApiProperty({ example: true, description: '알림 하루 요약 받기' }) @StrictBoolean() enabled!: boolean;
}
export class GrwSettingsDto {
  @ApiPropertyOptional({ description: '가입 단계 수 세기(grw.signup_steps)' }) @IsOptional() @StrictBoolean() signupSteps?: boolean;
  @ApiPropertyOptional({ description: '첫 거래 안내 카드(grw.first_steps)' }) @IsOptional() @StrictBoolean() firstSteps?: boolean;
  @ApiPropertyOptional({ example: 60, description: '첫 거래 안내를 보여 주는 가입 뒤 날 수(7 ~ 365)' }) @IsOptional() @IsInt() @Min(7) @Max(365) firstStepsDays?: number;
  @ApiPropertyOptional({ description: '알림 하루 요약(grw.digest)' }) @IsOptional() @StrictBoolean() digest?: boolean;
  @ApiPropertyOptional({ description: '여러 단계 추천 보상(grw.tier_reward) — 법무 확인 끝 표시가 있어야 켜짐' }) @IsOptional() @StrictBoolean() tierReward?: boolean;
  @ApiPropertyOptional({ description: '여러 단계 추천 보상 법무 확인 끝(grw.tier_legal_ok) — 사유에 확인한 곳 · 날짜' }) @IsOptional() @StrictBoolean() tierLegalOk?: boolean;
  @ApiPropertyOptional({ example: '300,100', description: '2 · 3 · 4단계 점수(쉼표 · 최대 3개)' }) @IsOptional() @IsString() @Matches(TIER_POINTS_RE) tierPoints?: string;
  @ApiPropertyOptional({ example: 10, description: '한 사람 한 달 여러 단계 보상 횟수(0 = 제한 없음 · 1,000 까지)' }) @IsOptional() @IsInt() @Min(0) @Max(1000) tierMonthlyCap?: number;
  @ApiPropertyOptional({ description: '매물 충실도 안내(grw.fill_helper)' }) @IsOptional() @StrictBoolean() fillHelper?: boolean;
  @ApiProperty({ example: '법무 확인 끝 — 여러 단계 보상 켬', minLength: 2, maxLength: 200 }) @IsString() @Length(2, 200) reason!: string;
}

@ApiTags('MYP')
@ApiBearerAuth()
@Controller('api/v1')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class GrwController {
  constructor(private readonly db: DatabaseService) {}

  /* ── 공개 ── */
  @Get('site/grw/switches')
  @ApiOperation({ summary: '회원 · 성장 스위치 (v10.597 ~ 601)', description: '가입 단계 수 세기 · 첫 거래 안내 · 알림 하루 요약 · 매물 충실도 안내가 켜져 있는지. 개인정보 없음.' })
  @ApiOkResponse({ type: Object })
  switches() { return grwSwitches(this.db); }

  @Post('site/grw/signup-step')
  @HttpCode(200)
  @ApiOperation({
    summary: '가입 화면 단계 수 보내기 (v10.597)',
    description: '로그인 없이 · 하루 × 단계 수만 더함(계정 · IP · 브라우저 정보 · 쿠키 저장 없음) · grw.signup_steps 가 꺼져 있거나 DNT · GPC · 로봇이면 ok:false(오류 아님).',
  })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'POLICY' })
  step(@Body() dto: GrwStepDto, @Headers('user-agent') ua?: string, @Headers('dnt') dnt?: string, @Headers('sec-gpc') gpc?: string,
       @Headers('x-forwarded-for') xff?: string, @Ip() ip?: string) {
    return signupStepBeat(this.db, dto.s, { ua, dnt, gpc, ip: (xff?.split(',')[0]?.trim() || ip) ?? '' });
  }

  /* ── v10.598 첫 거래 안내 ── */
  @Get('me/grw/first-steps')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '첫 거래 안내 체크리스트 (v10.598)', description: '본인인증 · 관심 성향 · 관심 담기 · 문의 · 매물/요청 · 거래 · 알림 설정 · 추천 코드 — 끝냈는지 · 보여 줄지(show · reason OFF · HIDDEN · OLD · DONE).' })
  @ApiOkResponse({ type: Object })
  firstSteps() { return myFirstSteps(this.db, me()); }

  @Post('me/grw/first-steps/hide')
  @HttpCode(200)
  @Roles(...MEMBER)
  @ApiOperation({ summary: '첫 거래 안내 그만 보기 · 다시 보기 (v10.598)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'POLICY' })
  hide(@Body() dto: GrwHideDto) { return hideFirstSteps(this.db, me(), dto.hidden); }

  /* ── v10.599 알림 하루 요약 ── */
  @Get('me/grw/digest')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '알림 하루 요약 설정 (v10.599)', description: '쓸 수 있는지(grw.digest) · 내가 켰는지 · 메일 준비 여부 · 마지막 요약 날.' })
  @ApiOkResponse({ type: Object })
  digest() { return myDigest(this.db, me()); }

  @Put('me/grw/digest')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '알림 하루 요약 켜기 · 끄기 (v10.599)', description: '켜면 매일 08:00 지난 24시간 알림을 한 통으로(사이트 알림 · 메일 준비 뒤에는 메일도). 돈 · 계약 알림은 바로. 스위치가 꺼져 있으면 켜기 422.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'GRW_DIGEST_OFF' })
  setDigest(@Body() dto: GrwDigestDto) { return setMyDigest(this.db, me(), dto.enabled); }

  /* ── v10.601 매물 충실도 ── */
  @Get('me/grw/listings')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '내 매물 충실도 (v10.601)', description: '보관 빼고 최근 50개 · 점수(100) · 등급 · 더 적으면 좋은 칸. 노출 순서 · 검색 순위 · 소개비에 쓰지 않음.' })
  @ApiOkResponse({ type: Object })
  listings() { return myListingsFill(this.db, me()); }

  @Get('me/grw/listings/:id/fill')
  @Roles(...MEMBER)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '내 매물 하나 충실도 (v10.601)', description: '매물 고치기 화면의 등록 도우미 상자. 남의 매물 · 없는 번호는 404.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  fill(@Param('id') id: string) { return myListingFill(this.db, me(), id); }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/grw')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class GrwAdminController {
  constructor(private readonly db: DatabaseService) {}

  @Get('overview')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '회원 성장 설정 (v10.597 ~ 601)', description: '스위치 · 날 수 · 여러 단계 보상 점수 · 정기 작업.' })
  @ApiOkResponse({ type: Object })
  async overview() { return { settings: await grwSettings(this.db), job: '매일 08:00(grw_daily) — 하루 요약 · 오래된 단계 수 정리' }; }

  @Put('settings')
  @Roles('SUPER')
  @ApiOperation({ summary: '회원 성장 설정 바꾸기 (v10.597 ~ 601)', description: '사유 필수 · 설정 바뀐 기록. 여러 단계 추천 보상은 법무 확인 끝 표시 없이는 켤 수 없음(422 GRW_TIER_LEGAL).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'GRW_REASON · GRW_RANGE · GRW_TIER_POINTS · GRW_TIER_LEGAL · GRW_NOTHING' })
  settings(@Body() dto: GrwSettingsDto) { return setGrwSettings(this.db, dto); }

  @Get('funnel')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'days', required: false, enum: ['7', '30', '90'] })
  @ApiOperation({ summary: '가입 퍼널 (v10.597)', description: '가입 화면 → 단계 → 가입 → 본인인증 → 첫 활동 → 첫 거래 · 유입 경로(추천 코드 · 소개코드 링크 · 광고 · 직접)별 · 날마다. 숫자만.' })
  @ApiOkResponse({ type: Object })
  funnel(@Query('days') days?: string) { return funnelView(this.db, days); }

  @Get('first-steps')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'days', required: false, enum: ['30', '60', '90'] })
  @ApiOperation({ summary: '첫 거래 안내 통계 (v10.598)', description: '최근 가입자 중 단계마다 끝낸 수 · 다 끝냄 · 그만 보기. 숫자만.' })
  @ApiOkResponse({ type: Object })
  firstSteps(@Query('days') days?: string) { return firstStepsStats(this.db, days); }

  @Get('digest')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '알림 하루 요약 통계 (v10.599)', description: '켠 회원 수 · 최근 7일 요약 · 묶어 닫은 메일 수 · 메일 준비 여부.' })
  @ApiOkResponse({ type: Object })
  digest() { return digestStats(this.db); }

  @Get('tier')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '여러 단계 추천 보상 (v10.600)', description: '처음 꺼짐 · 법무 확인 안내 · 점수 · 상한 · 지금 관계의 2 ~ 4단계 수 · 최근 보상(가린 이름).' })
  @ApiOkResponse({ type: Object })
  tier() { return tierView(this.db); }

  @Get('fill')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '매물 충실도 나눔 (v10.601)', description: '게시 중 매물 점수 나눔 · 많이 빠진 칸. 노출 순서 · 검색 순위 · 소개비에 쓰지 않음.' })
  @ApiOkResponse({ type: Object })
  fill() { return fillStats(this.db); }
}
