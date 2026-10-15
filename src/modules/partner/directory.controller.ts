import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty,
         ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { DirectoryService } from './directory.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

export class DirectoryEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '법무법인 한빛' }) displayName!: string;
  @ApiPropertyOptional() intro?: string;
  @ApiProperty({ example: '02-1234-5678' }) contactPhone!: string;
  @ApiPropertyOptional({ example: 'https://example.com' }) websiteUrl?: string;
  @ApiProperty({ example: '서울특별시' }) sido!: string;
}
export class DirectoryListDto {
  @ApiProperty({ example: { code: 'CSL_LEGAL', name: '법률(변호사·법무사)' } }) category!: { code: string; name: string };
  @ApiProperty({ example: '광고' }) adLabel!: string;
  @ApiProperty() note!: string;
  @ApiProperty({ type: DirectoryEntryDto, isArray: true }) entries!: DirectoryEntryDto[];
}
export class DirectoryMineDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'CSL_LEGAL' }) categoryCode!: string;
  @ApiProperty({ example: '법률(변호사·법무사)' }) categoryName!: string;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional() intro?: string;
  @ApiProperty() contactPhone!: string;
  @ApiPropertyOptional() websiteUrl?: string;
  @ApiProperty() sido!: string;
  @ApiProperty({ enum: ['PENDING', 'ACTIVE', 'RENEW_REQUESTED', 'ENDED', 'REJECTED'], description: 'v10.33 RENEW_REQUESTED = 연장 신청 중(노출 계속)' }) state!: string;
  @ApiPropertyOptional({ description: '월 정액 노출료(원 · 공급가액 · 부가세 별도)' }) monthlyFee?: number;
  @ApiPropertyOptional() paidFrom?: string;
  @ApiPropertyOptional() paidTo?: string;
  @ApiPropertyOptional({ description: '반려 · 종료 사유' }) reason?: string;
  /* v10.33 — 최근 입금 확인의 개월수 · 공급가액 · 부가세(10% · 1원 미만 절사) · 합계 */
  @ApiPropertyOptional({ example: 1 }) months?: number;
  @ApiPropertyOptional({ example: 300000 }) supplyAmount?: number;
  @ApiPropertyOptional({ example: 30000 }) vatAmount?: number;
  @ApiPropertyOptional({ example: 330000 }) totalAmount?: number;
  @ApiPropertyOptional({ description: '노출 회차 수(처음 + 연장)' }) rounds?: number;
  @ApiPropertyOptional({ description: '열린 연장 신청 — 개월수 · 금액(신청 때 기준 금액) · 이어질 기간', nullable: true })
  renewal?: { id: string; months: number; monthlyFee: number; supplyAmount: number; vatAmount: number; totalAmount: number; from: string; to: string } | null;
  @ApiPropertyOptional({ description: '마지막으로 처리된 연장 신청(반려 사유 등)', nullable: true }) lastRenewal?: unknown;
}
export class DirectoryRenewDto {
  @ApiProperty({ example: 3, description: '연장할 개월수(1~12). 금액 = 지금 기준 금액 × 개월수 + 부가세 10%' })
  @IsInt() @Min(1) @Max(12) months!: number;
}
export class DirectoryRenewConfirmDto {
  @ApiProperty({ example: '입금자 한빛법무 · 2026-11-01 국민 123-45 · 990,000원' }) @IsString() @IsNotEmpty() @MaxLength(200) paymentRef!: string;
}
export class DirectoryInvoiceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['REQUESTED', 'ISSUED'] }) state!: string;
  @ApiProperty({ example: 300000 }) supply!: number;
  @ApiProperty({ example: 30000 }) vat!: number;
  @ApiProperty({ example: 330000 }) total!: number;
  @ApiPropertyOptional() invoiceNo?: string;
  @ApiPropertyOptional() issuedOn?: string;
  @ApiProperty({ example: '(주)한국바이오헬스케어 소개뱅크 사업부' }) supplierName!: string;
  @ApiProperty() supplierBizNo!: string;
  @ApiProperty() buyerName!: string;
  @ApiProperty() buyerBizNo!: string;
  @ApiProperty({ description: '회차' }) seq!: number;
  @ApiProperty({ enum: ['INITIAL', 'RENEWAL'] }) kind!: string;
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  /* v10.34 (D093) 국세청 전자세금계산서 전송 */
  @ApiPropertyOptional({ enum: ['MANUAL', 'ASSUMED', 'ASP'], description: 'v10.34 발행 방식 — MANUAL 손으로(연동 전 임시) · ASSUMED 간주 · ASP 업체 전송' }) etaxMode?: string;
  @ApiPropertyOptional({ enum: ['ASSUMED', 'SENDING', 'SENT', 'FAILED', 'CANCELED'], description: 'v10.34 국세청 전송 상태' }) etaxStatus?: string;
  @ApiPropertyOptional({ description: 'v10.34 간주 발행(국세청 전송 없음 · 승인번호 없음) — 업체 화면에는 「전송 대기 — 연동 전」' }) assumed?: boolean;
  @ApiPropertyOptional({ example: '20261011-41000000-00000001', description: 'v10.34 국세청 승인번호(8-8-8) — 간주면 없음' }) approvalNo?: string;
  @ApiPropertyOptional({ description: 'v10.34 우리 쪽 문서 번호(운영 화면만)' }) docKey?: string;
  @ApiPropertyOptional({ description: 'v10.34 마지막 전송 실패 사유(운영 화면만)' }) etaxError?: string;
  @ApiPropertyOptional({ description: 'v10.34 전송 시도 수(운영 화면만)' }) attempts?: number;
}
export class DirectoryInvoiceIssueDto {
  @ApiProperty({ example: '20261101-41000000-00000001' }) @IsString() @IsNotEmpty() @MaxLength(60) invoiceNo!: string;
  @ApiProperty({ example: '2026-11-01' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) issuedOn!: string;
}
export class DirectoryApplyDto {
  @ApiProperty({ enum: ['CSL_LEGAL', 'CSL_TAX'] }) @IsIn(['CSL_LEGAL', 'CSL_TAX']) categoryCode!: string;
  @ApiProperty({ example: '법무법인 한빛' }) @IsString() @IsNotEmpty() @MaxLength(60) displayName!: string;
  @ApiPropertyOptional({ description: '500자 이내 — 승소율 · 결과 보장 같은 표현은 쓰지 마십시오' })
  @IsOptional() @IsString() @MaxLength(500) intro?: string;
  @ApiProperty({ example: '02-1234-5678', description: '사무소 대표번호 — 화면에 공개됩니다' })
  @IsString() @Matches(/^[0-9-]{8,14}$/) contactPhone!: string;
  @ApiPropertyOptional({ example: 'https://example.com' }) @IsOptional() @IsString() @Matches(/^https:\/\//) websiteUrl?: string;
  @ApiProperty({ example: '서울특별시' }) @IsString() @IsNotEmpty() @MaxLength(20) sido!: string;
}
export class DirectoryActivateDto {
  @ApiPropertyOptional({ example: 300000, description: '월 정액 노출료(원 · 공급가액 · 부가세 별도). 비우면 기준 금액(설정 directory.monthly_fee — D020). 건수 · 성사와 무관합니다' })
  @IsOptional() @IsNumber() @Min(1) monthlyFee?: number;
  @ApiProperty({ example: '2026-10-01' }) @IsDateString() paidFrom!: string;
  /* v10.33 — 기간은 개월 단위. 종료일은 계산합니다(보내면 개월수와 맞아야 함) */
  @ApiPropertyOptional({ example: 1, description: 'v10.33 개월수(1~12 · 기본 1). 합계 = 월 노출료 × 개월수 + 부가세 10%' })
  @IsOptional() @IsInt() @Min(1) @Max(12) months?: number;
  @ApiPropertyOptional({ example: '2026-10-31', description: '옛 화면 호환 — 보내면 시작일 + 개월수의 마지막 날과 같아야 합니다' })
  @IsOptional() @IsDateString() paidTo?: string;
  @ApiProperty({ example: '입금자 한빛법무 · 2026-10-01 국민 123-45' }) @IsString() @IsNotEmpty() @MaxLength(200) paymentRef!: string;
}
export class DirectoryCloseDto {
  @ApiProperty({ description: '5자 이상. 업체에게 그대로 보입니다' }) @IsString() @MaxLength(500) reason!: string;
}

/** SB-MAL-CSL-030 법률 · 세무 사무소 보기(월 정액 노출형 · D019 — 올린 kit 의 D009). 상담 신청과 같은 주소(/mal/consult/{code})라 한 화면으로 등록했습니다 */
@ApiTags('MAL')
@Controller('api/v1/consult/directory')
export class DirectoryController {
  constructor(private readonly svc: DirectoryService) {}

