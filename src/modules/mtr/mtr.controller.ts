import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { setMtrSettings } from './common';
import { APPEAL_STATES, APPEAL_TARGETS, appealList, createAppeal, decideAppeal, myAppeals } from './appeal';
import { REVIEW_FLAG_STATES, reviewFlagDecide, reviewFlagDetail, reviewFlagList, reviewScan } from './review-watch';
import { myTrust, setTrustRules, TRUST_CODES, trustLookup, trustOverview, trustRecompute } from './trust';
import { DORMANT_VIEWS, dormantList, dormantWakeByAdmin } from './dormant';
import { mtrOverview } from './jobs';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * v10.573 ~ 576 (docs/715 ~ 718) 11차 회원 · 거래 — 신고 이의 제기 · 가짜 후기 탐지 · 소개자 신뢰 점수 · 휴면 계정
 *   회원   GET · POST /me/mtr/appeals · GET /me/mtr/trust
 *   운영(위험감지 › 이의 제기 · 가짜 후기 의심 / 회원 › 소개자 신뢰 점수 · 휴면 계정)
 *          GET /admin/mtr/overview · PUT /admin/mtr/settings(SUPER)
 *          GET /admin/mtr/appeals · POST /admin/mtr/appeals/{id}/decide
 *          GET /admin/mtr/reviews · GET /admin/mtr/reviews/{id} · POST /admin/mtr/reviews/{id}/decide · POST /admin/mtr/reviews/scan
 *          GET /admin/mtr/trust · GET /admin/mtr/trust/lookup · PUT /admin/mtr/trust/rules(SUPER) · POST /admin/mtr/trust/recompute
 *          GET /admin/mtr/dormant · POST /admin/mtr/dormant/{id}/wake(SUPER)
 *   세무사(ACCOUNTANT)는 /admin/acct/ 밖이라 보지 않음 · 공개 주소 없음
 * ------------------------------------------------------------------- */

const MEMBER = ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'] as const;
const OPS = ['ADMIN', 'SUPER'] as const;
const me = () => RequestCtx.actorId()!;

