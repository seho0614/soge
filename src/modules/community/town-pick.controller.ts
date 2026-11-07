import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { TownPickService } from './town-pick.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/* ---------------------------------------------------------------------
 * v10.211 (D188 · docs/336) — 동네픽 AI 큐레이션(꺼진 채)
 *
 *   공개           GET  /community/town-picks?region=          승인된 동네픽(내 시 · 구 먼저 · 없으면 전국 최근 6개)
 *   ADMIN · SUPER  GET  /admin/community/town-picks?state=     후보 · 승인 · 거절 목록 · AI 통로 상태
 *   ADMIN · SUPER  POST /admin/community/town-picks/:id/approve   승인(제목 · 소개 고쳐서 가능 · 감사)
 *   ADMIN · SUPER  POST /admin/community/town-picks/:id/reject    거절(사유 · 감사)
 *   SUPER          POST /admin/community/town-picks/run           지금 한 번 고르기(스위치 · 월 상한 그대로)
 * ------------------------------------------------------------------- */

export class TownPickPublicItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid', description: '원글 — /community/{postId}' }) postId!: string;
  @ApiProperty({ enum: ['PLAZA', 'FOOD'] }) source!: string;
  @ApiProperty({ example: '서울특별시 강남구' }) region!: string;
  @ApiProperty() headline!: string;
  @ApiProperty() summary!: string;
  @ApiProperty({ format: 'date-time' }) decidedAt!: string;
}
export class TownPicksPublicDto {
  @ApiPropertyOptional({ nullable: true, description: '보낸 지역의 동네픽이 있으면 그 지역 · 없으면 null(전국 최근)' }) region!: string | null;
  @ApiProperty({ type: [TownPickPublicItemDto] }) items!: TownPickPublicItemDto[];
}
export class TownPickRowDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) postId!: string;
  @ApiProperty({ enum: ['PLAZA', 'FOOD'] }) source!: string;
  @ApiProperty() region!: string;
  @ApiProperty() headline!: string;
  @ApiProperty() summary!: string;
  @ApiProperty({ enum: ['CLAUDE', 'MOCK', 'N8N'] }) engine!: string;
  @ApiPropertyOptional({ nullable: true }) model!: string | null;
  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED'] }) state!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) decidedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) rejectNote!: string | null;
  @ApiProperty() board!: string;
  @ApiProperty() postTitle!: string;
  @ApiProperty({ description: '원글 상태 — PUBLISHED 가 아니면 승인해도 보이지 않음' }) postState!: string;
}
export class TownPickCountsDto {
  @ApiProperty() pending!: number;
  @ApiProperty() approved!: number;
  @ApiProperty() rejected!: number;
}
export class TownPickChannelDto {
  @ApiProperty({ description: 'AI 통로 TOWN_PICK 이 열려 있음(스위치 · AI 전체 · 월 상한)' }) ok!: boolean;
  @ApiPropertyOptional({ nullable: true, example: 'CHANNEL_OFF' }) reason!: string | null;
}
export class TownPicksAdminDto {
  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED'] }) state!: string;
  @ApiProperty({ type: [TownPickRowDto] }) items!: TownPickRowDto[];
  @ApiProperty({ type: TownPickCountsDto }) counts!: TownPickCountsDto;
  @ApiProperty({ type: TownPickChannelDto }) channel!: TownPickChannelDto;
}
export class TownPickApproveDto {
  @ApiPropertyOptional({ maxLength: 60, description: '고친 제목(없으면 AI 제목 그대로)' }) @IsOptional() @IsString() @MaxLength(60) headline?: string;
  @ApiPropertyOptional({ maxLength: 300, description: '고친 소개(없으면 AI 소개 그대로)' }) @IsOptional() @IsString() @MaxLength(300) summary?: string;
}
export class TownPickRejectDto {
  @ApiProperty({ minLength: 2, maxLength: 300 }) @IsString() @MaxLength(300) note!: string;
}
export class TownPickDecideResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] }) state!: string;
}
export class TownPickRunResultDto {
  @ApiProperty({ description: '새로 만든 후보 수' }) affected!: number;
  @ApiProperty({ type: Object, description: '건너뛴 까닭(skipped) · 지역 수 · 오류 수' }) detail!: Record<string, unknown>;
}

@ApiTags('HOM')
@Controller('api/v1')
export class TownPickController {
  constructor(private readonly svc: TownPickService) {}

  @Get('community/town-picks')
  @ApiOperation({ summary: '동네픽 (v10.211)', description: '운영자가 승인한 동네픽 — region(예: 서울특별시 강남구)이 있고 그 지역 것이 있으면 그 지역, 없으면 전국 최근 6개. 30일 안 · 원글 공개 중만.' })
  @ApiQuery({ name: 'region', required: false })
  @ApiOkResponse({ type: TownPicksPublicDto })
  picks(@Query('region') region?: string) { return this.svc.publicPicks(region); }

  @ApiBearerAuth()
  @Get('admin/community/town-picks')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '동네픽 후보 (v10.211)', description: 'AI 가 고른 후보 · 승인 · 거절 목록(최근 200) · AI 통로 상태.' })
  @ApiQuery({ name: 'state', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  @ApiOkResponse({ type: TownPicksAdminDto })
  list(@Query('state') state?: string) { return this.svc.list(state); }

  @ApiBearerAuth()
  @Post('admin/community/town-picks/:id/approve')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '동네픽 승인 (v10.211)', description: '소개광장 맨 위 「동네픽」에 30일 보임. 제목 · 소개를 고쳐서 승인할 수 있음.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 422, description: 'TOWN_PICK_DECIDED · TOWN_PICK_TEXT', type: ErrorDto })
  @ApiOkResponse({ type: TownPickDecideResultDto })
  @Audit('TOWN_PICK_APPROVE', 'POST')
  approve(@Param('id') id: string, @Body() dto: TownPickApproveDto) { return this.svc.approve(id, dto.headline, dto.summary); }

  @ApiBearerAuth()
  @Post('admin/community/town-picks/:id/reject')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '동네픽 거절 (v10.211)', description: '사유 2 ~ 300자. 같은 글은 다시 후보가 되지 않음.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 422, description: 'TOWN_PICK_DECIDED · TOWN_PICK_NOTE', type: ErrorDto })
  @ApiOkResponse({ type: TownPickDecideResultDto })
  @Audit('TOWN_PICK_REJECT', 'POST')
  reject(@Param('id') id: string, @Body() dto: TownPickRejectDto) { return this.svc.reject(id, dto.note); }

  @ApiBearerAuth()
  @Post('admin/community/town-picks/run')
  @Roles('SUPER')
  @ApiOperation({ summary: '동네픽 지금 고르기 (v10.211)', description: '매일 06:00 작업을 지금 한 번. 스위치 · AI 전체 · 월 상한이 막으면 아무것도 부르지 않음(skipped).' })
  @ApiOkResponse({ type: TownPickRunResultDto })
  @Audit('TOWN_PICK_RUN', 'POST')
  run() { return this.svc.runBatch(); }
}
