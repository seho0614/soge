import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty,
  ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { EventService } from './event.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles, RequireGate } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

export class EventCreateDto {
  @ApiProperty({ description: '코드. 예) EV-2026-10' }) @IsString() code!: string;
  @ApiProperty() @IsString() title!: string;
  @ApiPropertyOptional({ description: '목록에 한 줄로 보일 요약' })
  @IsOptional() @IsString() summary?: string;
  @ApiProperty({ description: '본문' }) @IsString() body!: string;
  @ApiProperty({
    description:
      '무엇을 드리는지. **비워 둘 수 없습니다** — 혜택 없는 이벤트는 ' +
      '이벤트가 아닙니다.',
  })
  @IsString() benefit!: string;
  @ApiPropertyOptional({ description: '특정 관 전용이면 관 코드' })
  @IsOptional() @IsString() gwanCode?: string;
  @ApiProperty({ description: '시작 (ISO)' }) @IsString() startsAt!: string;
  @ApiProperty({ description: '종료 (ISO)' }) @IsString() endsAt!: string;
  @ApiPropertyOptional({
    enum: ['NONE', 'CLICK', 'APPLY'],
    description: 'NONE = 볼 것만 · CLICK = 누르면 참여 · APPLY = 신청서',
  })
  @IsOptional() @IsIn(['NONE', 'CLICK', 'APPLY']) joinType?: string;
  @ApiPropertyOptional({
    description:
      '선착순 인원. 참여를 받으시면 **반드시 정하십시오** — ' +
      '줄 수 있는 만큼만 받아야 나중에 못 준다는 말을 안 하게 됩니다.',
  })
  @IsOptional() @IsInt() @Min(1) maxJoins?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() landingUrl?: string;
}

export class EventStatusDto {
  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED', 'ENDED', 'CANCELED'] })
  @IsIn(['DRAFT', 'PUBLISHED', 'ENDED', 'CANCELED'])
  status!: string;
}

export class EventGrantDto {
  @ApiProperty({ description: '무엇을 어떻게 드렸는지. 나중에 근거가 됩니다' })
  @IsString() note!: string;
}

export class EventDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() summary?: string;
  @ApiProperty() benefit!: string;
  @ApiProperty() startsAt!: string;
  @ApiProperty() endsAt!: string;
  @ApiProperty({ description: '참여 수' }) joins!: number;
  @ApiPropertyOptional({ description: '남은 자리. 인원 제한이 없으면 null' }) remain?: number;
  @ApiPropertyOptional({ description: '남은 날' }) daysLeft?: number;
}

export class EventJoinResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ description: '참여 뒤 안내' }) note!: string;
}

/**
 * 이벤트 관리.
 *
 * ── 공지와 다릅니다 ─────────────────────────────────────────────────
 * 공지는 **알리는 것**이고, 이벤트는 **기간 동안 무언가를 해주는
 * 것**입니다. 기간이 끝나면 저절로 내려가야 하고, 무엇을 주기로
 * 했는지 남아야 합니다.
 *
 * ── 자동 지급은 하지 않습니다 ───────────────────────────────────────
 * 참여만 기록하고, 지급은 운영이 확인 후 처리합니다.
 * 코드가 자동으로 주면 **잘못 준 것을 되돌릴 수 없습니다.**
 */
@ApiTags('EVENT')
@Controller('api/v1')
export class EventController {
  constructor(private readonly svc: EventService) {}

  @Get('events')
  @ApiOperation({
    summary: '진행 중인 이벤트',
    description:
      '**기간 판정은 서버가 합니다** — 화면이 계산하면 시계가 어긋날 때 ' +
      '끝난 이벤트가 보입니다.',
  })
  @ApiQuery({ name: 'gwanCode', required: false })
  @ApiOkResponse({ type: EventDto, isArray: true })
  live(@Query('gwanCode') gwanCode?: string) { return this.svc.live(gwanCode); }

  @Get('events/:code')
  @ApiOperation({ summary: '이벤트 상세' })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: EventDto })
  detail(@Param('code') code: string) { return this.svc.detail(code); }

  @Post('events/:code/join')
  @ApiBearerAuth()
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '이벤트 참여',
    description:
      '**한 사람이 한 번만** 참여합니다. 기간 밖이거나 정원이 차면 ' +
      '받지 않습니다 — DB 가 집행하므로 새로고침으로 넘길 수 없습니다.\\n\\n' +
      '참여했다고 바로 받으시는 것은 아닙니다. **운영 확인 후 드립니다.**',
  })
  @ApiParam({ name: 'code' })
  @ApiResponse({ status: 422, description: 'EVENT · 기간 밖 · 정원 초과', type: ErrorDto })
  @ApiOkResponse({ type: EventJoinResultDto })
  @Audit('EVENT_JOIN', 'EVENT')
  join(@Param('code') code: string) { return this.svc.join(code); }

  @Get('me/events')
  /* ★ 본인 것만 보이는 자리입니다 — 로그인 여부를 봅니다.
   *   표시가 없으면 토큰 없이도 200 이 나갑니다. */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '내가 참여한 이벤트',
    description: '받았는지 못 받았는지 함께 옵니다 — 모르면 다시 묻게 됩니다.',
  })
  @ApiOkResponse({ type: EventDto, isArray: true })
  mine() { return this.svc.mine(); }

  /* ── 운영 ──────────────────────────────────────────────────────── */

  @Get('admin/events')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({ summary: '이벤트 전체 (초안 · 종료 포함)' })
  @ApiOkResponse({ type: EventDto, isArray: true })
  all() { return this.svc.all(); }

  @Post('admin/events')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: '이벤트 만들기',
    description: '초안으로 생깁니다. 확인 후 따로 발행하십시오.',
  })
  @ApiResponse({ status: 422, description: 'EVENT · 혜택 누락 등', type: ErrorDto })
  @ApiOkResponse({ type: EventDto })
  @Audit('EVENT_CREATE', 'EVENT')
  create(@Body() dto: EventCreateDto) { return this.svc.create(dto); }

  @Patch('admin/events/:code/status')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: '발행 · 중단',
    description:
      '**이미 끝난 이벤트는 다시 열 수 없습니다.** 기간을 늘리시려면 ' +
      '새 이벤트를 만드십시오 — 끝났다고 알린 분들에게 할 말이 없어집니다.',
  })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: EventDto })
  @Audit('EVENT_STATUS', 'EVENT')
  setStatus(@Param('code') code: string, @Body() dto: EventStatusDto) {
    return this.svc.setStatus(code, dto.status);
  }

  @Get('admin/events/ungranted')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: '지급 대기',
    description:
      '참여했는데 아직 못 받은 분들입니다. **오래된 것이 위로 옵니다** — ' +
      '방치되면 다음 이벤트에 아무도 참여하지 않습니다.',
  })
  @ApiOkResponse({ type: EventDto, isArray: true })
  ungranted() { return this.svc.ungranted(); }

  @Patch('admin/event-joins/:id/grant')
  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({
    summary: '지급 처리',
    description: '무엇을 어떻게 드렸는지 적습니다. **참여 기록은 지워지지 않습니다.**',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EventJoinResultDto })
  @Audit('EVENT_GRANT', 'EVENT')
  grant(@Param('id') id: string, @Body() dto: EventGrantDto) {
    return this.svc.grant(id, dto.note);
  }
}
