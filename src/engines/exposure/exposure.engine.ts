import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';

/**
 * 노출·랭킹 엔진 (B-13R2 · B-20 · INV-11)
 *
 * 제약이 기능보다 중요한 엔진입니다.
 *   INV-11   플랫폼은 특정 매물을 추천하지 않는다
 *   전상법    노출 순위가 대가에 따른 것이면 표시해야 한다
 *
 * 따라서 기본 정렬에는 구독 가중치를 적용하지 않습니다.
 * 유료 노출은 별도 영역에서 라벨과 함께만 나갑니다.
 */
export type SortMode = 'RECENT' | 'RELEVANCE' | 'FEE_DESC';

@Injectable()
export class ExposureEngine {
  constructor(private readonly db: DatabaseService) {}

  /** 기본 목록 — 중립 정렬. 구독 등급이 순서에 영향을 주지 않습니다. */
  organic(params: {
    gwanCode: string; categoryId?: string; keyword?: string;
    sort?: SortMode; cursor?: string; limit?: number;
  }) {
    const limit = Math.min(params.limit ?? 20, 50);
    const order =
      params.sort === 'FEE_DESC' ? 'l.desired_fee DESC NULLS LAST, l.id DESC'
      : params.sort === 'RELEVANCE' && params.keyword
        ? 'fn_search_rank(l.title, $3) ASC, l.id DESC'
        : 'l.published_at DESC NULLS LAST, l.id DESC';

    return this.db.query(
      `SELECT l.id, l.title, l.grade_code, l.desired_fee, l.published_at,
              false AS is_ad, NULL::text AS ad_label
         FROM listings l
        WHERE l.status = 'PUBLISHED'
          AND l.gwan_code = $1
          AND ($2::uuid IS NULL OR l.category_id = $2)
          /* ★ pg_trgm 의 % 는 **한글에서 0건**을 냅니다(로케일 C).
           *   785건이 있는데 0건이 나와, 이용자는 매물이 없다고 믿고
           *   떠납니다. 1만 건을 넣고서야 드러났습니다. */
          /* LIKE 를 먼저 — 색인을 타게 합니다(C650). 한글은 pg_bigm 색인(C970 · K2). */
          AND ($3::text IS NULL OR
               lower(coalesce(l.title,'') || ' ' || coalesce(l.body,''))
                 LIKE fn_search_like(fn_search_head($3)))  /* K4 — % · _ 이스케이프 */
          AND ($3::text IS NULL OR fn_search_match(l.title, l.body, $3))
          AND l.is_priority_exposed = false
        ORDER BY ${order}
        LIMIT $4`,
      [params.gwanCode, params.categoryId ?? null, params.keyword ?? null, limit],
    );
  }

  /**
   * 우선노출 영역 — 별도 슬롯. 라벨 없이는 나갈 수 없습니다(DB CHECK).
   * 슬롯 수는 구독 등급의 priority_slot_count 로 제한됩니다.
   */
  promoted(gwanCode: string, categoryId?: string, limit = 3) {
    return this.db.query(
      `SELECT l.id, l.title, l.grade_code, l.desired_fee,
              true AS is_ad, l.priority_label AS ad_label
         FROM listings l
         JOIN subscriptions s ON s.account_id = l.owner_account_id
                             AND s.status IN ('ACTIVE','PAST_DUE')
         JOIN subscription_plans p ON p.code = s.plan_code
        WHERE l.status = 'PUBLISHED'
          AND l.is_priority_exposed
          AND l.gwan_code = $1
          AND ($2::uuid IS NULL OR l.category_id = $2)
          AND p.priority_slot_count > 0
        ORDER BY p.exposure_weight DESC, random()
        LIMIT $3`,
      [gwanCode, categoryId ?? null, limit],
    );
  }

  /**
   * 목록 조립. 광고 블록과 일반 목록을 분리해 반환합니다.
   * 하나의 배열로 섞어 내보내면 프런트가 라벨을 빠뜨릴 수 있습니다.
   */
  async list(params: Parameters<ExposureEngine['organic']>[0]) {
    const [promoted, organic] = await Promise.all([
      this.promoted(params.gwanCode, params.categoryId),
      this.organic(params),
    ]);
    return { promoted, organic, notice: '광고 영역은 유료 노출입니다.' };
  }
}
