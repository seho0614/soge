import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import type { PapiPrincipal } from '../papi/guard';
import { vsxPrevYm, vsxToday, vsxSettings } from './vsx-settings';

/* ---------------------------------------------------------------------
 * v10.545 (D284 · docs/683) 오픈 API 사용량 과금 — 대표 11/20 「(54) ④ 오픈 API 사용량 과금」 · ㊼(D278 papi) 위에 얹음
 *
 *   ① 하루 사용량 papi_usage_daily — 정기 작업 papi_usage(매일 03:40 · papi_daily 03:50 기록 정리 전)가 지난 3일을 키별로 다시 모음
 *        과금 대상 = 응답 400 아래의 자료 주소(leads · services · cash) · 안내 주소(me · docs · usage)는 셈만 하고 과금 안 함 · 400 이상은 오류 칸
 *   ② 월 청구서 초안 papi_bill_drafts — papi.bill_enabled on(처음 off)이고 papi.bill_day 일(처음 3)부터 지난달 파트너별로 만들고 다시 셈
 *        과금 건수 = 그 달 과금 대상 − 무료(papi.bill_free_calls · 처음 10,000) · 공급가 = 과금 건수 × 1,000건 단가(papi.bill_price_1k · 처음 1,000원) ÷ 1,000(버림)
 *        부가세 = 공급가 ÷ 10(버림 · 별도 — D243) · 과금 건수 0 이면 초안을 만들지 않음 · 단가 · 무료 수는 만들 때 값으로 굳힘
 *   ③ 확정은 사람 — SUPER 가 「확정」 글자로 · 확정 뒤 숫자는 DB 가 막음 · 잘못이면 무효(사유) → 그 달 새 초안
 *        실제 청구(세금계산서 · 수납 · 리드 이용료 차감)는 이 화면 밖에서 사람이 함 — 이 묶음은 금액을 움직이지 않음
 *   ④ 파트너 시스템 GET /api/partner/v1/usage — 이번 달 · 지난달 사용량 · 무료 · 예상 금액(과금이 켜졌을 때만) · 확정 청구서 3개
 * ------------------------------------------------------------------- */

export const BILL_YM = /^[0-9]{4}-(0[1-9]|1[0-2])$/;   // DB CHECK ck_papi_bill_ym 과 같음(규칙 2)

function audit(db: DatabaseService, action: string, data: Record<string, unknown>) {
  const c = RequestCtx.get();
  return db.query(
    `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, after_data, ip, user_agent) VALUES ($1, $2, $3, 'PARTNER', $4::jsonb, $5, $6)`,
    [c?.actorId ?? null, c?.actorRole ?? null, action, JSON.stringify(data), c?.ip ?? null, c?.userAgent ?? null]).catch(() => undefined);
}

/** 공급가 · 부가세 — DB CHECK ck_papi_bill_amt 와 같은 셈(정수 버림) */
export function billAmounts(total: number, free: number, price1k: number) {
  const billable = Math.max(total - free, 0);
  const supply = Math.floor((billable * price1k) / 1000);
  const vat = Math.floor(supply / 10);
  return { billable, supply, vat, sum: supply + vat };
}

/** 하루 사용량 모으기 — 한국 날짜 from ~ to(처음 지난 3일 ~ 오늘) */
export async function papiUsageRollup(db: DatabaseService, days = 3) {
  const today = vsxToday();
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400e3).toISOString().slice(0, 10);
  const [r] = await db.query<{ n: number }>(`SELECT fn_papi_usage_rollup($1::date, $2::date) AS n`, [from, today]);
  return { from, to: today, rows: Number(r?.n ?? 0) };
}

