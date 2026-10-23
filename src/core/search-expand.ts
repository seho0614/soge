import { DatabaseService } from '../db/database.service';

/**
 * v10.83 (D111) — 검색어 넓히기. 낱말마다 「원래 말|동의어|오타 교정어」(fn_search_expand)로 바꿔
 * 공용 판정 fn_search_match · fn_search_head · fn_search_rank 에 넘깁니다.
 *
 *   · 검색 한 번에 **한 번만** 부릅니다 — SQL 안에서 줄마다 부르면 동의어 표를 줄마다 읽습니다.
 *   · 사람이 친 | 는 띄어쓰기로 바꿉니다(대안 기호와 섞이지 않게).
 *   · 비었으면 null(검색 안 함).
 */
export async function expandKeyword(db: DatabaseService, raw?: string | null): Promise<string | null> {
  const t = String(raw ?? '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const [r] = await db.query<{ k: string | null }>(`SELECT fn_search_expand($1) AS k`, [t]);
  return r?.k || t;
}
