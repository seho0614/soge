import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { maskName } from '../../common/mask';
import { storageFromEnv } from '../file/storage';

/* ---------------------------------------------------------------------
 * v10.547 (D285 · docs/685) 서류 보관 기한 관리 — 대표 11/20 「(55) ②」
 *   보관 기간 표(sfx_retention_rules · 파일 용도마다) · 보관 대장(sfx_doc_retention · 파일마다 · 만료일은 DB 트리거가 셈)
 *   파일 용도는 기존 HR_DOC(㉛) · LGL_DOC(D269) · ACCT_EVIDENCE(D245) · CORP_DOC(D253) 그대로 — 새 용도 없음
 *   만료 알림은 처음 꺼짐(sfx.retention_alert) · 파기는 SUPER 가 「파기」 입력 + 사유 · 만료 전 · 법정 보관(보존) 중이면 막음(서버 + DB 두 겹)
 *   파기 = 대장 DESTROYED → files.status DELETED(다른 대장에 붙은 서류면 기존 트리거가 막음 → 409) → 파기 기록(쌓기만) → 저장소 바이트 지움(커밋 뒤)
 *   ★ 세무사(ACCOUNTANT)는 /admin/acct/ 접두가 아니라 보지 않음(규칙 8) — 회계 증빙의 보관 기한도 운영 관리자 · SUPER 화면
 * ------------------------------------------------------------------- */

export const RET_PURPOSES = ['ACCT_EVIDENCE', 'HR_DOC', 'LGL_DOC', 'CORP_DOC'] as const;
export const RET_STATES = ['KEEP', 'DESTROYED', 'GONE'] as const;
/** DB CHECK sfx_doc_retention.base_date >= 2000-01-01 · 서버 DTO 와 같음(규칙 2) */
export const RET_DATE_RE = /^(20[0-9]{2})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const n = (v: unknown) => Number(v ?? 0);
const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const x = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
};
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

/** 파기 기록에 남기는 파일 이름 — 앞 두 글자 + 확장자만(이력서 이름 같은 개인정보를 기록에 남기지 않음) */
export function maskFileName(name: string | null | undefined): string {
  const s = String(name ?? '').trim();
  if (!s) return '(이름 없음)';
  const dot = s.lastIndexOf('.');
  const ext = dot > 0 && s.length - dot <= 6 ? s.slice(dot) : '';
  const head = (dot > 0 && ext ? s.slice(0, dot) : s).slice(0, 2);
  return `${head}***${ext}`.slice(0, 80);
}

async function retSettings(db: DatabaseService) {
  const [s] = await db.query<Record<string, string | null>>(
    `SELECT (SELECT value FROM site_settings WHERE key = 'sfx.retention_alert') AS sw,
            (SELECT value FROM site_settings WHERE key = 'sfx.retention_alert_days') AS days`);
  return { alertOn: s?.sw === 'on', alertDays: clampInt(s?.days, 7, 90, 30) };
}

