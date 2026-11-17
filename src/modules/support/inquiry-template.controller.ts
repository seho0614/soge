import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { DatabaseService } from '../../db/database.service';
import { RequestCtx } from '../../core/request-context';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';

/* ---------------------------------------------------------------------
 * v10.334 (D226 · docs/465) — 1:1 문의 답변 틀(운영 화면 「1:1 문의」에서 골라 답변 칸에 채움)
 *
 *   ADMIN·SUPER  GET   /admin/inquiry-templates        모두(숨긴 것 포함 · 순서대로)
 *                POST  /admin/inquiry-templates        새 틀(감사 INQUIRY_TEMPLATE_CREATE)
 *                PATCH /admin/inquiry-templates/:id    고치기 · 숨기기 · 순서(감사 INQUIRY_TEMPLATE_UPDATE)
 *   지우기 없음(숨기기).
 * ------------------------------------------------------------------- */

export class InquiryTemplatePatchDto {
  @ApiPropertyOptional({ example: '정산 일정 안내', description: '이름(1 ~ 40자)' }) @IsOptional() @IsString() @MaxLength(80) title?: string;
  @ApiPropertyOptional({ description: '답변 글(2 ~ 4,000자)' }) @IsOptional() @IsString() @MaxLength(8000) body?: string;
  @ApiPropertyOptional({ example: 10, description: '순서(작을수록 위)' }) @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  @ApiPropertyOptional({ description: 'false = 숨김' }) @IsOptional() @IsBoolean() isActive?: boolean;
}
export class InquiryTemplateCreateDto extends InquiryTemplatePatchDto {}
export class InquiryTemplateResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() note!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/inquiry-templates')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class InquiryTemplateController {
  constructor(private readonly db: DatabaseService) {}

  private clean(v: InquiryTemplatePatchDto, base: { title: string; body: string; sortOrder: number; isActive: boolean }) {
    const o = {
      title: v.title !== undefined ? v.title.trim().slice(0, 40) : base.title,
      body: v.body !== undefined ? v.body.replace(/\r\n/g, '\n').trim() : base.body,
      sortOrder: v.sortOrder ?? base.sortOrder,
      isActive: v.isActive ?? base.isActive,
    };
    if (!o.title) throw new PolicyViolation('TEMPLATE_TITLE', '틀 이름을 적어 주십시오.');
    if (o.body.length < 2 || o.body.length > 4000) throw new PolicyViolation('TEMPLATE_BODY', '답변 글은 2 ~ 4,000자입니다.');
    return o;
  }

  private async dup(title: string, id: string | null) {
    const [d] = await this.db.query(`SELECT 1 FROM inquiry_templates WHERE is_active AND title = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)`, [title, id]);
    if (d) throw new StateConflict('TEMPLATE_DUPLICATE', '같은 이름의 틀이 이미 있습니다.');
  }

  @Get()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '1:1 문의 답변 틀 — 모두', description: '보이는 것 먼저 · 순서대로. 고친 사람 · 때.' })
  @ApiOkResponse({ type: Object })
  async list() {
    const rows = await this.db.query(
      `SELECT t.id::text AS id, t.title, t.body, t.sort_order AS "sortOrder", t.is_active AS "isActive", t.updated_at AS "updatedAt"
         FROM inquiry_templates t ORDER BY t.is_active DESC, t.sort_order, t.title`);
    return { rows };
  }

  @Post()
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @Audit('INQUIRY_TEMPLATE_CREATE', 'INQUIRY_TEMPLATE')
  @ApiOperation({ summary: '1:1 문의 답변 틀 — 새로' })
  @ApiOkResponse({ type: InquiryTemplateResultDto })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TEMPLATE_DUPLICATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TEMPLATE_TITLE · TEMPLATE_BODY' })
  async create(@Body() dto: InquiryTemplateCreateDto) {
    const o = this.clean(dto, { title: '', body: '', sortOrder: 100, isActive: true });
    if (o.isActive) await this.dup(o.title, null);
    const [r] = await this.db.query<{ id: string }>(
      `INSERT INTO inquiry_templates (title, body, sort_order, is_active, updated_by) VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id`,
      [o.title, o.body, o.sortOrder, o.isActive, RequestCtx.actorId() ?? null]);
    return { ok: true, id: r!.id, note: `답변 틀 「${o.title}」을 만들었습니다.` };
  }

  @Patch(':id')
  @Roles('ADMIN', 'SUPER')
  @Audit('INQUIRY_TEMPLATE_UPDATE', 'INQUIRY_TEMPLATE')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '1:1 문의 답변 틀 — 고치기 · 숨기기 · 순서', description: '보낸 칸만 바꿈. 지우기 없음.' })
  @ApiOkResponse({ type: InquiryTemplateResultDto })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TEMPLATE_DUPLICATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TEMPLATE_TITLE · TEMPLATE_BODY' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: InquiryTemplatePatchDto) {
    const [cur] = await this.db.query<{ title: string; body: string; sortOrder: number; isActive: boolean }>(
      `SELECT title, body, sort_order AS "sortOrder", is_active AS "isActive" FROM inquiry_templates WHERE id = $1::uuid`, [id]);
    if (!cur) throw new NotFound('그 틀이 없습니다.');
    const o = this.clean(dto, cur);
    if (o.isActive) await this.dup(o.title, id);
    await this.db.query(
      `UPDATE inquiry_templates SET title = $2, body = $3, sort_order = $4, is_active = $5, updated_by = $6, updated_at = now() WHERE id = $1::uuid`,
      [id, o.title, o.body, o.sortOrder, o.isActive, RequestCtx.actorId() ?? null]);
    return { ok: true, id, note: cur.isActive !== o.isActive ? (o.isActive ? '틀을 다시 보이게 했습니다.' : '틀을 숨겼습니다.') : '틀을 고쳤습니다.' };
  }
}
