import * as crypto from 'crypto';
import { AppError } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.209 (D186 · docs/334) — SES 반송 · 수신 거부 알림 받기(SES → SNS → POST /api/v1/webhooks/ses)
 *
 *   · 스위치 notify.ses_feedback = off 면 아무것도 하지 않음(200 · OFF) — 서명 검사도 하지 않음.
 *   · 받는 주제는 notify.ses_topic_arn 하나 — 다르거나 비어 있으면 403.
 *   · SNS 서명(SignatureVersion 1 = SHA1 · 2 = SHA256)을 AWS 인증서로 검사 — 인증서 주소는 https://sns.<지역>.amazonaws.com/….pem 만.
 *   · 구독 확인(SubscriptionConfirmation) — 서명이 맞으면 SubscribeURL(sns.<지역>.amazonaws.com 만)을 한 번 엶.
 *   · 알림 — 같은 SNS 알림 번호는 한 번만. 영구 반송(Permanent) · 수신 거부(Complaint)만 막고, 일시 반송(Transient)은 수만 셈.
 *   · 받는 주소는 mail_suppressions 에만(보내지 않으려면 주소가 있어야 함) · 받은 기록에는 수만.
 *   시험: scripts/test-ses-feedback.ts(스스로 만든 인증서로 서명 · 가짜 fetch).
 * ------------------------------------------------------------------- */

export interface SesFeedbackDb { query<T = any>(sql: string, params?: unknown[]): Promise<T[]> }
export type FetchText = (url: string) => Promise<string>;
export interface SnsMessage {
  Type: string; MessageId: string; TopicArn: string; Message: string; Timestamp: string;
  SignatureVersion: string; Signature: string; SigningCertURL: string;
  Subject?: string; SubscribeURL?: string; Token?: string;
}
export interface SesFeedbackResult { ok: true; action: 'OFF' | 'SUBSCRIBED' | 'DUPLICATE' | 'RECORDED'; kind?: string; suppressed?: number }

const SIGN_KEYS: Record<string, (keyof SnsMessage)[]> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
};

/** SNS 가 서명한 글 — 정해진 이름 순서로 「이름\n값\n」(Subject 는 있을 때만) */
export function snsStringToSign(m: SnsMessage): string {
  const keys = SIGN_KEYS[m.Type];
  if (!keys) throw new AppError(400, { code: 'SES_FEEDBACK_BAD_INPUT', message: '알 수 없는 SNS 알림 종류입니다.' });
  return keys.filter((k) => m[k] !== undefined && m[k] !== null).map((k) => `${k}\n${m[k]}\n`).join('');
}

/** AWS SNS 주소인지 — https · 호스트 sns.<지역>.amazonaws.com · 경로 끝(인증서면 .pem) */
export function snsUrlOk(u: string | undefined, pem: boolean): boolean {
  if (!u) return false;
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(x.hostname) && !x.port && !x.username
      && (!pem || /\.pem$/.test(x.pathname));
  } catch { return false; }
}

export function snsVerify(m: SnsMessage, pem: string): boolean {
  const algo = m.SignatureVersion === '2' ? 'RSA-SHA256' : m.SignatureVersion === '1' ? 'RSA-SHA1' : null;
  if (!algo || !m.Signature) return false;
  try { return crypto.createVerify(algo).update(snsStringToSign(m), 'utf8').verify(pem, m.Signature, 'base64'); }
  catch { return false; }
}

const bad = (code: string, message: string, status = 400) => new AppError(status, { code, message });

export class SesFeedback {
  private certs = new Map<string, string>();
  constructor(private readonly db: SesFeedbackDb, private readonly fetchText: FetchText) {}

