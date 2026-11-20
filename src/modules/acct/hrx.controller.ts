import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { HRX_HM_RE, HRX_OT_RATES_RE, HRX_PAY_BASES, HRX_WEEK_LIMITS_RE, cancelMyOvertime, decideOvertime, myOvertime, overtimeList, overtimePayroll,
  pushOvertimePayroll, requestMyOvertime, requestOvertimeFor, revokeOvertime, setOtRules, undoOvertimePayroll } from './hrx-overtime';
import { HRX_SHIFT_CODE_RE, HRX_SHIFT_KINDS, copyLastWeek, myShifts, setShiftType, setShifts, shiftWeek } from './hrx-shifts';
import { HRX_RESOURCE_KINDS, addResource, bookingBoard, cancelBooking, createBooking, updateResource } from './hrx-booking';
import { HRX_ST_RESULTS, assetLabels, closeStocktake, disposeMissing, markLine, openStocktake, scanAsset, stocktakeDetail, stocktakes } from './hrx-stocktake';

/* ---------------------------------------------------------------------
 * ㉟ 인사 4 (D265 · docs/609 ~ 612) — 대표 11/20 「㉟ 인사 4」
 *   본인(운영 역할 누구나 · 직원과 연결된 계정 · 세무사 제외 — D259 내 인사와 같음)
 *     GET  /admin/me/hrx                          내 연장 근로 · 이번 주 합계 · 내 근무표(2주)
 *     POST /admin/me/hrx/overtime                 연장 · 야간 · 휴일 근로 신청
 *     POST /admin/me/hrx/overtime/{id}/cancel     내 신청 취소(승인 전)
 *   v10.471 연장 근로(ADMIN · 급여 넘김 · 규칙은 SUPER)
 *     GET /admin/hrx/overtime · POST /admin/hrx/overtime(대신 신청) · POST …/{id}/decide · POST …/{id}/revoke · PUT …/rules(SUPER)
 *     GET /admin/hrx/overtime/payroll · POST /admin/hrx/overtime/payroll(SUPER) · POST …/payroll/undo(SUPER)
 *   v10.472 근무표(ADMIN · 유형은 SUPER)  GET|PUT /admin/hrx/shifts · POST …/copy · PUT …/types/{code}(SUPER)
 *   v10.473 예약(운영 역할 누구나 · 자원은 ADMIN)  GET|POST /admin/hrx/booking · POST …/{id}/cancel · POST …/resources · PUT …/resources/{id}
 *   v10.474 자산 실사(ADMIN · 지급 담당 · 처분은 SUPER)  GET|POST /admin/hrx/stocktakes · GET …/{id} · POST …/{id}/scan · PUT …/{id}/lines/{assetId}
 *     POST …/{id}/close · POST …/{id}/dispose(SUPER) · GET /admin/hrx/asset-labels
 *   모두 /admin/hrx · /admin/me/hrx 아래라 세무사(ACCOUNTANT · /admin/acct GET 만)는 못 봄.
 * ------------------------------------------------------------------- */

