import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { AppError, Forbidden, PolicyViolation, StateConflict } from '../../core/errors';
import { AuthService } from './auth.service';
import { AccountLocked, TooManyAttempts, clientIpKey, minutesText } from './auth-throttle';

/* ---------------------------------------------------------------------
 * v10.181 (D170 · docs/283) — 회원 스스로 하는 개인정보 관리
 *
 *   ① 내 정보 내려받기(SB-MYP-DAT-010) — 비밀번호 확인 · 하루 privacy.export_daily(3)번 · JSON 한 개.
 *      다른 회원의 이름 · 연락처 · 운영 내부 메모 · 비밀값은 넣지 않습니다. 감사 기록 MY_DATA_EXPORT 에는 건수만.
 *   ② 로그인 기록 · 모든 기기 로그아웃(SB-MYP-SEC-010) — 최근 30건 · token_version + 1(이 기기는 새 증표).
 *   ③ 권리 요청(SB-MYP-PRV-010 · 운영 SB-ADM-PRQ-010) — 열람 · 정정 · 삭제 · 처리정지 · 기한 privacy.request_due_days(10)일 ·
 *      연장 한 번 · 끝난 요청은 고칠 수 없음(DB 트리거) · 기한 2일 전 하루 요약 때 PRIVACY_REQUEST_DUE(요청마다 한 번).
 *   ★ 처리 기한 · 연장 · 로그인 기록 보관 기간은 최신 법령 확인이 필요합니다(docs/283 5절).
 * ------------------------------------------------------------------- */

export const PRIVACY_KINDS: Record<string, string> = {
  ACCESS: '열람', CORRECT: '정정', DELETE: '삭제', SUSPEND: '처리정지',
};
const STATUS_LABEL: Record<string, string> = { OPEN: '접수', EXTENDED: '연장', DONE: '처리 완료', REJECTED: '거절' };

/** 내려받기 칸 — [이름, SQL]. $1 = 내 계정. 모두 본인 것만 · 다른 회원 정보 없음 */
const EXPORT_SECTIONS: Array<[string, string]> = [
  ['termAgreements', `SELECT term_code AS "termCode", term_version AS "termVersion", agreed, agreed_at AS "agreedAt"
                        FROM term_agreements WHERE account_id = $1 ORDER BY agreed_at`],
  ['listings', `SELECT listing_no AS "listingNo", id, gwan_code AS "gwanCode", title, body, summary, status, desired_fee AS "desiredFee",
                       address, region_detail AS "regionDetail", contact_hours AS "contactHours", published_at AS "publishedAt", created_at AS "createdAt"
                  FROM listings WHERE owner_account_id = $1 ORDER BY created_at`],
  ['requests', `SELECT id, gwan_code AS "gwanCode", title, body, status, offered_fee AS "offeredFee", budget_min AS "budgetMin", budget_max AS "budgetMax",
                       region, address, contact_hours AS "contactHours", closes_at AS "closesAt", created_at AS "createdAt"
                  FROM requests WHERE owner_account_id = $1 ORDER BY created_at`],
  ['referralCodes', `SELECT code, issued_at AS "issuedAt", expires_at AS "expiresAt", revoked_at AS "revokedAt"
                       FROM referral_codes WHERE owner_account_id = $1 ORDER BY issued_at`],
  ['successFees', `SELECT deal_id AS "dealId", amount, status, created_at AS "createdAt", settled_at AS "settledAt"
                     FROM success_fees WHERE payer_account_id = $1 ORDER BY created_at`],
  ['posts', `SELECT id, board, title, body, state, created_at AS "createdAt", updated_at AS "updatedAt"
               FROM posts WHERE author_id = $1 ORDER BY created_at`],
  ['comments', `SELECT id, post_id AS "postId", body, state, created_at AS "createdAt"
                  FROM post_comments WHERE author_id = $1 ORDER BY created_at`],
  ['pollVotes', `SELECT poll_id AS "pollId", option_id AS "optionId", created_at AS "createdAt"
                   FROM poll_votes WHERE account_id = $1 ORDER BY created_at`],
  ['favorites', `SELECT target_type AS "targetType", target_id AS "targetId", created_at AS "createdAt"
                   FROM favorites WHERE account_id = $1 ORDER BY created_at`],
  ['town', `SELECT adm_name AS "admName", verified_at AS "verifiedAt", expires_at AS "expiresAt" FROM member_towns WHERE account_id = $1`],
  ['healthOrders', `SELECT order_no AS "orderNo", goods_amount AS "goodsAmount", ship_fee AS "shipFee", total, status, pay_method AS "payMethod",
                           paid_at AS "paidAt", shipped_at AS "shippedAt", delivered_at AS "deliveredAt", created_at AS "createdAt"
                      FROM hlt_orders WHERE account_id = $1 ORDER BY created_at`],
  ['healthReturns', `SELECT o.order_no AS "orderNo", r.kind, r.reason, r.detail, r.state, r.refund_amount AS "refundAmount", r.created_at AS "createdAt"
                       FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id WHERE o.account_id = $1 ORDER BY r.created_at`],
  ['addresses', `SELECT label, receiver, phone, zipcode, addr1, addr2, is_default AS "isDefault"
                   FROM hlt_addresses WHERE account_id = $1 AND deleted_at IS NULL ORDER BY created_at`],
  ['points', `SELECT rule_code AS "ruleCode", points, earned_at AS "earnedAt" FROM point_ledger WHERE account_id = $1 ORDER BY earned_at`],
  ['notifications', `SELECT event_code AS "eventCode", title, body, link_url AS "linkUrl", read_at AS "readAt", created_at AS "createdAt"
                       FROM notifications WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1000`],
  ['inquiries', `SELECT category, title, body, status, answer, answered_at AS "answeredAt", created_at AS "createdAt"
                   FROM inquiries WHERE account_id = $1 ORDER BY created_at`],
  ['privacyRequests', `SELECT kind, CASE WHEN body_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(body_enc, fn_enc_key()) END AS body,
                              status, due_on AS "dueOn", result_note AS "resultNote", handled_at AS "handledAt", created_at AS "createdAt"
                         FROM privacy_requests WHERE account_id = $1 ORDER BY created_at`],
  ['loginHistory', `SELECT at, ok, ip_masked AS "ipMasked", ua_kind AS "uaKind" FROM login_history WHERE account_id = $1 ORDER BY at DESC`],
];

