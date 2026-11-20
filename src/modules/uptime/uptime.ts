import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.497 (D272 · docs/635) 가동 감시 · 장애 공지 — 대표 11/20 「㊷ ①」
 *
 *   바깥 감시는 자동화 서버(n8n · decisions/automation-server-n8n.md #9 · 판단은 서버 · 전달은 n8n)에서 —
 *     n8n 워크플로(docs/635 부록 · deploy/aws/n8n/uptime-watch.json)가 5분마다 사용자 웹 · 상태 주소를 부르고
 *     ① 결과를 POST /site/uptime/report 로 보냄(토큰 X-Uptime-Token · uptime.report on 일 때만 받음)
 *     ② 그 보내기마저 실패하면(= API 가 죽음) n8n 이 텔레그램으로 직접 알림(서버가 알릴 수 없으므로)
 *   서버가 받은 결과는 대상별 연속 실패를 세어 uptime.fail_count(2) 이상이면 UPTIME_DOWN(CRITICAL — 기존 급한 알림 길 = 메일 · 텔레그램 · 슬랙)
 *   다시 되면 UPTIME_RECOVERED(INFO) · 이미 내려간 대상은 알림을 되풀이하지 않음.
 *
 *   GET /site/status(공개 · 가벼움) — DB 한 번 확인 + 끝나지 않은 장애 공지 · 최근 30일 끝난 공지 · 점검 예약 · 대상별 마지막 감시
 *     같은 프로세스 안에서 15초 기억(공지를 바꾸면 바로 지움). 개인정보 · 내부 주소 없음.
 *   장애 공지(운영 화면 › 위험감지 › 가동 · 장애 공지) — 쓰기 ADMIN · 끝난 공지는 DB 가 고치지 못하게 막음(띠 끄기만)
 *     notifyOps 면 운영 알림 UPT_INCIDENT(심각 · 전체 안 됨 = CRITICAL → 텔레그램 길 · 그 밖 WARN)
 *   사이트 점검 화면(D239 site.maintenance_*)은 그대로 쓰고, 공지 띠는 점검 화면 위에도 나옴(사용자 웹 layout).
 * ------------------------------------------------------------------- */

export const UPT_LEVELS = ['MINOR', 'MAJOR', 'CRITICAL'] as const;
export const UPT_STATES = ['INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED'] as const;
export const UPT_PARTS = ['SITE', 'API', 'LOGIN', 'PAY', 'MALL', 'MAIL', 'ADMIN'] as const;
export const UPT_TARGET_RE = /^[A-Z][A-Z0-9_]{1,19}$/;       // DB CHECK upt_checks.target · upt_targets.target 와 같음
export const UPT_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;         // 토큰 원문 모양(서버가 만든 것은 base64url 43자)
const CACHE_MS = 15_000;

const VERSION = (() => {
  try { return readFileSync(join(process.cwd(), 'VERSION'), 'utf8').trim().slice(0, 20) || '?'; } catch { return '?'; }
})();

let statusCache: { at: number; v: unknown } | null = null;
/** 공지를 바꾼 뒤 · 시험 — 바로 다시 읽게 */
export function resetStatusCache() { statusCache = null; }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const clean = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

async function setting(db: DatabaseService, key: string, dflt: string): Promise<string> {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = $1`, [key]);
  return (r?.v ?? '').trim() || dflt;
}

/* ── 공개 상태(사용자 웹 맨 위 띠 · /status 화면 · n8n 감시) ─────────────────── */
export async function publicStatus(db: DatabaseService) {
  if (statusCache && Date.now() - statusCache.at < CACHE_MS) return statusCache.v;
  const dbOk = await db.healthy();
  let open: Array<Record<string, unknown>> = [], recent: Array<Record<string, unknown>> = [], checks: Array<Record<string, unknown>> = [];
  let maint: { from: string | null; until: string | null } = { from: null, until: null };
  if (dbOk) {
    [open, recent, checks] = await Promise.all([
      db.query(
        `SELECT i.id::text AS id, i.title, i.title_en AS "titleEn", i.level, i.state, i.parts, i.banner, i.started_at AS "startedAt",
                n.body AS "lastNote", n.body_en AS "lastNoteEn", n.created_at AS "lastAt"
           FROM upt_incidents i
           LEFT JOIN LATERAL (SELECT body, body_en, created_at FROM upt_incident_notes WHERE incident_id = i.id ORDER BY id DESC LIMIT 1) n ON true
          WHERE i.state <> 'RESOLVED' ORDER BY i.started_at DESC LIMIT 5`).catch(() => []),
      db.query(
        `SELECT id::text AS id, title, title_en AS "titleEn", level, parts, started_at AS "startedAt", resolved_at AS "resolvedAt"
           FROM upt_incidents WHERE state = 'RESOLVED' AND resolved_at > now() - interval '30 days' ORDER BY resolved_at DESC LIMIT 10`).catch(() => []),
      db.query(
        `SELECT target, last_ok AS ok, down, last_at AS at FROM upt_targets WHERE last_at > now() - interval '30 minutes' ORDER BY target`).catch(() => []),
    ]);
    const m = await db.query<{ key: string; value: string | null }>(
      `SELECT key, value FROM site_settings WHERE key IN ('site.maintenance_from', 'site.maintenance_until')`).catch(() => []);
    maint = { from: m.find((x) => x.key === 'site.maintenance_from')?.value || null, until: m.find((x) => x.key === 'site.maintenance_until')?.value || null };
  }
  const f = Date.parse(maint.from ?? ''), u = Date.parse(maint.until ?? ''), now = Date.now();
  const maintOn = Number.isFinite(f) && Number.isFinite(u) && u > f && now >= f && now < u;
  const worst = open.reduce<number>((w, x) => Math.max(w, UPT_LEVELS.indexOf(x.level as typeof UPT_LEVELS[number])), -1);
  const status = !dbOk ? 'degraded' : maintOn ? 'maintenance' : worst >= 1 ? 'major' : worst === 0 ? 'minor' : checks.some((c) => c.down) ? 'minor' : 'ok';
  const v = { status, api: true, db: dbOk, version: VERSION, time: new Date().toISOString(), maintenance: { on: maintOn, from: maint.from, until: maint.until },
              incidents: open, recent, checks };
  statusCache = { at: Date.now(), v };
  return v;
}

/* ── n8n 결과 받기 ──────────────────────────────────────────────── */
export interface UptReportInput { target: string; ok: boolean; status?: number; ms?: number; note?: string }

export async function receiveReport(db: DatabaseService, token: string | undefined, items: UptReportInput[], source: 'N8N' | 'TEST' = 'N8N') {
  if ((await setting(db, 'uptime.report', 'off')).toLowerCase() !== 'on') throw new Forbidden('UPTIME_REPORT_OFF', '바깥 감시 결과 받기가 꺼져 있습니다(uptime.report).');
  const hash = await setting(db, 'uptime.report_token_hash', '');
  const given = String(token ?? '').trim();
  if (!/^[0-9a-f]{64}$/.test(hash) || !UPT_TOKEN_RE.test(given)) throw new Forbidden('UPTIME_TOKEN_INVALID', '감시 토큰이 맞지 않습니다.');
  const a = Buffer.from(sha(given), 'hex'), b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Forbidden('UPTIME_TOKEN_INVALID', '감시 토큰이 맞지 않습니다.');
  if (!Array.isArray(items) || items.length < 1 || items.length > 10) throw new PolicyViolation('UPTIME_ITEMS', '감시 결과는 1 ~ 10개입니다.');
  for (const x of items) {
    if (!UPT_TARGET_RE.test(String(x?.target ?? ''))) throw new PolicyViolation('UPTIME_TARGET', '대상 이름은 영문 대문자로 시작하는 2 ~ 20자(대문자 · 숫자 · _)입니다.');
  }
  const failCount = Math.min(10, Math.max(1, Number(await setting(db, 'uptime.fail_count', '2')) || 2));
  const changed: Array<{ target: string; to: 'DOWN' | 'UP' }> = [];
  for (const x of items) {
    const st = Number.isInteger(x.status) && (x.status as number) >= 0 && (x.status as number) <= 999 ? x.status as number : null;
    const ms = Number.isInteger(x.ms) && (x.ms as number) >= 0 && (x.ms as number) <= 600000 ? x.ms as number : null;
    const note = x.note ? clean(x.note, 200) : null;
    await db.transaction(async () => {
      await db.query(`INSERT INTO upt_checks (target, ok, http_status, ms, note, source) VALUES ($1, $2, $3, $4, $5, $6)`,
        [x.target, !!x.ok, st, ms, note, source]);
      const [t] = await db.query<{ down: boolean; fails: number }>(
        `INSERT INTO upt_targets (target, down, fails, last_ok, last_at) VALUES ($1, false, 0, NULL, now())
         ON CONFLICT (target) DO UPDATE SET target = EXCLUDED.target RETURNING down, fails`, [x.target]);
      if (x.ok) {
        await db.query(`UPDATE upt_targets SET fails = 0, down = false, down_since = NULL, last_ok = true, last_at = now() WHERE target = $1`, [x.target]);
        if (t?.down) changed.push({ target: x.target, to: 'UP' });
      } else {
        const fails = (t?.fails ?? 0) + 1;
        const goDown = !t?.down && fails >= failCount;
        await db.query(
          `UPDATE upt_targets SET fails = $2::int, last_ok = false, last_at = now(), down = (down OR $3::boolean),
                  down_since = CASE WHEN down THEN down_since WHEN $3::boolean THEN now() ELSE NULL END WHERE target = $1`,
          [x.target, fails, goDown]);
        if (goDown) changed.push({ target: x.target, to: 'DOWN' });
      }
    });
  }
  for (const c of changed) {
    const last = items.find((x) => x.target === c.target);
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ($1, $2, $3, $4::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
      [c.to === 'DOWN' ? 'UPTIME_DOWN' : 'UPTIME_RECOVERED', c.to === 'DOWN' ? 'CRITICAL' : 'INFO',
       (c.to === 'DOWN' ? `바깥 감시 — ${c.target} 응답 없음(연속 ${failCount}번 이상) — 위험감지 › 가동 · 장애 공지`
                        : `바깥 감시 — ${c.target} 다시 응답함 — 장애 공지를 썼다면 끝냄으로`).slice(0, 300),
       JSON.stringify({ target: c.target, status: last?.status ?? null, ms: last?.ms ?? null, source })]).catch(() => undefined);
  }
  if (changed.length) resetStatusCache();
  return { accepted: items.length, changed };
}

/* ── 운영 화면(위험감지 › 가동 · 장애 공지 · SB-ADM-UPT-010) ─────────────── */
export async function adminView(db: DatabaseService) {
  const [s, targets, incidents] = await Promise.all([
    db.query<{ key: string; value: string | null }>(
      `SELECT key, value FROM site_settings WHERE key IN ('uptime.report', 'uptime.report_token_hash', 'uptime.fail_count', 'uptime.keep_days')`),
    db.query(
      `SELECT t.target, t.down, t.fails, t.down_since AS "downSince", t.last_ok AS "lastOk", t.last_at AS "lastAt",
              c.n::int AS "checks24", c.bad::int AS "fails24", c.avg_ms::int AS "avgMs24",
              CASE WHEN c.n > 0 THEN round(100.0 * (c.n - c.bad) / c.n, 2) END AS "uptime24"
         FROM upt_targets t
         LEFT JOIN LATERAL (SELECT count(*) AS n, count(*) FILTER (WHERE NOT ok) AS bad, avg(ms) AS avg_ms
                              FROM upt_checks WHERE target = t.target AND at > now() - interval '24 hours') c ON true
        ORDER BY t.target`),
    db.query(
      `SELECT i.id::text AS id, i.title, i.title_en AS "titleEn", i.level, i.state, i.parts, i.banner, i.started_at AS "startedAt", i.resolved_at AS "resolvedAt",
              (SELECT coalesce(json_agg(json_build_object('id', n.id, 'state', n.state, 'body', n.body, 'bodyEn', n.body_en, 'at', n.created_at) ORDER BY n.id DESC), '[]'::json)
                 FROM upt_incident_notes n WHERE n.incident_id = i.id) AS notes
         FROM upt_incidents i ORDER BY (i.state <> 'RESOLVED') DESC, i.started_at DESC LIMIT 30`),
  ]);
  const v = (k: string) => (s.find((r) => r.key === k)?.value ?? '').trim();
  const [last] = await db.query<{ at: Date | null }>(`SELECT max(at) AS at FROM upt_checks WHERE source = 'N8N'`);
  return {
    settings: { report: v('uptime.report') === 'on', tokenSet: /^[0-9a-f]{64}$/.test(v('uptime.report_token_hash')), failCount: Number(v('uptime.fail_count') || 2), keepDays: Number(v('uptime.keep_days') || 90) },
    lastReportAt: last?.at ?? null, targets, incidents,
    canEdit: true /* 이 주소는 @Roles('ADMIN') — 볼 수 있으면 공지도 씀 */, isSuper: RequestCtx.get()?.actorRole === 'SUPER',
    levels: UPT_LEVELS, states: UPT_STATES, parts: UPT_PARTS,
  };
}

function checkParts(parts: unknown): string[] {
  const p = Array.isArray(parts) ? [...new Set(parts.map((x) => String(x)))] : [];
  if (p.some((x) => !(UPT_PARTS as readonly string[]).includes(x))) throw new PolicyViolation('UPT_PARTS', `영향 범위는 ${UPT_PARTS.join(' · ')} 중에서 고릅니다.`);
  return p;
}
/** 글 길이 — 문장은 통째로 받음(영어 사전 키가 되도록 · 한국어 낱말을 끼워 넣지 않음) */
function checkText(v: unknown, min: number, max: number, code: string, message: string): string {
  const s = String(v ?? '').trim();
  if (s.length < min || s.length > max) throw new PolicyViolation(code, message);
  return s;
}
const optText = (v: unknown, min: number, max: number, code: string, message: string) =>
  v === undefined || v === null || String(v).trim() === '' ? null : checkText(v, min, max, code, message);
const M_TITLE = '제목은 2 ~ 120자입니다.', M_TITLE_EN = '영어 제목은 2 ~ 160자입니다.';
const M_BODY = '안내 글은 2 ~ 1,000자입니다.', M_BODY_EN = '영어 안내 글은 2 ~ 1,500자입니다.';

async function raiseIncidentAlert(db: DatabaseService, id: string, title: string, level: string, what: '새 공지' | '끝남') {
  await db.query(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('UPT_INCIDENT', $1, $2, $3::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
    [what === '새 공지' && level !== 'MINOR' ? 'CRITICAL' : 'WARN', `장애 공지 ${what} — ${title}`.slice(0, 300), JSON.stringify({ incidentId: id, level, what })]).catch(() => undefined);
}

export async function createIncident(db: DatabaseService, d: { title: string; titleEn?: string; level: string; parts?: string[]; body: string; bodyEn?: string; banner?: boolean; notifyOps?: boolean }) {
  const title = checkText(d.title, 2, 120, 'UPT_TITLE', M_TITLE);
  const titleEn = optText(d.titleEn, 2, 160, 'UPT_TITLE', M_TITLE_EN);
  if (!(UPT_LEVELS as readonly string[]).includes(d.level)) throw new PolicyViolation('UPT_LEVEL', '정도는 MINOR(일부 느림) · MAJOR(일부 안 됨) · CRITICAL(전체 안 됨) 중 하나입니다.');
  const parts = checkParts(d.parts ?? []);
  const body = checkText(d.body, 2, 1000, 'UPT_BODY', M_BODY);
  const bodyEn = optText(d.bodyEn, 2, 1500, 'UPT_BODY', M_BODY_EN);
  const me = RequestCtx.actorId() ?? null;
  const id = await db.transaction(async () => {
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO upt_incidents (title, title_en, level, parts, banner, created_by) VALUES ($1, $2, $3, $4::text[], $5, $6) RETURNING id::text AS id`,
      [title, titleEn, d.level, parts, d.banner !== false, me]);
    await db.query(`INSERT INTO upt_incident_notes (incident_id, state, body, body_en, created_by) VALUES ($1::bigint, 'INVESTIGATING', $2, $3, $4)`, [r.id, body, bodyEn, me]);
    return r.id;
  });
  if (d.notifyOps) await raiseIncidentAlert(db, id, title, d.level, '새 공지');
  resetStatusCache();
  return { ok: true, id, note: d.banner !== false ? '장애 공지를 올렸습니다 — 사용자 웹 맨 위 띠는 1분 안에 나옵니다.' : '장애 공지를 올렸습니다(띠 없음 · 서비스 상태 화면에만).' };
}

