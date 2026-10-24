import { affTouchHash } from './aff-touch';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';
import { PartnerActorService } from '../partner/partner-actor.service';
import { RequestCtx } from '../../core/request-context';
import { AppError, PolicyViolation, StateConflict } from '../../core/errors';
import { resolveBankVerifyProvider } from '../billing/bank-verify.provider';
import { createHash, createHmac, randomBytes } from 'crypto';


/** 1원 인증 — 코드 유효 시간 · 틀릴 수 있는 횟수 · 다시 받기 간격 (D001) */
const VERIFY_TTL_MIN = 10;
const VERIFY_MAX_TRIES = 5;
const VERIFY_RESEND_SEC = 30;

/** 링크 미리보기·검색 로봇은 클릭으로 세지 않습니다 — 카톡에 붙이기만 해도 1이 오릅니다 */
const BOT_UA = /bot|crawl|spider|slurp|preview|scrap|facebookexternalhit|embedly|headless|curl\/|wget|python-requests/i;

/** 링크가 안 열리는 까닭 → 화면 문구 */
const CLICK_REASON: Record<string, string> = {
  NOT_FOUND: '없는 링크입니다. 주소를 다시 확인해 주십시오.',
  LINK_INACTIVE: '파트너가 사용을 멈춘 링크입니다.',
  PARTNER_INACTIVE: '지금은 쓸 수 없는 링크입니다.',
  PRODUCT_NOT_ON_SALE: '판매가 끝났거나 잠시 멈춘 상품입니다.',
  BAD_LANDING: '이동할 주소가 올바르지 않아 열지 않았습니다.',
};

/**
 * 파트너 제휴수수료.
 *
 * ── 이것만 소개뱅크가 돈을 냅니다 ─────────────────────────────
 *   소개비      당사자끼리 직접 — 공제 0원 (INV-9 · INV-11)
 *   제휴수수료  **회사가 파트너에게 지급** — 마케팅비입니다
 *
 * ── 막는 것은 DB 가 합니다 ────────────────────────────────────
 * 단가 고정 · 72시간 귀속 · 정산 상태 · 심의는 트리거가 봅니다(C850).
 * 여기서 막으면 배치가 직접 INSERT 할 때 통과합니다.
 *
 * v10.92 (리팩토링) — 운영 화면(신청 심사 · 상품 · 목표 · 자료 · 안내 · 정산 실행)은 affiliate-admin.service.ts 로 나눴습니다.
 */
@Injectable()
export class AffiliateService {
  constructor(private readonly db: DatabaseService, private readonly actors: PartnerActorService) {}
  private get me() { return RequestCtx.actorId()!; }
  /** 로그인한 사람의 파트너 id. 없으면 null. */
  private async partnerId(): Promise<string | null> {
    return this.actors.ownedId(this.me!, true);   // v10.39 — 조회는 PartnerActorService 한 곳(대표 계정 · 활동 중)
  }

  /* ── 파트너 화면 ──────────────────────────────────────────── */

