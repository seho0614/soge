import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.409 (D249 · docs/546) 계약 대장 · 만기 알림
 *   임대 · 용역 · 서버 · 구독 · 기타 계약 — 거래처(v10.408) · 기간 · 자동 갱신 · 알림 일수 · 달 금액 · 낼 날 · 계약서 파일(ACCT_EVIDENCE · 5개).
 *   만기 알림 — 정기 작업 acct_contracts(매일 09:25): 만기 notice_days 일 전부터 만기 날까지 운영 알림 ACCT_CONTRACT_DUE
 *              (같은 계약 · 같은 만기일 한 번 · 만기가 지나거나 연장 · 끝내면 풀림).
 *   달 금액 > 0 이면 ⑫ 자금 흐름 예정(acct_cash_plans · OUT · MONTHLY · 다음 낼 날부터 만기까지)을 함께 넣음 → 끝내면 그 예정 취소 · 연장하면 예정을 새 만기까지로 다시 넣음.
 *   시작일 · 달 금액 · 종류는 고치지 않음(끝내고 새로) · 지우지 않음.
 * ------------------------------------------------------------------- */

export const CONTRACT_KINDS = ['RENT', 'SERVICE', 'SERVER', 'SUBSCRIPTION', 'OTHER'] as const;
export const CONTRACT_KIND_KO: Record<string, string> = { RENT: '임대', SERVICE: '용역', SERVER: '서버 · 클라우드', SUBSCRIPTION: '구독 · 소프트웨어', OTHER: '기타' };
export const CONTRACT_MAX_FILES = 5;

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const isDay = (d?: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const reasonOk = (r?: string) => {
  const t = (r ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  return t;
};
/** 오늘(또는 시작일) 뒤 처음 오는 낼 날(1 ~ 28일) */
export function nextPayDay(from: string, day: number) {
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  const same = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (d <= day) return same;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface ContractInput {
  partyId?: string; title: string; kind: string; startOn: string; endOn?: string; autoRenew?: boolean; noticeDays?: number;
  monthlyAmount?: number; payDay?: number; attachments?: string[]; memo?: string;
}

async function check(db: DatabaseService, b: ContractInput) {
  const title = (b.title ?? '').replace(/\s+/g, ' ').trim();
  if (title.length < 2 || title.length > 100) throw new PolicyViolation('CONTRACT_TITLE', '계약 이름은 2 ~ 100자입니다.');
  if (!(CONTRACT_KINDS as readonly string[]).includes(b.kind)) throw new PolicyViolation('CONTRACT_KIND', '계약 종류를 고르십시오.');
  if (!isDay(b.startOn)) throw new PolicyViolation('CONTRACT_DATE', '시작일(YYYY-MM-DD)을 넣으십시오.');
  if (b.endOn && !isDay(b.endOn)) throw new PolicyViolation('CONTRACT_DATE', '만기일(YYYY-MM-DD)이 맞지 않습니다.');
  if (b.endOn && b.endOn < b.startOn) throw new PolicyViolation('CONTRACT_DATE', '만기일이 시작일보다 앞입니다.');
  const notice = Math.round(Number(b.noticeDays ?? 30));
  if (!Number.isFinite(notice) || notice < 1 || notice > 180) throw new PolicyViolation('CONTRACT_NOTICE', '알림 일수는 1 ~ 180일입니다.');
  const amt = Math.round(Number(b.monthlyAmount ?? 0));
  if (!Number.isFinite(amt) || amt < 0 || amt > 10_000_000_000) throw new PolicyViolation('CONTRACT_AMOUNT', '달 금액은 0원 ~ 100억 원입니다.');
  const payDay = b.payDay == null ? null : Math.round(Number(b.payDay));
  if (amt > 0 && (payDay == null || payDay < 1 || payDay > 28)) throw new PolicyViolation('CONTRACT_PAYDAY', '달 금액이 있으면 낼 날(1 ~ 28일)을 고르십시오.');
  let partyId: string | null = null;
  if (b.partyId) {
    if (!/^\d{1,18}$/.test(b.partyId)) throw new PolicyViolation('CONTRACT_PARTY', '없는 거래처입니다.');
    const [p] = await db.query(`SELECT 1 FROM acct_parties WHERE id = $1::bigint`, [b.partyId]);
    if (!p) throw new PolicyViolation('CONTRACT_PARTY', '없는 거래처입니다.');
    partyId = b.partyId;
  }
  const files = [...new Set((b.attachments ?? []).map(String))];
  if (files.length > CONTRACT_MAX_FILES) throw new PolicyViolation('CONTRACT_FILES', `계약서 파일은 ${CONTRACT_MAX_FILES}개까지입니다.`);
  if (files.some((f) => !/^[0-9a-f-]{36}$/i.test(f))) throw new PolicyViolation('CONTRACT_FILES', '계약서 파일 번호가 맞지 않습니다.');
  if (files.length) {
    const ok = await db.query(`SELECT id FROM files WHERE id = ANY($1::uuid[]) AND purpose = 'ACCT_EVIDENCE' AND status = 'READY'`, [files]);
    if (ok.length !== files.length) throw new PolicyViolation('CONTRACT_FILES', '올리기를 마친 증빙 파일(ACCT_EVIDENCE)만 붙일 수 있습니다.');
  }
  return { title, kind: b.kind, startOn: b.startOn, endOn: b.endOn || null, autoRenew: !!b.autoRenew, notice, amt, payDay: amt > 0 ? payDay : null, partyId, files,
           memo: (b.memo ?? '').trim().slice(0, 200) || null };
}

/** 자금 흐름 예정(MONTHLY) 넣기 — 다음 낼 날부터 만기까지 · 메모 2 ~ 100자 */
async function addPlan(db: DatabaseService, title: string, amt: number, payDay: number, startOn: string, endOn: string | null, actor: string | null) {
  const from = nextPayDay(startOn > kstToday() ? startOn : kstToday(), payDay);
  if (endOn && from > endOn) return null;
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO acct_cash_plans (due_on, direction, amount, memo, repeat, until_on, created_by)
     VALUES ($1::date, 'OUT', $2::bigint, $3, 'MONTHLY', $4::date, $5) RETURNING id::text AS id`,
    [from, amt, `계약 ${title}`.slice(0, 100), endOn, actor]);
  return r?.id ?? null;
}
async function cancelPlan(db: DatabaseService, planId: string | null, note: string) {
  if (!planId) return;
  await db.query(`UPDATE acct_cash_plans SET state = 'CANCELED', canceled_at = now(), cancel_note = $2 WHERE id = $1::bigint AND state = 'ACTIVE'`, [planId, note.slice(0, 200)]);
}

/** POST /admin/acct/contracts */
export async function addContract(db: DatabaseService, b: ContractInput, actor: string | null) {
  const v = await check(db, b);
  const id = await db.transaction(async () => {
    const planId = v.amt > 0 ? await addPlan(db, v.title, v.amt, v.payDay!, v.startOn, v.endOn, actor) : null;
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO acct_contracts (party_id, title, kind, start_on, end_on, auto_renew, notice_days, monthly_amount, pay_day, cash_plan_id, attachments, memo, created_by)
       VALUES ($1::bigint, $2, $3, $4::date, $5::date, $6, $7, $8::bigint, $9, $10::bigint, $11::uuid[], $12, $13) RETURNING id::text AS id`,
      [v.partyId, v.title, v.kind, v.startOn, v.endOn, v.autoRenew, v.notice, v.amt, v.payDay, planId, v.files, v.memo, actor]);
    await db.query(`INSERT INTO acct_contract_changes (contract_id, action, after_end, actor_id) VALUES ($1::bigint, 'CREATE', $2::date, $3)`, [r!.id, v.endOn, actor]);
    return r!.id;
  });
  return { ok: true, id, note: v.amt > 0 ? '계약을 넣었습니다 — 달 금액은 자금 흐름 예정(매달)에도 넣었습니다.' : '계약을 넣었습니다.' };
}

