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
import { ServerTrendService } from '../modules/admin/server-trend.service';
import { NotifyMailSender } from '../common/mail/notify-mail';
import { AlimtalkService } from '../common/alimtalk/alimtalk.service';
import { EsignService } from '../modules/deal/esign.service';
import { SafenumService } from '../modules/listing/safenum.service';
import { TranslateService } from '../modules/i18n/translate.service';
import { ReviewShadowService } from '../modules/agent/review-shadow.service';
import { TownPickService } from '../modules/community/town-pick.service';
import { AgentChatService } from '../modules/agent/agent-chat.service';
import { LaunchWatchService, termsAlertTitle } from '../modules/admin/launch-watch.service';
import { uploadsBackupState } from '../common/uploads-backup-state';
import { PiiReviewService } from '../modules/admin/pii-review.service';
import { RoleReviewService } from '../modules/admin/role-review.service';
import { PrivacyService } from '../modules/identity/privacy.service';
import { measureServerHealth } from '../common/server-health';

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
  | 'seller_license_watch' | 'owner_todo_weekly';

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
        /* v10.199 (D177) — 원인이 없어진 알림에 「풀림」(백업 멈춤 · 백업 실패 · 묶음 깨짐 · 디스크) — 확인 안 한 수 · 메일에서 빠짐 */
        const rs = await this.launchWatch.resolveAlerts(dk.usedPct, dk.limit);
        /* v10.197 (D175 · docs/310) — 급한 알림(CRITICAL · 중요 설정 바뀜)을 ops.digest_to 로 메일 · 메일이 준비 안 됐으면 기록만(보낸 것으로 적지 않음) */
        const am = await this.alertMail();
        const ap = await this.alertPush();   /* v10.200 (D178) — 메일과 따로(메일이 준비 안 돼도 감) */
        const as = await this.alertSlack();   /* v10.237 (D200) — 텔레그램 · 메일과 따로 */
        /* v10.239 (docs/379) — 켜 둔 길이 60분 넘게 보내기 실패면 ALERT_CHANNEL_FAIL(CRITICAL · 다음 차례에 다른 길로) · 다시 되거나 꺼지면 풀림 */
        const cf = await this.channels.failWatch({ mail: am, telegram: ap, slack: as });
        const cs = await this.launchWatch.flushCsp();   /* v10.221 (D191) — 보안 정책 보고를 DB 에 더함 · 30일 지난 줄 지움 */
        detail = { alertMail: am, alertPush: ap, alertSlack: as, ...r, signupHour: sp.n, serverErrors10m: se.n, slowP95: sl.p95, diskPct: dk.usedPct, orderGuard: og.expired ? 'EXPIRED' : og.noEnd ? 'NO_END' : og.open ? 'OPEN' : 'OFF', resolved: rs, csp: cs, agentLive: aw.live?.severity ?? null, agentGap: !!aw.gap, agentStep: sr.map((x) => x.detail.step), channelFail: cf, serverDaily: sd };   /* v10.198 — alertMail 을 앞에(job_runs.detail 은 2000자에서 잘림 · 운영 알림 화면이 읽음) */
        break;
      }

      /* v10.249 (D203 · docs/386) — 대표 할 일 주간 알림(월요일 09:05): 아직인 줄만 텔레그램 · 슬랙(켜 둔 길만) · 모두 끝났으면 안 보냄 */
      case 'owner_todo_weekly': {
        const w = await this.ownerTodoWeekly();
        affected = w.left; detail = w;
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

        // 파기 기한을 넘긴 건이 남아 있으면 경보 — 법정 기한 초과입니다
        const [over] = await this.db.query<{ n: string }>(
          `SELECT count(*) AS n FROM v_purge_overdue`);
        if (Number(over.n) > 0) {
          await this.alert('PII_PURGE_OVERDUE', 'WARN',
            '파기 기한을 넘긴 개인정보가 있습니다', { count: Number(over.n) });
        }

        affected = acc.n + leads.length + consult.n + authRec.n + taxIds.n;
        detail = { accounts: acc.n, ipMasked: ip.n, leads: leads.length, consultRequests: consult.n, authRecords: authRec.n, taxIds: taxIds.n, overdue: Number(over.n) };
        break;
      }
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
    return { pending: 0, mailed: p.items.length, reason: null };
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
  private async ownerTodoWeekly(): Promise<{ off?: true; left: number; total: number; telegram: string | null; slack: string | null }> {
    const [o] = await this.db.query<{ v: string }>(`SELECT coalesce((SELECT value FROM site_settings WHERE key = 'ops.owner_todo_weekly'), 'on') AS v`);
    const d = await this.ownerTodo.rows();
    const left = d.rows.filter((r) => r.done !== true);
    if ((o?.v ?? 'on') !== 'on') return { off: true, left: left.length, total: d.total, telegram: null, slack: null };
    if (!left.length) return { left: 0, total: d.total, telegram: null, slack: null };
    const text = ownerTodoWeeklyText(left, d.done, d.total);
    const tg = await this.telegram.status();
    let telegram: string | null = tg.ready ? null : tg.reason;
    if (tg.ready) { const r = await this.telegram.send(text); telegram = r.ok ? 'SENT' : `SEND_${r.errorKind ?? 'FAILED'}`; }
    const sk = this.slack.status();
    let slack: string | null = sk.ready ? null : sk.reason;
    if (sk.ready) { const r = await this.slack.send(text); slack = r.ok ? 'SENT' : `SEND_${r.errorKind ?? 'FAILED'}`; }
    const sent = [telegram === 'SENT' ? '텔레그램' : '', slack === 'SENT' ? '슬랙' : ''].filter(Boolean);
    await this.alert('OWNER_TODO_WEEKLY', 'INFO',
      `대표 할 일 아직 ${left.length}줄(끝남 ${d.done} / ${d.total}) — ${sent.length ? `${sent.join(' · ')}으로 보냄` : '보낸 길 없음(텔레그램 · 슬랙이 준비 안 됨)'}`,
      { left: left.map((r) => r.key), done: d.done, total: d.total, telegram, slack });
    return { left: left.length, total: d.total, telegram, slack };
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
  private alert(code: string, severity: 'INFO' | 'WARN' | 'CRITICAL', title: string, detail: unknown) {
    return this.db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail)
       VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`,
      [code, severity, title, JSON.stringify(detail)]);
  }
}
