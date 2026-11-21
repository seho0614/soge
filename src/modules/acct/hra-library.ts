import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { storageFromEnv } from '../file/storage';
import { contentDisposition } from '../file/sniff';
import { dayOk, hraRoles, hraSettings, kstToday, maskEmail, textOk } from './hra-common';
import { PGX_EDIT_UP, pgxCan } from '../admin/pgx-perm';   // v10.615 (docs/757)

/* ---------------------------------------------------------------------
 * v10.582 (docs/724) 사내 자료실 · 공지 — 운영자만 · 권한그룹별 공개 범위 · 읽음 확인
 *   사내 문서함(D253 corpdocs.ts)은 회사 법정 문서(정관 · 등기부 …)를 판으로 보관 · 이 자료실은 운영자에게 「알리고 읽었는지 보는」 곳
 *     자료(FILE)는 사내 문서함과 같은 파일 용도(CORP_DOC)로 올리거나 사내 문서함 문서를 골라 붙임(그 문서의 가장 최근 판 · 두 번 올리지 않음)
 *   공개 범위 = 권한그룹 키(D258 perm_role_groups) · 비면 운영 계정 모두(세무사 빠짐) · 판단은 DB 함수 fn_hra_lib_can_read 하나
 *   파일 열기 = 이 주소가 공개 범위를 보고 5분짜리 주소(fn_file_can_read 는 그대로 · 매물 동영상 v10.526 과 같은 방식) · 감사 HRA_LIB_FILE_OPEN
 *   읽음 확인 = 본인 「읽었습니다」(쌓기만) · 꼭 읽기 + 기한 지나면 HRA_LIB_UNREAD(hra.lib_unread_alert 처음 off)
 *   글쓰기 · 고치기 · 보관 끝 · 읽음 현황 = ADMIN · SUPER(사내 문서함 올리기와 같음)
 * ------------------------------------------------------------------- */

export const LIB_KINDS = ['NOTICE', 'FILE'] as const;
export const LIB_KIND_KO: Record<string, string> = { NOTICE: '공지', FILE: '자료' };
const STAFF_ROLES = ['ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'];
const idOk = (id: string) => { if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('없는 글입니다.'); return String(id); };

export interface LibInput { kind?: string; title?: string; body?: string | null; audience?: string[]; mustRead?: boolean; readDue?: string | null; pinned?: boolean; fileId?: string | null; corpDocId?: string | null }

/** 권한그룹 목록(공개 범위 고르기) */
async function groups(db: DatabaseService) {
  return db.query<{ key: string; name: string; fromRole: string | null }>(
    `SELECT key, name, from_role AS "fromRole" FROM perm_role_groups WHERE active ORDER BY kind DESC, key`);
}

