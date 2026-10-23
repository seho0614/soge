import { readFileSync } from 'fs';
import { join } from 'path';
import { Controller, Get, HttpCode } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../../db/database.service';

export class HealthDto {
  @ApiProperty({ enum: ['ok', 'degraded'] }) status!: 'ok' | 'degraded';
  @ApiProperty() db!: boolean;
  @ApiProperty({ format: 'date-time' }) time!: string;
  @ApiProperty({ example: 'v10.85', description: '앱 판 번호(VERSION 파일) — 운영 적용 뒤 확인용 · 판 번호 하나만 · 없으면 「?」(v10.85)' }) version!: string;
}

/* v10.85 — 판 번호는 켜질 때 한 번 읽습니다(앱 폴더의 VERSION · 운영 ~/sgb · 개발 도커 /app) */
const VERSION = (() => {
  try { return readFileSync(join(process.cwd(), 'VERSION'), 'utf8').trim().slice(0, 20) || '?'; } catch { return '?'; }
})();

/**
 * ALB 헬스체크 · 배포 확인용. 인증 없음.
 * DB 가 죽어 있으면 503 — 트래픽을 받아도 전부 500 이 나가므로 태스크를 교체하는 편이 낫습니다.
 */
@ApiTags('OPS')
@Controller('api/v1/health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: '헬스체크', description: 'DB 연결까지 확인합니다. 실패 시 status=degraded. version = 앱 판 번호(v10.85).' })
  @ApiOkResponse({ type: HealthDto })
  async check(): Promise<HealthDto> {
    const db = await this.db.healthy();
    return { status: db ? 'ok' : 'degraded', db, time: new Date().toISOString(), version: VERSION };
  }
}
