import { Controller, Get, HttpCode, Injectable, OnModuleDestroy, OnModuleInit, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../core/auth';
import { NotFound } from '../../core/errors';
import { SgbClient } from '../../core/sgb-client';
import { DatabaseService } from '../../db/database.service';
import { JOBS, runJob, tick } from './job-runner';

/* e1.3 (docs/003) 작업 실행기 — 1분 타이머(ERP_JOBS=off 면 끔 · 시험) · 목록 · 손 실행(SUPER) */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  constructor(readonly db: DatabaseService, readonly sgb: SgbClient) {}
  readonly q = <T = any>(sql: string, params?: unknown[]) => this.db.query<T>(sql, params ?? []);
  onModuleInit() {
    if ((process.env.ERP_JOBS ?? 'on') === 'off') return;
    this.timer = setInterval(() => { void tick(this.q, this.sgb, new Date(), this.db).catch(() => undefined); }, 60_000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('api/v1/admin/jobs')
@Roles('ADMIN', 'SUPER')
export class JobsController {
  constructor(private readonly svc: JobsService) {}

  @Get()
  @ApiOperation({ summary: 'ERP 정기 작업', description: 'e1.3 — 이름 · 주기 · 켬 · 마지막 실행 · 결과 · 주인(erp.jobs_owner) · 최근 실행 20줄' })
  @ApiOkResponse({ type: Object })
  async list() {
    const [o] = await this.svc.q<{ v: string }>(`SELECT value AS v FROM erp_settings WHERE key = 'erp.jobs_owner'`);
    const jobs = await this.svc.q(`SELECT name, schedule, enabled, description, last_run_at AS "lastRunAt", last_ok AS "lastOk", last_note AS "lastNote" FROM erp_jobs ORDER BY name`);
    const runs = await this.svc.q(`SELECT id, job, started_at AS "startedAt", ended_at AS "endedAt", ok, note, manual_by AS "manualBy" FROM erp_job_runs ORDER BY id DESC LIMIT 20`);
    return { owner: o?.v ?? 'SGB', jobs: jobs.map((j: any) => ({ ...j, registered: !!JOBS[j.name] })), runs };
  }

  @Post(':name/run')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: 'ERP 작업 손으로 돌리기', description: 'e1.3 — SUPER · 주인이 SGB 여도 됨(시험 · 확인용) · 겹치면 건너뜀 · 감사 ERP_JOB_RUN' })
  @ApiOkResponse({ type: Object })
  async run(@Param('name') name: string, @Req() req: any) {
    if (!/^[a-z][a-z0-9_]{2,40}$/.test(name) || !JOBS[name]) throw new NotFound('등록되지 않은 작업입니다.');
    const r = await runJob(this.svc.q, this.svc.sgb, name, req.erp.accountId, this.svc.db);
    await this.svc.q(`INSERT INTO erp_audit (account_id, action, target, detail) VALUES ($1, 'ERP_JOB_RUN', $2, $3::jsonb)`, [req.erp.accountId, name, JSON.stringify(r)]);
    return r;
  }
}