async function checkInput(db: DatabaseService, b: LibInput, base?: { kind: string; mustRead: boolean; readDue: string | null }) {
  const title = textOk(b.title, 2, 120);
  if (!title) throw new PolicyViolation('HRA_LIB_TITLE', '제목은 2 ~ 120자입니다.');
  const kind = base?.kind ?? b.kind ?? '';
  if (!(LIB_KINDS as readonly string[]).includes(kind)) throw new PolicyViolation('HRA_LIB_KIND', '종류는 공지(NOTICE) · 자료(FILE) 중 하나입니다.');
  const body = b.body == null ? null : String(b.body).trim().slice(0, 20000) || null;
  if (kind === 'NOTICE' && (!body || body.length < 2)) throw new PolicyViolation('HRA_LIB_BODY', '공지는 본문을 2자 이상 적습니다.');
  const audience = [...new Set((Array.isArray(b.audience) ? b.audience : []).map((x) => String(x).trim()).filter(Boolean))];
  if (audience.length > 20 || audience.some((k) => !/^[A-Z][A-Z0-9_]{1,40}$/.test(k))) throw new PolicyViolation('HRA_LIB_AUDIENCE', '공개 범위는 권한그룹 키 20개까지입니다.');
  if (audience.length) {
    const [c] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM perm_role_groups WHERE key = ANY($1::text[])`, [audience]);
    if (Number(c?.n ?? 0) !== audience.length) throw new PolicyViolation('HRA_LIB_AUDIENCE', '없는 권한그룹이 있습니다.');
  }
  const mustRead = b.mustRead === undefined ? base?.mustRead ?? false : b.mustRead === true;
  const readDue = b.readDue === undefined ? (base?.readDue ?? null) : (b.readDue || null);
  if (readDue && (!dayOk(readDue) || !mustRead)) throw new PolicyViolation('HRA_LIB_DUE', '읽을 기한은 꼭 읽기 글에만 · YYYY-MM-DD 입니다.');
  return { title, kind, body, audience, mustRead, readDue: mustRead ? readDue : null };
}

const ROW = `p.id::text AS id, p.kind, p.title, p.audience, p.must_read AS "mustRead", p.read_due::text AS "readDue", p.pinned, p.state,
             p.file_id::text AS "fileId", p.corp_doc_id::text AS "corpDocId", p.created_at AS "createdAt", p.updated_at AS "updatedAt",
             p.archived_at AS "archivedAt", p.archive_reason AS "archiveReason", coalesce(a.name, '운영자') AS author,
             coalesce(f.original_name, cf.original_name) AS "fileName", coalesce(f.size_bytes, cf.size_bytes) AS "fileSize", cd.title AS "corpDocTitle"`;
const JOIN = `FROM hra_lib_posts p LEFT JOIN accounts a ON a.id = p.created_by LEFT JOIN files f ON f.id = p.file_id
              LEFT JOIN corp_docs cd ON cd.id = p.corp_doc_id
              LEFT JOIN LATERAL (SELECT v.file_id FROM corp_doc_versions v WHERE v.doc_id = p.corp_doc_id ORDER BY v.version_no DESC LIMIT 1) cv ON true
              LEFT JOIN files cf ON cf.id = cv.file_id`;

/** GET /admin/hra/library?kind=&q=&unread=1 — 나에게 공개된 글(보관 중) · 읽음 표시 · 꼭 읽을 것 먼저 */
export async function myLibrary(db: DatabaseService, actor: string | null, q: { kind?: string; q?: string; unread?: string }) {
  if (!actor) return { items: [], mustReadLeft: 0 };
  const kind = q.kind && (LIB_KINDS as readonly string[]).includes(q.kind) ? q.kind : '';
  const word = (q.q ?? '').replace(/[%_\\]/g, '').trim().slice(0, 40);
  const items = await db.query<Record<string, unknown> & { mustRead: boolean; readAt: string | null }>(
    `SELECT ${ROW}, r.read_at AS "readAt" ${JOIN} LEFT JOIN hra_lib_reads r ON r.post_id = p.id AND r.account_id = $1::uuid
      WHERE p.state = 'ACTIVE' AND fn_hra_lib_can_read(p.id, $1::uuid) AND ($2::text = '' OR p.kind = $2::text)
        AND ($3::text = '' OR p.title ILIKE '%' || $3::text || '%' OR coalesce(p.body, '') ILIKE '%' || $3::text || '%')
        AND ($4::text <> '1' OR r.read_at IS NULL)
      ORDER BY p.pinned DESC, (p.must_read AND r.read_at IS NULL) DESC, p.created_at DESC LIMIT 300`, [actor, kind, word, q.unread ?? '']);
  const roles = await hraRoles(db, actor);
  return { items: items.map((x) => ({ ...x, kindKo: LIB_KIND_KO[String(x.kind)] ?? x.kind })), mustReadLeft: items.filter((x) => x.mustRead && !x.readAt).length,
           canManage: await pgxCan(db, actor, roles, ['hra-library'], PGX_EDIT_UP, ['ADMIN']),   // v10.615 (docs/757) GROUPS 면 사내 자료실 고치기 이상(R_ADMIN 만 · 나머지 R_ 는 보기만)
           note: '운영자에게만 보이는 사내 공지 · 자료입니다. 「꼭 읽기」 글은 읽은 뒤 「읽었습니다」를 눌러 주십시오(읽은 시각이 남습니다).' };
}

async function visiblePost(db: DatabaseService, actor: string | null, idIn: string) {
  const id = idOk(idIn);
  if (!actor) throw new NotFound('없는 글입니다.');
  const [p] = await db.query<Record<string, unknown> & { id: string; state: string; body: string | null; fileId: string | null; corpDocId: string | null; ok: boolean }>(
    `SELECT ${ROW}, p.body, fn_hra_lib_can_read(p.id, $2::uuid) AS ok ${JOIN} WHERE p.id = $1::bigint`, [id, actor]);
  /* 공개 범위 밖이면 없는 글과 똑같이 404 — 있는지조차 알리지 않음(파일과 같은 규칙) */
  if (!p || !p.ok) throw new NotFound('없는 글입니다.');
  return p;
}

/** GET /admin/hra/library/{id} — 본문 · 파일 정보 · 내 읽음 */
export async function libPost(db: DatabaseService, actor: string | null, idIn: string) {
  const p = await visiblePost(db, actor, idIn);
  const [r] = await db.query<{ at: string }>(`SELECT read_at AS at FROM hra_lib_reads WHERE post_id = $1::bigint AND account_id = $2::uuid`, [p.id, actor]);
  const { ok: _ok, ...rest } = p;
  return { ...rest, kindKo: LIB_KIND_KO[String(p.kind)] ?? p.kind, readAt: r?.at ?? null };
}

/** POST /admin/hra/library/{id}/read — 읽었습니다(한 번 · 다시 누르면 already) */
export async function markRead(db: DatabaseService, actor: string | null, idIn: string) {
  const p = await visiblePost(db, actor, idIn);
  if (p.state !== 'ACTIVE') throw new StateConflict('HRA_LIB_STATE', '보관 끝 글입니다.');
  const r = await db.query(`INSERT INTO hra_lib_reads (post_id, account_id) VALUES ($1::bigint, $2::uuid) ON CONFLICT DO NOTHING RETURNING post_id`, [p.id, actor]);
  return { ok: true, id: p.id, already: !r.length, note: r.length ? '읽음으로 남겼습니다.' : '이미 읽음으로 남아 있습니다.' };
}

/** GET /admin/hra/library/{id}/file — 공개 범위 안이면 5분짜리 주소(파일 · 사내 문서함 문서의 가장 최근 판) */
export async function libFile(db: DatabaseService, actor: string | null, idIn: string) {
  const p = await visiblePost(db, actor, idIn);
  if (p.state !== 'ACTIVE') throw new NotFound('없는 글입니다.');
  const [f] = await db.query<{ id: string; storage_key: string; content_type: string; original_name: string; size_bytes: string }>(
    `SELECT f.id::text AS id, f.storage_key, f.content_type, f.original_name, f.size_bytes::text AS size_bytes FROM files f
      WHERE f.status = 'READY' AND f.purpose = 'CORP_DOC'
        AND f.id = coalesce($1::uuid, (SELECT v.file_id FROM corp_doc_versions v WHERE v.doc_id = $2::bigint ORDER BY v.version_no DESC LIMIT 1))`,
    [p.fileId, p.corpDocId]);
  if (!f) throw new NotFound('붙은 파일이 없습니다.');
  const t = await storageFromEnv().downloadTarget({ id: f.id, key: f.storage_key, contentType: f.content_type, disposition: contentDisposition('attachment', f.original_name) }, 300);
  return { postId: p.id, fileId: f.id, name: f.original_name, contentType: f.content_type, size: Number(f.size_bytes), url: t.url, method: 'GET', expiresAt: t.expiresAt };
}

/* ── 관리(ADMIN · SUPER) ── */
/** 공개 범위 대상 계정 수 · 읽은 수(보관 중 글) */
async function readStats(db: DatabaseService, ids: string[]) {
  if (!ids.length) return new Map<string, { target: number; read: number }>();
  const r = await db.query<{ id: string; target: number; read: number }>(
    `WITH staff AS (SELECT DISTINCT r.account_id FROM account_roles r JOIN accounts a ON a.id = r.account_id
                     WHERE r.role IN ('SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF') AND a.status = 'ACTIVE' AND (r.expires_at IS NULL OR r.expires_at > now()))
     SELECT p.id::text AS id,
            (SELECT count(*)::int FROM staff s WHERE fn_hra_lib_can_read(p.id, s.account_id)) AS target,
            (SELECT count(*)::int FROM hra_lib_reads x JOIN staff s ON s.account_id = x.account_id WHERE x.post_id = p.id AND fn_hra_lib_can_read(p.id, s.account_id)) AS read
       FROM hra_lib_posts p WHERE p.id = ANY($1::bigint[])`, [ids]);
  return new Map(r.map((x) => [x.id, { target: x.target, read: x.read }]));
}

/** GET /admin/hra/library/manage?state= — 모든 글 · 대상 · 읽은 수 · 권한그룹 · 사내 문서함 문서 고르기 */
export async function manageLibrary(db: DatabaseService, state?: string) {
  const st = state === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';
  const items = await db.query<Record<string, unknown> & { id: string }>(`SELECT ${ROW} ${JOIN} WHERE p.state = $1::text ORDER BY p.pinned DESC, p.created_at DESC LIMIT 300`, [st]);
  const stats = await readStats(db, items.map((x) => x.id));
  const docs = await db.query(`SELECT d.id::text AS id, d.category, d.title FROM corp_docs d WHERE d.state = 'ACTIVE' ORDER BY d.category, d.title LIMIT 300`);
  const s = await hraSettings(db);
  return { state: st, items: items.map((x) => ({ ...x, kindKo: LIB_KIND_KO[String(x.kind)] ?? x.kind, ...(stats.get(x.id) ?? { target: 0, read: 0 }) })),
           groups: await groups(db), corpDocs: docs, unreadAlert: s.libUnreadAlert, today: kstToday(),
           note: '공개 범위를 비우면 운영 계정 모두(세무사 빠짐)에게 보입니다. 파일은 사내 문서함과 같은 방식으로 올리거나 사내 문서함 문서를 고릅니다.' };
}

/** POST /admin/hra/library — 공지 · 자료 쓰기 */
export async function addLibPost(db: DatabaseService, b: LibInput, actor: string | null) {
  if (!actor) throw new PolicyViolation('HRA_LIB', '로그인한 운영자만 씁니다.');
  const c = await checkInput(db, b);
  const fileId = b.fileId ? String(b.fileId) : null;
  const corpDocId = b.corpDocId ? String(b.corpDocId) : null;
  if (c.kind === 'FILE' && !fileId && !corpDocId) throw new PolicyViolation('HRA_LIB_FILE', '자료는 파일을 올리거나 사내 문서함 문서를 고릅니다.');
  if (fileId && corpDocId) throw new PolicyViolation('HRA_LIB_FILE', '파일과 사내 문서함 문서 중 하나만 붙입니다.');
  if (fileId && !/^[0-9a-f-]{36}$/i.test(fileId)) throw new PolicyViolation('HRA_LIB_FILE', '파일 번호가 바르지 않습니다.');
  if (corpDocId) {
    if (!/^\d{1,18}$/.test(corpDocId)) throw new PolicyViolation('HRA_LIB_FILE', '사내 문서 번호가 바르지 않습니다.');
    const [d] = await db.query(`SELECT 1 FROM corp_docs WHERE id = $1::bigint AND state = 'ACTIVE'`, [corpDocId]);
    if (!d) throw new PolicyViolation('HRA_LIB_FILE', '보관 중인 사내 문서가 아닙니다.');
  }
  if (fileId) {
    const [f] = await db.query(`SELECT 1 FROM files WHERE id = $1::uuid AND purpose = 'CORP_DOC' AND status = 'READY'`, [fileId]);
    if (!f) throw new PolicyViolation('HRA_LIB_FILE', '사내 문서 용도(CORP_DOC)로 올린 파일만 붙입니다.');
  }
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO hra_lib_posts (kind, title, body, audience, must_read, read_due, pinned, file_id, corp_doc_id, created_by)
     VALUES ($1, $2, $3, $4::text[], $5::boolean, $6::date, $7::boolean, $8::uuid, $9::bigint, $10::uuid) RETURNING id::text AS id`,
    [c.kind, c.title, c.body, c.audience, c.mustRead, c.readDue, b.pinned === true, fileId, corpDocId, actor]);
  return { ok: true, id: r!.id, note: c.audience.length ? `「${c.title}」을(를) 권한그룹 ${c.audience.length}곳에 올렸습니다.` : `「${c.title}」을(를) 운영 계정 모두에게 올렸습니다.` };
}

