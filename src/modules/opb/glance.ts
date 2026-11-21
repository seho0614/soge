import { DatabaseService } from '../../db/database.service';
import { addDays, kstToday, metrics, type Metrics } from '../admin/report-day';

/* ---------------------------------------------------------------------
 * v10.571 (docs/713) 대표 한눈에 — 읽기만 · SUPER
 *   가입 · 탈퇴 · 매물 · 요청 · 거래 · 성사 · 소개몰 결제 주문 · 매출 · 정산 지급 · 문의 · 답변 · 경고 · 급한 알림을
 *   오늘(지금까지) · 어제 · 그저께 · 지난 7일(어제까지) · 그 앞 7일로 나란히 — 숫자는 일보(report-day.ts metrics)와 같은 셈을 그대로 씀.
 *   지금 상태: 아직 확인 안 한 급한 알림 · 오픈 차단 · 열린 문의 · 기한 넘긴 문의 · 정산 대기 · 소개몰 정산 지급 대기.
 *   이름 · 연락처 · 금액 명세는 넣지 않음(합계만) · 감사 기록 남기지 않음(개인정보 없음 · 숫자만).
 * ------------------------------------------------------------------- */

type Period = 'today' | 'yesterday' | 'dayBefore' | 'week' | 'prevWeek';
const PERIODS: Period[] = ['today', 'yesterday', 'dayBefore', 'week', 'prevWeek'];

interface Money { stlPaid: number; stlPaidAmt: number; hltPaidAmt: number }

async function money(db: DatabaseService, from: string, to: string): Promise<Money> {
  const [m] = await db.query<{ stlPaid: number; stlPaidAmt: string; hltPaidAmt: string }>(
    `SELECT (SELECT count(*) FROM settlements WHERE status = 'PAID' AND paid_at IS NOT NULL AND (paid_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)::int AS "stlPaid",
            (SELECT coalesce(sum(amount), 0) FROM settlements WHERE status = 'PAID' AND paid_at IS NOT NULL AND (paid_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)::text AS "stlPaidAmt",
            (SELECT coalesce(sum(net_amount), 0) FROM hlt_settlements WHERE status = 'PAID' AND paid_at IS NOT NULL AND (paid_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)::text AS "hltPaidAmt"`,
    [from, to]).catch(() => [{ stlPaid: 0, stlPaidAmt: '0', hltPaidAmt: '0' }]);
  return { stlPaid: Number(m?.stlPaid ?? 0), stlPaidAmt: Number(m?.stlPaidAmt ?? 0), hltPaidAmt: Number(m?.hltPaidAmt ?? 0) };
}

/** 줄 정의 — [키, 이름, 단위, 묶음, 값 꺼내기] · 좋은 방향(up = 늘면 좋음 · down = 줄면 좋음 · none) */
const ROWS: Array<[string, string, '건' | '원', string, 'up' | 'down' | 'none', (m: Metrics, x: Money) => number]> = [
  ['signups', '가입', '건', '회원', 'up', (m) => m.members.signups],
  ['withdrawals', '탈퇴', '건', '회원', 'down', (m) => m.members.withdrawals],
  ['listings', '매물 등록', '건', '거래', 'up', (m) => m.trade.listings],
  ['requests', '요청', '건', '거래', 'up', (m) => m.trade.requests],
  ['deals', '거래 시작', '건', '거래', 'up', (m) => m.trade.deals],
  ['dealsConfirmed', '거래 성사', '건', '거래', 'up', (m) => m.trade.dealsConfirmed],
  ['paidOrders', '소개몰 결제 주문', '건', '소개몰', 'up', (m) => m.mall.paidOrders],
  ['paidTotal', '소개몰 매출(결제 합계)', '원', '소개몰', 'up', (m) => m.mall.paidTotal],
  ['mallCanceled', '소개몰 취소 · 반품', '건', '소개몰', 'down', (m) => m.mall.canceled],
  ['stlPaid', '소개비 정산 지급', '건', '정산', 'none', (_m, x) => x.stlPaid],
  ['stlPaidAmt', '소개비 정산 지급액', '원', '정산', 'none', (_m, x) => x.stlPaidAmt],
  ['hltPaidAmt', '소개몰 판매자 정산 지급액', '원', '정산', 'none', (_m, x) => x.hltPaidAmt],
  ['inquiries', '1:1 문의', '건', '고객센터', 'none', (m) => m.cs.inquiries],
  ['answered', '문의 답변', '건', '고객센터', 'up', (m) => m.cs.answered],
  ['warn', '경고 알림', '건', '운영', 'down', (m) => m.alerts.warn],
  ['critical', '급한 알림', '건', '운영', 'down', (m) => m.alerts.critical],
];

