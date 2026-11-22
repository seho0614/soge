import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { PLZ_TARGETS, adminRanking, helpfulCounts, myActivity, publicRanking, revokeBadge, runRanking, setRankPref, toggleHelpful } from './plaza-rank';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * v10.507 (D274 · docs/645) 소개광장 활동 배지 · 랭킹
 *   공개(로그인 없이 — community 구역 · check-acl PUBLIC_OK)  GET /community/ranking · GET /community/posts/{id}/helpful
 *   회원(MEMBER)  POST /me/community/helpful · GET /me/community/activity · PUT /me/community/rank-pref
 *   운영(ADMIN · SUPER)  GET /admin/community/ranking · POST /admin/community/ranking/run · POST /admin/community/badges/{id}/revoke
 * ------------------------------------------------------------------- */

const MONTH_IN = /^(\d{4}-(0[1-9]|1[0-2]))?$/;

export class PlzHelpfulDto {
  @ApiProperty({ enum: [...PLZ_TARGETS], description: '글 · 댓글(답변)' }) @IsIn(PLZ_TARGETS as unknown as string[]) targetType!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() targetId!: string;
}
export class PlzRankPrefDto {
  @ApiProperty({ example: true, description: 'true = 공개 랭킹에 나오지 않음' }) @StrictBoolean() hide!: boolean;
}
export class PlzRankRunDto {
  @ApiPropertyOptional({ example: '2026-11', description: '비우면 이번 달' }) @IsOptional() @IsString() @Matches(MONTH_IN) month?: string;
}
export class PlzBadgeRevokeDto {
  @ApiProperty({ example: '도배 글로 받은 점수' }) @IsString() @Length(2, 200) reason!: string;
}

@ApiTags('HOM')
@ApiBearerAuth()
@Controller('api/v1')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class PlazaRankController {
  constructor(private readonly db: DatabaseService) {}

  @Get('community/ranking')
  @ApiQuery({ name: 'month', required: false, example: '2026-11' })
  @ApiOperation({ summary: '소개광장 활동 랭킹 (v10.507)', description: '로그인 없이 · 노출을 끈 회원 빼고 · 이름 가림 · 점수 · 글 · 답변 · 도움돼요 · 그 달 배지 · plaza.ranking 이 꺼져 있으면 on:false.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PLZ_MONTH' })
  ranking(@Query('month') month?: string) { return publicRanking(this.db, month || undefined); }

  @Get('community/posts/:id/helpful')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '글 · 댓글 도움돼요 수 (v10.507)', description: '로그인 없이 · 로그인이면 내가 누른 것(mine) · 꺼져 있으면 on:false.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  helpful(@Param('id') id: string) { return helpfulCounts(this.db, id, RequestCtx.actorId() ?? null); }

  @Post('me/community/helpful')
  @HttpCode(200)
  @Roles('MEMBER')
  @ApiOperation({ summary: '도움돼요 누르기 · 취소 (v10.507)', description: '글 · 댓글마다 한 번 · 다시 누르면 취소 · 자기 것 · 공개 아닌 글은 DB 가 막음(422).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PLZ_RANK_OFF · PLZ_HELPFUL_SELF · PLZ_HELPFUL_TARGET' })
  toggle(@Body() dto: PlzHelpfulDto) { return toggleHelpful(this.db, RequestCtx.actorId()!, dto); }

  @Get('me/community/activity')
  @Roles('MEMBER')
  @ApiOperation({ summary: '내 소개광장 활동 (v10.507)', description: '이번 달 점수 · 순위 · 받은 배지 · 랭킹 노출 설정.' })
  @ApiOkResponse({ type: Object })
  activity() { return myActivity(this.db, RequestCtx.actorId()!); }

  @Put('me/community/rank-pref')
  @Roles('MEMBER')
  @ApiOperation({ summary: '랭킹 노출 끄기 · 켜기 (v10.507)', description: 'hide = true 면 공개 랭킹에 나오지 않음(점수 · 배지는 그대로).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'POLICY' })
  pref(@Body() dto: PlzRankPrefDto) { return setRankPref(this.db, RequestCtx.actorId()!, dto.hide); }

  @Get('admin/community/ranking')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'month', required: false, example: '2026-11' })
  @ApiOperation({ summary: '소개광장 랭킹 · 배지 운영 (v10.507)', description: '그 달 200명(노출 끈 회원 표시) · 배지 · 마감 · 점수 규칙(plaza.*) · 최근 30일 도움돼요 수.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PLZ_MONTH' })
  adminList(@Query('month') month?: string) { return adminRanking(this.db, month || undefined); }

  @Post('admin/community/ranking/run')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @Audit('PLZ_RANK_RUN', 'SETTING')
  @ApiOperation({ summary: '소개광장 점수 다시 셈 (v10.507)', description: '그 달 점수를 통째로 다시 셈(마감한 달의 배지는 그대로).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PLZ_MONTH' })
  run(@Body() dto: PlzRankRunDto) { return runRanking(this.db, dto.month || undefined); }

  @Post('admin/community/badges/:id/revoke')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @Audit('PLZ_BADGE_REVOKE', 'ACCOUNT')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '배지 거두기 (v10.507)', description: '사유 · 지우지 않음 · 거둔 배지는 공개 랭킹 · 내 활동에서 빠짐.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PLZ_BADGE_REVOKED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PLZ_BADGE_REASON' })
  revoke(@Param('id') id: string, @Body() dto: PlzBadgeRevokeDto) { return revokeBadge(this.db, id, RequestCtx.actorId() ?? null, dto.reason); }
}