  async dashboard() {
    const pid = await this.partnerId();
    if (!pid) return { ok: false, note: '파트너로 승인된 계정이 아닙니다.' };

    const [sum] = await this.db.query(
      `SELECT
         count(*) FILTER (WHERE o.state <> 'CANCELED')::int AS orders,
         coalesce(sum(o.commission) FILTER (WHERE o.state IN ('CONFIRMED','SETTLED')),0)::bigint AS earned,
         coalesce(sum(o.commission) FILTER (WHERE o.state = 'CONFIRMED'),0)::bigint AS payable
       FROM partner_orders o
      WHERE o.partner_id = $1 AND o.attributed
        AND o.ordered_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`   /* G-127 한국 달 */, [pid]);

    const [clicks] = await this.db.query(
      `SELECT coalesce(sum(s.clicks),0)::int AS clicks
         FROM partner_link_stats s
         JOIN partner_links l ON l.id = s.link_id
        WHERE l.partner_id = $1 AND s.stat_date >= date_trunc('month', now() AT TIME ZONE 'Asia/Seoul')::date`, [pid]);

    const [goal] = await this.db.query(
      `SELECT target, reward, source FROM v_partner_goal_effective
        WHERE partner_id = $1 AND period_ym = to_char(now() AT TIME ZONE 'Asia/Seoul','YYYY-MM')`, [pid]);

    const recent = await this.db.query(
      `SELECT o.order_no AS "orderNo", p.name AS product,
              o.commission, o.state, o.ordered_at AS "orderedAt"
         FROM partner_orders o
         JOIN affiliate_products p ON p.id = o.product_id
        WHERE o.partner_id = $1
        ORDER BY o.ordered_at DESC LIMIT 10`, [pid]);

    /* ── v10.31 (W5 · 10/10 시안 기준 SB-AFC-DSH-010) — 오늘 · 어제 · 지난 달 · 소개 고객 · 등급 · 정산 예정일 · 알림 · 피드 ── */
    const ext = await this.dashboardExtra(pid, Number(sum?.earned ?? 0), goal);

    return {
      ok: true,
      ...ext,
      month: {
        clicks: clicks?.clicks ?? 0,
        orders: sum?.orders ?? 0,
        earned: sum?.earned ?? 0,
        payable: sum?.payable ?? 0,
        ...ext.monthExtra,
      },
      goal: goal ? {
        target: goal.target, reward: goal.reward, source: goal.source,
        rate: goal.target ? Math.round(Number(sum?.earned ?? 0) * 100 / Number(goal.target)) : null,
      } : null,
      recent,
      /* ★ 소개비와 헷갈리지 않게 항상 적습니다. */
      note: '제휴수수료는 소개뱅크가 지급합니다. 소개비(당사자끼리 직접)와 다른 것입니다.',
    };
  }

