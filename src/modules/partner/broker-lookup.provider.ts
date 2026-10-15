/* ---------------------------------------------------------------------
 * 중개사무소 대조 (INV-BR1 · D008 · 2026-10-02)
 *
 * 개설등록번호 · 사무소명 · 대표자를 공공 조회(국토교통부 · 브이월드 「부동산중개업」 계열 API)와
 * 맞춰 봅니다. 맞아도 **자동 승인은 없습니다** — 명의 도용은 대조로 거를 수 없어 사람이 봅니다
 * (fn_broker_guard 가 decided_by 없는 승인을 막습니다).
 *
 * ── 형식을 지어내지 않습니다 ────────────────────────────────────────
 * 공식 API 의 정확한 요청 파라미터 · 응답 필드 이름을 이 코드에서 확정하지 않았습니다.
 * 그래서 **설정형 범용 어댑터**로 둡니다. 키를 받은 뒤 그 API 문서대로 아래 환경변수만 채우면
 * 코드를 고치지 않고 붙습니다. 아래 기본값의 이름은 모두 **자리표시**입니다.
 *
 *   BROKER_LOOKUP_URL          조회 주소(전체 URL). 없으면 스텁
 *   BROKER_LOOKUP_KEY          인증 키.            없으면 스텁
 *   BROKER_LOOKUP_METHOD       GET(기본) | POST
 *   BROKER_LOOKUP_KEY_PARAM    키를 싣는 쿼리 이름(기본 key). 비우고 BROKER_LOOKUP_AUTH_HEADER 를 주면 헤더로 보냄
 *   BROKER_LOOKUP_AUTH_HEADER  키를 싣는 헤더 이름(선택)
 *   BROKER_LOOKUP_PARAMS       {"licenseNo":"…","officeName":"…","ceoName":"…"} 우리 값 → 업체 파라미터 이름.
 *                              빠진 항목은 보내지 않습니다(기본: licenseNo 하나만 "licenseNo" 로)
 *   BROKER_LOOKUP_EXTRA        늘 붙일 값(JSON) — 예) 응답 형식 · 페이지 크기
 *   BROKER_LOOKUP_RESULT_PATH  성공 판정 경로(선택) — 예) 봉투의 결과 코드
 *   BROKER_LOOKUP_RESULT_OK    성공 값들(쉼표). RESULT_PATH 가 있을 때만 봅니다
 *   BROKER_LOOKUP_ITEMS_PATH   목록 경로(기본 items). 배열이 아니면 한 건으로 봅니다
 *   BROKER_LOOKUP_FIELDS       {"licenseNo":"…","officeName":"…","ceoName":"…","status":"…"} 목록 항목의 필드 이름
 *   BROKER_LOOKUP_ACTIVE       영업 중을 뜻하는 status 값들(쉼표). 비우면 상태를 보지 않습니다
 *   BROKER_LOOKUP_TIMEOUT_MS   제한 시간(기본 5000)
 *
 * 판정
 *   목록에 같은 등록번호(숫자만 비교)가 없으면     NOT_FOUND
 *   있는데 사무소명 · 대표자가 다르거나 영업 중이 아니면  MISMATCH (무엇이 다른지 detail 에)
 *   모두 같으면                                     MATCH
 *   조회 실패(지연 · 연결 · 인증 · 형식)             null — 미조회. 결격으로 바꾸지 않습니다
 *                                                  (국세청 어댑터와 같은 원칙). 운영이 다시 조회합니다.
 * ------------------------------------------------------------------- */
import { envInt, envJson, FetchLike, getPath, httpJson, HttpErrorKind, normName } from '../../common/http-json';

export type BrokerLookupResult = 'MATCH' | 'MISMATCH' | 'NOT_FOUND';

export interface BrokerLookupOutcome {
  /** null 이면 조회하지 못한 것(미조회) */
  result: BrokerLookupResult | null;
  stub: boolean;
  detail: string;
  errorKind?: HttpErrorKind | 'NOT_CONFIGURED';
}

export interface BrokerLookupInput { licenseNo: string; officeName: string; ceoName: string }

export abstract class BrokerLookupProvider {
  /** 실제 조회가 설정돼 있는가 */
  abstract readonly configured: boolean;
  abstract lookup(input: BrokerLookupInput): Promise<BrokerLookupOutcome>;
}

/** 키 · 주소가 없을 때. 조회하지 않았다는 사실을 그대로 돌려줍니다 */
export class StubBrokerLookup extends BrokerLookupProvider {
  readonly configured = false;
  async lookup(): Promise<BrokerLookupOutcome> {
    return { result: null, stub: true, errorKind: 'NOT_CONFIGURED',
      detail: '국토부 중개사무소 조회 연동이 설정되지 않았습니다(BROKER_LOOKUP_URL · BROKER_LOOKUP_KEY).' };
  }
}

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

const KIND_TEXT: Record<string, string> = {
  TIMEOUT: '중개사무소 조회 응답이 늦어 대조하지 못했습니다 — 운영이 다시 조회합니다.',
  NETWORK: '중개사무소 조회 기관에 연결하지 못했습니다 — 운영이 다시 조회합니다.',
  AUTH: '중개사무소 조회 인증에 실패했습니다(키 · 발신 IP 확인 필요).',
  UPSTREAM: '중개사무소 조회 기관 장애로 대조하지 못했습니다 — 운영이 다시 조회합니다.',
  BAD_RESPONSE: '중개사무소 조회 응답 형식이 설정과 다릅니다(BROKER_LOOKUP_ITEMS_PATH · FIELDS 확인).',
  HTTP_4XX: '중개사무소 조회 요청이 거부됐습니다(파라미터 설정 확인).',
};

