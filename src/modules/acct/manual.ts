import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { assertStepsDone, recordFinal } from './approval';   // v10.424 (D253) 결재선

/* ---------------------------------------------------------------------
 * v10.405 (D248 · docs/542) 수동 전표 쓰기 · 결재
 *   자동으로 안 잡히는 거래(임대료 · 대출 · 이자 · 보증금 · 잡이익 등)를 운영 화면에서 전표로 씁니다.
 *   흐름: SUPER · PAYOUT 이 요청(REQUESTED) → 쓴 사람이 아닌 SUPER 가 승인(APPROVED — 그때 acct_entries source MANUAL 로 들어감) · 반려(사유).
 *   검사: 줄 2 ~ 30 · 줄마다 차변 · 대변 중 하나만 양수 · 아는 계정 · 차변 합 = 대변 합(DB 미룬 검사 D242 가 다시 확인) ·
 *         마감한 달(acct_closings) · 마감한 해(⑭ acct_year_closings)에는 넣지 못함(요청 때 · 승인 때 둘 다).
 *   내용은 고치지 않습니다 — 취소하고 다시 씁니다(쓴 사람 · SUPER).
 * ------------------------------------------------------------------- */

export const MANUAL_EVIDENCES = ['TAX_INVOICE', 'CARD_PG', 'CASH', 'NONE', 'CARD', 'SIMPLE'] as const;
export interface ManualLine { role: string; debit?: number; credit?: number; memo?: string }

const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** 그 날짜가 마감한 달 · 마감한 해면 422(ACCT_MANUAL_CLOSED) */
async function assertOpen(db: DatabaseService, day: string) {
  const [c] = await db.query(`SELECT 1 FROM acct_closings WHERE ym = $1`, [day.slice(0, 7)]);
  if (c) throw new PolicyViolation('ACCT_MANUAL_CLOSED', `${day.slice(0, 7)} 은 마감한 달이라 수동 전표를 넣지 못합니다.`);
  /* ⑭ D247 fn_acct_year_closed — 그 해 마지막 기록이 CLOSE 면 마감(풀면 REOPEN) · 함수가 없으면(⑭ 전) 건너뜀 */
  const [has] = await db.query<{ ok: boolean }>(`SELECT to_regprocedure('public.fn_acct_year_closed(integer)') IS NOT NULL AS ok`);
  if (has?.ok) {
    const [y] = await db.query<{ c: boolean }>(`SELECT public.fn_acct_year_closed($1::int) AS c`, [Number(day.slice(0, 4))]);
    if (y?.c) throw new PolicyViolation('ACCT_MANUAL_CLOSED', `${day.slice(0, 4)} 년은 마감한 해라 수동 전표를 넣지 못합니다.`);
  }
}

