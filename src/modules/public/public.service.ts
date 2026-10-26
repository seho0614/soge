import { checkOwnImages } from '../file/attach-images';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { resolveBizStatusProvider } from '../identity/verification.provider';
import { expandKeyword } from '../../core/search-expand';
import { I18N_SETTING_KEYS, I18nService } from '../i18n/i18n.service';

/**
 * 사용자 공개 API.
 *
 * 인증·검색·문의·분쟁처럼 여러 화면이 함께 쓰는 것들을 모았습니다.
 */
@Injectable()
export class PublicService {
  constructor(private readonly db: DatabaseService, private readonly i18n: I18nService) {}
  private get me() { return RequestCtx.actorId()!; }

  /**
   * 본인인증 (INV-7 게이트의 전제).
   *
   * PASS 계약 전까지 스텁입니다. stub: true 를 그대로 실어 보내 화면이 표시하게 합니다 —
   * "클릭 즉시 통과"가 실동작처럼 보이면 안 됩니다.
   */
  async verifyIdentity(provider = 'PASS') {
    const stub = !process.env.PASS_API_KEY;
    return this.db.transaction(async () => {
      await this.db.query(
        `INSERT INTO identity_verifications
           (account_id, provider, result, ci_hash, completed_at, raw)
         VALUES ($1,$2,'SUCCESS',$3,now(),$4::jsonb)`,
        [this.me, provider, stub ? 'stub-ci' : null, JSON.stringify({ stub })]);
      const [row] = await this.db.query<{ identity_verified_at: Date }>(
        `UPDATE accounts SET identity_verified_at = now()
          WHERE id = $1 RETURNING identity_verified_at`, [this.me]);
      return { success: true, stub, verifiedAt: row.identity_verified_at };
    });
  }

  /** 통합 검색. 매물과 요청을 함께 봅니다 */
  async search(q: string, limit = 20) {
    if (!q || q.replace(/\s/g, '').length < 2) {
      throw new PolicyViolation('QUERY_TOO_SHORT', '두 글자 이상 입력해 주세요.');
    }
    /* v10.83 (D111) — 검색어 덩어리 그대로(제목 LIKE)가 아니라 **낱말마다** · 동의어 · 오타 교정어로 넓혀서(목록 검색과 같은 규칙) */
    const kw = (await expandKeyword(this.db, q)) ?? q;
    const [listings, requests] = await Promise.all([
      this.db.query(
        `SELECT l.id, l.gwan_code AS "gwanCode", c.name AS "categoryName", l.title,
                l.desired_fee AS "desiredFee", l.published_at AS "publishedAt", l.category_id::text AS "_cid"
           FROM listings l JOIN categories c ON c.id = l.category_id
          /* % 는 한글에서 0건이라 부분 일치로 찾고, 정렬은
             **일치 위치**로 합니다 — similarity 도 한글에서는 0 입니다.
             ★ K2 — lower(title) LIKE 로 써야 pg_bigm 색인(idx_listings_title_bigm)을 탑니다.
                    ILIKE 는 pg_bigm 색인을 쓰지 못합니다.
             ★ K4 — fn_search_like 가 % · _ · 역슬래시를 글자로 취급합니다('%' 로 전건이 나오던 것). */
          WHERE l.status='PUBLISHED' AND fn_search_match(l.title, c.name, $1)
          ORDER BY fn_search_rank(l.title, $1) ASC, l.published_at DESC
          LIMIT $2`, [kw, limit]),
      this.db.query(
        /* v10.31 — 시안 결과 줄의 「등록자 · 예산」: 회사명(비공개 요청 · 인증 전이면 없음) · 예산(공개한 요청만) · 지역 · 업종.
                      공개 범위가 「전체」가 아닌 요청은 제목 · 관만(로그인 여부를 보지 않는 공개 검색이라). 마감된 요청은 뺍니다 */
        `SELECT r.id, r.gwan_code AS "gwanCode", r.title, r.created_at AS "createdAt",
                c.name AS "categoryName",
                CASE WHEN r.visibility = 'ALL' THEN r.region END AS region,
                CASE WHEN r.visibility = 'ALL' AND r.budget_open THEN r.budget_min END AS "budgetMin",
                CASE WHEN r.visibility = 'ALL' AND r.budget_open THEN r.budget_max END AS "budgetMax",
                CASE WHEN r.visibility = 'ALL' AND NOT r.company_blind THEN b.company_name END AS "companyName",
                r.category_id::text AS "_cid"
           FROM requests r
           LEFT JOIN categories c ON c.id = r.category_id
           LEFT JOIN businesses b ON b.account_id = r.owner_account_id AND b.verified_at IS NOT NULL
          WHERE r.status='PUBLISHED' AND (r.closes_at IS NULL OR r.closes_at > now()) AND fn_search_match(r.title, c.name, $1)
          ORDER BY fn_search_rank(r.title, $1) ASC, r.created_at DESC
          LIMIT $2`, [kw, limit]),
    ]);
    /* v10.103 (3-1) — 업종 이름만 화면 언어로(찾기는 원문으로 했음) · 숨긴 _cid 는 지움 */
    await this.i18n.overlayBy([...listings, ...requests], 'CATEGORY', '_cid', { categoryName: 'name' });
    /* v10.104 (3-2) — 제목 · 본문 번역 */
    await this.i18n.overlay(listings, 'LISTING', (r: any) => String(r.id), { title: 'title', body: 'body' });
    await this.i18n.overlay(requests, 'REQUEST', (r: any) => String(r.id), { title: 'title', body: 'body' });
    return { listings, requests, total: listings.length + requests.length };
  }

