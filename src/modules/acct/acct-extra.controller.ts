import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { NotFound } from '../../core/errors';
const idOk = (id: string) => { if (!/^\d{1,18}$/.test(String(id))) throw new NotFound('없는 기록입니다.'); return id; };   // 숫자 아니면 404(500 막기)
import { DatabaseService } from '../../db/database.service';
import { AgentService } from '../agent/agent.service';
import { ExportGate } from '../admin/export-approval';
import { accountantDesk, addAccountantNote, replyAccountantNote } from './accountant';
import { readReceipt, receiptReads } from './receipt-ai';
import { accrualView, matchAccrual, setAccrualRule } from './accrual';
import { archiveExport, archiveList, controlReport, makeArchive } from './archive';

/* ---------------------------------------------------------------------
 * ㉔ (D257 · docs/574 ~ 577) 회계 덧붙임 — 대표 11/19 「다음개발」
 *   v10.437  GET   /admin/acct/accountant?ym=                 세무사: 내 기한 · 질문 / SUPER · 지급 담당: 세무사 계정 · 접속 기록 · 질문
 *            POST  /admin/acct/accountant/notes                질문 남기기(세무사 · 감사 ACCT_ACCOUNTANT_NOTE)
 *            POST  /admin/acct/accountant/notes/{id}/reply     답(SUPER · 감사 ACCT_ACCOUNTANT_REPLY)
 *   v10.438  POST  /admin/acct/receipt-ai/read                 영수증 사진 읽기 → 칸 채움 제안(SUPER · PAYOUT · 저장 안 함)
 *            GET   /admin/acct/receipt-ai/reads?fileId=        읽은 기록
 *   v10.439  GET   /admin/acct/accruals?ym=                    고정비 — 계약 · 규칙 · 그 달 줄 · 맞추지 못한 줄
 *            PUT   /admin/acct/accruals/rules/{contractId}     규칙(비용 계정 · 부가세 포함 · 켜기 · SUPER · 감사 ACCT_ACCRUAL_RULE)
 *            POST  /admin/acct/accruals/{id}/match             매입 맞춤(SUPER · 감사 ACCT_ACCRUAL_MATCH)
 *   v10.440  GET   /admin/acct/archives · POST /admin/acct/archives   장부 보관 기록 · 만들기(SUPER · 해 마감 뒤 · 감사 ACCT_ARCHIVE_MAKE)
 *            GET   /admin/acct/archives/{id}/export?ticket=    전표 CSV + 증빙 목록 CSV(내려받기 승인 ACCT_ARCHIVE)
 *            GET   /admin/acct/control?ym=                     내부통제 보고(계산만)
 *   보기 SUPER · PAYOUT(세무사는 core/auth 가 GET 만 열어 줌).
 * ------------------------------------------------------------------- */

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export class AccountantNoteDto {
  @ApiProperty({ example: '2026-11' }) @Matches(YM_RE) ym!: string;
  @ApiPropertyOptional({ example: '123', description: '전표 번호(선택)' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) entryId?: string;
  @ApiProperty({ example: '11월 지급수수료 증빙을 확인해 주십시오.' }) @IsString() @Length(2, 1000) body!: string;
}
export class AccountantReplyDto {
  @ApiProperty({ example: '세금계산서를 붙였습니다.' }) @IsString() @Length(1, 1000) body!: string;
}
export class ReceiptReadDto {
  @ApiProperty({ format: 'uuid', description: '증빙 파일(ACCT_EVIDENCE · JPG · PNG)' }) @IsString() @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) fileId!: string;
}
export class AccrualRuleDto {
  @ApiPropertyOptional({ example: 'EXP_RENT', description: '비용 계정(비우면 계약 종류로 · 임대 → 지급임차료 · 그 밖 → 지급수수료 · 잡비)' }) @IsOptional() @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,39}$/) accountRole?: string;
  @ApiPropertyOptional({ description: '달 금액이 부가세 포함(처음 예 — ÷ 1.1 을 비용으로)' }) @IsOptional() @IsBoolean() vatIncluded?: boolean;
  @ApiPropertyOptional({ description: '이 계약 고정비 전표 켜기(처음 예)' }) @IsOptional() @IsBoolean() enabled?: boolean;
}
export class AccrualMatchDto {
  @ApiProperty({ example: '42', description: '맞출 매입 번호' }) @IsString() @Matches(/^\d{1,18}$/) purchaseId!: string;
}
export class ArchiveMakeDto {
  @ApiProperty({ example: 2026 }) @IsInt() @Min(2000) @Max(2100) year!: number;
  @ApiPropertyOptional({ example: '세무사 결산 끝' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/acct')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class AcctExtraController {
  constructor(private readonly db: DatabaseService, private readonly agent: AgentService) {}

  /* ── v10.437 세무사 공유 계정 ── */
  @Get('accountant')
  @Roles('PAYOUT', 'ACCOUNTANT')
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '세무사 공유 계정 (v10.437)', description: '세무사: 내 기한 · 내 질문 · 답 / SUPER · 지급 담당: 세무사 계정 · 기한 · 최근 접속 · 질문 모두.' })
  @ApiOkResponse({ type: Object })
  accountant(@Query('ym') ym?: string) { return accountantDesk(this.db, RequestCtx.actorId() ?? null, ym); }

  @Post('accountant/notes')
  @Roles('ACCOUNTANT')
  @HttpCode(200)
  @Audit('ACCT_ACCOUNTANT_NOTE', 'SETTING')
  @ApiOperation({ summary: '세무사 질문 남기기 (v10.437)', description: '달 · 전표(선택)마다 질문 · 쌓기만 · SUPER 가 답.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCOUNTANT_NOTE' })
  addNote(@Body() dto: AccountantNoteDto) { return addAccountantNote(this.db, RequestCtx.actorId() ?? null, dto); }

