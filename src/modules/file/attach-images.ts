import { DatabaseService } from '../../db/database.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
import { storageFromEnv } from './storage';

/**
 * v10.31 — 매물 · 요청의 대표 · 상세 이미지(시안 「등록하기」 폼 · JPG · PNG 최대 10MB · 최대 6장).
 *
 * 붙일 수 있는 것: **내가 올린 · 확인을 마친(READY)** 그 용도(LISTING_IMAGE · REQUEST_IMAGE)의 파일만.
 *   남의 파일 id 를 적어 내 글에 붙이는 길을 막습니다(그러면 남의 비공개 파일이 공개 이미지 주소로 나갑니다).
 * 저장 모양: listing_media.s3_key = 'file:<id>' · requests.image_keys = ['<id>', …]
 */
export const MAX_IMAGES = 6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function checkOwnImages(db: DatabaseService, accountId: string, ids: string[] | undefined,
  purpose: 'LISTING_IMAGE' | 'REQUEST_IMAGE' | 'INQUIRY_ATTACHMENT', max = MAX_IMAGES): Promise<string[]> {
  const list = [...new Set((ids ?? []).map((x) => String(x).replace(/^file:/, '')))];
  if (list.length > max) throw new PolicyViolation(purpose === 'INQUIRY_ATTACHMENT' ? 'TOO_MANY_FILES' : 'TOO_MANY_IMAGES',
    purpose === 'INQUIRY_ATTACHMENT' ? `첨부는 ${max}개까지입니다.` : `이미지는 ${max}장까지 붙일 수 있습니다.`);
  if (!list.length) return [];
  if (list.some((x) => !UUID.test(x))) throw new PolicyViolation('IMAGE_INVALID', '올리기를 마친 파일만 붙일 수 있습니다.');
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM files WHERE id = ANY($1::uuid[]) AND owner_account_id = $2 AND purpose = $3 AND status = 'READY'`,
    [list, accountId, purpose]);
  if (rows.length !== list.length) throw new PolicyViolation('IMAGE_INVALID', '내가 올린 파일만 붙일 수 있습니다(올리기를 마치지 않았거나 다른 용도의 파일).');
  return list;
}

/** n 번째(0부터) 이미지 바이트 — 없으면 409 NOT_FOUND(상품 사진과 같은 규칙) */
export async function openImage(db: DatabaseService, fileId: string | undefined | null, purpose: string) {
  if (!fileId || !UUID.test(fileId)) throw new StateConflict('NOT_FOUND', '이미지가 없습니다.');
  const [f] = await db.query<{ storage_key: string; content_type: string; size_bytes: string }>(
    `SELECT storage_key, content_type, size_bytes FROM files WHERE id = $1 AND purpose = $2 AND status = 'READY'`, [fileId, purpose]);
  if (!f) throw new StateConflict('NOT_FOUND', '이미지가 없습니다.');
  const stream = await storageFromEnv().open(f.storage_key);
  if (!stream) throw new StateConflict('NOT_FOUND', '이미지가 없습니다.');
  return { stream, contentType: f.content_type, size: Number(f.size_bytes) };
}

/** 이미지 바이트를 그대로 내보냅니다(상품 사진과 같은 머리 — nosniff · CSP none · 5분 캐시) */
export function sendImage(res: import('express').Response, img: { stream: NodeJS.ReadableStream; contentType: string; size: number }) {
  res.status(200);
  res.setHeader('Content-Type', img.contentType); res.setHeader('Content-Length', String(img.size));
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  img.stream.on('error', () => res.destroy());
  img.stream.pipe(res);
}
