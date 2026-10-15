import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';

/**
 * 리스팅 조회.
 *
 * 목록 쿼리가 부분 인덱스 idx_listings_browse 를 그대로 타도록 짰습니다.
 * 조건 순서를 바꾸면 인덱스를 놓칩니다.
 */
@Injectable()
export class ListingRepository {
  constructor(private readonly db: DatabaseService) {}

  /** 카드 한 장에 필요한 것을 한 번에. N+1 을 만들지 않습니다.
   *  v10.31 — 시안 카드의 사진 · 지역 · 거래 금액 · 한줄 소개 · 매물번호 · 소개 신뢰도 · 급구/급매(기한)를 함께 싣습니다.
   *  사진은 매물에 붙은 첫 장의 공개 주소(GET /listings/{id}/photos/0) — 없으면 null(화면이 분류 그림을 씁니다). */
  private readonly CARD = `
    l.id, l.gwan_code AS "gwanCode", cat.name AS "categoryName",
    l.title, l.desired_fee AS "desiredFee",
    fb.label AS "feeBearerLabel",
    l.published_at AS "publishedAt", l.like_count AS "likeCount",
    /* v10.31 (w1 · 공유) — 시안 통합 검색 표의 「등급 · 조회」(골든 · 실버 · 브론즈 — 가칭 · code_labels listing.grade) */
    l.grade_code AS "gradeCode", (SELECT label FROM code_labels WHERE domain='listing.grade' AND code=l.grade_code) AS "gradeLabel",
    l.view_count AS "viewCount",
    l.is_priority_exposed AS "isAd", l.priority_label AS "adLabel",
    jsonb_build_object(
      'companyName', coalesce(b.company_name, '개인'),
      'verified',    (b.verified_at IS NOT NULL),
      'confirmedDeals', coalesce(st.confirmed_deals, 0)
    ) AS owner,
    coalesce(bg.badges, '[]'::jsonb) AS badges,
    l.listing_no AS "listingNo", l.summary, l.deal_amount AS "dealAmount",
    fn_is_realty_category(l.category_id) AS "isRealty",
    CASE WHEN vr.sido IS NULL THEN NULL
         ELSE jsonb_build_object('sidoCode', vr.sido_code, 'sido', vr.sido, 'sigungu', vr.sigungu) END AS region,
    CASE WHEN ph.n > 0 THEN '/api/v1/listings/' || l.id || '/photos/0' END AS "thumbUrl",
    coalesce(ph.n, 0) AS "photoCount",
    tr.score AS "trustScore",
    CASE WHEN ur.kind IS NULL THEN NULL
         ELSE jsonb_build_object('kind', CASE ur.kind WHEN 'URGENT_SALE' THEN 'SELL' ELSE 'BUY' END,
                                 'label', CASE ur.kind WHEN 'URGENT_SALE' THEN '급매' ELSE '급구' END,
                                 'until', ur.until) END AS urgent`;

  private readonly JOINS = `
    JOIN categories cat ON cat.id = l.category_id
    LEFT JOIN businesses b ON b.account_id = l.owner_account_id AND b.verified_at IS NOT NULL
    LEFT JOIN v_introducer_stats st ON st.account_id = l.owner_account_id
    LEFT JOIN code_labels fb ON fb.domain = 'fee.bearer' AND fb.code = l.fee_bearer
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
               'type', x.badge_type,
               'label', coalesce(cl.short_label, cl.label, x.badge_type),
               'validUntil', x.valid_until)) AS badges
        FROM listing_badges x
        LEFT JOIN code_labels cl ON cl.domain = 'badge.type' AND cl.code = x.badge_type
       WHERE x.listing_id = l.id AND x.status = 'GRANTED'
         AND (x.valid_until IS NULL OR x.valid_until > now())
    ) bg ON true
    LEFT JOIN v_listing_region vr ON vr.listing_id = l.id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS n FROM listing_media m
       WHERE m.listing_id = l.id AND m.media_type = 'IMAGE' AND m.file_id IS NOT NULL) ph ON true
    LEFT JOIN v_account_trust tr ON tr.account_id = l.owner_account_id
    LEFT JOIN v_listing_urgent ur ON ur.listing_id = l.id`;

