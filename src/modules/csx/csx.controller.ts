import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { CsxSettingsInput, setCsxSettings } from './common';
import { DRAFT_STATES, discardDraft, draftForInquiry, draftList, makeDraft, markUsed } from './ai-draft';
import { CHURN_LEVELS, churnList, churnRebuild } from './churn';
import { MAIL_BODY_MAX, MAIL_CODES, MAIL_SUBJECT_MAX } from './mail-render';
import { mailTemplateList, mailTemplateOne, mailTemplatePreview, mailTemplateReset, mailTemplateRevert, mailTemplateSave } from './mail-templates';
import { MERGE_STATES, mergeApprove, mergeCancel, mergeCheck, mergeFindAccount, mergeList, mergeReject, mergeRequest } from './merge';
import { csxOverview } from './jobs';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * v10.528 ~ 531 (D280 · docs/666 ~ 669) ㊿ 고객센터 · 회원 — 운영 화면만(회원 화면 없음 · 공개 API 없음)
 *   한눈에 · 설정      GET /admin/csx/overview · PUT /admin/csx/settings(SUPER)
 *   AI 답변 초안       GET /admin/csx/ai-drafts · GET · POST /admin/csx/inquiries/{id}/ai-draft · POST /admin/csx/ai-drafts/{id}/used · /discard
 *   이탈 위험 신호     GET /admin/csx/churn · POST /admin/csx/churn/rebuild
 *   메일 문구          GET /admin/csx/mail-templates · GET /admin/csx/mail-templates/{code} · POST …/{code}/preview
 *                      PUT …/{code} · POST …/{code}/revert · POST …/{code}/reset (SUPER)
 *   계정 합치기        GET /admin/csx/merges · GET /admin/csx/merges/find · POST /admin/csx/merges/check · POST /admin/csx/merges
 *                      POST /admin/csx/merges/{id}/approve · /reject (SUPER) · POST /admin/csx/merges/{id}/cancel
 *   세무사(ACCOUNTANT)는 /admin/acct/ 밖이라 보지 않음(규칙 8)
 * ------------------------------------------------------------------- */

const me = () => RequestCtx.actorId()!;
const CODE_RE = /^[A-Z][A-Z0-9_]{2,39}$/;   // DB CHECK csx_mail_template_defs.code 와 같음

