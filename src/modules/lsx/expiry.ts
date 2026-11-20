import { DatabaseService } from '../../db/database.service';
import { ReviewRepository } from '../review/review.repository';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { EXPIRY_MAX_MONTHS, EXPIRY_MONTHS, YMD_RE, kstYmd, lsxSettings, needReason, ownListing, UUID_RE } from './common';

/* ---------------------------------------------------------------------
 * v10.514 (D276 · docs/652) 매물 만료 · 연장 — 대표 결정 11/20 「매물 만료는 관리자가 지정한다. 등록 확정 시 기간을 지정, 기본은 6개월.」
 *   ① 게시 확정(검수 승인)하는 그 단계에서 운영자가 만료일을 정함 — 1 · 3 · 6 · 12개월 · 직접 날짜 · 안 보내면 기본(lsx.expiry_default_months · 처음 6)
 *      · 자동 승인 · 다른 길로 게시되어도 DB 트리거(trg_lsx_expiry_default)가 기본 기간으로 채움(옛 승인 흐름 · 옛 시험 그대로)
 *      · 다시 게시할 때 남은 만료일이 있으면 그대로(고쳐서 재검수해도 기간이 늘지 않음 — 운영자가 승인 칸에서 바꾸면 그 값)
 *   ② 만료일은 매물 줄이 아니라 lsx_listing_expiry(매물마다 한 줄) — listings 의 UPDATE 트리거 11개를 건드리지 않으려고
 *   ③ 만료 예고 알림(lsx.expiry_warn_days · 처음 7일 전) · 연장은 운영자만(날짜 바꾸기 · 사유 · 감사) · 회원은 「연장 요청」만 · 만료되면 내림(ARCHIVED · 지우지 않음)
 *   ④ 스위치 lsx.expiry 가 꺼져 있으면 예고 · 내림을 하지 않고 날짜만 저장 · 표시
 *   ⑤ 대표 결정 11/20 — 만료 매물을 운영자가 연장해 다시 게시할 때 「내용이 바뀌었을 때만 검수」: 내릴 때 내용 지문(fn_lsx_listing_fp → expired_fp ·
 *      없으면 연장 요청 때 req_fp)과 지금 지문이 같으면 바로 게시, 다르거나 모르면 기존 검수 흐름(IN_REVIEW + ReviewRepository.enqueue)으로 · 회원이 이미 고쳐
 *      재검수 중(IN_REVIEW)이면 날짜만 바꾸고 검수 결과를 따름
 * ------------------------------------------------------------------- */

/** 검수 승인 · 연장 칸 → 만료 시각(ISO) · 둘 다 없으면 null(기본 기간) */
export function expiryFrom(months?: number | null, ymd?: string | null, base: Date = new Date()): string | null {
  if (ymd) {
    if (!YMD_RE.test(ymd)) throw new PolicyViolation('LSX_EXPIRY_RANGE', '만료일은 YYYY-MM-DD 로 적어 주십시오.');
    /* 그 날 끝(한국 23:59:59)까지 */
    const at = new Date(`${ymd}T23:59:59+09:00`);
    if (Number.isNaN(at.getTime())) throw new PolicyViolation('LSX_EXPIRY_RANGE', '만료일은 YYYY-MM-DD 로 적어 주십시오.');
    const max = new Date(base); max.setMonth(max.getMonth() + EXPIRY_MAX_MONTHS);
    if (at.getTime() <= Date.now()) throw new PolicyViolation('LSX_EXPIRY_RANGE', '만료일은 오늘 뒤여야 합니다.');
    if (at.getTime() > max.getTime()) throw new PolicyViolation('LSX_EXPIRY_RANGE', `만료일은 ${EXPIRY_MAX_MONTHS}개월 안으로 정해 주십시오.`);
    return at.toISOString();
  }
  if (months !== undefined && months !== null) {
    if (!(EXPIRY_MONTHS as readonly number[]).includes(Number(months))) throw new PolicyViolation('LSX_EXPIRY_RANGE', '기간은 1 · 3 · 6 · 12개월 중 하나입니다.');
    const at = new Date(base); at.setMonth(at.getMonth() + Number(months));
    return at.toISOString();
  }
  return null;
}

