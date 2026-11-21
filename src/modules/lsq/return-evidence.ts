import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { maskName } from '../../common/mask';
import { openImage } from '../file/attach-images';
import { LSQ_UUID_RE, lsqLine, lsqNotify, lsqSettings } from './common';

/* ---------------------------------------------------------------------
 * v10.608 (docs/750) ㉔ 반품 · 교환 사진 첨부 · 판정 기록 — 기존 신청(hlt_returns · 판정은 health-return.service decideReturn 그대로) 위에
 *   사진(lsq.return_photos on · 처음 off): 구매 회원(BUYER) · 그 주문의 입점 판매자(SELLER)가 RETURN_PHOTO 파일(내가 올린 · READY)을 붙임
 *     · 한쪽 lsq.return_photo_max(5)장(DB 는 10장) · 신청이 열려 있을 때(REQUESTED · APPROVED)만 · 운영은 가리기만(지우지 않음)
 *   판정 기록(lsq_return_verdicts · 쌓기만): STATE(신청 · 승인 · 반려 · 환불 — DB 트리거가 적음) · INSPECT(상품 상태 · 책임 — 판매자 · 운영) · NOTE(메모)
 *     · 「회원에게 보임」 표시 줄만 회원이 봄 · 회원에게 보이는 검수 · 메모를 적으면 알림 LSQ_RETURN_NOTE
 *   열람: 사진 바이트는 그 신청의 회원 · 판매자 · 운영만(이 API 가 보고 엶 · fn_file_can_read 는 고치지 않음)
 *   ★ 판정 기록은 환불 · 승인을 바꾸지 않음 — 승인 · 반려 · 환불은 기존 화면 그대로(기록은 근거)
 * ------------------------------------------------------------------- */

export const LSQ_CONDITIONS = ['UNOPENED', 'OPENED', 'USED', 'DAMAGED', 'MISSING', 'WRONG_ITEM'] as const;   // DB CHECK 와 같음
export const LSQ_FAULTS = ['BUYER', 'SELLER', 'CARRIER', 'UNKNOWN'] as const;
const KIND_KO: Record<string, string> = { CANCEL: '취소', RETURN: '반품', EXCHANGE: '교환' };

interface Ret { id: string; state: string; kind: string; order_no: string; buyer: string; seller_account: string | null; seller_type: string | null }

async function loadReturn(db: DatabaseService, id: string): Promise<Ret> {
  if (!LSQ_UUID_RE.test(String(id ?? ''))) throw new NotFound('없는 신청입니다.');
  const [r] = await db.query<Ret>(
    `SELECT r.id::text AS id, r.state, r.kind, o.order_no, o.account_id::text AS buyer, s.account_id::text AS seller_account, s.type AS seller_type
       FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id LEFT JOIN hlt_sellers s ON s.id = o.seller_id WHERE r.id = $1::uuid`, [id]);
  if (!r) throw new NotFound('없는 신청입니다.');
  return r;
}

/** 회원 · 판매자 쪽 판정 — BUYER(주문한 회원) · SELLER(입점 판매자 계정) · 아니면 404 */
function sideOf(r: Ret, me: string): 'BUYER' | 'SELLER' {
  if (r.buyer === me) return 'BUYER';
  if (r.seller_account && r.seller_account === me && ['TENANT', 'BRAND'].includes(r.seller_type ?? '')) return 'SELLER';
  throw new NotFound('없는 신청입니다.');
}

