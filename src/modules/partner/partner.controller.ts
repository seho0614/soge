import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty,
         ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';
import { PartnerService } from './partner.service';
import { PartnerLeadService } from './partner-lead.service';
import { PartnerMoneyService } from './partner-money.service';
import { PartnerAdminService } from './partner-admin.service';
import { QualificationService } from './qualification.service';
import { BrokerService } from './broker.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

export class BrokerStateDto {
  @ApiProperty({ description: '신청한 적이 있는가' }) applied!: boolean;
  @ApiProperty({
    description: '국토부 연동 전이라 대조를 건너뛴 상태인가. ' +
      '**true 면 번호가 실제와 맞는지 확인하지 않았습니다.**',
  })
  assumed!: boolean;
  @ApiPropertyOptional() licenseNo?: string;
  @ApiPropertyOptional() officeName?: string;
  @ApiPropertyOptional() ceoName?: string;
  @ApiPropertyOptional({ description: 'SUBMITTED · PENDING · VERIFIED · REJECTED · EXPIRED' })
  state?: string;
  @ApiPropertyOptional({ description: 'MATCH · MISMATCH · NOT_FOUND. 비면 미조회' })
  lookupResult?: string;
  @ApiPropertyOptional({ description: 'API 실제 조회 · ASSUMED 간주 · MANUAL 수기 (D008)' })
  lookupSource?: string;
  @ApiPropertyOptional({ description: '대조 설명 — 불일치 항목 · 조회 실패 사유' })
  lookupDetail?: string;
  @ApiProperty({ description: '국토부 조회 연동이 설정돼 있는가 (D008)' })
  lookupConfigured!: boolean;
  @ApiPropertyOptional({ description: '재확인 기한. 지나면 인증이 풀립니다' })
  recheckDue?: string;
  @ApiPropertyOptional() rejectReason?: string;
}

export class BrokerApplyDto {
  @ApiProperty({ description: '개설등록번호. 예) 11110-2026-00001' })
  @IsString() @MaxLength(40)
  licenseNo!: string;

  @ApiProperty({ description: '사무소 상호' })
  @IsString()
  officeName!: string;

  @ApiProperty({ description: '대표자명' })
  @IsString()
  ceoName!: string;
}