export class MtrSettingsDto {
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() appeal?: boolean;
  @ApiPropertyOptional({ example: 30 }) @IsOptional() @IsInt() @Min(1) @Max(90) appealDays?: number;
  @ApiPropertyOptional({ example: 72 }) @IsOptional() @IsInt() @Min(24) @Max(336) appealSlaHours?: number;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() reviewWatch?: boolean;
  @ApiPropertyOptional({ example: 50 }) @IsOptional() @IsInt() @Min(20) @Max(100) reviewThreshold?: number;
  @ApiPropertyOptional({ example: 5 }) @IsOptional() @IsInt() @Min(2) @Max(50) reviewBurstCount?: number;
  @ApiPropertyOptional({ example: 24 }) @IsOptional() @IsInt() @Min(1) @Max(168) reviewBurstHours?: number;
  @ApiPropertyOptional({ example: 80 }) @IsOptional() @IsInt() @Min(50) @Max(100) reviewSimilarPct?: number;
  @ApiPropertyOptional({ example: 30 }) @IsOptional() @IsInt() @Min(1) @Max(90) reviewScanDays?: number;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() trust?: boolean;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() dormant?: boolean;
  @ApiPropertyOptional({ example: 365 }) @IsOptional() @IsInt() @Min(180) @Max(1095) dormantDays?: number;
  @ApiPropertyOptional({ example: 30 }) @IsOptional() @IsInt() @Min(7) @Max(60) dormantNoticeDays?: number;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() dormantMail?: boolean;
  @ApiProperty({ example: '대표 결정 — 이의 제기 켜기' }) @IsString() @Length(2, 200) reason!: string;
}
export class MtrAppealCreateDto {
  @ApiProperty({ enum: APPEAL_TARGETS }) @IsIn(APPEAL_TARGETS as unknown as string[]) targetType!: string;
  @ApiProperty({ format: 'uuid' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) targetId!: string;
  @ApiProperty({ minLength: 10, maxLength: 1000, example: '신고 사유의 연락처는 회사 대표 번호이고 매물 설명에도 공개된 것입니다.' }) @IsString() @Length(10, 1000) body!: string;
}
export class MtrAppealDecideDto {
  @ApiProperty({ description: 'true 받아들임(다시 올림 · 매물은 검수 대기) · false 받아들이지 않음' }) @StrictBoolean() accept!: boolean;
  @ApiProperty({ minLength: 2, maxLength: 500, description: '작성자에게 보이는 사유' }) @IsString() @Length(2, 500) note!: string;
}
export class MtrReviewDecideDto {
  @ApiProperty({ enum: ['FAKE', 'OK'] }) @IsIn(['FAKE', 'OK']) verdict!: string;
  @ApiProperty({ minLength: 2, maxLength: 300 }) @IsString() @Length(2, 300) note!: string;
  @ApiPropertyOptional({ description: '가짜(FAKE)로 정할 때 소개몰 리뷰를 가림(거래 후기는 가릴 수 없음)' }) @IsOptional() @StrictBoolean() hide?: boolean;
}
export class MtrTrustRuleItemDto {
  @ApiProperty({ enum: TRUST_CODES }) @IsIn(TRUST_CODES as unknown as string[]) code!: string;
  @ApiPropertyOptional({ example: 25, description: '-50 ~ 50 · 인정된 신고만 0 이하' }) @IsOptional() @IsNumber() @Min(-50) @Max(50) points?: number;
  @ApiPropertyOptional({ example: 10, description: '다 주는 기준(건 · 시간) · 시작 · 본인인증 · 사업자는 없음' }) @IsOptional() @IsNumber() @Min(0.1) @Max(99999) fullAt?: number;
}
export class MtrTrustRulesDto {
  @ApiProperty({ type: [MtrTrustRuleItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @ValidateNested({ each: true }) @Type(() => MtrTrustRuleItemDto) rules!: MtrTrustRuleItemDto[];
  @ApiProperty({ example: '대표 결정 — 성사 배점 30' }) @IsString() @Length(2, 200) reason!: string;
}
export class MtrDormantWakeDto {
  @ApiProperty({ minLength: 5, maxLength: 200, example: '본인 전화 확인(가입 휴대폰) — 로그인 오류 문의' }) @IsString() @Length(5, 200) reason!: string;
}
export class MtrReasonOnlyDto {
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

@ApiTags('MTR')
@ApiBearerAuth()
@Controller('api/v1')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class MtrController {
  constructor(private readonly db: DatabaseService) {}

  /* ── 회원 ── */
  @Get('me/mtr/appeals')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '신고로 내려간 내 것 · 이의 제기 (v10.573)', description: '내려간 매물 · 글 · 댓글 · 신고 사유 이름 · 건수 · 운영 처리 내용(신고한 사람은 안 보임) · 이의 낼 수 있는지 · 낸 이의와 결과.' })
  @ApiOkResponse({ type: Object })
  myAppeals() { return myAppeals(this.db, me()); }

  @Post('me/mtr/appeals')
  @HttpCode(200)
  @Roles(...MEMBER)
  @ApiOperation({ summary: '이의 제기 (v10.573)', description: '신고로 내려간 내 대상에 한 번 · 내려간 뒤 mtr.appeal_days 안 · 10 ~ 1000자 · 운영이 다시 판단(기한 mtr.appeal_sla_hours).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '내려간 내 대상이 아님', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'MTR_APPEAL_DONE(이미 냄)', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MTR_APPEAL_OFF · MTR_APPEAL_TARGET · MTR_APPEAL_BODY · MTR_APPEAL_LATE', type: ErrorDto })
  @Audit('MTR_APPEAL_CREATE', 'MTR_APPEAL', { pick: ['ok', 'id', 'dueAt'] })
  createAppeal(@Body() dto: MtrAppealCreateDto) { return createAppeal(this.db, me(), { targetType: dto.targetType, targetId: dto.targetId, body: dto.body }); }

  @Get('me/mtr/trust')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '내 신뢰 점수 (v10.575)', description: '켜져 있을 때만(mtr.trust) · 칸마다 얻은 점수와 근거 수 · 본인만 봄 · 노출 순위 · 소개비에 쓰지 않음.' })
  @ApiOkResponse({ type: Object })
  myTrust() { return myTrust(this.db, me()); }

  /* ── 운영 — 한눈에 · 설정 ── */
  @Get('admin/mtr/overview')
  @Roles(...OPS)
  @ApiOperation({ summary: '회원 · 거래 한눈에 (v10.573 ~ 576)', description: '설정 · 열린 이의 · 기한 넘김 · 가짜 후기 의심 · 신뢰 점수 센 수 · 휴면 알림 · 휴면 수.' })
  @ApiOkResponse({ type: Object })
  overview() { return mtrOverview(this.db); }

  @Put('admin/mtr/settings')
  @Roles('SUPER')
  @ApiOperation({ summary: '회원 · 거래 설정 (v10.573 ~ 576 · SUPER)', description: '보낸 칸만 · 값은 DB 무늬와 같은 검사 · 사유는 전체 설정 바뀐 기록에.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: '없음(쓰지 않음)', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MTR_REASON · MTR_SETTING_VALUE · MTR_NOTHING', type: ErrorDto })
  @Audit('MTR_SETTINGS', 'SITE_SETTING', { pick: ['ok', 'settings'] })
  settings(@Body() dto: MtrSettingsDto) {
    return setMtrSettings(this.db, {
      appeal: dto.appeal, appealDays: dto.appealDays, appealSlaHours: dto.appealSlaHours,
      reviewWatch: dto.reviewWatch, reviewThreshold: dto.reviewThreshold, reviewBurstCount: dto.reviewBurstCount, reviewBurstHours: dto.reviewBurstHours,
      reviewSimilarPct: dto.reviewSimilarPct, reviewScanDays: dto.reviewScanDays, trust: dto.trust,
      dormant: dto.dormant, dormantDays: dto.dormantDays, dormantNoticeDays: dto.dormantNoticeDays, dormantMail: dto.dormantMail, reason: dto.reason,
    });
  }

