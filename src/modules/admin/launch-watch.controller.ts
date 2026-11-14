import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { LaunchWatchService } from './launch-watch.service';
import { StateCheckService } from './state-check.service';
import { OwnerTodoService } from './owner-todo.service';
import { ReleaseLogService } from './release-log.service';
import { ServerTrendService } from './server-trend.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/* v10.173 — 시험 결제 주문 정리: 주문번호를 주면 그 주문만(없으면 전부) */
export class LaunchStubCancelDto {
  @ApiPropertyOptional({ type: [String], description: '정리할 주문번호(없으면 시험 결제 주문 전부)' })
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) orderNos?: string[];
}

/* v10.241 (D201 · docs/381) — 대표 할 일 직접 확인 줄 끝남 · 다시 아직 적기 */
export class OwnerTodoMarkDto {
  @ApiProperty({ enum: ['plans', 'legal', 'ebs', 'rate-legal'], description: '직접 확인 줄 — plans 요금제 금액 · legal 법무 · 세무 · ebs EBS 스냅샷 예약 · rate-legal 요율 공지 방식 법무 알림(v10.284)' })
  @IsString() @IsIn(['plans', 'legal', 'ebs', 'rate-legal']) key!: string;
  @ApiProperty({ description: 'true 끝남 · false 다시 아직' })
  @IsBoolean() done!: boolean;
  @ApiProperty({ description: '메모 5 ~ 500자(무엇을 언제 했는지)' })
  @IsString() @Length(5, 500) note!: string;
}

