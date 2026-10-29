import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { AccountSecurityService, WITHDRAW_REASONS } from './account-security.service';

/* ★ DTO 는 쓰는 곳(컨트롤러)보다 위에 둡니다 — 개발 API(ts-node · strict:false)는 데코레이터가 형식을 바로 참조해
 *   뒤에 선언된 클래스면 ReferenceError 로 뜨지 않습니다(2026-10-19 realcheck). */

export class ForgotPasswordDto {
  @ApiProperty({ format: 'email', description: '가입한 이메일' })
  @IsEmail() @MaxLength(120)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: '메일 링크의 token 값(그대로)' })
  @IsString() @Length(30, 100)
  token!: string;

  @ApiProperty({ minLength: 10, description: '새 비밀번호 — 영문 · 숫자 · 특수문자 10자 이상' })
  @IsString() @Length(10, 100)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ description: '지금 비밀번호' })
  @IsString() @Length(1, 100)
  currentPassword!: string;

  @ApiProperty({ minLength: 10, description: '새 비밀번호 — 영문 · 숫자 · 특수문자 10자 이상' })
  @IsString() @Length(10, 100)
  newPassword!: string;
}

export class WithdrawDto {
  @ApiProperty({ description: '지금 비밀번호(본인 확인)' })
  @IsString() @Length(1, 100)
  password!: string;

  @ApiProperty({ enum: Object.keys(WITHDRAW_REASONS) })
  @IsIn(Object.keys(WITHDRAW_REASONS))
  reason!: string;

  @ApiPropertyOptional({ maxLength: 500, description: '「기타」면 필수 · 개인정보는 적지 마십시오' })
  @IsOptional() @IsString() @MaxLength(500)
  memo?: string;
}

/* ── 응답 ─────────────────────────────────────────────────────── */
export class OkNoteDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ description: '화면에 그대로 보일 안내' }) note!: string;
}

export class ForgotReadyDto {
  @ApiProperty({ description: '재설정 메일을 보낼 수 있음(메일 설정 + notify.email_verified · 개발 환경은 늘 true)' }) ready!: boolean;
}

export class ForgotResultDto extends OkNoteDto {
  @ApiPropertyOptional({ description: '개발 환경(NODE_ENV=development) · 메일 설정 전에만 — /login/reset?token=…' }) devLink?: string;
}

export class PasswordChangedDto extends OkNoteDto {
  @ApiProperty({ description: '새 access (15분) — 그 전 증표는 무효' }) accessToken!: string;
  @ApiProperty({ description: '새 refresh (14일)' }) refreshToken!: string;
}

export class WithdrawBlockerDto {
  @ApiProperty({ example: 'DEAL_OPEN' }) code!: string;
  @ApiProperty({ example: '진행 중인 거래' }) label!: string;
  @ApiProperty({ example: 1 }) cnt!: number;
  @ApiProperty({ example: '/my/deals' }) link!: string;
}

export class WithdrawReasonDto {
  @ApiProperty({ example: 'LOW_USE' }) code!: string;
  @ApiProperty({ example: '자주 쓰지 않아서' }) label!: string;
}

export class WithdrawCheckDto {
  @ApiProperty() canWithdraw!: boolean;
  @ApiProperty({ type: [WithdrawBlockerDto] }) blockers!: WithdrawBlockerDto[];
  @ApiProperty({ type: [WithdrawReasonDto] }) reasons!: WithdrawReasonDto[];
  @ApiProperty({ description: '거래 기록이 있어 5년 보관 뒤 파기' }) keepsRecords!: boolean;
  @ApiProperty() paidSubscription!: boolean;
  @ApiProperty() partner!: boolean;
  @ApiProperty({ type: [String] }) notes!: string[];
}

export class WithdrawResultDto extends OkNoteDto {
  @ApiPropertyOptional({ nullable: true, format: 'date', description: '개인정보 파기 예정일(accounts.retention_until)' }) retentionUntil!: string | null;
}

export class LoginLockStateDto {
  @ApiProperty() locked!: boolean;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) lockedUntil!: string | null;
  @ApiProperty({ description: '잠기지 않았을 때 최근 연속 실패 수' }) recentFails!: number;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) lastFailAt!: string | null;
}

export class LoginUnlockResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ description: '지운 잠금 · 실패 기록이 있었는가' }) cleared!: boolean;
}

/**
 * v10.48 (D102) — SB-HOM-AUT-040 비밀번호 찾기 · SB-HOM-AUT-041 비밀번호 재설정 · SB-MYP-ACC-010 비밀번호 변경 ·
 *   SB-MYP-ACC-020 회원 탈퇴 · SB-ADM-MBR-020 로그인 잠금 풀기
 */
@ApiTags('HOM')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
@Controller('api/v1')
export class AccountSecurityController {
  constructor(private readonly svc: AccountSecurityService) {}