/** GET /admin/sfx/retention/rules — 보관 기간 표 · 용도마다 대장 수(보관 · 곧 만료 · 지남 · 보존 · 파기) · 대장에 아직 없는 READY 파일 수 */
export async function retentionRules(db: DatabaseService) {
  const s = await retSettings(db);
  const rows = await db.query<Record<string, unknown>>(
    `SELECT r.code, r.name, r.purpose, r.months, r.min_months AS "minMonths", r.basis, r.base_hint AS "baseHint", r.is_active AS active, r.updated_at AS "updatedAt",
            (SELECT count(*) FROM sfx_doc_retention d WHERE d.rule_code = r.code AND d.state = 'KEEP')::int AS keep,
            (SELECT count(*) FROM sfx_doc_retention d WHERE d.rule_code = r.code AND d.state = 'KEEP' AND NOT d.legal_hold
               AND d.expires_on > (now() AT TIME ZONE 'Asia/Seoul')::date AND d.expires_on <= (now() AT TIME ZONE 'Asia/Seoul')::date + $1::int)::int AS soon,
            (SELECT count(*) FROM sfx_doc_retention d WHERE d.rule_code = r.code AND d.state = 'KEEP' AND NOT d.legal_hold AND d.expires_on <= (now() AT TIME ZONE 'Asia/Seoul')::date)::int AS over,
            (SELECT count(*) FROM sfx_doc_retention d WHERE d.rule_code = r.code AND d.state = 'KEEP' AND d.legal_hold)::int AS held,
            (SELECT count(*) FROM sfx_doc_retention d WHERE d.rule_code = r.code AND d.state = 'DESTROYED')::int AS destroyed,
            (SELECT count(*) FROM files f WHERE f.purpose = r.purpose AND f.status = 'READY' AND NOT EXISTS (SELECT 1 FROM sfx_doc_retention d WHERE d.file_id = f.id))::int AS unlisted
       FROM sfx_retention_rules r ORDER BY r.code`, [s.alertDays]);
  return {
    ...s, rules: rows,
    note: s.alertOn
      ? `매일 05:20 대장을 맞추고 만료 ${s.alertDays}일 전 · 지난 서류를 운영 알림으로 한 번 알립니다. 파기는 SUPER 가 이 화면에서 합니다.`
      : '알림이 꺼져 있습니다(sfx.retention_alert) — 「대장 맞추기」로 지금 서류를 넣고 보관 기간을 확인한 뒤 켜십시오.',
  };
}

/** PUT /admin/sfx/retention/rules/{code} — 개월 · 켜기(SUPER) · 법정 최소 밑이면 422 · 남은 줄의 만료일은 DB 가 다시 셈 */
export async function retentionRuleEdit(db: DatabaseService, code: string, v: { months?: number; active?: boolean }, actor: string | null) {
  if (v.months === undefined && v.active === undefined) throw new PolicyViolation('SFX_RET_NOTHING', '바꿀 칸(개월 · 켜기)을 보내 주십시오.');
  const [r] = await db.query<{ code: string; min_months: number; months: number }>(`SELECT code, min_months, months FROM sfx_retention_rules WHERE code = $1::text`, [String(code ?? '')]);
  if (!r) throw new NotFound('보관 기간 줄을 찾을 수 없습니다.');
  if (v.months !== undefined && (!Number.isInteger(v.months) || v.months < r.min_months || v.months > 600)) {
    throw new PolicyViolation('SFX_RET_MIN', `보관 기간은 법정 최소 ${r.min_months}개월 ~ 600개월입니다.`);
  }
  const [u] = await db.query<Record<string, unknown>>(
    `UPDATE sfx_retention_rules SET months = coalesce($2::int, months), is_active = coalesce($3::boolean, is_active), updated_by = $4::uuid
      WHERE code = $1::text RETURNING code, months, is_active AS active, updated_at AS "updatedAt"`,
    [r.code, v.months ?? null, v.active ?? null, actor]);
  return { ok: true, ...u, before: { months: r.months }, note: '고쳤습니다 — 보관 중인 서류의 만료일을 다시 셈했습니다.' };
}

