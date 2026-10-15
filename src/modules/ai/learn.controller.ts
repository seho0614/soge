import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LearnService } from './learn.service';
import { CorrectDto, RevertDto } from './learn.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';

/**
 * 분류 자동 학습.
 *
 * ── 신경망이 아닙니다 ─────────────────────────────────────────
 * **운영 판단을 학습해 정확도가 올라가는 분류 엔진**입니다.
 * 왜 그 분류인지 **단어로 설명**됩니다 — 신경망은 그걸 못 합니다.
 *
 * ── 폭주를 막는 것이 먼저입니다 ───────────────────────────────
 * 한 번 고쳤다고 바로 바꾸면 운영자 한 사람의 실수가 전체
 * 분류를 망칩니다. 3회 이상 · 상한 · 되돌리기를 둡니다.
 */
@ApiTags('AI-LEARN')
@ApiBearerAuth()
@Controller('api/v1/admin/classify')
export class LearnController {
  constructor(private readonly svc: LearnService) {}

  @Post('correct')
  @Roles('ADMIN', 'SUPER', 'REVIEWER')
  @ApiOperation({
    summary: '분류 교정',
    description:
      'AI 가 제안한 분류를 고칩니다. **한 번으로는 아무것도 바뀌지 않습니다** — ' +
      '같은 방향으로 3회 이상 쌓여야 어휘집에 반영됩니다.',
  })
  @Audit('CLASSIFY_CORRECT', 'CLASSIFY')
  correct(@Body() dto: CorrectDto) { return this.svc.correct(dto); }

  @Post('learn')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '학습 실행',
    description:
      '쌓인 교정 신호를 어휘집에 반영합니다. 보통 배치가 밤에 돌리지만 ' +
      '운영이 직접 돌릴 수도 있습니다.',
  })
  @Audit('CLASSIFY_LEARN', 'CLASSIFY')
  learn() { return this.svc.learn(); }

  @Get('learn/log')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '학습 이력',
    description: '무엇이 언제 바뀌었는지. **되돌리려면 이것이 있어야 합니다.**',
  })
  log() { return this.svc.log(); }

  @Post('learn/revert')
  @Roles('ADMIN', 'SUPER')
  @ApiOperation({
    summary: '학습 되돌리기',
    description:
      '학습이 잘못 갔을 때 그 시점 이후를 되돌립니다. ' +
      '**먼저 `classify.learn.enabled` 를 off 로 바꾸십시오** — ' +
      '되돌리는 사이에 또 학습되면 끝이 없습니다.',
  })
  @Audit('CLASSIFY_REVERT', 'CLASSIFY')
  revert(@Body() dto: RevertDto) { return this.svc.revert(dto); }
}
