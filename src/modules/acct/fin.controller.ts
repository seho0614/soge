import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { ExportGate } from '../admin/export-approval';
import { cardLimitsView, setCardLimit } from './cardlimit';
import { addTransferItems, approveTransfer, cancelTransfer, checkTransfer, createTransfer, listTransfers, removeTransferItem, sendTransfer, transferDetail, TRANSFER_STATES } from './transfer';
import { setTarget, targetsView, TARGET_AXES } from './salestarget';
import { partyLedger, partyLedgerCsv, partyLedgerSummary } from './partyledger';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * v10.453 ~ 456 (D261 · docs/590 ~ 593) 자금 · 영업 — 대표 11/20 「㉘ · ㉙」
 *   v10.453  GET /admin/acct/card-limits?ym= · PUT /admin/acct/card-limits/{tail}(SUPER)
 *   v10.454  GET /admin/fin/transfers · GET /fin/transfers/{id} · POST /fin/transfers · /{id}/items · /{id}/items/{itemId}/remove · /{id}/approve · /{id}/send · /{id}/check · /{id}/cancel
 *            (/admin/fin 아래 — 세무사(ACCOUNTANT) 읽기 규칙(/admin/acct/ 만)에 들지 않게: 받는 분 · 계좌 끝 4자리가 있어서)
 *   v10.455  GET /admin/acct/sales-targets?ym= · PUT /admin/acct/sales-targets(SUPER)
 *   v10.456  GET /admin/acct/party-ledger?from=&to= · GET /party-ledger/{id} · GET /party-ledger/{id}/export(내려받기 승인 ACCT_LEDGER)
 *   보기 · 이체 만들기 · 승인 · 보내기 SUPER · PAYOUT · 한도 · 목표 정하기 SUPER.
 * ------------------------------------------------------------------- */

