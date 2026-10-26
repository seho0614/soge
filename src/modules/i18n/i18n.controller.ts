import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery,
         ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsString, Length, Matches } from 'class-validator';
import { I18nService, I18N_FIELDS } from './i18n.service';
import { TranslateService } from './translate.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/* ─────────────────────────────────────────────────────────────────────
 * 다국어 1단계 기반 — v10.93 (D115 · docs/148 · docs/150)
 *
 *   손님 화면   GET /i18n/langs(켜진 언어 · 꺼져 있으면 한국어만) · PUT /me/lang(회원이 고른 언어) — v10.95(2-1)
 *   운영 화면   언어 켜고 끄기 · 번역 목록 · 원문 보기 · 번역 넣기(MANUAL) · 승인 · 반려
 *   i18n.enabled 가 off 면 손님 화면에는 한국어만 나갑니다(언어 단추 숨김 그대로).
 * ──────────────────────────────────────────────────────────────────── */

const TYPES = Object.keys(I18N_FIELDS);
const FIELDS = [...new Set(Object.values(I18N_FIELDS).flat())];
const STATUSES_DOC = I18nService.STATUSES;
/** 원문 목록(운영 글) 대상 — v10.103 · 3-1 */
const CATALOG_TYPES = ['NOTICE', 'FAQ', 'TERM', 'CATEGORY', 'HLT_PRODUCT', 'PROFILE_Q', 'PROFILE_OPT', 'AD_SEGMENT'];   // v10.118 관심 성향

