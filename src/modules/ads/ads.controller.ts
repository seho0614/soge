import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags, ApiQuery }
from '@nestjs/swagger';
import { IsArray, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsIn } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';
import { AdsService } from './ads.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { UseGuards } from '@nestjs/common';
import { InternalKeyGuard } from '../../core/internal-key.guard';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { AppError } from '../../core/errors';

export class AdAttributionDto {
  @ApiProperty({
    description:
      '켤지 끌지. **기본은 꺼짐** — 켜는 것이 예외여야 합니다. ' +
      '켜면 이 광고로 들어온 소개가 이 광고주에게 귀속됩니다.',
  })
  @StrictBoolean()
  enabled!: boolean;
}

export class ProfileAnswersDto {
  @ApiProperty({ description: '{ "q1": ["re","fr"], "q2": "give" }' })
  @IsObject() answers!: Record<string, string[]>;
}

export class ProfileRegisterDto extends ProfileAnswersDto {
  @ApiProperty({ description: '성향 저장 동의. false 면 등록되지 않습니다' })
  @StrictBoolean() consent!: boolean;
}

export class AdAssignDto {
  @ApiPropertyOptional({ description: '슬롯 코드. null 이면 배정 해제' })
  @IsOptional() @IsString() slot?: string | null;
  @ApiProperty({ type: [String], description: '세그먼트 코드 목록' })
  @IsArray() segments!: string[];
}

export class ReviewConfirmDto {
  @ApiProperty({ description: '심의필 번호' }) @IsString() reviewNo!: string;
}

/** v10.32 — 의료 심의 반려(SB-ADM-PTN-040 · 시안 「반려」). 사유 필수 */
export class ReviewRejectDto {
  @ApiProperty({ description: '반려 사유(2자 이상 · 필수). 감사 기록에 남습니다', minLength: 2, maxLength: 500 })
  @IsString() @MinLength(2) @MaxLength(500) reason!: string;
}


/* 응답 스키마.
 *
 * 없으면 문서에 "무엇이 돌아오는지"가 비고, 프런트가 추측으로 붙입니다.
 * 검정(구현된 API 에 응답 스키마)이 이것을 봅니다. */
export class OkDto {
  @ApiProperty({ example: true }) ok!: boolean;
  @ApiPropertyOptional({ description: '이용자에게 보일 안내' }) note?: string;
}
export class ProfileQuestionsDto {
  @ApiProperty({ type: 'array', items: { type: 'object' } }) questions!: unknown[];
  @ApiProperty() note!: string;
}
export class ProfileResultDto {
  @ApiProperty({ example: 'SEG-F' }) code!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) scores!: object;
  @ApiProperty({ example: false, description: '진단만 하고 저장하지 않습니다' }) saved!: boolean;
}
export class ProfileMineDto {
  @ApiProperty() registered!: boolean;
  @ApiPropertyOptional() segment?: string;
  @ApiPropertyOptional({ type: 'array', items: { type: 'object' },
    description: '이 성향으로 나갈 광고' }) upcomingAds?: unknown[];
}

/**
 * SB-AIS-PRF-010 · 020 관심 성향 · SB-ADM-ADS-010 광고 관리
 *
 * 프론트 v3.2 의 서버 계층입니다. 프로토타입은 브라우저에만 저장했고,
 * 규제 차단도 화면에서만 했습니다 — 개발자 도구로 그대로 통과했습니다.
 */

/* 응답 스키마. 없으면 문서에 "무엇이 돌아오는지"가 비고
 * 프런트가 추측으로 붙입니다. */
export class AdInfeedSlotDto {
  @ApiProperty({ description: '몇 번째 뒤에 끼우는가' }) position!: number;
  @ApiProperty() code!: string;
  @ApiProperty() advertiser!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() body?: string;
  @ApiPropertyOptional() cta?: string;
  @ApiPropertyOptional() landingUrl?: string;
}