  /** 관 단건. 랜딩이 관 정보와 매물을 함께 받습니다 */
  async gwan(code: string) {
    const [row] = await this.db.query(
      `SELECT g.code, g.name, g.description, g.is_active AS "isActive",
              (SELECT count(*)::int FROM listings l
                WHERE l.gwan_code=g.code AND l.status='PUBLISHED') AS "listingCount"
         FROM gwans g WHERE g.code = $1 AND g.is_active`, [code]);
    if (!row) throw new StateConflict('NOT_FOUND', '없는 관입니다.');
    return row;
  }

  /* v10.119 — 법정 고지 둘(I18N_SETTING_KEYS)은 번역(SETTING · D125)이 있으면 그 언어로 */
  async publicSettings() {
    const rows = await this.db.query<{ key: string; value: string | null }>(
      /* 20261007 (v10.25) — 직판 고지(legal.direct_notice · scope PUBLIC)도 같이 내려 줍니다. 설정에만 있고 화면에 닿지 않아,
       *   직접 파는 소개몰 화면에 통신판매중개자 고지만 나오고 있었습니다(DB 의 v_direct_notice_missing 은 「글이 있는지」만 봅니다). */
      `SELECT key, value FROM site_settings WHERE scope='GLOBAL' OR key='legal.direct_notice'`);
    await this.i18n.overlay(rows.filter((r) => I18N_SETTING_KEYS.includes(r.key)), 'SETTING', (r) => r.key, { value: 'value' });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /** FAQ 는 데이터입니다. 관리자가 바꿀 때 배포가 필요하면 안 됩니다 */
  /* v10.31 — channel(FAQ 기본 · CS · GUIDE · BOT)으로 고릅니다. 챗봇 낱말 · 「…에서 보기」 · 상담원 연결 여부도 함께(D048) */
  async faq(gwanCode?: string, channel?: string) {
    const ch = ['FAQ', 'CS', 'GUIDE', 'BOT'].includes(channel ?? '') ? channel! : 'FAQ';
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT category, question, answer, keywords, link_href AS "linkHref", link_label AS "linkLabel", handoff,
              id::text AS "_id"
         FROM faqs
        WHERE is_active AND ($1::text IS NULL OR gwan_code = $1 OR gwan_code IS NULL)
          AND $2 = ANY(channels)
        ORDER BY sort_order, category`, [gwanCode ?? null, ch]);
    /* v10.103 (3-1) — 질문 · 답만 화면 언어로. 챗봇 낱말(keywords)은 원문 그대로 · 숨긴 _id 는 지움 */
    return this.i18n.overlayBy(rows, 'FAQ', '_id', { question: 'question', answer: 'answer' });
  }

  /** 화면 고정 문구. 법적 근거가 있어 임의로 지우면 안 됩니다 */
  uiMessages() {
    return this.db.query(
      `SELECT code, message, placement FROM ui_messages WHERE is_active ORDER BY code`)
      .then((rows) => Object.fromEntries(
        (rows as { code: string; message: string }[]).map((r) => [r.code, r.message])));
  }

  /** 관별 등록 폼 문구. 관마다 무엇을 등록하는지가 다릅니다 */
  formCopy(gwanCode: string) {
    return this.db.query(
      `SELECT role, subject, title_hint AS "titleHint",
              body_hint AS "bodyHint", notice
         FROM gwan_form_copy WHERE gwan_code = $1 ORDER BY role DESC`, [gwanCode]);
  }

  async notices(gwanCode?: string) {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT id, gwan_code AS "gwanCode", title, body,
              is_pinned AS "isPinned", published_at AS "publishedAt"
         FROM notices
        WHERE published_at IS NOT NULL AND published_at <= now()
          AND ($1::text IS NULL OR gwan_code = $1 OR gwan_code IS NULL)
        ORDER BY is_pinned DESC, published_at DESC LIMIT 30`, [gwanCode ?? null]);
    /* v10.103 (3-1) — 승인된 번역이 있으면 화면 언어로 */
    return this.i18n.overlay(rows, 'NOTICE', (r) => String(r.id), { title: 'title', body: 'body' });
  }

