import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { IntegTestService } from './integ-test.service';

/* ---------------------------------------------------------------------
 * v10.144 (D140 · docs/220 · 설계 docs/218) — 운영 화면 › 외부 연동 › 「결제 · 계좌 연결 확인」 (SB-ADM-SIT-080 안의 한 구역)
 *
 *   ADMIN · SUPER  GET  /admin/integ-tests                상태(키 있음 · 종류 · 짝 · 마지막 성공 · 1원 남은 수) · 최근 시험 30줄
 *   SUPER          POST /admin/integ-tests/pg-check       토스 키 확인(돈 안 나감 · 감사 INTEG_TEST_PG)
 *   SUPER          POST /admin/integ-tests/bank-send      1원 보내기(본인 계좌 · 하루 integ.bank_test_daily · 감사 INTEG_TEST_BANK)
 *   SUPER          POST /admin/integ-tests/bank-confirm   통장 코드 확인(30분 · 다섯 번)
 *   SUPER          POST /admin/integ-tests/etax-test      세금계산서 키 확인(발행 없음) + 업체 시험 주소로 시험 발행 1건(v10.155 · 하루 integ.etax_test_daily · 감사 INTEG_TEST_ETAX)
 *   ★ DTO 는 쓰는 곳보다 위에(ts-node strict 끔 — 선언 순서)
 * ------------------------------------------------------------------- */

export class IntegPgStateDto {
  @ApiPropertyOptional({ nullable: true }) status!: string | null;
  @ApiProperty() secretKey!: boolean;
  @ApiPropertyOptional({ nullable: true, enum: ['test', 'live'] }) keyMode!: string | null;
  @ApiPropertyOptional({ nullable: true, enum: ['test', 'live'] }) clientKey!: string | null;
  @ApiProperty({ description: '시크릿 · 클라이언트 키가 같은 종류(test · live)' }) pair!: boolean;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) lastOkAt!: string | null;
}
export class IntegBankQuotaDto {
  @ApiProperty() limit!: number;
  @ApiProperty() used!: number;
  @ApiProperty() left!: number;
}
export class IntegBankStateDto {
  @ApiPropertyOptional({ nullable: true }) status!: string | null;
  @ApiProperty() key!: boolean;
  @ApiProperty() url!: boolean;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) lastOkAt!: string | null;
  @ApiProperty({ type: IntegBankQuotaDto }) test!: IntegBankQuotaDto;
}
export class IntegEtaxStateDto {   // v10.155 (D148) — IntegTestStatusDto 보다 먼저(ts-node 선언 순서)
  @ApiPropertyOptional({ nullable: true }) status!: string | null;
  @ApiProperty({ description: 'ETAX_URL(.env) 있음' }) url!: boolean;
  @ApiProperty({ description: 'ETAX_KEY 있음' }) key!: boolean;
  @ApiProperty({ description: 'ETAX_TEST_URL(.env · 업체 시험 주소) 있음' }) testUrl!: boolean;
  @ApiPropertyOptional({ nullable: true, enum: ['ETAX_TEST_KEY', 'ETAX_KEY'], description: '시험 발행에 쓰는 키 이름' }) testKey!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) lastKeyOkAt!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) lastIssueOkAt!: string | null;
  @ApiProperty({ description: 'etax.require_config — 켜져 있으면 7일 안 키 확인 · 시험 발행 성공이 있어야 간주를 끔' }) requireTest!: boolean;
  @ApiProperty({ type: IntegBankQuotaDto }) test!: IntegBankQuotaDto;
}
export class IntegTestRowDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['PG', 'BANK', 'ETAX'] }) code!: string;
  @ApiProperty({ enum: ['PG_KEY', 'BANK_SEND', 'BANK_CONFIRM', 'ETAX_KEY', 'ETAX_TEST_ISSUE'] }) kind!: string;
  @ApiProperty() ok!: boolean;
  @ApiProperty() stub!: boolean;
  @ApiPropertyOptional({ nullable: true }) errorKind!: string | null;
  @ApiPropertyOptional({ nullable: true }) detail!: string | null;
  @ApiPropertyOptional({ nullable: true }) keyMode!: string | null;
  @ApiPropertyOptional({ nullable: true }) accountLast4!: string | null;
  @ApiProperty() pending!: boolean;
  @ApiProperty({ format: 'date-time' }) at!: string;
}
export class IntegTestStatusDto {
  @ApiProperty({ type: IntegPgStateDto }) pg!: IntegPgStateDto;
  @ApiProperty({ type: IntegBankStateDto }) bank!: IntegBankStateDto;
  @ApiProperty({ type: IntegEtaxStateDto }) etax!: IntegEtaxStateDto;
  @ApiProperty({ type: [IntegTestRowDto] }) recent!: IntegTestRowDto[];
}
export class IntegPgCheckDto {
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ nullable: true, enum: ['NOT_CONFIGURED', 'AUTH', 'TIMEOUT', 'NETWORK', 'UPSTREAM', 'HTTP_4XX', 'BAD_RESPONSE'] }) errorKind!: string | null;
  @ApiPropertyOptional({ nullable: true }) keyMode!: string | null;
  @ApiPropertyOptional({ nullable: true }) clientKey!: string | null;
  @ApiProperty() pair!: boolean;
  @ApiProperty() detail!: string;
}
export class IntegEtaxPartDto {
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ nullable: true, enum: ['NOT_CONFIGURED', 'SAME_URL', 'SUPPLIER', 'PENDING', 'AUTH', 'TIMEOUT', 'NETWORK', 'UPSTREAM', 'HTTP_4XX', 'BAD_RESPONSE'] }) errorKind!: string | null;
  @ApiProperty() detail!: string;
}
export class IntegEtaxIssueDto extends IntegEtaxPartDto {
  @ApiPropertyOptional({ nullable: true, example: '20261030-00000000-00000001', description: '시험 발행 승인번호(8-8-8)' }) approvalNo!: string | null;
}
export class IntegEtaxTestDto {
  @ApiProperty({ description: '키 확인 · 시험 발행 둘 다 성공' }) ok!: boolean;
  @ApiProperty({ type: IntegEtaxPartDto }) key!: IntegEtaxPartDto;
  @ApiProperty({ type: IntegEtaxIssueDto }) issue!: IntegEtaxIssueDto;
  @ApiProperty() left!: number;
}
export class IntegBankSendDto {
  @ApiProperty({ example: '004', description: '은행 코드(숫자 3자리)' }) @IsString() @Matches(/^\d{3}$/) bankCode!: string;
  @ApiProperty({ example: '1002123456789' }) @IsString() @MaxLength(30) accountNo!: string;
  @ApiProperty({ example: '홍길동' }) @IsString() @MaxLength(40) holderName!: string;
}
export class IntegBankSendResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() stub!: boolean;
  @ApiPropertyOptional() testId?: string;
  @ApiPropertyOptional({ example: '***6789' }) account?: string;
  @ApiPropertyOptional() expiresInMin?: number;
  @ApiPropertyOptional({ nullable: true }) errorKind?: string | null;
  @ApiProperty() detail!: string;
  @ApiProperty() left!: number;
}
export class IntegBankConfirmDto {
  @ApiProperty() @IsString() @MaxLength(30) testId!: string;
  @ApiProperty({ example: 'SGB01' }) @IsString() @MaxLength(20) code!: string;
}
export class IntegBankConfirmResultDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() stub!: boolean;
  @ApiPropertyOptional({ nullable: true }) errorKind?: string | null;
  @ApiPropertyOptional() triesLeft?: number;
  @ApiProperty() detail!: string;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/integ-tests')
