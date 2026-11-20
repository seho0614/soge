import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { DatabaseService } from '../../db/database.service';
import { SmxBundleSaveDto, SmxBundleStateDto, SmxRemoteZoneSaveDto, SmxReplyDecideDto, SmxReplySaveDto } from './smx.dto';
import { bundleCreate, bundlePublic, bundleState, bundleUpdate, bundlesAdmin, bundlesPublic } from './bundles';
import { remoteCheck, remoteCreate, remoteDelete, remoteFeeMine, remoteUpdate, remoteZones } from './remote';
import { adminReplies, adminReplyDecide, adminReplyEdits, adminReplySave, sellerReplies, sellerReplySave } from './replies';

/* ---------------------------------------------------------------------
 * v10.553 ~ 555 (D287 · docs/691 ~ 693) (57) 소개몰 3 — 대표 11/21
 *   SmxAdminController   api/v1/admin/smx  (ADMIN · SUPER — 소개몰 운영과 같게)
 *     묶음        GET /bundles · POST /bundles · PUT /bundles/{id} · POST /bundles/{id}/state
 *     도서산간    GET /remote-zones · GET /remote-zones/check?zip= · POST /remote-zones · PUT /remote-zones/{id} · DELETE /remote-zones/{id}
 *     리뷰 답글   GET /review-replies?view= · PUT /review-replies/{reviewId} · POST /review-replies/{replyId}/decide · GET /review-replies/{replyId}/edits
 *   SmxPublicController  api/v1/health/bundles  (공개 구역 health — 판매 중 묶음만 · 꺼져 있으면 on:false)
 *   SmxMeController      api/v1/me/health/remote-fee  (회원 — 주문서 미리보기 · 내 배송지만)
 *   SmxSellerController  api/v1/me/health/seller/review-replies  (입점 판매자 본인 — 판매자센터와 같은 역할)
 *   ★ 세무사(ACCOUNTANT)는 /admin/acct/ 접두가 아니라 보지 않음(규칙 8)
 *   ★ 주문에 묶음 · 도서산간 몫을 넣는 일은 기존 POST /health/orders(health-checkout.service.ts 패치)가 함
 * ------------------------------------------------------------------- */

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/smx')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class SmxAdminController {
  constructor(private readonly db: DatabaseService) {}

  /* ── ① 묶음 할인 (v10.553) ── */
  @Get('bundles')
  @ApiOperation({ summary: '묶음(세트) 할인 목록 (v10.553)', description: '모든 묶음 · 구성 · 만들 수 있는 수(품절이면 0) · 정가 합 · 할인율 · 판매 시작 전 막힘 까닭 · 스위치 smx.bundle(처음 off).' })
  @ApiOkResponse({ type: Object })
  bundles() { return bundlesAdmin(this.db); }

  @Post('bundles')
  @HttpCode(200)
  @Audit('SMX_BUNDLE_SAVE', 'HLT_BUNDLE')
  @ApiOperation({ summary: '묶음 만들기 (v10.553)', description: '초안으로 만듦 — 직판 상품 옵션만 · 구성 1 ~ 10줄. 판매는 「판매 시작」 뒤.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SMX_BUNDLE_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SMX_BUNDLE_ITEM · SMX_BUNDLE' })
  bundleCreate(@Body() dto: SmxBundleSaveDto) { return bundleCreate(this.db, dto); }

  @Put('bundles/:id')
  @Audit('SMX_BUNDLE_SAVE', 'HLT_BUNDLE')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '묶음 고치기 (v10.553)', description: '이름 · 설명 · 값 · 한 번에 살 수 있는 수는 늘 고침(값은 새 주문부터) · 구성은 판매 중이 아닐 때만 · 코드는 초안일 때만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SMX_BUNDLE_ON_SALE · SMX_BUNDLE_CODE · SMX_BUNDLE_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SMX_BUNDLE_ITEM · SMX_BUNDLE' })
  bundleUpdate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SmxBundleSaveDto) { return bundleUpdate(this.db, id, dto); }

  @Post('bundles/:id/state')
  @HttpCode(200)
  @Audit('SMX_BUNDLE_STATE', 'HLT_BUNDLE')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '묶음 판매 시작 · 멈춤 (v10.553)', description: '판매 시작은 구성 2줄 이상 · 수량 1 인 줄 하나 이상 · 모두 직판(DB 트리거가 다시 봄).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SMX_BUNDLE_SAME · SMX_BUNDLE_DRAFT' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SMX_BUNDLE' })
  bundleState(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SmxBundleStateDto) { return bundleState(this.db, id, dto.state); }

  /* ── ② 도서산간 배송비 (v10.554) ── */
  @Get('remote-zones')
  @ApiOperation({ summary: '도서산간 구역 표 (v10.554)', description: '우편번호 범위 · 금액 · 켬 · 최근 30일 붙은 주문 수 · 금액 · 스위치 smx.remote_ship(처음 off).' })
  @ApiOkResponse({ type: Object })
  zones() { return remoteZones(this.db); }

  @Get('remote-zones/check')
  @ApiQuery({ name: 'zip', required: true, description: '우편번호 5자리' })
  @ApiOperation({ summary: '우편번호로 구역 · 금액 확인 (v10.554)', description: '켠 구역 가운데 맞는 것(겹치면 큰 금액) — 스위치와 상관없이 표만 봄.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SMX_REMOTE_ZIP' })
  zoneCheck(@Query('zip') zip: string) { return remoteCheck(this.db, zip); }

  @Post('remote-zones')
  @HttpCode(200)
  @Audit('SMX_REMOTE_SAVE', 'SMX_REMOTE_ZONE')
  @ApiOperation({ summary: '도서산간 구역 더하기 (v10.554)', description: '이름 · 종류 · 우편번호 처음 ~ 끝(5자리 · 포함) · 금액(0 ~ 100,000원).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SMX_REMOTE_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SMX_REMOTE_ZIP' })
  zoneCreate(@Body() dto: SmxRemoteZoneSaveDto) { return remoteCreate(this.db, dto); }

  @Put('remote-zones/:id')
  @Audit('SMX_REMOTE_SAVE', 'SMX_REMOTE_ZONE')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '도서산간 구역 고치기 (v10.554)', description: '이미 받은 주문의 금액 · 구역 이름은 그대로(주문 때 복사).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SMX_REMOTE_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SMX_REMOTE_ZIP' })
  zoneUpdate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SmxRemoteZoneSaveDto) { return remoteUpdate(this.db, id, dto); }

  @Delete('remote-zones/:id')
  @Audit('SMX_REMOTE_DEL', 'SMX_REMOTE_ZONE')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '도서산간 구역 지우기 (v10.554)', description: '주문에는 구역 이름이 복사돼 있어 주문 기록은 그대로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'REFERENCE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: '—' })
  zoneDelete(@Param('id', ParseUUIDPipe) id: string) { return remoteDelete(this.db, id); }

  /* ── ③ 리뷰 답글 (v10.555) ── */
  @Get('review-replies')
  @ApiQuery({ name: 'view', required: false, enum: ['open', 'pending', 'hidden', 'all'], description: 'open = 답글 없는 직판 리뷰(처음) · pending · hidden · all = 답글' })
  @ApiOperation({ summary: '리뷰 답글 (v10.555)', description: '직판 상품 리뷰에 운영 답글 · 판매자 답글 보이기 · 가리기 · 스위치 smx.review_reply(처음 off).' })
  @ApiOkResponse({ type: Object })
  replies(@Query('view') view?: string) { return adminReplies(this.db, view); }

  @Get('review-replies/:id/edits')
  @ApiParam({ name: 'id', format: 'uuid', description: '답글 번호' })
  @ApiOperation({ summary: '리뷰 답글 고치기 기록 (v10.555)', description: '앞 글 · 새 글 · 고친 사람(가린 이름) · 쌓기만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  replyEdits(@Param('id', ParseUUIDPipe) id: string) { return adminReplyEdits(this.db, id); }

  @Put('review-replies/:id')
  @Audit('SMX_REPLY_SAVE', 'HLT_REVIEW')
  @ApiParam({ name: 'id', format: 'uuid', description: '리뷰 번호(직판 상품)' })
  @ApiOperation({ summary: '직판 리뷰에 운영자 답글 쓰기 · 고치기 (v10.555)', description: '리뷰 하나에 하나 · 다시 쓰면 고치기(기록) · 금칙어면 운영 확인 대기 · 입점 상품은 422.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SMX_REPLY_REVIEW · SMX_REPLY_HIDDEN' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SMX_REPLY_OFF · SMX_REPLY_TENANT · SMX_REPLY_BODY · SMX_REPLY' })
  replySave(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SmxReplySaveDto) { return adminReplySave(this.db, id, dto.body); }

  @Post('review-replies/:id/decide')
  @HttpCode(200)
  @Audit('SMX_REPLY_DECIDE', 'HLT_REVIEW')
  @ApiParam({ name: 'id', format: 'uuid', description: '답글 번호' })
  @ApiOperation({ summary: '리뷰 답글 보이기 · 가리기 (v10.555)', description: '가리기는 사유(2자 이상) · 보이게 되면 리뷰 쓴 회원에게 한 번 알림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SMX_REPLY_SAME' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'REASON_REQUIRED' })
  replyDecide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SmxReplyDecideDto) { return adminReplyDecide(this.db, id, dto.action, dto.reason); }
}

/** 공개 — 판매 중 묶음(smx.bundle on 일 때만 · 집계 · 상품 정보만) */
@ApiTags('HEALTH')
@Controller('api/v1/health/bundles')
export class SmxPublicController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @ApiOperation({ summary: '판매 중 묶음 할인 목록 (v10.553)', description: '묶음가 · 정가 합 · 품절(구성 하나라도 품절) · 구성 상품 — 꺼져 있으면 on:false · 빈 목록.' })
  @ApiOkResponse({ type: Object })
  list() { return bundlesPublic(this.db); }

  @Get(':code')
  @ApiParam({ name: 'code', description: '묶음 코드' })
  @ApiOperation({ summary: '묶음 하나 (v10.553)', description: '판매 중 · 켜져 있을 때만(아니면 404).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  one(@Param('code') code: string) { return bundlePublic(this.db, code); }
}

/** 회원 — 주문서 도서산간 추가 배송비 미리보기 */
@ApiTags('HEALTH')
@ApiBearerAuth()
@Controller('api/v1/me/health/remote-fee')
@Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
export class SmxMeController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @ApiQuery({ name: 'addressId', required: true, description: '내 배송지 번호' })
  @ApiOperation({ summary: '도서산간 추가 배송비 미리보기 (v10.554)', description: '직판 주문 기준 — 스위치가 꺼져 있거나 구역 밖이면 0. 주문 때 서버가 다시 셈.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  fee(@Query('addressId') addressId: string) { return remoteFeeMine(this.db, String(addressId ?? '')); }
}

/** 입점 판매자 — 판매자센터 › 리뷰 답글 */
@ApiTags('HEALTH')
@ApiBearerAuth()
@Controller('api/v1/me/health/seller/review-replies')
@Roles('MEMBER', 'BIZ_OWNER', 'ADMIN', 'SUPER')
export class SmxSellerController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @ApiQuery({ name: 'view', required: false, enum: ['open', 'all'], description: 'open = 답글 없는 리뷰(처음) · all = 모두' })
  @ApiOperation({ summary: '내 상품 리뷰 · 답글 (v10.555)', description: '입점 판매자 본인 상품의 보이는 리뷰 100 · 내 답글 상태(보임 · 운영 확인 대기 · 가림).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'NOT_SELLER' })
  list(@Query('view') view?: string) { return sellerReplies(this.db, view); }

  @Put(':id')
  @Audit('SMX_REPLY_SELLER', 'HLT_REVIEW')
  @ApiParam({ name: 'id', format: 'uuid', description: '리뷰 번호(내 상품)' })
  @ApiOperation({ summary: '내 상품 리뷰에 답글 쓰기 · 고치기 (v10.555)', description: '리뷰 하나에 하나 · 다시 쓰면 고치기(기록) · 금칙어면 운영 확인 뒤 보임 · 가려진 답글은 못 고침.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'NOT_SELLER · SMX_REPLY_KIND' })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'SMX_REPLY_REVIEW · SMX_REPLY_HIDDEN' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'SMX_REPLY_OFF · SMX_REPLY_BODY · SMX_REPLY' })
  save(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SmxReplySaveDto) { return sellerReplySave(this.db, id, dto.body); }
}
