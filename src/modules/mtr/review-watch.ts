import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { mtrAlertOnce, mtrMaskMail, mtrSettings, mtrText, MtrSettings } from './common';

/* ---------------------------------------------------------------------
 * v10.574 (docs/716) 가짜 후기 · 리뷰 탐지 — 스위치 mtr.review_watch(처음 꺼짐) · 의심 목록만 · 자동 삭제 · 자동 가림 없음
 *   대상: 거래 후기(deal_reviews · 성사 거래 당사자만 쓸 수 있음) · 소개몰 리뷰(hlt_reviews · 구매확정 줄만 쓸 수 있음)
 *   신호(점수 합 · 기준 mtr.review_threshold 50):
 *     SAME_DEVICE  40  쓴 사람이 후기 대상(거래 후기) 또는 같은 대상의 다른 작성자와 같은 기기 표지(v10.546 sfx_device_marks — sfx.device_watch 가 켜져 쌓인 것만)
 *     NO_DEAL      40  거래 후기의 거래가 지금 성사 상태가 아님(취소 · 분쟁 등) · 쓴 사람이 당사자가 아님 / 소개몰 주문이 취소 · 반품
 *     BURST        25  같은 대상에 mtr.review_burst_hours(24)시간 앞뒤로 mtr.review_burst_count(5)건 이상
 *     SIMILAR      25  같은 대상 다른 작성자의 글과 글자 짝(2글자) 겹침 mtr.review_similar_pct(80)% 이상(둘 다 10자 이상)
 *     NEW_ACCOUNT  10  가입 7일 안에 쓴 후기
 *   매시간(mtr_hourly) 최근 mtr.review_scan_days(30)일 안에 쓰거나 고친 것(많아야 3000) · 이미 결정한 줄은 덮지 않음
 *   운영 결정: 가짜(FAKE · 소개몰 리뷰는 「가림」 고를 수 있음 · 거래 후기는 가림 칸이 없어 표시만) · 문제없음(OK) · 사유 필수 · 감사
 *   가짜로 정한 거래 후기는 v10.575 소개자 신뢰 점수에서 뺌 · 리뷰 적립(v10.533) 회수는 하지 않음(대표 결정 대기)
 * ------------------------------------------------------------------- */

export const REVIEW_FLAG_STATES = ['OPEN', 'FAKE', 'OK'] as const;
export const REVIEW_SIGNAL_POINTS: Record<string, number> = { SAME_DEVICE: 40, NO_DEAL: 40, BURST: 25, SIMILAR: 25, NEW_ACCOUNT: 10 };
export const REVIEW_SIGNAL_KO: Record<string, string> = {
  SAME_DEVICE: '같은 기기', NO_DEAL: '거래 없음 · 취소', BURST: '짧은 시간 몰림', SIMILAR: '비슷한 문장', NEW_ACCOUNT: '새 계정',
};
const SCAN_LIMIT = 3000;
const NEW_ACCOUNT_DAYS = 7;
const MIN_TEXT = 10;