/** 그 달 청구서 초안 만들기 · 다시 셈(초안만 · 확정 · 무효는 그대로) */
export async function papiBillsMake(db: DatabaseService, ym: string) {
  if (!BILL_YM.test(ym)) throw new PolicyViolation('PAPI_BILL_YM', '달은 YYYY-MM 입니다.');
  if (ym >= vsxToday().slice(0, 7)) throw new PolicyViolation('PAPI_BILL_YM', '끝난 달만 청구서 초안을 만듭니다.');
  const s = await vsxSettings(db);
  const usage = await db.query<{ partnerId: string; total: string }>(
    `SELECT partner_id AS "partnerId", sum(calls_ok)::bigint AS total FROM papi_usage_daily
      WHERE day >= ($1 || '-01')::date AND day < (($1 || '-01')::date + interval '1 month') GROUP BY partner_id`, [ym]);
  let made = 0, remade = 0, kept = 0;
  for (const u of usage) {
    const a = billAmounts(Number(u.total), s.billFreeCalls, s.billPrice1k);
    const [cur] = await db.query<{ id: string; state: string }>(`SELECT id::text AS id, state FROM papi_bill_drafts WHERE partner_id = $1 AND ym = $2 AND state <> 'VOID'`, [u.partnerId, ym]);
    if (cur && cur.state !== 'DRAFT') { kept++; continue; }
    if (a.billable === 0) continue;
    if (cur) {
      await db.query(
        `UPDATE papi_bill_drafts SET calls_total = $2::bigint, free_calls = $3::bigint, calls_billable = $4::bigint, price_per_1k = $5::int,
                supply_amount = $6::bigint, vat_amount = $7::bigint, total_amount = $8::bigint, remade_at = now() WHERE id = $1::bigint AND state = 'DRAFT'`,
        [cur.id, Number(u.total), s.billFreeCalls, a.billable, s.billPrice1k, a.supply, a.vat, a.sum]);
      remade++;
    } else {
      await db.query(
        `INSERT INTO papi_bill_drafts (partner_id, ym, calls_total, free_calls, calls_billable, price_per_1k, supply_amount, vat_amount, total_amount)
         VALUES ($1, $2, $3::bigint, $4::bigint, $5::bigint, $6::int, $7::bigint, $8::bigint, $9::bigint) ON CONFLICT DO NOTHING`,
        [u.partnerId, ym, Number(u.total), s.billFreeCalls, a.billable, s.billPrice1k, a.supply, a.vat, a.sum]);
      made++;
    }
  }
  return { ym, made, remade, kept, partners: usage.length };
}

/* ── 정기 작업 papi_usage (매일 03:40) ─────────────────────────────── */
export async function papiUsageJob(db: DatabaseService) {
  const roll = await papiUsageRollup(db, 3);
  const s = await vsxSettings(db);
  const day = Number(vsxToday().slice(8, 10));
  if (!s.billOn || day < s.billDay) return { ...roll, bill: false, made: 0, remade: 0 };
  /* 달이 바뀐 뒤 처음 며칠은 지난달 마지막 날 기록까지 다시 모음(3일보다 앞 · bill_day 가 4일 넘으면) */
  const ym = vsxPrevYm();
  if (day <= 7) await db.query(`SELECT fn_papi_usage_rollup((($1 || '-01')::date + interval '1 month' - interval '7 days')::date, (($1 || '-01')::date + interval '1 month' - interval '1 day')::date)`, [ym])
    .catch(() => undefined);
  const b = await papiBillsMake(db, ym);
  if (b.made > 0) {
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('PAPI_BILL_DRAFTS', 'INFO', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
      [`오픈 API ${ym} 청구서 초안 ${b.made}건 — 파트너사 › 오픈 API 사용량 · 청구에서 확인 · 확정(SUPER)`, JSON.stringify(b)]).catch(() => undefined);
  }
  return { ...roll, bill: true, ...b };
}

