import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { Audit } from '../../core/audit.interceptor';
import { StrictBoolean } from '../../common/strict-boolean';
import { MailService } from '../../common/mail/mail.service';
import { MAIL_REPLY_MAX, MAIL_STATES, loadForChange, assignMessage, getAttachment, getMessage, listMessages, replyMessage, setState } from './mailbox-admin';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { PolicyViolation } from '../../core/errors';
import { DatabaseService } from '../../db/database.service';
import { MailInbound } from '../../common/mail/mail-inbound';
import { s3Get } from '../../common/mail/s3-get';

/* ---------------------------------------------------------------------
 * v10.789 (D330 · docs/904) 사내 웹메일 W1 — 공용 메일함 받기
 *
 *   공개           POST /webhooks/ses/inbound    SES 받기 → SNS 알림(스위치 mail.inbound · 주제 mail.inbound_topic_arn · AWS 서명)
 *   ADMIN · SUPER  GET  /admin/mailbox/state     받기 상태(스위치 · 주제 · 마지막 받은 알림) · 공용 주소별 새 메일 수
 *   v10.790 (docs/905) 운영 화면 「공용 메일함」(메일함마다 업무 권한 mailbox-* · 열람 기록)
 *                  GET  /admin/mailbox/messages                목록(메일함 · 상태 · 찾기 · 30개씩)
 *                  GET  /admin/mailbox/messages/{id}           한 통(본문 · 첨부 목록 · 같은 대화 · 열람 기록) — 열면 VIEW 기록
 *                  POST /admin/mailbox/messages/{id}/assign    맡기기(운영자 · 비우면 풀기)
 *                  POST /admin/mailbox/messages/{id}/state     끝냄 DONE · 다시 열기 NEW · 스팸 SPAM
 *                  POST /admin/mailbox/messages/{id}/reply     답장(SES · 보내는 주소 = 그 공용 주소 · 메일 준비 안 됨 422)
 *                  GET  /admin/mailbox/attachments/{id}        첨부(Base64 · 바이러스 FAIL 이면 422)
 *                  POST /admin/mailbox/messages/{id}/fetch     S3 에서 원본 다시 가져오기(위치만 있는 메일 · S3 읽기 설정 필요)
 *   ★ /webhooks/ses 아래 주소라 security-headers.ts 의 SNS 글 그대로 읽기(256KB)가 그대로 걸림 — SNS 알림 한 통 한도와 같음
 * ------------------------------------------------------------------- */

const fetchText = async (url: string) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!r.ok) throw new PolicyViolation('MAIL_INBOUND_FETCH', 'AWS SNS 에 연결하지 못했습니다.');
  return (await r.text()).slice(0, 20000);
};

@Injectable()
export class MailboxService {
  private readonly inbound: MailInbound;
  constructor(private readonly db: DatabaseService, private readonly mail: MailService) {
    this.inbound = new MailInbound(db, fetchText, s3Get);
  }

  list(q: { box?: string; state?: string; q?: string; page?: number }) { return listMessages(this.db, q); }
  get(id: string) { return getMessage(this.db, id); }
  assign(id: string, assignee: string | null) { return assignMessage(this.db, id, assignee); }
  setState(id: string, state: string) { return setState(this.db, id, state); }
  reply(id: string, body: string, done: boolean) { return replyMessage(this.db, this.mail, id, body, done); }
  attachment(id: string) { return getAttachment(this.db, id); }
  async refetch(id: string) { await loadForChange(this.db, id); return this.inbound.refetch(id); }

  webhook(raw: string) { return this.inbound.handle(raw); }

  async state() {
    const [s] = await this.db.query<{ on: boolean; topic: boolean; last: string | null }>(
      `SELECT coalesce((SELECT value FROM site_settings WHERE key = 'mail.inbound'), 'off') = 'on' AS on,
              coalesce(btrim((SELECT value FROM site_settings WHERE key = 'mail.inbound_topic_arn')), '') <> '' AS topic,
              (SELECT max(received_at) FROM mail_inbound_events) AS last`);
    const boxes = await this.db.query<{ address: string; label: string; fresh: number; total: number }>(
      `SELECT b.address, b.label,
              (SELECT count(*)::int FROM mail_messages m WHERE m.box_id = b.id AND m.direction = 'IN' AND m.state = 'NEW') AS fresh,
              (SELECT count(*)::int FROM mail_messages m WHERE m.box_id = b.id AND m.direction = 'IN') AS total
         FROM mail_boxes b WHERE b.is_active ORDER BY b.id`);
    return { switchOn: !!s?.on, topicSet: !!s?.topic, lastAt: s?.last ?? null, boxes };
  }
}

