import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { DatabaseService } from '../../db/database.service';
import { geoTest, geoView, setGeoSettings } from './geo-guard';

/* ---------------------------------------------------------------------
 * v10.485 (D268 · docs/623) 해외 접속 경고 — 운영 화면 › 위험감지 › 「해외 접속 경고」(SB-ADM-SCU-030)
 *   ADMIN · SUPER  GET /admin/security/geo(설정 · 판별 준비 · 30일 셈 · 최근 판정 50)
 *   SUPER          PUT /admin/security/geo(켜기 · 방식 · 간주 나라 · 허용 나라 · 막기 · 사유) · POST /admin/security/geo/test(IP 하나 판별)
 * ------------------------------------------------------------------- */

export class SecGeoSettingsDto {
  @ApiPropertyOptional({ description: 'security.geo_watch' }) @IsOptional() @IsBoolean() watch?: boolean;
  @ApiPropertyOptional({ enum: ['ASSUME', 'LIVE'] }) @IsOptional() @IsIn(['ASSUME', 'LIVE']) mode?: string;
  @ApiPropertyOptional({ example: 'KR', description: '간주 판별 나라(두 글자)' }) @IsOptional() @IsString() @Matches(/^[A-Z]{2}$/) assumeCountry?: string;
  @ApiPropertyOptional({ example: 'KR,JP', description: '허용 나라(쉼표 · KR 꼭)' }) @IsOptional() @IsString() @Length(2, 120) allow?: string;
  @ApiPropertyOptional({ description: 'security.geo_block — 켠 경고 위에서만' }) @IsOptional() @IsBoolean() block?: boolean;
  @ApiProperty({ example: '해외 접속 경고 시작' }) @IsString() @Length(2, 200) reason!: string;
}
export class SecGeoTestDto {
  @ApiProperty({ example: '8.8.8.8' }) @IsString() @Matches(/^[0-9a-fA-F:.]{2,45}$/) ip!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class SecGeoController {
  constructor(private readonly db: DatabaseService) {}

  @Get('security/geo')
  @Roles('ADMIN')
  @ApiOperation({ summary: '해외 접속 경고 (v10.485)', description: '설정(켜짐 · 방식 · 간주 나라 · 허용 나라 · 막기) · 판별 준비(키 · 주소 틀) · 30일 셈(경고 · 막음 · 판별 못 함) · 최근 운영 로그인 판정 50(가린 이메일 · IP 앞 두 마디).' })
  @ApiOkResponse({ type: Object })
  view() { return geoView(this.db); }

  @Put('security/geo')
  @Roles('SUPER')
  @Audit('SEC_GEO_SETTINGS', 'SETTING')
  @ApiOperation({ summary: '해외 접속 경고 설정 (v10.485 · SUPER)', description: 'LIVE 는 키(GEOIP_API_KEY)가 있어야 · 허용 나라에 KR 꼭 · 막기는 경고를 켠 뒤 · 사유(설정 바뀜 기록).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'GEO_REASON · GEO_MODE · GEO_NOT_READY · GEO_COUNTRY · GEO_ALLOW · GEO_ALLOW_KR · GEO_BLOCK_NEEDS_WATCH · GEO_NOTHING' })
  settings(@Body() dto: SecGeoSettingsDto) { return setGeoSettings(this.db, dto); }

  @Post('security/geo/test')
  @Roles('SUPER')
  @HttpCode(200)
  @ApiOperation({ summary: 'IP 나라 판별 시험 (v10.485 · SUPER)', description: '지금 방식으로 IP 하나를 판별(기록 · 알림 없음 · LIVE 면 업체를 부름 · 결과는 IP 앞 두 마디로).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'GEO_IP' })
  test(@Body() dto: SecGeoTestDto) { return geoTest(this.db, dto.ip); }
}
