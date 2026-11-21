import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { BZX_SWITCHES, setNumber, setSwitch, switches } from './common';
import { pcCancel, pcCheck, pcCreate, pcList, pcMine, pcOne, pcSign } from './partner-contract';
import { adBudgetJob, adBudgets, CAP_KINDS, CAP_PERIODS, offAdBudget, resetAdBudget, setAdBudget } from './ad-budget';
import { addMyPhotos, addStaffPhotos, myPhotoFile, myPhotos, staffPhotos } from './inquiry-photos';
import { csQuality, csReview, csSamples } from './answer-quality';
import { cardNoticeJob, cardNotices } from './card-notice';
import { hcPlanArchive, hcPlanOne, hcPlans, hcPlanSave, hcSimulate } from './hc-sim';

/* ---------------------------------------------------------------------
 * v10.609 ~ 614 (docs/751 ~ 756) 18차 파트너 · 고객센터 · 회계 · 인사
 *   운영  /api/v1/admin/bzx/…   — ㉕ partner-contracts · ㉖ ad-budgets · ㉗ inquiries/{id}/photos · ㉘ cs-quality · ㉙ card-notices · ㉚ hc-plans · hc-sim · switch
 *   회원  /api/v1/me/bzx/inquiries/{id}/photos(+ /{fileId} 바이트)
 *   파트너 /api/v1/partner/bzx/contracts(+ /{id}/sign) — 대표 계정만
 *   보기 범위: ㉕ ADMIN · SUPER · 안심 파트너 담당(보기만) · ㉖ ㉗ ㉘ ADMIN · SUPER · ㉙ ㉚ SUPER · 지급 담당(급여 · 카드 한도 탭과 같음)
 *   세무사(ACCOUNTANT)는 /admin/acct/ 밖이라 ㉙ ㉚ 도 못 봄(인건비 계획 · 카드 쓰는 사람은 회사 안 정보 · NOTES)
 * ------------------------------------------------------------------- */

const ID = /^\d{1,18}$/;
const UUID = /^[0-9a-fA-F-]{36}$/;

