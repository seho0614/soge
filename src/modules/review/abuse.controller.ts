import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty,
  ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AbuseService } from './abuse.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles, RequireGate } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

const TARGET = ['LISTING', 'REQUEST', 'SERVICE', 'PROFILE', 'POST', 'COMMENT'] as const;   // v10.27 (G-191) — 소개광장 글 · v10.80 (D110) — 소개광장 댓글

export class AbuseCreateDto {
  @ApiProperty({ enum: TARGET, description: '무엇을 신고하는가' })
  @IsIn(TARGET as unknown as string[])
  targetType!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  targetId!: string;

  @ApiProperty({ description: '사유 코드. `GET /report-reasons` 로 받습니다' })
  @IsString()
  reasonCode!: string;

  @ApiPropertyOptional({
    description:
      '무엇이 문제인지. **기타(OTHER)를 고르셨으면 반드시 적어야 합니다** — ' +
      '사유 없는 신고는 처리하는 쪽이 판단할 근거가 없습니다.',
  })
  @IsOptional() @IsString() @MaxLength(500)
  detail?: string;
}

export class AbuseResolveDto {
  @ApiProperty({
    enum: ['UPHELD', 'DISMISSED'],
    description: 'UPHELD = 신고가 맞다 · DISMISSED = 아니다',
  })
  @IsIn(['UPHELD', 'DISMISSED'])
  state!: string;

  @ApiProperty({
    description:
      '처리 내용. **인정이든 기각이든 반드시 적어야 합니다**(DB 가 강제합니다) — ' +
      '신고한 사람에게 그대로 전달되고, 근거 없는 기각을 막습니다.',
  })
  @IsString() @MinLength(2) @MaxLength(500)
  resolution!: string;
}

export class AbuseReasonDto {
  @ApiProperty() code!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ description: 'HIGH · MEDIUM · LOW' }) severity!: string;
  @ApiPropertyOptional({ description: '이 관에서만 쓰는 사유인가' }) gwanCode?: string;
}

export class AbuseStateDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'OPEN · QUEUED · UPHELD · DISMISSED' }) state!: string;
  @ApiProperty() reasonCode!: string;
  @ApiPropertyOptional() resolution?: string;
  @ApiProperty() createdAt!: string;
}

/**
 * 신고 접수 · 처리.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────
 * 자동 노출의 대가는 신고입니다. 전수 심사를 포기한 대신 **사후에
 * 잡습니다.** 표(`reports`)와 사유(`report_reasons`)와 방어 트리거는
 * 이미 있었는데 **접수할 길이 없었습니다** — 신고할 수 없는 신고
 * 체계는 아무것도 막지 못합니다.
 *
 * ── 자동으로 내리지 않습니다 ────────────────────────────────────────
 * 사유별 임계치를 넘으면 **검수 큐에 올립니다.** 자동으로 내리면
 * 경쟁사 여럿이 짜고 남의 등록을 내릴 수 있습니다.
 */
@ApiTags('REPORT')
@Controller('api/v1')
export class AbuseController {
  constructor(private readonly svc: AbuseService) {}

  @Get('report-reasons')
  @ApiOperation({
    summary: '신고 사유 목록',
    description:
      '관마다 다릅니다 — 소개몰(건강관)은 효능 과장이, 안심소개는 허위 매물이 ' +
      '더 중합니다. `gwanCode` 를 주면 그 관 전용 사유가 함께 옵니다.',
  })
  @ApiQuery({ name: 'gwanCode', required: false })
  @ApiOkResponse({ type: AbuseReasonDto, isArray: true })
  reasons(@Query('gwanCode') gwanCode?: string) { return this.svc.reasons(gwanCode); }

  @Post('reports')
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '신고 접수',
    description:
      '**본인인증이 필요합니다.** 익명 신고를 받으면 경쟁사가 계정을 ' +
      '만들어 가며 반복 신고할 수 있습니다.\n\n' +
      '같은 사람이 같은 건을 여러 번 신고해도 **1건으로 셉니다** — ' +
      '숫자를 부풀려 검수 큐에 올리는 것을 막기 위해서입니다.',
  })
  @ApiResponse({ status: 422, description: 'REPORT · 자기 등록 신고 등', type: ErrorDto })
  @ApiOkResponse({ type: AbuseStateDto })
  @Audit('REPORT_CREATE', 'REPORT')
  create(@Body() dto: AbuseCreateDto) { return this.svc.create(dto); }

  @Get('me/reports')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '내가 한 신고',
    description: '처리 결과와 사유가 함께 옵니다. **결과를 알려 주지 않으면 다시 신고합니다.**',
  })
  @ApiOkResponse({ type: AbuseStateDto, isArray: true })
  mine() { return this.svc.mine(); }

  @Get('admin/report-queue')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: '신고 처리 큐',
    description:
      '아직 처리하지 않은 신고입니다. **오래 방치된 것이 위로 옵니다** — ' +
      '신고해 놓고 답이 없으면 신고 자체를 안 하게 됩니다.',
  })
  @ApiQuery({ name: 'state', required: false, description: 'OPEN · QUEUED' })
  @ApiOkResponse({ type: AbuseStateDto, isArray: true })
  queue(@Query('state') state?: string) { return this.svc.queue(state); }

  @Patch('admin/reports/:id/resolve')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: '신고 처리',
    description:
      '**처리 내용 없이는 닫을 수 없습니다**(DB 가 강제합니다). ' +
      '신고한 사람에게 그대로 전달되므로, 근거 없는 기각이 남지 않습니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 422, description: 'REPORT · 사유 없는 처리', type: ErrorDto })
  @ApiOkResponse({ type: AbuseStateDto })
  @Audit('REPORT_RESOLVE', 'REPORT')
  resolve(@Param('id') id: string, @Body() dto: AbuseResolveDto) {
    return this.svc.resolve(id, dto);
  }
}
