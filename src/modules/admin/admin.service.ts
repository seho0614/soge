import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { maskBizNo, maskEmail, maskName, maskPhone } from '../../common/mask';

/**
 * 백오피스 조회·처리.
 *
 * 판정은 전부 DB 가 합니다 — 분쟁 접수 시 정산 보류도, 배지 승인 시
 * 노출 반영도 트리거입니다. 여기서는 상태만 바꿉니다.
 */
@Injectable()
export class AdminService {
  constructor(private readonly db: DatabaseService) {}

  /** 배지 신청 검수 (SB-ADM-BDG-010). 배지는 전건 수동입니다 */
  badges() {
    return this.db.query(
      `SELECT b.id, b.badge_type AS "badgeType",
              coalesce(cl.label, b.badge_type) AS "badgeLabel",
              b.listing_id AS "listingId", l.title AS "listingTitle",
              coalesce(bz.company_name, a.name) AS "ownerName",
              b.urgent_reason AS "urgentReason", b.valid_until AS "validUntil",
              b.evidence, b.requested_at AS "requestedAt",
              ri.id AS "reviewItemId"
         FROM listing_badges b
         JOIN listings l ON l.id = b.listing_id
         JOIN accounts a ON a.id = b.requested_by
         LEFT JOIN businesses bz ON bz.account_id = a.id AND bz.verified_at IS NOT NULL
         LEFT JOIN code_labels cl ON cl.domain='badge.type' AND cl.code=b.badge_type
         LEFT JOIN review_items ri ON ri.target_type='LISTING_BADGE' AND ri.target_id=b.id
        WHERE b.status = 'IN_REVIEW'
        ORDER BY b.requested_at`);
  }

  /** v10.31 — 배지 발급 이력(시안 SB-ADM-BDG-010 「발급 이력」) */
  badgeHistory() {
    return this.db.query(
      `SELECT b.id, coalesce(bz.company_name, a.name) AS "ownerName", coalesce(cl.label, b.badge_type) AS "badgeLabel",
              l.title AS "listingTitle", b.status, b.decided_at AS "decidedAt", b.valid_until AS "validUntil",
              b.reject_reason_code AS "rejectReasonCode"
         FROM listing_badges b
         JOIN listings l ON l.id = b.listing_id
         JOIN accounts a ON a.id = b.requested_by
         LEFT JOIN businesses bz ON bz.account_id = a.id AND bz.verified_at IS NOT NULL
         LEFT JOIN code_labels cl ON cl.domain='badge.type' AND cl.code=b.badge_type
        WHERE b.status <> 'IN_REVIEW' AND b.decided_at IS NOT NULL
        ORDER BY b.decided_at DESC LIMIT 100`);
  }

  /** v10.32 — 분쟁 숫자 4칸(시안 scAdmDspt: 처리 중 · 종결 · 이번 달 접수 · 72시간 넘김). 전부 disputes 실제 행 수 */
  async disputeSummary() {
    const [r] = await this.db.query<any>(
      `SELECT count(*) FILTER (WHERE status IN ('OPEN','IN_REVIEW'))::int AS "open",
              count(*) FILTER (WHERE status IN ('RESOLVED','REJECTED'))::int AS "closed",
              count(*) FILTER (WHERE opened_at >= date_trunc('month', now()))::int AS "openedThisMonth",
              count(*) FILTER (WHERE status IN ('OPEN','IN_REVIEW') AND opened_at < now() - interval '72 hours')::int AS "over72h"
         FROM disputes`);
    return r;
  }

  /** 분쟁 처리 (SB-ADM-DSP-010).
   *  v10.32 — state=all 이면 종결(처리 완료 · 기각)된 분쟁도 최근 days 일(기본 30) 것까지 함께 냅니다(시안 표의 「종결 · 합의」 줄). 기본은 전처럼 진행 중만 */
  disputes(state: 'open' | 'all' = 'open', days = 30) {
    const d = Math.min(Math.max(Math.trunc(Number(days) || 30), 1), 365);
    return this.db.query(
      `SELECT d.id, d.deal_id AS "dealId", d.reason_code AS "reasonCode",
              coalesce(rl.label, d.reason_code) AS "reasonLabel",
              d.description, d.status, coalesce(sl.label, d.status) AS "statusLabel",
              coalesce(bz.company_name, a.name) AS "raisedByName",
              s.amount AS "heldAmount", d.opened_at AS "openedAt",
              /* v10.31 — 시안 거래 감독 「분쟁」 줄(소개 건 · 관 · 소개코드 · 소개비 · 상태) */
              coalesce(l.title, rq.title) AS "dealTitle", g.name AS "gwanName", dl.attributed_code AS "refCode",
              dl.agreed_fee AS "agreedFee", coalesce(dsl.label, dl.status) AS "dealStatusLabel",
              extract(day from now() - d.opened_at)::int AS "ageDays",
              /* v10.32 — 시안 「신청」 칸(매수 측 · 매도 측) · 종결 시각 · 처리 결과 */
              CASE d.raised_by WHEN dl.buyer_account_id THEN 'BUYER' WHEN dl.seller_account_id THEN 'SELLER'
                               WHEN dl.introducer_account_id THEN 'INTRODUCER' ELSE NULL END AS "raisedSide",
              d.closed_at AS "closedAt", d.resolution,
              (d.status IN ('OPEN','IN_REVIEW') AND d.opened_at < now() - interval '72 hours') AS "over72h",
              /* v10.32 — 접수 때 붙인 증빙(시안 「증빙 붙이기」) — 파일 id · 이름. 내려받기는 GET /files/{id}(운영 열람) */
              coalesce((SELECT json_agg(json_build_object('fileId', f.id, 'name', f.original_name) ORDER BY m.id)
                          FROM dispute_messages m JOIN files f ON f.id::text = m.attachment_key
                         WHERE m.dispute_id = d.id AND m.attachment_key IS NOT NULL), '[]'::json) AS "evidence"
         FROM disputes d
         JOIN accounts a ON a.id = d.raised_by
         JOIN deals dl ON dl.id = d.deal_id
         LEFT JOIN listings l ON l.id = dl.listing_id
         LEFT JOIN requests rq ON rq.id = dl.request_id
         LEFT JOIN gwans g ON g.code = coalesce(l.gwan_code, rq.gwan_code)
         LEFT JOIN code_labels dsl ON dsl.domain='deal.status' AND dsl.code=dl.status
         LEFT JOIN code_labels rl ON rl.domain='dispute.reason' AND rl.code=d.reason_code
         LEFT JOIN businesses bz ON bz.account_id = a.id AND bz.verified_at IS NOT NULL
         LEFT JOIN settlements s ON s.held_by_dispute_id = d.id
         LEFT JOIN code_labels sl ON sl.domain='dispute.status' AND sl.code=d.status
        WHERE d.status IN ('OPEN','IN_REVIEW')
           OR ($1::text = 'all' AND d.status IN ('RESOLVED','REJECTED') AND d.closed_at >= now() - make_interval(days => $2::int))
        ORDER BY (d.status IN ('OPEN','IN_REVIEW')) DESC, d.opened_at`, [state, d]);
  }

