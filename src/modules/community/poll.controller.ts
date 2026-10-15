import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PollService } from './poll.service';
import { CreatePollDto, PollAdminListDto, PollDto, PollVoteDto, PollVoteResultDto, PollWriteResultDto, UpdatePollDto } from './poll.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { ErrorDto } from '../../common/dto/common.dto';

/**
 * 소개광장 「이건 어때?」 투표 (D021).
 *
 * ── 보기 · 투표는 로그인 없이 됩니다 (사장님 결정 2026-10-02) ──
 * 회원은 1인 1표, 비로그인은 방문자(기기) 1표입니다. 비로그인 투표를 끄려면 설정 poll.guest_vote 를 off 로 둡니다.
 * 참여 수는 **실제 표 수**만 나갑니다 — 화면이 숫자를 꾸며 넣지 않습니다.
 * 만들기 · 열기 · 마감 · 감추기는 운영만 합니다.
 */
@ApiTags('COMMUNITY')
@Controller('api/v1')
export class PollController {
  constructor(private readonly svc: PollService) {}

  @Get('community/polls')
  @ApiOperation({
    summary: '투표 목록',
    description:
      '`scope=home` 이면 메인 「이건 어때?」에 낼 투표 — 종류마다 1건(비교해요 · 궁금해요 · 써본 의견이 필요해요 순).\n' +
      '없으면 열린 투표와 마감된 투표 전부. 준비 중 · 감춘 투표는 나오지 않습니다.\n\n' +
      '`myOptionId` 는 회원이면 계정, 비로그인이면 `X-Visitor-Key` 로 찾습니다. 사람마다 달라 캐시하지 마십시오.',
  })
  @ApiQuery({ name: 'scope', required: false, enum: ['home'] })
  @ApiHeader({ name: 'X-Visitor-Key', required: false, description: '사이트 방문자 쿠키(sgb_visitor) 값 — 내가 고른 보기를 찾는 데 씁니다' })
  @ApiOkResponse({ type: PollDto, isArray: true })
  list(@Query('scope') scope?: string, @Headers('x-visitor-key') visitorKey?: string) {
    return this.svc.list(scope, { visitorKey });
  }

  @Get('community/polls/:id')
  @ApiOperation({ summary: '투표 1건 · 결과' })
  @ApiHeader({ name: 'X-Visitor-Key', required: false })
  @ApiOkResponse({ type: PollDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  one(@Param('id') id: string, @Headers('x-visitor-key') visitorKey?: string) {
    return this.svc.one(id, { visitorKey });
  }

  @Post('community/polls/:id/vote')
  @HttpCode(201)
  @ApiOperation({
    summary: '투표하기',
    description:
      '로그인 없이 됩니다(설정 poll.guest_vote = on). 회원은 1인 1표, 비로그인은 방문자 키(`X-Visitor-Key`) 1표.\n\n' +
      '· 이미 투표 → 409 POLL_VOTED\n· 마감 → 422 POLL_CLOSED\n· 그 투표의 보기가 아님 → 422 POLL_OPTION\n' +
      '· 비로그인 투표가 꺼져 있음 → 401 POLL_LOGIN\n· 같은 주소의 하루 한도 초과 → 422 POLL_IP_LIMIT\n· 자동 프로그램 → 422 POLL_BOT\n\n' +
      '주소(IP)는 날짜를 섞은 해시로만 남깁니다(원문 저장 없음). 넣은 표는 바꿀 수 없습니다.',
  })
  @ApiHeader({ name: 'X-Visitor-Key', required: false, description: '비로그인이면 필수 — 사이트 방문자 쿠키(sgb_visitor) 값, 영문·숫자·하이픈 8~64자' })
  @ApiCreatedResponse({ type: PollVoteResultDto })
  @ApiResponse({ status: 401, type: ErrorDto, description: 'POLL_LOGIN — 비로그인 투표가 꺼져 있음' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'POLL_VOTED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'POLL_CLOSED · POLL_OPTION · POLL_IP_LIMIT · POLL_BOT' })
  vote(
    @Param('id') id: string,
    @Body() dto: PollVoteDto,
    @Headers('x-visitor-key') visitorKey?: string,
    @Headers('user-agent') ua?: string,
    @Headers('x-forwarded-for') xff?: string,
    @Ip() ip?: string,
  ) {
    return this.svc.vote(id, dto.optionId, { visitorKey, ua, ip: (xff?.split(',')[0]?.trim() || ip) ?? undefined });
  }

  /* ── 운영 BO ──────────────────────────────────────────────── */

  @ApiBearerAuth()
  @Get('admin/community/polls')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '투표 관리 목록', description: '준비 중 · 감춘 것까지 전부. 보기별 실제 표 수와 메인 노출 여부(onHome)가 함께 나옵니다.' })
  @ApiOkResponse({ type: PollAdminListDto })
  adminList() { return this.svc.adminList(); }

  @ApiBearerAuth()
  @Post('admin/community/polls')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '투표 만들기',
    description: '**만들면 준비 중(DRAFT)** 입니다 — 열기(state=OPEN)를 해야 보이고 투표를 받습니다. 비교해요는 보기 2개, 궁금해요 2 ~ 8개, 써본 의견 2 ~ 5개.',
  })
  @ApiCreatedResponse({ type: PollWriteResultDto })
  @Audit('POLL_CREATE', 'POLL')
  create(@Body() dto: CreatePollDto) { return this.svc.create(dto); }

  @ApiBearerAuth()
  @Patch('admin/community/polls/:id')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '투표 수정 · 열기 · 마감 · 감추기',
    description:
      '**표가 들어온 뒤에는 보기를 바꿀 수 없습니다**(422 POLL_LOCKED) — 결과가 달라지기 때문입니다. ' +
      '감출 때는 사유(5자 이상)가 필요합니다.',
  })
  @ApiOkResponse({ type: PollWriteResultDto })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'POLL_LOCKED · POLL_OPTIONS · POLL_ENDS_AT · POLL_HIDE_REASON' })
  @Audit('POLL_UPDATE', 'POLL')
  update(@Param('id') id: string, @Body() dto: UpdatePollDto) { return this.svc.update(id, dto); }
}