export async function editIncident(db: DatabaseService, id: string, d: { title?: string; titleEn?: string; level?: string; parts?: string[]; banner?: boolean }) {
  const [cur] = await db.query<{ state: string }>(`SELECT state FROM upt_incidents WHERE id = $1::bigint`, [id]);
  if (!cur) throw new NotFound('없는 장애 공지입니다.');
  const keys = Object.entries(d).filter(([, v]) => v !== undefined).map(([k]) => k);   // 규칙 11 — 안 보낸 칸은 덮지 않음
  if (!keys.length) throw new PolicyViolation('UPT_NOTHING', '바꿀 것이 없습니다.');
  if (cur.state === 'RESOLVED' && keys.some((k) => k !== 'banner')) throw new StateConflict('UPT_RESOLVED', '끝난 장애 공지는 고치지 않습니다(띠 끄기만 됨).');
  const title = d.title !== undefined ? checkText(d.title, 2, 120, 'UPT_TITLE', M_TITLE) : null;
  const titleEn = d.titleEn !== undefined ? optText(d.titleEn, 2, 160, 'UPT_TITLE', M_TITLE_EN) : null;
  if (d.level !== undefined && !(UPT_LEVELS as readonly string[]).includes(d.level)) throw new PolicyViolation('UPT_LEVEL', '정도는 MINOR(일부 느림) · MAJOR(일부 안 됨) · CRITICAL(전체 안 됨) 중 하나입니다.');
  const parts = d.parts !== undefined ? checkParts(d.parts) : null;
  await db.query(
    `UPDATE upt_incidents SET title = CASE WHEN $2::boolean THEN $3 ELSE title END,
            title_en = CASE WHEN $4::boolean THEN $5 ELSE title_en END,
            level = CASE WHEN $6::boolean THEN $7 ELSE level END,
            parts = CASE WHEN $8::boolean THEN $9::text[] ELSE parts END,
            banner = CASE WHEN $10::boolean THEN $11::boolean ELSE banner END
      WHERE id = $1::bigint`,
    [id, d.title !== undefined, title, d.titleEn !== undefined, titleEn, d.level !== undefined, d.level ?? null,
     d.parts !== undefined, parts, d.banner !== undefined, d.banner ?? null]);
  resetStatusCache();
  return { ok: true, id };
}

