import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SettlementSummaryService } from './settlement-summary.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

const DESC = '① 소개비 정산(상태별 건수 · 금액 · 최근 20) ② 포인트(합계 · 현금화 가능 · 규칙별 · 최근 20 · 출금 신청 · 지급) ③ 제휴 파트너 정산(있을 때만) ④ 소개몰 판매자 정산(있을 때만). 다른 회원의 금액은 넣지 않음. 읽기만.';

/** v10.255 (docs/388) — 정산 내역 한눈에(나의공간 · 운영 화면 회원 상세) */
@ApiTags('MY')
@ApiBearerAuth()
@Controller('api/v1')
export class SettlementSummaryController {
  constructor(private readonly svc: SettlementSummaryService) {}

  @Get('me/settlement-summary')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'REVIEWER', 'ADMIN', 'SUPER')
  @ApiOperation({ summary: '내 정산 내역 한눈에', description: DESC })
  @ApiOkResponse({ type: Object })
  mine() { return this.svc.mine(); }

  @Get('admin/accounts/:id/settlement-summary')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '회원 정산 내역 한눈에(운영)', description: DESC + ' **조회 자체가 감사 로그에 남습니다**(ACCOUNT_SETTLEMENT_VIEW).' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: '없는 회원' })
  @ApiResponse({ status: 403, type: ErrorDto, description: '권한 없음' })
  @Audit('ACCOUNT_SETTLEMENT_VIEW', 'ACCOUNT')
  forAdmin(@Param('id') id: string) { return this.svc.forAdmin(id); }
}
