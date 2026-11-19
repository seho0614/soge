import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { DOC_KINDS, STEP_ROLES, approvalStatus, inbox, listLines, setLines, stepDecide } from './approval';
import { budgetPeriod, setYearBudget } from './budget-period';
import { CORP_DOC_CATS, addCorpDoc, addCorpDocVersion, archiveCorpDoc, corpDocVersions, listCorpDocs } from '../admin/corpdocs';

/* ---------------------------------------------------------------------
 * ⑳ (D253 · docs/561 ~ 564) 결재선 · 사내 문서함 · 분기 · 연 예산
 *   v10.424  GET   /admin/acct/approvals/inbox                    내 결재함(중간 단계 · 마지막 SUPER 단계)
 *            GET   /admin/acct/approvals/{kind}/{id}              문서 하나 결재선 · 진행
 *            POST  /admin/acct/approvals/{kind}/{id}/step         중간 단계 결재 · 반려(운영자 · 감사 APV_STEP)
 *            GET   /admin/acct/approval-lines · PUT /admin/acct/approval-lines   결재선(보기 운영자 · 고치기 SUPER · 사유 · 감사 APV_LINE_SET)
 *   v10.425  GET   /admin/corp-docs · GET /admin/corp-docs/{id}   사내 문서함 · 판(SUPER · ADMIN · PAYOUT)
 *            POST  /admin/corp-docs · POST /admin/corp-docs/{id}/versions   문서 · 새 판(SUPER · ADMIN · 감사 CORP_DOC_ADD · CORP_DOC_VERSION)
 *            POST  /admin/corp-docs/{id}/archive                  보관 끝(SUPER · 사유 · 감사 CORP_DOC_ARCHIVE)
 *   v10.427  GET   /admin/acct/budget/period?year=                분기 · 연 · 누계(SUPER · PAYOUT)
 *            POST  /admin/acct/budget/year                        연 목표 → 달로 나눠 넣기(SUPER · 사유 · 감사 ACCT_BUDGET_YEAR)
 * ------------------------------------------------------------------- */

const STAFF = ['ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'] as const;   // SUPER 는 늘 통과
async function rolesOf(db: DatabaseService, id: string | null) {
  if (!id) return [];
  return (await db.query<{ role: string }>(`SELECT role FROM account_roles WHERE account_id = $1`, [id])).map((r) => r.role);
}

