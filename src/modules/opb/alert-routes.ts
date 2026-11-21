import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { MailService } from '../../common/mail/mail.service';

/* ---------------------------------------------------------------------
 * v10.572 (docs/714) 운영 알림 받을 사람 규칙 — 앞머리 opb_
 *   표 opb_alert_routes: 알림 종류(ops_alerts.alert_code)마다 길(텔레그램 · 메일 · 슬랙 · 게시판) · 급함 기준(이 등급 이상) ·
 *   같은 종류 묶음 간격(분) · 받을 권한그룹 · '*' = 목록에 없는 종류의 기본 줄.
 *   처음 값 = 지금 동작(D220 함수 목록 13종 = 급함 상관없이 네 길 · 그 밖 = CRITICAL 만 네 길 · 60분).
 *   스위치 opb.alert_routes(처음 off) — off 면 아래 함수가 모두 null 을 돌려주고 부르는 쪽(launch-watch · scheduler)이 지금 함수를 그대로 씀.
 *   스위치 opb.alert_group_mail(처음 off) — 대표 메일 한 통 뒤 권한그룹 사람에게 한 통씩(20명까지).
 *   늘 지키는 것: AUDIT_CHAIN_BROKEN 은 규칙을 만들 수 없고 늘 네 길 · CRITICAL 은 늘 게시판 · 잠시 끈 종류(alert_mutes)는 지금처럼 뺌(게시판 제외).
 * ------------------------------------------------------------------- */

export type OpbChannel = 'mail' | 'telegram' | 'slack' | 'board';
export const OPB_CODE_RE = /^([A-Z][A-Z0-9_]{1,59}|[*])$/;   // = DB CHECK opb_alert_routes.alert_code
export const OPB_SEVS = ['INFO', 'WARN', 'CRITICAL'] as const;
/** 지금 동작(D220 · scheduler alertBoard)의 종류 목록 — 처음 시드와 같음 · 화면 「처음 값과 다름」 표시에 씀 */
export const OPB_DEFAULT_CODES = ['SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW',
  'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY', 'STAFF_IP_PASS_NEW', 'STAFF_IP_LOCKED', 'STAFF_IP_DAY_LIMIT', 'ASSUME_READY'];
const LOCKED = 'AUDIT_CHAIN_BROKEN';
const rank = (s: string) => (s === 'CRITICAL' ? 3 : s === 'WARN' ? 2 : s === 'INFO' ? 1 : 0);

export interface OpbRule {
  code: string; toTelegram: boolean; toMail: boolean; toSlack: boolean; toBoard: boolean;
  minSeverity: string; throttleMin: number; groups: string[]; note: string | null; updatedAt: string; by: string | null;
}
export interface OpbPendingItem { id: string; code: string; severity: string; title: string; raisedAt: string; again: boolean }

async function sw(db: DatabaseService, key: string): Promise<boolean> {
  const [r] = await db.query<{ v: string | null }>(`SELECT (SELECT value FROM site_settings WHERE key = $1) AS v`, [key]);
  return (r?.v ?? 'off').trim() === 'on';
}
/** 규칙을 쓰는지 — 표가 없거나(마이그레이션 전) 못 읽으면 false(지금 동작) */
export async function opbRoutesOn(db: DatabaseService): Promise<boolean> {
  return sw(db, 'opb.alert_routes').catch(() => false);
}

async function rules(db: DatabaseService): Promise<OpbRule[]> {
  return db.query<OpbRule>(
    `SELECT r.alert_code AS code, r.to_telegram AS "toTelegram", r.to_mail AS "toMail", r.to_slack AS "toSlack", r.to_board AS "toBoard",
            r.min_severity AS "minSeverity", r.throttle_min AS "throttleMin", r.groups, r.note,
            to_char(r.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt", a.name AS by
       FROM opb_alert_routes r LEFT JOIN accounts a ON a.id = r.updated_by
      ORDER BY (r.alert_code = '*') DESC, r.alert_code`);
}
const ruleOf = (list: OpbRule[], code: string) => list.find((r) => r.code === code) ?? list.find((r) => r.code === '*');
const chOn = (r: OpbRule | undefined, ch: OpbChannel) =>
  !!r && (ch === 'mail' ? r.toMail : ch === 'telegram' ? r.toTelegram : ch === 'slack' ? r.toSlack : r.toBoard);