@Injectable()
export class PrivacyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
  ) {}

  private me(): string {
    const id = RequestCtx.actorId();
    if (!id) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
    return id;
  }

  /** 비밀번호 확인 — 틀리면 로그인 실패와 같이 셈(5번 → 잠금) */
  private async checkPassword(accountId: string, password: string) {
    const [a] = await this.db.query<{ email: string; password_hash: string }>(
      `SELECT email, password_hash FROM accounts WHERE id = $1`, [accountId]);
    if (!a) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
    const ipKey = clientIpKey();
    const [gate] = await this.db.query<{ blocked: string | null; retry_after_sec: number }>(
      `SELECT blocked, retry_after_sec FROM fn_login_gate($1, $2)`, [a.email, ipKey]);
    if (gate && gate.blocked === 'LOCKED') throw new AccountLocked(gate.retry_after_sec);
    if (gate && gate.blocked === 'TOO_MANY') {
      throw new TooManyAttempts('TOO_MANY_ATTEMPTS', `잠시 뒤에 다시 시도해 주십시오(${minutesText(gate.retry_after_sec)}).`, gate.retry_after_sec);
    }
    if (typeof password !== 'string' || !a.password_hash || !(await bcrypt.compare(password, a.password_hash))) {
      const [f] = await this.db.query<{ locked_until: Date | null }>(
        `SELECT locked_until FROM fn_login_fail($1, $2)`, [a.email, ipKey]);
      if (f && f.locked_until) throw new AccountLocked(Math.ceil((new Date(f.locked_until).getTime() - Date.now()) / 1000));
      throw new PolicyViolation('CURRENT_PASSWORD_WRONG', '지금 비밀번호가 맞지 않습니다.');
    }
    await this.db.query(`SELECT fn_login_clear($1)`, [a.email]);
  }

  /** 감사 기록 — 내려받은 내용 · 새 증표가 들어가지 않도록 @Audit 대신 결과만 */
  private async audit(actor: string, action: string, targetType: string, targetId: string, data: Record<string, unknown>) {
    const c = RequestCtx.get();
    await this.db.query(
      `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [actor, c?.actorRole ?? 'MEMBER', action, targetType, targetId, JSON.stringify(data), c?.ip ?? null, c?.userAgent ?? null]);
  }

  /* ── ① 내 정보 내려받기 ─────────────────────────────────────────── */

  async exportStatus() {
    const me = this.me();
    const [r] = await this.db.query<{ used: number; lim: number }>(
      `SELECT (SELECT count(*)::int FROM audit.audit_logs
                WHERE actor_account_id = $1 AND action = 'MY_DATA_EXPORT'
                  AND occurred_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul') AS used,
              fn_setting_int('privacy.export_daily', 3) AS lim`, [me]);
    const used = Number(r?.used ?? 0); const limit = Number(r?.lim ?? 3);
    return { used, limit, left: Math.max(0, limit - used), sections: ['profile', ...EXPORT_SECTIONS.map(([k]) => k)] };
  }

  async exportData(password: string) {
    const me = this.me();
    await this.checkPassword(me, password);
    const st = await this.exportStatus();
    if (st.left <= 0) {
      throw new TooManyAttempts('EXPORT_DAILY_LIMIT', `내 정보 내려받기는 하루 ${st.limit}번까지입니다. 내일 다시 받아 주십시오.`);
    }
    const [profile] = await this.db.query(
      `SELECT id, email, name, phone, account_type AS "accountType", status, job_title AS "jobTitle", preferred_lang AS "preferredLang",
              identity_verified_at AS "identityVerifiedAt", last_login_at AS "lastLoginAt", created_at AS "createdAt"
         FROM accounts WHERE id = $1`, [me]);
    const data: Record<string, unknown> = { profile };
    const counts: Record<string, number> = {};
    for (const [key, sql] of EXPORT_SECTIONS) {
      const rows = await this.db.query(sql, [me]).catch(() => null);   // 그 관에 없는 표는 건너뜀
      if (rows === null) continue;
      data[key] = rows; counts[key] = rows.length;
    }
    await this.audit(me, 'MY_DATA_EXPORT', 'ACCOUNT', me, { counts });
    const at = new Date();
    const stamp = new Date(at.getTime() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
    return {
      fileName: `sogaebank_my_data_${stamp}.json`,
      exportedAt: at.toISOString(),
      note: '소개뱅크가 보관한 회원님의 정보입니다. 다른 회원의 정보 · 운영 내부 메모 · 비밀번호는 들어 있지 않습니다. 파일을 안전한 곳에 보관해 주십시오.',
      counts, data,
    };
  }

  /* ── ② 로그인 기록 · 모든 기기 로그아웃 ───────────────────────────── */

  async loginHistory() {
    const me = this.me();
    const items = await this.db.query(
      `SELECT at, ok, ip_masked AS "ipMasked", ua_kind AS "uaKind" FROM login_history WHERE account_id = $1 ORDER BY at DESC LIMIT 30`, [me]);
    const [s] = await this.db.query<{ days: number; fails7: number }>(
      `SELECT fn_setting_int('privacy.login_history_days', 180) AS days,
              (SELECT count(*)::int FROM login_history WHERE account_id = $1 AND NOT ok AND at > now() - interval '7 days') AS fails7`, [me]);
    return { items, keepDays: Number(s?.days ?? 180), recentFails: Number(s?.fails7 ?? 0) };
  }

  async logoutAll(password: string) {
    const me = this.me();
    await this.checkPassword(me, password);
    await this.db.transaction(async () => {
      await this.db.query(`UPDATE accounts SET token_version = token_version + 1 WHERE id = $1`, [me]);
      await this.audit(me, 'LOGOUT_ALL', 'ACCOUNT', me, { ok: true });
    });
    /* 판 번호가 올라 지금 쓰던 증표도 무효 — 이 기기에서는 새 증표로 이어 갑니다 */
    const t = await this.auth.issue(me);
    return { ok: true, note: '다른 기기의 로그인을 모두 풀었습니다. 이 기기는 그대로 쓰실 수 있습니다.', accessToken: t.accessToken, refreshToken: t.refreshToken };
  }

  /* ── ③ 권리 요청 ─────────────────────────────────────────────── */

  async myRequests() {
    const me = this.me();
    const items = await this.db.query(
      `SELECT id, kind, status, due_on AS "dueOn", result_note AS "resultNote", extend_reason AS "extendReason",
              handled_at AS "handledAt", created_at AS "createdAt",
              CASE WHEN body_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(body_enc, fn_enc_key()) END AS body
         FROM privacy_requests WHERE account_id = $1 ORDER BY created_at DESC LIMIT 50`, [me]);
    const [d] = await this.db.query<{ days: number }>(`SELECT fn_setting_int('privacy.request_due_days', 10) AS days`);
    return { items, dueDays: Number(d?.days ?? 10), kinds: Object.entries(PRIVACY_KINDS).map(([code, label]) => ({ code, label })) };
  }

  async createRequest(kind: string, body: string) {
    const me = this.me();
    if (!PRIVACY_KINDS[kind]) throw new PolicyViolation('PRIVACY_KIND', '요청 종류를 골라 주십시오.');
    const text = String(body ?? '').trim();
    if (text.length < 5 || text.length > 1000) throw new PolicyViolation('PRIVACY_BODY', '요청 내용을 5 ~ 1000자로 적어 주십시오.');
    const [open] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM privacy_requests WHERE account_id = $1 AND status IN ('OPEN','EXTENDED')`, [me]);
    if (Number(open?.n ?? 0) >= 5) throw new StateConflict('PRIVACY_OPEN_LIMIT', '처리 중인 요청이 5건 있습니다. 처리된 뒤에 새로 요청해 주십시오.');
    const [row] = await this.db.query<{ id: string; dueOn: string }>(
      `INSERT INTO privacy_requests (account_id, kind, body_enc, due_on)
       VALUES ($1, $2, pgp_sym_encrypt($3, fn_enc_key()),
               ((now() AT TIME ZONE 'Asia/Seoul')::date + fn_setting_int('privacy.request_due_days', 10)))
       RETURNING id, to_char(due_on, 'YYYY-MM-DD') AS "dueOn"`, [me, kind, text]);
    await this.audit(me, 'PRIVACY_REQUEST', 'PRIVACY_REQUEST', row.id, { kind });
    return { id: row.id, kind, status: 'OPEN', dueOn: row.dueOn,
      note: `${PRIVACY_KINDS[kind]} 요청을 받았습니다. ${row.dueOn}까지 처리 결과를 알림으로 알려 드립니다.` };
  }

  /** 운영 — 열린 요청 먼저(기한 가까운 순) · 끝난 것 최근 50건 */
  async adminList(status?: string) {
    const st = status === 'closed' ? `status IN ('DONE','REJECTED')` : status === 'all' ? 'true' : `status IN ('OPEN','EXTENDED')`;
    const items = await this.db.query(
      `SELECT r.id, r.kind, r.status, to_char(r.due_on, 'YYYY-MM-DD') AS "dueOn",
              (r.due_on - (now() AT TIME ZONE 'Asia/Seoul')::date) AS "daysLeft",
              r.extend_reason AS "extendReason", r.result_note AS "resultNote", r.handled_at AS "handledAt", r.created_at AS "createdAt",
              CASE WHEN r.body_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(r.body_enc, fn_enc_key()) END AS body,
              a.id AS "accountId", a.name AS "accountName", a.email AS "accountEmail", h.name AS "handledByName"
         FROM privacy_requests r JOIN accounts a ON a.id = r.account_id LEFT JOIN accounts h ON h.id = r.handled_by
        WHERE ${st}
        ORDER BY (r.status IN ('OPEN','EXTENDED')) DESC, r.due_on ASC, r.created_at DESC LIMIT 100`);
    const [c] = await this.db.query<{ open: number; overdue: number; soon: number }>(
      `SELECT count(*) FILTER (WHERE status IN ('OPEN','EXTENDED'))::int AS open,
              count(*) FILTER (WHERE status IN ('OPEN','EXTENDED') AND due_on < (now() AT TIME ZONE 'Asia/Seoul')::date)::int AS overdue,
              count(*) FILTER (WHERE status IN ('OPEN','EXTENDED') AND due_on - (now() AT TIME ZONE 'Asia/Seoul')::date BETWEEN 0 AND 2)::int AS soon
         FROM privacy_requests`);
    return { items, open: Number(c?.open ?? 0), overdue: Number(c?.overdue ?? 0), soon: Number(c?.soon ?? 0),
      kinds: PRIVACY_KINDS, statusLabels: STATUS_LABEL };
  }

  /** 운영 — 처리 완료 · 거절 · 연장(한 번) */
  async decide(id: string, action: string, note: string) {
    const actor = this.me();
    const text = String(note ?? '').trim();
    const [r] = await this.db.query<{ id: string; account_id: string; kind: string; status: string }>(
      `SELECT id, account_id, kind, status FROM privacy_requests WHERE id = $1`, [id]);
    if (!r) throw new AppError(404, { code: 'PRIVACY_REQUEST_NOT_FOUND', message: '권리 요청을 찾을 수 없습니다.' });
    if (r.status === 'DONE' || r.status === 'REJECTED') throw new StateConflict('PRIVACY_REQUEST_CLOSED', '이미 끝난 요청입니다 — 기록은 고칠 수 없습니다.');
    const label = PRIVACY_KINDS[r.kind] ?? r.kind;
    let title: string; let body: string;
    if (action === 'EXTEND') {
      if (r.status === 'EXTENDED') throw new StateConflict('PRIVACY_REQUEST_EXTENDED_ONCE', '처리 기한 연장은 한 번만 할 수 있습니다.');
      if (text.length < 5 || text.length > 500) throw new PolicyViolation('PRIVACY_NOTE', '연장 사유를 5 ~ 500자로 적어 주십시오.');
      const [u] = await this.db.query<{ dueOn: string }>(
        `UPDATE privacy_requests SET status = 'EXTENDED', extend_reason = $2,
                due_on = due_on + fn_setting_int('privacy.request_due_days', 10)
          WHERE id = $1 RETURNING to_char(due_on, 'YYYY-MM-DD') AS "dueOn"`, [id, text]);
      title = `${label} 요청 처리 기한이 늘었습니다`;
      body = `사유: ${text} · 새 기한 ${u.dueOn}`;
    } else if (action === 'DONE' || action === 'REJECT') {
      if (text.length < 5 || text.length > 1000) throw new PolicyViolation('PRIVACY_NOTE', '처리 결과를 5 ~ 1000자로 적어 주십시오.');
      await this.db.query(
        `UPDATE privacy_requests SET status = $2, result_note = $3, handled_by = $4, handled_at = now() WHERE id = $1`,
        [id, action === 'DONE' ? 'DONE' : 'REJECTED', text, actor]);
      title = action === 'DONE' ? `${label} 요청을 처리했습니다` : `${label} 요청에 답을 드립니다`;
      body = text;
    } else {
      throw new PolicyViolation('PRIVACY_ACTION', '처리 · 거절 · 연장 가운데 하나를 골라 주십시오.');
    }
    await this.db.query(
      `INSERT INTO notifications (account_id, event_code, title, body, link_url)
       VALUES ($1, 'PRIVACY_REQUEST_RESULT', $2, $3, '/my/account/privacy')`,
      [r.account_id, title, body.slice(0, 1000)]).catch(() => undefined);
    return { ok: true, id, action };
  }

  /** 하루 요약 — 기한 2일 안(넘긴 것 포함) 열린 요청 · 요청 · 기한마다 한 번(알림 한 줄의 detail.keys = 「id:기한」 목록) */
  async dueAlerts(): Promise<Array<{ id: string; kind: string; dueOn: string; daysLeft: number }>> {
    return this.db.query(
      `SELECT r.id::text AS id, r.kind, to_char(r.due_on, 'YYYY-MM-DD') AS "dueOn",
              (r.due_on - (now() AT TIME ZONE 'Asia/Seoul')::date) AS "daysLeft"
         FROM privacy_requests r
        WHERE r.status IN ('OPEN','EXTENDED') AND r.due_on - (now() AT TIME ZONE 'Asia/Seoul')::date <= 2
          AND NOT EXISTS (SELECT 1 FROM ops_alerts o WHERE o.alert_code = 'PRIVACY_REQUEST_DUE'
                           AND o.detail->'keys' @> to_jsonb(r.id::text || ':' || to_char(r.due_on, 'YYYY-MM-DD')))
        ORDER BY r.due_on`);
  }
}
