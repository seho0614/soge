import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient, types } from 'pg';
import { RequestCtx } from '../core/request-context';

/* NUMERIC · INT8 을 number 로(금액은 원 단위 정수 · MAX_SAFE_INTEGER 안 — 소개뱅크 database.service 와 같은 규칙) */
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
types.setTypeParser(types.builtins.INT8, (v) => (v === null ? null : Number(v)));

/**
 * ERP DB 접근층 — 데이터베이스 sgb_erp(같은 RDS 안 · 소개뱅크 sgb 와 다름).
 *   e1.1 (docs/001) 풀 10 · 문장 15초 제한
 *   e3.1 (docs/010) 소개뱅크 src/db/database.service.ts 와 **같은 모양**(옮겨 온 회계 코드가 그대로 씀):
 *     query — 트랜잭션 중이면 그 연결(RequestCtx) · transaction — 중첩은 바깥에 합류 · healthy
 *     ENC_KEY 가 있으면 연결마다 app.enc_key(계좌 · 급여 파일 암호화 · 소개뱅크와 같은 키)
 *   소개뱅크 표는 svc.*(읽기 전용 외부 표 · tools/erp-svc.sh)
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool!: Pool;

  onModuleInit() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      statement_timeout: 15_000,
    });
    const encKey = process.env.ENC_KEY ?? '';
    if (encKey) this.pool.options.options = `-c app.enc_key=${encKey.replace(/'/g, '')}`;
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }

  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const tx = RequestCtx.get()?.tx;
    const res = tx ? await tx.query(sql, params as any[]) : await this.pool.query(sql, params as any[]);
    return res.rows as T[];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (RequestCtx.get()?.tx) return fn();
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
