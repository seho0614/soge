import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { dateOk, kstToday } from './statements';
import { accountLedger, LEDGER_MAX } from './ledger';
import { assertOpen } from './manual';

/* ---------------------------------------------------------------------
 * ㉗ 장부 보강 (D260 · docs/586 ~ 589) — 대표 11/20 03:30 「다음개발」 승인
 *   v10.449  분개장 — 기간 전표를 날짜 · 번호 순으로 줄째(차변 · 대변 계정 · 금액) · 합계(차변 = 대변) · CSV(내려받기 승인 ACCT_LEDGER)
 *   v10.450  현금출납장 — 보통예금(CASH) · 현금(CASH_HAND) 계정의 날짜별 들어옴 · 나감 · 잔액(⑬ 계정별 원장 재사용) · CSV(ACCT_LEDGER)
 *   v10.451  승인된 수동 전표 반대 전표(역분개) — SUPER · 사유 5자 이상 · 날짜 ≥ 원래 전표 날짜 · 마감한 달 · 해는 막음 · 한 번만
 *            (acct_entries source MANUAL_REVERSE · source_key = 수동 전표 번호 · 기록 acct_entry_reversals)
 *   v10.452  결산 외화 받을 돈 환산 평가 — 그 달 말일 기준 못 받은 수출 받을 돈(⑳ ㉑ 수출 · 선적 원화) × 기말 환율(SUPER 입력)
 *            → FX_REVAL(말일 · 외화환산이익 · 손실) + FX_REVAL_REV(다음 달 첫날 · 되돌림) · 달마다 한 번
 *   (점검 2 · 3 실패에서) 자리값 형 못 박음($n::int · ::bigint) · DTO 빈 칸(undefined)으로 덮지 않음.
 * ------------------------------------------------------------------- */

export const CASHBOOK_ROLES = ['CASH', 'CASH_HAND'] as const;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const CUR = /^[A-Z]{3}$/;
const n = (v: unknown) => Number(v ?? 0);
const EV_KO: Record<string, string> = { TAX_INVOICE: '세금계산서', CARD_PG: '카드 · PG', CASH: '현금영수증', NONE: '', CARD: '법인카드', SIMPLE: '간이영수증' };

function range(from?: string, to?: string) {
  dateOk(from); dateOk(to);
  if (from! > to!) throw new PolicyViolation('ACCT_DATE', '시작일이 끝일보다 늦습니다.');
  if (Date.parse(to!) - Date.parse(from!) > 366 * 86400e3) throw new PolicyViolation('ACCT_DATE', '기간은 1년까지입니다.');
  return { from: from!, to: to! };
}
const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10); };
const nextFirst = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10); };

/* ── v10.449 분개장 ── */
export async function dayBook(db: DatabaseService, fromQ?: string, toQ?: string) {
  const { from, to } = range(fromQ, toQ);
  const rows = await db.query<{ entryId: string; date: string; source: string; memo: string | null; party: string | null; evidence: string; late: boolean;
    role: string; name: string; code: string | null; debit: string; credit: string }>(
    `SELECT e.id::text AS "entryId", e.entry_date::text AS date, e.source, e.memo, e.party, e.evidence, e.late,
            l.role, a.name, a.ext_code AS code, l.debit::text AS debit, l.credit::text AS credit
       FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id JOIN acct_accounts a ON a.role = l.role
      WHERE e.entry_date >= $1::date AND e.entry_date <= $2::date
      ORDER BY e.entry_date, e.id, (l.debit > 0) DESC, l.id LIMIT ${LEDGER_MAX + 1}`, [from, to]);
  const cut = rows.length > LEDGER_MAX;
  const keep = rows.slice(0, LEDGER_MAX);
  /* 잘린 전표의 앞 줄만 남으면 차대가 안 맞아 보임 → 마지막 전표는 통째로 뺌 */
  const lastId = cut ? keep[keep.length - 1]?.entryId : null;
  const lines = lastId ? keep.filter((r) => r.entryId !== lastId) : keep;
  const entries: Array<{ entryId: string; date: string; source: string; memo: string; party: string; evidence: string; late: boolean;
    lines: Array<{ role: string; name: string; code: string | null; debit: number; credit: number }>; debit: number; credit: number }> = [];
  for (const r of lines) {
    let e = entries[entries.length - 1];
    if (!e || e.entryId !== r.entryId) {
      e = { entryId: r.entryId, date: r.date, source: r.source, memo: r.memo ?? '', party: r.party ?? '', evidence: r.evidence, late: r.late, lines: [], debit: 0, credit: 0 };
      entries.push(e);
    }
    const d = n(r.debit), c = n(r.credit);
    e.lines.push({ role: r.role, name: r.name, code: r.code, debit: d, credit: c }); e.debit += d; e.credit += c;
  }
  const total = { entries: entries.length, lines: lines.length, debit: entries.reduce((a, x) => a + x.debit, 0), credit: entries.reduce((a, x) => a + x.credit, 0) };
  return { from, to, entries, total, balanced: total.debit === total.credit, truncated: cut,
           note: cut ? `줄이 ${LEDGER_MAX}개를 넘어 앞부분만 보입니다 — 기간을 나누십시오.` : '전표를 날짜 · 번호 순으로 차변 줄 먼저 적었습니다. 합계 차변 = 대변이어야 맞습니다.' };
}

