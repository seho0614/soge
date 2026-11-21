import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { monthSummary } from './month';
import { agingLine } from './aging';
import { depreciationPlan, type AssetRow } from './assets';
import { hraSettings, kstToday, textOk, YM_RE } from './hra-common';
import { leavePromoJob } from './hra-leave-promo';
import { libUnreadJob } from './hra-library';

/* ---------------------------------------------------------------------
 * v10.584 (docs/726) 회계 마감 체크리스트 — 달 마감 전 할 일
 *   저절로 셈(AUTO) — 월 결산 요약(month.ts monthSummary)의 checks(자동 전표 실패 · 통장 맞춤 · 세금계산서 발행)를 그대로 쓰고
 *     매입(세금계산서 받기 NEW · 법인카드 OPEN) · 경비 청구(승인 뒤 미지급) · 급여(그 달 대장 확정) · 감가상각(그 달 줄 · assets.ts 계획과 대조) ·
 *     미수금(aging.ts agingLine · 오늘 기준)을 더함 · 셈이 실패한 칸은 ERROR(나머지는 보임)
 *   사람이 확인(MANUAL) — 확인 줄(hra_close_marks · 쌓기만 · 가장 최근 줄) · 저절로 셈 항목도 「예외 확인」(사유 꼭)
 *   마감한 달(acct_closings)은 확인 줄을 더하지 않음 · 남은 일 알림 HRA_CLOSE_TODO(hra.close_alert 처음 off)
 *   읽기(GET /admin/acct/close-check)는 세무사도(회계 읽기 규칙) · 확인은 SUPER · 지급 담당 · 항목 더하기 · 끄기는 SUPER
 * ------------------------------------------------------------------- */

const prevYm = (ym: string) => { const [y, m] = ym.split('-').map(Number) as [number, number]; return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
export const CLOSE_STATUS_KO: Record<string, string> = { OK: '끝', TODO: '남음', OVERRIDE: '예외 확인', ERROR: '셈 실패' };

interface Auto { ok: boolean; detail: string }

async function closeSettings(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key IN ('acct.close_by_day', 'acct.start_on')`);
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  return { closeBy: Math.min(28, Math.max(1, Number(v('acct.close_by_day') ?? 10) || 10)), startYm: (v('acct.start_on') ?? '2026-11-01').slice(0, 7) };
}

/** 저절로 셈 — 항목 열쇠마다 { ok, detail } · 실패한 칸은 빠짐(ERROR) */
async function autoChecks(db: DatabaseService, ym: string, startYm: string): Promise<{ map: Map<string, Auto>; errors: string[] }> {
  const map = new Map<string, Auto>(), errors: string[] = [];
  const safe = async (key: string, fn: () => Promise<Auto>) => { try { map.set(key, await fn()); } catch { errors.push(key); } };
  const nowYm = kstToday().slice(0, 7);
  try {
    const s = await monthSummary(db, ym);
    for (const c of s.checks) if (['journal', 'bank', 'invoices'].includes(c.key)) map.set(c.key, { ok: !!c.ok, detail: c.detail ?? '' });
  } catch { errors.push('journal', 'bank', 'invoices'); }
  await safe('purchase', async () => {
    const [r] = await db.query<{ inbox: number; card: number }>(
      `SELECT (SELECT count(*)::int FROM acct_tax_inbox WHERE state = 'NEW' AND to_char(issued_on, 'YYYY-MM') = $1) AS inbox,
              (SELECT count(*)::int FROM acct_card_txns WHERE state = 'OPEN' AND to_char(used_on, 'YYYY-MM') = $1) AS card`, [ym]);
    const inbox = Number(r?.inbox ?? 0), card = Number(r?.card ?? 0);
    return { ok: inbox === 0 && card === 0, detail: inbox + card ? `받은 세금계산서 미처리 ${inbox} · 법인카드 미분류 ${card}` : '' };
  });
  await safe('expense', async () => {
    const [r] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM acct_expense_claims WHERE state = 'APPROVED' AND to_char(spent_on, 'YYYY-MM') = $1`, [ym]);
    const n = Number(r?.n ?? 0);
    return { ok: n === 0, detail: n ? `승인했는데 아직 안 준 경비 ${n}건` : '' };
  });
  await safe('payroll', async () => {
    const [r] = await db.query<{ emps: number; state: string | null }>(
      `SELECT (SELECT count(*)::int FROM acct_employees WHERE joined_on <= ($1 || '-01')::date + interval '1 month' - interval '1 day' AND (left_on IS NULL OR left_on >= ($1 || '-01')::date)) AS emps,
              (SELECT state FROM acct_payroll_runs WHERE ym = $1) AS state`, [ym]);
    const emps = Number(r?.emps ?? 0), st = r?.state ?? null;
    if (!emps) return { ok: true, detail: '그 달 직원 없음' };
    return { ok: st === 'FIXED' || st === 'PAID', detail: st === 'FIXED' || st === 'PAID' ? '' : st === 'DRAFT' ? '급여 대장이 초안입니다 — 확정하십시오' : '그 달 급여 대장이 없습니다' };
  });
  await safe('depreciation', async () => {
    if (ym >= nowYm) return { ok: false, detail: '달이 끝난 뒤 정기 작업(acct_depreciation)이 셉니다' };
    if (ym < startYm) return { ok: true, detail: '전표 시작 달 전' };
    const assets = await db.query<AssetRow>(
      `SELECT a.id::text AS id, a.name, a.acquired_on::text AS acquired_on, a.cost::float8 AS cost, a.residual::float8 AS residual, a.life_months, a.method,
              a.prior_depr::float8 AS prior_depr, a.prior_months, a.state
         FROM acct_assets a WHERE a.acquired_on <= ($1 || '-01')::date + interval '1 month' - interval '1 day'
          AND (a.state = 'ACTIVE' OR (a.disposed_on IS NOT NULL AND to_char(a.disposed_on, 'YYYY-MM') > $1))`, [ym]);
    const want = assets.filter((a) => depreciationPlan(a).some((p) => p.ym === ym));
    if (!want.length) return { ok: true, detail: '그 달 상각할 자산 없음' };
    const have = await db.query<{ id: string }>(`SELECT asset_id::text AS id FROM acct_depreciations WHERE ym = $1 AND asset_id = ANY($2::bigint[])`, [ym, want.map((a) => a.id)]);
    const missing = want.filter((a) => !have.some((h) => h.id === a.id));
    return { ok: missing.length === 0, detail: missing.length ? `상각 줄 빠짐 ${missing.length}건(${missing.slice(0, 3).map((a) => a.name).join(', ')}${missing.length > 3 ? ' …' : ''})` : '' };
  });
  await safe('receivable', async () => {
    const a = await agingLine(db);
    return { ok: !!a.ok, detail: a.ok ? '' : `${a.detail} — 오늘 기준(독촉 · 대손 검토)` };
  });
  return { map, errors };
}

