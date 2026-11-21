import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { alertOnceByKey, clean, ID_RE, isOn, kstToday, resolveByKey } from './common';

/* ---------------------------------------------------------------------
 * v10.610 (docs/752) ㉖ 광고 예산 소진 알림 · 자동 정지
 *   광고 소재(ad_placements)마다 예산 한 줄(bzx_ad_budgets) — 노출 수(IMPRESSION) 또는 클릭 수(CLICK) 상한 · 기간 전체(TOTAL) 또는 하루(DAY · 한국 날짜)
 *   셈은 새 추적 없이 기존 ad_events(노출 · 클릭)만 읽음 · 처음 상한 제안 = 그 소재 예약(ad_bookings)의 예상 노출(expected_impressions)
 *   정기 작업 bzx_frequent(10분마다):
 *     알림 기준(alert_pct · 처음 80%)을 넘으면 운영 알림 BZX_AD_BUDGET(창마다 한 번)
 *     상한에 닿으면 운영 알림 한 번 더 + bzx.ad_autopause on(처음 off) 이고 그 줄이 「자동 정지」면 소재를 PAUSED(ACTIVE 일 때만 · 기존 소재 중지와 같은 상태)
 *     하루 예산(DAY)으로 멈춘 소재는 다음 날 첫 차례에 다시 ACTIVE(우리가 멈춘 것만 · 손으로 멈춘 것은 그대로)
 *   기록은 bzx_ad_budget_events(쌓기만) · 광고주 메일은 없음(성과 보고서 메일 prx.ad_report_mail 과 따로 · 다음 판)
 * ------------------------------------------------------------------- */

export const CAP_KINDS = ['IMPRESSION', 'CLICK'] as const;
export const CAP_PERIODS = ['TOTAL', 'DAY'] as const;

interface Bud {
  id: string; creative_id: string; code: string | null; title: string | null; advertiser: string | null; status: string;
  cap_kind: string; cap_value: number; period: string; counted_from: string; alert_pct: number; auto_pause: boolean; state: string;
  window_key: string | null; near_at: string | null; spent_at: string | null; paused_at: string | null;
}
const SEL = `SELECT b.id::text AS id, b.creative_id::text AS creative_id, p.creative_code AS code, p.title, p.advertiser, p.status,
                    b.cap_kind, b.cap_value, b.period, b.counted_from, b.alert_pct, b.auto_pause, b.state, b.window_key, b.near_at, b.spent_at, b.paused_at
               FROM bzx_ad_budgets b JOIN ad_placements p ON p.id = b.creative_id`;

const windowOf = (b: { period: string }, today: string) => (b.period === 'DAY' ? today : 'TOTAL');