/**
 * 검수 승인 때 부름(review.service decide · 같은 트랜잭션) — 트리거가 이미 기본 기간으로 채운 줄을
 *   운영자가 고른 값으로 바꾸고 set_kind = REVIEW · set_by = 검수자. 고르지 않았으면 기본 기간 그대로 두되 REVIEW 로 표시.
 *   값이 틀리면 422 → 승인 전체가 되돌아감.
 */
export async function lsxApplyDecideExpiry(db: DatabaseService, listingId: string, actorId: string,
                                           d: { expiryMonths?: number; expiresOn?: string }) {
  const at = expiryFrom(d.expiryMonths, d.expiresOn);
  const [cur] = await db.query<{ expires_at: string }>(`SELECT expires_at FROM lsx_listing_expiry WHERE listing_id = $1`, [listingId]);
  if (!at) {
    if (cur) await db.query(`UPDATE lsx_listing_expiry SET set_kind = 'REVIEW', set_by = $2 WHERE listing_id = $1 AND set_kind = 'DEFAULT'`, [listingId, actorId]);
    return { expiresAt: cur?.expires_at ?? null, chosen: false };
  }
  await db.query(
    `INSERT INTO lsx_listing_expiry (listing_id, expires_at, set_kind, set_by, set_at)
     VALUES ($1, $2::timestamptz, 'REVIEW', $3, now())
     ON CONFLICT (listing_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, set_kind = 'REVIEW', set_by = EXCLUDED.set_by,
                                            set_at = now(), warned_for = NULL, expired_at = NULL`, [listingId, at, actorId]);
  await db.query(
    `INSERT INTO lsx_expiry_log (listing_id, kind, old_at, new_at, set_kind, actor_id, reason)
     VALUES ($1, 'SET', $2::timestamptz, $3::timestamptz, 'REVIEW', $4, $5)`,
    [listingId, cur?.expires_at ?? null, at, actorId, d.expiresOn ? `검수 승인 — 직접 날짜 ${d.expiresOn}` : `검수 승인 — ${d.expiryMonths}개월`]);
  return { expiresAt: at, chosen: true };
}

/** 운영 화면 — 승인 칸의 처음 값(기본 개월) · 고를 수 있는 기간 */
export async function expiryChoices(db: DatabaseService) {
  const s = await lsxSettings(db);
  return { defaultMonths: s.expiryDefaultMonths, months: EXPIRY_MONTHS, maxMonths: EXPIRY_MAX_MONTHS, on: s.expiry, warnDays: s.expiryWarnDays };
}

/* ── 운영 ── */
export const EXPIRY_VIEWS = ['SOON', 'PAST', 'EXPIRED', 'REQUESTS', 'ALL'] as const;