  /**
   * 분쟁 해소. RESOLVED 면 보류된 정산을 풀어 줍니다.
   * 보류는 트리거가 걸었지만 해제는 사람의 판단이므로 여기서 합니다.
   */
  async resolveDispute(id: string, status: string, resolution?: string) {
    return this.db.transaction(async () => {
      const [row] = await this.db.query<{ id: string }>(
        `UPDATE disputes
            SET status = $2, resolution = $3, handled_by = $4,
                closed_at = CASE WHEN $2 IN ('RESOLVED','REJECTED') THEN now() ELSE closed_at END
          WHERE id = $1 AND status IN ('OPEN','IN_REVIEW')
        RETURNING id`,
        [id, status, resolution ?? null, RequestCtx.actorId()]);
      if (!row) throw new StateConflict('ALREADY_HANDLED', '이미 처리된 분쟁입니다.');

      if (status === 'RESOLVED' || status === 'REJECTED') {
        await this.db.query(
          // 분쟁이 풀리면 보류만 해제합니다. 플랫폼이 승인하지 않습니다(INV-11).
          `UPDATE settlements SET status = 'REQUESTED', held_by_dispute_id = NULL
            WHERE held_by_dispute_id = $1 AND status = 'HELD'`, [id]);
      }
      return { id, status };
    });
  }

  /** 표본 감사 (SB-ADM-REV-040). 자동 승인이 옳았는지 사후 확인 */
  /** 수동 검수 사유별 건수. manual_reasons 는 배열이라 풀어서 셉니다. (20260930 신설) */
  autoReviewReasons() {
    return this.db.query(
      `SELECT r AS reason, count(*)::int AS cnt
         FROM review_items, unnest(manual_reasons) AS r
        WHERE submitted_at > now() - interval '30 days'
        GROUP BY r ORDER BY cnt DESC, r`);
  }

  /** 일별 자동화율. (20260930 신설) */
  autoReviewRate() {
    return this.db.query(
      `SELECT day::text AS day, auto_rate_pct::float8 AS "autoRatePct",
              submitted::int, auto_approved::int AS "autoApproved", manual_queue::int AS "manualQueue"
         FROM v_auto_review_rate
        WHERE day > current_date - 30
        ORDER BY day DESC`);
  }

  auditSamples() {
    return this.db.query(
      `SELECT ri.id, ri.target_id AS "targetId", l.title,
              l.desired_fee AS "desiredFee", ri.decided_at AS "decidedAt",
              (ri.reject_memo IS NULL) AS pending, ri.reject_memo AS memo
         FROM review_items ri
         LEFT JOIN listings l ON l.id = ri.target_id
        WHERE ri.audit_sampled AND ri.decision_mode = 'AUTO'
        ORDER BY ri.decided_at DESC LIMIT 50`);
  }

  /** v10.31 (시안 SB-ADM-REV-040 칸 「자동 승인 · 표본 · 불일치 · 표본율」) — 최근 30일 */
  async auditSummary() {
    const [r] = await this.db.query<Record<string, string | null>>(
      `SELECT count(*) FILTER (WHERE decision_mode = 'AUTO' AND status = 'APPROVED') AS auto,
              count(*) FILTER (WHERE audit_sampled AND decision_mode = 'AUTO') AS sampled,
              count(*) FILTER (WHERE audit_sampled AND decision_mode = 'AUTO' AND reject_memo LIKE '감사: 부적정%') AS mismatch,
              count(*) FILTER (WHERE audit_sampled AND decision_mode = 'AUTO' AND reject_memo IS NULL) AS pending,
              (SELECT num_value FROM auto_review_policies WHERE key = 'sample_audit_rate') AS rate
         FROM review_items WHERE decided_at > now() - interval '30 days'`);
    return { autoApproved: Number(r.auto), sampled: Number(r.sampled), mismatch: Number(r.mismatch),
             pending: Number(r.pending), ratePct: r.rate == null ? null : Number(r.rate) };
  }