  @Post('accountant/notes/:id/reply')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_ACCOUNTANT_REPLY', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '세무사 질문에 답 (v10.437 · SUPER)', description: '쌓기만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCOUNTANT_NOTE' })
  reply(@Param('id') id: string, @Body() dto: AccountantReplyDto) { return replyAccountantNote(this.db, RequestCtx.actorId() ?? null, idOk(id), dto.body); }

  /* ── v10.438 영수증 사진 자동 입력 ── */
  @Post('receipt-ai/read')
  @Roles('PAYOUT')
  @HttpCode(200)
  @ApiOperation({ summary: '영수증 사진 읽기 (v10.438)', description: '증빙 그림에서 날짜 · 공급자 · 사업자번호 · 공급가 · 부가세 · 합계 · 종류 제안 — 저장하지 않음(사람이 확인 뒤 매입 · 경비로). 스위치 acct.receipt_ai · 방식 ASSUME | AI.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'RECEIPT_AI_BLOCKED · RECEIPT_AI_NO_KEY · RECEIPT_AI_FAILED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'RECEIPT_AI_OFF · RECEIPT_IMAGE_ONLY · RECEIPT_TOO_BIG' })
  read(@Body() dto: ReceiptReadDto) { return readReceipt(this.db, this.agent, dto.fileId, RequestCtx.actorId() ?? null); }

  @Get('receipt-ai/reads')
  @Roles('PAYOUT')
  @ApiQuery({ name: 'fileId', required: false })
  @ApiOperation({ summary: '영수증 읽은 기록 (v10.438)', description: '최근 30 · 스위치 · 방식.' })
  @ApiOkResponse({ type: Object })
  reads(@Query('fileId') fileId?: string) { return receiptReads(this.db, fileId); }

  /* ── v10.439 고정비 자동 전표 ── */
  @Get('accruals')
  @Roles('PAYOUT')
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '고정비 자동 전표 (v10.439)', description: '계약마다 규칙 · 그 달 줄 · 맞춤 · 맞추지 못한 지난 줄.' })
  @ApiOkResponse({ type: Object })
  accruals(@Query('ym') ym?: string) { return accrualView(this.db, ym); }

  @Put('accruals/rules/:contractId')
  @Roles('SUPER')
  @Audit('ACCT_ACCRUAL_RULE', 'SETTING')
  @ApiParam({ name: 'contractId', example: '1' })
  @ApiOperation({ summary: '고정비 규칙 (v10.439 · SUPER)', description: '비용 계정(EXPENSE · DB 가 막음 ACCRUAL_ROLE) · 부가세 포함 · 켜기. 다음 달 줄부터.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCRUAL_ROLE' })
  rule(@Param('contractId') contractId: string, @Body() dto: AccrualRuleDto) { return setAccrualRule(this.db, contractId, dto, RequestCtx.actorId() ?? null); }

  @Post('accruals/:id/match')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_ACCRUAL_MATCH', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '고정비 매입 맞춤 (v10.439 · SUPER)', description: '그 달 매입을 골라 맞춤 → 다음 전표 작업에서 미지급 비용 되돌림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCRUAL_MATCHED · ACCRUAL_PURCHASE_USED' })
  match(@Param('id') id: string, @Body() dto: AccrualMatchDto) { return matchAccrual(this.db, idOk(id), dto.purchaseId); }

  /* ── v10.440 장부 보관 · 내부통제 ── */
  @Get('archives')
  @Roles('PAYOUT')
  @ApiOperation({ summary: '장부 보관 기록 (v10.440)', description: '해마다 보관 판 · 전표 · 줄 · 증빙 수 · sha256 · 바뀜 · 마감한 해.' })
  @ApiOkResponse({ type: Object })
  archives() { return archiveList(this.db); }

  @Post('archives')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_ARCHIVE_MAKE', 'SETTING')
  @ApiOperation({ summary: '장부 보관 만들기 (v10.440 · SUPER)', description: '해 마감한 해만 · 전표 CSV · 증빙 목록 지문 · 쌓기만(같은 해 다시 만들면 새 판).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ARCHIVE_NOT_CLOSED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ARCHIVE_YEAR' })
  makeArchive(@Body() dto: ArchiveMakeDto) { return makeArchive(this.db, dto.year, dto.note, RequestCtx.actorId() ?? null); }

  @Get('archives/:id/export')
  @Roles('PAYOUT')
  @ExportGate('ACCT_ARCHIVE')
  @ApiParam({ name: 'id', example: '1' })
  @ApiQuery({ name: 'ticket', required: false })
  @ApiOperation({ summary: '장부 보관 내려받기 (v10.440 · 내려받기 승인)', description: '그 해 전표 CSV · 증빙 목록 CSV · 지금 장부가 보관 때와 같은지(sha256).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL' })
  archiveExport(@Param('id') id: string) { return archiveExport(this.db, idOk(id)); }

  @Get('control')
  @Roles('PAYOUT')
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '내부통제 보고 (v10.440)', description: '그 달 규칙 바꿈 · 해 마감 풀기 · 늦은 전표 · 수동 전표 · 큰 금액 · 권한 바뀜 · 회계 내려받기 · 세무사 접속 · 통장 맞출 것 없음.' })
  @ApiOkResponse({ type: Object })
  control(@Query('ym') ym?: string) { return controlReport(this.db, ym); }
}