export class ServiceCreateDto {
  @ApiProperty({ example: '공장 지붕 태양광 EPC' }) @IsString() title!: string;
  @ApiProperty() @IsString() body!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() categoryId?: string;
  /* v10.31 (W5 · CTR-210 위자드) — 아래가 하나라도 있으면 위자드 등록: 업종의 등록 방식이 정해져 있어야 합니다 */
  @ApiPropertyOptional({ description: '위자드로 등록(true)' }) @IsOptional() wizard?: boolean;
  @ApiPropertyOptional({ description: '주요 타겟' }) @IsOptional() @IsString() @MaxLength(300) target?: string;
  @ApiPropertyOptional({ enum: ['QUOTE', 'CALL', 'VISIT', 'CHAT'] }) @IsOptional() @IsIn(['QUOTE', 'CALL', 'VISIT', 'CHAT']) receiveMode?: string;
  @ApiPropertyOptional({ description: '최고 확인비용(S) — 업종 기준 단가 이상' }) @IsOptional() @IsInt() @Min(1) @Max(100000) topFee?: number;
  @ApiPropertyOptional({ description: '성사 소개비율 0.05 ~ 0.12' }) @IsOptional() @IsNumber() @Min(0.05) @Max(0.12) referralRate?: number;
  @ApiPropertyOptional({ description: '재소개 보너스(건당 원)' }) @IsOptional() @IsInt() @Min(0) @Max(1000000) rebateBonus?: number;
  @ApiPropertyOptional({ description: '견적 매트릭스 [{row, col, amount}]' }) @IsOptional() @IsArray() matrix?: Array<{ row: string; col: string; amount: number }>;
  @ApiPropertyOptional({ description: '상세페이지 블록 [{kind, body}]' }) @IsOptional() @IsArray() blocks?: Array<{ kind: string; body?: string; fileId?: string }>;
}
export class RegionsDto {
  @ApiProperty({ example: [{ sido: '경기', sigungu: '화성시' }],
    description: '시·군·구까지만 씁니다. 상세주소는 매칭에 쓰지 않습니다' })
  @IsArray() regions!: Array<{ sido: string; sigungu: string }>;
}
export class ServiceReviewDto {
  @ApiProperty() @StrictBoolean() approve!: boolean;
  @ApiPropertyOptional({ description: '반려 시 필수. 이용자에게 그대로 보입니다' })
  @IsOptional() @IsString() reason?: string;
}
export class VoidFeeDto {
  @ApiProperty({ example: 'RSK-02', description: '위험감지 규칙 코드' })
  @IsString() ruleCode!: string;
}
/* ── D003 파트너 운영 목록 (2026-10-02) ─────────────────────────────── */
export class PartnerRejectDto {
  @ApiProperty({ example: '사업자등록증의 업태가 신청 업종과 다릅니다 — 업태를 맞춰 다시 신청해 주십시오',
    description: '신청자에게 그대로 보입니다' })
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}
export class FeeDisputeDto {
  @ApiProperty({ enum: ['FALSE_INFO', 'UNREACHABLE', 'DUPLICATE', 'OUT_OF_SCOPE'],
    description: '허위 정보 · 연락 불가 · 중복 리드 · 지역·분야 밖. **상담 결렬은 사유가 아닙니다**' })
  @IsIn(['FALSE_INFO', 'UNREACHABLE', 'DUPLICATE', 'OUT_OF_SCOPE']) reasonCode!: string;
  @ApiProperty({ example: '안내된 번호가 결번입니다. 3회 통화 시도(10/1 10:02 · 13:40 · 17:15)' })
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
  @ApiPropertyOptional({ description: '근거 — 통화 기록 캡처 링크 · 문자 발송 내역 등' })
  @IsOptional() @IsString() @MaxLength(2000) evidence?: string;
}
export class VoidAcceptDto {
  @ApiProperty({ example: 'RSK-02', description: '위험감지 규칙 코드 — 무효의 근거' })
  @IsString() @IsNotEmpty() ruleCode!: string;
  @ApiPropertyOptional({ description: '판정 메모' })
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class VoidDismissDto {
  @ApiProperty({ example: '통화 기록상 연결된 뒤 상담이 결렬된 건입니다 — 상담 결렬은 반려 사유가 아닙니다',
    description: '파트너에게 그대로 보입니다' })
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}
export class BrokerDecideDto {
  @ApiProperty({ enum: ['VERIFIED', 'REJECTED'] })
  @IsIn(['VERIFIED', 'REJECTED']) state!: 'VERIFIED' | 'REJECTED';
  @ApiPropertyOptional({ description: '반려 시 필수. 신청자에게 그대로 보입니다' })
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class PartnerOkDto {
  @ApiPropertyOptional() id?: string;
  @ApiPropertyOptional() status?: string;
  @ApiPropertyOptional() note?: string;
}

/**
 * SB-PTC-* 파트너센터
 *
 * **리드 이용료는 정보 이용료입니다.** 열람 시점에 발생하고 성사와 무관합니다.
 * 소개비가 아니며, 소개비는 당사자끼리 직접 주고받습니다(INV-9R).
 */
@ApiTags('PTC')
@ApiBearerAuth()
@Controller('api/v1/partner')
/* ★ 파트너센터는 **입점 사업자 본인 것만** 보이는 자리입니다.
 *   리드 · 정산 · 통계가 다 들어 있어, 표시가 없으면 토큰 없이도
 *   남의 리드를 볼 수 있습니다.
 *
 *   역할이 아니라 로그인 여부를 봅니다 — 입점 전 신청(apply)도
 *   같은 컨트롤러에 있어 특정 역할을 요구하면 신청을 못 합니다. */
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
export class PartnerController {
  constructor(
    private readonly svc: PartnerService,
    private readonly lead: PartnerLeadService,      // v10.86 — 리드
    private readonly money: PartnerMoneyService,    // v10.86 — 이용료 · 정산
  ) {}

  @Post('apply')
  @ApiOperation({
    summary: '입점 신청',
    description: 'v10.38 (D096 · P2P) — 계정 기준. 사업자 인증을 마친 사업자는 그 사업자로, 사업자 정보가 없는 본인인증 개인은 「개인 활동 정보」로 신청합니다. ' +
      '본인인증 · 사업자 정보 둘 다 없으면 422 IDENTITY_REQUIRED.',
  })
  @ApiOkResponse({ type: PartnerOkDto })
  @ApiResponse({ status: 422, description: 'IDENTITY_REQUIRED', type: ErrorDto })
  @Audit('PARTNER_APPLY', 'PARTNER')
  apply() { return this.svc.apply(); }