export class AdInfeedDto {
  @ApiProperty({
    type: AdInfeedSlotDto, isArray: true,
    description: '목록에 끼울 광고. **반드시 "광고" 로 표기해야 합니다** — ' +
      '목록을 믿을 수 있어야 사람이 계속 옵니다.',
  })
  slots!: AdInfeedSlotDto[];
}

export class AdServeDto {
  @ApiPropertyOptional({ description: '슬롯에 붙은 소재. 없으면 광고를 내리지 않고 비웁니다' })
  creativeCode?: string;
  @ApiPropertyOptional() slot?: string;
  @ApiPropertyOptional({ description: '광고임을 반드시 표시합니다(표시광고법)' }) label?: string;
}
export class AdEventDto {
  @ApiProperty({ example: true }) recorded!: boolean;
}

@ApiTags('ADS')
@Controller('api/v1')
export class AdsController {
  constructor(private readonly svc: AdsService) {}

  /* ── 성향 ─────────────────────────────────────────────────────── */

  /* v10.31 — 가입 5단계(관심 성향 · 선택)가 로그인 전에 문항을 그립니다(시안 joinStep).
   *   문항 · 선택지 글자만 나가고 가중치는 나가지 않습니다(아래 profile/questions 와 같은 내용). 진단 · 등록은 로그인한 사람만. */
  @Get('signup/profile-questions')
  @ApiOperation({ summary: '성향 문항 (가입 화면용 · 공개)', description: '가중치 없음. 등록은 가입 뒤 POST /me/profile(동의 필수).' })
  @ApiOkResponse({ type: ProfileQuestionsDto })
  signupQuestions() { return this.svc.questions(); }

  /* v10.31 — 가입 5단계에서 답할 때마다 「현재 결과」를 보입니다(시안 joinStep · 저장 안 함).
   *   저장은 가입 뒤 POST /me/profile(동의 필수). IP 마다 1분 30번(가중치를 훑어 역산하는 것을 늦춥니다). */
  @Post('signup/profile-analyze')
  @HttpCode(200)
  @ApiOperation({ summary: '성향 진단 (가입 화면용 · 저장 안 함)', description: '로그인 전. 1분 30번.' })
  @ApiOkResponse({ type: ProfileResultDto })
  signupAnalyze(@Body() dto: ProfileAnswersDto) {
    const ip = RequestCtx.get()?.ip ?? '-';
    const now = Date.now();
    const hits = (ANALYZE_HITS.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= 30) throw new AppError(429, { code: 'TOO_MANY', message: '잠시 뒤에 다시 시도해 주십시오.' });
    hits.push(now); ANALYZE_HITS.set(ip, hits);
    if (ANALYZE_HITS.size > 5000) ANALYZE_HITS.clear();
    return this.svc.analyze(dto.answers);
  }

  @Get('profile/questions')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiOperation({
    summary: '성향 문항',
    description: '가중치는 내보내지 않습니다 — 답을 역산할 수 있습니다.',
  })
  @ApiOkResponse({ type: ProfileQuestionsDto })
  questions() { return this.svc.questions(); }

  @Post('profile/analyze')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiOperation({
    summary: '성향 진단 (저장 안 함)',
    description: '선택지 가중치를 더해 가장 높은 세그먼트를 씁니다. 추론이 아닙니다.',
  })
  @ApiOkResponse({ type: ProfileResultDto })
  analyze(@Body() dto: ProfileAnswersDto) { return this.svc.analyze(dto.answers); }

