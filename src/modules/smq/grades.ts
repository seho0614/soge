import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { SMQ_KEYS, SMQ_MIN_QNA, SMQ_RULE_PATTERNS, SMQ_YM_RE, SmqRules, smqMySeller, smqNum, smqPrevYm, smqSettings, smqToday, smqYm } from './common';

/* ---------------------------------------------------------------------
 * v10.579 (docs/721) ③ 판매자 평가 · 패널티 — 대표 11/21 · 기준은 일반 초안(SUPER 가 고침) · 스위치 처음 off
 *   셈       DB fn_smq_grade_calc(달, 발송 기한) — 결제 주문 · 배송 지연 · 판매자 사정 취소 · 반품 · 문의 · 문의 답 늦음(읽기만)
 *   판정     여기 한 곳(smqJudge) — 기준 넘은 것(over) · 등급 A · B · C · D · N(표본 부족) · 경고(WARN) · 노출 제한 제안(LIMIT = 잇달아 경고)
 *   저장     smq_seller_grades(달마다 한 줄 · 그때 기준 rules 박음 · 알린 뒤 숫자 고정)
 *   노출     smq_seller_limits — 정기 작업이 제안 → 운영 승인(기간 smq.penalty_limit_days) · 반려 · 풀기 · 기간 끝나면 저절로 풀림
 *            실제로 목록에서 빠지는 것은 smq.penalty_exposure on(SUPER)일 때만(DB 보기 v_smq_exposure_limited · 소개몰 목록 SQL 패치)
 *   ★ 광고 · 노출 분리(INV-11) — 대가(광고비 · 구독)로 순위를 올리거나 내리지 않음 · 품질 기준으로 목록에서 빼는 것만 · 광고 영역은 건드리지 않음 · 기준은 약관 · 화면에 공개
 * ------------------------------------------------------------------- */

export interface CalcRow { sellerId: string; orders: number; lateShip: number; sellerCancels: number; qnaTotal: number; qnaLate: number }
export interface Judged { latePct: number | null; cancelPct: number | null; qnaPct: number | null; over: string[]; grade: 'A' | 'B' | 'C' | 'D' | 'N'; warn: boolean }

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/** 판정 — 주문 기준(지연 · 취소)은 주문이 minOrders 이상일 때만 · 문의 기준은 문의 SMQ_MIN_QNA 건 이상일 때만 · 「넘음」은 기준보다 클 때 */
export function smqJudge(c: CalcRow, r: SmqRules): Judged {
  const byOrders = c.orders >= r.minOrders;
  const byQna = c.qnaTotal >= SMQ_MIN_QNA;
  const latePct = pct(c.lateShip, c.orders), cancelPct = pct(c.sellerCancels, c.orders), qnaPct = pct(c.qnaLate, c.qnaTotal);
  const checks: Array<[string, number | null, number, boolean]> = [
    ['late', latePct, r.latePct, byOrders], ['cancel', cancelPct, r.cancelPct, byOrders], ['qna', qnaPct, r.qnaPct, byQna],
  ];
  const judged = checks.filter(([, v, , use]) => use && v != null);
  const over = judged.filter(([, v, lim]) => (v as number) > lim).map(([k]) => k);
  const half = judged.every(([, v, lim]) => (v as number) <= lim / 2);
  const grade: Judged['grade'] = judged.length === 0 ? 'N' : over.length >= 2 ? 'D' : over.length === 1 ? 'C' : half ? 'A' : 'B';
  return { latePct, cancelPct, qnaPct, over, grade, warn: over.length > 0 };
}

