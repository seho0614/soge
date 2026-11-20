import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { CODE_RE, addMonths, alertDays, clean, dayOrNull, daysBetween, filesOk, idOk, kstToday, reasonOk, stageOf } from './lgl-common';

/* ---------------------------------------------------------------------
 * ㊴ 법무 (D269 · docs/624) — v10.486 회사 인허가 · 신고 갱신 · 대표 11/20
 *   종류(lgl_license_kinds) — 처음 6개(통신판매업 · 건강기능식품 일반판매업 · 부가통신사업 · 위치기반서비스사업 · 사업자등록 · 그 밖)는
 *     일반 원칙 값(기관 · 갱신 주기 · 근거) · SUPER 가 고치고 더함 · 법무 확인 필요.
 *   인허가 하나 = 종류 · 번호 · 기관 · 신고일 · 갱신 주기(달 · 없으면 비움) · 다음 갱신일 · 담당 · 서류(LGL_DOC 5개).
 *   갱신 기록(쌓기만) → 다음 갱신일 = 적은 날 또는 (지난 갱신일 · 처리일) + 주기 · 알림 풀림.
 *   알림 — 정기 작업 lgl_due(lgl-due.ts) · 다음 갱신일 60 · 30 · 7일 전(lgl.license_alert_days) LGL_LICENSE_DUE · 지나면 급함.
 * ------------------------------------------------------------------- */

export interface LicenseKind { code: string; name: string; authority: string | null; cycleMonths: number | null; basis: string | null; active: boolean; sort: number }

export async function licenseKinds(db: DatabaseService): Promise<LicenseKind[]> {
  return db.query<LicenseKind>(
    `SELECT code, name, authority, cycle_months AS "cycleMonths", basis, active, sort FROM lgl_license_kinds ORDER BY sort, code`);
}

/** GET /admin/legal/licenses?state= — 인허가 목록 · 남은 날 · 알림 날수 · 종류 */
export async function licenseBoard(db: DatabaseService, stateIn?: string) {
  const state = ['ACTIVE', 'CLOSED'].includes(stateIn ?? '') ? stateIn! : null;
  const days = await alertDays(db, 'lgl.license_alert_days', [60, 30, 7]);
  const today = kstToday();
  const rows = await db.query<Record<string, unknown> & { nextDueOn: string | null; state: string }>(
    `SELECT l.id::text AS id, l.kind_code AS kind, k.name AS "kindName", l.title, l.license_ref AS "licenseRef", coalesce(l.authority, k.authority) AS authority,
            l.registered_on::text AS "registeredOn", l.cycle_months AS "cycleMonths", l.next_due_on::text AS "nextDueOn",
            l.owner_account::text AS "ownerId", coalesce(o.name, o.email) AS "ownerName", l.file_ids::text[] AS "fileIds", l.memo, l.state,
            l.closed_at AS "closedAt", l.close_reason AS "closeReason", l.created_at AS "createdAt",
            (SELECT max(r.done_on)::text FROM lgl_license_renewals r WHERE r.license_id = l.id) AS "lastDoneOn"
       FROM lgl_licenses l JOIN lgl_license_kinds k ON k.code = l.kind_code LEFT JOIN accounts o ON o.id = l.owner_account
      WHERE ($1::text IS NULL OR l.state = $1::text)
      ORDER BY (l.state = 'CLOSED'), l.next_due_on NULLS LAST, l.id DESC LIMIT 500`, [state]);
  const items = rows.map((r) => {
    const left = r.nextDueOn ? daysBetween(today, r.nextDueOn) : null;
    return { ...r, daysLeft: left, overdue: r.state === 'ACTIVE' && left != null && left < 0, stage: r.state === 'ACTIVE' && left != null ? stageOf(left, days) : null };
  });
  return { items, kinds: await licenseKinds(db), alertDays: days,
           count: { active: items.filter((x) => x.state === 'ACTIVE').length, due: items.filter((x) => x.stage != null).length, overdue: items.filter((x) => x.overdue).length },
           note: `다음 갱신일 ${days.join(' · ')}일 전에 운영 알림(LGL_LICENSE_DUE)이 뜹니다. 종류 · 갱신 주기 · 근거는 일반 원칙 값이며 SUPER 가 고칩니다(법무 확인).` };
}

