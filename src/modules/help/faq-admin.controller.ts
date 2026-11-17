import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { FAQ_CHANNELS, FAQ_TOPICS, FaqAdminService } from './faq-admin.service';

/* ---------------------------------------------------------------------
 * v10.332 (D224 · docs/463) — 운영 화면 「자주 묻는 질문」 관리(SB-ADM-SIT-100)
 *
 *   ADMIN·SUPER  GET   /admin/faqs        모든 질문(숨긴 것 포함) · 분야 · 나오는 곳 · 「많이 찾는 질문」 수
 *                POST  /admin/faqs        새 질문(감사 FAQ_CREATE)
 *                PATCH /admin/faqs/:id    고치기 · 숨기기 · 순서 · 「많이 찾는 질문」(감사 FAQ_UPDATE)
 *                POST  /admin/faqs/misses/done  v10.336 못 찾은 낱말 「다룸」(감사 FAQ_MISS_DONE)
 *   지우기는 없습니다(숨기기). 사용자 웹은 GET /faq 를 그대로 읽습니다.
 * ------------------------------------------------------------------- */

export class FaqPatchDto {
  @ApiPropertyOptional({ example: '정산', description: '분류(짧은 이름 · 20자)' }) @IsOptional() @IsString() @MaxLength(40) category?: string;
  @ApiPropertyOptional({ example: '정산은 언제 받나요?', description: '질문(2 ~ 200자)' }) @IsOptional() @IsString() @MaxLength(400) question?: string;
  @ApiPropertyOptional({ description: '답(2 ~ 3,000자)' }) @IsOptional() @IsString() @MaxLength(6000) answer?: string;
  @ApiPropertyOptional({ enum: FAQ_TOPICS, description: '고객센터 분야 탭' }) @IsOptional() @IsIn([...FAQ_TOPICS]) topic?: string;
  @ApiPropertyOptional({ enum: FAQ_CHANNELS, isArray: true, description: '나오는 곳 — FAQ · CS(고객센터) · GUIDE(이용안내) · BOT(챗봇)' })
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsIn([...FAQ_CHANNELS], { each: true }) channels?: string[];
  @ApiPropertyOptional({ type: String, isArray: true, description: '챗봇이 고르는 낱말(10개 · 20자)' })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) keywords?: string[];
  @ApiPropertyOptional({ example: '/my/settlement', description: '「…에서 보기」 주소(사이트 안 · 비우면 없음)' }) @IsOptional() @IsString() @MaxLength(200) linkHref?: string;
  @ApiPropertyOptional({ example: '정산 내역에서 보기' }) @IsOptional() @IsString() @MaxLength(60) linkLabel?: string;
  @ApiPropertyOptional({ description: '챗봇 답 아래 「상담원 연결」' }) @IsOptional() @IsBoolean() handoff?: boolean;
  @ApiPropertyOptional({ example: 'HLT', description: '이 관에서만(비우면 모든 관)' }) @IsOptional() @IsString() @MaxLength(10) gwanCode?: string;
  @ApiPropertyOptional({ example: 10, description: '순서(작을수록 위 · 0 ~ 9999)' }) @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  @ApiPropertyOptional({ description: '「많이 찾는 질문」에 올림(10개까지)' }) @IsOptional() @IsBoolean() isTop?: boolean;
  @ApiPropertyOptional({ description: 'false = 숨김(사용자 웹에서 빠짐)' }) @IsOptional() @IsBoolean() isActive?: boolean;
}
/** 새로 등록 — 분류 · 질문 · 답은 꼭(비면 서비스가 422 FAQ_CATEGORY · FAQ_QUESTION · FAQ_ANSWER) */
export class FaqCreateDto extends FaqPatchDto {}
export class FaqMissDoneDto {
  @ApiProperty({ example: '탈퇴 후 재가입', description: '「못 찾은 낱말 30일」의 낱말' }) @IsString() @MaxLength(100) word!: string;
}
export class FaqMissDoneResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() word!: string;
  @ApiProperty() note!: string;
}
export class FaqSaveResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() note!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/faqs')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class FaqAdminController {
  constructor(private readonly svc: FaqAdminService) {}

  @Get()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '자주 묻는 질문 — 모두(숨긴 것 포함)', description: '분야(topics) · 나오는 곳(channels) · 「많이 찾는 질문」 한도(topMax 10) · 지금 올린 수(top). 고친 사람은 가린 메일.' })
  @ApiOkResponse({ type: Object })
  list() { return this.svc.list(); }

  @Post()
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @Audit('FAQ_CREATE', 'FAQ')
  @ApiOperation({ summary: '자주 묻는 질문 — 새로 등록', description: '나오는 곳을 비우면 고객센터(FAQ · CS). 사용자 웹에 바로 나갑니다(isActive false 면 숨긴 채).' })
  @ApiOkResponse({ type: FaqSaveResultDto })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'FAQ_DUPLICATE — 같은 질문이 이미 있음' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'FAQ_CATEGORY · FAQ_QUESTION · FAQ_ANSWER · FAQ_TOPIC · FAQ_CHANNELS · FAQ_LINK · FAQ_SORT · FAQ_GWAN · FAQ_TOP_FULL(10개 넘음)' })
  create(@Body() dto: FaqCreateDto) { return this.svc.create(dto); }

  @Post('misses/done')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @Audit('FAQ_MISS_DONE', 'FAQ')
  @ApiOperation({ summary: '못 찾은 낱말 「다룸」 (v10.336)', description: '새 질문을 만들었거나 다룰 필요가 없는 낱말을 목록에서 내림. 다룸 뒤 다시 찾는 사람이 있으면 다시 나옴.' })
  @ApiOkResponse({ type: FaqMissDoneResultDto })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 못 찾은 낱말 목록에 없음' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '쓰지 않음(문서 규칙)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'FAQ_MISS_WORD — 2 ~ 40자' })
  missDone(@Body() dto: FaqMissDoneDto) { return this.svc.missDone(dto.word); }

  @Patch(':id')
  @Roles('ADMIN', 'SUPER')
  @Audit('FAQ_UPDATE', 'FAQ')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '자주 묻는 질문 — 고치기 · 숨기기 · 순서 · 많이 찾는 질문', description: '보낸 칸만 바꿉니다. 지우기는 없습니다(isActive false = 숨김).' })
  @ApiOkResponse({ type: FaqSaveResultDto })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'FAQ_DUPLICATE — 같은 질문이 이미 있음' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'FAQ_CATEGORY · FAQ_QUESTION · FAQ_ANSWER · FAQ_TOPIC · FAQ_CHANNELS · FAQ_LINK · FAQ_SORT · FAQ_GWAN · FAQ_TOP_FULL' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FaqPatchDto) { return this.svc.update(id, dto); }
}