/* 「다시 보내기」(12시간 넘게 확인 안 한 CRITICAL) 는 지금 함수 그대로 — 그 길이 규칙에서 꺼진 종류만 뺌 */
const AGAIN_SQL: Record<'mail' | 'telegram' | 'slack', string> = {
  mail: `SELECT id::text AS id, alert_code AS code, severity, title, to_char(raised_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS "raisedAt", true AS again FROM fn_ops_alert_remail_pending()`,
  telegram: `SELECT id::text AS id, alert_code AS code, severity, title, to_char(raised_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS "raisedAt", true AS again FROM fn_ops_alert_repush_pending()`,
  slack: `SELECT id::text AS id, alert_code AS code, severity, title, to_char(raised_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS "raisedAt", true AS again FROM fn_ops_alert_slack_repush_pending()`,
};

/**
 * 규칙으로 고른 보낼 알림 — 스위치 off 면 null(부르는 쪽이 지금 함수를 씀).
 *   mail · telegram · slack: 처음 보낼 것(50건 · CRITICAL 먼저 · 최근 순) + 다시 보낼 것 · 잠시 끈 종류 뺌
 *   board: 처음 올릴 것만(지금처럼 오래된 순 · 잠시 끔 상관없음)
 */
export async function opbRoutePending(db: DatabaseService, ch: OpbChannel): Promise<OpbPendingItem[] | null> {
  if (!(await opbRoutesOn(db))) return null;
  const first = await db.query<OpbPendingItem>(
    `SELECT id::text AS id, alert_code AS code, severity, title, to_char(raised_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS "raisedAt", false AS again
       FROM opb_alert_route_pending($1::text, 50)`, [ch]);
  if (ch === 'board') return first;
  const list = await rules(db);
  const again = (await db.query<OpbPendingItem>(AGAIN_SQL[ch]))
    .filter((x) => x.code === LOCKED || (chOn(ruleOf(list, x.code), ch) && rank(x.severity) >= rank(ruleOf(list, x.code)?.minSeverity ?? 'CRITICAL')));
  const muted = new Set((await db.query<{ c: string }>(`SELECT alert_code AS c FROM alert_mutes WHERE lifted_at IS NULL AND until_at > now()`)).map((x) => x.c));
  return [...first, ...again].filter((x) => !muted.has(x.code));
}

