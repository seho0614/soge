import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { FavoriteService } from './favorite.service';
import { Roles } from '../../core/auth';
import { FavoriteResultDto } from './my.dto';

/**
 * 관심 등록·해제 (SB-MYP-LIK-010).
 *
 * 조회는 MeController 가 담당합니다 — /me/* 조회를 한 곳에 모아
 * 같은 경로를 두 컨트롤러가 정의하는 일을 막습니다.
 */
@ApiTags('MYP')
@ApiBearerAuth()
@Controller('api/v1/me')
/* ★ /me/** 는 **본인 것만** 보이는 자리입니다.
 *   표시가 없으면 토큰 없이도 200 이 나가고, 나중에 그 안에
 *   개인정보를 담는 순간 조용히 샙니다.
 *   역할이 아니라 **로그인 여부**만 봅니다 — 특정 역할을 요구하면
 *   사업자가 못 들어가는 곳이 생깁니다. */
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'SUPER')
export class MyListingController {
  constructor(
    private readonly favorites: FavoriteService,
  ) {}



  @Post('favorites/:targetId')
  /* 개인·사업자 모두 담을 수 있어야 합니다.
   *
   * 전에는 MEMBER 전용이라 **사업자는 관심을 담지 못했습니다.**
   * 사업자도 다른 곳의 등록을 보고 담아 둡니다 — 오히려 더 많이 씁니다. */
  @Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
  @ApiOperation({ summary: '관심 등록', description: '본문 없음. 대상 id 만으로 동작합니다.' })
  @ApiParam({ name: 'targetId', format: 'uuid' })
  @ApiOkResponse({ type: FavoriteResultDto })
  add(@Param('targetId') id: string) { return this.favorites.add(id); }

  @Delete('favorites/:targetId')
  @Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
  @ApiOperation({ summary: '관심 해제' })
  @ApiParam({ name: 'targetId', format: 'uuid' })
  @ApiOkResponse({ type: FavoriteResultDto })
  remove(@Param('targetId') id: string) { return this.favorites.remove(id); }
}
