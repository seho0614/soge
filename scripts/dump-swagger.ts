/**
 * NestJS 컨트롤러에서 OpenAPI 조각을 추출합니다.
 * 앱을 띄우지 않고 문서만 뽑으므로 CI 에서 DB 없이 돕니다.
 *
 * ── 20260930 · AppModule 을 그대로 씁니다 ─────────────────────────
 * 전에는 컨트롤러 목록을 손으로 복사한 DocsModule 을 썼습니다.
 * 그 목록이 AppModule 과 **네 번째로** 갈렸습니다 —
 *   AuditController · LearnController · RiskLearnController · SearchController
 * 가 빠져 문서가 332건, 실제 라우트는 342건이었고, 빠진 API 가
 * "미구현" 으로 표시되었습니다(검정 FAIL 2건의 원인).
 *
 * `preview: true` 는 모듈 그래프만 만들고 프로바이더를 **생성하지 않습니다.**
 * 그래서 DB 없이도 AppModule 을 그대로 읽을 수 있고, 목록을 따로 둘
 * 이유가 없어집니다.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import { AppModule } from '../src/app.module';

async function main() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error'], preview: true, abortOnError: false,
  });
  const config = new DocumentBuilder()
    .setTitle('소개뱅크 API')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  writeFileSync('docs/_swagger_from_code.json', JSON.stringify(doc, null, 2) + '\n');
  const ops = Object.values(doc.paths).reduce(
    (n, o) => n + Object.keys(o as object).length, 0);
  console.log(`코드에서 추출: ${Object.keys(doc.paths).length} paths · ${ops} operations`);
  /* preview 앱은 close 할 것이 없습니다 — 리소스를 만들지 않았습니다 */
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack ?? e); process.exit(1); });
