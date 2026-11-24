import { gwanWeeklyJob } from '../modules/site/gwan-weekly';   // v10.694 관별 주간 보고
import { GwanMaintService } from '../modules/site/gwan-maint.service';   // v10.706 (D323)
import { opsBoardPost, sendResult } from '../modules/admin/ops-board.service';   // v10.286 (D213)
import { nginxDenied, nginxListState, nginxWatcher, writeNginxRequest } from '../modules/identity/nginx-allow-script';   // v10.349 · 350 · 353 (docs/483 · 484 · 487)
import { auditChainCheck, securityMonthlyStats, securityMonthlyText } from '../modules/admin/security-report';   // v10.354 · 356 (D235 · docs/488 · 490)
import { csWeeklyStats, csWeeklyText } from '../modules/support/cs-weekly';   // v10.352 (D234 · docs/486)
import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { RecurringBatchService } from '../modules/billing/recurring-batch.service';
import { LeadCashService } from '../modules/partner/lead-cash.service';
import { GeoService } from '../common/geo/geo.service';
import { MailService } from '../common/mail/mail.service';
import { TelegramService } from '../common/telegram/telegram.service';
import { buildAlertPush } from '../common/telegram/alert-push';
import { SlackService } from '../common/slack/slack.service';
import { AlertChannelsService } from '../modules/admin/alert-channels.service';
import { OwnerTodoService, ownerTodoWeeklyText } from '../modules/admin/owner-todo.service';
import { AdminService } from '../modules/admin/admin.service';
import { ServerTrendService } from '../modules/admin/server-trend.service';
import { NotifyMailSender } from '../common/mail/notify-mail';
import { AlimtalkService } from '../common/alimtalk/alimtalk.service';
import { EsignService } from '../modules/deal/esign.service';
import { SafenumService } from '../modules/listing/safenum.service';
import { TranslateService } from '../modules/i18n/translate.service';
import { ReviewShadowService } from '../modules/agent/review-shadow.service';
import { TownPickService } from '../modules/community/town-pick.service';
import { AgentChatService } from '../modules/agent/agent-chat.service';
import { LaunchWatchService, alertsWeekText, termsAlertTitle } from '../modules/admin/launch-watch.service';
import { uploadsBackupState } from '../common/uploads-backup-state';
import { PiiReviewService } from '../modules/admin/pii-review.service';
import { RoleReviewService } from '../modules/admin/role-review.service';
import { PrivacyService } from '../modules/identity/privacy.service';
import { measureServerHealth } from '../common/server-health';
import { maskMail } from '../common/mail/mail-admin.service';   // v10.372 (D239)
import { applyDueSettingSchedules } from '../modules/admin/ops-plan.controller';   // v10.377 (D241)
import { maintNotice, withdrawGraceMail } from '../modules/admin/member-notice-jobs';   // v10.378 · 379 (D241)
import { runJournal } from '../modules/acct/journal';   // v10.382 (D242)
import { ALL_SOURCES } from '../modules/acct/sources';   // v10.392 (D245) — ⑫ 매입 · 경비 · 법인카드 · 재고 전표까지
import { acctCashflowJob } from '../modules/acct/cashflow';   // v10.394 (D245)
import { stockJob } from '../modules/acct/stock';   // v10.395 (D245)
import { acctCashPlanJob } from '../modules/acct/cashplan';   // v10.476 (D266)
import { acctReorderJob } from '../modules/acct/reorder';   // v10.478 (D266)
import { depreciationJob } from '../modules/acct/assets';   // v10.398 (D246)
import { otWeekJob } from '../modules/acct/hrx-overtime';   // v10.471 (D265)
import { budgetJob } from '../modules/acct/budget';   // v10.399 (D246)
import { acctAgingJob } from '../modules/acct/aging';   // v10.401 (D247)
import { acctPgCheckJob } from '../modules/acct/pgsettle';   // v10.404 (D248)
import { acctContractsJob } from '../modules/acct/contracts';   // v10.409 (D249)
import { legalDueJob } from '../modules/legal/lgl-due';   // v10.486 ~ 489 (D269)
import { acctTaxInboxJob } from '../modules/acct/taxinbox';   // v10.432 (D255)
import { opsReportJob } from '../modules/admin/report-period';   // v10.412 (D250)
import { acctInsuranceJob } from '../modules/acct/filings';   // v10.422 (D252)
import { itsKeyExpiryJob } from '../modules/admin/its-keys';   // v10.490 (D270)
import { itsOfficeDailyJob } from '../modules/admin/its-daily';   // v10.491 ~ 493 (D270)
import { sendAfterJob } from '../modules/admin/report-send';     // v10.415 (D250)
import { dunningJob } from '../modules/acct/dunning';   // v10.436 (D256)
import { acctAccrualJob } from '../modules/acct/accrual';   // v10.439 (D257)
import { acctCardLimitJob } from '../modules/acct/cardlimit';   // v10.453 (D261)
import { qltDailyJob, qltLotAllocJob } from '../modules/qlt/jobs';   // v10.495 · 496 (D271)
import { mktCampaignJob } from '../modules/marketing/campaign';   // v10.483 (D268)
import { mkxDailyJob, mkxGroupbuyJob, mkxPushJob } from '../modules/mkx/jobs';   // v10.538 ~ 541 (D283)
import { papiDailyJob, papiHookSendJob, pbulkMatchJob } from '../modules/papi/jobs';   // v10.521 · 522 (D278)
import { papiUsageJob, vsxVisitJob } from '../modules/vsx/jobs';   // v10.542 · 545 (D284)
import { biDailyJob } from '../modules/dtx/bi';   // v10.535 (D282)
import { mallStatementJob } from '../modules/slx/statements';   // v10.532 (D281)
import { smqDailyJob } from '../modules/smq/jobs';   // v10.577 · 579 상품 문의 기한 · 판매자 평가
import { prxAdReportJob, prxHourlyJob } from '../modules/prx/jobs';   // v10.518 ~ 520 (D277)
import { bzxDailyJob, bzxFrequentJob } from '../modules/bzx/jobs';   // v10.609 ~ 614 (docs/751 ~ 756)
import { secDailyPurgeJob } from '../modules/identity/geo-guard';   // v10.485 (D268)
import { uptDailyJob } from '../modules/uptime/uptime';   // v10.497 (D272)
import { opzDailyJob } from '../modules/opz/jobs';   // v10.556 · 557 (D288)
import { grwDailyJob } from '../modules/grw/digest';   // v10.597 · 599 (docs/739 · 741)
import { mallBenefitExpireJob, mallTierJob } from '../modules/health/health-benefit';   // v10.479 · 480 (D267)
import { mallSubscribeJob } from '../modules/health/health-subscribe';   // v10.481 (D267)
import { mallCashReceiptJob } from '../modules/health/health-cashrcpt';   // v10.506 (D274)
import { plzBadgeMonthJob } from '../modules/community/plaza-rank';   // v10.507 (D274)
import { mlxDailyPurgeJob } from '../modules/health/mlx-purge';   // v10.505 · 506 · 508 (D274)
import { mbxDailyJob, mbxPriceDigestJob } from '../modules/mbx/jobs';   // v10.501 ~ 504 (D273)
import { salOppRemindJob } from '../modules/acct/crm';   // v10.466 (D264)
import { acctBankFeedJob } from '../modules/acct/bankfeed';   // v10.467 (D264)
import { trainingDueJob } from '../modules/acct/hr-training';   // v10.458 (D262)
import { applicantPurgeJob } from '../modules/acct/hr-recruit';   // v10.461 (D262)
import { acctBizCheckJob } from '../modules/acct/bizcheck';      // v10.431 (D254)
import { corpDocDueJob } from '../modules/admin/corpdocs';   // v10.425 (D253)
import { prrDailyJob } from '../modules/admin/prr-jobs';   // v10.566 · 568 권한 정기 점검 · 입사퇴사
import { hraDailyJob } from '../modules/acct/hra-close';   // v10.581 ~ 584 (docs/723 ~ 726) 13차 알림 셋
import { ofcTaskDueJob } from '../modules/acct/ofc-tasks';   // v10.463 (D263)
import { lpxHourlyJob, lpxStatsDailyJob } from '../modules/lpx/jobs';   // v10.549 ~ 552 (D286)
import { lsqDailyJob, lsqTrackJob } from '../modules/lsq/jobs';   // v10.602 ~ 607 (docs/744 ~ 749)
import { lsxDailyJob, lsxHourlyJob } from '../modules/lsx/jobs';   // v10.513 ~ 516 (D276)
import { csxDailyJob, csxHourlyJob } from '../modules/csx/jobs';   // v10.528 ~ 531 (D280)
import { lsyHourlyJob, lsyTriageJob } from '../modules/lsy/jobs';   // v10.524 ~ 527 (D279)
import { mtrDailyJob, mtrHourlyJob } from '../modules/mtr/jobs';   // v10.573 ~ 576 11차 회원 · 거래
import { opxArchiveJob, opxRiskDailyJob, opxRiskEventsJob } from '../modules/opx/jobs';   // v10.509 · 510 (D275)
import { sfxDailyJob } from '../modules/sfx/jobs';   // v10.546 ~ 548 (D285)
import { jobFailWatch } from './job-fail-watch';   // v10.627 (D307 · docs/771) 정기 작업 연속 실패 알림
import { sec2TickJob } from '../modules/sec2/jobs';   // v10.590 ~ 593 (docs/732 ~ 735) 15차 보안 · 기반
import { acctDeadlineJob } from '../modules/acct/month';   // v10.390 (D244)
import { opbGroupMail, opbRoutePending } from '../modules/opb/alert-routes';   // v10.572 (docs/714) 운영 알림 받을 사람 규칙

/**
 * 배치 실행기.
 *
 * 앱 프로세스 내 cron 을 쓰지 않습니다 — ECS 태스크가 2개면 두 번 실행됩니다.
 * EventBridge 가 이 엔드포인트를 호출하고, 여기서는 DB 함수를 부르기만 합니다.
 * 판정 로직이 DB 에 있으므로 워커가 죽어도 규칙은 그대로입니다.
 */
export type JobName =
  | 'sla_alert' | 'k_alert' | 'promo_expiry' | 'expire_badges'
  | 'deal_auto_confirm' | 'settlement_audit' | 'attribution_archive' | 'pii_purge'
  | 'subscription_billing' | 'risk_scan' | 'notify_dispatch'
  | 'contract_nudge' | 'ad_expiry_notice' | 'event_close' | 'lead_assign'
  | 'hlt_auto_confirm' | 'hlt_rank' | 'hlt_settle_weekly' | 'launch_watch' | 'launch_digest' | 'lead_cash_auto' | 'directory_expiry'
  | 'geo_backfill' | 'translate_jobs' | 'review_shadow' | 'agent_chat_purge' | 'esign_poll' | 'safenum_release' | 'town_pick_daily'
  | 'seller_license_watch' | 'owner_todo_weekly' | 'hlt_rate_schedule' | 'notice_schedule' | 'ops_board_purge' | 'cs_weekly' | 'security_monthly'
  | 'setting_schedule' | 'withdraw_grace_mail' | 'maint_notice'   // v10.377 ~ 379 (D241)
  | 'gwan_maint'   // v10.706 (D323) 관 점검 시간
  | 'page_link_check'   // v10.750 (D327) 깨진 링크
  | 'page_feedback_purge'   // v10.756 (D328) 한 줄 의견 1년 파기
  | 'acct_journal'    // v10.382 (D242)
  | 'acct_deadline'   // v10.390 (D244)
  | 'acct_cashflow'   // v10.394 (D245)
  | 'acct_stock'      // v10.395 (D245)
  | 'acct_cashplan'   // v10.476 (D266)
  | 'acct_reorder'    // v10.478 (D266)
  | 'acct_depreciation'   // v10.398 (D246)
  | 'hrx_ot_week'     // v10.471 (D265)
  | 'acct_budget'     // v10.399 (D246)
  | 'acct_aging'      // v10.401 (D247)
  | 'acct_pg_check'   // v10.404 (D248)
  | 'acct_contracts'  // v10.409 (D249)
  | 'lgl_due'         // v10.486 ~ 489 (D269)
  | 'acct_taxinbox'   // v10.432 (D255)
  | 'ops_report'      // v10.412 (D250)
  | 'acct_insurance'  // v10.422 (D252)
  | 'its_key_expiry'  // v10.490 (D270)
  | 'its_office_daily'   // v10.491 ~ 493 (D270)
  | 'corp_doc_due'    // v10.425 (D253)
  | 'prr_daily'       // v10.566 · 568
  | 'hra_daily'       // v10.581 ~ 584 (docs/723 ~ 726)
  | 'ofc_task_due'    // v10.463 (D263)
  | 'acct_biz_check'  // v10.431 (D254)
  | 'acct_dunning'    // v10.436 (D256)
  | 'acct_card_limit' // v10.453 (D261)
  | 'qlt_lot_alloc'   // v10.495 (D271)
  | 'qlt_daily'       // v10.495 · 496 (D271)
  | 'mkt_campaign_send' // v10.483 (D268)
  | 'mkx_push_send'     // v10.538 (D283)
  | 'mkx_groupbuy'      // v10.540 (D283)
  | 'mkx_daily'         // v10.539 (D283)
  | 'papi_hook_send'    // v10.521 (D278)
  | 'papi_daily'        // v10.521 (D278)
  | 'pbulk_match'       // v10.522 (D278)
  | 'vsx_visit'         // v10.542 (D284)
  | 'papi_usage'        // v10.545 (D284)
  | 'bi_daily'          // v10.535 (D282)
  | 'mall_statement'    // v10.532 (D281)
  | 'smq_daily'         // v10.577 · 579
  | 'prx_hourly'      // v10.518 · 520 (D277)
  | 'prx_ad_report'   // v10.519 (D277)
  | 'bzx_daily'       // v10.609 (docs/751) 파트너 계약 만기
  | 'bzx_frequent'    // v10.610 · 613 (docs/752 · 755) 광고 예산 · 카드 사용 알림
  | 'sec_daily_purge'   // v10.485 (D268)
  | 'opx_archive'       // v10.509 (D275)
  | 'opx_risk_events'   // v10.510 (D275)
  | 'opx_risk_daily'    // v10.510 (D275)
  | 'sfx_daily'         // v10.546 ~ 548 (D285)
  | 'sec2_tick'         // v10.590 ~ 593 (docs/732 ~ 735)
  | 'upt_daily'         // v10.497 (D272)
  | 'opz_daily'         // v10.556 · 557 (D288)
  | 'grw_daily'         // v10.597 · 599 (docs/739 · 741)
  | 'mall_benefit_expire' // v10.479 (D267)
  | 'mall_tier_recalc'    // v10.480 (D267)
  | 'mall_subscribe'      // v10.481 (D267)
  | 'mall_cash_receipt'   // v10.506 (D274)
  | 'plz_badge_month'     // v10.507 (D274)
  | 'mlx_daily_purge'     // v10.505 · 506 · 508 (D274)
  | 'mbx_price_digest'    // v10.503 (D273)
  | 'mbx_daily'           // v10.501 ~ 504 (D273)
  | 'sal_opp_remind'  // v10.466 (D264)
  | 'acct_bank_feed'  // v10.467 (D264)
  | 'hr_training_due' // v10.458 (D262)
  | 'hr_applicant_purge' // v10.461 (D262)
  | 'lsx_daily'       // v10.513 · 514 (D276)
  | 'lpx_hourly'      // v10.549 · 551 (D286)
  | 'lpx_stats_daily' // v10.552 (D286)
  | 'lsq_daily'       // v10.602 ~ 604 (docs/744 ~ 746)
  | 'lsq_track'       // v10.607 (docs/749)
  | 'lsx_hourly'      // v10.515 · 516 (D276)
  | 'csx_daily'       // v10.529 (D280)
  | 'csx_hourly'      // v10.528 (D280)
  | 'lsy_hourly' | 'lsy_triage'   // v10.524 ~ 527 (D279)
  | 'mtr_hourly' | 'mtr_daily'    // v10.573 ~ 576
  | 'acct_accrual';   // v10.439 (D257)

export interface JobResult {
  job: JobName;
  affected: number;
  detail?: unknown;
  ms: number;
}

@Injectable()
export class SchedulerService {
  private readonly log = new Logger(SchedulerService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly billing: RecurringBatchService,
    private readonly leadCash: LeadCashService,
    private readonly geo: GeoService,
    private readonly mail: MailService,
    private readonly alimtalk: AlimtalkService,
    private readonly esign: EsignService,
    private readonly safenum: SafenumService,
    private readonly translate: TranslateService,
    private readonly reviewShadow: ReviewShadowService,
    private readonly townPick: TownPickService,
    private readonly agentChat: AgentChatService,
    private readonly launchWatch: LaunchWatchService,
    private readonly piiReview: PiiReviewService,   // v10.179 (D168) 개인정보 접속기록 점검 알림
    private readonly roleReview: RoleReviewService,   // v10.180 (D169) 운영자 권한 점검 · 파기 실행 알림
    private readonly privacy: PrivacyService,   // v10.181 (D170) 개인정보 권리 요청 기한 알림
    private readonly telegram: TelegramService,   // v10.200 (D178) 급한 운영 알림 텔레그램
    private readonly slack: SlackService,   // v10.237 (D200) 급한 운영 알림 슬랙
    private readonly channels: AlertChannelsService,   // v10.239 (docs/379) 알림 길 연속 실패 경보
    private readonly ownerTodo: OwnerTodoService,   // v10.249 (D203 · docs/386) 대표 할 일 주간 알림
    private readonly trend: ServerTrendService,   // v10.248 (D203 · docs/386) 서버 자원 하루 기록
    private readonly admin: AdminService,   // v10.317 (D220 · docs/442) 간주 끌 수 있음 알림(간주 모드 끄는 순서)
    private readonly gwanMaint: GwanMaintService,   // v10.706 (D323 · docs/814) 관 점검 시간
  ) {}

