import { Body, Controller, Delete, Get, Headers, HttpCode, Ip, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { StrictBoolean } from '../../common/strict-boolean';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { GwanPagesService, PAGE_BLOCKS } from './gwan-pages.service';

/* ---------------------------------------------------------------------
 * v10.650 (D311 · docs/793) 관 페이지 — 운영 화면(관 관리 › 관 설정 › 「페이지」) · 사용자 웹(/g/<관>/info/<주소> · 새 관 첫 화면)
 *   ADMIN · SUPER  GET  /admin/gwans/{code}/pages · POST /admin/gwans/{code}/pages · GET · PATCH /admin/gwan-pages/{id} · POST …/restore
 *   SUPER          POST /admin/gwan-pages/{id}/publish · POST /admin/gwan-pages/{id}/hide
 *   공개           GET  /gwans/{code}/pages · GET /gwans/{code}/pages/{slug}(게시된 판만)
 *   v10.661 ~ 667 (D315 · docs/795) 예약 게시(SUPER) · 번역 초안(ADMIN) · 미리보기 링크(ADMIN) · 방문 수 — 공개 GET /gwan-pages/preview/{token} · POST /gwans/{code}/pages/{slug}/view
 * ------------------------------------------------------------------- */

export class GwanPageRowDto {
  @ApiProperty() id!: number;
  @ApiProperty({ example: 'EDU' }) gwanCode!: string;
  @ApiProperty({ example: 'guide', description: 'home = 새 관 첫 화면' }) slug!: string;
  @ApiProperty({ example: 'ko', description: 'v10.657 언어 — ko 한국어판 · 그 밖은 언어판' }) lang!: string;
  @ApiProperty() title!: string;
  @ApiProperty() showInMenu!: boolean;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED', 'HIDDEN'] }) status!: string;
  @ApiProperty({ nullable: true }) publishedVersion!: number | null;
  @ApiProperty({ nullable: true }) publishedAt!: string | null;
  @ApiProperty() draftUpdatedAt!: string;
  @ApiProperty({ nullable: true }) draftUpdatedByName!: string | null;
  @ApiProperty({ description: '초안이 게시된 판과 다름' }) draftChanged!: boolean;
  @ApiProperty({ nullable: true, description: 'v10.661 예약 게시 시각' }) scheduledAt!: string | null;
  @ApiProperty({ nullable: true }) scheduledByName!: string | null;
  @ApiProperty({ description: 'v10.667 최근 7일 방문 수' }) views7!: number;
  @ApiProperty({ enum: ['ALL', 'MEMBER'], description: 'v10.691 공개 범위' }) visibility!: string;
  @ApiProperty({ nullable: true }) seoDescription!: string | null;
  @ApiProperty({ nullable: true }) seoImage!: string | null;
  @ApiProperty({ description: 'v10.692 검색엔진에 안 나오게' }) noindex!: boolean;
  @ApiProperty({ description: 'v10.701 (D322) 수정 가능(SUPER 가 정함 · 처음 true)' }) editable!: boolean;
  @ApiProperty({ description: 'v10.705 그 관이 열려 있음 — 열려 있으면 고칠 수 없음(422 GWAN_PAGE_GWAN_OPEN)' }) gwanOpen!: boolean;
}
export class GwanPageOrderDto {
  @ApiProperty({ type: [Number], description: '한국어판 페이지 번호 차례(첫 화면 빼고)' }) @IsArray() @ArrayMaxSize(100) @IsInt({ each: true }) ids!: number[];
}
export class GwanPageEditableDto {
  @ApiProperty({ example: false, description: 'true = 수정 가능 · false = 수정 불가' }) @StrictBoolean() editable!: boolean;
}
export class GwanPagePreviewRowDto {
  @ApiProperty({ description: '링크 열쇠(40자) — 사용자 웹 /preview/page/{token}' }) token!: string;
  @ApiProperty() expiresAt!: string;
  @ApiPropertyOptional() createdAt?: string;
  @ApiPropertyOptional({ nullable: true }) createdByName?: string | null;
}
export class GwanPageVersionDto {
  @ApiProperty() version!: number;
  @ApiProperty() title!: string;
  @ApiProperty() publishedAt!: string;
  @ApiProperty({ nullable: true }) publishedByName!: string | null;
}
export class GwanPageDetailDto extends GwanPageRowDto {
  @ApiProperty({ type: 'array', items: { type: 'object' }, description: `초안 블록(${PAGE_BLOCKS.join(' · ')})` }) blocks!: Array<Record<string, unknown>>;
  @ApiProperty({ type: GwanPageVersionDto, isArray: true }) versions!: GwanPageVersionDto[];
  @ApiProperty({ type: GwanPagePreviewRowDto, isArray: true, description: 'v10.666 열린 미리보기 링크' }) previews!: GwanPagePreviewRowDto[];
}
export class GwanFragmentRowDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty({ description: '블록 수' }) blocks!: number;
  @ApiProperty() updatedAt!: string;
  @ApiProperty({ nullable: true }) updatedByName!: string | null;
  @ApiProperty({ description: '초안에 이 조각을 둔 페이지 수' }) usedBy!: number;
}
export class GwanFragmentDetailDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty({ type: 'array', items: { type: 'object' } }) blocks!: Array<Record<string, unknown>>;
  @ApiProperty() updatedAt!: string;
  @ApiProperty({ type: 'array', items: { type: 'object' }, description: '쓰는 페이지(관 · 주소 · 언어 · 상태 · 게시 판에도 들어갔는지)' }) usedBy!: Array<Record<string, unknown>>;
}
export class GwanFragmentSaveDto {
  @ApiPropertyOptional({ example: '문의 단추' }) @IsOptional() @IsString() @MinLength(1) @MaxLength(40) name?: string;
  @ApiPropertyOptional({ type: 'array', items: { type: 'object' }, description: '블록 1 ~ 10(조각 안에 조각은 안 됨)' }) @IsOptional() @IsArray() blocks?: unknown[];
}
export class GwanPageRollbackDto {
  @ApiProperty({ example: 3 }) @IsInt() @Min(1) version!: number;
  @ApiProperty({ example: '잘못 올린 사진' }) @IsString() @MinLength(2) @MaxLength(300) reason!: string;
}
export class GwanFragmentRepublishDto {
  @ApiPropertyOptional({ type: [Number], description: '다시 게시할 페이지(비우면 쓰는 페이지 모두 · 초안에 다른 고침이 있는 페이지는 건너뜀)' })
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsInt({ each: true }) pageIds?: number[];
}
export class GwanPageSearchDto {
  @ApiProperty({ example: 'EDU' }) gwanCode!: string;
  @ApiProperty() gwanName!: string;
  @ApiProperty({ description: 'home = 새 관 첫 화면' }) slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ description: '찾은 글 앞뒤 110자' }) snippet!: string;
}
export class GwanPageScheduleDto {
  @ApiProperty({ nullable: true, example: '2026-12-01T00:00:00Z', description: '게시할 시각(5분 뒤 ~ 90일) · null 이면 예약 취소 · 지금 초안을 떠 둠' })
  @IsOptional() @IsDateString({}, { message: '예약 시각 모양이 맞지 않습니다.' }) at!: string | null;
}
export class GwanPagePreviewCreateDto {
  @ApiPropertyOptional({ example: 24, description: '살아 있는 시간(1 ~ 72 · 처음 24)' }) @IsOptional() @IsInt() @Min(1) @Max(72) hours?: number;
}
export class GwanPageViewsDto {
  @ApiProperty() days!: number;
  @ApiProperty() total!: number;
  @ApiProperty({ type: 'array', items: { type: 'object', properties: { day: { type: 'string' }, views: { type: 'number' } } } }) rows!: Array<{ day: string; views: number }>;
}
export class GwanPageVersionDetailDto extends GwanPageVersionDto {
  @ApiProperty({ type: 'array', items: { type: 'object' } }) blocks!: Array<Record<string, unknown>>;
}
export class GwanPageMenuDto {
  @ApiProperty() slug!: string;
  @ApiProperty() title!: string;
}
export class GwanPagePublicDto {
  @ApiProperty() slug!: string;
  @ApiProperty({ example: 'ko', description: 'v10.657 보이는 판의 언어(화면 언어 판이 없으면 ko)' }) lang!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: 'array', items: { type: 'object' } }) blocks!: Array<Record<string, unknown>>;
  @ApiProperty() version!: number;
  @ApiProperty() publishedAt!: string;
}
export class GwanPagePreviewPublicDto extends GwanPagePublicDto {
  @ApiProperty() gwanCode!: string;
  @ApiProperty() expiresAt!: string;
  @ApiProperty({ example: true }) preview!: boolean;
}