  /**
   * v10.31 (시안 「표본 다시 뽑기」) — 최근 30일 자동 승인 건 중 표본율에 모자라는 만큼 무작위로 더 뽑습니다.
   * 이미 뽑힌 표본은 그대로(결과가 지워지지 않음) — 모자란 만큼만 더합니다.
   */
  async resample() {
    const rows = await this.db.query<{ id: string }>(
      `WITH cfg AS (SELECT coalesce((SELECT num_value FROM auto_review_policies WHERE key = 'sample_audit_rate'), 5) AS rate),
            pool AS (SELECT id, audit_sampled FROM review_items
                      WHERE decision_mode = 'AUTO' AND status = 'APPROVED' AND decided_at > now() - interval '30 days'),
            need AS (SELECT greatest(ceil(count(*) * (SELECT rate FROM cfg) / 100.0) - count(*) FILTER (WHERE audit_sampled), 0)::int AS n FROM pool)
       UPDATE review_items SET audit_sampled = true
        WHERE id IN (SELECT id FROM pool WHERE NOT audit_sampled ORDER BY random() LIMIT (SELECT n FROM need))
       RETURNING id`);
    return { added: rows.length, note: rows.length ? `표본 ${rows.length}건을 더 뽑았습니다.` : '표본율을 이미 채웠습니다 — 더 뽑을 것이 없습니다.' };
  }

  /** 감사 결과 기록. 틀렸으면 노출을 중단합니다 */
  async recordAudit(reviewItemId: string, correct: boolean, memo?: string) {
    return this.db.transaction(async () => {
      const [ri] = await this.db.query<{ target_id: string }>(
        `UPDATE review_items SET reject_memo = $2 WHERE id = $1 RETURNING target_id`,
        [reviewItemId, correct ? '감사: 적정' : `감사: 부적정 — ${memo ?? ''}`]);
      if (!ri) throw new StateConflict('NOT_FOUND', '감사 대상을 찾을 수 없습니다.');
      if (!correct) {
        await this.db.query(
          `UPDATE listings SET status = 'SUSPENDED' WHERE id = $1 AND status = 'PUBLISHED'`,
          [ri.target_id]);
      }
      return { reviewItemId, correct };
    });
  }

  /** 코드 라벨 (SB-ADM-COD-010) */
  codeLabels(domain?: string) {
    return this.db.query(
      `SELECT domain, code, label, short_label AS "shortLabel",
              ui_tone AS "uiTone", audience, is_active AS "isActive"
         FROM code_labels
        WHERE ($1::text IS NULL OR domain = $1)
        ORDER BY domain, sort_order`, [domain ?? null]);
  }

  async updateCodeLabel(domain: string, code: string, label: string, shortLabel?: string) {
    const [row] = await this.db.query(
      `UPDATE code_labels SET label = $3, short_label = coalesce($4, short_label),
              updated_at = now()
        WHERE domain = $1 AND code = $2
      RETURNING domain, code, label, short_label AS "shortLabel"`,
      [domain, code, label, shortLabel ?? null]);
    if (!row) throw new StateConflict('NOT_FOUND', '코드를 찾을 수 없습니다.');
    return row;
  }

  /** 관리자 대시보드 (SB-ADM-DSH-010) */
  async summary() {
    const [n] = await this.db.query<Record<string, string | null>>(
      `SELECT
        (SELECT count(*) FROM review_items WHERE status IN ('QUEUED','IN_PROGRESS')) AS review_pending,
        (SELECT count(*) FROM review_items
          WHERE status IN ('QUEUED','IN_PROGRESS') AND sla_due_at < now()) AS sla_breached,
        (SELECT round(avg(auto_rate_pct),1) FROM v_auto_review_rate
          WHERE day > current_date - 7) AS auto_rate,
        (SELECT count(*) FROM settlements WHERE status='REQUESTED') AS settlement_pending,
        (SELECT count(*) FROM disputes WHERE status IN ('OPEN','IN_REVIEW')) AS disputes_open,
        (SELECT count(*) FROM ops_alerts
          WHERE severity='CRITICAL' AND acknowledged_at IS NULL) AS critical,
        (SELECT count(*) FROM v_open_blockers) AS blockers,
        (SELECT k FROM v_k_value WHERE cohort_month = date_trunc('month', now())::date) AS k,
        /* v10.31 (10/10 시안 기준) — 시안 칸 「정산 승인 대기 · 합계」 「신규 가입 승인 · 오늘」 · 검수 처리 한계(설정) · 오늘 처리 */
        (SELECT coalesce(sum(amount),0) FROM settlements WHERE status='REQUESTED') AS settlement_sum,
        (SELECT count(*) FROM businesses WHERE verified_at IS NULL AND rejected_at IS NULL AND kind = 'BUSINESS') AS biz_pending,
        (SELECT count(*) FROM businesses WHERE verified_at IS NULL AND rejected_at IS NULL AND kind = 'BUSINESS'
           AND (created_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date) AS biz_today,
        (SELECT value FROM site_settings WHERE key = 'review.daily_capacity') AS review_cap,
        (SELECT count(*) FROM review_items WHERE status IN ('APPROVED','REJECTED') AND decision_mode = 'MANUAL'
           AND (decided_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date) AS decided_today,
        (SELECT count(*) FROM review_items WHERE status IN ('QUEUED','IN_PROGRESS')
           AND sla_due_at >= now() AND sla_due_at < now() + interval '4 hours') AS sla_soon`);
    const num = (v: string | null) => (v == null ? null : Number(v));
    return {
      reviewPending: Number(n.review_pending), slaBreached: Number(n.sla_breached),
      autoRatePct: num(n.auto_rate), settlementPending: Number(n.settlement_pending),
      disputesOpen: Number(n.disputes_open), criticalAlerts: Number(n.critical),
      openBlockers: Number(n.blockers), kValue: num(n.k),
      settlementPendingSum: Number(n.settlement_sum), bizPending: Number(n.biz_pending), bizToday: Number(n.biz_today),
      reviewCapacity: Number(n.review_cap) || 50, decidedToday: Number(n.decided_today), slaSoon: Number(n.sla_soon),
    };
  }

