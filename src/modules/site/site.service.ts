import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { IntegTestService } from './integ-test.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/**
 * 관 · 메인 운영 (SB-ADM-SIT-* · MAIN-*).
 *
 * 관을 늘리는 것은 되돌리기 어렵습니다 — 업종·검수·정산이 전부 관에 딸립니다.
 * 그래서 만들 때는 비활성으로 시작하고, 여는 것은 별도 조작으로 둡니다.
 */
@Injectable()
export class SiteService {
  constructor(private readonly db: DatabaseService, private readonly integTests: IntegTestService) {}   // v10.144 (D140) LIVE 조건

  gwans() {
    return this.db.query(
      `SELECT g.code, g.name, g.description, g.is_active AS "isActive",
              g.opened_at AS "openedAt", g.sort_order AS "sortOrder",
              (SELECT count(*)::int FROM listings l
                WHERE l.gwan_code = g.code AND l.status='PUBLISHED') AS "publishedListings",
              (SELECT count(*)::int FROM categories c
                WHERE c.gwan_code = g.code AND c.status='APPROVED') AS categories,
              (SELECT count(*)::int FROM review_items r
                WHERE r.gwan_code = g.code AND r.status IN ('QUEUED','IN_PROGRESS'))
                AS "reviewPending",
              /* v10.31 — 시안 「상위」 열 */
              g.parent_code AS "parentCode", pg.name AS "parentName", g.is_hub AS "isHub"
         FROM gwans g LEFT JOIN gwans pg ON pg.code = g.parent_code ORDER BY g.sort_order`);
  }

  async gwan(code: string) {
    const rows = await this.gwans();
    const g = rows.find((x) => (x as { code: string }).code === code);
    if (!g) throw new StateConflict('NOT_FOUND', '없는 관입니다.');
    return g;
  }

  /**
   * 새 관. 비활성으로 만듭니다.
   * 업종·검수 인력·정산 흐름이 준비되기 전에 열면 등록만 쌓이고 노출이 안 됩니다.
   */
  async createGwan(input: { code: string; name: string; description?: string }) {
    const [dup] = await this.db.query<{ code: string }>(
      `SELECT code FROM gwans WHERE code = $1`, [input.code]);
    if (dup) throw new StateConflict('GWAN_EXISTS', '이미 있는 관 코드입니다.');

    const [row] = await this.db.query(
      `INSERT INTO gwans (code, name, description, is_active, sort_order)
       VALUES ($1,$2,$3,false,(SELECT coalesce(max(sort_order),0)+1 FROM gwans))
       RETURNING code, name, is_active AS "isActive"`,
      [input.code, input.name, input.description ?? null]);
    return row;
  }

  /** 비활성으로 바꾸면 등록·노출이 즉시 멈춥니다. 매물은 지우지 않습니다 */
  async updateGwan(code: string, input: {
    name?: string; description?: string; isActive?: boolean; sortOrder?: number;
  }) {
    if (input.isActive === true) {
      // 업종 없이 열면 등록 폼의 선택지가 비어 사용자가 막힙니다
      const [c] = await this.db.query<{ n: string }>(
        `SELECT count(*) AS n FROM categories WHERE gwan_code=$1 AND status='APPROVED'`, [code]);
      if (Number(c.n) === 0) {
        throw new PolicyViolation(
          'NO_APPROVED_CATEGORY',
          '승인된 업종이 없어 관을 열 수 없습니다. 업종을 먼저 승인하십시오.');
      }
    }
    const [row] = await this.db.query(
      `UPDATE gwans
          SET name = coalesce($2, name), description = coalesce($3, description),
              is_active = coalesce($4, is_active), sort_order = coalesce($5, sort_order),
              opened_at = CASE WHEN $4 = true AND opened_at IS NULL THEN now() ELSE opened_at END
        WHERE code = $1
      RETURNING code, name, is_active AS "isActive", opened_at AS "openedAt"`,
      [code, input.name ?? null, input.description ?? null,
       input.isActive ?? null, input.sortOrder ?? null]);
    if (!row) throw new StateConflict('NOT_FOUND', '없는 관입니다.');
    return row;
  }

  /* ── 광고 ── */
  adSlots() {
    return this.db.query(
      `SELECT s.code, s.gwan_code AS "gwanCode", s.name, s.width, s.height,
              s.is_active AS "isActive",
              (SELECT count(*)::int FROM ad_placements p
                WHERE p.slot_code = s.code AND p.status='ACTIVE'
                  AND p.starts_at <= now() AND p.ends_at > now()) AS "activePlacements"
         FROM ad_slots s ORDER BY s.gwan_code NULLS FIRST, s.code`);
  }

  ads() {
    return this.db.query(
      `SELECT p.id, p.slot_code AS "slotCode", b.company_name AS "advertiserName",
              p.image_key AS "imageKey", p.link_url AS "linkUrl",
              p.starts_at AS "startsAt", p.ends_at AS "endsAt", p.status,
              p.impressions, p.clicks
         FROM ad_placements p
         LEFT JOIN businesses b ON b.id = p.advertiser_business_id
        ORDER BY p.starts_at DESC LIMIT 100`);
  }

