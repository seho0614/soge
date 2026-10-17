import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Length, Matches } from 'class-validator';
import { TownFoodService } from './town-food.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { StrictBoolean } from '../../common/strict-boolean';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/* ---------------------------------------------------------------------
 * v10.47 (D100 · docs/98) — 소개광장 › 우리동네 맛집
 *
 *   공개   GET  /community/food                     켜져 있는지 · 「현재 위치로」 · 가게가 있는 동네      (SB-HOM-CMU-050)
 *          GET  /community/food/places              지도에 보이는 범위의 가게(최대 200)
 *          GET  /community/food/places/{id}         가게 한 곳 · 소개 글                               (SB-HOM-CMU-051)
 *   로그인 GET  /me/community/food/search            가게 찾기(카카오 · 음식점 · 카페)                   (SB-HOM-CMU-052)
 *          POST /me/community/food                   맛집 소개 글 쓰기
 *   운영   GET  /admin/community/food/places         가게 목록(숨긴 것 포함)                             (SB-ADM-CMU-020)
 *          PATCH /admin/community/food/places/{id}   숨기기 · 다시 보이기(사유 필수)
 *
 * 글 고치기 · 지우기 · 댓글 · 신고 · 검수는 소개광장 것을 그대로 씁니다(/me/community/posts/{id} · /admin/community/*).
 * ------------------------------------------------------------------- */

export class FoodRegionDto {
  @ApiProperty() sido!: string;
  @ApiProperty() sigungu!: string;
  @ApiProperty() count!: number;
  @ApiProperty() lat!: number;
  @ApiProperty() lng!: number;
}
export class FoodMetaDto {
  @ApiProperty({ description: '지도 사용(map.enabled)이 켜져 있으면 true — false 면 소개광장에 탭이 나오지 않음' }) enabled!: boolean;
  @ApiProperty({ description: '「현재 위치로」 단추(map.food_geolocation) — 브라우저 안에서만 지도를 옮김' }) geolocation!: boolean;
  @ApiProperty({ type: FoodRegionDto, isArray: true }) regions!: FoodRegionDto[];
}
export class FoodPinDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) category!: string | null;
  @ApiPropertyOptional({ nullable: true }) address!: string | null;
  @ApiProperty({ example: '성남시 분당구 정자동' }) region!: string;
  @ApiProperty() lat!: number;
  @ApiProperty() lng!: number;
  @ApiProperty({ description: '추천 = 공개된 소개 글 수' }) count!: number;
  @ApiProperty({ description: '운영자가 쓴 글(동네픽) 수' }) picks!: number;
  @ApiProperty() lastAt!: Date;
}
export class FoodPlacesDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ description: '200곳을 넘어 잘림 — 지도를 확대하라고 안내' }) truncated!: boolean;
  @ApiProperty({ type: FoodPinDto, isArray: true }) items!: FoodPinDto[];
}
export class FoodPostRowDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ description: '본문 앞 140자' }) excerpt!: string;
  @ApiPropertyOptional({ nullable: true }) menu!: string | null;
  @ApiProperty({ description: '광고 · 협찬 표시' }) sponsored!: boolean;
  @ApiProperty({ description: '운영자가 쓴 글(동네픽)' }) pick!: boolean;
  @ApiProperty({ description: '내 글 · 검수 중' }) pending!: boolean;
  @ApiProperty() commentCount!: number;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ example: '김OO' }) author!: string;
}
export class FoodPlaceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: '카카오 장소 ID — 「이 가게 소개하기」에서 다시 찾지 않고 고를 때' }) kakaoId!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) category!: string | null;
  @ApiPropertyOptional({ nullable: true }) phone!: string | null;
  @ApiPropertyOptional({ nullable: true }) address!: string | null;
  @ApiPropertyOptional({ nullable: true }) jibun!: string | null;
  @ApiProperty() region!: string;
  @ApiProperty() lat!: number;
  @ApiProperty() lng!: number;
  @ApiPropertyOptional({ nullable: true, description: '카카오맵 장소 주소(https://place.map.kakao.com/…)' }) placeUrl!: string | null;
  @ApiProperty({ type: FoodPostRowDto, isArray: true }) posts!: FoodPostRowDto[];
}
export class FoodSearchItemDto {
  @ApiProperty() kakaoId!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) category!: string | null;
  @ApiPropertyOptional({ nullable: true }) address!: string | null;
  @ApiProperty() lat!: number;
  @ApiProperty() lng!: number;
}
export class FoodSearchDto {
  @ApiProperty({ type: FoodSearchItemDto, isArray: true }) items!: FoodSearchItemDto[];
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
}
export class FoodWriteDto {
  @ApiProperty({ description: '가게 찾기에서 고른 카카오 장소 ID', example: '26338954' })
  @IsString() @Matches(/^[0-9]{1,20}$/) kakaoPlaceId!: string;
  @ApiProperty({ example: '정자동 칼국수 — 점심에 줄 서는 집' }) @IsString() @Length(2, 100) title!: string;
  @ApiProperty({ example: '바지락이 많이 들어가고 국물이 맑습니다. 11시 반 전에 가면 기다리지 않습니다.' })
  @IsString() @Length(10, 3000) body!: string;
  @ApiPropertyOptional({ maxLength: 60, example: '바지락 칼국수' }) @IsOptional() @IsString() @Length(1, 60) menu?: string;
  @ApiProperty({ description: '대가(무료 제공 · 할인 · 돈)를 받고 쓴 글이면 true — 「광고 · 협찬」 표시' })
  @StrictBoolean() sponsored!: boolean;
}
export class FoodWriteResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) placeId!: string;
  @ApiProperty({ enum: ['PENDING', 'PUBLISHED'] }) state!: string;
  @ApiProperty() note!: string;
}
export class FoodAdminPlaceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) category!: string | null;
  @ApiPropertyOptional({ nullable: true }) address!: string | null;
  @ApiPropertyOptional({ nullable: true }) sido!: string | null;
  @ApiPropertyOptional({ nullable: true }) sigungu!: string | null;
  @ApiPropertyOptional({ nullable: true }) dong!: string | null;
  @ApiProperty() isHidden!: boolean;
  @ApiPropertyOptional({ nullable: true }) hiddenReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) placeUrl!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() postCount!: number;
  @ApiProperty() pendingCount!: number;
}
export class FoodAdminPlacesDto {
  @ApiProperty({ type: FoodAdminPlaceDto, isArray: true }) items!: FoodAdminPlaceDto[];
}
export class FoodHideDto {
  @ApiProperty() @StrictBoolean() hidden!: boolean;
  @ApiPropertyOptional({ maxLength: 200, description: '숨길 때 필수' }) @IsOptional() @IsString() @Length(1, 200) reason?: string;
}
export class FoodHideResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() hidden!: boolean;
  @ApiProperty() note!: string;
}
export class FoodSearchQueryDto {
  @ApiProperty() @IsString() @Length(1, 40) q!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() lng?: number;
}