  /**
   * 사업자 신청 · 회원 관리 (SB-ADM-USR-010). 미승인 건이 위로 옵니다.
   * v10.31 (10/10 시안 기준) — 시안 줄(상호 · 번호 · 사업자 128-86-***12 · 대표 김** · 요금제 · 서류)과 탭(승인 대기 · 정상 · 정지).
   *   사업자등록번호 · 대표 이름은 가려서 보냅니다(시안 표기 · 개인정보). 찾기는 서버가 원래 값으로 합니다(q).
   *   반려(rejectedAt) · 회원 상태(accountStatus) · 요금제(planCode)를 더했습니다.
   */
  async businesses(q?: string) {
    const rows = await this.db.query<any>(
      `SELECT b.id, b.account_id AS "accountId", b.biz_reg_no AS "bizRegNo", b.company_name AS "companyName",
              b.ceo_name AS "ceoName", b.nts_status AS "ntsStatus",
              b.verified_at AS "verifiedAt", a.name AS "accountName", a.status AS "accountStatus",
              b.rejected_at AS "rejectedAt", b.reject_reason AS "rejectReason",
              b.created_at AS "createdAt",
              (SELECT s.plan_code FROM subscriptions s WHERE s.account_id = b.account_id AND s.status = 'ACTIVE'
                ORDER BY s.current_period_end DESC NULLS LAST LIMIT 1) AS "planCode"
         FROM businesses b JOIN accounts a ON a.id = b.account_id
        WHERE b.kind = 'BUSINESS'   /* v10.38 (D096) — 개인 활동 정보는 사업자 신청이 아닙니다 */
          AND ($1::text IS NULL OR b.company_name ILIKE '%'||$1||'%' OR b.ceo_name ILIKE '%'||$1||'%'
               OR b.biz_reg_no LIKE '%'||regexp_replace($1,'\\D','','g')||'%' AND length(regexp_replace($1,'\\D','','g')) >= 3
               OR a.name ILIKE '%'||$1||'%')
        ORDER BY (b.verified_at IS NOT NULL OR b.rejected_at IS NOT NULL), b.created_at DESC LIMIT 200`, [q?.trim() || null]);
    return rows.map((r) => ({
      ...r,
      bizRegNo: maskBizNo(r.bizRegNo, 'mid'),
      ceoName: maskName(r.ceoName),
      accountName: maskName(r.accountName),
      no: `M-${String(r.id).slice(0, 4).toUpperCase()}`,
    }));
  }

  /**
   * v10.31 — 사업자 신청 반려(시안 「반려」). 사유를 남기고 검수 대기 건도 반려로 닫습니다.
   * 반려된 신청자는 사업자 전환 화면에서 고쳐 다시 신청할 수 있습니다(새 신청이 생기면 반려 표시는 그 줄에만 남음).
   */
  async rejectBusiness(id: string, reason: string) {
    if (!reason?.trim() || reason.trim().length < 2) throw new PolicyViolation('REASON_REQUIRED', '반려 사유를 적어 주십시오.');
    return this.db.transaction(async () => {
      const [b] = await this.db.query<{ account_id: string }>(
        `UPDATE businesses SET rejected_at = now(), rejected_by = $2, reject_reason = $3
          WHERE id = $1 AND kind = 'BUSINESS' AND verified_at IS NULL AND rejected_at IS NULL RETURNING account_id`,
        [id, RequestCtx.actorId(), reason.trim()]);
      if (!b) throw new StateConflict('ALREADY_DECIDED', '이미 승인했거나 반려한 신청입니다.');
      await this.db.query(
        `UPDATE review_items SET status = 'REJECTED', decision_by = $2, decided_at = now(),
                reject_reason_code = 'OTHER', reject_memo = $3
          WHERE target_type = 'BUSINESS' AND target_id = $1 AND status IN ('QUEUED','IN_PROGRESS')`,
        [id, RequestCtx.actorId(), reason.trim()]);
      await this.db.query(
        `INSERT INTO notifications (account_id, event_code, title, body, link_url)
         VALUES ($1, 'BUSINESS_REJECTED', '사업자 신청이 반려되었습니다', $2, '/my/business')`,
        [b.account_id, `사유: ${reason.trim()} — 고쳐서 다시 신청하실 수 있습니다.`]);
      return { id, status: 'REJECTED' };
    });
  }