/** GET /admin/acct/close-check?ym= — 항목마다 상태 · 근거 · 마지막 확인 · 남은 일 */
export async function closeCheck(db: DatabaseService, ymIn?: string) {
  const ym = ymIn && YM_RE.test(ymIn) ? ymIn : prevYm(kstToday().slice(0, 7));
  const cs = await closeSettings(db);
  const items = await db.query<{ key: string; label: string; kind: string; where: string | null; sort: number; active: boolean }>(
    `SELECT key, label, kind, where_ko AS "where", sort, active FROM hra_close_items ORDER BY sort, key`);
  const marks = await db.query<{ key: string; done: boolean; note: string | null; by: string | null; at: string }>(
    `SELECT DISTINCT ON (m.item_key) m.item_key AS key, m.done, m.note, coalesce(a.name, a.email) AS by, m.marked_at AS at
       FROM hra_close_marks m LEFT JOIN accounts a ON a.id = m.marked_by WHERE m.ym = $1 ORDER BY m.item_key, m.id DESC`, [ym]);
  const { map, errors } = await autoChecks(db, ym, cs.startYm);
  const [closed] = await db.query<{ closedAt: string }>(`SELECT closed_at AS "closedAt" FROM acct_closings WHERE ym = $1`, [ym]);
  const rows = items.filter((i) => i.active).map((i) => {
    const m = marks.find((x) => x.key === i.key) ?? null;
    const auto = i.kind === 'AUTO' ? map.get(i.key) ?? null : null;
    const status = i.kind === 'MANUAL' ? (m?.done ? 'OK' : 'TODO')
      : !auto ? (m?.done ? 'OVERRIDE' : 'ERROR')
      : auto.ok ? 'OK' : m?.done ? 'OVERRIDE' : 'TODO';
    return { key: i.key, label: i.label, kind: i.kind, where: i.where, status, statusKo: CLOSE_STATUS_KO[status], detail: auto?.detail ?? '', mark: m };
  });
  const left = rows.filter((r) => r.status === 'TODO' || r.status === 'ERROR');
  return {
    ym, closed: !!closed, closedAt: closed?.closedAt ?? null, closeBy: cs.closeBy, rows, items, errors,
    count: { total: rows.length, done: rows.length - left.length, left: left.length },
    ready: left.length === 0,
    note: `달 마감 전에 할 일입니다 — 저절로 셈은 장부 · 통장 · 급여 · 감가상각 기록을 보고, 사람 확인은 직접 「확인」을 누릅니다. 저절로 셈이 맞지 않는 까닭이 있으면 사유와 함께 「예외 확인」합니다. 마감은 매달 ${cs.closeBy}일까지(회계 › 전표 › 월 마감).`,
  };
}

