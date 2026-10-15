import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ListingService } from './listing.service';
import { AddPhotoDto, ListingBadgeRequestDto } from './listing.dto';
import { ErrorDto } from '../../common/dto/common.dto';
import { RequireGate, Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/**
 * v10.31 (w2 · 10/10 시안 기준) — 매물 사진 · 급구/급매 표시 신청.
 *   시안 카드 · 상세의 사진(대표 사진 · 「1/5」 넘기기)과 급구 · 급매 화면의 「급구, 급매 등록 안내」.
 *   사진 올리기 순서: POST /files {purpose: LISTING_IMAGE} → PUT 바이트 → POST /files/{id}/complete → POST /listings/{id}/photos {fileId}
 *   (등록 · 수정 본문의 mediaKeys 로 한 번에 보내도 됩니다).
 */
@ApiTags('HOM')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
@Controller('api/v1/listings')
export class ListingExtController {
  constructor(private readonly service: ListingService) {}

  @Get(':id/photos/:n')
  @ApiOperation({
    summary: '매물 사진 (공개)',
    description: 'n 번째 사진(0부터) 바이트. **게시 중인 매물**만 누구나 봅니다(주인은 검수 중에도). 없으면 404 — 화면은 분류 그림을 씁니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' }) @ApiParam({ name: 'n', example: 0 })
  @ApiResponse({ status: 404, description: '사진 없음', type: ErrorDto })
  @ApiOkResponse({ description: '그림 바이트', content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/png': { schema: { type: 'string', format: 'binary' } } } })
  async photo(@Param('id') id: string, @Param('n', ParseIntPipe) n: number, @Res() res: Response) {
    const { stream, contentType, size } = await this.service.photo(id, n);
    res.status(200);
    res.setHeader('Content-Type', contentType); res.setHeader('Content-Length', String(size));
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  @Post(':id/photos')
  @ApiBearerAuth()
  /* v10.36 (D094) — 소개장터 개인 등록자도 자기 매물 사진을 붙이고 뗍니다(주인 확인은 DB) */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '매물 사진 붙이기 (주인)',
    description: '올리기 확인을 마친 LISTING_IMAGE 파일을 붙입니다. 한 매물 10장까지 · 매물 주인이 올린 파일만(DB 가 봅니다). 사진은 재검수를 걸지 않습니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 422, description: 'LISTING_PHOTO_FILE · LISTING_PHOTO_OWNER · LISTING_PHOTO_LIMIT', type: ErrorDto })
  @Audit('LISTING_PHOTO_ADD', 'LISTING')
  addPhoto(@Param('id') id: string, @Body() dto: AddPhotoDto) {
    return this.service.addPhoto(id, dto.fileId);
  }

  @Delete(':id/photos/:mediaId')
  @ApiBearerAuth()
  /* v10.36 (D094) — 소개장터 개인 등록자도 자기 매물 사진을 붙이고 뗍니다(주인 확인은 DB) */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({ summary: '매물 사진 떼기 (주인)' })
  @ApiParam({ name: 'id', format: 'uuid' }) @ApiParam({ name: 'mediaId', format: 'uuid' })
  @Audit('LISTING_PHOTO_REMOVE', 'LISTING')
  removePhoto(@Param('id') id: string, @Param('mediaId') mediaId: string) {
    return this.service.removePhoto(id, mediaId);
  }

  @Post(':id/badges')
  @ApiBearerAuth()
  /* v10.37 (D095 · 10/13 대표 지시) — 모든 업무는 개인 회원(본인인증)도 합니다. 사업자만은 안심소개 · 소개몰 · 소개창업 등록뿐 */
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @RequireGate('IDENTITY_VERIFIED')
  @ApiOperation({
    summary: '급구 · 급매 표시 신청',
    description:
      'URGENT 급구 · URGENT_SALE 급매. 기한(최대 urgent_max_days 일) · 사유가 있어야 하고, 한 매물에는 하나만, 동시에 유지하는 건수는 urgent_max_active 까지입니다(DB). ' +
      '신청하면 운영 배지 심사(review_items · LISTING_BADGE)로 가고 승인되면 목록 · 급구 · 급매 화면에 나옵니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 422, description: 'URGENT_PERIOD_TOO_LONG · URGENT_TOO_MANY · URGENT_KIND_CONFLICT · BADGE_LISTING_NOT_PUBLISHED · BADGE_NOT_OWNER', type: ErrorDto })
  @ApiResponse({ status: 409, description: '이미 신청 · 표시 중', type: ErrorDto })
  @Audit('LISTING_BADGE_REQUEST', 'LISTING')
  requestBadge(@Param('id') id: string, @Body() dto: ListingBadgeRequestDto) {
    return this.service.requestBadge(id, dto);
  }
}
