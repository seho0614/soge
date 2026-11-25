/* e3 (docs/010) 소개뱅크 src/modules/acct/approval.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.424 (D253 · docs/561) 결재선 여러 단계 — 품의(REQ) · 경비 청구(EXPENSE) · 수동 전표(MANUAL)
 *   결재선(acct_approval_lines · SUPER) — 종류 · 금액 상한마다 단계 [{role} | {account}] · 마지막은 늘 SUPER.
 *   단계 결재(acct_approval_steps · 쌓기만 · DB 가 본인 · 두 단계 · 순서 · 결재자를 막음).
 *   마지막 단계 = 기존 승인(decideRequisition · decideExpense · decideManual · 기존 DB 가드 그대로) — 그 함수들이 assertStepsDone 으로
 *   앞 단계가 끝났는지 보고, 끝나면 recordFinal 로 마지막 줄을 남김. 결재선이 없거나 한 단계(SUPER)면 지금과 같음.
 *   중간 단계 반려 = 그 차례(round) 끝 · 문서는 그대로 청구 상태(올린 사람이 고쳐 다시 올리거나 SUPER 가 반려).
 * ------------------------------------------------------------------- */

export const DOC_KINDS = ['REQ', 'EXPENSE', 'MANUAL'] as const;
export type DocKind = typeof DOC_KINDS[number];
export const DOC_KO: Record<DocKind, string> = { REQ: '품의', EXPENSE: '경비 청구', MANUAL: '수동 전표' };
export const STEP_ROLES = ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'] as const;
export interface Step { role?: string; account?: string }

const kindOk = (k: string): DocKind => {
  if (!(DOC_KINDS as readonly string[]).includes(k)) throw new PolicyViolation('APV_KIND', '모르는 결재 문서 종류입니다.');
  return k as DocKind;
};
const idOk = (id: string) => { if (!/^\d{1,18}$/.test(id ?? '')) throw new NotFound('문서가 없습니다.'); return id; };

export async function docInfo(db: DatabaseService, kind: DocKind, id: string) {
  const [d] = await db.query<{ owner: string | null; amount: string | null; state: string | null }>(
    `SELECT owner::text AS owner, amount::text AS amount, state FROM fn_acct_doc_info($1, $2::bigint)`, [kind, idOk(id)]);
  if (!d?.owner) throw new NotFound('문서가 없습니다.');
  return { owner: d.owner, amount: Number(d.amount ?? 0), state: String(d.state) };
}

export async function needOf(db: DatabaseService, kind: DocKind, amount: number): Promise<Step[]> {
  const [r] = await db.query<{ steps: Step[] | null }>(`SELECT fn_acct_approval_need($1, $2::bigint) AS steps`, [kind, amount]);
  return Array.isArray(r?.steps) ? r!.steps : [];
}

async function progress(db: DatabaseService, kind: DocKind, id: string) {
  const rows = await db.query<{ round: number; step_no: number; approver: string; decision: string; note: string | null; created_at: string; who: string | null }>(
    `SELECT s.round, s.step_no, s.approver::text AS approver, s.decision, s.note, s.created_at, coalesce(a.name, a.email) AS who
       FROM acct_approval_steps s LEFT JOIN svc.accounts a ON a.id = s.approver WHERE s.doc_kind = $1 AND s.doc_id = $2::bigint ORDER BY s.id`, [kind, id]);
  const round = 1 + rows.filter((r) => r.decision === 'REJECT').length;
  const approved = rows.filter((r) => r.round === round && r.decision === 'APPROVE');
  return { rows, round, done: approved.length, approvers: approved.map((r) => r.approver) };
}

/** 기존 승인 함수가 부름 — 결재선이 2단계 이상이면 마지막(SUPER) 전 단계가 모두 끝났는지 */
export async function assertStepsDone(db: DatabaseService, kind: DocKind, id: string) {
  const d = await docInfo(db, kind, id);
  const need = await needOf(db, kind, d.amount);
  if (need.length <= 1) return { need: need.length, done: 0 };
  const p = await progress(db, kind, id);
  if (p.done < need.length - 1) throw new StateConflict('APV_PENDING', `앞 결재 단계가 남았습니다(${p.done}/${need.length - 1}).`);
  return { need: need.length, done: p.done };
}

/** 기존 승인 · 반려 함수가 성공한 뒤 — 결재선이 있으면 마지막 줄(또는 SUPER 반려 줄)을 남김(결재선 없으면 아무것도 안 함) */
export async function recordFinal(db: DatabaseService, kind: DocKind, id: string, actor: string | null, approve: boolean, note?: string | null) {
  if (!actor) return;
  const d = await docInfo(db, kind, id);
  const need = await needOf(db, kind, d.amount);
  if (need.length <= 1) return;
  const p = await progress(db, kind, id);
  if (p.approvers.includes(actor)) return;   // 같은 차례에 이미 결재한 사람(SUPER 가 중간 단계도 했으면) — 줄은 남기지 않음
  await db.query(
    `INSERT INTO acct_approval_steps (doc_kind, doc_id, round, step_no, approver, decision, note) VALUES ($1, $2::bigint, $3, $4, $5, $6, $7)`,
    [kind, id, p.round, p.done + 1, actor, approve ? 'APPROVE' : 'REJECT', (note ?? '').toString().slice(0, 200) || null]);
}

