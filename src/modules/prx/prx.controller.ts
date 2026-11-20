import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { DatabaseService } from '../../db/database.service';
import { MailService } from '../../common/mail/mail.service';
import { addPopup, editPopup, listPopups, POPUP_AUDIENCES, POPUP_LINK_RE, publicPopups, togglePopup } from './popups';
import { addRefEvent, editRefEvent, endRefEvent, listRefEvents, setRefEventCheck, setRefEventSwitch, startRefEvent } from './refevent';
import { listReports, makeReports, PERIOD_KEY_RE, REPORT_CYCLES, reportDetail, sendReport, setOwner, setReportSettings } from './adreport';
import { abDetail, addAbTest, cancelAbTest, endAbTest, listAbTests, startAbTest } from './abtest';

/* ---------------------------------------------------------------------
 * v10.517 ~ 520 (D277 · docs/655 ~ 658) ㊼ 회원 · 광고
 *   v10.517  GET /popups(공개 · 보는 사람 기준) · GET /admin/prx/popups · POST /popups · PUT /popups/{id} · POST /popups/{id}/toggle
 *   v10.518  GET /admin/prx/ref-events · POST · PUT /{id} · PUT /{id}/check · POST /{id}/start(SUPER) · POST /{id}/end(SUPER) · PUT /ref-events/switch(SUPER)
 *   v10.519  GET /admin/prx/ad-reports?period= · GET /{id} · POST /ad-reports/make · POST /{id}/send(SUPER) · PUT /admin/prx/ad-owners/{creativeId} · PUT /ad-reports/switch(SUPER · 메일 · 주기)
 *   v10.520  GET /admin/prx/ab-tests · GET /{id} · POST · POST /{id}/start · /end · /cancel
 *   보기 · 고치기 ADMIN · SUPER(광고 과금 · 메인 운영과 같음) — 돈 · 메일이 나가는 것(이벤트 시작 · 끝 · 스위치 · 보고서 보내기)은 SUPER
 *   세무사(ACCOUNTANT)는 /admin/acct/ 밖이라 보지 않음
 * ------------------------------------------------------------------- */

const VIEW = ['ADMIN', 'SUPER'] as const;

