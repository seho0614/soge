import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { DatabaseService } from '../../db/database.service';
import { ConsultService } from './consult.service';

/* ---------------------------------------------------------------------
 * v10.338 (docs/471) — 운영 화면 파트너사 › 파트너 › 「리드 현황」(SB-ADM-PTN-100)
 *
 *   대표 11/17 「다음개발」 → ③ 리드관 운영 현황. 리드관(LED)을 켠 뒤 한 장으로 봅니다(읽기만).
 *   ADMIN · SUPER · PARTNER_MAL  GET /admin/lead-status?days=   관 상태 · 업종별 신청 · 전달 · 받을 업체 없음 · 반려 · 받을 업체 수
 *   업종은 안심소개 상담 축(MAL · CONSULT)의 리드 업종(정액 노출형 LISTING_FEE 뺌). 연락처 · 업체 이름은 내보내지 않습니다.
 * ------------------------------------------------------------------- */

export class LeadStatusHallDto {
  @ApiProperty({ description: '리드관(LED) 켜짐' }) active!: boolean;
  @ApiProperty({ example: 'off', description: '설정 lead.legal_ok' }) legalOk!: string;
  @ApiPropertyOptional({ nullable: true }) openedAt!: string | null;
  @ApiProperty({ description: '상담 신청을 받을 수 있는가(인증번호를 보낼 길)' }) notifyReady!: boolean;
}
export class LeadStatusRowDto {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: 'APPROVED' }) status!: string;
  @ApiProperty({ description: '받을 인증 업체 수' }) partners!: number;
  @ApiProperty({ description: '휴대폰 확인을 마친 신청' }) requests!: number;
  @ApiProperty() delivered!: number;
  @ApiProperty({ description: '받을 업체가 없어 전달 못 함' }) noPartner!: number;
  @ApiProperty({ description: '업체 반려 요청' }) rejects!: number;
  @ApiProperty({ description: '반려 인정' }) rejectsAccepted!: number;
  @ApiProperty({ description: '공개 업종인데 받을 업체 0곳' }) warn!: boolean;
}
export class LeadStatusDto {
  @ApiProperty({ example: 30 }) days!: number;
  @ApiProperty({ type: LeadStatusHallDto }) hall!: LeadStatusHallDto;
  @ApiProperty({ type: LeadStatusRowDto, isArray: true }) rows!: LeadStatusRowDto[];
  @ApiProperty({ description: '합계' }) total!: { requests: number; delivered: number; noPartner: number; rejects: number; rejectsAccepted: number };
  @ApiProperty({ description: '받을 업체 0곳 공개 업종 수' }) warnings!: number;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/lead-status')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class LeadStatusController {
  constructor(private readonly db: DatabaseService, private readonly consult: ConsultService) {}

  @Get()
  @Roles('ADMIN', 'SUPER', 'PARTNER_MAL')
  @ApiOperation({ summary: '리드 현황 (v10.338)', description: '리드관 켜짐 · lead.legal_ok · 신청 받을 수 있는가 · 상담 업종별 최근 days 일(7 ~ 90 · 처음 30) 신청 · 전달 · 받을 업체 없음 · 반려 · 받을 업체 수 · 받을 업체 0곳 경고. 읽기만.' })
  @ApiQuery({ name: 'days', required: false, description: '7 ~ 90 · 처음 30' })
  @ApiOkResponse({ type: LeadStatusDto })
  async status(@Query('days') daysIn?: string) {
    const days = Math.max(7, Math.min(90, Math.floor(Number(daysIn) || 30)));
    const [h] = await this.db.query<{ active: boolean; legalOk: string; openedAt: string | null }>(
      `SELECT coalesce((SELECT is_active FROM gwans WHERE code = 'LED'), false) AS active,
              coalesce((SELECT value FROM site_settings WHERE key = 'lead.legal_ok'), 'off') AS "legalOk",
              (SELECT opened_at FROM gwans WHERE code = 'LED') AS "openedAt"`);
    const ready = await this.consult.readiness().catch(() => ({ ready: false }));
    const rows = await this.db.query<LeadStatusRowDto>(
      `SELECT c.code, c.name, c.status,
              (SELECT count(DISTINCT e.partner_id)::int FROM v_consult_eligible_partner e WHERE e.category_id = c.id) AS partners,
              (SELECT count(*)::int FROM consult_requests r WHERE r.category_id = c.id AND r.verified_at IS NOT NULL AND r.created_at > now() - make_interval(days => $1)) AS requests,
              (SELECT count(*)::int FROM consult_requests r WHERE r.category_id = c.id AND r.state = 'DELIVERED' AND r.created_at > now() - make_interval(days => $1)) AS delivered,
              (SELECT count(*)::int FROM consult_requests r WHERE r.category_id = c.id AND r.state = 'NO_PARTNER' AND r.created_at > now() - make_interval(days => $1)) AS "noPartner",
              (SELECT count(*)::int FROM lead_fee_disputes x JOIN lead_fees f ON f.id = x.fee_id JOIN lead_deliveries d ON d.id = f.delivery_id JOIN leads l ON l.id = d.lead_id
                WHERE l.category_id = c.id AND x.created_at > now() - make_interval(days => $1)) AS rejects,
              (SELECT count(*)::int FROM lead_fee_disputes x JOIN lead_fees f ON f.id = x.fee_id JOIN lead_deliveries d ON d.id = f.delivery_id JOIN leads l ON l.id = d.lead_id
                WHERE l.category_id = c.id AND x.state = 'ACCEPTED' AND x.created_at > now() - make_interval(days => $1)) AS "rejectsAccepted"
         FROM categories c
        WHERE c.gwan_code = 'MAL' AND c.axis = 'CONSULT' AND c.status IN ('APPROVED', 'PENDING')
          AND c.consult_mode IS DISTINCT FROM 'LISTING_FEE'
        ORDER BY (c.status = 'APPROVED') DESC, c.name`, [days]);
    const out = rows.map((r) => ({ ...r, warn: r.status === 'APPROVED' && Number(r.partners) === 0 }));
    const sum = (k: 'requests' | 'delivered' | 'noPartner' | 'rejects' | 'rejectsAccepted') => out.reduce((a, r) => a + Number(r[k] || 0), 0);
    return {
      days,
      hall: { active: !!h?.active, legalOk: h?.legalOk ?? 'off', openedAt: h?.openedAt ?? null, notifyReady: !!ready.ready },
      rows: out,
      total: { requests: sum('requests'), delivered: sum('delivered'), noPartner: sum('noPartner'), rejects: sum('rejects'), rejectsAccepted: sum('rejectsAccepted') },
      warnings: out.filter((r) => r.warn).length,
    };
  }
}