  @Post('me/profile')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '성향 등록',
    description:
      '**동의가 없으면 등록되지 않습니다.** 저장된 성향은 광고 소재 선택과 ' +
      '추천 정렬에만 쓰며 광고주에게 제공하지 않습니다. 언제든 해지할 수 있습니다.',
  })
  @ApiResponse({ status: 422, description: 'CONSENT_REQUIRED', type: ErrorDto })
  @Audit('PROFILE_REGISTER', 'ACCOUNT')
  register(@Body() dto: ProfileRegisterDto) {
    return this.svc.register(dto.answers, dto.consent);
  }

  @Get('me/profile')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 성향', description: '이 성향으로 나갈 광고를 함께 보여 줍니다.' })
  @ApiOkResponse({ type: ProfileMineDto })
  mine() { return this.svc.mine(); }

  @Delete('me/profile')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '성향 등록 해지',
    description: '답과 세그먼트를 남기지 않고 지웁니다. 전체 공개 광고로 돌아갑니다.',
  })
  @Audit('PROFILE_WITHDRAW', 'ACCOUNT')
  @ApiOkResponse({ type: OkDto })
  withdraw() { return this.svc.withdraw(); }

  /* ── 광고 노출 ────────────────────────────────────────────────── */

  @Get('ads/serve')
  @ApiOperation({
    summary: '슬롯 소재 조회',
    description:
      '경매도 점수도 없습니다 — 운영이 지정한 것입니다. ' +
      '성향에 맞는 소재 → 기본 소재 → 빈 자리 순서로 고릅니다. ' +
      '응답의 `label` 은 항상 "광고" 입니다(표시광고법).',
  })
  @ApiOkResponse({ type: AdServeDto })
  serve(@Query('slot') slot: string) { return this.svc.serve(slot); }

  @Get('ads/infeed')
  @ApiOperation({
    summary: '목록 인피드 광고',
    description:
      '목록 N건마다 1개를 끼워 넣습니다. `position` 은 몇 번째 뒤에 넣을지입니다. ' +
      '**`label` 은 항상 "광고"** 이며, 추천 점수에는 넣지 않습니다 — ' +
      '섞이면 목록 신뢰가 무너지고 목록 자체를 안 보게 됩니다.',
  })
  @ApiQuery({ name: 'count', required: true, description: '목록 건수' })
  @ApiQuery({ name: 'gwan', required: false, enum: ['MNY', 'MAL', 'BIZ', 'HLT'] })
  @ApiOkResponse({ type: AdInfeedDto })
  infeed(@Query('count') count: string, @Query('gwan') gwan?: string) {
    return this.svc.infeed(Number(count) || 0, gwan);
  }

  /* v10.31 — 시안 adland(SB-ADS-LND-010): 랜딩 주소가 없는 소재를 누르면 /ad/{id} 미리보기. 지금 내보내는 소재만 */
  @Get('ads/:id')
  @ApiOperation({
    summary: '광고 소재 한 건(랜딩 미리보기)',
    description: '지금 노출 중인 소재만 돌려줍니다(found=false 면 내렸거나 없는 소재). label 은 항상 "광고". 세그먼트는 내보내지 않습니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })   /* v10.31 합침 — 응답 모양을 문서에(검정 「구현된 API 에 응답 스키마」) */
  creative(@Param('id') id: string) { return this.svc.creative(id); }

  @Post('ads/:id/impression')
  @ApiOperation({ summary: '노출 기록', description: '과금 근거입니다. 수정·삭제되지 않습니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdEventDto })
  impression(@Param('id') id: string, @Query('slot') slot?: string) {
    return this.svc.track(id, slot, 'IMPRESSION');
  }

  @Post('ads/:id/click')
  @ApiOperation({ summary: '클릭 기록' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdEventDto })
  click(@Param('id') id: string, @Query('slot') slot?: string) {
    return this.svc.track(id, slot, 'CLICK');
  }
}

/** SB-ADM-ADS-010 광고 관리 (운영) */
@ApiTags('ADM')
@ApiBearerAuth()
export class AdStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'PAUSED'] }) @IsIn(['ACTIVE', 'PAUSED']) status!: string;
}

