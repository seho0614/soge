import { DatabaseService } from '../../db/database.service';
import { MailService } from '../../common/mail/mail.service';
import { maskMail } from '../../common/mail/mail-admin.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.532 (D281 · docs/670) 입점 판매자 월 정산서 — 대표 11/20 「(51) ① 판매자 정산서 PDF · 메일」
 *   한 장 = 그 달에 시작한 주 정산서(hlt_settlements · 월요일 시작 7일) 합계 + 주별 줄 — DB 함수 fn_hlt_statement_calc · make 가 셈
 *   PDF = 서버 PDF 라이브러리 없이 인쇄용 화면(운영 화면 printDoc.ts · 판매자센터 /health/seller/center/statements) → 브라우저 「PDF로 저장」
 *   메일 = 처음 꺼짐(mall.statement_mail) · 켜지고 메일 준비됨이면 매달 mall.statement_day 일 09:10 정기 작업(mall_statement)이 지난달 것을 한 번만
 *          같은 달 두 번 안 보냄: 보낸 줄(SENT)은 DB 트리거가 아무것도 못 바꾸게 막음 · 「보내는 중」 표시(mail_claimed_at · 10분)로 작업 · 운영이 겹치지 않음
 *   누가: 운영(ADMIN · SUPER) 모두 · 판매자는 자기 것만(입점 승인 TENANT · BRAND · ACTIVE · PAUSED — 판매자센터와 같은 규칙)
 * ------------------------------------------------------------------- */

