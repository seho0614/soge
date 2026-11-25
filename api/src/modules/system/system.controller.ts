import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseService } from '../../db/database.service';
import { Public } from '../../core/auth';

/* e1.1 (docs/001) — 건강 확인(공개 · 점검판 · 운영 확인 줄이 부름). 비밀 값 · 설정 값은 내보내지 않음 */
const readVersion = () => {
  for (const p of [path.join(__dirname, '..', '..', '..', '..', 'VERSION'), path.join(process.cwd(), 'VERSION'), path.join(process.cwd(), '..', 'VERSION')]) {
    try { return fs.readFileSync(p, 'utf8').trim(); } catch { /* 다음 */ }
  }
  return 'unknown';
};
const VERSION = readVersion();

@ApiTags('system')
@Controller('api/v1')
export class SystemController {
  constructor(private readonly db: DatabaseService) {}

  @Get('health')
  @Public()
  @ApiOperation({ summary: 'ERP 건강 확인', description: 'e1.1 — DB(sgb_erp) 연결 · 판 · 마이그레이션 수 · 데이터베이스 이름' })
  @ApiOkResponse({ type: Object })
  async health() {
    let db = false, migrations = 0, database: string | null = null;
    try {
      const [r] = await this.db.query<{ d: string; n: number }>(
        `SELECT current_database() AS d, (SELECT count(*)::int FROM schema_migrations) AS n`);
      db = true; migrations = r?.n ?? 0; database = r?.d ?? null;
    } catch { db = false; }
    return { status: db ? 'ok' : 'degraded', service: 'sgb-erp', version: VERSION, db, database, migrations, time: new Date().toISOString() };
  }
}
