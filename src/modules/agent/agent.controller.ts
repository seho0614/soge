import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
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

@ApiTags('AGENT')
@Controller('api/v1')
export class AgentController {
  constructor(private readonly svc: AgentService) {}

  @ApiBearerAuth()
  @Get('admin/agent/status')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: 'AI 에이전트 상태 (운영)', description: '스위치 · 월 상한 · 이번 달 비용 · 통로별 사용량 · 요금표 · AI 검수 일치율. 바꾸는 것은 정책(site_settings)에서 합니다.' })
  @ApiOkResponse({ type: AgentStatusDto })
  status() { return this.svc.status(); }
}
