import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { RequireGate, Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { mbxSwitches, TARGET_TYPES } from './common';
import { clearRecent, listRecent, mergeRecent, recordView, removeRecent } from './recent';
import { compareItems } from './compare';
import { addWatch, listWatches, removeWatch } from './price';
import { adminDecide, adminOpenReported, adminReports, dmBlock, dmCheck, dmDetail, dmPartners, dmReport, dmSend, DM_BASIS, DM_REPORT_REASONS, DM_SIDES, listDm, openDm } from './dm';
import { mbxOverview, setMbxSettings } from './jobs';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * v10.501 ~ 504 (D273 · docs/639 ~ 642) ㊸ 회원 2 — 최근 본 · 비교하기 · 가격 변동 알림 · 회원 간 1:1 대화
 *   공개(로그인 없이 · 개인정보 없음)  GET /site/mbx/switches · GET /site/mbx/compare
 *   회원                              GET · POST · DELETE /me/recent · POST /me/recent/merge · DELETE /me/recent/{type}/{key}
 *                                     GET · POST /me/price-alerts · DELETE /me/price-alerts/{type}/{key}
 *                                     GET · POST /me/dm · GET /me/dm/partners · POST /me/dm/check · GET /me/dm/{id} · POST /me/dm/{id}/messages · /block · /report
 *   운영(회원 › 회원 편의 기능 · 회원 대화 신고) GET /admin/mbx/overview · PUT /admin/mbx/settings(SUPER)
 *                                     GET /admin/mbx/dm/reports · POST /admin/mbx/dm/reports/{id}/open(사유) · POST /admin/mbx/dm/reports/{id}/decide
 *   세무사(ACCOUNTANT)는 /admin/acct/ 밖이라 보지 않음(회원 대화 · 행동 기록)
 * ------------------------------------------------------------------- */

const MEMBER = ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'] as const;
const me = () => RequestCtx.actorId()!;

export class MbxRecentDto {
  @ApiProperty({ enum: TARGET_TYPES }) @IsIn(TARGET_TYPES as unknown as string[]) type!: string;
  @ApiProperty({ example: '3f1c…', description: '매물 uuid 또는 소개몰 상품 코드' }) @IsString() @Length(1, 60) key!: string;
}
export class MbxRecentMergeItemDto {
  @ApiProperty({ enum: TARGET_TYPES }) @IsIn(TARGET_TYPES as unknown as string[]) type!: string;
  @ApiProperty() @IsString() @Length(1, 60) key!: string;
  @ApiPropertyOptional({ example: '2026-11-20T01:00:00.000Z', description: '이 브라우저에서 본 시각' }) @IsOptional() @IsString() @MaxLength(40) at?: string;
}
export class MbxRecentMergeDto {
  @ApiProperty({ type: [MbxRecentMergeItemDto] }) @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => MbxRecentMergeItemDto) items!: MbxRecentMergeItemDto[];
}
export class MbxWatchDto {
  @ApiProperty({ enum: TARGET_TYPES }) @IsIn(TARGET_TYPES as unknown as string[]) type!: string;
  @ApiProperty({ description: '매물 uuid(관심 목록에 담은 것) 또는 소개몰 상품 코드' }) @IsString() @Length(1, 60) key!: string;
  @ApiPropertyOptional({ example: false, description: '내릴 때만 알림' }) @IsOptional() @StrictBoolean() dropOnly?: boolean;
}
export class MbxDmOpenDto {
  @ApiProperty({ enum: DM_BASIS }) @IsIn(DM_BASIS as unknown as string[]) basisType!: string;
  @ApiProperty({ format: 'uuid', description: '거래 번호(DEAL) · 문의 대화 번호(INQUIRY)' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) basisId!: string;
  @ApiProperty({ enum: DM_SIDES, description: '상대 쪽' }) @IsIn(DM_SIDES as unknown as string[]) side!: string;
}
export class MbxDmSendDto {
  @ApiProperty({ minLength: 1, maxLength: 1000 }) @IsString() @Length(1, 1000) body!: string;
  @ApiPropertyOptional({ description: '경고를 보고도 보냄(「그래도 보내기」)' }) @IsOptional() @StrictBoolean() confirm?: boolean;
}
export class MbxDmCheckDto {
  @ApiProperty({ minLength: 1, maxLength: 1000 }) @IsString() @Length(1, 1000) body!: string;
}
export class MbxDmBlockDto {
  @ApiProperty({ example: true }) @StrictBoolean() on!: boolean;
}
export class MbxDmReportDto {
  @ApiProperty({ enum: DM_REPORT_REASONS }) @IsIn(DM_REPORT_REASONS as unknown as string[]) reason!: string;
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) detail?: string;
}
export class MbxAdminSettingsDto {
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() recent?: boolean;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() compare?: boolean;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() priceAlert?: boolean;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() dm?: boolean;
  @ApiPropertyOptional({ enum: ['WARN', 'MASK', 'BLOCK'] }) @IsOptional() @IsIn(['WARN', 'MASK', 'BLOCK']) patternMode?: string;
  @ApiPropertyOptional({ example: 20 }) @IsOptional() @IsInt() @Min(5) @Max(50) recentMax?: number;
  @ApiPropertyOptional({ example: 90 }) @IsOptional() @IsInt() @Min(7) @Max(365) recentKeepDays?: number;
  @ApiPropertyOptional({ example: 50 }) @IsOptional() @IsInt() @Min(1) @Max(200) watchMax?: number;
  @ApiPropertyOptional({ example: 10 }) @IsOptional() @IsInt() @Min(1) @Max(60) rateMin?: number;
  @ApiPropertyOptional({ example: 300 }) @IsOptional() @IsInt() @Min(10) @Max(2000) rateDay?: number;
  @ApiPropertyOptional({ example: 365 }) @IsOptional() @IsInt() @Min(30) @Max(1825) retentionDays?: number;
  @ApiPropertyOptional({ example: 180 }) @IsOptional() @IsInt() @Min(30) @Max(1825) reportKeepDays?: number;
  @ApiProperty({ example: '법무 확인 끝 · 회원 대화 켬' }) @IsString() @Length(2, 200) reason!: string;
}
export class MbxAdminOpenDto {
  @ApiProperty({ example: '신고 처리 — 직접 입금 유도 확인', minLength: 2, maxLength: 200 }) @IsString() @Length(2, 200) reason!: string;
}
export class MbxAdminDecideDto {
  @ApiProperty({ enum: ['UPHELD', 'DISMISSED'] }) @IsIn(['UPHELD', 'DISMISSED']) result!: string;
  @ApiProperty({ example: '계좌 안내로 직접 입금 유도 — 대화 닫음 · 경고' }) @IsString() @Length(2, 400) note!: string;
  @ApiPropertyOptional({ description: '조치(UPHELD)면 대화 닫기' }) @IsOptional() @StrictBoolean() lock?: boolean;
}

