import { Body, Controller, Get, HttpCode, Injectable, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Audit } from '../../core/audit.interceptor';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { AssumeAfter, RECHECK_MAX } from './assume-after';

/* ---------------------------------------------------------------------
 * v10.792 (D331 · docs/907) 간주 끈 뒤 처리 도구 — 운영 화면 › 오픈 체크리스트 › 「간주 끈 뒤 처리」
 *   ADMIN · SUPER  GET  /admin/assume-after                            재대조 대상 · 시험 기록 · 시험 하위가맹점 번호(읽기만)
 *   SUPER          POST /admin/assume-after/broker-recheck             간주 승인 중개사 재대조(50건까지 · 다름 · 없음은 알림만)
 *   SUPER          POST /admin/assume-after/broker-recheck/{id}/ack    다름 · 없음 결과 확인(사유 2 ~ 200자 · 한 번)
 * ------------------------------------------------------------------- */

export class BrokerRecheckDto {
  @ApiPropertyOptional({ minimum: 1, maximum: RECHECK_MAX, description: '한 번에 맞춰 볼 수(기본 50)' })
  @IsOptional() @IsInt() @Min(1) @Max(RECHECK_MAX) limit?: number;
}

export class RecheckAckDto {
  @ApiProperty({ minLength: 2, maxLength: 200, description: '확인 내용(예: 서류 다시 받음 · 이상 없음 / 해제 진행)' })
  @IsString() @MinLength(2) @MaxLength(200) note!: string;
}

@Injectable()
export class AssumeAfterService {
  readonly core: AssumeAfter;
  constructor(db: DatabaseService) { this.core = new AssumeAfter((sql, params) => db.query(sql, params ?? [])); }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('api/v1/admin/assume-after')
@Roles('ADMIN', 'SUPER')
export class AssumeAfterController {
  constructor(private readonly svc: AssumeAfterService) {}

  @Get()
  @ApiOperation({ summary: '간주 끈 뒤 처리', description: 'v10.792 (docs/907) 간주로 승인된 중개사 재대조 대상(v_broker_recheck_pending) · 최근 재대조 결과 · 시험(스텁) 결제 · 충전 · 지급 기록 최근 50건씩 · 시험 하위가맹점 번호(STUB-SUB-…) 판매자. 읽기만 · 개인정보 · 키 없음.' })
  @ApiOkResponse({ type: Object })
  overview() { return this.svc.core.overview(); }

  @Post('broker-recheck')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '중개사 재대조 일괄', description: 'v10.792 간주로 승인된 중개사를 국토부 조회로 다시 맞춤(최대 50건). MATCH 는 재대조 대상에서 빠짐 · MISMATCH · NOT_FOUND 는 운영 알림 BROKER_RECHECK_MISMATCH(WARN) — **승인 상태는 바꾸지 않음**(대표 11/25) · 조회 실패는 FAILED. 조회 연동이 없으면 422.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, description: 'LOOKUP_NOT_CONFIGURED', type: ErrorDto })
  @Audit('ASSUME_AFTER_BROKER_RECHECK', 'BROKER')
  recheck(@Body() dto: BrokerRecheckDto) { return this.svc.core.brokerRecheck(RequestCtx.actorId()!, dto.limit ?? RECHECK_MAX); }

  @Post('broker-recheck/:id/ack')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '재대조 다름 · 없음 확인', description: 'v10.792 다름 · 없음 결과를 운영자가 확인(사유 · 한 번만). 승인 해제는 이 길이 아님 — 운영자가 판단해 따로.' })
  @ApiParam({ name: 'id', description: '재대조 기록 번호' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, description: 'RECHECK_NOT_FLAGGED · RECHECK_ACKED', type: ErrorDto })
  @Audit('ASSUME_AFTER_BROKER_ACK', 'BROKER')
  ack(@Param('id') id: string, @Body() dto: RecheckAckDto) { return this.svc.core.ack(RequestCtx.actorId()!, id, dto.note); }
}
