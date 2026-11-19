import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { MailService } from '../../common/mail/mail.service';
import { SlackService } from '../../common/slack/slack.service';
import { TelegramService } from '../../common/telegram/telegram.service';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { csvRowsOf } from './report-day';
import { KINDS, kindOk, makeSnapshot, reportView, snapshotById } from './report-period';
import { sendSettings, sendSnapshot, setSendSettings } from './report-send';
import { addWorklog, listWorklogs, worklogBoard, reviewWorklog } from './worklog';

/* ---------------------------------------------------------------------
 * v10.412 ~ 415 (D250 · docs/549 ~ 552) 업무 보고 — 운영 화면 「보고」 메뉴
 *   대표 11/19 「일보 · 주보 · 월보 … 둘 다」 · 「개발 모두 진행」.
 *   v10.412  GET   /admin/work-reports/view?kind=DAY&period=YYYY-MM-DD   일보(없으면 지금 계산 · 저장 안 함)
 *            POST  /admin/work-reports/make                              지금 만들어 남기기(ADMIN · SUPER · 감사 REPORT_MAKE)
 *   v10.413  GET   /admin/work-reports/view?kind=WEEK|MONTH&period=        주보(그 주 아무 날) · 월보(YYYY-MM) · 지난 기간 대비 · 상위 5
 *            GET   /admin/work-reports/snapshots/{id}/csv                   보고 CSV(숫자만 · 승인 없이)
 *   v10.414  GET   /admin/worklogs?from=&to=&mine=                     업무 일지(SUPER 모두 · 나머지 자기 것)
 *            POST  /admin/worklogs                                     오늘 일지 쓰기(운영자 누구나 · 감사 WORKLOG_ADD)
 *            POST  /admin/worklogs/{id}/review                         확인 · 한 줄 답(SUPER · 감사 WORKLOG_REVIEW)
 *   v10.415  POST  /admin/work-reports/snapshots/{id}/send                  지금 보내기(SUPER · 감사 REPORT_SEND)
 *            GET   /admin/work-reports/settings · PATCH /admin/work-reports/settings   보내기 켜기 · 종류(SUPER · 사유 · 감사 REPORT_SETTING)
 * ------------------------------------------------------------------- */

const STAFF = ['ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'] as const;   // SUPER 는 늘 통과

export class ReportMakeDto {
  @ApiProperty({ enum: KINDS }) @IsIn(KINDS as unknown as string[]) kind!: string;
  @ApiProperty({ example: '2026-11-18', description: 'DAY 그날 · WEEK 그 주 아무 날 · MONTH YYYY-MM' }) @IsString() @Length(7, 10) period!: string;
}
export class ReportSettingDto {
  @ApiPropertyOptional({ description: '보내기 켜기' }) @IsOptional() @IsBoolean() on?: boolean;
  @ApiPropertyOptional({ type: [String], example: ['DAY', 'WEEK', 'MONTH'] }) @IsOptional() @IsArray() @IsIn(KINDS as unknown as string[], { each: true }) kinds?: string[];
  @ApiProperty({ example: '주보만 보내기' }) @IsString() @Length(1, 400) reason!: string;
}
export class WorklogAddDto {
  @ApiProperty({ example: '1:1 문의 12건 답변 · 매물 심사 5건' }) @IsString() @Length(2, 2000) done!: string;
  @ApiPropertyOptional({ example: '내일 정산 확인' }) @IsOptional() @IsString() @Length(0, 2000) todo?: string;
  @ApiPropertyOptional({ example: '세무사 답 기다림' }) @IsOptional() @IsString() @Length(0, 1000) blocked?: string;
  @ApiPropertyOptional({ example: 480, description: '시간(분 · 0 ~ 1440)' }) @IsOptional() @IsInt() @Min(0) @Max(1440) minutes?: number;
}
export class WorklogReviewDto {
  @ApiPropertyOptional({ example: '수고했습니다' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}

const isSuper = () => (RequestCtx.get()?.actorRole ?? '') === 'SUPER';
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
};
const toCsv = (head: string[], rows: unknown[][]) => '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class WorkReportController {
  constructor(private readonly db: DatabaseService, private readonly telegram: TelegramService, private readonly slack: SlackService, private readonly mail: MailService) {}