async function used(db: DatabaseService, b: Bud, today: string): Promise<number> {
  const [r] = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ad_events
      WHERE creative_id = $1::uuid AND event_type = $2
        AND occurred_at >= CASE WHEN $3::text = 'DAY' THEN ($4::date::timestamp AT TIME ZONE 'Asia/Seoul') ELSE $5::timestamptz END`,
    [b.creative_id, b.cap_kind, b.period, today, b.counted_from]);
  return Number(r?.n ?? 0);
}

/** GET /admin/bzx/ad-budgets — 예산 줄 · 쓴 양 · 예산 없는 소재(예상 노출 제안) */
export async function adBudgets(db: DatabaseService) {
  const today = kstToday();
  const rows = await db.query<Bud>(`${SEL} ORDER BY b.state, p.creative_code`);
  const items = [];
  for (const b of rows) {
    const u = await used(db, b, today);
    items.push({ id: b.id, creativeId: b.creative_id, code: b.code, title: b.title, advertiser: b.advertiser, status: b.status, capKind: b.cap_kind, capValue: b.cap_value,
      period: b.period, countedFrom: b.counted_from, alertPct: b.alert_pct, autoPause: b.auto_pause, state: b.state, used: u,
      pct: Math.round((u / b.cap_value) * 1000) / 10, nearAt: b.near_at, spentAt: b.spent_at, pausedAt: b.paused_at });
  }
  const free = await db.query(
    `SELECT p.id::text AS "creativeId", p.creative_code AS code, p.title, p.advertiser, p.status,
            (SELECT max(k.expected_impressions) FROM ad_bookings k WHERE k.creative_code = p.creative_code AND k.status IN ('RESERVED', 'CONFIRMED')) AS "suggest"
       FROM ad_placements p WHERE p.status IN ('ACTIVE', 'SCHEDULED', 'PAUSED') AND NOT EXISTS (SELECT 1 FROM bzx_ad_budgets b WHERE b.creative_id = p.id)
      ORDER BY p.creative_code NULLS LAST LIMIT 200`);
  const events = await db.query(
    `SELECT e.id::text AS id, p.creative_code AS code, e.kind, e.used, e.cap, e.note, e.created_at AS "createdAt"
       FROM bzx_ad_budget_events e JOIN bzx_ad_budgets b ON b.id = e.budget_id JOIN ad_placements p ON p.id = b.creative_id ORDER BY e.id DESC LIMIT 30`);
  return { items, free, events, autoPause: await isOn(db, 'bzx.ad_autopause'),
    note: '노출 · 클릭은 기존 광고 기록(ad_events)을 셉니다. 알림 기준을 넘으면 · 상한에 닿으면 운영 알림이 뜹니다(10분마다). 자동 정지는 스위치(bzx.ad_autopause)가 켜져 있고 줄마다 「자동 정지」를 고른 소재만 멈춥니다.' };
}

export interface BudgetInput { capKind: string; capValue: number; period?: string; alertPct?: number; autoPause?: boolean; note?: string }

/** PUT /admin/bzx/ad-budgets/{creativeId} — 넣기 · 고치기(고치면 알림 표시만 지움 · 셈 시작은 그대로) */
export async function setAdBudget(db: DatabaseService, creativeId: string, b: BudgetInput, actor: string | null) {
  if (!/^[0-9a-f-]{36}$/i.test(creativeId ?? '')) throw new NotFound('없는 광고 소재입니다.');
  if (!(CAP_KINDS as readonly string[]).includes(b.capKind)) throw new PolicyViolation('BZX_AD_CAP', '상한 종류는 노출(IMPRESSION) · 클릭(CLICK)입니다.');
  const cap = Number(b.capValue);
  if (!Number.isInteger(cap) || cap < 1 || cap > 1_000_000_000) throw new PolicyViolation('BZX_AD_CAP', '상한은 1 ~ 10억 사이 정수입니다.');
  const period = b.period ?? 'TOTAL';
  if (!(CAP_PERIODS as readonly string[]).includes(period)) throw new PolicyViolation('BZX_AD_CAP', '기간은 전체(TOTAL) · 하루(DAY)입니다.');
  const pct = b.alertPct == null ? 80 : Number(b.alertPct);
  if (!Number.isInteger(pct) || pct < 50 || pct > 99) throw new PolicyViolation('BZX_AD_CAP', '알림 기준은 50 ~ 99% 입니다.');
  return db.transaction(async () => {
    const [p] = await db.query<{ code: string | null }>(`SELECT creative_code AS code FROM ad_placements WHERE id = $1::uuid`, [creativeId]);
    if (!p) throw new NotFound('없는 광고 소재입니다.');
    const [cur] = await db.query<{ id: string }>(`SELECT id::text AS id FROM bzx_ad_budgets WHERE creative_id = $1::uuid FOR UPDATE`, [creativeId]);
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO bzx_ad_budgets (creative_id, cap_kind, cap_value, period, alert_pct, auto_pause, note, created_by, updated_at)
       VALUES ($1::uuid, $2, $3::int, $4, $5::int, $6::boolean, $7, $8::uuid, now())
       ON CONFLICT (creative_id) DO UPDATE SET cap_kind = EXCLUDED.cap_kind, cap_value = EXCLUDED.cap_value, period = EXCLUDED.period, alert_pct = EXCLUDED.alert_pct,
              auto_pause = EXCLUDED.auto_pause, note = EXCLUDED.note, near_at = NULL, spent_at = NULL, window_key = NULL,
              state = CASE WHEN bzx_ad_budgets.state = 'OFF' THEN 'ON' ELSE bzx_ad_budgets.state END, updated_at = now()
       RETURNING id::text AS id`,
      [creativeId, b.capKind, cap, period, pct, b.autoPause === true, clean(b.note, 200) || null, actor]);
    await db.query(`INSERT INTO bzx_ad_budget_events (budget_id, kind, cap, note, actor_id) VALUES ($1::bigint, 'SET', $2::int, $3, $4::uuid)`,
      [r!.id, cap, `${b.capKind} ${period} ${pct}%${b.autoPause ? ' 자동 정지' : ''}`, actor]);
    return { ok: true, id: r!.id, created: !cur, note: cur ? `${p.code ?? '-'} 예산을 고쳤습니다.` : `${p.code ?? '-'} 예산을 넣었습니다.` };
  });
}

