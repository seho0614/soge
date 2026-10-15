import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { StrictBoolean } from '../../common/strict-boolean';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles, RequireGate } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { HealthReviewService } from './health-review.service';

export class ReviewCreateDto {
  @ApiProperty() @IsString() @MaxLength(40) orderNo!: string;
  @ApiProperty() @IsString() @MaxLength(40) productCode!: string;
  @ApiPropertyOptional({ format: 'uuid', description: '같은 상품을 다른 옵션으로 산 경우' }) @IsOptional() @IsUUID() optionId?: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiProperty({ description: '10 ~ 1,000자' }) @IsString() @MinLength(10) @MaxLength(1000) body!: string;
}
export class ReviewPatchDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) rating?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(10) @MaxLength(1000) body?: string;
}
export class QnaCreateDto {
  @ApiProperty({ description: '5 ~ 1,000자' }) @IsString() @MinLength(5) @MaxLength(1000) body!: string;
  @ApiPropertyOptional({ description: '비공개 — 쓴 사람과 운영자만 봄' }) @IsOptional() @StrictBoolean() isPrivate?: boolean;
}
export class ReviewDecideDto {
  @ApiProperty({ enum: ['SHOW', 'HIDE'] }) @IsIn(['SHOW', 'HIDE']) action!: 'SHOW' | 'HIDE';
  @ApiPropertyOptional({ description: '가리는 사유(HIDE 때 필수 · 쓴 사람에게 알림)' }) @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
export class QnaAnswerDto { @ApiProperty() @IsString() @MinLength(2) @MaxLength(2000) answer!: string; }
export class QnaHideDto { @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) reason!: string; }

export class HltReviewItemDto {
  @ApiProperty() id!: string; @ApiProperty() rating!: number; @ApiProperty() body!: string;
  @ApiProperty() createdAt!: string; @ApiProperty() updatedAt!: string;
  @ApiProperty({ description: '이름 첫 글자 + ○○' }) writer!: string; @ApiProperty() mine!: boolean;
  @ApiPropertyOptional({ nullable: true }) optionLabel!: string | null;
}
export class ReviewDistDto { @ApiProperty() 5!: number; @ApiProperty() 4!: number; @ApiProperty() 3!: number; @ApiProperty() 2!: number; @ApiProperty() 1!: number; }
export class ReviewListDto {
  @ApiProperty() count!: number; @ApiPropertyOptional({ nullable: true }) avg!: number | null;
  @ApiProperty({ type: ReviewDistDto }) dist!: ReviewDistDto; @ApiProperty({ type: [HltReviewItemDto] }) items!: HltReviewItemDto[];
}
export class ReviewResultDto {
  @ApiProperty() id!: string; @ApiProperty({ enum: ['VISIBLE', 'PENDING', 'HIDDEN'] }) state!: string;
  @ApiPropertyOptional() rating?: number; @ApiPropertyOptional() body?: string;
  @ApiPropertyOptional({ nullable: true }) holdWord?: string | null; @ApiPropertyOptional() deleted?: boolean; @ApiProperty() note!: string;
}
export class MyOrderReviewDto {
  @ApiProperty() id!: string; @ApiProperty() orderItemId!: string; @ApiProperty() productCode!: string;
  @ApiPropertyOptional({ nullable: true }) optionId!: string | null; @ApiProperty() rating!: number; @ApiProperty() body!: string;
  @ApiProperty() state!: string; @ApiPropertyOptional({ nullable: true }) hiddenReason!: string | null; @ApiProperty() createdAt!: string;
}
export class QnaItemDto {
  @ApiProperty() id!: string; @ApiProperty() isPrivate!: boolean; @ApiProperty() createdAt!: string;
  @ApiProperty() writer!: string; @ApiProperty() mine!: boolean;
  @ApiPropertyOptional({ nullable: true, description: '남의 비공개 문의는 null' }) body!: string | null;
  @ApiPropertyOptional({ nullable: true }) answer!: string | null; @ApiPropertyOptional({ nullable: true }) answeredAt!: string | null;
  @ApiProperty() answered!: boolean;
}
export class QnaListDto { @ApiProperty() count!: number; @ApiProperty({ type: [QnaItemDto] }) items!: QnaItemDto[]; }
export class QnaResultDto {
  @ApiProperty() id!: string; @ApiPropertyOptional() isPrivate?: boolean; @ApiPropertyOptional() createdAt?: string;
  @ApiPropertyOptional() state?: string; @ApiPropertyOptional() answered?: boolean; @ApiProperty() note!: string;
}
export class AdminReviewRowDto {
  @ApiProperty() id!: string; @ApiProperty() state!: string; @ApiProperty() rating!: number; @ApiProperty() body!: string;
  @ApiPropertyOptional({ nullable: true }) holdWord!: string | null; @ApiPropertyOptional({ nullable: true }) hiddenReason!: string | null;
  @ApiProperty() createdAt!: string; @ApiPropertyOptional({ nullable: true }) decidedAt!: string | null;
  @ApiProperty() productCode!: string; @ApiProperty() productName!: string; @ApiProperty() orderNo!: string; @ApiProperty() writer!: string;
}
export class AdminQnaRowDto {
  @ApiProperty() id!: string; @ApiProperty() body!: string; @ApiProperty() isPrivate!: boolean; @ApiProperty() state!: string;
  @ApiPropertyOptional({ nullable: true }) answer!: string | null; @ApiPropertyOptional({ nullable: true }) answeredAt!: string | null;
  @ApiProperty() createdAt!: string; @ApiProperty() productCode!: string; @ApiProperty() productName!: string; @ApiProperty() writer!: string;
}

