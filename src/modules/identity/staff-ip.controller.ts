import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import type { Request } from 'express';
import { ErrorDto } from '../../common/dto/common.dto';
import { Principal, Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { Forbidden } from '../../core/errors';
import { StaffIpService } from './staff-ip.service';

export class StaffIpCodeDto {
  @ApiProperty({ example: '123456', description: '텔레그램으로 받은 6자리 번호' })
  @IsString() @Matches(/^\d{6}$/, { message: '6자리 번호를 넣어 주십시오.' }) code!: string;
}

export class StaffIpAllowDto {
  @ApiProperty({ example: '121.168.92.13', description: 'IP 주소 하나(IPv4 · IPv6)' })
  @IsString() @Length(2, 45) ip!: string;
  @ApiProperty({ example: '집', description: '어디인지(1 ~ 100자)' })
  @IsString() @Length(1, 100) memo!: string;
}

export class StaffTelegramDto {
  @ApiPropertyOptional({ example: '123456789', description: '개인 텔레그램 대화 번호(봇에게 먼저 말을 건 뒤) · 비우면 운영 대화방으로' })
  @IsOptional() @IsString() @Length(0, 21) chat?: string | null;
}

export class StaffPhoneDto {
  @ApiProperty({ example: '01012345678', description: '운영자 휴대폰(숫자 · - 있어도 됨)' })
  @IsString() @Length(10, 13) phone!: string;
}

export class StaffIpStatusDto {
  @ApiProperty({ description: '설정 admin.ip_verify 가 켜졌는지' }) on!: boolean;
  @ApiProperty({ description: '나에게 필요한지(운영 역할 · 켜짐)' }) required!: boolean;
  @ApiProperty({ description: '허용 IP 이거나 오늘 이 IP 로 인증했는지' }) verified!: boolean;
  @ApiPropertyOptional({ description: '지금 접속 주소(가림)' }) ip?: string | null;
  @ApiPropertyOptional({ description: '받을 곳 TELEGRAM_ME · TELEGRAM_OPS · 없음' }) channel?: string | null;
  @ApiProperty({ description: '번호를 보낼 수 있는지' }) ready!: boolean;
  @ApiPropertyOptional({ description: '보내는 길 설정 TELEGRAM · SMS · SMS_THEN_TELEGRAM(v10.227)' }) mode?: string;
}

export class StaffIpSendDto {
  @ApiProperty() sent!: boolean;
  @ApiProperty({ description: 'TELEGRAM_ME · TELEGRAM_OPS · SMS' }) channel!: string;
  @ApiProperty({ description: '유효 시간(분)' }) minutes!: number;
  @ApiPropertyOptional() ip?: string | null;
}

export class StaffIpConfirmDto {
  @ApiProperty() verified!: boolean;
  @ApiPropertyOptional() ip?: string | null;
  @ApiProperty({ description: '유효 기한(한국 시간 그날 자정)' }) until!: string;
}

/* ---------------------------------------------------------------------
 * v10.226 (D195 · docs/363) — 운영 화면 접속 인증(SB-ADM-SIP-010)
 *
 *   /auth/ip-verify* 는 운영 역할을 요구하지 않습니다(@Roles 없음) — 인증이 필요한 상태(IP_VERIFY_REQUIRED)에서도
 *   번호를 받고 넣을 수 있어야 하므로. 로그인만 봅니다. 받을 곳 바꾸기는 인증을 마친 뒤에만(@Roles) — 비밀번호만 아는 사람이 번호를 빼돌리지 못하게.
 * ------------------------------------------------------------------- */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('api/v1')
export class StaffIpController {
  constructor(private readonly svc: StaffIpService) {}

  private me(req: Request): Principal {
    const p = (req as any).principal as Principal | undefined;
    if (!p) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
    return p;
  }

  @Get('auth/ip-verify')
  @ApiOperation({ summary: '내 접속 인증 상태', description: '설정이 켜졌는지 · 나에게 필요한지 · 이 IP 가 허용 · 오늘 인증됐는지 · 받을 곳.' })
  @ApiOkResponse({ type: StaffIpStatusDto })
  status(@Req() req: Request) { return this.svc.status(this.me(req)); }

  @Post('auth/ip-verify/send')
  @HttpCode(200)
  @ApiOperation({ summary: '접속 인증번호 보내기', description: '텔레그램(개인 대화 · 없으면 운영 대화방)으로 6자리 · 5분 · 1분에 한 번 · 하루 10번.' })
  @ApiOkResponse({ type: StaffIpSendDto })
  @ApiResponse({ status: 429, description: 'IP_VERIFY_WAIT · IP_VERIFY_DAY_LIMIT', type: ErrorDto })
  @ApiResponse({ status: 423, description: 'IP_VERIFY_LOCKED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'IP_VERIFY_NO_CHANNEL · IP_UNKNOWN', type: ErrorDto })
  send(@Req() req: Request) { return this.svc.send(this.me(req)); }

  @Post('auth/ip-verify/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: '접속 인증번호 확인', description: '맞으면 이 운영자 · IP 를 한국 시간 그날 자정까지 허용. 5번 틀리면 15분 막음.' })
  @ApiOkResponse({ type: StaffIpConfirmDto })
  @ApiResponse({ status: 403, description: 'IP_VERIFY_INVALID', type: ErrorDto })
  @ApiResponse({ status: 423, description: 'IP_VERIFY_LOCKED', type: ErrorDto })
  confirm(@Req() req: Request, @Body() dto: StaffIpCodeDto) { return this.svc.confirm(this.me(req), dto.code); }

  @Put('me/staff/telegram')
  @Roles('ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF')
  @Audit('STAFF_TELEGRAM_SET', 'ACCOUNT')
  @ApiOperation({ summary: '내 인증번호 받을 곳', description: '개인 텔레그램 대화 번호 · 비우면 운영 대화방. 접속 인증을 마친 뒤에만.' })
  @ApiOkResponse({ type: Object })
  myTelegram(@Req() req: Request, @Body() dto: StaffTelegramDto) { return this.svc.setTelegram(this.me(req).accountId, dto.chat ?? null); }

  /* v10.227 (D196 · docs/364) — 내 휴대폰(문자 길) — 접속 인증을 마친 뒤에만(@Roles) · 감사는 서비스가 끝 4자리만(@Audit 은 본문을 남김) */
  @Post('me/staff/phone')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF')
  @ApiOperation({ summary: '내 휴대폰 확인 번호 받기', description: '알림톡(실패하면 문자) 6자리 · 5분 · 1분에 한 번 · 하루 5번. 알림톡이 준비돼야 함(422 SMS_NOT_READY).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, description: 'PHONE_FORMAT · SMS_NOT_READY', type: ErrorDto })
  phoneSend(@Req() req: Request, @Body() dto: StaffPhoneDto) { return this.svc.phoneSend(this.me(req), dto.phone); }

  @Post('me/staff/phone/confirm')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT', 'PARTNER_MAL', 'PARTNER_AFF')
  @ApiOperation({ summary: '내 휴대폰 확인', description: '맞으면 그 번호가 접속 인증 문자 받을 곳. 5번 틀리면 423.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, description: 'IP_VERIFY_INVALID', type: ErrorDto })
  phoneConfirm(@Req() req: Request, @Body() dto: StaffIpCodeDto) { return this.svc.phoneConfirm(this.me(req), dto.code); }

  /* ── 운영 화면 「접속 인증」 ── */

  @Get('admin/staff-access')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '운영 화면 접속 인증 한눈에', description: '스위치 · 텔레그램 준비 · 허용 IP · 운영자별 받을 곳 · 오늘 인증 · 최근 14일 기록(IP 가림).' })
  @ApiOkResponse({ type: Object })
  overview() { return this.svc.overview(); }

  @Post('admin/staff-access/allow')
  @Roles('SUPER')
  @Audit('STAFF_IP_ALLOW_ADD', 'SETTING')
  @ApiOperation({ summary: '허용 IP 더하기(SUPER)', description: '이 IP 에서는 인증 없이. 메모 필수.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'IP_EXISTS', type: ErrorDto })
  addAllow(@Body() dto: StaffIpAllowDto) { return this.svc.addAllow(dto.ip, dto.memo); }

  @Delete('admin/staff-access/allow/:id')
  @Roles('SUPER')
  @Audit('STAFF_IP_ALLOW_REMOVE', 'SETTING')
  @ApiOperation({ summary: '허용 IP 빼기(SUPER)' })
  @ApiOkResponse({ type: Object })
  removeAllow(@Param('id') id: string) { return this.svc.removeAllow(id); }

  @Put('admin/staff-access/:id/telegram')
  @Roles('SUPER')
  @Audit('STAFF_TELEGRAM_SET', 'ACCOUNT')
  @ApiOperation({ summary: '운영자 받을 곳 정하기(SUPER)', description: '개인 텔레그램 대화 번호 · 비우면 운영 대화방.' })
  @ApiOkResponse({ type: Object })
  setTelegram(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StaffTelegramDto) { return this.svc.setTelegram(id, dto.chat ?? null); }

  @Delete('admin/staff-access/:id/phone')
  @Roles('SUPER')
  @ApiOperation({ summary: '운영자 휴대폰 지우기(SUPER)', description: '분실 · 퇴사 — 지우면 문자 길로는 받지 못함(감사 STAFF_PHONE_REMOVED · 끝 4자리).' })
  @ApiOkResponse({ type: Object })
  removePhone(@Param('id', ParseUUIDPipe) id: string) { return this.svc.removePhone(id); }

  @Post('admin/staff-access/:id/test')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '받을 곳 시험(SUPER)', description: '그 운영자의 받을 곳으로 시험 글 한 통(번호 없음).' })
  @ApiOkResponse({ type: Object })
  test(@Param('id', ParseUUIDPipe) id: string) { return this.svc.testSend(id); }
}
