/* ---------------------------------------------------------------------
 * 1원 계좌인증
 *
 * 정산 계좌가 **진짜 그 사람 것인지** 확인합니다. 1원을 보내고
 * 입금자명에 찍힌 코드를 맞춰 보는 방식입니다.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────
 * 계좌번호는 손으로 칩니다. 한 자리만 틀려도 **남의 계좌로 소개비가
 * 갑니다.** 받은 쪽은 모르고, 보낸 쪽은 돌려받기 어렵습니다.
 *
 * 예금주 이름만 대조해도 동명이인이 걸립니다 — 계좌 자체를
 * 확인해야 합니다.
 *
 * ── 계약 전에는 스텁입니다 ───────────────────────────────────────
 * `BANK_VERIFY_KEY` 가 없으면 stub:true 를 실어 보냅니다.
 * **화면이 그것을 표시해야** 합니다 — "클릭 즉시 통과" 가 실동작처럼
 * 보이면 오픈 때 아무도 이 게이트를 확인하지 않습니다.
 *
 * ── INV-11 ───────────────────────────────────────────────────────
 * 1원은 **우리가 보내는 돈**이라 자금 수탁이 아닙니다.
 * 소개비는 이 경로를 타지 않습니다 — 당사자끼리 직접 주고받습니다.
 * ------------------------------------------------------------------- */

import { createHash, randomInt } from 'crypto';
import { envInt, envJson, FetchLike, getPath, httpJson, normName, setPath } from '../../common/http-json';
import { IntegrationErrorKind } from '../../common/integration/errors';

export interface BankVerifyResult {
  /** 1원이 실제로 보내졌는가 */
  sent: boolean;
  stub: boolean;
  /** 입금자명에 찍히는 코드. 이용자가 이것을 보고 입력합니다 */
  code?: string;
  /** 실패 사유. 화면에 그대로 보여주면 이용자가 이유를 압니다 */
  detail?: string;
  /** 업체 거래번호(있으면). 확인 API 가 이것을 요구하는 업체가 있습니다 */
  txId?: string;
  /** 실패 분류 — 재시도 여부 판단용 (D008) */
  errorKind?: BankErrorKind;
}

export interface BankConfirmResult {
  verified: boolean;
  stub: boolean;
  holderName?: string;
  detail?: string;
  errorKind?: BankErrorKind;
}

/** v10.44 — 공통 연동 오류 종류(common/integration/errors.ts) + 계좌인증에만 있는 둘 */
export type BankErrorKind = IntegrationErrorKind | 'HOLDER_MISMATCH' | 'CODE_MISMATCH';

export abstract class BankVerifyProvider {
  /** 1원을 보냅니다. 입금자명에 코드가 찍힙니다 */
  abstract send(input: {
    bankCode: string;
    accountNo: string;
    holderName: string;
  }): Promise<BankVerifyResult>;

  /**
   * 이용자가 적어 낸 코드를 맞춰 봅니다.
   *
   * expected     서버가 저장해 둔 코드(평문 보관 시) — 있으면 이것과 대조합니다
   * localMatched 호출하는 쪽이 이미 해시로 대조해 맞았는가 — 코드를 해시로만 둔 경우
   * txId         업체 확인 API 가 거래번호를 요구할 때
   */
  abstract confirm(input: {
    bankCode: string;
    accountNo: string;
    code: string;
    expected?: string | null;
    localMatched?: boolean;
    txId?: string;
  }): Promise<BankConfirmResult>;
}

/**
 * 계약 전 스텁.
 *
 * **통과시키되 stub:true 를 남깁니다.** 막으면 개발이 멈추고,
 * 조용히 통과시키면 오픈 때 아무도 확인하지 않습니다.
 */
class StubBankVerify extends BankVerifyProvider {
  async send(): Promise<BankVerifyResult> {
    return {
      sent: true,
      stub: true,
      /* 고정 코드입니다 — 실제로는 은행이 정합니다 */
      code: 'SGB01',
      detail: '계약 전이라 실제로 1원이 보내지지 않았습니다.',
    };
  }

  async confirm(input: { code: string }): Promise<BankConfirmResult> {
    /* 스텁에서도 **코드가 틀리면 막습니다** — 화면 흐름을 그대로
     * 확인할 수 있어야 계약 뒤에 처음 돌려 보는 일이 없습니다. */
    if (input.code !== 'SGB01') {
      return { verified: false, stub: true, detail: '코드가 맞지 않습니다.' };
    }
    return {
      verified: true,
      stub: true,
      holderName: '(스텁) 확인되지 않은 예금주',
      detail: '계약 전이라 실제 예금주를 확인하지 않았습니다.',
    };
  }
}