/** POST /admin/acct/close-check/marks — 확인 · 풀기(마감 전 달 · 저절로 셈 항목의 예외 확인은 사유 꼭) */
export async function markClose(db: DatabaseService, b: { ym?: string; key?: string; done?: boolean; note?: string }, actor: string | null) {
  if (!YM_RE.test(b.ym ?? '')) throw new PolicyViolation('ACCT_PERIOD', '달은 YYYY-MM 입니다.');
  const [i] = await db.query<{ kind: string; active: boolean; label: string }>(`SELECT kind, active, label FROM hra_close_items WHERE key = $1`, [String(b.key ?? '')]);
  if (!i || !i.active) throw new NotFound('없는 체크리스트 항목입니다.');
  const [c] = await db.query(`SELECT 1 FROM acct_closings WHERE ym = $1`, [b.ym]);
  if (c) throw new StateConflict('HRA_CLOSE_CLOSED', '마감한 달은 확인을 바꾸지 않습니다.');
  const done = b.done !== false;
  const note = textOk(b.note, 0, 200) || null;
  if (i.kind === 'AUTO' && done && (!note || note.length < 2)) throw new PolicyViolation('HRA_CLOSE_REASON', '저절로 셈 항목을 예외로 확인하려면 사유를 2자 이상 적습니다.');
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO hra_close_marks (ym, item_key, done, note, marked_by) VALUES ($1, $2, $3::boolean, $4, $5::uuid) RETURNING id::text AS id`, [b.ym, b.key, done, note, actor]);
  const note2 = !done ? `「${i.label}」 확인을 풀었습니다(기록에 남음).` : i.kind === 'AUTO' ? `「${i.label}」 예외 확인을 남겼습니다(기록에 남음).` : `「${i.label}」 확인을 남겼습니다(기록에 남음).`;
  return { ok: true, id: r!.id, ym: b.ym, key: b.key, done, note: note2 };
}

/** POST /admin/acct/close-check/items (SUPER) — 사람 확인 항목 더하기 */
export async function addCloseItem(db: DatabaseService, b: { key?: string; label?: string; where?: string; sort?: number }, actor: string | null) {
  const key = String(b.key ?? '').trim();
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(key)) throw new PolicyViolation('HRA_CLOSE_ITEM', '열쇠는 영어 소문자로 시작하는 2 ~ 31자(소문자 · 숫자 · _)입니다.');
  const label = textOk(b.label, 2, 60);
  if (!label) throw new PolicyViolation('HRA_CLOSE_ITEM', '이름은 2 ~ 60자입니다.');
  const sort = Number.isInteger(b.sort) ? Math.min(9999, Math.max(0, Number(b.sort))) : 200;
  const r = await db.query(
    `INSERT INTO hra_close_items (key, label, kind, where_ko, sort, updated_by) VALUES ($1, $2, 'MANUAL', $3, $4::int, $5::uuid) ON CONFLICT (key) DO NOTHING RETURNING key`,
    [key, label, textOk(b.where, 0, 60) || null, sort, actor]);
  if (!r.length) throw new StateConflict('HRA_CLOSE_ITEM_EXISTS', '같은 열쇠의 항목이 있습니다.');
  return { ok: true, key, note: `사람 확인 항목 「${label}」을 더했습니다.` };
}

/** PUT /admin/acct/close-check/items/{key} (SUPER) — 이름 · 어디 · 순서 · 켜고 끄기(지우지 않음) · 보낸 칸만 */
export async function updateCloseItem(db: DatabaseService, key: string, b: { label?: string; where?: string; sort?: number; active?: boolean }, actor: string | null) {
  const [i] = await db.query<{ label: string; where: string | null; sort: number; active: boolean }>(
    `SELECT label, where_ko AS "where", sort, active FROM hra_close_items WHERE key = $1`, [String(key ?? '')]);
  if (!i) throw new NotFound('없는 체크리스트 항목입니다.');
  const label = b.label === undefined ? i.label : textOk(b.label, 2, 60);
  if (!label) throw new PolicyViolation('HRA_CLOSE_ITEM', '이름은 2 ~ 60자입니다.');
  const where = b.where === undefined ? i.where : (textOk(b.where, 0, 60) || null);
  const sort = b.sort === undefined ? i.sort : Number.isInteger(b.sort) ? Math.min(9999, Math.max(0, Number(b.sort))) : i.sort;
  const active = b.active === undefined ? i.active : b.active === true;
  await db.query(`UPDATE hra_close_items SET label = $2, where_ko = $3, sort = $4::int, active = $5::boolean, updated_by = $6::uuid WHERE key = $1`, [key, label, where, sort, active, actor]);
  return { ok: true, key, active, note: active ? `항목 「${label}」을 고쳤습니다.` : `항목 「${label}」을 껐습니다 — 체크리스트에서 빠집니다.` };
}

/** 정기 작업(hra_daily 안) — 지난달 마감 전 남은 일 HRA_CLOSE_TODO(달마다 한 번) · 마감 · 모두 끝이면 풂 */
export async function closeAlertJob(db: DatabaseService, today = kstToday()) {
  const s = await hraSettings(db);
  const cs = await closeSettings(db);
  let resolved = 0, made = 0;
  const open = await db.query<{ id: string; ym: string }>(`SELECT id::text AS id, detail->>'ym' AS ym FROM ops_alerts WHERE alert_code = 'HRA_CLOSE_TODO' AND resolved_at IS NULL`);
  for (const a of open) {
    const c = await closeCheck(db, a.ym).catch(() => null);
    if (c && (c.closed || c.ready)) {
      const r = await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2 WHERE id = $1::bigint AND resolved_at IS NULL RETURNING id`, [a.id, c.closed ? '마감함' : '모두 끝']);
      resolved += r.length;
    }
  }
  const pm = prevYm(today.slice(0, 7));
  const day = Number(today.slice(8, 10));
  if (!s.closeAlert || pm < cs.startYm || day < cs.closeBy - s.closeAlertDaysBefore) return { on: s.closeAlert, ym: pm, made, resolved };
  const c = await closeCheck(db, pm);
  if (c.closed || c.ready) return { on: true, ym: pm, made, resolved };
  const r = await db.query(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
     SELECT 'HRA_CLOSE_TODO', $1, $2, $3::jsonb, clock_timestamp()
      WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'HRA_CLOSE_TODO' AND detail->>'ym' = $4)
     ON CONFLICT DO NOTHING RETURNING id`,
    [day > cs.closeBy ? 'CRITICAL' : 'WARN', `${pm} 회계 마감 전 남은 일 ${c.count.left}개(마감 매달 ${cs.closeBy}일) — 회계 › 마감 체크리스트`,
     JSON.stringify({ ym: pm, left: c.rows.filter((x) => x.status === 'TODO' || x.status === 'ERROR').map((x) => x.key) }), pm]);
  made = r.length;
  return { on: true, ym: pm, made, resolved, left: c.count.left };
}

/** 정기 작업 hra_daily(매일 09:50) — 연차 촉진 · 꼭 읽을 공지 · 회계 마감 · 하나가 실패해도 나머지는 돎 */
export async function hraDailyJob(db: DatabaseService) {
  const out: Record<string, unknown> = {};
  let affected = 0;
  const step = async (name: string, fn: () => Promise<Record<string, unknown>>) => {
    try { const r = await fn(); out[name] = r; affected += Number(r.made ?? 0); } catch (e) { out[name] = { error: String((e as Error)?.message ?? e).slice(0, 300) }; }
  };
  await step('leavePromo', () => leavePromoJob(db) as Promise<Record<string, unknown>>);
  await step('libUnread', () => libUnreadJob(db) as Promise<Record<string, unknown>>);
  await step('close', () => closeAlertJob(db) as Promise<Record<string, unknown>>);
  return { affected, detail: out };
}
