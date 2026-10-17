import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { GeoService } from '../../common/geo/geo.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { StrictBoolean } from '../../common/strict-boolean';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/* ---------------------------------------------------------------------
 * v10.46 (D099 · docs/96) — 카카오맵
 *
 *   공개   GET  /site-settings/map                    지도 사용 여부 · JS 키(공개 키) — 화면이 지도를 그릴 때
 *   SUPER  GET  /admin/map                            카카오맵 키 상태(끝 4자리만) · 사용 여부      (SB-ADM-SIT-080)
 *          PUT  /admin/map/keys/{name}               키 넣기(암호화 저장 · 다시 보이지 않음)
 *          DELETE /admin/map/keys/{name}             키 지우기(그 뒤 .env 값 · 없으면 끔)
 *          PATCH /admin/map                          지도 사용 켜기 · 끄기
 *          POST /admin/map/test                      시험 호출(카카오 로컬 1건)
 *   검수   GET  /admin/listings/{id}/geo              매물 정확 좌표 · 상태                      (SB-ADM-REV-020)
 *          POST /admin/listings/{id}/geo/retry        다시 변환(실패 · 못 찾음일 때만)
 *
 * 감사 기록은 응답을 남깁니다 — 키 API 의 응답에는 끝 4자리만 있어 키 값이 감사 기록에 들어가지 않습니다.
 * ------------------------------------------------------------------- */

export class MapConfigDto {
  @ApiProperty({ description: '지도 사용(map.enabled = on)이고 JS 키가 있으면 true' }) enabled!: boolean;
  @ApiPropertyOptional({ nullable: true, description: '카카오 JavaScript 키(공개 키). enabled 가 false 면 null' }) jsKey!: string | null;
}

export class MapKeyStateDto {
  @ApiProperty({ enum: ['KAKAO_REST_KEY', 'KAKAO_JS_KEY'] }) name!: string;
  @ApiProperty({ enum: ['ADMIN', 'ENV', 'NONE'], description: 'ADMIN = 운영 화면에서 넣음 · ENV = .env · NONE = 없음' }) source!: string;
  @ApiPropertyOptional({ nullable: true, example: '••••••ab12' }) masked!: string | null;
  @ApiPropertyOptional({ nullable: true }) updatedAt!: Date | null;
}
export class MapAdminDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ type: MapKeyStateDto, isArray: true }) keys!: MapKeyStateDto[];
}
export class MapKeySetDto {
  @ApiProperty({ minLength: 16, maxLength: 128, description: '카카오 콘솔 › 앱 키에서 복사한 값' })
  @IsString() @MinLength(16) @MaxLength(128) value!: string;
}
export class MapEnableDto {
  @ApiProperty() @StrictBoolean() enabled!: boolean;
}
export class MapTestResultDto {
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ nullable: true, description: 'AUTH · QUOTA · TIMEOUT · NETWORK · HTTP_4XX · UPSTREAM · BAD_RESPONSE · NOT_FOUND' }) kind!: string | null;
  @ApiProperty() message!: string;
}
export class ListingGeoAdminDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty() hasAddress!: boolean;
  @ApiProperty({ enum: ['NONE', 'PENDING', 'OK', 'FAILED', 'NOT_FOUND'] }) status!: string;
  @ApiPropertyOptional({ nullable: true }) lat!: number | null;
  @ApiPropertyOptional({ nullable: true }) lng!: number | null;
  @ApiPropertyOptional({ nullable: true }) failKind!: string | null;
  @ApiProperty() tries!: number;
  @ApiPropertyOptional({ nullable: true }) geocodedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) updatedAt!: Date | null;
}

@ApiTags('HOM')
@Controller('api/v1')
export class GeoPublicController {
  constructor(private readonly geo: GeoService) {}

  @Get('site-settings/map')
  @ApiOperation({
    summary: '지도 설정(공개)',
    description: '카카오 지도를 그릴지와 JavaScript 키(브라우저용 공개 키). 지도 사용이 꺼져 있으면 enabled=false · jsKey=null — 화면은 지도 없이 그대로입니다.',
  })
  @ApiOkResponse({ type: MapConfigDto })
  config() { return this.geo.publicConfig(); }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@Roles('SUPER')
export class GeoAdminController {
  constructor(private readonly geo: GeoService) {}