/* ---------------------------------------------------------------------
 * 실제 연동 — 설정형 범용 HTTP 어댑터 (D008 · 2026-10-02)
 *
 * 1원 인증은 업체(오픈뱅킹 이용기관 · 쿠콘 · 세틀뱅크 등)마다 요청 · 응답 형식이 다릅니다.
 * **특정 업체 형식을 지어내지 않습니다.** 공통 흐름만 코드에 두고, 필드 이름은 설정으로 받습니다.
 *
 * 환경변수
 *   BANK_VERIFY_KEY          인증 키 (없으면 스텁)
 *   BANK_VERIFY_URL          업체 기준 주소 (없으면 "엔드포인트 미설정"으로 실패 — 스텁으로 돌아가지 않음)
 *   BANK_VERIFY_SEND_PATH    1원 송금 경로        (기본 /send)
 *   BANK_VERIFY_CONFIRM_PATH 코드 확인 경로       (기본 비움 → 서버 저장 코드와 대조)
 *   BANK_VERIFY_TIMEOUT_MS   제한 시간            (기본 5000)
 *   BANK_VERIFY_AUTH_HEADER  키를 싣는 헤더       (기본 Authorization)
 *   BANK_VERIFY_AUTH_PREFIX  헤더 값 앞머리       (기본 "Bearer ")
 *   BANK_VERIFY_CODE_MODE    VENDOR  업체가 정한 코드를 응답에서 읽음(기본)
 *                            PLATFORM 우리가 만든 코드를 입금자명(printText)으로 보냄
 *   BANK_VERIFY_EXTRA        요청 본문에 늘 붙일 값(JSON) — 업체 서비스 코드 등
 *   BANK_VERIFY_MAP          필드 지도(JSON). 아래 기본값의 이름은 **자리표시**입니다 — 업체 문서대로 바꾸십시오.
 *     req.bankCode   req.accountNo  req.holderName  req.printText  req.code  req.txId   (요청 본문 경로, 점 표기로 중첩 가능)
 *     res.success    res.successValue  res.code  res.txId  res.holderName  res.errorCode  res.errorMessage (응답 경로)
 *   BANK_VERIFY_ERROR_MESSAGES 업체 오류 코드 → 화면 문구(JSON) — 예) {"E101":"계좌번호를 확인해 주십시오"}
 *
 * 흐름
 *   send     POST {URL}{SEND_PATH}  본문 = EXTRA + 지도대로 옮긴 은행코드 · 계좌번호 · 예금주 (+ printText)
 *            성공 판정 = res.success 값이 res.successValue 와 같음 (지도에서 res.success 를 비우면 HTTP 2xx 만 봄)
 *            응답에 예금주명이 오면 신청 예금주와 대조합니다(다르면 HOLDER_MISMATCH)
 *   confirm  CONFIRM_PATH 가 있으면 업체에 확인(txId · code), 없으면 서버가 가진 코드(expected · localMatched)와 대조
 *
 * 키 · 계좌번호는 로그 · 응답에 싣지 않습니다.
 * ------------------------------------------------------------------- */
const BANK_MAP_DEFAULT = {
  'req.bankCode': 'bankCode', 'req.accountNo': 'accountNo', 'req.holderName': 'holderName',
  'req.printText': 'printText', 'req.code': 'code', 'req.txId': 'txId',
  'res.success': 'success', 'res.successValue': 'true', 'res.code': 'code', 'res.txId': 'txId',
  'res.holderName': 'holderName', 'res.errorCode': 'errorCode', 'res.errorMessage': 'errorMessage',
} as Record<string, string>;

const BANK_KIND_TEXT: Record<string, string> = {
  TIMEOUT: '계좌인증 기관의 응답이 늦습니다. 잠시 뒤 다시 시도해 주십시오.',
  NETWORK: '계좌인증 기관에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주십시오.',
  AUTH: '계좌인증 연동 인증에 실패했습니다 — 운영 확인이 필요합니다(키 · 발신 IP).',
  UPSTREAM: '계좌인증 기관 장애입니다. 잠시 뒤 다시 시도해 주십시오.',
  BAD_RESPONSE: '계좌인증 기관 응답 형식이 맞지 않습니다 — 운영 확인이 필요합니다.',
  HTTP_4XX: '계좌 정보를 확인해 주십시오.',
};

