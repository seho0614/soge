import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsObject } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { assertPublisher } from './page-publisher';
import { SiteLayoutsService, cleanLayout } from './site-layouts.service';

/* ---------------------------------------------------------------------
 * v10.780 (D329 · docs/888) 소개몰 상품 상세 — 분류마다 · 상품마다 덮어쓰기
 *   꾸밀 페이지 MALL_ITEM(모든 상품)과 같은 모양(안내 띠 글 · 위 · 아래 블록) · 사용자 웹은 상품 > 분류 > 모든 상품 차례로 하나만 씀
 *   고치기 · 게시 규칙은 MALL_ITEM 과 같음 — 수정 가능 스위치 · 소개몰 관이 닫혀 있어야 · 담당자 규칙 · 게시는 SUPER(또는 따로 받은 게시 권한)
 *   초안(draft) · 게시(published) 두 칸 · 판을 쌓지 않음(되돌리기는 「게시 내리기」 = 모든 상품 배치로)
 * ------------------------------------------------------------------- */
export const ITEM_SCOPES = ['CATEGORY', 'PRODUCT'] as const;
type Scope = typeof ITEM_SCOPES[number];

export class MallItemLayoutSaveDto {
  @ApiProperty({ type: 'object', additionalProperties: true, description: '꾸밀 페이지 MALL_ITEM 과 같은 모양 — texts.band · inserts.top · inserts.bottom' }) @IsObject() layout!: Record<string, unknown>;
}
export class MallItemLayoutRowDto {
  @ApiProperty({ enum: ITEM_SCOPES }) scope!: string;
  @ApiProperty() ref!: string;
  @ApiProperty() label!: string;
  @ApiProperty() published!: boolean;
  @ApiProperty() draftChanged!: boolean;
  @ApiPropertyOptional({ nullable: true }) publishedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) updatedByName!: string | null;
}
export class MallItemLayoutDetailDto extends MallItemLayoutRowDto {
  @ApiProperty({ type: 'object', additionalProperties: true }) draft!: unknown;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true }) publishedLayout!: unknown;
}
export class MallItemLayoutPublicDto {
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true, description: '상품 > 분류 차례로 게시된 덮어쓰기 · 없으면 null(모든 상품 배치를 씀)' }) layout!: unknown;
  @ApiPropertyOptional({ enum: ITEM_SCOPES, nullable: true }) from!: string | null;
}

@Injectable()
export class MallItemLayoutsService {
  constructor(private readonly db: DatabaseService, private readonly layouts: SiteLayoutsService) {}

  private scope(s: string): Scope {
    const v = String(s ?? '').toUpperCase();
    if (!(ITEM_SCOPES as readonly string[]).includes(v)) throw new PolicyViolation('MALL_ITEM_SCOPE', '덮어쓰기 범위는 CATEGORY · PRODUCT 입니다.');
    return v as Scope;
  }
  /** 분류 코드 · 상품 코드가 있는지 — 이름을 돌려줌 */
  private async label(scope: Scope, ref: string): Promise<string> {
    if (!/^[A-Za-z0-9_.\-]{1,60}$/.test(ref)) throw new NotFound('없는 분류 · 상품입니다.');
    const [r] = scope === 'CATEGORY'
      ? await this.db.query<{ name: string }>(`SELECT name FROM categories WHERE gwan_code = 'HLT' AND code = $1`, [ref])
      : await this.db.query<{ name: string }>(`SELECT name FROM hlt_products WHERE code = $1`, [ref]);
    if (!r) throw new NotFound('없는 분류 · 상품입니다.');
    return r.name;
  }

