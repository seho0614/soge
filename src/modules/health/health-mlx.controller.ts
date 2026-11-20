import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, Length, Matches } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { myRestock, restockCancel, restockRun, restockSubscribe, restockView } from './health-restock';
import { CR_PURPOSES, crAdminIssue, crCancel, crMine, crRequest, crRetry, crView, mallCashReceiptJob } from './health-cashrcpt';

/* ---------------------------------------------------------------------
 * v10.505 · 506 (D274 · docs/643 · 644) 소개몰 재입고 알림 · 현금영수증
 *   운영(HealthMlxController · api/v1/admin/health · 클래스 @Roles ADMIN · SUPER — 소개몰 운영과 같게)
 *     재입고   GET /restock · POST /restock/run
 *     현금영수증 GET /cash-receipts · POST /cash-receipts · POST /cash-receipts/run · POST /cash-receipts/{id}/retry · POST /cash-receipts/{id}/cancel
 *   회원(HealthMlxMeController · api/v1/me/health · 메서드마다 @Roles — 본인 것만)
 *     GET /restock · POST /restock · DELETE /restock/{id} · GET /orders/{no}/cash-receipt · PUT /orders/{no}/cash-receipt
 * ------------------------------------------------------------------- */

const MLX_MEMBER = ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER'] as const;
/** 숫자 · 붙임표 · 띄어쓰기만(숫자만 남긴 뒤 health-cashrcpt CR_PHONE · CR_BIZNO 와 DB fn_hlt_cr_request 가 다시 봄) */
const CR_NUMBER_IN = /^[0-9 -]{10,16}$/;