export class RealBankVerify extends BankVerifyProvider {
  constructor(
    private readonly key: string,
    private readonly fetchFn?: FetchLike,
  ) { super(); }

  private cfg() {
    const map = envJson('BANK_VERIFY_MAP', BANK_MAP_DEFAULT);
    const extra = envJson<Record<string, unknown>>('BANK_VERIFY_EXTRA', {});
    const msgs = envJson<Record<string, string>>('BANK_VERIFY_ERROR_MESSAGES', {});
    return {
      url: (process.env.BANK_VERIFY_URL ?? '').replace(/\/+$/, ''),
      sendPath: process.env.BANK_VERIFY_SEND_PATH ?? '/send',
      confirmPath: process.env.BANK_VERIFY_CONFIRM_PATH ?? '',
      timeoutMs: envInt('BANK_VERIFY_TIMEOUT_MS', 5000),
      authHeader: process.env.BANK_VERIFY_AUTH_HEADER ?? 'Authorization',
      authPrefix: process.env.BANK_VERIFY_AUTH_PREFIX ?? 'Bearer ',
      codeMode: (process.env.BANK_VERIFY_CODE_MODE ?? 'VENDOR').toUpperCase(),
      map: map.value, extra: extra.value, msgs: msgs.value,
      cfgError: map.error ?? extra.error ?? msgs.error,
    };
  }

  private headers(c: ReturnType<RealBankVerify['cfg']>) {
    return { [c.authHeader]: `${c.authPrefix}${this.key}` };
  }

  /** 업체 응답의 실패를 화면 문구로 */
  private failText(c: ReturnType<RealBankVerify['cfg']>, body: any, fallback: string) {
    const code = getPath(body, c.map['res.errorCode']);
    const msg = getPath(body, c.map['res.errorMessage']);
    const mapped = code != null ? c.msgs[String(code)] : undefined;
    return mapped ?? (msg ? `${fallback} (기관: ${String(msg).slice(0, 100)})` : fallback);
  }

  private succeeded(c: ReturnType<RealBankVerify['cfg']>, body: any) {
    if (!c.map['res.success']) return true;                       // 성공 필드 없음 → HTTP 2xx 로 판정
    return String(getPath(body, c.map['res.success'])) === String(c.map['res.successValue']);
  }

  async send(input: {
    bankCode: string; accountNo: string; holderName: string;
  }): Promise<BankVerifyResult> {
    const c = this.cfg();
    if (!c.url) {
      /* 없는 주소로 요청을 보내면 타임아웃마다 화면이 멈춥니다. 명확히 실패시킵니다. */
      return { sent: false, stub: false, errorKind: 'NOT_CONFIGURED',
        detail: '계좌인증 연동이 아직 붙지 않았습니다 (BANK_VERIFY_KEY 는 있으나 BANK_VERIFY_URL 미설정).' };
    }
    if (c.cfgError) {
      return { sent: false, stub: false, errorKind: 'NOT_CONFIGURED', detail: `계좌인증 설정 오류 — ${c.cfgError}` };
    }

    const body: Record<string, any> = JSON.parse(JSON.stringify(c.extra));
    setPath(body, c.map['req.bankCode'], input.bankCode);
    setPath(body, c.map['req.accountNo'], String(input.accountNo).replace(/\D/g, ''));
    setPath(body, c.map['req.holderName'], input.holderName);
    /* 우리가 코드를 정하는 업체: 입금자명으로 찍을 문구를 보냅니다 */
    const platformCode = c.codeMode === 'PLATFORM' ? String(randomInt(1000, 10000)) : undefined;
    if (platformCode) setPath(body, c.map['req.printText'], `SGB${platformCode}`);

    const r = await httpJson({ url: c.url + c.sendPath, method: 'POST', headers: this.headers(c),
      body, timeoutMs: c.timeoutMs, fetchFn: this.fetchFn });
    if (!r.ok) {
      const base = BANK_KIND_TEXT[r.errorKind!] ?? '1원을 보내지 못했습니다.';
      return { sent: false, stub: false, errorKind: r.errorKind,
        detail: r.errorKind === 'HTTP_4XX' ? this.failText(c, r.body, base) : base };
    }
    if (!this.succeeded(c, r.body)) {
      return { sent: false, stub: false, errorKind: 'REJECTED',
        detail: this.failText(c, r.body, '1원을 보내지 못했습니다. 계좌를 다시 확인해 주십시오.') };
    }

    /* 예금주가 다르면 보내도 소용없습니다 — 남의 계좌일 수 있습니다 */
    const holder = getPath(r.body, c.map['res.holderName']);
    if (holder != null && String(holder).trim() && normName(holder) !== normName(input.holderName)) {
      return { sent: false, stub: false, errorKind: 'HOLDER_MISMATCH',
        detail: '예금주명이 신청하신 이름과 다릅니다. 본인 명의 계좌를 등록해 주십시오.' };
    }

    const vendorCode = getPath(r.body, c.map['res.code']);
    const code = platformCode ? `SGB${platformCode}` : (vendorCode != null ? String(vendorCode).trim() : '');
    if (!code) {
      return { sent: false, stub: false, errorKind: 'BAD_RESPONSE',
        detail: '계좌인증 기관이 인증 코드를 돌려주지 않았습니다 — 응답 지도(res.code) 확인이 필요합니다.' };
    }
    const txId = getPath(r.body, c.map['res.txId']);
    return { sent: true, stub: false, code: code.toUpperCase(), txId: txId != null ? String(txId) : undefined };
  }