export class MailInboundResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ enum: ['OFF', 'SUBSCRIBED', 'DUPLICATE', 'RECORDED', 'IGNORED'], description: 'OFF = 스위치 꺼짐 · IGNORED = 공용 주소가 아니거나 받기 알림이 아님' }) action!: string;
  @ApiPropertyOptional({ description: '이번에 넣은 공용 메일함 수' }) boxes?: number;
  @ApiPropertyOptional({ description: '원본을 받아 본문 · 첨부를 풀었는지(SNS 작업) — S3 작업 알림이면 false' }) withContent?: boolean;
}
export class MailboxBoxStateDto {
  @ApiProperty({ example: 'privacy@sogaebank.com' }) address!: string;
  @ApiProperty({ example: '개인정보 문의' }) label!: string;
  @ApiProperty({ description: '새 메일(아직 아무도 맡지 않음)' }) fresh!: number;
  @ApiProperty() total!: number;
}
export class MailboxStateDto {
  @ApiProperty({ description: 'mail.inbound' }) switchOn!: boolean;
  @ApiProperty({ description: 'mail.inbound_topic_arn 이 있음' }) topicSet!: boolean;
  @ApiPropertyOptional({ nullable: true, format: 'date-time', description: '마지막으로 받은 SNS 알림' }) lastAt!: string | null;
  @ApiProperty({ type: [MailboxBoxStateDto] }) boxes!: MailboxBoxStateDto[];
}


export class MailboxBoxDto {
  @ApiProperty() id!: number;
  @ApiProperty({ example: 'privacy@sogaebank.com' }) address!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ description: '새 메일 수' }) fresh!: number;
}
export class MailboxRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() boxId!: number;
  @ApiProperty({ enum: ['IN', 'OUT'] }) direction!: string;
  @ApiPropertyOptional({ nullable: true }) fromAddr!: string | null;
  @ApiPropertyOptional({ nullable: true }) fromName!: string | null;
  @ApiPropertyOptional({ nullable: true }) subject!: string | null;
  @ApiProperty({ enum: ['NEW', 'ASSIGNED', 'DONE', 'SPAM'] }) state!: string;
  @ApiProperty({ format: 'date-time' }) receivedAt!: string;
  @ApiProperty({ description: '본문을 풀었는지(큰 메일은 S3 원본만)' }) hasContent!: boolean;
  @ApiPropertyOptional({ nullable: true }) spam!: string | null;
  @ApiPropertyOptional({ nullable: true }) virus!: string | null;
  @ApiPropertyOptional({ nullable: true }) dmarc!: string | null;
  @ApiProperty() attachments!: number;
  @ApiPropertyOptional({ nullable: true }) assigneeName!: string | null;
}
export class MailboxListDto {
  @ApiProperty({ type: [MailboxBoxDto] }) boxes!: MailboxBoxDto[];
  @ApiProperty({ type: [MailboxRowDto] }) items!: MailboxRowDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
}
export class MailboxAttachmentRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() filename!: string;
  @ApiProperty() contentType!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiPropertyOptional({ nullable: true }) contentId!: string | null;
  @ApiProperty() inline!: boolean;
}
export class MailboxMessageDto {
  @ApiProperty() id!: string;
  @ApiProperty() boxId!: number;
  @ApiProperty() boxAddress!: string;
  @ApiProperty() boxLabel!: string;
  @ApiProperty({ enum: ['IN', 'OUT'] }) direction!: string;
  @ApiPropertyOptional({ nullable: true }) fromAddr!: string | null;
  @ApiPropertyOptional({ nullable: true }) fromName!: string | null;
  @ApiProperty({ type: [String] }) toAddrs!: string[];
  @ApiProperty({ type: [String] }) ccAddrs!: string[];
  @ApiPropertyOptional({ nullable: true }) subject!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) sentAt!: string | null;
  @ApiProperty({ format: 'date-time' }) receivedAt!: string;
  @ApiPropertyOptional({ nullable: true }) textBody!: string | null;
  @ApiPropertyOptional({ nullable: true, description: '받은 HTML 그대로 — 화면은 격리 틀(sandbox · 스크립트 막음 · 바깥 그림 막음)로만 보임' }) htmlBody!: string | null;
  @ApiProperty() hasContent!: boolean;
  @ApiPropertyOptional({ nullable: true, description: '큰 메일 — S3 원본 위치' }) s3Key!: string | null;
  @ApiProperty({ enum: ['NEW', 'ASSIGNED', 'DONE', 'SPAM'] }) state!: string;
  @ApiPropertyOptional({ nullable: true }) assigneeName!: string | null;
  @ApiProperty({ type: [MailboxAttachmentRowDto] }) attachments!: MailboxAttachmentRowDto[];
  @ApiProperty({ description: 'SPF · DKIM 둘 다 통과 못 함 또는 DMARC 실패 — 「보낸 사람 확인 안 됨」' }) senderUnverified!: boolean;
  @ApiProperty({ description: '바이러스 판정 FAIL — 첨부 내려받기 막힘' }) virusBlocked!: boolean;
}
export class MailboxAssignDto {
  @ApiPropertyOptional({ nullable: true, format: 'uuid', description: '맡길 운영자 · null 이면 풀기' })
  @ValidateIf((o) => o.assignee !== null) @IsString() @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) assignee!: string | null;
}
export class MailboxSetStateDto {
  @ApiProperty({ enum: ['DONE', 'NEW', 'SPAM'] }) @IsIn(['DONE', 'NEW', 'SPAM']) state!: string;
}
export class MailboxReplyDto {
  @ApiProperty({ maxLength: MAIL_REPLY_MAX, description: `답장 본문(2 ~ ${MAIL_REPLY_MAX}자 · 글자만)` }) @IsString() @MaxLength(MAIL_REPLY_MAX) body!: string;
  @ApiPropertyOptional({ description: 'true = 보내고 끝냄' }) @IsOptional() @StrictBoolean() done?: boolean;
}
export class MailboxChangeResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() id!: string;
  @ApiPropertyOptional() state?: string;
  @ApiPropertyOptional({ nullable: true }) sentId?: string | null;
}
export class MailboxFetchResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ description: '본문을 채운 줄 수' }) rows!: number;
  @ApiProperty() note!: string;
}
export class MailboxAttachmentDto {
  @ApiProperty() filename!: string;
  @ApiProperty() contentType!: string;
  @ApiProperty({ description: 'Base64' }) dataBase64!: string;
}

