import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RealtyService } from './realty.service';
import { SubmitOwnershipDto, DecideOwnershipDto } from './realty.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/**
 * 부동산 소유 확인 (A-07).
 *
 * ── 부동산은 둘만 올립니다 ────────────────────────────────────
 *   ① 공인중개사 인증을 받은 사람
 *   ② 본인 소유 물건을 올리는 소유자 — 등기로 확인한 뒤
 *
 * 공인중개사법 18조의2 ③ 이 막는 것은 **표시·광고**입니다.
 * 그래서 아직 안 보이는 **초안은 통과**시키고, 공개할 때 확인합니다.
 *
 * ── 자동 승인 경로가 없습니다 ─────────────────────────────────
 * 등기사항증명서는 **사람이 봐야** 합니다. 발급일이 30일을 넘으면
 * 그 사이 소유권이 이전됐을 수 있습니다.
 */
@ApiTags('REALTY')
@Controller('api/v1')
export class RealtyController {
  constructor(private readonly svc: RealtyService) {}

  @ApiBearerAuth()
  @Post('me/listings/:id/ownership')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({
    summary: '등기사항증명서 제출',
    description:
      '본인 소유 물건임을 확인받습니다. **발급일이 30일을 넘으면 받지 않습니다** — ' +
      '그 사이 소유권이 이전됐을 수 있습니다.\n\n' +
      '**D007 — 파일로 냅니다:** POST /files(purpose=OWNERSHIP_DOC) → PUT → complete 로 받은 `fileId`. ' +
      '본인이 올린 READY 파일만 받고(DB 트리거), 같은 파일로 매물 두 개를 확인받을 수 없습니다(409). ' +
      '`docKey`(이름만)는 호환용으로 남겨 둡니다.',
  })
  @Audit('OWNERSHIP_SUBMIT', 'LISTING')
  submit(@Param('id') id: string, @Body() dto: SubmitOwnershipDto) {
    return this.svc.submit(id, dto);
  }

  @ApiBearerAuth()
  @Get('me/listings/:id/ownership')
  @Roles('MEMBER', 'BIZ_OWNER', 'BIZ_STAFF')
  @ApiOperation({ summary: '내 소유 확인 상태' })
  mine(@Param('id') id: string) { return this.svc.mine(id); }

  @ApiBearerAuth()
  @Get('admin/ownership-queue')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '소유 확인 대기',
    description: '제출된 등기사항증명서. **사람이 보고 판단합니다** — 자동 승인이 없습니다.',
  })
  queue() { return this.svc.queue(); }

  @ApiBearerAuth()
  @Post('admin/ownership/:id/decide')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '소유 확인 판정',
    description:
      '승인하면 매물을 공개할 수 있습니다. **거절 사유를 적으십시오** — ' +
      '안 적으면 같은 서류를 다시 냅니다.',
  })
  @Audit('OWNERSHIP_DECIDE', 'LISTING')
  decide(@Param('id') id: string, @Body() dto: DecideOwnershipDto) {
    return this.svc.decide(id, dto);
  }
}