export async function opbGlance(db: DatabaseService) {
  const today = kstToday();
  const range: Record<Period, [string, string]> = {
    today: [today, today], yesterday: [addDays(today, -1), addDays(today, -1)], dayBefore: [addDays(today, -2), addDays(today, -2)],
    week: [addDays(today, -7), addDays(today, -1)], prevWeek: [addDays(today, -14), addDays(today, -8)],
  };
  const got = await Promise.all(PERIODS.map(async (p) => [p, await metrics(db, range[p][0], range[p][1]), await money(db, range[p][0], range[p][1])] as const));
  const by = Object.fromEntries(got.map(([p, m, x]) => [p, { m, x }])) as Record<Period, { m: Metrics; x: Money }>;
  const rows = ROWS.map(([key, label, unit, group, good, f]) => {
    const v = Object.fromEntries(PERIODS.map((p) => [p, f(by[p].m, by[p].x)])) as Record<Period, number>;
    const pct = (a: number, b: number) => (b === 0 ? (a === 0 ? 0 : null) : Math.round(((a - b) / b) * 1000) / 10);
    return { key, label, unit, group, good, ...v, dayPct: pct(v.yesterday, v.dayBefore), weekPct: pct(v.week, v.prevWeek) };
  });

  const [st] = await db.query<Record<string, string | number | null>>(
    `SELECT (SELECT count(*) FROM ops_alerts WHERE severity = 'CRITICAL' AND acknowledged_at IS NULL AND resolved_at IS NULL)::int AS "openCritical",
            (SELECT count(*) FROM ops_alerts WHERE acknowledged_at IS NULL AND resolved_at IS NULL AND raised_at > now() - interval '7 days')::int AS "openAlerts7d",
            (SELECT count(*) FROM v_open_blockers)::int AS blockers,
            (SELECT count(*) FROM settlements WHERE status = 'REQUESTED')::int AS "stlRequested",
            (SELECT coalesce(sum(amount), 0) FROM settlements WHERE status = 'REQUESTED')::text AS "stlRequestedAmt",
            (SELECT count(*) FROM settlements WHERE status = 'HELD')::int AS "stlHeld",
            (SELECT count(*) FROM hlt_settlements WHERE status = 'CONFIRMED')::int AS "hltConfirmed",
            (SELECT coalesce(sum(net_amount), 0) FROM hlt_settlements WHERE status = 'CONFIRMED')::text AS "hltConfirmedAmt",
            (SELECT count(*) FROM hlt_settlements WHERE status = 'DRAFT')::int AS "hltDraft"`).catch(() => [{} as Record<string, string | number | null>]);
  const n = (k: string) => Number(st?.[k] ?? 0);
  const alerts = await db.query<{ id: string; code: string; title: string; at: string }>(
    `SELECT id::text AS id, alert_code AS code, title, to_char(raised_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS at
       FROM ops_alerts WHERE severity = 'CRITICAL' AND acknowledged_at IS NULL AND resolved_at IS NULL ORDER BY id DESC LIMIT 5`).catch(() => []);
  const blockers = await db.query<{ kind: string; item: string; reason: string }>(
    `SELECT kind, item, reason FROM v_open_blockers ORDER BY kind, item LIMIT 5`).catch(() => []);

  return {
    today, range, rows,
    now: {
      openCritical: n('openCritical'), openAlerts7d: n('openAlerts7d'), blockers: n('blockers'),
      inquiriesOpen: by.today.m.cs.openNow, inquiriesOverdue: by.today.m.cs.overdueNow,
      stlRequested: n('stlRequested'), stlRequestedAmt: n('stlRequestedAmt'), stlHeld: n('stlHeld'),
      hltConfirmed: n('hltConfirmed'), hltConfirmedAmt: n('hltConfirmedAmt'), hltDraft: n('hltDraft'),
    },
    alerts, blockers,
    note: '오늘은 지금까지 · 지난 7일은 어제까지 · 숫자는 일보와 같은 셈(한국 날짜) · 이름 · 연락처 · 금액 명세 없음(합계만).',
  };
}
