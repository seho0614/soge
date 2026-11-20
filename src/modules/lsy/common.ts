import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.524 ~ 527 (D279 · docs/662 ~ 665) ㊾ 매물 2 — 공통(설정 · 작은 도우미)
 *   스위치는 모두 처음 꺼짐 — lsy.dup_detect · lsy.photo_check · lsy.photo_ai · lsy.video · lsy.report_triage · lsy.report_ai · 바꾸기는 SUPER
 *   설정 값 검사 정규식 = DB site_settings.value_pattern(D279 ⑥)과 같은 글자(계약 규칙 2 · test_v1524 가 대조)
 *   AI 통로 두 개(fn_agent_allowed · D279) — LSY_PHOTO(사진 속 연락처 글자 · lsy.photo_ai) · LSY_REPORT(신고 분류 · lsy.report_ai)
 * ------------------------------------------------------------------- */

export const LSY_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** 설정 키 → DB value_pattern 과 같은 정규식 글자 */
export const LSY_PATTERNS: Record<string, string> = {
  'lsy.dup_detect': '^(on|off)$',
  'lsy.dup_threshold': '^(5[0-9]|[6-9][0-9]|100)$',
  'lsy.dup_window_days': '^([1-9]|[1-9][0-9]|1[0-7][0-9]|180)$',
  'lsy.dup_queue': '^(on|off)$',
  'lsy.photo_check': '^(on|off)$',
  'lsy.photo_ai': '^(on|off)$',
  'lsy.photo_min_px': '^([2-9][0-9]{2}|1[0-9]{3}|2000)$',
  'lsy.photo_batch': '^([1-9]|[1-4][0-9]|50)$',
  'lsy.video': '^(on|off)$',
  'lsy.video_max_mb': '^([1-9]|[1-4][0-9]|50)$',
  'lsy.video_max_sec': '^([5-9]|[1-9][0-9]|1[01][0-9]|120)$',
  'lsy.report_triage': '^(on|off)$',
  'lsy.report_ai': '^(on|off)$',
  'lsy.ai_model': '^(|[a-z0-9][a-z0-9.-]{2,59})$',
};

export interface LsySettings {
  dupDetect: boolean; dupThreshold: number; dupWindowDays: number; dupQueue: boolean;
  photoCheck: boolean; photoAi: boolean; photoMinPx: number; photoBatch: number;
  video: boolean; videoMaxMb: number; videoMaxSec: number;
  reportTriage: boolean; reportAi: boolean; aiModel: string;
}

const int = (v: string | undefined, def: number, lo: number, hi: number) => {
  const x = Number(v);
  return v !== undefined && v !== '' && Number.isInteger(x) && x >= lo && x <= hi ? x : def;
};

