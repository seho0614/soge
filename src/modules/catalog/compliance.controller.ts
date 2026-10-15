import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty,
         ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { ComplianceService } from './compliance.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Audit } from '../../core/audit.interceptor';

export class RestrictionCheckDto {
  @ApiPropertyOptional() @IsOptional() @IsString() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gwanCode?: string;
  @ApiPropertyOptional({ description: '본문. 업종명이 드러나는지 함께 봅니다' })
  @IsOptional() @IsString() text?: string;
}
export class AgreeDto {
  @ApiProperty({ example: [{ code: 'SERVICE', agreed: true }] })
  @IsArray() items!: Array<{ code: string; agreed: boolean }>;
}
export class RestrictionResultDto {
  @ApiProperty() allowed!: boolean;
  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } }) blocked?: unknown[];
  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } }) gated?: unknown[];
  @ApiPropertyOptional({ description: '왜 막혔는지를 이용자 말로' }) message?: string | null;
}
export class TermStateDto {
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
  @ApiProperty() version!: string;
  @ApiProperty() isRequired!: boolean;
  @ApiProperty() agreed!: boolean;
  @ApiPropertyOptional() effectiveFrom?: string;
  @ApiPropertyOptional({ description: 'v10.28 (G-214) — 가장 최근 동의 줄이 예전 판(새 판으로 바뀌어 다시 동의가 필요)' }) oldVersion?: boolean;
  @ApiPropertyOptional({ nullable: true, description: 'v10.28 — 마지막으로 동의 · 거부를 기록한 때' }) changedAt?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'v10.28 — 마지막으로 동의한 판(동의한 적 없으면 null)' }) agreedVersion?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'v10.28 — 이 판에서 바뀐 점(재동의 화면의 「바뀐 점」)' }) changeNote?: string | null;
}

/** 제한업종 검사 · 약관 동의 */
@ApiTags('HOM')
@Controller('api/v1')
export class ComplianceController {
  constructor(private readonly svc: ComplianceService) {}

  @Post('restrictions/check')
  @ApiOperation({
    summary: '제한업종 검사',
    description:
      '**등록 전에 미리 확인합니다.** 지금은 등록을 눌러야 막혀서, ' +
      '이용자가 다 써 놓고 나서 "이 업종은 안 됩니다"를 봅니다 — ' +
      '그 시간이 통째로 버려집니다. 업종을 고르는 순간 알려주십시오.',
  })
  @ApiOkResponse({ type: RestrictionResultDto })
  check(@Body() dto: RestrictionCheckDto) {
    return this.svc.check(dto.categoryId, dto.gwanCode, dto.text);
  }

  @Get('restrictions')
  @ApiOperation({
    summary: '제한업종 목록',
    description: '등록 폼이 미리 걸러 쓸 수 있습니다. 근거 법령을 함께 냅니다.',
  })
  @ApiQuery({ name: 'gwan', required: false })
  @ApiOkResponse({ type: RestrictionResultDto, isArray: true })
  list(@Query('gwan') gwan?: string) { return this.svc.list(gwan); }

  @Get('terms/required')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '동의해야 하는 약관',
    description:
      '**발행된 것만 냅니다.** 초안에 동의를 받으면 나중에 본문이 바뀌어 ' +
      '"무엇에 동의했는가"를 답할 수 없습니다.',
  })
  @ApiOkResponse({ type: TermStateDto, isArray: true })
  required() { return this.svc.required(); }

  @Post('terms/agree')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '약관 동의',
    description:
      '동의 시각과 접속 정보를 함께 남깁니다 — 나중에 "동의한 적 없다"는 ' +
      '분쟁의 근거입니다. **필수 약관에 동의하지 않으면 이용할 수 없습니다.**',
  })
  @ApiResponse({ status: 422, description: 'REQUIRED_TERM · NOT_PUBLISHED · NOTICE_ONLY(알림 — 동의를 받지 않는 안내 · v10.28 G-218)', type: ErrorDto })
  @ApiOkResponse({ type: TermStateDto })
  @Audit('TERM_AGREE', 'TERM')
  agree(@Body() dto: AgreeDto) { return this.svc.agree(dto.items); }

  @Get('terms/agreements')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 동의 이력' })
  @ApiOkResponse({ type: TermStateDto, isArray: true })
  history() { return this.svc.history(); }
}
