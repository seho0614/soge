import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { DatabaseService } from '../../db/database.service';
import {
  UPT_LEVELS, UPT_PARTS, UPT_STATES, addNote, adminView, createIncident, editIncident, publicStatus, receiveReport, rotateToken, setUptimeSettings,
} from './uptime';

/* ---------------------------------------------------------------------
 * v10.497 (D272 · docs/635) 가동 감시 · 장애 공지
 *   공개           GET  /site/status                       상태(사용자 웹 맨 위 띠 · /status · n8n 감시) — DB 확인 · 끝나지 않은 공지 · 30일 끝난 공지 · 점검 · 대상별 마지막 감시
 *   n8n(토큰)      POST /site/uptime/report                바깥 감시 결과(X-Uptime-Token · uptime.report on 일 때만)
 *   ADMIN · SUPER  GET  /admin/uptime                      대상별 상태 · 24시간 가동률 · 장애 공지(진행 글)
 *                  POST /admin/uptime/incidents            장애 공지 올리기
 *                  PUT  /admin/uptime/incidents/{id}       고치기(끝난 공지는 띠 끄기만)
 *                  POST /admin/uptime/incidents/{id}/notes 진행 글(조사 중 → 원인 찾음 → 지켜보는 중 → 끝남)
 *   SUPER          PUT  /admin/uptime/settings             받기 켜기 · 연속 실패 수 · 보관 날수(사유)
 *                  POST /admin/uptime/token                새 감시 토큰(원문은 응답에 한 번만)
 * ------------------------------------------------------------------- */

export class UptReportItemDto {
  @ApiProperty({ example: 'SITE', description: '대상 이름(영문 대문자로 시작 · 2 ~ 20자)' }) @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,19}$/) target!: string;
  @ApiProperty() @IsBoolean() ok!: boolean;
  @ApiPropertyOptional({ example: 200 }) @IsOptional() @IsInt() @Min(0) @Max(999) status?: number;
  @ApiPropertyOptional({ example: 320 }) @IsOptional() @IsInt() @Min(0) @Max(600000) ms?: number;
  @ApiPropertyOptional({ example: 'timeout' }) @IsOptional() @IsString() @MaxLength(200) note?: string;
}
export class UptReportDto {
  @ApiProperty({ type: [UptReportItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => UptReportItemDto) checks!: UptReportItemDto[];
}
export class UptIncidentCreateDto {
  @ApiProperty({ example: '결제 화면이 느립니다' }) @IsString() @Length(2, 120) title!: string;
  @ApiPropertyOptional({ example: 'Checkout is slow' }) @IsOptional() @IsString() @MaxLength(160) titleEn?: string;
  @ApiProperty({ enum: UPT_LEVELS }) @IsIn([...UPT_LEVELS]) level!: string;
  @ApiPropertyOptional({ enum: UPT_PARTS, isArray: true }) @IsOptional() @IsArray() @ArrayMaxSize(7) @IsIn([...UPT_PARTS], { each: true }) parts?: string[];
  @ApiProperty({ example: '원인을 찾고 있습니다.' }) @IsString() @Length(2, 1000) body!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1500) bodyEn?: string;
  @ApiPropertyOptional({ description: '사용자 웹 맨 위 띠(처음 켬)' }) @IsOptional() @IsBoolean() banner?: boolean;
  @ApiPropertyOptional({ description: '운영 알림 UPT_INCIDENT(MAJOR · CRITICAL 은 긴급 — 텔레그램 길)' }) @IsOptional() @IsBoolean() notifyOps?: boolean;
}
export class UptIncidentEditDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) titleEn?: string;
  @ApiPropertyOptional({ enum: UPT_LEVELS }) @IsOptional() @IsIn([...UPT_LEVELS]) level?: string;
  @ApiPropertyOptional({ enum: UPT_PARTS, isArray: true }) @IsOptional() @IsArray() @ArrayMaxSize(7) @IsIn([...UPT_PARTS], { each: true }) parts?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() banner?: boolean;
}
export class UptNoteDto {
  @ApiProperty({ enum: UPT_STATES }) @IsIn([...UPT_STATES]) state!: string;
  @ApiProperty({ example: '원인을 찾았습니다 — 결제 대행사 응답 지연' }) @IsString() @Length(2, 1000) body!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1500) bodyEn?: string;
}
export class UptSettingsDto {
  @ApiPropertyOptional({ description: 'uptime.report' }) @IsOptional() @IsBoolean() report?: boolean;
  @ApiPropertyOptional({ example: 2 }) @IsOptional() @IsInt() @Min(1) @Max(10) failCount?: number;
  @ApiPropertyOptional({ example: 90 }) @IsOptional() @IsInt() @Min(7) @Max(400) keepDays?: number;
  @ApiProperty({ example: '바깥 감시 시작' }) @IsString() @Length(2, 200) reason!: string;
}
export class UptTokenDto {
  @ApiProperty({ example: 'n8n 처음 연결' }) @IsString() @Length(2, 200) reason!: string;
}

