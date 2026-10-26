import { Body, Controller, Get, Headers, Ip, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';   // v10.31 검정 — 참 · 거짓 입력은 받은 값 그대로(G-134 · "false" 글자가 true 로 바뀌지 않게)
import { AdminV31Service } from './admin-v31.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

export class CostDto {
  @ApiProperty({ example: '2026-10' }) @Matches(/^\d{4}-\d{2}$/) month!: string;
  @ApiProperty({ enum: ['PAYROLL', 'RENT', 'INFRA', 'MARKETING', 'PG_FEE', 'OUTSOURCE', 'TAX', 'ETC'] })
  @IsIn(['PAYROLL', 'RENT', 'INFRA', 'MARKETING', 'PG_FEE', 'OUTSOURCE', 'TAX', 'ETC']) category!: string;
  @ApiProperty({ example: 12000000 }) @IsNumber() @Min(0) amount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() memo?: string;
}
export class PolicyItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() content?: string;
  @ApiPropertyOptional({ enum: ['CONFIRMED', 'PENDING'] }) @IsOptional() @IsIn(['CONFIRMED', 'PENDING']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() pendingEffect?: string;
}
export class GwanAxisDto {
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() isExposed?: boolean;
  @ApiPropertyOptional({ enum: ['LIST', 'MATCH', 'SERVICE', 'CONTENT'] }) @IsOptional() @IsIn(['LIST', 'MATCH', 'SERVICE', 'CONTENT']) uiType?: string;
}
export class PublisherDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ example: 'blog.example.com' }) @IsString() domain!: string;
  @ApiPropertyOptional({ description: '퍼블리셔 담당 회원 이메일' }) @IsOptional() @IsString() accountEmail?: string;
  @ApiPropertyOptional({ type: [String], description: 'F5 — 퍼블리셔 본인 IP(CIDR)' }) @IsOptional() @IsArray() ownerIps?: string[];
}
export class PublisherPatchDto {
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() verifyDomain?: boolean;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'HOLD', 'CLOSED'] }) @IsOptional() @IsIn(['ACTIVE', 'HOLD', 'CLOSED']) status?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() ownerIps?: string[];
}
export class MonthDto { @ApiProperty({ example: '2026-09' }) @Matches(/^\d{4}-\d{2}$/) month!: string; }
export class StatementActionDto {
  @ApiProperty({ enum: ['REQUEST', 'APPROVE', 'PAY'] }) @IsIn(['REQUEST', 'APPROVE', 'PAY']) action!: string;
  @ApiPropertyOptional({ description: '집행 때 — 은행 거래번호(이체 참조)' }) @IsOptional() @IsString() paidRef?: string;
}
export class AdxClickDto {
  @ApiProperty({ format: 'uuid' }) @IsString() publisherId!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() impressionId?: number;
  @ApiPropertyOptional({ description: '기기 식별(해시) — 퍼블리셔 지면 스크립트가 만듦' }) @IsOptional() @IsString() device?: string;
}

/** v10.117 — 성향 학습 되돌리기 결과 */
export class SegRevertDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ description: '성향을 옮기기 전 세그먼트로 실제로 돌렸는가(false 면 기록만 되돌림 표시)' }) restored!: boolean;
  @ApiProperty() note!: string;
}

