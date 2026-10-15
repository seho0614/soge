import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LeadService } from './lead.service';
import {
  LeadAssignDto, LeadCloseDto, LeadOkDto,
  LeadReassignDto, LEAD_QUEUE_STATES,
} from './lead.dto';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/**
 * SB-MAL-CSL-010 상담 신청 (안심소개 「생활·금융 상담」 축 · D005 → D008 → D018)
 *
 * 업종 목록 · 신청 · 휴대폰 확인은 로그인 없이 받습니다(partner/consult.controller.ts —
 * GET /consult/categories · POST /consult/requests). v10.8 의 GET /categories/consult 는 그쪽으로 합쳤습니다.
 * 여기는 회원 쪽에 남는 것입니다 — 「내 상담 신청」.
 * 연락처는 pii 스키마에 암호화해 두고, 열람한 업체에만 풀립니다.
 */
@ApiTags('MAL')
@Controller('api/v1')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
export class MyConsultController {
  constructor(private readonly svc: LeadService) {}

  @Get('me/consult-requests')
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '내 상담 신청',
    description: '로그인한 채 낸 상담 신청입니다. 배정 상태와 **연락처를 받아 간 업체(열람한 업체)** 를 보여 줍니다 — 제3자 제공 내역입니다. '
      + '받을 업체가 없어 전달되지 않은 신청(NO_PARTNER)도 함께 보입니다.',
  })
  @ApiOkResponse({ type: LeadOkDto, isArray: true })
  mine() { return this.svc.mine(); }
}

/** SB-ADM-PTN-090 리드 배정 */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/leads')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class LeadAdminController {
  constructor(private readonly svc: LeadService) {}

  @Get()
  @ApiOperation({
    summary: '리드 배정 대기열',
    description:
      '기본(QUEUE)은 대기(OPEN) · 미배정(UNMATCHED). 건마다 배정 현황(deliveries)과 지금 보낼 수 있는 업체 수(eligibleCount)를 냅니다. ' +
      'settings 에 목표 수 · 최대 수 · 열람 기한 · 등급 가중치가 함께 옵니다.',
  })
  @ApiQuery({ name: 'state', required: false, enum: LEAD_QUEUE_STATES })
  @ApiOkResponse({ type: LeadOkDto })
  @ApiResponse({ status: 422, description: 'BAD_STATE', type: ErrorDto })
  list(@Query('state') state?: string) { return this.svc.admList(state); }

  @Post('run')
  @ApiOperation({
    summary: '지금 배정 돌리기',
    description: '배치(lead_assign)와 같은 함수(fn_lead_assign_tick)입니다 — 만료 · 회수 · 빈자리 배정 · 미배정 전환. 여러 번 불러도 안전합니다.',
  })
  @ApiOkResponse({ type: LeadOkDto })
  @ApiResponse({ status: 409, description: '해당 없음', type: ErrorDto })
  @ApiResponse({ status: 422, description: '해당 없음', type: ErrorDto })
  @Audit('LEAD_ASSIGN_RUN', 'LEAD')
  run() { return this.svc.admRunNow(); }

  @Get(':id')
  @ApiOperation({
    summary: '리드 배정 상세 · 후보',
    description: '후보 업체 전체와 탈락 사유(활동 · 서비스 · 자격 · 지역 · 미납 한도 · 이미 배정 · 신청자 본인 업체), 순번 점수(score 작을수록 먼저)입니다.',
  })
  @ApiParam({ name: 'id', description: 'leadId' })
  @ApiOkResponse({ type: LeadOkDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  get(@Param('id') id: string) { return this.svc.admGet(id); }

  @Post(':id/assign')
  @ApiOperation({
    summary: '수동 배정',
    description:
      'partnerIds 를 주면 그 업체에, 없으면 후보 순서대로 빈자리만큼(또는 count) 보냅니다. 조건 밖 업체가 하나라도 있으면 전부 거부합니다(422 LEAD_ASSIGN · 사유). ' +
      '한 신청 최대 업체 수(lead.assign.max_partners)를 넘지 못합니다.',
  })
  @ApiParam({ name: 'id', description: 'leadId' })
  @ApiOkResponse({ type: LeadOkDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiResponse({ status: 409, description: '중복 배정(DUPLICATE)', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LEAD_ASSIGN · LEAD_GATED · NO_CANDIDATE', type: ErrorDto })
  @Audit('LEAD_ASSIGN', 'LEAD')
  assign(@Param('id') id: string, @Body() dto: LeadAssignDto) { return this.svc.admAssign(id, dto); }

  @Post(':id/reassign')
  @ApiOperation({
    summary: '재배정 (거두고 다시 보냄)',
    description:
      '아직 열람하지 않은 배정만 거둘 수 있습니다 — 열람한 배정은 연락처가 넘어갔고 이용료가 생겨 409 ALREADY_VIEWED. ' +
      '거둔 업체에 사유가 알림으로 갑니다. partnerIds 가 없으면 거둔 수만큼 자동으로 고릅니다.',
  })
  @ApiParam({ name: 'id', description: 'leadId' })
  @ApiOkResponse({ type: LeadOkDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'ALREADY_VIEWED · NOT_ACTIVE · NO_SUCH_DELIVERY · CLOSED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LEAD_ASSIGN · REASON_REQUIRED', type: ErrorDto })
  @Audit('LEAD_REASSIGN', 'LEAD')
  reassign(@Param('id') id: string, @Body() dto: LeadReassignDto) { return this.svc.admReassign(id, dto); }

  @Post(':id/close')
  @ApiOperation({
    summary: '상담 신청 종료',
    description: '장난 · 중복 신청 등. 아직 열지 않은 배정은 함께 거둡니다. 이미 열람한 업체의 이용료는 그대로입니다.',
  })
  @ApiParam({ name: 'id', description: 'leadId' })
  @ApiOkResponse({ type: LeadOkDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'ALREADY_CLOSED', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'REASON_REQUIRED', type: ErrorDto })
  @Audit('LEAD_CLOSE', 'LEAD')
  close(@Param('id') id: string, @Body() dto: LeadCloseDto) { return this.svc.admClose(id, dto.reason); }
}