/** PUT /admin/hra/library/{id} — 보관 중 글 고치기(제목 · 본문 · 공개 범위 · 꼭 읽기 · 기한 · 고정) · 고치기 전을 기록 */
export async function updateLibPost(db: DatabaseService, idIn: string, b: LibInput, actor: string | null) {
  const id = idOk(idIn);
  return db.transaction(async () => {
    const [p] = await db.query<{ kind: string; title: string; body: string | null; audience: string[]; mustRead: boolean; readDue: string | null; pinned: boolean; state: string }>(
      `SELECT kind, title, body, audience, must_read AS "mustRead", read_due::text AS "readDue", pinned, state FROM hra_lib_posts WHERE id = $1::bigint FOR UPDATE`, [id]);
    if (!p) throw new NotFound('없는 글입니다.');
    if (p.state !== 'ACTIVE') throw new StateConflict('HRA_LIB_STATE', '보관 끝 글은 고치지 않습니다.');
    /* 보내지 않은 칸은 옛 값(undefined 를 걸러 덮음 · 규칙 11) */
    const merged: LibInput = { title: b.title ?? p.title, body: b.body === undefined ? p.body : b.body, audience: b.audience ?? p.audience, mustRead: b.mustRead, readDue: b.readDue };
    const c = await checkInput(db, merged, { kind: p.kind, mustRead: p.mustRead, readDue: p.readDue });
    const pinned = b.pinned === undefined ? p.pinned : b.pinned === true;
    await db.query(`INSERT INTO hra_lib_revisions (post_id, before, by_account) VALUES ($1::bigint, $2::jsonb, $3::uuid)`,
      [id, JSON.stringify({ title: p.title, body: p.body, audience: p.audience, mustRead: p.mustRead, readDue: p.readDue, pinned: p.pinned }), actor]);
    await db.query(`UPDATE hra_lib_posts SET title = $2, body = $3, audience = $4::text[], must_read = $5::boolean, read_due = $6::date, pinned = $7::boolean WHERE id = $1::bigint`,
      [id, c.title, c.body, c.audience, c.mustRead, c.readDue, pinned]);
    return { ok: true, id, note: '고쳤습니다(고치기 전 내용은 기록에 남음 · 읽음 기록은 그대로).' };
  });
}