  async createInquiry(input: {
    category: string; title: string; body: string; email?: string; dealId?: string; channel?: string; attachmentKeys?: string[];
  }) {
    const me = RequestCtx.actorId();
    /* 첨부는 로그인한 사람이 올린 READY 파일만(남의 파일 id 를 붙이지 못하게) */
    if (input.attachmentKeys?.length && !me) throw new PolicyViolation('LOGIN_REQUIRED', '첨부는 로그인한 뒤에 할 수 있습니다.');
    const files = me ? await checkOwnImages(this.db, me, input.attachmentKeys, 'INQUIRY_ATTACHMENT', 3) : [];
    if (!me && !input.email) {
      throw new PolicyViolation('EMAIL_REQUIRED', '회신받을 이메일을 입력해 주세요.');
    }
    /* v10.31 — 관련 거래는 내가 당사자 · 소개자인 거래만(남의 거래 번호를 붙이지 못하게) */
    if (input.dealId) {
      const [d] = me ? await this.db.query<{ id: string }>(
        `SELECT id FROM deals WHERE id = $1 AND $2 IN (buyer_account_id, seller_account_id, introducer_account_id)`,
        [input.dealId, me]) : [];
      if (!d) throw new Forbidden('NOT_A_PARTY', '내가 참여한 거래만 고를 수 있습니다.');
    }
    const [row] = await this.db.query<{ id: string; status: string; createdAt: Date; category: string }>(
      `INSERT INTO inquiries (account_id, category, title, body, email, status, deal_id, channel, attachment_keys)
       VALUES ($1,$2,$3,$4,$5,'OPEN',$6,$7,$8) RETURNING id, status, created_at AS "createdAt", category`,
      [me ?? null, input.category, input.title, input.body, input.email ?? null, input.dealId ?? null, input.channel ?? 'FORM', files]);
    /* 시안 접수 완료 화면(SB-HOM-ETC-031): 접수번호 · 유형 · 답변 예정 시각(영업일 1일 — 주말이면 다음 월요일) */
    const [meta] = await this.db.query<{ label: string | null }>(
      `SELECT label FROM code_labels WHERE domain = 'inquiry.category' AND code = $1`, [row.category]);
    return { id: row.id, status: row.status, no: inquiryNo(row.id, row.createdAt), categoryLabel: meta?.label ?? row.category,
             dueAt: businessDayAfter(row.createdAt).toISOString() };
  }

