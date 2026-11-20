import { DatabaseService } from '../../db/database.service';
import { maskEmail } from '../../common/mask';

/* ---------------------------------------------------------------------
 * v10.512 (D275 · docs/650) 기능 스위치 한눈에 — 대표 11/20 「㊺ ④」 · 읽기만
 *
 *   스위치 = site_settings 중 값 무늬(value_pattern)가 「^(갑|을)$」 · 「^(갑|을|병)$」 모양이고 고를 값이 모두
 *            on · off · true · false · ASSUME · LIVE · SHADOW · ON · OFF 안에 있는 설정
 *   줄마다: 지금 값 · 처음 값(opx_switch_docs → 없으면 가장 오래된 바뀐 기록의 「전」 → 없으면 지금 값) · 처음과 다름 · 켤 조건 · 문서 · 마지막 바꾼 사람 · 때 · 까닭
 *   고치기는 「전체 설정」(정책 › 전체 설정 · 바뀐 기록이 남음) — 여기서는 그 화면으로 가는 길만
 * ------------------------------------------------------------------- */

const SWITCH_WORDS = new Set(['on', 'off', 'true', 'false', 'ASSUME', 'LIVE', 'SHADOW', 'ON', 'OFF']);
export function isSwitchPattern(p: string | null | undefined): boolean {
  const m = /^\^\(([A-Za-z|]+)\)\$$/.exec(String(p ?? ''));
  if (!m) return false;
  const alts = m[1]!.split('|');
  return alts.length >= 2 && alts.length <= 3 && alts.every((a) => SWITCH_WORDS.has(a));
}
/** 「켜짐」으로 볼 값(간주 ASSUME 은 「간주」로 따로) */
const LIVE_WORDS = new Set(['on', 'true', 'LIVE', 'ON']);

export async function switchOverview(db: DatabaseService) {
  const all = await db.query<{ key: string; value: string | null; pattern: string | null; description: string | null; scope: string; updatedAt: string | null }>(
    `SELECT key, value, value_pattern AS pattern, description, scope, updated_at AS "updatedAt" FROM site_settings WHERE value_pattern IS NOT NULL ORDER BY key`);
  const sw = all.filter((r) => isSwitchPattern(r.pattern));
  const keys = sw.map((r) => r.key);
  const docs = keys.length ? await db.query<{ key: string; initial: string; cond: string; docRef: string | null; who: string }>(
    `SELECT key, initial_value AS initial, cond, doc_ref AS "docRef", who FROM opx_switch_docs WHERE key = ANY($1::text[])`, [keys]) : [];
  const first = keys.length ? await db.query<{ key: string; before: string | null }>(
    `SELECT DISTINCT ON (key) key, before_val AS before FROM site_setting_changes WHERE key = ANY($1::text[]) ORDER BY key, at, id`, [keys]) : [];
  const last = keys.length ? await db.query<{ key: string; at: string; reason: string | null; via: string; who: string | null }>(
    `SELECT DISTINCT ON (c.key) c.key, c.at, c.reason, c.via, a.email::text AS who FROM site_setting_changes c LEFT JOIN accounts a ON a.id = c.changed_by
      WHERE c.key = ANY($1::text[]) ORDER BY c.key, c.at DESC, c.id DESC`, [keys]) : [];
  const [nd] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM opx_switch_docs d WHERE NOT EXISTS (SELECT 1 FROM site_settings s WHERE s.key = d.key)`);
  const items = sw.map((r) => {
    const d = docs.find((x) => x.key === r.key);
    const f = first.find((x) => x.key === r.key);
    const l = last.find((x) => x.key === r.key);
    const initial = d?.initial ?? (f ? f.before : r.value);
    const value = r.value ?? '';
    return {
      key: r.key, group: r.key.split('.')[0], value, initial, changed: (initial ?? '') !== value,
      state: LIVE_WORDS.has(value) ? 'ON' : value === 'ASSUME' ? 'ASSUME' : value === 'SHADOW' ? 'SHADOW' : 'OFF',
      choices: /^\^\(([A-Za-z|]+)\)\$$/.exec(r.pattern ?? '')?.[1]?.split('|') ?? [],
      cond: d?.cond ?? null, docRef: d?.docRef ?? null, who: d?.who ?? null, description: r.description,
      lastAt: l?.at ?? null, lastBy: l?.via === 'DB' ? 'DB(서버 스크립트)' : maskEmail(l?.who ?? null), lastReason: l?.reason ?? null,
    };
  });
  return {
    items,
    counts: { all: items.length, on: items.filter((i) => i.state === 'ON').length, assume: items.filter((i) => i.state === 'ASSUME').length,
              changed: items.filter((i) => i.changed).length, noCond: items.filter((i) => !i.cond).length, docOnly: Number(nd?.n ?? 0) },
    note: '읽기만 합니다 — 값을 바꾸려면 정책 › 「전체 설정」(바뀐 기록 · 사유가 남음). 처음 값은 켤 조건 표 → 가장 오래된 바뀐 기록의 「전」 → 지금 값 순서로 봅니다.',
  };
}
