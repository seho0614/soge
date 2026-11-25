import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './core/audit.interceptor';
import { ErpAuthGuard } from './core/auth';
import { RequestContextMiddleware } from './core/request-context.middleware';
import { SgbClient } from './core/sgb-client';
import { DatabaseService } from './db/database.service';
import { AuthController } from './modules/system/auth.controller';
import { JobsController, JobsService } from './modules/jobs/jobs.controller';
import { SystemController } from './modules/system/system.controller';

/* e1.1 ~ (docs/001 ~) ERP API — e1.2 로그인 확인(전역 가드 · @Public 만 빼기) · e1.3 작업 실행기
 * e3.1 (docs/010) 요청 문맥(RequestCtx · 트랜잭션 · 행위자) · @Audit 감사(erp_audit) — 옮겨 오는 회계 코드가 소개뱅크와 같은 모양으로 씀 */
@Module({
  controllers: [SystemController, AuthController, JobsController],
  providers: [DatabaseService, JobsService, { provide: SgbClient, useValue: new SgbClient() },
    { provide: APP_GUARD, useClass: ErpAuthGuard }, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
