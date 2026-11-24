import { Body, Controller, Delete, Get, Headers, HttpCode, Ip, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { StrictBoolean } from '../../common/strict-boolean';
import { LAYOUT_KEYS, SiteLayoutsService } from './site-layouts.service';

/* ---------------------------------------------------------------------
 * v10.696 ~ 700 (D321 · docs/804 ~ 808) 꾸밀 페이지 — 메인 · 관 메인 · 소개몰 메인 · 페이지 목록
 *   ADMIN · SUPER  GET /admin/site-layouts · GET · PATCH /admin/site-layouts/{key} · POST …/restore · 미리보기 링크 · GET /admin/site-pages
 *   SUPER          POST /admin/site-layouts/{key}/publish · …/schedule · …/rollback
 *   공개           GET /site-layouts/{key}(게시된 판 · 없으면 layout null) · ?preview=토큰(초안)
 * ------------------------------------------------------------------- */

export class SiteLayoutDto {
  @ApiProperty({ type: 'array', items: { type: 'object' }, description: '구역 [{key, show}] — 적은 순서대로 그림' }) sections!: Array<{ key: string; show: boolean }>;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, description: '글자(비우면 처음 글)' }) texts!: Record<string, string>;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'HOME hero 오른쪽 안내 장' }) slides?: Record<string, unknown>;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'HLT 고른 상품 코드' }) picks?: Record<string, string[]>;
  @ApiProperty({ type: 'object', additionalProperties: true, description: '끼운 블록(자리 → 블록 배열 · 관 페이지 블록)' }) inserts!: Record<string, unknown>;
}
export class SiteLayoutRowDto {
  @ApiProperty({ enum: [...LAYOUT_KEYS] }) key!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '/' }) path!: string;
  @ApiProperty({ enum: ['DEFAULT', 'PUBLISHED'], description: 'DEFAULT = 게시한 판 없음(코드의 처음 배치)' }) status!: string;
  @ApiProperty({ nullable: true }) publishedVersion!: number | null;
  @ApiProperty({ nullable: true }) publishedAt!: string | null;
  @ApiProperty({ nullable: true }) publishedByName!: string | null;
  @ApiProperty({ nullable: true }) draftUpdatedAt!: string | null;
  @ApiProperty({ nullable: true }) draftUpdatedByName!: string | null;
  @ApiProperty() draftChanged!: boolean;
  @ApiProperty({ nullable: true }) scheduledAt!: string | null;
  @ApiProperty({ nullable: true }) scheduledByName!: string | null;
  @ApiProperty({ description: 'v10.701 (D322) 수정 가능(SUPER 가 정함 · 처음 false)' }) editable!: boolean;
  @ApiProperty({ nullable: true }) editableAt!: string | null;
  @ApiProperty({ nullable: true }) editableByName!: string | null;
  @ApiProperty({ nullable: true, description: '관 메인이면 그 관 코드(메인 HOME 은 null)' }) gwanCode!: string | null;
  @ApiProperty({ description: '그 관이 열려 있음 — 열려 있으면 고칠 수 없음' }) gwanOpen!: boolean;
  @ApiProperty({ description: 'v10.722 최근 7일 방문' }) views7!: number;
}
export class SiteLayoutDetailDto {
  @ApiProperty() key!: string;
  @ApiProperty({ type: 'object', additionalProperties: true, description: '고칠 수 있는 것(구역 · 글자 · 안내 장 · 고른 상품 · 블록 자리)' }) spec!: Record<string, unknown>;
  @ApiProperty({ type: SiteLayoutDto }) draft!: SiteLayoutDto;
  @ApiProperty({ type: SiteLayoutDto, nullable: true }) published!: SiteLayoutDto | null;
  @ApiProperty({ nullable: true }) publishedVersion!: number | null;
  @ApiProperty({ nullable: true }) publishedAt!: string | null;
  @ApiProperty({ nullable: true }) publishedByName!: string | null;
  @ApiProperty({ nullable: true }) draftUpdatedAt!: string | null;
  @ApiProperty({ nullable: true }) draftUpdatedByName!: string | null;
  @ApiProperty() draftChanged!: boolean;
  @ApiProperty({ nullable: true }) scheduledAt!: string | null;
  @ApiProperty({ nullable: true }) scheduledByName!: string | null;
  @ApiProperty({ type: 'array', items: { type: 'object' } }) versions!: unknown[];
  @ApiProperty({ type: 'array', items: { type: 'object' } }) previews!: unknown[];
  @ApiProperty({ description: 'v10.701 (D322) 수정 가능' }) editable!: boolean;
  @ApiProperty({ nullable: true }) gwanCode!: string | null;
  @ApiProperty() gwanOpen!: boolean;
  @ApiProperty({ nullable: true, enum: ['SITE_LAYOUT_LOCKED', 'SITE_LAYOUT_GWAN_OPEN'], description: '지금 고칠 수 없는 까닭(null = 고칠 수 있음)' }) lockReason!: string | null;
  @ApiProperty({ nullable: true }) editableAt!: string | null;
  @ApiProperty({ nullable: true }) editableByName!: string | null;
}
export class SiteLayoutDraftLogDto {
  @ApiProperty() at!: string;
  @ApiProperty({ nullable: true }) byName!: string | null;
  @ApiProperty({ type: [String], description: '바뀐 곳(구역 순서 · 글자 이름 · 블록 자리 · 언어 글자 …)' }) changes!: string[];
}
export class SiteLayoutTranslateDto {
  @ApiProperty({ example: 'en', description: '사이트 언어(ko 빼고)' }) @IsString() @Matches(/^[a-z]{2}$/) lang!: string;
}
export class SiteLayoutBatchDto {
  @ApiProperty({ type: [String], example: ['HOME', 'EARN'] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @IsString({ each: true }) keys!: string[];
  @ApiProperty({ example: '2026-12-01T00:00:00Z' }) @IsDateString({}, { message: '예약 시각 모양이 맞지 않습니다.' }) at!: string;
}
export class SiteLayoutBatchResultDto {
  @ApiProperty() at!: string;
  @ApiProperty() scheduled!: number;
  @ApiProperty({ type: 'array', items: { type: 'object' } }) items!: unknown[];
}
export class SiteLayoutVersionDto {
  @ApiProperty() key!: string;
  @ApiProperty() version!: number;
  @ApiProperty() how!: string;
  @ApiProperty() publishedAt!: string;
  @ApiProperty({ type: SiteLayoutDto }) layout!: SiteLayoutDto;
}
export class SiteLayoutCopyDto {
  @ApiProperty({ example: 'MAL', description: '가져올 꾸밀 페이지' }) @IsString() @Matches(/^[A-Za-z]{3,4}$/) from!: string;
}
export class SiteLayoutViewDto {
  @ApiProperty() counted!: boolean;
}
export class SiteLayoutEditableDto {
  @ApiProperty({ example: true, description: 'true = 수정 가능 · false = 수정 불가' }) @StrictBoolean() editable!: boolean;
}
export class SiteLayoutPublicDto {
  @ApiProperty() key!: string;
  @ApiProperty({ description: '게시 판(0 = 없음 · 미리보기)' }) version!: number;
  @ApiProperty() preview!: boolean;
  @ApiProperty({ type: SiteLayoutDto, nullable: true, description: 'null = 게시한 판 없음(처음 배치)' }) layout!: SiteLayoutDto | null;
}
export class SitePagesDto {
  @ApiProperty({ type: [SiteLayoutRowDto] }) layouts!: SiteLayoutRowDto[];
  @ApiProperty({ type: 'array', items: { type: 'object' }, description: '관 안 페이지(새 관 첫 화면 포함) · 7일 방문' }) pages!: unknown[];
}
export class SiteLayoutSaveDto {
  @ApiProperty({ type: SiteLayoutDto }) @IsObject() layout!: Record<string, unknown>;
}
export class SiteLayoutScheduleDto {
  @ApiProperty({ nullable: true, example: '2026-12-01T00:00:00Z', description: '게시할 시각(5분 뒤 ~ 90일) · null 이면 예약 취소 · 지금 초안을 떠 둠' })
  @IsOptional() @IsDateString({}, { message: '예약 시각 모양이 맞지 않습니다.' }) at!: string | null;
}
export class SiteLayoutRestoreDto {
  @ApiProperty({ example: 1, description: '0 = 처음 배치로' }) @IsInt() @Min(0) version!: number;
}
export class SiteLayoutRollbackDto {
  @ApiProperty({ example: 2 }) @IsInt() @Min(1) version!: number;
  @ApiProperty({ example: '잘못 올린 그림' }) @IsString() @MinLength(2) @MaxLength(300) reason!: string;
}
export class SiteLayoutPreviewCreateDto {
  @ApiPropertyOptional({ example: 24, description: '살아 있는 시간(1 ~ 72 · 처음 24)' }) @IsOptional() @IsInt() @Min(1) @Max(72) hours?: number;
}
export class SiteLayoutPreviewDto {
  @ApiProperty() token!: string;
  @ApiProperty() expiresAt!: string;
}
export class SiteLayoutRevokedDto {
  @ApiProperty() revoked!: boolean;
}

@ApiTags('ADM')
@Controller('api/v1')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class SiteLayoutsController {
  constructor(private readonly svc: SiteLayoutsService) {}

  @Get('admin/site-layouts')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '꾸밀 페이지 목록 (v10.696)', description: '메인 · 관 메인 5 · 소개몰 메인 — 상태 · 게시 판 · 초안 고침 · 예약.' })
  @ApiOkResponse({ type: SiteLayoutRowDto, isArray: true })
  list() { return this.svc.list(); }

