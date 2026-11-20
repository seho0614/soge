import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { confirmEval, listSuppliers, PERIOD_RE, saveEval, setPoDue, supplierDetail } from './supeval';
import { addLot, adjustLot, listLots, LOT_NO_RE, LOT_STATES, lotDetail, savePicks, setLotProduct, setLotState, shipQueue, traceLot } from './lots';
import { addClaim, CLAIM_SOURCES, claimDetail, claimStats, closeClaim, DEFECT_TYPES, editClaim, listClaims, supplierReturn } from './claims';

/* ---------------------------------------------------------------------
 * v10.494 ~ 496 (D271 · docs/632 ~ 634) ㊶ 구매 · 소개몰 품질 — 운영 화면 › 소개몰 › 로트 · 유통기한 · 품질 클레임 · 협력사 평가
 *   v10.494  GET /admin/qlt/suppliers?period= · GET /suppliers/{id} · POST /suppliers/evals · POST /suppliers/evals/{id}/confirm · PUT /admin/qlt/pos/{id}/due
 *   v10.495  GET /admin/qlt/lots · GET /lots/{id} · POST /lots · POST /lots/{id}/state · POST /lots/{id}/adjust(SUPER) · GET /lots/{id}/trace(ADMIN · SUPER)
 *            PUT /admin/qlt/lot-products/{id} · GET /admin/qlt/ship-queue · POST /admin/qlt/picks
 *   v10.496  GET /admin/qlt/claims · GET /claims/stats · GET /claims/{id} · POST /claims · PUT /claims/{id} · POST /claims/{id}/close · POST /claims/{id}/supplier-return(SUPER · PAYOUT)
 *   보기 · 고치기 SUPER · PAYOUT · ADMIN(소개몰 운영 · 구매 · 재고 담당 모두) — 원가 장부를 움직이는 로트 조정은 SUPER · 공급사 반품은 SUPER · PAYOUT
 *   회수 나간 곳(주문 · 회원)은 ADMIN · SUPER 만 · 세무사(ACCOUNTANT)는 /admin/acct/ 밖이라 보지 않음
 * ------------------------------------------------------------------- */

const VIEW = ['SUPER', 'PAYOUT', 'ADMIN'] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const actor = () => RequestCtx.actorId() ?? null;

