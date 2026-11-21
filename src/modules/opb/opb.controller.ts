import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { StrictBoolean } from '../../common/strict-boolean';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { DatabaseService } from '../../db/database.service';
import { opbGlance } from './glance';
import { OPB_SEVS, opbRouteRemove, opbRouteSet, opbRouteSwitch, opbRouteView } from './alert-routes';

/* ---------------------------------------------------------------------
 * v10.571 · 572 (docs/713 · 714) 10차 운영 기반 — 앞머리 opb_ · 모두 SUPER
 *   OpbController  api/v1/admin/opb
 *     GET  /glance                         대표 한눈에(읽기만)
 *     GET  /alert-routes                   운영 알림 받을 사람 규칙 · 최근 30일 종류 · 권한그룹 · 스위치 · 바꾼 기록
 *     PUT  /alert-routes/{code}            규칙 한 줄 넣기 · 고치기(409 그 사이 바뀜 · 422 형식 · 막힌 종류)
 *     POST /alert-routes/{code}/remove     규칙 한 줄 빼기(기본 줄 * 은 못 뺌)
 *     PUT  /alert-route-settings           스위치 opb.alert_routes · opb.alert_group_mail
 *   세무사(ACCOUNTANT)는 보지 않음(/admin/acct/ 밖)
 * ------------------------------------------------------------------- */

const OPB_GROUP_RE = /^[A-Z][A-Z0-9_]{1,40}$/;               // = DB CHECK perm_role_groups.key

export class OpbRouteSetDto {
  @ApiPropertyOptional({ description: '텔레그램으로' }) @IsOptional() @StrictBoolean() toTelegram?: boolean;
  @ApiPropertyOptional({ description: '메일로(대표 메일 ops.digest_to)' }) @IsOptional() @StrictBoolean() toMail?: boolean;
  @ApiPropertyOptional({ description: '슬랙으로' }) @IsOptional() @StrictBoolean() toSlack?: boolean;
  @ApiPropertyOptional({ description: '운영자 게시판에(CRITICAL 은 늘 올림)' }) @IsOptional() @StrictBoolean() toBoard?: boolean;
  @ApiPropertyOptional({ enum: OPB_SEVS, description: '급함 기준 — 이 등급 이상이면 보냄' }) @IsOptional() @IsIn([...OPB_SEVS]) minSeverity?: string;
  @ApiPropertyOptional({ example: 60, description: '같은 종류를 그 길로 다시 보내기까지 분(0 ~ 1440 · 0 = 묶지 않음 · 게시판은 상관없음)' }) @IsOptional() @IsInt() @Min(0) @Max(1440) throttleMin?: number;
  @ApiPropertyOptional({ type: [String], example: ['R_ADMIN'], description: '받을 권한그룹(perm_role_groups.key · 10개까지 · 메일 따로 보내기는 opb.alert_group_mail)' })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @Matches(OPB_GROUP_RE, { each: true }) groups?: string[];
  @ApiPropertyOptional({ example: '야간에는 텔레그램만' }) @IsOptional() @IsString() @MaxLength(200) note?: string;
  @ApiPropertyOptional({ description: '읽을 때의 updatedAt — 다르면 409 OPB_ROUTE_CHANGED' }) @IsOptional() @IsString() @MaxLength(40) expectedUpdatedAt?: string;
  @ApiProperty({ example: '백업 실패는 메일만 받기로' }) @IsString() @Length(2, 200) reason!: string;
}
export class OpbRouteRemoveDto {
  @ApiProperty({ example: '기본 줄을 따르게' }) @IsString() @Length(2, 200) reason!: string;
}
export class OpbRouteSwitchDto {
  @ApiPropertyOptional({ description: 'opb.alert_routes — 규칙 쓰기(처음 off = 지금 동작)' }) @IsOptional() @StrictBoolean() on?: boolean;
  @ApiPropertyOptional({ description: 'opb.alert_group_mail — 권한그룹 사람에게 따로 메일(처음 off)' }) @IsOptional() @StrictBoolean() groupMail?: boolean;
  @ApiProperty({ example: '규칙 확인 끝 · 켬' }) @IsString() @Length(2, 200) reason!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/opb')
@Roles('SUPER')
@ApiResponse({ status: 403, description: '권한 없음(SUPER 만)', type: ErrorDto })
export class OpbController {
  constructor(private readonly db: DatabaseService) {}

