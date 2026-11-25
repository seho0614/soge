import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ErpAuthGuard } from './core/auth';
import { SgbClient } from './core/sgb-client';
import { DatabaseService } from './db/database.service';
import { AuthController } from './modules/system/auth.controller';
import { JobsController, JobsService } from './modules/jobs/jobs.controller';
import { SystemController } from './modules/system/system.controller';

/* e1.1 ~ (docs/001 ~) ERP API — e1.2 로그인 확인(전역 가드 · @Public 만 빼기) · e1.3 작업 실행기 */
@Module({
  controllers: [SystemController, AuthController, JobsController],
  providers: [DatabaseService, JobsService, { provide: SgbClient, useValue: new SgbClient() }, { provide: APP_GUARD, useClass: ErpAuthGuard }],
})
export class AppModule {}