/** 운영 화면 — 그 달 파트너별 사용량 · 초안 · 설정 · 이번 달 지금까지 */
export async function papiUsageView(db: DatabaseService, ymIn?: string) {
  const ym = ymIn ? String(ymIn) : vsxPrevYm();
  if (!BILL_YM.test(ym)) throw new PolicyViolation('PAPI_BILL_YM', '달은 YYYY-MM 입니다.');
  const settings = await vsxSettings(db);
  const rows = await db.query<Record<string, unknown> & { ok: string }>(
    `SELECT u.partner_id AS "partnerId", b.company_name AS company, sum(u.calls_ok)::bigint AS ok, sum(u.calls_free)::bigint AS free, sum(u.calls_err)::bigint AS err,
            count(DISTINCT u.key_id)::int AS keys, max(u.made_at) AS "madeAt"
       FROM papi_usage_daily u JOIN partners p ON p.id = u.partner_id JOIN businesses b ON b.id = p.business_id
      WHERE u.day >= ($1 || '-01')::date AND u.day < (($1 || '-01')::date + interval '1 month')
      GROUP BY u.partner_id, b.company_name ORDER BY ok DESC LIMIT 300`, [ym]);
  const drafts = await db.query(
    `SELECT d.id::text AS id, d.partner_id AS "partnerId", b.company_name AS company, d.ym, d.calls_total AS "callsTotal", d.free_calls AS "freeCalls",
            d.calls_billable AS "callsBillable", d.price_per_1k AS "price1k", d.supply_amount AS supply, d.vat_amount AS vat, d.total_amount AS total, d.state,
            d.made_at AS "madeAt", d.remade_at AS "remadeAt", d.confirmed_at AS "confirmedAt", ca.email::text AS "confirmedBy", d.void_at AS "voidAt", d.void_reason AS "voidReason"
       FROM papi_bill_drafts d JOIN partners p ON p.id = d.partner_id JOIN businesses b ON b.id = p.business_id LEFT JOIN accounts ca ON ca.id = d.confirmed_by
      WHERE d.ym = $1 ORDER BY (d.state = 'VOID'), d.total_amount DESC`, [ym]);
  const items = rows.map((r) => ({ ...r, estimate: billAmounts(Number(r.ok), settings.billFreeCalls, settings.billPrice1k) }));
  return { ym, settings, items, drafts,
    note: '과금 대상 = 400 아래 자료 주소(leads · services · cash) · 무료 · 단가는 초안을 만들 때 값으로 굳힘 · 확정은 SUPER · 실제 청구 · 수납은 이 화면 밖' };
}

export async function papiBillConfirm(db: DatabaseService, idIn: string, word: string) {
  if (String(word ?? '').trim() !== '확정') throw new PolicyViolation('PAPI_BILL_CONFIRM', '확인 글자 「확정」을 적으십시오.');
  const id = Number(idIn);
  if (!Number.isInteger(id) || id <= 0) throw new NotFound('없는 청구서입니다.');
  const me = RequestCtx.actorId() ?? null;
  const r = await db.query<{ id: string; partnerId: string; ym: string; total: string }>(
    `UPDATE papi_bill_drafts SET state = 'CONFIRMED', confirmed_by = $2, confirmed_at = now() WHERE id = $1::bigint AND state = 'DRAFT'
     RETURNING id::text AS id, partner_id AS "partnerId", ym, total_amount AS total`, [id, me]);
  if (!r.length) {
    const [x] = await db.query(`SELECT 1 FROM papi_bill_drafts WHERE id = $1::bigint`, [id]);
    if (!x) throw new NotFound('없는 청구서입니다.');
    throw new StateConflict('PAPI_BILL_STATE', '초안 상태인 청구서만 확정합니다.');
  }
  await audit(db, 'PAPI_BILL_CONFIRM', { bill: r[0]!.id, partner: r[0]!.partnerId, ym: r[0]!.ym, total: Number(r[0]!.total) });
  return { ok: true, id: r[0]!.id, state: 'CONFIRMED', note: '확정했습니다 — 청구 · 세금계산서는 담당자가 따로 진행합니다(이 화면은 금액을 움직이지 않음).' };
}