  @Get('glance')
  @ApiOperation({ summary: '대표 한눈에 (v10.571)', description: '가입 · 매물 · 거래 · 소개몰 매출 · 정산 지급 · 문의 · 경고 · 급한 알림을 오늘 · 어제 · 그저께 · 지난 7일 · 그 앞 7일로 나란히(일보와 같은 셈) + 지금 상태(확인 안 한 급한 알림 · 오픈 차단 · 열린 문의 · 정산 대기). 읽기만 · 합계만 · SUPER.' })
  @ApiOkResponse({ type: Object })
  glance() { return opbGlance(this.db); }

  @Get('alert-routes')
  @ApiOperation({ summary: '운영 알림 받을 사람 규칙 (v10.572)', description: '종류마다 길(텔레그램 · 메일 · 슬랙 · 게시판) · 급함 기준 · 묶음 간격 · 받을 권한그룹 · 기본 줄(*) · 최근 30일 종류별 수와 「지금 동작」 대 「규칙」 길 · 권한그룹 · 스위치(opb.alert_routes · opb.alert_group_mail) · 바꾼 기록 30줄.' })
  @ApiOkResponse({ type: Object })
  routes() { return opbRouteView(this.db); }

  @Put('alert-routes/:code')
  @Audit('OPB_ALERT_ROUTE_SET', 'SITE_SETTING', { pick: ['ok', 'code', 'created'] })
  @ApiParam({ name: 'code', example: 'UPLOADS_BACKUP_FAILED', description: '알림 종류(영어 대문자 · 숫자 · 밑줄) 또는 기본 줄 *' })
  @ApiOperation({ summary: '규칙 한 줄 넣기 · 고치기 (v10.572)', description: '보낸 칸만 바꿈 · 새 줄은 기본 줄(*)을 바탕으로 · AUDIT_CHAIN_BROKEN 은 막힘(늘 네 길) · CRITICAL 은 게시판을 꺼도 늘 올라감. 스위치가 꺼져 있으면 저장만 되고 보내기는 지금 동작 그대로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPB_ROUTE_CHANGED — 그 사이 다른 사람이 바꿈(expectedUpdatedAt 다름)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPB_ROUTE_CODE · OPB_ROUTE_LOCKED · OPB_ROUTE_SEV · OPB_ROUTE_THROTTLE · OPB_ROUTE_GROUP · OPB_ROUTE_NOTE · OPB_REASON' })
  set(@Param('code') code: string, @Body() dto: OpbRouteSetDto) {
    return opbRouteSet(this.db, String(code ?? '').slice(0, 64), dto);   // 형식은 opbRouteSet 이 OPB_ROUTE_CODE_RE(= DB CHECK)로 봄
  }

  @Post('alert-routes/:code/remove')
  @HttpCode(200)
  @Audit('OPB_ALERT_ROUTE_REMOVE', 'SITE_SETTING', { pick: ['ok', 'code'] })
  @ApiParam({ name: 'code', example: 'UPLOADS_BACKUP_FAILED' })
  @ApiOperation({ summary: '규칙 한 줄 빼기 (v10.572)', description: '그 종류는 기본 줄(*)을 따름. 기본 줄은 못 뺌(422 OPB_ROUTE_DEFAULT).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 그 종류 규칙 없음' })
  @ApiResponse({ status: 409, type: ErrorDto, description: '(쓰지 않음 — 변경 API 형식 맞춤)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPB_ROUTE_DEFAULT · OPB_ROUTE_CODE · OPB_REASON' })
  remove(@Param('code') code: string, @Body() dto: OpbRouteRemoveDto) { return opbRouteRemove(this.db, code, dto.reason); }

  @Put('alert-route-settings')
  @Audit('OPB_ALERT_ROUTE_SWITCH', 'SITE_SETTING', { pick: ['ok', 'changed'] })
  @ApiOperation({ summary: '알림 규칙 스위치 (v10.572)', description: 'opb.alert_routes(규칙 쓰기 · 처음 off) · opb.alert_group_mail(권한그룹 사람에게 따로 메일 · 처음 off). 보낸 칸만 바꿈 · 사유는 설정 바뀐 기록 · 규칙 기록에.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '(쓰지 않음 — 변경 API 형식 맞춤)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPB_NOTHING · OPB_REASON' })
  settings(@Body() dto: OpbRouteSwitchDto) { return opbRouteSwitch(this.db, dto); }
}