  /** 분쟁 접수. 정산 보류는 트리거가 겁니다 (B-11) */
  async createDispute(input: { dealId: string; reasonCode: string; description: string; evidenceKeys?: string[] }) {
    return this.db.transaction(async () => {
      /* v10.32 — 증빙: 내가 올린 · 확인을 마친 첨부만(남의 파일 id 를 붙이는 길을 막음) */
      const evidence = await checkOwnImages(this.db, this.me, input.evidenceKeys, 'INQUIRY_ATTACHMENT', 3);
      const [d] = await this.db.query<{ id: string }>(
        `SELECT id FROM deals
          WHERE id = $1 AND $2 IN (buyer_account_id, seller_account_id, introducer_account_id)`,
        [input.dealId, this.me]);
      if (!d) throw new StateConflict('NOT_A_PARTY', '이 거래의 당사자가 아닙니다.');

      const [dup] = await this.db.query<{ id: string }>(
        `SELECT id FROM disputes WHERE deal_id=$1 AND status IN ('OPEN','IN_REVIEW')`,
        [input.dealId]);
      if (dup) throw new StateConflict('ALREADY_OPEN', '이미 진행 중인 분쟁이 있습니다.');

      const [row] = await this.db.query(
        `INSERT INTO disputes (deal_id, raised_by, reason_code, description, status)
         VALUES ($1,$2,$3,$4,'OPEN') RETURNING id, status`,
        [input.dealId, this.me, input.reasonCode, input.description]);
      for (const f of evidence) {
        await this.db.query(
          `INSERT INTO dispute_messages (dispute_id, sender_id, body, attachment_key) VALUES ($1,$2,'증빙',$3)`,
          [(row as { id: string }).id, this.me, f]);
      }
      return { ...(row as object), evidenceCount: evidence.length };
    });
  }

