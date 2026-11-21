import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { grwSettings, num } from './common';
import { stepPurge } from './funnel';

/* ---------------------------------------------------------------------
 * v10.599 (docs/741) ⑮ 알림 하루 요약 받기 — 회원 설정(나의공간 › 알림) · grw.digest(처음 off)
 *   이미 있는 것을 넓힘: 회원 알림(notifications · fn_notify · 알림 종류 정책 · 회원 수신 설정 D063) · 알림 메일 보내기(notify_dispatch · NotifyMailSender)
 *   ① 회원이 「하루 요약 받기」를 켜면(grw_digest_prefs) — 매일 08:00(정기 작업 grw_daily) 지난 24시간 알림을 한 통으로(GRW_DIGEST · 사이트 알림)
 *      · 사이트 알림 목록은 그대로 하나하나 남음(지우지 않음) · 요약은 하루 한 번(grw_digest_sends 고유) · 알림이 없으면 보내지 않음
 *   ② 메일이 준비되면(v_notify_channels EMAIL ready) — 끌 수 있는 알림(optout_allowed)의 메일 한 통 한 통은 대기열에서 「DIGEST」로 닫고(trg_grw_digest_mail_hold)
 *      요약 알림(GRW_DIGEST)만 메일로 감 · 돈 · 계약처럼 끌 수 없는 알림은 그대로 바로 감
 *      **메일 준비 전(지금)에는 사이트 알림만** — 메일 대기열에 쌓이지 않음(기존 동작 그대로)
 *   ③ 스위치를 끄면 요약 · 메일 묶기가 모두 멈추고 전처럼 하나하나 감(회원 설정은 남김)
 * ------------------------------------------------------------------- */

/** GET /me/grw/digest — 쓸 수 있는지 · 내가 켰는지 · 메일 준비 여부 · 마지막 요약 */
export async function myDigest(db: DatabaseService, accountId: string) {
  const s = await grwSettings(db);
  const [r] = await db.query<{ enabled: boolean | null; ready: boolean; last: string | null }>(
    `SELECT (SELECT enabled FROM grw_digest_prefs WHERE account_id = $1::uuid) AS enabled,
            coalesce((SELECT ready FROM v_notify_channels WHERE channel = 'EMAIL'), false) AS ready,
            (SELECT to_char(max(sent_on), 'YYYY-MM-DD') FROM grw_digest_sends WHERE account_id = $1::uuid) AS last`, [accountId]);
  return { available: s.digest, enabled: !!r?.enabled, emailReady: !!r?.ready, lastSent: r?.last ?? null, hour: 8 };
}

/** PUT /me/grw/digest { enabled } — 켜기 · 끄기(본인) · 스위치가 꺼져 있으면 켤 수 없음(끄기는 늘 됨) */
export async function setMyDigest(db: DatabaseService, accountId: string, enabled: boolean) {
  const s = await grwSettings(db);
  if (enabled && !s.digest) throw new PolicyViolation('GRW_DIGEST_OFF', '지금은 알림 하루 요약을 쓰지 않는 중입니다.');
  await db.query(
    `INSERT INTO grw_digest_prefs (account_id, enabled) VALUES ($1::uuid, $2::boolean)
     ON CONFLICT (account_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`, [accountId, enabled]);
  return { ok: true, enabled, note: enabled ? '알림을 하루 한 번(아침 8시) 묶어 보내 드립니다. 돈 · 계약 알림은 바로 갑니다.' : '알림을 전처럼 하나하나 보내 드립니다.' };
}

const clip = (s: string | null | undefined, n: number) => { const t = [...String(s ?? '').replace(/\s+/g, ' ').trim()]; return t.length > n ? t.slice(0, n - 1).join('') + '…' : t.join(''); };

