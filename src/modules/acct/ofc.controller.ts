import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { OFC_EVENT_SCOPES, OFC_TIME_RE, calendarView, createEvent, removeEvent, updateEvent } from './ofc-calendar';
import type { Viewer } from './ofc-calendar';
import { TASK_PRIORITIES, assignTask, cancelTask, commentTask, createTask, moveTask, taskBoard, taskDetail } from './ofc-tasks';
import { TRIP_REGIONS, cancelTrip, createTrip, listTrips, setTripStandards, settleTrip, tripDetail } from './ofc-trips';
import { NOTIFY_KINDS, myNotify, notifyFeed, setMyNotify } from './ofc-notify';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * ㉜ 사무 2 (D263 · docs/600 ~ 603) — 대표 11/20
 *   v10.462  GET  /admin/office/calendar?from=&to=            모은 일정(휴가 · 품의 쓸 날 · 신고 기한 · 계약 만기 · 급여일 · 출장 · 업무 기한 · 직접 일정)
 *            POST /admin/office/events · PUT /admin/office/events/{id} · POST /admin/office/events/{id}/remove   직접 일정(개인 · 회사 = ADMIN · SUPER)
 *   v10.463  GET  /admin/office/tasks?view=&q= · GET /admin/office/tasks/{id}
 *            POST /admin/office/tasks · /{id}/move · /{id}/assign · /{id}/cancel · /{id}/comments
 *   v10.464  GET  /admin/office/trips?view= · GET /admin/office/trips/{id}
 *            POST /admin/office/trips(+ 품의) · /{id}/cancel · /{id}/settle(→ 경비 청구) · PUT /admin/office/trip-standards(SUPER)
 *   v10.465  GET  /admin/me/notify · PUT /admin/me/notify · GET /admin/me/notify/feed?since=   브라우저 알림(본인만)
 *   운영 역할 누구나(SUPER 는 늘 통과) · 세무사(ACCOUNTANT) 빠짐 — /admin/acct/ 아래가 아니라 세무사 읽기 규칙(AuthGuard accountantRead)에 들지 않음.
 *   보기 범위는 서비스가 정함(남의 개인 일정 · 업무 · 출장은 「없음」).
 * ------------------------------------------------------------------- */