  /* ── v10.573 이의 제기 ── */
  @Get('admin/mtr/appeals')
  @Roles(...OPS)
  @ApiOperation({ summary: '이의 제기 목록 (v10.573)', description: '열린 것은 기한 가까운 순 · 대상 · 지금 상태 · 신고 목록(신고한 사람 없음) · 이의 글 · 기한 넘김.' })
  @ApiQuery({ name: 'state', enum: APPEAL_STATES, required: false })
  @ApiOkResponse({ type: Object })
  @Audit('MTR_APPEAL_LIST', 'MTR_APPEAL', { pick: ['state', 'counts'] })
  appeals(@Query('state') state?: string) { return appealList(this.db, state); }

  @Post('admin/mtr/appeals/:id/decide')
  @HttpCode(200)
  @Roles(...OPS)
  @ApiOperation({ summary: '이의 제기 결정 (v10.573)', description: '받아들임(글 · 댓글 다시 보임 · 매물 검수 대기 · 그 대상 신고 기각 · 신고한 사람 알림) · 받아들이지 않음 · 사유는 작성자에게.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 이의', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'MTR_APPEAL_STATE · MTR_APPEAL_TARGET_GONE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MTR_APPEAL_DECIDE · MTR_APPEAL_NOTE', type: ErrorDto })
  @Audit('MTR_APPEAL_DECIDE', 'MTR_APPEAL', { pick: ['ok', 'id', 'state', 'restored', 'dismissedReports'] })
  appealDecide(@Param('id', ParseIntPipe) id: number, @Body() dto: MtrAppealDecideDto) { return decideAppeal(this.db, me(), id, { accept: dto.accept, note: dto.note }); }

  /* ── v10.574 가짜 후기 의심 ── */
  @Get('admin/mtr/reviews')
  @Roles(...OPS)
  @ApiOperation({ summary: '가짜 후기 · 리뷰 의심 (v10.574)', description: '점수 높은 순 · 신호(같은 기기 · 거래 없음 · 몰림 · 비슷한 문장 · 새 계정) · 가린 작성자 · 자동 삭제 없음.' })
  @ApiQuery({ name: 'state', enum: REVIEW_FLAG_STATES, required: false })
  @ApiOkResponse({ type: Object })
  @Audit('MTR_REVIEW_LIST', 'MTR_REVIEW_FLAG', { pick: ['state', 'counts'] })
  reviews(@Query('state') state?: string) { return reviewFlagList(this.db, state); }

