import { Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { storageFromEnv } from '../file/storage';
import { kstToday } from './hr';

/* ---------------------------------------------------------------------
 * ㉛ 인사 3 (D262 · docs/599) — v10.461 채용 · 대표 11/20 「다음개발 ㉛」
 *   공고(hr_job_postings) DRAFT → OPEN → CLOSED · 지원자(hr_applicants · 최소 개인정보: 이름 · 메일 또는 휴대폰 · 서류 HR_DOC 3개 · 열람 ADMIN · SUPER · 올린 사람만)
 *   단계 APPLIED → SCREEN → INTERVIEW → OFFER → HIRED · 끝나지 않은 단계에서 REJECTED · WITHDRAWN · 면접 일정(hr_interviews)
 *   합격(hire) → 직원 대장(acct_employees) 줄을 만들고 지원자에 번호 연결
 *   불합격 · 철회 → 파기 예정일 = 결정일 + hr.applicant_retention_days(처음 180 · 14 ~ 180 · SUPER 고침)
 *   정기 작업 hr_applicant_purge(매일 04:50) — 예정일 지난 지원자 서류 파일 DELETED · 저장소 바이트 지움 · 이름 「(파기됨)」 · 연락처 · 메모 · 면접 메모 비움
 *     + 파기 기록(hr_applicant_purges · 쌓기만) + 감사 기록(audit.audit_logs HR_APPLICANT_PURGE) · 관리자 「지금 파기」(MANUAL)도 같은 길
 * ------------------------------------------------------------------- */

const log = new Logger('HrRecruit');
export const EMP_TYPES = ['REGULAR', 'FIXED_TERM', 'PART_TIME', 'INTERN'] as const;
export const SOURCES = ['DIRECT', 'JOBSITE', 'REFERRAL', 'ETC'] as const;
export const STAGES = ['APPLIED', 'SCREEN', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'] as const;
const FLOW = ['APPLIED', 'SCREEN', 'INTERVIEW', 'OFFER', 'HIRED'];
/** DB CHECK 와 같은 무늬(hr_applicants.email · phone) */
export const APPLICANT_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const APPLICANT_PHONE_RE = /^[0-9]{9,11}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURGED = '(파기됨)';
const clean = (s: string | null | undefined, max: number) => (s ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, max) || null;
const maskMail = (e: string | null) => { if (!e) return null; const [u, d] = e.split('@'); return `${(u ?? '').slice(0, 2)}***@${d ?? ''}`; };
const maskPhone = (p: string | null) => (p ? `${p.slice(0, 3)}-****-${p.slice(-4)}` : null);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);

async function retentionDays(db: DatabaseService) {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = 'hr.applicant_retention_days'`);
  const n = Number(r?.v);
  return Number.isInteger(n) && n >= 14 && n <= 180 ? n : 180;
}

/* ── 공고 ── */
interface PostIn { title?: string; dept?: string; empType?: string; description?: string; opensOn?: string; closesOn?: string; state?: string }
function checkPost(b: PostIn, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || b.title !== undefined) { const t = clean(b.title, 100); if (!t || t.length < 2) throw new PolicyViolation('RECRUIT_INPUT', '공고 제목은 2 ~ 100자입니다.'); out.title = t; }
  if (b.dept !== undefined) out.dept = clean(b.dept, 60);
  if (b.empType !== undefined || !partial) { const v = b.empType ?? 'REGULAR'; if (!(EMP_TYPES as readonly string[]).includes(v)) throw new PolicyViolation('RECRUIT_INPUT', '고용 형태가 바르지 않습니다.'); out.empType = v; }
  if (b.description !== undefined) out.description = (b.description ?? '').trim().slice(0, 4000) || null;
  for (const k of ['opensOn', 'closesOn'] as const) {
    if (b[k] !== undefined || !partial) { if (!YMD.test(b[k] ?? '')) throw new PolicyViolation('RECRUIT_INPUT', '공고 기간은 YYYY-MM-DD 입니다.'); out[k] = b[k]; }
  }
  if (b.state !== undefined) { if (!['DRAFT', 'OPEN', 'CLOSED'].includes(b.state)) throw new PolicyViolation('RECRUIT_INPUT', '공고 상태가 바르지 않습니다.'); out.state = b.state; }
  return out;
}

/** GET /admin/hr/recruit — 공고 · 단계별 수 · 다가오는 면접 · 파기 예정 */
export async function recruitBoard(db: DatabaseService) {
  const postings = await db.query(
    `SELECT p.id::text AS id, p.title, p.dept, p.emp_type AS "empType", p.opens_on::text AS "opensOn", p.closes_on::text AS "closesOn", p.state, p.created_at AS "createdAt",
            coalesce((SELECT jsonb_object_agg(stage, n) FROM (SELECT stage, count(*)::int AS n FROM hr_applicants a WHERE a.posting_id = p.id GROUP BY stage) s), '{}'::jsonb) AS stages
       FROM hr_job_postings p ORDER BY (p.state = 'OPEN') DESC, p.closes_on DESC, p.id DESC LIMIT 100`);
  const interviews = await db.query(
    `SELECT i.id::text AS id, i.applicant_id::text AS "applicantId", a.name, p.title AS "postingTitle", i.at, i.place, i.interviewers, i.result
       FROM hr_interviews i JOIN hr_applicants a ON a.id = i.applicant_id JOIN hr_job_postings p ON p.id = a.posting_id
      WHERE i.at >= now() - interval '1 day' AND a.purged_at IS NULL ORDER BY i.at LIMIT 50`);
  const [due] = await db.query<{ n: number; next: string | null }>(
    `SELECT count(*)::int AS n, min(purge_due_on)::text AS next FROM hr_applicants WHERE purged_at IS NULL AND stage IN ('REJECTED', 'WITHDRAWN')`);
  const [done] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM hr_applicant_purges`);
  const days = await retentionDays(db);
  return { postings, interviews, purge: { waiting: due?.n ?? 0, nextOn: due?.next ?? null, purged: done?.n ?? 0, retentionDays: days },
           empTypes: EMP_TYPES, sources: SOURCES, stages: STAGES,
           note: `불합격 · 철회 지원자의 서류 · 연락처는 결정일부터 ${days}일(설정 hr.applicant_retention_days) 뒤 매일 04:50 자동 파기됩니다. 주민등록번호 · 생년월일 · 사진은 받지 않습니다.` };
}

