import { useEffect, useState } from 'react';
import { loadCodes } from './lib/codes';
import { ymdhm } from './lib/act';   // v10.199 — 「주문 받기」 띠의 꺼질 시각
import { api, hasToken, onAuthChange, onIpVerifyNeeded, onMfaNeeded, setToken, tokenRoles, tokenSub } from './lib/api';
import { Login } from './components/Login';
import { MfaGate, type MfaStatus } from './components/MfaGate';
import { IpGate, type IpStatus } from './components/IpGate';
import { PasskeyGate } from './components/PasskeyGate';   // v10.484 (D268) 운영자 패스키
import { onPasskeyNeeded } from './lib/api';   // v10.484 (D268)
import type { PasskeyStatus } from './lib/passkey';   // v10.484 (D268)
import { Dashboard } from './app/admin/Dashboard';
import { ReviewQueue } from './app/admin/ReviewQueue';
import { ReviewDecide } from './app/admin/ReviewDecide';
import { AutoReviewRules } from './app/admin/AutoReviewRules';
import { Badges } from './app/admin/Badges';
import { LsxExpiry, LsxBump, LsxSummary, LsxSaved } from './app/admin/ListingOps';   // v10.513 ~ 516 (D276) ㊻ 매물
import { Disputes } from './app/admin/Disputes';
import { AuditSamples } from './app/admin/AuditSamples';
import { CodeLabels } from './app/admin/CodeLabels';
import { Policies } from './app/admin/Policies';
import { Integrations } from './app/admin/Integrations';
import { Categories } from './app/admin/Categories';
import { Users } from './app/admin/Users';
import { Deals } from './app/admin/Deals';
import { Settlements } from './app/admin/Settlements';
import { Billing } from './app/admin/Billing';
import { OpenChecklist } from './app/admin/OpenChecklist';
import { SiteInfo } from './app/admin/SiteInfo';
import { TermsPanel } from './app/admin/TermsPanel';
import { Partners } from './app/admin/Partners';
import { PartnerAxes } from './app/admin/PartnerAxes';
import { DirectoryAdmin } from './app/admin/DirectoryAdmin';
import { RiskAlerts } from './app/admin/RiskAlerts';
import { OpsAlerts } from './app/admin/OpsAlerts';   // v10.179 (D168)
import { PiiReview } from './app/admin/PiiReview';   // v10.179 (D168)
import { RoleReview } from './app/admin/RoleReview';   // v10.180 (D169)
import { PurgeLog } from './app/admin/PurgeLog';   // v10.180 (D169)
import { PrivacyRequests } from './app/admin/PrivacyRequests';   // v10.181 (D170)
import { ServerErrors } from './app/admin/ServerErrors';   // v10.182 (D171)
import { OpsBoard } from './app/admin/OpsBoard';   // v10.286 (D213)
import { SiteSettings } from './app/admin/SiteSettings';   // v10.287 (D214)
import { AdminSearch } from './app/admin/AdminSearch';   // v10.289 전체 찾기
import { MyMfa } from './app/admin/MyMfa';   // v10.180 (D169)
import { MyPasskey } from './app/admin/MyPasskey';   // v10.484 (D268) 내 2단계 인증 화면 아래 패스키 구역
import { SecGeo } from './app/admin/SecGeo';   // v10.485 (D268) 해외 접속 경고
import { OpxArchive, OpxRisk, OpxBulk, OpxSwitches } from './app/admin/Opx';   // v10.509 ~ 512 (D275) 기록 장기 보관 · 이상 거래 점수 · 일괄 처리 · 기능 스위치 한눈에
import { SocLogin, UptStatus } from './app/admin/Uptime';   // v10.497 · 498 (D272) 가동 · 장애 공지 · 간편 로그인
import { MktCampaigns } from './app/admin/MktCampaigns';   // v10.483 (D268) 문자 · 메일 캠페인
import { PtnOpenApi, PtnBulkInvite } from './app/admin/PartnerOpenApi';   // v10.521 · 522 (D278) 파트너 오픈 API · 직원 일괄 등록
import { I18nReview } from './app/admin/I18nReview';   // v10.523 (D278) 일본어 · 중국어 검수
import { MbxOps, MbxDmReports } from './app/admin/MemberMbx';   // v10.501 ~ 504 (D273) 회원 편의 기능 · 회원 대화 신고
import { MyPassword } from './app/admin/OpsStaffBoxes';   // v10.369 (docs/504) 내 비밀번호
import { ReportDay, ReportWeek, ReportMonth, ReportWorklog, ReportWorklogBoard, ReportTrend } from './app/admin/Report';   // v10.412 ~ 415 (D250) 보고
import { ErpDocs, ErpDepts, ErpWarehouses, ErpDunning } from './app/admin/Erp';   // v10.433 ~ 436 (D256) 내부 ERP
import { AccountantDesk, ReceiptReader, AccrualBox, ArchiveBox } from './app/admin/AcctExtra';   // v10.437 ~ 440 (D257)
import { FinCardLimits, FinTransfers, FinTargets, FinPartyLedger } from './app/admin/Fin';   // v10.453 ~ 456 (D261) 자금 · 영업
import { SalCrm, AcctBankFeed } from './app/admin/Sales';   // v10.466 · 467 (D264) 영업 기회 · 은행 자동 조회
import { HealthCoupons } from './app/admin/HealthCoupons';   // v10.469 (D264) 소개몰 쿠폰 · 기획전
import { HealthRestock, HealthCashReceipts } from './app/admin/HealthMlx';   // v10.505 · 506 (D274) 소개몰 재입고 알림 · 현금영수증
import { PlazaRanking } from './app/admin/PlazaRanking';   // v10.507 (D274) 소개광장 활동 배지 · 랭킹
import { SiteUsage } from './app/admin/SiteUsage';   // v10.508 (D274) 회원 화면 사용 통계
import { AcctDaybook, AcctCashbook, AcctFxReval } from './app/admin/AcctBooks';   // v10.449 ~ 452 (D260)
import { AcctVehicles, AcctCashPlan, AcctExemptInvoices, AcctReorder } from './app/admin/AcctOps';   // v10.475 ~ 478 (D266) 사무 · 자금
import { HrAttend, HrLeave, AcctPayslip, AcctYearend, MyHr } from './app/admin/Hr';   // v10.445 ~ 448 (D259)
import { HrxOvertime, HrxShifts, HrxBooking, HrxStocktake, MyHrx } from './app/admin/Hrx';   // v10.471 ~ 474 (D265) 인사 4
import { OfcCalendar, OfcTasks, OfcTrips, OfcNotifyBox, BrowserNotify } from './app/admin/Ofc';   // v10.462 ~ 465 (D263) 사무 2
import { HrTraining, HrContracts, HrReviews, HrRecruit, MyHrMore } from './app/admin/HrPeople';   // v10.458 ~ 461 (D262)
import { ApprovalInbox, ApprovalLines, BudgetPeriod, CorpDocs } from './app/admin/Office';   // v10.424 ~ 427 (D253) 사무 · 분기 · 연 예산
import { ItsAssets, ItsSuggest, ItsSurvey } from './app/admin/Its';   // v10.491 ~ 493 (D270) 사무 · 보안
import { LglLicenses, LglReviews, LglCases, LglInsurance } from './app/admin/Legal';   // v10.486 ~ 489 (D269) 법무
import { PermAdmin, PermReadonlyBar, PermScope, loadPerm, permVisible, usePermTick } from './app/admin/Perm';   // v10.441 ~ 444 (D258) 업무별 권한 · 탭 내용 감싸기
import { AcctInsurance, AcctWageStatements, AcctWhtReturn } from './app/admin/AcctFilings';   // v10.420 ~ 422 (D252) 신고 자료
import { AcctAccounts, AcctBank, AcctCards, AcctCashflow, AcctExpenses, AcctJournal, AcctMonth, AcctPurchases, AcctReport, AcctStock, AcctTax, AcctStatements, AcctLedger, AcctAssets, AcctBudget, AcctVatForm, AcctAging, AcctYearClose, AcctPayroll, AcctPg, AcctManual, AcctSeverance, AcctCorpTax, AcctParties, AcctContracts, AcctRequisitions, AcctImports, AcctExports, AcctPos, AcctTaxInbox } from './app/admin/Acct';   // v10.381 ~ 384 (D242 · docs/517 ~ 520) 회계
import { MySessions, SettingScheduleBox } from './app/admin/OpsPlanBoxes';   // v10.377 · 380 (docs/513 · 516) 설정 예약 변경 · 내 로그인 기기
import { StaffAccess } from './app/admin/StaffAccess';   // v10.226 (D195)
import { HelpManual } from './app/admin/HelpManual';   // v10.203 (D180)
import { FaqAdmin } from './app/admin/FaqAdmin';   // v10.332 (D224)
import { OpsGuide } from './app/admin/OpsGuide';   // v10.339 (D229)
import { StaffSession } from './app/admin/StaffSession';
import { PiiReasonGate } from './components/PiiReasonGate';   // v10.359 (D236) 개인정보 열람 사유   // v10.357 · 360 (D236) 자동 로그아웃 · 비밀번호 나이
import { GuideFlows } from './app/admin/GuideFlows';   // v10.347 (D233)
import { InquiryDesk } from './app/admin/InquiryDesk';   // v10.333 (D225)
import { Ads } from './app/admin/Ads';
import { Gwans } from './app/admin/Gwans';
import { MainOps } from './app/admin/MainOps';
import { Qualifications } from './app/admin/Qualifications';
import { Hub } from './app/admin/Hub';
import { Reports } from './app/admin/Reports';
import { ReportQueue } from './app/admin/ReportQueue';
import { Events } from './app/admin/Events';
import { AiOps } from './app/admin/AiOps';
import { AdBilling } from './app/admin/AdBilling';
import { PrxAbTests, PrxAdReports, PrxPopups, PrxRefEvents } from './app/admin/Prx';   // v10.517 ~ 520 (D277)
import { Collect } from './app/admin/Collect';
import { RoleAdmin } from './app/admin/RoleAdmin';
import { Payouts } from './app/admin/Payouts';
import { Members } from './app/admin/Members';
import { Community } from './app/admin/Community';
import { Polls } from './app/admin/Polls';
import { Ownership } from './app/admin/Ownership';
import { HealthSettle } from './app/admin/HealthSettle';
import { HealthSellerTab } from './app/admin/HealthSellerTab';
import { HealthOpenStock } from './app/admin/HealthOpenStock';   // v10.208 (D185)
import { QltSupEval, QltLots, QltClaims } from './app/admin/Quality';   // v10.494 ~ 496 (D271) 협력사 평가 · 로트 · 유통기한 · 품질 클레임
import { HealthProducts } from './app/admin/HealthProducts';
import { Translations } from './app/admin/Translations';
import { HealthOrders } from './app/admin/HealthOrders';
import { HealthReviews } from './app/admin/HealthReviews';
import { HealthPoints, HealthTiers, HealthSubscribe, HealthGiftcards } from './app/admin/HealthBenefits';   // v10.479 ~ 482 (D267) 소개몰 회원 혜택
import { Affiliates } from './app/admin/Affiliates';
import { Audit } from './app/admin/Audit';
import { Invariants } from './app/admin/Invariants';
import { Integ } from './app/admin/Integ';
import { GwanUx } from './app/admin/GwanUx';
import { Adx } from './app/admin/Adx';
import { Footer, type FooterLink } from './components/Footer';
import { TABS, GROUPS, PAGE, SUB_PAGE, SUB_GROUP, groupOf, type Tab } from './lib/adminMenu';
import { AdminTree } from './app/admin/AdminTree';   // v10.457 왼쪽 메뉴 트리
import { hashSub } from './lib/hashSub';
import { siteUrl } from './lib/siteUrl';
import { ThemeToggle } from './components/ThemeToggle';   // v10.470 (docs/608) 다크 모드