  @Get('dashboard')
  @ApiOperation({
    summary: '파트너 홈',
    description:
      '**막힌 업무를 먼저 냅니다.** 승인·서비스·지역·미납 중 하나라도 걸리면 ' +
      '리드가 오지 않는데, 이유를 모르면 "왜 안 오나"를 묻게 됩니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto })
  dashboard() { return this.svc.dashboard(); }

  @Get('services')
  @ApiOperation({ summary: '내 서비스', description: '승인된 서비스에만 리드가 옵니다.' })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  services() { return this.svc.services(); }

  @Post('services')
  @ApiOperation({
    summary: '서비스 등록',
    description: '금칙어·제한업종은 DB 가 봅니다. 검수를 거쳐 승인됩니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto })
  @Audit('PARTNER_SERVICE_CREATE', 'PARTNER')
  addService(@Body() dto: ServiceCreateDto) {
    const wiz = dto.wizard || dto.target !== undefined || dto.receiveMode !== undefined || dto.topFee !== undefined
      || dto.referralRate !== undefined || dto.rebateBonus !== undefined || dto.matrix !== undefined || dto.blocks !== undefined;
    return this.svc.addService(dto.title, dto.body, dto.categoryId, wiz ? {
      target: dto.target, receiveMode: dto.receiveMode, topFee: dto.topFee, referralRate: dto.referralRate,
      rebateBonus: dto.rebateBonus, matrix: dto.matrix, blocks: dto.blocks } : undefined);
  }

  @Get('regions')
  @ApiOperation({ summary: '활동 지역' })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  regions() { return this.svc.regions(); }

  @Post('regions')
  @ApiOperation({
    summary: '활동 지역 설정',
    description:
      '시·군·구까지만 씁니다. 상세주소는 그 자체로 특정 개인을 가리킬 수 있어 매칭에 넣지 않습니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto })
  @Audit('PARTNER_REGION_SET', 'PARTNER')
  setRegions(@Body() dto: RegionsDto) { return this.svc.setRegions(dto.regions); }

  @Get('leads')
  @ApiOperation({
    summary: '받은 리드',
    description:
      '**열람 전에는 요약만 보입니다.** 지역·분야·시기까지는 무료이고, ' +
      '연락처를 여는 순간 이용료가 발생합니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  leads() { return this.lead.leads(); }

  @Post('leads/:id/view')
  @ApiOperation({
    summary: '리드 열람 (과금)',
    description:
      '**이 시점 하나뿐입니다.** 성사되면 더 내지 않고, 안 되면 돌려받지도 않습니다 — ' +
      '정보 이용료이기 때문입니다. 미납 한도를 넘었으면 열리지 않습니다.',
  })
  @ApiParam({ name: 'id', description: 'deliveryId' })
  @ApiResponse({ status: 422, description: 'NOT_ELIGIBLE', type: ErrorDto })
  @Audit('LEAD_VIEW', 'LEAD')
  view(@Param('id') id: string) { return this.lead.viewLead(id); }

  @Get('leads/:id/contact')
  @ApiOperation({
    summary: '열람한 리드의 연락처 (D008)',
    description:
      '**열람(과금)한 배정만** 연락처가 풀립니다. 풀 때마다 pii.fn_read_lead_contact 가 열람 기록을 남깁니다. ' +
      '열람 응답(POST …/view)에는 연락처를 싣지 않습니다 — 그 응답은 감사 로그에 통째로 남기 때문입니다. ' +
      '보관 기한이 지나 파기된 건은 contact 가 null 입니다.',
  })
  @ApiParam({ name: 'id', description: 'deliveryId' })
  @ApiOkResponse({ type: PartnerOkDto })
  @ApiResponse({ status: 409, description: 'NOT_PARTNER · NO_SUCH_LEAD', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'NOT_VIEWED — 열람 전', type: ErrorDto })
  leadContact(@Param('id') id: string) { return this.lead.leadContact(id); }

  @Get('fees')
  @ApiOperation({
    summary: '리드 이용료 차감 내역',
    description:
      'v10.31 (10/10 시안 기준) — **선불 충전 잔액에서 차감합니다**(보너스 먼저). 잔액 · 충전 · 환불은 GET /partner/cash. ' +
      '전환 전 후불 미청구분은 settleMode=POSTPAID 로 그대로 청구됩니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto })
  fees() { return this.money.fees(); }

  @Get('fees/disputes')
  @ApiOperation({
    summary: '내 리드 반려 신청',
    description: '신청한 반려의 판정 결과입니다. 기각이면 사유가 함께 보입니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  myDisputes() { return this.money.myDisputes(); }

  @Post('fees/:id/dispute')
  @ApiOperation({
    summary: '리드 반려 신청 (SB-PTC-CTR-330)',
    description:
      '허위 정보 · 연락 불가 · 중복 · 범위 밖 리드에 한해 신청합니다. **상담 결렬은 사유가 아닙니다.** ' +
      '리드 접수 72시간 이내 · 이용료 한 건에 한 번 · 월 한도(수신 건수의 15%) — DB 가 봅니다.',
  })
  @ApiParam({ name: 'id', description: '이용료 번호 (lead_fees.id)' })
  @ApiOkResponse({ type: PartnerOkDto })
  @ApiResponse({ status: 409, description: 'ALREADY_REQUESTED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LEADFEE — 72시간 · 한도 · 무효 건', type: ErrorDto })
  @Audit('LEAD_FEE_DISPUTE', 'LEAD')
  dispute(@Param('id') id: string, @Body() dto: FeeDisputeDto) { return this.money.disputeFee(id, dto); }

  /* ── 파트너센터 조회 API ──────────────────────────────────────────
   *
   * 파트너가 **자기 것만** 봅니다. 남의 실적이나 단가는 보이지
   * 않습니다 — 경쟁사가 서로의 리드 단가를 알면 담합이 됩니다.
   * ─────────────────────────────────────────────────────────────── */

  @Get('reviews')
  @ApiOperation({
    summary: '승인 · 반려 이력',
    description:
      '언제 무엇이 왜 반려됐는지 남습니다. **사유 없는 반려는 없습니다** — ' +
      '무엇을 고쳐야 다시 올릴 수 있는지 알아야 하기 때문입니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  myReviews() { return this.svc.myReviews(); }

  @Get('settlement')
  @ApiOperation({
    summary: '정산 (성사 정산 · 수령 계좌 · 세금계산서)',
    description:
      'v10.31 (10/10 시안 기준) — 회사가 지급하는 정산(payouts · 성사 건수) · 정산 수령 계좌(account) · 세금계산서(invoices). ' +
      '옛 필드(unpaid · billed · voided · months — 리드 이용료 합계)도 그대로 옵니다. **소개비는 여기 없습니다**(INV-9R).',
  })
  @ApiOkResponse({ type: PartnerOkDto })
  mySettlement() { return this.money.mySettlement(); }

  @Get('stats')
  @ApiOperation({
    summary: '실적 · 등급',
    description:
      '받은 리드 · 열람 · 성사와 현재 등급입니다. 등급이 오르면 ' +
      '같은 리드를 더 싸게 받습니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto })
  myStats() { return this.svc.myStats(); }

  @Get('trust')
  @ApiOperation({
    summary: '신뢰지표',
    description:
      '응답 속도 · 열람률 · 성사율입니다. **낮으면 리드가 덜 옵니다** — ' +
      '받아 놓고 응답하지 않으면 요청자가 기다리게 되기 때문입니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto })
  myTrust() { return this.svc.myTrust(); }

  @Get('pricing')
  @ApiOperation({
    summary: '내 단가표',
    description:
      '업종과 등급에 따른 리드 이용료입니다. **도입가인 동안은 바뀔 수 ' +
      '있습니다** — 3주 실측 후 재산정합니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  myPricing() { return this.money.myPricing(); }

  @Get('pricing/rewards')
  @ApiOperation({
    summary: '소개비 보상표 (SB-PTC-CTR-900 · v10.31)',
    description: '서비스마다 최고 확인비용(S) · 성사 소개비율 · 재소개 보너스와 등급 비율. 소개비는 당사자끼리 직접(INV-9) — 약정 표시용.',
  })
  @ApiOkResponse({ type: PartnerOkDto })
  myRewards() { return this.money.myRewards(); }

  @Get('notices')
  @ApiOperation({
    summary: '공지 · 알림',
    description: '정책 변경과 내 건에 관한 알림입니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  myNotices() { return this.svc.myNotices(); }

  @Post('notices/read-all')
  @ApiOperation({ summary: '알림 모두 읽음 (SB-PTC-CTR-700 · v10.31)', description: '내 알림만' })
  @ApiOkResponse({ type: PartnerOkDto })
  readAll() { return this.svc.readNotices(); }

  @Post('notices/:id/read')
  @ApiOperation({ summary: '알림 한 건 읽음' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: PartnerOkDto })
  readOne(@Param('id') id: string) { return this.svc.readNotices(id); }

  /* ── 중개사 인증 (INV-BR1) ────────────────────────────────────────
   * 부동산은 중개사만 소개할 수 있습니다(공인중개사법 9조).
   * 연동 전에는 `assume.broker` 로 대조를 건너뜁니다 —
   * **화면에 간주 상태가 표시됩니다.**
   * ─────────────────────────────────────────────────────────────── */

  @Get('broker')
  @ApiOperation({
    summary: '내 중개사 인증 상태',
    description:
      '국토부 대조 결과와 심사 상태입니다. **대조가 맞아도 자동 승인은 ' +
      '없습니다** — 명의 도용은 대조로 거를 수 없어 사람이 봅니다.',
  })
  @ApiOkResponse({ type: BrokerStateDto })
  myBroker() { return this.svc.myBroker(); }

  @Post('broker')
  @ApiOperation({
    summary: '중개사 인증 신청',
    description:
      '개설등록번호로 국토부와 대조합니다. 연동 전에는 간주 처리되며 ' +
      '**그 사실이 화면에 표시됩니다.**',
  })
  @ApiResponse({ status: 422, description: 'BROKER · 대조 실패', type: ErrorDto })
  @Audit('BROKER_APPLY', 'BUSINESS')
  applyBroker(@Body() dto: BrokerApplyDto) { return this.svc.applyBroker(dto); }
}

/** SB-ADM-PTN-* 파트너 운영 */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/partners')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class PartnerAdminController {
  constructor(private readonly svc: PartnerAdminService) {}   // v10.45 — 운영용 서비스를 나눔

  @Get()
  @ApiOperation({ summary: '파트너 목록', description: '미납이 한도를 넘으면 리드가 자동으로 멈춥니다.' })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  list() { return this.svc.admList(); }

  @Post(':id/approve')
  @ApiOperation({
    summary: '입점 승인',
    description: '인증되지 않은 사업자는 DB 가 막습니다. 휴업·폐업이면 승인하지 마십시오.',
  })
  @ApiParam({ name: 'id' })
  @Audit('PARTNER_APPROVE', 'PARTNER')
  approve(@Param('id') id: string) { return this.svc.admApprove(id); }

  @Post(':id/reject')
  @ApiOperation({
    summary: '입점 반려 (SB-ADM-PTN-020)',
    description:
      '사유는 신청자에게 그대로 보이고, 고쳐서 다시 신청할 수 있습니다. ' +
      '사유 없는 반려는 DB 가 막습니다.',
  })
  @ApiParam({ name: 'id', description: 'partnerId' })
  @ApiOkResponse({ type: PartnerOkDto })
  @ApiResponse({ status: 409, description: 'NOT_APPLIED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'REASON_REQUIRED', type: ErrorDto })
  @Audit('PARTNER_REJECT', 'PARTNER')
  reject(@Param('id') id: string, @Body() dto: PartnerRejectDto) {
    return this.svc.admReject(id, dto.reason);
  }

  @Get('services/pending')
  @ApiOperation({
    summary: '검수 대기 서비스 (SB-ADM-PTN-030)',
    description:
      '파트너 · 분야 · 제한업종 · 규제 자격 상태 · 이전 반려 수를 함께 냅니다. ' +
      '오래된 것부터입니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  pendingServices() { return this.svc.admPendingServices(); }

  @Get('fees/void-requests')
  @ApiOperation({
    summary: '리드 반려 신청 목록 (SB-ADM-PTN-050)',
    description:
      '파트너가 낸 반려 신청과 사유 · 근거 · 월 한도 근거(당월 수신 · 신청 수)입니다. ' +
      '인정에 쓸 위험감지 규칙(rules)도 함께 냅니다.',
  })
  @ApiQuery({ name: 'state', required: false, enum: ['REQUESTED', 'ACCEPTED', 'DISMISSED', 'ALL'] })
  @ApiOkResponse({ type: PartnerOkDto })
  voidRequests(@Query('state') state?: string) { return this.svc.admVoidRequests(state); }

  @Post('fees/void-requests/:id/accept')
  @ApiOperation({
    summary: '리드 반려 인정',
    description: '이용료가 무효가 됩니다(트리거가 같이 맞춤). **위험감지 규칙 근거가 필요합니다.**',
  })
  @ApiParam({ name: 'id', description: '반려 신청 번호' })
  @ApiOkResponse({ type: PartnerOkDto })
  @ApiResponse({ status: 409, description: 'NOT_REQUESTED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'RULE_REQUIRED', type: ErrorDto })
  @Audit('LEAD_REJECT_ACCEPT', 'LEAD')
  acceptVoid(@Param('id') id: string, @Body() dto: VoidAcceptDto) {
    return this.svc.admAcceptVoidRequest(id, dto.ruleCode, dto.note);
  }

  @Post('fees/void-requests/:id/dismiss')
  @ApiOperation({
    summary: '리드 반려 기각',
    description: '이용료는 그대로 청구됩니다. 사유가 파트너에게 보입니다.',
  })
  @ApiParam({ name: 'id', description: '반려 신청 번호' })
  @ApiOkResponse({ type: PartnerOkDto })
  @ApiResponse({ status: 409, description: 'NOT_REQUESTED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'REASON_REQUIRED', type: ErrorDto })
  @Audit('LEAD_REJECT_DISMISS', 'LEAD')
  dismissVoid(@Param('id') id: string, @Body() dto: VoidDismissDto) {
    return this.svc.admDismissVoidRequest(id, dto.reason);
  }

  @Post('services/:id/review')
  @ApiOperation({
    summary: '서비스 검수',
    description:
      '반려 사유는 이용자에게 그대로 보입니다. ' +
      "'부적절'만 쓰면 같은 것을 다시 내고 검수 큐가 그만큼 늘어납니다.",
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 422, description: 'REASON_REQUIRED', type: ErrorDto })
  @Audit('PARTNER_SERVICE_REVIEW', 'PARTNER')
  review(@Param('id') id: string, @Body() dto: ServiceReviewDto) {
    return this.svc.admReviewService(id, dto.approve, dto.reason);
  }

  @Post('fees/:id/void')
  @ApiOperation({
    summary: '이용료 무효',
    description:
      '**위험감지 규칙 근거가 필요합니다.** 당사자 간 상담 결렬은 무효 사유가 아닙니다 — ' +
      '그것까지 판정하면 플랫폼이 거래 당사자가 됩니다. ' +
      '인정되면 거래 자체가 없던 것이 됩니다.',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 422, description: 'RULE_REQUIRED', type: ErrorDto })
  @Audit('LEAD_FEE_VOID', 'LEAD')
  voidFee(@Param('id') id: string, @Body() dto: VoidFeeDto) {
    return this.svc.admVoidFee(id, dto.ruleCode);
  }

  @Get('fees')
  @ApiOperation({ summary: '이용료 현황', description: 'v10.31 — 리드 이용료는 선불 충전 잔액에서 차감합니다. 이 목록의 unpaid 는 전환 전 후불 미청구분입니다. 잔액은 GET /admin/partner-center/cash' })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  fees() { return this.svc.admFees(); }

  /* v10.32 — 시안 SB-ADM-PTN-010 「입점 파트너사」 카드 줄의 칸(읽기 전용). :id 보다 앞에 둡니다 */
  @Get('cards')
  @ApiOperation({ summary: '파트너사 카드 칸 (v10.32 · 읽기 전용)', description: '파트너마다 받은 리드 수 · 리드 이용료 잔액(충전 + 보너스) · 대표 업종 · 등록 방식 · 걸린 자격 심사. 목록(GET /admin/partners)에 없는 칸만 냅니다.' })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  cards() { return this.svc.admCards(); }

  @Get(':id/docs')
  @ApiOperation({ summary: '파트너사 계약 · 서류 (v10.32 · 읽기 전용)', description: 'SB-ADM-PTN-011 「계약 · 서류」 — 파트너 이용약관 최근 동의 · 국세청 사업자 상태 조회 · 업종 자격 심사.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PartnerOkDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  docs(@Param('id', ParseUUIDPipe) id: string) { return this.svc.admDocs(id); }

  /* v10.27 (G-130) — 상세. 다른 GET(services/pending · fees · rules)보다 뒤에 둡니다(앞에 두면 그 이름을 :id 로 잡음) */
  @Get(':id')
  @ApiOperation({ summary: '파트너 상세', description: '사업자 · 등급 · 상태 · 승인 서비스 · 서비스 지역 · 리드 이용료(상태별) · 미납 한도.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PartnerOkDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  detail(@Param('id', ParseUUIDPipe) id: string) { return this.svc.admDetail(id); }
}

/** SB-ADM-PTN-040 · 070 자격 심사 · 의료 심의 */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/qualifications')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class QualificationController {
  constructor(private readonly svc: QualificationService) {}

  @Get('rules')
  @ApiOperation({
    summary: '규제 분야 기준',
    description: '대부·다단계는 심사 대상이 아니라 **등록 금지**입니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  rules() { return this.svc.rules(); }

  @Get('category-master')
  @ApiOperation({
    summary: '카테고리 마스터 (T-05 · T-06) — 읽기 전용',
    description:
      'v10.32 · SB-ADM-PTN-060. ① 안심소개 상담 축 업종(코드 · 게시 방식 GATED/일반 · 상태) ' +
      '② 등록 폼 · 단가(업종의 등록 방식 · 단계 수 · 견적 축 · 규제 · 단가 입력 가능/막힘 — 파트너센터 등록 위자드와 같은 기준) ' +
      '③ 매트릭스 축(category_matrix_axes). 업종 마스터에 기준 금액 칸이 없어 base 는 null 입니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto })
  categoryMaster() { return this.svc.categoryMaster(); }

  @Get()
  @ApiOperation({ summary: '심사 대기' })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  pending() { return this.svc.pending(); }

  @Post(':id/lookup')
  @ApiOperation({
    summary: '발급처 조회 완료',
    description:
      '**서류만 보고 승인하지 마십시오.** 위조된 자격증으로 등록되면 ' +
      '그 피해는 요청자에게 갑니다. 조회 없이는 DB 가 승인을 막습니다.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: PartnerOkDto })
  @Audit('QUAL_LOOKUP', 'QUALIFICATION')
  lookup(@Param('id') id: string) { return this.svc.markLookup(id); }

  @Post(':id/decide')
  @ApiOperation({
    summary: '자격 승인 · 반려',
    description:
      '자격 없이 등록되면 **플랫폼도 책임을 집니다.** 중개자 면책은 ' +
      '"고지하고 확인한 범위"에서만 성립하고, 자격 확인이 그 확인입니다.',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 422, description: 'REASON_REQUIRED · QUAL_RULE', type: ErrorDto })
  @ApiOkResponse({ type: PartnerOkDto })
  @Audit('QUAL_DECIDE', 'QUALIFICATION')
  decide(@Param('id') id: string, @Body() dto: ServiceReviewDto) {
    return this.svc.decide(id, dto.approve, dto.reason);
  }

  @Get('medical')
  @ApiOperation({
    summary: '의료 심의 대기',
    description:
      '심의필 번호를 확인해야 슬롯에 붙습니다. 확인 전에는 DB 가 막으므로 ' +
      '실수로 노출되지 않습니다. 번호만 받지 말고 **실제 조회**하십시오 — ' +
      '의료법 27조·56조는 과태료 대상입니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  medical() { return this.svc.medicalPending(); }

  @Get('properties')
  @ApiOperation({
    summary: '매물 심사 대기 (안심소개)',
    description:
      '**중개사 자격 통과 여부를 함께 냅니다.** 없으면 승인해도 트리거가 막으므로 ' +
      '미리 보여 드립니다 — 눌러 보고서야 알면 늦습니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  properties() { return this.svc.propertyPending(); }

  @Post('properties/:id/decide')
  @ApiOperation({
    summary: '매물 공개 · 반려',
    description:
      '자격 없는 사람이 매물을 올리고 중개하면 **무등록 중개**이고 ' +
      '플랫폼이 그 자리를 제공한 것이 됩니다(공인중개사법 제18조의2). ' +
      '개설등록번호와 자격 심사 통과가 모두 있어야 공개됩니다.',
  })
  @ApiParam({ name: 'id', description: 'listingId' })
  @ApiResponse({ status: 422, description: 'PROP · REASON_REQUIRED', type: ErrorDto })
  @ApiOkResponse({ type: PartnerOkDto })
  @Audit('PROPERTY_DECIDE', 'LISTING')
  decideProperty(@Param('id') id: string, @Body() dto: ServiceReviewDto) {
    return this.svc.decideProperty(id, dto.approve, dto.reason);
  }
}

/** SB-ADM-BRK-010 · 011 중개사 인증 심사 (INV-BR1) */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/brokers')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class BrokerAdminController {
  constructor(private readonly svc: BrokerService) {}

  @Get()
  @ApiOperation({
    summary: '중개사 인증 신청 목록',
    description:
      '`POST /partner/broker` 로 들어온 신청입니다. 기본은 심사 대기(SUBMITTED · PENDING). ' +
      '대표자 일치 여부와 대기 중인 부동산 매물 수를 함께 냅니다.',
  })
  @ApiQuery({ name: 'state', required: false, enum: ['PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED', 'ALL'] })
  @ApiQuery({ name: 'q', required: false, description: '찾기 — 상호 · 사무소 · 대표 · 이메일 · 사업자번호 · 등록번호 (G-207)' })
  @ApiQuery({ name: 'order', required: false, enum: ['old', 'recent'], description: '심사 대기의 기본은 old(오래된 순) · 그 밖은 recent' })
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'size', required: false, description: '1 ~ 100 · 기본 50' })
  @ApiOkResponse({ type: PartnerOkDto })
  list(@Query('state') state?: string, @Query('q') q?: string, @Query('order') order?: string,
       @Query('page') page?: string, @Query('size') size?: string) {
    return this.svc.list(state, { q, order, page: page ? Number(page) : undefined, size: size ? Number(size) : undefined });
  }

  /* v10.32 — SB-ADM-BRK-011 시안 세 칸 중 「보증 · 서류」(읽기 전용). 신청 때 받은 보증(공제) 기관 · 금액 · 기간 · 제출 서류 종류 */
  @Get(':id/evidence')
  @ApiOperation({ summary: '중개사 인증 — 보증 · 서류 (v10.32 · 읽기 전용)', description: '신청 때 받은 보증(공제) 기관 · 증서 번호 · 금액 · 기간 · 제출 서류 종류(REG_CERT · GUARANTEE · LICENSE · ETC) · 첨부 수.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: PartnerOkDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  evidence(@Param('id') id: string) { return this.svc.evidence(id); }

  @Get(':id')
  @ApiOperation({ summary: '중개사 인증 신청 상세' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: PartnerOkDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post(':id/lookup')
  @ApiOperation({
    summary: '국토부 다시 조회 (D008)',
    description:
      '심사 대기 건을 국토부 중개사무소 조회와 다시 맞춰 봅니다(BROKER_LOOKUP_URL · KEY 설정 시). ' +
      '조회 실패면 기존 결과를 지우지 않고 사유만 남깁니다. 설정이 없으면 422 LOOKUP_NOT_CONFIGURED.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: PartnerOkDto })
  @ApiResponse({ status: 409, description: 'NOT_PENDING', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LOOKUP_NOT_CONFIGURED', type: ErrorDto })
  @Audit('BROKER_LOOKUP', 'BUSINESS')
  lookup(@Param('id') id: string) { return this.svc.relookup(id); }

  @Post(':id/decide')
  @ApiOperation({
    summary: '중개사 인증 승인 · 반려',
    description:
      '**승인하면 그 사업자의 부동산 매물 공개가 열립니다**(fn_broker_gate). ' +
      '국토부 대조가 MATCH 가 아니면 DB 가 승인을 막고, 반려에는 사유가 필요합니다. ' +
      '승인되면 180일 뒤 재확인 기한이 붙습니다.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: PartnerOkDto })
  @ApiResponse({ status: 409, description: 'NOT_PENDING', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'REASON_REQUIRED · BROKER', type: ErrorDto })
  @Audit('BROKER_DECIDE', 'BUSINESS')
  decide(@Param('id') id: string, @Body() dto: BrokerDecideDto) {
    return this.svc.decide(id, dto.state, dto.reason);
  }
}