  @Get(':code')
  @ApiOperation({ summary: '정액 노출 업체 목록', description: '리드를 만들지 않습니다. 「광고」 표시와 함께, 날마다 섞인 순서로 내립니다.' })
  @ApiParam({ name: 'code', example: 'CSL_LEGAL' })
  @ApiOkResponse({ type: DirectoryListDto })
  @ApiResponse({ status: 404, description: '정액 노출형 업종이 아님', type: ErrorDto })
  list(@Param('code') code: string) { return this.svc.publicList(code); }
}

/** SB-PTC-LST-010 내 매물 · 입점 상태 — 정액 노출 신청(안심소개 파트너센터 · D019) */
@ApiTags('PTC')
@ApiBearerAuth()
@Controller('api/v1/partner/directory')
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
export class PartnerDirectoryController {
  constructor(private readonly svc: DirectoryService) {}

  @Get()
  @ApiOperation({ summary: '내 정액 노출 항목' })
  @ApiOkResponse({ type: DirectoryMineDto, isArray: true })
  mine() { return this.svc.mine(); }

  @Post()
  @ApiOperation({ summary: '정액 노출 신청 · 정보 수정', description: '반려 · 종료된 항목은 다시 심사로 갑니다.' })
  @ApiOkResponse({ type: DirectoryMineDto, isArray: true })
  @ApiResponse({ status: 422, description: 'PARTNER_REQUIRED · DIRECTORY_CATEGORY', type: ErrorDto })
  @Audit('DIRECTORY_APPLY', 'PARTNER')
  apply(@Body() dto: DirectoryApplyDto) { return this.svc.apply(dto); }