// 기존 site.controller 의 /admin/ads 는 관별 배너 게재 관리입니다.
// 이쪽은 성향 기반 소재 관리라 경로를 나눕니다 — 같은 경로에 두면
// 어느 화면이 어느 것을 부르는지 매번 확인해야 합니다.
@Controller('api/v1/admin/ad-creatives')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class AdsAdminController {
  constructor(private readonly svc: AdsService) {}

  @Get()
  @ApiOperation({ summary: '소재 목록' })
  creatives() { return this.svc.creatives(); }

  /* v10.31 (시안 SB-ADM-MAIN-010 「슬롯 · 위치 · 규격 · 현재 소재 · 순위 포함」 · ADS-010 「슬롯 배치」) */
  @Get('slots')
  @ApiOperation({ summary: '광고 슬롯', description: '위치 · 규격 · 지금 붙은 소재 · 추천 순위 포함 여부(늘 아니오 — CHECK)' })
  slots() { return this.svc.slots(); }

  @Get('stats')
  @ApiOperation({
    summary: '광고 실적',
    description: '광고주 제공용입니다. **회원 식별자와 세그먼트가 없습니다** — 누가 봤는지 알리지 않습니다.',
  })
  stats() { return this.svc.stats(); }

  @Post(':code/assign')
  @ApiOperation({
    summary: '슬롯 · 세그먼트 지정',
    description:
      '규제 소재(의료 · 대부 · 다단계)는 DB 가 거부합니다. ' +
      '의료는 심의필 확인(T-03) 후에만 열립니다 — 의료법 제27조.',
  })
  @ApiResponse({ status: 422, description: 'INV-6 · RSK-07', type: ErrorDto })
  @Audit('AD_ASSIGN', 'AD')
  assign(@Param('code') code: string, @Body() dto: AdAssignDto) {
    return this.svc.assign(code, dto.slot ?? null, dto.segments);
  }

  @Post(':code/review-confirm')
  @ApiOperation({
    summary: '의료 심의필 확인 (T-03)',
    description: '이 확인 전에는 어떤 슬롯에도 배정되지 않습니다.',
  })
  @Audit('AD_REVIEW_CONFIRM', 'AD')
  confirm(@Param('code') code: string, @Body() dto: ReviewConfirmDto) {
    return this.svc.confirmReview(code, dto.reviewNo);
  }

  /* v10.32 — 시안(admptnm) 카드의 「반려」. 확인과 같은 방식(같은 권한 ADMIN · SUPER — 이 컨트롤러 · 감사 기록) */
  @Post(':code/review-reject')
  @ApiOperation({
    summary: '의료 심의 반려 (T-03)',
    description:
      '심의필이 없거나 조회와 맞지 않는 의료 소재를 반려합니다. **사유는 필수**이고 감사 기록에 남습니다. ' +
      '반려된 소재는 심의 대기 목록에서 빠지며, 확인 전이므로 어떤 슬롯에도 배정되지 않습니다(DB 트리거). ' +
      '광고주가 심의필을 다시 받아 오면 「심의필 확인」(review-confirm)으로 확인할 수 있습니다.',
  })
  @ApiParam({ name: 'code', description: 'creative_code' })
  @ApiResponse({ status: 409, description: 'NOT_PENDING — 규제 소재가 아니거나 이미 확인 · 반려된 소재', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'REASON_REQUIRED', type: ErrorDto })
  @Audit('AD_REVIEW_REJECT', 'AD')
  reject(@Param('code') code: string, @Body() dto: ReviewRejectDto) {
    return this.svc.rejectReview(code, dto.reason);
  }

  @Patch(':code/attribution')
  @ApiOperation({
    summary: '광고 귀속 켜기 · 끄기 (INV-AD12)',
    description:
      '이 광고를 눌러 들어온 사람의 소개를 광고주에게 귀속할지 정합니다.\n\n' +
      '**기본은 꺼짐입니다.** 켜지 않으면 광고 클릭은 귀속을 만들지 않습니다 — ' +
      '광고비만 내고 남의 소개비를 가져가는 길을 막기 위해서입니다.\n\n' +
      '켜도 **그 광고주의 이 광고 건에만** 적용됩니다. 다른 건은 딸려오지 않습니다.',
  })
  @ApiParam({ name: 'code', description: 'creative_code' })
  @Audit('AD_ATTRIBUTION_SET', 'AD')
  setAttribution(@Param('code') code: string, @Body() dto: AdAttributionDto) {
    return this.svc.setAttribution(code, dto.enabled);
  }

  /* v10.31 (10/10 시안 기준 · SB-ADM-ADS-010 줄의 「중지」) — 노출 중 소재를 멈추고 다시 켭니다. 차단(BLOCKED)은 풀 수 없습니다 */
  @Patch(':code/status')
  @ApiOperation({ summary: '소재 중지 · 다시 노출', description: 'ACTIVE ↔ PAUSED 만. 규제로 차단된 소재(BLOCKED)는 바꿀 수 없습니다.' })
  @ApiParam({ name: 'code', description: 'creative_code' })
  @Audit('AD_STATUS', 'AD')
  setStatus(@Param('code') code: string, @Body() dto: AdStatusDto) {
    return this.svc.setCreativeStatus(code, dto.status);
  }

}