@ApiTags('HOM')
@Controller('api/v1')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class TownFoodController {
  constructor(private readonly svc: TownFoodService) {}

  @Get('community/food')
  @ApiOperation({ summary: '우리동네 맛집 — 켜짐 · 동네', description: '지도 사용이 꺼져 있으면 enabled=false(소개광장에 탭이 나오지 않음).' })
  @ApiOkResponse({ type: FoodMetaDto })
  meta() { return this.svc.meta(); }

  @Get('community/food/places')
  @ApiOperation({ summary: '우리동네 맛집 — 지도 범위의 가게', description: '지도에 보이는 네 모서리 · 가게 이름(q). 최대 200곳(넘으면 truncated). 이용자 위치는 받지 않습니다.' })
  @ApiQuery({ name: 'swLat', required: true }) @ApiQuery({ name: 'swLng', required: true })
  @ApiQuery({ name: 'neLat', required: true }) @ApiQuery({ name: 'neLng', required: true })
  @ApiQuery({ name: 'q', required: false })
  @ApiOkResponse({ type: FoodPlacesDto })
  places(@Query() q: Record<string, unknown>) { return this.svc.places(q); }

  @Get('community/food/places/:id')
  @ApiOperation({ summary: '우리동네 맛집 — 가게 한 곳', description: '가게 정보 · 소개 글(공개분 + 내 검수 중인 글). 작성자는 첫 글자만.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FoodPlaceDto })
  @ApiResponse({ status: 404, description: '없거나 숨긴 가게', type: ErrorDto })
  place(@Param('id') id: string) { return this.svc.place(id); }

  @ApiBearerAuth()
  @Get('me/community/food/search')
  @Roles('MEMBER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '우리동네 맛집 — 가게 찾기', description: '카카오 키워드 검색을 서버가 대신 부릅니다. 음식점 · 카페만 · 1분 30회.' })
  @ApiOkResponse({ type: FoodSearchDto })
  @ApiResponse({ status: 422, description: 'MAP_DISABLED · QUERY_TOO_SHORT · QUERY_TOO_LONG · SEARCH_RATE · PLACE_SEARCH_FAILED', type: ErrorDto })
  search(@Query() q: FoodSearchQueryDto) { return this.svc.search(q.q, q.lat, q.lng); }

  @ApiBearerAuth()
  @Post('me/community/food')
  @Roles('MEMBER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '우리동네 맛집 — 소개 글 쓰기', description: '소개광장 글과 같은 규칙(첫 글 검수 · 링크 · 도배 · 금칙어). 운영자가 쓰면 「동네픽」.' })
  @ApiOkResponse({ type: FoodWriteResultDto })
  @ApiResponse({ status: 422, description: 'MAP_DISABLED · PLACE_NOT_PICKED · PLACE_HIDDEN · POST(소개광장 규칙)', type: ErrorDto })
  @Audit('FOOD_POST_CREATE', 'POST')
  write(@Body() dto: FoodWriteDto) { return this.svc.write(dto); }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@Roles('ADMIN', 'SUPER')
export class TownFoodAdminController {
  constructor(private readonly svc: TownFoodService) {}

  @Get('community/food/places')
  @ApiOperation({ summary: '우리동네 맛집 가게 목록(운영)', description: '숨긴 가게 포함 · 이름 · 주소로 찾기 · 최근 200곳.' })
  @ApiQuery({ name: 'q', required: false })
  @ApiOkResponse({ type: FoodAdminPlacesDto })
  places(@Query('q') q?: string) { return this.svc.adminPlaces(q); }

  @Patch('community/food/places/:id')
  @ApiOperation({ summary: '우리동네 맛집 가게 숨기기 · 다시 보이기', description: '숨기면 지도 · 목록 · 가게 화면에서 빠집니다(글은 남음). 숨길 때 사유 필수.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FoodHideResultDto })
  @ApiResponse({ status: 422, description: 'HIDE_REASON', type: ErrorDto })
  @Audit('FOOD_PLACE_HIDE', 'PLACE')
  hide(@Param('id') id: string, @Body() dto: FoodHideDto) { return this.svc.adminHide(id, dto); }
}
