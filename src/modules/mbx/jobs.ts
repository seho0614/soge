import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { MBX_KEYS, mbxSettings } from './common';
import { purgeRecent } from './recent';
import { priceDigestJob, purgeWatches } from './price';
import { purgeDm } from './dm';

/* ---------------------------------------------------------------------
 * v10.501 ~ 504 (D273 · docs/639 ~ 642) 회원 2 — 정기 작업 · 운영 화면(회원 › 회원 편의 기능)
 *   mbx_price_digest  매일 08:30  가격 변동 묶음 알림(mbx.price_alert on 일 때만)
 *   mbx_daily         매일 04:35  최근 본 기록 보관 기간 · 회원 대화 보관 기간 · 탈퇴 회원 기록 정리 → mbx_purges(쌓기만)
 *                     스위치가 꺼져 있어도 돎 — 꺼진 뒤 남은 기록도 기간대로 지워야 함
 * ------------------------------------------------------------------- */

export const mbxPriceDigestJob = (db: DatabaseService) => priceDigestJob(db);

export async function mbxDailyJob(db: DatabaseService) {
  const s = await mbxSettings(db);
  const recent = await purgeRecent(db, s.recentKeepDays);
  const watches = await purgeWatches(db);
  const dm = await purgeDm(db, s.retentionDays, s.reportKeepDays);
  await db.query(
    `INSERT INTO mbx_purges (recent, watches, messages, reports, threads, detail) VALUES ($1::int, $2::int, $3::int, $4::int, $5::int, $6::jsonb)`,
    [recent, watches, dm.messages, dm.reports, dm.threads, JSON.stringify({ recentKeepDays: s.recentKeepDays, retentionDays: s.retentionDays, reportKeepDays: s.reportKeepDays })]);
  return { recent, watches, ...dm };
}

/** GET /admin/mbx/overview — 스위치 · 설정 · 수(개인 식별 없음) */
export async function mbxOverview(db: DatabaseService) {
  const s = await mbxSettings(db);
  const [c] = await db.query<Record<string, number>>(
    `SELECT (SELECT count(*)::int FROM mbx_recent_views) AS "recentRows",
            (SELECT count(DISTINCT account_id)::int FROM mbx_recent_views) AS "recentMembers",
            (SELECT count(*)::int FROM mbx_price_watches) AS watches,
            (SELECT count(*)::int FROM mbx_price_watches WHERE target_type = 'PRODUCT') AS "productWatches",
            (SELECT coalesce(sum(items), 0)::int FROM mbx_price_digests WHERE sent_on > (now() AT TIME ZONE 'Asia/Seoul')::date - 7) AS "digestLines7",
            (SELECT count(*)::int FROM mbx_price_digests WHERE sent_on > (now() AT TIME ZONE 'Asia/Seoul')::date - 7) AS "digests7",
            (SELECT count(*)::int FROM mbx_dm_threads) AS threads,
            (SELECT count(*)::int FROM mbx_dm_threads WHERE status = 'LOCKED') AS "lockedThreads",
            (SELECT count(*)::int FROM mbx_dm_messages WHERE created_at > now() - interval '30 days') AS "messages30",
            (SELECT count(*)::int FROM mbx_dm_reports WHERE state = 'OPEN') AS "openReports"`);
  const hits = await db.query<{ code: string; n: number }>(
    `SELECT h AS code, count(*)::int AS n FROM mbx_dm_messages, unnest(hit_codes) h WHERE created_at > now() - interval '30 days' GROUP BY h ORDER BY h`);
  const purges = await db.query<Record<string, unknown>>(
    `SELECT id::text AS id, ran_at AS "ranAt", recent, watches, messages, reports, threads FROM mbx_purges ORDER BY id DESC LIMIT 10`);
  return { settings: s, counts: c ?? {}, hits30: Object.fromEntries(hits.map((h) => [h.code, h.n])), purges, jobs: { digest: '매일 08:30', purge: '매일 04:35' } };
}

export interface MbxSettingsInput {
  recent?: boolean; compare?: boolean; priceAlert?: boolean; dm?: boolean; patternMode?: string;
  recentMax?: number; recentKeepDays?: number; watchMax?: number; rateMin?: number; rateDay?: number;
  retentionDays?: number; reportKeepDays?: number; reason: string;
}

/** PUT /admin/mbx/settings(SUPER) — 보낸 칸만 · 사유(설정 바뀐 기록에 남음) */
export async function setMbxSettings(db: DatabaseService, d: MbxSettingsInput) {
  const reason = String(d.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('MBX_REASON', '사유는 2 ~ 200자입니다.');
  const set: Array<[string, string]> = [];
  const sw = (v: boolean | undefined, key: string) => { if (v !== undefined) set.push([key, v ? 'on' : 'off']); };
  sw(d.recent, MBX_KEYS.recent); sw(d.compare, MBX_KEYS.compare); sw(d.priceAlert, MBX_KEYS.priceAlert); sw(d.dm, MBX_KEYS.dm);
  if (d.patternMode !== undefined) {
    if (!['WARN', 'MASK', 'BLOCK'].includes(d.patternMode)) throw new PolicyViolation('MBX_MODE', '감지 방식은 WARN · MASK · BLOCK 중 하나입니다.');
    set.push([MBX_KEYS.patternMode, d.patternMode]);
  }
  /* 범위 = 설정 value_pattern 과 같음(D273 ⑤) · 문구는 칸마다 통째로(영어 사전이 낱말을 끼우지 않게) */
  const range = (v: number | undefined, key: string, lo: number, hi: number, message: string) => {
    if (v === undefined) return;
    if (!Number.isInteger(v) || v < lo || v > hi) throw new PolicyViolation('MBX_RANGE', message);
    set.push([key, String(v)]);
  };
  range(d.recentMax, MBX_KEYS.recentMax, 5, 50, '최근 본 개수는 5 ~ 50 입니다.');
  range(d.recentKeepDays, MBX_KEYS.recentKeepDays, 7, 365, '최근 본 보관 일수는 7 ~ 365 입니다.');
  range(d.watchMax, MBX_KEYS.watchMax, 1, 200, '가격 알림 개수는 1 ~ 200 입니다.');
  range(d.rateMin, MBX_KEYS.rateMin, 1, 60, '1분에 보내는 수는 1 ~ 60 입니다.');
  range(d.rateDay, MBX_KEYS.rateDay, 10, 2000, '하루 보내는 수는 10 ~ 2,000 입니다.');
  range(d.retentionDays, MBX_KEYS.retentionDays, 30, 1825, '대화 보관 일수는 30 ~ 1,825 입니다.');
  range(d.reportKeepDays, MBX_KEYS.reportKeepDays, 30, 1825, '처리한 신고 대화 보관 일수는 30 ~ 1,825 입니다.');
  if (!set.length) throw new PolicyViolation('MBX_NOTHING', '바꿀 것이 없습니다.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  return { ok: true, settings: await mbxSettings(db), note: '회원 편의 기능 설정을 바꿨습니다.' };
}