  private async setting(key: string): Promise<string | null> {
    const [r] = await this.db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = $1`, [key]);
    return r?.v ?? null;
  }

  private async cert(url: string): Promise<string> {
    const hit = this.certs.get(url);
    if (hit) return hit;
    const pem = await this.fetchText(url);
    if (!/-----BEGIN (CERTIFICATE|PUBLIC KEY)-----/.test(pem)) throw bad('SES_FEEDBACK_BAD_SIGNATURE', '서명 검사에 실패했습니다.', 401);
    if (this.certs.size > 20) this.certs.clear();
    this.certs.set(url, pem);
    return pem;
  }

  async handle(raw: string): Promise<SesFeedbackResult> {
    if ((await this.setting('notify.ses_feedback')) !== 'on') return { ok: true, action: 'OFF' };
    let m: SnsMessage;
    try { m = JSON.parse(raw); } catch { throw bad('SES_FEEDBACK_BAD_INPUT', 'SNS 알림 형식이 아닙니다.'); }
    if (!m || typeof m !== 'object' || !SIGN_KEYS[m.Type] || !m.MessageId) throw bad('SES_FEEDBACK_BAD_INPUT', 'SNS 알림 형식이 아닙니다.');
    const topic = (await this.setting('notify.ses_topic_arn'))?.trim();
    if (!topic || m.TopicArn !== topic) throw bad('SES_FEEDBACK_TOPIC', '받기로 한 SNS 주제가 아닙니다.', 403);
    if (!snsUrlOk(m.SigningCertURL, true) || !snsVerify(m, await this.cert(m.SigningCertURL))) {
      throw bad('SES_FEEDBACK_BAD_SIGNATURE', '서명 검사에 실패했습니다.', 401);
    }
    if (m.Type === 'SubscriptionConfirmation') {
      if (!snsUrlOk(m.SubscribeURL, false)) throw bad('SES_FEEDBACK_BAD_INPUT', 'SNS 알림 형식이 아닙니다.');
      await this.fetchText(m.SubscribeURL as string);
      return { ok: true, action: 'SUBSCRIBED' };
    }
    if (m.Type === 'UnsubscribeConfirmation') return { ok: true, action: 'RECORDED', kind: 'OTHER' };

    let n: any = {};
    try { n = JSON.parse(m.Message); } catch { n = {}; }
    const type = String(n.notificationType ?? n.eventType ?? '');
    const list: { addr: string; reason: 'BOUNCE' | 'COMPLAINT'; detail: string }[] = [];
    let kind = 'OTHER', sub: string | null = null, recipients = 0;
    if (type === 'Bounce') {
      kind = 'BOUNCE'; sub = `${n.bounce?.bounceType ?? ''}/${n.bounce?.bounceSubType ?? ''}`.slice(0, 100);
      const rs = Array.isArray(n.bounce?.bouncedRecipients) ? n.bounce.bouncedRecipients : [];
      recipients = rs.length;
      if (n.bounce?.bounceType === 'Permanent') for (const r of rs) list.push({ addr: String(r?.emailAddress ?? ''), reason: 'BOUNCE', detail: sub });
    } else if (type === 'Complaint') {
      kind = 'COMPLAINT'; sub = String(n.complaint?.complaintFeedbackType ?? '').slice(0, 100) || null;
      const rs = Array.isArray(n.complaint?.complainedRecipients) ? n.complaint.complainedRecipients : [];
      recipients = rs.length;
      for (const r of rs) list.push({ addr: String(r?.emailAddress ?? ''), reason: 'COMPLAINT', detail: sub ?? 'complaint' });
    } else if (type === 'Delivery') {
      kind = 'DELIVERY'; recipients = Array.isArray(n.delivery?.recipients) ? n.delivery.recipients.length : 0;
    }
    const ok = list.filter((x) => /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(x.addr.trim()) && x.addr.length <= 254);
    const ins = await this.db.query(
      `INSERT INTO mail_feedback_events (sns_message_id, kind, sub, recipients, suppressed) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (sns_message_id) DO NOTHING RETURNING id`, [String(m.MessageId).slice(0, 200), kind, sub, recipients, ok.length]);
    if (!ins.length) return { ok: true, action: 'DUPLICATE' };
    for (const x of ok) await this.db.query(`SELECT public.fn_mail_suppress($1, $2, $3)`, [x.addr, x.reason, x.detail]);
    return { ok: true, action: 'RECORDED', kind, suppressed: ok.length };
  }
}
