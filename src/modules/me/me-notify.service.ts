import { inquiryNo } from '../public/public.service';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { clampLimit } from '../../core/pagination';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { I18nService } from '../i18n/i18n.service';

/**
 * 마이페이지 — 알림 · 알림 설정 · 1:1 문의 · 분쟁 (v10.96 · me.service.ts 에서 함수 본문을 그대로 옮김).
 */
@Injectable()
export class MeNotifyService {
  constructor(private readonly db: DatabaseService, private readonly i18n: I18nService) {}
  private get me() { return RequestCtx.actorId()!; }
  notifications(unreadOnly = false, limit?: number) {
    return this.db.query(
      /* v10.31 — 알림 카드 색(tone · warn · ok · info)을 알림 종류 정책에서 */
      `SELECT n.id, n.event_code AS "eventCode", n.title, n.body, n.link_url AS "linkUrl",
              n.read_at AS "readAt", n.created_at AS "createdAt", coalesce(p.tone, 'info') AS tone
         FROM notifications n
         LEFT JOIN notification_event_policies p ON p.event_code = n.event_code
        WHERE n.account_id = $1 AND ($2 = false OR n.read_at IS NULL)
        ORDER BY n.created_at DESC LIMIT $3`,
      [this.me, unreadOnly, clampLimit(limit ?? 50)]);
  }

  async markRead() {
    const rows = await this.db.query(
      `UPDATE notifications SET read_at = now()
        WHERE account_id = $1 AND read_at IS NULL RETURNING id`, [this.me]);
    return { updated: rows.length };
  }

  /** v10.31 (시안 myntf 「수신 설정」) — 알림 종류별 인앱 · 이메일 · 수신거부 가능 여부.
   *  돈 · 계약이 걸린 알림은 수신거부할 수 없습니다(정책 optout_allowed=false · DB 트리거 fn_assert_optout_allowed 가 막음).
   *  이메일은 도메인 인증(SPF · DKIM) 전이라 아직 보내지 않습니다 — emailReady=false. */
  async notificationPrefs() {
    const rows = await this.db.query(
      `SELECT p.event_code AS "eventCode", p.name, p.optout_allowed AS "optoutAllowed", p.legal_basis AS reason,
              coalesce(ia.enabled, true) AS inapp, coalesce(em.enabled, true) AS email
         FROM notification_event_policies p
         LEFT JOIN notification_preferences ia ON ia.account_id = $1 AND ia.event_code = p.event_code AND ia.channel = 'INAPP'
         LEFT JOIN notification_preferences em ON em.account_id = $1 AND em.event_code = p.event_code AND em.channel = 'EMAIL'
        ORDER BY p.optout_allowed, p.name`, [this.me]);
    await this.i18n.overlay(rows, 'NOTIFY_EVENT', (r: any) => r.eventCode, { name: 'name', reason: 'legal_basis' });   // v10.123 · D126
    const [mail] = await this.db.query<{ ready: boolean }>(
      `SELECT coalesce((SELECT ready FROM v_notify_channels WHERE channel = 'EMAIL'), false) AS ready`);
    return { emailReady: !!mail?.ready, items: rows };
  }

  async setNotificationPref(eventCode: string, channel: string, enabled: boolean) {
    if (!['INAPP', 'EMAIL'].includes(channel)) throw new PolicyViolation('BAD_CHANNEL', '알 수 없는 받는 방법입니다.');
    const [p] = await this.db.query<{ name: string; optout: boolean }>(
      `SELECT name, optout_allowed AS optout FROM notification_event_policies WHERE event_code = $1`, [eventCode]);
    if (!p) throw new PolicyViolation('BAD_EVENT', '알 수 없는 알림 종류입니다.');
    if (!enabled && !p.optout) {
      throw new StateConflict('OPTOUT_FORBIDDEN', `「${p.name}」 알림은 수신거부할 수 없습니다 — 못 받으면 손해를 보실 수 있는 안내입니다.`);
    }
    await this.db.query(
      `INSERT INTO notification_preferences (account_id, event_code, channel, enabled, updated_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (account_id, event_code, channel) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
      [this.me, eventCode, channel, enabled]);
    return { eventCode, channel, enabled, note: enabled ? '받도록 했습니다.' : '받지 않도록 했습니다.' };
  }

  inquiries() {
    return this.db.query(
      /* v10.31 — 시안 「내 문의 내역」 표(문의번호 · 제목 · 응대 · 상태 · 접수일 · 최근 답변) */
      `SELECT i.id, i.category, cl.label AS "categoryLabel", i.title, i.status,
              coalesce(sl.label, i.status) AS "statusLabel", i.answer,
              i.created_at AS "createdAt", i.answered_at AS "answeredAt", i.channel
         FROM inquiries i
         LEFT JOIN code_labels sl ON sl.domain='inquiry.status' AND sl.code=i.status
         LEFT JOIN code_labels cl ON cl.domain='inquiry.category' AND cl.code=i.category
        WHERE i.account_id = $1 ORDER BY i.created_at DESC LIMIT 50`, [this.me])
      .then((rows) => (rows as Array<{ id: string; createdAt: Date }>).map((r) => ({ ...r, no: inquiryNo(r.id, r.createdAt) })));
  }

  /** 내 분쟁 — 내가 접수한 것만(raised_by = 나). v10.32 — 분쟁 접수 · 처리 현황 표(시안 dspu: 접수 번호 · 거래 · 유형 · 상태 · 접수)에
   *  거래 이름(매물 · 요청 제목)과 유형 글자(code_labels dispute.reason)를 함께 내립니다. 다른 사람의 분쟁은 나가지 않습니다. */
  disputes() {
    return this.db.query(
      `SELECT d.id, d.deal_id AS "dealId", d.reason_code AS "reasonCode",
              coalesce(rl.label, d.reason_code) AS "reasonLabel",
              coalesce(l.title, rq.title) AS "dealTitle",
              d.description, d.status, coalesce(sl.label, d.status) AS "statusLabel",
              d.resolution, d.opened_at AS "openedAt", d.closed_at AS "closedAt",
              (SELECT count(*)::int FROM dispute_messages m WHERE m.dispute_id = d.id AND m.attachment_key IS NOT NULL) AS "evidenceCount"
         FROM disputes d
         JOIN deals dl ON dl.id = d.deal_id
         LEFT JOIN listings l ON l.id = dl.listing_id
         LEFT JOIN requests rq ON rq.id = dl.request_id
         LEFT JOIN code_labels sl ON sl.domain='dispute.status' AND sl.code=d.status
         LEFT JOIN code_labels rl ON rl.domain='dispute.reason' AND rl.code=d.reason_code
        WHERE d.raised_by = $1 ORDER BY d.opened_at DESC LIMIT 50`, [this.me]);
  }
}
