import { Readable } from 'node:stream';
import { StateConflict } from '../../core/errors';
import { sgb } from '../../core/sgb-client';
import type { DatabaseService } from '../../db/database.service';

/* e3.5 (docs/011) 올린 그림 열기 — 소개뱅크 file/attach-images 의 openImage 와 같은 모양
 *   파일 몸통 저장소는 소개뱅크 → GET /internal/erp/files/{id}/content?purpose= (소개뱅크가 용도 · 상태 확인) */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function openImage(_db: DatabaseService, fileId: string | undefined | null, purpose: string) {
  if (!fileId || !UUID.test(fileId)) throw new StateConflict('NOT_FOUND', '이미지가 없습니다.');
  const r = await sgb.bytes(`/internal/erp/files/${fileId}/content?purpose=${encodeURIComponent(purpose)}`);
  if (r.status !== 200 || !r.data.length) throw new StateConflict('NOT_FOUND', '이미지가 없습니다.');
  return { stream: Readable.from(r.data) as NodeJS.ReadableStream, contentType: r.contentType, size: r.data.length };
}
