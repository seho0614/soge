export interface IdentityResult { success: boolean; ciHash?: string; stub: boolean }
export interface BizStatusResult {
  status: 'VALID'|'CLOSED'|'SUSPENDED'|'UNKNOWN';
  stub: boolean;
  /** 국세청이 돌려준 상태 문구. 화면에 그대로 보여주면 이용자가 이유를 압니다 */
  detail?: string;
}

export abstract class IdentityProvider {
  abstract verify(input: { name: string; phone: string }): Promise<IdentityResult>;
}
export abstract class BizStatusProvider {
  abstract check(bizRegNo: string): Promise<BizStatusResult>;
}

/**
 * 계약·발신 IP 등록에 4~6주가 걸리므로 그 전까지 스텁으로 갑니다.
 * stub: true 를 반드시 응답에 실어 화면에 표시하십시오 —
 * 구 모델에서 "클릭 즉시 통과"가 실동작처럼 보였던 것이 시연 리스크였습니다.
 */
export class StubIdentityProvider extends IdentityProvider {
  async verify() { return { success: true, ciHash: 'stub-ci', stub: true }; }
}
export class StubBizStatusProvider extends BizStatusProvider {
  async check() { return { status: 'VALID' as const, stub: true }; }
}

/* ---------------------------------------------------------------------
 * 국세청 사업자등록 상태조회 (공공데이터포털)
 *
 * POST https://api.odcloud.kr/api/nts-businessman/v1/status
 *      ?serviceKey={키}&returnType=JSON
 * body { "b_no": ["0000000000"] }
 *
 * 상태 코드
 *   01 계속사업자 · 02 휴업자 · 03 폐업자
 *   미등록이면 b_stt 가 비고 tax_type 에 안내 문구가 옵니다.
 *
 * 이전 구현은 키가 주입되면 throw 했습니다.
 * 주석에는 "키만 주입되면 교체됩니다(코드 수정 불필요)" 라고 적혀 있었지만,
 * 실제로는 키를 넣는 순간 사업자 인증이 통째로 실패하는 상태였습니다.
 * 스텁보다 나쁩니다 — 키를 넣었다는 사실 자체가 장애가 됩니다.
 * ------------------------------------------------------------------- */

type FetchLike = (url: string, init: Record<string, unknown>) => Promise<{
  ok: boolean; status: number; json: () => Promise<any>;
}>;

/** 공식 기준 주소. NTS_API_BASE 로 바꿀 수 있습니다(시험용 가짜 서버 · 프록시) — 경로 /status 는 그대로 붙습니다 */
export const NTS_API_BASE_DEFAULT = 'https://api.odcloud.kr/api/nts-businessman/v1';
export const ntsStatusUrl = (base?: string) =>
  `${(base || process.env.NTS_API_BASE || NTS_API_BASE_DEFAULT).replace(/\/+$/, '')}/status`;

export class NtsBizStatusProvider extends BizStatusProvider {
  constructor(
    private readonly serviceKey: string,
    /** 시험에서 갈아끼우기 위해 주입받습니다. 운영에서는 전역 fetch 를 씁니다 */
    private readonly http: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs = Number(process.env.NTS_TIMEOUT_MS) || 5000,
    /** 비우면 NTS_API_BASE → 공식 주소 순서로 씁니다 */
    private readonly baseUrl?: string,
  ) { super(); }

  async check(bizRegNo: string): Promise<BizStatusResult> {
    const bNo = String(bizRegNo || '').replace(/\D/g, '');
    if (bNo.length !== 10) {
      return { status: 'UNKNOWN', stub: false, detail: '사업자등록번호는 10자리 숫자여야 합니다' };
    }

    // 키는 URL 에만 들어갑니다. 로그에 남기지 않습니다.
    const url = `${ntsStatusUrl(this.baseUrl)}?serviceKey=${encodeURIComponent(this.serviceKey)}&returnType=JSON`;

    let body: any;
    try {
      const res = await this.http(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ b_no: [bNo] }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        // 국세청 장애를 사업자 결격으로 바꾸지 않습니다.
        // UNKNOWN 이면 사람 검수로 넘어가고, CLOSED 면 이용자가 막힙니다.
        return { status: 'UNKNOWN', stub: false, detail: `국세청 응답 오류(HTTP ${res.status})` };
      }
      body = await res.json();
    } catch (e: any) {
      const msg = e?.name === 'TimeoutError' ? '국세청 응답 지연' : '국세청 연결 실패';
      return { status: 'UNKNOWN', stub: false, detail: msg };
    }

    if (body?.status_code !== 'OK' || !Array.isArray(body?.data) || body.data.length === 0) {
      return { status: 'UNKNOWN', stub: false, detail: '조회 결과 없음' };
    }

    const row = body.data[0] ?? {};
    const detail: string = row.b_stt || row.tax_type || '';

    switch (String(row.b_stt_cd || '')) {
      case '01': return { status: 'VALID',     stub: false, detail };
      case '02': return { status: 'SUSPENDED', stub: false, detail };
      case '03': return { status: 'CLOSED',    stub: false, detail };
      default:   return { status: 'UNKNOWN',   stub: false, detail: detail || '등록되지 않은 사업자등록번호' };
    }
  }
}

/**
 * 키가 있으면 실제, 없으면 스텁.
 *
 * NTS_API_BASE 가 공식 주소가 아니어도(가짜 서버 · 사내 프록시) stub 은 false 입니다 —
 * 실제 HTTP 로 응답을 받았기 때문입니다. 대신 국세청 단계(nts_env)는 integrations.NTS 가
 * LIVE 일 때만 LIVE 로 찍히므로(business.service), 시험 기록이 일괄 승인 근거가 되지 않습니다.
 */
export function resolveBizStatusProvider(): BizStatusProvider {
  const key = process.env.NTS_SERVICE_KEY;
  return key ? new NtsBizStatusProvider(key) : new StubBizStatusProvider();
}
