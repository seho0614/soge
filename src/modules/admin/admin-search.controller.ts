import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminSearchService } from './admin-search.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';

/** v10.289 (docs/413) 운영 화면 전체 찾기 — 운영 화면 계정 모두 · 묶음은 역할마다 */
@ApiTags('ADMIN')
@ApiBearerAuth()
@Controller('api/v1/admin/search')
@Roles('REVIEWER', 'ADMIN', 'PAYOUT', 'SUPER', 'PARTNER_MAL', 'PARTNER_AFF')
export class AdminSearchController {
  constructor(private readonly svc: AdminSearchService) {}

  @Get()
  @ApiOperation({ summary: '운영 화면 전체 찾기', description: 'v10.289 회원 · 소개몰 주문 · 판매자 · 공지 · 매물 · 거래를 묶음마다 5건 — 이름 · 이메일은 가린 값 · 역할마다 볼 수 있는 묶음만 · 감사 ADMIN_SEARCH(찾은 말 앞 2자).' })
  @ApiQuery({ name: 'q', description: '두 글자 이상(이름 · 이메일 · 휴대폰 4자리 이상 · 주문번호 · 판매자 코드 · 제목 · 번호)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, description: 'QUERY_TOO_SHORT', type: ErrorDto })
  search(@Query('q') q: string, @Req() req: { principal?: { roles?: string[] } }) {
    return this.svc.search(q, req.principal?.roles ?? []);
  }
}