export async function adminExpiryList(db: DatabaseService, view = 'SOON', q?: string) {
  const s = await lsxSettings(db);
  const v = (EXPIRY_VIEWS as readonly string[]).includes(view) ? view : 'SOON';
  const kw = String(q ?? '').trim().slice(0, 60) || null;
  if (v === 'REQUESTS') {
    const rows = await db.query(
      `SELECT r.id::text, r.listing_id::text AS "listingId", l.title, l.listing_no AS "listingNo", l.status, r.months, r.note, r.state,
              r.created_at AS "createdAt", e.expires_at AS "expiresAt", e.expired_at AS "expiredAt"
         FROM lsx_extend_requests r JOIN listings l ON l.id = r.listing_id LEFT JOIN lsx_listing_expiry e ON e.listing_id = r.listing_id
        WHERE r.state = 'REQUESTED' AND ($1::text IS NULL OR l.title ILIKE '%' || $1 || '%')
        ORDER BY r.created_at LIMIT 200`, [kw]);
    return { view: v, settings: { on: s.expiry, warnDays: s.expiryWarnDays, defaultMonths: s.expiryDefaultMonths }, rows };
  }
  const rows = await db.query(
    `SELECT l.id::text AS "listingId", l.title, l.listing_no AS "listingNo", l.status, l.gwan_code AS "gwanCode",
            e.expires_at AS "expiresAt", e.set_kind AS "setKind", e.set_at AS "setAt", e.warned_for AS "warnedFor", e.expired_at AS "expiredAt",
            (SELECT r.id::text FROM lsx_extend_requests r WHERE r.listing_id = l.id AND r.state = 'REQUESTED') AS "openRequest"
       FROM lsx_listing_expiry e JOIN listings l ON l.id = e.listing_id
      WHERE (($3::text = 'SOON' AND l.status = 'PUBLISHED' AND e.expires_at > now() AND e.expires_at <= now() + make_interval(days => $2::int))
          OR ($3::text = 'PAST' AND l.status = 'PUBLISHED' AND e.expires_at <= now())
          OR ($3::text = 'EXPIRED' AND e.expired_at IS NOT NULL AND l.status IN ('ARCHIVED', 'IN_REVIEW'))
          OR ($3::text = 'ALL' AND l.status IN ('PUBLISHED', 'ARCHIVED')))
        AND ($1::text IS NULL OR l.title ILIKE '%' || $1 || '%')
      ORDER BY e.expires_at LIMIT 300`, [kw, s.expiryWarnDays, v]);
  return { view: v, settings: { on: s.expiry, warnDays: s.expiryWarnDays, defaultMonths: s.expiryDefaultMonths }, rows };
}

