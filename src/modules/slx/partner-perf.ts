import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { PartnerActorService } from '../partner/partner-actor.service';

/* ---------------------------------------------------------------------
 * v10.534 (D281 · docs/672) 파트너 성과 대시보드 — 대표 11/20 「(51) ③ 파트너 성과 대시보드」
 *   기간(30일 = 날마다 · 90일 = 주마다 · 12개월 = 달마다 · 한국 시각) 묶음 그래프 + 요약 + 앞 기간과 비교
 *   받은 리드 · 연락처 열람 · 응답 속도(받고 열기까지 분 · 평균 · 가운데 값 · 1시간 안 비율) · 리드 전환(성사 = 소비자 확인 이행 보고)
 *   · 리드 이용료 확정 · 받은 정산(지급 끝남)
 *   파트너센터(GET /partner/perf-trend) = 로그인한 사람의 파트너 것만(대표 · 합류 직원) — 돈 칸(이용료 · 정산)은 대표 · 정산 권한 직원만
 *   운영 화면(GET /admin/partner-perf) = 모든 파트너 합 · 파트너 고르기 · 순위(받은 리드 · 성사 · 이용료) — ADMIN · SUPER · 안심 파트너 담당(PARTNER_MAL)
 *   셈은 DB 함수 fn_ptn_perf_series 한 곳(읽기만)
 * ------------------------------------------------------------------- */

export const PERF_PERIODS = ['30d', '90d', '12m'] as const;
export const PERF_SORTS = ['received', 'confirmed', 'fee'] as const;
const n = (v: unknown) => Number(v ?? 0);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export interface PerfRange { period: string; unit: 'day' | 'week' | 'month'; from: string; to: string; prevFrom: string; prevTo: string }
export interface PerfPoint { bucket: string; received: number; viewed: number; viewMinAvg: number | null; viewMinP50: number | null; confirmed: number; feeBilled: number | null; paidOut: number | null }
export interface PerfSummary { received: number; viewed: number; viewRate: number | null; viewMinAvg: number | null; viewMinP50: number | null; viewedIn1h: number; in1hRate: number | null;
  confirmed: number; convRate: number | null; feeBilled: number | null; paidOut: number | null }

/** 기간 → 묶음 단위 · 시작 · 끝(오늘 · 한국) · 앞 기간 */
export function perfRange(periodIn?: string): PerfRange {
  const period = (PERF_PERIODS as readonly string[]).includes(String(periodIn ?? '')) ? String(periodIn) : '30d';
  const today = new Date(Date.now() + 9 * 3600e3);
  today.setUTCHours(0, 0, 0, 0);
  const add = (d: Date, days: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + days); return x; };
  if (period === '12m') {
    const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
    const prevFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 23, 1));
    return { period, unit: 'month', from: ymd(from), to: ymd(today), prevFrom: ymd(prevFrom), prevTo: ymd(add(from, -1)) };
  }
  const days = period === '90d' ? 90 : 30;
  const from = add(today, -(days - 1));
  return { period, unit: period === '90d' ? 'week' : 'day', from: ymd(from), to: ymd(today), prevFrom: ymd(add(from, -days)), prevTo: ymd(add(from, -1)) };
}

