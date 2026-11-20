import { DatabaseService } from '../../db/database.service';
import { lsxSettings } from './common';
import { savedDigestJob, savedStats } from './saved';
import { expiryJob, myExpiryRows } from './expiry';
import { bumpCleanup } from './bump';
import { mySummaryRows, summaryJob } from './summary';

/* ---------------------------------------------------------------------
 * v10.513 ~ 516 (D276) 정기 작업 두 개 · 회원 「매물 관리 도구」 · 운영 한눈에
 *   lsx_daily  매일 08:10 — 저장한 검색 묶음 알림(lsx.saved_search on) · 만료 예고 · 만료로 내림(lsx.expiry on)
 *   lsx_hourly 매시간    — 효과 끝난 끌어올림 지움(스위치와 상관없이 · 원래 자리) · AI 요약 초안(lsx.ai_summary · 월 상한)
 * ------------------------------------------------------------------- */

export async function lsxDailyJob(db: DatabaseService) {
  const saved = await savedDigestJob(db);
  const expiry = await expiryJob(db);
  return { made: (saved.sent ?? 0) + (expiry.warned ?? 0) + (expiry.expired ?? 0), saved, expiry };
}

export async function lsxHourlyJob(db: DatabaseService) {
  const bump = await bumpCleanup(db);
  const summary = await summaryJob(db);
  return { made: bump.ended + (summary.made ?? 0), bump, summary };
}

/** 회원 — 내 매물 관리 도구(노출 중 · 만료로 내린 것 · 만료일 · 연장 요청 · 끌어올리기 · AI 요약 상태) */
export async function myListingTools(db: DatabaseService, me: string) {
  const s = await lsxSettings(db);
  const rows = await db.query<{ id: string; title: string; status: string; listingNo: number; publishedAt: string | null; gwanCode: string; liveUntil: string | null; lastBumpAt: string | null }>(
    `SELECT l.id::text, l.title, l.status, l.listing_no AS "listingNo", l.published_at AS "publishedAt", l.gwan_code AS "gwanCode",
            bl.until_at AS "liveUntil", (SELECT max(b.created_at) FROM lsx_bumps b WHERE b.listing_id = l.id) AS "lastBumpAt"
       FROM listings l
       LEFT JOIN lsx_bump_live bl ON bl.listing_id = l.id
       LEFT JOIN lsx_listing_expiry e ON e.listing_id = l.id
      WHERE l.owner_account_id = $1 AND (l.status = 'PUBLISHED' OR (l.status IN ('ARCHIVED', 'IN_REVIEW') AND e.expired_at IS NOT NULL))
      ORDER BY l.published_at DESC NULLS LAST LIMIT 200`, [me]);
  const ex = new Map((await myExpiryRows(db, me)).map((r) => [r.listingId, r]));
  const sm = new Map((await mySummaryRows(db, me)).map((r) => [r.listingId, r]));
  const [used] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM lsx_bumps WHERE account_id = $1 AND kind = 'FREE' AND created_at > now() - make_interval(days => $2::int)`, [me, s.bumpPeriodDays]);
  return {
    policy: {
      expiryOn: s.expiry, warnDays: s.expiryWarnDays, bumpMode: s.bumpMode, effectHours: s.bumpEffectHours, minHours: s.bumpMinHours,
      freeCount: s.bumpFreeCount, freeLeft: Math.max(0, s.bumpFreeCount - (used?.n ?? 0)), periodDays: s.bumpPeriodDays, aiSummary: s.aiSummary,
    },
    items: rows.map((r) => {
      const e = ex.get(r.id); const a = sm.get(r.id);
      return {
        ...r,
        expiresAt: e?.expiresAt ?? null, expiredByDate: !!e?.expiredAt,
        daysLeft: e?.expiresAt ? Math.ceil((new Date(e.expiresAt).getTime() - Date.now()) / 86400_000) : null,
        request: e?.requestState ? { state: e.requestState, months: e.requestMonths, rejectReason: e.rejectReason } : null,
        summary: a ? { state: a.state, lines: a.lines ? a.lines.split('\n') : null } : null,
      };
    }),
  };
}

/** 운영 — 한눈에(설정 · 숫자) */
export async function lsxOverview(db: DatabaseService) {
  const s = await lsxSettings(db);
  const [ex] = await db.query<{ soon: number; past: number; expired30: number; requests: number; backfill: number }>(
    `SELECT count(*) FILTER (WHERE l.status = 'PUBLISHED' AND e.expires_at > now() AND e.expires_at <= now() + make_interval(days => $1::int))::int AS soon,
            count(*) FILTER (WHERE l.status = 'PUBLISHED' AND e.expires_at <= now())::int AS past,
            count(*) FILTER (WHERE e.expired_at > now() - interval '30 days')::int AS expired30,
            (SELECT count(*)::int FROM lsx_extend_requests WHERE state = 'REQUESTED') AS requests,
            count(*) FILTER (WHERE e.set_kind = 'BACKFILL')::int AS backfill
       FROM lsx_listing_expiry e JOIN listings l ON l.id = e.listing_id`, [s.expiryWarnDays]);
  const [ai] = await db.query<{ draft: number; approved: number; failed: number }>(
    `SELECT count(*) FILTER (WHERE state = 'DRAFT')::int AS draft, count(*) FILTER (WHERE state = 'APPROVED')::int AS approved,
            count(*) FILTER (WHERE state = 'FAILED')::int AS failed FROM lsx_ai_summaries`);
  const [bp] = await db.query<{ live: number; d7: number }>(
    `SELECT (SELECT count(*)::int FROM lsx_bump_live) AS live, (SELECT count(*)::int FROM lsx_bumps WHERE created_at > now() - interval '7 days') AS d7`);
  return { settings: s, saved: await savedStats(db), expiry: ex, bump: bp, summary: ai };
}
