import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { StrictBoolean } from '../../common/strict-boolean';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { GeoService } from '../../common/geo/geo.service';
import { ExportGate } from '../admin/export-approval';
import { PartnerActorService } from '../partner/partner-actor.service';
import { PapiPrincipal, PartnerApiKeyGuard } from '../papi/guard';
import { VSX_GWAN_RE, setVsxSettings, vsxSettings } from './vsx-settings';
import { VSX_DATE_RE, VSX_MINUTES, VSX_TIME_RE, adminVisits, bookVisit, cancelVisit, closeSlot, confirmVisit, markVisit, myVisits, openSlots, ownerSlots, visitSlotsForMember, vsxVisitJob } from './visits';
import { MAP_GWANS_RE, mapClusters } from './map-clusters';
import { adminPtnExports, ptnExportLeads, ptnExportPerf, ptnExportRequest, ptnExportStatus } from './ptn-export';
import { BILL_YM, papiBillConfirm, papiBillVoid, papiMyUsage, papiUsageRunNow, papiUsageView } from './papi-bill';

/* ---------------------------------------------------------------------
 * v10.542 ~ 545 (D284 · docs/680 ~ 683) (54) 매물 · 파트너 — 대표 11/20
 *   VsxMemberController      api/v1/vsx  (회원 · 사업자 — 방문 예약 · 내 매물 칸)
 *     GET /listings/{id}/slots · POST /listings/{id}/book · GET /me · POST /bookings/{id}/cancel · /confirm · /mark
 *     GET /owner/listings/{id}/slots · POST /owner/listings/{id}/slots · POST /owner/slots/{id}/close
 *   VsxMapController         api/v1/listings  (★ 로그인 없음 · check-acl 공개 구역 listings 그대로 · 묶음 가운데 · 수만)
 *     GET /map/clusters  — 두 마디 주소라 ListingController 의 GET /listings/{id} 와 겹치지 않음
 *   VsxPartnerController     api/v1/partner  (파트너센터 — 자기 파트너 것만 · 대표 · 정산 권한 직원)
 *     GET /export · POST /export/request · GET /export/leads(@ExportGate PTN_LEADS) · GET /export/perf
 *   VsxPapiUsageController   api/partner/v1  (★ 파트너 API 키 · PartnerApiKeyGuard · check-acl 은 @UseGuards 로 봄)
 *     GET /usage
 *   VsxAdminController       api/v1/admin/vsx  (ADMIN · SUPER — 검수 › 매물 방문 예약 · 지도 매물 묶음 · 설정 SUPER)
 *   VsxPtnAdminController    api/v1/admin/vsx  (ADMIN · SUPER · PARTNER_MAL — 파트너사 › 오픈 API 사용량 · 청구 · 파트너 자료 내려받기 · 확정 · 무효 SUPER)
 *   ★ 세무사(ACCOUNTANT)는 /admin/acct/ 접두가 아니라 보지 않음(규칙 8 · 청구서 초안은 회계 장부가 아님)
 * ------------------------------------------------------------------- */

const MEMBERS = ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'] as const;

