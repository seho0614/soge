import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PartnerService } from './partner.service';
import { PartnerLeadService } from './partner-lead.service';
import { PartnerMoneyService } from './partner-money.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { BrokerStateDto, BrokerApplyDto, ServiceCreateDto, RegionsDto, FeeDisputeDto, PartnerOkDto } from './partner.dto';

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
