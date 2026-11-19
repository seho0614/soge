import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { ReportBody, addDays, buildDay, changeOf, dayOk, kstToday, metrics, nowState, textOf, tops } from './report-day';
import { controlLine } from '../acct/archive';   // v10.440 (D257) 월보에 내부통제 한 줄

/* ---------------------------------------------------------------------
 * v10.413 (D250 · docs/550) 주보 · 월보 · 보고 기록
 *   주 = 월요일 ~ 일요일(period = 그 주 월요일) · 달 = 1일 ~ 말일(period = YYYY-MM).
 *   지난 기간 대비 증감 % · 상위 5 · 보고 기록(report_snapshots · 쌓기만 · 같은 기간 다시 만들면 새 줄).
 *   정기 작업 ops_report(매일 07:00): 전날 일보 · 월요일이면 지난주 주보 · 1일이면 지난달 월보 — 같은 기간 JOB 보고는 한 번.
 * ------------------------------------------------------------------- */

export type Kind = 'DAY' | 'WEEK' | 'MONTH';
export const KINDS: Kind[] = ['DAY', 'WEEK', 'MONTH'];

/** 그 날이 든 주의 월요일 */
export const mondayOf = (d: string) => { const wd = new Date(d + 'T00:00:00Z').getUTCDay(); return addDays(d, -((wd + 6) % 7)); };
const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10); };
const prevYm = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, '0')}`; };

/** 기간 → [from, to] · 지난 기간 */
export function rangeOf(kind: Kind, period: string): { period: string; from: string; to: string; prev: { from: string; to: string } } {
  if (kind === 'DAY') { dayOk(period); return { period, from: period, to: period, prev: { from: addDays(period, -1), to: addDays(period, -1) } }; }
  if (kind === 'WEEK') {
    dayOk(period); const mo = mondayOf(period);
    return { period: mo, from: mo, to: addDays(mo, 6), prev: { from: addDays(mo, -7), to: addDays(mo, -1) } };
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '')) throw new PolicyViolation('REPORT_PERIOD', '달은 YYYY-MM 입니다.');
  const p = prevYm(period);
  return { period, from: `${period}-01`, to: lastDay(period), prev: { from: `${p}-01`, to: lastDay(p) } };
}

export const kindOk = (k: string): Kind => {
  if (!(KINDS as string[]).includes(k)) throw new PolicyViolation('REPORT_KIND', '보고 종류는 DAY · WEEK · MONTH 입니다.');
  return k as Kind;
};

/** 본문 계산(저장하지 않음) */
export async function buildReport(db: DatabaseService, kind: Kind, period: string): Promise<ReportBody> {
  if (kind === 'DAY') return buildDay(db, period);
  const r = rangeOf(kind, period);
  const m = await metrics(db, r.from, r.to), prev = await metrics(db, r.prev.from, r.prev.to);
  return { kind, period: r.period, from: r.from, to: r.to, made: new Date().toISOString(), m, prev, change: changeOf(m, prev), tops: await tops(db, r.from, r.to), now: await nowState(db) };
}

/** 보고 남기기 — 같은 기간 JOB 보고가 있으면(onlyOnce) 그대로 돌려줌 */
export async function makeSnapshot(db: DatabaseService, kind: Kind, period: string, source: 'JOB' | 'MANUAL', actor: string | null, onlyOnce = false) {
  const body = await buildReport(db, kind, period);
  if (onlyOnce) {
    const [had] = await db.query<{ id: string }>(`SELECT id::text AS id FROM report_snapshots WHERE kind = $1 AND period = $2 AND source = 'JOB' ORDER BY id DESC LIMIT 1`, [kind, body.period]);
    if (had) return { id: had.id, made: false, body };
  }
  const [s] = await db.query<{ id: string }>(
    `INSERT INTO report_snapshots (kind, period, period_from, period_to, body, source, made_by) VALUES ($1, $2, $3::date, $4::date, $5::jsonb, $6, $7) RETURNING id::text AS id`,
    [kind, body.period, body.from, body.to, JSON.stringify(body), source, actor]);
  return { id: s!.id, made: true, body };
}

/** 화면 — 그 기간 마지막 보고(있으면) · 없으면 지금 계산 · 같은 종류 최근 기록 20 */
export async function reportView(db: DatabaseService, kind: Kind, period?: string) {
  const today = kstToday();
  const p = period || (kind === 'DAY' ? addDays(today, -1) : kind === 'WEEK' ? addDays(mondayOf(today), -7) : prevYm(today.slice(0, 7)));
  const r = rangeOf(kind, p);
  const [snap] = await db.query<{ id: string; body: ReportBody; created_at: string; source: string }>(
    `SELECT id::text AS id, body, created_at, source FROM report_snapshots WHERE kind = $1 AND period = $2 ORDER BY id DESC LIMIT 1`, [kind, r.period]);
  const body = snap?.body ?? (await buildReport(db, kind, r.period));
  const history = await db.query(
    `SELECT s.id::text AS id, s.period, s.source, s.created_at AS "createdAt",
            (SELECT count(*)::int FROM report_sends x WHERE x.snapshot_id = s.id AND x.result = 'SENT') AS sent
       FROM report_snapshots s WHERE s.kind = $1 ORDER BY s.id DESC LIMIT 20`, [kind]);
  const sends = snap ? await db.query(
    `SELECT channel, result, created_at AS "createdAt" FROM report_sends WHERE snapshot_id = $1::bigint ORDER BY id DESC LIMIT 10`, [snap.id]) : [];
  return { kind, period: r.period, from: r.from, to: r.to, snapshot: snap ? { id: snap.id, createdAt: snap.created_at, source: snap.source } : null,
           live: !snap, body, text: textOf(body), history, sends,
           control: kind === 'MONTH' ? await controlLine(db, r.period).catch(() => null) : null,   // v10.440 (D257) 내부통제
           note: '숫자만 담습니다(이름 · 연락처 없음). 매출은 전표 기준 공급가(부가세 뺌)이고, 「만들 때」 칸은 보고를 만든 때의 값입니다.' };
}

export async function snapshotById(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 보고입니다.');
  const [s] = await db.query<{ id: string; kind: Kind; period: string; body: ReportBody }>(
    `SELECT id::text AS id, kind, period, body FROM report_snapshots WHERE id = $1::bigint`, [id]);
  if (!s) throw new NotFound('없는 보고입니다.');
  return s;
}

/** 정기 작업 ops_report — 전날 일보 · 월요일 지난주 주보 · 1일 지난달 월보(같은 기간 JOB 은 한 번) */
export async function opsReportJob(db: DatabaseService, today = kstToday()) {
  const made: Array<{ kind: Kind; period: string; id: string; made: boolean }> = [];
  const y = addDays(today, -1);
  const d = await makeSnapshot(db, 'DAY', y, 'JOB', null, true); made.push({ kind: 'DAY', period: y, id: d.id, made: d.made });
  if (new Date(today + 'T00:00:00Z').getUTCDay() === 1) {
    const wk = addDays(today, -7);
    const w = await makeSnapshot(db, 'WEEK', wk, 'JOB', null, true); made.push({ kind: 'WEEK', period: w.body.period, id: w.id, made: w.made });
  }
  if (today.slice(8, 10) === '01') {
    const pm = prevYm(today.slice(0, 7));
    const m = await makeSnapshot(db, 'MONTH', pm, 'JOB', null, true); made.push({ kind: 'MONTH', period: pm, id: m.id, made: m.made });
  }
  return { today, made };
}
