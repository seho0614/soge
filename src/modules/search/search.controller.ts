import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { PromptSearchDto, SearchLogDto, SearchSuggestDto } from './search.dto';
import { Roles } from '../../core/auth';

/* 검색어 집계 남용 막기 — 메모리에만(저장하지 않음) */
const LOG_HITS = new Map<string, { at: number; n: number }>();

@ApiTags('SEARCH')
@Controller('api/v1')
export class SearchController {
  constructor(private readonly svc: SearchService) {}

  @Post('search/prompt')
  @ApiOperation({
    summary: '프롬프트 검색',
    description:
      '자유 문장으로 찾습니다. **계정 정보를 함께 보내지 않습니다**(INV-SCH1) — ' +
      '로그인 여부와 무관하게 같은 결과가 나옵니다. ' +
      '원문 검색어는 저장하지 않습니다(INV-SCH2).',
  })
  prompt(@Body() dto: PromptSearchDto) { return this.svc.prompt(dto); }

  /* v10.29 — 검색 팝업(시안 SPOP)의 추천 검색어 · 업종 · 소개자. 읽기 전용 · 로그인 없이 */
  @Get('search/suggest')
  @ApiOperation({
    summary: '검색 팝업 재료',
    description:
      '추천 검색어(제한업종 제외) · 업종 이름 · 소개자(q 가 있을 때)를 돌려줍니다. ' +
      '소개자는 **이름 첫 글자만**(김OO) · 등급 · 지역 · 분야 — 연락처 · 소개글은 내보내지 않습니다. 검색어를 저장하지 않습니다.',
  })
  @ApiOkResponse({ type: SearchSuggestDto })      /* v10.30 — 응답 모양을 문서에 적음(응답은 그대로) */
  suggest(@Query('q') q?: unknown) { return this.svc.suggest(q); }

  /* v10.31 — 검색어 집계 쌓기(시안 추천 검색어의 재료). 검색을 제출하거나 결과 줄을 골랐을 때만 화면이 부릅니다.
   *   로그인 없이 · 계정을 쓰지 않음. 공개 목록에 있는 말만 셉니다(서비스 주석). 같은 곳에서 1분에 20번까지(넘으면 조용히 무시) */
  @Post('search/log')
  @HttpCode(200)
  @ApiOperation({
    summary: '검색어 집계',
    description:
      '검색을 제출할 때 부릅니다. 원문은 저장하지 않고, 낱말로 나눠 **게시된 매물 · 요청 제목 · 업종 이름 · 동의어 사전에 있는 말만** ' +
      'search_term_stats 에 셉니다(제한업종 낱말 · 숫자 3자리 이상 · @ 제외). 응답 recorded 는 센 말.',
  })
  @ApiOkResponse({ type: Object })   /* v10.31 합침 — 응답 모양을 문서에(검정 「구현된 API 에 응답 스키마」) */
  log(@Body() dto: SearchLogDto, @Req() req: { ip?: string }) {
    const key = req.ip ?? '-';
    const now = Date.now();
    const hit = LOG_HITS.get(key);
    if (hit && now - hit.at < 60_000) {
      if (hit.n >= 20) return { recorded: [], throttled: true };
      hit.n += 1;
    } else {
      LOG_HITS.set(key, { at: now, n: 1 });
      if (LOG_HITS.size > 5000) LOG_HITS.clear();
    }
    return this.svc.logTerm(dto.q);
  }

  @ApiBearerAuth()
  @Get('admin/search/parser')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '파서 상태',
    description: '최근 24시간 호출·폴백 비율. 폴백이 잦으면 LLM 이 제 몫을 못 하는 것입니다.',
  })
  parser() { return this.svc.parserHealth(); }
}
