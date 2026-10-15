import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';
import { AdminService } from './admin.service';
import {
  AuditSampleDto, BadgeRequestDto, CodeLabelDto, DisputeAdminDto, DisputeSummaryDto,
  ResolveDisputeDto, UpdateCodeLabelDto,
} from './admin.dto';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

export class RecordAuditDto {
  @ApiProperty({ description: '자동 승인이 옳았는지' })
  @StrictBoolean() correct!: boolean;
  @ApiProperty({ required: false, description: '부적정 사유' })
  @IsOptional() @IsString() memo?: string;
}

/** SB-ADM-BDG-010 · DSP-010 · REV-040 · COD-010 */
@ApiTags('ADM')

/* 20260930 — 자동검수 규칙 화면(SB-ADM-REV-030)이 부르는데 서버에 없던 두 API 의 응답 */
export class ReasonStatDto {
  @ApiProperty({ example: 'HIGH_FEE', description: '사람에게 넘긴 사유' }) reason!: string;
  @ApiProperty({ example: 12 }) cnt!: number;
}
export class AutoRateDto {
  @ApiProperty({ example: '2026-09-30' }) day!: string;
  @ApiProperty({ example: 62.5, nullable: true }) autoRatePct!: number | null;
  @ApiProperty() submitted!: number;
  @ApiProperty() autoApproved!: number;
  @ApiProperty() manualQueue!: number;
}

