import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.520 (D277 · docs/658) 광고 소재 비교 시험(A/B)
 *   한 광고(같은 슬롯 · 같은 광고주 · 같은 세그먼트)의 소재 2개를 진행 중 기간에 노출마다 번갈아 냄 — fn_prx_ab_pick(차례 홀수 A · 짝수 B).
 *   B 는 진행 중에는 뽑기 목록에서 빠짐(fn_prx_ab_hidden) — 짝이 다른 소재보다 두 배 뽑히지 않게.
 *   두 소재 모두 기존 광고 소재(ad_placements) · 기록은 기존 ad_events(소재마다 · 과금 근거 그대로) — 새 추적 · 새 칸 없음.
 *   표기 규칙 그대로: 응답 label 「광고」 · 인피드 추천 점수 제외(ad_slots 를 고치지 않음 · sgb-adx AD-01 · AD-02 와 같은 뜻).
 *   결과(끝난 뒤 고정): 소재마다 노출 · 클릭 · 클릭률 · 두 비율 차이 검정(z) — 숫자만 · 회원 정보 없음.
 *   소재마다 prx.ab_min_impr(처음 1,000) 이상 노출돼야 「이긴 소재」를 말함 · 아니면 「표본 부족」.
 * ------------------------------------------------------------------- */

const CODE_RE = /^[A-Za-z0-9_-]{1,40}$/;
export interface AbInput { title: string; codeA: string; codeB: string; startsAt: string; endsAt: string }

export interface AbSide { id: string; code: string; impressions: number; clicks: number; ctr: number | null }
export interface AbResult { a: AbSide; b: AbSide; z: number | null; winner: 'A' | 'B' | null; verdict: 'A' | 'B' | 'TIE' | 'LOW_SAMPLE'; minImpr: number; from: string; until: string }

/** 두 비율 차이 검정(z · 양쪽 95% = 1.96) */
export function judge(a: { impressions: number; clicks: number }, b: { impressions: number; clicks: number }, minImpr: number) {
  const p1 = a.impressions ? a.clicks / a.impressions : 0, p2 = b.impressions ? b.clicks / b.impressions : 0;
  const n = a.impressions + b.impressions;
  const p = n ? (a.clicks + b.clicks) / n : 0;
  const se = a.impressions && b.impressions ? Math.sqrt(p * (1 - p) * (1 / a.impressions + 1 / b.impressions)) : 0;
  const z = se > 0 ? Math.round(((p1 - p2) / se) * 100) / 100 : null;
  if (a.impressions < minImpr || b.impressions < minImpr) return { z, verdict: 'LOW_SAMPLE' as const, winner: null };
  if (z == null || Math.abs(z) < 1.96) return { z, verdict: 'TIE' as const, winner: null };
  return { z, verdict: (z > 0 ? 'A' : 'B') as 'A' | 'B', winner: (z > 0 ? 'A' : 'B') as 'A' | 'B' };
}