export class PrxPopupDto {
  @ApiProperty({ example: '설 연휴 고객센터 안내' }) @IsString() @Length(2, 80) title!: string;
  @ApiPropertyOptional({ example: '2월 9일 ~ 11일은 1:1 문의 답변이 늦어집니다.' }) @IsOptional() @IsString() @Length(0, 1000) body?: string;
  @ApiPropertyOptional({ example: '/support', description: '/ 로 시작하는 사이트 주소 또는 https:// 주소' }) @IsOptional() @IsString() @Matches(new RegExp(`(^$)|${POPUP_LINK_RE.source}`)) linkUrl?: string;
  @ApiPropertyOptional({ example: '자세히' }) @IsOptional() @IsString() @Length(0, 20) linkLabel?: string;
  @ApiProperty({ example: ['GUEST', 'MEMBER'], enum: POPUP_AUDIENCES, isArray: true }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @IsIn(POPUP_AUDIENCES as unknown as string[], { each: true }) audience!: string[];
  @ApiProperty({ example: '2026-11-21T00:00:00+09:00' }) @IsDateString() startsAt!: string;
  @ApiProperty({ example: '2026-11-30T23:59:00+09:00' }) @IsDateString() endsAt!: string;
  @ApiPropertyOptional({ example: 100, description: '작을수록 먼저(0 ~ 999)' }) @IsOptional() @IsInt() @Min(0) @Max(999) priority?: number;
}
export class PrxToggleDto {
  @ApiProperty({ example: true }) @IsBoolean() on!: boolean;
}
export class PrxRefEventDto {
  @ApiProperty({ example: '12월 친구 추천 2배' }) @IsString() @Length(2, 80) title!: string;
  @ApiProperty({ example: '2026-12-01T00:00:00+09:00' }) @IsDateString() startsAt!: string;
  @ApiProperty({ example: '2026-12-31T23:59:00+09:00' }) @IsDateString() endsAt!: string;
  @ApiProperty({ example: 2000, description: '이벤트 동안 직접 추천 1건당 점수' }) @IsInt() @Min(1) @Max(100000) points!: number;
  @ApiProperty({ example: 1000000, description: '이벤트로 줄 점수 합 상한' }) @IsInt() @Min(1) @Max(100000000) budget!: number;
  @ApiPropertyOptional({ description: '비우면 처음 틀({from} {until} {points} {base} {budget})' }) @IsOptional() @IsString() @Length(0, 2000) noticeText?: string;
}
export class PrxRefEventCheckDto {
  @ApiProperty({ example: true, description: '약관(추천 보상 · 포인트 · 처리방침) 확인' }) @IsBoolean() terms!: boolean;
  @ApiProperty({ example: true, description: '안내 문구(기간 · 금액 · 조기 종료 · 지급 시점 · 1단계) 확인' }) @IsBoolean() notice!: boolean;
  @ApiProperty({ example: '법무 자문' }) @IsString() @Length(2, 60) by!: string;
  @ApiProperty({ example: '2026-11-20' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) on!: string;
  @ApiPropertyOptional({ example: '경품 고시 해당 없음 확인' }) @IsOptional() @IsString() @Length(0, 500) memo?: string;
}
export class PrxSwitchDto {
  @ApiProperty({ example: false }) @IsBoolean() on!: boolean;
  @ApiProperty({ example: '법무 확인 끝 · 이벤트 준비' }) @IsString() @Length(2, 200) reason!: string;
}
export class PrxReportSettingDto {
  @ApiPropertyOptional({ example: false, description: '메일 켜기 · 끄기(처음 off · 메일 준비가 된 뒤 켬)' }) @IsOptional() @IsBoolean() on?: boolean;
  @ApiPropertyOptional({ enum: REPORT_CYCLES, description: '보내는 주기 — DAILY 어제 하루 · WEEKLY 지난주 · MONTHLY 지난달(처음)' }) @IsOptional() @IsIn(REPORT_CYCLES as unknown as string[]) cycle?: string;
  @ApiProperty({ example: '법무 확인 끝(대표 11/20) · 메일 준비 됨' }) @IsString() @Length(2, 200) reason!: string;
}
export class PrxReportMakeDto {
  @ApiProperty({ example: '2026-10', description: '기간 열쇠 — 2026-11-19(하루) · W2026-11-16(그 주 월요일) · 2026-10(달)' }) @IsString() @Matches(PERIOD_KEY_RE) period!: string;
  @ApiPropertyOptional({ format: 'uuid', description: '비우면 그 달에 숫자가 있는 모든 광고주' }) @IsOptional() @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) advertiserId?: string;
}
export class PrxAdOwnerDto {
  @ApiProperty({ format: 'uuid', nullable: true, description: '빈 글자면 이음을 끊음(이름으로 찾음)' }) @IsString() @Matches(/^([0-9a-fA-F-]{36})?$/) advertiserId!: string;
}
export class PrxAbDto {
  @ApiProperty({ example: '봄 할인 문구 비교' }) @IsString() @Length(2, 80) title!: string;
  @ApiProperty({ example: 'AD-HERO-01' }) @IsString() @Matches(/^[A-Za-z0-9_-]{1,40}$/) codeA!: string;
  @ApiProperty({ example: 'AD-HERO-02' }) @IsString() @Matches(/^[A-Za-z0-9_-]{1,40}$/) codeB!: string;
  @ApiProperty({ example: '2026-11-21T00:00:00+09:00' }) @IsDateString() startsAt!: string;
  @ApiProperty({ example: '2026-12-05T00:00:00+09:00' }) @IsDateString() endsAt!: string;
}

/** 사용자 웹 — 메인 팝업(로그인 없이도 · 보는 사람 대상 기준) */
@ApiTags('HOM')
@Controller('api/v1')
export class PrxPublicController {
  constructor(private readonly db: DatabaseService) {}

  @Get('popups')
  @ApiOperation({ summary: '메인 팝업 공지 (v10.517)', description: '지금 기간 · 켜짐 · 내 대상(비로그인 GUEST · 회원 MEMBER · 안심 · 제휴 파트너 PARTNER)에 맞는 것 · 순서대로 prx.popup_max 개까지. 「오늘 하루 안 보기」는 브라우저에만.' })
  @ApiOkResponse({ type: Object, isArray: true })
  popups() { return publicPopups(this.db); }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/prx')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class PrxAdminController {
  constructor(private readonly db: DatabaseService, private readonly mail: MailService) {}

