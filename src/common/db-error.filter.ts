import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { serverText } from './i18n/server-text';

/** v10.125 — 오류 글을 화면 언어로 옮길 때 그 언어가 켜져 있는지 묻는 곳(I18nService.langIfActive) */
export type LangGate = { langIfActive(lang: string | null | undefined): Promise<string | null> };
const langOf = (req: Request): string | undefined => {
  const h = String(req.headers['x-lang'] ?? '').trim().toLowerCase();
  const v = /^[a-z]{2}$/.test(h) ? h : /(?:^|;\s*)sgb_lang=([a-z]{2})(?:;|$)/.exec(String(req.headers.cookie ?? ''))?.[1];
  return v && v !== 'ko' ? v : undefined;
};

/**
 * DB 계층이 불변식을 강제하므로, 트리거·CHECK 예외를 그대로 500으로 흘리면
 * 프런트가 재시도 여부를 판단할 수 없습니다. 여기서 의미 있는 상태코드로 바꿉니다.
 *
 *  422 정책 위반 (요청 형식은 맞지만 규칙이 막음)
 *  409 상태 충돌 (이미 확정된 건을 또 확정 등)
 *  400 형식 오류
 */
type Mapped = { status: number; code: string; message: string };

const RULES: Array<{ test: RegExp; map: (m: RegExpMatchArray) => Mapped }> = [
  /* ── 트리거가 던지는 사유를 그대로 전합니다 ──────────────────────
   *
   * ★ 전에는 접두어를 **하나씩 등록**해야 했고, 빠뜨리면
   *   "처리 중 오류가 발생했습니다" 만 보였습니다. 트리거는 정확히
   *   막는데 왜 안 되는지 이용자가 모릅니다 — 그러면 같은 시도를
   *   반복하고 결국 고객센터로 옵니다.
   *
   *   실제로 59종 중 37종이 등록돼 있지 않았습니다.
   *
   * ── 그래서 규칙 하나로 받습니다 ─────────────────────────────────
   *   `RAISE EXCEPTION 'XXX: 사람이 읽을 사유'` 형태면 전부 전달됩니다.
   *   **새 접두어를 만들 때 여기를 고칠 필요가 없습니다** —
   *   고쳐야 하는 구조가 문제였습니다.
   *
   *   구체적인 규칙은 이 위에 두십시오. 먼저 걸립니다. */
  {
    test: /RESTRICTED_CATEGORY:\s*(.*)/,
    map: (m) => ({ status: 422, code: 'RESTRICTED_CATEGORY', message: m[1] }),
  },
  {
    test: /INV-(\d+) violated:\s*(.*)/,
    map: (m) => ({ status: 422, code: `INV_${m[1]}`, message: m[2] }),
  },
  {
    // 광고 · 성향 계층은 'INV-6: ...' 처럼 콜론 뒤에 사유를 씁니다.
    // 위의 'INV-N violated:' 형식과 달라 따로 잡습니다 —
    // 안 잡으면 규제 차단이 500 으로 나가고, 프런트는 재시도할지 알 수 없습니다.
    test: /^INV-(\d+):\s*(.*)/,
    map: (m) => ({ status: 422, code: `INV_${m[1]}`, message: m[2] }),
  },
  {
    test: /^RSK-(\d+):\s*(.*)/,
    map: (m) => ({ status: 422, code: `RSK_${m[1]}`, message: m[2] }),
  },
  {
    test: /^PRIVACY:\s*(.*)/,
    map: (m) => ({ status: 422, code: 'CONSENT_REQUIRED', message: m[1] }),
  },
  {
    test: /^AD:\s*(.*)/,
    map: (m) => ({ status: 409, code: 'IMMUTABLE_RECORD', message: m[1] }),
  },
  {
    // 설정 형식 위반. 500 으로 나가면 운영은 "시스템 오류"로 읽고
    // 자기가 넣은 값이 잘못됐다는 것을 모릅니다.
    test: /^SETTING:\s*(.*)/,
    map: (m) => ({ status: 422, code: 'INVALID_SETTING', message: m[1] }),
  },
  {
    test: /^BILLING:\s*(.*)/,
    map: (m) => ({ status: 422, code: 'BILLING_RULE', message: m[1] }),
  },
  {
    /* 매물 심사. 자격 없이 공개하려 하면 DB 가 막습니다.
     * 형식을 등록하지 않으면 500 으로 나가고 운영자는 이유를 모릅니다. */
    test: /^PROP:\s*(.*)/,
    map: (m) => ({ status: 422, code: 'PROPERTY_RULE', message: m[1] }),
  },
  {

    /* 메인 운영. 잠긴 구역을 끄거나 문구에 금칙어가 있으면 DB 가 막습니다.
     *
     * 형식을 등록하지 않으면 500 INTERNAL_ERROR 로 나가고,
     * 운영자는 **왜 막혔는지 알 수 없습니다.** */
    test: /^MAIN:\s*(.*)/,
    map: (m) => ({ status: 422, code: 'MAIN_RULE', message: m[1] }),
  },
  {

    test: /^PERM:\s*(.*)/,
    map: (m) => ({ status: 403, code: 'PERM', message: m[1] }),
  },
  {
    test: /^FEATURE_OFF:\s*(.*)/,
    map: (m) => ({ status: 422, code: 'FEATURE_OFF', message: m[1] }),
  },
  {
    test: /A-14:\s*(.*)/,
    map: (m) => ({ status: 422, code: 'LABOR_LAW_CHECK_REQUIRED', message: m[1] }),
  },
  {
    test: /B-21 violated:\s*(.*)/,
    map: (m) => ({ status: 422, code: 'PROMO_PLAN_FIXED', message: m[1] }),
  },
  {
    test: /view quota exceeded:\s*(.*)/,
    map: (m) => ({ status: 422, code: 'VIEW_QUOTA_EXCEEDED', message: m[1] }),
  },
  {
    test: /listing slot limit reached:\s*(.*)/,
    map: (m) => ({ status: 422, code: 'LISTING_SLOT_LIMIT', message: m[1] }),
  },
  {
    test: /append-only table:\s*(.*)/,
    map: () => ({
      status: 409,
      code: 'IMMUTABLE_RECORD',
      message: '이 기록은 수정하거나 삭제할 수 없습니다.',
    }),
  },
  {
    /* ★ CHECK 제약이 막은 것도 사람이 읽을 말로 바꿉니다.
     *   "violates check constraint" 만 보이면 이용자는 무엇을
     *   고쳐야 하는지 모릅니다. */
    test: /violates check constraint "payout_bank_code_check"/,
    map: () => ({ status: 422, code: 'BANK_CODE',
      message: '은행 코드는 숫자 세 자리입니다. 예) 004 국민은행' }),
  },
  {
    test: /violates check constraint "payout_account_no_check"/,
    map: () => ({ status: 422, code: 'ACCOUNT_NO',
      message: '계좌번호를 다시 확인해 주십시오. 숫자와 하이픈만 9~20자입니다.' }),
  },
  {
    test: /violates check constraint "payout_tries_check"/,
    map: () => ({ status: 422, code: 'TOO_MANY_TRIES',
      message: '다섯 번 틀려 막혔습니다 — 고객센터로 연락 주십시오.' }),
  },
  {
    /* 대문자 접두어 + 콜론 + 사유. DB 가 적은 말을 그대로 전합니다.
     * ★ 20261002 — 접두어 길이 상한 15 → 40. 15자를 넘는 접두어(LEAD_CATEGORY_CLOSED ·
     *   MAL_CONSULT_NOT_LISTING · CONSULT_DIRECTORY_ONLY 등)가 이 규칙을 빠져나가 500 으로
     *   나갔습니다 — 막기는 막는데 이유가 안 갔습니다. 점검기(check-errcodes)도 길이를 봅니다. */
    test: /^([A-Z][A-Z0-9_-]{1,39}):\s*(.+)/s,
    map: (m) => ({ status: 422, code: m[1].replace(/-/g, '_'), message: m[2].trim() }),
  },
  {
    test: /duplicate key value violates unique constraint/,
    map: () => ({ status: 409, code: 'DUPLICATE', message: '이미 존재하는 값입니다.' }),
  },
  /* ── 20260930 · 나머지 CHECK · NOT NULL · FK 도 500 으로 흘리지 않습니다 ──
   *
   * ★ 실측 — 동의어를 자기 자신으로 넣으면(syn_self_check) 500
   *   INTERNAL_ERROR 가 나갔습니다. 위에 등록된 CHECK 는 3종뿐이고,
   *   DB 에는 CHECK 제약이 수백 개 있습니다. 규칙은 DB 가 정확히 막는데
   *   화면은 "시스템 오류" 로 보입니다.
   *
   *   제약 이름을 코드로 함께 보내 프런트·운영이 원인을 찾을 수 있게 합니다. */
  {
    test: /violates check constraint "([^"]+)"/,
    map: (m) => ({ status: 422, code: 'CHECK_VIOLATION',
      message: `입력값이 규칙에 맞지 않습니다 (${m[1]}).` }),
  },
  {
    test: /null value in column "([^"]+)".*violates not-null constraint/s,
    map: (m) => ({ status: 422, code: 'REQUIRED',
      message: `필수 값이 빠졌습니다 (${m[1]}).` }),
  },
  {
    test: /violates foreign key constraint "([^"]+)"/,
    map: (m) => ({ status: 409, code: 'REFERENCE',
      message: `연결된 대상이 없거나 아직 쓰이고 있습니다 (${m[1]}).` }),
  },
  {
    test: /invalid input syntax for type (uuid|integer|numeric|date|timestamp)/,
    map: (m) => ({ status: 400, code: 'VALIDATION_ERROR',
      message: `형식이 올바르지 않습니다 (${m[1]}).` }),
  },
];