  /** 후기. Deal 종속이고 성사 확정 후에만 쓸 수 있습니다 (INV-5) */
  async createReview(dealId: string, rating: number, body?: string, tags?: string[]) {
    /* v10.31 — 빈 후기를 받지 않습니다(전: 별점 5 · 내용 없음이 바로 등록됨 — 결함 중). 칩 1개 이상 또는 내용 10자 이상.
     *   연락처 · 계좌번호는 가립니다(시안 「등록 시 자동으로 걸러집니다」 — 공개 화면). */
    const text = (body ?? '').trim();
    if (!(tags?.length) && text.length < 10) {
      throw new PolicyViolation('REVIEW_EMPTY', '무엇이 좋았는지 칩을 고르시거나 내용을 10자 이상 적어 주십시오.');
    }
    const masked = text
      .replace(/01[016-9][-. ]?\d{3,4}[-. ]?\d{4}/g, '***-****-****')
      .replace(/\b0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}\b/g, '***-****-****')
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '***@***')
      .replace(/\b\d{2,6}-\d{2,6}-\d{2,8}(-\d{1,4})?\b/g, '***-***-***');
    const [deal] = await this.db.query<{ status: string; buyer: string; seller: string; introducer: string | null }>(
      `SELECT status, buyer_account_id AS buyer, seller_account_id AS seller,
              introducer_account_id AS introducer
         FROM deals WHERE id = $1`, [dealId]);
    if (!deal) throw new StateConflict('NOT_FOUND', '거래를 찾을 수 없습니다.');
    /* v10.21 (D023) — 후기는 **거래 당사자(구매자 · 판매자)** 만 씁니다. 전에는 이 확인이 없어
     * 사업자 계정이면 남의 거래에도 쓸 수 있는 코드였습니다(대상을 넣지 않아 실제로는 늘 실패했습니다).
     * 소개자 본인은 자기 후기를 쓸 수 없습니다. DB 트리거(fn_assert_review_rules)도 같은 규칙으로 막습니다. */
    if (this.me !== deal.buyer && this.me !== deal.seller) {
      throw new Forbidden('NOT_PARTY', '거래 당사자만 후기를 남길 수 있습니다.');
    }
    if (!['CONFIRMED', 'SETTLED'].includes(deal.status)) {
      throw new PolicyViolation('NOT_CONFIRMED', '성사가 확정된 거래에만 후기를 남길 수 있습니다.');
    }
    /* 대상 — 그 거래에 소개자가 있으면 소개자(「소개자 후기」), 없으면 거래 상대방입니다.
     * (찾은 것 · G-133) 대상(target_id · NOT NULL)을 넣지 않아 후기 작성이 늘 「필수 값이 빠졌습니다」로 실패했습니다. */
    const target = deal.introducer ?? (this.me === deal.buyer ? deal.seller : deal.buyer);
    /* v10.31 — 시안 「후기는 수정할 수 있지만 삭제되지 않습니다」: 같은 거래에 다시 쓰면 고칩니다(삭제 경로 없음) */
    const [row] = await this.db.query<{ id: string; edited: boolean }>(
      `INSERT INTO deal_reviews (deal_id, author_id, target_id, rating, body, tags)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (deal_id, author_id) DO UPDATE
         SET rating = EXCLUDED.rating, body = EXCLUDED.body, tags = EXCLUDED.tags, updated_at = now()
       RETURNING id, (xmax <> 0) AS edited`, [dealId, this.me, target, rating, masked || null, tags ?? []]);
    return { id: row.id, edited: row.edited, masked: masked !== text };
  }

  /**
   * 정산 신청.
   *
   * 보통은 성사 확정 시 트리거가 자동으로 만듭니다.
   * 이 API 는 자동 생성이 누락된 경우의 수동 경로입니다.
   */
  async requestSettlement(dealId: string) {
    return this.db.transaction(async () => {
      /* v10.27 (G-120) — 정산은 **그 거래의 소개자**만 신청합니다. 전에는 이 확인이 없어 인증된 사업자면 누구나
       * 남의 거래의 받는 사람으로 자신을 올리려 할 수 있었고(소개비 기능이 꺼져 있어 INV-9 에서 막혔을 뿐),
       * 없는 거래는 아무것도 만들지 않고 201 을 돌려줬습니다. DB 트리거(fn_assert_settlement_rules · D034)도 같은 규칙으로 막습니다. */
      const [deal] = await this.db.query<{ introducer: string | null }>(
        `SELECT introducer_account_id AS introducer FROM deals WHERE id = $1 FOR UPDATE`, [dealId]);
      if (!deal) throw new NotFound('거래를 찾을 수 없습니다.');
      if (deal.introducer !== this.me) {
        throw new Forbidden('NOT_PARTY', '이 거래의 소개자만 정산을 신청할 수 있습니다.');
      }
      const [exist] = await this.db.query<{ id: string }>(
        `SELECT id FROM settlements WHERE deal_id = $1`, [dealId]);
      if (exist) throw new StateConflict('ALREADY_REQUESTED', '이미 정산이 신청되었습니다.');

      /* v10.31 (시안 「인증 시각이 소개비 수령 자격의 기준일 · 소급 안 됨」 · D060 ⑦) — 사업자로 받는 것은 그 거래가 성사되기 전에
       * 사업자 인증을 마친 경우만입니다. 인증 전에 성사된 거래는 개인으로 받습니다(DB 트리거도 같은 규칙). */
      const [biz] = await this.db.query<{ id: string }>(
        `SELECT b.id FROM businesses b JOIN deals d ON d.id = $2
          WHERE b.account_id = $1 AND b.verified_at IS NOT NULL
            AND (d.confirmed_at IS NULL OR b.verified_at <= d.confirmed_at) LIMIT 1`,
        [this.me, dealId]);
      if (!biz) {
        /* v10.28 (지시서 5절 · D040 · INV-10R) — 사업자가 아니면 **개인으로** 받습니다.
         * 본인인증은 문(IDENTITY_VERIFIED)에서 이미 봤고, 여기서는 받을 계좌가 본인 명의로 확인됐는지 봅니다(10/7 결정 — 정산을 신청할 때).
         * 소개비는 당사자끼리 직접 지급합니다(INV-11) — 계좌 확인은 「받을 계좌가 본인 것인지」의 확인일 뿐, 회사가 돈을 받아 두지 않습니다. */
        const [acc] = await this.db.query<{ id: string; stub: boolean }>(
          `SELECT id, is_stub AS stub FROM payout_accounts
            WHERE account_id = $1 AND verified ORDER BY is_default DESC, verified_at DESC LIMIT 1`, [this.me]);
        if (!acc) {
          throw new StateConflict('ACCOUNT_REQUIRED',
            '소개비를 받을 계좌를 등록 · 확인해 주십시오. 본인 명의 계좌로 1원을 보내 확인합니다(내 정보 › 정산 › 받을 계좌).');
        }
        const [row] = await this.db.query<{ id: string; amount: number; status: string }>(
          `INSERT INTO settlements
             (deal_id, payee_account_id, payee_business_id, amount, status)
           SELECT d.id, $2, NULL, d.agreed_fee, 'REQUESTED'
             FROM deals d WHERE d.id = $1
           RETURNING id, amount, status`,
          [dealId, this.me]);
        return { ...row, payee: 'PERSON',
          note: acc.stub ? '받을 계좌는 연동 전이라 확인한 것으로 간주했습니다(1원 확인 · 간주 모드).' : undefined };
      }

      // 사업자로 받는 경우 — 전과 같습니다(INV-10). 계좌를 받지 않습니다 — 플랫폼이 이체하지 않습니다(INV-11).
      const [row] = await this.db.query<{ id: string; amount: number; status: string }>(
        `INSERT INTO settlements
           (deal_id, payee_account_id, payee_business_id, amount, status)
         SELECT d.id, $2, $3, d.agreed_fee, 'REQUESTED'
           FROM deals d WHERE d.id = $1
         RETURNING id, amount, status`,
        [dealId, this.me, biz.id]);
      return { ...row, payee: 'BUSINESS' };
    });
  }

  /** NTS 사업자 진위. 키가 주입되면 코드 수정 없이 실연동으로 바뀝니다 */
  checkBizStatus(bizRegNo: string) {
    return resolveBizStatusProvider().check(bizRegNo);
  }
}

/** v10.31 — 문의 접수번호 「Q-YYYYMMDD-XXXX」(한국 날짜 + id 앞 4자리 — 같은 문의면 늘 같은 글자) */
export function inquiryNo(id: string, at: Date | string): string {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(at)).replace(/-/g, '');
  return `Q-${d}-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}
/** 영업일 1일 뒤(토 · 일은 건너뜀). 공휴일 표는 없어 주말만 봅니다 — 시안 「영업일 기준 1일 이내에 답변」 */
export function businessDayAfter(at: Date | string): Date {
  const d = new Date(at);
  const kst = (x: Date) => new Date(x.getTime() + 9 * 3600_000).getUTCDay();
  d.setTime(d.getTime() + 24 * 3600_000);
  while ([0, 6].includes(kst(d))) d.setTime(d.getTime() + 24 * 3600_000);
  return d;
}

