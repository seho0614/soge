/**
 * 결제 어댑터 응답 처리 시험 (오프라인).
 *
 * 실제 호출 없이 응답만 갈아끼워 봅니다. 확인하려는 것은 셋입니다.
 *
 *   1) 토스 장애를 결제 성공으로 바꾸지 않는가
 *      — 여기서 approved:true 를 내면 돈을 안 받고 구독을 열어 줍니다.
 *        구독료가 유일한 매출원이므로 이 구멍은 곧 매출 구멍입니다.
 *
 *   2) 금액을 대조하는가
 *      — 클라이언트가 보낸 금액이 아니라 토스가 확인해 준 금액을 봅니다.
 *        100원 결제하고 149,000원 요금제를 열 수 있으면 안 됩니다.
 *
 *   3) 소개비를 결제로 태우지 못하게 막는가 (INV-11)
 *      — 플랫폼이 남의 돈을 받았다가 보내주면 자금 수탁이 됩니다.
 *        전자금융거래법 검토 대상이 되고, 그건 일정 문제가 아닙니다.
 *
 *   4) (D022 · v10.18) 「거절」과 「결과를 알 수 없음」을 가르는가
 *      — 5xx · 응답 없음 · 「이미 처리된 결제」는 승인(취소)됐을 수 있습니다. 거절로 단정하면
 *        돈은 나갔는데 실패로 적거나, 같은 청구를 한 번 더 보냅니다. uncertain 으로 표시해 조회로 확인하게 합니다.
 *        반대로 카드 거절(4xx)을 불명확으로 두면 청구가 영영 닫히지 않습니다.
 *
 * 실행:  npx ts-node -P tsconfig.scripts.json scripts/test-payment-offline.ts
 */
import { StubPaymentProvider, TossPaymentProvider } from '../src/modules/billing/payment.provider';

const ok = (body: any) => async () => ({ ok: true, json: async () => body });
const err = (status: number, body: any = {}) => async () => ({ ok: false, status, json: async () => body });

const REQ = { paymentKey: 'pk_test', orderId: 'ord_1', amount: 49000, orderName: '스탠다드 구독료' };

type Case = [label: string, fetchFn: any, req: any, wantApproved: boolean];

const cases: Case[] = [
  ['정상 승인',
    ok({ status: 'DONE', totalAmount: 49000, method: '카드' }), REQ, true],

  ['금액 불일치 (조작)',
    ok({ status: 'DONE', totalAmount: 100, method: '카드' }), REQ, false],

  ['결제 취소 상태',
    ok({ status: 'CANCELED', totalAmount: 49000 }), REQ, false],

  ['대기 상태',
    ok({ status: 'WAITING_FOR_DEPOSIT', totalAmount: 49000 }), REQ, false],

  ['토스 500',
    err(500, { message: '서버 오류' }), REQ, false],

  ['잘못된 키 401',
    err(401, { message: '인증 실패' }), REQ, false],

  ['이미 처리된 결제 400',
    err(400, { message: '이미 승인된 결제입니다' }), REQ, false],

  ['연결 실패',
    async () => { throw new Error('ECONNREFUSED'); }, REQ, false],

  ['타임아웃',
    async () => { const e: any = new Error('t'); e.name = 'TimeoutError'; throw e; }, REQ, false],

  ['응답 형식 이상',
    ok({}), REQ, false],

  // INV-11
  ['소개비 결제 시도',
    ok({ status: 'DONE', totalAmount: 49000 }), { ...REQ, orderName: '소개비 정산' }, false],

  ['중개비 결제 시도',
    ok({ status: 'DONE', totalAmount: 49000 }), { ...REQ, orderName: '중개비' }, false],

  ['금액 0원',
    ok({ status: 'DONE', totalAmount: 0 }), { ...REQ, amount: 0 }, false],

  ['금액 음수',
    ok({ status: 'DONE', totalAmount: -1 }), { ...REQ, amount: -1000 }, false],
];

