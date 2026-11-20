import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { maskEmail } from '../../common/mask';

/* ---------------------------------------------------------------------
 * v10.510 (D275 · docs/648) 이상 거래 점수 — 대표 11/20 「㊺ ②」
 *
 *   규칙(opx_risk_rules): 계산식은 여기 코드(규칙 코드별 SQL · 값은 $n) · 점수 · 기준값 · 켜기만 SUPER 가 고침
 *   셈: 매물 등록 · 신고 접수 때 DB 트리거가 계정을 표시(opx_risk_dirty) → 5분마다 opx_risk_events · 매일 04:50 opx_risk_daily(최근 계정) · 운영 「다시 셈」
 *   점수 = 맞은 규칙 점수 합(최대 100) · 까닭(규칙 · 점수 · 값) → opx_risk_scores
 *   기준(opx.risk_threshold 처음 60) 이상이고 열린 검수 대기가 없으면: 검수 대기(opx_risk_cases) + 위험감지 경보(RSK-OPX) + 운영 알림 OPX_RISK_HIGH
 *   운영 역할 계정 · 탈퇴 계정은 세지 않음 · 회원 화면 · 회원 API 에는 점수를 내보내지 않음(이 파일은 /admin/opx 에서만 부름)
 * ------------------------------------------------------------------- */

const STAFF = ['ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'];
const n = (v: unknown) => Number(v ?? 0);
const uuidOk = (s?: string) => typeof s === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s);

/** 규칙 코드 → (계정 목록 $1 · 기준값 $2) 맞는 계정과 값 */
const RULE_SQL: Record<string, string> = {
  NEW_ACCOUNT: `SELECT id AS acc, (now()::date - created_at::date)::int AS v FROM accounts WHERE id = ANY($1::uuid[]) AND created_at > now() - make_interval(days => $2::int)`,
  LISTING_BURST: `SELECT owner_account_id AS acc, count(*)::int AS v FROM listings WHERE owner_account_id = ANY($1::uuid[]) AND created_at > now() - interval '24 hours'
                   GROUP BY owner_account_id HAVING count(*) >= $2::int`,
  SAME_PHONE: `SELECT a.id AS acc, count(DISTINCT b.id)::int AS v FROM accounts a
                 JOIN accounts b ON b.id <> a.id AND b.phone IS NOT NULL AND b.status <> 'WITHDRAWN' AND regexp_replace(b.phone, '[^0-9]', '', 'g') = regexp_replace(a.phone, '[^0-9]', '', 'g')
                WHERE a.id = ANY($1::uuid[]) AND a.phone IS NOT NULL AND length(regexp_replace(a.phone, '[^0-9]', '', 'g')) >= 9
                GROUP BY a.id HAVING count(DISTINCT b.id) >= $2::int`,
  REPORTED: `WITH t AS (SELECT CASE WHEN r.target_type = 'PROFILE' THEN r.target_id WHEN r.target_type = 'LISTING' THEN (SELECT l.owner_account_id FROM listings l WHERE l.id = r.target_id) END AS acc
                         FROM reports r WHERE r.created_at > now() - interval '90 days' AND r.state <> 'DISMISSED')
             SELECT acc, count(*)::int AS v FROM t WHERE acc = ANY($1::uuid[]) GROUP BY acc HAVING count(*) >= $2::int`,
  REPORT_UPHELD: `WITH t AS (SELECT CASE WHEN r.target_type = 'PROFILE' THEN r.target_id WHEN r.target_type = 'LISTING' THEN (SELECT l.owner_account_id FROM listings l WHERE l.id = r.target_id) END AS acc
                              FROM reports r WHERE r.created_at > now() - interval '180 days' AND r.state = 'UPHELD')
                  SELECT acc, count(*)::int AS v FROM t WHERE acc = ANY($1::uuid[]) GROUP BY acc HAVING count(*) >= $2::int`,
  BLOCK_NEAR: `SELECT a.id AS acc, 1 AS v FROM accounts a WHERE a.id = ANY($1::uuid[]) AND EXISTS (
                 SELECT 1 FROM signup_blocks s WHERE s.kind = 'EMAIL_DOMAIN' AND (s.removed_at IS NULL OR s.removed_at > now() - make_interval(days => $2::int))
                    AND (lower(split_part(a.email::text, '@', 2)) = s.value OR lower(split_part(a.email::text, '@', 2)) LIKE '%.' || s.value))`,
  REVIEW_REJECTED: `SELECT submitted_by AS acc, count(*)::int AS v FROM review_items WHERE submitted_by = ANY($1::uuid[]) AND status = 'REJECTED' AND decided_at > now() - interval '30 days'
                     GROUP BY submitted_by HAVING count(*) >= $2::int`,
  WAS_SUSPENDED: `SELECT account_id AS acc, count(*)::int AS v FROM account_status_changes WHERE account_id = ANY($1::uuid[]) AND to_status = 'SUSPENDED' AND changed_at > now() - make_interval(days => $2::int)
                   GROUP BY account_id`,
  NO_IDENTITY: `SELECT a.id AS acc, count(l.id)::int AS v FROM accounts a JOIN listings l ON l.owner_account_id = a.id AND l.status <> 'DRAFT'
                 WHERE a.id = ANY($1::uuid[]) AND a.identity_verified_at IS NULL GROUP BY a.id HAVING count(l.id) >= $2::int`,
};
export const RISK_RULE_CODES = Object.keys(RULE_SQL);