  /**
   * v10.31 — 회원 상태 변경(시안 회원 상세 「상태 변경」 · 회원 관리 「정지」 탭). 정상 ↔ 정지만. 사유 필수 · 기록(account_status_changes).
   * 자기 자신과 최고 관리자(SUPER)는 바꿀 수 없습니다. 정지하면 로그인이 막히고 소개코드가 멈춥니다(trg_revoke_on_status).
   */
  async setAccountStatus(id: string, status: string, reason: string) {
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) throw new PolicyViolation('BAD_STATUS', '정상 또는 정지로만 바꿀 수 있습니다.');
    if (!reason?.trim() || reason.trim().length < 2) throw new PolicyViolation('REASON_REQUIRED', '상태를 바꾸는 사유를 적어 주십시오.');
    if (id === RequestCtx.actorId()) throw new PolicyViolation('SELF_CHANGE', '자기 계정의 상태는 바꿀 수 없습니다.');
    return this.db.transaction(async () => {
      const [a] = await this.db.query<{ status: string; sup: boolean }>(
        `SELECT status, EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = a.id AND r.role = 'SUPER') AS sup
           FROM accounts a WHERE id = $1 FOR UPDATE`, [id]);
      if (!a) throw new StateConflict('NOT_FOUND', '없는 회원입니다.');
      if (a.sup) throw new PolicyViolation('PROTECTED_ACCOUNT', '최고 관리자 계정은 이 화면에서 바꿀 수 없습니다.');
      if (a.status === 'WITHDRAWN') throw new StateConflict('WITHDRAWN', '탈퇴한 회원입니다.');
      if (a.status === status) throw new StateConflict('SAME_STATUS', status === 'ACTIVE' ? '이미 정상입니다.' : '이미 정지된 회원입니다.');
      await this.db.query(`UPDATE accounts SET status = $2 WHERE id = $1`, [id, status]);
      await this.db.query(
        `INSERT INTO account_status_changes (account_id, from_status, to_status, reason, changed_by) VALUES ($1,$2,$3,$4,$5)`,
        [id, a.status, status, reason.trim(), RequestCtx.actorId()]);
      return { id, from: a.status, status };
    });
  }

  /** v10.31 — 등록 일시 정지(제한업종 · 금칙 표현 반려 3회) 풀기 */
  async liftPostingSuspension(accountId: string) {
    const rows = await this.db.query(
      `UPDATE posting_suspensions SET lifted_at = now(), lifted_by = $2
        WHERE account_id = $1 AND lifted_at IS NULL AND until_at > now() RETURNING id`,
      [accountId, RequestCtx.actorId()]);
    if (!rows.length) throw new StateConflict('NOT_SUSPENDED', '풀 등록 정지가 없습니다.');
    return { accountId, lifted: rows.length };
  }

  /**
   * 사업자 승인. verified_at 이 소개비 수령 자격의 기준일입니다 (INV-10).
   * 승격이지 재가입이 아니므로 계정은 그대로 두고 타입만 바꿉니다.
   */
  async verifyBusiness(id: string) {
    return this.db.transaction(async () => {
      const [biz] = await this.db.query<{ account_id: string }>(
        `UPDATE businesses SET verified_at = now(), verified_by = $2
          WHERE id = $1 AND kind = 'BUSINESS' AND verified_at IS NULL RETURNING account_id`,
        [id, RequestCtx.actorId()]);
      if (!biz) throw new StateConflict('ALREADY_VERIFIED', '이미 승인된 사업자입니다.');

      await this.db.query(
        `UPDATE accounts SET account_type='BUSINESS' WHERE id = $1`, [biz.account_id]);
      await this.db.query(
        `INSERT INTO account_roles (account_id, role, granted_by) VALUES ($1,'BIZ_OWNER',$2)
         ON CONFLICT DO NOTHING`, [biz.account_id, RequestCtx.actorId()]);
      /* v10.26 (G-186) — 이 사업자의 검수 대기 건도 같은 거래에서 승인으로 닫습니다.
       * 전에는 「사업자 인증」에서 승인해도 검수 큐의 그 건이 대기로 남아 쌓였습니다(10/8 실측 1,191건) —
       * 검수 큐는 오래된 50건만 보여 주므로 진짜 대기 건(매물 · 요청)이 뒤로 밀렸습니다. */
      await this.db.query(
        `UPDATE review_items SET status = 'APPROVED', decision_by = $2, decided_at = now()
          WHERE target_type = 'BUSINESS' AND target_id = $1 AND status IN ('QUEUED','IN_PROGRESS')`,
        [id, RequestCtx.actorId()]);
      return { id, accountId: biz.account_id };
    });
  }

  /** 거래 모니터링 (SB-ADM-DEL-010). 조회 전용 — 임의 확정 불가 (INV-4)
   *  v10.31 — 시안 표(소개 건 · 관 · 소개코드 · 소개자 · 거래금액)에 맞춰 칸을 더했습니다. 거래금액은 계약서에 적힌 값(없으면 null) */
  deals() {
    return this.db.query(
      `SELECT d.id, coalesce(l.title, rq.title) AS title, d.status, coalesce(sl.label, d.status) AS "statusLabel",
              d.agreed_fee AS "agreedFee",
              coalesce(bz.company_name, a.name) AS "introducerName",
              g.name AS "gwanName", d.attributed_code AS "refCode",
              nullif(regexp_replace(coalesce(dc.terms->>'amount',''), '[^0-9]', '', 'g'), '')::numeric AS "dealAmount",
              d.confirm_mode AS "confirmMode", d.match_source AS "matchSource",
              EXISTS (SELECT 1 FROM disputes x WHERE x.deal_id = d.id AND x.status IN ('OPEN','IN_REVIEW')) AS "hasDispute",
              d.created_at AS "createdAt", d.confirmed_at AS "confirmedAt"
         FROM deals d
         LEFT JOIN listings l ON l.id = d.listing_id
         LEFT JOIN requests rq ON rq.id = d.request_id
         LEFT JOIN gwans g ON g.code = coalesce(l.gwan_code, rq.gwan_code)
         LEFT JOIN deal_contracts dc ON dc.deal_id = d.id
         LEFT JOIN accounts a ON a.id = d.introducer_account_id
         LEFT JOIN businesses bz ON bz.account_id = a.id AND bz.verified_at IS NOT NULL
         LEFT JOIN code_labels sl ON sl.domain='deal.status' AND sl.code=d.status
        ORDER BY d.created_at DESC LIMIT 100`);
  }

  /**
   * 정산 목록 (SB-ADM-STL-010).
   * v10.31 — 시안 표(정산번호 · 소개자 · 소개코드 · 거래금액 · 소개비 · 부가세 · 입금 계좌 · 승인)에 맞춰 칸을 더했습니다.
   * 입금 계좌는 개인 수령자의 확인된 받을 계좌를 **가려서**(은행 + 끝 4자리) 보여 줍니다 — 지불 측이 보낼 곳을 맞게 아는지
   * 운영이 확인하는 자리일 뿐, 회사가 돈을 받는 계좌가 아닙니다(INV-11).
   */
  settlements() {
    return this.db.query(
      `SELECT s.id, s.deal_id AS "dealId", s.amount, s.status,
              'S-' || to_char(s.requested_at AT TIME ZONE 'Asia/Seoul', 'YYYY') || '-' || lpad(s.seq::text, 4, '0') AS no,
              coalesce(sl.label, s.status) AS "statusLabel",
              coalesce(b.company_name, a.name) AS "payeeName",
              d.attributed_code AS "refCode",
              nullif(regexp_replace(coalesce(dc.terms->>'amount',''), '[^0-9]', '', 'g'), '')::numeric AS "dealAmount",
              CASE WHEN s.payee_business_id IS NOT NULL THEN round(s.amount * 0.1) END AS vat,
              CASE WHEN s.payee_business_id IS NULL AND p.id IS NOT NULL
                   THEN p.bank_name || ' ****' || coalesce(p.account_last4, '') || ' (' || p.holder_name || ')' END AS "payoutAccount",
              CASE WHEN s.status <> 'REQUESTED' THEN NULL
                   WHEN s.held_by_dispute_id IS NOT NULL OR EXISTS (SELECT 1 FROM disputes x WHERE x.deal_id = s.deal_id AND x.status IN ('OPEN','IN_REVIEW'))
                     THEN '분쟁이 접수된 거래 — 정산 보류'
                   WHEN s.payee_business_id IS NULL AND p.id IS NULL THEN '받을 계좌 확인이 끝나지 않았습니다'
                   WHEN s.payee_business_id IS NULL AND NOT p.verified THEN '받을 계좌 1원 확인이 끝나지 않았습니다'
                   WHEN s.payee_business_id IS NULL AND regexp_replace(p.holder_name,'\\s','','g') <> regexp_replace(a.name,'\\s','','g')
                     THEN '예금주명이 회원 이름과 다릅니다 — 수동 검증 대기'
              END AS "blockReason",
              s.requested_at AS "requestedAt", s.paid_at AS "paidAt",
              s.approved_at AS "approvedAt", ap.name AS "approvedByName",
              s.paid_marked_by AS "paidMarkedBy", s.paid_marked_at AS "paidMarkedAt",
              /* v10.31 (합침 · w3 D060) — 사업자 수령 건의 세금계산서 발행 표시(소개자가 직접 발행) */
              s.tax_invoice_issued_at AS "taxInvoiceIssuedAt", s.tax_invoice_no AS "taxInvoiceNo"
         FROM settlements s
         JOIN accounts a ON a.id = s.payee_account_id
         JOIN deals d ON d.id = s.deal_id
         LEFT JOIN deal_contracts dc ON dc.deal_id = s.deal_id
         LEFT JOIN businesses b ON b.id = s.payee_business_id
         LEFT JOIN accounts ap ON ap.id = s.approved_by
         LEFT JOIN LATERAL (SELECT * FROM payout_accounts q WHERE q.account_id = s.payee_account_id
                             ORDER BY q.is_default DESC, q.verified DESC, q.created_at DESC LIMIT 1) p ON true
         LEFT JOIN code_labels sl ON sl.domain='settlement.status' AND sl.code=s.status
        ORDER BY (s.status <> 'REQUESTED'), (s.status <> 'APPROVED'), s.requested_at LIMIT 200`);
  }

  /**
   * 정산 승인 · 반려.
   *
   * v10.31 (10/10 시안 기준 지시) — 승인 단계를 다시 둡니다. 전에는 「플랫폼은 승인하지 않는다(INV-11)」로 반려만 있었습니다.
   * 승인은 **정산서 확인**(금액 = 약정 소개비 · 분쟁 없음 · 받을 계좌 확인)이며 돈은 여전히 당사자끼리 직접 오갑니다.
   * 승인자 = 운영(ADMIN · SUPER) · 거래 당사자 아님(2인 원칙)은 DB 트리거가 막고, 승인 기록은 settlement_approvals 에 남습니다.
   */
  async decideSettlement(id: string, status: string, rejectReason?: string) {
    if (status === 'APPROVED') {
      const [row] = await this.db.query(
        `UPDATE settlements SET status = 'APPROVED', approved_by = $2
          WHERE id = $1 AND status = 'REQUESTED'
        RETURNING id, status, approved_at AS "approvedAt"`,
        [id, RequestCtx.actorId()]);
      if (!row) throw new StateConflict('ALREADY_DECIDED', '승인 대기 상태가 아닌 정산입니다.');
      return { ...row, note: '승인은 정산서 확인입니다. 지급은 당사자가 직접 하고 지급 표시도 당사자가 남깁니다(INV-11).' };
    }
    if (!rejectReason?.trim()) throw new PolicyViolation('REASON_REQUIRED', '반려 사유를 적어 주십시오.');
    const [row] = await this.db.query(
      `UPDATE settlements SET status = 'REJECTED', reject_reason = $2
        WHERE id = $1 AND status IN ('REQUESTED','APPROVED')
      RETURNING id, status`,
      [id, rejectReason]);
    if (!row) throw new StateConflict('ALREADY_DECIDED', '이미 처리된 정산입니다.');
    return row;
  }

  /**
   * v10.31 (10/10 결함 — 법정 고지 화면에 내부 API 키 · 수금 계좌번호가 그대로 보임) —
   * 비밀 값은 서버에서 가려서 보냅니다. 화면에는 「가린 값 + 들어 있는지」만, 바꿀 때만 새 값을 입력합니다(PATCH 는 그대로).
   * 가리는 키: 내부 API 키 · 수금 계좌번호 · 이름이 secret · token · password · api_key 로 끝나는 키.
   */
  static isSecretKey(key: string) {
    return key === 'company.bank_account' || /(^|[._])(secret|token|password|api_key)$/.test(key);
  }
  static mask(key: string, v: string | null) {
    if (v == null || v === '') return v;
    if (key === 'company.bank_account') {
      /* 계좌번호 — 끝 4자리만(예: ******-**-**9999). 구분자는 그대로 둡니다 */
      const digits = v.replace(/\D/g, '').length;
      let seen = 0;
      return v.replace(/\d/g, (d) => (++seen > digits - 4 ? d : '*'));
    }
    return v.length <= 6 ? '******' : `${v.slice(0, 3)}${'*'.repeat(Math.min(v.length - 6, 12))}${v.slice(-3)}`;
  }

  async siteSettings() {
    const rows = await this.db.query<{ key: string; value: string | null }>(
      `SELECT s.key, s.value, s.description,
              s.is_required_for_open AS "isRequiredForOpen",
              s.value_example AS "valueExample",
              -- 자리표시자·형식 오류를 화면에서 바로 보여 줍니다
              EXISTS (SELECT 1 FROM v_open_blockers b
                       WHERE b.kind='SETTING' AND b.item = s.key) AS "hasIssue",
              (SELECT b.reason FROM v_open_blockers b
                WHERE b.kind='SETTING' AND b.item = s.key) AS issue
         FROM site_settings s
        ORDER BY s.is_required_for_open DESC, s.key`);
    return rows.map((r) => AdminService.isSecretKey(r.key)
      ? { ...r, value: AdminService.mask(r.key, r.value), secret: true, hasValue: !!r.value?.trim() }
      : { ...r, secret: false, hasValue: !!r.value?.trim() });
  }

  async updateSetting(key: string, value: string) {
    /* D011 (10/2) — 운영 스위치 · 한도(필수 고지 항목이 아닌 것)는 형식이 틀리면 저장하지 않습니다.
     *   예: request.view.limit 에 'ON' 을 넣으면 조용히 off 로 읽혀 한도가 안 걸립니다 — 그런 값을 막습니다.
     *   필수 고지 항목(is_required_for_open)은 전처럼 저장하고 오픈 차단 목록이 형식 오류를 알려 줍니다. */
    const [meta] = await this.db.query<{ ok: boolean; example: string | null }>(
      `SELECT (is_required_for_open OR value_pattern IS NULL OR $2 ~ value_pattern) AS ok, value_example AS example
         FROM site_settings WHERE key = $1`, [key, value ?? '']);
    if (meta && !meta.ok) {
      throw new PolicyViolation('SETTING_FORMAT',
        `값의 형식이 맞지 않습니다${meta.example ? ` (예: ${meta.example})` : ''}.`);
    }
    await this.checkSwitch(key, value);
    const [row] = await this.db.query(
      `UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now()
        WHERE key = $1 RETURNING key, value`,
      [key, value, RequestCtx.actorId()]);
    if (!row) throw new StateConflict('NOT_FOUND', '없는 키입니다.');
    return row;
  }

  /* v10.65 (docs/121 · docs/111 6-3) — 간주 · 소개비 스위치를 「실제로 돌리는 쪽」으로 바꿀 때만 조건을 봅니다.
   *   반대쪽(간주 다시 켜기 · 소개비 끄기)은 언제나 됩니다 — 문제가 생기면 바로 되돌릴 수 있게.
   *   운영 화면 「오픈 체크리스트 › 관리자 스위치」가 같은 조건을 미리 보여 줍니다(web/src/app/admin/Switches.tsx). */
  static readonly SWITCH_RULES: Record<string, { to: string; integ?: string[]; status?: string[]; bank?: boolean; why: string }> = {
    'assume.payment': { to: 'off', integ: ['PG'], status: ['TESTING', 'LIVE'], why: '전자결제(PG)가 시험 중이거나 연결됨' },
    'assume.broker': { to: 'off', integ: ['BROKER'], status: ['TESTING', 'LIVE'], why: '국토부 중개사 대조가 시험 중이거나 연결됨' },
    'assume.etax': { to: 'off', integ: ['ETAX'], status: ['TESTING', 'LIVE'], why: '전자세금계산서가 시험 중이거나 연결됨' },
    'assume.bank': { to: 'off', bank: true, why: '사이트 기본 정보에 실제 수금 계좌 세 항목이 들어 있음' },
    'feature.referral_fee': { to: 'on', integ: ['PASS', 'BANK'], status: ['LIVE'], why: '본인인증 · 1원 계좌인증이 모두 연결됨(LIVE)' },
  };

  private async checkSwitch(key: string, value: string) {
    const rule = AdminService.SWITCH_RULES[key];
    if (!rule || (value ?? '').trim() !== rule.to) return;
    if (rule.integ) {
      const rows = await this.db.query<{ code: string; status: string }>(
        `SELECT code, status FROM integrations WHERE code = ANY($1::text[])`, [rule.integ]);
      const bad = rule.integ.filter((c) => !rows.some((r) => r.code === c && rule.status!.includes(r.status)));
      if (bad.length) {
        const now = rule.integ.map((c) => `${c} ${rows.find((r) => r.code === c)?.status ?? '없음'}`).join(' · ');
        throw new PolicyViolation('SWITCH_PREREQ', `아직 바꿀 수 없습니다 — 조건: ${rule.why}. 지금: ${now}. 외부 연동 탭에서 상태를 먼저 바꿔 주십시오.`);
      }
    }
    if (rule.bank) {
      const [r] = await this.db.query<{ ready: boolean }>(
        `SELECT count(*) >= 3 AND bool_and(coalesce(btrim(value), '') <> '' AND value NOT LIKE '%시험용%' AND value NOT LIKE '999999-%') AS ready
           FROM site_settings WHERE key LIKE 'company.bank%'`);
      if (!r?.ready) throw new PolicyViolation('SWITCH_PREREQ', `아직 바꿀 수 없습니다 — 조건: ${rule.why}. 사이트 기본 정보 탭에서 수금 계좌를 먼저 넣어 주십시오(넣으면 저절로 꺼집니다).`);
    }
  }

  reviewReasons() {
    return this.db.query(
      `SELECT code, label, category FROM review_reason_codes
        WHERE is_active ORDER BY sort_order`);
  }

  openBlockers() {
    return this.db.query(`SELECT kind, item, reason FROM v_open_blockers`);
  }

  /* ── 회원 상세 (운영) ─────────────────────────────────────────── */

  /** v10.31 (10/10 결함 · 시안 kim****@) — 목록에는 가린 이메일 · 연락처만 보냅니다. 찾기는 원래 값으로 */
  async accounts(q?: string, limit?: number, status?: string) {
    const n = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const rows = await this.db.query<any>(
      `SELECT a.id, a.email, a.name, a.phone,
              a.account_type AS "accountType", a.status,
              (a.identity_verified_at IS NOT NULL) AS "identityVerified",
              b.company_name AS "companyName",
              (b.verified_at IS NOT NULL) AS "bizVerified",
              a.created_at AS "createdAt", a.last_login_at AS "lastLoginAt"
         FROM accounts a
         LEFT JOIN businesses b ON b.account_id = a.id AND b.kind = 'BUSINESS'
        WHERE a.withdrawn_at IS NULL
          AND ($3::text IS NULL OR a.status = $3)
          AND ($1::text IS NULL OR a.name ILIKE '%'||$1||'%'
                OR a.email::text ILIKE '%'||$1||'%'
                OR coalesce(a.phone,'') ILIKE '%'||$1||'%')
        ORDER BY a.created_at DESC
        LIMIT $2`, [q ?? null, n, status ?? null]);
    return rows.map((r) => ({ ...r, email: maskEmail(r.email), phone: maskPhone(r.phone) }));
  }

  /** v10.31 — 회원 관리 탭 숫자(정상 · 정지) */
  async accountCounts() {
    const [r] = await this.db.query<Record<string, string>>(
      `SELECT count(*) FILTER (WHERE status = 'ACTIVE') AS active,
              count(*) FILTER (WHERE status = 'SUSPENDED') AS suspended
         FROM accounts WHERE withdrawn_at IS NULL`);
    return { active: Number(r.active), suspended: Number(r.suspended) };
  }

  async account(id: string) {
    const [acc] = await this.db.query<any>(
      `SELECT a.id, a.email, a.name, a.phone,
              a.account_type AS "accountType", a.status,
              a.identity_verified_at AS "identityVerifiedAt",
              a.created_at AS "createdAt", a.last_login_at AS "lastLoginAt",
              a.withdrawn_at AS "withdrawnAt"
         FROM accounts a WHERE a.id = $1`, [id]);
    if (!acc) return { ok: false, note: '없는 회원입니다.' };
    /* v10.31 (10/10 결함 · 시안 kim****@ · 010-****-2280) — 상세도 가린 값만 */
    acc.email = maskEmail(acc.email); acc.phone = maskPhone(acc.phone);

    const [biz] = await this.db.query<any>(
      `SELECT b.id, b.biz_reg_no AS "bizRegNo", b.company_name AS "companyName",
              b.ceo_name AS "ceoName", b.nts_status AS "ntsStatus",
              b.verified_at AS "verifiedAt", b.reject_reason AS "rejectReason", b.rejected_at AS "rejectedAt"
         FROM businesses b WHERE b.account_id = $1 AND b.kind = 'BUSINESS'`, [id]);
    if (biz) biz.bizRegNo = maskBizNo(biz.bizRegNo);

    /* v10.31 — 상태 변경 기록 · 등록 일시 정지(시안 「상태 변경」) */
    const statusLog = await this.db.query(
      `SELECT c.from_status AS "from", c.to_status AS "to", c.reason, c.changed_at AS "at", x.name AS "by"
         FROM account_status_changes c LEFT JOIN accounts x ON x.id = c.changed_by
        WHERE c.account_id = $1 ORDER BY c.changed_at DESC LIMIT 10`, [id]);
    const [postingSuspension] = await this.db.query(
      `SELECT until_at AS "until", reason FROM posting_suspensions
        WHERE account_id = $1 AND lifted_at IS NULL AND until_at > now() ORDER BY until_at DESC LIMIT 1`, [id]);

    const roles = await this.db.query(
      `SELECT role FROM account_roles WHERE account_id = $1 ORDER BY role`, [id]);

    const listings = await this.db.query(
      `SELECT l.id, l.title, l.status, coalesce(cl.label, l.status) AS "statusLabel", l.created_at AS "createdAt"
         FROM listings l LEFT JOIN code_labels cl ON cl.domain = 'listing.status' AND cl.code = l.status
        WHERE l.owner_account_id = $1
        ORDER BY l.created_at DESC LIMIT 10`, [id]);
    const [listingCount] = await this.db.query<{ n: string }>(`SELECT count(*) AS n FROM listings WHERE owner_account_id = $1`, [id]);

    const deals = await this.db.query(
      `SELECT d.id, d.status, coalesce(cl.label, d.status) AS "statusLabel", d.created_at AS "createdAt",
              CASE WHEN d.buyer_account_id = $1 THEN '매수'
                   WHEN d.seller_account_id = $1 THEN '매도'
                   ELSE '소개' END AS side
         FROM deals d LEFT JOIN code_labels cl ON cl.domain = 'deal.status' AND cl.code = d.status
        WHERE d.buyer_account_id = $1 OR d.seller_account_id = $1
           OR d.introducer_account_id = $1
        ORDER BY d.created_at DESC LIMIT 10`, [id]);
    const [dealCount] = await this.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM deals WHERE buyer_account_id = $1 OR seller_account_id = $1 OR introducer_account_id = $1`, [id]);

    /* ★ 이 회원이 **신고한 것과 신고당한 것**을 함께 봅니다.
     *   한쪽만 보면 "상습 신고자" 인지 "상습 피신고자" 인지 모릅니다. */
    const [rep] = await this.db.query(
      `SELECT
         (SELECT count(*) FROM reports WHERE reporter_id = $1) AS "reported",
         (SELECT count(*) FROM reports WHERE target_type='ACCOUNT' AND target_id = $1)
           AS "reportedAgainst"`, [id]);

    return {
      ok: true,
      account: acc,
      business: biz ?? null,
      roles: roles.map((r: { role: string }) => r.role),
      listings, deals,
      listingCount: Number(listingCount?.n ?? 0), dealCount: Number(dealCount?.n ?? 0),
      statusLog, postingSuspension: postingSuspension ?? null,
      reports: rep,
      note: acc.withdrawnAt
        ? '탈퇴한 회원입니다. 보관 기간이 지나면 개인정보가 지워집니다.'
        : null,
    };
  }
}
