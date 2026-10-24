import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { QualificationService } from './qualification.service';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { ServiceReviewDto, PartnerOkDto } from './partner.dto';

/** SB-ADM-PTN-040 · 070 자격 심사 · 의료 심의 */
@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/qualifications')
@Roles('ADMIN', 'SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class QualificationController {
  constructor(private readonly svc: QualificationService) {}

  @Get('rules')
  @ApiOperation({
    summary: '규제 분야 기준',
    description: '대부·다단계는 심사 대상이 아니라 **등록 금지**입니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  rules() { return this.svc.rules(); }

  @Get('category-master')
  @ApiOperation({
    summary: '카테고리 마스터 (T-05 · T-06) — 읽기 전용',
    description:
      'v10.32 · SB-ADM-PTN-060. ① 안심소개 상담 축 업종(코드 · 게시 방식 GATED/일반 · 상태) ' +
      '② 등록 폼 · 단가(업종의 등록 방식 · 단계 수 · 견적 축 · 규제 · 단가 입력 가능/막힘 — 파트너센터 등록 위자드와 같은 기준) ' +
      '③ 매트릭스 축(category_matrix_axes). 업종 마스터에 기준 금액 칸이 없어 base 는 null 입니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto })
  categoryMaster() { return this.svc.categoryMaster(); }

  @Get()
  @ApiOperation({ summary: '심사 대기' })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  pending() { return this.svc.pending(); }

  @Post(':id/lookup')
  @ApiOperation({
    summary: '발급처 조회 완료',
    description:
      '**서류만 보고 승인하지 마십시오.** 위조된 자격증으로 등록되면 ' +
      '그 피해는 요청자에게 갑니다. 조회 없이는 DB 가 승인을 막습니다.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: PartnerOkDto })
  @Audit('QUAL_LOOKUP', 'QUALIFICATION')
  lookup(@Param('id') id: string) { return this.svc.markLookup(id); }

  @Post(':id/decide')
  @ApiOperation({
    summary: '자격 승인 · 반려',
    description:
      '자격 없이 등록되면 **플랫폼도 책임을 집니다.** 중개자 면책은 ' +
      '"고지하고 확인한 범위"에서만 성립하고, 자격 확인이 그 확인입니다.',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 422, description: 'REASON_REQUIRED · QUAL_RULE', type: ErrorDto })
  @ApiOkResponse({ type: PartnerOkDto })
  @Audit('QUAL_DECIDE', 'QUALIFICATION')
  decide(@Param('id') id: string, @Body() dto: ServiceReviewDto) {
    return this.svc.decide(id, dto.approve, dto.reason);
  }

  @Get('medical')
  @ApiOperation({
    summary: '의료 심의 대기',
    description:
      '심의필 번호를 확인해야 슬롯에 붙습니다. 확인 전에는 DB 가 막으므로 ' +
      '실수로 노출되지 않습니다. 번호만 받지 말고 **실제 조회**하십시오 — ' +
      '의료법 27조·56조는 과태료 대상입니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  medical() { return this.svc.medicalPending(); }

  @Get('properties')
  @ApiOperation({
    summary: '매물 심사 대기 (안심소개)',
    description:
      '**중개사 자격 통과 여부를 함께 냅니다.** 없으면 승인해도 트리거가 막으므로 ' +
      '미리 보여 드립니다 — 눌러 보고서야 알면 늦습니다.',
  })
  @ApiOkResponse({ type: PartnerOkDto, isArray: true })
  properties() { return this.svc.propertyPending(); }

  @Post('properties/:id/decide')
  @ApiOperation({
    summary: '매물 공개 · 반려',
    description:
      '자격 없는 사람이 매물을 올리고 중개하면 **무등록 중개**이고 ' +
      '플랫폼이 그 자리를 제공한 것이 됩니다(공인중개사법 제18조의2). ' +
      '개설등록번호와 자격 심사 통과가 모두 있어야 공개됩니다.',
  })
  @ApiParam({ name: 'id', description: 'listingId' })
  @ApiResponse({ status: 422, description: 'PROP · REASON_REQUIRED', type: ErrorDto })
  @ApiOkResponse({ type: PartnerOkDto })
  @Audit('PROPERTY_DECIDE', 'LISTING')
  decideProperty(@Param('id') id: string, @Body() dto: ServiceReviewDto) {
    return this.svc.decideProperty(id, dto.approve, dto.reason);
  }
}
