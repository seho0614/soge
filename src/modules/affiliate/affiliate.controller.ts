import { Body, Controller, Get, Headers, Ip, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AffiliateService } from './affiliate.service';
import { AffiliateAccountService } from './affiliate-account.service';
import { AffiliateAdminService } from './affiliate-admin.service';
import {
  CreateLinkDto, CreateProductDto, UpdateProductDto, SetGoalDto,
  ReviewMaterialDto, SettleRunDto, AffiliatePayoutAccountDto, AffiliateInquiryDto,
  VerifySettlementAccountDto, CreateMaterialDto, CreateGuideDto, UpdateGuideDto,
} from './affiliate.dto';
import { Roles, RequireGate } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/**
 * 파트너센터 — 제휴수수료 트랙.
 *
 * ── 사장님 결정 (2026-09-22) ──────────────────────────────────
 * 파트너는 **제휴상품 링크를 뿌리고 건당 정액 수수료**를 받습니다.
 * 자기 서비스를 팔거나 소개비를 받지 않습니다.
 *
 * ── 주소가 `partner/affiliate/*` 인 까닭 ──────────────────────
 * 기존 `partner/*` 에 중개사·의료 인증 같은 **다른 것이 남아**
 * 있습니다. 같은 주소를 두면 뒤엣것이 조용히 무시됩니다.
 *
 * ── 이것만 소개뱅크가 돈을 냅니다 ─────────────────────────────
 *   소개비      당사자끼리 — 플랫폼 공제 0원 (INV-9)
 *   제휴수수료  **회사가 파트너에게 지급** — 마케팅비
 */
@ApiTags('AFFILIATE')
@ApiBearerAuth()
@Controller('api/v1')
export class AffiliateController {
  constructor(private readonly svc: AffiliateService, private readonly admin: AffiliateAdminService,
              private readonly account: AffiliateAccountService) {}   // v10.108 — 정산 계좌 · 1원 인증은 AffiliateAccountService(docs/168)   // v10.92 — 운영 화면은 AffiliateAdminService

  /* ── 파트너 ───────────────────────────────────────────────── */

