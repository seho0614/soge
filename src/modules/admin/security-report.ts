/* ---------------------------------------------------------------------
 * v10.354 · 355 · 356 (D235 · docs/488 ~ 490) — 월간 보안 보고 · 운영자 활동 요약 · 감사 기록 사슬 확인
 *
 *   대표 11/18 「다음개발」 → ② 월간 보안 보고 · ③ 운영자 활동 요약 · ④ 감사 기록 위변조 확인.
 *   화면(security-report.controller)과 정기 작업(scheduler — sla_alert 매시간 사슬 확인 · security_monthly 매일 09:20)이 함께 씁니다.
 *   숫자 · 가린 이메일만(본문 · 연락처 없음).
 * ------------------------------------------------------------------- */
import { nginxDenied } from '../identity/nginx-allow-script';

interface Q { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> }

export interface ChainResult { checked: number; ok: boolean; brokenId: string | null; lastSeq: string | null; reason: string | null }

/** 감사 기록 사슬 확인 — 마지막으로 온전했던 지점부터 · 결과를 audit.chain_checks 에 한 줄 */
export async function auditChainCheck(db: Q): Promise<ChainResult> {
  const [last] = await db.query<{ to_seq: string | null; to_hash: string | null }>(
    `SELECT to_seq::text AS to_seq, to_hash FROM audit.chain_checks WHERE ok AND to_seq IS NOT NULL ORDER BY id DESC LIMIT 1`);
  const [r] = await db.query<{ checked: number; ok: boolean; broken_id: string | null; last_seq: string | null; last_hash: string | null; reason: string | null }>(
    `SELECT checked, ok, broken_id::text AS broken_id, last_seq::text AS last_seq, last_hash, reason
       FROM audit.fn_audit_chain_verify($1::bigint, $2::text)`, [last?.to_seq ?? null, last?.to_hash ?? null]);
  await db.query(
    `INSERT INTO audit.chain_checks (from_seq, to_seq, to_hash, rows, ok, broken_id, reason) VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6::bigint, $7)`,
    [last?.to_seq ?? null, r?.ok ? r.last_seq : (last?.to_seq ?? null), r?.ok ? r.last_hash : (last?.to_hash ?? null), Number(r?.checked ?? 0), !!r?.ok, r?.broken_id ?? null, r?.reason ?? null]);
  return { checked: Number(r?.checked ?? 0), ok: !!r?.ok, brokenId: r?.broken_id ?? null, lastSeq: r?.last_seq ?? null, reason: r?.reason ?? null };
}

/** 위험감지 › 「감사」 상자 — 마지막 확인 · 사슬에 든 줄 · 사슬 전(D235 전) 줄 */
export async function auditChainState(db: Q) {
  const [c] = await db.query<{ at: string | null; ok: boolean | null; rows: number | null; broken_id: string | null; reason: string | null }>(
    `SELECT checked_at AS at, ok, rows, broken_id::text AS broken_id, reason FROM audit.chain_checks ORDER BY id DESC LIMIT 1`);
  const [n] = await db.query<{ chained: number; before: number; checks24: number; bad30: number }>(
    `SELECT (SELECT count(*)::int FROM audit.audit_logs WHERE chain_seq IS NOT NULL) AS chained,
            (SELECT count(*)::int FROM audit.audit_logs WHERE chain_seq IS NULL) AS before,
            (SELECT count(*)::int FROM audit.chain_checks WHERE checked_at > now() - interval '24 hours') AS checks24,
            (SELECT count(*)::int FROM audit.chain_checks WHERE NOT ok AND checked_at > now() - interval '30 days') AS bad30`);
  return {
    last: c ? { at: c.at, ok: !!c.ok, rows: Number(c.rows ?? 0), brokenId: c.broken_id, reason: c.reason } : null,
    chained: Number(n?.chained ?? 0), before: Number(n?.before ?? 0), checks24: Number(n?.checks24 ?? 0), bad30: Number(n?.bad30 ?? 0),
  };
}