/* v10.29 — 탭 목록 · 시안 묶음 · 제목 줄은 lib/adminMenu.ts 로 옮겼습니다(키 · 글자는 그대로) */

/* ── 탭별 역할 (20260930) ─────────────────────────────────────────────
 * 서버가 막는 탭을 보여 주면 눌러도 403 만 납니다(실측 — 검수자 계정으로 30탭 중 26탭).
 * 값은 각 탭이 부르는 API 의 @Roles 를 역할별 계정으로 실제로 눌러 확인한 결과입니다.
 * 적히지 않은 탭은 ADMIN · SUPER. 서버 권한이 바뀌면 여기도 바꾸십시오. */
/* 2026-10-02 — 'gwans' 를 뺐습니다. 관 관리 목록 · 순서 · 랜딩(SB-ADM-GWN-010)은 서버가 ADMIN 에게도
 * 열려 있습니다. 안의 새 관 · 설정 · 공유 경계는 SUPER 에게만 보입니다(Gwans.tsx).
 * 'mainops' · 'integrations' 는 레지스트리가 ADMIN · SUPER 이지만 서버가 SUPER 만 받아 그대로 둡니다. */
/* v10.31 (10/10 결함) — 「자동검수 규칙」(REV-030) · 「메인 운영」(MAIN-010)은 matrix 대로 ADMIN|SUPER.
 *   서버도 같이 열었습니다(정책 읽기 · 자동검수 값 · 금칙어 · 배너 · 공지). 메인 운영 안의 관 노출 · 화면 구성 · 콘텐츠(MAIN-020~040)는 SUPER 만(MainOps.tsx). */
