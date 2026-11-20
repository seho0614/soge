import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { addManual } from '../acct/manual';
import { alertDays, clean, dayOrNull, daysBetween, filesOk, idOk, kstToday, reasonOk } from './lgl-common';

/* ---------------------------------------------------------------------
 * ㊴ 법무 (D269 · docs/627) — v10.489 회사 보험 증권 · 만기 · 대표 11/20
 *   증권 — 종류(화재 · 배상책임 · 생산물 · 사이버 · 임원 배상 · 자동차 · 보증 · 직원(단체) · 그 밖) · 보험사 · 증권 번호 · 보장 · 보험료 · 기간
 *          · 내는 방법(일시납 · 월납) · 회계 처리(선급비용 · 바로 비용 — 월납은 바로 비용만) · 서류(LGL_DOC 5개) · 갱신은 새 증권(renewed_from).
 *   만기 30일(lgl.insurance_alert_days) 전 갱신 증권이 없으면 LGL_INSURANCE_DUE(경고) · 만기 지나면 급함 · 갱신 · 끝내면 풀림.
 *   전표 초안 = 수동 전표 요청(acct_manual_entries · D248) — 지급 담당 · SUPER 가 만들고, 쓴 사람이 아닌 SUPER 가 승인해야 장부에 들어감:
 *     PAY     일시납 낼 때   차변 선급비용(PREPAID_EXP) 또는 보험료(EXP_INS_POLICY) / 대변 보통예금(CASH)
 *     AMORT   달마다 넘김    차변 보험료(회사 보험) / 대변 선급비용 — 기간 날수로 나눔(누계 반올림 차이 · 합계 = 보험료)
 *     MONTHLY 월납          차변 보험료(회사 보험) / 대변 보통예금 — 보험료 ÷ 달 수(마지막 달 끝수)
 *   같은 (증권 · 종류 · 달) 살아 있는 초안이 있으면 409(DB 도 막음) · 반려 · 취소하면 다시.
 *   계정 · 처리는 일반 원칙(일반기업회계기준 선급비용 · 기간 배분) — 세무사 확인(docs/627).
 * ------------------------------------------------------------------- */