export class QltEvalDto {
  @ApiProperty({ example: '3', description: '거래처 번호(매입처)' }) @IsString() @Matches(/^\d{1,18}$/) partyId!: string;
  @ApiProperty({ example: '2026-Q4' }) @IsString() @Matches(PERIOD_RE) period!: string;
  @ApiProperty({ example: 80, description: '가격 점수 0 ~ 100' }) @IsInt() @Min(0) @Max(100) priceScore!: number;
  @ApiProperty({ example: 90, description: '대응 점수 0 ~ 100' }) @IsInt() @Min(0) @Max(100) responseScore!: number;
  @ApiPropertyOptional({ example: 100, description: '품질 점수(비우면 클레임 수로 제안한 값)' }) @IsOptional() @IsInt() @Min(0) @Max(100) qualityScore?: number;
  @ApiPropertyOptional({ example: 100, description: '납기 점수 — 그 분기 입고 발주가 없을 때만 씀(있으면 자동)' }) @IsOptional() @IsInt() @Min(0) @Max(100) deliveryScore?: number;
  @ApiPropertyOptional({ example: '포장 개선 요청함' }) @IsOptional() @IsString() @Length(0, 400) memo?: string;
}
export class QltPoDueDto {
  @ApiProperty({ example: '2026-11-30' }) @IsString() @Matches(YMD) dueOn!: string;
}
export class QltLotDto {
  @ApiProperty({ format: 'uuid', description: '직판 상품 옵션' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) optionId!: string;
  @ApiProperty({ example: 'L2611-01', description: '로트 번호(영문 · 숫자로 시작 · 1 ~ 40자)' }) @IsString() @Matches(LOT_NO_RE) lotNo!: string;
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @IsString() @Matches(YMD) madeOn?: string;
  @ApiProperty({ example: '2027-10-01' }) @IsString() @Matches(YMD) expiresOn!: string;
  @ApiProperty({ example: 100 }) @IsInt() @Min(1) @Max(1_000_000) qty!: number;
  @ApiPropertyOptional({ example: '12', description: '나눌 원가 수불부 입고 줄 번호(비우면 시작 재고)' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) moveId?: string;
  @ApiPropertyOptional({ example: '3', description: '공급사(비우면 발주 입고 줄의 거래처)' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) partyId?: string;
  @ApiPropertyOptional({ example: '1차 입고' }) @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class QltLotStateDto {
  @ApiProperty({ enum: LOT_STATES }) @IsIn(LOT_STATES as unknown as string[]) state!: string;
  @ApiPropertyOptional({ example: '식약처 회수 명령', description: '보류 · 회수는 필수(2자 이상)' }) @IsOptional() @IsString() @Length(0, 200) reason?: string;
}
export class QltLotAdjustDto {
  @ApiProperty({ example: -2, description: '늘림 + · 줄임 −' }) @IsInt() @Min(-1_000_000) @Max(1_000_000) qty!: number;
  @ApiProperty({ example: '유통기한 지남 폐기' }) @IsString() @Length(2, 160) reason!: string;
  @ApiPropertyOptional({ example: '1', description: '창고(비우면 본 창고)' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) whId?: string;
}
export class QltLotProductDto {
  @ApiProperty({ example: true }) @IsBoolean() on!: boolean;
}
export class QltPickItemDto {
  @ApiProperty({ format: 'uuid', description: '주문 품목' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) itemId!: string;
  @ApiProperty({ example: '5' }) @IsString() @Matches(/^\d{1,18}$/) lotId!: string;
  @ApiProperty({ example: 2 }) @IsInt() @Min(1) @Max(1_000_000) qty!: number;
}
export class QltPicksDto {
  @ApiProperty({ format: 'uuid' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) orderId!: string;
  @ApiProperty({ type: [QltPickItemDto], description: '비우면 지정을 지움' }) @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => QltPickItemDto) picks!: QltPickItemDto[];
}
export class QltClaimDto {
  @ApiPropertyOptional({ example: '2026-11-20' }) @IsOptional() @IsString() @Matches(YMD) receivedOn?: string;
  @ApiProperty({ enum: CLAIM_SOURCES }) @IsIn(CLAIM_SOURCES as unknown as string[]) source!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) productId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) optionId?: string;
  @ApiPropertyOptional({ example: '5' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) lotId?: string;
  @ApiPropertyOptional({ example: '3' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) partyId?: string;
  @ApiPropertyOptional({ example: 'H20261120-0001' }) @IsOptional() @IsString() @Length(1, 40) orderNo?: string;
  @ApiProperty({ example: 2 }) @IsInt() @Min(1) @Max(1_000_000) qty!: number;
  @ApiProperty({ enum: DEFECT_TYPES }) @IsIn(DEFECT_TYPES as unknown as string[]) defectType!: string;
  @ApiProperty({ example: '포장 찢어짐' }) @IsString() @Length(2, 100) title!: string;
  @ApiPropertyOptional({ example: '택배 상자 안 포장이 찢어져 도착' }) @IsOptional() @IsString() @Length(0, 2000) detail?: string;
}
export class QltClaimEditDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'CHECKING', 'ACTION'] }) @IsOptional() @IsIn(['OPEN', 'CHECKING', 'ACTION']) state?: string;
  @ApiPropertyOptional({ example: '공급사 포장 불량' }) @IsOptional() @IsString() @Length(0, 1000) cause?: string;
  @ApiPropertyOptional({ example: '공급사 반품 · 포장 기준 전달' }) @IsOptional() @IsString() @Length(0, 1000) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 2000) detail?: string;
  @ApiPropertyOptional({ example: '3', description: '빈 글자면 공급사 지움' }) @IsOptional() @IsString() @Matches(/^(\d{1,18})?$/) partyId?: string;
  @ApiPropertyOptional({ example: '5', description: '빈 글자면 로트 지움' }) @IsOptional() @IsString() @Matches(/^(\d{1,18})?$/) lotId?: string;
}
export class QltClaimCloseDto {
  @ApiProperty({ enum: ['CLOSED', 'REJECTED'] }) @IsIn(['CLOSED', 'REJECTED']) result!: string;
  @ApiPropertyOptional({ example: '고객 단순 변심', description: '반려는 필수' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
}
export class QltSupReturnDto {
  @ApiProperty({ example: 2 }) @IsInt() @Min(1) @Max(1_000_000) qty!: number;
  @ApiPropertyOptional({ example: '반품 송장 1234' }) @IsOptional() @IsString() @Length(0, 120) note?: string;
  @ApiPropertyOptional({ example: '1', description: '창고(비우면 본 창고)' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) whId?: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/qlt')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class QltController {
  constructor(private readonly db: DatabaseService) {}

  /* ── v10.494 협력사(공급사) 평가 ── */
  @Get('suppliers')
  @Roles(...VIEW)
  @ApiQuery({ name: 'period', required: false, example: '2026-Q4' })
  @ApiOperation({ summary: '협력사 평가 목록 (v10.494)', description: '매입처마다 그 분기 입고 발주 · 제때 · 늦은 날 · 클레임 · 제안 점수 · 저장한 평가 · 납기일을 넣을 발주.' })
  @ApiOkResponse({ type: Object })
  suppliers(@Query('period') period?: string) { return listSuppliers(this.db, period); }

  @Get('suppliers/:id')
  @Roles(...VIEW)
  @ApiParam({ name: 'id', example: '3' })
  @ApiOperation({ summary: '한 매입처 — 평가 기록 · 발주 납기 · 클레임 (v10.494)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  supplier(@Param('id') id: string) { return supplierDetail(this.db, id); }

  @Post('suppliers/evals')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('QLT_EVAL_SAVE', 'SETTING')
  @ApiOperation({ summary: '평가 저장(초안 · 같은 분기 덮어씀) (v10.494)', description: '납기는 입고 자료가 있으면 자동 · 품질은 비우면 제안 값 · 합계 = 가중 합 · 등급.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'QLT_EVAL_STATE(확정함)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'QLT_EVAL · QLT_PARTY' })
  saveEval(@Body() dto: QltEvalDto) { return saveEval(this.db, dto, actor()); }

  @Post('suppliers/evals/:id/confirm')
  @Roles('SUPER', 'PAYOUT', 'ADMIN')
  @HttpCode(200)
  @Audit('QLT_EVAL_CONFIRM', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '평가 확정 (v10.494)', description: '확정하면 고치지 않음(DB 도 막음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'QLT_EVAL_STATE' })
  confirmEval(@Param('id') id: string) { return confirmEval(this.db, id, actor()); }

  @Put('pos/:id/due')
  @Roles(...VIEW)
  @Audit('QLT_PO_DUE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '국내 발주 납기일 (v10.494)', description: '발주(ORDERED) 상태일 때만 · 없으면 발주일 + qlt.po_lead_days 로 셈.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'QLT_PO_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'QLT_PO_DUE' })
  poDue(@Param('id') id: string, @Body() dto: QltPoDueDto) { return setPoDue(this.db, id, dto.dueOn, actor()); }

  /* ── v10.495 재고 로트 · 유통기한 ── */
  @Get('lots')
  @Roles(...VIEW)
  @ApiQuery({ name: 'q', required: false }) @ApiQuery({ name: 'state', required: false, enum: LOT_STATES }) @ApiQuery({ name: 'soon', required: false, example: '1' })
  @ApiOperation({ summary: '로트 목록 · 로트 관리 상품 · 로트 없는 입고 줄 (v10.495)' })
  @ApiOkResponse({ type: Object })
  lots(@Query('q') q?: string, @Query('state') state?: string, @Query('soon') soon?: string) { return listLots(this.db, { q, state, soon }); }

  @Get('ship-queue')
  @Roles(...VIEW)
  @ApiOperation({ summary: '발송 전 FEFO 제안 (v10.495)', description: '결제 · 준비 직판 주문 중 로트 관리 상품 줄 · 먼저 끝나는 로트 제안 · 지정한 로트.' })
  @ApiOkResponse({ type: Object })
  shipQueue() { return shipQueue(this.db); }

  @Post('picks')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('QLT_LOT_PICK', 'HLT_PRODUCT')
  @ApiOperation({ summary: '출고 로트 확정 (v10.495)', description: '발송 전 주문 하나 · 쓰기 전 지정은 바꿈 · 배송 뒤 이 로트로 붙음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'QLT_PICK_STATE(발송함)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'QLT_PICK' })
  picks(@Body() dto: QltPicksDto) { return savePicks(this.db, dto.orderId, dto.picks ?? [], actor()); }

  @Put('lot-products/:id')
  @Roles(...VIEW)
  @Audit('QLT_LOT_PRODUCT', 'HLT_PRODUCT')
  @ApiParam({ name: 'id', format: 'uuid', description: '직판 상품' })
  @ApiOperation({ summary: '로트 관리 켜기 · 끄기 (v10.495)', description: '끄면 지금과 같음(로트 기록은 남음) · 다시 켜면 그때부터.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'QLT_LOT(직판 아님)' })
  lotProduct(@Param('id') id: string, @Body() dto: QltLotProductDto) { return setLotProduct(this.db, id, dto.on, actor()); }

  @Post('lots')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('QLT_LOT_ADD', 'HLT_PRODUCT')
  @ApiOperation({ summary: '로트 등록 (v10.495)', description: '원가 수불부 입고 줄을 로트로 나눔(합 ≤ 그 줄) · 줄이 없으면 시작 재고(로트로 나누지 않은 수량까지).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'QLT_LOT_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'QLT_LOT · QLT_LOT_OFF · QLT_LOT_OPEN · QLT_PARTY' })
  addLot(@Body() dto: QltLotDto) { return addLot(this.db, dto, actor()); }

  @Get('lots/:id')
  @Roles(...VIEW)
  @ApiParam({ name: 'id', example: '5' })
  @ApiOperation({ summary: '로트 자세히 · 수불 · 클레임 (v10.495)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  lot(@Param('id') id: string) { return lotDetail(this.db, id); }

  @Get('lots/:id/trace')
  @Roles('ADMIN', 'SUPER')
  @ApiParam({ name: 'id', example: '5' })
  @ApiOperation({ summary: '회수 — 로트가 나간 주문 · 수출 (v10.495)', description: '이름 가림 · 전화 끝 4자리 · ADMIN · SUPER 만 · 볼 때마다 감사 기록 QLT_LOT_TRACE(로트 · 건수만).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  trace(@Param('id') id: string) { return traceLot(this.db, id); }

  @Post('lots/:id/state')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('QLT_LOT_STATE', 'HLT_PRODUCT')
  @ApiParam({ name: 'id', example: '5' })
  @ApiOperation({ summary: '로트 상태 (v10.495)', description: '정상 ↔ 보류(사유) · 회수(사유 · 운영 알림 QLT_LOT_RECALL) · 끝(남은 0).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'QLT_LOT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'QLT_REASON · QLT_LOT' })
  lotState(@Param('id') id: string, @Body() dto: QltLotStateDto) { return setLotState(this.db, id, dto.state, dto.reason, actor()); }

  @Post('lots/:id/adjust')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('QLT_LOT_ADJUST', 'HLT_PRODUCT')
  @ApiParam({ name: 'id', example: '5' })
  @ApiOperation({ summary: '로트 조정 (v10.495 · SUPER)', description: '원가 수불부 실사 조정(ADJUST) 한 줄 + 그 로트 수불 · 줄임은 로트 · 창고 수량까지.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'QLT_LOT_STATE(끝냄)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'QLT_LOT · QLT_REASON' })
  lotAdjust(@Param('id') id: string, @Body() dto: QltLotAdjustDto) { return adjustLot(this.db, id, dto, actor()); }

  /* ── v10.496 품질 클레임 · 불량 ── */
  @Get('claims')
  @Roles(...VIEW)
  @ApiQuery({ name: 'state', required: false, description: 'OPEN · CHECKING · ACTION · CLOSED · REJECTED · OPENALL(열린 것 모두)' }) @ApiQuery({ name: 'q', required: false })
  @ApiOperation({ summary: '품질 클레임 목록 (v10.496)' })
  @ApiOkResponse({ type: Object })
  claims(@Query('state') state?: string, @Query('q') q?: string) { return listClaims(this.db, { state, q }); }

  @Get('claims/stats')
  @Roles(...VIEW)
  @ApiQuery({ name: 'months', required: false, example: '6' })
  @ApiOperation({ summary: '클레임 집계 · 재발 (v10.496)', description: '불량 유형 · 상품 · 공급사 · 달마다 · 90일 안 같은 상품 · 같은 불량 2건 이상.' })
  @ApiOkResponse({ type: Object })
  stats(@Query('months') months?: string) { return claimStats(this.db, months); }

  @Get('claims/:id')
  @Roles(...VIEW)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '클레임 자세히 · 기록 · 공급사 반품 (v10.496)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  claim(@Param('id') id: string) { return claimDetail(this.db, id); }

  @Post('claims')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('QLT_CLAIM_ADD', 'HLT_PRODUCT')
  @ApiOperation({ summary: '클레임 접수 (v10.496)', description: '상품(또는 옵션 · 로트) · 공급사(비우면 로트의 공급사) · 주문 번호 · 수량 · 불량 유형.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'QLT_CLAIM · QLT_PARTY' })
  addClaim(@Body() dto: QltClaimDto) { return addClaim(this.db, dto, actor()); }

  @Put('claims/:id')
  @Roles(...VIEW)
  @Audit('QLT_CLAIM_EDIT', 'HLT_PRODUCT')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '클레임 고치기 (v10.496)', description: '보낸 칸만 · 상태는 접수 · 확인 중 · 조치 · 끝내거나 반려하면 409.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'QLT_CLAIM_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'QLT_CLAIM · QLT_PARTY' })
  editClaim(@Param('id') id: string, @Body() dto: QltClaimEditDto) {
    /* 안 보낸 칸은 undefined 로 남겨 그대로 둠(규칙 11) */
    const b = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    return editClaim(this.db, id, b, actor());
  }

  @Post('claims/:id/close')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('QLT_CLAIM_CLOSE', 'HLT_PRODUCT')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '클레임 끝냄 · 반려 (v10.496)', description: '끝냄은 원인 · 조치 필수 · 반려는 사유 필수.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'QLT_CLAIM_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'QLT_CLAIM_DONE · QLT_REASON' })
  closeClaim(@Param('id') id: string, @Body() dto: QltClaimCloseDto) { return closeClaim(this.db, id, dto, actor()); }

  @Post('claims/:id/supplier-return')
  @Roles('SUPER', 'PAYOUT')
  @HttpCode(200)
  @Audit('QLT_SUP_RETURN', 'HLT_PRODUCT')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '공급사 반품 (v10.496 · SUPER · PAYOUT)', description: '원가 수불부 SUP_RETURN(평균 원가) · 로트 수불 · 다음 전표 작업에서 외상매입금 / 상품.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'QLT_CLAIM_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'QLT_RETURN' })
  supReturn(@Param('id') id: string, @Body() dto: QltSupReturnDto) { return supplierReturn(this.db, id, dto, actor()); }
}