async function minImpr(db: DatabaseService) {
  const [m] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'prx.ab_min_impr'`);
  return Number(m?.v ?? 1000) || 1000;
}

/** 시험 숫자 — 기간 안(시작 ~ 끝 · 아직이면 지금까지) ad_events */
export async function abStats(db: DatabaseService, id: string): Promise<AbResult> {
  const [t] = await db.query<{ a: string; b: string; ca: string; cb: string; from: string; until: string }>(
    `SELECT t.creative_a::text AS a, t.creative_b::text AS b, pa.creative_code AS ca, pb.creative_code AS cb,
            t.starts_at AS "from", least(t.ends_at, now()) AS until
       FROM prx_ab_tests t JOIN ad_placements pa ON pa.id = t.creative_a JOIN ad_placements pb ON pb.id = t.creative_b WHERE t.id = $1::bigint`, [id]);
  if (!t) throw new NotFound('없는 비교 시험입니다.');
  const ev = await db.query<{ id: string; impr: string; clicks: string }>(
    `SELECT e.creative_id::text AS id, count(*) FILTER (WHERE e.event_type = 'IMPRESSION') AS impr, count(*) FILTER (WHERE e.event_type = 'CLICK') AS clicks
       FROM ad_events e WHERE e.creative_id IN ($1::uuid, $2::uuid) AND e.occurred_at >= $3::timestamptz AND e.occurred_at < $4::timestamptz
      GROUP BY e.creative_id`, [t.a, t.b, t.from, t.until]);
  const side = (cid: string, code: string): AbSide => {
    const x = ev.find((r) => r.id === cid);
    const impressions = Number(x?.impr ?? 0), clicks = Number(x?.clicks ?? 0);
    return { id: cid, code, impressions, clicks, ctr: impressions ? Math.round((10000 * clicks) / impressions) / 100 : null };
  };
  const a = side(t.a, t.ca), b = side(t.b, t.cb);
  const mi = await minImpr(db);
  const j = judge(a, b, mi);
  return { a, b, z: j.z, winner: j.winner, verdict: j.verdict, minImpr: mi, from: t.from, until: t.until };
}

/** GET /admin/prx/ab-tests */
export async function listAbTests(db: DatabaseService) {
  const items = await db.query<Record<string, any>>(
    `SELECT t.id::text AS id, t.title, t.slot_code AS slot, pa.creative_code AS "codeA", pb.creative_code AS "codeB", pa.advertiser,
            t.starts_at AS "startsAt", t.ends_at AS "endsAt", t.state, t.served, t.result, t.started_at AS "startedAt", t.ended_at AS "endedAt"
       FROM prx_ab_tests t JOIN ad_placements pa ON pa.id = t.creative_a JOIN ad_placements pb ON pb.id = t.creative_b
      ORDER BY (t.state = 'RUNNING') DESC, t.created_at DESC LIMIT 100`);
  const creatives = await db.query<Record<string, unknown>>(
    `SELECT creative_code AS code, advertiser, slot_code AS slot, status, title FROM ad_placements
      WHERE creative_code IS NOT NULL AND slot_code IS NOT NULL AND status IN ('ACTIVE', 'PAUSED', 'SCHEDULED') ORDER BY slot_code, advertiser, creative_code`);
  return { items, creatives, minImpr: await minImpr(db),
    note: '진행 중에는 노출마다 A · B 를 번갈아 냅니다. 「광고」 표기 · 추천 순위 제외는 그대로이고, 결과는 노출 · 클릭 숫자만입니다.' };
}

/** GET /admin/prx/ab-tests/{id} */
export async function abDetail(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 비교 시험입니다.');
  const [t] = await db.query<{ state: string; result: AbResult | null }>(`SELECT state, result FROM prx_ab_tests WHERE id = $1::bigint`, [id]);
  if (!t) throw new NotFound('없는 비교 시험입니다.');
  return { state: t.state, fixed: t.state === 'ENDED', result: t.state === 'ENDED' && t.result ? t.result : await abStats(db, id) };
}

/** POST /admin/prx/ab-tests — 초안 */
export async function addAbTest(db: DatabaseService, d: AbInput) {
  const title = String(d.title ?? '').trim();
  if (title.length < 2 || title.length > 80) throw new PolicyViolation('PRX_AB', '시험 이름은 2 ~ 80자입니다.');
  if (!CODE_RE.test(d.codeA ?? '') || !CODE_RE.test(d.codeB ?? '') || d.codeA === d.codeB) throw new PolicyViolation('PRX_AB_PAIR', '서로 다른 소재 두 개를 고르십시오.');
  const s = new Date(d.startsAt), e = new Date(d.endsAt);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) throw new PolicyViolation('PRX_AB_PERIOD', '끝 시각은 시작 시각보다 뒤여야 합니다.');
  if (e.getTime() - s.getTime() > 92 * 86400e3) throw new PolicyViolation('PRX_AB_PERIOD', '시험 기간은 92일까지입니다.');
  const ps = await db.query<{ id: string; code: string; slot: string | null; adv: string | null; status: string; segs: string[] }>(
    `SELECT p.id::text AS id, p.creative_code AS code, p.slot_code AS slot, lower(btrim(p.advertiser)) AS adv, p.status,
            coalesce((SELECT array_agg(s.segment_code ORDER BY s.segment_code) FROM ad_creative_segments s WHERE s.creative_id = p.id), '{}') AS segs
       FROM ad_placements p WHERE p.creative_code IN ($1, $2)`, [d.codeA, d.codeB]);
  const A = ps.find((p) => p.code === d.codeA), B = ps.find((p) => p.code === d.codeB);
  if (!A || !B) throw new NotFound('없는 광고 소재입니다.');
  if (!A.slot || A.slot !== B.slot) throw new PolicyViolation('PRX_AB_PAIR', '두 소재는 같은 광고 자리(슬롯)에 있어야 합니다.');
  if (!A.adv || A.adv !== B.adv) throw new PolicyViolation('PRX_AB_PAIR', '두 소재는 같은 광고주여야 합니다.');
  if ((A.segs ?? []).join(',') !== (B.segs ?? []).join(',')) throw new PolicyViolation('PRX_AB_PAIR', '두 소재의 세그먼트 지정이 같아야 합니다(받는 사람이 같아야 비교가 됩니다).');
  if ([A.status, B.status].some((x) => ['BLOCKED', 'DRAFT', 'ENDED'].includes(x))) throw new PolicyViolation('PRX_AB_PAIR', '차단 · 준비 중 · 끝난 소재는 시험할 수 없습니다.');
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO prx_ab_tests (title, creative_a, creative_b, slot_code, starts_at, ends_at, created_by)
     VALUES ($1, $2::uuid, $3::uuid, $4, $5::timestamptz, $6::timestamptz, $7) RETURNING id::text AS id`,
    [title, A.id, B.id, A.slot, s.toISOString(), e.toISOString(), RequestCtx.actorId() ?? null]);
  return { ok: true, id: r!.id, note: '비교 시험 초안을 만들었습니다 — 두 소재가 노출 중일 때 시작하십시오.' };
}

