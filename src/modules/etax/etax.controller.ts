import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { EtaxService } from './etax.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

export class EtaxInvoiceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['DIRECTORY', 'LEAD_CASH'] }) kind!: string;
  @ApiProperty({ enum: ['REQUESTED', 'ISSUED', 'CANCELED'] }) state!: string;
  @ApiPropertyOptional({ description: '발행 번호 — 업체 전송이면 승인번호(8-8-8) · 간주면 「간주-문서번호」 · 손으로 넣은 번호' }) invoiceNo?: string;
  @ApiPropertyOptional() issuedOn?: string;
  @ApiPropertyOptional({ enum: ['MANUAL', 'ASSUMED', 'ASP'], description: '발행 방식 — MANUAL 손으로(연동 전 임시) · ASSUMED 간주 · ASP 업체 전송' }) etaxMode?: string;
  @ApiPropertyOptional({ enum: ['ASSUMED', 'SENDING', 'SENT', 'FAILED', 'CANCELED'] }) etaxStatus?: string;
  @ApiProperty({ description: '간주 발행(국세청 전송 없음 · 승인번호 없음)' }) assumed!: boolean;
  @ApiPropertyOptional({ example: '20261011-41000000-00000001', description: '국세청 승인번호(8-8-8) — 간주면 없음' }) approvalNo?: string;
  @ApiPropertyOptional() amendApprovalNo?: string;
  @ApiPropertyOptional({ example: 'SGB-D-261011-0123456789', description: '우리 쪽 문서 번호(업체 관리 번호 · 다시 보내도 같음)' }) docKey?: string;
  @ApiPropertyOptional({ description: '마지막 실패 사유' }) etaxError?: string;
  @ApiProperty() attempts!: number;
  @ApiPropertyOptional({ enum: ['assume', 'http'] }) adapter?: string;
  @ApiPropertyOptional() sentAt?: string;
  @ApiPropertyOptional() resultAt?: string;
  @ApiPropertyOptional() note?: string;
}
export class EtaxStatusDto {
  @ApiProperty({ description: '설정 assume.etax = on(간주 · 국세청 전송 없음)' }) assume!: boolean;
  @ApiPropertyOptional({ enum: ['assume', 'http'], description: '지금 「발행」이 쓰는 어댑터 — 없음이면 발행이 거부됨' }) adapter?: string;
  @ApiProperty({ description: 'ETAX_URL · ETAX_KEY 가 모두 있음' }) configured!: boolean;
  @ApiPropertyOptional({ description: '업체 주소의 호스트만' }) urlHost?: string;
  @ApiProperty({ example: 'ETAX_KEY', description: '키 이름 — **값은 싣지 않습니다**' }) keyName!: string;
  @ApiProperty({ description: '키가 환경 변수에 있는지(값은 가림)' }) keySet!: boolean;
  @ApiPropertyOptional({ description: 'integrations ETAX 줄(상태 · 업체 · 오픈 차단)' }) integration?: Record<string, unknown>;
  @ApiProperty({ description: '종류별 · 상태별 건수', example: [{ kind: 'DIRECTORY', status: 'ASSUMED', n: 1 }] }) counts!: Array<{ kind: string; status: string; n: number }>;
  @ApiProperty() note!: string;
}
export class EtaxCancelDto {
  @ApiProperty({ example: '공급받는 자 사업자번호 오기 — 수정 발행', description: '5자 이상' }) @IsString() @MinLength(5) @MaxLength(200) reason!: string;
}

