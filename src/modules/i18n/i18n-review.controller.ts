import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { REVIEW_SCOPES, REVIEW_VERDICTS, i18nReviewOverview, recordI18nReview } from './i18n-review';

/* ---------------------------------------------------------------------
 * v10.523 (D278 · docs/661) 일본어 · 중국어(간체) 검수 — 운영 화면 › 관 관리 › 일본어 · 중국어 검수(SB-ADM-OAPI-030)
 *   ADMIN · SUPER  GET  /admin/i18n-review(언어마다 사전 현황 · 검수 기록 · 켤 수 있는지)
 *   SUPER          POST /admin/i18n-review/{lang}(검수 기록 한 줄 — 쌓기만)
 *   ★ 기존 i18n.controller(운영 API 7개 · 손님 API 2개 — test_v1093 이 셈)는 고치지 않으려고 따로 둠
 * ------------------------------------------------------------------- */

export class I18nReviewNewDto {
  @ApiProperty({ enum: REVIEW_SCOPES, description: 'SITE = 사용자 웹 사전 · SERVER = 서버 문장 · DB = DB 문구(참고)' }) @IsIn(REVIEW_SCOPES as unknown as string[]) scope!: string;
  @ApiProperty({ enum: REVIEW_VERDICTS }) @IsIn(REVIEW_VERDICTS as unknown as string[]) verdict!: string;
  @ApiProperty({ example: '번역 업체 ○○ 김검수' }) @IsString() @Length(2, 60) reviewer!: string;
  @ApiPropertyOptional({ example: '머리줄 「紹介広場」 표기 확인 · 바닥줄 법정 표기는 원문 유지' }) @IsOptional() @IsString() @Length(0, 500) note?: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@Roles('ADMIN')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class I18nReviewController {
  constructor(private readonly db: DatabaseService) {}

  @Get('i18n-review')
  @ApiOperation({ summary: '일본어 · 중국어 검수 현황 (v10.523)', description: '언어마다 켜짐 · 사용자 웹 사전(문장 수 · 초안) · 서버 문장(수 · 초안) · DB 문구 번역 상태별 수 · 가장 최근 검수(SITE · SERVER · DB) · 켤 수 있는지.' })
  @ApiOkResponse({ type: Object })
  overview() { return i18nReviewOverview(this.db); }

  @Post('i18n-review/:lang')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('I18N_REVIEW_RECORD', 'I18N_LANG')
  @ApiParam({ name: 'lang', example: 'ja' })
  @ApiOperation({ summary: '검수 기록 남기기 (v10.523 · SUPER)', description: '범위 · 승인 · 반려(메모 꼭) · 검수자 이름 · 이 판 — 쌓기만. SITE · SERVER 가장 최근 판정이 둘 다 승인이어야 「번역」 탭에서 그 언어를 켤 수 있음(DB 가 막음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'I18N_REVIEW_SCOPE · I18N_REVIEW_VERDICT · I18N_REVIEW_WHO · I18N_REVIEW_NOTE' })
  record(@Param('lang') lang: string, @Body() dto: I18nReviewNewDto) {
    return recordI18nReview(this.db, lang, { scope: dto.scope, verdict: dto.verdict, reviewer: dto.reviewer, note: dto.note }, RequestCtx.actorId() ?? null);
  }
}
