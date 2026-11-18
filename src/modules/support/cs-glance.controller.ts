import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { DatabaseService } from '../../db/database.service';
import { csWeeklyStats, csWeeklyText } from './cs-weekly';

/* ---------------------------------------------------------------------
 * v10.344 (docs/478) — 운영 화면 첫 화면 「고객센터 한눈에」 카드(SB-ADM-DSH-010)
 *
 *   대표 11/18 「다음개발」 → ① 고객센터 한눈에. 1:1 문의 · 못 찾은 낱말 · 리드관을 한 장으로(읽기만).
 *   ADMIN · SUPER  GET /admin/cs-glance
 *   ADMIN · SUPER  GET /admin/cs-glance/weekly   v10.352 (D234 · docs/486) 고객센터 주간 보고 미리 보기(월요일 09:10 에 보내는 글과 같음)
 *   숫자만 내보냅니다(문의 본문 · 연락처 없음). 낱말은 사람 정보를 걸러 쌓은 것(v10.336).
 * ------------------------------------------------------------------- */

export class CsGlanceMissDto {
  @ApiProperty() word!: string;
  @ApiProperty({ description: '최근 30일 횟수' }) hits30!: number;
}
export class CsGlanceLeadDto {
  @ApiProperty({ description: '리드관(LED) 켜짐' }) active!: boolean;
  @ApiProperty({ description: '최근 24시간 휴대폰 확인을 마친 신청' }) requests24h!: number;
  @ApiProperty({ description: '최근 24시간 받을 업체가 없어 전달 못 함' }) noPartner24h!: number;
  @ApiProperty({ description: '공개 업종인데 받을 인증 업체 0곳' }) emptyCategories!: number;
}
export class CsGlanceDto {
  @ApiProperty({ description: '답변 전 문의' }) open!: number;
  @ApiProperty({ description: '답변 전 · 기한 넘김' }) overdue!: number;
  @ApiProperty({ description: '회원이 「아직 해결 안 됨」으로 다시 연 문의(답변 전)' }) reopened!: number;
  @ApiProperty({ description: '최근 30일 해결됨' }) resolved30!: number;
  @ApiProperty({ description: '최근 30일 아직 해결 안 됨' }) unresolved30!: number;
  @ApiProperty({ nullable: true, description: '최근 30일 해결률(%) · 고른 사람이 없으면 null' }) resolvedRate30!: number | null;
  @ApiProperty({ type: CsGlanceMissDto, isArray: true, description: '못 찾은 낱말 상위 3(다룸 뒤 다시 찾은 것만)' }) misses!: CsGlanceMissDto[];
  @ApiProperty({ type: CsGlanceLeadDto }) lead!: CsGlanceLeadDto;
}

export class CsWeeklyDto {
  @ApiProperty({ description: '보내는 글(텔레그램 · 슬랙 · 운영자 게시판과 같음)' }) text!: string;
  @ApiProperty({ description: '숫자(지난주 월 ~ 일 · 한국)' }) stats!: Record<string, unknown>;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/cs-glance')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class CsGlanceController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '고객센터 한눈에 (v10.344)', description: '1:1 문의 답변 전 · 기한 넘김 · 다시 열림 · 최근 30일 해결률 · 못 찾은 낱말 상위 3 · 리드관 켜짐 · 24시간 신청 · 받을 업체 없음 · 받을 업체 0곳 업종. 읽기만.' })
  @ApiOkResponse({ type: CsGlanceDto })
  async glance(): Promise<CsGlanceDto> {
    const [q] = await this.db.query<{ open: number; overdue: number; reopened: number; resolved30: number; unresolved30: number }>(
      `SELECT count(*) FILTER (WHERE status = 'OPEN')::int AS open,
              count(*) FILTER (WHERE status = 'OPEN' AND due_at < now())::int AS overdue,
              count(*) FILTER (WHERE status = 'OPEN' AND feedback = 'UNRESOLVED')::int AS reopened,
              count(*) FILTER (WHERE feedback = 'RESOLVED' AND feedback_at > now() - interval '30 days')::int AS resolved30,
              count(*) FILTER (WHERE feedback = 'UNRESOLVED' AND feedback_at > now() - interval '30 days')::int AS unresolved30
         FROM inquiries`);
    const misses = await this.db.query<CsGlanceMissDto>(
      `SELECT m.word, sum(m.hits)::int AS hits30
         FROM faq_search_misses m LEFT JOIN faq_search_miss_done d ON d.word = m.word
        WHERE m.day > (now() AT TIME ZONE 'Asia/Seoul')::date - 30
          AND (d.word IS NULL OR m.day > (d.done_at AT TIME ZONE 'Asia/Seoul')::date)
        GROUP BY m.word ORDER BY sum(m.hits) DESC, max(m.day) DESC, m.word LIMIT 3`);
    const [l] = await this.db.query<CsGlanceLeadDto>(
      `SELECT coalesce((SELECT is_active FROM gwans WHERE code = 'LED'), false) AS active,
              (SELECT count(*)::int FROM consult_requests r JOIN categories c ON c.id = r.category_id
                WHERE c.gwan_code = 'MAL' AND c.axis = 'CONSULT' AND r.verified_at IS NOT NULL AND r.created_at > now() - interval '24 hours') AS "requests24h",
              (SELECT count(*)::int FROM consult_requests r JOIN categories c ON c.id = r.category_id
                WHERE c.gwan_code = 'MAL' AND c.axis = 'CONSULT' AND r.state = 'NO_PARTNER' AND r.created_at > now() - interval '24 hours') AS "noPartner24h",
              (SELECT count(*)::int FROM categories c
                WHERE c.gwan_code = 'MAL' AND c.axis = 'CONSULT' AND c.status = 'APPROVED' AND c.consult_mode IS DISTINCT FROM 'LISTING_FEE'
                  AND NOT EXISTS (SELECT 1 FROM v_consult_eligible_partner e WHERE e.category_id = c.id)) AS "emptyCategories"`);
    const r = Number(q?.resolved30 ?? 0), u = Number(q?.unresolved30 ?? 0);
    return {
      open: Number(q?.open ?? 0), overdue: Number(q?.overdue ?? 0), reopened: Number(q?.reopened ?? 0),
      resolved30: r, unresolved30: u, resolvedRate30: r + u ? Math.round((r / (r + u)) * 1000) / 10 : null,
      misses,
      lead: { active: !!l?.active, requests24h: Number(l?.requests24h ?? 0), noPartner24h: Number(l?.noPartner24h ?? 0), emptyCategories: Number(l?.emptyCategories ?? 0) },
    };
  }

  @Get('weekly')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '고객센터 주간 보고 미리 보기 (v10.352)', description: '지난주(월 ~ 일 · 한국) 1:1 문의 접수 · 답함 · 처음 답까지 · 기한 안 · 해결률 · 문의 전 해결 · 못 찾은 낱말 5 · 리드관 · 지금 답변 전. 월요일 09:10 정기 작업 cs_weekly 가 보내는 글과 같음. 읽기만.' })
  @ApiOkResponse({ type: CsWeeklyDto })
  async weekly(): Promise<CsWeeklyDto> {
    const stats = await csWeeklyStats(this.db);
    return { text: csWeeklyText(stats), stats: stats as unknown as Record<string, unknown> };
  }
}
