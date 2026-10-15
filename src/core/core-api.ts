/**
 * 본체(sgb) 연동.
 *
 * ── 왜 물어보나 ─────────────────────────────────────────────────────
 * 성향과 사업자 실재는 **본체가 정본**입니다. 복제하면 동의를
 * 철회했는데 광고 쪽에 남아 있는 일이 생기고, 그건 INV-AD 위반입니다.
 *
 * ── 실패했을 때 ─────────────────────────────────────────────────────
 * 본체가 안 뜨면 **성향 없는 일반 광고**로 떨어집니다. 광고가 아예
 * 안 나가는 것보다 낫고, 무엇보다 **동의를 짐작해서 쓰면 안 됩니다.**
 */

export interface AdProfile {
  /** 세그먼트 코드. 동의가 없으면 null 입니다 — 빈 배열이 아닙니다. */
  segment: string | null;
  /** 본체가 판단한 동의 여부. 광고는 이 값을 다시 계산하지 않습니다. */
  consented: boolean;
}

export interface BizCheck {
  exists: boolean;
  name: string | null;
  /** 휴·폐업이면 false. 이 경우 소재를 내려야 합니다. */
  active: boolean;
}

export class CoreApi {
  constructor(private readonly base: string, private readonly token: string) {}

  private async get<T>(path: string): Promise<T | null> {
    try {
      const r = await fetch(`${this.base}${path}`, {
        headers: { 'X-Internal-Key': this.token },   // v10.27 (G-175) — 본체가 읽는 이름(internal-key.guard.ts)과 같게. 전에는 X-Internal-Token 이라 늘 거절됨
        signal: AbortSignal.timeout(1500),   // 광고 때문에 화면이 늦으면 안 됩니다
      });
      if (!r.ok) return null;
      return (await r.json()) as T;
    } catch {
      return null;      // 본체가 안 뜨면 조용히 일반 광고로 떨어집니다
    }
  }

  /**
   * 성향 조회.
   *
   * ★ null 을 받으면 **성향 없음으로 취급**합니다.
   *   "모르니까 일단 보여주자" 가 아니라 "모르면 일반 광고" 입니다.
   */
  async adProfile(accountId: string): Promise<AdProfile> {
    const r = await this.get<AdProfile>(`/internal/accounts/${accountId}/ad-profile`);
    return r ?? { segment: null, consented: false };
  }

  /** 사업자 실재·휴폐업 확인. */
  async checkBiz(bizId: string): Promise<BizCheck> {
    const r = await this.get<BizCheck>(`/internal/businesses/${bizId}`);
    return r ?? { exists: false, name: null, active: false };
  }
}