  /**
   * v10.31 (W5 · SB-AFC-DSH-010) — 시안 숫자 칸의 나머지 값. **모두 실제 자료로 셉니다**(지어내지 않음).
   *   오늘 소개수익 · 어제    오늘(한국 시각) 들어온 주문의 수수료(취소 뺌) — 확정 전 금액 포함(「확인 중」)
   *   거래 건수 · 어제        오늘 · 어제 주문 수
   *   지난 달 대비           이번 달 확정 수익 ÷ 지난 달 같은 기간 확정 수익
   *   소개 고객 수            내 링크로 들어온 방문자(같은 방문자 · 같은 날 1명) — 오늘 · 어제
   *   파트너 등급 · 다음 등급  partners.grade + partner_grade_rules(기준은 운영 — 비면 계산하지 않음)
   *   정산 예정일            익월 affiliate.payout_day 일
   *   알림 숫자 · 이름        읽지 않은 알림 · 계정 이름(성 + OO)
   *   구매 소식 피드          최근 주문 5건 — **이름 없이** 시 · 도와 상품 · 수수료만(다른 회원 개인정보 보호)
   */
  private async dashboardExtra(pid: string, earned: number, goal: any) {
    const KST_DAY = `(date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`;
    const KST_MON = `(date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`;
    const [d] = await this.db.query<any>(
      `SELECT coalesce(sum(o.commission) FILTER (WHERE o.ordered_at >= ${KST_DAY}),0)::bigint AS "todayEarned",
              coalesce(sum(o.commission) FILTER (WHERE o.ordered_at >= ${KST_DAY} - interval '1 day' AND o.ordered_at < ${KST_DAY}),0)::bigint AS "yesterdayEarned",
              count(*) FILTER (WHERE o.ordered_at >= ${KST_DAY})::int AS "todayOrders",
              count(*) FILTER (WHERE o.ordered_at >= ${KST_DAY} - interval '1 day' AND o.ordered_at < ${KST_DAY})::int AS "yesterdayOrders",
              coalesce(sum(o.commission) FILTER (WHERE o.state IN ('CONFIRMED','SETTLED')
                  AND o.ordered_at >= ${KST_MON} - interval '1 month'
                  AND o.ordered_at < now() - interval '1 month'),0)::bigint AS "lastMonthSamePeriod",
              coalesce(sum(o.commission) FILTER (WHERE o.state IN ('CONFIRMED','SETTLED')
                  AND o.ordered_at >= ${KST_MON} - interval '1 month' AND o.ordered_at < ${KST_MON}),0)::bigint AS "lastMonthEarned"
         FROM partner_orders o
        WHERE o.partner_id = $1 AND o.attributed AND o.state <> 'CANCELED'
          AND o.ordered_at >= ${KST_MON} - interval '1 month'`, [pid]);
    const [c] = await this.db.query<any>(
      `SELECT count(DISTINCT t.visitor_hash) FILTER (WHERE t.clicked_at >= ${KST_DAY})::int AS today,
              count(DISTINCT t.visitor_hash) FILTER (WHERE t.clicked_at >= ${KST_DAY} - interval '1 day' AND t.clicked_at < ${KST_DAY})::int AS yesterday,
              count(DISTINCT t.visitor_hash) FILTER (WHERE t.clicked_at >= ${KST_MON})::int AS month
         FROM aff_touches t JOIN partner_links l ON l.id = t.link_id
        WHERE l.partner_id = $1 AND t.clicked_at >= ${KST_DAY} - interval '40 days'`, [pid]);
    const [g] = await this.db.query<any>(
      `SELECT p.grade, r.rank, r.min_month_earned AS min,
              (SELECT json_build_object('grade', n.grade, 'min', n.min_month_earned) FROM partner_grade_rules n WHERE n.rank = r.rank + 1) AS next
         FROM partners p LEFT JOIN partner_grade_rules r ON r.grade = p.grade WHERE p.id = $1`, [pid]);
    const [pd] = await this.db.query<{ value: string }>(`SELECT value FROM site_settings WHERE key = 'affiliate.payout_day'`);
    const [acct] = await this.db.query<any>(
      `SELECT a.name, (SELECT count(*)::int FROM notifications n WHERE n.account_id = a.id AND n.read_at IS NULL) AS unread
         FROM accounts a WHERE a.id = $1`, [this.me]);
    const feed = await this.db.query<any>(
      `SELECT * FROM (
         SELECT o.ordered_at AS at, NULL::text AS sido, ap.name AS product, o.commission AS amount, 'AFFILIATE' AS kind
           FROM partner_orders o JOIN affiliate_products ap ON ap.id = o.product_id
          WHERE o.state <> 'CANCELED' AND o.attributed AND o.ordered_at > now() - interval '7 days'
         UNION ALL
         SELECT h.created_at, nullif(split_part(btrim(ad.addr1), ' ', 1), ''),
                (SELECT hp.name FROM hlt_order_items i JOIN hlt_products hp ON hp.id = i.product_id WHERE i.order_id = h.id ORDER BY i.id LIMIT 1),
                (SELECT coalesce(sum(i.commission_amount),0) FROM hlt_order_items i WHERE i.order_id = h.id), 'MALL'
           FROM hlt_orders h LEFT JOIN hlt_addresses ad ON ad.id = h.address_id
          WHERE h.aff_link_id IS NOT NULL AND h.paid_at IS NOT NULL AND h.status NOT IN ('PENDING','CANCELED','RETURNED')
            AND h.created_at > now() - interval '7 days') z
        ORDER BY at DESC LIMIT 5`).catch(() => [] as any[]);

    const day = Number(pd?.value ?? 10);
    /* 정산 예정일 — 다음 달 지급일(한국 날짜) */
    const kst = new Date(Date.now() + 9 * 3600_000);
    const nextPay = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + 1, day));
    const ymd = `${nextPay.getUTCFullYear()}-${String(nextPay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextPay.getUTCDate()).padStart(2, '0')}`;
    const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
    const SIDO: Record<string, string> = { 서울특별시: '서울시', 부산광역시: '부산시', 대구광역시: '대구시', 인천광역시: '인천시', 광주광역시: '광주시',
      대전광역시: '대전시', 울산광역시: '울산시', 세종특별자치시: '세종시', 경기도: '경기도', 강원특별자치도: '강원도', 강원도: '강원도',
      충청북도: '충북', 충청남도: '충남', 전북특별자치도: '전북', 전라북도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주도' };
    const next = g?.next ?? null;
    const nextMin = next?.min != null ? Number(next.min) : null;
    const name = acct?.name ? String(acct.name).slice(0, 1) + 'OO' : null;
    const rate = goal?.target ? Math.round((earned * 100) / Number(goal.target)) : null;
    const dim = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + 1, 0)).getUTCDate();
    const pace = Math.round((kst.getUTCDate() / dim) * 100);
    const cheer = rate == null ? null
      : rate >= 100 ? '목표를 달성했습니다! 🎉'
      : rate >= pace ? '지금처럼 하면 목표 달성, 충분히 가능합니다! 🎉'
      : `목표까지 ${(Number(goal.target) - earned).toLocaleString('ko-KR')}원 남았습니다 — 링크를 한 번 더 나눠 보세요.`;
    return {
      today: {
        earned: Number(d?.todayEarned ?? 0), yesterdayEarned: Number(d?.yesterdayEarned ?? 0),
        earnedDelta: Number(d?.todayEarned ?? 0) - Number(d?.yesterdayEarned ?? 0),
        orders: d?.todayOrders ?? 0, yesterdayOrders: d?.yesterdayOrders ?? 0,
        ordersDelta: (d?.todayOrders ?? 0) - (d?.yesterdayOrders ?? 0),
      },
      monthExtra: {
        lastMonthEarned: Number(d?.lastMonthEarned ?? 0),
        lastMonthSamePeriod: Number(d?.lastMonthSamePeriod ?? 0),
        deltaPct: pct(earned, Number(d?.lastMonthSamePeriod ?? 0)),
      },
      customers: { today: c?.today ?? 0, yesterday: c?.yesterday ?? 0, delta: (c?.today ?? 0) - (c?.yesterday ?? 0), month: c?.month ?? 0 },
      tier: {
        grade: g?.grade ?? null,
        next: next?.grade ?? null,
        nextMin,
        remaining: nextMin != null ? Math.max(0, nextMin - earned) : null,
        progress: nextMin ? Math.min(100, Math.round((earned * 100) / nextMin)) : null,
        note: next && nextMin == null ? '다음 등급 기준은 운영이 정합니다.' : null,
      },
      payoutDate: ymd,
      unread: acct?.unread ?? 0,
      displayName: name,
      goalCheer: cheer,
      feed: feed.map((f: any) => ({
        at: f.at, kind: f.kind, product: f.product ?? '상품',
        area: f.sido ? (SIDO[f.sido] ?? f.sido) : null, amount: Number(f.amount ?? 0),
      })),
    };
  }

  async links() {
    const pid = await this.partnerId();
    if (!pid) return [];
    return this.db.query(
      `SELECT l.id, l.code, l.label, l.is_active AS "isActive",
              p.name AS product, p.commission, p.status AS "productStatus",
              coalesce(sum(s.clicks),0)::int AS clicks,
              coalesce(sum(s.clicks) FILTER (WHERE s.stat_date = (now() AT TIME ZONE 'Asia/Seoul')::date),0)::int AS "clicksToday",
              coalesce(sum(s.orders),0)::int AS orders,
              /* D001 — 공유 주소의 경로. 도메인은 화면이 붙입니다(개발·운영이 다름) */
              '/r/' || l.code AS "sharePath"
         FROM partner_links l
         LEFT JOIN affiliate_products p ON p.id = l.product_id
         LEFT JOIN partner_link_stats s ON s.link_id = l.id
        WHERE l.partner_id = $1
        GROUP BY l.id, p.name, p.commission, p.status
        ORDER BY l.created_at DESC`, [pid]);
  }

  async createLink(dto: { productId: string; label?: string }) {
    const pid = await this.partnerId();
    if (!pid) return { ok: false, note: '파트너로 승인된 계정이 아닙니다.' };

    /* 코드는 겹치면 안 됩니다 — 겹치면 수수료가 엉뚱한 사람에게 갑니다. */
    let code = '';
    for (let i = 0; i < 5; i++) {
      code = 'PTN-' + randomBytes(4).toString('hex').toUpperCase();
      const [dup] = await this.db.query(
        `SELECT 1 AS x FROM partner_links WHERE code = $1`, [code]);
      if (!dup) break;
      code = '';
    }
    if (!code) return { ok: false, note: '코드를 만들지 못했습니다. 다시 시도해 주십시오.' };

    const [r] = await this.db.query(
      `INSERT INTO partner_links (partner_id, product_id, code, label)
       VALUES ($1, $2, $3, $4) RETURNING id, code`,
      [pid, dto.productId, code, dto.label ?? null]);
    return { ok: true, ...r, note: '링크를 만들었습니다.' };
  }

  async orders(state?: string) {
    const pid = await this.partnerId();
    if (!pid) return [];
    return this.db.query(
      `SELECT o.order_no AS "orderNo", p.name AS product, l.label AS "linkLabel",
              o.commission, o.state, o.attributed,
              o.clicked_at AS "clickedAt", o.ordered_at AS "orderedAt",
              /* ★ 귀속 안 된 주문은 **왜 그런지 적어 줍니다.**
                 안 적으면 "왜 수수료가 없냐" 고 묻습니다. */
              CASE WHEN NOT o.attributed
                   THEN '클릭 후 72시간이 지나 주문돼 수수료가 붙지 않습니다'
                   END AS "noteIfUnattributed"
         FROM partner_orders o
         JOIN affiliate_products p ON p.id = o.product_id
         LEFT JOIN partner_links l ON l.id = o.link_id
        WHERE o.partner_id = $1
          AND ($2::text IS NULL OR o.state = $2)
        ORDER BY o.ordered_at DESC LIMIT 100`, [pid, state ?? null]);
  }

  async revenues(ym?: string) {
    const pid = await this.partnerId();
    if (!pid) return { items: [], note: null };
    const items = await this.db.query(
      `SELECT r.occurred_on AS "date", r.track, r.amount, r.memo
         FROM partner_revenues r
        WHERE r.partner_id = $1
          AND ($2::text IS NULL OR to_char(r.occurred_on,'YYYY-MM') = $2)
        ORDER BY r.occurred_on DESC LIMIT 100`, [pid, ym ?? null]);
    return {
      items,
      /* ★ 트랙이 섞이면 "왜 정산이 따로 오냐" 가 됩니다. */
      note: '소개비와 제휴수수료는 성격이 달라 정산과 세금계산서가 따로 나갑니다.',
    };
  }

  async settlements() {
    const pid = await this.partnerId();
    if (!pid) return { items: [], account: null };
    const items = await this.db.query(
      `SELECT s.id, s.track, s.period_from AS "from", s.period_to AS "to",
              s.gross_amount AS gross, s.withholding, s.net_amount AS net,
              s.state, s.paid_at AS "paidAt"
         FROM partner_settlements s
        WHERE s.partner_id = $1
        ORDER BY s.period_from DESC`, [pid]);
    const [acc] = await this.db.query(
      `SELECT bank_name AS "bankName", account_last4 AS "last4",
              holder_name AS "holderName", verified_at AS "verifiedAt",
              /* D001 — 1원 인증 진행 상태 */
              (verified_at IS NULL AND verify_code_hash IS NOT NULL
                 AND verify_expires_at > now()) AS "verifyPending",
              verify_expires_at AS "verifyExpiresAt",
              verify_tries AS "verifyTries",
              (verify_tries >= ${VERIFY_MAX_TRIES}) AS "verifyLocked",
              verify_stub AS "verifyStub"
         FROM partner_settlement_accounts WHERE partner_id = $1`, [pid]);
    return {
      items,
      account: acc ?? null,
      note: acc?.verifiedAt ? null
        : '정산 계좌를 등록하고 인증하셔야 지급됩니다.',
    };
  }

  async setAccount(dto: { bankCode: string; bankName: string; accountNo: string; holderName: string }) {
    const pid = await this.partnerId();
    if (!pid) return { ok: false, note: '파트너로 승인된 계정이 아닙니다.' };

    /* ★ 번호는 그대로 두지 않습니다. 운영 화면에 전체가 보이면
     *   그 자체가 위험합니다 — 뒤 4자리만 보여 줍니다. */
    const last4 = dto.accountNo.replace(/\D/g, '').slice(-4);
    const [r] = await this.db.query(
      `INSERT INTO partner_settlement_accounts
         (partner_id, bank_code, bank_name, account_enc, account_last4, holder_name)
       VALUES ($1, $2, $3, pgp_sym_encrypt($4, current_setting('app.enc_key', true)), $5, $6)
       ON CONFLICT (partner_id) DO UPDATE SET
         bank_code = EXCLUDED.bank_code, bank_name = EXCLUDED.bank_name,
         account_enc = EXCLUDED.account_enc, account_last4 = EXCLUDED.account_last4,
         holder_name = EXCLUDED.holder_name, verified_at = NULL
       RETURNING id, account_last4 AS "last4"`,
      [pid, dto.bankCode, dto.bankName, dto.accountNo, last4, dto.holderName]);
    return {
      ok: true, ...r,
      note: '등록했습니다. 이어서 1원 인증을 하셔야 지급됩니다.',
    };
  }

  /* ── 정산 계좌 1원 인증 (D001) ───────────────────────────────
   * 회원 정산 계좌(/me/payout-accounts)와 같은 어댑터를 씁니다.
   * 계약 전에는 스텁 — 코드가 SGB01 로 고정이고 **stub:true 를 화면에 알립니다.**
   * 계좌를 바꾸면 인증·시도 상태는 DB 트리거(fn_pstl_account_reverify)가 지웁니다. */

  private static codeHash(code: string) {
    return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
  }

  private async accountForVerify(pid: string) {
    const [a] = await this.db.query(
      `SELECT bank_code, holder_name, verified_at, verify_code_hash,
              verify_sent_at, verify_expires_at, verify_tries,
              (verify_sent_at > now() - make_interval(secs => $2)) AS too_soon,
              (verify_expires_at <= now()) AS expired
         FROM partner_settlement_accounts WHERE partner_id = $1`, [pid, VERIFY_RESEND_SEC]);
    if (!a) throw new StateConflict('NO_ACCOUNT', '정산 계좌를 먼저 등록하십시오.');
    return a;
  }

  async requestVerify() {
    const pid = await this.partnerId();
    if (!pid) return { ok: false, note: '파트너로 승인된 계정이 아닙니다.' };
    const a = await this.accountForVerify(pid);
    if (a.verified_at) return { ok: true, verified: true, note: '이미 인증된 계좌입니다.' };
    if (a.verify_tries >= VERIFY_MAX_TRIES) {
      throw new PolicyViolation('TOO_MANY_TRIES',
        '인증 코드를 다섯 번 틀려 막혔습니다 — 계좌를 다시 등록하시거나 1:1 문의를 남겨 주십시오.');
    }
    if (a.too_soon) {
      throw new PolicyViolation('TOO_SOON', `1원을 방금 보냈습니다. ${VERIFY_RESEND_SEC}초 뒤에 다시 받으실 수 있습니다.`);
    }

    /* ★ 번호는 이 순간에만 풀어 어댑터에 넘깁니다 — 응답·로그에 싣지 않습니다. */
    const [plain] = await this.db.query(
      `SELECT pgp_sym_decrypt(account_enc::bytea, current_setting('app.enc_key', true)) AS no
         FROM partner_settlement_accounts WHERE partner_id = $1`, [pid]);
    const sent = await resolveBankVerifyProvider().send({
      bankCode: a.bank_code, accountNo: plain?.no ?? '', holderName: a.holder_name });
    if (!sent.sent || !sent.code) {
      throw new PolicyViolation('BANK_SEND_FAILED',
        sent.detail ?? '1원을 보내지 못했습니다. 계좌를 다시 확인해 주십시오.');
    }

    const [r] = await this.db.query(
      `UPDATE partner_settlement_accounts SET
          verify_code_hash = $2, verify_sent_at = now(),
          verify_expires_at = now() + make_interval(mins => $3), verify_stub = $4
        WHERE partner_id = $1 AND verified_at IS NULL
      RETURNING verify_expires_at AS "expiresAt", verify_tries AS "tries"`,
      [pid, AffiliateService.codeHash(sent.code), VERIFY_TTL_MIN, sent.stub]);
    if (!r) return { ok: true, verified: true, note: '이미 인증된 계좌입니다.' };

    return {
      ok: true, verified: false, stub: sent.stub, expiresAt: r.expiresAt,
      triesLeft: VERIFY_MAX_TRIES - r.tries,
      /* 스텁일 때만 코드를 알려 드립니다 — 실제로는 통장 입금자명에서 보셔야 합니다 */
      ...(sent.stub ? { devCode: sent.code } : {}),
      note: sent.stub
        ? `연동 전이라 실제로 1원이 가지 않았습니다 — 코드는 ${sent.code} 입니다. ${VERIFY_TTL_MIN}분 안에 입력하십시오.`
        : `1원을 보냈습니다. 통장 입금자명에 찍힌 코드를 ${VERIFY_TTL_MIN}분 안에 입력하십시오.`,
    };
  }

  async confirmVerify(code: string) {
    const pid = await this.partnerId();
    if (!pid) return { ok: false, note: '파트너로 승인된 계정이 아닙니다.' };
    const a = await this.accountForVerify(pid);
    if (a.verified_at) return { ok: true, verified: true, note: '이미 인증된 계좌입니다.' };
    if (a.verify_tries >= VERIFY_MAX_TRIES) {
      throw new PolicyViolation('TOO_MANY_TRIES',
        '인증 코드를 다섯 번 틀려 막혔습니다 — 계좌를 다시 등록하시거나 1:1 문의를 남겨 주십시오.');
    }
    if (!a.verify_code_hash) {
      throw new StateConflict('NOT_REQUESTED', '먼저 「1원 받기」를 누르십시오.');
    }
    if (a.expired) {
      throw new PolicyViolation('CODE_EXPIRED', `코드는 ${VERIFY_TTL_MIN}분 동안만 쓸 수 있습니다 — 1원을 다시 받으십시오.`);
    }

    /* 저장해 둔 코드와 맞춰 보고, 어댑터에도 확인합니다(실연동 때 은행 쪽 확인). */
    const local = AffiliateService.codeHash(code) === a.verify_code_hash;
    const res = local
      ? await resolveBankVerifyProvider().confirm({ bankCode: a.bank_code, accountNo: '', code: code.trim().toUpperCase(), localMatched: true })
      : { verified: false, stub: true, detail: '코드가 맞지 않습니다.' };

    if (!res.verified) {
      const [after] = await this.db.query(
        `UPDATE partner_settlement_accounts
            SET verify_tries = least(verify_tries + 1, ${VERIFY_MAX_TRIES})
          WHERE partner_id = $1 RETURNING verify_tries AS "tries"`, [pid]);
      const left = VERIFY_MAX_TRIES - after.tries;
      throw new PolicyViolation(left > 0 ? 'CODE_MISMATCH' : 'TOO_MANY_TRIES',
        left > 0
          ? `${res.detail ?? '코드가 맞지 않습니다.'} (${left}회 남았습니다)`
          : '다섯 번 틀려 막혔습니다 — 계좌를 다시 등록하시거나 1:1 문의를 남겨 주십시오.',
        { triesLeft: left });
    }

    const [r] = await this.db.query(
      `UPDATE partner_settlement_accounts SET
          verified_at = now(), verify_code_hash = NULL, verify_tries = 0
        WHERE partner_id = $1 AND verified_at IS NULL
      RETURNING verified_at AS "verifiedAt", bank_name AS "bankName", account_last4 AS "last4"`, [pid]);
    return {
      ok: true, verified: true, ...(r ?? {}), stub: res.stub,
      note: res.stub
        ? '인증했습니다. 연동 전이라 실제 예금주는 확인되지 않았습니다.'
        : '인증했습니다. 이 계좌로 지급됩니다.',
    };
  }

  /* ── 공개 — 제휴 링크 클릭 (D001) ─────────────────────────────
   * 집계는 **하루·방문자당 1회**. 방문자는 날짜를 섞은 해시로만 남깁니다
   * (IP·UA·쿠키 원문 없음 — 날이 바뀌면 같은 사람인지도 모릅니다).
   * 착지 주소 검사·집계는 DB 함수 fn_plink_click 이 합니다. */
  async click(code: string, v: { visitorKey?: string; ip?: string; ua?: string }) {
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(code ?? '')) {
      throw new AppError(404, { code: 'NOT_FOUND', message: CLICK_REASON.NOT_FOUND });
    }
    const bot = !v.ua || BOT_UA.test(v.ua);
    const key = v.visitorKey && /^[A-Za-z0-9-]{8,64}$/.test(v.visitorKey)
      ? 'v:' + v.visitorKey
      : 'n:' + (v.ip ?? '') + '|' + (v.ua ?? '');
    /* 한국 날짜 — DB 의 클릭 집계 날짜(fn_plink_click · D033 · Asia/Seoul)와 같은 날에 묶입니다 */
    const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const secret = process.env.JWT_SECRET ?? process.env.ENC_KEY ?? 'sgb';
    const hash = bot ? null
      : createHmac('sha256', secret).update(`${day}|${code}|${key}`).digest('hex');

    const [r] = await this.db.query(
      `SELECT reason, landing_url AS "landingUrl", counted FROM fn_plink_click($1, $2)`,
      [code, hash]);
    if (!r || r.reason !== 'OK') {
      const reason = r?.reason ?? 'NOT_FOUND';
      throw new AppError(404, { code: reason, message: CLICK_REASON[reason] ?? CLICK_REASON.NOT_FOUND });
    }
    /* v10.27 (G-190) — 귀속용 클릭 기록(방문자 쿠키가 있을 때만 · 해시만). 7일 지난 줄은 지웁니다 */
    const touch = bot ? null : affTouchHash(v.visitorKey);
    if (touch) {
      await this.db.query(
        `INSERT INTO aff_touches (visitor_hash, link_id)
         SELECT $1, id FROM partner_links WHERE code = $2`, [touch, code]);
      await this.db.query(`DELETE FROM aff_touches WHERE clicked_at < now() - interval '7 days'`);
    }
    return { code, landingUrl: r.landingUrl, counted: r.counted, bot };
  }

  async products() {
    /* 파트너에게는 **판매 중인 것만** 보여 줍니다. */
    /* v10.31 (W5 · AFC-DSH 「🔥인기 · ❤고수익」 · 상품 사진) — 표지는 운영(promo_tag)이 정하고, 비어 있으면
     * 「인기」만 실제 주문으로 셉니다(최근 7일 주문 상위 3 · 1건 이상). 사진은 운영이 넣은 image_path */
    return this.db.query(
      `WITH o AS (SELECT product_id, count(*) AS n FROM partner_orders
                   WHERE state <> 'CANCELED' AND ordered_at > now() - interval '7 days' GROUP BY product_id),
            r AS (SELECT product_id, n, rank() OVER (ORDER BY n DESC) AS rk FROM o)
       SELECT p.id, p.code, p.name, p.advertiser, p.commission, p.landing_url AS "landingUrl",
              p.description, p.started_at AS "startedAt", p.ended_at AS "endedAt",
              p.image_path AS "imagePath",
              coalesce(p.promo_tag, CASE WHEN r.rk <= 3 AND r.n > 0 THEN 'HOT' END) AS tag,
              coalesce(r.n, 0)::int AS "orders7d"
         FROM affiliate_products p LEFT JOIN r ON r.product_id = p.id
        WHERE p.status = 'ON_SALE'
        ORDER BY (coalesce(p.promo_tag, CASE WHEN r.rk <= 3 AND r.n > 0 THEN 'HOT' END) IS NULL), p.commission DESC, p.name`);
  }

  async materials() {
    /* ★ 심의를 통과한 것만 내려갑니다. 파트너가 뿌리는 순간
     *   회사가 한 말이 됩니다. */
    /* ★ D007 — 파일이 있으면 fileId 를 줍니다. 내려받기 주소는 GET /files/{id} (ACTIVE 파트너만) */
    return this.db.query(
      `SELECT m.id, m.title, m.kind, m.file_key AS "fileKey", m.body, m.created_at AS "createdAt",
              f.id AS "fileId", f.original_name AS "fileName", f.content_type AS "fileType", f.size_bytes AS "fileSize"
         FROM marketing_materials m
         LEFT JOIN files f ON f.id = m.file_id AND f.status = 'READY'
        WHERE m.state = 'APPROVED'
        ORDER BY m.created_at DESC`);
  }

  guides() {
    return this.db.query(
      `SELECT g.id, g.title, g.body, g.sort_order AS "sortOrder",
              f.id AS "fileId", f.original_name AS "fileName", f.content_type AS "fileType", f.size_bytes AS "fileSize"
         FROM partner_guides g
         LEFT JOIN files f ON f.id = g.file_id AND f.status = 'READY'
        WHERE g.is_active
        ORDER BY g.sort_order, g.title`);
  }

  async inquiries() {
    const pid = await this.partnerId();
    if (!pid) return [];
    return this.db.query(
      `SELECT id, subject, body, state, answer,
              answered_at AS "answeredAt", created_at AS "createdAt"
         FROM partner_inquiries WHERE partner_id = $1
        ORDER BY created_at DESC`, [pid]);
  }

  ask(dto: { subject: string; body: string }) { return this.createInquiry(dto); }

  async createInquiry(dto: { subject: string; body: string }) {
    const pid = await this.partnerId();
    if (!pid) return { ok: false, note: '파트너로 승인된 계정이 아닙니다.' };
    const [r] = await this.db.query(
      `INSERT INTO partner_inquiries (partner_id, subject, body)
       VALUES ($1, $2, $3) RETURNING id`, [pid, dto.subject, dto.body]);
    return { ok: true, ...r, note: '접수했습니다.' };
  }

  /* ── 운영 (BO) ───────────────────────────────────────────── */
}
