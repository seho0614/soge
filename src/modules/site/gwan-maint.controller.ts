import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
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
  @ApiPropertyOptional({ enum: [0, 60, 1440], description: 'v10.748 공지를 올리는 때 — 0 지금 · 60 한 시간 전 · 1440 하루 전' }) @IsOptional() @IsIn([0, 60, 1440]) noticeLeadMin?: number;
}
export class GwanMaintRepeatCreateDto {
  @ApiProperty({ example: 'EDU' }) @IsString() @Matches(/^[A-Z]{3,4}$/) gwanCode!: string;
  @ApiProperty({ example: 2, description: '요일 0 일요일 ~ 6 토요일' }) @IsInt() @Min(0) @Max(6) dow!: number;
  @ApiProperty({ example: '03:00', description: '한국 시각 HH:MM' }) @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) atKst!: string;
  @ApiProperty({ example: 30, enum: [15, 30, 60, 90, 120] }) @IsIn([15, 30, 60, 90, 120]) minutes!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) note?: string;
}
export class GwanMaintRepeatDto {
  @ApiProperty() id!: number;
  @ApiProperty() gwanCode!: string;
  @ApiProperty() gwanName!: string;
  @ApiProperty() dow!: number;
  @ApiProperty() atKst!: string;
  @ApiProperty() minutes!: number;
  @ApiProperty({ nullable: true }) note!: string | null;
  @ApiProperty() isActive!: boolean;
}
export class GwanMaintRepeatResultDto {
  @ApiProperty() id!: number;
}
export class GwanOpenLogDto {
  @ApiProperty() id!: number;
  @ApiProperty() gwanCode!: string;
  @ApiProperty() gwanName!: string;
  @ApiProperty({ description: 'true 열기 · false 닫기' }) opened!: boolean;
  @ApiProperty({ enum: ['ADMIN', 'MAINT'] }) source!: string;
  @ApiProperty({ nullable: true }) byName!: string | null;
  @ApiProperty({ nullable: true }) maintId!: number | null;
  @ApiProperty() at!: string;
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

  /* v10.721 (D325 · docs/829) 점검 시간 반복 */
  @Get('admin/gwan-maint-repeats')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '점검 시간 반복 목록 (v10.721)' })
  @ApiOkResponse({ type: GwanMaintRepeatDto, isArray: true })
  repeats() { return this.svc.repeats(); }

  @Post('admin/gwan-maint-repeats')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '점검 시간 반복 만들기 (v10.721 · SUPER)', description: '요일 · 한국 시각 · 길이 — 7일 앞까지 점검을 만들어 둠(겹치면 건너뜀).' })
  @ApiOkResponse({ type: GwanMaintRepeatResultDto })
  @ApiResponse({ status: 422, description: 'GWAN_MAINT_TIME', type: ErrorDto })
  @Audit('GWAN_MAINT_REPEAT', 'GWAN')
  createRepeat(@Body() dto: GwanMaintRepeatCreateDto) { return this.svc.createRepeat(dto); }

  @Post('admin/gwan-maint-repeats/:id/stop')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '점검 시간 반복 멈춤 (v10.721 · SUPER)', description: '아직 시작 안 한 점검은 취소.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: GwanMaintRepeatResultDto })
  @ApiResponse({ status: 422, description: 'GWAN_MAINT_STATE', type: ErrorDto })
  @Audit('GWAN_MAINT_REPEAT_STOP', 'GWAN')
  stopRepeat(@Param('id', ParseIntPipe) id: number) { return this.svc.stopRepeat(id); }

  /* v10.727 (D325 · docs/835) 관 열기 · 닫기 기록 */
  @Get('admin/gwan-open-log')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '관 열기 · 닫기 기록 (v10.727)', description: '최근 200줄 · 운영 화면(ADMIN) · 점검(MAINT).' })
  @ApiQuery({ name: 'gwanCode', required: false })
  @ApiOkResponse({ type: GwanOpenLogDto, isArray: true })
  openLog(@Query('gwanCode') gwanCode?: string) { return this.svc.openLog(gwanCode || undefined); }

  @Get('gwans/:code/maintenance')
  @ApiOperation({ summary: '관 점검 안내 (v10.707 · 공개)', description: '지금 점검 중이면 끝 시각 · 안내 글 · 48시간 안 다음 점검(없으면 null).' })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: GwanMaintPublicDto })
  publicStatus(@Param('code') code: string) { return this.svc.publicStatus(String(code).toUpperCase().slice(0, 4)); }
}