export async function addNote(db: DatabaseService, id: string, d: { state: string; body: string; bodyEn?: string }) {
  if (!(UPT_STATES as readonly string[]).includes(d.state)) throw new PolicyViolation('UPT_STATE', '진행 상태는 조사 중 · 원인 찾음 · 지켜보는 중 · 끝남 중 하나입니다.');
  const body = checkText(d.body, 2, 1000, 'UPT_BODY', M_BODY);
  const bodyEn = optText(d.bodyEn, 2, 1500, 'UPT_BODY', M_BODY_EN);
  const [cur] = await db.query<{ state: string; title: string; level: string }>(`SELECT state, title, level FROM upt_incidents WHERE id = $1::bigint`, [id]);
  if (!cur) throw new NotFound('없는 장애 공지입니다.');
  if (cur.state === 'RESOLVED') throw new StateConflict('UPT_RESOLVED', '끝난 장애 공지에는 글을 더하지 않습니다 — 다시 생기면 새 공지를 쓰십시오.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`INSERT INTO upt_incident_notes (incident_id, state, body, body_en, created_by) VALUES ($1::bigint, $2, $3, $4, $5)`, [id, d.state, body, bodyEn, me]);
    await db.query(`UPDATE upt_incidents SET state = $2, resolved_at = CASE WHEN $2 = 'RESOLVED' THEN now() ELSE NULL END WHERE id = $1::bigint`, [id, d.state]);
  });
  if (d.state === 'RESOLVED') await raiseIncidentAlert(db, id, cur.title, cur.level, '끝남');
  resetStatusCache();
  return { ok: true, id, state: d.state };
}