export class VsxBookDto {
  @ApiProperty({ example: '12', description: '고른 시간 칸 번호' }) @IsString() @Matches(/^[0-9]{1,18}$/) slotId!: string;
  @ApiPropertyOptional({ example: '주차 가능한지 궁금합니다', description: '한 줄 메모(200자 · 연락처는 적지 마십시오)' }) @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class VsxCancelDto {
  @ApiPropertyOptional({ example: '일정이 바뀜', description: '취소 까닭(200자 · 상대에게 보임)' }) @IsOptional() @IsString() @Length(0, 200) reason?: string;
}
export class VsxMarkDto {
  @ApiProperty({ enum: ['NOSHOW', 'DONE'] }) @IsIn(['NOSHOW', 'DONE']) result!: string;
}
export class VsxSlotOpenDto {
  @ApiProperty({ example: '2026-11-25', description: '날짜(오늘 ~ vsx.slot_days 일 뒤 · 한국)' }) @IsString() @Matches(VSX_DATE_RE) date!: string;
  @ApiProperty({ example: ['14:00', '15:00'], description: '시작 시각 HH:MM(10분 단위) 1 ~ 24개' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(24) @IsString({ each: true }) @Matches(VSX_TIME_RE, { each: true }) times!: string[];
  @ApiProperty({ enum: VSX_MINUTES, example: 30, description: '한 칸 길이(분)' }) @IsInt() @IsIn(VSX_MINUTES as unknown as number[]) minutes!: number;
}
export class VsxMapQueryDto {
  @ApiPropertyOptional({ example: 8, description: '카카오 지도 단계 1(가까움) ~ 14(멂) · 처음 8' }) @IsOptional() @IsInt() @Min(1) @Max(14) level?: number;
  @ApiPropertyOptional({ example: 'MAL', description: '관 코드(비우면 모두)' }) @IsOptional() @IsString() @Matches(MAP_GWANS_RE) gwan?: string;
  @ApiPropertyOptional({ example: 37.4 }) @IsOptional() @IsNumber() swLat?: number;
  @ApiPropertyOptional({ example: 126.8 }) @IsOptional() @IsNumber() swLng?: number;
  @ApiPropertyOptional({ example: 37.7 }) @IsOptional() @IsNumber() neLat?: number;
  @ApiPropertyOptional({ example: 127.2 }) @IsOptional() @IsNumber() neLng?: number;
}
export class VsxExportRequestDto {
  @ApiProperty({ example: '분기 상담 실적 정리', description: '사유 2 ~ 150자(승인하는 담당자가 봄)' }) @IsString() @Length(2, 150) reason!: string;
}
export class VsxSettingsDto {
  @ApiPropertyOptional({ description: 'vsx.enabled' }) @IsOptional() @StrictBoolean() visitOn?: boolean;
  @ApiPropertyOptional({ example: ['MNY', 'HLT'], description: 'vsx.gwans — 방문 예약을 쓰는 관(빈 배열 = 모두 끔 · 30개까지 · 대표 11/21 관별 설정)' }) @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @Matches(VSX_GWAN_RE, { each: true }) visitGwans?: string[];
  @ApiPropertyOptional({ example: 30 }) @IsOptional() @IsInt() @Min(1) @Max(90) slotDays?: number;
  @ApiPropertyOptional({ example: 60 }) @IsOptional() @IsInt() @Min(1) @Max(200) maxOpen?: number;
  @ApiPropertyOptional({ description: 'map.cluster_enabled' }) @IsOptional() @StrictBoolean() mapOn?: boolean;
  @ApiPropertyOptional({ description: 'map.cluster_grid(법무 확인 뒤)' }) @IsOptional() @StrictBoolean() mapGrid?: boolean;
  @ApiPropertyOptional({ example: 3 }) @IsOptional() @IsInt() @Min(2) @Max(20) mapMin?: number;
  @ApiPropertyOptional({ description: 'ptn.export_enabled' }) @IsOptional() @StrictBoolean() exportOn?: boolean;
  @ApiPropertyOptional({ example: 5000 }) @IsOptional() @IsInt() @Min(100) @Max(20000) exportMaxRows?: number;
  @ApiPropertyOptional({ description: 'papi.bill_enabled' }) @IsOptional() @StrictBoolean() billOn?: boolean;
  @ApiPropertyOptional({ example: 10000 }) @IsOptional() @IsInt() @Min(0) @Max(10000000) billFreeCalls?: number;
  @ApiPropertyOptional({ example: 1000 }) @IsOptional() @IsInt() @Min(0) @Max(100000) billPrice1k?: number;
  @ApiPropertyOptional({ example: 3 }) @IsOptional() @IsInt() @Min(1) @Max(28) billDay?: number;
  @ApiProperty({ example: '법무 확인 끝 · 방문 예약 켬' }) @IsString() @Length(2, 200) reason!: string;
}
export class VsxBillConfirmDto {
  @ApiProperty({ example: '확정', description: '확인 글자 「확정」' }) @IsString() @Length(1, 10) confirm!: string;
}
export class VsxBillVoidDto {
  @ApiProperty({ example: '단가 잘못 넣음' }) @IsString() @Length(2, 200) reason!: string;
}
export class VsxUsageRunDto {
  @ApiPropertyOptional({ example: '2026-10', description: '이 달 초안도 다시 셈(비우면 하루 사용량만 모음)' }) @IsOptional() @IsString() @Matches(BILL_YM) ym?: string;
}

const me = () => RequestCtx.actorId() ?? '';

@ApiTags('VSX')
@ApiBearerAuth()
@Controller('api/v1/vsx')
@Roles(...MEMBERS)
@ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
export class VsxMemberController {
  constructor(private readonly db: DatabaseService) {}

  @Get('listings/:id/slots')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '매물 방문 시간 칸 (v10.542)', description: '열린 앞 칸(남이 고른 칸은 taken) · 내 살아 있는 예약 · 내 매물이면 own — 꺼져 있으면 enabled false · 빈 목록.' })
  @ApiOkResponse({ type: Object })
  slots(@Param('id') id: string) { return visitSlotsForMember(this.db, id, me()); }

