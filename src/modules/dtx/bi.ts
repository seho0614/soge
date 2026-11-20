import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { addDays, kstToday } from '../admin/report-day';

/* ---------------------------------------------------------------------
 * v10.535 (D282 · docs/673) 통계 내보내기 BI — 대표 11/20 「(52) ①」
 *   하루(한국 날짜) × 지표 × 나눔 숫자만 모은 표(bi_daily_metrics) · DB 함수 fn_bi_daily_build 가 기간을 지우고 다시 셈
 *   ★ 개인 식별 없음 — 계정 · 이메일 · 휴대폰 · IP · 이름 칸을 만들지 않고, 나눔은 관 코드 · 게시판 · 문의 종류 · 목표처럼 묶음 이름만
 *   외부 BI 도구는 bi 스키마 보기(bi.v_metrics_daily · v_metric_catalog · v_site_usage_daily · v_site_usage_goals · v_build_state)를 읽음
 *     — 읽기 전용 DB 계정 · 권한은 운영 서버에서 사람이 만듦(docs/673 5절 · 마이그레이션은 ROLE · GRANT 를 만들지 않음)
 *   밖으로 나가는 것(bi 보기 · CSV)은 작은 칸 가림: 나눔 줄 숫자가 bi.min_cell(처음 3) 미만이면 비움
 *   CSV 는 내려받기 승인(@ExportGate('BI_DAILY')) — 개인정보는 없지만 회사 숫자가 밖으로 나가므로 사유 · 승인 · 24시간 한 번
 *   정기 작업 bi_daily(매일 04:50) — 어제까지 3일 다시 셈 · bi.keep_days(처음 1100일) 지난 줄 지움
 * ------------------------------------------------------------------- */

/** DB CHECK(bi_daily_metrics.dim)와 같은 정규식(규칙 2) */
export const BI_DIM_RE = /^[A-Za-z0-9_.:/-]{0,40}$/;
/** DB CHECK(bi_metric_defs.metric)와 같은 정규식 */
export const BI_METRIC_RE = /^[A-Z][A-Z0-9_]{1,31}$/;
/** site_settings value_pattern 과 같은 정규식 */
export const BI_MIN_CELL_RE = /^([0-9]|1[0-9]|20)$/;
export const BI_KEEP_RE = /^[0-9]{3,4}$/;
export const BI_VIEWS = ['v_metrics_daily', 'v_metric_catalog', 'v_site_usage_daily', 'v_site_usage_goals', 'v_build_state'] as const;
export const BI_RECALC_DAYS = 3;
export const BI_RUN_MAX_DAYS = 31;
export const BI_VIEW_MAX_DAYS = 400;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const dayOk = (d?: string | null) => !!d && YMD.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const n = (v: unknown) => Number(v ?? 0);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3);