  @Get('admin/site-pages')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '페이지 목록 (v10.700)', description: '꾸밀 페이지 6과 관 안 페이지(새 관 첫 화면 포함)를 한 번에 · 7일 방문.' })
  @ApiOkResponse({ type: SitePagesDto })
  sitePages() { return this.svc.sitePages(); }

  @Post('admin/site-layouts/schedule-batch')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '여러 페이지 한꺼번에 예약 게시 (v10.716 · SUPER)', description: '페이지마다 같은 규칙(수정 가능 · 관 닫힘 · 초안 떠 둠) · 결과를 줄마다.' })
  @ApiOkResponse({ type: SiteLayoutBatchResultDto })
  @Audit('SITE_LAYOUT_SCHEDULE_BATCH', 'SITE')
  scheduleBatch(@Body() dto: SiteLayoutBatchDto) { return this.svc.scheduleBatch(dto.keys, dto.at); }

  @Get('admin/site-layouts/:key/versions/:version')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '꾸밀 페이지 게시 판 하나 (v10.717)', description: '판 비교용.' })
  @ApiParam({ name: 'key' }) @ApiParam({ name: 'version' })
  @ApiOkResponse({ type: SiteLayoutVersionDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  version(@Param('key') key: string, @Param('version', ParseIntPipe) version: number) { return this.svc.version(key, version); }

  @Post('admin/site-layouts/:key/copy-from')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '다른 꾸밀 페이지에서 배치 복사 (v10.733)', description: '같은 열쇠의 구역 · 글자 · 위 · 아래 블록만 초안으로 · 수정 가능 · 관 닫힘이어야.' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: SiteLayoutDetailDto })
  @ApiResponse({ status: 422, description: 'SITE_LAYOUT_COPY · SITE_LAYOUT_LOCKED · SITE_LAYOUT_GWAN_OPEN', type: ErrorDto })
  copyFrom(@Param('key') key: string, @Body() dto: SiteLayoutCopyDto) { return this.svc.copyFrom(key, dto.from); }

  @Get('admin/site-layouts/:key')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '꾸밀 페이지 하나 (v10.696)', description: '고칠 수 있는 것 · 초안 · 게시된 판 · 판 기록 · 미리보기 링크.' })
  @ApiParam({ name: 'key', enum: [...LAYOUT_KEYS] })
  @ApiOkResponse({ type: SiteLayoutDetailDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  get(@Param('key') key: string) { return this.svc.get(key); }

  @Patch('admin/site-layouts/:key')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '꾸밀 페이지 초안 저장 (v10.696)', description: '사용자 웹은 게시 전까지 그대로. 규칙에 안 맞으면 422 SITE_LAYOUT_INVALID · GWAN_PAGE_BLOCK.' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: SiteLayoutDetailDto })
  @ApiResponse({ status: 422, description: 'SITE_LAYOUT_INVALID · GWAN_PAGE_BLOCK · SITE_LAYOUT_LOCKED · SITE_LAYOUT_GWAN_OPEN', type: ErrorDto })
  @Audit('SITE_LAYOUT_DRAFT', 'SITE')
  save(@Param('key') key: string, @Body() dto: SiteLayoutSaveDto) { return this.svc.saveDraft(key, dto.layout); }

  @Post('admin/site-layouts/:key/publish')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '꾸밀 페이지 게시 (v10.696 · SUPER)', description: '저장된 초안을 새 판으로 쌓고 사용자 웹에 보임. 처음 배치 그대로면 422 SITE_LAYOUT_EMPTY.' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: SiteLayoutDetailDto })
  @ApiResponse({ status: 422, description: 'SITE_LAYOUT_EMPTY · SITE_LAYOUT_LOCKED · SITE_LAYOUT_GWAN_OPEN', type: ErrorDto })
  @Audit('SITE_LAYOUT_PUBLISH', 'SITE')
  publish(@Param('key') key: string) { return this.svc.publish(key); }

  @Post('admin/site-layouts/:key/schedule')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '꾸밀 페이지 예약 게시 (v10.696 · SUPER)', description: '지금 초안을 떠 두고 그 시각에 게시 · at null 이면 취소.' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: SiteLayoutDetailDto })
  @ApiResponse({ status: 422, description: 'SITE_LAYOUT_SCHEDULE', type: ErrorDto })
  @Audit('SITE_LAYOUT_SCHEDULE', 'SITE')
  schedule(@Param('key') key: string, @Body() dto: SiteLayoutScheduleDto) { return this.svc.schedule(key, dto.at ?? null); }

  @Post('admin/site-layouts/:key/editable')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '수정 가능 스위치 (v10.701 · SUPER)', description: '수정 불가면 초안 · 게시 · 예약 · 되돌리기 422 SITE_LAYOUT_LOCKED · 관 메인은 관이 열려 있으면 422 SITE_LAYOUT_GWAN_OPEN.' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: SiteLayoutDetailDto })
  @Audit('SITE_LAYOUT_EDITABLE', 'SITE')
  setEditable(@Param('key') key: string, @Body() dto: SiteLayoutEditableDto) { return this.svc.setEditable(key, dto.editable); }

  @Get('admin/site-layouts/:key/draft-log')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '꾸밀 페이지 초안 고친 기록 (v10.709)', description: '최근 50줄 — 누가 · 언제 · 바뀐 곳.' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: SiteLayoutDraftLogDto, isArray: true })
  draftLog(@Param('key') key: string) { return this.svc.draftLog(key); }

  @Post('admin/site-layouts/:key/translate')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '언어별 글자 번역 초안 (v10.708)', description: '한국어 글을 AI 로 그 언어에 옮겨 초안에 씀(게시는 SUPER) · AI 스위치 · 월 상한 · 수정 가능 · 관 닫힘이어야.' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: SiteLayoutDetailDto })
  @ApiResponse({ status: 422, description: 'SITE_LAYOUT_TRANSLATE · AGENT_OFF · MODEL_UNPRICED · SITE_LAYOUT_LOCKED · SITE_LAYOUT_GWAN_OPEN', type: ErrorDto })
  translate(@Param('key') key: string, @Body() dto: SiteLayoutTranslateDto) { return this.svc.translate(key, dto.lang); }

  @Post('admin/site-layouts/:key/restore')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '예전 판으로 초안 (v10.696)', description: '게시는 따로. version 0 = 처음 배치로.' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: SiteLayoutDetailDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  restore(@Param('key') key: string, @Body() dto: SiteLayoutRestoreDto) { return this.svc.restore(key, dto.version); }

  @Post('admin/site-layouts/:key/rollback')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '바로 되돌리기 (v10.696 · SUPER)', description: '예전 판을 새 판으로 다시 게시 · 초안은 그대로 · 사유.' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: SiteLayoutDetailDto })
  @ApiResponse({ status: 422, description: 'SITE_LAYOUT_ROLLBACK_SAME · SITE_LAYOUT_ROLLBACK_REASON', type: ErrorDto })
  @Audit('SITE_LAYOUT_ROLLBACK', 'SITE')
  rollback(@Param('key') key: string, @Body() dto: SiteLayoutRollbackDto) { return this.svc.rollback(key, dto.version, dto.reason); }

  @Post('admin/site-layouts/:key/previews')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '미리보기 링크 만들기 (v10.696)', description: '로그인 없이 초안을 봄 · 1 ~ 72시간 · 페이지마다 5개까지(422 SITE_LAYOUT_PREVIEW_MAX).' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: SiteLayoutPreviewDto })
  @ApiResponse({ status: 422, description: 'SITE_LAYOUT_PREVIEW_MAX', type: ErrorDto })
  createPreview(@Param('key') key: string, @Body() dto: SiteLayoutPreviewCreateDto) { return this.svc.createPreview(key, dto.hours ?? 24); }

  @Delete('admin/site-layouts/:key/previews/:token')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '미리보기 링크 끊기 (v10.696)' })
  @ApiParam({ name: 'key' }) @ApiParam({ name: 'token' })
  @ApiOkResponse({ type: SiteLayoutRevokedDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  revokePreview(@Param('key') key: string, @Param('token') token: string) { return this.svc.revokePreview(key, token); }

  @Post('site-layouts/:key/view')
  @HttpCode(200)
  @ApiOperation({ summary: '꾸밀 페이지 방문 (v10.722 · 공개)', description: '같은 기기 같은 날 한 번만 셈 · 개인 정보 없음.' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: SiteLayoutViewDto })
  view(@Param('key') key: string, @Ip() ip: string, @Headers('user-agent') ua?: string) { return this.svc.recordView(key, ip ?? '', ua ?? ''); }

  @Get('site-layouts/:key')
  @ApiOperation({ summary: '꾸밀 페이지 (v10.696 · 공개)', description: '게시된 판(없으면 layout null = 처음 배치) · preview 토큰이 살아 있으면 초안.' })
  @ApiParam({ name: 'key', enum: [...LAYOUT_KEYS] })
  @ApiQuery({ name: 'preview', required: false })
  @ApiOkResponse({ type: SiteLayoutPublicDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  publicLayout(@Param('key') key: string, @Query('preview') preview?: string) { return this.svc.publicLayout(key, preview); }
}
