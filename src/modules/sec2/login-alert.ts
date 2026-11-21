/* ---------------------------------------------------------------------
 * v10.593 (docs/735) ⑨ 회원 낯선 로그인 알림 넓힘 — 기존 LOGIN_NEW_DEVICE(D191 · v10.221) + 내 로그인 기기(D241 · v10.380) 재사용
 *
 *   지금: 90일 안 없던 (IP 앞 두 마디 + 브라우저 종류)면 사이트 알림 LOGIN_NEW_DEVICE(메일은 알림 보내기 길 그대로 · 끄기 안 됨).
 *   더하는 것:
 *     ① 그 알림 한 건 = sec2_login_alerts 한 줄(그 로그인의 기기 번호 login_sessions.id) · 알림 링크를 그 줄로(/my/account/security?alert=번호)
 *     ② 회원이 「나였어요」 · 「내가 아니에요」 — 아니면 그 기기를 바로 로그아웃(기기별 로그아웃과 같음) · 비밀번호 바꾸기 안내 · 감사 LOGIN_NOT_ME
 *     ③ 1시간 안 「내가 아니에요」가 sec2.not_me_surge 이상이면 운영 알림 MEMBER_NOT_ME_SURGE(대량 도용 징후 · 1시간 한 번)
 *   새로 모으는 정보 없음(로그인 기록과 같은 가린 값). 실패해도 로그인은 그대로.
 * ------------------------------------------------------------------- */
import * as jwt from 'jsonwebtoken';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { maskIp, uaKind } from '../identity/login-history';
import { Sec2Db, sec2Audit, sec2Settings } from './common';

/**
 * 로그인 증표를 만든 뒤 부름(AuthService.login · 회원 2단계 로그인 · 간편 로그인) — 낯선 기기였으면 한 줄 + 알림 링크를 그 줄로.
 *   증표(accessToken)에서 기기 번호(sid)만 읽음(방금 만든 증표라 검증 없이 decode). 증표는 그대로 돌려줌.
 */
