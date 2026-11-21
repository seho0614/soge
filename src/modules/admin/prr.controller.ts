import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { buildReview, keepItems, parseQuarter, revokeItems, reviewView } from './prr-review';
import { cancelCase, caseList, caseView, closeCase, inviteCase, openCase, revokeCase, setStep, undoStep } from './prr-cases';

/* ---------------------------------------------------------------------
 * v10.566 · 568 (docs/708 · 710) 직원 · 권한 › 거둘 후보 · 입사 · 퇴사
 *   v10.566 권한 정기 점검
 *     GET  /admin/staff/review?quarter=2026-Q4        분기 거둘 후보(ADMIN 읽기 · 메일 원문은 SUPER)
 *     POST /admin/staff/review/build                  이번 분기 후보 다시 만들기(SUPER)
 *     POST /admin/staff/review/revoke                 고른 후보 한 번에 거두기(SUPER · 사유 · 줄마다 결과)
 *     POST /admin/staff/review/keep                   고른 후보 「둠」(SUPER · 메모)
 *   v10.568 입사 · 퇴사 흐름
 *     GET  /admin/staff/cases · /admin/staff/cases/{id}           (ADMIN 읽기 · 퇴직금 추계 금액 · 초대 메일 원문은 SUPER)
 *     POST /admin/staff/cases                                      흐름 열기(SUPER)
 *     POST /admin/staff/cases/{id}/invite                          운영 계정 초대 메일 적기(SUPER · 메일은 보내지 않음)
 *     PUT · DELETE /admin/staff/cases/{id}/steps/{step}            손으로 됨 · 건너뜀 · 되돌리기(SUPER)
 *     POST /admin/staff/cases/{id}/revoke · close · cancel         권한 거두기 · 끝내기 · 취소(SUPER)
 *   주소는 /admin/acct/ 밖 — 세무사(ACCOUNTANT · 회계 GET 읽기)는 못 봄(계약 규칙 8). 감사는 응답 중 번호 · 상태만(pick).
 * ------------------------------------------------------------------- */