/** POST /admin/hra/library/{id}/archive — 보관 끝(사유 · 되돌리지 않음) · 알림 풂 */
export async function archiveLibPost(db: DatabaseService, idIn: string, reasonIn: string) {
  const id = idOk(idIn);
  const reason = textOk(reasonIn, 2, 200);
  if (!reason) throw new PolicyViolation('HRA_REASON', '사유는 2 ~ 200자입니다.');
  const r = await db.query(`UPDATE hra_lib_posts SET state = 'ARCHIVED', archived_at = now(), archive_reason = $2 WHERE id = $1::bigint AND state = 'ACTIVE' RETURNING id`, [id, reason]);
  if (!r.length) {
    const [x] = await db.query(`SELECT 1 FROM hra_lib_posts WHERE id = $1::bigint`, [id]);
    if (!x) throw new NotFound('없는 글입니다.');
    throw new StateConflict('HRA_LIB_STATE', '이미 보관 끝 글입니다.');
  }
  await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = '보관 끝' WHERE alert_code = 'HRA_LIB_UNREAD' AND resolved_at IS NULL AND detail->>'postId' = $1`, [id]);
  return { ok: true, id, note: '보관 끝으로 표시했습니다(글 · 읽음 기록 · 파일은 남음).' };
}

/** GET /admin/hra/library/{id}/reads — 대상마다 읽음 · 안 읽음(이름 · 가린 메일) */
export async function libReads(db: DatabaseService, idIn: string) {
  const id = idOk(idIn);
  const [p] = await db.query<{ title: string; mustRead: boolean; readDue: string | null }>(`SELECT title, must_read AS "mustRead", read_due::text AS "readDue" FROM hra_lib_posts WHERE id = $1::bigint`, [id]);
  if (!p) throw new NotFound('없는 글입니다.');
  const rows = await db.query<{ accountId: string; name: string | null; email: string | null; readAt: string | null; roles: string[] }>(
    `WITH staff AS (SELECT r.account_id, array_agg(DISTINCT r.role ORDER BY r.role) AS roles FROM account_roles r JOIN accounts a ON a.id = r.account_id
                     WHERE r.role IN ('SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF') AND a.status = 'ACTIVE' AND (r.expires_at IS NULL OR r.expires_at > now())
                     GROUP BY r.account_id)
     SELECT s.account_id::text AS "accountId", a.name, a.email, x.read_at AS "readAt", s.roles
       FROM staff s JOIN accounts a ON a.id = s.account_id LEFT JOIN hra_lib_reads x ON x.post_id = $1::bigint AND x.account_id = s.account_id
      WHERE fn_hra_lib_can_read($1::bigint, s.account_id)
      ORDER BY (x.read_at IS NULL) DESC, a.name NULLS LAST LIMIT 500`, [id]);
  return { id, title: p.title, mustRead: p.mustRead, readDue: p.readDue, target: rows.length, read: rows.filter((r) => r.readAt).length,
           rows: rows.map((r) => ({ ...r, email: maskEmail(r.email), roles: r.roles.filter((x) => STAFF_ROLES.includes(x) || x === 'SUPER') })) };
}

/* ── 정기 작업(hra_daily 안) — 꼭 읽기 기한 지난 글마다 HRA_LIB_UNREAD 한 번 · 모두 읽거나 보관 끝이면 풂 ── */
export async function libUnreadJob(db: DatabaseService, today = kstToday()) {
  const s = await hraSettings(db);
  const due = await db.query<{ id: string; title: string; readDue: string }>(
    `SELECT id::text AS id, title, read_due::text AS "readDue" FROM hra_lib_posts WHERE state = 'ACTIVE' AND must_read AND read_due IS NOT NULL AND read_due < $1::date`, [today]);
  const stats = await readStats(db, due.map((x) => x.id));
  let made = 0, resolved = 0;
  for (const p of due) {
    const st = stats.get(p.id) ?? { target: 0, read: 0 };
    const left = st.target - st.read;
    if (left <= 0) {
      const r = await db.query(`UPDATE ops_alerts SET resolved_at = now(), resolve_note = '모두 읽음' WHERE alert_code = 'HRA_LIB_UNREAD' AND resolved_at IS NULL AND detail->>'postId' = $1 RETURNING id`, [p.id]);
      resolved += r.length;
      continue;
    }
    if (!s.libUnreadAlert) continue;
    const r = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'HRA_LIB_UNREAD', 'WARN', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'HRA_LIB_UNREAD' AND detail->>'postId' = $3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [`꼭 읽을 사내 공지 「${p.title}」 기한 ${p.readDue} 지남 — 안 읽은 사람 ${left}명(사무 › 사내 자료실 · 공지)`, JSON.stringify({ postId: p.id, readDue: p.readDue, left }), p.id]);
    made += r.length;
  }
  return { on: s.libUnreadAlert, due: due.length, made, resolved };
}
