import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { RecurringBatchService } from '../modules/billing/recurring-batch.service';
import { LeadCashService } from '../modules/partner/lead-cash.service';
import { GeoService } from '../common/geo/geo.service';
import { MailService } from '../common/mail/mail.service';
import { NotifyMailSender } from '../common/mail/notify-mail';
import { AlimtalkService } from '../common/alimtalk/alimtalk.service';
import { EsignService } from '../modules/deal/esign.service';
import { SafenumService } from '../modules/listing/safenum.service';
import { TranslateService } from '../modules/i18n/translate.service';
import { ReviewShadowService } from '../modules/agent/review-shadow.service';
import { AgentChatService } from '../modules/agent/agent-chat.service';

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
  | 'hlt_auto_confirm' | 'hlt_rank' | 'lead_cash_auto' | 'directory_expiry'
  | 'geo_backfill' | 'translate_jobs' | 'review_shadow' | 'agent_chat_purge' | 'esign_poll' | 'safenum_release';

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
    private readonly agentChat: AgentChatService,
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

      /** 매시간. 급구 배지 만료 */
      case 'expire_badges': {
        const [r] = await this.db.query<{ n: number }>(`SELECT fn_expire_badges() AS n`);
        affected = r.n;
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

        // 파기 기한을 넘긴 건이 남아 있으면 경보 — 법정 기한 초과입니다
        const [over] = await this.db.query<{ n: string }>(
          `SELECT count(*) AS n FROM v_purge_overdue`);
        if (Number(over.n) > 0) {
          await this.alert('PII_PURGE_OVERDUE', 'WARN',
            '파기 기한을 넘긴 개인정보가 있습니다', { count: Number(over.n) });
        }

        affected = acc.n + leads.length + consult.n + authRec.n;
        detail = { accounts: acc.n, ipMasked: ip.n, leads: leads.length, consultRequests: consult.n, authRecords: authRec.n, overdue: Number(over.n) };
        break;
      }
    }

    const ms = Date.now() - t0;
    this.log.log(`${job} affected=${affected} ${ms}ms`);
    return { job, affected, detail, ms };
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