(async () => {
  let pass = 0, fail = 0;

  for (const [label, fetchFn, req, want] of cases) {
    const p = new TossPaymentProvider('test_gsk_dummy', fetchFn, 3000);
    const r = await p.confirm(req);
    const good = r.approved === want;
    console.log(`  ${good ? '통과' : '실패'}  ${label.padEnd(18)} → ${r.approved ? '승인' : '거부'}${good ? '' : ` (기대 ${want ? '승인' : '거부'})`}  ${r.detail ?? ''}`);
    good ? pass++ : fail++;
  }

  // 시크릿 키가 URL 이나 본문에 실리면 안 됩니다. Basic 헤더로만 가야 합니다.
  let seen = { url: '', init: null as any };
  const spy = async (url: string, init: any) => {
    seen = { url, init };
    return { ok: true, json: async () => ({ status: 'DONE', totalAmount: 49000 }) };
  };
  await new TossPaymentProvider('test_gsk_SECRETVALUE', spy, 3000).confirm(REQ);

  const leaked = seen.url.includes('SECRETVALUE') || String(seen.init?.body ?? '').includes('SECRETVALUE');
  const inHeader = String(seen.init?.headers?.Authorization ?? '').startsWith('Basic ');
  const good = !leaked && inHeader;
  console.log(`  ${good ? '통과' : '실패'}  ${'시크릿키 노출 차단'.padEnd(18)} → ${leaked ? 'URL/본문에 노출!' : 'Basic 헤더로만 전송'}`);
  good ? pass++ : fail++;

  /* ── 정기결제(빌링키) ─────────────────────────────────────────────
   * 단건 승인과 같은 문을 지나야 합니다.
   * 여기서 느슨해지면 매달 자동으로 새는 구멍이 됩니다. */
  const BILL = {
    billingKey: 'bk_test', customerKey: 'cus_1',
    orderId: 'ord_1', amount: 49000, orderName: '스탠다드 구독료',
  };
  const billCases: Array<[string, any, any, boolean]> = [
    ['정기결제 정상',   ok({ status: 'DONE', totalAmount: 49000 }), BILL, true],
    ['정기결제 금액 조작', ok({ status: 'DONE', totalAmount: 100 }), BILL, false],
    ['정기결제 토스 500', err(500, { message: '서버 오류' }), BILL, false],
    ['정기결제 빌링키 만료', err(400, { message: '유효하지 않은 빌링키' }), BILL, false],
    ['정기결제 연결 실패', async () => { throw new Error('ECONNREFUSED'); }, BILL, false],
    ['정기결제로 소개비 시도',
      ok({ status: 'DONE', totalAmount: 49000 }), { ...BILL, orderName: '소개비 정산' }, false],
    ['정기결제 금액 0원',
      ok({ status: 'DONE', totalAmount: 0 }), { ...BILL, amount: 0 }, false],
  ];

  for (const [label, fetchFn, req, want] of billCases) {
    const p = new TossPaymentProvider('test_gsk_dummy', fetchFn, 3000);
    const r = await p.chargeWithBillingKey(req);
    const good = r.approved === want;
    console.log(`  ${good ? '통과' : '실패'}  ${label.padEnd(18)} → ${r.approved ? '승인' : '거부'}  ${r.detail ?? ''}`);
    good ? pass++ : fail++;
  }

  // 빌링키 발급도 실패를 성공으로 바꾸지 않아야 합니다.
  const issueCases: Array<[string, any, boolean]> = [
    ['빌링키 발급 정상', ok({ billingKey: 'bk_1', card: { company: '신한', number: '1234-****-****-5678' } }), true],
    ['빌링키 없는 응답', ok({}), false],
    ['빌링키 발급 401', err(401, { message: '인증 실패' }), false],
  ];
  for (const [label, fetchFn, want] of issueCases) {
    const p = new TossPaymentProvider('test_gsk_dummy', fetchFn, 3000);
    const r = await p.issueBillingKey({ authKey: 'ak', customerKey: 'cus' });
    const good = r.approved === want;
    console.log(`  ${good ? '통과' : '실패'}  ${label.padEnd(18)} → ${r.approved ? '발급' : '거부'}  ${r.cardLast4 ?? r.detail ?? ''}`);
    good ? pass++ : fail++;
  }

  /* ── D022 「거절(확정)」과 「결과 불명확」 ─────────────────────────────
   * 기대값: uncertain 이 true 인가(불명확) · 아닌가(확정). 코드 이름은 토스 문서(코어 API 에러 코드 · 멱등키)의 것입니다. */
  const T = (f: any) => new TossPaymentProvider('test_gsk_dummy', f, 3000);
  const boom = async () => { throw new Error('ECONNRESET'); };
  const slow = async () => { const e: any = new Error('timeout'); e.name = 'TimeoutError'; throw e; };
  const unc: Array<[string, () => Promise<any>, boolean, string?]> = [
    ['청구 500 → 불명확',              () => T(err(500, { code: 'FAILED_INTERNAL_SYSTEM_PROCESSING' })).chargeWithBillingKey(BILL), true],
    ['청구 연결 끊김 → 불명확',         () => T(boom).chargeWithBillingKey(BILL), true],
    ['청구 응답 지연 → 불명확',         () => T(slow).chargeWithBillingKey(BILL), true],
    ['청구 카드사 거절 403 → 확정',     () => T(err(403, { code: 'REJECT_CARD_COMPANY', message: '한도 초과' })).chargeWithBillingKey(BILL), false],
    ['청구 만료 카드 400 → 확정',       () => T(err(400, { code: 'INVALID_CARD_EXPIRATION', message: '만료된 카드' })).chargeWithBillingKey(BILL), false],
    ['청구 중복 주문번호 → 불명확',     () => T(err(400, { code: 'DUPLICATED_ORDER_ID' })).chargeWithBillingKey(BILL), true],
    ['청구 멱등 요청 처리 중 → 불명확', () => T(err(409, { code: 'IDEMPOTENT_REQUEST_PROCESSING' })).chargeWithBillingKey(BILL), true],
    ['청구 금액 다르게 승인 → 불명확',  () => T(ok({ status: 'DONE', totalAmount: 48900, paymentKey: 'pk_x' })).chargeWithBillingKey(BILL), true, 'AMOUNT_MISMATCH'],
    ['승인 500 → 불명확',              () => T(err(500, {})).confirm(REQ), true],
    ['승인 연결 끊김 → 불명확',         () => T(boom).confirm(REQ), true],
    ['승인 이미 처리된 결제 → 불명확',  () => T(err(400, { code: 'ALREADY_PROCESSED_PAYMENT' })).confirm(REQ), true],
    ['승인 카드사 거절 403 → 확정',     () => T(err(403, { code: 'REJECT_CARD_COMPANY' })).confirm(REQ), false],
    ['취소 500 → 불명확',              () => T(err(500, {})).cancel({ paymentKey: 'pk', cancelReason: 'x', cancelAmount: 49000 }), true],
    ['취소 연결 끊김 → 불명확',         () => T(boom).cancel({ paymentKey: 'pk', cancelReason: 'x' }), true],
    ['취소 이미 취소된 결제 → 불명확',  () => T(err(400, { code: 'ALREADY_CANCELED_PAYMENT' })).cancel({ paymentKey: 'pk', cancelReason: 'x' }), true],
    ['취소 불가 403 → 확정',           () => T(err(403, { code: 'NOT_CANCELABLE_PAYMENT' })).cancel({ paymentKey: 'pk', cancelReason: 'x' }), false],
    ['취소 없는 결제 404 → 확정',       () => T(err(404, { code: 'NOT_FOUND_PAYMENT' })).cancel({ paymentKey: 'pk', cancelReason: 'x' }), false],
    ['취소 금액 다르게 처리 → 불명확',  () => T(ok({ status: 'PARTIAL_CANCELED', cancels: [{ cancelAmount: 100 }] })).cancel({ paymentKey: 'pk', cancelReason: 'x', cancelAmount: 49000 }), true, 'AMOUNT_MISMATCH'],
  ];
  for (const [label, run, want, code] of unc) {
    const r = await run();
    const good = (r.approved ?? r.ok) === false && !!r.uncertain === want && (!code || r.code === code);
    console.log(`  ${good ? '통과' : '실패'}  ${label.padEnd(22)} → ${r.uncertain ? '불명확' : '확정 거절'}${code ? ` · ${r.code}` : ''}`);
    good ? pass++ : fail++;
  }

  // 조회 — 「없다」는 답(404 NOT_FOUND_PAYMENT)과 「조회가 안 됐다」를 가릅니다. 없다는 답만 「그 결제는 없었다」의 근거입니다
  const look: Array<[string, any, boolean]> = [
    ['조회 404 없는 결제 → 없음',  err(404, { code: 'NOT_FOUND_PAYMENT' }), true],
    ['조회 500 → 모름',           err(500, {}), false],
    ['조회 연결 끊김 → 모름',      boom, false],
    ['조회 401 → 모름',           err(401, { code: 'UNAUTHORIZED_KEY' }), false],
  ];
  for (const [label, f, want] of look) {
    const r = await T(f).getPaymentByOrderId('ord_1');
    const good = r.found === false && !!r.notFound === want;
    console.log(`  ${good ? '통과' : '실패'}  ${label.padEnd(22)} → ${r.notFound ? '결제사에 없음' : '조회 실패(확정 아님)'}`);
    good ? pass++ : fail++;
  }

  // 정기결제는 멱등 키를 헤더로 보냅니다 — 응답을 못 받고 다시 보내도 결제사가 한 번만 처리합니다
  let sent: any = null;
  await T(async (_u: string, init: any) => { sent = init; return { ok: true, json: async () => ({ status: 'DONE', totalAmount: 49000, paymentKey: 'pk_1' }) }; })
    .chargeWithBillingKey({ ...BILL, idempotencyKey: 'sub-charge-1-a1' });
  {
    const good = sent?.headers?.['Idempotency-Key'] === 'sub-charge-1-a1';
    console.log(`  ${good ? '통과' : '실패'}  ${'정기결제 멱등 키 헤더'.padEnd(22)} → ${sent?.headers?.['Idempotency-Key'] ?? '없음'}`);
    good ? pass++ : fail++;
  }

  // 스텁 — 청구한 것을 주문번호로 찾을 수 있고(열쇠 없이도 대조 · 환불 흐름을 시험), 모르는 주문은 「없음」
  {
    const st = new StubPaymentProvider();
    const c = await st.chargeWithBillingKey({ amount: 49000, orderId: 'sub_x_1_a1' });
    const hit = await st.getPaymentByOrderId('sub_x_1_a1');
    const miss = await st.getPaymentByOrderId('sub_x_1_a2');
    const good = c.approved && !!c.paymentKey && hit.found && hit.status === 'DONE' && hit.paymentKey === c.paymentKey && !miss.found && miss.notFound === true;
    console.log(`  ${good ? '통과' : '실패'}  ${'스텁 청구 → 주문번호 조회'.padEnd(22)} → ${hit.found ? hit.status : '못 찾음'} · 모르는 주문 ${miss.notFound ? '없음' : '?'}`);
    good ? pass++ : fail++;
  }

  console.log(`\n통과 ${pass} · 실패 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
