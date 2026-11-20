import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.518 (D277 · docs/656) 기간 한정 추천 이벤트
 *   직접 추천 1단계 보상(REFERRAL_DIRECT · D189 · D190)의 **점수만** 기간 동안 바꿈 — 여러 단계 보상 없음(partner-affiliate 결정 · fn_referral_reward 가 직접 추천한 한 사람에게만).
 *   예산(이벤트로 줄 점수 합) 상한 · 한 건을 못 덮으면 그 건은 평소 점수로 주고 이벤트를 일찍 끝냄(BUDGET) · 기간이 끝나면 평소 점수(PERIOD · 정기 작업 prx_hourly).
 *   규칙 표(point_rules)는 고치지 않음 — 끝나면 「원래 값으로 되돌리기」가 따로 필요 없음. 이미 준 보상은 그대로.
 *   대표 11/20 「관리자가 이벤트 시행 전 확인 후 등록」:
 *     · 등록 · 고치기 · 시행 전 확인 칸 채우기 = ADMIN · SUPER / 시작 · 끝내기 · 스위치 = SUPER(본인이 등록한 것도 시작 가능 — SUPER 한 명 운영 현실)
 *     · 시행 전 확인 = 약관 확인(예/아니오) · 안내 문구 확인(예/아니오) · 확인한 곳(법무 · 내부 …) · 확인 날짜 · 메모 — 둘 다 예가 아니면 DB 가 ACTIVE 를 막음
 *     · 모두 감사 기록(컨트롤러 @Audit)
 *   스위치 prx.ref_event(처음 off) — off 면 진행 중 이벤트가 있어도 평소 점수(fn_referral_reward 가 봄).
 * ------------------------------------------------------------------- */

/** 안내 문구 처음 틀 — {from} {until} {points} {base} {budget} 을 채워 보여 줌(운영자가 고침) */
export const REF_EVENT_NOTICE_DEFAULT =
  '[추천 이벤트] {from} ~ {until} 동안 내가 추천한 분이 처음 본인인증을 마치면 추천한 분께 {points}포인트를 드립니다(평소 {base}포인트).\n' +
  '· 내가 직접 추천한 분 한 분마다 한 번만 드립니다(추천받은 분이 다시 추천한 분은 해당하지 않습니다 — 1단계만).\n' +
  '· 지급 시점: 추천받은 분이 이벤트 기간 안에 처음 본인인증을 마친 때.\n' +
  '· 이벤트 예산 {budget}포인트가 모두 쓰이면 기간 전이라도 일찍 끝나며, 그 뒤에는 평소 포인트를 드립니다.\n' +
  '· 이미 받은 보상은 이벤트가 끝나도 그대로입니다. 한 달 받을 수 있는 횟수 제한은 평소와 같습니다.';

export interface RefEventInput { title: string; startsAt: string; endsAt: string; points: number; budget: number; noticeText?: string }
export interface RefEventCheckInput { terms: boolean; notice: boolean; by: string; on: string; memo?: string }

const kst = (d: string | Date) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const won = (x: number) => Math.round(x).toLocaleString('ko-KR');

export function fillNotice(t: string, ev: { startsAt: string | Date; endsAt: string | Date; points: number; budget: number }, base: number) {
  const m: Record<string, string> = { from: kst(ev.startsAt), until: kst(ev.endsAt), points: won(ev.points), base: won(base), budget: won(ev.budget) };
  return t.replace(/\{(from|until|points|base|budget)\}/g, (_, k: string) => m[k] ?? '');
}

async function rule(db: DatabaseService) {
  const [r] = await db.query<{ is_on: boolean; points: number; cap: number | null; sw: string | null }>(
    `SELECT is_active AS is_on, points, monthly_cap AS cap, (SELECT value FROM site_settings WHERE key = 'prx.ref_event') AS sw
       FROM point_rules WHERE code = 'REFERRAL_DIRECT'`);
  return { ruleOn: !!r?.is_on, base: Number(r?.points ?? 0), cap: r?.cap ?? null, switchOn: r?.sw === 'on' };
}

