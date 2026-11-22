import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { DatabaseService } from '../../db/database.service';
import { AuthService } from '../identity/auth.service';
import { notifyNewDevice, recordLogin } from '../identity/login-history';
import { sec2AnomalyReview, sec2AnomalyScan, sec2WatchView } from './anomaly';
import { sec2PwnedJudge } from './pwned';
import { sec2SetSettings } from './settings';
import { sec2MemberMfaDisable, sec2MemberMfaEnable, sec2MemberMfaRedeem, sec2MemberMfaSetup, sec2MemberMfaStatus } from './member-mfa';
import { sec2AnswerLoginAlert, sec2LoginAlert, sec2MyLoginAlerts } from './login-alert';
import { sec2Guide, sec2RemoveTabLink, sec2SaveGuide, sec2SetTabLink, sec2TabHelp, sec2TabLinks } from './tab-help';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * v10.590 ~ 594 (docs/732 ~ 736) 15차 보안 · 기반 — API
 *
 *   SUPER        GET  /admin/sec2/watch                       이상 행동 30일 · 셈 기록 · 설정 · 회원 보안 숫자(SB-ADM-SCX-010)
 *   SUPER        POST /admin/sec2/anomalies/scan              하루 다시 셈(알림 없음)
 *   SUPER        POST /admin/sec2/anomalies/{id}/review       확인 한 번(본인 줄 못 함)
 *   SUPER        POST /admin/sec2/pwned/test                  유출 비밀번호 판정 시험(지금 방식 · 기록 TEST)
 *   SUPER        PUT  /admin/sec2/settings                    설정(사유)
 *   운영 역할    GET  /admin/help/tab?key=&label=              「?」 도움말 한 칸(SB-ADM-SCX-020)
 *   ADMIN·SUPER  GET  /admin/help/tab-links · /admin/help/guide
 *   SUPER        PUT  /admin/help/tab-links/{key} · POST …/remove · POST /admin/help/guide
 *   로그인       GET  /me/mfa · POST /me/mfa/setup · enable · disable(SB-MYP-SCX-010)
 *   로그인       GET  /me/login-alerts · POST /me/login-alerts/{id}/answer(SB-MYP-SCX-020)
 *   공개(auth)   POST /auth/mfa/member-login                  2단계 표 + 번호 → 증표(SB-HOM-SCX-010)
 * ------------------------------------------------------------------- */

