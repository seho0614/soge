import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { storageFromEnv } from '../file/storage';
import { SearchService } from '../search/search.service';

/**
 * v10.31 (w2 · 10/10 「시안 기준」) — 관 화면(소개장터 · 안심소개 · 소개창업)의 시안 구역 중 서버 자료가 없던 것.
 *
 *   지역으로 찾기(regions) · 많이 찾는 키워드(keywords) · 소개 요청 종류 · 지역 · 사진(requests) ·
 *   성공현황(success) · 최근 연결 사례(recentCases) · 베스트매칭(best) · 업체 단위 목록 · 프로필 · AI 추천(suppliers).
 *
 * ── 숫자를 지어내지 않습니다 ──
 *   모든 숫자는 기록(deals · listings · reviews · search_term_stats)에서 그 자리에서 셉니다. 자료가 없으면 0 · 빈 목록이고,
 *   화면은 「아직 없습니다」를 그립니다(견본을 진짜처럼 내지 않음).
 * ── 가림 규칙 ──
 *   사람 이름은 첫 글자만(김○○) · 업체명은 인증 사업자만(공개 매물 카드와 같음) · 개인 소개자의 수익은 본인이 공개를 켠 경우만 ·
 *   계정 id · 연락처 · 사업자번호 · 대표자명은 내보내지 않습니다.
 */
@Injectable()
export class MarketService {
  constructor(private readonly db: DatabaseService, private readonly search: SearchService) {}