async function load(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 계약입니다.');
  const [c] = await db.query<{ id: string; title: string; state: string; start_on: string; end_on: string | null; monthly_amount: string; pay_day: number | null; cash_plan_id: string | null }>(
    `SELECT id::text AS id, title, state, start_on::text AS start_on, end_on::text AS end_on, monthly_amount::text AS monthly_amount, pay_day, cash_plan_id::text AS cash_plan_id
       FROM acct_contracts WHERE id = $1::bigint`, [id]);
  if (!c) throw new NotFound('없는 계약입니다.');
  if (c.state !== 'ACTIVE') throw new StateConflict('CONTRACT_STATE', '이미 끝낸 계약입니다.');
  return c;
}

/** POST /admin/acct/contracts/{id}/renew — 새 만기일(지금 만기 뒤) · 사유 · 예정 다시 */
export async function renewContract(db: DatabaseService, id: string, endOn: string, reason: string, actor: string | null) {
  const t = reasonOk(reason);
  const c = await load(db, id);
  if (!isDay(endOn)) throw new PolicyViolation('CONTRACT_DATE', '새 만기일(YYYY-MM-DD)을 넣으십시오.');
  if (endOn < c.start_on || (c.end_on && endOn <= c.end_on)) throw new PolicyViolation('CONTRACT_DATE', '새 만기일은 지금 만기일보다 뒤여야 합니다.');
  await db.transaction(async () => {
    let planId = c.cash_plan_id;
    if (Number(c.monthly_amount) > 0 && c.pay_day) {
      await cancelPlan(db, planId, `계약 연장 ${endOn}`);
      planId = await addPlan(db, c.title, Number(c.monthly_amount), c.pay_day, c.start_on, endOn, actor);
    }
    await db.query(`UPDATE acct_contracts SET end_on = $2::date, cash_plan_id = $3::bigint WHERE id = $1::bigint`, [id, endOn, planId]);
    await db.query(`INSERT INTO acct_contract_changes (contract_id, action, before_end, after_end, reason, actor_id) VALUES ($1::bigint, 'RENEW', $2::date, $3::date, $4, $5)`, [id, c.end_on, endOn, t, actor]);
    await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = '연장함' WHERE alert_code = 'ACCT_CONTRACT_DUE' AND resolved_at IS NULL AND detail->>'contractId' = $1`, [id]);
  });
  return { ok: true, id, endOn, note: '만기일을 늘렸습니다 — 만기 알림은 풀고 새 만기에 맞춰 다시 알립니다.' };
}

/** POST /admin/acct/contracts/{id}/end — 끝내기(사유) · 예정 취소 · 알림 풀림 */
export async function endContract(db: DatabaseService, id: string, reason: string, actor: string | null) {
  const t = reasonOk(reason);
  const c = await load(db, id);
  await db.transaction(async () => {
    await cancelPlan(db, c.cash_plan_id, `계약 끝냄 — ${t}`);
    await db.query(`UPDATE acct_contracts SET state = 'ENDED', ended_at = now(), end_note = $2 WHERE id = $1::bigint`, [id, t]);
    await db.query(`INSERT INTO acct_contract_changes (contract_id, action, before_end, reason, actor_id) VALUES ($1::bigint, 'END', $2::date, $3, $4)`, [id, c.end_on, t, actor]);
    await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = '계약 끝냄' WHERE alert_code = 'ACCT_CONTRACT_DUE' AND resolved_at IS NULL AND detail->>'contractId' = $1`, [id]);
  });
  return { ok: true, id, note: '계약을 끝냈습니다 — 자금 흐름 예정도 취소했습니다.' };
}

