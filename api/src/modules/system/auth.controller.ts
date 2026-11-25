import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { Public } from '../../core/auth';
import { Conflict, NotFound, Unavailable } from '../../core/errors';
import { SgbClient } from '../../core/sgb-client';
import { DatabaseService } from '../../db/database.service';

export class HandoffDto {
  @ApiProperty({ description: '운영 화면 「ERP 열기」가 준 60초 · 한 번 코드' }) @IsString() @Matches(/^[A-Za-z0-9_-]{30,60}$/) code!: string;
}

/* e1.2 (docs/002) 로그인 넘겨받기 · 내 정보 */
@ApiTags('auth')
@Controller('api/v1')
export class AuthController {
  constructor(private readonly sgb: SgbClient, private readonly db: DatabaseService) {}

  @Post('auth/handoff')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: '로그인 넘겨받기', description: 'e1.2 — 운영 화면 코드 → 소개뱅크 redeem → 그 운영자의 증표(화면은 sessionStorage 에만) · 감사 ERP_LOGIN' })
  @ApiOkResponse({ type: Object })
  async handoff(@Body() dto: HandoffDto, @Req() req: any) {
    const r = await this.sgb.redeem(dto.code);
    if (r.status === 404) throw NotFound('넘겨주기 코드가 없거나 이미 썼습니다 — 운영 화면에서 다시 「ERP 열기」를 누르십시오.');
    if (r.status === 409) throw Conflict('ERP_HANDOFF_EXPIRED', '넘겨주기 코드 시간(60초)이 지났습니다 — 운영 화면에서 다시 여십시오.');
    if (r.status !== 200 || !r.body.accessToken) throw Unavailable('ERP_SGB_DOWN', '소개뱅크에서 로그인을 넘겨받지 못했습니다.');
    await this.db.query(`INSERT INTO erp_audit (account_id, action, ip) VALUES ($1, 'ERP_LOGIN', $2)`,
      [r.body.accountId, String(req.ip ?? '').slice(0, 64) || null]).catch(() => undefined);
    return { accessToken: r.body.accessToken, refreshToken: r.body.refreshToken, accountId: r.body.accountId };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 정보', description: 'e1.2 — 이름 · 역할 · SUPER · 권한 판정 방식 · 업무 권한 목록(소개뱅크 introspect 그대로)' })
  @ApiOkResponse({ type: Object })
  me(@Req() req: any) { return req.erp; }
}