export interface BiSettings { minCell: number; keepDays: number }
export async function biSettings(db: DatabaseService): Promise<BiSettings> {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key IN ('bi.min_cell', 'bi.keep_days')`);
  const m = new Map(rows.map((r) => [r.key, r.value ?? '']));
  const mc = m.get('bi.min_cell') ?? '';
  const kd = Number(m.get('bi.keep_days'));
  return { minCell: BI_MIN_CELL_RE.test(mc) ? Number(mc) : 3, keepDays: Number.isInteger(kd) && kd >= 400 && kd <= 3650 ? kd : 1100 };
}

/** 기간 · 지표 고르기 검사 — 비우면 지난 30일(어제까지) · 지표 비우면 모두 */
export function biRange(fromIn?: string, toIn?: string, maxDays = BI_VIEW_MAX_DAYS) {
  const yesterday = addDays(kstToday(), -1);
  const to = toIn || yesterday;
  const from = fromIn || addDays(to, -29);
  if (!dayOk(from) || !dayOk(to)) throw new PolicyViolation('BI_RANGE', '날짜는 YYYY-MM-DD 입니다.');
  if (from > to) throw new PolicyViolation('BI_RANGE', '시작일이 끝날보다 늦습니다.');
  if (to > kstToday()) throw new PolicyViolation('BI_RANGE', '끝날은 오늘까지입니다.');
  if (daysBetween(from, to) + 1 > maxDays) throw new PolicyViolation('BI_RANGE', `기간은 ${maxDays}일까지입니다.`);
  return { from, to };
}
export function biMetrics(raw?: string): string[] {
  const xs = String(raw ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (xs.some((x) => !BI_METRIC_RE.test(x))) throw new PolicyViolation('BI_METRIC', '지표 이름은 대문자 · 숫자 · 밑줄입니다(예: SIGNUP,ORDER_PAID).');
  return [...new Set(xs)].slice(0, 30);
}

/** GET /admin/bi — 지표 목록 · 집계 상태 · 설정 · BI 보기와 칸 · 개인 식별 칸 감시 */
export async function biOverview(db: DatabaseService) {
  const defs = await db.query<{ metric: string; labelKo: string; unit: string; dimLabel: string | null; sourceKo: string }>(
    `SELECT metric, label_ko AS "labelKo", unit, dim_label AS "dimLabel", source_ko AS "sourceKo" FROM bi_metric_defs ORDER BY sort, metric`);
  const [st] = await db.query<{ lastDay: string | null; builtAt: string | null; rowCount: number; firstDay: string | null }>(
    `SELECT max(day)::text AS "lastDay", max(built_at) AS "builtAt", count(*)::int AS "rowCount", min(day)::text AS "firstDay" FROM bi_daily_metrics`);
  const cols = await db.query<{ view: string; column: string; type: string }>(
    `SELECT table_name::text AS view, column_name::text AS column, data_type::text AS type FROM information_schema.columns
      WHERE table_schema = 'bi' ORDER BY table_name, ordinal_position`);
  const pii = await db.query<{ viewName: string; columnName: string }>(`SELECT view_name AS "viewName", column_name AS "columnName" FROM v_bi_pii_columns`);
  const views = BI_VIEWS.map((v) => ({ name: `bi.${v}`, columns: cols.filter((c) => c.view === v).map((c) => ({ name: c.column, type: c.type })) }));
  return {
    defs, settings: await biSettings(db), lastDay: st?.lastDay ?? null, firstDay: st?.firstDay ?? null, builtAt: st?.builtAt ?? null, rowCount: n(st?.rowCount),
    views, piiColumns: pii, runMaxDays: BI_RUN_MAX_DAYS, viewMaxDays: BI_VIEW_MAX_DAYS,
    note: '숫자만 모은 일별 집계입니다(계정 · 이메일 · 휴대폰 · IP 없음). 외부 BI 도구는 bi 스키마 보기를 읽기 전용 계정으로 연결합니다 — 계정은 운영 서버에서 사람이 만듭니다(docs/673 5절).',
  };
}

/** GET /admin/bi/daily — 운영 화면 표(정확한 숫자 · 운영 화면 안에서만) · 지표마다 기간 합 · 나눔마다 합 */
export async function biDaily(db: DatabaseService, q: { from?: string; to?: string; metrics?: string }) {
  const { from, to } = biRange(q.from, q.to);
  const ms = biMetrics(q.metrics);
  const rows = await db.query<{ day: string; metric: string; dim: string; value: string }>(
    `SELECT day::text AS day, metric, dim, value::text AS value FROM bi_daily_metrics
      WHERE day BETWEEN $1::date AND $2::date AND (cardinality($3::text[]) = 0 OR metric = ANY ($3::text[]))
      ORDER BY day, metric, dim LIMIT 20000`, [from, to, ms]);
  const totals: Record<string, number> = {};
  const byDim: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const v = n(r.value);
    totals[r.metric] = (totals[r.metric] ?? 0) + v;
    if (r.dim !== '') {
      const m = byDim[r.metric] ?? (byDim[r.metric] = {});
      m[r.dim] = (m[r.dim] ?? 0) + v;
    }
  }
  return { from, to, metrics: ms, items: rows.map((r) => ({ ...r, value: n(r.value) })), totals, byDim, truncated: rows.length >= 20000 };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
};

/** GET /admin/bi/export — CSV(작은 칸 가림 · bi.v_metrics_daily 그대로 · 내려받기 승인은 인터셉터가) */
export async function biExport(db: DatabaseService, q: { from?: string; to?: string; metrics?: string }) {
  const { from, to } = biRange(q.from, q.to);
  const ms = biMetrics(q.metrics);
  const rows = await db.query<{ day: string; metric: string; label: string; unit: string; dim: string; value: string | null; suppressed: boolean }>(
    `SELECT v.day::text AS day, v.metric, d.label_ko AS label, d.unit, v.dim, v.value::text AS value, v.suppressed
       FROM bi.v_metrics_daily v JOIN bi_metric_defs d ON d.metric = v.metric
      WHERE v.day BETWEEN $1::date AND $2::date AND (cardinality($3::text[]) = 0 OR v.metric = ANY ($3::text[]))
      ORDER BY v.day, d.sort, v.metric, v.dim LIMIT 50000`, [from, to, ms]);
  const head = ['day', 'metric', 'label', 'unit', 'dim', 'value', 'suppressed'];
  const csv = '﻿' + [head, ...rows.map((r) => [r.day, r.metric, r.label, r.unit, r.dim, r.value ?? '', r.suppressed ? 'Y' : ''])]
    .map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const s = await biSettings(db);
  return {
    csv, filename: `sogaebank_bi_${from}_${to}.csv`, rows: rows.length, suppressed: rows.filter((r) => r.suppressed).length,
    note: `${rows.length}줄을 내려받았습니다 — 나눔 줄 숫자가 ${s.minCell} 미만이면 비웠습니다(bi.min_cell).`,
  };
}

/** 기간 다시 셈 — 같은 때 두 번이면 409(트랜잭션 잠금) */
async function build(db: DatabaseService, from: string, to: string): Promise<number> {
  return db.transaction(async () => {
    const [lk] = await db.query<{ ok: boolean }>(`SELECT pg_try_advisory_xact_lock(hashtext('bi_daily_build')) AS ok`);
    if (!lk?.ok) throw new StateConflict('BI_BUSY', '다른 사람이 · 정기 작업이 지금 다시 세고 있습니다 — 잠시 뒤 다시 하십시오.');
    const [r] = await db.query<{ n: number }>(`SELECT fn_bi_daily_build($1::date, $2::date) AS n`, [from, to]);
    return n(r?.n);
  });
}

/** POST /admin/bi/run — 운영 화면 「다시 셈」(31일까지) */
export async function biRun(db: DatabaseService, b: { from?: string; to?: string }) {
  if (!b.from || !b.to) throw new PolicyViolation('BI_RANGE', '시작일 · 끝날을 넣으십시오.');
  const { from, to } = biRange(b.from, b.to, BI_RUN_MAX_DAYS);
  const rows = await build(db, from, to);
  return { ok: true, from, to, rows, note: `${from} ~ ${to} 을 다시 셌습니다 — ${rows}줄.` };
}

/** PUT /admin/bi/settings — SUPER · 사유 · 설정 바뀜 기록은 site_settings 트리거가 남김 */
export async function setBiSettings(db: DatabaseService, d: { minCell?: number; keepDays?: number; reason?: string }) {
  const reason = String(d.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('BI_REASON', '사유는 2 ~ 200자입니다.');
  const set: Array<[string, string]> = [];
  if (d.minCell !== undefined && d.minCell !== null) {
    if (!BI_MIN_CELL_RE.test(String(d.minCell))) throw new PolicyViolation('BI_MIN_CELL', '작은 칸 가림은 0 ~ 20 입니다.');
    set.push(['bi.min_cell', String(d.minCell)]);
  }
  if (d.keepDays !== undefined && d.keepDays !== null) {
    if (!BI_KEEP_RE.test(String(d.keepDays)) || d.keepDays < 400 || d.keepDays > 3650) throw new PolicyViolation('BI_KEEP', '보관 일수는 400 ~ 3650 입니다.');
    set.push(['bi.keep_days', String(d.keepDays)]);
  }
  if (!set.length) throw new PolicyViolation('BI_NOTHING', '바꿀 것이 없습니다.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  return { ok: true, settings: await biSettings(db), note: 'BI 설정을 바꿨습니다.' };
}

export interface BiJobResult { from: string; to: string; built: number; purged: number; busy: boolean }
/** 정기 작업 bi_daily — 어제까지 3일 다시 셈 · 보관 지난 줄 지움 */
export async function biDailyJob(db: DatabaseService): Promise<BiJobResult> {
  const to = addDays(kstToday(), -1);
  const from = addDays(to, -(BI_RECALC_DAYS - 1));
  let built = 0, busy = false;
  try { built = await build(db, from, to); } catch (e) {
    if (e instanceof StateConflict) busy = true; else throw e;
  }
  const s = await biSettings(db);
  const del = await db.query(`DELETE FROM bi_daily_metrics WHERE day < $1::date RETURNING 1`, [addDays(kstToday(), -s.keepDays)]);
  return { from, to, built, purged: del.length, busy };
}
