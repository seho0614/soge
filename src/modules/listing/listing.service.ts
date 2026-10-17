import { checkOwnImages } from '../file/attach-images';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { ReviewRepository } from '../review/review.repository';
import { ListingRepository } from './listing.repository';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { storageFromEnv } from '../file/storage';
import { RequestCtx } from '../../core/request-context';
import { clampLimit, decodeCursor, encodeCursor } from '../../core/pagination';
import { GeoService } from '../../common/geo/geo.service';

/** v10.31 (합침) — 한 매물 사진 한도. DB(fn_listing_media_guard · w2 D050)와 같은 10장. 등록 화면(w1)은 화면에서 6장까지만 받습니다. */
const LISTING_MAX_PHOTOS = 10;

/**
 * 리스팅 (SB-HOM-REG-010/020 · SB-{G}-LST-010 · SB-{G}-DTL-010)
 *
 * 제한업종·금칙어·슬롯 한도는 DB 트리거가 판정합니다(INV-6 · B-13R2).
 * 여기서 다시 검사하지 않습니다 — 두 곳에 두면 반드시 어긋납니다.
 * 트리거 예외는 DbErrorFilter 가 422 로 옮깁니다.
 */
@Injectable()
export class ListingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly reviews: ReviewRepository,
    private readonly repo: ListingRepository,
    private readonly geo: GeoService,
  ) {}

  async submit(input: {
    ownerAccountId: string; gwanCode: string; categoryId: string;
    title: string; body?: string; desiredFee?: number; feeBearer?: string;
    regionCodes?: string[]; mediaKeys?: string[];
    summary?: string; contractSupport?: string; contactHours?: string;
    address?: object; bizInfo?: object;
    /* v10.31 (w2) — 시안 등록 칸: 거래(희망) 금액 · 시군구 */
    dealAmount?: number; regionDetail?: string;
  }) {
    /* v10.31 — 대표 · 상세 이미지: 내가 올린 READY LISTING_IMAGE 만(checkOwnImages) */
    const media = input.mediaKeys !== undefined
      ? await checkOwnImages(this.db, input.ownerAccountId, input.mediaKeys, 'LISTING_IMAGE', LISTING_MAX_PHOTOS) : undefined;
    const out = await this.db.transaction(async () => {
      // 등급은 카테고리가 결정합니다 (A-11). 매핑표가 비어 있어도 G3 로 돕니다.
      const [g] = await this.db.query<{ grade_code: string }>(
        `SELECT grade_code FROM category_grades
          WHERE category_id = $1 AND effective_from <= now()
          ORDER BY effective_from DESC LIMIT 1`, [input.categoryId]);

      const [l] = await this.db.query<{ id: string }>(
        `INSERT INTO listings
           (gwan_code, category_id, owner_account_id, title, body,
            grade_code, desired_fee, fee_bearer, status, summary, deal_amount, region_detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'IN_REVIEW',$9,$10,$11) RETURNING id`,
        [input.gwanCode, input.categoryId, input.ownerAccountId, input.title,
         input.body ?? null, g?.grade_code ?? 'G3',
         input.desiredFee ?? null, input.feeBearer ?? null,
         input.summary?.trim() || null, input.dealAmount ?? null, input.regionDetail?.trim() || null]);
      await this.saveRegFields(l.id, input);

      await this.attachRelations(l.id, input.regionCodes, media, false, input.ownerAccountId);
      await this.db.query(
        `INSERT INTO listing_versions (listing_id, version, snapshot, changed_by)
         VALUES ($1, 1, $2::jsonb, $3)`,
        [l.id, JSON.stringify(input), input.ownerAccountId]);

      const reviewId = await this.reviews.enqueue({
        targetType: 'LISTING', targetId: l.id,
        gwanCode: input.gwanCode, submittedBy: input.ownerAccountId,
      });

      // 자동검수를 통과하면 트리거가 이미 PUBLISHED 로 바꿔 놓았습니다.
      const [after] = await this.db.query<{ status: string }>(
        `SELECT status FROM listings WHERE id = $1`, [l.id]);

      return {
        listingId: l.id, reviewId,
        status: after.status,
        autoApproved: after.status === 'PUBLISHED',
      };
    });
    /* v10.46 (docs/96) — 저장이 끝난 뒤 좌표를 따로 구합니다(기다리지 않음 · 지도 사용 off 면 아무것도 안 함) */
    if (input.address !== undefined) this.geo.scheduleListing(out.listingId);
    return out;
  }

  /** 수정 = 재검수. 부여된 배지는 트리거가 회수합니다. */
  async update(id: string, ownerId: string, input: {
    version: number; title: string; body?: string; desiredFee?: number;
    feeBearer?: string; categoryId: string; gwanCode: string;
    regionCodes?: string[]; mediaKeys?: string[];
    summary?: string; contractSupport?: string; contactHours?: string;
    address?: object; bizInfo?: object;
    dealAmount?: number; regionDetail?: string;
  }) {
    const media = input.mediaKeys !== undefined
      ? await checkOwnImages(this.db, ownerId, input.mediaKeys, 'LISTING_IMAGE', LISTING_MAX_PHOTOS) : undefined;
    const out = await this.db.transaction(async () => {
      const [row] = await this.db.query<{ id: string; version: number }>(
        /* v10.31 (w1 · REG-020 결함) — 화면이 보내지 않은 칸은 그대로 둡니다. 전에는 소개비 부담(fee_bearer)을 안 보내면 지워졌습니다 */
        `UPDATE listings
            SET title = $3, body = $4, desired_fee = $5,
                fee_bearer = CASE WHEN $9::boolean THEN $6 ELSE fee_bearer END,
                category_id = $7, version = version + 1, status = 'IN_REVIEW',
                deal_amount = CASE WHEN $10::boolean THEN $11 ELSE deal_amount END,
                region_detail = CASE WHEN $12::boolean THEN $13 ELSE region_detail END
          WHERE id = $1 AND owner_account_id = $8 AND version = $2
        RETURNING id, version`,
        [id, input.version, input.title, input.body ?? null,
         input.desiredFee ?? null, input.feeBearer ?? null,
         input.categoryId, ownerId, input.feeBearer !== undefined,
         input.dealAmount !== undefined, input.dealAmount ?? null,
         input.regionDetail !== undefined, input.regionDetail?.trim() || null]);

      if (!row) {
        throw new StateConflict(
          'VERSION_CONFLICT',
          '다른 곳에서 먼저 수정되었습니다. 다시 불러온 뒤 저장하십시오.');
      }

      await this.saveRegFields(id, input);
      /* v10.31 — 수정 초안(「초안 저장」)은 재검수 요청이 들어가면 지웁니다 */
      await this.db.query(`DELETE FROM listing_edit_drafts WHERE listing_id = $1`, [id]);
      /* v10.31 — 지역 · 사진은 보낸 것만 바꿉니다(안 보내면 그대로). 전에는 제목만 고쳐도 지역 · 사진이 지워졌습니다 */
      await this.attachRelations(id, input.regionCodes, media, true, ownerId);
      await this.db.query(
        `INSERT INTO listing_versions (listing_id, version, snapshot, changed_by)
         VALUES ($1,$2,$3::jsonb,$4)`,
        [id, row.version, JSON.stringify(input), ownerId]);

      const reviewId = await this.reviews.enqueue({
        targetType: 'LISTING', targetId: id,
        gwanCode: input.gwanCode, submittedBy: ownerId,
      });
      const [after] = await this.db.query<{ status: string }>(
        `SELECT status FROM listings WHERE id = $1`, [id]);

      return {
        listingId: id, reviewId, status: after.status,
        autoApproved: after.status === 'PUBLISHED',
      };
    });
    /* v10.46 (docs/96) — 주소를 보냈을 때만 좌표를 다시 봅니다(주소가 같으면 geo.service 가 건너뜀) */
    if (input.address !== undefined) this.geo.scheduleListing(out.listingId);
    return out;
  }

  /** 내리기 (v10.27 · G-193). 주인만, 게시 · 검수 중 · 반려 · 임시 상태에서만 ARCHIVED 로 바꿉니다.
   *  운영자가 정지(SUSPENDED)한 매물은 주인이 내려서 정지 이력을 덮지 못하게 막습니다.
   *  다시 올리려면 수정(PATCH) → 재검수입니다 — 내린 동안 바뀐 기준으로 다시 봅니다. */
  async archive(id: string, ownerId: string) {
    const [row] = await this.db.query<{ id: string; status: string }>(
      `UPDATE listings SET status = 'ARCHIVED', updated_at = now()
        WHERE id = $1 AND owner_account_id = $2
          AND status IN ('PUBLISHED','IN_REVIEW','REJECTED','DRAFT')
      RETURNING id, status`, [id, ownerId]);
    if (row) return { listingId: row.id, status: row.status };
    const [cur] = await this.db.query<{ status: string; owner: string }>(
      `SELECT status, owner_account_id AS owner FROM listings WHERE id = $1`, [id]);
    if (!cur || cur.owner !== ownerId) throw new NotFound('매물을 찾을 수 없습니다.');
    if (cur.status === 'ARCHIVED') return { listingId: id, status: 'ARCHIVED' };
    throw new StateConflict('NOT_ARCHIVABLE',
      cur.status === 'SUSPENDED' ? '운영자가 정지한 매물은 내릴 수 없습니다. 고객센터로 문의해 주십시오.'
                                 : '지금 상태에서는 내릴 수 없습니다.');
  }

  /**
   * v10.31 — 시안 등록 폼의 칸(한줄 소개 · 계약 지원 · 문의 가능 시간 · 소재지 · 거래 및 운영 정보)을 저장합니다.
   *   보낸 칸만 바꿉니다(안 보낸 칸은 그대로) — 예전 화면 · 다른 관 화면이 이 칸을 모릅니다.
   */
  private async saveRegFields(id: string, input: {
    summary?: string; contractSupport?: string; contactHours?: string;
    address?: object; bizInfo?: object;
  }) {
    const clean = (o?: object) => {
      if (!o) return undefined;
      const e = Object.entries(o as Record<string, unknown>).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, (v as string).trim()]);
      return e.length ? JSON.stringify(Object.fromEntries(e)) : null;
    };
    const a = clean(input.address), b = clean(input.bizInfo);
    await this.db.query(
      `UPDATE listings SET
          summary = CASE WHEN $2::boolean THEN nullif(btrim($3), '') ELSE summary END,
          contract_support = CASE WHEN $4::boolean THEN $5 ELSE contract_support END,
          contact_hours = CASE WHEN $6::boolean THEN nullif(btrim($7), '') ELSE contact_hours END,
          address = CASE WHEN $8::boolean THEN $9::jsonb ELSE address END,
          biz_info = CASE WHEN $10::boolean THEN $11::jsonb ELSE biz_info END
        WHERE id = $1`,
      [id, input.summary !== undefined, input.summary ?? null,
       input.contractSupport !== undefined, input.contractSupport ?? null,
       input.contactHours !== undefined, input.contactHours ?? null,
       a !== undefined, a ?? null, b !== undefined, b ?? null]);
  }

  /**
   * 지역 · 사진.
   * v10.31 — 사진(mediaKeys)은 **올리기 확인을 마친 LISTING_IMAGE 파일 id** 만 받습니다(POST /files · purpose LISTING_IMAGE → complete).
   *   서비스가 먼저 「내가 올린 · READY · 그 용도」인지 봅니다(attach-images.checkOwnImages · w1) — DB(fn_listing_media_guard · w2)도 다시 봅니다.
   *   저장은 listing_media.file_id(w2 D050) 한 가지 — 공개 주소는 GET /listings/{id}/photos/{n} 과 /images/{n}(같은 사진).
   *   수정에서 mediaKeys · regionCodes 를 **보내지 않으면** 그대로 둡니다.
   * 지역(regionCodes)은 시 · 도 코드(regions) — 없는 코드는 422.
   */
  private async attachRelations(
    id: string, regions?: string[], media?: string[], replace = false, ownerId?: string,
  ) {
    if (replace && regions !== undefined) {
      await this.db.query(`DELETE FROM listing_regions WHERE listing_id = $1`, [id]);
    }
    for (const code of regions ?? []) {
      const [ok] = await this.db.query(`SELECT 1 FROM regions WHERE code = $1 AND is_active`, [code]);
      if (!ok) throw new PolicyViolation('REGION', `지역 코드가 올바르지 않습니다: ${String(code).slice(0, 20)}`);
      await this.db.query(
        `INSERT INTO listing_regions (listing_id, region_code) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`, [id, code]);
    }
    if (media === undefined) return;
    if (replace) await this.db.query(`DELETE FROM listing_media WHERE listing_id = $1`, [id]);
    let i = 0;
    for (const key of media) {
      if (!/^[0-9a-f-]{36}$/i.test(key)) {
        throw new PolicyViolation('LISTING_PHOTO_FILE', '사진은 올리기를 마친 파일 id 로 보내 주십시오(POST /files · purpose LISTING_IMAGE).');
      }
      await this.db.query(
        `INSERT INTO listing_media (listing_id, s3_key, media_type, sort_order, file_id)
         VALUES ($1,'',$2,$3,$4) ON CONFLICT DO NOTHING`, [id, 'IMAGE', i++, key]);
    }
    void ownerId;
  }

  /** 광고와 일반을 분리해 반환합니다. 섞으면 프런트가 라벨을 빠뜨립니다. */
  async list(q0: {
    gwanCode?: string; gwan?: string; categoryId?: string; keyword?: string;
    badge?: string; sort?: string; cursor?: string; limit?: number; match?: string;
    regionCode?: string; axis?: string; urgent?: string; group?: string; page?: number; withTotal?: string;
  }) {
    /* 20260930 — 사용자 웹 일부가 gwan= · sort=new 처럼 보내 왔습니다.
     * 조용히 무시되면(화이트리스트) 관 필터가 빠진 목록이 나갑니다. 받아서 옮깁니다. */
    const SORT_ALIAS: Record<string, string> = { new: 'RECENT', recent: 'RECENT', best: 'POPULAR',
      popular: 'POPULAR', fee: 'FEE_DESC', deadline: 'DEADLINE', ratio: 'FEE_RATIO' };
    const q = { ...q0, gwanCode: q0.gwanCode ?? q0.gwan,
                sort: q0.sort ? (SORT_ALIAS[q0.sort] ?? q0.sort) : undefined };
    const limit = clampLimit(q.limit);
    /* v10.31 — 쪽 번호(시안 「1 · 2 · …」): page 를 주면 그 쪽을 offset 으로 줍니다.
     *   목록이 바뀌는 동안에는 겹치거나 건너뛸 수 있습니다 — 끝없이 이어 보기는 커서(nextCursor)가 정확합니다. */
    const page = q.page && q.page > 0 ? Math.min(q.page, 500) : undefined;
    const cursor = page ? null : decodeCursor(q.cursor);
    const regionCode = q.regionCode ? (q.regionCode.toUpperCase() === 'ETC' ? 'ETC' : q.regionCode) : undefined;
    const f = { gwanCode: q.gwanCode, categoryId: q.categoryId, keyword: q.keyword, badge: q.badge,
                regionCode, axis: q.axis, urgent: q.urgent, group: q.group, match: q.match };
    const wantTotal = !!page || q.withTotal === '1' || q.withTotal === 'true';
    const [promoted, rows, total] = await Promise.all([
      cursor || (page && page > 1) ? Promise.resolve([]) : this.repo.promoted(q.gwanCode, q.categoryId),
      this.repo.organic({ ...q, ...f, cursor, limit, offset: page ? (page - 1) * limit : undefined }),
      wantTotal ? this.repo.count(f) : Promise.resolve(null),
    ]);

    /* 정렬 키(_sk)는 커서에만 씁니다 — 응답에는 내보내지 않습니다 */
    const organic = rows.slice(0, limit).map((r: Record<string, unknown>) => {
      const { _sk, ...rest } = r; void _sk; return rest;
    });
    const lastRow = rows[Math.min(limit, rows.length) - 1] as { _sk?: string; id: string } | undefined;
    return {
      promoted,
      organic,
      nextCursor: !page && rows.length > limit && lastRow
        ? encodeCursor({ sortValue: lastRow._sk ?? '', id: lastRow.id })
        : null,
      adNotice: '광고 영역은 유료 노출입니다.',
      ...(total != null ? { total, page: page ?? 1, pageCount: Math.max(1, Math.ceil(total / limit)) } : {}),
    };
  }

  /** v10.31 — 매물 사진 바이트(공개). 게시 중인 매물이거나 주인 본인만 */
  async photo(id: string, n: number) {
    if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(n) || n < 0 || n > 20) throw new NotFound('사진이 없습니다.');
    const [f] = await this.repo.photo(id, n);
    if (!f) throw new NotFound('사진이 없습니다.');
    if (f.status !== 'PUBLISHED' && f.owner !== RequestCtx.actorId()) {
      /* w1 — 검수 중인 매물 사진은 운영(검수자)도 봅니다 */
      const viewer = RequestCtx.actorId();
      const [ops] = viewer ? await this.db.query(
        `SELECT 1 FROM account_roles WHERE account_id = $1 AND role IN ('ADMIN','SUPER','REVIEWER') LIMIT 1`, [viewer]) : [];
      if (!ops) throw new NotFound('사진이 없습니다.');
    }
    const stream = await storageFromEnv().open(f.storage_key);
    if (!stream) throw new NotFound('사진이 없습니다.');
    return { stream, contentType: f.content_type, size: Number(f.size_bytes) };
  }

  /** v10.31 — 사진 붙이기 · 떼기 · 순서(주인만). 사진은 내용 변경이 아니어서 재검수를 걸지 않습니다(배지도 그대로). */
  async addPhoto(id: string, fileId: string) {
    const me = RequestCtx.actorId()!;
    const [l] = await this.db.query<{ id: string }>(
      `SELECT id FROM listings WHERE id = $1 AND owner_account_id = $2 AND status <> 'ARCHIVED'`, [id, me]);
    if (!l) throw new NotFound('매물을 찾을 수 없습니다.');
    const [n] = await this.db.query<{ n: number }>(
      `SELECT coalesce(max(sort_order) + 1, 0)::int AS n FROM listing_media WHERE listing_id = $1`, [id]);
    const [row] = await this.db.query<{ id: string }>(
      `INSERT INTO listing_media (listing_id, s3_key, media_type, sort_order, file_id)
       VALUES ($1,'','IMAGE',$2,$3) ON CONFLICT DO NOTHING RETURNING id`, [id, n.n, fileId]);
    if (!row) throw new StateConflict('LISTING_PHOTO_DUP', '이미 붙인 사진입니다.');
    return { mediaId: row.id, sortOrder: n.n };
  }

  async removePhoto(id: string, mediaId: string) {
    const me = RequestCtx.actorId()!;
    const [row] = await this.db.query<{ id: string }>(
      `DELETE FROM listing_media m USING listings l
        WHERE m.id = $2 AND m.listing_id = l.id AND l.id = $1 AND l.owner_account_id = $3
      RETURNING m.id`, [id, mediaId, me]);
    if (!row) throw new NotFound('사진을 찾을 수 없습니다.');
    return { ok: true };
  }

  /**
   * v10.31 — 급구 · 급매 표시 신청(시안 급구 · 급매 화면 「급구, 급매 등록 안내」).
   * 기한 · 동시 개수 · 하나만 · 노출 중 · 본인은 DB(fn_badge_enqueue)가 봅니다. 신청하면 운영 배지 심사로 갑니다.
   */
  async requestBadge(id: string, dto: { type: string; reason: string; until: string }) {
    const me = RequestCtx.actorId()!;
    const until = new Date(dto.until);
    if (Number.isNaN(until.getTime())) throw new PolicyViolation('URGENT_PERIOD', '기한 날짜가 올바르지 않습니다.');
    const [row] = await this.db.query<{ id: string; status: string }>(
      `INSERT INTO listing_badges (listing_id, badge_type, urgent_reason, valid_until, requested_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, status`, [id, dto.type, dto.reason.trim(), until.toISOString(), me]);
    const [after] = await this.db.query<{ status: string }>(`SELECT status FROM listing_badges WHERE id = $1`, [row.id]);
    return { badgeId: row.id, status: after?.status ?? row.status,
      note: '운영 심사 뒤 표시됩니다. 기한이 지나면 자동으로 내려갑니다.' };
  }

  /**
   * 상세. 문의 가능 여부를 서버가 판정해 내려 줍니다 —
   * 프런트가 역할·게이트 조합을 다시 계산하지 않게 합니다.
   */
  /** v10.31 — 매물 이미지 n 번째(0부터) · w1 주소(/images/{n}). 합친 뒤 w2 사진(/photos/{n})과 같은 사진을 냅니다.
   *  게시된 매물은 누구나, 아니면 주인 · 운영(검수자)만 */
  async image(id: string, n: number) {
    try { return await this.photo(id, n); }
    catch (e) { if (e instanceof NotFound) throw new StateConflict('NOT_FOUND', '이미지가 없습니다.'); throw e; }
  }

  async detail(id: string, countView = true) {
    const viewer = RequestCtx.actorId();
    const [row] = await this.repo.detail(id, viewer);
    if (!row || (row.status !== 'PUBLISHED' && !row.isOwn)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: '매물을 찾을 수 없습니다.' });
    }

    let canInquire = true;
    let reason: string | undefined;
    if (row.isOwn) { canInquire = false; reason = 'OWN_LISTING'; }
    else if (!viewer) { canInquire = false; reason = 'IDENTITY_REQUIRED'; }
    else {
      const [p] = await this.db.query<{ bv: Date | null; iv: Date | null }>(
        `SELECT a.identity_verified_at AS iv,
                (SELECT max(verified_at) FROM businesses WHERE account_id = a.id) AS bv
           FROM accounts a WHERE a.id = $1`, [viewer]);
      /* v10.37 (D095) — 문의는 본인인증이면 됩니다(사업자 인증을 보지 않음 · 10/13 대표 지시 「모든 업무 개인도 가능」) */
      if (!p?.iv) { canInquire = false; reason = 'IDENTITY_REQUIRED'; }
    }

    if (countView) await this.db.query(
      `UPDATE listings SET view_count = view_count + 1 WHERE id = $1`, [id]);

    /* v10.21 (D023) — 등록자의 공개 실적을 owner 에 합칩니다(목록 카드의 owner 는 그대로 3항목). */
    const { isOwn, ownerStats, _address, ...rest } = row;
    const ad = (_address ?? null) as Record<string, string> | null;
    const address = ad ? (isOwn ? ad : { sido: ad.sido, sigungu: ad.sigungu }) : null;
    /* v10.46 (docs/96) — 지도 좌표. 지도 사용 off 면 null. 남에게는 시 · 구 중심(REGION)만 — 정확 좌표는 본인에게만.
       좌표를 못 읽어도 상세는 그대로 나갑니다 */
    const geo = await this.geo.listingGeo(id, !!isOwn, ad).catch(() => null);
    return { ...rest, address, isOwn, owner: { ...rest.owner, ...ownerStats }, canInquire, inquireBlockReason: reason, geo };
  }

  /**
   * 등록자(소개자)가 받은 후기 — 매물 상세의 「소개자 후기」 (v10.21 · D023).
   *
   * 누구나 봅니다. 그래서 작성자는 **이름 첫 글자만** 내보내고(김○○), 본문의 연락처는 가립니다.
   * 계정 id · 이메일 · 거래 id 는 응답에 넣지 않습니다 — 후기로 거래 상대를 알아낼 수 있으면 안 됩니다.
   */
  async listReviews(listingId: string) {
    const [l] = await this.db.query<{ owner: string }>(
      `SELECT owner_account_id AS owner FROM listings WHERE id = $1 AND status = 'PUBLISHED'`, [listingId]);
    if (!l) throw new NotFoundException({ code: 'NOT_FOUND', message: '매물을 찾을 수 없습니다.' });

    const rows = await this.db.query<{
      id: string; rating: number; body: string | null; created_at: Date; name: string | null;
    }>(
      `SELECT r.id, r.rating, r.body, r.created_at, a.name
         FROM deal_reviews r JOIN accounts a ON a.id = r.author_id
        WHERE r.target_id = $1
        ORDER BY r.created_at DESC, r.id DESC LIMIT 20`, [l.owner]);
    const [agg] = await this.db.query<{ n: number; avg: number | null }>(
      `SELECT review_count AS n, rating::float8 AS avg FROM v_owner_public_stats WHERE account_id = $1`, [l.owner]);

    return {
      count: Number(agg?.n ?? 0),
      average: agg?.avg ?? null,
      items: rows.map((r) => ({
        id: r.id,
        authorName: `${[...(r.name ?? '').trim()][0] ?? '회'}○○`,
        rating: r.rating,
        body: r.body ? this.mask(r.body) : null,
        createdAt: r.created_at,
      })),
    };
  }

  /** SB-MYP-LST-010. 반려 사유를 함께 내려 재제출 동선의 근거로 씁니다. */
  myListings(limit = 50) {
    return this.repo.mine(RequestCtx.actorId()!, clampLimit(limit));
  }

  /**
   * 공개 문의 (SB-HOM-MCH-020).
   *
   * 1:1 문의와 다릅니다 — 누구나 볼 수 있으므로 연락처를 마스킹합니다.
   * 마스킹하지 않으면 플랫폼 밖으로 대화가 새고, 그러면 귀속도 성사도 잡히지 않습니다.
   */
  private mask(text: string): string {
    return text
      .replace(/01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[연락처]')
      .replace(/0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[연락처]')
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[이메일]');
  }

  async listQuestions(listingId: string) {
    const me = RequestCtx.actorId();
    const rows = await this.db.query<{
      id: string; question: string; answer: string | null;
      answered_at: Date | null; created_at: Date;
      company_name: string | null; is_owner: boolean;
    }>(
      `SELECT q.id, q.question, q.answer, q.answered_at, q.created_at,
              b.company_name,
              (l.owner_account_id = $2::uuid) AS is_owner
         FROM public_questions q
         JOIN listings l ON l.id = q.listing_id
         LEFT JOIN businesses b ON b.account_id = q.asker_id AND b.verified_at IS NOT NULL
        WHERE q.listing_id = $1 AND NOT q.is_hidden
        ORDER BY q.created_at DESC`,
      [listingId, me ?? null],
    );
    return rows.map((r) => ({
      id: r.id,
      question: this.mask(r.question),
      answer: r.answer ? this.mask(r.answer) : null,
      answeredAt: r.answered_at,
      askerName: r.company_name ?? '비공개',
      createdAt: r.created_at,
      canAnswer: r.is_owner && !r.answer,
    }));
  }

  async askQuestion(listingId: string, question: string) {
    const me = RequestCtx.actorId()!;
    const [l] = await this.db.query<{ owner_account_id: string; status: string }>(
      `SELECT owner_account_id, status FROM listings WHERE id = $1`, [listingId]);
    if (!l || l.status !== 'PUBLISHED') {
      throw new NotFoundException({ code: 'NOT_FOUND', message: '매물을 찾을 수 없습니다.' });
    }
    if (l.owner_account_id === me) {
      throw new StateConflict('OWN_LISTING', '본인 매물에는 문의할 수 없습니다.');
    }
    const [row] = await this.db.query<{ id: string }>(
      `INSERT INTO public_questions (listing_id, asker_id, question)
       VALUES ($1,$2,$3) RETURNING id`,
      [listingId, me, question]);
    return { id: row.id };
  }

  /** 답변은 매물 주인만. 0행이면 권한이 없거나 이미 답변한 것입니다 */
  async answerQuestion(questionId: string, answer: string) {
    const me = RequestCtx.actorId()!;
    const [row] = await this.db.query<{ id: string }>(
      `UPDATE public_questions q
          SET answer = $3, answered_at = now()
         FROM listings l
        WHERE q.id = $1 AND l.id = q.listing_id
          AND l.owner_account_id = $2 AND q.answer IS NULL
      RETURNING q.id`,
      [questionId, me, answer]);
    if (!row) {
      throw new StateConflict('ALREADY_ANSWERED', '답변할 수 없습니다. 이미 답변했거나 권한이 없습니다.');
    }
    return { id: row.id };
  }
}
