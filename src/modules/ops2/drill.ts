import { PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';

/* ---------------------------------------------------------------------
 * v10.585 (docs/727) 14차 운영 ① DB 복원 반자동 리허설 — 스크립트 결과를 기존 「DB 복원 시험 기록」(D238 restore_drills)에
 *
 *   deploy/aws/restore-drill.sh --run 이 끝에 찍는 JSON(날 · 스냅샷 · 걸린 분 · 표마다 운영 행 수 / 복원 행 수 · 방식)을
 *   운영 화면 관 관리 › 업무 안내 › 「스크립트 결과 붙여 넣기」(SUPER)가 이 함수로 넣습니다(source = 'SCRIPT' · detail).
 *   ★ 행 수 맞음은 서버가 다시 셈(ops2.drill_tol_pct) — 스크립트 값과 다르면 서버 값으로 적고 메모에 남김.
 *   ★ 리허설(--compare · mode compare)은 운영 복원 시험이 아니라 받지 않음(RESTORE_DRILL_DUE 를 잘못 풀지 않게).
 *   적으면 운영 알림 RESTORE_DRILL_DUE 가 풀림(사람이 적을 때 · ops-safety.controller addDrill 과 같음).
 * ------------------------------------------------------------------- */

/** = ops-safety.controller addDrill 의 스냅샷 이름 규칙(DB CHECK 는 길이 2 ~ 100 · 같은 범위) */
export const OPS2_SNAPSHOT_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{1,99}$/;
/** 표 이름(스크립트가 세는 표 · audit.audit_logs 처럼 스키마 점 하나) */
export const OPS2_TABLE_RE = /^[a-z][a-z0-9_]{1,40}(\.[a-z][a-z0-9_]{1,40})?$/;
export const OPS2_DRILL_MODES = ['aws', 'console'] as const;

export interface Ops2DrillTable { name: string; src: number; drill: number }
export interface Ops2DrillIn {
  drillDate: string; snapshot: string; minutes: number; rowsMatch: boolean; ok: boolean; note?: string;
  mode: string; tool?: string; tables: Ops2DrillTable[];
}

/** 표 한 줄 맞음 — 복원이 운영보다 많으면 다름 · 적은 것은 tol 퍼센트(또는 100줄)까지(스냅샷 뒤 늘어난 줄) */
export function ops2RowOk(src: number, drill: number, tolPct: number): boolean {
  if (!Number.isFinite(src) || !Number.isFinite(drill) || src < 0 || drill < 0) return false;
  if (drill > src) return false;
  return src - drill <= Math.max(100, Math.floor((src * tolPct) / 100));
}

async function tolPct(db: DatabaseService): Promise<number> {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'ops2.drill_tol_pct'`);
  const n = Number(r?.v ?? 5);
  return Number.isFinite(n) ? Math.min(50, Math.max(0, n)) : 5;
}

/** POST /admin/ops2/restore-drills/result — 스크립트 결과 넣기(SUPER) */
export async function ops2DrillAdd(db: DatabaseService, dto: Ops2DrillIn) {
  if (!(OPS2_DRILL_MODES as readonly string[]).includes(dto.mode)) {
    throw new PolicyViolation('OPS2_DRILL_MODE', '리허설(compare) 결과는 운영 복원 시험으로 적지 않습니다 — --run 결과(aws · console)를 붙여 넣으십시오.');
  }
  const snap = String(dto.snapshot ?? '').trim();
  if (!OPS2_SNAPSHOT_RE.test(snap)) throw new PolicyViolation('RESTORE_DRILL_SNAPSHOT', '스냅샷 이름은 영문 · 숫자 · - · : · . · _ 로 2 ~ 100자입니다.');
  const [d] = await db.query<{ ok: boolean }>(
    `SELECT ($1::date <= (now() AT TIME ZONE 'Asia/Seoul')::date AND $1::date > (now() AT TIME ZONE 'Asia/Seoul')::date - 366) AS ok`, [dto.drillDate]).catch(() => [{ ok: false }]);
  if (!d?.ok) throw new PolicyViolation('RESTORE_DRILL_DATE', '시험한 날은 오늘이나 지난 1년 안이어야 합니다.');
  const tables = (dto.tables ?? []).filter((t) => t && OPS2_TABLE_RE.test(String(t.name)));
  if (!tables.length || tables.length !== (dto.tables ?? []).length) {
    throw new PolicyViolation('OPS2_DRILL_TABLES', '표마다 행 수(이름 · 운영 · 복원)가 1 ~ 30줄 있어야 합니다 — 스크립트가 찍은 JSON 을 그대로 붙여 넣으십시오.');
  }
  const names = new Set(tables.map((t) => t.name));
  if (names.size !== tables.length) throw new PolicyViolation('OPS2_DRILL_TABLES', '같은 표가 두 번 있습니다 — 스크립트가 찍은 JSON 을 그대로 붙여 넣으십시오.');
  const tol = await tolPct(db);
  const rows = tables.map((t) => ({ name: t.name, src: Math.trunc(Number(t.src)), drill: Math.trunc(Number(t.drill)), ok: ops2RowOk(Number(t.src), Number(t.drill), tol) }));
  const rowsMatch = rows.every((r) => r.ok);
  const ok = !!dto.ok && rowsMatch;
  const [dup] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM restore_drills WHERE source = 'SCRIPT' AND drill_date = $1::date AND snapshot = $2`, [dto.drillDate, snap]);
  if ((dup?.n ?? 0) > 0) throw new StateConflict('OPS2_DRILL_DUP', '같은 날 · 같은 스냅샷의 스크립트 결과가 이미 있습니다.');
  const diff = rowsMatch !== !!dto.rowsMatch ? ` · 행 수 맞음을 서버가 다시 셈(스크립트 ${dto.rowsMatch ? '맞음' : '다름'} → ${rowsMatch ? '맞음' : '다름'} · 한도 ${tol}퍼센트)` : '';
  const note = ((String(dto.note ?? '').trim() + diff).trim().slice(0, 500)) || null;
  const detail = { tool: String(dto.tool ?? '').slice(0, 60), mode: dto.mode, tolPct: tol, tables: rows };
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO restore_drills (drill_date, snapshot, minutes, rows_match, ok, note, created_by, source, detail)
     VALUES ($1::date, $2, $3::int, $4::boolean, $5::boolean, $6, $7, 'SCRIPT', $8::jsonb) RETURNING id::text AS id`,
    [dto.drillDate, snap, Math.trunc(dto.minutes), rowsMatch, ok, note, RequestCtx.actorId() ?? null, JSON.stringify(detail)]);
  await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = '복원 시험 기록됨(스크립트)' WHERE alert_code = 'RESTORE_DRILL_DUE' AND resolved_at IS NULL`);
  return {
    ok: true, id: r!.id, rowsMatch, drillOk: ok,
    note: ok ? '스크립트 결과를 복원 시험 기록에 적었습니다.' : '스크립트 결과를 적었습니다 — 행 수가 다르거나 이상이 있다고 나와 원인을 운영 게시판에 남겨 주십시오.',
  };
}

/** GET /admin/ops2/restore-drills/script — 스크립트로 적은 최근 6번(표마다 행 수) · 한도 · 적을 수 있는가 */
export async function ops2DrillScript(db: DatabaseService, roles: string[]) {
  const rows = await db.query(
    `SELECT id::text AS id, to_char(drill_date, 'YYYY-MM-DD') AS "drillDate", snapshot, minutes, rows_match AS "rowsMatch", ok, note,
            detail, created_at AS "createdAt"
       FROM restore_drills WHERE source = 'SCRIPT' ORDER BY drill_date DESC, id DESC LIMIT 6`);
  return { rows, tolPct: await tolPct(db), canEdit: roles.includes('SUPER'),
    note: '운영 서버에서 bash ~/sgb/deploy/aws/restore-drill.sh --run 을 돌린 뒤 끝에 찍힌 JSON 을 붙여 넣습니다(행 수는 서버가 다시 셈).' };
}