  /* ── 지역으로 찾기 ───────────────────────────────────────────────── */
  /** 시 · 도 17곳과 그 관의 게시 매물 수. 시안 순서(서울 · 경기 · 인천 · 대전 · 대구 · 부산 · 울산 · 광주 · 제주)가 먼저이고 나머지는 「기타 지역」 */
  async regions(gwanCode?: string) {
    const rows = await this.db.query<{ code: string; sido: string; o: number; n: number }>(
      `SELECT r.code, r.sido, r.sort_order AS o,
              (SELECT count(*)::int FROM listings l JOIN v_listing_region vr ON vr.listing_id = l.id
                WHERE l.status = 'PUBLISHED' AND NOT l.is_priority_exposed
                  AND ($1::text IS NULL OR l.gwan_code = $1) AND vr.sido_code = r.code) AS n
         FROM regions r WHERE r.is_active AND r.sigungu IS NULL
        ORDER BY r.sort_order, r.code`, [gwanCode ?? null]);
    const main = rows.filter((r) => r.o < 99);
    const etc = rows.filter((r) => r.o >= 99);
    const [none] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM listings l JOIN v_listing_region vr ON vr.listing_id = l.id
        WHERE l.status = 'PUBLISHED' AND NOT l.is_priority_exposed
          AND ($1::text IS NULL OR l.gwan_code = $1) AND vr.sido_code IS NULL`, [gwanCode ?? null]);
    return {
      items: main.map((r) => ({ code: r.code, name: r.sido, count: r.n })),
      etc: { code: 'ETC', name: '기타 지역', count: etc.reduce((a, r) => a + r.n, 0) + (none?.n ?? 0),
             includes: etc.map((r) => r.sido) },
      all: rows.map((r) => ({ code: r.code, name: r.sido })),
      note: '매물에 넣은 시 · 도가 먼저, 없으면 등록자의 인증 사업장 주소로 셉니다. 「기타 지역」에는 지역을 알 수 없는 매물도 들어갑니다.',
    };
  }

  /* ── 많이 찾는 키워드 ───────────────────────────────────────────── */
  /**
   * 검색어 통계(search_term_stats — 정규화된 말만 · INV-SCH2)에서 결과가 나온 말을 많이 찾은 순으로.
   * 제한업종 낱말은 빼고(검색 팝업 kwSafe 와 같은 규칙), gwanCode 를 주면 그 관의 게시 매물에서 실제로 걸리는 말만 둡니다.
   * 합침(v10.31): 검색 팝업 칩(GET /search/suggest)과 같은 함수(SearchService.popularKeywords) — 쓰기는 w1 POST /search/log.
   */
  async keywords(gwanCode?: string, limit = 5) {
    /* 합침(v10.31) — 규칙은 검색 모듈 한 곳(SearchService.popularKeywords · 쓰기는 POST /search/log) */
    const items = await this.search.popularKeywords({ gwanCode: gwanCode ?? null, limit });
    return { items: items.map((r) => ({ term: r.term, hits: r.hits })),
      basis: '검색어 통계(정규화된 말 · 결과가 나온 검색만). 제한 업종 낱말은 뺍니다.' };
  }

  /* ── 소개 요청(종류 · 지역 · 사진) ─────────────────────────────── */
  async requests(q: { gwanCode?: string; kind?: string; regionCode?: string; limit?: number }) {
    const lim = Math.min(Math.max(Number(q.limit) || 4, 1), 30);
    const rows = await this.db.query(
      `SELECT r.id, r.gwan_code AS "gwanCode", r.title, c.name AS "categoryName",
              r.budget_min AS "budgetMin", r.budget_max AS "budgetMax", r.offered_fee AS "offeredFee",
              r.created_at AS "createdAt", r.kind, kl.label AS "kindLabel",
              coalesce(rg.sido, rb.sido) AS sido,
              CASE WHEN rg.code IS NOT NULL THEN r.region_detail
                   ELSE coalesce(r.region_detail, nullif(split_part(btrim(coalesce(b.sigungu,'')), ' ', 1), '')) END AS sigungu,
              CASE WHEN r.photo_file_id IS NOT NULL THEN '/api/v1/market/requests/' || r.id || '/photo' END AS "photoUrl",
              (SELECT count(*)::int FROM request_proposals p WHERE p.request_id = r.id) AS "proposalCount"
         FROM requests r
         LEFT JOIN categories c ON c.id = r.category_id
         LEFT JOIN code_labels kl ON kl.domain = 'request.kind' AND kl.code = r.kind
         LEFT JOIN regions rg ON rg.code = r.region_code
         LEFT JOIN LATERAL (SELECT bb.sido, bb.sigungu FROM businesses bb
                             WHERE bb.account_id = r.owner_account_id AND bb.verified_at IS NOT NULL LIMIT 1) b ON true
         LEFT JOIN regions rb ON rb.code = fn_sido_code(b.sido)
        WHERE r.status = 'PUBLISHED'
          AND ($1::text IS NULL OR r.gwan_code = $1)
          AND ($2::text IS NULL OR r.kind = $2)
          AND ($3::text IS NULL OR left(coalesce(r.region_code, fn_sido_code(b.sido)), 2) = left($3, 2))
        ORDER BY r.created_at DESC LIMIT $4`,
      [q.gwanCode ?? null, q.kind ?? null, q.regionCode ?? null, lim]);
    const kinds = await this.db.query<{ code: string; label: string; n: number }>(
      `SELECT k.code, k.label,
              (SELECT count(*)::int FROM requests r WHERE r.status = 'PUBLISHED' AND r.kind = k.code
                  AND ($1::text IS NULL OR r.gwan_code = $1)) AS n
         FROM code_labels k WHERE k.domain = 'request.kind' AND k.is_active ORDER BY k.sort_order`, [q.gwanCode ?? null]);
    return { items: rows, kinds };
  }

  /** 요청자 본인이 종류 · 지역 · 사진을 정합니다(등록 화면은 소개받기 묶음 · w1 — 이 API 로 이어 붙입니다) */
  async patchRequest(id: string, dto: { kind?: string | null; regionCode?: string | null; regionDetail?: string | null; photoFileId?: string | null }) {
    const me = RequestCtx.actorId()!;
    const sets: string[] = []; const args: unknown[] = [id, me];
    const put = (col: string, v: unknown) => { args.push(v); sets.push(`${col} = $${args.length}`); };
    if (dto.kind !== undefined) put('kind', dto.kind || null);
    if (dto.regionCode !== undefined) put('region_code', dto.regionCode || null);
    if (dto.regionDetail !== undefined) put('region_detail', dto.regionDetail?.trim() || null);
    if (dto.photoFileId !== undefined) put('photo_file_id', dto.photoFileId || null);
    if (!sets.length) throw new PolicyViolation('NOTHING', '바꿀 항목이 없습니다.');
    const [row] = await this.db.query<{ id: string }>(
      `UPDATE requests SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $1 AND owner_account_id = $2 AND status NOT IN ('CLOSED','ARCHIVED') RETURNING id`, args);
    if (!row) throw new NotFound('요청을 찾을 수 없습니다.');
    return { ok: true, id: row.id };
  }

  async requestPhoto(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFound('사진이 없습니다.');
    const [f] = await this.db.query<{ storage_key: string; content_type: string; size_bytes: number; status: string; owner: string }>(
      `SELECT f.storage_key, f.content_type, f.size_bytes, r.status, r.owner_account_id AS owner
         FROM requests r JOIN files f ON f.id = r.photo_file_id AND f.status = 'READY'
        WHERE r.id = $1`, [id]);
    if (!f || (f.status !== 'PUBLISHED' && f.owner !== RequestCtx.actorId())) throw new NotFound('사진이 없습니다.');
    const stream = await storageFromEnv().open(f.storage_key);
    if (!stream) throw new NotFound('사진이 없습니다.');
    return { stream, contentType: f.content_type, size: Number(f.size_bytes) };
  }

  /* ── 성공현황 ─────────────────────────────────────────────────────── */
  /**
   * 시안 「성공현황」 — 숫자 5칸 · 최근 7일 추이 · 분류별 비중 · Top 소개왕 · 최근 성공 사례 · 회원/상품/지역 표.
   *   period = all | 7d | month | year — 숫자 5칸 · 추이는 늘 같은 기준(아래), 나머지는 고른 기간.
   *   날짜는 한국 시각으로 자릅니다.
   */
  async success(q: { gwanCode?: string; period?: string }) {
    const g = q.gwanCode ?? null;
    const P: Record<string, string> = {
      all: `TRUE`,
      '7d': `confirmed_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') - interval '6 days') AT TIME ZONE 'Asia/Seoul'`,
      month: `confirmed_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'`,
      year: `confirmed_at >= date_trunc('year', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'`,
    };
    const period = P[q.period ?? 'all'] ? (q.period ?? 'all') : 'all';
    const pw = P[period];
    const base = `FROM v_success_deals WHERE ($1::text IS NULL OR gwan_code = $1)`;