async function calc(db: DatabaseService, ym: string, shipDays: number): Promise<CalcRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT seller_id::text AS "sellerId", orders, late_ship AS "lateShip", seller_cancels AS "sellerCancels", qna_total AS "qnaTotal", qna_late AS "qnaLate"
       FROM fn_smq_grade_calc($1::text, $2::int)`, [ym, shipDays]);
  return rows.map((x) => ({ sellerId: String(x.sellerId), orders: smqNum(x.orders), lateShip: smqNum(x.lateShip), sellerCancels: smqNum(x.sellerCancels),
    qnaTotal: smqNum(x.qnaTotal), qnaLate: smqNum(x.qnaLate) }));
}

/** 잇달아 경고인지 — 앞 (limitMonths − 1)달이 모두 WARN · LIMIT 로 저장돼 있으면 이달 경고는 LIMIT */
async function streak(db: DatabaseService, sellerId: string, ym: string, months: number): Promise<boolean> {
  const need: string[] = [];
  let k = ym;
  for (let i = 1; i < months; i++) { k = smqPrevYm(k); need.push(k); }
  if (!need.length) return true;
  const [r] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM smq_seller_grades WHERE seller_id = $1 AND ym = ANY($2::text[]) AND level IN ('WARN', 'LIMIT')`, [sellerId, need]);
  return (r?.n ?? 0) === need.length;
}

/** 지난달(또는 고른 달) 셈 · 저장 — 알린 줄(notified_at)은 그대로 · 이번 달 · 앞날은 저장하지 않음 */
export async function smqSaveMonth(db: DatabaseService, ym: string) {
  if (!SMQ_YM_RE.test(ym)) throw new PolicyViolation('SMQ_YM', '달은 YYYY-MM 으로 주십시오.');
  if (ym >= smqYm(0)) throw new PolicyViolation('SMQ_YM_OPEN', '끝난 달만 저장합니다 — 이번 달은 미리보기로만 봅니다.');
  const { rules } = await smqSettings(db);
  const rows = await calc(db, ym, rules.shipDays);
  let saved = 0;
  for (const c of rows) {
    const j = smqJudge(c, rules);
    const level = !j.warn ? 'OK' : (await streak(db, c.sellerId, ym, rules.limitMonths)) ? 'LIMIT' : 'WARN';
    const r = await db.query(
      `INSERT INTO smq_seller_grades (seller_id, ym, orders, late_ship, seller_cancels, qna_total, qna_late, late_pct, cancel_pct, qna_pct, grade, level, over_keys, rules, computed_at)
       VALUES ($1, $2, $3::int, $4::int, $5::int, $6::int, $7::int, $8::numeric, $9::numeric, $10::numeric, $11, $12, $13::text[], $14::jsonb, now())
       ON CONFLICT (seller_id, ym) DO UPDATE SET orders = EXCLUDED.orders, late_ship = EXCLUDED.late_ship, seller_cancels = EXCLUDED.seller_cancels,
              qna_total = EXCLUDED.qna_total, qna_late = EXCLUDED.qna_late, late_pct = EXCLUDED.late_pct, cancel_pct = EXCLUDED.cancel_pct, qna_pct = EXCLUDED.qna_pct,
              grade = EXCLUDED.grade, level = EXCLUDED.level, over_keys = EXCLUDED.over_keys, rules = EXCLUDED.rules, computed_at = now()
        WHERE smq_seller_grades.notified_at IS NULL
       RETURNING id`,
      [c.sellerId, ym, c.orders, c.lateShip, c.sellerCancels, c.qnaTotal, c.qnaLate, j.latePct, j.cancelPct, j.qnaPct, j.grade, level, j.over, JSON.stringify(rules)]);
    saved += r.length;
  }
  return { ym, sellers: rows.length, saved };
}

const OVER_KO: Record<string, string> = { late: '배송 지연', cancel: '판매자 사정 취소 · 반품', qna: '문의 답 늦음' };

