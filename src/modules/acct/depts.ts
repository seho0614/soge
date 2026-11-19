import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.434 (D256 · docs/571) 부서 · 프로젝트별 손익
 *   전표 줄(acct_lines)은 쌓기만이라 칸을 바꿀 수 없음 → 꼬리표를 전표 단위로:
 *     ① 전표 꼬리표(acct_entry_tags · 사람이 정함) ② 근거 꼬리표(acct_source_tags · 전표 만들기 전 매입 · 경비 · 수동 전표에 미리)
 *     ③ 돈 흐름 기본 부서(acct_rule_dept) — 셀 때 ① > ② > ③(v_acct_line_tags) · 바꾼 기록 acct_tag_changes(쌓기만 · 사유)
 *   손익은 계정 종류(REVENUE · EXPENSE)로 · 해 마감 전표(YEAR_CLOSE · YEAR_REOPEN)는 뺌 · 꼬리표 없는 것은 「정하지 않음」.
 * ------------------------------------------------------------------- */

const reasonOk = (r?: string) => {
  const t = (r ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  return t;
};
const idOrNull = (v: unknown) => (v == null || v === '' ? null : /^\d{1,18}$/.test(String(v)) ? String(v) : (() => { throw new PolicyViolation('ACCT_TAG', '부서 · 프로젝트 번호가 바르지 않습니다.'); })());
const ymOk = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** GET /admin/acct/depts — 부서 · 프로젝트 · 돈 흐름 기본 부서 */
export async function deptsView(db: DatabaseService, sources: Array<{ name: string; label: string }>) {
  const depts = await db.query(`SELECT id::text AS id, code, name, active, sort FROM acct_depts ORDER BY sort, code`);
  const projects = await db.query(
    `SELECT p.id::text AS id, p.code, p.name, p.dept_id::text AS "deptId", d.name AS "deptName", p.starts_on::text AS "startsOn", p.ends_on::text AS "endsOn", p.closed
       FROM acct_projects p LEFT JOIN acct_depts d ON d.id = p.dept_id ORDER BY p.closed, p.code`);
  const rules = await db.query<{ source: string; deptId: string }>(`SELECT source, dept_id::text AS "deptId" FROM acct_rule_dept`);
  const map = new Map(rules.map((r) => [r.source, r.deptId]));
  return { depts, projects, rules: sources.map((s) => ({ source: s.name, label: s.label, deptId: map.get(s.name) ?? null })) };
}

export async function addDept(db: DatabaseService, b: { code: string; name: string; sort?: number }) {
  const code = (b.code ?? '').trim().toUpperCase(), name = (b.name ?? '').trim();
  if (!/^[A-Z0-9_]{2,20}$/.test(code)) throw new PolicyViolation('ACCT_DEPT', '부서 코드는 대문자 · 숫자 · 밑줄 2 ~ 20자입니다.');
  if (name.length < 1 || name.length > 60) throw new PolicyViolation('ACCT_DEPT', '부서 이름은 1 ~ 60자입니다.');
  const [dup] = await db.query(`SELECT 1 FROM acct_depts WHERE code = $1`, [code]);
  if (dup) throw new PolicyViolation('ACCT_DEPT_DUP', '이미 있는 부서 코드입니다.');
  const [r] = await db.query<{ id: string }>(`INSERT INTO acct_depts (code, name, sort) VALUES ($1, $2, $3) RETURNING id::text AS id`, [code, name, Math.round(Number(b.sort ?? 0)) || 0]);
  return { ok: true, id: r!.id, note: '부서를 더했습니다.' };
}
export async function updateDept(db: DatabaseService, id: string, b: { name?: string; active?: boolean; sort?: number }) {
  const r = await db.query(
    `UPDATE acct_depts SET name = coalesce(nullif(btrim($2), ''), name), active = coalesce($3, active), sort = coalesce($4, sort) WHERE id::text = $1 RETURNING id`,
    [id, (b.name ?? '').slice(0, 60), typeof b.active === 'boolean' ? b.active : null, b.sort == null ? null : Math.round(Number(b.sort))]);
  if (!r.length) throw new NotFound('없는 부서입니다.');
  return { ok: true, id, note: '부서를 고쳤습니다(지우지 않음 · 쓰지 않음은 끄기).' };
}

export async function addProject(db: DatabaseService, b: { code: string; name: string; deptId?: string; startsOn?: string; endsOn?: string }) {
  const code = (b.code ?? '').trim().toUpperCase(), name = (b.name ?? '').trim();
  if (!/^[A-Z0-9_-]{2,30}$/.test(code)) throw new PolicyViolation('ACCT_PROJECT', '프로젝트 코드는 대문자 · 숫자 · 밑줄 · 붙임표 2 ~ 30자입니다.');
  if (name.length < 1 || name.length > 80) throw new PolicyViolation('ACCT_PROJECT', '프로젝트 이름은 1 ~ 80자입니다.');
  if ((b.startsOn && !ymOk(b.startsOn)) || (b.endsOn && !ymOk(b.endsOn))) throw new PolicyViolation('ACCT_PROJECT', '날짜가 바르지 않습니다.');
  if (b.startsOn && b.endsOn && b.endsOn < b.startsOn) throw new PolicyViolation('ACCT_PROJECT', '끝나는 날이 시작일보다 앞입니다.');
  const [dup] = await db.query(`SELECT 1 FROM acct_projects WHERE code = $1`, [code]);
  if (dup) throw new PolicyViolation('ACCT_PROJECT_DUP', '이미 있는 프로젝트 코드입니다.');
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO acct_projects (code, name, dept_id, starts_on, ends_on) VALUES ($1, $2, $3::bigint, $4::date, $5::date) RETURNING id::text AS id`,
    [code, name, idOrNull(b.deptId), b.startsOn || null, b.endsOn || null]);
  return { ok: true, id: r!.id, note: '프로젝트를 더했습니다.' };
}
export async function updateProject(db: DatabaseService, id: string, b: { name?: string; endsOn?: string; closed?: boolean }) {
  if (b.endsOn && !ymOk(b.endsOn)) throw new PolicyViolation('ACCT_PROJECT', '날짜가 바르지 않습니다.');
  const r = await db.query(
    `UPDATE acct_projects SET name = coalesce(nullif(btrim($2), ''), name), ends_on = coalesce($3::date, ends_on), closed = coalesce($4, closed) WHERE id::text = $1 RETURNING id`,
    [id, (b.name ?? '').slice(0, 80), b.endsOn || null, typeof b.closed === 'boolean' ? b.closed : null]);
  if (!r.length) throw new NotFound('없는 프로젝트입니다.');
  return { ok: true, id, note: '프로젝트를 고쳤습니다.' };
}

/** PUT /admin/acct/depts/rules — 돈 흐름 기본 부서(비우면 지움) */
export async function setRuleDept(db: DatabaseService, items: Array<{ source: string; deptId?: string | null }>, reason: string, actor: string | null) {
  const t = reasonOk(reason);
  let n = 0;
  await db.transaction(async () => {
    for (const it of items ?? []) {
      if (!/^[A-Z][A-Z_]{1,39}$/.test(it.source ?? '')) throw new PolicyViolation('ACCT_TAG', '돈 흐름 이름이 바르지 않습니다.');
      const dept = idOrNull(it.deptId);
      const [cur] = await db.query<{ d: string }>(`SELECT dept_id::text AS d FROM acct_rule_dept WHERE source = $1`, [it.source]);
      if ((cur?.d ?? null) === dept) continue;
      if (dept) await db.query(
        `INSERT INTO acct_rule_dept (source, dept_id, updated_by) VALUES ($1, $2::bigint, $3)
         ON CONFLICT (source) DO UPDATE SET dept_id = EXCLUDED.dept_id, updated_by = EXCLUDED.updated_by, updated_at = now()`, [it.source, dept, actor]);
      else await db.query(`DELETE FROM acct_rule_dept WHERE source = $1`, [it.source]);
      await db.query(`INSERT INTO acct_tag_changes (target, target_key, before, after, reason, actor_id) VALUES ('RULE', $1, $2::jsonb, $3::jsonb, $4, $5)`,
        [it.source, JSON.stringify({ deptId: cur?.d ?? null }), JSON.stringify({ deptId: dept }), t, actor]);
      n++;
    }
  });
  return { ok: true, changed: n, note: n ? '돈 흐름 기본 부서를 바꿨습니다(지난 전표도 꼬리표가 없으면 새 기본으로 셈).' : '바뀐 것이 없습니다.' };
}

async function tagCheck(db: DatabaseService, dept: string | null, project: string | null) {
  if (dept) { const [d] = await db.query(`SELECT 1 FROM acct_depts WHERE id::text = $1`, [dept]); if (!d) throw new NotFound('없는 부서입니다.'); }
  if (project) { const [p] = await db.query(`SELECT 1 FROM acct_projects WHERE id::text = $1`, [project]); if (!p) throw new NotFound('없는 프로젝트입니다.'); }
}

/** POST /admin/acct/tags/entry/{id} — 전표 꼬리표(둘 다 비우면 지움) */
export async function tagEntry(db: DatabaseService, entryId: string, b: { deptId?: string | null; projectId?: string | null; reason: string }, actor: string | null) {
  const t = reasonOk(b.reason);
  const dept = idOrNull(b.deptId), project = idOrNull(b.projectId);
  const [e] = await db.query(`SELECT 1 FROM acct_entries WHERE id::text = $1`, [entryId]);
  if (!e) throw new NotFound('없는 전표입니다.');
  await tagCheck(db, dept, project);
  return db.transaction(async () => {
    const [cur] = await db.query<{ d: string | null; p: string | null }>(`SELECT dept_id::text AS d, project_id::text AS p FROM acct_entry_tags WHERE entry_id::text = $1`, [entryId]);
    if (dept || project) await db.query(
      `INSERT INTO acct_entry_tags (entry_id, dept_id, project_id, updated_by) VALUES ($1::bigint, $2::bigint, $3::bigint, $4)
       ON CONFLICT (entry_id) DO UPDATE SET dept_id = EXCLUDED.dept_id, project_id = EXCLUDED.project_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [entryId, dept, project, actor]);
    else await db.query(`DELETE FROM acct_entry_tags WHERE entry_id::text = $1`, [entryId]);
    await db.query(`INSERT INTO acct_tag_changes (target, target_key, before, after, reason, actor_id) VALUES ('ENTRY', $1, $2::jsonb, $3::jsonb, $4, $5)`,
      [entryId, JSON.stringify(cur ?? null), JSON.stringify({ d: dept, p: project }), t, actor]);
    return { ok: true, entryId, note: '전표 꼬리표를 정했습니다.' };
  });
}