export class BzxSwitchDto {
  @ApiProperty({ enum: Object.keys(BZX_SWITCHES), example: 'bzx.card_notify' }) @IsString() @IsIn(Object.keys(BZX_SWITCHES)) key!: string;
  @ApiProperty({ example: true }) @IsBoolean() on!: boolean;
  @ApiProperty({ example: '카드 한도에 쓰는 사람을 모두 정함' }) @IsString() @Length(2, 200) reason!: string;
}
export class BzxReasonDto {
  @ApiProperty({ example: '파트너 요청으로 기간 다시 정함' }) @IsString() @Length(2, 200) reason!: string;
}
export class BzxPcCreateDto {
  @ApiPropertyOptional({ format: 'uuid', description: '새 계약 · 종이 계약 — 파트너 번호(갱신이면 비움)' }) @IsOptional() @IsString() @Matches(UUID) partnerId?: string;
  @ApiPropertyOptional({ example: '12', description: '갱신할 계약 번호(서명이 끝난 계약)' }) @IsOptional() @IsString() @Matches(ID) prevId?: string;
  @ApiPropertyOptional({ example: '안심소개 파트너 계약 (갱신 2027)' }) @IsOptional() @IsString() @Length(0, 100) title?: string;
  @ApiPropertyOptional({ example: '2027-01-01', description: '비우면 갱신은 지금 만기 다음 날 · 새 계약은 오늘' }) @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) startOn?: string;
  @ApiProperty({ example: '2027-12-31' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) endOn!: string;
  @ApiPropertyOptional({ example: 30, description: '만기 며칠 전부터 알림(1 ~ 180 · 처음 30)' }) @IsOptional() @IsInt() @Min(1) @Max(180) noticeDays?: number;
  @ApiPropertyOptional({ example: false }) @IsOptional() @IsBoolean() autoRenew?: boolean;
  @ApiPropertyOptional({ example: false, description: 'true 면 이미 종이로 맺은 계약을 적기만(서명 끝 · PAPER)' }) @IsOptional() @IsBoolean() paper?: boolean;
}
export class BzxPcSignDto {
  @ApiProperty({ example: '홍길동', description: '대표자 이름(또는 상호)' }) @IsString() @Length(1, 60) signerName!: string;
  @ApiProperty({ example: true }) @IsBoolean() agree!: boolean;
  @ApiPropertyOptional({ description: '본 계약서 지문(보는 사이 바뀌었는지 확인)' }) @IsOptional() @IsString() @Matches(/^[0-9a-f]{64}$/) docHash?: string;
}
export class BzxAdBudgetDto {
  @ApiProperty({ enum: CAP_KINDS }) @IsString() @IsIn(CAP_KINDS as unknown as string[]) capKind!: string;
  @ApiProperty({ example: 100000 }) @IsInt() @Min(1) @Max(1000000000) capValue!: number;
  @ApiPropertyOptional({ enum: CAP_PERIODS, description: 'TOTAL 기간 전체(처음) · DAY 하루(한국 날짜)' }) @IsOptional() @IsString() @IsIn(CAP_PERIODS as unknown as string[]) period?: string;
  @ApiPropertyOptional({ example: 80, description: '알림 기준 %(50 ~ 99 · 처음 80)' }) @IsOptional() @IsInt() @Min(50) @Max(99) alertPct?: number;
  @ApiPropertyOptional({ example: false, description: '상한에 닿으면 소재 자동 정지(스위치 bzx.ad_autopause 도 켜져야 함)' }) @IsOptional() @IsBoolean() autoPause?: boolean;
  @ApiPropertyOptional({ example: '11월 계약분' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class BzxPhotoDto {
  @ApiProperty({ type: [String], description: 'POST /files(INQUIRY_ATTACHMENT · JPG · PNG)로 올린 내 파일 번호 · 한 번에 3개까지' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @IsString({ each: true }) @Matches(UUID, { each: true }) fileIds!: string[];
}
export class BzxCsReviewDto {
  @ApiProperty({ format: 'uuid' }) @IsString() @Matches(UUID) inquiryId!: string;
  @ApiProperty({ example: 4, description: '정확(1 ~ 5)' }) @IsInt() @Min(1) @Max(5) accuracy!: number;
  @ApiProperty({ example: 5, description: '친절(1 ~ 5)' }) @IsInt() @Min(1) @Max(5) kindness!: number;
  @ApiProperty({ example: 4, description: '충분(1 ~ 5)' }) @IsInt() @Min(1) @Max(5) completeness!: number;
  @ApiPropertyOptional({ example: '환불 기한 안내가 빠짐' }) @IsOptional() @IsString() @Length(0, 300) note?: string;
}
export class BzxCardSettingDto {
  @ApiProperty({ example: 500000, description: '한 건 이 금액 이상이면 운영 알림(10,000 ~ 100,000,000)' }) @IsInt() @Min(10000) @Max(100000000) bigAmount!: number;
  @ApiProperty({ example: '경비 규정 개정' }) @IsString() @Length(2, 200) reason!: string;
}
export class BzxHcLineDto {
  @ApiProperty({ example: '개발자' }) role!: string;
  @ApiProperty({ example: 2 }) count!: number;
  @ApiProperty({ example: 4000000 }) monthlyBase!: number;
  @ApiPropertyOptional({ example: 200000 }) nontax?: number;
  @ApiProperty({ example: '2027-03' }) startYm!: string;
  @ApiPropertyOptional({ example: null, nullable: true }) endYm?: string | null;
}
export class BzxHcPlanDto {
  @ApiProperty({ example: '2027 상반기 채용' }) @IsString() @Length(2, 80) title!: string;
  @ApiProperty({ example: '2027-01' }) @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) startYm!: string;
  @ApiProperty({ example: 12, description: '1 ~ 36개월' }) @IsInt() @Min(1) @Max(36) months!: number;
  @ApiPropertyOptional({ example: 3, description: '해마다 인상률 %(0 ~ 30 · 시작부터 12개월마다)' }) @IsOptional() @IsNumber() @Min(0) @Max(30) raisePct?: number;
  @ApiPropertyOptional({ example: true, description: '지금 직원(재직자)을 함께 셈(처음 true)' }) @IsOptional() @IsBoolean() includeCurrent?: boolean;
  @ApiProperty({ type: [BzxHcLineDto], description: '채용 줄(30개까지 · 칸 검사는 서버가)' }) @IsArray() @ArrayMaxSize(30) lines!: BzxHcLineDto[];
}

/* ── 운영 ── */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/bzx')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class BzxAdminController {
  constructor(private readonly db: DatabaseService) {}

  @Get('switches')
  @Roles('ADMIN', 'SUPER', 'PAYOUT')
  @ApiOperation({ summary: '18차 스위치 상태 (v10.609 ~ 614)', description: '모두 처음 off.' })
  @ApiOkResponse({ type: Object, isArray: true })
  switches() { return switches(this.db); }

  @Put('switch')
  @Roles('SUPER')
  @Audit('BZX_SWITCH', 'SETTING')
  @ApiOperation({ summary: '18차 스위치 켜기 · 끄기 (SUPER · 사유)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BZX_SWITCH · BZX_REASON' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  setSwitch(@Body() dto: BzxSwitchDto) { return setSwitch(this.db, dto.key, dto.on, dto.reason); }

  /* ── ㉕ v10.609 파트너 계약 갱신 ── */
  @Get('partner-contracts')
  @Roles('ADMIN', 'SUPER', 'PARTNER_MAL')
  @ApiQuery({ name: 'state', required: false, enum: ['SENT', 'SIGNED', 'EXPIRED', 'ENDED', 'CANCELED'] })
  @ApiQuery({ name: 'due', required: false, description: '1 이면 만기 알림 기간에 든 · 갱신 안 보낸 것만' })
  @ApiOperation({ summary: '파트너 계약 목록 (v10.609)', description: '만기 · 남은 날 · 갱신 계약 상태 · 서명 길(간주 · 전자계약).' })
  @ApiOkResponse({ type: Object })
  pcList(@Query('state') state?: string, @Query('due') due?: string) { return pcList(this.db, { state, due: due === '1' || due === 'true' }); }

  @Get('partner-contracts/:id')
  @Roles('ADMIN', 'SUPER', 'PARTNER_MAL')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '파트너 계약 한 건(본문 · 지문) (v10.609)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  pcOne(@Param('id') id: string) { return pcOne(this.db, id); }

  @Post('partner-contracts')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @Audit('BZX_PC_CREATE', 'PARTNER', { pick: ['id', 'state', 'signMode'] })
  @ApiOperation({ summary: '파트너 계약 보내기 · 갱신 · 종이 계약 적기 (v10.609)', description: 'prevId 가 있으면 갱신(새 줄 · 다시 서명) · paper true 면 이미 맺은 종이 계약을 적기만. 서명 길은 bzx.partner_esign(off = 간주).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'BZX_PC_STATE · BZX_PC_RENEWING · BZX_PC_PARTNER · ESIGN_FAILED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'NOT_READY · BZX_PC_INPUT · BZX_PC_DATE · BZX_PC_NOTICE · BZX_PC_TEMPLATE' })
  pcCreate(@Body() dto: BzxPcCreateDto) { return pcCreate(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('partner-contracts/:id/check')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '전자계약 업체 상태 맞추기 (v10.609 · HTTP 만)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'BZX_PC_STATE · BZX_PC_HASH · ESIGN_FAILED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'NOT_READY' })
  pcCheck(@Param('id') id: string) { return pcCheck(this.db, id); }

  @Post('partner-contracts/:id/cancel')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @Audit('BZX_PC_CANCEL', 'PARTNER', { pick: ['id', 'state'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '보낸 파트너 계약 취소 (v10.609 · 사유)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'BZX_PC_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BZX_REASON' })
  pcCancel(@Param('id') id: string, @Body() dto: BzxReasonDto) { return pcCancel(this.db, id, dto.reason); }

  /* ── ㉖ v10.610 광고 예산 ── */
  @Get('ad-budgets')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '광고 예산 · 쓴 양 (v10.610)' })
  @ApiOkResponse({ type: Object })
  adBudgets() { return adBudgets(this.db); }

  @Post('ad-budgets/run')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @ApiOperation({ summary: '광고 예산 지금 점검 (v10.610 · 정기 작업과 같은 일)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  adRun() { return adBudgetJob(this.db); }

  @Put('ad-budgets/:creativeId')
  @Roles('ADMIN', 'SUPER')
  @Audit('BZX_AD_BUDGET_SET', 'SETTING', { pick: ['id', 'created'] })
  @ApiParam({ name: 'creativeId', format: 'uuid' })
  @ApiOperation({ summary: '광고 소재 예산 넣기 · 고치기 (v10.610)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BZX_AD_CAP' })
  setAdBudget(@Param('creativeId') creativeId: string, @Body() dto: BzxAdBudgetDto) { return setAdBudget(this.db, creativeId, dto, RequestCtx.actorId() ?? null); }

  @Post('ad-budgets/:id/reset')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @Audit('BZX_AD_BUDGET_RESET', 'SETTING', { pick: ['id', 'resumed'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '광고 예산 다시 채움(셈 다시 시작 · 우리가 멈춘 소재는 다시 노출) (v10.610)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'BZX_AD_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  resetAdBudget(@Param('id') id: string) { return resetAdBudget(this.db, id, RequestCtx.actorId() ?? null); }

  @Post('ad-budgets/:id/off')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @Audit('BZX_AD_BUDGET_OFF', 'SETTING', { pick: ['id'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '광고 예산 끄기 (v10.610)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  offAdBudget(@Param('id') id: string) { return offAdBudget(this.db, id, RequestCtx.actorId() ?? null); }

  /* ── ㉗ v10.611 1:1 문의 사진 ── */
  @Get('inquiries/:id/photos')
  @Roles('ADMIN', 'SUPER')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '1:1 문의 사진(접수 첨부 · 더한 사진 · 답변 사진) (v10.611)', description: '미리 보기 주소는 GET /files/{id}?disposition=inline.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  staffPhotos(@Param('id') id: string) { return staffPhotos(this.db, id); }

  @Post('inquiries/:id/photos')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @Audit('BZX_INQ_PHOTO_STAFF', 'INQUIRY', { pick: ['id', 'added'] })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '답변 사진 붙이기 (v10.611 · bzx.inquiry_photos on)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'INQUIRY_CLOSED · BZX_INQ_GUEST · BZX_INQ_PHOTO_FULL' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BZX_OFF · BZX_INQ_PHOTO' })
  addStaffPhotos(@Param('id') id: string, @Body() dto: BzxPhotoDto) { return addStaffPhotos(this.db, RequestCtx.actorId() ?? null, id, dto.fileIds); }

  /* ── ㉘ v10.612 상담원별 답변 품질 ── */
  @Get('cs-quality')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'days', required: false, example: 30 })
  @ApiOperation({ summary: '상담원별 답변 품질 (v10.612)', description: '처음 답한 운영자마다 답한 수 · 처음 답 시간 · 기한 안 · 해결률 · 다시 열림 · 표본 점검 점수.' })
  @ApiOkResponse({ type: Object })
  csQuality(@Query('days') days?: string) { return csQuality(this.db, Number(days)); }

  @Get('cs-quality/samples')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'agent', required: false, description: '상담원 계정 번호(uuid)' })
  @ApiOperation({ summary: '표본 점검할 문의 5건 (v10.612 · 남이 답한 것 · 내가 점검 안 한 것)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BZX_CSQ' })
  csSamples(@Query('agent') agent?: string) { return csSamples(this.db, RequestCtx.actorId() ?? null, agent); }

  @Post('cs-quality/reviews')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @Audit('BZX_CSQ_REVIEW', 'INQUIRY', { pick: ['id'] })
  @ApiOperation({ summary: '표본 점검 남기기 (v10.612 · 쌓기만)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'BZX_CSQ_SELF · BZX_CSQ_DONE · BZX_CSQ_NO_ANSWER' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BZX_CSQ_SCORE' })
  csReview(@Body() dto: BzxCsReviewDto) { return csReview(this.db, RequestCtx.actorId() ?? null, dto); }

  /* ── ㉙ v10.613 법인카드 사용 알림 ── */
  @Get('card-notices')
  @Roles('SUPER', 'PAYOUT')
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '법인카드 사용 알림 목록 (v10.613)' })
  @ApiOkResponse({ type: Object })
  cardNotices(@Query('ym') ym?: string) { return cardNotices(this.db, ym); }

  @Put('card-notices/settings')
  @Roles('SUPER')
  @Audit('BZX_CARD_SETTING', 'SETTING')
  @ApiOperation({ summary: '큰 금액 기준 바꾸기 (v10.613 · SUPER · 사유)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BZX_SETTING · BZX_REASON' })
  cardSetting(@Body() dto: BzxCardSettingDto) { return setNumber(this.db, 'bzx.card_big_amount', dto.bigAmount, 10000, 100000000, dto.reason); }

  @Post('card-notices/run')
  @Roles('SUPER', 'PAYOUT')
  @HttpCode(200)
  @ApiOperation({ summary: '카드 사용 알림 지금 보내기 (v10.613 · 정기 작업과 같은 일 · 스위치 off 면 보내지 않음)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  cardRun() { return cardNoticeJob(this.db); }

  /* ── ㉚ v10.614 인건비 시뮬레이션 ── */
  @Get('hc-plans')
  @Roles('SUPER', 'PAYOUT')
  @ApiOperation({ summary: '인건비 계획 목록 (v10.614)' })
  @ApiOkResponse({ type: Object })
  hcPlans() { return hcPlans(this.db); }

  @Get('hc-plans/:id')
  @Roles('SUPER', 'PAYOUT')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '인건비 계획 한 건 + 지금 요율로 다시 셈 (v10.614)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  hcPlanOne(@Param('id') id: string) { return hcPlanOne(this.db, id); }

  @Post('hc-sim')
  @Roles('SUPER', 'PAYOUT')
  @HttpCode(200)
  @ApiOperation({ summary: '인건비 셈(저장 안 함) (v10.614)', description: '달마다 인원 · 지급액 · 회사 4대보험 · 퇴직금 적립 · 합계 · 지금 직원만일 때와 차이. 합계만(이름 없음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BZX_HC_INPUT' })
  hcSim(@Body() dto: BzxHcPlanDto) { return hcSimulate(this.db, dto); }

  @Post('hc-plans')
  @Roles('SUPER', 'PAYOUT')
  @HttpCode(200)
  @Audit('BZX_HC_PLAN_SAVE', 'SETTING', { pick: ['id'] })
  @ApiOperation({ summary: '인건비 계획 저장 (v10.614)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BZX_HC_INPUT' })
  hcSave(@Body() dto: BzxHcPlanDto) { return hcPlanSave(this.db, null, dto, RequestCtx.actorId() ?? null); }

  @Put('hc-plans/:id')
  @Roles('SUPER', 'PAYOUT')
  @Audit('BZX_HC_PLAN_SAVE', 'SETTING', { pick: ['id'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '인건비 계획 고치기 (v10.614)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'BZX_HC_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BZX_HC_INPUT' })
  hcEdit(@Param('id') id: string, @Body() dto: BzxHcPlanDto) { return hcPlanSave(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Post('hc-plans/:id/archive')
  @Roles('SUPER', 'PAYOUT')
  @HttpCode(200)
  @Audit('BZX_HC_PLAN_ARCHIVE', 'SETTING', { pick: ['id'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '인건비 계획 보관 (v10.614)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'BZX_HC_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  hcArchive(@Param('id') id: string) { return hcPlanArchive(this.db, id, RequestCtx.actorId() ?? null); }
}

/* ── 회원 — 내 1:1 문의 사진 ── */
@ApiTags('MYP')
@ApiBearerAuth()
@Controller('api/v1/me/bzx')
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
export class BzxMeController {
  constructor(private readonly db: DatabaseService) {}

  @Get('inquiries/:id/photos')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '내 문의 사진(내가 더한 것 · 답변 사진) (v10.611)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 내 문의가 아님' })
  myPhotos(@Param('id') id: string) { return myPhotos(this.db, RequestCtx.actorId() ?? null, id); }

  @Post('inquiries/:id/photos')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '내 문의에 사진 더 붙이기 (v10.611 · bzx.inquiry_photos on · 한 번에 3장 · 문의마다 6장)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'INQUIRY_CLOSED · BZX_INQ_PHOTO_FULL' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BZX_OFF · BZX_INQ_PHOTO' })
  addMyPhotos(@Param('id') id: string, @Body() dto: BzxPhotoDto) { return addMyPhotos(this.db, RequestCtx.actorId() ?? null, id, dto.fileIds); }

  @Get('inquiries/:id/photos/:fileId')
  @ApiParam({ name: 'id', format: 'uuid' }) @ApiParam({ name: 'fileId', format: 'uuid' })
  @ApiOperation({ summary: '내 문의 사진 바이트 (v10.611)' })
  @ApiOkResponse({ description: '그림 바이트', content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/png': { schema: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  async myPhotoFile(@Param('id') id: string, @Param('fileId') fileId: string, @Res() res: Response) {
    const f = await myPhotoFile(this.db, RequestCtx.actorId() ?? null, id, fileId);
    res.status(200);
    res.setHeader('Content-Type', f.contentType); res.setHeader('Content-Length', String(f.size));
    res.setHeader('Content-Disposition', f.disposition);
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    f.stream.on('error', () => res.destroy());
    f.stream.pipe(res);
  }
}

/* ── 파트너센터 — 내 파트너 계약(대표 계정만) ── */
@ApiTags('PTC')
@ApiBearerAuth()
@Controller('api/v1/partner/bzx')
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
export class BzxPartnerController {
  constructor(private readonly db: DatabaseService) {}

  @Get('contracts')
  @ApiOperation({ summary: '내 파트너 계약 (v10.609 · 대표 계정만)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 파트너 대표가 아님' })
  mine() { return pcMine(this.db, RequestCtx.actorId() ?? null); }

  @Post('contracts/:id/sign')
  @HttpCode(200)
  @Audit('BZX_PC_SIGN', 'PARTNER', { pick: ['id', 'state'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '파트너 계약 서명 (v10.609 · 간주 · 시험 서명 — 법적 전자서명 아님)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'BZX_PC_STATE · BZX_PC_HASH · ESIGN_EXTERNAL' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BZX_PC_AGREE · BZX_PC_SIGNER' })
  sign(@Param('id') id: string, @Body() dto: BzxPcSignDto, @Headers('user-agent') ua?: string) { return pcSign(this.db, RequestCtx.actorId() ?? null, id, dto, ua); }
}