/** 입력 검사 → 고른 줄 · 합계 */
export async function checkManual(db: DatabaseService, b: { entryDate?: string; memo?: string; party?: string; evidence?: string; lines?: ManualLine[] }) {
  const day = (b.entryDate ?? '').trim();
  if (!YMD.test(day) || Number.isNaN(Date.parse(day))) throw new PolicyViolation('ACCT_MANUAL', '전표 날짜가 바르지 않습니다.');
  const memo = (b.memo ?? '').replace(/\s+/g, ' ').trim();
  if (memo.length < 2 || memo.length > 200) throw new PolicyViolation('ACCT_MANUAL', '적요는 2 ~ 200자입니다.');
  const evidence = (MANUAL_EVIDENCES as readonly string[]).includes(b.evidence ?? '') ? b.evidence! : 'NONE';
  const raw = Array.isArray(b.lines) ? b.lines : [];
  if (raw.length < 2 || raw.length > 30) throw new PolicyViolation('ACCT_MANUAL', '전표 줄은 2 ~ 30개입니다.');
  const roles = new Set((await db.query<{ role: string }>(`SELECT role FROM acct_accounts`)).map((r) => r.role));
  const lines = raw.map((l, i) => {
    const d = Number(l?.debit ?? 0), c = Number(l?.credit ?? 0);
    if (!l || typeof l.role !== 'string' || !roles.has(l.role)) throw new PolicyViolation('ACCT_MANUAL', `${i + 1}번째 줄 — 모르는 계정입니다.`);
    if (!Number.isInteger(d) || !Number.isInteger(c) || d < 0 || c < 0 || (d > 0) === (c > 0) || d > 1e13 || c > 1e13)
      throw new PolicyViolation('ACCT_MANUAL', `${i + 1}번째 줄 — 차변 · 대변 중 하나만 1원 이상 정수로 적어 주십시오.`);
    return { role: l.role, debit: d, credit: c, memo: (l.memo ?? '').toString().trim().slice(0, 100) || null };
  });
  const dSum = lines.reduce((a, l) => a + l.debit, 0), cSum = lines.reduce((a, l) => a + l.credit, 0);
  if (dSum !== cSum) throw new PolicyViolation('ACCT_MANUAL_BALANCE', `차변 합(${dSum.toLocaleString('ko-KR')})과 대변 합(${cSum.toLocaleString('ko-KR')})이 다릅니다.`);
  await assertOpen(db, day);
  return { day, memo, party: (b.party ?? '').trim().slice(0, 120) || null, evidence, lines, total: dSum };
}

/** POST /admin/acct/manual — 요청 */
export async function addManual(db: DatabaseService, b: Parameters<typeof checkManual>[1], actor: string) {
  const c = await checkManual(db, b);
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO acct_manual_entries (entry_date, memo, party, evidence, lines, total, created_by) VALUES ($1::date, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id::text AS id`,
    [c.day, c.memo, c.party, c.evidence, JSON.stringify(c.lines), c.total, actor]);
  return { ok: true, id: r.id, note: `수동 전표 요청 ${r.id} 을 올렸습니다 — 쓴 사람이 아닌 SUPER 가 승인하면 장부에 들어갑니다.` };
}

/** GET /admin/acct/manual?state= */
export async function listManual(db: DatabaseService, state?: string) {
  const st = ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELED'].includes(state ?? '') ? state : null;
  const items = await db.query(
    `SELECT m.id::text AS id, m.entry_date::text AS "entryDate", m.memo, m.party, m.evidence, m.lines, m.total::bigint AS total, m.state,
            m.created_by AS "createdBy", ca.email AS "createdByEmail", m.created_at AS "createdAt",
            da.email AS "decidedByEmail", m.decided_at AS "decidedAt", m.decide_note AS "decideNote", m.entry_id::text AS "entryId"
       FROM acct_manual_entries m LEFT JOIN accounts ca ON ca.id = m.created_by LEFT JOIN accounts da ON da.id = m.decided_by
      WHERE ($1::text IS NULL OR m.state = $1) ORDER BY (m.state = 'REQUESTED') DESC, m.id DESC LIMIT 200`, [st]);
  const [n] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM acct_manual_entries WHERE state = 'REQUESTED'`);
  return { items: items.map((x: Record<string, unknown>) => ({ ...x, total: Number(x.total) })), waiting: Number(n?.n ?? 0),
           note: '승인은 쓴 사람이 아닌 SUPER 만 합니다. 내용은 고치지 않습니다(취소하고 다시). 마감한 달 · 해에는 넣지 못합니다.' };
}

