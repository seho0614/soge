import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';

import { DatabaseService } from './db/database.service';
import { ContextMiddleware } from './core/context.middleware';
import { AuthGuard } from './core/auth';
import { AuditInterceptor } from './core/audit.interceptor';
import { PiiAuditInterceptor } from './core/pii-audit.interceptor';
import { CategoryNameInterceptor } from './modules/i18n/category-name.interceptor';
import { ServerTextInterceptor } from './modules/i18n/server-text.interceptor';

import { AttributionEngine } from './engines/attribution/attribution.engine';
import { ExposureEngine } from './engines/exposure/exposure.engine';

import { AuthController } from './modules/identity/auth.controller';
import { AuthService } from './modules/identity/auth.service';
import { PrincipalService } from './modules/identity/principal.service';
import { BusinessService } from './modules/identity/business.service';
import { AuthMiddleware } from './modules/identity/auth.middleware';

import { CatalogController } from './modules/catalog/catalog.controller';
import { CatalogService } from './modules/catalog/catalog.service';
import { CodeService } from './modules/catalog/code.service';
import { TermsController } from './modules/catalog/terms.controller';
import { TermsService } from './modules/catalog/terms.service';

import { ReviewController } from './modules/review/review.controller';
import { AbuseController } from './modules/review/abuse.controller';
import { AbuseService } from './modules/review/abuse.service';
import { ReviewService } from './modules/review/review.service';
import { ReviewRepository } from './modules/review/review.repository';

import { ListingController } from './modules/listing/listing.controller';
import { ListingService } from './modules/listing/listing.service';
import { ListingRepository } from './modules/listing/listing.repository';
import { MyListingController } from './modules/listing/my.controller';
import { ListingEditController, ListingEditService } from './modules/listing/listing-edit.controller';  /* v10.31 w1 */
import { DealSummaryController, DealSummaryService } from './modules/deal/deal-summary.controller';  /* v10.31 w1 */
import { ConversationSummaryController, ConversationSummaryService } from './modules/deal/conversation-summary.controller';  /* v10.31 w1 */
import { FavoriteService } from './modules/listing/favorite.service';

import { RequestController } from './modules/request/request.controller';
import { RequestService } from './modules/request/request.service';

import { DealController } from './modules/deal/deal.controller';
import { DealService } from './modules/deal/deal.service';
import { I18nController } from './modules/i18n/i18n.controller';
import { I18nService } from './modules/i18n/i18n.service';
import { TranslateService } from './modules/i18n/translate.service';
import { BoardTranslateService } from './modules/i18n/board-translate.service';
import { AgentController } from './modules/agent/agent.controller';
import { AgentService } from './modules/agent/agent.service';
import { PartnerServiceFormService } from './modules/partner/partner-service-form.service';
import { PartnerCompanyService } from './modules/partner/partner-company.service';
import { ConversationService } from './modules/deal/conversation.service';
import { AffiliateAccountService } from './modules/affiliate/affiliate-account.service';
import { ReviewShadowService } from './modules/agent/review-shadow.service';
import { AgentChatService } from './modules/agent/agent-chat.service';
import { AgentLookupService } from './modules/agent/agent-lookup.service';
import { AgentDraftService } from './modules/agent/agent-draft.service';
import { DealContractService } from './modules/deal/deal-contract.service';