/** 비교용 글 — 빈칸 · 문장부호 빼고 소문자 */
export function normText(s: string | null | undefined): string {
  return String(s ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}
/** 글자 짝(2글자) 겹침 0 ~ 100 — Jaccard · 서버 · 시험이 같은 식 */
export function bigramSimilarity(a: string, b: string): number {
  const x = normText(a), y = normText(b);
  if (x.length < 2 || y.length < 2) return 0;
  const grams = (t: string) => { const s = new Set<string>(); for (let i = 0; i < t.length - 1; i++) s.add(t.slice(i, i + 2)); return s; };
  const A = grams(x), B = grams(y);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const uni = A.size + B.size - inter;
  return uni ? Math.round((inter / uni) * 100) : 0;
}

export interface ReviewRow { kind: 'DEAL' | 'HLT'; id: string; author: string; target: string; body: string | null; at: number; joined: number; noDeal: boolean }
export interface ReviewVerdict { signals: string[]; score: number; detail: Record<string, unknown> }

/** 신호 셈(DB 없이 · 시험이 같은 함수) — pairs: 같은 기기 표지를 쓴 계정 짝 'a|b' */
export function judgeReviews(rows: ReviewRow[], pairs: Set<string>, s: Pick<MtrSettings, 'reviewBurstCount' | 'reviewBurstHours' | 'reviewSimilarPct'>): Map<string, ReviewVerdict> {
  const out = new Map<string, ReviewVerdict>();
  const groups = new Map<string, ReviewRow[]>();
  for (const r of rows) { const k = `${r.kind}:${r.target}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
  const win = s.reviewBurstHours * 3_600_000;
  for (const r of rows) {
    const g = groups.get(`${r.kind}:${r.target}`) ?? [];
    const signals: string[] = [];
    const detail: Record<string, unknown> = {};
    const others = g.filter((o) => o.id !== r.id && o.author !== r.author);
    const devWith = others.filter((o) => pairs.has(`${r.author}|${o.author}`)).map((o) => o.id);
    const devTarget = r.kind === 'DEAL' && pairs.has(`${r.author}|${r.target}`);
    if (devTarget || devWith.length) { signals.push('SAME_DEVICE'); detail.sameDevice = { withTarget: devTarget, withReviews: devWith.slice(0, 5) }; }
    if (r.noDeal) signals.push('NO_DEAL');
    const near = g.filter((o) => Math.abs(o.at - r.at) <= win).length;
    if (near >= s.reviewBurstCount) { signals.push('BURST'); detail.burst = { count: near, hours: s.reviewBurstHours }; }
    if (normText(r.body).length >= MIN_TEXT) {
      let best = 0, bestId: string | null = null;
      for (const o of others) {
        if (normText(o.body).length < MIN_TEXT) continue;
        const v = bigramSimilarity(r.body ?? '', o.body ?? '');
        if (v > best) { best = v; bestId = o.id; }
      }
      if (best >= s.reviewSimilarPct) { signals.push('SIMILAR'); detail.similar = { pct: best, reviewId: bestId }; }
    }
    if (r.at - r.joined < NEW_ACCOUNT_DAYS * 86_400_000) signals.push('NEW_ACCOUNT');
    const score = signals.reduce((t, x) => t + (REVIEW_SIGNAL_POINTS[x] ?? 0), 0);
    out.set(`${r.kind}:${r.id}`, { signals, score, detail });
  }
  return out;
}

/** 탐지 한 번 — force 면 스위치가 꺼져 있어도(운영 「지금 보기」) · 결정한 줄은 덮지 않음 */
export async function reviewScan(db: DatabaseService, force = false) {
  const s = await mtrSettings(db);
  if (!s.reviewWatch && !force) return { skipped: 'OFF', scanned: 0, flagged: 0, added: 0 };
  const raw = await db.query<{ kind: 'DEAL' | 'HLT'; id: string; author: string; target: string; body: string | null; at: number; joined: number; no_deal: boolean }>(
    `SELECT * FROM (
       SELECT 'DEAL'::text AS kind, r.id::text, r.author_id::text AS author, r.target_id::text AS target, r.body, (extract(epoch FROM r.created_at) * 1000)::float8 AS at, (extract(epoch FROM a.created_at) * 1000)::float8 AS joined,
              (d.status NOT IN ('CONFIRMED', 'SETTLED') OR r.author_id NOT IN (d.buyer_account_id, d.seller_account_id)) AS no_deal
         FROM deal_reviews r JOIN deals d ON d.id = r.deal_id JOIN accounts a ON a.id = r.author_id
        WHERE coalesce(r.updated_at, r.created_at) > now() - make_interval(days => $1::int)
       UNION ALL
       SELECT 'HLT', h.id::text, h.account_id::text, h.product_id::text, h.body, (extract(epoch FROM h.created_at) * 1000)::float8, (extract(epoch FROM a.created_at) * 1000)::float8,
              (o.status IN ('CANCELED', 'RETURNED')) AS no_deal
         FROM hlt_reviews h JOIN hlt_orders o ON o.id = h.order_id JOIN accounts a ON a.id = h.account_id
        WHERE h.updated_at > now() - make_interval(days => $1::int)) q
      ORDER BY at DESC LIMIT $2::int`, [s.reviewScanDays, SCAN_LIMIT]);
  if (!raw.length) return { scanned: 0, flagged: 0, added: 0 };
  const rows: ReviewRow[] = raw.map((r) => ({ kind: r.kind, id: r.id, author: r.author, target: r.target, body: r.body, at: Number(r.at), joined: Number(r.joined), noDeal: !!r.no_deal }));
  const accts = [...new Set(rows.flatMap((r) => (r.kind === 'DEAL' ? [r.author, r.target] : [r.author])))];
  const pr = await db.query<{ a: string; b: string }>(
    `SELECT DISTINCT m1.account_id::text AS a, m2.account_id::text AS b
       FROM sfx_device_marks m1 JOIN sfx_device_marks m2 ON m2.mark_hash = m1.mark_hash AND m2.account_id <> m1.account_id
      WHERE m1.account_id = ANY($1::uuid[]) AND m2.account_id = ANY($1::uuid[])`, [accts]).catch(() => [] as Array<{ a: string; b: string }>);
  const pairs = new Set(pr.map((p) => `${p.a}|${p.b}`));
  const verdicts = judgeReviews(rows, pairs, s);
  let flagged = 0, added = 0;
  for (const r of rows) {
    const v = verdicts.get(`${r.kind}:${r.id}`);
    if (!v || v.score < s.reviewThreshold) continue;
    flagged++;
    const x = await db.query<{ ins: boolean }>(
      `INSERT INTO mtr_review_flags (kind, review_id, author_id, target_key, signals, score, detail)
       VALUES ($1, $2::uuid, $3::uuid, $4, $5::text[], $6::int, $7::jsonb)
       ON CONFLICT (kind, review_id) DO UPDATE SET signals = EXCLUDED.signals, score = EXCLUDED.score, detail = EXCLUDED.detail, updated_at = now()
        WHERE mtr_review_flags.state = 'OPEN'
       RETURNING (xmax = 0) AS ins`, [r.kind, r.id, r.author, r.target, v.signals, v.score, JSON.stringify(v.detail)]);
    if (x[0]?.ins) added++;
  }
  if (added > 0 && !force) {
    await mtrAlertOnce(db, 'MTR_REVIEW_SUSPECT', 'INFO', `가짜 후기 의심이 ${added}건 새로 잡혔습니다(위험감지 › 가짜 후기 의심)`, { added, flagged });
  }
  return { scanned: rows.length, flagged, added };
}

/* ── 운영 ── */
export async function reviewFlagList(db: DatabaseService, stateIn?: string) {
  const state = (REVIEW_FLAG_STATES as readonly string[]).includes(String(stateIn ?? '')) ? String(stateIn) : 'OPEN';
  const s = await mtrSettings(db);
  const rows = await db.query<{ authorEmail: string | null } & Record<string, unknown>>(
    `SELECT f.id::text, f.kind, f.review_id::text AS "reviewId", f.target_key AS "targetKey", f.signals, f.score, f.detail, f.state, f.hidden, f.note,
            f.decided_at AS "decidedAt", f.created_at AS "createdAt", f.updated_at AS "updatedAt",
            a.email::text AS "authorEmail", left(coalesce(a.name, ''), 1) || '*' AS "authorHead", a.created_at AS "authorJoined",
            CASE f.kind WHEN 'DEAL' THEN (SELECT r.rating FROM deal_reviews r WHERE r.id = f.review_id) ELSE (SELECT h.rating FROM hlt_reviews h WHERE h.id = f.review_id) END AS rating,
            CASE f.kind WHEN 'DEAL' THEN (SELECT left(coalesce(r.body, ''), 300) FROM deal_reviews r WHERE r.id = f.review_id)
                        ELSE (SELECT left(h.body, 300) FROM hlt_reviews h WHERE h.id = f.review_id) END AS body,
            CASE f.kind WHEN 'HLT' THEN (SELECT p.name FROM hlt_products p WHERE p.id::text = f.target_key) END AS "productName",
            CASE f.kind WHEN 'HLT' THEN (SELECT h.state FROM hlt_reviews h WHERE h.id = f.review_id) END AS "reviewState"
       FROM mtr_review_flags f JOIN accounts a ON a.id = f.author_id
      WHERE f.state = $1
      ORDER BY f.score DESC, f.updated_at DESC, f.id DESC LIMIT 200`, [state]);
  const [c] = await db.query<{ open: number; fake: number; ok: number }>(
    `SELECT count(*) FILTER (WHERE state = 'OPEN')::int AS open, count(*) FILTER (WHERE state = 'FAKE')::int AS fake, count(*) FILTER (WHERE state = 'OK')::int AS ok FROM mtr_review_flags`);
  return {
    state, on: s.reviewWatch, threshold: s.reviewThreshold, burstCount: s.reviewBurstCount, burstHours: s.reviewBurstHours, similarPct: s.reviewSimilarPct, scanDays: s.reviewScanDays,
    points: REVIEW_SIGNAL_POINTS, signalNames: REVIEW_SIGNAL_KO, counts: c ?? { open: 0, fake: 0, ok: 0 },
    rows: rows.map(({ authorEmail, ...r }) => ({ ...r, author: mtrMaskMail(authorEmail) })),
  };
}

/** 의심 한 줄 자세히 — 같은 대상의 다른 후기(최근 20 · 가린 작성자) · 비슷한 글 */
export async function reviewFlagDetail(db: DatabaseService, id: number) {
  const [f] = await db.query<{ kind: string; review_id: string; target_key: string }>(`SELECT kind, review_id::text, target_key FROM mtr_review_flags WHERE id = $1`, [id]);
  if (!f) throw new NotFound('의심 줄을 찾을 수 없습니다.');
  const others = await db.query<{ email: string | null } & Record<string, unknown>>(
    f.kind === 'DEAL'
      ? `SELECT r.id::text, r.rating, left(coalesce(r.body, ''), 300) AS body, r.created_at AS "createdAt", a.email::text AS email,
                (SELECT x.state FROM mtr_review_flags x WHERE x.kind = 'DEAL' AND x.review_id = r.id) AS "flagState"
           FROM deal_reviews r JOIN accounts a ON a.id = r.author_id WHERE r.target_id = $1::uuid ORDER BY r.created_at DESC LIMIT 20`
      : `SELECT h.id::text, h.rating, left(h.body, 300) AS body, h.created_at AS "createdAt", a.email::text AS email,
                (SELECT x.state FROM mtr_review_flags x WHERE x.kind = 'HLT' AND x.review_id = h.id) AS "flagState"
           FROM hlt_reviews h JOIN accounts a ON a.id = h.account_id WHERE h.product_id = $1::uuid ORDER BY h.created_at DESC LIMIT 20`,
    [f.target_key]);
  return { id, kind: f.kind, reviewId: f.review_id, others: others.map(({ email, ...o }) => ({ ...o, author: mtrMaskMail(email), self: o.id === f.review_id })) };
}

/** 결정 — FAKE(가짜 · 소개몰 리뷰는 hide 면 가림) · OK(문제없음) · 사유 필수 · 한 번 */
export async function reviewFlagDecide(db: DatabaseService, actorId: string, id: number, d: { verdict: string; note: string; hide?: boolean }) {
  if (!['FAKE', 'OK'].includes(d.verdict)) throw new PolicyViolation('MTR_REVIEW_VERDICT', '결정은 FAKE · OK 중 하나입니다.');
  const note = mtrText(String(d.note ?? '').replace(/[{}]/g, ''), 2, 300, 'MTR_REASON', '사유를 2 ~ 300자로 적어 주십시오.');
  return db.transaction(async () => {
    const [f] = await db.query<{ kind: string; review_id: string; state: string }>(`SELECT kind, review_id::text, state FROM mtr_review_flags WHERE id = $1 FOR UPDATE`, [id]);
    if (!f) throw new NotFound('의심 줄을 찾을 수 없습니다.');
    if (f.state !== 'OPEN') throw new StateConflict('MTR_REVIEW_STATE', '이미 결정한 줄입니다.');
    const hide = d.verdict === 'FAKE' && d.hide === true && f.kind === 'HLT';
    if (d.verdict === 'FAKE' && d.hide === true && f.kind !== 'HLT') throw new PolicyViolation('MTR_REVIEW_HIDE', '거래 후기는 가릴 수 없습니다(표시만 · 신뢰 점수에서 빠짐).');
    if (hide) {
      await db.query(`UPDATE hlt_reviews SET state = 'HIDDEN', hidden_reason = $2, decided_by = $3::uuid, decided_at = now(), updated_at = now() WHERE id = $1::uuid AND state <> 'HIDDEN'`,
        [f.review_id, `가짜 리뷰 의심 — 운영 확인(${note})`.slice(0, 300), actorId]);
    }
    await db.query(`UPDATE mtr_review_flags SET state = $2, note = $3, hidden = $4, decided_by = $5::uuid, decided_at = now(), updated_at = now() WHERE id = $1`,
      [id, d.verdict, note, hide, actorId]);
    return { ok: true, id, state: d.verdict, hidden: hide, note: d.verdict === 'FAKE' ? (hide ? '가짜로 정하고 리뷰를 가렸습니다.' : '가짜로 정했습니다(신뢰 점수에서 빠짐).') : '문제없음으로 정했습니다.' };
  });
}
