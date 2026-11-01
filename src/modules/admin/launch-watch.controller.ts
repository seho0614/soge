import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LaunchWatchService } from './launch-watch.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';

/* v10.170 (D159 · docs/262) — 공개 직후 지켜보기(운영 화면 첫 화면 카드) */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/launch-watch')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class LaunchWatchController {
  constructor(private readonly svc: LaunchWatchService) {}

  @Get()
  @ApiOperation({ summary: '공개 직후 지켜보기', description: '오늘(한국 날짜) 가입 · 로그인 · 글 · 매물 · 소개몰 주문 · 시험 결제 주문 · 확인 안 한 운영 알림 · 주문 받기 · 간주 결제 스위치 · 판매 중 직판 상품 수.' })
  @ApiOkResponse({ type: Object })
  today() { return this.svc.today(); }
}