const VIEW = ['SUPER', 'PAYOUT'] as const;
/* CSV — acct.controller 의 toCsv 와 같은 모양(그 파일을 부르지 않으려고 복사 · 엑셀 BOM · CRLF) */
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
};
const toCsv = (head: string[], rows: unknown[][]) => '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export class CardLimitSetDto {
  @ApiProperty({ example: '법인카드 1(대표)' }) @IsString() @Length(1, 40) name!: string;
  @ApiPropertyOptional({ format: 'uuid', description: '쓰는 사람(운영자) — 비우면 정하지 않음' }) @IsOptional() @IsString() @Matches(/^([0-9a-fA-F-]{36})?$/) holderId?: string;
  @ApiProperty({ example: 3000000, description: '달 한도(원)' }) @IsInt() @Min(1) @Max(1_000_000_000_000) monthlyLimit!: number;
  @ApiPropertyOptional({ example: true }) @IsOptional() @StrictBoolean() active?: boolean;
  @ApiProperty({ example: '11월부터 한도 300만 원' }) @IsString() @Length(2, 200) reason!: string;
}
export class TransferNewDto {
  @ApiProperty({ example: '11월 25일 거래처 대금' }) @IsString() @Length(2, 80) title!: string;
  @ApiPropertyOptional({ example: '2026-11-25', description: '지급일(오늘이나 그 뒤 · 비우면 오늘)' }) @IsOptional() @Matches(YMD) payOn?: string;
}
export class TransferItemDto {
  @ApiPropertyOptional({ example: '3', description: '거래처 번호(선택)' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) partyId?: string;
  @ApiProperty({ example: '(주)거래처' }) @IsString() @Length(1, 40) payee!: string;
  @ApiProperty({ example: '004', description: '은행 코드 숫자 3자리(금융결제원 표준)' }) @IsString() @Matches(/^[0-9]{3}$/) bankCode!: string;
  @ApiProperty({ example: '123-456-789012', description: '계좌번호(숫자 · 하이픈 · 숫자 6 ~ 20자리) — 암호문으로만 저장 · 끝 4자리만 보임' }) @IsString() @Matches(/^[0-9-]{6,24}$/) accountNo!: string;
  @ApiProperty({ example: 550000 }) @IsInt() @Min(1) @Max(1_000_000_000) amount!: number;
  @ApiPropertyOptional({ example: 'AP', description: '낸 계정(처음 AP 미지급금)' }) @IsOptional() @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,39}$/) payRole?: string;
  @ApiPropertyOptional({ example: '11월 대금', description: '받는 통장 표시(20자)' }) @IsOptional() @IsString() @Length(0, 20) memo?: string;
}
export class TransferItemsDto {
  @ApiProperty({ type: [TransferItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => TransferItemDto) items!: TransferItemDto[];
}
export class TransferApproveDto {
  @ApiPropertyOptional({ example: '계약서 · 세금계산서 확인' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class TransferCancelDto {
  @ApiProperty({ example: '금액 다시 확인' }) @IsString() @Length(2, 200) reason!: string;
}
export class SalesTargetSetDto {
  @ApiProperty({ example: '2026-12' }) @IsString() @Matches(/^[0-9]{4}-(0[1-9]|1[0-2])$/) ym!: string;
  @ApiProperty({ enum: TARGET_AXES }) @IsIn(TARGET_AXES as unknown as string[]) axis!: string;
  @ApiPropertyOptional({ example: '2', description: 'axis = DEPT 일 때 부서 번호' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) deptId?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'axis = OWNER 일 때 담당자' }) @IsOptional() @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) ownerId?: string;
  @ApiProperty({ example: 30000000 }) @IsInt() @Min(0) @Max(1_000_000_000_000) amount!: number;
  @ApiPropertyOptional({ example: '연말 행사 포함' }) @IsOptional() @IsString() @Length(0, 200) memo?: string;
  @ApiProperty({ example: '12월 사업 계획' }) @IsString() @Length(2, 200) reason!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class FinController {
  constructor(private readonly db: DatabaseService) {}

  /* ── v10.453 법인카드 한도 ── */
  @Get('acct/card-limits')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '법인카드 한도 · 사용 (v10.453)', description: '카드(끝 4자리)별 달 사용 · 한도 · 몇 % · 쓰는 사람별 합 · 한도 없는 카드 · 알림 기준(acct.card_alert_pct) · 바꾼 기록 20줄.' })
  @ApiOkResponse({ type: Object })
  async cardLimits(@Query('ym') ym?: string) { return { ...(await cardLimitsView(this.db, ym)), canEdit: (RequestCtx.get()?.actorRole ?? '') === 'SUPER' }; }

  @Put('acct/card-limits/:tail')
  @Roles('SUPER')
  @Audit('ACCT_CARD_LIMIT_SET', 'SETTING')
  @ApiParam({ name: 'tail', example: '1234', description: '카드 끝 4자리(숫자 · *) — ⑫ 카드 CSV 와 같게' })
  @ApiOperation({ summary: '법인카드 한도 넣기 · 고치기 (v10.453 · SUPER)', description: '이름 · 쓰는 사람 · 달 한도 · 쓰는지 · 사유(바꾼 기록 쌓기만).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'CARD_TAIL · CARD_NAME · CARD_LIMIT · CARD_HOLDER · ACCT_REASON' })
  setCardLimit(@Param('tail') tail: string, @Body() dto: CardLimitSetDto) { return setCardLimit(this.db, tail, dto, RequestCtx.actorId() ?? null); }

  /* ── v10.454 대량 이체 ── */
  @Get('fin/transfers')
  @Roles(...VIEW)
  @ApiQuery({ name: 'state', required: false, enum: TRANSFER_STATES })
  @ApiOperation({ summary: '대량 이체 묶음 목록 (v10.454)', description: '묶음 · 상태 · 승인 수 · 실패 줄 · 보내기 켜짐(acct.transfer) · 방식(ASSUME · LIVE) · 합계 상한 · 낸 계정 후보.' })
  @ApiOkResponse({ type: Object })
  async transfers(@Query('state') state?: string) { return { ...(await listTransfers(this.db, state)), me: RequestCtx.actorId() ?? null }; }

  @Get('fin/transfers/:id')
  @Roles(...VIEW)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '대량 이체 묶음 자세히 (v10.454)', description: '줄(받는 분 · 은행 코드 · 계좌 끝 4자리 · 금액 · 낸 계정 · 결과 · 전표) · 승인한 사람.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  transfer(@Param('id') id: string) { return transferDetail(this.db, id); }

  @Post('fin/transfers')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_TRANSFER_ADD', 'SETTING')
  @ApiOperation({ summary: '대량 이체 묶음 만들기 (v10.454)', description: 'DRAFT · 만든 사람은 승인하지 못함(다른 두 사람).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TRANSFER_TITLE · TRANSFER_DATE' })
  create(@Body() dto: TransferNewDto) { return createTransfer(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('fin/transfers/:id/items')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_TRANSFER_ADD', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '이체 줄 넣기 (v10.454)', description: 'DRAFT 만 · 한 번에 100줄 · 묶음 200줄 · 합계 acct.transfer_max · 계좌는 암호문으로만 저장.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TRANSFER_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TRANSFER_ITEMS · TRANSFER_PAYEE · TRANSFER_BANK · TRANSFER_ACCOUNT · TRANSFER_AMOUNT · TRANSFER_ROLE · TRANSFER_MAX · TRANSFER_PARTY' })
  addItems(@Param('id') id: string, @Body() dto: TransferItemsDto) { return addTransferItems(this.db, id, dto.items); }

  @Post('fin/transfers/:id/items/:itemId/remove')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_TRANSFER_ADD', 'SETTING')
  @ApiParam({ name: 'id', example: '1' }) @ApiParam({ name: 'itemId', example: '1' })
  @ApiOperation({ summary: '이체 줄 빼기 (v10.454)', description: 'DRAFT 만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TRANSFER_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  removeItem(@Param('id') id: string, @Param('itemId') itemId: string) { return removeTransferItem(this.db, id, itemId); }

  @Post('fin/transfers/:id/approve')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_TRANSFER_APPROVE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '이체 묶음 승인 (v10.454)', description: '만든 사람이 아닌 사람 · 한 사람 한 번 · 두 번째 승인에 APPROVED(DB 가 다시 확인).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TRANSFER_STATE · TRANSFER_APPROVED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TRANSFER_SELF · TRANSFER_ITEMS' })
  approve(@Param('id') id: string, @Body() dto: TransferApproveDto) { return approveTransfer(this.db, id, RequestCtx.actorId() ?? null, dto.note); }

  @Post('fin/transfers/:id/send')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_TRANSFER_SEND', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '이체 묶음 보내기 (v10.454)', description: 'APPROVED 만 · acct.transfer on · ASSUME 이면 간주 결과(전표 없음) · LIVE 는 금융결제원 오픈뱅킹(수취조회 → 이름 다르면 HOLD · 입금이체 · 처리 중 PENDING) · CHECKING → 모두 확정이면 SENT · PARTIAL · FAILED.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TRANSFER_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TRANSFER_OFF · TRANSFER_NOT_READY · TRANSFER_UPSTREAM' })
  send(@Param('id') id: string) { return sendTransfer(this.db, id, RequestCtx.actorId() ?? null); }

  @Post('fin/transfers/:id/check')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_TRANSFER_CHECK', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '이체 결과 조회 (v10.454)', description: 'CHECKING 만 · 결과 없는 줄 · PENDING 을 금융결제원 결과조회로만 확정(다시 보내지 않음) · 보낸 방식(mode)으로 묻기 · 모두 확정이면 SENT · PARTIAL · FAILED · acct.transfer 꺼져도 됨.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TRANSFER_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TRANSFER_NOT_READY' })
  check(@Param('id') id: string) { return checkTransfer(this.db, id); }

  @Post('fin/transfers/:id/cancel')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_TRANSFER_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '이체 묶음 취소 (v10.454)', description: '보내기 전(DRAFT · APPROVED)만 · 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TRANSFER_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TRANSFER_REASON' })
  cancel(@Param('id') id: string, @Body() dto: TransferCancelDto) { return cancelTransfer(this.db, id, dto.reason); }

  /* ── v10.455 매출 목표 ── */
  @Get('acct/sales-targets')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '매출 목표 대비 실적 (v10.455)', description: '전체 · 부서(부서 손익과 같은 셈) · 담당자(만든 거래명세서 중 그 달 확정 공급가) 목표 · 실적 · 달성률 · 바꾼 기록.' })
  @ApiOkResponse({ type: Object })
  async targets(@Query('ym') ym?: string) { return { ...(await targetsView(this.db, ym)), canEdit: (RequestCtx.get()?.actorRole ?? '') === 'SUPER' }; }

  @Put('acct/sales-targets')
  @Roles('SUPER')
  @Audit('ACCT_TARGET_SET', 'SETTING')
  @ApiOperation({ summary: '매출 목표 정하기 (v10.455 · SUPER)', description: '달 · 전체 / 부서 / 담당자 · 금액 · 사유(바꾼 기록 쌓기만).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TARGET_YM · TARGET_AXIS · TARGET_AMOUNT · TARGET_DEPT · TARGET_OWNER · ACCT_REASON' })
  setTarget(@Body() dto: SalesTargetSetDto) { return setTarget(this.db, dto, RequestCtx.actorId() ?? null); }

  /* ── v10.456 거래처별 원장 ── */
  @Get('acct/party-ledger')
  @Roles(...VIEW)
  @ApiQuery({ name: 'from', required: false, example: '2026-11-01' }) @ApiQuery({ name: 'to', required: false, example: '2026-11-30' })
  @ApiOperation({ summary: '거래처별 원장 요약 (v10.456)', description: '전표 거래처 이름별 받을 돈 · 갚을 돈 기초 · 늘어남 · 줄어듦 · 기말 · 대장에 없는 이름 표시.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_DATE' })
  partySummary(@Query('from') from?: string, @Query('to') to?: string) { return partyLedgerSummary(this.db, from, to); }

  @Get('acct/party-ledger/:id/export')
  @Roles(...VIEW)
  @ExportGate('ACCT_LEDGER')
  @ApiParam({ name: 'id', example: '1' })
  @ApiQuery({ name: 'from', required: false, example: '2026-11-01' }) @ApiQuery({ name: 'to', required: false, example: '2026-11-30' })
  @ApiOperation({ summary: '거래처별 원장 CSV (v10.456 · 내려받기 승인)', description: '기초 · 줄 · 기말 — 거래처 이름 · 금액이 들어가 승인 필요(ACCT_LEDGER).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL · ACCT_DATE' })
  async partyExport(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    const r = await partyLedger(this.db, id, from, to);
    const { head, body } = partyLedgerCsv(r);
    return { filename: `party-ledger-${r.party.id}-${r.from}-${r.to}.csv`, csv: toCsv(head, body), rows: r.rows.length, note: `${r.party.name} 원장 ${r.rows.length}줄을 내려받았습니다.` };
  }

  @Get('acct/party-ledger/:id')
  @Roles(...VIEW)
  @ApiParam({ name: 'id', example: '1' })
  @ApiQuery({ name: 'from', required: false, example: '2026-11-01' }) @ApiQuery({ name: 'to', required: false, example: '2026-11-30' })
  @ApiOperation({ summary: '거래처별 원장 (v10.456)', description: '한 거래처의 받을 돈 · 갚을 돈 줄(날짜 · 전표 · 늘어남 · 줄어듦 · 잔액) · 기초 · 기말.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_DATE' })
  party(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) { return partyLedger(this.db, id, from, to); }
}
