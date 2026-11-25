import { AppError } from '../../core/errors';
import { parseMail, type ParsedMail } from './mime-parse';
import type { S3Get } from './s3-get';
import { snsUrlOk, snsVerify, type FetchText, type SesFeedbackDb, type SnsMessage } from './ses-feedback';

/* ---------------------------------------------------------------------
 * v10.789 (D330 · docs/904) 공용 메일함 받기 — SES 받기 → SNS → POST /api/v1/webhooks/ses/inbound
 *
 *   · 스위치 mail.inbound = off 면 아무것도 하지 않음(200 · OFF) — 서명 검사도 하지 않음.
 *   · 받는 주제는 mail.inbound_topic_arn 하나 — 다르거나 비어 있으면 403. SNS 서명(v10.209 snsVerify) · 인증서 주소 검사 그대로.
 *   · 구독 확인 — 서명이 맞으면 SubscribeURL(sns.<지역>.amazonaws.com 만)을 한 번 엶.
 *   · 받기 규칙은 **S3 작업 하나**(SNS 작업은 150KB 넘는 메일을 반송 — AWS 문서 · docs/902 W0 블록 5) — S3 작업 알림이 오면
 *     원본 위치(버킷 · 열쇠)로 S3 에서 원본을 가져와(s3-get.ts · 서명 v4 · 40MB 안 · RAW_MAX 넘으면 위치만) 풀어서 본문 · 첨부.
 *     가져오지 못하면(자격 증명 없음 등) 위치만 남기고 운영 화면 「S3 에서 가져오기」(refetch)로 다시.
 *     SNS 작업 알림(Base64 원본)이 와도 받음(작은 메일 · 시험용) — 같은 SES 메시지 번호 + 메일함은 한 줄 · 뒤에 온 쪽이 빈칸을 채움.
 *   · 받는 주소(receipt.recipients) 중 mail_boxes 에 있는 것마다 한 줄 · 없는 주소만 오면 OTHER 로 세기만.
 *   · 같은 SNS 알림 번호는 한 번만(mail_inbound_events).
 *   v10.791 privacy@ 로 처음 들어온 메일(스팸 · 바이러스 아님)은 운영 알림 MAIL_PRIVACY_NEW(WARN).
 *   시험: qa test_v1789(스스로 만든 인증서로 서명 · 가짜 fetch · 가짜 DB).
 * ------------------------------------------------------------------- */

export interface MailInboundResult { ok: true; action: 'OFF' | 'SUBSCRIBED' | 'DUPLICATE' | 'RECORDED' | 'IGNORED'; boxes?: number; withContent?: boolean }

const bad = (code: string, message: string, status = 400) => new AppError(status, { code, message });
const VERDICTS = ['PASS', 'FAIL', 'GRAY', 'PROCESSING_FAILED', 'DISABLED'];
const verdict = (v: any): string | null => (VERDICTS.includes(String(v?.status ?? '')) ? String(v.status) : null);
const cut = (s: string | null | undefined, n: number) => (s == null ? null : String(s).slice(0, n));
const SIGN_TYPES = ['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation'];
/** S3 에서 가져올 원본 크기 상한 — 넘으면 위치만(첨부를 DB 에 두므로) */
export const RAW_MAX = 15 * 1024 * 1024;

export class MailInbound {
  private certs = new Map<string, string>();
  constructor(private readonly db: SesFeedbackDb, private readonly fetchText: FetchText, private readonly s3get?: S3Get) {}