/** 운영자가 만료일 바꾸기(연장 · 줄이기) · 만료로 내린 매물은 restore 면 다시 게시 */
export async function adminSetExpiry(db: DatabaseService, listingId: string, actorId: string,
                                     d: { months?: number; expiresOn?: string; reason?: string; restore?: boolean }, kind: 'ADMIN' | 'EXTEND' = 'ADMIN') {
  if (!UUID_RE.test(listingId)) throw new NotFound('매물을 찾을 수 없습니다.');
  const reason = needReason(d.reason);
  const [l] = await db.query<{ id: string; title: string; status: string; owner: string }>(
    `SELECT id::text, title, status, owner_account_id::text AS owner FROM listings WHERE id = $1`, [listingId]);
  if (!l) throw new NotFound('매물을 찾을 수 없습니다.');
  const [cur] = await db.query<{ expires_at: string; expired_at: string | null; expired_fp: string | null }>(
    `SELECT expires_at, expired_at, expired_fp FROM lsx_listing_expiry WHERE listing_id = $1`, [listingId]);
  const base = cur && new Date(cur.expires_at).getTime() > Date.now() && !d.expiresOn ? new Date(cur.expires_at) : new Date();
  const at = expiryFrom(d.months, d.expiresOn, base);
  if (!at) throw new PolicyViolation('LSX_EXPIRY_RANGE', '기간(개월) 또는 날짜를 넣어 주십시오.');
  const wantRestore = d.restore === true;
  if (wantRestore && !(['ARCHIVED', 'IN_REVIEW'].includes(l.status) && cur?.expired_at)) {
    throw new StateConflict('LSX_NOT_EXPIRED', '만료로 내린 매물만 다시 올릴 수 있습니다.');
  }
  if (!wantRestore && !['PUBLISHED', 'ARCHIVED', 'IN_REVIEW', 'SUSPENDED'].includes(l.status)) {
    throw new StateConflict('LSX_EXPIRY_STATE', '지금 상태에서는 만료일을 바꿀 수 없습니다.');
  }
  return db.transaction(async () => {
    await db.query(
      `INSERT INTO lsx_listing_expiry (listing_id, expires_at, set_kind, set_by, set_at)
       VALUES ($1, $2::timestamptz, $3, $4, now())
       ON CONFLICT (listing_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, set_kind = EXCLUDED.set_kind, set_by = EXCLUDED.set_by,
                                              set_at = now(), warned_for = NULL`, [listingId, at, kind, actorId]);
    await db.query(
      `INSERT INTO lsx_expiry_log (listing_id, kind, old_at, new_at, set_kind, actor_id, reason) VALUES ($1, 'SET', $2::timestamptz, $3::timestamptz, $4, $5, $6)`,
      [listingId, cur?.expires_at ?? null, at, kind, actorId, reason]);
    let restored = false, queued = false, reviewId: string | null = null;
    if (wantRestore && l.status === 'IN_REVIEW') {
      /* 회원이 만료 뒤 고쳐 이미 재검수 중 — 날짜만 바꾸고 검수 결과를 따름(승인되면 남은 날짜로 게시) */
      queued = true;
    } else if (wantRestore) {
      const [fp] = await db.query<{ now_fp: string | null; req_fp: string | null }>(
        `SELECT fn_lsx_listing_fp($1) AS now_fp,
                (SELECT r.req_fp FROM lsx_extend_requests r WHERE r.listing_id = $1 AND r.req_fp IS NOT NULL ORDER BY r.id DESC LIMIT 1) AS req_fp`, [listingId]);
      const baseFp = cur?.expired_fp ?? fp?.req_fp ?? null;
      if (baseFp && fp?.now_fp === baseFp) {
        /* 내용 그대로(전에 승인됨) — 바로 게시 · 날짜를 먼저 바꿔 두어 게시 트리거가 기본 기간으로 덮지 않음 */
        const r = await db.query(`UPDATE listings SET status = 'PUBLISHED' WHERE id = $1 AND status = 'ARCHIVED' RETURNING id`, [listingId]);
        restored = r.length > 0;
        if (restored) {
          await db.query(`UPDATE lsx_listing_expiry SET expired_at = NULL, expired_fp = NULL WHERE listing_id = $1`, [listingId]);
          await db.query(`INSERT INTO lsx_expiry_log (listing_id, kind, new_at, actor_id, reason) VALUES ($1, 'RESTORE', $2::timestamptz, $3, $4)`,
            [listingId, at, actorId, reason]);
        }
      } else {
        /* 내용이 바뀌었거나 견줄 지문이 없음 — 기존 검수 흐름(검수 대기 · 자동검수 · 사람 검수 그대로) */
        const r = await db.query<{ gwan_code: string }>(`UPDATE listings SET status = 'IN_REVIEW' WHERE id = $1 AND status = 'ARCHIVED' RETURNING gwan_code`, [listingId]);
        if (r.length) {
          reviewId = await new ReviewRepository(db).enqueue({ targetType: 'LISTING', targetId: listingId, gwanCode: r[0]!.gwan_code, submittedBy: l.owner });
          queued = true;
          await db.query(`INSERT INTO lsx_expiry_log (listing_id, kind, new_at, actor_id, reason) VALUES ($1, 'QUEUED', $2::timestamptz, $3, $4)`,
            [listingId, at, actorId, `내용이 바뀌어 검수 대기 — ${reason}`.slice(0, 300)]);
          const [after] = await db.query<{ status: string }>(`SELECT status FROM listings WHERE id = $1`, [listingId]);
          restored = after?.status === 'PUBLISHED';   // 자동검수가 바로 승인한 경우
        }
      }
    }
    return { ok: true, listingId, expiresAt: at, restored, queued, reviewId, title: l.title, owner: l.owner };
  });
}