  @Post('listings/:id/book')
  @HttpCode(200)
  @Audit('VSX_BOOK', 'LISTING')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '방문 예약 요청 (v10.542)', description: '열린 앞 칸 하나 · 한 줄 메모 · 매물마다 살아 있는 예약 하나 · 모두 10개까지 · 자기 매물 안 됨 · 매물 주인에게 알림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'VSX_OFF · VSX_LISTING · VSX_ALREADY · VSX_SLOT_CLOSED · VSX_SLOT_TAKEN' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VSX_GWAN_OFF · VSX_BOOKING_SELF · VSX_LIMIT · VSX_SLOT_ID · VSX_BOOKING_SLOT' })
  book(@Param('id') id: string, @Body() dto: VsxBookDto) { return bookVisit(this.db, id, me(), dto.slotId, dto.memo); }

  @Get('me')
  @ApiOperation({ summary: '나의공간 › 방문 예약 (v10.542)', description: '내가 한 예약 50 · 내 매물에 온 예약 100(가린 이름 · 메모 — 노쇼 횟수는 싣지 않음 · 운영 화면에서만) · 방문 예약을 쓰는 관의 내 게시 매물(열린 칸 수) · 설정.' })
  @ApiOkResponse({ type: Object })
  mine() { return myVisits(this.db, me()); }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @Audit('VSX_CANCEL', 'LISTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '방문 예약 취소 (v10.542)', description: '회원(자기 예약) 또는 매물 주인 · 방문 전 요청 · 확정만 · 상대에게 알림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'VSX_BOOKING_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  cancel(@Param('id') id: string, @Body() dto: VsxCancelDto) { return cancelVisit(this.db, id, me(), dto.reason); }

  @Post('bookings/:id/confirm')
  @HttpCode(200)
  @Audit('VSX_CONFIRM', 'LISTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '방문 예약 확정 (v10.542 · 매물 주인)', description: '방문 전 요청만 · 회원에게 알림 · 전날 한 번 더 알림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'VSX_BOOKING_STATE · VSX_BOOKING_PAST' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  confirm(@Param('id') id: string) { return confirmVisit(this.db, id, me()); }

  @Post('bookings/:id/mark')
  @HttpCode(200)
  @Audit('VSX_MARK', 'LISTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '노쇼 · 방문 끝 표시 (v10.542 · 매물 주인)', description: '확정 예약 · 방문 시각 뒤 7일 안 · 노쇼 횟수는 운영 화면에서만 봄(대표 11/21).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'VSX_BOOKING_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VSX_RESULT · VSX_BOOKING_EARLY · VSX_BOOKING_LATE' })
  mark(@Param('id') id: string, @Body() dto: VsxMarkDto) { return markVisit(this.db, id, me(), dto.result); }

  @Get('owner/listings/:id/slots')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '내 매물 방문 칸 (v10.542 · 매물 주인)', description: '앞으로 · 지난 7일 칸 300 · 칸마다 예약(가린 이름 · 메모 · 상태).' })
  @ApiOkResponse({ type: Object })
  ownerSlots(@Param('id') id: string) { return ownerSlots(this.db, id, me()); }

  @Post('owner/listings/:id/slots')
  @HttpCode(200)
  @Audit('VSX_SLOT_OPEN', 'LISTING')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '방문 칸 열기 (v10.542 · 매물 주인)', description: '날짜 하나 · 시각 1 ~ 24개(10분 단위) · 길이 · 겹침 · 지난 시각 · 칸 수 넘침은 건너뜀(까닭과 함께).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'VSX_OFF · VSX_LISTING' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VSX_GWAN_OFF · VSX_DATE · VSX_DATE_RANGE · VSX_TIME · VSX_MINUTES · VSX_MAX_OPEN' })
  open(@Param('id') id: string, @Body() dto: VsxSlotOpenDto) { return openSlots(this.db, id, me(), { date: dto.date, times: dto.times, minutes: dto.minutes }); }

  @Post('owner/slots/:id/close')
  @HttpCode(200)
  @Audit('VSX_SLOT_CLOSE', 'LISTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '방문 칸 닫기 (v10.542 · 매물 주인)', description: '그 칸의 방문 전 요청 · 확정 예약은 주인 취소로 · 회원에게 알림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'VSX_SLOT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  close(@Param('id') id: string) { return closeSlot(this.db, id, me()); }
}