export async function licenseOne(db: DatabaseService, id: string) {
  const [l] = await db.query(
    `SELECT l.id::text AS id, l.kind_code AS kind, k.name AS "kindName", k.basis, l.title, l.license_ref AS "licenseRef", coalesce(l.authority, k.authority) AS authority,
            l.registered_on::text AS "registeredOn", l.cycle_months AS "cycleMonths", l.next_due_on::text AS "nextDueOn", l.owner_account::text AS "ownerId",
            l.file_ids::text[] AS "fileIds", l.memo, l.state, l.closed_at AS "closedAt", l.close_reason AS "closeReason", l.created_at AS "createdAt"
       FROM lgl_licenses l JOIN lgl_license_kinds k ON k.code = l.kind_code WHERE l.id = $1::bigint`, [idOk(id, '인허가')]);
  if (!l) throw new NotFound('없는 인허가입니다.');
  const renewals = await db.query(
    `SELECT r.id::text AS id, r.done_on::text AS "doneOn", r.prev_due_on::text AS "prevDueOn", r.next_due_on::text AS "nextDueOn", r.file_ids::text[] AS "fileIds", r.note,
            coalesce(a.name, a.email) AS "createdBy", r.created_at AS "createdAt"
       FROM lgl_license_renewals r LEFT JOIN accounts a ON a.id = r.created_by WHERE r.license_id = $1::bigint ORDER BY r.id DESC LIMIT 100`, [id]);
  return { license: l, renewals };
}

export interface LicenseInput { kind?: string; title?: string; licenseRef?: string; authority?: string; registeredOn?: string; cycleMonths?: number | null; nextDueOn?: string; ownerId?: string; fileIds?: string[]; memo?: string }

async function ownerOk(db: DatabaseService, id: string | undefined) {
  if (!id) return null;
  const [o] = await db.query(`SELECT 1 FROM account_roles WHERE account_id = $1::uuid AND role <> 'MEMBER' LIMIT 1`, [id]);
  if (!o) throw new PolicyViolation('LGL_OWNER', '담당은 운영 역할이 있는 계정만 고릅니다.');
  return id;
}
function cycleOk(v: number | null | undefined) {
  if (v === undefined || v === null) return v ?? null;
  if (!Number.isInteger(v) || v < 1 || v > 120) throw new PolicyViolation('LGL_CYCLE', '갱신 주기는 1 ~ 120달(없으면 비움)입니다.');
  return v;
}

