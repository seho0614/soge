import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { PublishRequestsService } from './publish-requests.service';

/* ---------------------------------------------------------------------
 * v10.711 (D324 · docs/819) 페이지 게시 요청 · 승인
 *   ADMIN · SUPER  GET /admin/publish-requests · POST /admin/publish-requests(요청) · POST …/{id}/withdraw(요청한 사람 · SUPER)
 *   SUPER          POST …/{id}/approve(그 초안 게시) · POST …/{id}/reject(사유)
 * ------------------------------------------------------------------- */
export class PublishRequestRowDto {
  @ApiProperty() id!: number;
  @ApiProperty({ enum: ['LAYOUT', 'PAGE'] }) kind!: string;
  @ApiProperty({ description: '꾸밀 페이지 열쇠 또는 관 안 페이지 번호' }) ref!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ nullable: true }) note!: string | null;
  @ApiProperty({ enum: ['OPEN', 'APPROVED', 'REJECTED', 'WITHDRAWN'] }) status!: string;
  @ApiProperty({ nullable: true }) reason!: string | null;
  @ApiProperty() requestedAt!: string;
  @ApiProperty({ nullable: true }) requestedByName!: string | null;
  @ApiProperty({ nullable: true }) decidedAt!: string | null;
  @ApiProperty({ nullable: true }) decidedByName!: string | null;
  @ApiProperty({ description: '요청한 뒤 초안이 바뀜(승인 막힘)' }) stale!: boolean;
}
export class PublishRequestCreateDto {
  @ApiProperty({ enum: ['LAYOUT', 'PAGE'] }) @IsIn(['LAYOUT', 'PAGE']) kind!: string;
  @ApiProperty({ example: 'HOME' }) @IsString() @Matches(/^([A-Za-z]{3,4}|\d{1,12})$/) ref!: string;
  @ApiPropertyOptional({ example: '연말 이벤트 띠 바꿈' }) @IsOptional() @IsString() @MaxLength(300) note?: string;
}
export class PublishRequestRejectDto {
  @ApiProperty({ example: '그림 설명을 채워 주세요' }) @IsString() @MinLength(2) @MaxLength(300) reason!: string;
}
export class PublishRequestResultDto {
  @ApiProperty() id!: number;
  @ApiProperty({ enum: ['OPEN', 'APPROVED', 'REJECTED', 'WITHDRAWN'] }) status!: string;
}

@ApiTags('ADM')
@Controller('api/v1')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class PublishRequestsController {
  constructor(private readonly svc: PublishRequestsService) {}

  @Get('admin/publish-requests')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '게시 요청 목록 (v10.711)', description: '열린 요청 · 최근 30일 끝난 요청 · 요청 뒤 초안이 바뀌었는지(stale).' })
  @ApiOkResponse({ type: PublishRequestRowDto, isArray: true })
  list() { return this.svc.list(); }

  @Post('admin/publish-requests')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '게시 요청 (v10.711)', description: '지금 초안의 지문을 떠 두고 SUPER 에게 운영 알림 · 같은 페이지 열린 요청이 있으면 422 PUBLISH_REQ_OPEN.' })
  @ApiOkResponse({ type: PublishRequestResultDto })
  @ApiResponse({ status: 422, description: 'PUBLISH_REQ_OPEN', type: ErrorDto })
  @Audit('PAGE_PUBLISH_REQUEST', 'SITE')
  create(@Body() dto: PublishRequestCreateDto) { return this.svc.create(dto); }

  @Post('admin/publish-requests/:id/approve')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '게시 요청 승인 (v10.711 · SUPER)', description: '요청 때 초안 그대로 게시 · 초안이 바뀌었으면 422 PUBLISH_REQ_STALE · 수정 가능 · 관 닫힘 규칙 그대로.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: PublishRequestResultDto })
  @ApiResponse({ status: 422, description: 'PUBLISH_REQ_STALE · PUBLISH_REQ_STATE · SITE_LAYOUT_LOCKED · SITE_LAYOUT_GWAN_OPEN · GWAN_PAGE_LOCKED · GWAN_PAGE_GWAN_OPEN', type: ErrorDto })
  @Audit('PAGE_PUBLISH_APPROVE', 'SITE')
  approve(@Param('id', ParseIntPipe) id: number) { return this.svc.approve(id); }

  @Post('admin/publish-requests/:id/reject')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({ summary: '게시 요청 되돌려 보냄 (v10.711 · SUPER)', description: '사유 2자 이상.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: PublishRequestResultDto })
  @ApiResponse({ status: 422, description: 'PUBLISH_REQ_REASON · PUBLISH_REQ_STATE', type: ErrorDto })
  @Audit('PAGE_PUBLISH_REJECT', 'SITE')
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: PublishRequestRejectDto) { return this.svc.reject(id, dto.reason); }

  @Post('admin/publish-requests/:id/withdraw')
  @HttpCode(200)
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '게시 요청 철회 (v10.711)', description: '요청한 사람 또는 SUPER.' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: PublishRequestResultDto })
  @ApiResponse({ status: 422, description: 'PUBLISH_REQ_STATE', type: ErrorDto })
  withdraw(@Param('id', ParseIntPipe) id: number) { return this.svc.withdraw(id); }
}
