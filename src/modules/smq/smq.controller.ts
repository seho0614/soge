import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { NotFound } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { PartnerActorService } from '../partner/partner-actor.service';
import { SmqLimitDecideDto, SmqQnaAnswerDto, SmqQnaDecideDto, SmqRecalcDto, SmqRulesSaveDto } from './smq.dto';
import { adminQna, adminQnaDecide, sellerQna, sellerQnaAnswer } from './qna';
import { tenantReady2 } from './ready2';
import { adminGrades, adminLimitDecide, adminRecalc, adminRules, adminRulesSave, sellerGrade } from './grades';
import { settleForecast } from './forecast';

/* ---------------------------------------------------------------------
 * v10.577 ~ 580 (docs/719 ~ 722) 12차 소개몰 · 파트너 — 대표 11/21 「16개 모두 동시에」
 *   SmqAdminController    api/v1/admin/smq  (ADMIN · SUPER — 소개몰 운영과 같게 · 기준 값 고치기만 SUPER)
 *     상품 문의     GET /qna?view= · POST /qna/{id}/decide           (운영 답은 기존 POST /admin/health/qna/{id}/answer)
 *     입점 2차 점검 GET /tenant-ready2                                (읽기만 · 「소개몰 판매자」 탭 안)
 *     판매자 평가   GET /grades?ym= · POST /grades/recalc · POST /limits/{id}/decide · GET /rules · PUT /rules(SUPER)
 *   SmqSellerController   api/v1/me/health/seller  (입점 판매자 본인 — 판매자센터와 같은 역할)
 *     GET /qna?view= · PUT /qna/{id} · GET /grade
 *   SmqPartnerController  api/v1/partner  (파트너센터 — 자기 파트너 것만 · 돈 칸은 대표 · 정산 권한 직원만)
 *     GET /settle-forecast
 *   ★ 세무사(ACCOUNTANT)는 /admin/acct/ 접두가 아니라 보지 않음(규칙 8)
 * ------------------------------------------------------------------- */

