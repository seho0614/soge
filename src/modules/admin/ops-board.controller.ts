import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { OpsBoardService, BOARD_KINDS } from './ops-board.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { StrictBoolean } from '../../common/strict-boolean';

/** v10.286 (D213 · docs/412) 운영자 게시판 — 운영 화면 계정만 */
const STAFF = ['REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF'] as const;

export class OpsBoardPostDto {
  @ApiProperty({ example: '야간 점검 인계' }) @IsString() @Length(1, 200) title!: string;
  @ApiProperty({ example: '디스크 정리함 · 내일 아침 백업 확인' }) @IsString() @Length(1, 20000) body!: string;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() isPinned?: boolean;
}
export class OpsBoardPatchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 20000) body?: string;
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() isPinned?: boolean;
  @ApiPropertyOptional({ description: '고치는 까닭(선택)' }) @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
export class OpsBoardReasonDto {
  @ApiProperty({ description: '내리는 사유(2자 이상)' }) @IsString() @Length(2, 300) reason!: string;
}
export class OpsBoardCommentDto {
  @ApiProperty({ example: '확인 — 백업 다시 돌림' }) @IsString() @Length(1, 2000) body!: string;
}

@ApiTags('ADMIN')
@ApiBearerAuth()
@Controller('api/v1/admin/ops-board')
@Roles(...STAFF)
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class OpsBoardController {
  constructor(private readonly svc: OpsBoardService) {}

  @Get()
  @ApiOperation({ summary: '운영자 게시판 목록', description: 'v10.286 (D213) 자동 글(하루 요약 · 급한 알림 · 대표 할 일 · 시험) · 운영자 글 — 고정 먼저 · 50줄씩 · 운영 화면 계정만.' })
  @ApiQuery({ name: 'kind', required: false, enum: BOARD_KINDS })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD(한국)' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD(한국)' })
  @ApiQuery({ name: 'unread', required: false, description: '1 이면 내가 「확인함」 안 누른 것만' })
  @ApiQuery({ name: 'page', required: false })
  @ApiOkResponse({ type: Object })
  list(@Query('kind') kind?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('unread') unread?: string, @Query('page') page?: string) {
    const ymd = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    return this.svc.list({ kind, from: ymd(from), to: ymd(to), unread: unread === '1', page: Number(page) || 1 });
  }

  @Get(':id')
  @ApiOperation({ summary: '운영자 게시판 글', description: 'v10.286 (D213) 본문 · 보낸 결과 · 댓글 · 확인한 사람 · 고친 기록.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  @ApiOperation({ summary: '운영자 글쓰기', description: 'v10.286 (D213) 운영자끼리 메모 · 인계(쓴 사람은 「확인함」으로 셈).' })
  @ApiOkResponse({ type: Object })
  @Audit('OPS_BOARD_POST', 'OPS_BOARD')
  create(@Body() dto: OpsBoardPostDto) { return this.svc.create(dto); }

  @Patch(':id')
  @ApiOperation({ summary: '운영자 글 고치기', description: 'v10.286 (D213) 쓴 사람 · SUPER — 제목 · 본문(전 내용 기록) · 고정 · 자동 글은 고정만(SUPER).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, description: 'NOT_AUTHOR', type: ErrorDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'AUTO_POST_LOCKED · POST_TAKEN_DOWN', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'NO_CHANGE', type: ErrorDto })
  @Audit('OPS_BOARD_UPDATE', 'OPS_BOARD')
  update(@Param('id') id: string, @Body() dto: OpsBoardPatchDto) { return this.svc.update(id, dto); }

  @Post(':id/take-down')
  @ApiOperation({ summary: '운영자 게시판 글 내리기', description: 'v10.286 (D213) 쓴 사람 · SUPER — 지우지 않고 「내림」(사유).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, description: 'NOT_AUTHOR', type: ErrorDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'POST_TAKEN_DOWN', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'REASON_REQUIRED', type: ErrorDto })
  @Audit('OPS_BOARD_TAKE_DOWN', 'OPS_BOARD')
  takeDown(@Param('id') id: string, @Body() dto: OpsBoardReasonDto) { return this.svc.takeDown(id, dto.reason); }

  @Post(':id/comments')
  @ApiOperation({ summary: '운영자 게시판 댓글', description: 'v10.286 (D213) 모든 글(자동 글도) · 고칠 수 없음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @Audit('OPS_BOARD_COMMENT', 'OPS_BOARD')
  comment(@Param('id') id: string, @Body() dto: OpsBoardCommentDto) { return this.svc.comment(id, dto.body); }

  @Post(':id/read')
  @ApiOperation({ summary: '운영자 게시판 「확인함」', description: 'v10.286 (D213) 누가 언제 확인했는지 남김(한 번).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  read(@Param('id') id: string) { return this.svc.read(id); }
}