/** POST /admin/prx/ab-tests/{id}/start */
export async function startAbTest(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 비교 시험입니다.');
  const [t] = await db.query<{ state: string; ends_at: string; st_a: string; st_b: string; busy: boolean }>(
    `SELECT t.state, t.ends_at, pa.status AS st_a, pb.status AS st_b,
            EXISTS (SELECT 1 FROM prx_ab_tests x WHERE x.state = 'RUNNING' AND x.id <> t.id
                      AND (x.creative_a IN (t.creative_a, t.creative_b) OR x.creative_b IN (t.creative_a, t.creative_b))) AS busy
       FROM prx_ab_tests t JOIN ad_placements pa ON pa.id = t.creative_a JOIN ad_placements pb ON pb.id = t.creative_b WHERE t.id = $1::bigint`, [id]);
  if (!t) throw new NotFound('없는 비교 시험입니다.');
  if (t.state !== 'DRAFT') throw new StateConflict('PRX_AB_STATE', '초안만 시작할 수 있습니다.');
  if (new Date(t.ends_at) <= new Date()) throw new StateConflict('PRX_AB_PERIOD', '끝 시각이 이미 지났습니다.');
  if (t.st_a !== 'ACTIVE' || t.st_b !== 'ACTIVE') throw new StateConflict('PRX_AB_NOT_ACTIVE', '두 소재 모두 노출 중(ACTIVE)이어야 시작할 수 있습니다.');
  if (t.busy) throw new StateConflict('PRX_AB_BUSY', '이 소재는 이미 다른 비교 시험이 진행 중입니다.');
  await db.query(`UPDATE prx_ab_tests SET state = 'RUNNING', started_by = $2, started_at = now() WHERE id = $1::bigint AND state = 'DRAFT'`, [id, RequestCtx.actorId() ?? null]);
  return { ok: true, note: '비교 시험을 시작했습니다 — 기간 안에는 노출마다 번갈아 나갑니다.' };
}

/** 끝내기(결과 고정) — 운영자 · 정기 작업 같은 길 */
async function close(db: DatabaseService, id: string) {
  const r = await abStats(db, id);
  const rows = await db.query(`UPDATE prx_ab_tests SET state = 'ENDED', result = $2::jsonb, ended_at = now() WHERE id = $1::bigint AND state = 'RUNNING' RETURNING id`, [id, JSON.stringify(r)]);
  return { ended: rows.length > 0, result: r };
}

