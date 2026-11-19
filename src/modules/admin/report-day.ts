import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { serverHealth } from '../../common/server-health';
import { deadlines } from '../acct/month';

/* ---------------------------------------------------------------------
 * v10.412 (D250 · docs/549) 일보 — 하루(한국 날짜) 한 장
 *   회원(가입 · 탈퇴) · 거래(매물 · 요청 · 소개 · 성사) · 소개몰 주문 · 매출(전표 · 공급가) · 고객센터(문의 · 답변) ·
 *   운영 알림(경고 이상) · 회계 할 일(신고 기한 · 회계 알림) · 서버(디스크) · 업무 일지(몇 명 · 몇 건).
 *   숫자만 — 이름 · 연락처 · 금액 상세는 넣지 않음(보내기 · CSV 도 같음).
 *   이미 있는 「운영 하루 요약」(launch_digest · 매일 09:00)은 그대로 — 이 보고는 같은 숫자를 기간으로 모아 남기는 것.
 * ------------------------------------------------------------------- */

export const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
export const dayOk = (d: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d ?? '') || Number.isNaN(Date.parse(d + 'T00:00:00Z'))) throw new PolicyViolation('REPORT_PERIOD', '날짜는 YYYY-MM-DD 입니다.');
  return d;
};

export interface Metrics {
  members: { signups: number; withdrawals: number };
  trade: { listings: number; requests: number; deals: number; dealsConfirmed: number };
  mall: { orders: number; paidOrders: number; paidTotal: number; canceled: number };
  money: { revenue: number; expense: number; profit: number; entries: number };
  cs: { inquiries: number; answered: number; openNow: number; overdueNow: number };
  alerts: { warn: number; critical: number; openCriticalNow: number };
  worklog: { entries: number; staff: number; minutes: number; reviewed: number };
}

/** [from, to](한국 날짜 · 끝 포함) 숫자 — 표가 없으면 0(to_regclass) */
export async function metrics(db: DatabaseService, from: string, to: string): Promise<Metrics> {
  const [m] = await db.query<Record<string, string | number | null>>(
    `SELECT (SELECT count(*) FROM accounts WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)::int AS signups,
            (SELECT count(*) FROM account_withdrawals WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)::int AS withdrawals,
            (SELECT count(*) FROM listings WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)::int AS listings,
            (SELECT count(*) FROM requests WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)::int AS requests,
            (SELECT count(*) FROM deals WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)::int AS deals,
            (SELECT count(*) FROM deals WHERE confirmed_at IS NOT NULL AND (confirmed_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)::int AS "dealsConfirmed",
            (SELECT count(*) FROM hlt_orders WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)::int AS orders,
            (SELECT count(*) FROM hlt_orders WHERE status IN ('PAID', 'PREPARING', 'SHIPPED', 'DELIVERED') AND (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)::int AS "paidOrders",
            (SELECT coalesce(sum(total), 0) FROM hlt_orders WHERE status IN ('PAID', 'PREPARING', 'SHIPPED', 'DELIVERED') AND (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)::bigint AS "paidTotal",
            (SELECT count(*) FROM hlt_orders WHERE status IN ('CANCELED', 'RETURNED') AND (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)::int AS canceled,
            (SELECT count(*) FROM inquiries WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)::int AS inquiries,
            (SELECT count(*) FROM inquiries WHERE answered_at IS NOT NULL AND (answered_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)::int AS answered,
            (SELECT count(*) FROM inquiries WHERE status = 'OPEN')::int AS "openNow",
            (SELECT count(*) FROM inquiries WHERE status = 'OPEN' AND due_at < now())::int AS "overdueNow",
            (SELECT count(*) FROM ops_alerts WHERE severity = 'WARN' AND (raised_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)::int AS warn,
            (SELECT count(*) FROM ops_alerts WHERE severity = 'CRITICAL' AND (raised_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)::int AS critical,
            (SELECT count(*) FROM ops_alerts WHERE severity = 'CRITICAL' AND acknowledged_at IS NULL AND resolved_at IS NULL)::int AS "openCriticalNow"`,
    [from, to]);
  const acct = await db.query<{ kind: string; d: string; c: string; n: number }>(
    `SELECT a.kind, coalesce(sum(l.debit), 0)::text AS d, coalesce(sum(l.credit), 0)::text AS c, count(DISTINCT e.id)::int AS n
       FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id JOIN acct_accounts a ON a.role = l.role
      WHERE e.entry_date BETWEEN $1::date AND $2::date AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')
      GROUP BY a.kind`, [from, to]).catch(() => [] as Array<{ kind: string; d: string; c: string; n: number }>);
  const rev = acct.filter((x) => x.kind === 'REVENUE').reduce((s, x) => s + Number(x.c) - Number(x.d), 0);
  const exp = acct.filter((x) => x.kind === 'EXPENSE').reduce((s, x) => s + Number(x.d) - Number(x.c), 0);
  const [en] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM acct_entries WHERE entry_date BETWEEN $1::date AND $2::date`, [from, to]).catch(() => [{ n: 0 }]);
  const [w] = await db.query<{ entries: number; staff: number; minutes: number; reviewed: number }>(
    `SELECT count(*)::int AS entries, count(DISTINCT account_id)::int AS staff, coalesce(sum(minutes), 0)::int AS minutes,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM staff_worklog_reviews r WHERE r.worklog_id = w.id))::int AS reviewed
       FROM staff_worklogs w WHERE w.work_date BETWEEN $1::date AND $2::date`, [from, to]).catch(() => [{ entries: 0, staff: 0, minutes: 0, reviewed: 0 }]);
  const n = (k: string) => Number(m?.[k] ?? 0);
  return {
    members: { signups: n('signups'), withdrawals: n('withdrawals') },
    trade: { listings: n('listings'), requests: n('requests'), deals: n('deals'), dealsConfirmed: n('dealsConfirmed') },
    mall: { orders: n('orders'), paidOrders: n('paidOrders'), paidTotal: n('paidTotal'), canceled: n('canceled') },
    money: { revenue: rev, expense: exp, profit: rev - exp, entries: Number(en?.n ?? 0) },
    cs: { inquiries: n('inquiries'), answered: n('answered'), openNow: n('openNow'), overdueNow: n('overdueNow') },
    alerts: { warn: n('warn'), critical: n('critical'), openCriticalNow: n('openCriticalNow') },
    worklog: { entries: Number(w?.entries ?? 0), staff: Number(w?.staff ?? 0), minutes: Number(w?.minutes ?? 0), reviewed: Number(w?.reviewed ?? 0) },
  };
}

/** 회계 할 일 · 서버 — 「지금」 기준(보고를 만든 때) */
export async function nowState(db: DatabaseService) {
  type Dl = { list: Array<{ label: string; due: string; daysLeft: number }> };
  const dl: Dl = await deadlines(db).catch((): Dl => ({ list: [] }));
  const [a] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ops_alerts WHERE alert_code LIKE 'ACCT\\_%' AND resolved_at IS NULL`).catch(() => [{ n: 0 }]);
  const h = serverHealth();
  return {
    acct: { openAlerts: Number(a?.n ?? 0), deadlines: dl.list.slice(0, 3).map((d) => ({ label: d.label, due: d.due, daysLeft: d.daysLeft })) },
    server: { diskUsedPct: h.disk?.usedPct ?? null, diskFreeGB: h.disk?.freeGB ?? null },
  };
}