@ApiTags('ADM')
@Controller('api/v1')
export class MailboxController {
  constructor(private readonly svc: MailboxService) {}

  /* ★ 공개 주소(AWS SNS 가 로그인 없이 보냄 · check-acl 'webhooks' 구역). 스위치 · 주제 · AWS 서명이 맞아야 처리합니다. */
  @Post('webhooks/ses/inbound')
  @HttpCode(200)
  @ApiOperation({ summary: '공용 메일함 받기 (v10.789 · SES 받기 → SNS)', description: '**로그인 없는 공개 주소**. 스위치 mail.inbound 가 꺼져 있으면 아무것도 하지 않음(OFF). 주제 mail.inbound_topic_arn 이 다르면 403 · AWS SNS 서명이 틀리면 401. S3 작업 알림은 원본 위치만, SNS 작업 알림(Base64)은 원본을 풀어 본문 · 첨부까지.' })
  @ApiResponse({ status: 401, description: 'MAIL_INBOUND_BAD_SIGNATURE', type: ErrorDto })
  @ApiResponse({ status: 403, description: 'MAIL_INBOUND_TOPIC', type: ErrorDto })
  @ApiOkResponse({ type: MailInboundResultDto })
  webhook(@Req() req: RawBodyRequest<any>, @Body() body: any) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : typeof body === 'string' ? body : JSON.stringify(body ?? {});
    return this.svc.webhook(raw);
  }

  @Get('admin/mailbox/state')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '공용 메일함 받기 상태 (v10.789)', description: '스위치 · 주제 · 마지막 받은 알림 · 공용 주소별 새 메일 수(읽기만).' })
  @ApiOkResponse({ type: MailboxStateDto })
  state() { return this.svc.state(); }

  @Get('admin/mailbox/messages')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '공용 메일함 목록 (v10.790)', description: '권한 있는 메일함만 · 메일함 · 상태 · 찾기(제목 · 보낸 주소) · 30개씩.' })
  @ApiQuery({ name: 'box', required: false }) @ApiQuery({ name: 'state', required: false, enum: [...MAIL_STATES] })
  @ApiQuery({ name: 'q', required: false }) @ApiQuery({ name: 'page', required: false })
  @ApiResponse({ status: 403, description: 'PERM_DENIED', type: ErrorDto })
  @ApiOkResponse({ type: MailboxListDto })
  list(@Query('box') box?: string, @Query('state') state?: string, @Query('q') q?: string, @Query('page') page?: string) {
    return this.svc.list({ box, state, q, page: Number(page) || 1 });
  }

  @Get('admin/mailbox/messages/:id')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '공용 메일함 한 통 (v10.790)', description: '본문 · 첨부 목록 · 같은 대화 · 열람 기록 — 열면 열람 기록(VIEW) 한 줄.' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 403, description: 'PERM_DENIED', type: ErrorDto })
  @ApiOkResponse({ type: MailboxMessageDto })
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post('admin/mailbox/messages/:id/assign')
  @HttpCode(200)
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @Audit('MAILBOX_ASSIGN', 'MAIL')
  @ApiOperation({ summary: '공용 메일 맡기기 (v10.790)', description: '운영자(ADMIN · SUPER)에게 · null 이면 풀기.' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 409, description: 'MAIL_NOT_INBOUND', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MAIL_ASSIGNEE', type: ErrorDto })
  @ApiOkResponse({ type: MailboxChangeResultDto })
  assign(@Param('id') id: string, @Body() dto: MailboxAssignDto) { return this.svc.assign(id, dto.assignee ?? null); }

  @Post('admin/mailbox/messages/:id/state')
  @HttpCode(200)
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @Audit('MAILBOX_STATE', 'MAIL')
  @ApiOperation({ summary: '공용 메일 상태 (v10.790)', description: 'DONE 끝냄 · NEW 다시 열기 · SPAM 스팸.' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 409, description: 'MAIL_NOT_INBOUND', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MAIL_STATE', type: ErrorDto })
  @ApiOkResponse({ type: MailboxChangeResultDto })
  state2(@Param('id') id: string, @Body() dto: MailboxSetStateDto) { return this.svc.setState(id, dto.state); }

  @Post('admin/mailbox/messages/:id/reply')
  @HttpCode(200)
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @Audit('MAILBOX_REPLY', 'MAIL')
  @ApiOperation({ summary: '공용 메일 답장 (v10.790)', description: 'SES 로 보냄 · 보내는 주소 = 그 공용 주소 · In-Reply-To · References · 메일 보내기 준비가 안 됐으면 422 MAIL_NOT_READY.' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 409, description: 'MAIL_NOT_INBOUND · MAIL_NO_SENDER', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'MAIL_REPLY_LENGTH · MAIL_NOT_READY · MAIL_SEND_FAILED', type: ErrorDto })
  @ApiOkResponse({ type: MailboxChangeResultDto })
  reply(@Param('id') id: string, @Body() dto: MailboxReplyDto) { return this.svc.reply(id, dto.body, !!dto.done); }

  @Get('admin/mailbox/attachments/:id')
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '공용 메일 첨부 (v10.790)', description: 'Base64 로 · 내려받기 기록(DOWNLOAD) · 바이러스 판정 FAIL 이면 422 MAIL_VIRUS.' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 422, description: 'MAIL_VIRUS', type: ErrorDto })
  @ApiOkResponse({ type: MailboxAttachmentDto })
  attachment(@Param('id') id: string) { return this.svc.attachment(id); }

  @Post('admin/mailbox/messages/:id/fetch')
  @HttpCode(200)
  @ApiBearerAuth()
  @Roles('ADMIN', 'SUPER')
  @Audit('MAILBOX_FETCH', 'MAIL')
  @ApiOperation({ summary: '공용 메일 원본 S3 에서 다시 가져오기 (v10.790)', description: '위치만 있는 메일(가져오기 실패 · 설정 전)을 S3 에서 다시 가져와 풂 · 같은 SES 번호의 다른 메일함 줄도 · 실패 까닭은 note(ok false).' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 409, description: 'MAIL_NOT_INBOUND', type: ErrorDto })
  @ApiResponse({ status: 422, description: '없음(실패는 ok=false · note)', type: ErrorDto })
  @ApiOkResponse({ type: MailboxFetchResultDto })
  refetch(@Param('id') id: string) { return this.svc.refetch(id); }
}

