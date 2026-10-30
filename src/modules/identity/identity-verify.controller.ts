import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IdentityVerifyService } from './identity-verify.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/* ---------------------------------------------------------------------
 * v10.141 (D137 · docs/214 · 설계 docs/213) — 본인인증 표준창
 *
 *   MEMBER  GET  /verifications/identity/mode       지금 방식(STUB · MOCK · NICE) — 화면이 단추를 고름
 *   MEMBER  POST /verifications/identity/start      요청 번호 · 표준창에 넘길 값
 *   MEMBER  POST /verifications/identity/complete   돌아온 값 확인 → 본인인증 끝
 *   MEMBER  POST /verifications/identity/mock-sign  가짜 표준창(MOCK 일 때만 · 운영 서버에서는 403)
 *   ADMIN · SUPER  GET /admin/identity/status       운영 화면 › 외부 연동 › 「본인인증」
 *   SUPER  POST /admin/identity/nice-check          NICE 키 확인(v10.153 · 토큰만 · 표준창 · 비용 없음 · NICE 로 바꾸는 근거)
 *   방식 바꾸기는 사이트 설정 identity.provider(PATCH /admin/site-settings · SUPER · NICE 는 키 3개 · MOCK 은 운영 서버에서 못 고름)
 * ------------------------------------------------------------------- */

export class IdentityModeDto {
  @ApiProperty({ enum: ['STUB', 'MOCK', 'NICE'] }) mode!: string;
}
export class IdentityStartDto {
  @ApiPropertyOptional({ description: '끝난 뒤 돌아갈 우리 사이트 안 주소(/로 시작)' }) @IsOptional() @IsString() @MaxLength(300) next?: string;
}
export class IdentityWindowDto {
  @ApiProperty({ description: '표준창 주소(MOCK 은 /verify/mock-nice)' }) url!: string;
  @ApiProperty({ enum: ['POST', 'GET'] }) method!: string;
  @ApiProperty({ description: 'm · token_version_id · enc_data · integrity_value', type: 'object', additionalProperties: { type: 'string' } }) fields!: Record<string, string>;
}
export class IdentityStartResultDto {
  @ApiProperty({ enum: ['MOCK', 'NICE'] }) mode!: string;
  @ApiProperty() expiresInMinutes!: number;
  @ApiProperty({ type: IdentityWindowDto }) window!: IdentityWindowDto;
}
export class IdentityCompleteDto {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{4,100}$/) token_version_id!: string;
  @ApiProperty() @IsString() @MaxLength(8000) enc_data!: string;
  @ApiProperty() @IsString() @MaxLength(200) integrity_value!: string;
}
export class IdentityCompleteResultDto {
  @ApiProperty() success!: boolean;
  @ApiProperty({ description: '늘 false(실제 표준창 · 가짜 표준창 모두 흐름을 거침)' }) stub!: boolean;
  @ApiProperty({ enum: ['MOCK', 'NICE'] }) mode!: string;
  @ApiProperty({ format: 'date-time' }) verifiedAt!: string;
  @ApiProperty({ description: '회원 이름과 인증 이름이 같은지(다르면 운영 화면에 표시만)' }) nameMatch!: boolean;
  @ApiProperty({ description: '같은 사람이 다른 계정에서도 인증함(identity.ci_duplicate = warn 일 때 통과)' }) duplicate!: boolean;
  @ApiPropertyOptional({ nullable: true }) next!: string | null;
}
export class IdentityMockSignDto extends IdentityCompleteDto {
  @ApiPropertyOptional({ maxLength: 40 }) @IsOptional() @IsString() @MaxLength(40) name!: string;
  @ApiPropertyOptional({ example: '19900101' }) @IsOptional() @IsString() @MaxLength(8) birthdate!: string;
  @ApiPropertyOptional({ description: 'true 면 표준창에서 취소한 결과' }) @IsOptional() @IsBoolean() cancel?: boolean;
}
export class IdentityMockSignResultDto {
  @ApiProperty() returnUrl!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) fields!: Record<string, string>;
}
export class IdentityKeyStateDto {
  @ApiProperty() name!: string;
  @ApiProperty() set!: boolean;
  @ApiProperty({ enum: ['ADMIN', 'ENV', 'NONE'] }) source!: string;
}
export class IdentityReasonDto {
  @ApiProperty() reason!: string;
  @ApiProperty() n!: number;
}
export class IdentityLast30Dto {
  @ApiProperty() success!: number;
  @ApiProperty() fail!: number;
  @ApiProperty({ description: '시험용(STUB) 통과' }) stub!: number;
  @ApiProperty() pending!: number;
  @ApiProperty({ description: '다른 계정에서도 인증한 사람' }) duplicate!: number;
  @ApiProperty({ type: [IdentityReasonDto] }) reasons!: IdentityReasonDto[];
}
export class IdentityNiceCheckDto {
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ nullable: true, enum: ['NOT_CONFIGURED', 'AUTH', 'TIMEOUT', 'NETWORK', 'UPSTREAM', 'HTTP_4XX', 'BAD_RESPONSE'] }) errorKind!: string | null;
  @ApiProperty() detail!: string;
}
export class IdentityLastCheckDto {
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ nullable: true }) errorKind!: string | null;
  @ApiPropertyOptional({ nullable: true }) detail!: string | null;
  @ApiProperty({ format: 'date-time' }) at!: string;
}
export class IdentityAdminStatusDto {
  @ApiProperty({ enum: ['STUB', 'MOCK', 'NICE'], description: '실제로 쓰는 방식' }) provider!: string;
  @ApiProperty({ description: '설정 값(identity.provider)' }) setting!: string;
  @ApiProperty({ description: 'MOCK 을 고를 수 있음(운영 서버 아님)' }) mockAllowed!: boolean;
  @ApiProperty({ type: [IdentityKeyStateDto] }) keys!: IdentityKeyStateDto[];
  @ApiProperty({ type: [String] }) keysMissing!: string[];
  @ApiProperty({ enum: ['warn', 'block'] }) ciDuplicate!: string;
  @ApiProperty() minAge!: number;
  @ApiProperty({ type: IdentityLast30Dto }) last30!: IdentityLast30Dto;
  @ApiProperty({ description: 'v10.153 — identity.require_check(NICE 로 바꾸기 전 키 확인 필요)' }) requireCheck!: boolean;
  @ApiPropertyOptional({ nullable: true, format: 'date-time', description: '최근 7일 안 성공한 NICE 키 확인' }) lastCheckOkAt!: string | null;
  @ApiPropertyOptional({ nullable: true, type: IdentityLastCheckDto }) lastCheck!: IdentityLastCheckDto | null;
}

