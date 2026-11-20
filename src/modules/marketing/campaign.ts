import { createHash, createHmac, randomBytes } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { MailService } from '../../common/mail/mail.service';
import { maskMail } from '../../common/mail/mail-admin.service';
import { maskIp } from '../identity/login-history';
import { envInt, FetchLike, getPath, httpJson } from '../../common/http-json';

/* ---------------------------------------------------------------------
 * v10.483 (D268 · docs/621) 문자 · 메일 캠페인 — 대표 11/20 「㊳ ①」
 *
 *   정보통신망법 제50조(광고성 정보 전송 제한) — 서버가 지키는 것(운영자가 글로 지우거나 끌 수 없음)
 *     · 받는 사람 = 마케팅 수신 동의(MARKETING)가 지금 유효한 회원만 · 2년 넘은 동의(재확인 전)는 뺌 · 반송 · 수신 거부 주소(D186)는 건너뜀
 *     · 21:00 ~ 08:00(한국)에는 야간 광고 동의(MARKETING_NIGHT)가 있는 회원에게만 — 나머지는 08:00 뒤로 미룸(DB 트리거도 막음)
 *     · 메일 제목 앞 「(광고)」 · 끝에 보낸 곳 이름 · 연락처 · 무료 수신 거부 링크(누르면 동의 철회 — 약관 동의 기록에 「거부」 한 줄)
 *     · 문자 앞 「(광고)이름」 · 끝에 「무료거부 080…」 — 080 번호 · 발신번호가 없으면 보내기를 막음
 *   보내는 길 = 기존 어댑터만 — 메일 MailService(SES SMTP · 메일 준비됨일 때) · 문자 = 알림톡 대행사의 문자 주소(CAMPAIGN_SMS_URL · 키 ALIMTALK_KEY)
 *   campaign.enabled 처음 off(보내기 · 정기 작업 안 함) · campaign.send_mode 처음 ASSUME(보내지 않고 ASSUMED 로만 기록 — 점검판)
 *   받는 곳(메일 · 휴대폰)은 기록에 가린 값만 · 수신 거부 열쇠는 HMAC(JWT_SECRET 에서 나눈 키)로 만들고 지문(sha256)만 저장
 *   ★ 법무 확인 필요(docs/621 6절) — 표기 문구 · 2년 재확인 통지 · 수신 거부 처리 결과 통지 · 080 번호 운영 방식
 * ------------------------------------------------------------------- */

export const CAMPAIGN_CHANNELS = ['EMAIL', 'SMS'] as const;
export const CAMPAIGN_AUDIENCES = ['ALL', 'RECENT_90', 'CHURN_RISK', 'MALL_BUYERS', 'MALL_REBUY'] as const;   // v10.529 (D280) CHURN_RISK 이탈 위험 신호 회원 · v10.541 (D283) 소개몰 구매 회원 · 재구매 시기 회원(동의자만)
export const PHONE_RE = /^01[016789][0-9]{7,8}$/;
export const OPTOUT_RE = /^(|080[0-9]{7,8})$/;      // DB value_pattern campaign.optout_phone 과 같음
export const SMS_FROM_RE = /^(|0[0-9]{8,10})$/;     // DB value_pattern campaign.sms_from 과 같음
export const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;
const SMS_MAX = 600;                                 // DB CHECK ck_mkt_campaign_sms_len 과 같음
const TEST_DAY_MAX = 20;
const MAX_TRY = 3;
const TEMP = new Set(['NETWORK', 'TIMEOUT', 'UPSTREAM']);

export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];
export interface CampaignSettings {
  enabled: boolean; mode: 'ASSUME' | 'LIVE'; senderName: string; smsName: string; contact: string; optoutPhone: string; smsFrom: string; batch: number; baseUrl: string;
}

/** 21:00 ~ 08:00(한국)인가 — DB 트리거 fn_mkt_send_guard 와 같은 기준 */
export function isNightKst(d = new Date()): boolean {
  const h = new Date(d.getTime() + 9 * 3600e3).getUTCHours();
  return h >= 21 || h < 8;
}

/** 문자 바이트(한글 등 2바이트로 셈 · 90 넘으면 장문) */
export const smsBytes = (t: string) => [...t].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x7f ? 2 : 1), 0);