export interface SecurityMonthly {
  month: string; grants: number; revokes: number; settingChanges: number; settingAlerts: number; piiViews: number; piiActors: number;
  newLogins: number; ipPasses: number; ipLocked: number; critical: number; criticalAcked: number; ackMinutes: number | null; auditRows: number;
  chain: { ok: boolean | null; at: string | null; brokenId: string | null }; denied: { installed: boolean; total7: number; top: Array<{ ip: string; n7: number }> };
}

/** 지난달(한국) 보안 숫자 */
export async function securityMonthlyStats(db: Q): Promise<SecurityMonthly> {
  const [s] = await db.query<Record<string, number | string | null>>(
    `WITH r AS (
       SELECT (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - interval '1 month') AT TIME ZONE 'Asia/Seoul' AS f,
              date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AS t)
     SELECT (SELECT to_char(f AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') FROM r) AS month,
            (SELECT count(*)::int FROM role_changes c, r WHERE c.action = 'GRANT' AND c.changed_at >= r.f AND c.changed_at < r.t) AS grants,
            (SELECT count(*)::int FROM role_changes c, r WHERE c.action = 'REVOKE' AND c.changed_at >= r.f AND c.changed_at < r.t) AS revokes,
            (SELECT count(*)::int FROM site_setting_changes c, r WHERE c.at >= r.f AND c.at < r.t) AS "settingChanges",
            (SELECT count(*)::int FROM ops_alerts a, r WHERE a.alert_code = 'SETTING_CHANGED' AND a.raised_at >= r.f AND a.raised_at < r.t) AS "settingAlerts",
            (SELECT count(*)::int FROM audit.pii_access_logs p, r WHERE p.occurred_at >= r.f AND p.occurred_at < r.t) AS "piiViews",
            (SELECT count(DISTINCT p.actor_account_id)::int FROM audit.pii_access_logs p, r WHERE p.occurred_at >= r.f AND p.occurred_at < r.t) AS "piiActors",
            (SELECT count(*)::int FROM ops_alerts a, r WHERE a.alert_code = 'STAFF_LOGIN_NEW' AND a.raised_at >= r.f AND a.raised_at < r.t) AS "newLogins",
            (SELECT count(*)::int FROM staff_ip_passes p, r WHERE p.verified_at >= r.f AND p.verified_at < r.t) AS "ipPasses",
            (SELECT count(*)::int FROM staff_ip_codes c, r WHERE c.tries >= 5 AND c.created_at >= r.f AND c.created_at < r.t) AS "ipLocked",
            (SELECT count(*)::int FROM ops_alerts a, r WHERE a.severity = 'CRITICAL' AND a.raised_at >= r.f AND a.raised_at < r.t) AS critical,
            (SELECT count(*)::int FROM ops_alerts a, r WHERE a.severity = 'CRITICAL' AND a.acknowledged_at IS NOT NULL AND a.raised_at >= r.f AND a.raised_at < r.t) AS "criticalAcked",
            (SELECT round((avg(extract(epoch FROM a.acknowledged_at - a.raised_at)) / 60)::numeric)::int FROM ops_alerts a, r
              WHERE a.severity = 'CRITICAL' AND a.acknowledged_at IS NOT NULL AND a.raised_at >= r.f AND a.raised_at < r.t) AS "ackMinutes",
            (SELECT count(*)::int FROM audit.audit_logs l, r WHERE l.occurred_at >= r.f AND l.occurred_at < r.t) AS "auditRows"`);
  const [c] = await db.query<{ ok: boolean | null; at: string | null; broken_id: string | null }>(
    `SELECT ok, checked_at AS at, broken_id::text AS broken_id FROM audit.chain_checks ORDER BY id DESC LIMIT 1`);
  const d = nginxDenied();
  const num = (k: string) => Number(s?.[k] ?? 0);
  return {
    month: String(s?.month ?? ''), grants: num('grants'), revokes: num('revokes'), settingChanges: num('settingChanges'), settingAlerts: num('settingAlerts'),
    piiViews: num('piiViews'), piiActors: num('piiActors'), newLogins: num('newLogins'), ipPasses: num('ipPasses'), ipLocked: num('ipLocked'),
    critical: num('critical'), criticalAcked: num('criticalAcked'), ackMinutes: s?.ackMinutes == null ? null : Number(s.ackMinutes), auditRows: num('auditRows'),
    chain: { ok: c ? !!c.ok : null, at: c?.at ?? null, brokenId: c?.broken_id ?? null },
    denied: { installed: d.installed, total7: d.total7, top: d.rows.slice(0, 3).map((r) => ({ ip: maskIp(r.ip), n7: r.n7 })) },
  };
}

