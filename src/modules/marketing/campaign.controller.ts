import { Body, Controller, Get, Header, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { MailService } from '../../common/mail/mail.service';
import {
  CAMPAIGN_AUDIENCES, CAMPAIGN_CHANNELS, campaignAudience, campaignDetail, cancelCampaign, createCampaign, listCampaigns, runCampaignBatch,
  sendCampaign, setCampaignSettings, testCampaign, unsubscribe, unsubscribePage, unsubscribeResultPage, updateCampaign,
} from './campaign';

/* ---------------------------------------------------------------------
 * v10.483 (D268 · docs/621) 문자 · 메일 캠페인 — 운영 화면 › 회원 › 「문자 · 메일 캠페인」(SB-ADM-SCU-010)
 *   ADMIN · SUPER  GET  /admin/marketing/campaigns · /{id} · /{id}/audience · POST /campaigns · PUT /campaigns/{id} · POST /{id}/test · /{id}/cancel
 *   SUPER          POST /admin/marketing/campaigns/{id}/send(받는 사람 고정 · 예약) · POST /admin/marketing/run(지금 한 번) · PUT /admin/marketing/settings
 *   공개           GET · POST /site/unsubscribe(메일의 수신 거부 링크 · 화면 목록은 SB-ADM-SCU-010 에 연결(SES 웹훅이 SIT-080 에 붙은 것과 같게) · check-acl 'site' 구역 · 열쇠가 맞아야 처리)
 * ------------------------------------------------------------------- */

const STAFF = ['ADMIN'] as const;   // SUPER 는 늘 통과(2026-10-21 결정)

export class MktCampaignNewDto {
  @ApiProperty({ example: '11월 건강검진 기획전 안내' }) @IsString() @Length(2, 80) title!: string;
  @ApiProperty({ enum: CAMPAIGN_CHANNELS }) @IsIn(CAMPAIGN_CHANNELS as unknown as string[]) channel!: string;
  @ApiPropertyOptional({ example: '건강검진 패키지 20% 할인', description: '메일 제목(앞에 「(광고)」가 붙음) — 메일만' }) @IsOptional() @IsString() @Length(0, 100) subject?: string;
  @ApiProperty({ example: '이번 달 건강검진 패키지를 20% 할인해 드립니다 …', description: '글(10 ~ 2,000자 · 문자 600자) — 광고 표기 · 보낸 곳 · 수신 거부는 서버가 붙임' }) @IsString() @Length(10, 2000) body!: string;
  @ApiPropertyOptional({ enum: CAMPAIGN_AUDIENCES, description: 'ALL = 동의한 모든 회원 · RECENT_90 = 90일 안 로그인한 동의 회원' }) @IsOptional() @IsIn(CAMPAIGN_AUDIENCES as unknown as string[]) audience?: string;
}
export class MktCampaignEditDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 100) subject?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(10, 2000) body?: string;
  @ApiPropertyOptional({ enum: CAMPAIGN_AUDIENCES }) @IsOptional() @IsIn(CAMPAIGN_AUDIENCES as unknown as string[]) audience?: string;
}
export class MktCampaignSendDto {
  @ApiProperty({ example: '보내기', description: '확인 글자 「보내기」' }) @IsString() @Length(1, 10) confirm!: string;
  @ApiPropertyOptional({ example: '2026-11-21T10:00:00+09:00', description: '예약 시각(비우면 바로 · 60일 안)' }) @IsOptional() @IsString() @Length(0, 40) scheduledAt?: string;
}
export class MktCampaignCancelDto {
  @ApiProperty({ example: '할인 조건 바뀜' }) @IsString() @Length(2, 200) reason!: string;
}
export class MktSettingsDto {
  @ApiPropertyOptional({ description: 'campaign.enabled' }) @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ enum: ['ASSUME', 'LIVE'] }) @IsOptional() @IsIn(['ASSUME', 'LIVE']) mode?: string;
  @ApiPropertyOptional({ example: '(주)한국바이오헬스케어 소개뱅크 사업부' }) @IsOptional() @IsString() @Length(2, 60) senderName?: string;
  @ApiPropertyOptional({ example: '소개뱅크' }) @IsOptional() @IsString() @Length(2, 20) smsName?: string;
  @ApiPropertyOptional({ example: '1588-0000' }) @IsOptional() @IsString() @Length(0, 100) contact?: string;
  @ApiPropertyOptional({ example: '0801234567', description: '080 무료 수신 거부 번호(숫자만 · 빈 글자 = 지움)' }) @IsOptional() @IsString() @Matches(/^(|080[0-9]{7,8})$/) optoutPhone?: string;
  @ApiPropertyOptional({ example: '0212345678', description: '문자 발신번호(사전 등록 · 숫자만 · 빈 글자 = 지움)' }) @IsOptional() @IsString() @Matches(/^(|0[0-9]{8,10})$/) smsFrom?: string;
  @ApiPropertyOptional({ example: 200 }) @IsOptional() @IsInt() @Min(1) @Max(1000) batch?: number;
  @ApiProperty({ example: '080 번호 받음' }) @IsString() @Length(2, 200) reason!: string;
}
export class MktUnsubscribeDto {
  @ApiProperty({ description: '메일 링크의 열쇠(t)' }) @IsString() @Matches(/^[A-Za-z0-9_-]{20,100}$/) t!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class MktCampaignController {
  constructor(private readonly db: DatabaseService, private readonly mail: MailService) {}

  @Get('marketing/campaigns')
  @Roles(...STAFF)
  @ApiOperation({ summary: '문자 · 메일 캠페인 목록 (v10.483)', description: '설정(켜짐 · 방식 · 보낸 곳 · 연락처 · 080 · 발신번호) · 준비(메일 · 문자) · 지금 야간인지 · 동의 위반 감시 수 · 캠페인 100개(받는 사람 · 보냄 · 간주 · 건너뜀 · 실패 · 수신 거부 수).' })
  @ApiOkResponse({ type: Object })
  list() { return listCampaigns(this.db, this.mail); }

  @Get('marketing/campaigns/:id')
  @Roles(...STAFF)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '캠페인 한 건 (v10.483)', description: '글 · 상태 · 셈 · 건너뛴 까닭 · 최근 받는 사람 50(가린 값) · 수신 거부 수.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  detail(@Param('id') id: string) { return campaignDetail(this.db, id); }

  @Get('marketing/campaigns/:id/audience')
  @Roles(...STAFF)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '받을 사람 보기 (v10.483)', description: '지금 기준 — 마케팅 동의 · 2년 넘은 동의 · 받는 곳 없음 · 반송 주소 · 보낼 수 · 야간 동의 수(이름 · 주소는 내보내지 않음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  audience(@Param('id') id: string) { return campaignAudience(this.db, id); }

  @Post('marketing/campaigns')
  @Roles(...STAFF)
  @HttpCode(200)
  @Audit('MKT_CAMPAIGN_NEW', 'SETTING')
  @ApiOperation({ summary: '캠페인 초안 만들기 (v10.483)', description: '이름 · 채널(EMAIL · SMS) · 제목(메일) · 글 · 대상. 수신 거부 안내는 서버가 붙이므로 글에 넣지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKT_CHANNEL · MKT_TITLE · MKT_BODY · MKT_SMS_LEN · MKT_SUBJECT · MKT_OPTOUT_TEXT' })
  create(@Body() dto: MktCampaignNewDto) { return createCampaign(this.db, dto, RequestCtx.actorId() ?? null); }

  @Put('marketing/campaigns/:id')
  @Roles(...STAFF)
  @Audit('MKT_CAMPAIGN_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '캠페인 초안 고치기 (v10.483)', description: '초안일 때만(보내기를 누른 뒤에는 DB 도 막음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'MKT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKT_TITLE · MKT_BODY · MKT_SMS_LEN · MKT_SUBJECT · MKT_AUDIENCE · MKT_OPTOUT_TEXT' })
  update(@Param('id') id: string, @Body() dto: MktCampaignEditDto) { return updateCampaign(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Post('marketing/campaigns/:id/test')
  @Roles(...STAFF)
  @HttpCode(200)
  /* 감사 기록은 서비스가 직접(@Audit 은 응답 전체를 남겨 미리보기 · 열쇠가 들어감) */
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '나에게 시험 보내기 (v10.483)', description: '운영자 본인 메일 · 휴대폰으로 지금 방식대로(ASSUME 이면 기록만) · 광고 표기가 붙은 글 미리보기를 돌려줌 · 하루 20번.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKT_TEST_NO_ADDRESS · MKT_TEST_LIMIT · MKT_NOT_READY' })
  test(@Param('id') id: string) { return testCampaign(this.db, this.mail, id, RequestCtx.actorId() ?? null); }

  @Post('marketing/campaigns/:id/send')
  @Roles('SUPER')
  @HttpCode(200)
  /* 감사 기록은 서비스가 직접(받는 사람 수 · 방식 · 예약) */
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '캠페인 보내기 (v10.483 · SUPER)', description: 'campaign.enabled on · 확인 글자 「보내기」 · 연락처(문자는 080 번호) · LIVE 면 메일 · 문자 준비 — 받는 사람을 지금 동의자로 고정하고 예약 시각(없으면 바로)에 정기 작업이 보냄.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'MKT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKT_OFF · MKT_CONFIRM · MKT_LEGAL · MKT_NOT_READY · MKT_SCHEDULE · MKT_NO_AUDIENCE' })
  send(@Param('id') id: string, @Body() dto: MktCampaignSendDto) { return sendCampaign(this.db, this.mail, id, dto, RequestCtx.actorId() ?? null); }

  @Post('marketing/campaigns/:id/cancel')
  @Roles(...STAFF)
  @HttpCode(200)
  @Audit('MKT_CAMPAIGN_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '캠페인 취소 (v10.483)', description: '초안 · 대기 · 보내는 중 — 아직 안 보낸 받는 사람은 건너뜀(CANCELED) · 사유 2 ~ 200자.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'MKT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKT_REASON' })
  cancel(@Param('id') id: string, @Body() dto: MktCampaignCancelDto) { return cancelCampaign(this.db, id, dto.reason, RequestCtx.actorId() ?? null); }

