import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';

/**
 * 요청 단위 컨텍스트.
 *
 * 트랜잭션 클라이언트를 여기 담는 이유: 리포지토리마다 tx 를 인자로 넘기면
 * 한 곳만 빠뜨려도 그 쿼리는 트랜잭션 밖에서 실행됩니다.
 * 정산에서 이런 누락은 조용히 지나가고 나중에 잔액으로 드러납니다.
 */
/**
 * 요청을 처리하다 건드린 **외부 작업**의 표시 (v10.18 · D022).
 *
 * 중복 요청 기록(idempotency)이 실패를 둘로 나누는 데 씁니다.
 *   DECLINED   결제사가 거절함 — 돈이 움직이지 않은 것이 확정. 같은 키로 다시 해도 됩니다
 *   UNCERTAIN  결제사에 요청은 보냈는데 답을 받지 못함(지연 · 연결 끊김 · 서버 종료) — 승인됐을 수도 있습니다
 *   APPROVED   결제사가 승인함 — 이 뒤에 우리 쪽 저장이 실패하면 「돈은 나갔는데 기록이 없는」 상태입니다
 * UNCERTAIN · APPROVED 인 채로 요청이 실패하면 기록을 「결과 불명확」으로 남기고, 다시 올 때 결제 결과부터 대조합니다.
 */
export interface ExternalMarks {
  payment?: { state: 'UNCERTAIN' | 'APPROVED' | 'DECLINED'; paymentKey?: string; orderId?: string; amount?: number };
}

export interface RequestContext {
  requestId: string;
  actorId?: string;
  actorRole?: string;
  ip?: string;
  /** v10.48 — 접속자 IP. Nginx 가 X-Forwarded-For 를 $remote_addr 로 덮어쓰므로 그 첫 값, 없으면 바로 앞 연결(req.ip) */
  clientIp?: string;
  userAgent?: string;
  /** 트랜잭션 진행 중이면 전용 커넥션. 없으면 풀에서 꺼내 씀 */
  tx?: PoolClient;
  /** 외부 작업 표시. 트랜잭션 안팎에서 같은 물건을 봐야 하므로 **값이 아니라 그릇**을 넘깁니다(withTx 가 복사해도 같은 그릇) */
  ext?: ExternalMarks;
  /** v10.103 — 사용자 웹이 알려 준 화면 언어(X-Lang · 한국어가 아닐 때만). 켜짐 · 켜진 언어인지는 I18nService.overlay 가 봅니다 */
  lang?: string;
}

const als = new AsyncLocalStorage<RequestContext>();

export const RequestCtx = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return als.run(ctx, fn);
  },
  get(): RequestContext | undefined {
    return als.getStore();
  },
  /** 트랜잭션 커넥션을 현재 컨텍스트에 부착 */
  withTx<T>(tx: PoolClient, fn: () => Promise<T>): Promise<T> {
    const cur = als.getStore();
    return als.run({ ...(cur ?? { requestId: 'internal' }), tx }, fn);
  },
  actorId(): string | undefined {
    return als.getStore()?.actorId;
  },
  /** v10.103 — 화면 언어(한국어면 undefined) */
  lang(): string | undefined {
    return als.getStore()?.lang;
  },
  /** 외부 결제 표시를 남깁니다. 표시 그릇이 없는 요청(중복 요청 장치 밖)에서는 아무 일도 하지 않습니다 */
  markPayment(m: NonNullable<ExternalMarks['payment']>): void {
    const ext = als.getStore()?.ext;
    if (ext) ext.payment = { ...(ext.payment ?? {}), ...m };
  },
};
