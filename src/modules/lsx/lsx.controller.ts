import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { BUMP_MODES, EXPIRY_MONTHS, LsxSettingsInput, lsxSwitches, setLsxSettings } from './common';
import { addSaved, listSaved, removeSaved, savedStats, SAVED_AXES, SAVED_GWANS, updateSaved } from './saved';
import { adminExpiryList, adminGrace, adminSetExpiry, decideExtend, EXPIRY_VIEWS, expiryChoices, requestExtend } from './expiry';
import { ADMIN_BUMP_REASONS, adminBump, adminBumpList, bumpQuote, memberBump, refundBump } from './bump';
import { adminSummaryList, decideSummary, publicSummary, requestSummary, SUMMARY_STATES } from './summary';
import { lsxOverview, myListingTools } from './jobs';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * v10.513 ~ 516 (D276 · docs/651 ~ 654) ㊻ 매물 — 저장한 검색 · 만료 · 연장 · 끌어올리기 · AI 요약
 *   공개(로그인 없이 · 개인정보 없음)  GET /site/lsx/switches · GET /site/lsx/listings/{id}/summary
 *   회원                              GET · POST /me/saved-searches · PUT · DELETE /me/saved-searches/{id}
 *                                     GET /me/lsx/listings · GET /me/lsx/listings/{id}/bump-quote · POST /me/lsx/listings/{id}/bump · POST /me/lsx/listings/{id}/extend-request
 *   운영(검수 › 매물 만료 · 연장 · 끌어올리기 · 매물 AI 요약 · 저장한 검색)
 *                                     GET /admin/lsx/overview · PUT /admin/lsx/settings(SUPER)
 *                                     GET /admin/lsx/expiry · PUT /admin/lsx/expiry/{id} · POST /admin/lsx/expiry/grace(SUPER) · POST /admin/lsx/extend-requests/{id}/decide
 *                                     GET /admin/lsx/bumps · POST /admin/lsx/bumps · POST /admin/lsx/bump-payments/{id}/refund(SUPER)
 *                                     GET /admin/lsx/summaries · POST /admin/lsx/summaries/{id}/decide · POST /admin/lsx/summaries/request · GET /admin/lsx/saved-searches/stats
 *   검수 승인 때 만료일은 기존 PATCH /admin/reviews/{id} 의 expiryMonths · expiresOn 칸(없으면 기본 6개월)
 *   세무사(ACCOUNTANT)는 /admin/acct/ 밖이라 보지 않음(끌어올리기 결제 전표는 회계 › 전표에서 봄)
 * ------------------------------------------------------------------- */

const MEMBER = ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'] as const;
const me = () => RequestCtx.actorId()!;