export async function sec2LoginAlert<T extends { accessToken: string }>(db: Sec2Db, accountId: string, wasNew: boolean, tokens: T): Promise<T> {
  if (!wasNew) return tokens;
  try {
    const p = jwt.decode(tokens.accessToken) as { sid?: string } | null;
    const sid = p?.sid && /^[0-9a-f-]{36}$/.test(p.sid) ? p.sid : null;
    const c = RequestCtx.get();
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO sec2_login_alerts (account_id, session_id, ip_masked, ua_kind) VALUES ($1, $2::uuid, $3, $4) RETURNING id::text AS id`,
      [accountId, sid, maskIp(c?.clientIp ?? c?.ip), uaKind(c?.userAgent)]);
    if (r) {
      await db.query(
        `UPDATE notifications SET link_url = $2
          WHERE id = (SELECT id FROM notifications WHERE account_id = $1 AND event_code = 'LOGIN_NEW_DEVICE' AND created_at > now() - interval '2 minutes'
                       ORDER BY created_at DESC LIMIT 1)`,
        [accountId, `/my/account/security?alert=${r.id}`]);
    }
  } catch { /* 알림 줄을 남기지 못해도 로그인은 그대로 */ }
  return tokens;
}

/** GET /me/login-alerts — 최근 30일(답 안 한 것 먼저) */
export async function sec2MyLoginAlerts(db: Sec2Db) {
  const me = RequestCtx.actorId();
  if (!me) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
  const cur = RequestCtx.get()?.sid ?? '';
  const items = await db.query(
    `SELECT x.id::text AS id, x.created_at AS "createdAt", x.ip_masked AS "ipMasked", x.ua_kind AS "uaKind", x.answer, x.answered_at AS "answeredAt",
            (x.session_id::text = $2) AS current,
            (s.id IS NOT NULL AND s.revoked_at IS NULL AND s.tv = a.token_version) AS "sessionAlive"
       FROM sec2_login_alerts x JOIN accounts a ON a.id = x.account_id
       LEFT JOIN login_sessions s ON s.id = x.session_id
      WHERE x.account_id = $1 AND x.created_at > now() - interval '30 days'
      ORDER BY (x.answer IS NULL) DESC, x.created_at DESC LIMIT 20`, [me, cur]);
  return { items, open: items.filter((r: any) => !r.answer).length };
}

/** POST /me/login-alerts/{id}/answer — ME · NOT_ME(그 기기 로그아웃 · 지금 이 기기면 로그아웃하지 않음) · 한 번 */
export async function sec2AnswerLoginAlert(db: Sec2Db, id: string, answer: string) {
  const me = RequestCtx.actorId();
  if (!me) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
  if (answer !== 'ME' && answer !== 'NOT_ME') throw new PolicyViolation('SEC2_ANSWER', 'ME 또는 NOT_ME 입니다.');
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('그 알림이 없습니다.');
  const [x] = await db.query<{ session_id: string | null; answer: string | null }>(
    `SELECT session_id::text AS session_id, answer FROM sec2_login_alerts WHERE id = $1::bigint AND account_id = $2`, [id, me]);
  if (!x) throw new NotFound('그 알림이 없습니다.');
  if (x.answer) throw new StateConflict('SEC2_ANSWERED', '이미 답한 알림입니다.');
  const cur = RequestCtx.get()?.sid ?? null;
  let revoked = false;
  if (answer === 'NOT_ME' && x.session_id && x.session_id !== cur) {
    const r = await db.query(`UPDATE login_sessions SET revoked_at = now() WHERE id = $1::uuid AND account_id = $2 AND revoked_at IS NULL RETURNING id`, [x.session_id, me]);
    revoked = r.length > 0;
  }
  const u = await db.query(`UPDATE sec2_login_alerts SET answer = $2, answered_at = now() WHERE id = $1::bigint AND answer IS NULL RETURNING id`, [id, answer]);
  if (!u.length) throw new StateConflict('SEC2_ANSWERED', '이미 답한 알림입니다.');
  if (answer === 'NOT_ME') await sec2Audit(db, 'LOGIN_NOT_ME', 'ACCOUNT', me, { alertId: id, revoked });
  return {
    ok: true, answer, revoked,
    note: answer === 'ME' ? '확인했습니다.'
      : revoked ? '그 기기를 로그아웃했습니다. 비밀번호를 바로 바꾸고, 2단계 인증을 켜 두십시오.'
      : x.session_id && x.session_id === cur ? '지금 쓰는 이 기기라 로그아웃하지 않았습니다. 비밀번호를 바로 바꾸고, 2단계 인증을 켜 두십시오.'
      : '비밀번호를 바로 바꾸고, 2단계 인증을 켜 두십시오.',
    next: answer === 'NOT_ME' ? '/my/account' : null,
  };
}

/** 정기 작업(sec2_tick) — 1시간 안 「내가 아니에요」 몰림 → 운영 알림(1시간 한 번 · 0 이면 끔) */
export async function sec2NotMeSurge(db: Sec2Db) {
  const s = await sec2Settings(db);
  if (s.notMeSurge <= 0) return { skipped: 'OFF' as const, n: 0 };
  const [r] = await db.query<{ n: number; recent: boolean }>(
    `SELECT (SELECT count(*)::int FROM sec2_login_alerts WHERE answer = 'NOT_ME' AND answered_at > now() - interval '1 hour') AS n,
            EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'MEMBER_NOT_ME_SURGE' AND raised_at > now() - interval '1 hour') AS recent`);
  const n = Number(r?.n ?? 0);
  if (n < s.notMeSurge || r?.recent) return { skipped: r?.recent ? 'RECENT' as const : 'UNDER' as const, n };
  await db.query(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
     VALUES ('MEMBER_NOT_ME_SURGE', 'WARN', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
    [`회원 「내가 아니에요」 1시간 ${n}건 — 비밀번호 대량 도용 징후 · 로그인 실패 · 가입 차단 · 이상 행동 감지 화면 확인`, JSON.stringify({ n, threshold: s.notMeSurge })]).catch(() => undefined);
  return { skipped: null, n };
}
