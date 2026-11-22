import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { StateConflict } from '../../core/errors';
import { DatabaseService } from '../../db/database.service';
import { ReviewService } from '../review/review.service';
import { AbuseService } from '../review/abuse.service';
import { InquiryAdminService } from '../support/inquiry-admin.service';
import { AdminMemberService } from '../admin/admin-member.service';
import { archiveDetail, archiveJob, archiveState, verifyBundle } from './archive';
import { decideCase, editRule, listCases, listRules, listScores, recompute } from './risk';
import { BULK_MAX, bulkRuns, runBulk } from './bulk';
import { savePrereq, switchOverview } from './switches';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * v10.509 ~ 512 (D275 · docs/647 ~ 650) ㊺ 기록 · 안전 · 운영 — 운영 화면
 *   v10.509  GET /admin/opx/archive · GET /archive/{id} · POST /archive/run · POST /archive/{id}/verify — SUPER 만
 *   v10.510  GET /admin/opx/risk/rules · PUT /risk/rules/{id}(SUPER) · GET /risk/scores · GET /risk/cases · POST /risk/cases/{id}/decide · POST /risk/recompute/{id}
 *   v10.511  POST /admin/opx/bulk/reviews(REVIEWER · ADMIN · SUPER) · /bulk/reports · /bulk/inquiries · /bulk/members(ADMIN · SUPER) · GET /bulk/runs
 *   v10.512  GET /admin/opx/switches — 읽기만(ADMIN · SUPER)
 *   점수는 /admin 아래에만 — 회원 API 없음 · 세무사(ACCOUNTANT)는 /admin/acct/ 밖이라 보지 않음
 * ------------------------------------------------------------------- */

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const actor = () => RequestCtx.actorId() ?? null;

