import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MeService } from './me.service';
import { SettlementService } from '../settlement/settlement.service';
import {
  MySettlementDueDto,
  MyDealDto, MyInquiryDto, MyListingDto, MySettlementDto,
  MarkReadResultDto, MyDisputeDto, MySubscriptionDto, NotificationDto,
  ContractListDto, UpdateProfileDto, UpdateBusinessDto, MyHomeDto, MyConversationDto,
  NotificationPrefsDto, SetNotificationPrefDto, TaxInvoiceDto } from './me.dto';
import { Audit } from '../../core/audit.interceptor';
import { ListingCardDto } from '../listing/listing.dto';
import { Roles, RequireGate } from '../../core/auth';

/** SB-MYP-* 마이페이지 */
@ApiTags('MYP')
@ApiBearerAuth()
@Controller('api/v1/me')
/* ★ /me/** 는 **본인 것만** 보이는 자리입니다.
 *   표시가 없으면 토큰 없이도 200 이 나가고, 나중에 그 안에
 *   개인정보를 담는 순간 조용히 샙니다.
 *   역할이 아니라 **로그인 여부**만 봅니다 — 특정 역할을 요구하면
 *   사업자가 못 들어가는 곳이 생깁니다. */
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'SUPER')
/* 나의공간은 개인·사업자 모두 씁니다.
 * MEMBER 전용으로 두면 사업자가 자기 관심·알림·구독을 못 봅니다. */
@Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
export class MeController {
  constructor(private readonly svc: MeService, private readonly stl: SettlementService) {}

  @Get('listings')
  /* v10.31 — 본인인증 개인도 매물을 등록합니다(약관 제4조). 전에는 사업자만 열람(403)이라 나의공간 메뉴 숫자(4)와 목록(403)이 달랐습니다.
   *   본인 매물만 돌려주므로 로그인 여부(컨트롤러 @Roles)로 충분합니다. */
  @ApiOperation({
    summary: '내 리스팅',
    description: '반려 건은 rejectReasonLabel · rejectFixGuide(고치는 법)가 함께 옵니다. 행마다 조회 · 관심 · 문의(1:1 대화) 수 · 업종 · 등급(v10.31).',
  })
  @ApiOkResponse({ type: MyListingDto, isArray: true })
  listings(@Query('limit') limit?: number) { return this.svc.listings(limit); }

  @Get('deals')
  @ApiOperation({
    summary: '내 거래',
    description: 'myPart 로 이 거래에서 내 역할(매수·매도·소개자)을 알려줍니다.',
  })
  @ApiOkResponse({ type: MyDealDto, isArray: true })
  deals(@Query('limit') limit?: number) { return this.svc.deals(limit); }

  @Get('home')
  @ApiOperation({
    summary: '나의공간 첫 화면',
    description: '프로필 한 줄 · 요약 4칸(진행 중 소개 · 성사 · 정산 대기 · 누적 수익) · 바로가기 숫자. 모두 본인 것만 셉니다.',
  })
  @ApiOkResponse({ type: MyHomeDto })
  home() { return this.svc.home(); }

  @Get('conversations')
  @ApiOperation({
    summary: '받은 문의 · 보낸 문의 (1:1 대화)',
    description:
      'role=RECEIVED 는 내 매물 · 요청에 온 문의, SENT 는 내가 보낸 문의입니다. ' +
      'listingId 를 주면 그 매물의 대화만, id 를 주면 그 대화 하나만 돌려줍니다. ' +
      '상대 이름은 첫 글자만(김○○) 내립니다.',
  })
  @ApiQuery({ name: 'role', required: false, enum: ['SENT', 'RECEIVED'] })
  @ApiQuery({ name: 'listingId', required: false })
  @ApiQuery({ name: 'id', required: false })
  @ApiOkResponse({ type: MyConversationDto, isArray: true })
  conversations(@Query('role') role?: string, @Query('listingId') listingId?: string,
                @Query('id') id?: string, @Query('limit') limit?: number) {
    return this.svc.conversations({ role, listingId, id, limit });
  }

