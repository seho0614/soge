import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { maskName } from '../../common/mask';

/* ---------------------------------------------------------------------
 * v10.548 (D285 · docs/686) 번역 메모리 — 대표 11/20 「(55) ③」
 *   열쇠 = (언어, fn_sfx_tm_key(원문) = md5(앞뒤 공백 뗀 · 공백 한 칸 원문))
 *   채우기는 DB 트리거 trg_sfx_tm_feed(번역이 승인 · 자동 승인될 때 · 사람 것이 먼저 · 소개광장 글 · 댓글 빼고)
 *   쓰기는 자동 번역 배치 translate.service 의 엔진 부르기 바로 앞(sfxTmApply) — 같은 원문이면 엔진 TM · 자동 승인으로 저장하고 엔진을 부르지 않음
 *     금칙어 · 원문에 없는 연락처 검사(translate.service 의 suspiciousTranslation 을 인자로 받음 — 서로 import 하지 않게)
 *   처음 꺼짐(sfx.tm) — 꺼져 있으면 채우지도 쓰지도 않음 · 운영 화면에서 찾기 · 고치기(고치면 HUMAN) · 끄기
 * ------------------------------------------------------------------- */

export const TM_ORIGINS = ['HUMAN', 'MACHINE'] as const;
/** DB CHECK sfx_tm.tr_text 1 ~ 40000 과 같음(규칙 2) */
export const TM_TEXT_MAX = 40000;

const n = (v: unknown) => Number(v ?? 0);
const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const x = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
};
const likeEsc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

async function tmSettings(db: DatabaseService) {
  const [s] = await db.query<Record<string, string | null>>(
    `SELECT (SELECT value FROM site_settings WHERE key = 'sfx.tm') AS sw, (SELECT value FROM site_settings WHERE key = 'sfx.tm_keep_days') AS keep`);
  return { on: s?.sw === 'on', keepDays: clampInt(s?.keep, 90, 999, 365) };
}

/**
 * 자동 번역 배치(translate.service one) — 엔진을 부르기 전에 같은 원문 번역을 찾아 그대로 저장 · 쓴 칸은 src 에서 뺌
 *   꺼져 있음 · 메모리에 없음 · 끈 줄 · 금칙어 · 연락처 의심이면 그 칸은 그대로 엔진으로 · 실패해도 엔진으로(번역을 막지 않음)
 */
export async function sfxTmApply(
  db: DatabaseService,
  t: { type: string; id: string; lang: string; gwan: string | null },
  src: Record<string, string>,
  suspicious: (src: string, tr: string) => boolean,
): Promise<{ used: number }> {
  const fields = Object.keys(src);
  if (!fields.length) return { used: 0 };
  let used = 0;
  try {
    if (!(await tmSettings(db)).on) return { used: 0 };
    for (const f of fields) {
      try {
        const [m] = await db.query<{ id: string; tr: string }>(
          `SELECT id::text AS id, tr_text AS tr FROM sfx_tm WHERE lang = $1::text AND src_key = fn_sfx_tm_key($2::text) AND is_active`, [t.lang, src[f]]);
        if (!m) continue;
        const b = await db.query(`SELECT 1 FROM fn_check_banned_words($1, $2) WHERE severity = 'BLOCK' LIMIT 1`, [m.tr, t.gwan]);
        if (b.length || suspicious(src[f], m.tr)) continue;
        await db.query(
          `INSERT INTO content_translations (target_type, target_id, field, lang, text, source_hash, status, engine, approved_at)
           VALUES ($1, $2, $3, $4, $5, md5($6), 'AUTO_APPROVED', 'TM', now())
           ON CONFLICT (target_type, target_id, field, lang) DO UPDATE
             SET text = EXCLUDED.text, source_hash = EXCLUDED.source_hash, status = EXCLUDED.status, engine = EXCLUDED.engine,
                 translated_by = NULL, translated_at = now(), approved_by = NULL, approved_at = EXCLUDED.approved_at, reject_reason = NULL
             WHERE content_translations.source_hash <> EXCLUDED.source_hash
                OR (content_translations.engine <> 'MANUAL' AND content_translations.status <> 'REJECTED')`,
          [t.type, t.id, f, t.lang, m.tr, src[f]]);
        await db.query(`UPDATE sfx_tm SET hits = hits + 1, last_used_at = clock_timestamp() WHERE id = $1::bigint`, [m.id]);
        delete src[f];
        used++;
      } catch { /* 이 칸은 엔진으로 */ }
    }
  } catch { /* 설정을 못 읽으면 모두 엔진으로 */ }
  return { used };
}