/** v10.31 (10/10 시안 기준) — 운영 화면에서 서버 자료가 없던 구역 */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class AdminV31Controller {
  constructor(private readonly svc: AdminV31Service) {}

  @Get('finance/runway')
  @ApiOperation({ summary: '활주로(손익분기 · 필요 유료회원 · 최저 현금 · 누적 최대 적자)',
    description: 'SB-ADM-DSH-010. 실제 매출(v_monthly_revenue)과 운영이 넣은 월 비용(ops_monthly_costs)으로 계산합니다 — 가정치가 아닙니다.' })
  runway() { return this.svc.runway(); }

  @Get('finance/costs')
  @ApiOperation({ summary: '월 비용 목록' })
  costs(@Query('month') month?: string) { return this.svc.costs(month); }

  @Put('finance/costs')
  @ApiOperation({ summary: '월 비용 넣기 · 고치기', description: '달 · 항목마다 한 줄. 같은 달 · 항목이면 고칩니다.' })
  @Audit('FINANCE_COST_PUT', 'FINANCE')
  putCost(@Body() dto: CostDto) { return this.svc.putCost(dto); }

  @Get('policy-items')
  @ApiOperation({ summary: '정책 원본 표', description: 'SB-ADM-POL-010 — 항목 · 내용 · 근거 · 확정/미결. 서버 값이 있는 항목은 서버 값으로 그립니다.' })
  policyItems() { return this.svc.policyItems(); }

  @Patch('policy-items/:code')
  @Roles('SUPER')
  @ApiOperation({ summary: '정책 원본 고치기(최고 관리자)' })
  @ApiParam({ name: 'code' })
  @Audit('POLICY_ITEM_UPDATE', 'POLICY')
  updatePolicyItem(@Param('code') code: string, @Body() dto: PolicyItemDto) { return this.svc.updatePolicyItem(code, dto); }

  @Get('gwans/:code/open-check')
  @Roles('SUPER')
  @ApiOperation({ summary: '관 오픈 체크리스트', description: 'SB-ADM-SIT-040 — 업종 · 소개비 부담 주체 · 인증 게이트 · 법정 고지 · 약관 · 검수 담당자. 실제 DB 로 판정합니다.' })
  openCheck(@Param('code') code: string) { return this.svc.gwanOpenCheck(code); }

  @Post('gwans/:code/open')
  @Roles('SUPER')
  @ApiOperation({ summary: '운영중으로 전환', description: '체크리스트를 모두 통과해야 합니다(422 OPEN_CHECK).' })
  @Audit('GWAN_OPEN', 'GWAN')
  openGwan(@Param('code') code: string) { return this.svc.openGwan(code); }

  @Get('gwan-axes')
  @ApiOperation({ summary: '관 축 · UI 유형', description: 'SB-ADM-GWN-010 관 UI/UX 관리' })
  gwanAxes(@Query('gwan') gwan?: string) { return this.svc.gwanAxes(gwan); }

  @Patch('gwan-axes/:gwan/:axis')
  @ApiOperation({ summary: '축 노출 · UI 유형 바꾸기', description: '내리면 신규 노출만 멈춥니다 — 진행 중인 거래는 끝까지 갑니다. 거래형 축은 목록형 고정(422 GWAN_AXIS).' })
  @Audit('GWAN_AXIS_UPDATE', 'GWAN')
  updateAxis(@Param('gwan') gwan: string, @Param('axis') axis: string, @Body() dto: GwanAxisDto) {
    return this.svc.updateGwanAxis(gwan, axis, dto);
  }

  @Get('ai/learn-settings')
  @ApiOperation({ summary: 'AI 학습 지표', description: 'v10.31 — 분류 학습 · 위험감지 학습 화면의 지표 4칸(설정 · 어휘 수 · 법 규칙 예외 수)' })
  learnSettings() { return this.svc.learnSettings(); }

  @Get('segments/preview')
  @ApiOperation({ summary: '옮길 대상 미리보기', description: 'SB-ADM-SEG-020 — 학습 실행 전 옮김 · 보류 판정. 이름은 첫 글자만.' })
  segmentPreview() { return this.svc.segmentPreview(); }

  @Get('segments/log')
  @ApiOperation({ summary: '옮긴 기록', description: 'SB-ADM-SEG-010 — 성향 학습이 실제로 옮긴 회원(전 · 후 · 클릭 · 일시)' })
  segmentLog() { return this.svc.segmentLog(); }

  @Post('segments/log/:id/revert')
  @ApiOperation({ summary: '성향 학습 되돌리기 (v10.117)', description: 'SB-ADM-SEG-010 — 그 회원의 가장 최근 이동만. 옮기기 전 세그먼트로 돌리고(성향이 그대로이고 맞춤형 광고 동의가 있을 때) 기록에 되돌림 · 되돌린 사람을 남김. 학습은 막지 않음(다시 돌리면 같은 클릭으로 다시 옮길 수 있음).' })
  @ApiParam({ name: 'id', description: '옮긴 기록 id' })
  @ApiOkResponse({ type: SegRevertDto })
  @ApiResponse({ status: 404, type: ErrorDto }) @ApiResponse({ status: 409, description: 'ALREADY_REVERTED · NEWER_SHIFT', type: ErrorDto })
  @Audit('SEGMENT_REVERT', 'SEGMENT')
  revertSegment(@Param('id', ParseUUIDPipe) id: string) { return this.svc.revertSegmentShift(id); }

  @Get('integration-status')
  @Roles('SUPER')   // matrix SB-ADM-ITG-010 SUPER
  @ApiOperation({ summary: '통합 현황', description: 'SB-ADM-ITG-010 — 테이블 · 라우트 · 권한 · 체계별 라우트 · 분리 점검. 지금 DB 와 등록된 라우트에서 셉니다.' })
  integration() { return this.svc.integrationStatus(); }

  /* ── 외부 송출 · 퍼블리셔 지급 ── */

  @Get('adx/overview')
  @Roles('ADMIN', 'SUPER', 'PAYOUT')
  @ApiOperation({ summary: '외부 송출 현황', description: 'SB-ADS-PLT-010 · SB-ADS-PAY-010 — 설정 · 퍼블리셔 · 무효 클릭 F1~F7 · 클릭 · 명세서' })
  adxOverview() { return this.svc.adxOverview(); }

  @Post('adx/publishers')
  @ApiOperation({ summary: '퍼블리셔 등록', description: '도메인 확인 전에는 송출되지 않습니다.' })
  @Audit('ADX_PUBLISHER_ADD', 'ADX')
  addPublisher(@Body() dto: PublisherDto) { return this.svc.addPublisher(dto); }

  @Patch('adx/publishers/:id')
  @ApiOperation({ summary: '퍼블리셔 도메인 확인 · 보류 · 본인 IP' })
  @Audit('ADX_PUBLISHER_UPDATE', 'ADX')
  updatePublisher(@Param('id') id: string, @Body() dto: PublisherPatchDto) { return this.svc.updatePublisher(id, dto); }

  @Post('adx/confirm')
  @ApiOperation({ summary: '보류 지난 클릭 확정', description: `보류 일수(adx.hold_days)를 지난 유효 클릭을 확정합니다. 월 마감 때도 먼저 돕니다.` })
  @Audit('ADX_CONFIRM', 'ADX')
  adxConfirm() { return this.svc.adxConfirm(); }

  @Post('adx/close-month')
  @ApiOperation({ summary: '월 마감 → 명세서', description: '확정된 유효 클릭을 퍼블리셔별 명세서로 · 최소 지급액 미달은 이월 · 원천징수 3.3%' })
  @Audit('ADX_CLOSE', 'ADX')
  adxClose(@Body() dto: MonthDto) { return this.svc.adxClose(dto.month); }

  @Patch('adx/statements/:id')
  @Roles('ADMIN', 'SUPER', 'PAYOUT')
  @ApiOperation({ summary: '명세서 신청 · 승인 · 집행',
    description: '신청자 ≠ 승인자 ≠ 집행자(2인 원칙). 집행은 지급 담당(PAYOUT) · SUPER(2026-10-21) · 지급 게이트(adx.payout_gate)가 열려 있어야 · 원장 일치해야 합니다.' })
  @Audit('ADX_STATEMENT', 'ADX')
  statement(@Param('id') id: string, @Body() dto: StatementActionDto) { return this.svc.adxStatementAction(id, dto.action, dto.paidRef); }
}