    const [k] = await this.db.query<any>(
      `WITH t AS (SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul') AS today,
                         (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul') AS mon,
                         ((date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - interval '1 month') AT TIME ZONE 'Asia/Seoul') AS pmon)
       SELECT count(*)::int AS total, coalesce(sum(fee),0)::numeric AS fee,
              count(*) FILTER (WHERE confirmed_at >= t.today)::int AS today_n,
              coalesce(sum(fee) FILTER (WHERE confirmed_at >= t.today),0)::numeric AS today_fee,
              count(*) FILTER (WHERE confirmed_at >= t.mon)::int AS month_n,
              coalesce(sum(fee) FILTER (WHERE confirmed_at >= t.mon),0)::numeric AS month_fee,
              count(*) FILTER (WHERE confirmed_at >= t.pmon AND confirmed_at < t.mon)::int AS pmonth_n,
              coalesce(sum(fee) FILTER (WHERE confirmed_at >= t.pmon AND confirmed_at < t.mon),0)::numeric AS pmonth_fee
         ${base.replace('FROM v_success_deals', 'FROM v_success_deals, t')}`, [g]);
    const [ip] = await this.db.query<{ n: number; today_n: number }>(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE d.created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'))::int AS today_n
         FROM deals d LEFT JOIN listings l ON l.id = d.listing_id LEFT JOIN requests r ON r.id = d.request_id
        WHERE d.status IN ('INQUIRY','NEGOTIATING','CONTRACTED','PAYMENT_REPORTED')
          AND ($1::text IS NULL OR coalesce(l.gwan_code, r.gwan_code) = $1)`, [g]);
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a - b) * 1000 / b) / 10 : null);
    const num = (v: unknown) => Number(v ?? 0);

    const trend = await this.db.query<{ day: string; n: number; fee: string }>(
      `SELECT to_char(d.day, 'MM.DD') AS day,
              count(s.deal_id)::int AS n, coalesce(sum(s.fee), 0)::numeric AS fee
         FROM generate_series(date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') - interval '6 days',
                              date_trunc('day', now() AT TIME ZONE 'Asia/Seoul'), interval '1 day') d(day)
         LEFT JOIN v_success_deals s ON (s.confirmed_at AT TIME ZONE 'Asia/Seoul')::date = d.day::date
                                    AND ($1::text IS NULL OR s.gwan_code = $1)
        GROUP BY d.day ORDER BY d.day`, [g]);

    const cats = await this.db.query<{ name: string; n: number; fee: string }>(
      `SELECT coalesce(category_name, '기타') AS name, count(*)::int AS n, coalesce(sum(fee),0)::numeric AS fee
         ${base} AND ${pw} GROUP BY 1 ORDER BY n DESC, fee DESC, name`, [g]);
    const totalN = cats.reduce((a, c) => a + c.n, 0);
    /* 원그래프는 위 5개 + 기타(시안 6칸) */
    const top5 = cats.slice(0, 5), rest = cats.slice(5);
    const catRows = [...top5, ...(rest.length ? [{ name: '기타', n: rest.reduce((a, c) => a + c.n, 0), fee: String(rest.reduce((a, c) => a + num(c.fee), 0)) }] : [])]
      .map((c) => ({ name: c.name, count: c.n, pct: totalN ? Math.round(c.n * 1000 / totalN) / 10 : 0, fee: num(c.fee) }));

    const regions = await this.db.query<{ name: string; n: number; fee: string }>(
      `SELECT coalesce(sido, '지역 미상') AS name, count(*)::int AS n, coalesce(sum(fee),0)::numeric AS fee
         ${base} AND ${pw} GROUP BY 1 ORDER BY n DESC, name`, [g]);

    /* Top 소개왕 — 성사된 거래의 소개자. 이름은 첫 글자만, 업체명은 인증 사업자만, 수익은 본인이 공개를 켰을 때만 */
    const top = await this.db.query<any>(
      `SELECT fn_mask_name(a.name) AS name,
              (SELECT b.company_name FROM businesses b WHERE b.account_id = a.id AND b.verified_at IS NOT NULL LIMIT 1) AS company,
              x.n AS deals, CASE WHEN a.earnings_public THEN x.fee END AS fee, a.earnings_public AS "feePublic",
              x.last_title AS "lastTitle"
         FROM (SELECT introducer_account_id AS id, count(*)::int AS n, coalesce(sum(fee),0)::numeric AS fee,
                      (array_agg(title ORDER BY confirmed_at DESC))[1] AS last_title
                 ${base} AND ${pw} AND introducer_account_id IS NOT NULL
                GROUP BY introducer_account_id) x
         JOIN accounts a ON a.id = x.id AND a.withdrawn_at IS NULL
        ORDER BY x.n DESC, x.fee DESC LIMIT 10`, [g]);

    const recent = await this.recentRows(g, 10, pw);
    const [asOf] = await this.db.query<{ d: string }>(`SELECT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY.MM.DD') AS d`);
    return {
      asOf: asOf.d, period, gwanCode: g,
      kpi: {
        total: { value: k.total, deltaToday: k.today_n, deltaPct: k.total - k.today_n > 0 ? Math.round(k.today_n * 1000 / (k.total - k.today_n)) / 10 : null },
        fee: { value: num(k.fee), deltaToday: num(k.today_fee) },
        inProgress: { value: ip.n, newToday: ip.today_n },
        month: { value: k.month_n, prevMonth: k.pmonth_n, deltaPct: pct(k.month_n, k.pmonth_n) },
        monthFee: { value: num(k.month_fee), prevMonth: num(k.pmonth_fee), deltaPct: pct(num(k.month_fee), num(k.pmonth_fee)) },
      },
      trend: { days: trend.map((t) => t.day), counts: trend.map((t) => t.n), fees: trend.map((t) => num(t.fee)) },
      categories: catRows,
      regions: regions.map((r) => ({ name: r.name, count: r.n, fee: num(r.fee) })),
      top: top.map((t: any, i: number) => ({ rank: i + 1, name: t.name, company: t.company ?? '개인 소개자', deals: t.deals,
        fee: t.fee == null ? null : num(t.fee), feePublic: !!t.feePublic, lastTitle: t.lastTitle })),
      recent,
      notes: [
        '성사 = 양측 확인(또는 7일 자동 확정)을 마친 거래입니다. 소개 수익 = 합의 소개비.',
        '부동산(안심소개) 건은 소개비가 아니라 노출료라(A-07) 소개 수익에 들어가지 않습니다.',
        '이름은 첫 글자만, 개인 소개자의 수익은 본인이 공개를 켠 경우에만 보입니다.',
      ],
    };
  }