const SUPER_ONLY = ['checklist', 'policy', 'integrations', 'hub', 'codes', 'integ', 'terms', 'pii-review', 'role-review'];   /* v10.180 role-review — 운영자 권한 점검은 SUPER 만 */   /* v10.179 pii-review — 개인정보 접속기록 점검은 SUPER 만 */   /* v10.161 terms — 약관 API 는 SUPER 만 */
const TAB_ROLES: Partial<Record<Tab, string[]>> = {
  home: ['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF'],
  /* v10.194 (D173 · docs/304) — 안심 파트너 담당 · 제휴 파트너 담당은 그 쪽 화면만(돈을 움직이는 API 는 서버가 ADMIN 만) */
  partners: ['ADMIN', 'SUPER', 'PARTNER_MAL'],
  'partner-axes': ['ADMIN', 'SUPER', 'PARTNER_MAL'],
  directory: ['ADMIN', 'SUPER', 'PARTNER_MAL'],
  'ptn-openapi': ['ADMIN', 'SUPER', 'PARTNER_MAL'], 'ptn-bulk': ['ADMIN', 'SUPER', 'PARTNER_MAL'],   // v10.521 · 522 (D278) — 발급 · 설정은 서버가 SUPER 만
  'i18n-review': ['ADMIN', 'SUPER'],   // v10.523 (D278) — 검수 기록은 서버가 SUPER 만
  quals: ['ADMIN', 'SUPER', 'PARTNER_MAL'],
  affiliates: ['ADMIN', 'SUPER', 'PARTNER_AFF'],
  /* 2026-10-01 결정 Q1 — 지급 담당의 작업 화면. 확정은 운영, 지급은 지급 담당 */
  payouts: ['ADMIN', 'SUPER', 'PAYOUT'],
  /* v10.31 — 퍼블리셔 지급: 신청 · 승인은 운영, 집행은 지급 담당 */
  'adx-payout': ['ADMIN', 'SUPER', 'PAYOUT'],
  queue: ['ADMIN', 'SUPER', 'REVIEWER'],
  badges: ['ADMIN', 'SUPER', 'REVIEWER'],
  'lsx-expiry': ['ADMIN', 'SUPER', 'REVIEWER'], 'lsx-summary': ['ADMIN', 'SUPER', 'REVIEWER'], 'lsx-bump': ['ADMIN', 'SUPER'], 'lsx-saved': ['ADMIN', 'SUPER'],   // v10.513 ~ 516 (D276)
  audit: ['ADMIN', 'SUPER', 'REVIEWER'],
  /* v10.180 (D169) — 내 2단계 인증은 운영 역할 모두 */
  'my-mfa': ['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'],
  'my-password': ['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'],   // v10.369 (docs/504) · v10.437 세무사
  /* v10.381 ~ 384 (D242) — 회계: 보기 SUPER · 지급 담당 · 고치기 · 마감 SUPER(상품 과세는 ADMIN 도 — 계정 · 규칙 탭) */
  'acct-journal': ['SUPER', 'PAYOUT'], 'acct-tax': ['SUPER', 'PAYOUT'], 'acct-report': ['SUPER', 'PAYOUT'], 'acct-accounts': ['SUPER', 'PAYOUT', 'ADMIN'], 'acct-month': ['SUPER', 'PAYOUT'], 'acct-bank': ['SUPER', 'PAYOUT'],
  'acct-statements': ['SUPER', 'PAYOUT'], 'acct-ledger': ['SUPER', 'PAYOUT'], 'acct-assets': ['SUPER', 'PAYOUT'], 'acct-budget': ['SUPER', 'PAYOUT'],   // v10.396 ~ 399 (D246)
  'acct-vatform': ['SUPER', 'PAYOUT'], 'acct-aging': ['SUPER', 'PAYOUT'], 'acct-yearclose': ['SUPER', 'PAYOUT'], 'acct-payroll': ['SUPER', 'PAYOUT'],   // v10.400 ~ 403 (D247)
  'acct-whtreturn': ['SUPER', 'PAYOUT'], 'acct-wagestmt': ['SUPER', 'PAYOUT'], 'acct-insurance': ['SUPER', 'PAYOUT'],   // v10.420 ~ 422 (D252)
  'acct-pg': ['SUPER', 'PAYOUT'], 'acct-manual': ['SUPER', 'PAYOUT'], 'acct-severance': ['SUPER', 'PAYOUT'], 'acct-corptax': ['SUPER', 'PAYOUT'],   // v10.404 ~ 407 (D248)
  'acct-parties': ['SUPER', 'PAYOUT'], 'acct-contracts': ['SUPER', 'PAYOUT'], 'acct-imports': ['SUPER', 'PAYOUT'], 'acct-exports': ['SUPER', 'PAYOUT'], 'acct-po': ['SUPER', 'PAYOUT'],   // v10.428 (D254)   // v10.408 · 409 · 411 (D249)
  'acct-docs': ['SUPER', 'PAYOUT', 'ADMIN'], 'acct-depts': ['SUPER', 'PAYOUT'], 'acct-wh': ['SUPER', 'PAYOUT'], 'acct-dunning': ['SUPER', 'PAYOUT'],   // v10.433 ~ 436 (D256)
  'acct-taxinbox': ['SUPER', 'PAYOUT'],   // v10.432 (D255)
  'acct-accountant': ['SUPER', 'PAYOUT', 'ACCOUNTANT'], 'acct-receipt': ['SUPER', 'PAYOUT'], 'acct-accrual': ['SUPER', 'PAYOUT'], 'acct-archive': ['SUPER', 'PAYOUT'],   // v10.437 ~ 440 (D257)
  'acct-cardlimit': ['SUPER', 'PAYOUT'], 'fin-transfer': ['SUPER', 'PAYOUT'], 'acct-target': ['SUPER', 'PAYOUT'], 'acct-partyledger': ['SUPER', 'PAYOUT'],   // v10.453 ~ 456 (D261)
  'sal-crm': ['SUPER', 'PAYOUT', 'ADMIN'], 'acct-bankfeed': ['SUPER', 'PAYOUT'],   // v10.466 · 467 (D264)
  'acct-daybook': ['SUPER', 'PAYOUT'], 'acct-cashbook': ['SUPER', 'PAYOUT'], 'acct-fxreval': ['SUPER', 'PAYOUT'],   // v10.449 ~ 452 (D260)
  'acct-requisitions': ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'],   // v10.410 (D249) 품의는 운영자 누구나
  'rpt-day': ['ADMIN', 'SUPER'], 'rpt-week': ['ADMIN', 'SUPER'], 'rpt-month': ['ADMIN', 'SUPER'], 'rpt-board': ['SUPER'], 'rpt-trend': ['ADMIN', 'SUPER'],   // v10.429 (D254)   // v10.412 ~ 415 (D250)
  'approvals': ['ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF', 'SUPER'], 'approval-lines': ['ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF', 'SUPER'], 'corp-docs': ['ADMIN', 'PAYOUT', 'SUPER'],   // v10.424 · 425 (D253)
  'its-assets': ['SUPER', 'ADMIN', 'PAYOUT'], 'its-suggest': ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'], 'its-survey': ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'],   // v10.491 ~ 493 (D270)
  'lgl-licenses': ['SUPER', 'ADMIN'], 'lgl-reviews': ['SUPER', 'ADMIN'], 'lgl-cases': ['SUPER', 'ADMIN'], 'lgl-insurance': ['SUPER', 'ADMIN', 'PAYOUT'],   // v10.486 ~ 489 (D269) 법무
  'rpt-worklog': ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'],
  'acct-purchase': ['SUPER', 'PAYOUT'], 'acct-cash': ['SUPER', 'PAYOUT'], 'acct-stock': ['SUPER', 'PAYOUT'],   // v10.392 · 394 · 395 (D245)
  'qlt-lots': ['SUPER', 'ADMIN', 'PAYOUT'], 'qlt-claims': ['SUPER', 'ADMIN', 'PAYOUT'], 'qlt-supeval': ['SUPER', 'ADMIN', 'PAYOUT'],   // v10.494 ~ 496 (D271)
  'acct-vehicle': ['SUPER', 'PAYOUT', 'ADMIN'], 'acct-cashplan': ['SUPER', 'PAYOUT'], 'acct-exemptinv': ['SUPER', 'PAYOUT'], 'acct-reorder': ['SUPER', 'PAYOUT', 'ADMIN'],   // v10.475 ~ 478 (D266)
  'acct-expense': ['SUPER', 'PAYOUT', 'ADMIN', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'],   // v10.393 (D245) 경비 청구는 운영자 누구나(법인카드 상자는 SUPER · PAYOUT)
  'ops-guide': ['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF'],   /* v10.339 (D229) 업무 안내 — 운영 역할 모두 읽기 · 고치기 SUPER */
  'guide-flows': ['ADMIN', 'SUPER'],   /* v10.347 (D233) 이용 흐름 — 읽기 ADMIN · 고치기 SUPER */
  /* v10.226 (D195) — 접속 인증: 내 받을 곳은 운영 역할 모두 · 관리 칸은 화면이 ADMIN · SUPER 만 */
  'staff-access': ['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF'],
  /* v10.286 (D213) — 운영자 게시판은 운영 역할 모두 */
  'ops-board': ['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF'],
  'perm-admin': ['SUPER'],   // v10.443 (D258) 권한 관리는 SUPER 만
  'prx-popup': ['ADMIN', 'SUPER'], 'prx-refevent': ['ADMIN', 'SUPER'], 'prx-adreport': ['ADMIN', 'SUPER'], 'prx-adab': ['ADMIN', 'SUPER'],   // v10.517 ~ 520 (D277)
  'opx-archive': ['SUPER'], 'opx-risk': ['ADMIN', 'SUPER'], 'opx-bulk': ['ADMIN', 'SUPER', 'REVIEWER'], 'opx-switches': ['ADMIN', 'SUPER'],   // v10.509 ~ 512 (D275)
  'hr-attend': ['SUPER', 'ADMIN'], 'hr-leave': ['SUPER', 'ADMIN'], 'acct-payslip': ['SUPER', 'PAYOUT', 'ACCOUNTANT'], 'acct-yearend': ['SUPER', 'PAYOUT', 'ACCOUNTANT'],   // v10.445 ~ 448 (D259)
  'my-hr': ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'],   // v10.445 ~ 447 (D259) 본인 것만 · 세무사 빠짐
  'hrx-overtime': ['SUPER', 'ADMIN'], 'hrx-shifts': ['SUPER', 'ADMIN'], 'hrx-stocktake': ['SUPER', 'ADMIN', 'PAYOUT'],   // v10.471 · 472 · 474 (D265)
  'hrx-booking': ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'],   // v10.473 (D265) 운영 역할 모두 · 세무사 빠짐
  'ofc-calendar': ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'], 'ofc-tasks': ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'],
  'ofc-trips': ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'], 'ofc-notify': ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'],   // v10.462 ~ 465 (D263) 사무 2 · 세무사 빠짐
  'hr-training': ['SUPER', 'ADMIN'], 'hr-contract': ['SUPER', 'ADMIN'], 'hr-review': ['SUPER', 'ADMIN'], 'hr-recruit': ['SUPER', 'ADMIN'],   // v10.458 ~ 461 (D262)
  ...Object.fromEntries(SUPER_ONLY.map((t) => [t, ['SUPER']])),
};
/* 2026-10-21 결정 — SUPER 는 모든 탭(서버 AuthGuard 와 같은 규칙: SUPER 는 권한 검사를 항상 통과) */
const canSee = (t: Tab, roles: string[]) =>
  roles.includes('SUPER') || (TAB_ROLES[t] ?? ['ADMIN']).some((r) => roles.includes(r))
  /* v10.437 (D257) — 세무사(ACCOUNTANT)는 회계 탭 중 지급 담당이 보는 것을 읽기로(서버가 GET 만 엶) */
  || (roles.includes('ACCOUNTANT') && String(t).startsWith('acct-') && (TAB_ROLES[t] ?? []).includes('PAYOUT'));

