import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { maskName } from '../../common/mask';
import { LPX_DATE_RE, lpxLine, lpxSettings, lpxToday } from './common';

/* ---------------------------------------------------------------------
 * v10.551 (D286 · docs/689) 판매자 자리 비움 — 대표 11/21 「(56) ③ 판매자 자리 비움 모드」
 *
 *   회원(매물 주인)  시작 · 끝 날짜(한국 날짜 · 오늘부터 · lpx.away_max_days 일까지) · 한 줄 안내(200자 · 연락처 가림) · 하나만 살아 있음
 *                    바꾸기 = 지금 것을 CANCELLED 로 닫고 새 줄(같은 트랜잭션) · 끝내기 = CANCELLED
 *   표시             매물 상세(공개 GET /site/lpx/listings/{id})에 「M/D 까지 자리 비움 · 안내」 — 끝 날짜 지나면 저절로 안 보임
 *   자동 안내        자리 비움 중 내 매물에 ① 1:1 문의(conversations 첫 줄) ② 공개 질문(public_questions) ③ 가격 제안(이 모듈)
 *                    ④ 방문 예약(b284 vsx_bookings — 표가 있을 때만 트리거) 이 오면 보낸 회원에게 알림 한 번(LPX_AWAY_AUTO)
 *                    — 같은 자리 비움 · 같은 회원에게는 한 번만(lpx_away_notices) · 안내가 실패해도 문의는 그대로 들어감(DB 함수가 삼킴)
 *   끝나면           정기 작업 lpx_hourly 가 끝 날짜 지난 줄을 ENDED 로(스위치와 상관없이) — 표시 · 안내는 날짜로 바로 멈춤
 *   스위치           lpx.away(처음 off) — 꺼지면 새로 켜지 못하고(409 LPX_AWAY_OFF) 표시 · 자동 안내도 멈춤(fn_lpx_away_on 이 봄)
 * ------------------------------------------------------------------- */

export interface LpxAwayNow { id: string; startsOn: string; endsOn: string; message: string | null }

/** 지금 자리 비움인가(스위치 on · 오늘이 기간 안) — 없으면 null */
export async function awayNow(db: DatabaseService, accountId: string): Promise<LpxAwayNow | null> {
  const [r] = await db.query<LpxAwayNow>(
    `SELECT a.id::text AS id, a.starts_on::text AS "startsOn", a.ends_on::text AS "endsOn", a.message
       FROM lpx_away a WHERE a.id = fn_lpx_away_on($1::uuid)`, [accountId]);
  return r ?? null;
}

/** 자동 안내 한 번(가격 제안처럼 서버가 받는 길) — DB 함수 fn_lpx_away_autonotice(같은 자리 비움 · 같은 회원 한 번) */
export async function awayAutoNotice(db: DatabaseService, ownerId: string, visitorId: string, listingId: string, via: 'OFFER' | 'VISIT') {
  const [r] = await db.query<{ sent: boolean }>(`SELECT fn_lpx_away_autonotice($1::uuid, $2::uuid, $3::uuid, $4::text) AS sent`, [ownerId, visitorId, listingId, via])
    .catch(() => [{ sent: false }]);
  return !!r?.sent;
}