  @Get('settlements')
  /* v10.28 (지시서 5절) — 본인인증 개인도 소개비를 받습니다(INV-10R). 전: BUSINESS_VERIFIED */
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '정산 목록',
    description: '본인인증 회원(개인 · 사업자). payee 는 BUSINESS(사업자로 받음) · PERSON(개인으로 받음). amount 는 공제 없는 소개비 전액입니다.',
  })
  @ApiOkResponse({ type: MySettlementDto, isArray: true })
  settlements() { return this.svc.settlements(false); }

  @Get('settlements/due')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '받을 소개비 — 아직 정산 줄이 없는 성사 거래',
    description: '내가 소개자이고 성사가 확정됐으며 소개비 약정이 있는데 정산 줄이 없는 거래. 개인이 받을 계좌를 나중에 확인한 경우 여기서 「소개비 받기」를 누릅니다.',
  })
  @ApiOkResponse({ type: MySettlementDueDto, isArray: true })
  due() { return this.svc.settlementsDue(); }

  @Get('settlements/history')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({ summary: '지급 내역' })
  @ApiOkResponse({ type: MySettlementDto, isArray: true })
  history() { return this.svc.settlements(true); }

  @Post('settlements/:id/tax-invoice')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '세금계산서 발행 표시 (v10.31 · 시안 지급 내역 「미발행」)',
    description: '세금계산서는 소개자가 직접 발행합니다 — 회사가 대신 발행하지 않습니다. 사업자로 받은 · 지급 완료된 내 정산만, 한 번만 표시합니다.',
  })
  @Audit('SETTLEMENT_TAX_INVOICE', 'SETTLEMENT')
  @ApiOkResponse({ type: Object })   /* v10.31 합침 — 응답 모양을 문서에(검정 「구현된 API 에 응답 스키마」) */
  taxInvoice(@Param('id') id: string, @Body() dto: TaxInvoiceDto) { return this.svc.markTaxInvoice(id, dto?.no); }

  @Post('settlements/:id/paid')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '받았음 표시 (v10.31 · 정산 승인 단계)',
    description: '운영이 정산서를 확인한(승인됨 · 지급 대기 · APPROVED) 내 정산에만. **당사자가 받았다고 남기는 기록이며 플랫폼이 지급을 확인한 것이 아닙니다(INV-11).** 한 번 표시하면 바꿀 수 없습니다. 승인 전이면 422 STL_PAID.',
  })
  @ApiOkResponse({ type: Object })
  @Audit('SETTLEMENT_PAID_MARK', 'SETTLEMENT')
  markPaid(@Param('id') id: string) { return this.stl.markPaidMine(id); }

  @Get('favorites')
  @ApiOperation({ summary: '관심 목록' })
  @ApiOkResponse({ type: ListingCardDto, isArray: true })
  favorites(@Query('limit') limit?: number) { return this.svc.favorites(limit); }

  @Get('notifications')
  @ApiOperation({ summary: '알림' })
  @ApiQuery({ name: 'unread', required: false, type: Boolean })
  @ApiOkResponse({ type: NotificationDto, isArray: true })
  notifications(@Query('unread') unread?: string, @Query('limit') limit?: number) {
    return this.svc.notifications(unread === '1' || unread === 'true', limit);
  }

  @Patch('notifications/read')
  @ApiOperation({ summary: '알림 전체 읽음' })
  @ApiOkResponse({ type: MarkReadResultDto })
  read() { return this.svc.markRead(); }

  @Get('notification-prefs')
  @ApiOperation({
    summary: '알림 수신 설정 (v10.31 · 시안 「수신 설정」 표)',
    description: '종류별 인앱 · 이메일 · 수신거부 가능 여부. 돈 · 계약이 걸린 알림은 수신거부할 수 없습니다. 이메일은 도메인 인증 전이라 아직 보내지 않습니다(emailReady).',
  })
  @ApiOkResponse({ type: NotificationPrefsDto })
  notificationPrefs() { return this.svc.notificationPrefs(); }

  @Patch('notification-prefs')
  @ApiOperation({ summary: '알림 수신 설정 바꾸기', description: '수신거부할 수 없는 종류를 끄려 하면 409 OPTOUT_FORBIDDEN.' })
  @ApiOkResponse({ type: Object })   /* v10.31 합침 — 응답 모양을 문서에(검정 「구현된 API 에 응답 스키마」) */
  setNotificationPref(@Body() dto: SetNotificationPrefDto) {
    return this.svc.setNotificationPref(dto.eventCode, dto.channel, dto.enabled);
  }

  @Get('inquiries')
  @ApiOperation({ summary: '내 문의 내역' })
  @ApiOkResponse({ type: MyInquiryDto, isArray: true })
  inquiries() { return this.svc.inquiries(); }

  @Get('disputes')
  @ApiOperation({ summary: '내 분쟁', description: '내가 접수한 분쟁만(본인 것). v10.32 — 분쟁 접수 · 처리 현황 표(SB-HOM-ETC-010)가 읽습니다 · 거래 이름 · 유형 글자 포함.' })
  @ApiOkResponse({ type: MyDisputeDto, isArray: true })
  disputes() { return this.svc.disputes(); }

  @Get('subscription')
  @ApiOperation({
    summary: '구독 현황',
    description: '한도 소진을 함께 보여 줍니다 — 업그레이드 판단의 근거입니다.',
  })
  @ApiOkResponse({ type: MySubscriptionDto })
  subscription() { return this.svc.subscription(); }

  @Get('contracts')
  @ApiOkResponse({ type: ContractListDto, isArray: true })
  @ApiOperation({ summary: '내 계약 목록',
    description: '매수·매도 어느 쪽이든 내가 당사자인 계약입니다. stalled 는 3일 넘게 멈춘 건.' })
  contracts() { return this.svc.contracts(); }

  /* ── 프로필 · 사업자 정보 ─────────────────────────────────────
   *
   * ★ 이것이 없으면 회원이 **잘못 적은 것을 평생 못 고칩니다.**
   *   이름을 오타 낸 채로 계약서가 나갑니다.
   *
   *   주소가 `/me/account` 인 것은 `/me/profile` 을 **광고 성향이
   *   이미 쓰기 때문**입니다(ads.controller). 같은 주소를 두 곳이
   *   쓰면 뒤에 등록된 쪽이 조용히 무시됩니다. */

  @Get('account')
  @ApiOperation({
    summary: '내 프로필',
    description:
      '회원 정보와 사업자 정보를 함께 돌려줍니다. ' +
      '**인증이 끝난 항목은 고칠 수 없습니다** — 바꾸시려면 다시 인증하십시오.',
  })
  profile() { return this.svc.profile(); }

  @Patch('account')
  @ApiOperation({
    summary: '프로필 수정',
    description:
      '이름 · 연락처만 고칩니다. **이메일은 로그인 수단이라 여기서 ' +
      '바꾸지 않습니다** — 별도 절차가 필요합니다.',
  })
  updateProfile(@Body() dto: UpdateProfileDto) { return this.svc.updateProfile(dto); }

  @Patch('business')
  @ApiOperation({
    summary: '사업자 정보 수정',
    description:
      '**인증 전에만 고칠 수 있습니다.** 국세청 확인이 끝난 뒤 바꾸면 ' +
      '확인한 내용과 달라져, 그 확인이 무의미해집니다.',
  })
  updateBusiness(@Body() dto: UpdateBusinessDto) { return this.svc.updateBusiness(dto); }
}
