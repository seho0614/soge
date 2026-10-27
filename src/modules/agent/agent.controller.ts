import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AgentChatService } from './agent-chat.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { AgentService } from './agent.service';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

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
  @ApiPropertyOptional({ nullable: true, enum: ['CLAUDE', 'MOCK'], description: 'v10.111 — 지금 엔진(없으면 null = 아무것도 부르지 않음)' }) engine!: string | null;
  @ApiProperty({ enum: ['ADMIN', 'ENV', 'MOCK', 'NONE'], description: 'v10.111 — 키가 어디서 왔나(운영 화면 · .env · 시험 엔진 · 없음). 키 값은 없음' }) keySource!: string;
  @ApiProperty() note!: string;
}

/* v10.111 (D122 · docs/173) — AI 키(운영 화면 · SUPER) — 날씨 키와 같은 방식 */
export class AgentKeyStateDto {
  @ApiProperty({ enum: ['ANTHROPIC_API_KEY'] }) name!: string;
  @ApiProperty({ enum: ['ADMIN', 'ENV', 'MOCK', 'NONE'], description: 'ADMIN = 운영 화면에서 넣음 · ENV = .env · MOCK = 시험 엔진(.env) · NONE = 없음' }) source!: string;
  @ApiPropertyOptional({ nullable: true, enum: ['CLAUDE', 'MOCK'], description: '지금 엔진(없으면 null)' }) engine!: string | null;
  @ApiProperty({ description: '운영 화면에 저장된 키가 있나(시험 엔진일 때도 저장은 되어 있을 수 있음)' }) saved!: boolean;
  @ApiProperty({ description: '저장한 키를 읽지 못해(암호 열쇠 등) 쓰지 않는 중 — .env 키 또는 엔진 없음' }) unreadable!: boolean;
  @ApiPropertyOptional({ nullable: true, example: '••••••ab12' }) masked!: string | null;
  @ApiPropertyOptional({ nullable: true }) updatedAt!: Date | null;
}
export class AgentKeySetDto {
  @ApiProperty({ minLength: 30, maxLength: 300, description: 'Anthropic 콘솔 › API Keys 에서 만든 키(sk-ant-api…)' })
  @IsString() @MinLength(30) @MaxLength(300) value!: string;
}
export class AgentKeyTestDto {
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ nullable: true, description: 'AUTH · PERMISSION · RATE · TIMEOUT · NETWORK · UPSTREAM' }) kind!: string | null;
  @ApiProperty() message!: string;
  @ApiProperty({ type: [String], description: '쓸 수 있는 모델 이름(앞 20개)' }) models!: string[];
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
/* v10.131 (D129 · docs/197) — AI 상담 「답 · 넘김 비율」 */
export class AgentChatStatsDto {
  @ApiProperty({ enum: [7, 14, 30] }) days!: number;
  @ApiProperty({ description: '손님 질문 수' }) questions!: number;
  @ApiProperty({ description: 'AI 답 수' }) answers!: number;
  @ApiProperty({ description: '넘기기를 권하지 않고 답한 수' }) answered!: number;
  @ApiProperty({ description: '담당자에게 넘기기를 권한 수(AI 판단 · 거절 · 잘림 · 모양 틀림 · 금칙어)' }) handoffSuggested!: number;
  @ApiProperty({ description: '그중 AI 가 스스로 권함' }) byAi!: number;
  @ApiProperty() refusal!: number;
  @ApiProperty() cut!: number;
  @ApiProperty() badShape!: number;
  @ApiProperty() banned!: number;
  @ApiProperty({ description: '넘김 여부 기록 전(v10.131 전 답)' }) unknown!: number;
  @ApiProperty() conversations!: number;
  @ApiProperty({ description: '손님이 실제로 담당자에게 넘긴 상담 수' }) handedOff!: number;
  @ApiPropertyOptional({ nullable: true, description: '답 비율 %(기록된 답 중)' }) answeredPct!: number | null;
  @ApiPropertyOptional({ nullable: true, description: '넘김 권함 비율 %' }) handoffPct!: number | null;
  @ApiPropertyOptional({ nullable: true, description: '실제 넘긴 상담 비율 %' }) handedOffPct!: number | null;
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
  @Get('admin/agent/chats/stats')   // ★ :id 보다 먼저(주소가 겹침)
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: 'AI 상담 답 · 넘김 비율 (운영 · v10.131)', description: '최근 7 · 14 · 30일 숫자만 — 글 · 손님 정보 없음. 운영 1주 결과 판단용(결정 기록 ai-agent #20).' })
  @ApiQuery({ name: 'days', required: false, enum: [7, 14, 30] })
  @ApiOkResponse({ type: AgentChatStatsDto })
  chatStats(@Query('days') days?: string) { return this.chats.adminStats(Number(days) || 7); }

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

  /* v10.111 — AI 키(SUPER) · 감사 기록은 응답을 남김 — 응답에는 끝 4자리만 있어 키 값이 감사 기록에 들어가지 않습니다 */
  @ApiBearerAuth()
  @Get('admin/agent/key')
  @Roles('SUPER')
  @ApiOperation({ summary: 'AI 키 상태 (v10.111)', description: '키 값은 내보내지 않습니다 — 끝 4자리와 어디서 왔는지(운영 화면 · .env · 시험 엔진 · 없음) · 지금 엔진만.' })
  @ApiOkResponse({ type: AgentKeyStateDto })
  keyView() { return this.svc.keyView(); }

  @ApiBearerAuth()
  @Put('admin/agent/key')
  @Roles('SUPER')
  @ApiOperation({ summary: 'AI 키 넣기 (v10.111)', description: '암호화해 저장합니다(카카오맵 · 날씨 키와 같은 열쇠). 넣은 뒤에는 다시 볼 수 없습니다 — 끝 4자리만. 1분 안에 모든 통로가 새 키로(재시작 없음). AI 를 켜지는 않습니다(스위치 · 월 상한은 그대로).' })
  @ApiOkResponse({ type: AgentKeyStateDto })
  @ApiResponse({ status: 422, description: 'INTEG_SECRET_FORMAT — 키 형식이 아님(sk-ant-api 로 시작해야 함)', type: ErrorDto })
  @Audit('AGENT_KEY_SET', 'INTEGRATION')
  setKey(@Body() dto: AgentKeySetDto) { return this.svc.setKey(dto.value); }

  @ApiBearerAuth()
  @Delete('admin/agent/key')
  @Roles('SUPER')
  @ApiOperation({ summary: 'AI 키 지우기 (v10.111)', description: '지우면 .env 키를 쓰고, 그것도 없으면 아무것도 부르지 않습니다.' })
  @ApiOkResponse({ type: AgentKeyStateDto })
  @Audit('AGENT_KEY_CLEAR', 'INTEGRATION')
  clearKey() { return this.svc.clearKey(); }

  @ApiBearerAuth()
  @Post('admin/agent/key/test')
  @Roles('SUPER')
  @ApiOperation({ summary: 'AI 키 확인 (v10.111)', description: 'Anthropic 모델 목록을 한 번 읽어 키를 확인합니다 — 토큰을 쓰지 않아 비용이 없고 월 상한과 무관합니다. 키 값은 응답에 없습니다.' })
  @ApiOkResponse({ type: AgentKeyTestDto })
  @ApiResponse({ status: 422, description: 'AGENT_KEY_MISSING — 키 없음', type: ErrorDto })
  testKey() { return this.svc.testKey(); }
}
