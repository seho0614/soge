import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

/* e1.1 (docs/001) ERP API 시작 — 포트 PORT(기본 3100 · 점검판 13100) · 입력 검사는 소개뱅크와 같은 규칙 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3100));
}
bootstrap();
