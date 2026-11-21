import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { mtrMaskMail, mtrSettings, mtrText } from './common';

/* ---------------------------------------------------------------------
 * v10.575 (docs/717) 소개자 신뢰 점수 — 스위치 mtr.trust(처음 꺼짐)
 *   점수 0 ~ 100 = DB 함수 fn_mtr_trust(산식 표 mtr_trust_rules · SUPER 가 점수 · 기준 고침)
 *     시작 15 · 본인인증 15 · 사업자 인증 5 · 성사 25(10건이면 다) · 받은 후기 25(평균 × 5건이면 다 · 가짜로 정한 후기 뺌)
 *     응답 속도 15(남이 연 대화 첫 답 가운데 값 · 1시간 안 다 · 48시간 넘으면 0 · 3건 미만 0) · 인정된 신고 -15(1년 · 3건이면 다 깎음)
 *   보이는 곳: 운영 화면(회원 › 소개자 신뢰 점수 — 분포 · 한 사람 찾아 보기 · 산식) · 본인(나의공간 › 내 신뢰 점수)만
 *   ★ 노출 순위 · 검색 정렬 · 광고 · 소개비 계산에 쓰지 않음 — 매물 · 검색 · 광고 · 정산 코드는 mtr_trust · fn_mtr_trust 를 읽지 않음(test_v1575 가 코드에서 확인)
 *     기존 「소개 신뢰도」(fn_trust_score · v_account_trust)는 그대로 — 그것은 공급자 목록 정렬 · 검색 「믿을만」 거르기에 이미 쓰여(v10.31) 이번 점수와 합치지 않음
 *   매일(mtr_daily) 최근 1년 로그인한 회원을 오래 전에 센 순으로 많아야 3000명 셈(mtr_trust_scores) · 본인 화면은 그 자리에서 셈
 * ------------------------------------------------------------------- */

export const TRUST_CODES = ['BASE', 'IDENTITY', 'BUSINESS', 'DEAL', 'REVIEW', 'RESPONSE', 'REPORT'] as const;
const DAILY_BATCH = 3000;
const BUDGET_MS = 40_000;

export interface TrustItem { code: string; label: string; max: number; got: number; basis: Record<string, unknown> }
interface TrustRow { score: string | number; sample: number; items: TrustItem[] }

export async function trustOf(db: DatabaseService, accountId: string): Promise<{ score: number; sample: number; items: TrustItem[] } | null> {
  const [r] = await db.query<TrustRow>(`SELECT score, sample, items FROM fn_mtr_trust($1::uuid)`, [accountId]);
  if (!r) return null;
  return { score: Number(r.score), sample: Number(r.sample), items: (r.items ?? []).map((x) => ({ ...x, max: Number(x.max), got: Number(x.got) })) };
}

export async function trustRules(db: DatabaseService) {
  return db.query<{ code: string; label: string; points: string; fullAt: string | null; note: string | null; sort: number; updatedAt: string }>(
    `SELECT code, label, points::text, full_at::text AS "fullAt", note, sort, updated_at AS "updatedAt" FROM mtr_trust_rules ORDER BY sort, code`);
}

/** GET /me/mtr/trust — 본인 점수(켜져 있을 때만 · 그 자리에서 셈) */
export async function myTrust(db: DatabaseService, me: string) {
  const s = await mtrSettings(db);
  if (!s.trust) return { on: false, note: '지금은 신뢰 점수를 보여 드리지 않습니다.' };
  const t = await trustOf(db, me);
  const [snap] = await db.query<{ computed_at: Date }>(`SELECT computed_at FROM mtr_trust_scores WHERE account_id = $1`, [me]);
  return {
    on: true, score: t?.score ?? 0, sample: t?.sample ?? 0, items: t?.items ?? [], computedAt: snap?.computed_at ?? null,
    note: '이 점수는 나의공간에서 본인만 봅니다. 매물 노출 순서 · 검색 순서 · 소개비에는 쓰지 않습니다. 칸마다 어떻게 나왔는지 적었습니다.',
  };
}

/** GET /admin/mtr/trust — 켜짐 · 산식 · 분포(10점 칸) · 마지막 셈 */
export async function trustOverview(db: DatabaseService) {
  const s = await mtrSettings(db);
  const dist = await db.query<{ band: number; n: number }>(
    `SELECT least(9, floor(score / 10))::int AS band, count(*)::int AS n FROM mtr_trust_scores GROUP BY 1 ORDER BY 1`);
  const [c] = await db.query<{ n: number; avg: string | null; last: Date | null }>(
    `SELECT count(*)::int AS n, round(avg(score), 1)::text AS avg, max(computed_at) AS last FROM mtr_trust_scores`);
  const bands = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i === 9 ? 100 : i * 10 + 9, n: Number(dist.find((d) => d.band === i)?.n ?? 0) }));
  return {
    on: s.trust, rules: await trustRules(db), bands, counted: Number(c?.n ?? 0), avg: c?.avg == null ? null : Number(c.avg), lastComputedAt: c?.last ?? null,
    note: '운영 · 본인 화면에서만 보는 점수입니다. 매물 노출 순서 · 검색 순서 · 광고 · 소개비 계산에는 쓰지 않습니다.',
  };
}

