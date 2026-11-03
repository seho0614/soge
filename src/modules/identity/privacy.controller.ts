import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, Length } from 'class-validator';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { PRIVACY_KINDS, PrivacyService } from './privacy.service';

/* ★ DTO 는 쓰는 곳(컨트롤러)보다 위에 둡니다 — 개발 API(ts-node · strict:false)는 뒤에 선언된 클래스면 뜨지 않습니다. */

export class PasswordConfirmDto {
  @ApiProperty({ description: '지금 비밀번호(본인 확인) — 틀리면 로그인 실패와 같이 셈' })
  @IsString() @Length(1, 100) password!: string;
}

export class PrivacyRequestDto {
  @ApiProperty({ enum: Object.keys(PRIVACY_KINDS), description: 'ACCESS 열람 · CORRECT 정정 · DELETE 삭제 · SUSPEND 처리정지' })
  @IsIn(Object.keys(PRIVACY_KINDS)) kind!: string;

  @ApiProperty({ example: '소개광장에 쓴 글 가운데 휴대폰 번호가 들어간 글을 지워 주십시오.', description: '요청 내용(5 ~ 1000자)' })
  @IsString() @Length(5, 1000) body!: string;
}

export class PrivacyDecideDto {
  @ApiProperty({ enum: ['DONE', 'REJECT', 'EXTEND'], description: 'DONE 처리 완료 · REJECT 거절 · EXTEND 기한 연장(한 번)' })
  @IsIn(['DONE', 'REJECT', 'EXTEND']) action!: string;

  @ApiProperty({ example: '요청하신 글 2건의 휴대폰 번호를 지웠습니다.', description: '처리 결과(5 ~ 1000자) 또는 연장 사유(5 ~ 500자) — 회원에게 그대로 알림' })
  @IsString() @Length(5, 1000) note!: string;
}

export class TokensNoteDto {
  @ApiProperty() ok!: boolean;
  @ApiProperty() note!: string;
  @ApiProperty({ description: '새 access — 그 전 증표는 무효' }) accessToken!: string;
  @ApiProperty({ description: '새 refresh' }) refreshToken!: string;
}

const MEMBER = ['MEMBER', 'BIZ_OWNER', 'BIZ_STAFF'] as const;

/**
 * v10.181 (D170 · docs/283) — SB-MYP-DAT-010 내 정보 내려받기 · SB-MYP-SEC-010 로그인 기록 · 모든 기기 로그아웃 ·
 *   SB-MYP-PRV-010 개인정보 권리 요청 · SB-ADM-PRQ-010 권리 요청 처리
 *   내려받기 · 로그아웃은 응답(내 정보 · 새 증표)이 감사 기록에 들어가지 않도록 @Audit 을 쓰지 않습니다(서비스가 결과만 남김).
 */
@ApiTags('MYP')
@ApiBearerAuth()
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
@Controller('api/v1')
export class PrivacyController {
  constructor(private readonly svc: PrivacyService) {}

  @Get('me/data-export')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '내 정보 내려받기 — 오늘 남은 횟수', description: '하루 privacy.export_daily(3)번 · 들어가는 칸 목록.' })
  @ApiOkResponse({ type: Object })
  exportStatus() { return this.svc.exportStatus(); }

  @Post('me/data-export')
  @HttpCode(200)
  @Roles(...MEMBER)
  @ApiOperation({ summary: '내 정보 내려받기', description: '비밀번호 확인 뒤 본인 정보를 JSON 하나로(프로필 · 약관 동의 · 매물 · 요청 · 소개코드 · 소개비 · 소개광장 글 · 댓글 · 투표 · 관심 · 동네 · 소개몰 주문 · 반품 · 배송지 · 포인트 · 알림 · 문의 · 권리 요청 · 로그인 기록). 다른 회원 정보 · 운영 내부 메모 · 비밀값 없음. 감사 기록 MY_DATA_EXPORT(건수만).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'CURRENT_PASSWORD_WRONG' })
  @ApiResponse({ status: 423, type: ErrorDto, description: 'ACCOUNT_LOCKED' })
  @ApiResponse({ status: 429, type: ErrorDto, description: 'EXPORT_DAILY_LIMIT · TOO_MANY_ATTEMPTS' })
  exportData(@Body() dto: PasswordConfirmDto) { return this.svc.exportData(dto.password); }

  @Get('me/login-history')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '내 로그인 기록', description: '최근 30건 — 시각 · 성공/비밀번호 틀림 · IP 앞 두 마디 · 브라우저/OS 종류 · 보관 날수 · 지난 7일 틀린 횟수.' })
  @ApiOkResponse({ type: Object })
  loginHistory() { return this.svc.loginHistory(); }

  @Post('me/logout-all')
  @HttpCode(200)
  @Roles(...MEMBER)
  @ApiOperation({ summary: '모든 기기에서 로그아웃', description: '비밀번호 확인 · 증표 판 번호 + 1 — 다른 기기의 로그인이 모두 풀리고 이 기기는 새 증표로 이어 감. 감사 기록 LOGOUT_ALL.' })
  @ApiOkResponse({ type: TokensNoteDto })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'CURRENT_PASSWORD_WRONG' })
  @ApiResponse({ status: 423, type: ErrorDto, description: 'ACCOUNT_LOCKED' })
  logoutAll(@Body() dto: PasswordConfirmDto) { return this.svc.logoutAll(dto.password); }

  @Get('me/privacy-requests')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '내 개인정보 권리 요청', description: '최근 50건 · 처리 기한 날수 · 요청 종류.' })
  @ApiOkResponse({ type: Object })
  myRequests() { return this.svc.myRequests(); }

  @Post('me/privacy-requests')
  @Roles(...MEMBER)
  @ApiOperation({ summary: '개인정보 권리 요청', description: '열람 · 정정 · 삭제 · 처리정지 · 처리 기한 접수일 + privacy.request_due_days(10)일 · 처리 중인 요청은 5건까지 · 내용은 암호화.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRIVACY_OPEN_LIMIT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRIVACY_KIND · PRIVACY_BODY' })
  createRequest(@Body() dto: PrivacyRequestDto) { return this.svc.createRequest(dto.kind, dto.body); }

  @Get('admin/privacy-requests')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({ summary: '개인정보 권리 요청 처리 목록', description: '기본은 열린 요청(기한 가까운 순) · status=closed 끝난 것 · all 모두. 열린 수 · 기한 넘김 · 2일 안.' })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'closed', 'all'] })
  @ApiOkResponse({ type: Object })
  adminList(@Query('status') status?: string) { return this.svc.adminList(status); }

  @Post('admin/privacy-requests/:id/decide')
  @HttpCode(200)
  @Roles('ADMIN', 'SUPER')
  @Audit('PRIVACY_REQUEST_DECIDE', 'PRIVACY_REQUEST')
  @ApiOperation({ summary: '권리 요청 처리 · 거절 · 연장', description: 'DONE · REJECT 는 결과를 남기고 끝(고칠 수 없음) · EXTEND 는 한 번 · 회원에게 알림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'PRIVACY_REQUEST_NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PRIVACY_REQUEST_CLOSED · PRIVACY_REQUEST_EXTENDED_ONCE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PRIVACY_NOTE · PRIVACY_ACTION' })
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PrivacyDecideDto) { return this.svc.decide(id, dto.action, dto.note); }
}