/* ★ 공개 — 로그인 없음 · @Roles 없음(check-acl 공개 구역 listings) · 묶음 가운데 좌표 · 수만(매물 id · 주소 · 매물 좌표 없음) */
@ApiTags('HOM')
@Controller('api/v1/listings')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class VsxMapController {
  constructor(private readonly db: DatabaseService, private readonly geo: GeoService) {}

  @Get('map/clusters')
  @ApiOperation({ summary: '지도 매물 묶음 (공개 · v10.543)', description: '줌 단계별 — 10 ~ 14 시 · 도 · 7 ~ 9 시 · 구(가운데 = 시 · 구 중심) · 1 ~ 6 격자(map.cluster_grid on · 2km 넘는 격자 가운데 · 3개 아래 격자는 시 · 구로 합침) · 지도 · 카카오 키가 없으면 LIST(좌표 없이 시 · 구 수) · map.cluster_enabled off(처음)면 enabled false.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MAP_LEVEL · MAP_GWAN · MAP_BBOX' })
  clusters(@Query() q: VsxMapQueryDto) {
    return mapClusters(this.db, this.geo, { level: q.level, gwan: q.gwan, swLat: q.swLat, swLng: q.swLng, neLat: q.neLat, neLng: q.neLng });
  }
}

@ApiTags('PTC')
@ApiBearerAuth()
@Controller('api/v1/partner')
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
@ApiResponse({ status: 409, description: 'NOT_PARTNER', type: ErrorDto })
export class VsxPartnerController {
  constructor(private readonly db: DatabaseService, private readonly actors: PartnerActorService) {}

  @Get('export')
  @ApiOperation({ summary: '파트너 자료 내려받기 상태 (v10.544)', description: '스위치 · 내려받을 수 있는지(대표 · 정산 권한) · 승인 번호(24시간 안) · 기다리는 요청 · 최근 기록 20.' })
  @ApiOkResponse({ type: Object })
  status() { return ptnExportStatus(this.db, this.actors, RequestCtx.actorId() ?? null); }

  @Post('export/request')
  @HttpCode(200)
  @ApiOperation({ summary: '리드 CSV 승인 요청 (v10.544)', description: '사유 2 ~ 150자 — 다른 SUPER 가 위험감지 › 감사 › 내려받기 승인에서 결정 · 하루 10건 · 같은 요청이 열려 있으면 그것을 돌려줌(감사 기록은 서비스가 직접).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'PTN_EXPORT_ROLE' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PTN_EXPORT_OFF · NOT_PARTNER' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_REASON · EXPORT_DAILY_LIMIT' })
  request(@Body() dto: VsxExportRequestDto) { return ptnExportRequest(this.db, this.actors, RequestCtx.actorId() ?? null, dto.reason); }

  @ExportGate('PTN_LEADS')
  @Get('export/leads')
  @ApiOperation({ summary: '리드 CSV (v10.544 · 승인 뒤 한 번)', description: '?ticket=승인 번호 · from · to(366일까지 · 처음 90일) — 연락처 칸 없음 · 요약의 전화 · 메일 가림 · ptn.export_max_rows 줄까지 · 기록 · 감사 PTN_EXPORT_LEADS.' })
  @ApiQuery({ name: 'from', required: false, description: '배정 시작일 YYYY-MM-DD(비우면 끝 − 89일)' }) @ApiQuery({ name: 'to', required: false, description: '배정 끝일(비우면 오늘)' })
  @ApiOkResponse({ schema: { type: 'object', properties: { filename: { type: 'string' }, csv: { type: 'string' }, rows: { type: 'integer' }, note: { type: 'string' } } } })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'PTN_EXPORT_ROLE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL · PTN_EXPORT_RANGE' })
  leads(@Query('ticket') ticket?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return ptnExportLeads(this.db, this.actors, RequestCtx.actorId() ?? null, String(ticket ?? ''), from, to);
  }

