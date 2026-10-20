import { Body, Controller, Delete, Get, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { StrictBoolean } from '../../common/strict-boolean';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { WeatherService } from './weather.service';
import { WX_REGION_CODES } from './weather.provider';

/* ---------------------------------------------------------------------
 * v10.49 (D103 · docs/101) — 메인 「오늘의 날씨」(기상청 단기예보)
 *
 *   공개   GET    /weather/today?region=SEOUL     오늘의 날씨(SB-HOM-MAIN-010 · 011). 꺼져 있거나 키 · 응답이 없으면 available=false
 *   SUPER  GET    /admin/weather                  날씨 키 상태(끝 4자리만) · 사용 여부 · 처음 지역   (SB-ADM-SIT-080)
 *          PUT    /admin/weather/key              키 넣기(암호화 저장 · 다시 보이지 않음)
 *          DELETE /admin/weather/key              키 지우기(그 뒤 .env 값 · 없으면 날씨 띠 숨김)
 *          PATCH  /admin/weather                  날씨 사용 켜기 · 끄기 · 처음 지역
 *          POST   /admin/weather/test             시험 호출(서울 초단기실황 1번)
 *
 * 감사 기록은 응답을 남깁니다 — 키 API 의 응답에는 끝 4자리만 있어 키 값이 감사 기록에 들어가지 않습니다.
 * ------------------------------------------------------------------- */

export class WeatherRegionDto {
  @ApiProperty({ example: 'SEOUL' }) code!: string;
  @ApiProperty({ example: '서울' }) name!: string;
}
export class WeatherTodayDto {
  @ApiProperty({ description: 'false 면 화면은 날씨 띠를 그리지 않습니다(꺼짐 · 키 없음 · 기상청 실패)' }) available!: boolean;
  @ApiProperty({ example: 'SEOUL' }) region!: string;
  @ApiProperty({ example: '서울' }) regionName!: string;
  @ApiProperty({ type: WeatherRegionDto, isArray: true, description: '고를 수 있는 시 · 도 17곳' }) regions!: WeatherRegionDto[];
  @ApiPropertyOptional({ nullable: true, description: '지금 기온(°C · 반올림)' }) temp!: number | null;
  @ApiPropertyOptional({ nullable: true, example: '맑음' }) label!: string | null;
  @ApiPropertyOptional({ nullable: true, enum: ['sun', 'partly', 'cloud', 'rain', 'sleet', 'snow'] }) icon!: string | null;
  @ApiPropertyOptional({ nullable: true, description: '오늘 최저(°C)' }) min!: number | null;
  @ApiPropertyOptional({ nullable: true, description: '오늘 최고(°C)' }) max!: number | null;
  @ApiPropertyOptional({ nullable: true, description: '오늘 남은 시간의 가장 높은 강수확률(%)' }) pop!: number | null;
  @ApiPropertyOptional({ nullable: true, description: '습도(%)' }) humidity!: number | null;
  @ApiPropertyOptional({ nullable: true, example: '14시', description: '관측(실황) 기준 시각' }) observedAt!: string | null;
  @ApiProperty({ example: '기상청' }) source!: string;
}
export class WeatherKeyStateDto {
  @ApiProperty({ enum: ['KMA_SERVICE_KEY'] }) name!: string;
  @ApiProperty({ enum: ['ADMIN', 'ENV', 'NONE'], description: 'ADMIN = 운영 화면에서 넣음 · ENV = .env · NONE = 없음' }) source!: string;
  @ApiPropertyOptional({ nullable: true, example: '••••••ab12' }) masked!: string | null;
  @ApiPropertyOptional({ nullable: true }) updatedAt!: Date | null;
}
export class WeatherAdminDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ example: 'SEOUL' }) defaultRegion!: string;
  @ApiProperty({ type: WeatherRegionDto, isArray: true }) regions!: WeatherRegionDto[];
  @ApiProperty({ type: WeatherKeyStateDto }) key!: WeatherKeyStateDto;
}
export class WeatherKeySetDto {
  @ApiProperty({ minLength: 20, maxLength: 200, description: '공공데이터포털 › 활용 신청 상세의 일반 인증키(Decoding)' })
  @IsString() @MinLength(20) @MaxLength(200) value!: string;
}
export class WeatherUpdateDto {
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() enabled?: boolean;
  @ApiPropertyOptional({ enum: WX_REGION_CODES }) @IsOptional() @IsString() @Matches(/^[A-Z]{4,10}$/) defaultRegion?: string;
}
export class WeatherTestResultDto {
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ nullable: true, description: 'AUTH · QUOTA · TIMEOUT · NETWORK · NO_DATA · REJECTED · UPSTREAM · BAD_RESPONSE' }) kind!: string | null;
  @ApiProperty() message!: string;
}