/** 알림 · 노출 제한 제안 — 저장한 달의 알리지 않은 줄 · 경고 이상만 판매자 알림 · LIMIT 은 제안(PROPOSED) + 운영 알림 */
export async function smqNotifyMonth(db: DatabaseService, ym: string) {
  const rows = await db.query<{ id: string; sellerId: string; level: string; grade: string; over: string[]; name: string }>(
    `UPDATE smq_seller_grades g SET notified_at = now() FROM hlt_sellers s
      WHERE g.ym = $1 AND g.notified_at IS NULL AND s.id = g.seller_id
      RETURNING g.id::text AS id, g.seller_id::text AS "sellerId", g.level, g.grade, g.over_keys AS over, s.name`, [ym]);
  let warned = 0, proposed = 0;
  for (const g of rows) {
    if (g.level === 'OK') continue;
    const what = (g.over ?? []).map((k) => OVER_KO[k] ?? k).join(' · ');
    await db.query(
      `INSERT INTO notifications (account_id, event_code, title, body, link_url)
       SELECT account_id, 'SMQ_SELLER_WARN', $2, $3, '/health/seller/center/grade' FROM hlt_sellers WHERE id = $1 AND account_id IS NOT NULL`,
      [g.sellerId, `${ym} 판매 평가 — 기준을 넘은 항목이 있습니다`, `${what} — 판매자센터 › 판매 평가에서 확인해 주십시오.${g.level === 'LIMIT' ? ' 잇달아 넘어 노출 제한이 검토됩니다.' : ''}`]);
    warned++;
    if (g.level === 'LIMIT') {
      const p = await db.query(
        `INSERT INTO smq_seller_limits (seller_id, grade_id, reason) VALUES ($1, $2::bigint, $3) ON CONFLICT DO NOTHING RETURNING id`,
        [g.sellerId, g.id, `${ym} 평가 ${g.grade} — ${what} 잇달아 넘음`.slice(0, 300)]);
      if (p.length) {
        proposed++;
        await db.query(
          `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
           VALUES ('SMQ_LIMIT_PROPOSED', 'WARN', $1, jsonb_build_object('seller', $2::text, 'ym', $3::text), clock_timestamp())
           ON CONFLICT DO NOTHING`, [`노출 제한 제안 — ${g.name} (${ym}) — 소개몰 › 판매자 평가 · 패널티`.slice(0, 300), g.sellerId, ym]);
      }
    }
  }
  return { ym, notified: rows.length, warned, proposed };
}

/** 기간 끝난 노출 제한 저절로 풀기 */
export async function smqExpireLimits(db: DatabaseService) {
  const r = await db.query(
    `UPDATE smq_seller_limits SET state = 'LIFTED', lifted_at = now(), lift_note = '기간 끝'
      WHERE state = 'ACTIVE' AND until_on < (now() AT TIME ZONE 'Asia/Seoul')::date RETURNING id`);
  return r.length;
}

/* ── 운영 ── */

