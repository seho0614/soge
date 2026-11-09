import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { RecommendService } from './recommend.service';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { AppError } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

export class SetRecommenderDto {
  @ApiPropertyOptional({ nullable: true, example: 'K7MZ3Q', description: '새 추천인의 추천 코드 · 비우거나 null 이면 추천인을 지움' })
  @IsOptional() @IsString() @MaxLength(20) recommendCode?: string | null;

  @ApiProperty({ minLength: 2, maxLength: 300, example: '가입 때 코드를 잘못 넣었다는 회원 문의(고객센터 11/9)' })
  @IsString() @MaxLength(300) reason!: string;
}

export class RecommendRewardDto {
  @ApiProperty() @IsBoolean() isActive!: boolean;
  @ApiProperty({ minimum: 1, maximum: 100000, example: 1000 }) @IsInt() points!: number;
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 1000, description: '한 사람이 한 달에 받는 횟수 상한 · null 이면 없음' })
  @IsOptional() @IsInt() monthlyCap?: number | null;
}

const NODE = {
  type: 'object', properties: {
    k: { type: 'integer', description: '1부터 붙인 번호(회원 번호 아님)' }, p: { type: 'integer', description: '위 사람 번호 · 0 = 맨 위' },
    gen: { type: 'integer' }, name: { type: 'string', nullable: true }, joined: { type: 'string' }, children: { type: 'integer' },
  },
};
const TREE = {
  type: 'object', properties: {
    total: { type: 'integer' }, truncated: { type: 'boolean' },
    generations: { type: 'array', items: { type: 'object', properties: { gen: { type: 'integer' }, count: { type: 'integer' } } } },
    nodes: { type: 'array', items: NODE },
  },
};
const RULE = {
  type: 'object', properties: {
    isActive: { type: 'boolean' }, points: { type: 'integer' }, monthlyCap: { type: 'integer', nullable: true },
    given: { type: 'integer' }, givenPoints: { type: 'integer' },
  },
};

/** 가입 화면 코드 확인 — 로그인 전이라 IP 마다 1분 20번(코드 훑기 방지 · signup/biz-check 와 같은 방식) */
const CHECK_HITS = new Map<string, number[]>();

/**
 * v10.218 (D189 · docs/351) — 회원 추천인 · 추천 관계도.
 * 보상은 직접 추천 1단계만(DB fn_referral_reward) · 파트너 화면은 가린 이름 · 날짜만.
 */
@ApiTags('RECOMMEND')
@Controller('api/v1')
export class RecommendController {
  constructor(private readonly svc: RecommendService) {}

  @Get('auth/recommend-code/:code')
  @ApiOperation({ summary: '추천 코드 확인 (가입 전)', description: '활동 중 회원의 코드면 가린 이름(김**)을 돌려줍니다. 계정 번호 · 연락처는 돌려주지 않습니다.' })
  @ApiParam({ name: 'code', example: 'K7MZ3Q' })
  @ApiOkResponse({ schema: { type: 'object', properties: { code: { type: 'string' }, name: { type: 'string' } } } })
  @ApiResponse({ status: 404, description: '없는 추천 코드' })
  @ApiResponse({ status: 429, description: 'TOO_MANY — 1분 20번' })
  check(@Param('code') code: string) {
    const ip = RequestCtx.get()?.ip ?? '-';
    const now = Date.now();
    const hits = (CHECK_HITS.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= 20) throw new AppError(429, { code: 'TOO_MANY', message: '잠시 뒤에 다시 확인해 주십시오.' });
    hits.push(now); CHECK_HITS.set(ip, hits);
    if (CHECK_HITS.size > 5000) CHECK_HITS.clear();
    return this.svc.check(code);
  }

