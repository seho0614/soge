import { Body, Controller, Get, Headers, HttpCode, Injectable, Ip, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { RequestCtx } from '../../core/request-context';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { createHash } from 'crypto';
import { ErrorDto } from '../../common/dto/common.dto';
import { StrictBoolean } from '../../common/strict-boolean';
import { Roles } from '../../core/auth';
import { PolicyViolation } from '../../core/errors';
import { DatabaseService } from '../../db/database.service';
import { toCsv } from './csv';

/* ---------------------------------------------------------------------
 * v10.729 (D325 · docs/837) 손님 한 줄 의견 블록 — 페이지 끝 「이 안내가 도움이 됐나요?」 예 · 아니오 + 한 줄(200자)
 *   공개 POST /page-feedback(로그인 없이 · 같은 기기 같은 페이지 하루 한 번 · 기기 지문은 해시 16자만 · HTML 없이)
 *   ADMIN · SUPER GET /admin/page-feedback — 페이지마다 도움됨 · 아님 수 · 최근 한 줄 50
 * ------------------------------------------------------------------- */
export class PageFeedbackCreateDto {
  @ApiProperty({ enum: ['LAYOUT', 'PAGE'] }) @IsIn(['LAYOUT', 'PAGE']) kind!: string;
  @ApiProperty({ example: 'HOME', description: '꾸밀 페이지 열쇠 또는 관 페이지 「관/주소」' }) @IsString() @Matches(/^[A-Za-z0-9_\-/]{1,40}$/) ref!: string;
  @ApiProperty() @StrictBoolean() helpful!: boolean;
  @ApiPropertyOptional({ example: '연락처를 더 크게 보여 주세요' }) @IsOptional() @IsString() @MaxLength(200) comment?: string;
  @ApiPropertyOptional({ enum: ['a', 'b'], description: 'v10.781 A/B 비교 판(꾸밀 페이지 · 방문자 쿠키 sgb_ab)' }) @IsOptional() @IsIn(['a', 'b']) variant?: string;
}
export class PageFeedbackResultDto {
  @ApiProperty() saved!: boolean;
}
export class PageFeedbackCheckDto {
  @ApiProperty() id!: number;
  @ApiProperty() checked!: boolean;
}
export class PageFeedbackSummaryDto {
  @ApiProperty({ type: 'array', items: { type: 'object' }, description: '페이지마다 도움됨 · 아님 · 30일' }) pages!: unknown[];
  @ApiProperty({ type: 'array', items: { type: 'object' }, description: '최근 한 줄 의견 50' }) recent!: unknown[];
}

@Injectable()
export class PageFeedbackService {
  constructor(private readonly db: DatabaseService) {}
  async create(input: { kind: string; ref: string; helpful: boolean; comment?: string; variant?: string }, ip: string, ua: string) {
    const comment = String(input.comment ?? '').replace(/\r/g, '').trim().slice(0, 200);
    if (/<\s*\/?\s*[a-z!]/i.test(comment)) throw new PolicyViolation('PAGE_FEEDBACK', '한 줄 의견에 HTML 태그는 쓸 수 없습니다.');
    const day = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
    const dev = createHash('sha256').update(`${ip}|${ua}|${day}`).digest('hex').slice(0, 16);
    const [dup] = await this.db.query(`SELECT 1 FROM page_feedback WHERE page_kind = $1 AND page_ref = $2 AND dev_hash = $3 AND at > now() - interval '1 day'`, [input.kind, input.ref, dev]);
    if (dup) return { saved: false };
    const variant = input.kind === 'LAYOUT' && (input.variant === 'a' || input.variant === 'b') ? input.variant.toUpperCase() : null;   // v10.781 (D329) A/B 판
    await this.db.query(`INSERT INTO page_feedback (page_kind, page_ref, helpful, comment, dev_hash, variant) VALUES ($1, $2, $3, $4, $5, $6)`, [input.kind, input.ref, input.helpful === true, comment || null, dev, variant]);
    return { saved: true };
  }
  async summary(days = 30) {
    const d = Math.min(Math.max(Math.floor(days), 1), 365);
    const pages = await this.db.query(
      `SELECT page_kind AS kind, page_ref AS ref, count(*) FILTER (WHERE helpful)::int AS yes, count(*) FILTER (WHERE NOT helpful)::int AS no, max(at) AS "lastAt"
         FROM page_feedback WHERE at > now() - make_interval(days => $1) GROUP BY page_kind, page_ref ORDER BY count(*) DESC LIMIT 100`, [d]);
    const recent = await this.db.query(`SELECT id::int AS id, page_kind AS kind, page_ref AS ref, helpful, comment, at, checked_at AS "checkedAt", (SELECT name FROM accounts a WHERE a.id = checked_by) AS "checkedByName" FROM page_feedback WHERE comment IS NOT NULL ORDER BY (checked_at IS NULL) DESC, at DESC LIMIT 50`);
    return { pages, recent };
  }
  /** v10.749 (D327 · docs/857) 「확인함」 — 한 번만 */
  async check(id: number, by: string | null) {
    const [r] = await this.db.query(`UPDATE page_feedback SET checked_at = now(), checked_by = $2 WHERE id = $1 AND checked_at IS NULL RETURNING id`, [id, by]);
    return { id, checked: !!r };
  }
  /** v10.738 (docs/846) 의견 CSV — 기간 안 모든 줄(때 · 페이지 · 도움됨 · 한 줄) · 기기 지문은 빼고 */
  async csv(days = 30) {
    const d = Math.min(Math.max(Math.floor(days), 1), 365);
    const rows = await this.db.query<{ at: string; kind: string; ref: string; helpful: boolean; comment: string | null }>(
      `SELECT at, page_kind AS kind, page_ref AS ref, helpful, comment FROM page_feedback WHERE at > now() - make_interval(days => $1) ORDER BY at DESC LIMIT 20000`, [d]);
    return { csv: toCsv(['때(UTC)', '종류', '페이지', '도움됨', '한 줄 의견'], rows.map((r) => [String(r.at).slice(0, 19), r.kind === 'LAYOUT' ? '꾸밀 페이지' : '관 페이지', r.ref, r.helpful ? '예' : '아니오', r.comment ?? ''])),
             rows: rows.length, filename: `손님한줄의견_${d}일.csv` };
  }
}

@ApiTags('ADM')
@Controller('api/v1')
export class PageFeedbackController {
  constructor(private readonly svc: PageFeedbackService) {}

  @Post('page-feedback')
  @HttpCode(200)
  @ApiOperation({ summary: '손님 한 줄 의견 (v10.729 · 공개)', description: '같은 기기 같은 페이지 하루 한 번(saved false) · 기기 지문 해시만 · HTML 없이.' })
  @ApiOkResponse({ type: PageFeedbackResultDto })
  @ApiResponse({ status: 422, description: 'PAGE_FEEDBACK', type: ErrorDto })
  create(@Body() dto: PageFeedbackCreateDto, @Ip() ip: string, @Headers('user-agent') ua?: string) { return this.svc.create(dto, ip ?? '', ua ?? ''); }

  @Post('admin/page-feedback/:id/check')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '한 줄 의견 확인함 (v10.749)', description: '한 번만 · 이미 확인했으면 checked false.' })
  @ApiOkResponse({ type: PageFeedbackCheckDto })
  check(@Param('id', ParseIntPipe) id: number) { return this.svc.check(id, RequestCtx.actorId() ?? null); }

  @Get('admin/page-feedback.csv')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '손님 한 줄 의견 CSV (v10.738)', description: '기간 안 모든 줄 · 기기 지문 뺌 · 엑셀 BOM.' })
  @ApiQuery({ name: 'days', required: false, example: 30 })
  @ApiOkResponse({ type: Object })
  csv(@Query('days') days?: string) { return this.svc.csv(Number(days) || 30); }

  @Get('admin/page-feedback')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '손님 한 줄 의견 모아 보기 (v10.729)', description: '페이지마다 도움됨 · 아님(기간) · 최근 한 줄 50.' })
  @ApiQuery({ name: 'days', required: false, example: 30 })
  @ApiOkResponse({ type: PageFeedbackSummaryDto })
  @ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
  summary(@Query('days') days?: string) { return this.svc.summary(Number(days) || 30); }
}
