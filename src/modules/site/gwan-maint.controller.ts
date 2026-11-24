import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { GwanMaintService } from './gwan-maint.service';

/* ---------------------------------------------------------------------
 * v10.706 · v10.707 (D323 · docs/814 · 815) 관 점검 시간 예약 · 닫힌 관 손님 안내
 *   ADMIN · SUPER  GET  /admin/gwan-maintenances(?gwanCode=)
 *   SUPER          POST /admin/gwan-maintenances · POST …/{id}/cancel(시작 전) · POST …/{id}/end(점검 중 지금 끝내기)
 *   공개           GET  /gwans/{code}/maintenance(지금 점검 중이면 끝 시각 · 안내 글 · 48시간 안 다음 점검)
 * ------------------------------------------------------------------- */

export class GwanMaintDto {
  @ApiProperty() id!: number;
  @ApiProperty() gwanCode!: string;
  @ApiProperty() gwanName!: string;
  @ApiProperty() startsAt!: string;
  @ApiProperty() endsAt!: string;
  @ApiProperty({ nullable: true, description: '손님 안내 글(200자)' }) note!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ nullable: true }) createdByName!: string | null;
  @ApiProperty({ description: 'v10.710 손님 미리 알림(상단 고정 공지)' }) announce!: boolean;
  @ApiProperty({ nullable: true }) noticeId!: string | null;
  @ApiProperty({ nullable: true, description: '시작 때 관이 열려 있었음(끝나면 다시 엶)' }) wasOpen!: boolean | null;
  @ApiProperty({ nullable: true }) closedAt!: string | null;
  @ApiProperty({ nullable: true }) reopenedAt!: string | null;
  @ApiProperty({ nullable: true }) reopenError!: string | null;
  @ApiProperty({ nullable: true }) canceledAt!: string | null;
  @ApiProperty({ enum: ['SCHEDULED', 'RUNNING', 'DONE', 'CANCELED'] }) status!: string;
}
export class GwanMaintCreateDto {
  @ApiProperty({ example: 'EDU' }) @IsString() @Matches(/^[A-Z]{3,4}$/) gwanCode!: string;
  @ApiProperty({ example: '2026-12-01T15:00:00Z' }) @IsDateString({}, { message: '시각 모양이 맞지 않습니다.' }) startsAt!: string;
  @ApiProperty({ example: '2026-12-01T15:30:00Z', description: '시작 뒤 2시간 안' }) @IsDateString({}, { message: '시각 모양이 맞지 않습니다.' }) endsAt!: string;
  @ApiPropertyOptional({ example: '안내 페이지를 새로 꾸미는 중입니다.', description: '손님 안내 글(200자)' }) @IsOptional() @IsString() @MaxLength(200) note?: string;
  @ApiPropertyOptional({ description: 'v10.710 손님에게 미리 알림 — 상단 고정 공지(지금 ~ 점검 끝)' }) @IsOptional() @StrictBoolean() announce?: boolean;
  @ApiPropertyOptional({ description: 'v10.710 회원 알림도(공지 알림 길 · announce 일 때만)' }) @IsOptional() @StrictBoolean() notifyMembers?: boolean;
}
export class GwanMaintPublicItemDto {
  @ApiProperty() startsAt!: string;
  @ApiProperty() endsAt!: string;
  @ApiProperty({ nullable: true }) note!: string | null;
}
export class GwanMaintPublicDto {
  @ApiProperty() gwanCode!: string;
  @ApiProperty({ type: GwanMaintPublicItemDto, nullable: true, description: '지금 점검 중(관이 닫혀 있음)' }) running!: GwanMaintPublicItemDto | null;
  @ApiProperty({ type: GwanMaintPublicItemDto, nullable: true, description: '48시간 안 다음 점검' }) next!: GwanMaintPublicItemDto | null;
}

@ApiTags('ADM')
@Controller('api/v1')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class GwanMaintController {
  constructor(private readonly svc: GwanMaintService) {}

  @Get('admin/gwan-maintenances')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '관 점검 시간 목록 (v10.706)', description: '예약 · 점검 중 · 끝(30일) · 취소.' })
  @ApiQuery({ name: 'gwanCode', required: false })
  @ApiOkResponse({ type: GwanMaintDto, isArray: true })
  list(@Query('gwanCode') gwanCode?: string) { return this.svc.list(gwanCode || undefined); }

  @Post('admin/gwan-maintenances')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '관 점검 시간 예약 (v10.706 · SUPER)', description: '시작에 관을 닫고 끝에 다시 엶(열려 있던 관만) · 최대 2시간 · 겹치면 422 GWAN_MAINT_OVERLAP.' })
  @ApiOkResponse({ type: GwanMaintDto })
  @ApiResponse({ status: 422, description: 'GWAN_MAINT_TIME · GWAN_MAINT_OVERLAP', type: ErrorDto })
  @Audit('GWAN_MAINT_CREATE', 'GWAN')
  create(@Body() dto: GwanMaintCreateDto) { return this.svc.create(dto); }

  @Post('admin/gwan-maintenances/:id/cancel')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '관 점검 시간 취소 (v10.706 · SUPER)', description: '시작 전만 · 점검 중이면 422 GWAN_MAINT_STATE.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: GwanMaintDto })
  @ApiResponse({ status: 422, description: 'GWAN_MAINT_STATE', type: ErrorDto })
  @Audit('GWAN_MAINT_CANCEL', 'GWAN')
  cancel(@Param('id', ParseIntPipe) id: number) { return this.svc.cancel(id); }

  @Post('admin/gwan-maintenances/:id/end')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '관 점검 지금 끝내기 (v10.706 · SUPER)', description: '끝 시각을 지금으로 · 예약 게시를 내보내고 열려 있던 관을 다시 엶.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: GwanMaintDto })
  @ApiResponse({ status: 422, description: 'GWAN_MAINT_STATE', type: ErrorDto })
  @Audit('GWAN_MAINT_END', 'GWAN')
  end(@Param('id', ParseIntPipe) id: number) { return this.svc.end(id); }

  @Get('gwans/:code/maintenance')
  @ApiOperation({ summary: '관 점검 안내 (v10.707 · 공개)', description: '지금 점검 중이면 끝 시각 · 안내 글 · 48시간 안 다음 점검(없으면 null).' })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: GwanMaintPublicDto })
  publicStatus(@Param('code') code: string) { return this.svc.publicStatus(String(code).toUpperCase().slice(0, 4)); }
}