/** 지난 날짜 모두 오늘 + N일(스위치를 처음 켜기 전 한꺼번에 내려가지 않게 · SUPER) */
export async function adminGrace(db: DatabaseService, actorId: string, d: { days?: number; reason?: string }) {
  const reason = needReason(d.reason);
  const days = Number(d.days);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new PolicyViolation('LSX_EXPIRY_RANGE', '유예 일수는 1 ~ 90일입니다.');
  return db.transaction(async () => {
    const rows = await db.query<{ listing_id: string; old_at: string; new_at: string }>(
      `WITH t AS (
         SELECT e.listing_id, e.expires_at AS old_at FROM lsx_listing_expiry e JOIN listings l ON l.id = e.listing_id
          WHERE l.status = 'PUBLISHED' AND e.expires_at <= now() + make_interval(days => $1::int) FOR UPDATE OF e)
       UPDATE lsx_listing_expiry e SET expires_at = now() + make_interval(days => $1::int), set_kind = 'GRACE', set_by = $2, set_at = now(), warned_for = NULL
         FROM t WHERE e.listing_id = t.listing_id
       RETURNING e.listing_id::text, t.old_at, e.expires_at AS new_at`, [days, actorId]);
    for (const r of rows) {
      await db.query(`INSERT INTO lsx_expiry_log (listing_id, kind, old_at, new_at, set_kind, actor_id, reason) VALUES ($1, 'SET', $2, $3, 'GRACE', $4, $5)`,
        [r.listing_id, r.old_at, r.new_at, actorId, reason]);
    }
    return { ok: true, moved: rows.length, days };
  });
}

/* ── 회원 「연장 요청」 ── */
export async function requestExtend(db: DatabaseService, me: string, listingId: string, d: { months?: number; note?: string }) {
  const l = await ownListing(db, listingId, me);
  const months = Number(d.months);
  if (!(EXPIRY_MONTHS as readonly number[]).includes(months)) throw new PolicyViolation('LSX_EXPIRY_RANGE', '기간은 1 · 3 · 6 · 12개월 중 하나입니다.');
  const note = d.note === undefined ? null : String(d.note).replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  const [e] = await db.query<{ expired_at: string | null }>(`SELECT expired_at FROM lsx_listing_expiry WHERE listing_id = $1`, [listingId]);
  if (!e) throw new StateConflict('LSX_NO_EXPIRY', '만료일이 정해지지 않은 매물입니다.');
  if (!(l.status === 'PUBLISHED' || (['ARCHIVED', 'IN_REVIEW'].includes(l.status) && e.expired_at))) {
    throw new StateConflict('LSX_EXTEND_STATE', '노출 중이거나 만료로 내린 매물만 연장을 요청할 수 있습니다.');
  }
  const [open] = await db.query(`SELECT 1 FROM lsx_extend_requests WHERE listing_id = $1 AND state = 'REQUESTED'`, [listingId]);
  if (open) throw new StateConflict('LSX_EXTEND_OPEN', '이미 연장을 요청했습니다. 운영자 확인을 기다려 주십시오.');
  const [r] = await db.query<{ id: string }>(
    `INSERT INTO lsx_extend_requests (listing_id, account_id, months, note, req_fp) VALUES ($1, $2, $3, $4, fn_lsx_listing_fp($1)) RETURNING id::text`, [listingId, me, months, note]);
  return { ok: true, requestId: Number(r!.id), note: '연장을 요청했습니다. 운영자가 확인한 뒤 알려 드립니다.' };
}

