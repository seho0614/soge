import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PublicService } from './public.service';
import {
  CreateDisputeDto, CreateInquiryDto, CreateReviewDto, FaqDto,
  IdentityResultDto, IdentityVerifyDto, RequestSettlementDto, SearchResultDto,
} from './public.dto';
import { ErrorDto } from '../../common/dto/common.dto';
import { GwanDto } from '../catalog/catalog.dto';
import { NoticeDto } from '../site/site.dto';
import { Roles, RequireGate } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/** SB-HOM-AUT-030 · SRC-010 · CSB-010 · ETC-010/020/030 · {G}-MAIN-010 */
@ApiTags('HOM')
@Controller('api/v1')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class PublicController {
  constructor(private readonly svc: PublicService) {}

  @Post('verifications/identity')
  @ApiBearerAuth()
  @Roles('MEMBER')
  @ApiOperation({
    summary: '본인인증',
    description:
      'PASS 계약 전까지 스텁입니다. 응답의 stub 이 true 면 **실제 확인이 이루어지지 않았습니다** — ' +
      '화면에 그대로 표시하십시오.',
  })
  @ApiOkResponse({ type: IdentityResultDto })
  @Audit('IDENTITY_VERIFY', 'ACCOUNT')
  verify(@Body() dto: IdentityVerifyDto) {
    return this.svc.verifyIdentity(dto.provider ?? 'PASS');
  }

  @Get('search')
  @ApiOperation({
    summary: '통합 검색',
    description: '매물과 소개받기 요청을 함께 봅니다. pg_trgm 유사도 정렬입니다.',
  })
  @ApiQuery({ name: 'q', required: true })
  @ApiOkResponse({ type: SearchResultDto })
  @ApiResponse({ status: 422, description: 'QUERY_TOO_SHORT', type: ErrorDto })
  search(@Query('q') q: string, @Query('limit') limit?: number) {
    return this.svc.search(q, limit ?? 20);
  }

  @Get('gwans/:code')
  @ApiOperation({ summary: '관 단건' })
  @ApiParam({ name: 'code', enum: ['MNY', 'MAL', 'BIZ', 'HLT'] })
  @ApiOkResponse({ type: GwanDto })
  gwan(@Param('code') code: string) { return this.svc.gwan(code); }

  @Get('site-settings/public')
  @ApiOperation({
    summary: '공개 설정',
    description: '푸터 법정 고지가 여기서 옵니다. 비어 있으면 화면이 점선으로 표시합니다.',
  })
  settings() { return this.svc.publicSettings(); }

  @Get('faq')
  @ApiOperation({
    summary: '자주 묻는 질문',
    description: '관리자가 바꿉니다. 화면에 하드코딩하지 마십시오.',
  })
  @ApiQuery({ name: 'gwanCode', required: false })
  @ApiQuery({ name: 'channel', required: false, enum: ['FAQ', 'CS', 'GUIDE', 'BOT'], description: 'v10.31 — 어디에 보일 글인지(기본 FAQ)' })
  @ApiOkResponse({ type: FaqDto, isArray: true })
  faq(@Query('gwanCode') gwanCode?: string, @Query('channel') channel?: string) { return this.svc.faq(gwanCode, channel); }

  @Get('ui-messages')
  @ApiOperation({
    summary: '화면 고정 문구',
    description:
      '법적 근거가 있는 안내 문구입니다 — 광고 표시, 귀속 안내, 공제 없음 등. ' +
      '화면에 하드코딩하면 법령이 바뀔 때 배포가 필요해집니다.',
  })
  uiMessages() { return this.svc.uiMessages(); }

  @Get('gwans/:code/form-copy')
  @ApiOperation({
    summary: '관별 등록 폼 문구',
    description: '소개장터는 "상품·서비스", 소개창업은 "사업 기회"입니다.',
  })
  @ApiParam({ name: 'code', enum: ['MNY', 'MAL', 'BIZ', 'HLT'] })
  formCopy(@Param('code') code: string) { return this.svc.formCopy(code); }

  @Get('notices')
  @ApiOperation({ summary: '공지' })
  @ApiQuery({ name: 'gwanCode', required: false })
  @ApiOkResponse({ type: NoticeDto, isArray: true })
  notices(@Query('gwanCode') gwanCode?: string) { return this.svc.notices(gwanCode); }

  @Post('inquiries')
  @ApiOperation({
    summary: '고객센터 문의',
    description: '비로그인도 가능합니다. 그 경우 회신 이메일이 필수입니다.',
  })
  @ApiResponse({ status: 422, description: 'EMAIL_REQUIRED', type: ErrorDto })
  inquiry(@Body() dto: CreateInquiryDto) { return this.svc.createInquiry(dto); }

  @Post('disputes')
  @ApiBearerAuth()
  /* v10.33 (10/11 대표 결정 「분쟁 접수는 모두 가능」) — 개인 회원도 거래 당사자 · 소개자면 접수합니다(전: 사업자 인증 회원만).
   *   누가 접수할 수 있는지는 거래 당사자 확인(NOT_A_PARTY)이 정합니다 — 거래는 본인인증을 거쳐야 생깁니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '분쟁 접수',
    description: '거래 당사자(구매자 · 판매자 · 소개자)면 개인 · 사업자 모두 접수합니다. 접수하면 **해당 거래의 정산이 자동으로 보류됩니다** (B-11).',
  })
  @ApiResponse({
    status: 409, type: ErrorDto,
    description: 'NOT_A_PARTY · ALREADY_OPEN',
  })
  @Audit('DISPUTE_OPEN', 'DISPUTE')
  dispute(@Body() dto: CreateDisputeDto) { return this.svc.createDispute(dto); }

  @Post('deals/:id/reviews')
  @ApiBearerAuth()
  /* v10.31 — 개인 회원도 거래 당사자일 수 있습니다(문의는 개인도 함 · 결정 ⑤). 당사자 확인은 서비스 · DB 트리거가 합니다 */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '후기 작성',
    description:
      '성사가 확정된 거래에만, 그 거래의 당사자(구매자 · 판매자)가 남길 수 있습니다 (INV-5). ' +
      '대상은 그 거래의 소개자이고, 소개자가 없는 거래는 상대방입니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 403, description: 'NOT_PARTY — 거래 당사자가 아님', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'NOT_CONFIRMED · REVIEW_EMPTY(칩 없이 내용 10자 미만)', type: ErrorDto })
  @Audit('DEAL_REVIEW', 'DEAL')
  review(@Param('id') id: string, @Body() dto: CreateReviewDto) {
    return this.svc.createReview(id, dto.rating, dto.body, dto.tags);
  }

  @Post('settlements')
  @ApiBearerAuth()
  /* v10.28 (지시서 5절) — 사업자 인증 → **본인인증**. 사업자는 사업자로(INV-10), 아니면 개인으로(INV-10R · 확인된 받을 계좌) 받습니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '정산 신청 — 소개비 받기',
    description:
      '보통은 성사 확정 시 트리거가 자동으로 만듭니다. 이 API 는 자동 생성이 안 된 경우(개인이 계좌를 나중에 확인한 경우 등)의 수동 경로입니다.\n\n' +
      '자격: 본인인증 + 그 거래의 소개자. 사업자 인증이 있으면 사업자로, 없으면 개인으로 받으며 개인은 **본인 명의로 확인된 받을 계좌**가 있어야 합니다. ' +
      '소개비는 당사자끼리 직접 지급합니다(INV-11). 소개비 기능(feature.referral_fee)이 꺼져 있으면 약정이 없어 422 입니다.',
  })
  @ApiResponse({ status: 403, description: 'NOT_PARTY(소개자 아님) · 본인인증 전', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'ALREADY_REQUESTED · ACCOUNT_REQUIRED(받을 계좌 미확인)', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'INV-9 · INV-10 · INV-10R', type: ErrorDto })
  @Audit('SETTLEMENT_REQUEST', 'SETTLEMENT')
  settlement(@Body() dto: RequestSettlementDto) {
    return this.svc.requestSettlement(dto.dealId);
  }
}
