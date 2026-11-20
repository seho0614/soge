import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { SocialAuthService, providerOf } from './social';

/* ---------------------------------------------------------------------
 * v10.498 (D272 · docs/636) 카카오 · 네이버 간편 로그인
 *   공개(사용자 웹 서버가 부름)
 *     GET  /auth/social/providers                켜진 업체(로그인 화면 단추)
 *     POST /auth/social/{p}/start                로그인 시작 — state · PKCE · 업체 주소(간주면 사용자 웹 돌아올 주소)
 *     POST /auth/social/{p}/callback             돌아옴 — LOGIN(증표) · LINKED · PENDING(이어서 표)
 *     POST /auth/social/pending/view             이어서 표 보기(가린 이메일 · 같은 이메일 계정 연결 가능 여부)
 *     POST /auth/social/pending/link             확인된 같은 이메일 계정 + 그 계정 비밀번호 → 연결 · 로그인
 *     POST /auth/social/pending/signup           새로 가입(필수 약관 · 추천 코드) → 연결 · 로그인
 *   회원(MEMBER)  GET /me/social · POST /me/social/{p}/start(연결) · DELETE /me/social/{p}(끊기) · POST /me/social/password(첫 비밀번호)
 *   운영          GET /admin/social(ADMIN · SUPER) · PUT /admin/social/settings(SUPER · 사유)
 * ------------------------------------------------------------------- */

export class SocStartDto {
  @ApiProperty({ example: 'https://sogaebank.com/login/social/kakao/callback' }) @IsString() @MaxLength(300) redirectUri!: string;
  @ApiProperty({ description: '사용자 웹이 만든 이 브라우저 묶음 값(httpOnly 쿠키) — 지문만 저장' }) @IsString() @Matches(/^[A-Za-z0-9_-]{32,128}$/) binding!: string;
}
export class SocCallbackDto {
  @ApiProperty() @IsString() @Length(1, 2048) code!: string;
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{20,128}$/) state!: string;
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{32,128}$/) binding!: string;
  @ApiProperty() @IsString() @MaxLength(300) redirectUri!: string;
  @ApiPropertyOptional({ description: '방문자 키(비로그인 유입 연결 · INV-2)' }) @IsOptional() @IsString() @Matches(/^[A-Za-z0-9-]{8,64}$/) visitorKey?: string;
}
export class SocTicketDto {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{32,128}$/) ticket!: string;
}
export class SocPendingLinkDto {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{32,128}$/) ticket!: string;
  @ApiProperty() @IsString() @Length(1, 200) password!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[A-Za-z0-9-]{8,64}$/) visitorKey?: string;
}
export class SocPendingSignupDto {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{32,128}$/) ticket!: string;
  @ApiProperty({ example: '홍길동' }) @IsString() @Length(1, 40) name!: string;
  @ApiPropertyOptional({ description: '업체가 이메일을 주지 않았을 때만' }) @IsOptional() @IsString() @MaxLength(254) email?: string;
  @ApiProperty({ type: [String], example: ['SERVICE', 'PRIVACY'] }) @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) agreedTerms!: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) recommendCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[A-Za-z0-9-]{8,64}$/) visitorKey?: string;
}
export class SocPasswordDto {
  @ApiProperty() @IsString() @Length(10, 200) password!: string;
}
export class SocSettingsDto {
  @ApiPropertyOptional({ description: 'social.kakao' }) @IsOptional() @IsBoolean() kakao?: boolean;
  @ApiPropertyOptional({ description: 'social.naver' }) @IsOptional() @IsBoolean() naver?: boolean;
  @ApiPropertyOptional({ enum: ['ASSUME', 'LIVE'] }) @IsOptional() @IsIn(['ASSUME', 'LIVE']) mode?: string;
  @ApiPropertyOptional({ description: 'social.privacy_ok — 처리방침 게시 · 법무 확인 마침' }) @IsOptional() @IsBoolean() privacyOk?: boolean;
  @ApiProperty({ example: '간편 로그인 시험 켜기' }) @IsString() @Length(2, 200) reason!: string;
}

