import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
import type { Request } from 'express';
import { ErrorDto } from '../../common/dto/common.dto';
import { Principal, Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { Forbidden } from '../../core/errors';
import { MfaService } from './mfa.service';

export class MfaCodeDto {
  @ApiProperty({ example: '123456', description: '인증 앱 6자리 번호 또는 예비 번호(12345-67890)' })
  @IsString() @Matches(/^(\d{6}|\d{5}-?\d{5})$/, { message: '6자리 번호 또는 예비 번호(12345-67890)를 넣어 주십시오.' }) code!: string;
}

export class MfaResetDto {
  @ApiProperty({ example: '휴대폰 분실 — 본인 전화로 확인', description: '초기화 사유(5 ~ 200자)' })
  @IsString() @Length(5, 200) reason!: string;
}

/* ---------------------------------------------------------------------
 * v10.180 (D169 · docs/281) — 운영자 2단계 인증(SB-ADM-MFA-010)
 *
 *   /auth/mfa/* 는 운영 역할을 요구하지 않습니다(@Roles 없음) — 2단계가 필요한 상태(MFA_REQUIRED)에서도
 *   번호를 넣고 등록할 수 있어야 하므로. 로그인만 봅니다.
 * ------------------------------------------------------------------- */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('api/v1')
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  private me(req: Request): Principal {
    const p = (req as any).principal as Principal | undefined;
    if (!p) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
    return p;
  }

  @Get('auth/mfa')
  @ApiOperation({ summary: '내 2단계 인증 상태', description: '설정(off · SUPER · ALL) · 나에게 필요한지 · 등록했는지 · 이 증표가 확인됐는지 · 남은 예비 번호.' })
  @ApiOkResponse({ type: Object })
  status(@Req() req: Request) { const p = this.me(req); return this.mfa.status(p, p.mfaAt); }

  @Post('auth/mfa/setup')
  @HttpCode(200)
  @ApiOperation({ summary: '2단계 인증 등록 시작', description: '새 비밀값 · otpauth 주소(인증 앱에 넣음). 이미 등록했으면 409 MFA_ENABLED.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto })
  setup(@Req() req: Request) { return this.mfa.setup(this.me(req)); }

  @Post('auth/mfa/enable')
  @HttpCode(200)
  /* 감사 기록은 서비스가 직접(@Audit 은 응답 전체를 남겨 예비 번호 · 증표가 들어감) */
  @ApiOperation({ summary: '2단계 인증 등록 마치기', description: '앱 번호가 맞으면 켜고 예비 번호 10개(이때만 보여 줌)와 확인된 새 증표.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, description: 'MFA_INVALID', type: ErrorDto })
  enable(@Req() req: Request, @Body() dto: MfaCodeDto) { return this.mfa.enable(this.me(req), dto.code); }

  @Post('auth/mfa/verify')
  @HttpCode(200)
  @ApiOperation({ summary: '2단계 인증 번호 확인', description: '인증 앱 6자리 또는 예비 번호(한 번만) → 확인된 새 증표(admin.mfa_hours 동안). 5번 틀리면 15분 잠금(423 MFA_LOCKED).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, description: 'MFA_INVALID', type: ErrorDto })
  @ApiResponse({ status: 423, description: 'MFA_LOCKED', type: ErrorDto })
  verify(@Req() req: Request, @Body() dto: MfaCodeDto) { return this.mfa.verify(this.me(req), dto.code); }

  @Get('admin/mfa/turn-on-preview')
  @Roles('SUPER')
  @ApiOperation({ summary: '2단계 인증 켜기 전 점검(SUPER)', description: 'v10.236 — mode=SUPER · ALL 로 바꾸면 번호를 넣어야 하는 운영자 수 · 등록한 수 · 등록 안 한 사람(이름 · 가린 이메일 · 역할). 읽기만 · 막지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, description: 'MFA_MODE_INVALID', type: ErrorDto })
  turnOnPreview(@Query('mode') mode: string) { return this.mfa.turnOnPreview(mode); }

  @Post('admin/accounts/:id/mfa-reset')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('MFA_RESET', 'ACCOUNT')
  @ApiOperation({ summary: '운영자 2단계 인증 초기화(SUPER)', description: '휴대폰 분실 등 — 등록을 지워 다시 등록하게 함. 사유 필수 · 본인 것은 안 됨.' })
  @ApiOkResponse({ type: Object })
  reset(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MfaResetDto) { return this.mfa.reset(id, dto.reason); }
}
