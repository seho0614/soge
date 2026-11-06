import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { HELP_MAX_CHARS, HelpService } from './help.service';

/* ---------------------------------------------------------------------
 * v10.203 (D180 · docs/324) — 사용자 설명서
 *
 *   공개         GET  /site/manual                      지금 판(공개 구역 site — check-acl) 본문 · 절 목차(SB-HOM-ETC-020 /guide/manual)
 *   ADMIN·SUPER  GET  /admin/help/manual                지금 판 · 판 목록(SB-ADM-SIT-090)
 *                GET  /admin/help/manual/versions/:v    옛 판 본문
 *   SUPER        POST /admin/help/manual                새 판 저장(2만 자까지 · ### 절이 하나 이상)
 * ------------------------------------------------------------------- */

export class HelpSectionRefDto {
  @ApiProperty({ example: 'm3' }) id!: string;
  @ApiProperty({ example: '2-1. 회원가입 (`/signup`)' }) heading!: string;
}
export class HelpManualDto {
  @ApiProperty({ example: '사용자 설명서' }) title!: string;
  @ApiProperty({ example: 1 }) version!: number;
  @ApiProperty() updatedAt!: string;
  @ApiProperty({ description: '본문(마크다운 — ## 장 · ### 절 · 목록 · 표)' }) body!: string;
  @ApiProperty({ type: HelpSectionRefDto, isArray: true, description: '### 절 목차 — id 는 화면 #m번호 · AI 상담 출처와 같음' }) sections!: HelpSectionRefDto[];
}
export class HelpSaveDto {
  @ApiProperty({ maxLength: HELP_MAX_CHARS, description: `새 판 본문(100 ~ ${HELP_MAX_CHARS}자 · ### 절이 하나 이상)` })
  @IsString() @MinLength(100) @MaxLength(60000) body!: string;   // 넘는 것은 서비스가 HELP_TOO_LONG(글자 수와 함께) 으로
  @ApiPropertyOptional({ example: '소개몰 주문 안내 고침', description: '고친 까닭(선택 · 200자)' })
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}
export class HelpSaveResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() version!: number;
  @ApiProperty() chars!: number;
  @ApiProperty() note!: string;
}

@ApiTags('HOM')
@Controller('api/v1')
export class HelpPublicController {
  constructor(private readonly help: HelpService) {}

  @Get('site/manual')
  @ApiOperation({ summary: '사용자 설명서(공개)', description: '지금 판 본문과 ### 절 목차. AI 상담이 읽는 것과 같은 글입니다.' })
  @ApiOkResponse({ type: HelpManualDto })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 설명서가 아직 없음' })
  manual() { return this.help.publicManual(); }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/help')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class HelpAdminController {
  constructor(private readonly help: HelpService) {}

  @Get('manual')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '사용자 설명서 — 지금 판 · 판 목록', description: '지금 판 본문 · 글자 수 · 절 수 · 한도(maxChars) · 판 목록(최근 50 · 고친 사람은 앞 두 글자).' })
  @ApiOkResponse({ type: Object })
  manual() { return this.help.adminManual(); }

  @Get('manual/versions/:v')
  @Roles('ADMIN', 'SUPER')
  @ApiParam({ name: 'v', type: Number })
  @ApiOperation({ summary: '사용자 설명서 — 옛 판 본문' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  version(@Param('v', ParseIntPipe) v: number) { return this.help.version(v); }

  @Post('manual')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('HELP_MANUAL_SAVE', 'SITE')
  @ApiOperation({ summary: '사용자 설명서 — 새 판 저장(SUPER)', description: '옛 판은 남고 새 판이 지금 판이 됩니다. 같은 본문이면 판을 만들지 않음. AI 상담은 10분 안에 새 판을 읽습니다.' })
  @ApiOkResponse({ type: HelpSaveResultDto })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HELP_TOO_SHORT · HELP_TOO_LONG(2만 자 넘음) · HELP_NO_SECTION(### 절 없음)' })
  save(@Body() dto: HelpSaveDto) { return this.help.save(dto.body, dto.note); }
}