@ApiTags('HOM')
@Controller('api/v1')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class SocialAuthController {
  constructor(private readonly svc: SocialAuthService) {}

  @Get('auth/social/providers')
  @ApiOperation({ summary: '간편 로그인 업체 (v10.498 · 공개)', description: '켜진 업체만(social.kakao · social.naver). 운영 서버에서 간주(ASSUME)면 비어 있음.' })
  @ApiOkResponse({ type: Object })
  providers() { return this.svc.providers(); }

  @Post('auth/social/:provider/start')
  @HttpCode(200)
  @ApiParam({ name: 'provider', enum: ['kakao', 'naver'] })
  @ApiOperation({ summary: '간편 로그인 시작 (v10.498)', description: 'state(무작위 · 지문만) · PKCE verifier(서버만) · 묶음 값 지문을 10분 한 번짜리로 남기고 업체 로그인 주소를 돌려줌(간주면 사용자 웹 돌아올 주소).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND(업체)' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SOCIAL_OFF · SOCIAL_ASSUME_PROD · SOCIAL_REDIRECT · SOCIAL_BINDING · SOCIAL_NOT_READY' })
  start(@Param('provider') p: string, @Body() dto: SocStartDto) { return this.svc.start(providerOf(p), dto, null); }

  @Post('auth/social/:provider/callback')
  @HttpCode(200)
  @ApiParam({ name: 'provider', enum: ['kakao', 'naver'] })
  @ApiOperation({ summary: '간편 로그인 돌아옴 (v10.498)', description: 'state · 묶음 · redirectUri 가 모두 맞아야. 연결된 회원 → LOGIN(증표) · 연결 시작 → LINKED · 처음 온 회원 → PENDING(이어서 표 · 15분 · 저절로 합치지 않음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'SOCIAL_STAFF_NOT_ALLOWED · ACCOUNT_INACTIVE · WITHDRAW_PENDING' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SOCIAL_STATE_INVALID · SOCIAL_LINKED_OTHER · SOCIAL_PROVIDER_TAKEN' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SOCIAL_OFF' })
  @ApiResponse({ status: 502, type: ErrorDto, description: 'SOCIAL_TOKEN_FAIL · SOCIAL_PROFILE_FAIL · SOCIAL_CODE_INVALID · SOCIAL_NOT_READY' })
  callback(@Param('provider') p: string, @Body() dto: SocCallbackDto) { return this.svc.callback(providerOf(p), dto); }

  @Post('auth/social/pending/view')
  @HttpCode(200)
  @ApiOperation({ summary: '간편 로그인 이어서 보기 (v10.498)', description: '업체 · 가린 이메일 · 이메일을 받아야 하는지 · 확인된 같은 이메일 계정에 연결할 수 있는지 · 별명.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SOCIAL_TICKET_INVALID' })
  pendingView(@Body() dto: SocTicketDto) { return this.svc.pendingView(dto.ticket); }

  @Post('auth/social/pending/link')
  @HttpCode(200)
  @ApiOperation({ summary: '같은 이메일 계정에 연결 (v10.498)', description: '업체가 확인한 이메일과 같은 계정 · 그 계정 비밀번호 확인 뒤에만(이메일 로그인과 같은 잠금 · 표마다 5번).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'INVALID_CREDENTIALS · SOCIAL_STAFF_NOT_ALLOWED' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SOCIAL_TICKET_INVALID · SOCIAL_PROVIDER_TAKEN' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SOCIAL_NO_MATCH' })
  @ApiResponse({ status: 423, type: ErrorDto, description: 'ACCOUNT_LOCKED' })
  @ApiResponse({ status: 429, type: ErrorDto, description: 'TOO_MANY_ATTEMPTS' })
  pendingLink(@Body() dto: SocPendingLinkDto) { return this.svc.pendingLink(dto.ticket, dto.password, dto.visitorKey); }

  @Post('auth/social/pending/signup')
  @HttpCode(200)   /* 감사 @Audit 를 달지 않음 — 응답에 증표가 있어 after_data 에 남기지 않으려고(기록은 soc_events SIGNUP) */
  @ApiOperation({ summary: '간편 로그인으로 새로 가입 (v10.498)', description: '이메일 가입과 같은 문(가입 잠시 막기 · 차단 목록 · 같은 IP 하루 상한) · 필수 약관 · 추천 코드. 비밀번호 없는 계정(나중에 만들 수 있음) · 본인인증은 그대로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SOCIAL_TICKET_INVALID · DUPLICATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SOCIAL_EMAIL · SOCIAL_NAME · SIGNUP_CLOSED · REQUIRED_TERM · NOTICE_ONLY · NOT_PUBLISHED · RECOMMEND_CODE_UNKNOWN' })
  @ApiResponse({ status: 429, type: ErrorDto, description: 'SIGNUP_IP_LIMIT' })
  pendingSignup(@Body() dto: SocPendingSignupDto) { return this.svc.pendingSignup(dto.ticket, dto); }

  @Get('me/social')
  @ApiBearerAuth()
  @Roles('MEMBER')
  @ApiOperation({ summary: '내 간편 로그인 (v10.498)', description: '연결된 업체(가린 이메일 · 연결한 때 · 마지막 로그인) · 비밀번호가 있는지 · 켜진 업체.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: '권한 없음' })
  mine() { return this.svc.mine(RequestCtx.actorId()!); }

  @Post('me/social/:provider/start')
  @ApiBearerAuth()
  @Roles('MEMBER')
  @HttpCode(200)
  @ApiParam({ name: 'provider', enum: ['kakao', 'naver'] })
  @ApiOperation({ summary: '간편 로그인 연결 시작 (v10.498)', description: '로그인한 본인 계정에 연결(돌아오면 LINKED). 운영 역할 계정은 막음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'SOCIAL_STAFF_NOT_ALLOWED' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SOCIAL_OFF · SOCIAL_ASSUME_PROD · SOCIAL_REDIRECT · SOCIAL_BINDING · SOCIAL_NOT_READY' })
  linkStart(@Param('provider') p: string, @Body() dto: SocStartDto) { return this.svc.start(providerOf(p), dto, RequestCtx.actorId()!); }

  @Delete('me/social/:provider')
  @ApiBearerAuth()
  @Roles('MEMBER')
  @Audit('SOCIAL_UNLINK', 'ACCOUNT')
  @ApiParam({ name: 'provider', enum: ['kakao', 'naver'] })
  @ApiOperation({ summary: '간편 로그인 끊기 (v10.498)', description: '비밀번호가 없고 마지막 연결이면 422 SOCIAL_LAST_METHOD(먼저 비밀번호 만들기).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SOCIAL_LAST_METHOD' })
  unlink(@Param('provider') p: string) { return this.svc.unlink(RequestCtx.actorId()!, providerOf(p)); }

  @Post('me/social/password')
  @ApiBearerAuth()
  @Roles('MEMBER')
  @HttpCode(200)
  @Audit('SOCIAL_PASSWORD_CREATE', 'ACCOUNT')
  @ApiOperation({ summary: '첫 비밀번호 만들기 (v10.498)', description: '간편 가입으로 비밀번호가 없는 계정만(있으면 409 PASSWORD_EXISTS) · 이메일 가입과 같은 비밀번호 규칙.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PASSWORD_EXISTS' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'WEAK_PASSWORD' })
  createPassword(@Body() dto: SocPasswordDto) { return this.svc.createPassword(RequestCtx.actorId()!, dto.password); }

  @Get('admin/social')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({ summary: '간편 로그인 (v10.498 · 운영)', description: '설정(카카오 · 네이버 · 방식 · 처리방침 확인) · 키 준비(카카오 client_id 가 연동 키인지 지도 키인지) · 연결 수 · 30일 기록 · 7일 실패 코드.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: '권한 없음' })
  adminView() { return this.svc.adminView(); }

  @Put('admin/social/settings')
  @ApiBearerAuth()
  @Roles('SUPER')
  @Audit('SOCIAL_SETTINGS', 'SETTING')
  @ApiOperation({ summary: '간편 로그인 설정 (v10.498 · SUPER)', description: 'LIVE 로 켜려면 키 + 처리방침 확인(social.privacy_ok) · 운영 서버에서 간주로 켜기 막음 · 사유(설정 바뀜 기록).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: '권한 없음' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SOCIAL_REASON · SOCIAL_MODE · SOCIAL_PRIVACY_FIRST · SOCIAL_NOT_READY · SOCIAL_ASSUME_PROD · SOCIAL_NOTHING' })
  settings(@Body() dto: SocSettingsDto) { return this.svc.setSettings(dto); }
}