export async function createPosting(db: DatabaseService, b: PostIn, actor: string | null) {
  const v = checkPost(b, false);
  if ((v.closesOn as string) < (v.opensOn as string)) throw new PolicyViolation('RECRUIT_INPUT', '마감일은 시작일 뒤입니다.');
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO hr_job_postings (title, dept, emp_type, description, opens_on, closes_on, state, created_by)
     VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8::uuid) RETURNING id::text AS id`,
    [v.title, v.dept ?? null, v.empType, v.description ?? null, v.opensOn, v.closesOn, (v.state as string | undefined) ?? 'DRAFT', actor]);
  return { ok: true, id: r!.id, note: `공고 「${v.title}」을 만들었습니다.` };
}

export async function updatePosting(db: DatabaseService, id: string, b: PostIn) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 공고입니다.');
  const v = checkPost(b, true);
  const [old] = await db.query<{ state: string; opens: string; closes: string }>(
    `SELECT state, opens_on::text AS opens, closes_on::text AS closes FROM hr_job_postings WHERE id = $1::bigint`, [id]);
  if (!old) throw new NotFound('없는 공고입니다.');
  if (old.state === 'CLOSED') throw new StateConflict('RECRUIT_STATE', '마감한 공고는 고치지 않습니다(새 공고로).');
  if (v.state === 'DRAFT' && old.state === 'OPEN') throw new StateConflict('RECRUIT_STATE', '연 공고는 초안으로 돌리지 않습니다.');
  const opens = (v.opensOn as string | undefined) ?? old.opens, closes = (v.closesOn as string | undefined) ?? old.closes;
  if (closes < opens) throw new PolicyViolation('RECRUIT_INPUT', '마감일은 시작일 뒤입니다.');
  await db.query(
    `UPDATE hr_job_postings SET title = coalesce($2, title), dept = CASE WHEN $3::boolean THEN $4 ELSE dept END, emp_type = coalesce($5, emp_type),
            description = CASE WHEN $6::boolean THEN $7 ELSE description END, opens_on = $8::date, closes_on = $9::date, state = coalesce($10, state)
      WHERE id = $1::bigint`,
    [id, v.title ?? null, b.dept !== undefined, v.dept ?? null, v.empType ?? null, b.description !== undefined, v.description ?? null, opens, closes, v.state ?? null]);
  return { ok: true, id, note: '공고를 고쳤습니다.' };
}

/** GET /admin/hr/recruit/postings/{id} — 공고 · 지원자(연락처 가림) · 면접 */
export async function postingDetail(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 공고입니다.');
  const [p] = await db.query(
    `SELECT id::text AS id, title, dept, emp_type AS "empType", description, opens_on::text AS "opensOn", closes_on::text AS "closesOn", state FROM hr_job_postings WHERE id = $1::bigint`, [id]);
  if (!p) throw new NotFound('없는 공고입니다.');
  const apps = await db.query<{ id: string; name: string; email: string | null; phone: string | null; fileIds: string[]; stage: string }>(
    `SELECT id::text AS id, name, email, phone, source, memo, file_ids::text[] AS "fileIds", stage, decided_at AS "decidedAt", decide_note AS "decideNote",
            employee_id::text AS "employeeId", purge_due_on::text AS "purgeDueOn", purged_at AS "purgedAt", created_at AS "createdAt"
       FROM hr_applicants WHERE posting_id = $1::bigint ORDER BY id DESC LIMIT 500`, [id]);
  const ivs = await db.query(
    `SELECT i.id::text AS id, i.applicant_id::text AS "applicantId", i.at, i.place, i.interviewers, i.result, i.note
       FROM hr_interviews i JOIN hr_applicants a ON a.id = i.applicant_id WHERE a.posting_id = $1::bigint ORDER BY i.at`, [id]);
  return { posting: p, applicants: apps.map((a) => ({ ...a, email: maskMail(a.email), phone: maskPhone(a.phone) })), interviews: ivs };
}

/* ── 지원자 ── */
async function checkFiles(db: DatabaseService, ids: string[], actor: string | null) {
  if (ids.length > 3) throw new PolicyViolation('RECRUIT_FILE', '서류는 3개까지입니다.');
  if (ids.some((x) => !UUID_RE.test(x))) throw new PolicyViolation('RECRUIT_FILE', '서류 파일 번호가 바르지 않습니다.');
  if (!ids.length) return;
  const rows = await db.query<{ id: string; ok: boolean }>(
    `SELECT f.id::text AS id, (f.purpose = 'HR_DOC' AND f.status = 'READY' AND f.owner_account_id = $2::uuid
              AND NOT EXISTS (SELECT 1 FROM hr_training_records r WHERE r.file_id = f.id)
              AND NOT EXISTS (SELECT 1 FROM hr_applicants a WHERE f.id = ANY(a.file_ids))) AS ok
       FROM files f WHERE f.id = ANY($1::uuid[])`, [ids, actor]);
  if (rows.length !== ids.length || rows.some((r) => !r.ok)) throw new PolicyViolation('RECRUIT_FILE', '서류는 이 화면에서 본인이 새로 올린 파일(인사 서류 용도 HR_DOC · JPG · PNG · PDF)만 붙입니다.');
}

/** POST /admin/hr/recruit/applicants — 지원자 넣기(이름 + 메일 또는 휴대폰 · 서류 3개) */
export async function addApplicant(db: DatabaseService, b: { postingId: string; name: string; email?: string; phone?: string; source?: string; memo?: string; fileIds?: string[] }, actor: string | null) {
  if (!/^\d{1,18}$/.test(String(b.postingId ?? ''))) throw new NotFound('없는 공고입니다.');
  const [p] = await db.query<{ state: string }>(`SELECT state FROM hr_job_postings WHERE id = $1::bigint`, [b.postingId]);
  if (!p) throw new NotFound('없는 공고입니다.');
  if (p.state === 'DRAFT') throw new StateConflict('RECRUIT_STATE', '초안 공고에는 지원자를 넣지 않습니다(먼저 여십시오).');
  const name = clean(b.name, 40);
  if (!name || name === PURGED) throw new PolicyViolation('RECRUIT_INPUT', '이름을 적으십시오.');
  const email = (b.email ?? '').trim().toLowerCase() || null;
  const phone = (b.phone ?? '').replace(/\D/g, '') || null;
  if (email && (email.length > 200 || !APPLICANT_EMAIL_RE.test(email))) throw new PolicyViolation('RECRUIT_INPUT', '메일 형식이 바르지 않습니다.');
  if (phone && !APPLICANT_PHONE_RE.test(phone)) throw new PolicyViolation('RECRUIT_INPUT', '휴대폰은 숫자 9 ~ 11자리입니다.');
  if (!email && !phone) throw new PolicyViolation('RECRUIT_INPUT', '연락할 메일 또는 휴대폰을 하나 적으십시오.');
  const source = b.source && (SOURCES as readonly string[]).includes(b.source) ? b.source : 'DIRECT';
  const files = [...new Set((b.fileIds ?? []).map(String))];
  await checkFiles(db, files, actor);
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO hr_applicants (posting_id, name, email, phone, source, memo, file_ids, created_by)
     VALUES ($1::bigint, $2, $3, $4, $5, $6, $7::uuid[], $8::uuid) RETURNING id::text AS id`,
    [b.postingId, name, email, phone, source, clean(b.memo, 500), files, actor]);
  return { ok: true, id: r!.id, note: `지원자 ${name} 님을 넣었습니다.` };
}

