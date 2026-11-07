import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { MailSuppressionService } from '../../common/mail/mail-suppression.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/* ---------------------------------------------------------------------
 * v10.209 (D186 · docs/334) — 메일 반송 · 수신 거부(보내지 않을 주소) — 운영 화면 › 외부 연동 › 「메일」 안의 한 구역
 *
 *   공개           POST /webhooks/ses                           SES → SNS 알림(스위치 · 주제 · AWS 서명)
 *   ADMIN · SUPER  GET  /admin/mail/suppressions                받기 상태 · 막힌 주소(가림) · 최근 7일
 *   SUPER          POST /admin/mail/suppressions/:id/release    풀기(사유 · 감사)
 * ------------------------------------------------------------------- */

export class SesFeedbackResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ enum: ['OFF', 'SUBSCRIBED', 'DUPLICATE', 'RECORDED'], description: 'OFF = 스위치 꺼짐(아무것도 안 함)' }) action!: string;
  @ApiPropertyOptional({ enum: ['BOUNCE', 'COMPLAINT', 'DELIVERY', 'OTHER'] }) kind?: string;
  @ApiPropertyOptional({ description: '이번에 막은 주소 수' }) suppressed?: number;
}
export class MailFeedbackStateDto {
  @ApiProperty({ description: 'notify.ses_feedback' }) switchOn!: boolean;
  @ApiProperty({ description: 'notify.ses_topic_arn 이 있음' }) topicSet!: boolean;
  @ApiPropertyOptional({ nullable: true, format: 'date-time', description: '마지막으로 받은 알림' }) lastAt!: string | null;
}
export class MailSuppressCountsDto {
  @ApiProperty() active!: number;
  @ApiProperty() bounce!: number;
  @ApiProperty() complaint!: number;
  @ApiProperty() released!: number;
}
export class MailFeedbackWeekDto {
  @ApiProperty() bounce!: number;
  @ApiProperty() complaint!: number;
  @ApiProperty() delivery!: number;
}
export class MailSuppressionRowDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'ab***@example.com', description: '주소(가림)' }) email!: string;
  @ApiProperty({ enum: ['BOUNCE', 'COMPLAINT'] }) reason!: string;
  @ApiPropertyOptional({ nullable: true, example: 'Permanent/General' }) detail!: string | null;
  @ApiProperty() hits!: number;
  @ApiProperty({ format: 'date-time' }) firstAt!: string;
  @ApiProperty({ format: 'date-time' }) lastAt!: string;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) releasedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) releaseNote!: string | null;
}
export class MailSuppressionsDto {
  @ApiProperty({ type: MailFeedbackStateDto }) feedback!: MailFeedbackStateDto;
  @ApiProperty({ type: MailSuppressCountsDto }) counts!: MailSuppressCountsDto;
  @ApiProperty({ type: MailFeedbackWeekDto }) week!: MailFeedbackWeekDto;
  @ApiProperty({ type: [MailSuppressionRowDto] }) items!: MailSuppressionRowDto[];
}
export class MailSuppressReleaseDto {
  @ApiProperty({ minLength: 2, maxLength: 300, description: '푸는 사유(회원이 주소를 고쳤다고 알려 옴 등)' }) @IsString() @MaxLength(300) note!: string;
}
export class MailSuppressReleaseResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ format: 'uuid' }) id!: string;
}

@ApiTags('ADM')
@Controller('api/v1')
export class MailFeedbackController {
  constructor(private readonly svc: MailSuppressionService) {}

  /* ★ 공개 주소(AWS SNS 가 로그인 없이 보냄 · check-acl 'webhooks' 구역). 스위치 · 주제 · AWS 서명이 맞아야 처리합니다. */
  @Post('webhooks/ses')
  @HttpCode(200)
  @ApiOperation({ summary: 'SES 반송 · 수신 거부 알림 (v10.209 · SNS)', description: '**로그인 없는 공개 주소**. 스위치 notify.ses_feedback 이 꺼져 있으면 아무것도 하지 않음(OFF). 주제 notify.ses_topic_arn 이 다르면 403 · AWS SNS 서명이 틀리면 401. 영구 반송 · 수신 거부 주소는 알림 메일을 보내지 않음.' })
  @ApiResponse({ status: 401, description: 'SES_FEEDBACK_BAD_SIGNATURE', type: ErrorDto })
  @ApiResponse({ status: 403, description: 'SES_FEEDBACK_TOPIC', type: ErrorDto })
  @ApiOkResponse({ type: SesFeedbackResultDto })
  webhook(@Req() req: RawBodyRequest<any>, @Body() body: any) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : typeof body === 'string' ? body : JSON.stringify(body ?? {});
    return this.svc.webhook(raw);
  }

  @Get('admin/mail/suppressions')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '메일 반송 · 수신 거부 주소 (v10.209)', description: '받기 상태(스위치 · 주제) · 막힌 주소(가림 · 최근 200) · 최근 7일 받은 수. state=released 면 푼 주소.' })
  @ApiQuery({ name: 'state', required: false, enum: ['active', 'released'] })
  @ApiOkResponse({ type: MailSuppressionsDto })
  list(@Query('state') state?: string) { return this.svc.list(state); }

  @Post('admin/mail/suppressions/:id/release')
  @ApiBearerAuth()
  @Roles('SUPER')
  @ApiOperation({ summary: '반송 주소 풀기 (v10.209)', description: '다시 알림 메일을 보냄. 사유 2 ~ 300자. 다시 반송되면 다시 막힘.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 422, description: 'MAIL_SUPPRESS_NOTE · MAIL_SUPPRESS_RELEASED', type: ErrorDto })
  @ApiOkResponse({ type: MailSuppressReleaseResultDto })
  @Audit('MAIL_SUPPRESS_RELEASE', 'INTEGRATION')
  release(@Param('id') id: string, @Body() dto: MailSuppressReleaseDto) { return this.svc.release(id, dto.note); }
}