export async function campaignSettings(db: DatabaseService): Promise<CampaignSettings> {
  const rows = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key IN ('campaign.enabled', 'campaign.send_mode', 'campaign.sender_name', 'campaign.sms_name', 'campaign.contact',
                                                      'campaign.optout_phone', 'campaign.sms_from', 'campaign.batch', 'site.base_url')`);
  const v = (k: string) => (rows.find((r) => r.key === k)?.value ?? '').trim();
  const b = Number(v('campaign.batch') || 200);
  const base = v('site.base_url').replace(/\/+$/, '');
  return {
    enabled: v('campaign.enabled') === 'on', mode: v('campaign.send_mode') === 'LIVE' ? 'LIVE' : 'ASSUME',
    senderName: v('campaign.sender_name') || '(주)한국바이오헬스케어 소개뱅크 사업부', smsName: v('campaign.sms_name') || '소개뱅크',
    contact: v('campaign.contact'), optoutPhone: v('campaign.optout_phone'), smsFrom: v('campaign.sms_from'),
    batch: Number.isInteger(b) && b >= 1 && b <= 1000 ? b : 200,
    baseUrl: /^https:\/\/[^\s/]+$/.test(base) ? base : 'https://sogaebank.com',
  };
}

/* ── 수신 거부 열쇠 — 받는 사람 줄마다 하나 · 지문만 저장 ───────────────────── */
const unsubKey = () => `mkt-unsub|${process.env.JWT_SECRET ?? ''}`;
/** 보낼 줄의 열쇠(캠페인 · 회원으로 정해짐 — 다시 만들 수 있어 원문을 저장하지 않음) */
export const unsubToken = (campaignId: string, accountId: string) => createHmac('sha256', unsubKey()).update(`unsub|${campaignId}|${accountId}`).digest('base64url');
export const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');

/** 광고 표기 붙인 제목 · 글 — 운영자가 쓴 글 앞뒤에 서버가 붙임 */
export function renderCampaign(c: { channel: string; subject: string | null; body: string }, s: CampaignSettings, token: string | null) {
  const body = c.body.replace(/\r/g, '').trim();
  if (c.channel === 'SMS') {
    const text = `(광고)${s.smsName}\n${body}\n무료거부 ${s.optoutPhone || '(080 번호 없음)'}`;
    return { subject: null as string | null, text, bytes: smsBytes(text) };
  }
  const subj = (c.subject ?? '').replace(/[\r\n]+/g, ' ').trim();
  const subject = (subj.startsWith('(광고)') ? subj : `(광고) ${subj}`).slice(0, 120);
  const link = token ? `${s.baseUrl}/api/v1/site/unsubscribe?t=${token}` : '(시험 — 수신 거부 링크 자리)';
  const text = [body, '', '—', `보낸 곳: ${s.senderName}`, `연락처: ${s.contact || '(연락처 없음)'}`,
    `수신 거부(무료): ${link}`, '이 메일은 광고성 정보 수신에 동의하신 분께 보내 드립니다. 위 주소를 누르면 수신 동의가 철회됩니다.'].join('\n');
  return { subject, text, bytes: 0 };
}

/* ── 문자 어댑터 — 알림톡 대행사의 문자 주소(CAMPAIGN_SMS_URL) · 키는 ALIMTALK_KEY · 점검판에서는 부르지 않음(간주) ── */
export interface SmsResult { ok: boolean; msgId?: string | null; errorKind?: string; error?: string }
export class CampaignSmsHttp {
  constructor(private readonly fetchFn?: FetchLike) {}
  static missing(): string[] {
    return [...(process.env.CAMPAIGN_SMS_URL?.trim() ? [] : ['CAMPAIGN_SMS_URL']), ...(process.env.ALIMTALK_KEY?.trim() ? [] : ['ALIMTALK_KEY'])];
  }
  async send(to: string, from: string, text: string): Promise<SmsResult> {
    if (CampaignSmsHttp.missing().length) return { ok: false, errorKind: 'NOT_CONFIGURED', error: `빠진 설정 ${CampaignSmsHttp.missing().join(',')}` };
    const env = process.env;
    const r = await httpJson({
      url: env.CAMPAIGN_SMS_URL!.trim(), method: 'POST', timeoutMs: envInt('ALIMTALK_TIMEOUT_MS', 8000), fetchFn: this.fetchFn,
      headers: { [env.ALIMTALK_AUTH_HEADER?.trim() || 'Authorization']: (env.ALIMTALK_AUTH_PREFIX ?? 'Bearer ') + env.ALIMTALK_KEY!.trim() },
      body: { from, to, text, type: smsBytes(text) > 90 ? 'LMS' : 'SMS', ad: true },
    });
    if (!r.ok) return { ok: false, errorKind: r.errorKind ?? 'UPSTREAM', error: r.error ?? '' };
    return { ok: true, msgId: String(getPath(r.body, env.ALIMTALK_RESULT_ID_PATH?.trim() || 'messageId') ?? '') || null };
  }
}

/** 지금 방식으로 실제 보낼 수 있는가(LIVE 만 뜻 있음) */
async function readiness(mail: MailService, s: CampaignSettings) {
  const mailSt = await mail.status().catch(() => ({ ready: false, reason: 'NO_SMTP' as const }));
  const smsMissing = [...CampaignSmsHttp.missing(), ...(s.smsFrom ? [] : ['campaign.sms_from'])];
  return { mail: mailSt.ready, mailReason: mailSt.reason, sms: !smsMissing.length, smsMissing };
}

/** 한 통 — ASSUME 은 부르지 않음 */
async function deliver(mail: MailService, s: CampaignSettings, mode: 'ASSUME' | 'LIVE', channel: string, to: string, msg: { subject: string | null; text: string }): Promise<SmsResult> {
  if (mode === 'ASSUME') return { ok: true, msgId: 'ASSUME-' + randomBytes(5).toString('hex') };
  if (channel === 'EMAIL') {
    const r = await mail.send({ to, subject: msg.subject ?? '(광고)', text: msg.text });
    return r.ok ? { ok: true, msgId: r.messageId ?? null } : { ok: false, errorKind: r.errorKind, error: r.error };
  }
  return new CampaignSmsHttp().send(to, s.smsFrom, msg.text);
}

/* ── 운영 화면 ─────────────────────────────────────────────────── */
const COUNTS_SQL = `count(*) FILTER (WHERE NOT s.test)::int AS total,
       count(*) FILTER (WHERE NOT s.test AND s.state = 'QUEUED')::int AS queued,
       count(*) FILTER (WHERE NOT s.test AND s.state = 'SENT')::int AS sent,
       count(*) FILTER (WHERE NOT s.test AND s.state = 'ASSUMED')::int AS assumed,
       count(*) FILTER (WHERE NOT s.test AND s.state = 'SKIPPED')::int AS skipped,
       count(*) FILTER (WHERE NOT s.test AND s.state = 'FAILED')::int AS failed,
       count(*) FILTER (WHERE s.test)::int AS tests`;

export async function listCampaigns(db: DatabaseService, mail: MailService) {
  const s = await campaignSettings(db);
  const items = await db.query(
    `SELECT c.id::text AS id, c.title, c.channel, c.audience, c.state, c.scheduled_at AS "scheduledAt", c.send_mode AS "sendMode",
            c.queued_at AS "queuedAt", c.finished_at AS "finishedAt", c.last_note AS "lastNote", c.created_at AS "createdAt",
            (SELECT count(*)::int FROM mkt_unsubscribes u WHERE u.campaign_id = c.id) AS unsubscribed,
            x.total, x.queued, x.sent, x.assumed, x.skipped, x.failed
       FROM mkt_campaigns c
       LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE NOT s.test)::int AS total,
                                 count(*) FILTER (WHERE NOT s.test AND s.state = 'QUEUED')::int AS queued,
                                 count(*) FILTER (WHERE NOT s.test AND s.state = 'SENT')::int AS sent,
                                 count(*) FILTER (WHERE NOT s.test AND s.state = 'ASSUMED')::int AS assumed,
                                 count(*) FILTER (WHERE NOT s.test AND s.state = 'SKIPPED')::int AS skipped,
                                 count(*) FILTER (WHERE NOT s.test AND s.state = 'FAILED')::int AS failed
                            FROM mkt_campaign_sends s WHERE s.campaign_id = c.id) x ON true
      ORDER BY c.id DESC LIMIT 100`);
  const [v] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM v_mkt_consent_violation`);
  return { settings: s, ready: await readiness(mail, s), night: isNightKst(), violations: v?.n ?? 0, items, canSend: RequestCtx.get()?.actorRole === 'SUPER' };
}