  private async recentRows(g: string | null, limit: number, pw = 'TRUE') {
    const rows = await this.db.query<any>(
      `SELECT s.deal_id, s.listing_id AS "listingId", s.title, s.category_name AS "categoryName", s.gwan_code AS "gwanCode",
              s.fee, s.trade_amount AS "tradeAmount", s.days, s.sido, s.sigungu,
              to_char(s.confirmed_at AT TIME ZONE 'Asia/Seoul', 'YYYY.MM.DD') AS date,
              CASE WHEN EXISTS (SELECT 1 FROM listing_media m WHERE m.listing_id = s.listing_id AND m.file_id IS NOT NULL)
                     AND l.status = 'PUBLISHED' THEN '/api/v1/listings/' || s.listing_id || '/photos/0' END AS "thumbUrl",
              (SELECT count(*)::int FROM conversations c WHERE c.target_type = 'LISTING' AND c.target_id = s.listing_id) AS inquiries,
              (SELECT count(*)::int FROM request_proposals p WHERE p.request_id = s.request_id) AS proposals
         FROM v_success_deals s LEFT JOIN listings l ON l.id = s.listing_id
        WHERE ($1::text IS NULL OR s.gwan_code = $1) AND ${pw.replace(/confirmed_at/g, 's.confirmed_at')}
        ORDER BY s.confirmed_at DESC LIMIT $2`, [g, limit]);
    return rows.map((r: any) => ({
      listingId: r.listingId, title: r.title, categoryName: r.categoryName, gwanCode: r.gwanCode,
      fee: Number(r.fee ?? 0), tradeAmount: r.tradeAmount == null ? null : Number(r.tradeAmount),
      days: r.days, region: r.sido ? `${r.sido}${r.sigungu ? ' ' + r.sigungu : ''}` : null, date: r.date,
      thumbUrl: r.thumbUrl, inquiries: r.inquiries, proposals: r.proposals,
    }));
  }

  /** 소개장터 메인 「최근 실제 연결 사례」 */
  async recentCases(gwanCode?: string, limit = 3) {
    return { items: await this.recentRows(gwanCode ?? null, Math.min(Math.max(Number(limit) || 3, 1), 12)) };
  }

  /* ── 베스트매칭 ───────────────────────────────────────────────────── */
  async best(gwanCode?: string) {
    const rows = await this.db.query<any>(
      `SELECT st.id, st.story_no AS "storyNo", st.headline, st.summary, st.reasons,
              st.seller_comment AS "sellerComment", st.seller_rating AS "sellerRating",
              s.deal_id AS "dealId", s.listing_id AS "listingId", s.title, s.category_name AS "categoryName",
              s.fee, s.trade_amount AS "tradeAmount", s.days, s.sido, s.sigungu,
              coalesce(cg.grade_code, 'G3') AS "gradeCode",
              to_char(s.confirmed_at AT TIME ZONE 'Asia/Seoul', 'YYYY.MM.DD') AS date,
              CASE WHEN l.status = 'PUBLISHED' AND EXISTS (SELECT 1 FROM listing_media m WHERE m.listing_id = s.listing_id AND m.file_id IS NOT NULL)
                   THEN '/api/v1/listings/' || s.listing_id || '/photos/0' END AS "thumbUrl"
         FROM success_stories st
         JOIN v_success_deals s ON s.deal_id = st.deal_id
         LEFT JOIN listings l ON l.id = s.listing_id
         LEFT JOIN LATERAL (SELECT grade_code FROM category_grades g WHERE g.category_id = s.category_id
                             AND g.effective_from <= now() ORDER BY g.effective_from DESC LIMIT 1) cg ON true
        WHERE st.status = 'PUBLISHED' AND ($1::text IS NULL OR st.gwan_code = $1)
        ORDER BY st.sort_rank, s.fee DESC, st.published_at DESC LIMIT 12`, [gwanCode ?? null]);
    const items = [];
    for (const r of rows) {
      const steps = await this.db.query<{ step: number; code: string; label: string; at: string | null }>(
        `SELECT step, code, label, to_char(at AT TIME ZONE 'Asia/Seoul', 'YYYY.MM.DD') AS at FROM fn_deal_timeline($1) ORDER BY step`, [r.dealId]);
      /* 합침(v10.31 · D090) — 4단계(대금 지급 기록) 시각은 DB 함수가 아니라 여기서(INV-11 감시: DB 함수는 결제 기록 표를 읽지 않음) */
      const [pay] = await this.db.query<{ at: string | null }>(
        `SELECT to_char(min(reported_at) AT TIME ZONE 'Asia/Seoul', 'YYYY.MM.DD') AS at FROM deal_payment_records WHERE deal_id = $1`, [r.dealId]);
      for (const s of steps) if (s.code === 'PAYMENT') s.at = pay?.at ?? null;
      const { dealId, ...rest } = r; void dealId;
      items.push({ ...rest, fee: Number(r.fee ?? 0), tradeAmount: r.tradeAmount == null ? null : Number(r.tradeAmount),
        region: r.sido ? `${r.sido}${r.sigungu ? ' ' + r.sigungu : ''}` : null, steps });
    }
    return { items, note: '실제로 성사된 거래 가운데 운영이 고르고, 매도자 · 매수자 두 분이 공개에 동의한 사례만 싣습니다. 금액 · 기간 · 과정은 거래 기록 그대로입니다.' };
  }

