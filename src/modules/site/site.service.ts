import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { IntegTestService } from './integ-test.service';
import { PolicyViolation, StateConflict } from '../../core/errors';
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
  notices(gwanCode?: string, publishedOnly = true) {
    return this.db.query(
      `SELECT id, gwan_code AS "gwanCode", title, body,
              is_pinned AS "isPinned", published_at AS "publishedAt"
         FROM notices
        WHERE ($1::text IS NULL OR gwan_code = $1 OR gwan_code IS NULL)
          AND ($2 = false OR (published_at IS NOT NULL AND published_at <= now()))
        ORDER BY is_pinned DESC, published_at DESC NULLS LAST LIMIT 50`,
      [gwanCode ?? null, publishedOnly]);
  }

  async createNotice(input: {
    gwanCode?: string; title: string; body: string;
    isPinned?: boolean; publishedAt?: string;
  }) {
    const [row] = await this.db.query(
      `INSERT INTO notices (gwan_code, title, body, is_pinned, published_at, author_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, title, published_at AS "publishedAt"`,
      [input.gwanCode ?? null, input.title, input.body,
       input.isPinned ?? false, input.publishedAt ?? null, RequestCtx.actorId()]);
    return row;
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
