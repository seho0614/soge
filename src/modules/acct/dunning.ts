import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { aging } from './aging';

/* ---------------------------------------------------------------------
 * v10.436 (D256 · docs/573) 미수금 독촉 · 입금 예정
 *   받을 돈 = ⑭ 기간 분석(외상매출금 AR · 먼저 생긴 몫부터 갚음) · 거래처 이름으로 거래처 대장(acct_parties) 메일을 찾음.
 *   단계 = 가장 오래된 남은 몫의 날수가 단계 days(처음 30 · 60 · 90) 넘으면 1 안내 · 2 독촉 · 3 최종.
 *   보내기: 기존 메일 길(MailService.ready · send) · 자동은 acct.dunning on 일 때만(처음 off) · 같은 거래처 · 같은 오래된 날 · 같은 단계는 한 번.
 *   보낸 기록 acct_dunning_sends(쌓기만 · 주소는 가림) · 입금 예정 → 자금 흐름 예정(acct_cash_plans IN). 연체 이자는 셈하지 않음.
 * ------------------------------------------------------------------- */

export interface Mailer { ready(): Promise<boolean>; send(m: { to: string; subject: string; text: string }): Promise<{ ok: boolean; error?: string; errorKind?: string }> }

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const mask = (e: string) => { const [u, d] = e.split('@'); return `${(u ?? '').slice(0, 2)}***@${d ?? ''}`; };
const won = (x: number) => Math.round(x).toLocaleString('ko-KR');

async function templates(db: DatabaseService) {
  return db.query<{ stage: number; days: number; subject: string; body: string }>(`SELECT stage, days, subject, body FROM acct_dunning_templates ORDER BY stage`);
}
async function companyInfo(db: DatabaseService) {
  const s = await db.query<{ key: string; value: string | null }>(`SELECT key, nullif(btrim(value), '') AS value FROM site_settings WHERE key IN ('footer.company_name', 'footer.phone', 'acct.dunning')`);
  const v = (k: string) => s.find((x) => x.key === k)?.value ?? null;
  return { company: v('footer.company_name') ?? '소개뱅크', phone: v('footer.phone') ?? '', on: v('acct.dunning') === 'on' };
}
const fill = (t: string, m: Record<string, string>) => t.replace(/\{(party|amount|oldest|days|company|phone)\}/g, (_, k: string) => m[k] ?? '');

/** GET /admin/acct/dunning — 거래처별 받을 돈 · 단계 · 메일 · 마지막 보냄 · 입금 예정 */
export async function dunningView(db: DatabaseService) {
  const today = kstToday();
  const a = await aging(db, today, 90);
  const tpl = await templates(db);
  const info = await companyInfo(db);
  const parties = await db.query<{ id: string; name: string; email: string | null }>(`SELECT id::text AS id, name, contact_email AS email FROM acct_parties WHERE state = 'ACTIVE'`);
  const byName = new Map(parties.map((p) => [p.name.trim().toLowerCase(), p]));
  const sends = await db.query<{ party_name: string; stage: number; oldest: string | null; created_at: string; result: string }>(
    `SELECT DISTINCT ON (party_name) party_name, stage, oldest::text AS oldest, created_at, result FROM acct_dunning_sends WHERE result IN ('SENT', 'PREVIEW') ORDER BY party_name, created_at DESC`);
  const last = new Map(sends.map((s) => [s.party_name, s]));
  const promises = await db.query(
    `SELECT id::text AS id, party_name AS "partyName", amount::bigint AS amount, due_on::text AS "dueOn", note, state, cash_plan_id::text AS "cashPlanId" FROM acct_receipt_promises
      WHERE state = 'OPEN' OR closed_at > now() - interval '30 days' ORDER BY state, due_on`);
  const rows = a.rows.filter((r) => r.role === 'AR' && r.open > 0).map((r) => {
    const p = byName.get(r.party.trim().toLowerCase());
    const stage = [...tpl].reverse().find((t) => r.oldestDays >= t.days)?.stage ?? 0;
    const l = last.get(r.party);
    const sentStage = l && l.oldest === r.oldest ? l.stage : 0;
    return { party: r.party, partyId: p?.id ?? null, email: p?.email ? mask(p.email) : null, open: r.open, oldest: r.oldest, oldestDays: r.oldestDays,
             b30: r.b30, b60: r.b60, b90: r.b90, over: r.over, stage, sentStage, due: stage > sentStage, lastSentAt: l?.created_at ?? null };
  }).sort((x, y) => y.oldestDays - x.oldestDays);
  return { today, on: info.on, templates: tpl, rows, promises, total: rows.reduce((s, r) => s + r.open, 0),
           note: '받을 돈은 기간 분석과 같습니다(먼저 생긴 몫부터 갚음). 거래처 대장 이름이 전표 거래처와 같아야 메일을 찾습니다. 연체 이자는 셈하지 않습니다.' };
}

