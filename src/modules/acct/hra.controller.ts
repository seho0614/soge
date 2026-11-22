import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { ExportGate, type ExportTarget } from '../admin/export-approval';
import { hraSettings, setHraSettings } from './hra-common';
import { ackPromo, designate, issueRound1, leavePromoView, myLeavePromos, submitPlan } from './hra-leave-promo';
import { addLibPost, archiveLibPost, libFile, libPost, libReads, manageLibrary, markRead, myLibrary, updateLibPost } from './hra-library';
import { PAY_DATE_STYLES, PAY_FIELDS, bankFormats, exportPayfile, payfileView, saveBankFormat, setPayBank } from './hra-payfile';
import { addCloseItem, closeCheck, markClose, updateCloseItem } from './hra-close';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * 13차 인사 · 회계 (v10.581 ~ 584 · docs/723 ~ 726) — 대표 11/21 「16개 모두 동시에」
 *   v10.581 연차 사용 촉진(ADMIN · 본인)
 *     GET  /admin/hr/leave-promo?year=                  직원마다 남은 연차 · 1차 · 2차 · 기간
 *     POST /admin/hr/leave-promo/issue                  1차 알림 만들기(이미 있으면 건너뜀)
 *     POST /admin/hr/leave-promo/{id}/designate         2차 — 계획 안 낸 직원의 쓸 날 지정(본인 직원 아님)
 *     GET  /admin/me/hr/leave-promo · POST /admin/me/hr/leave-promo/{id}/plan · /ack   본인 — 알림 보기 · 계획 내기 · 확인
 *   v10.582 사내 자료실 · 공지(운영 역할 모두 읽기 · 쓰기는 ADMIN)
 *     GET  /admin/hra/library · /admin/hra/library/{id} · POST /admin/hra/library/{id}/read · GET /admin/hra/library/{id}/file
 *     GET  /admin/hra/library/manage · POST /admin/hra/library · PUT /admin/hra/library/{id} · POST /admin/hra/library/{id}/archive · GET /admin/hra/library/{id}/reads
 *   v10.583 급여 이체 파일(SUPER · 지급 담당 · 양식은 SUPER)
 *     GET  /admin/hra/payfile?ym= · PUT /admin/hra/pay-banks/{employeeId} · GET · POST /admin/hra/bank-formats · PUT /admin/hra/bank-formats/{id}
 *     GET  /admin/hra/payfile/export?ym=&formatId=&ticket=   내려받기 승인 HRA_PAY_FILE · hra.payfile_export on
 *   v10.584 회계 마감 체크리스트(SUPER · 지급 담당 · 세무사 읽기)
 *     GET  /admin/acct/close-check?ym= · POST /admin/acct/close-check/marks · POST /admin/acct/close-check/items · PUT /admin/acct/close-check/items/{key}(SUPER)
 *   설정  GET /admin/hra/settings · PUT /admin/hra/settings(SUPER)
 *   근태 · 휴가 · 연차 촉진 · 급여 계좌는 /admin/acct 밖이라 세무사(ACCOUNTANT · /admin/acct GET 만)는 못 봄 · 마감 체크리스트만 /admin/acct 아래(세무사 읽기)
 * ------------------------------------------------------------------- */