async function applicantOf(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 지원자입니다.');
  const [a] = await db.query<{ id: string; postingId: string; name: string; stage: string; purgedAt: string | null; fileIds: string[] }>(
    `SELECT id::text AS id, posting_id::text AS "postingId", name, stage, purged_at AS "purgedAt", file_ids::text[] AS "fileIds" FROM hr_applicants WHERE id = $1::bigint FOR UPDATE`, [id]);
  if (!a) throw new NotFound('없는 지원자입니다.');
  if (a.purgedAt) throw new StateConflict('RECRUIT_PURGED', '파기한 지원자입니다.');
  return a;
}

/** POST /admin/hr/recruit/applicants/{id}/stage — 단계 넘기기 · 불합격 · 철회(파기 예정일) */
export async function moveStage(db: DatabaseService, id: string, stage: string, noteIn?: string) {
  if (!(STAGES as readonly string[]).includes(stage) || stage === 'HIRED') throw new PolicyViolation('RECRUIT_STAGE', '단계가 바르지 않습니다(합격은 「합격 → 직원 대장」으로).');
  return db.transaction(async () => {
    const a = await applicantOf(db, id);
    if (['HIRED', 'REJECTED', 'WITHDRAWN'].includes(a.stage)) throw new StateConflict('RECRUIT_STATE', '끝난 지원자는 단계를 바꾸지 않습니다.');
    const end = stage === 'REJECTED' || stage === 'WITHDRAWN';
    if (!end && FLOW.indexOf(stage) <= FLOW.indexOf(a.stage)) throw new StateConflict('RECRUIT_STATE', '지원 단계는 앞으로만 바뀝니다.');
    const due = end ? addDays(kstToday(), await retentionDays(db)) : null;
    await db.query(
      `UPDATE hr_applicants SET stage = $2, decided_at = CASE WHEN $3::boolean THEN now() ELSE decided_at END, decide_note = coalesce($4, decide_note), purge_due_on = $5::date WHERE id = $1::bigint`,
      [a.id, stage, end, clean(noteIn, 200), due]);
    return { ok: true, id: a.id, stage, purgeDueOn: due, note: end ? `${a.name} 님을 ${stage === 'REJECTED' ? '불합격' : '철회'}으로 두었습니다 — 서류는 ${due} 에 파기됩니다.` : `${a.name} 님 단계를 바꿨습니다.` };
  });
}

