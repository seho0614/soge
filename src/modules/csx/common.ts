import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.528 ~ 531 (D280 · docs/666 ~ 669) ㊿ 고객센터 · 회원 — 공통(설정)
 *   스위치는 모두 처음 꺼짐 — csx.ai_draft · csx.ai_draft_auto · csx.churn · csx.mail_templates · csx.account_merge · 바꾸기는 SUPER
 *   설정 값 검사 정규식 = DB site_settings.value_pattern(D280 ⑦)과 같은 글자(계약 규칙 2 · test_v1528 이 대조)
 * ------------------------------------------------------------------- */

export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** 설정 키 → DB value_pattern 과 같은 정규식 글자 */
export const CSX_PATTERNS: Record<string, string> = {
  'csx.ai_draft': '^(on|off)$',
  'csx.ai_draft_auto': '^(on|off)$',
  'csx.ai_draft_model': '^(|[a-z0-9][a-z0-9.-]{2,59})$',
  'csx.ai_draft_batch': '^([1-9]|1[0-9]|20)$',
  'csx.churn': '^(on|off)$',
  'csx.churn_min_prev_days': '^([1-9]|[1-5][0-9]|60)$',
  'csx.churn_drop_pct': '^([1-9][0-9])$',
  'csx.mail_templates': '^(on|off)$',
  'csx.account_merge': '^(on|off)$',
};

export interface CsxSettings {
  aiDraft: boolean; aiDraftAuto: boolean; aiDraftModel: string; aiDraftBatch: number;
  churn: boolean; churnMinPrevDays: number; churnDropPct: number;
  mailTemplates: boolean; accountMerge: boolean;
}

const int = (v: string | undefined, def: number, lo: number, hi: number) => {
  const x = Number(v);
  return v !== undefined && v !== '' && Number.isInteger(x) && x >= lo && x <= hi ? x : def;
};

/** 설정 한 번에 읽기 — 값이 비거나 틀리면 처음 값 */
export async function csxSettings(db: DatabaseService): Promise<CsxSettings> {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key LIKE 'csx.%'`);
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value ?? ''])) as Record<string, string>;
  return {
    aiDraft: m['csx.ai_draft'] === 'on',
    aiDraftAuto: m['csx.ai_draft_auto'] === 'on',
    aiDraftModel: (m['csx.ai_draft_model'] ?? '').trim(),
    aiDraftBatch: int(m['csx.ai_draft_batch'], 5, 1, 20),
    churn: m['csx.churn'] === 'on',
    churnMinPrevDays: int(m['csx.churn_min_prev_days'], 3, 1, 60),
    churnDropPct: int(m['csx.churn_drop_pct'], 70, 10, 99),
    mailTemplates: m['csx.mail_templates'] === 'on',
    accountMerge: m['csx.account_merge'] === 'on',
  };
}

/** 운영 설정 바꾸기(SUPER) — 보낸 칸만 · 정규식은 DB 와 같음 · 사유는 「전체 설정」 바뀐 기록(app.setting_reason)에 남음 */
export interface CsxSettingsInput {
  aiDraft?: boolean; aiDraftAuto?: boolean; aiDraftModel?: string; aiDraftBatch?: number;
  churn?: boolean; churnMinPrevDays?: number; churnDropPct?: number;
  mailTemplates?: boolean; accountMerge?: boolean;
  reason?: string;
}
export async function setCsxSettings(db: DatabaseService, d: CsxSettingsInput) {
  const reason = String(d.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('CSX_REASON', '사유는 2 ~ 200자입니다.');
  const set: Array<[string, string]> = [];
  const put = (v: unknown, key: string) => {
    if (v === undefined || v === null) return;
    const s = typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v).trim();
    if (!new RegExp(CSX_PATTERNS[key]!).test(s)) throw new PolicyViolation('CSX_SETTING_VALUE', `설정 값이 맞지 않습니다: ${key}`);
    set.push([key, s]);
  };
  put(d.aiDraft, 'csx.ai_draft'); put(d.aiDraftAuto, 'csx.ai_draft_auto'); put(d.aiDraftModel, 'csx.ai_draft_model'); put(d.aiDraftBatch, 'csx.ai_draft_batch');
  put(d.churn, 'csx.churn'); put(d.churnMinPrevDays, 'csx.churn_min_prev_days'); put(d.churnDropPct, 'csx.churn_drop_pct');
  put(d.mailTemplates, 'csx.mail_templates'); put(d.accountMerge, 'csx.account_merge');
  if (!set.length) throw new PolicyViolation('CSX_NOTHING', '바꿀 것이 없습니다.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  return { ok: true, settings: await csxSettings(db), note: '고객센터 · 회원 기능 설정을 바꿨습니다.' };
}

/** 사유 · 메모 2 ~ 300자 */
export function needNote(raw: unknown, code = 'CSX_REASON'): string {
  const r = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (r.length < 2 || r.length > 300) throw new PolicyViolation(code, '사유를 2 ~ 300자로 적어 주십시오.');
  return r;
}

/** 감사 기록 한 줄(audit.audit_logs · 시각 칸 occurred_at 은 기본값) */
export async function csxAudit(db: DatabaseService, action: string, targetType: string, targetId: string | null, before: unknown, after: unknown) {
  await db.query(
    `INSERT INTO audit.audit_logs (actor_account_id, actor_role, action, target_type, target_id, before_data, after_data, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5::uuid, $6::jsonb, $7::jsonb, $8, $9)`,
    [RequestCtx.actorId() ?? null, RequestCtx.get()?.actorRole ?? null, action, targetType, targetId && UUID_RE.test(targetId) ? targetId : null,
     before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), RequestCtx.get()?.ip ?? null, RequestCtx.get()?.userAgent ?? null]);
}
