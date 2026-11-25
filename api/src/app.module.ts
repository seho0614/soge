import { AcctBooksController } from './modules/acct/acct-books.controller';
import { AcctExtraController } from './modules/acct/acct-extra.controller';
import { AcctFilingsController } from './modules/acct/acct-filings.controller';
import { AcctOpsController } from './modules/acct/acct-ops.controller';
import { AcctController } from './modules/acct/acct.controller';
import { ErpController } from './modules/acct/erp.controller';
import { FinController } from './modules/acct/fin.controller';
import { SalesController } from './modules/acct/sales.controller';
import { ExportGateInterceptor } from './modules/admin/export-approval';
import { AgentService } from './modules/agent/agent.service';
import { EtaxService } from './modules/etax/etax.service';
import { MailService } from './common/mail/mail.service';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './core/audit.interceptor';
import { ErpAuthGuard } from './core/auth';
import { RequestContextMiddleware } from './core/request-context.middleware';
import { SgbClient, sgb } from './core/sgb-client';
import { DatabaseService } from './db/database.service';
import { AuthController } from './modules/system/auth.controller';
import { JobsController, JobsService } from './modules/jobs/jobs.controller';
import { SystemController } from './modules/system/system.controller';

/* e1.1 ~ (docs/001 ~) ERP API — e1.2 로그인 확인(전역 가드 · @Public 만 빼기) · e1.3 작업 실행기
 * e3.5 (docs/011) 회계 컨트롤러 8 · 소개뱅크 의존 연결부(AI · 세금계산서 · 메일 · 내려받기 승인)
 * e3.1 (docs/010) 요청 문맥(RequestCtx · 트랜잭션 · 행위자) · @Audit 감사(erp_audit) — 옮겨 오는 회계 코드가 소개뱅크와 같은 모양으로 씀 */
@Module({
  controllers: [SystemController, AuthController, JobsController,
    /* e3 (docs/011) 회계 · 세무 — 소개뱅크 src/modules/acct 를 옮긴 것(주소 그대로 /api/v1/admin/acct … · 권한 @Roles 그대로) */
    AcctController, AcctBooksController, AcctFilingsController, AcctExtraController, AcctOpsController, ErpController, FinController, SalesController],
  providers: [DatabaseService, JobsService, { provide: SgbClient, useValue: sgb },
    { provide: APP_GUARD, useClass: ErpAuthGuard }, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    /* e3.5 소개뱅크 의존 연결부(내부 API) · 내려받기 승인 */
    AgentService, EtaxService, MailService, { provide: APP_INTERCEPTOR, useClass: ExportGateInterceptor }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
