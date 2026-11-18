import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { DatabaseService } from '../../db/database.service';
import { maskMail } from '../../common/mail/mail-admin.service';
import { OPS_ROLES } from '../identity/mfa.service';
import { auditChainCheck, auditChainState, securityMonthlyStats, securityMonthlyText, staffActivity } from './security-report';

/* ---------------------------------------------------------------------
 * v10.354 · 355 · 356 (D235 · docs/488 ~ 490) — 위험감지 › 「감사」 · 「운영자 권한」
 *
 *   ADMIN·SUPER  GET  /admin/security/audit-chain          감사 기록 사슬 — 마지막 확인 · 사슬 줄 · 사슬 전 줄 · 24시간 확인 수 · 30일 끊김
 *   SUPER        POST /admin/security/audit-chain/check    지금 확인(정기 작업 sla_alert 가 매시간 하는 것과 같음 · 감사 AUDIT_CHAIN_CHECK)
 *   SUPER        GET  /admin/security/monthly              월간 보안 보고 미리 보기(지난달 · 정기 작업 security_monthly 가 보내는 글)
 *   SUPER        GET  /admin/security/staff-activity?days= 운영자 활동 요약(7 ~ 90 · 처음 30) · 90일 쉼이면 「거둘 후보」
 * ------------------------------------------------------------------- */

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/security')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class SecurityReportController {
  constructor(private readonly db: DatabaseService) {}

  @Get('audit-chain')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '감사 기록 위변조 확인 상태 (v10.356)', description: '마지막 확인(때 · 온전 · 확인한 줄 · 끊긴 줄 · 까닭) · 사슬에 든 줄 · D235 전 줄 · 24시간 확인 수 · 30일 끊김 수. 읽기만.' })
  @ApiOkResponse({ type: Object })
  chain() { return auditChainState(this.db); }

  @Post('audit-chain/check')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('AUDIT_CHAIN_CHECK', 'SETTING')
  @ApiOperation({ summary: '감사 기록 사슬 지금 확인 (v10.356 · SUPER)', description: '마지막으로 온전했던 지점부터 다시 계산. 결과를 확인 기록에 한 줄(정기 작업과 같음). 끊겼으면 정기 작업이 급한 알림 AUDIT_CHAIN_BROKEN.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: '쓰지 않음(문서 규칙)', type: ErrorDto })
  @ApiResponse({ status: 422, description: '쓰지 않음(문서 규칙)', type: ErrorDto })
  check() { return auditChainCheck(this.db); }

  @Get('monthly')
  @Roles('SUPER')
  @ApiOperation({ summary: '월간 보안 보고 미리 보기 (v10.354 · SUPER)', description: '지난달(한국) 권한 주기 · 거두기 · 설정 바뀜 · 개인정보 열람 · 낯선 로그인 · 접속 인증 · 막힌 접속(7일) · 급한 알림 · 감사 기록 사슬. 매일 09:20 정기 작업 security_monthly 가 지난달 보고를 아직 안 보냈으면 같은 글을 보냄.' })
  @ApiOkResponse({ type: Object })
  async monthly() {
    const stats = await securityMonthlyStats(this.db);
    return { text: securityMonthlyText(stats), stats };
  }

  @Get('staff-activity')
  @Roles('SUPER')
  @ApiQuery({ name: 'days', required: false, description: '7 ~ 90 · 처음 30' })
  @ApiOperation({ summary: '운영자 활동 요약 (v10.355 · SUPER)', description: '운영 역할이 있는 사람마다 역할 · 마지막 로그인 · 최근 days 일 한 일(감사 기록 수 · 묶음 4) · 개인정보 열람 수 · 90일 동안 로그인도 일도 없으면 idle90(거둘 후보). 거두기는 회원 상세 「권한 주기 · 거두기」에서 사람이.' })
  @ApiOkResponse({ type: Object })
  async activity(@Query('days') daysIn?: string) {
    const days = Math.max(7, Math.min(90, Math.floor(Number(daysIn) || 30)));
    const rows = await staffActivity(this.db, days, OPS_ROLES);
    return { days, rows: rows.map((r) => ({ ...r, email: maskMail(r.email) })), idle90: rows.filter((r) => r.idle90).length };
  }
}