export const INS_KINDS = ['FIRE', 'LIABILITY', 'PRODUCT', 'CYBER', 'DNO', 'CAR', 'GUARANTEE', 'EMPLOYEE', 'ETC'] as const;
export const INS_PAY_MODES = ['LUMP', 'MONTHLY'] as const;
export const INS_BOOK_MODES = ['PREPAID', 'EXPENSE'] as const;
export const INS_POST_KINDS = ['PAY', 'AMORT', 'MONTHLY'] as const;
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const ymOf = (d: string) => d.slice(0, 7);
const lastOfYm = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
const nextYm = (ym: string) => { const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const minusDay = (d: string) => new Date(Date.parse(d) - 86400e3).toISOString().slice(0, 10);

/** 기간(시작 ~ 만기 전날)의 달 목록 */
export function monthsOf(startsOn: string, endsOn: string): string[] {
  const out: string[] = [];
  const lastYm = ymOf(minusDay(endsOn));
  for (let ym = ymOf(startsOn); ym <= lastYm && out.length < 130; ym = nextYm(ym)) out.push(ym);
  return out;
}
/** 달마다 넘길 금액 — 날수 비례 · 누계 반올림 차이(합계 = 보험료) */
export function amortPlan(premium: number, startsOn: string, endsOn: string): Array<{ ym: string; amount: number; on: string }> {
  const total = daysBetween(startsOn, endsOn);
  let prev = 0;
  return monthsOf(startsOn, endsOn).map((ym) => {
    const endOfYm = lastOfYm(ym);
    const upto = endOfYm < endsOn ? daysBetween(startsOn, endOfYm) + 1 : total;
    const cum = Math.round((premium * upto) / total);
    const amount = cum - prev; prev = cum;
    return { ym, amount, on: endOfYm < endsOn ? endOfYm : minusDay(endsOn) };
  });
}
/** 월납 — 보험료 ÷ 달 수 · 마지막 달 끝수 · 낼 날은 시작일과 같은 날(말일 넘치면 말일) */
export function monthlyPlan(premium: number, startsOn: string, endsOn: string): Array<{ ym: string; amount: number; on: string }> {
  const ms = monthsOf(startsOn, endsOn);
  const each = Math.floor(premium / ms.length);
  const day = Number(startsOn.slice(8, 10));
  return ms.map((ym, i) => {
    const last = Number(lastOfYm(ym).slice(8, 10));
    return { ym, amount: i === ms.length - 1 ? premium - each * (ms.length - 1) : each, on: `${ym}-${String(Math.min(day, last)).padStart(2, '0')}` };
  });
}

export interface PolicyRow { id: string; kind: string; title: string; insurer: string; premium: number; startsOn: string; endsOn: string; payMode: string; bookMode: string; state: string }

/** GET /admin/legal/insurance?state= — 증권 목록 · 남은 날 · 갱신 여부 · 보험료 합 */
export async function insuranceBoard(db: DatabaseService, stateIn?: string) {
  const state = ['ACTIVE', 'ENDED'].includes(stateIn ?? '') ? stateIn! : null;
  const [d] = await alertDays(db, 'lgl.insurance_alert_days', [30]);
  const days = d ?? 30;
  const today = kstToday();
  const rows = await db.query<Record<string, unknown> & { endsOn: string; state: string; renewedBy: string | null; premium: unknown }>(
    `SELECT p.id::text AS id, p.kind, p.title, p.insurer, p.policy_ref AS "policyRef", p.coverage::bigint AS coverage, p.premium::bigint AS premium,
            p.starts_on::text AS "startsOn", p.ends_on::text AS "endsOn", p.pay_mode AS "payMode", p.book_mode AS "bookMode", p.renewed_from::text AS "renewedFrom",
            (SELECT n.id::text FROM lgl_insurance_policies n WHERE n.renewed_from = p.id) AS "renewedBy",
            p.file_ids::text[] AS "fileIds", p.memo, p.state, p.end_reason AS "endReason", p.created_at AS "createdAt"
       FROM lgl_insurance_policies p WHERE ($1::text IS NULL OR p.state = $1::text)
      ORDER BY (p.state = 'ENDED'), p.ends_on, p.id DESC LIMIT 300`, [state]);
  const items = rows.map((r) => {
    const left = daysBetween(today, r.endsOn);
    return { ...r, premium: Number(r.premium), coverage: r.coverage == null ? null : Number(r.coverage), daysLeft: left,
             due: r.state === 'ACTIVE' && !r.renewedBy && left <= days, expired: r.state === 'ACTIVE' && !r.renewedBy && left < 0 };
  });
  return { items, alertDays: days, kinds: INS_KINDS, payModes: INS_PAY_MODES, bookModes: INS_BOOK_MODES,
           count: { active: items.filter((x) => x.state === 'ACTIVE').length, due: items.filter((x) => x.due).length, expired: items.filter((x) => x.expired).length,
                    premiumActive: items.filter((x) => x.state === 'ACTIVE').reduce((a, x) => a + x.premium, 0) },
           note: `만기 ${days}일 전부터 갱신 증권이 없으면 운영 알림(LGL_INSURANCE_DUE)이 뜹니다. 보험료 전표는 초안(수동 전표 요청)으로 올라가 SUPER 가 승인합니다(계정 · 처리는 세무사 확인).` };
}

async function policyOf(db: DatabaseService, id: string, lock = false) {
  const [p] = await db.query<PolicyRow>(
    `SELECT id::text AS id, kind, title, insurer, premium::bigint AS premium, starts_on::text AS "startsOn", ends_on::text AS "endsOn", pay_mode AS "payMode", book_mode AS "bookMode", state
       FROM lgl_insurance_policies WHERE id = $1::bigint` + (lock ? ' FOR UPDATE' : ''), [idOk(id, '보험 증권')]);
  if (!p) throw new NotFound('없는 보험 증권입니다.');
  return { ...p, premium: Number(p.premium) };
}

/** 증권 하나 — 서류 · 달마다 전표 계획 · 만든 초안(수동 전표 상태) */
export async function insuranceOne(db: DatabaseService, id: string) {
  const [x] = await db.query<Record<string, unknown>>(
    `SELECT p.id::text AS id, p.kind, p.title, p.insurer, p.policy_ref AS "policyRef", p.coverage::bigint AS coverage, p.premium::bigint AS premium,
            p.starts_on::text AS "startsOn", p.ends_on::text AS "endsOn", p.pay_mode AS "payMode", p.book_mode AS "bookMode", p.renewed_from::text AS "renewedFrom",
            (SELECT n.id::text FROM lgl_insurance_policies n WHERE n.renewed_from = p.id) AS "renewedBy",
            p.file_ids::text[] AS "fileIds", p.memo, p.state, p.end_reason AS "endReason", p.created_at AS "createdAt"
       FROM lgl_insurance_policies p WHERE p.id = $1::bigint`, [idOk(id, '보험 증권')]);
  if (!x) throw new NotFound('없는 보험 증권입니다.');
  const p = await policyOf(db, id);
  const postings = await db.query<{ kind: string; ym: string; amount: string; manualId: string; manualState: string; createdAt: string }>(
    `SELECT s.kind, s.ym, s.amount::bigint AS amount, s.manual_id::text AS "manualId", m.state AS "manualState", s.created_at AS "createdAt"
       FROM lgl_insurance_postings s JOIN acct_manual_entries m ON m.id = s.manual_id WHERE s.policy_id = $1::bigint ORDER BY s.ym, s.id`, [id]);
  const live = (k: string, ym: string) => postings.find((s) => s.kind === k && s.ym === ym && ['REQUESTED', 'APPROVED'].includes(s.manualState)) ?? null;
  const plan: Array<{ kind: string; ym: string; amount: number; on: string; manualId: string | null; manualState: string | null }> = [];
  if (p.payMode === 'LUMP') {
    const s = live('PAY', ymOf(p.startsOn));
    plan.push({ kind: 'PAY', ym: ymOf(p.startsOn), amount: p.premium, on: p.startsOn, manualId: s?.manualId ?? null, manualState: s?.manualState ?? null });
    if (p.bookMode === 'PREPAID') for (const a of amortPlan(p.premium, p.startsOn, p.endsOn)) { const t = live('AMORT', a.ym); plan.push({ kind: 'AMORT', ...a, manualId: t?.manualId ?? null, manualState: t?.manualState ?? null }); }
  } else {
    for (const a of monthlyPlan(p.premium, p.startsOn, p.endsOn)) { const t = live('MONTHLY', a.ym); plan.push({ kind: 'MONTHLY', ...a, manualId: t?.manualId ?? null, manualState: t?.manualState ?? null }); }
  }
  return { policy: { ...x, premium: Number(x.premium), coverage: x.coverage == null ? null : Number(x.coverage) }, plan,
           postings: postings.map((s) => ({ ...s, amount: Number(s.amount) })) };
}

export interface PolicyInput { kind?: string; title?: string; insurer?: string; policyRef?: string; coverage?: number | null; premium?: number; startsOn?: string; endsOn?: string; payMode?: string; bookMode?: string; renewedFrom?: string; fileIds?: string[]; memo?: string }

/** POST /admin/legal/insurance — 새 증권(갱신이면 renewedFrom · 옛 증권 알림 풀림) */
export async function addPolicy(db: DatabaseService, b: PolicyInput, actor: string | null) {
  const kind = (INS_KINDS as readonly string[]).includes(b.kind ?? '') ? b.kind! : 'ETC';
  const title = clean(b.title, 100);
  if (!title || title.length < 2) throw new PolicyViolation('LGL_TITLE', '증권 이름은 2 ~ 100자입니다.');
  const insurer = clean(b.insurer, 100);
  if (!insurer) throw new PolicyViolation('LGL_INSURER', '보험사를 적으십시오.');
  if (!Number.isInteger(b.premium) || (b.premium as number) <= 0 || (b.premium as number) > 10_000_000_000) throw new PolicyViolation('LGL_AMOUNT', '보험료는 1원 ~ 100억 원 정수입니다.');
  if (b.coverage != null && (!Number.isInteger(b.coverage) || b.coverage < 0 || b.coverage > 1_000_000_000_000)) throw new PolicyViolation('LGL_AMOUNT', '보장 금액이 바르지 않습니다.');
  const s = dayOrNull(b.startsOn, '시작일'), e = dayOrNull(b.endsOn, '만기일');
  if (!s || !e) throw new PolicyViolation('LGL_DATE', '시작일 · 만기일을 넣으십시오.');
  if (e <= s || daysBetween(s, e) > 3660) throw new PolicyViolation('LGL_DATE', '만기일은 시작일 뒤 10년 안입니다.');
  const pay = (INS_PAY_MODES as readonly string[]).includes(b.payMode ?? '') ? b.payMode! : 'LUMP';
  const book = pay === 'MONTHLY' ? 'EXPENSE' : (INS_BOOK_MODES as readonly string[]).includes(b.bookMode ?? '') ? b.bookMode! : 'PREPAID';
  const files = await filesOk(db, b.fileIds, 5);
  return db.transaction(async () => {
    let from: string | null = null;
    if (b.renewedFrom) {
      const old = await policyOf(db, b.renewedFrom, true);
      const [dup] = await db.query(`SELECT 1 FROM lgl_insurance_policies WHERE renewed_from = $1::bigint`, [old.id]);
      if (dup) throw new StateConflict('LGL_INSURANCE_RENEW', '이미 갱신 증권이 있습니다.');
      if (s < old.startsOn) throw new PolicyViolation('LGL_INSURANCE_RENEW', '갱신 증권 시작일은 옛 증권 시작일 뒤입니다.');
      from = old.id;
    }
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO lgl_insurance_policies (kind, title, insurer, policy_ref, coverage, premium, starts_on, ends_on, pay_mode, book_mode, renewed_from, file_ids, memo, created_by)
       VALUES ($1, $2, $3, $4, $5::bigint, $6::bigint, $7::date, $8::date, $9, $10, $11::bigint, $12::uuid[], $13, $14::uuid) RETURNING id::text AS id`,
      [kind, title, insurer, clean(b.policyRef, 60), b.coverage ?? null, b.premium, s, e, pay, book, from, files, clean(b.memo, 400), actor]);
    if (from) {
      await db.query(
        `UPDATE ops_alerts SET resolved_at = now(), resolve_note = '갱신 증권'
          WHERE alert_code = 'LGL_INSURANCE_DUE' AND resolved_at IS NULL AND left(detail->>'key', char_length($1::text)) = $1::text`, [`INS:${from}:`]);
    }
    return { ok: true, id: r!.id, renewedFrom: from, note: `보험 증권 「${title}」을(를) 넣었습니다${from ? ' — 옛 증권 만기 알림은 풀렸습니다' : ''}.` };
  });
}

/** PUT /admin/legal/insurance/{id} — 이름 · 보험사 · 증권 번호 · 보장 · 서류 · 메모(보험료 · 기간 · 방법은 못 고침) */
export async function updatePolicy(db: DatabaseService, id: string, b: PolicyInput) {
  return db.transaction(async () => {
    const p = await policyOf(db, id, true);
    if (p.state !== 'ACTIVE') throw new StateConflict('LGL_INSURANCE_STATE', '끝낸 증권은 고치지 않습니다.');
    const title = b.title === undefined ? undefined : clean(b.title, 100);
    if (title !== undefined && (!title || title.length < 2)) throw new PolicyViolation('LGL_TITLE', '증권 이름은 2 ~ 100자입니다.');
    const insurer = b.insurer === undefined ? undefined : clean(b.insurer, 100);
    if (insurer !== undefined && !insurer) throw new PolicyViolation('LGL_INSURER', '보험사를 적으십시오.');
    if (b.coverage != null && (!Number.isInteger(b.coverage) || b.coverage < 0 || b.coverage > 1_000_000_000_000)) throw new PolicyViolation('LGL_AMOUNT', '보장 금액이 바르지 않습니다.');
    const files = b.fileIds === undefined ? null : await filesOk(db, b.fileIds, 5);
    await db.query(
      `UPDATE lgl_insurance_policies SET title = coalesce($2, title), insurer = coalesce($3, insurer), policy_ref = CASE WHEN $4::boolean THEN $5 ELSE policy_ref END,
              coverage = CASE WHEN $6::boolean THEN $7::bigint ELSE coverage END, file_ids = coalesce($8::uuid[], file_ids), memo = CASE WHEN $9::boolean THEN $10 ELSE memo END
        WHERE id = $1::bigint`,
      [p.id, title ?? null, insurer ?? null, b.policyRef !== undefined, clean(b.policyRef, 60), b.coverage !== undefined, b.coverage ?? null, files, b.memo !== undefined, clean(b.memo, 400)]);
    return { ok: true, id: p.id, note: '보험 증권을 고쳤습니다.' };
  });
}

/** POST /admin/legal/insurance/{id}/end — 끝냄(해지 · 만기 · 사유 · 되돌리지 않음) */
export async function endPolicy(db: DatabaseService, id: string, reasonIn: string) {
  const reason = reasonOk(reasonIn);
  return db.transaction(async () => {
    const p = await policyOf(db, id, true);
    if (p.state !== 'ACTIVE') throw new StateConflict('LGL_INSURANCE_STATE', '이미 끝낸 증권입니다.');
    await db.query(`UPDATE lgl_insurance_policies SET state = 'ENDED', ended_at = now(), end_reason = $2 WHERE id = $1::bigint`, [p.id, reason]);
    await db.query(
      `UPDATE ops_alerts SET resolved_at = now(), resolve_note = '증권 끝냄'
        WHERE alert_code = 'LGL_INSURANCE_DUE' AND resolved_at IS NULL AND left(detail->>'key', char_length($1::text)) = $1::text`, [`INS:${p.id}:`]);
    return { ok: true, id: p.id, note: '보험 증권을 끝냄으로 표시했습니다(서류 · 전표 기록은 그대로).' };
  });
}

/** POST /admin/legal/insurance/{id}/journal — 보험료 전표 초안(수동 전표 요청 · 지급 담당 · SUPER) */
export async function insuranceJournal(db: DatabaseService, id: string, b: { kind?: string; ym?: string; on?: string }, actor: string | null) {
  if (!actor) throw new PolicyViolation('LGL_ACTOR', '로그인한 운영자만 전표 초안을 만듭니다.');
  const who: string = actor;   // 거래 안(닫힘)에서도 글자로 — addManual 은 string
  if (!(INS_POST_KINDS as readonly string[]).includes(b.kind ?? '')) throw new PolicyViolation('LGL_POSTING', '초안 종류(낼 때 PAY · 달마다 넘김 AMORT · 월납 MONTHLY)를 고르십시오.');
  const on = dayOrNull(b.on, '전표 날짜');
  return db.transaction(async () => {
    const p = await policyOf(db, id, true);
    let line: { ym: string; amount: number; on: string } | undefined;
    let lines: Array<{ role: string; debit?: number; credit?: number; memo?: string }>;
    if (b.kind === 'PAY') {
      if (p.payMode !== 'LUMP') throw new PolicyViolation('LGL_POSTING', '월납 증권은 달마다 월납(MONTHLY) 초안을 만듭니다.');
      const day = on ?? p.startsOn;
      line = { ym: ymOf(day), amount: p.premium, on: day };
      const dr = p.bookMode === 'PREPAID' ? 'PREPAID_EXP' : 'EXP_INS_POLICY';
      lines = [{ role: dr, debit: p.premium, memo: p.title.slice(0, 100) }, { role: 'CASH', credit: p.premium }];
    } else {
      if (!YM_RE.test(b.ym ?? '')) throw new PolicyViolation('LGL_POSTING', '달(YYYY-MM)을 고르십시오.');
      if (b.kind === 'AMORT' && !(p.payMode === 'LUMP' && p.bookMode === 'PREPAID')) throw new PolicyViolation('LGL_POSTING', '선급비용으로 처리한 일시납 증권만 달마다 넘깁니다.');
      if (b.kind === 'MONTHLY' && p.payMode !== 'MONTHLY') throw new PolicyViolation('LGL_POSTING', '월납 증권만 월납 초안을 만듭니다.');
      const plan = b.kind === 'AMORT' ? amortPlan(p.premium, p.startsOn, p.endsOn) : monthlyPlan(p.premium, p.startsOn, p.endsOn);
      line = plan.find((x) => x.ym === b.ym);
      if (!line) throw new PolicyViolation('LGL_POSTING', '보험 기간 밖의 달입니다.');
      if (b.kind === 'AMORT' && line.on > kstToday()) throw new PolicyViolation('LGL_POSTING', '아직 지나지 않은 달은 넘기지 않습니다(그 달 말일부터).');
      if (on) line = { ...line, on };
      lines = b.kind === 'AMORT'
        ? [{ role: 'EXP_INS_POLICY', debit: line.amount, memo: p.title.slice(0, 100) }, { role: 'PREPAID_EXP', credit: line.amount }]
        : [{ role: 'EXP_INS_POLICY', debit: line.amount, memo: p.title.slice(0, 100) }, { role: 'CASH', credit: line.amount }];
    }
    if (line.amount <= 0) throw new PolicyViolation('LGL_POSTING', '그 달 금액이 0원입니다.');
    const [dup] = await db.query(
      `SELECT 1 FROM lgl_insurance_postings s JOIN acct_manual_entries m ON m.id = s.manual_id
        WHERE s.policy_id = $1::bigint AND s.kind = $2 AND s.ym = $3 AND m.state IN ('REQUESTED', 'APPROVED')`, [p.id, b.kind, line.ym]);
    if (dup) throw new StateConflict('LGL_POSTING_DUP', '그 달 같은 보험료 전표 초안이 이미 있습니다(반려 · 취소한 뒤 다시).');
    const label = b.kind === 'PAY' ? '보험료 냄' : b.kind === 'AMORT' ? '보험료 기간 배분' : '보험료 월납';
    const m = await addManual(db, { entryDate: line.on, memo: `${label} · ${p.title} ${line.ym}`.slice(0, 200), party: p.insurer, evidence: 'NONE', lines }, who);
    await db.query(
      `INSERT INTO lgl_insurance_postings (policy_id, kind, ym, amount, manual_id, created_by) VALUES ($1::bigint, $2, $3, $4::bigint, $5::bigint, $6::uuid)`,
      [p.id, b.kind, line.ym, line.amount, m.id, who]);
    return { ok: true, id: p.id, manualId: m.id, amount: line.amount, ym: line.ym, note: `${label} 전표 초안(수동 전표 ${m.id} · ${line.amount.toLocaleString('ko-KR')}원)을 올렸습니다 — 쓴 사람이 아닌 SUPER 가 회계 › 장부 › 수동 전표에서 승인합니다.` };
  });
}
