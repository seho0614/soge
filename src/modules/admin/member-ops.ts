/* ---------------------------------------------------------------------
 * v10.364 (docs/498) — 역할별 「오늘 할 일」 — 첫 화면 맨 위(검수자 · 지급 담당 · 파트너 담당도)
 *   줄마다: 이름 · 수 · 가장 오래된 때 · 넘김(기한 넘김 · 급함) · 갈 탭. 내 역할에 맞는 줄만(SUPER 는 모두).
 * ------------------------------------------------------------------- */
interface Q { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> }

export interface TodoItem { key: string; label: string; n: number; oldest: string | null; over: number; tab: string }

export async function staffTodo(db: Q, roles: string[], eff: Set<string> | null = null): Promise<{ items: TodoItem[]; total: number }> {   // v10.615 eff — perm.mode GROUPS 일 때 실제 권한(pgxEffective) · 아니면 null
  const has = (...r: string[]) => roles.includes('SUPER') || r.some((x) => roles.includes(x));
  const [c] = await db.query<Record<string, number | string | null>>(
    `SELECT (SELECT count(*)::int FROM review_items WHERE status IN ('QUEUED', 'IN_PROGRESS')) AS review_n,
            (SELECT min(submitted_at) FROM review_items WHERE status IN ('QUEUED', 'IN_PROGRESS')) AS review_old,
            (SELECT count(*)::int FROM review_items WHERE status IN ('QUEUED', 'IN_PROGRESS') AND sla_due_at < now()) AS review_over,
            (SELECT count(*)::int FROM point_cashouts WHERE status = 'CONFIRMED') AS pay_n,
            (SELECT min(confirmed_at) FROM point_cashouts WHERE status = 'CONFIRMED') AS pay_old,
            (SELECT count(*)::int FROM point_cashouts WHERE status = 'REQUESTED') AS cash_n,
            (SELECT min(requested_at) FROM point_cashouts WHERE status = 'REQUESTED') AS cash_old,
            (SELECT count(*)::int FROM inquiries WHERE status = 'OPEN') AS inq_n,
            (SELECT min(created_at) FROM inquiries WHERE status = 'OPEN') AS inq_old,
            (SELECT count(*)::int FROM inquiries WHERE status = 'OPEN' AND due_at < now()) AS inq_over,
            (SELECT count(*)::int FROM disputes WHERE status IN ('OPEN', 'IN_REVIEW')) AS dsp_n,
            (SELECT min(opened_at) FROM disputes WHERE status IN ('OPEN', 'IN_REVIEW')) AS dsp_old,
            (SELECT count(*)::int FROM disputes WHERE status IN ('OPEN', 'IN_REVIEW') AND opened_at < now() - make_interval(days => fn_setting_int('ops.dispute_due_days', 3))) AS dsp_over,
            (SELECT count(*)::int FROM reports WHERE state IN ('OPEN', 'QUEUED')) AS rep_n,
            (SELECT min(created_at) FROM reports WHERE state IN ('OPEN', 'QUEUED')) AS rep_old,
            (SELECT count(*)::int FROM reports WHERE state IN ('OPEN', 'QUEUED') AND created_at < now() - make_interval(hours => coalesce((SELECT CASE WHEN value ~ '^[0-9]+$' THEN value::int END FROM site_settings WHERE key = 'ops.report_due_hours'), 24))) AS rep_over,
            (SELECT count(*)::int FROM settlements WHERE status = 'REQUESTED') AS stl_n,
            (SELECT min(requested_at) FROM settlements WHERE status = 'REQUESTED') AS stl_old,
            (SELECT count(*)::int FROM settlements WHERE status = 'REQUESTED' AND requested_at < now() - make_interval(days => fn_setting_int('ops.settle_due_days', 2))) AS stl_over,
            (SELECT count(*)::int FROM businesses WHERE verified_at IS NULL AND rejected_at IS NULL AND kind = 'BUSINESS') AS biz_n,
            (SELECT min(created_at) FROM businesses WHERE verified_at IS NULL AND rejected_at IS NULL AND kind = 'BUSINESS') AS biz_old,
            (SELECT count(*)::int FROM ops_alerts WHERE severity = 'CRITICAL' AND acknowledged_at IS NULL AND resolved_at IS NULL) AS crit_n,
            (SELECT min(raised_at) FROM ops_alerts WHERE severity = 'CRITICAL' AND acknowledged_at IS NULL AND resolved_at IS NULL) AS crit_old,
            (SELECT count(*)::int FROM partners WHERE status = 'APPLIED') AS ptn_n,
            (SELECT min(applied_at) FROM partners WHERE status = 'APPLIED') AS ptn_old,
            (SELECT count(*)::int FROM qualification_reviews WHERE state = 'PENDING') AS qual_n,
            (SELECT min(created_at) FROM qualification_reviews WHERE state = 'PENDING') AS qual_old,
            (SELECT count(*)::int FROM partners WHERE aff_status = 'APPLIED') AS aff_n,
            (SELECT min(aff_applied_at) FROM partners WHERE aff_status = 'APPLIED') AS aff_old`);
  const n = (k: string) => Number(c?.[`${k}_n`] ?? 0);
  const o = (k: string) => (c?.[`${k}_old`] ? String(c[`${k}_old`]) : null);
  const row = (key: string, label: string, tab: string, over = 0): TodoItem => ({ key, label, n: n(key), oldest: o(key), over, tab });
  /* v10.615 (docs/757) perm.mode GROUPS — 역할 대신 줄이 가는 탭(업무)의 권한으로 고름(표시만 · 서버는 그 탭 API 에서 다시 봄)
   *   제휴 신청은 「고치기」(지급 담당 R_PAYOUT 도 제휴 보기를 가져 넓어지지 않게) · 출금 지급 · 확정 대기는 같은 「지급」 탭이라 둘 다 보일 수 있음(숫자만) */
  if (eff && !roles.includes('SUPER')) {
    const pick: Array<[TodoItem, string]> = [
      [row('review', '검수 대기', 'queue', Number(c?.review_over ?? 0)), 'queue:VIEW'],
      [row('pay', '포인트 출금 지급 대기(확정됨)', 'payouts'), 'payouts:VIEW'],
      [row('cash', '포인트 출금 확정 대기', 'payouts'), 'payouts:VIEW'],
      [row('inq', '1:1 문의 답변 전', 'inquiries', Number(c?.inq_over ?? 0)), 'inquiries:VIEW'],
      [row('dsp', '분쟁 처리 중', 'disputes', Number(c?.dsp_over ?? 0)), 'disputes:VIEW'],
      [row('rep', '신고 처리 대기', 'report-queue', Number(c?.rep_over ?? 0)), 'report-queue:VIEW'],
      [row('stl', '정산 승인 대기', 'settlement', Number(c?.stl_over ?? 0)), 'settlement:VIEW'],
      [row('biz', '사업자 인증 대기', 'users'), 'users:VIEW'],
      [row('crit', '확인 안 한 급한 알림', 'ops-alerts', n('crit')), 'ops-alerts:VIEW'],
      [row('ptn', '입점(파트너) 신청', 'partners'), 'partners:VIEW'],
      [row('qual', '자격 심사 대기', 'quals'), 'quals:VIEW'],
      [row('aff', '제휴 신청', 'affiliates'), 'affiliates:EDIT'],
    ];
    const ef: Set<string> = eff;
    const got = pick.filter(([, k]) => ef.has(k)).map(([x]) => x);
    return { items: got, total: got.reduce((s, x) => s + x.n, 0) };
  }
  const items: TodoItem[] = [];
  if (has('REVIEWER', 'ADMIN')) items.push(row('review', '검수 대기', 'queue', Number(c?.review_over ?? 0)));
  if (has('PAYOUT')) items.push(row('pay', '포인트 출금 지급 대기(확정됨)', 'payouts'));
  if (has('ADMIN')) {
    items.push(row('cash', '포인트 출금 확정 대기', 'payouts'));
    items.push(row('inq', '1:1 문의 답변 전', 'inquiries', Number(c?.inq_over ?? 0)));
    items.push(row('dsp', '분쟁 처리 중', 'disputes', Number(c?.dsp_over ?? 0)));   /* v10.373 (docs/508) 기한(ops.dispute_due_days) 넘김 */
    items.push(row('rep', '신고 처리 대기', 'report-queue', Number(c?.rep_over ?? 0)));   /* v10.367 (docs/502) 기한(ops.report_due_hours) 넘김 */
    items.push(row('stl', '정산 승인 대기', 'settlement', Number(c?.stl_over ?? 0)));   /* v10.373 기한(ops.settle_due_days) 넘김 */
    items.push(row('biz', '사업자 인증 대기', 'users'));
    items.push(row('crit', '확인 안 한 급한 알림', 'ops-alerts', n('crit')));
  }
  if (has('PARTNER_MAL', 'ADMIN')) { items.push(row('ptn', '입점(파트너) 신청', 'partners')); items.push(row('qual', '자격 심사 대기', 'quals')); }
  if (has('PARTNER_AFF', 'ADMIN')) items.push(row('aff', '제휴 신청', 'affiliates'));
  return { items, total: items.reduce((s, x) => s + x.n, 0) };
}
