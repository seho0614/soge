import { DatabaseService } from '../../db/database.service';

/* ---------------------------------------------------------------------
 * v10.401 (D247 · docs/538) 받을 돈 · 갚을 돈 기간 분석
 *   외상매출금(AR) · 미지급금(AP) · 법인카드 미지급금(CARD_AP)을 거래처(전표 party)별로 30 · 60 · 90일 · 그 넘음으로 나눔.
 *   남은 금액은 먼저 생긴 것부터 갚았다고 봄(먼저 들어온 것 먼저 — FIFO) → 남은 몫의 「생긴 날」로 나이를 셈.
 *   정기 작업 acct_aging(매일 09:25) — acct.aging_alert_days(처음 90일) 넘은 몫이 있으면 운영 알림 ACCT_AGING_OVER
 *     (거래처 · 계정마다 한 번 · 넘은 몫이 사라지면 풀림 · acct.aging_alert off 면 알리지 않음).
 *   월 결산 요약 한 줄은 agingLine() — month.ts checks 에 붙임(메인).
 * ------------------------------------------------------------------- */

export const AGING_ROLES = ['AR', 'AP', 'CARD_AP'] as const;
export type AgingRole = typeof AGING_ROLES[number];
const ROLE_KO: Record<AgingRole, string> = { AR: '받을 돈(외상매출금)', AP: '갚을 돈(미지급금)', CARD_AP: '법인카드 미지급금' };
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);

export interface AgingRow { role: AgingRole; roleKo: string; party: string; open: number; b30: number; b60: number; b90: number; over: number; oldest: string | null; oldestDays: number }

/** 기준일(asOf · 한국 날짜 · 그날까지 전표) 거래처별 나이 */
export async function aging(db: DatabaseService, asOf = kstToday(), overDays = 90) {
  const lines = await db.query<{ role: AgingRole; party: string | null; d: string; amt: string }>(
    `SELECT l.role, nullif(btrim(e.party), '') AS party, e.entry_date::text AS d,
            (CASE WHEN l.role = 'AR' THEN l.debit - l.credit ELSE l.credit - l.debit END)::text AS amt
       FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id
      WHERE l.role = ANY($1::text[]) AND e.entry_date <= $2::date AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')
      ORDER BY l.role, party, e.entry_date, e.id, l.id`, [AGING_ROLES as unknown as string[], asOf]);
  /* 거래처 · 계정마다 늘어난 몫(날짜 · 금액) 줄 세우고 줄어든 몫은 앞에서부터 지움 */
  const box = new Map<string, { role: AgingRole; party: string; lots: Array<{ d: string; a: number }>; neg: number }>();
  for (const l of lines) {
    const k = `${l.role}|${l.party ?? ''}`;
    const b = box.get(k) ?? (box.set(k, { role: l.role, party: l.party ?? '(거래처 없음)', lots: [], neg: 0 }), box.get(k)!);
    let a = Number(l.amt);
    if (a > 0) {
      if (b.neg > 0) { const u = Math.min(a, b.neg); b.neg -= u; a -= u; }   // 먼저 낸 돈(선급)이 있으면 그것부터
      if (a > 0) b.lots.push({ d: l.d, a });
    } else if (a < 0) {
      let pay = -a;
      while (pay > 0 && b.lots.length) { const lot = b.lots[0]!; const u = Math.min(pay, lot.a); lot.a -= u; pay -= u; if (lot.a === 0) b.lots.shift(); }
      b.neg += pay;
    }
  }
  const rows: AgingRow[] = [];
  for (const b of box.values()) {
    if (!b.lots.length) continue;
    const r: AgingRow = { role: b.role, roleKo: ROLE_KO[b.role], party: b.party, open: 0, b30: 0, b60: 0, b90: 0, over: 0, oldest: b.lots[0]!.d, oldestDays: days(b.lots[0]!.d, asOf) };
    for (const lot of b.lots) {
      const age = days(lot.d, asOf);
      r.open += lot.a;
      if (age <= 30) r.b30 += lot.a; else if (age <= 60) r.b60 += lot.a; else if (age <= Math.max(61, overDays)) r.b90 += lot.a; else r.over += lot.a;
    }
    rows.push(r);
  }
  rows.sort((a, b) => a.role.localeCompare(b.role) || b.over - a.over || b.open - a.open);
  const total = Object.fromEntries(AGING_ROLES.map((role) => {
    const xs = rows.filter((x) => x.role === role);
    return [role, { open: xs.reduce((s, x) => s + x.open, 0), b30: xs.reduce((s, x) => s + x.b30, 0), b60: xs.reduce((s, x) => s + x.b60, 0),
                    b90: xs.reduce((s, x) => s + x.b90, 0), over: xs.reduce((s, x) => s + x.over, 0), parties: xs.length }];
  })) as Record<AgingRole, { open: number; b30: number; b60: number; b90: number; over: number; parties: number }>;
  return { asOf, overDays, rows, total,
    note: `먼저 생긴 몫부터 갚았다고 보고 남은 몫의 날짜로 나이를 셉니다. 「${overDays}일 넘음」은 운영 알림 기준(acct.aging_alert_days) — 거래처 이름이 없는 전표는 「(거래처 없음)」으로 모읍니다.` };
}

