import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty,
  ApiPropertyOptional, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { CollectService } from './collect.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

export class SourceCreateDto {
  @ApiProperty({ description: '코드. 예) MFDS' }) @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ description: '기준 주소' }) @IsString() baseUrl!: string;
  @ApiPropertyOptional({
    enum: ['PUBLIC_API', 'OPEN_DATA', 'PARTNER_FEED'],
    description: '**일반 웹사이트 크롤링은 넣지 않습니다** — 다른 판단이 필요합니다.',
  })
  @IsOptional() @IsIn(['PUBLIC_API', 'OPEN_DATA', 'PARTNER_FEED']) kind?: string;
  @ApiPropertyOptional({ description: '요청 간격(ms). **1000 미만은 안 됩니다**' })
  @IsOptional() @IsInt() @Min(1000) intervalMs?: number;
}

export class GateDto {
  @ApiProperty({ enum: ['ROBOTS', 'LEGAL'], description: '무엇을 확인했는가' })
  @IsIn(['ROBOTS', 'LEGAL']) kind!: string;
  @ApiPropertyOptional({ description: '법무 회신 요지. LEGAL 이면 적어 주십시오' })
  @IsOptional() @IsString() note?: string;
}

export class StateDto {
  @ApiProperty({ enum: ['STOPPED', 'READY', 'BLOCKED'] })
  @IsIn(['STOPPED', 'READY', 'BLOCKED']) state!: string;
  @ApiPropertyOptional({ description: '차단 사유 · 해제 사유' })
  @IsOptional() @IsString() reason?: string;
}

export class SourceDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'STOPPED · READY · RUNNING · BLOCKED' }) state!: string;
  @ApiProperty({ description: 'robots 확인됨' }) robotsOk!: boolean;
  @ApiProperty({ description: '법무 회신됨' }) legalOk!: boolean;
  @ApiPropertyOptional({ description: '무엇이 막고 있는가' }) blocker?: string;
}

/**
 * 수집 관리.
 *
 * ── 왜 관리자에 두나 ────────────────────────────────────────────────
 * 수집은 **운영이 매일 보는 일이 아니라 가끔 켜고 끄는 일**입니다.
 * 따로 앱을 만들면 그 앱을 켜는 것부터 잊습니다.
 *
 * ── 함부로 하면 안 됩니다 ───────────────────────────────────────────
 * 남의 사이트에서 데이터를 가져오는 일이라, 잘못하면 **저작권
 * 침해이거나 업무방해**가 됩니다. 게이트를 여럿 둡니다.
 */
@ApiTags('COLLECT')
@Controller('api/v1/admin/collect')
export class CollectController {
  constructor(private readonly svc: CollectService) {}

  @Get('sources')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: '수집 대상',
    description: '게이트 통과 여부와 **무엇이 막고 있는지**가 함께 옵니다.',
  })
  @ApiOkResponse({ type: SourceDto, isArray: true })
  sources() { return this.svc.sources(); }

  @Post('sources')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: '수집 대상 등록',
    description:
      '등록해도 **곧바로 돌지 않습니다** — robots 확인과 법무 회신을 ' +
      '거쳐야 READY 가 됩니다(INV-C7).',
  })
  @ApiOkResponse({ type: SourceDto })
  @Audit('COLLECT_SOURCE_CREATE', 'COLLECT_SOURCE')
  create(@Body() dto: SourceCreateDto) { return this.svc.create(dto); }

  @Patch('sources/:code/gate')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: '게이트 통과 기록',
    description:
      'ROBOTS = robots.txt 를 확인했다 · LEGAL = 법무 회신을 받았다.\\n\\n' +
      '**누가 언제 확인했는지 남습니다** — 나중에 문제가 되면 이것이 근거입니다.',
  })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: SourceDto })
  @Audit('COLLECT_GATE', 'COLLECT_SOURCE')
  gate(@Param('code') code: string, @Body() dto: GateDto) {
    return this.svc.gate(code, dto);
  }

  @Patch('sources/:code/state')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: '수집 켜고 끄기',
    description:
      '**차단(BLOCKED)을 풀면 STOPPED 로만 갑니다**(INV-C5) — ' +
      '곧바로 READY 로 가지 않고 게이트를 다시 통과해야 합니다.',
  })
  @ApiParam({ name: 'code' })
  @ApiResponse({ status: 422, description: 'COLLECT · 게이트 미통과 등', type: ErrorDto })
  @ApiOkResponse({ type: SourceDto })
  @Audit('COLLECT_STATE', 'COLLECT_SOURCE')
  setState(@Param('code') code: string, @Body() dto: StateDto) {
    return this.svc.setState(code, dto);
  }

  @Post('sources/:code/run')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: '수집 실행',
    description:
      'READY 인 대상만 돕니다. **초 간격 · 동시 1** 로 제한됩니다(INV-C4) — ' +
      '빠르게 두드리면 상대 서버에 부담을 주고 업무방해가 됩니다.',
  })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: Object })
  @Audit('COLLECT_RUN', 'COLLECT_SOURCE')
  run(@Param('code') code: string) { return this.svc.run(code); }

  @Get('fetches')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({ summary: '수집 실행 기록' })
  @ApiOkResponse({ type: Object, isArray: true })
  fetches() { return this.svc.fetches(); }

  @Get('health')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: '수집 상태 요약',
    description: '성분 대조율과 **멈춘 수집**을 봅니다.',
  })
  @ApiOkResponse({ type: Object })
  health() { return this.svc.health(); }
}
