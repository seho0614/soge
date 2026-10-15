import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MarketService } from './market.service';
import { SafetyService } from './safety.service';
import { BizAxisService } from './biz-axis.service';
import {
  BizAxisAnswerDto, BizAxisItemDto, BizAxisRequestDto, BizAxisStatusDto, BrokerExtraDto, CreateStoryDto, HideDto,
  PatchRequestExtraDto, QuickMatchDto, SafetyCaseDto, StoryConsentDto, UpdateStoryDto,
} from './market.dto';
import { ErrorDto } from '../../common/dto/common.dto';
import { RequireGate, Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

const ALL = ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER'] as const;
const GWANS = ['MNY', 'MAL', 'BIZ', 'HLT'];
const gw = (g?: string) => (g && GWANS.includes(g) ? g : undefined);
const OBJ = { schema: { type: 'object' } };

function pipe(res: Response, r: { stream: NodeJS.ReadableStream; contentType: string; size: number }) {
  res.status(200);
  res.setHeader('Content-Type', r.contentType); res.setHeader('Content-Length', String(r.size));
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  r.stream.on('error', () => res.destroy());
  r.stream.pipe(res);
}

/**
 * v10.31 (w2 · 10/10 「시안 기준」) — 관 화면 시안 구역의 서버.
 *   소개장터 메인 7구역(많이 찾는 키워드 · 서비스 업체 추천 · AI 추천 맞춤 공급자 · 띠 광고(ads GBAND) · 최근 실제 연결 사례 · 지역으로 찾기 · 요청 종류 탭)
 *   과 퀵메뉴(성공현황 · 베스트매칭)의 자료입니다. 숫자는 모두 기록에서 셉니다.
 */
@ApiTags('MKT')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
@Controller('api/v1')
export class MarketController {
  constructor(private readonly svc: MarketService) {}

  @Get('market/regions')
  @ApiOperation({ summary: '지역으로 찾기 — 시 · 도와 게시 매물 수', description: '시안 순서 9곳 + 「기타 지역」. 매물 지역이 없으면 인증 사업장 주소로 셉니다.' })
  @ApiQuery({ name: 'gwanCode', required: false, enum: GWANS })
  @ApiOkResponse(OBJ)
  regions(@Query('gwanCode') g?: string) { return this.svc.regions(gw(g)); }

  @Get('search/keywords')
  @ApiOperation({
    summary: '많이 찾는 키워드',
    description: '검색어 통계(search_term_stats · 정규화된 말만 · INV-SCH2)에서 결과가 나온 말을 많이 찾은 순으로. 제한 업종 낱말은 뺍니다. ' +
      'gwanCode 를 주면 그 관의 게시 매물에 실제로 걸리는 말만. 검색 팝업 추천 칩(GET /search/suggest keywords)과 같은 규칙 · 쌓는 곳은 POST /search/log.',
  })
  @ApiQuery({ name: 'gwanCode', required: false, enum: GWANS }) @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse(OBJ)
  keywords(@Query('gwanCode') g?: string, @Query('limit') limit?: string) { return this.svc.keywords(gw(g), Number(limit) || 5); }

  @Get('market/requests')
  @ApiOperation({ summary: '지금 올라온 소개 요청 — 종류 · 지역 · 사진', description: '시안 소개장터 메인의 요청 구역(종류 탭 6). 지역은 요청에 넣은 시 · 도, 없으면 요청자의 인증 사업장 주소.' })
  @ApiQuery({ name: 'gwanCode', required: false, enum: GWANS })
  @ApiQuery({ name: 'kind', required: false, enum: ['GOODS', 'SERVICE', 'EXPERT', 'COMPANY', 'USED'] })
  @ApiQuery({ name: 'regionCode', required: false }) @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse(OBJ)
  requests(@Query('gwanCode') g?: string, @Query('kind') kind?: string, @Query('regionCode') regionCode?: string, @Query('limit') limit?: string) {
    const k = ['GOODS', 'SERVICE', 'EXPERT', 'COMPANY', 'USED'].includes(String(kind)) ? kind : undefined;
    return this.svc.requests({ gwanCode: gw(g), kind: k, regionCode: regionCode && /^\d{2,10}$/.test(regionCode) ? regionCode : undefined, limit: Number(limit) || 4 });
  }

  @Patch('market/requests/:id')
  @ApiBearerAuth()
  @Roles(...ALL)
  @ApiOperation({ summary: '내 요청의 종류 · 지역 · 사진', description: '요청자 본인만. 사진은 올리기를 마친 REQUEST_IMAGE 파일(본인 것 · DB 가 봅니다).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 422, description: 'REQUEST_PHOTO_FILE', type: ErrorDto })
  @Audit('REQUEST_EXTRA_UPDATE', 'REQUEST')
  patchRequest(@Param('id') id: string, @Body() dto: PatchRequestExtraDto) { return this.svc.patchRequest(id, dto); }

  @Get('market/requests/:id/photo')
  @ApiOperation({ summary: '요청 사진 (공개)', description: '게시 중인 요청만(요청자는 늘). 없으면 404.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 404, description: '사진 없음', type: ErrorDto })
  async requestPhoto(@Param('id') id: string, @Res() res: Response) { pipe(res, await this.svc.requestPhoto(id)); }

  @Get('market/success')
  @ApiOperation({
    summary: '성공현황',
    description: '숫자 5칸(총 성공 · 총 소개 수익 · 진행 중 · 이번 달 성공 · 이번 달 소개 수익) · 최근 7일 추이 · 분류별 비중 · 지역별 · Top 소개왕 · 최근 성공 사례. ' +
      '성사 확정 거래(v_success_deals)에서 셉니다. period = all | 7d | month | year(숫자 5칸 · 추이 밖의 표에 적용). 이름은 첫 글자만 · 개인 소개자 수익은 본인 공개 시만.',
  })
  @ApiQuery({ name: 'gwanCode', required: false, enum: GWANS }) @ApiQuery({ name: 'period', required: false, enum: ['all', '7d', 'month', 'year'] })
  @ApiOkResponse(OBJ)
  success(@Query('gwanCode') g?: string, @Query('period') period?: string) { return this.svc.success({ gwanCode: gw(g), period }); }

  @Get('market/success/recent')
  @ApiOperation({ summary: '최근 실제 연결 사례', description: '성사 확정 거래 최근 순(소개장터 메인 · 3건). 문의 수 → 1곳 연결.' })
  @ApiQuery({ name: 'gwanCode', required: false, enum: GWANS }) @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse(OBJ)
  recent(@Query('gwanCode') g?: string, @Query('limit') limit?: string) { return this.svc.recentCases(gw(g), Number(limit) || 3); }

  @Get('market/best')
  @ApiOperation({ summary: '베스트매칭 사례', description: '운영이 고르고 두 당사자가 공개에 동의한 성사 사례. 거래금액 · 소개비 · 성사기간 · 매칭 과정은 거래 기록에서 읽습니다.' })
  @ApiQuery({ name: 'gwanCode', required: false, enum: GWANS })
  @ApiOkResponse(OBJ)
  best(@Query('gwanCode') g?: string) { return this.svc.best(gw(g)); }

  @Get('market/suppliers')
  @ApiOperation({ summary: '서비스 업체 추천 — 업체 단위 목록', description: '그 관에 게시 매물이 있는 인증 사업자. 신뢰도 · 평점 · 성사 순(광고 아님).' })
  @ApiQuery({ name: 'gwanCode', required: false, enum: GWANS }) @ApiQuery({ name: 'regionCode', required: false })
  @ApiQuery({ name: 'categoryId', required: false }) @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse(OBJ)
  suppliers(@Query('gwanCode') g?: string, @Query('regionCode') r?: string, @Query('categoryId') c?: string, @Query('limit') limit?: string) {
    return this.svc.suppliers({ gwanCode: gw(g), regionCode: r && /^\d{2,10}$/.test(r) ? r : undefined,
      categoryId: c && /^[0-9a-f-]{36}$/i.test(c) ? c : undefined, limit: Number(limit) || 4 });
  }

  @Get('market/suppliers/recommended')
  @ApiOperation({
    summary: 'AI 추천 맞춤 공급자',
    description: '서버 계산 가중 합산(recommend_weights 5항목 · 협업 필터링 아님). 내 활동(관심 · 요청 분류)은 맞춤형 광고 동의(ADPERSONAL)가 있을 때만 씁니다. 광고는 순위에 넣지 않습니다.',
  })
  @ApiQuery({ name: 'gwanCode', required: false, enum: GWANS }) @ApiQuery({ name: 'regionCode', required: false })
  @ApiQuery({ name: 'exclude', required: false, description: '뺄 업체 id(쉼표)' }) @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse(OBJ)
  recommended(@Query('gwanCode') g?: string, @Query('regionCode') r?: string, @Query('exclude') exclude?: string, @Query('limit') limit?: string) {
    return this.svc.recommended({ gwanCode: gw(g), regionCode: r && /^\d{2,10}$/.test(r) ? r : undefined, exclude, limit: Number(limit) || 4 });
  }

  @Get('market/suppliers/:id')
  @ApiOperation({ summary: '업체 프로필', description: '공개 정보 · 게시 매물 · 후기(이름 첫 글자) · 신뢰도 항목. 대표자 · 연락처 · 사업자번호는 내보내지 않습니다.' })
  @ApiParam({ name: 'id', format: 'uuid' }) @ApiQuery({ name: 'gwanCode', required: false, enum: GWANS })
  @ApiResponse({ status: 404, type: ErrorDto })
  @ApiOkResponse(OBJ)
  supplier(@Param('id') id: string, @Query('gwanCode') g?: string) { return this.svc.supplier(id, gw(g)); }

  @Get('me/success-stories')
  @ApiBearerAuth() @Roles(...ALL)
  @ApiOperation({ summary: '내가 당사자인 베스트매칭 사례(공개 동의)' })
  @ApiOkResponse(OBJ)
  myStories() { return this.svc.myStories(); }

  @Post('market/success-stories/:id/consent')
  @ApiBearerAuth() @Roles(...ALL)
  @ApiOperation({ summary: '베스트매칭 사례 공개 동의 · 철회', description: '거래 당사자(매도자 · 매수자)만. 매도자는 한마디 · 별점을 함께 남길 수 있습니다. 철회하면 공개 중인 사례를 내립니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @Audit('SUCCESS_STORY_CONSENT', 'DEAL')
  consent(@Param('id') id: string, @Body() dto: StoryConsentDto) { return this.svc.consentStory(id, dto); }

  @Get('me/broker/extra')
  @ApiBearerAuth() @Roles(...ALL)
  @ApiOperation({ summary: '내 중개사 인증 — 보증(공제) · 제출 서류' })
  @ApiOkResponse(OBJ)
  brokerExtra() { return this.svc.brokerExtra(); }

  @Put('me/broker/extra')
  @ApiBearerAuth() @Roles(...ALL)
  @ApiOperation({ summary: '내 중개사 인증 — 보증(공제) · 제출 서류 저장', description: '신청(POST /partner/broker) 뒤에 씁니다. 서류 파일은 BROKER_DOC(본인 · 운영만 열람).' })
  @ApiResponse({ status: 409, description: 'BROKER_NOT_APPLIED', type: ErrorDto })
  @Audit('BROKER_EXTRA', 'BUSINESS')
  putBrokerExtra(@Body() dto: BrokerExtraDto) { return this.svc.putBrokerExtra(dto); }
}

/** 운영 — 베스트매칭 사례 · 피해 사례 숨김 */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class MarketAdminController {
  constructor(private readonly svc: MarketService, private readonly safety: SafetyService) {}

  @Get('success-stories')
  @ApiOperation({ summary: '베스트매칭 사례 목록(운영)' })
  @ApiOkResponse(OBJ)
  stories() { return this.svc.adminStories(); }

  @Post('success-stories')
  @ApiOperation({ summary: '베스트매칭 사례 만들기', description: '성사 확정 거래로 초안을 만들고 두 당사자에게 공개 동의를 요청합니다.' })
  @Audit('SUCCESS_STORY_CREATE', 'DEAL')
  createStory(@Body() dto: CreateStoryDto) { return this.svc.createStory(dto); }

  @Patch('success-stories/:id')
  @ApiOperation({ summary: '베스트매칭 사례 고치기 · 공개 · 숨김', description: 'PUBLISHED 는 두 당사자 동의 뒤에만(STORY_CONSENT_REQUIRED).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 422, description: 'STORY_CONSENT_REQUIRED', type: ErrorDto })
  @Audit('SUCCESS_STORY_UPDATE', 'DEAL')
  updateStory(@Param('id') id: string, @Body() dto: UpdateStoryDto) { return this.svc.updateStory(id, dto); }

  @Get('safety/cases')
  @ApiOperation({ summary: '피해 사례 목록(운영 · 숨긴 것 포함)' })
  @ApiOkResponse(OBJ)
  cases() { return this.safety.adminList(); }

  @Post('safety/cases/:no/hide')
  @ApiOperation({ summary: '피해 사례 숨기기(사유 필수)' })
  @ApiParam({ name: 'no' })
  @Audit('SAFETY_CASE_HIDE', 'POST')
  hide(@Param('no', ParseIntPipe) no: number, @Body() dto: HideDto) { return this.safety.hide(no, dto.reason); }
}

/** 사고예방 — 피해 사례 게시판 · 안전거래(B-04) */
@ApiTags('MKT')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
@Controller('api/v1')
export class SafetyController {
  constructor(private readonly svc: SafetyService) {}

  @Get('safety/cases')
  @ApiOperation({ summary: '피해 사례 게시판', description: '유형 탭(CONTRACT · PAYMENT · GOODS · PRIVACY · ETC) · 쪽 번호. 작성자는 내보내지 않습니다.' })
  @ApiQuery({ name: 'type', required: false }) @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse(OBJ)
  list(@Query('type') type?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    const t = ['CONTRACT', 'PAYMENT', 'GOODS', 'PRIVACY', 'ETC'].includes(String(type)) ? type : undefined;
    return this.svc.list({ type: t, page: Number(page) || 1, limit: Number(limit) || 5 });
  }

  @Get('safety/cases/:no')
  @ApiOperation({ summary: '피해 사례 보기(조회 수 +1)' })
  @ApiParam({ name: 'no' })
  @ApiResponse({ status: 404, type: ErrorDto })
  detail(@Param('no', ParseIntPipe) no: number) { return this.svc.detail(no); }

  @Post('safety/cases')
  @ApiBearerAuth() @Roles(...ALL) @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({ summary: '피해 사례 작성', description: '본인인증 회원 · 하루 3건. 연락처 · 이메일 · 계좌번호는 저장 전에 가립니다. 금칙어는 막습니다.' })
  @ApiResponse({ status: 422, description: 'SAFETY_CASE_RATE · BANNED_WORD', type: ErrorDto })
  @Audit('SAFETY_CASE_CREATE', 'POST')
  create(@Body() dto: SafetyCaseDto) { return this.svc.create(dto); }

  @Get('safety/safe-trade')
  @ApiOperation({ summary: '안전거래 이용 안내(B-04)', description: '기준 금액 · 4가지 내용 · 고객센터 상담 시간 · 전화. 대금은 당사자끼리(플랫폼은 받지 않음).' })
  @ApiOkResponse(OBJ)
  terms() { return this.svc.safeTradeTerms(); }

  @Get('deals/:id/safe-trade')
  @ApiBearerAuth() @Roles(...ALL)
  @ApiOperation({ summary: '이 거래의 안전거래 상태(당사자)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse(OBJ)
  state(@Param('id') id: string) { return this.svc.safeTradeState(id); }

  @Post('deals/:id/safe-trade')
  @ApiBearerAuth() @Roles(...ALL)
  @ApiOperation({ summary: '안전거래 합의(당사자 한쪽)', description: '계약 조건의 합의 금액이 기준 금액 이상일 때. 양측이 합의하면 활성(active_at).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 422, description: 'SAFE_TRADE_AMOUNT', type: ErrorDto })
  @Audit('SAFE_TRADE_AGREE', 'DEAL')
  agree(@Param('id') id: string) { return this.svc.agreeSafeTrade(id); }
}

/** 소개창업 축 — 인력 · 운영지원 · 정보 · 정책 원문 · 빠른 매칭 */
@ApiTags('BIZ')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
@Controller('api/v1/biz')
export class BizAxisController {
  constructor(private readonly svc: BizAxisService) {}

  @Get('axis/:kind')
  @ApiOperation({ summary: '축 목록', description: 'kind = JOB 공고 · SVC 자문 서비스 · POL 정책 · EDU 교육. hot=1 초단기 공고만 · mine=1 내가 요청한 것(「지원」).' })
  @ApiParam({ name: 'kind', enum: ['JOB', 'SVC', 'POL', 'EDU'] })
  @ApiQuery({ name: 'hot', required: false }) @ApiQuery({ name: 'mine', required: false }) @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse(OBJ)
  list(@Param('kind') kind: string, @Query('hot') hot?: string, @Query('mine') mine?: string, @Query('limit') limit?: string) {
    return this.svc.list(kind, { hot, mine, limit: Number(limit) || 20 });
  }

  @Get('axis/:kind/:no')
  @ApiOperation({ summary: '축 항목 상세(공고 · 자문 서비스 · 정책 · 교육)' })
  @ApiParam({ name: 'kind', enum: ['JOB', 'SVC', 'POL', 'EDU'] }) @ApiParam({ name: 'no' })
  @ApiResponse({ status: 404, type: ErrorDto })
  @ApiOkResponse(OBJ)
  detail(@Param('kind') kind: string, @Param('no', ParseIntPipe) no: number) { return this.svc.detail(kind, no); }

  @Get('policies/:no/source')
  @ApiOperation({ summary: '지원사업 공고 원문(SB-BIZ-POL-030)', description: '공고명 · 주관 기관 · 지원 규모 · 신청 기한 · 원문 주소 · 지원 내용 표. 소개비 구조 밖.' })
  @ApiParam({ name: 'no' })
  @ApiResponse({ status: 404, type: ErrorDto })
  @ApiOkResponse(OBJ)
  source(@Param('no', ParseIntPipe) no: number) { return this.svc.policySource(no); }

  @Post('axis')
  /* v10.37 (D095 · P2P) — 공고 · 자문은 개인 회원도 올립니다 */
  @ApiBearerAuth() @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '축 항목 올리기', description: '공고(JOB · 도급만) · 자문(SVC)은 본인인증 회원 본인(v10.37 · 개인도) · 정책(POL) · 교육(EDU)은 운영. 연락처는 가립니다 · 금칙어는 막습니다.' })
  @ApiResponse({ status: 403, description: 'IDENTITY_REQUIRED · FORBIDDEN', type: ErrorDto })
  @Audit('BIZ_AXIS_CREATE', 'LISTING')
  create(@Req() req: Request, @Body() dto: BizAxisItemDto) { return this.svc.create(dto, (req as any).principal?.roles ?? []); }

  @Patch('axis/:no/status')
  @ApiBearerAuth() @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '축 항목 마감 · 다시 열기 · 숨김(운영)' })
  @ApiParam({ name: 'no' })
  @Audit('BIZ_AXIS_STATUS', 'LISTING')
  status(@Req() req: Request, @Param('no', ParseIntPipe) no: number, @Body() dto: BizAxisStatusDto) {
    return this.svc.setStatus(no, dto.status, dto.reason, (req as any).principal?.roles ?? []);
  }

  @Post('axis/:no/requests')
  @ApiBearerAuth() @Roles(...ALL) @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({ summary: '업체 소개 요청(공고) · 견적 요청(자문)', description: '한 항목에 한 번. 연락처는 가립니다 — 회신은 1:1 대화 · 알림으로.' })
  @ApiParam({ name: 'no' })
  @ApiResponse({ status: 409, description: 'ALREADY_REQUESTED · OWN_ITEM', type: ErrorDto })
  @Audit('BIZ_AXIS_REQUEST', 'LISTING')
  request(@Param('no', ParseIntPipe) no: number, @Body() dto: BizAxisRequestDto) { return this.svc.request(no, dto.memo); }

  @Get('axis-requests/:no')
  @ApiBearerAuth() @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '내 항목이 받은 요청(올린 사람)' })
  @ApiParam({ name: 'no' })
  @ApiOkResponse(OBJ)
  received(@Param('no', ParseIntPipe) no: number) { return this.svc.receivedRequests(no); }

  @Post('axis-requests/:id/answer')
  @ApiBearerAuth() @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '받은 요청에 회신' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @Audit('BIZ_AXIS_ANSWER', 'LISTING')
  answer(@Param('id') id: string, @Body() dto: BizAxisAnswerDto) { return this.svc.answer(id, dto.answer); }

  @Get('quick')
  @ApiOperation({ summary: '빠른 매칭 — 열린 요청(14일)', description: '언제까지 · 몇 명 · 일 · 시 · 도 · 회신 업체 수. 요청자 이름 · 연락처는 내보내지 않습니다.' })
  @ApiOkResponse(OBJ)
  quick() { return this.svc.quickList(); }

  @Post('quick')
  @ApiBearerAuth() @Roles(...ALL) @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({ summary: '빠른 매칭 요청 올리기', description: '도급으로만 잇습니다 — 본인인증 회원(사업자 · 개인)이 회신합니다. 요청자 이름 · 연락처는 목록에 내보내지 않습니다.' })
  @Audit('BIZ_QUICK_CREATE', 'LISTING')
  quickCreate(@Body() dto: QuickMatchDto) { return this.svc.quickCreate(dto); }

  @Post('quick/:id/offer')
  @ApiBearerAuth() @Roles(...ALL) @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({ summary: '빠른 매칭에 회신(본인인증 회원)', description: 'v10.38 (D096 · P2P) — 사업자는 그 사업자로, 개인은 개인 활동 정보로 회신합니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @Audit('BIZ_QUICK_OFFER', 'LISTING')
  offer(@Param('id') id: string) { return this.svc.quickOffer(id); }

  @Post('quick/:id/close')
  @ApiBearerAuth() @Roles(...ALL)
  @ApiOperation({ summary: '내 빠른 매칭 요청 닫기' })
  @ApiParam({ name: 'id', format: 'uuid' })
  quickClose(@Param('id') id: string) { return this.svc.quickClose(id); }
}
