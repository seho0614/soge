import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ErrorDto } from '../../common/dto/common.dto';
import { DatabaseService } from '../../db/database.service';
import { AgentService } from '../agent/agent.service';
import { MailService } from '../../common/mail/mail.service';
import { EtaxService } from '../etax/etax.service';
import { sendImage } from '../file/attach-images';
import { ErpLinkGuard } from './erp-link.guard';
import {
  agentAllowed, agentComplete, agentProvider, agentRecord, bankFetch, bizStatus, ERP_ETAX_SLUGS, ERP_EXPORT_TARGETS, etaxSend, exportConsume,
  fileContent, mailReady, mailSend, productTaxType, taxInboxFetch, transferSend,
} from './erp-internal-more';

/* ---------------------------------------------------------------------
 * v10.801 (docs/917) ERP 연결 ③ — 묶음 8 내부 길(ERP 서비스 토큰 X-Erp-Service-Token · ErpLinkGuard · 사람 역할 없음)
 *   export/consume · agent/{allowed · provider · complete · record} · files/{id}/content · biz-status · mail · mail/ready ·
 *   etax/send · products/tax-type · bank/fetch · taxinbox/fetch · transfer/send(501)
 *   주소 표(perm_route_map)에는 넣지 않음 — v10.799 · 800 의 /internal/erp/* 와 같이 서비스 토큰만으로 막음(회원 · 운영자 권한 판정 밖)
 * ------------------------------------------------------------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ErpExportConsumeDto {
  @ApiProperty({ example: '12', description: '내려받기 승인 번호(export_requests.id)' }) @IsString() @Matches(/^\d{1,18}$/) id!: string;
  @ApiProperty({ enum: ERP_EXPORT_TARGETS }) @IsString() @IsIn(ERP_EXPORT_TARGETS) target!: string;
  @ApiProperty({ format: 'uuid', description: '내려받는 운영자(요청한 사람과 같아야 함)' }) @IsString() @Matches(UUID_RE) accountId!: string;
}
export class ErpAgentKindDto {
  @ApiProperty({ enum: ['RECEIPT'] }) @IsString() @IsIn(['RECEIPT']) kind!: string;
}
export class ErpAgentCompleteDto {
  @ApiProperty({ example: 'claude-sonnet-5-5' }) @IsString() @Matches(/^claude-[a-z0-9.-]{3,60}$/) model!: string;
  @ApiProperty({ maxLength: 8000 }) @IsString() @MaxLength(8000) system!: string;
  @ApiProperty({ minimum: 1, maximum: 2000 }) @IsInt() @Min(1) @Max(2000) maxTokens!: number;
  @ApiPropertyOptional({ enum: ['low', 'medium', 'high'] }) @IsOptional() @IsIn(['low', 'medium', 'high']) effort?: string;
  @ApiProperty({ type: [Object], description: 'Messages API 모양 · 글 · 사진(base64 JPG · PNG 한 장) 조각만 · 4개까지' }) @IsArray() messages!: unknown[];
}
export class ErpAgentRecordDto {
  @ApiProperty({ enum: ['RECEIPT'] }) @IsString() @IsIn(['RECEIPT']) kind!: string;
  @ApiProperty() @IsString() @MaxLength(80) model!: string;
  @ApiProperty() @IsInt() @Min(0) inTok!: number;
  @ApiProperty() @IsInt() @Min(0) outTok!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) cacheRead?: number;
}
export class ErpBizStatusDto {
  @ApiProperty({ example: '1048100001', description: '사업자등록번호 10자리(- 는 빼고 봄)' }) @IsString() @Matches(/^[0-9-]{10,12}$/) bizRegNo!: string;
}
export class ErpMailDto {
  @ApiProperty({ example: 'billing@example.com', description: '받는 주소 하나' }) @IsString() @MaxLength(254) to!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @MinLength(1) @MaxLength(200) subject!: string;
  @ApiProperty({ maxLength: 20000 }) @IsString() @MinLength(1) @MaxLength(20000) text!: string;
  @ApiPropertyOptional({ description: '받지만 쓰지 않음(소개뱅크 SMTP 는 글만)' }) @IsOptional() @IsString() @MaxLength(100000) html?: string;
}
export class ErpEtaxSendDto {
  @ApiProperty({ enum: ERP_ETAX_SLUGS }) @IsString() @IsIn(ERP_ETAX_SLUGS) slug!: string;
  @ApiProperty({ format: 'uuid' }) @IsString() @Matches(UUID_RE) id!: string;
  @ApiProperty({ enum: ['send', 'resend'] }) @IsIn(['send', 'resend']) mode!: 'send' | 'resend';
  @ApiPropertyOptional({ format: 'uuid', description: '누른 운영자(감사 기록용)' }) @IsOptional() @IsString() @Matches(UUID_RE) actorId?: string;
}
export class ErpTaxTypeDto {
  @ApiProperty({ example: 'P-0001' }) @IsString() @Matches(/^[A-Za-z0-9_-]{1,40}$/) code!: string;
  @ApiProperty({ enum: ['TAXABLE', 'EXEMPT'] }) @IsIn(['TAXABLE', 'EXEMPT']) taxType!: string;
  @ApiProperty({ description: '사유(2 ~ 200자)' }) @IsString() @MaxLength(400) reason!: string;
  @ApiPropertyOptional({ format: 'uuid', description: '고른 운영자(감사 기록용)' }) @IsOptional() @IsString() @Matches(UUID_RE) actorId?: string;
}
export class ErpBankFetchDto {
  @ApiProperty({ enum: ['ASSUME', 'LIVE'] }) @IsIn(['ASSUME', 'LIVE']) mode!: 'ASSUME' | 'LIVE';
  @ApiProperty({ type: Object, description: '{ id, label, bankStd, last4, fintech } — fintech 는 ERP 가 풀어 넘김(응답 · 기록에 싣지 않음)' }) @IsObject() account!: Record<string, unknown>;
  @ApiProperty({ example: '2026-11-24' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) from!: string;
  @ApiProperty({ example: '2026-11-26' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) to!: string;
}
export class ErpTaxInboxFetchDto {
  @ApiProperty({ enum: ['ASSUME', 'LIVE'] }) @IsIn(['ASSUME', 'LIVE']) mode!: 'ASSUME' | 'LIVE';
  @ApiPropertyOptional({ enum: ['GENERIC', 'POPBILL', 'BAROBILL'] }) @IsOptional() @IsIn(['GENERIC', 'POPBILL', 'BAROBILL']) provider?: string;
  @ApiProperty({ example: '2026-11-20' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) from!: string;
  @ApiProperty({ example: '2026-11-26' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) to!: string;
}

@Injectable()
export class ErpLinkMoreService {
  constructor(readonly db: DatabaseService, readonly agent: AgentService, readonly mail: MailService, readonly etax: EtaxService) {}
}

@ApiTags('INTERNAL')
@Controller('api/v1/internal/erp')
@UseGuards(ErpLinkGuard)
@ApiHeader({ name: 'X-Erp-Service-Token', required: true, description: 'ERP 서비스 토큰(설정 erp.service_token_hash 와 맞춤)' })
@ApiResponse({ status: 403, description: 'ERP_TOKEN_UNSET · ERP_TOKEN_INVALID', type: ErrorDto })
export class ErpLinkMoreController {
  constructor(private readonly svc: ErpLinkMoreService) {}

  @Post('export/consume')
  @HttpCode(200)
  @ApiOperation({ summary: '내려받기 승인 썼음 (ERP · 내부)', description: 'v10.801 (docs/917) — ERP 내려받기 성공 뒤 · 요청자 · 대상 · 승인 · 24시간 · 안 씀을 한 번에 보고 used_at · 대상은 ERP 업무만 · 감사 ERP_EXPORT_CONSUME' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'EXPORT_TICKET_USED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'EXPORT_NEED_APPROVAL · EXPORT_TARGET', type: ErrorDto })
  consume(@Body() dto: ErpExportConsumeDto) { return exportConsume(this.svc.db, dto); }

  @Post('agent/allowed')
  @HttpCode(200)
  @ApiOperation({ summary: 'AI 부를 수 있나 (ERP · 내부)', description: 'v10.801 — fn_agent_allowed(스위치 · 월 상한) · 통로는 RECEIPT 만' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, description: 'ERP_AGENT_KIND', type: ErrorDto })
  allowed(@Body() dto: ErpAgentKindDto) { return agentAllowed(this.svc.agent, dto.kind); }

  @Get('agent/provider')
  @ApiOperation({ summary: 'AI 엔진 이름 (ERP · 내부)', description: 'v10.801 — MOCK · CLAUDE · 없으면 null(키 값은 내보내지 않음)' })
  @ApiOkResponse({ type: Object })
  provider() { return agentProvider(this.svc.agent); }

  @Post('agent/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'AI 한 번 부르기 (ERP · 내부)', description: 'v10.801 — 영수증 읽기(RECEIPT) · 스위치 · 월 상한을 다시 봄 · 글 · 사진 한 장만 · 본문 8MB 까지 · 사용량은 여기서 쌓음 · 하루 500번' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'ERP_AGENT_BLOCKED · ERP_AGENT_NO_KEY', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'ERP_AGENT_INPUT · ERP_DAILY_LIMIT', type: ErrorDto })
  @ApiResponse({ status: 502, description: 'ERP_AGENT_FAILED', type: ErrorDto })
  complete(@Body() dto: ErpAgentCompleteDto) { return agentComplete(this.svc.agent, dto); }

  @Post('agent/record')
  @HttpCode(200)
  @ApiOperation({ summary: 'AI 사용량 알림 (ERP · 내부)', description: 'v10.801 — complete 가 이미 쌓으므로 받기만(recorded=false · 두 번 세지 않음)' })
  @ApiOkResponse({ type: Object })
  record(@Body() dto: ErpAgentRecordDto) { return agentRecord(dto); }

  @Get('files/:id/content')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'purpose', required: true, enum: ['ACCT_EVIDENCE'] })
  @ApiOperation({ summary: '올린 파일 몸통 (ERP · 내부)', description: 'v10.801 — 확인을 마친(READY) 회계 증빙(ACCT_EVIDENCE)만 · 바이트 그대로 · 없으면 404' })
  @ApiOkResponse({ description: '파일 바이트' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  async file(@Param('id') id: string, @Query('purpose') purpose: string, @Res() res: Response) {
    sendImage(res, await fileContent(this.svc.db, id, purpose));
  }

  @Post('biz-status')
  @HttpCode(200)
  @ApiOperation({ summary: '사업자 휴폐업 조회 (ERP · 내부)', description: 'v10.801 — 국세청(키 없으면 간주 stub) · 10자리 · 하루 2,000번' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, description: 'ERP_BIZ_NO · ERP_DAILY_LIMIT', type: ErrorDto })
  biz(@Body() dto: ErpBizStatusDto) { return bizStatus(dto.bizRegNo); }

  @Get('mail/ready')
  @ApiOperation({ summary: '메일 보낼 수 있나 (ERP · 내부)', description: 'v10.801 — MailService.ready(설정 · notify.email_verified)' })
  @ApiOkResponse({ type: Object })
  ready() { return mailReady(this.svc.mail); }

  @Post('mail')
  @HttpCode(200)
  @ApiOperation({ summary: '메일 한 통 (ERP · 내부)', description: 'v10.801 — 받는 주소 하나 · 준비 안 됨이면 보내지 않고 ok=false NOT_READY · 글만(html 은 쓰지 않음) · 하루 200통 · 감사 ERP_MAIL_SEND(주소는 가림)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, description: 'ERP_MAIL_TO · ERP_MAIL_SUBJECT · ERP_DAILY_LIMIT', type: ErrorDto })
  mail(@Body() dto: ErpMailDto) { return mailSend(this.svc.db, this.svc.mail, dto); }

  @Post('etax/send')
  @HttpCode(200)
  @ApiOperation({ summary: '세금계산서 전송 (ERP · 내부)', description: 'v10.801 — EtaxService.send 그대로(간주 · 업체 · 중복 발행 막기) · acct_tax_invoices 4종만 · 감사 ERP_ETAX_SEND · E7 에 바뀜(docs/917)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'ETAX_MANUAL · ETAX_ALREADY_SENT · ETAX_IN_FLIGHT · ETAX_CONFLICT …', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'ETAX_NOT_CONFIGURED · ETAX_PERSON_BUYER · EXEMPT_OFF', type: ErrorDto })
  etax(@Body() dto: ErpEtaxSendDto) { return etaxSend(this.svc.db, this.svc.etax, dto); }

  @Post('products/tax-type')
  @HttpCode(200)
  @ApiOperation({ summary: '직판 상품 과세 · 면세 (ERP · 내부)', description: 'v10.801 — 회계 setTaxType 와 같은 SQL(직판 상품만 · 다음 주문부터) · 사유 · 감사 PRODUCT_TAX_TYPE(역할 ERP_SERVICE)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — 없거나 직판 상품이 아님', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'ACCT_REASON', type: ErrorDto })
  taxType(@Body() dto: ErpTaxTypeDto) { return productTaxType(this.svc.db, dto); }

  @Post('bank/fetch')
  @HttpCode(200)
  @ApiOperation({ summary: '은행 거래내역 조회 대신 하기 (ERP · 내부)', description: 'v10.801 — 금융결제원 거래내역조회(간주 · LIVE) 결과 줄만 · 들여오기 · 기록은 ERP · 하루 200번' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, description: 'ERP_RANGE · ERP_BANK_ACCOUNT · BANK_FEED_NOT_READY · ERP_DAILY_LIMIT', type: ErrorDto })
  bank(@Body() dto: ErpBankFetchDto) { return bankFetch(this.svc.db, dto); }

  @Post('taxinbox/fetch')
  @HttpCode(200)
  @ApiOperation({ summary: '매입 세금계산서 가져오기 대신 하기 (ERP · 내부)', description: 'v10.801 — 연동 업체(간주 · LIVE) 결과 줄만 · 쌓기는 ERP · 하루 100번' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, description: 'ERP_RANGE · TAXINBOX_NOT_READY · ERP_DAILY_LIMIT', type: ErrorDto })
  taxinbox(@Body() dto: ErpTaxInboxFetchDto) { return taxInboxFetch(dto); }

  @Post('transfer/send')
  @HttpCode(200)
  @ApiOperation({ summary: '대량 이체 (ERP · 내부 · 아직 안 됨)', description: 'v10.801 — 501 ERP_TRANSFER_NOT_PROXIED · 두 사람 승인 · 거래고유번호 · PENDING 규칙이 묶음 표와 붙어 있어 설계만(docs/917 4절)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 501, description: 'ERP_TRANSFER_NOT_PROXIED', type: ErrorDto })
  transfer() { return transferSend(); }
}
