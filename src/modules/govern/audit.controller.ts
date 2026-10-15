import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { ReviewSignalDto } from './audit.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/**
 * 감사 — 징후를 보고 판단을 남깁니다.
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────
 * 감시 뷰가 8종 있지만 **보려면 터미널을 열어야** 했습니다.
 * 운영이 직접 봐야 밤중에 일이 생겨도 대응합니다.
 *
 * ── ★ 확인 기록이 핵심입니다 ──────────────────────────────────
 * 징후가 떠도 **누가 보고 어떻게 판단했는지** 남지 않으면
 * 나중에 "왜 그냥 넘어갔느냐" 에 답할 수 없습니다.
 */
@ApiTags('AUDIT')
@ApiBearerAuth()
@Controller('api/v1/admin/audit')
export class AuditController {
  constructor(private readonly svc: AuditService) {}

  @Get('signals')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '감사 징후',
    description:
      '감시 뷰를 한 번에 훑습니다. **0이 아니라고 곧바로 유출은 아닙니다** — ' +
      '무엇을 보았는지 확인한 뒤 판단하십시오.',
  })
  signals() { return this.svc.signals(); }

  /* v10.32 — 시안 SB-ADM-AUD-010 「감시 항목」 임계 칸 · 「보관」 표(읽기 전용) */
  @Get('policy')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '감사 보관 · 임계 (v10.32 · 읽기 전용)',
    description: '감사 기록 보관 일수(audit.retention_days) · 확인 기한(audit.review_sla_hours) · 징후별 임계(audit_thresholds).',
  })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    retentionDays: { type: 'integer', nullable: true, example: 1095 },
    reviewSlaHours: { type: 'integer', nullable: true, example: 48 },
    thresholds: { type: 'array', items: { type: 'object', properties: {
      code: { type: 'string' }, label: { type: 'string' }, threshold: { type: 'integer' }, windowHrs: { type: 'integer' },
      note: { type: 'string', nullable: true }, active: { type: 'boolean' } } } } } } })
  policy() { return this.svc.policy(); }

  @Get('logs')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '감사 기록',
    description: '누가 무엇을 언제 했는지. 기간과 행위로 좁혀 보십시오.',
  })
  logs(@Query('action') action?: string, @Query('days') days?: number, @Query('kind') kind?: string) {
    return this.svc.logs(action, days, kind);
  }

  @Get('reviews')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '확인 기록', description: '지금까지의 판단 내역.' })
  reviews() { return this.svc.reviews(); }

  @Post('reviews')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '징후 확인',
    description:
      '**판단 사유를 반드시 적으십시오.** "확인함" 만 남으면 확인 안 한 것과 ' +
      '같습니다. 조치하셨다면 무엇을 했는지도 적으십시오.',
  })
  @Audit('AUDIT_REVIEW', 'AUDIT')
  review(@Body() dto: ReviewSignalDto) { return this.svc.review(dto); }
}