  /* v10.33 — 내 세금계산서 발행 내역(번호 · 일자 · 금액). ':id' 경로보다 먼저 둡니다 */
  @Get('invoices')
  @ApiOperation({ summary: '내 정액 노출료 세금계산서', description: '입금 확인(처음 · 연장)마다 1건. 공급자는 소개뱅크 운영 법인입니다. 발행 번호가 들어가면 「발행됨」.' })
  @ApiOkResponse({ type: DirectoryInvoiceDto, isArray: true })
  invoices() { return this.svc.myInvoices(); }

  @Post(':id/renew')
  @ApiOperation({ summary: '기간 연장 신청(A안)', description: '노출 중인 내 항목만. 노출은 계속되고, 운영이 입금(합계 = 기준 금액 × 개월수 + 부가세 10%)을 확인하면 기존 종료일 다음 날부터 이어집니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DirectoryMineDto, isArray: true })
  @ApiResponse({ status: 409, description: 'DIRECTORY_RENEW_OPEN · DIRECTORY_RENEW_STATE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'DIRECTORY_RENEW_LAPSED · DIRECTORY_FEE · PARTNER_REQUIRED', type: ErrorDto })
  @Audit('DIRECTORY_RENEW_REQUEST', 'PARTNER')
  renew(@Param('id') id: string, @Body() dto: DirectoryRenewDto) { return this.svc.renewRequest(id, dto.months); }
}

/** SB-ADM-PTN-080 입금 확인 — 정액 노출 기간 켜기 · 종료(D019) · v10.33 연장 입금 확인 · 반려 · 세금계산서 발행 */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/directory')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class DirectoryAdminController {
  constructor(private readonly svc: DirectoryService) {}

  @Get()
  @ApiOperation({ summary: '정액 노출 신청 · 노출 목록' })
  @ApiQuery({ name: 'state', required: false, enum: ['PENDING', 'ACTIVE', 'RENEW_REQUESTED', 'ENDED', 'REJECTED'] })
  list(@Query('state') state?: string) { return this.svc.admList(state); }

  /* v10.33 — 세금계산서 발행 요청(입금 확인마다 1건) · ':id' 경로보다 먼저 */
  @Get('invoices')
  @ApiOperation({ summary: '정액 노출료 세금계산서 발행 요청', description: '공급자 = 운영 법인(설정 footer.company_name · footer.biz_reg_no) · 공급받는 자 = 업체. 국세청 전송 연동 전 — 발행 번호를 넣습니다.' })
  @ApiQuery({ name: 'state', required: false, enum: ['REQUESTED', 'ISSUED'] })
  @ApiOkResponse({ type: DirectoryInvoiceDto, isArray: true })
  invoices(@Query('state') state?: string) { return this.svc.admInvoices(state); }

  @Post('invoices/:id/issue')
  @ApiOperation({ summary: '세금계산서 발행 표시(손으로 번호 · 연동 전 임시)', description: '발행 번호 · 발행일을 넣으면 「발행됨」(v10.34 etax_mode MANUAL — 간주 · 업체 전송과 구분). 한 번만 · 금액은 고칠 수 없습니다(DB). 국세청 전송을 시작한 줄은 409 ETAX_IN_PROGRESS.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'NOT_REQUESTED · INVOICE_NO_TAKEN · ETAX_IN_PROGRESS', type: ErrorDto })
  @Audit('DIRECTORY_INVOICE_ISSUE', 'PARTNER')
  issue(@Param('id') id: string, @Body() dto: DirectoryInvoiceIssueDto) { return this.svc.admIssueInvoice(id, dto); }

  @Get(':id/history')
  @ApiOperation({ summary: '회차 이력 · 연장 신청 이력 · 세금계산서 줄', description: '회차 이력은 지우거나 고칠 수 없습니다(DB).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  history(@Param('id') id: string) { return this.svc.admHistory(id); }

  @Post(':id/activate')
  @ApiOperation({ summary: '입금 확인 → 노출 기간 켜기(처음)', description: '자격 · 입점 승인이 없으면 DB 가 막습니다(DIRECTORY_QUALIFICATION · DIRECTORY_AXIS). 금액을 비우면 기준 금액(설정 directory.monthly_fee)으로 기록합니다. 기준 금액은 PATCH /admin/site-settings 로 바꿉니다. v10.33 — 부가세 별도: 합계 = 월 노출료 × 개월수 + 10% · 세금계산서 발행 요청 1줄. 노출 중인 항목의 연장은 연장 신청 → renew/confirm(409 NOT_ACTIVATABLE).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'NOT_ACTIVATABLE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'DIRECTORY_FEE · DIRECTORY_PAYMENT · DIRECTORY_PERIOD · DIRECTORY_PERIOD_OVERLAP · DIRECTORY_QUALIFICATION · DIRECTORY_AXIS', type: ErrorDto })
  @Audit('DIRECTORY_ACTIVATE', 'PARTNER')
  activate(@Param('id') id: string, @Body() dto: DirectoryActivateDto) { return this.svc.activate(id, dto); }

  @Post(':id/reject')
  @ApiOperation({ summary: '정액 노출 신청 반려' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @Audit('DIRECTORY_REJECT', 'PARTNER')
  reject(@Param('id') id: string, @Body() dto: DirectoryCloseDto) { return this.svc.close(id, 'REJECTED', dto.reason); }

  @Post(':id/end')
  @ApiOperation({ summary: '정액 노출 종료' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @Audit('DIRECTORY_END', 'PARTNER')
  end(@Param('id') id: string, @Body() dto: DirectoryCloseDto) { return this.svc.close(id, 'ENDED', dto.reason); }

  /* v10.33 기간 연장 A안 — 업체의 연장 신청을 입금 확인 · 반려 */
  @Post(':id/renew/confirm')
  @ApiOperation({ summary: '연장 입금 확인', description: '새 기간 = 기존 종료일 다음 날부터(겹침 · 빈 날은 DB 가 거부). 금액은 연장 신청 때의 기준 금액. 세금계산서 발행 요청 1줄 · 업체에 알림.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'DIRECTORY_RENEW_NONE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'DIRECTORY_PAYMENT · DIRECTORY_PERIOD_CHAIN · DIRECTORY_QUALIFICATION', type: ErrorDto })
  @Audit('DIRECTORY_RENEW_CONFIRM', 'PARTNER')
  renewConfirm(@Param('id') id: string, @Body() dto: DirectoryRenewConfirmDto) { return this.svc.renewConfirm(id, dto.paymentRef); }

  @Post(':id/renew/reject')
  @ApiOperation({ summary: '연장 신청 반려', description: '사유 5자 이상(업체에게 그대로 보임). 노출은 지금 기간까지 그대로입니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'DIRECTORY_RENEW_NONE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'DIRECTORY_REASON', type: ErrorDto })
  @Audit('DIRECTORY_RENEW_REJECT', 'PARTNER')
  renewReject(@Param('id') id: string, @Body() dto: DirectoryCloseDto) { return this.svc.renewReject(id, dto.reason); }
}
