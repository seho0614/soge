import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';
import { LaunchWatchService } from './launch-watch.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/* v10.173 — 시험 결제 주문 정리: 주문번호를 주면 그 주문만(없으면 전부) */
export class LaunchStubCancelDto {
  @ApiPropertyOptional({ type: [String], description: '정리할 주문번호(없으면 시험 결제 주문 전부)' })
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) orderNos?: string[];
}

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

  /* v10.172 (docs/265) — 어제 하루 요약을 지금 보기(정기 작업 launch_digest 와 같은 글 · 알림 · 메일은 남기지 않음) */
  @Get('digest')
  @ApiOperation({ summary: '어제 하루 요약 보기', description: '매일 09:00 정기 작업이 남기는 하루 요약과 같은 숫자 · 글을 지금 계산해 돌려줌. 운영 알림 · 메일은 만들지 않음.' })
  @ApiOkResponse({ type: Object })
  digest() { return this.svc.digest(); }

  /* v10.173 (D162 · docs/266) — 시험 결제 주문 정리(발송 전만 취소 · 주문한 분께 알림 · 감사 기록) */
  @Post('stub-orders/cancel')
  @Roles('SUPER')
  @Audit('LAUNCH_STUB_ORDERS_CANCEL', 'HLT_ORDER')
  @ApiOperation({ summary: '시험 결제 주문 정리', description: '시험 결제(stub)로 결제 완료된 소개몰 주문 중 발송 전(PAID · PREPARING)을 모두(orderNos 를 주면 그 주문만) 취소하고 주문한 분께 알림. 발송한 주문은 manual 로 돌려줌. 돈은 받지 않았으므로 환불 없음.' })
  @ApiOkResponse({ type: Object })
  cancelStub(@Body() dto: LaunchStubCancelDto) { return this.svc.cancelStubOrders(dto.orderNos); }
}