import { MeController } from './modules/me/me.controller';
import { SearchController } from './modules/search/search.controller';
import { SearchService } from './modules/search/search.service';
import { AffiliateController } from './modules/affiliate/affiliate.controller';
import { AffiliateService } from './modules/affiliate/affiliate.service';
import { AffiliateAdminService } from './modules/affiliate/affiliate-admin.service';
import { RiskLearnController } from './modules/govern/risklearn.controller';
import { RiskLearnService } from './modules/govern/risklearn.service';
import { SearchAdminController } from './modules/search/search-admin.controller';
import { SearchAdminService } from './modules/search/search-admin.service';
import { PayoutController } from './modules/settlement/payout.controller';
import { PayoutService } from './modules/settlement/payout.service';
import { LearnController } from './modules/ai/learn.controller';
import { LearnService } from './modules/ai/learn.service';
import { AuditController } from './modules/govern/audit.controller';
import { AuditService } from './modules/govern/audit.service';
import { GovernController } from './modules/govern/govern.controller';
import { GovernService } from './modules/govern/govern.service';
import { RealtyController } from './modules/realty/realty.controller';
import { RealtyService } from './modules/realty/realty.service';
import { CommunityController } from './modules/community/community.controller';
import { CommunityService } from './modules/community/community.service';
import { PollController } from './modules/community/poll.controller';
import { PollService } from './modules/community/poll.service';
import { MeService } from './modules/me/me.service';
import { MeActivityService } from './modules/me/me-activity.service';
import { MeMoneyService } from './modules/me/me-money.service';
import { MeNotifyService } from './modules/me/me-notify.service';
import { PublicController } from './modules/public/public.controller';
import { HealthController } from './modules/public/health.controller';
import { PublicService } from './modules/public/public.service';
import { SiteController } from './modules/site/site.controller';
import { GeoAdminController, GeoPublicController, GeoReviewController } from './modules/geo/geo.controller';   // v10.46 (D099) 카카오맵
import { GeoService } from './common/geo/geo.service';
import { IntegrationSecretService } from './common/integration/secret.service';
import { IntegrationKeysController, PaymentClientKeyController } from './modules/site/integration-keys.controller';   // v10.128 (D128) 외부 연동 키를 운영 화면에서
import { WeatherAdminController, WeatherPublicController } from './modules/weather/weather.controller';   // v10.49 (D103) 오늘의 날씨
import { WeatherService } from './modules/weather/weather.service';
import { TownFoodAdminController, TownFoodController } from './modules/community/town-food.controller';   // v10.47 (D100) 우리동네 맛집
import { TownFoodService } from './modules/community/town-food.service';
import { TownVerifyController } from './modules/community/town-verify.controller';   // v10.164 (D154) 소개광장 동네 인증
import { TownVerifyService } from './modules/community/town-verify.service';
import { SiteService } from './modules/site/site.service';
import { BillingController } from './modules/billing/billing.controller';
import { BillingService } from './modules/billing/billing.service';
import { SettlementController } from './modules/settlement/settlement.controller';
import { SettlementService } from './modules/settlement/settlement.service';
import { AdminOpsController } from './modules/admin/admin-ops.controller';

/* 공유 파일 — v10.31 (w2) 관 화면 시안 구역 서버(market) · 매물 사진 · 급구/급매 신청 */
import { ListingExtController } from './modules/listing/listing-ext.controller';
import { BizAxisController, MarketAdminController, MarketController, SafetyController } from './modules/market/market.controller';
import { MarketService } from './modules/market/market.service';
import { SafetyService } from './modules/market/safety.service';
import { BizAxisService } from './modules/market/biz-axis.service';
import { WorkerController } from './worker/worker.controller';
import { SchedulerService } from './worker/scheduler.service';

