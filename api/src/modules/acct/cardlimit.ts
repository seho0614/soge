/* e3 (docs/010) 소개뱅크 src/modules/acct/cardlimit.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.453 (D261 · docs/590) 법인카드 한도 · 사용자별 사용
 *   카드는 ⑫ 카드 CSV 의 끝 4자리(acct_card_txns.card_tail)로 알아봄 → acct_card_limits(이름 · 쓰는 사람 · 달 한도 · SUPER)
 *   달 사용 = 그 달(한국 날짜) 이용 줄 합 — 취소(음수) 포함 · 「넣지 않음(IGNORED)」 뺌 · 장부에 넣었는지와 상관없음
 *   알림: acct.card_alert(처음 on) · acct.card_alert_pct(처음 80) — 정기 작업 acct_card_limit(매일 09:40)
 *     기준을 넘으면 ACCT_CARD_LIMIT 한 번(키 달|카드|pct) · 한도를 넘으면 한 번 더(키 달|카드|100) · 달이 바뀌면 지난달 알림은 풀림
 *   한도가 없는 카드(끝 4자리)는 「한도 없음」 줄로 보임(알림 없음).
 * ------------------------------------------------------------------- */

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const TAIL = /^[0-9*]{1,4}$/;   // DB CHECK acct_card_limits.card_tail · acct_card_txns.card_tail 과 같음
const kstYm = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
const reasonOk = (r?: string) => {
  const t = (r ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  return t;
};

async function opts(db: DatabaseService) {
  const r = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM erp_site_settings WHERE key IN ('acct.card_alert', 'acct.card_alert_pct')`);
  const v = (k: string) => r.find((x) => x.key === k)?.value ?? null;
  const pct = Number(v('acct.card_alert_pct') ?? 80);
  return { on: (v('acct.card_alert') ?? 'on') === 'on', pct: Number.isFinite(pct) ? Math.min(100, Math.max(50, Math.round(pct))) : 80 };
}

export interface CardUse { tail: string; name: string | null; holderId: string | null; holderName: string | null; limit: number | null; active: boolean; used: number; count: number; pct: number | null; level: 'OK' | 'NEAR' | 'OVER' | 'NONE' }

/** 한 달 카드별 사용 · 쓰는 사람별 합 */
export async function cardUsage(db: DatabaseService, ymIn?: string) {
  const ym = ymIn && YM.test(ymIn) ? ymIn : kstYm();
  const o = await opts(db);
  const rows = await db.query<{ tail: string; name: string | null; holder_id: string | null; holder_name: string | null; lim: string | null; active: boolean | null; used: string; cnt: number }>(
    `WITH u AS (
       SELECT coalesce(t.card_tail, '') AS tail, sum(t.amount)::bigint AS used, count(*)::int AS cnt
         FROM acct_card_txns t
        WHERE t.state <> 'IGNORED' AND t.used_on >= ($1 || '-01')::date AND t.used_on < (($1 || '-01')::date + interval '1 month')
        GROUP BY 1)
     SELECT coalesce(l.card_tail, u.tail) AS tail, l.name, l.holder_id::text AS holder_id, a.name AS holder_name, l.monthly_limit::text AS lim, l.active,
            coalesce(u.used, 0)::text AS used, coalesce(u.cnt, 0) AS cnt
       FROM acct_card_limits l FULL JOIN u ON u.tail = l.card_tail
       LEFT JOIN svc.accounts a ON a.id = l.holder_id
      ORDER BY 1`, [ym]);
  const items: CardUse[] = rows.map((r) => {
    const limit = r.lim == null ? null : Number(r.lim), used = Number(r.used);
    const pct = limit ? Math.round((used / limit) * 1000) / 10 : null;
    const level: CardUse['level'] = limit == null || r.active === false ? 'NONE' : used > limit ? 'OVER' : pct! >= o.pct ? 'NEAR' : 'OK';
    return { tail: r.tail || '(번호 없음)', name: r.name, holderId: r.holder_id, holderName: r.holder_name, limit, active: r.active ?? false, used, count: r.cnt, pct, level };
  });
  /* 쓰는 사람별 — 한도에 사람을 정한 카드만 묶음 · 나머지는 「정하지 않음」 */
  const box = new Map<string, { holderId: string | null; holderName: string; cards: number; limit: number; used: number }>();
  for (const x of items) {
    const k = x.holderId ?? '';
    const b = box.get(k) ?? (box.set(k, { holderId: x.holderId, holderName: x.holderName ?? '정하지 않음', cards: 0, limit: 0, used: 0 }), box.get(k)!);
    b.cards++; b.limit += x.limit ?? 0; b.used += x.used;
  }
  const holders = [...box.values()].sort((a, b) => (a.holderId === null ? 1 : b.holderId === null ? -1 : b.used - a.used));
  const total = { used: items.reduce((s, x) => s + x.used, 0), limit: items.reduce((s, x) => s + (x.limit ?? 0), 0) };
  return { ym, alertOn: o.on, alertPct: o.pct, items, holders, total,
    note: `카드 끝 4자리로 ⑫ 법인카드 이용 내역을 셉니다(취소 포함 · 「넣지 않음」 뺌). 한도의 ${o.pct}% 를 넘으면 · 한도를 넘으면 운영 알림(매일 09:40 · acct.card_alert).` };
}

/** GET /admin/acct/card-limits?ym= — 카드별 · 사람별 사용 + 운영자 목록(쓰는 사람 고르기) + 최근 바꾼 기록 */
export async function cardLimitsView(db: DatabaseService, ym?: string) {
  const u = await cardUsage(db, ym);
  const staff = await db.query(
    `SELECT DISTINCT a.id::text AS id, a.name FROM svc.account_roles r JOIN svc.accounts a ON a.id = r.account_id
      WHERE r.role IN ('SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF') AND a.status = 'ACTIVE' ORDER BY a.name LIMIT 300`);
  const changes = await db.query(
    `SELECT c.id::text AS id, c.card_tail AS tail, c.before, c.after, c.reason, b.name AS "changedBy", c.changed_at AS "changedAt"
       FROM acct_card_limit_changes c LEFT JOIN svc.accounts b ON b.id = c.changed_by ORDER BY c.id DESC LIMIT 20`);
  return { ...u, staff, changes };
}

/** PUT /admin/acct/card-limits/{tail} — 넣기 · 고치기(SUPER · 사유 · 바꾼 기록) */
export async function setCardLimit(db: DatabaseService, tailIn: string, b: { name: string; holderId?: string | null; monthlyLimit: number; active?: boolean; reason: string }, actor: string | null) {
  const tail = String(tailIn ?? '').trim();
  if (!TAIL.test(tail)) throw new PolicyViolation('CARD_TAIL', '카드 끝 4자리(숫자 · *)를 적으십시오.');
  const name = (b.name ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 40) throw new PolicyViolation('CARD_NAME', '카드 이름은 1 ~ 40자입니다.');
  const lim = Number(b.monthlyLimit);
  if (!Number.isInteger(lim) || lim < 1 || lim > 1_000_000_000_000) throw new PolicyViolation('CARD_LIMIT', '달 한도는 1원 이상 정수입니다.');
  const holder = b.holderId ? String(b.holderId).trim() : null;
  if (holder && !/^[0-9a-f-]{36}$/i.test(holder)) throw new PolicyViolation('CARD_HOLDER', '쓰는 사람 번호가 맞지 않습니다.');
  const reason = reasonOk(b.reason);
  return db.transaction(async () => {
    const [cur] = await db.query<{ name: string; holder_id: string | null; monthly_limit: string; active: boolean }>(
      `SELECT name, holder_id::text AS holder_id, monthly_limit::text AS monthly_limit, active FROM acct_card_limits WHERE card_tail = $1 FOR UPDATE`, [tail]);
    const active = b.active ?? cur?.active ?? true;
    if (holder) {
      const [h] = await db.query(`SELECT 1 FROM svc.accounts WHERE id = $1::uuid`, [holder]);
      if (!h) throw new PolicyViolation('CARD_HOLDER', '없는 사람입니다.');
    }
    await db.query(
      `INSERT INTO acct_card_limits (card_tail, name, holder_id, monthly_limit, active, updated_by, updated_at) VALUES ($1, $2, $3::uuid, $4::bigint, $5::boolean, $6::uuid, now())
       ON CONFLICT (card_tail) DO UPDATE SET name = EXCLUDED.name, holder_id = EXCLUDED.holder_id, monthly_limit = EXCLUDED.monthly_limit, active = EXCLUDED.active,
                                             updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [tail, name, holder, lim, active, actor]);
    const after = { name, holderId: holder, monthlyLimit: lim, active };
    const before = cur ? { name: cur.name, holderId: cur.holder_id, monthlyLimit: Number(cur.monthly_limit), active: cur.active } : null;
    await db.query(`INSERT INTO acct_card_limit_changes (card_tail, before, after, reason, changed_by) VALUES ($1, $2::jsonb, $3::jsonb, $4, $5::uuid)`,
      [tail, before ? JSON.stringify(before) : null, JSON.stringify(after), reason, actor]);
    return { ok: true, tail, created: !cur, note: cur ? `카드 ${tail} 한도를 고쳤습니다.` : `카드 ${tail} 한도를 넣었습니다.` };
  });
}