/** POST /admin/acct/manual/{id}/decide — 승인(전표 넣기) · 반려(사유) */
export async function decideManual(db: DatabaseService, id: string, b: { approve?: boolean; note?: string }, actor: string, actorIsSuper: boolean) {
  if (!/^\d{1,18}$/.test(id ?? '')) throw new NotFound('수동 전표 요청이 없습니다.');
  const note = (b.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!actorIsSuper) throw new PolicyViolation('ACCT_MANUAL_ROLE', '수동 전표 승인 · 반려는 SUPER 만 합니다.');
  return db.transaction(async () => {
    const [m] = await db.query<{ state: string; created_by: string; entry_date: string; memo: string; party: string | null; evidence: string; lines: Array<{ role: string; debit: number; credit: number }> }>(
      `SELECT state, created_by, entry_date::text AS entry_date, memo, party, evidence, lines FROM acct_manual_entries WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!m) throw new NotFound('수동 전표 요청이 없습니다.');
    if (m.state !== 'REQUESTED') throw new StateConflict('ACCT_MANUAL_STATE', '이미 처리한 수동 전표입니다.');
    if (m.created_by === actor) throw new PolicyViolation('ACCT_MANUAL_SELF', '자기가 쓴 수동 전표는 승인 · 반려하지 못합니다.');
    if (!b.approve) {
      if (note.length < 2) throw new PolicyViolation('ACCT_MANUAL', '반려는 사유를 2자 이상 적어 주십시오.');
      await db.query(`UPDATE acct_manual_entries SET state = 'REJECTED', decided_by = $2, decided_at = now(), decide_note = $3 WHERE id = $1::bigint`, [id, actor, note]);
      await recordFinal(db, 'MANUAL', id, actor, false, note);   // v10.424 (D253)
      return { ok: true, id, state: 'REJECTED', note: '반려했습니다.' };
    }
    await assertStepsDone(db, 'MANUAL', id);   // v10.424 (D253) — 결재선이 있으면 앞 단계가 끝나야 승인
    await assertOpen(db, m.entry_date);
    const [e] = await db.query<{ id: string }>(
      `INSERT INTO acct_entries (entry_date, source, source_key, memo, party, evidence, late) VALUES ($1::date, 'MANUAL', $2, $3, $4, $5, false) RETURNING id::text AS id`,
      [m.entry_date, id, `수동 · ${m.memo}`.slice(0, 200), m.party, m.evidence]);
    await db.query(
      `INSERT INTO acct_lines (entry_id, role, debit, credit) SELECT $1::bigint, x.role, x.debit, x.credit FROM jsonb_to_recordset($2::jsonb) AS x(role text, debit bigint, credit bigint)`,
      [e.id, JSON.stringify(m.lines.map((l) => ({ role: l.role, debit: l.debit, credit: l.credit })))]);
    await db.query(`UPDATE acct_manual_entries SET state = 'APPROVED', decided_by = $2, decided_at = now(), decide_note = nullif($3, ''), entry_id = $4::bigint WHERE id = $1::bigint`,
      [id, actor, note, e.id]);
    await recordFinal(db, 'MANUAL', id, actor, true, note);   // v10.424 (D253)
    return { ok: true, id, state: 'APPROVED', entryId: e.id, note: `승인했습니다 — 전표 ${e.id} 로 장부에 들어갔습니다.` };
  });
}

/** POST /admin/acct/manual/{id}/cancel — 쓴 사람 · SUPER · 요청 상태일 때만 */
export async function cancelManual(db: DatabaseService, id: string, actor: string, actorIsSuper: boolean) {
  if (!/^\d{1,18}$/.test(id ?? '')) throw new NotFound('수동 전표 요청이 없습니다.');
  const [m] = await db.query<{ state: string; created_by: string }>(`SELECT state, created_by FROM acct_manual_entries WHERE id = $1::bigint`, [id]);
  if (!m) throw new NotFound('수동 전표 요청이 없습니다.');
  if (m.state !== 'REQUESTED') throw new StateConflict('ACCT_MANUAL_STATE', '이미 처리한 수동 전표입니다.');
  if (m.created_by !== actor && !actorIsSuper) throw new PolicyViolation('ACCT_MANUAL_ROLE', '쓴 사람이나 SUPER 만 취소합니다.');
  await db.query(`UPDATE acct_manual_entries SET state = 'CANCELED' WHERE id = $1::bigint`, [id]);
  return { ok: true, id, state: 'CANCELED', note: '취소했습니다.' };
}