/** 외부 사이트(퍼블리셔 지면)가 부르는 공개 송출 · 클릭 — 판정은 DB(fn_adx_serve · fn_adx_click) */
@ApiTags('ADS')
@Controller('api/v1')
export class AdxPublicController {
  constructor(private readonly svc: AdminV31Service) {}

  @Get('ads/external/serve')
  @ApiOperation({ summary: '외부 송출 — 소재 하나', description: '도메인 확인 · 운영 중 퍼블리셔만. 규제 소재는 외부로 내보내지 않습니다.' })
  @ApiOkResponse({ type: Object })   /* v10.31 합침 — 응답 모양을 문서에(검정 「구현된 API 에 응답 스키마」) */
  serve(@Query('pub') pub: string, @Query('device') device: string | undefined, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    return this.svc.adxServe(pub, device ?? null, ip?.replace(/^::ffff:/, '') || null, ua ?? null);
  }

  @Post('ads/external/click')
  @ApiOperation({ summary: '외부 송출 — 클릭', description: '무효 클릭 F1~F7 을 판정해 남깁니다. 무효여도 광고 지면으로는 보냅니다(지급에서만 뺌).' })
  @ApiOkResponse({ type: Object })   /* v10.31 합침 — 응답 모양을 문서에(검정 「구현된 API 에 응답 스키마」) */
  click(@Body() dto: AdxClickDto, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    return this.svc.adxClick(dto.publisherId, dto.impressionId ?? null, dto.device ?? null, ip?.replace(/^::ffff:/, '') || null, ua ?? null);
  }
}

/** 사용자 웹이 읽는 관 축(노출 중인 것만) — 사용자 웹 관 화면(GwanLanding)이 씀(v10.31 합침) */
@ApiTags('CATALOG')
@Controller('api/v1')
export class GwanAxesPublicController {
  constructor(private readonly svc: AdminV31Service) {}

  @Get('site/gwan-axes')
  @ApiOperation({ summary: '관 축(노출 중)', description: 'v10.31 — 운영 「관 UI/UX 관리」에서 내린 축은 빠집니다.' })
  @ApiOkResponse({ type: Object, isArray: true })   /* v10.31 합침 — 응답 모양을 문서에(검정 「구현된 API 에 응답 스키마」) */
  axes(@Query('gwan') gwan?: string) { return this.svc.gwanAxes(gwan, true); }
}