/**
 * v10.34 (D093) 국세청 전자세금계산서 전송 — 운영(ADMIN · SUPER)만.
 * 대상: directory(법률 · 세무 정액 노출료 · consult_directory_invoices) · lead-cash(리드 이용료 · lead_cash_invoices).
 * 소개자가 발행하는 정산 세금계산서는 대상이 아닙니다.
 */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/etax')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class EtaxAdminController {
  constructor(private readonly svc: EtaxService) {}

  @Get('status')
  @ApiOperation({ summary: '전자세금계산서 연동 상태', description: '간주 모드 · 어댑터 · 키 등록 여부(값은 가림) · 종류별 전송 상태 건수.' })
  @ApiOkResponse({ type: EtaxStatusDto })
  status() { return this.svc.status(); }

  @Post(':kind/:id/send')
  @HttpCode(200)
  @ApiOperation({ summary: '발행(국세청 전송)', description: 'assume.etax on → 「간주 발행」(승인번호 없음). off → 업체 어댑터로 전송 → SENT(승인번호) · SENDING(승인 대기) · FAILED(사유 · 「다시 보내기」). 실패도 200 으로 결과를 돌려주고 줄에 기록합니다.' })
  @ApiParam({ name: 'kind', enum: ['directory', 'lead-cash'] })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EtaxInvoiceDto })
  @ApiResponse({ status: 409, description: 'ETAX_MANUAL · ETAX_ALREADY_SENT · ETAX_ALREADY_ASSUMED · ETAX_IN_FLIGHT · ETAX_USE_RESEND · ETAX_CONFLICT · NOT_REQUESTED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'ETAX_NOT_CONFIGURED(간주를 껐는데 ETAX_URL · ETAX_KEY 없음) · ETAX_SUPPLIER', type: ErrorDto })
  @Audit('ETAX_SEND', 'INVOICE')
  send(@Param('kind') kind: string, @Param('id') id: string) { return this.svc.send(kind, id, 'send'); }

  @Post(':kind/:id/resend')
  @HttpCode(200)
  @ApiOperation({ summary: '다시 보내기', description: '실패한 줄 · 간주 발행 줄(연동 뒤 실제 전송). 업체에 보낸 적이 있으면 먼저 상태를 조회해 이미 발행된 문서를 두 번 발행하지 않습니다(같은 문서 번호).' })
  @ApiParam({ name: 'kind', enum: ['directory', 'lead-cash'] })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EtaxInvoiceDto })
  @ApiResponse({ status: 409, description: 'ETAX_NOT_SENT · ETAX_STILL_ASSUMED · ETAX_ALREADY_SENT · ETAX_IN_FLIGHT · ETAX_MANUAL · ETAX_CONFLICT', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'ETAX_NOT_CONFIGURED', type: ErrorDto })
  @Audit('ETAX_RESEND', 'INVOICE')
  resend(@Param('kind') kind: string, @Param('id') id: string) { return this.svc.send(kind, id, 'resend'); }

  @Post(':kind/:id/refresh')
  @HttpCode(200)
  @ApiOperation({ summary: '상태 조회', description: '보내는 중(승인 대기) · 업체에 보낸 뒤 실패로 남은 줄 — 업체에 물어 승인번호 · 결과를 기록합니다.' })
  @ApiParam({ name: 'kind', enum: ['directory', 'lead-cash'] })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EtaxInvoiceDto })
  @ApiResponse({ status: 409, description: 'ETAX_NOTHING_TO_CHECK', type: ErrorDto })
  @Audit('ETAX_REFRESH', 'INVOICE')
  refresh(@Param('kind') kind: string, @Param('id') id: string) { return this.svc.refresh(kind, id); }

  @Post(':kind/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: '취소 · 수정 발행', description: '국세청에 보낸(SENT) 줄만 — 업체 어댑터로 취소(전송 전) 또는 수정세금계산서(전송 뒤).' })
  @ApiParam({ name: 'kind', enum: ['directory', 'lead-cash'] })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EtaxInvoiceDto })
  @ApiResponse({ status: 409, description: 'ETAX_NOT_SENT', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'ETAX_REASON · ETAX_CANCEL_FAILED · ETAX_NOT_CONFIGURED', type: ErrorDto })
  @Audit('ETAX_CANCEL', 'INVOICE')
  cancel(@Param('kind') kind: string, @Param('id') id: string, @Body() dto: EtaxCancelDto) { return this.svc.cancel(kind, id, dto.reason); }
}
