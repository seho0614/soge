import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional,
         ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { SearchAdminService } from './search-admin.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/* ─────────────────────────────────────────────────────────────────────
 * 검색 사전 · 성향 학습 — 관리자
 *
 * ★ 20260930 신설. 화면(SB-ADM-DIC-010 · SB-ADM-SEG-010)과 DB
 *   (search_synonyms · search_term_stats · fn_segment_learn)는 있었는데
 *   **그 사이 API 5건이 없었습니다.** 시안에서는 보이지만 실제로는
 *   동의어를 넣을 수도, 성향 학습을 돌릴 수도 없던 상태였습니다.
 *
 *   규칙은 DB 가 집행합니다 — 여기서는 옮기기만 합니다.
 *     syn_kind_check · syn_self_check · UNIQUE(term, kind)
 *     fn_segment_learn — 동의 없는 사람은 바꾸지 않음 · 설정이 off 면 0건
 * ──────────────────────────────────────────────────────────────────── */

export class SynonymDto {
  @ApiProperty({ example: '점포', description: '사람이 치는 말' })
  @IsString() @Length(1, 40) term!: string;

  @ApiProperty({ example: '상가', description: '우리가 저장한 말' })
  @IsString() @Length(1, 40) canonical!: string;

  @ApiProperty({ example: 'CATEGORY', enum: ['GWAN', 'CATEGORY', 'REGION', 'STATE', 'ITEM'] })
  @IsIn(['GWAN', 'CATEGORY', 'REGION', 'STATE', 'ITEM']) kind!: string;

  @ApiPropertyOptional({ example: 5, description: '확신도 1~10. 높으면 바로 바꿉니다' })
  @IsOptional() @IsInt() @Min(1) @Max(10) weight?: number;
}

export class SynonymRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() term!: string;
  @ApiProperty() canonical!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() weight!: number;
  @ApiProperty() createdAt!: string;
}
export class TermStatDto {
  @ApiProperty() term!: string;
  @ApiProperty() hits!: number;
  @ApiProperty({ description: '결과 0건으로 끝난 횟수 — 사전에 넣을 후보' }) zeroHits!: number;
}
export class IntentRowDto {
  @ApiProperty() term!: string;
  @ApiProperty() field!: string;
  @ApiProperty() operator!: string;
  @ApiPropertyOptional() value?: string;
  @ApiProperty() note!: string;
}
export class SearchTermsDto {
  @ApiProperty({ type: [SynonymRowDto] }) synonyms!: SynonymRowDto[];
  @ApiProperty({ type: [IntentRowDto] }) intents!: IntentRowDto[];
  @ApiProperty({ type: [TermStatDto] }) top!: TermStatDto[];
  @ApiProperty({ type: [TermStatDto], description: '0건 검색어 — 동의어가 없어서일 가능성' }) zeroHit!: TermStatDto[];
}
export class OkIdDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() id!: string;
}
export class SegCandidateDto {
  @ApiProperty() accountId!: string;
  @ApiPropertyOptional() currentCode?: string;
  @ApiProperty() toCode!: string;
  @ApiProperty() clicksFrom!: number;
  @ApiProperty() clicksTo!: number;
}
export class SegCandidatesDto {
  @ApiProperty({ description: 'segment.learn.enabled' }) enabled!: boolean;
  @ApiProperty() minClicks!: number;
  @ApiProperty() ratio!: number;
  @ApiProperty({ type: [SegCandidateDto] }) items!: SegCandidateDto[];
  @ApiProperty({ description: '동의 없이 바뀐 건 — 0 이어야 합니다' }) noConsent!: number;
  @ApiProperty({ description: '짧은 기간에 오락가락한 건' }) thrash!: number;
}
export class SegLearnDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() applied!: number;
  @ApiProperty({ type: [SegCandidateDto] }) items!: SegCandidateDto[];
  @ApiProperty() note!: string;
}

@ApiTags('SEARCH-ADMIN')
@ApiBearerAuth()
@Controller('api/v1/admin')
export class SearchAdminController {
  constructor(private readonly svc: SearchAdminService) {}

  @Get('search/terms')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '검색 사전 · 검색어 통계',
    description: '동의어 · 주관 표현 · 많이 찾는 말 · 0건으로 끝난 말. 0건 목록이 사전에 넣을 후보입니다.' })
  @ApiOkResponse({ type: SearchTermsDto })
  terms() { return this.svc.terms(); }

  @Post('search/synonyms')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '동의어 추가',
    description: '같은 말·같은 종류는 하나만 둡니다(409). 자기 자신을 가리키면 거부합니다(422).' })
  @ApiOkResponse({ type: OkIdDto })
  @ApiResponse({ status: 409, type: ErrorDto }) @ApiResponse({ status: 422, type: ErrorDto })
  @Audit('SEARCH_SYNONYM_ADD', 'SEARCH_SYNONYM')
  addSynonym(@Body() dto: SynonymDto) { return this.svc.addSynonym(dto); }

  @Delete('search/synonyms/:id')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '동의어 삭제' })
  @ApiOkResponse({ type: OkIdDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  @Audit('SEARCH_SYNONYM_DEL', 'SEARCH_SYNONYM')
  removeSynonym(@Param('id', ParseUUIDPipe) id: string) { return this.svc.removeSynonym(id); }

  @Get('segments/candidates')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '성향 학습 후보',
    description: '행동(클릭)이 답한 성향과 다르게 쌓인 회원. **동의한 회원만** 대상입니다.' })
  @ApiOkResponse({ type: SegCandidatesDto })
  segCandidates() { return this.svc.segCandidates(); }

  @Post('segments/learn')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '성향 학습 실행',
    description: 'fn_segment_learn() 을 부릅니다. segment.learn.enabled 가 off 면 아무것도 바꾸지 않습니다.' })
  @ApiOkResponse({ type: SegLearnDto })
  @Audit('SEGMENT_LEARN', 'SEGMENT')
  segLearn() { return this.svc.segLearn(); }
}