export class GwanPageCreateDto {
  @ApiProperty({ example: 'guide', description: 'home(새 관 첫 화면) 또는 영문 소문자 · 숫자 · - 2 ~ 40자 · 만든 뒤 바꾸지 않음' })
  @Matches(/^(home|[a-z0-9][a-z0-9-]{1,39})$/, { message: '페이지 주소는 home 또는 영문 소문자 · 숫자 · - 2 ~ 40자입니다.' }) slug!: string;
  @ApiProperty({ example: '이용 안내' }) @IsString() @MinLength(1) @MaxLength(60) title!: string;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() showInMenu?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @ApiPropertyOptional({ example: 'en', description: 'v10.657 (D313) 언어판 — 비우면 ko · 그 밖은 한국어판이 먼저 있어야 하고 그 초안을 복사해 시작' })
  @IsOptional() @Matches(/^[a-z]{2}$/, { message: '언어 코드는 영문 소문자 2자입니다.' }) lang?: string;
}
export class GwanPageUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(60) title?: string;
  /* v10.691 · 692 (D320) 공개 범위 · 검색엔진 설정(바로 반영) */
  @ApiPropertyOptional({ enum: ['ALL', 'MEMBER'], description: '누구나 · 로그인한 회원만(첫 화면은 ALL 만)' }) @IsOptional() @IsIn(['ALL', 'MEMBER']) visibility?: string;
  @ApiPropertyOptional({ maxLength: 160, description: '검색엔진 · 공유 설명(비우면 블록에서 자동)' }) @IsOptional() @IsString() @MaxLength(160) seoDescription?: string;
  @ApiPropertyOptional({ description: '검색엔진 · 공유 그림 주소(/… 또는 https · 비우면 블록에서 자동)' }) @IsOptional() @IsString() @MaxLength(300) seoImage?: string;
  @ApiPropertyOptional({ description: '검색엔진에 안 나오게' }) @IsOptional() @StrictBoolean() noindex?: boolean;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() showInMenu?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @ApiPropertyOptional({ type: 'array', items: { type: 'object' }, description: `블록(30개까지 · ${PAGE_BLOCKS.join(' · ')}) — 칸 검사는 서버(422 GWAN_PAGE_BLOCK)` })
  @IsOptional() @IsArray() blocks?: unknown[];
}
export class GwanPageImageRowDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() size!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ nullable: true }) ownerName!: string | null;
}
export class GwanPageUnusedDto {
  @ApiProperty({ example: 30 }) days!: number;
  @ApiProperty() count!: number;
  @ApiProperty({ description: '바이트 합' }) bytes!: number;
  @ApiProperty({ type: GwanPageImageRowDto, isArray: true }) items!: GwanPageImageRowDto[];
}
export class GwanPagePurgeDto {
  @ApiProperty({ type: [String], description: '지울 그림(파일 번호) — 서버가 다시 「안 쓰는가」를 봄 · 500개까지' })
  @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) ids!: string[];
  @ApiPropertyOptional({ example: 30, description: '올린 지 며칠 지난 것(7 ~ 365)' }) @IsOptional() @IsInt() @Min(7) @Max(365) days?: number;
}
export class GwanPagePurgeOkDto {
  @ApiProperty() removed!: number;
  @ApiProperty({ description: '지금 쓰이고 있거나 조건이 바뀌어 건너뜀' }) skipped!: number;
}
export class GwanPageHideDto {
  @ApiProperty() @StrictBoolean() hidden!: boolean;
}
export class GwanPageRestoreDto {
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) version!: number;
}