/** 정기 작업 acct_card_limit — 이번 달 기준 넘은 카드 알림 · 지난달 · 꺼짐이면 풀기 */
export async function acctCardLimitJob(db: DatabaseService) {
  const o = await opts(db);
  const u = await cardUsage(db);
  const want = new Map<string, CardUse & { step: string }>();
  if (o.on) for (const x of u.items) {
    if (x.level === 'NEAR' || x.level === 'OVER') want.set(`${u.ym}|${x.tail}|${o.pct}`, { ...x, step: String(o.pct) });
    if (x.level === 'OVER') want.set(`${u.ym}|${x.tail}|100`, { ...x, step: '100' });
  }
  const open = await db.query<{ id: string; key: string }>(`SELECT id::text AS id, detail->>'key' AS key FROM ops_alerts WHERE alert_code = 'ACCT_CARD_LIMIT' AND resolved_at IS NULL`);
  let resolved = 0;
  for (const x of open) if (!o.on || !String(x.key ?? '').startsWith(`${u.ym}|`)) {
    await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2 WHERE id = $1::bigint`, [x.id, o.on ? '지난달' : '알림 끔']);
    resolved++;
  }
  const made: string[] = [];
  for (const [key, x] of want) {
    const title = x.step === '100'
      ? `법인카드 ${x.name ?? x.tail}(${x.tail}) 한도 넘음 — ${u.ym} ${x.used.toLocaleString('ko-KR')}원 / 한도 ${x.limit!.toLocaleString('ko-KR')}원 — 회계 › 법인카드 한도`
      : `법인카드 ${x.name ?? x.tail}(${x.tail}) 한도 ${x.step}% 넘음 — ${u.ym} ${x.used.toLocaleString('ko-KR')}원 / 한도 ${x.limit!.toLocaleString('ko-KR')}원 — 회계 › 법인카드 한도`;
    const ins = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'ACCT_CARD_LIMIT', 'WARN', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ACCT_CARD_LIMIT' AND detail->>'key' = $3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [title, JSON.stringify({ key, ym: u.ym, tail: x.tail, used: x.used, limit: x.limit, holder: x.holderName }), key]);
    if (ins.length) made.push(key);
  }
  return { on: o.on, ym: u.ym, made, resolved };
}
