import { Body, Controller, Get, Headers, HttpCode, Ip, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { DatabaseService } from '../../db/database.service';
import { USAGE_GOALS, usageBeat, usageView } from './site-usage';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * v10.508 (D274 · docs/646) 회원 화면 사용 통계
 *   공개  POST /site/usage/beat — 사용자 웹이 화면이 바뀔 때(로그인 없이 · site 구역 · check-acl PUBLIC_OK) · 계정 · IP · 브라우저 정보는 저장하지 않음
 *   운영  GET /admin/site-usage?days=1|7|30|90 (ADMIN · SUPER)
 * ------------------------------------------------------------------- */

export class SiteUsageBeatDto {
  @ApiProperty({ example: '/community/3f0c…', description: '지금 화면 주소(서버가 번호 · 코드를 :id 로 묶음 · 물음표 뒤 버림)' }) @IsString() @MaxLength(400) p!: string;
  @ApiPropertyOptional({ example: '/', description: '이 탭에서 처음 들어온 화면(지금 화면이 첫 화면이면 비움)' }) @IsOptional() @IsString() @MaxLength(400) e?: string;
  @ApiPropertyOptional({ example: true, description: '이 탭의 둘째 화면 — 첫 화면을 「이어 봄」으로 셈(이탈 아님)' }) @IsOptional() @StrictBoolean() s?: boolean;
  @ApiPropertyOptional({ enum: [...USAGE_GOALS], description: '전환 목표(완료 화면에 닿았을 때만)' }) @IsOptional() @IsIn(USAGE_GOALS as unknown as string[]) g?: string;
}

@ApiTags('HOM')
@ApiBearerAuth()
@Controller('api/v1')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class SiteUsageController {
  constructor(private readonly db: DatabaseService) {}

  @Post('site/usage/beat')
  @HttpCode(200)
  @ApiOperation({
    summary: '회원 화면 사용 통계 보내기 (v10.508)',
    description: '로그인 없이 · 하루 × 화면 주소 묶음 수만 더함(계정 · IP · 브라우저 정보 · 쿠키 저장 없음) · site.usage_stats 가 꺼져 있거나 DNT · GPC · 로봇이면 ok:false(오류 아님) · IP 지문은 1분 요청 수 제한에만 메모리에서 씀.',
  })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 400, type: ErrorDto, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'POLICY' })
  beat(@Body() dto: SiteUsageBeatDto, @Headers('user-agent') ua?: string, @Headers('dnt') dnt?: string, @Headers('sec-gpc') gpc?: string,
       @Headers('x-forwarded-for') xff?: string, @Ip() ip?: string) {
    return usageBeat(this.db, dto, { ua, dnt, gpc, ip: (xff?.split(',')[0]?.trim() || ip) ?? '' });
  }

  @Get('admin/site-usage')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'days', required: false, enum: ['1', '7', '30', '90'] })
  @ApiOperation({ summary: '회원 화면 사용 통계 (v10.508)', description: '최근 N일 합 · 날마다 · 화면 주소 묶음 100(보기 · 첫 화면 · 이탈률 · 추정 보기) · 전환(목표 × 첫 화면 · 전환률) · 설정.' })
  @ApiOkResponse({ type: Object })
  view(@Query('days') days?: string) { return usageView(this.db, days); }
}