/** POST /admin/acct/approvals/{kind}/{id}/step — 중간 단계 결재(마지막 단계는 기존 결재 화면 · API) */
export async function stepDecide(db: DatabaseService, kindQ: string, id: string, b: { approve?: boolean; note?: string }, actor: string, roles: string[]) {
  const kind = kindOk(kindQ);
  const d = await docInfo(db, kind, id);
  if (d.state !== 'REQUESTED') throw new StateConflict('APV_STATE', '결재를 기다리는 문서가 아닙니다.');
  if (d.owner === actor) throw new PolicyViolation('APV_SELF', '본인 문서는 결재할 수 없습니다.');
  const need = await needOf(db, kind, d.amount);
  if (need.length <= 1) throw new PolicyViolation('APV_NO_LINE', '이 문서는 여러 단계 결재선이 없습니다 — 기존 결재(SUPER)로 처리합니다.');
  const p = await progress(db, kind, id);
  const stepNo = p.done + 1;
  if (stepNo >= need.length) throw new PolicyViolation('APV_LAST', '마지막 단계는 기존 결재(SUPER 승인 · 반려)로 처리합니다.');
  const s = need[stepNo - 1]!;
  const isSuper = roles.includes('SUPER');
  if (!isSuper && ((s.account && s.account !== actor) || (s.role && !roles.includes(s.role)))) throw new PolicyViolation('APV_WHO', '이 단계 결재자가 아닙니다.');
  const note = (b.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!b.approve && note.length < 2) throw new PolicyViolation('APV_REASON', '반려는 사유를 2자 이상 적어 주십시오.');
  await db.query(
    `INSERT INTO acct_approval_steps (doc_kind, doc_id, round, step_no, approver, decision, note) VALUES ($1, $2::bigint, $3, $4, $5, $6, $7)`,
    [kind, id, p.round, stepNo, actor, b.approve ? 'APPROVE' : 'REJECT', note || null]);
  return { ok: true, kind, id, step: stepNo, of: need.length,
           note: b.approve ? `${stepNo}단계를 결재했습니다(${stepNo}/${need.length}) — 다음 단계로 넘어갑니다.` : '반려했습니다 — 이번 결재 차례를 끝냈습니다(올린 사람에게 돌아감).' };
}

/** 문서 하나의 결재선 · 진행(문서 화면에서 보임) */
export async function approvalStatus(db: DatabaseService, kindQ: string, id: string) {
  const kind = kindOk(kindQ);
  const d = await docInfo(db, kind, id);
  const need = await needOf(db, kind, d.amount);
  const p = await progress(db, kind, id);
  return { kind, id, amount: d.amount, state: d.state, need, round: p.round, done: p.done, history: p.rows,
           next: d.state === 'REQUESTED' && need.length > 1 ? Math.min(p.done + 1, need.length) : null };
}

/** GET /admin/acct/approvals/inbox — 내가 결재할 차례인 문서(중간 단계 · 마지막 SUPER 단계 모두) */
export async function inbox(db: DatabaseService, actor: string, roles: string[]) {
  const docs = await db.query<{ kind: DocKind; id: string; owner: string; amount: string; title: string; created_at: string; who: string | null }>(
    `SELECT 'REQ' AS kind, r.id::text AS id, r.requester::text AS owner, r.amount::text AS amount, r.title, r.created_at, coalesce(a.name, a.email) AS who
       FROM acct_requisitions r LEFT JOIN svc.accounts a ON a.id = r.requester WHERE r.state = 'REQUESTED'
     UNION ALL
     SELECT 'EXPENSE', c.id::text, c.claimant::text, c.amount::text, c.item, c.created_at, coalesce(a.name, a.email)
       FROM acct_expense_claims c LEFT JOIN svc.accounts a ON a.id = c.claimant WHERE c.state = 'REQUESTED'
     UNION ALL
     SELECT 'MANUAL', m.id::text, m.created_by::text, (SELECT coalesce(sum((x ->> 'debit')::bigint), 0) FROM jsonb_array_elements(m.lines) x)::text, m.memo, m.created_at, coalesce(a.name, a.email)
       FROM acct_manual_entries m LEFT JOIN svc.accounts a ON a.id = m.created_by WHERE m.state = 'REQUESTED'
     ORDER BY created_at DESC LIMIT 300`);   // 최근 것부터(오래 쌓인 청구가 300건을 넘어도 새 문서가 보이게)
  const isSuper = roles.includes('SUPER');
  const out: Array<Record<string, unknown>> = [];
  for (const d of docs) {
    if (d.owner === actor) continue;
    const need = await needOf(db, d.kind, Number(d.amount));
    if (need.length <= 1) { if (isSuper) out.push({ ...d, amount: Number(d.amount), step: 1, of: 1, kindKo: DOC_KO[d.kind], final: true }); continue; }
    const p = await progress(db, d.kind, d.id);
    if (p.approvers.includes(actor)) continue;
    const stepNo = p.done + 1; const s = need[stepNo - 1]!;
    const mine = isSuper || (s.account ? s.account === actor : !!s.role && roles.includes(s.role));
    if (mine) out.push({ ...d, amount: Number(d.amount), step: stepNo, of: need.length, kindKo: DOC_KO[d.kind], final: stepNo === need.length });
  }
  return { items: out, count: out.length, note: '내 결재 차례인 문서입니다. 마지막 단계(SUPER)는 각 화면(품의 · 경비 청구 · 수동 전표)의 승인 · 반려 단추로 처리합니다.' };
}

