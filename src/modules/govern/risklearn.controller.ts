import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RiskLearnService } from './risklearn.service';
import { ExemptDto } from './risklearn.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/**
 * 위험감지 오탐 학습.
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────
 * 운영이 "이건 정상" 이라고 닫아도 **같은 것이 내일 또 뜹니다.**
 * 그러면 사람이 경보를 안 보게 되고, 진짜 위험이 묻힙니다.
 *
 * ── ★ 법이 정한 규칙은 학습하지 않습니다 ──────────────────────
 *   RSK-05  제한업종 (대부업법 · 방문판매법 · INV-6)
 *   RSK-07  광고 규제 (의료법 27조 · 표시광고법)
 *
 * 운영이 "정상" 이라고 해도 열 수 없습니다.
 */
@ApiTags('RISK-LEARN')
@ApiBearerAuth()
@Controller('api/v1/admin/risk')
export class RiskLearnController {
  constructor(private readonly svc: RiskLearnService) {}

  @Post('learn')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '오탐 학습',
    description:
      '"정상" 으로 닫힌 경보가 3회 쌓이면 예외로 둡니다. ' +
      '**예외에는 기한이 붙습니다** — 상황이 바뀔 수 있습니다.',
  })
  @Audit('RISK_LEARN', 'RISK')
  learn() { return this.svc.learn(); }

  @Get('exemptions')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '예외 목록',
    description: '무엇이 왜 예외인지. 기한이 지나면 다시 경보가 뜹니다.',
  })
  list() { return this.svc.list(); }

  @Post('exemptions')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '예외 직접 추가',
    description:
      '학습을 기다리지 않고 바로 예외로 둡니다. ' +
      '**왜 정상인지 반드시 적으십시오** — 나중에 "이게 왜 예외지" 에 ' +
      '답할 수 없습니다.',
  })
  @Audit('RISK_EXEMPT', 'RISK')
  add(@Body() dto: ExemptDto) { return this.svc.add(dto); }

  @Delete('exemptions/:id')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '예외 해제',
    description: '다시 경보가 뜨게 합니다. 지우지 않고 해제 기록을 남깁니다.',
  })
  @Audit('RISK_UNEXEMPT', 'RISK')
  revoke(@Param('id') id: string) { return this.svc.revoke(id); }
}