export class IntegTestController {
  constructor(private readonly svc: IntegTestService) {}

  @Get()
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '결제 · 계좌 연결 확인 상태 (v10.144)', description: '키 있음(값 없이) · 키 종류 · 짝 · 마지막 성공 · 1원 남은 수 · 최근 시험 30줄. 계좌는 끝 4자리만.' })
  @ApiOkResponse({ type: IntegTestStatusDto })
  status() { return this.svc.status(); }

  @Post('pg-check')
  @Roles('SUPER')
  @ApiOperation({ summary: '토스 결제 키 확인 (v10.144)', description: '없는 주문 번호를 조회해 404 면 키가 맞음 · 401/403 이면 틀림. **돈이 나가지 않습니다.** 결과는 시험 기록에 남고 LIVE 근거가 됩니다.' })
  @ApiOkResponse({ type: IntegPgCheckDto })
  @Audit('INTEG_TEST_PG', 'INTEGRATION')
  pgCheck() { return this.svc.pgCheck(); }

  @Post('bank-send')
  @Roles('SUPER')
  @ApiOperation({ summary: '1원 계좌인증 시험 — 보내기 (v10.144)', description: '본인 계좌로 1원(우리 돈 + 업체 요금). 하루 integ.bank_test_daily 번 · 방금 보낸 시험이 있으면 409. 키가 없으면 스텁(코드 SGB01 · LIVE 근거 안 됨).' })
  @ApiResponse({ status: 409, description: 'BANK_TEST_BUSY', type: ErrorDto })
  @ApiResponse({ status: 422, description: 'BANK_TEST_INPUT · BANK_TEST_LIMIT', type: ErrorDto })
  @ApiOkResponse({ type: IntegBankSendResultDto })
  @Audit('INTEG_TEST_BANK', 'INTEGRATION')
  bankSend(@Body() dto: IntegBankSendDto) { return this.svc.bankSend(dto); }

  @Post('bank-confirm')
  @Roles('SUPER')
  @ApiOperation({ summary: '1원 계좌인증 시험 — 코드 확인 (v10.144)', description: '통장 입금자명의 코드. 30분 · 다섯 번 틀리면 닫힘.' })
  @ApiResponse({ status: 409, description: 'BANK_TEST_NOT_PENDING · BANK_TEST_EXPIRED', type: ErrorDto })
  @ApiOkResponse({ type: IntegBankConfirmResultDto })
  @Audit('INTEG_TEST_BANK', 'INTEGRATION')
  bankConfirm(@Body() dto: IntegBankConfirmDto) { return this.svc.bankConfirm(dto.testId, dto.code); }

  @Post('etax-test')
  @Roles('SUPER')
  @ApiOperation({ summary: '세금계산서 키 확인 · 시험 발행 (v10.155)', description: '① 운영 주소(ETAX_URL)에 없는 문서를 조회해 404 면 키가 맞음(발행 없음) ② 업체 **시험 주소(ETAX_TEST_URL)** 로 1,000원 시험 발행 1건 — 승인번호 24자리면 성공. 시험 주소가 없거나 운영 주소와 같으면 보내지 않음. 둘 다 7일 안 성공이 간주(assume.etax)를 끄는 근거(etax.require_config on).' })
  @ApiResponse({ status: 422, description: 'ETAX_TEST_LIMIT', type: ErrorDto })
  @ApiOkResponse({ type: IntegEtaxTestDto })
  @Audit('INTEG_TEST_ETAX', 'INTEGRATION')
  etaxTest() { return this.svc.etaxTest(); }
}
