import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { PrincipalService } from './principal.service';
import { BusinessService } from './business.service';
import {
  SignupBizCheckDto, BizCheckResultDto, BusinessResultDto, CreateBusinessDto, LoginDto, MeSummaryDto,
  RefreshDto, SignupDto, TermDto, TokenDto,
} from './auth.dto';
import { MeService } from '../me/me.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { AppError } from '../../core/errors';

/** SB-HOM-AUT-010 / 020 / 030 · SB-MYP-BIZ-020 */
@ApiTags('HOM')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
@Controller('api/v1')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly principals: PrincipalService,
    private readonly businesses: BusinessService,
    private readonly meSvc: MeService,
  ) {}

  @Post('auth/login')
  @ApiOperation({
    summary: '로그인',
    description:
      'visitorKey 를 함께 보내면 비로그인 상태의 소개코드 유입이 이 계정에 연결됩니다. ' +
      '**이 값을 빠뜨리면 유입의 대부분이 귀속되지 않습니다.**',
  })
  @ApiOkResponse({ type: TokenDto })
  @ApiResponse({
    status: 403, type: ErrorDto,
    description: 'INVALID_CREDENTIALS · ACCOUNT_INACTIVE. 계정 존재 여부는 구분하지 않습니다',
  })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password, dto.visitorKey);
  }

  @Post('auth/refresh')
  @ApiOperation({
    summary: '토큰 재발급',
    description:
      'refreshToken 으로 access 토큰을 다시 받습니다 (access 15분 · refresh 14일). ' +
      'principal 을 DB 에서 다시 조립하므로 정지·구독 만료가 즉시 반영됩니다.',
  })
  @ApiOkResponse({ type: TokenDto })
  @ApiResponse({ status: 403, description: 'INVALID_TOKEN · ACCOUNT_INACTIVE', type: ErrorDto })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('auth/signup')
  @ApiOperation({
    summary: '회원가입',
    description: '개인(INDIVIDUAL)으로 생성됩니다. 본인인증을 하면 소개비를 개인으로 받을 수 있습니다(INV-10R · 받을 계좌 확인). v10.37 — 모든 업무를 본인인증 개인도 합니다. 안심소개 · 소개몰 · 소개창업 등록만 사업자 전환 후입니다.',
  })
  @ApiOkResponse({ type: TokenDto })
  @ApiResponse({ status: 409, description: 'DUPLICATE — 이미 가입된 이메일', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'WEAK_PASSWORD · 필수 약관 미동의 · NOTICE_ONLY(알림에 동의를 보냄 · v10.28 G-218)', type: ErrorDto })
  @Audit('ACCOUNT_SIGNUP', 'ACCOUNT')
  signup(@Body() dto: SignupDto) {
    return this.auth.signup({ ...dto });
  }

  @Get('me/summary')
  @ApiBearerAuth()
  @Roles('MEMBER')
  @ApiOperation({
    summary: '내 요약',
    description:
      'principal 은 토큰 클레임이 아니라 DB 에서 다시 조립합니다. ' +
      '구독 만료·사업자 승인이 토큰보다 먼저 반영되어야 하기 때문입니다.',
  })
  @ApiOkResponse({ type: MeSummaryDto })
  async summary(): Promise<MeSummaryDto> {
    const id = RequestCtx.actorId()!;
    const [principal, counts] = await Promise.all([this.principals.load(id), this.meSvc.summary()]);
    const blockedBy = !principal ? 'ACCOUNT_INACTIVE'
      : !principal.identityVerifiedAt ? 'IDENTITY_REQUIRED'
      /* v10.37 (D095) — 사업자 인증은 막힌 단계가 아닙니다(안심소개 · 소개몰 · 소개창업 등록에만 필요) */
      : !principal.hasActiveSubscription ? 'SUBSCRIPTION_REQUIRED'
      : null;
    return { principal: principal as unknown as MeSummaryDto['principal'], ...counts, blockedBy };
  }

  @Get('terms')
  @ApiOperation({ summary: '약관 목록', description: '가입 화면과 푸터가 같은 목록을 씁니다.' })
  @ApiOkResponse({ type: TermDto, isArray: true })
  terms() {
    return this.auth.terms();
  }

  /* v10.31 — 약관 전체 목록(이용안내 표 · 약관 전문 탭) */
  @Get('terms/index')
  @ApiOperation({ summary: '약관 전체 목록', description: '유효 · 시행 예정 · 폐기 모두(상태 · 시행일). 본문 없음 — 전문은 GET /terms/doc/{code}.' })
  termsIndex() { return this.auth.termsIndex(); }

  /* 'terms/:code' 로 두면 terms/required · terms/agreements 를 가립니다(등록 순서에 따라) — 한 단계 더 둡니다 */
  @Get('terms/doc/:code')
  @ApiOperation({
    summary: '약관 한 건 (전문)',
    description: '유효본이 없으면 시행 예정 발행본을 돌려줍니다(scheduled=true) — 동의 화면이 미리 동의받는 약관의 전문 링크용.',
  })
  @ApiParam({ name: 'code', example: 'MARKETING' })
  @ApiResponse({ status: 404, description: '발행된 약관이 아님', type: ErrorDto })
  term(@Param('code') code: string) {
    return this.auth.term(code);
  }

  /* v10.31 — 가입 2단계 「인증하기」(시안 jvb). 로그인 전에 부르므로 IP 마다 1분 10번으로 묶습니다(번호 훑기 방지). */
  @Post('signup/biz-check')
  @HttpCode(200)
  @ApiOperation({
    summary: '사업자등록번호 조회 (가입 전)',
    description: '국세청 상태(계속 · 휴업 · 폐업)와 이미 가입된 번호인지 봅니다. 상호 · 대표자는 돌려주지 않습니다(상태조회 API 에 없음). 계정은 만들지 않습니다.',
  })
  @ApiOkResponse({ type: BizCheckResultDto })
  @ApiResponse({ status: 422, description: 'BIZ_REG_NO_FORMAT', type: ErrorDto })
  @ApiResponse({ status: 429, description: 'TOO_MANY — 1분 10번', type: ErrorDto })
  bizCheck(@Body() dto: SignupBizCheckDto) {
    const ip = RequestCtx.get()?.ip ?? '-';
    const now = Date.now();
    const hits = (BIZ_CHECK_HITS.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= 10) throw new AppError(429, { code: 'TOO_MANY', message: '잠시 뒤에 다시 조회해 주십시오.' });
    hits.push(now); BIZ_CHECK_HITS.set(ip, hits);
    if (BIZ_CHECK_HITS.size > 5000) BIZ_CHECK_HITS.clear();
    return this.businesses.check(dto.bizRegNo);
  }

  @Post('businesses')
  @ApiBearerAuth()
  @Roles('MEMBER')
  @ApiOperation({
    summary: '사업자 신청',
    description:
      '승인은 검수 큐를 탑니다. **자동검수 대상이 아닙니다** — 법적 판단이 섞여 있습니다. ' +
      '승인 시 account_type 이 BUSINESS 로 승격되고, 그 시각이 소개비 수령 자격의 기준일입니다.',
  })
  @ApiOkResponse({ type: BusinessResultDto })
  @ApiResponse({ status: 409, description: 'BIZ_REG_NO_TAKEN', type: ErrorDto })
  @Audit('BUSINESS_APPLY', 'BUSINESS')
  apply(@Body() dto: CreateBusinessDto) {
    return this.businesses.apply(RequestCtx.actorId()!, dto);
  }
}

const BIZ_CHECK_HITS = new Map<string, number[]>();