/** GET /admin/smq/grades?ym= — 끝난 달은 저장한 줄 · 이번 달(또는 저장 전 달)은 미리보기(저장 안 함) · 열린 노출 제한 */
export async function adminGrades(db: DatabaseService, ymIn?: string) {
  const { sw, rules } = await smqSettings(db);
  const ym = SMQ_YM_RE.test(String(ymIn ?? '')) ? String(ymIn) : smqYm(-1);
  const stored = await db.query<Record<string, unknown>>(
    `SELECT g.id::text AS id, g.seller_id::text AS "sellerId", s.code AS "sellerCode", s.name AS "sellerName", s.status AS "sellerStatus",
            g.orders, g.late_ship AS "lateShip", g.seller_cancels AS "sellerCancels", g.qna_total AS "qnaTotal", g.qna_late AS "qnaLate",
            g.late_pct::float AS "latePct", g.cancel_pct::float AS "cancelPct", g.qna_pct::float AS "qnaPct", g.grade, g.level, g.over_keys AS over,
            g.computed_at AS "computedAt", g.notified_at AS "notifiedAt"
       FROM smq_seller_grades g JOIN hlt_sellers s ON s.id = g.seller_id WHERE g.ym = $1
      ORDER BY CASE g.level WHEN 'LIMIT' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END, g.grade DESC, s.name LIMIT 500`, [ym]);
  let items: Array<Record<string, unknown>> = stored;
  const preview = stored.length === 0;
  if (preview) {
    const names = new Map((await db.query<{ id: string; code: string; name: string; status: string }>(
      `SELECT id::text AS id, code, name, status FROM hlt_sellers WHERE type IN ('TENANT', 'BRAND')`)).map((x) => [x.id, x]));
    items = (await calc(db, ym, rules.shipDays)).map((c) => {
      const j = smqJudge(c, rules);
      const s = names.get(c.sellerId);
      return { id: null, sellerId: c.sellerId, sellerCode: s?.code ?? '', sellerName: s?.name ?? '', sellerStatus: s?.status ?? '',
        orders: c.orders, lateShip: c.lateShip, sellerCancels: c.sellerCancels, qnaTotal: c.qnaTotal, qnaLate: c.qnaLate,
        latePct: j.latePct, cancelPct: j.cancelPct, qnaPct: j.qnaPct, grade: j.grade, level: j.warn ? 'WARN' : 'OK', over: j.over, computedAt: null, notifiedAt: null };
    });
  }
  const limits = await db.query<Record<string, unknown>>(
    `SELECT l.id::text AS id, l.seller_id::text AS "sellerId", s.name AS "sellerName", l.state, l.reason, l.from_on::text AS "fromOn", l.until_on::text AS "untilOn",
            l.proposed_at AS "proposedAt", l.decided_at AS "decidedAt", l.decide_note AS "decideNote", l.lifted_at AS "liftedAt", l.lift_note AS "liftNote",
            EXISTS (SELECT 1 FROM v_smq_exposure_limited v WHERE v.seller_id = l.seller_id) AS "inEffect"
       FROM smq_seller_limits l JOIN hlt_sellers s ON s.id = l.seller_id
      WHERE l.state IN ('PROPOSED', 'ACTIVE') OR l.proposed_at > now() - interval '180 days'
      ORDER BY CASE l.state WHEN 'PROPOSED' THEN 0 WHEN 'ACTIVE' THEN 1 ELSE 2 END, l.proposed_at DESC LIMIT 100`);
  return { on: sw.penalty, exposureOn: sw.exposure, rules, minQna: SMQ_MIN_QNA, ym, preview, items, limits,
    note: preview ? `${ym} 은(는) 저장한 평가가 없어 지금 숫자로 미리 셈한 것입니다(저장 · 알림 없음 · 노출 제한 제안은 저장할 때만).`
      : sw.penalty ? '저장한 평가입니다. 알린 뒤에는 숫자가 고정됩니다.' : '평가가 꺼져 있습니다(smq.penalty) — 정기 작업이 저장 · 알림을 하지 않습니다. 「다시 셈」으로 저장만 할 수 있습니다.' };
}

/** POST /admin/smq/grades/recalc { ym } — 끝난 달을 다시 셈해 저장(알린 줄은 그대로 · 알림 · 제안은 정기 작업이 함) */
export async function adminRecalc(db: DatabaseService, ym: string) {
  return smqSaveMonth(db, String(ym ?? '').trim());
}

