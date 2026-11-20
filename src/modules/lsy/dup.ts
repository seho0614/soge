import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { ReviewRepository } from '../review/review.repository';
import { lsyPhoneDigits, lsyPhonesInText, lsyReason, lsySettings, LsySettings } from './common';

/* ---------------------------------------------------------------------
 * v10.524 (D279 · docs/662) 중복 매물 자동 탐지 — 스위치 lsy.dup_detect(처음 꺼짐)
 *   ① 매시간(lsy_hourly) 최근 바뀐 매물(게시 · 검수 중) 중 그 판(version)을 아직 안 본 것 · 50건 · 40초 예산
 *   ② 견줄 상대 — 같은 관 · (같은 업종 또는 같은 주인) · lsy.dup_window_days(60일) 안에 만든 게시 · 검수 중 매물, 또는 같은 사진(관 상관없이) · 최근 300건
 *   ③ 신호 세 가지
 *      사진 지문 — 이미 있는 파일 SHA-256(files.sha256 · 올릴 때 서버가 계산) 이 같은 사진 수 · 같은 사진 1장 60점 · 1장 더할 때마다 +20(100까지)
 *                  지각 해시(비슷한 사진)는 그림을 풀 라이브러리가 없어(새 npm 없음) 이번에는 하지 않음 — 다음 후보(NOTES)
 *      글 유사도  — 제목 · 본문을 글자 두 개 묶음(bigram) 겹침(Jaccard)으로 · 제목 40 · 본문 60 비중 · pg_trgm 은 로케일 C 에서 한글을 못 쪼개 쓰지 않음(B110 주석)
 *      같은 연락처 — 같은 주인(SAME_OWNER) · 다른 주인인데 계정 전화번호가 같음(SAME_PHONE) · 글 속 전화번호가 같음(SAME_TEXT_PHONE) · +15점
 *   ④ 점수 = max(사진, 글) + 연락처 15 + (사진도 같고 글도 50 넘음) 10 · 100까지 · lsy.dup_threshold(80) 넘으면 짝(lsy_dup_pairs · PENDING)
 *   ⑤ lsy.dup_queue(처음 on — 탐지가 켜졌을 때만 동작) 면 짝의 **나중에 만든 매물**을 기존 검수 대기에 올림(review_items · 매물 상태는 그대로 —
 *      신고 임계치(fn_report_escalate)와 같은 방식 · 이미 대기 중이면 올리지 않음) · 자동으로 내리지 않음(사람이 판단)
 *   ⑥ 운영 화면 짝 보기(검수 › 매물 중복 의심) — 두 매물 나란히 · 같은 사진 표시 · 전화는 끝 4자리만 · 「같은 매물」 · 「다른 매물」(사유 · 감사)
 *      결정한 짝은 다시 열지 않음(점수가 바뀌어도 그대로)
 * ------------------------------------------------------------------- */

const BUDGET_MS = 40_000;
const SCAN_BATCH = 50;
const CAND_LIMIT = 300;
export const DUP_STATES = ['PENDING', 'SAME', 'DIFFERENT'] as const;
export const DUP_VERDICTS = ['SAME', 'DIFFERENT'] as const;
export type DupContact = 'NONE' | 'SAME_OWNER' | 'SAME_PHONE' | 'SAME_TEXT_PHONE';

/** 비교용 글 — 소문자 · 글자 · 숫자만(빈칸 · 문장부호 없앰) */
export function dupNorm(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[^0-9a-z가-힣]+/g, '');
}
/** 글자 두 개 묶음 */
export function dupBigrams(s: string): Set<string> {
  const t = dupNorm(s); const out = new Set<string>();
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2));
  if (t.length === 1) out.add(t);
  return out;
}
/** 겹침(Jaccard) 0 ~ 1 */
export function dupJaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
/** 글 유사도 0 ~ 100 — 본문이 둘 다 있으면 제목 40 · 본문 60, 아니면 제목만 */
export function dupTextScore(t1: string, b1: string, t2: string, b2: string): number {
  const ts = dupJaccard(dupBigrams(t1), dupBigrams(t2));
  const hasBody = dupNorm(b1).length >= 20 && dupNorm(b2).length >= 20;
  const bs = hasBody ? dupJaccard(dupBigrams(b1.slice(0, 2000)), dupBigrams(b2.slice(0, 2000))) : 0;
  return Math.round(100 * (hasBody ? 0.4 * ts + 0.6 * bs : ts));
}
/** 사진 점수 — 같은 사진 1장 60 · 1장마다 +20 */
export function dupPhotoScore(shared: number): number {
  return shared > 0 ? Math.min(100, 60 + 20 * (shared - 1)) : 0;
}
/** 합친 점수 */
export function dupScore(text: number, shared: number, contact: DupContact): number {
  const photo = dupPhotoScore(shared);
  return Math.min(100, Math.max(text, photo) + (contact !== 'NONE' ? 15 : 0) + (photo > 0 && text >= 50 ? 10 : 0));
}