import { CollectController } from './modules/admin/collect.controller';
import { CollectService } from './modules/admin/collect.service';
import { HealthShopController } from './modules/health/health-shop.controller';
import { HealthCatalogService } from './modules/health/health-catalog.service';
import { HealthCheckoutService } from './modules/health/health-checkout.service';
import { HealthPaymentService } from './modules/health/health-payment.service';
import { HealthReturnService } from './modules/health/health-return.service';
import { HealthSettleService } from './modules/health/health-settle.service';
import { HealthAdminController } from './modules/health/health-admin.controller';
import { HealthAdminService } from './modules/health/health-admin.service';
import { HealthOrdersAdminController, HealthOrderConfirmController } from './modules/health/health-orders.controller';
import { HealthOrdersService } from './modules/health/health-orders.service';
import { HealthReviewPublicController, HealthReviewMeController, HealthReviewAdminController, HealthRankController } from './modules/health/health-review.controller';
import { HealthReviewService } from './modules/health/health-review.service';
import { AdminController } from './modules/admin/admin.controller';
import { AdminService } from './modules/admin/admin.service';
import { AdminMemberService } from './modules/admin/admin-member.service';
import { AdminReviewService } from './modules/admin/admin-review.service';
/* v10.31 (w6 · 공유 파일) — 운영 화면 시안 기준 서버 자료 */
import { AdminV31Controller, AdxPublicController, GwanAxesPublicController } from './modules/admin/admin-v31.controller';
import { AdminV31Service } from './modules/admin/admin-v31.service';
import { AdBillingController } from './modules/ads/ad-billing.controller';
import { AdBillingService } from './modules/ads/ad-billing.service';
import { AdsController, AdsAdminController, AdsInternalController } from './modules/ads/ads.controller';
import { AdsService } from './modules/ads/ads.service';
import { AiController, RiskController, AiServerController } from './modules/ai/ai.controller';
import { AiService } from './modules/ai/ai.service';
import { RecurringController, BillingAdminController } from './modules/billing/recurring.controller';
import { RecurringBillingService } from './modules/billing/recurring.service';
import { RecurringBatchService } from './modules/billing/recurring-batch.service';
import { RecurringAdminService } from './modules/billing/recurring-admin.service';
import { RecurringRefundService } from './modules/billing/recurring-refund.service';
import { PayoutAccountService } from './modules/billing/payout-account.service';
import { PartnerController } from './modules/partner/partner.controller';
import { PartnerAdminController } from './modules/partner/partner-admin.controller';   // v10.96 — 컨트롤러 4개를 파일 4개로
import { QualificationController } from './modules/partner/qualification.controller';
import { BrokerAdminController } from './modules/partner/broker-admin.controller';
import { BrokerService } from './modules/partner/broker.service';
import { PartnerService } from './modules/partner/partner.service';
import { PartnerLeadService } from './modules/partner/partner-lead.service';
import { PartnerMoneyService } from './modules/partner/partner-money.service';
import { PartnerAdminService } from './modules/partner/partner-admin.service';
/* v10.31 (W5) — 파트너센터 새 API · 리드 이용료 선불 충전 */
import { PartnerCenterController, PartnerCenterAdminController, MeFulfillmentController } from './modules/partner/partner-center.controller';
import { PartnerCenterService } from './modules/partner/partner-center.service';
import { PartnerCenterAdminService } from './modules/partner/partner-center-admin.service';
import { LeadCashService } from './modules/partner/lead-cash.service';
import { PartnerActorService } from './modules/partner/partner-actor.service';
import { IntroducerController, PointsController, InviteController } from './modules/introducer/introducer.controller';
import { IntroducerService } from './modules/introducer/introducer.service';
import { MainService } from './modules/site/main.service';
import { QualificationService } from './modules/partner/qualification.service';
import { ReportController } from './modules/site/report.controller';
import { EventController } from './modules/site/event.controller';
import { EventService } from './modules/site/event.service';
import { ReportService } from './modules/site/report.service';
import { ComplianceController } from './modules/catalog/compliance.controller';
import { ComplianceService } from './modules/catalog/compliance.service';
import { FileController, FileContentController } from './modules/file/file.controller';
import { FileService } from './modules/file/file.service';
import { MyConsultController, LeadAdminController } from './modules/lead/lead.controller';
import { ConsultController, PartnerAxisController, PartnerAxisAdminController } from './modules/partner/consult.controller';
import { ConsultService } from './modules/partner/consult.service';
import { DirectoryService } from './modules/partner/directory.service';
import { DirectoryController, PartnerDirectoryController, DirectoryAdminController } from './modules/partner/directory.controller';
import { EtaxService } from './modules/etax/etax.service';  /* v10.34 전자세금계산서 어댑터 · 간주 (D093) */
import { MailService } from './common/mail/mail.service';  /* v10.43 메일 발송(SES SMTP) · 상담 인증번호 */
import { MailAdminService } from './common/mail/mail-admin.service';   /* v10.140 (D136) 운영 화면 「메일」 */
import { MailAdminController } from './modules/site/mail-admin.controller';
import { IdentityVerifyService } from './modules/identity/identity-verify.service';   /* v10.141 (D137) 본인인증 표준창 */
import { IdentityVerifyController } from './modules/identity/identity-verify.controller';
import { AlimtalkService } from './common/alimtalk/alimtalk.service';   /* v10.142 (D138) 알림톡 */
import { AlimtalkAdminController } from './modules/site/alimtalk-admin.controller';
import { EsignService } from './modules/deal/esign.service';   /* v10.143 (D139) 전자계약 */
import { EsignController, EsignAdminController } from './modules/deal/esign.controller';
import { IntegTestService } from './modules/site/integ-test.service';   /* v10.144 (D140) 결제 · 계좌 연결 확인 */
import { IntegTestController } from './modules/site/integ-test.controller';
import { SafenumService } from './modules/listing/safenum.service';   /* v10.145 (D141) 050 안심번호 */
import { SafenumController, SafenumAdminController } from './modules/listing/safenum.controller';
import { AccountSecurityController } from './modules/identity/account-security.controller';  /* v10.48 비밀번호 재설정 · 변경 · 탈퇴 · 잠금 */
import { AccountSecurityService } from './modules/identity/account-security.service';
import { EtaxAdminController } from './modules/etax/etax.controller';
import { AttributionController } from './modules/attribution/attribution.controller';
import { LeadService } from './modules/lead/lead.service';

