import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { StrictBoolean } from '../../common/strict-boolean';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { ExportGate } from '../admin/export-approval';
import { biDaily, biExport, biOverview, biRun, setBiSettings } from './bi';
import { DASH_KEY_RE, myDashLayout, resetDashLayout, saveDashLayout } from './dash-layout';
import { adjustLotCountLine, closeLotCount, lotCountDetail, lotCounts, openLotCount, scanLot, setLotCountLine } from './lot-count';

/* ---------------------------------------------------------------------
 * v10.535 ~ 537 (D282 · docs/673 ~ 675) (52) 데이터 · 운영 — 운영 화면 API
 *   v10.535 통계 내보내기 BI(ADMIN · 설정 SUPER)     GET /admin/bi · GET /admin/bi/daily · GET /admin/bi/export(내려받기 승인 BI_DAILY)
 *                                                    POST /admin/bi/run · PUT /admin/bi/settings
 *   v10.536 대시보드 위젯 배치(ADMIN · 자기 것)      GET · PUT · DELETE /admin/dash-layout
 *   v10.537 휴대폰 재고 실사(ADMIN · PAYOUT · 조정 SUPER)
 *           GET|POST /admin/qlt/lot-counts · GET …/{id} · POST …/{id}/scan · PUT …/{id}/lines/{lotId} · POST …/{id}/close · POST …/{id}/lines/{lotId}/adjust
 *   세무사(ACCOUNTANT)는 보지 않음 — 모든 주소가 /admin/acct/ 밖(규칙 8)
 * ------------------------------------------------------------------- */

const SCAN_ROLES = ['ADMIN', 'PAYOUT'] as const;   // SUPER 는 늘 통과 · D271 로트 화면(VIEW)과 같음

