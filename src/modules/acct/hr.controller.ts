import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { MailService } from '../../common/mail/mail.service';
import { ExportGate } from '../admin/export-approval';
import { toCsv } from './acct.controller';
import { addAttendance, attendanceMonth, cancelMyLeave, clock, confirmMonth, decideLeave, fixAttendance, leaveRequests, linkAccount, myHr, requestLeave, revokeLeave } from './hr';
import { myPayslip, notifyPayslips, payslipOne, payslips } from './payslip';
import { YE_ITEMS, setYearendCheck, yearendCsv, yearendView } from './yearend';
import { hrCard } from './hr-card';   // v10.559 (docs/698) 사원 카드
import { hrCardSelf } from './hr-card-self';   // v10.567 (docs/709) 내 사원 카드(본인)
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * ㉖ 인사 2 (D259 · docs/582 ~ 585) — 대표 11/20 「다음개발」
 *   본인(운영 역할 누구나 · 직원과 연결된 계정 · 세무사 제외)
 *     GET  /admin/me/hr                       내 인사 — 오늘 근태 · 이번 달 · 남은 연차 · 휴가 신청 · 명세서 목록
 *     POST /admin/me/hr/clock                 출근(IN) · 퇴근(OUT)
 *     POST /admin/me/hr/leave                 휴가 신청(종일 · 오전 · 오후 반차)
 *     POST /admin/me/hr/leave/{id}/cancel     내 신청 취소(승인 전)
 *     GET  /admin/me/hr/payslips/{lineId}     내 급여명세서
 *     GET  /admin/me/hr/card                  내 사원 카드(v10.567 · 읽기만 · 본인)
 *   관리자(ADMIN · SUPER) — v10.445 · 446
 *     GET  /admin/hr/attendance?ym=           달 근태 · 집계 · 고침 기록
 *     POST /admin/hr/attendance/{id}/fix      시각 고침(본인 줄 아님 · 사유)
 *     POST /admin/hr/attendance/add           빠진 날 넣기(본인 아님 · 사유)
 *     POST /admin/hr/attendance/confirm       달 확인(확인 뒤 못 고침)
 *     GET  /admin/hr/leave?state=             휴가 신청 목록
 *     POST /admin/hr/leave/{id}/decide        승인 · 반려(본인 신청 아님 · 승인 = 연차 쓴 날)
 *     POST /admin/hr/leave/{id}/revoke        승인 취소(음수 줄)
 *     PUT  /admin/hr/employees/{id}/account   직원 ↔ 운영 계정 연결(SUPER)
 *   급여 · 세무(SUPER · 지급 담당 · 세무사 읽기) — v10.447 · 448
 *     GET  /admin/acct/payslips?ym= · /admin/acct/payslips/{lineId} · POST /admin/acct/payslips/notify(SUPER · acct.payslip_mail)
 *     GET  /admin/acct/yearend?year= · POST /admin/acct/yearend/checks · GET /admin/acct/yearend/export(내려받기 승인 ACCT_TAX)
 *   근태 · 휴가는 /admin/hr 아래라 세무사(ACCOUNTANT · /admin/acct GET 만)는 못 봄.
 * ------------------------------------------------------------------- */

