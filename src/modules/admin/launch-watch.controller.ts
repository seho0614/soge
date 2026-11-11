import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';
import { LaunchWatchService } from './launch-watch.service';
import { StateCheckService } from './state-check.service';
import { OwnerTodoService } from './owner-todo.service';
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
  constructor(private readonly svc: LaunchWatchService, private readonly state: StateCheckService, private readonly todo: OwnerTodoService) {}

  @Get()
  @ApiOperation({ summary: '공개 직후 지켜보기', description: '오늘(한국 날짜) 가입 · 로그인 · 글 · 매물 · 소개몰 주문 · 시험 결제 주문 · 확인 안 한 운영 알림 · 주문 받기 · 간주 결제 스위치 · 판매 중 직판 상품 수.' })
  @ApiOkResponse({ type: Object })
  today() { return this.svc.today(); }

  /* v10.172 (docs/265) — 어제 하루 요약을 지금 보기(정기 작업 launch_digest 와 같은 글 · 알림 · 메일은 남기지 않음) */
  @Get('digest')
  @ApiOperation({ summary: '어제 하루 요약 보기', description: '매일 09:00 정기 작업이 남기는 하루 요약과 같은 숫자 · 글을 지금 계산해 돌려줌. 운영 알림 · 메일은 만들지 않음.' })
  @ApiOkResponse({ type: Object })
  digest() { return this.svc.digest(); }

  /* v10.212 (docs/340) — 운영 상태 한눈에(첫 화면 카드 · 운영 적용 뒤 화면 확인을 한 표로) */
  @Get('state')
  @ApiOperation({ summary: '운영 상태 한눈에', description: 'AI 잠금 · 약관 초안 빈칸 · 위탁 목록 · 공휴일 · 요금제 금액 · 개봉 반품 재고 · 메일 반송 · 동네 인증 · 동네픽 후보 · 운영 알림을 한 줄씩. state 는 ok · todo(할 일 남음) · warn(바로 볼 것) · info(값만) · go 는 운영 화면 탭. 읽기만.' })
  @ApiOkResponse({ type: Object })
  stateRows() { return this.state.rows(); }

  /* v10.240 (docs/379) — 대표 할 일 자동 점검표(첫 화면 카드 · DB 로 확인되는 것은 저절로 「됨」) */
  @Get('owner-todo')
  @ApiOperation({ summary: '대표 할 일 자동 점검표', description: '급한 알림 받는 길 · 확인 안 한 CRITICAL · 접속 인증 · 운영자 2단계 인증 · 외부 연동 신청일 · 업종 정정신고 · 입점 약관 · 검색 사이트 소유 확인 · 위치기반 신고번호는 DB 로 done(true · false), 요금제 금액 · 법무 · 세무 · EBS 스냅샷 예약은 done null(직접 확인). done · total 은 자동 항목만 셈. 읽기만.' })
  @ApiOkResponse({ type: Object })
  ownerTodo() { return this.todo.rows(); }

  /* v10.182 (D171 · docs/285) — 최근 서버 오류 50건(SB-ADM-ERR-010) */
  @Get('server-errors')
  @ApiOperation({ summary: '최근 서버 오류', description: '이 API 프로세스가 지난 1시간 보낸 5xx 최근 50건 — 시각 · 방법 · 주소(물음표 뒤 없음) · 응답 번호 · 오류 종류 · 요청 번호 · 가린 설명. 요청 내용 · 개인정보 없음 · 다시 띄우면 지워짐.' })
  @ApiOkResponse({ type: Object })
  serverErrors() { return this.svc.serverErrors(); }

  /* v10.173 (D162 · docs/266) — 시험 결제 주문 정리(발송 전만 취소 · 주문한 분께 알림 · 감사 기록) */
  @Post('stub-orders/cancel')
  @Roles('SUPER')
  @Audit('LAUNCH_STUB_ORDERS_CANCEL', 'HLT_ORDER')
  @ApiOperation({ summary: '시험 결제 주문 정리', description: '시험 결제(stub)로 결제 완료된 소개몰 주문 중 발송 전(PAID · PREPARING)을 모두(orderNos 를 주면 그 주문만) 취소하고 주문한 분께 알림. 발송한 주문은 manual 로 돌려줌. 돈은 받지 않았으므로 환불 없음.' })
  @ApiOkResponse({ type: Object })
  cancelStub(@Body() dto: LaunchStubCancelDto) { return this.svc.cancelStubOrders(dto.orderNos); }
}
