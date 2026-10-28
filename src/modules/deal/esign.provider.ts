import { envInt, envJson, FetchLike, getPath, httpJson } from '../../common/http-json';
import { IntegrationErrorKind } from '../../common/integration/errors';

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
 * 방식(esign.provider)이 STUB 이면 stub:true 를 실어 보냅니다(v10.143 — 키만으로는 바뀌지 않음 · 업체는 HTTP).
 * **화면이 그것을 표시해야** 합니다 — "서명 완료" 가 실동작처럼
 * 보이면 법적 효력이 없는 계약을 믿게 됩니다.
 *
 * `deal_contracts.esign_stub` 가 이것을 남기고,
 * `v_contract_stub` 로 셀 수 있습니다(지금 이 뷰를 보는 곳은 없음 — docs/216 정정 · 화면 안 서명은 스텁을 남기지 않음).
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

/* ---------------------------------------------------------------------
 * v10.143 (D139 · docs/217 · 설계 docs/216) — 업체 공통 HTTP 틀
 *
 *   주소 ESIGN_URL + 경로(ESIGN_CREATE_PATH /documents · ESIGN_STATUS_PATH /documents/{id} · ESIGN_CANCEL_PATH /documents/{id}/cancel)
 *   인증 머리글 ESIGN_AUTH_HEADER(Authorization) + ESIGN_AUTH_PREFIX(Bearer ) + ESIGN_API_KEY
 *   응답 칸 위치 ESIGN_RESULT_ID_PATH(id) · ESIGN_RESULT_SIGNERS_PATH(signers) · ESIGN_RESULT_STATE_PATH(status) · ESIGN_RESULT_HASH_PATH(documentHash)
 *   상태 이름 바꾸기 ESIGN_STATE_MAP(JSON) — 업체 상태 → PENDING · SIGNED · REJECTED · EXPIRED · CANCELLED
 *   서명자는 externalId BUYER · SELLER 로 보내고 같은 값으로 돌려받음.
 *   ★ 업체(모두싸인 · 이폼사인 · 글로싸인 등)가 정해지면 칸 이름을 맞추거나 전용 파일 하나 — 공개 자료 기준이라 계약 뒤 확인 필요
 * ------------------------------------------------------------------- */
export type ESignRole = 'BUYER' | 'SELLER';
export type ESignErrorKind = IntegrationErrorKind;
export interface ESignSigner { role: ESignRole; name: string; phone?: string | null; email?: string | null }
export interface ESignCreateResult { ok: boolean; docId?: string; signUrls?: Partial<Record<ESignRole, string>>; errorKind?: ESignErrorKind; error?: string }
export interface ESignVendorStatus {
  ok: boolean; state?: 'PENDING' | 'SIGNED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
  signers?: Array<{ role: ESignRole; signedAt: string }>; docHash?: string | null; errorKind?: ESignErrorKind; error?: string;
}

const DEFAULT_STATE_MAP: Record<string, string> = {
  PENDING: 'PENDING', IN_PROGRESS: 'PENDING', SENT: 'PENDING', WAITING: 'PENDING',
  COMPLETED: 'SIGNED', SIGNED: 'SIGNED', DONE: 'SIGNED',
  REJECTED: 'REJECTED', DECLINED: 'REJECTED', REFUSED: 'REJECTED',
  EXPIRED: 'EXPIRED', CANCELED: 'CANCELLED', CANCELLED: 'CANCELLED', VOIDED: 'CANCELLED',
};
const VENDOR_STATES = new Set(['PENDING', 'SIGNED', 'REJECTED', 'EXPIRED', 'CANCELLED']);

export class HttpESign {
  constructor(private readonly fetchFn?: FetchLike) {}

  static missing(): string[] {
    return ['ESIGN_API_KEY', 'ESIGN_WEBHOOK_SECRET', 'ESIGN_URL'].filter((k) => !process.env[k]?.trim());
  }
  private url(kind: 'CREATE' | 'STATUS' | 'CANCEL', id = '') {
    const dflt = { CREATE: '/documents', STATUS: '/documents/{id}', CANCEL: '/documents/{id}/cancel' }[kind];
    const path = (process.env[`ESIGN_${kind}_PATH`]?.trim() || dflt).replace('{id}', encodeURIComponent(id));
    return process.env.ESIGN_URL!.trim().replace(/\/+$/, '') + path;
  }
  private headers() {
    return { [process.env.ESIGN_AUTH_HEADER?.trim() || 'Authorization']: (process.env.ESIGN_AUTH_PREFIX ?? 'Bearer ') + (process.env.ESIGN_API_KEY ?? '').trim() };
  }
  private timeout() { return Math.min(Math.max(envInt('ESIGN_TIMEOUT_MS', 8000), 1000), 30000); }

