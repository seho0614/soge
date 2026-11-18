import { DatabaseService } from '../../db/database.service';
import { MailService } from '../../common/mail/mail.service';

/* ---------------------------------------------------------------------
 * v10.378 · 379 (D241 · docs/514 · 515) 회원에게 미리 알리는 정기 작업 둘
 *   withdrawGraceMail   withdraw_grace_mail(매시간) — 탈퇴 유예가 끝나기 하루 전 「오늘까지 취소 가능」 메일 한 번
 *   maintNotice         maint_notice(10분마다)     — 사이트 점검 시작 24시간 안이 되면 쓰는 회원 모두에게 사이트 알림 한 번
 * ------------------------------------------------------------------- */

/**
 * 탈퇴 유예 끝 전날 메일 — 유예(member.withdraw_grace_days)가 2일 이상일 때만.
 *   대상: 탈퇴 · 파기 전 · 취소 안 함 · 아직 안 보냄 · 유예 끝까지 1일 ~ 1시간 남음 · 반송 · 수신 거부 주소 아님.
 *   메일이 준비되지 않았으면 표시하지 않고 다음 차례에 다시 봄(유예 끝 1시간 전까지).
 *   탈퇴한 회원은 사이트 알림을 볼 수 없어 메일만 · 회원이 끈 알림 메일과 상관없이 보냄(계정 처리 안내).
 */
export async function withdrawGraceMail(db: DatabaseService, mail: MailService) {
  const [g] = await db.query<{ d: number; base: string | null }>(
    `SELECT fn_setting_int('member.withdraw_grace_days', 0) AS d, (SELECT value FROM site_settings WHERE key = 'site.base_url') AS base`);
  const days = Number(g?.d ?? 0);
  if (days < 2) return { days, due: 0, mailed: 0, failed: 0, reason: 'GRACE_OFF' };
  const due = await db.query<{ id: string; email: string; until: string }>(
    `SELECT a.id::text AS id, a.email::text AS email,
            to_char((a.withdrawn_at + make_interval(days => $1::int)) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS until
       FROM accounts a JOIN account_withdrawals w ON w.account_id = a.id
      WHERE a.status = 'WITHDRAWN' AND a.withdrawn_at IS NOT NULL AND a.purged_at IS NULL AND a.email IS NOT NULL
        AND w.canceled_at IS NULL AND w.grace_mailed_at IS NULL
        AND now() >= a.withdrawn_at + make_interval(days => $1::int) - interval '1 day'
        AND now() <  a.withdrawn_at + make_interval(days => $1::int) - interval '1 hour'
        AND NOT EXISTS (SELECT 1 FROM mail_suppressions s WHERE s.email = a.email AND s.released_at IS NULL)
      ORDER BY a.withdrawn_at LIMIT 100`, [days]);
  if (!due.length) return { days, due: 0, mailed: 0, failed: 0, reason: null };
  if (!(await mail.ready())) return { days, due: due.length, mailed: 0, failed: 0, reason: 'MAIL_NOT_READY' };
  const base = (g?.base ?? '').replace(/\/+$/, '') || 'https://sogaebank.com';
  let mailed = 0, failed = 0;
  for (const d of due) {
    const text = [
      '소개뱅크 회원 탈퇴를 취소할 수 있는 기간이 곧 끝납니다.',
      '',
      `· 취소할 수 있는 때: ${d.until}(한국 시각)까지`,
      '· 그 뒤에는 탈퇴가 확정되고, 법령에 따라 보관하는 정보 밖의 회원 정보는 파기됩니다.',
      '',
      `마음이 바뀌셨다면 그 전에 로그인 화면(${base}/login)에서 이메일 · 비밀번호를 넣고 「탈퇴 취소」를 누르십시오.`,
      '직접 탈퇴하지 않으셨다면 고객센터로 알려 주십시오.',
      '',
      '이 메일은 탈퇴 유예 안내로 한 번만 보냅니다.',
    ].join('\n');
    const r = await mail.send({ to: d.email, subject: `[소개뱅크] 탈퇴 취소는 ${d.until} 까지입니다`, text }).catch(() => ({ ok: false }));
    if (r.ok) {
      await db.query(`UPDATE account_withdrawals SET grace_mailed_at = now() WHERE account_id = $1::uuid AND grace_mailed_at IS NULL`, [d.id]);
      mailed++;
    } else failed++;
  }
  return { days, due: due.length, mailed, failed, reason: null };
}