@ApiTags('ADM')
@Controller('api/v1')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class GwanPagesController {
  constructor(private readonly svc: GwanPagesService) {}

  @Get('admin/gwans/:code/pages')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '관 페이지 목록 (v10.650)', description: '첫 화면(home · 새 관만) · 관 안 페이지 — 상태 · 게시된 판 · 초안이 바뀌었는지.' })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: GwanPageRowDto, isArray: true })
  list(@Param('code') code: string) { return this.svc.list(code); }

  @Post('admin/gwans/:code/pages')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '관 페이지 만들기 (v10.650)', description: '초안(빈 블록)으로 만듦. home 은 운영 화면에서 만든 새 관만 · 허브 관은 안 됨(DB 422).' })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: GwanPageDetailDto })
  @ApiResponse({ status: 409, description: 'GWAN_PAGE_EXISTS', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'GWAN_PAGE_HOME · GWAN_PAGE_HUB · GWAN_PAGE_LANG · GWAN_PAGE_LANG_KO(v10.657)', type: ErrorDto })
  @Audit('GWAN_PAGE_CREATE', 'GWAN')
  create(@Param('code') code: string, @Body() dto: GwanPageCreateDto) { return this.svc.create(code, dto); }

  @Get('admin/gwan-pages/:id')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '관 페이지 자세히 (v10.650)', description: '초안 블록 · 게시 판 기록 30개.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: GwanPageDetailDto })
  get(@Param('id', ParseIntPipe) id: number) { return this.svc.get(id); }

  @Patch('admin/gwan-pages/:id')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '관 페이지 초안 고치기 (v10.650)', description: '제목 · 메뉴 · 순서 · 블록. 게시된 화면은 「게시」 전까지 그대로.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: GwanPageDetailDto })
  @ApiResponse({ status: 422, description: 'GWAN_PAGE_BLOCK', type: ErrorDto })
  @Audit('GWAN_PAGE_EDIT', 'GWAN')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: GwanPageUpdateDto) { return this.svc.update(id, dto); }

  @Post('admin/gwans/:code/pages/order')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '관 안 페이지 메뉴 순서 (v10.719)', description: '한국어판 번호를 차례대로 — 관 닫힘 · 수정 가능 · 담당자 규칙.' })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: GwanPageRowDto, isArray: true })
  @ApiResponse({ status: 422, description: 'GWAN_PAGE_GWAN_OPEN · GWAN_PAGE_LOCKED · GWAN_PAGE_MANAGER_ONLY', type: ErrorDto })
  @Audit('GWAN_PAGE_ORDER', 'GWAN')
  reorder(@Param('code') code: string, @Body() dto: GwanPageOrderDto) { return this.svc.reorder(code, dto.ids); }

  @Post('admin/gwan-pages/:id/editable')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '관 페이지 수정 가능 스위치 (v10.701 · SUPER)', description: '수정 불가면 초안 · 게시 · 예약 · 되돌리기 · 번역 초안 422 GWAN_PAGE_LOCKED.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: GwanPageDetailDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @Audit('GWAN_PAGE_EDITABLE', 'GWAN')
  setEditable(@Param('id', ParseIntPipe) id: number, @Body() dto: GwanPageEditableDto) { return this.svc.setEditable(id, dto.editable); }

  @Post('admin/gwan-pages/:id/publish')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '관 페이지 게시 (v10.650 · SUPER)', description: '초안을 새 판으로 쌓고 사용자 웹에 보임. 블록이 없으면 422 GWAN_PAGE_EMPTY.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: GwanPageDetailDto })
  @ApiResponse({ status: 422, description: 'GWAN_PAGE_EMPTY · GWAN_PAGE_BLOCK', type: ErrorDto })
  @Audit('GWAN_PAGE_PUBLISH', 'GWAN')
  publish(@Param('id', ParseIntPipe) id: number) { return this.svc.publish(id); }

  @Post('admin/gwan-pages/:id/hide')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '관 페이지 숨김 · 다시 보임 (v10.650 · SUPER)', description: '숨기면 사용자 웹에서 빠짐(판 기록은 그대로).' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: GwanPageDetailDto })
  @Audit('GWAN_PAGE_HIDE', 'GWAN')
  hide(@Param('id', ParseIntPipe) id: number, @Body() dto: GwanPageHideDto) { return this.svc.hide(id, dto.hidden); }

  @Get('admin/gwan-pages/:id/draft-log')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '관 페이지 초안 고친 기록 (v10.684)', description: '초안 저장마다 한 줄 — 누가 · 언제 · 블록 수 · 바뀐 블록 수 · 제목 바뀜(최근 50).' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object, isArray: true })
  draftLog(@Param('id', ParseIntPipe) id: number) { return this.svc.draftLog(id); }

  @Get('admin/gwan-pages/:id/versions/:version')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '게시된 판 하나 (v10.655)', description: '판 비교 · 게시된 판 내려받기(HTML · 블록 파일)용 — 제목 · 블록.' })
  @ApiParam({ name: 'id' }) @ApiParam({ name: 'version' })
  @ApiOkResponse({ type: GwanPageVersionDetailDto })
  getVersion(@Param('id', ParseIntPipe) id: number, @Param('version', ParseIntPipe) version: number) { return this.svc.version(id, version); }

  @Post('admin/gwan-pages/:id/restore')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '예전 판으로 초안 만들기 (v10.650)', description: '그 판의 제목 · 블록을 초안으로 — 게시는 따로.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: GwanPageDetailDto })
  @Audit('GWAN_PAGE_RESTORE', 'GWAN')
  restore(@Param('id', ParseIntPipe) id: number, @Body() dto: GwanPageRestoreDto) { return this.svc.restore(id, dto.version); }

  @Get('admin/gwan-pages/images/unused')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '안 쓰는 페이지 그림 (v10.659)', description: '올린 지 days(처음 30 · 7 ~ 365)일 지났고 어느 페이지 초안 · 게시 판에도 없는 그림(PAGE_IMAGE) — 500개까지.' })
  @ApiQuery({ name: 'days', required: false })
  @ApiOkResponse({ type: GwanPageUnusedDto })
  unused(@Query('days') days?: string) { return this.svc.unusedImages(Number(days ?? 30) || 30); }

  @Post('admin/gwan-pages/images/purge')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '안 쓰는 페이지 그림 정리 (v10.659 · SUPER)', description: '고른 그림 중 지금도 안 쓰는 것만 지운 표시 · 저장소에서 지움. 쓰이는 그림은 건너뜀.' })
  @ApiOkResponse({ type: GwanPagePurgeOkDto })
  @Audit('GWAN_PAGE_IMAGE_PURGE', 'FILE')
  purge(@Body() dto: GwanPagePurgeDto) { return this.svc.purgeImages(dto.ids, dto.days ?? 30); }

  /* ── v10.661 ~ 667 (D315 · docs/795) ── */
  @Post('admin/gwan-pages/:id/schedule')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '관 페이지 예약 게시 (v10.661 · SUPER)', description: '지금 초안 · 제목을 떠 두고 at 시각에 새 판으로 게시(예약 뒤 초안을 고쳐도 예약 내용은 그대로). at = null 이면 취소.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: GwanPageDetailDto })
  @ApiResponse({ status: 422, description: 'GWAN_PAGE_SCHEDULE · GWAN_PAGE_EMPTY · GWAN_PAGE_BLOCK', type: ErrorDto })
  @Audit('GWAN_PAGE_SCHEDULE', 'GWAN')
  schedule(@Param('id', ParseIntPipe) id: number, @Body() dto: GwanPageScheduleDto) { return this.svc.schedule(id, dto.at ?? null); }

  @Post('admin/gwan-pages/:id/translate')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '관 페이지 번역 초안 채우기 (v10.662)', description: '언어판에서 — 한국어판 초안의 글 칸을 AI 로 옮겨 이 언어판 초안을 덮어씀(게시는 SUPER). AI 통로 TRANSLATE 스위치 · 월 상한을 따름.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: GwanPageDetailDto })
  @ApiResponse({ status: 422, description: 'GWAN_PAGE_TRANSLATE · GWAN_PAGE_LANG_KO · AGENT_OFF · MODEL_UNPRICED · GWAN_PAGE_BLOCK', type: ErrorDto })
  @Audit('GWAN_PAGE_TRANSLATE', 'GWAN')
  translate(@Param('id', ParseIntPipe) id: number) { return this.svc.translate(id); }

  @Post('admin/gwan-pages/:id/previews')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '미리보기 링크 만들기 (v10.666)', description: '로그인 없이 지금 초안을 보는 링크(처음 24시간 · 최대 72) · 페이지마다 열린 링크 5개까지.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: GwanPagePreviewRowDto })
  @ApiResponse({ status: 422, description: 'GWAN_PAGE_PREVIEW_MAX', type: ErrorDto })
  @Audit('GWAN_PAGE_PREVIEW', 'GWAN')
  createPreview(@Param('id', ParseIntPipe) id: number, @Body() dto: GwanPagePreviewCreateDto) { return this.svc.createPreview(id, dto.hours ?? 24); }

  @Delete('admin/gwan-pages/:id/previews/:token')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '미리보기 링크 끊기 (v10.666)' })
  @ApiParam({ name: 'id' }) @ApiParam({ name: 'token' })
  @ApiOkResponse({ type: Object })
  @Audit('GWAN_PAGE_PREVIEW_REVOKE', 'GWAN')
  revokePreview(@Param('id', ParseIntPipe) id: number, @Param('token') token: string) { return this.svc.revokePreview(id, token); }

  @Get('admin/gwan-pages/:id/views')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '관 페이지 방문 수 (v10.667)', description: '날마다(서울 날짜) · days 7 ~ 180(처음 30) · 같은 기기 같은 날은 한 번.' })
  @ApiParam({ name: 'id' }) @ApiQuery({ name: 'days', required: false })
  @ApiOkResponse({ type: GwanPageViewsDto })
  views(@Param('id', ParseIntPipe) id: number, @Query('days') days?: string) { return this.svc.viewStats(id, Number(days ?? 30) || 30); }

  /* ── v10.685 (D319 · docs/800) 내 담당 관 ── */
  @Get('admin/my-gwans')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '내 담당 관 (v10.685)', description: '지금 운영자가 담당(관 설정 › 관 담당자)인 관 — 검수 대기 · 관 페이지에서 온 열린 문의(내가 담당인 것) · 7일 지난 초안.' })
  @ApiOkResponse({ type: Object, isArray: true })
  myGwans() { return this.svc.myGwans(); }

  /* ── v10.674 (D316 · docs/797) 공통 조각 ── */
  @Get('admin/gwan-fragments')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '공통 조각 목록 (v10.674)', description: '이름 · 블록 수 · 쓰는 페이지 수.' })
  @ApiOkResponse({ type: GwanFragmentRowDto, isArray: true })
  fragments() { return this.svc.fragments(); }

  @Post('admin/gwan-fragments')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '공통 조각 만들기 (v10.674)', description: '이름(40자 · 겹치면 409) · 블록 1 ~ 10.' })
  @ApiOkResponse({ type: GwanFragmentDetailDto })
  @ApiResponse({ status: 409, description: 'GWAN_FRAGMENT_EXISTS', type: ErrorDto })
  @Audit('GWAN_FRAGMENT_CREATE', 'GWAN')
  createFragment(@Body() dto: GwanFragmentSaveDto) { return this.svc.createFragment({ name: dto.name ?? '', blocks: dto.blocks }); }

  @Get('admin/gwan-fragments/:id')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '공통 조각 자세히 (v10.674)', description: '블록 · 쓰는 페이지 목록.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: GwanFragmentDetailDto })
  fragment(@Param('id', ParseIntPipe) id: number) { return this.svc.fragment(id); }

  @Patch('admin/gwan-fragments/:id')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '공통 조각 고치기 (v10.674)', description: '고쳐도 게시된 페이지는 다시 게시하기 전까지 그대로(쓰는 페이지 목록에서 다시 게시).' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: GwanFragmentDetailDto })
  @ApiResponse({ status: 422, description: 'GWAN_PAGE_BLOCK', type: ErrorDto })
  @Audit('GWAN_FRAGMENT_EDIT', 'GWAN')
  updateFragment(@Param('id', ParseIntPipe) id: number, @Body() dto: GwanFragmentSaveDto) { return this.svc.updateFragment(id, dto); }

  @Delete('admin/gwan-fragments/:id')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '공통 조각 지우기 (v10.674)', description: '쓰는 페이지가 있으면 422 GWAN_FRAGMENT_IN_USE.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, description: 'GWAN_FRAGMENT_IN_USE', type: ErrorDto })
  @Audit('GWAN_FRAGMENT_DELETE', 'GWAN')
  deleteFragment(@Param('id', ParseIntPipe) id: number) { return this.svc.deleteFragment(id); }

  /* ── v10.675 · 679 (D317 · docs/798) ── */
  @Post('admin/gwan-fragments/:id/republish')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '조각 쓰는 페이지 한꺼번에 다시 게시 (v10.675 · SUPER)', description: '게시된 판이 있고 초안에 다른 고침이 없는 페이지만 새 판으로(조각 새 내용). 다른 고침이 있으면 DRAFT_CHANGED 로 건너뜀.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @Audit('GWAN_FRAGMENT_REPUBLISH', 'GWAN')
  republish(@Param('id', ParseIntPipe) id: number, @Body() dto: GwanFragmentRepublishDto) { return this.svc.republishFragment(id, dto.pageIds); }

  @Post('admin/gwan-pages/:id/rollback')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '관 페이지 판 바로 되돌리기 (v10.679 · SUPER)', description: '예전 판의 블록 그대로 새 판으로 게시(사유 2자 이상 · 운영 알림). 초안은 그대로.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: GwanPageDetailDto })
  @ApiResponse({ status: 422, description: 'GWAN_PAGE_ROLLBACK_REASON · GWAN_PAGE_ROLLBACK_SAME', type: ErrorDto })
  @Audit('GWAN_PAGE_ROLLBACK', 'GWAN')
  rollback(@Param('id', ParseIntPipe) id: number, @Body() dto: GwanPageRollbackDto) { return this.svc.rollback(id, dto.version, dto.reason); }

  /* ── 공개 ── */
  @Get('gwan-pages/search')
  @ApiOperation({ summary: '관 페이지 찾기 (v10.669 · 공개)', description: '사이트 검색 — 게시된 관 안 페이지 · 새 관 첫 화면의 제목 · 글에 든 것 5개(2 ~ 50자 · 켠 관 · 화면 언어 판 먼저).' })
  @ApiQuery({ name: 'q', required: true })
  @ApiOkResponse({ type: GwanPageSearchDto, isArray: true })
  searchPages(@Query('q') q?: string) { return this.svc.searchPages(q ?? ''); }

  @Get('gwan-pages/preview/:token')
  @ApiOperation({ summary: '관 페이지 미리보기 (v10.666 · 공개)', description: '살아 있는 미리보기 링크면 지금 초안. 끝났거나 끊긴 링크는 404.' })
  @ApiParam({ name: 'token' })
  @ApiOkResponse({ type: GwanPagePreviewPublicDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  preview(@Param('token') token: string) { return this.svc.previewPage(token); }

  @Post('gwans/:code/pages/:slug/view')
  @HttpCode(200)
  @ApiOperation({ summary: '관 페이지 방문 한 번 (v10.667 · 공개)', description: '게시된 페이지만 · 같은 기기 같은 날 한 번 · 로봇 · DNT 는 세지 않음 · 계정 · IP 는 저장하지 않음.' })
  @ApiParam({ name: 'code' }) @ApiParam({ name: 'slug' })
  @ApiOkResponse({ type: Object })
  view(@Param('code') code: string, @Param('slug') slug: string, @Headers('user-agent') ua?: string, @Headers('dnt') dnt?: string,
       @Headers('x-forwarded-for') xff?: string, @Ip() ip?: string) {
    if (dnt === '1' || /bot|crawl|spider|slurp|preview|headless/i.test(ua ?? '')) return { counted: false };
    if (!/^[A-Z]{3,4}$/.test(code) || !/^(home|[a-z0-9][a-z0-9-]{1,39})$/.test(slug)) return { counted: false };
    return this.svc.recordView(code, slug, (xff?.split(',')[0]?.trim() || ip) ?? '', ua ?? '');
  }

  @Get('site/page-images/:id')
  @ApiOperation({ summary: '관 페이지 그림 (v10.653 · 공개)', description: '운영 화면 「관 페이지」에서 올린 그림(PAGE_IMAGE · JPG · PNG). 없으면 404.' })
  @ApiParam({ name: 'id', description: '파일 번호(uuid)' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiOkResponse({ description: '그림 바이트', content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/png': { schema: { type: 'string', format: 'binary' } } } })
  async pageImage(@Param('id') id: string, @Res() res: Response) {
    const { stream, contentType, size } = await this.svc.pageImage(id);
    res.status(200);
    res.setHeader('Content-Type', contentType); res.setHeader('Content-Length', String(size));
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  @Get('gwans/:code/pages')
  @ApiOperation({ summary: '관 페이지 메뉴 (v10.650 · 공개)', description: '게시되고 메뉴에 보이는 관 안 페이지(첫 화면 home 빼고).' })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: GwanPageMenuDto, isArray: true })
  publicMenu(@Param('code') code: string) { return this.svc.publicMenu(code); }

  @Get('gwans/:code/pages/:slug')
  @ApiOperation({ summary: '관 페이지 (v10.650 · 공개)', description: '게시된 판의 제목 · 블록. 없거나 숨긴 페이지 · 꺼진 관은 404.' })
  @ApiParam({ name: 'code' }) @ApiParam({ name: 'slug' })
  @ApiOkResponse({ type: GwanPagePublicDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiResponse({ status: 403, description: 'GWAN_PAGE_LOGIN — 회원만 페이지(v10.691)', type: ErrorDto })
  publicPage(@Param('code') code: string, @Param('slug') slug: string) { return this.svc.publicPage(code, slug); }
}