/* v10.170 (D159 · docs/262) — 공개 직후 지켜보기(운영 화면 첫 화면 카드) */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/launch-watch')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class LaunchWatchController {
  constructor(private readonly svc: LaunchWatchService, private readonly state: StateCheckService, private readonly todo: OwnerTodoService,
              private readonly releases: ReleaseLogService, private readonly trend: ServerTrendService) {}

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
  @ApiOperation({ summary: '대표 할 일 자동 점검표', description: '급한 알림 받는 길 · 확인 안 한 CRITICAL · 접속 인증 · 운영자 2단계 인증 · 외부 연동 신청일 · 업종 정정신고 · 입점 약관 · 검색 사이트 소유 확인 · 위치기반 신고번호는 DB 로 done(true · false), 지난달 개인정보 접속기록 점검 · 지난 분기 운영자 권한 점검 · 기한 2일 안 권리 요청(v10.242)도 DB 로. 요금제 금액 · 법무 · 세무 · EBS 스냅샷 예약은 manual — 적은 기록(mark)이 없으면 done null(직접 확인 · v10.241). total 은 모든 줄 · done 은 ✓ 인 줄. 읽기만.' })
  @ApiOkResponse({ type: Object })
  ownerTodo() { return this.todo.rows(); }

  /* v10.241 (D201 · docs/381) — 직접 확인 줄(요금제 · 법무 · EBS) 끝남 · 다시 아직(쌓기만 · 가장 최근 줄이 상태) */
  @Post('owner-todo/mark')
  @Roles('SUPER')
  @Audit('OWNER_TODO_MARK', 'OWNER_TODO')
  @ApiOperation({ summary: '대표 할 일 직접 확인 줄 적기', description: '요금제 금액 확정 · 법무 · 세무 확인 · EBS 스냅샷 예약 줄에 끝남(done true) · 다시 아직(false)을 메모와 함께 적음. audit.owner_todo_marks 에 쌓기만(고치거나 지울 수 없음) · 가장 최근 줄이 그 줄 상태. SUPER.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OWNER_TODO_KEY · OWNER_TODO_DONE · OWNER_TODO_NOTE' })
  ownerTodoMark(@Body() dto: OwnerTodoMarkDto) { return this.todo.mark(dto.key, dto.done, dto.note); }

  /* v10.246 (docs/383) — 직접 확인 줄 지난 기록(최근 20줄 · 읽기만) */
  @Get('owner-todo/marks')
  @ApiOperation({ summary: '대표 할 일 직접 확인 줄 지난 기록', description: 'key = plans · legal · ebs. 그 줄에 적은 끝남 · 다시 아직 기록 최근 20줄(시각 · 누가 · done · 메모) · total 은 전체 수. 읽기만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OWNER_TODO_KEY' })
  ownerTodoMarks(@Query('key') key: string) { return this.todo.marks(key); }

  /* v10.244 (D202 · docs/383) — 지금 판 · 운영 적용 기록(첫 화면 카드 · 읽기만) */
  @Get('releases')
  @ApiOperation({ summary: '지금 판 · 운영 적용 기록', description: 'now = 이 API 의 판(VERSION) · 뜬 시각, rows = ops_release_log 최근 10줄(API 가 뜰 때 판이 바뀌었으면 한 줄 · kind FIRST · UP · BACK · OTHER), postcheck = 서버에 남은 가장 최근 postcheck 결과 파일의 통과 · 실패 · 확인 · [11] 같음 · 바뀜(없으면 null). 읽기만.' })
  @ApiOkResponse({ type: Object })
  releaseLog() { return this.releases.list(); }

  /* v10.247 (docs/386) — 적용 스크립트 결과 파일 최근 10개 · 본문(SUPER · 읽기만) */
  @Get('releases/files')
  @Roles('SUPER')
  @ApiOperation({ summary: '적용 결과 파일 목록', description: '서버 DATA_DIR(기본 ~/sgb-data)/logs 의 precheck · postcheck · apply · cleanup · open-prep 결과 파일(이름 형식 종류_YYYYMMDD_HHMMSS.txt) 최근 10개 — 이름 · 종류 · 시각(파일 이름 · 서버 시각) · 크기. 빌드 기록 · precheck_state.txt 는 뺌. SUPER · 읽기만.' })
  @ApiOkResponse({ type: Object })
  releaseFiles() { return this.releases.files(); }

  @Get('releases/file')
  @Roles('SUPER')
  @ApiOperation({ summary: '적용 결과 파일 본문', description: 'name = 결과 파일 이름(목록의 name). 이름 형식이 맞는 것만 · 앞 200KB(넘으면 truncated true) · 다른 폴더 · 다른 파일은 열 수 없음. SUPER · 읽기만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'OPS_FILE_NAME · OPS_FILE_MISSING' })
  releaseFile(@Query('name') name: string) { return this.releases.file(name); }

  /* v10.248 (D203 · docs/386) — 서버 자원 추세(최근 30일 · 기준까지 남은 날 · 읽기만) */
  @Get('server-trend')
  @ApiOperation({ summary: '서버 자원 추세', description: 'rows = ops_server_daily 최근 30일(오래된 것부터 · day · disk % · freeGB · mem %), slope = 최근 14일 디스크 하루 증가 %p(3일 이상 기록일 때), daysToLimit = 이대로면 limit(ops.disk_warn_pct)까지 남은 날(늘지 않으면 null). 읽기만.' })
  @ApiOkResponse({ type: Object })
  serverTrend() { return this.trend.trend(); }

  /* v10.182 (D171 · docs/285) — 최근 서버 오류 50건(SB-ADM-ERR-010) */
  @Get('server-errors')
  @ApiOperation({ summary: '최근 서버 오류', description: '이 API 프로세스가 지난 1시간 보낸 5xx 최근 50건 — 시각 · 방법 · 주소(물음표 뒤 없음) · 응답 번호 · 오류 종류 · 요청 번호 · 가린 설명. 요청 내용 · 개인정보 없음 · 다시 띄우면 지워짐. v10.250 (D204) — week = 최근 7일 날짜별 건수 · 많이 난 것 20줄(10분마다 DB 에 모음 · 30일 보관).' })
  @ApiOkResponse({ type: Object })
  serverErrors() { return this.svc.serverErrors(); }

  /* v10.252 (docs/387) — 지난 7일 운영 알림 종류별(운영 알림 화면 위 표 · 주간 알림과 같은 숫자 · 읽기만) */
  @Get('alerts-week')
  @ApiOperation({ summary: '지난 7일 운영 알림 종류별', description: 'rows = 종류(alert_code)마다 건수 · 가장 높은 등급 · 확인 안 한 수(확인 · 풀림 아닌 것) · 마지막 시각 · 마지막 제목(급함 → 경고 → 정보 · 건수 순 · 40종류까지), warnTotal · warnOpen = 경고 이상 합계 · 확인 안 한 합계. 읽기만.' })
  @ApiOkResponse({ type: Object })
  alertsWeek() { return this.svc.alertsWeek(); }

  /* v10.173 (D162 · docs/266) — 시험 결제 주문 정리(발송 전만 취소 · 주문한 분께 알림 · 감사 기록) */
  @Post('stub-orders/cancel')
  @Roles('SUPER')
  @Audit('LAUNCH_STUB_ORDERS_CANCEL', 'HLT_ORDER')
  @ApiOperation({ summary: '시험 결제 주문 정리', description: '시험 결제(stub)로 결제 완료된 소개몰 주문 중 발송 전(PAID · PREPARING)을 모두(orderNos 를 주면 그 주문만) 취소하고 주문한 분께 알림. 발송한 주문은 manual 로 돌려줌. 돈은 받지 않았으므로 환불 없음.' })
  @ApiOkResponse({ type: Object })
  cancelStub(@Body() dto: LaunchStubCancelDto) { return this.svc.cancelStubOrders(dto.orderNos); }
}
