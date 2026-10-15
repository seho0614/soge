/**
 * 국세청 어댑터 응답 처리 시험 (오프라인).
 *
 * 실제 호출 없이 응답만 갈아끼워 봅니다.
 * 확인하려는 것은 하나입니다 — **국세청 장애를 사업자 결격으로 바꾸지 않는가.**
 *
 * 이걸 틀리면 국세청이 잠깐 죽었을 때 멀쩡한 사업자가 CLOSED 로 찍히고,
 * 리스팅이 반려되고, 정산이 막힙니다. 그리고 국세청이 복구돼도
 * 이미 찍힌 상태는 저절로 돌아오지 않습니다.
 *
 * 실행:  npx ts-node -P tsconfig.scripts.json scripts/test-nts-offline.ts
 * 실제 호출 시험은 scripts/test-nts.ts --live 를 쓰십시오.
 */
import { NtsBizStatusProvider } from '../src/modules/identity/verification.provider';

type Case = [label: string, fetchFn: any, want: string];

const cases: Case[] = [
  ['정상 계속사업자', async () => ({ ok: true, json: async () => ({ status_code: 'OK', data: [{ b_stt_cd: '01', b_stt: '계속사업자' }] }) }), 'VALID'],
  ['휴업자',         async () => ({ ok: true, json: async () => ({ status_code: 'OK', data: [{ b_stt_cd: '02', b_stt: '휴업자' }] }) }), 'SUSPENDED'],
  ['폐업자',         async () => ({ ok: true, json: async () => ({ status_code: 'OK', data: [{ b_stt_cd: '03', b_stt: '폐업자' }] }) }), 'CLOSED'],
  ['미등록 번호',     async () => ({ ok: true, json: async () => ({ status_code: 'OK', data: [{}] }) }), 'UNKNOWN'],
  ['국세청 500',     async () => ({ ok: false, status: 500 }), 'UNKNOWN'],
  ['키 오류 401',    async () => ({ ok: false, status: 401 }), 'UNKNOWN'],
  ['연결 실패',      async () => { throw new Error('ECONNREFUSED'); }, 'UNKNOWN'],
  ['타임아웃',       async () => { const e: any = new Error('t'); e.name = 'TimeoutError'; throw e; }, 'UNKNOWN'],
  ['응답 형식 이상',  async () => ({ ok: true, json: async () => ({}) }), 'UNKNOWN'],
];

(async () => {
  let ok = 0, ng = 0;

  for (const [label, fetchFn, want] of cases) {
    const p = new NtsBizStatusProvider('dummy-key', fetchFn, 3000);
    const r = await p.check('1234567890');
    const pass = r.status === want;
    console.log(`  ${pass ? '통과' : '실패'}  ${label.padEnd(16)} → ${r.status}${pass ? '' : ` (기대 ${want})`}  ${r.detail ?? ''}`);
    pass ? ok++ : ng++;
  }

  // 자릿수 검증은 호출 전에 걸러야 합니다. 국세청에 헛요청을 보내지 않습니다.
  let called = false;
  const spy = async () => { called = true; return { ok: true, json: async () => ({}) } as any; };
  const bad = await new NtsBizStatusProvider('dummy-key', spy, 3000).check('123');
  const pass = bad.status === 'UNKNOWN' && !called;
  console.log(`  ${pass ? '통과' : '실패'}  ${'자릿수 사전차단'.padEnd(16)} → ${bad.status}  ${bad.detail ?? ''}`);
  pass ? ok++ : ng++;

  console.log(`\n통과 ${ok} · 실패 ${ng}`);
  process.exit(ng === 0 ? 0 : 1);
})();
