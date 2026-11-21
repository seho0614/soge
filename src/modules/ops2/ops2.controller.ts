import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import { ErrorDto } from '../../common/dto/common.dto';
import { StrictBoolean } from '../../common/strict-boolean';
import { Principal, Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { DatabaseService } from '../../db/database.service';
import { OPS2_DRILL_MODES, OPS2_SNAPSHOT_RE, OPS2_TABLE_RE, ops2DrillAdd, ops2DrillScript } from './drill';
import { OPS2_ERROR_STATES, OPS2_FP_RE, ops2ErrorGroups, ops2ErrorGroupState } from './error-groups';
import { OPS2_METRICS, ops2VitalBeat, ops2VitalsView } from './vitals';

/* ---------------------------------------------------------------------
 * v10.585 ~ 589 (docs/727 ~ 731) 14차 운영 — 앞머리 ops2_
 *   Ops2Controller  api/v1/admin/ops2
 *     SUPER        GET  /restore-drills/script          ① 스크립트로 적은 복원 시험(표마다 행 수)            (v10.585)
 *     SUPER        POST /restore-drills/result          ① restore-drill.sh 결과 붙여 넣기(감사 RESTORE_DRILL_ADD)  (v10.585)
 *     ADMIN·SUPER  GET  /error-groups?state=&days=      ③ 서버 오류 묶음(지문 · 처음 · 마지막 · 횟수 · 상태)     (v10.587)
 *     ADMIN·SUPER  POST /error-groups/{fp}/state        ③ 묶음 상태 바꾸기(감사 OPS2_ERROR_GROUP_STATE)          (v10.587)
 *     ADMIN·SUPER  GET  /web-vitals?days=               ④ 화면 속도(지표마다 75번째 값 · 화면별 · 날마다)        (v10.588)
 *   Ops2PublicController  api/v1
 *     공개         POST /site/vitals                     ④ 사용자 웹이 잰 값 하나(로그인 없이 · site 구역 · check-acl PUBLIC_OK)
 *   세무사(ACCOUNTANT)는 보지 않음(/admin/acct/ 밖) · ② 무중단 설계 · ⑤ 디스크 정리는 문서 · 스크립트만(API 없음)
 * ------------------------------------------------------------------- */

/* ts-node 선언 순서 — 쓰는 DTO 먼저 */
export class Ops2DrillTableDto {
  @ApiProperty({ example: 'accounts', description: '표 이름(스키마 점 하나까지 · 소문자 · 숫자 · _)' }) @IsString() @Matches(OPS2_TABLE_RE) name!: string;
  @ApiProperty({ example: 1203, description: '운영 DB 행 수' }) @IsInt() @Min(0) @Max(2_000_000_000) src!: number;
  @ApiProperty({ example: 1201, description: '복원 DB 행 수' }) @IsInt() @Min(0) @Max(2_000_000_000) drill!: number;
}
export class Ops2DrillResultDto {
  @ApiProperty({ example: '2026-11-21', description: '시험한 날(오늘 · 지난 1년 안)' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) drillDate!: string;
  @ApiProperty({ example: 'rds:sgb-db-2026-11-21-03-10', description: '복원한 스냅샷 이름' }) @IsString() @Matches(OPS2_SNAPSHOT_RE) snapshot!: string;
  @ApiProperty({ example: 18, description: '복원에 걸린 분(1 ~ 1440)' }) @IsInt() @Min(1) @Max(1440) minutes!: number;
  @ApiProperty({ description: '스크립트가 본 행 수 맞음(서버가 다시 셈)' }) @StrictBoolean() rowsMatch!: boolean;
  @ApiProperty({ description: '스크립트가 본 이상 없음(접속 · 마이그레이션 수 · 행 수)' }) @StrictBoolean() ok!: boolean;
  @ApiPropertyOptional({ example: 'aws 방식 · 새 DB 지움', description: '메모(500자까지)' }) @IsOptional() @IsString() @MaxLength(500) note?: string;
  @ApiProperty({ enum: [...OPS2_DRILL_MODES, 'compare'], description: 'aws(스크립트가 복원) · console(사람이 콘솔에서 복원) · compare(리허설 — 422)' }) @IsString() @MaxLength(10) mode!: string;
  @ApiPropertyOptional({ example: 'restore-drill.sh v10.585' }) @IsOptional() @IsString() @MaxLength(60) tool?: string;
  @ApiProperty({ type: [Ops2DrillTableDto], description: '표마다 행 수 1 ~ 30줄' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => Ops2DrillTableDto) tables!: Ops2DrillTableDto[];
}
export class Ops2ErrorStateDto {
  @ApiProperty({ enum: [...OPS2_ERROR_STATES], description: 'OPEN 다시 열기 · ACK 확인함 · MUTED 알리지 않음(메모 꼭) · FIXED 고침(다시 나면 알림)' }) @IsIn([...OPS2_ERROR_STATES]) state!: string;
  @ApiPropertyOptional({ example: 'v10.590 에서 고침', description: '메모(200자까지 · MUTED 는 2자 이상)' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class Ops2VitalDto {
  @ApiProperty({ example: '/community/3f0c…', description: '지금 화면 주소(서버가 번호 · 코드를 :id 로 묶음 · 물음표 뒤 버림)' }) @IsString() @MaxLength(400) p!: string;
  @ApiProperty({ enum: [...OPS2_METRICS], description: '지표' }) @IsIn([...OPS2_METRICS]) n!: string;
  @ApiProperty({ example: 2140, description: '값(CLS 는 단위 없음 · 나머지 ms · 0 이상 600000 미만)' }) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(599999) v!: number;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/ops2')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class Ops2Controller {
  constructor(private readonly db: DatabaseService) {}

  /* ── ① DB 복원 반자동 리허설(v10.585 · docs/727) ── */
  @Get('restore-drills/script')
  @Roles('SUPER')
  @ApiOperation({ summary: '스크립트로 적은 DB 복원 시험 (v10.585)', description: 'restore_drills 중 source = SCRIPT 최근 6번(날 · 스냅샷 · 분 · 행 수 맞음 · 이상 여부 · 표마다 운영 / 복원 행 수) · 행 수 차이 한도(ops2.drill_tol_pct) · 적을 수 있는가.' })
  @ApiOkResponse({ type: Object })
  drillScript(@Req() req: Request) {
    const p = (req as any).principal as Principal | undefined;
    return ops2DrillScript(this.db, (p?.roles ?? []) as string[]);
  }

  @Post('restore-drills/result')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('RESTORE_DRILL_ADD', 'SETTING', { pick: ['ok', 'id', 'rowsMatch', 'drillOk'] })
  @ApiOperation({ summary: 'restore-drill.sh 결과 붙여 넣기 (v10.585 · SUPER)', description: '스크립트가 끝에 찍은 JSON 그대로. 행 수 맞음은 서버가 다시 셈(복원이 많으면 다름 · 적은 것은 한도 퍼센트 또는 100줄까지). 쌓기만 · 적으면 RESTORE_DRILL_DUE 풀림. 리허설(compare)은 받지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPS2_DRILL_DUP — 같은 날 · 같은 스냅샷 스크립트 결과가 이미 있음' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPS2_DRILL_MODE · OPS2_DRILL_TABLES · RESTORE_DRILL_DATE · RESTORE_DRILL_SNAPSHOT' })
  drillResult(@Body() dto: Ops2DrillResultDto) { return ops2DrillAdd(this.db, dto); }

  /* ── ③ 서버 오류 묶기(v10.587 · docs/729) ── */
  @Get('error-groups')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'state', required: false, enum: [...OPS2_ERROR_STATES] })
  @ApiQuery({ name: 'days', required: false, enum: ['1', '7', '30', '90', '365'], description: '마지막으로 난 때가 이 날 수 안(처음 30)' })
  @ApiOperation({ summary: '서버 오류 묶음 (v10.587)', description: '지문(방법 · 주소 · 오류 종류 · 응답 번호 · DB 오류 번호)마다 처음 · 마지막 · 모든 횟수 · 난 날 수 · 최근 7일 건수 · 가린 설명 · 요청 번호 · 상태 · 알림 시각(열린 것 먼저 · 100줄) · 상태별 수 · 새 오류 알림 스위치. 요청 내용 · 개인정보 없음.' })
  @ApiOkResponse({ type: Object })
  errorGroups(@Query('state') state?: string, @Query('days') days?: string) { return ops2ErrorGroups(this.db, state, days); }

  @Post('error-groups/:fp/state')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @Audit('OPS2_ERROR_GROUP_STATE', 'SETTING', { pick: ['ok', 'fp', 'state', 'before'] })
  @ApiParam({ name: 'fp', example: '0f343b0931126a20f133d67c2b018a3b', description: '지문(md5 32자)' })
  @ApiOperation({ summary: '서버 오류 묶음 상태 바꾸기 (v10.587)', description: 'ACK 확인함 · MUTED 알리지 않음(다시 나도 알림 없음 · 메모 꼭) · FIXED 고침(다시 나면 OPEN 으로 돌고 SERVER_ERROR_REOPEN) · OPEN 다시 열기.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 묶음 없음' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'OPS2_ERROR_SAME · OPS2_ERROR_CHANGED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPS2_ERROR_STATE · OPS2_ERROR_NOTE' })
  errorGroupState(@Param('fp') fp: string, @Body() dto: Ops2ErrorStateDto) {
    return ops2ErrorGroupState(this.db, OPS2_FP_RE.test(String(fp ?? '')) ? String(fp) : '', dto.state, dto.note);
  }

  /* ── ④ 사용자 웹 화면 속도(v10.588 · docs/730) ── */
  @Get('web-vitals')
  @Roles('ADMIN', 'SUPER')
  @ApiQuery({ name: 'days', required: false, enum: ['1', '7', '30'] })
  @ApiOperation({ summary: '사용자 웹 화면 속도 (v10.588)', description: '최근 N일 — 지표(LCP · INP · CLS · FCP · TTFB)마다 표본 수 · 75번째 값 · 좋음 · 나쁨 비율 / 화면 주소 묶음 50(표본 수 순 · LCP · INP · CLS · TTFB 75번째 값 · 나쁨 비율) / 날마다 LCP · INP · 설정 · 기준. 읽기만.' })
  @ApiOkResponse({ type: Object })
  webVitals(@Query('days') days?: string) { return ops2VitalsView(this.db, days); }
}

@ApiTags('HOM')
@ApiBearerAuth()
@Controller('api/v1')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class Ops2PublicController {
  constructor(private readonly db: DatabaseService) {}

  @Post('site/vitals')
  @HttpCode(200)
  @ApiOperation({
    summary: '사용자 웹 화면 속도 보내기 (v10.588)',
    description: '로그인 없이 · 화면 주소 묶음 · 지표 · 값 한 줄(계정 · IP · 브라우저 정보 · 방문자 키 · 쿠키 저장 없음) · ops2.web_vitals 가 꺼져 있거나 DNT · GPC · 로봇이면 ok:false(오류 아님) · IP 지문은 1분 요청 수 제한에만 메모리에서 씀.',
  })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 400, type: ErrorDto, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'POLICY' })
  vital(@Body() dto: Ops2VitalDto, @Headers('user-agent') ua?: string, @Headers('dnt') dnt?: string, @Headers('sec-gpc') gpc?: string,
        @Headers('x-forwarded-for') xff?: string, @Ip() ip?: string) {
    return ops2VitalBeat(this.db, dto, { ua, dnt, gpc, ip: (xff?.split(',')[0]?.trim() || ip) ?? '' });
  }
}