export interface RiskRuleRow { code: string; name: string; param: number; points: number }
export interface RiskReason { code: string; name: string; points: number; value: number }

async function riskOn(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key IN ('opx.risk_score', 'opx.risk_threshold')`);
  const g = (k: string) => rows.find((r) => r.key === k)?.value ?? '';
  const th = Number(g('opx.risk_threshold'));
  return { on: g('opx.risk_score') === 'on', threshold: th >= 1 && th <= 100 ? th : 60 };
}

/** 계정 목록 점수 셈 · 저장 · 기준 넘으면 검수 대기 */
export async function computeScores(db: DatabaseService, idsIn: string[], via: 'EVENT' | 'SWEEP' | 'MANUAL') {
  const { threshold } = await riskOn(db);
  const ids = (await db.query<{ id: string }>(
    `SELECT a.id::text AS id FROM accounts a WHERE a.id = ANY($1::uuid[]) AND a.status <> 'WITHDRAWN'
        AND NOT EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = a.id AND r.role = ANY($2::text[]))`, [idsIn.filter(uuidOk), STAFF])).map((r) => r.id);
  if (!ids.length) return { scored: 0, opened: 0 };
  const rules = await db.query<RiskRuleRow>(`SELECT code, name, param, points FROM opx_risk_rules WHERE is_active AND points > 0 ORDER BY sort, code`);
  const hit = new Map<string, RiskReason[]>();
  for (const r of rules) {
    const q = RULE_SQL[r.code];
    if (!q) continue;
    const rows = await db.query<{ acc: string; v: number }>(q, [ids, r.param]);
    for (const x of rows) { const k = String(x.acc); const l = hit.get(k) ?? []; l.push({ code: r.code, name: r.name, points: n(r.points), value: n(x.v) }); hit.set(k, l); }
  }
  let opened = 0;
  for (const id of ids) {
    const reasons = hit.get(id) ?? [];
    const score = Math.min(100, reasons.reduce((a, r) => a + r.points, 0));
    await db.query(
      `INSERT INTO opx_risk_scores (account_id, score, reasons, via, computed_at) VALUES ($1::uuid, $2::int, $3::jsonb, $4, clock_timestamp())
       ON CONFLICT (account_id) DO UPDATE SET score = EXCLUDED.score, reasons = EXCLUDED.reasons, via = EXCLUDED.via, computed_at = EXCLUDED.computed_at`,
      [id, score, JSON.stringify(reasons), via]);
    if (score >= threshold) {
      const made = await db.transaction(async () => {
        const [c] = await db.query<{ id: string }>(
          `INSERT INTO opx_risk_cases (account_id, score, reasons) SELECT $1::uuid, $2::int, $3::jsonb
            WHERE NOT EXISTS (SELECT 1 FROM opx_risk_cases WHERE account_id = $1::uuid AND state = 'OPEN')
           ON CONFLICT DO NOTHING RETURNING id::text AS id`, [id, score, JSON.stringify(reasons)]);
        if (!c) return false;
        const [a] = await db.query<{ email: string }>(`SELECT email::text AS email FROM accounts WHERE id = $1::uuid`, [id]);
        const why = reasons.map((r) => `${r.name} +${r.points}`).join(' · ');
        await db.query(
          `INSERT INTO risk_alerts (rule_code, severity, subject, detail, reason, action)
           SELECT 'RSK-OPX', 'MEDIUM', $1, $2, $3, $4
            WHERE NOT EXISTS (SELECT 1 FROM risk_alerts WHERE rule_code = 'RSK-OPX' AND subject = $1 AND state IN ('OPEN', 'REVIEWING'))`,   // 자동 탐지(fn_risk_scan)와 같은 subject — 두 번 안 들어감
          [`opx_case:${c.id}`, `이상 거래 점수 ${score}(기준 ${threshold}) — 검수 대기 #${c.id}`, why.slice(0, 500), '위험감지 › 이상 거래 점수에서 확인']);
        await db.query(
          `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('OPX_RISK_HIGH', 'WARN', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
          [`이상 거래 점수 ${score} — 검수 대기 #${c.id}(위험감지 › 이상 거래 점수)`, JSON.stringify({ caseId: c.id, score, threshold, rules: reasons.map((r) => r.code) })]);
        return true;
      });
      if (made) opened++;
    }
  }
  return { scored: ids.length, opened };
}

