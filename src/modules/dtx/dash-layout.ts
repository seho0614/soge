import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.536 (D282 · docs/674) 운영 대시보드 위젯 배치 — 대표 11/20 「(52) ②」
 *   운영자 계정마다 첫 화면(대시보드) 카드의 차례 · 숨김을 서버에 저장(staff_dash_layouts) — 다른 기기에서 열어도 같음
 *   ★ 저장한 줄이 없으면 기본 배치(화면 코드의 차례) 그대로 · 「기본으로」는 줄을 지움
 *   카드 열쇠는 이 목록(DASH_WIDGETS)만 — 화면(web/src/app/admin/DashWidgets.tsx)의 목록과 같아야 함(시험 test_v1536 이 대조)
 *   저장한 차례에 없는 카드(나중에 더한 카드)는 화면이 기본 차례대로 끝에 붙임 · 숨김은 저장한 것만
 *   자기 계정 것만 읽고 씀 — 다른 운영자의 배치는 보지 않음 · 감사 기록 없음(화면 꾸미기 · 업무 기록 아님)
 * ------------------------------------------------------------------- */

/** DB CHECK(staff_dash_layouts — 쉼표로 이은 글자에 같은 모양)와 같은 정규식(규칙 2) */
export const DASH_KEY_RE = /^[a-z][a-z0-9-]{1,23}$/;
export const DASH_WIDGETS: Array<[string, string]> = [
  ['todo', '오늘 할 일'], ['notices', '관리자 공지'], ['launch', '공개 직후 지켜보기'], ['state', '운영 상태 한눈에'],
  ['owner', '대표 할 일'], ['release', '지금 판 · 적용 기록'], ['apply', '운영 적용 확인표'], ['acct', '이번 달 매출 · 이익(SUPER)'],
  ['server', '서버 자원 추세'], ['tiles', '처리 대기 숫자'], ['cap', '검수 처리 여력'], ['alerts', '확인이 필요한 것'],
  ['cs', '고객센터 한눈에'], ['runway', '활주로'], ['more', '다른 운영 화면'],
];
export const DASH_KEYS = DASH_WIDGETS.map(([k]) => k);

const uuidOk = (s?: string | null) => !!s && /^[0-9a-fA-F-]{36}$/.test(s);

export interface DashLayout { saved: boolean; order: string[]; hidden: string[]; updatedAt: string | null; widgets: Array<{ key: string; label: string }>; note: string }

/** GET /admin/dash-layout — 내 배치(없으면 기본) */
export async function myDashLayout(db: DatabaseService, me: string | null): Promise<DashLayout> {
  const widgets = DASH_WIDGETS.map(([key, label]) => ({ key, label }));
  if (!uuidOk(me)) return { saved: false, order: DASH_KEYS, hidden: [], updatedAt: null, widgets, note: '기본 배치입니다.' };
  const [r] = await db.query<{ order: string[]; hidden: string[]; updatedAt: string }>(
    `SELECT widget_order AS "order", widget_hidden AS hidden, updated_at AS "updatedAt" FROM staff_dash_layouts WHERE account_id = $1::uuid`, [me]);
  if (!r) return { saved: false, order: DASH_KEYS, hidden: [], updatedAt: null, widgets, note: '기본 배치입니다 — 「첫 화면 꾸미기」로 차례 · 숨김을 바꾸면 이 계정에 저장됩니다.' };
  /* 목록에서 빠진 열쇠는 버리고 · 저장한 차례에 없는 카드는 기본 차례대로 끝에 */
  const order = (r.order ?? []).filter((k) => DASH_KEYS.includes(k));
  for (const k of DASH_KEYS) if (!order.includes(k)) order.push(k);
  const hidden = (r.hidden ?? []).filter((k) => DASH_KEYS.includes(k));
  return { saved: true, order, hidden, updatedAt: r.updatedAt, widgets, note: '이 계정에 저장한 배치입니다.' };
}

function keysOf(raw: unknown, what: 'ORDER' | 'HIDDEN'): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new PolicyViolation('DASH_KEY', what === 'ORDER' ? '차례는 카드 열쇠 목록입니다.' : '숨김은 카드 열쇠 목록입니다.');
  const xs = raw.map((x) => String(x ?? '').trim());
  const bad = xs.filter((x) => !DASH_KEY_RE.test(x) || !DASH_KEYS.includes(x));
  if (bad.length) throw new PolicyViolation('DASH_KEY', `모르는 카드입니다: ${bad.slice(0, 3).join(', ')}`);
  if (new Set(xs).size !== xs.length) throw new PolicyViolation('DASH_KEY', what === 'ORDER' ? '차례에 같은 카드가 두 번 있습니다.' : '숨김에 같은 카드가 두 번 있습니다.');
  return xs;
}

/** PUT /admin/dash-layout — 차례 · 숨김 저장(보낸 칸만 · 안 보낸 칸은 저장한 값 그대로 · 처음이면 기본) */
export async function saveDashLayout(db: DatabaseService, me: string | null, b: { order?: string[]; hidden?: string[] }) {
  if (!uuidOk(me)) throw new PolicyViolation('DASH_ACTOR', '운영 계정으로 로그인해야 저장합니다.');
  if (b.order === undefined && b.hidden === undefined) throw new PolicyViolation('DASH_NOTHING', '바꿀 것이 없습니다.');
  const cur = await myDashLayout(db, me);
  const order = b.order !== undefined ? keysOf(b.order, 'ORDER') : cur.order;
  const hidden = b.hidden !== undefined ? keysOf(b.hidden, 'HIDDEN') : cur.hidden;
  if (hidden.length >= DASH_KEYS.length) throw new PolicyViolation('DASH_ALL_HIDDEN', '카드를 모두 숨길 수는 없습니다 — 하나 이상 남기십시오.');
  await db.query(
    `INSERT INTO staff_dash_layouts (account_id, widget_order, widget_hidden) VALUES ($1::uuid, $2::text[], $3::text[])
     ON CONFLICT (account_id) DO UPDATE SET widget_order = EXCLUDED.widget_order, widget_hidden = EXCLUDED.widget_hidden`, [me, order, hidden]);
  const out = await myDashLayout(db, me);
  return { ok: true, ...out, note: `첫 화면 배치를 저장했습니다 — 카드 ${DASH_KEYS.length - out.hidden.length}개 보임 · ${out.hidden.length}개 숨김.` };
}

/** DELETE /admin/dash-layout — 기본으로(내 줄 지움) */
export async function resetDashLayout(db: DatabaseService, me: string | null) {
  if (!uuidOk(me)) throw new PolicyViolation('DASH_ACTOR', '운영 계정으로 로그인해야 합니다.');
  const r = await db.query(`DELETE FROM staff_dash_layouts WHERE account_id = $1::uuid RETURNING 1`, [me]);
  const out = await myDashLayout(db, me);
  return { ok: true, removed: r.length > 0, ...out, note: '기본 배치로 되돌렸습니다.' };
}