  async confirm(input: {
    bankCode: string; accountNo: string; code: string;
    expected?: string | null; localMatched?: boolean; txId?: string;
  }): Promise<BankConfirmResult> {
    const c = this.cfg();
    const got = String(input.code ?? '').trim().toUpperCase();

    if (!c.confirmPath) {
      /* 확인 API 를 쓰지 않는 업체: 보낸 코드를 서버가 갖고 있으니 그것과 대조합니다 */
      if (input.expected != null && input.expected !== '') {
        const same = createHash('sha256').update(got).digest('hex')
          === createHash('sha256').update(String(input.expected).trim().toUpperCase()).digest('hex');
        return same ? { verified: true, stub: false }
          : { verified: false, stub: false, errorKind: 'CODE_MISMATCH', detail: '코드가 맞지 않습니다.' };
      }
      if (input.localMatched === true) return { verified: true, stub: false };
      return { verified: false, stub: false, errorKind: 'CODE_MISMATCH',
        detail: input.localMatched === false ? '코드가 맞지 않습니다.'
          : '대조할 코드가 서버에 없습니다 — 1원을 다시 받아 주십시오.' };
    }

    if (!c.url) {
      return { verified: false, stub: false, errorKind: 'NOT_CONFIGURED', detail: '계좌인증 연동이 아직 붙지 않았습니다.' };
    }
    const body: Record<string, any> = JSON.parse(JSON.stringify(c.extra));
    setPath(body, c.map['req.code'], got);
    if (input.txId) setPath(body, c.map['req.txId'], input.txId);
    if (input.bankCode) setPath(body, c.map['req.bankCode'], input.bankCode);
    if (input.accountNo) setPath(body, c.map['req.accountNo'], String(input.accountNo).replace(/\D/g, ''));

    const r = await httpJson({ url: c.url + c.confirmPath, method: 'POST', headers: this.headers(c),
      body, timeoutMs: c.timeoutMs, fetchFn: this.fetchFn });
    if (!r.ok) {
      return { verified: false, stub: false, errorKind: r.errorKind,
        detail: BANK_KIND_TEXT[r.errorKind!] ?? '확인하지 못했습니다.' };
    }
    if (!this.succeeded(c, r.body)) {
      return { verified: false, stub: false, errorKind: 'REJECTED', detail: this.failText(c, r.body, '코드가 맞지 않습니다.') };
    }
    const holder = getPath(r.body, c.map['res.holderName']);
    return { verified: true, stub: false, holderName: holder != null ? String(holder) : undefined };
  }
}

/**
 * 키가 있으면 실제, 없으면 스텁.
 *
 * `resolvePaymentProvider` 와 같은 방식입니다 — 연동마다 다르게
 * 하면 어느 것이 스텁인지 헷갈립니다.
 */
export function resolveBankVerifyProvider(): BankVerifyProvider {
  const key = process.env.BANK_VERIFY_KEY;
  return key ? new RealBankVerify(key) : new StubBankVerify();
}