export class LangActiveDto {
  @ApiProperty({ example: true }) @IsBoolean() isActive!: boolean;
}
export class I18nLangDto {
  @ApiProperty({ example: 'ko' }) code!: string;
  @ApiProperty({ example: '한국어', description: '그 언어로 적은 이름' }) name!: string;
  @ApiProperty({ description: '좌우 반전(아랍어)' }) rtl!: boolean;
}
export class I18nLangsDto {
  @ApiProperty({ description: 'i18n.enabled — off 면 한국어만' }) enabled!: boolean;
  @ApiProperty({ type: [I18nLangDto] }) items!: I18nLangDto[];
}
export class MyLangDto {
  @ApiProperty({ example: 'en' }) @IsString() @Matches(/^[a-z]{2}$/) lang!: string;
}
export class MyLangOkDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ example: 'en' }) lang!: string;
}
export class TranslationUpsertDto {
  @ApiProperty({ enum: TYPES, example: 'NOTICE' }) @IsIn(TYPES) targetType!: string;
  @ApiProperty({ example: '0f8fad5b-d9cb-469f-a165-70867728950e', description: '약관은 「code@version」' })
  @IsString() @Length(1, 100) targetId!: string;
  @ApiProperty({ enum: FIELDS, example: 'title' }) @IsIn(FIELDS) field!: string;
  @ApiProperty({ example: 'en' }) @IsString() @Matches(/^[a-z]{2}$/) lang!: string;
  @ApiProperty({ example: 'Service notice' }) @IsString() @Length(1, 20000) text!: string;
}
export class AdminLangRowDto {
  @ApiProperty({ example: 'en' }) code!: string;
  @ApiProperty({ example: '영어' }) name!: string;
  @ApiProperty({ example: 'English', description: '그 언어로 적은 이름' }) native!: string;
  @ApiProperty({ description: '좌우 반전(아랍어)' }) rtl!: boolean;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ description: '번역 줄 수' }) translations!: number;
}
export class AdminLangsDto {
  @ApiProperty({ description: 'i18n.enabled — off 면 손님 화면은 한국어만' }) enabled!: boolean;
  @ApiPropertyOptional({ enum: ['MANUAL', 'CLAUDE', 'N8N'], description: 'i18n.engine' }) engine?: string;
  @ApiProperty({ type: [AdminLangRowDto] }) items!: AdminLangRowDto[];
}
export class LangSetOkDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() code!: string;
  @ApiProperty() isActive!: boolean;
}
export class TranslationSourceDto {
  @ApiProperty() targetType!: string;
  @ApiProperty() targetId!: string;
  @ApiProperty() field!: string;
  @ApiProperty() sourceText!: string;
  @ApiPropertyOptional() gwanCode?: string;
}
export class TranslationRejectDto {
  @ApiProperty({ example: '금액 표기가 원문과 다름' }) @IsString() @Length(2, 300) reason!: string;
}
export class TranslationRowDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: TYPES }) targetType!: string;
  @ApiProperty() targetId!: string;
  @ApiProperty() field!: string;
  @ApiProperty() lang!: string;
  @ApiProperty() text!: string;
  @ApiProperty({ enum: I18nService.STATUSES }) status!: string;
  @ApiProperty({ enum: ['MANUAL', 'CLAUDE', 'N8N'] }) engine!: string;
  @ApiPropertyOptional({ description: '원문 앞 300자' }) sourceText?: string;
  @ApiProperty({ description: '원문이 없어짐' }) sourceMissing!: boolean;
  @ApiProperty({ description: '원문이 고쳐져 번역이 낡음 — 화면에 나가지 않음' }) isStale!: boolean;
  @ApiProperty() translatedAt!: string;
  @ApiPropertyOptional() approvedAt?: string;
  @ApiPropertyOptional() rejectReason?: string;
}
export class TranslationPageDto {
  @ApiProperty({ type: [TranslationRowDto] }) items!: TranslationRowDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() size!: number;
  @ApiProperty() pages!: number;
}
export class CatalogFieldDto {
  @ApiProperty({ example: 'title' }) field!: string;
  @ApiPropertyOptional({ description: '번역 번호(없으면 아직 안 넣음)' }) id?: string;
  @ApiPropertyOptional({ enum: STATUSES_DOC }) status?: string;
  @ApiPropertyOptional({ description: '원문이 고쳐져 낡음' }) isStale?: boolean;
  @ApiPropertyOptional({ description: '번역문' }) text?: string;
  @ApiPropertyOptional({ description: '반려 사유' }) rejectReason?: string;
}
export class CatalogRowDto {
  @ApiProperty({ description: '대상 번호 — 공지 · FAQ · 분류는 id, 약관은 「코드@판」, 소개몰 상품은 상품 코드' }) targetId!: string;
  @ApiProperty({ description: '원문 제목 · 이름' }) label!: string;
  @ApiPropertyOptional() gwanCode?: string;
  @ApiProperty({ type: [CatalogFieldDto] }) fields!: CatalogFieldDto[];
}
export class CatalogPageDto {
  @ApiProperty({ type: [CatalogRowDto] }) items!: CatalogRowDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() size!: number;
  @ApiProperty() pages!: number;
}
export class TranslateJobDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['LISTING', 'REQUEST'] }) targetType!: string;
  @ApiProperty() targetId!: string;
  @ApiProperty({ example: 'en' }) lang!: string;
  @ApiProperty({ enum: ['QUEUED', 'RUNNING', 'DONE', 'HELD', 'FAILED'] }) state!: string;
  @ApiProperty() attempts!: number;
  @ApiPropertyOptional({ description: 'AUTO_APPROVED · DRAFT(금칙어 — 승인 대기) · SKIPPED(사람 승인 번역 있음) · SOURCE_MISSING · REFUSAL · TOO_LONG' }) result?: string;
  @ApiPropertyOptional() lastError?: string;
  @ApiProperty() updatedAt!: string;
  @ApiPropertyOptional({ description: '원문 제목' }) title?: string;
}
export class TranslateJobPageDto {
  @ApiProperty({ type: [TranslateJobDto] }) items!: TranslateJobDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() size!: number;
  @ApiProperty() pages!: number;
  @ApiProperty({ description: '상태별 줄 수', example: { QUEUED: 3, DONE: 40 } }) counts!: Record<string, number>;
  @ApiPropertyOptional({ description: '엔진(MOCK · CLAUDE · 없으면 null = 아무것도 부르지 않음)' }) provider?: string;
}
export class TranslateRetryDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() id!: string;
  @ApiPropertyOptional() state?: string;
}
export class TranslateBackfillDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ description: '넣은 줄 수(스위치가 꺼져 있으면 0)' }) queued!: number;
}
export class TranslationOkDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() id!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional() reason?: string;
}

@ApiTags('I18N')
@Controller('api/v1')
export class I18nController {
  constructor(private readonly svc: I18nService, private readonly tr: TranslateService) {}

  @Get('i18n/langs')
  @ApiOperation({ summary: '켜진 언어', description: '다국어(i18n.enabled)가 꺼져 있으면 한국어만 — 사용자 웹이 언어 단추를 그릴지 · 어떤 사전을 쓸지 여기서 정합니다.' })
  @ApiOkResponse({ type: I18nLangsDto })
  langs() { return this.svc.langs(); }

