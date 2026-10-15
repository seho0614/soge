import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../db/database.service';

export type AttributionChannel = 'WEB' | 'MOBILE' | 'CALL' | 'OFFLINE';

export interface TouchInput {
  code: string;
  visitorKey: string;
  accountId?: string | null;
  channel?: AttributionChannel;
  landingUrl?: string;
  referer?: string;
  ipHash?: string;
}

export interface TouchResult {
  recorded: boolean;
  /** 기록하지 않은 까닭 — INVALID_CODE · SELF · DUPLICATE */
  reason?: 'INVALID_CODE' | 'SELF' | 'DUPLICATE';
  eventId?: number;
  /** 기록했으면 귀속 기간(일) */
  windowDays?: number;
}

export interface Resolution {
  eventId: string;
  code: string;
  occurredAt: Date;
  channel: AttributionChannel;
  policyVersion: number;
}

/**
 * 귀속 엔진 (INV-1 · INV-2)
 *
 * 세 가지만 합니다.
 *   record  — 유입을 append. 절대 수정하지 않는다
 *   link    — 방문자와 계정을 연결. 비로그인 유입을 살리는 유일한 수단
 *   resolve — 판정. 순수 조회이며 같은 입력이면 항상 같은 결과
 *             (resolve = 계정 단위 · resolveForListing = 매물 단위, 거래 생성이 쓰는 것 — D012)
 *
 * 판정 규칙 자체는 DB 함수 fn_attribution_resolve · fn_attribution_resolve_listing 에 있습니다.
 * 앱과 DB 양쪽에 규칙을 두면 반드시 어긋나고, 어긋나면 분쟁에서 증명할 수 없습니다.
 */
@Injectable()
export class AttributionEngine {
  private readonly logger = new Logger(AttributionEngine.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * 유입 기록. 코드가 유효하지 않으면 조용히 무시합니다 — 유입 경로를 막지 않기 위해서입니다.
   *
   * ★ D010 — 무시하는 경우가 셋 더 있습니다. 모두 recorded:false 로 돌려줄 뿐 오류가 아닙니다.
   *   · SELF       코드 주인 본인의 유입(로그인 계정이 주인 · 또는 방문자 키가 이미 주인 계정과 연결됨).
   *                본인을 소개자로 기록하면 자기 거래에 자기 소개비가 붙습니다.
   *   · DUPLICATE  같은 방문자 · 같은 코드가 24시간 안에 이미 기록됨(새로고침 부풀리기).
   *                DB 트리거 trg_attr_dedupe_24h 가 최종 보장하고, 여기서는 먼저 걸러 오류를 피합니다.
   *   · 무효 코드  없는 코드 · 폐기 · 만료.
   */
  async record(input: TouchInput): Promise<TouchResult> {
    const run = this.db;
    const [code] = await run.query<{ code: string; owner: string }>(
      `SELECT code, owner_account_id AS owner FROM referral_codes
        WHERE code = $1 AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())`,
      [input.code],
    );
    if (!code) {
      this.logger.debug(`무효 코드 유입 무시: ${input.code}`);
      return { recorded: false, reason: 'INVALID_CODE' };
    }

    if (input.accountId && input.accountId === code.owner) {
      return { recorded: false, reason: 'SELF' };
    }
    const [linked] = await run.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM visitor_identities
        WHERE visitor_key = $1 AND account_id = $2`, [input.visitorKey, code.owner]);
    if (linked?.n) return { recorded: false, reason: 'SELF' };

    const [pol] = await run.query<{ window_days: number }>(
      `SELECT window_days FROM attribution_policies
        ORDER BY effective_from DESC LIMIT 1`,
    );

    try {
      const rows = await run.query<{ id: number }>(
        `INSERT INTO attribution_events
           (code, visitor_key, account_id, channel, expires_at, landing_url, referer, ip_hash)
         SELECT $1,$2,$3,$4, now() + ($5 || ' days')::interval, $6,$7,$8
          WHERE NOT EXISTS (
                SELECT 1 FROM attribution_events e
                 WHERE e.code = $1 AND e.visitor_key = $2 AND e.source = 'INTRO'
                   AND e.occurred_at > now() - interval '24 hours')
         RETURNING id`,
        [
          input.code, input.visitorKey, input.accountId ?? null,
          input.channel ?? 'WEB', pol.window_days,
          input.landingUrl ?? null, input.referer ?? null, input.ipHash ?? null,
        ],
      );
      if (!rows.length) return { recorded: false, reason: 'DUPLICATE' };
      return { recorded: true, eventId: rows[0].id, windowDays: pol.window_days };
    } catch (e: any) {
      // 동시에 두 요청이 들어와 트리거가 막은 경우 — 하나는 이미 기록됐습니다
      if (/^ATTR_DUP:/.test(String(e?.message ?? ''))) return { recorded: false, reason: 'DUPLICATE' };
      throw e;
    }
  }

  /**
   * 방문자 ↔ 계정 연결. 로그인·가입 직후에 반드시 호출합니다.
   * 이 호출이 빠지면 비로그인 유입이 전부 유실됩니다 — 유입의 대부분이 그 경로입니다.
   */
  async link(
    visitorKey: string,
    accountId: string,
    source: 'LOGIN' | 'SIGNUP' | 'MERGE' = 'LOGIN',
  ) {
    const run = this.db;
    /* D011 (10/2) — 연결은 (방문자 키, 계정) 당 한 번이 아닙니다.
     *   전에는 ON CONFLICT DO NOTHING 이라, 예전에 로그인했던 브라우저에서 로그아웃 상태로 소개 링크를 열고
     *   다시 로그인하면 연결 시각이 옛날 그대로였고, 판정은 「유입 이후에 연결된 계정」만 보므로 소개자가 빠졌습니다.
     *   이제 처음 연결이거나 **마지막 연결 뒤에 그 방문자 키로 유입이 있었으면** 한 줄 더 남깁니다(추가만).
     *   유입이 없으면 넣지 않으므로 로그인마다 쌓이지 않습니다. */
    await run.query(
      `INSERT INTO visitor_identities (visitor_key, account_id, source)
       SELECT $1::text, $2::uuid, $3::text
        WHERE NOT EXISTS (SELECT 1 FROM visitor_identities vi WHERE vi.visitor_key = $1 AND vi.account_id = $2)
           OR EXISTS (SELECT 1 FROM attribution_events e
                       WHERE e.visitor_key = $1
                         AND e.occurred_at > (SELECT max(vi.linked_at) FROM visitor_identities vi
                                               WHERE vi.visitor_key = $1 AND vi.account_id = $2))`,
      [visitorKey, accountId, source],
    );
  }

  /**
   * 판정. at 을 넘기면 그 시점 기준으로 재현됩니다 — 분쟁 대응의 핵심입니다.
   */
  async resolve(
    accountId: string,
    at: Date = new Date(),
    policyVersion?: number,
  ): Promise<Resolution | null> {
    const version = policyVersion ?? (await this.policyAt(at));
    const [row] = await this.db.query<{
      event_id: string; code: string; occurred_at: Date; channel: AttributionChannel;
    }>(`SELECT * FROM fn_attribution_resolve($1, $2, $3)`, [accountId, at, version]);

    if (!row) return null;

    /* ★ D010 — 본인 코드로 본인이 들어온 유입은 판정에서 뺍니다.
     *   기록 단계(record)에서 걸러도, 새 브라우저에서 자기 링크를 연 뒤 로그인하면
     *   방문자 연결(link)로 자기 유입이 자기 계정에 붙습니다. 자기 거래의 소개자가 자기가 되면 안 됩니다. */
    const [own] = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM referral_codes WHERE code = $1 AND owner_account_id = $2`,
      [row.code, accountId]);
    if (own?.n) return null;

    return {
      eventId: row.event_id,
      code: row.code,
      occurredAt: row.occurred_at,
      channel: row.channel,
      policyVersion: version,
    };
  }