/** GET /admin/acct/approval-lines · PUT(SUPER) — 종류마다 구간 전체를 한 번에 바꿈(빈 목록이면 지움 = SUPER 한 번) */
export async function listLines(db: DatabaseService) {
  const lines = await db.query(`SELECT id::text AS id, doc_kind AS "docKind", upto::text AS upto, steps, updated_at AS "updatedAt" FROM acct_approval_lines ORDER BY doc_kind, coalesce(upto, 9223372036854775807)`);
  const changes = await db.query(
    `SELECT c.id::text AS id, c.doc_kind AS "docKind", c.before, c.after, c.reason, c.created_at AS "createdAt", coalesce(a.name, a.email) AS actor
       FROM acct_approval_line_changes c LEFT JOIN svc.accounts a ON a.id = c.actor_id ORDER BY c.id DESC LIMIT 20`);
  const staff = await db.query(
    `SELECT DISTINCT a.id::text AS id, coalesce(a.name, a.email) AS name FROM svc.accounts a JOIN svc.account_roles r ON r.account_id = a.id
      WHERE r.role IN ('SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF') ORDER BY 2 LIMIT 200`);
  return { lines, changes, staff, roles: STEP_ROLES, kinds: DOC_KINDS.map((k) => ({ code: k, label: DOC_KO[k] })),
           note: '금액 상한이 작은 구간부터 맞는 것 하나를 씁니다(상한이 비면 그 위 전부). 마지막 단계는 SUPER. 결재선이 없으면 지금처럼 SUPER 한 번입니다.' };
}

export async function setLines(db: DatabaseService, b: { docKind: string; lines: Array<{ upto?: number | null; steps: Step[] }>; reason: string }, actor: string | null) {
  const kind = kindOk(b.docKind);
  const reason = (b.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (lines.length > 6) throw new PolicyViolation('APV_LINE', '구간은 6개까지입니다.');
  const uptos = lines.map((l) => (l.upto == null ? null : Math.round(Number(l.upto))));
  if (uptos.filter((u) => u == null).length > 1) throw new PolicyViolation('APV_LINE', '상한이 빈 구간(그 위 전부)은 하나만 둡니다.');
  if (new Set(uptos.map(String)).size !== uptos.length) throw new PolicyViolation('APV_LINE', '같은 금액 상한이 두 번 있습니다.');
  for (const l of lines) {
    if (!Array.isArray(l.steps) || l.steps.length < 1 || l.steps.length > 5) throw new PolicyViolation('APV_LINE', '단계는 1 ~ 5개입니다.');
    if ((l.steps[l.steps.length - 1]?.role ?? '') !== 'SUPER') throw new PolicyViolation('APV_LINE_LAST', '마지막 단계는 SUPER 입니다(승인 효과는 SUPER 결재).');
  }
  const before = await db.query(`SELECT upto, steps FROM acct_approval_lines WHERE doc_kind = $1 ORDER BY coalesce(upto, 9223372036854775807)`, [kind]);
  await db.transaction(async () => {
    await db.query(`DELETE FROM acct_approval_lines WHERE doc_kind = $1`, [kind]);
    for (let i = 0; i < lines.length; i++) {
      const steps = lines[i]!.steps.map((s) => (s.account ? { account: String(s.account) } : { role: String(s.role) }));
      await db.query(`INSERT INTO acct_approval_lines (doc_kind, upto, steps, updated_by) VALUES ($1, $2, $3::jsonb, $4)`, [kind, uptos[i], JSON.stringify(steps), actor]);
    }
    await db.query(`INSERT INTO acct_approval_line_changes (doc_kind, before, after, reason, actor_id) VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)`,
      [kind, JSON.stringify(before), JSON.stringify(lines), reason, actor]);
  });
  return { ok: true, docKind: kind, lines: lines.length, note: lines.length ? `${DOC_KO[kind]} 결재선 ${lines.length}구간을 정했습니다 — 지금 결재 중인 문서에도 바로 씁니다.` : `${DOC_KO[kind]} 결재선을 지웠습니다 — SUPER 한 번으로 돌아갑니다.` };
}