interface Me { id: string; gwan: string; category: string; owner: string; title: string; body: string; created_at: string; version: number; phone: string | null }
interface Cand { id: string; owner: string; title: string; body: string; created_at: string; phone: string | null; shared: number }

export interface DupJobResult { skipped?: string; scanned: number; pairs: number; queued: number; stop?: number }

/** 매시간 — 짝 찾기 */
export async function dupScanJob(db: DatabaseService): Promise<DupJobResult> {
  const s = await lsySettings(db);
  if (!s.dupDetect) return { skipped: 'OFF', scanned: 0, pairs: 0, queued: 0 };
  const targets = await db.query<{ id: string }>(
    `SELECT l.id::text FROM listings l LEFT JOIN lsy_dup_scans d ON d.listing_id = l.id
      WHERE l.status IN ('IN_REVIEW', 'PUBLISHED') AND l.updated_at > now() - interval '2 days'
        AND (d.listing_id IS NULL OR d.version <> l.version)
      ORDER BY l.updated_at DESC LIMIT $1`, [SCAN_BATCH]);
  const t0 = Date.now();
  const out: DupJobResult = { scanned: 0, pairs: 0, queued: 0 };
  for (let i = 0; i < targets.length; i++) {
    if (Date.now() - t0 > BUDGET_MS) { out.stop = targets.length - i; break; }
    const r = await dupScanOne(db, targets[i]!.id, s);
    out.scanned++; out.pairs += r.pairs; out.queued += r.queued;
  }
  return out;
}

/** 매물 하나 견주기(운영 「지금 보기」도 이것) */
export async function dupScanOne(db: DatabaseService, listingId: string, s: LsySettings): Promise<{ pairs: number; queued: number }> {
  const [me] = await db.query<Me>(
    `SELECT l.id::text, l.gwan_code AS gwan, l.category_id::text AS category, l.owner_account_id::text AS owner, l.title, left(coalesce(l.body, ''), 2000) AS body,
            l.created_at, l.version, a.phone
       FROM listings l JOIN accounts a ON a.id = l.owner_account_id WHERE l.id = $1`, [listingId]);
  if (!me) return { pairs: 0, queued: 0 };
  const hashes = (await db.query<{ sha256: string }>(
    `SELECT DISTINCT f.sha256 FROM listing_media m JOIN files f ON f.id = m.file_id
      WHERE m.listing_id = $1 AND m.media_type = 'IMAGE' AND f.sha256 IS NOT NULL`, [listingId])).map((r) => r.sha256);
  const cands = await db.query<Cand>(
    `SELECT l.id::text, l.owner_account_id::text AS owner, l.title, left(coalesce(l.body, ''), 2000) AS body, l.created_at, a.phone,
            (SELECT count(DISTINCT f.sha256)::int FROM listing_media m JOIN files f ON f.id = m.file_id
              WHERE m.listing_id = l.id AND m.media_type = 'IMAGE' AND f.sha256 = ANY($4::text[])) AS shared
       FROM listings l JOIN accounts a ON a.id = l.owner_account_id
      WHERE l.id <> $1 AND l.status IN ('PUBLISHED', 'IN_REVIEW')
        AND l.created_at > now() - make_interval(days => $5::int)
        AND ((l.gwan_code = $2 AND (l.category_id = $3::uuid OR l.owner_account_id = $6::uuid))
             OR EXISTS (SELECT 1 FROM listing_media m JOIN files f ON f.id = m.file_id
                         WHERE m.listing_id = l.id AND m.media_type = 'IMAGE' AND f.sha256 = ANY($4::text[])))
      ORDER BY l.created_at DESC LIMIT $7`,
    [listingId, me.gwan, me.category, hashes, s.dupWindowDays, me.owner, CAND_LIMIT]);
  const myPhone = lsyPhoneDigits(me.phone);
  const myTextPhones = new Set(lsyPhonesInText(`${me.title} ${me.body}`));
  let pairs = 0, queued = 0;
  for (const c of cands) {
    const text = dupTextScore(me.title, me.body, c.title, c.body);
    let contact: DupContact = 'NONE';
    if (c.owner === me.owner) contact = 'SAME_OWNER';
    else if (myPhone && lsyPhoneDigits(c.phone) === myPhone) contact = 'SAME_PHONE';
    else if (myTextPhones.size && lsyPhonesInText(`${c.title} ${c.body}`).some((p) => myTextPhones.has(p))) contact = 'SAME_TEXT_PHONE';
    const score = dupScore(text, Number(c.shared) || 0, contact);
    if (score < s.dupThreshold) continue;
    const newer = new Date(c.created_at).getTime() > new Date(me.created_at).getTime() ? c.id : me.id;
    const [p] = await db.query<{ id: string; state: string; queued: string | null }>(
      `INSERT INTO lsy_dup_pairs (a_id, b_id, newer_id, score, text_score, photo_shared, contact)
       VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid), $3::uuid, $4::int, $5::int, $6::int, $7)
       ON CONFLICT (a_id, b_id) DO UPDATE SET score = EXCLUDED.score, text_score = EXCLUDED.text_score, photo_shared = EXCLUDED.photo_shared,
                                              contact = EXCLUDED.contact, updated_at = now()
        WHERE lsy_dup_pairs.state = 'PENDING'
       RETURNING id::text, state, queued_review_id::text AS queued`,
      [me.id, c.id, newer, score, text, Number(c.shared) || 0, contact]);
    if (!p) continue;   // 이미 결정한 짝 — 그대로
    pairs++;
    if (s.dupQueue && p.state === 'PENDING' && !p.queued && (await dupQueue(db, p.id, newer))) queued++;
  }
  await db.query(
    `INSERT INTO lsy_dup_scans (listing_id, version, scanned_at, found) VALUES ($1, $2, now(), $3)
     ON CONFLICT (listing_id) DO UPDATE SET version = EXCLUDED.version, scanned_at = now(), found = EXCLUDED.found`, [listingId, me.version, pairs]);
  return { pairs, queued };
}