  @Get('auth/password/forgot/ready')
  @ApiOperation({ summary: '비밀번호 재설정 메일을 보낼 수 있는가 (v10.147)', description: '메일 발송 준비 전이면 ready=false — 화면이 입력 전에 고객센터 「계정」 문의로 안내합니다. 계정과 상관없는 값입니다.' })
  @ApiOkResponse({ type: ForgotReadyDto })
  forgotReady() {
    return this.svc.forgotReady();
  }

  @Post('auth/password/forgot')
  @HttpCode(200)
  @ApiOperation({
    summary: '비밀번호 재설정 메일 요청',
    description: '가입된 이메일이면 30분짜리 1회용 링크를 보냅니다. **계정이 있든 없든 같은 답**을 합니다. 같은 이메일 · 같은 IP 1시간 5회(auth.reset.per_hour). 메일 발송 준비 전에는 운영에서 422 MAIL_NOT_READY · 개발 환경은 devLink.',
  })
  @ApiResponse({ status: 422, description: 'EMAIL_INVALID · MAIL_NOT_READY · MAIL_SEND_FAILED', type: ErrorDto })
  @ApiResponse({ status: 429, description: 'TOO_MANY_REQUESTS', type: ErrorDto })
  @ApiOkResponse({ type: ForgotResultDto })
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.svc.forgot(dto.email);
  }

  @Post('auth/password/reset')
  @HttpCode(200)
  @ApiOperation({
    summary: '비밀번호 재설정',
    description: '메일 링크의 token 과 새 비밀번호. 한 번만 쓸 수 있습니다. 바꾸면 로그인 증표 판 번호가 올라 **다른 기기의 로그인이 모두 끊기고** 로그인 잠금도 풀립니다.',
  })
  @ApiResponse({ status: 422, description: 'RESET_TOKEN_INVALID · WEAK_PASSWORD', type: ErrorDto })
  @ApiOkResponse({ type: OkNoteDto })
  reset(@Body() dto: ResetPasswordDto) {
    return this.svc.reset(dto.token, dto.password);
  }

  @Patch('me/password')
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '비밀번호 변경 (로그인 상태)',
    description: '지금 비밀번호가 틀리면 로그인 실패와 같이 셉니다(5회 → 30분 잠금). 성공하면 새 accessToken · refreshToken 을 돌려줍니다 — 그 전 증표는 모두 무효.',
  })
  @ApiResponse({ status: 422, description: 'CURRENT_PASSWORD_WRONG · WEAK_PASSWORD · SAME_PASSWORD', type: ErrorDto })
  @ApiResponse({ status: 423, description: 'ACCOUNT_LOCKED', type: ErrorDto })
  @ApiOkResponse({ type: PasswordChangedDto })
  change(@Body() dto: ChangePasswordDto) {
    return this.svc.change(dto.currentPassword, dto.newPassword);
  }

  @Get('me/withdraw/check')
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '탈퇴 전 확인',
    description: '탈퇴를 막는 항목(진행 중인 거래 · 분쟁 · 정산 · 소개몰 주문 · 환불 · 리드캐시 잔액 — 약관 제13조 ②)과 탈퇴하면 생기는 일 · 사유 목록.',
  })
  @ApiOkResponse({ type: WithdrawCheckDto })
  withdrawCheck() {
    return this.svc.withdrawCheck();
  }

  @Post('me/withdraw')
  @HttpCode(200)
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '회원 탈퇴',
    description: '비밀번호 확인 → 막는 항목이 없으면 탈퇴. 매물 · 요청 내리기 · 소개코드 정지 · 유료 구독 자동 결제 멈춤 · 결제 수단 해제 · 로그인 끊김. 거래 기록이 있으면 5년 보관 뒤 파기, 없으면 다음 파기 배치에서 파기.',
  })
  @ApiResponse({ status: 409, description: 'WITHDRAW_BLOCKED(details.blockers)', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'CURRENT_PASSWORD_WRONG · BAD_REASON · MEMO_REQUIRED', type: ErrorDto })
  @ApiOkResponse({ type: WithdrawResultDto })
  withdraw(@Body() dto: WithdrawDto) {
    return this.svc.withdraw(dto.password, dto.reason, dto.memo);
  }

  @Get('admin/accounts/:id/login-lock')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '회원 로그인 잠금 상태', description: '잠겼는지 · 언제 풀리는지 · 최근 연속 실패 수.' })
  @ApiOkResponse({ type: LoginLockStateDto })
  lockState(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.lockState(id);
  }

  @Delete('admin/accounts/:id/login-lock')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @Audit('LOGIN_UNLOCK', 'ACCOUNT')
  @ApiOperation({ summary: '회원 로그인 잠금 풀기', description: '고객센터에서 본인 확인을 마친 뒤 씁니다. 감사 기록 LOGIN_UNLOCK.' })
  @ApiOkResponse({ type: LoginUnlockResultDto })
  unlock(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.unlock(id);
  }
}
