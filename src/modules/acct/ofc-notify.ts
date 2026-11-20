import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { inbox } from './approval';   // v10.424 (D253) 내 결재함 — 같은 셈(중간 단계 · 마지막 SUPER 단계)
import type { Viewer } from './ofc-calendar';

/* ---------------------------------------------------------------------
 * v10.465 (D263 · docs/603) 브라우저 알림 — 대표 11/20 「㉜ 사무 2」
 *   운영 화면을 열어 둔 동안만: 화면(web BrowserNotify)이 ofc.notify_poll_sec(처음 60초)마다 GET /admin/me/notify/feed 를 묻고
 *   새 열쇠(key)만 브라우저 Notification API 로 띄움 — 서버 푸시 · 서비스 워커 · VAPID 키 없음(외부 연동 아님)
 *   켜고 끔은 계정마다 서버에(ofc_notify_prefs · 처음 꺼짐) — 브라우저 「허락」은 그 브라우저마다 따로(사용자가 「켜기」를 누를 때만 묻기)
 *   종류: OPS 급한 운영 알림(CRITICAL · 확인 안 함 · 풀리지 않음 · ADMIN · SUPER 만) · APV 나에게 온 결재(결재함과 같은 셈)
 *         TASK 나에게 온 업무 요청 · 내 업무 기한 내일까지 · 지남 · 내가 요청한 업무 끝남 · 내 업무 새 댓글
 *   ofc.browser_notify off 면 모든 계정 꺼짐(feed 가 on:false). 알림 글에는 금액 · 개인정보를 넣지 않음(제목 · 이름까지).
 * ------------------------------------------------------------------- */

export const NOTIFY_KINDS = ['OPS', 'APV', 'TASK'] as const;
export const NOTIFY_KIND_KO: Record<string, string> = { OPS: '급한 운영 알림(ADMIN · SUPER)', APV: '나에게 온 결재', TASK: '업무 요청 · 기한 · 끝남 · 댓글' };
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);

