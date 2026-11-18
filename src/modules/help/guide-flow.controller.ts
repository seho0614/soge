import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { maskMail } from '../../common/mail/mail-admin.service';

/* ---------------------------------------------------------------------
 * v10.347 (D233 · docs/481) — 사용자 웹 이용 흐름(/guide/flows · SB-HOM-ETC-050)을 운영 화면에서 고치기
 *
 *   대표 11/18 「다음개발」 → ③. 관 관리 › 「이용 흐름」(SB-ADM-SIT-120).
 *   공개         GET  /guide/flows                  보이는 흐름마다 가장 높은 판(한 · 영 · 바로 가기)
 *   ADMIN·SUPER GET  /admin/guide-flows            숨긴 것 포함 · 판 수 · 고친 사람(가린 메일)
 *   SUPER       POST /admin/guide-flows/:code      새 판(고치기 · 지우기 없음 · 감사 GUIDE_FLOW_SAVE)
 *   ADMIN·SUPER GET  /admin/guide-flows/:code/versions   v10.351 (docs/485) 지난 판 모두(되돌리기는 옛 글을 POST 로 새 판)
 *   영어 칸이 비면 사용자 웹은 사전(policy.flows) 영어 글을 씁니다. 바로 가기는 사이트 안 주소(/ 로 시작)만.
 * ------------------------------------------------------------------- */

const HREF_RE = /^\/[A-Za-z0-9/_?=&.-]{0,120}$/;

