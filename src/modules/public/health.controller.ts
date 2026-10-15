import { Controller, Get, HttpCode } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../../db/database.service';

export class HealthDto {
  @ApiProperty({ enum: ['ok', 'degraded'] }) status!: 'ok' | 'degraded';
  @ApiProperty() db!: boolean;
  @ApiProperty({ format: 'date-time' }) time!: string;
}

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
  @ApiOperation({ summary: '헬스체크', description: 'DB 연결까지 확인합니다. 실패 시 status=degraded.' })
  @ApiOkResponse({ type: HealthDto })
  async check(): Promise<HealthDto> {
    const db = await this.db.healthy();
    return { status: db ? 'ok' : 'degraded', db, time: new Date().toISOString() };
  }
}