/** 규칙 기준 대기 전체 수(50건 제한 없음) — 스위치 off 면 null */
export async function opbRouteBacklog(db: DatabaseService, ch: OpbChannel): Promise<number | null> {
  if (!(await opbRoutesOn(db))) return null;
  const [r] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM opb_alert_route_pending($1::text, NULL)`, [ch]);
  return Number(r?.n ?? 0);
}

/**
 * 권한그룹 사람에게 따로 메일(스위치 둘 다 on 일 때만) — 대표 메일(ops.digest_to)을 보낸 뒤 부름.
 *   이 묶음의 종류마다 규칙의 groups → 그 그룹에 붙은(기한 안) 재직 운영자(운영 역할 · ACTIVE · 메일 있음) · 대표 메일 주소는 뺌 · 20명까지 ·
 *   사람마다 자기 그룹에 걸린 알림만 한 통. 실패해도 대표 메일 결과는 그대로(보낸 것으로 적은 시각은 바꾸지 않음).
 */
export async function opbGroupMail(db: DatabaseService, mail: MailService, items: Array<{ code: string; severity: string; title: string; raisedAt: string; again: boolean }>): Promise<{ sent: number; failed: number; skipped?: string }> {
  try {
    if (!items.length) return { sent: 0, failed: 0, skipped: 'EMPTY' };
    if (!(await opbRoutesOn(db)) || !(await sw(db, 'opb.alert_group_mail'))) return { sent: 0, failed: 0, skipped: 'OFF' };
    const list = await rules(db);
    const groupsOf = (code: string) => ruleOf(list, code)?.groups ?? [];
    const all = [...new Set(items.flatMap((x) => groupsOf(x.code)))];
    if (!all.length) return { sent: 0, failed: 0, skipped: 'NO_GROUPS' };
    const people = await db.query<{ email: string; groups: string[] }>(
      `SELECT a.email::text AS email, array_agg(DISTINCT g.group_key) AS groups
         FROM perm_account_groups g JOIN accounts a ON a.id = g.account_id
        WHERE g.group_key = ANY($1::text[]) AND (g.expires_at IS NULL OR g.expires_at > now())
          AND a.status = 'ACTIVE' AND a.email IS NOT NULL
          AND EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = a.id AND r.role <> 'MEMBER')
          AND lower(a.email::text) <> lower(coalesce((SELECT value FROM site_settings WHERE key = 'ops.digest_to'), ''))
        GROUP BY a.email ORDER BY a.email LIMIT 20`, [all]);
    let sent = 0, failed = 0;
    for (const p of people) {
      const mine = items.filter((x) => groupsOf(x.code).some((g) => p.groups.includes(g)));
      if (!mine.length) continue;
      const text = [
        `소개뱅크 급한 운영 알림 ${mine.length}건 — 받을 사람 규칙(권한그룹 ${p.groups.join(' · ')})으로 보냅니다.`, '',
        ...mine.map((x) => `- ${x.again ? '[다시] ' : ''}[${x.severity}] ${x.raisedAt} ${x.title}`), '',
        '운영 화면 › 운영 알림에서 내용을 보고 「확인」을 누르십시오. 받지 않으려면 대표(SUPER)에게 규칙에서 빼 달라고 하십시오.',
      ].join('\n');
      const r = await mail.send({ to: p.email, subject: `[소개뱅크] 급한 운영 알림 ${mine.length}건 — ${mine[0].title}`.slice(0, 150), text });
      if (r.ok) sent++; else failed++;
    }
    return { sent, failed };
  } catch {
    return { sent: 0, failed: 0, skipped: 'ERROR' };
  }
}

/* ── 운영 화면(SUPER) ─────────────────────────────────────────────── */

const initialOf = (code: string) => code === '*' || !OPB_DEFAULT_CODES.includes(code)
  ? { toTelegram: true, toMail: true, toSlack: true, toBoard: true, minSeverity: 'CRITICAL', throttleMin: 60 }
  : { toTelegram: true, toMail: true, toSlack: true, toBoard: true, minSeverity: 'INFO', throttleMin: 60 };
const sameAsInitial = (r: OpbRule) => {
  const i = initialOf(r.code);
  return r.toTelegram === i.toTelegram && r.toMail === i.toMail && r.toSlack === i.toSlack && r.toBoard === i.toBoard
    && r.minSeverity === i.minSeverity && r.throttleMin === i.throttleMin && !r.groups.length
    && (r.code === '*' || OPB_DEFAULT_CODES.includes(r.code));
};

/** 규칙 · 최근 30일 종류 · 권한그룹 · 스위치 · 바꾼 기록 */
export async function opbRouteView(db: DatabaseService) {
  const [list, seen, groups, log] = await Promise.all([
    rules(db),
    db.query<{ code: string; n: number; critical: number; warn: number; last: string }>(
      `SELECT alert_code AS code, count(*)::int AS n, count(*) FILTER (WHERE severity = 'CRITICAL')::int AS critical,
              count(*) FILTER (WHERE severity = 'WARN')::int AS warn,
              to_char(max(raised_at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS last
         FROM ops_alerts WHERE raised_at > now() - interval '30 days' GROUP BY alert_code ORDER BY count(*) DESC, alert_code LIMIT 200`),
    db.query<{ key: string; name: string; members: number }>(
      `SELECT g.key, g.name, (SELECT count(*) FROM perm_account_groups m WHERE m.group_key = g.key AND (m.expires_at IS NULL OR m.expires_at > now()))::int AS members
         FROM perm_role_groups g WHERE g.active ORDER BY g.key`),
    db.query<{ id: string; code: string; action: string; reason: string; at: string; by: string | null; after: unknown }>(
      `SELECT l.id::text AS id, l.alert_code AS code, l.action, l.reason, to_char(l.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS at,
              a.name AS by, l.after_data AS after
         FROM opb_alert_route_log l LEFT JOIN accounts a ON a.id = l.actor_id ORDER BY l.id DESC LIMIT 30`),
  ]);
  const [s] = await db.query<{ on: string | null; gm: string | null }>(
    `SELECT (SELECT value FROM site_settings WHERE key = 'opb.alert_routes') AS on, (SELECT value FROM site_settings WHERE key = 'opb.alert_group_mail') AS gm`);
  /* 종류마다 「지금 동작」과 「규칙」이 고르는 길(CRITICAL · WARN · INFO 일 때) — 화면이 다른 줄만 칠함 */
  const pick = (r: OpbRule | undefined, sev: string, code: string) => code === LOCKED
    ? ['telegram', 'mail', 'slack', 'board']
    : (['telegram', 'mail', 'slack', 'board'] as OpbChannel[]).filter((c) => (c === 'board' && sev === 'CRITICAL') || (chOn(r, c) && rank(sev) >= rank(r?.minSeverity ?? 'CRITICAL')));
  const nowPick = (sev: string, code: string) => (sev === 'CRITICAL' || OPB_DEFAULT_CODES.includes(code)) ? ['telegram', 'mail', 'slack', 'board'] : [];
  const codes = seen.map((x) => {
    const r = ruleOf(list, x.code);
    const sev = x.critical ? 'CRITICAL' : x.warn ? 'WARN' : 'INFO';
    const rule = pick(r, sev, x.code), now = nowPick(sev, x.code);
    return { ...x, rule: r?.code ?? '*', sev, channels: rule, nowChannels: now, differs: rule.join() !== now.join() };
  });
  return {
    on: (s?.on ?? 'off').trim() === 'on', groupMail: (s?.gm ?? 'off').trim() === 'on',
    rules: list.map((r) => ({ ...r, initial: sameAsInitial(r) })),
    lockedCodes: [LOCKED], defaultCodes: OPB_DEFAULT_CODES, sevs: OPB_SEVS,
    codes, groups, log,
    note: (s?.on ?? 'off').trim() === 'on'
      ? '규칙을 쓰는 중 — 급한 알림 메일 · 텔레그램 · 슬랙 · 게시판이 이 표를 따릅니다.'
      : '규칙을 쓰지 않는 중(처음 값) — 지금 동작 그대로입니다. 표를 고쳐 둔 뒤 「규칙 쓰기」를 켜면 그때부터 따릅니다.',
  };
}

function cleanReason(r: string | undefined) {
  const v = String(r ?? '').replace(/\s+/g, ' ').trim();
  if (v.length < 2 || v.length > 200) throw new PolicyViolation('OPB_REASON', '사유는 2 ~ 200자입니다.');
  return v;
}

export interface OpbRouteInput {
  toTelegram?: boolean; toMail?: boolean; toSlack?: boolean; toBoard?: boolean;
  minSeverity?: string; throttleMin?: number; groups?: string[]; note?: string; expectedUpdatedAt?: string; reason: string;
}

/** 규칙 한 줄 넣기 · 고치기(SUPER) — 보낸 칸만 바꿈(안 보낸 칸은 undefined 로 들어오므로 거름 · 규칙 11) */
export async function opbRouteSet(db: DatabaseService, codeIn: string, d: OpbRouteInput) {
  const code = String(codeIn ?? '').trim();
  if (!OPB_CODE_RE.test(code)) throw new PolicyViolation('OPB_ROUTE_CODE', '알림 종류는 영어 대문자 · 숫자 · 밑줄(2 ~ 60자)이거나 기본 줄(*)입니다.');
  if (code === LOCKED) throw new PolicyViolation('OPB_ROUTE_LOCKED', '감사 기록 위변조 의심(AUDIT_CHAIN_BROKEN)은 늘 네 길로 갑니다 — 규칙을 만들 수 없습니다.');
  const reason = cleanReason(d.reason);
  if (d.minSeverity !== undefined && !(OPB_SEVS as readonly string[]).includes(d.minSeverity)) throw new PolicyViolation('OPB_ROUTE_SEV', '급함 기준은 INFO · WARN · CRITICAL 중 하나입니다.');
  if (d.throttleMin !== undefined && (!Number.isInteger(d.throttleMin) || d.throttleMin < 0 || d.throttleMin > 1440)) throw new PolicyViolation('OPB_ROUTE_THROTTLE', '묶음 간격은 0 ~ 1440분입니다.');
  if (d.note !== undefined && d.note.length > 200) throw new PolicyViolation('OPB_ROUTE_NOTE', '메모는 200자까지입니다.');
  let groups: string[] | undefined;
  if (d.groups !== undefined) {
    groups = [...new Set(d.groups.map((g) => String(g).trim()).filter(Boolean))];
    if (groups.length > 10) throw new PolicyViolation('OPB_ROUTE_GROUP', '받을 권한그룹은 10개까지입니다.');
    if (groups.length) {
      const ok = await db.query<{ key: string }>(`SELECT key FROM perm_role_groups WHERE active AND key = ANY($1::text[])`, [groups]);
      const miss = groups.filter((g) => !ok.some((o) => o.key === g));
      if (miss.length) throw new PolicyViolation('OPB_ROUTE_GROUP', `없거나 쓰지 않는 권한그룹입니다: ${miss.join(' · ')}`);
    }
  }
  const me = RequestCtx.actorId() ?? null;
  return db.transaction(async () => {
    const [old] = await db.query<OpbRule>(
      `SELECT alert_code AS code, to_telegram AS "toTelegram", to_mail AS "toMail", to_slack AS "toSlack", to_board AS "toBoard",
              min_severity AS "minSeverity", throttle_min AS "throttleMin", groups, note,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt", NULL::text AS by
         FROM opb_alert_routes WHERE alert_code = $1 FOR UPDATE`, [code]);
    if (d.expectedUpdatedAt !== undefined && (old?.updatedAt ?? '') !== d.expectedUpdatedAt) {
      throw new StateConflict('OPB_ROUTE_CHANGED', '그 사이 다른 사람이 이 규칙을 바꿨습니다 — 새로 읽은 뒤 다시 고치십시오.');
    }
    /* 새 줄은 지금 그 종류에 걸리는 줄(없으면 '*')을 바탕으로 */
    const base = old ?? (await db.query<OpbRule>(
      `SELECT alert_code AS code, to_telegram AS "toTelegram", to_mail AS "toMail", to_slack AS "toSlack", to_board AS "toBoard",
              min_severity AS "minSeverity", throttle_min AS "throttleMin", groups, note, '' AS "updatedAt", NULL::text AS by
         FROM opb_alert_routes WHERE alert_code = '*'`))[0];
    const next = {
      toTelegram: d.toTelegram ?? base?.toTelegram ?? true, toMail: d.toMail ?? base?.toMail ?? true,
      toSlack: d.toSlack ?? base?.toSlack ?? true, toBoard: d.toBoard ?? base?.toBoard ?? true,
      minSeverity: d.minSeverity ?? base?.minSeverity ?? 'CRITICAL', throttleMin: d.throttleMin ?? base?.throttleMin ?? 60,
      groups: groups ?? (old ? old.groups : []), note: d.note !== undefined ? (d.note.trim() || null) : (old?.note ?? null),
    };
    await db.query(
      `INSERT INTO opb_alert_routes (alert_code, to_telegram, to_mail, to_slack, to_board, min_severity, throttle_min, groups, note, updated_by, updated_at)
       VALUES ($1, $2::boolean, $3::boolean, $4::boolean, $5::boolean, $6::text, $7::int, $8::text[], $9::text, $10::uuid, now())
       ON CONFLICT (alert_code) DO UPDATE SET to_telegram = EXCLUDED.to_telegram, to_mail = EXCLUDED.to_mail, to_slack = EXCLUDED.to_slack,
              to_board = EXCLUDED.to_board, min_severity = EXCLUDED.min_severity, throttle_min = EXCLUDED.throttle_min,
              groups = EXCLUDED.groups, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [code, next.toTelegram, next.toMail, next.toSlack, next.toBoard, next.minSeverity, next.throttleMin, next.groups, next.note, me]);
    await db.query(
      `INSERT INTO opb_alert_route_log (alert_code, action, before_data, after_data, reason, actor_id) VALUES ($1, 'SET', $2::jsonb, $3::jsonb, $4, $5::uuid)`,
      [code, old ? JSON.stringify(old) : null, JSON.stringify(next), reason, me]);
    return { ok: true, code, created: !old, rule: next, note: old ? '규칙을 고쳤습니다.' : '규칙을 더했습니다.' };
  });
}