async function campaignRow(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 캠페인입니다.');
  const [c] = await db.query<{ id: string; title: string; channel: CampaignChannel; subject: string | null; body: string; audience: string; state: string;
    scheduledAt: string | null; sendMode: 'ASSUME' | 'LIVE' | null }>(
    `SELECT id::text AS id, title, channel, subject, body, audience, state, scheduled_at AS "scheduledAt", send_mode AS "sendMode" FROM mkt_campaigns WHERE id = $1::bigint`, [id]);
  if (!c) throw new NotFound('없는 캠페인입니다.');
  return c;
}

export async function campaignDetail(db: DatabaseService, id: string) {
  const c = await campaignRow(db, id);
  const [full] = await db.query(
    `SELECT c.id::text AS id, c.title, c.channel, c.subject, c.body, c.audience, c.state, c.scheduled_at AS "scheduledAt", c.send_mode AS "sendMode",
            c.queued_at AS "queuedAt", c.started_at AS "startedAt", c.finished_at AS "finishedAt", c.canceled_at AS "canceledAt", c.cancel_reason AS "cancelReason",
            c.last_note AS "lastNote", c.created_at AS "createdAt", c.updated_at AS "updatedAt"
       FROM mkt_campaigns c WHERE c.id = $1::bigint`, [c.id]);
  const [counts] = await db.query('SELECT ' + COUNTS_SQL + ' FROM mkt_campaign_sends s WHERE s.campaign_id = $1::bigint', [c.id]);
  const reasons = await db.query(
    `SELECT coalesce(skip_reason, error_kind) AS reason, count(*)::int AS n
       FROM (SELECT skip_reason, CASE WHEN state = 'FAILED' THEN split_part(coalesce(error, 'ERROR'), ':', 1) END AS error_kind FROM mkt_campaign_sends WHERE campaign_id = $1::bigint AND state IN ('SKIPPED', 'FAILED')) z
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, [c.id]);
  const recent = await db.query(
    `SELECT id::text AS id, to_masked AS "to", state, skip_reason AS "skipReason", left(error, 120) AS error, test, night, sent_at AS "sentAt", created_at AS "createdAt"
       FROM mkt_campaign_sends WHERE campaign_id = $1::bigint ORDER BY id DESC LIMIT 50`, [c.id]);
  const [u] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM mkt_unsubscribes WHERE campaign_id = $1::bigint`, [c.id]);
  return { campaign: full, counts, reasons, recent, unsubscribed: u?.n ?? 0 };
}

function cleanText(v: string | null | undefined) { return v == null ? null : String(v).replace(/\r/g, '').trim(); }
function checkContent(channel: string, subject: string | null, body: string) {
  if (body.length < 10 || body.length > 2000) throw new PolicyViolation('MKT_BODY', '글은 10 ~ 2,000자입니다.');
  if (channel === 'SMS' && body.length > SMS_MAX) throw new PolicyViolation('MKT_SMS_LEN', `문자 글은 ${SMS_MAX}자까지입니다(광고 표기 · 수신 거부 번호가 앞뒤에 붙음).`);
  if (channel === 'EMAIL' && (!subject || subject.length > 100)) throw new PolicyViolation('MKT_SUBJECT', '메일 제목은 1 ~ 100자입니다(앞에 「(광고)」가 붙음).');
  if (/무료\s*거부|수신\s*거부/.test(body)) throw new PolicyViolation('MKT_OPTOUT_TEXT', '수신 거부 안내는 서버가 끝에 붙입니다 — 글에서 빼 주십시오(두 번 나가지 않게).');
}