  /**
   * 지금 돌아야 할 작업을 찾아 실행합니다.
   *
   * 자리를 먼저 잡습니다. 이미 잡혀 있으면 조용히 넘어갑니다 —
   * 스케줄러가 둘이어도, EventBridge 와 로컬 데몬이 같이 떠 있어도
   * 같은 시간대의 같은 작업은 **한 번만** 실행됩니다.
   *
   * 이 방식이면 "앱 안에 cron 을 두면 두 번 돈다"는 문제가 사라집니다.
   * 두 번 불려도 두 번 돌지 않기 때문입니다.
   */
  async tick(): Promise<{ ran: string[]; skipped: string[] }> {
    const due = await this.db.query<{ job: string; slot: string }>(
      'SELECT job, slot FROM fn_jobs_due()');
    const ran: string[] = [], skipped: string[] = [];

    for (const d of due) {
      const [c] = await this.db.query<{ id: string | null }>(
        'SELECT fn_job_claim($1,$2) AS id', [d.job, d.slot]);
      if (!c?.id) { skipped.push(d.job); continue; }   // 누가 이미 잡았습니다

      let ok = true, affected = 0, detail = '';
      try {
        const r = await this.run(d.job as JobName);
        affected = r.affected ?? 0;
        detail = JSON.stringify(r.detail ?? {}).slice(0, 2000);
      } catch (e: any) {
        ok = false;
        detail = String(e?.message ?? e).slice(0, 2000);
        this.log.error(`배치 ${d.job} 실패: ${detail}`);
      }
      await this.db.query(
        `UPDATE job_runs SET ended_at = now(), ok = $2, affected = $3, detail = $4
          WHERE id = $1`, [c.id, ok, affected, detail]);
      /* v10.627 (D307 · docs/771) 연속 실패 알림 JOB_FAILING · 성공이면 풂 — 알림이 실패해도 작업 기록은 그대로 */
      await jobFailWatch(this.db, d.job, ok).catch((e) => this.log.warn(`JOB_FAILING 확인 실패 ${d.job}: ${String((e as Error)?.message ?? e).slice(0, 200)}`));
      ran.push(d.job);
    }
    return { ran, skipped };
  }

