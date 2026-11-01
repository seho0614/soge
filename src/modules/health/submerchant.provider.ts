/* ---------------------------------------------------------------------
 * v10.169 (D158 · docs/260) — 소개몰 입점: 결제대행사 하위가맹점 등록 · 지급 요청 틀
 *
 *   판매대금은 결제대행사가 판매자 하위가맹점으로 직접 보내고 회사는 수수료만 받습니다(결정 A · 남의 돈을 보관하지 않음).
 *   실제 결제대행사 연동(하위가맹점 등록 · 지급대행)은 계약 뒤 — 그 API 모양은 결제대행사마다 달라 지금 만들지 않습니다(추측 금지).
 *   지금은 간주 모드(assume.payment = on)일 때만 시험 공급자(Stub)가 시험 번호로 「등록됨 · 지급됨」을 남깁니다 — 돈은 움직이지 않습니다.
 * ------------------------------------------------------------------- */
export type SubmerchantResult = { ok: true; submerchantId: string } | { ok: false; error: string };
export type PayoutResult = { ok: true; ref: string } | { ok: false; error: string };

export interface SubmerchantProvider {
  readonly name: string;
  readonly stub: boolean;
  register(seller: { code: string; name: string }): Promise<SubmerchantResult>;
  payout(p: { submerchantId: string; amount: number; ref: string }): Promise<PayoutResult>;
}

/** 시험 공급자 — 외부 호출 없음 · 시험 번호만 */
export class StubSubmerchantProvider implements SubmerchantProvider {
  readonly name = 'STUB';
  readonly stub = true;
  async register(seller: { code: string }): Promise<SubmerchantResult> {
    return { ok: true, submerchantId: `STUB-SUB-${seller.code}` };
  }
  async payout(p: { ref: string }): Promise<PayoutResult> {
    return { ok: true, ref: `STUB-PAYOUT-${p.ref}` };
  }
}

/**
 * 쓸 공급자 — 간주 모드면 시험 공급자, 아니면 없음(null · 결제대행사 지급대행 연동 전).
 * 결제대행사 키가 있어도 지급대행 연동은 아직 없으므로 null 입니다(실연동은 계약 뒤 이 자리에 붙임).
 */
export function resolveSubmerchantProvider(assumeOn: boolean): SubmerchantProvider | null {
  return assumeOn ? new StubSubmerchantProvider() : null;
}
