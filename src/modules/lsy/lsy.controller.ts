import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { setLsySettings } from './common';
import { dupDecide, dupDetail, dupList, dupScanNow, DUP_STATES, DUP_VERDICTS } from './dup';
import { myPhotoChecks, photoList, photoRecheck, PHOTO_VIEWS } from './photo';
import { adminVideoList, attachVideo, decideVideo, myVideos, publicVideo, removeVideo, VIDEO_STATES } from './video';
import { TRIAGE_KINDS, TRIAGE_URGENCIES, TRIAGE_VIEWS, triageConfirm, triageList } from './triage';
import { lsyOverview } from './jobs';

/* ---------------------------------------------------------------------
 * v10.524 ~ 527 (D279 · docs/662 ~ 665) ㊾ 매물 2 — 중복 매물 자동 탐지 · 사진 품질 검사 · 매물 동영상 · 신고 자동 분류 · 우선순위
 *   공개(로그인 없이 · 개인정보 없음)  GET /site/lsy/listings/{id}/video
 *   회원                              GET /me/lsy/videos · POST · DELETE /me/lsy/listings/{id}/video · GET /me/lsy/listings/{id}/photo-checks
 *   운영(검수 › 매물 중복 의심 · 사진 품질 · 매물 동영상 / 위험감지 › 신고 분류)
 *                                     GET /admin/lsy/overview · PUT /admin/lsy/settings(SUPER)
 *                                     GET /admin/lsy/dups · GET /admin/lsy/dups/{id} · POST /admin/lsy/dups/{id}/decide · POST /admin/lsy/dups/scan
 *                                     GET /admin/lsy/photos · POST /admin/lsy/photos/recheck
 *                                     GET /admin/lsy/videos · POST /admin/lsy/videos/{id}/decide
 *                                     GET /admin/lsy/triage · POST /admin/lsy/triage/{id}/confirm
 *   세무사(ACCOUNTANT)는 /admin/acct/ 밖이라 보지 않음 · 공개 주소는 site/ 구역(scripts/check-acl.js PUBLIC_OK 에 이미 있음)
 * ------------------------------------------------------------------- */

const MEMBER = ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'] as const;
const REV = ['ADMIN', 'SUPER', 'REVIEWER'] as const;
const me = () => RequestCtx.actorId()!;