  private async setting(key: string): Promise<string | null> {
    const [r] = await this.db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = $1`, [key]);
    return r?.v ?? null;
  }

  private async cert(url: string): Promise<string> {
    const hit = this.certs.get(url);
    if (hit) return hit;
    const pem = await this.fetchText(url);
    if (!/-----BEGIN (CERTIFICATE|PUBLIC KEY)-----/.test(pem)) throw bad('MAIL_INBOUND_BAD_SIGNATURE', '서명 검사에 실패했습니다.', 401);
    if (this.certs.size > 20) this.certs.clear();
    this.certs.set(url, pem);
    return pem;
  }

  async handle(raw: string): Promise<MailInboundResult> {
    if ((await this.setting('mail.inbound')) !== 'on') return { ok: true, action: 'OFF' };
    let m: SnsMessage;
    try { m = JSON.parse(raw); } catch { throw bad('MAIL_INBOUND_BAD_INPUT', 'SNS 알림 형식이 아닙니다.'); }
    if (!m || typeof m !== 'object' || !SIGN_TYPES.includes(m.Type) || !m.MessageId) throw bad('MAIL_INBOUND_BAD_INPUT', 'SNS 알림 형식이 아닙니다.');
    const topic = (await this.setting('mail.inbound_topic_arn'))?.trim();
    if (!topic || m.TopicArn !== topic) throw bad('MAIL_INBOUND_TOPIC', '받기로 한 SNS 주제가 아닙니다.', 403);
    if (!snsUrlOk(m.SigningCertURL, true) || !snsVerify(m, await this.cert(m.SigningCertURL))) {
      throw bad('MAIL_INBOUND_BAD_SIGNATURE', '서명 검사에 실패했습니다.', 401);
    }
    if (m.Type === 'SubscriptionConfirmation') {
      if (!snsUrlOk(m.SubscribeURL, false)) throw bad('MAIL_INBOUND_BAD_INPUT', 'SNS 알림 형식이 아닙니다.');
      await this.fetchText(m.SubscribeURL as string);
      return { ok: true, action: 'SUBSCRIBED' };
    }
    if (m.Type === 'UnsubscribeConfirmation') return { ok: true, action: 'IGNORED' };

    let n: any = {};
    try { n = JSON.parse(m.Message); } catch { n = {}; }
    const act = n?.receipt?.action ?? {};
    const kind = act.type === 'S3' ? 'S3' : act.type === 'SNS' ? 'SNS' : 'OTHER';
    const sesId = cut(n?.mail?.messageId, 200);
    const ev = await this.db.query(
      `INSERT INTO mail_inbound_events (sns_message_id, kind, ses_message_id) VALUES ($1, $2, $3) ON CONFLICT (sns_message_id) DO NOTHING RETURNING sns_message_id`,
      [String(m.MessageId).slice(0, 200), kind, sesId]);
    if (!ev.length) return { ok: true, action: 'DUPLICATE' };
    if (n?.notificationType !== 'Received' || !sesId || kind === 'OTHER') return { ok: true, action: 'IGNORED' };

    const rcpts: string[] = (Array.isArray(n?.receipt?.recipients) ? n.receipt.recipients : []).map((x: unknown) => String(x).toLowerCase().trim()).slice(0, 50);
    const boxes = rcpts.length
      ? await this.db.query<{ id: number; address: string }>(`SELECT id, address FROM mail_boxes WHERE is_active AND address = ANY($1::text[])`, [rcpts])
      : [];
    if (!boxes.length) return { ok: true, action: 'IGNORED' };

    const rec = n.receipt ?? {};
    const v = { spam: verdict(rec.spamVerdict), virus: verdict(rec.virusVerdict), spf: verdict(rec.spfVerdict), dkim: verdict(rec.dkimVerdict), dmarc: verdict(rec.dmarcVerdict) };
    const ch = n?.mail?.commonHeaders ?? {};
    let parsed: ParsedMail | null = null;
    let size: number | null = null;
    let bytes: Buffer | null = null;
    if (kind === 'SNS' && typeof n.content === 'string' && n.content) {
      bytes = String(act.encoding ?? '').toUpperCase() === 'BASE64' ? Buffer.from(n.content, 'base64') : Buffer.from(n.content, 'utf8');
    } else if (kind === 'S3' && this.s3get && act.bucketName && act.objectKey) {
      bytes = await this.s3get(String(act.bucketName), String(act.objectKey), RAW_MAX).catch(() => null);
    }
    if (bytes) {
      size = bytes.length;
      try { parsed = parseMail(bytes); } catch { parsed = null; }
    }
    const from = parsed?.from ?? null;
    const subject = cut(parsed?.subject ?? (typeof ch.subject === 'string' ? ch.subject : null), 1000);
    const sentAt = parsed?.date ? parsed.date.toISOString() : (typeof ch.date === 'string' && !isNaN(Date.parse(ch.date)) ? new Date(ch.date).toISOString() : null);
    const thread = cut(parsed?.references?.[0] ?? parsed?.inReplyTo ?? parsed?.messageId ?? sesId, 500);
    const fromAddr = cut(from?.address ?? (Array.isArray(ch.from) ? String(ch.from[0] ?? '') : null), 320);
    const s3b = kind === 'S3' && /^[a-z0-9.-]{3,63}$/.test(String(act.bucketName ?? '')) ? String(act.bucketName) : null;
    const s3k = kind === 'S3' ? cut(act.objectKey, 1024) : null;

    for (const b of boxes) {
      const [row] = await this.db.query<{ id: string; fresh: boolean }>(
        `INSERT INTO mail_messages (box_id, direction, ses_message_id, header_msgid, in_reply_to, thread_key, from_addr, from_name, to_addrs, cc_addrs,
                                    subject, sent_at, text_body, html_body, size_bytes, has_content, s3_bucket, s3_key, spam, virus, spf, dkim, dmarc, state)
         VALUES ($1, 'IN', $2, $3, $4, $5, $6, $7, $8::text[], $9::text[], $10, $11::timestamptz, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
                 CASE WHEN $18 = 'FAIL' OR $19 = 'FAIL' THEN 'SPAM' ELSE 'NEW' END)
         ON CONFLICT (ses_message_id, box_id) WHERE ses_message_id IS NOT NULL DO UPDATE SET
           s3_bucket = coalesce(mail_messages.s3_bucket, EXCLUDED.s3_bucket), s3_key = coalesce(mail_messages.s3_key, EXCLUDED.s3_key),
           header_msgid = coalesce(mail_messages.header_msgid, EXCLUDED.header_msgid), in_reply_to = coalesce(mail_messages.in_reply_to, EXCLUDED.in_reply_to),
           thread_key = CASE WHEN mail_messages.has_content THEN mail_messages.thread_key ELSE coalesce(EXCLUDED.thread_key, mail_messages.thread_key) END,
           from_name = coalesce(mail_messages.from_name, EXCLUDED.from_name), text_body = coalesce(mail_messages.text_body, EXCLUDED.text_body),
           html_body = coalesce(mail_messages.html_body, EXCLUDED.html_body), size_bytes = coalesce(mail_messages.size_bytes, EXCLUDED.size_bytes),
           to_addrs = CASE WHEN cardinality(mail_messages.to_addrs) = 0 THEN EXCLUDED.to_addrs ELSE mail_messages.to_addrs END,
           cc_addrs = CASE WHEN cardinality(mail_messages.cc_addrs) = 0 THEN EXCLUDED.cc_addrs ELSE mail_messages.cc_addrs END,
           sent_at = coalesce(mail_messages.sent_at, EXCLUDED.sent_at), from_addr = coalesce(mail_messages.from_addr, EXCLUDED.from_addr),
           subject = coalesce(mail_messages.subject, EXCLUDED.subject),
           has_content = mail_messages.has_content OR EXCLUDED.has_content
         RETURNING id::text AS id, (xmax = 0) AS fresh`,
        [b.id, sesId, cut(parsed?.messageId, 500), cut(parsed?.inReplyTo, 500), thread, fromAddr, cut(from?.name, 200),
         (parsed?.to ?? []).map((x) => x.address).slice(0, 100), (parsed?.cc ?? []).map((x) => x.address).slice(0, 100),
         subject, sentAt, parsed?.text ?? null, parsed?.html ?? null, size, !!parsed, s3b, s3k, v.spam, v.virus, v.spf, v.dkim, v.dmarc]);
      if (row?.fresh && b.address === 'privacy@sogaebank.com' && v.spam !== 'FAIL' && v.virus !== 'FAIL') {
        /* v10.791 (docs/906) 개인정보 문의 메일 — 운영 알림(같은 종류 같은 시각 고유 · clock_timestamp · 겹치면 건너뜀) */
        await this.db.query(
          `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
           VALUES ('MAIL_PRIVACY_NEW', 'WARN', '개인정보 문의 메일 — ' || left(coalesce($2, '(제목 없음)'), 60), jsonb_build_object('messageId', $1::bigint, 'box', 'privacy'), clock_timestamp())
           ON CONFLICT (alert_code, raised_at) DO NOTHING`, [row.id, subject]);
      }
      if (parsed && row) await this.saveAttachments(row.id, parsed);
    }
    await this.db.query(`UPDATE mail_inbound_events SET boxes = $2 WHERE sns_message_id = $1`, [String(m.MessageId).slice(0, 200), boxes.length]);
    return { ok: true, action: 'RECORDED', boxes: boxes.length, withContent: !!parsed };
  }

  private async saveAttachments(id: string, parsed: ParsedMail) {
    const have = await this.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM mail_attachments WHERE message_id = $1::bigint`, [id]);
    if (Number(have[0]?.n ?? 0) > 0) return;
    for (const a of parsed.attachments.slice(0, 50)) {
      await this.db.query(
        `INSERT INTO mail_attachments (message_id, filename, content_type, size_bytes, content_id, is_inline, data) VALUES ($1::bigint, $2, $3, $4, $5, $6, $7)`,
        [id, a.filename, a.contentType, a.size, a.contentId, a.inline, a.data]);
    }
  }

  /** v10.790 운영 화면 「S3 에서 가져오기」 — 위치만 있는 메일을 다시 가져와 풂(같은 SES 번호의 다른 메일함 줄도 함께) */
  async refetch(id: string): Promise<{ ok: boolean; rows: number; note: string }> {
    const [m] = await this.db.query<{ ses: string | null; bucket: string | null; key: string | null; has: boolean }>(
      `SELECT ses_message_id AS ses, s3_bucket AS bucket, s3_key AS key, has_content AS has FROM mail_messages WHERE id = $1::bigint`, [id]);
    if (!m) return { ok: false, rows: 0, note: '메일이 없습니다.' };
    if (m.has) return { ok: true, rows: 0, note: '이미 본문이 있습니다.' };
    if (!m.bucket || !m.key || !this.s3get) return { ok: false, rows: 0, note: 'S3 위치나 S3 읽기 설정이 없습니다 — docs/902 W0 블록 6.' };
    const bytes = await this.s3get(m.bucket, m.key, RAW_MAX).catch(() => null);
    if (!bytes) return { ok: false, rows: 0, note: 'S3 에서 원본을 가져오지 못했습니다 — 읽기 권한 · 크기(15MB)를 확인하십시오.' };
    let p: ParsedMail;
    try { p = parseMail(bytes); } catch { return { ok: false, rows: 0, note: '원본을 풀지 못했습니다.' }; }
    const rows = await this.db.query<{ id: string }>(
      `UPDATE mail_messages SET from_name = coalesce(from_name, $3), text_body = $4, html_body = $5, header_msgid = coalesce(header_msgid, $6), in_reply_to = coalesce(in_reply_to, $7),
              to_addrs = CASE WHEN cardinality(to_addrs) = 0 THEN $8::text[] ELSE to_addrs END, cc_addrs = CASE WHEN cardinality(cc_addrs) = 0 THEN $9::text[] ELSE cc_addrs END,
              size_bytes = $10, has_content = true
        WHERE (id = $1::bigint OR ($2::text IS NOT NULL AND ses_message_id = $2)) AND NOT has_content RETURNING id::text AS id`,
      [id, m.ses, cut(p.from?.name, 200), p.text, p.html, cut(p.messageId, 500), cut(p.inReplyTo, 500),
       p.to.map((x) => x.address).slice(0, 100), p.cc.map((x) => x.address).slice(0, 100), bytes.length]);
    for (const r of rows) await this.saveAttachments(r.id, p);
    return { ok: true, rows: rows.length, note: '본문을 가져왔습니다.' };
  }
}