/** 정산 달 — DB CHECK hlt_seller_statements.ym · fn_hlt_statement_calc 와 같은 무늬(규칙 2) */
export const STMT_YM = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
export const STMT_COMPANY = '(주)한국바이오헬스케어 소개뱅크 사업부';
export const STMT_LINK = 'https://sogaebank.com/health/seller/center/statements';
const n = (v: unknown) => Number(v ?? 0);
const kstNow = () => new Date(Date.now() + 9 * 3600e3);
/** 한국 날짜로 지난달 YYYY-MM */
export const prevYm = () => { const d = kstNow(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
const ymOk = (ym: unknown) => {
  const s = String(ym ?? '').trim();
  if (!STMT_YM.test(s)) throw new PolicyViolation('HLT_STMT_YM', '정산 달은 YYYY-MM 으로 주십시오.');
  return s;
};

export interface StatementLine { id: string; from: string; to: string; gross: number; fee: number; feeVat: number; refund: number; carriedIn: number; net: number; carriedOut: number; status: string; invoiceState: string; invoiceNo: string | null; items: number }
export interface StatementDoc {
  id: string | null; ym: string; preview: boolean;
  seller: { id: string; code: string; name: string; type: string; bizRegNo: string | null; ceoName: string | null; ecomRegNo: string | null; addr: string | null };
  company: string; weeks: number; gross: number; fee: number; feeVat: number; refund: number; carriedIn: number; net: number; carriedOut: number; paid: number;
  lines: StatementLine[]; madeAt: string | null; remadeAt: string | null; mailState: string; mailedAt: string | null; mailTo: string | null; note: string;
}
export interface StatementJobResult { ym: string | null; skipped: string | null; made: number; mailed: number; failed: number; noAddr: number; off: number }

function docFrom(seller: StatementDoc['seller'], ym: string, c: Record<string, unknown>, row: Record<string, unknown> | null): StatementDoc {
  const lines = ((row ? row.lines : c.lines) as Array<Record<string, unknown>> | undefined ?? []).map((l) => ({
    id: String(l.id ?? ''), from: String(l.from ?? '').slice(0, 10), to: String(l.to ?? '').slice(0, 10), gross: n(l.gross), fee: n(l.fee), feeVat: n(l.feeVat), refund: n(l.refund),
    carriedIn: n(l.carriedIn), net: n(l.net), carriedOut: n(l.carriedOut), status: String(l.status ?? ''), invoiceState: String(l.invoiceState ?? ''),
    invoiceNo: (l.invoiceNo as string | null) ?? null, items: n(l.items) }));
  const src = row ?? c;
  const pick = (rowKey: string, calcKey: string) => n(row ? src[rowKey] : src[calcKey]);
  return {
    id: row ? String(row.id) : null, ym, preview: !row, seller, company: STMT_COMPANY,
    weeks: pick('weeks', 'weeks'), gross: pick('gross_amount', 'gross'), fee: pick('fee_amount', 'fee'), feeVat: pick('fee_vat', 'feeVat'), refund: pick('refund_amount', 'refund'),
    carriedIn: pick('carried_in', 'carriedIn'), net: pick('net_amount', 'net'), carriedOut: pick('carried_out', 'carriedOut'), paid: pick('paid_amount', 'paid'),
    lines, madeAt: (row?.made_at as string) ?? null, remadeAt: (row?.remade_at as string) ?? null,
    mailState: row ? String(row.mail_state) : 'NONE', mailedAt: (row?.mailed_at as string) ?? null, mailTo: (row?.mail_to as string) ?? null,
    note: row ? '주 정산서(월요일 시작)를 시작일이 이 달인 것끼리 모았습니다. 지급은 결제대행사가 판매자 하위가맹점으로 합니다.'
      : '아직 만들지 않은 달이라 지금 기록으로 셈한 미리보기입니다(정기 작업이 매달 만듭니다).',
  };
}

/* ── 판매자(판매자센터) ── */

async function mySeller(db: DatabaseService, me: string | null) {
  const [s] = await db.query<StatementDoc['seller']>(
    `SELECT s.id::text AS id, s.code, s.name, s.type, s.biz_reg_no AS "bizRegNo", s.ceo_name AS "ceoName", s.ecom_reg_no AS "ecomRegNo", coalesce(s.addr, s.return_addr) AS addr FROM hlt_sellers s WHERE s.account_id = $1 AND s.type IN ('TENANT', 'BRAND') AND s.status IN ('ACTIVE', 'PAUSED')`, [me]);
  if (!s) throw new Forbidden('NOT_SELLER', '입점 승인된 판매자만 판매자센터를 쓸 수 있습니다.');
  return s;
}

/** GET /me/health/seller/statements — 만든 정산서 + 주 정산서는 있는데 아직 안 만든 달(미리보기) · 최근 24달 */
export async function myStatements(db: DatabaseService, me: string | null) {
  const s = await mySeller(db, me);
  const rows = await db.query<Record<string, unknown>>(
    `WITH m AS (SELECT DISTINCT to_char(period_from, 'YYYY-MM') AS ym FROM hlt_settlements WHERE seller_id = $1::uuid
                UNION SELECT ym FROM hlt_seller_statements WHERE seller_id = $1::uuid)
     SELECT m.ym, x.id::text AS id, coalesce(x.weeks, 0) AS weeks, x.net_amount AS net, x.paid_amount AS paid, x.mail_state AS "mailState", x.mailed_at AS "mailedAt", (x.id IS NULL) AS preview
       FROM m LEFT JOIN hlt_seller_statements x ON x.seller_id = $1::uuid AND x.ym = m.ym
      ORDER BY m.ym DESC LIMIT 24`, [s.id]);
  return { seller: { code: s.code, name: s.name }, items: rows.map((r) => ({ ...r, weeks: n(r.weeks), net: r.net == null ? null : n(r.net), paid: r.paid == null ? null : n(r.paid) })),
    note: '월 정산서는 주 정산서를 달마다 모은 한 장입니다. 「인쇄 · PDF」에서 PDF 로 저장할 수 있습니다.' };
}

/** GET /me/health/seller/statements/{ym} — 내 그 달 정산서(만든 것 · 없으면 미리보기) */
export async function myStatement(db: DatabaseService, me: string | null, ymIn: string): Promise<StatementDoc> {
  const s = await mySeller(db, me);
  return statementOf(db, s, ymOk(ymIn));
}

async function statementOf(db: DatabaseService, s: StatementDoc['seller'], ym: string): Promise<StatementDoc> {
  const [row] = await db.query<Record<string, unknown>>(`SELECT * FROM hlt_seller_statements WHERE seller_id = $1::uuid AND ym = $2`, [s.id, ym]);
  if (row) return docFrom(s, ym, {}, row);
  const [c] = await db.query<{ c: Record<string, unknown> }>(`SELECT fn_hlt_statement_calc($1::uuid, $2::text) AS c`, [s.id, ym]);
  return docFrom(s, ym, c?.c ?? {}, null);
}

/* ── 운영 › 소개몰 › 판매자 월 정산서 ── */

/** GET /admin/health/statements?ym= — 그 달(없으면 지난달) 입점 판매자별 정산서 · 안 만든 판매자 · 스위치 · 메일 준비 */
export async function statementsView(db: DatabaseService, mail: MailService, ymIn?: string) {
  const ym = ymIn ? ymOk(ymIn) : prevYm();
  const [st] = await db.query<{ sw: string | null; day: string | null }>(
    `SELECT (SELECT value FROM site_settings WHERE key = 'mall.statement_mail') AS sw, (SELECT value FROM site_settings WHERE key = 'mall.statement_day') AS day`);
  const ready = await mail.status().catch(() => ({ ready: false, reason: null }));
  const rows = await db.query<Record<string, unknown>>(
    `WITH sel AS (
       SELECT DISTINCT st.seller_id FROM hlt_settlements st WHERE st.period_from >= ($1::text || '-01')::date AND st.period_from < (($1::text || '-01')::date + interval '1 month')
       UNION SELECT x.seller_id FROM hlt_seller_statements x WHERE x.ym = $1::text)
     SELECT s.id::text AS "sellerId", s.code, s.name, s.type, s.status, x.id::text AS id, (x.id IS NOT NULL) AS made,
            x.weeks, x.gross_amount AS gross, x.fee_amount AS fee, x.fee_vat AS "feeVat", x.refund_amount AS refund, x.net_amount AS net, x.carried_out AS "carriedOut",
            x.paid_amount AS paid, x.mail_state AS "mailState", x.mail_to AS "mailTo", x.mailed_at AS "mailedAt", x.mail_error AS "mailError", x.mail_tries AS "mailTries",
            x.made_at AS "madeAt", x.remade_at AS "remadeAt"
       FROM sel JOIN hlt_sellers s ON s.id = sel.seller_id AND s.type IN ('TENANT', 'BRAND')
       LEFT JOIN hlt_seller_statements x ON x.seller_id = s.id AND x.ym = $1::text
      ORDER BY s.code`, [ym]);
  const num = (v: unknown) => (v == null ? null : n(v));
  const items = rows.map((r): Record<string, unknown> => ({ ...r, weeks: num(r.weeks), gross: num(r.gross), fee: num(r.fee), feeVat: num(r.feeVat), refund: num(r.refund), net: num(r.net),
    carriedOut: num(r.carriedOut), paid: num(r.paid), mailTries: num(r.mailTries) }));
  return {
    ym, mailOn: st?.sw === 'on', day: n(st?.day ?? 5), mailReady: !!ready.ready, mailReason: (ready as { reason?: string | null }).reason ?? null,
    made: items.filter((i) => i.made).length, sent: items.filter((i) => i.mailState === 'SENT').length, items,
    note: st?.sw === 'on' ? `매달 ${n(st?.day ?? 5)}일 09:10 부터 지난달 정산서를 만들고 메일로 한 번 보냅니다(메일 준비됨일 때).`
      : '메일은 꺼져 있습니다(mall.statement_mail) — 정산서 만들기 · 인쇄(PDF 저장)는 됩니다.',
  };
}

/** GET /admin/health/statements/{id} — 한 장(인쇄용) */
export async function statementDetail(db: DatabaseService, id: string): Promise<StatementDoc> {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('월 정산서를 찾을 수 없습니다.');
  const [row] = await db.query<Record<string, unknown>>(`SELECT * FROM hlt_seller_statements WHERE id = $1::bigint`, [id]);
  if (!row) throw new NotFound('월 정산서를 찾을 수 없습니다.');
  const [s] = await db.query<StatementDoc['seller']>(`SELECT s.id::text AS id, s.code, s.name, s.type, s.biz_reg_no AS "bizRegNo", s.ceo_name AS "ceoName", s.ecom_reg_no AS "ecomRegNo", coalesce(s.addr, s.return_addr) AS addr FROM hlt_sellers s WHERE s.id = $1::uuid`, [row.seller_id]);
  return docFrom(s!, String(row.ym), {}, row);
}

/** POST /admin/health/statements/make — 그 달 입점 판매자(주 정산서가 있는) 정산서를 만들거나 다시 셈 · 보낸 것은 건너뜀 · sellerId 를 주면 그 판매자만 */
export async function statementsMake(db: DatabaseService, ymIn: string, sellerId?: string | null) {
  const ym = ymOk(ymIn);
  if (ym > kstNow().toISOString().slice(0, 7)) throw new PolicyViolation('HLT_STMT_FUTURE', '아직 오지 않은 달은 만들 수 없습니다.');
  const sellers = await db.query<{ id: string; sent: boolean }>(
    `SELECT s.id::text AS id, EXISTS (SELECT 1 FROM hlt_seller_statements x WHERE x.seller_id = s.id AND x.ym = $1::text AND x.mail_state = 'SENT') AS sent
       FROM hlt_sellers s
      WHERE s.type IN ('TENANT', 'BRAND') AND ($2::uuid IS NULL OR s.id = $2::uuid)
        AND ($2::uuid IS NOT NULL OR EXISTS (SELECT 1 FROM hlt_settlements st WHERE st.seller_id = s.id AND st.period_from >= ($1::text || '-01')::date AND st.period_from < (($1::text || '-01')::date + interval '1 month')))
      ORDER BY s.code`, [ym, sellerId || null]);
  if (sellerId && !sellers.length) throw new NotFound('입점 판매자를 찾을 수 없습니다.');
  let made = 0, skipped = 0;
  for (const s of sellers) {
    if (s.sent) { skipped++; continue; }
    await db.query(`SELECT fn_hlt_statement_make($1::uuid, $2::text)`, [s.id, ym]);
    made++;
  }
  if (sellerId && skipped) throw new StateConflict('HLT_STMT_SENT', '메일로 보낸 월 정산서는 바꾸지 않습니다(같은 달은 한 번만 보냅니다).');
  return { ok: true, ym, made, skippedSent: skipped, note: `월 정산서 ${made}장을 만들었습니다${skipped ? ` · 이미 보낸 ${skipped}장은 그대로` : ''}.` };
}

function mailText(d: StatementDoc) {
  const w = (v: number) => `${v.toLocaleString('ko-KR')}원`;
  return [
    `${d.seller.name} 님, 소개몰 ${d.ym} 월 정산서입니다.`, '',
    `정산 달: ${d.ym} (주 정산 ${d.weeks}번)`,
    `매출: ${w(d.gross)}`,
    `판매수수료: ${w(d.fee)} (부가세 ${w(d.feeVat)})`,
    `환불 조정: ${w(d.refund)}`,
    `지급액 합계: ${w(d.net)} (지급 끝남 ${w(d.paid)})`,
    `다음 주로 이월: ${w(d.carriedOut)}`, '',
    '주별 명세와 인쇄용 정산서(PDF 저장)는 판매자센터 › 정산 › 월 정산서에서 보실 수 있습니다.',
    `${STMT_LINK}?ym=${d.ym}`, '',
    '이 메일은 같은 달에 한 번만 보냅니다. 지급은 결제대행사가 판매자 하위가맹점으로 합니다.',
    STMT_COMPANY,
  ].join('\n');
}

/**
 * 한 장 보내기 — 다시 셈 → 「보내는 중」 표시(10분) → 보냄 → SENT(그 뒤로 못 바꿈) 또는 FAILED
 *   manual = 운영 「지금 보내기」(막히면 오류) · 정기 작업은 막히면 상태만 남기고 다음 장으로
 */
export async function sendStatement(db: DatabaseService, mail: MailService, id: string, actor: string | null, manual: boolean): Promise<{ ok: boolean; state: string; to: string | null; note: string }> {
  const [x] = await db.query<{ id: string; seller_id: string; ym: string; mail_state: string; weeks: number; email: string | null }>(
    `SELECT x.id::text AS id, x.seller_id::text AS seller_id, x.ym, x.mail_state, x.weeks, a.email::text AS email
       FROM hlt_seller_statements x JOIN hlt_sellers s ON s.id = x.seller_id LEFT JOIN accounts a ON a.id = s.account_id AND a.withdrawn_at IS NULL
      WHERE x.id = $1::bigint`, [id]);
  if (!x) throw new NotFound('월 정산서를 찾을 수 없습니다.');
  if (x.mail_state === 'SENT') throw new StateConflict('HLT_STMT_SENT', '이미 메일로 보낸 월 정산서입니다(같은 달은 한 번만 보냅니다).');
  await db.query(`SELECT fn_hlt_statement_make($1::uuid, $2::text)`, [x.seller_id, x.ym]);
  const doc = await statementDetail(db, x.id);
  if (doc.weeks < 1) {
    if (manual) throw new PolicyViolation('HLT_STMT_EMPTY', '주 정산서가 없는 달이라 보내지 않습니다.');
    return { ok: false, state: x.mail_state, to: null, note: '빈 달' };
  }
  if (!x.email) {
    await db.query(`UPDATE hlt_seller_statements SET mail_state = 'NO_ADDR', mail_error = '판매자 계정 메일 없음' WHERE id = $1::bigint`, [x.id]);
    if (manual) throw new PolicyViolation('HLT_STMT_NO_ADDR', '판매자 계정에 메일 주소가 없습니다 — 인쇄(PDF)로 전달해 주십시오.');
    return { ok: false, state: 'NO_ADDR', to: null, note: '메일 주소 없음' };
  }
  const claim = await db.query<{ id: string }>(
    `UPDATE hlt_seller_statements SET mail_claimed_at = clock_timestamp(), mail_tries = least(mail_tries + 1, 20)
      WHERE id = $1::bigint AND mail_state <> 'SENT' AND (mail_claimed_at IS NULL OR mail_claimed_at < now() - interval '10 minutes') RETURNING id::text AS id`, [x.id]);
  if (!claim.length) throw new StateConflict('HLT_STMT_SENDING', '지금 보내는 중인 월 정산서입니다 — 잠시 뒤 다시 보십시오.');
  const to = maskMail(x.email);
  const r = await mail.send({ to: x.email, subject: `[소개뱅크 소개몰] ${x.ym} 월 정산서 — ${doc.seller.name}`, text: mailText(doc) })
    .catch((e: unknown) => ({ ok: false, error: String((e as Error)?.message ?? e) } as { ok: boolean; error?: string }));
  if (r.ok) {
    await db.query(`UPDATE hlt_seller_statements SET mail_state = 'SENT', mailed_at = clock_timestamp(), mailed_by = $2::uuid, mail_to = $3, mail_error = NULL, mail_claimed_at = NULL WHERE id = $1::bigint`,
      [x.id, actor, to]);
    return { ok: true, state: 'SENT', to, note: `${to} 로 보냈습니다 — 이 달은 다시 보내지 않습니다.` };
  }
  const err = String((r as { error?: string }).error ?? '보내지 못함').slice(0, 200);
  await db.query(`UPDATE hlt_seller_statements SET mail_state = 'FAILED', mail_to = $2, mail_error = $3, mail_claimed_at = NULL WHERE id = $1::bigint`, [x.id, to, err]);
  return { ok: false, state: 'FAILED', to, note: `보내지 못했습니다 — ${err}` };
}

/** POST /admin/health/statements/{id}/mail — 운영 「지금 보내기」(스위치 · 메일 준비 · 같은 달 한 번) */
export async function statementMailNow(db: DatabaseService, mail: MailService, id: string, actor: string | null) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('월 정산서를 찾을 수 없습니다.');
  const [sw] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'mall.statement_mail'`);
  if (sw?.v !== 'on') throw new PolicyViolation('HLT_STMT_MAIL_OFF', '월 정산서 메일이 꺼져 있습니다(mall.statement_mail) — 인쇄(PDF)로 전달하거나 켠 뒤 보내십시오.');
  const st = await mail.status().catch(() => ({ ready: false }));
  if (!st.ready) throw new PolicyViolation('HLT_STMT_MAIL_NOT_READY', '메일 보내기 준비가 되지 않았습니다(알림 › 메일 설정).');
  return sendStatement(db, mail, id, actor, true);
}

/* ── 정기 작업 mall_statement (매일 09:10) ── */

export async function mallStatementJob(db: DatabaseService, mail: MailService): Promise<StatementJobResult> {
  const out: StatementJobResult = { ym: null, skipped: null, made: 0, mailed: 0, failed: 0, noAddr: 0, off: 0 };
  const [st] = await db.query<{ sw: string | null; day: string | null }>(
    `SELECT (SELECT value FROM site_settings WHERE key = 'mall.statement_mail') AS sw, (SELECT value FROM site_settings WHERE key = 'mall.statement_day') AS day`);
  const day = Math.max(1, Math.min(28, Math.floor(n(st?.day ?? 5)) || 5));
  if (kstNow().getUTCDate() < day) { out.skipped = 'BEFORE_DAY'; return out; }
  const ym = prevYm();
  out.ym = ym;
  const mk = await statementsMake(db, ym, null);
  out.made = mk.made;
  const ready = st?.sw === 'on' ? (await mail.status().catch(() => ({ ready: false }))).ready : false;
  if (!ready) {
    const off = await db.query<{ id: string }>(`UPDATE hlt_seller_statements SET mail_state = 'OFF' WHERE ym = $1 AND mail_state = 'NONE' RETURNING id::text AS id`, [ym]);
    out.off = off.length;
    out.skipped = st?.sw === 'on' ? 'MAIL_NOT_READY' : 'MAIL_OFF';
    return out;
  }
  const due = await db.query<{ id: string }>(
    `SELECT id::text AS id FROM hlt_seller_statements WHERE ym = $1 AND mail_state IN ('NONE', 'OFF', 'FAILED') AND mail_tries < 3 AND weeks > 0 ORDER BY id LIMIT 200`, [ym]);
  for (const d of due) {
    try {
      const r = await sendStatement(db, mail, d.id, null, false);
      if (r.ok) out.mailed++; else if (r.state === 'NO_ADDR') out.noAddr++; else if (r.state === 'FAILED') out.failed++;
    } catch {
      out.failed++;
    }
  }
  if (out.failed + out.noAddr > 0) {
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('MALL_STATEMENT_MAIL_FAIL', 'WARN', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
      [`판매자 월 정산서 ${ym} — 메일 ${out.failed}장 실패 · 주소 없음 ${out.noAddr}장 — 소개몰 › 판매자 월 정산서`.slice(0, 300), JSON.stringify({ ym, failed: out.failed, noAddr: out.noAddr, mailed: out.mailed })]);
  }
  return out;
}