const SELF = ['REVIEWER', 'ADMIN', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF'] as const;   // SUPER 는 늘 통과 · 세무사 빠짐(내 인사와 같음)
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** 내려받기 승인 대상 — 서버 EXPORT_TARGETS 에는 export-approval.ts 끝에서 붙임(옛 시험이 배열 끝 글자를 봄) */
export const HRA_PAY_FILE_TARGET = 'HRA_PAY_FILE' as string as ExportTarget;

/* ── DTO(쓰는 것보다 먼저 · 이름은 src 전체에서 고유 · 규칙 4) ── */
export class HraPromoIssueDto {
  @ApiProperty({ example: 2026 }) @IsInt() @Min(2000) @Max(2100) year!: number;
}
export class HraPromoDatesDto {
  @ApiProperty({ type: [String], example: ['2026-11-27', '2026-12-04'] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @Matches(YMD_RE, { each: true }) dates!: string[];
  @ApiPropertyOptional({ example: '연말 업무 일정 고려' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class HraLibPostDto {
  @ApiProperty({ enum: ['NOTICE', 'FILE'] }) @IsIn(['NOTICE', 'FILE']) kind!: string;
  @ApiProperty({ example: '12월 연말 근무 안내' }) @IsString() @Length(2, 120) title!: string;
  @ApiPropertyOptional({ example: '12/31 은 오전 근무입니다.' }) @IsOptional() @IsString() @Length(0, 20000) body?: string;
  @ApiPropertyOptional({ type: [String], example: ['R_ADMIN'], description: '권한그룹 키 · 비우면 운영 계정 모두(세무사 빠짐)' }) @IsOptional() @IsArray() @ArrayMaxSize(20) @Matches(/^[A-Z][A-Z0-9_]{1,40}$/, { each: true }) audience?: string[];
  @ApiPropertyOptional({ example: true }) @IsOptional() @StrictBoolean() mustRead?: boolean;
  @ApiPropertyOptional({ example: '2026-12-05', description: '꼭 읽기 글만' }) @IsOptional() @Matches(YMD_RE) readDue?: string;
  @ApiPropertyOptional({ example: false }) @IsOptional() @StrictBoolean() pinned?: boolean;
  @ApiPropertyOptional({ example: '00000000-0000-0000-0000-000000000000', description: 'POST /files(purpose CORP_DOC) 로 올린 파일' }) @IsOptional() @Matches(/^[0-9a-fA-F-]{36}$/) fileId?: string;
  @ApiPropertyOptional({ example: '1', description: '사내 문서함 문서(가장 최근 판을 보여 줌)' }) @IsOptional() @Matches(/^\d{1,18}$/) corpDocId?: string;
}
export class HraLibEditDto {
  @ApiPropertyOptional({ example: '12월 연말 근무 안내(고침)' }) @IsOptional() @IsString() @Length(2, 120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 20000) body?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @Matches(/^[A-Z][A-Z0-9_]{1,40}$/, { each: true }) audience?: string[];
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() mustRead?: boolean;
  @ApiPropertyOptional({ example: '2026-12-05' }) @IsOptional() @Matches(YMD_RE) readDue?: string;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() pinned?: boolean;
}
export class HraReasonDto {
  @ApiProperty({ example: '내용이 바뀌어 새 글로 올림' }) @IsString() @Length(2, 200) reason!: string;
}
export class HraPayBankDto {
  @ApiProperty({ example: '004', description: '은행 코드 숫자 3자리(DB CHECK 와 같음)' }) @Matches(/^[0-9]{3}$/) bank!: string;
  @ApiProperty({ example: '123-456-789012', description: '숫자 6 ~ 20자리(하이픈 허용) — 저장은 암호문 · 화면은 끝 4자리' }) @Matches(/^[0-9-]{6,24}$/) acct!: string;
  @ApiProperty({ example: '홍길동' }) @IsString() @Length(1, 40) holder!: string;
  @ApiProperty({ example: '본인 요청(서면) — 급여 통장 바꿈' }) @IsString() @Length(2, 200) reason!: string;
}
export class HraBankColDto {
  @ApiProperty({ enum: Object.keys(PAY_FIELDS) }) @IsIn(Object.keys(PAY_FIELDS)) field!: string;
  @ApiPropertyOptional({ example: '계좌번호' }) @IsOptional() @IsString() @Length(0, 30) title?: string;
}
export class HraBankFormatDto {
  @ApiProperty({ example: '○○은행 대량 이체' }) @IsString() @Length(1, 40) name!: string;
  @ApiProperty({ type: [HraBankColDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => HraBankColDto) columns!: HraBankColDto[];
  @ApiPropertyOptional({ example: true }) @IsOptional() @StrictBoolean() header?: boolean;
  @ApiPropertyOptional({ enum: PAY_DATE_STYLES }) @IsOptional() @IsIn(PAY_DATE_STYLES as unknown as string[]) dateStyle?: string;
  @ApiPropertyOptional({ example: false }) @IsOptional() @StrictBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class HraSettingsDto {
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() leavePromo?: boolean;
  @ApiPropertyOptional({ example: 6 }) @IsOptional() @IsInt() @Min(1) @Max(11) firstMonths?: number;
  @ApiPropertyOptional({ example: 2 }) @IsOptional() @IsInt() @Min(1) @Max(10) secondMonths?: number;
  @ApiPropertyOptional({ example: 10 }) @IsOptional() @IsInt() @Min(1) @Max(30) replyDays?: number;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() libUnreadAlert?: boolean;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() payfileExport?: boolean;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() closeAlert?: boolean;
  @ApiPropertyOptional({ example: 3 }) @IsOptional() @IsInt() @Min(0) @Max(10) closeAlertDaysBefore?: number;
  @ApiProperty({ example: '노무사 확인 뒤 켬' }) @IsString() @Length(2, 200) reason!: string;
}
export class HraCloseMarkDto {
  @ApiProperty({ example: '2026-11' }) @Matches(YM_RE) ym!: string;
  @ApiProperty({ example: 'cash_count' }) @Matches(/^[a-z][a-z0-9_]{1,30}$/) key!: string;
  @ApiPropertyOptional({ example: true, description: 'false 면 확인 풂' }) @IsOptional() @StrictBoolean() done?: boolean;
  @ApiPropertyOptional({ example: '그 달 상각 대상 없음(자산 처분)', description: '저절로 셈 항목의 예외 확인은 2자 이상 꼭' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class HraCloseItemDto {
  @ApiProperty({ example: 'card_return' }) @Matches(/^[a-z][a-z0-9_]{1,30}$/) key!: string;
  @ApiProperty({ example: '법인카드 반납 확인' }) @IsString() @Length(2, 60) label!: string;
  @ApiPropertyOptional({ example: '회계 › 경비 청구' }) @IsOptional() @IsString() @Length(0, 60) where?: string;
  @ApiPropertyOptional({ example: 200 }) @IsOptional() @IsInt() @Min(0) @Max(9999) sort?: number;
}
export class HraCloseItemEditDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 60) label?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 60) where?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(9999) sort?: number;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() active?: boolean;
}

/** 보낸 칸만(undefined 를 거름 · 규칙 11) */
const only = <T extends object>(d: T): Partial<T> => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) as Partial<T>;

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class HraController {
  constructor(private readonly db: DatabaseService) {}

  /* ── v10.581 연차 사용 촉진 ── */
  @Get('hr/leave-promo')
  @Roles('ADMIN')
  @ApiQuery({ name: 'year', required: false, example: 2026 })
  @ApiOperation({ summary: '연차 사용 촉진 (v10.581)', description: '직원마다 남은 연차 · 1차(알림 · 계획) · 2차(지정) · 1차 기간 · 2차 기한 · 설정. 계획 기한이 지난 1차는 NO_PLAN 으로 바뀜.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRA_LEAVE_PROMO_YEAR' })
  promo(@Query('year') year?: string) { return leavePromoView(this.db, year); }

  @Post('hr/leave-promo/issue')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HRA_LEAVE_PROMO_ISSUE', 'SETTING', { pick: ['ok', 'year', 'made', 'outOfWindow'] })
  @ApiOperation({ summary: '연차 촉진 1차 알림 만들기 (v10.581)', description: '1년 이상 · 남은 연차가 있는 직원 · 이미 있으면 건너뜀 · 1차 기간 밖이면 outOfWindow(법이 정한 촉진으로 인정 안 될 수 있음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '(없음 — 이미 있으면 건너뜀)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRA_LEAVE_PROMO_YEAR · HRA_LEAVE_PROMO_LATE' })
  issue(@Body() dto: HraPromoIssueDto) { return issueRound1(this.db, dto.year, RequestCtx.actorId() ?? null); }

  @Post('hr/leave-promo/:id/designate')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HRA_LEAVE_PROMO_DESIGNATE', 'SETTING', { pick: ['ok', 'id', 'employeeId', 'outOfWindow'] })
  @ApiParam({ name: 'id', example: '1', description: '1차 기록 번호' })
  @ApiOperation({ summary: '연차 촉진 2차 — 쓸 날 지정 (v10.581)', description: '계획을 안 낸(NO_PLAN) 직원 · 영업일 · 그 해 안 · 오늘 뒤 · 남은 연차까지 · 본인 직원 아님.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRA_LEAVE_PROMO_STATE · HRA_LEAVE_PROMO_DONE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRA_LEAVE_PROMO_DATES · HRA_LEAVE_PROMO_NONE' })
  designateDates(@Param('id') id: string, @Body() dto: HraPromoDatesDto) { return designate(this.db, id, dto.dates, dto.note, RequestCtx.actorId() ?? null); }

  @Get('me/hr/leave-promo')
  @Roles(...SELF)
  @ApiOperation({ summary: '내 연차 사용 촉진 (v10.581)', description: '올해 · 지난해 내 촉진 알림 · 남은 연차. 연결 안 됐으면 linked=false.' })
  @ApiOkResponse({ type: Object })
  myPromo() { return myLeavePromos(this.db, RequestCtx.actorId() ?? null); }

  @Post('me/hr/leave-promo/:id/plan')
  @Roles(...SELF)
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '연차 쓸 날 계획 내기 (v10.581)', description: '1차 알림 · 기한 안 · 한 번 · 영업일 · 남은 연차까지. 실제 휴가는 휴가 신청으로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRA_LEAVE_PROMO_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HR_NOT_LINKED · HRA_LEAVE_PROMO_DATES' })
  plan(@Param('id') id: string, @Body() dto: HraPromoDatesDto) { return submitPlan(this.db, RequestCtx.actorId() ?? null, id, dto.dates); }

  @Post('me/hr/leave-promo/:id/ack')
  @Roles(...SELF)
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '연차 촉진 알림 받음 확인 (v10.581)', description: '한 번 · 다시 누르면 already.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '(없음 — 이미 확인이면 already)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HR_NOT_LINKED' })
  ack(@Param('id') id: string) { return ackPromo(this.db, RequestCtx.actorId() ?? null, id); }

  /* ── v10.582 사내 자료실 · 공지 ── */
  @Get('hra/library')
  @Roles(...SELF)
  @ApiQuery({ name: 'kind', required: false, enum: ['NOTICE', 'FILE'] })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'unread', required: false, example: '1' })
  @ApiOperation({ summary: '사내 자료실 · 공지 (v10.582)', description: '나에게 공개된 보관 중 글 · 내 읽음 · 꼭 읽을 것 남은 수.' })
  @ApiOkResponse({ type: Object })
  library(@Query('kind') kind?: string, @Query('q') q?: string, @Query('unread') unread?: string) { return myLibrary(this.db, RequestCtx.actorId() ?? null, { kind, q, unread }); }

  @Get('hra/library/manage')
  @Roles('ADMIN')
  @ApiQuery({ name: 'state', required: false, enum: ['ACTIVE', 'ARCHIVED'] })
  @ApiOperation({ summary: '사내 자료실 관리 (v10.582)', description: '모든 글 · 대상 수 · 읽은 수 · 권한그룹 · 사내 문서함 문서 목록.' })
  @ApiOkResponse({ type: Object })
  manage(@Query('state') state?: string) { return manageLibrary(this.db, state); }

  @Get('hra/library/:id')
  @Roles(...SELF)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사내 자료실 글 (v10.582)', description: '공개 범위 밖이면 없는 글과 같이 404.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  libOne(@Param('id') id: string) { return libPost(this.db, RequestCtx.actorId() ?? null, id); }

  @Post('hra/library/:id/read')
  @Roles(...SELF)
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '읽었습니다 (v10.582)', description: '한 번 · 다시 누르면 already · 쌓기만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRA_LIB_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '(없음)' })
  read(@Param('id') id: string) { return markRead(this.db, RequestCtx.actorId() ?? null, id); }

  @Get('hra/library/:id/file')
  @Roles(...SELF)
  @Audit('HRA_LIB_FILE_OPEN', 'FILE', { pick: ['postId', 'fileId', 'name'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사내 자료 파일 열기 (v10.582)', description: '공개 범위 안이면 5분짜리 주소(파일 또는 사내 문서함 문서의 가장 최근 판).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  file(@Param('id') id: string) { return libFile(this.db, RequestCtx.actorId() ?? null, id); }

  @Post('hra/library')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HRA_LIB_POST', 'SETTING', { pick: ['ok', 'id'] })
  @ApiOperation({ summary: '사내 공지 · 자료 올리기 (v10.582)', description: '공지는 본문 · 자료는 파일(CORP_DOC) 또는 사내 문서함 문서 · 공개 범위(권한그룹) · 꼭 읽기 · 기한.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '(없음)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRA_LIB_TITLE · HRA_LIB_BODY · HRA_LIB_AUDIENCE · HRA_LIB_DUE · HRA_LIB_FILE' })
  addLib(@Body() dto: HraLibPostDto) { return addLibPost(this.db, dto, RequestCtx.actorId() ?? null); }

  @Put('hra/library/:id')
  @Roles('ADMIN')
  @Audit('HRA_LIB_EDIT', 'SETTING', { pick: ['ok', 'id'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사내 공지 · 자료 고치기 (v10.582)', description: '보관 중 글만 · 보낸 칸만 · 고치기 전 내용은 기록.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRA_LIB_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRA_LIB_TITLE · HRA_LIB_BODY · HRA_LIB_AUDIENCE · HRA_LIB_DUE' })
  editLib(@Param('id') id: string, @Body() dto: HraLibEditDto) { return updateLibPost(this.db, id, only(dto), RequestCtx.actorId() ?? null); }

  @Post('hra/library/:id/archive')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HRA_LIB_ARCHIVE', 'SETTING', { pick: ['ok', 'id'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사내 공지 · 자료 보관 끝 (v10.582)', description: '사유 · 되돌리지 않음 · 글 · 읽음 기록 · 파일은 남음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRA_LIB_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRA_REASON' })
  archiveLib(@Param('id') id: string, @Body() dto: HraReasonDto) { return archiveLibPost(this.db, id, dto.reason); }

  @Get('hra/library/:id/reads')
  @Roles('ADMIN')
  @Audit('HRA_LIB_READS_VIEW', 'SETTING', { idOnly: true })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사내 공지 읽음 현황 (v10.582)', description: '공개 범위 안 운영 계정마다 읽은 시각 · 안 읽음(이름 · 가린 메일).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  reads(@Param('id') id: string) { return libReads(this.db, id); }

  /* ── v10.583 급여 이체 파일 ── */
  @Get('hra/payfile')
  @Roles('SUPER', 'PAYOUT')
  @ApiQuery({ name: 'ym', required: true, example: '2026-11' })
  @ApiOperation({ summary: '급여 이체 파일 (v10.583)', description: '그 달 급여 줄 · 실지급 · 계좌(끝 4자리) · 빠진 계좌 · 직원 계좌 목록 · 바뀐 기록 · 양식 · 내려받은 기록.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_PERIOD' })
  payfile(@Query('ym') ym: string) { return payfileView(this.db, ym); }

  @Put('hra/pay-banks/:id')
  @Roles('SUPER', 'PAYOUT')
  @Audit('HRA_PAY_BANK_SET', 'SETTING', { pick: ['ok', 'employeeId', 'account', 'created'] })
  @ApiParam({ name: 'id', example: '1', description: '직원 번호' })
  @ApiOperation({ summary: '직원 급여 계좌 넣기 · 바꾸기 (v10.583)', description: '은행 코드 · 계좌(암호문 저장 · 끝 4자리만 돌려줌) · 예금주 · 사유 · 바뀐 기록 · 운영 알림 HRA_PAY_BANK_CHANGED.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '(없음)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRA_PAY_BANK · HRA_PAY_ACCT · HRA_PAY_HOLDER · HRA_REASON' })
  payBank(@Param('id') id: string, @Body() dto: HraPayBankDto) { return setPayBank(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Get('hra/bank-formats')
  @Roles('SUPER', 'PAYOUT')
  @ApiOperation({ summary: '급여 이체 파일 양식 (v10.583)', description: '양식 목록 · 칸 종류 · 날짜 모양.' })
  @ApiOkResponse({ type: Object })
  async formats() { return { formats: await bankFormats(this.db), fields: PAY_FIELDS, dateStyles: PAY_DATE_STYLES }; }

  @Post('hra/bank-formats')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('HRA_BANK_FORMAT_SAVE', 'SETTING', { pick: ['ok', 'id'] })
  @ApiOperation({ summary: '급여 이체 파일 양식 만들기 (v10.583 · SUPER)', description: '칸 1 ~ 20 · 은행 코드 · 계좌 · 금액 꼭 · 기본으로 두면 다른 양식의 기본은 풂.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRA_BANK_FORMAT_NAME' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRA_BANK_FORMAT' })
  addFormat(@Body() dto: HraBankFormatDto) { return saveBankFormat(this.db, null, dto, RequestCtx.actorId() ?? null); }

  @Put('hra/bank-formats/:id')
  @Roles('SUPER')
  @Audit('HRA_BANK_FORMAT_SAVE', 'SETTING', { pick: ['ok', 'id'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '급여 이체 파일 양식 고치기 (v10.583 · SUPER)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRA_BANK_FORMAT_NAME' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRA_BANK_FORMAT' })
  editFormat(@Param('id') id: string, @Body() dto: HraBankFormatDto) { return saveBankFormat(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Get('hra/payfile/export')
  @Roles('SUPER', 'PAYOUT')
  @ExportGate(HRA_PAY_FILE_TARGET)
  @Audit('HRA_PAYFILE_EXPORT', 'SETTING', { pick: ['ok', 'ym', 'formatName', 'lines', 'total', 'sha256'] })
  @ApiQuery({ name: 'ym', required: true, example: '2026-11' })
  @ApiQuery({ name: 'formatId', required: false, example: '1' })
  @ApiOperation({ summary: '급여 이체 파일 내려받기 (v10.583)', description: 'hra.payfile_export on · 내려받기 승인(HRA_PAY_FILE) 뒤 한 번 · 확정 · 지급 급여 · 계좌 원문이 든 CSV(UTF-8 BOM) · 기록(SHA-256). 감사에는 고른 칸만(파일 · 계좌 없음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRA_PAYFILE_STATE · EXPORT_TICKET_USED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRA_PAYFILE_OFF · HRA_PAY_BANK_MISSING · HRA_PAYFILE_EMPTY · EXPORT_NEED_APPROVAL' })
  exportFile(@Query('ym') ym: string, @Query('formatId') formatId?: string, @Query('ticket') ticket?: string) { return exportPayfile(this.db, ym, formatId, ticket, RequestCtx.actorId() ?? null); }

  /* ── 설정 ── */
  @Get('hra/settings')
  @Roles('ADMIN', 'PAYOUT')
  @ApiOperation({ summary: '인사 · 회계 13차 설정 (v10.581 ~ 584)', description: '연차 촉진 · 꼭 읽기 알림 · 이체 파일 · 마감 알림 스위치와 값.' })
  @ApiOkResponse({ type: Object })
  settings() { return hraSettings(this.db); }

  @Put('hra/settings')
  @Roles('SUPER')
  @Audit('HRA_SETTINGS', 'SETTING', { pick: ['ok', 'changed'] })
  @ApiOperation({ summary: '인사 · 회계 13차 설정 바꾸기 (v10.581 ~ 584 · SUPER)', description: '보낸 칸만 · 사유(설정 바뀐 기록) · 연차 촉진 2차 개월 < 1차 개월.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '(없음)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRA_REASON · HRA_SETTING_VALUE · HRA_NOTHING' })
  setSettings(@Body() dto: HraSettingsDto) { return setHraSettings(this.db, only(dto)); }

  /* ── v10.584 회계 마감 체크리스트(/admin/acct 아래 — 세무사 읽기) ── */
  @Get('acct/close-check')
  @Roles('SUPER', 'PAYOUT')
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '회계 마감 체크리스트 (v10.584)', description: '항목마다 끝 · 남음 · 예외 확인 · 셈 실패 · 근거 · 마지막 확인 · 남은 수. 달을 비우면 지난달.' })
  @ApiOkResponse({ type: Object })
  closeList(@Query('ym') ym?: string) { return closeCheck(this.db, ym); }

  @Post('acct/close-check/marks')
  @Roles('SUPER', 'PAYOUT')
  @HttpCode(200)
  @Audit('HRA_CLOSE_MARK', 'SETTING', { pick: ['ok', 'ym', 'key', 'done'] })
  @ApiOperation({ summary: '회계 마감 확인 · 풀기 (v10.584)', description: '마감 전 달만 · 저절로 셈 항목의 예외 확인은 사유 2자 이상 · 쌓기만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRA_CLOSE_CLOSED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_PERIOD · HRA_CLOSE_REASON' })
  mark(@Body() dto: HraCloseMarkDto) { return markClose(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('acct/close-check/items')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('HRA_CLOSE_ITEM', 'SETTING', { pick: ['ok', 'key'] })
  @ApiOperation({ summary: '마감 체크리스트 항목 더하기 (v10.584 · SUPER)', description: '사람 확인(MANUAL) 항목만 · 열쇠 고유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRA_CLOSE_ITEM_EXISTS' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRA_CLOSE_ITEM' })
  addItem(@Body() dto: HraCloseItemDto) { return addCloseItem(this.db, dto, RequestCtx.actorId() ?? null); }

  @Put('acct/close-check/items/:key')
  @Roles('SUPER')
  @Audit('HRA_CLOSE_ITEM', 'SETTING', { pick: ['ok', 'key', 'active'] })
  @ApiParam({ name: 'key', example: 'cash_count' })
  @ApiOperation({ summary: '마감 체크리스트 항목 고치기 · 끄기 (v10.584 · SUPER)', description: '이름 · 어디 · 순서 · 켜고 끄기 · 보낸 칸만 · 지우지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '(없음)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRA_CLOSE_ITEM' })
  editItem(@Param('key') key: string, @Body() dto: HraCloseItemEditDto) { return updateCloseItem(this.db, key, only(dto), RequestCtx.actorId() ?? null); }
}