async function opts(db: DatabaseService) {
  const r = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key IN ('acct.aging_alert_days', 'acct.aging_alert')`);
  const v = (k: string) => r.find((x) => x.key === k)?.value ?? null;
  return { overDays: Math.min(365, Math.max(30, Number(v('acct.aging_alert_days') ?? 90) || 90)), on: (v('acct.aging_alert') ?? 'on') === 'on' };
}

/** GET 용 — 설정 기준일수로 */
export async function agingView(db: DatabaseService, asOf?: string) {
  const o = await opts(db);
  return { ...(await aging(db, asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : kstToday(), o.overDays)), alertOn: o.on };
}

/** 정기 작업 acct_aging — 넘은 몫 알림 넣기 · 사라진 것 풀기 */
export async function acctAgingJob(db: DatabaseService) {
  const o = await opts(db);
  const a = await aging(db, kstToday(), o.overDays);
  const overKeys = new Set(a.rows.filter((r) => r.over > 0).map((r) => `${r.role}|${r.party}`));
  const open = await db.query<{ id: string; key: string }>(`SELECT id::text AS id, detail->>'key' AS key FROM ops_alerts WHERE alert_code = 'ACCT_AGING_OVER' AND resolved_at IS NULL`);
  let resolved = 0;
  for (const x of open) if (!overKeys.has(x.key) || !o.on) {
    await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2 WHERE id = $1::bigint`, [x.id, o.on ? '넘은 몫 없음' : '알림 끔']);
    resolved++;
  }
  const made: string[] = [];
  if (o.on) for (const r of a.rows.filter((x) => x.over > 0)) {
    const key = `${r.role}|${r.party}`;
    const ins = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'ACCT_AGING_OVER', 'WARN', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ACCT_AGING_OVER' AND resolved_at IS NULL AND detail->>'key' = $3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [`${r.roleKo} ${r.party} — ${o.overDays}일 넘은 몫 ${r.over.toLocaleString('ko-KR')}원(가장 오래된 날 ${r.oldest}) — 회계 › 기간 분석`,
       JSON.stringify({ key, role: r.role, party: r.party, over: r.over, oldest: r.oldest }), key]);
    if (ins.length) made.push(key);
  }
  return { on: o.on, made, resolved, overParties: overKeys.size };
}

/** 월 결산 요약에 붙일 한 줄(메인이 month.ts checks 에 더함 · 마감 조건은 아님) */
export async function agingLine(db: DatabaseService) {
  const o = await opts(db);
  const a = await aging(db, kstToday(), o.overDays);
  const over = a.rows.filter((r) => r.over > 0);
  return { key: 'aging', label: `${o.overDays}일 넘은 받을 돈 · 갚을 돈 없음`, ok: over.length === 0,
           detail: over.length ? `${over.length}곳 · ${over.reduce((s, r) => s + r.over, 0).toLocaleString('ko-KR')}원` : '', where: '회계 › 기간 분석' };
}
