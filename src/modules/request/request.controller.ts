import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StateConflict } from '../../core/errors';
import { sendImage } from '../file/attach-images';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequestService } from './request.service';
import {
  CreateProposalDto, CreateRequestDto, DecideProposalDto, ProposalDto, RequestCardDto, RequestDetailDto,
} from './request.dto';
import { ErrorDto } from '../../common/dto/common.dto';
import { RequireGate, Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/** SB-HOM-REQ-010 / 020 / 030 */
@ApiTags('HOM')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
@Controller('api/v1/requests')
export class RequestController {
  constructor(private readonly service: RequestService) {}

  @Get()
  @ApiOperation({ summary: '소개받기 목록' })
  @ApiQuery({ name: 'gwanCode', required: false, enum: ['MNY', 'MAL', 'BIZ', 'HLT'] })
  @ApiQuery({ name: 'q', required: false, description: 'v10.31 — 제목 · 업종 · 지역 검색어' })
  @ApiQuery({ name: 'closing', required: false, description: 'v10.31 — 1 이면 7일 안에 마감되는 요청만(시안 「마감 임박」)' })
  @ApiQuery({ name: 'sort', required: false, enum: ['CLOSING', 'RECENT', 'FEE'], description: 'v10.31 — 기본 마감 임박순(시안)' })
  @ApiOkResponse({ type: RequestCardDto, isArray: true })
  list(@Query('gwanCode') gwanCode?: string, @Query('limit') limit?: number,
    @Query('q') q?: string, @Query('closing') closing?: string, @Query('sort') sort?: string) {
    return this.service.list({ gwanCode, limit, q: typeof q === 'string' ? q : undefined, closing: closing === '1' || closing === 'true', sort });
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '요청 상세',
    description:
      '**처음 열 때 한 번 셉니다** (B-13R2). 같은 요청 재열람은 세지 않습니다 — ' +
      '실수로 닫았다고 한도가 깎이면 항의가 들어옵니다. ' +
      '`viewCharged` 로 이번 호출에서 세어졌는지, `viewLimit` 로 한도 상태를 알 수 있습니다.\n\n' +
      '한도는 운영 설정입니다(D011): `request.view.limit=off`(홍보 기간)면 아무도 막지 않고, `on` 이면 ' +
      '무료 요금제와 구독 없는 일반 회원은 같은 값(`request.view.free_monthly`), 유료 요금제는 요금제 값을 씁니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RequestDetailDto })
  @ApiResponse({
    status: 422, type: ErrorDto,
    description: 'VIEW_QUOTA_EXCEEDED — 월 열람 한도 초과. 업그레이드 화면으로 안내하십시오',
  })
  @ApiResponse({ status: 404, description: '없거나 노출 중이 아님', type: ErrorDto })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Post()
  @ApiBearerAuth()
  /* 개인회원도 요청을 등록할 수 있습니다.
   *
   * 예전에는 BIZ_OWNER · BIZ_STAFF 전용이었습니다. 모든 거래가 B2B 라는
   * 전제였는데, 그 전제가 바뀌었습니다 — 개인도 "이런 업체를 찾습니다"를
   * 올릴 수 있어야 소개자가 응답할 대상이 생깁니다.
   *
   * (v10.37 · D095 — 요청 등록 · 소개 제안은 본인인증 개인도 합니다. 사업자만은 안심소개 · 소개몰 · 소개창업 등록뿐)
   * 사는 쪽과 파는 쪽의 문턱이 같을 이유가 없습니다 —
   * 통신판매중개자의 책임은 파는 쪽에서 생깁니다. */
  @Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({ summary: '소개받기 등록', description: '등록 즉시 검수 큐로 들어갑니다.' })
  @ApiResponse({ status: 422, description: '정책 위반', type: ErrorDto })
  @Audit('REQUEST_CREATE', 'REQUEST')
  create(@Body() dto: CreateRequestDto) {
    return this.service.create({ ...dto });
  }

  /* v10.31 — 요청 대표 · 상세 이미지(시안 「소개받기 등록하기」). 상세와 같은 공개 범위 */
  @Get(':id/images/:n')
  @ApiOperation({ summary: '요청 이미지', description: 'n = 0(대표) ~ 5. 공개 범위(전체 · 회원 · 인증 회원)를 따릅니다. 없으면 409 NOT_FOUND.' })
  @ApiParam({ name: 'id', format: 'uuid' }) @ApiParam({ name: 'n', example: 0 })
  @ApiResponse({ status: 409, description: 'NOT_FOUND', type: ErrorDto })
  async image(@Param('id') id: string, @Param('n') n: string, @Res() res: Response) {
    const k = /^[0-5]$/.test(n) && /^[0-9a-f-]{36}$/i.test(id) ? Number(n) : -1;
    if (k < 0) throw new StateConflict('NOT_FOUND', '이미지가 없습니다.');
    sendImage(res, await this.service.image(id, k));
  }

  @Get(':id/proposals')
  @ApiBearerAuth()
  @ApiOperation({ summary: '제안 목록' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ProposalDto, isArray: true })
  proposals(@Param('id') id: string) {
    return this.service.proposals(id);
  }

  @Post(':id/proposals')
  @ApiBearerAuth()
  /* v10.37 (D095 · 10/13 대표 지시) — 모든 업무는 개인 회원(본인인증)도 합니다. 사업자만은 안심소개 · 소개몰 · 소개창업 등록뿐 */
  @Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '소개 제안',
    description: '요청 1건당 1회만 제안할 수 있습니다. 수락되면 귀속이 성립합니다 (B-16).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'ALREADY_PROPOSED', type: ErrorDto })
  @Audit('PROPOSAL_CREATE', 'REQUEST')
  propose(@Param('id') id: string, @Body() dto: CreateProposalDto) {
    return this.service.propose(id, dto);
  }

  /* v10.31 — 시안 prop 「거절 / 수락하고 대화 시작」. 요청한 분만. 수락하면 1:1 대화가 열립니다 */
  @Post(':id/proposals/:pid/decision')
  @ApiBearerAuth()
  @Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
  @ApiOperation({
    summary: '제안 수락 · 거절',
    description: '요청한 분만 합니다. ACCEPT 면 제안한 분과의 1:1 대화를 열고(conversationId) 그 시점에 귀속이 성립합니다(B-16).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'pid', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'NOT_REQUEST_OWNER', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'ALREADY_DECIDED', type: ErrorDto })
  @Audit('PROPOSAL_DECIDE', 'REQUEST')
  decide(@Param('id') id: string, @Param('pid') pid: string, @Body() dto: DecideProposalDto) {
    return this.service.decide(id, pid, dto.decision === 'ACCEPT');
  }
}