export function dayBookCsv(r: Awaited<ReturnType<typeof dayBook>>) {
  const head = ['일자', '전표번호', '근거', '적요', '거래처', '증빙', '계정코드', '계정', '차변', '대변'];
  const body: unknown[][] = [];
  for (const e of r.entries) for (const l of e.lines) body.push([e.date, e.entryId, e.source, e.memo, e.party, EV_KO[e.evidence] ?? '', l.code ?? '', l.name, l.debit, l.credit]);
  body.push([r.to, '', '', '합계', '', '', '', '', r.total.debit, r.total.credit]);
  return { head, body };
}

/* ── v10.450 현금출납장 ── */
export async function cashBook(db: DatabaseService, roleQ?: string, fromQ?: string, toQ?: string) {
  const role = (CASHBOOK_ROLES as readonly string[]).includes(roleQ ?? '') ? roleQ! : 'CASH';
  const r = await accountLedger(db, role, fromQ, toQ);   // 기초 · 줄 · 잔액은 ⑬ 원장과 같은 셈
  const days = new Map<string, { date: string; in: number; out: number; count: number; balance: number }>();
  for (const x of r.rows) {
    const d = days.get(x.date) ?? { date: x.date, in: 0, out: 0, count: 0, balance: 0 };
    d.in += x.debit; d.out += x.credit; d.count++; d.balance = x.balance;   // 줄은 날짜 순 — 그날 마지막 잔액
    days.set(x.date, d);
  }
  const roles = await db.query<{ role: string; name: string }>(`SELECT role, name FROM acct_accounts WHERE role = ANY($1::text[]) ORDER BY sort`, [[...CASHBOOK_ROLES]]);
  return { role, account: r.account, roles, from: r.from, to: r.to, opening: r.opening, days: [...days.values()], rows: r.rows,
           total: { in: r.total.debit, out: r.total.credit }, closing: r.closing, truncated: r.truncated,
           warn: r.closing < 0 ? '잔액이 0 아래입니다 — 기초 잔액(재무제표 › 기초 잔액)이나 빠진 전표를 확인하십시오.' : '',
           note: '들어옴 = 차변 · 나감 = 대변 · 날짜별 마지막 잔액입니다. 현금(시재)은 수동 전표로 들고 남을 적습니다.' };
}

export function cashBookCsv(r: Awaited<ReturnType<typeof cashBook>>) {
  const head = ['일자', '전표번호', '근거', '적요', '거래처', '들어옴', '나감', '잔액'];
  const body: unknown[][] = [[r.from, '', '', '기초 잔액', '', '', '', r.opening],
    ...r.rows.map((x) => [x.date, x.entryId, x.source, x.memo, x.party, x.debit, x.credit, x.balance]),
    [r.to, '', '', '합계 · 기말', '', r.total.in, r.total.out, r.closing]];
  return { head, body };
}

