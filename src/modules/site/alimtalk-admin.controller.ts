import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AlimtalkService } from '../../common/alimtalk/alimtalk.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/* ---------------------------------------------------------------------
 * v10.142 (D138 · docs/215 · 설계 docs/213) — 운영 화면 › 외부 연동 › 「알림톡」 (SB-ADM-SIT-080 안의 한 구역)
 *
 *   ADMIN · SUPER  GET  /admin/alimtalk/status            방식 · 키(값 없이) · 주소 · 템플릿 4개(본문 · 대행사 코드 · 심의) · 켜기 · 시험 남은 수
 *   ADMIN · SUPER  GET  /admin/alimtalk/sends             보낸 기록(1 · 7 · 30일 · 받는 번호 끝 4자리만)
 *   SUPER          PUT  /admin/alimtalk/templates/{code}  대행사 템플릿 코드 · 심의 상태
 *   SUPER          POST /admin/alimtalk/test              시험 발송 한 통(하루 alimtalk.test_daily · 감사 ALIMTALK_TEST)
 *   방식은 사이트 설정 alimtalk.provider(SUPER) · 켜기는 notify.alimtalk_ready(준비돼야 켜짐)
 * ------------------------------------------------------------------- */

export class AlimtalkKeyStateDto {
  @ApiProperty() name!: string;
  @ApiProperty() set!: boolean;
  @ApiProperty({ enum: ['ADMIN', 'ENV', 'NONE'] }) source!: string;
}
export class AlimtalkUrlDto {
  @ApiProperty({ description: 'ALIMTALK_URL(.env) 이 있음' }) set!: boolean;
}
export class AlimtalkTemplateDto {
  @ApiProperty({ enum: ['CONSULT_OTP', 'HANDOFF_ADMIN', 'ORDER_STATUS', 'NOTICE_GENERAL'] }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: '대행사 · 카카오 심의에 그대로 등록할 글(#{이름} 자리)' }) body!: string;
  @ApiProperty({ type: [String] }) vars!: string[];
  @ApiPropertyOptional({ nullable: true }) vendorCode!: string | null;
  @ApiProperty({ enum: ['NONE', 'REVIEW', 'APPROVED', 'REJECTED'] }) reviewState!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class AlimtalkQuotaDto {
  @ApiProperty() limit!: number;
  @ApiProperty() used!: number;
  @ApiProperty() left!: number;
}
export class AlimtalkStatusDto {
  @ApiProperty({ enum: ['NONE', 'MOCK', 'HTTP'], description: '실제로 쓰는 방식' }) provider!: string;
  @ApiProperty({ description: '설정 값(alimtalk.provider)' }) setting!: string;
  @ApiProperty() mockAllowed!: boolean;
  @ApiProperty({ type: AlimtalkUrlDto }) url!: AlimtalkUrlDto;
  @ApiProperty({ type: [AlimtalkKeyStateDto] }) keys!: AlimtalkKeyStateDto[];
  @ApiProperty({ type: [String], description: 'HTTP 에 빠진 것' }) missing!: string[];
  @ApiProperty({ description: '방식 · 키가 갖춰짐(시험 발송 가능)' }) configured!: boolean;
  @ApiProperty({ description: 'notify.alimtalk_ready — 켜야 회원에게 나감' }) switchOn!: boolean;
  @ApiProperty({ type: [AlimtalkTemplateDto] }) templates!: AlimtalkTemplateDto[];
  @ApiProperty({ type: AlimtalkQuotaDto }) test!: AlimtalkQuotaDto;
}
export class AlimtalkTemplateSetDto {
  @ApiPropertyOptional({ nullable: true, description: '대행사 템플릿 코드(비우면 지움)' }) @IsOptional() @IsString() @MaxLength(60) vendorCode?: string | null;
  @ApiPropertyOptional({ enum: ['NONE', 'REVIEW', 'APPROVED', 'REJECTED'] }) @IsOptional() @IsIn(['NONE', 'REVIEW', 'APPROVED', 'REJECTED']) reviewState?: string;
}
export class AlimtalkTestDto {
  @ApiProperty({ example: '01012345678' }) @IsString() @MaxLength(20) to!: string;
  @ApiPropertyOptional({ enum: ['CONSULT_OTP', 'HANDOFF_ADMIN', 'ORDER_STATUS', 'NOTICE_GENERAL'], default: 'NOTICE_GENERAL' }) @IsOptional() @IsIn(['CONSULT_OTP', 'HANDOFF_ADMIN', 'ORDER_STATUS', 'NOTICE_GENERAL']) template?: string;
}
export class AlimtalkTestResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ example: '***5678' }) to!: string;
  @ApiPropertyOptional({ nullable: true }) msgId!: string | null;
  @ApiPropertyOptional({ nullable: true, enum: ['NOT_READY', 'BAD_PHONE', 'TEMPLATE', 'NETWORK', 'TIMEOUT', 'AUTH', 'REJECTED', 'SERVER'] }) errorKind!: string | null;
  @ApiPropertyOptional({ nullable: true }) error!: string | null;
  @ApiProperty() left!: number;
}
export class AlimtalkReasonDto {
  @ApiProperty() reason!: string;
  @ApiProperty() n!: number;
}
export class AlimtalkSendRowDto {
  @ApiProperty({ format: 'date-time' }) at!: string;
  @ApiProperty({ enum: ['CONSULT_OTP', 'NOTIFY', 'TEST'] }) purpose!: string;
  @ApiProperty() template!: string;
  @ApiPropertyOptional({ nullable: true, example: '5678' }) toLast4!: string | null;
  @ApiProperty({ enum: ['SENT', 'FAILED'] }) status!: string;
  @ApiPropertyOptional({ nullable: true }) errorKind!: string | null;
  @ApiPropertyOptional({ nullable: true }) error!: string | null;
}
export class AlimtalkSendsDto {
  @ApiProperty({ enum: [1, 7, 30] }) days!: number;
  @ApiProperty() sent!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ type: [AlimtalkReasonDto] }) reasons!: AlimtalkReasonDto[];
  @ApiProperty({ type: [AlimtalkSendRowDto] }) recent!: AlimtalkSendRowDto[];
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/alimtalk')
export class AlimtalkAdminController {
  constructor(private readonly svc: AlimtalkService) {}

