import { DatabaseService } from '../../db/database.service';
import { maskEmail } from '../../common/mask';
import { NotFound, PolicyViolation } from '../../core/errors';

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

/* v10.625 (D306 · docs/768) 켜기 도우미 — 켤 조건 글에서 선행 조건 종류를 낱말로 고름(확인 기록은 opx_switch_prereq_checks)
 *   LEGAL 법무 · PRIVACY 처리방침 · KEY 연동 키 · 업체 키 · CONTRACT 계약 · NOTICE 회원 · 직원 안내 · 공지 · 교육
 *   「처리방침 변경 없음」처럼 「없음」이 붙은 말은 고르지 않음 */
export const PREREQ_KO: Record<string, string> = { LEGAL: '법무 확인', PRIVACY: '처리방침 게시', KEY: '연동 키 · 업체', CONTRACT: '계약', NOTICE: '회원 · 직원 안내' };
const PREREQ_WORDS: Array<[string, RegExp]> = [
  ['LEGAL', /법무/], ['PRIVACY', /처리방침/], ['KEY', /(연동 키|키 |_KEY|API 키|업체 키|키\(|키 ·)/], ['CONTRACT', /계약/], ['NOTICE', /(안내|공지|고지|교육|직원에게|알린 뒤|알린 후|설명서)/],
];
export function prereqOf(cond: string | null | undefined): string[] {
  const c = String(cond ?? '').replace(/[가-힣A-Za-z0-9 ]{0,12}(변경|필요) ?없음/g, ' ');
  return PREREQ_WORDS.filter(([, re]) => re.test(c)).map(([k]) => k);
}

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
  const pc = keys.length ? await db.query<{ key: string; prereq: string; state: string; note: string; at: string; who: string | null }>(
    `SELECT DISTINCT ON (c.key, c.prereq) c.key, c.prereq, c.state, c.note, c.checked_at AS at, a.email::text AS who
       FROM opx_switch_prereq_checks c LEFT JOIN accounts a ON a.id = c.checked_by
      WHERE c.key = ANY($1::text[]) ORDER BY c.key, c.prereq, c.id DESC`, [keys]).catch(() => []) : [];   // v10.625 D306 전 판이면 빈 목록
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
      ...(() => {   /* v10.625 켜기 도우미 — 선행 조건 · 확인 · 켤 준비 */
        const prereq = prereqOf(d?.cond);
        const checks = prereq.map((p) => { const c = pc.find((x) => x.key === r.key && x.prereq === p);
          return { prereq: p, label: PREREQ_KO[p] ?? p, done: c?.state === 'DONE', note: c?.note ?? null, at: c?.at ?? null, by: maskEmail(c?.who ?? null) }; });
        const st = LIVE_WORDS.has(value) ? 'ON' : 'OFF';
        return { prereq, checks, ready: st === 'OFF' && !!d?.cond && checks.every((c) => c.done) };   // 켤 조건 글이 없으면 준비로 보지 않음
      })(),
    };
  });
  return {
    items,
    counts: { all: items.length, on: items.filter((i) => i.state === 'ON').length, assume: items.filter((i) => i.state === 'ASSUME').length,
              changed: items.filter((i) => i.changed).length, noCond: items.filter((i) => !i.cond).length, docOnly: Number(nd?.n ?? 0),
              ready: items.filter((i) => i.ready && i.state === 'OFF').length, waiting: items.filter((i) => i.state === 'OFF' && !i.ready).length },
    note: '읽기만 합니다 — 값을 바꾸려면 정책 › 「전체 설정」(바뀐 기록 · 사유가 남음). 처음 값은 켤 조건 표 → 가장 오래된 바뀐 기록의 「전」 → 지금 값 순서로 봅니다.',
  };
}

/** POST /admin/opx/switches/{key}/prereq — v10.625 (D306) 선행 조건 「확인함」 · 「확인 취소」 적기(SUPER) · 켜기는 「전체 설정」 그대로 */
export async function savePrereq(db: DatabaseService, key: string, prereq: string, state: 'DONE' | 'UNDO', note: string, actor: string | null) {
  const why = String(note ?? '').replace(/\s+/g, ' ').trim();
  if (why.length < 2 || why.length > 300) throw new PolicyViolation('OPX_PREREQ_NOTE', '확인 내용(어디서 · 언제 · 누가)은 2 ~ 300자입니다.');
  const [s] = await db.query<{ pattern: string | null }>(`SELECT value_pattern AS pattern FROM site_settings WHERE key = $1`, [key]);
  if (!s || !isSwitchPattern(s.pattern)) throw new NotFound('스위치가 아닙니다.');
  const [d] = await db.query<{ cond: string | null }>(`SELECT cond FROM opx_switch_docs WHERE key = $1`, [key]);
  if (!prereqOf(d?.cond).includes(prereq)) throw new PolicyViolation('OPX_PREREQ_NOT_NEEDED', '이 스위치의 켤 조건에는 이 선행 조건이 없습니다.');
  const [r] = await db.query<{ id: string; at: string }>(
    `INSERT INTO opx_switch_prereq_checks (key, prereq, state, note, checked_by) VALUES ($1, $2, $3, $4, $5::uuid) RETURNING id, checked_at AS at`,
    [key, prereq, state, why, actor]);
  return { ok: true, id: r?.id, at: r?.at, key, prereq, state };
}