function check(d: RefEventInput) {
  const title = String(d.title ?? '').trim();
  if (title.length < 2 || title.length > 80) throw new PolicyViolation('PRX_EVENT', '이벤트 이름은 2 ~ 80자입니다.');
  const s = new Date(d.startsAt), e = new Date(d.endsAt);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) throw new PolicyViolation('PRX_EVENT_PERIOD', '끝 시각은 시작 시각보다 뒤여야 합니다.');
  if (e.getTime() - s.getTime() > 92 * 86400e3) throw new PolicyViolation('PRX_EVENT_PERIOD', '이벤트 기간은 92일까지입니다.');
  if (!Number.isInteger(d.points) || d.points < 1 || d.points > 100000) throw new PolicyViolation('PRX_EVENT_POINTS', '이벤트 점수는 1 ~ 100,000 정수입니다.');
  if (!Number.isInteger(d.budget) || d.budget < d.points || d.budget > 100000000) throw new PolicyViolation('PRX_EVENT_BUDGET', '예산은 이벤트 점수 이상 · 1억 포인트 이하 정수입니다.');
  const notice = String(d.noticeText ?? '').trim() || REF_EVENT_NOTICE_DEFAULT;
  if (notice.length < 20 || notice.length > 2000) throw new PolicyViolation('PRX_EVENT', '안내 문구는 20 ~ 2,000자입니다.');
  return { title, s: s.toISOString(), e: e.toISOString(), notice };
}

async function one(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 추천 이벤트입니다.');
  const [ev] = await db.query<{ id: string; state: string; check_terms: boolean; check_notice: boolean; check_by: string | null; check_on: string | null; ends_at: string }>(
    `SELECT id::text AS id, state, check_terms, check_notice, check_by, check_on::text AS check_on, ends_at FROM prx_ref_events WHERE id = $1::bigint`, [id]);
  if (!ev) throw new NotFound('없는 추천 이벤트입니다.');
  return ev;
}

/** GET /admin/prx/ref-events */
export async function listRefEvents(db: DatabaseService) {
  const r = await rule(db);
  const items = await db.query<Record<string, any>>(
    `SELECT e.id::text AS id, e.title, e.starts_at AS "startsAt", e.ends_at AS "endsAt", e.points, e.budget, e.used, e.state, e.end_reason AS "endReason",
            e.notice_text AS "noticeText", e.check_terms AS "checkTerms", e.check_notice AS "checkNotice", e.check_by AS "checkBy", e.check_on::text AS "checkOn",
            e.check_memo AS "checkMemo", e.checked_at AS "checkedAt", e.created_at AS "createdAt", e.started_at AS "startedAt", e.ended_at AS "endedAt",
            (SELECT count(*)::int FROM prx_ref_event_uses u WHERE u.event_id = e.id) AS rewards,
            (e.state = 'ACTIVE' AND e.starts_at <= now() AND e.ends_at > now()) AS live
       FROM prx_ref_events e ORDER BY (e.state = 'ACTIVE') DESC, e.created_at DESC LIMIT 100`);
  for (const x of items) x.noticePreview = fillNotice(String(x.noticeText ?? ''), x as never, r.base);
  return {
    ruleOn: r.ruleOn, basePoints: r.base, monthlyCap: r.cap, switchOn: r.switchOn, items, noticeDefault: REF_EVENT_NOTICE_DEFAULT,
    note: '이벤트는 직접 추천 1단계 보상의 점수만 바꿉니다(여러 단계 보상 없음). 시작하려면 시행 전 확인(약관 · 안내 문구 모두 예)과 최고 관리자가 필요합니다.',
  };
}

