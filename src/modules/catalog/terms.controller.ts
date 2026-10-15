import { Body, Controller, Get, Param, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TermsService } from './terms.service';
import {
  OpenBlockerDto, PublishTermDto, TermDetailDto,
  TermPublishResultDto, UpsertTermDto,
} from './terms.dto';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/** SB-ADM-SIT-070 법정 고지 · SB-ADM-SIT-040 오픈 체크리스트 */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@Roles('SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class TermsController {
  constructor(private readonly terms: TermsService) {}

  @Get('terms')
  @ApiOperation({
    summary: '약관 전체 (미발행 포함)',
    description:
      'blockedBy 에 무엇 때문에 못 쓰는지 적혀 있습니다. ' +
      '법무 회신이 오면 그 항목이 해소됩니다.',
  })
  @ApiOkResponse({ type: TermDetailDto, isArray: true })
  list() { return this.terms.listAll(); }

  @Put('terms/:code')
  @ApiOperation({
    summary: '약관 초안 저장',
    description:
      '**기존 버전을 덮지 않고 새 버전을 만듭니다.** 이미 동의받은 문서를 고치면 ' +
      '동의 이력의 근거가 사라집니다. 저장만으로는 노출되지 않습니다.',
  })
  @ApiParam({ name: 'code', example: 'SERVICE' })
  @ApiOkResponse({ type: TermDetailDto })
  @ApiResponse({ status: 404, description: '약관 코드 없음', type: ErrorDto })
  @Audit('TERM_DRAFT', 'TERM')
  draft(@Param('code') code: string, @Body() dto: UpsertTermDto) {
    return this.terms.upsertDraft(code, dto);
  }

  @Patch('terms/:code/publish')
  @ApiOperation({
    summary: '약관 발행',
    description:
      '이 시점부터 가입 화면과 푸터에 나타나고, 푸터 링크의 available 이 true 가 됩니다. ' +
      '내용이 비었거나 시행일이 없으면 DB 가 거부합니다. ' +
      '이전 버전은 ARCHIVED 로 남습니다 — 동의 이력이 참조하므로 삭제하지 않습니다.',
  })
  @ApiParam({ name: 'code', example: 'SERVICE' })
  @ApiOkResponse({ type: TermPublishResultDto })
  @ApiResponse({
    status: 422, type: ErrorDto,
    description:
      'TERM_BODY_EMPTY 내용 없음 · TERM_EFFECTIVE_DATE_REQUIRED 시행일 없음 · ' +
      'EFFECTIVE_DATE_IN_PAST 과거 날짜',
  })
  @Audit('TERM_PUBLISH', 'TERM')
  publish(@Param('code') code: string, @Body() dto: PublishTermDto) {
    return this.terms.publish(code, dto);
  }

  @Get('open-blockers')
  @ApiOperation({
    summary: '오픈 차단 항목',
    description:
      '설정 · 약관 · 푸터를 함께 봅니다. 이게 0 이 되어야 prod 배포 점검을 통과합니다.',
  })
  @ApiOkResponse({ type: OpenBlockerDto, isArray: true })
  blockers() { return this.terms.blockers(); }
}