/**
 * 단일 모듈로 둡니다.
 *
 * 배포 단위가 4개이므로 NestJS 모듈까지 쪼개면 경계가 두 벌이 됩니다.
 * 코드 경계는 폴더로, 배포 경계는 ECS 태스크로 나눕니다.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [
    AuthController,
    I18nController,   // v10.93 다국어 기반
    AgentController,  // v10.94 AI 에이전트 틀
    AccountSecurityController,
    CommunityController,
    PollController,
    RealtyController,
    GovernController,
    AuditController,
    LearnController,
    RiskLearnController,
    AffiliateController,
    SearchController,
    SearchAdminController,
    PayoutController,
    CatalogController,
    TermsController,
    ListingController,
    MyListingController,
    ListingEditController,   /* v10.31 w1 — 매물 수정 초안 · 검수 결과 */
    DealSummaryController,   /* v10.31 w1 — 거래 구간 머리 */
    ConversationSummaryController,   /* v10.31 w1 — 1:1 문의 요약 · 보내기 전 확인 */
    RequestController,
    DealController,
    ReviewController,
    MeController,
    PublicController,
    HealthController,
    SiteController,
    BillingController,
    SettlementController,
    AdminOpsController,
    WorkerController,
    AdminController,
    AdminV31Controller, AdxPublicController, GwanAxesPublicController,
    HealthShopController,
    HealthAdminController,
    HealthOrdersAdminController,
    HealthOrderConfirmController,
    HealthReviewPublicController,
    HealthReviewMeController,
    HealthReviewAdminController,
    HealthRankController,
    CollectController,
    AdBillingController,
    AdsController,
    AbuseController,
    AdsInternalController,
    AdsAdminController,
    AiController,
    AiServerController,
    RiskController,
    IntroducerController,
    PointsController,
    InviteController,
    PartnerController,
    PartnerAdminController,
    PartnerCenterController, PartnerCenterAdminController, MeFulfillmentController,
    QualificationController,
    BrokerAdminController,
    ReportController,
    EventController,
    ComplianceController,
    RecurringController,
    BillingAdminController,
    FileController,
    FileContentController,
    /* ★ 상담 신청(D018) — 정액 노출 목록(consult/directory/:code)이 신청 경로(consult/requests)와 겹치지 않게 먼저 둡니다 */
    DirectoryController,
    ConsultController,
    MyConsultController,
    PartnerAxisController,
    PartnerAxisAdminController,
    PartnerDirectoryController,
    DirectoryAdminController,
    EtaxAdminController,
    LeadAdminController,
    AttributionController,
    ListingExtController, MarketController, MarketAdminController, SafetyController, BizAxisController,   // v10.31 (w2)
    GeoPublicController,
    GeoAdminController,
    GeoReviewController,   // v10.46 (D099) 카카오맵
    WeatherPublicController,
    WeatherAdminController,   // v10.49 (D103) 오늘의 날씨
    TownFoodController,
    TownFoodAdminController,   // v10.47 (D100) 우리동네 맛집
    TownVerifyController,   // v10.164 (D154) 동네 인증
    IntegrationKeysController,
    MailAdminController,   // v10.140 (D136) 운영 화면 › 외부 연동 › 메일
    IdentityVerifyController,   // v10.141 (D137) 본인인증 표준창 · 운영 화면 「본인인증」
    AlimtalkAdminController,   // v10.142 (D138) 운영 화면 › 외부 연동 › 알림톡
    EsignController, EsignAdminController,   // v10.143 (D139) 전자계약 요청 · 웹훅 · 운영 화면 「전자계약」
    IntegTestController,   // v10.144 (D140) 운영 화면 › 외부 연동 › 결제 · 계좌 연결 확인
    SafenumController, SafenumAdminController,   // v10.145 (D141) 전화하기 · 통화 웹훅 · 운영 화면 「안심번호」
    PaymentClientKeyController,   // v10.128 (D128) 외부 연동 키
  ],
  providers: [
    GeoService,   /* v10.46 (D099) 카카오맵 */
    IntegrationSecretService,   /* v10.128 (D128) 외부 연동 키 — process.env 에 얹음 */
    WeatherService,   /* v10.49 (D103) 오늘의 날씨 */
    TownFoodService,   /* v10.47 (D100) 우리동네 맛집 */
    TownVerifyService,   /* v10.164 (D154) 동네 인증 */
    ListingEditService,   /* v10.31 w1 */
    DealSummaryService,   /* v10.31 w1 */
    ConversationSummaryService,   /* v10.31 w1 */
    AdminV31Service,
    HealthCatalogService, HealthCheckoutService, HealthPaymentService, HealthReturnService, HealthSettleService,   // v10.86 — 건강몰 서비스를 나눔
    HealthAdminService,
    HealthOrdersService,
    HealthReviewService,
    CollectService,
    AdBillingService,
    EventService,
    AbuseService,
    DatabaseService,
    AdsService,
    AiService,
    IntroducerService,
    MainService,
    PartnerService, PartnerCenterService, PartnerServiceFormService, PartnerCompanyService,   // v10.108
    PartnerCenterAdminService, LeadCashService, PartnerActorService,   // v10.39 — 내 파트너 · 신청 줄 찾기 한 곳
    PartnerLeadService, PartnerMoneyService,   // v10.86 — 파트너 리드 · 이용료를 나눔
    PartnerAdminService,                                                          // v10.45 — 파트너 운영(adm*)을 나눔
    QualificationService,
    BrokerService,
    ReportService,
    ComplianceService,
    RecurringBillingService, RecurringRefundService, PayoutAccountService,   // v10.45 — 환불 · 정산 계좌를 나눔
    RecurringBatchService, RecurringAdminService,   // v10.86 — 정기 청구 배치 · 운영 조회를 나눔
    FileService,
    AttributionEngine, ExposureEngine,
    AuthService, PrincipalService, BusinessService, AccountSecurityService,
    CatalogService, CodeService, TermsService,
    ReviewService, ReviewRepository,
    ListingService, ListingRepository, FavoriteService,
    RequestService,
    DealService, DealContractService, ConversationService,   // v10.92 · v10.108
    I18nService,   // v10.93
    TranslateService,   // v10.104 등록 글 자동 번역(D118)
    BoardTranslateService,   // v10.105 소개광장 볼 때 번역(D119)
    AgentService,  // v10.94
    ReviewShadowService,   // v10.106 AI 검수 보조(병행 · D120)
    AgentChatService,      // v10.109 AI 상담 안내(D121)
    AgentLookupService,    // v10.137 AI 상담 3단계 내 정보 조회(D133)
    AgentDraftService,     // v10.139 AI 상담 4단계 신청서 초안(D135)
    MeService, MeActivityService, MeMoneyService, MeNotifyService,   // v10.96
    CommunityService,
    PollService,
    RealtyService,
    GovernService,
    AuditService,
    LearnService,
    RiskLearnService,
    SearchAdminService,
    PayoutService,
    AffiliateService, AffiliateAdminService, AffiliateAccountService,   // v10.92 · v10.108
    SearchService,
    PublicService,
    SiteService,
    BillingService,
    SettlementService,
    SchedulerService,
    AdminService, AdminMemberService, AdminReviewService,   // v10.96
    LeadService,
    ConsultService,
    DirectoryService,
    EtaxService,
    MailService,
    MailAdminService,
    IdentityVerifyService,
    AlimtalkService,
    EsignService,
    IntegTestService,
    SafenumService,
    MarketService, SafetyService, BizAxisService,   // v10.31 (w2)
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: PiiAuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: CategoryNameInterceptor },   // v10.107 업종 이름을 화면 언어로(docs/166)
    { provide: APP_INTERCEPTOR, useClass: ServerTextInterceptor },   // v10.125 서버 안내 글을 화면 언어로(docs/189)
  ],
  exports: [DatabaseService, AttributionEngine, ExposureEngine],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // 순서가 중요합니다. 컨텍스트가 먼저 열려야 인증이 actor 를 담을 수 있습니다.
    consumer.apply(ContextMiddleware, AuthMiddleware).forRoutes('*');
  }
}