/* ── DTO(쓰는 컨트롤러보다 먼저 · 이름은 src 전체에서 고유) ── */
export class BiRunDto {
  @ApiProperty({ example: '2026-11-01', description: '시작일(YYYY-MM-DD)' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) from!: string;
  @ApiProperty({ example: '2026-11-19', description: '끝날(YYYY-MM-DD · 오늘까지 · 31일 안)' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) to!: string;
}
export class BiSettingsDto {
  @ApiPropertyOptional({ example: 3, description: 'bi.min_cell — 작은 칸 가림(0 ~ 20 · 0 이면 가리지 않음)' }) @IsOptional() @IsInt() @Min(0) @Max(20) minCell?: number;
  @ApiPropertyOptional({ example: 1100, description: 'bi.keep_days — 일별 집계 보관 일수(400 ~ 3650)' }) @IsOptional() @IsInt() @Min(400) @Max(3650) keepDays?: number;
  @ApiProperty({ example: 'BI 도구 연결 전 작은 칸 가림 5 로' }) @IsString() @Length(2, 200) reason!: string;
}
export class DashLayoutSaveDto {
  @ApiPropertyOptional({ type: [String], example: ['tiles', 'alerts', 'todo'], description: '카드 차례(목록에 있는 열쇠만 · 빠진 카드는 기본 차례대로 끝에)' })
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) @Matches(DASH_KEY_RE, { each: true }) order?: string[];
  @ApiPropertyOptional({ type: [String], example: ['runway', 'more'], description: '숨길 카드(모두 숨기면 422)' })
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) @Matches(DASH_KEY_RE, { each: true }) hidden?: string[];
}
export class LotCountOpenDto {
  @ApiProperty({ example: '11월 창고 로트 실사' }) @IsString() @Length(2, 60) title!: string;
  @ApiPropertyOptional({ example: '본 창고 · 2층 선반' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class LotCountScanDto {
  @ApiProperty({ example: 'SGB-LOT-000123', description: '카메라 · 리더기 · 손으로 넣은 글자(로트 QR · 로트 번호 · 상품 바코드)' }) @IsString() @Length(1, 60) code!: string;
  @ApiPropertyOptional({ example: 1, description: '한 번 읽을 때 더할 수(처음 1 · 1 ~ 1000)' }) @IsOptional() @IsInt() @Min(1) @Max(1000) add?: number;
  @ApiPropertyOptional({ example: 24, description: '센 수를 바로 적기(0 ~ 1,000,000 · 보내면 add 는 무시)' }) @IsOptional() @IsInt() @Min(0) @Max(1000000) counted?: number;
}
export class LotCountLineDto {
  @ApiPropertyOptional({ example: 24, description: '센 수(0 ~ 1,000,000)' }) @IsOptional() @IsInt() @Min(0) @Max(1000000) counted?: number;
  @ApiPropertyOptional({ example: '상자 하나 파손' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
  @ApiPropertyOptional({ description: 'true 면 세지 않음으로 되돌림' }) @IsOptional() @StrictBoolean() reset?: boolean;
}
export class LotCountCloseDto {
  @ApiPropertyOptional({ description: 'true 면 세지 않은 줄은 그대로 두고 닫음(차이 셈에서 빠짐)' }) @IsOptional() @StrictBoolean() skipUncounted?: boolean;
}
export class LotCountAdjustDto {
  @ApiProperty({ example: '실사 차이 — 파손 2개' }) @IsString() @Length(2, 120) reason!: string;
}

/* ── v10.535 통계 내보내기 BI ── */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class BiExportController {
  constructor(private readonly db: DatabaseService) {}

  @Get('bi')
  @Roles('ADMIN')
  @ApiOperation({ summary: '통계 내보내기 BI 한눈에 (v10.535)', description: '지표 목록 · 집계 상태(첫날 · 마지막 날 · 셈 시각 · 줄 수) · 설정(작은 칸 가림 · 보관) · bi 스키마 보기와 칸 · 개인 식별처럼 보이는 칸(늘 0).' })
  @ApiOkResponse({ type: Object })
  overview() { return biOverview(this.db); }

  @Get('bi/daily')
  @Roles('ADMIN')
  @ApiQuery({ name: 'from', required: false, example: '2026-10-21' })
  @ApiQuery({ name: 'to', required: false, example: '2026-11-19' })
  @ApiQuery({ name: 'metrics', required: false, example: 'SIGNUP,ORDER_PAID', description: '쉼표로 · 비우면 모두' })
  @ApiOperation({ summary: 'BI 일별 집계 보기 (v10.535)', description: '기간(400일까지 · 비우면 지난 30일) · 지표마다 합 · 나눔마다 합 · 운영 화면 안 정확한 숫자(작은 칸 가림 없음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BI_RANGE · BI_METRIC' })
  daily(@Query('from') from?: string, @Query('to') to?: string, @Query('metrics') metrics?: string) { return biDaily(this.db, { from, to, metrics }); }

  @Get('bi/export')
  @Roles('ADMIN')
  @ExportGate('BI_DAILY')
  @ApiQuery({ name: 'from', required: false, example: '2026-10-21' })
  @ApiQuery({ name: 'to', required: false, example: '2026-11-19' })
  @ApiQuery({ name: 'metrics', required: false, example: 'SIGNUP,ORDER_PAID' })
  @ApiOperation({ summary: 'BI 일별 집계 CSV (v10.535 · 내려받기 승인)', description: 'bi.v_metrics_daily 그대로(나눔 줄 작은 칸은 비움 · suppressed=Y) · day · metric · label · unit · dim · value · suppressed.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL · BI_RANGE · BI_METRIC' })
  exportCsv(@Query('from') from?: string, @Query('to') to?: string, @Query('metrics') metrics?: string) { return biExport(this.db, { from, to, metrics }); }

  @Post('bi/run')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('BI_RUN', 'SETTING')
  @ApiOperation({ summary: 'BI 일별 집계 다시 셈 (v10.535)', description: '기간(31일까지 · 오늘까지)의 줄을 지우고 원본 표에서 다시 셈 · 같은 때 다른 셈이 돌면 409.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'BI_BUSY' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BI_RANGE' })
  run(@Body() dto: BiRunDto) { return biRun(this.db, { from: dto.from, to: dto.to }); }

  @Put('bi/settings')
  @Roles('SUPER')
  @Audit('BI_SETTING', 'SETTING')
  @ApiOperation({ summary: 'BI 설정 (v10.535 · SUPER)', description: '작은 칸 가림 bi.min_cell(0 ~ 20) · 보관 bi.keep_days(400 ~ 3650) · 사유(설정 바뀜 기록).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BI_REASON · BI_MIN_CELL · BI_KEEP · BI_NOTHING' })
  settings(@Body() dto: BiSettingsDto) { return setBiSettings(this.db, { minCell: dto.minCell, keepDays: dto.keepDays, reason: dto.reason }); }
}

/* ── v10.536 대시보드 위젯 배치(자기 계정 것만) ── */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class DashLayoutController {
  constructor(private readonly db: DatabaseService) {}

  @Get('dash-layout')
  @Roles('ADMIN')
  @ApiOperation({ summary: '내 대시보드 위젯 배치 (v10.536)', description: '저장한 차례 · 숨김(없으면 기본 배치 · saved=false) · 카드 목록(열쇠 · 이름).' })
  @ApiOkResponse({ type: Object })
  mine() { return myDashLayout(this.db, RequestCtx.actorId() ?? null); }

  @Put('dash-layout')
  @Roles('ADMIN')
  @ApiOperation({ summary: '내 대시보드 위젯 배치 저장 (v10.536)', description: '보낸 칸만(차례 · 숨김) · 목록에 없는 카드 · 같은 카드 두 번 · 모두 숨김은 422 · 이 계정에만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'DASH_KEY · DASH_ALL_HIDDEN · DASH_NOTHING · DASH_ACTOR' })
  save(@Body() dto: DashLayoutSaveDto) { return saveDashLayout(this.db, RequestCtx.actorId() ?? null, { order: dto.order, hidden: dto.hidden }); }

  @Delete('dash-layout')
  @Roles('ADMIN')
  @ApiOperation({ summary: '내 대시보드 위젯 배치 기본으로 (v10.536)', description: '저장한 배치를 지움 — 기본 배치(화면 코드의 차례 · 모두 보임)로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'DASH_ACTOR' })
  reset() { return resetDashLayout(this.db, RequestCtx.actorId() ?? null); }
}

/* ── v10.537 휴대폰 재고 실사(로트) ── */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@Roles(...SCAN_ROLES)
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class LotCountController {
  constructor(private readonly db: DatabaseService) {}

  @Get('qlt/lot-counts')
  @Roles(...SCAN_ROLES)
  @ApiOperation({ summary: '로트 재고 실사 회차 목록 (v10.537)', description: '회차 50(열린 것 먼저) · 줄 · 센 수 · 차이 · 조정 수 · 열린 회차 번호 · 남은 수량이 있는 로트 수.' })
  @ApiOkResponse({ type: Object })
  list() { return lotCounts(this.db); }

  @Post('qlt/lot-counts')
  @Roles(...SCAN_ROLES)
  @HttpCode(200)
  @Audit('QLT_COUNT_OPEN', 'SETTING')
  @ApiOperation({ summary: '로트 재고 실사 열기 (v10.537)', description: '남은 수량이 있는 로트(정상 · 보류 · 회수)를 열 때 장부 수량과 함께 줄로 · 열린 회차가 있으면 409 · 로트가 없으면 422.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'QLT_CNT_OPEN' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'QLT_CNT_TITLE · QLT_CNT_EMPTY' })
  open(@Body() dto: LotCountOpenDto) { return openLotCount(this.db, { title: dto.title, note: dto.note }, RequestCtx.actorId() ?? null); }

  @Get('qlt/lot-counts/:id')
  @Roles(...SCAN_ROLES)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '로트 재고 실사 회차 (v10.537)', description: '줄(로트 QR 코드 · 로트 번호 · 상품 · 바코드 · 열 때 · 센 수 · 처음 센 때 장부 · 차이 · 지금 수량 · 조정) · 셈.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  one(@Param('id') id: string) { return lotCountDetail(this.db, id); }

  @Post('qlt/lot-counts/:id/scan')
  @Roles(...SCAN_ROLES)
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '로트 읽기 → 세기 (v10.537)', description: '로트 QR(SGB-LOT-000123) → 로트 번호 → 상품 바코드 차례로 찾음 · 여럿이면 matched=false 와 고를 로트 · 처음 +1(add) · counted 면 그 수 · 열린 뒤 등록한 로트는 줄을 더함 · 못 찾으면 404 · 닫은 회차 409.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'QLT_CNT_STATE · QLT_CNT_LOT_CLOSED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'QLT_CNT_CODE · QLT_CNT_QTY' })
  scan(@Param('id') id: string, @Body() dto: LotCountScanDto) { return scanLot(this.db, id, { code: dto.code, add: dto.add, counted: dto.counted }, RequestCtx.actorId() ?? null); }

  @Put('qlt/lot-counts/:id/lines/:lotId')
  @Roles(...SCAN_ROLES)
  @ApiParam({ name: 'id', example: '1' })
  @ApiParam({ name: 'lotId', example: '12' })
  @ApiOperation({ summary: '로트 실사 줄 고치기 (v10.537)', description: '센 수 · 메모(보낸 칸만) · reset 이면 세지 않음으로 · 열린 회차만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'QLT_CNT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'QLT_CNT_QTY · QLT_CNT_NOTHING' })
  line(@Param('id') id: string, @Param('lotId') lotId: string, @Body() dto: LotCountLineDto) {
    return setLotCountLine(this.db, id, lotId, { counted: dto.counted, note: dto.note, reset: dto.reset }, RequestCtx.actorId() ?? null);
  }

  @Post('qlt/lot-counts/:id/close')
  @Roles(...SCAN_ROLES)
  @HttpCode(200)
  @Audit('QLT_COUNT_CLOSE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '로트 재고 실사 닫기 (v10.537)', description: '세지 않은 줄이 남으면 422(skipUncounted 면 그대로 닫음) · 센 줄이 없으면 422 · 닫으면 못 고침.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'QLT_CNT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'QLT_CNT_PENDING · QLT_CNT_NONE' })
  close(@Param('id') id: string, @Body() dto: LotCountCloseDto) { return closeLotCount(this.db, id, dto.skipUncounted === true, RequestCtx.actorId() ?? null); }

  @Post('qlt/lot-counts/:id/lines/:lotId/adjust')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('QLT_COUNT_ADJUST', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiParam({ name: 'lotId', example: '12' })
  @ApiOperation({ summary: '로트 실사 차이 조정 (v10.537 · SUPER)', description: '닫은 회차 · 차이(센 수 − 처음 센 때 장부) 만큼 D271 로트 조정(원가 수불부 실사 조정 한 줄 + 로트 수불) · 줄마다 한 번.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'QLT_CNT_STATE · QLT_CNT_ADJUSTED · QLT_LOT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'QLT_REASON · QLT_CNT_UNCOUNTED · QLT_CNT_NODIFF · QLT_LOT' })
  adjust(@Param('id') id: string, @Param('lotId') lotId: string, @Body() dto: LotCountAdjustDto) {
    return adjustLotCountLine(this.db, id, lotId, dto.reason, RequestCtx.actorId() ?? null);
  }
}