export class HltRestockSubDto {
  @ApiProperty({ format: 'uuid', description: '품절 옵션' }) @IsUUID() optionId!: string;
}
export class HltCrRequestDto {
  @ApiProperty({ enum: [...CR_PURPOSES], description: 'INCOME 소득공제(휴대폰 번호) · EXPENSE 지출증빙(사업자등록번호)' }) @IsIn(CR_PURPOSES as unknown as string[]) purpose!: string;
  @ApiProperty({ example: '010-1234-5678', description: '휴대폰 번호(소득공제) · 사업자등록번호 10자리(지출증빙) — 붙임표 있어도 됨' }) @IsString() @Matches(CR_NUMBER_IN) number!: string;
}
export class HltCrAdminIssueDto {
  @ApiProperty({ example: 'H20261120-0001' }) @IsString() @Length(4, 40) orderNo!: string;
  @ApiProperty({ enum: [...CR_PURPOSES] }) @IsIn(CR_PURPOSES as unknown as string[]) purpose!: string;
  @ApiProperty({ example: '010-1234-5678' }) @IsString() @Matches(CR_NUMBER_IN) number!: string;
  @ApiProperty({ example: '회원 전화 요청(결제 7일 뒤)' }) @IsString() @Length(2, 200) reason!: string;
}
export class HltCrCancelDto {
  @ApiProperty({ example: '회원 요청 — 번호 잘못 넣음' }) @IsString() @Length(2, 200) reason!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/health')
@Roles('ADMIN', 'SUPER')   // 통합 검정(check:acl)은 @Controller 아래의 클래스 @Roles 를 읽습니다(G-208)
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class HealthMlxController {
  constructor(private readonly db: DatabaseService) {}

  /* ── 재입고 알림 (v10.505) ── */
  @Get('restock')
  @ApiOperation({ summary: '소개몰 재입고 알림 (v10.505)', description: '스위치 · 기다림 · 최근 30일 알림 · 기다리는 옵션 순위 50 · 최근 신청 50(이름 가림).' })
  @ApiOkResponse({ type: Object })
  restock() { return restockView(this.db); }

  @Post('restock/run')
  @HttpCode(200)
  @Audit('HLT_RESTOCK_RUN', 'SETTING')
  @ApiOperation({ summary: '재입고 알림 지금 보내기 (v10.505)', description: '이미 재고가 돌아온 옵션(판매 중 · 켠 옵션)의 기다림에 알림 · 스위치가 꺼져 있으면 422.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_RESTOCK_OFF' })
  restockRun() { return restockRun(this.db); }

  /* ── 현금영수증 (v10.506) ── */
  @Get('cash-receipts')
  @ApiQuery({ name: 'state', required: false, enum: ['REQUESTED', 'PENDING', 'ISSUED', 'ASSUMED', 'FAILED', 'CANCEL_PENDING', 'CANCELED', 'SKIPPED'] })
  @ApiOperation({ summary: '소개몰 현금영수증 (v10.506)', description: '스위치 · 방식(간주 · 실제) · 준비 · 상태별 수 · 이번 달 · 지난달 발급 합(공급가액 · 부가세 · 면세) · 목록 200(가린 번호).' })
  @ApiOkResponse({ type: Object })
  receipts(@Query('state') state?: string) { return crView(this.db, state); }

  @Post('cash-receipts')
  @HttpCode(200)
  @Audit('HLT_CR_ISSUE', 'HLT_ORDER')
  @ApiOperation({ summary: '현금영수증 운영 발급 신청 (v10.506)', description: '주문 번호 · 용도 · 번호 · 사유 — 직판 · 계좌이체 · 가상계좌만 · 기간 제한 없음 · 다음 정기 작업에서 발급.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HLT_CR_ISSUED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_CR_PURPOSE · HLT_CR_NUMBER · HLT_CR_REASON · HLT_CR_DIRECT_ONLY · HLT_CR_CARD · HLT_CR_ORDER_CLOSED' })
  issue(@Body() dto: HltCrAdminIssueDto) { return crAdminIssue(this.db, RequestCtx.actorId() ?? null, dto); }

  @Post('cash-receipts/run')
  @HttpCode(200)
  @Audit('HLT_CR_RUN', 'SETTING')
  @ApiOperation({ summary: '현금영수증 지금 돌리기 (v10.506)', description: '정기 작업 mall_cash_receipt 와 같음 — 스위치가 꺼져 있어도 돌림(간주면 업체를 부르지 않음 · 실제인데 키가 없으면 NOT_READY).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'POLICY' })
  run() { return mallCashReceiptJob(this.db, { force: true }); }

  @Post('cash-receipts/:id/retry')
  @HttpCode(200)
  @Audit('HLT_CR_RETRY', 'HLT_ORDER')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '현금영수증 다시 보내기 (v10.506)', description: '실패(FAILED)만 · 발급 대기로 되돌림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HLT_CR_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'POLICY' })
  retry(@Param('id') id: string) { return crRetry(this.db, id); }

  @Post('cash-receipts/:id/cancel')
  @HttpCode(200)
  @Audit('HLT_CR_CANCEL', 'HLT_ORDER')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '현금영수증 취소 (v10.506)', description: '발급(실제 · 간주)은 취소 대기 · 발급 전은 닫음 · 사유 · 감사 기록.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HLT_CR_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_CR_REASON' })
  cancel(@Param('id') id: string, @Body() dto: HltCrCancelDto) { return crCancel(this.db, id, dto.reason); }
}

@ApiTags('HEALTH-SHOP')
@ApiBearerAuth()
@Controller('api/v1/me/health')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class HealthMlxMeController {
  constructor(private readonly db: DatabaseService) {}

  @Get('restock')
  @Roles(...MLX_MEMBER)
  @ApiOperation({ summary: '내 재입고 알림 (v10.505)', description: '기다리는 옵션 · 최근 닫힌 신청 20 · 스위치.' })
  @ApiOkResponse({ type: Object })
  mine() { return myRestock(this.db, RequestCtx.actorId()!); }

  @Post('restock')
  @HttpCode(200)
  @Roles(...MLX_MEMBER)
  @ApiOperation({ summary: '재입고 알림 신청 (v10.505)', description: '품절 옵션만 · 같은 옵션 기다림이 있으면 그것을 돌려줌(already) · 기다림 mall.restock_keep_days 일 · 한 번에 mall.restock_max 개까지.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_RESTOCK_OFF · HLT_RESTOCK_IN_STOCK · HLT_RESTOCK_MAX' })
  subscribe(@Body() dto: HltRestockSubDto) { return restockSubscribe(this.db, RequestCtx.actorId()!, dto.optionId); }

  @Delete('restock/:id')
  @Roles(...MLX_MEMBER)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '재입고 알림 취소 (v10.505)', description: '내 기다림만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HLT_RESTOCK_CLOSED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'POLICY' })
  cancel(@Param('id') id: string) { return restockCancel(this.db, RequestCtx.actorId()!, id); }

  @Get('orders/:no/cash-receipt')
  @Roles(...MLX_MEMBER)
  @ApiParam({ name: 'no', example: 'H20261120-0001' })
  @ApiOperation({ summary: '내 주문 현금영수증 (v10.506)', description: '신청 · 발급 상태(가린 번호) · 신청할 수 있는지 · 안 되는 까닭.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  receipt(@Param('no') no: string) { return crMine(this.db, RequestCtx.actorId()!, no); }

  @Put('orders/:no/cash-receipt')
  @Roles(...MLX_MEMBER)
  @Audit('HLT_CR_REQUEST', 'HLT_ORDER')
  @ApiParam({ name: 'no', example: 'H20261120-0001' })
  @ApiOperation({ summary: '현금영수증 신청 · 바꾸기 (v10.506)', description: '직판 · 계좌이체 · 가상계좌만 · 결제 전이면 결제 확인 뒤 발급 · 결제 뒤 mall.cash_receipt_req_days 일까지 · 발급된 뒤에는 409.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HLT_CR_ISSUED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_CR_OFF · HLT_CR_PURPOSE · HLT_CR_NUMBER · HLT_CR_DIRECT_ONLY · HLT_CR_CARD · HLT_CR_LATE · HLT_CR_ORDER_CLOSED' })
  request(@Param('no') no: string, @Body() dto: HltCrRequestDto) { return crRequest(this.db, RequestCtx.actorId()!, no, dto); }
}
