import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { PolicyViolation } from '../../core/errors';
import { DatabaseService } from '../../db/database.service';
import { EtaxService } from '../etax/etax.service';
import { addCost, addTrip, addVehicle, cancelVehicleLine, CAR_CLASSES, COST_KINDS, listVehicles, OWNERSHIPS, TRIP_PURPOSES, updateVehicle, vehicleDetail } from './vehicles';
import { cashPlan } from './cashplan';
import { cancelExempt, exemptOn, listExempt, requestExempt } from './exemptinv';
import { acctReorderJob, convertDraft, dismissDraft, editDraft, reorderView, setReorderRule } from './reorder';

/* ---------------------------------------------------------------------
 * v10.475 ~ 478 (D266 · docs/613 ~ 616) 사무 · 자금 — 대표 11/20 「㊱」
 *   v10.475  GET /admin/acct/vehicles?year= · GET /acct/vehicles/{id}?year= · POST /acct/vehicles · PUT /acct/vehicles/{id}
 *            POST /acct/vehicles/{id}/trips · /trips/{tripId}/cancel · POST /acct/vehicles/{id}/costs · /costs/{costId}/cancel
 *            SUPER · PAYOUT · ADMIN(운행 기록은 운영자가 넣음) · 세무사(ACCOUNTANT)는 GET 만(운행기록부 = 세무 증빙 · 운전자 이름 글자뿐)
 *   v10.476  GET /admin/acct/cash-plan?months= — SUPER · PAYOUT(세무사 GET)
 *   v10.477  GET /admin/acct/exempt-invoices?ym= · POST /acct/exempt-invoices · POST /{id}/send(㉒ EtaxService 'exempt') · POST /{id}/cancel — SUPER · PAYOUT(세무사 GET)
 *   v10.478  GET /admin/acct/reorder · PUT /acct/reorder/rules/{optionId} · POST /acct/reorder/run · PUT /acct/reorder/drafts/{id}/lines · /{id}/convert · /{id}/dismiss
 *            SUPER · PAYOUT · ADMIN(소개몰 운영) · 세무사 GET
 *   차량 비용 한도 · 감가상각비 한도 · 전자계산서 스위치 · 재주문 스위치는 정책 › 전체 설정(SUPER).
 * ------------------------------------------------------------------- */

const VIEW2 = ['SUPER', 'PAYOUT'] as const;
const OPS3 = ['SUPER', 'PAYOUT', 'ADMIN'] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YMD_OR_EMPTY = /^(\d{4}-\d{2}-\d{2})?$/;
const PLATE = /^([가-힣]{2})?[0-9]{2,3}[가-힣][0-9]{4}$/;   // DB CHECK acct_vehicles.plate 와 같음

