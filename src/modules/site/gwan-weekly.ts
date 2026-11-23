import type { DatabaseService } from '../../db/database.service';
import type { MailService } from '../../common/mail/mail.service';

/* ---------------------------------------------------------------------
 * v10.694 (docs/801) 관별 주간 보고 — 월요일 아침 대표 할 일 주간 작업(owner_todo_weekly)이 이어서 부름(배치 줄을 더하지 않음)
 *   관 담당자(gwan_managers)마다 맡은 관의 지난 7일: 페이지 방문 · 새 매물 · 새 요청 · 관 페이지 문의(열린 것) · 지금 검수 대기 · 7일 지난 초안
 *   운영 알림 GWAN_WEEKLY(INFO · 담당자 · 주마다 한 번) · 메일이 준비됐으면 담당자 메일로도 · 담당자가 없으면 아무것도 안 함
 *   설정 ops.gwan_weekly(처음 on · off 면 안 보냄)
 * ------------------------------------------------------------------- */
export async function gwanWeeklyJob(db: DatabaseService, mail: MailService): Promise<{ off?: true; managers: number; mailed: number }> {
  const [o] = await db.query<{ v: string }>(`SELECT coalesce((SELECT value FROM site_settings WHERE key = 'ops.gwan_weekly'), 'on') AS v`);
  if ((o?.v ?? 'on') !== 'on') return { off: true, managers: 0, mailed: 0 };
  const rows = await db.query<{ aid: string; name: string; email: string | null; code: string; gname: string; v: number; l: number; r: number; q: number; qo: number; rp: number; sd: number }>(
    `SELECT a.id AS aid, a.name, a.email::text AS email, g.code, g.name AS gname,
            (SELECT coalesce(sum(w.views), 0)::int FROM gwan_page_views w JOIN gwan_pages p ON p.id = w.page_id WHERE p.gwan_code = g.code AND w.day > (now() AT TIME ZONE 'Asia/Seoul')::date - 7) AS v,
            (SELECT count(*)::int FROM listings x WHERE x.gwan_code = g.code AND x.created_at > now() - interval '7 days') AS l,
            (SELECT count(*)::int FROM requests x WHERE x.gwan_code = g.code AND x.created_at > now() - interval '7 days') AS r,
            (SELECT count(*)::int FROM inquiries x WHERE x.source_gwan = g.code AND x.created_at > now() - interval '7 days') AS q,
            (SELECT count(*)::int FROM inquiries x WHERE x.source_gwan = g.code AND x.status = 'OPEN') AS qo,
            (SELECT count(*)::int FROM review_items x WHERE x.gwan_code = g.code AND x.status IN ('QUEUED', 'IN_PROGRESS')) AS rp,
            (SELECT count(*)::int FROM gwan_pages p WHERE p.gwan_code = g.code AND p.draft_updated_at < now() - interval '7 days' AND p.scheduled_at IS NULL AND p.status <> 'HIDDEN'
               AND (p.published_version IS NULL OR p.draft IS DISTINCT FROM (SELECT coalesce(v.source, v.blocks) FROM gwan_page_versions v WHERE v.page_id = p.id AND v.version = p.published_version))) AS sd
       FROM gwan_managers m JOIN accounts a ON a.id = m.account_id JOIN gwans g ON g.code = m.gwan_code
      ORDER BY a.name, g.sort_order`);
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.aid, [...(by.get(r.aid) ?? []), r]);
  const [wk] = await db.query<{ w: string }>(`SELECT to_char(now() AT TIME ZONE 'Asia/Seoul', 'IYYY-"W"IW') AS w`);
  const ready = by.size ? await mail.ready() : false;
  let mailed = 0;
  for (const [aid, list] of by) {
    const who = list[0]!;
    const lines = list.map((x) => `- ${x.gname}(${x.code}) 방문 ${x.v} · 새 매물 ${x.l} · 새 요청 ${x.r} · 페이지 문의 ${x.q}(열림 ${x.qo}) · 검수 대기 ${x.rp} · 7일 지난 초안 ${x.sd}`);
    const text = [`소개뱅크 담당 관 주간 보고 — ${wk?.w ?? ''} · ${who.name}`, '', '지난 7일:', ...lines, '', '운영 화면 첫 화면 「내 담당 관」에서 자세히 볼 수 있습니다.'].join('\n');
    let sent = false;
    if (ready && who.email) { const r = await mail.send({ to: who.email, subject: `[소개뱅크] 담당 관 주간 보고 ${wk?.w ?? ''}`, text }); sent = !!r.ok; if (sent) mailed++; }
    const key = `wk:${wk?.w}:${aid}`;
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'GWAN_WEEKLY', 'INFO', $1::text, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts a WHERE a.alert_code = 'GWAN_WEEKLY' AND a.detail->>'key' = $3::text) ON CONFLICT DO NOTHING`,
      [`담당 관 주간 보고 ${wk?.w ?? ''} — ${who.name} · 관 ${list.length}곳${sent ? ' · 메일 보냄' : ''}`.slice(0, 200), JSON.stringify({ key, manager: who.name, gwans: list.map((x) => x.code), text, mailed: sent }), key]);
  }
  return { managers: by.size, mailed };
}
