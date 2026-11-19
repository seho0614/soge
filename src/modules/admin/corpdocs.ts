import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.425 (D253 · docs/562) 사내 문서함
 *   분류 ARTICLES 정관 · REGISTRY 등기부 · SEAL 인감 · BIZ_REG 사업자등록 · RULES 규정 · CERT 인증서 · ETC 그 밖.
 *   파일은 POST /files(purpose CORP_DOC · SUPER · ADMIN) 로 올린 뒤 붙임 · 판은 쌓기만(새 판 = 옛 판 보관) · 지우기 없음(보관 끝만 · 사유).
 *   만료 N일(acct.corp_doc_due_days · 30) 전부터 CORP_DOC_DUE(가장 최근 판 하나에 한 번) · 새 판 · 보관 끝 · 만료일 지움이면 풀림.
 * ------------------------------------------------------------------- */

export const CORP_DOC_CATS = ['ARTICLES', 'REGISTRY', 'SEAL', 'BIZ_REG', 'RULES', 'CERT', 'ETC'] as const;
export const CORP_DOC_KO: Record<string, string> = { ARTICLES: '정관', REGISTRY: '등기부', SEAL: '인감', BIZ_REG: '사업자등록', RULES: '규정', CERT: '인증서', ETC: '그 밖' };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const dayOrNull = (v?: string | null) => {
  if (v == null || v === '') return null;
  if (!DAY.test(v) || Number.isNaN(Date.parse(v))) throw new PolicyViolation('CORP_DOC_DATE', '날짜는 YYYY-MM-DD 로 적어 주십시오.');
  return v;
};
const idOk = (id: string) => { if (!/^\d{1,18}$/.test(id ?? '')) throw new NotFound('사내 문서가 없습니다.'); return id; };