export class VehicleNewDto {
  @ApiProperty({ example: '12가3456', description: '차량 번호(빈칸 없이 · DB CHECK 와 같은 모양)' }) @IsString() @Matches(PLATE) plate!: string;
  @ApiProperty({ example: '쏘나타 업무 1호' }) @IsString() @Length(1, 40) name!: string;
  @ApiPropertyOptional({ enum: CAR_CLASSES, description: 'PASSENGER 업무용승용차(규정 대상) · EXCLUDED 경차 · 9인승 이상 · 화물 등' }) @IsOptional() @IsIn(CAR_CLASSES as unknown as string[]) carClass?: string;
  @ApiPropertyOptional({ enum: OWNERSHIPS }) @IsOptional() @IsIn(OWNERSHIPS as unknown as string[]) ownership?: string;
  @ApiProperty({ example: '2026-03-02', description: '취득 · 리스 · 렌트 계약일' }) @IsString() @Matches(YMD) acquiredOn!: string;
  @ApiPropertyOptional({ example: 32000000 }) @IsOptional() @IsInt() @Min(0) @Max(10_000_000_000) acquireCost?: number;
  @ApiPropertyOptional({ example: true, description: '업무전용 자동차보험 가입' }) @IsOptional() @IsBoolean() bizInsurance?: boolean;
  @ApiPropertyOptional({ example: '2027-03-01' }) @IsOptional() @IsString() @Matches(YMD_OR_EMPTY) insuranceUntil?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class VehicleEditDto {
  @ApiPropertyOptional({ example: '12가3456', description: '번호는 바꾸지 않음 — 다르면 409 VEH_PLATE_FIXED(같으면 그대로)' }) @IsOptional() @IsString() @Matches(PLATE) plate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) name?: string;
  @ApiPropertyOptional({ enum: CAR_CLASSES }) @IsOptional() @IsIn(CAR_CLASSES as unknown as string[]) carClass?: string;
  @ApiPropertyOptional({ enum: OWNERSHIPS }) @IsOptional() @IsIn(OWNERSHIPS as unknown as string[]) ownership?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(YMD) acquiredOn?: string;
  @ApiPropertyOptional({ description: '처분일 · 빈 글자 = 지움' }) @IsOptional() @IsString() @Matches(YMD_OR_EMPTY) disposedOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000_000_000) acquireCost?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() bizInsurance?: boolean;
  @ApiPropertyOptional({ description: '빈 글자 = 지움' }) @IsOptional() @IsString() @Matches(YMD_OR_EMPTY) insuranceUntil?: string;
  @ApiPropertyOptional({ description: 'false = 끔(운행을 더 넣지 않음)' }) @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class VehicleTripDto {
  @ApiProperty({ example: '2026-11-20' }) @IsString() @Matches(YMD) tripOn!: string;
  @ApiProperty({ example: '홍길동' }) @IsString() @Length(1, 40) driver!: string;
  @ApiPropertyOptional({ example: '영업팀' }) @IsOptional() @IsString() @Length(0, 40) dept?: string;
  @ApiProperty({ enum: TRIP_PURPOSES, description: 'COMMUTE 출퇴근 · BUSINESS 업무(둘 다 업무 사용) · PERSONAL 비업무' }) @IsIn(TRIP_PURPOSES as unknown as string[]) purpose!: string;
  @ApiPropertyOptional({ example: '본사' }) @IsOptional() @IsString() @Length(0, 60) fromPlace?: string;
  @ApiPropertyOptional({ example: '거래처 (주)가나' }) @IsOptional() @IsString() @Length(0, 60) toPlace?: string;
  @ApiProperty({ example: 12500, description: '주행 전 계기판(km)' }) @IsInt() @Min(0) @Max(9_999_999) odoStart!: number;
  @ApiProperty({ example: 12542, description: '주행 후 계기판(km · 한 번에 3,000km 까지)' }) @IsInt() @Min(1) @Max(9_999_999) odoEnd!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class VehicleCostDto {
  @ApiProperty({ example: '2026-11-20' }) @IsString() @Matches(YMD) costOn!: string;
  @ApiProperty({ enum: COST_KINDS }) @IsIn(COST_KINDS as unknown as string[]) kind!: string;
  @ApiProperty({ example: 70000 }) @IsInt() @Min(1) @Max(10_000_000_000) amount!: number;
  @ApiPropertyOptional({ example: 42.5, description: '주유량(L)' }) @IsOptional() @IsNumber() @Min(0.01) @Max(10000) liters?: number;
  @ApiPropertyOptional({ example: '12', description: '⑫ 매입 번호(같은 매입은 한 번만)' }) @IsOptional() @IsString() @Matches(/^(\d{1,18})?$/) purchaseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class VehicleLineCancelDto {
  @ApiProperty({ example: '계기판 잘못 적음' }) @IsString() @Length(2, 200) reason!: string;
}
export class ExemptRequestDto {
  @ApiProperty({ format: 'uuid', description: '확정한 거래명세서 id' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) docId!: string;
}
export class ExemptCancelDto {
  @ApiProperty({ example: '거래처 사업자번호 확인 뒤 다시' }) @IsString() @Length(2, 200) reason!: string;
}
export class ReorderRuleDto {
  @ApiProperty({ example: 20, description: '최소 재고(판매용 + 발주 중이 이 밑이면 알림 · 초안)' }) @IsInt() @Min(0) @Max(1_000_000) minQty!: number;
  @ApiProperty({ example: 50, description: '재주문 수량' }) @IsInt() @Min(1) @Max(1_000_000) reorderQty!: number;
  @ApiPropertyOptional({ example: '3', description: '매입처(거래처 번호 · 비우면 초안에서 고름)' }) @IsOptional() @IsString() @Matches(/^(\d{1,18})?$/) partyId?: string;
  @ApiPropertyOptional({ example: 12000, description: '단가(비우면 재고 평균 단가)' }) @IsOptional() @IsInt() @Min(0) @Max(10_000_000_000) unitPrice?: number;
  @ApiPropertyOptional({ example: true, description: 'false = 규칙 끔' }) @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class ReorderDraftLineDto {
  @ApiProperty({ format: 'uuid' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) optionId!: string;
  @ApiProperty({ example: 50, description: '0 = 빼기' }) @IsInt() @Min(0) @Max(1_000_000) qty!: number;
  @ApiPropertyOptional({ example: 12000 }) @IsOptional() @IsInt() @Min(0) @Max(10_000_000_000) unitPrice?: number;
}
export class ReorderDraftEditDto {
  @ApiPropertyOptional({ example: '3', description: '매입처 · 빈 글자 = 정하지 않음' }) @IsOptional() @IsString() @Matches(/^(\d{1,18})?$/) partyId?: string;
  @ApiPropertyOptional({ type: [ReorderDraftLineDto] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ReorderDraftLineDto) lines?: ReorderDraftLineDto[];
}
export class ReorderConvertDto {
  @ApiPropertyOptional({ example: '3', description: '매입처(초안에 없을 때)' }) @IsOptional() @IsString() @Matches(/^(\d{1,18})?$/) partyId?: string;
  @ApiPropertyOptional({ example: '12월 첫 주 재주문' }) @IsOptional() @IsString() @Length(0, 100) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class ReorderDismissDto {
  @ApiProperty({ example: '다음 달 단종 예정' }) @IsString() @Length(2, 200) reason!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class AcctOpsController {
  constructor(private readonly db: DatabaseService, private readonly etax: EtaxService) {}

  /* ── v10.475 업무용 차량 ── */
  @Get('acct/vehicles')
  @Roles(...OPS3)
  @ApiQuery({ name: 'year', required: false, example: '2026' })
  @ApiOperation({ summary: '업무용 차량 목록 · 해 셈 (v10.475)', description: '차량 · 그해 거리(전체 · 업무) · 비용 · 업무 사용 비율 · 인정 · 불인정(일반 원칙 · 세무사 확인) · 한도 설정 값.' })
  @ApiOkResponse({ type: Object })
  vehicles(@Query('year') year?: string) { return listVehicles(this.db, year); }

  @Get('acct/vehicles/:id')
  @Roles(...OPS3)
  @ApiParam({ name: 'id', example: '1' }) @ApiQuery({ name: 'year', required: false, example: '2026' })
  @ApiOperation({ summary: '업무용 차량 자세히 · 운행기록부 (v10.475)', description: '그해 운행 · 비용 · 계기판 끊김 · 셈 · 국세청 운행기록부 서식 차례의 줄(log).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  vehicle(@Param('id') id: string, @Query('year') year?: string) { return vehicleDetail(this.db, id, year); }

  @Post('acct/vehicles')
  @Roles(...OPS3)
  @HttpCode(200)
  @Audit('ACCT_VEHICLE_ADD', 'SETTING')
  @ApiOperation({ summary: '업무용 차량 넣기 (v10.475)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'VEH_PLATE_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VEH_PLATE · VEH_NAME · VEH_CLASS · VEH_OWNERSHIP · VEH_DATE' })
  addVehicle(@Body() dto: VehicleNewDto) { return addVehicle(this.db, dto, RequestCtx.actorId() ?? null); }

  @Put('acct/vehicles/:id')
  @Roles(...OPS3)
  @Audit('ACCT_VEHICLE_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '업무용 차량 고치기 (v10.475)', description: '보낸 칸만(번호는 못 고침) · 처분일 · 보험 · 끄기.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'VEH_PLATE_FIXED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VEH_EMPTY · VEH_NAME · VEH_CLASS · VEH_OWNERSHIP · VEH_DATE · VEH_COST' })
  editVehicle(@Param('id') id: string, @Body() dto: VehicleEditDto) { return updateVehicle(this.db, id, dto); }

  @Post('acct/vehicles/:id/trips')
  @Roles(...OPS3)
  @HttpCode(200)
  @Audit('ACCT_VEHICLE_TRIP', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '운행 넣기 (v10.475)', description: '날짜 · 운전자 · 부서 · 목적 · 출발 · 도착 · 계기판 전 · 후 — 앞 운행과 계기판이 이어지지 않으면 안내(gap)만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'VEH_INACTIVE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VEH_DATE · VEH_DRIVER · VEH_PURPOSE · VEH_ODO' })
  addTrip(@Param('id') id: string, @Body() dto: VehicleTripDto) { return addTrip(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Post('acct/vehicles/:id/trips/:tripId/cancel')
  @Roles(...OPS3)
  @HttpCode(200)
  @Audit('ACCT_VEHICLE_TRIP_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' }) @ApiParam({ name: 'tripId', example: '1' })
  @ApiOperation({ summary: '운행 취소 (v10.475)', description: '사유 · 지우지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'VEH_LINE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_REASON' })
  cancelTrip(@Param('id') id: string, @Param('tripId') tripId: string, @Body() dto: VehicleLineCancelDto) { return cancelVehicleLine(this.db, id, 'trip', tripId, dto.reason); }

  @Post('acct/vehicles/:id/costs')
  @Roles(...OPS3)
  @HttpCode(200)
  @Audit('ACCT_VEHICLE_COST', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '차량 비용 넣기 (v10.475)', description: '주유 · 정비 · 보험 · 세금 · 리스 · 감가상각(상당액) · 통행료 · 기타 · ⑫ 매입 번호(한 번) · 전표 없음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'VEH_PURCHASE_USED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VEH_DATE · VEH_COST_KIND · VEH_COST · VEH_PURCHASE' })
  addCost(@Param('id') id: string, @Body() dto: VehicleCostDto) { return addCost(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Post('acct/vehicles/:id/costs/:costId/cancel')
  @Roles(...OPS3)
  @HttpCode(200)
  @Audit('ACCT_VEHICLE_COST_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' }) @ApiParam({ name: 'costId', example: '1' })
  @ApiOperation({ summary: '차량 비용 취소 (v10.475)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'VEH_LINE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_REASON' })
  cancelCost(@Param('id') id: string, @Param('costId') costId: string, @Body() dto: VehicleLineCancelDto) { return cancelVehicleLine(this.db, id, 'cost', costId, dto.reason); }

  /* ── v10.476 12개월 자금 계획 ── */
  @Get('acct/cash-plan')
  @Roles(...VIEW2)
  @ApiQuery({ name: 'months', required: false, example: '12', description: '3 ~ 18(처음 12)' })
  @ApiOperation({ summary: '12개월 자금 계획 (v10.476)', description: '달마다 들어올 돈 · 나갈 돈(90일 확정 · 예정 · 계약 고정비 · 급여 · 세금 기한 · 예상 매출) · 달 말 예상 잔액 · 모자라는 달 — 저장하지 않고 원래 자료에서 셈.' })
  @ApiOkResponse({ type: Object })
  plan(@Query('months') months?: string) { return cashPlan(this.db, Number(months ?? 12) || 12); }

  /* ── v10.477 전자계산서(면세) ── */
  @Get('acct/exempt-invoices')
  @Roles(...VIEW2)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '전자계산서(면세) (v10.477)', description: '요청할 거래명세서(면세 품목) · 그 달 요청 · 발행 · 매출처별 합계 · 스위치(acct.exempt_invoice) · 간주 모드.' })
  @ApiOkResponse({ type: Object })
  exempts(@Query('ym') ym?: string) { return listExempt(this.db, ym); }

  @Post('acct/exempt-invoices')
  @Roles(...VIEW2)
  @HttpCode(200)
  @Audit('ACCT_EXEMPT_REQUEST', 'INVOICE')
  @ApiOperation({ summary: '전자계산서 요청 (v10.477)', description: '확정한 거래명세서의 면세 품목 공급가 합 · 부가세 0 · 공급받는 자를 그때 값으로 고정.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_DOC_STATE · EXEMPT_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXEMPT_OFF · EXEMPT_NONE' })
  requestExempt(@Body() dto: ExemptRequestDto) { return requestExempt(this.db, dto.docId, RequestCtx.actorId() ?? null); }

  @Post('acct/exempt-invoices/:id/send')
  @Roles(...VIEW2)
  @HttpCode(200)
  @Audit('ACCT_EXEMPT_SEND', 'INVOICE')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '전자계산서 발행 (v10.477)', description: '㉒ 전자세금계산서 어댑터 그대로 — assume.etax on 이면 간주 발행(승인번호 없음) · off 면 업체 전송(taxType EXEMPT).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ETAX_ALREADY_SENT · ETAX_ALREADY_ASSUMED · ETAX_IN_FLIGHT · ETAX_CONFLICT · NOT_REQUESTED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXEMPT_OFF · ETAX_NOT_CONFIGURED · ETAX_SUPPLIER · ETAX_PERSON_BUYER' })
  async sendExempt(@Param('id') id: string) {
    if (!(await exemptOn(this.db))) throw new PolicyViolation('EXEMPT_OFF', '전자계산서 발행이 꺼져 있습니다(acct.exempt_invoice) — SUPER 가 정책 › 전체 설정에서 켭니다.');
    return this.etax.send('exempt', id, 'send');
  }

  @Post('acct/exempt-invoices/:id/cancel')
  @Roles(...VIEW2)
  @HttpCode(200)
  @Audit('ACCT_EXEMPT_CANCEL', 'INVOICE')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '전자계산서 요청 취소 (v10.477)', description: '보내기 전 요청만 · 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'EXEMPT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_REASON' })
  cancelExempt(@Param('id') id: string, @Body() dto: ExemptCancelDto) { return cancelExempt(this.db, id, dto.reason); }

  /* ── v10.478 안전 재고 · 재주문 ── */
  @Get('acct/reorder')
  @Roles(...OPS3)
  @ApiOperation({ summary: '안전 재고 · 재주문 (v10.478)', description: '직판 옵션별 판매용 재고 · 발주 중 · 위치 · 규칙 · 모자람 · 열린 재주문 초안 · 끝난 초안 30.' })
  @ApiOkResponse({ type: Object })
  reorder() { return reorderView(this.db); }

  @Put('acct/reorder/rules/:optionId')
  @Roles(...OPS3)
  @Audit('ACCT_REORDER_RULE', 'SETTING')
  @ApiParam({ name: 'optionId', format: 'uuid' })
  @ApiOperation({ summary: '안전 재고 규칙 넣기 · 고치기 (v10.478)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'REORDER_MIN · REORDER_QTY · REORDER_PARTY · REORDER_PRICE' })
  setReorderRule(@Param('optionId') optionId: string, @Body() dto: ReorderRuleDto) { return setReorderRule(this.db, optionId, dto, RequestCtx.actorId() ?? null); }

  @Post('acct/reorder/run')
  @Roles(...OPS3)
  @HttpCode(200)
  @Audit('ACCT_REORDER_RUN', 'SETTING')
  @ApiOperation({ summary: '재주문 지금 점검 (v10.478)', description: '정기 작업 acct_reorder 와 같음 — 알림 넣기 · 풀기 · 초안 줄 더하기(발주는 만들지 않음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'POLICY' })
  run() { return acctReorderJob(this.db); }

  @Put('acct/reorder/drafts/:id/lines')
  @Roles(...OPS3)
  @Audit('ACCT_REORDER_DRAFT_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '재주문 초안 고치기 (v10.478)', description: '매입처 · 품목 수량 · 단가(0 = 빼기) — 초안(DRAFT)에서만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'REORDER_STATE · REORDER_PARTY_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'REORDER_EMPTY · REORDER_LINES · REORDER_PARTY' })
  editDraft(@Param('id') id: string, @Body() dto: ReorderDraftEditDto) { return editDraft(this.db, id, dto); }

  @Post('acct/reorder/drafts/:id/convert')
  @Roles(...OPS3)
  @HttpCode(200)
  @Audit('ACCT_REORDER_CONVERT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '재주문 초안 → 국내 발주 (v10.478)', description: '사람이 누를 때만 ㉑ 국내 발주(ORDERED) 하나로 · 거래처에 보내지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'REORDER_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'REORDER_PARTY · REORDER_LINES · TRADE_PARTY · PO_TITLE · PO_LINES' })
  convert(@Param('id') id: string, @Body() dto: ReorderConvertDto) { return convertDraft(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Post('acct/reorder/drafts/:id/dismiss')
  @Roles(...OPS3)
  @HttpCode(200)
  @Audit('ACCT_REORDER_DISMISS', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '재주문 초안 버림 (v10.478)', description: '사유 · 다음 점검에서도 모자라면 새 초안.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'REORDER_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_REASON' })
  dismiss(@Param('id') id: string, @Body() dto: ReorderDismissDto) { return dismissDraft(this.db, id, dto.reason, RequestCtx.actorId() ?? null); }
}