  @Get('me/recommend')
  @ApiBearerAuth()
  @Roles('MEMBER')
  @ApiOperation({ summary: '내 추천 코드', description: '내 코드 · 가입 링크 · 내가 직접 추천한 분 수 · 나를 추천한 분(가린 이름) · 받은 추천 보상 점수.' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    code: { type: 'string', nullable: true }, link: { type: 'string', nullable: true }, directCount: { type: 'integer' },
    recommender: { type: 'string', nullable: true }, rewardPoints: { type: 'integer' }, rewardOn: { type: 'boolean' } } } })
  mine() { return this.svc.mine(); }

  @Get('partner/affiliate/recommend-tree')
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '추천 관계도 (제휴 파트너)',
    description: '활동 중 제휴 파트너 본인이 추천한 분과 그분들이 추천한 분 전체(30대 · 3,000명까지). 이름 첫 글자 · 가입일(직접 추천) · 가입 월(그 아래)만 — 실적 · 연락처 · 회원 번호 없음. 403 AFF_REQUIRED.',
  })
  @ApiOkResponse({ schema: TREE })
  @ApiResponse({ status: 403, description: 'AFF_REQUIRED — 활동 중 제휴 파트너 아님' })
  partnerTree() { return this.svc.partnerTree(); }

  /* ── 운영 화면 ───────────────────────────────────────────── */

  @Get('admin/affiliates/recommend')
  @ApiBearerAuth()
  @Roles('ADMIN', 'PARTNER_AFF')
  @ApiOperation({ summary: '추천 관계 — 회원 찾기', description: '코드 · 이메일(정확히) · 이름(일부). 비우면 직접 추천이 많은 회원 20명.' })
  @ApiQuery({ name: 'q', required: false })
  @ApiOkResponse({ schema: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, email: { type: 'string' }, code: { type: 'string', nullable: true },
    status: { type: 'string' }, joinedAt: { type: 'string' }, directCount: { type: 'integer' }, recommender: { type: 'string', nullable: true } } } } })
  adminSearch(@Query('q') q?: string) { return this.svc.adminSearch(q); }

  @Get('admin/affiliates/recommend/:id')
  @ApiBearerAuth()
  @Roles('ADMIN', 'PARTNER_AFF')
  @ApiOperation({ summary: '추천 관계 — 한 회원', description: '위로 추천인 줄 · 아래 전체 트리(30대 · 3,000명까지) · 추천인 변경 기록.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: TREE })
  @ApiResponse({ status: 404, description: '없는 회원' })
  adminNode(@Param('id', ParseUUIDPipe) id: string) { return this.svc.adminNode(id); }

  @Patch('admin/affiliates/recommend/:id')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({ summary: '추천인 고치기 · 지우기', description: '사유 필수 · 변경 기록(recommend_changes)이 남고 지울 수 없음. 고리(A→B→C→A) · 보상을 준 관계는 막음.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'object', properties: { ok: { type: 'boolean' }, recommender: { type: 'string', nullable: true } } } })
  @ApiResponse({ status: 422, description: 'REASON_REQUIRED · RECOMMEND_CODE_UNKNOWN · RECOMMEND_SELF · RECOMMEND_SAME · RECOMMEND_REWARDED · INV_1(고리)' })
  @ApiResponse({ status: 409, description: 'IMMUTABLE_RECORD' })
  @Audit('RECOMMEND_CHANGE', 'ACCOUNT')
  adminSet(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRecommenderDto) {
    return this.svc.adminSetRecommender(id, dto.recommendCode, dto.reason);
  }

  @Get('admin/affiliates/recommend-reward')
  @ApiBearerAuth()
  @Roles('ADMIN', 'PARTNER_AFF')
  @ApiOperation({ summary: '추천 보상 규칙', description: '직접 추천 1단계만 · 가입한 분 첫 본인인증 때 한 번 · 켜짐 · 점수 · 한 달 상한 · 지금까지 준 수.' })
  @ApiOkResponse({ schema: RULE })
  rewardRule() { return this.svc.rewardRule(); }

  @Put('admin/affiliates/recommend-reward')
  @ApiBearerAuth()
  @Roles('SUPER')
  @ApiOperation({ summary: '추천 보상 규칙 바꾸기 (SUPER)', description: '켜기 · 끄기 · 점수(1 ~ 100,000) · 한 달 상한. 꺼져 있을 때 본인인증한 분의 추천인은 나중에 켜도 받지 않습니다.' })
  @ApiOkResponse({ schema: RULE })
  @ApiResponse({ status: 422, description: 'INVALID_POINTS · INVALID_CAP' })
  @ApiResponse({ status: 409, description: 'IMMUTABLE_RECORD' })
  @Audit('RECOMMEND_REWARD_RULE', 'SETTING')
  setReward(@Body() dto: RecommendRewardDto) {
    return this.svc.setRewardRule(dto.isActive, dto.points, dto.monthlyCap ?? null);
  }
}
