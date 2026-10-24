import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PartnerAdminService } from './partner-admin.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { ServiceReviewDto, VoidFeeDto, PartnerRejectDto, VoidAcceptDto, VoidDismissDto, PartnerOkDto } from './partner.dto';

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