/** POST /admin/hr/recruit/applicants/{id}/interviews — 면접 일정 */
export async function addInterview(db: DatabaseService, id: string, b: { at: string; place?: string; interviewers?: string }, actor: string | null) {
  if (!b.at || Number.isNaN(Date.parse(b.at))) throw new PolicyViolation('RECRUIT_INPUT', '면접 시각이 바르지 않습니다.');
  return db.transaction(async () => {
    const a = await applicantOf(db, id);
    if (['HIRED', 'REJECTED', 'WITHDRAWN'].includes(a.stage)) throw new StateConflict('RECRUIT_STATE', '끝난 지원자는 면접을 잡지 않습니다.');
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO hr_interviews (applicant_id, at, place, interviewers, created_by) VALUES ($1::bigint, $2::timestamptz, $3, $4, $5::uuid) RETURNING id::text AS id`,
      [a.id, new Date(b.at).toISOString(), clean(b.place, 100), clean(b.interviewers, 200), actor]);
    if (a.stage === 'APPLIED' || a.stage === 'SCREEN') await db.query(`UPDATE hr_applicants SET stage = 'INTERVIEW' WHERE id = $1::bigint`, [a.id]);
    return { ok: true, id: r!.id, note: `${a.name} 님 면접을 잡았습니다.` };
  });
}

/** PUT /admin/hr/recruit/interviews/{id} — 면접 결과 · 메모 · 시각 바꾸기 */
export async function updateInterview(db: DatabaseService, id: string, b: { at?: string; place?: string; interviewers?: string; result?: string; note?: string }) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 면접입니다.');
  if (b.result !== undefined && b.result !== null && !['PASS', 'FAIL', 'HOLD'].includes(b.result)) throw new PolicyViolation('RECRUIT_INPUT', '결과는 PASS · FAIL · HOLD 입니다.');
  if (b.at !== undefined && Number.isNaN(Date.parse(b.at))) throw new PolicyViolation('RECRUIT_INPUT', '면접 시각이 바르지 않습니다.');
  const [i] = await db.query<{ purged: boolean }>(
    `SELECT (a.purged_at IS NOT NULL) AS purged FROM hr_interviews i JOIN hr_applicants a ON a.id = i.applicant_id WHERE i.id = $1::bigint`, [id]);
  if (!i) throw new NotFound('없는 면접입니다.');
  if (i.purged) throw new StateConflict('RECRUIT_PURGED', '파기한 지원자의 면접입니다.');
  await db.query(
    `UPDATE hr_interviews SET at = coalesce($2::timestamptz, at), place = CASE WHEN $3::boolean THEN $4 ELSE place END,
            interviewers = CASE WHEN $5::boolean THEN $6 ELSE interviewers END, result = coalesce($7, result), note = CASE WHEN $8::boolean THEN $9 ELSE note END
      WHERE id = $1::bigint`,
    [id, b.at ? new Date(b.at).toISOString() : null, b.place !== undefined, clean(b.place, 100), b.interviewers !== undefined, clean(b.interviewers, 200),
     b.result ?? null, b.note !== undefined, clean(b.note, 500)]);
  return { ok: true, id, note: '면접을 고쳤습니다.' };
}

/** POST /admin/hr/recruit/applicants/{id}/hire — 합격 → 직원 대장 줄(이름 · 입사일 · 월 기본급) */
export async function hireApplicant(db: DatabaseService, id: string, b: { joinedOn: string; monthlyBase?: number; dependents?: number }, actor: string | null) {
  if (!YMD.test(b.joinedOn ?? '') || Number.isNaN(Date.parse(b.joinedOn))) throw new PolicyViolation('RECRUIT_INPUT', '입사일이 바르지 않습니다.');
  const base = b.monthlyBase ?? 0, dep = b.dependents ?? 1;
  if (!Number.isInteger(base) || base < 0 || base > 100000000) throw new PolicyViolation('RECRUIT_INPUT', '월 기본급은 0 ~ 1억 원(정수)입니다.');
  if (!Number.isInteger(dep) || dep < 1 || dep > 11) throw new PolicyViolation('RECRUIT_INPUT', '부양가족 수는 본인 포함 1 ~ 11명입니다.');
  return db.transaction(async () => {
    const a = await applicantOf(db, id);
    if (['HIRED', 'REJECTED', 'WITHDRAWN'].includes(a.stage)) throw new StateConflict('RECRUIT_STATE', '끝난 지원자는 합격 처리하지 않습니다.');
    const [e] = await db.query<{ id: string }>(
      `INSERT INTO acct_employees (name, joined_on, monthly_base, nontax, dependents, memo, created_by)
       VALUES ($1, $2::date, $3::bigint, 0, $4::int, $5, $6::uuid) RETURNING id::text AS id`,
      [a.name, b.joinedOn, base, dep, `채용 공고 ${a.postingId} · 지원자 ${a.id} 합격(v10.461)`, actor]);
    await db.query(`UPDATE hr_applicants SET stage = 'HIRED', employee_id = $2::bigint, decided_at = now() WHERE id = $1::bigint`, [a.id, e!.id]);
    return { ok: true, id: a.id, employeeId: e!.id, note: `${a.name} 님을 합격 처리하고 직원 대장에 넣었습니다(회계 › 인사 › 급여에서 금액 확인 · 근로계약서는 근로계약서 탭).` };
  });
}

/* ── 파기 ── */
async function purgeOne(db: DatabaseService, id: string, reason: 'RETENTION' | 'MANUAL', actor: string | null) {
  const keys: string[] = [];
  const out = await db.transaction(async () => {
    const [a] = await db.query<{ id: string; postingId: string; stage: string; fileIds: string[]; purgedAt: string | null }>(
      `SELECT id::text AS id, posting_id::text AS "postingId", stage, file_ids::text[] AS "fileIds", purged_at AS "purgedAt" FROM hr_applicants WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!a || a.purgedAt) return null;
    if (!['REJECTED', 'WITHDRAWN'].includes(a.stage)) throw new StateConflict('RECRUIT_STATE', '불합격 · 철회한 지원자만 파기합니다.');
    await db.query(`UPDATE hr_interviews SET note = NULL, interviewers = NULL WHERE applicant_id = $1::bigint`, [a.id]);
    /* 지원자 줄에서 서류 번호를 먼저 비움 — files 가드(trg_hr_files_guard)가 지원자에 붙은 HR_DOC 지우기를 막으므로 */
    await db.query(
      `UPDATE hr_applicants SET name = $2, email = NULL, phone = NULL, memo = NULL, decide_note = NULL, file_ids = '{}'::uuid[], purged_at = now() WHERE id = $1::bigint`, [a.id, PURGED]);
    const files = await db.query<{ key: string }>(
      `UPDATE files SET status = 'DELETED' WHERE id = ANY($1::uuid[]) AND status <> 'DELETED' RETURNING storage_key AS key`, [a.fileIds]);
    keys.push(...files.map((f) => f.key));
    await db.query(
      `INSERT INTO hr_applicant_purges (applicant_id, posting_id, stage, files, reason, purged_by) VALUES ($1::bigint, $2::bigint, $3, $4::int, $5, $6::uuid)`,
      [a.id, a.postingId, a.stage, a.fileIds.length, reason, actor]);
    await db.query(
      `INSERT INTO audit.audit_logs (actor_account_id, action, target_type, after_data) VALUES ($1::uuid, 'HR_APPLICANT_PURGE', 'SETTING', $2::jsonb)`,
      [actor, JSON.stringify({ applicantId: a.id, postingId: a.postingId, files: a.fileIds.length, reason })]);
    return { id: a.id, files: a.fileIds.length };
  });
  if (keys.length) {
    const st = storageFromEnv();
    for (const k of keys) await st.remove(k).catch((e: Error) => log.warn(`파기 파일 지우기 실패 ${k}: ${e.message}`));
  }
  return out;
}

