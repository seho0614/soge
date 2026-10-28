import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { DealContractService } from './deal-contract.service';
import { EsignService } from './esign.service';

/* ---------------------------------------------------------------------
 * v10.143 (D139 · docs/217 · 설계 docs/216) — 전자계약
 *
 *   당사자(MEMBER …)  POST /deals/{id}/contract/esign            전자서명 요청(STUB 이면 옛 스텁 기록 그대로)
 *                    GET  /deals/{id}/contract/esign            상태(내 서명 주소는 나에게만)
 *                    POST /deals/{id}/contract/esign/cancel     요청 취소(계약은 합의 상태 그대로)
 *                    POST /deals/{id}/contract/esign/mock-sign  가짜 서명 · 거절(MOCK 만)
 *   업체(로그인 없음)  POST /webhooks/esign                       완료 알림 — HMAC 서명 검사 · 같은 알림 한 번 · HTTP 는 업체에 다시 조회
 *   운영(ADMIN · SUPER) GET /admin/esign/status · GET /admin/esign/documents
 *   ★ DTO 는 쓰는 곳보다 위에(ts-node strict 끔 — 선언 순서)
 * ------------------------------------------------------------------- */

export class EsignViewDto {
  @ApiProperty({ enum: ['STUB', 'MOCK', 'HTTP'] }) mode!: string;
  @ApiProperty() contractState!: string;
  @ApiProperty({ enum: ['NOT_REQUESTED', 'PENDING', 'SIGNED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'FAILED'] }) state!: string;
  @ApiPropertyOptional({ nullable: true, description: '계약서 지문(SHA-256)' }) docHash!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) buyerSignedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) sellerSignedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) expiresAt!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) requestedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) completedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) errorKind!: string | null;
  @ApiPropertyOptional({ nullable: true, description: '내 서명 주소 — 나에게만 · 대기 중 · 아직 안 했을 때' }) mySignUrl!: string | null;
  @ApiProperty({ enum: ['BUYER', 'SELLER'] }) mySide!: string;
  @ApiProperty() stub!: boolean;
}
export class EsignMockSignDto {
  @ApiProperty({ enum: ['SIGN', 'REJECT'] }) @IsIn(['SIGN', 'REJECT']) action!: 'SIGN' | 'REJECT';
}
export class EsignMockResultDto extends EsignViewDto {
  @ApiProperty({ description: '반영 결과(PENDING · SIGNED · REJECTED …)' }) result!: string;
}
export class EsignWebhookResultDto {
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional() result?: string;
  @ApiPropertyOptional() duplicate?: boolean;
  @ApiPropertyOptional() ignored?: string;
}
export class EsignKeyStateDto {
  @ApiProperty() name!: string;
  @ApiProperty() set!: boolean;
  @ApiProperty({ enum: ['ADMIN', 'ENV', 'NONE'] }) source!: string;
}
export class EsignUrlDto {
  @ApiProperty({ description: 'ESIGN_URL(.env) 이 있음' }) set!: boolean;
}
export class EsignReasonDto {
  @ApiProperty() reason!: string;
  @ApiProperty() n!: number;
}
export class EsignLast30Dto {
  @ApiProperty() requested!: number;
  @ApiProperty() signed!: number;
  @ApiProperty() pending!: number;
  @ApiProperty() closed!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ type: [EsignReasonDto] }) reasons!: EsignReasonDto[];
}
export class EsignWebhookStatDto {
  @ApiProperty() received!: number;
  @ApiProperty() badSignature!: number;
  @ApiProperty() duplicate!: number;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) lastAt!: string | null;
}
export class EsignStatusDto {
  @ApiProperty({ enum: ['STUB', 'MOCK', 'HTTP'], description: '실제로 쓰는 방식' }) provider!: string;
  @ApiProperty({ description: '설정 값(esign.provider)' }) setting!: string;
  @ApiProperty() mockAllowed!: boolean;
  @ApiProperty({ type: EsignUrlDto }) url!: EsignUrlDto;
  @ApiProperty({ type: [EsignKeyStateDto] }) keys!: EsignKeyStateDto[];
  @ApiProperty({ type: [String], description: 'HTTP 에 빠진 것' }) missing!: string[];
  @ApiProperty() configured!: boolean;
  @ApiProperty({ description: '업체에 등록할 웹훅 주소' }) webhookUrl!: string;
  @ApiProperty({ type: EsignLast30Dto }) last30!: EsignLast30Dto;
  @ApiProperty({ type: EsignWebhookStatDto }) webhook!: EsignWebhookStatDto;
}
export class EsignDocRowDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) dealId!: string;
  @ApiProperty() provider!: string;
  @ApiPropertyOptional({ nullable: true }) docId!: string | null;
  @ApiProperty() state!: string;
  @ApiProperty({ description: '지문 앞 12자' }) hash!: string;
  @ApiProperty() buyerSigned!: boolean;
  @ApiProperty() sellerSigned!: boolean;
  @ApiPropertyOptional({ nullable: true }) errorKind!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) completedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}
export class EsignDocsDto {
  @ApiProperty({ enum: [1, 7, 30, 90] }) days!: number;
  @ApiProperty({ type: [EsignDocRowDto] }) rows!: EsignDocRowDto[];
}