/**
 * 운영 BO.
 *
 * 자동 처리가 기본이므로, 여기 화면들은 "사람이 봐야 하는 것"만 다룹니다.
 * 검수 큐에 자동 승인 건이 안 보이는 것도 같은 이유입니다.
 */
export function App() {
  /* 20260930 — 로그인 전에는 로그인 화면만. 전에는 로그인 없이 전 화면이 403 이었습니다. */
  const [authed, setAuthed] = useState(hasToken());
  /* v10.180 (D169 · docs/281) — 운영자 2단계 인증: 설정상 필요한데 확인 안 됐으면 번호 넣기(등록 안 했으면 등록) 화면만 */
  const [mfa, setMfa] = useState<MfaStatus | null | 'loading'>('loading');
  const checkMfa = () => { api<MfaStatus>('/auth/mfa').then(setMfa).catch(() => setMfa(null)); };
  useEffect(() => onAuthChange(setAuthed), []);
  useEffect(() => { if (authed) checkMfa(); else setMfa('loading'); }, [authed]);
  useEffect(() => onMfaNeeded(checkMfa), []);
  /* v10.226 (D195 · docs/363) — 운영 화면 접속 인증: 켜져 있고 허용 IP 밖에서 오늘 처음이면 인증번호 화면만(2단계 인증 다음) */
  const [ipv, setIpv] = useState<IpStatus | null | 'loading'>('loading');
  const checkIp = () => { api<IpStatus>('/auth/ip-verify').then(setIpv).catch(() => setIpv(null)); };
  useEffect(() => { if (authed) checkIp(); else setIpv('loading'); }, [authed]);
  useEffect(() => onIpVerifyNeeded(checkIp), []);
  /* v10.484 (D268 · docs/622) — 운영자 패스키: EXTRA 면 2단계 · 접속 인증 다음에 패스키 확인 화면 · REPLACE_MFA 면 2단계 화면 대신(「인증 앱 번호로」 누르면 원래 화면) */
  const [pk, setPk] = useState<PasskeyStatus | null>(null);
  const [pkSkip, setPkSkip] = useState(false);
  const checkPk = () => { api<PasskeyStatus>('/auth/passkey').then(setPk).catch(() => setPk(null)); };
  useEffect(() => { if (authed) checkPk(); else { setPk(null); setPkSkip(false); } }, [authed]);
  useEffect(() => onPasskeyNeeded(checkPk), []);
  if (!authed) return <Login />;
  if (mfa === 'loading' || ipv === 'loading') return <p className="muted" style={{ padding: 24 }}>불러오는 중…</p>;
  if (pk && pk.gate === 'REPLACE_MFA' && !pkSkip && mfa && mfa.required && !mfa.verified) return <PasskeyGate mode="REPLACE_MFA" onSkip={() => setPkSkip(true)} onDone={() => { checkMfa(); checkPk(); }} />;
  if (mfa && mfa.required && !mfa.verified) return <MfaGate status={mfa} onDone={checkMfa} />;
  if (ipv && ipv.required && !ipv.verified) return <IpGate status={ipv} onDone={checkIp} />;
  if (pk && pk.gate === 'EXTRA') return <PasskeyGate mode="EXTRA" onDone={checkPk} />;
  return <Console />;
}

