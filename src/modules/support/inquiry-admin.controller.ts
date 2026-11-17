import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { INQUIRY_ANSWER_MAX, InquiryAdminService } from './inquiry-admin.service';

/* ---------------------------------------------------------------------
 * v10.333 (D225 · docs/464) — 운영 화면 「1:1 문의」 답변함(SB-ADM-INQ-010)
 *
 *   ADMIN·SUPER  GET   /admin/inquiries               목록(상태 · 분류 · 기한 넘김 · 찾기 · 30개씩) · 상태별 수
 *                GET   /admin/inquiries/:id           한 건(본문 · 첨부 · 관련 거래 · 이 회원의 지난 문의 · 담당 고를 운영자)
 *                POST  /admin/inquiries/:id/answer    답변(회원 알림 INQUIRY_ANSWERED · 감사 INQUIRY_ANSWER — 옛 답 before)
 *                PATCH /admin/inquiries/:id           담당 · 운영 메모 · 닫기 · 다시 열기(감사 INQUIRY_UPDATE)
 * ------------------------------------------------------------------- */

export class InquiryAnswerDto {
  @ApiProperty({ maxLength: INQUIRY_ANSWER_MAX, description: `답변(2 ~ ${INQUIRY_ANSWER_MAX}자 · 회원에게 그대로 보임)` })
  @IsString() @MaxLength(8000) answer!: string;
  @ApiPropertyOptional({ description: 'true = 답하면서 닫음' }) @IsOptional() @IsBoolean() close?: boolean;
  @ApiPropertyOptional({ format: 'uuid', description: 'v10.337 — 「답변 틀 고르기」로 고른 틀(지표 「답변 틀별 쓴 횟수」 · 없는 틀이면 무시)' })
  @IsOptional() @IsString() @MaxLength(40) templateId?: string;
}
export class InquiryStatsCatDto {
  @ApiProperty() category!: string;
  @ApiPropertyOptional({ nullable: true }) label!: string | null;
  @ApiProperty() received!: number;
  @ApiProperty() answered!: number;
}
export class InquiryStatsTplDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() used!: number;
}
export class InquiryStatsDto {
  @ApiProperty({ example: 30 }) days!: number;
  @ApiProperty() received!: number;
  @ApiProperty() answered!: number;
  @ApiProperty() stillOpen!: number;
  @ApiPropertyOptional({ nullable: true, description: '처음 답까지 평균 시간' }) avgHours!: number | null;
  @ApiPropertyOptional({ nullable: true, description: '처음 답까지 가운데 값(시간)' }) medianHours!: number | null;
  @ApiProperty({ description: '기한(영업일 1일) 안에 처음 답한 수' }) inTime!: number;
  @ApiPropertyOptional({ nullable: true, description: '기한 안 비율 % (답한 것 중)' }) inTimeRate!: number | null;
  @ApiProperty({ type: InquiryStatsCatDto, isArray: true }) byCategory!: InquiryStatsCatDto[];
  @ApiProperty({ type: InquiryStatsTplDto, isArray: true }) templates!: InquiryStatsTplDto[];
}
export class InquiryPatchDto {
  @ApiPropertyOptional({ format: 'uuid', description: '담당 운영자(빈 글자 = 담당 없음)' }) @IsOptional() @IsString() @MaxLength(40) assigneeId?: string;
  @ApiPropertyOptional({ description: '운영 메모(회원에게 안 보임 · 1,000자)' }) @IsOptional() @IsString() @MaxLength(2000) staffNote?: string;
  @ApiPropertyOptional({ enum: ['OPEN', 'CLOSED'], description: 'OPEN = 다시 열기(기한 다시 영업일 1일) · CLOSED = 닫기' })
  @IsOptional() @IsIn(['OPEN', 'ANSWERED', 'CLOSED']) status?: string;
}
export class InquiryResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() note!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/inquiries')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class InquiryAdminController {
  constructor(private readonly svc: InquiryAdminService) {}

  @Get()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '1:1 문의 — 목록', description: '열린 것 먼저 · 기한 가까운 순. 상태별 수(counts) · 분류(categories). 메일은 가림.' })
  @ApiQuery({ name: 'status', required: false, enum: ['OPEN', 'ANSWERED', 'CLOSED'] })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'overdue', required: false, description: '1 = 기한 넘긴 열린 문의만' })
  @ApiQuery({ name: 'q', required: false, description: '제목 · 본문 · 메일에 든 글자(100자)' })
  @ApiQuery({ name: 'page', required: false, description: '1부터 · 30개씩' })
  @ApiOkResponse({ type: Object })
  list(@Query('status') status?: string, @Query('category') category?: string, @Query('overdue') overdue?: string,
       @Query('q') q?: string, @Query('page') page?: string) {
    return this.svc.list({ status, category, overdue: overdue === '1' || overdue === 'true', q, page: Number(page) || 1 });
  }

  @Get('stats')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '1:1 문의 — 처리 지표 (v10.337)', description: '최근 days 일(7 ~ 90 · 처음 30) 접수 · 답한 수 · 처음 답까지 평균 · 가운데 시간 · 기한 안 비율 · 분류별 · 답변 틀별 쓴 횟수. 처음 답 시각은 감사 기록 INQUIRY_ANSWER 가장 이른 것.' })
  @ApiQuery({ name: 'days', required: false, description: '7 ~ 90 · 처음 30' })
  @ApiOkResponse({ type: InquiryStatsDto })
  stats(@Query('days') days?: string) { return this.svc.stats(Number(days) || 30); }

  @Get(':id')
  @Roles('ADMIN', 'SUPER')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '1:1 문의 — 한 건', description: '본문(챗봇에서 넘어온 문의는 대화가 본문에 붙음) · 첨부 파일 번호(GET /files/{id} 로 열람) · 관련 거래 · 이 회원의 지난 문의 10건 · 담당 고를 운영자.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  one(@Param('id', ParseUUIDPipe) id: string) { return this.svc.one(id); }

  @Post(':id/answer')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '1:1 문의 — 답변', description: '상태 ANSWERED(close 면 CLOSED) · 회원에게 알림(INQUIRY_ANSWERED → /support/history) · 고치면 옛 답은 감사 기록 INQUIRY_ANSWER 에.' })
  @ApiOkResponse({ type: InquiryResultDto })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'INQUIRY_CLOSED — 닫힌 문의(다시 연 뒤 답함)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'INQUIRY_ANSWER_SHORT · INQUIRY_ANSWER_LONG' })
  answer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: InquiryAnswerDto) { return this.svc.answer(id, dto.answer, dto.close, dto.templateId); }

  @Patch(':id')
  @Roles('ADMIN', 'SUPER')
  @Audit('INQUIRY_UPDATE', 'INQUIRY')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '1:1 문의 — 담당 · 메모 · 닫기 · 다시 열기', description: '보낸 칸만 바꿈. 「답변 완료」는 답변을 보내면 저절로.' })
  @ApiOkResponse({ type: InquiryResultDto })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'INQUIRY_ALREADY_OPEN' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'INQUIRY_STATUS · INQUIRY_ASSIGNEE' })
  patch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: InquiryPatchDto) { return this.svc.patch(id, dto); }
}