/** 운영자 — 연장 요청 승인(새 만료일 · 만료로 내린 것은 다시 게시) · 반려(사유) */
export async function decideExtend(db: DatabaseService, actorId: string, id: number,
                                   d: { approve?: boolean; months?: number; expiresOn?: string; reason?: string }) {
  const [r] = await db.query<{ id: string; listing_id: string; account_id: string; months: number; state: string }>(
    `SELECT id::text, listing_id::text, account_id::text, months, state FROM lsx_extend_requests WHERE id = $1`, [id]);
  if (!r) throw new NotFound('연장 요청을 찾을 수 없습니다.');
  if (r.state !== 'REQUESTED') throw new StateConflict('LSX_EXTEND_DONE', '이미 처리한 연장 요청입니다.');
  const reason = needReason(d.reason);
  if (d.approve === true) {
    const [l] = await db.query<{ status: string }>(`SELECT status FROM listings WHERE id = $1`, [r.listing_id]);
    const [e] = await db.query<{ expired_at: string | null }>(`SELECT expired_at FROM lsx_listing_expiry WHERE listing_id = $1`, [r.listing_id]);
    const restore = ['ARCHIVED', 'IN_REVIEW'].includes(l?.status ?? '') && !!e?.expired_at;
    const out = await adminSetExpiry(db, r.listing_id, actorId,
      { months: d.expiresOn ? undefined : (d.months ?? r.months), expiresOn: d.expiresOn, reason, restore }, 'EXTEND');
    await db.query(
      `UPDATE lsx_extend_requests SET state = 'APPROVED', decided_by = $2, decided_at = now(), decide_reason = $3, new_expires_at = $4::timestamptz
        WHERE id = $1 AND state = 'REQUESTED'`, [id, actorId, reason, out.expiresAt]);
    await db.query(`SELECT fn_notify($1::uuid, 'LSX_EXTEND_OK', jsonb_build_object('title', $2::text, 'date', $3::text), '/my/listing-tools')`,
      [r.account_id, out.title, kstYmd(out.expiresAt)]);
    return { ok: true, state: 'APPROVED', expiresAt: out.expiresAt, restored: out.restored, queued: out.queued };
  }
  if (d.approve === false) {
    const [t] = await db.query<{ title: string }>(`SELECT title FROM listings WHERE id = $1`, [r.listing_id]);
    await db.query(`UPDATE lsx_extend_requests SET state = 'REJECTED', decided_by = $2, decided_at = now(), decide_reason = $3 WHERE id = $1 AND state = 'REQUESTED'`,
      [id, actorId, reason]);
    await db.query(`SELECT fn_notify($1::uuid, 'LSX_EXTEND_NO', jsonb_build_object('title', $2::text, 'reason', $3::text), '/my/listing-tools')`,
      [r.account_id, t?.title ?? '', reason]);
    return { ok: true, state: 'REJECTED' };
  }
  throw new PolicyViolation('LSX_DECIDE', '승인(approve: true) 또는 반려(approve: false)를 골라 주십시오.');
}

