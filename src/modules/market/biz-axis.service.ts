import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PartnerActorService } from '../partner/partner-actor.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

const KINDS = ['JOB', 'SVC', 'POL', 'EDU'] as const;
type Kind = typeof KINDS[number];

/**
 * v10.31 (w2) — 소개창업 축(인력 · 운영지원 · 정보)과 정책 원문.
 *
 *   인력(JOB)   도급으로만 · 개인 노출 없음 — 인증 사업자가 올리는 공고. 「업체 소개 요청」(JOB_INTRO) · 「빠른 매칭」.
 *   운영지원(SVC) 창업 컨설팅 · 회사 운영 자문 — 인증 사업자가 올리고 「견적 요청」(SVC_QUOTE)을 받습니다.
 *   정보(POL · EDU) 정책 소개 · 창업 교육 — 운영이 올립니다. 소개비 구조 밖(거래 없음).
 * 숫자(대금 · 요금 · 한도 · 수강료)는 올린 사람이 적은 글 그대로입니다 — 플랫폼이 계산하지 않습니다.
 */
@Injectable()
export class BizAxisService {
  constructor(private readonly db: DatabaseService, private readonly actors: PartnerActorService) {}

  private readonly ITEM = `
    i.id, i.item_no AS "no", i.kind, i.badge, i.is_hot AS hot, i.title, i.price_text AS price, i.cond_text AS cond,
    i.sub_text AS sub, i.org, i.region_text AS region, i.headcount, i.period_text AS period,
    to_char(i.due_date, 'YYYY-MM-DD') AS due,
    CASE WHEN i.due_date IS NULL THEN NULL ELSE (i.due_date - (now() AT TIME ZONE 'Asia/Seoul')::date) END AS "dDay",
    i.is_sample AS sample, i.status, coalesce(b.company_name, '소개뱅크') AS "postedBy",
    (SELECT count(*)::int FROM biz_axis_requests q WHERE q.item_id = i.id) AS "requestCount"`;

  private kind(k: string): Kind {
    const v = String(k ?? '').toUpperCase();
    if (!(KINDS as readonly string[]).includes(v)) throw new NotFound('없는 축입니다.');
    return v as Kind;
  }

  /** 축 목록 — hot=1 이면 초단기(마감 임박) 공고만 · mine=1 이면 내가 소개/견적을 요청한 것(시안 「지원」 갈래) */
  async list(kind0: string, q: { hot?: string; mine?: string; limit?: number }) {
    const kind = this.kind(kind0);
    const me = RequestCtx.actorId() ?? null;
    const lim = Math.min(Math.max(Number(q.limit) || 20, 1), 50);
    if (q.mine === '1' && !me) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
    const rows = await this.db.query(
      `SELECT ${this.ITEM},
              (SELECT jsonb_build_object('status', q.status, 'at', q.created_at) FROM biz_axis_requests q
                WHERE q.item_id = i.id AND q.requester_id = $2::uuid) AS "myRequest"
         FROM biz_axis_items i LEFT JOIN businesses b ON b.id = i.business_id
        WHERE i.kind = $1 AND i.status = 'PUBLISHED'
          AND (i.due_date IS NULL OR i.due_date >= (now() AT TIME ZONE 'Asia/Seoul')::date)
          AND ($3::boolean IS NOT TRUE OR i.is_hot)
          AND ($4::boolean IS NOT TRUE OR EXISTS (SELECT 1 FROM biz_axis_requests q WHERE q.item_id = i.id AND q.requester_id = $2::uuid))
        ORDER BY i.is_hot DESC, i.due_date NULLS LAST, i.created_at DESC LIMIT $5`,
      [kind, me, q.hot === '1', q.mine === '1', lim]);
    return { kind, items: rows };
  }

  async detail(kind0: string, no: number) {
    const kind = this.kind(kind0);
    const me = RequestCtx.actorId() ?? null;
    const [row] = await this.db.query<any>(
      `SELECT ${this.ITEM}, i.description, i.spec, i.contract_type AS "contractType",
              (i.owner_account_id = $3::uuid) AS mine,
              (SELECT jsonb_build_object('status', q.status, 'at', q.created_at, 'answer', q.answer) FROM biz_axis_requests q
                WHERE q.item_id = i.id AND q.requester_id = $3::uuid) AS "myRequest",
              CASE WHEN i.kind = 'POL' THEN (i.source_url IS NOT NULL OR i.source_title IS NOT NULL) END AS "hasSource"
         FROM biz_axis_items i LEFT JOIN businesses b ON b.id = i.business_id
        WHERE i.kind = $1 AND i.item_no = $2 AND (i.status = 'PUBLISHED' OR i.owner_account_id = $3::uuid)`, [kind, no, me]);
    if (!row) throw new NotFound('항목을 찾을 수 없습니다.');
    return row;
  }

