/**
 * v10.295 (D217 · docs/416) — 공지 첨부 목록 SQL 조각(순서대로 json 배열).
 *   운영 화면은 파일 id 까지 · 사용자 웹(고객센터 · 파트너센터 · 판매자센터)은 id 없이 n(GET /notices/{id}/files/{n}) · 올리기를 마친(READY) 것만.
 *   alias = 공지 표 이름(n · notices)
 */
export function noticeFilesSql(alias: string, admin = false): string {
  const id = admin ? `'id', f.id, ` : '';
  const ready = admin ? '' : ` AND f.status = 'READY'`;
  return `(SELECT coalesce(json_agg(json_build_object(${id}'n', a.i - 1, 'name', f.original_name, 'contentType', f.content_type, 'size', f.size_bytes) ORDER BY a.i), '[]'::json)
                 FROM unnest(${alias}.attachments) WITH ORDINALITY a(fid, i) JOIN files f ON f.id = a.fid${ready})`;
}
export const NOTICE_MAX_FILES = 3;