export class PrrBuildDto {
  @ApiPropertyOptional({ example: '2026-Q4', description: '비우면 이번 분기(이번 분기만 만듦)' }) @IsOptional() @IsString() @Matches(/^\d{4}-Q[1-4]$/) quarter?: string;
}
export class PrrRevokeDto {
  @ApiProperty({ type: [String], example: ['12', '13'] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @Matches(/^\d{1,18}$/, { each: true }) ids!: string[];
  @ApiProperty({ example: '2026-Q4 정기 점검 — 90일 안 씀' }) @IsString() @Length(2, 200) reason!: string;
}
export class PrrKeepDto {
  @ApiProperty({ type: [String], example: ['14'] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @Matches(/^\d{1,18}$/, { each: true }) ids!: string[];
  @ApiProperty({ example: '분기 결산 때만 씀 — 그대로 둠' }) @IsString() @Length(2, 200) note!: string;
}
export class PrrCaseOpenDto {
  @ApiProperty({ enum: ['JOIN', 'LEAVE'] }) @IsIn(['JOIN', 'LEAVE']) kind!: string;
  @ApiPropertyOptional({ example: '1', description: '직원 대장 번호(입사는 비우고 이름 · 입사일로 새 직원을 넣을 수 있음)' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) employeeId?: string;
  @ApiPropertyOptional({ example: '홍길동' }) @IsOptional() @IsString() @Length(1, 40) name?: string;
  @ApiPropertyOptional({ example: '2026-12-01' }) @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) joinedOn?: string;
  @ApiPropertyOptional({ example: 3000000 }) @IsOptional() @IsInt() @Min(0) @Max(100000000) monthlyBase?: number;
  @ApiPropertyOptional({ example: 200000 }) @IsOptional() @IsInt() @Min(0) @Max(10000000) nontax?: number;
  @ApiPropertyOptional({ example: 1 }) @IsOptional() @IsInt() @Min(1) @Max(11) dependents?: number;
  @ApiPropertyOptional({ example: '2026-12-31', description: '퇴사일(퇴사 흐름 · 급여 › 직원에 이미 있으면 비움)' }) @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) leftOn?: string;
  @ApiPropertyOptional({ example: '영업팀 충원' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class PrrInviteDto {
  @ApiProperty({ example: 'new.staff@example.com' }) @IsString() @Length(3, 120) @Matches(/^[^@\s]+@[^@\s]+\.[^@\s]+$/) email!: string;
}
export class PrrStepDto {
  @ApiProperty({ enum: ['DONE', 'SKIP'] }) @IsIn(['DONE', 'SKIP']) action!: string;
  @ApiPropertyOptional({ example: '운영 계정이 필요 없는 직무' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class PrrReasonDto {
  @ApiProperty({ example: '11/30 퇴사' }) @IsString() @Length(2, 200) reason!: string;
}
export class PrrCloseDto {
  @ApiPropertyOptional({ example: '모두 마침' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}

const isSuperNow = () => RequestCtx.get()?.actorRole === 'SUPER';
const me = () => RequestCtx.actorId() ?? null;

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/staff')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class PrrStaffController {
  constructor(private readonly db: DatabaseService) {}

  /* ── v10.566 권한 정기 점검 ── */
  @Get('review')
  @Roles('ADMIN')
  @ApiQuery({ name: 'quarter', required: false, example: '2026-Q4' })
  @ApiOperation({ summary: '분기 거둘 후보 (v10.566)', description: '퇴사자 권한 · 오래 로그인 안 함 · 안 쓴 권한그룹(90일) · 외부 계정 기한 없음 · 역할 없는데 권한 남음 · 기한 지난 권한 줄. 줄마다 최근 막힘 기록 수. 메일 원문은 SUPER.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRR_QUARTER' })
  review(@Query('quarter') quarter?: string) { return reviewView(this.db, quarter, isSuperNow()); }

  @Post('review/build')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('PRR_REVIEW_BUILD', 'SETTING', { pick: ['ok', 'quarter', 'addedTotal', 'gone', 'open'] })
  @ApiOperation({ summary: '이번 분기 거둘 후보 다시 만들기 (v10.566 · SUPER)', description: '새 후보만 더하고 대상이 없어진 열린 줄은 GONE. 다시 해도 같음. 정기 작업 prr_daily 도 같은 일(prr.review_auto on).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRR_QUARTER · PRR_QUARTER_RANGE' })
  build(@Body() dto: PrrBuildDto) { return buildReview(this.db, parseQuarter(dto.quarter), me()); }

  @Post('review/revoke')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('PRR_REVIEW_REVOKE', 'ACCOUNT', { pick: ['ok', 'done', 'failed', 'alertsResolved'] })
  @ApiOperation({ summary: '고른 후보 한 번에 거두기 (v10.566 · SUPER)', description: '역할 · 권한그룹 · 개별 권한을 지움 · 사유는 권한 변경 기록에 · 줄마다 결과(마지막 SUPER · 자기 자신 · 이미 결정은 그 줄만 실패) · 역할이 모두 없어지면 STAFF_LEFT_ROLE 풀림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRR_REASON · PRR_IDS' })
  revoke(@Body() dto: PrrRevokeDto) { return revokeItems(this.db, dto.ids, dto.reason, me()); }

  @Post('review/keep')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('PRR_REVIEW_KEEP', 'ACCOUNT', { pick: ['ok', 'kept', 'skipped'] })
  @ApiOperation({ summary: '고른 후보 그대로 두기 (v10.566 · SUPER)', description: '메모 필수 · 결정은 한 번(고칠 수 없음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRR_NOT_OPEN' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRR_NOTE · PRR_IDS' })
  keep(@Body() dto: PrrKeepDto) { return keepItems(this.db, dto.ids, dto.note, me()); }

  /* ── v10.568 입사 · 퇴사 흐름 ── */
  @Get('cases')
  @Roles('ADMIN')
  @ApiOperation({ summary: '입사 · 퇴사 흐름 목록 (v10.568)', description: '열린 흐름 먼저 · 진행(됨 / 모두) · 기한 넘김. SUPER 에게만 직원 고르기 목록.' })
  @ApiOkResponse({ type: Object })
  cases() { return caseList(this.db, isSuperNow()); }

  @Get('cases/:id')
  @Roles('ADMIN')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '입사 · 퇴사 흐름 하나 (v10.568)', description: '단계마다 됨 · 건너뜀 · 남음 · 저절로 / 손으로 · 자세히 탭. 퇴직금 추계 금액 · 초대 메일 원문은 SUPER.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  caseOne(@Param('id') id: string) { return caseView(this.db, id, isSuperNow()); }

  @Post('cases')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('PRR_CASE_OPEN', 'SETTING', { pick: ['ok', 'id', 'kind', 'employeeId'] })
  @ApiOperation({ summary: '입사 · 퇴사 흐름 열기 (v10.568 · SUPER)', description: '입사: 직원을 고르거나 이름 · 입사일로 새 직원(급여 › 직원과 같은 칸). 퇴사: 직원 · 퇴사일(퇴사일을 넣으면 연결 계정에 운영 역할이 남은 경우 STAFF_LEFT_ROLE). 흐름이 열린 동안 운영 알림 STAFF_CASE_OPEN.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRR_CASE_OPEN' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRR_KIND · PRR_EMPLOYEE · PRR_LEFT_ON · ACCT_EMPLOYEE' })
  open(@Body() dto: PrrCaseOpenDto) {
    return openCase(this.db, { kind: dto.kind, employeeId: dto.employeeId, name: dto.name, joinedOn: dto.joinedOn, monthlyBase: dto.monthlyBase,
                               nontax: dto.nontax, dependents: dto.dependents, leftOn: dto.leftOn, note: dto.note }, me());
  }

  @Post('cases/:id/invite')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('PRR_CASE_INVITE', 'SETTING', { pick: ['ok', 'id', 'accountFound'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '운영 계정 초대 메일 적기 (v10.568 · SUPER)', description: '입사 흐름만 · 메일은 보내지 않고 안내문(guide)을 돌려줌 · 그 메일로 가입한 계정이 있으면 accountFound. 메일은 흐름이 끝나면 지움.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRR_CASE_CLOSED · PRR_ALREADY_LINKED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRR_EMAIL · PRR_KIND' })
  invite(@Param('id') id: string, @Body() dto: PrrInviteDto) { return inviteCase(this.db, id, dto.email, me()); }

  @Put('cases/:id/steps/:step')
  @Roles('SUPER')
  @Audit('PRR_CASE_STEP', 'SETTING', { pick: ['ok', 'id', 'step', 'state'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiParam({ name: 'step', example: 'DOCS' })
  @ApiOperation({ summary: '흐름 단계 손으로 됨 · 건너뜀 (v10.568 · SUPER)', description: '「됨」은 초대 · 퇴직금 확인 · 서류 보관만 · 「건너뜀」은 사유 2자 이상 · 직원 대장 · 퇴사일은 못 바꿈.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRR_CASE_CLOSED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRR_STEP · PRR_STEP_AUTO · PRR_STEP_CORE · PRR_NOTE' })
  step(@Param('id') id: string, @Param('step') step: string, @Body() dto: PrrStepDto) { return setStep(this.db, id, String(step ?? '').toUpperCase(), dto.action, dto.note, me()); }

  @Delete('cases/:id/steps/:step')
  @Roles('SUPER')
  @Audit('PRR_CASE_STEP_UNDO', 'SETTING', { pick: ['ok', 'id', 'step'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiParam({ name: 'step', example: 'DOCS' })
  @ApiOperation({ summary: '손으로 적은 단계 되돌리기 (v10.568 · SUPER)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRR_CASE_CLOSED' })
  stepUndo(@Param('id') id: string, @Param('step') step: string) { return undoStep(this.db, id, String(step ?? '').toUpperCase()); }

  @Post('cases/:id/revoke')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('PRR_CASE_REVOKE', 'ACCOUNT', { pick: ['ok', 'id', 'revoked', 'groups', 'overrides'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '퇴사자 운영 권한 모두 거두기 (v10.568 · SUPER)', description: '운영 역할(운영자 목록 「역할 모두 거두기」와 같은 처리 · 마지막 SUPER 409 · 자기 자신 403) + 권한그룹 · 개별 권한 · 사유 필수.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRR_CASE_CLOSED · PRR_NO_ACCOUNT · NO_SUCH_ROLE · STAFF_LAST_SUPER' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRR_REASON · PRR_KIND' })
  caseRevoke(@Param('id') id: string, @Body() dto: PrrReasonDto) { return revokeCase(this.db, id, dto.reason, me()); }

  @Post('cases/:id/close')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('PRR_CASE_CLOSE', 'SETTING', { pick: ['ok', 'id', 'state'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '흐름 끝내기 (v10.568 · SUPER)', description: '남은 단계 0 일 때만 · 초대 메일 지움 · 운영 알림 STAFF_CASE_OPEN · 기한 넘김 알림 풂.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRR_CASE_CLOSED · PRR_STEPS_LEFT' })
  close(@Param('id') id: string, @Body() dto: PrrCloseDto) { return closeCase(this.db, id, dto.note, me()); }

  @Post('cases/:id/cancel')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('PRR_CASE_CANCEL', 'SETTING', { pick: ['ok', 'id', 'state'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '흐름 취소 (v10.568 · SUPER)', description: '사유 필수 · 퇴사일 · 거둔 권한은 되돌리지 않음 · 알림 풂.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRR_CASE_CLOSED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRR_REASON' })
  cancel(@Param('id') id: string, @Body() dto: PrrReasonDto) { return cancelCase(this.db, id, dto.reason, me()); }
}
