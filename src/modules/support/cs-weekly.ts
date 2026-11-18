/* ---------------------------------------------------------------------
 * v10.352 (D234 · docs/486) — 고객센터 주간 보고 글(지난주 월 ~ 일 · 한국)
 *
 *   대표 11/18 「다음개발」 → ④. 정기 작업 cs_weekly(월요일 09:10)가 텔레그램 · 슬랙 · 운영자 게시판으로 보내고,
 *   운영 화면 첫 화면 「고객센터 한눈에」 › 「주간 보고 미리 보기」(GET /admin/cs-glance/weekly)가 같은 글을 보여 줍니다.
 *   숫자만(문의 본문 · 연락처 없음). 낱말은 사람 정보를 걸러 쌓은 것(v10.336).
 * ------------------------------------------------------------------- */
interface Q { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> }

export interface CsWeeklyStats {
  from: string; to: string; received: number; answered: number; avgHours: number | null; inTime: number; inTimeRate: number | null;
  resolved: number; unresolved: number; resolvedRate: number | null; deflected: number;
  misses: Array<{ word: string; hits: number }>;
  lead: { active: boolean; requests: number; noPartner: number };
  openNow: number; overdueNow: number;
}

export async function csWeeklyStats(db: Q): Promise<CsWeeklyStats> {
  const [s] = await db.query<Record<string, number | string | null>>(
    `WITH r AS (
       SELECT (date_trunc('week', now() AT TIME ZONE 'Asia/Seoul') - interval '7 days') AT TIME ZONE 'Asia/Seoul' AS f,
              date_trunc('week', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AS t),
     w AS (
       SELECT i.id, i.created_at, i.due_at,
              (SELECT min(l.occurred_at) FROM audit.audit_logs l WHERE l.action = 'INQUIRY_ANSWER' AND l.target_id = i.id) AS first_at
         FROM inquiries i, r WHERE i.created_at >= r.f AND i.created_at < r.t)
     SELECT (SELECT to_char(f AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') FROM r) AS "from",
            (SELECT to_char((t AT TIME ZONE 'Asia/Seoul') - interval '1 day', 'YYYY-MM-DD') FROM r) AS "to",
            count(*)::int AS received, count(first_at)::int AS answered,
            round((avg(extract(epoch FROM first_at - created_at)) / 3600)::numeric, 1)::float AS "avgHours",
            count(*) FILTER (WHERE first_at IS NOT NULL AND (due_at IS NULL OR first_at <= due_at))::int AS "inTime"
       FROM w`);
  const [f] = await db.query<{ resolved: number; unresolved: number; openNow: number; overdueNow: number }>(
    `WITH r AS (
       SELECT (date_trunc('week', now() AT TIME ZONE 'Asia/Seoul') - interval '7 days') AT TIME ZONE 'Asia/Seoul' AS f,
              date_trunc('week', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AS t)
     SELECT count(*) FILTER (WHERE i.feedback = 'RESOLVED' AND i.feedback_at >= r.f AND i.feedback_at < r.t)::int AS resolved,
            count(*) FILTER (WHERE i.feedback = 'UNRESOLVED' AND i.feedback_at >= r.f AND i.feedback_at < r.t)::int AS unresolved,
            count(*) FILTER (WHERE i.status = 'OPEN')::int AS "openNow",
            count(*) FILTER (WHERE i.status = 'OPEN' AND i.due_at < now())::int AS "overdueNow"
       FROM inquiries i, r`);
  const [d] = await db.query<{ n: number }>(
    `SELECT coalesce(sum(deflect), 0)::int AS n FROM faq_daily
      WHERE day >= (date_trunc('week', now() AT TIME ZONE 'Asia/Seoul') - interval '7 days')::date
        AND day < date_trunc('week', now() AT TIME ZONE 'Asia/Seoul')::date`);
  const misses = await db.query<{ word: string; hits: number }>(
    `SELECT word, sum(hits)::int AS hits FROM faq_search_misses
      WHERE day >= (date_trunc('week', now() AT TIME ZONE 'Asia/Seoul') - interval '7 days')::date
        AND day < date_trunc('week', now() AT TIME ZONE 'Asia/Seoul')::date
      GROUP BY word ORDER BY sum(hits) DESC, word LIMIT 5`);
  const [l] = await db.query<{ active: boolean; requests: number; noPartner: number }>(
    `WITH r AS (
       SELECT (date_trunc('week', now() AT TIME ZONE 'Asia/Seoul') - interval '7 days') AT TIME ZONE 'Asia/Seoul' AS f,
              date_trunc('week', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AS t)
     SELECT coalesce((SELECT is_active FROM gwans WHERE code = 'LED'), false) AS active,
            (SELECT count(*)::int FROM consult_requests q JOIN categories c ON c.id = q.category_id, r
              WHERE c.gwan_code = 'MAL' AND c.axis = 'CONSULT' AND q.verified_at IS NOT NULL AND q.created_at >= r.f AND q.created_at < r.t) AS requests,
            (SELECT count(*)::int FROM consult_requests q JOIN categories c ON c.id = q.category_id, r
              WHERE c.gwan_code = 'MAL' AND c.axis = 'CONSULT' AND q.state = 'NO_PARTNER' AND q.created_at >= r.f AND q.created_at < r.t) AS "noPartner"`);
  const answered = Number(s?.answered ?? 0), res = Number(f?.resolved ?? 0), un = Number(f?.unresolved ?? 0);
  return {
    from: String(s?.from ?? ''), to: String(s?.to ?? ''), received: Number(s?.received ?? 0), answered,
    avgHours: s?.avgHours == null ? null : Number(s.avgHours), inTime: Number(s?.inTime ?? 0),
    inTimeRate: answered ? Math.round((Number(s?.inTime ?? 0) / answered) * 1000) / 10 : null,
    resolved: res, unresolved: un, resolvedRate: res + un ? Math.round((res / (res + un)) * 1000) / 10 : null,
    deflected: Number(d?.n ?? 0), misses,
    lead: { active: !!l?.active, requests: Number(l?.requests ?? 0), noPartner: Number(l?.noPartner ?? 0) },
    openNow: Number(f?.openNow ?? 0), overdueNow: Number(f?.overdueNow ?? 0),
  };
}

export function csWeeklyText(s: CsWeeklyStats): string {
  const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
  return [
    `[소개뱅크] 고객센터 주간 보고 ${s.from} ~ ${s.to}`,
    `1:1 문의 접수 ${s.received} · 답함 ${s.answered} · 처음 답까지 평균 ${s.avgHours == null ? '—' : `${s.avgHours}시간`} · 기한 안 ${pct(s.inTimeRate)}`,
    `답변 해결됨 ${s.resolved} · 아직 해결 안 됨 ${s.unresolved} · 해결률 ${pct(s.resolvedRate)}`,
    `문의 전 해결(「이걸로 해결됨」) ${s.deflected}`,
    `못 찾은 낱말: ${s.misses.length ? s.misses.map((m) => `「${m.word}」 ${m.hits}`).join(' · ') : '없음'}`,
    `리드관: ${s.lead.active ? `신청 ${s.lead.requests} · 받을 업체 없음 ${s.lead.noPartner}` : '꺼짐'}`,
    `지금 답변 전 ${s.openNow} · 기한 넘김 ${s.overdueNow}(운영 화면 › 회원 › 1:1 문의)`,
    '이 알림 끄기: 설정 ops.cs_weekly = off',
  ].join('\n');
}