const SELF = ['REVIEWER', 'ADMIN', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF'] as const;   // SUPER 는 늘 통과 · 세무사 빠짐
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_RE = /^\d{1,18}$/;

/* ── v10.471 연장 근로 DTO ── */
export class HrxOtReqDto {
  @ApiProperty({ example: '2026-11-20', description: '일한 날(한국)' }) @Matches(YMD_RE) workOn!: string;
  @ApiProperty({ example: '18:00', description: '시작(HH:MM)' }) @Matches(HRX_HM_RE) startHm!: string;
  @ApiProperty({ example: '21:00', description: '끝(HH:MM · 시작보다 이르거나 같으면 다음 날)' }) @Matches(HRX_HM_RE) endHm!: string;
  @ApiProperty({ example: '월말 마감' }) @IsString() @Length(2, 200) reason!: string;
}
export class HrxOtForDto {
  @ApiProperty({ example: '1' }) @IsString() @Matches(ID_RE) employeeId!: string;
  @ApiProperty({ example: '2026-11-20' }) @Matches(YMD_RE) workOn!: string;
  @ApiProperty({ example: '18:00' }) @Matches(HRX_HM_RE) startHm!: string;
  @ApiProperty({ example: '21:00' }) @Matches(HRX_HM_RE) endHm!: string;
  @ApiProperty({ example: '긴급 출고' }) @IsString() @Length(2, 200) reason!: string;
}
export class HrxOtDecideDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) @IsIn(['APPROVE', 'REJECT']) decision!: string;
  @ApiPropertyOptional({ example: '업무 조정 가능', description: '반려는 사유 2자 이상' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class HrxOtRevokeDto {
  @ApiProperty({ example: '일정 바뀜' }) @IsString() @Length(2, 150) reason!: string;
}
export class HrxOtRulesDto {
  @ApiPropertyOptional({ example: 'OT:50,NIGHT:50,HOL:50,HOL8:100' }) @IsOptional() @IsString() @Matches(HRX_OT_RATES_RE) rates?: string;
  @ApiPropertyOptional({ example: 'BASE:40,OT:12,WARN:48' }) @IsOptional() @IsString() @Matches(HRX_WEEK_LIMITS_RE) weekLimits?: string;
  @ApiPropertyOptional({ example: 209 }) @IsOptional() @IsInt() @Min(100) @Max(249) stdHours?: number;
  @ApiPropertyOptional({ example: true, description: '주 연장 한도 넘는 승인 막기' }) @IsOptional() @IsBoolean() block?: boolean;
  @ApiPropertyOptional({ example: false, description: '토요일을 휴일로 셈' }) @IsOptional() @IsBoolean() satHoliday?: boolean;
  @ApiPropertyOptional({ enum: HRX_PAY_BASES }) @IsOptional() @IsIn(HRX_PAY_BASES as unknown as string[]) basis?: string;
  @ApiProperty({ example: '노무사 확인 반영' }) @IsString() @Length(2, 200) reason!: string;
}
export class HrxYmDto {
  @ApiProperty({ example: '2026-11' }) @Matches(YM_RE) ym!: string;
}

/* ── v10.472 근무표 DTO(칸 먼저) ── */
export class HrxShiftCellDto {
  @ApiProperty({ example: '1' }) @IsString() @Matches(ID_RE) employeeId!: string;
  @ApiProperty({ example: '2026-11-23' }) @Matches(YMD_RE) day!: string;
  @ApiPropertyOptional({ example: 'DAY', description: '교대 유형 코드 · 비우면(null) 칸을 지움' }) @IsOptional() @IsString() @Matches(HRX_SHIFT_CODE_RE) type?: string | null;
  @ApiPropertyOptional({ example: '교육' }) @IsOptional() @IsString() @Length(0, 100) note?: string | null;
}
export class HrxShiftSaveDto {
  @ApiProperty({ type: [HrxShiftCellDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => HrxShiftCellDto) cells!: HrxShiftCellDto[];
}
export class HrxShiftCopyDto {
  @ApiProperty({ example: '2026-11-23', description: '이 날이 든 주(월요일로 맞춤)에 지난주를 복사' }) @Matches(YMD_RE) week!: string;
}
export class HrxShiftTypeDto {
  @ApiPropertyOptional({ example: '주간' }) @IsOptional() @IsString() @Length(1, 30) name?: string;
  @ApiPropertyOptional({ enum: HRX_SHIFT_KINDS, description: '새 유형만 · 고칠 때 바꾸지 않음' }) @IsOptional() @IsIn(HRX_SHIFT_KINDS as unknown as string[]) kind?: string;
  @ApiPropertyOptional({ example: '09:00' }) @IsOptional() @Matches(HRX_HM_RE) startHm?: string | null;
  @ApiPropertyOptional({ example: '18:00' }) @IsOptional() @Matches(HRX_HM_RE) endHm?: string | null;
  @ApiPropertyOptional({ example: 60 }) @IsOptional() @IsInt() @Min(0) @Max(240) breakMin?: number;
  @ApiPropertyOptional({ example: true }) @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional({ example: 50 }) @IsOptional() @IsInt() @Min(0) @Max(9999) sort?: number;
}

/* ── v10.473 예약 DTO ── */
export class HrxBookDto {
  @ApiProperty({ example: '1' }) @IsString() @Matches(ID_RE) resourceId!: string;
  @ApiProperty({ example: '2026-11-24' }) @Matches(YMD_RE) day!: string;
  @ApiProperty({ example: '10:00' }) @Matches(HRX_HM_RE) startHm!: string;
  @ApiProperty({ example: '11:00' }) @Matches(HRX_HM_RE) endHm!: string;
  @ApiProperty({ example: '주간 회의' }) @IsString() @Length(1, 80) title!: string;
  @ApiPropertyOptional({ example: '빔 프로젝터 필요' }) @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class HrxBookCancelDto {
  @ApiPropertyOptional({ example: '회의 취소', description: '남의 예약을 취소할 때는 2자 이상' }) @IsOptional() @IsString() @Length(0, 200) reason?: string;
}
export class HrxResourceDto {
  @ApiPropertyOptional({ enum: HRX_RESOURCE_KINDS, description: '넣을 때만 · 고칠 때 바꾸지 않음' }) @IsOptional() @IsIn(HRX_RESOURCE_KINDS as unknown as string[]) kind?: string;
  @ApiPropertyOptional({ example: '회의실 A' }) @IsOptional() @IsString() @Length(1, 40) name?: string;
  @ApiPropertyOptional({ example: '3층' }) @IsOptional() @IsString() @Length(0, 60) location?: string | null;
  @ApiPropertyOptional({ example: 8 }) @IsOptional() @IsInt() @Min(1) @Max(500) capacity?: number | null;
  @ApiPropertyOptional({ example: 'TV · 화이트보드' }) @IsOptional() @IsString() @Length(0, 200) note?: string | null;
  @ApiPropertyOptional({ example: true }) @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional({ example: 10 }) @IsOptional() @IsInt() @Min(0) @Max(9999) sort?: number;
}

/* ── v10.474 자산 실사 DTO ── */
export class HrxStOpenDto {
  @ApiProperty({ example: '2026 하반기 실사' }) @IsString() @Length(2, 60) title!: string;
  @ApiPropertyOptional({ example: '2026-11-20', description: '기준일(비우면 오늘)' }) @IsOptional() @Matches(YMD_RE) asOf?: string;
  @ApiPropertyOptional({ example: '본사 · 창고' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class HrxStScanDto {
  @ApiProperty({ example: 'SGB-AST-000123', description: 'QR · 바코드 리더기로 읽은 글자 또는 코드 · 숫자' }) @IsString() @Length(1, 40) code!: string;
  @ApiPropertyOptional({ example: '3층 회의실' }) @IsOptional() @IsString() @Length(0, 60) location?: string;
}
export class HrxStLineDto {
  @ApiPropertyOptional({ enum: HRX_ST_RESULTS }) @IsOptional() @IsIn(HRX_ST_RESULTS as unknown as string[]) result?: string;
  @ApiPropertyOptional({ example: '창고' }) @IsOptional() @IsString() @Length(0, 60) location?: string | null;
  @ApiPropertyOptional({ example: '파손 · 수리 중' }) @IsOptional() @IsString() @Length(0, 200) note?: string | null;
}
export class HrxStCloseDto {
  @ApiPropertyOptional({ example: false, description: '확인 전 자산을 없음으로 바꾸고 닫음' }) @IsOptional() @IsBoolean() pendingAsMissing?: boolean;
}
export class HrxStDisposeDto {
  @ApiPropertyOptional({ type: [String], example: ['12'], description: '처분할 자산 번호(비우면 없음 자산 모두)' }) @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @Matches(ID_RE, { each: true }) assetIds?: string[];
  @ApiPropertyOptional({ example: '2026-11-20', description: '처분일(비우면 오늘 · 취득일보다 이르면 취득일)' }) @IsOptional() @Matches(YMD_RE) disposedOn?: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class HrxController {
  constructor(private readonly db: DatabaseService) {}

  private async viewer() {
    const id = RequestCtx.actorId() ?? '';
    const roles = id ? (await this.db.query<{ role: string }>(`SELECT role FROM account_roles WHERE account_id = $1::uuid`, [id])).map((r) => r.role) : [];
    return { id, roles };
  }

  /* ── 본인 ── */
  @Get('me/hrx')
  @Roles(...SELF)
  @ApiOperation({ summary: '내 연장 근로 · 근무표 (v10.471 · 472)', description: '내 연장 · 야간 · 휴일 근로 신청 40개 · 이번 주 합계 · 경고 · 이번 주 · 다음 주 근무표. 연결 안 됐으면 linked=false.' })
  @ApiOkResponse({ type: Object })
  async me() {
    const a = RequestCtx.actorId() ?? null;
    const [ot, sh] = [await myOvertime(this.db, a), await myShifts(this.db, a)];
    return { linked: ot.linked, overtime: ot, shifts: sh };
  }

  @Post('me/hrx/overtime')
  @Roles(...SELF)
  @HttpCode(200)
  @ApiOperation({ summary: '연장 · 야간 · 휴일 근로 신청 (v10.471)', description: '앞뒤 31일 · 10분 ~ 16시간 · 끝 ≤ 시작이면 다음 날 · 분 · 야간 분 · 날 종류는 DB 가 셈 · 겹치면 409 · 주 한도에 가까우면 warning.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRX_OT_OVERLAP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HR_NOT_LINKED · HRX_OT_DATE · HRX_OT_TIME · HRX_OT_REASON' })
  otMine(@Body() dto: HrxOtReqDto) { return requestMyOvertime(this.db, RequestCtx.actorId() ?? null, dto); }

  @Post('me/hrx/overtime/:id/cancel')
  @Roles(...SELF)
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '내 연장 근로 신청 취소 (v10.471)', description: '승인 전만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRX_OT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HR_NOT_LINKED' })
  otCancel(@Param('id') id: string) { return cancelMyOvertime(this.db, RequestCtx.actorId() ?? null, id); }

  /* ── v10.471 연장 근로(관리자) ── */
  @Get('hrx/overtime')
  @Roles('ADMIN')
  @ApiQuery({ name: 'state', required: false, enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELED'] })
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '연장 근로 목록 (v10.471)', description: '그 달 + 신청 중 · 근태와 비교(겹친 분 · 근태 없음 · 짧음) · 예상 수당 · 직원별 주 합계 · 경고 · 규칙.' })
  @ApiOkResponse({ type: Object })
  otList(@Query('state') state?: string, @Query('ym') ym?: string) { return overtimeList(this.db, state, ym); }

  @Post('hrx/overtime')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HRX_OT_REQUEST_FOR', 'SETTING')
  @ApiOperation({ summary: '연장 근로 대신 신청 (v10.471)', description: '관리자가 직원 대신 · 본인 것은 내 인사에서 · 승인은 따로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRX_OT_OVERLAP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_OT_DATE · HRX_OT_TIME · HRX_OT_REASON' })
  otFor(@Body() dto: HrxOtForDto) {
    return requestOvertimeFor(this.db, dto.employeeId, { workOn: dto.workOn, startHm: dto.startHm, endHm: dto.endHm, reason: dto.reason }, RequestCtx.actorId() ?? null);
  }

  @Post('hrx/overtime/:id/decide')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HRX_OT_DECIDE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '연장 근로 승인 · 반려 (v10.471)', description: '본인 신청 아님 · 승인 합이 주 연장 한도(hrx.week_limits OT)를 넘으면 422(hrx.ot_over_block on) · 반려는 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRX_OT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_OT_LIMIT · HRX_OT_REASON · HRX_OT_DECISION' })
  otDecide(@Param('id') id: string, @Body() dto: HrxOtDecideDto) { return decideOvertime(this.db, id, dto.decision, dto.note, RequestCtx.actorId() ?? null); }

  @Post('hrx/overtime/:id/revoke')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HRX_OT_REVOKE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '연장 근로 승인 취소 (v10.471)', description: '승인한 것만 · 본인 아님 · 사유 · 급여 대장에 넘긴 것은 409.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRX_OT_STATE · HRX_OT_PAID' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_OT_REASON' })
  otRevoke(@Param('id') id: string, @Body() dto: HrxOtRevokeDto) { return revokeOvertime(this.db, id, dto.reason, RequestCtx.actorId() ?? null); }

  @Put('hrx/overtime/rules')
  @Roles('SUPER')
  @Audit('HRX_OT_RULES', 'SETTING')
  @ApiOperation({ summary: '연장 근로 가산율 · 한도 고치기 (v10.471 · SUPER)', description: '가산율 · 주 한도 · 통상시급 나눗수 · 한도 넘는 승인 막기 · 토요일 휴일 · 수당 기준 — 보낸 것만 · 사유(설정 바뀜 기록).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_OT_RULE · HRX_OT_REASON' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  otRulesSet(@Body() dto: HrxOtRulesDto) {
    return setOtRules(this.db, { rates: dto.rates, weekLimits: dto.weekLimits, stdHours: dto.stdHours, block: dto.block, satHoliday: dto.satHoliday, basis: dto.basis, reason: dto.reason });
  }

  @Get('hrx/overtime/payroll')
  @Roles('ADMIN')
  @ApiQuery({ name: 'ym', required: true, example: '2026-11' })
  @ApiOperation({ summary: '연장 근로 → 급여 대장 미리보기 (v10.471)', description: '그 달 승인분 · 넘길 것 · 넘긴 것 · 직원별 합계 · 급여 대장 상태.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_PERIOD' })
  otPayroll(@Query('ym') ym: string) { return overtimePayroll(this.db, ym); }

  @Post('hrx/overtime/payroll')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('HRX_OT_PAYROLL', 'SETTING')
  @ApiOperation({ summary: '연장 근로 수당을 급여 대장으로 (v10.471 · SUPER)', description: '그 달 초안 급여 대장 지급액에 더하고 다시 셈 · 신청 하나 한 번 · 급여 줄 없는 직원은 건너뜀.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRX_OT_RUN_FIXED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_OT_NO_RUN · ACCT_PERIOD' })
  otPush(@Body() dto: HrxYmDto) { return pushOvertimePayroll(this.db, dto.ym, RequestCtx.actorId() ?? null); }

  @Post('hrx/overtime/payroll/undo')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('HRX_OT_PAYROLL_UNDO', 'SETTING')
  @ApiOperation({ summary: '급여 대장 넘김 되돌리기 (v10.471 · SUPER)', description: '초안 급여 대장만 · 지급액에서 빼고 다시 셈 · 넘김 기록 지움.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRX_OT_RUN_FIXED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_OT_NO_RUN · ACCT_PERIOD' })
  otUndo(@Body() dto: HrxYmDto) { return undoOvertimePayroll(this.db, dto.ym); }

  /* ── v10.472 근무표 ── */
  @Get('hrx/shifts')
  @Roles('ADMIN')
  @ApiQuery({ name: 'week', required: false, example: '2026-11-23', description: '이 날이 든 주(월 ~ 일) · 비우면 이번 주' })
  @ApiOperation({ summary: '주 근무표 (v10.472)', description: '직원 × 7일 칸 · 근태(출퇴근) · 다름 표시(근태 없음 · 휴가 · 늦음 · 일찍 감 · 퇴근 없음 · 근무표에 없는 날 일함) · 주 계획 시간 · 교대 유형.' })
  @ApiOkResponse({ type: Object })
  shifts(@Query('week') week?: string) { return shiftWeek(this.db, week); }

  @Put('hrx/shifts')
  @Roles('ADMIN')
  @Audit('HRX_SHIFT_SAVE', 'SETTING')
  @ApiOperation({ summary: '근무표 칸 저장 (v10.472)', description: '1 ~ 500칸 · type 비우면 지움 · 7일 넘게 지난 칸 422 · 입사 ~ 퇴사 밖 422.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_SHIFT_PAST · HRX_SHIFT_TYPE · HRX_SHIFT_CELLS' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  shiftSave(@Body() dto: HrxShiftSaveDto) {
    return setShifts(this.db, dto.cells.map((c) => ({ employeeId: c.employeeId, day: c.day, type: c.type ?? null, note: c.note ?? null })), RequestCtx.actorId() ?? null);
  }

  @Post('hrx/shifts/copy')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HRX_SHIFT_COPY', 'SETTING')
  @ApiOperation({ summary: '지난주 근무표 복사 (v10.472)', description: '이 주의 빈 칸에만 · 쓰는 유형 · 그날 다니는 직원만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_SHIFT_PAST · HRX_SHIFT_CELLS' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  shiftCopy(@Body() dto: HrxShiftCopyDto) { return copyLastWeek(this.db, dto.week, RequestCtx.actorId() ?? null); }

  @Put('hrx/shifts/types/:code')
  @Roles('SUPER')
  @Audit('HRX_SHIFT_TYPE', 'SETTING')
  @ApiParam({ name: 'code', example: 'DAY' })
  @ApiOperation({ summary: '교대 유형 넣기 · 고치기 (v10.472 · SUPER)', description: '보낸 칸만 · 근무 · 휴무 종류는 못 바꿈 · 이미 넣은 칸은 그대로(칸에 시각을 옮겨 적음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_SHIFT_TYPE' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  shiftType(@Param('code') code: string, @Body() dto: HrxShiftTypeDto) {
    return setShiftType(this.db, code, { name: dto.name, kind: dto.kind, startHm: dto.startHm, endHm: dto.endHm, breakMin: dto.breakMin, active: dto.active, sort: dto.sort }, RequestCtx.actorId() ?? null);
  }

  /* ── v10.473 회의실 · 장비 예약 ── */
  @Get('hrx/booking')
  @Roles(...SELF)
  @ApiQuery({ name: 'from', required: false, example: '2026-11-24' })
  @ApiQuery({ name: 'to', required: false, example: '2026-11-28', description: '14일까지 · 비우면 하루' })
  @ApiOperation({ summary: '예약 현황 (v10.473)', description: '자원(회의실 · 장비) · 기간 안 살아 있는 예약 · 내 것 · 취소할 수 있는지 · 규칙.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_BOOK_RANGE' })
  async booking(@Query('from') from?: string, @Query('to') to?: string) { return bookingBoard(this.db, await this.viewer(), from, to); }

  @Post('hrx/booking')
  @Roles(...SELF)
  @HttpCode(200)
  @ApiOperation({ summary: '회의실 · 장비 예약 (v10.473)', description: '같은 날 · [시작, 끝) · 겹치면 409(서버가 먼저 찾고 · 동시에 눌러도 DB 배제 제약이 하나만 받음) · 지난 시각 · 너무 먼 날 · 너무 긴 예약 422.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRX_BOOK_OVERLAP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_BOOK_TIME · HRX_BOOK_TITLE · HRX_BOOK_RESOURCE' })
  async book(@Body() dto: HrxBookDto) { return createBooking(this.db, dto, await this.viewer()); }

  @Post('hrx/booking/:id/cancel')
  @Roles(...SELF)
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '예약 취소 (v10.473)', description: '예약한 사람 · ADMIN · SUPER · 끝나기 전 · 남의 예약은 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRX_BOOK_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_BOOK_REASON' })
  async bookCancel(@Param('id') id: string, @Body() dto: HrxBookCancelDto) { return cancelBooking(this.db, id, dto.reason, await this.viewer()); }

  @Post('hrx/booking/resources')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HRX_RESOURCE_ADD', 'SETTING')
  @ApiOperation({ summary: '예약 자원 넣기 (v10.473)', description: '회의실(ROOM · 인원) · 장비(EQUIP) · 이름 고유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRX_RESOURCE_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_RESOURCE' })
  resAdd(@Body() dto: HrxResourceDto) {
    return addResource(this.db, { kind: dto.kind, name: dto.name, location: dto.location, capacity: dto.capacity, note: dto.note, sort: dto.sort }, RequestCtx.actorId() ?? null);
  }

  @Put('hrx/booking/resources/:id')
  @Roles('ADMIN')
  @Audit('HRX_RESOURCE_SET', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '예약 자원 고치기 (v10.473)', description: '보낸 칸만 · 종류는 못 바꿈 · 쓰지 않음으로 해도 앞으로의 예약은 그대로(개수 알림).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRX_RESOURCE_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_RESOURCE' })
  resSet(@Param('id') id: string, @Body() dto: HrxResourceDto) {
    return updateResource(this.db, id, { kind: dto.kind, name: dto.name, location: dto.location, capacity: dto.capacity, note: dto.note, active: dto.active, sort: dto.sort }, RequestCtx.actorId() ?? null);
  }

  /* ── v10.474 자산 실사 ── */
  @Get('hrx/stocktakes')
  @Roles('ADMIN', 'PAYOUT')
  @ApiOperation({ summary: '자산 실사 회차 목록 (v10.474)', description: '회차마다 전체 · 찾음 · 없음 · 확인 전 · 처분 수 · 쓰는 고정자산 수.' })
  @ApiOkResponse({ type: Object })
  stList() { return stocktakes(this.db); }

  @Post('hrx/stocktakes')
  @Roles('ADMIN', 'PAYOUT')
  @HttpCode(200)
  @Audit('HRX_STOCKTAKE_OPEN', 'SETTING')
  @ApiOperation({ summary: '자산 실사 회차 열기 (v10.474)', description: '기준일까지 취득한 쓰는 고정자산을 모두 「확인 전」으로 넣음 · 자산이 없으면 422.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_ST_TITLE · HRX_ST_DATE · HRX_ST_EMPTY' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  stOpen(@Body() dto: HrxStOpenDto) { return openStocktake(this.db, { title: dto.title, asOf: dto.asOf, note: dto.note }, RequestCtx.actorId() ?? null); }

  @Get('hrx/stocktakes/:id')
  @Roles('ADMIN', 'PAYOUT')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '자산 실사 회차 (v10.474)', description: '자산 줄(코드 · 이름 · 결과 · 둔 곳 · 처분) · 셈 · 처분할 수 있는 없음 자산 수.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  stOne(@Param('id') id: string) { return stocktakeDetail(this.db, id); }

  @Post('hrx/stocktakes/:id/scan')
  @Roles('ADMIN', 'PAYOUT')
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: 'QR · 코드 읽기 → 찾음 (v10.474)', description: 'SGB-AST-000123 · AST-123 · 숫자 · 회차에 없으면 404 · 닫은 회차 409 · 두 번 읽으면 again=true.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRX_ST_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_ST_CODE' })
  stScan(@Param('id') id: string, @Body() dto: HrxStScanDto) { return scanAsset(this.db, id, dto.code, dto.location, RequestCtx.actorId() ?? null); }

  @Put('hrx/stocktakes/:id/lines/:assetId')
  @Roles('ADMIN', 'PAYOUT')
  @ApiParam({ name: 'id', example: '1' })
  @ApiParam({ name: 'assetId', example: '12' })
  @ApiOperation({ summary: '자산 실사 줄 적기 (v10.474)', description: '찾음 · 없음 · 확인 전 · 둔 곳 · 메모(보낸 칸만) · 열린 회차만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRX_ST_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_ST_RESULT' })
  stLine(@Param('id') id: string, @Param('assetId') assetId: string, @Body() dto: HrxStLineDto) {
    return markLine(this.db, id, assetId, { result: dto.result, location: dto.location, note: dto.note }, RequestCtx.actorId() ?? null);
  }

  @Post('hrx/stocktakes/:id/close')
  @Roles('ADMIN', 'PAYOUT')
  @HttpCode(200)
  @Audit('HRX_STOCKTAKE_CLOSE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '자산 실사 회차 닫기 (v10.474)', description: '확인 전이 남으면 422 · pendingAsMissing 이면 없음으로 바꾸고 닫음 · 닫으면 못 고침.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRX_ST_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_ST_PENDING' })
  stClose(@Param('id') id: string, @Body() dto: HrxStCloseDto) { return closeStocktake(this.db, id, dto.pendingAsMissing === true, RequestCtx.actorId() ?? null); }

  @Post('hrx/stocktakes/:id/dispose')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('HRX_STOCKTAKE_DISPOSE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '없어진 자산 처분 (v10.474 · SUPER)', description: '닫은 회차의 없음 자산 · 받은 돈 0 · 사유 실사 · ⑬ 고정자산 처분과 같음(처분 달 전까지 상각) → 다음 전표 작업에서 처분 손실 전표 · 되돌리지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HRX_ST_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HRX_ST_NOTHING · ACCT_DATE' })
  stDispose(@Param('id') id: string, @Body() dto: HrxStDisposeDto) { return disposeMissing(this.db, id, { assetIds: dto.assetIds, disposedOn: dto.disposedOn }); }

  @Get('hrx/asset-labels')
  @Roles('ADMIN', 'PAYOUT')
  @ApiQuery({ name: 'ids', required: false, example: '12,13', description: '자산 번호(쉼표) · 비우면 쓰는 자산 모두(200개까지)' })
  @ApiOperation({ summary: '고정자산 QR 라벨 자료 (v10.474)', description: '자산 번호 · 이름 · 분류 · 취득일 · 코드(SGB-AST-번호) — QR 그림은 화면이 그림(인쇄 창).' })
  @ApiOkResponse({ type: Object })
  labels(@Query('ids') ids?: string) { return assetLabels(this.db, ids); }
}
