import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiBearerAuth, ApiExtraModels, ApiOkResponse, ApiOperation,
  ApiParam, ApiResponse, ApiTags, getSchemaPath,
} from '@nestjs/swagger';
import { ReviewService } from './review.service';
import {
  DecideReviewDto, ReviewDecisionResultDto, ReviewItemDto,
  ReviewQueueQueryDto, ReviewThroughputDto,
} from './review.dto';
import { ErrorDto, PageDto } from '../../common/dto/common.dto';
import { Roles, RequireGate } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { RequestCtx } from '../../core/request-context';
import { Forbidden } from '../../core/errors';

/** SB-ADM-REV-010 / 020 */
@ApiTags('ADM')
@ApiBearerAuth()
@ApiExtraModels(PageDto, ReviewItemDto)
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
@ApiResponse({ status: 403, description: '권한 없음 · 게이트 미충족', type: ErrorDto })
@Controller('api/v1/admin/reviews')
@Roles('REVIEWER', 'ADMIN', 'SUPER')
export class ReviewController {
  constructor(private readonly service: ReviewService) {}

  @Get()
  @ApiOperation({
    summary: '검수 큐',
    description:
      'SLA 마감 순으로 정렬합니다. 자동 승인된 건은 이 목록에 없습니다 — 표본 감사에만 나옵니다.',
  })
  @ApiOkResponse({
    schema: {
      allOf: [
        { $ref: getSchemaPath(PageDto) },
        { properties: { items: { type: 'array', items: { $ref: getSchemaPath(ReviewItemDto) } } } },
      ],
    },
  })
  queue(@Query() q: ReviewQueueQueryDto) {
    return this.service.queue(q.gwanCode, q.cursor, q.status);
  }

  @Get('counts')
  @ApiOperation({ summary: '검수 큐 탭 숫자', description: 'v10.31 — 대기 · SLA 임박(4시간 미만) · SLA 초과 · 반려(최근 30일)' })
  counts(@Query('gwanCode') gwanCode?: string) {
    return this.service.counts(gwanCode);
  }

  @Get('throughput')
  @ApiOperation({
    summary: '검수 처리량',
    description: '일별 접수·처리·대기·SLA 위반. 검수가 병목이므로 상시 노출합니다.',
  })
  @ApiOkResponse({ type: ReviewThroughputDto, isArray: true })
  throughput() {
    return this.service.throughput();
  }

  @Get(':id')
  @ApiOperation({ summary: '검수 건 상세' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReviewItemDto })
  @ApiResponse({ status: 404, description: '검수 건 없음', type: ErrorDto })
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: '검수 승인 · 반려',
    description:
      '승인 시 대상의 상태가 같은 트랜잭션에서 전이됩니다. ' +
      '반려는 reasonCode 가 필수이며 DB CHECK 가 강제합니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReviewDecisionResultDto })
  @ApiResponse({
    status: 409, type: ErrorDto,
    description: 'ALREADY_DECIDED — 이미 처리된 건. 재시도해도 같은 결과입니다',
  })
  @ApiResponse({
    status: 422, type: ErrorDto,
    description: '정책 위반. 반려 사유 누락 등',
  })
  @Audit('REVIEW_DECIDE', 'REVIEW_ITEM')
  decide(@Param('id') id: string, @Body() dto: DecideReviewDto) {
    /* ★ 20260930 — 전에는 '0000…0000' 을 박아 두었습니다(“가드에서 주입 예정”).
     *   accounts 에 없는 id 라 decision_by 외래키에 걸려 **검수 승인·반려가
     *   한 건도 되지 않았습니다**(실측 409 REFERENCE). 매물·요청이 공개되지 않습니다.
     *   가드가 이미 principal 을 RequestCtx 에 넣으므로 그것을 씁니다. */
    const actorId = RequestCtx.actorId();
    if (!actorId) throw new Forbidden('UNAUTHENTICATED', '로그인이 필요합니다.');
    return this.service.decide(id, actorId, dto);
  }
}