export class ApvStepDto {
  @ApiProperty({ description: '결재(true) · 반려(false)' }) @IsBoolean() approve!: boolean;
  @ApiPropertyOptional({ example: '금액 확인함' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
}
export class ApvLineStepDto {
  @ApiPropertyOptional({ enum: STEP_ROLES, description: '역할(사람과 둘 중 하나)' }) @IsOptional() @IsIn(STEP_ROLES as unknown as string[]) role?: string;
  @ApiPropertyOptional({ format: 'uuid', description: '지정 사람(역할과 둘 중 하나)' }) @IsOptional() @IsUUID() account?: string;
}
export class ApvLineDto {
  @ApiPropertyOptional({ example: 1000000, description: '금액 상한(비우면 그 위 전부)' }) @IsOptional() @IsInt() @Min(1) @Max(100000000000) upto?: number | null;
  @ApiProperty({ type: [ApvLineStepDto] }) @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => ApvLineStepDto) steps!: ApvLineStepDto[];
}
export class ApvLinesSetDto {
  @ApiProperty({ enum: DOC_KINDS }) @IsIn(DOC_KINDS as unknown as string[]) docKind!: string;
  @ApiProperty({ type: [ApvLineDto] }) @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => ApvLineDto) lines!: ApvLineDto[];
  @ApiProperty({ example: '100만 원 넘으면 팀장 먼저' }) @IsString() @Length(1, 400) reason!: string;
}
export class CorpDocAddDto {
  @ApiProperty({ enum: CORP_DOC_CATS }) @IsIn(CORP_DOC_CATS as unknown as string[]) category!: string;
  @ApiProperty({ example: '법인 등기부등본(2026)' }) @IsString() @Length(2, 100) title!: string;
  @ApiPropertyOptional({ example: '등기소 발급' }) @IsOptional() @IsString() @Length(0, 400) memo?: string;
  @ApiProperty({ format: 'uuid', description: 'POST /files(CORP_DOC)로 올린 파일' }) @IsUUID() fileId!: string;
  @ApiPropertyOptional({ example: '2026-11-19' }) @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) issuedOn?: string;
  @ApiPropertyOptional({ example: '2027-11-18' }) @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) expiresOn?: string;
  @ApiPropertyOptional({ example: '첫 판' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class CorpDocVersionDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() fileId!: string;
  @ApiPropertyOptional({ example: '2027-11-19' }) @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) issuedOn?: string;
  @ApiPropertyOptional({ example: '2028-11-18' }) @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) expiresOn?: string;
  @ApiPropertyOptional({ example: '갱신' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class CorpDocArchiveDto {
  @ApiProperty({ example: '사업장 이전으로 옛 등기부' }) @IsString() @Length(1, 400) reason!: string;
}
export class BudgetYearItemDto {
  @ApiProperty({ example: 'EXP_RENT' }) @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,39}$/) role!: string;
  @ApiProperty({ example: 36000000 }) @IsInt() @Min(0) @Max(10000000000000) amount!: number;
}
export class BudgetYearDto {
  @ApiProperty({ example: 2027 }) @IsInt() @Min(2020) @Max(2100) year!: number;
  @ApiProperty({ type: [BudgetYearItemDto] }) @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => BudgetYearItemDto) items!: BudgetYearItemDto[];
  @ApiPropertyOptional({ enum: ['EVEN', 'LAST_YEAR'] }) @IsOptional() @IsIn(['EVEN', 'LAST_YEAR']) split?: string;
  @ApiPropertyOptional({ example: 1, description: '나눠 넣기 시작 달(올해는 이번 달 앞으로)' }) @IsOptional() @IsInt() @Min(1) @Max(12) fromMonth?: number;
  @ApiProperty({ example: '2027 사업계획' }) @IsString() @Length(1, 400) reason!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class AcctOfficeController {
  constructor(private readonly db: DatabaseService) {}

  /* ── v10.424 결재선 ── */
  @Get('acct/approvals/inbox')
  @Roles(...STAFF)
  @ApiOperation({ summary: '내 결재함 (v10.424)', description: '내 결재 차례인 품의 · 경비 청구 · 수동 전표 — 중간 단계 · 마지막(SUPER) 단계.' })
  @ApiOkResponse({ type: Object })
  async inbox() { const me = RequestCtx.actorId() ?? ''; return inbox(this.db, me, await rolesOf(this.db, me)); }

  @Get('acct/approvals/:kind/:id')
  @Roles(...STAFF)
  @ApiParam({ name: 'kind', enum: DOC_KINDS }) @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '결재 진행 (v10.424)', description: '문서 하나의 결재선 · 차례 · 기록.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'APV_KIND' })
  status(@Param('kind') kind: string, @Param('id') id: string) { return approvalStatus(this.db, kind, id); }

  @Post('acct/approvals/:kind/:id/step')
  @Roles(...STAFF)
  @HttpCode(200)
  @Audit('APV_STEP', 'SETTING')
  @ApiParam({ name: 'kind', enum: DOC_KINDS }) @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '중간 단계 결재 (v10.424)', description: '내 차례 단계를 결재 · 반려(사유). 본인 문서 · 같은 사람 두 단계 불가(DB). 마지막 단계는 각 화면의 SUPER 승인 · 반려.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'APV_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'APV_SELF · APV_WHO · APV_LAST · APV_NO_LINE · APV_REASON · APV_DUP · APV_ORDER' })
  async step(@Param('kind') kind: string, @Param('id') id: string, @Body() dto: ApvStepDto) {
    const me = RequestCtx.actorId()!; return stepDecide(this.db, kind, id, dto, me, await rolesOf(this.db, me));
  }

  @Get('acct/approval-lines')
  @Roles(...STAFF)
  @ApiOperation({ summary: '결재선 (v10.424)', description: '종류(품의 · 경비 청구 · 수동 전표)마다 금액 구간 · 단계 · 바꾼 기록 · 고를 사람.' })
  @ApiOkResponse({ type: Object })
  lines() { return listLines(this.db); }

  @Put('acct/approval-lines')
  @Roles('SUPER')
  @Audit('APV_LINE_SET', 'SETTING')
  @ApiOperation({ summary: '결재선 정하기 (v10.424 · SUPER)', description: '종류 하나의 구간 전체를 바꿈(빈 목록 = 지움 = SUPER 한 번) · 마지막 단계 SUPER · 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'APV_LINE · APV_LINE_LAST · ACCT_REASON' })
  setLines(@Body() dto: ApvLinesSetDto) { return setLines(this.db, dto, RequestCtx.actorId() ?? null); }

  /* ── v10.425 사내 문서함 ── */
  @Get('corp-docs')
  @Roles('ADMIN', 'PAYOUT')
  @ApiQuery({ name: 'state', required: false, enum: ['ACTIVE', 'ARCHIVED'] }) @ApiQuery({ name: 'category', required: false, enum: CORP_DOC_CATS })
  @ApiOperation({ summary: '사내 문서함 (v10.425)', description: '문서마다 가장 최근 판 · 만료 · 남은 날 · 만료 다가옴.' })
  @ApiOkResponse({ type: Object })
  corpDocs(@Query('state') state?: string, @Query('category') category?: string) { return listCorpDocs(this.db, { state, category }); }

  @Get('corp-docs/:id')
  @Roles('ADMIN', 'PAYOUT')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사내 문서 판 (v10.425)', description: '판마다 파일 · 발급일 · 만료일 · 올린 사람(옛 판 보관).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  corpDoc(@Param('id') id: string) { return corpDocVersions(this.db, id); }

  @Post('corp-docs')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('CORP_DOC_ADD', 'SETTING')
  @ApiOperation({ summary: '사내 문서 넣기 (v10.425)', description: '분류 · 제목 · 첫 판 파일(CORP_DOC) · 발급일 · 만료일.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'CORP_DOC · CORP_DOC_DATE · CORP_DOC_FILE' })
  addDoc(@Body() dto: CorpDocAddDto) { return addCorpDoc(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('corp-docs/:id/versions')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('CORP_DOC_VERSION', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사내 문서 새 판 (v10.425)', description: '새 판(옛 판 보관) · 만료 알림은 그 자리에서 풀림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'CORP_DOC · CORP_DOC_DATE · CORP_DOC_FILE' })
  addVersion(@Param('id') id: string, @Body() dto: CorpDocVersionDto) { return addCorpDocVersion(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Post('corp-docs/:id/archive')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('CORP_DOC_ARCHIVE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사내 문서 보관 끝 (v10.425 · SUPER)', description: '지우지 않고 보관 끝으로(사유 · 되돌리지 않음 · 파일 · 판은 남음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_REASON' })
  archive(@Param('id') id: string, @Body() dto: CorpDocArchiveDto) { return archiveCorpDoc(this.db, id, dto.reason); }

  /* ── v10.427 분기 · 연 예산 ── */
  @Get('acct/budget/period')
  @Roles('PAYOUT')
  @ApiQuery({ name: 'year', required: false, example: 2026 })
  @ApiOperation({ summary: '분기 · 연 예산 (v10.427)', description: '계정마다 달 · 분기 · 연 예산과 실적 · 누계(1월 ~ 이번 달) · 차이.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_YEAR' })
  period(@Query('year') year?: string) { return budgetPeriod(this.db, year); }

  @Post('acct/budget/year')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_BUDGET_YEAR', 'SETTING')
  @ApiOperation({ summary: '연 목표 나눠 넣기 (v10.427 · SUPER)', description: '계정마다 연 목표를 달로(똑같이 · 지난해 비율) · 시작 달부터 · 달 예산(바꾼 기록 · 넘음 알림) 그대로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_YEAR · ACCT_BUDGET · ACCT_REASON' })
  setYear(@Body() dto: BudgetYearDto) { return setYearBudget(this.db, dto, RequestCtx.actorId() ?? null); }
}