/** POST /admin/prx/ab-tests/{id}/end */
export async function endAbTest(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 비교 시험입니다.');
  const c = await close(db, id);
  if (!c.ended) throw new StateConflict('PRX_AB_STATE', '진행 중인 시험만 끝낼 수 있습니다.');
  return { ok: true, result: c.result, note: '비교 시험을 끝내고 결과를 고정했습니다.' };
}

/** POST /admin/prx/ab-tests/{id}/cancel */
export async function cancelAbTest(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 비교 시험입니다.');
  const rows = await db.query(`UPDATE prx_ab_tests SET state = 'CANCELED', ended_at = now() WHERE id = $1::bigint AND state IN ('DRAFT', 'RUNNING') RETURNING id`, [id]);
  if (!rows.length) throw new StateConflict('PRX_AB_STATE', '초안이나 진행 중인 시험만 취소할 수 있습니다.');
  return { ok: true, note: '비교 시험을 취소했습니다(결과 없음).' };
}

/** 정기 작업(prx_hourly 안) — 기간 끝난 시험 결과 고정 · 운영 알림 */
export async function abHourly(db: DatabaseService) {
  const due = await db.query<{ id: string; title: string }>(`SELECT id::text AS id, title FROM prx_ab_tests WHERE state = 'RUNNING' AND ends_at <= now() ORDER BY id LIMIT 50`);
  let ended = 0;
  for (const t of due) {
    const c = await close(db, t.id);
    if (!c.ended) continue;
    ended++;
    const v = c.result.verdict === 'LOW_SAMPLE' ? '표본 부족' : c.result.verdict === 'TIE' ? '차이 없음' : `${c.result.verdict} 소재가 더 많이 눌림`;
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'PRX_AB_DONE', 'INFO', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'PRX_AB_DONE' AND detail->>'test' = $3)
       ON CONFLICT DO NOTHING`,
      [`광고 소재 비교 끝 — ${t.title} · ${v} — 광고 › 광고 소재 비교`.slice(0, 300), JSON.stringify({ test: t.id, verdict: c.result.verdict }), t.id]);
  }
  return { ended };
}

/* ── 광고 노출에 끼우는 두 함수(ads.service.ts 패치) ─────────────────── */

/** 슬롯 소재(v_ad_serving 줄) — 진행 중 시험의 A 면 차례대로 A · B. B 가 지금 못 나가면 원래 줄 */
export async function abSwapServing<T extends { id: string }>(db: DatabaseService, row: T): Promise<T> {
  const [p] = await db.query<{ id: string }>(`SELECT fn_prx_ab_pick($1::uuid)::text AS id`, [row.id]);
  if (!p || p.id === row.id) return row;
  const [alt] = await db.query<T>(
    `SELECT id, creative_code AS "code", advertiser, title, body, cta, landing_route AS "landingRoute", slot_code AS "slot"
       FROM v_ad_serving WHERE id = $1::uuid`, [p.id]);
  return alt ?? row;
}

/** 인피드 줄(ad_placements) — 같은 일 · 자리(position) · 「광고」 표기는 부른 쪽이 그대로 붙임 */
export async function abSwapInfeed(db: DatabaseService, rows: Array<{ id: string }>) {
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i]!;
    const [p] = await db.query<{ id: string }>(`SELECT fn_prx_ab_pick($1::uuid)::text AS id`, [cur.id]);
    if (!p || p.id === cur.id) continue;
    const [alt] = await db.query<{ id: string }>(
      `SELECT p.id, p.title, p.body, p.image_key AS "imageKey", p.landing_route AS "landingUrl", p.advertiser
         FROM ad_placements p
        WHERE p.id = $1::uuid AND p.slot_code = 'INFEED' AND p.status = 'ACTIVE'
          AND (p.starts_at IS NULL OR p.starts_at <= (now() AT TIME ZONE 'Asia/Seoul')::date)
          AND (p.ends_at   IS NULL OR p.ends_at   >= (now() AT TIME ZONE 'Asia/Seoul')::date)`, [p.id]);
    if (alt) rows[i] = alt;
  }
  return rows;
}
