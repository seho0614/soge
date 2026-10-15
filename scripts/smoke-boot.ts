/**
 * 부팅 스모크. 앱이 실제로 뜨고 라우트가 등록되는지 확인합니다.
 *
 * 타입 검사와 문서 생성만으로는 이걸 알 수 없습니다 —
 * 컨트롤러를 app.module 에 등록하지 않아도 둘 다 통과합니다.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';
import { DbErrorFilter } from '../src/common/db-error.filter';

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new DbErrorFilter());
  await app.init();

  // Express 5 는 _router 를 노출하지 않습니다. Nest 의 메타데이터를 직접 읽습니다.
  const { PATH_METADATA, METHOD_METADATA } = await import('@nestjs/common/constants');
  const RequestMethod = (await import('@nestjs/common')).RequestMethod as any;
  const container = (app as any).container;
  const routes: string[] = [];
  for (const [, mod] of container.getModules()) {
    for (const [, wrapper] of mod.controllers) {
      const ctrl = wrapper.metatype;
      if (!ctrl) continue;
      const base = Reflect.getMetadata(PATH_METADATA, ctrl) ?? '';
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        if (name === 'constructor') continue;
        const fn = ctrl.prototype[name];
        const sub = Reflect.getMetadata(PATH_METADATA, fn);
        if (sub === undefined) continue;
        const m = Reflect.getMetadata(METHOD_METADATA, fn);
        const verb = Object.keys(RequestMethod).find(k => RequestMethod[k] === m) ?? '?';
        routes.push(`${verb} /${base}/${sub}`.replace(/\/+/g,'/').replace(/\/$/,''));
      }
    }
  }
  routes.sort();

  // 같은 경로를 두 컨트롤러가 정의하면 뒤에 등록된 쪽이 무시됩니다.
  // 권한이 다르면 조용히 잘못된 게이트가 걸립니다 — 실제로 겪었습니다.
  const dup = routes.filter((r, i) => routes.indexOf(r) !== i);
  if (dup.length) {
    console.error('!! DUPLICATE ROUTES:', [...new Set(dup)].join(', '));
    process.exit(1);
  }
  console.log(`라우트 ${routes.length}건`);
  for (const r of routes) console.log('  ', r);

  await app.close();
  if (routes.length < 20) { console.error('!! 라우트가 너무 적습니다 — 컨트롤러 등록을 확인하십시오'); process.exit(1); }
}
main().catch(e => { console.error(e?.stack ?? e); process.exit(1); });