@ApiTags('MYP')
@ApiBearerAuth()
@Controller('api/v1')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class MbxController {
  constructor(private readonly db: DatabaseService) {}

  /* ── 공개 ── */
  @Get('site/mbx/switches')
  @ApiOperation({ summary: '회원 편의 기능 스위치 (v10.501 ~ 504)', description: '최근 본 · 비교 · 가격 알림 · 회원 대화가 켜져 있는지(사용자 웹이 단추를 그릴지 정함). 개인정보 없음.' })
  @ApiOkResponse({ type: Object })
  switches() { return mbxSwitches(this.db); }

  @Get('site/mbx/compare')
  @ApiOperation({ summary: '비교하기 (v10.502)', description: '매물끼리 또는 상품끼리 최대 4개 · 공개 칸만 · 게시 중 · 판매 중인 것만(빠진 수 missing). 로그인 없이.' })
  @ApiQuery({ name: 'type', enum: TARGET_TYPES })
  @ApiQuery({ name: 'ids', description: '쉼표로 — 매물 uuid 또는 상품 코드 · 최대 4' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, description: 'MBX_COMPARE_MAX · MBX_COMPARE_IDS · MBX_TYPE', type: ErrorDto })
  compare(@Query('type') type: string, @Query('ids') ids?: string) { return compareItems(this.db, type, ids); }

  /* ── v10.501 최근 본 ── */
  @Get('me/recent')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '최근 본 매물 · 상품 (v10.501)', description: '최근 순 · mbx.recent_max(20)개 · 내려간 것은 open=false.' })
  @ApiOkResponse({ type: Object })
  recent() { return listRecent(this.db, me()); }

  @Post('me/recent')
  @HttpCode(200)
  @Roles(...MEMBER)
  @ApiOperation({ summary: '본 것 적기 (v10.501)', description: '스위치가 꺼져 있거나 내 매물이면 saved=false. 게시 중 · 판매 중인 것만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 매물 · 상품', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MBX_TYPE', type: ErrorDto })
  record(@Body() dto: MbxRecentDto) { return recordView(this.db, me(), dto.type, dto.key); }

  @Post('me/recent/merge')
  @HttpCode(200)
  @Roles(...MEMBER)
  @ApiOperation({ summary: '이 브라우저의 최근 본 합치기 (v10.501)', description: '로그인 전 localStorage 에 쌓인 것 — 최대 mbx.recent_max · 보관 기간 밖 · 없는 것은 건너뜀.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, description: 'MBX_RECENT_MANY', type: ErrorDto })
  merge(@Body() dto: MbxRecentMergeDto) { return mergeRecent(this.db, me(), dto.items ?? []); }

  @Delete('me/recent')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '최근 본 모두 지우기 (v10.501)' })
  @ApiOkResponse({ type: Object })
  clear() { return clearRecent(this.db, me()); }

  @Delete('me/recent/:type/:key')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '최근 본 하나 지우기 (v10.501)' })
  @ApiParam({ name: 'type', enum: TARGET_TYPES }) @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, description: 'MBX_TYPE', type: ErrorDto })
  removeRecent(@Param('type') type: string, @Param('key') key: string) { return removeRecent(this.db, me(), type, key); }

  /* ── v10.503 가격 변동 알림 ── */
  @Get('me/price-alerts')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '가격 변동 알림 (v10.503)', description: '켠 것(기준값 · 지금 값) · 켤 수 있는 관심 매물. 매일 08:30 묶음 알림.' })
  @ApiOkResponse({ type: Object })
  watches() { return listWatches(this.db, me()); }

  @Post('me/price-alerts')
  @HttpCode(200)
  @Roles(...MEMBER)
  @ApiOperation({ summary: '가격 알림 켜기 (v10.503)', description: '매물은 관심 목록에 담은 것만 · 상품은 바로. 기준값 = 지금 값.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 매물 · 상품', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MBX_OFF · MBX_NEED_FAVORITE · MBX_WATCH_MAX', type: ErrorDto })
  addWatch(@Body() dto: MbxWatchDto) { return addWatch(this.db, me(), dto.type, dto.key, dto.dropOnly); }

  @Delete('me/price-alerts/:type/:key')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '가격 알림 끄기 (v10.503)' })
  @ApiParam({ name: 'type', enum: TARGET_TYPES }) @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, description: 'MBX_TYPE', type: ErrorDto })
  removeWatch(@Param('type') type: string, @Param('key') key: string) { return removeWatch(this.db, me(), type, key); }

  /* ── v10.504 회원 간 1:1 대화 ── */
  @Get('me/dm')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '회원 대화 목록 (v10.504)', description: '상대 이름은 김OO · 마지막 글 60자 · 안 읽은 수.' })
  @ApiOkResponse({ type: Object })
  dmList() { return listDm(this.db); }

  @Get('me/dm/partners')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '대화를 열 수 있는 상대 (v10.504)', description: '내 거래(사는 쪽 · 파는 쪽 · 소개자) · 문의 대화의 다른 당사자 — 상대 계정 번호는 싣지 않음.' })
  @ApiOkResponse({ type: Object })
  dmPartners() { return dmPartners(this.db); }

  @Post('me/dm')
  @HttpCode(200)
  @Roles(...MEMBER)
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({ summary: '회원 대화 열기 (v10.504)', description: '거래 · 문의의 당사자끼리만. 이미 있으면 그 대화(created=false).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, description: 'NOT_PARTICIPANT · IDENTITY_REQUIRED', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'MBX_DM_GONE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MBX_OFF · MBX_DM_SIDE · MBX_DM_SELF · MBX_DM_BASIS', type: ErrorDto })
  @Audit('MBX_DM_OPEN', 'MBX_DM')
  dmOpen(@Body() dto: MbxDmOpenDto) { return openDm(this.db, dto); }

  @Post('me/dm/check')
  @HttpCode(200)
  @Roles(...MEMBER)
  @ApiOperation({ summary: '보내기 전 확인 (v10.504)', description: '연락처 · 계좌 · 메일 · 플랫폼 밖 거래 표현 · 지금 감지 방식(WARN · MASK · BLOCK) · 가린 미리보기. 저장하지 않음.' })
  @ApiOkResponse({ type: Object })
  dmCheck(@Body() dto: MbxDmCheckDto) { return dmCheck(this.db, dto.body); }

  @Get('me/dm/:id')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '회원 대화 글 (v10.504)', description: '대화 당사자만 · 받은 글 읽음 표시.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, description: 'NOT_PARTICIPANT', type: ErrorDto })
  dmDetail(@Param('id') id: string) { return dmDetail(this.db, id); }

  @Post('me/dm/:id/messages')
  @HttpCode(200)
  @Roles(...MEMBER)
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({ summary: '회원 대화 보내기 (v10.504)', description: '글만 1 ~ 1,000자 · 분당 · 하루 수 제한 · 연락처 · 계좌 · 메일 감지(경고 → confirm=true 로 다시 · MASK 면 가려 저장 · BLOCK 이면 막음).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, description: 'NOT_PARTICIPANT', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'MBX_DM_LOCKED · MBX_DM_BLOCKED_BY · MBX_DM_GONE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MBX_OFF · MBX_DM_WARN · MBX_DM_BLOCKED · MBX_DM_RATE · MBX_DM_LEN', type: ErrorDto })
  dmSend(@Param('id') id: string, @Body() dto: MbxDmSendDto) { return dmSend(this.db, id, dto); }

  @Post('me/dm/:id/block')
  @HttpCode(200)
  @Roles(...MEMBER)
  @ApiOperation({ summary: '회원 대화 차단 · 풀기 (v10.504)', description: '차단하면 서로 보낼 수 없음 · 차단한 사람만 풂.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'MBX_DM_BLOCKED_BY', type: ErrorDto })
  @Audit('MBX_DM_BLOCK', 'MBX_DM')
  dmBlock(@Param('id') id: string, @Body() dto: MbxDmBlockDto) { return dmBlock(this.db, id, dto.on); }

  @Post('me/dm/:id/report')
  @HttpCode(200)
  @Roles(...MEMBER)
  @ApiOperation({ summary: '회원 대화 신고 (v10.504)', description: '사유 · 내용(500자) → 운영 알림 MBX_DM_REPORT(글은 싣지 않음). 운영자는 신고된 대화만 사유를 적고 엶.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'MBX_DM_REPORTED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MBX_DM_REASON', type: ErrorDto })
  @Audit('MBX_DM_REPORT', 'MBX_DM')
  dmReport(@Param('id') id: string, @Body() dto: MbxDmReportDto) { return dmReport(this.db, id, dto); }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/mbx')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class MbxAdminController {
  constructor(private readonly db: DatabaseService) {}

  @Get('overview')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '회원 편의 기능 한눈에 (v10.501 ~ 504)', description: '스위치 · 설정 · 최근 본 · 가격 알림 · 대화 수 · 감지 종류별 수(30일) · 정리 기록. 개인 식별 없음.' })
  @ApiOkResponse({ type: Object })
  overview() { return mbxOverview(this.db); }

  @Put('settings')
  @Roles('SUPER')
  @ApiOperation({ summary: '회원 편의 기능 설정 (SUPER · v10.501 ~ 504)', description: '스위치 4개(처음 모두 꺼짐) · 감지 방식 · 수 제한 · 보관 일수. 사유 필수(설정 바뀐 기록).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, description: 'MBX_REASON · MBX_MODE · MBX_RANGE · MBX_NOTHING', type: ErrorDto })
  @Audit('MBX_SETTINGS', 'SITE_SETTING')
  settings(@Body() dto: MbxAdminSettingsDto) { return setMbxSettings(this.db, dto); }

  @Get('dm/reports')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'state', required: false, enum: ['OPEN', 'UPHELD', 'DISMISSED'] })
  @ApiOperation({ summary: '회원 대화 신고 목록 (v10.504)', description: '대화 글은 싣지 않음 — 사유 · 신고 내용 · 가린 이름 · 글 수 · 감지 수 · 열람 수.' })
  @ApiOkResponse({ type: Object })
  reports(@Query('state') state?: string) { return adminReports(this.db, state); }

  @Post('dm/reports/:id/open')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @ApiParam({ name: 'id', example: '12' })
  @ApiOperation({ summary: '신고된 대화 열람 (v10.504)', description: '신고가 있는 대화만 · 사유 2 ~ 200자 필수 · 열 때마다 mbx_dm_admin_views + 개인정보 접속기록.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 신고', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MBX_VIEW_REASON', type: ErrorDto })
  open(@Param('id') id: string, @Body() dto: MbxAdminOpenDto) { return adminOpenReported(this.db, id, dto.reason); }

  @Post('dm/reports/:id/decide')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @ApiParam({ name: 'id', example: '12' })
  @ApiOperation({ summary: '회원 대화 신고 처리 (v10.504)', description: '조치(UPHELD · 대화 닫기 선택) · 기각(DISMISSED) · 처리 내용 필수 · 운영 알림 풀림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'MBX_DECIDED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MBX_DECIDE', type: ErrorDto })
  @Audit('MBX_DM_DECIDE', 'MBX_DM_REPORT')
  decide(@Param('id') id: string, @Body() dto: MbxAdminDecideDto) { return adminDecide(this.db, id, dto); }
}