export class LsxSavedCreateDto {
  @ApiPropertyOptional({ maxLength: 40, example: '강남 카페 양도' }) @IsOptional() @IsString() @MaxLength(40) name?: string;
  @ApiPropertyOptional({ example: 'MNY', description: `관 코드(${SAVED_GWANS.join(' · ')} · 새 관)` }) @IsOptional() @Matches(/^[A-Z]{3,4}$/, { message: '관 코드는 영문 대문자 3 ~ 4자입니다.' }) gwanCode?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) categoryId?: string;
  @ApiPropertyOptional({ minLength: 2, maxLength: 60, example: '카페 양도' }) @IsOptional() @IsString() @Length(2, 60) keyword?: string;
  @ApiPropertyOptional({ example: '11', description: '시 · 도 코드(regions)' }) @IsOptional() @IsString() @Matches(/^[0-9A-Z]{2,10}$/) regionCode?: string;
  @ApiPropertyOptional({ enum: SAVED_AXES }) @IsOptional() @IsIn(SAVED_AXES as unknown as string[]) axis?: string;
  @ApiPropertyOptional({ example: true, description: '새 매물 하루 묶음 알림(처음 켬)' }) @IsOptional() @StrictBoolean() notify?: boolean;
}
export class LsxSavedUpdateDto {
  @ApiPropertyOptional({ maxLength: 40 }) @IsOptional() @IsString() @Length(1, 40) name?: string;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() notify?: boolean;
}
export class LsxBumpDto {
  @ApiPropertyOptional({ description: 'PAID 방식 — 결제창이 준 결제 키(시험 결제는 stub_…)' }) @IsOptional() @IsString() @Length(1, 200) paymentKey?: string;
  @ApiPropertyOptional({ example: 'lsx-0a1b2c3d4e5f6a7b8c9d0e1f' }) @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{6,64}$/) orderId?: string;
  @ApiPropertyOptional({ example: 3300, description: '결제 금액(공급가 + 부가세) — 서버 금액과 다르면 422' }) @IsOptional() @IsInt() @Min(1) @Max(1100000) amount?: number;
}
export class LsxExtendRequestDto {
  @ApiProperty({ enum: EXPIRY_MONTHS }) @IsInt() @IsIn(EXPIRY_MONTHS as unknown as number[]) months!: number;
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) note?: string;
}
export class LsxSettingsDto {
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() savedSearch?: boolean;
  @ApiPropertyOptional({ example: 10 }) @IsOptional() @IsInt() @Min(1) @Max(10) savedSearchMax?: number;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() expiry?: boolean;
  @ApiPropertyOptional({ example: 6 }) @IsOptional() @IsInt() @Min(1) @Max(24) expiryDefaultMonths?: number;
  @ApiPropertyOptional({ example: 7 }) @IsOptional() @IsInt() @Min(1) @Max(30) expiryWarnDays?: number;
  @ApiPropertyOptional({ enum: BUMP_MODES }) @IsOptional() @IsIn(BUMP_MODES as unknown as string[]) bumpMode?: string;
  @ApiPropertyOptional({ example: 3 }) @IsOptional() @IsInt() @Min(1) @Max(30) bumpFreeCount?: number;
  @ApiPropertyOptional({ example: 30 }) @IsOptional() @IsInt() @Min(1) @Max(90) bumpPeriodDays?: number;
  @ApiPropertyOptional({ example: 24 }) @IsOptional() @IsInt() @Min(1) @Max(720) bumpMinHours?: number;
  @ApiPropertyOptional({ example: 3000, description: '1회 금액(공급가 · 원) — 0 이면 정하지 않음' }) @IsOptional() @IsInt() @Min(0) @Max(1000000) bumpPrice?: number;
  @ApiPropertyOptional({ example: 72 }) @IsOptional() @IsInt() @Min(1) @Max(168) bumpEffectHours?: number;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() aiSummary?: boolean;
  @ApiPropertyOptional({ example: '' }) @IsOptional() @IsString() @Matches(/^(|[a-z0-9][a-z0-9.-]{2,59})$/) aiSummaryModel?: string;
  @ApiPropertyOptional({ example: 10 }) @IsOptional() @IsInt() @Min(1) @Max(30) aiSummaryBatch?: number;
  @ApiProperty({ example: '대표 결정 — 끌어올리기 무료로 시작' }) @IsString() @Length(2, 200) reason!: string;
}
export class LsxSetExpiryDto {
  @ApiPropertyOptional({ enum: EXPIRY_MONTHS, description: '지금 만료일(지났으면 오늘)부터 더할 개월' }) @IsOptional() @IsInt() @IsIn(EXPIRY_MONTHS as unknown as number[]) months?: number;
  @ApiPropertyOptional({ example: '2027-05-31', description: '직접 날짜(그 날 끝까지 · 36개월 안)' }) @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) expiresOn?: string;
  @ApiProperty({ example: '대표 요청 — 행사 기간까지 연장' }) @IsString() @Length(2, 300) reason!: string;
  @ApiPropertyOptional({ description: '만료로 내린 매물을 다시 게시' }) @IsOptional() @StrictBoolean() restore?: boolean;
}
export class LsxGraceDto {
  @ApiProperty({ example: 30, description: '지났거나 그 안에 끝나는 게시 매물을 오늘 + N일로' }) @IsInt() @Min(1) @Max(90) days!: number;
  @ApiProperty({ example: '만료 스위치 켜기 전 유예' }) @IsString() @Length(2, 300) reason!: string;
}
export class LsxExtendDecideDto {
  @ApiProperty() @StrictBoolean() approve!: boolean;
  @ApiPropertyOptional({ enum: EXPIRY_MONTHS, description: '없으면 회원이 요청한 개월' }) @IsOptional() @IsInt() @IsIn(EXPIRY_MONTHS as unknown as number[]) months?: number;
  @ApiPropertyOptional({ example: '2027-05-31' }) @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) expiresOn?: string;
  @ApiProperty({ example: '계속 거래 중 확인' }) @IsString() @Length(2, 300) reason!: string;
}
export class LsxAdminBumpDto {
  @ApiProperty({ format: 'uuid' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) listingId!: string;
  @ApiProperty({ enum: ADMIN_BUMP_REASONS, description: 'FIX_ERROR 오류 바로잡기 · MEMBER_REQUEST 회원 요청 대신 — 그 밖은 막음(대표 결정 11/20)' }) @IsIn(ADMIN_BUMP_REASONS as unknown as string[]) reasonKind!: string;
  @ApiProperty({ example: '시스템 오류로 내려간 자리 되돌림' }) @IsString() @Length(2, 300) reason!: string;
}
export class LsxRefundDto {
  @ApiProperty({ example: '중복 결제 — 고객센터 문의 1234' }) @IsString() @Length(2, 300) reason!: string;
}
export class LsxSummaryDecideDto {
  @ApiProperty() @StrictBoolean() approve!: boolean;
  @ApiPropertyOptional({ type: [String], description: '고친 3줄(줄마다 80자까지)' }) @IsOptional() @IsArray() @ArrayMinSize(3) @ArrayMaxSize(3) @IsString({ each: true }) @MaxLength(80, { each: true }) lines?: string[];
  @ApiPropertyOptional({ maxLength: 300, description: '반려 때 필수' }) @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
export class LsxSummaryRequestDto {
  @ApiProperty({ format: 'uuid' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) listingId!: string;
}

@ApiTags('LSX')
@ApiBearerAuth()
@Controller('api/v1')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class LsxController {
  constructor(private readonly db: DatabaseService) {}

  /* ── 공개 ── */
  @Get('site/lsx/switches')
  @ApiOperation({ summary: '매물 기능 스위치 (v10.513 ~ 516)', description: '저장한 검색 · 만료 · 끌어올리기 방식 · AI 요약이 켜져 있는지. 금액 · 개인정보 없음.' })
  @ApiOkResponse({ type: Object })
  switches() { return lsxSwitches(this.db); }

  @Get('site/lsx/listings/:id/summary')
  @ApiOperation({ summary: '매물 AI 요약 (v10.516)', description: '운영자가 승인한 3줄 요약 — 매물 판이 같을 때 · 스위치가 켜져 있을 때만. 없으면 lines=null.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  summary(@Param('id') id: string) { return publicSummary(this.db, id); }

  /* ── v10.513 저장한 검색 ── */
  @Get('me/saved-searches')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '저장한 검색 (v10.513)', description: '내가 저장한 매물 검색 조건 · 최대 개수 · 스위치.' })
  @ApiOkResponse({ type: Object })
  savedList() { return listSaved(this.db, me()); }

  @Post('me/saved-searches')
  @HttpCode(200)
  @Roles(...MEMBER)
  @ApiOperation({ summary: '검색 저장 (v10.513)', description: '관 · 업종 · 검색어 · 지역 · 축 중 하나 이상 · 사람마다 lsx.saved_search_max(10)개 · 새 매물 하루 묶음 알림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'LSX_SAVED_DUP', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LSX_OFF · LSX_SAVED_MAX · LSX_SAVED_EMPTY · LSX_SAVED_FIELD', type: ErrorDto })
  savedAdd(@Body() dto: LsxSavedCreateDto) { return addSaved(this.db, me(), dto); }

  @Put('me/saved-searches/:id')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '저장한 검색 이름 · 알림 바꾸기 (v10.513)' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 검색', type: ErrorDto })
  @ApiResponse({ status: 409, description: '없음(쓰지 않음)', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LSX_OFF · LSX_SAVED_FIELD · LSX_NOTHING', type: ErrorDto })
  savedUpdate(@Param('id', ParseIntPipe) id: number, @Body() dto: LsxSavedUpdateDto) { return updateSaved(this.db, me(), id, { name: dto.name, notify: dto.notify }); }

  @Delete('me/saved-searches/:id')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '저장한 검색 지우기 (v10.513)' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 검색', type: ErrorDto })
  savedRemove(@Param('id', ParseIntPipe) id: number) { return removeSaved(this.db, me(), id); }

  /* ── v10.514 · 515 · 516 매물 관리 도구 ── */
  @Get('me/lsx/listings')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '매물 관리 도구 (v10.514 ~ 516)', description: '노출 중 · 만료로 내린 내 매물 — 만료일 · 남은 날 · 연장 요청 · 끌어올리기 효과 · 승인한 AI 요약.' })
  @ApiOkResponse({ type: Object })
  tools() { return myListingTools(this.db, me()); }

  @Get('me/lsx/listings/:id/bump-quote')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '끌어올리기 값 (v10.515)', description: '방식 · 남은 무료 횟수 · 1회 금액(부가세 포함) · 다음 가능 시각.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 매물 · 남의 매물', type: ErrorDto })
  quote(@Param('id') id: string) { return bumpQuote(this.db, me(), id); }