/** GET /admin/mtr/trust/lookup?email= — 한 사람 그 자리에서 셈(꺼져 있어도 운영은 미리 봄) · 가린 메일 · 이름 첫 글자 */
export async function trustLookup(db: DatabaseService, emailIn: string) {
  const email = String(emailIn ?? '').trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email)) throw new PolicyViolation('MTR_EMAIL', '찾을 이메일을 정확히 넣어 주십시오.');
  const [a] = await db.query<{ id: string; email: string; name: string; status: string; created_at: Date }>(
    `SELECT id::text, email::text, name, status, created_at FROM accounts WHERE email = $1::citext`, [email]);
  if (!a) throw new NotFound('그 이메일의 회원이 없습니다.');
  const t = await trustOf(db, a.id);
  const [snap] = await db.query<{ score: string; computed_at: Date }>(`SELECT score::text, computed_at FROM mtr_trust_scores WHERE account_id = $1::uuid`, [a.id]);
  return {
    accountId: a.id, email: mtrMaskMail(a.email), nameHead: a.name ? `${a.name.slice(0, 1)}*` : '—', status: a.status, joinedAt: a.created_at,
    score: t?.score ?? 0, sample: t?.sample ?? 0, items: t?.items ?? [], snapshot: snap ? { score: Number(snap.score), computedAt: snap.computed_at } : null,
  };
}

/** PUT /admin/mtr/trust/rules(SUPER) — 보낸 칸만 · 부호(인정된 신고만 0 이하) · 범위 -50 ~ 50 · 기준 > 0(응답 속도는 1시간 넘게) */
export async function setTrustRules(db: DatabaseService, actorId: string, d: { rules: Array<{ code: string; points?: number; fullAt?: number }>; reason: string }) {
  mtrText(d.reason, 2, 200, 'MTR_REASON', '사유는 2 ~ 200자입니다.');
  if (!Array.isArray(d.rules) || !d.rules.length || d.rules.length > TRUST_CODES.length) throw new PolicyViolation('MTR_TRUST_RULES', '바꿀 칸을 보내 주십시오.');
  for (const r of d.rules) {
    if (!(TRUST_CODES as readonly string[]).includes(r.code)) throw new PolicyViolation('MTR_TRUST_CODE', '없는 칸입니다.');
    if (r.points !== undefined && r.points !== null) {
      const p = Number(r.points);
      if (!Number.isFinite(p) || p < -50 || p > 50 || Math.round(p * 10) !== p * 10) throw new PolicyViolation('MTR_TRUST_POINTS', '점수는 -50 ~ 50(소수 1자리)입니다.');
      if ((r.code === 'REPORT' && p > 0) || (r.code !== 'REPORT' && p < 0)) throw new PolicyViolation('MTR_TRUST_SIGN', '인정된 신고만 0 이하 · 나머지는 0 이상입니다.');
    }
    if (r.fullAt !== undefined && r.fullAt !== null) {
      const f = Number(r.fullAt);
      if (['BASE', 'IDENTITY', 'BUSINESS'].includes(r.code)) throw new PolicyViolation('MTR_TRUST_FULL', '이 칸에는 기준이 없습니다.');
      if (!Number.isFinite(f) || f <= 0 || f > 99999 || (r.code === 'RESPONSE' && f <= 1)) throw new PolicyViolation('MTR_TRUST_FULL', '기준은 0보다 커야 합니다(응답 속도는 1시간 넘게).');
    }
  }
  await db.transaction(async () => {
    for (const r of d.rules) {
      await db.query(
        `UPDATE mtr_trust_rules SET points = coalesce($2::numeric, points), full_at = coalesce($3::numeric, full_at), updated_by = $4::uuid, updated_at = now() WHERE code = $1`,
        [r.code, r.points ?? null, r.fullAt ?? null, actorId]);
    }
  });
  return { ok: true, rules: await trustRules(db), note: '산식을 바꿨습니다. 다음 하루 셈부터 반영됩니다(본인 화면은 바로).' };
}

/** 매일 · 운영 「지금 셈」 — 최근 1년 로그인한 쓰는 회원 · 오래 전에 센 순 · 많아야 3000 · 40초 예산 */
export async function trustRecompute(db: DatabaseService, force = false) {
  const s = await mtrSettings(db);
  if (!s.trust && !force) return { skipped: 'OFF', computed: 0 };
  const ids = await db.query<{ id: string }>(
    `SELECT a.id::text FROM accounts a LEFT JOIN mtr_trust_scores t ON t.account_id = a.id
      WHERE a.status = 'ACTIVE' AND coalesce(a.last_login_at, a.created_at) > now() - interval '365 days'
        AND (t.computed_at IS NULL OR t.computed_at < now() - interval '20 hours')
      ORDER BY t.computed_at NULLS FIRST, a.id LIMIT $1::int`, [DAILY_BATCH]);
  const t0 = Date.now();
  let computed = 0;
  for (const r of ids) {
    if (Date.now() - t0 > BUDGET_MS) break;
    await db.query(
      `INSERT INTO mtr_trust_scores (account_id, score, sample, items, computed_at)
       SELECT $1::uuid, f.score, f.sample, f.items, now() FROM fn_mtr_trust($1::uuid) f
       ON CONFLICT (account_id) DO UPDATE SET score = EXCLUDED.score, sample = EXCLUDED.sample, items = EXCLUDED.items, computed_at = EXCLUDED.computed_at`, [r.id]);
    computed++;
  }
  return { computed, waiting: ids.length - computed };
}
