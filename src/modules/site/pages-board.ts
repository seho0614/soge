import { DatabaseService } from '../../db/database.service';
import { opsBoardPost } from '../admin/ops-board.service';

/* v10.734 (D326 · docs/842) 운영자 게시판 페이지 자동 글 — 페이지 게시 · 되돌림 · 예약 게시 · 관 점검 · 게시 요청
 *   스위치 ops.board_pages(처음 on) · 게시판이 실패해도 일은 계속(기록만 · opsBoardPost) */
export async function pagesBoard(db: DatabaseService, title: string, body?: string): Promise<void> {
  try {
    const [s] = await db.query<{ value: string }>(`SELECT value FROM site_settings WHERE key = 'ops.board_pages'`);
    if (s && s.value === 'off') return;
    await opsBoardPost(db, 'PAGES', title.slice(0, 200), body || title, null, null);
  } catch { /* 게시판 실패는 일과 상관없음 */ }
}