/** 설정 한 번에 읽기 — 값이 비거나 틀리면 처음 값 */
export async function lsySettings(db: DatabaseService): Promise<LsySettings> {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key LIKE 'lsy.%'`);
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value ?? ''])) as Record<string, string>;
  return {
    dupDetect: m['lsy.dup_detect'] === 'on',
    dupThreshold: int(m['lsy.dup_threshold'], 80, 50, 100),
    dupWindowDays: int(m['lsy.dup_window_days'], 60, 1, 180),
    dupQueue: (m['lsy.dup_queue'] ?? 'on') !== 'off',
    photoCheck: m['lsy.photo_check'] === 'on',
    photoAi: m['lsy.photo_ai'] === 'on',
    photoMinPx: int(m['lsy.photo_min_px'], 600, 200, 2000),
    photoBatch: int(m['lsy.photo_batch'], 20, 1, 50),
    video: m['lsy.video'] === 'on',
    videoMaxMb: int(m['lsy.video_max_mb'], 30, 1, 50),
    videoMaxSec: int(m['lsy.video_max_sec'], 60, 5, 120),
    reportTriage: m['lsy.report_triage'] === 'on',
    reportAi: m['lsy.report_ai'] === 'on',
    aiModel: (m['lsy.ai_model'] ?? '').trim(),
  };
}

/** 운영 설정 바꾸기(SUPER) — 보낸 칸만 · 정규식은 DB 와 같음 · 사유는 「전체 설정」 바뀐 기록(app.setting_reason)에 남음 */
export interface LsySettingsInput {
  dupDetect?: boolean; dupThreshold?: number; dupWindowDays?: number; dupQueue?: boolean;
  photoCheck?: boolean; photoAi?: boolean; photoMinPx?: number; photoBatch?: number;
  video?: boolean; videoMaxMb?: number; videoMaxSec?: number;
  reportTriage?: boolean; reportAi?: boolean; aiModel?: string;
  reason?: string;
}
export async function setLsySettings(db: DatabaseService, d: LsySettingsInput) {
  const reason = String(d.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('LSY_REASON', '사유는 2 ~ 200자입니다.');
  const set: Array<[string, string]> = [];
  const put = (v: unknown, key: string) => {
    if (v === undefined || v === null) return;
    const s = typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v).trim();
    if (!new RegExp(LSY_PATTERNS[key]!).test(s)) throw new PolicyViolation('LSY_SETTING_VALUE', `설정 값이 맞지 않습니다: ${key}`);
    set.push([key, s]);
  };
  put(d.dupDetect, 'lsy.dup_detect'); put(d.dupThreshold, 'lsy.dup_threshold'); put(d.dupWindowDays, 'lsy.dup_window_days'); put(d.dupQueue, 'lsy.dup_queue');
  put(d.photoCheck, 'lsy.photo_check'); put(d.photoAi, 'lsy.photo_ai'); put(d.photoMinPx, 'lsy.photo_min_px'); put(d.photoBatch, 'lsy.photo_batch');
  put(d.video, 'lsy.video'); put(d.videoMaxMb, 'lsy.video_max_mb'); put(d.videoMaxSec, 'lsy.video_max_sec');
  put(d.reportTriage, 'lsy.report_triage'); put(d.reportAi, 'lsy.report_ai'); put(d.aiModel, 'lsy.ai_model');
  if (!set.length) throw new PolicyViolation('LSY_NOTHING', '바꿀 것이 없습니다.');
  const me = RequestCtx.actorId() ?? null;
  await db.transaction(async () => {
    await db.query(`SELECT set_config('app.setting_reason', $1, true)`, [reason]);
    for (const [k, v] of set) await db.query(`UPDATE site_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [k, v, me]);
  });
  return { ok: true, settings: await lsySettings(db), note: '매물 품질 기능 설정을 바꿨습니다.' };
}

/** 사유 2 ~ 300자 */
export function lsyReason(raw: unknown, code = 'LSY_REASON'): string {
  const r = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (r.length < 2 || r.length > 300) throw new PolicyViolation(code, '사유를 2 ~ 300자로 적어 주십시오.');
  return r;
}

/** AI 모델 — lsy.ai_model 이 비면 agent.review_model · 요금표에 없으면 null(부르지 않음) */
export async function lsyModel(db: DatabaseService, s: LsySettings): Promise<string | null> {
  let model = s.aiModel;
  if (!model) {
    const [r] = await db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'agent.review_model'`);
    model = (r?.value ?? '').trim() || 'claude-sonnet-5-5';
  }
  const [priced] = await db.query(`SELECT 1 FROM agent_model_prices WHERE model = $1`, [model]);
  return priced ? model : null;
}

/** 스트림을 끝까지(상한까지) 읽기 — 넘으면 null */
export async function lsyReadAll(stream: NodeJS.ReadableStream, max: number): Promise<Buffer | null> {
  const parts: Buffer[] = []; let size = 0;
  for await (const c of stream as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > max) { (stream as unknown as { destroy?: () => void }).destroy?.(); return null; }
    parts.push(Buffer.from(c));
  }
  return Buffer.concat(parts);
}

/** 스트림 앞부분만(상한까지) 읽기 — 그림 머리(해상도)용 */
export async function lsyReadHead(stream: NodeJS.ReadableStream, max: number): Promise<Buffer> {
  const parts: Buffer[] = []; let size = 0;
  for await (const c of stream as AsyncIterable<Buffer>) {
    parts.push(Buffer.from(c)); size += c.length;
    if (size >= max) { (stream as unknown as { destroy?: () => void }).destroy?.(); break; }
  }
  return Buffer.concat(parts).subarray(0, max);
}

/** 전화번호 숫자만(010 · 02 등 국내 번호 9 ~ 11자리) — 비교용 · 화면에는 끝 4자리만 */
export function lsyPhoneDigits(raw: string | null | undefined): string | null {
  const d = String(raw ?? '').replace(/\D/g, '').replace(/^82/, '0');
  return /^0\d{8,10}$/.test(d) ? d : null;
}
/** 글 속 전화번호들(숫자만) */
export function lsyPhonesInText(text: string): string[] {
  const out = new Set<string>();
  const re = /(\+?82[-. ]?)?0\d{1,2}[-. )]?\d{3,4}[-. ]?\d{4}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) { const d = lsyPhoneDigits(m[0]); if (d) out.add(d); }
  return [...out];
}
