import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AgentChatService } from './agent-chat.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { AgentService } from './agent.service';
import { Roles } from '../../core/auth';

/* AI 에이전트 0단계 — 운영 화면 「AI 운영 › AI 에이전트」(SB-ADM-AGT-010) · v10.94 (D116 · docs/151) */
export class AgentSwitchesDto {
  @ApiProperty({ description: 'agent.review_shadow.enabled' }) reviewShadow!: boolean;
  @ApiProperty({ description: 'agent.chat.enabled' }) chat!: boolean;
  @ApiProperty({ description: 'agent.chat.member_lookup.enabled' }) memberLookup!: boolean;
  @ApiProperty({ description: 'i18n.auto_translate.enabled — 등록 글 자동 번역(v10.104 · D118)' }) translate!: boolean;
  @ApiProperty({ description: 'i18n.board_on_view — 소개광장 볼 때 번역(v10.105 · D119)' }) board!: boolean;
}
export class AgentLimitsDto {
  @ApiProperty() guestDaily!: number;
  @ApiProperty() memberDaily!: number;
}
export class AgentChannelStateDto {
  @ApiProperty({ enum: ['REVIEW_SHADOW', 'SITE_CHAT'] }) channel!: string;
  @ApiProperty({ description: '지금 불러도 되는가(fn_agent_allowed)' }) ok!: boolean;
  @ApiPropertyOptional({ enum: ['AGENT_OFF', 'CHANNEL_OFF', 'CHANNEL_NOT_READY', 'CAP_ZERO', 'CAP_REACHED'] }) reason?: string;
}
export class AgentUsageRowDto {
  @ApiProperty() channel!: string;
  @ApiProperty() model!: string;
  @ApiProperty() requests!: number;
  @ApiProperty() inputTokens!: string;
  @ApiProperty() outputTokens!: string;
  @ApiProperty() costUsd!: string;
}
export class AgentPriceDto {
  @ApiProperty({ example: 'claude-sonnet-5-5' }) model!: string;
  @ApiProperty({ description: '입력 100만 토큰당 달러' }) inputPerM!: string;
  @ApiProperty() outputPerM!: string;
  @ApiProperty() cacheReadPerM!: string;
  @ApiProperty({ example: '2026-10-06' }) asOf!: string;
  @ApiPropertyOptional() note?: string;
}
export class AgentAgreementDto {
  @ApiProperty() model!: string;
  @ApiProperty() decided!: number;
  @ApiProperty() agreed!: number;
  @ApiProperty() unsure!: number;
  @ApiPropertyOptional({ description: '방향 일치 %(UNSURE 제외)' }) agreePct?: string;
}
export class AgentStatusDto {
  @ApiProperty({ description: 'agent.enabled' }) enabled!: boolean;
  @ApiProperty({ type: AgentSwitchesDto }) switches!: AgentSwitchesDto;
  @ApiProperty({ description: 'agent.monthly_cap_usd — 0 이면 아무것도 부르지 않음' }) capUsd!: string;
  @ApiProperty() monthCostUsd!: string;
  @ApiPropertyOptional() reviewModel?: string;
  @ApiPropertyOptional() chatModel?: string;
  @ApiPropertyOptional({ description: 'i18n.translate_model(v10.104)' }) translateModel?: string;
  @ApiProperty({ type: AgentLimitsDto }) limits!: AgentLimitsDto;
  @ApiProperty({ type: [AgentChannelStateDto] }) channels!: AgentChannelStateDto[];
  @ApiProperty({ type: [AgentUsageRowDto] }) usage!: AgentUsageRowDto[];
  @ApiProperty({ type: [AgentPriceDto] }) prices!: AgentPriceDto[];
  @ApiProperty({ type: [AgentAgreementDto] }) agreement!: AgentAgreementDto[];
  @ApiProperty() note!: string;
}

/* v10.109 (D121 · docs/170) — AI 상담 안내 */
export class ChatStatusDto {
  @ApiProperty({ description: '단추를 보일지 — 스위치 · AI 전체 · 월 상한 · 엔진이 모두 될 때만 true' }) enabled!: boolean;
  @ApiPropertyOptional({ nullable: true, description: '오늘 남은 횟수(켜져 있을 때만)' }) remaining!: number | null;
}
export class ChatAskDto {
  @ApiPropertyOptional({ description: '이어 묻는 상담 번호(처음이면 비움)' }) @IsOptional() @IsUUID() conversationId?: string;
  @ApiProperty({ maxLength: 500, description: '질문(500자까지) · 전화 · 이메일 · 링크는 가려 보내고 가린 글로 저장' }) @IsString() @MaxLength(500) message!: string;
}
export class ChatSourceDto {
  @ApiProperty() question!: string;
  @ApiPropertyOptional({ nullable: true }) linkHref!: string | null;
}
export class ChatAnswerDto {
  @ApiProperty() conversationId!: string;
  @ApiProperty({ description: '답(근거 밖이면 「모름」 + 넘기기 권함)' }) answer!: string;
  @ApiProperty({ description: '담당자에게 넘기기를 권하는가' }) handoff!: boolean;
  @ApiProperty({ type: [ChatSourceDto], description: '근거로 쓴 자주 묻는 질문(최대 3)' }) sources!: ChatSourceDto[];
  @ApiPropertyOptional({ nullable: true }) remaining!: number | null;
}
export class ChatHandoffDto {
  @ApiPropertyOptional({ description: '비회원은 필수 — 회신받을 이메일' }) @IsOptional() @IsString() @MaxLength(200) email?: string;
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class AgentChatRowDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['OPEN', 'HANDED_OFF', 'CLOSED'] }) status!: string;
  @ApiProperty({ description: '회원 상담인가(아니면 비회원)' }) member!: boolean;
  @ApiPropertyOptional({ nullable: true, description: '넘긴 1:1 문의 번호' }) inquiryId!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time', description: '보관 기한(이 뒤 배치가 지움)' }) purgeAfter!: string;
  @ApiProperty() turns!: number;
  @ApiPropertyOptional({ nullable: true, description: '첫 질문 앞부분(연락처는 가려 저장됨)' }) firstQuestion!: string | null;
}
export class AgentChatMessageDto {
  @ApiProperty({ enum: ['user', 'assistant', 'tool'] }) role!: string;
  @ApiProperty() body!: string;
  @ApiPropertyOptional({ nullable: true }) model!: string | null;
  @ApiPropertyOptional({ nullable: true }) stopReason!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class ChatHandoffOkDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ description: '접수된 1:1 문의 번호' }) inquiryId!: string;
}