  /* ── 베스트매칭 사례 운영 · 동의 ───────────────────────────────── */
  adminStories() {
    return this.db.query(
      `SELECT st.id, st.story_no AS "storyNo", st.deal_id AS "dealId", st.gwan_code AS "gwanCode", st.headline, st.summary, st.reasons,
              st.seller_comment AS "sellerComment", st.seller_rating AS "sellerRating",
              st.seller_consent_at AS "sellerConsentAt", st.buyer_consent_at AS "buyerConsentAt",
              st.status, st.sort_rank AS "sortRank", st.created_at AS "createdAt", st.published_at AS "publishedAt",
              s.title, s.fee, s.trade_amount AS "tradeAmount"
         FROM success_stories st LEFT JOIN v_success_deals s ON s.deal_id = st.deal_id
        ORDER BY st.created_at DESC LIMIT 200`);
  }

  /** 성사 확정 거래로 사례 초안을 만듭니다(운영). 공개는 두 당사자 동의 뒤 */
  async createStory(dto: { dealId: string; headline: string; summary?: string; reasons?: string[]; sortRank?: number }) {
    const [s] = await this.db.query<{ gwan_code: string }>(
      `SELECT gwan_code FROM v_success_deals WHERE deal_id = $1`, [dto.dealId]);
    if (!s) throw new StateConflict('STORY_DEAL_NOT_CONFIRMED', '성사 확정된 거래만 사례로 올릴 수 있습니다.');
    const [row] = await this.db.query<{ id: string; story_no: number }>(
      `INSERT INTO success_stories (deal_id, gwan_code, headline, summary, reasons, sort_rank, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, story_no`,
      [dto.dealId, s.gwan_code, dto.headline.trim(), dto.summary?.trim() || null,
       (dto.reasons ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 5), dto.sortRank ?? 100, RequestCtx.actorId()]);
    await this.notifyParties(dto.dealId, row.id);
    return { id: row.id, storyNo: Number(row.story_no), status: 'DRAFT', note: '매도자 · 매수자에게 공개 동의를 요청했습니다.' };
  }

  async updateStory(id: string, dto: { headline?: string; summary?: string; reasons?: string[]; status?: string; sortRank?: number }) {
    const sets: string[] = []; const args: unknown[] = [id];
    const put = (c: string, v: unknown) => { args.push(v); sets.push(`${c} = $${args.length}`); };
    if (dto.headline !== undefined) put('headline', dto.headline.trim());
    if (dto.summary !== undefined) put('summary', dto.summary?.trim() || null);
    if (dto.reasons !== undefined) put('reasons', dto.reasons.map((x) => x.trim()).filter(Boolean).slice(0, 5));
    if (dto.status !== undefined) put('status', dto.status);
    if (dto.sortRank !== undefined) put('sort_rank', dto.sortRank);
    if (!sets.length) throw new PolicyViolation('NOTHING', '바꿀 항목이 없습니다.');
    const [row] = await this.db.query<{ id: string; status: string }>(
      `UPDATE success_stories SET ${sets.join(', ')} WHERE id = $1 RETURNING id, status`, args);
    if (!row) throw new NotFound('사례를 찾을 수 없습니다.');
    return row;
  }

  private async notifyParties(dealId: string, storyId: string) {
    await this.db.query(
      `SELECT fn_notify(x.id, 'SUCCESS_STORY_CONSENT', jsonb_build_object('title', coalesce(s.title, '거래')), '/money/best/mine')
         FROM v_success_deals s, LATERAL (VALUES (s.seller_account_id), (s.buyer_account_id)) x(id)
        WHERE s.deal_id = $1`, [dealId]).catch(() => undefined);
    void storyId;
  }

