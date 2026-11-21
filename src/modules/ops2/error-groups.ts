import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';

/* ---------------------------------------------------------------------
 * v10.587 (docs/729) 14차 운영 ③ 서버 오류 묶기 — 기존 「서버 오류 30일 기록」(D204) 위에
 *
 *   묶음 줄(ops2_error_groups)은 DB 트리거가 채움(정기 작업 launch_watch 가 10분마다 ops_server_error_days 에 더할 때) — 서버 코드 안 고침.
 *   여기는 운영 화면 위험감지 › 서버 오류 아래 「오류 묶음」 상자가 부르는 읽기 · 상태 바꾸기만.
 *   상태: OPEN(새로 · 다시 남) → ACK(확인함) · MUTED(알리지 않음 · 메모 꼭) · FIXED(고침 — 다시 나면 OPEN 으로 돌고 SERVER_ERROR_REOPEN)
 * ------------------------------------------------------------------- */

/** = DB CHECK ops2_error_groups.fp */
export const OPS2_FP_RE = /^[0-9a-f]{32}$/;
export const OPS2_ERROR_STATES = ['OPEN', 'ACK', 'MUTED', 'FIXED'] as const;
const DAYS = [1, 7, 30, 90, 365];

/** GET /admin/ops2/error-groups?state=&days= — 묶음 100줄(열린 것 먼저 · 최근 순) · 상태별 수 · 최근 7일 건수(30일 기록에서) */
export async function ops2ErrorGroups(db: DatabaseService, state?: string, daysIn?: string) {
  const st = state && (OPS2_ERROR_STATES as readonly string[]).includes(state) ? state : null;
  const days = DAYS.includes(Number(daysIn)) ? Number(daysIn) : 30;
  const rows = await db.query(
    `SELECT g.fp, g.method, g.path, g.code, g.status, g.pg_code AS "pgCode", g.sample_detail AS detail, g.last_request_id AS "requestId",
            g.first_at AS "firstAt", g.last_at AS "lastAt", g.total_n::int AS total, g.days_seen AS "daysSeen", g.state, g.state_note AS "stateNote",
            g.state_at AS "stateAt", g.reopened_n AS "reopened", g.alerted_at AS "alertedAt", g.alert_skipped AS "alertSkipped", g.backfilled,
            coalesce((SELECT sum(e.n)::int FROM ops_server_error_days e
                       WHERE e.method = g.method AND e.path = g.path AND e.code = g.code AND e.status = g.status
                         AND e.day > (now() AT TIME ZONE 'Asia/Seoul')::date - 7), 0) AS week
       FROM ops2_error_groups g
      WHERE g.last_at > now() - make_interval(days => $1::int) AND ($2::text IS NULL OR g.state = $2::text)
      ORDER BY (g.state = 'OPEN') DESC, g.last_at DESC LIMIT 100`, [days, st]);
  const counts = await db.query<{ state: string; n: number }>(
    `SELECT state, count(*)::int AS n FROM ops2_error_groups WHERE last_at > now() - make_interval(days => $1::int) GROUP BY state`, [days]);
  const [sw] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'ops2.error_new_alert'`);
  return {
    rows, days, state: st, counts: Object.fromEntries(OPS2_ERROR_STATES.map((s) => [s, counts.find((c) => c.state === s)?.n ?? 0])),
    alertOn: (sw?.v ?? 'on') === 'on',
    note: '지문 = 방법 · 주소 · 오류 종류 · 응답 번호 · DB 오류 번호. 처음 보는 오류 · 「고침」으로 둔 오류가 다시 나면 운영 알림(한 시간 10건까지). 요청 내용 · 개인정보는 없습니다.',
  };
}

/** POST /admin/ops2/error-groups/{fp}/state — 상태 바꾸기(ADMIN · SUPER) · 같은 상태면 409 · 알리지 않음은 메모 꼭 */
export async function ops2ErrorGroupState(db: DatabaseService, fp: string, state: string, noteIn?: string) {
  if (!OPS2_FP_RE.test(fp)) throw new NotFound('오류 묶음이 없습니다.');
  if (!(OPS2_ERROR_STATES as readonly string[]).includes(state)) throw new PolicyViolation('OPS2_ERROR_STATE', '상태는 OPEN · ACK · MUTED · FIXED 중 하나입니다.');
  const note = String(noteIn ?? '').trim().slice(0, 200);
  if (state === 'MUTED' && note.length < 2) throw new PolicyViolation('OPS2_ERROR_NOTE', '알리지 않음으로 둘 때는 까닭을 2자 이상 적어 주십시오.');
  const [cur] = await db.query<{ state: string }>(`SELECT state FROM ops2_error_groups WHERE fp = $1`, [fp]);
  if (!cur) throw new NotFound('오류 묶음이 없습니다.');
  if (cur.state === state) throw new StateConflict('OPS2_ERROR_SAME', '이미 그 상태입니다.');
  const [r] = await db.query<{ fp: string }>(
    `UPDATE ops2_error_groups SET state = $2, state_note = $3, state_by = $4, state_at = clock_timestamp()
      WHERE fp = $1 AND state = $5 RETURNING fp`, [fp, state, note || null, RequestCtx.actorId() ?? null, cur.state]);
  if (!r) throw new StateConflict('OPS2_ERROR_CHANGED', '그 사이 상태가 바뀌었습니다 — 새로 보기 뒤 다시 하십시오.');
  return { ok: true, fp, state, before: cur.state };
}