  @Get('admin/mtr/reviews/:id')
  @Roles(...OPS)
  @ApiOperation({ summary: '가짜 후기 의심 자세히 (v10.574)', description: '같은 대상의 다른 후기 최근 20(가린 작성자 · 결정 상태).' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 의심 줄', type: ErrorDto })
  @Audit('MTR_REVIEW_VIEW', 'MTR_REVIEW_FLAG', { idOnly: true })
  review(@Param('id', ParseIntPipe) id: number) { return reviewFlagDetail(this.db, id); }

  @Post('admin/mtr/reviews/:id/decide')
  @HttpCode(200)
  @Roles(...OPS)
  @ApiOperation({ summary: '가짜 후기 결정 (v10.574)', description: 'FAKE 가짜(소개몰 리뷰는 hide 로 가림 · 거래 후기는 신뢰 점수에서 뺌) · OK 문제없음 · 사유 필수 · 한 번.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 의심 줄', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'MTR_REVIEW_STATE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MTR_REVIEW_VERDICT · MTR_REVIEW_HIDE · MTR_REASON', type: ErrorDto })
  @Audit('MTR_REVIEW_DECIDE', 'MTR_REVIEW_FLAG', { pick: ['ok', 'id', 'state', 'hidden'] })
  reviewDecide(@Param('id', ParseIntPipe) id: number, @Body() dto: MtrReviewDecideDto) { return reviewFlagDecide(this.db, me(), id, { verdict: dto.verdict, note: dto.note, hide: dto.hide }); }

  @Post('admin/mtr/reviews/scan')
  @HttpCode(200)
  @Roles(...OPS)
  @ApiOperation({ summary: '가짜 후기 지금 보기 (v10.574)', description: '스위치가 꺼져 있어도 한 번 봄(의심 목록에만 · 운영 알림 없음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: '없음(쓰지 않음)', type: ErrorDto })
  @ApiResponse({ status: 422, description: '없음(쓰지 않음)', type: ErrorDto })
  @Audit('MTR_REVIEW_SCAN', 'MTR_REVIEW_FLAG', { pick: ['scanned', 'flagged', 'added'] })
  reviewScanNow() { return reviewScan(this.db, true); }

  /* ── v10.575 소개자 신뢰 점수 ── */
  @Get('admin/mtr/trust')
  @Roles(...OPS)
  @ApiOperation({ summary: '소개자 신뢰 점수 (v10.575)', description: '켜짐 · 산식 · 분포(10점 칸) · 마지막 셈 — 노출 순위 · 소개비 계산에 쓰지 않음.' })
  @ApiOkResponse({ type: Object })
  trust() { return trustOverview(this.db); }

  @Get('admin/mtr/trust/lookup')
  @Roles(...OPS)
  @ApiOperation({ summary: '한 사람 신뢰 점수 (v10.575)', description: '이메일로 찾아 그 자리에서 셈(꺼져 있어도 미리 봄) · 가린 메일 · 이름 첫 글자.' })
  @ApiQuery({ name: 'email', required: true })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 회원', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MTR_EMAIL', type: ErrorDto })
  @Audit('MTR_TRUST_VIEW', 'ACCOUNT', { pick: ['accountId', 'score'] })
  trustLookup(@Query('email') email: string) { return trustLookup(this.db, email); }

  @Put('admin/mtr/trust/rules')
  @Roles('SUPER')
  @ApiOperation({ summary: '신뢰 점수 산식 (v10.575 · SUPER)', description: '보낸 칸만 · 점수 -50 ~ 50(인정된 신고만 0 이하) · 기준 > 0(응답 속도는 1시간 넘게) · 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: '없음(쓰지 않음)', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MTR_TRUST_RULES · MTR_TRUST_CODE · MTR_TRUST_POINTS · MTR_TRUST_SIGN · MTR_TRUST_FULL · MTR_REASON', type: ErrorDto })
  @Audit('MTR_TRUST_RULES', 'MTR_TRUST_RULE', { pick: ['ok', 'rules'] })
  trustRules(@Body() dto: MtrTrustRulesDto) {
    return setTrustRules(this.db, me(), { rules: (dto.rules ?? []).map((r) => ({ code: r.code, points: r.points, fullAt: r.fullAt })), reason: dto.reason });
  }

  @Post('admin/mtr/trust/recompute')
  @HttpCode(200)
  @Roles(...OPS)
  @ApiOperation({ summary: '신뢰 점수 지금 셈 (v10.575)', description: '하루 셈과 같음(오래 전에 센 순 · 많아야 3000 · 40초) — 스위치가 꺼져 있어도 운영 분포용으로 셈(회원 화면에는 안 보임).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: '없음(쓰지 않음)', type: ErrorDto })
  @ApiResponse({ status: 422, description: '없음(쓰지 않음)', type: ErrorDto })
  @Audit('MTR_TRUST_RECOMPUTE', 'MTR_TRUST_RULE', { pick: ['computed', 'waiting'] })
  trustRecompute(@Body() _dto: MtrReasonOnlyDto) { return trustRecompute(this.db, true); }

  /* ── v10.576 휴면 계정 ── */
  @Get('admin/mtr/dormant')
  @Roles(...OPS)
  @ApiOperation({ summary: '휴면 계정 (v10.576)', description: '알림 · 휴면 · 풀림 목록(가린 메일) · 수 · 지금 켜면 알림 · 휴면 대상 수(미리 보기) · 법무 확인 필요.' })
  @ApiQuery({ name: 'view', enum: DORMANT_VIEWS, required: false })
  @ApiOkResponse({ type: Object })
  @Audit('MTR_DORMANT_LIST', 'ACCOUNT', { pick: ['view', 'counts'] })
  dormant(@Query('view') view?: string) { return dormantList(this.db, view); }

  @Post('admin/mtr/dormant/:id/wake')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '휴면 풀기 (v10.576 · SUPER)', description: '본인 확인 뒤 운영이 풂 · 이름 · 전화를 되돌림 · 사유 5자 이상 · 감사.' })
  @ApiParam({ name: 'id', format: 'uuid', description: '회원 번호' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 회원', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'MTR_NOT_DORMANT', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MTR_REASON', type: ErrorDto })
  @Audit('MTR_DORMANT_WAKE', 'ACCOUNT', { pick: ['ok', 'accountId'] })
  dormantWake(@Param('id') id: string, @Body() dto: MtrDormantWakeDto) { return dormantWakeByAdmin(this.db, id, dto.reason); }
}