export async function setUptimeSettings(db: DatabaseService, d: { report?: boolean; failCount?: number; keepDays?: number; reason: string }) {
  const reason = clean(d.reason, 200);
  if (reason.length < 2) throw new PolicyViolation('UPT_REASON', '사유는 2 ~ 200자입니다.');
  const set: Array<[string, string]> = [];
  if (d.report !== undefined) {
    if (d.report && !/^[0-9a-f]{64}$/.test(await setting(db, 'uptime.report_token_hash', ''))) throw new PolicyViolation('UPT_TOKEN_FIRST', '먼저 감시 토큰을 만드십시오(토큰 새로 만들기).');
    set.push(['uptime.report', d.report ? 'on' : 'off']);
  }
  if (d.failCount !== undefined) {
    if (!Number.isInteger(d.failCount) || d.failCount < 1 || d.failCount > 10) throw new PolicyViolation('UPT_FAIL_COUNT', '연속 실패 수는 1 ~ 10 입니다.');
    set.push(['uptime.fail_count', String(d.failCount)]);
  }
  if (d.keepDays !== undefined) {
    if (!Number.isInteger(d.keepDays) || d.keepDays < 7 || d.keepDays > 400) throw new PolicyViolation('UPT_KEEP_DAYS', '보관 날수는 7 ~ 400 입니다.');
    set.push(['uptime.keep_days', String(d.keepDays)]);
  }
  if (!set.length) throw new PolicyViolation('UPT_NOTHING', '바꿀 것이 없습니다.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  return { ok: true, changed: set.map(([k]) => k) };
}

/** SUPER — 새 감시 토큰(원문은 이 응답에 한 번만 · DB 에는 지문만 · 감사 기록에도 원문 없음) */
export async function rotateToken(db: DatabaseService, reasonIn: string) {
  const reason = clean(reasonIn, 200);
  if (reason.length < 2) throw new PolicyViolation('UPT_REASON', '사유는 2 ~ 200자입니다.');
  const token = randomBytes(32).toString('base64url');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    await db.query(`UPDATE site_settings SET value = $1, updated_by = $2, updated_at = now() WHERE key = 'uptime.report_token_hash'`, [sha(token), me]);
  });
  const c = RequestCtx.get();
  await db.query(
    `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, after_data, ip, user_agent)
     VALUES ($1, $2, 'UPT_TOKEN_ROTATE', 'SETTING', NULL, $3::jsonb, $4, $5)`,
    [me, c?.actorRole ?? null, JSON.stringify({ key: 'uptime.report_token_hash', reason }), c?.ip ?? null, c?.userAgent ?? null]).catch(() => undefined);
  return { ok: true, token, note: '토큰은 지금 한 번만 보입니다 — 자동화 서버 n8n 의 자격 증명(Header Auth · X-Uptime-Token)에 넣으십시오. 옛 토큰은 바로 쓸 수 없습니다.' };
}

/* ── 정기 작업 upt_daily(매일 04:50) ─────────────────────────────── */
export async function uptDailyJob(db: DatabaseService) {
  const keep = Math.min(400, Math.max(7, Number(await setting(db, 'uptime.keep_days', '90')) || 90));
  const ck = await db.query(`DELETE FROM upt_checks WHERE at < now() - make_interval(days => $1::int) RETURNING id`, [keep]);
  const st = await db.query(`DELETE FROM soc_states WHERE created_at < now() - interval '1 day' RETURNING id`);
  const pd = await db.query(`DELETE FROM soc_pending WHERE created_at < now() - interval '1 day' RETURNING id`);
  const ev = await db.query(`DELETE FROM soc_events WHERE at < now() - interval '180 days' RETURNING id`);
  return { checks: ck.length, states: st.length, pending: pd.length, events: ev.length };
}