/** POST /admin/acct/tags/source — 근거 꼬리표(매입 PURCHASE · 경비 EXPENSE_APPROVED · 수동 전표 MANUAL 등 · 전표 만들기 전에도) */
export async function tagSource(db: DatabaseService, b: { source: string; sourceKey: string; deptId?: string | null; projectId?: string | null; reason: string }, actor: string | null) {
  const t = reasonOk(b.reason);
  if (!/^[A-Z][A-Z_]{1,39}$/.test(b.source ?? '') || !(b.sourceKey ?? '').trim() || b.sourceKey.length > 120) throw new PolicyViolation('ACCT_TAG', '근거가 바르지 않습니다.');
  const dept = idOrNull(b.deptId), project = idOrNull(b.projectId);
  await tagCheck(db, dept, project);
  return db.transaction(async () => {
    const [cur] = await db.query(`SELECT dept_id::text AS d, project_id::text AS p FROM acct_source_tags WHERE source = $1 AND source_key = $2`, [b.source, b.sourceKey]);
    if (dept || project) await db.query(
      `INSERT INTO acct_source_tags (source, source_key, dept_id, project_id, updated_by) VALUES ($1, $2, $3::bigint, $4::bigint, $5)
       ON CONFLICT (source, source_key) DO UPDATE SET dept_id = EXCLUDED.dept_id, project_id = EXCLUDED.project_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [b.source, b.sourceKey, dept, project, actor]);
    else await db.query(`DELETE FROM acct_source_tags WHERE source = $1 AND source_key = $2`, [b.source, b.sourceKey]);
    await db.query(`INSERT INTO acct_tag_changes (target, target_key, before, after, reason, actor_id) VALUES ('SOURCE', $1, $2::jsonb, $3::jsonb, $4, $5)`,
      [`${b.source}:${b.sourceKey}`, JSON.stringify(cur ?? null), JSON.stringify({ d: dept, p: project }), t, actor]);
    return { ok: true, note: '근거 꼬리표를 정했습니다 — 전표가 생기면 그 부서 · 프로젝트로 셈합니다.' };
  });
}

/** GET /admin/acct/tags/entries?ym= — 그 달 전표와 지금 꼬리표(정하기 화면) */
export async function taggedEntries(db: DatabaseService, ym: string) {
  if (!/^\d{4}-\d{2}$/.test(ym ?? '')) throw new PolicyViolation('ACCT_TAG', '달(YYYY-MM)을 고르십시오.');
  return db.query(
    `SELECT e.id::text AS id, e.entry_date::text AS date, e.source, e.source_key AS "sourceKey", e.memo, e.party,
            (SELECT sum(l.debit)::bigint FROM acct_lines l WHERE l.entry_id = e.id) AS amount,
            t.dept_id::text AS "entryDept", t.project_id::text AS "entryProject",
            s.dept_id::text AS "sourceDept", s.project_id::text AS "sourceProject", r.dept_id::text AS "ruleDept"
       FROM acct_entries e
       LEFT JOIN acct_entry_tags t ON t.entry_id = e.id
       LEFT JOIN acct_source_tags s ON s.source = e.source AND s.source_key = e.source_key
       LEFT JOIN acct_rule_dept r ON r.source = e.source
      WHERE e.ym = $1 ORDER BY e.entry_date, e.id LIMIT 1000`, [ym]);
}

/** GET /admin/acct/dept-pnl?from=&to=&by=dept|project — 부서 · 프로젝트별 매출 · 비용 · 이익 */
export async function deptPnl(db: DatabaseService, from: string, to: string, by: string) {
  if (!ymOk(from) || !ymOk(to) || from > to) throw new PolicyViolation('ACCT_TAG', '기간(YYYY-MM-DD)이 바르지 않습니다.');
  const axis = by === 'project' ? 'project' : 'dept';
  const rows = await db.query<{ k: string | null; kind: string; role: string; name: string; d: string; c: string }>(
    `SELECT (CASE WHEN $3 = 'project' THEN v.project_id ELSE v.dept_id END)::text AS k, a.kind, v.role, a.name, sum(v.debit)::text AS d, sum(v.credit)::text AS c
       FROM v_acct_line_tags v JOIN acct_accounts a ON a.role = v.role
      WHERE v.entry_date BETWEEN $1::date AND $2::date AND a.kind IN ('REVENUE', 'EXPENSE') AND v.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')
      GROUP BY 1, a.kind, v.role, a.name`, [from, to, axis]);
  const names = new Map((await db.query<{ id: string; label: string }>(
    axis === 'project' ? `SELECT id::text AS id, code || ' ' || name AS label FROM acct_projects` : `SELECT id::text AS id, code || ' ' || name AS label FROM acct_depts`)).map((x) => [x.id, x.label]));
  const box = new Map<string, { key: string | null; label: string; revenue: number; expense: number; byRole: Array<{ role: string; name: string; kind: string; amount: number }> }>();
  for (const r of rows) {
    const k = r.k ?? '';
    const b = box.get(k) ?? (box.set(k, { key: r.k, label: r.k ? names.get(r.k) ?? r.k : '정하지 않음', revenue: 0, expense: 0, byRole: [] }), box.get(k)!);
    const amt = r.kind === 'REVENUE' ? Number(r.c) - Number(r.d) : Number(r.d) - Number(r.c);
    if (r.kind === 'REVENUE') b.revenue += amt; else b.expense += amt;
    b.byRole.push({ role: r.role, name: r.name, kind: r.kind, amount: amt });
  }
  const items = [...box.values()].map((b) => ({ ...b, profit: b.revenue - b.expense })).sort((a, b) => (a.key === null ? 1 : b.key === null ? -1 : b.revenue - a.revenue));
  const total = items.reduce((s, x) => ({ revenue: s.revenue + x.revenue, expense: s.expense + x.expense, profit: s.profit + x.profit }), { revenue: 0, expense: 0, profit: 0 });
  return { from, to, by: axis, items, total, note: '전표 꼬리표 > 근거 꼬리표 > 돈 흐름 기본 부서 차례로 셉니다. 해 마감 전표는 뺍니다. 「정하지 않음」은 꼬리표가 없는 몫입니다.' };
}
