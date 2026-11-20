import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { TelegramService } from '../../common/telegram/telegram.service';
import { maskMail } from '../../common/mail/mail-admin.service';
import { UPT_PARTS, addNote, createIncident } from '../uptime/uptime';
import { opzAudit, opzSettings } from './opz-settings';

/* ---------------------------------------------------------------------
 * v10.557 (D288 · docs/695) 장애 대응 절차 화면 — 대표 11/21 「(58) ② 장애 대응 절차」
 *
 *   런북(opz_runbooks · 장애 종류별 할 일 목록 · 시드 6 · 고치면 판 +1) → 장애 열기(opz_incidents · 그때 단계를 복사 · opz.ir_enabled 처음 off)
 *   ★ 당번 호출은 새 길을 만들지 않음 — 운영 알림 OPZ_INCIDENT_OPEN(SEV1 ~ 3 모두 CRITICAL — 대표 11/21 「SEV1 ~ 3 모두 텔레그램」) 한 줄을 올리면
 *     기존 정기 작업 launch_watch 가 ① 대화방(alertPush) ② 오늘 당번 개인 텔레그램(oncallPush · D236) ③ 30분 확인 없으면 SUPER 개인 텔레그램으로 보냄.
 *     opz.ir_page_now(처음 off)를 켜면 열 때 오늘 당번에게 바로 한 통(TelegramService · 기존 봇 토큰 · staff_access.telegram_chat) — 보냈으면 그 알림의
 *     oncall_pushed_at 을 적어 launch_watch 가 당번에게 두 번 보내지 않게 함(30분 SUPER 길은 그대로).
 *   ★ 텔레그램 글은 정도 · 제목 · 런북 이름뿐(회원 정보 없음) · 실패 글에 주소 · 토큰을 남기지 않음(TelegramService 규칙)
 *   단계 체크(누가 · 언제) · 진행 기록 쌓기만(opz_incident_logs · DB 트리거) · 누그러뜨림 → 끝(한 방향 · 끝나면 그 운영 알림 「풀림」) ·
 *   끝난 뒤 되돌아보기(opz_incident_reviews · 확정하면 잠김 · opz.ir_review_days 지나면 OPZ_REVIEW_DUE)
 *   D272 가동 감시 · 장애 공지와 연결: 열 때 「공지도 올리기」(createIncident 재사용 · 사용자 웹 맨 위 띠) · 이미 있는 공지 잇기 ·
 *     끝낼 때 「공지도 끝냄」(addNote RESOLVED 재사용) · 화면에 「열 거리」 = 잇지 않은 열린 공지 · 24시간 안 UPTIME_DOWN · UPT_INCIDENT 알림
 * ------------------------------------------------------------------- */

export const OPZ_SEVS = ['SEV1', 'SEV2', 'SEV3'] as const;
export const OPZ_KINDS = ['SITE', 'API', 'DB', 'PAY', 'MAIL', 'SECURITY', 'DATA', 'OTHER'] as const;
export const OPZ_CODE_RE = /^[A-Z][A-Z0-9_]{1,29}$/;     // DB CHECK opz_runbooks.code 와 같음
export const OPZ_STEP_MAX = 30;
const SEV_TO_UPT: Record<string, string> = { SEV1: 'CRITICAL', SEV2: 'MAJOR', SEV3: 'MINOR' };
const SEV_TO_ALERT: Record<string, string> = { SEV1: 'CRITICAL', SEV2: 'CRITICAL', SEV3: 'CRITICAL' };   // 대표 11/21 — 정도와 상관없이 텔레그램 길(정도는 기록 · 공지 수준에만)
const PAGE_GAP_MS = 5 * 60_000;

const txt = (v: unknown, min: number, max: number, code: string, msg: string) => {
  const s = String(v ?? '').replace(/\r/g, '').trim();
  if (s.length < min || s.length > max) throw new PolicyViolation(code, msg);
  return s;
};
/** 번호 모양 — 글은 통째로 받음(영어 사전 키가 되도록 · 낱말을 끼워 넣지 않음) */
const idOk = (id: string, msg: string) => { if (!/^\d{1,18}$/.test(String(id))) throw new NotFound(msg); };
const me = () => RequestCtx.actorId() ?? null;

async function log(db: DatabaseService, incidentId: string, kind: string, body: string) {
  await db.query(`INSERT INTO opz_incident_logs (incident_id, kind, body, actor) VALUES ($1::bigint, $2, $3, $4)`, [incidentId, kind, body.slice(0, 1000), me()]);
}

/** 오늘 당번(한국 요일) — 운영자 · 개인 텔레그램 대화방 */
async function todayOncall(db: DatabaseService) {
  const [o] = await db.query<{ accountId: string | null; email: string | null; name: string | null; chat: string | null }>(
    `SELECT o.account_id AS "accountId", a.email::text AS email, a.name, s.telegram_chat AS chat
       FROM staff_oncall o LEFT JOIN accounts a ON a.id = o.account_id LEFT JOIN staff_access s ON s.account_id = o.account_id
      WHERE o.dow = extract(isodow FROM now() AT TIME ZONE 'Asia/Seoul')::int`);
  return o ?? { accountId: null, email: null, name: null, chat: null };
}