export class GuideFlowDto {
  @ApiProperty({ example: 'join' }) code!: string;
  @ApiProperty() version!: number;
  @ApiProperty() titleKo!: string;
  @ApiProperty() whoKo!: string;
  @ApiProperty({ type: String, isArray: true }) stepsKo!: string[];
  @ApiPropertyOptional({ nullable: true }) titleEn!: string | null;
  @ApiPropertyOptional({ nullable: true }) whoEn!: string | null;
  @ApiPropertyOptional({ type: String, isArray: true, nullable: true }) stepsEn!: string[] | null;
  @ApiProperty({ example: '/signup' }) href!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isActive!: boolean;
}
export class GuideFlowListDto {
  @ApiProperty({ type: GuideFlowDto, isArray: true }) rows!: GuideFlowDto[];
}
export class GuideFlowSaveDto {
  @ApiProperty({ example: '가입하기', description: '제목(2 ~ 60자)' }) @IsString() @MaxLength(120) titleKo!: string;
  @ApiProperty({ example: '처음 오신 분', description: '누가(2 ~ 60자)' }) @IsString() @MaxLength(120) whoKo!: string;
  @ApiProperty({ type: String, isArray: true, description: '단계 1 ~ 10개(한 단계 2 ~ 200자)' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(400, { each: true }) stepsKo!: string[];
  @ApiPropertyOptional({ description: '영어 제목(비우면 사전 영어 글)' }) @IsOptional() @IsString() @MaxLength(200) titleEn?: string;
  @ApiPropertyOptional({ description: '영어 누가' }) @IsOptional() @IsString() @MaxLength(200) whoEn?: string;
  @ApiPropertyOptional({ type: String, isArray: true, description: '영어 단계(비우면 사전 영어 글 · 쓰면 한국어 단계 수와 같게)' })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(600, { each: true }) stepsEn?: string[];
  @ApiProperty({ example: '/signup', description: '「바로 가기」 주소(사이트 안 · / 로 시작)' }) @IsString() @MaxLength(200) href!: string;
  @ApiPropertyOptional({ description: 'false = 숨김(사용자 웹에서 빠짐)' }) @IsOptional() @IsBoolean() isActive?: boolean;
}
export class GuideFlowSaveResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() code!: string;
  @ApiProperty() version!: number;
  @ApiProperty() note!: string;
}

@ApiTags('HOM')
@Controller('api/v1/guide/flows')
export class GuideFlowPublicController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @ApiOperation({ summary: '이용 흐름 (v10.347 · 로그인 없이)', description: '보이는 흐름마다 가장 높은 판 · 순서대로. 영어 칸이 null 이면 사용자 웹은 사전 영어 글을 씁니다.' })
  @ApiOkResponse({ type: GuideFlowListDto })
  async list() {
    const rows = await this.db.query<GuideFlowDto>(`SELECT g.code, g.version, g.title_ko AS "titleKo", g.who_ko AS "whoKo", g.steps_ko AS "stepsKo",
                    g.title_en AS "titleEn", g.who_en AS "whoEn", g.steps_en AS "stepsEn", g.href, g.sort_order AS "sortOrder", g.is_active AS "isActive"
         FROM v_guide_flow_current g WHERE g.is_active ORDER BY g.sort_order, g.code`);
    return { rows };
  }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/guide-flows')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class GuideFlowAdminController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '이용 흐름 — 모두(숨긴 것 포함) (v10.347)', description: '흐름마다 가장 높은 판 · 판 수 · 고친 때 · 고친 사람(가린 메일) · 고칠 수 있는가(SUPER).' })
  @ApiOkResponse({ type: Object })
  async list() {
    const rows = await this.db.query<Record<string, unknown> & { by: string | null }>(
      `SELECT g.code, g.version, g.title_ko AS "titleKo", g.who_ko AS "whoKo", g.steps_ko AS "stepsKo",
                    g.title_en AS "titleEn", g.who_en AS "whoEn", g.steps_en AS "stepsEn", g.href, g.sort_order AS "sortOrder", g.is_active AS "isActive", g.created_at AS "updatedAt", a.email::text AS by, (SELECT count(*)::int FROM guide_flows h WHERE h.code = g.code) AS versions
         FROM v_guide_flow_current g LEFT JOIN accounts a ON a.id = g.created_by ORDER BY g.sort_order, g.code`);
    const [s] = await this.db.query<{ sup: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM account_roles WHERE account_id = $1::uuid AND role = 'SUPER') AS sup`, [RequestCtx.actorId() ?? null]);
    return { rows: rows.map((r) => ({ ...r, by: maskMail(r.by) })), canEdit: !!s?.sup };
  }

  @Get(':code/versions')
  @Roles('ADMIN', 'SUPER')
  @ApiParam({ name: 'code', example: 'join' })
  @ApiOperation({ summary: '이용 흐름 — 지난 판 모두 (v10.351)', description: '높은 판부터 · 한 · 영 글 · 바로 가기 · 보임 · 때 · 고친 사람(가린 메일). 되돌리기는 옛 글을 POST /admin/guide-flows/{code} 로 새 판(SUPER).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 그 흐름이 없음' })
  async versions(@Param('code') code: string) {
    const rows = await this.db.query<Record<string, unknown> & { by: string | null }>(
      `SELECT g.version, g.title_ko AS "titleKo", g.who_ko AS "whoKo", g.steps_ko AS "stepsKo", g.title_en AS "titleEn", g.who_en AS "whoEn",
              g.steps_en AS "stepsEn", g.href, g.is_active AS "isActive", g.created_at AS "createdAt", a.email::text AS by
         FROM guide_flows g LEFT JOIN accounts a ON a.id = g.created_by
        WHERE g.code = $1 ORDER BY g.version DESC LIMIT 50`, [String(code ?? '').trim()]);
    if (!rows.length) throw new NotFound('그 이용 흐름이 없습니다.');
    return { code, rows: rows.map((r) => ({ ...r, by: maskMail(r.by) })) };
  }

  @Post(':code')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('GUIDE_FLOW_SAVE', 'GUIDE_FLOW')
  @ApiParam({ name: 'code', example: 'join', description: '흐름 코드(소문자 · 숫자 · _ 2 ~ 20자) — 없는 코드면 새 흐름' })
  @ApiOperation({ summary: '이용 흐름 — 새 판 저장 (SUPER)', description: '고치기 · 지우기 없이 판을 하나 더합니다(가장 높은 판이 사용자 웹에 나옴). 숨기기는 isActive false 로 새 판.' })
  @ApiOkResponse({ type: GuideFlowSaveResultDto })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'GUIDE_FLOW_CODE · GUIDE_FLOW_TITLE · GUIDE_FLOW_WHO · GUIDE_FLOW_STEP · GUIDE_FLOW_EN · GUIDE_FLOW_HREF' })
  async save(@Param('code') code: string, @Body() dto: GuideFlowSaveDto) {
    const c = String(code ?? '').trim();
    if (!/^[a-z][a-z0-9_]{1,19}$/.test(c)) throw new PolicyViolation('GUIDE_FLOW_CODE', '흐름 코드는 소문자 · 숫자 · _ 2 ~ 20자입니다(예: join).');
    const tk = dto.titleKo.trim(), wk = dto.whoKo.trim(), href = dto.href.trim();
    if (tk.length < 2 || tk.length > 60) throw new PolicyViolation('GUIDE_FLOW_TITLE', '제목은 2 ~ 60자입니다.');
    if (wk.length < 2 || wk.length > 60) throw new PolicyViolation('GUIDE_FLOW_WHO', '「누가」는 2 ~ 60자입니다.');
    const sk = dto.stepsKo.map((s) => s.trim()).filter(Boolean);
    if (!sk.length || sk.some((s) => s.length < 2 || s.length > 200)) throw new PolicyViolation('GUIDE_FLOW_STEP', '단계는 1 ~ 10개 · 한 단계 2 ~ 200자입니다.');
    if (!HREF_RE.test(href)) throw new PolicyViolation('GUIDE_FLOW_HREF', '바로 가기는 사이트 안 주소(/ 로 시작)만 됩니다.');
    const te = (dto.titleEn ?? '').trim(), we = (dto.whoEn ?? '').trim();
    const se = (dto.stepsEn ?? []).map((s) => s.trim()).filter(Boolean);
    const anyEn = !!(te || we || se.length);
    if (anyEn && (te.length < 2 || te.length > 100 || we.length < 2 || we.length > 100 || se.length !== sk.length || se.some((s) => s.length < 2 || s.length > 300))) {
      throw new PolicyViolation('GUIDE_FLOW_EN', '영어는 제목 · 누가 · 단계를 모두 쓰거나 모두 비웁니다(단계 수는 한국어와 같게).');
    }
    const [r] = await this.db.query<{ version: number }>(
      `INSERT INTO guide_flows (code, version, title_ko, who_ko, steps_ko, title_en, who_en, steps_en, href, sort_order, is_active, created_by)
       SELECT $1, coalesce(max(version), 0) + 1, $2, $3, $4::jsonb, nullif($5, ''), nullif($6, ''), $7::jsonb, $8,
              coalesce((SELECT sort_order FROM v_guide_flow_current WHERE code = $1), (SELECT coalesce(max(sort_order), 0) + 10 FROM guide_flows)), $9, $10
         FROM guide_flows WHERE code = $1
       RETURNING version`,
      [c, tk, wk, JSON.stringify(sk), anyEn ? te : '', anyEn ? we : '', anyEn ? JSON.stringify(se) : null, href, dto.isActive !== false, RequestCtx.actorId() ?? null]);
    return { ok: true, code: c, version: r!.version, note: `「${tk}」 ${r!.version}판을 저장했습니다(지난 판은 그대로 남음 · 사용자 웹에 바로 나감).` };
  }
}