/** 규칙 한 줄 빼기(SUPER) — 그 종류는 기본 줄('*')을 따름 · '*' 는 못 뺌 */
export async function opbRouteRemove(db: DatabaseService, codeIn: string, reasonIn: string) {
  const code = String(codeIn ?? '').trim();
  if (code === '*') throw new PolicyViolation('OPB_ROUTE_DEFAULT', '기본 줄(*)은 뺄 수 없습니다 — 길 · 기준만 고칩니다.');
  if (!OPB_CODE_RE.test(code)) throw new PolicyViolation('OPB_ROUTE_CODE', '알림 종류 형식이 맞지 않습니다.');
  const reason = cleanReason(reasonIn);
  const me = RequestCtx.actorId() ?? null;
  return db.transaction(async () => {
    const [old] = await db.query<Record<string, unknown>>(`DELETE FROM opb_alert_routes WHERE alert_code = $1 RETURNING alert_code, to_telegram, to_mail, to_slack, to_board, min_severity, throttle_min, groups, note`, [code]);
    if (!old) throw new NotFound('그 종류의 규칙이 없습니다(이미 기본 줄을 따름).');
    await db.query(`INSERT INTO opb_alert_route_log (alert_code, action, before_data, after_data, reason, actor_id) VALUES ($1, 'REMOVE', $2::jsonb, NULL, $3, $4::uuid)`,
      [code, JSON.stringify(old), reason, me]);
    return { ok: true, code, note: '규칙을 뺐습니다 — 이 종류는 이제 기본 줄(*)을 따릅니다.' };
  });
}

/** 스위치(SUPER) — opb.alert_routes · opb.alert_group_mail · 사유는 설정 바뀜 기록(app.setting_reason)과 규칙 기록에 */
export async function opbRouteSwitch(db: DatabaseService, d: { on?: boolean; groupMail?: boolean; reason: string }) {
  const reason = cleanReason(d.reason);
  const set: Array<[string, string]> = [];
  if (d.on !== undefined) set.push(['opb.alert_routes', d.on ? 'on' : 'off']);
  if (d.groupMail !== undefined) set.push(['opb.alert_group_mail', d.groupMail ? 'on' : 'off']);
  if (!set.length) throw new PolicyViolation('OPB_NOTHING', '바꿀 것이 없습니다.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
    await db.query(`INSERT INTO opb_alert_route_log (alert_code, action, before_data, after_data, reason, actor_id) VALUES ('*', 'SWITCH', NULL, $1::jsonb, $2, $3::uuid)`,
      [JSON.stringify(Object.fromEntries(set)), reason, me]);
  });
  return { ok: true, changed: set.map(([k]) => k), note: '바꿨습니다 — 다음 보내기 차례(5분 안)부터 따릅니다.' };
}
