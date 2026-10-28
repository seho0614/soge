import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { MailAdminService } from '../../common/mail/mail-admin.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/* ---------------------------------------------------------------------
 * v10.140 (D136 · docs/211 · 설계 docs/210) — 운영 화면 › 외부 연동 › 「메일」 (SB-ADM-SIT-080 안의 한 구역)
 *
 *   ADMIN · SUPER  GET  /admin/mail/status       준비 상태(값 없이 — 주소 · 어디서 왔는지 · 스위치 · 시험 남은 수)
 *   ADMIN · SUPER  GET  /admin/mail/deliveries   알림 메일 발송 기록(숫자 · 까닭 · 최근 실패 — 주소 가림)
 *   SUPER          POST /admin/mail/connect      SES 연결 확인(첫 인사만 · 메일 안 보냄)
 *   SUPER          POST /admin/mail/test         시험 메일 한 통(스위치와 따로 · 하루 한도 · 감사 MAIL_TEST)
 *   사용자 이름 · 비밀번호는 외부 연동 › 연동 키(MAIL · SMTP_USER · SMTP_PASS)에서 넣음 — 이 컨트롤러는 키를 받지 않음.
 * ------------------------------------------------------------------- */

export class MailKeyStateDto {
  @ApiProperty() set!: boolean;
  @ApiProperty({ enum: ['ADMIN', 'ENV', 'NONE'], description: 'ADMIN = 운영 화면 연동 키 · ENV = .env · NONE = 없음' }) source!: string;
}
export class MailHostDto {
  @ApiProperty({ example: 'email-smtp.ap-northeast-2.amazonaws.com' }) value!: string;
  @ApiProperty({ enum: ['ENV', 'DEFAULT'], description: 'DEFAULT = 코드 기본값(서울 SES)' }) source!: string;
  @ApiProperty({ example: 465 }) port!: number;
}
export class MailFromDto {
  @ApiProperty() set!: boolean;
  @ApiPropertyOptional({ nullable: true, example: 'no-reply@mail.sogaebank.com' }) value!: string | null;
  @ApiProperty({ enum: ['SETTING', 'ENV', 'NONE'], description: 'SETTING = 사이트 설정 notify.mail_from(먼저)' }) source!: string;
}
export class MailTestQuotaDto {
  @ApiProperty() limit!: number;
  @ApiProperty() used!: number;
  @ApiProperty() left!: number;
}
export class MailStatusDto {
  @ApiProperty({ type: MailHostDto }) host!: MailHostDto;
  @ApiProperty({ type: MailKeyStateDto }) user!: MailKeyStateDto;
  @ApiProperty({ type: MailKeyStateDto }) pass!: MailKeyStateDto;
  @ApiProperty({ type: MailFromDto }) from!: MailFromDto;
  @ApiProperty({ description: 'notify.email_verified — 켜져야 인증번호 · 알림 메일이 나감' }) switchOn!: boolean;
  @ApiProperty({ description: '설정이 다 있음(시험 메일을 보낼 수 있음)' }) configured!: boolean;
  @ApiProperty({ description: '설정 + 스위치 — 회원에게 실제로 나감' }) ready!: boolean;
  @ApiProperty({ type: MailTestQuotaDto }) test!: MailTestQuotaDto;
}
export class MailConnectDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() host!: string;
  @ApiProperty() port!: number;
  @ApiProperty({ description: '걸린 시간(ms)' }) ms!: number;
  @ApiPropertyOptional({ enum: ['TIMEOUT', 'NETWORK', 'REJECTED'] }) errorKind?: string;
  @ApiPropertyOptional() error?: string;
}
export class MailTestDto {
  @ApiProperty({ maxLength: 200, description: '시험 메일을 받을 주소(샌드박스 중이면 SES 에서 인증한 주소)' }) @IsString() @MaxLength(200) to!: string;
}
export class MailTestResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ example: 'ad***@example.com', description: '받는 주소(가림)' }) to!: string;
  @ApiPropertyOptional({ nullable: true }) messageId!: string | null;
  @ApiPropertyOptional({ nullable: true, enum: ['NETWORK', 'TIMEOUT', 'AUTH', 'REJECTED', 'BAD_INPUT'], description: 'AUTH = 사용자 이름 · 비밀번호 · REJECTED = 샌드박스 · 인증 안 된 주소 · 보내는 도메인 미확인' }) errorKind!: string | null;
  @ApiPropertyOptional({ nullable: true }) error!: string | null;
  @ApiProperty({ description: '오늘 남은 시험 메일 수' }) left!: number;
}
export class MailReasonDto {
  @ApiProperty({ example: 'REJECTED' }) reason!: string;
  @ApiProperty() n!: number;
}
export class MailFailRowDto {
  @ApiProperty({ format: 'date-time' }) at!: string;
  @ApiProperty() event!: string;
  @ApiPropertyOptional({ nullable: true }) reason!: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'ab***@example.com' }) to!: string | null;
}
export class MailDeliveriesDto {
  @ApiProperty({ enum: [1, 7, 30] }) days!: number;
  @ApiProperty() sent!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ description: '아직 보내지 않음(스위치 꺼짐 · 다시 시도 중)' }) queued!: number;
  @ApiProperty({ type: [MailReasonDto] }) reasons!: MailReasonDto[];
  @ApiProperty({ type: [MailFailRowDto] }) recent!: MailFailRowDto[];
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/mail')
export class MailAdminController {
  constructor(private readonly svc: MailAdminService) {}

  @Get('status')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '메일 준비 상태 (v10.140)', description: '주소 · 사용자 이름 · 비밀번호 · 보내는 주소 · 스위치. 키 값은 내보내지 않습니다(어디서 왔는지만).' })
  @ApiOkResponse({ type: MailStatusDto })
  status() { return this.svc.status(); }

  @Get('deliveries')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '알림 메일 발송 기록 (v10.140)', description: '최근 1 · 7 · 30일 보냄 · 실패 · 대기 수 · 실패 까닭별 · 최근 실패 50줄. 받는 주소는 앞 2글자와 도메인만.' })
  @ApiQuery({ name: 'days', required: false, enum: [1, 7, 30] })
  @ApiOkResponse({ type: MailDeliveriesDto })
  deliveries(@Query('days') days?: string) { return this.svc.deliveries(Number(days) || 7); }

  @Post('connect')
  @Roles('SUPER')
  @ApiOperation({ summary: 'SES 연결 확인 (v10.140)', description: 'SES 에 붙어 첫 인사(220)만 받고 끊습니다 — 메일을 보내지 않고 로그인하지 않습니다(5초).' })
  @ApiOkResponse({ type: MailConnectDto })
  connect() { return this.svc.connect(); }

  @Post('test')
  @Roles('SUPER')
  @ApiOperation({ summary: '시험 메일 보내기 (v10.140)', description: '넣은 주소로 한 통 보냅니다. 스위치(notify.email_verified)가 꺼져 있어도 보냅니다 — 회원 알림은 그대로 나가지 않습니다. 하루 notify.mail_test_daily 통.' })
  @ApiOkResponse({ type: MailTestResultDto })
  @ApiResponse({ status: 422, description: 'EMAIL_INVALID · MAIL_NOT_CONFIGURED · MAIL_TEST_LIMIT', type: ErrorDto })
  @Audit('MAIL_TEST', 'INTEGRATION')
  test(@Body() dto: MailTestDto) { return this.svc.test(dto.to); }
}
