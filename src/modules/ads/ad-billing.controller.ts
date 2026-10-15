import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty,
  ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { AdBillingService } from './ad-billing.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

export class AdvertiserCreateDto {
  @ApiProperty({ description: '광고주 코드. 예) ADV-001' }) @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiPropertyOptional({ description: '사업자등록번호 000-00-00000' })
  @IsOptional() @IsString() bizRegNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ceoName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactEmail?: string;
  @ApiPropertyOptional({ description: '메모' }) @IsOptional() @IsString() memo?: string;
}

export class InvoiceCreateDto {
  @ApiProperty({ format: 'uuid' }) @IsString() advertiserId!: string;
  @ApiPropertyOptional({ format: 'uuid', description: '연결할 예약' })
  @IsOptional() @IsString() bookingId?: string;
  @ApiProperty({ description: '기간 시작 (YYYY-MM-DD)' }) @IsString() periodFrom!: string;
  @ApiProperty({ description: '기간 끝' }) @IsString() periodTo!: string;
  @ApiProperty({ description: '공급가' }) @IsInt() @Min(1) amount!: number;
  @ApiPropertyOptional({ description: '부가세. 비우면 공급가의 10%' })
  @IsOptional() @IsInt() @Min(0) vat?: number;
  @ApiProperty({ description: '납기일' }) @IsString() dueDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() memo?: string;
}

export class PaymentCreateDto {
  @ApiProperty({ description: '입금액' }) @IsInt() @Min(1) amount!: number;
  @ApiPropertyOptional({ enum: ['TRANSFER', 'CARD', 'OFFSET'] })
  @IsOptional() @IsIn(['TRANSFER', 'CARD', 'OFFSET']) method?: string;
  @ApiPropertyOptional({ description: '입금자명. 상호와 다르면 적어 두십시오' })
  @IsOptional() @IsString() payerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() memo?: string;
}

export class AdvertiserDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'ACTIVE · PAUSED · BLOCKED' }) status!: string;
  @ApiPropertyOptional({ description: '청구 합계' }) billed?: number;
  @ApiPropertyOptional({ description: '수금 합계' }) collected?: number;
  @ApiPropertyOptional({ description: '미수금' }) unpaid?: number;
}

export class InvoiceDto {
  @ApiProperty() id!: string;
  @ApiProperty() invoiceNo!: string;
  @ApiProperty() total!: number;
  @ApiPropertyOptional() paid?: number;
  @ApiProperty({ description: 'ISSUED · PARTIAL · PAID · OVERDUE · VOID' }) status!: string;
  @ApiProperty() dueDate!: string;
}

/**
 * 광고 과금 · 정산.
 *
 * ── 왜 본체에 두나 ──────────────────────────────────────────────────
 * 광고를 분리하지 않기로 했습니다. 관리자 기능 · 백오피스 · 결제 ·
 * 정산을 **본체 안에서 끝냅니다.**
 *
 * ── 소개비와 섞지 않습니다 ──────────────────────────────────────────
 * 광고비는 **우리가 받는 돈**이고, 소개비는 **당사자끼리 주고받는
 * 돈**입니다(INV-9R · INV-11). 정산 표를 같이 쓰면 언젠가 섞입니다.
 */
@ApiTags('AD-BILLING')
@Controller('api/v1/admin')
export class AdBillingController {
  constructor(private readonly svc: AdBillingService) {}

  /* ── 광고주 ────────────────────────────────────────────────────── */

  @Get('advertisers')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: '광고주 목록',
    description: '청구 · 수금 · 미수금이 함께 옵니다.',
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiOkResponse({ type: AdvertiserDto, isArray: true })
  advertisers(@Query('status') status?: string) { return this.svc.advertisers(status); }

