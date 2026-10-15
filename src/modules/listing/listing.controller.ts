import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StateConflict } from '../../core/errors';
import { sendImage } from '../file/attach-images';
import {
  ApiBearerAuth, ApiExtraModels, ApiHeader, ApiOkResponse, ApiOperation,
  ApiParam, ApiQuery, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import { ListingService } from './listing.service';
import {
  CreateListingDto, CreateListingResultDto, ListingDetailDto,
  ListingListDto, ListingQueryDto, ListingReviewListDto, UpdateListingDto,
} from './listing.dto';
import { AnswerQuestionDto, CreateQuestionDto, QuestionDto } from './question.dto';
import { ErrorDto } from '../../common/dto/common.dto';
import { RequireGate, Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';

/** SB-HOM-REG-010 / 020 · SB-{G}-LST-010 · SB-{G}-DTL-010 */
@ApiTags('HOM')
@ApiExtraModels(ListingListDto, ListingDetailDto)
/* ★ D010 — 예전에는 여기 「X-Ref-Code 헤더를 보내면 서버가 즉시 유입을 기록」이라고 적혀 있었지만
 *   실제 처리는 없었습니다(거짓 문서). 매물 API 는 소개코드를 보지 않습니다.
 *   유입 기록은 POST /attribution/touch 가 하고, 사용자 웹(middleware)이 ?ref= 를 보면 부릅니다. */
@ApiHeader({
  name: 'X-Ref-Code', required: false,
  description: '무시됩니다 — 매물 API 는 소개코드를 기록하지 않습니다. 소개코드 유입은 POST /attribution/touch 로 기록합니다.',
})
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
@Controller('api/v1/listings')
export class ListingController {
  constructor(private readonly service: ListingService) {}

  @Get()
  @ApiOperation({
    summary: '매물 목록',
    description:
      '광고와 일반 목록을 분리해 반환합니다. 하나로 섞으면 프런트가 라벨을 빠뜨릴 수 있고, ' +
      '그러면 노출순위 표시 의무 위반이 화면 단에서 발생합니다. ' +
      '기본 정렬에는 구독 가중치를 적용하지 않습니다 (INV-11).',
  })
  @ApiOkResponse({ type: ListingListDto })
  list(@Query() q: ListingQueryDto) {
    return this.service.list(q);
  }

  @Get(':id')
  @ApiOperation({ summary: '매물 상세' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ListingDetailDto })
  @ApiResponse({ status: 404, description: '없거나 노출 중이 아님', type: ErrorDto })
  /* v10.32 — 공개 문의 화면(SB-HOM-MCH-020)처럼 제목만 필요한 곳은 view=0 으로 읽습니다(조회 수를 올리지 않음) */
  @ApiQuery({ name: 'view', required: false, enum: ['0', '1'], description: "'0' 이면 조회 수를 올리지 않습니다" })
  detail(@Param('id') id: string, @Query('view') view?: string) {
    return this.service.detail(id, view !== '0');
  }

  @Post()
  @ApiBearerAuth()
  /* v10.36 (D094) · v10.37 (D095 · P2P) — 개인 회원(MEMBER)도 모든 관에 등록합니다. 인증이 필요한 업종(보험 · 의료 자격 · 공인중개사 · 제한업종)은 DB 게이트가 그 인증을 봅니다 */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '매물 등록',
    description:
      '등록 즉시 검수 큐로 들어갑니다. 사람이 볼 이유가 없으면 자동 승인되어 ' +
      '`autoApproved: true` 와 함께 바로 노출됩니다.',
  })
  @ApiOkResponse({ type: CreateListingResultDto })
  @ApiResponse({ status: 403, description: '본인인증 필요', type: ErrorDto })
  @ApiResponse({
    status: 422, type: ErrorDto,
    description:
      'RESTRICTED_CATEGORY 제한업종 · LISTING_SLOT_LIMIT 구독 슬롯 초과 · ' +
      'BANNED_WORD 금칙어 · GATED 자격 심사 전 · PROP 공인중개사 인증 전(v10.37 — 사업자 여부는 보지 않음 · P2P). 모두 DB 가 판정합니다',
  })
  @Audit('LISTING_CREATE', 'LISTING')
  create(@Body() dto: CreateListingDto) {
    return this.service.submit({ ...dto, ownerAccountId: RequestCtx.actorId()! });
  }

  @Patch(':id')
  @ApiBearerAuth()
  /* v10.36 (D094) — 소개장터 개인 등록자도 자기 매물을 관리합니다(주인 확인은 서비스 · DB) */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '매물 수정 (재검수)',
    description:
      '수정하면 version 이 올라가고 다시 검수를 받습니다. ' +
      '**부여된 배지는 회수됩니다** — 확인한 시점의 내용과 지금 내용이 다르면 확인의 의미가 없습니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CreateListingResultDto })
  @ApiResponse({
    status: 409, type: ErrorDto,
    description: 'VERSION_CONFLICT — 다른 곳에서 먼저 수정됨. 다시 불러오십시오',
  })
  @ApiResponse({ status: 422, description: '정책 위반', type: ErrorDto })
  @Audit('LISTING_UPDATE', 'LISTING')
  update(@Param('id') id: string, @Body() dto: UpdateListingDto) {
    return this.service.update(id, RequestCtx.actorId()!, dto);
  }

  @Post(':id/archive')
  @ApiBearerAuth()
  /* v10.36 (D094) — 소개장터 개인 등록자도 자기 매물을 관리합니다(주인 확인은 서비스 · DB) */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '매물 내리기',
    description: '주인만 내릴 수 있습니다. 상태가 ARCHIVED 가 되어 목록 · 검색에서 빠집니다. ' +
      '다시 올리려면 수정해서 재검수를 받습니다. 운영자가 정지한 매물은 내릴 수 없습니다(409 NOT_ARCHIVABLE).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'NOT_ARCHIVABLE', type: ErrorDto })
  @Audit('LISTING_ARCHIVE', 'LISTING')
  archive(@Param('id') id: string) {
    return this.service.archive(id, RequestCtx.actorId()!);
  }

  /* v10.31 — 매물 대표 · 상세 이미지(시안 등록 폼 「대표 이미지」 · 「상세 이미지」). 게시된 매물은 누구나 · 그 밖은 주인 · 운영 */
  @Get(':id/images/:n')
  @ApiOperation({ summary: '매물 이미지', description: 'n = 0(대표) ~ 9. JPG · PNG. 없으면 409 NOT_FOUND. GET /listings/{id}/photos/{n}(w2 · 없으면 404)과 같은 사진입니다.' })
  @ApiParam({ name: 'id', format: 'uuid' }) @ApiParam({ name: 'n', example: 0 })
  @ApiResponse({ status: 409, description: 'NOT_FOUND', type: ErrorDto })
  async image(@Param('id') id: string, @Param('n') n: string, @Res() res: Response) {
    const k = /^[0-9]$/.test(n) && /^[0-9a-f-]{36}$/i.test(id) ? Number(n) : -1;
    if (k < 0) throw new StateConflict('NOT_FOUND', '이미지가 없습니다.');
    sendImage(res, await this.service.image(id, k));
  }

  @Get(':id/reviews')
  @ApiOperation({
    summary: '등록자(소개자) 후기',
    description:
      '이 매물의 등록자가 받은 후기입니다(최근 20건 · 평균 평점). 누구나 볼 수 있으므로 ' +
      '작성자는 이름 첫 글자만(김○○), 본문의 연락처·이메일은 마스킹됩니다. 계정·거래 식별자는 내보내지 않습니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ListingReviewListDto })
  @ApiResponse({ status: 404, description: '없거나 노출 중이 아님', type: ErrorDto })
  reviews(@Param('id') id: string) {
    return this.service.listReviews(id);
  }

  @Get(':id/questions')
  @ApiOperation({
    summary: '공개 문의 목록',
    description:
      '누구나 볼 수 있으므로 연락처·이메일은 마스킹됩니다. ' +
      '마스킹하지 않으면 대화가 플랫폼 밖으로 새고, 귀속도 성사도 잡히지 않습니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: QuestionDto, isArray: true })
  questions(@Param('id') id: string) {
    return this.service.listQuestions(id);
  }

  @Post(':id/questions')
  @ApiBearerAuth()
  @Roles('MEMBER')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({ summary: '공개 문의 등록' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'OWN_LISTING — 본인 매물', type: ErrorDto })
  @Audit('QUESTION_CREATE', 'LISTING')
  ask(@Param('id') id: string, @Body() dto: CreateQuestionDto) {
    return this.service.askQuestion(id, dto.question);
  }

  @Patch('questions/:qid/answer')
  @ApiBearerAuth()
  /* v10.36 (D094) — 소개장터 개인 등록자도 자기 매물을 관리합니다(주인 확인은 서비스 · DB) */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({ summary: '공개 문의 답변', description: '매물 주인만 답변할 수 있습니다.' })
  @ApiParam({ name: 'qid', format: 'uuid' })
  @ApiResponse({
    status: 409, type: ErrorDto,
    description: 'ALREADY_ANSWERED — 이미 답변했거나 권한이 없습니다',
  })
  @Audit('QUESTION_ANSWER', 'LISTING')
  answer(@Param('qid') qid: string, @Body() dto: AnswerQuestionDto) {
    return this.service.answerQuestion(qid, dto.answer);
  }
}