  @Post('marketing/run')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('MKT_CAMPAIGN_RUN', 'SETTING')
  @ApiOperation({ summary: '캠페인 지금 한 번 보내기 (v10.483 · SUPER)', description: '정기 작업 mkt_campaign_send 와 같음 — 꺼져 있으면 아무것도 안 함(on: false).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'POLICY' })
  run() { return runCampaignBatch(this.db, this.mail); }

  @Put('marketing/settings')
  @Roles('SUPER')
  @Audit('MKT_SETTINGS', 'SETTING')
  @ApiOperation({ summary: '캠페인 설정 (v10.483 · SUPER)', description: '켜기 · 방식(ASSUME · LIVE) · 보낸 곳 이름 · 문자 앞 이름 · 연락처 · 080 번호 · 발신번호 · 한 번에 보내는 수 · 사유(설정 바뀜 기록).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MKT_REASON · MKT_MODE · MKT_SENDER · MKT_CONTACT · MKT_OPTOUT · MKT_SMS_FROM · MKT_BATCH · MKT_NOTHING' })
  settings(@Body() dto: MktSettingsDto) { return setCampaignSettings(this.db, dto); }
}

/* ★ 공개 주소(메일을 받은 회원이 로그인 없이 누름 · check-acl 'site' 구역). 열쇠(HMAC · 지문만 저장)가 맞아야 처리 · GET 은 확인 단추만(미리 열려도 철회 안 됨) */
@ApiTags('HOM')
@Controller('api/v1')
export class MktUnsubscribeController {
  constructor(private readonly db: DatabaseService) {}

  @Get('site/unsubscribe')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/html')
  @ApiQuery({ name: 't', required: true, description: '메일 링크의 열쇠' })
  @ApiOperation({ summary: '광고 수신 거부 화면 (v10.483 · 공개)', description: '**로그인 없는 공개 주소**. 확인 단추가 있는 글 화면(HTML) — 누르면 POST 로 철회.' })
  @ApiOkResponse({ type: String })
  page(@Query('t') t: string) { return unsubscribePage(this.db, String(t ?? '')); }

  @Post('site/unsubscribe')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/html')
  @ApiOperation({ summary: '광고 수신 거부 처리 (v10.483 · 공개)', description: '**로그인 없는 공개 주소**. 열쇠가 맞으면 마케팅 · 야간 광고 동의를 철회(약관 동의 기록에 거부 한 줄) · 아직 안 보낸 캠페인 줄 멈춤 · 처리 결과 알림 · 결과 화면(HTML).' })
  @ApiOkResponse({ type: String })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  done(@Body() dto: MktUnsubscribeDto) { return unsubscribeResultPage(this.db, dto.t); }

  @Post('site/unsubscribe/json')
  @HttpCode(200)
  @ApiOperation({ summary: '광고 수신 거부 처리 — JSON (v10.483 · 공개)', description: '**로그인 없는 공개 주소**. 위와 같은 처리를 JSON 으로(사용자 웹 · 시험).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  doneJson(@Body() dto: MktUnsubscribeDto) { return unsubscribe(this.db, dto.t); }
}
