/* e3 (docs/010) 소개뱅크 src/modules/acct/sales.controller.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { addOppNote, createOpp, linkOppQuote, listOpps, oppDetail, OPP_STAGES, setOppStage, updateOpp } from './crm';
import { addFeedAccount, bankFeedView, runBankFeed, setFeedAccount } from './bankfeed';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * v10.466 · 467 (D264 · docs/604 · 605) 영업 · 자금 — 대표 11/20 「㉝」
 *   v10.466  GET /admin/sales/opps · GET /sales/opps/{id} · POST /sales/opps · PUT /sales/opps/{id} · POST /sales/opps/{id}/stage · /{id}/quote · /{id}/note
 *            (/admin/sales 아래 — 세무사(ACCOUNTANT) 읽기 규칙(/admin/acct/ 만)에 들지 않게: 거래처 담당자 · 영업 메모)
 *            SUPER · PAYOUT · ADMIN(견적 · 명세서와 같은 역할)
 *   v10.467  GET /admin/acct/bank-feed · POST /acct/bank-feed/accounts(SUPER) · PUT /acct/bank-feed/accounts/{id}(SUPER) · POST /acct/bank-feed/run
 *            SUPER · PAYOUT(세무사는 GET 만 — 계좌는 끝 4자리 · 은행 표준코드 · 이름만)
 * ------------------------------------------------------------------- */

const CRM = ['SUPER', 'PAYOUT', 'ADMIN'] as const;
const VIEW = ['SUPER', 'PAYOUT'] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YMD_OR_EMPTY = /^(\d{4}-\d{2}-\d{2})?$/;
const UUID_OR_EMPTY = /^([0-9a-fA-F-]{36})?$/;