  /* ── v10.517 메인 팝업 ── */
  @Get('popups')
  @Roles(...VIEW)
  @ApiOperation({ summary: '메인 팝업 목록 (v10.517)' })
  @ApiOkResponse({ type: Object })
  popups() { return listPopups(this.db); }

  @Post('popups')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('PRX_POPUP_ADD', 'SETTING')
  @ApiOperation({ summary: '메인 팝업 만들기(꺼진 채) (v10.517)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRX_POPUP · PRX_POPUP_LINK · PRX_POPUP_AUD · PRX_POPUP_PERIOD' })
  addPopup(@Body() dto: PrxPopupDto) { return addPopup(this.db, dto); }

  @Put('popups/:id')
  @Roles(...VIEW)
  @Audit('PRX_POPUP_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '메인 팝업 고치기 (v10.517)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRX_POPUP_*' })
  editPopup(@Param('id') id: string, @Body() dto: PrxPopupDto) { return editPopup(this.db, id, dto); }

  @Post('popups/:id/toggle')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('PRX_POPUP_TOGGLE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '메인 팝업 켜기 · 끄기 (v10.517)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRX_POPUP_ENDED' })
  togglePopup(@Param('id') id: string, @Body() dto: PrxToggleDto) { return togglePopup(this.db, id, dto.on); }

  /* ── v10.518 기간 한정 추천 이벤트 ── */
  @Get('ref-events')
  @Roles(...VIEW)
  @ApiOperation({ summary: '추천 이벤트 목록 · 평소 점수 · 스위치 (v10.518)' })
  @ApiOkResponse({ type: Object })
  refEvents() { return listRefEvents(this.db); }

  @Post('ref-events')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('PRX_REF_EVENT_ADD', 'SETTING')
  @ApiOperation({ summary: '추천 이벤트 초안 (v10.518)', description: '직접 추천 1단계 보상의 점수만 기간 동안 바꿈 · 예산 상한 · 안내 문구 처음 틀.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRX_EVENT · PRX_EVENT_PERIOD · PRX_EVENT_POINTS · PRX_EVENT_BUDGET' })
  addRefEvent(@Body() dto: PrxRefEventDto) { return addRefEvent(this.db, dto); }

  @Put('ref-events/switch')
  @Roles('SUPER')
  @Audit('PRX_REF_EVENT_SWITCH', 'SETTING')
  @ApiOperation({ summary: '추천 이벤트 스위치 prx.ref_event (SUPER · v10.518)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRX_REASON' })
  refEventSwitch(@Body() dto: PrxSwitchDto) { return setRefEventSwitch(this.db, dto.on, dto.reason); }

  @Put('ref-events/:id')
  @Roles(...VIEW)
  @Audit('PRX_REF_EVENT_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '추천 이벤트 고치기(초안만 · 확인 다시) (v10.518)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRX_EVENT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRX_EVENT_*' })
  editRefEvent(@Param('id') id: string, @Body() dto: PrxRefEventDto) { return editRefEvent(this.db, id, dto); }

  @Put('ref-events/:id/check')
  @Roles(...VIEW)
  @Audit('PRX_REF_EVENT_CHECK', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '시행 전 확인 칸 (v10.518 · 대표 11/20)', description: '약관 확인 · 안내 문구 확인(예/아니오) · 확인한 곳 · 확인 날짜 · 메모. 둘 다 예가 아니면 시작 불가(DB 도 막음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRX_EVENT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRX_EVENT_CHECK' })
  refEventCheck(@Param('id') id: string, @Body() dto: PrxRefEventCheckDto) { return setRefEventCheck(this.db, id, dto); }

  @Post('ref-events/:id/start')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('PRX_REF_EVENT_START', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '추천 이벤트 시작 (SUPER · v10.518)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRX_EVENT_STATE · PRX_EVENT_CHECK · PRX_EVENT_PERIOD · PRX_RULE_OFF · PRX_EVENT_SWITCH · PRX_EVENT_BUSY' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '(없음)' })
  startRefEvent(@Param('id') id: string) { return startRefEvent(this.db, id); }

  @Post('ref-events/:id/end')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('PRX_REF_EVENT_END', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '추천 이벤트 끝내기 · 초안 취소 (SUPER · v10.518)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRX_EVENT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '(없음)' })
  endRefEvent(@Param('id') id: string) { return endRefEvent(this.db, id); }

  /* ── v10.519 광고 성과 보고서 ── */
  @Get('ad-reports')
  @Roles(...VIEW)
  @ApiQuery({ name: 'period', required: false, example: '2026-10', description: '비우면 지금 주기의 지난 기간' })
  @ApiOperation({ summary: '광고 성과 보고서 — 그 기간 광고주별 · 주기 · 소재 → 광고주 잇기 (v10.519)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRX_PERIOD' })
  adReports(@Query('period') period?: string) { return listReports(this.db, period); }

  @Post('ad-reports/make')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('PRX_AD_REPORT_MAKE', 'SETTING')
  @ApiOperation({ summary: '보고서 만들기 · 다시 만들기(보낸 것은 그대로) (v10.519)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '(없음)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRX_PERIOD' })
  makeReports(@Body() dto: PrxReportMakeDto) { return makeReports(this.db, dto.period, dto.advertiserId ?? null); }

  @Put('ad-reports/switch')
  @Roles('SUPER')
  @Audit('PRX_AD_REPORT_SWITCH', 'SETTING')
  @ApiOperation({ summary: '보고서 메일 스위치 prx.ad_report_mail · 보내는 주기 prx.ad_report_cycle (SUPER · v10.519 · 대표 11/20)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRX_REASON · PRX_CYCLE · PRX_NOTHING' })
  reportSwitch(@Body() dto: PrxReportSettingDto) { return setReportSettings(this.db, { on: dto.on, cycle: dto.cycle, reason: dto.reason }); }

  @Get('ad-reports/:id')
  @Roles(...VIEW)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '보고서 한 건(인쇄 · 메일 미리 보기) (v10.519)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  adReport(@Param('id') id: string) { return reportDetail(this.db, id); }

  @Post('ad-reports/:id/send')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('PRX_AD_REPORT_SEND', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '보고서 메일 보내기 (SUPER · v10.519)', description: '스위치 off 면 409 PRX_MAIL_OFF · 메일 없음 · 준비 안 됨은 ok:false.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRX_MAIL_OFF · PRX_REPORT_SENT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '(없음)' })
  sendReport(@Param('id') id: string) { return sendReport(this.db, this.mail, id); }

  @Put('ad-owners/:id')
  @Roles(...VIEW)
  @Audit('PRX_AD_OWNER_SET', 'SETTING')
  @ApiParam({ name: 'id', format: 'uuid', description: '광고 소재(ad_placements) id' })
  @ApiOperation({ summary: '소재 → 광고주 잇기 · 끊기 (v10.519)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '(없음)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '(없음)' })
  setOwner(@Param('id') id: string, @Body() dto: PrxAdOwnerDto) { return setOwner(this.db, id, dto.advertiserId || null); }

  /* ── v10.520 광고 소재 비교 시험 ── */
  @Get('ab-tests')
  @Roles(...VIEW)
  @ApiOperation({ summary: '광고 소재 비교 시험 목록 · 고를 소재 (v10.520)' })
  @ApiOkResponse({ type: Object })
  abTests() { return listAbTests(this.db); }

  @Get('ab-tests/:id')
  @Roles(...VIEW)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '비교 시험 결과(진행 중이면 지금까지 · 끝나면 고정) (v10.520)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  abTest(@Param('id') id: string) { return abDetail(this.db, id); }

  @Post('ab-tests')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('PRX_AB_ADD', 'SETTING')
  @ApiOperation({ summary: '비교 시험 초안 — 같은 슬롯 · 같은 광고주 · 같은 세그먼트 두 소재 (v10.520)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRX_AB · PRX_AB_PAIR · PRX_AB_PERIOD' })
  addAb(@Body() dto: PrxAbDto) { return addAbTest(this.db, dto); }

  @Post('ab-tests/:id/start')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('PRX_AB_START', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '비교 시험 시작 (v10.520)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRX_AB_STATE · PRX_AB_PERIOD · PRX_AB_NOT_ACTIVE · PRX_AB_BUSY' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '(없음)' })
  startAb(@Param('id') id: string) { return startAbTest(this.db, id); }

  @Post('ab-tests/:id/end')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('PRX_AB_END', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '비교 시험 끝내기 · 결과 고정 (v10.520)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRX_AB_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '(없음)' })
  endAb(@Param('id') id: string) { return endAbTest(this.db, id); }

  @Post('ab-tests/:id/cancel')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('PRX_AB_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '비교 시험 취소 (v10.520)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRX_AB_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '(없음)' })
  cancelAb(@Param('id') id: string) { return cancelAbTest(this.db, id); }
}