const maskIp = (ip: string) => (ip.includes('.') ? ip.split('.').slice(0, 2).join('.') + '.*.*' : ip.split(':').slice(0, 2).join(':') + ':…');

export function securityMonthlyText(s: SecurityMonthly): string {
  return [
    `[소개뱅크] 월간 보안 보고 ${s.month}`,
    `운영 권한 주기 ${s.grants} · 거두기 ${s.revokes}(위험감지 › 운영자 권한)`,
    `설정 바뀜 ${s.settingChanges}(중요 설정 알림 ${s.settingAlerts})`,
    `개인정보 열람 ${s.piiViews}회 · ${s.piiActors}명(위험감지 › 개인정보 접속기록)`,
    `운영자 낯선 로그인 ${s.newLogins} · 접속 인증 통과 ${s.ipPasses} · 잠김 ${s.ipLocked}`,
    `막힌 접속(최근 7일): ${s.denied.installed ? `${s.denied.total7}번${s.denied.top.length ? ` — ${s.denied.top.map((t) => `${t.ip} ${t.n7}`).join(' · ')}` : ''}` : '기록 없음(감시 서비스 설치 전)'}`,
    `급한 알림 ${s.critical} · 확인 ${s.criticalAcked} · 확인까지 평균 ${s.ackMinutes == null ? '—' : `${s.ackMinutes}분`}`,
    `감사 기록 ${s.auditRows}줄 · 위변조 확인 ${s.chain.ok == null ? '아직 안 함' : s.chain.ok ? '온전' : `끊김(줄 ${s.chain.brokenId})`}`,
    '이 알림 끄기: 설정 ops.security_monthly = off',
  ].join('\n');
}

/** 운영자 활동 요약(최근 days 일) — 운영 역할이 있는 사람마다 한 일 묶음 · 마지막 로그인 · 개인정보 열람 · 90일 쉼이면 「거둘 후보」 */
export async function staffActivity(db: Q, days: number, roles: readonly string[]) {
  const rows = await db.query<{ id: string; email: string; roles: string[]; lastLogin: string | null; acts: number; lastAct: string | null; pii: number }>(
    `SELECT a.id, a.email::text AS email, array_agg(DISTINCT r.role ORDER BY r.role) AS roles,
            (SELECT max(h.at) FROM login_history h WHERE h.account_id = a.id AND h.ok) AS "lastLogin",
            (SELECT count(*)::int FROM audit.audit_logs l WHERE l.actor_account_id = a.id AND l.occurred_at > now() - make_interval(days => $1)) AS acts,
            (SELECT max(l.occurred_at) FROM audit.audit_logs l WHERE l.actor_account_id = a.id) AS "lastAct",
            (SELECT count(*)::int FROM audit.pii_access_logs p WHERE p.actor_account_id = a.id AND p.occurred_at > now() - make_interval(days => $1)) AS pii
       FROM accounts a JOIN account_roles r ON r.account_id = a.id
      WHERE r.role = ANY($2::text[]) AND a.status = 'ACTIVE'
      GROUP BY a.id, a.email ORDER BY a.email`, [days, roles]);
  const groups = rows.length ? await db.query<{ id: string; grp: string; n: number }>(
    `SELECT l.actor_account_id::text AS id, split_part(l.action, '_', 1) AS grp, count(*)::int AS n
       FROM audit.audit_logs l
      WHERE l.actor_account_id = ANY($1::uuid[]) AND l.occurred_at > now() - make_interval(days => $2)
      GROUP BY 1, 2 ORDER BY 1, 3 DESC`, [rows.map((r) => r.id), days]) : [];
  const old = (t: string | null) => !t || Date.now() - new Date(t).getTime() > 90 * 86400_000;
  return rows.map((r) => ({
    ...r,
    groups: groups.filter((g) => g.id === r.id).slice(0, 4).map((g) => ({ grp: g.grp, n: g.n })),
    idle90: old(r.lastLogin) && old(r.lastAct),
  }));
}