/** 정기 작업 opx_risk_events(5분) — 표시된 계정 200개까지 */
export async function riskEventsJob(db: DatabaseService) {
  const o = await riskOn(db);
  if (!o.on) return { skipped: 'OFF', scored: 0, opened: 0 };
  const rows = await db.query<{ account_id: string }>(
    `DELETE FROM opx_risk_dirty WHERE account_id IN (SELECT account_id FROM opx_risk_dirty ORDER BY at LIMIT 200) RETURNING account_id::text AS account_id`);
  return computeScores(db, rows.map((r) => r.account_id), 'EVENT');
}

/** 정기 작업 opx_risk_daily(04:50) — 최근 30일 가입 · 7일 매물 · 30일 신고 계정 · 열린 검수 대기 계정 */
export async function riskDailyJob(db: DatabaseService) {
  const o = await riskOn(db);
  if (!o.on) return { skipped: 'OFF', scored: 0, opened: 0 };
  const ids = (await db.query<{ id: string }>(
    `SELECT id::text AS id FROM accounts WHERE created_at > now() - interval '30 days' AND status <> 'WITHDRAWN'
     UNION SELECT DISTINCT owner_account_id::text FROM listings WHERE created_at > now() - interval '7 days'
     UNION SELECT DISTINCT target_id::text FROM reports WHERE target_type = 'PROFILE' AND created_at > now() - interval '30 days'
     UNION SELECT DISTINCT l.owner_account_id::text FROM reports r JOIN listings l ON l.id = r.target_id WHERE r.target_type = 'LISTING' AND r.created_at > now() - interval '30 days'
     LIMIT 3000`)).map((r) => r.id);
  let scored = 0, opened = 0;
  for (let i = 0; i < ids.length; i += 500) { const r = await computeScores(db, ids.slice(i, i + 500), 'SWEEP'); scored += r.scored; opened += r.opened; }
  return { scored, opened, candidates: ids.length };
}

/* ── 운영 화면 ── */
export async function listRules(db: DatabaseService) {
  const rules = await db.query(`SELECT code, name, description, param, param_label AS "paramLabel", points, is_active AS "active", sort, updated_at AS "updatedAt" FROM opx_risk_rules ORDER BY sort, code`);
  return { rules, ...(await riskOn(db)), note: '계산식은 서버 코드 · 점수(0 ~ 100) · 기준값 · 켜기만 최고 관리자(SUPER)가 고칩니다. 점수는 회원에게 보이지 않습니다.' };
}

export async function editRule(db: DatabaseService, code: string, v: { points?: number; param?: number; active?: boolean }, actor: string | null) {
  if (!RISK_RULE_CODES.includes(code)) throw new NotFound('없는 규칙입니다.');
  const [cur] = await db.query<{ points: number; param: number; active: boolean }>(`SELECT points, param, is_active AS active FROM opx_risk_rules WHERE code = $1 FOR UPDATE`, [code]);
  if (!cur) throw new NotFound('없는 규칙입니다.');
  const points = v.points !== undefined ? v.points : cur.points;
  const param = v.param !== undefined ? v.param : cur.param;
  const active = v.active !== undefined ? v.active : cur.active;
  if (!(Number.isInteger(points) && points >= 0 && points <= 100)) throw new PolicyViolation('OPX_RISK_POINTS', '점수는 0 ~ 100 입니다.');
  if (!(Number.isInteger(param) && param >= 1 && param <= 3650)) throw new PolicyViolation('OPX_RISK_PARAM', '기준값은 1 ~ 3650 입니다.');
  await db.query(`UPDATE opx_risk_rules SET points = $2::int, param = $3::int, is_active = $4, updated_by = $5, updated_at = now() WHERE code = $1`, [code, points, param, active, actor]);
  return { ok: true, code, before: { points: n(cur.points), param: n(cur.param), active: cur.active }, after: { points, param, active } };
}