/* ── 런북 ── */
export interface OpzStepIn { title: string; detail?: string }
function cleanSteps(steps: unknown): Array<{ title: string; detail: string }> {
  const list = Array.isArray(steps) ? steps : [];
  if (list.length < 1 || list.length > OPZ_STEP_MAX) throw new PolicyViolation('OPZ_STEPS', `단계는 1 ~ ${OPZ_STEP_MAX}개입니다.`);
  return list.map((x) => ({
    title: txt((x as OpzStepIn)?.title, 2, 200, 'OPZ_STEPS', '단계 이름은 2 ~ 200자입니다.'),
    detail: String((x as OpzStepIn)?.detail ?? '').replace(/\r/g, '').trim().slice(0, 1000),
  }));
}
function cleanParts(parts: unknown): string[] {
  const p = Array.isArray(parts) ? [...new Set(parts.map(String))] : [];
  if (p.some((x) => !(UPT_PARTS as readonly string[]).includes(x))) throw new PolicyViolation('OPZ_PARTS', `영향 범위는 ${UPT_PARTS.join(' · ')} 중에서 고릅니다.`);
  return p;
}

export async function runbookDetail(db: DatabaseService, id: string) {
  idOk(id, '없는 런북입니다.');
  const [r] = await db.query(
    `SELECT id::text AS id, code, title, kind, sev_default AS "sevDefault", parts, summary, is_active AS "isActive", version, updated_at AS "updatedAt" FROM opz_runbooks WHERE id = $1::bigint`, [id]);
  if (!r) throw new NotFound('없는 런북입니다.');
  const steps = await db.query(`SELECT ord, title, detail FROM opz_runbook_steps WHERE runbook_id = $1::bigint ORDER BY ord`, [id]);
  return { runbook: r, steps, kinds: OPZ_KINDS, sevs: OPZ_SEVS, parts: UPT_PARTS };
}