  async createAd(input: {
    slotCode: string; advertiserBusinessId?: string; imageKey?: string;
    linkUrl?: string; startsAt: string; endsAt: string;
  }) {
    if (new Date(input.endsAt) <= new Date(input.startsAt)) {
      throw new PolicyViolation('INVALID_PERIOD', '종료일이 시작일보다 빠릅니다.');
    }
    const [row] = await this.db.query(
      `INSERT INTO ad_placements
         (slot_code, advertiser_business_id, image_key, link_url, starts_at, ends_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,'SCHEDULED')
       RETURNING id, slot_code AS "slotCode", status`,
      [input.slotCode, input.advertiserBusinessId ?? null, input.imageKey ?? null,
       input.linkUrl ?? null, input.startsAt, input.endsAt]);
    return row;
  }

  /* ── 공지 ── */
  /** 운영 화면 목록 — v10.280 ~ 282 (D211) 상태 · 끝 시각 · 알림 · 잠금 · 고친 기록 수
   *  v10.292 (docs/415) 상태 걸러 보기(status) · 제목 찾기(q · 글자 그대로) · 50줄씩 넘기기(page · 줄마다 total = 걸러진 전체 수)
   *  v10.293 (docs/415) reads(펼쳐 본 회원 수 · notice_reads) · target(볼 수 있는 활동 중 회원 수 — 전체 공개 · 관리자만이면 null) */
  static readonly NOTICE_STATUSES = ['DRAFT', 'SCHEDULED', 'LIVE', 'ENDED', 'TAKEN_DOWN'] as const;
  async adminNotices(o: { gwanCode?: string; status?: string; q?: string; page?: number } = {}) {
    const st = o.status && (SiteService.NOTICE_STATUSES as readonly string[]).includes(o.status) ? o.status : null;
    const q = (o.q ?? '').trim().slice(0, 100) || null;
    const page = Math.max(1, Math.min(1000, Math.floor(Number(o.page) || 1)));
    const rows = await this.db.query<Record<string, any>>(
      `SELECT x.*, count(*) OVER ()::int AS total FROM (
       SELECT n.id, n.gwan_code AS "gwanCode", n.title, n.body,
              n.is_pinned AS "isPinned", n.published_at AS "publishedAt", n.grades,
              n.ends_at AS "endsAt", n.ended_reason AS "endedReason", n.notify,
              n.notified_at AS "notifiedAt", n.notified_count AS "notifiedCount", n.updated_at AS "updatedAt",
              (n.notify AND n.notified_at IS NULL AND coalesce(n.notified_count, 0) > 0) AS "notifying",
              CASE WHEN n.published_at IS NULL THEN 'DRAFT'
                   WHEN n.published_at > now() THEN 'SCHEDULED'
                   WHEN n.ends_at IS NOT NULL AND n.ends_at <= now() THEN (CASE WHEN n.ended_reason IS NULL THEN 'ENDED' ELSE 'TAKEN_DOWN' END)
                   ELSE 'LIVE' END AS status,
              EXISTS (SELECT 1 FROM hlt_rate_schedules r WHERE r.notice_id = n.id OR r.cancel_notice_id = n.id) AS "rateNotice",
              (SELECT count(*)::int FROM notice_revisions v WHERE v.notice_id = n.id) AS revisions,
              (SELECT count(*)::int FROM notice_reads r WHERE r.notice_id = n.id) AS reads
         FROM notices n
        WHERE ($1::text IS NULL OR n.gwan_code = $1 OR n.gwan_code IS NULL)
          AND NOT EXISTS (SELECT 1 FROM ops_board_posts o WHERE o.notice_id = n.id)   -- v10.286 (D213) 운영자 게시판 사본은 목록에서 뺌(게시판 · 첫 화면 「관리자 공지」에서 봄 · 사본이 50줄을 채우지 않게)
       ) x
        WHERE ($2::text IS NULL OR x.status = $2)
          AND ($3::text IS NULL OR strpos(lower(x.title), lower($3)) > 0)
        ORDER BY x."isPinned" DESC, x."publishedAt" DESC NULLS LAST, x.id
        LIMIT 50 OFFSET $4`,
      [o.gwanCode ?? null, st, q, (page - 1) * 50]);
    /* 대상 수 — 같은 등급 묶음은 한 번만 셈(전체 공개가 들거나 관리자만이면 셀 대상 없음) */
    const key = (g: string[]) => [...g].sort().join(',');
    const sets = [...new Set(rows.filter((r) => !(r.grades ?? []).includes('PUBLIC') && (r.grades ?? []).some((g: string) => g !== 'STAFF')).map((r) => key(r.grades)))];
    const tgt = new Map<string, number>();
    for (const k of sets) {
      const [c] = await this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM accounts a WHERE a.status = 'ACTIVE' AND fn_notice_grades(a.id) && array_remove($1::text[], 'STAFF')`, [k.split(',')]);
      tgt.set(k, Number(c?.n ?? 0));
    }
    return rows.map((r) => ({ ...r, target: tgt.has(key(r.grades ?? [])) ? tgt.get(key(r.grades ?? [])) : null, page }));
  }

  /** v10.279 (D210) — 등급 하나 이상 · 쓰지 않는 등급은 새로 고를 수 없음(이미 있던 등급은 그대로 둘 수 있음) */
  private async checkGrades(grades: string[], keep: string[] = []) {
    if (!grades.length) throw new PolicyViolation('GRADE_REQUIRED', '볼 수 있는 등급을 하나 이상 골라 주십시오.');
    const off = await this.db.query<{ name: string }>(
      `SELECT name FROM notice_grades WHERE code = ANY($1::text[]) AND NOT is_active`, [grades.filter((g) => !keep.includes(g))]);
    if (off.length) throw new PolicyViolation('GRADE_INACTIVE', `쓰지 않는 등급입니다 — ${off.map((x) => x.name).join(' · ')}`);
  }

  /** v10.281 (D211) — 알림은 전체 공개 · 관리자만인 공지에는 보내지 않음 */
  private checkNotify(notify: boolean | undefined, grades: string[]) {
    if (!notify) return;
    if (grades.includes('PUBLIC') || !grades.some((g) => g !== 'STAFF')) {
      throw new PolicyViolation('NOTIFY_NO_AUDIENCE', '「전체 공개」 · 「관리자」 등급 공지는 알림을 보내지 않습니다 — 알림을 끄거나 회원 등급을 고르십시오.');
    }
  }

  /** v10.285 (D212) — 받는 사람이 notice.notify_confirm_min 이상이면 확인 문구 「모두에게 알림」 */
  static readonly NOTIFY_CONFIRM = '모두에게 알림';
  private async checkBulk(notify: boolean | undefined, grades: string[], confirm: string | undefined) {
    if (!notify) return;
    const [r] = await this.db.query<{ n: number; min: number }>(
      `SELECT (SELECT count(*)::int FROM fn_notice_audience($1::text[])) AS n,
              coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'notice.notify_confirm_min'), 1000) AS min`, [grades]);
    if (Number(r.n) >= Number(r.min) && (confirm ?? '').trim() !== SiteService.NOTIFY_CONFIRM) {
      throw new PolicyViolation('NOTIFY_CONFIRM_REQUIRED', `알림을 받을 회원이 ${r.n}명입니다(기준 ${r.min}명) — 확인 문구 「${SiteService.NOTIFY_CONFIRM}」을 입력해야 보냅니다.`);
    }
  }

  /** v10.282 (D211) — 끝 시각은 게시 시각(없으면 지금) 뒤 */
  private checkPeriod(publishedAt: string | null | undefined, endsAt: string | null | undefined) {
    if (!endsAt) return;
    const from = publishedAt ? new Date(publishedAt).getTime() : Date.now();
    if (!(new Date(endsAt).getTime() > from)) throw new PolicyViolation('BAD_PERIOD', '끝 날짜는 게시 시각보다 뒤여야 합니다.');
  }

  async createNotice(input: {
    gwanCode?: string; title: string; body: string;
    isPinned?: boolean; publishedAt?: string; grades: string[]; endsAt?: string; notify?: boolean; notifyConfirm?: string;
  }) {
    const grades = [...new Set(input.grades ?? [])];
    await this.checkGrades(grades);
    this.checkNotify(input.notify, grades);
    await this.checkBulk(input.notify, grades, input.notifyConfirm);   // v10.285
    this.checkPeriod(input.publishedAt, input.endsAt);
    const [row] = await this.db.query<{ id: string }>(
      `INSERT INTO notices (gwan_code, title, body, is_pinned, published_at, author_id, grades, ends_at, notify)
       VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9) RETURNING id, title, published_at AS "publishedAt", grades, ends_at AS "endsAt", notify`,
      [input.gwanCode ?? null, input.title, input.body,
       input.isPinned ?? false, input.publishedAt ?? null, RequestCtx.actorId(), grades, input.endsAt ?? null, input.notify ?? false]);
    const notified = await this.notifyNow(row.id);   // v10.281 — 지금 게시면 바로 · 예약이면 정기 작업 notice_schedule
    return { ...row, notified };
  }

  /** v10.281 (D211) — 게시된 · 알림 고른 · 아직 안 보낸 공지면 보냄(아니면 0) */
  private async notifyNow(id: string) {
    const [r] = await this.db.query<{ n: number }>(`SELECT fn_notice_notify($1::uuid) AS n`, [id]);
    return Number(r?.n ?? 0);
  }

  private async lockedRow(id: string) {
    const [n] = await this.db.query<{
      id: string; title: string; body: string; grades: string[]; is_pinned: boolean; gwan_code: string | null;
      published_at: string | null; ends_at: string | null; ended_reason: string | null; notify: boolean; live: boolean; scheduled: boolean; ended: boolean; rate: boolean;
      notified: boolean;
    }>(
      `SELECT n.id, n.title, n.body, n.grades, n.is_pinned, n.gwan_code, n.published_at, n.ends_at, n.ended_reason, n.notify,
              (n.notified_at IS NOT NULL OR coalesce(n.notified_count, 0) > 0) AS notified,
              (n.published_at IS NOT NULL AND n.published_at <= now() AND (n.ends_at IS NULL OR n.ends_at > now())) AS live,
              (n.published_at IS NOT NULL AND n.published_at > now()) AS scheduled,
              (n.published_at IS NOT NULL AND n.published_at <= now() AND n.ends_at IS NOT NULL AND n.ends_at <= now()) AS ended,
              EXISTS (SELECT 1 FROM hlt_rate_schedules r WHERE r.notice_id = n.id OR r.cancel_notice_id = n.id) AS rate
         FROM notices n WHERE n.id::text = $1`, [id]);
    if (!n) throw new NotFound('공지를 찾을 수 없습니다.');
    return n;
  }

  private async revision(id: string, action: 'EDIT' | 'UNPUBLISH' | 'REPUBLISH', before: Record<string, unknown>, reason: string | null) {
    await this.db.query(
      `INSERT INTO notice_revisions (notice_id, action, before, reason, by_account) VALUES ($1, $2, $3::jsonb, $4, $5)`,
      [id, action, JSON.stringify(before), reason, RequestCtx.actorId()]);
  }

  /** v10.279 (D210) 초안 · 예약 공지를 지금 게시 · v10.280 (D211) 내린 · 끝난 공지는 「다시 게시」(끝 시각을 비움 · 기록) */
  async publishNotice(id: string, notifyConfirm?: string) {
    const n = await this.lockedRow(id);
    if (n.live) throw new StateConflict('NOTICE_PUBLISHED', '이미 게시 중인 공지입니다.');
    if (!n.ended) await this.checkBulk(n.notify && !n.notified, n.grades, notifyConfirm);   // v10.285 — 게시하면서 처음 보내는 공지
    if (n.ended) {
      await this.revision(id, 'REPUBLISH', { publishedAt: n.published_at, endsAt: n.ends_at, endedReason: n.ended_reason }, null);
      await this.db.query(
        `UPDATE notices SET published_at = now(), ends_at = NULL, ended_reason = NULL, ended_by = NULL, updated_at = now(), updated_by = $2 WHERE id::text = $1`,
        [id, RequestCtx.actorId()]);
      return { ok: true, note: '공지를 다시 게시했습니다.', notified: 0 };
    }
    await this.db.query(
      `UPDATE notices SET published_at = now(), ends_at = CASE WHEN ends_at IS NOT NULL AND ends_at <= now() THEN NULL ELSE ends_at END WHERE id::text = $1`, [id]);
    const notified = await this.notifyNow(id);
    return { ok: true, note: notified ? `공지를 게시했습니다 — ${notified}명에게 알림을 보냈습니다.` : '공지를 게시했습니다.', notified };
  }

  /** v10.280 (D211) — 공지 고치기(게시 중이면 사유 필수 · 그 전 내용은 기록) · 게시한 요율 공지는 잠금 */
  async updateNotice(id: string, d: { title?: string; body?: string; grades?: string[]; isPinned?: boolean; endsAt?: string | null; notify?: boolean; reason?: string; notifyConfirm?: string }) {
    const n = await this.lockedRow(id);
    const touchesText = d.title !== undefined || d.body !== undefined || d.grades !== undefined || d.endsAt !== undefined;
    if (d.title === undefined && d.body === undefined && d.grades === undefined && d.isPinned === undefined && d.endsAt === undefined && d.notify === undefined) {
      throw new PolicyViolation('NO_CHANGE', '바꿀 것이 없습니다.');
    }
    const published = !!n.published_at && !n.scheduled;
    if (n.rate && published && touchesText) {
      throw new StateConflict('NOTICE_LOCKED', '게시한 수수료율 변경 공지는 고치거나 내릴 수 없습니다 — 입점 약관 제17조 4항 공지 기록입니다(고정만 바꿀 수 있음).');
    }
    const reason = d.reason?.trim() || null;
    if (published && (!reason || reason.length < 2)) throw new PolicyViolation('REASON_REQUIRED', '게시한 공지를 고치는 사유를 적어 주십시오(2자 이상) — 고친 기록에 남습니다.');
    const grades = d.grades ? [...new Set(d.grades)] : n.grades;
    if (d.grades) await this.checkGrades(grades, n.grades);
    if (d.notify !== undefined || d.grades) this.checkNotify(d.notify ?? n.notify, grades);
    if (!n.notified && (d.notify === true || (d.grades && n.notify))) await this.checkBulk(true, grades, d.notifyConfirm);   // v10.285
    if (d.endsAt) this.checkPeriod(n.published_at, d.endsAt);
    await this.revision(id, 'EDIT', { title: n.title, body: n.body, grades: n.grades, isPinned: n.is_pinned, endsAt: n.ends_at, notify: n.notify }, reason);
    await this.db.query(
      `UPDATE notices SET title = coalesce($2, title), body = coalesce($3, body), grades = coalesce($4::text[], grades),
              is_pinned = coalesce($5, is_pinned), ends_at = CASE WHEN $6 THEN $7::timestamptz ELSE ends_at END,
              notify = coalesce($8, notify), updated_at = now(), updated_by = $9
        WHERE id::text = $1`,
      [id, d.title?.trim() ?? null, d.body?.trim() ?? null, d.grades ? grades : null, d.isPinned ?? null,
       d.endsAt !== undefined, d.endsAt ?? null, d.notify ?? null, RequestCtx.actorId()]);
    return { ok: true, note: '공지를 고쳤습니다(전 내용은 고친 기록에 남습니다).' };
  }

  /** v10.280 (D211) — 내리기: 게시 중이면 끝 시각을 지금으로(사유) · 예약이면 초안으로 돌림 · 게시한 요율 공지는 잠금 */
  async unpublishNotice(id: string, reasonIn: string) {
    const n = await this.lockedRow(id);
    if (!n.live && !n.scheduled) throw new StateConflict('NOTICE_NOT_LIVE', '게시 중이거나 예약한 공지만 내릴 수 있습니다.');
    if (n.rate && n.live) throw new StateConflict('NOTICE_LOCKED', '게시한 수수료율 변경 공지는 고치거나 내릴 수 없습니다 — 입점 약관 제17조 4항 공지 기록입니다(고정만 바꿀 수 있음).');
    const reason = reasonIn?.trim();
    if (!reason || reason.length < 2) throw new PolicyViolation('REASON_REQUIRED', '내리는 사유를 적어 주십시오(2자 이상) — 고친 기록에 남습니다.');
    await this.revision(id, 'UNPUBLISH', { publishedAt: n.published_at, endsAt: n.ends_at }, reason);
    if (n.scheduled) {
      await this.db.query(`UPDATE notices SET published_at = NULL, updated_at = now(), updated_by = $2 WHERE id::text = $1`, [id, RequestCtx.actorId()]);
      return { ok: true, note: '예약을 풀어 초안으로 돌렸습니다.' };
    }
    await this.db.query(
      `UPDATE notices SET ends_at = now(), ended_reason = $2, ended_by = $3, updated_at = now(), updated_by = $3 WHERE id::text = $1`,
      [id, reason, RequestCtx.actorId()]);
    return { ok: true, note: '공지를 내렸습니다 — 이제 어디에도 보이지 않습니다(「다시 게시」로 되돌릴 수 있음).' };
  }

  /** v10.280 (D211) — 고친 기록(최근 순) */
  async noticeRevisions(id: string) {
    await this.lockedRow(id);
    return this.db.query(
      `SELECT v.id::text AS id, v.action, v.before, v.reason, v.at, a.name AS "by"
         FROM notice_revisions v LEFT JOIN accounts a ON a.id = v.by_account
        WHERE v.notice_id::text = $1 ORDER BY v.at DESC, v.id DESC LIMIT 50`, [id]);
  }

  /** v10.281 (D211) — 알림 받을 사람 수 미리 보기(fn_notice_audience) */
  async noticeAudience(gradesIn: string[]) {
    const grades = [...new Set(gradesIn)];
    const [r] = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM fn_notice_audience($1::text[])`, [grades]);
    const none = grades.includes('PUBLIC') || !grades.some((g) => g !== 'STAFF');
    const [m] = await this.db.query<{ min: number }>(`SELECT coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'notice.notify_confirm_min'), 1000) AS min`);
    return { count: Number(r?.n ?? 0), sendable: !none, confirmMin: Number(m.min), needsConfirm: !none && Number(r?.n ?? 0) >= Number(m.min), confirmText: SiteService.NOTIFY_CONFIRM,
             note: none ? '「전체 공개」 · 「관리자」 등급 공지는 알림을 보내지 않습니다.' : `알림을 받을 회원 ${Number(r?.n ?? 0)}명(활동 중 · 이 알림을 끄지 않은 분)` };
  }

  /** v10.279 (D210) — 공지 열람 등급(코드 · 규칙 고정) */
  noticeGrades() {
    return this.db.query(
      `SELECT g.code, g.name, g.rule, g.sort_order AS "sortOrder", g.is_active AS "isActive", g.updated_at AS "updatedAt",
              (SELECT count(*)::int FROM notices n WHERE g.code = ANY(n.grades)) AS notices
         FROM notice_grades g ORDER BY g.sort_order, g.code`);
  }

  async patchNoticeGrade(code: string, d: { name?: string; sortOrder?: number; isActive?: boolean }) {
    if (d.name === undefined && d.sortOrder === undefined && d.isActive === undefined) throw new PolicyViolation('NO_CHANGE', '바꿀 것이 없습니다.');
    const rows = await this.db.query<{ code: string }>(
      `UPDATE notice_grades SET name = coalesce($2, name), sort_order = coalesce($3, sort_order), is_active = coalesce($4, is_active),
              updated_by = $5, updated_at = now() WHERE code = $1 RETURNING code`,
      [code, d.name?.trim() ?? null, d.sortOrder ?? null, d.isActive ?? null, RequestCtx.actorId()]);
    if (!rows.length) throw new NotFound('공지 등급을 찾을 수 없습니다.');
    return this.noticeGrades();
  }

  /** v10.279 (D210) — 관리자 공지(STAFF 등급 · 게시된 것 · 최근 20) — 운영 화면 첫 화면 */
  staffNotices() {
    return this.db.query(
      `SELECT id, title, body, is_pinned AS "isPinned", published_at AS "publishedAt", grades
         FROM notices WHERE 'STAFF' = ANY(grades) AND published_at IS NOT NULL AND published_at <= now()
          AND (ends_at IS NULL OR ends_at > now())   -- v10.282 (D211) 끝 · 내린 공지 뺌
        ORDER BY is_pinned DESC, published_at DESC LIMIT 20`);
  }

  /* ── 허브 · 영향 범위 ── */
  async hub() {
    const gwans = await this.gwans();
    const [n] = await this.db.query<Record<string, string>>(
      `SELECT (SELECT count(*) FROM listings WHERE status='PUBLISHED') AS listings,
              (SELECT count(*) FROM deals) AS deals,
              (SELECT count(*) FROM v_open_blockers) AS blockers`);
    return {
      gwans,
      totalListings: Number(n.listings),
      totalDeals: Number(n.deals),
      openBlockers: Number(n.blockers),
    };
  }

  /**
   * 공유 경계 (SB-ADM-SIT-060).
   *
   * 무엇이 전 관에 영향을 주고 무엇이 관별인지 보여 줍니다.
   * 이걸 모르면 한 관 설정을 바꾸다 다른 관을 망가뜨립니다.
   */
  async scope() {
    const rows = await this.db.query<{ key: string; description: string | null; scope: string }>(
      `SELECT key, description, scope FROM site_settings ORDER BY scope, key`);
    return rows.map((r) => ({
      key: r.key,
      description: r.description ?? '',
      scope: r.scope,
      affects: r.scope === 'GLOBAL' ? '모든 관' : '해당 관만',
    }));
  }

  /** 메인 레이아웃. 설정 테이블에 JSON 으로 둡니다 */
  async layout() {
    const [row] = await this.db.query<{ value: string | null }>(
      `SELECT value FROM site_settings WHERE key='main.layout'`);
    const gwans = await this.db.query<{ code: string }>(
      `SELECT code FROM gwans WHERE is_active ORDER BY sort_order`);
    const def = { sections: ['gwan_nav', 'latest', 'notice'], gwanOrder: gwans.map((g) => g.code) };
    if (!row?.value) return def;
    try { return { ...def, ...JSON.parse(row.value) }; } catch { return def; }
  }

  async updateLayout(input: { sections?: string[]; gwanOrder?: string[] }) {
    const cur = await this.layout();
    const next = { ...cur, ...Object.fromEntries(Object.entries(input ?? {}).filter(([, v]) => v !== undefined)) };
    await this.db.query(
      `INSERT INTO site_settings (key, value, scope, description)
       VALUES ('main.layout', $1, 'GLOBAL', '메인 화면 구성')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(next)]);
    return next;
  }

  /* ── 외부 연동 ── */

  /**
   * 연동 현황.
   *
   * 시크릿 값은 여기 없습니다 — Secrets Manager 키 이름과 등록 여부만 봅니다.
   * DB 에 키를 넣으면 백업·복제본에 전부 퍼집니다.
   */
  integrations() {
    return this.db.query(
      `SELECT i.code, i.name, i.purpose, i.provider, i.status,
              coalesce(cl.label, i.status) AS "statusLabel",
              i.requires_ip AS "requiresIp", i.egress_ip AS "egressIp",
              i.ip_requested_at AS "ipRequestedAt", i.ip_approved_at AS "ipApprovedAt",
              i.secret_key_name AS "secretKeyName",
              i.secret_registered AS "secretRegistered",
              i.lead_time_weeks AS "leadTimeWeeks", i.blocks_open AS "blocksOpen",
              i.memo, v.est_weeks_remaining AS "estWeeksRemaining",
              i.applied_at AS "appliedAt", i.key_at AS "keyAt", i.tested_at AS "testedAt", i.live_at AS "liveAt",
              /* v10.235 (docs/375) — 예상일 = 발신 IP 신청일 + 걸리는 기간 · 지났는데 LIVE 가 아니면 overdue */
              to_char((i.ip_requested_at + make_interval(weeks => i.lead_time_weeks)) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS "dueOn",
              (i.status <> 'LIVE' AND i.ip_requested_at + make_interval(weeks => i.lead_time_weeks) < now()) IS TRUE AS overdue
         FROM integrations i
         LEFT JOIN code_labels cl ON cl.domain='integration.status' AND cl.code=i.status
         LEFT JOIN v_integration_status v ON v.code = i.code
        ORDER BY i.sort_order`);
  }

  /* ---------------------------------------------------------------------
   * v10.260 (D205 · docs/392) — 외부 연동 신청 진행표
   *   업종 정정(mall.biz_report_at · 모든 연동 공통) → 신청 → IP 신청 → IP 승인(IP 가 필요한 연동만) → 키 → 시험 → LIVE.
   *   단계마다 날짜(없으면 null) · 지금 단계 · 다음에 할 일. 적은 날짜를 그대로 믿습니다(업체에 확인하지 않음).
   * ------------------------------------------------------------------- */
  async integrationProgress() {
    const [b] = await this.db.query<{ biz: string | null }>(
      `SELECT nullif(trim(coalesce((SELECT value FROM site_settings WHERE key = 'mall.biz_report_at'), '')), '') AS biz`);
    const rows = await this.db.query<{
      code: string; name: string; status: string; requires_ip: boolean; blocks_open: boolean; lead: number | null; provider: string | null;
      applied: string | null; ip_req: string | null; ip_ok: string | null; key_at: string | null; reg: boolean; tested: string | null; live: string | null; due: string | null; overdue: boolean;
    }>(
      `SELECT i.code, i.name, i.status, i.requires_ip, i.blocks_open, i.lead_time_weeks AS lead, i.provider,
              to_char(coalesce(i.applied_at, CASE WHEN NOT i.requires_ip THEN i.ip_requested_at END) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS applied,
              to_char(i.ip_requested_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS ip_req,
              to_char(i.ip_approved_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS ip_ok,
              to_char(i.key_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS key_at, i.secret_registered AS reg,
              to_char(i.tested_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS tested,
              to_char(i.live_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS live,
              to_char((i.ip_requested_at + make_interval(weeks => i.lead_time_weeks)) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS due,
              (i.status <> 'LIVE' AND i.ip_requested_at + make_interval(weeks => i.lead_time_weeks) < now()) IS TRUE AS overdue
         FROM integrations i ORDER BY i.sort_order`);
    const NEXT: Record<string, string> = {
      BIZ: '업종 정정신고 — 새 등록증이 신청서 첨부(docs/227 1절)', APPLY: '업체에 신청(docs/227 3절 신청표)',
      IP_REQ: '업체에 발신 IP 3.37.95.217 등록 신청', IP_OK: '업체 IP 승인 기다림', KEY: '키 받기 → 「연동 키」에 넣기',
      TEST: '운영 화면에서 시험(성공 기록)', LIVE: '방식을 실제로 · 상태 LIVE', DONE: '운영 중',
    };
    const out = rows.map((r) => {
      const steps = [
        { key: 'BIZ', at: b?.biz ?? null, done: !!b?.biz },
        { key: 'APPLY', at: r.applied, done: !!r.applied },
        ...(r.requires_ip ? [{ key: 'IP_REQ', at: r.ip_req, done: !!r.ip_req }, { key: 'IP_OK', at: r.ip_ok, done: !!r.ip_ok }] : []),
        { key: 'KEY', at: r.key_at, done: !!r.key_at || r.reg },
        { key: 'TEST', at: r.tested, done: !!r.tested || r.status === 'LIVE' },
        { key: 'LIVE', at: r.live, done: r.status === 'LIVE' },
      ];
      const now = r.status === 'LIVE' ? 'DONE' : (steps.find((x) => !x.done)?.key ?? 'LIVE');
      return { code: r.code, name: r.name, status: r.status, provider: r.provider, blocksOpen: r.blocks_open, requiresIp: r.requires_ip,
               leadTimeWeeks: r.lead, dueOn: r.due, overdue: r.overdue, steps, now, next: NEXT[now],
               doneSteps: steps.filter((x) => x.done).length, totalSteps: steps.length };
    });
    /* v10.265 (docs/395) — 신청서에 공통으로 적는 값(운영 설정에서 · 비어 있으면 null) */
    const [ap] = await this.db.query<{ company: string | null; biz_no: string | null; ceo: string | null; address: string | null; base_url: string | null; egress_ip: string | null }>(
      `SELECT ${['footer.company_name:company', 'footer.biz_reg_no:biz_no', 'footer.ceo_name:ceo', 'footer.address:address', 'site.base_url:base_url', 'infra.egress_ip:egress_ip']
        .map((x) => { const [k, a] = x.split(':'); return `nullif(trim(coalesce((SELECT value FROM site_settings WHERE key = '${k}'), '')), '') AS ${a}`; }).join(', ')}`);
    return {
      apply: { company: ap?.company ?? null, bizNo: ap?.biz_no ?? null, ceo: ap?.ceo ?? null, address: ap?.address ?? null,
               baseUrl: ap?.base_url ?? null, egressIp: ap?.egress_ip ?? null },
      bizReportAt: b?.biz ?? null,
      summary: { total: out.length, live: out.filter((x) => x.now === 'DONE').length, applied: out.filter((x) => x.steps[1].done).length,
                 blocking: out.filter((x) => x.blocksOpen && x.now !== 'DONE').length, overdue: out.filter((x) => x.overdue).length },
      rows: out,
    };
  }

  async updateIntegration(code: string, input: {
    status?: string; provider?: string; egressIp?: string;
    ipRequestedAt?: string; ipApprovedAt?: string;
    secretRegistered?: boolean; memo?: string;
    appliedAt?: string; keyAt?: string; testedAt?: string; liveAt?: string;
  }) {
    /* v10.144 (D140) — PG · BANK 를 LIVE 로 올릴 때만 최근 7일 성공 시험을 봄(내리기 · 다른 연동은 그대로) */
    if (input.status === 'LIVE') {
      const [cur] = await this.db.query<{ status: string }>(`SELECT status FROM integrations WHERE code = $1`, [code]);
      if (cur && cur.status !== 'LIVE') await this.integTests.assertLiveAllowed(code);
    }
    const [row] = await this.db.query(
      `UPDATE integrations
          SET status = coalesce($2, status),
              provider = coalesce($3, provider),
              egress_ip = coalesce($4, egress_ip),
              ip_requested_at = coalesce($5::timestamptz, ip_requested_at),
              ip_approved_at = coalesce($6::timestamptz, ip_approved_at),
              secret_registered = coalesce($7, secret_registered),
              memo = coalesce($8, memo),
              /* v10.260 (D205) 진행표 날짜 · LIVE 로 바꾸면 live_at 이 비어 있을 때 오늘 */
              applied_at = coalesce($10::timestamptz, applied_at),
              key_at = coalesce($11::timestamptz, key_at),
              tested_at = coalesce($12::timestamptz, tested_at),
              live_at = coalesce($13::timestamptz, live_at, CASE WHEN $2 = 'LIVE' THEN now() END),
              updated_by = $9, updated_at = now()
        WHERE code = $1
      RETURNING code, name, status, egress_ip AS "egressIp"`,
      [code, input.status ?? null, input.provider ?? null, input.egressIp ?? null,
       input.ipRequestedAt ?? null, input.ipApprovedAt ?? null,
       input.secretRegistered ?? null, input.memo ?? null, RequestCtx.actorId(),
       input.appliedAt ?? null, input.keyAt ?? null, input.testedAt ?? null, input.liveAt ?? null]);
    if (!row) throw new StateConflict('NOT_FOUND', '없는 연동입니다.');
    return row;
  }

  /** 발신 IP 는 전 연동이 같은 값을 씁니다. 한 번에 반영합니다 */
  async setEgressIp(ip: string) {
    return this.db.transaction(async () => {
      await this.db.query(
        `UPDATE site_settings SET value = $1, updated_at = now()
          WHERE key = 'infra.egress_ip'`, [ip]);
      const rows = await this.db.query(
        `UPDATE integrations
            SET egress_ip = $1,
                ip_requested_at = coalesce(ip_requested_at, now()),
                status = CASE WHEN status IN ('NOT_STARTED','CONTRACT')
                              THEN 'IP_PENDING' ELSE status END,
                updated_at = now()
          WHERE requires_ip RETURNING code`, [ip]);
      return { egressIp: ip, applied: rows.length };
    });
  }

  /* ── 금칙어 ── */
  bannedWords(severity?: string) {
    return this.db.query(
      `SELECT id, word, match_type AS "matchType", severity,
              gwan_code AS "gwanCode", is_active AS "isActive"
         FROM banned_words
        WHERE ($1::text IS NULL OR severity = $1)
        ORDER BY severity, word`, [severity ?? null]);
  }

  async addBannedWord(input: {
    word: string; matchType?: string; severity: string; gwanCode?: string;
  }) {
    const [row] = await this.db.query(
      `INSERT INTO banned_words (word, match_type, severity, gwan_code, updated_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING
       RETURNING id, word, severity`,
      [input.word, input.matchType ?? 'CONTAINS', input.severity,
       input.gwanCode ?? null, RequestCtx.actorId()]);
    if (!row) throw new StateConflict('WORD_EXISTS', '이미 등록된 금칙어입니다.');
    return row;
  }

  async toggleBannedWord(id: string, isActive: boolean) {
    const [row] = await this.db.query(
      `UPDATE banned_words SET is_active = $2, updated_by = $3, updated_at = now()
        WHERE id = $1 RETURNING id, word, is_active AS "isActive"`,
      [id, isActive, RequestCtx.actorId()]);
    if (!row) throw new StateConflict('NOT_FOUND', '없는 금칙어입니다.');
    return row;
  }

  /* ── 관 관리 ──────────────────────────────────────────────────────
   * 순서와 랜딩을 화면에서 바꿉니다 — 배포가 필요 없습니다. */

  gwanAdmin() {
    return this.db.query(
      `SELECT code, name, "is_active" AS "isActive", "is_hub" AS "isHub",
              "sort_order" AS "sortOrder", categories, listings,
              "is_landing" AS "isLanding",
              /* v10.36 — 신규 가입자 첫 화면(site.landing_new_member)도 함께 돌려 줍니다.
                 전에는 저장은 되는데 화면에 보이지 않아 「저장이 안 된다」로 보였습니다. */
              (code = (SELECT value FROM site_settings WHERE key = 'site.landing_new_member')) AS "isNewMemberLanding"
         FROM v_gwan_admin`);
  }

  /** 순서 일괄 저장. 하나씩 바꾸면 중간에 값이 겹칩니다. */
  async reorderGwans(items: { code: string; sortOrder: number }[]) {
    /* 트리거가 겹침을 막으므로, 한 트랜잭션 안에서 모두 바꿔야
       중간 상태에서 걸리지 않습니다(DEFERRABLE 로 둔 이유). */
    await this.db.transaction(async () => {
      for (const it of items) {
        await this.db.query(`UPDATE gwans SET sort_order = $2 WHERE code = $1`,
                            [it.code, it.sortOrder]);
      }
    });
    return this.gwanAdmin();
  }


  /** 로그인 후 랜딩. 빈 값이면 메인입니다. */
  async setLanding(gwanCode: string | null, forNewMember = false) {
    const key = forNewMember ? 'site.landing_new_member' : 'site.landing_after_login';
    /* 중지된 관을 넣으면 트리거가 막습니다 —
       로그인하자마자 "중지 상태" 화면을 보게 되기 때문입니다. */
    await this.db.query(
      `UPDATE site_settings SET value = $2, updated_at = now() WHERE key = $1`,
      [key, gwanCode ?? '']);
    return { key, value: gwanCode ?? '' };
  }
}