async function bud(db: DatabaseService, id: string, lock = false): Promise<Bud> {
  if (!ID_RE.test(String(id ?? ''))) throw new NotFound('없는 광고 예산입니다.');
  const [b] = await db.query<Bud>(`${SEL} WHERE b.id = $1::bigint` + (lock ? ' FOR UPDATE OF b' : ''), [id]);
  if (!b) throw new NotFound('없는 광고 예산입니다.');
  return b;
}

/** POST /admin/bzx/ad-budgets/{id}/reset — 셈 다시 시작(예산 다시 채움) · 우리가 멈춘 소재는 다시 ACTIVE */
export async function resetAdBudget(db: DatabaseService, id: string, actor: string | null) {
  const b = await bud(db, id);
  if (b.state === 'OFF') throw new StateConflict('BZX_AD_STATE', '끈 예산입니다 — 고치기로 다시 켜십시오.');
  await db.query(`UPDATE bzx_ad_budgets SET counted_from = now(), state = 'ON', near_at = NULL, spent_at = NULL, paused_at = NULL, window_key = NULL, updated_at = now() WHERE id = $1::bigint`, [b.id]);
  /* 다시 노출은 따로(슬롯 · 심의 규칙 trg_ad_active_slot · trg_ad_slot_gate 에 걸리면 소재는 멈춘 채 · 셈은 다시 시작) */
  const resumed = b.state === 'PAUSED_BY_BUDGET' ? await resumeCreative(db, b.creative_id) : false;
  await db.query(`INSERT INTO bzx_ad_budget_events (budget_id, kind, cap, note, actor_id) VALUES ($1::bigint, 'RESET', $2::int, $3, $4::uuid)`,
    [b.id, b.cap_value, b.state === 'PAUSED_BY_BUDGET' ? (resumed ? '다시 노출' : '다시 노출 못 함(슬롯 · 심의 규칙)') : null, actor]);
  await resolveByKey(db, 'BZX_AD_BUDGET', `ad|${b.id}|`, '예산 다시 채움');
  return { ok: true, id: b.id, resumed, note: resumed ? '셈을 다시 시작하고 소재를 다시 노출합니다.' : '셈을 다시 시작했습니다.' };
}

/** 우리가 멈춘 소재 다시 ACTIVE — 광고 규칙 트리거에 걸리면 false(멈춘 채) */
async function resumeCreative(db: DatabaseService, creativeId: string): Promise<boolean> {
  try {
    const r = await db.query(`UPDATE ad_placements SET status = 'ACTIVE' WHERE id = $1::uuid AND status = 'PAUSED' RETURNING id`, [creativeId]);
    return r.length > 0;
  } catch { return false; }
}

/** POST /admin/bzx/ad-budgets/{id}/off — 예산 끄기(알림 · 자동 정지 안 함 · 소재 상태는 그대로) */
export async function offAdBudget(db: DatabaseService, id: string, actor: string | null) {
  const b = await bud(db, id);
  await db.query(`UPDATE bzx_ad_budgets SET state = 'OFF', updated_at = now() WHERE id = $1::bigint`, [b.id]);
  await db.query(`INSERT INTO bzx_ad_budget_events (budget_id, kind, cap, actor_id) VALUES ($1::bigint, 'OFF', $2::int, $3::uuid)`, [b.id, b.cap_value, actor]);
  await resolveByKey(db, 'BZX_AD_BUDGET', `ad|${b.id}|`, '예산 끔');
  return { ok: true, id: b.id, note: '예산을 껐습니다(소재 상태는 그대로).' };
}