/** 나중 매물을 기존 검수 대기에 — 이미 대기 · 진행 중이면 올리지 않음 · 매물 상태는 그대로 */
async function dupQueue(db: DatabaseService, pairId: string, listingId: string): Promise<boolean> {
  return db.transaction(async () => {
    const [l] = await db.query<{ gwan: string; owner: string; status: string }>(
      `SELECT gwan_code AS gwan, owner_account_id::text AS owner, status FROM listings WHERE id = $1 FOR UPDATE`, [listingId]);
    if (!l || !['PUBLISHED', 'IN_REVIEW'].includes(l.status)) return false;
    const [busy] = await db.query(`SELECT 1 FROM review_items WHERE target_type = 'LISTING' AND target_id = $1 AND status IN ('QUEUED', 'IN_PROGRESS')`, [listingId]);
    if (busy) return false;
    const rid = await new ReviewRepository(db).enqueue({ targetType: 'LISTING', targetId: listingId, gwanCode: l.gwan, submittedBy: l.owner });
    await db.query(`UPDATE lsy_dup_pairs SET queued_review_id = $2::uuid, updated_at = now() WHERE id = $1 AND queued_review_id IS NULL`, [pairId, rid]);
    return true;
  });
}

/* ── 운영 ── */
export async function dupList(db: DatabaseService, state = 'PENDING') {
  const st = (DUP_STATES as readonly string[]).includes(state) ? state : 'PENDING';
  const s = await lsySettings(db);
  const rows = await db.query(
    `SELECT p.id::text, p.score, p.text_score AS "textScore", p.photo_shared AS "photoShared", p.contact, p.state,
            p.found_at AS "foundAt", p.decided_at AS "decidedAt", p.decide_reason AS "decideReason", p.queued_review_id IS NOT NULL AS queued,
            a.id::text AS "aId", a.listing_no AS "aNo", a.title AS "aTitle", a.status AS "aStatus",
            b.id::text AS "bId", b.listing_no AS "bNo", b.title AS "bTitle", b.status AS "bStatus", p.newer_id::text AS "newerId"
       FROM lsy_dup_pairs p JOIN listings a ON a.id = p.a_id JOIN listings b ON b.id = p.b_id
      WHERE p.state = $1 ORDER BY p.score DESC, p.id DESC LIMIT 200`, [st]);
  const counts = await db.query<{ state: string; n: number }>(`SELECT state, count(*)::int AS n FROM lsy_dup_pairs GROUP BY 1`);
  return { state: st, on: s.dupDetect, threshold: s.dupThreshold, queue: s.dupQueue, counts: Object.fromEntries(counts.map((c) => [c.state, c.n])), rows };
}

const mask = (name: string | null) => (name ? `${name.slice(0, 1)}${'*'.repeat(Math.max(1, Math.min(4, name.length - 1)))}` : '—');

