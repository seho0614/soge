import 'reflect-metadata';
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DbErrorFilter } from './common/db-error.filter';
import { I18nService } from './modules/i18n/i18n.service';
import { loadConfig } from './core/config';

async function bootstrap() {
  const config = loadConfig();          // 부팅 즉시 검증. 실패하면 뜨지 않습니다
  /* v10.143 (D139) — rawBody: 전자계약 웹훅 서명(HMAC)을 받은 본문 그대로 검사(다시 직렬화하면 글자가 달라질 수 있음) */
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new DbErrorFilter(app.get(I18nService)));   // v10.125 — 오류 글을 화면 언어로(docs/189)
  app.enableShutdownHooks();            // 풀 정리. 배포 시 커넥션 누수 방지

  await app.listen(config.port);
}
bootstrap();