const SCX_OPS = ['ADMIN', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'] as const;   // SUPER 는 늘 통과
const SCX_SIGNED_IN = ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF', 'ACCOUNTANT'] as const;   // login-sessions ANY_SIGNED_IN 과 같음
const SCX_CODE_RE = /^(\d{6}|\d{5}-?\d{5})$/;

export class ScxSettingsDto {
  @ApiPropertyOptional({ description: 'sec2.anomaly_watch' }) @IsOptional() @StrictBoolean() anomalyWatch?: boolean;
  @ApiPropertyOptional({ example: 100 }) @IsOptional() @IsInt() @Min(1) @Max(9999) viewMin?: number;
  @ApiPropertyOptional({ example: 3 }) @IsOptional() @IsInt() @Min(1) @Max(999) exportMin?: number;
  @ApiPropertyOptional({ example: 10 }) @IsOptional() @IsInt() @Min(1) @Max(9999) nightMin?: number;
  @ApiPropertyOptional({ example: 3 }) @IsOptional() @IsInt() @Min(2) @Max(10) factor?: number;
  @ApiPropertyOptional({ enum: ['off', 'ASSUME', 'LIVE'] }) @IsOptional() @IsIn(['off', 'ASSUME', 'LIVE']) pwnedMode?: string;
  @ApiPropertyOptional({ example: 1 }) @IsOptional() @IsInt() @Min(1) @Max(9999) pwnedMin?: number;
  @ApiPropertyOptional({ description: 'sec2.pwned_legal_ok — 법무 확인 · 처리방침 1.2 게시 뒤' }) @IsOptional() @StrictBoolean() pwnedLegalOk?: boolean;
  @ApiPropertyOptional({ description: 'sec2.member_mfa' }) @IsOptional() @StrictBoolean() memberMfa?: boolean;
  @ApiPropertyOptional({ example: 5, description: '0 = 끔' }) @IsOptional() @IsInt() @Min(0) @Max(999) notMeSurge?: number;
  @ApiProperty({ example: '직원 공지 뒤 감지 시작' }) @IsString() @Length(2, 200) reason!: string;
}
export class ScxScanDto {
  @ApiProperty({ example: '2026-11-20', description: '한국 날짜' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) day!: string;
}
export class ScxReviewDto {
  @ApiProperty({ example: '월말 정산 확인 — 본인 설명 들음' }) @IsString() @Length(2, 200) note!: string;
}
export class ScxPwnedTestDto {
  @ApiProperty({ example: 'Password123!', description: '판정만(저장 · 기록 안 함 — 건수만 TEST)' }) @IsString() @Length(1, 100) password!: string;
}
export class ScxMfaCodeDto {
  @ApiProperty({ example: '123456', description: '인증 앱 6자리 또는 예비 번호(12345-67890)' })
  @IsString() @Matches(SCX_CODE_RE, { message: '6자리 번호 또는 예비 번호(12345-67890)를 넣어 주십시오.' }) code!: string;
}
export class ScxMfaDisableDto {
  @ApiProperty() @IsString() @Length(1, 100) password!: string;
  @ApiProperty({ example: '123456' }) @IsString() @Matches(SCX_CODE_RE) code!: string;
}
export class ScxMfaLoginDto {
  @ApiProperty({ description: '로그인 응답의 ticket(5분 · 한 번)' }) @IsString() @Matches(/^[A-Za-z0-9_-]{40,60}$/) ticket!: string;
  @ApiProperty({ example: '123456' }) @IsString() @Matches(SCX_CODE_RE) code!: string;
}
export class ScxAlertAnswerDto {
  @ApiProperty({ enum: ['ME', 'NOT_ME'] }) @IsIn(['ME', 'NOT_ME']) answer!: string;
}
export class ScxTabLinkDto {
  @ApiProperty({ enum: ['ADMIN_GUIDE', 'USER_MANUAL'] }) @IsIn(['ADMIN_GUIDE', 'USER_MANUAL']) docCode!: string;
  @ApiProperty({ example: '운영 알림 [ops-alerts]' }) @IsString() @Length(1, 120) heading!: string;
}
export class ScxGuideSaveDto {
  @ApiProperty({ description: '새 판 본문(100 ~ 40000자 · ### 절 하나 이상)' }) @IsString() @MinLength(100) @MaxLength(60000) body!: string;
  @ApiPropertyOptional({ example: '이상 행동 감지 절 더함' }) @IsOptional() @IsString() @MaxLength(200) note?: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/sec2')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class Sec2AdminController {
  constructor(private readonly db: DatabaseService) {}

  @Get('watch')
  @Roles('SUPER')
  @ApiOperation({ summary: '이상 행동 감지 (v10.590 · SUPER)', description: '최근 30일 운영자 이상 행동(개인정보 열람 · 내려받기 · 밤 활동 · 가린 이메일) · 셈 기록 14일 · 설정 · 회원 보안 숫자(유출 막기 · 회원 2단계 · 낯선 로그인 답).' })
  @ApiOkResponse({ type: Object })
  watch() { return sec2WatchView(this.db); }

  @Post('anomalies/scan')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('SEC2_ANOMALY_SCAN', 'SETTING', { pick: ['day', 'actors', 'found', 'added'] })
  @ApiOperation({ summary: '이상 행동 하루 다시 셈 (v10.590 · SUPER)', description: '꺼져 있어도 됨 · 알림은 올리지 않음 · 같은 날 · 사람 · 종류 줄은 더하지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SEC2_DAY' })
  scan(@Body() dto: ScxScanDto) { return sec2AnomalyScan(this.db, dto.day, false); }

  @Post('anomalies/:id/review')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '이상 행동 확인 (v10.590 · SUPER)', description: '메모 2 ~ 200자 · 한 번만 · 본인 줄은 못 함(SEC2_SELF_REVIEW) · 감사 SEC2_ANOMALY_REVIEW.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SEC2_REVIEWED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SEC2_NOTE · SEC2_SELF_REVIEW' })
  review(@Param('id') id: string, @Body() dto: ScxReviewDto) { return sec2AnomalyReview(this.db, id, dto.note); }

  @Post('pwned/test')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '유출 비밀번호 판정 시험 (v10.591 · SUPER)', description: '지금 방식(off · 간주 · LIVE)으로 판정만 — 비밀번호는 저장 · 기록하지 않음(건수만 TEST) · LIVE 면 SHA-1 앞 5글자만 밖으로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  async pwnedTest(@Body() dto: ScxPwnedTestDto) {
    const r = await sec2PwnedJudge(this.db, dto.password, 'TEST');
    return { ...r, note: r.mode === 'off' ? '유출 비밀번호 막기가 꺼져 있습니다.' : r.error ? '조회하지 못했습니다(막지 않음).' : r.blocked ? '유출 목록에 있습니다 — 가입 · 변경에서 막힙니다.' : '유출 목록에 없습니다.' };
  }

  @Put('settings')
  @Roles('SUPER')
  @Audit('SEC2_SETTINGS', 'SETTING', { pick: ['ok', 'settings'] })
  @ApiOperation({ summary: '15차 보안 설정 (v10.590 ~ 593 · SUPER)', description: '이상 행동 감지 · 기준 · 유출 비밀번호(off · ASSUME · LIVE — LIVE 는 법무 확인 먼저) · 회원 2단계 · 「내가 아니에요」 몰림 기준 · 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SEC2_REASON · SEC2_NOTHING · SEC2_VALUE · SEC2_PWNED_LEGAL' })
  settings(@Body() dto: ScxSettingsDto) { return sec2SetSettings(this.db, dto); }
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/help')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class Sec2HelpController {
  constructor(private readonly db: DatabaseService) {}

  @Get('tab')
  @Roles(...SCX_OPS)
  @ApiQuery({ name: 'key', example: 'ops-alerts' })
  @ApiQuery({ name: 'label', required: false, example: '운영 알림' })
  @ApiOperation({ summary: '탭 도움말 「?」 (v10.594)', description: '이은 절 → 운영 화면 도움말 절 제목의 [탭 키] → 탭 이름 → 사용자 설명서 순으로 절 하나(4000자까지). SUPER 는 이을 절 목록(choices).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SEC2_TAB_KEY' })
  tab(@Query('key') key: string, @Query('label') label?: string) { return sec2TabHelp(this.db, key, label); }

  @Get('tab-links')
  @Roles('ADMIN')
  @ApiOperation({ summary: '탭 ↔ 도움말 절 이은 것 (v10.594)' })
  @ApiOkResponse({ type: Object })
  links() { return sec2TabLinks(this.db); }

  @Put('tab-links/:key')
  @Roles('SUPER')
  @Audit('SEC2_TAB_HELP_SET', 'SETTING', { pick: ['key', 'docCode', 'heading'] })
  @ApiOperation({ summary: '탭에 도움말 절 잇기 (v10.594 · SUPER)', description: '그 설명서 지금 판에 그 절 제목이 있어야(SEC2_NO_SECTION).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SEC2_TAB_KEY · SEC2_DOC_CODE · SEC2_NO_SECTION' })
  setLink(@Param('key') key: string, @Body() dto: ScxTabLinkDto) { return sec2SetTabLink(this.db, key, dto.docCode, dto.heading); }

  @Post('tab-links/:key/remove')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('SEC2_TAB_HELP_REMOVE', 'SETTING', { pick: ['key'] })
  @ApiOperation({ summary: '탭 도움말 잇기 지우기 (v10.594 · SUPER)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SEC2_TAB_KEY' })
  removeLink(@Param('key') key: string) { return sec2RemoveTabLink(this.db, key); }

  @Get('guide')
  @Roles('ADMIN')
  @ApiOperation({ summary: '운영 화면 도움말 — 지금 판 · 절 목차 · 판 목록 (v10.594)' })
  @ApiOkResponse({ type: Object })
  guide() { return sec2Guide(this.db); }

  @Post('guide')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('HELP_GUIDE_SAVE', 'SITE', { pick: ['ok', 'version', 'chars'] })
  @ApiOperation({ summary: '운영 화면 도움말 — 새 판 저장 (v10.594 · SUPER)', description: '옛 판은 남음 · 같은 본문이면 판을 만들지 않음 · 회원 설명서(USER_MANUAL)는 건드리지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'HELP_TOO_SHORT · HELP_TOO_LONG · HELP_NO_SECTION' })
  saveGuide(@Body() dto: ScxGuideSaveDto) { return sec2SaveGuide(this.db, dto.body, dto.note); }
}

@ApiTags('MYP')
@ApiBearerAuth()
@Controller('api/v1')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class Sec2MeController {
  constructor(private readonly db: DatabaseService, private readonly auth: AuthService) {}

  @Get('me/mfa')
  @Roles(...SCX_SIGNED_IN)
  @ApiOperation({ summary: '내 2단계 인증 (v10.592)', description: '열렸는지(sec2.member_mfa) · 운영 계정인지 · 켰는지 · 남은 예비 번호 · 비밀번호 있는지 · 잠김.' })
  @ApiOkResponse({ type: Object })
  mfa() { return sec2MemberMfaStatus(this.db); }

  @Post('me/mfa/setup')
  @HttpCode(200)
  @Roles(...SCX_SIGNED_IN)
  @ApiOperation({ summary: '2단계 인증 등록 시작 (v10.592)', description: '새 비밀값 · otpauth 주소(인증 앱에 넣음). 이미 켰으면 409.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'MFA_ENABLED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SEC2_MFA_OFF · SEC2_MFA_NEED_PASSWORD' })
  mfaSetup() { return sec2MemberMfaSetup(this.db); }

  @Post('me/mfa/enable')
  @HttpCode(200)
  @Roles(...SCX_SIGNED_IN)
  /* 감사는 서비스가 직접(@Audit 은 응답을 남겨 예비 번호가 들어감) */
  @ApiOperation({ summary: '2단계 인증 켜기 (v10.592)', description: '앱 번호가 맞으면 켜고 예비 번호 10개(이때만).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'MFA_NOT_SETUP' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'MFA_ENABLED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SEC2_MFA_OFF' })
  @ApiResponse({ status: 423, type: ErrorDto, description: 'MFA_LOCKED' })
  mfaEnable(@Body() dto: ScxMfaCodeDto) { return sec2MemberMfaEnable(this.db, dto.code); }

  @Post('me/mfa/disable')
  @HttpCode(200)
  @Roles(...SCX_SIGNED_IN)
  @ApiOperation({ summary: '2단계 인증 끄기 (v10.592)', description: '비밀번호 + 번호(앱 또는 예비) · 운영 계정은 못 끔(SEC2_MFA_STAFF) · 감사 MFA_DISABLE.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'MFA_NOT_ENROLLED' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  @ApiResponse({ status: 423, type: ErrorDto, description: 'MFA_LOCKED' })
  mfaDisable(@Body() dto: ScxMfaDisableDto) { return sec2MemberMfaDisable(this.db, dto.password, dto.code); }

  @Get('me/login-alerts')
  @Roles(...SCX_SIGNED_IN)
  @ApiOperation({ summary: '내 낯선 로그인 알림 (v10.593)', description: '최근 30일 · 답 안 한 것 먼저 · 그 기기가 아직 로그인돼 있는지.' })
  @ApiOkResponse({ type: Object })
  alerts() { return sec2MyLoginAlerts(this.db); }

  @Post('me/login-alerts/:id/answer')
  @HttpCode(200)
  @Roles(...SCX_SIGNED_IN)
  @ApiOperation({ summary: '낯선 로그인 답 (v10.593)', description: 'ME(나였어요) · NOT_ME(내가 아니에요 — 그 기기 로그아웃 · 지금 이 기기면 안 함 · 감사 LOGIN_NOT_ME) · 한 번.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SEC2_ANSWERED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SEC2_ANSWER' })
  answer(@Param('id') id: string, @Body() dto: ScxAlertAnswerDto) { return sec2AnswerLoginAlert(this.db, id, dto.answer); }

  @Post('auth/mfa/member-login')
  @HttpCode(200)
  @ApiOperation({ summary: '회원 2단계 로그인 (v10.592)', description: '로그인 응답(mfaRequired · ticket)의 표 + 인증 앱 번호(또는 예비 번호) → 증표. 표는 5분 · 한 번 · 5번 틀리면 다시 로그인. 번호 5번 틀리면 15분 잠금(423).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'SEC2_TICKET_INVALID · MFA_INVALID · ACCOUNT_INACTIVE' })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'MFA_NOT_ENROLLED(표를 받은 뒤 2단계가 꺼짐)' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONFLICT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'VALIDATION' })
  @ApiResponse({ status: 423, type: ErrorDto, description: 'MFA_LOCKED' })
  async memberLogin(@Body() dto: ScxMfaLoginDto) {
    const id = await sec2MemberMfaRedeem(this.db, dto.ticket, dto.code);
    await this.db.query(`UPDATE accounts SET last_login_at = now() WHERE id = $1`, [id]);
    const wasNew = await notifyNewDevice(this.db, id);   // 비밀번호 단계에서는 남기지 않았음 — 여기서 90일 기록과 견줌
    await recordLogin(this.db, id, true);
    return sec2LoginAlert(this.db, id, wasNew, await this.auth.issue(id, Math.floor(Date.now() / 1000)));
  }
}