/** GET /admin/sfx/retention?state=&purpose=&due=&hold= — 보관 대장(만료일 순 · 200) */
export async function retentionList(db: DatabaseService, q: { state?: string; purpose?: string; due?: string; hold?: string }) {
  const s = await retSettings(db);
  const state = q.state === 'ALL' ? null : (RET_STATES as readonly string[]).includes(String(q.state)) ? String(q.state) : 'KEEP';
  const purpose = (RET_PURPOSES as readonly string[]).includes(String(q.purpose)) ? String(q.purpose) : null;
  const due = q.due === 'soon' || q.due === 'over' ? q.due : null;
  const hold = q.hold === '1';
  const rows = await db.query<Record<string, unknown>>(
    `SELECT d.file_id::text AS "fileId", f.purpose, r.name AS "ruleName", f.original_name AS "fileName", f.size_bytes::bigint AS size, f.status AS "fileStatus",
            f.created_at AS "uploadedAt", d.base_date::text AS "baseDate", d.expires_on::text AS "expiresOn", d.state, d.legal_hold AS hold, d.hold_reason AS "holdReason",
            d.hold_at AS "holdAt", d.alerted_on::text AS "alertedOn",
            (d.expires_on - (now() AT TIME ZONE 'Asia/Seoul')::date)::int AS "daysLeft", a.name AS owner
       FROM sfx_doc_retention d JOIN files f ON f.id = d.file_id JOIN sfx_retention_rules r ON r.code = d.rule_code
       LEFT JOIN accounts a ON a.id = f.owner_account_id
      WHERE ($1::text IS NULL OR d.state = $1::text)
        AND ($2::text IS NULL OR f.purpose = $2::text)
        AND ($3::text IS NULL
             OR ($3::text = 'over' AND d.state = 'KEEP' AND d.expires_on <= (now() AT TIME ZONE 'Asia/Seoul')::date)
             OR ($3::text = 'soon' AND d.state = 'KEEP' AND d.expires_on > (now() AT TIME ZONE 'Asia/Seoul')::date AND d.expires_on <= (now() AT TIME ZONE 'Asia/Seoul')::date + $5::int))
        AND (NOT $4::boolean OR d.legal_hold)
      ORDER BY d.expires_on, d.file_id
      LIMIT 200`, [state, purpose, due, hold, s.alertDays]);
  return {
    ...s, filter: { state: state ?? 'ALL', purpose, due, hold }, today: todayKst(),
    rows: rows.map((r) => ({ ...r, size: n(r.size), owner: maskName(r.owner as string | null), canDestroy: r.state === 'KEEP' && !r.hold && n(r.daysLeft) <= 0 })),
  };
}

/** POST /admin/sfx/retention/sync — 대장 맞추기(새 READY 파일 넣기 · 지운 파일 GONE) */
export async function retentionSync(db: DatabaseService) {
  const [r] = await db.query<{ added: number; gone: number }>(`SELECT added, gone FROM fn_sfx_retention_sync()`);
  return { ok: true, added: n(r?.added), gone: n(r?.gone), note: `대장을 맞췄습니다 — 새로 넣음 ${n(r?.added)} · 없어짐 ${n(r?.gone)}.` };
}

/** PUT /admin/sfx/retention/{fileId} — 기준일 · 법정 보관(보존) 걸기 · 풀기(SUPER · 사유 · 감사 SFX_RET_EDIT) */
export async function retentionEdit(db: DatabaseService, fileId: string, v: { baseDate?: string; hold?: boolean; holdReason?: string; reason: string }, actor: string | null) {
  if (!UUID.test(String(fileId ?? ''))) throw new NotFound('보관 대장에 없는 서류입니다.');
  const reason = clean(v.reason);
  if (reason.length < 2 || reason.length > 300) throw new PolicyViolation('SFX_RET_REASON', '사유는 2 ~ 300자입니다.');
  if (v.baseDate === undefined && v.hold === undefined) throw new PolicyViolation('SFX_RET_NOTHING', '바꿀 칸(기준일 · 보존)을 보내 주십시오.');
  if (v.baseDate !== undefined && (!RET_DATE_RE.test(v.baseDate) || Number.isNaN(Date.parse(`${v.baseDate}T00:00:00Z`)) || v.baseDate > todayKst())) {
    throw new PolicyViolation('SFX_RET_BASE', '기준일은 2000-01-01 부터 오늘까지의 날짜(YYYY-MM-DD)입니다.');
  }
  const holdReason = clean(v.holdReason);
  if (v.hold === true && (holdReason.length < 2 || holdReason.length > 300)) throw new PolicyViolation('SFX_RET_HOLD_REASON', '법정 보관(보존) 까닭은 2 ~ 300자입니다(예: 소송 · 세무조사 · 수사 협조).');
  return db.transaction(async () => {
    const [d] = await db.query<{ state: string; legal_hold: boolean; base_date: string; expires_on: string }>(
      `SELECT state, legal_hold, base_date::text AS base_date, expires_on::text AS expires_on FROM sfx_doc_retention WHERE file_id = $1::uuid FOR UPDATE`, [fileId]);
    if (!d) throw new NotFound('보관 대장에 없는 서류입니다.');
    if (d.state !== 'KEEP') throw new StateConflict('SFX_RET_STATE', '파기했거나 없어진 서류는 고칠 수 없습니다.');
    const [u] = await db.query<Record<string, unknown>>(
      `UPDATE sfx_doc_retention
          SET base_date = coalesce($2::date, base_date),
              legal_hold = coalesce($3::boolean, legal_hold),
              hold_reason = CASE WHEN $3::boolean IS TRUE THEN $4::text WHEN $3::boolean IS FALSE THEN NULL ELSE hold_reason END,
              hold_by = CASE WHEN $3::boolean IS NULL THEN hold_by ELSE $5::uuid END,
              hold_at = CASE WHEN $3::boolean IS NULL THEN hold_at ELSE clock_timestamp() END
        WHERE file_id = $1::uuid
        RETURNING file_id::text AS "fileId", base_date::text AS "baseDate", expires_on::text AS "expiresOn", legal_hold AS hold, hold_reason AS "holdReason"`,
      [fileId, v.baseDate ?? null, v.hold ?? null, v.hold === true ? holdReason : null, actor]);
    return { ok: true, ...u, reason, before: { baseDate: d.base_date, expiresOn: d.expires_on, hold: d.legal_hold }, note: '고쳤습니다.' };
  });
}