/**
 * 점검 예정 회원 알림 — site.maintenance_from 이 지금부터 24시간 안(아직 시작 전)이고 그 시각으로 보낸 적이 없으면
 *   쓰는(ACTIVE) 회원 모두에게 사이트 알림 SITE_MAINTENANCE 한 번 · maintenance_notices 에 한 줄.
 *   문자는 보내지 않고, 메일은 site.maintenance_mail = on 일 때만(회원이 끈 사람 · 반송 주소는 메일 보내기에서 빠짐).
 *   보내지 않을 길은 발송 줄을 「FAILED · SKIPPED: …」로 미리 닫음(대기열 · 사흘 경보에 걸리지 않게).
 */
export async function maintNotice(db: DatabaseService) {
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(241379)`);
    const [m] = await db.query<{ f: string | null; u: string | null; fk: string | null; uk: string | null; note: string | null; mail: string | null; due: boolean; sent: boolean }>(
      `WITH v AS (SELECT nullif((SELECT value FROM site_settings WHERE key = 'site.maintenance_from'), '')::timestamptz AS f,
                         nullif((SELECT value FROM site_settings WHERE key = 'site.maintenance_until'), '')::timestamptz AS u)
       SELECT f::text AS f, u::text AS u,
              to_char(f AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS fk, to_char(u AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS uk,
              (SELECT value FROM site_settings WHERE key = 'site.maintenance_note') AS note,
              (SELECT value FROM site_settings WHERE key = 'site.maintenance_mail') AS mail,
              coalesce(now() >= f - interval '24 hours' AND now() < f AND u > f, false) AS due,
              EXISTS (SELECT 1 FROM maintenance_notices n WHERE n.from_at = v.f) AS sent
         FROM v`);
    if (!m?.f || !m.due) return { due: false, sent: 0 };
    if (m.sent) return { due: true, already: true, sent: 0 };
    const mailOn = (m.mail ?? 'off') === 'on';
    const body = `${m.fk} ~ ${m.uk}(한국 시각) 사이트 점검으로 소개뱅크를 잠시 쓸 수 없습니다.${m.note ? ` ${m.note}` : ''} 점검 중에는 모든 화면에 안내가 보이고, 끝나면 그대로 다시 쓰실 수 있습니다.`;
    const [r] = await db.query<{ n: number }>(
      `WITH ins AS (
         INSERT INTO notifications (account_id, event_code, title, body, link_url)
         SELECT a.id, 'SITE_MAINTENANCE', '사이트 점검 안내', $1, '/'
           FROM accounts a WHERE a.status = 'ACTIVE' AND a.withdrawn_at IS NULL
         RETURNING id),
       skip AS (
         INSERT INTO notification_deliveries (notification_id, channel, status, failed_reason, idempotency_key)
         SELECT ins.id, c.ch, 'FAILED', c.why, ins.id::text || ':' || c.ch
           FROM ins CROSS JOIN (VALUES ('SMS', 'SKIPPED: 점검 안내는 문자로 보내지 않음'),
                                       ('EMAIL', 'SKIPPED: 점검 안내 메일 꺼짐(site.maintenance_mail)')) AS c(ch, why)
          WHERE c.ch = 'SMS' OR NOT $2::boolean
         ON CONFLICT DO NOTHING)
       SELECT count(*)::int AS n FROM ins`, [body, mailOn]);
    const sent = Number(r?.n ?? 0);
    await db.query(`INSERT INTO maintenance_notices (from_at, until_at, sent, mailed) VALUES ($1::timestamptz, $2::timestamptz, $3, $4)`, [m.f, m.u, sent, mailOn]);
    return { due: true, sent, mailed: mailOn };
  });
}
