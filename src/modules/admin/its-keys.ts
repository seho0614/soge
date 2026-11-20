import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { INTEG_KEYS, IntegrationSecretService } from '../../common/integration/secret.service';

/* ---------------------------------------------------------------------
 * v10.490 (D270 · docs/628) 외부 연동 키 만료 · 교체 알림 — 대표 11/20 「㊵ 사무 · 보안」
 *   키마다(연동 코드 · 키 이름 — INTEG_KEYS 목록 그대로) 만료일 · 교체 주기(일) · 마지막 교체 · 담당 메모(its_key_life)
 *   마지막 교체: 운영 화면 「연동 키」에서 넣으면 DB 트리거(trg_its_key_rotated)가 저절로 · .env 키는 「바꿨음」 단추(MANUAL)
 *   다음 기한 = 만료일 · (마지막 교체(없으면 줄 만든 날) + 주기) 중 이른 날 → its.key_alert_days(처음 30 · 7)일 전 · 지나면 ITS_KEY_EXPIRY
 *   ★ 키 값은 읽지도 내보내지도 않습니다 — 이 파일은 integration_secrets 를 부르지 않고, 「연동 키」 목록(IntegrationSecretService.list)에서
 *     이름 · 어디서 왔는지 · 넣은 날만 가져옴(끝 4자리 칸은 버림).
 * ------------------------------------------------------------------- */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const kstDate = (t: Date | string | null | undefined) => (t ? new Date(new Date(t).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : null);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400e3);
export const dayOk = (d?: string | null) => !!d && YMD.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** 알림 며칠 전 설정(쉼표 · 큰 수부터 · 1 ~ 365 · 4개까지) — 틀리면 30 · 7 */
export async function alertDays(db: DatabaseService, key: string): Promise<number[]> {
  const [r] = await db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = $1`, [key]);
  const xs = String(r?.value ?? '').split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x >= 1 && x <= 365);
  return xs.length ? [...new Set(xs)].sort((a, b) => b - a).slice(0, 4) : [30, 7];
}
export async function switchOn(db: DatabaseService, key: string) {
  const [r] = await db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = $1`, [key]);
  return (r?.value ?? 'on') === 'on';
}
/** 남은 날 → 알림 단계(OVER = 지남 · 숫자 = 그 「며칠 전」 칸 · null = 아직) */
export function stageOf(left: number, days: number[]): string | null {
  if (left < 0) return 'OVER';
  const hit = days.filter((d) => left <= d);
  return hit.length ? String(Math.min(...hit)) : null;
}

export interface LifeRow { code: string; name: string; expires_on: string | null; rotate_days: number | null; rotated_at: string | null; rotate_source: string | null; owner_note: string | null; created_at: string }

function dueOf(l: Pick<LifeRow, 'expires_on' | 'rotate_days' | 'rotated_at' | 'created_at'>) {
  const c: string[] = [];
  if (l.expires_on) c.push(l.expires_on);
  if (l.rotate_days) c.push(addDays(kstDate(l.rotated_at ?? l.created_at)!, l.rotate_days));
  return c.length ? c.sort()[0]! : null;
}

async function lifeRows(db: DatabaseService) {
  return db.query<LifeRow>(
    `SELECT integration_code AS code, key_name AS name, expires_on::text AS expires_on, rotate_days, rotated_at, rotate_source, owner_note, created_at
       FROM its_key_life`);
}

/** GET /admin/integration-keys/life — 키마다 만료 · 교체 상태(값 · 끝 4자리 없음) */
export async function keyLifeList(db: DatabaseService, secrets: IntegrationSecretService) {
  const [states, life, days] = await Promise.all([secrets.list(), lifeRows(db), alertDays(db, 'its.key_alert_days')]);
  const today = kstToday();
  const rows = states.map((k) => {
    const l = life.find((x) => x.code === k.code && x.name === k.name);
    const due = l ? dueOf(l) : null;
    const left = due ? diffDays(due, today) : null;
    const stage = left == null ? null : stageOf(left, days);
    return {
      code: k.code, integration: k.integration, name: k.name, label: k.label, source: k.source,
      keyUpdatedAt: k.updatedAt ?? null,
      expiresOn: l?.expires_on ?? null, rotateDays: l?.rotate_days ?? null, rotatedAt: l?.rotated_at ?? null, rotateSource: l?.rotate_source ?? null,
      ownerNote: l?.owner_note ?? null, due, left, level: stage === 'OVER' ? 'OVER' : stage ? 'SOON' : due ? 'OK' : 'UNSET',
    };
  });
  return {
    today, days, rows,
    counts: { over: rows.filter((r) => r.level === 'OVER').length, soon: rows.filter((r) => r.level === 'SOON').length, unset: rows.filter((r) => r.level === 'UNSET' && r.source !== 'NONE').length },
    alertOn: await switchOn(db, 'its.key_alert'),
    note: `만료일 · 교체 주기를 적으면 다음 기한 ${days.join(' · ')}일 전과 지난 뒤에 운영 알림(ITS_KEY_EXPIRY)이 갑니다. 이 화면에서 키를 새로 넣으면 「교체함」이 저절로 남고 만료일은 비워집니다(새 키의 만료일을 다시 적으십시오). 키 값은 여기서 다루지 않습니다.`,
  };
}

