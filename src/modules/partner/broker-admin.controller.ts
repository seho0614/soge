import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BrokerService } from './broker.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { BrokerDecideDto, PartnerOkDto } from './partner.dto';

/** SB-ADM-BRK-010 · 011 중개사 인증 심사 (INV-BR1) */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/brokers')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class BrokerAdminController {
  constructor(private readonly svc: BrokerService) {}

  @Get()
  @ApiOperation({
    summary: '중개사 인증 신청 목록',
    description:
      '`POST /partner/broker` 로 들어온 신청입니다. 기본은 심사 대기(SUBMITTED · PENDING). ' +
      '대표자 일치 여부와 대기 중인 부동산 매물 수를 함께 냅니다.',
  })
  @ApiQuery({ name: 'state', required: false, enum: ['PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED', 'ALL'] })
  @ApiQuery({ name: 'q', required: false, description: '찾기 — 상호 · 사무소 · 대표 · 이메일 · 사업자번호 · 등록번호 (G-207)' })
  @ApiQuery({ name: 'order', required: false, enum: ['old', 'recent'], description: '심사 대기의 기본은 old(오래된 순) · 그 밖은 recent' })
  @ApiQuery({ name: 'page', required: false }) @ApiQuery({ name: 'size', required: false, description: '1 ~ 100 · 기본 50' })
  @ApiOkResponse({ type: PartnerOkDto })
  list(@Query('state') state?: string, @Query('q') q?: string, @Query('order') order?: string,
       @Query('page') page?: string, @Query('size') size?: string) {
    return this.svc.list(state, { q, order, page: page ? Number(page) : undefined, size: size ? Number(size) : undefined });
  }

  /* v10.32 — SB-ADM-BRK-011 시안 세 칸 중 「보증 · 서류」(읽기 전용). 신청 때 받은 보증(공제) 기관 · 금액 · 기간 · 제출 서류 종류 */
  @Get(':id/evidence')
  @ApiOperation({ summary: '중개사 인증 — 보증 · 서류 (v10.32 · 읽기 전용)', description: '신청 때 받은 보증(공제) 기관 · 증서 번호 · 금액 · 기간 · 제출 서류 종류(REG_CERT · GUARANTEE · LICENSE · ETC) · 첨부 수.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: PartnerOkDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  evidence(@Param('id') id: string) { return this.svc.evidence(id); }

  @Get(':id')
  @ApiOperation({ summary: '중개사 인증 신청 상세' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: PartnerOkDto })
  @ApiResponse({ status: 404, description: 'NOT_FOUND', type: ErrorDto })
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post(':id/lookup')
  @ApiOperation({
    summary: '국토부 다시 조회 (D008)',
    description:
      '심사 대기 건을 국토부 중개사무소 조회와 다시 맞춰 봅니다(BROKER_LOOKUP_URL · KEY 설정 시). ' +
      '조회 실패면 기존 결과를 지우지 않고 사유만 남깁니다. 설정이 없으면 422 LOOKUP_NOT_CONFIGURED.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: PartnerOkDto })
  @ApiResponse({ status: 409, description: 'NOT_PENDING', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'LOOKUP_NOT_CONFIGURED', type: ErrorDto })
  @Audit('BROKER_LOOKUP', 'BUSINESS')
  lookup(@Param('id') id: string) { return this.svc.relookup(id); }

  @Post(':id/decide')
  @ApiOperation({
    summary: '중개사 인증 승인 · 반려',
    description:
      '**승인하면 그 사업자의 부동산 매물 공개가 열립니다**(fn_broker_gate). ' +
      '국토부 대조가 MATCH 가 아니면 DB 가 승인을 막고, 반려에는 사유가 필요합니다. ' +
      '승인되면 180일 뒤 재확인 기한이 붙습니다.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: PartnerOkDto })
  @ApiResponse({ status: 409, description: 'NOT_PENDING', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'REASON_REQUIRED · BROKER', type: ErrorDto })
  @Audit('BROKER_DECIDE', 'BUSINESS')
  decide(@Param('id') id: string, @Body() dto: BrokerDecideDto) {
    return this.svc.decide(id, dto.state, dto.reason);
  }
}