  @Post('me/lsx/listings/:id/bump')
  @HttpCode(200)
  @Roles(...MEMBER)
  @ApiOperation({ summary: '끌어올리기 (v10.515)', description: 'FREE — 무료 횟수 · 간격 안에서. PAID — 결제(paymentKey · orderId · amount) 승인 뒤에만. 노출 가산은 방식과 상관없이 같은 상한(lsx.bump_effect_hours).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 매물 · 남의 매물', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'LSX_NOT_PUBLISHED · LSX_BUMP_TOO_SOON · LSX_BUMP_PRIORITY · LSX_BUMP_PRICE_UNSET · PAYMENT_KEY_USED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LSX_OFF · LSX_BUMP_FREE_USED · LSX_BUMP_PAYMENT_REQUIRED · LSX_AMOUNT_MISMATCH · PAYMENT_FAILED · PAYMENT_UNCERTAIN', type: ErrorDto })
  @Audit('LSX_BUMP', 'LISTING')
  bump(@Param('id') id: string, @Body() dto: LsxBumpDto) { return memberBump(this.db, me(), id, { paymentKey: dto.paymentKey, orderId: dto.orderId, amount: dto.amount }); }

  @Post('me/lsx/listings/:id/extend-request')
  @HttpCode(200)
  @Roles(...MEMBER)
  @ApiOperation({ summary: '매물 연장 요청 (v10.514)', description: '연장은 운영자만 — 회원은 요청만(매물마다 열린 요청 하나). 노출 중이거나 만료로 내린 매물.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 매물 · 남의 매물', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'LSX_EXTEND_OPEN · LSX_EXTEND_STATE · LSX_NO_EXPIRY', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LSX_EXPIRY_RANGE', type: ErrorDto })
  extendRequest(@Param('id') id: string, @Body() dto: LsxExtendRequestDto) { return requestExtend(this.db, me(), id, { months: dto.months, note: dto.note }); }

  /* ── 운영 ── */
  @Get('admin/lsx/overview')
  @Roles('ADMIN', 'SUPER', 'REVIEWER')
  @ApiOperation({ summary: '매물 기능 한눈에 (v10.513 ~ 516)', description: '설정 · 저장한 검색 숫자 · 만료 임박 · 지남 · 연장 요청 · 끌어올리기 · AI 요약 초안 수 · 승인 칸 기본 개월.' })
  @ApiOkResponse({ type: Object })
  async overview() { return { ...(await lsxOverview(this.db)), choices: await expiryChoices(this.db) }; }

  @Put('admin/lsx/settings')
  @Roles('SUPER')
  @ApiOperation({ summary: '매물 기능 설정 (v10.513 ~ 516 · SUPER)', description: '스위치 · 개수 · 기간 · 끌어올리기 방식(OFF · FREE · PAID) · 금액 · 효과 시간 · AI 요약 — 사유는 「전체 설정」 바뀐 기록에 남음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: '없음(쓰지 않음)', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LSX_REASON · LSX_SETTING_VALUE · LSX_NOTHING · LSX_BUMP_PRICE_UNSET', type: ErrorDto })
  @Audit('LSX_SETTINGS', 'SITE_SETTING')
  settings(@Body() dto: LsxSettingsDto) {
    const d: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto)) if (v !== undefined) d[k] = v;   // 규칙 11 — 안 보낸 칸은 덮지 않음
    return setLsxSettings(this.db, d as LsxSettingsInput);
  }