export async function createCampaign(db: DatabaseService, d: { title: string; channel: string; subject?: string; body: string; audience?: string }, actor: string | null) {
  const title = cleanText(d.title) ?? '', body = cleanText(d.body) ?? '';
  const channel = (CAMPAIGN_CHANNELS as readonly string[]).includes(d.channel) ? d.channel : '';
  if (!channel) throw new PolicyViolation('MKT_CHANNEL', '채널은 EMAIL · SMS 중 하나입니다.');
  if (title.length < 2 || title.length > 80) throw new PolicyViolation('MKT_TITLE', '캠페인 이름은 2 ~ 80자입니다.');
  const subject = channel === 'EMAIL' ? (cleanText(d.subject) || null) : null;
  const audience = d.audience && (CAMPAIGN_AUDIENCES as readonly string[]).includes(d.audience) ? d.audience : 'ALL';
  checkContent(channel, subject, body);
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO mkt_campaigns (title, channel, subject, body, audience, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text AS id`,
    [title, channel, subject, body, audience, actor]);
  return { ok: true, id: r.id, note: '초안을 만들었습니다 — 「받을 사람 보기」 · 「나에게 시험 보내기」로 확인한 뒤 최고 관리자가 보냅니다.' };
}

export async function updateCampaign(db: DatabaseService, id: string, d: { title?: string; subject?: string; body?: string; audience?: string }, actor: string | null) {
  const c = await campaignRow(db, id);
  if (c.state !== 'DRAFT') throw new StateConflict('MKT_STATE', '초안일 때만 고칩니다(보내기를 누른 캠페인은 취소하고 새로).');
  /* DTO 의 빠진 칸은 undefined — 옛 값 위에 덮지 않음(규칙 11) */
  const title = d.title !== undefined ? cleanText(d.title) ?? '' : c.title;
  const subject = c.channel === 'EMAIL' ? (d.subject !== undefined ? cleanText(d.subject) || null : c.subject) : null;
  const body = d.body !== undefined ? cleanText(d.body) ?? '' : c.body;
  const audience = d.audience !== undefined ? d.audience : c.audience;
  if (title.length < 2 || title.length > 80) throw new PolicyViolation('MKT_TITLE', '캠페인 이름은 2 ~ 80자입니다.');
  if (!(CAMPAIGN_AUDIENCES as readonly string[]).includes(audience)) throw new PolicyViolation('MKT_AUDIENCE', '대상은 ALL · RECENT_90 · CHURN_RISK · MALL_BUYERS · MALL_REBUY 중 하나입니다.');
  checkContent(c.channel, subject, body);
  await db.query(`UPDATE mkt_campaigns SET title = $2, subject = $3, body = $4, audience = $5 WHERE id = $1::bigint AND state = 'DRAFT'`, [c.id, title, subject, body, audience]);
  void actor;
  return { ok: true, id: c.id, note: '고쳤습니다.' };
}

/** 받을 사람(지금 기준) — 동의 · 야간 동의 · 2년 넘은 동의 · 받는 곳 없음 · 반송 주소 */
const AUDIENCE_SQL = `
  SELECT a.id, a.email::text AS email, a.phone,
         (m.agreed_at <= now() - interval '2 years') AS stale,
         public.fn_consent_at(a.id, 'MARKETING_NIGHT', now()) AS night_ok,
         CASE WHEN $1 = 'EMAIL' THEN a.email IS NULL ELSE coalesce(regexp_replace(a.phone, '[^0-9]', '', 'g'), '') !~ '^01[016789][0-9]{7,8}$' END AS no_addr,
         ($1 = 'EMAIL' AND EXISTS (SELECT 1 FROM mail_suppressions sp WHERE sp.email = a.email AND sp.released_at IS NULL)) AS suppressed
    FROM accounts a
    JOIN v_term_consent_current m ON m.account_id = a.id AND m.term_code = 'MARKETING' AND m.agreed
   WHERE a.status = 'ACTIVE' AND ($2 = 'ALL' OR ($2 = 'RECENT_90' AND a.last_login_at > now() - interval '90 days')
        OR ($2 = 'CHURN_RISK' AND EXISTS (SELECT 1 FROM csx_churn_signals cs WHERE cs.account_id = a.id))
        OR ($2 = 'MALL_BUYERS' AND EXISTS (SELECT 1 FROM hlt_orders ho WHERE ho.account_id = a.id AND ho.paid_at > now() - interval '180 days' AND ho.status NOT IN ('CANCELED', 'RETURNED')))
        OR ($2 = 'MALL_REBUY' AND EXISTS (SELECT 1 FROM v_mkx_rebuy_due rd WHERE rd.account_id = a.id
                                            AND rd.notify_on BETWEEN (now() AT TIME ZONE 'Asia/Seoul')::date - 7 AND (now() AT TIME ZONE 'Asia/Seoul')::date + 30)))`;   // v10.529 (D280) · v10.541 (D283)

export async function campaignAudience(db: DatabaseService, id: string) {
  const c = await campaignRow(db, id);
  const [r] = await db.query<{ consented: number; stale: number; noAddr: number; suppressed: number; willSend: number; nightOk: number }>(
    `SELECT count(*)::int AS consented, count(*) FILTER (WHERE stale)::int AS stale, count(*) FILTER (WHERE no_addr)::int AS "noAddr",
            count(*) FILTER (WHERE suppressed)::int AS suppressed,
            count(*) FILTER (WHERE NOT stale AND NOT no_addr AND NOT suppressed)::int AS "willSend",
            count(*) FILTER (WHERE NOT stale AND NOT no_addr AND NOT suppressed AND night_ok)::int AS "nightOk"
       FROM (${AUDIENCE_SQL}) z`, [c.channel, c.audience]);
  return { id: c.id, channel: c.channel, audience: c.audience, night: isNightKst(), ...r,
    note: '받을 사람은 「보내기」를 누르는 순간 고정되고, 보낼 때 동의를 다시 봅니다 — 2년 넘은 동의 · 받는 곳 없음 · 반송 주소는 뺍니다. 21시 ~ 8시에는 야간 동의한 분만 받고 나머지는 8시 뒤에 받습니다.' };
}

/** 나에게 시험 보내기 — 운영자 본인 메일 · 휴대폰 · 지금 방식(ASSUME 이면 기록만) · 글 미리보기를 돌려줌 · 하루 20번 */
export async function testCampaign(db: DatabaseService, mail: MailService, id: string, actor: string | null) {
  const c = await campaignRow(db, id);
  if (!actor) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
  const s = await campaignSettings(db);
  const [me] = await db.query<{ email: string | null; phone: string | null }>(`SELECT email::text AS email, phone FROM accounts WHERE id = $1`, [actor]);
  const phone = String(me?.phone ?? '').replace(/\D/g, '');
  const to = c.channel === 'EMAIL' ? (me?.email ?? '') : phone;
  if (!to || (c.channel === 'SMS' && !PHONE_RE.test(phone))) throw new PolicyViolation('MKT_TEST_NO_ADDRESS', c.channel === 'EMAIL' ? '내 계정에 메일 주소가 없습니다.' : '내 계정에 휴대폰 번호가 없습니다.');
  const [n] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM mkt_campaign_sends WHERE campaign_id = $1::bigint AND test AND account_id = $2 AND created_at > now() - interval '1 day'`, [c.id, actor]);
  if ((n?.n ?? 0) >= TEST_DAY_MAX) throw new PolicyViolation('MKT_TEST_LIMIT', `이 캠페인 시험 보내기는 하루 ${TEST_DAY_MAX}번까지입니다.`);
  if (s.mode === 'LIVE') {
    const rd = await readiness(mail, s);
    if (c.channel === 'EMAIL' ? !rd.mail : !rd.sms) throw new PolicyViolation('MKT_NOT_READY', c.channel === 'EMAIL' ? `메일이 준비되지 않았습니다(${rd.mailReason ?? ''}).` : `문자가 준비되지 않았습니다 — 빠짐 ${rd.smsMissing.join(' · ')}.`);
  }
  const token = randomBytes(24).toString('base64url');
  const masked = c.channel === 'EMAIL' ? maskMail(to) : `***${phone.slice(-4)}`;
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO mkt_campaign_sends (campaign_id, account_id, test, to_masked, unsub_hash) VALUES ($1::bigint, $2, true, $3, $4) RETURNING id::text AS id`,
    [c.id, actor, masked, tokenHash(token)]);
  const msg = renderCampaign(c, s, token);
  const r = await deliver(mail, s, s.mode, c.channel, to, msg);
  if (r.ok) await db.query(`UPDATE mkt_campaign_sends SET state = $2, sent_at = clock_timestamp(), provider_msg_id = $3 WHERE id = $1::bigint`, [row.id, s.mode === 'LIVE' ? 'SENT' : 'ASSUMED', r.msgId ?? null]);
  else await db.query(`UPDATE mkt_campaign_sends SET state = 'FAILED', error = $2 WHERE id = $1::bigint`, [row.id, `${r.errorKind ?? 'ERROR'}: ${(r.error ?? '').slice(0, 150)}`]);
  /* 감사 — 미리보기 · 열쇠는 남기지 않음 */
  await audit(db, 'MKT_CAMPAIGN_TEST', { campaignId: c.id, mode: s.mode, channel: c.channel, ok: r.ok, to: masked });
  return { ok: r.ok, mode: s.mode, to: masked, preview: msg, error: r.ok ? null : r.error ?? null,
    note: r.ok ? (s.mode === 'LIVE' ? '나에게 보냈습니다.' : '간주(ASSUME) — 실제로 보내지 않고 기록만 남겼습니다. 아래 미리보기를 확인하십시오.') : '보내지 못했습니다.' };
}

/** 보내기(SUPER) — 켜짐 · 법정 표기 · 방식 준비 확인 → 받을 사람 고정 → 예약 시각(없으면 바로)에 정기 작업이 보냄 */
export async function sendCampaign(db: DatabaseService, mail: MailService, id: string, d: { scheduledAt?: string; confirm?: string }, actor: string | null) {
  const c = await campaignRow(db, id);
  if (c.state !== 'DRAFT') throw new StateConflict('MKT_STATE', '초안만 보낼 수 있습니다.');
  const s = await campaignSettings(db);
  if (!s.enabled) throw new PolicyViolation('MKT_OFF', '캠페인 보내기가 꺼져 있습니다(campaign.enabled) — 최고 관리자가 설정에서 켜야 합니다.');
  if ((d.confirm ?? '').trim() !== '보내기') throw new PolicyViolation('MKT_CONFIRM', '확인 칸에 「보내기」를 넣어 주십시오.');
  if (!s.contact) throw new PolicyViolation('MKT_LEGAL', '보낸 곳 연락처(campaign.contact)가 비어 있습니다 — 광고 표기(정보통신망법 제50조)에 필요합니다.');
  if (c.channel === 'SMS' && !OPTOUT_RE.test(s.optoutPhone)) throw new PolicyViolation('MKT_LEGAL', '080 무료 수신 거부 번호 형식이 아닙니다.');
  if (c.channel === 'SMS' && !s.optoutPhone) throw new PolicyViolation('MKT_LEGAL', '080 무료 수신 거부 번호(campaign.optout_phone)가 비어 있습니다 — 문자 광고에 필요합니다.');
  if (s.mode === 'LIVE') {
    const rd = await readiness(mail, s);
    if (c.channel === 'EMAIL' ? !rd.mail : !rd.sms) throw new PolicyViolation('MKT_NOT_READY', c.channel === 'EMAIL' ? `메일이 준비되지 않았습니다(${rd.mailReason ?? ''}) — 간주(ASSUME)로 두거나 메일 준비를 마치십시오.` : `문자가 준비되지 않았습니다 — 빠짐 ${rd.smsMissing.join(' · ')}.`);
  }
  let at: Date | null = null;
  if (d.scheduledAt) {
    at = new Date(d.scheduledAt);
    if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() - 60_000 || at.getTime() > Date.now() + 60 * 86400e3) throw new PolicyViolation('MKT_SCHEDULE', '예약 시각은 지금부터 60일 안입니다.');
  }
  const rows = await db.query<{ id: string; email: string | null; phone: string | null; stale: boolean; no_addr: boolean; suppressed: boolean }>(AUDIENCE_SQL, [c.channel, c.audience]);
  const go = rows.filter((r) => !r.stale && !r.no_addr && !r.suppressed);
  if (!go.length) throw new PolicyViolation('MKT_NO_AUDIENCE', '보낼 수 있는 받는 사람(마케팅 수신 동의 · 받는 곳 있음)이 없습니다.');
  return db.transaction(async () => {
    const [u] = await db.query<{ id: string }>(
      `UPDATE mkt_campaigns SET state = 'QUEUED', send_mode = $2, scheduled_at = coalesce($3::timestamptz, now()), queued_by = $4, queued_at = now(),
              last_note = $5
        WHERE id = $1::bigint AND state = 'DRAFT' RETURNING id::text AS id`,
      [c.id, s.mode, at ? at.toISOString() : null, actor, `받는 사람 ${go.length}명 고정(뺀 사람 ${rows.length - go.length}명)`]);
    if (!u) throw new StateConflict('MKT_STATE', '다른 사람이 먼저 바꿨습니다 — 새로 고침 하십시오.');
    const ids = go.map((r) => r.id);
    const masked = go.map((r) => (c.channel === 'EMAIL' ? maskMail(r.email) ?? '' : `***${String(r.phone ?? '').replace(/\D/g, '').slice(-4)}`));
    const hashes = go.map((r) => tokenHash(unsubToken(c.id, r.id)));
    for (let i = 0; i < ids.length; i += 1000) {
      await db.query(
        `INSERT INTO mkt_campaign_sends (campaign_id, account_id, to_masked, unsub_hash)
         SELECT $1::bigint, x.a, x.m, x.h FROM unnest($2::uuid[], $3::text[], $4::text[]) AS x(a, m, h)`,
        [c.id, ids.slice(i, i + 1000), masked.slice(i, i + 1000), hashes.slice(i, i + 1000)]);
    }
    await audit(db, 'MKT_CAMPAIGN_SEND', { campaignId: c.id, mode: s.mode, recipients: go.length, excluded: rows.length - go.length, scheduledAt: at ? at.toISOString() : null });
    return { ok: true, id: c.id, recipients: go.length, excluded: rows.length - go.length, mode: s.mode, scheduledAt: at ? at.toISOString() : null,
      /* 안내는 문장 통째로 고름(번역 틀이 한 문장씩 맞춤 — 조각을 이어 붙이지 않음) */
      note: at
        ? (s.mode === 'ASSUME' ? `받는 사람 ${go.length}명을 고정했습니다 — 예약 시각에 정기 작업이 간주로 처리합니다(실제로 보내지 않음).` : `받는 사람 ${go.length}명을 고정했습니다 — 예약 시각에 정기 작업이 보냅니다.`)
        : (s.mode === 'ASSUME' ? `받는 사람 ${go.length}명을 고정했습니다 — 5분 안에 정기 작업이 간주로 처리합니다(실제로 보내지 않음).` : `받는 사람 ${go.length}명을 고정했습니다 — 5분 안에 정기 작업이 보냅니다.`) };
  });
}

export async function cancelCampaign(db: DatabaseService, id: string, reason: string, actor: string | null) {
  const c = await campaignRow(db, id);
  const why = String(reason ?? '').replace(/\s+/g, ' ').trim();
  if (why.length < 2 || why.length > 200) throw new PolicyViolation('MKT_REASON', '취소 사유는 2 ~ 200자입니다.');
  if (!['DRAFT', 'QUEUED', 'SENDING'].includes(c.state)) throw new StateConflict('MKT_STATE', '끝났거나 이미 취소한 캠페인입니다.');
  return db.transaction(async () => {
    const [u] = await db.query(`UPDATE mkt_campaigns SET state = 'CANCELED', canceled_by = $2, canceled_at = now(), cancel_reason = $3 WHERE id = $1::bigint AND state IN ('DRAFT', 'QUEUED', 'SENDING') RETURNING id`, [c.id, actor, why]);
    if (!u) throw new StateConflict('MKT_STATE', '다른 사람이 먼저 바꿨습니다 — 새로 고침 하십시오.');
    const left = await db.query(`UPDATE mkt_campaign_sends SET state = 'SKIPPED', skip_reason = 'CANCELED' WHERE campaign_id = $1::bigint AND state = 'QUEUED' AND NOT test RETURNING id`, [c.id]);
    return { ok: true, id: c.id, stopped: left.length, note: `취소했습니다 — 아직 안 보낸 ${left.length}명은 보내지 않습니다.` };
  });
}

/** 정기 작업 · 「지금 한 번 보내기」 — 예약 시각이 된 캠페인을 campaign.batch 만큼 · 야간은 야간 동의자만 */
export async function runCampaignBatch(db: DatabaseService, mail: MailService) {
  const s = await campaignSettings(db);
  const out = { on: s.enabled, night: isNightKst(), campaigns: 0, sent: 0, assumed: 0, skipped: 0, failed: 0, retry: 0, deferred: 0, done: 0, stuck: [] as string[] };
  if (!s.enabled) return out;
  await db.query(`UPDATE mkt_campaigns SET state = 'SENDING', started_at = now() WHERE state = 'QUEUED' AND scheduled_at <= now()`);
  const camps = await db.query<{ id: string; title: string; channel: CampaignChannel; subject: string | null; body: string; sendMode: 'ASSUME' | 'LIVE' }>(
    `SELECT id::text AS id, title, channel, subject, body, send_mode AS "sendMode" FROM mkt_campaigns WHERE state = 'SENDING' ORDER BY id LIMIT 20`);
  let budget = s.batch;
  const rd = await readiness(mail, s);
  for (const c of camps) {
    out.campaigns++;
    const night = isNightKst();
    if (c.sendMode === 'LIVE' && (c.channel === 'EMAIL' ? !rd.mail : !rd.sms)) {
      const why = c.channel === 'EMAIL' ? `메일 준비 안 됨(${rd.mailReason ?? ''})` : `문자 준비 안 됨(${rd.smsMissing.join(' · ')})`;
      await db.query(`UPDATE mkt_campaigns SET last_note = $2 WHERE id = $1::bigint`, [c.id, `멈춤 — ${why}`]);
      await db.query(
        `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
         SELECT 'MKT_CAMPAIGN_STUCK', 'WARN', $1, $2::jsonb, clock_timestamp()
          WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'MKT_CAMPAIGN_STUCK' AND detail->>'campaign' = $3 AND resolved_at IS NULL)
         ON CONFLICT DO NOTHING`,
        [`캠페인 보내기 멈춤 — ${c.title} · ${why} — 회원 › 문자 · 메일 캠페인`.slice(0, 300), JSON.stringify({ campaign: c.id, why }), c.id]);
      out.stuck.push(c.id); continue;
    }
    if (budget > 0) {
      const rows = await db.query<{ id: string; accountId: string; email: string | null; phone: string | null; active: boolean; consent: boolean; suppressed: boolean; error: string | null }>(
        `SELECT s.id::text AS id, s.account_id AS "accountId", a.email::text AS email, a.phone, (a.status = 'ACTIVE') AS active,
                public.fn_consent_at(s.account_id, 'MARKETING', now()) AS consent, s.error,
                EXISTS (SELECT 1 FROM mail_suppressions sp WHERE sp.email = a.email AND sp.released_at IS NULL) AS suppressed
           FROM mkt_campaign_sends s JOIN accounts a ON a.id = s.account_id
          WHERE s.campaign_id = $1::bigint AND s.state = 'QUEUED' AND NOT s.test
            AND (NOT $2::boolean OR public.fn_consent_at(s.account_id, 'MARKETING_NIGHT', now()))
          ORDER BY s.id LIMIT $3::int`, [c.id, night, budget]);
      for (const r of rows) {
        budget--;
        const phone = String(r.phone ?? '').replace(/\D/g, '');
        const skip = !r.active ? 'INACTIVE' : !r.consent ? 'NO_CONSENT' : c.channel === 'EMAIL' && !r.email ? 'NO_ADDRESS'
          : c.channel === 'SMS' && !PHONE_RE.test(phone) ? 'NO_ADDRESS' : c.channel === 'EMAIL' && r.suppressed ? 'SUPPRESSED' : null;
        if (skip) {
          await db.query(`UPDATE mkt_campaign_sends SET state = 'SKIPPED', skip_reason = $2 WHERE id = $1::bigint AND state = 'QUEUED'`, [r.id, skip]);
          out.skipped++; continue;
        }
        const msg = renderCampaign(c, s, unsubToken(c.id, r.accountId));
        const res = await deliver(mail, s, c.sendMode, c.channel, c.channel === 'EMAIL' ? r.email! : phone, msg);
        if (res.ok) {
          try {
            await db.query(`UPDATE mkt_campaign_sends SET state = $2, sent_at = clock_timestamp(), provider_msg_id = $3, error = NULL WHERE id = $1::bigint AND state = 'QUEUED'`,
              [r.id, c.sendMode === 'LIVE' ? 'SENT' : 'ASSUMED', res.msgId ?? null]);
            if (c.sendMode === 'LIVE') out.sent++; else out.assumed++;
          } catch (e) {
            /* 보낸 뒤 DB 가 막음(그 사이 동의 철회 · 야간이 됨) — LIVE 라면 이미 나간 것이라 기록을 남김(FAILED · 까닭) */
            const m = String((e as Error)?.message ?? '');
            await db.query(`UPDATE mkt_campaign_sends SET state = 'FAILED', error = $2 WHERE id = $1::bigint AND state = 'QUEUED'`, [r.id, `DB_BLOCKED: ${m.slice(0, 150)}`]).catch(() => undefined);
            out.failed++;
          }
          continue;
        }
        const tries = Number(/^RETRY (\d+)/.exec(r.error ?? '')?.[1] ?? 0) + 1;
        const why = `${res.errorKind ?? 'ERROR'}: ${(res.error ?? '').slice(0, 150)}`;
        if (TEMP.has(res.errorKind ?? '') && tries < MAX_TRY) {
          await db.query(`UPDATE mkt_campaign_sends SET error = $2 WHERE id = $1::bigint AND state = 'QUEUED'`, [r.id, `RETRY ${tries} ${why}`.slice(0, 200)]);
          out.retry++;
        } else {
          await db.query(`UPDATE mkt_campaign_sends SET state = 'FAILED', error = $2 WHERE id = $1::bigint AND state = 'QUEUED'`, [r.id, why.slice(0, 200)]);
          out.failed++;
        }
      }
    }
    const [left] = await db.query<{ queued: number; nightWait: number }>(
      `SELECT count(*)::int AS queued, count(*) FILTER (WHERE NOT public.fn_consent_at(account_id, 'MARKETING_NIGHT', now()))::int AS "nightWait"
         FROM mkt_campaign_sends WHERE campaign_id = $1::bigint AND state = 'QUEUED' AND NOT test`, [c.id]);
    if (!left?.queued) {
      await db.query(`UPDATE mkt_campaigns SET state = 'DONE', finished_at = now(), last_note = '모두 처리했습니다' WHERE id = $1::bigint AND state = 'SENDING'`, [c.id]);
      out.done++;
    } else if (night && left.nightWait) {
      out.deferred += left.nightWait;
      await db.query(`UPDATE mkt_campaigns SET last_note = $2 WHERE id = $1::bigint`, [c.id, `야간 — 야간 동의가 없는 ${left.nightWait}명은 08:00 뒤에 보냅니다`]);
    }
  }
  return out;
}

/** 정기 작업 mkt_campaign_send */
export const mktCampaignJob = (db: DatabaseService, mail: MailService) => runCampaignBatch(db, mail);

export async function setCampaignSettings(db: DatabaseService, d: { enabled?: boolean; mode?: string; senderName?: string; smsName?: string; contact?: string;
  optoutPhone?: string; smsFrom?: string; batch?: number; reason: string }) {
  const reason = String(d.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('MKT_REASON', '사유는 2 ~ 200자입니다.');
  const set: Array<[string, string]> = [];
  if (d.enabled !== undefined) set.push(['campaign.enabled', d.enabled ? 'on' : 'off']);
  if (d.mode !== undefined) {
    if (!['ASSUME', 'LIVE'].includes(d.mode)) throw new PolicyViolation('MKT_MODE', '방식은 ASSUME · LIVE 중 하나입니다.');
    set.push(['campaign.send_mode', d.mode]);
  }
  if (d.senderName !== undefined) { const v = d.senderName.trim(); if (v.length < 2 || v.length > 60) throw new PolicyViolation('MKT_SENDER', '보낸 곳 이름은 2 ~ 60자입니다.'); set.push(['campaign.sender_name', v]); }
  if (d.smsName !== undefined) { const v = d.smsName.trim(); if (v.length < 2 || v.length > 20) throw new PolicyViolation('MKT_SENDER', '문자 앞 이름은 2 ~ 20자입니다.'); set.push(['campaign.sms_name', v]); }
  if (d.contact !== undefined) { const v = d.contact.trim(); if (v.length > 100) throw new PolicyViolation('MKT_CONTACT', '연락처는 100자까지입니다.'); set.push(['campaign.contact', v]); }
  if (d.optoutPhone !== undefined) { const v = d.optoutPhone.replace(/\D/g, ''); if (!OPTOUT_RE.test(v)) throw new PolicyViolation('MKT_OPTOUT', '080 으로 시작하는 무료 수신 거부 번호(숫자 10 ~ 11자리)입니다.'); set.push(['campaign.optout_phone', v]); }
  if (d.smsFrom !== undefined) { const v = d.smsFrom.replace(/\D/g, ''); if (!SMS_FROM_RE.test(v)) throw new PolicyViolation('MKT_SMS_FROM', '발신번호는 0 으로 시작하는 숫자 9 ~ 11자리입니다.'); set.push(['campaign.sms_from', v]); }
  if (d.batch !== undefined) { if (!Number.isInteger(d.batch) || d.batch < 1 || d.batch > 1000) throw new PolicyViolation('MKT_BATCH', '한 번에 보내는 수는 1 ~ 1,000 입니다.'); set.push(['campaign.batch', String(d.batch)]); }
  if (!set.length) throw new PolicyViolation('MKT_NOTHING', '바꿀 것이 없습니다.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  return { ok: true, settings: await campaignSettings(db), note: '캠페인 설정을 바꿨습니다.' };
}

/* ── 수신 거부(공개 · 로그인 없음) — 메일의 링크 ─────────────────────── */
async function sendByToken(db: DatabaseService, token: string) {
  if (!TOKEN_RE.test(token ?? '')) return null;
  const [r] = await db.query<{ id: string; campaignId: string; accountId: string; channel: string; title: string; done: boolean }>(
    `SELECT s.id::text AS id, s.campaign_id::text AS "campaignId", s.account_id AS "accountId", c.channel, c.title,
            EXISTS (SELECT 1 FROM mkt_unsubscribes u WHERE u.send_id = s.id) AS done
       FROM mkt_campaign_sends s JOIN mkt_campaigns c ON c.id = s.campaign_id WHERE s.unsub_hash = $1`, [tokenHash(token)]);
  return r ?? null;
}

export async function unsubscribe(db: DatabaseService, token: string) {
  const s = await sendByToken(db, token);
  if (!s) throw new NotFound('수신 거부 주소가 맞지 않습니다 — 메일의 링크를 다시 눌러 주십시오.');
  if (s.done) return { ok: true, already: true, withdrew: [] as string[], note: '이미 수신 거부를 처리했습니다.' };
  const c = RequestCtx.get();
  return db.transaction(async () => {
    const withdrew: string[] = [];
    for (const code of ['MARKETING', 'MARKETING_NIGHT']) {
      const [cur] = await db.query<{ agreed: boolean; version: string | null }>(
        `SELECT g.agreed, coalesce((SELECT t.version FROM v_terms_current t WHERE t.code = $2), g.term_version) AS version
           FROM v_term_consent_current g WHERE g.account_id = $1 AND g.term_code = $2`, [s.accountId, code]);
      if (!cur?.agreed || !cur.version) continue;
      await db.query(`INSERT INTO term_agreements (account_id, term_code, term_version, agreed, ip, user_agent) VALUES ($1, $2, $3, false, $4, $5)`,
        [s.accountId, code, cur.version, c?.clientIp ?? c?.ip ?? null, c?.userAgent ? 'campaign-unsubscribe · ' + c.userAgent.slice(0, 200) : 'campaign-unsubscribe']);
      withdrew.push(code);
    }
    const [ins] = await db.query(
      `INSERT INTO mkt_unsubscribes (send_id, campaign_id, account_id, channel, withdrew, ip_masked) VALUES ($1::bigint, $2::bigint, $3, $4, $5::text[], $6)
       ON CONFLICT (send_id) DO NOTHING RETURNING id`,
      [s.id, s.campaignId, s.accountId, s.channel, withdrew, maskIp(c?.clientIp ?? c?.ip)]);
    if (!ins) return { ok: true, already: true, withdrew: [] as string[], note: '이미 수신 거부를 처리했습니다.' };
    /* 아직 안 보낸 다른 캠페인 줄도 멈춤 */
    await db.query(`UPDATE mkt_campaign_sends SET state = 'SKIPPED', skip_reason = 'UNSUBSCRIBED' WHERE account_id = $1 AND state = 'QUEUED' AND NOT test`, [s.accountId]);
    /* 처리 결과 알림(나의공간 › 알림) — 이벤트 이름에 MARKETING · AD_ 를 넣지 않음(광고 감시 보기에 잡히지 않게) */
    await db.query(
      `INSERT INTO notifications (account_id, event_code, title, body, link_url) VALUES ($1, 'CONSENT_OPTOUT', '광고 수신 거부를 처리했습니다', $2, '/terms/agree')`,
      [s.accountId, `${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)} 소개뱅크 광고성 정보 수신 동의를 철회했습니다. 다시 받으시려면 약관 동의 화면에서 바꾸실 수 있습니다.`]).catch(() => undefined);
    return { ok: true, already: false, withdrew, note: withdrew.length ? '광고성 정보 수신 동의를 철회했습니다. 앞으로 광고 메일 · 문자를 보내지 않습니다.' : '이미 수신 동의가 없는 상태입니다 — 앞으로도 보내지 않습니다.' };
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
function page(title: string, inner: string) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>body{font-family:sans-serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.6;color:#222}button{font-size:16px;padding:10px 18px;border-radius:7px;border:1px solid #444;background:#222;color:#fff;cursor:pointer}.m{color:#666;font-size:14px}</style></head>
<body><h1>${esc(title)}</h1>${inner}<p class="m">소개뱅크 · 광고성 정보 수신 거부(정보통신망법 제50조)</p></body></html>`;
}

