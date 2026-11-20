import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { IntegrationSecretService } from '../../common/integration/secret.service';
import { ExportGate } from './export-approval';
import { keyLifeList, markRotated, setKeyLife } from './its-keys';
import { ASSET_CYCLES, ASSET_KINDS, cancelAsset, createAsset, listAssets, updateAsset } from './its-assets';
import { RECEIPT_RE, SUGGEST_CATEGORIES, SUGGEST_STATES, decideSuggestion, lookupSuggestion, mySuggestions, reviewList, submitSuggestion, suggestionDetail } from './its-suggest';
import { SURVEY_QTYPES, SURVEY_ROLES, answerSurvey, createSurvey, listSurveys, moveSurvey, mySurveys, surveyDetail, surveyExport, surveyForm, surveyResults, updateSurvey } from './its-survey';
import type { Viewer } from './its-survey';

/* ---------------------------------------------------------------------
 * ㊵ 사무 · 보안 (D270 · docs/628 ~ 631) — 대표 11/20
 *   v10.490  SUPER  GET  /admin/integration-keys/life                         연동 키 만료 · 교체(값 · 끝 4자리 없음)
 *                   PUT  /admin/integration-keys/life/{code}/{name}           만료일 · 교체 주기 · 담당 메모
 *                   POST /admin/integration-keys/life/{code}/{name}/rotated   화면 밖(.env)에서 바꾼 것을 「바꿨음」
 *   v10.491  ADMIN · PAYOUT  GET · POST /admin/its/assets · PUT /admin/its/assets/{id} · POST /admin/its/assets/{id}/cancel
 *   v10.492  운영 계정  POST /admin/its/suggestions(익명 가능 · 감사 기록 없음) · GET /admin/its/suggestions/mine · POST /admin/its/suggestions/lookup
 *            ADMIN      GET /admin/its/suggestions · GET /admin/its/suggestions/{id} · POST /admin/its/suggestions/{id}/decide
 *   v10.493  ADMIN      GET · POST /admin/its/surveys · GET · PUT /admin/its/surveys/{id} · POST …/{id}/open · close · cancel · GET …/{id}/results · …/{id}/export(내려받기 승인)
 *            운영 계정  GET /admin/its/my-surveys · GET /admin/its/my-surveys/{id} · POST /admin/its/my-surveys/{id}/answer(감사 기록 없음)
 *   세무사(ACCOUNTANT) 빠짐 — /admin/acct/ 아래가 아니라 세무사 읽기 규칙에 들지 않음(SUPER 는 늘 통과).
 *   ★ 익명 제안 · 설문 답 넣기에는 @Audit 를 붙이지 않음 — 감사 기록에 누가 · 언제가 남으면 익명이 아님(docs/630 · 631).
 * ------------------------------------------------------------------- */

