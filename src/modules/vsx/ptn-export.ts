import { DatabaseService } from '../../db/database.service';
import { AppError, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { EXPORT_DAILY_MAX } from '../admin/export-approval';
import { PartnerActorService } from '../partner/partner-actor.service';
import { vsxSettings } from './vsx-settings';

/* ---------------------------------------------------------------------
 * v10.544 (D284 · docs/682) 파트너 자료 내려받기 — 대표 11/20 「(54) ③ 파트너 자료 내려받기」
 *
 *   파트너센터 › 실적 · 등급 › 자료 내려받기(/partner/export) — 대표 · 정산 권한 직원만(canMoney)
 *   ① 리드 CSV  — 내려받기 승인(D238 export_requests · 대상 PTN_LEADS)
 *                 파트너가 사유를 적어 요청 → 다른 SUPER 가 위험감지 › 감사 › 「내려받기 승인」에서 승인 → 24시간 안 한 번(@ExportGate)
 *                 칸: 배정 번호 · 배정 · 열람 시각 · 상태 · 시 · 구 · 업종 · 급함 · 요약(전화 · 메일 · 긴 숫자 가림) · 이용료 상태 · 금액
 *                 연락처 칸 없음(leads.contact_enc 는 읽지 않음 — 열람은 파트너센터 › 리드 한 길)
 *   ② 성과 CSV  — 달마다 받은 리드 · 열람 · 1시간 안 열람 · 이용료 확정(숫자만 · 개인정보 없음) — 승인 없이 기록만
 *   받을 때마다 ptn_export_logs(쌓기만) + 감사(PTN_EXPORT_LEADS · PTN_EXPORT_PERF · 줄 수 · 기간 · 원문 없음)
 *   스위치 ptn.export_enabled 처음 off · 리드 CSV 한 번 ptn.export_max_rows 줄까지 · 기간 366일까지
 * ------------------------------------------------------------------- */

const DATE_RE = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const notPartner = () => new StateConflict('NOT_PARTNER', '파트너 계정이 아닙니다.');
const off = () => new StateConflict('PTN_EXPORT_OFF', '파트너 자료 내려받기가 꺼져 있습니다.');

/** 요약의 개인정보 모양 가림 — 메일 · 전화(7자리 넘는 숫자 · 하이픈 섞임) */
export function maskSummary(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[메일 가림]')
    .replace(/(?:\+?82[-\s]?)?0?1[016789][-\s.]?[0-9]{3,4}[-\s.]?[0-9]{4}/g, '[전화 가림]')
    .replace(/[0-9][0-9\-\s.]{6,}[0-9]/g, '[숫자 가림]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 300);
}
const cell = (v: unknown) => {
  const t = v == null ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;   // 엑셀 수식 끼워 넣기 막음
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csvOf = (head: string[], rows: unknown[][]) => '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function partnerOf(actors: PartnerActorService, me: string | null) {
  if (!me) throw notPartner();
  const p = await actors.forMember(me);
  if (!p || !['ACTIVE', 'SUSPENDED'].includes(p.status)) throw notPartner();
  return p;
}

function audit(db: DatabaseService, action: string, data: Record<string, unknown>) {
  const c = RequestCtx.get();
  return db.query(
    `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, after_data, ip, user_agent) VALUES ($1, $2, $3, 'PARTNER', $4::jsonb, $5, $6)`,
    [c?.actorId ?? null, c?.actorRole ?? null, action, JSON.stringify(data), c?.ip ?? null, c?.userAgent ?? null]).catch(() => undefined);
}

function rangeOf(fromIn?: string, toIn?: string): [string, string] {
  const today = ymd(new Date(Date.now() + 9 * 3600e3));
  const to = toIn ? String(toIn) : today;
  const from = fromIn ? String(fromIn) : ymd(new Date(Date.parse(`${to}T00:00:00Z`) - 89 * 86400e3));
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new PolicyViolation('PTN_EXPORT_RANGE', '기간은 YYYY-MM-DD 입니다.');
  if (from > to || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 365 * 86400e3) throw new PolicyViolation('PTN_EXPORT_RANGE', '기간은 366일까지입니다(시작 ≤ 끝).');
  return [from, to];
}

/** 파트너센터 화면 — 스위치 · 권한 · 승인 상태 · 최근 기록 20 */
export async function ptnExportStatus(db: DatabaseService, actors: PartnerActorService, me: string | null) {
  const p = await partnerOf(actors, me);
  const s = await vsxSettings(db);
  const [t] = await db.query<{ id: string; state: string; until: string | null }>(
    `SELECT id::text AS id, state, CASE WHEN state = 'APPROVED' THEN decided_at + interval '24 hours' END AS until FROM export_requests
      WHERE requested_by = $1 AND target = 'PTN_LEADS' AND (state = 'PENDING' OR (state = 'APPROVED' AND used_at IS NULL AND decided_at > now() - interval '24 hours'))
      ORDER BY (state = 'APPROVED') DESC, id DESC LIMIT 1`, [me]);
  const logs = await db.query(
    `SELECT kind, rows_n AS rows, range_from AS "from", range_to AS "to", at, (account_id = $2) AS mine FROM ptn_export_logs WHERE partner_id = $1 ORDER BY id DESC LIMIT 20`, [p.id, me]);
  return { enabled: s.exportOn, canExport: p.isOwner || p.canMoney, company: p.company, maxRows: s.exportMaxRows,
    ticket: t?.state === 'APPROVED' ? t.id : null, pending: t?.state === 'PENDING' ? t.id : null, until: t?.until ?? null, logs,
    note: '리드 CSV 는 승인 뒤 24시간 안 한 번 · 연락처 칸은 없습니다(파트너센터 › 리드에서 열람).' };
}

/** 리드 CSV 승인 요청 — export_requests 에 파트너 계정 이름으로 한 줄(승인은 SUPER) */
export async function ptnExportRequest(db: DatabaseService, actors: PartnerActorService, me: string | null, reasonIn: string) {
  const s = await vsxSettings(db);
  if (!s.exportOn) throw off();
  const p = await partnerOf(actors, me);
  if (!(p.isOwner || p.canMoney)) throw new AppError(403, { code: 'PTN_EXPORT_ROLE', message: '대표 또는 정산 권한 직원만 내려받습니다.' });
  const why = String(reasonIn ?? '').replace(/\s+/g, ' ').trim();
  if (why.length < 2 || why.length > 150) throw new PolicyViolation('EXPORT_REASON', '사유는 2 ~ 150자입니다.');
  const [open] = await db.query<{ id: string; state: string }>(
    `SELECT id::text AS id, state FROM export_requests WHERE requested_by = $1 AND target = 'PTN_LEADS'
        AND (state = 'PENDING' OR (state = 'APPROVED' AND used_at IS NULL AND decided_at > now() - interval '24 hours')) ORDER BY id DESC LIMIT 1`, [me]);
  if (open) return { ok: true, id: open.id, state: open.state, existing: true, note: open.state === 'APPROVED' ? '이미 승인된 요청이 있습니다 — 바로 내려받을 수 있습니다.' : '승인을 기다리는 요청이 있습니다.' };
  const [d] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM export_requests WHERE requested_by = $1 AND requested_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`, [me]);
  if (Number(d?.n ?? 0) >= EXPORT_DAILY_MAX) throw new PolicyViolation('EXPORT_DAILY_LIMIT', `내려받기 요청은 하루 ${EXPORT_DAILY_MAX}건까지입니다.`);
  const reason = `[파트너 ${p.company.slice(0, 30)}] ${why}`.slice(0, 200);
  const [r] = await db.query<{ id: string }>(`INSERT INTO export_requests (target, reason, requested_by) VALUES ('PTN_LEADS', $1, $2) RETURNING id::text AS id`, [reason, me]);
  await db.query(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('PTN_EXPORT_REQUEST', 'INFO', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
    [`파트너 리드 내려받기 승인 요청 — ${p.company.slice(0, 30)} · 위험감지 › 감사 › 내려받기 승인`, JSON.stringify({ request: r!.id, partner: p.id })]).catch(() => undefined);
  await audit(db, 'PTN_EXPORT_REQUEST', { partner: p.id, request: r!.id });
  return { ok: true, id: r!.id, state: 'PENDING', existing: false, note: '승인을 요청했습니다 — 소개뱅크 담당자가 승인하면 24시간 안 한 번 내려받을 수 있습니다.' };
}

/** 리드 CSV — 컨트롤러의 @ExportGate('PTN_LEADS') 가 승인 번호를 먼저 확인 · 성공하면 쓴 것으로 */
export async function ptnExportLeads(db: DatabaseService, actors: PartnerActorService, me: string | null, ticket: string, fromIn?: string, toIn?: string) {
  const s = await vsxSettings(db);
  if (!s.exportOn) throw off();
  const p = await partnerOf(actors, me);
  if (!(p.isOwner || p.canMoney)) throw new AppError(403, { code: 'PTN_EXPORT_ROLE', message: '대표 또는 정산 권한 직원만 내려받습니다.' });
  const [from, to] = rangeOf(fromIn, toIn);
  const rows = await db.query<Record<string, unknown>>(
    `SELECT d.id::text AS id, d.delivered_at AS "deliveredAt", d.viewed_at AS "viewedAt", d.state, l.sido, l.sigungu, c.name AS category, l.is_urgent AS urgent,
            l.summary, f.state AS "feeState", f.amount AS "feeAmount"
       FROM lead_deliveries d JOIN leads l ON l.id = d.lead_id LEFT JOIN categories c ON c.id = l.category_id
       LEFT JOIN lead_fees f ON f.delivery_id = d.id
      WHERE d.partner_id = $1 AND d.state <> 'REVOKED'
        AND d.delivered_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Seoul') AND d.delivered_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul')
      ORDER BY d.delivered_at DESC LIMIT $4::int`, [p.id, from, to, s.exportMaxRows]);
  const t = (v: unknown) => (v ? new Date(new Date(String(v)).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '');
  const csv = csvOf(['배정 번호', '배정 시각', '열람 시각', '상태', '시 · 도', '시 · 군 · 구', '업종', '급함', '요약(개인정보 가림)', '이용료 상태', '이용료(원)'],
    rows.map((r) => [r.id, t(r.deliveredAt), t(r.viewedAt), r.state, r.sido, r.sigungu, r.category, r.urgent ? 'Y' : 'N', maskSummary(r.summary as string), r.feeState ?? '', r.feeAmount ?? '']));
  await db.query(`INSERT INTO ptn_export_logs (partner_id, account_id, kind, rows_n, range_from, range_to, ticket_id) VALUES ($1, $2, 'LEADS', $3::int, $4::date, $5::date, $6::bigint)`,
    [p.id, me, rows.length, from, to, Number(ticket)]);
  await audit(db, 'PTN_EXPORT_LEADS', { partner: p.id, rows: rows.length, from, to, ticket: String(ticket) });
  return { filename: `leads_${from}_${to}.csv`, csv, rows: rows.length, truncated: rows.length >= s.exportMaxRows,
    note: rows.length >= s.exportMaxRows ? `최대 ${s.exportMaxRows}줄까지만 담았습니다 — 기간을 나눠 받으십시오.` : '연락처 칸은 없습니다 · 요약의 전화 · 메일 모양은 가렸습니다.' };
}

/** 성과 CSV — 달마다(최근 12개월 · 한국 시각) 숫자만 */
export async function ptnExportPerf(db: DatabaseService, actors: PartnerActorService, me: string | null) {
  const s = await vsxSettings(db);
  if (!s.exportOn) throw off();
  const p = await partnerOf(actors, me);
  if (!(p.isOwner || p.canMoney)) throw new AppError(403, { code: 'PTN_EXPORT_ROLE', message: '대표 또는 정산 권한 직원만 내려받습니다.' });
  const rows = await db.query<Record<string, unknown>>(
    `WITH m AS (SELECT generate_series(date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - interval '11 months', date_trunc('month', now() AT TIME ZONE 'Asia/Seoul'), interval '1 month')::date AS mon)
     SELECT to_char(m.mon, 'YYYY-MM') AS ym,
            (SELECT count(*)::int FROM lead_deliveries d WHERE d.partner_id = $1 AND d.state <> 'REVOKED'
                AND d.delivered_at >= (m.mon::timestamp AT TIME ZONE 'Asia/Seoul') AND d.delivered_at < ((m.mon + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul')) AS received,
            (SELECT count(*)::int FROM lead_deliveries d WHERE d.partner_id = $1 AND d.state <> 'REVOKED' AND d.viewed_at IS NOT NULL
                AND d.delivered_at >= (m.mon::timestamp AT TIME ZONE 'Asia/Seoul') AND d.delivered_at < ((m.mon + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul')) AS viewed,
            (SELECT count(*)::int FROM lead_deliveries d WHERE d.partner_id = $1 AND d.state <> 'REVOKED' AND d.viewed_at IS NOT NULL AND d.viewed_at - d.delivered_at <= interval '1 hour'
                AND d.delivered_at >= (m.mon::timestamp AT TIME ZONE 'Asia/Seoul') AND d.delivered_at < ((m.mon + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul')) AS in1h,
            (SELECT coalesce(sum(f.amount), 0)::bigint FROM lead_fees f WHERE f.partner_id = $1 AND f.state = 'BILLED'
                AND f.billed_at >= (m.mon::timestamp AT TIME ZONE 'Asia/Seoul') AND f.billed_at < ((m.mon + interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul')) AS billed
       FROM m ORDER BY m.mon`, [p.id]);
  const csv = csvOf(['달', '받은 리드', '연락처 열람', '1시간 안 열람', '리드 이용료 확정(원)'], rows.map((r) => [r.ym, r.received, r.viewed, r.in1h, r.billed]));
  const first = String(rows[0]?.ym ?? ''), last = String(rows[rows.length - 1]?.ym ?? '');
  await db.query(`INSERT INTO ptn_export_logs (partner_id, account_id, kind, rows_n, range_from, range_to) VALUES ($1, $2, 'PERF', $3::int, ($4 || '-01')::date, ($5 || '-01')::date)`,
    [p.id, me, rows.length, first, last]);
  await audit(db, 'PTN_EXPORT_PERF', { partner: p.id, rows: rows.length });
  return { filename: `performance_${first}_${last}.csv`, csv, rows: rows.length, note: '숫자만 담았습니다(개인정보 없음).' };
}

/** 운영 화면 › 파트너사 › 파트너 자료 내려받기 — 최근 기록 200 · 승인 요청 상태 */
export async function adminPtnExports(db: DatabaseService) {
  const s = await vsxSettings(db);
  const logs = await db.query(
    `SELECT x.id::text AS id, x.kind, x.rows_n AS rows, x.range_from AS "from", x.range_to AS "to", x.ticket_id::text AS ticket, x.at, b.company_name AS company
       FROM ptn_export_logs x JOIN partners p ON p.id = x.partner_id JOIN businesses b ON b.id = p.business_id ORDER BY x.id DESC LIMIT 200`);
  const reqs = await db.query(
    `SELECT e.id::text AS id, e.reason, e.state, e.requested_at AS "requestedAt", e.decided_at AS "decidedAt", e.used_at AS "usedAt"
       FROM export_requests e WHERE e.target = 'PTN_LEADS' ORDER BY e.id DESC LIMIT 50`);
  return { settings: { exportOn: s.exportOn, exportMaxRows: s.exportMaxRows }, logs, requests: reqs,
    note: '승인 · 거절은 위험감지 › 감사 › 「내려받기 승인」(SUPER)에서 합니다 — 여기서는 기록만 봅니다.' };
}