  /* ── v10.412 · 413 보고 ── */
  @Get('work-reports/view')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'kind', enum: KINDS })
  @ApiQuery({ name: 'period', required: false, example: '2026-11-18' })
  @ApiOperation({ summary: '일보 · 주보 · 월보 보기 (v10.412 · 413)', description: '그 기간 마지막 보고(있으면) · 없으면 지금 계산(저장 안 함) · 지난 기간 대비 · 상위 5 · 같은 종류 기록 20 · 보낸 결과. 비우면 어제 · 지난주 · 지난달.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'REPORT_KIND · REPORT_PERIOD' })
  view(@Query('kind') kind: string, @Query('period') period?: string) { return reportView(this.db, kindOk(kind), period); }

  @Post('work-reports/make')
  @Roles('ADMIN', 'SUPER')
  @HttpCode(200)
  @Audit('REPORT_MAKE', 'SETTING')
  @ApiOperation({ summary: '보고 지금 만들기 (v10.412)', description: '그 기간 보고를 지금 숫자로 남김(MANUAL · 쌓기만 · 같은 기간 여러 번 가능).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'REPORT_KIND · REPORT_PERIOD' })
  async make(@Body() dto: ReportMakeDto) {
    const r = await makeSnapshot(this.db, kindOk(dto.kind), dto.period, 'MANUAL', RequestCtx.actorId() ?? null);
    return { ok: true, id: r.id, period: r.body.period, note: '보고를 남겼습니다.' };
  }

  @Get('work-reports/snapshots/:id/csv')
  @Roles('ADMIN', 'SUPER')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '보고 CSV (v10.413)', description: '항목 · 이번 · 지난 기간 · 증감 % — 숫자만(개인정보 없음) · 내려받기 승인 없이.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  async csv(@Param('id') id: string) {
    const s = await snapshotById(this.db, id);
    const { head, rows } = csvRowsOf(s.body);
    return { id, csv: toCsv(head, rows), rows: rows.length, filename: `업무보고_${s.kind}_${s.period}.csv` };
  }

  /* ── v10.415 보내기 ── */
  @Post('work-reports/snapshots/:id/send')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('REPORT_SEND', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '보고 지금 보내기 (v10.415 · SUPER)', description: '운영 알림 채널(텔레그램 · 슬랙 · 메일 ops.digest_to)로 그 보고 한 번 · 스위치와 상관없음 · 채널마다 결과 기록.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  send(@Param('id') id: string) { return sendSnapshot(this.db, { telegram: this.telegram, slack: this.slack, mail: this.mail }, id, RequestCtx.actorId() ?? null); }

  @Get('work-reports/settings')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '보고 보내기 설정 (v10.415)', description: 'report.send(처음 꺼짐) · report.send_kinds · 메일 주소 설정 여부 · 고칠 수 있는가(SUPER).' })
  @ApiOkResponse({ type: Object })
  async settings() { return { ...(await sendSettings(this.db)), canEdit: isSuper() }; }

  @Patch('work-reports/settings')
  @Roles('SUPER')
  @Audit('REPORT_SETTING', 'SETTING')
  @ApiOperation({ summary: '보고 보내기 설정 고치기 (v10.415 · SUPER)', description: '켜기 · 종류 · 사유(설정 바뀜 기록).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'REPORT_REASON · REPORT_KIND' })
  setSettings(@Body() dto: ReportSettingDto) { return setSendSettings(this.db, dto); }

  /* ── v10.414 업무 일지 ── */
  @Get('worklogs')
  @Roles(...STAFF)
  @ApiQuery({ name: 'from', required: false, example: '2026-11-13' })
  @ApiQuery({ name: 'to', required: false, example: '2026-11-19' })
  @ApiQuery({ name: 'mine', required: false, example: '1' })
  @ApiOperation({ summary: '업무 일지 (v10.414)', description: 'SUPER 는 모두(mine=1 이면 자기 것) · 나머지는 자기 것 · 기간 31일까지 · 사람별 건수 · 시간.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'REPORT_PERIOD' })
  worklogs(@Query('from') from?: string, @Query('to') to?: string, @Query('mine') mine?: string) {
    return listWorklogs(this.db, { from, to, mine: mine === '1' }, RequestCtx.actorId() ?? null, isSuper());
  }

  @Get('worklogs/board')
  @Roles('SUPER')
  @ApiQuery({ name: 'date', required: false, example: '2026-11-19' })
  @ApiOperation({ summary: '업무 일지 현황판 (v10.414 · SUPER)', description: '그날 운영자마다 쓴 건수 · 시간 · 안 쓴 사람 · 최근 7일 작성률 · 막힌 것 · 확인 안 한 일지.' })
  @ApiOkResponse({ type: Object })
  worklogBoard(@Query('date') date?: string) { return worklogBoard(this.db, date); }

  @Post('worklogs')
  @Roles(...STAFF)
  @HttpCode(200)
  @Audit('WORKLOG_ADD', 'ACCOUNT')
  @ApiOperation({ summary: '업무 일지 쓰기 (v10.414)', description: '오늘(한국 날짜)만 · 고치기 · 지우기 없음(덧붙임은 새 줄 · DB 가 막음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'WORKLOG_DONE · WORKLOG_MINUTES · WORKLOG_DATE' })
  addWorklog(@Body() dto: WorklogAddDto) { return addWorklog(this.db, RequestCtx.actorId() ?? null, dto); }

  @Post('worklogs/:id/review')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('WORKLOG_REVIEW', 'ACCOUNT')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '업무 일지 확인 (v10.414 · SUPER)', description: '읽음 표시 · 한 줄 답(200자) · 쌓기만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  reviewWorklog(@Param('id') id: string, @Body() dto: WorklogReviewDto) { return reviewWorklog(this.db, id, dto.note, RequestCtx.actorId() ?? null); }
}
