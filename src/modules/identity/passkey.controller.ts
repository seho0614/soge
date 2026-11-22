import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches } from 'class-validator';
import type { Request } from 'express';
import { ErrorDto } from '../../common/dto/common.dto';
import { Principal, Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { Forbidden } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { AuthService } from './auth.service';
import {
  passkeyStatus, registerOptions, registerPasskey, revokeMyPasskey, revokeStaffPasskey, setPasskeyPolicy, staffPasskeys, verifyOptions, verifyPasskey,
} from './passkey';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * v10.484 (D268 · docs/622) 운영자 패스키 — 운영 화면 › 권한 계층 › 내 2단계 인증 › 「패스키」 구역(SB-ADM-SCU-020)
 *   /auth/passkey/* 는 운영 역할을 요구하지 않음(@Roles 없음 · 2단계 · 패스키 확인이 필요한 상태에서도 확인할 수 있어야) — 로그인 · 운영 역할은 서비스가 봄
 *   SUPER  GET /admin/passkeys · POST /admin/passkeys/{id}/revoke · PUT /admin/passkeys/policy
 * ------------------------------------------------------------------- */

const B64U = /^[A-Za-z0-9_-]+$/;

export class PasskeyRegisterDto {
  @ApiProperty({ description: '자격 번호(rawId · base64url)' }) @IsString() @Length(16, 1400) @Matches(B64U) id!: string;
  @ApiProperty({ description: 'response.clientDataJSON(base64url)' }) @IsString() @Length(20, 8192) @Matches(B64U) clientDataJSON!: string;
  @ApiProperty({ description: 'response.getAuthenticatorData()(base64url)' }) @IsString() @Length(40, 8192) @Matches(B64U) authenticatorData!: string;
  @ApiProperty({ description: 'response.getPublicKey() — SPKI DER(base64url)' }) @IsString() @Length(40, 4096) @Matches(B64U) publicKey!: string;
  @ApiProperty({ example: -7, enum: [-7, -8, -257], description: 'response.getPublicKeyAlgorithm()' }) @IsInt() @IsIn([-7, -8, -257]) publicKeyAlgorithm!: number;
  @ApiPropertyOptional({ example: ['internal'], description: 'response.getTransports()' }) @IsOptional() @IsArray() @IsString({ each: true }) transports?: string[];
  @ApiProperty({ example: '사무실 노트북 지문' }) @IsString() @Length(1, 40) label!: string;
}
export class PasskeyVerifyDto {
  @ApiProperty({ description: '자격 번호(rawId · base64url)' }) @IsString() @Length(16, 1400) @Matches(B64U) id!: string;
  @ApiProperty({ description: 'response.clientDataJSON(base64url)' }) @IsString() @Length(20, 8192) @Matches(B64U) clientDataJSON!: string;
  @ApiProperty({ description: 'response.authenticatorData(base64url)' }) @IsString() @Length(40, 8192) @Matches(B64U) authenticatorData!: string;
  @ApiProperty({ description: 'response.signature(base64url)' }) @IsString() @Length(16, 2048) @Matches(B64U) signature!: string;
}
export class PasskeyRevokeDto {
  @ApiPropertyOptional({ example: '노트북 바꿈', description: '사유(본인 2 ~ 200자 · SUPER 가 남의 것을 끌 때 5 ~ 200자)' }) @IsOptional() @IsString() @Length(0, 200) reason?: string;
}
export class PasskeyPolicyDto {
  @ApiPropertyOptional({ description: 'admin.passkey' }) @IsOptional() @StrictBoolean() on?: boolean;
  @ApiPropertyOptional({ enum: ['EXTRA', 'REPLACE_MFA'] }) @IsOptional() @IsIn(['EXTRA', 'REPLACE_MFA']) mode?: string;
  @ApiPropertyOptional({ example: 'sogaebank.com', description: 'admin.passkey_rp_id(빈 글자 = 지움)' }) @IsOptional() @IsString()
  @Matches(/^(|localhost|([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/) rpId?: string;
  @ApiProperty({ example: '운영자 패스키 시작' }) @IsString() @Length(2, 200) reason!: string;
}

@ApiTags('auth')
@ApiBearerAuth()
@Controller('api/v1')
export class PasskeyController {
  constructor(private readonly db: DatabaseService, private readonly auth: AuthService) {}

  private me(req: Request): Principal {
    const p = (req as any).principal as Principal | undefined;
    if (!p) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
    return p;
  }
  private sid() { return RequestCtx.get()?.sid; }

  @Get('auth/passkey')
  @ApiOperation({ summary: '내 패스키 상태 (v10.484)', description: '켜짐 · 방식(EXTRA · REPLACE_MFA) · 도메인 · 내 패스키(이름 · 만든 때 · 마지막 씀) · 이 기기 확인 여부 · 게이트(EXTRA · REPLACE_MFA · 없음).' })
  @ApiOkResponse({ type: Object })
  status(@Req() req: Request) { return passkeyStatus(this.db, this.me(req), this.sid()); }

  @Post('auth/passkey/register/options')
  @HttpCode(200)
  @ApiOperation({ summary: '패스키 등록 시작 (v10.484)', description: 'navigator.credentials.create 에 넣을 값(문제 5분 · 한 번). 운영 계정 · 2단계 · 접속 인증 · (EXTRA 면) 패스키 확인을 마친 증표만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'FORBIDDEN · MFA_REQUIRED · IP_VERIFY_REQUIRED · PASSKEY_REQUIRED' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PASSKEY_OFF · PASSKEY_NOT_READY · PASSKEY_MAX' })
  @ApiResponse({ status: 429, type: ErrorDto, description: 'PASSKEY_TOO_MANY' })
  regOptions(@Req() req: Request) { return registerOptions(this.db, this.me(req)); }

  @Post('auth/passkey/register')
  @HttpCode(200)
  /* 감사 기록은 서비스가 직접(공개 키 · 자격 번호는 남기지 않음) */
  @ApiOperation({ summary: '패스키 등록 마치기 (v10.484)', description: '브라우저 응답(clientDataJSON · authenticatorData · SPKI 공개 키 · 알고리즘) — 출처 · 도메인 지문 · 지문/PIN 확인(UV) · 자격 번호 · 키 모양을 확인.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'FORBIDDEN · MFA_REQUIRED · IP_VERIFY_REQUIRED · PASSKEY_REQUIRED' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PASSKEY_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PASSKEY_FORMAT · PASSKEY_TYPE · PASSKEY_ORIGIN · PASSKEY_CHALLENGE · PASSKEY_RP · PASSKEY_UV · PASSKEY_KEY · PASSKEY_LABEL' })
  register(@Req() req: Request, @Body() dto: PasskeyRegisterDto) { return registerPasskey(this.db, this.me(req), this.sid(), dto); }

  @Post('auth/passkey/verify/options')
  @HttpCode(200)
  @ApiOperation({ summary: '패스키 확인 시작 (v10.484)', description: 'navigator.credentials.get 에 넣을 값(문제 5분 · 내 패스키 목록).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PASSKEY_OFF · PASSKEY_NOT_READY · PASSKEY_NONE' })
  @ApiResponse({ status: 429, type: ErrorDto, description: 'PASSKEY_TOO_MANY' })
  verOptions(@Req() req: Request) { return verifyOptions(this.db, this.me(req)); }

  @Post('auth/passkey/verify')
  @HttpCode(200)
  /* 감사 기록은 서비스가 직접(REPLACE_MFA 응답에 증표가 들어감) */
  @ApiOperation({ summary: '패스키로 확인 (v10.484)', description: 'EXTRA — 이 로그인 기기를 admin.mfa_hours 동안 확인됨으로 · REPLACE_MFA — 2단계 확인된 새 증표. 서명 횟수가 줄면 복제 의심(운영 알림 PASSKEY_CLONE_SUSPECT · 403).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'PASSKEY_INVALID · IP_VERIFY_REQUIRED' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PASSKEY_NO_SESSION' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PASSKEY_FORMAT · PASSKEY_TYPE · PASSKEY_ORIGIN · PASSKEY_CHALLENGE' })
  verify(@Req() req: Request, @Body() dto: PasskeyVerifyDto) {
    return verifyPasskey(this.db, this.me(req), this.sid(), dto, async (id, ma, sid) => { const t = await this.auth.issue(id, ma, sid); return { accessToken: t.accessToken, refreshToken: t.refreshToken }; });
  }

  @Post('auth/passkey/:id/revoke')
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '내 패스키 끄기 (v10.484)', description: '기기 분실 · 바꿈 — 2단계 · 접속 인증 · 패스키 확인을 마친 증표로만(잃어버렸으면 최고 관리자에게).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'MFA_REQUIRED · IP_VERIFY_REQUIRED · PASSKEY_REQUIRED' })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PASSKEY_REASON' })
  revokeMine(@Req() req: Request, @Param('id') id: string, @Body() dto: PasskeyRevokeDto) { return revokeMyPasskey(this.db, this.me(req), id, dto.reason); }

  @Get('admin/passkeys')
  @Roles('SUPER')
  @ApiOperation({ summary: '운영자 패스키 목록 (v10.484 · SUPER)', description: '설정 · 모든 운영자 패스키(가린 이메일 · 이름 · 만든 때 · 마지막 씀 · 끈 때 · 사유) 200.' })
  @ApiOkResponse({ type: Object })
  list() { return staffPasskeys(this.db); }

  @Post('admin/passkeys/:id/revoke')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('PASSKEY_REVOKE_STAFF', 'ACCOUNT')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '운영자 패스키 끄기 (v10.484 · SUPER)', description: '분실 · 퇴사 — 사유 5 ~ 200자.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PASSKEY_REASON' })
  revokeStaff(@Param('id') id: string, @Body() dto: PasskeyRevokeDto) { return revokeStaffPasskey(this.db, id, dto.reason ?? ''); }

  @Put('admin/passkeys/policy')
  @Roles('SUPER')
  @Audit('PASSKEY_POLICY', 'SETTING')
  @ApiOperation({ summary: '패스키 설정 (v10.484 · SUPER)', description: '켜기(도메인이 있어야) · 방식 EXTRA(추가 확인 · 처음) · REPLACE_MFA(2단계 인증 대신) · 도메인 · 사유(설정 바뀜 기록).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PASSKEY_REASON · PASSKEY_RP · PASSKEY_MODE · PASSKEY_NOT_READY · PASSKEY_NOTHING' })
  policy(@Body() dto: PasskeyPolicyDto) { return setPasskeyPolicy(this.db, dto); }
}