@ApiTags('HOM')
@ApiBearerAuth()
@ApiResponse({ status: 403, description: 'NOT_PARTY · MOCK_ONLY', type: ErrorDto })
@Controller('api/v1')
export class EsignController {
  constructor(private readonly esign: EsignService, private readonly contracts: DealContractService) {}

  @Post('deals/:id/contract/esign')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '전자서명 요청 (v10.143)',
    description: '양측 합의(AGREED) 뒤 업체에 서명 요청 — 계약서 지문(SHA-256)을 남기고 조건을 잠급니다. 이미 대기 중이면 그 요청을 돌려줍니다.\n\n' +
      '방식(esign.provider)이 STUB 이면 지금처럼 `stub: true` 기록만 — 법적 효력이 없습니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'NOT_AGREED · ALREADY_SIGNED · ESIGN_NOT_CONFIGURED · NO_TEMPLATE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'ESIGN_CONTACT_MISSING', type: ErrorDto })
  @ApiResponse({ status: 502, description: 'ESIGN_FAILED — 업체 연결 실패(잠시 뒤 다시)', type: ErrorDto })
  @ApiOkResponse({ type: EsignViewDto })
  @Audit('CONTRACT_ESIGN', 'DEAL')
  async request(@Param('id') id: string) {
    return (await this.esign.request(id)) ?? this.contracts.requestESign(id);
  }

  @Get('deals/:id/contract/esign')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({ summary: '전자서명 상태 (v10.143)', description: '당사자만. 내 서명 주소는 나에게만. STUB 이면 옛 스텁 상태(`stub: true`).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EsignViewDto })
  async view(@Param('id') id: string) {
    return (await this.esign.mode()) === 'STUB' ? this.contracts.esignStatus(id) : this.esign.view(id);
  }

  @Post('deals/:id/contract/esign/cancel')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({ summary: '전자서명 요청 취소 (v10.143)', description: '대기 중 요청을 닫습니다(업체에도 취소). 계약은 합의 상태 그대로 — 조건을 고치거나 다시 요청할 수 있습니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'ESIGN_NOT_PENDING', type: ErrorDto })
  @ApiOkResponse({ type: EsignViewDto })
  @Audit('CONTRACT_ESIGN_CANCEL', 'DEAL')
  cancel(@Param('id') id: string) { return this.esign.cancel(id); }

  @Post('deals/:id/contract/esign/mock-sign')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({ summary: '가짜 서명 · 거절 (v10.143 · MOCK 만)', description: '점검판 시험용 — 내 쪽 서명(SIGN) 또는 거절(REJECT). 양측이 서명하면 계약 SIGNED. 운영 서버에서는 MOCK 을 못 고릅니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'ESIGN_NOT_PENDING', type: ErrorDto })
  @ApiOkResponse({ type: EsignMockResultDto })
  mockSign(@Param('id') id: string, @Body() dto: EsignMockSignDto) { return this.esign.mockSign(id, dto.action); }

  /* ★ 공개 주소(업체가 로그인하지 않음 · check-acl 'webhooks' 구역). 서명이 맞아야 처리하고, HTTP 는 본문을 믿지 않고 업체에 다시 물어봅니다. */
  @Post('webhooks/esign')
  @HttpCode(200)
  @ApiOperation({
    summary: '전자계약 업체 완료 알림 (v10.143 · 웹훅)',
    description: '**로그인 없는 공개 주소**입니다. 머리글 `x-esign-timestamp`(초) · `x-esign-signature`(HMAC-SHA256(웹훅 비밀값, "시각.본문") hex 또는 base64)를 검사합니다 — ' +
      '틀리거나 5분 넘게 어긋나면 401. 같은 eventId 는 한 번만 처리. 방식이 HTTP 면 상태는 업체에 다시 조회한 값으로 반영(조회 실패 502 — 업체가 다시 보냄).',
  })
  @ApiResponse({ status: 401, description: 'ESIGN_BAD_SIGNATURE', type: ErrorDto })
  @ApiResponse({ status: 502, description: 'ESIGN_LOOKUP_FAILED', type: ErrorDto })
  @ApiOkResponse({ type: EsignWebhookResultDto })
  webhook(@Req() req: RawBodyRequest<any>, @Headers() headers: Record<string, string>, @Body() body: any) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body ?? {});
    return this.esign.webhook(raw, headers, body);
  }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/esign')
export class EsignAdminController {
  constructor(private readonly esign: EsignService) {}

  @Get('status')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '전자계약 준비 상태 (v10.143)', description: '방식 · 키 2개 · 주소(값 없이) · 웹훅 주소 · 최근 30일 요청 · 완료 · 실패 까닭 · 웹훅 받은 수(서명 틀림 · 중복).' })
  @ApiOkResponse({ type: EsignStatusDto })
  status() { return this.esign.status(); }

  @Get('documents')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '전자서명 요청 목록 (v10.143)', description: '최근 1 · 7 · 30 · 90일 · 100줄. 연락처 · 서명 주소는 내지 않습니다.' })
  @ApiQuery({ name: 'days', required: false, enum: [1, 7, 30, 90] })
  @ApiOkResponse({ type: EsignDocsDto })
  documents(@Query('days') days?: string) { return this.esign.documents(Number(days) || 30); }
}
