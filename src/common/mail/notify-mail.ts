import type { SmtpResult } from './smtp';

/* ---------------------------------------------------------------------
 * v10.85 — 알림 메일 실제 발송 (notify_dispatch 의 다음 단계)
 *
 *   notify_dispatch 는 메일 채널이 준비되면(notify.email_verified = on) 알림마다 EMAIL 발송 기록을 QUEUED 로 남깁니다.
 *   전에는 그 다음이 없어 대기열에만 쌓였습니다(mail-ses #8). 이 단계가 QUEUED 를 실제로 보냅니다.
 *
 *   · 보내는 조건은 MailService.ready() 그대로 — SMTP_* 설정 + 보내는 주소 + notify.email_verified = on.
 *     하나라도 없으면 아무것도 하지 않습니다(QUEUED 그대로 — 설정을 마치면 그때 보냄). 새 스위치는 두지 않습니다.
 *   · 성공 → SENT(보낸 시각 · SES 메시지 번호) · 받는 주소 거절 · 형식 오류 · 인증 실패 → FAILED(까닭)
 *     연결 · 시간 초과 → QUEUED 그대로 두고 까닭 칸에 「RETRY n」 — 3번째 실패에서 FAILED.
 *   · 보내지 않고 FAILED 로 닫는 것: 회원이 그 알림의 메일을 끔(알림 정책이 끄기를 허락할 때) · 쓰지 않는 계정 · 3일 넘은 알림.
 *   · 링크는 사이트 안 주소(/…)만 붙입니다 — 바깥 주소는 붙이지 않음. 제목의 줄바꿈은 빈칸으로(머리줄 끼워 넣기 방지).
 *   · 받는 주소는 기록에 남기지 않습니다(발송기 로그는 앞 2글자만).
 * ------------------------------------------------------------------- */

export interface NotifyMailDb { query<T = any>(sql: string, params?: unknown[]): Promise<T[]> }
export interface NotifyMailer {
  ready(): Promise<boolean>;
  send(m: { to: string; subject: string; text: string }): Promise<SmtpResult>;
}
export interface NotifyMailResult { ready: boolean; sent: number; failed: number; retry: number; closed: number }

const MAX_TRY = 3;
const TEMP = new Set(['NETWORK', 'TIMEOUT']);

interface Row {
  id: string; title: string | null; body: string; linkUrl: string | null; email: string | null;
  failedReason: string | null; optedOut: boolean; active: boolean; old: boolean; baseUrl: string | null;
}

/** 메일 한 통의 제목 · 본문 — 시험에서도 씁니다 */
export function notifyMailText(r: Pick<Row, 'title' | 'body' | 'linkUrl' | 'baseUrl'>) {
  const base = (r.baseUrl && /^https:\/\/[^\s/]+$/.test(r.baseUrl.replace(/\/+$/, '')) ? r.baseUrl.replace(/\/+$/, '') : 'https://sogaebank.com');
  const subject = ((r.title ?? '').replace(/[\r\n]+/g, ' ').trim() || '소개뱅크 알림').slice(0, 120);
  const link = r.linkUrl && /^\/(?!\/)[^\s]*$/.test(r.linkUrl) ? `${base}${r.linkUrl}` : null;
  const text = [r.body.trim(), link ? `\n바로 가기: ${link}` : '', `\n—\n소개뱅크 알림입니다. 알림 보기 · 설정: ${base}/my/notifications`]
    .filter(Boolean).join('\n');
  return { subject, text };
}

export class NotifyMailSender {
  constructor(private readonly db: NotifyMailDb, private readonly mail: NotifyMailer) {}

  async run(limit = 50): Promise<NotifyMailResult> {
    const out: NotifyMailResult = { ready: false, sent: 0, failed: 0, retry: 0, closed: 0 };
    if (!(await this.mail.ready())) return out;
    out.ready = true;
    const rows = await this.db.query<Row>(
      `SELECT d.id::text AS id, n.title, n.body, n.link_url AS "linkUrl", a.email, d.failed_reason AS "failedReason",
              (EXISTS (SELECT 1 FROM notification_preferences p
                        WHERE p.account_id = n.account_id AND p.event_code = n.event_code AND p.channel = 'EMAIL' AND NOT p.enabled)
               AND coalesce(pol.optout_allowed, true)) AS "optedOut",
              (a.status = 'ACTIVE') AS active,
              (n.created_at < now() - interval '3 days') AS old,
              (SELECT value FROM site_settings WHERE key = 'site.base_url') AS "baseUrl"
         FROM notification_deliveries d
         JOIN notifications n ON n.id = d.notification_id
         JOIN accounts a ON a.id = n.account_id
         LEFT JOIN notification_event_policies pol ON pol.event_code = n.event_code
        WHERE d.channel = 'EMAIL' AND d.status = 'QUEUED'
        ORDER BY d.id
        LIMIT $1`, [limit]);
    for (const r of rows) {
      const close = !r.email ? 'NO_EMAIL: 받는 주소 없음' : !r.active ? 'ACCOUNT_INACTIVE: 쓰지 않는 계정'
        : r.optedOut ? 'OPTED_OUT: 회원이 이 알림 메일을 끔' : r.old ? 'EXPIRED: 3일 넘은 알림은 보내지 않음' : null;
      if (close) {
        await this.db.query(
          `UPDATE notification_deliveries SET status = 'FAILED', failed_reason = $2 WHERE id = $1::bigint AND status = 'QUEUED'`, [r.id, close]);
        out.closed++; continue;
      }
      const res = await this.mail.send({ to: r.email as string, ...notifyMailText(r) });
      if (res.ok) {
        await this.db.query(
          `UPDATE notification_deliveries SET status = 'SENT', sent_at = now(), provider = 'SES', provider_msg_id = $2, failed_reason = NULL
            WHERE id = $1::bigint AND status = 'QUEUED'`, [r.id, res.messageId ?? null]);
        out.sent++; continue;
      }
      const tries = Number(/^RETRY (\d+)/.exec(r.failedReason ?? '')?.[1] ?? 0) + 1;
      const why = `${res.errorKind ?? 'ERROR'}: ${(res.error ?? '').slice(0, 120)}`;
      if (TEMP.has(res.errorKind ?? '') && tries < MAX_TRY) {
        await this.db.query(
          `UPDATE notification_deliveries SET failed_reason = $2 WHERE id = $1::bigint AND status = 'QUEUED'`, [r.id, `RETRY ${tries} ${why}`]);
        out.retry++;
      } else {
        await this.db.query(
          `UPDATE notification_deliveries SET status = 'FAILED', failed_reason = $2 WHERE id = $1::bigint AND status = 'QUEUED'`, [r.id, why]);
        out.failed++;
      }
    }
    return out;
  }
}