  @Get('status')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '알림톡 준비 상태 (v10.142)', description: '방식 · 키 2개 · 주소(값 없이) · 템플릿 4개 · 켜기 · 시험 남은 수.' })
  @ApiOkResponse({ type: AlimtalkStatusDto })
  status() { return this.svc.status(); }

  @Get('sends')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '알림톡 보낸 기록 (v10.142)', description: '최근 1 · 7 · 30일 보냄 · 실패 · 까닭별 · 최근 50줄. 받는 번호는 끝 4자리만.' })
  @ApiQuery({ name: 'days', required: false, enum: [1, 7, 30] })
  @ApiOkResponse({ type: AlimtalkSendsDto })
  sends(@Query('days') days?: string) { return this.svc.sends(Number(days) || 7); }

  @Put('templates/:code')
  @Roles('SUPER')
  @ApiOperation({ summary: '알림톡 템플릿 코드 · 심의 상태 (v10.142)', description: '승인(APPROVED)으로 바꾸려면 대행사 템플릿 코드가 있어야 합니다.' })
  @ApiOkResponse({ type: [AlimtalkTemplateDto] })
  @ApiResponse({ status: 422, description: 'TEMPLATE_CODE_FORMAT · TEMPLATE_STATE · TEMPLATE_CODE_REQUIRED', type: ErrorDto })
  @Audit('ALIMTALK_TEMPLATE', 'INTEGRATION')
  setTemplate(@Param('code') code: string, @Body() dto: AlimtalkTemplateSetDto) { return this.svc.setTemplate(code, dto); }

  @Post('test')
  @Roles('SUPER')
  @ApiOperation({ summary: '알림톡 시험 발송 (v10.142)', description: '넣은 번호로 한 통. 켜기(notify.alimtalk_ready)와 따로 · 심의 중이어도 대행사 코드가 있으면 보냄. 하루 alimtalk.test_daily 통.' })
  @ApiOkResponse({ type: AlimtalkTestResultDto })
  @ApiResponse({ status: 422, description: 'PHONE_INVALID · ALIMTALK_NOT_CONFIGURED · ALIMTALK_TEST_LIMIT', type: ErrorDto })
  @Audit('ALIMTALK_TEST', 'INTEGRATION')
  test(@Body() dto: AlimtalkTestDto) { return this.svc.test(dto.to, dto.template); }
}
