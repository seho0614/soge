import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CodeService } from './code.service';
import { CatalogService } from './catalog.service';
import {
  AdminCategoryDto, ApproveCategoryDto, CategoryDto, CodeBundleDto,
  FooterLinkDto, GwanDto, PolicyBundleDto, RestrictedIndustryDto,
  UpdateAutoReviewDto, UpdateRestrictionDto,
} from './catalog.dto';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/** SB-ADM-CAT-010 · SB-ADM-POL-010 · SB-ADM-COD-010 */
@ApiTags('ADM')
@ApiResponse({ status: 400, description: '형식 오류', type: ErrorDto })
@Controller('api/v1')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly codes: CodeService,
  ) {}

  @Get('gwans')
  @ApiOperation({ summary: '관 목록', description: '비활성 관은 내려가지 않습니다.' })
  @ApiOkResponse({ type: GwanDto, isArray: true })
  gwans() { return this.catalog.gwans(); }

  @Get('categories')
  @ApiOperation({
    summary: '업종 목록',
    description: '승인된 업종만 내려갑니다. 등록 폼의 선택지로 그대로 씁니다.',
  })
  @ApiQuery({ name: 'gwanCode', required: false, enum: ['MNY', 'MAL', 'BIZ', 'HLT'] })
  @ApiOkResponse({ type: CategoryDto, isArray: true })
  categories(@Query('gwanCode') gwanCode?: string) {
    return this.catalog.categories(gwanCode);
  }

  @Get('codes')
  @ApiOperation({
    summary: '코드 라벨 번들',
    description:
      '프런트 부팅 시 한 번 호출하고 이후 로컬에서 씁니다. ' +
      '라벨을 프런트에 하드코딩하면 문구 변경에 배포가 필요해집니다.',
  })
  @ApiQuery({ name: 'audience', required: false, enum: ['USER','ADMIN'] })
  @ApiOkResponse({ type: CodeBundleDto })
  codeBundle(@Query('audience') audience?: 'USER' | 'ADMIN') {
    return this.codes.bundle(audience ?? 'USER');
  }

  @Get('footer-links')
  @ApiOperation({
    summary: '푸터 링크',
    description:
      'available=false 인 항목은 목적지가 없습니다. 숨기지 말고 점선으로 그리고 tip 을 보여 주십시오 — ' +
      '없다는 사실이 보여야 합니다. 약관 5종은 B-12 법무 대기로 미발행 상태입니다.',
  })
  @ApiOkResponse({ type: FooterLinkDto, isArray: true })
  footerLinks() { return this.catalog.footerLinks(); }

  @Get('admin/categories')
  @ApiBearerAuth() @Roles('ADMIN','SUPER')
  @ApiOperation({ summary: '업종 관리 목록', description: '승인 대기 포함 전체.' })
  @ApiOkResponse({ type: AdminCategoryDto, isArray: true })
  adminCategories() { return this.catalog.adminCategories(); }

  @Patch('admin/categories/:id')
  @ApiBearerAuth() @Roles('ADMIN','SUPER')
  @ApiOperation({
    summary: '업종 승인 · 반려',
    description:
      '**승인 전 직업안정법 판정이 필수입니다.** 판정이 없거나 APPLICABLE 이면 ' +
      'DB 가 승인을 거부합니다 (A-14). 승인 담당자가 무심코 등록 의무를 발생시키는 것을 막는 지점입니다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminCategoryDto })
  @ApiResponse({
    status: 422, type: ErrorDto,
    description: 'LABOR_LAW_CHECK_REQUIRED — 판정 누락 또는 등록 대상 업종',
  })
  @Audit('CATEGORY_DECIDE', 'CATEGORY')
  approveCategory(@Param('id') id: string, @Body() dto: ApproveCategoryDto) {
    return this.catalog.decideCategory(id, dto);
  }

  @Get('admin/policies')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')   // v10.31 — 자동검수 규칙(REV-030 · ADMIN|SUPER)이 읽음. 제한업종 바꾸기는 그대로 SUPER
  @ApiOperation({
    summary: '정책 조회',
    description: '금칙어 · 제한업종 · 자동검수 규칙. 코드가 아니라 데이터로 관리합니다 (B-10).',
  })
  @ApiOkResponse({ type: PolicyBundleDto })
  policies() { return this.catalog.policies(); }

  @Patch('admin/policies/auto-review/:key')
  @ApiBearerAuth() @Roles('ADMIN', 'SUPER')   // v10.31 — matrix SB-ADM-REV-030 ADMIN|SUPER
  @ApiOperation({
    summary: '자동검수 규칙 변경',
    description:
      '켜고 끄고 임계값을 바꿉니다. 코드 배포가 필요 없습니다 (B-10). ' +
      'auto_approve_enabled 를 끄면 전건 수동으로 즉시 전환됩니다.',
  })
  @ApiParam({ name: 'key', example: 'manual_fee_threshold' })
  @Audit('AUTO_REVIEW_POLICY', 'AUTO_REVIEW_POLICY')
  updateAutoReview(@Param('key') key: string, @Body() dto: UpdateAutoReviewDto) {
    return this.catalog.updateAutoReviewPolicy(key, dto.enabled, dto.numValue);
  }

  @Patch('admin/policies/restrictions/:code')
  @ApiBearerAuth() @Roles('SUPER')
  @ApiOperation({
    summary: '제한업종 지정 · 해제',
    description:
      'BLOCK 으로 지정하면 **기존에 노출 중이던 해당 업종 매물이 즉시 중단되고 ' +
      '등록자에게 안내가 발송됩니다.** 되돌리려면 각 매물을 다시 노출해야 합니다.',
  })
  @ApiParam({ name: 'code', example: 'INSURANCE' })
  @ApiOkResponse({ type: RestrictedIndustryDto })
  @Audit('POLICY_RESTRICTION_UPDATE', 'RESTRICTED_INDUSTRY')
  updateRestriction(@Param('code') code: string, @Body() dto: UpdateRestrictionDto) {
    return this.catalog.updateRestriction(code, dto);
  }

  @Get('signup/types')
  @ApiOperation({ summary: '가입 유형',
    description:
      '개인 회원 · 개인 사업자 · 법인 사업자 순입니다. ' +
      '**개인 회원도 요청 등록과 소개 참여가 가능**하며, 사업자 인증은 ' +
      '판매 등록과 소개비 수령에만 필요합니다.' })
  signupTypes() { return this.catalog.signupTypes(); }

  @Get('site/landing')
  @ApiOperation({ summary: '로그인 후 랜딩',
    description:
      '비어 있으면 메인입니다. 관 코드면 그 관 메인으로 갑니다 — ' +
      '운영이 관리 화면에서 정하며 배포가 필요 없습니다. ' +
      '중지된 관이면 빈 값으로 돌려보내 메인으로 보냅니다. ' +
      '**v10.37 — `?for=new` 면 신규 가입자 첫 화면**(site.landing_new_member · 가입 완료 화면이 씁니다 · HERO 나 빈 값이면 메인).' })
  @ApiQuery({ name: 'for', required: false, enum: ['new'], description: 'new = 신규 가입자 첫 화면' })
  siteLanding(@Query('for') forWho?: string) { return this.catalog.landing(forWho === 'new'); }
}
