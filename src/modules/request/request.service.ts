import { checkOwnImages, openImage } from '../file/attach-images';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { ReviewRepository } from '../review/review.repository';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { publicAuthor } from '../community/community.service';
import { RequestCtx } from '../../core/request-context';
import { clampLimit } from '../../core/pagination';
import { I18nService } from '../i18n/i18n.service';

@Injectable()
export class RequestService {
  constructor(
    private readonly db: DatabaseService,
    private readonly reviews: ReviewRepository,
    private readonly i18n: I18nService,
  ) {}

  async create(input: Record<string, unknown>) {
    const actor = RequestCtx.actorId()!;
    /* v10.31 — 대표 · 상세 이미지: 내가 올린 READY REQUEST_IMAGE 만 */
    const images = await checkOwnImages(this.db, actor, input.imageKeys as string[] | undefined, 'REQUEST_IMAGE');
    return this.db.transaction(async () => {
      /* v10.31 — 시안 등록 폼의 칸(지역 · 주소 · 규모 · 문의 가능 시간 · 예산 공개 · 회사명 비공개 · 공개 범위 · 이미지)
       *   + 시안 「등록 후 30일이 지나면 자동으로 닫힙니다」 → closes_at = now()+30일 */
      const addr = input.address as { zip?: string; road?: string; detail?: string } | undefined;
      const [r] = await this.db.query<{ id: string }>(
        `INSERT INTO requests
           (gwan_code, category_id, owner_account_id, title, body,
            budget_min, budget_max, offered_fee, status, closes_at,
            region, address, quantity, contact_hours, budget_open, company_blind, visibility, image_keys)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'IN_REVIEW', now() + interval '30 days',
                 $9,$10::jsonb,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [input.gwanCode, input.categoryId ?? null, actor, input.title,
         input.body ?? null, input.budgetMin ?? null,
         input.budgetMax ?? null, input.offeredFee ?? null,
         (input.region as string | undefined)?.trim() || regionOf(addr?.road) || null,
         addr && (addr.road || addr.zip) ? JSON.stringify({ zip: addr.zip ?? '', road: addr.road ?? '', detail: addr.detail ?? '' }) : null,
         (input.quantity as string | undefined)?.trim() || null,
         (input.contactHours as string | undefined)?.trim() || null,
         input.budgetOpen ?? true, input.companyBlind ?? false, input.visibility ?? 'ALL',
         images]);

      const reviewId = await this.reviews.enqueue({
        targetType: 'REQUEST', targetId: r.id,
        gwanCode: input.gwanCode as string, submittedBy: actor,
      });
      const [after] = await this.db.query<{ status: string }>(
        `SELECT status FROM requests WHERE id = $1`, [r.id]);
      return { requestId: r.id, reviewId, status: after.status };
    });
  }

  /**
   * 소개받기 목록 — v10.31 시안 scReqList: 검색어 · 관 필터(전체 · 소개장터 · 안심소개 · 소개창업 · 마감 임박) · 정렬(마감 임박 · 최신 · 소개비).
   *   카드: 관 · 업종 · 🔒 회사명 비공개 · D-day · 제목 · 설명(앞 120자) · 📍 지역 · 📦 규모 · 💰 예산(비공개면 숨김) · 요청 번호 ·
   *         예상 소개비 · 제안 n건 · 공개 범위. 30일이 지나 마감된 요청(closes_at 지남)은 빠집니다.
   *   공개 범위(visibility)가 회원 · 인증 회원인 요청은 목록에 제목 · 관 · 업종 · D-day 까지만 보이고 내용 · 지역 · 예산은 가립니다(로그인 안 한 사람에게).
   */
  async list(q: { gwanCode?: string; limit?: number; q?: string; closing?: boolean; sort?: string }) {
    const actor = RequestCtx.actorId();
    const kw = (q.q ?? '').trim().slice(0, 50);
    const order = q.sort === 'RECENT' ? 'r.created_at DESC'
      : q.sort === 'FEE' ? 'r.offered_fee DESC NULLS LAST, r.created_at DESC'
      : 'r.closes_at ASC NULLS LAST, r.created_at DESC';
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT r.id, r.gwan_code AS "gwanCode", r.title, c.name AS "categoryName",
              CASE WHEN r.visibility = 'ALL' OR $5::uuid IS NOT NULL THEN left(r.body, 120) END AS "summary",
              CASE WHEN r.visibility = 'ALL' OR $5::uuid IS NOT NULL THEN r.region END AS "region",
              CASE WHEN r.visibility = 'ALL' OR $5::uuid IS NOT NULL THEN r.quantity END AS "quantity",
              CASE WHEN r.budget_open AND (r.visibility = 'ALL' OR $5::uuid IS NOT NULL) THEN r.budget_min END AS "budgetMin",
              CASE WHEN r.budget_open AND (r.visibility = 'ALL' OR $5::uuid IS NOT NULL) THEN r.budget_max END AS "budgetMax",
              r.budget_open AS "budgetOpen", r.company_blind AS "companyBlind",
              r.visibility, (SELECT label FROM code_labels WHERE domain='request.visibility' AND code=r.visibility) AS "visibilityLabel",
              r.offered_fee AS "offeredFee", r.status, r.closes_at AS "closesAt",
              CASE WHEN r.closes_at IS NULL THEN NULL
                   ELSE greatest(0, ceil(extract(epoch FROM (r.closes_at - now())) / 86400))::int END AS "dday",
              r.created_at AS "createdAt",   /* v10.21 (G-128) — 화면의 「등록」이 이 값을 씁니다. 없어서 빈 칸으로 나왔습니다 */
              (SELECT label FROM code_labels WHERE domain='request.status' AND code=r.status) AS "statusLabel",
              (SELECT count(*)::int FROM request_proposals p WHERE p.request_id = r.id) AS "proposalCount",
              r.category_id::text AS "_cid"
         FROM requests r LEFT JOIN categories c ON c.id = r.category_id
        WHERE r.status = 'PUBLISHED' AND ($1::text IS NULL OR r.gwan_code = $1)
          AND (r.closes_at IS NULL OR r.closes_at > now())
          AND ($3 = '' OR lower(r.title) LIKE fn_search_like($3) OR lower(coalesce(c.name,'')) LIKE fn_search_like($3)
               OR lower(coalesce(r.region,'')) LIKE fn_search_like($3))
          AND (NOT $4 OR r.closes_at <= now() + interval '7 days')
        ORDER BY ${order} LIMIT $2`,
      [q.gwanCode ?? null, clampLimit(q.limit), kw.toLowerCase(), !!q.closing, actor ?? null]);
    /* v10.103 (3-1) — 업종 이름만 화면 언어로(찾기는 원문으로 했음) · 숨긴 _cid 는 지움 */
    return this.i18n.overlayBy(rows, 'CATEGORY', '_cid', { categoryName: 'name' });
  }

  /**
   * 요청 상세 열람. 구독 한도를 차감합니다 (B-13R2).
   * 한도 초과는 DB 트리거가 422 로 막습니다 — 여기서 세지 않습니다.
   */
  /** v10.31 — 요청 이미지 n 번째(0부터). 상세와 같은 공개 범위 규칙(전체 · 회원 · 인증 회원) · 주인은 늘 */
  async image(id: string, n: number) {
    const actor = RequestCtx.actorId();
    const [r] = await this.db.query<{ keys: string[]; owner: string; visibility: string; status: string }>(
      `SELECT image_keys AS keys, owner_account_id AS owner, visibility, status FROM requests WHERE id = $1`, [id]);
    if (!r || (actor !== r.owner && !['PUBLISHED', 'CLOSED'].includes(r.status))) throw new StateConflict('NOT_FOUND', '이미지가 없습니다.');
    if (actor !== r.owner && r.visibility !== 'ALL') {
      const [a] = actor ? await this.db.query<{ v: boolean }>(`SELECT identity_verified_at IS NOT NULL AS v FROM accounts WHERE id = $1`, [actor]) : [];
      if (!actor || (r.visibility === 'VERIFIED' && !a?.v)) throw new StateConflict('NOT_FOUND', '이미지가 없습니다.');
    }
    return openImage(this.db, r.keys?.[n], 'REQUEST_IMAGE');
  }

  async detail(id: string) {
    const actor = RequestCtx.actorId();
    const [row] = await this.db.query(
      `SELECT r.id, r.gwan_code AS "gwanCode", r.title, r.body,
              c.name AS "categoryName", r.budget_min AS "budgetMin",
              r.budget_max AS "budgetMax", r.offered_fee AS "offeredFee",
              r.status, r.closes_at AS "closesAt", r.owner_account_id AS "ownerAccountId",
              r.created_at AS "createdAt",
              (SELECT label FROM code_labels WHERE domain='request.status' AND code=r.status) AS "statusLabel",
              (SELECT count(*)::int FROM request_proposals p WHERE p.request_id = r.id) AS "proposalCount",
              /* v10.31 — 시안 요청 상세의 표(요청 기업 · 지역 · 규모 · 희망 예산 · 공개 범위 · 요청 번호) */
              r.region, r.quantity, r.contact_hours AS "contactHours", r.budget_open AS "budgetOpen",
              r.company_blind AS "companyBlind", r.visibility,
              (SELECT label FROM code_labels WHERE domain='request.visibility' AND code=r.visibility) AS "visibilityLabel",
              CASE WHEN r.closes_at IS NULL THEN NULL
                   ELSE greatest(0, ceil(extract(epoch FROM (r.closes_at - now())) / 86400))::int END AS "dday",
              (r.closes_at IS NOT NULL AND r.closes_at <= now()) AS "closed",
              CASE WHEN r.company_blind THEN NULL ELSE b.company_name END AS "companyName",
              r.image_keys AS "imageKeys", r.category_id::text AS "_cid"
         FROM requests r LEFT JOIN categories c ON c.id = r.category_id
         LEFT JOIN businesses b ON b.account_id = r.owner_account_id AND b.verified_at IS NOT NULL
        WHERE r.id = $1 AND r.status IN ('PUBLISHED','CLOSED')`, [id]);
    if (!row) throw new NotFound('요청을 찾을 수 없습니다.');
    /* v10.103 (3-1) — 업종 이름만 화면 언어로 · 숨긴 _cid 는 지움 */
    await this.i18n.overlayBy([row], 'CATEGORY', '_cid', { categoryName: 'name' });
    /* 공개 범위 — 회원 · 인증 회원 공개 요청은 그 조건을 채운 사람에게만 내용을 보입니다(시안 「공개 범위」) */
    if (row.visibility !== 'ALL' && actor !== row.ownerAccountId) {
      const [a] = actor ? await this.db.query<{ v: boolean }>(
        `SELECT identity_verified_at IS NOT NULL AS v FROM accounts WHERE id = $1`, [actor]) : [];
      if (!actor || (row.visibility === 'VERIFIED' && !a?.v)) {
        throw new Forbidden(row.visibility === 'VERIFIED' ? 'VERIFIED_ONLY' : 'MEMBER_ONLY',
          row.visibility === 'VERIFIED' ? '본인인증을 마친 회원에게만 공개된 요청입니다.' : '로그인한 회원에게만 공개된 요청입니다.');
      }
    }
    const isOwner = !!actor && actor === row.ownerAccountId;
    if (!row.budgetOpen && !isOwner) { row.budgetMin = null; row.budgetMax = null; }

    /* 열람 기록 · 한도 (D011 — 10/2 결정).
     *   · 본인 요청이 아닌 것을 **처음** 열 때 한 번 셉니다(다시 여는 것은 세지 않음).
     *   · 한도는 운영 설정입니다: request.view.limit=off(홍보 기간)면 아무도 막지 않고,
     *     on 이면 무료 요금제 · 구독 없는 일반 회원은 같은 값(request.view.free_monthly), 유료 요금제는 요금제 값.
     *   · 판정은 DB(fn_request_view_limit · trg_view_quota)가 합니다 — 넘으면 422 VIEW_QUOTA_EXCEEDED.
     *   전에는 유효 구독이 있을 때만 세어, 소개코드를 받아 무료 BASIC 이 생긴 회원만 월 5건으로 묶였습니다. */
    let viewCharged = false;
    let viewLimit: { enabled: boolean; basis: string; limit: number | null; used: number; remaining: number | null } | null = null;
    if (actor && actor !== row.ownerAccountId) {
      const [sub] = await this.db.query<{ id: string }>(
        `SELECT id FROM subscriptions
          WHERE account_id = $1 AND status IN ('ACTIVE','PAST_DUE') LIMIT 1`, [actor]);
      const before = await this.db.query<{ n: number }>(
        `SELECT count(*)::int n FROM request_views
          WHERE request_id = $1 AND viewer_account_id = $2`, [id, actor]);
      if (!before[0].n) {
        const ins = await this.db.query(
          `INSERT INTO request_views (request_id, viewer_account_id, subscription_id)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`, [id, actor, sub?.id ?? null]);
        viewCharged = ins.length > 0;
      }
      const [q] = await this.db.query<{ enabled: boolean; basis: string; lim: number | null; used: number }>(
        `SELECT enabled, basis, lim, used FROM fn_request_view_limit($1)`, [actor]);
      if (q) {
        viewLimit = { enabled: q.enabled, basis: q.basis, limit: q.lim, used: q.used,
          remaining: q.enabled && q.lim != null ? Math.max(0, q.lim - q.used) : null };
      }
    }

    let canPropose = true, reason: string | undefined;
    if (!actor) { canPropose = false; reason = 'IDENTITY_REQUIRED'; }
    else if (actor === row.ownerAccountId) { canPropose = false; reason = 'OWN_REQUEST'; }
    else {
      const [p] = await this.db.query<{ n: number }>(
        `SELECT count(*)::int n FROM request_proposals
          WHERE request_id = $1 AND proposer_account_id = $2`, [id, actor]);
      if (p.n) { canPropose = false; reason = 'ALREADY_PROPOSED'; }
    }
    if (row.closed && canPropose) { canPropose = false; reason = 'CLOSED'; }
    delete row.ownerAccountId;
    /* 이미지는 파일 id 대신 공개 주소로(GET /requests/{id}/images/{n} — 같은 공개 범위 규칙) */
    const { imageKeys, ...out } = row as Record<string, unknown> & { imageKeys?: string[] };
    const images = (imageKeys ?? []).map((_, i) => `/api/v1/requests/${id}/images/${i}`);
    return { ...out, images, isOwner, viewCharged, viewLimit, canPropose, proposeBlockReason: reason };
  }

  async propose(requestId: string, dto: { listingId?: string; message: string; companyName?: string; relation?: string }) {
    const actor = RequestCtx.actorId()!;
    const [req] = await this.db.query<{ owner: string; closed: boolean }>(
      `SELECT owner_account_id AS owner, (closes_at IS NOT NULL AND closes_at <= now()) AS closed
         FROM requests WHERE id = $1 AND status = 'PUBLISHED'`, [requestId]);
    if (!req) throw new NotFound('요청을 찾을 수 없습니다.');
    if (req.owner === actor) throw new PolicyViolation('OWN_REQUEST', '내 요청에는 제안할 수 없습니다.');
    if (req.closed) throw new StateConflict('REQUEST_CLOSED', '마감된 요청입니다.');
    const [row] = await this.db.query<{ id: string }>(
      `INSERT INTO request_proposals (request_id, proposer_account_id, listing_id, message, company_name, relation)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (request_id, proposer_account_id) DO NOTHING
       RETURNING id`, [requestId, actor, dto.listingId ?? null, maskContact(dto.message).text,
        dto.companyName?.trim() || null, dto.relation ?? null]);
    if (!row) throw new StateConflict('ALREADY_PROPOSED', '이미 제안한 요청입니다.');
    return { proposalId: row.id, status: 'PROPOSED' };
  }

  /**
   * 받은 제안 — v10.31: **요청자만 전부** 봅니다(시안 「제안은 요청자에게만 보입니다. 다른 소개자는 볼 수 없습니다」).
   *   제안한 사람은 자기 제안만, 그 밖의 사람은 빈 목록. 전에는 누구나 모든 제안과 제안자 실명을 볼 수 있었습니다.
   *   이름은 첫 글자만(김OO) — 실명 · 연락처는 수락 뒤 대화에서도 가려집니다(대화의 연락처 가림 규칙).
   */
  async proposals(requestId: string) {
    const actor = RequestCtx.actorId();
    if (!actor) return [];
    const [req] = await this.db.query<{ owner: string }>(
      `SELECT owner_account_id AS owner FROM requests WHERE id = $1`, [requestId]);
    if (!req) throw new NotFound('요청을 찾을 수 없습니다.');
    const mineOnly = req.owner !== actor;
    const rows = await this.db.query<Record<string, unknown> & { _name: string | null }>(
      `SELECT p.id, a.name AS _name, p.message, p.status, p.created_at AS "createdAt",
              p.company_name AS "companyName", p.relation,
              (SELECT label FROM code_labels WHERE domain='proposal.relation' AND code=p.relation) AS "relationLabel",
              p.decided_at AS "decidedAt", p.conversation_id AS "conversationId",
              (p.proposer_account_id = $2) AS mine,
              (SELECT label FROM code_labels WHERE domain='proposal.status' AND code=p.status) AS "statusLabel"
         FROM request_proposals p JOIN accounts a ON a.id = p.proposer_account_id
        WHERE p.request_id = $1 AND (NOT $3 OR p.proposer_account_id = $2)
        ORDER BY p.created_at DESC`, [requestId, actor, mineOnly]);
    return rows.map(({ _name, ...r }) => ({ ...r, proposerName: publicAuthor(_name) }));
  }

  /**
   * 제안 수락 · 거절 — v10.31 (시안 prop 「거절 / 수락하고 대화 시작」 · scReqDetail 「제안이 수락되면 ① 1:1 대화가 열리고…」).
   *   요청자만 합니다. 수락하면 제안한 사람과의 1:1 대화(대상 = 이 요청)를 열고 제안 글을 첫 메시지로 넣습니다(연락처 가림 그대로).
   *   귀속은 「제안한 순간이 아니라 수락된 순간」(B-16) — accepted_at 이 그 시점입니다. Deal 생성 · 소개코드는 대화 화면의 기존 흐름 그대로.
   */
  async decide(requestId: string, proposalId: string, accept: boolean) {
    const actor = RequestCtx.actorId()!;
    return this.db.transaction(async () => {
      const [p] = await this.db.query<{ id: string; status: string; proposer: string; owner: string; message: string | null; company: string | null }>(
        `SELECT p.id, p.status, p.proposer_account_id AS proposer, r.owner_account_id AS owner, p.message, p.company_name AS company
           FROM request_proposals p JOIN requests r ON r.id = p.request_id
          WHERE p.id = $1 AND p.request_id = $2 FOR UPDATE OF p`, [proposalId, requestId]);
      if (!p) throw new NotFound('제안을 찾을 수 없습니다.');
      if (p.owner !== actor) throw new Forbidden('NOT_REQUEST_OWNER', '요청한 분만 제안을 수락하거나 거절할 수 있습니다.');
      if (p.status !== 'PROPOSED') throw new StateConflict('ALREADY_DECIDED', '이미 처리한 제안입니다.');
      if (!accept) {
        await this.db.query(
          `UPDATE request_proposals SET status = 'REJECTED', decided_at = now() WHERE id = $1`, [p.id]);
        return { proposalId: p.id, status: 'REJECTED' };
      }
      const [c] = await this.db.query<{ id: string }>(
        `INSERT INTO conversations (target_type, target_id, initiator_id, counterpart_id)
         VALUES ('REQUEST', $1, $2, $3)
         ON CONFLICT (target_type, target_id, initiator_id) DO UPDATE SET status = 'OPEN'
         RETURNING id`, [requestId, p.proposer, p.owner]);
      const first = [p.company ? `[소개 제안] ${p.company}` : '[소개 제안]', p.message ?? ''].filter(Boolean).join('\n');
      const m = maskContact(first);
      await this.db.query(
        `INSERT INTO messages (conversation_id, sender_id, body, masked) VALUES ($1,$2,$3,$4)`,
        [c.id, p.proposer, m.text, m.changed]);
      await this.db.query(`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [c.id]);
      await this.db.query(
        `UPDATE request_proposals SET status = 'ACCEPTED', accepted_at = now(), decided_at = now(), conversation_id = $2
          WHERE id = $1`, [p.id, c.id]);
      return { proposalId: p.id, status: 'ACCEPTED', conversationId: c.id };
    });
  }
}

/** 주소의 앞 두 낱말(시 · 구)을 지역으로 — 「서울 마포구 …」 → 「서울 마포구」 */
function regionOf(road?: string): string | null {
  const w = (road ?? '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return null;
  const sido = w[0]!.replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, '');
  return [sido, w[1]].filter(Boolean).join(' ').slice(0, 40);
}

/** 연락처 가림 — 대화(deal.service mask)와 같은 규칙. 제안 글은 수락 전에도 연락처가 오가지 않게 가립니다 */
function maskContact(body: string) {
  const masked = body
    .replace(/01[016-9][-. ]?\d{3,4}[-. ]?\d{4}/g, '***-****-****')
    .replace(/\b0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}\b/g, '***-****-****')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '***@***');
  return { text: masked, changed: masked !== body };
}