  @Get('export/perf')
  @ApiOperation({ summary: '성과 CSV (v10.544 · 숫자만)', description: '최근 12개월 달마다 받은 리드 · 열람 · 1시간 안 열람 · 리드 이용료 확정 — 승인 없이 기록 · 감사 PTN_EXPORT_PERF.' })
  @ApiOkResponse({ schema: { type: 'object', properties: { filename: { type: 'string' }, csv: { type: 'string' }, rows: { type: 'integer' }, note: { type: 'string' } } } })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'PTN_EXPORT_ROLE' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PTN_EXPORT_OFF' })
  perf() { return ptnExportPerf(this.db, this.actors, RequestCtx.actorId() ?? null); }
}

/* ★ 파트너 시스템이 부르는 주소 — API 키(PartnerApiKeyGuard · ㊼ 와 같은 가드 · 같은 요청 기록) · 읽기만 · 범위 없이 키만 맞으면 */
@ApiTags('PAPI')
@Controller('api/partner/v1')
@UseGuards(PartnerApiKeyGuard)
@ApiHeader({ name: 'X-Partner-Key', required: true, description: '파트너 API 키 sgbp_xxxxxxxx_…' })
@ApiResponse({ status: 401, description: 'PAPI_KEY_INVALID · PAPI_KEY_REVOKED · PAPI_KEY_EXPIRED', type: ErrorDto })
@ApiResponse({ status: 429, description: 'PAPI_RATE_LIMIT', type: ErrorDto })
@ApiResponse({ status: 503, description: 'PAPI_OFF', type: ErrorDto })
export class VsxPapiUsageController {
  constructor(private readonly db: DatabaseService) {}

  @Get('usage')
  @ApiOperation({ summary: '내 API 사용량 (파트너 API v1 · v10.545)', description: '이번 달 · 지난달 과금 대상 · 안내 · 오류 호출 수(하루 한 번 모음) · 과금이 켜졌으면 무료 수 · 1,000건 단가 · 예상 금액(부가세 별도) · 확정 청구서 3 — 이 주소는 과금하지 않음.' })
  @ApiOkResponse({ type: Object })
  usage(@Req() req: Request & { papi: PapiPrincipal }) { return papiMyUsage(this.db, req.papi); }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/vsx')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class VsxAdminController {
  constructor(private readonly db: DatabaseService, private readonly geo: GeoService) {}

  @Get('visits')
  @ApiOperation({ summary: '매물 방문 예약 한눈에 (v10.542)', description: '설정 · 관별 스위치(관 목록 · 켜짐) · 최근 30일 상태별 수 · 저절로 취소 수 · 열린 앞 칸 · 최근 예약 100(가린 이름 · 지난 180일 노쇼 횟수 — 운영만 · 연락처 없음).' })
  @ApiOkResponse({ type: Object })
  visits() { return adminVisits(this.db); }