  async run(job: JobName): Promise<JobResult> {
    const t0 = Date.now();
    let affected = 0;
    let detail: unknown;

    switch (job) {
      /** 매시간. 검수 24시간 SLA */
      case 'sla_alert': {
        const [r] = await this.db.query<{ n: number }>(`SELECT fn_check_sla_alert() AS n`);
        affected = r.n;
        // v10.90 — 운영자에게 알릴 길: CloudWatch 필터 「REVIEW_SLA_BREACH」 → 경보 sgb-review-sla(deploy/aws/cloudwatch/setup.sh)
        if (r.n > 0) this.log.warn(`REVIEW_SLA_BREACH 검수 기한 넘김 ${r.n}건 — 운영 화면 › 검수 화면`);
        /* v10.333 (D225 · docs/464) — 1:1 문의 답변 기한(영업일 1일) 넘김도 같은 작업에서(운영 알림 INQUIRY_DUE_BREACH · 0건이면 풂) */
        const [iq] = await this.db.query<{ n: number }>(`SELECT fn_inquiry_due_alert() AS n`);
        if (iq.n > 0) this.log.warn(`INQUIRY_DUE_BREACH 1:1 문의 답변 기한 넘김 ${iq.n}건 — 운영 화면 › 회원 › 1:1 문의`);
        /* v10.342 (D232 · docs/475) — 리드관이 켜져 있을 때 받을 업체 0곳 업종 · 24시간 전달 못 함(꺼지면 풂) */
        const [ld] = await this.db.query<{ n: number }>(`SELECT fn_lead_alert() AS n`);
        if (ld.n > 0) this.log.warn(`LEAD_ALERT 리드관 경고 ${ld.n} — 운영 화면 › 파트너사 › 리드 현황`);
        /* v10.350 (D234 · docs/484) — 기한 지난 허용 IP 빼기(마지막 하나는 남김) · v10.349 (docs/483) Nginx 적용 알림 셋 */
        const ex = await this.staffIpExpire().catch((e) => ({ error: (e as Error).message }));
        const ng = await this.nginxAlerts().catch((e) => ({ error: (e as Error).message }));
        /* v10.356 (D235 · docs/490) — 감사 기록 사슬 확인(마지막 온전 지점부터) · 끊기면 급한 알림 AUDIT_CHAIN_BROKEN */
        const ac = await this.auditChain().catch((e) => ({ error: (e as Error).message }));
        /* v10.362 (D237 · docs/496) — 가입 차단에 오늘 20번 넘게 막히면 경고(종류별 수만) · 줄면 다음 날 풂 */
        const [bh] = await this.db.query<{ n: number }>(`SELECT coalesce(sum(n), 0)::int AS n FROM signup_block_hits WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date`).catch(() => [{ n: 0 }]);
        if (Number(bh?.n ?? 0) >= 20) await this.alertOnce('SIGNUP_BLOCK_SPIKE', 'WARN', `가입 차단에 오늘 ${bh!.n}번 막혔습니다(위험감지 › 가입 차단 목록 · 같은 사람 · 대역이 계속 시도하는지 보십시오)`, { today: bh!.n });
        else await this.resolveAlert('SIGNUP_BLOCK_SPIKE', '오늘 막힌 수가 20 아래');
        /* v10.367 (D238 · docs/502) — 열린 신고(OPEN · QUEUED)가 ops.report_due_hours(처음 24) 넘으면 경고 · 0건이면 풂 */
        const ro = await this.reportOverdue().catch((e) => ({ error: (e as Error).message }));
        /* v10.368 (D238 · docs/503) — 마지막 DB 복원 시험이 ops.restore_drill_days(처음 30) 넘으면(한 번도 없으면) 경고 · 적으면 풂 */
        const rd = await this.restoreDrillDue().catch((e) => ({ error: (e as Error).message }));
        /* v10.372 (D239 · docs/507) — 기한 지난 운영 권한 거두기 · 3일 안 기한 알림 */
        const rx = await this.roleExpire().catch((e) => ({ error: (e as Error).message }));
        /* v10.373 (D240 · docs/508) — 분쟁 · 정산 처리 기한 */
        const du = await this.disputeSettleOverdue().catch((e) => ({ error: (e as Error).message }));
        detail = { expired: ex, nginx: ng, auditChain: ac, signupBlocked: Number(bh?.n ?? 0), reportOverdue: ro, restoreDrill: rd, roleExpire: rx, dueOverdue: du };
        break;
      }

      /** 매월 1일. k ≥ 1.30 이 2개월 연속이면 증원 안건 발의 */
      case 'k_alert': {
        const [r] = await this.db.query<{ raised: boolean; k_now: string; k_prev: string }>(
          `SELECT * FROM fn_check_k_alert()`);
        affected = r?.raised ? 1 : 0;
        detail = { kNow: r?.k_now, kPrev: r?.k_prev };
        break;
      }

      /** 매일. 프로모션 만료 D-14 미고지 (B-14 자동 유료 전환 고지 의무) */
      case 'promo_expiry': {
        const [r] = await this.db.query<{ n: number }>(`SELECT fn_check_promo_expiry() AS n`);
        affected = r.n;
        break;
      }

      /** 매시간. 급구 배지 만료 · v10.161 (D151) 새 판이 시행된 약관의 앞 판 보관(시행 예정 판은 시행일까지 앞 판이 게시 그대로) */
      case 'expire_badges': {
        const [r] = await this.db.query<{ n: number }>(`SELECT fn_expire_badges() AS n`);
        const [t] = await this.db.query<{ n: number }>(`SELECT fn_terms_archive_due() AS n`);
        affected = r.n + t.n;
        detail = { badges: r.n, termsArchived: t.n };
        break;
      }

      /**
       * 매일 09:00. 7일 무응답 자동 확정 (B-01).
       * INV-4 를 우회하지 않고 확인 행을 남깁니다 — 누가 확정했는지가 분쟁의 근거입니다.
       */
      case 'deal_auto_confirm': {
        const rows = await this.db.query<{ id: string }>(
          `WITH target AS (
             SELECT d.id FROM deals d
              WHERE d.status = 'PAYMENT_REPORTED'
                AND EXISTS (SELECT 1 FROM deal_payment_records r
                             WHERE r.deal_id = d.id AND r.reported_at < now() - interval '7 days')
              FOR UPDATE SKIP LOCKED
           ), conf AS (
             INSERT INTO deal_confirmations (deal_id, party, is_auto, source)
             SELECT t.id, p, true, 'AUTO_7D' FROM target t, unnest(ARRAY['BUYER','SELLER']) p
             ON CONFLICT (deal_id, party) DO NOTHING
             RETURNING deal_id
           )
           UPDATE deals SET status = 'CONFIRMED', confirmed_at = now(), confirm_mode = 'AUTO'
            WHERE id IN (SELECT id FROM target) RETURNING id`);
        affected = rows.length;
        break;
      }

      /**
       * 2시간마다. 구독 자동 청구.
       *
       * 만료일이 지난 구독을 청구합니다. 가입일이 제각각이라
       * 갱신일도 제각각이므로 계속 돌면서 대상을 찾습니다.
       *
       * 하루 한 번이 아니라 2시간마다 도는 이유는 재시도 정책 때문입니다.
       * 실패 시 하루 10회까지 다시 시도하는데(billing.retry_per_day),
       * 배치가 하루 한 번이면 10회를 채울 수 없습니다.
       *
       * 한도는 v_billing_due 가 지킵니다 — 오늘 한도를 채운 구독은
       * 목록에 오르지 않으므로 배치가 자주 돌아도 초과하지 않습니다.
       *
       * 대상 판단은 v_billing_due 하나가 합니다 —
       * 해지·무료·프로모션·결제수단 없음·중복이 전부 거기서 걸러집니다.
       * 이중 청구는 DB 유일 제약이 막으므로 배치가 두 번 돌아도 안전합니다.
       */
      /**
       * 매시간. 위험 규칙 자동 탐지.
       *
       * 트리거가 막는 것과 배치가 잡는 것은 다릅니다.
       * 트리거는 앱을 통한 위반을 막고, 배치는 **이미 들어간 상태**를 찾습니다 —
       * 트리거를 우회해 DB 를 직접 만진 경우가 그것입니다.
       *
       * 규칙 하나가 깨져도 나머지는 돕니다. 깨진 사실은 경보로 남습니다 —
       * 조용히 넘기면 "탐지가 도는데 아무것도 안 잡힌다"가 됩니다.
       */
      case 'risk_scan': {
        const rows = await this.db.query<{ rule_code: string; inserted: number; ok: boolean }>(
          'SELECT * FROM fn_risk_scan()');
        const broken = rows.filter(r => !r.ok);
        const found  = rows.reduce((a, r) => a + Number(r.inserted), 0);

        if (broken.length) {
          await this.alert('RISK_RULE_BROKEN', 'CRITICAL',
            `탐지 질의가 실패한 규칙 ${broken.length}건 — 그 규칙은 아무것도 잡지 못합니다`,
            { rules: broken.map(b => b.rule_code) });
        }
        if (found > 0) {
          await this.alert('RISK_DETECTED', 'WARN', `자동 탐지 ${found}건`, { rows });
        }
        affected = found;
        detail = { found, broken: broken.length, rows };
        break;
      }

      /**
       * 10분마다. 알림 외부 발송.
       *
       * 인앱 알림만으로는 부족합니다 — 로그인하지 않으면 못 봅니다.
       * 준비되지 않은 채널로는 보내지 않고 **보내지 못했다는 사실을 남깁니다.**
       * 인증 없이 이메일을 보내면 스팸함으로 가는데, 발송은 성공으로 기록되고
       * 이용자만 못 받습니다 — 가장 발견하기 어려운 실패입니다.
       */
      /* 3일 넘게 멈춘 계약을 양측에 알립니다.
       *
       * 한쪽이 잊었을 뿐인 경우가 많습니다. 방치하면 **소개자가 중간에서
       * 곤란해집니다** — 계약이 안 끝나면 성사도, 소개비 지급도 없습니다.
       *
       * 누가 다음 차례인지 함께 알려야 "나는 했는데" 하고 서로 기다리지
       * 않습니다. */
      /* 7일 안에 만료되는 광고 소재를 운영에 알립니다.
       *
       * 당일에 알면 **이미 빈 자리가 된 뒤**입니다. 팔린 자리라면
       * 그 순간부터 환불 대상이 됩니다 — 미리 갈아 끼울 시간이
       * 있어야 합니다. */
      /* 끝난 이벤트를 내립니다.
       *
       * 화면은 기간으로 거르지만, 상태까지 바꿔 두어야 운영 목록에서
       * **끝난 것과 진행 중인 것이 구분됩니다.** 안 그러면 "이거 아직
       * 하는 건가" 를 매번 날짜로 세어야 합니다. */
      case 'event_close': {
        const rows = await this.db.query<{ code: string }>(
          `UPDATE events SET status = 'ENDED'
            WHERE status = 'PUBLISHED' AND ends_at < now()
            RETURNING code`);
        affected = rows.length;
        break;
      }

      /* 10분마다. 상담 신청 배정 (D008).
       *
       * 판정은 전부 DB 함수(fn_lead_assign_tick)가 합니다 — 만료 · 회수 · 빈자리 배정 · 미배정 전환.
       * 리드 행을 잠그고 UNIQUE(lead_id, partner_id)가 있어 두 번 불려도 두 번 보내지 않습니다.
       *
       * 미배정(UNMATCHED)은 신청자가 아무 연락도 못 받는다는 뜻입니다 — 운영에 알립니다. */
      case 'lead_assign': {
        const [r] = await this.db.query<{ expired: number; revoked: number; assigned: number;
          touched: number; unmatched: number; failed: number }>('SELECT * FROM fn_lead_assign_tick()');
        if (r.unmatched > 0) {
          await this.alert('LEAD_UNMATCHED', 'WARN',
            `기한 안에 보낼 업체가 없는 상담 신청 ${r.unmatched}건 — 리드 배정 화면에서 직접 보내 주십시오`, r);
        }
        if (r.failed > 0) {
          await this.alert('LEAD_ASSIGN_FAILED', 'WARN', `배정 중 오류 ${r.failed}건`, r);
        }
        affected = r.assigned;
        detail = r;
        break;
      }

      case 'ad_expiry_notice': {
        const rows = await this.db.query<any>(
          `SELECT creative_code, slot_code, advertiser, days_left
             FROM v_ad_expiring`);
        if (rows.length) {
          await this.db.query(
            /* ★ 20260930 — notifications 에는 category · ref_type 이 없고(event_code · link_url),
             *   accounts 에는 role 이 없습니다(account_roles). 이 배치는 늘 실패했습니다
             *   (scripts/check-sql.js 가 찾음). */
            `INSERT INTO notifications (account_id, event_code, title, body, link_url)
             SELECT DISTINCT r.account_id, 'AD_EXPIRING', '광고 소재 만료가 다가옵니다',
                    $1, '/admin#ads'
               FROM account_roles r WHERE r.role IN ('ADMIN', 'SUPER')`,
            [rows.map((r: any) =>
              `${r.creative_code}(${r.slot_code}) ${r.days_left}일 남음`).join(' · ')]);
        }
        affected = rows.length;
        break;
      }
      case 'contract_nudge': {
        const rows = await this.db.query<any>(
          `SELECT c.id, c.deal_id, c.state,
                  (c.agreed_by_buyer_at  IS NULL) AS buyer_todo,
                  (c.agreed_by_seller_at IS NULL) AS seller_todo,
                  d.buyer_account_id, d.seller_account_id
             FROM deal_contracts c JOIN deals d ON d.id = c.deal_id
            WHERE c.state NOT IN ('FULFILLED','CANCELLED')
              AND c.updated_at < now() - interval '3 days'`);
        let sent = 0;
        for (const r of rows) {
          const who = r.buyer_todo ? r.buyer_account_id
                    : r.seller_todo ? r.seller_account_id : null;
          if (!who) continue;
          await this.db.query(
            /* 20260930 — 열 이름 교정 (위와 같은 이유) */
            `INSERT INTO notifications (account_id, event_code, title, body, link_url)
             VALUES ($1, 'CONTRACT_SIGN_REQUIRED', '계약이 3일째 멈춰 있습니다',
                     '다음 차례는 회원님입니다. 확인해 주십시오.', '/my/contracts/' || $2::text)`,
            [who, r.deal_id]);
          sent++;
        }
        affected = sent;
        break;
      }
      case 'notify_dispatch': {
        const ch = await this.db.query<{ channel: string; ready: boolean }>(
          'SELECT channel, ready FROM v_notify_channels');
        const ready = new Set(ch.filter(c => c.ready).map(c => c.channel));
        const queue = await this.db.query<any>('SELECT * FROM v_notify_queue LIMIT 200');
        const [q] = await this.db.query<{ quiet: boolean }>('SELECT fn_in_quiet_hours() AS quiet');

        let sent = 0, skipped = 0;
        for (const n of queue) {
          if (q?.quiet && !n.quiet_exempt) { skipped++; continue; }
          for (const c of ['EMAIL', 'SMS'] as const) {
            const target = c === 'EMAIL' ? n.email : n.phone;
            if (!target) continue;
            const st = ready.has(c) ? 'QUEUED' : 'FAILED';
            await this.db.query(
              `INSERT INTO notification_deliveries(notification_id, channel, status, failed_reason, idempotency_key)
               VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
              [n.notification_id, c, st,
               ready.has(c) ? null : `${c} 채널이 준비되지 않았습니다`,
               `${n.notification_id}:${c}`]);
            ready.has(c) ? sent++ : skipped++;
          }
        }

        const stuck = await this.db.query('SELECT 1 FROM v_notify_stuck');
        if (stuck.length) {
          await this.alert('NOTIFY_STUCK', 'CRITICAL',
            `사흘 넘게 밖으로 나가지 못한 알림 ${stuck.length}건 — 채널이 준비되지 않았습니다`,
            { count: stuck.length });
        }
        /* v10.85 — 대기(QUEUED) 메일을 실제로 보냄(메일 설정 + notify.email_verified 가 모두 있을 때만 · src/common/mail/notify-mail.ts) */
        const mailed = await new NotifyMailSender(this.db, this.mail).run();
        /* v10.142 (D138) — 대기(QUEUED) SMS 를 알림톡 일반 템플릿으로(방식 · 키 · 승인 · 알림톡 켜기가 모두 있을 때만 · 오류는 기록 남기고 다음 줄) */
        let talked: Awaited<ReturnType<AlimtalkService['runNotify']>> | { error: string };
        try { talked = await this.alimtalk.runNotify(); } catch (e) { talked = { error: String((e as Error)?.message ?? e).slice(0, 200) }; }
        affected = sent;
        detail = { sent, skipped, stuck: stuck.length, ready: [...ready], mail: mailed, alimtalk: talked,
                   note: mailed.ready ? '메일은 SES 로 보냄 · 문자(SMS)는 알림톡이 준비되면 알림톡으로' : '메일 설정 전 — 대기열에만 남김(SMTP_* · notify.email_verified)' };
        break;
      }

      case 'subscription_billing': {
        const r = await this.billing.chargeDue();
        affected = r.paid;
        detail = r;

        // 카드 교체가 필요한 건(TERMINAL)은 재시도로 풀리지 않습니다.
        // 이용자에게 안내가 나가야 하므로 따로 세어 알립니다.
        if (r.terminal > 0) {
          await this.alert('SUBSCRIPTION_CARD_UNUSABLE', 'CRITICAL',
            `카드 교체가 필요한 구독 ${r.terminal}건 — 재시도로는 풀리지 않습니다`,
            { terminal: r.terminal });
        } else if (r.failed > 0 || r.skipped > 0) {
          await this.alert('SUBSCRIPTION_BILLING_FAILED', 'WARN',
            `정기결제 실패 ${r.failed}건 · 결제수단 없음 ${r.skipped}건`,
            { paid: r.paid, failed: r.failed, skipped: r.skipped });
        }
        /* D022 — 사람이 봐야 하는 것(금액이 다르게 승인됨 · 하루 넘게 닫히지 않은 청구/환불) · 배치 안의 오류 */
        if (r.review > 0 || r.errors > 0) {
          await this.alert('SUBSCRIPTION_BILLING_REVIEW', 'CRITICAL',
            `정기결제 · 환불 확인 필요 ${r.review}건 · 처리 오류 ${r.errors}건 — 운영 화면(청구 확인)과 결제사 관리자 화면을 대조해 주십시오`,
            { review: r.review, errors: r.errors, pending: r.pending, refunds: r.refunds });
        }
        break;
      }

      /**
       * 수요일 10:00. 정산 정합성 점검.
       *
       * 이전에는 여기서 배치를 편성하고 이체를 준비했습니다.
       * 에스크로 폐지(INV-11) 이후 플랫폼은 지급하지 않으므로
       * 편성할 배치도, 막을 이체도 없습니다.
       *
       * 대신 어긋난 값을 찾아 운영에 알립니다.
       * 자동으로 고치지 않습니다 — 돈에 관한 값은 사람이 봐야 합니다.
       */
      case 'settlement_audit': {
        const violations = await this.db.query<{ inv: string; violation_count: string }>(
          `SELECT inv, violation_count FROM fn_verify_invariants() WHERE violation_count > 0`);

        // 정산 합계와 약정 합계를 서로 다른 경로로 계산해 비교합니다.
        // 두 값이 갈리면 트리거를 우회한 보정이 있었다는 뜻입니다(INV-9R).
        const [sum] = await this.db.query<{ stl: string; deal: string }>(
          `SELECT COALESCE(sum(s.amount),0)::text AS stl,
                  COALESCE(sum(d.agreed_fee),0)::text AS deal
             FROM settlements s JOIN deals d ON d.id = s.deal_id
            WHERE s.status <> 'REJECTED' AND s.held_by_dispute_id IS NULL`);

        const inv9  = await this.db.query(`SELECT 1 FROM v_inv9_violations`);
        const inv11 = await this.db.query(`SELECT 1 FROM v_inv11_violations`);
        const orphan = await this.db.query(`SELECT 1 FROM v_dangling_refs`);

        const problems: string[] = [];
        if (violations.length) problems.push(`불변식 위반 ${violations.length}건`);
        if (sum && sum.stl !== sum.deal) {
          problems.push(`정산 합계 ${sum.stl} <> 약정 합계 ${sum.deal}`);
        }
        if (inv9.length)   problems.push(`INV-9 공제 컬럼 ${inv9.length}건`);
        if (inv11.length)  problems.push(`INV-11 자금수탁 컬럼 ${inv11.length}건`);
        if (orphan.length) problems.push(`사라진 테이블 참조 ${orphan.length}건`);

        if (problems.length) {
          await this.alert('SETTLEMENT_AUDIT_FAILED', 'CRITICAL',
            '정산 정합성 점검에서 이상을 발견했습니다', { problems, violations });
          this.log.error(`정산 점검 이상 — ${problems.join(' / ')}`);
        }

        affected = problems.length;
        detail = { ok: problems.length === 0, problems };
        break;
      }

      /** 매일 03:00. 귀속 로그 S3 아카이브 대상 집계 */
      case 'attribution_archive': {
        const [r] = await this.db.query<{ n: string }>(
          `SELECT count(*) AS n FROM attribution_events
            WHERE occurred_at < now() - interval '1 day'`);
        affected = Number(r.n);
        break;
      }

      /**
       * 매일 03:00. 보유기간 경과 개인정보 파기.
       *
       * 3관에서도 회원 개인정보는 있습니다 — "B2B 라서 개인정보가 없다"는
       * 착각이 가장 위험합니다. 탈퇴 계정, 오래된 IP, 리드(4관)를 함께 처리합니다.
       */
      /* v10.28 (D035) — 소개몰 구매확정. 배송 완료 7일(청약철회 기간이 더 길면 그 기간) 뒤 · 처리 중인 신청이 있으면 건너뜀 */
      case 'hlt_auto_confirm': {
        const [r] = await this.db.query<{ n: number }>(`SELECT fn_hlt_auto_confirm() AS n`);
        affected = r.n; detail = { confirmed: r.n };
        break;
      }

      /* v10.170 (D159 · docs/262) — 공개 직후 지켜보기: 시험 결제(stub)로 결제 완료된 소개몰 주문이 새로 생기면 운영 알림 */
      case 'launch_watch': {
        const r = await this.launchWatch.recentStubOrders();
        affected = r.n; detail = r;
        if (r.n > 0) {
          await this.alert('STUB_PAYMENT_ORDER', 'WARN', `시험 결제로 결제 완료된 소개몰 주문 ${r.n}건 — 돈을 받지 않은 주문입니다`, r);
        }
        /* v10.171 (D160) — 1시간 가입 급증(자동 가입 · 광고 유입) · 1시간에 한 번 */
        const sp = await this.launchWatch.signupSpike();
        if (sp.alert) await this.alert('SIGNUP_SPIKE', 'WARN', `지난 1시간 가입 ${sp.n}명 — 기준 ${sp.limit}명 이상`, sp);
        /* v10.174 (D163) — 지난 10분 API 서버 오류(5xx) 몰림 · 1시간에 한 번 */
        const se = await this.launchWatch.serverErrorSpike();
        if (se.alert) await this.alert('SERVER_ERROR_SPIKE', 'WARN', `지난 10분 서버 오류 ${se.n}건 — 기준 ${se.limit}건 이상 · 많이 난 곳 ${se.top.map((t) => `${t.path} ${t.n}`).join(', ')}`, se);
        /* v10.178 (D167) — 지난 10분 API 느린 응답(p95) · 1시간에 한 번 */
        const sl = await this.launchWatch.slowApi();
        if (sl.alert) await this.alert('SLOW_API', 'WARN', `지난 10분 API 응답이 느립니다 — 느린 쪽 5% 기준 ${sl.p95}ms(기준 ${sl.limit}ms · 요청 ${sl.n}건) · 느린 곳 ${sl.top.map((t) => `${t.path} ${t.p95}ms`).join(', ')}`, sl);
        /* v10.178 — 신고 3건으로 감춰진 회원 투표(투표마다 한 번 · 운영 화면 소개광장 검수 「신고된 투표」) */
        for (const p of await this.launchWatch.pollsHiddenByReports()) {
          await this.alert('POLL_HIDDEN_BY_REPORTS', 'WARN', `회원 투표가 신고 ${p.reports}건으로 감춰졌습니다 — 「${p.title}」 · 운영 화면 소개광장 검수에서 확인`, { pollId: p.id, title: p.title, reports: p.reports });
        }
        /* v10.182 (D171) — 디스크 · 메모리 재기 · 디스크 85%(ops.disk_warn_pct) WARN · 95% CRITICAL(등급마다 하루 한 번) */
        const sh = measureServerHealth();
        const sd = await this.trend.record(sh).catch(() => false);   /* v10.248 (D203) — 그날 처음 잰 값 한 줄(같은 날은 안 넣음) */
        const dk = await this.launchWatch.diskAlert();
        if (dk.alert && dk.level) await this.alert('DISK_LOW', dk.level, `서버 디스크 ${dk.usedPct}% 사용 · 남은 ${dk.freeGB}GB — 옛 판 · 백업 묶음을 정리하거나 디스크를 늘리십시오(기준 ${dk.limit}%)`, dk);
        /* v10.199 (D177 · docs/314) — 간주 결제 켜짐에 「주문 받기」: 꺼질 시각이 지나면 끔 · 꺼질 시각 없이 1시간 넘게 켜져 있으면 CRITICAL(풀리기 전 한 번) */
        const og = await this.launchWatch.orderOpenGuard();
        if (og.expired) await this.alert('ORDER_OPEN_EXPIRED', 'WARN', `소개몰 주문 받기를 저절로 껐습니다 — 꺼질 시각 ${og.expired} 이 지남(간주 결제 켜짐 · 시험 결제 주문 막음)`, { until: og.expired });
        if (og.noEnd) await this.alert('ORDER_OPEN_NO_END', 'CRITICAL', `소개몰 주문 받기가 꺼질 시각 없이 ${og.sinceMin}분째 켜져 있습니다 — 간주 결제(돈을 받지 않은 주문) · 운영 화면 첫 화면에서 끄십시오`, { sinceMin: og.sinceMin });
        /* v10.204 (D181 · docs/326) — AI 잠금이 풀린 때(처리방침 국외 이전 조항 시행) 한 번 · 3일 안 시행 예정인데 준비 덜 됨(판마다 한 번) */
        const aw = await this.launchWatch.agentWatch();
        if (aw.live) await this.alert('AGENT_LIVE', aw.live.severity, aw.live.title, aw.live.detail);
        if (aw.gap) await this.alert('AGENT_READY_GAP', 'WARN', aw.gap.title, aw.gap.detail);
        /* v10.205 (docs/328) — AI 켜기 다음 단계가 「할 차례」(앞 단계 기준 넘음)면 단계마다 한 번 */
        const sr = await this.launchWatch.agentStepReady();
        for (const x of sr) await this.alert('AGENT_STEP_READY', 'INFO', x.title, x.detail);
        /* v10.317 (D220 · docs/442) — 간주가 켜져 있는데 끌 조건을 모두 갖춘 항목(간주 모드 끄는 순서) · 처음 한 번 · 켜진 채면 7일마다 한 번 · 꺼지면 멈춤 */
        const ar = await this.assumeReadyAlert();
        /* v10.199 (D177) — 원인이 없어진 알림에 「풀림」(백업 멈춤 · 백업 실패 · 묶음 깨짐 · 디스크) — 확인 안 한 수 · 메일에서 빠짐 */
        const rs = await this.launchWatch.resolveAlerts(dk.usedPct, dk.limit);
        /* v10.197 (D175 · docs/310) — 급한 알림(CRITICAL · 중요 설정 바뀜)을 ops.digest_to 로 메일 · 메일이 준비 안 됐으면 기록만(보낸 것으로 적지 않음) */
        const am = await this.alertMail();
        const ap = await this.alertPush();   /* v10.200 (D178) — 메일과 따로(메일이 준비 안 돼도 감) */
        const oc = await this.oncallPush().catch((e) => ({ error: (e as Error).message }));   /* v10.358 (D236 · docs/492) — 당번 개인 텔레그램 · 30분 미확인 SUPER */
        const as = await this.alertSlack();   /* v10.237 (D200) — 텔레그램 · 메일과 따로 */
        const ab = await this.alertBoard(ap, as);   /* v10.286 (D213) — 급한 알림을 게시판에 한 번(보냄 · 준비 안 됨 상관없이) */
        /* v10.239 (docs/379) — 켜 둔 길이 60분 넘게 보내기 실패면 ALERT_CHANNEL_FAIL(CRITICAL · 다음 차례에 다른 길로) · 다시 되거나 꺼지면 풀림 */
        const cf = await this.channels.failWatch({ mail: am, telegram: ap, slack: as });
        const cs = await this.launchWatch.flushCsp();   /* v10.221 (D191) — 보안 정책 보고를 DB 에 더함 · 30일 지난 줄 지움 */
        const ef = await this.launchWatch.flushServerErrors();   /* v10.250 (D204) — 서버 오류 건수를 DB 에 더함 · 30일 지난 줄 지움 */
        detail = { alertMail: am, alertPush: ap, alertSlack: as, oncall: oc, alertBoard: ab, ...r, signupHour: sp.n, serverErrors10m: se.n, slowP95: sl.p95, diskPct: dk.usedPct, orderGuard: og.expired ? 'EXPIRED' : og.noEnd ? 'NO_END' : og.open ? 'OPEN' : 'OFF', resolved: rs, csp: cs, agentLive: aw.live?.severity ?? null, agentGap: !!aw.gap, agentStep: sr.map((x) => x.detail.step), assumeReady: ar, channelFail: cf, serverDaily: sd, serverErrorsSaved: ef };   /* v10.198 — alertMail 을 앞에(job_runs.detail 은 2000자에서 잘림 · 운영 알림 화면이 읽음) */
        break;
      }

      /* v10.249 (D203 · docs/386) — 대표 할 일 주간 알림(월요일 09:05): 아직인 줄만 텔레그램 · 슬랙(켜 둔 길만) · 모두 끝났으면 안 보냄 */
      /* v10.354 (D235 · docs/488) — 월간 보안 보고(매일 09:20 · 지난달 보고를 아직 안 보냈으면) */
      case 'security_monthly': {
        const m = await this.securityMonthly();
        affected = m.sent ? 1 : 0; detail = m;
        break;
      }

      /* v10.352 (D234 · docs/486) — 고객센터 주간 보고(월요일 09:10) */
      case 'cs_weekly': {
        const w = await this.csWeekly();
        affected = w.telegram === 'SENT' || w.slack === 'SENT' ? 1 : 0; detail = w;
        break;
      }

      case 'owner_todo_weekly': {
        const w = await this.ownerTodoWeekly();
        const gw = await gwanWeeklyJob(this.db, this.mail).catch((e) => ({ error: String((e as Error).message).slice(0, 200) }));   /* v10.694 (docs/801) 관별 주간 보고 — 같은 월요일 차례에 이어서 */
        affected = w.left; detail = { ...w, gwanWeekly: gw };
        break;
      }

      /* v10.171 (D160 · docs/264) — 운영 하루 요약(매일 09:00): 운영 알림 DAILY_DIGEST · 메일이 준비됐으면 ops.digest_to 로도 */
      case 'launch_digest': {
        const d = await this.launchWatch.digest();
        let mailed = false;
        if (d.to && (await this.mail.ready())) {
          const m = await this.mail.send({ to: d.to, subject: `[소개뱅크] 운영 하루 요약 ${d.day}`, text: d.text });
          mailed = !!m.ok;
        }
        const dp = await this.digestPush(d.text);   /* v10.201 (D179) — 메일과 따로 텔레그램으로도(메일이 준비 안 돼도 감) */
        const ds = await this.digestSlack(d.text);   /* v10.237 (D200) — 슬랙으로도 */
        await this.alert('DAILY_DIGEST', 'INFO', `운영 하루 요약 ${d.day} — 가입 ${d.signups} · 주문 ${d.orders} · 시험 결제 주문 ${d.stubPaidOrders}`, { ...d, mailed, pushed: dp.pushed, pushReason: dp.reason, slacked: ds.pushed, slackReason: ds.reason });
        await opsBoardPost(this.db, 'DAILY_DIGEST', `운영 하루 요약 ${d.day}`, d.text, sendResult(dp.pushed, dp.reason), sendResult(ds.pushed, ds.reason));   /* v10.286 (D213) — 운영자 게시판 · 관리자 공지(꺼져 있어도) */
        /* v10.177 (docs/275) — 올린 파일 백업 묶음이 36시간 넘게 새로 생기지 않으면(묶음이 하나라도 있을 때만 — 예약 전에는 조용) */
        const ub = uploadsBackupState();
        if (ub.stale) await this.alert('UPLOADS_BACKUP_STALE', 'WARN', `올린 파일 백업이 ${ub.ageHours}시간째 새로 생기지 않았습니다 — 마지막 ${ub.last} · cron · 디스크를 확인하십시오`, ub);
        /* v10.179 (D168 · docs/279) — 매달 5일부터 지난달 개인정보 접속기록 점검이 없으면(그달 한 번) */
        const pr = await this.piiReview.due();
        if (pr.alert) await this.alert('PII_REVIEW_DUE', 'WARN', `${pr.month} 개인정보 접속기록 점검이 아직 없습니다 — 운영 화면 위험감지 › 개인정보 접속기록에서 점검 완료를 남기십시오(SUPER)`, { month: pr.month });
        /* v10.180 (D169 · docs/281) — 분기 15일째부터 지난 분기 운영자 권한 점검이 없으면(그 분기 한 번) · 파기 작업 실패 · 30시간 넘게 안 돎 */
        const rr = await this.roleReview.due();
        if (rr.alert) await this.alert('ROLE_REVIEW_DUE', 'WARN', `${rr.quarter} 운영자 권한 점검이 아직 없습니다 — 운영 화면 위험감지 › 운영자 권한에서 점검 완료를 남기십시오(SUPER)`, { quarter: rr.quarter });
        const ph = await this.roleReview.purgeHealth();
        if (ph.failedRun) await this.alert('PII_PURGE_FAILED', 'CRITICAL', `개인정보 파기 작업이 실패했습니다(${ph.failedRun.at}) — 운영 화면 위험감지 › 파기 기록에서 오류를 확인하십시오`, { runId: ph.failedRun.id, at: ph.failedRun.at, error: ph.failedRun.error });
        if (ph.missedHours !== null) await this.alert('PII_PURGE_MISSED', 'WARN', ph.missedHours < 0 ? '개인정보 파기 작업이 한 번도 돌지 않았습니다 — 정기 작업(scheduler)을 확인하십시오' : `개인정보 파기 작업이 ${ph.missedHours}시간째 돌지 않았습니다 — 정기 작업(scheduler)을 확인하십시오`, { hours: ph.missedHours });
        /* v10.181 (D170 · docs/283) — 개인정보 권리 요청 처리 기한 2일 안(넘긴 것 포함) · 요청 · 기한마다 한 번 */
        const pq = await this.privacy.dueAlerts();
        if (pq.length) {
          const late = pq.filter((x) => x.daysLeft < 0).length;
          await this.alert('PRIVACY_REQUEST_DUE', late ? 'CRITICAL' : 'WARN',
            `개인정보 권리 요청 ${pq.length}건 처리 기한이 2일 안입니다${late ? `(기한 넘김 ${late}건)` : ''} — 운영 화면 위험감지 › 권리 요청에서 처리하십시오`,
            { keys: pq.map((x) => `${x.id}:${x.dueOn}`), items: pq });
        }
        /* v10.243 (docs/381) — 시행일 3 ~ 1일 전 · 당일 약관(약관 · 판마다 한 번 · INFO) */
        const ta = await this.launchWatch.termsAlerts();
        if (ta.soon.length) await this.alert('TERMS_EFFECTIVE_SOON', 'INFO', termsAlertTitle(ta.soon, false), { keys: ta.soon.map((t) => `${t.code}:${t.version}`), items: ta.soon });
        if (ta.today.length) await this.alert('TERMS_EFFECTIVE_TODAY', 'INFO', termsAlertTitle(ta.today, true), { keys: ta.today.map((t) => `${t.code}:${t.version}`), items: ta.today });
        /* v10.235 (docs/375) — 외부 연동 예상일(IP 신청일 + 기간) 지남 · LIVE 아님 — 하루 한 번 한 건에 모아서(풀림은 resolveAlerts) */
        const io = await this.launchWatch.integrationOverdue();
        if (io.length) {
          const [today] = await this.db.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM ops_alerts WHERE alert_code = 'INTEGRATION_OVERDUE' AND (raised_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date`);
          if (!today?.n) await this.alert('INTEGRATION_OVERDUE', 'WARN',
            `외부 연동 ${io.length}건이 예상일을 지났습니다 — ${io.slice(0, 5).map((x) => `${x.name}(${x.dueOn} · ${x.daysOver}일 지남)`).join(' · ')}${io.length > 5 ? ` 외 ${io.length - 5}건` : ''} — 운영 화면 › 외부 연동에서 진행을 확인하십시오`,
            { items: io });
        }
        affected = 1; detail = { day: d.day, mailed, uploadsBackupAgeHours: ub.ageHours, piiReviewDue: pr.alert ? pr.month : null,
          roleReviewDue: rr.alert ? rr.quarter : null, purgeFailed: ph.failedRun?.id ?? null, purgeMissedHours: ph.missedHours,
          privacyDue: pq.length, integrationOverdue: io.length };
        break;
      }

      /* v10.168 (D157 · docs/259) — 소개몰 주 정산 마감(월요일 03:20 · 지난주 월요일부터 7일). 같은 판매자 · 같은 주는 한 번만(DB 함수) */
      case 'hlt_settle_weekly': {
        const [r] = await this.db.query<{ created: number; carried: number }>(
          `SELECT * FROM fn_hlt_settle_close((date_trunc('week', now() AT TIME ZONE 'Asia/Seoul'))::date - 7)`);
        affected = Number(r?.created ?? 0); detail = { created: Number(r?.created ?? 0), carried: Number(r?.carried ?? 0) };
        break;
      }

      /* v10.31 (합침 · W5 D070) — 리드 이용료 자동 충전. 자동 청구를 켠 파트너 중 잔액이 기준 아래인 곳을 등록 카드로 충전합니다.
       *   한 파트너의 실패는 지갑에 남기고(1시간 뒤 재시도) 다른 파트너는 계속합니다 — runAuto 가 던지지 않습니다.
       *   전에는 리드 열람 직후 · 운영 「자동 충전 돌리기」 단추로만 돌아, 리드를 열지 않는 동안 잔액이 0 이 되면 배정이 멈췄습니다. */
      case 'lead_cash_auto': {
        const r = await this.leadCash.runAutoAll();
        const by = (k: string) => r.items.filter((x) => x.result === k).length;
        affected = by('DONE');
        detail = { candidates: r.ran, done: by('DONE'), failed: by('FAILED'), unknown: by('UNKNOWN'), skipped: by('SKIP') };
        if (by('FAILED') + by('UNKNOWN') > 0) {
          await this.alert('LEAD_CASH_AUTO_FAILED', 'WARN', '리드 이용료 자동 충전이 일부 실패했습니다',
            { failed: by('FAILED'), unknown: by('UNKNOWN') });
        }
        break;
      }

      /* v10.223 (D193 · docs/358) — 입점 서류 만료: 30일 · 7일 전 판매자 알림 · 만료일에 운영 알림 한 번(자동 정지 없음 · 대표 「알림만」) */
      /* v10.275 (D208 · docs/406) — 수수료율 인상 예약 시행: 시행 시각이 지난 예약을 기본 표로 · 바꾼 기록 · 판매자 알림(요율 계산은 시행 시각부터 이미 새 값) */
      case 'hlt_rate_schedule': {
        const [r] = await this.db.query<{ n: number }>(`SELECT fn_hlt_rate_sched_apply() AS n`);
        affected = Number(r?.n ?? 0);
        /* v10.278 (D209 · docs/407) — 예약한 지 하루가 지나도 예약 안내 공지를 게시하지 않은 것 → 운영 알림(약관 제17조 4항 「공지」 빠뜨림) */
        const miss = await this.db.query<{ id: string; d: string }>(
          `SELECT r.id, to_char(r.effective_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS d
             FROM hlt_rate_schedules r LEFT JOIN notices n ON n.id = r.notice_id
            WHERE r.status = 'SCHEDULED' AND r.effective_at > now() AND r.created_at < now() - interval '1 day' AND n.published_at IS NULL
            ORDER BY r.effective_at`);
        if (miss.length) {
          await this.alert('RATE_NOTICE_MISSING', 'WARN',
            `수수료율 변경 예약 ${miss.length}건의 공지를 아직 게시하지 않았습니다 — 소개몰 › 소개몰 정산 › 「요율 변경 예정」에서 「공지 게시」(가장 빠른 시행일 ${miss[0].d})`, { items: miss });
        }
        /* v10.302 (D218 · docs/423) — 시행 n일 전 안 읽은 판매자 자동 다시 알림(설정 hlt.rate_auto_remind_days · 0 = 끔) · 시행 때 열람 기록 고정(v10.301)은 위 함수 안 */
        const [ar] = await this.db.query<{ schedules: number; sent: number }>(`SELECT * FROM fn_hlt_rate_auto_remind()`);
        const arN = Number(ar?.schedules ?? 0), arSent = Number(ar?.sent ?? 0);
        if (arSent > 0) {
          await this.alert('RATE_AUTO_REMIND', 'INFO',
            `요율 공지 자동 다시 알림 — 예약 ${arN}건 · 안 읽은 판매자 ${arSent}곳에 보냄(소개몰 › 소개몰 정산 › 「요율 변경 예정」 「읽음 기록」)`, { schedules: arN, sent: arSent });
        }
        /* v10.305 (docs/427) — 시행 때 기록을 굳힌 예약(최근 30일 · 아직 RATE_FROZEN 에 안 실린 것)을 한 줄로 · 안 읽은 대상이 있으면 WARN
             ops_alerts 는 (종류 · 시각) 고유라 한 번에 한 줄 — 여러 예약은 items 로 묶음 · 다음 날 다시 돌아도 items 에 있으면 빠짐 */
        const fz = await this.db.query<{ id: string; label: string; d: string; target: number; readBefore: number }>(
          `SELECT r.id::text AS id,
                  CASE r.scope WHEN 'SELLER' THEN '판매자 ' || coalesce((SELECT s.name FROM hlt_sellers s WHERE s.id::text = r.target), r.target)
                               WHEN 'TYPE' THEN '유형 ' || r.target ELSE '갈래 ' || r.target END AS label,
                  to_char(r.effective_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS d,
                  count(p.seller_id) FILTER (WHERE p.target)::int AS target,
                  count(p.seller_id) FILTER (WHERE p.target AND p.read_before)::int AS "readBefore"
             FROM hlt_rate_schedules r LEFT JOIN hlt_rate_read_snaps p ON p.schedule_id = r.id
            WHERE r.reads_frozen_at > now() - interval '30 days'
              AND NOT EXISTS (SELECT 1 FROM ops_alerts o WHERE o.alert_code = 'RATE_FROZEN' AND o.detail -> 'items' @> jsonb_build_array(jsonb_build_object('id', r.id::text)))
            GROUP BY r.id ORDER BY r.effective_at, r.id`);
        if (fz.length) {
          const tgt = fz.reduce((a, x) => a + x.target, 0), rb = fz.reduce((a, x) => a + x.readBefore, 0);
          await this.alert('RATE_FROZEN', tgt - rb > 0 ? 'WARN' : 'INFO',
            `요율 시행 — 예약 ${fz.length}건 · 시행 전 공지 읽음 ${rb} / 대상 ${tgt}${tgt - rb > 0 ? ` · 안 읽은 곳 ${tgt - rb}` : ''}(소개몰 › 소개몰 정산 › 「요율 변경 예정」 「읽음 기록」 · 시행 때 기록)`,
            { items: fz.map((x) => ({ id: x.id, label: x.label, effective: x.d, target: x.target, readBefore: x.readBefore })) });
        }
        detail = { applied: affected, noticeMissing: miss.length, autoRemind: { schedules: arN, sent: arSent }, frozen: fz.length };
        break;
      }

      /* v10.282 (D211 · docs/410) — 예약 공지 알림: 게시 시각이 된 공지 중 「알림 보냄」을 고른 것을 그 등급 회원에게(한 번) */
      /* v10.377 (D241 · docs/513) — 시각이 된 설정 예약을 운영 화면과 같은 검사로 · 실패하면 SETTING_SCHEDULE_FAIL(WARN) */
      /* v10.706 (D323 · docs/814) 관 점검 시간 — 시작에 닫고 · 예약 게시 · 끝에 다시 엶(1분마다) */
      case 'gwan_maint': {
        const r = await this.gwanMaint.tick();
        affected = r.closed + r.reopened; detail = r;
        break;
      }
      /* v10.750 (D327 · docs/858) 게시된 페이지 깨진 링크(매일 05:10) */
      case 'page_link_check': {
        const r = await this.gwanMaint.linkCheck();
        affected = r.broken.length; detail = { checked: r.checked, broken: r.broken.slice(0, 20) };
        break;
      }
      /* v10.756 (D328 · docs/864) 손님 한 줄 의견 1년 지난 줄 파기(매일 04:40 · 한 번에 5천 줄씩 · 남으면 다음 날) */
      case 'page_feedback_purge': {
        const r = await this.db.query<{ id: number }>(`DELETE FROM page_feedback WHERE id IN (SELECT id FROM page_feedback WHERE at < now() - interval '1 year' ORDER BY id LIMIT 5000) RETURNING id`);
        affected = r.length; detail = { purged: r.length, keep: '1 year' };
        break;
      }

      case 'setting_schedule': {
        const r = await applyDueSettingSchedules(this.db, this.admin);
        if (r.failed.length) {
          await this.alert('SETTING_SCHEDULE_FAIL', 'WARN',
            `설정 예약 ${r.failed.length}건을 바꾸지 못했습니다 — ${r.failed.map((f) => `${f.key}: ${f.why}`).join(' · ')}`.slice(0, 300) + '(정책 › 전체 설정 › 예약 변경)', { failed: r.failed });
        }
        affected = r.applied.length; detail = r;
        break;
      }

      /* v10.382 (D242 · docs/518) — 자동 전표(아직 없는 돈 흐름만 · 같은 근거 한 번) · 실패가 있으면 ACCT_JOURNAL_FAIL(WARN · 하나만) */
      case 'acct_journal': {
        await stockJob(this.db);   // v10.395 (D245) — 재고 출고 · 반입을 먼저(매출원가 전표가 같은 시간에 붙게)
        const r = await runJournal(this.db, ALL_SOURCES);
        if (r.failedCount) await this.alertOnce('ACCT_JOURNAL_FAIL', 'WARN', `자동 전표 ${r.failedCount}건을 만들지 못했습니다 — ${r.failed.slice(0, 3).map((f) => `${f.source}: ${f.why}`).join(' · ')}`.slice(0, 280) + '(회계 › 전표)', r);
        else await this.resolveAlert('ACCT_JOURNAL_FAIL', '자동 전표 실패 없음');
        affected = r.total; detail = r;
        break;
      }

      /* v10.390 (D244 · docs/527) — 신고 기한(원천세 10일 · 부가세 25일) N일 전 ACCT_DEADLINE · 지난달 마감 안 함 ACCT_UNCLOSED(같은 기한 · 같은 달 한 번) */
      case 'acct_deadline': {
        const r = await acctDeadlineJob(this.db);
        affected = r.made.length; detail = r;
        break;
      }

      /* v10.394 (D245 · docs/531) — 90일 안 가장 낮은 날 잔액이 acct.cash_floor 밑이면 ACCT_CASH_SHORT(하루 한 번 · 넉넉해지면 풀림) */
      case 'acct_cashflow': {
        const r = await acctCashflowJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.395 (D245 · docs/532) — 직판 결제 승인 → 출고 · 취소 · 반품 → 반입(이동평균 원가) · 재고 없이 나가면 STOCK_NEGATIVE */
      case 'acct_depreciation': {   // v10.398 (D246 · docs/535) — 끝난 달까지 자산마다 상각 한 줄(전표는 acct_journal 이 DEPRECIATION)
        const r = await depreciationJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.471 (D265 · docs/609) — 이번 주 연장 · 휴일 근로(신청 + 승인)가 hrx.week_limits WARN − BASE 시간을 넘은 직원 수를 HRX_OT_WEEK 하나로(이름 없이 수만 · 주에 한 번 · 다음 주 · 0명이면 풀림) */
      case 'hrx_ot_week': {
        const r = await otWeekJob(this.db);
        affected = r.made; detail = r;
        break;
      }
      case 'acct_budget': {   // v10.399 (D246 · docs/536) — 비용 계정 실적 > 예산이면 ACCT_BUDGET_OVER(예산을 올리면 풀림)
        const r = await budgetJob(this.db);
        affected = r.made.length; detail = r;
        break;
      }

      case 'acct_aging': {   // v10.401 (D247 · docs/538) — 받을 돈 · 갚을 돈이 acct.aging_over_days 넘으면 ACCT_AGING_OVER(거래처마다 한 번 · 갚으면 풀림)
        const r = await acctAgingJob(this.db);
        affected = r.made.length; detail = r;
        break;
      }

      case 'acct_pg_check': {   // v10.404 (D248 · docs/541) — PG 정산이 늦은 결제 ACCT_PG_UNSETTLED(하나 · 다 들어오면 풀림)
        const r = await acctPgCheckJob(this.db);
        affected = r.unsettled; detail = r;
        break;
      }

      case 'acct_taxinbox': {   // v10.432 (D255 · docs/569) — acct.taxinbox on 일 때만 지난 7일 가져오기(간주 · 업체)
        const r = await acctTaxInboxJob(this.db);
        affected = r.added; detail = r;
        break;
      }

      case 'acct_contracts': {   // v10.409 (D249 · docs/546) — 만기 30일 전 ACCT_CONTRACT_DUE(계약마다 한 번 · 갱신 · 끝내면 풀림)
        const r = await acctContractsJob(this.db);
        affected = r.made.length; detail = r;
        break;
      }

      /* v10.486 ~ 489 (D269 · docs/624 ~ 627) — 법무 기한: 인허가 다음 갱신일 60 · 30 · 7일 전 LGL_LICENSE_DUE · 사건 기일 7 · 1일 전 LGL_HEARING_DUE
         · 보험 만기 30일 전 LGL_INSURANCE_DUE · 계약 검토 희망일 지남 LGL_REVIEW_LATE(차례마다 한 번 · 처리하면 풀림) */
      case 'lgl_due': {
        const r = await legalDueJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.412 · 415 (D250 · docs/549 · 552) — 전날 일보 · 월요일 지난주 주보 · 1일 지난달 월보(같은 기간 JOB 한 번) · report.send on 이면 보냄 */
      /* v10.490 (D270 · docs/628) — 연동 키 다음 기한(만료일 · 마지막 교체 + 주기) N일 전 · 지남 → ITS_KEY_EXPIRY(키 이름만 · 값 없음 · 기한이 바뀌면 풀림) */
      case 'its_key_expiry': {
        const r = await itsKeyExpiryJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.491 ~ 493 (D270 · docs/629 ~ 631) — IT 자산 자동 갱신일 옮김 · 자금 흐름 예정 맞춤 · ITS_ASSET_RENEW · 제안 접수 대기 수 ITS_SUGGEST_WAITING · 기간 지난 설문 마감 */
      case 'its_office_daily': {
        const r = await itsOfficeDailyJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.422 (D252 · docs/559) — 4대보험 취득 · 상실 신고 기한 3일 전부터 ACCT_INSURANCE_DUE(같은 건 한 번 · 처리함 누르면 풀림) */
      case 'acct_insurance': {
        const r = await acctInsuranceJob(this.db);
        affected = r.made.length; detail = r;
        break;
      }

      /* v10.463 (D263 · docs/601) — 기한 지난 업무 요청 수를 OFC_TASK_OVERDUE 하나로(제목 없이 수만 · 하루 한 번 · 0 이거나 꺼지면 풀림) */
      case 'ofc_task_due': {
        const r = await ofcTaskDueJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.425 (D253 · docs/562) — 사내 문서 만료 N일 전 CORP_DOC_DUE(판 하나에 한 번) · 새 판 · 보관 끝이면 풀림 */
      /* v10.581 ~ 584 (docs/723 ~ 726) — 연차 촉진(hra.leave_promo) · 꼭 읽을 사내 공지 기한(hra.lib_unread_alert) · 회계 마감 남은 일(hra.close_alert) · 모두 처음 off · 하나가 실패해도 나머지는 돎 */
      case 'hra_daily': {
        const r = await hraDailyJob(this.db);
        affected = r.affected; detail = r.detail;
        break;
      }

      case 'corp_doc_due': {
        const r = await corpDocDueJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.566 · 568 (docs/708 · 710) — 이번 분기 거둘 후보 다시 만들기(prr.review_auto on · PRR_REVIEW_OPEN) · 입사 · 퇴사 흐름 기한 넘김 STAFF_JOIN_OVERDUE · STAFF_LEAVE_OVERDUE · 거두기 없음 */
      case 'prr_daily': {
        const r = await prrDailyJob(this.db);
        affected = r.affected; detail = r;
        break;
      }

      case 'ops_report': {
        const r = await opsReportJob(this.db);
        const s = await sendAfterJob(this.db, { telegram: this.telegram, slack: this.slack, mail: this.mail }, r.made);
        affected = r.made.filter((m) => m.made).length; detail = { ...r, send: s };
        break;
      }

      /* v10.431 (D254 · docs/568) — 거래처 휴폐업 다시 조회(acct.biz_status_check on · 30일 지난 50곳) · 휴업 · 폐업 ACCT_PARTY_CLOSED */
      case 'acct_biz_check': {
        const r = await acctBizCheckJob(this.db);
        affected = r.checked; detail = r;
        break;
      }

      /* v10.436 (D256 · docs/573) — 지난 입금 예정 BROKEN · acct.dunning on 이면 단계가 올라간 거래처에 메일 한 번(메일 준비된 때만) */
      case 'acct_dunning': {
        const r = await dunningJob(this.db, this.mail);
        affected = r.sent; detail = r;
        break;
      }

      /* v10.466 (D264 · docs/604) — 다음 할 날짜가 된 열린 영업 기회 → SAL_OPP_DUE(기회 · 날짜마다 한 번 · 닫거나 날짜를 바꾸면 풀림) */
      case 'sal_opp_remind': {
        const r = await salOppRemindJob(this.db);
        affected = r.made.length; detail = r;
        break;
      }

      /* v10.467 (D264 · docs/605) — acct.bank_feed on 일 때만 · 등록 계좌마다 거래내역조회(ASSUME 간주 · LIVE 금융결제원) → 은행 맞추기 · 실패 ACCT_BANK_FEED_FAIL */
      case 'acct_bank_feed': {
        const r = await acctBankFeedJob(this.db);
        affected = r.runs.length; detail = r;
        break;
      }

      /* v10.479 (D267 · docs/617 · 620) — 유효 기간 지난 소개몰 적립금 묶음 · 상품권 잔액 소멸(쌓기만 기록 · 전표 근거) · 적립금 30일 전 회원 알림 · 있으면 MALL_BENEFIT_EXPIRED */
      case 'mall_benefit_expire': {
        const r = await mallBenefitExpireJob(this.db);
        affected = r.pointLots + r.giftCards; detail = r;
        break;
      }

      /* v10.480 (D267 · docs/618) — mall.tiers on 일 때만 · 최근 mall.tier_months 개월 구매확정 직판 주문으로 회원 등급(운영이 정한 회원 건너뜀) */
      case 'mall_tier_recalc': {
        const r = await mallTierJob(this.db);
        affected = r.changed; detail = r;
        break;
      }

      /* v10.503 (D273 · docs/641) — mbx.price_alert on 일 때만 · 관심 매물 · 상품 기준값과 지금 값이 다른 것을 회원마다 한 통(MBX_PRICE_DIGEST · 수신 설정 따름 · 하루 한 번) */
      case 'mbx_price_digest': {
        const r = await mbxPriceDigestJob(this.db);
        affected = r.members; detail = r;
        break;
      }

      /* v10.501 ~ 504 (D273 · docs/639 · 642) — 최근 본 보관 기간 · 대화 글 보관 기간(처리 중 신고 대화는 남김) · 끝난 신고 · 빈 대화 · 탈퇴 회원 기록 → mbx_purges */
      case 'mbx_daily': {
        const r = await mbxDailyJob(this.db);
        affected = r.recent + r.watches + r.messages + r.reports + r.threads; detail = r;
        break;
      }

      /* v10.481 (D267 · docs/619) — mall.subscribe · mall.order_open on 일 때만 · 결제일이 된 정기 배송 주문 · 결제(ASSUME 간주 · LIVE 카드 등록 키) · 실패 MALL_SUBSCRIBE_FAIL */
      case 'mall_subscribe': {
        const r = await mallSubscribeJob(this.db);
        affected = r.paid + r.skipped + r.failed; detail = r;
        break;
      }

      /* v10.495 (D271 · docs/633) — 로트 관리 상품의 수불부 출고(주문은 배송 뒤) · 줄이는 실사 → 로트(출고 지정 → FEFO) · 반입 → 나갔던 로트 · 모자라면 QLT_LOT_SHORT */
      case 'qlt_lot_alloc': {
        const r = await qltLotAllocJob(this.db);
        affected = r.done + r.short + r.back; detail = r;
        break;
      }

      /* v10.495 · 496 (D271 · docs/633 · 634) — 로트 유통기한 임박 · 지남 QLT_LOT_EXPIRY(qlt.expiry_alert on 일 때) · 클레임 재발 QLT_CLAIM_REPEAT */
      case 'qlt_daily': {
        const r = await qltDailyJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.453 (D261 · docs/590) — 이번 달 법인카드 사용이 한도의 acct.card_alert_pct 넘으면 ACCT_CARD_LIMIT(카드마다 한 번 · 한도 넘으면 한 번 더 · 지난달 풀림) */
      case 'acct_card_limit': {
        const r = await acctCardLimitJob(this.db);
        affected = r.made.length; detail = r;
        break;
      }

      /* v10.458 (D262 · docs/596) — 법정 의무교육 기간 끝 N일(hr.training_due_days) 전 미이수 HR_TRAINING_DUE · 지난 기간 미이수 HR_TRAINING_OVERDUE(종류 · 기간마다 한 번 · 모두 이수하면 풀림) */
      case 'hr_training_due': {
        const r = await trainingDueJob(this.db);
        affected = r.made; detail = { days: r.days, made: r.made, resolved: r.resolved };
        break;
      }

      /* v10.461 (D262 · docs/599) — 파기 예정일 지난 불합격 · 철회 지원자 서류 파일 · 연락처 · 메모 파기 · 파기 기록 · 감사 기록 HR_APPLICANT_PURGE */
      case 'hr_applicant_purge': {
        const r = await applicantPurgeJob(this.db);
        affected = r.purged; detail = r;
        break;
      }

      /* v10.506 (D274 · docs/644) — mall.cash_receipt on 일 때만 · 발급 대기 · 다시 보낼 실패 · 취소 대기를 50건씩(ASSUME 간주 · LIVE 토스 · 키 없으면 NOT_READY) */
      case 'mall_cash_receipt': {
        const r = await mallCashReceiptJob(this.db);
        affected = r.issued + r.assumed + r.canceled + r.failed + r.reissued; detail = r;
        break;
      }

      /* v10.507 (D274 · docs/645) — 이번 달 소개광장 점수 다시 셈 · 지난달이 마감 전이면 마감 배지 · 회원 알림 PLZ_BADGE(plaza.ranking on 일 때만) */
      case 'plz_badge_month': {
        const r = await plzBadgeMonthJob(this.db);
        affected = r.members + (r.badges ?? 0); detail = r;
        break;
      }

      /* v10.505 · 506 · 508 (D274 · docs/643 · 644 · 646) — 재입고 기한 닫기 · 따라잡기 · 현금영수증 번호(암호화) 보관 끝 지움 · 사용 통계 보관 끝 지움 */
      case 'mlx_daily_purge': {
        const r = await mlxDailyPurgeJob(this.db);
        affected = r.affected; detail = r.detail;
        break;
      }

      /* v10.521 (D278 · docs/659) — papi.enabled · papi.hook_enabled on 일 때만 · 보낼 웹훅 줄 50개(ASSUME 은 간주 · 실패는 1분 ~ 12시간 뒤 다시 · 6번 뒤 포기) */
      case 'papi_hook_send': {
        const r = await papiHookSendJob(this.db);
        affected = r.sent + r.assumed; detail = r;
        break;
      }

      /* v10.521 (D278 · docs/659) — 요청 기록 papi.log_keep_days 지난 것 지움 · 3일 넘은 웹훅 줄 포기 · 기한 7일 안 키(PAPI_KEY_EXPIRING) · 틀린 키 몰림(PAPI_KEY_ABUSE) */
      case 'papi_daily': {
        const r = await papiDailyJob(this.db);
        affected = r.purged + r.staleGiveup; detail = r;
        break;
      }

      /* v10.532 (D281 · docs/670) — 이달 mall.statement_day 일부터 지난달 입점 판매자 월 정산서를 만들고 다시 셈(보낸 것 빼고) · mall.statement_mail on · 메일 준비됨이면 한 번만 메일 · 실패 MALL_STATEMENT_MAIL_FAIL */
      case 'mall_statement': {
        const r = await mallStatementJob(this.db, this.mail);
        affected = r.made + r.mailed; detail = r;
        break;
      }

      /* v10.577 · 579 (docs/719 · 721) — 상품 문의 답 기한 넘김(smq.qna on · SMQ_QNA_DUE · SMQ_QNA_OVERDUE) · 판매자 평가(smq.penalty on · 1일부터 지난달 셈 · 3일부터 알림 · SMQ_LIMIT_PROPOSED) · 기간 끝난 노출 제한 풀기 */
      case 'smq_daily': {
        const r = await smqDailyJob(this.db);
        affected = r.affected; detail = r;
        break;
      }

      /* v10.522 (D278 · docs/660) — 일괄 등록 가입 대기 짝 맞춤 · 기한 지남 · 하루 지난 미리보기 취소 · 초대 메일(pbulk.invite_mail on · 메일 준비됨일 때만) */
      case 'pbulk_match': {
        const r = await pbulkMatchJob(this.db, this.mail);
        affected = r.matched + r.expired + r.mailed; detail = r;
        break;
      }

      /* v10.535 (D282 · docs/673) — BI 일별 집계: 어제까지 3일 fn_bi_daily_build · bi.keep_days 지난 줄 지움 · 다른 셈이 돌면 건너뜀(busy) */
      case 'bi_daily': {
        const r = await biDailyJob(this.db);
        affected = r.built + r.purged; detail = r;
        break;
      }

      /* v10.542 (D284 · docs/680) — 방문 예약: 지난 칸의 확정 안 된 요청 저절로 취소(SYSTEM) · 내일 확정 예약 전날 알림(10시부터 · 한 번) · vsx.enabled off 면 아무것도 안 함 */
      case 'vsx_visit': {
        const r = await vsxVisitJob(this.db);
        affected = r.expired + r.reminded; detail = r;
        break;
      }

      /* v10.545 (D284 · docs/683) — 오픈 API 하루 사용량(지난 3일 · papi_daily 정리 전) · papi.bill_enabled on 이고 papi.bill_day 일부터 지난달 청구서 초안 다시 셈(확정은 사람) */
      case 'papi_usage': {
        const r = await papiUsageJob(this.db);
        affected = r.rows + (r.made ?? 0) + (r.remade ?? 0); detail = r;
        break;
      }

      /* v10.483 (D268 · docs/621) — campaign.enabled on 일 때만 · 예약 시각이 된 캠페인을 campaign.batch 만큼(야간은 야간 동의자만 · ASSUME 은 보내지 않고 간주) */
      case 'mkt_campaign_send': {
        const r = await mktCampaignJob(this.db, this.mail);
        affected = r.sent + r.assumed; detail = r;
        break;
      }

      /* v10.538 (D283 · docs/676) — push.send on 일 때만 · 12시간 안 읽지 않은 회원 알림을 켠 기기로 · ASSUME 은 밖으로 부르지 않음 · 404 · 410 이면 구독 GONE */
      case 'mkx_push_send': {
        const r = await mkxPushJob(this.db);
        affected = r.sent + r.assumed; detail = r;
        break;
      }

      /* v10.540 (D283 · docs/678) — 공동구매 확정(결제 참여 ≥ 목표) · 기한 지남 → 마감 또는 실패(참여 주문마다 기존 취소 신청 · MKX_GB_FAILED) */
      case 'mkx_groupbuy': {
        const r = await mkxGroupbuyJob(this.db);
        affected = r.success + r.failed + r.closed; detail = r;
        break;
      }

      /* v10.539 (D283 · docs/677) — 재구매 알림(mkx.rebuy on · 21 ~ 8시 안 함) · 30일 지난 웹 푸시 기록 · 90일 지난 GONE · OFF 구독 */
      case 'mkx_daily': {
        const r = await mkxDailyJob(this.db);
        affected = r.rebuy.sent + r.purgedSends + r.purgedSubs; detail = r;
        break;
      }

      /* v10.497 (D272 · docs/635 · 636) — uptime.keep_days 지난 바깥 감시 결과 · 하루 지난 OAuth state · 간편 로그인 이어서 표(이메일 함께) · 180일 지난 간편 로그인 기록 */
      case 'upt_daily': {
        const r = await uptDailyJob(this.db);
        affected = r.checks + r.states + r.pending + r.events; detail = r;
        break;
      }

      /* v10.556 · 557 (D288 · docs/694 · 695) — 알림만: 되돌아보기 기한 넘김 OPZ_REVIEW_DUE · 24시간 기록 없는 열린 장애 OPZ_INCIDENT_STALE · 이달 뉴스레터 없음 OPZ_NL_REMIND */
      case 'opz_daily': {
        const r = await opzDailyJob(this.db);
        affected = r.reviewDue + r.stale + r.nlRemind; detail = r;
        break;
      }

      /* v10.597 · 599 (docs/739 · 741) — 알림 하루 요약 GRW_DIGEST(grw.digest on 일 때만 · 회원마다 하루 한 번) · 가입 단계 수 보관 끝 · 요약 기록 400일 */
      case 'grw_daily': {
        const r = await grwDailyJob(this.db);
        affected = r.members; detail = r;
        break;
      }

      /* v10.518 · 520 (D277 · docs/656 · 658) — 추천 이벤트 기간 끝 ENDED(PERIOD) · 끝난 이벤트 PRX_REF_EVENT_END · 비교 시험 기간 끝 결과 고정 PRX_AB_DONE */
      case 'prx_hourly': {
        const r = await prxHourlyJob(this.db);
        affected = r.eventsEnded + r.abEnded; detail = r;
        break;
      }

      /* v10.519 (D277 · docs/657) — 주기(DAILY 어제 · WEEKLY 지난주 · MONTHLY 지난달)의 광고 성과 보고서(없는 광고주만) · prx.ad_report_mail on 이면 아직 안 보낸 것 메일(같은 기간 두 번 안 보냄) */
      case 'prx_ad_report': {
        const r = await prxAdReportJob(this.db, this.mail);
        affected = r.made + r.sent; detail = r;
        break;
      }

      /* v10.609 (docs/751) — 파트너 계약 만기 알림 BZX_PARTNER_RENEW · 만기 지남 EXPIRED · ENDED · 서명 없음 BZX_PARTNER_UNSIGNED · 파트너 알림은 bzx.partner_notice on 일 때만 */
      case 'bzx_daily': {
        const r = await bzxDailyJob(this.db);
        affected = r.affected; detail = r;
        break;
      }

      /* v10.610 · 613 (docs/752 · 755) — 광고 예산 알림 · 자동 정지(bzx.ad_autopause) · 법인카드 사용 알림(bzx.card_notify) — 갈래마다 실패를 따로 담음 */
      case 'bzx_frequent': {
        const r = await bzxFrequentJob(this.db);
        affected = r.affected; detail = r;
        break;
      }

      /* v10.485 (D268 · docs/623) — 1년 지난 접속 나라 기록 · 30일 지난 나라 캐시 · 하루 지난 패스키 확인 문제 */
      case 'sec_daily_purge': {
        const r = await secDailyPurgeJob(this.db);
        affected = r.geoEvents + r.geoCache + r.passkeyChallenges; detail = r;
        break;
      }

      /* v10.509 (D275 · docs/647) — opx.archive on 일 때만 · 지난 달 기록 묶음(sha256 · 감사 사슬 머리와 묶은 목록 지문) · S3(opx.archive_s3 + 버킷) · 복원 확인 1개 · 보관 개월 지난 묶음 파기 · DB 원래 줄 정리(opx.archive_db_purge_months > 0) */
      case 'opx_archive': {
        const r = await opxArchiveJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.510 (D275 · docs/648) — opx.risk_score on 일 때만 · 표시된 계정(매물 등록 · 신고 접수) 점수 · 기준 넘으면 검수 대기 · OPX_RISK_HIGH */
      case 'opx_risk_events': {
        const r = await opxRiskEventsJob(this.db);
        affected = r.scored; detail = r;
        break;
      }

      /* v10.510 (D275 · docs/648) — 최근 30일 가입 · 7일 매물 · 30일 신고 계정 다시 셈 */
      case 'opx_risk_daily': {
        const r = await opxRiskDailyJob(this.db);
        affected = r.scored; detail = r;
        break;
      }

      /* v10.546 ~ 548 (D285 · docs/684 ~ 686) — 오래된 기기 표지 지움(sfx.device_keep_days) · sfx.retention_alert on 이면 서류 보관 대장 맞추기 + 만료 알림 SFX_RETENTION_DUE · 쓰이지 않은 번역 메모리 지움 */
      case 'sfx_daily': {
        const r = await sfxDailyJob(this.db);
        affected = r.devicePurged + r.tmPurged + r.alerted; detail = r;
        break;
      }

      /* v10.590 ~ 593 (docs/732 ~ 735) — 10분마다 · 07시 뒤 어제 운영자 이상 행동(sec2.anomaly_watch on · 하루 한 번 · STAFF_ANOMALY) · 「내가 아니에요」 몰림(MEMBER_NOT_ME_SURGE) · 지난 2단계 표 · 낯선 로그인 · 유출 확인 건수 정리 */
      case 'sec2_tick': {
        const r = await sec2TickJob(this.db);
        affected = r.affected; detail = r.detail;
        break;
      }

      /* v10.439 (D257 · docs/576) — 이번 달 고정비 줄(acct.contract_accrue on 일 때만) · 같은 거래처 매입 자동 맞춤 · 다음 달 말까지 매입 없으면 ACCT_ACCRUAL_UNMATCHED */
      case 'acct_accrual': {
        const r = await acctAccrualJob(this.db);
        affected = r.made + r.matched; detail = r;
        break;
      }

      case 'acct_stock': {
        const r = await stockJob(this.db);
        affected = r.out + r.back; detail = r;
        break;
      }

      /* v10.476 (D266 · docs/614) — 12개월 자금 계획에서 달 말 예상 잔액이 acct.cash_floor 밑인 첫 달 ACCT_CASHPLAN_SHORT(달이 바뀌면 새로 · 넉넉해지면 · 끄면 풀림) */
      case 'acct_cashplan': {
        const r = await acctCashPlanJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.478 (D266 · docs/616) — 판매용 재고 + 발주 중 < 최소인 직판 옵션 STOCK_REORDER(옵션마다 하나) · 매입처별 재주문 초안 줄(발주는 사람이 「발주로 넣기」) */
      case 'acct_reorder': {
        const r = await acctReorderJob(this.db);
        affected = r.made + r.lines; detail = r;
        break;
      }

      /* v10.378 (D241 · docs/514) — 탈퇴 유예 끝 하루 전 메일(유예 2일 이상 · 한 번) */
      case 'withdraw_grace_mail': {
        const r = await withdrawGraceMail(this.db, this.mail);
        affected = r.mailed; detail = r;
        break;
      }

      /* v10.379 (D241 · docs/515) — 점검 시작 24시간 안이면 쓰는 회원 모두에게 사이트 알림 한 번(메일은 site.maintenance_mail) */
      case 'maint_notice': {
        const r = await maintNotice(this.db);
        affected = r.sent; detail = r;
        break;
      }

      case 'notice_schedule': {
        const [r] = await this.db.query<{ notices: number; sent: number }>(`SELECT * FROM fn_notice_notify_due()`);
        affected = Number(r?.sent ?? 0); detail = { notices: Number(r?.notices ?? 0), sent: Number(r?.sent ?? 0) };
        break;
      }

      /* v10.286 (D213 · docs/412) — 운영자 게시판 자동 글 보관 기간 지난 것 · 끝난 지 7일 지난 관리자 공지 사본 */
      case 'ops_board_purge': {
        const [r] = await this.db.query<{ posts: number; notices: number }>(`SELECT * FROM fn_ops_board_purge()`);
        affected = Number(r?.posts ?? 0); detail = { posts: Number(r?.posts ?? 0), notices: Number(r?.notices ?? 0) };
        break;
      }

      case 'seller_license_watch': {
        const [r] = await this.db.query<{ notified: number; expired: number }>(`SELECT * FROM fn_hlt_license_watch()`);
        affected = Number(r?.notified ?? 0); detail = { notified: Number(r?.notified ?? 0), expired: Number(r?.expired ?? 0) };
        break;
      }

      /* v10.33 (D092) — 법률 · 세무 정액 노출: 만료 7일 전 업체 안내(알림 → notify_dispatch 가 메일로) ·
       *   연장 입금 확인 없이 종료일이 지난 노출 자동 종료. 판정은 DB(fn_directory_expiry_tick) — 같은 종료일에 안내는 한 번 */
      case 'directory_expiry': {
        const [r] = await this.db.query<{ noticed: number; ended: number }>(`SELECT * FROM fn_directory_expiry_tick()`);
        affected = Number(r.noticed) + Number(r.ended); detail = { noticed: Number(r.noticed), ended: Number(r.ended) };
        break;
      }

      /* v10.46 (D099 · docs/96) — 매물 좌표 채우기(카카오 로컬). 지도 사용(map.enabled)이 off 이거나 키가 없으면 아무것도 하지 않음 */
      case 'geo_backfill': {
        const r = await this.geo.backfill(50);
        affected = r.affected; detail = r.detail;
        break;
      }

      /* v10.104 (D118 · docs/162) — 등록 글 자동 번역. 스위치 · AI 전체 · 월 상한 중 하나라도 막히면 아무것도 부르지 않음 */
      case 'translate_jobs': {
        const r = await this.translate.runBatch(10);
        affected = r.affected; detail = r.detail;
        break;
      }

      /* v10.106 (D120 · docs/165) — AI 검수 보조(병행): 의견만 저장 · 검수 상태는 바꾸지 않음 · 스위치 · AI 전체 · 월 상한이 막으면 아무것도 부르지 않음 */
      case 'review_shadow': {
        const r = await this.reviewShadow.runBatch(10);
        affected = r.affected; detail = r.detail;
        break;
      }

      /* v10.211 (D188 · docs/336) — 동네픽 AI 후보: 시군구별 최근 회원 글 · 맛집 글에서 고름(승인 전 비공개) · 스위치 · AI 전체 · 월 상한이 막으면 아무것도 부르지 않음 */
      case 'town_pick_daily': {
        const r = await this.townPick.runBatch();
        affected = r.affected; detail = r.detail;
        break;
      }

      /* v10.143 (D139 · docs/217) — 전자계약: 만료일 지난 요청 닫기 · 10분 넘게 대기 중인 HTTP 요청을 업체에 물어 반영(웹훅이 빠져도) */
      /* v10.145 (D141 · docs/221) — 안심번호: 쓰는 시간(safenum.hours)이 지난 050 번호를 업체에 돌려줌 */
      case 'safenum_release': {
        const r = await this.safenum.release();
        affected = r.released; detail = r;
        break;
      }

      case 'esign_poll': {
        const r = await this.esign.poll();
        affected = r.expired + r.changed; detail = r;
        break;
      }

      /* v10.109 (D121 · docs/170) — AI 상담 대화 정리: 보관 기간(agent.chat_retention_days · 5년)이 지난 대화 · 메시지 · 90일 지난 하루 횟수 줄 */
      case 'agent_chat_purge': {
        const r = await this.agentChat.purge();
        affected = r.affected; detail = r.detail;
        break;
      }

      /* v10.549 · 551 (D286 · docs/687 · 689) — 기한 지난 · 내려간 매물의 열린 가격 제안 EXPIRED(회원 알림) · 끝 날짜 지난 자리 비움 ENDED — 스위치와 상관없이 */
      case 'lpx_hourly': {
        const r = await lpxHourlyJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.552 (D286 · docs/690) — lpx.stats on 일 때만 · 이번 달 · 지난달 다시 셈 · lpx.stats_months 안 빠진 달 채움(fn_lpx_stats_refresh) */
      case 'lpx_stats_daily': {
        const r = await lpxStatsDailyJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.602 ~ 604 (docs/744 ~ 746) — 후기 요청(lsq.review_ask on) · 미리보기 지난 CSV 묶음 EXPIRED · 90일 지난 묶음 · 보관 지난 검색 클릭 지움 */
      case 'lsq_daily': {
        const r = await lsqDailyJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.607 (docs/749) — 배송 추적(lsq.track on 일 때만 · 방식 lsq.track_mode 처음 ASSUME · 배송 완료 반영은 LIVE · lsq.track_auto_deliver on) */
      case 'lsq_track': {
        const r = await lsqTrackJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.513 · 514 (D276 · docs/651 · 652) — 저장한 검색 새 매물 묶음 알림(lsx.saved_search on) · 만료 예고 · 만료로 내림(lsx.expiry on · 지우지 않음) */
      case 'lsx_daily': {
        const r = await lsxDailyJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.515 · 516 (D276 · docs/653 · 654) — 효과 끝난 끌어올림 지움(원래 자리) · 매물 AI 요약 초안(lsx.ai_summary · AI 월 상한) */
      case 'lsx_hourly': {
        const r = await lsxHourlyJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.528 ~ 531 (D280 · docs/666 · 667) — 이탈 위험 신호 다시 셈(csx.churn on) */
      case 'csx_daily': {
        const r = await csxDailyJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.528 (D280 · docs/666) — 1:1 문의 자동 AI 초안(csx.ai_draft_auto · AI 월 상한 · 40초 예산) */
      case 'csx_hourly': {
        const r = await csxHourlyJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.524 · 525 (D279 · docs/662 · 663) — 중복 매물 짝 찾기(lsy.dup_detect) · 사진 품질 검사(lsy.photo_check) · 사진 속 연락처 AI(lsy.photo_ai · AI 월 상한) */
      case 'lsy_hourly': {
        const r = await lsyHourlyJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.527 (D279 · docs/665) — 신고 규칙 분류(lsy.report_triage) · AI 분류(lsy.report_ai · AI 월 상한) · 사람이 확정 */
      case 'lsy_triage': {
        const r = await lsyTriageJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.573 · 574 (docs/715 · 716) — 이의 제기 처리 기한 넘김 알림(MTR_APPEAL_OVERDUE) · 가짜 후기 탐지(mtr.review_watch · 의심 목록만) */
      case 'mtr_hourly': {
        const r = await mtrHourlyJob(this.db);
        affected = r.made; detail = r;
        break;
      }

      /* v10.575 · 576 (docs/717 · 718) — 소개자 신뢰 점수 셈(mtr.trust) · 휴면 전 알림 · 휴면 전환(mtr.dormant · 메일은 mtr.dormant_mail) */
      case 'mtr_daily': {
        const r = await mtrDailyJob(this.db, this.mail);
        affected = r.made; detail = r;
        break;
      }

      /* v10.28 (D037) — 소개몰 순위: 어제까지 7일 판매 수량 · 주문 건수 */
      case 'hlt_rank': {
        const [r] = await this.db.query<{ n: number }>(`SELECT fn_hlt_rank_build() AS n`);
        affected = r.n; detail = { rows: r.n };
        break;
      }

      case 'pii_purge': {
        const [acc] = await this.db.query<{ n: number }>(`SELECT fn_purge_accounts() AS n`);
        const [ip] = await this.db.query<{ n: number }>(`SELECT fn_purge_old_ip() AS n`);
        const leads = await this.db.query(
          `UPDATE pii.lead_contacts
              SET purged_at = now(), name_enc = NULL, phone_enc = NULL,
                  address_enc = NULL, memo_enc = NULL, email_enc = NULL
            WHERE purged_at IS NULL AND retention_until <= current_date
          RETURNING lead_id`).catch(() => []);   // 3관에서는 pii 스키마가 비어 있습니다
        /* 상담 신청 표(D018) — 6개월 지난 연락처 파기 · 하루 넘게 확인 안 된 신청 만료.
         * 올린 kit(v10.4.7)은 함수만 있고 부르는 곳이 없어, 동의서에 적은 6개월이 지나도 지워지지 않았습니다. */
        const [consult] = await this.db.query<{ n: number }>(`SELECT fn_consult_purge() AS n`);
        /* v10.48 (D102) — 7일 지난 비밀번호 재설정 증표 · 2일 지난 로그인 실패 기록 */
        const [authRec] = await this.db.query<{ n: number }>(`SELECT fn_purge_auth_records() AS n`);
        /* v10.219 (D190) — 주민등록번호(포인트 출금 · 지급명세서): 마지막 지급한 해의 다음 해 1월 1일부터 5년(privacy.tax_id_retention_years) 지나면 */
        const [taxIds] = await this.db.query<{ n: number }>(`SELECT fn_purge_tax_ids() AS n`);
        /* v10.290 (D216) — 다 보낸 공지의 「알림 받은 사람」 기록: privacy.notice_notified_days(365)일 지나면 */
        const [noticeNotified] = await this.db.query<{ n: number }>(`SELECT fn_purge_notice_notified() AS n`);

        // 파기 기한을 넘긴 건이 남아 있으면 경보 — 법정 기한 초과입니다
        const [over] = await this.db.query<{ n: string }>(
          `SELECT count(*) AS n FROM v_purge_overdue`);
        if (Number(over.n) > 0) {
          await this.alert('PII_PURGE_OVERDUE', 'WARN',
            '파기 기한을 넘긴 개인정보가 있습니다', { count: Number(over.n) });
        }

        affected = acc.n + leads.length + consult.n + authRec.n + taxIds.n + noticeNotified.n;
        detail = { accounts: acc.n, ipMasked: ip.n, leads: leads.length, consultRequests: consult.n, authRecords: authRec.n, taxIds: taxIds.n, noticeNotified: noticeNotified.n, overdue: Number(over.n) };
        break;
      }
      /* v10.620 (docs/763) — 이 판에 없는 작업(새 판에서 생긴 작업을 옛 판이 받은 경우 · 되돌린 상태)은 「성공 · 0건」으로 적지 않고
       *   실패(UNKNOWN_JOB)로 남깁니다. 예전에는 아무 일도 안 하고 성공으로 적혀 돌지 않은 것을 알 수 없었습니다. 다시 새 판을 올리면 다음 차례부터 돕니다. */
      default:
        throw new Error(`UNKNOWN_JOB ${String(job)} — 이 판에는 없는 작업입니다(되돌린 상태라면 정상 · 새 판을 다시 올리면 다음 차례부터 돎)`);
    }

    const ms = Date.now() - t0;
    this.log.log(`${job} affected=${affected} ${ms}ms`);
    return { job, affected, detail, ms };
  }

  /** v10.197 (D175) — 급한 알림 메일 한 통(여러 건을 줄로). 결과: 보낸 수 · 남은 수 · 못 보낸 까닭
   *  v10.198 (D176) — 12시간 넘게 확인 안 한 CRITICAL 은 「[다시]」로 한 번 더(같은 메일에 묶음)
   *  v10.230 (D198) — 대기 목록은 CRITICAL 먼저 · 최근 순 50건 · 남은 수를 「보내지 못한 알림 n건 더」 줄로 */
  private async alertMail(): Promise<{ pending: number; mailed: number; reason: string | null }> {
    const p = await this.launchWatch.alertMailPending();
    if (!p.items.length) return { pending: 0, mailed: 0, reason: null };
    if (!p.to) return { pending: p.items.length, mailed: 0, reason: 'NO_TO' };
    if (!(await this.mail.ready())) return { pending: p.items.length, mailed: 0, reason: 'MAIL_NOT_READY' };
    const crit = p.items.filter((x) => x.severity === 'CRITICAL').length;
    const again = p.items.filter((x) => x.again).length;
    const more = Math.max(0, (await this.launchWatch.alertBacklog('mail')) - (p.items.length - again));
    const text = [
      `소개뱅크 급한 운영 알림 ${p.items.length}건${crit ? `(CRITICAL ${crit})` : ''}${again ? ` · 다시 알림 ${again}건(12시간 넘게 확인 안 함)` : ''}`,
      '',
      ...p.items.map((x) => `- ${x.again ? '[다시] ' : ''}[${x.severity}] ${x.raisedAt} ${x.title}`),
      ...(more ? ['', `보내지 못한 알림 ${more}건 더 — 다음 차례에 이어서 보냅니다(운영 화면 › 운영 알림에서 모두 볼 수 있음).`] : []),
      '',
      '운영 화면 › 운영 알림에서 내용을 보고 「확인」을 누르십시오. 같은 종류는 1시간에 한 통으로 묶어 보냅니다.',
    ].join('\n');
    const m = await this.mail.send({ to: p.to, subject: `[소개뱅크] 급한 운영 알림 ${p.items.length}건 — ${p.items[0].again ? '[다시] ' : ''}${p.items[0].title}`.slice(0, 150), text });
    if (!m.ok) return { pending: p.items.length, mailed: 0, reason: `SEND_${m.errorKind ?? 'FAILED'}` };
    await this.launchWatch.markMailed(p.items.filter((x) => !x.again).map((x) => x.id), p.items.filter((x) => x.again).map((x) => x.id));
    await opbGroupMail(this.db, this.mail, p.items);   // v10.572 (docs/714) opb.alert_routes · opb.alert_group_mail 둘 다 on 일 때만 · 안에서 실패를 삼킴
    return { pending: 0, mailed: p.items.length, reason: null };
  }

  /** v10.286 (D213 · docs/412) — 급한 알림(텔레그램 · 슬랙과 같은 기준)을 운영자 게시판에 한 번 — 보낸 결과(이번 차례)와 함께 · board_posted_at */
  private async alertBoard(ap: { pushed: number; reason: string | null }, as: { pushed: number; reason: string | null }): Promise<{ posted: number }> {
    /* v10.572 (docs/714) — 받을 사람 규칙(opb.alert_routes on)이면 규칙으로(CRITICAL 은 늘 올림) · off 면 null 이라 아래 지금 목록 그대로 */
    const items = (await opbRoutePending(this.db, 'board')) ?? await this.db.query<{ id: string; code: string; severity: string; title: string; raisedAt: string; again: boolean }>(
      `SELECT o.id::text AS id, o.alert_code AS code, o.severity, o.title, to_char(o.raised_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS "raisedAt", false AS again
         FROM ops_alerts o
        WHERE o.board_posted_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL AND o.raised_at > now() - interval '24 hours'
          AND (o.severity = 'CRITICAL' OR o.alert_code IN ('SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
               'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY', 'STAFF_IP_PASS_NEW', 'STAFF_IP_LOCKED', 'STAFF_IP_DAY_LIMIT',
               'ASSUME_READY'))   /* v10.317 (D220) */
        ORDER BY (o.severity = 'CRITICAL') DESC, o.id LIMIT 50`);
    if (!items.length) return { posted: 0 };
    const plan = buildAlertPush(items, items.length);
    const text = plan.parts.map((p) => p.text).join('\n\n');
    const crit = items.filter((x) => x.severity === 'CRITICAL').length;
    const id = await opsBoardPost(this.db, 'URGENT', `급한 운영 알림 ${items.length}건${crit ? `(CRITICAL ${crit})` : ''} — ${items[0].title}`.slice(0, 200), text,
      sendResult(ap.pushed, ap.reason), sendResult(as.pushed, as.reason));
    if (id) await this.db.query(`UPDATE ops_alerts SET board_posted_at = now() WHERE id = ANY($1::bigint[])`, [items.map((x) => x.id)]);
    return { posted: id ? items.length : 0 };
  }

  /** v10.200 (D178 · docs/316) — 급한 알림 텔레그램 한 통(메일과 같은 알림 · 같은 기준 · 기록은 pushed_at · repushed_at).
   *  준비 안 됨(토큰 · 대화방 없음)이면 보내지 않고 까닭만 — 보낸 것으로 적지 않음
   *  v10.233 — 한 통 4,000자(TG_MAX)를 넘으면 최대 3통으로 나눔 · 제목 200자 · 보내진 통의 알림만 「보냄」 · 3통에 못 든 알림은 「n건 더」로 세고 다음 차례에
   *  v10.234 — 글 만들기는 buildAlertPush(운영 화면 미리보기와 같은 함수) */
  private async alertPush(): Promise<{ pending: number; pushed: number; reason: string | null; parts?: number }> {
    const items = await this.launchWatch.alertPushPending();
    if (!items.length) return { pending: 0, pushed: 0, reason: null };
    const st = await this.telegram.status();
    if (!st.ready) return { pending: items.length, pushed: 0, reason: st.reason };
    const plan = buildAlertPush(items, await this.launchWatch.alertBacklog('push'));
    let pushed = 0, parts = 0;
    for (const p of plan.parts) {
      const r = await this.telegram.send(p.text);
      if (!r.ok) return { pending: items.length - pushed, pushed, reason: `SEND_${r.errorKind ?? 'FAILED'}`, parts };
      await this.launchWatch.markPushed(p.items.filter((x) => !x.again).map((x) => x.id), p.items.filter((x) => x.again).map((x) => x.id));
      pushed += p.items.length; parts++;
    }
    return { pending: items.length - pushed, pushed, reason: null, parts };
  }

  /**
   * v10.201 (D179 · docs/318) — 하루 요약을 텔레그램으로도(설정 ops.telegram_digest · 급한 알림과 같은 대화방).
   *   꺼짐 · 준비 안 됨 · 실패는 까닭만 돌려줌(DAILY_DIGEST 알림 detail 의 pushReason) — 다시 보내지 않음(다음 날 새 요약).
   */
  private async digestPush(text: string): Promise<{ pushed: boolean; reason: string | null }> {
    const [o] = await this.db.query<{ v: string }>(`SELECT coalesce((SELECT value FROM site_settings WHERE key = 'ops.telegram_digest'), 'on') AS v`);
    if ((o?.v ?? 'on') !== 'on') return { pushed: false, reason: 'OFF' };
    const st = await this.telegram.status();
    if (!st.ready) return { pushed: false, reason: st.reason };
    const [b] = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM v_open_blockers`);
    const r = await this.telegram.send(`[소개뱅크] ${text}\n오픈 차단 ${b?.n ?? 0}건(운영 화면 › 오픈 체크리스트)`);
    return r.ok ? { pushed: true, reason: null } : { pushed: false, reason: `SEND_${r.errorKind ?? 'FAILED'}` };
  }

  /** v10.249 (D203 · docs/386) — 대표 할 일 중 아직인 줄만 한 통(텔레그램 · 슬랙 · 켜 둔 길만). 스위치 ops.owner_todo_weekly(on).
   *  모두 끝났으면 보내지 않고 알림도 남기지 않음 · 보냈든 못 보냈든 운영 알림 OWNER_TODO_WEEKLY(INFO) 한 건 */
  private async ownerTodoWeekly(): Promise<{ off?: true; left: number; total: number; warn7: number; telegram: string | null; slack: string | null }> {
    const [o] = await this.db.query<{ v: string }>(`SELECT coalesce((SELECT value FROM site_settings WHERE key = 'ops.owner_todo_weekly'), 'on') AS v`);
    const d = await this.ownerTodo.rows();
    const left = d.rows.filter((r) => r.done !== true);
    /* v10.252 (docs/387) — 지난 7일 운영 알림(경고 이상)도 같은 한 통에 · 할 일이 다 끝났어도 경고 이상이 있었으면 보냄 */
    const aw = await this.launchWatch.alertsWeek();
    if ((o?.v ?? 'on') !== 'on') return { off: true, left: left.length, total: d.total, warn7: aw.warnTotal, telegram: null, slack: null };
    if (!left.length && !aw.warnTotal) return { left: 0, total: d.total, warn7: 0, telegram: null, slack: null };
    const text = ownerTodoWeeklyText(left, d.done, d.total) + '\n\n' + alertsWeekText(aw);
    const tg = await this.telegram.status();
    let telegram: string | null = tg.ready ? null : tg.reason;
    if (tg.ready) { const r = await this.telegram.send(text); telegram = r.ok ? 'SENT' : `SEND_${r.errorKind ?? 'FAILED'}`; }
    const sk = this.slack.status();
    let slack: string | null = sk.ready ? null : sk.reason;
    if (sk.ready) { const r = await this.slack.send(text); slack = r.ok ? 'SENT' : `SEND_${r.errorKind ?? 'FAILED'}`; }
    const sent = [telegram === 'SENT' ? '텔레그램' : '', slack === 'SENT' ? '슬랙' : ''].filter(Boolean);
    await opsBoardPost(this.db, 'OWNER_TODO', `대표 할 일 이번 주 — 아직 ${left.length}줄`, text, telegram, slack);   /* v10.286 (D213) */
    await this.alert('OWNER_TODO_WEEKLY', 'INFO',
      `대표 할 일 아직 ${left.length}줄(끝남 ${d.done} / ${d.total}) · 지난 7일 경고 이상 알림 ${aw.warnTotal}건 — ${sent.length ? `${sent.join(' · ')}으로 보냄` : '보낸 길 없음(텔레그램 · 슬랙이 준비 안 됨)'}`,
      { left: left.map((r) => r.key), done: d.done, total: d.total, warn7: aw.warnTotal, warnOpen: aw.warnOpen, telegram, slack });
    return { left: left.length, total: d.total, warn7: aw.warnTotal, telegram, slack };
  }

  /** v10.352 (D234 · docs/486) — 고객센터 주간 보고 한 통(텔레그램 · 슬랙 · 켜 둔 길만) · 운영자 게시판 · 운영 알림 CS_WEEKLY(INFO). 스위치 ops.cs_weekly(on) */
  private async csWeekly(): Promise<{ off?: true; from: string; to: string; telegram: string | null; slack: string | null }> {
    const [o] = await this.db.query<{ v: string }>(`SELECT coalesce((SELECT value FROM site_settings WHERE key = 'ops.cs_weekly'), 'on') AS v`);
    const st = await csWeeklyStats(this.db);
    if ((o?.v ?? 'on') !== 'on') return { off: true, from: st.from, to: st.to, telegram: null, slack: null };
    const text = csWeeklyText(st);
    const tg = await this.telegram.status();
    let telegram: string | null = tg.ready ? null : tg.reason;
    if (tg.ready) { const r = await this.telegram.send(text); telegram = r.ok ? 'SENT' : `SEND_${r.errorKind ?? 'FAILED'}`; }
    const sk = this.slack.status();
    let slack: string | null = sk.ready ? null : sk.reason;
    if (sk.ready) { const r = await this.slack.send(text); slack = r.ok ? 'SENT' : `SEND_${r.errorKind ?? 'FAILED'}`; }
    const title = `고객센터 주간 보고 ${st.from} ~ ${st.to} — 접수 ${st.received} · 해결률 ${st.resolvedRate == null ? '—' : `${st.resolvedRate}%`}`;
    await opsBoardPost(this.db, 'DAILY_DIGEST', title, text, telegram, slack);
    await this.alert('CS_WEEKLY', 'INFO', title, { ...st, telegram, slack });
    return { from: st.from, to: st.to, telegram, slack };
  }

  /** v10.358 (D236 · docs/492) — 급한 알림(CRITICAL · 확인 · 풀림 전 · 24시간 안)을 오늘 당번 개인 텔레그램으로 한 번(oncall_pushed_at) ·
   *  30분 안에 확인이 없으면 SUPER 개인 텔레그램(당번 뺌)으로 한 번(escalated_at). 대화방 보내기(alertPush)는 그대로 */
  private async oncallPush(): Promise<{ oncall: number; escalated: number; reason: string | null }> {
    const tg = await this.telegram.status();
    if (tg.reason === 'NO_TOKEN') return { oncall: 0, escalated: 0, reason: 'NO_TOKEN' };
    const [o] = await this.db.query<{ account_id: string | null; chat: string | null }>(
      `SELECT o.account_id, s.telegram_chat AS chat FROM staff_oncall o LEFT JOIN staff_access s ON s.account_id = o.account_id
        WHERE o.dow = extract(isodow FROM now() AT TIME ZONE 'Asia/Seoul')::int`);
    let oncall = 0, escalated = 0, reason: string | null = null;
    const items = await this.db.query<{ id: string; title: string }>(
      `SELECT id::text AS id, title FROM ops_alerts
        WHERE severity = 'CRITICAL' AND acknowledged_at IS NULL AND resolved_at IS NULL AND oncall_pushed_at IS NULL AND raised_at > now() - interval '24 hours'
          AND NOT EXISTS (SELECT 1 FROM alert_mutes m WHERE m.alert_code = ops_alerts.alert_code AND m.lifted_at IS NULL AND m.until_at > now())   /* v10.370 (D239) 잠시 끈 종류 뺌 */
        ORDER BY raised_at LIMIT 20`);
    if (items.length) {
      if (!o?.chat) reason = o?.account_id ? 'ONCALL_NO_CHAT' : 'NO_ONCALL';
      else {
        const r = await this.telegram.send(`[소개뱅크 당번] 급한 알림 ${items.length}건\n${items.map((x) => `· ${x.title}`).join('\n')}\n운영 화면 › 위험감지 › 운영 알림에서 「확인」`, o.chat);
        if (r.ok) { await this.db.query(`UPDATE ops_alerts SET oncall_pushed_at = now() WHERE id = ANY($1::bigint[])`, [items.map((x) => x.id)]); oncall = items.length; }
        else reason = `SEND_${r.errorKind ?? 'FAILED'}`;
      }
    }
    const esc = await this.db.query<{ id: string; title: string }>(
      `SELECT id::text AS id, title FROM ops_alerts
        WHERE severity = 'CRITICAL' AND acknowledged_at IS NULL AND resolved_at IS NULL AND escalated_at IS NULL
          AND raised_at < now() - interval '30 minutes' AND raised_at > now() - interval '24 hours'
          AND NOT EXISTS (SELECT 1 FROM alert_mutes m WHERE m.alert_code = ops_alerts.alert_code AND m.lifted_at IS NULL AND m.until_at > now())   /* v10.370 (D239) */
        ORDER BY raised_at LIMIT 20`);
    if (esc.length) {
      const chats = await this.db.query<{ chat: string }>(
        `SELECT DISTINCT s.telegram_chat AS chat FROM account_roles r JOIN staff_access s ON s.account_id = r.account_id
          WHERE r.role = 'SUPER' AND s.telegram_chat IS NOT NULL AND r.account_id IS DISTINCT FROM $1::uuid`, [o?.account_id ?? null]);
      let sent = false;
      for (const c of chats) {
        const r = await this.telegram.send(`[소개뱅크 · 30분 확인 없음] 급한 알림 ${esc.length}건\n${esc.map((x) => `· ${x.title}`).join('\n')}\n당번이 아직 확인하지 않았습니다 — 운영 화면 › 위험감지 › 운영 알림`, c.chat);
        sent = sent || r.ok;
      }
      if (sent) { await this.db.query(`UPDATE ops_alerts SET escalated_at = now() WHERE id = ANY($1::bigint[])`, [esc.map((x) => x.id)]); escalated = esc.length; }
      else reason = reason ?? (chats.length ? 'ESCALATE_SEND_FAILED' : 'NO_SUPER_CHAT');
    }
    return { oncall, escalated, reason };
  }

  /** v10.354 (D235 · docs/488) — 월간 보안 보고: 지난달 것을 아직 안 보냈으면 한 통(텔레그램 · 슬랙 · 켜 둔 길만) · 운영자 게시판 · 운영 알림 SECURITY_MONTHLY(INFO · detail.month)
   *  스위치 ops.security_monthly(on). 같은 달은 한 번만(운영 알림 detail.month 로 셈) */
  private async securityMonthly(): Promise<{ off?: true; month: string; sent: boolean; skipped?: string; telegram: string | null; slack: string | null }> {
    const [o] = await this.db.query<{ v: string }>(`SELECT coalesce((SELECT value FROM site_settings WHERE key = 'ops.security_monthly'), 'on') AS v`);
    const st = await securityMonthlyStats(this.db);
    if ((o?.v ?? 'on') !== 'on') return { off: true, month: st.month, sent: false, telegram: null, slack: null };
    const [done] = await this.db.query(`SELECT 1 FROM ops_alerts WHERE alert_code = 'SECURITY_MONTHLY' AND detail->>'month' = $1 LIMIT 1`, [st.month]);
    if (done) return { month: st.month, sent: false, skipped: 'ALREADY_SENT', telegram: null, slack: null };
    const text = securityMonthlyText(st);
    const tg = await this.telegram.status();
    let telegram: string | null = tg.ready ? null : tg.reason;
    if (tg.ready) { const r = await this.telegram.send(text); telegram = r.ok ? 'SENT' : `SEND_${r.errorKind ?? 'FAILED'}`; }
    const sk = this.slack.status();
    let slack: string | null = sk.ready ? null : sk.reason;
    if (sk.ready) { const r = await this.slack.send(text); slack = r.ok ? 'SENT' : `SEND_${r.errorKind ?? 'FAILED'}`; }
    const title = `월간 보안 보고 ${st.month} — 권한 주기 ${st.grants} · 개인정보 열람 ${st.piiViews} · 급한 알림 ${st.critical}`;
    await opsBoardPost(this.db, 'DAILY_DIGEST', title, text, telegram, slack);
    await this.alert('SECURITY_MONTHLY', 'INFO', title, { ...st, telegram, slack });
    return { month: st.month, sent: true, telegram, slack };
  }

  /** v10.356 (D235 · docs/490) — 감사 기록 사슬 확인 · 끊기면 급한 알림(같은 것 한 번) · 다시 온전하면 풂 */
  private async auditChain(): Promise<{ ok: boolean; checked: number; brokenId: string | null }> {
    const r = await auditChainCheck(this.db);
    if (!r.ok) {
      await this.alertOnce('AUDIT_CHAIN_BROKEN', 'CRITICAL', `감사 기록 위변조 의심 — 줄 ${r.brokenId ?? '?'}: ${r.reason ?? ''}(위험감지 › 감사 · DB 에서 직접 고치거나 지웠을 수 있음)`, { brokenId: r.brokenId, reason: r.reason });
      this.log.error(`AUDIT_CHAIN_BROKEN 감사 기록 사슬 끊김 — 줄 ${r.brokenId}: ${r.reason}`);
    } else {
      await this.resolveAlert('AUDIT_CHAIN_BROKEN', '다시 확인하니 온전함');
    }
    return { ok: r.ok, checked: r.checked, brokenId: r.brokenId };
  }

  /** v10.350 (D234 · docs/484) — 기한 지난 허용 IP 를 목록에서 뺌(감사 STAFF_IP_ALLOW_EXPIRE) · 남는 IP 가 없으면 빼지 않고 경고 ·
   *  뺐고 감시 서비스가 있으면 Nginx 적용을 요청(남은 목록) */
  private async staffIpExpire(): Promise<{ removed: string[]; kept: number; requested: string | null }> {
    const [k] = await this.db.query<{ active: number; expired: number }>(
      `SELECT count(*) FILTER (WHERE expires_at IS NULL OR expires_at > now())::int AS active,
              count(*) FILTER (WHERE expires_at <= now())::int AS expired FROM staff_ip_allow`);
    if (!k || !Number(k.expired)) return { removed: [], kept: 0, requested: null };
    if (!Number(k.active)) {
      await this.alertOnce('STAFF_IP_EXPIRE_LAST', 'WARN',
        `허용 IP 가 모두 기한이 지났습니다 — ${k.expired}곳을 빼지 않고 남겼습니다(인증 면제는 끊김 · 권한 계층 › 접속 인증에서 기한 없는 IP 를 더하십시오)`, { expired: k.expired });
      return { removed: [], kept: Number(k.expired), requested: null };
    }
    const rows = await this.db.query<{ ip: string; memo: string }>(`DELETE FROM staff_ip_allow WHERE expires_at <= now() RETURNING host(ip) AS ip, memo`);
    await this.db.query(`INSERT INTO audit.audit_logs (action, target_type, after_data) VALUES ('STAFF_IP_ALLOW_EXPIRE', 'SETTING', $1::jsonb)`, [JSON.stringify({ removed: rows })]);
    await this.resolveAlert('STAFF_IP_EXPIRE_LAST', '기한 없는 허용 IP 가 생김');
    let requested: string | null = null;
    if (rows.length && nginxWatcher().installed) {
      const st = await nginxListState(this.db);
      if (st.list.length) { try { requested = writeNginxRequest(st.list, st.hash); } catch { requested = 'WRITE_FAILED'; } }
    }
    if (rows.length) this.log.warn(`STAFF_IP_ALLOW_EXPIRE 기한 지난 허용 IP ${rows.length}곳 뺌${requested ? ` · Nginx 적용 요청 ${requested}` : ''}`);
    return { removed: rows.map((r) => r.ip), kept: 0, requested };
  }

  /** v10.349 (docs/483) — Nginx 적용 알림: 적용 실패(급함 · 결과마다 한 번) · 요청 뒤 10분 결과 없음(급함) · 목록을 고친 뒤 24시간 반영 안 함(경고). 고치면 풂 */
  private async nginxAlerts(): Promise<string[]> {
    const st = await nginxListState(this.db);
    const w = st.watch;
    const out: string[] = [];
    if (w.last && !w.last.ok) {
      const [e] = await this.db.query(`SELECT 1 FROM ops_alerts WHERE alert_code = 'NGINX_APPLY_FAILED' AND detail->>'id' = $1 LIMIT 1`, [w.last.id]);
      if (!e) {
        await this.alert('NGINX_APPLY_FAILED', 'CRITICAL', `운영 화면 허용 IP Nginx 적용 실패 — ${w.last.message}(권한 계층 › 접속 인증 › Nginx 반영 · Nginx 는 그대로)`, { id: w.last.id, hash: w.last.hash, at: w.last.at });
        out.push('FAILED');
      }
    } else if (w.last?.ok) {
      await this.resolveAlert('NGINX_APPLY_FAILED', '다음 적용이 성공함');
    }
    if (w.pending && Date.now() - new Date(w.pending.at).getTime() > 10 * 60_000) {
      if (await this.alertOnce('NGINX_WATCH_STUCK', 'CRITICAL', `Nginx 적용 요청 뒤 10분이 지나도 결과가 없습니다 — 운영 서버 감시 서비스(sgb-nginx-allow.path)를 확인하십시오`, { id: w.pending.id, at: w.pending.at })) out.push('STUCK');
    } else if (!w.pending) {
      await this.resolveAlert('NGINX_WATCH_STUCK', '요청 결과가 나옴');
    }
    const old = !!st.lastChangedAt && Date.now() - new Date(st.lastChangedAt).getTime() > 24 * 3600_000;
    if (st.list.length && !st.appliedSame && old) {
      if (await this.alertOnce('NGINX_NOT_APPLIED', 'WARN', `허용 IP 를 고친 뒤 24시간이 지나도 Nginx 에 반영하지 않았습니다(권한 계층 › 접속 인증 › Nginx 반영 · 「적용」)`, { hash: st.hash, lastChangedAt: st.lastChangedAt })) out.push('NOT_APPLIED');
    } else if (st.appliedSame || !st.list.length) {
      await this.resolveAlert('NGINX_NOT_APPLIED', '반영한 목록과 같아짐');
    }
    /* v10.353 (docs/487) — 막힌 접속: 한 IP 가 24시간 100번 넘게 두드리면 경고(IP 는 가림) · 줄면 풂 */
    const dn = nginxDenied();
    const hot = dn.rows.filter((r) => r.n24 >= 100);
    if (hot.length) {
      const mask = (ip: string) => (ip.includes('.') ? ip.split('.').slice(0, 2).join('.') + '.*.*' : ip.split(':').slice(0, 2).join(':') + ':…');
      if (await this.alertOnce('NGINX_DENIED_SPIKE', 'WARN', `운영 화면에 허용 밖 접속이 몰립니다 — ${hot.slice(0, 3).map((r) => `${mask(r.ip)} ${r.n24}번`).join(' · ')}(24시간 · 권한 계층 › 접속 인증 › 막힌 접속)`, { ips: hot.length, top: hot.slice(0, 3).map((r) => ({ n24: r.n24, last: r.last })) })) out.push('DENIED_SPIKE');
    } else if (dn.installed) {
      await this.resolveAlert('NGINX_DENIED_SPIKE', '24시간 100번 넘는 IP 가 없어짐');
    }
    return out;
  }

  /** 같은 종류의 풀리지 않은 알림이 없을 때만 한 건 */
  /** v10.372 (D239 · docs/507) 운영 권한 기한 — 지난 권한을 거둠(role_changes 사유 「기한 지남」 · 마지막 SUPER 는 DB 가 막음 → 실패로 셈) ·
   *  거둔 것이 있으면 기록용 알림 ROLE_EXPIRED(INFO · 바로 풀림) · 3일 안 기한이 있으면 ROLE_EXPIRING(INFO · 없어지면 풂) */
  private async roleExpire() {
    const due = await this.db.query<{ id: string; role: string; email: string }>(
      `SELECT r.account_id::text AS id, r.role, a.email::text AS email FROM account_roles r JOIN accounts a ON a.id = r.account_id
        WHERE r.expires_at IS NOT NULL AND r.expires_at <= now() ORDER BY r.expires_at LIMIT 50`);
    const done: string[] = [], failed: string[] = [];
    for (const d of due) {
      try {
        await this.db.transaction(async () => {
          await this.db.query(`SELECT set_config('app.role_reason', '기한 지남 — 정기 작업 sla_alert · v10.372', true), set_config('app.actor_id', '', true)`);
          await this.db.query(`DELETE FROM account_roles WHERE account_id = $1 AND role = $2 AND expires_at <= now()`, [d.id, d.role]);
        });
        done.push(`${maskMail(d.email)} ${d.role}`);
      } catch { failed.push(`${maskMail(d.email)} ${d.role}`); }
    }
    if (done.length || failed.length) {
      await this.db.query(
        `INSERT INTO ops_alerts (alert_code, severity, title, detail, resolved_at, resolve_note) VALUES ('ROLE_EXPIRED', $1, $2, $3::jsonb, CASE WHEN $4 THEN now() END, CASE WHEN $4 THEN '기록만' END)`,
        [failed.length ? 'WARN' : 'INFO', `운영 권한 기한 지나 거둠 ${done.length}건${failed.length ? ` · 못 거둠 ${failed.length}건(마지막 SUPER 등)` : ''}(위험감지 › 운영자 권한)`,
         JSON.stringify({ done, failed }), !failed.length]);
    }
    const [s] = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM account_roles WHERE expires_at > now() AND expires_at <= now() + interval '3 days'`);
    const soon = Number(s?.n ?? 0);
    if (soon) await this.alertOnce('ROLE_EXPIRING', 'INFO', `3일 안에 기한이 끝나는 운영 권한 ${soon}건(위험감지 › 운영자 권한 「기한」 · 이어 주려면 회원 상세에서 다시 「권한 주기」)`, { soon });
    else await this.resolveAlert('ROLE_EXPIRING', '3일 안 기한 없음');
    return { revoked: done.length, failed: failed.length, soon };
  }

  /** v10.373 (D240 · docs/508) 분쟁(열림 · 검토 중) · 정산 승인 대기가 설정 날 수를 넘으면 DISPUTE_OVERDUE · SETTLE_OVERDUE(WARN · 하나만) · 0건이면 풂 */
  private async disputeSettleOverdue() {
    const [r] = await this.db.query<{ d: number; s: number; dd: number; sd: number }>(
      `SELECT (SELECT count(*)::int FROM disputes WHERE status IN ('OPEN', 'IN_REVIEW') AND opened_at < now() - make_interval(days => fn_setting_int('ops.dispute_due_days', 3))) AS d,
              (SELECT count(*)::int FROM settlements WHERE status = 'REQUESTED' AND requested_at < now() - make_interval(days => fn_setting_int('ops.settle_due_days', 2))) AS s,
              fn_setting_int('ops.dispute_due_days', 3) AS dd, fn_setting_int('ops.settle_due_days', 2) AS sd`);
    const d = Number(r?.d ?? 0), s = Number(r?.s ?? 0);
    if (d) await this.alertOnce('DISPUTE_OVERDUE', 'WARN', `분쟁 ${d}건이 ${r!.dd}일 넘게 처리 중입니다(거래 › 분쟁 · 오래된 것부터)`, { overdue: d, days: r!.dd });
    else await this.resolveAlert('DISPUTE_OVERDUE', '기한 넘긴 분쟁 없음');
    if (s) await this.alertOnce('SETTLE_OVERDUE', 'WARN', `정산 승인 대기 ${s}건이 ${r!.sd}일을 넘었습니다(정산 › 정산 승인)`, { overdue: s, days: r!.sd });
    else await this.resolveAlert('SETTLE_OVERDUE', '기한 넘긴 정산 없음');
    return { disputes: d, settlements: s };
  }

  /** v10.367 (D238 · docs/502) 신고 처리 기한 — 열린 신고가 설정 시간을 넘으면 REPORT_OVERDUE(WARN · 하나만) · 다 처리되면 풂 */
  private async reportOverdue() {
    const [r] = await this.db.query<{ n: number; h: number; oldest: string | null }>(
      `WITH s AS (SELECT coalesce((SELECT CASE WHEN value ~ '^[0-9]+$' THEN value::int END FROM site_settings WHERE key = 'ops.report_due_hours'), 24) AS h)
       SELECT (SELECT count(*)::int FROM reports, s WHERE state IN ('OPEN', 'QUEUED') AND created_at < now() - make_interval(hours => s.h)) AS n,
              (SELECT h FROM s) AS h,
              (SELECT min(created_at) FROM reports, s WHERE state IN ('OPEN', 'QUEUED') AND created_at < now() - make_interval(hours => s.h)) AS oldest`);
    const n = Number(r?.n ?? 0);
    if (n > 0) await this.alertOnce('REPORT_OVERDUE', 'WARN', `신고 ${n}건이 ${r!.h}시간 넘게 처리되지 않았습니다(신고 처리 화면 · 가장 오래된 것부터)`, { overdue: n, hours: r!.h, oldest: r!.oldest });
    else await this.resolveAlert('REPORT_OVERDUE', '기한 넘긴 신고 없음');
    return { overdue: n, hours: Number(r?.h ?? 24) };
  }

  /** v10.368 (D238 · docs/503) DB 복원 시험 — 마지막 시험이 설정 날 수보다 오래되면(없으면) RESTORE_DRILL_DUE(WARN) · 적으면 풂 */
  private async restoreDrillDue() {
    const [r] = await this.db.query<{ days: number | null; due: number }>(
      `SELECT ((now() AT TIME ZONE 'Asia/Seoul')::date - (SELECT max(drill_date) FROM restore_drills))::int AS days,
              coalesce((SELECT CASE WHEN value ~ '^[0-9]+$' THEN value::int END FROM site_settings WHERE key = 'ops.restore_drill_days'), 30) AS due`);
    const days = r?.days == null ? null : Number(r.days);
    const due = Number(r?.due ?? 30);
    if (days == null || days > due) {
      await this.alertOnce('RESTORE_DRILL_DUE', 'WARN', days == null ? 'DB 복원 시험 기록이 아직 없습니다(관 관리 › 업무 안내 › DB 복원 시험)' : `DB 복원 시험을 ${days}일째 안 했습니다(주기 ${due}일 · 관 관리 › 업무 안내 › DB 복원 시험)`, { days, due });
    } else await this.resolveAlert('RESTORE_DRILL_DUE', '복원 시험 기록됨');
    return { days, due };
  }

  private async alertOnce(code: string, severity: 'INFO' | 'WARN' | 'CRITICAL', title: string, detail: unknown): Promise<boolean> {
    const r = await this.db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail)
       SELECT $1, $2, $3, $4::jsonb WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = $1 AND resolved_at IS NULL)
       ON CONFLICT DO NOTHING RETURNING id`, [code, severity, title, JSON.stringify(detail)]);
    return r.length > 0;
  }

  private resolveAlert(code: string, note: string) {
    return this.db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2 WHERE alert_code = $1 AND resolved_at IS NULL`, [code, note]);
  }

  /** v10.237 (D200 · docs/377) — 급한 알림 슬랙(텔레그램과 같은 알림 · 같은 기준 · 같은 글 · 기록은 slack_pushed_at · slack_repushed_at).
   *  웹훅 주소가 없으면 보내지 않고 까닭만 · 보내진 통의 알림만 「보냄」 · 실패하면 그 자리에서 멈춤(남은 것은 다음 차례) */
  private async alertSlack(): Promise<{ pending: number; pushed: number; reason: string | null; parts?: number }> {
    const items = await this.launchWatch.alertPushPending('slack');
    if (!items.length) return { pending: 0, pushed: 0, reason: null };
    const st = this.slack.status();
    if (!st.ready) return { pending: items.length, pushed: 0, reason: st.reason };
    const plan = buildAlertPush(items, await this.launchWatch.alertBacklog('slack'));
    let pushed = 0, parts = 0;
    for (const p of plan.parts) {
      const r = await this.slack.send(p.text);
      if (!r.ok) return { pending: items.length - pushed, pushed, reason: `SEND_${r.errorKind ?? 'FAILED'}`, parts };
      await this.launchWatch.markSlacked(p.items.filter((x) => !x.again).map((x) => x.id), p.items.filter((x) => x.again).map((x) => x.id));
      pushed += p.items.length; parts++;
    }
    return { pending: items.length - pushed, pushed, reason: null, parts };
  }

  /** v10.237 (D200) — 하루 요약 슬랙(설정 ops.slack_digest · 급한 알림과 같은 채널) — 텔레그램 digestPush 와 같은 글 · 다시 보내지 않음 */
  private async digestSlack(text: string): Promise<{ pushed: boolean; reason: string | null }> {
    const [o] = await this.db.query<{ v: string }>(`SELECT coalesce((SELECT value FROM site_settings WHERE key = 'ops.slack_digest'), 'on') AS v`);
    if ((o?.v ?? 'on') !== 'on') return { pushed: false, reason: 'OFF' };
    const st = this.slack.status();
    if (!st.ready) return { pushed: false, reason: st.reason };
    const [b] = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM v_open_blockers`);
    const r = await this.slack.send(`[소개뱅크] ${text}\n오픈 차단 ${b?.n ?? 0}건(운영 화면 › 오픈 체크리스트)`);
    return r.ok ? { pushed: true, reason: null } : { pushed: false, reason: `SEND_${r.errorKind ?? 'FAILED'}` };
  }

  /* 심각도는 DB 제약(ops_alerts_severity_check)이 받는 셋뿐입니다.
   * 전에는 'HIGH' · 'MEDIUM' 을 쓰는 곳이 있어 그 알림을 넣을 때 제약에 걸렸고, **알림이 남지 않은 채 작업 전체가 실패로 기록**됐습니다
   * (정기결제 실패 · 카드 교체 필요 · 알림 미발송 · 위험 탐지 — 실측 422 CHECK_VIOLATION). 타입으로 막습니다. */
  /**
   * v10.317 (D220 · docs/442) — 「간주 끌 수 있음」: 간주 모드 끄는 순서(AdminService.assumeReadiness · 서버가 끌 때 보는 조건 그대로)에서
   *   켜져 있고(off 아님) 조건을 모두 갖춘(ready) 항목 중 최근 7일 안에 ASSUME_READY 로 알리지 않은 것을 한 줄로(items · (종류 · 시각) 고유라 한 번에 한 줄).
   *   메일 · 텔레그램 · 슬랙 급한 알림 목록에 들어감(D220). 끄는 것은 사람이(관리자 스위치) — 여기서는 알리기만. 돌려주는 값: 이번에 알린 키.
   */
  private async assumeReadyAlert(): Promise<string[]> {
    const ar = await this.admin.assumeReadiness();
    const due: Array<{ key: string; order: number; label: string }> = [];
    for (const r of ar.rows.filter((x) => !x.off && x.ready)) {
      const [seen] = await this.db.query<{ s: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ASSUME_READY' AND raised_at > now() - interval '7 days'
                         AND detail -> 'items' @> jsonb_build_array(jsonb_build_object('key', $1::text))) AS s`, [r.key]);
      if (!seen?.s) due.push({ key: r.key, order: r.order, label: r.label });
    }
    if (!due.length) return [];
    await this.alert('ASSUME_READY', 'INFO',
      `간주를 끌 수 있습니다 — ${due.map((x) => `${x.order}. ${x.label}`).join(' · ')}(관 관리 › 오픈 체크리스트 › 「간주 모드 끄는 순서」 · 끄기는 「관리자 스위치」 · 권하는 순서 수금 계좌 → 중개사 → 세금계산서 → 결제)`,
      { items: due });
    return due.map((x) => x.key);
  }

  private alert(code: string, severity: 'INFO' | 'WARN' | 'CRITICAL', title: string, detail: unknown) {
    return this.db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail)
       VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`,
      [code, severity, title, JSON.stringify(detail)]);
  }
}