export class HttpBrokerLookup extends BrokerLookupProvider {
  readonly configured = true;
  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly fetchFn?: FetchLike,
  ) { super(); }

  async lookup(input: BrokerLookupInput): Promise<BrokerLookupOutcome> {
    const params = envJson<Record<string, string>>('BROKER_LOOKUP_PARAMS', { licenseNo: 'licenseNo' });
    const extra = envJson<Record<string, unknown>>('BROKER_LOOKUP_EXTRA', {});
    const fields = envJson<Record<string, string>>('BROKER_LOOKUP_FIELDS',
      { licenseNo: 'licenseNo', officeName: 'officeName', ceoName: 'ceoName', status: '' });
    const cfgErr = params.error ?? extra.error ?? fields.error;
    if (cfgErr) return { result: null, stub: false, errorKind: 'NOT_CONFIGURED', detail: `중개사무소 조회 설정 오류 — ${cfgErr}` };

    const method = (process.env.BROKER_LOOKUP_METHOD ?? 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
    const keyParam = process.env.BROKER_LOOKUP_KEY_PARAM ?? 'key';
    const authHeader = process.env.BROKER_LOOKUP_AUTH_HEADER;

    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(extra.value)) q[k] = String(v);
    const mine: Record<string, string> = {
      licenseNo: input.licenseNo.trim(), officeName: input.officeName.trim(), ceoName: input.ceoName.trim(),
    };
    for (const [ours, theirs] of Object.entries(params.value)) {
      if (theirs && mine[ours] !== undefined) q[theirs] = mine[ours];
    }
    if (keyParam && !authHeader) q[keyParam] = this.key;
    const headers: Record<string, string> = authHeader ? { [authHeader]: this.key } : {};

    const qs = new URLSearchParams(method === 'GET' ? q : (keyParam && !authHeader ? { [keyParam]: this.key } : {}));
    const url = this.url + (qs.toString() ? (this.url.includes('?') ? '&' : '?') + qs.toString() : '');
    const body = method === 'POST'
      ? Object.fromEntries(Object.entries(q).filter(([k]) => !(keyParam && !authHeader && k === keyParam)))
      : undefined;

    const r = await httpJson({ url, method, headers, body,
      timeoutMs: envInt('BROKER_LOOKUP_TIMEOUT_MS', 5000), fetchFn: this.fetchFn });
    if (!r.ok) return { result: null, stub: false, errorKind: r.errorKind, detail: KIND_TEXT[r.errorKind!] ?? '대조하지 못했습니다.' };

    const okPath = process.env.BROKER_LOOKUP_RESULT_PATH;
    if (okPath) {
      const okVals = (process.env.BROKER_LOOKUP_RESULT_OK ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const v = getPath(r.body, okPath);
      if (!okVals.includes(String(v))) {
        return { result: null, stub: false, errorKind: 'BAD_RESPONSE',
          detail: `중개사무소 조회 기관이 실패를 돌려줬습니다(결과 코드 ${String(v).slice(0, 20)}) — 운영이 다시 조회합니다.` };
      }
    }

    const raw = getPath(r.body, process.env.BROKER_LOOKUP_ITEMS_PATH || 'items');
    if (raw === undefined) {
      return { result: null, stub: false, errorKind: 'BAD_RESPONSE', detail: KIND_TEXT.BAD_RESPONSE };
    }
    const items: any[] = raw == null || raw === '' ? [] : Array.isArray(raw) ? raw : [raw];

    const f = fields.value;
    const hit = items.find((it) => digits(getPath(it, f.licenseNo)) !== ''
                                  && digits(getPath(it, f.licenseNo)) === digits(input.licenseNo));
    if (!hit) {
      return { result: 'NOT_FOUND', stub: false,
        detail: `개설등록번호 ${input.licenseNo.trim()} 로 등록된 중개사무소가 조회되지 않습니다.` };
    }

    const diffs: string[] = [];
    const office = getPath(hit, f.officeName);
    if (f.officeName && office != null && normName(office) !== normName(input.officeName)) {
      diffs.push(`사무소명 불일치(등록: ${String(office).slice(0, 60)})`);
    }
    const ceo = getPath(hit, f.ceoName);
    if (f.ceoName && ceo != null && normName(ceo) !== normName(input.ceoName)) {
      diffs.push('대표자 불일치');
    }
    const active = (process.env.BROKER_LOOKUP_ACTIVE ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (f.status && active.length) {
      const st = getPath(hit, f.status);
      if (!active.includes(String(st ?? '').trim())) diffs.push(`영업 상태 아님(${String(st ?? '없음').slice(0, 20)})`);
    }
    if (diffs.length) return { result: 'MISMATCH', stub: false, detail: diffs.join(' · ') };
    return { result: 'MATCH', stub: false, detail: '국토부 등록 정보와 일치합니다.' };
  }
}

export function resolveBrokerLookupProvider(): BrokerLookupProvider {
  const url = process.env.BROKER_LOOKUP_URL;
  const key = process.env.BROKER_LOOKUP_KEY;
  return url && key ? new HttpBrokerLookup(url, key) : new StubBrokerLookup();
}