/* ── v10.451 승인된 수동 전표 반대 전표(역분개) ── */
export async function reverseManual(db: DatabaseService, id: string, b: { reverseOn?: string; reason?: string }, actor: string, actorIsSuper: boolean) {
  if (!/^\d{1,18}$/.test(id ?? '')) throw new NotFound('수동 전표가 없습니다.');
  if (!actorIsSuper) throw new PolicyViolation('ACCT_REVERSE_ROLE', '반대 전표는 SUPER 만 만듭니다.');
  const reason = (b.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 5 || reason.length > 200) throw new PolicyViolation('ACCT_REVERSE', '사유를 5 ~ 200자로 적어 주십시오.');
  const day = (b.reverseOn ?? '').trim() || kstToday();
  dateOk(day, 'ACCT_REVERSE');
  return db.transaction(async () => {
    const [m] = await db.query<{ state: string; entry_id: string | null; entry_date: string; memo: string; party: string | null; evidence: string }>(
      `SELECT state, entry_id::text AS entry_id, entry_date::text AS entry_date, memo, party, evidence FROM acct_manual_entries WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!m) throw new NotFound('수동 전표가 없습니다.');
    if (m.state !== 'APPROVED' || !m.entry_id) throw new StateConflict('ACCT_REVERSE_STATE', '승인된(장부에 들어간) 수동 전표만 반대 전표를 만듭니다.');
    const [done] = await db.query<{ e: string }>(`SELECT reverse_entry_id::text AS e FROM acct_entry_reversals WHERE manual_id = $1::bigint`, [id]);
    if (done) throw new StateConflict('ACCT_REVERSE_DONE', `이미 반대 전표(${done.e})를 만들었습니다.`);
    if (day < m.entry_date) throw new PolicyViolation('ACCT_REVERSE_DATE', `반대 전표 날짜는 원래 전표 날짜(${m.entry_date}) 이후여야 합니다.`);
    await assertOpen(db, day);
    const lines = await db.query<{ role: string; debit: string; credit: string }>(
      `SELECT role, debit::text AS debit, credit::text AS credit FROM acct_lines WHERE entry_id = $1::bigint ORDER BY id`, [m.entry_id]);
    if (lines.length < 2) throw new StateConflict('ACCT_REVERSE_STATE', '원래 전표 줄이 없습니다.');
    const [e] = await db.query<{ id: string }>(
      `INSERT INTO acct_entries (entry_date, source, source_key, memo, party, evidence, late) VALUES ($1::date, 'MANUAL_REVERSE', $2, $3, $4, $5, false) RETURNING id::text AS id`,
      [day, id, `반대 · ${m.memo}`.slice(0, 200), m.party, m.evidence]);
    await db.query(
      `INSERT INTO acct_lines (entry_id, role, debit, credit) SELECT $1::bigint, x.role, x.debit, x.credit FROM jsonb_to_recordset($2::jsonb) AS x(role text, debit bigint, credit bigint)`,
      [e!.id, JSON.stringify(lines.map((l) => ({ role: l.role, debit: n(l.credit), credit: n(l.debit) })))]);
    await db.query(
      `INSERT INTO acct_entry_reversals (manual_id, entry_id, reverse_entry_id, reverse_on, reason, created_by) VALUES ($1::bigint, $2::bigint, $3::bigint, $4::date, $5, $6::uuid)`,
      [id, m.entry_id, e!.id, day, reason, actor]);
    return { ok: true, id, entryId: m.entry_id, reverseEntryId: e!.id, reverseOn: day,
             note: `수동 전표 ${id}(전표 ${m.entry_id})의 반대 전표 ${e!.id} 를 ${day} 날짜로 넣었습니다 — 바로잡을 내용이 있으면 새 수동 전표를 쓰십시오.` };
  });
}

/* ── v10.452 결산 외화 받을 돈 환산 평가 ── */
export interface OpenAr { exportId: string; title: string; party: string | null; currency: string; foreign: number; bookKrw: number; shippedOn: string }

async function openForeignAr(db: DatabaseService, asOf: string): Promise<OpenAr[]> {
  const rows = await db.query<{ id: string; title: string; party: string | null; currency: string; fa: string; krw: string; shipped: string }>(
    `SELECT x.id::text AS id, x.title, p.name AS party, x.currency,
            (SELECT coalesce(sum(l.foreign_amount), 0) FROM acct_export_lines l WHERE l.export_id = x.id)::text AS fa,
            x.sale_krw::text AS krw, x.shipped_on::text AS shipped
       FROM acct_exports x LEFT JOIN acct_parties p ON p.id = x.party_id
      WHERE x.state IN ('SHIPPED', 'CLEARED', 'PAID') AND x.shipped_on IS NOT NULL AND x.shipped_on <= $1::date AND x.sale_krw > 0
        AND (x.paid_on IS NULL OR x.paid_on > $1::date)
        AND EXISTS (SELECT 1 FROM acct_entries e WHERE e.source = 'EXPORT_SALE' AND e.source_key = x.id::text)
      ORDER BY x.currency, x.id`, [asOf]);
  return rows.map((r) => ({ exportId: r.id, title: r.title, party: r.party, currency: r.currency, foreign: n(r.fa), bookKrw: n(r.krw), shippedOn: r.shipped }));
}

function ymOk(ym?: string) {
  const v = (ym ?? '').trim();
  if (!YM.test(v)) throw new PolicyViolation('ACCT_FXREVAL', '달은 YYYY-MM 으로 적어 주십시오.');
  if (v > kstToday().slice(0, 7)) throw new PolicyViolation('ACCT_FXREVAL', '앞으로 올 달은 평가하지 않습니다.');
  return v;
}

/** 'USD:1350.5,EUR:1490' 또는 { USD: 1350.5 } → { USD: 1350.5 } */
export function parseRates(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const put = (k: string, v: unknown) => {
    const c = String(k).trim().toUpperCase(), r = Number(v);
    if (!CUR.test(c)) throw new PolicyViolation('ACCT_FXREVAL_RATE', `통화 ${k} 가 맞지 않습니다(영문 3자).`);
    if (!Number.isFinite(r) || r <= 0 || r > 100000) throw new PolicyViolation('ACCT_FXREVAL_RATE', `${c} 환율이 맞지 않습니다.`);
    out[c] = Math.round(r * 10000) / 10000;
  };
  if (typeof raw === 'string') {
    for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) { const [k, v] = part.split(':'); put(k ?? '', v); }
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (v !== undefined && v !== null && v !== '') put(k, v);
  }
  return out;
}

function calc(items: OpenAr[], rates: Record<string, number>) {
  const out = items.map((x) => {
    const rate = rates[x.currency];
    const evalKrw = rate ? Math.round(x.foreign * rate) : null;
    return { ...x, rate: rate ?? null, evalKrw, diff: evalKrw === null ? null : evalKrw - x.bookKrw };
  });
  const gain = out.reduce((a, x) => a + (x.diff !== null && x.diff > 0 ? x.diff : 0), 0);
  const loss = out.reduce((a, x) => a + (x.diff !== null && x.diff < 0 ? -x.diff : 0), 0);
  const missing = [...new Set(out.filter((x) => x.rate === null).map((x) => x.currency))];
  return { items: out, gain, loss, missing };
}

/** GET /admin/acct/fx-reval?ym= — 그 달 기록 · 못 받은 외화 받을 돈 · 지난 기록 */
export async function fxRevalView(db: DatabaseService, ymQ?: string) {
  const ym = ymQ ? ymOk(ymQ) : kstToday().slice(0, 7);
  const asOf = lastDay(ym);
  const [run] = await db.query(
    `SELECT r.id::text AS id, r.ym, r.as_of::text AS "asOf", r.rates, r.items, r.gain::bigint AS gain, r.loss::bigint AS loss,
            r.entry_id::text AS "entryId", r.reverse_entry_id::text AS "reverseEntryId", r.note, a.email AS "createdBy", r.created_at AS "createdAt"
       FROM acct_fx_revals r LEFT JOIN accounts a ON a.id = r.created_by WHERE r.ym = $1`, [ym]);
  const open = run ? [] : await openForeignAr(db, asOf);
  const history = await db.query(
    `SELECT ym, as_of::text AS "asOf", gain::bigint AS gain, loss::bigint AS loss, entry_id::text AS "entryId", created_at AS "createdAt" FROM acct_fx_revals ORDER BY ym DESC LIMIT 24`);
  return { ym, asOf, run: run ? { ...run, gain: n((run as any).gain), loss: n((run as any).loss) } : null, open, currencies: [...new Set(open.map((x) => x.currency))],
           history: history.map((h: any) => ({ ...h, gain: n(h.gain), loss: n(h.loss) })),
           note: '그 달 말일까지 못 받은 수출 받을 돈을 기말 환율로 다시 셉니다. 평가 전표(말일)와 되돌림 전표(다음 달 첫날)를 함께 넣고, 달마다 한 번입니다. 환율은 서울외국환중개 매매기준율 등 공시 값을 넣으십시오.' };
}

/** GET /admin/acct/fx-reval/preview?ym=&rates=USD:1350 — 저장 안 함 */
export async function fxRevalPreview(db: DatabaseService, ymQ?: string, ratesQ?: string) {
  const ym = ymOk(ymQ);
  const asOf = lastDay(ym);
  const rates = parseRates(ratesQ ?? '');
  const c = calc(await openForeignAr(db, asOf), rates);
  return { ym, asOf, rates, ...c, net: c.gain - c.loss,
           warn: c.missing.length ? `환율이 없는 통화: ${c.missing.join(' · ')} — 넣어야 평가합니다.` : '' };
}

/** POST /admin/acct/fx-reval — SUPER · 달마다 한 번 · 평가 전표 + 되돌림 */
export async function fxRevalPost(db: DatabaseService, b: { ym?: string; rates?: unknown; note?: string }, actor: string, actorIsSuper: boolean) {
  if (!actorIsSuper) throw new PolicyViolation('ACCT_FXREVAL_ROLE', '환산 평가는 SUPER 만 넣습니다.');
  const ym = ymOk(b.ym);
  const asOf = lastDay(ym), back = nextFirst(ym);
  const rates = parseRates(b.rates);
  const note = (b.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('acct_fx_reval'))`);
    const [done] = await db.query(`SELECT 1 FROM acct_fx_revals WHERE ym = $1`, [ym]);
    if (done) throw new StateConflict('ACCT_FXREVAL_DONE', `${ym} 은 이미 환산 평가를 했습니다(달마다 한 번).`);
    const c = calc(await openForeignAr(db, asOf), rates);
    if (c.missing.length) throw new PolicyViolation('ACCT_FXREVAL_RATE', `환율이 없는 통화가 있습니다: ${c.missing.join(' · ')}`);
    let entryId: string | null = null, reverseId: string | null = null;
    if (c.gain + c.loss > 0) {
      await assertOpen(db, asOf);
      await assertOpen(db, back);
      const lines = [
        ...(c.gain > 0 ? [{ role: 'AR', debit: c.gain, credit: 0 }, { role: 'FX_REVAL_GAIN', debit: 0, credit: c.gain }] : []),
        ...(c.loss > 0 ? [{ role: 'FX_REVAL_LOSS', debit: c.loss, credit: 0 }, { role: 'AR', debit: 0, credit: c.loss }] : []),
      ];
      const put = async (day: string, source: string, memo: string, ls: Array<{ role: string; debit: number; credit: number }>) => {
        const [e] = await db.query<{ id: string }>(
          `INSERT INTO acct_entries (entry_date, source, source_key, memo, party, evidence, late) VALUES ($1::date, $2, $3, $4, NULL, 'NONE', false) RETURNING id::text AS id`,
          [day, source, ym, memo]);
        await db.query(
          `INSERT INTO acct_lines (entry_id, role, debit, credit) SELECT $1::bigint, x.role, x.debit, x.credit FROM jsonb_to_recordset($2::jsonb) AS x(role text, debit bigint, credit bigint)`,
          [e!.id, JSON.stringify(ls)]);
        return e!.id;
      };
      entryId = await put(asOf, 'FX_REVAL', `${ym} 외화 받을 돈 환산 평가`, lines);
      reverseId = await put(back, 'FX_REVAL_REV', `${ym} 외화 환산 평가 되돌림`, lines.map((l) => ({ role: l.role, debit: l.credit, credit: l.debit })));
    }
    await db.query(
      `INSERT INTO acct_fx_revals (ym, as_of, rates, items, gain, loss, entry_id, reverse_entry_id, note, created_by)
       VALUES ($1, $2::date, $3::jsonb, $4::jsonb, $5::bigint, $6::bigint, $7::bigint, $8::bigint, $9, $10::uuid)`,
      [ym, asOf, JSON.stringify(rates), JSON.stringify(c.items.map((x) => ({ exportId: x.exportId, currency: x.currency, foreign: x.foreign, bookKrw: x.bookKrw, rate: x.rate, evalKrw: x.evalKrw, diff: x.diff }))),
       c.gain, c.loss, entryId, reverseId, note, actor]);
    return { ok: true, ym, asOf, gain: c.gain, loss: c.loss, net: c.gain - c.loss, count: c.items.length, entryId, reverseEntryId: reverseId,
             note: c.gain + c.loss > 0
               ? `${ym} 환산 평가 — 이익 ${c.gain.toLocaleString('ko-KR')}원 · 손실 ${c.loss.toLocaleString('ko-KR')}원 · 평가 전표 ${entryId}(${asOf}) · 되돌림 ${reverseId}(${back}).`
               : `${ym} 환산 평가 — 평가할 차이가 없어 전표 없이 기록만 남겼습니다.` };
  });
}