/**
 * Nest 내장 예외(ValidationPipe 400 · 라우트 없음 404 등)는 { statusCode, message, error } 꼴입니다.
 * 프런트는 { code, message, field? } 로 분기하므로 여기서 같은 모양으로 맞춥니다.
 * AppError 는 이미 그 모양이므로 그대로 통과합니다.
 */
function normalize(err: HttpException): unknown {
  const body = err.getResponse();
  if (typeof body === 'object' && body !== null && 'code' in body) return body;
  const b = (typeof body === 'object' && body !== null ? body : { message: String(body) }) as
    { message?: string | string[]; error?: string };
  const status = err.getStatus();
  const code = status === 400 ? 'VALIDATION_ERROR'
    : status === 404 ? 'NOT_FOUND'
    : status === 401 ? 'UNAUTHENTICATED'
    : (b.error ?? 'HTTP_ERROR').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const message = Array.isArray(b.message) ? b.message.join(' / ') : (b.message ?? '요청을 처리하지 못했습니다.');
  const field = Array.isArray(b.message) ? b.message[0]?.split(' ')[0] : undefined;
  return field ? { code, message, field } : { code, message };
}

@Catch()
export class DbErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DbErrorFilter.name);
  constructor(private readonly gate?: LangGate) {}

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    /* v10.125 (docs/189) — 사용자 웹 영어 화면이면 오류 글(message)을 사전으로(운영 화면 /admin · 한국어 · 다국어 꺼짐은 그대로) */
    const send = (status: number, body: any) => {
      const lang = this.gate && !/^\/api\/v1\/admin(\/|\?|$)/.test(req?.originalUrl ?? '') ? langOf(req) : undefined;
      if (!lang || !body || typeof body.message !== 'string') { res.status(status).json(body); return; }
      this.gate!.langIfActive(lang)
        .then((l) => (l ? { ...body, message: serverText(body.message, l) } : body), () => body)
        .then((b) => { if (!res.headersSent) res.status(status).json(b); })   // 응답 머리를 이미 보낸 다운로드 등에서 두 번 보내지 않음
        .catch((e) => this.logger.warn(`오류 응답을 보내지 못함: ${String(e?.message ?? e)}`));
    };

    if (err instanceof HttpException) {
      send(err.getStatus(), normalize(err));
      return;
    }

    const raw = err instanceof Error ? err.message : String(err);
    for (const rule of RULES) {
      const m = raw.match(rule.test);
      if (m) {
        const mapped = rule.map(m);
        send(mapped.status, {
          code: mapped.code,
          message: mapped.message.trim(),
        });
        return;
      }
    }

    this.logger.error(raw);
    send(500, { code: 'INTERNAL_ERROR', message: '처리 중 오류가 발생했습니다.' });
  }
}