/** POST /admin/smq/limits/{id}/decide — 승인(오늘부터 기간) · 반려 · 풀기 · 판매자에게 알림 */
export async function adminLimitDecide(db: DatabaseService, id: string, action: 'APPROVE' | 'REJECT' | 'LIFT', note?: string) {
  const memo = (note ?? '').replace(/\s+/g, ' ').trim();
  if (memo.length > 300) throw new PolicyViolation('SMQ_LIMIT_NOTE', '메모는 300자 안으로 적어 주십시오.');
  if ((action === 'REJECT' || action === 'LIFT') && memo.length < 2) throw new PolicyViolation('REASON_REQUIRED', '사유를 적어 주십시오 — 기록에 남습니다.');
  const { sw, rules } = await smqSettings(db);
  return db.transaction(async () => {
    const [l] = await db.query<{ id: string; sellerId: string; state: string }>(
      `SELECT id::text AS id, seller_id::text AS "sellerId", state FROM smq_seller_limits WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!l) throw new NotFound('없는 노출 제한입니다.');
    const me = RequestCtx.actorId();
    if (action === 'APPROVE' || action === 'REJECT') {
      if (l.state !== 'PROPOSED') throw new StateConflict('SMQ_LIMIT_STATE', '제안 상태에서만 승인 · 반려합니다.');
      if (action === 'APPROVE') {
        const from = smqToday();
        await db.query(
          `UPDATE smq_seller_limits SET state = 'ACTIVE', from_on = $2::date, until_on = $2::date + ($3::int - 1), decided_by = $4, decided_at = now(), decide_note = $5
            WHERE id = $1::bigint`, [id, from, rules.limitDays, me, memo || null]);
        await db.query(
          `INSERT INTO notifications (account_id, event_code, title, body, link_url)
           SELECT account_id, 'SMQ_SELLER_LIMIT', '소개몰 노출 제한이 정해졌습니다', $2, '/health/seller/center/grade' FROM hlt_sellers WHERE id = $1 AND account_id IS NOT NULL`,
          [l.sellerId, `오늘부터 ${rules.limitDays}일 동안 상품이 소개몰 목록 · 검색에서 빠질 수 있습니다(상품 상세 · 주문은 그대로). 판매자센터 › 판매 평가에서 사유를 확인해 주십시오.`]);
        return { id, state: 'ACTIVE', inEffect: sw.exposure,
          note: sw.exposure ? `승인했습니다 — 오늘부터 ${rules.limitDays}일 동안 목록 · 검색에서 뺍니다.` : `승인했습니다 — 노출 제한 실제 적용(smq.penalty_exposure)이 꺼져 있어 목록에는 그대로 보입니다.` };
      }
      await db.query(`UPDATE smq_seller_limits SET state = 'REJECTED', decided_by = $2, decided_at = now(), decide_note = $3 WHERE id = $1::bigint`, [id, me, memo]);
      return { id, state: 'REJECTED', inEffect: false, note: '반려했습니다(판매자에게 알리지 않음).' };
    }
    if (l.state !== 'ACTIVE') throw new StateConflict('SMQ_LIMIT_STATE', '적용 중인 노출 제한만 풉니다.');
    await db.query(`UPDATE smq_seller_limits SET state = 'LIFTED', lifted_by = $2, lifted_at = now(), lift_note = $3 WHERE id = $1::bigint`, [id, me, memo]);
    await db.query(
      `INSERT INTO notifications (account_id, event_code, title, body, link_url)
       SELECT account_id, 'SMQ_SELLER_LIMIT', '소개몰 노출 제한이 풀렸습니다', '상품이 다시 소개몰 목록 · 검색에 보입니다.', '/health/seller/center/grade' FROM hlt_sellers WHERE id = $1 AND account_id IS NOT NULL`,
      [l.sellerId]);
    return { id, state: 'LIFTED', inEffect: false, note: '노출 제한을 풀었습니다(판매자에게 알림).' };
  });
}

/** GET /admin/smq/rules — 기준 값 · 스위치 · 무늬 */
export async function adminRules(db: DatabaseService) {
  const { sw, rules } = await smqSettings(db);
  return { switches: sw, rules, minQna: SMQ_MIN_QNA,
    keys: Object.keys(SMQ_RULE_PATTERNS),
    note: '일반 초안 값입니다(대표 · 법무 확인 전). 기준 값 · 노출 제한 실제 적용은 최고 관리자(SUPER)만 바꿉니다. 바뀐 기준은 다음 셈부터 — 저장한 평가에는 그때 기준이 남습니다.' };
}

/** PUT /admin/smq/rules — 기준 값 고치기(SUPER · 컨트롤러 @Roles) · 보낸 칸만 · 무늬는 DB value_pattern 과 같음 */
export async function adminRulesSave(db: DatabaseService, dto: Record<string, unknown>) {
  const MAP: Record<string, string> = {
    latePct: SMQ_KEYS.latePct, cancelPct: SMQ_KEYS.cancelPct, qnaPct: SMQ_KEYS.qnaPct, minOrders: SMQ_KEYS.minOrders,
    shipDays: SMQ_KEYS.shipDays, limitMonths: SMQ_KEYS.limitMonths, limitDays: SMQ_KEYS.limitDays, qnaDueHours: SMQ_KEYS.qnaDueHours,
  };
  const set: Array<[string, string]> = [];
  for (const [f, key] of Object.entries(MAP)) {
    const v = dto[f];
    if (v === undefined || v === null) continue;   // 규칙 11 — 안 보낸 칸은 그대로
    const s = String(v).trim();
    if (!SMQ_RULE_PATTERNS[key]!.re.test(s)) throw new PolicyViolation('SMQ_RULE_RANGE', '기준 값이 범위를 벗어났습니다 — 화면의 범위 안으로 적어 주십시오.');
    set.push([key, s]);
  }
  if (dto.exposure !== undefined && dto.exposure !== null) set.push([SMQ_KEYS.exposure, dto.exposure === true ? 'on' : 'off']);
  if (!set.length) throw new PolicyViolation('SMQ_RULE_EMPTY', '바꿀 값이 없습니다.');
  await db.transaction(async () => {
    for (const [k, v] of set) {
      await db.query(`UPDATE site_settings SET value = $1, updated_by = $2, updated_at = now() WHERE key = $3`, [v, RequestCtx.actorId(), k]);
    }
  });
  return { ...(await adminRules(db)), changed: set.map(([k]) => k) };
}

/* ── 판매자센터 ── */

/** GET /me/health/seller/grade — 내 최근 6달 평가 · 이번 달 미리보기 · 열린 노출 제한 · 기준(공개) */
export async function sellerGrade(db: DatabaseService) {
  const s = await smqMySeller(db);
  const { sw, rules } = await smqSettings(db);
  const months = await db.query<Record<string, unknown>>(
    `SELECT ym, orders, late_ship AS "lateShip", seller_cancels AS "sellerCancels", qna_total AS "qnaTotal", qna_late AS "qnaLate",
            late_pct::float AS "latePct", cancel_pct::float AS "cancelPct", qna_pct::float AS "qnaPct", grade, level, over_keys AS over
       FROM smq_seller_grades WHERE seller_id = $1 AND notified_at IS NOT NULL ORDER BY ym DESC LIMIT 6`, [s.id]);
  const ym = smqYm(0);
  const cur = (await calc(db, ym, rules.shipDays)).find((c) => c.sellerId === s.id) ?? { sellerId: s.id, orders: 0, lateShip: 0, sellerCancels: 0, qnaTotal: 0, qnaLate: 0 };
  const j = smqJudge(cur, rules);
  const [lim] = await db.query<Record<string, unknown>>(
    `SELECT state, reason, from_on::text AS "fromOn", until_on::text AS "untilOn",
            EXISTS (SELECT 1 FROM v_smq_exposure_limited v WHERE v.seller_id = l.seller_id) AS "inEffect"
       FROM smq_seller_limits l WHERE l.seller_id = $1 AND l.state = 'ACTIVE' ORDER BY l.decided_at DESC LIMIT 1`, [s.id]);
  return { on: sw.penalty, seller: { code: s.code, name: s.name }, rules, minQna: SMQ_MIN_QNA, months,
    current: { ym, ...cur, latePct: j.latePct, cancelPct: j.cancelPct, qnaPct: j.qnaPct, grade: j.grade, over: j.over },
    limit: lim ?? null,
    note: sw.penalty ? '매달 3일 무렵 지난달 평가를 알려 드립니다. 기준을 잇달아 넘으면 운영 검토 뒤 소개몰 목록 노출이 잠시 제한될 수 있습니다(상품 상세 · 주문은 그대로).'
      : '판매 평가는 아직 시행 전입니다 — 아래 숫자는 참고용 미리보기입니다.' };
}