/**
 * 분리된 광고 플랫폼(sgb-ads)이 부르는 내부 API.
 *
 * 접두어가 `/api/v1` 입니다 — 광고 관리(`/api/v1/admin/ad-creatives`)
 * 아래에 두면 주소가 `admin/ad-creatives/internal/...` 이 되어
 * 권한도 용도도 어긋납니다.
 */

export class AdProfileDto {
  @ApiPropertyOptional({ description: '세그먼트 코드. 동의가 없으면 null 입니다 — 빈 배열이 아닙니다.' })
  segment!: string | null;
  @ApiProperty({ description: '본체가 판단한 동의 여부. 광고는 다시 계산하지 않습니다.' })
  consented!: boolean;
}

export class BizCheckDto {
  @ApiProperty() exists!: boolean;
  @ApiPropertyOptional() name!: string | null;
  @ApiProperty({ description: '휴·폐업이면 false. 소재를 내려야 합니다.' }) active!: boolean;
}

@ApiTags('INTERNAL')
@Controller('api/v1')
/* ★ 서버가 부르는 자리라 **사람 토큰이 없습니다** — 역할이 아니라
 *   내부 키로 막습니다.
 *
 *   막기 전에는 토큰 없이 `/internal/businesses/{id}` 가 상호를
 *   그대로 내줬습니다. id 를 바꿔 가며 부르면 회원 사업자 명부를
 *   통째로 긁을 수 있었습니다. */
@UseGuards(InternalKeyGuard)
export class AdsInternalController {
  constructor(private readonly svc: AdsService) {}
  /* ── 분리된 광고 플랫폼(sgb-ads)이 부르는 내부 API ────────────────
   *
   * 성향과 사업자 실재는 **본체가 정본**입니다. 광고 쪽에 복제하면
   * 동의를 철회했는데 거기 남아 있는 일이 생기고, 그건 INV-AD
   * 위반입니다. 그래서 복제하지 않고 물어보게 합니다.
   * ─────────────────────────────────────────────────────────────── */

  @Get('internal/accounts/:id/ad-profile')
  @ApiOperation({
    summary: '성향 조회 (내부)',
    description:
      '분리된 광고 서비스가 부릅니다. **동의 여부까지 여기서 판단**해 ' +
      '돌려주므로, 광고 쪽은 받은 것만 쓰면 됩니다. ' +
      '동의가 없으면 segment 는 null 입니다 — 빈 배열이 아닙니다.',
  })
  @ApiOkResponse({ type: AdProfileDto })
  adProfile(@Param('id') id: string) { return this.svc.adProfileFor(id); }

  @Get('internal/businesses/:id')
  @ApiOperation({
    summary: '사업자 실재 확인 (내부)',
    description:
      '휴·폐업이면 active=false 입니다. 광고 쪽은 이 값을 받아 소재를 ' +
      '내립니다 — 휴폐업한 곳의 광고가 계속 나가면 청구도 할 수 없습니다.',
  })
  @ApiOkResponse({ type: BizCheckDto })
  checkBiz(@Param('id') id: string) { return this.svc.checkBizFor(id); }
}

const ANALYZE_HITS = new Map<string, number[]>();
