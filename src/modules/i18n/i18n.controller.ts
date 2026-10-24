import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery,
         ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsString, Length, Matches } from 'class-validator';
import { I18nService, I18N_FIELDS } from './i18n.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/* ─────────────────────────────────────────────────────────────────────
 * 다국어 1단계 기반 — v10.93 (D115 · docs/148 · docs/150)
 *
 *   손님 화면 API(켜진 언어 · 내 언어)는 2단계(화면 글)에서 화면과 함께 붙입니다 — 이번 판은 운영 화면만.
 *   운영 화면   언어 켜고 끄기 · 번역 목록 · 원문 보기 · 번역 넣기(MANUAL) · 승인 · 반려
 *   i18n.enabled 가 off 면 손님 화면에는 한국어만 나갑니다(언어 단추 숨김 그대로).
 * ──────────────────────────────────────────────────────────────────── */

const TYPES = Object.keys(I18N_FIELDS);
const FIELDS = [...new Set(Object.values(I18N_FIELDS).flat())];

export class LangActiveDto {
  @ApiProperty({ example: true }) @IsBoolean() isActive!: boolean;
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
export class TranslationOkDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() id!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional() reason?: string;
}

@ApiTags('I18N')
@Controller('api/v1')
export class I18nController {
  constructor(private readonly svc: I18nService) {}

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

  private idOf(id: string) {
    if (!/^\d{1,18}$/.test(id ?? '')) return '0';   // 숫자가 아니면 없는 번호로 → 404
    return id;
  }
}