  /** 정책 원문(SB-BIZ-POL-030) — 공고명 · 주관 기관 · 지원 규모 · 신청 기한 · 원문 주소 · 지원 내용 표 */
  async policySource(no: number) {
    const [row] = await this.db.query<any>(
      `SELECT i.item_no AS "no", i.title, i.org, coalesce(i.source_title, i.title) AS "sourceTitle",
              coalesce(i.source_org, i.org) AS "sourceOrg", i.source_scale AS scale, i.price_text AS "limit",
              to_char(i.due_date, 'YYYY-MM-DD') AS due, i.source_url AS url, i.source_rows AS rows, i.is_sample AS sample,
              CASE WHEN i.due_date IS NULL THEN NULL ELSE (i.due_date - (now() AT TIME ZONE 'Asia/Seoul')::date) END AS "dDay"
         FROM biz_axis_items i
        WHERE i.kind = 'POL' AND i.item_no = $1 AND i.status IN ('PUBLISHED','CLOSED')`, [no]);
    if (!row) throw new NotFound('공고를 찾을 수 없습니다.');
    return row;
  }

  /** 올리기 — JOB · SVC 는 올린 회원 본인(v10.37 · 개인도), POL · EDU 는 운영(ADMIN · SUPER) */
  async create(dto: Record<string, any>, roles: string[]) {
    const me = RequestCtx.actorId()!;
    const kind = this.kind(dto.kind);
    const staff = roles.some((r) => r === 'ADMIN' || r === 'SUPER');
    let businessId: string | null = null;
    if (kind === 'JOB' || kind === 'SVC') {
      /* v10.37 (D095 · P2P) — 공고 · 자문 서비스는 개인 회원도 올립니다. 인증된 사업자가 있으면 그 사업자로 붙입니다(없으면 개인) */
      const [a] = await this.db.query<{ iv: Date | null }>(`SELECT identity_verified_at AS iv FROM accounts WHERE id = $1`, [me]);
      if (!staff && !a?.iv) throw new Forbidden('IDENTITY_REQUIRED', '본인인증을 하시면 공고 · 자문 서비스를 올리실 수 있습니다.');
      const [b] = await this.db.query<{ id: string }>(
        `SELECT id FROM businesses WHERE account_id = $1 AND verified_at IS NOT NULL LIMIT 1`, [me]);
      businessId = b?.id ?? null;
    } else if (!staff) {
      throw new Forbidden('FORBIDDEN', '정책 · 교육 정보는 운영이 올립니다.');
    }
    const mask = (t?: string | null) => t == null ? null : String(t)
      .replace(/01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[연락처]').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[이메일]');
    const spec = Array.isArray(dto.spec) ? dto.spec.filter((r: unknown) => Array.isArray(r) && r.length === 2).slice(0, 20) : [];
    const rows = Array.isArray(dto.sourceRows) ? dto.sourceRows.filter((r: unknown) => Array.isArray(r) && r.length === 2).slice(0, 20) : [];
    const [row] = await this.db.query<{ item_no: string }>(
      `INSERT INTO biz_axis_items (kind, badge, is_hot, title, price_text, cond_text, sub_text, description, spec, org,
                                   region_text, headcount, period_text, due_date, contract_type,
                                   source_title, source_org, source_scale, source_url, source_rows,
                                   owner_account_id, business_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::date,$15,$16,$17,$18,$19,$20::jsonb,$21,$22,$23)
       RETURNING item_no`,
      [kind, dto.badge, !!dto.hot && kind === 'JOB', mask(dto.title), dto.price ?? null, dto.cond ?? null, mask(dto.sub),
       mask(dto.description), JSON.stringify(spec), dto.org ?? null, dto.region ?? null, dto.headcount ?? null,
       dto.period ?? null, dto.due || null, kind === 'JOB' ? 'OUTSOURCE' : null,
       kind === 'POL' ? dto.sourceTitle ?? null : null, kind === 'POL' ? dto.sourceOrg ?? null : null,
       kind === 'POL' ? dto.sourceScale ?? null : null, kind === 'POL' ? dto.sourceUrl ?? null : null,
       JSON.stringify(kind === 'POL' ? rows : []), me, businessId, dto.status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED']);
    return { no: Number(row.item_no), kind };
  }

  /** 상태 바꾸기 — 올린 사람(마감 · 다시 열기) · 운영(숨김 · 사유) */
  async setStatus(no: number, status: string, reason: string | undefined, roles: string[]) {
    const me = RequestCtx.actorId()!;
    const staff = roles.some((r) => r === 'ADMIN' || r === 'SUPER');
    if (status === 'HIDDEN' && !staff) throw new Forbidden('FORBIDDEN', '숨김은 운영만 합니다.');
    if (status === 'HIDDEN' && !reason?.trim()) throw new PolicyViolation('REASON_REQUIRED', '숨기는 사유를 적어 주십시오.');
    const [row] = await this.db.query<{ no: string }>(
      `UPDATE biz_axis_items SET status = $2, hidden_reason = CASE WHEN $2 = 'HIDDEN' THEN $3 ELSE NULL END
        WHERE item_no = $1 AND ($4::boolean OR owner_account_id = $5) RETURNING item_no AS no`,
      [no, status, reason?.trim() ?? null, staff, me]);
    if (!row) throw new NotFound('항목을 찾을 수 없습니다.');
    return { ok: true, no: Number(row.no), status };
  }

  /** 공고 「업체 소개 요청」 · 자문 「견적 요청」 */
  async request(no: number, memo?: string) {
    const me = RequestCtx.actorId()!;
    const [it] = await this.db.query<{ id: string; kind: string; owner: string; title: string }>(
      `SELECT id, kind, owner_account_id AS owner, title FROM biz_axis_items
        WHERE item_no = $1 AND status = 'PUBLISHED' AND kind IN ('JOB','SVC')`, [no]);
    if (!it) throw new NotFound('요청할 수 있는 공고 · 서비스가 아닙니다.');
    if (it.owner === me) throw new StateConflict('OWN_ITEM', '본인이 올린 항목에는 요청할 수 없습니다.');
    const clean = memo?.trim()
      ? memo.trim().replace(/01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[연락처]').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[이메일]')
      : null;
    const [row] = await this.db.query<{ id: string }>(
      `INSERT INTO biz_axis_requests (item_id, requester_id, kind, memo) VALUES ($1,$2,$3,$4)
       ON CONFLICT (item_id, requester_id) DO NOTHING RETURNING id`,
      [it.id, me, it.kind === 'JOB' ? 'JOB_INTRO' : 'SVC_QUOTE', clean]);
    if (!row) throw new StateConflict('ALREADY_REQUESTED', '이미 요청했습니다. 「지원」에서 진행 상태를 보십시오.');
    await this.db.query(`SELECT fn_notify($1, 'BIZAXIS_REQUEST', jsonb_build_object('title', $2::text), $3)`,
      [it.owner, it.title, `/biz/${it.kind === 'JOB' ? 'job' : 'advisory'}/${no}`]).catch(() => undefined);
    return { ok: true, id: row.id, note: '요청을 보냈습니다. 회신은 1:1 대화 · 알림으로 옵니다.' };
  }

  /** 올린 사람이 받은 요청(요청자 이름은 첫 글자만) */
  async receivedRequests(no: number) {
    const me = RequestCtx.actorId()!;
    const [it] = await this.db.query<{ id: string }>(
      `SELECT id FROM biz_axis_items WHERE item_no = $1 AND owner_account_id = $2`, [no, me]);
    if (!it) throw new NotFound('항목을 찾을 수 없습니다.');
    return this.db.query(
      `SELECT q.id, q.kind, q.memo, q.status, q.answer, q.created_at AS "createdAt",
              coalesce((SELECT b.company_name FROM businesses b WHERE b.account_id = q.requester_id AND b.verified_at IS NOT NULL LIMIT 1),
                       fn_mask_name(a.name)) AS requester
         FROM biz_axis_requests q JOIN accounts a ON a.id = q.requester_id
        WHERE q.item_id = $1 ORDER BY q.created_at DESC`, [it.id]);
  }

  async answer(requestId: string, answer: string) {
    const me = RequestCtx.actorId()!;
    const [row] = await this.db.query<{ id: string; requester: string }>(
      `UPDATE biz_axis_requests q SET status = 'ANSWERED', answer = $3, answered_at = now()
         FROM biz_axis_items i WHERE q.id = $1 AND i.id = q.item_id AND i.owner_account_id = $2
       RETURNING q.id, q.requester_id AS requester`, [requestId, me, answer.trim().slice(0, 1000)]);
    if (!row) throw new NotFound('요청을 찾을 수 없습니다.');
    return { ok: true };
  }

  /* ── 빠른 매칭(도급 · 인력대행업체 회신) ── */
  async quickList() {
    const me = RequestCtx.actorId() ?? null;
    return this.db.query(
      `SELECT m.id, m.need_when AS "when", m.headcount, m.task, coalesce(r.sido, '지역 미상') AS region,
              m.created_at AS "createdAt", m.status,
              (SELECT count(*)::int FROM biz_quick_offers o WHERE o.match_id = m.id) AS offers,
              (m.requester_id = $1::uuid) AS mine,
              EXISTS (SELECT 1 FROM biz_quick_offers o JOIN businesses b ON b.id = o.business_id
                       WHERE o.match_id = m.id AND b.account_id = $1::uuid) AS offered
         FROM biz_quick_matches m LEFT JOIN regions r ON r.code = m.region_code
        WHERE m.status = 'OPEN' AND m.created_at > now() - interval '14 days'
        ORDER BY CASE m.need_when WHEN 'TODAY' THEN 0 WHEN 'TOMORROW' THEN 1 ELSE 2 END, m.created_at DESC LIMIT 30`, [me]);
  }

  async quickCreate(dto: { when: string; headcount: number; task: string; place: string; regionCode?: string }) {
    const me = RequestCtx.actorId()!;
    const region = dto.regionCode || (await this.db.query<{ c: string | null }>(`SELECT fn_sido_code($1) AS c`, [dto.place]))[0]?.c || null;
    const [row] = await this.db.query<{ id: string }>(
      `INSERT INTO biz_quick_matches (need_when, headcount, task, place_text, region_code, requester_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [dto.when, dto.headcount, dto.task.trim(), dto.place.trim(), region, me]);
    return { id: row.id, note: '요청을 올렸습니다. 회신이 오면 알려 드립니다 — 도급(일을 맡아 하는 계약)으로 잇습니다.' };
  }

  async quickOffer(id: string) {
    const me = RequestCtx.actorId()!;
    /* v10.38 (D096 · P2P) — 계정 기준. 인증된 사업자는 그 사업자로, 사업자 정보가 없는 본인인증 개인은 「개인 활동 정보」로 회신합니다 */
    const a = await this.actors.actor(me, true);   // v10.39 — PartnerActorService 한 곳
    const b = a?.ok ? { id: a.id } : null;
    if (!b) throw new Forbidden('IDENTITY_REQUIRED', '본인인증(또는 사업자 인증)을 마친 회원이 회신할 수 있습니다.');
    const [m] = await this.db.query<{ requester: string; task: string }>(
      `SELECT requester_id AS requester, task FROM biz_quick_matches WHERE id = $1 AND status = 'OPEN'`, [id]);
    if (!m) throw new NotFound('열린 요청이 아닙니다.');
    if (m.requester === me) throw new StateConflict('OWN_ITEM', '본인 요청에는 회신할 수 없습니다.');
    const [row] = await this.db.query(
      `INSERT INTO biz_quick_offers (match_id, business_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING match_id`, [id, b.id]);
    if (!row) throw new StateConflict('ALREADY_REQUESTED', '이미 회신했습니다.');
    await this.db.query(`SELECT fn_notify($1, 'BIZQUICK_OFFER', jsonb_build_object('title', $2::text), '/biz?axis=jobs&d=quick')`,
      [m.requester, m.task]).catch(() => undefined);
    return { ok: true };
  }

  async quickClose(id: string) {
    const [row] = await this.db.query(
      `UPDATE biz_quick_matches SET status = 'CLOSED' WHERE id = $1 AND requester_id = $2 AND status = 'OPEN' RETURNING id`,
      [id, RequestCtx.actorId()]);
    if (!row) throw new NotFound('열린 내 요청이 아닙니다.');
    return { ok: true };
  }
}