/** 나의공간 › 자리 비움 */
export async function myAway(db: DatabaseService, me: string) {
  const s = await lpxSettings(db);
  const live = await db.query<{ id: string; startsOn: string; endsOn: string; message: string | null; createdAt: string }>(
    `SELECT id::text AS id, starts_on::text AS "startsOn", ends_on::text AS "endsOn", message, created_at AS "createdAt"
       FROM lpx_away WHERE account_id = $1::uuid AND state = 'ACTIVE' LIMIT 1`, [me]);
  const recent = await db.query(
    `SELECT id::text AS id, starts_on::text AS "startsOn", ends_on::text AS "endsOn", state, ended_at AS "endedAt",
            (SELECT count(*)::int FROM lpx_away_notices n WHERE n.away_id = a.id) AS notices
       FROM lpx_away a WHERE account_id = $1::uuid AND state <> 'ACTIVE' ORDER BY id DESC LIMIT 10`, [me]);
  const now = await awayNow(db, me);
  const cur = live[0] ?? null;
  const [n] = cur ? await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM lpx_away_notices WHERE away_id = $1::bigint`, [cur.id]) : [{ n: 0 }];
  return { enabled: s.awayOn, maxDays: s.awayMaxDays, today: lpxToday(), current: cur ? { ...cur, showing: !!now, notices: Number(n?.n ?? 0) } : null, recent,
    note: '자리 비움 기간에는 매물 상세에 안내가 보이고, 문의 · 질문 · 가격 제안 · 방문 예약을 보낸 회원에게 한 번 알려 드립니다. 끝 날짜가 지나면 저절로 풀립니다.' };
}

/** 켜기 · 바꾸기 — 지금 것이 있으면 닫고 새로(같은 트랜잭션) */
export async function setAway(db: DatabaseService, me: string, d: { startsOn: string; endsOn: string; message?: string }) {
  const s = await lpxSettings(db);
  if (!s.awayOn) throw new StateConflict('LPX_AWAY_OFF', '자리 비움 기능이 꺼져 있습니다.');
  const a = String(d.startsOn ?? ''), b = String(d.endsOn ?? '');
  if (!LPX_DATE_RE.test(a) || !LPX_DATE_RE.test(b)) throw new PolicyViolation('LPX_AWAY_DATE', '날짜는 YYYY-MM-DD 입니다.');
  const today = lpxToday();
  if (a < today) throw new PolicyViolation('LPX_AWAY_DATE', '시작 날짜는 오늘부터입니다.');
  if (b < a) throw new PolicyViolation('LPX_AWAY_DATE', '끝 날짜가 시작 날짜보다 앞입니다.');
  const days = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3) + 1;
  if (days > s.awayMaxDays) throw new PolicyViolation('LPX_AWAY_LONG', `자리 비움은 한 번에 ${s.awayMaxDays}일까지입니다.`);
  const message = lpxLine(d.message);
  const row = await db.transaction(async () => {
    await db.query(`UPDATE lpx_away SET state = 'CANCELLED', ended_at = now() WHERE account_id = $1::uuid AND state = 'ACTIVE'`, [me]);
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO lpx_away (account_id, starts_on, ends_on, message) VALUES ($1::uuid, $2::date, $3::date, $4) RETURNING id::text AS id`, [me, a, b, message]);
    return r;
  }).catch((e: unknown) => {
    const m = /^(LPX_[A-Z_]+):\s*(.*)$/.exec(String((e as { message?: string })?.message ?? ''));
    if (m) throw new PolicyViolation(m[1]!, m[2]!);
    throw e;
  });
  return { ok: true, id: row!.id, startsOn: a, endsOn: b, message, note: a === today ? `오늘부터 ${b} 까지 자리 비움으로 보입니다.` : `${a} 부터 ${b} 까지 자리 비움으로 보입니다.` };
}

/** 끝내기 — 지금 것을 닫음 */
export async function endAway(db: DatabaseService, me: string) {
  const r = await db.query(`UPDATE lpx_away SET state = 'CANCELLED', ended_at = now() WHERE account_id = $1::uuid AND state = 'ACTIVE' RETURNING id`, [me]);
  if (!r.length) throw new StateConflict('LPX_AWAY_NONE', '켜 둔 자리 비움이 없습니다.');
  return { ok: true, note: '자리 비움을 끝냈습니다 — 매물 상세 안내가 바로 사라집니다.' };
}

/** 정기 작업 — 끝 날짜 지난 줄을 ENDED 로(스위치와 상관없이) */
export async function awayEndJob(db: DatabaseService) {
  const r = await db.query(
    `UPDATE lpx_away SET state = 'ENDED', ended_at = now() WHERE state = 'ACTIVE' AND ends_on < (now() AT TIME ZONE 'Asia/Seoul')::date RETURNING id`);
  return { ended: r.length };
}

/* ── 운영 화면 › 검수 › 판매자 자리 비움 ── */
export async function adminAway(db: DatabaseService) {
  const settings = await lpxSettings(db);
  const [sum] = await db.query(
    `SELECT count(*) FILTER (WHERE state = 'ACTIVE')::int AS active,
            count(*) FILTER (WHERE state = 'ACTIVE' AND starts_on <= (now() AT TIME ZONE 'Asia/Seoul')::date AND ends_on >= (now() AT TIME ZONE 'Asia/Seoul')::date)::int AS showing,
            count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS made30,
            (SELECT count(*)::int FROM lpx_away_notices WHERE created_at > now() - interval '30 days') AS notices30
       FROM lpx_away`);
  const via = await db.query(`SELECT via, count(*)::int AS n FROM lpx_away_notices WHERE created_at > now() - interval '30 days' GROUP BY via ORDER BY via`);
  const rows = await db.query<Record<string, unknown> & { name: string | null }>(
    `SELECT a.id::text AS id, a.starts_on::text AS "startsOn", a.ends_on::text AS "endsOn", a.state, a.created_at AS "createdAt", c.name,
            (SELECT count(*)::int FROM listings l WHERE l.owner_account_id = a.account_id AND l.status = 'PUBLISHED') AS listings,
            (SELECT count(*)::int FROM lpx_away_notices n WHERE n.away_id = a.id) AS notices
       FROM lpx_away a JOIN accounts c ON c.id = a.account_id ORDER BY a.id DESC LIMIT 100`);
  return { settings, summary: sum ?? {}, via30: via, recent: rows.map(({ name, ...r }) => ({ ...r, owner: maskName(name) ?? '회원' })),
    note: '안내 글은 회원이 씁니다(연락처는 가려서 저장) — 운영은 숫자 · 기간만 봅니다.' };
}
