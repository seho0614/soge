/**
 * 국세청 연동 로직 시험.
 *
 * 실호출은 하지 않습니다. 사업자번호를 실제로 조회하면
 * 그 번호의 상태가 외부에 기록되고, 시험 때문에 호출 한도를 씁니다.
 * 응답 모양만 흉내 내어 판정 로직을 봅니다.
 *
 * 실연동 확인은 아래 한 줄로 따로 하십시오(호출 1회).
 *   NTS_SERVICE_KEY=... npx ts-node -P tsconfig.scripts.json scripts/test-nts.ts --live 사업자번호
 */
import { NtsBizStatusProvider } from '../src/modules/identity/verification.provider';

const fake = (payload: any, ok = true, status = 200) =>
  (async () => ({ ok, status, json: async () => payload })) as any;

let pass = 0, fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { console.log(`  ok   ${label}`); pass++; }
  else { console.log(`  FAIL ${label} — 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`); fail++; }
};

(async () => {
  /* --live 를 주면 실제로 한 번 호출합니다.
   * 발신 IP 가 공공데이터포털에 등록돼 있어야 하고, 호출 한도를 1회 씁니다. */
  const liveIdx = process.argv.indexOf('--live');
  if (liveIdx >= 0) {
    const bizNo = process.argv[liveIdx + 1];
    const key = process.env.NTS_SERVICE_KEY;
    if (!key)   { console.error('NTS_SERVICE_KEY 가 없습니다'); process.exit(1); }
    if (!bizNo) { console.error('사업자번호를 인자로 주십시오'); process.exit(1); }
    const r = await new NtsBizStatusProvider(key).check(bizNo);
    console.log('실호출 결과:', r);
    // UNKNOWN 이면 번호가 아니라 연동을 의심하십시오 —
    // 발신 IP 미등록·키 오류가 전부 UNKNOWN 으로 떨어집니다.
    process.exit(r.status === 'UNKNOWN' ? 1 : 0);
  }

  const P = (payload: any, ok = true, status = 200) =>
    new NtsBizStatusProvider('dummy-key', fake(payload, ok, status));

  const OK = (cd: string, stt: string) =>
    ({ status_code: 'OK', data: [{ b_no: '1234567890', b_stt_cd: cd, b_stt: stt }] });

  console.log('== 상태 코드 판정 ==');
  eq('01 계속사업자 → VALID',
     (await P(OK('01', '계속사업자')).check('123-45-67890')).status, 'VALID');
  eq('02 휴업자 → SUSPENDED',
     (await P(OK('02', '휴업자')).check('1234567890')).status, 'SUSPENDED');
  eq('03 폐업자 → CLOSED',
     (await P(OK('03', '폐업자')).check('1234567890')).status, 'CLOSED');

  console.log('\n== 미등록 ==');
  const unreg = { status_code: 'OK', data: [{ b_no: '0000000000', b_stt_cd: '',
                  tax_type: '국세청에 등록되지 않은 사업자등록번호입니다.' }] };
  eq('미등록 → UNKNOWN', (await P(unreg).check('0000000000')).status, 'UNKNOWN');
  eq('사유 문구 전달',
     (await P(unreg).check('0000000000')).detail, '국세청에 등록되지 않은 사업자등록번호입니다.');

  console.log('\n== 입력 검증 ==');
  eq('9자리 → UNKNOWN', (await P(OK('01','계속사업자')).check('12345')).status, 'UNKNOWN');
  eq('하이픈 제거 후 조회',
     (await P(OK('01','계속사업자')).check('123-45-67890')).status, 'VALID');

  console.log('\n== 장애 처리 (여기가 중요합니다) ==');
  // 국세청 장애를 사업자 결격으로 바꾸면 안 됩니다.
  // CLOSED 로 떨어뜨리면 멀쩡한 사업자가 가입에서 막힙니다.
  eq('HTTP 500 → UNKNOWN (CLOSED 아님)',
     (await P({}, false, 500).check('1234567890')).status, 'UNKNOWN');
  eq('status_code 오류 → UNKNOWN',
     (await P({ status_code: 'BAD_JSON_REQUEST' }).check('1234567890')).status, 'UNKNOWN');
  eq('빈 data → UNKNOWN',
     (await P({ status_code: 'OK', data: [] }).check('1234567890')).status, 'UNKNOWN');

  const boom = new NtsBizStatusProvider('k', (async () => { throw new Error('ECONNRESET'); }) as any);
  eq('연결 실패 → UNKNOWN', (await boom.check('1234567890')).status, 'UNKNOWN');
  eq('연결 실패 사유 표시', (await boom.check('1234567890')).detail, '국세청 연결 실패');

  console.log('\n== 스텁 구분 ==');
  eq('실연동은 stub=false', (await P(OK('01','계속사업자')).check('1234567890')).stub, false);

  console.log(`\n통과 ${pass} · 실패 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
