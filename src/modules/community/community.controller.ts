import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ErrorDto } from '../../common/dto/common.dto';
import { CommunityService } from './community.service';
import { CreatePostDto, UpdatePostDto, CreateCommentDto, CommunityClassifyDto } from './community.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/**
 * 소개광장.
 *
 * ── 전체 공개입니다 (사장님 결정 2026-09-18) ────────────────────
 * 가입만 하면 누구나 씁니다. 사업자 인증을 요구하면 스팸이 거의
 * 없지만, 전체 공개면 **첫날부터 광고 글이 올라옵니다.**
 *
 * 막는 것은 DB 트리거가 합니다(C810) — 여기서 막으면 API 를
 * 우회하는 경로가 생깁니다.
 *   ① 금칙어  ② 링크 제한  ③ 도배  ④ 첫 글 검수  ⑤ 신고
 */
export class BoardTranslateOkDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ description: '이번에 번역해 저장한 칸 수' }) translated!: number;
  @ApiPropertyOptional({ description: '금칙어 · 원문에 없는 연락처로 내보내지 않은 칸 수(원문 그대로)' }) held?: number;
  @ApiProperty({ description: '이미 번역되어 있던 칸 수' }) skipped!: number;
  @ApiPropertyOptional() note?: string;
}

@ApiTags('COMMUNITY')
@Controller('api/v1')
export class CommunityController {
  constructor(private readonly svc: CommunityService) {}

  @Get('community/posts')
  @ApiOperation({
    summary: '글 목록',
    description:
      '공개된 글만 나옵니다. **검수 대기 글은 작성자 본인에게만** 보입니다 — ' +
      '안 보이면 "글이 사라졌다" 고 합니다.',
  })
  posts(@Query('board') board?: string, @Query('limit') limit?: number) {
    return this.svc.posts(board, limit);
  }

