/* ---------------------------------------------------------------------
 * 전자계약 (e-Sign)
 *
 * 표준계약서에 양측이 서명하게 합니다.
 *
 * ── 왜 전자계약인가 ──────────────────────────────────────────────
 * 종이로 받으면 **언제 누가 서명했는지 다투게** 됩니다. 전자계약은
 * 서명 시각과 서명자를 제공자가 증명해 줍니다.
 *
 * 우리가 직접 타임스탬프를 찍으면 **우리가 만든 기록**이라
 * 분쟁에서 약합니다.
 *
 * ── 계약 전에는 스텁입니다 ───────────────────────────────────────
 * `ESIGN_API_KEY` 가 없으면 stub:true 를 실어 보냅니다.
 * **화면이 그것을 표시해야** 합니다 — "서명 완료" 가 실동작처럼
 * 보이면 법적 효력이 없는 계약을 믿게 됩니다.
 *
 * `deal_contracts.esign_stub` 가 이것을 남기고,
 * `v_contract_stub` 가 오픈 전에 0인지 봅니다.
 * ------------------------------------------------------------------- */

export interface ESignRequestResult {
  /** 서명 요청이 실제로 나갔는가 */
  sent: boolean;
  stub: boolean;
  /** 제공자가 준 문서 id. 나중에 조회·취소에 씁니다 */
  docId?: string;
  /** 서명자가 들어갈 주소 */
  signUrl?: string;
  detail?: string;
}

export interface ESignStatusResult {
  state: 'PENDING' | 'SIGNED' | 'REJECTED' | 'EXPIRED';
  stub: boolean;
  signedAt?: string;
  /** 누가 서명했는지 — 분쟁 때 이것이 근거입니다 */
  signers?: Array<{ name: string; signedAt: string }>;
  detail?: string;
}

export abstract class ESignProvider {
  /** 서명 요청을 보냅니다 */
  abstract request(input: {
    templateCode: string;
    body: string;
    signers: Array<{ name: string; email?: string; phone?: string }>;
  }): Promise<ESignRequestResult>;

  /** 서명이 끝났는지 봅니다 */
  abstract status(docId: string): Promise<ESignStatusResult>;
}

/**
 * 계약 전 스텁.
 *
 * **통과시키되 stub:true 를 남깁니다.** 막으면 개발이 멈추고,
 * 조용히 통과시키면 오픈 때 아무도 확인하지 않습니다.
 */
class StubESign extends ESignProvider {
  async request(input: { templateCode: string }): Promise<ESignRequestResult> {
    return {
      sent: true,
      stub: true,
      docId: `STUB-${input.templateCode}-${Date.now()}`,
      detail: '연동 전이라 실제 서명 요청이 나가지 않았습니다.',
    };
  }

  async status(docId: string): Promise<ESignStatusResult> {
    /* 스텁은 즉시 서명된 것으로 봅니다 — 화면 흐름을 확인해야
     * 계약 뒤에 처음 돌려 보는 일이 없습니다. */
    return {
      state: 'SIGNED',
      stub: true,
      signedAt: new Date().toISOString(),
      detail: `연동 전이라 실제로 서명되지 않았습니다 (${docId}).`,
    };
  }
}

/**
 * 실제 연동.
 *
 * ★ 계약이 끝나면 **여기만 채우면 됩니다.** 호출하는 쪽은
 *   바꿀 것이 없습니다.
 */
class RealESign extends ESignProvider {
  constructor(private readonly key: string) { super(); }

  async request(input: {
    templateCode: string; body: string;
    signers: Array<{ name: string }>;
  }): Promise<ESignRequestResult> {
    /* 계약 뒤 실제 엔드포인트로 바꾸십시오.
     *
     * 지금 붙이면 없는 주소로 요청이 나가 **타임아웃마다 화면이
     * 멈춥니다.** 키가 들어오기 전까지는 명확히 실패시킵니다. */
    void input; void this.key;
    return {
      sent: false,
      stub: false,
      detail: '전자계약 연동이 아직 붙지 않았습니다 (ESIGN_API_KEY 는 있으나 엔드포인트 미설정).',
    };
  }

  async status(docId: string): Promise<ESignStatusResult> {
    void docId; void this.key;
    return {
      state: 'PENDING',
      stub: false,
      detail: '전자계약 연동이 아직 붙지 않았습니다.',
    };
  }
}

/**
 * 키가 있으면 실제, 없으면 스텁.
 *
 * `resolvePaymentProvider` · `resolveBankVerifyProvider` 와 같은
 * 방식입니다 — 연동마다 다르게 하면 어느 것이 스텁인지 헷갈립니다.
 */
export function resolveESignProvider(): ESignProvider {
  const key = process.env.ESIGN_API_KEY;
  return key ? new RealESign(key) : new StubESign();
}
