import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DealService } from './deal.service';
import { DealContractService } from './deal-contract.service';
import {
  ContractDto, ConversationDto, DealDto, FeeAgreementDto, IssueContractDto,
  MessageDto, ProposeFeeDto, ReportPaymentDto, SendMessageDto, SignResultDto,
  StartConversationDto, AgreeContractDto, CounterContractDto, DraftContractDto,
  CancelContractDto, ContractStateDto } from './deal.dto';
import { ErrorDto } from '../../common/dto/common.dto';
import { RequireGate, Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/** SB-HOM-MCH-010 · SB-HOM-DEL-010/020/030 · SB-MYP-DEA-010 */
@ApiTags('HOM')
@ApiBearerAuth()
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
@ApiResponse({ status: 403, description: '권한 없음 · 게이트 미충족', type: ErrorDto })
@Controller('api/v1')
export class DealController {
  constructor(private readonly service: DealService, private readonly contracts: DealContractService) {}   // v10.92 — 계약서는 DealContractService

  @Post('conversations')
  /* 개인회원도 문의는 할 수 있습니다(결정 ⑤).
   *
   * 전에는 BIZ_OWNER·BIZ_STAFF 전용이라 **개인은 문의조차 못 했습니다.**
   * 요청 등록과 소개 참여가 개인에게 열려 있는데 문의만 막으면,
   * 관심 있는 건을 보고도 물어볼 수가 없습니다.
   *
   * 사업자 인증은 판매 등록에만 필요합니다 — 문의에는 본인인증이면
   * 충분합니다. 연락처 마스킹은 그대로 걸립니다. */
  @Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '1:1 문의 시작',
    description:
      '**이 모델의 급소입니다.** 대화가 플랫폼 밖으로 나가면 소개가 누구의 실적인지 남지 않습니다. ' +
      '메시지에 연락처가 있으면 마스킹되고 `masked: true` 가 옵니다.',
  })
  @ApiResponse({ status: 422, description: 'OWN_TARGET — 본인 게시물', type: ErrorDto })
  @Audit('CONVERSATION_START', 'CONVERSATION')
  start(@Body() dto: StartConversationDto) { return this.service.startConversation(dto); }

  @Get('conversations/:id/messages')
  @Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
  @ApiOperation({ summary: '메시지 목록' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MessageDto, isArray: true })
  messages(@Param('id') id: string, @Query('limit') limit?: number) {
    return this.service.messages(id, limit);
  }

  @Post('conversations/:id/messages')
  @Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
  @ApiOperation({ summary: '메시지 보내기' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MessageDto })
  send(@Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.service.send(id, dto);
  }

  @Post('conversations/:id/deal')
  /* v10.37 (D095 · 10/13 대표 지시) — 모든 업무는 개인 회원(본인인증)도 합니다. 사업자만은 안심소개 · 소개몰 · 소개창업 등록뿐 */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: 'Deal 생성',
    description:
      '귀속 후보 코드를 스냅샷합니다. 최종 판정은 성사 확정 시점에 DB 가 first-touch 로 확정합니다 (INV-2). ' +
      'tier 는 항상 1 입니다 (INV-1).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DealDto })
  @Audit('DEAL_CREATE', 'DEAL')
  createDeal(@Param('id') id: string) { return this.service.createDeal(id); }


  @Post('deals/:id/fee')
  @ApiBearerAuth()
  /* v10.37 (D095 · 10/13 대표 지시) — 모든 업무는 개인 회원(본인인증)도 합니다. 사업자만은 안심소개 · 소개몰 · 소개창업 등록뿐 */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '소개비 제안',
    description:
      '제안은 append-only 로 쌓입니다 — 수정하지 않습니다. ' +
      '2차 제안부터 사유 코드가 필수인데, **왜 바꾸는지가 분쟁의 근거**가 되기 때문입니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 422, description: 'REASON_REQUIRED — 2차 제안부터 사유 필수', type: ErrorDto })
  @Audit('FEE_PROPOSE', 'DEAL')
  propose(@Param('id') id: string, @Body() dto: ProposeFeeDto) {
    return this.service.proposeFee(id, dto);
  }

  /* ★ 2026-10-01 결정(Q2) — 개인 회원도 거래 당사자로 확정·동의·대금 신고를 합니다.
   *   사업자 인증 대신 **본인인증**을 봅니다. 당사자 여부는 서비스가 확인합니다.
   *   v10.28 — 소개비 **수령**(정산)도 본인인증 개인이 합니다(INV-10R · 받을 계좌 확인). 거래 만들기 · 소개비 제시 · 계약서 발급은 사업자 그대로.
   *   → v10.37 (D095) 부터 거래 만들기 · 소개비 제시 · 계약서 발급도 본인인증 개인이 합니다. */
  @Post('deals/:id/confirm')
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '성사 확정 (수동)',
    description:
      '보통은 계약 양측 서명으로 자동 확정됩니다 (A-15). ' +
      '이 API 는 계약서 없이 진행한 거래의 수동 경로입니다. ' +
      '**양측 확인이 모이면 그 자리에서 CONFIRMED 가 됩니다** (INV-4 · C997). ' +
      '개인 회원도 본인인증 후 확인할 수 있습니다(2026-10-01 결정).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 422, description: 'INV-4 — 상대방 확인이 필요합니다', type: ErrorDto })
  @Audit('DEAL_CONFIRM', 'DEAL')
  confirm(@Param('id') id: string) {
    return this.service.confirmDeal(id);
  }

  @Post('deals/:id/fee/:version/agree')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')   // Q2 — 개인 당사자도 동의
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({ summary: '소개비 동의', description: '양측이 동의하면 상태가 AGREED 로 바뀝니다.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'version', example: 1 })
  @ApiOkResponse({ type: FeeAgreementDto })
  agreeFee(@Param('id') id: string, @Param('version') v: string) {
    return this.service.agreeFee(id, Number(v));
  }

  @Post('deals/:id/contract')
  /* v10.37 (D095 · 10/13 대표 지시) — 모든 업무는 개인 회원(본인인증)도 합니다. 사업자만은 안심소개 · 소개몰 · 소개창업 등록뿐 */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '계약서 발급',
    description:
      '**발급 시점에 합의 금액이 LOCKED 로 고정됩니다.** 금액이 계약서에 인쇄되는 순간이 잠금점입니다. ' +
      '양측 합의가 없으면 발급이 거부됩니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ContractDto })
  @ApiResponse({ status: 422, description: '합의된 소개비 없음', type: ErrorDto })
  @Audit('CONTRACT_ISSUE', 'DEAL')
  contract(@Param('id') id: string, @Body() dto: IssueContractDto) {
    return this.service.issueContract(id, dto.templateCode);
  }

  @Post('deals/:id/contract/sign')
  /* 계약 당사자면 서명할 수 있어야 합니다.
   *
   * BIZ_OWNER 전용이라 **매수자가 개인이거나 직원이면 서명을 못 했습니다.**
   * 양측이 각각 서명해야 넘어가는 구조인데 한쪽이 못 누르면 계약이
   * 영영 안 끝납니다.
   *
   * 당사자 확인은 서비스(sideOf)가 합니다 — 남의 계약에는 못 들어갑니다. */
  @Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '계약서 서명',
    description:
      '**양측 서명이 끝나면 성사가 자동 확정되고 정산이 자동 신청됩니다 (A-15).** ' +
      '소개자의 별도 신고 행위가 없습니다. 소개자가 개인이면 정산 대신 사업자 전환 안내가 발송됩니다 (INV-10).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SignResultDto })
  @ApiResponse({
    status: 422, type: ErrorDto,
    description: 'INV_2 — 귀속 근거가 없으면 소개자를 지정한 채로 확정할 수 없습니다',
  })
  @Audit('CONTRACT_SIGN', 'DEAL')
  /* signContract2 가 상태 전이까지 합니다 —
     기존 sign() 은 서명 시각만 찍고 AGREED→SIGNED 로 넘기지 않았습니다. */
  sign(@Param('id') id: string) { return this.contracts.signContract2(id); }

  @Post('deals/:id/payment-report')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')   // Q2 — 개인 당사자도 신고
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '대금 지급 신고',
    description:
      '**금액도 계좌도 받지 않습니다 (INV-11).** 플랫폼은 자금을 수탁하지 않으므로 ' +
      '당사자 직접 결제 사실과 증빙만 기록합니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @Audit('PAYMENT_REPORT', 'DEAL')
  reportPayment(@Param('id') id: string, @Body() dto: ReportPaymentDto) {
    return this.service.reportPayment(id, dto);
  }

  /* ── 계약 진행 ────────────────────────────────────────────────────
   * 플랫폼은 계약 당사자가 아닙니다. 양식을 주고 어디까지 왔는지
   * 기록할 뿐이며, 대금에도 관여하지 않습니다(INV-11).
   * 합의·서명·이행 모두 **양측이 각각** 눌러야 넘어갑니다. */

  @Get('deals/:id/contract/state')
  @Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
  @ApiOperation({ summary: '계약 진행 상태',
    description: '양측이 각각 어디까지 했는지 봅니다. stalled 는 3일 넘게 멈춘 건입니다.' })
  @ApiOkResponse({ type: ContractStateDto })
  contractState(@Param('id') id: string) { return this.contracts.contractState(id); }

  @Post('deals/:id/contract/agree')
  @Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
  @ApiOperation({ summary: '조건 합의',
    description:
      '**조건을 바꾸면 상대의 합의는 무효가 됩니다.** 그러지 않으면 한쪽이 ' +
      '금액을 고쳐도 상대 동의가 남아 있게 됩니다.' })
  @ApiOkResponse({ type: ContractStateDto })
  @Audit('CONTRACT_AGREE', 'CONTRACT')
  agree(@Param('id') id: string, @Body() dto: AgreeContractDto) {
    return this.contracts.agreeContract(id, dto.terms);
  }

  @Post('deals/:id/contract/draft')
  @Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
  @ApiOperation({ summary: '계약 조건 임시 저장 (v10.31 · 시안 「임시 저장」)',
    description: '보내지 않고 내 쪽에만 남깁니다 — 상대의 합의에 영향이 없고, 저장한 사람에게만 보입니다. 「서명 요청 보내기」(조건 합의)를 누르면 지워집니다.' })
  @Audit('CONTRACT_DRAFT', 'CONTRACT')
  draft(@Param('id') id: string, @Body() dto: DraftContractDto) {
    return this.contracts.saveContractDraft(id, dto.terms);
  }

  @Post('deals/:id/contract/nudge')
  @Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
  @ApiOperation({ summary: '계약 확인 요청 (v10.31 · 시안 계약 진행 「확인 요청」)',
    description: '상대 차례인 계약에 상대에게 알림(CONTRACT_NUDGE · 수신거부 불가)을 보냅니다. 하루 한 번(409 NUDGED_TODAY) · 내 차례면 409 NOT_THEIR_TURN.' })
  @Audit('CONTRACT_NUDGE', 'CONTRACT')
  nudge(@Param('id') id: string) { return this.contracts.nudgeContract(id); }

  @Post('deals/:id/contract/counter')
  @Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
  @ApiOperation({ summary: '수정 요청',
    description: '무엇을 고쳐야 하는지 남아야 상대가 움직일 수 있습니다.' })
  @Audit('CONTRACT_COUNTER', 'CONTRACT')
  counter(@Param('id') id: string, @Body() dto: CounterContractDto) {
    return this.contracts.counterContract(id, dto.memo, dto.terms);
  }

  @Post('deals/:id/contract/fulfil')
  @Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
  @ApiOperation({ summary: '이행 확인',
    description:
      '양측이 확인하면 거래가 성사로 확정됩니다. ' +
      '**소개비는 여기서 공제하지 않습니다**(INV-9R) — 지급 대상이 될 뿐이고, ' +
      '대금은 당사자끼리 직접 주고받습니다.' })
  @Audit('CONTRACT_FULFIL', 'CONTRACT')
  fulfil(@Param('id') id: string) {
    return this.contracts.fulfilContract(id);
  }

  @Post('deals/:id/contract/cancel')
  @Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
  @ApiOperation({ summary: '계약 파기' })
  @Audit('CONTRACT_CANCEL', 'CONTRACT')
  cancel(@Param('id') id: string, @Body() dto: CancelContractDto) {
    return this.contracts.cancelContract(id, dto.reason);
  }

  @Get('deals/:id/contract/history')
  @Roles('MEMBER','BIZ_OWNER','BIZ_STAFF')
  @ApiOperation({ summary: '계약 이력',
    description: '분쟁에서 "누가 언제 무엇을 했는가"의 근거입니다. 수정·삭제되지 않습니다.' })
  history(@Param('id') id: string) { return this.contracts.contractHistory(id); }
  /* ── 전자계약 ─────────────────────────────────────────────────── */

  @Get('contract-templates')
  @ApiOperation({
    summary: '표준계약서 양식',
    description:
      '**자유 양식을 쓰면 분쟁 때 판단 근거가 없습니다** — 소개비 귀속 · ' +
      '성사 시점 · 해지 조건이 계약마다 달라집니다.',
  })
  @ApiOkResponse({ type: Object, isArray: true })
  contractTemplates() { return this.contracts.contractTemplates(); }

  @Get('contract-templates/:code')
  @ApiOperation({ summary: '양식 본문', description: '서명 전에 무엇에 동의하시는지 보십시오.' })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: Object })
  contractTemplate(@Param('code') code: string) { return this.contracts.contractTemplate(code); }

  @Post('deals/:id/contract/esign')
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '전자계약 서명 요청',
    description:
      '표준계약서를 전자계약으로 보냅니다.\n\n' +
      '**서명 시각과 서명자를 제공자가 증명합니다** — 우리가 직접 ' +
      '타임스탬프를 찍으면 우리가 만든 기록이라 분쟁에서 약합니다.\n\n' +
      '연동 전에는 `stub: true` 로 내려갑니다 — 법적 효력이 없습니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 422, description: '계약 상태 불일치', type: ErrorDto })
  @ApiOkResponse({ type: Object })
  @Audit('CONTRACT_ESIGN', 'DEAL')
  requestESign(@Param('id') id: string) { return this.contracts.requestESign(id); }

  @Get('deals/:id/contract/esign')
  @ApiBearerAuth()
  /* 서명 상태는 **당사자만** 봅니다 — 남의 계약이 어디까지 갔는지
     알 이유가 없습니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '전자계약 서명 상태',
    description: '**스텁이면 그 사실을 함께 내려보냅니다** — 화면이 표시해야 합니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  esignStatus(@Param('id') id: string) { return this.contracts.esignStatus(id); }

}
