import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
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

export class StaffIpNginxAppliedDto {
  @ApiProperty({ example: '3f2a9c01b7de', description: '반영 스크립트 첫 줄의 목록 지문(12자)' })
  @IsString() @Length(12, 12) hash!: string;
}
export class StaffIpNginxApplyDto {
  @ApiProperty({ example: '적용', description: '확인 문구 — 「적용」 그대로' }) @IsString() @Length(1, 10) confirm!: string;
  @ApiProperty({ example: '사무실 IP 바뀜', description: '사유(2 ~ 200자)' }) @IsString() @Length(1, 400) reason!: string;
}
export class StaffIpNginxScriptDto {
  @ApiProperty({ description: '허용 IP · 메모' }) ips!: Array<{ ip: string; memo: string }>;
  @ApiProperty() count!: number;
  @ApiProperty({ description: '목록 지문(sha256 앞 12자)' }) hash!: string;
  @ApiProperty({ example: '/etc/nginx/snippets/sgb-admin-allow.conf' }) file!: string;
  @ApiPropertyOptional({ nullable: true, description: '목록을 마지막으로 고친 때(더함 · 뺌)' }) lastChangedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, description: '마지막 「반영했음」(지문 · 때 · 사람)' }) applied!: { hash: string | null; at: string | null; by: string | null } | null;
  @ApiProperty({ description: '마지막 「반영했음」과 지금 목록이 같음' }) appliedSame!: boolean;
  @ApiProperty({ description: '지금 접속한 IP 가 목록에 있음' }) myIpIn!: boolean;
  @ApiPropertyOptional({ nullable: true }) myIp!: string | null;
  @ApiProperty({ type: String, isArray: true, description: 'Nginx 가 읽지 못할 모양(있으면 스크립트에서 뺌)' }) invalid!: string[];
  @ApiProperty({ description: '반영 스크립트(bash) — 목록이 비면 빈 글자' }) script!: string;
  @ApiProperty({ description: '「적용」 감시 서비스 — installed · last(id · hash · ok · at · message) · pending(id · at)' }) watcher!: { installed: boolean; last: unknown; pending: unknown };
}

export class StaffIpAllowDto {
  @ApiProperty({ example: '121.168.92.13', description: 'IP 주소 하나(IPv4 · IPv6)' })
  @IsString() @Length(2, 45) ip!: string;
  @ApiProperty({ example: '집', description: '어디인지(1 ~ 100자)' })
  @IsString() @Length(1, 100) memo!: string;
  @ApiPropertyOptional({ enum: [1, 3, 7, 14, 30], description: 'v10.350 임시 허용 — 며칠 뒤 저절로 빠짐(비우면 기한 없음)' })
  @IsOptional() @IsIn([1, 3, 7, 14, 30]) expiresDays?: number;
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
  @ApiOperation({ summary: '허용 IP 더하기(SUPER)', description: '이 IP 에서는 인증 없이. 메모 필수. v10.350 기한(expiresDays 1 · 3 · 7 · 14 · 30) — 지나면 인증 면제가 끊기고 정기 작업이 목록에서 뺌.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'IP_EXISTS', type: ErrorDto })
  addAllow(@Body() dto: StaffIpAllowDto) { return this.svc.addAllow(dto.ip, dto.memo, dto.expiresDays); }

  @Delete('admin/staff-access/allow/:id')
  @Roles('SUPER')
  @Audit('STAFF_IP_ALLOW_REMOVE', 'SETTING')
  @ApiOperation({ summary: '허용 IP 빼기(SUPER)' })
  @ApiResponse({ status: 422, description: 'IP_LAST — 마지막 허용 IP 는 뺄 수 없음(v10.348)', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  removeAllow(@Param('id') id: string) { return this.svc.removeAllow(id); }

  /* v10.348 (docs/482) — 허용 IP → Nginx 반영: 화면은 스크립트를 보여 주기만(서버를 바꾸지 않음) · 사람이 운영 서버에서 돌린 뒤 「반영했음」 */
  @Get('admin/staff-access/nginx-script')
  @Roles('SUPER')
  @Audit('STAFF_IP_NGINX_SCRIPT', 'SETTING')
  @ApiOperation({ summary: '허용 IP → Nginx 반영 스크립트 (v10.348 · SUPER)', description: '허용 IP 목록 · 목록 지문 · 마지막 반영 · 지금 접속 IP 들어 있음 · 반영 스크립트(bash). 서버를 바꾸지 않습니다 — 사람이 운영 서버 ubuntu 로 붙여 넣습니다.' })
  @ApiOkResponse({ type: StaffIpNginxScriptDto })
  nginxScript() { return this.svc.nginxScript(); }

  @Post('admin/staff-access/nginx-applied')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('STAFF_IP_NGINX_APPLIED', 'SETTING')
  @ApiOperation({ summary: 'Nginx 에 반영했음 (v10.348 · SUPER)', description: '반영 스크립트를 운영 서버에서 돌린 뒤 누름 — 그 스크립트의 목록 지문을 감사 기록에 남김. 그 사이 목록이 바뀌었으면 409.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'NGINX_LIST_CHANGED — 스크립트를 만든 뒤 목록이 바뀜', type: ErrorDto })
  @ApiResponse({ status: 422, description: '쓰지 않음(문서 규칙)', type: ErrorDto })
  nginxApplied(@Body() dto: StaffIpNginxAppliedDto) { return this.svc.nginxApplied(dto.hash); }

  @Post('admin/staff-access/nginx-apply')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('STAFF_IP_NGINX_APPLY', 'SETTING')
  @ApiOperation({ summary: 'Nginx 에 적용 요청 (v10.348 · SUPER)', description: '확인 문구 「적용」 · 사유. 프로그램은 요청 파일만 씁니다 — 운영 서버 루트 감시 서비스가 다시 검사해 허용 파일 교체 · nginx -t · 다시 읽기(실패면 되돌림). 결과는 nginx-script 의 watcher.last.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'NGINX_APPLY_PENDING — 앞 요청 적용 중', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'NGINX_CONFIRM · NGINX_REASON · NGINX_WATCH_NOT_READY(감시 서비스 설치 전) · NGINX_LIST_EMPTY · NGINX_MY_IP_MISSING(지금 주소가 목록에 없음)', type: ErrorDto })
  nginxApply(@Body() dto: StaffIpNginxApplyDto) { return this.svc.nginxApply(dto.confirm, dto.reason); }

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