/** POST /admin/sfx/retention/{fileId}/destroy — 파기(SUPER · 「파기」 입력 · 사유) · 만료 전 · 보존 · 다른 대장에 붙음이면 409 */
export async function retentionDestroy(db: DatabaseService, fileId: string, v: { reason: string; confirm: string }, actor: string | null) {
  if (!UUID.test(String(fileId ?? ''))) throw new NotFound('보관 대장에 없는 서류입니다.');
  const reason = clean(v.reason);
  if (reason.length < 2 || reason.length > 300) throw new PolicyViolation('SFX_RET_REASON', '사유는 2 ~ 300자입니다.');
  if (String(v.confirm ?? '').trim() !== '파기') throw new PolicyViolation('SFX_RET_CONFIRM', '확인 칸에 「파기」를 입력하십시오.');
  const t = await db.transaction(async () => {
    const [r] = await db.query<{ state: string; legal_hold: boolean; base_date: string; expires_on: string; due: boolean; rule_code: string; purpose: string;
      original_name: string; sha256: string | null; size_bytes: string; storage_key: string }>(
      `SELECT d.state, d.legal_hold, d.base_date::text AS base_date, d.expires_on::text AS expires_on, (d.expires_on <= (now() AT TIME ZONE 'Asia/Seoul')::date) AS due,
              d.rule_code, f.purpose, f.original_name, f.sha256, f.size_bytes::text AS size_bytes, f.storage_key
         FROM sfx_doc_retention d JOIN files f ON f.id = d.file_id
        WHERE d.file_id = $1::uuid FOR UPDATE OF d`, [fileId]);
    if (!r) throw new NotFound('보관 대장에 없는 서류입니다.');
    if (r.state !== 'KEEP') throw new StateConflict('SFX_RET_STATE', '이미 파기했거나 다른 화면에서 지운 서류입니다.');
    if (r.legal_hold) throw new StateConflict('SFX_RET_HOLD', '법정 보관(보존)이 걸린 서류는 파기할 수 없습니다 — 먼저 풀어 주십시오.');
    if (!r.due) throw new StateConflict('SFX_RET_NOT_DUE', `보관 기한(${r.expires_on})이 지나지 않아 파기할 수 없습니다.`);
    await db.query(`UPDATE sfx_doc_retention SET state = 'DESTROYED' WHERE file_id = $1::uuid`, [fileId]);
    try {
      await db.query(`UPDATE files SET status = 'DELETED' WHERE id = $1::uuid AND status <> 'DELETED'`, [fileId]);
    } catch (e: unknown) {
      const m = String((e as { message?: string })?.message ?? '');
      if (m.includes('FILE:')) throw new StateConflict('SFX_RET_ATTACHED', `${m.slice(m.indexOf('FILE:') + 5).trim()} — 그 대장에서 먼저 빼십시오.`);
      throw e;
    }
    const [d] = await db.query<{ id: string }>(
      `INSERT INTO sfx_doc_destructions (file_id, purpose, rule_code, name_masked, sha256, size_bytes, base_date, expires_on, reason, actor)
       VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::bigint, $7::date, $8::date, $9::text, $10::uuid) RETURNING id::text AS id`,
      [fileId, r.purpose, r.rule_code, maskFileName(r.original_name), r.sha256, r.size_bytes, r.base_date, r.expires_on, reason, actor]);
    return { id: d.id, key: r.storage_key, expiresOn: r.expires_on };
  });
  /* 커밋 뒤 저장소 바이트 지움 — 실패하면 기록은 그대로 두고 운영 알림(다시 지우기는 사람) */
  let removed = false;
  let note = '';
  try {
    await storageFromEnv().remove(t.key);
    removed = true;
  } catch (e: unknown) {
    note = String((e as { message?: string })?.message ?? e).slice(0, 200);
  }
  if (removed) {
    await db.query(`UPDATE sfx_doc_destructions SET storage_removed = true, storage_note = 'removed' WHERE id = $1::bigint`, [t.id]).catch(() => undefined);
  } else {
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('SFX_RETENTION_REMOVE_FAIL', 'WARN', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
      [`파기한 서류의 저장소 파일을 지우지 못함 — 파기 기록 #${t.id}`, JSON.stringify({ destructionId: t.id, fileId, error: note })]).catch(() => undefined);
  }
  return { ok: true, destructionId: t.id, fileId, storageRemoved: removed, reason,
    note: removed ? '파기했습니다 — 파일을 지우고 파기 기록을 남겼습니다.' : '파기 기록을 남겼지만 저장소 파일을 지우지 못했습니다 — 운영 알림을 확인하십시오.' };
}