/** POST /admin/legal/licenses — 새 인허가(주기 · 다음 갱신일을 비우면 종류 주기 · 신고일 + 주기) */
export async function addLicense(db: DatabaseService, b: LicenseInput, actor: string | null) {
  if (!CODE_RE.test(b.kind ?? '')) throw new PolicyViolation('LGL_LICENSE_KIND', '인허가 종류를 고르십시오.');
  const [k] = await db.query<{ cycle: number | null; active: boolean; name: string }>(`SELECT cycle_months AS cycle, active, name FROM lgl_license_kinds WHERE code = $1`, [b.kind]);
  if (!k) throw new PolicyViolation('LGL_LICENSE_KIND', '없는 인허가 종류입니다.');
  if (!k.active) throw new PolicyViolation('LGL_LICENSE_KIND', '쓰지 않는 인허가 종류입니다.');
  const title = clean(b.title, 100) ?? k.name;
  if (title.length < 2) throw new PolicyViolation('LGL_TITLE', '이름은 2 ~ 100자입니다.');
  const reg = dayOrNull(b.registeredOn, '신고일');
  const cycle = b.cycleMonths === undefined ? k.cycle : cycleOk(b.cycleMonths);
  let due = dayOrNull(b.nextDueOn, '다음 갱신일');
  if (!due && cycle && reg) { due = addMonths(reg, cycle); while (due < kstToday()) due = addMonths(due, cycle); }
  if (due && reg && due < reg) throw new PolicyViolation('LGL_DATE', '다음 갱신일이 신고일보다 앞입니다.');
  const files = await filesOk(db, b.fileIds, 5);
  const owner = await ownerOk(db, b.ownerId);
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO lgl_licenses (kind_code, title, license_ref, authority, registered_on, cycle_months, next_due_on, owner_account, file_ids, memo, created_by)
     VALUES ($1, $2, $3, $4, $5::date, $6::int, $7::date, $8::uuid, $9::uuid[], $10, $11::uuid) RETURNING id::text AS id`,
    [b.kind, title, clean(b.licenseRef, 60), clean(b.authority, 100), reg, cycle, due, owner, files, clean(b.memo, 400), actor]);
  return { ok: true, id: r!.id, nextDueOn: due, note: `「${title}」을(를) 인허가 대장에 넣었습니다${due ? ` — 다음 갱신일 ${due}` : ''}.` };
}

/** PUT /admin/legal/licenses/{id} — 번호 · 기관 · 신고일 · 주기 · 다음 갱신일 · 담당 · 서류 · 메모(종류는 못 바꿈 · 끝낸 것 못 고침) */
export async function updateLicense(db: DatabaseService, id: string, b: LicenseInput) {
  idOk(id, '인허가');
  return db.transaction(async () => {
    const [o] = await db.query<{ state: string; reg: string | null; due: string | null }>(
      `SELECT state, registered_on::text AS reg, next_due_on::text AS due FROM lgl_licenses WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!o) throw new NotFound('없는 인허가입니다.');
    if (o.state !== 'ACTIVE') throw new StateConflict('LGL_LICENSE_STATE', '끝낸 인허가는 고치지 않습니다.');
    const title = b.title === undefined ? undefined : clean(b.title, 100);
    if (title !== undefined && (!title || title.length < 2)) throw new PolicyViolation('LGL_TITLE', '이름은 2 ~ 100자입니다.');
    const reg = b.registeredOn === undefined ? o.reg : dayOrNull(b.registeredOn, '신고일');
    const due = b.nextDueOn === undefined ? o.due : dayOrNull(b.nextDueOn, '다음 갱신일');
    if (due && reg && due < reg) throw new PolicyViolation('LGL_DATE', '다음 갱신일이 신고일보다 앞입니다.');
    const files = b.fileIds === undefined ? null : await filesOk(db, b.fileIds, 5);
    const owner = b.ownerId === undefined ? undefined : await ownerOk(db, b.ownerId || undefined);
    await db.query(
      `UPDATE lgl_licenses SET title = coalesce($2, title), license_ref = CASE WHEN $3::boolean THEN $4 ELSE license_ref END,
              authority = CASE WHEN $5::boolean THEN $6 ELSE authority END, registered_on = $7::date,
              cycle_months = CASE WHEN $8::boolean THEN $9::int ELSE cycle_months END, next_due_on = $10::date,
              owner_account = CASE WHEN $11::boolean THEN $12::uuid ELSE owner_account END, file_ids = coalesce($13::uuid[], file_ids),
              memo = CASE WHEN $14::boolean THEN $15 ELSE memo END
        WHERE id = $1::bigint`,
      [id, title ?? null, b.licenseRef !== undefined, clean(b.licenseRef, 60), b.authority !== undefined, clean(b.authority, 100), reg,
       b.cycleMonths !== undefined, cycleOk(b.cycleMonths), due, owner !== undefined, owner ?? null, files, b.memo !== undefined, clean(b.memo, 400)]);
    return { ok: true, id, nextDueOn: due, note: '인허가를 고쳤습니다 — 다음 갱신일이 바뀌었으면 알림은 다음 정기 작업에서 맞춰집니다.' };
  });
}

/** POST /admin/legal/licenses/{id}/renew — 갱신 · 재신고 · 납부 기록(쌓기만) · 다음 갱신일 바꿈 */
export async function renewLicense(db: DatabaseService, id: string, b: { doneOn?: string; nextDueOn?: string; fileIds?: string[]; note?: string }, actor: string | null) {
  idOk(id, '인허가');
  const done = dayOrNull(b.doneOn, '처리일');
  if (!done || done > kstToday()) throw new PolicyViolation('LGL_DATE', '처리일이 바르지 않습니다(오늘까지).');
  const files = await filesOk(db, b.fileIds, 5);
  return db.transaction(async () => {
    const [o] = await db.query<{ state: string; cycle: number | null; due: string | null; title: string }>(
      `SELECT state, cycle_months AS cycle, next_due_on::text AS due, title FROM lgl_licenses WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!o) throw new NotFound('없는 인허가입니다.');
    if (o.state !== 'ACTIVE') throw new StateConflict('LGL_LICENSE_STATE', '끝낸 인허가에는 갱신을 기록하지 않습니다.');
    let next = dayOrNull(b.nextDueOn, '다음 갱신일');
    if (!next && o.cycle) {
      next = addMonths(o.due && o.due > done ? o.due : done, o.cycle);
      while (next <= done) next = addMonths(next, o.cycle);
    }
    if (next && next <= done) throw new PolicyViolation('LGL_DATE', '다음 갱신일은 처리일 뒤입니다.');
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO lgl_license_renewals (license_id, done_on, prev_due_on, next_due_on, file_ids, note, created_by)
       VALUES ($1::bigint, $2::date, $3::date, $4::date, $5::uuid[], $6, $7::uuid) RETURNING id::text AS id`,
      [id, done, o.due, next, files, clean(b.note, 200), actor]);
    await db.query(`UPDATE lgl_licenses SET next_due_on = $2::date WHERE id = $1::bigint`, [id, next]);
    await db.query(
      `UPDATE ops_alerts SET resolved_at = now(), resolve_note = '갱신 기록'
        WHERE alert_code = 'LGL_LICENSE_DUE' AND resolved_at IS NULL AND left(detail->>'key', char_length($1::text)) = $1::text`, [`LIC:${id}:`]);
    return { ok: true, id: r!.id, nextDueOn: next, note: `「${o.title}」 갱신을 기록했습니다${next ? ` — 다음 갱신일 ${next}` : ' — 다음 갱신일 없음'}.` };
  });
}