  @ApiBearerAuth()
  @Put('me/lang')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiOperation({ summary: '내 언어 저장', description: '켜진 언어만 받습니다(422 LANG_NOT_ACTIVE). 로그인하지 않은 손님은 쿠키(sgb_lang)만 씁니다.' })
  @ApiOkResponse({ type: MyLangOkDto })
  @ApiResponse({ status: 422, type: ErrorDto })
  setMyLang(@Body() dto: MyLangDto) { return this.svc.setMyLang(dto.lang); }

  @ApiBearerAuth()
  @Get('admin/i18n/langs')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '언어 목록 (운영)' })
  @ApiOkResponse({ type: AdminLangsDto })
  adminLangs() { return this.svc.adminLangs(); }

  @ApiBearerAuth()
  @Post('admin/i18n/langs/:code')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '언어 켜기 · 끄기', description: '한국어(원문)는 끌 수 없습니다(409).' })
  @ApiOkResponse({ type: LangSetOkDto })
  @ApiResponse({ status: 404, type: ErrorDto }) @ApiResponse({ status: 409, type: ErrorDto })
  @Audit('I18N_LANG_SET', 'I18N_LANG')
  setLang(@Param('code') code: string, @Body() dto: LangActiveDto) { return this.svc.setLangActive(code, dto.isActive); }

  @ApiBearerAuth()
  @Get('admin/i18n/translations')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '번역 목록 (운영)', description: '`{ items, total, page, size, pages }` · size 1 ~ 100(기본 20) · stale=true 면 원문이 고쳐진 줄만.' })
  @ApiQuery({ name: 'lang', required: false }) @ApiQuery({ name: 'status', required: false, enum: I18nService.STATUSES })
  @ApiQuery({ name: 'targetType', required: false, enum: TYPES }) @ApiQuery({ name: 'stale', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'size', required: false })
  @ApiOkResponse({ type: TranslationPageDto })
  list(@Query('lang') lang?: string, @Query('status') status?: string, @Query('targetType') targetType?: string,
       @Query('stale') stale?: string, @Query('page') page?: string, @Query('size') size?: string) {
    const num = (v?: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : undefined; };
    return this.svc.list({
      lang: /^[a-z]{2}$/.test(lang ?? '') ? lang : undefined,
      status: I18nService.STATUSES.includes(status ?? '') ? status : undefined,
      targetType: TYPES.includes(targetType ?? '') ? targetType : undefined,
      stale: stale === 'true' ? true : stale === 'false' ? false : undefined,
      page: num(page), size: num(size),
    });
  }

  @ApiBearerAuth()
  @Get('admin/i18n/catalog')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '원문 목록 · 번역 상태 (운영 · v10.103)', description: '운영 글(공지 · 자주 묻는 질문 · 약관 · 분류 이름 · 소개몰 상품)을 그 언어 번역 상태와 함께. 등록 글 · 게시판은 3-2 · 3-3 에서 자동.' })
  @ApiQuery({ name: 'targetType', enum: CATALOG_TYPES }) @ApiQuery({ name: 'lang', example: 'en' })
  @ApiQuery({ name: 'q', required: false, description: '제목 · 이름 찾기' }) @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'size', required: false })
  @ApiOkResponse({ type: CatalogPageDto })
  @ApiResponse({ status: 422, type: ErrorDto })
  catalog(@Query('targetType') targetType: string, @Query('lang') lang: string, @Query('q') q?: string,
          @Query('page') page?: string, @Query('size') size?: string) {
    const num = (v?: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : undefined; };
    return this.svc.catalog({ targetType: CATALOG_TYPES.includes(targetType) ? targetType : '', lang: String(lang ?? ''),
      q: typeof q === 'string' ? q.slice(0, 50) : undefined, page: Math.min(num(page) ?? 1, 10000), size: num(size) });
  }

  @ApiBearerAuth()
  @Get('admin/i18n/source')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '원문 보기 (운영)', description: '번역을 넣기 전에 원문을 봅니다.' })
  @ApiOkResponse({ type: TranslationSourceDto })
  @ApiQuery({ name: 'targetType', enum: TYPES }) @ApiQuery({ name: 'targetId' }) @ApiQuery({ name: 'field', enum: FIELDS })
  @ApiResponse({ status: 404, type: ErrorDto }) @ApiResponse({ status: 422, type: ErrorDto })
  source(@Query('targetType') targetType: string, @Query('targetId') targetId: string, @Query('field') field: string) {
    return this.svc.source(String(targetType ?? ''), String(targetId ?? ''), String(field ?? ''));
  }

  @ApiBearerAuth()
  @Put('admin/i18n/translations')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '번역 넣기 · 고치기 (MANUAL)', description: '넣거나 고치면 다시 승인 대기(DRAFT)입니다. 원문 해시를 함께 저장합니다.' })
  @ApiOkResponse({ type: TranslationOkDto })
  @ApiResponse({ status: 404, type: ErrorDto }) @ApiResponse({ status: 422, type: ErrorDto })
  @Audit('I18N_TRANSLATION_SAVE', 'I18N_TRANSLATION')
  upsert(@Body() dto: TranslationUpsertDto) { return this.svc.upsert(dto); }

  @ApiBearerAuth()
  @Post('admin/i18n/translations/:id/approve')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '번역 승인', description: '원문이 고쳐진 줄 · 원문이 없어진 줄은 409, 번역문에 차단 금칙어가 있으면 422 BANNED_WORD.' })
  @ApiOkResponse({ type: TranslationOkDto })
  @ApiResponse({ status: 404, type: ErrorDto }) @ApiResponse({ status: 409, type: ErrorDto }) @ApiResponse({ status: 422, type: ErrorDto })
  @Audit('I18N_TRANSLATION_APPROVE', 'I18N_TRANSLATION')
  approve(@Param('id') id: string) { return this.svc.approve(this.idOf(id)); }

  @ApiBearerAuth()
  @Post('admin/i18n/translations/:id/reject')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '번역 반려', description: '사유는 2자 이상 · 답에 사유를 담아 감사 기록에 남깁니다.' })
  @ApiOkResponse({ type: TranslationOkDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  @Audit('I18N_TRANSLATION_REJECT', 'I18N_TRANSLATION')
  reject(@Param('id') id: string, @Body() dto: TranslationRejectDto) { return this.svc.reject(this.idOf(id), dto.reason); }

  /* ── v10.104 등록 글 자동 번역(3-2 · D118 · docs/162) ───────────── */

  @ApiBearerAuth()
  @Get('admin/i18n/jobs')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '자동 번역 작업 줄 (운영 · v10.104)', description: '매물 · 요청 × 언어 한 줄 · 상태별 수 · 지금 엔진. 스위치(i18n.auto_translate.enabled) · AI 전체 · 월 상한이 막으면 배치는 아무것도 하지 않습니다.' })
  @ApiQuery({ name: 'state', required: false, enum: ['QUEUED', 'RUNNING', 'DONE', 'HELD', 'FAILED'] })
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'size', required: false })
  @ApiOkResponse({ type: TranslateJobPageDto })
  jobs(@Query('state') state?: string, @Query('page') page?: string, @Query('size') size?: string) {
    const num = (v?: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : undefined; };
    return this.tr.jobs({ state: ['QUEUED', 'RUNNING', 'DONE', 'HELD', 'FAILED'].includes(state ?? '') ? state : undefined, page: num(page), size: num(size) });
  }

  @ApiBearerAuth()
  @Post('admin/i18n/jobs/:id/retry')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '자동 번역 다시 시도', description: '보류 · 실패 · 끝난 줄을 대기로 되돌립니다(시도 횟수 0).' })
  @ApiOkResponse({ type: TranslateRetryDto })
  @Audit('I18N_JOB_RETRY', 'I18N_JOB')
  retry(@Param('id') id: string) { return this.tr.retry(this.idOf(id)); }

  @ApiBearerAuth()
  @Post('admin/i18n/jobs/backfill')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '노출 중인 등록 글 한꺼번에 넣기', description: '자동 번역 스위치를 켠 뒤 처음 한 번 — 지금 손님에게 보이는 매물 · 요청을 작업 줄에 넣습니다(스위치가 꺼져 있으면 0).' })
  @ApiOkResponse({ type: TranslateBackfillDto })
  @Audit('I18N_JOB_BACKFILL', 'I18N_JOB')
  backfill() { return this.tr.backfill(); }

  private idOf(id: string) {
    if (!/^\d{1,18}$/.test(id ?? '')) return '0';   // 숫자가 아니면 없는 번호로 → 404
    return id;
  }
}
