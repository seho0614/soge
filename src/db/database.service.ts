import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient, types } from 'pg';

/**
 * NUMERIC 을 number 로 받습니다.
 *
 * node-postgres 는 정밀도 손실을 막으려 NUMERIC 을 문자열로 줍니다.
 * 이 시스템의 금액은 원 단위 정수이고 Number.MAX_SAFE_INTEGER 안이므로
 * 손실이 없습니다. 문자열로 두면 API 응답 타입이 설계와 어긋나고,
 * 프런트가 매번 Number() 를 부르다 한 곳을 빠뜨립니다.
 *
 * ⚠ 소수점이 필요한 컬럼이 생기면 이 설정을 재검토하십시오.
 *    현재 numeric(5,2)·numeric(3,2) 는 요율·가중치이며 화면 표시용입니다.
 */
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
types.setTypeParser(types.builtins.INT8, (v) => (v === null ? null : Number(v)));
import { RequestCtx } from '../core/request-context';

/**
 * DB 접근층.
 *
 * 이전 구현은 단일 커넥션을 공유하며 BEGIN/COMMIT 을 걸었습니다.
 * 동시 요청에서 한쪽의 ROLLBACK 이 다른 쪽 작업까지 되돌립니다.
 * 여기서는 트랜잭션마다 전용 커넥션을 잡고, AsyncLocalStorage 로 전달합니다.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool!: Pool;

  onModuleInit() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      statement_timeout: 15_000,       // 느린 쿼리가 커넥션을 물고 있지 않도록
    });

    /* 암호화 열쇠를 커넥션마다 걸어 줍니다.
     *
     * ★ 여기가 비어 있어 고리가 끊겨 있었습니다.
     *   Secrets Manager 에서 ENC_KEY 를 읽어 와도, DB 세션에 걸지
     *   않으면 current_setting('app.enc_key') 가 NULL 입니다.
     *   그러면 정산 계좌 저장이 실패하고, 리드 연락처는 열리지 않습니다.
     *
     *   풀은 커넥션을 여러 개 만들고 재사용하므로 접속할 때마다 겁니다.
     *   SET LOCAL 이 아니라 SET 이어야 커넥션이 사는 동안 유지됩니다.
     */
    const encKey = process.env.ENC_KEY ?? '';
    if (encKey) {
      /* pg 는 'connect' 안에서 다시 query 를 부르면 경고를 냅니다.
       * options 로 붙이면 접속 문자열 단계에서 걸려 그 문제가 없습니다. */
      this.pool.options.options =
        `-c app.enc_key=${encKey.replace(/'/g, '')}`;
    }
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }

  /** 트랜잭션 중이면 그 커넥션, 아니면 풀. 호출자는 구분할 필요가 없습니다. */
  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const tx = RequestCtx.get()?.tx;
    const res = tx ? await tx.query(sql, params) : await this.pool.query(sql, params);
    return res.rows as T[];
  }

  /**
   * 트랜잭션 경계. 중첩 호출은 savepoint 없이 기존 트랜잭션에 합류합니다 —
   * 서비스가 서비스를 부를 때 안쪽에서 COMMIT 이 나가면 안 되기 때문입니다.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const existing = RequestCtx.get()?.tx;
    if (existing) return fn();

    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await RequestCtx.withTx(client, fn);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async healthy(): Promise<boolean> {
    try { await this.pool.query('SELECT 1'); return true; } catch { return false; }
  }
}

/**
 * append-only 테이블. 리포지토리에서 update/delete 메서드를 만들지 않습니다.
 * DB 가 막지만 컴파일 타임에 막는 편이 낫습니다.
 */
export const APPEND_ONLY_TABLES = [
  'attribution_events', 'fee_agreements', 'ledger_entries', 'term_agreements',
  'review_events', 'call_logs', 'visitor_identities',
  'audit.audit_logs', 'audit.pii_access_logs',
] as const;