  /** v10.31 — 사진 n번째(0부터) — 게시 중이거나 주인이 볼 때 */
  photo(id: string, n: number) {
    return this.db.query<{ storage_key: string; content_type: string; size_bytes: number; status: string; owner: string }>(
      `SELECT f.storage_key, f.content_type, f.size_bytes, l.status, l.owner_account_id AS owner
         FROM listings l
         JOIN LATERAL (SELECT mm.file_id FROM listing_media mm
                        WHERE mm.listing_id = l.id AND mm.media_type = 'IMAGE' AND mm.file_id IS NOT NULL
                        ORDER BY mm.sort_order, mm.created_at OFFSET $2 LIMIT 1) m ON true
         JOIN files f ON f.id = m.file_id AND f.status = 'READY'
        WHERE l.id = $1`, [id, n]);
  }

  /** v10.31 — 급구 · 급매 화면의 분류 묶음(시안 UCATS: 부동산 · 자동차 · 창업/프랜차이즈 · 기계/설비 · 생활/기타).
   *  서버 분류에 묶음 칸이 없어 **분류 이름 · 관 · 축**으로 정합니다(한 곳에만 둠 — 화면은 코드만 보냅니다). */
  static readonly GROUP_SQL: Record<string, string> = {
    RE:      `(fn_is_realty_category(l.category_id) OR cat.name ~ '부동산|상가|건물|토지|아파트|주택|오피스|사무실|공장|창고')`,
    CAR:     `(cat.name ~ '자동차|중고차|상용차|특장차|오토바이|화물')`,
    BIZ:     `(l.gwan_code = 'BIZ' OR cat.name ~ '창업|프랜차이즈|가맹|점포|양수도|출점')`,
    MACHINE: `(cat.name ~ '기계|설비|장비|부품|플랜트|집기')`,
  };

  /** 기본 목록 — 구독 가중치를 적용하지 않습니다 (INV-11). */
  organic(p: {
    gwanCode?: string; categoryId?: string; keyword?: string; badge?: string;
    sort?: string; cursor?: { sortValue: string; id: string } | null; limit: number; match?: string;
    /* v10.31 — 지역(시 · 도 코드 · 「ETC」= 시안 「기타 지역」) · 안심소개 축 · 급구/급매 · 분류 묶음 · 쪽 번호 */
    regionCode?: string; axis?: string; urgent?: string; group?: string; offset?: number;
  }) {
    /* ── 정렬 키와 커서 (20260930) ─────────────────────────────────
     * ★ 전에는 어떤 정렬이든 커서를 `published_at < ?` 하나로만 걸었습니다.
     *   소개비순(FEE_DESC) 2쪽이 "1쪽 마지막보다 오래된 것" 이 되어
     *   건너뛰거나 겹쳤고, 같은 시각 등록은 잘렸습니다.
     *   정렬마다 (키, id) 쌍으로 이어 갑니다.
     * ★ POPULAR 신설 — 사용자 웹의 '베스트' 가 이 값을 보내는데 서버에
     *   없어 400 → 화면 500 이었습니다. 관심(like) 우선, 조회수 다음.
     * ★ v10.31 — 시안 정렬 「마감임박 · 소개비율」.
     *   DEADLINE  급구 · 급매 기한이 가까운 순(기한 없는 건은 뒤 · 최신순). 내림차순 하나로 키셋을 쓰려고 「남은 초」에 마이너스를 붙입니다.
     *   FEE_RATIO 소개비 ÷ 거래 금액이 큰 순(둘 중 하나라도 없으면 뒤). 비율은 플랫폼이 정하는 값이 아니라 등록자가 적은 두 값의 나눗셈입니다(A-12). */
    const KEY: Record<string, { expr: string; type: string }> = {
      FEE_DESC: { expr: 'coalesce(l.desired_fee, -1)::numeric', type: 'numeric' },
      POPULAR:  { expr: '(l.like_count::numeric * 1000000 + least(l.view_count, 999999))', type: 'numeric' },
      RECENT:   { expr: "coalesce(l.published_at, 'epoch'::timestamptz)", type: 'timestamptz' },
      DEADLINE: { expr: "(CASE WHEN ur.until IS NOT NULL THEN 4000000000 - extract(epoch FROM ur.until) ELSE extract(epoch FROM coalesce(l.published_at, 'epoch'::timestamptz)) / 1000 END)::numeric", type: 'numeric' },
      FEE_RATIO: { expr: "(CASE WHEN l.desired_fee IS NOT NULL AND l.deal_amount > 0 THEN round(l.desired_fee / l.deal_amount, 8) ELSE -1 END)::numeric", type: 'numeric' },
      /* v10.31 — 급구 · 급매 화면의 「낮은 가격순 · 높은 가격순」(거래 금액 · 금액이 없으면 뒤) */
      AMOUNT_DESC: { expr: 'coalesce(l.deal_amount, -1)::numeric', type: 'numeric' },
      AMOUNT_ASC:  { expr: '(CASE WHEN l.deal_amount IS NULL THEN -1e18 ELSE -l.deal_amount END)::numeric', type: 'numeric' },
    };
    const rel = p.sort === 'RELEVANCE' && !!p.keyword;
    const k = KEY[p.sort ?? ''] ?? KEY.RECENT;
    const order = rel ? 'fn_search_rank(l.title, $3) ASC, l.id DESC' : `${k.expr} DESC, l.id DESC`;
    /* 관련도순은 점수가 요청마다 달라 키셋을 걸 수 없습니다 — 첫 쪽만 의미가 있습니다 */
    /* 20261002 — 관련도순에서도 $5 · $7 을 식에 남깁니다. 'TRUE' 만 두면 형을 못 정해 500 이었습니다(키셋 도입 회귀). */
    const after = rel || p.offset != null
      ? '($5::text IS NULL OR $7::uuid IS NULL OR TRUE)'
      : `($5::text IS NULL OR (${k.expr}, l.id) < ($5::${k.type}, $7::uuid))`;
    /* 20261001 — 다른 정렬에서 만든 커서가 오면(예: 베스트 커서로 최신순 2쪽) 형 변환에서 터집니다.
     * 커서 값이 이 정렬의 형에 맞지 않으면 첫 쪽으로 돌립니다 — 400 을 줄 일이 아닙니다. */
    const sv = p.cursor?.sortValue;
    if (sv != null && !rel) {
      const okType = k.type === 'timestamptz' ? !Number.isNaN(Date.parse(sv)) && /\D/.test(sv) : /^-?\d+(\.\d+)?$/.test(sv);
      if (!okType) p = { ...p, cursor: null };
    }
    const where = this.filters(p);

    return this.db.query(
      `SELECT ${this.CARD}, (${k.expr})::text AS "_sk"
         FROM listings l ${this.JOINS}
        WHERE ${where}
          AND ${after}
        ORDER BY ${order}
        LIMIT $6 ${p.offset != null ? 'OFFSET $13' : ''}`,
      /* 자리 번호: $1 관 · $2 분류 · $3 낱말 · $4 배지 · $5 커서값 · $6 한도 · $7 커서 id · $8 지역 · $9 축 · $10 급구/급매 · $11 묶음 · $12 제목만(w1 match=TITLE) · $13 건너뛸 수 */
      [...this.params(p), p.cursor?.sortValue ?? null, p.limit + 1, p.cursor?.id ?? null,
       p.regionCode ?? null, p.axis ?? null, p.urgent ?? null, p.group ?? null, p.match === 'TITLE',
       ...(p.offset != null ? [p.offset] : [])],
    );
  }