  async list() {
    return this.db.query(
      `SELECT m.scope, m.ref,
              coalesce(CASE WHEN m.scope = 'CATEGORY' THEN (SELECT c.name FROM categories c WHERE c.gwan_code = 'HLT' AND c.code = m.ref)
                            ELSE (SELECT p.name FROM hlt_products p WHERE p.code = m.ref) END, m.ref) AS label,
              (m.published IS NOT NULL) AS published, (m.published IS DISTINCT FROM m.draft) AS "draftChanged", m.published_at AS "publishedAt",
              (SELECT name FROM accounts a WHERE a.id = m.updated_by) AS "updatedByName"
         FROM mall_item_layouts m ORDER BY m.scope, m.ref LIMIT 500`);
  }
  async get(scope0: string, ref: string) {
    const scope = this.scope(scope0);
    const label = await this.label(scope, ref);
    const [m] = await this.db.query<{ draft: unknown; published: unknown; published_at: string | null; who: string | null }>(
      `SELECT draft, published, published_at, (SELECT name FROM accounts a WHERE a.id = updated_by) AS who FROM mall_item_layouts WHERE scope = $1 AND ref = $2`, [scope, ref]);
    const draft = m?.draft ?? cleanLayout('MALL_ITEM', {});
    return { scope, ref, label, published: !!m?.published, draftChanged: JSON.stringify(m?.published ?? null) !== JSON.stringify(m?.draft ?? null),
             publishedAt: m?.published_at ?? null, updatedByName: m?.who ?? null, draft, publishedLayout: m?.published ?? null };
  }
  async save(scope0: string, ref: string, layout: unknown) {
    const scope = this.scope(scope0);
    await this.label(scope, ref);
    await this.layouts.assertItemEditable();   // 수정 가능 · 소개몰 닫힘 · 담당자 규칙(MALL_ITEM 과 같음)
    const l = cleanLayout('MALL_ITEM', layout);
    await this.db.query(
      `INSERT INTO mall_item_layouts (scope, ref, draft, updated_by, updated_at) VALUES ($1, $2, $3::jsonb, $4, now())
       ON CONFLICT (scope, ref) DO UPDATE SET draft = EXCLUDED.draft, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [scope, ref, JSON.stringify(l), RequestCtx.actorId() ?? null]);
    return this.get(scope, ref);
  }
  async publish(scope0: string, ref: string) {
    const scope = this.scope(scope0);
    await assertPublisher(this.db);
    await this.layouts.assertItemEditable();
    const r = await this.db.query(`UPDATE mall_item_layouts SET published = draft, published_at = now(), updated_by = $3 WHERE scope = $1 AND ref = $2 RETURNING ref`, [scope, ref, RequestCtx.actorId() ?? null]);
    if (!r.length) throw new PolicyViolation('MALL_ITEM_NO_DRAFT', '저장한 초안이 없습니다 — 먼저 「초안 저장」을 하십시오.');
    return this.get(scope, ref);
  }
  /** 게시 내리기 — 그 상품 · 분류는 다시 모든 상품 배치(초안은 남김) */
  async unpublish(scope0: string, ref: string) {
    const scope = this.scope(scope0);
    await assertPublisher(this.db);
    await this.layouts.assertItemEditable();
    await this.db.query(`UPDATE mall_item_layouts SET published = NULL, published_at = NULL, updated_by = $3 WHERE scope = $1 AND ref = $2`, [scope, ref, RequestCtx.actorId() ?? null]);
    return this.get(scope, ref);
  }
  /** 사용자 웹 — 상품 > 분류 차례로 게시된 것 하나 · 소개몰 관이 닫혀 있으면 null */
  async forItem(product?: string, category?: string) {
    const p = product && /^[A-Za-z0-9_.\-]{1,60}$/.test(product) ? product : null;
    const c = category && /^[A-Za-z0-9_.\-]{1,60}$/.test(category) ? category : null;
    if (!p && !c) return { layout: null, from: null };
    const [r] = await this.db.query<{ scope: string; published: unknown }>(
      `SELECT scope, published FROM mall_item_layouts
        WHERE published IS NOT NULL AND ((scope = 'PRODUCT' AND ref = $1) OR (scope = 'CATEGORY' AND ref = $2))
          AND EXISTS (SELECT 1 FROM gwans g WHERE g.code = 'HLT' AND g.is_active)
        ORDER BY (scope = 'PRODUCT') DESC LIMIT 1`, [p, c]);
    return { layout: r ? await this.layouts.expandPublic('MALL_ITEM', r.published) : null, from: r?.scope ?? null };
  }
}

@ApiTags('ADM')
@Controller('api/v1')
export class MallItemLayoutsController {
  constructor(private readonly svc: MallItemLayoutsService) {}

  @Get('mall-item-layouts/for')
  @ApiOperation({ summary: '상품 상세 덮어쓰기 (v10.780 · 공개)', description: '상품 > 분류 차례로 게시된 것 하나 · 없으면 layout null(모든 상품 배치).' })
  @ApiQuery({ name: 'product', required: false }) @ApiQuery({ name: 'category', required: false })
  @ApiOkResponse({ type: MallItemLayoutPublicDto })
  forItem(@Query('product') product?: string, @Query('category') category?: string) { return this.svc.forItem(product, category); }

  @Get('admin/mall-item-layouts')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '상품 상세 덮어쓰기 목록 (v10.780)', description: '분류 · 상품마다 게시 여부 · 초안 바뀜.' })
  @ApiOkResponse({ type: [MallItemLayoutRowDto] })
  list() { return this.svc.list(); }

  @Get('admin/mall-item-layouts/:scope/:ref')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '상품 상세 덮어쓰기 하나 (v10.780)', description: '없으면 빈 초안.' })
  @ApiParam({ name: 'scope', enum: ITEM_SCOPES }) @ApiParam({ name: 'ref' })
  @ApiOkResponse({ type: MallItemLayoutDetailDto })
  @ApiResponse({ status: 404, type: ErrorDto }) @ApiResponse({ status: 422, description: 'MALL_ITEM_SCOPE', type: ErrorDto })
  get(@Param('scope') scope: string, @Param('ref') ref: string) { return this.svc.get(scope, ref); }

  @Put('admin/mall-item-layouts/:scope/:ref')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '상품 상세 덮어쓰기 초안 저장 (v10.780)', description: '꾸밀 페이지 MALL_ITEM 규칙 · 수정 가능 · 소개몰 관 닫힘 · 담당자 규칙.' })
  @ApiParam({ name: 'scope', enum: ITEM_SCOPES }) @ApiParam({ name: 'ref' })
  @ApiOkResponse({ type: MallItemLayoutDetailDto })
  @ApiResponse({ status: 422, description: 'SITE_LAYOUT_LOCKED · SITE_LAYOUT_GWAN_OPEN · SITE_LAYOUT_INVALID · MALL_ITEM_SCOPE', type: ErrorDto })
  @Audit('MALL_ITEM_LAYOUT_SAVE', 'SETTING')
  save(@Param('scope') scope: string, @Param('ref') ref: string, @Body() dto: MallItemLayoutSaveDto) { return this.svc.save(scope, ref, dto.layout); }

  @Post('admin/mall-item-layouts/:scope/:ref/publish')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '상품 상세 덮어쓰기 게시 (v10.780)', description: '게시 권한(SUPER · 따로 받은 권한) · 같은 규칙.' })
  @ApiParam({ name: 'scope', enum: ITEM_SCOPES }) @ApiParam({ name: 'ref' })
  @ApiOkResponse({ type: MallItemLayoutDetailDto })
  @ApiResponse({ status: 403, description: 'PAGE_PUBLISH_FORBIDDEN', type: ErrorDto }) @ApiResponse({ status: 422, description: 'MALL_ITEM_NO_DRAFT', type: ErrorDto })
  @Audit('MALL_ITEM_LAYOUT_PUBLISH', 'SETTING')
  publish(@Param('scope') scope: string, @Param('ref') ref: string) { return this.svc.publish(scope, ref); }

  @Delete('admin/mall-item-layouts/:scope/:ref/publish')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '상품 상세 덮어쓰기 게시 내리기 (v10.780)', description: '그 상품 · 분류는 모든 상품 배치로 · 초안은 남김.' })
  @ApiParam({ name: 'scope', enum: ITEM_SCOPES }) @ApiParam({ name: 'ref' })
  @ApiOkResponse({ type: MallItemLayoutDetailDto })
  @Audit('MALL_ITEM_LAYOUT_UNPUBLISH', 'SETTING')
  unpublish(@Param('scope') scope: string, @Param('ref') ref: string) { return this.svc.unpublish(scope, ref); }
}