async function dueDays(db: DatabaseService) {
  const [s] = await db.query<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = 'acct.corp_doc_due_days'`);
  return Math.min(180, Math.max(1, Number(s?.value ?? 30) || 30));
}

/** GET /admin/corp-docs?state=&category= — 문서마다 가장 최근 판 · 만료 · 남은 날 */
export async function listCorpDocs(db: DatabaseService, q: { state?: string; category?: string }) {
  const days = await dueDays(db);
  const rows = await db.query<Record<string, unknown> & { expires_on: string | null }>(
    `SELECT d.id::text AS id, d.category, d.title, d.memo, d.state, d.archived_at AS "archivedAt", d.archive_reason AS "archiveReason", d.created_at AS "createdAt",
            v.version_no AS "versionNo", v.file_id::text AS "fileId", v.issued_on::text AS "issuedOn", v.expires_on::text AS expires_on, v.created_at AS "versionAt",
            f.original_name AS "fileName", f.size_bytes AS "fileSize",
            (SELECT count(*)::int FROM corp_doc_versions x WHERE x.doc_id = d.id) AS versions
       FROM corp_docs d
       LEFT JOIN LATERAL (SELECT * FROM corp_doc_versions v WHERE v.doc_id = d.id ORDER BY v.version_no DESC LIMIT 1) v ON true
       LEFT JOIN files f ON f.id = v.file_id
      WHERE ($1::text IS NULL OR d.state = $1) AND ($2::text IS NULL OR d.category = $2)
      ORDER BY (d.state = 'ARCHIVED'), v.expires_on NULLS LAST, d.category, d.title LIMIT 500`,
    [q.state && ['ACTIVE', 'ARCHIVED'].includes(q.state) ? q.state : null, q.category && (CORP_DOC_CATS as readonly string[]).includes(q.category) ? q.category : null]);
  const today = kstToday();
  const items = rows.map((r) => {
    const left = r.expires_on ? Math.round((Date.parse(r.expires_on) - Date.parse(today)) / 86400e3) : null;
    return { ...r, expiresOn: r.expires_on, categoryKo: CORP_DOC_KO[String(r.category)] ?? r.category, daysLeft: left,
             due: r.state === 'ACTIVE' && left != null && left <= days, expired: r.state === 'ACTIVE' && left != null && left < 0 };
  });
  return { items, dueDays: days, categories: CORP_DOC_CATS.map((c) => ({ code: c, label: CORP_DOC_KO[c] })),
           count: { active: items.filter((x) => (x as { state?: string }).state === 'ACTIVE').length, due: items.filter((x) => x.due).length, expired: items.filter((x) => x.expired).length },
           note: '회사 문서(정관 · 등기부 · 인감 · 사업자등록 · 규정 · 인증서)를 판으로 보관합니다. 새 판을 올리면 옛 판은 그대로 남고, 지우지 않습니다(보관 끝 표시만).' };
}

export async function corpDocVersions(db: DatabaseService, id: string) {
  const [d] = await db.query(`SELECT id::text AS id, category, title, memo, state FROM corp_docs WHERE id = $1::bigint`, [idOk(id)]);
  if (!d) throw new NotFound('사내 문서가 없습니다.');
  const versions = await db.query(
    `SELECT v.id::text AS id, v.version_no AS "versionNo", v.file_id::text AS "fileId", v.issued_on::text AS "issuedOn", v.expires_on::text AS "expiresOn", v.note,
            v.created_at AS "createdAt", coalesce(a.name, a.email) AS "uploadedBy", f.original_name AS "fileName", f.size_bytes AS "fileSize"
       FROM corp_doc_versions v LEFT JOIN accounts a ON a.id = v.uploaded_by LEFT JOIN files f ON f.id = v.file_id
      WHERE v.doc_id = $1::bigint ORDER BY v.version_no DESC`, [id]);
  return { doc: d, versions };
}

/** POST /admin/corp-docs — 문서 + 첫 판 */
export async function addCorpDoc(db: DatabaseService, b: { category: string; title: string; memo?: string; fileId: string; issuedOn?: string; expiresOn?: string; note?: string }, actor: string | null) {
  if (!(CORP_DOC_CATS as readonly string[]).includes(b.category)) throw new PolicyViolation('CORP_DOC', '모르는 분류입니다.');
  const title = (b.title ?? '').replace(/\s+/g, ' ').trim();
  if (title.length < 2 || title.length > 100) throw new PolicyViolation('CORP_DOC', '제목은 2 ~ 100자입니다.');
  const issued = dayOrNull(b.issuedOn), expires = dayOrNull(b.expiresOn);
  if (issued && expires && expires < issued) throw new PolicyViolation('CORP_DOC_DATE', '만료일이 발급일보다 빠릅니다.');
  return db.transaction(async () => {
    const [d] = await db.query<{ id: string }>(
      `INSERT INTO corp_docs (category, title, memo, created_by) VALUES ($1, $2, nullif($3, ''), $4) RETURNING id::text AS id`, [b.category, title, (b.memo ?? '').trim().slice(0, 400), actor]);
    await db.query(
      `INSERT INTO corp_doc_versions (doc_id, version_no, file_id, issued_on, expires_on, note, uploaded_by) VALUES ($1::bigint, 1, $2::uuid, $3::date, $4::date, nullif($5, ''), $6)`,
      [d!.id, b.fileId, issued, expires, (b.note ?? '').trim().slice(0, 200), actor]);
    return { ok: true, id: d!.id, note: `「${title}」을(를) 문서함에 넣었습니다(1판).` };
  });
}

/** POST /admin/corp-docs/{id}/versions — 새 판(옛 판은 보관) · 만료 알림은 다음 정기 작업에서 풀림 */
export async function addCorpDocVersion(db: DatabaseService, id: string, b: { fileId: string; issuedOn?: string; expiresOn?: string; note?: string }, actor: string | null) {
  const issued = dayOrNull(b.issuedOn), expires = dayOrNull(b.expiresOn);
  if (issued && expires && expires < issued) throw new PolicyViolation('CORP_DOC_DATE', '만료일이 발급일보다 빠릅니다.');
  const [d] = await db.query<{ state: string }>(`SELECT state FROM corp_docs WHERE id = $1::bigint`, [idOk(id)]);
  if (!d) throw new NotFound('사내 문서가 없습니다.');
  const [v] = await db.query<{ n: number }>(
    `INSERT INTO corp_doc_versions (doc_id, version_no, file_id, issued_on, expires_on, note, uploaded_by)
     SELECT $1::bigint, coalesce(max(version_no), 0) + 1, $2::uuid, $3::date, $4::date, nullif($5, ''), $6 FROM corp_doc_versions WHERE doc_id = $1::bigint
     RETURNING version_no AS n`, [id, b.fileId, issued, expires, (b.note ?? '').trim().slice(0, 200), actor]);
  await corpDocDueJob(db);
  return { ok: true, id, versionNo: v?.n, note: `새 판(${v?.n}판)을 올렸습니다 — 옛 판은 보관됩니다.` };
}

/** POST /admin/corp-docs/{id}/archive — 보관 끝(SUPER · 사유 · 되돌리지 않음) */
export async function archiveCorpDoc(db: DatabaseService, id: string, reason: string) {
  const t = (reason ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  const r = await db.query(`UPDATE corp_docs SET state = 'ARCHIVED', archived_at = now(), archive_reason = $2 WHERE id = $1::bigint AND state = 'ACTIVE' RETURNING id`, [idOk(id), t]);
  if (!r.length) throw new NotFound('보관 중인 사내 문서가 없습니다.');
  await corpDocDueJob(db);
  return { ok: true, id, note: '보관 끝으로 표시했습니다(파일 · 판은 그대로 남음).' };
}

/** 정기 작업 corp_doc_due(매일 09:30) — 만료 N일 전 CORP_DOC_DUE · 풀기 */
export async function corpDocDueJob(db: DatabaseService) {
  const days = await dueDays(db);
  const resolved = await db.query(
    `UPDATE ops_alerts a SET resolved_at = now(), resolve_note = '새 판 · 보관 끝 · 만료일 바뀜'
      WHERE a.alert_code = 'CORP_DOC_DUE' AND a.resolved_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM corp_docs d JOIN LATERAL (SELECT * FROM corp_doc_versions v WHERE v.doc_id = d.id ORDER BY v.version_no DESC LIMIT 1) v ON true
                         WHERE d.id::text = a.detail->>'docId' AND v.id::text = a.detail->>'versionId' AND d.state = 'ACTIVE' AND v.expires_on IS NOT NULL
                           AND v.expires_on <= (now() AT TIME ZONE 'Asia/Seoul')::date + $1::int)
      RETURNING a.id`, [days]);
  const made = await db.query<{ id: string }>(
    `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
     SELECT 'CORP_DOC_DUE', CASE WHEN v.expires_on < (now() AT TIME ZONE 'Asia/Seoul')::date THEN 'CRITICAL' ELSE 'WARN' END,
            '사내 문서 「' || d.title || '」 만료 ' || v.expires_on::text || ' — 정책 › 사내 문서함에서 새 판을 올리십시오',
            jsonb_build_object('docId', d.id::text, 'versionId', v.id::text, 'expiresOn', v.expires_on::text), clock_timestamp()
       FROM corp_docs d JOIN LATERAL (SELECT * FROM corp_doc_versions v WHERE v.doc_id = d.id ORDER BY v.version_no DESC LIMIT 1) v ON true
      WHERE d.state = 'ACTIVE' AND v.expires_on IS NOT NULL AND v.expires_on <= (now() AT TIME ZONE 'Asia/Seoul')::date + $1::int
        AND NOT EXISTS (SELECT 1 FROM ops_alerts a WHERE a.alert_code = 'CORP_DOC_DUE' AND a.detail->>'versionId' = v.id::text)
     ON CONFLICT DO NOTHING RETURNING id::text AS id`, [days]);
  return { days, made: made.length, resolved: resolved.length };
}
