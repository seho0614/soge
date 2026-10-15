import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SiteService } from './site.service';
import {
  AdPlacementDto, BannedWordDto, CreateAdDto, CreateBannedWordDto, CreateGwanDto,
  CreateNoticeDto, GwanAdminDto, HubDto, IntegrationDto, LayoutDto, NoticeDto,
  ScopeDto, UpdateGwanDto, UpdateIntegrationDto,
  GwanOrderDto, LandingDto,
} from './site.dto';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { MainService } from './main.service';
import { IsInt, IsOptional, IsString } from 'class-validator';
import { StrictBoolean } from '../../common/strict-boolean';

/** SB-ADM-SIT-010/020/030/050/060 · MAIN-010/020/030/040 */

/* 메인 운영 응답·요청 스키마.
 * 없으면 문서에 "무엇이 오가는지"가 비고 프런트가 추측으로 붙입니다. */
export class MainSectionDto {
  @ApiProperty({ example: 'EARN' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ description: '끌 수 없는 구역' }) isLocked!: boolean;
  @ApiPropertyOptional() description?: string | null;
}
export class MainSectionPatchDto {
  @ApiPropertyOptional() @IsOptional() @StrictBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}
export class MainCopyDto {
  @ApiProperty({ example: 'HERO_TITLE' }) slot!: string;
  @ApiProperty() text!: string;
  @ApiPropertyOptional() note?: string | null;
}
export class MainCopyPatchDto {
  @ApiProperty({ description: '금칙어가 있으면 저장되지 않습니다' })
  @IsString() text!: string;
}
export class MainNoticeDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() startsAt?: string | null;
  @ApiPropertyOptional() endsAt?: string | null;
  @ApiProperty({ description: '기간이 지나면 자동으로 내려갑니다' }) showing!: boolean;
}

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin')
@Roles('SUPER')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class SiteController {
  constructor(private readonly svc: SiteService,
    private readonly main: MainService,
  ) {}

  @Get('gwans')
  @ApiOperation({
    summary: '관 목록 · 현황',
    description: '매물·업종·검수 대기 수를 함께 봅니다. 관을 열 준비가 됐는지 판단하는 근거입니다.',
  })
  @ApiOkResponse({ type: GwanAdminDto, isArray: true })
  gwans() { return this.svc.gwans(); }

  /* ★ 20260930 — 이 묶음을 `gwans/:code` 보다 **위로** 옮겼습니다.
   *   Express 는 선언 순서대로 맞추므로 아래에 있으면 manage · order · landing 이
   *   :code 로 잡혀 "없는 관입니다" 가 났습니다(관 관리 화면 · 순서 변경 · 랜딩 지정 불가). */
  /* ── 관 관리 (운영) ─────────────────────────────────────────────── */

  @Get('gwans/manage')
  @Roles('ADMIN')
  @ApiOperation({ summary: '관 관리 목록',
    description: '순서 · 업종 수 · 노출 건수 · 랜딩 지정 여부를 함께 봅니다.' })
  gwanAdmin() { return this.svc.gwanAdmin(); }

  @Patch('gwans/order')
  @Roles('ADMIN')
  @ApiOperation({ summary: '관 노출 순서 변경',
    description:
      '메뉴와 목록 순서가 함께 바뀝니다. **한 번에 전체를 보내십시오** — ' +
      '하나씩 바꾸면 중간에 순서가 겹쳐 표시가 들쭉날쭉해집니다.' })
  @Audit('GWAN_REORDER', 'GWAN')
  reorder(@Body() dto: GwanOrderDto) { return this.svc.reorderGwans(dto.items); }

  @Patch('gwans/landing')
  @Roles('ADMIN')
  @ApiOperation({ summary: '로그인 후 랜딩 지정',
    description:
      '비우면 메인, 관 코드를 넣으면 그 관 메인으로 보냅니다. ' +
      '**중지된 관은 지정할 수 없습니다** — 로그인하자마자 "중지 상태" 화면을 보게 됩니다.' })
  @Audit('GWAN_LANDING', 'SETTING')
  landing(@Body() dto: LandingDto) {
    return this.svc.setLanding(dto.gwanCode ?? null, dto.forNewMember ?? false);
  }

  @Get('gwans/:code')
  @ApiOperation({ summary: '관 상세' })
  @ApiParam({ name: 'code' })
  @ApiOkResponse({ type: GwanAdminDto })
  gwan(@Param('code') code: string) { return this.svc.gwan(code); }

  @Post('gwans')
  @ApiOperation({
    summary: '새 관 만들기',
    description:
      '**비활성으로 만듭니다.** 업종·검수 인력·정산 흐름이 준비되기 전에 열면 ' +
      '등록만 쌓이고 노출이 안 됩니다. 여는 것은 별도 조작입니다.',
  })
  @ApiResponse({ status: 409, description: 'GWAN_EXISTS', type: ErrorDto })
  @Audit('GWAN_CREATE', 'GWAN')
  create(@Body() dto: CreateGwanDto) { return this.svc.createGwan(dto); }

  @Patch('gwans/:code')
  @ApiOperation({
    summary: '관 설정',
    description:
      '비활성으로 바꾸면 그 관의 등록·노출이 즉시 멈춥니다. 매물은 지우지 않습니다. ' +
      '**승인된 업종이 없으면 열 수 없습니다** — 등록 폼의 선택지가 비어 사용자가 막힙니다.',
  })
  @ApiParam({ name: 'code' })
  @ApiResponse({ status: 422, description: 'NO_APPROVED_CATEGORY', type: ErrorDto })
  @Audit('GWAN_UPDATE', 'GWAN')
  update(@Param('code') code: string, @Body() dto: UpdateGwanDto) {
    return this.svc.updateGwan(code, dto);
  }

  @Patch('gwans/:code/visibility')
  @ApiOperation({ summary: '관 노출 전환', description: '메인에서 보일지 여부입니다.' })
  @ApiParam({ name: 'code' })
  @Audit('GWAN_VISIBILITY', 'GWAN')
  visibility(@Param('code') code: string, @Body() dto: UpdateGwanDto) {
    return this.svc.updateGwan(code, { isActive: dto.isActive, sortOrder: dto.sortOrder });
  }

  @Get('hub')
  @ApiOperation({ summary: '통합 메인 · 허브', description: '전 관 현황을 한 화면에 모읍니다.' })
  @ApiOkResponse({ type: HubDto })
  hub() { return this.svc.hub(); }

  @Get('scope')
  @ApiOperation({
    summary: '공유 경계 · 영향 범위',
    description:
      '무엇이 전 관에 영향을 주고 무엇이 관별인지 보여 줍니다. ' +
      '이걸 모르면 한 관 설정을 바꾸다 다른 관을 망가뜨립니다.',
  })
  @ApiOkResponse({ type: ScopeDto, isArray: true })
  scope() { return this.svc.scope(); }

  @Get('layout')
  @ApiOperation({ summary: '메인 화면 구성' })
  @ApiOkResponse({ type: LayoutDto })
  layout() { return this.svc.layout(); }

  @Patch('layout')
  @ApiOperation({ summary: '메인 구성 변경' })
  @ApiOkResponse({ type: LayoutDto })
  @Audit('LAYOUT_UPDATE', 'SITE')
  updateLayout(@Body() dto: LayoutDto) { return this.svc.updateLayout(dto); }

  @Get('ads')
  @Roles('ADMIN', 'SUPER')   // v10.31 — matrix SB-ADM-MAIN-010 · REV-030 은 ADMIN|SUPER(운영 계정에도 보이게)
  @ApiOperation({
    summary: '광고 게재 목록',
    description: '노출 순위가 대가에 따른 것이면 표시해야 합니다 — 라벨은 DB 가 강제합니다.',
  })
  @ApiOkResponse({ type: AdPlacementDto, isArray: true })
  ads() { return this.svc.ads(); }

  @Post('ads')
  @Roles('ADMIN', 'SUPER')   // v10.31 — matrix SB-ADM-MAIN-010 · REV-030 은 ADMIN|SUPER(운영 계정에도 보이게)
  @ApiOperation({ summary: '광고 등록' })
  @ApiResponse({ status: 422, description: 'INVALID_PERIOD', type: ErrorDto })
  @Audit('AD_CREATE', 'AD_PLACEMENT')
  createAd(@Body() dto: CreateAdDto) { return this.svc.createAd(dto); }

  @Get('notices')
  @ApiOperation({ summary: '공지 목록 (미발행 포함)' })
  @ApiQuery({ name: 'gwanCode', required: false })
  @ApiOkResponse({ type: NoticeDto, isArray: true })
  notices(@Query('gwanCode') gwanCode?: string) {
    return this.svc.notices(gwanCode, false);
  }

  @Post('notices')
  @ApiOperation({
    summary: '공지 등록',
    description: 'publishedAt 을 비우면 초안입니다. 지정한 시각에 공개됩니다.',
  })
  @Audit('NOTICE_CREATE', 'NOTICE')
  createNotice(@Body() dto: CreateNoticeDto) { return this.svc.createNotice(dto); }

  /* ── 외부 연동 (SB-ADM-SIT-080) ── */

  @Get('integrations')
  @ApiOperation({
    summary: '외부 연동 현황',
    description:
      '6종 중 5종이 발신 IP 화이트리스트를 요구하고 심사에 2~4주 걸립니다 — ' +
      '**코드보다 IP 가 먼저 필요합니다.** ' +
      'blocksOpen 인 연동이 LIVE 가 아니면 오픈이 막힙니다. ' +
      '시크릿 값은 여기 없습니다 — Secrets Manager 키 이름과 등록 여부만 봅니다.',
  })
  @ApiOkResponse({ type: IntegrationDto, isArray: true })
  integrations() { return this.svc.integrations(); }

  @Patch('integrations/egress-ip')
  @ApiOperation({
    summary: '발신 IP 일괄 등록',
    description:
      'NAT Gateway 고정 IP 를 전 연동에 한 번에 반영하고 IP 심사중으로 바꿉니다. ' +
      '연동마다 따로 넣으면 값이 갈립니다.',
  })
  @Audit('EGRESS_IP_SET', 'INTEGRATION')
  setEgressIp(@Body() dto: { ip: string }) { return this.svc.setEgressIp(dto.ip); }

  /* ── 금칙어 (SB-ADM-POL-010) ── */

  @Get('banned-words')
  @Roles('ADMIN', 'SUPER')   // v10.31 — matrix SB-ADM-MAIN-010 · REV-030 은 ADMIN|SUPER(운영 계정에도 보이게)
  @ApiOperation({
    summary: '금칙어 목록',
    description:
      'BLOCK 은 등록을 거부하고, WARN 은 통과시키되 자동검수에서 빼 사람이 봅니다 — ' +
      '문맥에 따라 정상일 수 있는 단어들입니다.',
  })
  @ApiQuery({ name: 'severity', required: false, enum: ['BLOCK', 'WARN'] })
  @ApiOkResponse({ type: BannedWordDto, isArray: true })
  bannedWords(@Query('severity') severity?: string) {
    return this.svc.bannedWords(severity);
  }

  @Patch('integrations/:code')
  @ApiOperation({
    summary: '연동 상태 변경',
    description:
      '계약·IP 심사·시험·운영 단계를 기록합니다. ' +
      '**키 값을 보내지 마십시오** — DB 에 넣으면 백업·복제본에 전부 퍼집니다. ' +
      'Secrets Manager 에 넣은 뒤 secretRegistered 만 true 로 바꾸십시오.',
  })
  @ApiParam({ name: 'code', example: 'NTS' })
  @ApiResponse({ status: 409, description: 'NOT_FOUND', type: ErrorDto })
  @Audit('INTEGRATION_UPDATE', 'INTEGRATION')
  updateIntegration(@Param('code') code: string, @Body() dto: UpdateIntegrationDto) {
    return this.svc.updateIntegration(code, dto);
  }


  @Post('banned-words')
  @Roles('ADMIN', 'SUPER')   // v10.31 — matrix SB-ADM-MAIN-010 · REV-030 은 ADMIN|SUPER(운영 계정에도 보이게)
  @ApiOperation({
    summary: '금칙어 추가',
    description: '추가 즉시 적용됩니다. 기존 매물은 소급 검사하지 않습니다.',
  })
  @ApiResponse({ status: 409, description: 'WORD_EXISTS', type: ErrorDto })
  @Audit('BANNED_WORD_ADD', 'BANNED_WORD')
  addWord(@Body() dto: CreateBannedWordDto) { return this.svc.addBannedWord(dto); }

  @Patch('banned-words/:id')
  @Roles('ADMIN', 'SUPER')   // v10.31 — matrix SB-ADM-MAIN-010 · REV-030 은 ADMIN|SUPER(운영 계정에도 보이게)
  @ApiOperation({ summary: '금칙어 사용 여부' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @Audit('BANNED_WORD_TOGGLE', 'BANNED_WORD')
  toggleWord(@Param('id') id: string, @Body() dto: { isActive: boolean }) {
    return this.svc.toggleBannedWord(id, dto.isActive);
  }

  /* ── 메인 운영 (SB-ADM-MAIN-010~040) ─────────────────────────── */

  @Get('main/sections')
  @ApiOperation({
    summary: '메인 구역',
    description:
      '구역 순서와 노출입니다. **잠긴 구역은 끌 수 없습니다** — ' +
      "'소개하고 벌기'를 끄면 무엇을 하는 곳인지 알 수 없는 화면이 됩니다.",
  })
  @ApiOkResponse({ type: MainSectionDto, isArray: true })
  mainSections() { return this.main.sections(); }

  @Patch('main/sections/:code')
  @ApiOperation({
    summary: '구역 노출 · 순서',
    description: '바꾸면 바로 반영됩니다. 배포가 필요 없습니다.',
  })
  @Audit('MAIN_SECTION_SET', 'MAIN')
  @ApiOkResponse({ type: MainSectionDto })
  setSection(@Param('code') code: string,
             @Body() dto: MainSectionPatchDto) {
    return this.main.setSection(code, dto.isActive, dto.sortOrder);
  }

  @Get('main/copy')
  @ApiOperation({ summary: '메인 문구' })
  @ApiOkResponse({ type: MainCopyDto, isArray: true })
  mainCopy() { return this.main.copy(); }

  @Patch('main/copy/:slot')
  @ApiOperation({
    summary: '문구 수정',
    description:
      '운영 문구에도 금칙어가 적용됩니다. 예외를 두면 ' +
      '"우리는 되고 너희는 안 되냐"가 됩니다.',
  })
  @Audit('MAIN_COPY_SET', 'MAIN')
  @ApiOkResponse({ type: MainCopyDto })
  setCopy(@Param('slot') slot: string, @Body() dto: MainCopyPatchDto) {
    return this.main.setCopy(slot, dto.text);
  }

  @Get('main/notices')
  @Roles('ADMIN', 'SUPER')   // v10.31 — matrix SB-ADM-MAIN-010 · REV-030 은 ADMIN|SUPER(운영 계정에도 보이게)
  @ApiOperation({ summary: '공지', description: '기간이 지나면 자동으로 내려갑니다.' })
  @ApiOkResponse({ type: MainNoticeDto, isArray: true })
  mainNotices() { return this.main.notices(); }


}