  @Post('advertisers')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: '광고주 등록',
    description:
      '**회원 계정과 별개입니다** — 대행사가 여러 광고주를 대신 집행하는 ' +
      '경우가 있어, 계정 하나에 광고주 여럿이 붙을 수 있습니다.',
  })
  @ApiResponse({ status: 422, description: '사업자번호 형식 등', type: ErrorDto })
  @ApiOkResponse({ type: AdvertiserDto })
  @Audit('ADVERTISER_CREATE', 'ADVERTISER')
  createAdvertiser(@Body() dto: AdvertiserCreateDto) { return this.svc.createAdvertiser(dto); }

  @Patch('advertisers/:id/status')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: '광고주 상태 변경',
    description: 'BLOCKED 로 바꾸면 **나가고 있는 광고도 함께 멈춥니다.**',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdvertiserDto })
  @Audit('ADVERTISER_STATUS', 'ADVERTISER')
  setStatus(@Param('id') id: string, @Body() dto: { status: string }) {
    return this.svc.setAdvertiserStatus(id, dto.status);
  }

  /* ── 청구 ──────────────────────────────────────────────────────── */

  @Get('ad-invoices')
  @ApiBearerAuth()
  /* ★ 원장은 **둘 다** 봅니다 — 지급하는 사람도 얼마를 보내는지
   *   알아야 하고, 승인하는 사람도 결과를 봐야 합니다. */
  @Roles('ADMIN', 'PAYOUT')
  @ApiOperation({ summary: '청구 목록' })
  @ApiQuery({ name: 'status', required: false })
  @ApiOkResponse({ type: InvoiceDto, isArray: true })
  invoices(@Query('status') status?: string) { return this.svc.invoices(status); }

  @Post('ad-invoices')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: '청구 발행',
    description:
      '청구번호는 **서버가 만듭니다** — 앱이 만들면 동시에 발행할 때 겹칩니다.\\n\\n' +
      '부가세를 비우면 공급가의 10% 로 계산합니다.',
  })
  @ApiResponse({ status: 422, description: 'ADINV · 합계 불일치 등', type: ErrorDto })
  @ApiOkResponse({ type: InvoiceDto })
  @Audit('AD_INVOICE_CREATE', 'AD_INVOICE')
  createInvoice(@Body() dto: InvoiceCreateDto) { return this.svc.createInvoice(dto); }

  @Post('ad-invoices/:id/payments')
  @ApiBearerAuth()
  /* ★ 돈이 움직인 기록은 **지급 전담(PAYOUT)만** 남깁니다.
   *
   *   청구를 발행한 사람이 입금까지 찍으면, 실제로 안 들어온 돈을
   *   들어온 것으로 만들 수 있습니다. 두 사람이 나눠야 사고가 나도
   *   어느 쪽인지 가릅니다. */
  @Roles('PAYOUT')
  @ApiOperation({
    summary: '입금 기록',
    description:
      '부분 입금도 받습니다. 합계가 청구액에 닿으면 **자동으로 완납**이 ' +
      '됩니다 — 사람이 바꾸게 하면 빠뜨립니다.\\n\\n' +
      '**기록은 고치거나 지울 수 없습니다.** 잘못 넣으셨으면 반대 기록을 남기십시오.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 422, description: 'ADINV · 초과 입금 등', type: ErrorDto })
  @ApiOkResponse({ type: InvoiceDto })
  @Audit('AD_PAYMENT_RECORD', 'AD_INVOICE')
  recordPayment(@Param('id') id: string, @Body() dto: PaymentCreateDto) {
    return this.svc.recordPayment(id, dto);
  }

  /* ── 정산 · 미수 ───────────────────────────────────────────────── */

  @Get('ad-receivables')
  @ApiBearerAuth()
  /* ★ 원장은 **둘 다** 봅니다 — 지급하는 사람도 얼마를 보내는지
   *   알아야 하고, 승인하는 사람도 결과를 봐야 합니다. */
  @Roles('ADMIN', 'PAYOUT')
  @ApiOperation({
    summary: '미수금',
    description:
      '**오래된 것이 위로 옵니다.** 연체가 쌓이면 광고를 멈추십시오 — ' +
      '받지 못한 채 노출만 계속하면 손해가 커집니다.',
  })
  @ApiOkResponse({ type: InvoiceDto, isArray: true })
  receivables() { return this.svc.receivables(); }

  @Get('ad-settlement')
  @ApiBearerAuth()
  /* ★ 원장은 **둘 다** 봅니다 — 지급하는 사람도 얼마를 보내는지
   *   알아야 하고, 승인하는 사람도 결과를 봐야 합니다. */
  @Roles('ADMIN', 'PAYOUT')
  @ApiOkResponse({ type: Object })
  @ApiOperation({
    summary: '광고 정산 요약',
    description:
      '이번 달 청구 · 수금 · 미수와 **연체인데 아직 나가는 광고**를 봅니다.',
  })
  settlement() { return this.svc.settlement(); }
}