/** GET /admin/sfx/retention/destroyed — 파기 기록(최근 200 · 가린 이름) */
export async function retentionDestroyed(db: DatabaseService) {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT x.id::text AS id, x.file_id::text AS "fileId", x.purpose, x.rule_code AS "ruleCode", x.name_masked AS "fileName", x.size_bytes::bigint AS size,
            x.base_date::text AS "baseDate", x.expires_on::text AS "expiresOn", x.reason, x.destroyed_at AS "destroyedAt", x.storage_removed AS "storageRemoved", a.name AS actor
       FROM sfx_doc_destructions x LEFT JOIN accounts a ON a.id = x.actor
      ORDER BY x.id DESC LIMIT 200`);
  return { rows: rows.map((r) => ({ ...r, size: n(r.size), actor: maskName(r.actor as string | null) })) };
}

/** 정기 작업 sfx_daily — sfx.retention_alert on 일 때만 대장 맞추기 + 만료 알림(줄마다 한 번 · 만료일이 바뀌면 다시) */
export async function retentionJob(db: DatabaseService) {
  const s = await retSettings(db);
  if (!s.alertOn) return { skipped: 'OFF', added: 0, gone: 0, alerted: 0 };
  const [sy] = await db.query<{ added: number; gone: number }>(`SELECT added, gone FROM fn_sfx_retention_sync()`);
  const hit = await db.query<{ expired: boolean; rule_code: string }>(
    `UPDATE sfx_doc_retention SET alerted_on = (now() AT TIME ZONE 'Asia/Seoul')::date
      WHERE state = 'KEEP' AND NOT legal_hold AND alerted_on IS NULL
        AND expires_on <= (now() AT TIME ZONE 'Asia/Seoul')::date + $1::int
      RETURNING (expires_on <= (now() AT TIME ZONE 'Asia/Seoul')::date) AS expired, rule_code`, [s.alertDays]);
  if (hit.length) {
    const over = hit.filter((h) => h.expired).length;
    const byRule: Record<string, number> = {};
    for (const h of hit) byRule[h.rule_code] = (byRule[h.rule_code] ?? 0) + 1;
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('SFX_RETENTION_DUE', 'WARN', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
      [`서류 보관 기한 — 지남 ${over} · ${s.alertDays}일 안 ${hit.length - over}(사무 › 서류 보관 기한)`, JSON.stringify({ over, soon: hit.length - over, days: s.alertDays, byRule })]);
  }
  return { added: n(sy?.added), gone: n(sy?.gone), alerted: hit.length };
}