export async function createRunbook(db: DatabaseService, d: { code: string; title: string; kind: string; sevDefault?: string; parts?: string[]; summary?: string; steps: OpzStepIn[] }) {
  const code = String(d.code ?? '').trim();
  if (!OPZ_CODE_RE.test(code)) throw new PolicyViolation('OPZ_CODE', '런북 코드는 영문 대문자로 시작하는 2 ~ 30자(대문자 · 숫자 · _)입니다.');
  const title = txt(d.title, 2, 80, 'OPZ_TITLE', '런북 이름은 2 ~ 80자입니다.');
  if (!(OPZ_KINDS as readonly string[]).includes(d.kind)) throw new PolicyViolation('OPZ_KIND', '장애 종류가 맞지 않습니다.');
  const sev = d.sevDefault ?? 'SEV2';
  if (!(OPZ_SEVS as readonly string[]).includes(sev)) throw new PolicyViolation('OPZ_SEV', '정도는 SEV1 · SEV2 · SEV3 중 하나입니다.');
  const parts = cleanParts(d.parts ?? []);
  const summary = String(d.summary ?? '').trim().slice(0, 500);
  const steps = cleanSteps(d.steps);
  const [dup] = await db.query(`SELECT 1 FROM opz_runbooks WHERE code = $1`, [code]);
  if (dup) throw new StateConflict('OPZ_CODE_TAKEN', '같은 코드의 런북이 있습니다.');
  const id = await db.transaction(async () => {
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO opz_runbooks (code, title, kind, sev_default, parts, summary, updated_by) VALUES ($1, $2, $3, $4, $5::text[], $6, $7) RETURNING id::text AS id`,
      [code, title, d.kind, sev, parts, summary, me()]);
    for (const [i, s] of steps.entries()) await db.query(`INSERT INTO opz_runbook_steps (runbook_id, ord, title, detail) VALUES ($1::bigint, $2::int, $3, $4)`, [r.id, i + 1, s.title, s.detail]);
    return r.id;
  });
  return { ok: true, id, note: '런북을 만들었습니다.' };
}

export async function saveRunbook(db: DatabaseService, id: string, d: { title?: string; kind?: string; sevDefault?: string; parts?: string[]; summary?: string; isActive?: boolean; steps?: OpzStepIn[] }) {
  idOk(id, '없는 런북입니다.');
  const [cur] = await db.query<{ id: string; title: string; kind: string; sevDefault: string; parts: string[]; summary: string; isActive: boolean }>(
    `SELECT id::text AS id, title, kind, sev_default AS "sevDefault", parts, summary, is_active AS "isActive" FROM opz_runbooks WHERE id = $1::bigint`, [id]);
  if (!cur) throw new NotFound('없는 런북입니다.');
  if (Object.values(d).every((v) => v === undefined)) throw new PolicyViolation('OPZ_NOTHING', '바꿀 것이 없습니다.');
  /* 규칙 11 — 안 보낸 칸은 옛 값 */
  const title = d.title !== undefined ? txt(d.title, 2, 80, 'OPZ_TITLE', '런북 이름은 2 ~ 80자입니다.') : cur.title;
  const kind = d.kind !== undefined ? d.kind : cur.kind;
  if (!(OPZ_KINDS as readonly string[]).includes(kind)) throw new PolicyViolation('OPZ_KIND', '장애 종류가 맞지 않습니다.');
  const sev = d.sevDefault !== undefined ? d.sevDefault : cur.sevDefault;
  if (!(OPZ_SEVS as readonly string[]).includes(sev)) throw new PolicyViolation('OPZ_SEV', '정도는 SEV1 · SEV2 · SEV3 중 하나입니다.');
  const parts = d.parts !== undefined ? cleanParts(d.parts) : cur.parts;
  const summary = d.summary !== undefined ? String(d.summary).trim().slice(0, 500) : cur.summary;
  const active = d.isActive !== undefined ? d.isActive : cur.isActive;
  const steps = d.steps !== undefined ? cleanSteps(d.steps) : null;
  const ver = await db.transaction(async () => {
    const [r] = await db.query<{ version: number }>(
      `UPDATE opz_runbooks SET title = $2, kind = $3, sev_default = $4, parts = $5::text[], summary = $6, is_active = $7, version = version + 1, updated_by = $8
        WHERE id = $1::bigint RETURNING version`,
      [cur.id, title, kind, sev, parts, summary, active, me()]);
    if (steps) {
      await db.query(`DELETE FROM opz_runbook_steps WHERE runbook_id = $1::bigint`, [cur.id]);
      for (const [i, s] of steps.entries()) await db.query(`INSERT INTO opz_runbook_steps (runbook_id, ord, title, detail) VALUES ($1::bigint, $2::int, $3, $4)`, [cur.id, i + 1, s.title, s.detail]);
    }
    return r?.version ?? null;
  });
  return { ok: true, id: cur.id, version: ver, note: '런북을 저장했습니다 — 이미 열린 장애는 열 때 복사한 단계를 그대로 씁니다.' };
}

/* ── 한눈에 ── */
export async function incidentBoard(db: DatabaseService, tg: TelegramService) {
  const s = await opzSettings(db);
  const [oc, tgs, runbooks, open, closed, uptOpen, alerts] = await Promise.all([
    todayOncall(db),
    tg.status().catch(() => ({ ready: false, reason: 'NO_TOKEN' as const, chat: null })),
    db.query(
      `SELECT r.id::text AS id, r.code, r.title, r.kind, r.sev_default AS "sevDefault", r.parts, r.summary, r.is_active AS "isActive", r.version,
              (SELECT count(*)::int FROM opz_runbook_steps x WHERE x.runbook_id = r.id) AS steps
         FROM opz_runbooks r ORDER BY r.is_active DESC, r.id`),
    db.query(
      `SELECT i.id::text AS id, i.title, i.sev, i.state, i.opened_at AS "openedAt", i.mitigated_at AS "mitigatedAt", i.page_result AS "pageResult",
              r.title AS runbook, i.upt_incident_id::text AS "uptIncidentId",
              (SELECT count(*)::int FROM opz_incident_steps x WHERE x.incident_id = i.id) AS steps,
              (SELECT count(*)::int FROM opz_incident_steps x WHERE x.incident_id = i.id AND x.done_at IS NOT NULL) AS done
         FROM opz_incidents i JOIN opz_runbooks r ON r.id = i.runbook_id
        WHERE i.state <> 'CLOSED' ORDER BY i.opened_at DESC LIMIT 50`),
    db.query(
      `SELECT i.id::text AS id, i.title, i.sev, i.opened_at AS "openedAt", i.closed_at AS "closedAt", r.title AS runbook,
              round(extract(epoch FROM (i.closed_at - i.opened_at)) / 60)::int AS minutes,
              v.finalized_at AS "reviewFinalizedAt", (v.incident_id IS NOT NULL) AS "hasReview"
         FROM opz_incidents i JOIN opz_runbooks r ON r.id = i.runbook_id LEFT JOIN opz_incident_reviews v ON v.incident_id = i.id
        WHERE i.state = 'CLOSED' ORDER BY i.closed_at DESC LIMIT 30`),
    db.query(
      `SELECT u.id::text AS id, u.title, u.level, u.state, u.started_at AS "startedAt"
         FROM upt_incidents u
        WHERE u.state <> 'RESOLVED' AND NOT EXISTS (SELECT 1 FROM opz_incidents i WHERE i.upt_incident_id = u.id AND i.state <> 'CLOSED')
        ORDER BY u.started_at DESC LIMIT 10`),
    db.query(
      `SELECT a.id::text AS id, a.alert_code AS code, a.severity, a.title, a.raised_at AS "raisedAt"
         FROM ops_alerts a
        WHERE a.alert_code IN ('UPTIME_DOWN', 'UPT_INCIDENT') AND a.raised_at > now() - interval '24 hours' AND a.resolved_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM opz_incidents i WHERE i.source_alert_id = a.id)
        ORDER BY a.raised_at DESC LIMIT 10`),
  ]);
  return {
    settings: s, open, closed, runbooks,
    oncall: { accountId: oc.accountId, email: maskMail(oc.email), name: oc.name, chat: !!oc.chat },
    telegram: { ready: tgs.ready, reason: tgs.reason },
    suggestions: { uptIncidents: uptOpen, alerts },
    sevs: OPZ_SEVS, kinds: OPZ_KINDS, parts: UPT_PARTS,
    isSuper: RequestCtx.get()?.actorRole === 'SUPER',
    note: '장애를 열면 정도와 상관없이 긴급 운영 알림이 올라가고, 기존 대화방 · 오늘 당번 개인 텔레그램 · 30분 확인 없으면 최고 관리자 길로 갑니다.',
  };
}

export async function incidentDetail(db: DatabaseService, id: string) {
  idOk(id, '없는 장애입니다.');
  const [i] = await db.query<{ id: string; uptIncidentId: string | null } & Record<string, unknown>>(
    `SELECT i.id::text AS id, i.title, i.sev, i.state, i.runbook_id::text AS "runbookId", i.runbook_version AS "runbookVersion", r.title AS runbook, r.code AS "runbookCode",
            i.opened_at AS "openedAt", i.mitigated_at AS "mitigatedAt", i.closed_at AS "closedAt", i.paged_at AS "pagedAt", i.page_result AS "pageResult",
            i.alert_id::text AS "alertId", i.source_alert_id::text AS "sourceAlertId", i.upt_incident_id::text AS "uptIncidentId",
            oa.name AS "openedBy", oc.name AS "oncallName",
            round(extract(epoch FROM (coalesce(i.mitigated_at, now()) - i.opened_at)) / 60)::int AS "minutesToMitigate",
            round(extract(epoch FROM (coalesce(i.closed_at, now()) - i.opened_at)) / 60)::int AS "minutesOpen"
       FROM opz_incidents i JOIN opz_runbooks r ON r.id = i.runbook_id
       LEFT JOIN accounts oa ON oa.id = i.opened_by LEFT JOIN accounts oc ON oc.id = i.oncall_account_id
      WHERE i.id = $1::bigint`, [id]);
  if (!i) throw new NotFound('없는 장애입니다.');
  const [steps, logs, reviewRows, upt] = await Promise.all([
    db.query(`SELECT s.id::text AS id, s.ord, s.title, s.detail, s.done_at AS "doneAt", a.name AS "doneBy" FROM opz_incident_steps s LEFT JOIN accounts a ON a.id = s.done_by WHERE s.incident_id = $1::bigint ORDER BY s.ord`, [id]),
    db.query(`SELECT l.id::text AS id, l.kind, l.body, l.at, a.name AS actor FROM opz_incident_logs l LEFT JOIN accounts a ON a.id = l.actor WHERE l.incident_id = $1::bigint ORDER BY l.id DESC LIMIT 300`, [id]),
    db.query(
      `SELECT v.summary, v.cause, v.impact, v.went_well AS "wentWell", v.improve, v.actions, v.created_at AS "createdAt", v.updated_at AS "updatedAt", v.finalized_at AS "finalizedAt", f.name AS "finalizedBy"
         FROM opz_incident_reviews v LEFT JOIN accounts f ON f.id = v.finalized_by WHERE v.incident_id = $1::bigint`, [id]),
    i.uptIncidentId ? db.query(`SELECT id::text AS id, title, level, state, banner FROM upt_incidents WHERE id = $1::bigint`, [i.uptIncidentId]) : Promise.resolve([]),
  ]);
  return { incident: i, steps, logs, review: reviewRows[0] ?? null, upt: upt[0] ?? null };
}

/* ── 열기 · 호출 ── */
export interface OpzPageResult { result: string; sent: boolean }

async function pageNow(db: DatabaseService, tg: TelegramService, inc: { id: string; title: string; sev: string; runbook: string; alertId: string | null }): Promise<OpzPageResult> {
  const st = await tg.status().catch(() => ({ ready: false, reason: 'NO_TOKEN' as const, chat: null }));
  const oc = await todayOncall(db);
  let result = 'SENT';
  if (st.reason === 'NO_TOKEN') result = 'NO_TOKEN';
  else if (!oc.accountId) result = 'NO_ONCALL';
  else if (!oc.chat) result = 'ONCALL_NO_CHAT';
  else {
    const r = await tg.send(`[소개뱅크 장애 대응] ${inc.sev} · ${inc.title}\n런북: ${inc.runbook}\n운영 화면 › 위험감지 › 장애 대응에서 단계를 확인하십시오.`, oc.chat);
    result = r.ok ? 'SENT' : `SEND_${r.errorKind ?? 'FAILED'}`;
  }
  const sent = result === 'SENT';
  await db.query(`UPDATE opz_incidents SET paged_at = now(), page_result = $2, oncall_account_id = coalesce(oncall_account_id, $3::uuid) WHERE id = $1::bigint AND state <> 'CLOSED'`, [inc.id, result, oc.accountId]);
  /* 바로 보냈으면 launch_watch 의 당번 보내기는 건너뜀(30분 SUPER 길은 그대로) */
  if (sent && inc.alertId) await db.query(`UPDATE ops_alerts SET oncall_pushed_at = now() WHERE id = $1::bigint AND oncall_pushed_at IS NULL`, [inc.alertId]).catch(() => undefined);
  await log(db, inc.id, 'PAGE', sent ? `오늘 당번에게 텔레그램으로 바로 호출했습니다(${oc.name ?? '당번'}).` : `바로 호출하지 못했습니다 — ${result}(운영 알림은 기존 길로 갑니다).`);
  return { result, sent };
}

export async function openIncident(db: DatabaseService, tg: TelegramService, d: {
  runbookId: string; title?: string; sev?: string; sourceAlertId?: string; uptNotice?: boolean; publicTitle?: string; publicBody?: string; note?: string;
}) {
  const s = await opzSettings(db);
  if (!s.irOn) throw new PolicyViolation('OPZ_IR_OFF', '장애 대응 열기가 꺼져 있습니다(opz.ir_enabled) — 최고 관리자가 설정에서 켜야 합니다.');
  idOk(d.runbookId, '없는 런북입니다.');
  const [rb] = await db.query<{ id: string; title: string; sevDefault: string; version: number; parts: string[]; isActive: boolean }>(
    `SELECT id::text AS id, title, sev_default AS "sevDefault", version, parts, is_active AS "isActive" FROM opz_runbooks WHERE id = $1::bigint`, [d.runbookId]);
  if (!rb || !rb.isActive) throw new PolicyViolation('OPZ_RUNBOOK', '켜진 런북을 고르십시오.');
  const title = d.title !== undefined ? txt(d.title, 2, 120, 'OPZ_TITLE', '장애 제목은 2 ~ 120자입니다.') : rb.title;
  const sev = d.sev ?? rb.sevDefault;
  if (!(OPZ_SEVS as readonly string[]).includes(sev)) throw new PolicyViolation('OPZ_SEV', '정도는 SEV1 · SEV2 · SEV3 중 하나입니다.');
  let source: string | null = null;
  if (d.sourceAlertId !== undefined && d.sourceAlertId !== null && String(d.sourceAlertId) !== '') {
    if (!/^\d{1,18}$/.test(String(d.sourceAlertId))) throw new PolicyViolation('OPZ_ALERT', '운영 알림 번호가 맞지 않습니다.');
    const [a] = await db.query(`SELECT 1 FROM ops_alerts WHERE id = $1::bigint`, [d.sourceAlertId]);
    if (!a) throw new PolicyViolation('OPZ_ALERT', '없는 운영 알림입니다.');
    const [taken] = await db.query<{ id: string }>(`SELECT id::text AS id FROM opz_incidents WHERE source_alert_id = $1::bigint`, [d.sourceAlertId]);
    if (taken) throw new StateConflict('OPZ_ALREADY_OPEN', `이 운영 알림으로 이미 연 장애가 있습니다(#${taken.id}).`);
    source = String(d.sourceAlertId);
  }
  const note = d.note !== undefined && String(d.note).trim() ? txt(d.note, 2, 1000, 'OPZ_NOTE', '메모는 2 ~ 1,000자입니다.') : null;
  const oc = await todayOncall(db);
  const actor = me();
  const out = await db.transaction(async () => {
    const [i] = await db.query<{ id: string }>(
      `INSERT INTO opz_incidents (runbook_id, runbook_version, title, sev, oncall_account_id, source_alert_id, opened_by)
       VALUES ($1::bigint, $2::int, $3, $4, $5::uuid, $6::bigint, $7) RETURNING id::text AS id`,
      [rb.id, rb.version, title, sev, oc.accountId, source, actor]);
    await db.query(
      `INSERT INTO opz_incident_steps (incident_id, ord, title, detail) SELECT $1::bigint, ord, title, detail FROM opz_runbook_steps WHERE runbook_id = $2::bigint ORDER BY ord`,
      [i.id, rb.id]);
    await log(db, i.id, 'OPEN', `${sev} · ${title} — 런북 「${rb.title}」 판 ${rb.version}로 열었습니다.${note ? `\n${note}` : ''}`);
    const [al] = await db.query<{ id: string }>(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('OPZ_INCIDENT_OPEN', $1, $2, $3::jsonb, clock_timestamp())
       ON CONFLICT DO NOTHING RETURNING id::text AS id`,
      [SEV_TO_ALERT[sev], `장애 대응 열림 — ${sev} · ${title} — 위험감지 › 장애 대응`.slice(0, 300), JSON.stringify({ incident: i.id, sev, runbook: rb.id })]);
    if (al) await db.query(`UPDATE opz_incidents SET alert_id = $2::bigint WHERE id = $1::bigint`, [i.id, al.id]);
    return { id: i.id, alertId: al?.id ?? null };
  });
  /* D272 장애 공지 — 같은 거래 밖(공지 쪽 함수가 자기 거래를 씀) · 실패해도 장애 기록은 남김 */
  let upt: string | null = null; let uptError: string | null = null;
  if (d.uptNotice) {
    try {
      const r = await createIncident(db, {
        title: d.publicTitle !== undefined && String(d.publicTitle).trim() ? String(d.publicTitle) : title, level: SEV_TO_UPT[sev]!, parts: rb.parts,
        body: d.publicBody !== undefined && String(d.publicBody).trim() ? String(d.publicBody) : '서비스 이용에 문제가 있어 원인을 확인하고 있습니다.', banner: true, notifyOps: false,
      });
      upt = r.id;
      await db.query(`UPDATE opz_incidents SET upt_incident_id = $2::bigint WHERE id = $1::bigint`, [out.id, upt]);
      await log(db, out.id, 'UPT', `장애 공지 #${upt} 를 올렸습니다(사용자 웹 맨 위 띠).`);
    } catch (e) {
      uptError = String((e as { response?: { message?: string } })?.response?.message ?? (e as Error)?.message ?? 'error').slice(0, 200);
      await log(db, out.id, 'UPT', `장애 공지를 올리지 못했습니다 — ${uptError}`);
    }
  }
  const page = s.irPageNow ? await pageNow(db, tg, { id: out.id, title, sev, runbook: rb.title, alertId: out.alertId }) : { result: 'OFF', sent: false };
  if (!s.irPageNow) await db.query(`UPDATE opz_incidents SET page_result = 'OFF' WHERE id = $1::bigint`, [out.id]);
  await opzAudit(db, 'OPZ_IR_OPENED', { incidentId: out.id, sev, runbook: rb.id, alertId: out.alertId, upt, page: page.result });
  return {
    ok: true, id: out.id, alertId: out.alertId, uptIncidentId: upt, uptError, page,
    note: page.sent ? '장애를 열고 오늘 당번에게 바로 호출했습니다.' : '장애를 열었습니다 — 운영 알림이 기존 길(대화방 · 당번 · 30분 최고 관리자)로 갑니다.',
  };
}

async function openRow(db: DatabaseService, id: string) {
  idOk(id, '없는 장애입니다.');
  const [i] = await db.query<{ id: string; title: string; sev: string; state: string; runbook: string; alertId: string | null; pagedAt: Date | null; uptIncidentId: string | null }>(
    `SELECT i.id::text AS id, i.title, i.sev, i.state, r.title AS runbook, i.alert_id::text AS "alertId", i.paged_at AS "pagedAt", i.upt_incident_id::text AS "uptIncidentId"
       FROM opz_incidents i JOIN opz_runbooks r ON r.id = i.runbook_id WHERE i.id = $1::bigint`, [id]);
  if (!i) throw new NotFound('없는 장애입니다.');
  return i;
}

export async function pageAgain(db: DatabaseService, tg: TelegramService, id: string) {
  const i = await openRow(db, id);
  if (i.state === 'CLOSED') throw new StateConflict('OPZ_STATE', '끝난 장애입니다.');
  const s = await opzSettings(db);
  if (!s.irPageNow) throw new PolicyViolation('OPZ_PAGE_OFF', '바로 호출이 꺼져 있습니다(opz.ir_page_now) — 운영 알림은 기존 길로 갑니다.');
  if (i.pagedAt && Date.now() - new Date(i.pagedAt).getTime() < PAGE_GAP_MS) throw new PolicyViolation('OPZ_PAGE_WAIT', '호출은 5분에 한 번입니다.');
  const page = await pageNow(db, tg, i);
  return { ok: page.sent, id: i.id, page, note: page.sent ? '오늘 당번에게 다시 호출했습니다.' : `호출하지 못했습니다 — ${page.result}` };
}

/* ── 진행 ── */
export async function checkStep(db: DatabaseService, id: string, stepId: string, done: boolean) {
  const i = await openRow(db, id);
  if (i.state === 'CLOSED') throw new StateConflict('OPZ_STATE', '끝난 장애의 단계는 바꾸지 않습니다.');
  if (!/^\d{1,18}$/.test(String(stepId))) throw new NotFound('없는 단계입니다.');
  const [st] = await db.query<{ id: string; ord: number; title: string; doneAt: Date | null }>(
    `SELECT id::text AS id, ord, title, done_at AS "doneAt" FROM opz_incident_steps WHERE id = $1::bigint AND incident_id = $2::bigint`, [stepId, i.id]);
  if (!st) throw new NotFound('없는 단계입니다.');
  if (!!st.doneAt === done) throw new StateConflict('OPZ_STEP_SAME', done ? '이미 끝낸 단계입니다.' : '아직 끝내지 않은 단계입니다.');
  await db.transaction(async () => {
    await db.query(`UPDATE opz_incident_steps SET done_at = CASE WHEN $2::boolean THEN now() END, done_by = CASE WHEN $2::boolean THEN $3::uuid END WHERE id = $1::bigint`, [st.id, done, me()]);
    await log(db, i.id, done ? 'STEP_DONE' : 'STEP_UNDO', `${st.ord}. ${st.title}`);
  });
  return { ok: true, id: i.id, stepId: st.id, done, note: done ? '단계를 끝냈습니다.' : '단계 끝냄을 되돌렸습니다.' };
}

export async function addIncidentNote(db: DatabaseService, id: string, body: string) {
  const i = await openRow(db, id);
  if (i.state === 'CLOSED') throw new StateConflict('OPZ_STATE', '끝난 장애에는 진행 기록을 더하지 않습니다 — 되돌아보기에 적으십시오.');
  const b = txt(body, 2, 1000, 'OPZ_NOTE', '메모는 2 ~ 1,000자입니다.');
  await log(db, i.id, 'NOTE', b);
  return { ok: true, id: i.id, note: '진행 기록에 더했습니다.' };
}

export async function setIncidentState(db: DatabaseService, id: string, d: { state: string; body?: string; resolveNotice?: boolean; resolveBody?: string }) {
  const i = await openRow(db, id);
  if (!['MITIGATED', 'CLOSED'].includes(d.state)) throw new PolicyViolation('OPZ_STATE_TO', '바꿀 상태는 MITIGATED(누그러뜨림) · CLOSED(끝) 중 하나입니다.');
  const okMove = (i.state === 'OPEN' && ['MITIGATED', 'CLOSED'].includes(d.state)) || (i.state === 'MITIGATED' && d.state === 'CLOSED');
  if (!okMove) throw new StateConflict('OPZ_STATE', '장애 상태는 되돌리지 않습니다 — 다시 생기면 새로 여십시오.');
  const body = d.body !== undefined && String(d.body).trim() ? txt(d.body, 2, 1000, 'OPZ_NOTE', '메모는 2 ~ 1,000자입니다.') : null;
  const actor = me();
  /* 공지 끝냄은 장애를 끝내기 전에(끝난 장애에는 진행 기록을 더하지 못함) */
  let uptDone: string | null = null; let uptError: string | null = null;
  if (d.state === 'CLOSED' && d.resolveNotice && i.uptIncidentId) {
    try {
      const [u] = await db.query<{ state: string }>(`SELECT state FROM upt_incidents WHERE id = $1::bigint`, [i.uptIncidentId]);
      if (u && u.state !== 'RESOLVED') {
        await addNote(db, i.uptIncidentId, { state: 'RESOLVED', body: d.resolveBody !== undefined && String(d.resolveBody).trim() ? String(d.resolveBody) : '복구했습니다. 이용에 불편이 없는지 계속 지켜보겠습니다.' });
        uptDone = i.uptIncidentId;
        await log(db, i.id, 'UPT', `장애 공지 #${i.uptIncidentId} 를 끝냈습니다.`);
      }
    } catch (e) {
      uptError = String((e as { response?: { message?: string } })?.response?.message ?? (e as Error)?.message ?? 'error').slice(0, 200);
      await log(db, i.id, 'UPT', `장애 공지를 끝내지 못했습니다 — ${uptError}`);
    }
  }
  await db.transaction(async () => {
    await log(db, i.id, 'STATE', `${i.state} → ${d.state}${body ? `\n${body}` : ''}`);
    const [u] = await db.query(
      `UPDATE opz_incidents SET state = $2, mitigated_at = coalesce(mitigated_at, now()),
              closed_at = CASE WHEN $2 = 'CLOSED' THEN now() ELSE closed_at END, closed_by = CASE WHEN $2 = 'CLOSED' THEN $3::uuid ELSE closed_by END
        WHERE id = $1::bigint AND state = $4 RETURNING id`, [i.id, d.state, actor, i.state]);
    if (!u) throw new StateConflict('OPZ_STATE', '다른 사람이 먼저 바꿨습니다 — 새로 고침 하십시오.');
    /* 그 운영 알림 「풀림」 — 30분 SUPER 길 · 다시 메일을 멈춤(확인 기록은 사람 몫이라 건드리지 않음) */
    if (i.alertId) await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = $2 WHERE id = $1::bigint AND resolved_at IS NULL`, [i.alertId, `장애 대응 #${i.id} ${d.state}`]);
    if (d.state === 'CLOSED') {
      await db.query(
        `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('OPZ_INCIDENT_CLOSED', 'INFO', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
        [`장애 대응 끝 — ${i.sev} · ${i.title} — 되돌아보기를 쓰십시오`.slice(0, 300), JSON.stringify({ incident: i.id })]);
    }
  });
  return { ok: true, id: i.id, state: d.state, uptResolved: uptDone, uptError,
    note: d.state === 'CLOSED' ? '장애를 끝냈습니다 — 되돌아보기를 쓰고 확정하십시오.' : '누그러뜨림으로 바꿨습니다 — 다 고치면 끝으로 바꾸십시오.' };
}

/** D272 장애 공지 잇기 — 이미 있는 공지 번호 또는 새로 올리기 */
export async function linkUpt(db: DatabaseService, id: string, d: { uptIncidentId?: string; create?: boolean; publicTitle?: string; publicBody?: string }) {
  const i = await openRow(db, id);
  if (i.state === 'CLOSED') throw new StateConflict('OPZ_STATE', '끝난 장애입니다.');
  let uptId: string;
  if (d.create) {
    const [rb] = await db.query<{ parts: string[] }>(`SELECT r.parts FROM opz_incidents x JOIN opz_runbooks r ON r.id = x.runbook_id WHERE x.id = $1::bigint`, [i.id]);
    const r = await createIncident(db, {
      title: d.publicTitle !== undefined && String(d.publicTitle).trim() ? String(d.publicTitle) : i.title, level: SEV_TO_UPT[i.sev]!, parts: rb?.parts ?? [],
      body: d.publicBody !== undefined && String(d.publicBody).trim() ? String(d.publicBody) : '서비스 이용에 문제가 있어 원인을 확인하고 있습니다.', banner: true, notifyOps: false,
    });
    uptId = r.id;
  } else {
    if (!/^\d{1,18}$/.test(String(d.uptIncidentId ?? ''))) throw new PolicyViolation('OPZ_UPT', '장애 공지 번호를 넣거나 「새로 올리기」를 고르십시오.');
    const [u] = await db.query<{ id: string }>(`SELECT id::text AS id FROM upt_incidents WHERE id = $1::bigint`, [d.uptIncidentId]);
    if (!u) throw new PolicyViolation('OPZ_UPT', '없는 장애 공지입니다.');
    uptId = u.id;
  }
  await db.transaction(async () => {
    await db.query(`UPDATE opz_incidents SET upt_incident_id = $2::bigint WHERE id = $1::bigint`, [i.id, uptId]);
    await log(db, i.id, 'UPT', d.create ? `장애 공지 #${uptId} 를 올렸습니다(사용자 웹 맨 위 띠).` : `장애 공지 #${uptId} 와 이었습니다.`);
  });
  return { ok: true, id: i.id, uptIncidentId: uptId, note: d.create ? '장애 공지를 올리고 이었습니다.' : '장애 공지와 이었습니다.' };
}

/* ── 되돌아보기 ── */
export async function saveReview(db: DatabaseService, id: string, d: { summary?: string; cause?: string; impact?: string; wentWell?: string; improve?: string; actions?: string }) {
  const i = await openRow(db, id);
  if (i.state !== 'CLOSED') throw new StateConflict('OPZ_REVIEW_STATE', '되돌아보기는 장애를 끝낸 뒤에 씁니다.');
  const [cur] = await db.query<{ summary: string; cause: string; impact: string; wentWell: string; improve: string; actions: string; finalizedAt: Date | null }>(
    `SELECT summary, cause, impact, went_well AS "wentWell", improve, actions, finalized_at AS "finalizedAt" FROM opz_incident_reviews WHERE incident_id = $1::bigint`, [i.id]);
  if (cur?.finalizedAt) throw new StateConflict('OPZ_REVIEW_FINAL', '확정한 되돌아보기는 고치지 않습니다.');
  const pick = (v: string | undefined, old: string, max: number) => (v !== undefined ? String(v).replace(/\r/g, '').trim().slice(0, max) : old);
  const v = {
    summary: d.summary !== undefined ? txt(d.summary, 2, 2000, 'OPZ_REVIEW', '요약은 2 ~ 2,000자입니다.') : (cur?.summary ?? ''),
    cause: pick(d.cause, cur?.cause ?? '', 2000), impact: pick(d.impact, cur?.impact ?? '', 1000), wentWell: pick(d.wentWell, cur?.wentWell ?? '', 1000),
    improve: pick(d.improve, cur?.improve ?? '', 2000), actions: pick(d.actions, cur?.actions ?? '', 2000),
  };
  if (v.summary.length < 2) throw new PolicyViolation('OPZ_REVIEW', '요약은 2 ~ 2,000자입니다.');
  await db.transaction(async () => {
    await db.query(
      `INSERT INTO opz_incident_reviews (incident_id, summary, cause, impact, went_well, improve, actions, created_by, updated_by)
       VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8, $8)
       ON CONFLICT (incident_id) DO UPDATE SET summary = EXCLUDED.summary, cause = EXCLUDED.cause, impact = EXCLUDED.impact, went_well = EXCLUDED.went_well,
              improve = EXCLUDED.improve, actions = EXCLUDED.actions, updated_by = EXCLUDED.updated_by`,
      [i.id, v.summary, v.cause, v.impact, v.wentWell, v.improve, v.actions, me()]);
    await log(db, i.id, 'REVIEW', cur ? '되돌아보기를 고쳤습니다.' : '되돌아보기를 썼습니다.');
  });
  return { ok: true, id: i.id, note: '되돌아보기를 저장했습니다 — 다 쓰면 「확정」을 누르십시오(확정하면 잠김).' };
}

export async function finalizeReview(db: DatabaseService, id: string, confirm: string) {
  const i = await openRow(db, id);
  if ((confirm ?? '').trim() !== '확정') throw new PolicyViolation('OPZ_REVIEW_CONFIRM', '확인 칸에 「확정」을 넣어 주십시오.');
  const [cur] = await db.query<{ finalizedAt: Date | null }>(`SELECT finalized_at AS "finalizedAt" FROM opz_incident_reviews WHERE incident_id = $1::bigint`, [i.id]);
  if (!cur) throw new StateConflict('OPZ_REVIEW_STATE', '되돌아보기를 먼저 쓰십시오.');
  if (cur.finalizedAt) throw new StateConflict('OPZ_REVIEW_FINAL', '이미 확정한 되돌아보기입니다.');
  await db.transaction(async () => {
    await db.query(`UPDATE opz_incident_reviews SET finalized_at = now(), finalized_by = $2 WHERE incident_id = $1::bigint AND finalized_at IS NULL`, [i.id, me()]);
    await log(db, i.id, 'REVIEW', '되돌아보기를 확정했습니다.');
  });
  return { ok: true, id: i.id, note: '되돌아보기를 확정했습니다.' };
}