@ApiTags('AGENT')
@Controller('api/v1')
export class AgentController {
  constructor(private readonly svc: AgentService, private readonly chats: AgentChatService) {}

  @Get('agent/chat/status')
  @ApiOperation({ summary: 'AI 상담 단추 상태 (v10.109)', description: '꺼져 있으면 enabled false — 사이트는 단추를 그리지 않습니다.' })
  @ApiHeader({ name: 'X-Visitor-Key', required: false, description: '비회원 — 사이트 방문자 쿠키(sgb_visitor) 값(남은 횟수)' })
  @ApiOkResponse({ type: ChatStatusDto })
  chatStatus(@Headers('x-visitor-key') visitorKey?: string) { return this.chats.status(visitorKey); }

  @Post('agent/chat')
  @ApiOperation({ summary: 'AI 상담 — 묻기 (v10.109 · 2단계 안내)', description: '자주 묻는 질문 · 공지 · 약관 발행본만 근거로 답합니다. 내 정보 · 남의 정보를 조회하지 않습니다. 스위치 agent.chat.enabled · AI 전체 · 월 상한 · 하루 횟수(회원 · 방문자 · 비회원 전체). 돈 · 분쟁 · 개인 사정 · 법률 판단은 넘기기를 권합니다.' })
  @ApiHeader({ name: 'X-Visitor-Key', required: false, description: '비회원 — 사이트 방문자 쿠키 값(하루 횟수 · 내 상담 확인)' })
  @ApiOkResponse({ type: ChatAnswerDto })
  @ApiResponse({ status: 404, type: ErrorDto }) @ApiResponse({ status: 409, type: ErrorDto }) @ApiResponse({ status: 422, type: ErrorDto })
  chat(@Body() dto: ChatAskDto, @Headers('x-visitor-key') visitorKey?: string) { return this.chats.chat(dto, visitorKey); }

  @Post('agent/chat/:id/handoff')
  @ApiOperation({ summary: 'AI 상담 — 담당자에게 넘기기 (v10.109)', description: '1:1 문의(channel BOT)로 접수하고 상담 기록(연락처 가림)을 붙입니다 · 운영 경보. AI 를 부르지 않습니다.' })
  @ApiHeader({ name: 'X-Visitor-Key', required: false })
  @ApiOkResponse({ type: ChatHandoffOkDto })
  @ApiResponse({ status: 404, type: ErrorDto }) @ApiResponse({ status: 409, type: ErrorDto }) @ApiResponse({ status: 422, type: ErrorDto })
  handoff(@Param('id') id: string, @Body() dto: ChatHandoffDto, @Headers('x-visitor-key') visitorKey?: string) { return this.chats.handoff(id, dto, visitorKey); }

  @ApiBearerAuth()
  @Get('admin/agent/chats')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: 'AI 상담 목록 (운영 · 읽기만 · v10.109)' })
  @ApiQuery({ name: 'status', required: false, enum: ['OPEN', 'HANDED_OFF', 'CLOSED'] })
  @ApiOkResponse({ type: [AgentChatRowDto] })
  chatList(@Query('status') status?: string) { return this.chats.adminList(status); }

  @ApiBearerAuth()
  @Get('admin/agent/chats/:id')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: 'AI 상담 대화 (운영 · 읽기만 · 연락처는 가려 저장됨)' })
  @ApiOkResponse({ type: [AgentChatMessageDto] })
  @ApiResponse({ status: 404, type: ErrorDto })
  chatMessages(@Param('id') id: string) { return this.chats.adminMessages(id); }

  @ApiBearerAuth()
  @Get('admin/agent/status')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: 'AI 에이전트 상태 (운영)', description: '스위치 · 월 상한 · 이번 달 비용 · 통로별 사용량 · 요금표 · AI 검수 일치율. 바꾸는 것은 정책(site_settings)에서 합니다.' })
  @ApiOkResponse({ type: AgentStatusDto })
  status() { return this.svc.status(); }
}
