import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GovernService } from './govern.service';
import { Roles } from '../../core/auth';

/**
 * 운영이 시스템 상태를 보는 화면들.
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────
 * 지금은 "무엇이 깨졌나" 를 보려면 **개발자가 터미널을 열어야**
 * 합니다. 운영이 직접 봐야 밤중에 사고가 나도 대응합니다.
 */
@ApiTags('GOVERN')
@ApiBearerAuth()
@Controller('api/v1/admin')
export class GovernController {
  constructor(private readonly svc: GovernService) {}

  @Get('invariants')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '불변식 현황',
    description:
      '감시 뷰를 한 번에 훑습니다. **0이어야 정상인 것들**이라, ' +
      '하나라도 숫자가 있으면 그 자리에서 보입니다.',
  })
  invariants() { return this.svc.invariants(); }

  @Get('acl')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '권한 계층',
    description:
      '역할 8종과 각 역할을 가진 사람 수를 봅니다. ' +
      '**PAYOUT 과 ADMIN 은 겸직할 수 없습니다** — 승인하는 사람과 ' +
      '돈을 보내는 사람을 나눕니다.',
  })
  acl() { return this.svc.acl(); }
}