  async create(input: { contractId: string; title: string; content: string; docHash: string; expiresAt: string; signers: ESignSigner[]; callbackUrl: string }): Promise<ESignCreateResult> {
    if (HttpESign.missing().length) return { ok: false, errorKind: 'NOT_CONFIGURED', error: `빠진 설정 ${HttpESign.missing().join(',')}` };
    const r = await httpJson({ url: this.url('CREATE'), method: 'POST', headers: this.headers(), timeoutMs: this.timeout(), fetchFn: this.fetchFn,
      body: { externalId: input.contractId, title: input.title, content: input.content, documentHash: input.docHash, expiresAt: input.expiresAt,
        callbackUrl: input.callbackUrl, signers: input.signers.map((s) => ({ externalId: s.role, name: s.name, phone: s.phone ?? undefined, email: s.email ?? undefined })) } });
    if (!r.ok) return { ok: false, errorKind: r.errorKind, error: `${r.error ?? ''} ${JSON.stringify(r.body ?? '').slice(0, 100)}`.trim() };
    const id = getPath(r.body, process.env.ESIGN_RESULT_ID_PATH?.trim() || 'id');
    if (id == null || String(id).trim() === '') return { ok: false, errorKind: 'BAD_RESPONSE', error: '문서 id 가 없는 응답' };
    const urls: Partial<Record<ESignRole, string>> = {};
    const list = getPath(r.body, process.env.ESIGN_RESULT_SIGNERS_PATH?.trim() || 'signers');
    if (Array.isArray(list)) for (const x of list) {
      const role = String(x?.externalId ?? x?.role ?? '').toUpperCase();
      const u = String(x?.signUrl ?? x?.url ?? '');
      if ((role === 'BUYER' || role === 'SELLER') && /^https:\/\//.test(u)) urls[role] = u.slice(0, 1000);
    }
    return { ok: true, docId: String(id).slice(0, 200), signUrls: urls };
  }

  async status(docId: string): Promise<ESignVendorStatus> {
    if (HttpESign.missing().length) return { ok: false, errorKind: 'NOT_CONFIGURED', error: `빠진 설정 ${HttpESign.missing().join(',')}` };
    const r = await httpJson({ url: this.url('STATUS', docId), method: 'GET', headers: this.headers(), timeoutMs: this.timeout(), fetchFn: this.fetchFn });
    if (!r.ok) return { ok: false, errorKind: r.errorKind, error: r.error };
    return HttpESign.readStatus(r.body);
  }

  /** 업체 응답(조회 · 웹훅 본문 같은 모양) → 우리 상태. 모르는 상태 이름이면 BAD_RESPONSE(아무것도 바꾸지 않음) */
  static readStatus(body: unknown): ESignVendorStatus {
    const map = { ...DEFAULT_STATE_MAP, ...envJson<Record<string, string>>('ESIGN_STATE_MAP', {}).value };
    const raw = String(getPath(body, process.env.ESIGN_RESULT_STATE_PATH?.trim() || 'status') ?? '').trim().toUpperCase();
    const state = map[raw];
    if (!state || !VENDOR_STATES.has(state)) return { ok: false, errorKind: 'BAD_RESPONSE', error: `모르는 상태 ${raw.slice(0, 40) || '(없음)'}` };
    const signers: Array<{ role: ESignRole; signedAt: string }> = [];
    const list = getPath(body, process.env.ESIGN_RESULT_SIGNERS_PATH?.trim() || 'signers');
    if (Array.isArray(list)) for (const x of list) {
      const role = String(x?.externalId ?? x?.role ?? '').toUpperCase();
      const at = x?.signedAt ?? x?.signed_at;
      if ((role === 'BUYER' || role === 'SELLER') && at && !Number.isNaN(Date.parse(String(at)))) signers.push({ role, signedAt: new Date(String(at)).toISOString() });
    }
    const h = getPath(body, process.env.ESIGN_RESULT_HASH_PATH?.trim() || 'documentHash');
    return { ok: true, state: state as ESignVendorStatus['state'], signers, docHash: h ? String(h).toLowerCase() : null };
  }

  async cancel(docId: string): Promise<{ ok: boolean; errorKind?: ESignErrorKind; error?: string }> {
    if (HttpESign.missing().length) return { ok: false, errorKind: 'NOT_CONFIGURED', error: '설정 없음' };
    const r = await httpJson({ url: this.url('CANCEL', docId), method: 'POST', headers: this.headers(), timeoutMs: this.timeout(), fetchFn: this.fetchFn, body: {} });
    return r.ok ? { ok: true } : { ok: false, errorKind: r.errorKind, error: r.error };
  }
}

/**
 * STUB 방식(esign.provider = STUB)의 옛 요청 · 조회 — 늘 스텁.
 *
 * v10.143 — 키만 있으면 「실제」로 가던 것을 없앰(빈 주소로 요청이 나가 실패만 쌓임).
 *   실제 업체는 방식을 HTTP 로 바꿔야만 씀(EsignService · HttpESign) — 본인인증 v10.141 과 같은 규칙.
 */
export function resolveESignProvider(): ESignProvider {
  return new StubESign();
}