  @Get('admin/lsx/expiry')
  @Roles('ADMIN', 'SUPER', 'REVIEWER')
  @ApiOperation({ summary: '매물 만료 목록 (v10.514)', description: 'SOON 예고 기간 안 · PAST 날짜 지났는데 게시 중(스위치 꺼짐) · EXPIRED 만료로 내림 · REQUESTS 연장 요청 · ALL.' })
  @ApiQuery({ name: 'view', enum: EXPIRY_VIEWS, required: false })
  @ApiQuery({ name: 'q', required: false, description: '매물 제목' })
  @ApiOkResponse({ type: Object })
  expiryList(@Query('view') view?: string, @Query('q') q?: string) { return adminExpiryList(this.db, view, q); }

  @Put('admin/lsx/expiry/:id')
  @Roles('ADMIN', 'SUPER', 'REVIEWER')
  @ApiOperation({ summary: '만료일 바꾸기 (v10.514)', description: '연장은 운영자만 — 개월(지금 만료일부터) 또는 직접 날짜 · 사유 · 감사. 만료로 내린 매물은 restore — 만료 뒤(또는 연장 요청 뒤) 내용이 바뀌었으면 검수 대기(queued) · 그대로면 바로 게시(대표 결정 11/20).' })
  @ApiParam({ name: 'id', format: 'uuid', description: '매물 번호' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 매물', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'LSX_NOT_EXPIRED · LSX_EXPIRY_STATE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LSX_EXPIRY_RANGE · LSX_REASON', type: ErrorDto })
  @Audit('LSX_EXPIRY_SET', 'LISTING')
  setExpiry(@Param('id') id: string, @Body() dto: LsxSetExpiryDto) {
    return adminSetExpiry(this.db, id, me(), { months: dto.months, expiresOn: dto.expiresOn, reason: dto.reason, restore: dto.restore })
      .then(({ owner: _o, ...r }) => r);
  }

  @Post('admin/lsx/expiry/grace')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '지난 만료일 한꺼번에 유예 (v10.514 · SUPER)', description: '스위치를 처음 켜기 전 — 지났거나 N일 안에 끝나는 게시 매물을 오늘 + N일로(한꺼번에 내려가지 않게).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: '없음(쓰지 않음)', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LSX_EXPIRY_RANGE · LSX_REASON', type: ErrorDto })
  @Audit('LSX_EXPIRY_GRACE', 'LISTING')
  grace(@Body() dto: LsxGraceDto) { return adminGrace(this.db, me(), { days: dto.days, reason: dto.reason }); }

