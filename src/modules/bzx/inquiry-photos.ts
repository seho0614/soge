import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { storageFromEnv } from '../file/storage';
import { contentDisposition } from '../file/sniff';
import { isOn, UUID_RE } from './common';

/* ---------------------------------------------------------------------
 * v10.611 (docs/753) ㉗ 1:1 문의 사진 첨부
 *   이미 있는 것: 문의 접수 때 첨부 3개(inquiries.attachment_keys · 파일 용도 INQUIRY_ATTACHMENT · 이미지 · PDF 10MB · D049) — 그대로
 *   더하는 것(bzx.inquiry_photos on · 처음 off):
 *     회원 — 접수 뒤에도 내 문의(닫히지 않은 것)에 사진 더 붙이기(한 번에 3장 · 문의마다 6장 · JPG · PNG 만)
 *     운영 — 답변에 사진 붙이기(문의마다 6장) · 회원은 내 문의 내역에서 봄(이 API 가 바이트를 줌 — 남의 파일 읽기 규칙 fn_file_can_read 는 고치지 않음)
 *   운영 화면 「1:1 문의」 한 건 화면에 그림 미리 보기(접수 첨부 · 더한 사진 · 답변 사진) — 보기는 스위치와 상관없이 늘
 *   파일 저장 · 형식 검사는 기존 파일 올리기(POST /files · complete 때 매직바이트)를 그대로 · 새 파일 용도 없음
 * ------------------------------------------------------------------- */

export const INQ_PHOTO_MAX = 6;
export const INQ_PHOTO_PER_CALL = 3;
const IMAGE = ['image/jpeg', 'image/png'];

interface Inq { id: string; account_id: string | null; status: string; attachment_keys: string[] | null }
async function inq(db: DatabaseService, id: string, me?: string | null): Promise<Inq> {
  if (!UUID_RE.test(id ?? '')) throw new NotFound('그 문의가 없습니다.');
  const [r] = await db.query<Inq>(`SELECT id::text AS id, account_id::text AS account_id, status, attachment_keys FROM inquiries WHERE id = $1::uuid`, [id]);
  if (!r || (me !== undefined && r.account_id !== me)) throw new NotFound('그 문의가 없습니다.');
  return r;
}

async function list(db: DatabaseService, id: string) {
  return db.query<{ fileId: string; side: string; name: string; contentType: string; createdAt: string }>(
    `SELECT x.file_id::text AS "fileId", x.side, f.original_name AS name, f.content_type AS "contentType", x.created_at AS "createdAt"
       FROM bzx_inquiry_files x JOIN files f ON f.id = x.file_id WHERE x.inquiry_id = $1::uuid AND f.status = 'READY' ORDER BY x.id`, [id]);
}

/** 붙일 파일 확인 — 올린 사람이 그 사람 · INQUIRY_ATTACHMENT · READY · 그림만(DB 트리거가 마지막으로 막음) */
async function checkFiles(db: DatabaseService, actor: string, ids: string[]) {
  const uniq = [...new Set((ids ?? []).map((x) => String(x).toLowerCase()))];
  if (!uniq.length) throw new PolicyViolation('BZX_INQ_PHOTO', '붙일 사진을 고르십시오.');
  if (uniq.length > INQ_PHOTO_PER_CALL) throw new PolicyViolation('BZX_INQ_PHOTO', `한 번에 ${INQ_PHOTO_PER_CALL}장까지 붙입니다.`);
  if (uniq.some((x) => !UUID_RE.test(x))) throw new PolicyViolation('BZX_INQ_PHOTO', '파일 번호가 맞지 않습니다.');
  const ok = await db.query<{ id: string }>(
    `SELECT id::text AS id FROM files WHERE id = ANY($1::uuid[]) AND owner_account_id = $2::uuid AND purpose = 'INQUIRY_ATTACHMENT' AND status = 'READY'
        AND content_type = ANY($3::text[])`, [uniq, actor, IMAGE]);
  if (ok.length !== uniq.length) throw new PolicyViolation('BZX_INQ_PHOTO', '내가 올린 사진(JPG · PNG · 문의 첨부 용도)만 붙일 수 있습니다.');
  return uniq;
}

async function add(db: DatabaseService, inquiryId: string, side: 'MEMBER' | 'STAFF', actor: string, ids: string[]) {
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('bzx_inq_photo:' || $1::text))`, [inquiryId]);
    const [c] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM bzx_inquiry_files WHERE inquiry_id = $1::uuid AND side = $2`, [inquiryId, side]);
    if ((c?.n ?? 0) + ids.length > INQ_PHOTO_MAX) throw new StateConflict('BZX_INQ_PHOTO_FULL', `사진은 문의마다 ${INQ_PHOTO_MAX}장까지입니다(지금 ${c?.n ?? 0}장).`);
    for (const f of ids) {
      await db.query(`INSERT INTO bzx_inquiry_files (inquiry_id, file_id, side, added_by) VALUES ($1::uuid, $2::uuid, $3, $4::uuid) ON CONFLICT (inquiry_id, file_id) DO NOTHING`,
        [inquiryId, f, side, actor]);
    }
    return { ok: true, id: inquiryId, added: ids.length, items: await list(db, inquiryId), note: `사진 ${ids.length}장을 붙였습니다.` };
  });
}