@ApiTags('HOM')
@ApiBearerAuth()
@Controller('api/v1')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class IdentityVerifyController {
  constructor(private readonly svc: IdentityVerifyService) {}

  @Get('verifications/identity/mode')
  @Roles('MEMBER')
  @ApiOperation({ summary: '본인인증 방식 (v10.141)' })
  @ApiOkResponse({ type: IdentityModeDto })
  async mode() { return { mode: await this.svc.mode() }; }

  @Post('verifications/identity/start')
  @Roles('MEMBER')
  @ApiOperation({ summary: '본인인증 시작 (v10.141)', description: '요청 번호(1회용 · 10분)를 만들고 표준창에 넘길 값을 돌려줍니다. 1시간 10번까지.' })
  @ApiOkResponse({ type: IdentityStartResultDto })
  @ApiResponse({ status: 409, description: 'USE_STUB · IDENTITY_UNAVAILABLE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'TOO_MANY_REQUESTS', type: ErrorDto })
  start(@Body() dto: IdentityStartDto) { return this.svc.start(dto.next); }

  @Post('verifications/identity/complete')
  @Roles('MEMBER')
  @ApiOperation({ summary: '본인인증 완료 (v10.141)', description: '표준창이 돌려준 값을 확인합니다. CI 는 서버 열쇠 해시로만 저장 — 이름 · 생년월일은 저장하지 않습니다.' })
  @ApiOkResponse({ type: IdentityCompleteResultDto })
  @ApiResponse({ status: 404, description: '요청이 없음 · 남의 요청', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'IDENTITY_USED · CI_DUPLICATE', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'IDENTITY_EXPIRED · IDENTITY_INTEGRITY · IDENTITY_FAILED · UNDER_AGE', type: ErrorDto })
  @Audit('IDENTITY_VERIFY', 'ACCOUNT')
  complete(@Body() dto: IdentityCompleteDto) { return this.svc.complete(dto); }

  @Post('verifications/identity/mock-sign')
  @Roles('MEMBER')
  @ApiOperation({ summary: '가짜 표준창 결과 (v10.141 · MOCK 만)', description: '점검판 시험용 — NICE 와 같은 암호로 결과를 만듭니다. MOCK 이 아니면 403 MOCK_ONLY.' })
  @ApiOkResponse({ type: IdentityMockSignResultDto })
  @ApiResponse({ status: 403, description: 'MOCK_ONLY', type: ErrorDto })
  mockSign(@Body() dto: IdentityMockSignDto) { return this.svc.mockSign(dto); }

  @Get('admin/identity/status')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '본인인증 상태 (v10.141)', description: '방식 · 키 3개(값 없이 어디서 왔는지) · 최근 30일 성공 · 실패(까닭별) · 다른 계정 중복.' })
  @ApiOkResponse({ type: IdentityAdminStatusDto })
  status() { return this.svc.adminStatus(); }

  @Post('admin/identity/nice-check')
  @Roles('SUPER')
  @ApiOperation({ summary: 'NICE 키 확인 (v10.153)', description: '기관 토큰 · 암호화 토큰만 받아 봄 — **표준창을 띄우지 않아 비용 · 회원과 상관없음.** 결과는 시험 기록에 남고, identity.require_check 가 on 이면 NICE 로 바꾸는 근거(최근 7일 성공)가 됩니다.' })
  @ApiOkResponse({ type: IdentityNiceCheckDto })
  @Audit('INTEG_TEST_NICE', 'INTEGRATION')
  niceCheck() { return this.svc.niceCheck(); }
}