  @Post('admin/lsx/extend-requests/:id/decide')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER', 'REVIEWER')
  @ApiOperation({ summary: '연장 요청 승인 · 반려 (v10.514)', description: '승인 — 요청 개월(또는 고친 개월 · 날짜) · 만료로 내린 매물은 다시 게시 · 회원 알림. 반려 — 사유 · 회원 알림.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 요청', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'LSX_EXTEND_DONE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LSX_EXPIRY_RANGE · LSX_REASON · LSX_DECIDE', type: ErrorDto })
  @Audit('LSX_EXTEND_DECIDE', 'LSX_EXTEND_REQUEST')
  extendDecide(@Param('id', ParseIntPipe) id: number, @Body() dto: LsxExtendDecideDto) {
    return decideExtend(this.db, me(), id, { approve: dto.approve, months: dto.months, expiresOn: dto.expiresOn, reason: dto.reason });
  }

  @Get('admin/lsx/bumps')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '끌어올리기 기록 (v10.515)', description: '설정 · 최근 100건(무료 · 유료 · 운영) · 결제 · 지금 효과 중.' })
  @ApiOkResponse({ type: Object })
  bumps() { return adminBumpList(this.db); }

  @Post('admin/lsx/bumps')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '운영 끌어올리기 — 바로잡기용 (v10.515 · SUPER)', description: '대표 결정 11/20 — SUPER 만 · 사유 종류 FIX_ERROR(오류 바로잡기) · MEMBER_REQUEST(회원 요청 대신) + 글 사유 · 감사 · 같은 상한 · 감쇠 · 목록에 「끌어올림」 표시. 방식이 OFF 여도 됨.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 매물', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'LSX_NOT_PUBLISHED · LSX_BUMP_PRIORITY', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LSX_REASON · LSX_ADMIN_BUMP_REASON · LSX_ADMIN_BUMP_SUPER', type: ErrorDto })
  @Audit('LSX_ADMIN_BUMP', 'LISTING')
  adminBump(@Body() dto: LsxAdminBumpDto) { return adminBump(this.db, me(), { listingId: dto.listingId, reasonKind: dto.reasonKind, reason: dto.reason }); }

  @Post('admin/lsx/bump-payments/:id/refund')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '끌어올리기 결제 환불 (v10.515 · SUPER)', description: '결제 오류 · 중복 결제 등 예외 — 사유 · 결제사 취소(시험 결제는 표시만) · 그 결제의 효과 끝냄 · 전표 LSX_BUMP_REFUND.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 결제', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'LSX_REFUNDED · LSX_REFUND_UNCERTAIN', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LSX_REASON · LSX_REFUND_FAILED', type: ErrorDto })
  @Audit('LSX_BUMP_REFUND', 'LSX_BUMP_PAYMENT')
  refund(@Param('id', ParseIntPipe) id: number, @Body() dto: LsxRefundDto) { return refundBump(this.db, me(), id, { reason: dto.reason }); }

  @Get('admin/lsx/summaries')
  @Roles('ADMIN', 'SUPER', 'REVIEWER')
  @ApiOperation({ summary: '매물 AI 요약 목록 (v10.516)', description: '초안(DRAFT) · 승인 · 반려 · 실패 · 줄 선 것 — 매물 글 앞부분과 나란히.' })
  @ApiQuery({ name: 'state', enum: SUMMARY_STATES, required: false })
  @ApiOkResponse({ type: Object })
  summaries(@Query('state') state?: string) { return adminSummaryList(this.db, state); }

  @Post('admin/lsx/summaries/:id/decide')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER', 'REVIEWER')
  @ApiOperation({ summary: '매물 AI 요약 승인 · 반려 (v10.516)', description: '승인 — 고친 3줄 가능 · 그 매물 판이 같을 때만 공개. 반려 — 사유. AI 는 공개를 정하지 않음.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 요약', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'LSX_SUMMARY_STATE · LSX_SUMMARY_OLD', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LSX_SUMMARY_LINES · LSX_REASON · LSX_DECIDE', type: ErrorDto })
  @Audit('LSX_SUMMARY_DECIDE', 'LSX_AI_SUMMARY')
  summaryDecide(@Param('id', ParseIntPipe) id: number, @Body() dto: LsxSummaryDecideDto) {
    return decideSummary(this.db, me(), id, { approve: dto.approve, lines: dto.lines, reason: dto.reason });
  }

  @Post('admin/lsx/summaries/request')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER', 'REVIEWER')
  @ApiOperation({ summary: '매물 AI 요약 다시 만들기 (v10.516)', description: '그 매물 지금 판의 요약을 내려 두고 줄 세움 — 다음 매시간 작업(AI 스위치 · 월 상한 안에서).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 매물', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'LSX_NOT_PUBLISHED · LSX_SUMMARY_BUSY', type: ErrorDto })
  @ApiResponse({ status: 422, description: '없음(쓰지 않음)', type: ErrorDto })
  @Audit('LSX_SUMMARY_REQUEST', 'LISTING')
  summaryRequest(@Body() dto: LsxSummaryRequestDto) { return requestSummary(this.db, me(), { listingId: dto.listingId }); }

  @Get('admin/lsx/saved-searches/stats')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '저장한 검색 숫자 (v10.513)', description: '모은 숫자만 — 누가 무엇을 저장했는지 보이지 않음 · 검색어는 3명 이상이 저장한 것만.' })
  @ApiOkResponse({ type: Object })
  savedStats() { return savedStats(this.db); }
}
