import { Body, Controller, Get, Param, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TermsService } from './terms.service';
import {
  OpenBlockerDto, OpenDateDto, OpenReadinessDto, PublishTermDto, SetOpenDateDto, TermDetailDto,
  TermPublishResultDto, UnscheduleTermDto, UpsertTermDto,
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
      '동의 이력의 근거가 사라집니다. 저장만으로는 노출되지 않습니다. ' +
      'v10.157 — 같은 번호의 초안 · 법무 검토 판은 고쳐 저장하고, 게시 · 보관된 판 번호는 422 TERM_LOCKED(DB 도 막음 · D150). 응답 holes = 남은 〔미확정〕 수.',
  })
  @ApiParam({ name: 'code', example: 'SERVICE' })
  @ApiOkResponse({ type: TermDetailDto })
  @ApiResponse({ status: 404, description: '약관 코드 없음', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'TERM_LOCKED 게시 · 보관된 판 · TERM_VERSION 판 번호 형식(v10.157)', type: ErrorDto })
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
      '이전 버전은 ARCHIVED 로 남습니다 — 동의 이력이 참조하므로 삭제하지 않습니다. ' +
      'v10.156 — 〔시행일〕 말고 〔…〕 표시가 남아 있으면 거절하고, 본문의 〔시행일〕은 시행일로 채웁니다(scripts/publish-terms.sh 와 같은 규칙). ' +
      'v10.161 (D151) — 시행일이 미래면 **시행 예정**(scheduled=true): 앞 판은 시행일까지 게시 그대로 · 재동의는 시행일부터 · 시행 예정 판은 약관마다 하나(422 TERM_SCHEDULED_EXISTS).',
  })
  @ApiParam({ name: 'code', example: 'SERVICE' })
  @ApiOkResponse({ type: TermPublishResultDto })
  @ApiResponse({
    status: 422, type: ErrorDto,
    description:
      'TERM_BODY_EMPTY 내용 없음 · TERM_EFFECTIVE_DATE_REQUIRED 시행일 없음 · ' +
      'EFFECTIVE_DATE_IN_PAST 과거 날짜 · TERM_HOLES 〔미확정〕 표시가 남음(v10.156) · TERM_ARCHIVED 보관된 판 · TERM_SCHEDULED_EXISTS 시행 예정 판이 이미 있음 · TERM_PUBLISHED 이미 게시된 판(v10.161)',
  })
  @Audit('TERM_PUBLISH', 'TERM')
  publish(@Param('code') code: string, @Body() dto: PublishTermDto) {
    return this.terms.publish(code, dto);
  }

  @Patch('terms/:code/unschedule')
  @ApiOperation({
    summary: '시행 예정 판 게시 취소 (v10.161)',
    description: '시행일 전이고 그 판에 받은 동의가 없을 때만. 법무 검토로 되돌리고(시행일 없음) 본문의 시행일 날짜는 〔시행일〕로 되돌립니다. 앞 판은 그대로 시행 중.',
  })
  @ApiParam({ name: 'code', example: 'SERVICE' })
  @ApiOkResponse({ type: TermPublishResultDto })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TERM_NOT_SCHEDULED 시행 예정 판이 아님 · TERM_HAS_CONSENT 이미 동의 기록이 있음' })
  @Audit('TERM_UNSCHEDULE', 'TERM')
  unschedule(@Param('code') code: string, @Body() dto: UnscheduleTermDto) {
    return this.terms.unschedule(code, dto.version);
  }

  @Get('open-blockers')
  @ApiOperation({
    summary: '오픈 차단 항목',
    description:
      '설정 · 약관 · 푸터를 함께 봅니다. 이게 0 이 되어야 prod 배포 점검을 통과합니다.',
  })
  @ApiOkResponse({ type: OpenBlockerDto, isArray: true })
  blockers() { return this.terms.blockers(); }

  @Get('open-readiness')
  @ApiOperation({
    summary: '오픈 준비 점검 (v10.146)',
    description:
      '본인인증 · 메일 · 가짜(MOCK) 방식 · 소개비 순서(꼭) 와 알림톡 · 전자계약 · 안심번호 · AI(권장)의 ' +
      '지금 값 · 할 일 · 고칠 화면. 꼭 줄이 안 되면 open-blockers 에 READY 로도 나옵니다.',
  })
  @ApiOkResponse({ type: OpenReadinessDto, isArray: true })
  readiness() { return this.terms.readiness(); }

  @Get('open-date')
  @ApiOperation({
    summary: '오픈일 (v10.150)',
    description: '오픈일 · 홍보 기간 종료일(오픈 + 3개월 · 이날부터 요청 열람 한도 자동 적용) · 약관 게시 마감(시행 7일 전 · 불리한 변경 30일 전) · 남은 날.',
  })
  @ApiOkResponse({ type: OpenDateDto })
  openDate() { return this.terms.openDate(); }

  @Put('open-date')
  @ApiOperation({
    summary: '오픈일 넣기 (v10.150)',
    description: '오픈일을 넣으면 홍보 기간 종료일(request.view.limit_from)을 오픈 + 3개월로 함께 넣습니다. ' +
      '빈 문자열이면 오픈일만 지웁니다. 약관 시행일은 바꾸지 않습니다(게시는 법정 고지 화면에서).',
  })
  @ApiOkResponse({ type: OpenDateDto })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPEN_DATE_PAST 지난 날짜 · OPEN_DATE_INVALID 없는 날짜' })
  @Audit('OPEN_DATE_SET', 'SETTING')
  setOpenDate(@Body() dto: SetOpenDateDto) { return this.terms.setOpenDate(dto.date); }
}