@ApiTags('HOM')
@Controller('api/v1')
export class WeatherPublicController {
  constructor(private readonly wx: WeatherService) {}

  @Get('weather/today')
  @ApiOperation({
    summary: '오늘의 날씨(공개)',
    description: '기상청 단기예보 조회서비스 — 지금 기온 · 하늘 · 오늘 최저 · 최고 · 강수확률 · 습도. 없는 지역 코드는 처음 지역으로 봅니다. '
      + '날씨 사용이 꺼져 있거나 키 · 기상청 응답이 없으면 available=false(지어낸 날씨를 내보내지 않음).',
  })
  @ApiQuery({ name: 'region', required: false, enum: WX_REGION_CODES })
  @ApiOkResponse({ type: WeatherTodayDto })
  today(@Query('region') region?: string) {
    return this.wx.today(typeof region === 'string' ? region.slice(0, 12).toUpperCase() : undefined);
  }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@Roles('SUPER')
export class WeatherAdminController {
  constructor(private readonly wx: WeatherService) {}

  @Get('weather')
  @ApiOperation({ summary: '날씨 키 상태', description: '키 값은 내보내지 않습니다 — 끝 4자리와 어디서 왔는지(운영 화면 · .env · 없음)만.' })
  @ApiOkResponse({ type: WeatherAdminDto })
  view() { return this.wx.adminView(); }

  @Put('weather/key')
  @ApiOperation({ summary: '기상청 인증키 넣기', description: '암호화해 저장합니다(카카오맵 키와 같은 열쇠). 넣은 뒤에는 다시 볼 수 없습니다 — 끝 4자리만.' })
  @ApiOkResponse({ type: WeatherAdminDto })
  @ApiResponse({ status: 422, description: 'INTEG_SECRET_FORMAT — 키 형식이 아님', type: ErrorDto })
  @Audit('WEATHER_KEY_SET', 'INTEGRATION')
  setKey(@Body() dto: WeatherKeySetDto) { return this.wx.setKey(dto.value); }

  @Delete('weather/key')
  @ApiOperation({ summary: '기상청 인증키 지우기', description: '지우면 .env 값을 쓰고, 그것도 없으면 메인의 날씨 띠가 숨습니다.' })
  @ApiOkResponse({ type: WeatherAdminDto })
  @Audit('WEATHER_KEY_CLEAR', 'INTEGRATION')
  clearKey() { return this.wx.clearKey(); }

  @Patch('weather')
  @ApiOperation({ summary: '날씨 사용 · 처음 지역', description: 'site_settings weather.enabled · weather.default_region. 끄면 기상청을 부르지 않고 메인은 날씨 연동 전과 같습니다.' })
  @ApiOkResponse({ type: WeatherAdminDto })
  @ApiResponse({ status: 422, description: 'WEATHER_REGION — 없는 지역', type: ErrorDto })
  @Audit('WEATHER_UPDATE', 'INTEGRATION')
  update(@Body() dto: WeatherUpdateDto) { return this.wx.update(dto.enabled, dto.defaultRegion); }

  @Post('weather/test')
  @ApiOperation({ summary: '기상청 시험 호출', description: '서울 초단기실황 1번으로 키를 확인합니다. 키 값은 응답에 없습니다.' })
  @ApiOkResponse({ type: WeatherTestResultDto })
  @ApiResponse({ status: 422, description: 'WEATHER_KEY_MISSING — 키 없음', type: ErrorDto })
  test() { return this.wx.testCall(); }
}
