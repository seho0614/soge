import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery,
         ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';   // v10.31 검정 — 참 · 거짓 입력은 받은 값 그대로(G-134 · "false" 글자가 true 로 바뀌지 않게)
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { ErrorDto } from '../../common/dto/common.dto';
import { LeadCashService } from './lead-cash.service';
import { PartnerCenterService } from './partner-center.service';
import { PartnerCenterAdminService } from './partner-center-admin.service';

/* ── DTO ─────────────────────────────────────────────────────────────── */
export class CashChargeDto {
  @ApiProperty({ example: 300000, description: '충전 금액(원). 최소 · 최대 · 유상 잔액 상한은 GET /partner/cash 의 limits' })
  @IsInt() @Min(1) amount!: number;
}
export class CashConfirmDto {
  @ApiProperty() @IsString() @Matches(/^lc-[A-Za-z0-9_-]{6,60}$/) orderId!: string;
  @ApiProperty({ description: '결제창이 돌려준 paymentKey. 결제사 키가 없는 개발 환경은 stub_… (서버도 스텁으로 승인)' })
  @IsString() @MaxLength(200) paymentKey!: string;
  @ApiProperty() @IsInt() @Min(1) amount!: number;
}
export class CashAutoDto {
  @ApiProperty() @StrictBoolean() on!: boolean;
  @ApiPropertyOptional({ example: 100000, description: '이 금액 미만이면' }) @IsOptional() @IsInt() @Min(1) below?: number;
  @ApiPropertyOptional({ example: 300000, description: '이 금액을 충전' }) @IsOptional() @IsInt() @Min(1) amount?: number;
}
export class CashRefundDto {
  @ApiProperty({ example: 100000 }) @IsInt() @Min(1) amount!: number;
  @ApiProperty({ example: '이번 분기 영업을 쉽니다' }) @IsString() @MinLength(2) @MaxLength(500) reason!: string;
}
export class MemoDto {
  @ApiProperty({ example: '오전 통화 · 견적 재요청' }) @IsString() @MinLength(1) @MaxLength(500) body!: string;
}
export class ServiceUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) body?: string;
  @ApiPropertyOptional({ description: '주요 타겟' }) @IsOptional() @IsString() @MaxLength(300) target?: string | null;
  @ApiPropertyOptional({ enum: ['QUOTE', 'CALL', 'VISIT', 'CHAT'] }) @IsOptional() @IsIn(['QUOTE', 'CALL', 'VISIT', 'CHAT']) receiveMode?: string | null;
  @ApiPropertyOptional({ description: '최고 확인비용(S) — 업종 기준 단가 이상 · 10만 원 이하' }) @IsOptional() @IsInt() @Min(1) @Max(100000) topFee?: number | null;
  @ApiPropertyOptional({ description: '성사 소개비율 0.05 ~ 0.12' }) @IsOptional() @IsNumber() @Min(0.05) @Max(0.12) referralRate?: number | null;
  @ApiPropertyOptional({ description: '재소개 보너스(건당 원)' }) @IsOptional() @IsInt() @Min(0) @Max(1000000) rebateBonus?: number | null;
}
export class BlockDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) body?: string | null;
  @ApiPropertyOptional({ description: 'PARTNER_MEDIA 로 올린 파일' }) @IsOptional() @IsString() fileId?: string | null;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() visible?: boolean;
}
export class MatrixDto {
  @ApiProperty({ example: [{ row: 'PACK', col: 'R3', amount: 1050000 }] }) @IsArray() cells!: Array<{ row: string; col: string; amount: number | null }>;
}
export class FulfillmentReportDto {
  @ApiProperty() @IsString() deliveryId!: string;
  @ApiProperty({ example: '이사 · 쓰리룸 · 송파' }) @IsString() @MinLength(2) @MaxLength(300) content!: string;
  @ApiProperty({ example: '2026-10-08' }) @IsString() doneOn!: string;
  @ApiPropertyOptional({ description: '거래액(원) — 선택' }) @IsOptional() @IsInt() @Min(1) amount?: number | null;
}
export class FulfillConfirmDto {
  @ApiProperty({ enum: ['CONFIRMED', 'DISPUTED'] }) @IsIn(['CONFIRMED', 'DISPUTED']) result!: 'CONFIRMED' | 'DISPUTED';
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}
export class ChangeRequestDto {
  @ApiProperty({ enum: ['COMPANY_NAME', 'CEO_NAME', 'ADDRESS', 'BIZ_TYPE', 'BIZ_ITEM'] })
  @IsIn(['COMPANY_NAME', 'CEO_NAME', 'ADDRESS', 'BIZ_TYPE', 'BIZ_ITEM']) field!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(300) afterValue!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(500) reason!: string;
}
export class StaffInviteDto {
  @ApiProperty({ example: 'lee@hanbit.example' }) @IsString() @MaxLength(200) email!: string;
  @ApiPropertyOptional({ description: '충전 · 환불 · 정산 권한' }) @IsOptional() @StrictBoolean() canSettle?: boolean;
}
export class BrandDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) brandName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) intro?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() logoFileId?: string | null;
}
export class SiteDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @ApiProperty() @IsString() sido!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sigungu?: string | null;
}
export class QuoteDto {
  @ApiProperty() @IsInt() @Min(1) amount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) message?: string | null;
}
export class CatalogDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiProperty({ enum: ['RENTAL', 'SALE'] }) @IsIn(['RENTAL', 'SALE']) saleKind!: string;
  @ApiProperty() @IsInt() @Min(1) price!: number;
}
export class CatalogStateDto {
  @ApiProperty({ enum: ['LISTED', 'HIDDEN'] }) @IsIn(['LISTED', 'HIDDEN']) state!: string;
}
export class LeadGradeDto {
  @ApiProperty({ enum: ['NONE', 'SENT', 'CONFIRMED', 'NO_RESPONSE', 'FAILED', 'CANCELED'] })
  @IsIn(['NONE', 'SENT', 'CONFIRMED', 'NO_RESPONSE', 'FAILED', 'CANCELED']) alimState!: string;
  @ApiPropertyOptional({ enum: ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'], description: '내부 코드 — 표시 S · A+ · A · A- · B+ · B · B- · C' })
  @IsOptional() @IsIn(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G']) grade?: string | null;
}
export class DecideDto {
  @ApiProperty() @StrictBoolean() approve!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class AdjustDto {
  @ApiProperty({ enum: ['PAID', 'BONUS'] }) @IsIn(['PAID', 'BONUS']) account!: 'PAID' | 'BONUS';
  @ApiProperty({ description: '+ 늘림 · − 줄임(원)' }) @IsInt() amount!: number;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(300) reason!: string;
}
export class InvoiceRunDto { @ApiProperty({ example: '2026-09' }) @IsString() @Matches(/^\d{4}-\d{2}$/) ym!: string; }
export class InvoiceIssueDto {
  @ApiProperty() @IsString() @MaxLength(60) invoiceNo!: string;
  @ApiProperty({ example: '2026-10-10' }) @IsString() issuedOn!: string;
}
export class RateDto { @ApiProperty({ example: 0.2 }) @IsNumber() @Min(0) @Max(0.5) rate!: number; }
export class GradeRuleDto { @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(0) minMonthEarned?: number | null; }
export class PartnerCenterOkDto { @ApiPropertyOptional() ok?: boolean; @ApiPropertyOptional() note?: string; }

/**
 * SB-PTC-* 파트너센터 — v10.31 (W5 · 10/10 시안 기준) 새 API
 * 리드 이용료 선불 충전(D070) · 상담 메모 · 반려 한도 · 서비스 위자드 · 상세 · 수정 · 노출 중단 · 블록 · 매트릭스 ·
 * 이행 보고 · 회사 · 계정 · 전용 트랙
 */
@ApiTags('PTC')
@ApiBearerAuth()
@Controller('api/v1/partner')
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
@ApiResponse({ status: 409, description: 'NOT_PARTNER', type: ErrorDto })
export class PartnerCenterController {
  constructor(private readonly cash: LeadCashService, private readonly svc: PartnerCenterService) {}

  /* ── 리드 이용료(선불) ── */
  @Get('cash')
  @ApiOperation({ summary: '리드 이용료 잔액 (SB-PTC-CTR-400)', description: '총 잔액 · 유상 잔액 · 등급 할인(보너스) · 자동 청구 · 사용 내역(원장) · 충전 · 환불. 충전금은 자사 리드 확인비용 선납으로만 씁니다.' })
  @ApiOkResponse({ type: PartnerCenterOkDto })
  cashSummary() { return this.cash.summary(); }

  @Post('cash/charges')
  @ApiOperation({ summary: '충전 주문 만들기', description: '금액 · 등급 할인은 서버가 정합니다. 돌려준 orderId 로 결제창을 엽니다.' })
  @ApiResponse({ status: 422, description: 'CHARGE_TOO_SMALL · CHARGE_TOO_LARGE · BALANCE_CAP · NO_MONEY_ROLE', type: ErrorDto })
  @Audit('LEAD_CASH_CHARGE_CREATE', 'PARTNER')
  createCharge(@Body() dto: CashChargeDto) { return this.cash.createCharge(dto.amount); }

  @Post('cash/charges/confirm')
  @ApiOperation({ summary: '충전 승인 확인', description: '결제사에 승인을 확인한 뒤 원장에 올립니다(같은 주문은 한 번만).' })
  @ApiResponse({ status: 409, description: 'CHARGE_UNKNOWN · CHARGE_FAILED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'CHARGE_DECLINED · AMOUNT_MISMATCH', type: ErrorDto })
  @Audit('LEAD_CASH_CHARGE_CONFIRM', 'PARTNER')
  confirmCharge(@Body() dto: CashConfirmDto) { return this.cash.confirmCharge(dto.orderId, dto.paymentKey, dto.amount); }

  @Put('cash/auto')
  @ApiOperation({ summary: '자동 청구 설정', description: '잔액이 기준 미만이면 등록된 카드(구독 결제와 같은 빌링키)로 충전합니다.' })
  @Audit('LEAD_CASH_AUTO_SET', 'PARTNER')
  setAuto(@Body() dto: CashAutoDto) { return this.cash.setAuto(dto); }

  @Post('cash/refunds')
  @ApiOperation({ summary: '유상 잔액 환불', description: '최근 충전부터 결제 취소로 돌려드립니다. 등급 할인(보너스)은 환불 대상이 아니고, 환불한 충전의 보너스는 회수합니다.' })
  @ApiResponse({ status: 422, description: 'LEADCASH — 유상 잔액 · 처리 중 환불', type: ErrorDto })
  @Audit('LEAD_CASH_REFUND', 'PARTNER')
  refund(@Body() dto: CashRefundDto) { return this.cash.refund(dto.amount, dto.reason); }

  /* ── 상담 신청 ── */
  @Get('leads/:id/memos')
  @ApiOperation({ summary: '배정 건 메모 내역' })
  @ApiParam({ name: 'id', description: 'deliveryId' })
  memos(@Param('id') id: string) { return this.svc.memos(id); }

  @Post('leads/:id/memo')
  @ApiOperation({ summary: '메모 남기기', description: '쌓기만 합니다(고치거나 지우지 않음). 전화번호 · 이메일은 적지 못합니다.' })
  @ApiParam({ name: 'id', description: 'deliveryId' })
  addMemo(@Param('id') id: string, @Body() dto: MemoDto) { return this.svc.addMemo(id, dto.body); }

  @Get('rejects')
  @ApiOperation({ summary: '반려 · 이의신청 (SB-PTC-CTR-330)', description: '이번 달 반려 한도(받은 리드의 15%) · 신청 내역 · 환급액' })
  rejects() { return this.svc.rejects(); }

  /* ── 내 서비스 ── */
  @Get('service-forms')
  @ApiOperation({ summary: '서비스 등록 위자드 정의 (SB-PTC-CTR-210)', description: '업종 → 등록 방식 · 단계 · 매트릭스 축 · 기준 단가 · 등급 비율' })
  serviceForms() { return this.svc.serviceForms(); }

  @Get('services/:id')
  @ApiOperation({ summary: '서비스 상세 (SB-PTC-CTR-201)', description: '요약 · 상세페이지 블록 · 견적 매트릭스 · 처리 이력 · 받은 리드' })
  @ApiParam({ name: 'id' })
  serviceDetail(@Param('id') id: string) { return this.svc.serviceDetail(id); }

  @Patch('services/:id')
  @ApiOperation({ summary: '서비스 수정', description: '내용이 바뀌면 재검수(검수중으로 내려가고 그동안 리드가 오지 않음). 확인비용 · 소개비만 바꾸면 노출 그대로.' })
  @ApiParam({ name: 'id' })
  @Audit('PARTNER_SERVICE_EDIT', 'PARTNER')
  updateService(@Param('id') id: string, @Body() dto: ServiceUpdateDto) { return this.svc.updateService(id, dto); }

  @Post('services/:id/suspend')
  @ApiOperation({ summary: '노출 중단', description: '신규 리드만 막히고 진행 중 상담은 그대로 갑니다.' })
  @ApiParam({ name: 'id' })
  @Audit('PARTNER_SERVICE_SUSPEND', 'PARTNER')
  suspend(@Param('id') id: string) { return this.svc.suspendService(id); }

  @Post('services/:id/resume')
  @ApiOperation({ summary: '노출 재개', description: '내가 멈춘 서비스만(운영이 멈춘 건은 운영이 풉니다).' })
  @ApiParam({ name: 'id' })
  @Audit('PARTNER_SERVICE_RESUME', 'PARTNER')
  resume(@Param('id') id: string) { return this.svc.resumeService(id); }

  @Put('services/:id/blocks/:kind')
  @ApiOperation({ summary: '상세페이지 블록 저장', description: 'HERO_IMAGE · INTRO · PRICE · CASES · FAQ · LOCATION. 내용이 비면 블록을 지웁니다.' })
  @ApiParam({ name: 'id' }) @ApiParam({ name: 'kind' })
  putBlock(@Param('id') id: string, @Param('kind') kind: string, @Body() dto: BlockDto) { return this.svc.putBlock(id, kind, dto); }

  @Put('services/:id/matrix')
  @ApiOperation({ summary: '견적 매트릭스 저장', description: '칸 전체를 한 번에. 구간은 업종 마스터(category_matrix_axes)에 있는 것만.' })
  @ApiParam({ name: 'id' })
  putMatrix(@Param('id') id: string, @Body() dto: MatrixDto) { return this.svc.putMatrix(id, dto.cells); }

  /* ── 성과 관리 ── */
  @Get('performance')
  @ApiOperation({ summary: '성과 관리 — 이행 보고 (SB-PTC-CTR-450)' })
  performance() { return this.svc.performance(); }

  @Post('performance')
  @ApiOperation({ summary: '이행 보고', description: '확인비용을 낸 배정 건에만 · 한 건에 한 번. 소비자가 확인하면 성사.' })
  @ApiResponse({ status: 409, description: 'ALREADY_REPORTED', type: ErrorDto })
  @Audit('PARTNER_FULFILL_REPORT', 'LEAD')
  report(@Body() dto: FulfillmentReportDto) { return this.svc.report(dto); }

  /* ── 회사 · 계정 ── */
  @Get('company')
  @ApiOperation({ summary: '회사 · 계정 (SB-PTC-CTR-610)', description: '사업자 정보 · 변경 요청 · 계정(대표 · 직원) · 약관 · 동의 · 회사 관리(브랜드 · 소재)' })
  company() { return this.svc.company(); }

  @Post('company/change-requests')
  @ApiOperation({ summary: '사업자 정보 변경 요청', description: '대표 계정만. 승인은 본사.' })
  @Audit('BIZ_CHANGE_REQUEST', 'BUSINESS')
  requestChange(@Body() dto: ChangeRequestDto) { return this.svc.requestChange(dto); }

  @Post('company/staff')
  @ApiOperation({ summary: '직원 초대', description: '대표 계정만 · 이미 가입한 회원의 이메일' })
  @Audit('PARTNER_STAFF_INVITE', 'BUSINESS')
  inviteStaff(@Body() dto: StaffInviteDto) { return this.svc.inviteStaff(dto); }

  @Delete('company/staff/:accountId')
  @ApiOperation({ summary: '직원 빼기' })
  @ApiParam({ name: 'accountId' })
  @Audit('PARTNER_STAFF_REMOVE', 'BUSINESS')
  removeStaff(@Param('accountId') accountId: string) { return this.svc.removeStaff(accountId); }

  @Get('staff/invitations')
  @ApiOperation({ summary: '내가 받은 직원 초대' })
  myInvites() { return this.svc.myInvites(); }

  @Post('staff/invitations/:businessId/accept')
  @ApiOperation({ summary: '직원 초대 받아들이기' })
  @ApiParam({ name: 'businessId' })
  @Audit('PARTNER_STAFF_JOIN', 'BUSINESS')
  acceptInvite(@Param('businessId') businessId: string) { return this.svc.acceptInvite(businessId); }

  @Put('company/brand')
  @ApiOperation({ summary: '회사 관리 — 브랜드명 · 소개 · 로고' })
  putBrand(@Body() dto: BrandDto) { return this.svc.putBrand(dto); }

  @Post('company/sites')
  @ApiOperation({ summary: '회사 관리 — 소재 추가(시 · 군 · 구까지)' })
  addSite(@Body() dto: SiteDto) { return this.svc.addSite(dto); }

  @Delete('company/sites/:id')
  @ApiOperation({ summary: '회사 관리 — 소재 빼기' })
  @ApiParam({ name: 'id' })
  removeSite(@Param('id') id: string) { return this.svc.removeSite(id); }

  /* ── 전용 트랙 ── */
  @Get('tracks')
  @ApiOperation({ summary: '전용 트랙 (SB-PTC-CTR-950)', description: '판금 · 도색 견적요청함 · 중고차 매물 · 제품 카탈로그' })
  tracks() { return this.svc.tracks(); }

  @Post('tracks/repair/:deliveryId/quote')
  @ApiOperation({ summary: '견적 보내기(저장)', description: '연락처를 연 요청에만' })
  @ApiParam({ name: 'deliveryId' })
  quote(@Param('deliveryId') id: string, @Body() dto: QuoteDto) { return this.svc.sendQuote(id, dto); }

  @Post('tracks/catalog')
  @ApiOperation({ summary: '카탈로그 품목 추가' })
  addCatalog(@Body() dto: CatalogDto) { return this.svc.addCatalog(dto); }

  @Patch('tracks/catalog/:id')
  @ApiOperation({ summary: '카탈로그 품목 노출 · 숨김' })
  @ApiParam({ name: 'id' })
  setCatalog(@Param('id') id: string, @Body() dto: CatalogStateDto) { return this.svc.setCatalog(id, dto.state); }
}

/** 소비자 — 이행 확인(성사). 나의공간 화면(w3)이 부릅니다 */
@ApiTags('MYP')
@ApiBearerAuth()
@Controller('api/v1/me')
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
export class MeFulfillmentController {
  constructor(private readonly svc: PartnerCenterService) {}

  @Get('fulfillment-reports')
  @ApiOperation({ summary: '내 상담에 온 이행 보고', description: '업체가 일을 마쳤다고 보고한 건. 확인하면 성사로 잡힙니다.' })
  @ApiOkResponse({ type: Object, isArray: true })   /* v10.31 합침 — 응답 모양을 문서에(검정 「구현된 API 에 응답 스키마」) */
  list() { return this.svc.myFulfillments(); }

  @Post('fulfillment-reports/:id/confirm')
  @ApiOperation({ summary: '이행 확인 · 이의', description: '한 번만. 이의(DISPUTED)는 무엇이 다른지 적어야 합니다.' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 409, description: 'NOT_WAITING', type: ErrorDto })
  @Audit('FULFILL_CONFIRM', 'LEAD')
  confirm(@Param('id') id: string, @Body() dto: FulfillConfirmDto) { return this.svc.confirmFulfillment(id, dto); }
}

/**
 * SB-ADM-PTN-* 파트너센터 운영 — v10.31 (W5). 운영 화면(w6)이 부르는 이름입니다 — SHARED_NOTES.
 * 경로를 /admin/partners/:id 와 나눕니다(그 컨트롤러의 :id 가 먼저 잡지 않게).
 */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/partner-center')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class PartnerCenterAdminController {
  constructor(private readonly cash: LeadCashService, private readonly svc: PartnerCenterAdminService) {}   // v10.92 — adm* 는 PartnerCenterAdminService

  @Get('cash')
  @ApiOperation({ summary: '리드 이용료 선불 잔액 — 파트너별 · 합계 · 원장 불변식', description: '유상 잔액 합계 = 선불로 보관 중인 금액. 불변식(v_lead_cash_invariants)은 0줄이어야 정상.' })
  wallets() { return this.cash.admWallets(); }

  @Post('cash/auto-run')
  @ApiOperation({ summary: '자동 청구 한 번 돌리기', description: '자동 청구가 켜져 있고 잔액이 기준 미만인 파트너 전부' })
  @Audit('LEAD_CASH_AUTO_RUN', 'PARTNER')
  autoRun() { return this.cash.runAutoAll(); }

  @Get('cash/:partnerId')
  @ApiOperation({ summary: '파트너 한 곳의 원장 · 충전 · 환불' })
  @ApiParam({ name: 'partnerId' })
  ledger(@Param('partnerId') id: string) { return this.cash.admLedger(id); }

  @Post('cash/:partnerId/adjust')
  @ApiOperation({ summary: '잔액 조정(반대 기입)', description: '사유 필수 · 원장에 그대로 남음 · 0 아래로는 못 내림' })
  @ApiParam({ name: 'partnerId' })
  @Audit('LEAD_CASH_ADJUST', 'PARTNER')
  adjust(@Param('partnerId') id: string, @Body() dto: AdjustDto) { return this.cash.admAdjust(id, dto); }

  @Post('leads/:leadId/grade')
  @ApiOperation({ summary: '리드 등급 · 알림톡 결과', description: '알림톡 연동 전 운영 입력. 등급은 알림톡 결과 대역 안에서만(확정 S~A- · 미응답 B+~B- · 발송실패 C). 확인비용이 나간 리드는 등급을 못 바꿈.' })
  @ApiParam({ name: 'leadId' })
  @Audit('LEAD_GRADE_SET', 'LEAD')
  grade(@Param('leadId') id: string, @Body() dto: LeadGradeDto) { return this.svc.admSetLeadGrade(id, dto); }

  @Get('change-requests')
  @ApiOperation({ summary: '사업자 정보 변경 요청' })
  @ApiQuery({ name: 'state', required: false, enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'ALL'] })
  changes(@Query('state') state?: string) { return this.svc.admChangeRequests(state); }

  @Post('change-requests/:id/decide')
  @ApiOperation({ summary: '변경 요청 승인 · 반려', description: '승인하면 사업자 정보에 바로 반영(DB 트리거)' })
  @ApiParam({ name: 'id' })
  @Audit('BIZ_CHANGE_DECIDE', 'BUSINESS')
  decide(@Param('id') id: string, @Body() dto: DecideDto) { return this.svc.admDecideChange(id, dto); }

  @Get('lead-cash-invoices')
  @ApiOperation({ summary: '리드 이용료 세금계산서 발행 요청' })
  @ApiQuery({ name: 'ym', required: false })
  invoices(@Query('ym') ym?: string) { return this.svc.admInvoices(ym); }

  @Post('lead-cash-invoices/run')
  @ApiOperation({ summary: '한 달 치 발행 요청 만들기', description: '그 달 유상 잔액 실사용액(차감 − 환급)' })
  @Audit('LEAD_CASH_INVOICE_RUN', 'PARTNER')
  runInvoices(@Body() dto: InvoiceRunDto) { return this.svc.admRunInvoices(dto.ym); }

  @Post('lead-cash-invoices/:id/issue')
  @ApiOperation({ summary: '발행 표시(손으로 번호 · 연동 전 임시)', description: '국세청 전송 연동 전 — 발행 번호 · 발행일을 적습니다(v10.34 etax_mode MANUAL). 국세청 전송을 시작한 줄은 409 ETAX_IN_PROGRESS — 전송은 POST /admin/etax/lead-cash/{id}/send' })
  @ApiParam({ name: 'id' })
  @Audit('LEAD_CASH_INVOICE_ISSUE', 'PARTNER')
  issue(@Param('id') id: string, @Body() dto: InvoiceIssueDto) { return this.svc.admIssueInvoice(id, dto); }

  @Get('rules')
  @ApiOperation({ summary: '등급 할인 비율 · 파트너 등급 기준 · 신뢰 배지 규칙' })
  rules() { return this.svc.admRules(); }

  @Put('rules/bonus-rates/:grade')
  @ApiOperation({ summary: '등급 할인(보너스) 비율' })
  @ApiParam({ name: 'grade' })
  @Audit('LEAD_CASH_BONUS_RATE', 'PARTNER')
  bonusRate(@Param('grade') grade: string, @Body() dto: RateDto) { return this.svc.admSetBonusRate(grade, dto.rate); }

  @Put('rules/grades/:grade')
  @ApiOperation({ summary: '파트너 등급 기준(이번 달 확정 제휴수수료)' })
  @ApiParam({ name: 'grade' })
  @Audit('PARTNER_GRADE_RULE', 'PARTNER')
  gradeRule(@Param('grade') grade: string, @Body() dto: GradeRuleDto) { return this.svc.admSetGradeRule(grade, dto.minMonthEarned ?? null); }
}
