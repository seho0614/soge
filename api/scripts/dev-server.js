/**
 * e1.1 (docs/001) ERP 개발 서버 — 빌드 없이 ts-node 로(소개뱅크 scripts/dev-server.js 와 같은 방식)
 * 사용: DATABASE_URL=postgresql://…/sgb_erp node scripts/dev-server.js
 */
require('ts-node').register({
  compilerOptions: { module: 'commonjs', experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true, strict: false, skipLibCheck: true },
});
require('../src/main');