/* ── 정기 작업(lsx_daily 08:10) — 스위치 lsx.expiry on 일 때만 ── */
export async function expiryJob(db: DatabaseService, limit = 500) {
  const s = await lsxSettings(db);
  if (!s.expiry) return { skipped: 'OFF', warned: 0, expired: 0, failed: 0 };
  /* 예고 — 만료일마다 한 번(warned_for = 그 만료일) */
  const soon = await db.query<{ listing_id: string; expires_at: string; owner: string; title: string }>(
    `SELECT e.listing_id::text, e.expires_at, l.owner_account_id::text AS owner, l.title
       FROM lsx_listing_expiry e JOIN listings l ON l.id = e.listing_id
      WHERE l.status = 'PUBLISHED' AND e.expires_at > now() AND e.expires_at <= now() + make_interval(days => $1::int)
        AND e.warned_for IS DISTINCT FROM e.expires_at
      ORDER BY e.expires_at LIMIT $2`, [s.expiryWarnDays, limit]);
  let warned = 0;
  for (const w of soon) {
    await db.transaction(async () => {
      const u = await db.query(`UPDATE lsx_listing_expiry SET warned_for = expires_at WHERE listing_id = $1 AND expires_at = $2::timestamptz RETURNING 1`, [w.listing_id, w.expires_at]);
      if (!u.length) return;
      await db.query(`INSERT INTO lsx_expiry_log (listing_id, kind, new_at) VALUES ($1, 'WARN', $2::timestamptz)`, [w.listing_id, w.expires_at]);
      await db.query(`SELECT fn_notify($1::uuid, 'LSX_EXPIRY_SOON', jsonb_build_object('title', $2::text, 'date', $3::text), '/my/listing-tools')`,
        [w.owner, w.title, kstYmd(w.expires_at)]);
      warned++;
    });
  }
  /* 내림 — 만료일 지난 게시 매물 · 한 건씩(다른 매물 트리거 오류가 전체를 막지 않게) */
  const due = await db.query<{ listing_id: string; owner: string; title: string }>(
    `SELECT e.listing_id::text, l.owner_account_id::text AS owner, l.title
       FROM lsx_listing_expiry e JOIN listings l ON l.id = e.listing_id
      WHERE l.status = 'PUBLISHED' AND e.expires_at <= now() ORDER BY e.expires_at LIMIT $1`, [limit]);
  let expired = 0, failed = 0;
  for (const x of due) {
    try {
      await db.transaction(async () => {
        const r = await db.query(`UPDATE listings SET status = 'ARCHIVED' WHERE id = $1 AND status = 'PUBLISHED' RETURNING id`, [x.listing_id]);
        if (!r.length) return;
        await db.query(`UPDATE lsx_listing_expiry SET expired_at = now(), expired_fp = fn_lsx_listing_fp(listing_id) WHERE listing_id = $1`, [x.listing_id]);
        await db.query(`DELETE FROM lsx_bump_live WHERE listing_id = $1`, [x.listing_id]);
        await db.query(`INSERT INTO lsx_expiry_log (listing_id, kind, reason) VALUES ($1, 'EXPIRED', '만료일 지남 — 내림(지우지 않음)')`, [x.listing_id]);
        await db.query(`SELECT fn_notify($1::uuid, 'LSX_EXPIRED', jsonb_build_object('title', $2::text), '/my/listing-tools')`, [x.owner, x.title]);
        expired++;
      });
    } catch (e: any) {
      failed++;
      await db.query(`INSERT INTO lsx_expiry_log (listing_id, kind, reason) VALUES ($1, 'FAIL', $2)`,
        [x.listing_id, `내리지 못함: ${String(e?.message ?? e).slice(0, 200)}`]).catch(() => undefined);
    }
  }
  if (expired >= 50 || failed > 0) {
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       VALUES ('LSX_EXPIRE_BATCH', 'WARN', $1, $2::jsonb, clock_timestamp()) ON CONFLICT DO NOTHING`,
      [`매물 만료 — 오늘 내림 ${expired}건 · 실패 ${failed}건`, JSON.stringify({ expired, failed })]).catch(() => undefined);
  }
  return { warned, expired, failed };
}

/** 회원 화면 — 내 매물의 만료 · 연장 요청 상태(매물 관리 도구가 씀) */
export async function myExpiryRows(db: DatabaseService, me: string) {
  return db.query<{ listingId: string; expiresAt: string | null; expiredAt: string | null; setKind: string | null; requestState: string | null; requestMonths: number | null; rejectReason: string | null }>(
    `SELECT l.id::text AS "listingId", e.expires_at AS "expiresAt", e.expired_at AS "expiredAt", e.set_kind AS "setKind",
            rq.state AS "requestState", rq.months AS "requestMonths", CASE WHEN rq.state = 'REJECTED' THEN rq.decide_reason END AS "rejectReason"
       FROM listings l
       LEFT JOIN lsx_listing_expiry e ON e.listing_id = l.id
       LEFT JOIN LATERAL (SELECT state, months, decide_reason FROM lsx_extend_requests r WHERE r.listing_id = l.id ORDER BY r.id DESC LIMIT 1) rq ON true
      WHERE l.owner_account_id = $1`, [me]);
}
