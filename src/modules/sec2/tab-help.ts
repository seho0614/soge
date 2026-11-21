/* ---------------------------------------------------------------------
 * v10.594 (docs/736) ⑩ 운영 화면 「?」 도움말 — 사용자 설명서 표(help_docs · D180)를 그대로 씀
 *
 *   설명서 종류 둘: ADMIN_GUIDE(운영 화면 도움말 · 이번에 1판 · 운영자만) · USER_MANUAL(회원 설명서 · AI 상담이 읽음 — 이것은 고치지 않음).
 *   절 = 「### 제목」 아래 글(HelpService.sections 와 같은 규칙 · 번호 m1, m2 …).
 *   탭 → 절 찾기 순서: ① 이은 것(sec2_tab_help) ② ADMIN_GUIDE 절 제목의 「[탭 키]」 ③ ADMIN_GUIDE 절 제목에 탭 이름 ④ USER_MANUAL 절 제목에 탭 이름.
 *   ADMIN_GUIDE 저장은 SUPER · 새 판(옛 판은 남음 · DB 가 고치기 · 지우기를 막음) — 회원 설명서 저장(HelpService.save)과 같은 검사.
 * ------------------------------------------------------------------- */
import { NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { HelpService } from '../help/help.service';
import { Sec2Db, sec2Mask } from './common';
import { pgxEffectiveOf } from '../admin/pgx-perm';   // v10.615 (docs/757) GROUPS 면 자기가 볼 수 있는 탭의 절만

export const SEC2_GUIDE = 'ADMIN_GUIDE';
const MANUAL = 'USER_MANUAL';
const MAX = 20000;
const KEY_RE = /^[a-z][a-z0-9-]{1,39}$/;

async function current(db: Sec2Db, code: string) {
  const [r] = await db.query<{ version: number; title: string; body: string; createdAt: string }>(
    `SELECT version, title, body, created_at AS "createdAt" FROM v_help_doc_current WHERE code = $1`, [code]);
  return r ?? null;
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** GET /admin/help/tab?key=&label= — 「?」 한 칸 */
export async function sec2TabHelp(db: Sec2Db, key: string, label: string | undefined) {
  if (!KEY_RE.test(String(key ?? ''))) throw new PolicyViolation('SEC2_TAB_KEY', '탭 키 모양이 아닙니다.');
  /* v10.615 (docs/757) perm.mode GROUPS — 주소는 운영 역할이 어느 업무든 보기만 있으면 열림(SQL pgx_role_checks ⑥) · 대신 표에 있는 탭은 그 탭 보기 권한이 있어야 절을 줌
   *   ROLE · COMPARE 는 지금과 같음(pgxEffectiveOf 가 null) · 표에 없는 탭 키는 그대로 보여 줌(화면이 역할로 고른 탭) */
  const eff = await pgxEffectiveOf(db, RequestCtx.actorId() ?? null);
  if (eff) {
    const [known] = await db.query<{ k: number }>(`SELECT 1 AS k FROM perm_tasks WHERE key = $1 AND active`, [key]);
    if (known && !eff.has(`${key}:VIEW`)) {
      return { key, found: false, docCode: null, version: null, via: null, section: null, linked: null, choices: [], canEdit: false,
               note: '이 탭을 볼 권한이 없어 도움말을 보이지 않습니다 — 권한은 SUPER 에게 요청하십시오.' };
    }
  }
  const name = String(label ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60);
  const [guide, manual] = await Promise.all([current(db, SEC2_GUIDE), current(db, MANUAL)]);
  const docs: Record<string, typeof guide> = { [SEC2_GUIDE]: guide, [MANUAL]: manual };
  const secs = (code: string) => (docs[code] ? HelpService.sections(docs[code]!.body) : []);
  const [link] = await db.query<{ doc_code: string; heading: string }>(`SELECT doc_code, heading FROM sec2_tab_help WHERE tab_key = $1`, [key]);
  let found: { code: string; via: string; s: { id: string; heading: string; text: string } } | null = null;
  if (link) {
    const s = secs(link.doc_code).find((x) => x.heading === link.heading);
    if (s) found = { code: link.doc_code, via: 'LINK', s };
  }
  if (!found) { const s = secs(SEC2_GUIDE).find((x) => x.heading.includes(`[${key}]`)); if (s) found = { code: SEC2_GUIDE, via: 'KEY', s }; }
  if (!found && name.length >= 2) { const s = secs(SEC2_GUIDE).find((x) => norm(x.heading).includes(norm(name))); if (s) found = { code: SEC2_GUIDE, via: 'LABEL', s }; }
  if (!found && name.length >= 2) { const s = secs(MANUAL).find((x) => norm(x.heading).includes(norm(name))); if (s) found = { code: MANUAL, via: 'MANUAL', s }; }
  const canEdit = RequestCtx.get()?.actorRole === 'SUPER';
  return {
    key, found: !!found,
    docCode: found?.code ?? null, version: found ? docs[found.code]!.version : null, via: found?.via ?? null,
    section: found ? { id: found.s.id, heading: found.s.heading.replace(/\s*\[[a-z0-9-]+\]\s*$/, ''), text: found.s.text.slice(0, 4000) } : null,
    linked: link ? { docCode: link.doc_code, heading: link.heading, broken: !found || found.via !== 'LINK' } : null,
    /* SUPER 만 — 이을 절 고르기 */
    choices: canEdit ? [
      ...secs(SEC2_GUIDE).map((s) => ({ docCode: SEC2_GUIDE, heading: s.heading })),
      ...secs(MANUAL).map((s) => ({ docCode: MANUAL, heading: s.heading })),
    ] : [],
    canEdit,
    note: found ? null : '이 탭의 도움말이 아직 없습니다 — 관 관리 › 화면 도움말에서 절을 쓰거나 이을 수 있습니다(SUPER).',
  };
}

/** GET /admin/help/tab-links — 이은 것 모두 */
export async function sec2TabLinks(db: Sec2Db) {
  const items = await db.query<{ tabKey: string; docCode: string; heading: string; by: string | null; updatedAt: string }>(
    `SELECT t.tab_key AS "tabKey", t.doc_code AS "docCode", t.heading, a.email::text AS by, t.updated_at AS "updatedAt"
       FROM sec2_tab_help t LEFT JOIN accounts a ON a.id = t.updated_by ORDER BY t.tab_key`);
  return { items: items.map((r) => ({ ...r, by: sec2Mask(r.by) })) };
}

/** PUT /admin/help/tab-links/{key} — SUPER · 그 절이 지금 판에 있어야 */
export async function sec2SetTabLink(db: Sec2Db, key: string, docCode: string, heading: string) {
  if (!KEY_RE.test(String(key ?? ''))) throw new PolicyViolation('SEC2_TAB_KEY', '탭 키 모양이 아닙니다.');
  if (docCode !== SEC2_GUIDE && docCode !== MANUAL) throw new PolicyViolation('SEC2_DOC_CODE', 'ADMIN_GUIDE 또는 USER_MANUAL 입니다.');
  const h = String(heading ?? '').trim();
  const d = await current(db, docCode);
  if (!d || !HelpService.sections(d.body).some((s) => s.heading === h)) {
    throw new PolicyViolation('SEC2_NO_SECTION', '그 설명서의 지금 판에 그 절 제목이 없습니다.');
  }
  await db.query(
    `INSERT INTO sec2_tab_help (tab_key, doc_code, heading, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (tab_key) DO UPDATE SET doc_code = EXCLUDED.doc_code, heading = EXCLUDED.heading, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, docCode, h, RequestCtx.actorId() ?? null]);
  return { ok: true, key, docCode, heading: h, note: '이었습니다.' };
}

/** POST /admin/help/tab-links/{key}/remove — SUPER */
export async function sec2RemoveTabLink(db: Sec2Db, key: string) {
  if (!KEY_RE.test(String(key ?? ''))) throw new PolicyViolation('SEC2_TAB_KEY', '탭 키 모양이 아닙니다.');
  const r = await db.query(`DELETE FROM sec2_tab_help WHERE tab_key = $1 RETURNING tab_key`, [key]);
  if (!r.length) throw new NotFound('이은 것이 없습니다.');
  return { ok: true, key, note: '잇기를 지웠습니다 — 이제 절 제목의 [탭 키] · 탭 이름으로 찾습니다.' };
}

/** GET /admin/help/guide — 운영 화면 도움말 지금 판 · 절 목차 · 판 목록 */
export async function sec2Guide(db: Sec2Db) {
  const d = await current(db, SEC2_GUIDE);
  const versions = await db.query<{ version: number; chars: number; note: string | null; by: string | null; createdAt: string }>(
    `SELECT h.version, char_length(h.body) AS chars, h.note, a.email::text AS by, h.created_at AS "createdAt"
       FROM help_docs h LEFT JOIN accounts a ON a.id = h.created_by WHERE h.code = $1 ORDER BY h.version DESC LIMIT 30`, [SEC2_GUIDE]);
  return {
    code: SEC2_GUIDE, maxChars: MAX,
    current: d ? { version: d.version, title: d.title, body: d.body, updatedAt: d.createdAt,
                   sections: HelpService.sections(d.body).map((s) => ({ id: s.id, heading: s.heading, key: /\[([a-z0-9-]+)\]\s*$/.exec(s.heading)?.[1] ?? null })) } : null,
    versions: versions.map((v) => ({ ...v, by: sec2Mask(v.by) })),
    canEdit: RequestCtx.get()?.actorRole === 'SUPER',
  };
}

/** POST /admin/help/guide — SUPER · 새 판(같은 본문이면 만들지 않음) · HelpService.save 와 같은 검사 */
export async function sec2SaveGuide(db: Sec2Db & { transaction<T>(fn: () => Promise<T>): Promise<T> }, body: string, note?: string) {
  const text = String(body ?? '').replace(/\r\n/g, '\n').trim() + '\n';
  if (text.length < 100) throw new PolicyViolation('HELP_TOO_SHORT', '도움말 본문이 너무 짧습니다(100자 이상).');
  if (text.length > MAX) throw new PolicyViolation('HELP_TOO_LONG', `도움말은 ${MAX.toLocaleString('ko-KR')}자까지입니다(지금 ${text.length.toLocaleString('ko-KR')}자).`);
  if (!HelpService.sections(text).length) throw new PolicyViolation('HELP_NO_SECTION', '「### 제목」으로 시작하는 절이 하나도 없습니다.');
  return db.transaction(async () => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('help_docs:' || $1))`, [SEC2_GUIDE]);
    const cur = await current(db, SEC2_GUIDE);
    if (cur && cur.body === text) return { ok: true, version: cur.version, chars: text.length, note: '바뀐 내용이 없어 새 판을 만들지 않았습니다.' };
    const [r] = await db.query<{ version: number }>(
      `INSERT INTO help_docs (code, version, title, body, note, created_by)
       SELECT $1, coalesce(max(version), 0) + 1, $2, $3, nullif($4, ''), $5 FROM help_docs WHERE code = $1 RETURNING version`,
      [SEC2_GUIDE, cur?.title ?? '운영 화면 도움말', text, String(note ?? '').trim().slice(0, 200), RequestCtx.actorId() ?? null]);
    return { ok: true, version: r!.version, chars: text.length, note: `운영 화면 도움말 ${r!.version}판으로 저장했습니다.` };
  });
}
