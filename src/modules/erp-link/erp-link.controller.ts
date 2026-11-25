import { Body, Controller, Get, HttpCode, Injectable, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsObject, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Audit } from '../../core/audit.interceptor';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { ErpLinkGuard } from './erp-link.guard';
import { introspect, linkState, rotateServiceToken } from './erp-link';
import { createHandoff, erpAlert, erpNotify, redeemHandoff } from './erp-internal';
import { AuthService } from '../identity/auth.service';

/* ---------------------------------------------------------------------
 * v10.799 (D334 · docs/915) ERP 연결 — 소개뱅크 쪽
 *   ERP 서버(서비스 토큰)  GET  /auth/introspect          운영자 토큰 → 누구 · 운영자 · 2단계 · 권한(task) · 끝 시각
 *   ADMIN · SUPER          GET  /admin/erp/link           서비스 토큰 있음 / 없음 · 바꾼 시각(값은 안 보임)
 *   SUPER                  POST /admin/erp/service-token  새 서비스 토큰(원문은 한 번만) · 전 토큰 무효
 * ------------------------------------------------------------------- */

export class IntrospectPermDto {
  @ApiProperty({ enum: ['OFF', 'SHADOW', 'ON'] }) enforce!: string;
  @ApiProperty({ enum: ['ROLE', 'COMPARE', 'GROUPS'] }) decide!: string;
  @ApiProperty({ type: [String], example: ['acct:VIEW'] }) tasks!: string[];
}
export class IntrospectDto {
  @ApiProperty() active!: boolean;
  @ApiPropertyOptional({ enum: ['UNAUTHENTICATED', 'NOT_STAFF', 'NOT_ACTIVE'] }) reason?: string;
  @ApiPropertyOptional({ format: 'uuid' }) accountId?: string;
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional({ type: [String] }) roles?: string[];
  @ApiPropertyOptional() staff?: boolean;
  @ApiPropertyOptional() super?: boolean;
  @ApiPropertyOptional({ description: '2단계 인증 · 패스키 확인을 마침 — false 면 ERP 가 막음' }) mfaOk?: boolean;
  @ApiPropertyOptional({ type: IntrospectPermDto }) perm?: IntrospectPermDto;
  @ApiPropertyOptional({ description: '토큰 끝 시각(유닉스 초)' }) exp?: number;
}

/* v10.800 (docs/916) ERP → 소개뱅크 쓰기 길 · 넘겨주기 */
export class ErpAlertDto {
  @ApiProperty({ example: 'ACCT_CLOSE_DUE', description: 'ERP 업무 앞마디(ACCT_ · HR_ · HRA_ · HRX_ · OFC_ · QLT_ · LGL_ · ITS_ · PRR_ · SAL_ · ERP_ · TRD_)' })
  @IsString() @Matches(/^(ACCT|HR|HRA|HRX|OFC|QLT|LGL|ITS|PRR|SAL|ERP|TRD)_[A-Z0-9_]{1,40}$/) code!: string;
  @ApiPropertyOptional({ enum: ['RAISE', 'ONCE', 'RESOLVE'], default: 'RAISE' }) @IsOptional() @IsIn(['RAISE', 'ONCE', 'RESOLVE']) mode?: string;
  @ApiPropertyOptional({ enum: ['INFO', 'WARN', 'CRITICAL'], default: 'WARN' }) @IsOptional() @IsIn(['INFO', 'WARN', 'CRITICAL']) severity?: string;
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @IsString() @MaxLength(200) title?: string;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() detail?: Record<string, unknown>;
  @ApiPropertyOptional({ maxLength: 200, description: 'RESOLVE 때 풀림 메모' }) @IsOptional() @IsString() @MaxLength(200) note?: string;
}
export class ErpNotifyDto {
  /* 11/25 — IsUUID('all') 는 점검판 시드 계정(22222222-2222-…)을 막음 · 서비스(erpNotify)와 같은 36자 꼴로 보고 있는지는 DB 가 봄 */
  @ApiProperty({ format: 'uuid' }) @IsString() @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) accountId!: string;
  @ApiProperty({ example: 'ERP_PAYSLIP' }) @IsString() @Matches(/^ERP_[A-Z0-9_]{2,40}$/) kind!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @ApiProperty({ maxLength: 2000 }) @IsString() @MinLength(1) @MaxLength(2000) body!: string;
  @ApiPropertyOptional({ maxLength: 300, description: '/ 로 시작하는 주소 또는 https://erp.sogaebank.com/…' }) @IsOptional() @IsString() @MaxLength(300) link?: string;
}
export class ErpRedeemDto {
  @ApiProperty({ description: '운영 화면이 만든 넘겨주기 코드(60초 · 한 번)' }) @IsString() @Matches(/^[A-Za-z0-9_-]{30,60}$/) code!: string;
}

@Injectable()
export class ErpLinkService {
  constructor(readonly db: DatabaseService, readonly auth: AuthService) {}
}

