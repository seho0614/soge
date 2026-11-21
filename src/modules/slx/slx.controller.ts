import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { MailService } from '../../common/mail/mail.service';
import { PartnerActorService } from '../partner/partner-actor.service';
import { myStatement, myStatements, statementDetail, statementMailNow, statementsMake, statementsView } from './statements';
import { reviewPhoto, reviewPointRevoke, reviewPointsView } from './review-points';
import { adminPerf, myPerfTrend } from './partner-perf';

/* ---------------------------------------------------------------------
 * v10.532 ~ 534 (D281 · docs/670 ~ 672) (51) 소개몰 · 파트너 — 대표 11/20
 *   SlxAdminController       api/v1/admin/health  (ADMIN · SUPER — 소개몰 운영과 같게)
 *     월 정산서  GET /statements · GET /statements/{id} · POST /statements/make · POST /statements/{id}/mail
 *     리뷰 적립  GET /review-points · POST /review-points/{id}/revoke
 *   SlxSellerController      api/v1/me/health/seller  (입점 판매자 본인 — 판매자센터와 같은 역할)
 *     GET /statements · GET /statements/{ym}
 *   SlxReviewPhotoController api/v1/health/reviews  (공개 구역 health — 보이는 리뷰만 · 쓴 사람 · 운영자는 늘)
 *     GET /{id}/photo
 *   SlxPartnerController     api/v1/partner  (파트너센터 — 자기 파트너 것만)
 *     GET /perf-trend
 *   SlxPartnerAdminController api/v1/admin/partner-perf  (ADMIN · SUPER · 안심 파트너 담당 PARTNER_MAL)
 *     GET /
 *   ★ 세무사(ACCOUNTANT)는 /admin/acct/ 접두가 아니라 보지 않음(규칙 8) · 판매자 · 파트너 개인정보는 가린 이름만
 * ------------------------------------------------------------------- */

const YM_IN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;   // DB CHECK hlt_seller_statements.ym · statements.ts STMT_YM 과 같음(규칙 2)

export class SlxStatementMakeDto {
  @ApiProperty({ example: '2026-10', description: '정산 달(YYYY-MM)' }) @IsString() @Matches(YM_IN) ym!: string;
  @ApiPropertyOptional({ format: 'uuid', description: '이 판매자만(비우면 그 달 주 정산서가 있는 입점 판매자 모두)' }) @IsOptional() @IsUUID() sellerId?: string;
}
export class SlxReviewRevokeDto {
  @ApiProperty({ example: '광고성 리뷰 확인', description: '회수 사유(2 ~ 200자 · 감사 기록)' }) @IsString() @Length(2, 200) reason!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/health')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class SlxAdminController {
  constructor(private readonly db: DatabaseService, private readonly mail: MailService) {}

  /* ── 판매자 월 정산서 (v10.532) ── */
  @Get('statements')
  @ApiQuery({ name: 'ym', required: false, description: '정산 달 YYYY-MM(비우면 지난달 · 한국)' })
  @ApiOperation({ summary: '판매자 월 정산서 목록 (v10.532)', description: '그 달 입점 판매자별 월 정산서(만든 것 · 안 만든 것) · 메일 스위치(mall.statement_mail · 처음 off) · 만드는 날 · 메일 준비.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_STMT_YM' })
  statements(@Query('ym') ym?: string) { return statementsView(this.db, this.mail, ym); }