/* v10.29 — 지금 보는 탭을 주소(#/탭키)에 남깁니다. 새로 고침 · 뒤로 가기에도 같은 탭이 열리고,
 * 시험이 탭으로 바로 들어갈 수 있습니다(예: http://127.0.0.1:5173/#/hlt-orders). */
const tabFromHash = (): Tab | null => {
  const k = decodeURIComponent(location.hash.replace(/^#\/?/, '').split(/[?/]/)[0] ?? '');
  return (TABS.some(([t]) => t === k) ? k : null) as Tab | null;
};

/* v10.32 — 제목 위 「← 운영 홈」을 그리는 탭(시안 shell() 을 쓰는 화면) */
const BACK_HOME: Tab[] = ['integ', 'adx', 'adx-payout'];

const ROLE_NAME: Record<string, string> = { SUPER: '최고 관리자', ADMIN: '운영', REVIEWER: '검수 담당', PAYOUT: '지급 담당', PARTNER_MAL: '안심 파트너 담당', PARTNER_AFF: '제휴 파트너 담당' };

function Console() {
  const roles = tokenRoles();
  usePermTick();   // v10.444 (D258) 내 업무 권한을 받으면 다시 그림
  useEffect(() => { void loadPerm(); }, []);
  const visible = (t: Tab) => canSee(t, roles) && permVisible(t);   // 역할 + (검사 ON 이고 표에 있는 탭이면) 업무 권한
  const [tab, setTab] = useState<Tab>(() => { const h = tabFromHash(); return h && visible(h) ? h : 'home'; });
  const [open, setOpen] = useState<string | null>(null);
  const [links, setLinks] = useState<FooterLink[]>([]);
  const [settings, setSettings] = useState<Record<string, string | null>>({});
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      loadCodes('ADMIN'),
      api<FooterLink[]>('/footer-links').catch(() => [] as FooterLink[]),
      api<Record<string, string | null>>('/site-settings/public').catch(() => ({})),
    ])
      .then(([, l, s]) => { setLinks(l); setSettings(s); setReady(true); })
      .catch((e: Error) => setErr(e.message));
  }, []);

  /* v10.196 — 「주문 받기 켜짐」 띠용: 공개 설정을 1분마다 · 첫 화면에서 스위치를 바꾸면(bo-settings) 바로 다시 읽음.
   * 11/5 운영에서 켜진 것을 4시간 넘게 아무도 몰랐음 — 어느 화면에 있든 보이게 */
  useEffect(() => {
    const load = () => { api<Record<string, string | null>>('/site-settings/public').then(setSettings).catch(() => { /* 다음 분에 다시 */ }); };
    const t = window.setInterval(load, 60_000);
    window.addEventListener('bo-settings', load);
    return () => { window.clearInterval(t); window.removeEventListener('bo-settings', load); };
  }, []);

  /* v10.32 — 지금 하위 화면(#/탭/하위). SUB_PAGE 에 있으면 제목 줄을 그 화면 제목으로 */
  const [sub, setSub] = useState<string | null>(() => hashSub());
  /* v10.457 — 왼쪽 메뉴 트리: 좁은 화면 서랍 · 넓은 화면 접기(이 브라우저에 기억) */
  const who = tokenSub();
  const [drawer, setDrawer] = useState(false);
  const [folded, setFolded] = useState<boolean>(() => { try { return localStorage.getItem('sgb.admTree.folded') === '1'; } catch { return false; } });
  const foldTree = (v: boolean) => { setFolded(v); try { localStorage.setItem('sgb.admTree.folded', v ? '1' : '0'); } catch { /* 저장 막힘 */ } };
  /* 뒤로 가기 · 주소창에서 바꾼 탭을 따라갑니다 */
  useEffect(() => {
    const on = () => { const h = tabFromHash(); if (h && visible(h)) { setTab(h); setOpen(null); } setSub(hashSub()); };
    const onSub = () => setSub(hashSub());
    window.addEventListener('hashchange', on); window.addEventListener('popstate', on); window.addEventListener('bo-sub', onSub);
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on); window.removeEventListener('bo-sub', onSub); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* v10.31 — 'mainops/gwan' 처럼 하위 탭까지 받습니다(하위 탭은 화면이 주소에서 읽음 · lib/hashSub) */
  function go(t: string) {
    const base = t.split('/')[0]!;
    setTab(base as Tab); setOpen(null);
    if (location.hash !== `#/${t}`) history.pushState(null, '', `#/${t}`);
    window.dispatchEvent(new Event('bo-sub'));
    window.scrollTo(0, 0);
  }

  if (err) return <div className="boot-error">코드 라벨을 불러오지 못했습니다 — {err}</div>;
  if (!ready) return <div className="boot">불러오는 중…</div>;

  const cur = groupOf(tab);
  const groups = GROUPS.map((g) => ({ ...g, tabs: g.tabs.filter(visible) })).filter((g) => g.tabs.length);
  /* v10.32 — 상단바에서 켜 둘 묶음(하위 화면이 시안에서 다른 묶음이면 그 묶음 · SUB_GROUP). 탭 줄은 cur 그대로 */
  const navKey = (sub && SUB_GROUP[`${tab}/${sub}`]) || cur.key;
  const label = (t: Tab) => TABS.find(([k]) => k === t)?.[1] ?? t;
  const page = (sub && SUB_PAGE[`${tab}/${sub}`]) || PAGE[tab];
  const roleText = roles.filter((r) => ROLE_NAME[r]).map((r) => ROLE_NAME[r]).join(' · ');
  /* v10.196 — 간주 결제가 켜진 채 주문 받기가 켜짐 = 손님 주문이 돈 없이 결제 완료됨. 설정을 못 읽었으면(키 없음) 띄우지 않음 */
  const orderLive = 'mall.order_open' in settings && (settings['mall.order_open'] ?? 'on') !== 'off' && (settings['assume.payment'] ?? 'on') === 'on';

  return (
    <div className={`bo${folded ? ' tree-folded' : ''}`}>
      {/* v10.29 — 시안 admNav: 어두운 상단바 · 묶음 메뉴 · 오른쪽 「사용자 화면으로」 */}
      <header className="bo-head">
        <div className="ad-in">
          <a className="ad-lg" href="#/home" onClick={(e) => { e.preventDefault(); go('home'); }}>
            <span className="d" />소개뱅크 <b>운영</b>
          </a>
          {/* v10.457 — 그룹 단추는 왼쪽 트리로 옮김 · 이 단추는 좁은 화면 서랍 열기 · 접은 트리 펴기 */}
          <button className="ad-tr-tg" aria-label="메뉴 열기" data-tree-open="" aria-expanded={drawer || !folded}
                  onClick={() => { if (window.matchMedia('(max-width: 1240px)').matches) setDrawer((d) => !d); else foldTree(!folded); }}>☰ 메뉴</button>
          <div className="ad-hr">
            <AdminSearch onGo={(t) => go(t as Tab)} canGo={(t) => visible(t as Tab)} />   {/* v10.289 전체 찾기 */}
            {roleText && <span className="ad-role">{roleText}</span>}
            <ThemeToggle />   {/* v10.470 (docs/608) 밝게 · 어둡게 — 이 브라우저에만 */}
            <a className="ad-btn" href={siteUrl()} target="_blank" rel="noreferrer">사용자 화면으로</a>
            <button className="ad-btn bo-logout" onClick={() => setToken(null, null)}>로그아웃</button>
          </div>
        </div>
      </header>

      <StaffSession />
      <BrowserNotify />   {/* v10.465 (D263) 브라우저 알림 — 사무 › 내 알림에서 켠 계정만 · 화면을 열어 둔 동안 */}
      {orderLive && (
        <div className="bo-order-live" role="alert" data-order-live-bar="">
          <b>소개몰 「주문 받기」가 켜져 있습니다</b>{settings['mall.order_open_until'] ? <> · <span data-order-live-until="">{ymdhm(settings['mall.order_open_until'])} 에 저절로 꺼짐</span></> : <> · <span data-order-live-until="">꺼질 시각 없음</span></>} — 간주 결제(시험 결제) 상태라 손님 주문이 실제 돈 없이 결제 완료됩니다.{' '}
          <a href="#/home" onClick={(e) => { e.preventDefault(); go('home'); }}>첫 화면 「공개 직후 지켜보기」에서 끄기</a>
        </div>
      )}

      <div className="bo-body">
      <AdminTree groups={groups} tab={tab} navKey={navKey} label={label} go={(t) => go(t)} who={who}
                 drawer={drawer} onClose={() => setDrawer(false)} folded={folded} onFold={foldTree} />
      {drawer && <div className="ad-tr-dim" aria-hidden="true" onClick={() => setDrawer(false)} />}
      <main className="bo-main" data-tab={tab}>
        {page && (
          <div className="ad-pgh">
            {/* v10.32 — 시안 shell()(통합 현황 · 광고 플랫폼 · 퍼블리셔 지급)은 제목 위에 「← 운영 홈」을 둡니다 */}
            {BACK_HOME.includes(tab) && (
              <a className="ad-bk" href="#/home" data-back-home onClick={(e) => { e.preventDefault(); go('home'); }}>← 운영 홈</a>
            )}
            <h1>{page.title}</h1>
            {(page.sub || page.screen) && (
              <p>{page.sub}{page.screen && <span className="ad-sid"> {page.screen}</span>}</p>
            )}
          </div>
        )}
        {/* v10.457 — 같은 묶음의 탭 줄(.ad-snb)은 왼쪽 트리로 옮김(data-tab · data-section 표식 그대로) */}
        {/* v10.444 (D258 · docs/581) — 모든 탭 내용을 한 곳에서 감쌈: 고치기 · 승인 · 내려받기 권한이 없으면 그 단추를 막음(검사 SHADOW · ON · SUPER 아님) */}
        <PermScope tab={tab}>
        {tab === 'home' && <Dashboard onGo={go} canGo={(t) => visible(t as Tab)} />}
        {tab === 'reports' && <Reports />}
        {tab === 'report-queue' && <ReportQueue />}
        {tab === 'events' && <Events />}
        {tab === 'ai-ops' && <AiOps />}
        {tab === 'members' && <Members />}
        {tab === 'community' && <Community />}
        {tab === 'polls' && <Polls />}
        {tab === 'ownership' && <Ownership />}
        {tab === 'hlt-sellers' && <HealthSellerTab />}
        {tab === 'hlt-settle' && <HealthSettle onGo={go} />}
        {tab === 'hlt-products' && <HealthProducts />}
        {tab === 'i18n' && <Translations />}
        {tab === 'i18n-review' && <I18nReview />}
        {tab === 'hlt-orders' && <HealthOrders onGo={go} />}
        {tab === 'hlt-open' && <HealthOpenStock />}
        {tab === 'qlt-lots' && <QltLots />}
        {tab === 'qlt-claims' && <QltClaims />}
        {tab === 'qlt-supeval' && <QltSupEval />}
        {tab === 'hlt-reviews' && <HealthReviews onGo={go} />}
        {tab === 'hlt-points' && <HealthPoints />}
        {tab === 'hlt-tiers' && <HealthTiers />}
        {tab === 'hlt-subscribe' && <HealthSubscribe />}
        {tab === 'hlt-giftcards' && <HealthGiftcards />}
        {tab === 'hlt-coupons' && <HealthCoupons />}
        {tab === 'hlt-restock' && <HealthRestock />}
        {tab === 'hlt-cashrcpt' && <HealthCashReceipts />}
        {tab === 'plz-rank' && <PlazaRanking />}
        {tab === 'site-usage' && <SiteUsage />}
        {tab === 'affiliates' && <Affiliates onGo={go} />}
        {tab === 'gov-audit' && <Audit />}
        {tab === 'invariants' && <Invariants />}
        {tab === 'ad-billing' && <AdBilling />}
        {tab === 'prx-popup' && <PrxPopups />}
        {tab === 'prx-refevent' && <PrxRefEvents />}
        {tab === 'prx-adreport' && <PrxAdReports />}
        {tab === 'prx-adab' && <PrxAbTests />}
        {tab === 'collect' && <Collect />}
      {tab === 'roles' && <RoleAdmin />}
      {tab === 'queue' && (open
          ? <ReviewDecide id={open} onDone={() => setOpen(null)} />
          : <ReviewQueue onOpen={setOpen} />)}
        {tab === 'badges' && <Badges />}
        {tab === 'lsx-expiry' && <LsxExpiry />}
        {tab === 'lsx-bump' && <LsxBump />}
        {tab === 'lsx-summary' && <LsxSummary />}
        {tab === 'lsx-saved' && <LsxSaved />}
        {tab === 'audit' && <AuditSamples />}
        {tab === 'rules' && <AutoReviewRules onGo={visible('policy') ? go : undefined} />}
        {tab === 'disputes' && <Disputes />}
        {tab === 'category' && <Categories />}
        {tab === 'users' && <PiiReasonGate what="사업자 인증"><Users onGo={go} /></PiiReasonGate>}
        {tab === 'deals' && <PiiReasonGate what="거래"><Deals onGo={go} /></PiiReasonGate>}
        {tab === 'settlement' && <Settlements />}
        {tab === 'payouts' && <Payouts />}
        {tab === 'billing' && <Billing />}
        {tab === 'checklist' && <OpenChecklist onGo={go} />}
        {tab === 'policy' && <Policies />}
        {tab === 'settings' && <><SettingScheduleBox /><SiteSettings /></>}
        {tab === 'siteinfo' && <SiteInfo onGo={visible('checklist') ? go : undefined} />}
        {tab === 'terms' && <TermsPanel />}
        {tab === 'manual' && <HelpManual />}
        {tab === 'faq' && <FaqAdmin />}
        {tab === 'ops-guide' && <OpsGuide onGo={go} canGo={(t) => visible(t.split('/')[0] as Tab)} />}
        {tab === 'guide-flows' && <GuideFlows />}
        {tab === 'inquiries' && <InquiryDesk />}
        {tab === 'integrations' && <Integrations />}
        {tab === 'mainops' && <MainOps onGo={go} />}
      {tab === 'gwans' && <Gwans onGo={go} />}
      {tab === 'hub' && <Hub onGo={go} />}
      {tab === 'partners' && <Partners onGo={go} />}
      {tab === 'partner-axes' && <PartnerAxes />}
      {tab === 'directory' && <DirectoryAdmin />}
      {tab === 'ptn-openapi' && <PtnOpenApi />}
      {tab === 'ptn-bulk' && <PtnBulkInvite />}
      {tab === 'quals' && <Qualifications onGo={go} />}
      {tab === 'risk' && <RiskAlerts />}
      {tab === 'ops-alerts' && <OpsAlerts />}
      {tab === 'pii-review' && <PiiReview />}
      {tab === 'role-review' && <RoleReview />}
      {tab === 'purge-log' && <PurgeLog />}
      {tab === 'privacy-requests' && <PrivacyRequests />}
      {tab === 'server-errors' && <ServerErrors />}
      {tab === 'sec-geo' && <SecGeo />}
      {tab === 'opx-archive' && <OpxArchive />}
      {tab === 'opx-risk' && <OpxRisk isSuper={roles.includes('SUPER')} />}
      {tab === 'opx-bulk' && <OpxBulk roles={roles} />}
      {tab === 'opx-switches' && <OpxSwitches onGo={visible('settings') ? go : undefined} />}
      {tab === 'upt-status' && <UptStatus />}
      {tab === 'soc-login' && <SocLogin />}
      {tab === 'mkt-campaign' && <MktCampaigns />}
      {tab === 'mbx-ops' && <MbxOps />}
      {tab === 'mbx-dm' && <MbxDmReports />}
      {tab === 'ops-board' && <OpsBoard />}
      {tab === 'my-mfa' && <><MyMfa /><MyPasskey /></>}
      {tab === 'my-password' && <><MyPassword /><MySessions /></>}
      {tab === 'acct-journal' && <AcctJournal />}
      {tab === 'acct-tax' && <AcctTax />}
      {tab === 'acct-report' && <AcctReport />}
      {tab === 'acct-accounts' && <AcctAccounts />}
      {tab === 'acct-month' && <AcctMonth onGo={(t) => go(t as Tab)} canGo={(t) => visible(t as Tab)} />}
      {tab === 'acct-bank' && <AcctBank />}
      {tab === 'acct-purchase' && <AcctPurchases />}
      {tab === 'acct-expense' && <><AcctExpenses /><AcctCards /></>}
      {tab === 'acct-cash' && <AcctCashflow />}
      {tab === 'acct-stock' && <AcctStock />}
      {tab === 'acct-vehicle' && <AcctVehicles />}
      {tab === 'acct-cashplan' && <AcctCashPlan />}
      {tab === 'acct-exemptinv' && <AcctExemptInvoices />}
      {tab === 'acct-reorder' && <AcctReorder />}
      {tab === 'acct-statements' && <AcctStatements />}
      {tab === 'acct-ledger' && <AcctLedger />}
      {tab === 'acct-assets' && <AcctAssets />}
      {tab === 'acct-budget' && <AcctBudget />}
      {tab === 'acct-budget' && <BudgetPeriod />}   {/* v10.427 (D253) 분기 · 연 예산 */}
      {tab === 'acct-vatform' && <AcctVatForm />}
      {tab === 'acct-aging' && <AcctAging />}
      {tab === 'acct-yearclose' && <AcctYearClose />}
      {tab === 'acct-payroll' && <AcctPayroll />}
      {tab === 'acct-whtreturn' && <AcctWhtReturn />}
      {tab === 'acct-wagestmt' && <AcctWageStatements />}
      {tab === 'acct-insurance' && <AcctInsurance />}
      {tab === 'acct-pg' && <AcctPg />}
      {tab === 'acct-manual' && <AcctManual />}
      {tab === 'acct-severance' && <AcctSeverance />}
      {tab === 'acct-corptax' && <AcctCorpTax />}
      {tab === 'acct-parties' && <AcctParties />}
      {tab === 'acct-contracts' && <AcctContracts />}
      {tab === 'acct-requisitions' && <AcctRequisitions />}
      {tab === 'acct-imports' && <AcctImports />}
      {tab === 'acct-docs' && <ErpDocs />}
      {tab === 'acct-depts' && <ErpDepts />}
      {tab === 'acct-wh' && <ErpWarehouses />}
      {tab === 'acct-dunning' && <ErpDunning />}
      {tab === 'acct-accountant' && <AccountantDesk />}
      {tab === 'acct-receipt' && <ReceiptReader />}
      {tab === 'acct-accrual' && <AccrualBox />}
      {tab === 'acct-archive' && <ArchiveBox />}
      {tab === 'acct-cardlimit' && <FinCardLimits />}
      {tab === 'fin-transfer' && <FinTransfers />}
      {tab === 'acct-target' && <FinTargets />}
      {tab === 'acct-partyledger' && <FinPartyLedger />}
      {tab === 'sal-crm' && <SalCrm />}
      {tab === 'acct-bankfeed' && <AcctBankFeed />}
      {tab === 'acct-daybook' && <AcctDaybook />}
      {tab === 'acct-cashbook' && <AcctCashbook />}
      {tab === 'acct-fxreval' && <AcctFxReval />}
      {tab === 'hr-attend' && <HrAttend />}
      {tab === 'hr-leave' && <HrLeave />}
      {tab === 'acct-payslip' && <AcctPayslip />}
      {tab === 'acct-yearend' && <AcctYearend />}
      {tab === 'my-hr' && <MyHr />}
      {tab === 'my-hr' && <MyHrx />}
      {tab === 'hrx-overtime' && <HrxOvertime />}
      {tab === 'hrx-shifts' && <HrxShifts />}
      {tab === 'hrx-booking' && <HrxBooking />}
      {tab === 'hrx-stocktake' && <HrxStocktake />}
      {tab === 'ofc-calendar' && <OfcCalendar />}
      {tab === 'ofc-tasks' && <OfcTasks />}
      {tab === 'ofc-trips' && <OfcTrips />}
      {tab === 'ofc-notify' && <OfcNotifyBox />}
      {tab === 'my-hr' && <MyHrMore />}
      {tab === 'hr-training' && <HrTraining />}
      {tab === 'hr-contract' && <HrContracts />}
      {tab === 'hr-review' && <HrReviews />}
      {tab === 'hr-recruit' && <HrRecruit />}
      {tab === 'acct-taxinbox' && <AcctTaxInbox />}
      {tab === 'acct-exports' && <AcctExports />}
      {tab === 'acct-po' && <AcctPos />}
      {tab === 'rpt-day' && <ReportDay />}
      {tab === 'rpt-week' && <ReportWeek />}
      {tab === 'rpt-month' && <ReportMonth />}
      {tab === 'rpt-worklog' && <ReportWorklog />}
      {tab === 'rpt-board' && <ReportWorklogBoard />}
      {tab === 'rpt-trend' && <ReportTrend />}
      {tab === 'approvals' && <ApprovalInbox />}
      {tab === 'approval-lines' && <ApprovalLines />}
      <PermReadonlyBar tab={tab} />
      {tab === 'corp-docs' && <CorpDocs />}
      {tab === 'its-assets' && <ItsAssets />}
      {tab === 'its-suggest' && <ItsSuggest />}
      {tab === 'its-survey' && <ItsSurvey />}
      {tab === 'lgl-licenses' && <LglLicenses />}
      {tab === 'lgl-reviews' && <LglReviews />}
      {tab === 'lgl-cases' && <LglCases />}
      {tab === 'lgl-insurance' && <LglInsurance />}
      {tab === 'perm-admin' && <PermAdmin />}
      {tab === 'staff-access' && <StaffAccess />}
      {tab === 'ads' && <Ads />}
      {tab === 'codes' && <CodeLabels />}
      {tab === 'integ' && <Integ />}
      {tab === 'gwan-ux' && <GwanUx onGo={go} />}
      {tab === 'adx' && <Adx view="platform" onGo={go} />}
      {tab === 'adx-payout' && <Adx view="payout" onGo={go} />}
        </PermScope>
      </main>
      </div>

      <Footer links={links} settings={settings} variant="slim" className="bo-foot" />
    </div>
  );
}