/** PUT /admin/acct/dunning/templates/{stage} — 단계 문안(SUPER) */
export async function setTemplate(db: DatabaseService, stage: number, b: { days: number; subject: string; body: string }, actor: string | null) {
  if (![1, 2, 3].includes(Number(stage))) throw new NotFound('없는 단계입니다.');
  const days = Math.round(Number(b.days)), subject = (b.subject ?? '').trim(), body = (b.body ?? '').trim();
  if (!(days >= 1 && days <= 365)) throw new PolicyViolation('ACCT_DUNNING', '단계 날수는 1 ~ 365입니다.');
  if (subject.length < 2 || subject.length > 120 || body.length < 10 || body.length > 3000) throw new PolicyViolation('ACCT_DUNNING', '제목 2 ~ 120자 · 본문 10 ~ 3,000자입니다.');
  const all = await templates(db);
  const others = all.filter((t) => t.stage !== Number(stage));
  if (others.some((t) => (t.stage < Number(stage) && t.days >= days) || (t.stage > Number(stage) && t.days <= days))) throw new PolicyViolation('ACCT_DUNNING', '단계 날수는 1 < 2 < 3 차례로 커야 합니다.');
  await db.query(`UPDATE acct_dunning_templates SET days = $2, subject = $3, body = $4, updated_by = $5, updated_at = now() WHERE stage = $1`, [Number(stage), days, subject, body, actor]);
  return { ok: true, stage: Number(stage), note: '독촉 문안을 고쳤습니다.' };
}

async function compose(db: DatabaseService, party: string) {
  const v = await dunningView(db);
  const r = v.rows.find((x) => x.party === party);
  if (!r) throw new NotFound('받을 돈이 남은 거래처가 아닙니다.');
  if (!r.stage) throw new StateConflict('ACCT_DUNNING_EARLY', '아직 1단계 날수가 지나지 않았습니다.');
  const t = v.templates.find((x) => x.stage === r.stage)!;
  const info = await companyInfo(db);
  const m = { party, amount: won(r.open), oldest: r.oldest ?? '', days: String(r.oldestDays), company: info.company, phone: info.phone };
  const [p] = r.partyId ? await db.query<{ email: string | null }>(`SELECT contact_email AS email FROM acct_parties WHERE id::text = $1`, [r.partyId]) : [];
  return { r, subject: fill(t.subject, m), text: fill(t.body, m), email: p?.email ?? null };
}

/** POST /admin/acct/dunning/preview — 보낼 메일 미리 보기(기록 안 함) */
export async function previewDunning(db: DatabaseService, party: string) {
  const c = await compose(db, party);
  return { party, stage: c.r.stage, subject: c.subject, text: c.text, to: c.email ? mask(c.email) : null, open: c.r.open, oldest: c.r.oldest };
}

/** POST /admin/acct/dunning/send — 지금 보내기(SUPER) · 자동 작업도 같은 길 */
export async function sendDunning(db: DatabaseService, mail: Mailer, party: string, actor: string | null, byJob = false) {
  const c = await compose(db, party);
  const log = (result: string, error: string | null) => db.query(
    `INSERT INTO acct_dunning_sends (party_id, party_name, stage, oldest, amount, to_masked, result, error, by_job, sent_by) VALUES ($1::bigint, $2, $3, $4::date, $5, $6, $7, $8, $9, $10)`,
    [c.r.partyId, party, c.r.stage, c.r.oldest, c.r.open, c.email ? mask(c.email) : null, result, error, byJob, actor]);
  if (!c.email) { await log('NO_EMAIL', null); return { ok: false, result: 'NO_EMAIL', note: '거래처 대장에 메일 주소가 없습니다.' }; }
  if (!(await mail.ready())) { await log('NOT_READY', null); return { ok: false, result: 'NOT_READY', note: '메일 준비가 되지 않았습니다(보내는 주소 · 설정).' }; }
  const res = await mail.send({ to: c.email, subject: c.subject, text: c.text });
  await log(res.ok ? 'SENT' : 'FAILED', res.ok ? null : String(res.errorKind ?? res.error ?? 'FAILED').slice(0, 120));
  return { ok: res.ok, result: res.ok ? 'SENT' : 'FAILED', stage: c.r.stage, note: res.ok ? `${party} 에 ${c.r.stage}단계 메일을 보냈습니다.` : '메일을 보내지 못했습니다.' };
}