export class OpxRiskRuleEditDto {
  @ApiPropertyOptional({ example: 25, description: '점수 0 ~ 100' }) @IsOptional() @IsInt() @Min(0) @Max(100) points?: number;
  @ApiPropertyOptional({ example: 5, description: '기준값 1 ~ 3650(규칙마다 뜻이 다름 — 일 · 개 · 건)' }) @IsOptional() @IsInt() @Min(1) @Max(3650) param?: number;
  @ApiPropertyOptional({ example: true }) @IsOptional() @StrictBoolean() active?: boolean;
}
export class OpxRiskDecideDto {
  @ApiProperty({ enum: ['CLEARED', 'ACTIONED'], description: 'CLEARED 문제없음 · ACTIONED 조치함(정지 · 매물 내림 등은 그 화면에서)' }) @IsIn(['CLEARED', 'ACTIONED']) result!: string;
  @ApiProperty({ example: '같은 가족 계정 · 정상', description: '판단 사유 2 ~ 300자' }) @IsString() @Length(2, 300) note!: string;
}
export class OpxBulkReviewDto {
  @ApiProperty({ type: [String], description: `검수 건 번호(uuid) 1 ~ ${BULK_MAX}` }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(BULK_MAX) @IsString({ each: true }) @Matches(UUID, { each: true }) ids!: string[];
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) @IsIn(['APPROVE', 'REJECT']) action!: string;
  @ApiProperty({ example: '같은 업체 중복 등록 정리', description: '사유 2 ~ 300자(검수 메모 · 감사 기록)' }) @IsString() @Length(2, 300) reason!: string;
  @ApiPropertyOptional({ example: 'THIN_CONTENT', description: '반려 때 필수 — review_reason_codes' }) @IsOptional() @IsString() @Length(1, 40) reasonCode?: string;
}
export class OpxBulkReportDto {
  @ApiProperty({ type: [String], description: `신고 번호(uuid) 1 ~ ${BULK_MAX}` }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(BULK_MAX) @IsString({ each: true }) @Matches(UUID, { each: true }) ids!: string[];
  @ApiProperty({ enum: ['UPHOLD', 'DISMISS'], description: 'UPHOLD 인정 · DISMISS 기각' }) @IsIn(['UPHOLD', 'DISMISS']) action!: string;
  @ApiProperty({ example: '이미 내린 매물에 대한 신고', description: '처리 내용 2 ~ 300자 — 신고한 사람에게 그대로 전달됨' }) @IsString() @Length(2, 300) reason!: string;
}
export class OpxBulkInquiryDto {
  @ApiProperty({ type: [String], description: `문의 번호(uuid) 1 ~ ${BULK_MAX}` }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(BULK_MAX) @IsString({ each: true }) @Matches(UUID, { each: true }) ids!: string[];
  @ApiProperty({ enum: ['CLOSE', 'REOPEN', 'ASSIGN'] }) @IsIn(['CLOSE', 'REOPEN', 'ASSIGN']) action!: string;
  @ApiProperty({ example: '중복 문의 정리', description: '사유 2 ~ 300자(감사 기록)' }) @IsString() @Length(2, 300) reason!: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'ASSIGN 때 담당 운영자(빈 글자 = 담당 없음)' }) @IsOptional() @IsString() @Matches(/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})?$/) assigneeId?: string;
}
/* v10.625 (D306 · docs/768) 켜기 도우미 — 선행 조건 확인 적기 */
export class OpxPrereqDto {
  @ApiProperty({ enum: ['LEGAL', 'PRIVACY', 'KEY', 'CONTRACT', 'NOTICE'], description: '선행 조건 — 법무 · 처리방침 · 연동 키 · 계약 · 회원 · 직원 안내' }) @IsIn(['LEGAL', 'PRIVACY', 'KEY', 'CONTRACT', 'NOTICE']) prereq!: string;
  @ApiPropertyOptional({ enum: ['DONE', 'UNDO'], description: 'DONE 확인함(기본) · UNDO 확인 취소' }) @IsOptional() @IsIn(['DONE', 'UNDO']) state?: 'DONE' | 'UNDO';
  @ApiProperty({ example: '법무법인 ○○ 11/22 회신 — 문제없음', description: '확인 내용(어디서 · 언제 · 누가 · 2 ~ 300자)' }) @IsString() @Length(2, 300) note!: string;
}
export class OpxBulkMemberDto {
  @ApiProperty({ type: [String], description: `회원 번호(uuid) 1 ~ ${BULK_MAX}` }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(BULK_MAX) @IsString({ each: true }) @Matches(UUID, { each: true }) ids!: string[];
  @ApiProperty({ enum: ['SUSPEND', 'ACTIVATE'] }) @IsIn(['SUSPEND', 'ACTIVATE']) action!: string;
  @ApiProperty({ example: '같은 연락처 도배 계정', description: '사유 2 ~ 300자(상태 바뀐 기록 · 감사 기록)' }) @IsString() @Length(2, 300) reason!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/opx')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class OpxController {
  constructor(private readonly db: DatabaseService, private readonly review: ReviewService, private readonly abuse: AbuseService,
              private readonly inquiry: InquiryAdminService, private readonly member: AdminMemberService) {}

  private deps() { return { db: this.db, review: this.review, abuse: this.abuse, inquiry: this.inquiry, member: this.member }; }

  /* ── v10.509 기록 장기 보관 ── */
  @Get('archive')
  @Roles('SUPER')
  @ApiOperation({ summary: '기록 장기 보관 — 상태 · 묶음 (v10.509)', description: '스위치 · 보관 개월(처음 36 · 최소 12) · DB 정리 개월(처음 0) · 보관 폴더 · 디스크 여유 · 디스크 밖(S3) 상태(OFF · NOT_READY · ON) · 묶음 목록(지문 · 확인 · S3 · 파기 · 정리) · 경고(「디스크 밖 보관 아님」 등).' })
  @ApiOkResponse({ type: Object })
  archive() { return archiveState(this.db); }

  @Get('archive/:id')
  @Roles('SUPER')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '묶음 한 개 — 목록 지문 · 감사 사슬 머리 · 사건 (v10.509)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  archiveOne(@Param('id') id: string) { return archiveDetail(this.db, id); }

  @Post('archive/run')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('OPX_ARCHIVE_RUN', 'ARCHIVE')
  @ApiOperation({ summary: '지금 돌리기 (v10.509)', description: '정기 작업 opx_archive 와 같음 — 지난 달 묶음(한 번 6개) · S3 올림 · 복원 확인 1개 · 보관 개월 지난 묶음 파기 · DB 정리(설정 > 0). opx.archive 가 off 면 409.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPX_ARCHIVE_OFF' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '없음(형식 오류는 400)' })
  async archiveRun() {
    const r = await archiveJob(this.db, actor());
    if ((r as { skipped?: string }).skipped === 'OFF') throw new StateConflict('OPX_ARCHIVE_OFF', '기록 장기 보관이 꺼져 있습니다(opx.archive off).');
    return r;
  }

  @Post('archive/:id/verify')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('OPX_ARCHIVE_VERIFY', 'ARCHIVE')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '복원 확인 (v10.509)', description: '파일(없으면 S3)을 다시 읽어 sha256 · 압축 · 줄 수 · 첫 · 끝 번호 · 목록 지문 · 앞 묶음 연결 · (DB 줄이 남았으면) 줄 수 · 감사 사슬 끝 지문 대조 · 실패면 급한 알림 OPX_ARCHIVE_BAD.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPX_ARCHIVE_DISPOSED · NOT_READY' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '없음' })
  archiveVerify(@Param('id') id: string) { return verifyBundle(this.db, id, actor()); }

  /* ── v10.510 이상 거래 점수 ── */
  @Get('risk/rules')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '이상 거래 점수 규칙 (v10.510)', description: '규칙 · 점수 · 기준값 · 켜짐 · 스위치 · 기준 점수.' })
  @ApiOkResponse({ type: Object })
  riskRules() { return listRules(this.db); }

  @Put('risk/rules/:id')
  @Roles('SUPER')
  @Audit('OPX_RISK_RULE', 'SETTING')
  @ApiParam({ name: 'id', example: 'LISTING_BURST', description: '규칙 코드' })
  @ApiOperation({ summary: '규칙 점수 · 기준값 · 켜기 (v10.510)', description: '보낸 칸만 바꿈 · 계산식은 바꾸지 않음 · SUPER.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPX_RISK_POINTS · OPX_RISK_PARAM' })
  riskRule(@Param('id') id: string, @Body() dto: OpxRiskRuleEditDto) {
    const v: { points?: number; param?: number; active?: boolean } = {};
    if (dto.points !== undefined) v.points = dto.points;
    if (dto.param !== undefined) v.param = dto.param;
    if (dto.active !== undefined) v.active = dto.active;
    return editRule(this.db, id, v, actor());
  }

  @Get('risk/scores')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'min', required: false, description: '이 점수 이상(처음 1)' })
  @ApiOperation({ summary: '계정별 점수 (v10.510)', description: '점수 높은 순 200 · 가린 메일 · 까닭 · 열린 검수 대기.' })
  @ApiOkResponse({ type: Object })
  riskScores(@Query('min') min?: string) { return listScores(this.db, Number(min ?? 1)); }

  @Get('risk/cases')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'state', required: false, enum: ['OPEN', 'CLEARED', 'ACTIONED'] })
  @ApiOperation({ summary: '검수 대기 (v10.510)', description: '기준을 넘은 계정 — 열린 것(처음) · 문제없음 · 조치함.' })
  @ApiOkResponse({ type: Object })
  riskCases(@Query('state') state?: string) { return listCases(this.db, state); }

  @Post('risk/cases/:id/decide')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @Audit('OPX_RISK_DECIDE', 'RISK')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '검수 대기 끝내기 (v10.510)', description: '문제없음 · 조치함 + 사유 · 한 번만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPX_RISK_DECIDED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPX_RISK_RESULT · OPX_RISK_NOTE' })
  riskDecide(@Param('id') id: string, @Body() dto: OpxRiskDecideDto) { return decideCase(this.db, id, dto.result, dto.note, actor()); }

  @Post('risk/recompute/:id')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid', description: '회원 번호' })
  @ApiOperation({ summary: '한 계정 다시 셈 (v10.510)', description: '스위치가 꺼져 있어도 셈(기준 넘으면 검수 대기) · 운영 역할 · 탈퇴 계정은 세지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '없음' })
  riskRecompute(@Param('id') id: string) { return recompute(this.db, id); }

  /* ── v10.511 일괄 처리 ── */
  @Get('bulk/runs')
  @Roles('ADMIN', 'SUPER', 'REVIEWER')
  @ApiOperation({ summary: '일괄 처리 기록 (v10.511)', description: '최근 50번 — 종류 · 처리 · 사유 · 됨 · 실패 · 누가.' })
  @ApiOkResponse({ type: Object })
  runs() { return bulkRuns(this.db); }

  @Post('bulk/reviews')
  @Roles('REVIEWER', 'ADMIN', 'SUPER')
  @HttpCode(200)
  @ApiOperation({ summary: '검수 일괄 승인 · 반려 (v10.511)', description: `한 번 ${BULK_MAX}줄까지 · 줄마다 검수 한 건 처리(ReviewService.decide)를 그 줄 거래에서 · 감사 REVIEW_DECIDE 줄마다 · 실패한 줄은 결과에 코드.` })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음(줄마다 결과에 ALREADY_DECIDED 등)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPX_BULK_MAX · OPX_BULK_REASON · OPX_BULK_REASON_CODE' })
  bulkReviews(@Body() dto: OpxBulkReviewDto) { return runBulk(this.deps(), 'REVIEW', { ids: dto.ids, action: dto.action, reason: dto.reason, reasonCode: dto.reasonCode }); }

  @Post('bulk/reports')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @ApiOperation({ summary: '신고 일괄 인정 · 기각 (v10.511)', description: `한 번 ${BULK_MAX}줄까지 · 줄마다 신고 처리(AbuseService.resolve · 신고한 사람 알림) · 감사 REPORT_RESOLVE 줄마다.` })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음(줄마다 결과에 NOT_OPEN)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPX_BULK_MAX · OPX_BULK_REASON' })
  bulkReports(@Body() dto: OpxBulkReportDto) { return runBulk(this.deps(), 'REPORT', { ids: dto.ids, action: dto.action, reason: dto.reason }); }

  @Post('bulk/inquiries')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @ApiOperation({ summary: '1:1 문의 일괄 닫기 · 다시 열기 · 담당 (v10.511)', description: `한 번 ${BULK_MAX}줄까지 · 줄마다 InquiryAdminService.patch · 감사 INQUIRY_UPDATE 줄마다.` })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음(줄마다 결과에 INQUIRY_ALREADY_OPEN)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPX_BULK_MAX · OPX_BULK_REASON · OPX_BULK_ASSIGNEE' })
  bulkInquiries(@Body() dto: OpxBulkInquiryDto) { return runBulk(this.deps(), 'INQUIRY', { ids: dto.ids, action: dto.action, reason: dto.reason, assigneeId: dto.assigneeId }); }

  @Post('bulk/members')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @ApiOperation({ summary: '회원 일괄 정지 · 정상 (v10.511)', description: `한 번 ${BULK_MAX}줄까지 · 줄마다 AdminMemberService.setAccountStatus(자기 자신 · 최고 관리자 빼고 · 상태 바뀐 기록) · 감사 ACCOUNT_STATUS 줄마다.` })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음(줄마다 결과에 SAME_STATUS · WITHDRAWN)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPX_BULK_MAX · OPX_BULK_REASON' })
  bulkMembers(@Body() dto: OpxBulkMemberDto) { return runBulk(this.deps(), 'MEMBER', { ids: dto.ids, action: dto.action, reason: dto.reason }); }

  /* ── v10.512 기능 스위치 한눈에 ── */
  @Get('switches')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '기능 스위치 한눈에 (v10.512)', description: '켜고 끄는 설정 모두 — 지금 값 · 처음 값 · 처음과 다름 · 켤 조건 · 문서 · 마지막 바꾼 사람 · 때 · 까닭. 읽기만(고치기는 정책 › 전체 설정).' })
  @ApiOkResponse({ type: Object })
  switches() { return switchOverview(this.db); }

  /* ── v10.625 켜기 도우미 — 선행 조건 확인 적기(켜기는 「전체 설정」 그대로) ── */
  @Post('switches/:key/prereq')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('OPX_SWITCH_PREREQ', 'SETTING')
  @ApiParam({ name: 'key', example: 'grw.tier_reward', description: '스위치 설정 키' })
  @ApiOperation({ summary: '스위치 선행 조건 확인 적기 (v10.625 · SUPER)', description: '켤 조건 글에서 고른 선행 조건(법무 · 처리방침 · 연동 키 · 계약 · 안내)을 「확인함」 · 「확인 취소」로 적음 · 쌓기만 · 켜기를 막지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND(스위치가 아님)' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '없음' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPX_PREREQ_NOTE · OPX_PREREQ_NOT_NEEDED' })
  switchPrereq(@Param('key') key: string, @Body() dto: OpxPrereqDto) { return savePrereq(this.db, key, dto.prereq, dto.state ?? 'DONE', dto.note, actor()); }
}
