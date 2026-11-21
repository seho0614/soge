import { DatabaseService } from '../../db/database.service';
import { routeNeeds } from './perm.service';

/* ---------------------------------------------------------------------
 * v10.566 (docs/708) 업무 사용 기록 — 권한 정기 점검 「90일 안 쓴 권한그룹」 셈용
 *   PermGuard 가 운영 역할 API 요청(SUPER 빼고)을 볼 때 부름 — 기다리지 않음 · 실패해도 요청은 그대로
 *   그 주소의 업무(perm_route_map · routeNeeds 캐시)를 계정마다 하루 한 번만 prr_task_use(last_on)에 남김
 *   주소 · 시각 · 요청 내용은 남기지 않음(계정 · 업무 · 날짜만) · 이 파일은 perm.service 만 가져옴(가드 import 고리 없게)
 * ------------------------------------------------------------------- */

const seen = new Map<string, string>();   // 계정|업무 → 마지막으로 적은 한국 날짜
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

export function prrNoteUse(db: DatabaseService, accountId: string | null | undefined, method: string, url: string): void {
  if (!accountId) return;
  void (async () => {
    const need = await routeNeeds(db, String(method ?? '').toUpperCase(), String(url ?? ''));
    if (!need.length) return;
    const day = kstDay();
    const tasks = [...new Set(need.map((n) => n.task))].filter((t) => seen.get(`${accountId}|${t}`) !== day);
    if (!tasks.length) return;
    if (seen.size > 20000) seen.clear();
    for (const t of tasks) seen.set(`${accountId}|${t}`, day);
    await db.query(
      `INSERT INTO prr_task_use (account_id, task_key, last_on)
       SELECT $1::uuid, t.k, $2::date FROM unnest($3::text[]) AS t(k)
        WHERE EXISTS (SELECT 1 FROM perm_tasks p WHERE p.key = t.k)
       ON CONFLICT (account_id, task_key) DO UPDATE SET last_on = EXCLUDED.last_on WHERE prr_task_use.last_on < EXCLUDED.last_on`,
      [accountId, day, tasks]);
  })().catch(() => undefined);
}