async function series(db: DatabaseService, partnerId: string | null, from: string, to: string, unit: string, money: boolean): Promise<PerfPoint[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT to_char(bucket, 'YYYY-MM-DD') AS bucket, received, viewed, view_min_avg::float AS "viewMinAvg", view_min_p50::float AS "viewMinP50", confirmed,
            fee_billed::bigint AS "feeBilled", paid_out::bigint AS "paidOut"
       FROM fn_ptn_perf_series($1::uuid, $2::date, $3::date, $4::text)`, [partnerId, from, to, unit]);
  return rows.map((r) => ({
    bucket: String(r.bucket), received: n(r.received), viewed: n(r.viewed),
    viewMinAvg: r.viewMinAvg == null ? null : n(r.viewMinAvg), viewMinP50: r.viewMinP50 == null ? null : n(r.viewMinP50),
    confirmed: n(r.confirmed), feeBilled: money ? n(r.feeBilled) : null, paidOut: money ? n(r.paidOut) : null }));
}

async function summary(db: DatabaseService, partnerId: string | null, from: string, to: string, pts: PerfPoint[], money: boolean): Promise<PerfSummary> {
  const [s] = await db.query<Record<string, unknown>>(
    `SELECT count(*)::int AS received, count(*) FILTER (WHERE viewed_at IS NOT NULL)::int AS viewed,
            round((avg(EXTRACT(epoch FROM (viewed_at - delivered_at)) / 60) FILTER (WHERE viewed_at IS NOT NULL))::numeric, 1)::float AS "viewMinAvg",
            round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(epoch FROM (viewed_at - delivered_at)) / 60) FILTER (WHERE viewed_at IS NOT NULL))::numeric, 1)::float AS "viewMinP50",
            count(*) FILTER (WHERE viewed_at IS NOT NULL AND viewed_at - delivered_at <= interval '1 hour')::int AS "viewedIn1h"
       FROM lead_deliveries
      WHERE ($1::uuid IS NULL OR partner_id = $1::uuid) AND state <> 'REVOKED'
        AND delivered_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Seoul') AND delivered_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul')`, [partnerId, from, to]);
  const received = n(s?.received), viewed = n(s?.viewed), in1h = n(s?.viewedIn1h);
  const confirmed = pts.reduce((a, p) => a + p.confirmed, 0);
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  return {
    received, viewed, viewRate: pct(viewed, received), viewMinAvg: s?.viewMinAvg == null ? null : n(s.viewMinAvg), viewMinP50: s?.viewMinP50 == null ? null : n(s.viewMinP50),
    viewedIn1h: in1h, in1hRate: pct(in1h, viewed), confirmed, convRate: pct(confirmed, received),
    feeBilled: money ? pts.reduce((a, p) => a + n(p.feeBilled), 0) : null, paidOut: money ? pts.reduce((a, p) => a + n(p.paidOut), 0) : null,
  };
}

async function bundle(db: DatabaseService, partnerId: string | null, periodIn: string | undefined, money: boolean) {
  const r = perfRange(periodIn);
  const pts = await series(db, partnerId, r.from, r.to, r.unit, money);
  const sum = await summary(db, partnerId, r.from, r.to, pts, money);
  const prevPts = await series(db, partnerId, r.prevFrom, r.prevTo, r.unit, money);
  const prev = await summary(db, partnerId, r.prevFrom, r.prevTo, prevPts, money);
  return { range: r, series: pts, summary: sum, prev };
}

/* ── 파트너센터 ── */

/** GET /partner/perf-trend?period= — 내 파트너 것만(대표 · 합류 직원) · 돈 칸은 대표 · 정산 권한 직원만 */
export async function myPerfTrend(db: DatabaseService, actors: PartnerActorService, me: string | null, period?: string) {
  if (!me) throw new PolicyViolation('UNAUTHORIZED', '로그인이 필요합니다.');
  const p = await actors.forMember(me);   // 대표 또는 합류한 직원의 파트너 · canMoney = 대표 · 정산 권한 직원
  if (!p) throw new StateConflict('NOT_PARTNER', '파트너가 아닙니다.');
  const money = !!p.canMoney;
  const b = await bundle(db, String(p.id), period, money);
  return { ...b, partner: { company: p.company, grade: p.grade }, money,
    note: '받은 리드 · 열람 · 응답 속도는 리드를 받은 날, 성사는 소비자가 확인한 날, 이용료는 확정된 날, 정산은 지급된 날로 셉니다(한국 시각). 다른 파트너의 숫자는 보이지 않습니다.' };
}

/* ── 운영 화면 › 파트너사 › 파트너 성과 ── */

/** GET /admin/partner-perf?period=&partnerId=&sort= — 모두 합(또는 고른 파트너) · 순위 100 */
export async function adminPerf(db: DatabaseService, period?: string, partnerId?: string, sortIn?: string) {
  const pid = String(partnerId ?? '').trim() || null;
  if (pid && !/^[0-9a-f-]{36}$/i.test(pid)) throw new NotFound('파트너를 찾을 수 없습니다.');
  let picked: { id: string; company: string; grade: string | null } | null = null;
  if (pid) {
    const [p] = await db.query<{ id: string; company: string; grade: string | null }>(
      `SELECT p.id::text AS id, b.company_name AS company, p.grade FROM partners p JOIN businesses b ON b.id = p.business_id WHERE p.id = $1::uuid`, [pid]);
    if (!p) throw new NotFound('파트너를 찾을 수 없습니다.');
    picked = p;
  }
  const b = await bundle(db, pid, period, true);
  const sort = (PERF_SORTS as readonly string[]).includes(String(sortIn ?? '')) ? String(sortIn) : 'received';
  const rank = await db.query<Record<string, unknown>>(
    `WITH d AS (
       SELECT partner_id, count(*)::int AS received, count(*) FILTER (WHERE viewed_at IS NOT NULL)::int AS viewed,
              round((avg(EXTRACT(epoch FROM (viewed_at - delivered_at)) / 60) FILTER (WHERE viewed_at IS NOT NULL))::numeric, 1)::float AS view_min
         FROM lead_deliveries
        WHERE state <> 'REVOKED' AND delivered_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Seoul') AND delivered_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul')
        GROUP BY partner_id
     ), c AS (
       SELECT partner_id, count(*)::int AS confirmed FROM partner_fulfillment_reports
        WHERE consumer_state = 'CONFIRMED' AND consumer_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Seoul') AND consumer_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul')
        GROUP BY partner_id
     ), f AS (
       SELECT partner_id, coalesce(sum(amount), 0)::bigint AS fee FROM lead_fees
        WHERE state = 'BILLED' AND billed_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Seoul') AND billed_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul')
        GROUP BY partner_id
     )
     SELECT p.id::text AS "partnerId", b.company_name AS company, p.grade, p.status,
            coalesce(d.received, 0) AS received, coalesce(d.viewed, 0) AS viewed, d.view_min AS "viewMinAvg",
            coalesce(c.confirmed, 0) AS confirmed, coalesce(f.fee, 0)::bigint AS "feeBilled"
       FROM partners p JOIN businesses b ON b.id = p.business_id
       LEFT JOIN d ON d.partner_id = p.id LEFT JOIN c ON c.partner_id = p.id LEFT JOIN f ON f.partner_id = p.id
      WHERE coalesce(d.received, 0) + coalesce(c.confirmed, 0) + coalesce(f.fee, 0) > 0
      ORDER BY CASE $3::text WHEN 'confirmed' THEN coalesce(c.confirmed, 0)::bigint WHEN 'fee' THEN coalesce(f.fee, 0)::bigint ELSE coalesce(d.received, 0)::bigint END DESC, b.company_name
      LIMIT 100`, [b.range.from, b.range.to, sort]);
  return {
    ...b, picked, sort,
    rank: rank.map((r) => {
      const rec = n(r.received), conf = n(r.confirmed);
      return { ...r, received: rec, viewed: n(r.viewed), viewMinAvg: r.viewMinAvg == null ? null : n(r.viewMinAvg), confirmed: conf, feeBilled: n(r.feeBilled),
        convRate: rec > 0 ? Math.round((conf / rec) * 1000) / 10 : null };
    }),
    note: picked ? `「${picked.company}」 한 곳의 숫자입니다.` : '모든 파트너 합입니다 — 순위에서 파트너를 누르면 그 파트너만 봅니다.',
  };
}