/** 짝 보기 — 두 매물 나란히 · 사진 파일 id(운영은 /files/{id} 로 엶) · 같은 사진 표시 · 전화 끝 4자리 */
export async function dupDetail(db: DatabaseService, id: number) {
  const [p] = await db.query<{ id: string; a_id: string; b_id: string; score: number; text_score: number; photo_shared: number; contact: string; state: string; newer_id: string }>(
    `SELECT id::text, a_id::text, b_id::text, score, text_score, photo_shared, contact, state, newer_id::text FROM lsy_dup_pairs WHERE id = $1`, [id]);
  if (!p) throw new NotFound('짝을 찾을 수 없습니다.');
  const side = async (lid: string) => {
    const [l] = await db.query<{ id: string; no: number; title: string; body: string; status: string; category: string | null; gwan: string; created_at: string; owner_name: string | null; phone: string | null; owner: string }>(
      `SELECT l.id::text, l.listing_no AS no, l.title, left(coalesce(l.body, ''), 800) AS body, l.status, c.name AS category, l.gwan_code AS gwan, l.created_at,
              a.name AS owner_name, a.phone, l.owner_account_id::text AS owner
         FROM listings l JOIN accounts a ON a.id = l.owner_account_id LEFT JOIN categories c ON c.id = l.category_id WHERE l.id = $1`, [lid]);
    const photos = await db.query<{ fileId: string; sha256: string | null }>(
      `SELECT f.id::text AS "fileId", f.sha256 FROM listing_media m JOIN files f ON f.id = m.file_id
        WHERE m.listing_id = $1 AND m.media_type = 'IMAGE' ORDER BY m.sort_order, m.created_at`, [lid]);
    const ph = lsyPhoneDigits(l?.phone);
    return l ? { id: l.id, listingNo: l.no, title: l.title, bodyHead: l.body, status: l.status, category: l.category, gwanCode: l.gwan, createdAt: l.created_at,
                 owner: mask(l.owner_name), phoneTail: ph ? ph.slice(-4) : null, ownerId: l.owner, photos } : null;
  };
  const a = await side(p.a_id); const b = await side(p.b_id);
  const shared = new Set((a?.photos ?? []).map((x) => x.sha256).filter((x) => x && (b?.photos ?? []).some((y) => y.sha256 === x)));
  const tag = (ph: Array<{ fileId: string; sha256: string | null }>) => ph.map((x) => ({ fileId: x.fileId, same: !!x.sha256 && shared.has(x.sha256) }));
  return {
    id: Number(p.id), score: p.score, textScore: p.text_score, photoShared: p.photo_shared, contact: p.contact, state: p.state, newerId: p.newer_id,
    a: a ? { ...a, photos: tag(a.photos), ownerId: undefined } : null,
    b: b ? { ...b, photos: tag(b.photos), ownerId: undefined } : null,
    sameOwner: !!a && !!b && a.ownerId === b.ownerId,
  };
}

/** 「같은 매물」 · 「다른 매물」 — 사람이 정함 · 내림은 기존 검수 · 신고 처리에서 */
export async function dupDecide(db: DatabaseService, actorId: string, id: number, d: { verdict?: string; reason?: string }) {
  const verdict = String(d.verdict ?? '');
  if (!(DUP_VERDICTS as readonly string[]).includes(verdict)) throw new PolicyViolation('LSY_DUP_VERDICT', '「같은 매물(SAME)」 또는 「다른 매물(DIFFERENT)」을 골라 주십시오.');
  const reason = lsyReason(d.reason);
  const r = await db.query<{ id: string }>(
    `UPDATE lsy_dup_pairs SET state = $2, decided_by = $3, decided_at = now(), decide_reason = $4, updated_at = now()
      WHERE id = $1 AND state = 'PENDING' RETURNING id::text`, [id, verdict, actorId, reason]);
  if (!r.length) {
    const [x] = await db.query(`SELECT 1 FROM lsy_dup_pairs WHERE id = $1`, [id]);
    if (!x) throw new NotFound('짝을 찾을 수 없습니다.');
    throw new StateConflict('LSY_DUP_STATE', '이미 결정한 짝입니다.');
  }
  return { ok: true, id, state: verdict, note: verdict === 'SAME' ? '같은 매물로 적었습니다 — 내림 · 반려는 검수 큐 · 신고 처리에서 합니다.' : '다른 매물로 적었습니다.' };
}

/** 운영 「지금 보기」 — 매물 하나를 바로 견줌(스위치가 꺼져 있어도 · 결과는 짝 목록) */
export async function dupScanNow(db: DatabaseService, listingId: string) {
  const [l] = await db.query(`SELECT 1 FROM listings WHERE id = $1`, [listingId]);
  if (!l) throw new NotFound('매물을 찾을 수 없습니다.');
  const s = await lsySettings(db);
  const r = await dupScanOne(db, listingId, { ...s, dupQueue: false });
  return { ok: true, ...r, note: `짝 ${r.pairs}개를 찾았습니다(기준 ${s.dupThreshold}점 · 지금 보기는 검수 대기에 올리지 않음).` };
}