async function evidence(db: DatabaseService, r: Ret, view: 'BUYER' | 'SELLER' | 'ADMIN', base: string) {
  const photos = await db.query<{ id: string; side: string; note: string | null; createdAt: string; hidden: boolean; fileId: string }>(
    `SELECT id::text AS id, side, note, created_at AS "createdAt", hidden_at IS NOT NULL AS hidden, file_id::text AS "fileId"
       FROM lsq_return_photos WHERE return_id = $1::uuid AND ($2::boolean OR hidden_at IS NULL) ORDER BY created_at, id`, [r.id, view === 'ADMIN']);
  const verdicts = await db.query(
    `SELECT v.id::text AS id, v.kind, v.actor_side AS side, v.from_state AS "fromState", v.to_state AS "toState", v.item_condition AS condition, v.fault,
            v.note, v.visible_to_buyer AS "visibleToBuyer", v.created_at AS "createdAt"
       FROM lsq_return_verdicts v WHERE v.return_id = $1::uuid AND ($2::boolean OR v.visible_to_buyer) ORDER BY v.created_at, v.id`, [r.id, view !== 'BUYER']);
  const s = await lsqSettings(db);
  const mine = view === 'ADMIN' ? 0 : photos.filter((p) => p.side === view && !p.hidden).length;
  return {
    returnId: r.id, kind: r.kind, state: r.state, orderNo: r.order_no, view,
    photosOn: s.returnPhotosOn, photoMax: s.returnPhotoMax,
    canAddPhoto: view !== 'ADMIN' && s.returnPhotosOn && ['REQUESTED', 'APPROVED'].includes(r.state) && mine < s.returnPhotoMax,
    canInspect: view === 'ADMIN' || (view === 'SELLER' && s.returnPhotosOn),
    /* 운영은 파일 번호로 기존 GET /files/{id}(5분 주소 · 열람 기록 FILE_OPEN)를 씀 · 회원 · 판매자는 이 API 의 사진 주소만 */
    photos: photos.map(({ fileId, ...p }) => (view === 'ADMIN' ? { ...p, fileId } : { ...p, url: `${base}/${p.id}` })), verdicts,
  };
}

/** 회원 · 판매자 — 사진 · 판정 기록 */
export async function myEvidence(db: DatabaseService, me: string, id: string) {
  const r = await loadReturn(db, id);
  const side = sideOf(r, me);
  return evidence(db, r, side, `/api/v1/lsq/returns/${r.id}/photos`);
}

