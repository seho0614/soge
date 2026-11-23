import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
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
 * ------------------------------------------------------------------- */

export class GwanPageRowDto {
  @ApiProperty() id!: number;
  @ApiProperty({ example: 'EDU' }) gwanCode!: string;
  @ApiProperty({ example: 'guide', description: 'home = 새 관 첫 화면' }) slug!: string;
  @ApiProperty() title!: string;
  @ApiProperty() showInMenu!: boolean;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED', 'HIDDEN'] }) status!: string;
  @ApiProperty({ nullable: true }) publishedVersion!: number | null;
  @ApiProperty({ nullable: true }) publishedAt!: string | null;
  @ApiProperty() draftUpdatedAt!: string;
  @ApiProperty({ nullable: true }) draftUpdatedByName!: string | null;
  @ApiProperty({ description: '초안이 게시된 판과 다름' }) draftChanged!: boolean;
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
  @ApiProperty() title!: string;
  @ApiProperty({ type: 'array', items: { type: 'object' } }) blocks!: Array<Record<string, unknown>>;
  @ApiProperty() version!: number;
  @ApiProperty() publishedAt!: string;
}

export class GwanPageCreateDto {
  @ApiProperty({ example: 'guide', description: 'home(새 관 첫 화면) 또는 영문 소문자 · 숫자 · - 2 ~ 40자 · 만든 뒤 바꾸지 않음' })
  @Matches(/^(home|[a-z0-9][a-z0-9-]{1,39})$/, { message: '페이지 주소는 home 또는 영문 소문자 · 숫자 · - 2 ~ 40자입니다.' }) slug!: string;
  @ApiProperty({ example: '이용 안내' }) @IsString() @MinLength(1) @MaxLength(60) title!: string;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() showInMenu?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
}
export class GwanPageUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(60) title?: string;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() showInMenu?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @ApiPropertyOptional({ type: 'array', items: { type: 'object' }, description: `블록(30개까지 · ${PAGE_BLOCKS.join(' · ')}) — 칸 검사는 서버(422 GWAN_PAGE_BLOCK)` })
  @IsOptional() @IsArray() blocks?: unknown[];
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
  @ApiResponse({ status: 422, description: 'GWAN_PAGE_HOME · GWAN_PAGE_HUB', type: ErrorDto })
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

  /* ── 공개 ── */
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
  publicPage(@Param('code') code: string, @Param('slug') slug: string) { return this.svc.publicPage(code, slug); }
}