async function globals(db: DatabaseService) {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key IN ('ofc.browser_notify', 'ofc.notify_poll_sec')`);
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const sec = Number(v('ofc.notify_poll_sec') ?? 60);
  return { on: (v('ofc.browser_notify') ?? 'on') === 'on', pollSec: Number.isFinite(sec) ? Math.min(300, Math.max(30, Math.round(sec))) : 60 };
}

async function prefsOf(db: DatabaseService, id: string) {
  const [p] = await db.query<{ enabled: boolean; kinds: string[] }>(`SELECT enabled, kinds FROM ofc_notify_prefs WHERE account_id = $1::uuid`, [id]);
  return { enabled: p?.enabled === true, kinds: p ? p.kinds.filter((k) => (NOTIFY_KINDS as readonly string[]).includes(k)) : [...NOTIFY_KINDS] };
}

/** GET /admin/me/notify — 내 설정 · 전체 스위치 · 묻는 간격 */
export async function myNotify(db: DatabaseService, v: Viewer) {
  const g = await globals(db);
  const p = await prefsOf(db, v.id);
  const opsOk = v.roles.includes('SUPER') || v.roles.includes('ADMIN');
  return { global: g.on, pollSec: g.pollSec, enabled: p.enabled, kinds: p.kinds, kindsKo: NOTIFY_KIND_KO, opsAllowed: opsOk,
           note: '운영 화면을 열어 둔 동안만 브라우저 알림을 띄웁니다(창을 닫으면 오지 않음 · 서버 푸시 아님). 켜기를 누르면 브라우저가 한 번 허락을 묻습니다 — 브라우저마다 따로 허락합니다.' };
}

/** PUT /admin/me/notify — 켬 · 끔 · 종류(본인만) */
export async function setMyNotify(db: DatabaseService, v: Viewer, b: { enabled?: boolean; kinds?: string[] }) {
  const g = await globals(db);
  const cur = await prefsOf(db, v.id);
  const enabled = b.enabled === undefined ? cur.enabled : b.enabled === true;
  if (enabled && !g.on) throw new PolicyViolation('OFC_NOTIFY_OFF', '브라우저 알림이 전체 꺼져 있습니다(정책 › 전체 설정 ofc.browser_notify).');
  const kinds = Array.isArray(b.kinds) ? [...new Set(b.kinds.map(String))] : cur.kinds;
  if (kinds.some((k) => !(NOTIFY_KINDS as readonly string[]).includes(k))) throw new PolicyViolation('OFC_NOTIFY_KIND', '알림 종류는 OPS · APV · TASK 입니다.');
  if (enabled && !kinds.length) throw new PolicyViolation('OFC_NOTIFY_KIND', '켜려면 알림 종류를 하나 이상 고르십시오.');
  await db.query(
    `INSERT INTO ofc_notify_prefs (account_id, enabled, kinds, updated_at) VALUES ($1::uuid, $2::boolean, $3::text[], now())
     ON CONFLICT (account_id) DO UPDATE SET enabled = EXCLUDED.enabled, kinds = EXCLUDED.kinds, updated_at = now()`, [v.id, enabled, kinds]);
  return { ok: true, enabled, kinds, note: enabled ? '브라우저 알림을 켰습니다 — 이 화면을 열어 둔 동안 새 알림을 띄웁니다.' : '브라우저 알림을 껐습니다.' };
}

export interface FeedItem { key: string; kind: 'OPS' | 'APV' | 'TASK'; title: string; at: string; tab: string; severity?: string }

/** GET /admin/me/notify/feed?since= — 지금 띄울 만한 것(화면이 key 로 이미 띄운 것을 거름) */
export async function notifyFeed(db: DatabaseService, v: Viewer, sinceIn?: string) {
  const g = await globals(db);
  const p = await prefsOf(db, v.id);
  const now = new Date();
  if (!g.on || !p.enabled) return { on: false, global: g.on, pollSec: g.pollSec, now: now.toISOString(), items: [] as FeedItem[], count: 0 };
  const t = sinceIn ? Date.parse(sinceIn) : NaN;
  const floor = now.getTime() - 7 * 86400e3;
  const since = new Date(Number.isFinite(t) ? Math.max(t, floor) : now.getTime() - 86400e3).toISOString();
  const items: FeedItem[] = [];

  if (p.kinds.includes('OPS') && (v.roles.includes('SUPER') || v.roles.includes('ADMIN'))) {
    const rows = await db.query<{ id: string; title: string; severity: string; at: string }>(
      `SELECT id::text AS id, title, severity, raised_at AS at FROM ops_alerts
        WHERE severity = 'CRITICAL' AND acknowledged_at IS NULL AND resolved_at IS NULL AND raised_at >= $1::timestamptz
        ORDER BY raised_at DESC LIMIT 20`, [since]);
    for (const r of rows) items.push({ key: `ops:${r.id}`, kind: 'OPS', title: `급한 운영 알림 — ${r.title}`.slice(0, 160), at: new Date(r.at).toISOString(), tab: 'ops-alerts', severity: r.severity });
  }

  if (p.kinds.includes('APV')) {
    const box = await inbox(db, v.id, v.roles).catch(() => ({ items: [] as Array<Record<string, unknown>> }));
    for (const d of box.items.slice(0, 20)) {
      items.push({ key: `apv:${d.kind}:${d.id}:${d.step}`, kind: 'APV', title: `결재 차례 — ${d.kindKo ?? d.kind} 「${String(d.title ?? '').slice(0, 60)}」 (${d.step}/${d.of})`,
                   at: new Date(String(d.created_at ?? now.toISOString())).toISOString(), tab: 'approvals' });
    }
  }

  if (p.kinds.includes('TASK')) {
    const today = kstToday();
    const mine = await db.query<{ id: string; title: string; due: string | null; state: string; requester: string; who: string | null; at: string }>(
      `SELECT k.id::text AS id, k.title, k.due_on::text AS due, k.state, k.requester::text AS requester, coalesce(a.name, a.email) AS who, k.updated_at AS at
         FROM ofc_tasks k LEFT JOIN accounts a ON a.id = k.requester
        WHERE k.assignee = $1::uuid AND k.state IN ('REQUESTED', 'DOING')
        ORDER BY k.id DESC LIMIT 50`, [v.id]);
    for (const k of mine) {
      if (k.state === 'REQUESTED' && k.requester !== v.id) {   // 나에게 맡긴 할 일(내가 요청)은 알리지 않음
        items.push({ key: `task:${k.id}:${v.id}`, kind: 'TASK', title: `업무 요청 — 「${k.title.slice(0, 60)}」 (${k.who})`, at: new Date(k.at).toISOString(), tab: 'ofc-tasks' });
      }
      if (k.due && k.due < today) items.push({ key: `task-over:${k.id}:${k.due}`, kind: 'TASK', title: `업무 기한 지남 — 「${k.title.slice(0, 60)}」 (${k.due})`, at: now.toISOString(), tab: 'ofc-tasks' });
      else if (k.due && k.due <= addDays(today, 1)) items.push({ key: `task-due:${k.id}:${k.due}`, kind: 'TASK', title: `업무 기한 ${k.due === today ? '오늘' : '내일'} — 「${k.title.slice(0, 60)}」`, at: now.toISOString(), tab: 'ofc-tasks' });
    }
    const done = await db.query<{ id: string; title: string; who: string | null; at: string }>(
      `SELECT k.id::text AS id, k.title, coalesce(a.name, a.email) AS who, k.done_at AS at
         FROM ofc_tasks k LEFT JOIN accounts a ON a.id = k.assignee
        WHERE k.requester = $1::uuid AND k.assignee <> $1::uuid AND k.state = 'DONE' AND k.done_at >= $2::timestamptz
        ORDER BY k.done_at DESC LIMIT 20`, [v.id, since]);
    for (const k of done) items.push({ key: `task-done:${k.id}:${Date.parse(k.at)}`, kind: 'TASK', title: `업무 끝남 — 「${k.title.slice(0, 60)}」 (${k.who ?? ''})`, at: new Date(k.at).toISOString(), tab: 'ofc-tasks' });
    const cmts = await db.query<{ id: string; title: string; who: string | null; at: string }>(
      `SELECT c.id::text AS id, k.title, coalesce(a.name, a.email) AS who, c.created_at AS at
         FROM ofc_task_comments c JOIN ofc_tasks k ON k.id = c.task_id LEFT JOIN accounts a ON a.id = c.author
        WHERE c.kind = 'COMMENT' AND c.author <> $1::uuid AND (k.requester = $1::uuid OR k.assignee = $1::uuid) AND c.created_at >= $2::timestamptz
        ORDER BY c.id DESC LIMIT 10`, [v.id, since]);
    for (const c of cmts) items.push({ key: `task-cmt:${c.id}`, kind: 'TASK', title: `업무 댓글 — 「${c.title.slice(0, 60)}」 (${c.who ?? ''})`, at: new Date(c.at).toISOString(), tab: 'ofc-tasks' });
  }

  return { on: true, global: g.on, pollSec: g.pollSec, now: now.toISOString(), since, kinds: p.kinds, items: items.slice(0, 60), count: items.length };
}