/** 상위 5 — 문의 분야 · 소개몰 상품(수량) · 매물 관(있는 것만) */
export async function tops(db: DatabaseService, from: string, to: string) {
  const q = async (sql: string) => db.query<{ k: string; n: number }>(sql, [from, to]).catch(() => [] as Array<{ k: string; n: number }>);
  return {
    inquiryCategory: await q(`SELECT category AS k, count(*)::int AS n FROM inquiries WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5`),
    mallProduct: await q(`SELECT p.name AS k, sum(it.qty)::int AS n FROM hlt_order_items it JOIN hlt_orders o ON o.id = it.order_id JOIN hlt_products p ON p.id = it.product_id
                            WHERE o.status IN ('PAID', 'PREPARING', 'SHIPPED', 'DELIVERED') AND (o.created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date
                            GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5`),
  };
}

export interface ReportBody { kind: 'DAY' | 'WEEK' | 'MONTH'; period: string; from: string; to: string; made: string; m: Metrics; prev?: Metrics | null; change?: Record<string, number | null>; tops?: Awaited<ReturnType<typeof tops>>; now: Awaited<ReturnType<typeof nowState>> }

/** 일보 본문 — 하루 · 전날 대비 */
export async function buildDay(db: DatabaseService, day: string): Promise<ReportBody> {
  dayOk(day);
  const m = await metrics(db, day, day), prev = await metrics(db, addDays(day, -1), addDays(day, -1));
  return { kind: 'DAY', period: day, from: day, to: day, made: new Date().toISOString(), m, prev, change: changeOf(m, prev), tops: await tops(db, day, day), now: await nowState(db) };
}

/** 증감 % — 지난 기간이 0 이면 null */
export function changeOf(a: Metrics, b: Metrics | null | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  if (!b) return out;
  for (const g of Object.keys(a) as Array<keyof Metrics>) for (const k of Object.keys(a[g])) {
    const x = Number((a[g] as Record<string, number>)[k]), y = Number((b[g] as Record<string, number>)[k]);
    out[`${g}.${k}`] = y ? Math.round(((x - y) / Math.abs(y)) * 1000) / 10 : null;
  }
  return out;
}

