import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { SafenumService } from './safenum.service';

/* ---------------------------------------------------------------------
 * v10.145 (D141 · docs/221 · 설계 docs/218) — 050 안심번호
 *
 *   회원(MEMBER …)    POST /listings/{id}/safe-number            매물 상세 「전화하기」 — 050 번호(safenum.hours · 다시 씀 · 하루 safenum.daily)
 *                    POST /listings/{id}/safe-number/mock-call  가짜 통화(MOCK 만)
 *   업체(로그인 없음)  POST /webhooks/safenum                     통화 끝 알림 — HMAC 서명 · 같은 알림 한 번 · 통화 기록 → 소개 기록(CALL)
 *   운영(ADMIN · SUPER) GET /admin/safenum/status · GET /admin/safenum/calls
 *   ★ DTO 는 쓰는 곳보다 위에(ts-node strict 끔 — 선언 순서)
 * ------------------------------------------------------------------- */

export class SafeNumberDto {
  @ApiProperty({ example: '0500-0000-1234' }) number!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ enum: ['MOCK', 'HTTP'] }) mode!: string;
  @ApiProperty({ description: '이미 받은 번호를 다시 씀' }) reused!: boolean;
}
export class SafenumMockCallDto {
  @ApiPropertyOptional({ example: 42, description: '통화 초' }) @IsOptional() @IsInt() @Min(0) @Max(36000) durationSec?: number;
}
export class SafenumResultDto {
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional() result?: string;
  @ApiPropertyOptional() duplicate?: boolean;
  @ApiPropertyOptional() ignored?: string;
}
export class SafenumKeyStateDto {
  @ApiProperty() name!: string;
  @ApiProperty() set!: boolean;
  @ApiProperty({ enum: ['ADMIN', 'ENV', 'NONE'] }) source!: string;
}
export class SafenumUrlDto {
  @ApiProperty({ description: 'SAFENUM_URL(.env) 이 있음' }) set!: boolean;
}
export class SafenumLast30Dto {
  @ApiProperty() issued!: number;
  @ApiProperty() active!: number;
  @ApiProperty() withCode!: number;
  @ApiProperty() calls!: number;
  @ApiProperty() seconds!: number;
  @ApiProperty() attributed!: number;
}
export class SafenumHookStatDto {
  @ApiProperty() received!: number;
  @ApiProperty() badSignature!: number;
  @ApiProperty() duplicate!: number;
  @ApiProperty() unknown!: number;
}
export class SafenumStatusDto {
  @ApiProperty({ enum: ['NONE', 'MOCK', 'HTTP'] }) provider!: string;
  @ApiProperty() setting!: string;
  @ApiProperty() mockAllowed!: boolean;
  @ApiProperty({ type: SafenumUrlDto }) url!: SafenumUrlDto;
  @ApiProperty({ type: [SafenumKeyStateDto] }) keys!: SafenumKeyStateDto[];
  @ApiProperty({ type: [String] }) missing!: string[];
  @ApiProperty() configured!: boolean;
  @ApiProperty() webhookUrl!: string;
  @ApiProperty() hours!: number;
  @ApiProperty() daily!: number;
  @ApiProperty({ type: SafenumLast30Dto }) last30!: SafenumLast30Dto;
  @ApiProperty({ type: SafenumHookStatDto }) webhook!: SafenumHookStatDto;
}
export class SafenumCallRowDto {
  @ApiProperty() id!: string;
  @ApiProperty({ format: 'date-time' }) at!: string;
  @ApiPropertyOptional({ nullable: true }) durationSec!: number | null;
  @ApiProperty({ description: '050 번호 끝 4자리' }) numberLast4!: string;
  @ApiProperty() listingTitle!: string;
  @ApiProperty({ description: '소개코드가 묶인 번호(소개 기록 CALL)' }) attributed!: boolean;
  @ApiPropertyOptional({ nullable: true }) provider!: string | null;
}
export class SafenumCallsDto {
  @ApiProperty({ enum: [1, 7, 30] }) days!: number;
  @ApiProperty({ type: [SafenumCallRowDto] }) rows!: SafenumCallRowDto[];
}

@ApiTags('HOM')
@ApiBearerAuth()
@Controller('api/v1')
export class SafenumController {
  constructor(private readonly svc: SafenumService) {}

  @Post('listings/:id/safe-number')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({ summary: '전화하기 — 050 안심번호 받기 (v10.145)', description: '등록자 휴대폰에 묶인 050 번호. 같은 회원 · 매물은 쓰는 시간 안에 다시 씀. 소개코드로 들어온 방문이면 통화가 소개 기록(CALL)으로 남습니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'SAFENUM_OFF(준비 중) · SAFENUM_NOT_CONFIGURED · SAFENUM_NO_PHONE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'OWN_TARGET · SAFENUM_NOT_ALLOWED · SAFENUM_DAILY_LIMIT', type: ErrorDto })
  @ApiResponse({ status: 502, description: 'SAFENUM_FAILED — 업체 실패(잠시 뒤 다시)', type: ErrorDto })
  @ApiOkResponse({ type: SafeNumberDto })
  @Audit('SAFENUM_ISSUE', 'LISTING')
  issue(@Param('id') id: string) { return this.svc.issue(id); }

  @Post('listings/:id/safe-number/mock-call')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({ summary: '가짜 통화 (v10.145 · MOCK 만)', description: '점검판 시험 — 내가 받은 번호로 통화가 끝난 것처럼 기록. 운영 서버에서는 MOCK 을 못 고릅니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'SAFENUM_NONE', type: ErrorDto })
  @ApiOkResponse({ type: SafenumResultDto })
  mockCall(@Param('id') id: string, @Body() dto: SafenumMockCallDto) { return this.svc.mockCall(id, dto.durationSec ?? 42); }

  /* ★ 공개 주소(업체가 로그인하지 않음 · check-acl 'webhooks' 구역). 서명이 맞아야 처리합니다. */
  @Post('webhooks/safenum')
  @HttpCode(200)
  @ApiOperation({ summary: '안심번호 업체 통화 알림 (v10.145 · 웹훅)', description: '**로그인 없는 공개 주소**. 머리글 `x-safenum-timestamp` · `x-safenum-signature`(HMAC-SHA256(웹훅 비밀값, "시각.본문")) — 틀리거나 5분 넘게 어긋나면 401. 같은 eventId 는 한 번. 건 번호는 해시로만.' })
  @ApiResponse({ status: 401, description: 'SAFENUM_BAD_SIGNATURE', type: ErrorDto })
  @ApiOkResponse({ type: SafenumResultDto })
  webhook(@Req() req: RawBodyRequest<any>, @Headers() headers: Record<string, string>, @Body() body: any) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body ?? {});
    return this.svc.webhook(raw, headers, body);
  }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/safenum')
export class SafenumAdminController {
  constructor(private readonly svc: SafenumService) {}

  @Get('status')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '안심번호 준비 상태 (v10.145)', description: '방식 · 키 2개 · 주소(값 없이) · 웹훅 주소 · 최근 30일 발급 · 통화 · 소개 기록 · 웹훅 받은 수.' })
  @ApiOkResponse({ type: SafenumStatusDto })
  status() { return this.svc.status(); }

  @Get('calls')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '안심번호 통화 기록 (v10.145)', description: '최근 1 · 7 · 30일 · 50줄. 전화번호는 내지 않음(050 끝 4자리만).' })
  @ApiQuery({ name: 'days', required: false, enum: [1, 7, 30] })
  @ApiOkResponse({ type: SafenumCallsDto })
  calls(@Query('days') days?: string) { return this.svc.calls(Number(days) || 7); }
}
