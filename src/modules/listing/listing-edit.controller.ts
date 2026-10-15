import { Body, Controller, Delete, Get, Injectable, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { DatabaseService } from '../../db/database.service';
import { Forbidden, NotFound } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { Roles } from '../../core/auth';
import { ErrorDto } from '../../common/dto/common.dto';

export class ListingDraftDto {
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) title?: string;
  @ApiPropertyOptional({ maxLength: 5000 }) @IsOptional() @IsString() @MaxLength(5000) body?: string;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsInt() @Min(0) desiredFee?: number;
}
export class ListingDraftResultDto {
  @ApiProperty() saved!: boolean;
  @ApiPropertyOptional({ format: 'date-time' }) savedAt?: string;
}

/**
 * v10.31 (w1) — SB-HOM-REG-020 매물 수정의 시안 구역: 반려 사유 상자(사유 · 걸린 표현) · 「초안 저장」 · 이력 줄.
 *   GET    /me/listings/{id}/review   최근 검수 결과(상태 · 사유 · 메모 · 걸린 표현) + 이력(판 · 검수 사건)
 *   GET    /me/listings/{id}/draft    저장해 둔 수정 초안
 *   PUT    /me/listings/{id}/draft    초안 저장(공개 중인 매물은 그대로 · 재검수 없음)
 *   DELETE /me/listings/{id}/draft    초안 버리기
 * 모두 **등록한 본인만**. 재검수 요청(PATCH /listings/{id})이 성공하면 초안은 서버가 지웁니다.
 */
@Injectable()
export class ListingEditService {
  constructor(private readonly db: DatabaseService) {}

  private async own(id: string) {
    const me = RequestCtx.actorId();
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFound('매물을 찾을 수 없습니다.');
    const [l] = await this.db.query<{ owner: string; status: string }>(
      `SELECT owner_account_id AS owner, status FROM listings WHERE id = $1`, [id]);
    if (!l) throw new NotFound('매물을 찾을 수 없습니다.');
    if (l.owner !== me) throw new Forbidden('NOT_OWNER', '등록한 본인만 볼 수 있습니다.');
    return { me: me!, status: l.status };
  }

  async review(id: string) {
    const { status } = await this.own(id);
    const [ri] = await this.db.query<any>(
      `SELECT ri.id, ri.status, ri.reject_reason_code AS "reasonCode", rc.label AS "reasonLabel", ri.reject_memo AS memo,
              ri.manual_reasons AS "manualReasons", ri.submitted_at AS "submittedAt", ri.decided_at AS "decidedAt", ri.sla_due_at AS "slaDueAt"
         FROM review_items ri LEFT JOIN review_reason_codes rc ON rc.code = ri.reject_reason_code
        WHERE ri.target_type = 'LISTING' AND ri.target_id = $1
        ORDER BY ri.submitted_at DESC LIMIT 1`, [id]);
    /* 걸린 표현 — 금칙어 반려(BANNED_WORD)면 지금 본문 · 제목에서 금칙어 사전에 걸리는 말을 찾아 보여 줍니다(어디를 고칠지) */
    let flagged: string[] = [];
    if (ri?.reasonCode === 'BANNED_WORD') {
      const rows = await this.db.query<{ w: string }>(
        `SELECT DISTINCT b.word AS w FROM banned_words b, listings l
          WHERE l.id = $1 AND b.is_active AND position(lower(b.word) IN lower(coalesce(l.title,'') || ' ' || coalesce(l.body,''))) > 0
          LIMIT 10`, [id]).catch(() => [] as Array<{ w: string }>);
      flagged = rows.map((r) => r.w);
    }
    const history = await this.db.query<any>(
      `SELECT * FROM (
         SELECT v.created_at AS at, '수정 ' || v.version || '판 저장' AS label, 'VERSION' AS kind
           FROM listing_versions v WHERE v.listing_id = $1
         UNION ALL
         SELECT e.occurred_at,
                CASE e.event WHEN 'SUBMITTED' THEN '검수 요청' WHEN 'APPROVED' THEN '승인 · 노출'
                             WHEN 'REJECTED' THEN '반려' WHEN 'ASSIGNED' THEN '담당 배정' ELSE e.event END
                  || coalesce(' — ' || rc.label, ''), 'REVIEW'
           FROM review_events e JOIN review_items ri ON ri.id = e.review_item_id
           LEFT JOIN review_reason_codes rc ON rc.code = e.reason_code
          WHERE ri.target_type = 'LISTING' AND ri.target_id = $1
       ) h ORDER BY at DESC LIMIT 20`, [id]);
    const [sl] = await this.db.query<{ label: string }>(
      `SELECT label FROM code_labels WHERE domain = 'listing.status' AND code = $1`, [status]);
    return { listingStatus: status, listingStatusLabel: sl?.label ?? status, review: ri ?? null, flagged, history };
  }

  async getDraft(id: string) {
    await this.own(id);
    const [d] = await this.db.query<any>(
      `SELECT title, body, desired_fee AS "desiredFee", saved_at AS "savedAt" FROM listing_edit_drafts WHERE listing_id = $1`, [id]);
    return d ?? null;
  }

  async saveDraft(id: string, dto: ListingDraftDto) {
    const { me } = await this.own(id);
    const [d] = await this.db.query<{ savedAt: string }>(
      `INSERT INTO listing_edit_drafts (listing_id, owner_id, title, body, desired_fee, saved_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (listing_id) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body,
             desired_fee = EXCLUDED.desired_fee, saved_at = now()
       RETURNING saved_at AS "savedAt"`, [id, me, dto.title ?? null, dto.body ?? null, dto.desiredFee ?? null]);
    return { saved: true, savedAt: d.savedAt };
  }

  async dropDraft(id: string) {
    await this.own(id);
    await this.db.query(`DELETE FROM listing_edit_drafts WHERE listing_id = $1`, [id]);
    return { saved: false };
  }
}

@ApiTags('HOM')
@ApiBearerAuth()
@Controller('api/v1/me/listings')
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
@ApiResponse({ status: 403, description: 'NOT_OWNER', type: ErrorDto })
export class ListingEditController {
  constructor(private readonly svc: ListingEditService) {}

  @Get(':id/review')
  @ApiOperation({ summary: '내 매물 검수 결과 · 이력', description: '반려 사유 · 메모 · 걸린 표현(금칙어 반려) · 판/검수 이력. 등록한 본인만.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  review(@Param('id') id: string) { return this.svc.review(id); }

  @Get(':id/draft')
  @ApiOperation({ summary: '수정 초안 보기' })
  @ApiParam({ name: 'id', format: 'uuid' })
  draft(@Param('id') id: string) { return this.svc.getDraft(id); }

  @Put(':id/draft')
  @ApiOperation({ summary: '수정 초안 저장', description: '공개 중인 매물은 그대로 두고 고친 내용만 둡니다(재검수 없음). 재검수 요청을 보내면 지워집니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  save(@Param('id') id: string, @Body() dto: ListingDraftDto) { return this.svc.saveDraft(id, dto); }

  @Delete(':id/draft')
  @ApiOperation({ summary: '수정 초안 버리기' })
  @ApiParam({ name: 'id', format: 'uuid' })
  drop(@Param('id') id: string) { return this.svc.dropDraft(id); }
}
