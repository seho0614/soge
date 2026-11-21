import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { DatabaseService } from '../../db/database.service';
import { Forbidden, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { PHONE_RE, campaignSettings, renderCampaign, smsBytes } from '../marketing/campaign';
import { cleanReason, intIn, isOn, mkxAudit, readSettings } from './common';

/* ---------------------------------------------------------------------
 * v10.541 (D283 · docs/679) ④ 문자 마케팅 — ㊳ 문자 · 메일 캠페인(D268 · campaign.ts) 위에
 *   그대로 씀: 「(광고)이름」 앞머리 · 「무료거부 080…」 끝(renderCampaign) · 마케팅 수신 동의자만 · 21 ~ 8시 야간 동의자만(DB 트리거) ·
 *             문자 대행 어댑터 CampaignSmsHttp(알림톡 대행사의 문자 주소 · 키 ALIMTALK_KEY) · 간주(campaign.send_mode ASSUME) · campaign.enabled 처음 off
 *   더함   ㉠ 소개몰 대상 MALL_BUYERS(180일 안 결제) · MALL_REBUY(재구매 알릴 날 7일 전 ~ 30일 뒤) — campaign.ts AUDIENCE_SQL 에 두 줄(patches/2)
 *          ㉡ 회원별 광고 문자 7일 상한 mkx.sms_weekly_max — DB 트리거 trg_mkx_sms_freq_cap 이 받는 사람을 고정할 때 SKIPPED(FREQ_CAP)
 *          ㉢ 080 수신 거부 반영 — 붙여 넣기(ADMIN) · 대행사 웹훅(POST /site/optout080 · mkx.optout080_hook 처음 off · 토큰 지문 대조)
 *          ㉣ 문자 글 바이트 · 단문 / 장문 · 예상 비용(mkx.sms_price_sms · lms — 0 이면 모름)
 * ------------------------------------------------------------------- */

export const OPTOUT_TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/;
const MAX_PHONES = 1000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const SMS_KEYS = ['mkx.sms_weekly_max', 'mkx.sms_price_sms', 'mkx.sms_price_lms', 'mkx.optout080_hook', 'mkx.optout080_token_hash'];
export interface SmsMkxSettings { weeklyMax: number; priceSms: number; priceLms: number; hook: boolean; tokenSet: boolean }
export async function smsMkxSettings(db: DatabaseService): Promise<SmsMkxSettings & { tokenHash: string }> {
  const s = await readSettings(db, SMS_KEYS);
  return { weeklyMax: intIn(s['mkx.sms_weekly_max'], 0, 14, 2), priceSms: intIn(s['mkx.sms_price_sms'], 0, 1000, 0), priceLms: intIn(s['mkx.sms_price_lms'], 0, 1000, 0),
    hook: isOn(s['mkx.optout080_hook']), tokenSet: /^[0-9a-f]{64}$/.test(s['mkx.optout080_token_hash']), tokenHash: s['mkx.optout080_token_hash'] };
}

/** 문자 한 통 바이트 · 종류 · 예상 비용(받는 사람 수 × 단가 · 단가 0 이면 null) */
export function smsCost(text: string, recipients: number, priceSms: number, priceLms: number) {
  const bytes = smsBytes(text);
  const type = bytes > 90 ? 'LMS' : 'SMS';
  const unit = type === 'LMS' ? priceLms : priceSms;
  return { bytes, type, unit, cost: unit > 0 ? unit * recipients : null };
}

/* ── 운영 화면 ─────────────────────────────────────────────────── */
export async function smsAdminView(db: DatabaseService) {
  const s = await smsMkxSettings(db);
  const cs = await campaignSettings(db);
  /* 소개몰 대상 — 마케팅 동의 · 휴대폰 있음 · 야간 동의(㊳ AUDIENCE_SQL 과 같은 기준) */
  const [aud] = await db.query<{ buyers: number; buyersNight: number; rebuy: number; rebuyNight: number }>(
    `WITH m AS (
       SELECT a.id, public.fn_consent_at(a.id, 'MARKETING_NIGHT', now()) AS night
         FROM accounts a JOIN v_term_consent_current c ON c.account_id = a.id AND c.term_code = 'MARKETING' AND c.agreed
        WHERE a.status = 'ACTIVE' AND c.agreed_at > now() - interval '2 years'
          AND NOT EXISTS (SELECT 1 FROM account_roles xr WHERE xr.account_id = a.id AND xr.role IN ('REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'))   -- v10.563 (D291) 운영자 빼기(campaign.ts AUDIENCE_SQL 과 같음)
          AND coalesce(regexp_replace(a.phone, '[^0-9]', '', 'g'), '') ~ '^01[016789][0-9]{7,8}$')
     SELECT count(*) FILTER (WHERE b)::int AS buyers, count(*) FILTER (WHERE b AND night)::int AS "buyersNight",
            count(*) FILTER (WHERE r)::int AS rebuy, count(*) FILTER (WHERE r AND night)::int AS "rebuyNight"
       FROM (SELECT m.id, m.night,
                    EXISTS (SELECT 1 FROM hlt_orders ho WHERE ho.account_id = m.id AND ho.paid_at > now() - interval '180 days' AND ho.status NOT IN ('CANCELED', 'RETURNED')) AS b,
                    EXISTS (SELECT 1 FROM v_mkx_rebuy_due rd WHERE rd.account_id = m.id
                               AND rd.notify_on BETWEEN (now() AT TIME ZONE 'Asia/Seoul')::date - 7 AND (now() AT TIME ZONE 'Asia/Seoul')::date + 30) AS r
               FROM m) z`);
  const [cap] = await db.query<{ capped7: number; atCap: number }>(
    `SELECT (SELECT count(*)::int FROM mkt_campaign_sends WHERE skip_reason = 'FREQ_CAP' AND created_at > now() - interval '7 days') AS capped7,
            (SELECT count(*)::int FROM (SELECT s.account_id FROM mkt_campaign_sends s JOIN mkt_campaigns c ON c.id = s.campaign_id
                                          WHERE NOT s.test AND c.channel = 'SMS' AND s.state IN ('QUEUED', 'SENT', 'ASSUMED') AND s.created_at > now() - interval '7 days'
                                          GROUP BY s.account_id HAVING count(*) >= greatest($1::int, 1)) x) AS "atCap"`, [s.weeklyMax]);
  /* 문자 캠페인(초안 · 대기 · 보내는 중) 글 바이트 · 예상 비용 */
  const camps = await db.query<{ id: string; title: string; state: string; audience: string; body: string; queued: number }>(
    `SELECT c.id::text AS id, c.title, c.state, c.audience, c.body,
            (SELECT count(*)::int FROM mkt_campaign_sends x WHERE x.campaign_id = c.id AND x.state = 'QUEUED' AND NOT x.test) AS queued
       FROM mkt_campaigns c WHERE c.channel = 'SMS' AND c.state IN ('DRAFT', 'QUEUED', 'SENDING') ORDER BY c.id DESC LIMIT 30`);
  const campaigns = camps.map((c) => {
    const text = renderCampaign({ channel: 'SMS', subject: null, body: c.body }, cs, null).text;
    return { id: c.id, title: c.title, state: c.state, audience: c.audience, queued: c.queued, ...smsCost(text, c.queued, s.priceSms, s.priceLms) };
  });
  const optouts = await db.query(
    `SELECT id::text AS id, '***' || phone_last4 AS phone, source, accounts, withdrew, stopped, created_at AS at FROM mkx_optout080 ORDER BY id DESC LIMIT 50`);
  const [o7] = await db.query<{ n: number; w: number }>(`SELECT count(*)::int AS n, coalesce(sum(withdrew), 0)::int AS w FROM mkx_optout080 WHERE created_at > now() - interval '7 days'`);
  return {
    settings: { weeklyMax: s.weeklyMax, priceSms: s.priceSms, priceLms: s.priceLms, hook: s.hook, tokenSet: s.tokenSet },
    campaign: { enabled: cs.enabled, mode: cs.mode, smsName: cs.smsName, optoutPhone: cs.optoutPhone, smsFrom: cs.smsFrom },
    audiences: aud, cap, campaigns, optouts, optout7: o7, canToken: RequestCtx.get()?.actorRole === 'SUPER',
    note: '광고 문자는 회원 › 문자 · 메일 캠페인에서 만들고 보냅니다(「(광고)」 · 080 수신 거부 · 야간 동의는 서버가 붙이고 지킴). 여기서는 소개몰 대상 · 회원별 7일 상한 · 080 수신 거부 반영 · 예상 비용을 봅니다.',
  };
}

/* ── 080 수신 거부 반영 ─────────────────────────────────────────── */
export function parsePhones(input: string | string[]): { valid: string[]; invalid: number } {
  const raw = Array.isArray(input) ? input.map((x) => String(x ?? '')) : String(input ?? '').split(/[\s,;]+/);
  const valid = new Set<string>();
  let invalid = 0;
  for (const r of raw) {
    const d = r.replace(/\D/g, '');
    if (!d) continue;
    const n = d.startsWith('82') && d.length >= 11 ? '0' + d.slice(2) : d;
    if (PHONE_RE.test(n)) valid.add(n); else invalid++;
  }
  return { valid: [...valid].slice(0, MAX_PHONES), invalid };
}

export async function applyOptout080(db: DatabaseService, input: string | string[], source: 'PASTE' | 'HOOK', actor: string | null) {
  const { valid, invalid } = parsePhones(input);
  if (!valid.length) throw new PolicyViolation('MKX_OPTOUT_EMPTY', '휴대폰 번호(010 …)가 하나도 없습니다.');
  const accs = await db.query<{ id: string; d: string }>(
    `SELECT id, regexp_replace(phone, '[^0-9]', '', 'g') AS d FROM accounts WHERE phone IS NOT NULL AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($1::text[])`, [valid]);
  const ua = source === 'HOOK' ? 'optout080-hook' : 'optout080-paste';
  let matched = 0, withdrew = 0, stopped = 0;
  for (const phone of valid) {
    const mine = accs.filter((a) => a.d === phone);
    let w = 0, st = 0;
    for (const a of mine) {
      await db.transaction(async () => {
        const codes: string[] = [];
        for (const code of ['MARKETING', 'MARKETING_NIGHT']) {
          const [cur] = await db.query<{ agreed: boolean; version: string | null }>(
            `SELECT g.agreed, coalesce((SELECT t.version FROM v_terms_current t WHERE t.code = $2), g.term_version) AS version
               FROM v_term_consent_current g WHERE g.account_id = $1 AND g.term_code = $2`, [a.id, code]);
          if (!cur?.agreed || !cur.version) continue;
          await db.query(`INSERT INTO term_agreements (account_id, term_code, term_version, agreed, ip, user_agent) VALUES ($1, $2, $3, false, NULL, $4)`, [a.id, code, cur.version, ua]);
          codes.push(code);
        }
        const s = await db.query(`UPDATE mkt_campaign_sends SET state = 'SKIPPED', skip_reason = 'UNSUBSCRIBED' WHERE account_id = $1 AND state = 'QUEUED' AND NOT test RETURNING id`, [a.id]);
        st += s.length;
        if (codes.length) {
          w += codes.length;
          /* 처리 결과 알림(㊳ 수신 거부와 같은 종류 CONSENT_OPTOUT · 끌 수 없음) */
          await db.query(
            `INSERT INTO notifications (account_id, event_code, title, body, link_url) VALUES ($1, 'CONSENT_OPTOUT', '광고 수신 거부를 처리했습니다', $2, '/terms/agree')`,
            [a.id, `${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)} 080 수신 거부 전화로 소개뱅크 광고성 정보 수신 동의를 철회했습니다. 다시 받으시려면 약관 동의 화면에서 바꾸실 수 있습니다.`]).catch(() => undefined);
        }
      });
    }
    if (mine.length) matched++;
    withdrew += w; stopped += st;
    await db.query(
      `INSERT INTO mkx_optout080 (phone_hash, phone_last4, source, accounts, withdrew, stopped, created_by) VALUES ($1, $2, $3, $4::int, $5::int, $6::int, $7)`,
      [sha(phone), phone.slice(-4), source, mine.length, w, st, actor]);
  }
  await mkxAudit(db, 'MKX_OPTOUT080', 'CONSENT', { source, received: valid.length, invalid, matched, withdrew, stopped });
  return { ok: true, received: valid.length, invalid, matched, withdrew, stopped,
    note: `번호 ${valid.length}개 — 회원을 찾은 번호 ${matched}개 · 철회한 동의 ${withdrew}건 · 멈춘 대기 문자 ${stopped}통(못 읽은 줄 ${invalid}).` };
}

/** 대행사 웹훅 — 켜짐 · 토큰 지문 대조 뒤 같은 처리(응답에 개인정보 없음) */
export async function optout080Hook(db: DatabaseService, token: string | undefined, phones: string[]) {
  const s = await smsMkxSettings(db);
  if (!s.hook) throw new Forbidden('MKX_OPTOUT_HOOK_OFF', '080 수신 거부 웹훅 받기가 꺼져 있습니다(mkx.optout080_hook).');
  const given = String(token ?? '').trim();
  if (!s.tokenSet || !OPTOUT_TOKEN_RE.test(given)) throw new Forbidden('MKX_OPTOUT_TOKEN', '웹훅 토큰이 맞지 않습니다.');
  const a = Buffer.from(sha(given), 'hex'), b = Buffer.from(s.tokenHash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Forbidden('MKX_OPTOUT_TOKEN', '웹훅 토큰이 맞지 않습니다.');
  if (!Array.isArray(phones) || phones.length < 1 || phones.length > MAX_PHONES) throw new PolicyViolation('MKX_OPTOUT_EMPTY', '번호는 1 ~ 1,000개입니다.');
  const r = await applyOptout080(db, phones, 'HOOK', null);
  return { ok: true, received: r.received, matched: r.matched, withdrew: r.withdrew, invalid: r.invalid };
}

/** SUPER — 새 웹훅 토큰(원문은 이 응답에 한 번만 · DB 에는 지문만) */
export async function rotateOptoutToken(db: DatabaseService, reasonIn: string) {
  const reason = cleanReason(reasonIn).slice(0, 200);
  if (reason.length < 2) throw new PolicyViolation('MKX_REASON', '사유는 2 ~ 200자입니다.');
  const token = randomBytes(32).toString('base64url');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    await db.query(`UPDATE site_settings SET value = $1, updated_by = $2, updated_at = now() WHERE key = 'mkx.optout080_token_hash'`, [sha(token), me]);
  });
  await mkxAudit(db, 'MKX_OPTOUT_TOKEN', 'SETTING', { key: 'mkx.optout080_token_hash', reason });
  return { ok: true, token, note: '새 토큰입니다 — 이 화면을 닫으면 다시 볼 수 없습니다. 080 대행사 웹훅 머리글 X-Optout-Token 에 넣으십시오.' };
}