export class CsxSettingsDto {
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() aiDraft?: boolean;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() aiDraftAuto?: boolean;
  @ApiPropertyOptional({ example: '' }) @IsOptional() @IsString() @Matches(/^(|[a-z0-9][a-z0-9.-]{2,59})$/) aiDraftModel?: string;
  @ApiPropertyOptional({ example: 5 }) @IsOptional() @IsInt() @Min(1) @Max(20) aiDraftBatch?: number;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() churn?: boolean;
  @ApiPropertyOptional({ example: 3 }) @IsOptional() @IsInt() @Min(1) @Max(60) churnMinPrevDays?: number;
  @ApiPropertyOptional({ example: 70 }) @IsOptional() @IsInt() @Min(10) @Max(99) churnDropPct?: number;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() mailTemplates?: boolean;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() accountMerge?: boolean;
  @ApiProperty({ example: '대표 결정 — AI 초안 시험 운영' }) @IsString() @Length(2, 200) reason!: string;
}
export class CsxMailTplSaveDto {
  @ApiProperty({ maxLength: MAIL_SUBJECT_MAX }) @IsString() @MaxLength(200) subject!: string;
  @ApiProperty({ maxLength: MAIL_BODY_MAX }) @IsString() @MaxLength(8000) body!: string;
  @ApiProperty({ example: '법무 확인 문구 반영' }) @IsString() @Length(2, 200) note!: string;
}
export class CsxMailTplPreviewDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) subject?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8000) body?: string;
}
export class CsxMailTplRevertDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) @Max(100000) version!: number;
  @ApiProperty() @IsString() @Length(2, 200) note!: string;
}
export class CsxMailTplResetDto {
  @ApiProperty() @IsString() @Length(2, 200) note!: string;
}
export class CsxMergeCheckDto {
  @ApiProperty({ format: 'uuid', description: '합쳐 없어질 옛 계정' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) sourceId!: string;
  @ApiProperty({ format: 'uuid', description: '남길 계정' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) targetId!: string;
}
export class CsxMergeCreateDto {
  @ApiProperty({ format: 'uuid' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) sourceId!: string;
  @ApiProperty({ format: 'uuid' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) targetId!: string;
  @ApiProperty({ example: '회원 요청 — 예전 메일 계정과 합치기(1:1 문의 번호)' }) @IsString() @Length(2, 300) reason!: string;
}
export class CsxMergeApproveDto {
  @ApiProperty({ example: '합치기', description: '되돌릴 수 없음 확인 글자 — 「합치기」' }) @IsString() @MaxLength(10) confirm!: string;
  @ApiPropertyOptional({ maxLength: 300 }) @IsOptional() @IsString() @MaxLength(300) note?: string;
}
export class CsxMergeRejectDto {
  @ApiProperty() @IsString() @Length(2, 300) note!: string;
}

@ApiTags('CSX')
@ApiBearerAuth()
@Controller('api/v1')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class CsxController {
  constructor(private readonly db: DatabaseService) {}

  /* ── 한눈에 · 설정 ── */
  @Get('admin/csx/overview')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '고객센터 · 회원 기능 한눈에 (v10.528 ~ 531)', description: '스위치 · AI 초안 대기 · 이탈 위험 수 · 고친 메일 문구 수 · 열린 합치기 요청.' })
  @ApiOkResponse({ type: Object })
  overview() { return csxOverview(this.db); }

  @Put('admin/csx/settings')
  @Roles('SUPER')
  @ApiOperation({ summary: '고객센터 · 회원 기능 설정 (SUPER)', description: 'AI 초안 · 자동 초안 · 모델 · 한 번에 수 · 이탈 신호 · 기준 · 메일 문구 사용 · 계정 합치기 — 사유는 「전체 설정」 바뀐 기록에 남음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: '없음(쓰지 않음)', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'CSX_REASON · CSX_SETTING_VALUE · CSX_NOTHING', type: ErrorDto })
  @Audit('CSX_SETTINGS', 'SITE_SETTING')
  settings(@Body() dto: CsxSettingsDto) {
    const d: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto)) if (v !== undefined) d[k] = v;   // 규칙 11 — 안 보낸 칸은 덮지 않음
    return setCsxSettings(this.db, d as CsxSettingsInput);
  }

  /* ── v10.528 AI 답변 초안 ── */
  @Get('admin/csx/ai-drafts')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '1:1 문의 AI 답변 초안 목록 (v10.528)', description: '최근 100건 · 상태별 수 · AI 통로(CSX_DRAFT) 열림 · 이번 달 비용. 초안은 회원에게 보이지 않음.' })
  @ApiQuery({ name: 'state', enum: DRAFT_STATES, required: false })
  @ApiOkResponse({ type: Object })
  drafts(@Query('state') state?: string) { return draftList(this.db, state); }