  @Get('community/board')
  @ApiOperation({
    summary: '글 목록 — 쪽 번호 · 게시글 검색',
    description:
      '소개광장 목록 화면이 씁니다. `{ items, total, page, size, pages }` 를 돌려줍니다. ' +
      '보이는 범위는 글 목록과 같습니다(공개 글 + 내 검수 대기 글). ' +
      '`q` 는 제목 · 본문에서 찾고(낱말이 모두 들어 있는 글 · 50자까지), `size` 는 1 ~ 50(기본 10)입니다. ' +
      '**작성자는 이름 첫 글자만 나갑니다**(김OO).',
  })
  @ApiQuery({ name: 'board', required: false, enum: ['REVIEW', 'TRADE', 'QNA', 'NOTICE'] })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'size', required: false })
  board(@Query('board') board?: unknown, @Query('q') q?: unknown,
        @Query('page') page?: unknown, @Query('size') size?: unknown) {
    return this.svc.board({ board, q, page, size });
  }

  @Get('community/posts/:id')
  @ApiOperation({ summary: '글 상세 · 댓글' })
  @ApiQuery({ name: 'orig', required: false, description: '1 이면 번역을 얹지 않고 원문(v10.105 · 「원문 보기」)' })
  post(@Param('id') id: string, @Query('orig') orig?: string) { return this.svc.post(id, orig === '1'); }

  @Post('community/posts/:id/translate')
  @ApiOperation({ summary: '번역 보기 (v10.105 · 다국어 3-3)', description: '화면 언어로 글 · 보이는 댓글을 번역해 저장합니다(다음 사람은 비용 없이). 스위치 i18n.board_on_view · AI 전체 · 월 상한 · 하루 횟수(회원 · 방문자). 금칙어에 걸린 칸은 원문 그대로.' })
  @ApiHeader({ name: 'X-Visitor-Key', required: false, description: '비회원 — 사이트 방문자 쿠키(sgb_visitor) 값(하루 횟수)' })
  @ApiOkResponse({ type: () => BoardTranslateOkDto })
  @ApiResponse({ status: 404, type: ErrorDto }) @ApiResponse({ status: 409, type: ErrorDto }) @ApiResponse({ status: 422, type: ErrorDto })
  translate(@Param('id') id: string, @Headers('x-visitor-key') visitorKey?: string) { return this.svc.translate(id, visitorKey); }

  @Post('community/classify')
  @ApiOperation({
    summary: '본문으로 게시판 추천',
    description:
      '어느 게시판인지 점수로 고릅니다. **애매하면 confident=false 로 ' +
      '돌려주고 작성자에게 묻습니다** — 억지로 넣으면 "내 글이 왜 저기 있냐" 가 됩니다.',
  })
  classify(@Body() dto: CommunityClassifyDto) { return this.svc.classify(dto.title, dto.body); }

  @ApiBearerAuth()
  @Post('me/community/posts')
  @Roles('MEMBER')
  @ApiOperation({
    summary: '글쓰기',
    description:
      '**첫 글은 검수를 거칩니다.** 두 번째부터 바로 올라갑니다. ' +
      '소개 후기는 성사된 거래가 있어야 쓸 수 있습니다.',
  })
  @Audit('POST_CREATE', 'POST')
  create(@Body() dto: CreatePostDto) { return this.svc.create(dto); }

  @ApiBearerAuth()
  @Patch('me/community/posts/:id')
  @Roles('MEMBER')
  @ApiOperation({ summary: '글 수정' })
  @Audit('POST_UPDATE', 'POST')
  update(@Param('id') id: string, @Body() dto: UpdatePostDto) {
    return this.svc.update(id, dto);
  }

  @ApiBearerAuth()
  @Delete('me/community/posts/:id')
  @Roles('MEMBER')
  @ApiOperation({
    summary: '글 삭제',
    description: '실제로 지우지 않고 감춥니다 — 댓글이 달렸으면 대화가 끊깁니다.',
  })
  @Audit('POST_DELETE', 'POST')
  remove(@Param('id') id: string) { return this.svc.remove(id); }

  @ApiBearerAuth()
  @Post('me/community/posts/:id/comments')
  @Roles('MEMBER')
  @ApiOperation({ summary: '댓글', description: '대댓글은 1단계까지입니다.' })
  @Audit('COMMENT_CREATE', 'POST')
  comment(@Param('id') id: string, @Body() dto: CreateCommentDto) {
    return this.svc.comment(id, dto);
  }

  @ApiBearerAuth()
  @Get('admin/community/queue')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '검수 큐',
    description: '첫 글과 신고 3건 이상인 글 · 신고 3건 이상인 댓글(v10.80 · reportedComments)입니다. **2일 넘게 밀리면 위에 뜹니다.**',
  })
  queue() { return this.svc.queue(); }

  @ApiBearerAuth()
  @Get('admin/community/posts')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '글 찾기 (운영)',
    description:
      '모든 글을 상태 · 게시판 · 검색어로 찾습니다(v10.72) — 신고가 쌓이기 전의 글을 감추거나, 감춘 글을 되살릴 때 씁니다. ' +
      '`{ items, total, page, size, pages }` · `size` 1 ~ 50(기본 20) · 작성자 이름은 그대로 나갑니다(운영 화면).',
  })
  @ApiQuery({ name: 'state', required: false, enum: ['PENDING', 'PUBLISHED', 'HIDDEN', 'DELETED'] })
  @ApiQuery({ name: 'board', required: false, enum: ['REVIEW', 'TRADE', 'QNA', 'NOTICE', 'FOOD'] })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'size', required: false })
  adminPosts(@Query('state') state?: unknown, @Query('board') board?: unknown, @Query('q') q?: unknown,
             @Query('page') page?: unknown, @Query('size') size?: unknown) {
    return this.svc.adminPosts({ state, board, q, page, size });
  }

  @ApiBearerAuth()
  @Post('admin/community/posts/:id/approve')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '글 승인' })
  @Audit('POST_APPROVE', 'POST')
  approve(@Param('id') id: string) { return this.svc.approve(id); }

  @ApiBearerAuth()
  @Post('admin/community/posts/:id/hide')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '글 감추기',
    description: '**사유를 반드시 적으십시오.** 안 적으면 작성자가 같은 글을 다시 씁니다.',
  })
  @Audit('POST_HIDE', 'POST')
  hide(@Param('id') id: string, @Body() dto: { reason: string }) {
    return this.svc.hide(id, dto.reason);
  }

  @ApiBearerAuth()
  @Post('admin/community/posts/:id/unhide')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '감춘 글 되살리기',
    description:
      '감춘 글(HIDDEN)만 다시 올립니다(v10.72). **사유를 반드시 적으십시오**(감사 기록). ' +
      '그 글의 처리 전 신고는 기각으로 닫고 신고 수를 0 으로 둡니다 — 새 신고 3건이 쌓여야 다시 가려집니다. ' +
      '작성자가 지운 글은 되살리지 않습니다(409).',
  })
  @Audit('POST_UNHIDE', 'POST')
  unhide(@Param('id') id: string, @Body() dto: { reason: string }) {
    return this.svc.unhide(id, dto?.reason);
  }

  @ApiBearerAuth()
  @Get('admin/community/posts/:id/comments')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '글의 댓글 (운영)',
    description:
      '그 글의 댓글을 상태와 관계없이 모두 보여 줍니다(v10.75) — 공개 · 감춤 · 지움 · 대댓글 관계 · 작성자 이름 그대로. ' +
      '`{ items[{ id, parentId, body, state, createdAt, hiddenAt, author }] }`',
  })
  adminComments(@Param('id') id: string) { return this.svc.adminComments(id); }

  @ApiBearerAuth()
  @Post('admin/community/comments/:id/hide')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '댓글 감추기',
    description:
      '공개 댓글만 감춥니다(v10.75). **사유를 반드시 적으십시오** — 답에 담겨 감사 기록 `COMMENT_HIDE` 에 남습니다. ' +
      '회원 화면에는 「운영 기준에 따라 가려진 댓글입니다.」로 보입니다. 공개 댓글이 아니면 409 `NOT_PUBLISHED`.',
  })
  @Audit('COMMENT_HIDE', 'COMMENT')
  hideComment(@Param('id') id: string, @Body() dto: { reason: string }) {
    return this.svc.hideComment(id, dto?.reason);
  }

  @ApiBearerAuth()
  @Post('admin/community/comments/:id/unhide')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '감춘 댓글 되살리기',
    description:
      '감춘 댓글만 다시 보이게 합니다(v10.75). **사유를 반드시 적으십시오**(감사 기록 `COMMENT_UNHIDE`). ' +
      '그 댓글의 처리 전 신고는 기각으로 닫고 신고 수를 0 으로 둡니다(v10.80 · 글 되살리기와 같음 — 새 신고 3건이 쌓여야 다시 가려짐). ' +
      '감춘 댓글이 아니면 409 `NOT_HIDDEN`.',
  })
  @Audit('COMMENT_UNHIDE', 'COMMENT')
  unhideComment(@Param('id') id: string, @Body() dto: { reason: string }) {
    return this.svc.unhideComment(id, dto?.reason);
  }
}