  /** 내가 당사자인 사례(동의 대기 · 동의함) */
  myStories() {
    const me = RequestCtx.actorId()!;
    return this.db.query(
      `SELECT st.id, st.headline, st.status, s.title,
              CASE WHEN s.seller_account_id = $1 THEN 'SELLER' ELSE 'BUYER' END AS side,
              CASE WHEN s.seller_account_id = $1 THEN st.seller_consent_at ELSE st.buyer_consent_at END AS "consentAt",
              st.seller_comment AS "sellerComment", st.seller_rating AS "sellerRating"
         FROM success_stories st JOIN v_success_deals s ON s.deal_id = st.deal_id
        WHERE $1 IN (s.seller_account_id, s.buyer_account_id)
        ORDER BY st.created_at DESC`, [me]);
  }

  /** 당사자 동의(매도자는 한마디 · 별점을 함께) · 철회(consent=false → 공개 중이면 내림) */
  async consentStory(id: string, dto: { consent: boolean; comment?: string; rating?: number }) {
    const me = RequestCtx.actorId()!;
    const [s] = await this.db.query<{ seller: string; buyer: string; status: string }>(
      `SELECT d.seller_account_id AS seller, d.buyer_account_id AS buyer, st.status
         FROM success_stories st JOIN deals d ON d.id = st.deal_id WHERE st.id = $1`, [id]);
    if (!s) throw new NotFound('사례를 찾을 수 없습니다.');
    const side = s.seller === me ? 'seller' : s.buyer === me ? 'buyer' : null;
    if (!side) throw new Forbidden('NOT_PARTY', '이 거래의 당사자만 동의할 수 있습니다.');
    if (!dto.consent) {
      await this.db.query(
        `UPDATE success_stories SET ${side}_consent_at = NULL,
                status = CASE WHEN status = 'PUBLISHED' THEN 'HIDDEN' ELSE status END WHERE id = $1`, [id]);
      return { ok: true, consent: false };
    }
    if (side === 'seller') {
      await this.db.query(
        `UPDATE success_stories SET seller_consent_at = now(),
                seller_comment = coalesce($2, seller_comment), seller_rating = coalesce($3, seller_rating) WHERE id = $1`,
        [id, dto.comment?.trim() || null, dto.rating ?? null]);
    } else {
      await this.db.query(`UPDATE success_stories SET buyer_consent_at = now() WHERE id = $1`, [id]);
    }
    return { ok: true, consent: true };
  }

  /* ── 공급자(업체) ─────────────────────────────────────────────────── */
  private readonly SUP = `
    s.supplier_id AS id, s.company_name AS "companyName", s.main_category AS "mainCategory", s.summary,
    s.sido, s.sigungu, s.listing_count AS "listingCount", s.rating, s.review_count AS "reviewCount",
    s.confirmed_deals AS "confirmedDeals", s.trust_score AS "trustScore", s.top_listing_id AS "topListingId",
    CASE WHEN EXISTS (SELECT 1 FROM listing_media m WHERE m.listing_id = s.top_listing_id AND m.file_id IS NOT NULL)
         THEN '/api/v1/listings/' || s.top_listing_id || '/photos/0' END AS "thumbUrl"`;

  /** 「서비스 업체 추천」 — 신뢰도 · 평점 · 성사 순(광고 아님 · 돈으로 순서를 사지 않습니다) */
  suppliers(q: { gwanCode?: string; regionCode?: string; categoryId?: string; limit?: number }) {
    const lim = Math.min(Math.max(Number(q.limit) || 4, 1), 40);
    return this.db.query(
      `SELECT ${this.SUP} FROM v_suppliers s
        WHERE ($1::text IS NULL OR s.gwan_code = $1)
          AND ($2::text IS NULL OR left(s.sido_code, 2) = left($2, 2))
          AND ($3::uuid IS NULL OR $3::uuid = ANY (s.category_ids))
        ORDER BY s.trust_score DESC, s.rating DESC NULLS LAST, s.confirmed_deals DESC, s.last_published_at DESC, s.supplier_id
        LIMIT $4`, [q.gwanCode ?? null, q.regionCode ?? null, q.categoryId ?? null, lim]);
  }