@ApiTags('INTERNAL')
@Controller('api/v1')
/* 서버가 부르는 자리 — 사람 역할이 아니라 ERP 서비스 토큰으로 막음(InternalKeyGuard 와 같은 원칙 · 비어 있으면 닫힘) */
@UseGuards(ErpLinkGuard)
export class ErpLinkInternalController {
  constructor(private readonly svc: ErpLinkService) {}

  @Get('auth/introspect')
  @ApiHeader({ name: 'X-Erp-Service-Token', required: true, description: 'ERP 서비스 토큰(설정 erp.service_token_hash 와 맞춤)' })
  @ApiBearerAuth()
  @ApiOperation({ summary: '운영자 토큰 확인 (ERP · 내부)', description: 'v10.799 (docs/915) — ERP 서버가 화면이 낸 운영자 토큰을 그대로 물음. active · 운영자 여부 · 2단계 확인(mfaOk) · 권한(perm.enforce · perm.mode · task 목록) · 끝 시각. 운영자가 아니거나 로그인이 아니면 active=false(200). 서비스 토큰이 없거나 틀리면 403.' })
  @ApiOkResponse({ type: IntrospectDto })
  @ApiResponse({ status: 403, description: 'ERP_TOKEN_UNSET · ERP_TOKEN_INVALID', type: ErrorDto })
  introspect(@Req() req: any) { return introspect(this.svc.db, req.principal, req.headers?.authorization); }

  @Post('internal/erp/alerts')
  @HttpCode(200)
  @ApiHeader({ name: 'X-Erp-Service-Token', required: true })
  @ApiOperation({ summary: '운영 알림 올리기 (ERP · 내부)', description: 'v10.800 (docs/916) — ERP 업무 알림만(앞마디 ACCT_ · HR_ …) · RAISE · ONCE(풀리지 않은 같은 알림이 있으면 안 올림) · RESOLVE(풀림) · 텔레그램 · 게시판은 소개뱅크가 그대로 처리' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, description: 'ERP_ALERT_CODE · ERP_ALERT_TITLE · ERP_ALERT_DETAIL', type: ErrorDto })
  alerts(@Body() dto: ErpAlertDto) { return erpAlert(this.svc.db, dto); }

  @Post('internal/erp/notify')
  @HttpCode(200)
  @ApiHeader({ name: 'X-Erp-Service-Token', required: true })
  @ApiOperation({ summary: '회원 화면 알림 (ERP · 내부)', description: 'v10.800 — 급여 명세 · 결재 요청 등 · 종류 ERP_… · 받는 사람은 쓰는 계정만 · 링크는 / 또는 ERP 주소' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  notify(@Body() dto: ErpNotifyDto) { return erpNotify(this.svc.db, dto); }

  @Post('internal/erp/handoff/redeem')
  @HttpCode(200)
  @ApiHeader({ name: 'X-Erp-Service-Token', required: true })
  @ApiOperation({ summary: '로그인 넘겨주기 코드 바꾸기 (ERP · 내부)', description: 'v10.800 — 운영 화면이 만든 60초 · 한 번 코드를 그 운영자의 증표로(같은 기기 줄 · 같은 2단계 확인 시각) · 지난 코드 409 · 없거나 쓴 코드 404' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'ERP_HANDOFF_EXPIRED', type: ErrorDto })
  async redeem(@Body() dto: ErpRedeemDto) {
    const r = await redeemHandoff(this.svc.db, dto.code);
    const t = await this.svc.auth.issue(r.accountId, r.mfaAt, r.sid);
    return { accessToken: t.accessToken, refreshToken: t.refreshToken, accountId: r.accountId };
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('api/v1/admin/erp')
@Roles('ADMIN', 'SUPER')
export class ErpLinkAdminController {
  constructor(private readonly svc: ErpLinkService) {}

  @Get('link')
  @ApiOperation({ summary: 'ERP 연동 상태', description: 'v10.799 — 서비스 토큰 있음 / 없음 · 바꾼 시각(값은 보이지 않음) · ERP 화면 주소(ERP_WEB_URL)' })
  @ApiOkResponse({ type: Object })
  link() { return linkState(this.svc.db); }

  @Post('service-token')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: 'ERP 서비스 토큰 만들기', description: 'v10.799 — 새 토큰(원문은 이 응답에 한 번만 · DB 에는 sha256) · 전 토큰은 바로 무효 · ERP 서버 .env SGB_SERVICE_TOKEN 에 넣음' })
  @ApiOkResponse({ type: Object })
  @Audit('ERP_SERVICE_TOKEN_ROTATE', 'SETTING')
  rotate() { return rotateServiceToken(this.svc.db, RequestCtx.actorId()!); }

  @Post('handoff')
  @HttpCode(200)
  @Roles('REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT')
  @ApiOperation({ summary: 'ERP 열기 — 넘겨주기 코드', description: 'v10.800 (docs/916) — 운영자(2단계 확인 뒤 · AuthGuard) · 60초 · 한 번 코드 · url = ERP_WEB_URL/#/handoff?code= · 코드는 해시만 저장' })
  @ApiOkResponse({ type: Object })
  handoff(@Req() req: any) { return createHandoff(this.svc.db, req.principal.accountId, RequestCtx.get()?.sid, req.principal.mfaAt); }
}
