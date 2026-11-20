import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { StrictBoolean } from '../../common/strict-boolean';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { DatabaseService } from '../../db/database.service';
import { MailService } from '../../common/mail/mail.service';
import { TelegramService } from '../../common/telegram/telegram.service';
import { UPT_PARTS } from '../uptime/uptime';
import { OPZ_YM_RE, setOpzIrSettings, setOpzNlSettings } from './opz-settings';
import { cancelNl, createNl, listNl, nlDetail, sendNl, testNl, updateNl } from './newsletter';
import {
  OPZ_CODE_RE, OPZ_KINDS, OPZ_SEVS, addIncidentNote, checkStep, createRunbook, finalizeReview, incidentBoard, incidentDetail, linkUpt, openIncident,
  pageAgain, runbookDetail, saveReview, saveRunbook, setIncidentState,
} from './incident';

/* ---------------------------------------------------------------------
 * v10.556 · 557 (D288 · docs/694 · 695) (58) 운영 4
 *   OpzNewsletterController  api/v1/admin/opz  (ADMIN · SUPER — 회원 › 월간 뉴스레터 · 보내기 · 보낸 호 취소 · 설정 SUPER)
 *     GET  /newsletters · GET /newsletters/{id} · POST /newsletters · PUT /newsletters/{id} · POST /newsletters/{id}/test
 *     POST /newsletters/{id}/send(SUPER) · POST /newsletters/{id}/cancel · PUT /newsletter-settings(SUPER)
 *   OpzIncidentController    api/v1/admin/opz  (ADMIN · SUPER — 위험감지 › 장애 대응 · 설정 SUPER)
 *     GET  /incidents · GET /incidents/{id} · POST /incidents · POST /incidents/{id}/page · POST /incidents/{id}/steps/{stepId}
 *     POST /incidents/{id}/notes · POST /incidents/{id}/state · PUT /incidents/{id}/upt · PUT /incidents/{id}/review · POST /incidents/{id}/review/finalize
 *     GET  /runbooks/{id} · POST /runbooks · PUT /runbooks/{id} · PUT /incident-settings(SUPER)
 *   공개 · 회원 라우트 없음 · 세무사(ACCOUNTANT)는 보지 않음(/admin/acct/ 밖)
 * ------------------------------------------------------------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class OpzNlCreateDto {
  @ApiPropertyOptional({ example: '2026-11', description: '달 YYYY-MM(비우면 이번 달 · 한국)' }) @IsOptional() @IsString() @Matches(OPZ_YM_RE) ym?: string;
  @ApiPropertyOptional({ example: '소개뱅크 11월 소식', description: '호 이름 2 ~ 60자' }) @IsOptional() @IsString() @Length(2, 60) title?: string;
}
export class OpzNlUpdateDto {
  @ApiPropertyOptional({ example: '소개뱅크 11월 소식' }) @IsOptional() @IsString() @Length(2, 60) title?: string;
  @ApiPropertyOptional({ example: '소개뱅크 11월 소식', description: '메일 제목 1 ~ 90자(보낼 때 앞에 「(광고)」)' }) @IsOptional() @IsString() @Length(1, 90) subject?: string;
  @ApiPropertyOptional({ example: '이번 달 새 기능과 인기 매물을 모았습니다.', description: '첫 인사 500자까지(주소 · 중괄호 · 수신 거부 글 금지)' }) @IsOptional() @IsString() @MaxLength(500) intro?: string;
  @ApiPropertyOptional({ description: '틀 10 ~ 1,200자 — 자리값 {month} {intro} {notices} {listings} {events} {base} 만 · 주소 직접 쓰기 금지' }) @IsOptional() @IsString() @Length(10, 1200) frame?: string;
  @ApiPropertyOptional({ type: [String], description: '고른 공지 id(10개까지)' }) @IsOptional() @IsArray() @ArrayMaxSize(10) @Matches(UUID_RE, { each: true }) noticeIds?: string[];
  @ApiPropertyOptional({ type: [String], description: '고른 매물 id(10개까지)' }) @IsOptional() @IsArray() @ArrayMaxSize(10) @Matches(UUID_RE, { each: true }) listingIds?: string[];
  @ApiPropertyOptional({ type: [String], description: '고른 이벤트 id(10개까지)' }) @IsOptional() @IsArray() @ArrayMaxSize(10) @Matches(UUID_RE, { each: true }) eventIds?: string[];
}
export class OpzNlSendDto {
  @ApiProperty({ example: '보내기', description: '확인 글자 「보내기」' }) @IsString() @Length(1, 10) confirm!: string;
  @ApiPropertyOptional({ example: '2026-11-25T01:00:00Z', description: '예약 시각(비우면 바로 · 60일 안)' }) @IsOptional() @IsString() @MaxLength(40) scheduledAt?: string;
}
export class OpzNlCancelDto {
  @ApiProperty({ example: '이번 달은 쉼' }) @IsString() @Length(2, 200) reason!: string;
}
export class OpzNlSettingsDto {
  @ApiPropertyOptional({ description: 'opz.nl_enabled' }) @IsOptional() @StrictBoolean() nlOn?: boolean;
  @ApiPropertyOptional({ example: 5 }) @IsOptional() @IsInt() @Min(1) @Max(10) nlItems?: number;
  @ApiPropertyOptional({ example: 30 }) @IsOptional() @IsInt() @Min(7) @Max(90) nlListingDays?: number;
  @ApiProperty({ example: '법무 확인 끝 · 뉴스레터 켬' }) @IsString() @Length(2, 200) reason!: string;
}

export class OpzStepDto {
  @ApiProperty({ example: '상태 주소 · 바깥 감시 확인' }) @IsString() @Length(2, 200) title!: string;
  @ApiPropertyOptional({ example: '위험감지 › 가동 · 장애 공지에서 대상별 상태를 봄' }) @IsOptional() @IsString() @MaxLength(1000) detail?: string;
}
export class OpzRunbookCreateDto {
  @ApiProperty({ example: 'CDN_FAIL' }) @IsString() @Matches(OPZ_CODE_RE) code!: string;
  @ApiProperty({ example: '사진이 안 보임' }) @IsString() @Length(2, 80) title!: string;
  @ApiProperty({ enum: OPZ_KINDS }) @IsIn([...OPZ_KINDS]) kind!: string;
  @ApiPropertyOptional({ enum: OPZ_SEVS }) @IsOptional() @IsIn([...OPZ_SEVS]) sevDefault?: string;
  @ApiPropertyOptional({ enum: UPT_PARTS, isArray: true }) @IsOptional() @IsArray() @ArrayMaxSize(7) @IsIn([...UPT_PARTS], { each: true }) parts?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) summary?: string;
  @ApiProperty({ type: [OpzStepDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => OpzStepDto) steps!: OpzStepDto[];
}
export class OpzRunbookSaveDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) title?: string;
  @ApiPropertyOptional({ enum: OPZ_KINDS }) @IsOptional() @IsIn([...OPZ_KINDS]) kind?: string;
  @ApiPropertyOptional({ enum: OPZ_SEVS }) @IsOptional() @IsIn([...OPZ_SEVS]) sevDefault?: string;
  @ApiPropertyOptional({ enum: UPT_PARTS, isArray: true }) @IsOptional() @IsArray() @ArrayMaxSize(7) @IsIn([...UPT_PARTS], { each: true }) parts?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) summary?: string;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() isActive?: boolean;
  @ApiPropertyOptional({ type: [OpzStepDto], description: '보내면 단계를 통째로 바꿈(판 +1)' }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => OpzStepDto) steps?: OpzStepDto[];
}
export class OpzIncidentOpenDto {
  @ApiProperty({ example: '1', description: '런북 번호' }) @IsString() @Matches(/^\d{1,18}$/) runbookId!: string;
  @ApiPropertyOptional({ example: '사이트 접속 안 됨' }) @IsOptional() @IsString() @Length(2, 120) title?: string;
  @ApiPropertyOptional({ enum: OPZ_SEVS }) @IsOptional() @IsIn([...OPZ_SEVS]) sev?: string;
  @ApiPropertyOptional({ example: '123', description: '이 운영 알림(UPTIME_DOWN 등)으로 엶 — 한 알림에 한 장애' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) sourceAlertId?: string;
  @ApiPropertyOptional({ description: 'D272 장애 공지도 올리기(사용자 웹 맨 위 띠)' }) @IsOptional() @StrictBoolean() uptNotice?: boolean;
  @ApiPropertyOptional({ example: '일부 화면이 열리지 않습니다' }) @IsOptional() @IsString() @MaxLength(120) publicTitle?: string;
  @ApiPropertyOptional({ example: '원인을 찾고 있습니다.' }) @IsOptional() @IsString() @MaxLength(1000) publicBody?: string;
  @ApiPropertyOptional({ example: '사무실 · 집 두 곳 모두 안 열림' }) @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class OpzStepCheckDto {
  @ApiProperty({ description: '끝냄(true) · 되돌림(false)' }) @StrictBoolean() done!: boolean;
}
export class OpzNoteDto {
  @ApiProperty({ example: '디스크 90 넘음 확인' }) @IsString() @Length(2, 1000) body!: string;
}
export class OpzStateDto {
  @ApiProperty({ enum: ['MITIGATED', 'CLOSED'] }) @IsIn(['MITIGATED', 'CLOSED']) state!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) body?: string;
  @ApiPropertyOptional({ description: '끝낼 때 이은 D272 장애 공지도 끝냄' }) @IsOptional() @StrictBoolean() resolveNotice?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) resolveBody?: string;
}
export class OpzUptLinkDto {
  @ApiPropertyOptional({ example: '12', description: '이미 있는 장애 공지 번호' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) uptIncidentId?: string;
  @ApiPropertyOptional({ description: '새로 올리기' }) @IsOptional() @StrictBoolean() create?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) publicTitle?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) publicBody?: string;
}
export class OpzReviewDto {
  @ApiPropertyOptional({ example: '배포 뒤 DB 연결 수가 넘쳐 15분 동안 접속이 안 됨' }) @IsOptional() @IsString() @MaxLength(2000) summary?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) cause?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) impact?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) wentWell?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) improve?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) actions?: string;
}
export class OpzReviewFinalDto {
  @ApiProperty({ example: '확정' }) @IsString() @Length(1, 10) confirm!: string;
}
export class OpzIrSettingsDto {
  @ApiPropertyOptional({ description: 'opz.ir_enabled' }) @IsOptional() @StrictBoolean() irOn?: boolean;
  @ApiPropertyOptional({ description: 'opz.ir_page_now' }) @IsOptional() @StrictBoolean() irPageNow?: boolean;
  @ApiPropertyOptional({ example: 3 }) @IsOptional() @IsInt() @Min(1) @Max(14) irReviewDays?: number;
  @ApiProperty({ example: '런북 읽음 · 당번 정함 · 장애 대응 켬' }) @IsString() @Length(2, 200) reason!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/opz')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class OpzNewsletterController {
  constructor(private readonly db: DatabaseService, private readonly mail: MailService) {}

  @Get('newsletters')
  @ApiOperation({ summary: '월간 뉴스레터 목록 (v10.556)', description: '호마다 상태 · 넘긴 캠페인 상태 · 보낸 · 간주 · 건너뜀 · 실패 · 수신 거부 수 · 설정 · 캠페인 스위치 · 방식.' })
  @ApiOkResponse({ type: Object })
  list() { return listNl(this.db); }

  @Get('newsletters/:id')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '뉴스레터 한 호 (v10.556)', description: '고른 것 · 후보(공지 · 인기 매물 · 이벤트 각 20) · 채운 본문 길이(2,000자) · 미리보기(광고 표기 · 보낸 곳 · 수신 거부 자리) · 받을 사람 수(캠페인 초안이 있을 때) · 틀 문제.' })
  @ApiOkResponse({ type: Object })
  detail(@Param('id') id: string) { return nlDetail(this.db, id); }

  @Post('newsletters')
  @Audit('OPZ_NL_CREATE', 'SETTING')
  @ApiOperation({ summary: '뉴스레터 초안 만들기 (v10.556)', description: '달마다 한 호(취소한 호 빼고) · 후보에서 묶음마다 opz.nl_items 개를 먼저 골라 둠 · 기본 틀.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPZ_NL_EXISTS' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPZ_NL_YM · OPZ_NL_TITLE' })
  create(@Body() dto: OpzNlCreateDto) { return createNl(this.db, { ym: dto.ym, title: dto.title }); }

  @Put('newsletters/:id')
  @Audit('OPZ_NL_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '뉴스레터 고치기 (v10.556)', description: '초안만 · 보낸 칸만 바꿈 · 틀 검사(자리값 · 주소 직접 쓰기 · 중괄호 · 수신 거부 글) · 고른 것은 게시 중인 것만 · 본문 2,000자 넘으면 저장은 하되 시험 · 보내기 막음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPZ_NL_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPZ_NL_TITLE · OPZ_NL_SUBJECT · OPZ_NL_INTRO · OPZ_NL_FRAME · OPZ_NL_PICK' })
  update(@Param('id') id: string, @Body() dto: OpzNlUpdateDto) {
    return updateNl(this.db, id, { title: dto.title, subject: dto.subject, intro: dto.intro, frame: dto.frame, noticeIds: dto.noticeIds, listingIds: dto.listingIds, eventIds: dto.eventIds });
  }

  @Post('newsletters/:id/test')
  @HttpCode(200)
  /* 감사 기록은 캠페인 시험이 직접(MKT_CAMPAIGN_TEST) */
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '뉴스레터 나에게 시험 (v10.556)', description: '캠페인 초안을 맞추고(없으면 만듦) 캠페인 시험 그대로 — 운영자 본인 메일 · 지금 방식(ASSUME 이면 기록만) · 하루 20번 · 미리보기.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPZ_NL_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPZ_NL_LONG · MKT_TEST_NO_ADDRESS · MKT_TEST_LIMIT · MKT_NOT_READY' })
  test(@Param('id') id: string) { return testNl(this.db, this.mail, id); }

  @Post('newsletters/:id/send')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('OPZ_NL_SEND', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '뉴스레터 보내기 (v10.556 · SUPER)', description: 'opz.nl_enabled on · 확인 「보내기」 → 캠페인 보내기(campaign.enabled · 보낸 곳 연락처 · 방식 준비 · 마케팅 동의자 고정 · 예약) · 실제 발송은 캠페인 정기 작업.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPZ_NL_STATE · MKT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPZ_NL_OFF · OPZ_NL_LONG · MKT_OFF · MKT_CONFIRM · MKT_LEGAL · MKT_NOT_READY · MKT_SCHEDULE · MKT_NO_AUDIENCE' })
  send(@Param('id') id: string, @Body() dto: OpzNlSendDto) { return sendNl(this.db, this.mail, id, { confirm: dto.confirm, scheduledAt: dto.scheduledAt }); }

  @Post('newsletters/:id/cancel')
  @HttpCode(200)
  @Audit('OPZ_NL_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '뉴스레터 취소 (v10.556)', description: '초안은 운영 관리자도 · 보낸 호는 SUPER 만(캠페인을 함께 멈춤 · 다 보낸 호는 못 취소) · 사유 2 ~ 200자.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPZ_NL_STATE · OPZ_NL_DONE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPZ_NL_REASON' })
  cancel(@Param('id') id: string, @Body() dto: OpzNlCancelDto) { return cancelNl(this.db, id, dto.reason); }

  @Put('newsletter-settings')
  @Roles('SUPER')
  @Audit('OPZ_NL_SETTINGS', 'SETTING')
  @ApiOperation({ summary: '뉴스레터 설정 (v10.556 · SUPER)', description: 'opz.nl_enabled · 묶음마다 처음 고를 수 · 인기 매물 최근 날 수 · 사유(설정 바뀜 기록) · 보낸 칸만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPZ_REASON · OPZ_RANGE · OPZ_NOTHING' })
  settings(@Body() dto: OpzNlSettingsDto) { return setOpzNlSettings(this.db, { nlOn: dto.nlOn, nlItems: dto.nlItems, nlListingDays: dto.nlListingDays, reason: dto.reason }); }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/opz')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class OpzIncidentController {
  constructor(private readonly db: DatabaseService, private readonly tg: TelegramService) {}

  @Get('incidents')
  @ApiOperation({ summary: '장애 대응 한눈에 (v10.557)', description: '설정 · 오늘 당번(가린 메일 · 개인 텔레그램 있음) · 텔레그램 준비 · 런북 · 열린 장애 · 끝난 장애 30 · 열 거리(잇지 않은 장애 공지 · 24시간 안 UPTIME_DOWN · UPT_INCIDENT 알림).' })
  @ApiOkResponse({ type: Object })
  board() { return incidentBoard(this.db, this.tg); }

  @Get('incidents/:id')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '장애 한 건 (v10.557)', description: '단계(누가 · 언제 끝냄) · 진행 기록 300 · 되돌아보기 · 이은 장애 공지 · 걸린 분.' })
  @ApiOkResponse({ type: Object })
  detail(@Param('id') id: string) { return incidentDetail(this.db, id); }

  @Post('incidents')
  @HttpCode(200)
  @Audit('OPZ_IR_OPEN', 'SETTING')
  @ApiOperation({ summary: '장애 열기 (v10.557)', description: 'opz.ir_enabled on · 런북 단계 복사 · 운영 알림 OPZ_INCIDENT_OPEN(SEV1 ~ 3 모두 긴급 → 기존 대화방 · 당번 · 30분 SUPER 길) · 공지도 올리기(D272) · opz.ir_page_now on 이면 당번 개인 텔레그램 바로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPZ_ALREADY_OPEN' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPZ_IR_OFF · OPZ_RUNBOOK · OPZ_TITLE · OPZ_SEV · OPZ_ALERT · OPZ_NOTE' })
  open(@Body() dto: OpzIncidentOpenDto) {
    return openIncident(this.db, this.tg, {
      runbookId: dto.runbookId, title: dto.title, sev: dto.sev, sourceAlertId: dto.sourceAlertId, uptNotice: dto.uptNotice,
      publicTitle: dto.publicTitle, publicBody: dto.publicBody, note: dto.note,
    });
  }

  @Post('incidents/:id/page')
  @HttpCode(200)
  @Audit('OPZ_IR_PAGE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '당번 다시 호출 (v10.557)', description: 'opz.ir_page_now on 일 때만 · 5분에 한 번 · 오늘 당번 개인 텔레그램.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPZ_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPZ_PAGE_OFF · OPZ_PAGE_WAIT' })
  page(@Param('id') id: string) { return pageAgain(this.db, this.tg, id); }

  @Post('incidents/:id/steps/:stepId')
  @HttpCode(200)
  @Audit('OPZ_IR_STEP', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiParam({ name: 'stepId', example: '1' })
  @ApiOperation({ summary: '단계 체크 (v10.557)', description: '끝냄 · 되돌림(누가 · 언제) · 진행 기록 한 줄 · 끝난 장애는 못 바꿈.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPZ_STATE · OPZ_STEP_SAME' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  step(@Param('id') id: string, @Param('stepId') stepId: string, @Body() dto: OpzStepCheckDto) { return checkStep(this.db, id, stepId, dto.done); }

  @Post('incidents/:id/notes')
  @HttpCode(200)
  @Audit('OPZ_IR_NOTE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '진행 기록 더하기 (v10.557)', description: '쌓기만 · 끝난 장애는 되돌아보기에.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPZ_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPZ_NOTE' })
  note(@Param('id') id: string, @Body() dto: OpzNoteDto) { return addIncidentNote(this.db, id, dto.body); }

  @Post('incidents/:id/state')
  @HttpCode(200)
  @Audit('OPZ_IR_STATE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '누그러뜨림 · 끝 (v10.557)', description: '한 방향 · 그 운영 알림 풀림 · 끝이면 OPZ_INCIDENT_CLOSED(INFO) · 이은 장애 공지도 끝냄(선택 · D272 addNote RESOLVED).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPZ_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPZ_STATE_TO · OPZ_NOTE' })
  state(@Param('id') id: string, @Body() dto: OpzStateDto) {
    return setIncidentState(this.db, id, { state: dto.state, body: dto.body, resolveNotice: dto.resolveNotice, resolveBody: dto.resolveBody });
  }

  @Put('incidents/:id/upt')
  @Audit('OPZ_IR_UPT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '장애 공지 잇기 (v10.557)', description: '이미 있는 D272 장애 공지 번호 · 또는 새로 올리기(사용자 웹 맨 위 띠).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPZ_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPZ_UPT · UPT_TITLE · UPT_BODY' })
  upt(@Param('id') id: string, @Body() dto: OpzUptLinkDto) {
    return linkUpt(this.db, id, { uptIncidentId: dto.uptIncidentId, create: dto.create, publicTitle: dto.publicTitle, publicBody: dto.publicBody });
  }

  @Put('incidents/:id/review')
  @Audit('OPZ_IR_REVIEW', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '되돌아보기 쓰기 (v10.557)', description: '끝난 장애만 · 보낸 칸만 · 확정 전까지 고침.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPZ_REVIEW_STATE · OPZ_REVIEW_FINAL' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPZ_REVIEW' })
  review(@Param('id') id: string, @Body() dto: OpzReviewDto) {
    return saveReview(this.db, id, { summary: dto.summary, cause: dto.cause, impact: dto.impact, wentWell: dto.wentWell, improve: dto.improve, actions: dto.actions });
  }

  @Post('incidents/:id/review/finalize')
  @HttpCode(200)
  @Audit('OPZ_IR_REVIEW_FINAL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '되돌아보기 확정 (v10.557)', description: '확인 「확정」 · 확정하면 잠김(DB 트리거).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPZ_REVIEW_STATE · OPZ_REVIEW_FINAL' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPZ_REVIEW_CONFIRM' })
  finalize(@Param('id') id: string, @Body() dto: OpzReviewFinalDto) { return finalizeReview(this.db, id, dto.confirm); }

  @Get('runbooks/:id')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '런북 한 개 (v10.557)', description: '단계 · 종류 · 정도 · 영향 범위 · 판.' })
  @ApiOkResponse({ type: Object })
  runbook(@Param('id') id: string) { return runbookDetail(this.db, id); }

  @Post('runbooks')
  @HttpCode(200)
  @Audit('OPZ_RB_CREATE', 'SETTING')
  @ApiOperation({ summary: '런북 만들기 (v10.557)', description: '코드(영문 대문자) · 이름 · 종류 · 정도 · 영향 범위 · 단계 1 ~ 30.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPZ_CODE_TAKEN' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPZ_CODE · OPZ_TITLE · OPZ_KIND · OPZ_SEV · OPZ_PARTS · OPZ_STEPS' })
  createRb(@Body() dto: OpzRunbookCreateDto) {
    return createRunbook(this.db, { code: dto.code, title: dto.title, kind: dto.kind, sevDefault: dto.sevDefault, parts: dto.parts, summary: dto.summary, steps: dto.steps });
  }

  @Put('runbooks/:id')
  @Audit('OPZ_RB_SAVE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '런북 저장 (v10.557)', description: '보낸 칸만 · 단계는 보내면 통째로 바꿈 · 판 +1 · 이미 열린 장애는 복사한 단계 그대로 · 지우지 않고 끔.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPZ_NOTHING · OPZ_TITLE · OPZ_KIND · OPZ_SEV · OPZ_PARTS · OPZ_STEPS' })
  saveRb(@Param('id') id: string, @Body() dto: OpzRunbookSaveDto) {
    return saveRunbook(this.db, id, { title: dto.title, kind: dto.kind, sevDefault: dto.sevDefault, parts: dto.parts, summary: dto.summary, isActive: dto.isActive, steps: dto.steps });
  }

  @Put('incident-settings')
  @Roles('SUPER')
  @Audit('OPZ_IR_SETTINGS', 'SETTING')
  @ApiOperation({ summary: '장애 대응 설정 (v10.557 · SUPER)', description: 'opz.ir_enabled · opz.ir_page_now · 되돌아보기 기한 날 수 · 사유(설정 바뀜 기록) · 보낸 칸만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPZ_REASON · OPZ_RANGE · OPZ_NOTHING' })
  settings(@Body() dto: OpzIrSettingsDto) { return setOpzIrSettings(this.db, { irOn: dto.irOn, irPageNow: dto.irPageNow, irReviewDays: dto.irReviewDays, reason: dto.reason }); }
}