/** GET /admin/acct/contracts?state= */
export async function listContracts(db: DatabaseService, state?: string) {
  const today = kstToday();
  const items = await db.query<any>(
    `SELECT c.id::text AS id, c.party_id::text AS "partyId", p.name AS "partyName", c.title, c.kind, c.start_on::text AS "startOn", c.end_on::text AS "endOn",
            c.auto_renew AS "autoRenew", c.notice_days AS "noticeDays", c.monthly_amount::bigint AS "monthlyAmount", c.pay_day AS "payDay",
            c.cash_plan_id::text AS "cashPlanId", c.memo, c.state, c.end_note AS "endNote", c.ended_at AS "endedAt",
            (SELECT coalesce(json_agg(json_build_object('id', f.id, 'name', f.original_name, 'size', f.size_bytes) ORDER BY x.i), '[]'::json)
               FROM unnest(c.attachments) WITH ORDINALITY x(fid, i) JOIN files f ON f.id = x.fid) AS files
       FROM acct_contracts c LEFT JOIN acct_parties p ON p.id = c.party_id
      WHERE ($1::text = '' OR c.state = $1) ORDER BY c.state, c.end_on NULLS LAST, c.id DESC LIMIT 500`,
    [state === 'ACTIVE' || state === 'ENDED' ? state : '']);
  for (const c of items) {
    c.daysLeft = c.endOn ? Math.round((Date.parse(c.endOn) - Date.parse(today)) / 86400e3) : null;
    c.due = c.state === 'ACTIVE' && c.daysLeft != null && c.daysLeft >= 0 && c.daysLeft <= c.noticeDays;
  }
  const act = items.filter((c) => c.state === 'ACTIVE');
  return { items, kinds: CONTRACT_KIND_KO, maxFiles: CONTRACT_MAX_FILES,
           count: { active: act.length, due: act.filter((c) => c.due).length, overdue: act.filter((c) => c.daysLeft != null && c.daysLeft < 0).length },
           monthlyTotal: act.reduce((a, c) => a + Number(c.monthlyAmount ?? 0), 0),
           note: '만기 알림 일수 전부터 운영 알림(ACCT_CONTRACT_DUE)이 뜹니다. 자동 갱신 계약도 알림은 뜹니다(해지 통보 기한을 놓치지 않게). 달 금액은 자금 흐름 예정에 들어갑니다.' };
}