const SELF = ['ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'] as const;   // SUPER 는 늘 통과 · 세무사 빠짐
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export class OfcEventNewDto {
  @ApiPropertyOptional({ enum: OFC_EVENT_SCOPES, description: 'PERSONAL 개인(본인만 봄 · 처음) · COMPANY 회사(모두 봄 · ADMIN · SUPER)' }) @IsOptional() @IsIn(OFC_EVENT_SCOPES as unknown as string[]) scope?: string;
  @ApiProperty({ example: '분기 워크숍' }) @IsString() @Length(1, 80) title!: string;
  @ApiProperty({ example: '2026-12-04' }) @Matches(YMD_RE) startOn!: string;
  @ApiPropertyOptional({ example: '2026-12-05', description: '비우면 하루' }) @IsOptional() @Matches(YMD_RE) endOn?: string;
  @ApiPropertyOptional({ example: '14:00', description: 'HH:MM — 비우면 종일' }) @IsOptional() @IsString() @Matches(OFC_TIME_RE) time?: string | null;
  @ApiPropertyOptional({ example: '3층 회의실' }) @IsOptional() @IsString() @Length(0, 400) memo?: string | null;
}
export class OfcEventEditDto {
  @ApiPropertyOptional({ example: '분기 워크숍(장소 바뀜)' }) @IsOptional() @IsString() @Length(1, 80) title?: string;
  @ApiPropertyOptional({ example: '2026-12-04' }) @IsOptional() @Matches(YMD_RE) startOn?: string;
  @ApiPropertyOptional({ example: '2026-12-05' }) @IsOptional() @Matches(YMD_RE) endOn?: string;
  @ApiPropertyOptional({ example: '15:00', description: 'null 이면 종일로' }) @IsOptional() @IsString() @Matches(OFC_TIME_RE) time?: string | null;
  @ApiPropertyOptional({ example: '2층 회의실' }) @IsOptional() @IsString() @Length(0, 400) memo?: string | null;
}
export class OfcTaskNewDto {
  @ApiProperty({ example: '12월 공지 문안 검토' }) @IsString() @Length(2, 100) title!: string;
  @ApiPropertyOptional({ example: '첨부 문안 · 법무 의견 반영' }) @IsOptional() @IsString() @Length(0, 2000) body?: string | null;
  @ApiPropertyOptional({ format: 'uuid', description: '담당자(운영 계정) — 비우면 나(할 일)' }) @IsOptional() @IsString() @Matches(/^([0-9a-fA-F-]{36})?$/) assigneeId?: string;
  @ApiPropertyOptional({ example: '2026-11-27' }) @IsOptional() @Matches(YMD_RE) dueOn?: string | null;
  @ApiPropertyOptional({ enum: TASK_PRIORITIES }) @IsOptional() @IsIn(TASK_PRIORITIES as unknown as string[]) priority?: string;
}
export class OfcTaskMoveDto {
  @ApiProperty({ enum: ['REQUESTED', 'DOING', 'DONE'], description: 'DOING 진행 · DONE 완료 · REQUESTED 요청으로 되돌림(담당자) · 완료 → DOING 다시 열기(요청한 사람)' }) @IsIn(['REQUESTED', 'DOING', 'DONE']) to!: string;
  @ApiPropertyOptional({ example: '내일 오전까지 마침' }) @IsOptional() @IsString() @Length(0, 300) note?: string;
}
export class OfcTaskAssignDto {
  @ApiProperty({ format: 'uuid' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) assigneeId!: string;
  @ApiPropertyOptional({ example: '휴가라 대신 부탁' }) @IsOptional() @IsString() @Length(0, 300) note?: string;
}
export class OfcTaskCancelDto {
  @ApiProperty({ example: '다른 업무로 합침' }) @IsString() @Length(2, 200) reason!: string;
}
export class OfcTaskCommentDto {
  @ApiProperty({ example: '초안 올렸습니다.' }) @IsString() @Length(1, 1000) body!: string;
}
export class OfcTripNewDto {
  @ApiProperty({ example: '부산 해운대 거래처' }) @IsString() @Length(2, 60) destination!: string;
  @ApiProperty({ enum: TRIP_REGIONS, description: 'SEOUL 서울 · METRO 광역시 · OTHER 그 밖(숙박 상한이 다름)' }) @IsIn(TRIP_REGIONS as unknown as string[]) region!: string;
  @ApiProperty({ example: '거래처 계약 갱신 협의' }) @IsString() @Length(2, 300) purpose!: string;
  @ApiProperty({ example: '2026-12-02' }) @Matches(YMD_RE) departOn!: string;
  @ApiPropertyOptional({ example: '2026-12-03', description: '비우면 당일' }) @IsOptional() @Matches(YMD_RE) returnOn?: string;
  @ApiPropertyOptional({ example: 120000, description: '교통비 예상(원)' }) @IsOptional() @IsInt() @Min(0) @Max(10_000_000) transportEst?: number;
}
export class OfcTripCancelDto {
  @ApiProperty({ example: '일정 미뤄짐' }) @IsString() @Length(2, 200) reason!: string;
}
export class OfcTripSettleDto {
  @ApiPropertyOptional({ example: 118000, description: '실제 교통비(원)' }) @IsOptional() @IsInt() @Min(0) @Max(10_000_000) transport?: number;
  @ApiPropertyOptional({ example: 85000, description: '실제 숙박비 합(원) — 상한 × 박수까지만 넣음' }) @IsOptional() @IsInt() @Min(0) @Max(10_000_000) lodging?: number;
  @ApiPropertyOptional({ example: 1, description: '실제 박수(비우면 날수 − 1)' }) @IsOptional() @IsInt() @Min(0) @Max(30) nights?: number;
  @ApiPropertyOptional({ example: 'KTX 왕복' }) @IsOptional() @IsString() @Length(0, 300) memo?: string | null;
  @ApiPropertyOptional({ type: [String], description: 'POST /files(ACCT_EVIDENCE)로 올린 증빙 3개까지' }) @IsOptional() @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) attachments?: string[];
}
export class OfcTripStandardsDto {
  @ApiPropertyOptional({ example: 25000, description: '일비(원 · 하루)' }) @IsOptional() @IsInt() @Min(0) @Max(9_999_999) perDiem?: number;
  @ApiPropertyOptional({ example: 25000, description: '식비(원 · 하루)' }) @IsOptional() @IsInt() @Min(0) @Max(9_999_999) meal?: number;
  @ApiPropertyOptional({ example: 100000, description: '서울 숙박 상한(원 · 1박)' }) @IsOptional() @IsInt() @Min(0) @Max(9_999_999) seoul?: number;
  @ApiPropertyOptional({ example: 80000, description: '광역시 숙박 상한' }) @IsOptional() @IsInt() @Min(0) @Max(9_999_999) metro?: number;
  @ApiPropertyOptional({ example: 70000, description: '그 밖 숙박 상한' }) @IsOptional() @IsInt() @Min(0) @Max(9_999_999) other?: number;
  @ApiProperty({ example: '2027 여비 규정' }) @IsString() @Length(2, 200) reason!: string;
}
export class OfcNotifyPrefsDto {
  @ApiPropertyOptional({ description: '켬 · 끔' }) @IsOptional() @StrictBoolean() enabled?: boolean;
  @ApiPropertyOptional({ type: [String], enum: NOTIFY_KINDS, description: 'OPS · APV · TASK' }) @IsOptional() @IsArray() @ArrayMaxSize(3) @IsIn(NOTIFY_KINDS as unknown as string[], { each: true }) kinds?: string[];
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class OfcController {
  constructor(private readonly db: DatabaseService) {}

  /** 지금 운영자 — 번호 · 역할(보기 범위는 서비스가 정함) */
  private async me(): Promise<Viewer> {
    const id = RequestCtx.actorId() ?? '';
    const roles = id ? (await this.db.query<{ role: string }>(`SELECT role FROM account_roles WHERE account_id = $1::uuid`, [id])).map((r) => r.role) : [];
    return { id, roles };
  }

  /* ── v10.462 사내 일정 캘린더 ── */
  @Get('office/calendar')
  @Roles(...SELF)
  @ApiQuery({ name: 'from', required: false, example: '2026-11-01' }) @ApiQuery({ name: 'to', required: false, example: '2026-11-30' })
  @ApiOperation({ summary: '사내 일정 (v10.462)', description: '달 · 주 보기(62일까지) — 휴가 · 품의 쓸 날 · 신고 기한 · 계약 만기 · 급여일 · 출장 · 업무 기한은 지금 표에서 읽고, 직접 일정(개인 · 회사)을 더함.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OFC_RANGE' })
  async calendar(@Query('from') from?: string, @Query('to') to?: string) { return calendarView(this.db, await this.me(), from, to); }

  @Post('office/events')
  @Roles(...SELF)
  @HttpCode(200)
  @Audit('OFC_EVENT_ADD', 'SETTING')
  @ApiOperation({ summary: '직접 일정 넣기 (v10.462)', description: '개인(본인만 봄) · 회사(모두 봄 · ADMIN · SUPER).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OFC_EVENT_TITLE · OFC_EVENT_DATE · OFC_EVENT_TIME · OFC_EVENT_MEMO' })
  async addEvent(@Body() dto: OfcEventNewDto) { return createEvent(this.db, dto, await this.me()); }

  @Put('office/events/:id')
  @Roles(...SELF)
  @Audit('OFC_EVENT_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '직접 일정 고치기 (v10.462)', description: '보낸 칸만 바꿈 · 개인은 본인 · 회사는 ADMIN · SUPER · 지운 일정 409.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OFC_EVENT_REMOVED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OFC_EVENT_TITLE · OFC_EVENT_DATE · OFC_EVENT_TIME · OFC_EVENT_MEMO' })
  async editEvent(@Param('id') id: string, @Body() dto: OfcEventEditDto) { return updateEvent(this.db, id, dto, await this.me()); }

  @Post('office/events/:id/remove')
  @Roles(...SELF)
  @HttpCode(200)
  @Audit('OFC_EVENT_REMOVE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '직접 일정 지우기 (v10.462)', description: '지움 표시만(지우는 문장은 DB 가 막음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OFC_EVENT_REMOVED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  async delEvent(@Param('id') id: string) { return removeEvent(this.db, id, await this.me()); }

  /* ── v10.463 업무 요청 · 할 일 보드 ── */
  @Get('office/tasks')
  @Roles(...SELF)
  @ApiQuery({ name: 'view', required: false, enum: ['mine', 'requested', 'both', 'all'] }) @ApiQuery({ name: 'q', required: false })
  @ApiOperation({ summary: '업무 요청 보드 (v10.463)', description: '칸반 요청 · 진행 · 완료 · 취소 — mine 맡은 것 · requested 요청한 것 · both 둘 다 · all 모두(SUPER).' })
  @ApiOkResponse({ type: Object })
  async tasks(@Query('view') view?: string, @Query('q') q?: string) { return taskBoard(this.db, await this.me(), view, q); }

  @Get('office/tasks/:id')
  @Roles(...SELF)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '업무 요청 자세히 (v10.463)', description: '내용 · 댓글 · 상태 바뀜 기록 · 내가 할 수 있는 것.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  async task(@Param('id') id: string) { return taskDetail(this.db, id, await this.me()); }

  @Post('office/tasks')
  @Roles(...SELF)
  @HttpCode(200)
  @Audit('OFC_TASK_ADD', 'SETTING')
  @ApiOperation({ summary: '업무 요청 · 할 일 넣기 (v10.463)', description: '담당자(비우면 나) · 기한 · 중요.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OFC_TASK_TITLE · OFC_TASK_BODY · OFC_TASK_ASSIGNEE · OFC_TASK_DUE' })
  async addTask(@Body() dto: OfcTaskNewDto) { return createTask(this.db, dto, await this.me()); }

  @Post('office/tasks/:id/move')
  @Roles(...SELF)
  @HttpCode(200)
  @Audit('OFC_TASK_MOVE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '업무 칸 옮기기 (v10.463)', description: '진행 · 완료 · 되돌림은 담당자 · 다시 열기(완료 → 진행)는 요청한 사람 · SUPER 는 모두.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OFC_TASK_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OFC_TASK_MOVE' })
  async move(@Param('id') id: string, @Body() dto: OfcTaskMoveDto) { return moveTask(this.db, id, dto.to, dto.note, await this.me()); }

  @Post('office/tasks/:id/assign')
  @Roles(...SELF)
  @HttpCode(200)
  @Audit('OFC_TASK_ASSIGN', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '업무 담당 바꾸기 (v10.463)', description: '요청한 사람 · SUPER · 끝나지 않은 것 · 「요청」 칸으로 돌아감.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OFC_TASK_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OFC_TASK_ASSIGNEE' })
  async assign(@Param('id') id: string, @Body() dto: OfcTaskAssignDto) { return assignTask(this.db, id, dto.assigneeId, dto.note, await this.me()); }

  @Post('office/tasks/:id/cancel')
  @Roles(...SELF)
  @HttpCode(200)
  @Audit('OFC_TASK_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '업무 요청 취소 (v10.463)', description: '요청한 사람 · SUPER · 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OFC_TASK_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OFC_TASK_REASON' })
  async taskCancel(@Param('id') id: string, @Body() dto: OfcTaskCancelDto) { return cancelTask(this.db, id, dto.reason, await this.me()); }

  @Post('office/tasks/:id/comments')
  @Roles(...SELF)
  @HttpCode(200)
  @Audit('OFC_TASK_COMMENT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '업무 댓글 (v10.463)', description: '요청한 사람 · 담당자 · SUPER · 쌓기만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OFC_TASK_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OFC_TASK_COMMENT' })
  async comment(@Param('id') id: string, @Body() dto: OfcTaskCommentDto) { return commentTask(this.db, id, dto.body, await this.me()); }

  /* ── v10.464 출장 · 여비 정산 ── */
  @Get('office/trips')
  @Roles(...SELF)
  @ApiQuery({ name: 'view', required: false, enum: ['mine', 'all'] })
  @ApiOperation({ summary: '출장 목록 (v10.464)', description: '본인 출장(SUPER · 지급 담당은 view=all 로 모두) · 품의 상태 · 정산 · 여비 기준.' })
  @ApiOkResponse({ type: Object })
  async trips(@Query('view') view?: string) { return listTrips(this.db, await this.me(), view); }

  @Get('office/trips/:id')
  @Roles(...SELF)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '출장 자세히 (v10.464)', description: '신청 때 기준 · 품의 · 정산 기록(경비 청구 상태).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  async trip(@Param('id') id: string) { return tripDetail(this.db, id, await this.me()); }

  @Post('office/trips')
  @Roles(...SELF)
  @HttpCode(200)
  @Audit('OFC_TRIP_ADD', 'SETTING')
  @ApiOperation({ summary: '출장 신청 (v10.464)', description: '예상 여비를 셈해 품의(EXP_TRAVEL) 하나를 같이 올림 — 결재선 · 결재함 · SUPER 결재 그대로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OFC_TRIP_DEST · OFC_TRIP_REGION · OFC_TRIP_PURPOSE · OFC_TRIP_DATE · OFC_TRIP_AMOUNT · REQ_ACCOUNT' })
  async addTrip(@Body() dto: OfcTripNewDto) { return createTrip(this.db, dto, await this.me()); }

  @Post('office/trips/:id/cancel')
  @Roles(...SELF)
  @HttpCode(200)
  @Audit('OFC_TRIP_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '출장 취소 (v10.464)', description: '정산 전 · 본인 · SUPER · 품의도 취소.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OFC_TRIP_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OFC_TRIP_REASON' })
  async tripCancel(@Param('id') id: string, @Body() dto: OfcTripCancelDto) { return cancelTrip(this.db, id, dto.reason, await this.me()); }

  @Post('office/trips/:id/settle')
  @Roles(...SELF)
  @HttpCode(200)
  @Audit('OFC_TRIP_SETTLE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '여비 정산 (v10.464)', description: '본인 · 오는 날 뒤 · 품의 승인 — 일비 · 식비 · 숙박(상한까지) · 교통비로 경비 청구 하나(EXP_TRAVEL · 간이 · 부가세 0). 이미 살아 있는 청구가 있으면 409(두 번 청구 막기 · DB 도 막음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OFC_TRIP_STATE · OFC_TRIP_DOUBLE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OFC_TRIP_EARLY · OFC_TRIP_NIGHTS · OFC_TRIP_AMOUNT · OFC_TRIP_OVER · FILE_INVALID · TOO_MANY_FILES · REQ_OVER' })
  async settle(@Param('id') id: string, @Body() dto: OfcTripSettleDto) { return settleTrip(this.db, id, dto, await this.me()); }

  @Put('office/trip-standards')
  @Roles('SUPER')
  @Audit('OFC_TRIP_STANDARDS', 'SETTING')
  @ApiOperation({ summary: '여비 기준 고치기 (v10.464 · SUPER)', description: '일비 · 식비 · 숙박 상한(서울 · 광역시 · 그 밖) · 사유 — 새로 신청하는 출장부터.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OFC_TRIP_STANDARD · OFC_TRIP_REASON' })
  setStandards(@Body() dto: OfcTripStandardsDto) { return setTripStandards(this.db, dto); }

  /* ── v10.465 브라우저 알림(본인만) ── */
  @Get('me/notify')
  @Roles(...SELF)
  @ApiOperation({ summary: '내 브라우저 알림 설정 (v10.465)', description: '켬 · 끔 · 종류 · 전체 스위치(ofc.browser_notify) · 묻는 간격(ofc.notify_poll_sec).' })
  @ApiOkResponse({ type: Object })
  async notifyPrefs() { return myNotify(this.db, await this.me()); }

  @Put('me/notify')
  @Roles(...SELF)
  @Audit('OFC_NOTIFY_SET', 'SETTING')
  @ApiOperation({ summary: '내 브라우저 알림 켜고 끄기 (v10.465)', description: '본인만 · 종류 OPS · APV · TASK.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OFC_NOTIFY_OFF · OFC_NOTIFY_KIND' })
  async setNotify(@Body() dto: OfcNotifyPrefsDto) { return setMyNotify(this.db, await this.me(), dto); }

  @Get('me/notify/feed')
  @Roles(...SELF)
  @ApiQuery({ name: 'since', required: false, example: '2026-11-20T00:00:00Z' })
  @ApiOperation({ summary: '내 알림 (v10.465 · 화면이 주기적으로 물음)', description: '급한 운영 알림(ADMIN · SUPER) · 나에게 온 결재 · 업무 요청 · 기한 · 끝남 · 댓글 — 켜지 않았으면 on:false · 빈 목록.' })
  @ApiOkResponse({ type: Object })
  async feed(@Query('since') since?: string) { return notifyFeed(this.db, await this.me(), since); }
}
