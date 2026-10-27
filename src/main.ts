import 'reflect-metadata';
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DbErrorFilter } from './common/db-error.filter';
import { I18nService } from './modules/i18n/i18n.service';
import { loadConfig } from './core/config';

async function bootstrap() {
  const config = loadConfig();          // 부팅 즉시 검증. 실패하면 뜨지 않습니다
  const app = await NestFactory.create(AppModule);

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