function keyDef(code: string, name: string) {
  const k = INTEG_KEYS.find((x) => x.code === code && x.name === name);
  if (!k) throw new NotFound('없는 연동 키 이름입니다.');
  return k;
}

export interface KeyLifeInput { expiresOn?: string | null; rotateDays?: number | null; ownerNote?: string | null }

/** PUT /admin/integration-keys/life/{code}/{name} — 보낸 칸만 바꿈(null = 비움 · 안 보내면 그대로) */
export async function setKeyLife(db: DatabaseService, code: string, name: string, b: KeyLifeInput, actor: string | null) {
  keyDef(code, name);
  const [cur] = await db.query<LifeRow>(
    `SELECT integration_code AS code, key_name AS name, expires_on::text AS expires_on, rotate_days, rotated_at, rotate_source, owner_note, created_at
       FROM its_key_life WHERE integration_code = $1 AND key_name = $2`, [code, name]);
  const next = { expires_on: cur?.expires_on ?? null, rotate_days: cur?.rotate_days ?? null, owner_note: cur?.owner_note ?? null };
  if (b.expiresOn !== undefined) {
    if (b.expiresOn !== null && b.expiresOn !== '' && !dayOk(b.expiresOn)) throw new PolicyViolation('ITS_KEY_DATE', '만료일(YYYY-MM-DD)이 맞지 않습니다.');
    next.expires_on = b.expiresOn ? b.expiresOn : null;
  }
  if (b.rotateDays !== undefined) {
    if (b.rotateDays !== null && (!Number.isInteger(b.rotateDays) || b.rotateDays < 7 || b.rotateDays > 1095)) throw new PolicyViolation('ITS_KEY_CYCLE', '교체 주기는 7 ~ 1095일입니다(비우면 없음).');
    next.rotate_days = b.rotateDays;
  }
  if (b.ownerNote !== undefined) {
    const t = b.ownerNote == null ? '' : clean(b.ownerNote);
    if (t.length > 200) throw new PolicyViolation('ITS_KEY_NOTE', '담당 메모는 200자까지입니다.');
    next.owner_note = t || null;
  }
  await db.transaction(async () => {
    await db.query(
      `INSERT INTO its_key_life (integration_code, key_name, expires_on, rotate_days, owner_note, updated_by, updated_at)
       VALUES ($1, $2, $3::date, $4::int, $5, $6::uuid, now())
       ON CONFLICT (integration_code, key_name) DO UPDATE
          SET expires_on = EXCLUDED.expires_on, rotate_days = EXCLUDED.rotate_days, owner_note = EXCLUDED.owner_note, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [code, name, next.expires_on, next.rotate_days, next.owner_note, actor]);
    await db.query(`INSERT INTO its_key_events (integration_code, key_name, kind, detail, actor) VALUES ($1, $2, 'LIFE_SET', $3::jsonb, $4::uuid)`,
      [code, name, JSON.stringify({ expiresOn: next.expires_on, rotateDays: next.rotate_days }), actor]);
  });
  await itsKeyExpiryJob(db);
  return { ok: true, code, name, ...next, note: '만료일 · 교체 주기를 저장했습니다 — 알림은 바로 다시 셉니다.' };
}

/** POST /admin/integration-keys/life/{code}/{name}/rotated — .env 키 등 화면 밖에서 바꾼 것을 「바꿨음」으로(새 만료일 함께 적을 수 있음) */
export async function markRotated(db: DatabaseService, code: string, name: string, b: { note?: string | null; expiresOn?: string | null }, actor: string | null) {
  keyDef(code, name);
  const exp = b.expiresOn ? String(b.expiresOn) : null;
  if (exp && !dayOk(exp)) throw new PolicyViolation('ITS_KEY_DATE', '만료일(YYYY-MM-DD)이 맞지 않습니다.');
  if (exp && exp < kstToday()) throw new PolicyViolation('ITS_KEY_DATE', '새 키의 만료일은 오늘이나 그 뒤입니다.');
  const note = clean(b.note).slice(0, 200);
  await db.transaction(async () => {
    await db.query(
      `INSERT INTO its_key_life (integration_code, key_name, rotated_at, rotated_by, rotate_source, expires_on, updated_by, updated_at)
       VALUES ($1, $2, now(), $3::uuid, 'MANUAL', $4::date, $3::uuid, now())
       ON CONFLICT (integration_code, key_name) DO UPDATE
          SET rotated_at = now(), rotated_by = EXCLUDED.rotated_by, rotate_source = 'MANUAL', expires_on = EXCLUDED.expires_on, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [code, name, actor, exp]);
    await db.query(`INSERT INTO its_key_events (integration_code, key_name, kind, detail, actor) VALUES ($1, $2, 'MANUAL_ROTATED', $3::jsonb, $4::uuid)`,
      [code, name, JSON.stringify({ expiresOn: exp, note: note || null }), actor]);
  });
  await itsKeyExpiryJob(db);
  return { ok: true, code, name, note: '「바꿨음」으로 남겼습니다 — 교체 주기는 오늘부터 다시 셉니다.' };
}