  @Get('map')
  @ApiOperation({ summary: '카카오맵 키 상태', description: '키 값은 내보내지 않습니다 — 끝 4자리와 어디서 왔는지(운영 화면 · .env · 없음)만.' })
  @ApiOkResponse({ type: MapAdminDto })
  view() { return this.geo.secretsView(); }

  @Put('map/keys/:name')
  @ApiOperation({ summary: '카카오맵 키 넣기', description: '암호화해 저장합니다(정산 계좌와 같은 열쇠). 넣은 뒤에는 다시 볼 수 없습니다 — 끝 4자리만.' })
  @ApiParam({ name: 'name', enum: ['KAKAO_REST_KEY', 'KAKAO_JS_KEY'] })
  @ApiOkResponse({ type: MapAdminDto })
  @ApiResponse({ status: 422, description: 'INTEG_SECRET_FORMAT — 키 형식이 아님', type: ErrorDto })
  @Audit('MAP_KEY_SET', 'INTEGRATION')
  setKey(@Param('name') name: string, @Body() dto: MapKeySetDto) { return this.geo.setSecret(name, dto.value); }

  @Delete('map/keys/:name')
  @ApiOperation({ summary: '카카오맵 키 지우기', description: '지우면 .env 값을 쓰고, 그것도 없으면 지도가 꺼진 것처럼 동작합니다.' })
  @ApiParam({ name: 'name', enum: ['KAKAO_REST_KEY', 'KAKAO_JS_KEY'] })
  @ApiOkResponse({ type: MapAdminDto })
  @Audit('MAP_KEY_CLEAR', 'INTEGRATION')
  clearKey(@Param('name') name: string) { return this.geo.clearSecret(name); }

  @Patch('map')
  @ApiOperation({ summary: '지도 사용 켜기 · 끄기', description: 'site_settings map.enabled. 끄면 지도 · 좌표 구하기가 모두 멈추고 화면은 지도 연동 전과 같습니다.' })
  @ApiOkResponse({ type: MapAdminDto })
  @Audit('MAP_TOGGLE', 'INTEGRATION')
  toggle(@Body() dto: MapEnableDto) { return this.geo.setEnabled(dto.enabled); }

  @Post('map/test')
  @ApiOperation({ summary: '카카오 로컬 시험 호출', description: '서울시청 주소 1건으로 REST 키를 확인합니다. 키 값은 응답에 없습니다.' })
  @ApiOkResponse({ type: MapTestResultDto })
  @ApiResponse({ status: 422, description: 'GEO_KEY_MISSING — REST 키 없음', type: ErrorDto })
  test() { return this.geo.testCall(); }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@Roles('REVIEWER', 'ADMIN', 'SUPER')
export class GeoReviewController {
  constructor(private readonly geo: GeoService) {}

  @Get('listings/:id/geo')
  @ApiOperation({ summary: '매물 좌표(검수)', description: '정확 좌표 · 상태 · 실패 종류. 검수 화면의 지도 핀.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ListingGeoAdminDto })
  @ApiResponse({ status: 404, description: '없는 매물', type: ErrorDto })
  listingGeo(@Param('id') id: string) { return this.geo.adminListingGeo(id); }

  @Post('listings/:id/geo/retry')
  @ApiOperation({ summary: '매물 좌표 다시 변환', description: '상태가 FAILED · NOT_FOUND · NONE 일 때만.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ListingGeoAdminDto })
  @ApiResponse({ status: 409, description: 'GEO_NOT_RETRYABLE — 이미 좌표가 있거나 찾는 중 · 주소 없음', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MAP_DISABLED — 지도 사용 꺼짐', type: ErrorDto })
  @Audit('LISTING_GEO_RETRY', 'LISTING')
  retry(@Param('id') id: string) { return this.geo.adminRetry(id); }
}