  @Post('visits/run')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('VSX_VISIT_RUN', 'SETTING')
  @ApiOperation({ summary: '방문 예약 정기 작업 지금 한 번 (v10.542 · SUPER)', description: 'vsx_visit 과 같음 — 지난 칸 요청 저절로 취소 · 전날 알림(꺼져 있으면 on: false).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'POLICY' })
  visitRun() { return vsxVisitJob(this.db); }

  @Get('map')
  @ApiOperation({ summary: '지도 매물 묶음 미리보기 (v10.543)', description: '설정 · 스위치가 꺼져 있어도 결과 모양을 봄(공개 주소와 같은 셈) · 격자 단계는 map.cluster_grid on 일 때만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'MAP_LEVEL · MAP_GWAN' })
  async map(@Query() q: VsxMapQueryDto) {
    const preview = await mapClusters(this.db, this.geo, { level: q.level, gwan: q.gwan, swLat: q.swLat, swLng: q.swLng, neLat: q.neLat, neLng: q.neLng }, true);
    return { settings: await vsxSettings(this.db), map: await this.geo.publicConfig().then((c) => ({ enabled: c.enabled })), preview };
  }

  @Put('settings')
  @Roles('SUPER')
  @Audit('VSX_SETTINGS', 'SETTING')
  @ApiOperation({ summary: '(54) 매물 · 파트너 설정 (v10.542 ~ 545 · SUPER)', description: '방문 예약 · 지도 묶음(격자는 법무 확인 뒤) · 파트너 자료 내려받기 · 오픈 API 과금 스위치와 값 · 사유(설정 바뀜 기록) · 보낸 칸만 바꿈.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VSX_REASON · VSX_RANGE · VSX_GWANS · VSX_NOTHING' })
  settings(@Body() dto: VsxSettingsDto) {
    return setVsxSettings(this.db, {
      visitOn: dto.visitOn, visitGwans: dto.visitGwans, slotDays: dto.slotDays, maxOpen: dto.maxOpen, mapOn: dto.mapOn, mapGrid: dto.mapGrid, mapMin: dto.mapMin,
      exportOn: dto.exportOn, exportMaxRows: dto.exportMaxRows, billOn: dto.billOn, billFreeCalls: dto.billFreeCalls, billPrice1k: dto.billPrice1k, billDay: dto.billDay, reason: dto.reason,
    });
  }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/vsx')
@Roles('ADMIN', 'SUPER', 'PARTNER_MAL')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class VsxPtnAdminController {
  constructor(private readonly db: DatabaseService) {}

  @Get('papi-usage')
  @ApiQuery({ name: 'ym', required: false, description: 'YYYY-MM(비우면 지난달 · 한국)' })
  @ApiOperation({ summary: '오픈 API 사용량 · 청구서 초안 (v10.545)', description: '그 달 파트너별 과금 대상 · 안내 · 오류 호출 · 키 수 · 지금 값으로 셈한 예상 · 청구서 초안(상태 · 확정한 사람) · 설정.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PAPI_BILL_YM' })
  usage(@Query('ym') ym?: string) { return papiUsageView(this.db, ym); }

  @Post('papi-usage/run')
  @Roles('SUPER')
  @HttpCode(200)
  /* 감사 기록은 서비스가 직접(PAPI_BILL_MAKE) */
  @ApiOperation({ summary: '사용량 지금 모으기 · 초안 다시 셈 (v10.545 · SUPER)', description: '지난 3일 하루 사용량을 다시 모음 · ym 을 보내면 그 달을 다시 모으고 초안을 만들거나 다시 셈(확정 · 무효는 그대로 · 과금 스위치와 상관없이 사람이 누름).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PAPI_BILL_YM · PAPI_USAGE_RANGE' })
  run(@Body() dto: VsxUsageRunDto) { return papiUsageRunNow(this.db, dto.ym); }

  @Post('papi-bills/:id/confirm')
  @Roles('SUPER')
  @HttpCode(200)
  /* 감사 기록은 서비스가 직접(PAPI_BILL_CONFIRM) */
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '청구서 확정 (v10.545 · SUPER · 사람)', description: '확인 글자 「확정」 · 초안만 · 확정 뒤 숫자는 DB 가 막음 · 실제 청구 · 세금계산서는 이 화면 밖.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PAPI_BILL_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PAPI_BILL_CONFIRM' })
  confirm(@Param('id') id: string, @Body() dto: VsxBillConfirmDto) { return papiBillConfirm(this.db, id, dto.confirm); }

  @Post('papi-bills/:id/void')
  @Roles('SUPER')
  @HttpCode(200)
  /* 감사 기록은 서비스가 직접(PAPI_BILL_VOID) */
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '청구서 무효 (v10.545 · SUPER)', description: '사유 2 ~ 200자 · 초안 · 확정 모두 · 그 달 새 초안은 「지금 다시 셈」으로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PAPI_BILL_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PAPI_BILL_REASON' })
  voidBill(@Param('id') id: string, @Body() dto: VsxBillVoidDto) { return papiBillVoid(this.db, id, dto.reason); }

  @Get('ptn-exports')
  @ApiOperation({ summary: '파트너 자료 내려받기 기록 (v10.544)', description: '최근 내려받기 200(회사 · 종류 · 줄 수 · 기간 · 승인 번호) · PTN_LEADS 승인 요청 50 · 설정 — 승인은 위험감지 › 감사(SUPER).' })
  @ApiOkResponse({ type: Object })
  exports() { return adminPtnExports(this.db); }
}