  @Get('statements/:id')
  @ApiParam({ name: 'id', description: '월 정산서 번호' })
  @ApiOperation({ summary: '판매자 월 정산서 한 장 (v10.532)', description: '판매자 · 운영 법인 · 합계 · 주별 줄 · 메일 상태 — 운영 화면이 인쇄용 창(PDF 저장)으로 그림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  statement(@Param('id') id: string) { return statementDetail(this.db, id); }

  @Post('statements/make')
  @HttpCode(200)
  @Audit('HLT_STATEMENT_MAKE', 'HLT_SELLER')
  @ApiOperation({ summary: '판매자 월 정산서 만들기 · 다시 셈 (v10.532)', description: '그 달 주 정산서가 있는 입점 판매자(또는 고른 판매자)의 월 정산서를 만들거나 다시 셈. 메일로 보낸 것은 그대로(고른 판매자면 409).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HLT_STMT_SENT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_STMT_YM · HLT_STMT_FUTURE · HLT_STMT_SELLER' })
  make(@Body() dto: SlxStatementMakeDto) { return statementsMake(this.db, dto.ym, dto.sellerId ?? null); }

  @Post('statements/:id/mail')
  @HttpCode(200)
  @Audit('HLT_STATEMENT_MAIL', 'HLT_SELLER')
  @ApiParam({ name: 'id', description: '월 정산서 번호' })
  @ApiOperation({ summary: '판매자 월 정산서 메일 지금 보내기 (v10.532)', description: '다시 셈 → 판매자 계정 메일로 한 번. 같은 달은 두 번 보내지 않음(409). 메일 스위치 · 메일 준비가 필요(422).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HLT_STMT_SENT · HLT_STMT_SENDING' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_STMT_MAIL_OFF · HLT_STMT_MAIL_NOT_READY · HLT_STMT_EMPTY · HLT_STMT_NO_ADDR' })
  mailNow(@Param('id') id: string) { return statementMailNow(this.db, this.mail, id, RequestCtx.actorId() ?? null); }

  /* ── 리뷰 작성 적립 (v10.533) ── */
  @Get('review-points')
  @ApiQuery({ name: 'state', required: false, enum: ['GRANTED', 'REVOKED'] })
  @ApiOperation({ summary: '리뷰 작성 적립 (v10.533)', description: '스위치(mall.review_points · mall.points) · 글 · 사진 가산 금액 · 최소 글자 · 기한 · 최근 30일 적립 · 회수 · 기록 100(가린 이름).' })
  @ApiOkResponse({ type: Object })
  reviewPoints(@Query('state') state?: string) { return reviewPointsView(this.db, state); }

  @Post('review-points/:id/revoke')
  @HttpCode(200)
  @Audit('HLT_REVIEW_POINT_REVOKE', 'HLT_REVIEW')
  @ApiParam({ name: 'id', description: '리뷰 적립 번호' })
  @ApiOperation({ summary: '리뷰 적립 운영 회수 (v10.533)', description: '그 리뷰로 준 적립금 묶음의 남은 금액 회수 · 이미 쓴 몫은 운영 알림 · 사유 · 감사 기록. 한 주문 한 번이라 다시 주지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'HLT_REVIEW_POINT_REVOKED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_REVIEW_POINT_REASON' })
  revoke(@Param('id') id: string, @Body() dto: SlxReviewRevokeDto) { return reviewPointRevoke(this.db, id, dto.reason, RequestCtx.actorId() ?? null); }
}

@ApiTags('HEALTH')
@ApiBearerAuth()
@Controller('api/v1/me/health/seller')
@Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: 'NOT_SELLER', type: ErrorDto })
export class SlxSellerController {
  constructor(private readonly db: DatabaseService) {}

  @Get('statements')
  @ApiOperation({ summary: '내 월 정산서 목록 (v10.532)', description: '판매자센터 — 만든 월 정산서 + 주 정산서는 있는데 아직 안 만든 달(미리보기) · 최근 24달.' })
  @ApiOkResponse({ type: Object })
  list() { return myStatements(this.db, RequestCtx.actorId() ?? null); }

  @Get('statements/:ym')
  @ApiParam({ name: 'ym', example: '2026-10' })
  @ApiOperation({ summary: '내 월 정산서 한 장 (v10.532)', description: '판매자센터 인쇄용 화면(PDF 저장) — 만든 것 · 없으면 지금 기록으로 셈한 미리보기.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HLT_STMT_YM' })
  one(@Param('ym') ym: string) { return myStatement(this.db, RequestCtx.actorId() ?? null, ym); }
}

@ApiTags('HEALTH')
@Controller('api/v1/health/reviews')
export class SlxReviewPhotoController {
  constructor(private readonly db: DatabaseService) {}

  @Get(':id/photo')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '리뷰 사진 (공개 · v10.533)', description: '보이는(VISIBLE) 리뷰의 사진 한 장 — 쓴 사람 · 운영자는 늘. 없으면 404.' })
  @ApiOkResponse({ description: '사진 바이트(jpg · png)' })
  @ApiResponse({ status: 404, description: '사진 없음', type: ErrorDto })
  async photo(@Param('id') id: string, @Res() res: Response) {
    const me = RequestCtx.actorId() ?? null;
    const [st] = me ? await this.db.query<{ staff: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM account_roles WHERE account_id = $1::uuid AND role IN ('ADMIN', 'SUPER', 'REVIEWER')) OR public.pgx_groups_task($1::uuid, ARRAY['queue'], ARRAY['VIEW']) AS staff`, [me]) : [{ staff: false }];   // v10.615 (docs/757)
    const r = await reviewPhoto(this.db, id, me, !!st?.staff);
    res.status(200);
    res.setHeader('Content-Type', r.contentType); res.setHeader('Content-Length', String(r.size));
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    r.stream.on('error', () => res.destroy());
    r.stream.pipe(res);
  }
}

@ApiTags('PTC')
@ApiBearerAuth()
@Controller('api/v1/partner')
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
@ApiResponse({ status: 409, description: 'NOT_PARTNER', type: ErrorDto })
export class SlxPartnerController {
  constructor(private readonly db: DatabaseService, private readonly actors: PartnerActorService) {}

  @Get('perf-trend')
  @ApiQuery({ name: 'period', required: false, enum: ['30d', '90d', '12m'], description: '30일(날마다) · 90일(주마다) · 12개월(달마다)' })
  @ApiOperation({ summary: '파트너 성과 추이 (v10.534)', description: '내 파트너 것만 — 받은 리드 · 열람 · 응답 속도 · 리드 전환(성사) · 리드 이용료 · 받은 정산의 기간 그래프 · 요약 · 앞 기간. 돈 칸은 대표 · 정산 권한 직원만.' })
  @ApiOkResponse({ type: Object })
  trend(@Query('period') period?: string) { return myPerfTrend(this.db, this.actors, RequestCtx.actorId() ?? null, period); }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/partner-perf')
@Roles('ADMIN', 'SUPER', 'PARTNER_MAL')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class SlxPartnerAdminController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @ApiQuery({ name: 'period', required: false, enum: ['30d', '90d', '12m'] })
  @ApiQuery({ name: 'partnerId', required: false, description: '이 파트너만(비우면 모두 합)' })
  @ApiQuery({ name: 'sort', required: false, enum: ['received', 'confirmed', 'fee'] })
  @ApiOperation({ summary: '파트너 성과 (운영 · v10.534)', description: '모든 파트너 합 또는 고른 파트너의 기간 그래프 · 요약 · 앞 기간 · 순위 100(받은 리드 · 성사 · 이용료).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  perf(@Query('period') period?: string, @Query('partnerId') partnerId?: string, @Query('sort') sort?: string) { return adminPerf(this.db, period, partnerId, sort); }
}