/** 링크를 열면 — 확인 단추만(메일 검사기가 링크를 미리 열어도 철회되지 않게 · 누르면 POST) */
export async function unsubscribePage(db: DatabaseService, token: string): Promise<string> {
  const s = await sendByToken(db, token);
  if (!s) return page('수신 거부 주소가 맞지 않습니다', '<p>메일의 수신 거부 링크를 다시 눌러 주십시오. 계속 안 되면 소개뱅크 고객센터로 알려 주십시오.</p>');
  if (s.done) return page('이미 처리했습니다', '<p>광고성 정보 수신 거부를 이미 처리했습니다. 앞으로 광고 메일 · 문자를 보내지 않습니다.</p>');
  return page('광고 수신 거부', `<p>「${esc(s.title)}」을(를) 받으셨습니다. 아래 단추를 누르면 소개뱅크 <b>광고성 정보 수신 동의</b>(야간 포함)를 철회합니다. 비용은 들지 않습니다.</p>
<form method="post" action="/api/v1/site/unsubscribe"><input type="hidden" name="t" value="${esc(token)}"><button type="submit">수신 거부</button></form>`);
}

export async function unsubscribeResultPage(db: DatabaseService, token: string): Promise<string> {
  try {
    const r = await unsubscribe(db, token);
    return page(r.already ? '이미 처리했습니다' : '수신 거부를 처리했습니다', `<p>${esc(r.note)}</p>`);
  } catch {
    return page('수신 거부 주소가 맞지 않습니다', '<p>메일의 수신 거부 링크를 다시 눌러 주십시오. 계속 안 되면 소개뱅크 고객센터로 알려 주십시오.</p>');
  }
}

function audit(db: DatabaseService, action: string, data: Record<string, unknown>) {
  const c = RequestCtx.get();
  return db.query(
    `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, after_data, ip, user_agent) VALUES ($1, $2, $3, 'SETTING', $4::jsonb, $5, $6)`,
    [c?.actorId ?? null, c?.actorRole ?? null, action, JSON.stringify(data), c?.ip ?? null, c?.userAgent ?? null]).catch(() => undefined);
}