/** 정기 작업 acct_dunning — 지난 입금 예정 BROKEN 표시 · on 이면 단계가 올라간 거래처에 한 번 */
export async function dunningJob(db: DatabaseService, mail: Mailer) {
  const broken = await db.query(
    `UPDATE acct_receipt_promises SET state = 'BROKEN', closed_at = now(), closed_note = '예정일 지남(자동)' WHERE state = 'OPEN' AND due_on < $1::date - 3 RETURNING id`, [kstToday()]);
  const v = await dunningView(db);
  if (!v.on) return { on: false, sent: 0, broken: broken.length, due: v.rows.filter((r) => r.due).length };
  let sent = 0, failed = 0;
  for (const r of v.rows.filter((x) => x.due && x.email)) {
    const res = await sendDunning(db, mail, r.party, null, true).catch(() => ({ ok: false }));
    if (res.ok) sent++; else failed++;
  }
  return { on: true, sent, failed, broken: broken.length };
}

/** POST /admin/acct/receipt-promises — 입금 예정(거래처 약속) → 자금 흐름 예정(IN) */
export async function addPromise(db: DatabaseService, b: { party: string; amount: number; dueOn: string; note?: string }, actor: string | null) {
  const party = (b.party ?? '').trim(), amount = Math.round(Number(b.amount));
  if (party.length < 1 || party.length > 120) throw new PolicyViolation('ACCT_PROMISE', '거래처를 고르십시오.');
  if (!(amount > 0 && amount <= 1e12)) throw new PolicyViolation('ACCT_PROMISE', '금액은 1원 이상입니다.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.dueOn ?? '')) throw new PolicyViolation('ACCT_PROMISE', '날짜가 바르지 않습니다.');
  const [p] = await db.query<{ id: string }>(`SELECT id::text AS id FROM acct_parties WHERE lower(btrim(name)) = lower($1) LIMIT 1`, [party]);
  return db.transaction(async () => {
    const [plan] = await db.query<{ id: string }>(
      `INSERT INTO acct_cash_plans (due_on, direction, amount, memo, created_by) VALUES ($1::date, 'IN', $2, $3, $4) RETURNING id::text AS id`,
      [b.dueOn, amount, `입금 예정 · ${party}`.slice(0, 100), actor]);
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO acct_receipt_promises (party_id, party_name, amount, due_on, note, cash_plan_id, created_by) VALUES ($1::bigint, $2, $3, $4::date, nullif($5, ''), $6::bigint, $7) RETURNING id::text AS id`,
      [p?.id ?? null, party, amount, b.dueOn, (b.note ?? '').trim().slice(0, 200), plan!.id, actor]);
    return { ok: true, id: r!.id, cashPlanId: plan!.id, note: '입금 예정을 넣었습니다 — 자금 흐름 예정에도 들어갑니다.' };
  });
}

/** POST /admin/acct/receipt-promises/{id}/close — 지킴 · 어김 · 취소(자금 흐름 예정은 취소) */
export async function closePromise(db: DatabaseService, id: string, b: { state: string; note?: string }, actor: string | null) {
  if (!['KEPT', 'BROKEN', 'CANCELED'].includes(b.state)) throw new PolicyViolation('ACCT_PROMISE', '지킴 · 어김 · 취소 중 고르십시오.');
  const note = (b.note ?? '').replace(/\s+/g, ' ').trim();
  if (note.length < 2 || note.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  return db.transaction(async () => {
    const [p] = await db.query<{ state: string; plan: string | null }>(`SELECT state, cash_plan_id::text AS plan FROM acct_receipt_promises WHERE id::text = $1 FOR UPDATE`, [id]);
    if (!p) throw new NotFound('없는 입금 예정입니다.');
    if (p.state !== 'OPEN') throw new StateConflict('ACCT_PROMISE_STATE', '이미 닫은 입금 예정입니다.');
    await db.query(`UPDATE acct_receipt_promises SET state = $2, closed_note = $3, closed_at = now() WHERE id::text = $1`, [id, b.state, note]);
    if (p.plan) await db.query(
      `UPDATE acct_cash_plans SET state = 'CANCELED', canceled_at = now(), canceled_by = $2, cancel_note = $3 WHERE id::text = $1 AND state = 'ACTIVE'`,
      [p.plan, actor, `입금 예정 닫음 · ${note}`.slice(0, 200)]);
    return { ok: true, id, state: b.state, note: '입금 예정을 닫았습니다(자금 흐름 예정은 취소 — 실제 입금은 은행 맞추기로).' };
  });
}