export async function papiBillVoid(db: DatabaseService, idIn: string, reasonIn: string) {
  const reason = String(reasonIn ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('PAPI_BILL_REASON', '사유는 2 ~ 200자입니다.');
  const id = Number(idIn);
  if (!Number.isInteger(id) || id <= 0) throw new NotFound('없는 청구서입니다.');
  const me = RequestCtx.actorId() ?? null;
  const r = await db.query<{ id: string; partnerId: string; ym: string }>(
    `UPDATE papi_bill_drafts SET state = 'VOID', void_by = $2, void_at = now(), void_reason = $3 WHERE id = $1::bigint AND state IN ('DRAFT', 'CONFIRMED')
     RETURNING id::text AS id, partner_id AS "partnerId", ym`, [id, me, reason]);
  if (!r.length) {
    const [x] = await db.query(`SELECT 1 FROM papi_bill_drafts WHERE id = $1::bigint`, [id]);
    if (!x) throw new NotFound('없는 청구서입니다.');
    throw new StateConflict('PAPI_BILL_STATE', '이미 무효인 청구서입니다.');
  }
  await audit(db, 'PAPI_BILL_VOID', { bill: r[0]!.id, partner: r[0]!.partnerId, ym: r[0]!.ym, reason });
  return { ok: true, id: r[0]!.id, state: 'VOID', note: '무효로 했습니다 — 그 달 새 초안은 「지금 다시 셈」으로 만듭니다.' };
}

/** SUPER — 지금 모으기 · 그 달 초안 다시 셈(과금 스위치와 상관없이 · 운영자가 직접 누름) */
export async function papiUsageRunNow(db: DatabaseService, ymIn?: string) {
  const roll = await papiUsageRollup(db, 3);
  if (!ymIn) return { ...roll, bill: null };
  const ym = String(ymIn);
  if (!BILL_YM.test(ym)) throw new PolicyViolation('PAPI_BILL_YM', '달은 YYYY-MM 입니다.');
  await db.query(`SELECT fn_papi_usage_rollup(($1 || '-01')::date, (($1 || '-01')::date + interval '1 month' - interval '1 day')::date)`, [ym]);
  const b = await papiBillsMake(db, ym);
  await audit(db, 'PAPI_BILL_MAKE', { ...b });
  return { ...roll, bill: b };
}

/* ── 파트너 시스템 GET /api/partner/v1/usage ───────────────────────── */
export async function papiMyUsage(db: DatabaseService, p: PapiPrincipal) {
  const s = await vsxSettings(db);
  const thisYm = vsxToday().slice(0, 7), lastYm = vsxPrevYm();
  const sums = await db.query<{ ym: string; ok: string; free: string; err: string }>(
    `SELECT to_char(day, 'YYYY-MM') AS ym, sum(calls_ok)::bigint AS ok, sum(calls_free)::bigint AS free, sum(calls_err)::bigint AS err
       FROM papi_usage_daily WHERE partner_id = $1 AND day >= ($2 || '-01')::date GROUP BY 1`, [p.partnerId, lastYm]);
  const one = (ym: string) => {
    const r = sums.find((x) => x.ym === ym);
    const ok = Number(r?.ok ?? 0);
    return { ym, billableCalls: ok, infoCalls: Number(r?.free ?? 0), errorCalls: Number(r?.err ?? 0),
      estimate: s.billOn ? billAmounts(ok, s.billFreeCalls, s.billPrice1k) : null };
  };
  const bills = await db.query(
    `SELECT ym, calls_total AS "callsTotal", calls_billable AS "callsBillable", supply_amount AS supply, vat_amount AS vat, total_amount AS total, confirmed_at AS "confirmedAt"
       FROM papi_bill_drafts WHERE partner_id = $1 AND state = 'CONFIRMED' ORDER BY ym DESC LIMIT 3`, [p.partnerId]);
  return { billing: s.billOn, freeCalls: s.billOn ? s.billFreeCalls : null, pricePer1000: s.billOn ? s.billPrice1k : null,
    thisMonth: one(thisYm), lastMonth: one(lastYm), confirmedBills: bills,
    note: '하루 한 번(03:40) 모은 숫자입니다 — 오늘 호출은 내일 보입니다. 과금 대상은 leads · services · cash 주소의 성공 응답입니다(부가세 별도).' };
}