/** GET /admin/sfx/tm?q=&lang=&origin=&active=&page= — 찾기(원문 · 번역 글자) · 50줄씩 */
export async function tmList(db: DatabaseService, q: { q?: string; lang?: string; origin?: string; active?: string; page?: string }) {
  const s = await tmSettings(db);
  const kw = String(q.q ?? '').trim().slice(0, 100);
  const lang = /^[a-z]{2}$/.test(String(q.lang ?? '')) ? String(q.lang) : null;
  const origin = (TM_ORIGINS as readonly string[]).includes(String(q.origin)) ? String(q.origin) : null;
  const active = q.active === '1' ? true : q.active === '0' ? false : null;
  const page = clampInt(q.page, 1, 1000, 1);
  const [t] = await db.query<Record<string, number>>(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE origin = 'HUMAN')::int AS human, count(*) FILTER (WHERE origin = 'MACHINE')::int AS machine,
            count(*) FILTER (WHERE NOT is_active)::int AS off, coalesce(sum(hits), 0)::bigint AS hits,
            count(*) FILTER (WHERE last_used_at > now() - interval '30 days')::int AS used30
       FROM sfx_tm`);
  const rows = await db.query<Record<string, unknown>>(
    `SELECT m.id::text AS id, m.lang, m.origin, m.from_type AS "fromType", m.is_active AS active, m.hits, m.last_used_at AS "lastUsedAt", m.updated_at AS "updatedAt",
            left(m.src_text, 300) AS src, left(m.tr_text, 300) AS tr, char_length(m.src_text) AS "srcLen", char_length(m.tr_text) AS "trLen", a.name AS editor
       FROM sfx_tm m LEFT JOIN accounts a ON a.id = m.edited_by
      WHERE ($1::text = '' OR m.src_text ILIKE '%' || $1::text || '%' OR m.tr_text ILIKE '%' || $1::text || '%')
        AND ($2::text IS NULL OR m.lang = $2::text)
        AND ($3::text IS NULL OR m.origin = $3::text)
        AND ($4::boolean IS NULL OR m.is_active = $4::boolean)
      ORDER BY m.updated_at DESC, m.id DESC
      LIMIT 50 OFFSET $5::int`, [likeEsc(kw), lang, origin, active, (page - 1) * 50]);
  return {
    ...s, total: n(t?.total), human: n(t?.human), machine: n(t?.machine), off: n(t?.off), hits: n(t?.hits), used30: n(t?.used30), page,
    rows: rows.map((r) => ({ ...r, hits: n(r.hits), editor: maskName(r.editor as string | null) })),
    note: s.on
      ? '승인 · 자동 승인된 번역을 원문 열쇠로 모읍니다. 자동 번역은 같은 원문이면 엔진을 부르지 않고 이 번역을 씁니다(사람이 고친 것 먼저).'
      : '꺼져 있습니다(sfx.tm) — 켜면 앞으로 승인되는 번역부터 모이고, 「지금 번역으로 채우기」로 있는 번역을 넣을 수 있습니다.',
  };
}

/** PUT /admin/sfx/tm/{id} — 번역 고치기(사람 · HUMAN) · 끄기 · 켜기 · 금칙어면 422 · 앞으로 쓰는 번역만 바뀜(이미 저장된 번역은 그대로) */
export async function tmEdit(db: DatabaseService, id: string, v: { text?: string; active?: boolean }, actor: string | null) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('번역 메모리 줄을 찾을 수 없습니다.');
  const text = v.text === undefined ? undefined : String(v.text).trim();
  if (text === undefined && v.active === undefined) throw new PolicyViolation('SFX_TM_NOTHING', '바꿀 칸(번역 · 켜기)을 보내 주십시오.');
  if (text !== undefined && (text.length < 1 || text.length > TM_TEXT_MAX)) throw new PolicyViolation('SFX_TM_TEXT', `번역은 1 ~ ${TM_TEXT_MAX}자입니다.`);
  if (text !== undefined) {
    const b = await db.query<{ word: string }>(`SELECT word FROM fn_check_banned_words($1::text, NULL::text) WHERE severity = 'BLOCK'`, [text]);
    if (b.length) throw new PolicyViolation('SFX_TM_BANNED', `번역에 금칙어가 있습니다: ${b.map((x) => x.word).join(', ')}`);
  }
  const [u] = await db.query<Record<string, unknown>>(
    `UPDATE sfx_tm
        SET tr_text = coalesce($2::text, tr_text),
            origin = CASE WHEN $2::text IS NULL THEN origin ELSE 'HUMAN' END,
            is_active = coalesce($3::boolean, is_active),
            edited_by = $4::uuid, updated_at = clock_timestamp()
      WHERE id = $1::bigint
      RETURNING id::text AS id, lang, origin, is_active AS active, left(tr_text, 300) AS tr`,
    [id, text ?? null, v.active ?? null, actor]);
  if (!u) throw new NotFound('번역 메모리 줄을 찾을 수 없습니다.');
  return { ok: true, ...u, note: '고쳤습니다 — 앞으로 자동 번역이 이 번역을 씁니다(이미 저장된 번역은 그대로).' };
}

/** POST /admin/sfx/tm/backfill — 지금 있는 승인 번역으로 채우기(한 번에 2000줄 · 최근 것부터) · 꺼져 있으면 422 */
export async function tmBackfill(db: DatabaseService) {
  if (!(await tmSettings(db)).on) throw new PolicyViolation('SFX_TM_OFF', '번역 메모리가 꺼져 있습니다(sfx.tm) — 켠 뒤 채우십시오.');
  const [r] = await db.query<{ n: number }>(`SELECT fn_sfx_tm_backfill(2000) AS n`);
  return { ok: true, added: n(r?.n), note: `지금 번역으로 채웠습니다 — ${n(r?.n)}줄.` };
}

/** 정기 작업 sfx_daily — 보관 일수 동안 쓰이지 않은 줄 지움(꺼져 있어도 지움 — 줄이기만) */
export async function tmPurge(db: DatabaseService): Promise<number> {
  const s = await tmSettings(db);
  const r = await db.query(`DELETE FROM sfx_tm WHERE coalesce(last_used_at, updated_at) < now() - make_interval(days => $1::int) RETURNING 1`, [s.keepDays]);
  return r.length;
}