const SELF = ['ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'] as const;   // SUPER 는 늘 통과 · 세무사 빠짐
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ItsKeyLifeSetDto {
  @ApiPropertyOptional({ example: '2027-03-31', nullable: true, description: '키 만료일 — null 이면 비움 · 안 보내면 그대로' }) @IsOptional() @IsString() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) expiresOn?: string | null;
  @ApiPropertyOptional({ example: 90, nullable: true, description: '교체 주기(일 · 7 ~ 1095) — null 이면 없음' }) @IsOptional() @IsInt() @Min(7) @Max(1095) rotateDays?: number | null;
  @ApiPropertyOptional({ example: '토스 콘솔 · 재무팀 김 대리', nullable: true, description: '담당 · 어디서 다시 받는지(200자 · 키 값을 적지 마십시오)' }) @IsOptional() @IsString() @Length(0, 200) ownerNote?: string | null;
}
export class ItsKeyRotatedDto {
  @ApiPropertyOptional({ example: '.env 교체 · 서버 다시 띄움' }) @IsOptional() @IsString() @Length(0, 200) note?: string | null;
  @ApiPropertyOptional({ example: '2028-03-31', description: '새 키 만료일(있으면)' }) @IsOptional() @IsString() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) expiresOn?: string | null;
}
export class ItsAssetNewDto {
  @ApiProperty({ enum: ASSET_KINDS }) @IsIn(ASSET_KINDS as unknown as string[]) kind!: string;
  @ApiProperty({ example: 'Google Workspace' }) @IsString() @Length(2, 80) name!: string;
  @ApiPropertyOptional({ example: 'Google' }) @IsOptional() @IsString() @Length(0, 80) vendor?: string | null;
  @ApiPropertyOptional({ example: 'IT-2026-001', description: '자산 번호(영문 · 숫자 · - · _ 40자)' }) @IsOptional() @IsString() @Matches(/^([A-Za-z0-9][A-Za-z0-9_-]{0,39})?$/) assetTag?: string | null;
  @ApiPropertyOptional({ example: 10 }) @IsOptional() @IsInt() @Min(0) @Max(100000) seats?: number;
  @ApiPropertyOptional({ example: 7 }) @IsOptional() @IsInt() @Min(0) @Max(100000) seatsUsed?: number;
  @ApiPropertyOptional({ format: 'uuid', description: '담당(운영 계정)' }) @IsOptional() @IsString() @Matches(/^([0-9a-fA-F-]{36})?$/) ownerId?: string | null;
  @ApiPropertyOptional({ enum: ASSET_CYCLES }) @IsOptional() @IsIn(ASSET_CYCLES as unknown as string[]) billingCycle?: string;
  @ApiPropertyOptional({ example: 168000, description: '한 번 금액(원 · 부가세 포함 · 외화는 원으로)' }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) costAmount?: number;
  @ApiPropertyOptional({ example: '2026-12-01', description: '다음 갱신(결제)일 — 매달 · 매년은 꼭' }) @IsOptional() @IsString() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) renewOn?: string | null;
  @ApiPropertyOptional({ description: '자동 갱신(처음 켬)' }) @IsOptional() @IsBoolean() autoRenew?: boolean;
  @ApiPropertyOptional({ description: '자금 흐름 예정에 넣기(처음 켬)' }) @IsOptional() @IsBoolean() cashPlan?: boolean;
  @ApiPropertyOptional({ example: '관리자 계정 2개 포함' }) @IsOptional() @IsString() @Length(0, 400) memo?: string | null;
}
export class ItsAssetEditDto {
  @ApiPropertyOptional({ example: 'Google Workspace Business' }) @IsOptional() @IsString() @Length(2, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 80) vendor?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^([A-Za-z0-9][A-Za-z0-9_-]{0,39})?$/) assetTag?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) seats?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) seatsUsed?: number;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsString() @Matches(/^([0-9a-fA-F-]{36})?$/) ownerId?: string | null;
  @ApiPropertyOptional({ enum: ASSET_CYCLES }) @IsOptional() @IsIn(ASSET_CYCLES as unknown as string[]) billingCycle?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) costAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) renewOn?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoRenew?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() cashPlan?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 400) memo?: string | null;
}
export class ItsAssetCancelDto {
  @ApiProperty({ example: '다른 도구로 옮김' }) @IsString() @Length(2, 200) reason!: string;
}
export class ItsSuggestNewDto {
  @ApiProperty({ enum: SUGGEST_CATEGORIES }) @IsIn(SUGGEST_CATEGORIES as unknown as string[]) category!: string;
  @ApiProperty({ example: '회의실 예약을 캘린더로' }) @IsString() @Length(2, 100) title!: string;
  @ApiProperty({ example: '지금은 메신저로 묻고 있어 겹치는 일이 잦습니다 …' }) @IsString() @Length(10, 3000) body!: string;
  @ApiPropertyOptional({ description: 'true 면 익명 — 쓴 사람 · 시각을 저장하지 않음 · 접수 번호를 한 번만 돌려줌' }) @IsOptional() @IsBoolean() anonymous?: boolean;
}
export class ItsSuggestLookupDto {
  @ApiProperty({ example: 'ABCD-EFGH-JKLM' }) @IsString() @Matches(RECEIPT_RE) code!: string;
}
export class ItsSuggestDecideDto {
  @ApiProperty({ enum: SUGGEST_STATES, description: 'REVIEWING 검토 중 · ADOPTED 채택 · DECLINED 반영 안 함 · DONE 실행 끝 · RECEIVED 접수로 되돌림' }) @IsIn(SUGGEST_STATES as unknown as string[]) to!: string;
  @ApiPropertyOptional({ example: '다음 달부터 사내 일정에 회의실 칸을 둡니다.' }) @IsOptional() @IsString() @Length(0, 2000) answer?: string | null;
}
export class ItsSurveyQuestionDto {
  @ApiProperty({ enum: SURVEY_QTYPES }) @IsIn(SURVEY_QTYPES as unknown as string[]) type!: string;
  @ApiProperty({ example: '지금 업무 도구에 얼마나 만족하십니까?' }) @IsString() @Length(2, 300) body!: string;
  @ApiPropertyOptional({ type: [String], description: '하나 · 여럿 고르기 보기 2 ~ 12개' }) @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) options?: string[];
  @ApiPropertyOptional({ example: 5, description: '점수 질문의 가장 큰 점수(3 ~ 10)' }) @IsOptional() @IsInt() @Min(3) @Max(10) scaleMax?: number | null;
  @ApiPropertyOptional({ description: '꼭 답할 질문(처음 켬)' }) @IsOptional() @IsBoolean() required?: boolean;
}
export class ItsSurveyNewDto {
  @ApiProperty({ example: '2026 하반기 업무 환경 설문' }) @IsString() @Length(2, 100) title!: string;
  @ApiPropertyOptional({ example: '5분이면 끝납니다.' }) @IsOptional() @IsString() @Length(0, 1000) intro?: string | null;
  @ApiPropertyOptional({ description: '익명(처음 켬) — 답에 계정을 저장하지 않음' }) @IsOptional() @IsBoolean() anonymous?: boolean;
  @ApiPropertyOptional({ type: [String], enum: SURVEY_ROLES, description: '대상 역할(비우면 운영 계정 모두)' }) @IsOptional() @IsArray() @ArrayMaxSize(6) @IsIn(SURVEY_ROLES as unknown as string[], { each: true }) audience?: string[];
  @ApiProperty({ example: '2026-11-23' }) @Matches(YMD_RE) opensOn!: string;
  @ApiProperty({ example: '2026-12-04' }) @Matches(YMD_RE) closesOn!: string;
  @ApiProperty({ type: ItsSurveyQuestionDto, isArray: true, description: '질문 1 ~ 30개' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ItsSurveyQuestionDto) questions!: ItsSurveyQuestionDto[];
}
export class ItsSurveyEditDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 100) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) intro?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() anonymous?: boolean;
  @ApiPropertyOptional({ type: [String], enum: SURVEY_ROLES }) @IsOptional() @IsArray() @ArrayMaxSize(6) @IsIn(SURVEY_ROLES as unknown as string[], { each: true }) audience?: string[];
  @ApiPropertyOptional({ example: '2026-11-23' }) @IsOptional() @Matches(YMD_RE) opensOn?: string;
  @ApiPropertyOptional({ example: '2026-12-11', description: '받는 중이면 이것만(늦추기)' }) @IsOptional() @Matches(YMD_RE) closesOn?: string;
  @ApiPropertyOptional({ type: ItsSurveyQuestionDto, isArray: true, description: '보내면 질문을 이 목록으로 바꿈(고치는 중만)' })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ItsSurveyQuestionDto) questions?: ItsSurveyQuestionDto[];
}
export class ItsSurveyCancelDto {
  @ApiProperty({ example: '질문을 다시 짭니다' }) @IsString() @Length(2, 200) reason!: string;
}
export class ItsSurveyAnswerDto {
  @ApiProperty({ description: '{ 질문 번호: 답 } — 하나 고르기 = 보기 순번(0 부터) · 여럿 = 순번 목록 · 점수 = 1 ~ N · 글 = 1000자', example: { '12': 0, '13': [0, 2], '14': 4, '15': '좋습니다' } })
  @IsObject() answers!: Record<string, unknown>;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class ItsController {
  constructor(private readonly db: DatabaseService, private readonly secrets: IntegrationSecretService) {}

  private async me(): Promise<Viewer> {
    const id = RequestCtx.actorId() ?? '';
    const roles = id ? (await this.db.query<{ role: string }>(`SELECT role FROM account_roles WHERE account_id = $1::uuid`, [id])).map((r) => r.role) : [];
    return { id, roles };
  }

  /* ── v10.490 외부 연동 키 만료 · 교체(SUPER) ── */
  @Get('integration-keys/life')
  @Roles('SUPER')
  @ApiOperation({ summary: '연동 키 만료 · 교체 (v10.490)', description: '키마다 만료일 · 교체 주기 · 마지막 교체 · 다음 기한 · 남은 날 — 키 값 · 끝 4자리는 내보내지 않습니다.' })
  @ApiOkResponse({ type: Object })
  keyLife() { return keyLifeList(this.db, this.secrets); }

  @Put('integration-keys/life/:code/:name')
  @Roles('SUPER')
  @Audit('ITS_KEY_LIFE_SET', 'INTEGRATION')
  @ApiParam({ name: 'code', example: 'PG' }) @ApiParam({ name: 'name', example: 'TOSS_SECRET_KEY' })
  @ApiOperation({ summary: '연동 키 만료일 · 교체 주기 (v10.490)', description: '보낸 칸만 바꿈(null = 비움) · 저장 뒤 알림을 바로 다시 셈.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 없는 키 이름' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ITS_KEY_DATE · ITS_KEY_CYCLE · ITS_KEY_NOTE' })
  setLife(@Param('code') code: string, @Param('name') name: string, @Body() dto: ItsKeyLifeSetDto) {
    return setKeyLife(this.db, code, name, { expiresOn: dto.expiresOn, rotateDays: dto.rotateDays, ownerNote: dto.ownerNote }, RequestCtx.actorId() ?? null);
  }

  @Post('integration-keys/life/:code/:name/rotated')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ITS_KEY_ROTATED', 'INTEGRATION')
  @ApiParam({ name: 'code', example: 'MAIL' }) @ApiParam({ name: 'name', example: 'SMTP_PASS' })
  @ApiOperation({ summary: '연동 키 「바꿨음」 (v10.490)', description: '.env 등 화면 밖에서 바꾼 키 — 마지막 교체를 지금으로 · 새 만료일(있으면).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ITS_KEY_DATE' })
  rotated(@Param('code') code: string, @Param('name') name: string, @Body() dto: ItsKeyRotatedDto) {
    return markRotated(this.db, code, name, { note: dto.note, expiresOn: dto.expiresOn }, RequestCtx.actorId() ?? null);
  }

  /* ── v10.491 IT 자산 · SaaS 구독 ── */
  @Get('its/assets')
  @Roles('ADMIN', 'PAYOUT')
  @ApiQuery({ name: 'state', required: false, enum: ['ACTIVE', 'CANCELED', 'ALL'] })
  @ApiOperation({ summary: 'IT 자산 · 구독 목록 (v10.491)', description: '라이선스 수 · 담당 · 갱신일 · 달 비용 합 · 자금 흐름 예정 연결.' })
  @ApiOkResponse({ type: Object })
  assets(@Query('state') state?: string) { return listAssets(this.db, state); }

  @Post('its/assets')
  @Roles('ADMIN', 'PAYOUT')
  @HttpCode(200)
  @Audit('ITS_ASSET_ADD', 'SETTING')
  @ApiOperation({ summary: 'IT 자산 넣기 (v10.491)', description: '「자금 계획에 넣기」면 자금 흐름 예정(나감)을 함께 만듦.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'DUPLICATE — 같은 자산 번호' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ITS_ASSET_KIND · NAME · TAG · SEATS · CYCLE · COST · DATE · MEMO · OWNER' })
  addAsset(@Body() dto: ItsAssetNewDto) { return createAsset(this.db, dto, RequestCtx.actorId() ?? null); }

  @Put('its/assets/:id')
  @Roles('ADMIN', 'PAYOUT')
  @Audit('ITS_ASSET_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: 'IT 자산 고치기 (v10.491)', description: '보낸 칸만 · 금액 · 주기 · 갱신일이 바뀌면 옛 예정은 취소하고 새로 넣음 · 해지한 것 409.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ITS_ASSET_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ITS_ASSET_*' })
  editAsset(@Param('id') id: string, @Body() dto: ItsAssetEditDto) {
    /* 안 보낸 칸은 undefined 그대로 넘김(서비스가 옛 값을 씀 — 규칙 11) */
    return updateAsset(this.db, id, { name: dto.name, vendor: dto.vendor, assetTag: dto.assetTag, seats: dto.seats, seatsUsed: dto.seatsUsed, ownerId: dto.ownerId,
      billingCycle: dto.billingCycle, costAmount: dto.costAmount, renewOn: dto.renewOn, autoRenew: dto.autoRenew, cashPlan: dto.cashPlan, memo: dto.memo }, RequestCtx.actorId() ?? null);
  }

  @Post('its/assets/:id/cancel')
  @Roles('ADMIN', 'PAYOUT')
  @HttpCode(200)
  @Audit('ITS_ASSET_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: 'IT 자산 해지 (v10.491)', description: '사유 · 이은 자금 흐름 예정도 취소.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ITS_ASSET_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ITS_ASSET_REASON' })
  cancelOne(@Param('id') id: string, @Body() dto: ItsAssetCancelDto) { return cancelAsset(this.db, id, dto.reason, RequestCtx.actorId() ?? null); }

  /* ── v10.492 사내 제안 · 건의함 — 넣기 · 내 것 · 접수 번호(감사 기록 없음) ── */
  @Post('its/suggestions')
  @Roles(...SELF)
  @HttpCode(200)
  @ApiOperation({ summary: '제안 내기 (v10.492)', description: 'anonymous = true 면 쓴 사람 · 시각을 저장하지 않고 접수 번호를 한 번만 돌려줌(감사 기록도 남기지 않음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ITS_SUGGEST_CATEGORY · ITS_SUGGEST_TITLE · ITS_SUGGEST_BODY' })
  submit(@Body() dto: ItsSuggestNewDto) { return submitSuggestion(this.db, dto, RequestCtx.actorId() ?? ''); }

  @Get('its/suggestions/mine')
  @Roles(...SELF)
  @ApiOperation({ summary: '내 제안 (v10.492)', description: '이름을 밝힌 내 제안만 — 익명은 접수 번호로.' })
  @ApiOkResponse({ type: Object })
  mine() { return mySuggestions(this.db, RequestCtx.actorId() ?? ''); }

  @Post('its/suggestions/lookup')
  @Roles(...SELF)
  @HttpCode(200)
  @ApiOperation({ summary: '접수 번호로 보기 (v10.492)', description: '익명 제안의 진행 · 답변.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ITS_SUGGEST_RECEIPT' })
  lookup(@Body() dto: ItsSuggestLookupDto) { return lookupSuggestion(this.db, dto.code); }

  /* ── v10.492 검토(ADMIN · SUPER) ── */
  @Get('its/suggestions')
  @Roles('ADMIN')
  @ApiQuery({ name: 'state', required: false, enum: ['OPEN', 'ALL', ...SUGGEST_STATES] }) @ApiQuery({ name: 'q', required: false })
  @ApiOperation({ summary: '제안함 검토 목록 (v10.492)', description: '익명은 쓴 사람 「익명」(저장된 것이 없음) · 날짜만.' })
  @ApiOkResponse({ type: Object })
  review(@Query('state') state?: string, @Query('q') q?: string) { return reviewList(this.db, state, q); }

  @Get('its/suggestions/:id')
  @Roles('ADMIN')
  @ApiParam({ name: 'id', example: '00000000-0000-4000-8000-000000000000' })
  @ApiOperation({ summary: '제안 자세히 (v10.492)', description: '내용 · 검토 기록 · 옮길 수 있는 상태.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  suggestion(@Param('id') id: string) { return suggestionDetail(this.db, id); }

  @Post('its/suggestions/:id/decide')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('ITS_SUGGEST_DECIDE', 'SETTING')
  @ApiParam({ name: 'id', example: '00000000-0000-4000-8000-000000000000' })
  @ApiOperation({ summary: '제안 검토 · 답변 (v10.492)', description: '접수 → 검토 중 → 채택 → 실행 끝 · 반영 안 함 — 채택 · 반영 안 함 · 끝은 답변이 있어야.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ITS_SUGGEST_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ITS_SUGGEST_ANSWER · ITS_SUGGEST_STATE' })
  decide(@Param('id') id: string, @Body() dto: ItsSuggestDecideDto) { return decideSuggestion(this.db, id, { to: dto.to, answer: dto.answer }, RequestCtx.actorId() ?? ''); }

  /* ── v10.493 사내 설문 — 관리(ADMIN · SUPER) ── */
  @Get('its/surveys')
  @Roles('ADMIN')
  @ApiOperation({ summary: '사내 설문 관리 목록 (v10.493)', description: '상태 · 질문 수 · 낸 사람 수 · 대상 수.' })
  @ApiOkResponse({ type: Object })
  surveys() { return listSurveys(this.db); }

  @Post('its/surveys')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('ITS_SURVEY_ADD', 'SETTING')
  @ApiOperation({ summary: '사내 설문 만들기 (v10.493)', description: '고치는 중(DRAFT)으로 만듦 · 질문 1 ~ 30.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ITS_SURVEY_TITLE · ITS_SURVEY_DATE · ITS_SURVEY_AUDIENCE · ITS_SURVEY_QUESTION' })
  async addSurvey(@Body() dto: ItsSurveyNewDto) { return createSurvey(this.db, dto, await this.me()); }

  @Get('its/surveys/:id')
  @Roles('ADMIN')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사내 설문 자세히 (v10.493)', description: '설정 · 질문(고치기 화면).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  survey(@Param('id') id: string) { return surveyDetail(this.db, id); }

  @Put('its/surveys/:id')
  @Roles('ADMIN')
  @Audit('ITS_SURVEY_EDIT', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사내 설문 고치기 (v10.493)', description: '고치는 중이면 모두(질문은 보낸 목록으로) · 받는 중이면 마감일 늦추기만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ITS_SURVEY_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ITS_SURVEY_*' })
  editSurvey(@Param('id') id: string, @Body() dto: ItsSurveyEditDto) {
    return updateSurvey(this.db, id, { title: dto.title, intro: dto.intro, anonymous: dto.anonymous, audience: dto.audience, opensOn: dto.opensOn, closesOn: dto.closesOn, questions: dto.questions });
  }

  @Post('its/surveys/:id/open')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('ITS_SURVEY_OPEN', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사내 설문 열기 (v10.493)', description: '고치는 중 → 받는 중(기간 안 대상에게 보임).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ITS_SURVEY_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ITS_SURVEY_DATE · ITS_SURVEY_EMPTY' })
  openSurvey(@Param('id') id: string) { return moveSurvey(this.db, id, 'OPEN'); }

  @Post('its/surveys/:id/close')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('ITS_SURVEY_CLOSE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사내 설문 마감 (v10.493)', description: '받는 중 → 마감(결과를 봄).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ITS_SURVEY_STATE' })
  closeSurvey(@Param('id') id: string) { return moveSurvey(this.db, id, 'CLOSED'); }

  @Post('its/surveys/:id/cancel')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit('ITS_SURVEY_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사내 설문 취소 (v10.493)', description: '고치는 중 · 받는 중 → 취소(사유 · 결과 보이지 않음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ITS_SURVEY_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ITS_SURVEY_REASON' })
  cancelSurvey(@Param('id') id: string, @Body() dto: ItsSurveyCancelDto) { return moveSurvey(this.db, id, 'CANCELED', dto.reason); }

  @Get('its/surveys/:id/results')
  @Roles('ADMIN')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사내 설문 결과 (v10.493)', description: '익명 설문은 마감 뒤 · 응답 수가 its.survey_min_count 이상일 때만 · 글 답은 가나다순.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  results(@Param('id') id: string) { return surveyResults(this.db, id); }

  @Get('its/surveys/:id/export')
  @Roles('ADMIN')
  @ExportGate('ITS_SURVEY')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '사내 설문 CSV (v10.493 · 내려받기 승인)', description: '익명은 집계 · 글 답만 · 이름을 밝히는 설문은 사람마다 한 줄.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL · ITS_SURVEY_HIDDEN' })
  exportSurvey(@Param('id') id: string) { return surveyExport(this.db, id); }

  /* ── v10.493 사내 설문 — 답하기(운영 계정 · 감사 기록 없음) ── */
  @Get('its/my-surveys')
  @Roles(...SELF)
  @ApiOperation({ summary: '내가 답할 설문 (v10.493)', description: '대상 역할에 든 받는 중 설문 · 낸 것 표시.' })
  @ApiOkResponse({ type: Object })
  async mySurveyList() { return mySurveys(this.db, await this.me()); }

  @Get('its/my-surveys/:id')
  @Roles(...SELF)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '설문 답하기 화면 (v10.493)', description: '질문 · 낸 것인지.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  async surveyFormOne(@Param('id') id: string) { return surveyForm(this.db, id, await this.me()); }

  @Post('its/my-surveys/:id/answer')
  @Roles(...SELF)
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '설문 답 내기 (v10.493)', description: '한 번만 · 익명 설문이면 답에 계정을 저장하지 않음(감사 기록 없음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ITS_SURVEY_TAKEN' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ITS_SURVEY_ANSWER · ITS_SURVEY_CLOSED' })
  async answer(@Param('id') id: string, @Body() dto: ItsSurveyAnswerDto) { return answerSurvey(this.db, id, dto.answers, await this.me()); }
}
