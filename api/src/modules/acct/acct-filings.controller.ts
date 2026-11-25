/* e3 (docs/010) 소개뱅크 src/modules/acct/acct-filings.controller.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { ExportGate } from '../admin/export-approval';
import { toCsv } from './acct.controller';
import { insuranceFilings, markInsuranceDone, wageCsv, wageReceipt, wageStatements, whtReturn, whtReturnCsv } from './filings';

/* ---------------------------------------------------------------------
 * ⑲ v10.420 ~ 422 (D252 · docs/557 ~ 559) 세무 · 노무 신고 자료 — 운영 화면 회계 › 세무 · 인사
 *   v10.420  GET  /admin/acct/tax/wht-return?ym=                    원천세 이행상황신고서 미리보기(A01 · A20 · A25 · A99 · 납부 기한)
 *            GET  /admin/acct/tax/wht-return/export?ym=             같은 것 CSV(내려받기 승인 ACCT_TAX)
 *   v10.421  GET  /admin/acct/payroll/statements?period=            지급명세서(해 · 반기 · 달 · 직원별)
 *            GET  /admin/acct/payroll/statements/export?period=     같은 것 CSV(내려받기 승인 ACCT_TAX · 주민등록번호 칸은 빈 칸)
 *            GET  /admin/acct/payroll/statements/{employeeId}/receipt?year=   원천징수영수증 한 장(인쇄용)
 *   v10.422  GET  /admin/acct/payroll/insurance                     4대보험 취득 · 상실 신고 자료 · 기한
 *            POST /admin/acct/payroll/insurance/done                처리함(SUPER · 한 번 · 쌓기만 · 감사 ACCT_INSURANCE_DONE)
 *   보기 SUPER · PAYOUT(다른 회계 화면과 같음).
 * ------------------------------------------------------------------- */

const VIEW = ['SUPER', 'PAYOUT'] as const;

export class AcctInsuranceDoneDto {
  @ApiProperty({ example: '1', description: '직원 번호' }) @IsString() @Matches(/^\d{1,18}$/) employeeId!: string;
  @ApiProperty({ enum: ['ACQ', 'LOSS'], description: 'ACQ 취득 · LOSS 상실' }) @IsIn(['ACQ', 'LOSS']) kind!: string;
  @ApiPropertyOptional({ example: '4대 사회보험 정보연계센터 신고 · 접수번호 메모' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/acct')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class AcctFilingsController {
  constructor(private readonly db: DatabaseService) {}

  /* ── v10.420 원천세 이행상황신고서 ── */
  @Get('tax/wht-return')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: true, example: '2026-11', description: '지급한 달' })
  @ApiOperation({ summary: '원천세 이행상황신고서 미리보기 (v10.420)', description: '그 달 지급한 근로소득(급여 확정 · 지급) · 사업소득(포인트 출금) · 퇴직소득 인원 · 지급액 · 소득세 · 지방소득세를 신고서 칸으로 · 납부 기한(다음 달 10일 · 영업일).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_PERIOD' })
  whtReturn(@Query('ym') ym: string) { return whtReturn(this.db, ym); }

  @Get('tax/wht-return/export')
  @Roles(...VIEW)
  @ExportGate('ACCT_TAX')
  @ApiQuery({ name: 'ym', required: true, example: '2026-11' })
  @ApiOperation({ summary: '원천세 이행상황신고서 CSV (v10.420 · 내려받기 승인)', description: '칸 코드 · 소득 구분 · 인원 · 건수 · 총지급액 · 소득세 · 지방소득세 · 납부 기한.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL · ACCT_PERIOD' })
  async whtReturnExport(@Query('ym') ym: string) {
    const r = await whtReturn(this.db, ym);
    const { head, body } = whtReturnCsv(r);
    return { filename: `wht-return-${r.ym}.csv`, csv: toCsv(head, body), rows: body.length, note: `${r.ym} 원천세 신고 자료를 내려받았습니다.` };
  }

  /* ── v10.421 지급명세서 · 원천징수영수증 ── */
  @Get('payroll/statements')
  @Roles(...VIEW)
  @ApiQuery({ name: 'period', required: true, example: '2026', description: 'YYYY(해) · YYYY-H1 · YYYY-H2(반기 · 간이지급명세서) · YYYY-MM(달)' })
  @ApiOperation({ summary: '근로소득 지급명세서 (v10.421)', description: '확정 · 지급한 급여(지급일 기준) 직원별 총급여 · 비과세 · 과세 급여 · 소득세 · 지방소득세 · 4대보험 본인 몫 · 실지급. 주민등록번호 없음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_PERIOD' })
  statements(@Query('period') period: string) { return wageStatements(this.db, period); }

  @Get('payroll/statements/export')
  @Roles(...VIEW)
  @ExportGate('ACCT_TAX')
  @ApiQuery({ name: 'period', required: true, example: '2026-H2' })
  @ApiOperation({ summary: '지급명세서 CSV (v10.421 · 내려받기 승인)', description: '직원별 줄 · 주민등록번호 칸은 비움(신고 때 채움).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL · ACCT_PERIOD' })
  async statementsExport(@Query('period') period: string) {
    const w = await wageStatements(this.db, period);
    const { head, body } = wageCsv(w);
    return { filename: `wage-statements-${period}.csv`, csv: toCsv(head, body), rows: body.length, note: `${w.label} 지급명세서 자료를 내려받았습니다.` };
  }

  @Get('payroll/statements/:employeeId/receipt')
  @Roles(...VIEW)
  @ApiParam({ name: 'employeeId', example: '1' })
  @ApiQuery({ name: 'year', required: true, example: '2026' })
  @ApiOperation({ summary: '근로소득 원천징수영수증 (v10.421 · 인쇄용)', description: '직원 한 명 · 해 합계 한 장. 주민등록번호 · 연말정산 결정세액은 신고 때 채움.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_PERIOD' })
  receipt(@Param('employeeId') employeeId: string, @Query('year') year: string) { return wageReceipt(this.db, employeeId, year); }

  /* ── v10.422 4대보험 취득 · 상실 ── */
  @Get('payroll/insurance')
  @Roles(...VIEW)
  @ApiOperation({ summary: '4대보험 취득 · 상실 신고 자료 (v10.422)', description: '입사(취득) · 퇴사(상실 · 다음 날) · 보수월액 · 기한(다음 달 15일) · 처리함.' })
  @ApiOkResponse({ type: Object })
  insurance() { return insuranceFilings(this.db); }

  @Post('payroll/insurance/done')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_INSURANCE_DONE', 'SETTING')
  @ApiOperation({ summary: '4대보험 신고 처리함 (v10.422 · SUPER)', description: '직원 · 종류마다 한 번 · 지우지 않음 · 그 건 기한 알림을 풀어 둠.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_INSURANCE_DONE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_INSURANCE' })
  insuranceDone(@Body() dto: AcctInsuranceDoneDto) { return markInsuranceDone(this.db, dto.employeeId, dto.kind, dto.note, RequestCtx.actorId() ?? null); }
}