const KIND_KO = { DAY: '일보', WEEK: '주보', MONTH: '월보' } as const;
const pct = (v: number | null | undefined) => (v == null ? '' : ` (${v > 0 ? '+' : ''}${v}%)`);
const w = (n: number) => n.toLocaleString('ko-KR');

/** 보내기 · 화면 위 한 장 글(숫자만) */
export function textOf(b: ReportBody): string {
  const c = b.change ?? {}, m = b.m;
  const range = b.from === b.to ? b.from : `${b.from} ~ ${b.to}`;
  return [
    `[소개뱅크] 업무 ${KIND_KO[b.kind]} ${range}`,
    `회원 가입 ${w(m.members.signups)}${pct(c['members.signups'])} · 탈퇴 ${w(m.members.withdrawals)}`,
    `거래 매물 ${w(m.trade.listings)} · 요청 ${w(m.trade.requests)} · 소개 ${w(m.trade.deals)}${pct(c['trade.deals'])} · 성사 ${w(m.trade.dealsConfirmed)}`,
    `소개몰 주문 ${w(m.mall.orders)} · 결제 ${w(m.mall.paidOrders)}건 ${w(m.mall.paidTotal)}원${pct(c['mall.paidTotal'])} · 취소 · 반품 ${w(m.mall.canceled)}`,
    `매출(전표 · 공급가) ${w(m.money.revenue)}원${pct(c['money.revenue'])} · 비용 ${w(m.money.expense)}원 · 이익 ${w(m.money.profit)}원`,
    `고객센터 문의 ${w(m.cs.inquiries)} · 답변 ${w(m.cs.answered)} · 지금 답변 전 ${w(m.cs.openNow)}(기한 넘김 ${w(m.cs.overdueNow)})`,
    `운영 알림 경고 ${w(m.alerts.warn)} · 긴급 ${w(m.alerts.critical)} · 지금 확인 안 한 긴급 ${w(m.alerts.openCriticalNow)}`,
    `회계 알림 열림 ${w(b.now.acct.openAlerts)}${b.now.acct.deadlines.length ? ' · 다가오는 기한 ' + b.now.acct.deadlines.map((d) => `${d.label} ${d.due}`).join(' · ') : ''}`,
    `업무 일지 ${w(m.worklog.staff)}명 ${w(m.worklog.entries)}건 · ${w(Math.round(m.worklog.minutes / 6) / 10)}시간 · 확인 ${w(m.worklog.reviewed)}`,
    `서버 디스크 ${b.now.server.diskUsedPct ?? '—'}%`,
    '운영 화면 › 보고에서 자세히 볼 수 있습니다.',
  ].join('\n');
}

/** CSV 줄 — 항목 · 이번 · 지난 · 증감 % */
export function csvRowsOf(b: ReportBody): { head: string[]; rows: unknown[][] } {
  const LABEL: Record<string, string> = {
    'members.signups': '가입', 'members.withdrawals': '탈퇴', 'trade.listings': '매물', 'trade.requests': '요청', 'trade.deals': '소개', 'trade.dealsConfirmed': '성사',
    'mall.orders': '소개몰 주문', 'mall.paidOrders': '결제 주문', 'mall.paidTotal': '결제 금액', 'mall.canceled': '취소 · 반품',
    'money.revenue': '매출(공급가)', 'money.expense': '비용', 'money.profit': '이익', 'money.entries': '전표',
    'cs.inquiries': '문의', 'cs.answered': '답변', 'cs.openNow': '답변 전(만들 때)', 'cs.overdueNow': '기한 넘김(만들 때)',
    'alerts.warn': '경고 알림', 'alerts.critical': '긴급 알림', 'alerts.openCriticalNow': '확인 안 한 긴급(만들 때)',
    'worklog.entries': '업무 일지', 'worklog.staff': '일지 쓴 사람 수', 'worklog.minutes': '일지 시간(분)', 'worklog.reviewed': '일지 확인',
  };
  const rows: unknown[][] = [];
  for (const g of Object.keys(b.m) as Array<keyof Metrics>) for (const k of Object.keys(b.m[g])) {
    const key = `${g}.${k}`;
    rows.push([LABEL[key] ?? key, (b.m[g] as Record<string, number>)[k], b.prev ? (b.prev[g] as Record<string, number>)[k] : '', b.change?.[key] ?? '']);
  }
  return { head: ['항목', `이번(${b.from === b.to ? b.from : b.from + ' ~ ' + b.to})`, '지난 기간', '증감 %'], rows };
}