/** POST /admin/prx/ref-events — 초안(ADMIN · SUPER) */
export async function addRefEvent(db: DatabaseService, d: RefEventInput) {
  const c = check(d);
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO prx_ref_events (title, starts_at, ends_at, points, budget, notice_text, created_by)
     VALUES ($1, $2::timestamptz, $3::timestamptz, $4::int, $5::int, $6, $7) RETURNING id::text AS id`,
    [c.title, c.s, c.e, d.points, d.budget, c.notice, RequestCtx.actorId() ?? null]);
  return { ok: true, id: r!.id, note: '추천 이벤트 초안을 만들었습니다 — 시행 전 확인 칸을 채운 뒤 최고 관리자가 시작합니다.' };
}

/** PUT /admin/prx/ref-events/{id} — 초안만 */
export async function editRefEvent(db: DatabaseService, id: string, d: RefEventInput) {
  const ev = await one(db, id);
  if (ev.state !== 'DRAFT') throw new StateConflict('PRX_EVENT_STATE', '시작했거나 끝난 이벤트는 고칠 수 없습니다.');
  const c = check(d);
  /* 내용이 바뀌면 시행 전 확인을 다시 받음(확인한 문구와 다를 수 있어서) */
  await db.query(
    `UPDATE prx_ref_events SET title = $2, starts_at = $3::timestamptz, ends_at = $4::timestamptz, points = $5::int, budget = $6::int, notice_text = $7,
            check_terms = false, check_notice = false, checked_by = NULL, checked_at = NULL WHERE id = $1::bigint`,
    [id, c.title, c.s, c.e, d.points, d.budget, c.notice]);
  return { ok: true, note: '이벤트를 고쳤습니다 — 내용이 바뀌어 시행 전 확인(약관 · 안내 문구)을 다시 표시해야 합니다.' };
}

/** PUT /admin/prx/ref-events/{id}/check — 시행 전 확인 칸(ADMIN · SUPER · 초안만) */
export async function setRefEventCheck(db: DatabaseService, id: string, d: RefEventCheckInput) {
  const ev = await one(db, id);
  if (ev.state !== 'DRAFT') throw new StateConflict('PRX_EVENT_STATE', '시작했거나 끝난 이벤트의 확인 칸은 고칠 수 없습니다.');
  const by = String(d.by ?? '').trim();
  if (by.length < 2 || by.length > 60) throw new PolicyViolation('PRX_EVENT_CHECK', '확인한 곳(법무 · 내부 등)을 2 ~ 60자로 적으십시오.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.on ?? '') || isNaN(new Date(d.on).getTime())) throw new PolicyViolation('PRX_EVENT_CHECK', '확인 날짜가 바르지 않습니다.');
  if (new Date(d.on).getTime() > Date.now() + 9 * 3600e3) throw new PolicyViolation('PRX_EVENT_CHECK', '확인 날짜는 오늘까지입니다.');
  const memo = String(d.memo ?? '').trim() || null;
  if (memo && memo.length > 500) throw new PolicyViolation('PRX_EVENT_CHECK', '메모는 500자까지입니다.');
  await db.query(
    `UPDATE prx_ref_events SET check_terms = $2, check_notice = $3, check_by = $4, check_on = $5::date, check_memo = $6, checked_by = $7, checked_at = now()
      WHERE id = $1::bigint`, [id, !!d.terms, !!d.notice, by, d.on, memo, RequestCtx.actorId() ?? null]);
  const ready = !!d.terms && !!d.notice;
  return { ok: true, ready, note: ready ? '시행 전 확인을 적었습니다 — 최고 관리자가 시작할 수 있습니다.' : '확인을 적었습니다. 약관 · 안내 문구가 모두 「예」여야 시작할 수 있습니다.' };
}

/** POST /admin/prx/ref-events/{id}/start — SUPER */
export async function startRefEvent(db: DatabaseService, id: string) {
  const ev = await one(db, id);
  if (ev.state !== 'DRAFT') throw new StateConflict('PRX_EVENT_STATE', '초안만 시작할 수 있습니다.');
  if (!(ev.check_terms && ev.check_notice) || !ev.check_by || !ev.check_on) {
    throw new StateConflict('PRX_EVENT_CHECK', '시행 전 확인(약관 · 안내 문구 모두 예 · 확인한 곳 · 날짜)을 먼저 채우십시오.');
  }
  if (new Date(ev.ends_at) <= new Date()) throw new StateConflict('PRX_EVENT_PERIOD', '끝 시각이 이미 지났습니다 — 기간을 고치고 다시 확인받으십시오.');
  const r = await rule(db);
  if (!r.ruleOn) throw new StateConflict('PRX_RULE_OFF', '직접 추천 보상(REFERRAL_DIRECT)이 꺼져 있어 이벤트가 효과가 없습니다 — 추천 보상을 먼저 켜십시오.');
  if (!r.switchOn) throw new StateConflict('PRX_EVENT_SWITCH', '추천 이벤트 스위치(prx.ref_event)가 꺼져 있습니다 — 먼저 켜십시오.');
  const [busy] = await db.query(`SELECT 1 FROM prx_ref_events WHERE state = 'ACTIVE'`);
  if (busy) throw new StateConflict('PRX_EVENT_BUSY', '진행 중인 추천 이벤트가 있습니다 — 한 번에 하나만 엽니다.');
  await db.query(`UPDATE prx_ref_events SET state = 'ACTIVE', started_by = $2, started_at = now() WHERE id = $1::bigint AND state = 'DRAFT'`,
    [id, RequestCtx.actorId() ?? null]);
  return { ok: true, note: '추천 이벤트를 시작했습니다 — 기간 안 첫 본인인증부터 이벤트 점수가 나갑니다.' };
}

/** POST /admin/prx/ref-events/{id}/end — SUPER(진행 중 → 끝 · 초안 → 취소) */
export async function endRefEvent(db: DatabaseService, id: string) {
  const ev = await one(db, id);
  const me = RequestCtx.actorId() ?? null;
  if (ev.state === 'ACTIVE') {
    await db.query(`UPDATE prx_ref_events SET state = 'ENDED', end_reason = 'MANUAL', ended_by = $2, ended_at = now() WHERE id = $1::bigint`, [id, me]);
    return { ok: true, note: '추천 이벤트를 끝냈습니다 — 지금부터 평소 점수입니다(이미 준 보상은 그대로).' };
  }
  if (ev.state === 'DRAFT') {
    await db.query(`UPDATE prx_ref_events SET state = 'CANCELED', end_reason = 'CANCELED', ended_by = $2, ended_at = now() WHERE id = $1::bigint`, [id, me]);
    return { ok: true, note: '초안을 취소했습니다.' };
  }
  throw new StateConflict('PRX_EVENT_STATE', '이미 끝났거나 취소한 이벤트입니다.');
}

/** PUT /admin/prx/ref-events/switch — SUPER · 사유 */
export async function setRefEventSwitch(db: DatabaseService, on: boolean, reason: string) {
  const why = String(reason ?? '').replace(/\s+/g, ' ').trim();
  if (why.length < 2 || why.length > 200) throw new PolicyViolation('PRX_REASON', '사유는 2 ~ 200자입니다.');
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [why]);
    await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, ['prx.ref_event', on ? 'on' : 'off', RequestCtx.actorId() ?? null]);
  });
  return { ok: true, switchOn: !!on, note: on ? '추천 이벤트 스위치를 켰습니다.' : '추천 이벤트 스위치를 껐습니다 — 진행 중이어도 평소 점수가 나갑니다.' };
}

/** 정기 작업(prx_hourly 안) — 기간 끝난 이벤트 ENDED(PERIOD) · 끝난 이벤트 운영 알림 한 번 */
export async function refEventHourly(db: DatabaseService) {
  const ended = await db.query<{ id: string }>(
    `UPDATE prx_ref_events SET state = 'ENDED', end_reason = 'PERIOD', ended_at = now() WHERE state = 'ACTIVE' AND ends_at <= now() RETURNING id::text AS id`);
  const done = await db.query<{ id: string; title: string; reason: string; used: number; budget: number }>(
    `SELECT id::text AS id, title, end_reason AS reason, used, budget FROM prx_ref_events
      WHERE state = 'ENDED' AND ended_at > now() - interval '3 days'`);
  let alerts = 0;
  for (const e of done) {
    const why = e.reason === 'BUDGET' ? '예산 다 씀' : e.reason === 'MANUAL' ? '운영자가 끝냄' : '기간 끝';
    const ins = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'PRX_REF_EVENT_END', 'INFO', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'PRX_REF_EVENT_END' AND detail->>'event' = $3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [`추천 이벤트 끝 — ${e.title} · ${why} · 쓴 점수 ${won(e.used)} / 예산 ${won(e.budget)} — 제휴 › 추천 이벤트`.slice(0, 300),
       JSON.stringify({ event: e.id, reason: e.reason, used: e.used, budget: e.budget }), e.id]);
    alerts += ins.length;
  }
  return { ended: ended.length, alerts };
}