const SELF = ['REVIEWER', 'ADMIN', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF'] as const;   // SUPER 는 늘 통과 · 세무사 빠짐
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class HrClockDto {
  @ApiProperty({ enum: ['IN', 'OUT'] }) @IsIn(['IN', 'OUT']) kind!: string;
  @ApiPropertyOptional({ example: '외근 뒤 퇴근' }) @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class HrLeaveReqDto {
  @ApiProperty({ example: '2026-12-24' }) @Matches(YMD_RE) startOn!: string;
  @ApiPropertyOptional({ example: '2026-12-26', description: '종일이면 끝 날(비우면 하루)' }) @IsOptional() @Matches(YMD_RE) endOn?: string;
  @ApiPropertyOptional({ enum: ['FULL', 'AM', 'PM'], description: 'FULL 종일 · AM 오전 반차 · PM 오후 반차(반차는 하루 · 0.5일)' }) @IsOptional() @IsIn(['FULL', 'AM', 'PM']) half?: string;
  @ApiPropertyOptional({ example: '가족 행사' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class HrLeaveDecideDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) @IsIn(['APPROVE', 'REJECT']) decision!: string;
  @ApiPropertyOptional({ example: '연말 일정 겹침', description: '반려는 사유 2자 이상' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class HrLeaveRevokeDto {
  @ApiProperty({ example: '일정 바뀜' }) @IsString() @Length(2, 150) reason!: string;
}
export class HrAttendFixDto {
  @ApiProperty({ example: '09:00', description: '출근 시각(한국 · HH:MM)' }) @Matches(HM_RE) inAt!: string;
  @ApiPropertyOptional({ example: '18:00', description: '퇴근 시각(출근보다 이르면 다음 날 · 비우면 없음)' }) @IsOptional() @Matches(HM_RE) outAt?: string;
  @ApiProperty({ example: '퇴근 누르기 잊음' }) @IsString() @Length(2, 200) reason!: string;
}
export class HrAttendAddDto {
  @ApiProperty({ example: '1' }) @IsString() @Matches(/^\d{1,18}$/) employeeId!: string;
  @ApiProperty({ example: '2026-11-19' }) @Matches(YMD_RE) workOn!: string;
  @ApiProperty({ example: '09:00' }) @Matches(HM_RE) inAt!: string;
  @ApiPropertyOptional({ example: '18:00' }) @IsOptional() @Matches(HM_RE) outAt?: string;
  @ApiProperty({ example: '출근 누르기 잊음' }) @IsString() @Length(2, 200) reason!: string;
}
export class HrAttendConfirmDto {
  @ApiProperty({ example: '2026-11' }) @Matches(YM_RE) ym!: string;
  @ApiPropertyOptional({ example: '1', description: '한 직원만(비우면 모두)' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) employeeId?: string;
}
export class HrLinkDto {
  @ApiPropertyOptional({ example: 'staff@sogaebank.com', description: '운영 역할이 있는 계정 메일 · 비우면 연결 풂' }) @IsOptional() @IsString() @Length(0, 200) email?: string;
}
export class PayslipNotifyDto {
  @ApiProperty({ example: '2026-11' }) @Matches(YM_RE) ym!: string;
}
export class YearendCheckDto {
  @ApiProperty({ example: '1' }) @IsString() @Matches(/^\d{1,18}$/) employeeId!: string;
  @ApiProperty({ example: 2026 }) @IsInt() @Min(2000) @Max(2100) year!: number;
  @ApiProperty({ enum: YE_ITEMS }) @IsIn(YE_ITEMS as unknown as string[]) item!: string;
  @ApiProperty({ example: true }) @StrictBoolean() done!: boolean;
  @ApiPropertyOptional({ example: '1/20 메일로 받음' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class HrController {
  constructor(private readonly db: DatabaseService, private readonly mail: MailService) {}

  /* ── 본인 ── */
  @Get('me/hr')
  @Roles(...SELF)
  @ApiOperation({ summary: '내 인사 (v10.445 ~ 447)', description: '연결된 직원의 오늘 근태 · 이번 달 근태 · 남은 연차 · 휴가 신청 · 급여명세서 목록. 연결 안 됐으면 linked=false.' })
  @ApiOkResponse({ type: Object })
  me() { return myHr(this.db, RequestCtx.actorId() ?? null); }

  @Post('me/hr/clock')
  @Roles(...SELF)
  @HttpCode(200)
  @ApiOperation({ summary: '출근 · 퇴근 (v10.445)', description: '하루 한 번씩 · 퇴근은 24시간 안 가장 최근 출근 줄(밤샘) · 잘못 누르면 관리자 고침.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ATTEND_DONE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HR_NOT_LINKED · ATTEND_NO_IN' })
  clock(@Body() dto: HrClockDto) { return clock(this.db, RequestCtx.actorId() ?? null, dto.kind, dto.memo); }

  @Post('me/hr/leave')
  @Roles(...SELF)
  @HttpCode(200)
  @ApiOperation({ summary: '휴가 신청 (v10.446)', description: '영업일만 셈 · 반차 0.5 · 겹치면 409 · 해를 넘으면 나눠서 · 30일 넘게 지난 날 안 됨.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LEAVE_OVERLAP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HR_NOT_LINKED · LEAVE_DATE · LEAVE_YEAR · LEAVE_NO_DAYS' })
  leave(@Body() dto: HrLeaveReqDto) { return requestLeave(this.db, RequestCtx.actorId() ?? null, dto); }

  @Post('me/hr/leave/:id/cancel')
  @Roles(...SELF)
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '내 휴가 신청 취소 (v10.446)', description: '승인 전만 · 승인된 휴가는 관리자가 승인 취소.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LEAVE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HR_NOT_LINKED' })
  cancelLeave(@Param('id') id: string) { return cancelMyLeave(this.db, RequestCtx.actorId() ?? null, id); }

  @Get('me/hr/payslips/:lineId')
  @Roles(...SELF)
  @ApiParam({ name: 'lineId', example: '1' })
  @ApiOperation({ summary: '내 급여명세서 (v10.447)', description: '본인 급여 줄(확정 · 지급)만 · 인쇄용.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HR_NOT_LINKED' })
  mySlip(@Param('lineId') lineId: string) { return myPayslip(this.db, RequestCtx.actorId() ?? null, lineId); }

  /* v10.567 (docs/709) 내 사원 카드 — 본인 것만(직원 번호를 받지 않음) · 감사 · 열람 사유 없음(본인 · 베끼는 개인정보 없음) */
  @Get('me/hr/card')
  @Roles(...SELF)
  @ApiOperation({ summary: '내 사원 카드 (v10.567)', description: '로그인한 계정에 연결된 직원의 기본 · 근태 · 연차 · 휴가 신청 · 내 급여명세서 목록(금액 없음 · lineId) · 근로계약서 상태 · 의무교육 · 평가(닫힌 차례의 내 결과만 · 의견 없음) · 연장 근로 · 이번 주 근무표. 퇴직금 추계 없음. 연결 안 됐으면 200 + linked=false.' })
  @ApiOkResponse({ type: Object })
  myCard() { return hrCardSelf(this.db, RequestCtx.actorId() ?? null); }

  /* ── v10.445 근태(관리자) ── */
  @Get('hr/attendance')
  @Roles('ADMIN')
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '달 근태 (v10.445)', description: '날마다 출근 · 퇴근 · 일한 분 · 늦음(hr.work_start) · 고침 · 확인 + 직원별 집계(일한 날 · 시간 · 늦음 · 퇴근 없음 · 휴가 일수) + 고침 기록 50줄.' })
  @ApiOkResponse({ type: Object })
  attendance(@Query('ym') ym?: string) { return attendanceMonth(this.db, ym); }

  @Post('hr/attendance/:id/fix')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_ATTEND_FIX', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '근태 시각 고침 (v10.445)', description: '확인 전 · 본인 줄 아님 · 사유 · 앞뒤 시각을 고침 기록에 남김.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ATTEND_CONFIRMED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ATTEND_REASON · ATTEND_TIME' })
  fix(@Param('id') id: string, @Body() dto: HrAttendFixDto) { return fixAttendance(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Post('hr/attendance/add')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_ATTEND_ADD', 'SETTING', { pick: ['ok', 'id'] })
  @ApiOperation({ summary: '빠진 근태 넣기 (v10.445)', description: '본인 아님 · 사유 · 오늘까지 · 입사 ~ 퇴사 안 · 그날 줄이 있으면 409.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ATTEND_DONE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ATTEND_DATE · ATTEND_REASON · ATTEND_TIME' })
  add(@Body() dto: HrAttendAddDto) { return addAttendance(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('hr/attendance/confirm')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_ATTEND_CONFIRM', 'SETTING')
  @ApiOperation({ summary: '달 근태 확인 (v10.445)', description: '퇴근까지 있는 줄만 · 확인하는 사람 본인 줄은 빼고 · 확인 뒤 고치지 못함.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ATTEND_CONFIRMED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_PERIOD' })
  confirm(@Body() dto: HrAttendConfirmDto) { return confirmMonth(this.db, dto.ym, dto.employeeId, RequestCtx.actorId() ?? null); }

  @Put('hr/employees/:id/account')
  @Roles('SUPER')
  @Audit('HR_EMPLOYEE_LINK', 'SETTING', { pick: ['ok', 'employeeId', 'accountId'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '직원 ↔ 운영 계정 연결 (v10.445 · SUPER)', description: '운영 역할이 있는 계정만 · 한 계정은 한 직원 · 메일을 비우면 연결 풂.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HR_LINK_TAKEN' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HR_LINK' })
  link(@Param('id') id: string, @Body() dto: HrLinkDto) { return linkAccount(this.db, id, dto.email); }

  /* ── v10.559 (docs/698) 사원 카드 — 읽기만 · 급여 탭과 같은 범위(SUPER · 지급 담당) · /admin/hr 아래라 세무사는 못 봄 ── */
  @Get('hr/employees/:id/card')
  @Roles('SUPER', 'PAYOUT')
  @Audit('HR_CARD_VIEW', 'ACCOUNT', { idOnly: true })   // 급여 · 퇴직금은 감사 기록에 베끼지 않음(직원 번호만)
  @ApiParam({ name: 'id', example: '1' })
  @ApiHeader({ name: 'X-PII-Reason', required: false, description: '개인정보 열람 사유(INQUIRY · DISPUTE · SETTLEMENT · REVIEW · LEGAL · OTHER:<글>) — 없으면 「미입력」으로 남김(막지 않음)' })
  @ApiOperation({ summary: '사원 카드 (v10.559)', description: '직원 한 사람의 기본 · 근태 · 휴가 · 급여(최근 6개월 · 퇴직금 추계) · 계약 · 의무교육 · 평가 · 연장 근로 · 이번 주 근무표를 한 장에. 주민등록번호 · 계좌 · 계약서 본문 없음. **조회 자체가 감사(HR_CARD_VIEW)와 개인정보 접속기록에 남습니다.**' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  card(@Param('id') id: string, @Headers('x-pii-reason') reason?: string) { return hrCard(this.db, id, reason); }

  /* ── v10.446 휴가(관리자) ── */
  @Get('hr/leave')
  @Roles('ADMIN')
  @ApiQuery({ name: 'state', required: false, enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELED'] })
  @ApiOperation({ summary: '휴가 신청 목록 (v10.446)', description: '신청 먼저 · 남은 연차 · 승인 · 반려 기록 · 300줄.' })
  @ApiOkResponse({ type: Object })
  leaveList(@Query('state') state?: string) { return leaveRequests(this.db, state); }

  @Post('hr/leave/:id/decide')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_LEAVE_DECIDE', 'SETTING', { pick: ['ok', 'id', 'state', 'days', 'remaining'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '휴가 승인 · 반려 (v10.446)', description: '본인 신청 아님 · 승인하면 연차 쓴 날에 날마다 한 줄 · 남은 연차보다 많으면 422(hr.leave_allow_negative off) · 반려는 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LEAVE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LEAVE_SHORT · LEAVE_REASON · LEAVE_DECISION' })
  decide(@Param('id') id: string, @Body() dto: HrLeaveDecideDto) { return decideLeave(this.db, id, dto.decision, dto.note, RequestCtx.actorId() ?? null); }

  @Post('hr/leave/:id/revoke')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('HR_LEAVE_REVOKE', 'SETTING', { pick: ['ok', 'id', 'state', 'returned'] })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '휴가 승인 취소 (v10.446)', description: '승인된 휴가만 · 본인 아님 · 사유 · 연차 쓴 날을 음수 줄로 되돌림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'LEAVE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'LEAVE_REASON' })
  revoke(@Param('id') id: string, @Body() dto: HrLeaveRevokeDto) { return revokeLeave(this.db, id, dto.reason, RequestCtx.actorId() ?? null); }

  /* ── v10.447 급여명세서 ── */
  @Get('acct/payslips')
  @Roles('PAYOUT')
  @ApiQuery({ name: 'ym', required: false, example: '2026-11', description: '비우면 가장 최근 확정한 달' })
  @ApiOperation({ summary: '급여명세서 목록 (v10.447)', description: '확정 · 지급한 달 · 직원별 지급 · 공제 · 실지급 · 계정 연결 · 알림 메일 상태.' })
  @ApiOkResponse({ type: Object })
  slips(@Query('ym') ym?: string) { return payslips(this.db, ym); }

  @Get('acct/payslips/:lineId')
  @Roles('PAYOUT')
  @ApiParam({ name: 'lineId', example: '1' })
  @ApiOperation({ summary: '급여명세서 한 장 (v10.447 · 인쇄용)', description: '지급 · 공제 · 실지급 · 회사 부담(참고).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  slip(@Param('lineId') lineId: string) { return payslipOne(this.db, lineId); }

  @Post('acct/payslips/notify')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_PAYSLIP_NOTIFY', 'SETTING')
  @ApiOperation({ summary: '급여명세서 알림 메일 (v10.447 · SUPER)', description: 'acct.payslip_mail on 일 때만 · 연결된 직원 계정 메일로 「명세서가 나왔습니다」(금액 없음) · 줄마다 한 번.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PAYSLIP_MAIL_OFF · PAYSLIP_NO_RUN · ACCT_PERIOD' })
  notify(@Body() dto: PayslipNotifyDto) { return notifyPayslips(this.db, this.mail, dto.ym, RequestCtx.actorId() ?? null); }

  /* ── v10.448 연말정산 자료 ── */
  @Get('acct/yearend')
  @Roles('PAYOUT')
  @ApiQuery({ name: 'year', required: true, example: '2026' })
  @ApiOperation({ summary: '연말정산 자료 모음 (v10.448)', description: '직원별 해 합계(총급여 · 비과세 · 기납부 세액 · 4대보험) · 달별 · 부양가족 · 서류 받음 표시 · 안 받은 서류.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_PERIOD' })
  yearend(@Query('year') year: string) { return yearendView(this.db, year); }

  @Post('acct/yearend/checks')
  @Roles('PAYOUT')
  @HttpCode(200)
  @Audit('ACCT_YEAREND_CHECK', 'SETTING', { pick: ['ok', 'id'] })
  @ApiOperation({ summary: '연말정산 서류 받음 표시 (v10.448)', description: '쌓기만 · 마지막 줄이 지금 상태 · 서류 파일은 받지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'YEAREND_ITEM · ACCT_PERIOD' })
  check(@Body() dto: YearendCheckDto) { return setYearendCheck(this.db, dto, RequestCtx.actorId() ?? null); }

  @Get('acct/yearend/export')
  @Roles('PAYOUT')
  @ExportGate('ACCT_TAX')
  @ApiQuery({ name: 'year', required: true, example: '2026' })
  @ApiOperation({ summary: '연말정산 자료 CSV (v10.448 · 내려받기 승인)', description: '직원별 해 합계 · 달별 총급여 · 안 받은 서류 · 주민등록번호 칸은 비움.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL · ACCT_PERIOD' })
  async yearendExport(@Query('year') year: string) {
    const v = await yearendView(this.db, year);
    const { head, body } = yearendCsv(v);
    return { filename: `yearend-${v.year}.csv`, csv: toCsv(head, body), rows: body.length, note: `${v.year} 연말정산 자료를 내려받았습니다.` };
  }
}