/** 정기 작업 acct_contracts — 알림 넣기 · 풀기 */
export async function acctContractsJob(db: DatabaseService, today = kstToday()) {
  const r1 = await db.query(
    `UPDATE ops_alerts a SET resolved_at = now(), resolve_note = '만기 지남 · 끝냄 · 연장'
      WHERE a.alert_code = 'ACCT_CONTRACT_DUE' AND a.resolved_at IS NULL
        AND (coalesce(a.detail->>'endOn', '0000') < $1
             OR NOT EXISTS (SELECT 1 FROM acct_contracts c WHERE c.id::text = a.detail->>'contractId' AND c.state = 'ACTIVE' AND c.end_on::text = a.detail->>'endOn'))
     RETURNING a.id`, [today]);
  const due = await db.query<{ id: string; title: string; end_on: string; days: number; auto_renew: boolean; party: string | null }>(
    `SELECT c.id::text AS id, c.title, c.end_on::text AS end_on, (c.end_on - $1::date)::int AS days, c.auto_renew, p.name AS party
       FROM acct_contracts c LEFT JOIN acct_parties p ON p.id = c.party_id
      WHERE c.state = 'ACTIVE' AND c.end_on IS NOT NULL AND c.end_on >= $1::date AND c.end_on - $1::date <= c.notice_days ORDER BY c.end_on`, [today]);
  const made: string[] = [];
  for (const c of due) {
    const r = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'ACCT_CONTRACT_DUE', $1, $2, $3::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ACCT_CONTRACT_DUE' AND detail->>'contractId' = $4 AND detail->>'endOn' = $5)
       ON CONFLICT DO NOTHING RETURNING id`,
      [c.days <= 7 ? 'CRITICAL' : 'WARN',
       `계약 「${c.title}」${c.party ? `(${c.party})` : ''} 만기 ${c.end_on}${c.days === 0 ? '(오늘)' : ` · ${c.days}일 남음`}${c.auto_renew ? ' · 자동 갱신' : ''} — 회계 › 계약`,
       JSON.stringify({ contractId: c.id, endOn: c.end_on, autoRenew: c.auto_renew }), c.id, c.end_on]);
    if (r.length) made.push(c.id);
  }
  return { made, resolved: r1.length, due: due.length };
}
