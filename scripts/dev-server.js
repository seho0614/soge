/**
 * 로컬 개발 서버. 빌드 없이 앱을 띄웁니다.
 * 사용: DATABASE_URL=... JWT_SECRET=... node scripts/dev-server.js
 */
require('./load-env');
require('ts-node').register({
  compilerOptions: {
    module: 'commonjs', experimentalDecorators: true,
    emitDecoratorMetadata: true, esModuleInterop: true,
    strict: false, skipLibCheck: true,
  },
});
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { AppModule } = require('../src/app.module');
const { DbErrorFilter } = require('../src/common/db-error.filter');
const { I18nService } = require('../src/modules/i18n/i18n.service');

(async () => {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.useGlobalPipes(new ValidationPipe({
      whitelist: true, transform: true,
      // 쿼리스트링은 항상 문자열입니다. @IsInt() 를 쓰려면 변환이 필요합니다
      transformOptions: { enableImplicitConversion: true },
    }));
  app.useGlobalFilters(new DbErrorFilter(app.get(I18nService)));   // v10.125 — 오류 글을 화면 언어로(main.ts 와 같게)
  app.enableShutdownHooks();

  /* API 문서 UI.
   *
   * 개발 서버에만 붙입니다. 운영(main.ts)에는 없습니다 —
   * 인증 없이 전체 API 구조를 노출하는 것은 그 자체로 정찰 정보입니다.
   *
   * 지금까지는 문서가 파일(docs/06_openapi.json)로만 생성되어,
   * 개발 중 API 를 확인하려면 파일을 열거나 코드를 읽어야 했습니다.
   */
  if (process.env.NODE_ENV !== 'production') {
    const { DocumentBuilder, SwaggerModule } = require('@nestjs/swagger');
    const cfg = new DocumentBuilder()
      .setTitle('소개뱅크 API (개발)')
      .setDescription(
        '업무 규칙은 DB 가 집행합니다. 위반은 트리거가 올린 SIGNAL 을 ' +
        'DbErrorFilter 가 HTTP 로 옮긴 것입니다.')
      .setVersion('dev')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, cfg));
  }

  await app.listen(process.env.PORT ?? 3000);
  console.log(`API up on ${process.env.PORT ?? 3000}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`문서 http://localhost:${process.env.PORT ?? 3000}/docs`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