  /** v10.31 — 같은 조건의 전체 건수(쪽 번호용) */
  async count(p: { gwanCode?: string; categoryId?: string; keyword?: string; badge?: string;
    regionCode?: string; axis?: string; urgent?: string; group?: string; match?: string }) {
    const [r] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM listings l
         JOIN categories cat ON cat.id = l.category_id
         LEFT JOIN v_listing_region vr ON vr.listing_id = l.id
         LEFT JOIN v_listing_urgent ur ON ur.listing_id = l.id
        WHERE ${this.filters(p)}
          AND ($5::text IS NULL OR TRUE) AND ($6::int IS NULL OR TRUE) AND ($7::uuid IS NULL OR TRUE)`,
      [...this.params(p), null, null, null, p.regionCode ?? null, p.axis ?? null, p.urgent ?? null, p.group ?? null, p.match === 'TITLE']);
    return r?.n ?? 0;
  }

  private params(p: { gwanCode?: string; categoryId?: string; keyword?: string; badge?: string }) {
    return [p.gwanCode ?? null, p.categoryId ?? null, p.keyword ?? null, p.badge ?? null];
  }

  /** 목록 · 건수가 같은 조건을 씁니다 — $1~$4 · $8~$12 */
  private filters(p: { group?: string }) {
    const grp = p.group === 'LIFE'
      ? `NOT (${Object.values(ListingRepository.GROUP_SQL).join(' OR ')})`
      : p.group && ListingRepository.GROUP_SQL[p.group] ? ListingRepository.GROUP_SQL[p.group] : 'TRUE';
    return `l.status = 'PUBLISHED'
          AND l.is_priority_exposed = false
          AND ($1::text IS NULL OR l.gwan_code = $1)
          AND ($2::uuid IS NULL OR l.category_id = $2)
          /* ★ pg_trgm 의 % 는 **한글에서 0건**을 냅니다(로케일 C).
           *   785건이 있는데 0건이 나와, 이용자는 매물이 없다고
           *   믿고 떠납니다. 부분 일치로 바꿨습니다. */
          /* ★ LIKE 가 **먼저** 와야 trigram 인덱스를 탑니다.
           *   순서를 바꾸면 전 행에 함수가 돌아 1만 건에서 74ms 입니다.
           *   LIKE 로 후보를 좁히고, 나머지 낱말 판정은 함수가 합니다 —
           *   검색 규칙은 여전히 한 곳(fn_search_match)에만 있습니다.
           * ★ K2 — 한글 2글자 검색은 trigram 색인을 **타지 못합니다**(실측 5만 건
           *   Seq Scan 56ms). C970 의 pg_bigm 색인(idx_listings_search_bigm)이
           *   같은 식에 걸려 있어 운영에서는 그 색인을 탑니다(3.4ms). */
          AND ($3::text IS NULL OR
               lower(coalesce(l.title,'') || ' ' || coalesce(l.body,''))
                 LIKE fn_search_like(fn_search_head($3)))  /* K4 — % · _ 이스케이프 */
          AND ($3::text IS NULL OR fn_search_match(l.title, l.body, $3))
          /* v10.31 — match=TITLE: 제목 · 업종 이름에 든 것만(시안 통합 검색) */
          AND ($3::text IS NULL OR NOT $12::boolean OR lower(l.title) LIKE fn_search_like($3) OR lower(cat.name) LIKE fn_search_like($3))
          AND ($4::text IS NULL OR EXISTS (
                SELECT 1 FROM listing_badges bb
                 WHERE bb.listing_id = l.id AND bb.badge_type = $4
                   AND bb.status = 'GRANTED'
                   AND (bb.valid_until IS NULL OR bb.valid_until > now())))
          /* v10.31 — 지역: 시 · 도 코드(앞 2자리로 맞춤) · ETC = 시안 「지역으로 찾기」 9곳 밖 */
          AND ($8::text IS NULL
               OR ($8 = 'ETC' AND (vr.sido_code IS NULL OR vr.sido_code NOT IN (SELECT code FROM regions WHERE sort_order < 99)))
               OR left(vr.sido_code, 2) = left($8, 2))
          /* v10.31 — 안심소개 축(RE · EQUIP · CONSULT) */
          AND ($9::text IS NULL OR cat.axis = $9)
          /* v10.31 — 급구(BUY) · 급매(SELL) · 둘 다(ANY) */
          AND ($10::text IS NULL
               OR ($10 = 'ANY' AND ur.kind IS NOT NULL)
               OR ($10 = 'BUY' AND ur.kind = 'URGENT')
               OR ($10 = 'SELL' AND ur.kind = 'URGENT_SALE'))
          AND ($11::text IS NULL OR ${grp})`;
  }

  /** 우선노출 — 별도 슬롯. 라벨 없이는 DB 가 애초에 저장을 막습니다 (B-20). */
  promoted(gwanCode?: string, categoryId?: string, limit = 3) {
    return this.db.query(
      `SELECT ${this.CARD}
         FROM listings l ${this.JOINS}
         JOIN subscriptions s ON s.account_id = l.owner_account_id
                             AND s.status IN ('ACTIVE','PAST_DUE')
         JOIN subscription_plans pl ON pl.code = s.plan_code AND pl.priority_slot_count > 0
        WHERE l.status = 'PUBLISHED' AND l.is_priority_exposed
          AND ($1::text IS NULL OR l.gwan_code = $1)
          AND ($2::uuid IS NULL OR l.category_id = $2)
        ORDER BY pl.exposure_weight DESC, random()
        LIMIT $3`,
      [gwanCode ?? null, categoryId ?? null, limit],
    );
  }

  detail(id: string, viewerId?: string) {
    return this.db.query(
      `SELECT ${this.CARD},
              l.body, l.status, sl.label AS "statusLabel", l.version,
              l.view_count AS "viewCount",
              /* v10.31 — 수정 화면(SB-HOM-REG-020)이 업종을 그대로 다시 보낼 수 있게(전: 없어서 수정이 늘 400 「categoryId must be a UUID」) */
              l.category_id AS "categoryId", l.fee_bearer AS "feeBearer",
              /* v10.31 — 시안 등록 폼 칸. 소재지는 시 · 구만 공개(상세주소 · 우편번호는 본인만 — service 가 거름) */
              l.contract_support AS "contractSupport", l.contact_hours AS "contactHours",
              l.address AS "_address", l.biz_info AS "bizInfo",
              /* v10.21 (D023) — 등록자의 공개 실적. 누적수익(settledAmount)은 뷰가 가립니다 —
               * 본인이 공개를 켜지 않았으면 null 입니다. 여기서 v_introducer_stats 를 직접 읽지 않습니다. */
              jsonb_build_object(
                'joinedAt',       ops.joined_at,
                'totalDeals',     ops.total_deals,
                'successRate',    ops.success_rate,
                'settledAmount',  ops.settled_amount,
                'earningsPublic', ops.earnings_public,
                'reviewCount',    ops.review_count,
                'rating',         ops.rating) AS "ownerStats",
              /* v10.31 — 사진은 공개 주소로(저장소 키를 내보내지 않음). 올리기 확인을 마친 사진만 */
              coalesce(m.urls, ARRAY[]::text[]) AS "mediaUrls",
              coalesce(m.ids, ARRAY[]::uuid[]) AS "mediaIds",
              CASE WHEN vr.sido IS NULL THEN ARRAY[]::text[]
                   ELSE ARRAY[btrim(vr.sido || ' ' || coalesce(vr.sigungu, ''))] END AS "regionNames",
              (SELECT x.region_code FROM listing_regions x JOIN regions rr ON rr.code = x.region_code
                WHERE x.listing_id = l.id ORDER BY rr.sort_order LIMIT 1) AS "regionCode",
              l.region_detail AS "regionDetail",
              jsonb_build_object('score', tr.score, 'business', tr.biz, 'identity', tr.idv, 'deals', tr.deals,
                                 'successRate', tr.success_rate, 'rating', tr.rating, 'reviewCount', tr.review_count,
                                 'disputes', tr.disputes, 'consentRate', tr.consent_rate) AS trust,
              (l.owner_account_id = $2::uuid) AS "isOwn",
              EXISTS (SELECT 1 FROM favorites f
                       WHERE f.account_id = $2::uuid
                         AND f.target_type = 'LISTING' AND f.target_id = l.id) AS liked
         FROM listings l ${this.JOINS}
         JOIN v_owner_public_stats ops ON ops.account_id = l.owner_account_id
         LEFT JOIN code_labels sl ON sl.domain = 'listing.status' AND sl.code = l.status
         LEFT JOIN LATERAL (
           /* v10.31 — 사진 공개 주소(파일 id 를 드러내지 않음) · w1 주소 /images/{n} 과 같은 사진 */
           SELECT array_agg('/api/v1/listings/' || l.id || '/photos/' || (q.rn - 1) ORDER BY q.rn) AS urls,
                  array_agg(q.id ORDER BY q.rn) AS ids
             FROM (SELECT mm.id, row_number() OVER (ORDER BY mm.sort_order, mm.created_at) AS rn
                     FROM listing_media mm
                    WHERE mm.listing_id = l.id AND mm.media_type = 'IMAGE' AND mm.file_id IS NOT NULL) q) m ON true
        WHERE l.id = $1`,
      [id, viewerId ?? null],
    );
  }

  mine(ownerId: string, limit: number) {
    return this.db.query(
      `SELECT l.id, l.title, l.status, sl.label AS "statusLabel",
              l.desired_fee AS "desiredFee", l.version,
              l.published_at AS "publishedAt", l.updated_at AS "updatedAt",
              ri.status AS "reviewStatus", ri.reject_reason_code AS "rejectReasonCode",
              rc.label AS "rejectReasonLabel", ri.sla_due_at AS "slaDueAt"
         FROM listings l
         LEFT JOIN code_labels sl ON sl.domain = 'listing.status' AND sl.code = l.status
         LEFT JOIN LATERAL (
           SELECT status, reject_reason_code, sla_due_at FROM review_items
            WHERE target_type = 'LISTING' AND target_id = l.id
            ORDER BY submitted_at DESC LIMIT 1) ri ON true
         LEFT JOIN review_reason_codes rc ON rc.code = ri.reject_reason_code
        WHERE l.owner_account_id = $1
        ORDER BY l.updated_at DESC LIMIT $2`,
      [ownerId, limit],
    );
  }
}
