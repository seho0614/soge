import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { maskMail } from '../../common/mail/mail-admin.service';

/* ---------------------------------------------------------------------
 * v10.339 (D229 · docs/472) — 운영 화면 관 관리 › 「업무 안내」(SB-ADM-SIT-110)
 *
 *   대표 11/17 「업무별 워크 플로우 작성」 → 흐름표 → 「다음개발」 ④ 업무 흐름표를 운영 화면에.
 *   운영 역할 모두  GET  /admin/ops-guides          업무마다 가장 높은 판(단계 · 그 화면 탭 · 누가 · 알아 둘 것)
 *   SUPER          POST /admin/ops-guides/:code    새 판(고치기 · 지우기 없음 — 판을 쌓음 · 감사 OPS_GUIDE_SAVE)
 *   운영 역할 모두  GET  /admin/ops-guides/:code/versions   v10.351 (docs/485) 지난 판 모두(되돌리기는 옛 글을 POST 로 새 판)
 * ------------------------------------------------------------------- */

const TAB_RE = /^[a-z][a-z0-9-]{1,30}(\/[a-z0-9-]{1,30})?$/;

export class OpsGuideStepDto {
  @ApiProperty({ example: '상태 단추 「답변 전」부터 엽니다.', description: '단계 글(2 ~ 200자)' }) @IsString() @MaxLength(400) t!: string;
  @ApiPropertyOptional({ example: 'inquiries', description: '운영 화면 탭(예 inquiries · mainops/gwan) — 「이 화면」 단추' }) @IsOptional() @IsString() @MaxLength(62) go?: string;
}
export class OpsGuideSaveDto {
  @ApiProperty({ example: '1:1 문의 답변', description: '업무 이름(2 ~ 60자)' }) @IsString() @MaxLength(120) title!: string;
  @ApiProperty({ example: 'ADMIN', description: '할 수 있는 최소 권한(2 ~ 40자)' }) @IsString() @MaxLength(80) who!: string;
  @ApiProperty({ type: OpsGuideStepDto, isArray: true, description: '단계 1 ~ 15개' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(15) @ValidateNested({ each: true }) @Type(() => OpsGuideStepDto) steps!: OpsGuideStepDto[];
  @ApiPropertyOptional({ description: '알아 둘 것(500자 · 비우면 없음)' }) @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class OpsGuideSaveResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() code!: string;
  @ApiProperty() version!: number;
  @ApiProperty() note!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/ops-guides')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class OpsGuideController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @Roles('REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF')
  @ApiOperation({ summary: '업무 안내 — 업무마다 가장 높은 판 (v10.339)', description: '순서대로 · 단계(t 글 · go 운영 화면 탭) · 누가 · 알아 둘 것 · 판 번호 · 고친 사람(가린 메일).' })
  @ApiOkResponse({ type: Object })
  async list() {
    const rows = await this.db.query<Record<string, unknown> & { by: string | null }>(
      `SELECT g.code, g.version, g.title, g.who, g.steps, g.note, g.created_at AS "updatedAt", a.email::text AS by,
              (SELECT count(*)::int FROM ops_guides h WHERE h.code = g.code) AS versions
         FROM v_ops_guide_current g LEFT JOIN accounts a ON a.id = g.created_by
        WHERE g.is_active ORDER BY g.sort_order, g.code`);
    const [s] = await this.db.query<{ sup: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM account_roles WHERE account_id = $1::uuid AND role = 'SUPER') AS sup`, [RequestCtx.actorId() ?? null]);
    return { rows: rows.map((r) => ({ ...r, by: maskMail(r.by) })), canEdit: !!s?.sup };
  }

  @Get(':code/versions')
  @Roles('REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF')
  @ApiParam({ name: 'code', example: 'INQUIRY_ANSWER' })
  @ApiOperation({ summary: '업무 안내 — 지난 판 모두 (v10.351)', description: '높은 판부터 · 글 · 단계 · 알아 둘 것 · 때 · 고친 사람(가린 메일). 되돌리기는 옛 글을 POST /admin/ops-guides/{code} 로 새 판(SUPER).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 그 업무가 없음' })
  async versions(@Param('code') code: string) {
    const rows = await this.db.query<Record<string, unknown> & { by: string | null }>(
      `SELECT g.version, g.title, g.who, g.steps, g.note, g.created_at AS "createdAt", a.email::text AS by
         FROM ops_guides g LEFT JOIN accounts a ON a.id = g.created_by
        WHERE g.code = $1 ORDER BY g.version DESC LIMIT 50`, [String(code ?? '').trim()]);
    if (!rows.length) throw new NotFound('그 업무 안내가 없습니다.');
    return { code, rows: rows.map((r) => ({ ...r, by: maskMail(r.by) })) };
  }

  @Post(':code')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('OPS_GUIDE_SAVE', 'OPS_GUIDE')
  @ApiParam({ name: 'code', example: 'INQUIRY_ANSWER', description: '업무 코드(대문자 · _ · 3 ~ 30자) — 없는 코드면 새 업무' })
  @ApiOperation({ summary: '업무 안내 — 새 판 저장 (SUPER)', description: '고치기 · 지우기 없이 판을 하나 더합니다(가장 높은 판이 화면에 나옴). 단계의 go 는 운영 화면 탭 이름.' })
  @ApiOkResponse({ type: OpsGuideSaveResultDto })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPS_GUIDE_CODE · OPS_GUIDE_TITLE · OPS_GUIDE_WHO · OPS_GUIDE_STEP · OPS_GUIDE_TAB · OPS_GUIDE_NOTE' })
  async save(@Param('code') code: string, @Body() dto: OpsGuideSaveDto) {
    const c = String(code ?? '').trim();
    if (!/^[A-Z][A-Z_]{2,29}$/.test(c)) throw new PolicyViolation('OPS_GUIDE_CODE', '업무 코드는 대문자 · _ 3 ~ 30자입니다(예: INQUIRY_ANSWER).');
    const title = dto.title.trim(), who = dto.who.trim(), note = (dto.note ?? '').trim();
    if (title.length < 2 || title.length > 60) throw new PolicyViolation('OPS_GUIDE_TITLE', '업무 이름은 2 ~ 60자입니다.');
    if (who.length < 2 || who.length > 40) throw new PolicyViolation('OPS_GUIDE_WHO', '「누가」는 2 ~ 40자입니다.');
    if (note.length > 500) throw new PolicyViolation('OPS_GUIDE_NOTE', '알아 둘 것은 500자까지입니다.');
    const steps = dto.steps.map((s) => ({ t: s.t.trim(), go: (s.go ?? '').trim() }));
    if (steps.some((s) => s.t.length < 2 || s.t.length > 200)) throw new PolicyViolation('OPS_GUIDE_STEP', '단계 글은 2 ~ 200자입니다.');
    if (steps.some((s) => s.go && !TAB_RE.test(s.go))) throw new PolicyViolation('OPS_GUIDE_TAB', '「이 화면」은 운영 화면 탭 이름입니다(예: inquiries · mainops/gwan).');
    const json = JSON.stringify(steps.map((s) => (s.go ? { t: s.t, go: s.go } : { t: s.t })));
    const [r] = await this.db.query<{ version: number }>(
      `INSERT INTO ops_guides (code, version, title, who, steps, note, sort_order, created_by)
       SELECT $1, coalesce(max(version), 0) + 1, $2, $3, $4::jsonb, nullif($5, ''),
              coalesce((SELECT sort_order FROM v_ops_guide_current WHERE code = $1), (SELECT coalesce(max(sort_order), 0) + 10 FROM ops_guides)), $6
         FROM ops_guides WHERE code = $1
       RETURNING version`, [c, title, who, json, note, RequestCtx.actorId() ?? null]);
    return { ok: true, code: c, version: r!.version, note: `「${title}」 ${r!.version}판을 저장했습니다(지난 판은 그대로 남음).` };
  }
}