/** POST /admin/legal/licenses/{id}/close — 끝냄(폐업 · 반납 · 사유 · 되돌리지 않음) */
export async function closeLicense(db: DatabaseService, id: string, reasonIn: string) {
  idOk(id, '인허가');
  const reason = reasonOk(reasonIn);
  const r = await db.query(`UPDATE lgl_licenses SET state = 'CLOSED', closed_at = now(), close_reason = $2 WHERE id = $1::bigint AND state = 'ACTIVE' RETURNING id`, [id, reason]);
  if (!r.length) {
    const [x] = await db.query(`SELECT 1 FROM lgl_licenses WHERE id = $1::bigint`, [id]);
    if (!x) throw new NotFound('없는 인허가입니다.');
    throw new StateConflict('LGL_LICENSE_STATE', '이미 끝낸 인허가입니다.');
  }
  await db.query(
    `UPDATE ops_alerts SET resolved_at = now(), resolve_note = '인허가 끝냄'
      WHERE alert_code = 'LGL_LICENSE_DUE' AND resolved_at IS NULL AND left(detail->>'key', char_length($1::text)) = $1::text`, [`LIC:${id}:`]);
  return { ok: true, id, note: '인허가를 끝냄으로 표시했습니다(기록 · 서류는 그대로 남음).' };
}

/** PUT /admin/legal/license-kinds/{code} — 종류 고치기 · 더하기(SUPER) */
export async function setLicenseKind(db: DatabaseService, code: string, b: { name?: string; authority?: string; cycleMonths?: number | null; basis?: string; active?: boolean; sort?: number }, actor: string | null) {
  if (!CODE_RE.test(code ?? '')) throw new PolicyViolation('LGL_LICENSE_KIND', '종류 코드는 영문 대문자 · 숫자 · _ 2 ~ 31자입니다.');
  const name = b.name === undefined ? undefined : clean(b.name, 60);
  if (name !== undefined && (!name || name.length < 2)) throw new PolicyViolation('LGL_LICENSE_KIND', '이름은 2 ~ 60자입니다.');
  const cycle = b.cycleMonths === undefined ? undefined : cycleOk(b.cycleMonths);
  if (b.sort !== undefined && (!Number.isInteger(b.sort) || b.sort < 0 || b.sort > 9999)) throw new PolicyViolation('LGL_LICENSE_KIND', '순서는 0 ~ 9999 입니다.');
  const [old] = await db.query(`SELECT 1 FROM lgl_license_kinds WHERE code = $1`, [code]);
  if (!old) {
    if (!name) throw new PolicyViolation('LGL_LICENSE_KIND', '새 종류는 이름을 적습니다.');
    await db.query(
      `INSERT INTO lgl_license_kinds (code, name, authority, cycle_months, basis, active, sort, updated_by)
       VALUES ($1, $2, $3, $4::int, $5, $6::boolean, $7::int, $8::uuid)`,
      [code, name, clean(b.authority, 100), cycle ?? null, clean(b.basis, 300), b.active ?? true, b.sort ?? 100, actor]);
    return { ok: true, code, created: true, note: `인허가 종류 「${name}」을(를) 더했습니다.` };
  }
  await db.query(
    `UPDATE lgl_license_kinds SET name = coalesce($2, name), authority = CASE WHEN $3::boolean THEN $4 ELSE authority END,
            cycle_months = CASE WHEN $5::boolean THEN $6::int ELSE cycle_months END, basis = CASE WHEN $7::boolean THEN $8 ELSE basis END,
            active = coalesce($9::boolean, active), sort = coalesce($10::int, sort), updated_by = $11::uuid
      WHERE code = $1`,
    [code, name ?? null, b.authority !== undefined, clean(b.authority, 100), cycle !== undefined, cycle ?? null, b.basis !== undefined, clean(b.basis, 300),
     b.active ?? null, b.sort ?? null, actor]);
  return { ok: true, code, created: false, note: '인허가 종류를 고쳤습니다 — 이미 넣은 인허가의 주기 · 다음 갱신일은 그대로입니다.' };
}
