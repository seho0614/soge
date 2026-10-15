#!/usr/bin/env node
/**
 * OpenAPI 병합.
 *
 *   docs/06_openapi.json   spec/screens.json 에서 생성 — 경로·화면·역할·게이트
 *   NestJS Swagger         컨트롤러 데코레이터 — 요청/응답 스키마
 *
 * 둘을 합칩니다. 레지스트리는 "어느 화면이 어느 API 를 쓰는가"를 알고,
 * 데코레이터는 "그 API 가 무엇을 주고받는가"를 압니다. 어느 쪽도 혼자서는 부족합니다.
 *
 * 충돌 규칙:
 *   - 스키마(requestBody · content) → 데코레이터 우선 (코드가 진실)
 *   - x-screens · x-roles · x-gates → 레지스트리 우선 (문서가 진실)
 *   - 레지스트리에만 있는 경로 → x-status: 'NOT_IMPLEMENTED' 로 표시
 */
const fs = require('fs');

const gen = JSON.parse(fs.readFileSync('docs/06_openapi.json', 'utf8'));
const codePath = 'docs/_swagger_from_code.json';
const code = fs.existsSync(codePath) ? JSON.parse(fs.readFileSync(codePath, 'utf8')) : { paths: {}, components: {} };

const merged = JSON.parse(JSON.stringify(gen));
merged.components.schemas = { ...(merged.components.schemas ?? {}), ...(code.components?.schemas ?? {}) };

let implemented = 0, pending = 0, extra = [];

for (const [p, ops] of Object.entries(merged.paths)) {
  for (const [m, op] of Object.entries(ops)) {
    const fromCode = code.paths?.[p]?.[m];
    if (fromCode) {
      // 스키마는 코드가 진실
      if (fromCode.requestBody) op.requestBody = fromCode.requestBody;
      if (fromCode.parameters?.length) op.parameters = fromCode.parameters;
      for (const [status, res] of Object.entries(fromCode.responses ?? {})) {
        if (res.content) op.responses[status] = res;
      }
      if (fromCode.description) op.description = fromCode.description;
      if (fromCode.summary) op.summary = fromCode.summary;
      op['x-status'] = 'IMPLEMENTED';
      if (['post','patch','put'].includes(m) && !fromCode.requestBody) op['x-no-body'] = true;
      implemented++;
    } else {
      op['x-status'] = 'NOT_IMPLEMENTED';
      op.description = (op.description ? op.description + ' ' : '') +
        '⚠ 스키마 미정의 — 컨트롤러에 @nestjs/swagger 데코레이터를 부착하십시오.';
      pending++;
    }
  }
}

// 코드에만 있고 레지스트리에 없는 경로 = 화면 없는 API
/* ── 응답 표본 (20260930) ─────────────────────────────────────────
 * 데코레이터에 응답 스키마가 없는 API 는 **실제 응답 표본**(spec/response_samples.json)에서
 * 모양을 추론해 채웁니다. 추론한 것은 x-response-source: sample 로 표시합니다 —
 * 데코레이터(@ApiOkResponse)를 붙이면 그쪽이 우선합니다.
 * 표본은 qa/capture.py 로 개발 DB 에서 다시 뽑을 수 있습니다. */
const samplePath = 'spec/response_samples.json';
const samples = fs.existsSync(samplePath) ? JSON.parse(fs.readFileSync(samplePath, 'utf8')) : {};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const infer = (v) => {
  if (v === null) return { nullable: true };
  if (Array.isArray(v)) return { type: 'array', items: v.length ? infer(v[0]) : {} };
  if (typeof v === 'object') return { type: 'object', properties: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, infer(x)])) };
  if (typeof v === 'number') return { type: Number.isInteger(v) ? 'integer' : 'number' };
  if (typeof v === 'boolean') return { type: 'boolean' };
  if (typeof v === 'string' && UUID.test(v)) return { type: 'string', format: 'uuid' };
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return { type: 'string', format: 'date-time' };
  return { type: 'string' };
};
let sampled = 0;
for (const [p, ops] of Object.entries(merged.paths)) {
  for (const [m, op] of Object.entries(ops)) {
    if (op['x-status'] !== 'IMPLEMENTED') continue;
    if (Object.values(op.responses ?? {}).some((r) => r.content)) continue;
    const sm = samples[`${m} ${p}`];
    if (sm === undefined) continue;
    const status = m === 'post' ? '201' : '200';
    op.responses = op.responses ?? {};
    op.responses[status] = {
      description: '실측 표본에서 추론한 응답 (2026-09-30 · 개발 DB)',
      content: { 'application/json': { schema: infer(sm), example: sm } },
    };
    op['x-response-source'] = 'sample';
    sampled++;
  }
}
if (sampled) console.log(`응답 표본으로 채움: ${sampled}건`);

for (const [p, ops] of Object.entries(code.paths ?? {})) {
  for (const m of Object.keys(ops)) {
    if (!merged.paths[p]?.[m]) extra.push(`${m.toUpperCase()} ${p}`);
  }
}

merged.info.description +=
  `\n\n스키마 정의 ${implemented} / 전체 ${implemented + pending} 오퍼레이션.` +
  ` x-status 로 구현 여부를 표시합니다.`;

fs.writeFileSync('docs/06_openapi.json', JSON.stringify(merged, null, 2) + '\n');
console.log(`병합: 스키마 있음 ${implemented} · 미정의 ${pending}`);
if (extra.length) {
  console.log(`!! 레지스트리에 없는 API ${extra.length}건 — spec/screens.json 에 화면을 연결하십시오`);
  extra.forEach(e => console.log('   ', e));
  process.exit(1);
}