/* ── 회원 ── */
/** GET /me/bzx/inquiries/{id}/photos */
export async function myPhotos(db: DatabaseService, me: string | null, id: string) {
  const r = await inq(db, id, me ?? null);
  const items = await list(db, r.id);
  return { on: await isOn(db, 'bzx.inquiry_photos'), canAdd: r.status !== 'CLOSED', max: INQ_PHOTO_MAX,
    items: items.map((x) => ({ ...x, url: `/api/v1/me/bzx/inquiries/${r.id}/photos/${x.fileId}` })),
    attached: (r.attachment_keys ?? []).length };
}
/** POST /me/bzx/inquiries/{id}/photos — 닫히지 않은 내 문의에 사진 더 붙이기 */
export async function addMyPhotos(db: DatabaseService, me: string | null, id: string, fileIds: string[]) {
  if (!(await isOn(db, 'bzx.inquiry_photos'))) throw new PolicyViolation('BZX_OFF', '지금은 사진을 더 붙일 수 없습니다(기능 꺼짐) — 새 문의로 첨부해 주십시오.');
  if (!me) throw new NotFound('그 문의가 없습니다.');
  const r = await inq(db, id, me);
  if (r.status === 'CLOSED') throw new StateConflict('INQUIRY_CLOSED', '닫힌 문의에는 붙일 수 없습니다 — 새 문의로 남겨 주십시오.');
  return add(db, r.id, 'MEMBER', me, await checkFiles(db, me, fileIds));
}
/** GET /me/bzx/inquiries/{id}/photos/{fileId} — 내 문의에 붙은 사진 바이트(내가 붙인 것 · 운영 답변 사진) */
export async function myPhotoFile(db: DatabaseService, me: string | null, id: string, fileId: string) {
  const r = await inq(db, id, me ?? null);
  if (!UUID_RE.test(fileId ?? '')) throw new NotFound('사진이 없습니다.');
  const [f] = await db.query<{ storage_key: string; content_type: string; size_bytes: string; original_name: string }>(
    `SELECT f.storage_key, f.content_type, f.size_bytes, f.original_name FROM bzx_inquiry_files x JOIN files f ON f.id = x.file_id
      WHERE x.inquiry_id = $1::uuid AND x.file_id = $2::uuid AND f.status = 'READY'`, [r.id, fileId]);
  if (!f) throw new NotFound('사진이 없습니다.');
  const stream = await storageFromEnv().open(f.storage_key);
  if (!stream) throw new NotFound('사진이 없습니다.');
  return { stream, contentType: f.content_type, size: Number(f.size_bytes), disposition: contentDisposition('inline', f.original_name) };
}

/* ── 운영 ── */
/** GET /admin/bzx/inquiries/{id}/photos — 접수 첨부 + 더한 사진 + 답변 사진(미리 보기는 GET /files/{id}) */
export async function staffPhotos(db: DatabaseService, id: string) {
  const r = await inq(db, id);
  const first = (r.attachment_keys ?? []).length ? await db.query<{ fileId: string; name: string; contentType: string }>(
    `SELECT id::text AS "fileId", original_name AS name, content_type AS "contentType" FROM files WHERE id = ANY($1::uuid[]) AND status = 'READY'`, [r.attachment_keys]) : [];
  return { id: r.id, on: await isOn(db, 'bzx.inquiry_photos'), max: INQ_PHOTO_MAX,
    first: first.map((x) => ({ ...x, side: 'ASK' })), items: await list(db, r.id) };
}
/** POST /admin/bzx/inquiries/{id}/photos — 답변 사진 붙이기(운영이 올린 INQUIRY_ATTACHMENT 그림) */
export async function addStaffPhotos(db: DatabaseService, actor: string | null, id: string, fileIds: string[]) {
  if (!(await isOn(db, 'bzx.inquiry_photos'))) throw new PolicyViolation('BZX_OFF', '답변 사진 기능이 꺼져 있습니다(bzx.inquiry_photos).');
  if (!actor) throw new NotFound('그 문의가 없습니다.');
  const r = await inq(db, id);
  if (!r.account_id) throw new StateConflict('BZX_INQ_GUEST', '비회원 문의는 답변 사진을 볼 곳이 없습니다 — 메일 답변에 적으십시오.');
  if (r.status === 'CLOSED') throw new StateConflict('INQUIRY_CLOSED', '닫힌 문의입니다 — 「다시 열기」 뒤 붙이십시오.');
  return add(db, r.id, 'STAFF', actor, await checkFiles(db, actor, fileIds));
}