  @Get('partner/affiliate/dashboard')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '대시보드',
    description: '이번 달 수익 · 목표 달성률 · 최근 주문. 목표는 운영이 정합니다.',
  })
  dashboard() { return this.svc.dashboard(); }

  @Get('partner/affiliate/links')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({ summary: '내 소개링크', description: '링크별 클릭 · 주문 수를 함께 봅니다.' })
  links() { return this.svc.links(); }

  @Post('partner/affiliate/links')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '링크 발급',
    description:
      '상품마다 링크를 따로 냅니다. **어디에 쓸지 이름을 붙이십시오** — ' +
      '블로그와 카톡을 나눠야 어느 쪽이 되는지 압니다.',
  })
  @Audit('PARTNER_LINK_CREATE', 'PARTNER')
  createLink(@Body() dto: CreateLinkDto) { return this.svc.createLink(dto); }

  @Get('partner/affiliate/orders')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '주문 현황',
    description:
      '**귀속은 72시간 last-click** 입니다. 클릭 후 사흘이 지나 주문하면 ' +
      '수수료가 붙지 않습니다.',
  })
  orders(@Query('state') state?: string) { return this.svc.orders(state); }

  @Get('partner/affiliate/revenues')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({ summary: '수익관리', description: '월별 수익과 주문 내역.' })
  revenues(@Query('ym') ym?: string) { return this.svc.revenues(ym); }

  @Get('partner/affiliate/settlements')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '정산내역',
    description: '지급 예정과 지급 완료. **인증된 계좌가 없으면 지급되지 않습니다.**',
  })
  settlements() { return this.svc.settlements(); }

  @Post('partner/affiliate/settlement-account')
  @Roles('MEMBER', 'BIZ_OWNER')
  /* ★ 2026-10-01 결정(Q4) — 본인인증 필수. 계좌 명의가 회원 본인인지 확인할 첫 단계입니다.
   *   DB(C997 fn_pstl_account_identity)도 같은 규칙으로 막습니다. */
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '정산 계좌 등록',
    description: '**본인인증 후에만** 등록됩니다. 번호는 암호화해 두고 뒤 4자리만 보여 드립니다.',
  })
  @Audit('PARTNER_ACCOUNT_SET', 'PARTNER')
  setAccount(@Body() dto: AffiliatePayoutAccountDto) { return this.account.setAccount(dto); }

  /* ── 정산 계좌 1원 인증 (D001) ──────────────────────────────────
   * 계좌를 등록·변경하면 인증이 풀립니다. 전에는 다시 인증할 길이 없어
   * 운영 지급 창구에 「계좌 1원 인증 전」이 영영 남았습니다. */

  @Post('partner/affiliate/settlement-account/verify/request')
  @Roles('MEMBER', 'BIZ_OWNER')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '정산 계좌 1원 받기',
    description:
      '등록한 계좌로 1원을 보내고 **입금자명에 코드**를 찍습니다. 코드는 10분 동안 유효합니다.\n\n' +
      '계좌인증 연동 전(스텁)에는 실제로 보내지 않고 `stub:true` · `devCode` 를 돌려줍니다. ' +
      '다시 받기는 30초 간격입니다.',
  })
  @ApiResponse({ status: 409, description: 'NO_ACCOUNT — 등록된 계좌 없음' })
  @ApiResponse({ status: 422, description: 'TOO_MANY_TRIES · TOO_SOON · BANK_SEND_FAILED' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    ok: { type: 'boolean' }, verified: { type: 'boolean' }, stub: { type: 'boolean' },
    expiresAt: { type: 'string', format: 'date-time' }, triesLeft: { type: 'integer' },
    devCode: { type: 'string', description: '스텁일 때만' }, note: { type: 'string' } } } })
  @Audit('PARTNER_ACCOUNT_VERIFY_SEND', 'PARTNER')
  requestVerify() { return this.account.requestVerify(); }

  @Post('partner/affiliate/settlement-account/verify')
  @Roles('MEMBER', 'BIZ_OWNER')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '정산 계좌 1원 인증 확인',
    description:
      '입금자명의 코드를 적으면 인증됩니다. **다섯 번 틀리면 막힙니다** — 계좌를 다시 등록해야 풀립니다. ' +
      '인증되면 운영 지급 창구의 「계좌 1원 인증 전」이 풀립니다.',
  })
  @ApiResponse({ status: 409, description: 'NO_ACCOUNT · NOT_REQUESTED' })
  @ApiResponse({ status: 422, description: 'CODE_MISMATCH · CODE_EXPIRED · TOO_MANY_TRIES' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    ok: { type: 'boolean' }, verified: { type: 'boolean' }, verifiedAt: { type: 'string', format: 'date-time' },
    bankName: { type: 'string' }, last4: { type: 'string' }, stub: { type: 'boolean' }, note: { type: 'string' } } } })
  @Audit('PARTNER_ACCOUNT_VERIFY', 'PARTNER')
  confirmVerify(@Body() dto: VerifySettlementAccountDto) { return this.account.confirmVerify(dto.code); }

  @Get('partner/affiliate/products')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({ summary: '추천상품', description: '지금 판매 중인 제휴상품만 나옵니다.' })
  products() { return this.svc.products(); }

  @Get('partner/affiliate/materials')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '마케팅자료실',
    description: '**심의를 통과한 자료만** 나옵니다 — 뿌리는 순간 회사가 한 말이 됩니다. ' +
      '파일이 있으면 `fileId` — 내려받기는 GET /files/{fileId} (**ACTIVE 파트너만**, 5분짜리 주소).',
  })
  materials() { return this.svc.materials(); }

  @Get('partner/affiliate/guides')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({ summary: '파트너가이드', description: '첨부가 있으면 `fileId` — GET /files/{fileId} 로 내려받습니다(ACTIVE 파트너만).' })
  guides() { return this.svc.guides(); }

  @Get('partner/affiliate/inquiries')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({ summary: '내 문의' })
  inquiries() { return this.svc.inquiries(); }

  @Post('partner/affiliate/inquiries')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({ summary: '1:1 문의' })
  ask(@Body() dto: AffiliateInquiryDto) { return this.svc.ask(dto); }

  /* ── 공개 — 제휴 링크 클릭 (D001) ───────────────────────────── */

  @Get('r/:code')
  @ApiOperation({
    summary: '제휴 링크 열기 (클릭 기록)',
    description:
      '공유 주소 `/r/{code}` 가 부릅니다. 클릭을 **하루·방문자당 한 번** 세고(partner_link_stats) ' +
      '이동할 착지 주소를 돌려줍니다. 방문자는 날짜를 섞은 해시로만 남깁니다 — IP·UA 원문 저장 없음. ' +
      '미리보기 로봇은 세지 않습니다.\n\n' +
      '착지 주소는 http/https 또는 내부 경로(/…)만 나갑니다. ' +
      '없는 코드·중지된 링크·판매 중 아닌 상품은 404 (code 로 까닭 구분).',
  })
  @ApiParam({ name: 'code', example: 'PTN-DDEFEA6C' })
  @ApiHeader({ name: 'X-Visitor-Key', required: false, description: '사이트 방문자 쿠키(sgb_visitor) 값 — 중복 제거용' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    code: { type: 'string' }, landingUrl: { type: 'string', description: 'http/https 절대주소 또는 /내부경로' },
    counted: { type: 'boolean', description: '이번 요청이 클릭으로 세졌는가' }, bot: { type: 'boolean' } } } })
  @ApiResponse({ status: 404, description: 'NOT_FOUND · LINK_INACTIVE · PARTNER_INACTIVE · PRODUCT_NOT_ON_SALE · BAD_LANDING' })
  click(
    @Param('code') code: string,
    @Headers('x-visitor-key') visitorKey?: string,
    @Headers('user-agent') ua?: string,
    @Headers('x-forwarded-for') xff?: string,
    @Ip() ip?: string,
  ) {
    return this.svc.click(code, {
      visitorKey, ua, ip: (xff?.split(',')[0]?.trim() || ip) ?? undefined,
    });
  }

  /* ── 운영 BO ──────────────────────────────────────────────── */

  @Get('admin/affiliates/applications')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '파트너 입점 심사',
    description: '신청 목록과 사업자 정보. **사업자 인증을 마친 곳만** 승인하십시오.',
  })
  applications() { return this.admin.applications(); }

  @Post('admin/affiliates/applications/:id/decide')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '입점 승인 · 반려', description: '반려면 사유를 적으십시오.' })
  @Audit('PARTNER_APPROVE', 'PARTNER')
  decide(@Param('id') id: string, @Body() dto: ReviewMaterialDto) {
    return this.admin.decideApplication(id, dto);
  }

  @Get('admin/affiliates/products')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '제휴상품 목록' })
  adminProducts() { return this.admin.adminProducts(); }

  @Post('admin/affiliates/products')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '제휴상품 등록',
    description: '**건당 정액**입니다. 비율이 아닌 것은 거래액을 우리가 못 보기 때문입니다.',
  })
  @Audit('AFFILIATE_PRODUCT_CREATE', 'PRODUCT')
  createProduct(@Body() dto: CreateProductDto) { return this.admin.createProduct(dto); }

  @Patch('admin/affiliates/products/:id')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '단가 · 상태 변경',
    description:
      '단가를 바꾸면 이력이 남습니다. **이미 생긴 주문에는 소급하지 않습니다** — ' +
      '소급하면 이미 정산한 것이 흔들립니다.',
  })
  @Audit('AFFILIATE_PRODUCT_UPDATE', 'PRODUCT')
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.admin.updateProduct(id, dto);
  }

  @Get('admin/affiliates/goals')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '목표 현황', description: '**개인별 설정이 등급 일괄보다 우선합니다.**' })
  goals(@Query('ym') ym?: string) { return this.admin.goals(ym); }

  @Post('admin/affiliates/goals')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '목표 설정' })
  @Audit('PARTNER_GOAL_SET', 'PARTNER')
  setGoal(@Body() dto: SetGoalDto) { return this.admin.setGoal(dto); }

  @Get('admin/affiliates/settlements')
  @Roles('ADMIN', 'SUPER', 'PAYOUT')
  @ApiOperation({
    summary: '정산 현황',
    description: '**트랙별로 따로 돕니다** — 소개비와 제휴수수료는 주기가 다를 수 있습니다.',
  })
  adminSettlements() { return this.admin.adminSettlements(); }

  @Post('admin/affiliates/settlements/run')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '정산 배치 실행',
    description: '확정된 주문을 모아 정산서를 만듭니다. **지급은 별도 승인**입니다.',
  })
  @Audit('PARTNER_SETTLE_RUN', 'SETTLEMENT')
  runSettle(@Body() dto: SettleRunDto) { return this.admin.runSettle(dto); }

  /* ── 마케팅자료 · 파트너가이드 등록 (D007) ─────────────────── */

  @Post('admin/affiliates/materials')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '마케팅자료 등록',
    description:
      '**심의 대기(PENDING)로만** 들어갑니다 — 심의를 통과해야 파트너에게 나갑니다. ' +
      '파일은 먼저 POST /files(purpose=MARKETING_MATERIAL) → PUT → complete 로 올리고 fileId 를 넘기십시오. ' +
      'COPY 는 문구만, 나머지는 파일 필수(이미지 · 배너 JPG/PNG · 영상 MP4 · 문서 PDF/JPG/PNG — DB 가 봅니다).',
  })
  @ApiResponse({ status: 422, description: 'MATERIAL_FILE_REQUIRED · MATERIAL_BODY_REQUIRED · FILE(용도 · 상태 · 형식)' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    ok: { type: 'boolean' }, id: { type: 'string', format: 'uuid' }, state: { type: 'string', example: 'PENDING' }, note: { type: 'string' } } } })
  @Audit('MATERIAL_CREATE', 'MATERIAL')
  createMaterial(@Body() dto: CreateMaterialDto) { return this.admin.createMaterial(dto); }

  @Get('admin/affiliates/guides')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '파트너가이드 전체', description: '꺼진 것까지 모두.' })
  @ApiOkResponse({ schema: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string', format: 'uuid' }, title: { type: 'string' }, body: { type: 'string' }, sortOrder: { type: 'integer' },
    isActive: { type: 'boolean' }, updatedAt: { type: 'string', format: 'date-time' },
    fileId: { type: 'string', format: 'uuid', nullable: true }, fileName: { type: 'string', nullable: true },
    fileType: { type: 'string', nullable: true }, fileSize: { type: 'integer', nullable: true } } } } })
  adminGuides() { return this.admin.adminGuides(); }

  @Post('admin/affiliates/guides')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '파트너가이드 등록',
    description: '바로 파트너가이드에 보입니다. 첨부는 POST /files(purpose=PARTNER_GUIDE) 로 올린 READY 파일.',
  })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    ok: { type: 'boolean' }, id: { type: 'string', format: 'uuid' }, isActive: { type: 'boolean' }, note: { type: 'string' } } } })
  @Audit('GUIDE_CREATE', 'GUIDE')
  createGuide(@Body() dto: CreateGuideDto) { return this.admin.createGuide(dto); }

  @Patch('admin/affiliates/guides/:id')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '파트너가이드 고치기 · 끄기', description: '끄면 파트너에게 안 보이고 첨부도 내려받을 수 없습니다.' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    ok: { type: 'boolean' }, id: { type: 'string', format: 'uuid' }, isActive: { type: 'boolean' }, note: { type: 'string' } } } })
  @Audit('GUIDE_UPDATE', 'GUIDE')
  updateGuide(@Param('id') id: string, @Body() dto: UpdateGuideDto) { return this.admin.updateGuide(id, dto); }

  @Get('admin/affiliates/materials/queue')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '마케팅자료 심의 큐' })
  materialQueue() { return this.admin.materialQueue(); }

  @Post('admin/affiliates/materials/:id/review')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '자료 심의',
    description: '**반려 사유를 적으십시오** — 안 적으면 같은 자료가 다시 올라옵니다.',
  })
  @Audit('MATERIAL_REVIEW', 'MATERIAL')
  reviewMaterial(@Param('id') id: string, @Body() dto: ReviewMaterialDto) {
    return this.admin.reviewMaterial(id, dto);
  }
}