  /**
   * 매물용 판정 (D012 — 10/2 결정 「소개코드는 매물별로」). 거래 생성(deal.service createDeal)이 씁니다.
   *
   * 그 매물에 묶인 코드의 유입과, 매물에 안 묶인 코드(옛 코드 · refcode.scope=all)의 유입만 봅니다 —
   * A 매물 코드로 들어온 사람이 B 매물에 문의하면 소개자가 붙지 않습니다.
   * 본인 코드 제외 · 소개 금지 업종 매물 제외까지 **규칙은 전부 DB 함수 fn_attribution_resolve_listing 에** 있습니다
   * (성사 확정 트리거 fn_assert_attribution_snapshot 도 같은 함수를 씁니다 — 앱과 DB 가 어긋나지 않습니다).
   * at · policyVersion 을 넘기면 그 시점 기준으로 재현됩니다.
   */
  async resolveForListing(
    accountId: string,
    listingId: string | null,
    at: Date = new Date(),
    policyVersion?: number,
  ): Promise<Resolution | null> {
    const version = policyVersion ?? (await this.policyAt(at));
    const [row] = await this.db.query<{
      event_id: string; code: string; occurred_at: Date; channel: AttributionChannel;
    }>(`SELECT * FROM fn_attribution_resolve_listing($1, $2, $3, $4)`, [accountId, listingId, at, version]);
    if (!row) return null;
    return {
      eventId: row.event_id,
      code: row.code,
      occurredAt: row.occurred_at,
      channel: row.channel,
      policyVersion: version,
    };
  }

  private async policyAt(at: Date): Promise<number> {
    const [p] = await this.db.query<{ version: number }>(
      `SELECT version FROM attribution_policies
        WHERE effective_from <= $1 ORDER BY effective_from DESC LIMIT 1`,
      [at],
    );
    return p?.version ?? 1;
  }

  /** 귀속률이 떨어지면 유입 추적이 새고 있다는 뜻입니다. */
  health() {
    return this.db.query(`SELECT * FROM v_attribution_health ORDER BY month DESC LIMIT 12`);
  }
}
