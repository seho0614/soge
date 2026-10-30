import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { AdminMemberService } from './admin-member.service';
import { AdminReviewService } from './admin-review.service';
import {
  AdminBusinessDto, AdminDealDto, AdminSettlementDto, AdminSummaryDto,
  DecideSettlementDto, ReviewReasonDto, SiteSettingDto, UpdateSettingDto,
} from './admin.dto';
import { ErrorDto } from '../../common/dto/common.dto';
import { AccountStatusDto, ReasonDto } from './admin.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { PiiAccess } from '../../core/pii-audit.interceptor';

/** SB-ADM-DSH-010 · USR-010 · DEL-010 · STL-010 · SIT-070 */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly memberSvc: AdminMemberService, private readonly reviewSvc: AdminReviewService) {}   // v10.96 — 회원 · 사업자 / 검수 이유

  @Get('summary')
  @ApiOperation({
    summary: '대시보드 요약',
    description:
      '지표를 나열하지 않고 "지금 사람이 손대야 하는 것"만 셉니다. ' +
      '자동 처리가 기본이므로 이 숫자가 0 이면 할 일이 없다는 뜻입니다.',
  })
  @ApiOkResponse({ type: AdminSummaryDto })
  summary() { return this.admin.summary(); }

  @Get('businesses')
  @PiiAccess('BUSINESS', '사업자 승인 심사')
  @ApiOperation({ summary: '사업자 신청 목록', description: '미승인 건이 위로 옵니다.' })
  @ApiOkResponse({ type: AdminBusinessDto, isArray: true })
  businesses(@Query('q') q?: string) { return this.memberSvc.businesses(q); }

  @Patch('businesses/:id/reject')
  @ApiOperation({ summary: '사업자 신청 반려', description: 'v10.31 — 시안 「반려」. 사유 필수 · 검수 대기 건도 반려로 닫고 신청자에게 알립니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'ALREADY_DECIDED', type: ErrorDto })
  @Audit('BUSINESS_REJECT', 'BUSINESS')
  rejectBusiness(@Param('id') id: string, @Body() dto: ReasonDto) { return this.memberSvc.rejectBusiness(id, dto.reason); }

  @Patch('businesses/:id/verify')
  @ApiOperation({
    summary: '사업자 승인',
    description:
      '승인 시각이 **소개비 수령 자격의 기준일**입니다 (INV-10). ' +
      'account_type 이 BUSINESS 로 승격되고 BIZ_OWNER 역할이 부여됩니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'ALREADY_VERIFIED', type: ErrorDto })
  @Audit('BUSINESS_VERIFY', 'BUSINESS')
  verify(@Param('id') id: string) { return this.memberSvc.verifyBusiness(id); }

  @Get('deals')
  @PiiAccess('ACCOUNT', '거래 모니터링')
  @ApiOperation({
    summary: '거래 모니터링',
    description: '**조회 전용입니다.** 관리자도 임의로 성사를 확정할 수 없습니다 (INV-4).',
  })
  @ApiOkResponse({ type: AdminDealDto, isArray: true })
  deals() { return this.admin.deals(); }

  @Get('settlements')
  @ApiOperation({
    summary: '정산 목록',
    description:
      '지급 대기 건이 위로 옵니다. 소개비는 당사자끼리 직접 지급하며 ' +
      '플랫폼은 자금을 보관하거나 이체하지 않습니다(INV-11).',
  })
  @ApiOkResponse({ type: AdminSettlementDto, isArray: true })
  settlements() { return this.admin.settlements(); }

  @Patch('settlements/:id')
  @ApiOperation({
    summary: '정산 승인 · 반려',
    description:
      'v10.31 (10/10 시안 기준) — `status=APPROVED` 로 승인, `REJECTED`(사유 필수)로 반려합니다. ' +
      '승인은 정산서 확인일 뿐 플랫폼이 돈을 받거나 보내지 않습니다(INV-11). 지급은 당사자가 직접 하고, 지급 표시도 당사자만 합니다. ' +
      '승인자는 운영(ADMIN · SUPER)이며 그 거래의 당사자는 승인할 수 없습니다(2인 원칙) · 분쟁 · 받을 계좌 미확인 · 예금주 불일치는 422.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminSettlementDto })
  @ApiResponse({ status: 409, description: 'ALREADY_DECIDED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'STL_APPROVE(2인 원칙 · 분쟁 · 계좌) · REASON_REQUIRED', type: ErrorDto })
  @Audit('SETTLEMENT_DECIDE', 'SETTLEMENT')
  decide(@Param('id') id: string, @Body() dto: DecideSettlementDto) {
    return this.admin.decideSettlement(id, dto.status, dto.rejectReason);
  }

  @Get('site-settings')
  @ApiOperation({
    summary: '사이트 설정',
    description: '`isRequiredForOpen` 항목이 비면 운영 배포가 막힙니다.',
  })
  @ApiOkResponse({ type: SiteSettingDto, isArray: true })
  settings() { return this.admin.siteSettings(); }

  @Patch('site-settings')
  @ApiOperation({ summary: '설정 변경', description: '푸터 법정 고지가 여기서 채워집니다.' })
  @ApiResponse({ status: 409, description: '없는 키', type: ErrorDto })
  @ApiResponse({ status: 403, description: 'AI_SETTING_SUPER — AI 설정(agent.* · AI 번역)은 최고 관리자만(v10.129)', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'SETTING_FORMAT · SWITCH_PREREQ(AI 전체는 AI 키 · 월 상한 > 0 이 먼저) · MODEL_UNPRICED(요금표에 없는 모델 · v10.135) · PRIVACY_FIRST(처리방침 1.1 게시 전 AI 전체 · agent.require_privacy on · v10.151) · IDENTITY_CHECK_FIRST(NICE 키 확인 7일 안 성공 전 NICE · identity.require_check on · v10.153) · ETAX_CONFIG_FIRST(ETAX_URL · ETAX_KEY 없이 간주 끄기 · etax.require_config on · v10.153)', type: ErrorDto })
  @Audit('SITE_SETTING_UPDATE', 'SITE_SETTING')
  update(@Body() dto: UpdateSettingDto) { return this.admin.updateSetting(dto.key, dto.value); }

  @Get('review-reasons')
  @ApiOperation({
    summary: '반려 사유 코드',
    description: '자유서술이 아니라 코드값입니다. 사유 분포가 다음 자동화 후보를 알려 줍니다.',
  })
  @ApiOkResponse({ type: ReviewReasonDto, isArray: true })
  reasons() { return this.reviewSvc.reviewReasons(); }

  /* ── 회원 상세 (운영) ─────────────────────────────────────────
   *
   * ★ 이것이 없으면 운영이 **신고를 받아도 누구인지 못 봅니다.**
   *   분쟁이 들어와도 그 사람의 거래 이력을 확인할 수 없습니다. */

  @Get('accounts')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '회원 목록',
    description: '이름 · 이메일 · 연락처로 찾습니다. 탈퇴 회원은 기본으로 빼고 보여 줍니다.',
  })
  @Audit('ACCOUNT_LIST', 'ACCOUNT')
  accounts(@Query('q') q?: string, @Query('limit') limit?: number, @Query('status') status?: string) {
    return this.memberSvc.accounts(q, limit, status && ['ACTIVE', 'SUSPENDED'].includes(status) ? status : undefined);
  }

  @Get('accounts-counts')
  @ApiOperation({ summary: '회원 수(정상 · 정지)', description: 'v10.31 — 회원 관리 탭 숫자' })
  accountCounts() { return this.memberSvc.accountCounts(); }

  @Patch('accounts/:id/status')
  @ApiOperation({
    summary: '회원 상태 변경(정상 ↔ 정지)',
    description: 'v10.31 — 시안 회원 상세 「상태 변경」. 사유 필수 · 기록(account_status_changes). 자기 자신 · 최고 관리자는 바꿀 수 없습니다. 정지하면 로그인이 막히고 소개코드가 멈춥니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @Audit('ACCOUNT_STATUS', 'ACCOUNT')
  setStatus(@Param('id') id: string, @Body() dto: AccountStatusDto) { return this.memberSvc.setAccountStatus(id, dto.status, dto.reason); }

  @Patch('accounts/:id/posting-suspension/lift')
  @ApiOperation({ summary: '등록 일시 정지 풀기', description: 'v10.31 — 제한업종 · 금칙 표현 반려 3회로 걸린 7일 등록 정지를 운영이 풉니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @Audit('POSTING_SUSPENSION_LIFT', 'ACCOUNT')
  liftPosting(@Param('id') id: string) { return this.memberSvc.liftPostingSuspension(id); }

  @Get('accounts/:id')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '회원 상세',
    description:
      '회원 정보 · 사업자 · 등록 · 거래 · 신고를 한 화면에 모읍니다. ' +
      '**조회 자체가 감사 로그에 남습니다** — 남의 정보를 들여다보는 일이라 ' +
      '누가 언제 봤는지 기록이 필요합니다(개인정보 보호법 29조).',
  })
  @Audit('ACCOUNT_VIEW', 'ACCOUNT')
  account(@Param('id') id: string) { return this.memberSvc.account(id); }
}