  @Get('admin/csx/inquiries/:id/ai-draft')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '문의 한 건의 AI 초안 (v10.528)', description: '가장 최근 초안 하나(없으면 draft=null) · 스위치.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 문의', type: ErrorDto })
  draftOne(@Param('id') id: string) { return draftForInquiry(this.db, id); }

  @Post('admin/csx/inquiries/:id/ai-draft')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: 'AI 초안 만들기 (v10.528)', description: 'FAQ · 답변 틀 · 같은 분류 지난 답변을 바탕으로 바로 만듦(AI 전체 스위치 · csx.ai_draft · 월 상한 안에서). 회원에게 보내지 않음 — 운영자가 고쳐 기존 「답변 보내기」로.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 문의', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'CSX_INQ_CLOSED · CSX_DRAFT_BUSY', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'CSX_AI_OFF', type: ErrorDto })
  @Audit('CSX_AI_DRAFT', 'INQUIRY')
  draftMake(@Param('id') id: string) { return makeDraft(this.db, me(), id); }

  @Post('admin/csx/ai-drafts/:id/used')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: 'AI 초안을 답변 칸에 넣음 (v10.528)', description: '쓴 것으로 표시(지표 · 감사) — 보내기는 기존 POST /admin/inquiries/{id}/answer.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 초안', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'CSX_DRAFT_STATE', type: ErrorDto })
  @ApiResponse({ status: 422, description: '없음(쓰지 않음)', type: ErrorDto })
  draftUsed(@Param('id', ParseIntPipe) id: number) { return markUsed(this.db, me(), id); }

  @Post('admin/csx/ai-drafts/:id/discard')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: 'AI 초안 버리기 (v10.528)', description: '버리면 그 문의에 다시 만들 수 있음.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 초안', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'CSX_DRAFT_STATE', type: ErrorDto })
  @ApiResponse({ status: 422, description: '없음(쓰지 않음)', type: ErrorDto })
  draftDiscard(@Param('id', ParseIntPipe) id: number) { return discardDraft(this.db, id); }

  /* ── v10.529 이탈 위험 신호 ── */
  @Get('admin/csx/churn')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '이탈 위험 신호 (v10.529)', description: '최근 30일 활동이 앞 60일보다 크게 줄어든 회원 — 가린 메일 · 이름 첫 글자 · 마케팅 동의 여부 · 30일 추이. 내려받기 없음.' })
  @ApiQuery({ name: 'level', enum: CHURN_LEVELS, required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiOkResponse({ type: Object })
  churn(@Query('level') level?: string, @Query('page') page?: string) { return churnList(this.db, level, Number(page) || 1); }

  @Post('admin/csx/churn/rebuild')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '이탈 위험 신호 지금 다시 셈 (v10.529)', description: 'csx.churn 이 켜져 있을 때만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: '없음(쓰지 않음)', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'CSX_CHURN_OFF', type: ErrorDto })
  churnRedo() { return churnRebuild(this.db); }

  /* ── v10.530 메일 문구 ── */
  @Get('admin/csx/mail-templates')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '메일 문구 목록 (v10.530)', description: '코드가 보내는 메일 8가지 — 고친 판인지 · 판 번호 · 자리값 · 스위치.' })
  @ApiOkResponse({ type: Object })
  mailTpls() { return mailTemplateList(this.db); }

  @Get('admin/csx/mail-templates/:code')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '메일 문구 한 가지 (v10.530)', description: '코드 기본 문구 · 지금 문구 · 자리값 · 보기 값 · 판 기록 30.' })
  @ApiParam({ name: 'code', enum: MAIL_CODES })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 메일 종류', type: ErrorDto })
  mailTpl(@Param('code') code: string) { return mailTemplateOne(this.db, code); }

  @Post('admin/csx/mail-templates/:code/preview')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '메일 문구 미리보기 (v10.530)', description: '자리값 검사 결과(problems) · 보기 값으로 채운 제목 · 본문. 저장 · 발송 없음.' })
  @ApiParam({ name: 'code', enum: MAIL_CODES })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 메일 종류', type: ErrorDto })
  @ApiResponse({ status: 409, description: '없음(쓰지 않음 · 읽기만)', type: ErrorDto })
  @ApiResponse({ status: 422, description: '없음(검사 결과는 problems 로 돌려줌)', type: ErrorDto })
  mailTplPreview(@Param('code') code: string, @Body() dto: CsxMailTplPreviewDto) {
    return mailTemplatePreview(CODE_RE.test(code) ? code : '', { subject: dto.subject, body: dto.body });
  }

  @Put('admin/csx/mail-templates/:code')
  @Roles('SUPER')
  @ApiOperation({ summary: '메일 문구 저장 (v10.530 · SUPER)', description: '자리값 검사(쓸 수 있는 것만 · 꼭 넣을 것 · 중괄호 · 주소 직접 쓰기 금지 · 길이) 통과해야 · 새 판 · 판 기록 · 감사.' })
  @ApiParam({ name: 'code', enum: MAIL_CODES })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 메일 종류', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'CSX_TPL_SAME', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'CSX_TPL_CHECK · CSX_TPL_NOTE', type: ErrorDto })
  @Audit('CSX_MAIL_TPL_SAVE', 'MAIL_TEMPLATE')
  mailTplSave(@Param('code') code: string, @Body() dto: CsxMailTplSaveDto) { return mailTemplateSave(this.db, code, { subject: dto.subject, body: dto.body, note: dto.note }); }

  @Post('admin/csx/mail-templates/:code/revert')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '메일 문구 지난 판으로 (v10.530 · SUPER)', description: '그 판 글을 새 판으로 저장(기록은 그대로).' })
  @ApiParam({ name: 'code', enum: MAIL_CODES })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 메일 종류 · 판', type: ErrorDto })
  @ApiResponse({ status: 409, description: '없음(쓰지 않음)', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'CSX_TPL_CHECK · CSX_TPL_NOTE', type: ErrorDto })
  @Audit('CSX_MAIL_TPL_REVERT', 'MAIL_TEMPLATE')
  mailTplRevert(@Param('code') code: string, @Body() dto: CsxMailTplRevertDto) { return mailTemplateRevert(this.db, code, { version: dto.version, note: dto.note }); }

  @Post('admin/csx/mail-templates/:code/reset')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '메일 문구 코드 기본값으로 (v10.530 · SUPER)', description: '고친 문구를 끄고 코드 기본 문구로 보냄 · 판 기록 RESET.' })
  @ApiParam({ name: 'code', enum: MAIL_CODES })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 메일 종류', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'CSX_TPL_DEFAULT', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'CSX_TPL_NOTE', type: ErrorDto })
  @Audit('CSX_MAIL_TPL_RESET', 'MAIL_TEMPLATE')
  mailTplReset(@Param('code') code: string, @Body() dto: CsxMailTplResetDto) { return mailTemplateReset(this.db, code, { note: dto.note }); }

  /* ── v10.531 계정 합치기 ── */
  @Get('admin/csx/merges')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '계정 합치기 요청 · 기록 (v10.531)', description: '최근 100건 · 상태별 수 · 가린 메일 · 계획 · 결과 · 되돌릴 수 없음 안내.' })
  @ApiQuery({ name: 'state', enum: MERGE_STATES, required: false })
  @ApiOkResponse({ type: Object })
  merges(@Query('state') state?: string) { return mergeList(this.db, state); }

  @Get('admin/csx/merges/find')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '합칠 계정 찾기 (v10.531)', description: '메일 주소 전체가 같은 계정 하나 — 가린 메일 · 이름 첫 글자 · 상태 · 본인인증 방식. 부분 찾기 없음.' })
  @ApiQuery({ name: 'email', required: true })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 계정', type: ErrorDto })
  mergeFind(@Query('email') email: string) { return mergeFindAccount(this.db, email); }

  @Post('admin/csx/merges/check')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '합치기 미리 확인 (v10.531)', description: '본인인증 일치 · 막는 까닭(blockers) · 옮길 것(moves) · 남길 것(keeps). 바꾸는 것 없음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 계정', type: ErrorDto })
  @ApiResponse({ status: 409, description: '없음(쓰지 않음 · 읽기만)', type: ErrorDto })
  @ApiResponse({ status: 422, description: '없음(막는 까닭은 blockers 로 돌려줌)', type: ErrorDto })
  mergePre(@Body() dto: CsxMergeCheckDto) { return mergeCheck(this.db, dto.sourceId, dto.targetId); }

  @Post('admin/csx/merges')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '계정 합치기 요청 (v10.531)', description: '스위치 csx.account_merge · 미리 확인 통과해야 · 사유 · 요청한 사람이 아닌 SUPER 가 승인.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 계정', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'CSX_MERGE_OPEN', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'CSX_MERGE_OFF · CSX_MERGE_BLOCKED · CSX_REASON', type: ErrorDto })
  mergeCreate(@Body() dto: CsxMergeCreateDto) { return mergeRequest(this.db, me(), { sourceId: dto.sourceId, targetId: dto.targetId, reason: dto.reason }); }

  @Post('admin/csx/merges/:id/approve')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '계정 합치기 승인 = 실행 (v10.531 · SUPER)', description: '되돌릴 수 없음 — 확인 글자 「합치기」 · 요청한 사람이 아닌 SUPER · 다시 확인 뒤 한 번에(DB 함수 fn_csx_merge_execute) · 실패하면 요청은 FAILED.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 요청', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'CSX_MERGE_STATE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'CSX_MERGE_CONFIRM · CSX_MERGE_SELF · CSX_MERGE_BLOCKED · CSX_MERGE_OFF · CSX_MERGE_SUPER', type: ErrorDto })
  mergeOk(@Param('id', ParseIntPipe) id: number, @Body() dto: CsxMergeApproveDto) { return mergeApprove(this.db, me(), id, { confirm: dto.confirm, note: dto.note }); }

  @Post('admin/csx/merges/:id/reject')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '계정 합치기 반려 (v10.531 · SUPER)', description: '사유 2 ~ 300자.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 요청', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'CSX_MERGE_STATE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'CSX_REASON', type: ErrorDto })
  mergeNo(@Param('id', ParseIntPipe) id: number, @Body() dto: CsxMergeRejectDto) { return mergeReject(this.db, me(), id, { note: dto.note }); }

  @Post('admin/csx/merges/:id/cancel')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '계정 합치기 요청 취소 (v10.531)', description: '요청한 사람 또는 SUPER · 열린 요청만.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 요청', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'CSX_MERGE_STATE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'CSX_MERGE_OWNER', type: ErrorDto })
  mergeDrop(@Param('id', ParseIntPipe) id: number) { return mergeCancel(this.db, me(), id); }
}