/** 정기 작업(bzx_frequent) · 「지금 점검」 — 알림 · 자동 정지 · 하루 예산 다음 날 다시 노출 */
export async function adBudgetJob(db: DatabaseService, today = kstToday()) {
  const autoOn = await isOn(db, 'bzx.ad_autopause');
  const rows = await db.query<Bud>(`${SEL} WHERE b.state IN ('ON', 'PAUSED_BY_BUDGET')`);
  let near = 0, spent = 0, paused = 0, resumed = 0;
  for (const b of rows) {
    const w = windowOf(b, today);
    if (b.window_key !== w) {
      /* 새 창(하루 예산의 다음 날 · 처음) — 표시 지움 · 하루 예산으로 우리가 멈춘 소재는 다시 노출 */
      if (b.state === 'PAUSED_BY_BUDGET' && b.period === 'DAY') {
        if (await resumeCreative(db, b.creative_id)) { resumed++; await db.query(`INSERT INTO bzx_ad_budget_events (budget_id, kind, cap, note) VALUES ($1::bigint, 'RESUMED', $2::int, '다음 날')`, [b.id, b.cap_value]); }
        b.state = 'ON';
      }
      await db.query(`UPDATE bzx_ad_budgets SET window_key = $2, near_at = NULL, spent_at = NULL, state = $3::text, paused_at = CASE WHEN $3::text = 'ON' THEN NULL ELSE paused_at END WHERE id = $1::bigint`, [b.id, w, b.state]);
      b.near_at = null; b.spent_at = null;
    }
    if (b.state !== 'ON') continue;
    const u = await used(db, b, today);
    const label = `${b.code ?? b.creative_id}${b.advertiser ? `(${b.advertiser})` : ''} ${b.cap_kind === 'CLICK' ? '클릭' : '노출'} ${u.toLocaleString('ko-KR')} / ${b.cap_value.toLocaleString('ko-KR')}${b.period === 'DAY' ? ` · ${today}` : ''}`;
    if (u >= b.cap_value) {
      if (!b.spent_at) {
        await db.query(`UPDATE bzx_ad_budgets SET spent_at = now() WHERE id = $1::bigint`, [b.id]);
        await db.query(`INSERT INTO bzx_ad_budget_events (budget_id, kind, used, cap) VALUES ($1::bigint, 'SPENT', $2::int, $3::int)`, [b.id, u, b.cap_value]);
        let did = false;
        if (autoOn && b.auto_pause) {
          const r = await db.query(`UPDATE ad_placements SET status = 'PAUSED' WHERE id = $1::uuid AND status = 'ACTIVE' RETURNING id`, [b.creative_id]);
          if (r.length) {
            did = true; paused++;
            await db.query(`UPDATE bzx_ad_budgets SET state = 'PAUSED_BY_BUDGET', paused_at = now() WHERE id = $1::bigint`, [b.id]);
            await db.query(`INSERT INTO bzx_ad_budget_events (budget_id, kind, used, cap) VALUES ($1::bigint, 'PAUSED', $2::int, $3::int)`, [b.id, u, b.cap_value]);
          }
        }
        await alertOnceByKey(db, 'BZX_AD_BUDGET', 'WARN',
          `광고 예산 다 씀 — ${label}${did ? ' · 소재를 자동 정지함' : b.auto_pause ? ' · 자동 정지 스위치 꺼짐(손으로 멈추십시오)' : ''} — 광고 › 광고 예산`,
          `ad|${b.id}|${w}|${new Date(b.counted_from).getTime()}|100`, { budgetId: b.id, creativeId: b.creative_id, used: u, cap: b.cap_value, paused: did });
        spent++;
      }
    } else if (u * 100 >= b.cap_value * b.alert_pct && !b.near_at) {
      await db.query(`UPDATE bzx_ad_budgets SET near_at = now() WHERE id = $1::bigint`, [b.id]);
      await db.query(`INSERT INTO bzx_ad_budget_events (budget_id, kind, used, cap) VALUES ($1::bigint, 'NEAR', $2::int, $3::int)`, [b.id, u, b.cap_value]);
      await alertOnceByKey(db, 'BZX_AD_BUDGET', 'INFO', `광고 예산 ${b.alert_pct}% 넘음 — ${label} — 광고 › 광고 예산`,
        `ad|${b.id}|${w}|${new Date(b.counted_from).getTime()}|${b.alert_pct}`, { budgetId: b.id, creativeId: b.creative_id, used: u, cap: b.cap_value });
      near++;
    }
    await db.query(`UPDATE bzx_ad_budgets SET last_used = $2::int, last_checked_at = now() WHERE id = $1::bigint`, [b.id, u]);
  }
  return { checked: rows.length, near, spent, paused, resumed, autoPause: autoOn };
}
