import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { Forbidden, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { IdentityVerifyService } from '../identity/identity-verify.service';
import { HttpESign } from '../deal/esign.provider';   // v10.143 (D139)
import { SafenumService } from '../listing/safenum.service';   // v10.145 (D141)
import { AlimtalkService } from '../../common/alimtalk/alimtalk.service';

/**
 * 백오피스 조회·처리.
 *
 * 판정은 전부 DB 가 합니다 — 분쟁 접수 시 정산 보류도, 배지 승인 시
 * 노출 반영도 트리거입니다. 여기서는 상태만 바꿉니다.
 *
 * v10.96 (리팩토링) — 검수 · 표본 감사는 admin-review.service.ts, 회원 · 사업자는 admin-member.service.ts 로 나눴습니다. 설정 · 스위치 검사(SWITCH_RULES) · 코드 라벨은 여기 그대로.
 */
@Injectable()
export class AdminService {
  constructor(private readonly db: DatabaseService) {}
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
    if (AdminService.isAiSetting(key) && RequestCtx.get()?.actorRole !== 'SUPER') {
      throw new Forbidden('AI_SETTING_SUPER', 'AI 설정은 최고 관리자(SUPER)만 바꿀 수 있습니다.');
    }
    if (AdminService.isIntegSetting(key) && RequestCtx.get()?.actorRole !== 'SUPER') {
      throw new Forbidden('INTEG_SETTING_SUPER', '본인인증 · 알림톡 설정은 최고 관리자(SUPER)만 바꿀 수 있습니다.');
    }
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
    await this.checkAiSwitch(key, value);
    await this.checkAiModel(key, value);
    await this.checkIntegProvider(key, value);
    const [row] = await this.db.query(
      `UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now()
        WHERE key = $1 RETURNING key, value`,
      [key, value, RequestCtx.actorId()]);
    if (!row) throw new StateConflict('NOT_FOUND', '없는 키입니다.');
    return row;
  }

  /** v10.129 (docs/194) — AI 스위치 · 상한 · 모델 · 한도(agent.* · AI 번역)는 최고 관리자만 — 비용 · 법무에 걸린 설정(대표 승인 2026-10-27) */
  static isAiSetting(key: string): boolean {
    return key.startsWith('agent.') || ['i18n.auto_translate.enabled', 'i18n.board_on_view', 'i18n.translate_model', 'i18n.auto_langs', 'i18n.engine',
      'i18n.board_daily_member', 'i18n.board_daily_guest', 'i18n.board_daily_guest_total'].includes(key);   // v10.135 — 볼 때 번역 하루 횟수도 AI 한도
  }

  /** v10.141 (docs/214) — 본인인증 · 알림톡 방식(identity.* · alimtalk.*)은 최고 관리자만 — 회원 확인 · 바깥 발송에 걸린 설정 */
  static isIntegSetting(key: string): boolean { return key.startsWith('identity.') || key.startsWith('alimtalk.') || key.startsWith('esign.') || key.startsWith('safenum.'); }   // v10.143 전자계약 · v10.145 안심번호

  /** v10.141 — identity.provider: MOCK 은 운영 서버(production)에서 못 고름 · NICE 는 키 3개가 있어야 함(없이 바꾸면 회원이 인증을 못 함)
   *  v10.142 — alimtalk.provider: MOCK 은 운영 서버에서 못 고름 · HTTP 는 키 2개 · ALIMTALK_URL 이 있어야 함
   *            notify.alimtalk_ready = on: 방식 · 키가 갖춰지고 승인된 템플릿이 하나는 있어야 함(없이 켜면 회원에게 「보냈습니다」인데 안 감) */
  private async checkIntegProvider(key: string, value: string) {
    const v = (value ?? '').trim();
    const prod = (process.env.NODE_ENV ?? 'development') === 'production';
    if (key === 'identity.provider') {
      if (v === 'MOCK' && prod) throw new PolicyViolation('MOCK_NOT_ALLOWED', '가짜 표준창(MOCK)은 운영 서버에서 고를 수 없습니다 — 점검판 전용입니다.');
      if (v === 'NICE') {
        const miss = IdentityVerifyService.keysMissing();
        if (miss.length) throw new PolicyViolation('IDENTITY_KEYS_MISSING', `NICE 키가 없습니다 — 외부 연동 › 연동 키에 ${miss.join(' · ')} 를 넣은 뒤 바꾸십시오.`);
      }
    }
    if (key === 'alimtalk.provider') {
      if (v === 'MOCK' && prod) throw new PolicyViolation('MOCK_NOT_ALLOWED', '시험 발송(MOCK)은 운영 서버에서 고를 수 없습니다 — 점검판 전용입니다.');
      if (v === 'HTTP') {
        const miss = AlimtalkService.httpMissing();
        if (miss.length) throw new PolicyViolation('ALIMTALK_KEYS_MISSING', `알림톡 설정이 없습니다 — ${miss.join(' · ')} 를 넣은 뒤 바꾸십시오(키는 외부 연동 › 연동 키 · 주소는 .env).`);
      }
    }
    /* v10.143 (D139) — esign.provider: MOCK 은 운영 서버에서 못 고름 · HTTP 는 키 · 웹훅 비밀값 · ESIGN_URL 이 있어야 함 ·
     *   대기 중 요청이 있으면 다른 방식으로 못 바꿈(바꾸면 그 요청의 웹훅 · 조회가 끊겨 계약이 잠긴 채 남음) */
    if (key === 'esign.provider') {
      if (v === 'MOCK' && prod) throw new PolicyViolation('MOCK_NOT_ALLOWED', '가짜 서명(MOCK)은 운영 서버에서 고를 수 없습니다 — 점검판 전용입니다.');
      if (v === 'HTTP') {
        const miss = HttpESign.missing();
        if (miss.length) throw new PolicyViolation('ESIGN_KEYS_MISSING', `전자계약 설정이 없습니다 — ${miss.join(' · ')} 를 넣은 뒤 바꾸십시오(키 · 웹훅 비밀값은 외부 연동 › 연동 키 · 주소는 .env).`);
      }
      const [p] = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM esign_documents WHERE state = 'PENDING' AND provider <> $1`, [v]);
      if (p.n) throw new PolicyViolation('ESIGN_PENDING_EXISTS', `다른 방식으로 대기 중인 전자서명 요청이 ${p.n}건 있습니다 — 끝나거나 취소된 뒤 바꾸십시오(외부 연동 › 전자계약).`);
    }
    /* v10.145 (D141) — safenum.provider: MOCK 은 운영 서버에서 못 고름 · HTTP 는 키 · 웹훅 비밀값 · SAFENUM_URL 이 있어야 함 */
    if (key === 'safenum.provider') {
      if (v === 'MOCK' && prod) throw new PolicyViolation('MOCK_NOT_ALLOWED', '가짜 번호(MOCK)는 운영 서버에서 고를 수 없습니다 — 점검판 전용입니다.');
      if (v === 'HTTP') {
        const miss = SafenumService.httpMissing();
        if (miss.length) throw new PolicyViolation('SAFENUM_KEYS_MISSING', `안심번호 설정이 없습니다 — ${miss.join(' · ')} 를 넣은 뒤 바꾸십시오(키 · 웹훅 비밀값은 외부 연동 › 연동 키 · 주소는 .env).`);
      }
    }
    if (key === 'notify.alimtalk_ready' && v.toLowerCase() === 'on') {
      const [p] = await this.db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'alimtalk.provider'`);
      const [t] = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM alimtalk_templates WHERE review_state = 'APPROVED' AND vendor_code IS NOT NULL`);
      if (!AlimtalkService.configuredFor(AlimtalkService.readMode(p?.v ?? 'NONE')) || !t.n) {
        throw new PolicyViolation('ALIMTALK_NOT_READY', '알림톡이 준비되지 않았습니다 — 방식 · 키를 갖추고 승인된 템플릿이 하나는 있어야 켤 수 있습니다(외부 연동 › 알림톡).');
      }
    }
  }

  /** v10.135 (docs/202) — AI 모델은 요금표(agent_model_prices)에 있는 것만 — 요금을 모르면 월 상한을 셀 수 없음(각 통로도 요금표에 없으면 부르지 않음) */
  static readonly AI_MODEL_KEYS = ['agent.chat_model', 'agent.review_model', 'i18n.translate_model'];
  private async checkAiModel(key: string, value: string) {
    if (!AdminService.AI_MODEL_KEYS.includes(key)) return;
    const [r] = await this.db.query(`SELECT 1 FROM agent_model_prices WHERE model = $1`, [(value ?? '').trim()]);
    if (!r) throw new PolicyViolation('MODEL_UNPRICED', `요금표에 없는 모델입니다 — 먼저 「모델 요금표」에 ${value} 의 요금을 넣어 주십시오.`);
  }

  /** v10.129 — AI 전체(agent.enabled)를 켜려면 엔진이 될 키(운영 화면 키 · .env CLAUDE 키 · 점검판 MOCK)와 월 상한 > 0 이 있어야 함.
   *    없이 켜면 화면은 「켜짐」인데 아무것도 부르지 않아 헷갈림 · 상한 0 은 「부르지 않음」이라 켜도 뜻이 없음 */
  private async checkAiSwitch(key: string, value: string) {
    if (key !== 'agent.enabled' || (value ?? '').trim() !== 'on') return;
    const env = process.env;
    const envKey = env.AGENT_PROVIDER === 'MOCK' || (env.AGENT_PROVIDER === 'CLAUDE' && (env.ANTHROPIC_API_KEY ?? '').length > 20);
    /* 운영 화면 키는 실제로 풀리는지까지 봄 — 열쇠(ENC_KEY)가 바뀌어 못 풀면 엔진이 없음(AgentService 와 같은 판단).
     *   풀다가 오류가 나도 요청의 트랜잭션(멱등 키)을 깨지 않게 트랜잭션 밖 연결로(새 컨텍스트 · tx 없음) */
    let adminKey = false;
    try {
      const [k] = await RequestCtx.run({ requestId: 'ai-key-check' }, () =>
        this.db.query<{ v: string | null }>(`SELECT public.fn_integ_secret_get('AGENT', 'ANTHROPIC_API_KEY') AS v`));
      adminKey = !!k?.v?.trim();
    } catch { adminKey = false; }
    const [r] = await this.db.query<{ cap: string | null; cost: string }>(
      `SELECT (SELECT value FROM site_settings WHERE key = 'agent.monthly_cap_usd') AS cap, fn_agent_month_cost()::text AS cost`);
    const cap = Number(r?.cap ?? 0), cost = Number(r?.cost ?? 0);
    const miss: string[] = [];
    if (!adminKey && !envKey) miss.push('AI 키(위험감지 › AI 운영 › AI 에이전트 › 「AI 키」)를');
    if (!(cap > 0)) miss.push('월 상한(0 보다 큰 달러)을');
    else if (cost >= cap) miss.push(`이번 달 비용($${cost.toFixed(2)})보다 큰 월 상한을`);   // 상한에 닿아 저절로 꺼진 뒤 — 올리지 않고 켜면 「켜짐」인데 부르지 않음
    if (miss.length) throw new PolicyViolation('SWITCH_PREREQ', `아직 AI 를 켤 수 없습니다 — 먼저 ${miss.join(' · ')} 넣어 주십시오.`);
  }

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

  openBlockers() {
    return this.db.query(`SELECT kind, item, reason FROM v_open_blockers`);
  }

  /* ── 회원 상세 (운영) ─────────────────────────────────────────── */

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
}
