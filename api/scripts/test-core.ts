/**
 * e1.2 · e1.3 (docs/002 · 003) ERP 뼈대 시험 — DB · 소개뱅크 없이(가짜 fetch) 판정 · 기억 · 주기만.
 *   ① decide — 로그인 아님 401 · 회원 403 ERP_NOT_STAFF · 2단계 전 403 · SUPER 통과 · ROLE 판정(역할) · GROUPS 판정(업무 권한만)
 *   ② SgbClient — introspect 60초 기억(두 번째는 부르지 않음) · 서비스 토큰 머리 · 403 → ERP_SGB_TOKEN · 연결 실패 → ERP_SGB_DOWN · alert 실패해도 false
 *   ③ due — every 10m · daily 04:40(한국 시각 · 오늘 이미 돎)
 * 실행: cd api && npx ts-node --transpile-only scripts/test-core.ts
 */
import { decide } from '../src/core/auth';
import { SgbClient, introspectCacheClear } from '../src/core/sgb-client';
import { due } from '../src/modules/jobs/job-runner';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };

async function main() {
  const staff = { active: true, staff: true, mfaOk: true, roles: ['ADMIN'], perm: { enforce: 'OFF', decide: 'ROLE', tasks: ['acct:VIEW'] } };
  const r1 = decide({ active: false, reason: 'UNAUTHENTICATED' });
  const r2 = decide({ active: false, reason: 'NOT_STAFF' });
  const r3 = decide({ ...staff, mfaOk: false });
  const r4 = decide({ ...staff, roles: ['SUPER'], super: true, perm: { enforce: 'ON', decide: 'GROUPS', tasks: [] } }, { task: 'hr', level: 'EDIT' });
  const r5 = decide({ ...staff, roles: ['REVIEWER'] }, { task: 'hr', level: 'EDIT' }, ['ADMIN']);
  const r6 = decide({ ...staff }, { task: 'hr', level: 'EDIT' }, ['ADMIN']);
  const r7 = decide({ ...staff, perm: { enforce: 'OFF', decide: 'GROUPS', tasks: ['acct:VIEW'] } }, { task: 'hr', level: 'EDIT' }, ['ADMIN']);
  const r8 = decide({ ...staff, roles: ['REVIEWER'], perm: { enforce: 'OFF', decide: 'GROUPS', tasks: ['hr:EDIT'] } }, { task: 'hr', level: 'EDIT' });
  ok('① decide — 401 · NOT_STAFF · MFA_REQUIRED · SUPER 통과 · ROLE: 역할 없음 403 · 역할 있음 통과 · GROUPS: 역할 있어도 업무 없으면 403 · 업무 있으면 통과',
     !r1.ok && r1.status === 401 && !r2.ok && r2.code === 'ERP_NOT_STAFF' && !r3.ok && r3.code === 'MFA_REQUIRED' && r4.ok
     && !r5.ok && r5.code === 'PERM_DENIED' && r6.ok && !r7.ok && r8.ok, JSON.stringify([r1, r2, r3, r4, r5, r6, r7, r8].map((x) => x.ok)));

  introspectCacheClear();
  let calls = 0; let seenHdr = '';
  const fake = async (url: string, init?: any) => {
    calls++; seenHdr = init?.headers?.['X-Erp-Service-Token'] ?? '';
    if (url.includes('/auth/introspect')) return { ok: true, status: 200, json: async () => ({ ...staff, accountId: '11111111-1111-1111-1111-111111111111' }) };
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const c = new SgbClient(fake, { SGB_API_URL: 'http://sgb.test/api/v1/', SGB_SERVICE_TOKEN: 'erp_x' } as any);
  const a = await c.introspect('tok-aaaaaaaaaaaaaaaaaaaa');
  const b = await c.introspect('tok-aaaaaaaaaaaaaaaaaaaa');
  await c.introspect('tok-bbbbbbbbbbbbbbbbbbbb');
  const c403 = new SgbClient(async () => ({ ok: false, status: 403, json: async () => ({}) }), {} as any);
  const cDown = new SgbClient(async () => { throw new Error('ECONNREFUSED'); }, {} as any);
  const e403 = await c403.introspect('tok-cccccccccccccccccccc').then(() => 'none', (e) => e.getResponse?.().code);
  const eDown = await cDown.introspect('tok-dddddddddddddddddddd').then(() => 'none', (e) => e.getResponse?.().code);
  const al = await cDown.alert({ code: 'ERP_TEST', title: 'x' });
  ok('② SgbClient — 같은 토큰 두 번째는 기억(부름 2 = 토큰 둘) · 서비스 토큰 머리 · 403 ERP_SGB_TOKEN · 연결 실패 ERP_SGB_DOWN · alert 실패 false',
     a.active === true && b.accountId === a.accountId && calls === 2 && seenHdr === 'erp_x' && e403 === 'ERP_SGB_TOKEN' && eDown === 'ERP_SGB_DOWN' && al === false,
     `calls ${calls} · ${e403} · ${eDown}`);

  const now = new Date('2026-11-25T00:00:00Z');   // 한국 09:00
  ok('③ due — every 10m(9분 전 아님 · 11분 전 맞음 · 처음 맞음) · daily 04:40(오늘 안 돎 맞음 · 오늘 돎 아님 · 시각 전 아님)',
     !due('every 10m', new Date(now.getTime() - 9 * 60000), now) && due('every 10m', new Date(now.getTime() - 11 * 60000), now) && due('every 10m', null, now)
     && due('daily 04:40', new Date('2026-11-23T20:00:00Z'), now) && !due('daily 04:40', new Date('2026-11-24T19:41:00Z'), now)
     && !due('daily 10:00', null, now) && !due('weekly', null, now), '');

  console.log(fail === 0 ? `ERP 뼈대 시험 — 전체 통과 (${pass})` : `ERP 뼈대 시험 — 실패 ${fail} / ${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.log('ERP 뼈대 시험 — 오류 ' + String(e?.message ?? e).slice(0, 200)); process.exit(1); });