export class LsySettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() dupDetect?: boolean;
  @ApiPropertyOptional({ example: 80 }) @IsOptional() @IsInt() @Min(50) @Max(100) dupThreshold?: number;
  @ApiPropertyOptional({ example: 60 }) @IsOptional() @IsInt() @Min(1) @Max(180) dupWindowDays?: number;
  @ApiPropertyOptional({ description: '기준 넘은 짝의 나중 매물을 검수 대기에(처음 켬 · 탐지가 켜졌을 때만)' }) @IsOptional() @IsBoolean() dupQueue?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() photoCheck?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() photoAi?: boolean;
  @ApiPropertyOptional({ example: 600 }) @IsOptional() @IsInt() @Min(200) @Max(2000) photoMinPx?: number;
  @ApiPropertyOptional({ example: 20 }) @IsOptional() @IsInt() @Min(1) @Max(50) photoBatch?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() video?: boolean;
  @ApiPropertyOptional({ example: 30 }) @IsOptional() @IsInt() @Min(1) @Max(50) videoMaxMb?: number;
  @ApiPropertyOptional({ example: 60 }) @IsOptional() @IsInt() @Min(5) @Max(120) videoMaxSec?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() reportTriage?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() reportAi?: boolean;
  @ApiPropertyOptional({ example: '' }) @IsOptional() @IsString() @Matches(/^(|[a-z0-9][a-z0-9.-]{2,59})$/) aiModel?: string;
  @ApiProperty({ example: '대표 결정 — 중복 탐지 켜기' }) @IsString() @Length(2, 200) reason!: string;
}
export class LsyAttachVideoDto {
  @ApiProperty({ format: 'uuid', description: 'POST /files(purpose LISTING_VIDEO) → PUT → complete 를 마친 내 파일' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) fileId!: string;
}
export class LsyDupDecideDto {
  @ApiProperty({ enum: DUP_VERDICTS, description: 'SAME 같은 매물 · DIFFERENT 다른 매물' }) @IsIn(DUP_VERDICTS as unknown as string[]) verdict!: string;
  @ApiProperty({ example: '사진 · 글이 같고 주인이 같음 — 반복 등록' }) @IsString() @Length(2, 300) reason!: string;
}
export class LsyListingRefDto {
  @ApiProperty({ format: 'uuid' }) @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) listingId!: string;
}
export class LsyVideoDecideDto {
  @ApiProperty() @IsBoolean() approve!: boolean;
  @ApiPropertyOptional({ maxLength: 300, description: '반려 때 필수(2자 이상)' }) @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
export class LsyTriageConfirmDto {
  @ApiPropertyOptional({ enum: TRIAGE_KINDS, description: '안 보내면 제안 그대로' }) @IsOptional() @IsIn(TRIAGE_KINDS as unknown as string[]) kind?: string;
  @ApiPropertyOptional({ enum: TRIAGE_URGENCIES, description: '안 보내면 제안 그대로' }) @IsOptional() @IsIn(TRIAGE_URGENCIES as unknown as string[]) urgency?: string;
  @ApiPropertyOptional({ maxLength: 300 }) @IsOptional() @IsString() @MaxLength(300) note?: string;
}

@ApiTags('LSY')
@ApiBearerAuth()
@Controller('api/v1')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class LsyController {
  constructor(private readonly db: DatabaseService) {}

  /* ── 공개 ── */
  @Get('site/lsy/listings/:id/video')
  @ApiOperation({ summary: '매물 동영상 (v10.526)', description: '운영자가 승인한 동영상의 5분짜리 주소 — 스위치 켬 · 매물 게시 중일 때만. 없으면 video=null.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  video(@Param('id') id: string) { return publicVideo(this.db, id); }

  /* ── 회원 ── */
  @Get('me/lsy/videos')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '매물 동영상 · 사진 점검 (v10.525 · 526)', description: '동영상을 붙일 수 있는 내 매물 · 붙인 영상 상태 · 반려 사유 · 사진 경고 수 · 용량 · 길이 제한.' })
  @ApiOkResponse({ type: Object })
  myVideos() { return myVideos(this.db, me()); }

  @Post('me/lsy/listings/:id/video')
  @HttpCode(200)
  @Roles(...MEMBER)
  @ApiOperation({ summary: '매물 동영상 붙이기 (v10.526)', description: '내가 올린 LISTING_VIDEO 파일(MP4) · 서버가 길이를 읽어 확인 · 매물마다 1개(앞 것은 바뀜) · 운영자 확인 뒤 공개.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 매물 · 남의 매물', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'LSY_VIDEO_LISTING_STATE · LSY_VIDEO_SAME', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LSY_VIDEO_OFF · LSY_VIDEO_FILE · LSY_VIDEO_TOO_BIG · LSY_VIDEO_UNREADABLE · LSY_VIDEO_TOO_LONG', type: ErrorDto })
  attach(@Param('id') id: string, @Body() dto: LsyAttachVideoDto) { return attachVideo(this.db, me(), id, { fileId: dto.fileId }); }

  @Delete('me/lsy/listings/:id/video')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '매물 동영상 빼기 (v10.526)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '붙인 동영상 없음', type: ErrorDto })
  @ApiResponse({ status: 409, description: '없음(쓰지 않음)', type: ErrorDto })
  @ApiResponse({ status: 422, description: '없음(쓰지 않음)', type: ErrorDto })
  detach(@Param('id') id: string) { return removeVideo(this.db, me(), id); }

  @Get('me/lsy/listings/:id/photo-checks')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '내 매물 사진 점검 (v10.525)', description: '해상도 · 크기 · 비율 · 흐림 근사 · 연락처 글자 의심 — 경고만(검수 · 게시를 막지 않음).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 매물 · 남의 매물', type: ErrorDto })
  myPhotos(@Param('id') id: string) { return myPhotoChecks(this.db, me(), id); }

  /* ── 운영 — 한눈에 · 설정 ── */
  @Get('admin/lsy/overview')
  @Roles(...REV)
  @ApiOperation({ summary: '매물 품질 한눈에 (v10.524 ~ 527)', description: '설정 · 중복 의심 · 사진 경고 · 동영상 대기 · 열린 신고 분류 숫자.' })
  @ApiOkResponse({ type: Object })
  overview() { return lsyOverview(this.db); }

  @Put('admin/lsy/settings')
  @Roles('SUPER')
  @ApiOperation({ summary: '매물 품질 설정 (v10.524 ~ 527 · SUPER)', description: '보낸 칸만 · 값은 DB 무늬와 같은 검사 · 사유는 전체 설정 바뀐 기록에.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: '없음(쓰지 않음)', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LSY_REASON · LSY_SETTING_VALUE · LSY_NOTHING', type: ErrorDto })
  @Audit('LSY_SETTINGS', 'SITE_SETTING')
  settings(@Body() dto: LsySettingsDto) {
    return setLsySettings(this.db, {
      dupDetect: dto.dupDetect, dupThreshold: dto.dupThreshold, dupWindowDays: dto.dupWindowDays, dupQueue: dto.dupQueue,
      photoCheck: dto.photoCheck, photoAi: dto.photoAi, photoMinPx: dto.photoMinPx, photoBatch: dto.photoBatch,
      video: dto.video, videoMaxMb: dto.videoMaxMb, videoMaxSec: dto.videoMaxSec,
      reportTriage: dto.reportTriage, reportAi: dto.reportAi, aiModel: dto.aiModel, reason: dto.reason,
    });
  }

  /* ── v10.524 중복 매물 ── */
  @Get('admin/lsy/dups')
  @Roles(...REV)
  @ApiOperation({ summary: '중복 의심 짝 (v10.524)', description: '점수 높은 순 · 사진 · 글 · 연락처 신호 · 검수 대기에 올렸는지.' })
  @ApiQuery({ name: 'state', enum: DUP_STATES, required: false })
  @ApiOkResponse({ type: Object })
  dups(@Query('state') state?: string) { return dupList(this.db, state); }

  @Get('admin/lsy/dups/:id')
  @Roles(...REV)
  @ApiOperation({ summary: '중복 의심 짝 보기 (v10.524)', description: '두 매물 나란히 · 같은 사진 표시 · 주인 이름 가림 · 전화 끝 4자리.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 짝', type: ErrorDto })
  dup(@Param('id', ParseIntPipe) id: number) { return dupDetail(this.db, id); }

  @Post('admin/lsy/dups/:id/decide')
  @HttpCode(200)
  @Roles(...REV)
  @ApiOperation({ summary: '중복 의심 결정 (v10.524)', description: '같은 매물 · 다른 매물 + 사유 — 사람이 정함 · 내림 · 반려는 기존 검수 큐 · 신고 처리에서.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 짝', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'LSY_DUP_STATE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LSY_DUP_VERDICT · LSY_REASON', type: ErrorDto })
  @Audit('LSY_DUP_DECIDE', 'LSY_DUP_PAIR')
  dupDecide(@Param('id', ParseIntPipe) id: number, @Body() dto: LsyDupDecideDto) { return dupDecide(this.db, me(), id, { verdict: dto.verdict, reason: dto.reason }); }

  @Post('admin/lsy/dups/scan')
  @HttpCode(200)
  @Roles(...REV)
  @ApiOperation({ summary: '중복 지금 보기 (v10.524)', description: '매물 하나를 바로 견줌(스위치가 꺼져 있어도) — 검수 대기에는 올리지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 매물', type: ErrorDto })
  @ApiResponse({ status: 409, description: '없음(쓰지 않음)', type: ErrorDto })
  @ApiResponse({ status: 422, description: '없음(쓰지 않음)', type: ErrorDto })
  @Audit('LSY_DUP_SCAN', 'LISTING')
  dupScan(@Body() dto: LsyListingRefDto) { return dupScanNow(this.db, dto.listingId); }

  /* ── v10.525 사진 품질 ── */
  @Get('admin/lsy/photos')
  @Roles(...REV)
  @ApiOperation({ summary: '사진 품질 경고 (v10.525)', description: '경고 있는 사진 · 연락처 글자 의심 · 모두 — 해상도 · 크기 · 비율 · 픽셀당 비트 · AI 결과.' })
  @ApiQuery({ name: 'view', enum: PHOTO_VIEWS, required: false })
  @ApiOkResponse({ type: Object })
  photos(@Query('view') view?: string) { return photoList(this.db, view); }

  @Post('admin/lsy/photos/recheck')
  @HttpCode(200)
  @Roles(...REV)
  @ApiOperation({ summary: '사진 다시 보기 (v10.525)', description: '그 매물의 검사 줄을 지워 다음 매시간 작업에서 다시 봄.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 매물', type: ErrorDto })
  @ApiResponse({ status: 409, description: '없음(쓰지 않음)', type: ErrorDto })
  @ApiResponse({ status: 422, description: '없음(쓰지 않음)', type: ErrorDto })
  @Audit('LSY_PHOTO_RECHECK', 'LISTING')
  photoRecheck(@Body() dto: LsyListingRefDto) { return photoRecheck(this.db, dto.listingId); }

  /* ── v10.526 매물 동영상 ── */
  @Get('admin/lsy/videos')
  @Roles(...REV)
  @ApiOperation({ summary: '매물 동영상 검수 (v10.526)', description: '검수 대기 · 승인 · 반려 · 바뀜 · 뺌 — 파일은 GET /files/{id}?disposition=inline 으로 봄.' })
  @ApiQuery({ name: 'state', enum: VIDEO_STATES, required: false })
  @ApiOkResponse({ type: Object })
  videos(@Query('state') state?: string) { return adminVideoList(this.db, state); }

  @Post('admin/lsy/videos/:id/decide')
  @HttpCode(200)
  @Roles(...REV)
  @ApiOperation({ summary: '매물 동영상 승인 · 반려 (v10.526)', description: '승인한 것만 공개 · 반려는 사유(회원에게 보임).' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 동영상', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'LSY_VIDEO_STATE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LSY_DECIDE · LSY_REASON', type: ErrorDto })
  @Audit('LSY_VIDEO_DECIDE', 'LSY_LISTING_VIDEO')
  videoDecide(@Param('id', ParseIntPipe) id: number, @Body() dto: LsyVideoDecideDto) { return decideVideo(this.db, me(), id, { approve: dto.approve, reason: dto.reason }); }

  /* ── v10.527 신고 분류 ── */
  @Get('admin/lsy/triage')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '신고 분류 · 우선순위 (v10.527)', description: '열린 신고 — 확정 급함 → 제안 급함 → 오래된 순 · 규칙 · AI 제안 · 확정 · AI 일치율(30일).' })
  @ApiQuery({ name: 'view', enum: TRIAGE_VIEWS, required: false })
  @ApiOkResponse({ type: Object })
  triage(@Query('view') view?: string) { return triageList(this.db, view); }

  @Post('admin/lsy/triage/:id/confirm')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '신고 분류 확정 (v10.527)', description: '제안을 받아들이거나 종류 · 급함을 바꿔 확정 — 신고 처리(인정 · 기각)는 기존 신고 처리 화면.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: '없는 분류 줄', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'LSY_TRIAGE_CLOSED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LSY_TRIAGE_KIND · LSY_TRIAGE_URGENCY', type: ErrorDto })
  @Audit('LSY_TRIAGE_CONFIRM', 'REPORT')
  triageConfirm(@Param('id', ParseIntPipe) id: number, @Body() dto: LsyTriageConfirmDto) {
    return triageConfirm(this.db, me(), id, { kind: dto.kind, urgency: dto.urgency, note: dto.note });
  }
}
