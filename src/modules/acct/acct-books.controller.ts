import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, Length, Matches } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { ExportGate } from '../admin/export-approval';
import { toCsv } from './acct.controller';
import { CASHBOOK_ROLES, cashBook, cashBookCsv, dayBook, dayBookCsv, fxRevalPost, fxRevalPreview, fxRevalView, reverseManual } from './books';

/* ---------------------------------------------------------------------
 * ㉗ (D260 · docs/586 ~ 589) 장부 보강
 *   v10.449  GET  /admin/acct/daybook?from=&to=            분개장
 *            GET  /admin/acct/daybook/export?ticket=       분개장 CSV(내려받기 승인 ACCT_LEDGER)
 *   v10.450  GET  /admin/acct/cashbook?role=&from=&to=     현금출납장(CASH 보통예금 · CASH_HAND 현금)
 *            GET  /admin/acct/cashbook/export?ticket=      현금출납장 CSV(ACCT_LEDGER)
 *   v10.451  POST /admin/acct/manual/{id}/reverse          승인된 수동 전표 반대 전표(SUPER · 사유 · 감사 ACCT_MANUAL_REVERSE)
 *   v10.452  GET  /admin/acct/fx-reval?ym=                 환산 평가 — 그 달 기록 · 못 받은 외화 받을 돈 · 지난 기록
 *            GET  /admin/acct/fx-reval/preview?ym=&rates=  미리보기(저장 안 함 · rates=USD:1350,EUR:1490)
 *            POST /admin/acct/fx-reval                     넣기(SUPER · 달마다 한 번 · 감사 ACCT_FXREVAL)
 *   보기 SUPER · PAYOUT(세무사는 core/auth 가 GET 만 열어 줌).
 * ------------------------------------------------------------------- */

