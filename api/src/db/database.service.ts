import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, types } from 'pg';

/* NUMERIC · INT8 을 number 로(금액은 원 단위 정수 · MAX_SAFE_INTEGER 안 — 소개뱅크 database.service 와 같은 규칙) */
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
types.setTypeParser(types.builtins.INT8, (v) => (v === null ? null : Number(v)));

/**
 * e1.1 (docs/001) ERP DB 접근층 — 데이터베이스 sgb_erp(같은 RDS 안 · 소개뱅크 sgb 와 다름).
 *   연결 문자열 DATABASE_URL(ERP 서버 .env) · 풀 10 · 문장 15초 제한.
 *   트랜잭션 · 소개뱅크 자료 읽기(svc 스키마)는 E2 에서.
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
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }

  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.pool.query(sql, params as any[]);
    return r.rows as T[];
  }
}