/** 회원 · 판매자 — 사진 붙이기 */
export async function addPhoto(db: DatabaseService, me: string, id: string, fileId: string, note?: string) {
  const s = await lsqSettings(db);
  if (!s.returnPhotosOn) throw new StateConflict('LSQ_RETURN_PHOTO_OFF', '지금은 반품 사진을 받지 않습니다.');
  const r = await loadReturn(db, id);
  const side = sideOf(r, me);
  if (!['REQUESTED', 'APPROVED'].includes(r.state)) throw new StateConflict('LSQ_RETURN_CLOSED', '처리가 끝난 신청에는 사진을 붙일 수 없습니다.');
  if (!LSQ_UUID_RE.test(String(fileId ?? ''))) throw new PolicyViolation('LSQ_RETURN_PHOTO_FILE', '올리기를 마친 사진만 붙일 수 있습니다.');
  const [n] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM lsq_return_photos WHERE return_id = $1::uuid AND side = $2 AND hidden_at IS NULL`, [r.id, side]);
  if ((n?.n ?? 0) >= s.returnPhotoMax) throw new PolicyViolation('LSQ_RETURN_PHOTO_MAX', `사진은 ${s.returnPhotoMax}장까지입니다.`);
  const [f] = await db.query<{ id: string }>(`SELECT id::text AS id FROM files WHERE id = $1::uuid AND owner_account_id = $2::uuid AND purpose = 'RETURN_PHOTO' AND status = 'READY'`, [fileId, me]);
  if (!f) throw new PolicyViolation('LSQ_RETURN_PHOTO_FILE', '내가 올린 반품 사진(올리기 끝남)만 붙일 수 있습니다.');
  const [p] = await db.query<{ id: string }>(
    `INSERT INTO lsq_return_photos (return_id, file_id, side, added_by, note) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5)
     ON CONFLICT (return_id, file_id) DO NOTHING RETURNING id::text AS id`, [r.id, fileId, side, me, lsqLine(note, 200)]);
  if (!p) throw new StateConflict('LSQ_RETURN_PHOTO_DUP', '이미 붙인 사진입니다.');
  return { ok: true, photoId: p.id, note: '사진을 붙였습니다 — 판매자 · 운영이 판정할 때 봅니다.' };
}

/** 사진 바이트 — 그 신청의 회원 · 판매자 · 운영만 */
export async function photoBytes(db: DatabaseService, me: string, id: string, photoId: string) {
  const r = await loadReturn(db, id);
  sideOf(r, me);
  if (!/^\d{1,18}$/.test(String(photoId ?? ''))) throw new StateConflict('NOT_FOUND', '이미지가 없습니다.');
  const [p] = await db.query<{ file_id: string }>(
    `SELECT file_id::text AS file_id FROM lsq_return_photos WHERE id = $1::bigint AND return_id = $2::uuid AND hidden_at IS NULL`, [photoId, r.id]);
  if (!p) throw new StateConflict('NOT_FOUND', '이미지가 없습니다.');
  return openImage(db, p.file_id, 'RETURN_PHOTO');
}

export interface VerdictIn { kind: 'INSPECT' | 'NOTE'; condition?: string; fault?: string; note?: string; visibleToBuyer?: boolean }

async function writeVerdict(db: DatabaseService, r: Ret, actor: string | null, side: 'SELLER' | 'ADMIN', d: VerdictIn) {
  if (!['INSPECT', 'NOTE'].includes(d.kind)) throw new PolicyViolation('LSQ_VERDICT_KIND', '기록 종류는 INSPECT · NOTE 중 하나입니다.');
  const note = d.note === undefined || d.note === null ? null : String(d.note).replace(/\s+/g, ' ').trim().slice(0, 500) || null;
  if (d.kind === 'INSPECT') {
    if (!(LSQ_CONDITIONS as readonly string[]).includes(String(d.condition))) throw new PolicyViolation('LSQ_VERDICT_CONDITION', '상품 상태를 골라 주십시오.');
    if (!(LSQ_FAULTS as readonly string[]).includes(String(d.fault))) throw new PolicyViolation('LSQ_VERDICT_FAULT', '책임을 골라 주십시오.');
  } else if (!note || note.length < 2) throw new PolicyViolation('LSQ_VERDICT_NOTE', '메모는 2 ~ 500자입니다.');
  const visible = d.visibleToBuyer !== false;
  const [v] = await db.query<{ id: string }>(
    `INSERT INTO lsq_return_verdicts (return_id, kind, actor, actor_side, item_condition, fault, note, visible_to_buyer)
     VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::boolean) RETURNING id::text AS id`,
    [r.id, d.kind, actor, side, d.kind === 'INSPECT' ? d.condition : null, d.kind === 'INSPECT' ? d.fault : null, note, visible]);
  if (visible) await lsqNotify(db, r.buyer, 'LSQ_RETURN_NOTE', { kind: KIND_KO[r.kind] ?? '반품', orderNo: r.order_no }, '/my/health/returns');
  return { ok: true, verdictId: v!.id, note: visible ? '판정 기록을 남겼습니다 — 회원에게도 보입니다.' : '판정 기록을 남겼습니다(운영 · 판매자만 봄).' };
}

/** 판매자 — 검수 판정 · 메모(스위치 on 일 때) */
export async function sellerVerdict(db: DatabaseService, me: string, id: string, d: VerdictIn) {
  const s = await lsqSettings(db);
  if (!s.returnPhotosOn) throw new StateConflict('LSQ_RETURN_PHOTO_OFF', '지금은 반품 사진 · 판정 기록을 받지 않습니다.');
  const r = await loadReturn(db, id);
  if (sideOf(r, me) !== 'SELLER') throw new Forbidden('LSQ_NOT_SELLER', '이 주문의 판매자만 판정 기록을 남깁니다.');
  return writeVerdict(db, r, me, 'SELLER', d);
}

/** 판매자 — 내 주문의 반품 · 교환 신청(사진 수 · 기록 수) */
export async function sellerReturns(db: DatabaseService, me: string) {
  const s = await lsqSettings(db);
  const rows = await db.query(
    `SELECT r.id::text AS id, r.kind, r.state, r.reason, o.order_no AS "orderNo", r.created_at AS "createdAt",
            (SELECT count(*)::int FROM lsq_return_photos p WHERE p.return_id = r.id AND p.hidden_at IS NULL) AS photos,
            (SELECT count(*)::int FROM lsq_return_verdicts v WHERE v.return_id = r.id) AS verdicts
       FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id JOIN hlt_sellers sl ON sl.id = o.seller_id
      WHERE sl.account_id = $1::uuid AND sl.type IN ('TENANT', 'BRAND') ORDER BY (r.state = 'REQUESTED') DESC, r.created_at DESC LIMIT 100`, [me]);
  return { on: s.returnPhotosOn, items: rows };
}

/** 운영 — 신청 목록(사진 · 기록 수 · 가린 이름) */
export async function adminReturns(db: DatabaseService, state?: string) {
  const settings = await lsqSettings(db);
  const st = state && ['REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED'].includes(state) ? state : null;
  const rows = await db.query<{ name: string | null } & Record<string, unknown>>(
    `SELECT r.id::text AS id, r.kind, r.state, r.reason, o.order_no AS "orderNo", coalesce(sl.type, 'DIRECT') AS "sellerType", a.name, r.created_at AS "createdAt",
            (SELECT count(*)::int FROM lsq_return_photos p WHERE p.return_id = r.id AND p.hidden_at IS NULL) AS photos,
            (SELECT count(*)::int FROM lsq_return_verdicts v WHERE v.return_id = r.id AND v.kind <> 'STATE') AS inspections
       FROM hlt_returns r JOIN hlt_orders o ON o.id = r.order_id JOIN accounts a ON a.id = o.account_id LEFT JOIN hlt_sellers sl ON sl.id = o.seller_id
      WHERE ($1::text IS NULL OR r.state = $1) ORDER BY r.created_at DESC LIMIT 100`, [st]);
  return { settings, conditions: LSQ_CONDITIONS, faults: LSQ_FAULTS, items: rows.map(({ name, ...x }) => ({ ...x, member: maskName(name) ?? '회원' })),
    note: '판정 기록은 근거입니다 — 승인 · 반려 · 환불은 소개몰 › 주문 › 취소 · 반품에서 그대로 합니다(상태 바뀜은 자동으로 기록).' };
}

/** 운영 — 신청 하나(사진 · 판정 기록 모두) */
export async function adminEvidence(db: DatabaseService, id: string) {
  const r = await loadReturn(db, id);
  return evidence(db, r, 'ADMIN', '');
}

/** 운영 — 검수 판정 · 메모 */
export async function adminVerdict(db: DatabaseService, actor: string | null, id: string, d: VerdictIn) {
  const r = await loadReturn(db, id);
  return writeVerdict(db, r, actor, 'ADMIN', d);
}

/** 운영 — 사진 가리기(지우지 않음 · 회원 · 판매자에게 안 보임) */
export async function adminHidePhoto(db: DatabaseService, actor: string | null, id: string, photoId: string) {
  const r = await loadReturn(db, id);
  if (!/^\d{1,18}$/.test(String(photoId ?? ''))) throw new NotFound('없는 사진입니다.');
  const [p] = await db.query<{ id: string }>(
    `UPDATE lsq_return_photos SET hidden_at = now(), hidden_by = $3::uuid WHERE id = $1::bigint AND return_id = $2::uuid AND hidden_at IS NULL RETURNING id::text AS id`,
    [photoId, r.id, actor]);
  if (!p) throw new StateConflict('LSQ_PHOTO_HIDDEN', '없거나 이미 가린 사진입니다.');
  return { ok: true, note: '사진을 가렸습니다(기록은 남음).' };
}
