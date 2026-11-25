import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DbErrorFilter } from './common/db-error.filter';

/* e1.1 (docs/001) ERP API 시작 — 포트 PORT(기본 3100 · 점검판 13100) · 입력 검사는 소개뱅크와 같은 규칙 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  /* e3.5 (docs/011) 소개뱅크 main.ts 와 같은 입력 검사(모르는 칸 400) · 같은 오류 변환기(DB 트리거 오류 → 409 · 422 · 코드 · 400 VALIDATION_ERROR)
   *   화면 언어 켜짐 확인(I18nService)은 ERP 에 없음 → 한국어 그대로(gate 없음) */
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalFilters(new DbErrorFilter());
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3100));
}
bootstrap();