export async function listScores(db: DatabaseService, min: number) {
  const m = Number.isInteger(min) && min >= 0 && min <= 100 ? min : 1;
  const rows = await db.query<{ id: string; email: string; status: string; score: number; reasons: RiskReason[]; via: string; computedAt: string; open: boolean }>(
    `SELECT s.account_id::text AS id, a.email::text AS email, a.status, s.score, s.reasons, s.via, s.computed_at AS "computedAt",
            EXISTS (SELECT 1 FROM opx_risk_cases c WHERE c.account_id = s.account_id AND c.state = 'OPEN') AS open
       FROM opx_risk_scores s JOIN accounts a ON a.id = s.account_id WHERE s.score >= $1::int ORDER BY s.score DESC, s.computed_at DESC LIMIT 200`, [m]);
  const [c] = await db.query<{ total: number; high: number; open: number }>(
    `SELECT (SELECT count(*)::int FROM opx_risk_scores) AS total, (SELECT count(*)::int FROM opx_risk_scores WHERE score >= $1::int) AS high,
            (SELECT count(*)::int FROM opx_risk_cases WHERE state = 'OPEN') AS open`, [(await riskOn(db)).threshold]);
  return { items: rows.map((r) => ({ ...r, email: maskEmail(r.email), score: n(r.score) })), counts: { total: n(c?.total), high: n(c?.high), open: n(c?.open) } };
}

export async function listCases(db: DatabaseService, state?: string) {
  const st = ['OPEN', 'CLEARED', 'ACTIONED'].includes(state ?? '') ? state! : 'OPEN';
  const rows = await db.query<{ id: string; accountId: string; email: string; status: string; score: number; reasons: RiskReason[]; state: string; openedAt: string; decidedAt: string | null; note: string | null; decidedBy: string | null }>(
    `SELECT c.id::text AS id, c.account_id::text AS "accountId", a.email::text AS email, a.status, c.score, c.reasons, c.state, c.opened_at AS "openedAt", c.decided_at AS "decidedAt", c.note,
            d.email::text AS "decidedBy"
       FROM opx_risk_cases c JOIN accounts a ON a.id = c.account_id LEFT JOIN accounts d ON d.id = c.decided_by
      WHERE c.state = $1 ORDER BY c.opened_at DESC LIMIT 200`, [st]);
  return { state: st, items: rows.map((r) => ({ ...r, email: maskEmail(r.email), decidedBy: maskEmail(r.decidedBy), score: n(r.score) })) };
}

export async function decideCase(db: DatabaseService, id: string, result: string, note: string, actor: string | null) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 검수 대기입니다.');
  if (!['CLEARED', 'ACTIONED'].includes(result)) throw new PolicyViolation('OPX_RISK_RESULT', '문제없음 또는 조치함을 고르십시오.');
  const t = String(note ?? '').trim();
  if (t.length < 2 || t.length > 300) throw new PolicyViolation('OPX_RISK_NOTE', '판단 사유를 2 ~ 300자로 적으십시오.');
  return db.transaction(async () => {
    const [c] = await db.query<{ state: string }>(`SELECT state FROM opx_risk_cases WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!c) throw new NotFound('없는 검수 대기입니다.');
    if (c.state !== 'OPEN') throw new StateConflict('OPX_RISK_DECIDED', '이미 끝낸 검수 대기입니다.');
    await db.query(`UPDATE opx_risk_cases SET state = $2, note = $3, decided_by = $4, decided_at = now() WHERE id = $1::bigint`, [id, result, t, actor]);
    return { ok: true, id, state: result };
  });
}

export async function recompute(db: DatabaseService, accountId: string) {
  if (!uuidOk(accountId)) throw new NotFound('없는 회원입니다.');
  const [a] = await db.query(`SELECT 1 FROM accounts WHERE id = $1::uuid`, [accountId]);
  if (!a) throw new NotFound('없는 회원입니다.');
  const r = await computeScores(db, [accountId], 'MANUAL');
  const [s] = await db.query<{ score: number; reasons: RiskReason[] }>(`SELECT score, reasons FROM opx_risk_scores WHERE account_id = $1::uuid`, [accountId]);
  return { ...r, score: s ? n(s.score) : null, reasons: s?.reasons ?? [], note: r.scored ? '다시 셌습니다.' : '운영 역할 · 탈퇴 계정은 세지 않습니다.' };
}