export class SalOppNewDto {
  @ApiProperty({ example: '3', description: '거래처 번호(회계 › 거래처)' }) @IsString() @Matches(/^\d{1,18}$/) partyId!: string;
  @ApiProperty({ example: '2027년 건강검진 단체 구매' }) @IsString() @Length(2, 120) title!: string;
  @ApiPropertyOptional({ example: 12000000, description: '예상 매출(원 · 공급가 기준 권함)' }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000_000) expectedAmount?: number;
  @ApiPropertyOptional({ format: 'uuid', description: '담당(운영자) — 비우면 만든 사람' }) @IsOptional() @IsString() @Matches(UUID_OR_EMPTY) ownerId?: string;
  @ApiPropertyOptional({ example: '담당 과장 통화 — 인원 확인' }) @IsOptional() @IsString() @Length(0, 200) nextAction?: string;
  @ApiPropertyOptional({ example: '2026-11-25' }) @IsOptional() @IsString() @Matches(YMD_OR_EMPTY) nextActionOn?: string;
  @ApiPropertyOptional({ example: '2026-12-20' }) @IsOptional() @IsString() @Matches(YMD_OR_EMPTY) expectedCloseOn?: string;
  @ApiPropertyOptional({ example: '작년 거래 있음' }) @IsOptional() @IsString() @Length(0, 400) memo?: string;
}
export class SalOppEditDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000_000) expectedAmount?: number;
  @ApiPropertyOptional({ format: 'uuid', description: '빈 글자 = 담당 없음' }) @IsOptional() @IsString() @Matches(UUID_OR_EMPTY) ownerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) nextAction?: string;
  @ApiPropertyOptional({ description: '빈 글자 = 날짜 지움' }) @IsOptional() @IsString() @Matches(YMD_OR_EMPTY) nextActionOn?: string;
  @ApiPropertyOptional({ description: '빈 글자 = 날짜 지움' }) @IsOptional() @IsString() @Matches(YMD_OR_EMPTY) expectedCloseOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 400) memo?: string;
}
export class SalOppStageDto {
  @ApiProperty({ enum: OPP_STAGES }) @IsIn(OPP_STAGES as unknown as string[]) stage!: string;
  @ApiPropertyOptional({ example: '예산 보류', description: '실패 · 다시 열기는 사유 2자 이상' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class SalOppQuoteDto {
  @ApiPropertyOptional({ format: 'uuid', description: '같은 거래처 견적서 — 비우면 기회 이름 · 예상 매출로 견적서 초안을 만들어 연결' }) @IsOptional() @IsString() @Matches(UUID_OR_EMPTY) docId?: string;
}
export class SalOppNoteDto {
  @ApiProperty({ example: '11/21 방문 — 견적 요청 받음' }) @IsString() @Length(2, 400) note!: string;
}
export class BankFeedAccountNewDto {
  @ApiProperty({ example: '기업은행 운영 계좌' }) @IsString() @Length(1, 40) label!: string;
  @ApiProperty({ example: '003', description: '은행 표준코드 숫자 3자리(금융결제원)' }) @IsString() @Matches(/^[0-9]{3}$/) bankStd!: string;
  @ApiProperty({ example: '199159919057870971744807', description: '핀테크이용번호(오픈뱅킹 계좌 등록 때 받은 번호 · 숫자 20 ~ 30자리) — 암호문으로만 저장' }) @IsString() @Matches(/^[0-9 -]{20,40}$/) fintechNum!: string;
  @ApiProperty({ example: '1234', description: '계좌 끝 4자리(화면 표시용)' }) @IsString() @Matches(/^[0-9]{4}$/) last4!: string;
}
export class BankFeedAccountEditDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) label?: string;
  @ApiPropertyOptional({ description: 'false = 자동 조회 끔(기록은 그대로)' }) @IsOptional() @StrictBoolean() active?: boolean;
}
export class BankFeedRunDto {
  @ApiPropertyOptional({ example: '1', description: '한 계좌만(비우면 쓰는 계좌 모두)' }) @IsOptional() @IsString() @Matches(/^(\d{1,18})?$/) accountId?: string;
  @ApiPropertyOptional({ example: '2026-11-18', description: '비우면 오늘 − (acct.bank_feed_days − 1)' }) @IsOptional() @IsString() @Matches(YMD) from?: string;
  @ApiPropertyOptional({ example: '2026-11-20', description: '비우면 오늘' }) @IsOptional() @IsString() @Matches(YMD) to?: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class SalesController {
  constructor(private readonly db: DatabaseService) {}

  /* ── v10.466 영업 기회 CRM ── */
  @Get('sales/opps')
  @Roles(...CRM)
  @ApiQuery({ name: 'stage', required: false, description: 'LEAD · QUOTE · CONTRACT · WON · LOST · OPEN(열린 것)' })
  @ApiQuery({ name: 'owner', required: false, description: '담당 계정 id' }) @ApiQuery({ name: 'q', required: false, description: '이름 · 거래처 찾기' })
  @ApiOperation({ summary: '영업 기회 목록 · 파이프라인 (v10.466)', description: '기회(거래처 · 단계 · 예상 매출 · 담당 · 다음 할 일 · 견적서) · 단계별 건수 · 예상 · 가중 매출 · 이번 달 성사 · 90일 성사율 · 거래처 · 담당 후보.' })
  @ApiOkResponse({ type: Object })
  opps(@Query('stage') stage?: string, @Query('owner') owner?: string, @Query('q') q?: string) { return listOpps(this.db, { stage, owner, q }); }

  @Get('sales/opps/:id')
  @Roles(...CRM)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '영업 기회 자세히 (v10.466)', description: '기회 · 기록(쌓기만) · 연결한 견적서 · 같은 거래처 견적서 후보.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  opp(@Param('id') id: string) { return oppDetail(this.db, id); }

  @Post('sales/opps')
  @Roles(...CRM)
  @HttpCode(200)
  @Audit('SAL_OPP_ADD', 'SETTING')
  @ApiOperation({ summary: '영업 기회 만들기 (v10.466)', description: '상담(LEAD) 단계로 · 담당 비우면 만든 사람.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SAL_TITLE · SAL_PARTY · SAL_OWNER · SAL_AMOUNT · SAL_DATE' })
  create(@Body() dto: SalOppNewDto) { return createOpp(this.db, dto, RequestCtx.actorId() ?? null); }

  @Put('sales/opps/:id')
  @Roles(...CRM)
  @Audit('SAL_OPP_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '영업 기회 고치기 (v10.466)', description: '열린 기회만 · 보낸 칸만 바꿈(안 보낸 칸은 그대로) · 기록 EDIT.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SAL_OPP_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SAL_EMPTY · SAL_TITLE · SAL_OWNER · SAL_AMOUNT · SAL_DATE' })
  edit(@Param('id') id: string, @Body() dto: SalOppEditDto) { return updateOpp(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Post('sales/opps/:id/stage')
  @Roles(...CRM)
  @HttpCode(200)
  @Audit('SAL_OPP_STAGE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '영업 기회 단계 바꾸기 (v10.466)', description: '열린 단계끼리 앞뒤 · 성사(끝) · 실패(사유) · 실패 → 상담(다시 열기 · 사유).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SAL_OPP_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SAL_STAGE · SAL_REASON' })
  stage(@Param('id') id: string, @Body() dto: SalOppStageDto) { return setOppStage(this.db, id, dto.stage, dto.note, RequestCtx.actorId() ?? null); }

  @Post('sales/opps/:id/quote')
  @Roles(...CRM)
  @HttpCode(200)
  @Audit('SAL_OPP_QUOTE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '영업 기회에 견적서 잇기 (v10.466)', description: '같은 거래처 견적서 연결 · 비우면 견적서 초안(기회 이름 · 예상 매출 공급가 · 과세 한 줄)을 만들어 연결 · 상담이면 견적 단계로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SAL_OPP_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SAL_QUOTE · SAL_OPP_QUOTE' })
  quote(@Param('id') id: string, @Body() dto: SalOppQuoteDto) { return linkOppQuote(this.db, id, dto.docId || undefined, RequestCtx.actorId() ?? null); }

  @Post('sales/opps/:id/note')
  @Roles(...CRM)
  @HttpCode(200)
  @Audit('SAL_OPP_NOTE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '영업 기회 메모 (v10.466)', description: '통화 · 방문 기록 한 줄(쌓기만).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SAL_NOTE' })
  note(@Param('id') id: string, @Body() dto: SalOppNoteDto) { return addOppNote(this.db, id, dto.note, RequestCtx.actorId() ?? null); }

  /* ── v10.467 은행 거래내역 자동 조회 ── */
  @Get('acct/bank-feed')
  @Roles(...VIEW)
  @ApiOperation({ summary: '은행 거래내역 자동 조회 (v10.467)', description: '켜짐(acct.bank_feed) · 방식(ASSUME · LIVE) · 날 수 · 금융결제원 준비 · 등록 계좌(끝 4자리) · 최근 기록 30.' })
  @ApiOkResponse({ type: Object })
  async feed() { return { ...(await bankFeedView(this.db)), canEdit: (RequestCtx.get()?.actorRole ?? '') === 'SUPER' }; }

  @Post('acct/bank-feed/accounts')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_BANK_FEED_ACCOUNT', 'SETTING')
  @ApiOperation({ summary: '자동 조회 계좌 등록 (v10.467 · SUPER)', description: '이름 · 은행 표준코드 · 핀테크이용번호(암호문으로만 저장 · 같은 번호 두 번 안 됨) · 끝 4자리.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BANK_FEED_LABEL · BANK_FEED_BANK · BANK_FEED_FINTECH · BANK_FEED_LAST4 · BANK_FEED_DUP' })
  addAccount(@Body() dto: BankFeedAccountNewDto) { return addFeedAccount(this.db, dto, RequestCtx.actorId() ?? null); }

  @Put('acct/bank-feed/accounts/:id')
  @Roles('SUPER')
  @Audit('ACCT_BANK_FEED_ACCOUNT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '자동 조회 계좌 고치기 (v10.467 · SUPER)', description: '이름 · 쓰는지(끄면 자동 조회 안 함 · 기록 그대로) — 은행 · 번호는 못 바꿈(끄고 새로).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BANK_FEED_LABEL · ACCT_BANK_FEED' })
  setAccount(@Param('id') id: string, @Body() dto: BankFeedAccountEditDto) { return setFeedAccount(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Post('acct/bank-feed/run')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_BANK_FEED_RUN', 'SETTING')
  @ApiOperation({ summary: '은행 거래내역 지금 조회 (v10.467)', description: 'acct.bank_feed on 일 때만 · ASSUME 은 간주 2줄 · LIVE 는 금융결제원 거래내역조회 → 은행 맞추기에 들여옴(같은 줄 · CSV 로 올린 줄은 건너뜀) · 기간 31일까지.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BANK_FEED_OFF · BANK_FEED_RANGE · BANK_FEED_NO_ACCOUNT · BANK_FEED_NOT_READY' })
  run(@Body() dto: BankFeedRunDto) { return runBankFeed(this.db, dto, RequestCtx.actorId() ?? null); }
}