const VIEW = ['SUPER', 'PAYOUT'] as const;
const YMD_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class AcctManualReverseDto {
  @ApiPropertyOptional({ example: '2026-11-20', description: '반대 전표 날짜(비우면 오늘 · 원래 전표 날짜 이후 · 마감한 달 · 해는 안 됨)' }) @IsOptional() @IsString() @Matches(YMD_RE) reverseOn?: string;
  @ApiProperty({ example: '금액을 잘못 적어 되돌림' }) @IsString() @Length(5, 200) reason!: string;
}
export class AcctFxRevalDto {
  @ApiProperty({ example: '2026-11' }) @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) ym!: string;
  @ApiProperty({ example: { USD: 1385.5 }, description: '통화마다 기말 환율(원) — 그 달 못 받은 외화 받을 돈의 통화 모두' }) @IsObject() rates!: Record<string, number>;
  @ApiPropertyOptional({ example: '11월 말 매매기준율' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/acct')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class AcctBooksController {
  constructor(private readonly db: DatabaseService) {}

  /* ── v10.449 분개장 ── */
  @Get('daybook')
  @Roles(...VIEW)
  @ApiQuery({ name: 'from', required: true, example: '2026-11-01' })
  @ApiQuery({ name: 'to', required: true, example: '2026-11-30' })
  @ApiOperation({ summary: '분개장 (v10.449)', description: '기간 전표를 날짜 · 번호 순으로 줄째(계정 · 차변 · 대변) · 합계 차변 = 대변 · 1년 · 5,000줄까지.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_DATE' })
  daybook(@Query('from') from?: string, @Query('to') to?: string) { return dayBook(this.db, from, to); }

  @Get('daybook/export')
  @Roles(...VIEW)
  @ExportGate('ACCT_LEDGER')
  @ApiQuery({ name: 'from', required: true, example: '2026-11-01' })
  @ApiQuery({ name: 'to', required: true, example: '2026-11-30' })
  @ApiOperation({ summary: '분개장 CSV (v10.449 · 내려받기 승인)', description: '전표 줄마다 한 줄 + 합계 · 거래처 이름이 들어가 승인 필요(ACCT_LEDGER).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL · ACCT_DATE' })
  async daybookExport(@Query('from') from?: string, @Query('to') to?: string) {
    const r = await dayBook(this.db, from, to);
    const { head, body } = dayBookCsv(r);
    return { filename: `daybook-${r.from}-${r.to}.csv`, csv: toCsv(head, body), rows: r.total.lines, note: `분개장 ${r.total.entries}장(${r.total.lines}줄)을 내려받았습니다.` };
  }

  /* ── v10.450 현금출납장 ── */
  @Get('cashbook')
  @Roles(...VIEW)
  @ApiQuery({ name: 'role', required: false, enum: [...CASHBOOK_ROLES] })
  @ApiQuery({ name: 'from', required: true, example: '2026-11-01' })
  @ApiQuery({ name: 'to', required: true, example: '2026-11-30' })
  @ApiOperation({ summary: '현금출납장 (v10.450)', description: '보통예금(CASH) · 현금(CASH_HAND) — 기초 · 날짜별 들어옴 · 나감 · 잔액 · 줄(⑬ 원장과 같은 셈).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_DATE' })
  cashbook(@Query('role') role?: string, @Query('from') from?: string, @Query('to') to?: string) { return cashBook(this.db, role, from, to); }

  @Get('cashbook/export')
  @Roles(...VIEW)
  @ExportGate('ACCT_LEDGER')
  @ApiQuery({ name: 'role', required: false, enum: [...CASHBOOK_ROLES] })
  @ApiQuery({ name: 'from', required: true, example: '2026-11-01' })
  @ApiQuery({ name: 'to', required: true, example: '2026-11-30' })
  @ApiOperation({ summary: '현금출납장 CSV (v10.450 · 내려받기 승인)', description: '기초 · 줄 · 합계 · 기말(ACCT_LEDGER).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL · ACCT_DATE' })
  async cashbookExport(@Query('role') role?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const r = await cashBook(this.db, role, from, to);
    const { head, body } = cashBookCsv(r);
    return { filename: `cashbook-${r.role}-${r.from}-${r.to}.csv`, csv: toCsv(head, body), rows: r.rows.length, note: `${r.account.name} 출납장 ${r.rows.length}줄을 내려받았습니다.` };
  }

  /* ── v10.451 반대 전표 ── */
  @Post('manual/:id/reverse')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_MANUAL_REVERSE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '승인된 수동 전표 반대 전표 (v10.451 · SUPER)', description: '차대를 바꾼 전표(MANUAL_REVERSE) 한 장 · 사유 5자 이상 · 날짜는 원래 전표 이후 · 마감한 달 · 해는 안 됨 · 한 번만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_REVERSE_STATE · ACCT_REVERSE_DONE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_REVERSE · ACCT_REVERSE_DATE · ACCT_REVERSE_ROLE · ACCT_MANUAL_CLOSED' })
  reverse(@Param('id') id: string, @Body() dto: AcctManualReverseDto) {
    return reverseManual(this.db, id, { reverseOn: dto.reverseOn, reason: dto.reason }, RequestCtx.actorId()!, (RequestCtx.get()?.actorRole ?? '') === 'SUPER');
  }

  /* ── v10.452 외화 환산 평가 ── */
  @Get('fx-reval')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '결산 외화 받을 돈 환산 평가 (v10.452)', description: '그 달 기록(있으면) · 말일까지 못 받은 수출 받을 돈 · 통화 · 지난 24달 기록.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_FXREVAL' })
  fxReval(@Query('ym') ym?: string) { return fxRevalView(this.db, ym); }

  @Get('fx-reval/preview')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: true, example: '2026-11' })
  @ApiQuery({ name: 'rates', required: false, example: 'USD:1385.5,EUR:1490' })
  @ApiOperation({ summary: '환산 평가 미리보기 (v10.452 · 저장 안 함)', description: '건마다 외화 × 기말 환율 − 선적 원화 · 이익 · 손실 합 · 환율 없는 통화.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_FXREVAL · ACCT_FXREVAL_RATE' })
  fxPreview(@Query('ym') ym?: string, @Query('rates') rates?: string) { return fxRevalPreview(this.db, ym, rates); }

  @Post('fx-reval')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_FXREVAL', 'SETTING')
  @ApiOperation({ summary: '환산 평가 넣기 (v10.452 · SUPER)', description: '달마다 한 번 · 평가 전표 FX_REVAL(말일) + 되돌림 FX_REVAL_REV(다음 달 첫날) · 차이가 없으면 기록만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_FXREVAL_DONE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_FXREVAL · ACCT_FXREVAL_RATE · ACCT_FXREVAL_ROLE · ACCT_MANUAL_CLOSED' })
  fxRevalAdd(@Body() dto: AcctFxRevalDto) {
    return fxRevalPost(this.db, { ym: dto.ym, rates: dto.rates, note: dto.note }, RequestCtx.actorId()!, (RequestCtx.get()?.actorRole ?? '') === 'SUPER');
  }
}