const LIMIT_ID = /^[0-9]{1,18}$/;

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/smq')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class SmqAdminController {
  constructor(private readonly db: DatabaseService) {}

  /* ── ① 상품 문의 (v10.577) ── */
  @Get('qna')
  @ApiQuery({ name: 'view', required: false, enum: ['open', 'overdue', 'pending', 'all'], description: 'open 답할 것(처음) · overdue 기한 넘김 · pending 운영 확인 대기(문의 · 판매자 답) · all' })
  @ApiOperation({ summary: '상품 문의 답 관리 (v10.577)', description: '직판 · 입점 문의 · 답 기한 · 넘김 · 누가 답했나 · 금칙어 대기 · 스위치 smq.qna(처음 off).' })
  @ApiOkResponse({ type: Object })
  qna(@Query('view') view?: string) { return adminQna(this.db, view); }

  @Post('qna/:id/decide')
  @HttpCode(200)
  @Audit('SMQ_QNA_DECIDE', 'HLT_QNA', { pick: ['id', 'target', 'state'] })
  @ApiParam({ name: 'id', format: 'uuid', description: '문의 번호' })
  @ApiOperation({ summary: '문의 · 답 보이기 · 가리기 (v10.577)', description: '가리기는 사유(2자 이상) · 답이 보이게 되면 쓴 사람에게 알림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SMQ_QNA_SAME · SMQ_QNA_NO_ANSWER' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'REASON_REQUIRED · SMQ_QNA_REASON' })
  qnaDecide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SmqQnaDecideDto) { return adminQnaDecide(this.db, id, dto.target, dto.action, dto.reason); }

  /* ── ② 입점 열기 2차 점검 (v10.578) ── */
  @Get('tenant-ready2')
  @ApiOperation({ summary: '입점 열기 2차 점검 (v10.578)', description: '약관 · 정산 · 반품 · 세금계산서 · 판매자 교육 · 연락처를 준비됨 · 막힘 · 값으로(읽기만 · 스위치를 막지 않음).' })
  @ApiOkResponse({ type: Object })
  ready2() { return tenantReady2(this.db); }

  /* ── ③ 판매자 평가 · 패널티 (v10.579) ── */
  @Get('grades')
  @ApiQuery({ name: 'ym', required: false, description: 'YYYY-MM(비우면 지난달) — 저장 전 달 · 이번 달은 미리보기' })
  @ApiOperation({ summary: '판매자 평가 · 패널티 (v10.579)', description: '달마다 배송 지연 · 판매자 사정 취소 · 반품 · 문의 답 늦음 · 등급 · 경고 · 노출 제한 제안 · 승인 · 기준 · 스위치 smq.penalty · smq.penalty_exposure(처음 off).' })
  @ApiOkResponse({ type: Object })
  grades(@Query('ym') ym?: string) { return adminGrades(this.db, ym); }

  @Post('grades/recalc')
  @HttpCode(200)
  @Audit('SMQ_GRADE_RECALC', 'HLT_SELLER', { pick: ['ym', 'sellers', 'saved'] })
  @ApiOperation({ summary: '끝난 달 다시 셈 (v10.579)', description: '알린 줄은 그대로 · 알림 · 노출 제한 제안은 정기 작업이 함.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '—' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SMQ_YM · SMQ_YM_OPEN' })
  recalc(@Body() dto: SmqRecalcDto) { return adminRecalc(this.db, dto.ym); }

  @Post('limits/:id/decide')
  @HttpCode(200)
  @Audit('SMQ_LIMIT_DECIDE', 'HLT_SELLER', { pick: ['id', 'state', 'inEffect'] })
  @ApiParam({ name: 'id', description: '노출 제한 번호(숫자)' })
  @ApiOperation({ summary: '노출 제한 승인 · 반려 · 풀기 (v10.579)', description: '승인은 오늘부터 smq.penalty_limit_days 일 · 실제로 목록에서 빠지는 것은 smq.penalty_exposure on 일 때만 · 판매자에게 알림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SMQ_LIMIT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'REASON_REQUIRED · SMQ_LIMIT_NOTE' })
  limitDecide(@Param('id') id: string, @Body() dto: SmqLimitDecideDto) {
    if (!LIMIT_ID.test(String(id ?? ''))) throw new NotFound('없는 노출 제한입니다.');
    return adminLimitDecide(this.db, id, dto.action, dto.note);
  }

  @Get('rules')
  @ApiOperation({ summary: '판매자 평가 기준 (v10.579)', description: '일반 초안 기준 값 · 스위치 · 문의 표본.' })
  @ApiOkResponse({ type: Object })
  rules() { return adminRules(this.db); }

  @Put('rules')
  @Roles('SUPER')
  @Audit('SMQ_RULES_SAVE', 'SITE_SETTING', { pick: ['changed'] })
  @ApiOperation({ summary: '판매자 평가 기준 고치기 (v10.579 · SUPER)', description: '보낸 칸만 · 무늬는 설정 값 무늬와 같음 · 노출 제한 실제 적용 켜고 끄기 · 다음 셈부터.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: '—' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SMQ_RULE_RANGE · SMQ_RULE_EMPTY' })
  rulesSave(@Body() dto: SmqRulesSaveDto) { return adminRulesSave(this.db, dto as unknown as Record<string, unknown>); }
}

/** 입점 판매자 — 판매자센터 › 상품 문의 · 판매 평가 */
@ApiTags('HEALTH')
@ApiBearerAuth()
@Controller('api/v1/me/health/seller')
@Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
@ApiResponse({ status: 403, type: ErrorDto, description: 'NOT_SELLER' })
export class SmqSellerController {
  constructor(private readonly db: DatabaseService) {}

  @Get('qna')
  @ApiQuery({ name: 'view', required: false, enum: ['open', 'all'], description: 'open = 답 없는 문의(처음) · all = 모두' })
  @ApiOperation({ summary: '내 상품 문의 (v10.577)', description: '입점 판매자 본인 상품의 보이는 문의 200(비밀글 포함 · 쓴 사람은 가린 이름) · 답 기한 · 내 답 상태.' })
  @ApiOkResponse({ type: Object })
  qna(@Query('view') view?: string) { return sellerQna(this.db, view); }

  @Put('qna/:id')
  @Audit('SMQ_QNA_SELLER', 'HLT_QNA', { pick: ['id', 'answerKind', 'answerState', 'edited'] })
  @ApiParam({ name: 'id', format: 'uuid', description: '문의 번호(내 상품)' })
  @ApiOperation({ summary: '내 상품 문의에 답 (v10.577)', description: '다시 쓰면 고침 · 금칙어면 운영 확인 뒤 보임 · 운영이 가린 답은 못 고침 · 보이게 되면 쓴 사람에게 알림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SMQ_QNA_STATE · SMQ_QNA_HIDDEN' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SMQ_QNA_OFF · SMQ_QNA_BODY · SMQ_QNA' })
  answer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SmqQnaAnswerDto) { return sellerQnaAnswer(this.db, id, dto.body); }

  @Get('grade')
  @ApiOperation({ summary: '내 판매 평가 (v10.579)', description: '알린 최근 6달 · 이번 달 미리보기 · 적용 중 노출 제한 · 공개 기준.' })
  @ApiOkResponse({ type: Object })
  grade() { return sellerGrade(this.db); }
}

/** 파트너센터 — 이번 달 정산 예측 */
@ApiTags('PTC')
@ApiBearerAuth()
@Controller('api/v1/partner')
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF', 'ADMIN', 'SUPER')
@ApiResponse({ status: 409, description: 'NOT_PARTNER', type: ErrorDto })
export class SmqPartnerController {
  constructor(private readonly db: DatabaseService, private readonly actors: PartnerActorService) {}

  @Get('settle-forecast')
  @ApiOperation({ summary: '이번 달 정산 예측 (v10.580)', description: '내 파트너의 이번 달 제휴 주문 — 확정 · 대기 · 취소 가능 · 취소됨 · 예상 지급(원천징수 3.3% 뺌 · 아래 끝 ~ 위 끝) · 지급일 · 이미 만든 정산 · 추천 보상 요약. 돈 칸은 대표 · 정산 권한 직원만.' })
  @ApiOkResponse({ type: Object })
  forecast() { return settleForecast(this.db, this.actors, RequestCtx.actorId() ?? null); }
}