/** v10.28 (D036) — 상품 상세 「리뷰」 · 「문의」 탭(누구나 봄 · 남의 비공개 문의는 글을 감춤) */
@ApiTags('HEALTH')
@Controller('api/v1/health/products')
export class HealthReviewPublicController {
  constructor(private readonly svc: HealthReviewService) {}

  @Get(':code/reviews')
  @ApiOperation({ summary: '상품 리뷰 — 별점 평균 · 분포 · 목록(보이는 것만)' }) @ApiParam({ name: 'code' })
  @ApiQuery({ name: 'rating', required: false, description: '별점 거르기 1 ~ 5' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiOkResponse({ type: ReviewListDto })
  reviews(@Param('code') code: string, @Query('rating') rating?: string) { return this.svc.productReviews(code, rating ? Number(rating) : undefined); }

  @Get(':code/qna')
  @ApiOperation({ summary: '상품 문의 목록' }) @ApiParam({ name: 'code' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiOkResponse({ type: QnaListDto })
  qna(@Param('code') code: string) { return this.svc.productQna(code); }

  @Post(':code/qna')
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({ summary: '상품 문의 쓰기(본인인증 회원)', description: '비공개를 고르면 쓴 사람과 운영자만 봅니다. 운영자가 답하면 알림.' }) @ApiParam({ name: 'code' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto }) @ApiResponse({ status: 422, description: 'TOO_SHORT', type: ErrorDto })
  @ApiOkResponse({ type: QnaResultDto })
  ask(@Param('code') code: string, @Body() dto: QnaCreateDto) { return this.svc.ask(code, dto); }
}

/** 구매자 — 리뷰 쓰기 · 고치기 · 지우기 · 주문의 내 리뷰 */
@ApiTags('HEALTH')
@ApiBearerAuth()
@Controller('api/v1/me/health')
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
export class HealthReviewMeController {
  constructor(private readonly svc: HealthReviewService) {}

  @Post('reviews')
  @ApiOperation({ summary: '리뷰 쓰기 — 구매확정한 주문의 상품마다 1건', description: '금칙어에 걸리면 PENDING(운영 확인 뒤 보임).' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'NOT_CONFIRMED · ALREADY_REVIEWED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'TOO_SHORT', type: ErrorDto })
  @ApiOkResponse({ type: ReviewResultDto })
  @Audit('HLT_REVIEW_CREATE', 'HLT_REVIEW')
  create(@Body() dto: ReviewCreateDto) { return this.svc.create(dto); }

  @Patch('reviews/:id')
  @ApiOperation({ summary: '리뷰 고치기(본인 · 가려진 리뷰는 못 고침)' }) @ApiParam({ name: 'id' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto }) @ApiResponse({ status: 409, description: 'HIDDEN', type: ErrorDto })
  @ApiOkResponse({ type: ReviewResultDto })
  @Audit('HLT_REVIEW_UPDATE', 'HLT_REVIEW')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewPatchDto) { return this.svc.update(id, dto); }

  @Delete('reviews/:id')
  @ApiOperation({ summary: '리뷰 지우기(본인)' }) @ApiParam({ name: 'id' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiOkResponse({ type: ReviewResultDto })
  @Audit('HLT_REVIEW_DELETE', 'HLT_REVIEW')
  remove(@Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(id); }

  @Get('orders/:no/reviews')
  @ApiOperation({ summary: '이 주문에서 내가 쓴 리뷰' }) @ApiParam({ name: 'no' })
  @ApiOkResponse({ type: MyOrderReviewDto, isArray: true })
  mine(@Param('no') no: string) { return this.svc.myReviewsForOrder(no); }
}

/** 운영 — 리뷰 확인(보이기 · 가림) · 문의 답하기 · 가림 */
@ApiTags('HEALTH-ADMIN')
@ApiBearerAuth()
@Controller('api/v1/admin/health')
@Roles('ADMIN', 'SUPER')
export class HealthReviewAdminController {
  constructor(private readonly svc: HealthReviewService) {}

  @Get('reviews')
  @ApiOperation({ summary: '리뷰 — 운영 확인 대기(PENDING) · 보이는 것 · 가린 것' })
  @ApiQuery({ name: 'state', required: false, enum: ['PENDING', 'VISIBLE', 'HIDDEN'] })
  @ApiOkResponse({ type: AdminReviewRowDto, isArray: true })
  reviews(@Query('state') state?: string) { return this.svc.adminReviews(state); }

  @Post('reviews/:id/decide')
  @ApiOperation({ summary: '리뷰 보이기 · 가림(지우지 않음 · 가리면 쓴 사람에게 알림)' }) @ApiParam({ name: 'id' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto }) @ApiResponse({ status: 422, description: 'REASON_REQUIRED', type: ErrorDto })
  @ApiOkResponse({ type: ReviewResultDto })
  @Audit('HLT_REVIEW_DECIDE', 'HLT_REVIEW')
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDecideDto) { return this.svc.decideReview(id, dto.action, dto.reason); }

  @Get('qna')
  @ApiOperation({ summary: '상품 문의 — 답할 것(open=true) · 답한 것(open=false) · 전체' })
  @ApiQuery({ name: 'open', required: false, enum: ['true', 'false'] })
  @ApiOkResponse({ type: AdminQnaRowDto, isArray: true })
  qna(@Query('open') open?: string) { return this.svc.adminQna(open === 'true' ? true : open === 'false' ? false : undefined); }

  @Post('qna/:id/answer')
  @ApiOperation({ summary: '문의에 답하기(쓴 사람에게 알림)' }) @ApiParam({ name: 'id' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto }) @ApiResponse({ status: 422, description: 'TOO_SHORT', type: ErrorDto })
  @ApiOkResponse({ type: QnaResultDto })
  @Audit('HLT_QNA_ANSWER', 'HLT_QNA')
  answer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: QnaAnswerDto) { return this.svc.answer(id, dto.answer); }

  @Post('qna/:id/hide')
  @ApiOperation({ summary: '문의 가림(사유 필수)' }) @ApiParam({ name: 'id' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto }) @ApiResponse({ status: 422, description: 'REASON_REQUIRED', type: ErrorDto })
  @ApiOkResponse({ type: QnaResultDto })
  @Audit('HLT_QNA_HIDE', 'HLT_QNA')
  hide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: QnaHideDto) { return this.svc.hideQna(id, dto.reason); }
}

export class RankBlockDto {
  @ApiProperty({ description: '「최근 7일 판매 수량 기준」 등' }) basis!: string;
  @ApiPropertyOptional({ nullable: true }) from!: string | null; @ApiPropertyOptional({ nullable: true }) to!: string | null;
  @ApiPropertyOptional({ nullable: true }) madeAt!: string | null;
  @ApiProperty({ type: Object, isArray: true, description: '상품 카드 + rank · qty · orders' }) items!: object[];
}
export class RankingsDto { @ApiProperty({ type: RankBlockDto }) sales!: RankBlockDto; @ApiProperty({ type: RankBlockDto }) orders!: RankBlockDto; }

/** v10.28 (D037) — 소개몰 메인 순위(하루 1회 집계 · 기준 · 기간) */
@ApiTags('HEALTH')
@Controller('api/v1/health/rankings')
export class HealthRankController {
  constructor(private readonly svc: HealthReviewService) {}

  @Get()
  @ApiOperation({ summary: '소개몰 순위 — 오늘의 건강상품(최근 7일 판매 수량) · 많이 찾는 상품(최근 7일 주문 건수)', description: '어제까지 7일(한국 날짜) · 취소 · 반품 제외 · 판매 중 상품만 · 하루 1회 집계. 판매가 없으면 items 가 비어 있습니다.' })
  @ApiOkResponse({ type: RankingsDto })
  list() { return this.svc.rankings(); }
}