  /**
   * 「AI 추천 맞춤 공급자」 — 서버 계산 가중 합산(recommend_weights · 협업 필터링 아님 · 리드 추천 /ai/match 와 같은 5항목).
   *   loc  지역 적합   — 고른 지역(regionCode) 또는 내 사업장 시 · 도와 같으면 100
   *   cat  분류 일치   — 내가 관심 담은 매물 · 내가 올린 요청의 분류와 같으면 100 (**맞춤형 광고 동의(ADPERSONAL)가 있을 때만** 내 활동을 씁니다)
   *   win  성사 이력   — 성사 1건당 20(100 까지)
   *   spd  응답 속도   — 공개 문의에 답한 평균 시간(24시간 안 100 · 72시간 안 60 · 그 밖 20 · 문의 없음 50)
   *   trust 신뢰지표   — 소개 신뢰도(0~100)
   *   광고는 점수 · 순위에 들어가지 않습니다(표시광고법). 위 「업체 추천」에 나온 업체는 뺍니다(exclude).
   */
  async recommended(q: { gwanCode?: string; regionCode?: string; limit?: number; exclude?: string }) {
    const me = RequestCtx.actorId() ?? null;
    const lim = Math.min(Math.max(Number(q.limit) || 4, 1), 20);
    let personal = false;
    if (me) {
      const [c] = await this.db.query(
        `SELECT 1 FROM v_term_consent_current WHERE account_id = $1 AND term_code = 'ADPERSONAL' AND agreed`, [me]).catch(() => []);
      personal = !!c;
    }
    const excl = String(q.exclude ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    const weights = await this.db.query<{ code: string; name: string; weight: number }>(
      `SELECT code, name, weight::float8 AS weight FROM recommend_weights ORDER BY sort_order`);
    const w = Object.fromEntries(weights.map((x) => [x.code, Number(x.weight)]));
    const rows = await this.db.query<any>(
      `WITH me AS (
         SELECT coalesce($2::text, (SELECT fn_sido_code(b.sido) FROM businesses b WHERE b.account_id = $3::uuid AND b.verified_at IS NOT NULL LIMIT 1)) AS sido_code,
                CASE WHEN $4::boolean THEN ARRAY(
                  SELECT DISTINCT l.category_id FROM favorites f JOIN listings l ON l.id = f.target_id
                   WHERE f.account_id = $3::uuid AND f.target_type = 'LISTING'
                  UNION SELECT DISTINCT r.category_id FROM requests r WHERE r.owner_account_id = $3::uuid AND r.category_id IS NOT NULL)
                ELSE ARRAY[]::uuid[] END AS cats),
       spd AS (
         SELECT l.owner_account_id AS account_id,
                avg(extract(epoch FROM (q.answered_at - q.created_at)) / 3600) FILTER (WHERE q.answered_at IS NOT NULL) AS hours,
                count(*) AS n
           FROM public_questions q JOIN listings l ON l.id = q.listing_id GROUP BY l.owner_account_id)
       SELECT ${this.SUP},
              CASE WHEN me.sido_code IS NULL THEN 50 WHEN left(s.sido_code,2) = left(me.sido_code,2) THEN 100 ELSE 0 END AS loc,
              CASE WHEN cardinality(me.cats) = 0 THEN 0 WHEN s.category_ids && me.cats THEN 100 ELSE 0 END AS cat,
              least(100, s.confirmed_deals * 20) AS win,
              CASE WHEN sp.n IS NULL OR sp.hours IS NULL THEN 50 WHEN sp.hours <= 24 THEN 100 WHEN sp.hours <= 72 THEN 60 ELSE 20 END AS spd,
              s.trust_score AS trust
         FROM v_suppliers s CROSS JOIN me LEFT JOIN spd sp ON sp.account_id = s.account_id
        WHERE ($1::text IS NULL OR s.gwan_code = $1)
          AND ($3::uuid IS NULL OR s.account_id <> $3::uuid)
          AND NOT (s.supplier_id = ANY ($5::uuid[]))`,
      [q.gwanCode ?? null, q.regionCode ?? null, me, personal, excl]);
    const scored = rows.map((r: any) => {
      const parts = { loc: Number(r.loc), cat: Number(r.cat), win: Number(r.win), spd: Number(r.spd), trust: Number(r.trust ?? 0) };
      const total = Math.round(Object.entries(parts).reduce((a, [kk, v]) => a + v * (w[kk] ?? 0) / 100, 0) * 10) / 10;
      const { loc, cat, win, spd, trust, ...card } = r; void loc; void cat; void win; void spd; void trust;
      return { ...card, score: total, parts };
    }).sort((a: any, b: any) => b.score - a.score || Number(b.trustScore) - Number(a.trustScore)).slice(0, lim);
    return {
      items: scored, weights, personal, engine: 'WEIGHTED_SUM',
      note: personal
        ? '지역 · 관심 분류 · 성사 이력 · 응답 속도 · 신뢰도를 가중 합산했습니다(협업 필터링이 아닙니다). 광고는 순위에 들어가지 않습니다.'
        : '지역 · 성사 이력 · 응답 속도 · 신뢰도로 가중 합산했습니다. 맞춤형 광고에 동의하시면 관심 분류도 반영합니다. 광고는 순위에 들어가지 않습니다.',
    };
  }

  /** 업체 프로필 — 공개 정보 · 그 업체의 게시 매물 · 후기(가림) · 신뢰도 항목 */
  async supplier(id: string, gwanCode?: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFound('업체를 찾을 수 없습니다.');
    const [b] = await this.db.query<any>(
      `SELECT b.id, b.account_id, b.company_name AS "companyName", r.sido,
              nullif(split_part(btrim(coalesce(b.sigungu,'')), ' ', 1), '') AS sigungu,
              to_char(b.verified_at AT TIME ZONE 'Asia/Seoul', 'YYYY.MM') AS "verifiedSince",
              (b.broker_verified_at IS NOT NULL) AS broker,
              ops.rating, ops.review_count AS "reviewCount", ops.confirmed_deals AS "confirmedDeals",
              ops.total_deals AS "totalDeals", ops.success_rate AS "successRate",
              to_char(ops.joined_at AT TIME ZONE 'Asia/Seoul', 'YYYY.MM') AS "joinedAt",
              jsonb_build_object('score', t.score, 'business', t.biz, 'identity', t.idv, 'deals', t.deals,
                                 'successRate', t.success_rate, 'rating', t.rating, 'reviewCount', t.review_count, 'disputes', t.disputes, 'consentRate', t.consent_rate) AS trust
         FROM businesses b
         LEFT JOIN regions r ON r.code = fn_sido_code(b.sido)
         JOIN v_owner_public_stats ops ON ops.account_id = b.account_id
         JOIN v_account_trust t ON t.account_id = b.account_id
        WHERE b.id = $1 AND b.verified_at IS NOT NULL`, [id]);
    if (!b) throw new NotFound('업체를 찾을 수 없습니다.');
    const listings = await this.db.query(
      `SELECT l.id, l.gwan_code AS "gwanCode", l.title, l.summary, c.name AS "categoryName", l.desired_fee AS "desiredFee",
              l.deal_amount AS "dealAmount", l.listing_no AS "listingNo", l.published_at AS "publishedAt", l.like_count AS "likeCount",
              fn_is_realty_category(l.category_id) AS "isRealty",
              CASE WHEN EXISTS (SELECT 1 FROM listing_media m WHERE m.listing_id = l.id AND m.file_id IS NOT NULL)
                   THEN '/api/v1/listings/' || l.id || '/photos/0' END AS "thumbUrl"
         FROM listings l JOIN categories c ON c.id = l.category_id
        WHERE l.owner_account_id = $1 AND l.status = 'PUBLISHED' AND NOT l.is_priority_exposed
          AND ($2::text IS NULL OR l.gwan_code = $2)
        ORDER BY l.published_at DESC LIMIT 24`, [b.account_id, gwanCode ?? null]);
    const reviews = await this.db.query<any>(
      `SELECT r.rating, r.body, to_char(r.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY.MM.DD') AS date, fn_mask_name(a.name) AS author
         FROM deal_reviews r JOIN accounts a ON a.id = r.author_id
        WHERE r.target_id = $1 ORDER BY r.created_at DESC LIMIT 10`, [b.account_id]);
    const mask = (t: string | null) => t == null ? null : t
      .replace(/01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[연락처]')
      .replace(/0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[연락처]')
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[이메일]');
    const { account_id, ...pub } = b; void account_id;
    return { ...pub, listings, reviews: reviews.map((r: any) => ({ ...r, body: mask(r.body) })) };
  }

  /* ── 중개사 인증 — 보증(공제) · 제출 서류 ───────────────────────── */
  async brokerExtra() {
    const me = RequestCtx.actorId()!;
    const [r] = await this.db.query<any>(
      `SELECT v.guarantee_org AS "guaranteeOrg", v.guarantee_cert_no AS "guaranteeCertNo",
              v.guarantee_amount AS "guaranteeAmount", v.guarantee_from AS "guaranteeFrom", v.guarantee_until AS "guaranteeUntil",
              v.submitted_docs AS "submittedDocs", cardinality(v.doc_file_ids) AS "docFileCount",
              (v.guarantee_until IS NOT NULL AND v.guarantee_until < (now() AT TIME ZONE 'Asia/Seoul')::date) AS "guaranteeExpired"
         FROM broker_verifications v JOIN businesses b ON b.id = v.business_id
        WHERE b.account_id = $1 ORDER BY v.created_at DESC LIMIT 1`, [me]);
    return r ?? { applied: false };
  }

  async putBrokerExtra(dto: { guaranteeOrg?: string; guaranteeCertNo?: string; guaranteeAmount?: number;
    guaranteeFrom?: string; guaranteeUntil?: string; submittedDocs?: string[]; docFileIds?: string[] }) {
    const me = RequestCtx.actorId()!;
    if (dto.docFileIds?.length) {
      const ok = await this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM files WHERE id = ANY ($1::uuid[]) AND owner_account_id = $2
            AND purpose = 'BROKER_DOC' AND status = 'READY'`, [dto.docFileIds, me]);
      if (ok[0].n !== dto.docFileIds.length) throw new PolicyViolation('BROKER_DOC_FILE', '올리기를 마친 본인의 중개 서류만 붙일 수 있습니다.');
    }
    const [row] = await this.db.query<{ id: string }>(
      `UPDATE broker_verifications v
          SET guarantee_org = coalesce($2, guarantee_org), guarantee_cert_no = coalesce($3, guarantee_cert_no),
              guarantee_amount = coalesce($4, guarantee_amount), guarantee_from = coalesce($5::date, guarantee_from),
              guarantee_until = coalesce($6::date, guarantee_until),
              submitted_docs = coalesce($7::text[], submitted_docs),
              doc_file_ids = CASE WHEN $8::uuid[] IS NULL THEN doc_file_ids ELSE (SELECT array_agg(DISTINCT x) FROM unnest(doc_file_ids || $8::uuid[]) x) END
         FROM businesses b
        WHERE b.id = v.business_id AND b.account_id = $1
      RETURNING v.id`,
      [me, dto.guaranteeOrg?.trim() || null, dto.guaranteeCertNo?.trim() || null, dto.guaranteeAmount ?? null,
       dto.guaranteeFrom || null, dto.guaranteeUntil || null, dto.submittedDocs ?? null, dto.docFileIds?.length ? dto.docFileIds : null]);
    if (!row) throw new StateConflict('BROKER_NOT_APPLIED', '중개사 인증 신청을 먼저 내 주십시오(POST /partner/broker).');
    return { ok: true, id: row.id };
  }
}