/** 정기 작업 its_key_expiry(매일 08:40) — 다음 기한 N일 전 · 지남 → ITS_KEY_EXPIRY(키 · 기한 · 단계마다 한 번) · 기한이 바뀌거나 꺼지면 풀림 */
export async function itsKeyExpiryJob(db: DatabaseService) {
  const on = await switchOn(db, 'its.key_alert');
  const days = await alertDays(db, 'its.key_alert_days');
  const today = kstToday();
  const life = on ? await db.query<LifeRow & { integ: string }>(
    `SELECT l.integration_code AS code, l.key_name AS name, l.expires_on::text AS expires_on, l.rotate_days, l.rotated_at, l.rotate_source, l.owner_note, l.created_at,
            coalesce(i.name, l.integration_code) AS integ
       FROM its_key_life l LEFT JOIN integrations i ON i.code = l.integration_code`) : [];
  const want: Array<{ key: string; sev: string; title: string; detail: Record<string, unknown> }> = [];
  for (const l of life) {
    const due = dueOf(l);
    if (!due) continue;
    const left = diffDays(due, today);
    const st = stageOf(left, days);
    if (!st) continue;
    const key = `${l.code}|${l.name}|${due}|${st}`;
    want.push({
      key, sev: st === 'OVER' ? 'CRITICAL' : 'WARN',
      title: st === 'OVER'
        ? `외부 연동 키 「${l.integ} · ${l.name}」 기한 지남(${due}) — 외부 연동 › 연동 키에서 새 키를 넣거나 「바꿨음」을 누르십시오`
        : `외부 연동 키 「${l.integ} · ${l.name}」 기한 ${due}(${left}일 남음) — 외부 연동 › 연동 키에서 교체를 준비하십시오`,
      detail: { key, code: l.code, name: l.name, due, stage: st, left },
    });
  }
  const resolved = await db.query(
    `UPDATE ops_alerts SET resolved_at = now(), resolve_note = '키 교체 · 기한 바뀜 · 알림 꺼짐'
      WHERE alert_code = 'ITS_KEY_EXPIRY' AND resolved_at IS NULL AND NOT (coalesce(detail->>'key', '') = ANY($1::text[])) RETURNING id`,
    [want.map((w) => w.key)]);
  let made = 0;
  for (const w of want) {
    const r = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'ITS_KEY_EXPIRY', $1, $2, $3::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ITS_KEY_EXPIRY' AND detail->>'key' = $4)
       ON CONFLICT DO NOTHING RETURNING id`, [w.sev, w.title, JSON.stringify(w.detail), w.key]);
    made += r.length;
  }
  return { on, days, checked: life.length, made, resolved: resolved.length };
}