@ApiTags('OPS')
@Controller('api/v1')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class UptimeController {
  constructor(private readonly db: DatabaseService) {}

  @Get('site/status')
  @ApiOperation({ summary: '서비스 상태 (v10.497 · 공개)', description: 'API 가 떠 있고 DB 가 붙었는지 · 끝나지 않은 장애 공지(5) · 최근 30일 끝난 공지(10) · 점검 예약 · 대상별 마지막 바깥 감시. 같은 프로세스에서 15초 기억. 개인정보 없음.' })
  @ApiOkResponse({ type: Object })
  status() { return publicStatus(this.db); }

  @Post('site/uptime/report')
  @HttpCode(200)
  @ApiHeader({ name: 'X-Uptime-Token', required: true, description: '운영 화면에서 만든 감시 토큰' })
  @ApiOperation({ summary: '바깥 감시 결과 받기 (v10.497 · 자동화 서버 n8n)', description: 'uptime.report on · 토큰(지문 대조)일 때만. 대상별 연속 실패가 uptime.fail_count 이상이면 운영 알림 UPTIME_DOWN(긴급) 한 번 · 다시 되면 UPTIME_RECOVERED.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'UPTIME_REPORT_OFF · UPTIME_TOKEN_INVALID' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'UPTIME_ITEMS · UPTIME_TARGET' })
  report(@Headers('x-uptime-token') token: string | undefined, @Body() dto: UptReportDto) { return receiveReport(this.db, token, dto.checks); }

  @Get('admin/uptime')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({ summary: '가동 · 장애 공지 (v10.497)', description: '설정(받기 · 토큰 있음 · 연속 실패 수 · 보관 날수) · 마지막 n8n 결과 시각 · 대상별 상태 · 24시간 가동률 · 장애 공지 30(진행 글).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: '권한 없음' })
  view() { return adminView(this.db); }

  @Post('admin/uptime/incidents')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @Audit('UPT_INCIDENT_CREATE', 'SETTING')
  @ApiOperation({ summary: '장애 공지 올리기 (v10.497)', description: '제목 · 정도(MINOR · MAJOR · CRITICAL) · 영향 범위 · 첫 안내 글(조사 중) · 띠(처음 켬) · 운영 알림(선택).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: '권한 없음' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'UPT_TITLE · UPT_LEVEL · UPT_PARTS · UPT_BODY' })
  create(@Body() dto: UptIncidentCreateDto) { return createIncident(this.db, dto); }

  @Put('admin/uptime/incidents/:id')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @Audit('UPT_INCIDENT_EDIT', 'SETTING')
  @ApiOperation({ summary: '장애 공지 고치기 (v10.497)', description: '보낸 칸만 바꿈. 끝난 공지는 띠(banner)만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: '권한 없음' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'UPT_RESOLVED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'UPT_NOTHING · UPT_TITLE · UPT_LEVEL · UPT_PARTS' })
  edit(@Param('id') id: string, @Body() dto: UptIncidentEditDto) { return editIncident(this.db, toId(id), dto); }

  @Post('admin/uptime/incidents/:id/notes')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @Audit('UPT_INCIDENT_NOTE', 'SETTING')
  @ApiOperation({ summary: '장애 공지 진행 글 (v10.497)', description: '상태(INVESTIGATING · IDENTIFIED · MONITORING · RESOLVED)와 글. 끝남(RESOLVED)이면 띠가 내려가고 운영 알림 UPT_INCIDENT(끝남).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: '권한 없음' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'UPT_RESOLVED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'UPT_STATE · UPT_BODY' })
  note(@Param('id') id: string, @Body() dto: UptNoteDto) { return addNote(this.db, toId(id), dto); }

  @Put('admin/uptime/settings')
  @ApiBearerAuth()
  @Roles('SUPER')
  @Audit('UPT_SETTINGS', 'SETTING')
  @ApiOperation({ summary: '가동 감시 설정 (v10.497 · SUPER)', description: '받기(uptime.report — 토큰이 먼저) · 연속 실패 수(1 ~ 10) · 보관 날수(7 ~ 400) · 사유(설정 바뀜 기록).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: '권한 없음' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'UPT_REASON · UPT_TOKEN_FIRST · UPT_FAIL_COUNT · UPT_KEEP_DAYS · UPT_NOTHING' })
  settings(@Body() dto: UptSettingsDto) { return setUptimeSettings(this.db, dto); }

  @Post('admin/uptime/token')
  @ApiBearerAuth()
  @Roles('SUPER')
  @HttpCode(200)
  @ApiOperation({ summary: '새 감시 토큰 (v10.497 · SUPER)', description: '원문은 이 응답에 한 번만(DB 는 지문 · 감사 기록 UPT_TOKEN_ROTATE 는 원문 없이 서비스가 직접). 옛 토큰은 바로 못 씀.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: '권한 없음' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'UPT_REASON' })
  token(@Body() dto: UptTokenDto) { return rotateToken(this.db, dto.reason); }
}

/** 번호(bigint) 경로 값 — 숫자가 아니면 404 와 같은 뜻으로 */
function toId(id: string): string {
  if (!/^[1-9][0-9]{0,17}$/.test(String(id ?? ''))) return '0';
  return id;
}