@ApiBearerAuth()
@Controller('api/v1/admin')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class AdminOpsController {
  constructor(private readonly svc: AdminService) {}

  @Get('badges')
  @Roles('REVIEWER', 'ADMIN', 'SUPER')
  @ApiOperation({
    summary: '배지 신청 검수',
    description:
      '배지는 전건 수동입니다 — 다른 매물보다 눈에 띄게 만드는 장치라 남용 유인이 큽니다. ' +
      '승인·반려는 reviewItemId 로 검수 API 를 호출하십시오.',
  })
  @ApiOkResponse({ type: BadgeRequestDto, isArray: true })
  badges() { return this.svc.badges(); }

  @Get('badges/history')
  @Roles('REVIEWER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '배지 발급 이력', description: 'v10.31 — 시안 「발급 이력」(사업자 · 배지 · 발급 · 만료). 최근 100건' })
  badgeHistory() { return this.svc.badgeHistory(); }

  @Get('disputes')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '분쟁 목록',
    description: 'heldAmount 는 이 분쟁으로 보류된 정산 금액입니다.',
  })
  @ApiQuery({ name: 'state', required: false, enum: ['open', 'all'], description: 'v10.32 — open(기본): 진행 중만 · all: 최근 days 일 안에 종결된 분쟁도 함께' })
  @ApiQuery({ name: 'days', required: false, description: 'v10.32 — state=all 일 때 종결 분쟁을 몇 일 전까지 낼지(기본 30 · 1~365)' })
  @ApiOkResponse({ type: DisputeAdminDto, isArray: true })
  disputes(@Query('state') state?: string, @Query('days') days?: string) {
    return this.svc.disputes(state === 'all' ? 'all' : 'open', Number(days) || 30);
  }

  /* v10.32 — 시안(scAdmDspt) 숫자 4칸 */
  @Get('disputes/summary')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '분쟁 요약', description: 'v10.32 — 처리 중(접수 · 검토 중) · 종결(처리 완료 · 기각) · 이번 달 접수 · 72시간 넘김(진행 중이면서 접수 72시간 지남). 실제 행 수' })
  @ApiOkResponse({ type: DisputeSummaryDto })
  disputeSummary() { return this.svc.disputeSummary(); }

  @Patch('disputes/:id')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '분쟁 처리',
    description:
      'RESOLVED · REJECTED 로 바꾸면 **보류된 정산이 풀립니다.** ' +
      '보류는 트리거가 걸었지만 해제는 사람의 판단이므로 여기서 합니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 409, description: 'ALREADY_HANDLED', type: ErrorDto })
  @Audit('DISPUTE_RESOLVE', 'DISPUTE')
  resolve(@Param('id') id: string, @Body() dto: ResolveDisputeDto) {
    return this.svc.resolveDispute(id, dto.status, dto.resolution);
  }

  @Get('auto-review/samples/summary')
  @Roles('REVIEWER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '표본 감사 요약', description: 'v10.31 — 최근 30일 자동 승인 · 표본 · 불일치 · 표본율' })
  sampleSummary() { return this.svc.auditSummary(); }

  @Post('auto-review/samples/resample')
  @Roles('REVIEWER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '표본 다시 뽑기', description: 'v10.31 — 표본율에 모자라는 만큼 최근 30일 자동 승인 건에서 무작위로 더 뽑습니다(기존 표본 · 결과는 그대로).' })
  @Audit('AUTO_REVIEW_RESAMPLE', 'REVIEW_ITEM')
  resample() { return this.svc.resample(); }

  @Get('auto-review/samples')
  @Roles('REVIEWER', 'ADMIN', 'SUPER')
  @ApiOperation({
    summary: '표본 감사 대기',
    description: '자동 승인 건의 5%입니다. 표본 감사 없이 자동화하면 오판을 영원히 모릅니다.',
  })
  @ApiOkResponse({ type: AuditSampleDto, isArray: true })
  samples() { return this.svc.auditSamples(); }

  @Get('auto-review/reasons')
  @Roles('REVIEWER', 'ADMIN', 'SUPER')
  @ApiOperation({
    summary: '수동 검수 사유별 건수 (최근 30일)',
    description: '어떤 규칙이 사람의 시간을 얼마나 쓰는지. 규칙을 조정할 근거입니다.',
  })
  @ApiOkResponse({ type: ReasonStatDto, isArray: true })
  reasons() { return this.svc.autoReviewReasons(); }

  @Get('auto-review/rate')
  @Roles('REVIEWER', 'ADMIN', 'SUPER')
  @ApiOperation({
    summary: '일별 자동화율 (최근 30일, 최신 먼저)',
    description: 'v_auto_review_rate. 첫 행이 오늘(또는 가장 최근 제출일)입니다.',
  })
  @ApiOkResponse({ type: AutoRateDto, isArray: true })
  rate() { return this.svc.autoReviewRate(); }

  @Post('auto-review/samples/:id')
  @Roles('REVIEWER', 'ADMIN', 'SUPER')
  @ApiOperation({
    summary: '감사 결과 기록',
    description: '부적정이면 해당 매물의 노출이 중단됩니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'review_items.id' })
  @Audit('AUTO_REVIEW_AUDIT', 'REVIEW_ITEM')
  audit(@Param('id') id: string, @Body() dto: RecordAuditDto) {
    return this.svc.recordAudit(id, dto.correct, dto.memo);
  }

  @Get('code-labels')
  @Roles('SUPER')
  @ApiOperation({
    summary: '코드 라벨',
    description: 'domain 이 핵심입니다 — REJECTED 는 매물에서 "반려", 분쟁에서 "기각"입니다.',
  })
  @ApiQuery({ name: 'domain', required: false })
  @ApiOkResponse({ type: CodeLabelDto, isArray: true })
  codeLabels(@Query('domain') domain?: string) { return this.svc.codeLabels(domain); }

  @Patch('code-labels/:domain/:code')
  @Roles('SUPER')
  @ApiOperation({
    summary: '라벨 수정',
    description: '화면 문구가 배포 없이 바뀝니다. 60초 캐시 후 반영됩니다.',
  })
  @ApiParam({ name: 'domain', example: 'listing.status' })
  @ApiParam({ name: 'code', example: 'PUBLISHED' })
  @ApiResponse({ status: 409, description: 'NOT_FOUND', type: ErrorDto })
  @Audit('CODE_LABEL_UPDATE', 'CODE_LABEL')
  updateLabel(
    @Param('domain') domain: string, @Param('code') code: string,
    @Body() dto: UpdateCodeLabelDto,
  ) {
    return this.svc.updateCodeLabel(domain, code, dto.label, dto.shortLabel);
  }
}