/** 정기 작업 grw_daily(매일 08:00) — 하루 요약 보내기 · 오래된 단계 수 · 요약 기록 지우기 */
export async function grwDailyJob(db: DatabaseService) {
  const purge = await stepPurge(db);
  const old = await db.query(`DELETE FROM grw_digest_sends WHERE sent_on < (now() AT TIME ZONE 'Asia/Seoul')::date - 400 RETURNING id`);
  const s = await grwSettings(db);
  if (!s.digest) return { skipped: 'off', members: 0, items: 0, purge, sendsPurged: old.length };
  const rows = await db.query<{ account_id: string; n: number; titles: string[] }>(
    `SELECT g.account_id::text AS account_id, count(n.id)::int AS n,
            (array_agg(coalesce(n.title, left(n.body, 40)) ORDER BY n.created_at DESC))[1:5] AS titles
       FROM grw_digest_prefs g
       JOIN accounts a ON a.id = g.account_id AND a.status = 'ACTIVE' AND a.withdrawn_at IS NULL
       JOIN notifications n ON n.account_id = g.account_id AND n.event_code <> 'GRW_DIGEST'
                           AND n.created_at > now() - interval '24 hours'
      WHERE g.enabled
      GROUP BY g.account_id
      LIMIT 20000`);
  let members = 0, items = 0;
  for (const r of rows) {
    const sent = await db.transaction(async () => {
      const ins = await db.query(
        `INSERT INTO grw_digest_sends (account_id, sent_on, items) VALUES ($1::uuid, (now() AT TIME ZONE 'Asia/Seoul')::date, $2::int)
         ON CONFLICT (account_id, sent_on) DO NOTHING RETURNING id`, [r.account_id, num(r.n)]);
      if (!ins.length) return false;   // 오늘 이미 보냄
      const lines = (r.titles ?? []).map((t) => `· ${clip(t, 40)}`).join('\n') + (num(r.n) > 5 ? `\n외 ${num(r.n) - 5}건` : '');
      await db.query(`SELECT fn_notify($1::uuid, 'GRW_DIGEST', $2::jsonb, '/my/notifications')`, [r.account_id, JSON.stringify({ count: String(num(r.n)), lines })]);
      return true;
    });
    if (sent) { members++; items += num(r.n); }
  }
  return { members, items, candidates: rows.length, purge, sendsPurged: old.length };
}

/** GET /admin/grw/digest — 켠 회원 수 · 최근 7일 요약 · 묶어 닫은 메일 수(숫자만) */
export async function digestStats(db: DatabaseService) {
  const s = await grwSettings(db);
  const [c] = await db.query<Record<string, number>>(
    `SELECT (SELECT count(*)::int FROM grw_digest_prefs WHERE enabled) AS members,
            (SELECT count(*)::int FROM grw_digest_sends WHERE sent_on > (now() AT TIME ZONE 'Asia/Seoul')::date - 7) AS sends7,
            (SELECT coalesce(sum(items), 0)::int FROM grw_digest_sends WHERE sent_on > (now() AT TIME ZONE 'Asia/Seoul')::date - 7) AS items7,
            (SELECT count(*)::int FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id
              WHERE d.channel = 'EMAIL' AND d.failed_reason LIKE 'DIGEST:%' AND n.created_at > now() - interval '7 days') AS held7,
            coalesce((SELECT ready FROM v_notify_channels WHERE channel = 'EMAIL'), false)::int AS "emailReady"`);
  const daily = await db.query(
    `SELECT to_char(sent_on, 'YYYY-MM-DD') AS day, count(*)::int AS sends, sum(items)::int AS items
       FROM grw_digest_sends WHERE sent_on > (now() AT TIME ZONE 'Asia/Seoul')::date - 14 GROUP BY sent_on ORDER BY sent_on`);
  return {
    settings: { digest: s.digest }, members: num(c?.members), sends7: num(c?.sends7), items7: num(c?.items7), held7: num(c?.held7),
    emailReady: num(c?.emailReady) === 1, daily, job: '매일 08:00(grw_daily)',
    note: '메일 준비 전에는 사이트 알림만 갑니다. 메일이 준비되면 하루 요약을 켠 회원의 「끌 수 있는 알림」 메일은 요약 한 통으로 묶입니다(돈 · 계약 알림은 바로).',
  };
}