/** POST /admin/hr/recruit/applicants/{id}/purge — 지금 파기(불합격 · 철회만 · 되돌릴 수 없음) */
export async function purgeNow(db: DatabaseService, id: string, actor: string | null) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 지원자입니다.');
  const [x] = await db.query<{ purged: boolean }>(`SELECT (purged_at IS NOT NULL) AS purged FROM hr_applicants WHERE id = $1::bigint`, [id]);
  if (!x) throw new NotFound('없는 지원자입니다.');
  if (x.purged) throw new StateConflict('RECRUIT_PURGED', '이미 파기한 지원자입니다.');
  const r = await purgeOne(db, id, 'MANUAL', actor);
  return { ok: true, id, files: r?.files ?? 0, note: `지원자 서류 ${r?.files ?? 0}개 · 연락처를 파기했습니다(파기 기록 · 감사 기록에 남음).` };
}

/** 정기 작업 hr_applicant_purge(매일 04:50) — 파기 예정일 지난 불합격 · 철회 지원자 */
export async function applicantPurgeJob(db: DatabaseService) {
  const due = await db.query<{ id: string }>(
    `SELECT id::text AS id FROM hr_applicants WHERE purged_at IS NULL AND stage IN ('REJECTED', 'WITHDRAWN') AND purge_due_on <= $1::date ORDER BY purge_due_on, id LIMIT 500`, [kstToday()]);
  let purged = 0, files = 0;
  const failed: string[] = [];
  for (const a of due) {
    try {
      const r = await purgeOne(db, a.id, 'RETENTION', null);
      if (r) { purged++; files += r.files; }
    } catch (e) {
      failed.push(a.id);
      log.error(`지원자 ${a.id} 파기 실패: ${(e as Error).message}`);
    }
  }
  return { due: due.length, purged, files, failed };
}
