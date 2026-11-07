import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { maskMail } from './mail-admin.service';
import { SesFeedback } from './ses-feedback';

/* ---------------------------------------------------------------------
 * v10.209 (D186 · docs/334) — 메일 반송 · 수신 거부 주소(보내지 않을 주소)
 *
 *   공개   POST /webhooks/ses                      SES → SNS 알림(스위치 notify.ses_feedback · 주제 · 서명 — ses-feedback.ts)
 *   ADMIN · SUPER  GET  /admin/mail/suppressions   받기 상태 · 막힌 주소(가림) · 최근 7일 받은 수
 *   SUPER          POST /admin/mail/suppressions/:id/release   풀기(사유 2 ~ 300자 · 감사 MAIL_SUPPRESS_RELEASE) — 다시 반송되면 다시 막힘
 * ------------------------------------------------------------------- */

const fetchText = async (url: string) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!r.ok) throw new PolicyViolation('SES_FEEDBACK_FETCH', 'AWS SNS 에 연결하지 못했습니다.');
  return (await r.text()).slice(0, 20000);
};

@Injectable()
export class MailSuppressionService {
  private readonly feedback: SesFeedback;
  constructor(private readonly db: DatabaseService) {
    this.feedback = new SesFeedback(db, fetchText);
  }

  webhook(raw: string) { return this.feedback.handle(raw); }

  async list(state: string | undefined) {
    const active = state !== 'released';
    const rows = await this.db.query<{ id: string; email: string; reason: string; detail: string | null; hits: number; firstAt: Date; lastAt: Date;
      releasedAt: Date | null; releaseNote: string | null }>(
      `SELECT id::text AS id, email::text AS email, reason, detail, hits, first_at AS "firstAt", last_at AS "lastAt",
              released_at AS "releasedAt", release_note AS "releaseNote"
         FROM mail_suppressions WHERE (released_at IS NULL) = $1 ORDER BY last_at DESC LIMIT 200`, [active]);
    const [c] = await this.db.query<{ active: number; bounce: number; complaint: number; released: number }>(
      `SELECT count(*) FILTER (WHERE released_at IS NULL)::int AS active,
              count(*) FILTER (WHERE released_at IS NULL AND reason = 'BOUNCE')::int AS bounce,
              count(*) FILTER (WHERE released_at IS NULL AND reason = 'COMPLAINT')::int AS complaint,
              count(*) FILTER (WHERE released_at IS NOT NULL)::int AS released
         FROM mail_suppressions`);
    const [w] = await this.db.query<{ bounce: number; complaint: number; delivery: number; lastAt: Date | null }>(
      `SELECT count(*) FILTER (WHERE kind = 'BOUNCE')::int AS bounce, count(*) FILTER (WHERE kind = 'COMPLAINT')::int AS complaint,
              count(*) FILTER (WHERE kind = 'DELIVERY')::int AS delivery,
              (SELECT max(received_at) FROM mail_feedback_events) AS "lastAt"
         FROM mail_feedback_events WHERE received_at > now() - interval '7 days'`);
    const s = await this.db.query<{ key: string; v: string | null }>(
      `SELECT key, value AS v FROM site_settings WHERE key IN ('notify.ses_feedback', 'notify.ses_topic_arn')`);
    const val = (k: string) => s.find((x) => x.key === k)?.v ?? null;
    return {
      feedback: { switchOn: val('notify.ses_feedback') === 'on', topicSet: !!val('notify.ses_topic_arn')?.trim(), lastAt: w?.lastAt ?? null },
      counts: { active: c.active, bounce: c.bounce, complaint: c.complaint, released: c.released },
      week: { bounce: w?.bounce ?? 0, complaint: w?.complaint ?? 0, delivery: w?.delivery ?? 0 },
      items: rows.map((r) => ({ ...r, email: maskMail(r.email) as string })),
    };
  }

  async release(id: string, note: string) {
    const n = (note ?? '').trim();
    if (n.length < 2 || n.length > 300) throw new PolicyViolation('MAIL_SUPPRESS_NOTE', '푸는 사유를 2 ~ 300자로 적어 주십시오.');
    const rows = await this.db.query<{ id: string; released: boolean }>(
      `SELECT id::text AS id, (released_at IS NOT NULL) AS released FROM mail_suppressions WHERE id::text = $1`, [id]);
    if (!rows.length) throw new NotFound('없는 반송 주소 기록입니다.');
    if (rows[0].released) throw new PolicyViolation('MAIL_SUPPRESS_RELEASED', '이미 푼 주소입니다.');
    await this.db.query(
      `UPDATE mail_suppressions SET released_at = now(), released_by = $2, release_note = $3 WHERE id::text = $1 AND released_at IS NULL`,
      [id, RequestCtx.actorId() ?? null, n]);
    return { ok: true, id };
  }
}
