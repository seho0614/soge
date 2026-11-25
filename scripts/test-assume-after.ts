/**
 * 간주 끈 뒤 처리 도구 시험 (v10.792 · D331 · src/modules/admin/assume-after.ts).
 *
 * 진짜 DB(DATABASE_URL — 통합 검정은 sgb_check) 위에서 **거래 하나 안에서** 시험하고 되돌립니다(자료가 남지 않음).
 * 국토부 조회는 가짜 공급자(등록번호 끝자리로 MATCH · MISMATCH · NOT_FOUND · 실패)를 넣습니다.
 *   ① 조회 연동 없음 → 422 LOOKUP_NOT_CONFIGURED · 재대조 대상(v_broker_recheck_pending)에 간주 승인 4건
 *   ② 재대조 → 일치 1 · 다름 1 · 없음 1 · 실패 1 · 승인 상태 · 승인 시각 그대로 · 운영 알림 BROKER_RECHECK_MISMATCH 1 · 남은 대상 3(일치만 빠짐)
 *   ③ 확인 — 일치 409 · 짧은 사유 422 · 다름 확인 · 두 번째 409 · 기록 지우기 · 결과 고치기를 DB 가 막음
 *   ④ 개요 — 시험 기록 종류 4 · 시험 하위가맹점 번호 판매자 목록 모양
 *
 * 실행:  npx ts-node -P tsconfig.scripts.json scripts/test-assume-after.ts
 */
import { Client } from 'pg';
import { AssumeAfter, STUB_KINDS } from '../src/modules/admin/assume-after';
import { BrokerLookupProvider, type BrokerLookupInput, type BrokerLookupOutcome } from '../src/modules/partner/broker-lookup.provider';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

class FakeLookup extends BrokerLookupProvider {
  constructor(readonly configured: boolean) { super(); }
  async lookup(i: BrokerLookupInput): Promise<BrokerLookupOutcome> {
    const last = i.licenseNo.slice(-1);
    if (last === '1') return { result: 'MATCH', stub: false, detail: '시험 일치' };
    if (last === '2') return { result: 'MISMATCH', stub: false, detail: '시험 대표자 다름' };
    if (last === '3') return { result: 'NOT_FOUND', stub: false, detail: '시험 등록번호 없음' };
    return { result: null, stub: false, errorKind: 'TIMEOUT', detail: '시험 조회 지연' } as BrokerLookupOutcome;
  }
}
/* 서비스 오류는 code(RECHECK_ACKED …) · DB 트리거 오류는 글(BROKER_RECHECK_APPEND_ONLY: …)로 — pg 오류의 code 는 P0001 이라 글을 봄 */
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e: any) { const c = e?.response?.code ?? (e?.code && !/^[0-9A-Z]{5}$/.test(String(e.code)) ? e.code : null); return String(c ?? e?.message ?? e).slice(0, 80); } };

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const q = async <T = any>(sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows as T[];
  await c.query('BEGIN');
  try {
    const sid = Date.now().toString(36);
    const [staff] = await q(`INSERT INTO accounts (email, password_hash, name, account_type, status) VALUES ($1, 'x', '재대조시험', 'PERSONAL', 'ACTIVE') RETURNING id`, [`aa-staff-${sid}@x.test`]);
    const ver: string[] = [];
    for (const n of [1, 2, 3, 4]) {
      const [a] = await q(`INSERT INTO accounts (email, password_hash, name, account_type, status) VALUES ($1, 'x', '중개시험', 'BUSINESS', 'ACTIVE') RETURNING id`, [`aa-${n}-${sid}@x.test`]);
      const [b] = await q(`INSERT INTO businesses (account_id, biz_reg_no, company_name, ceo_name, verified_at) VALUES ($1, $2, '재대조시험사', '시험대표', now()) RETURNING id`, [a.id, `AA${sid}${n}`]);
      const [v] = await q(
        `INSERT INTO broker_verifications (business_id, license_no, office_name, ceo_name, state, lookup_result, lookup_source, decided_by)
         VALUES ($1, $2, '시험사무소', '시험대표', 'VERIFIED', 'MATCH', 'ASSUMED', $3) RETURNING id, decided_at`, [b.id, `11000-2026-${sid}${n}`, staff.id]);
      ver.push(v.id);
    }
    const before = await q(`SELECT id, state, decided_at::text AS d FROM broker_verifications WHERE id = ANY($1::uuid[]) ORDER BY id`, [ver]);

    /* ① */
    const off = new AssumeAfter(q, () => new FakeLookup(false));
    const e1 = await code(off.brokerRecheck(staff.id));
    const [p1] = await q(`SELECT count(*)::int AS n FROM v_broker_recheck_pending WHERE id = ANY($1::uuid[])`, [ver]);
    ok('① 조회 연동 없음 → LOOKUP_NOT_CONFIGURED · 재대조 대상 4', /LOOKUP_NOT_CONFIGURED|조회 연동/.test(e1) && p1.n === 4, `${e1} · ${p1.n}`);

    /* ② — 다른 간주 승인이 있어도 이 시험 4건만 보게 limit 은 50, 결과는 이 4건으로 셈 */
    const t0 = (await q(`SELECT clock_timestamp()::text AS t`))[0].t;
    const on = new AssumeAfter(q, () => new FakeLookup(true));
    const r = await on.brokerRecheck(staff.id, 50);
    const rows = await q<{ verification_id: string; result: string }>(`SELECT verification_id, result FROM broker_rechecks WHERE verification_id = ANY($1::uuid[])`, [ver]);
    const by = (k: string) => rows.filter((x) => x.result === k).length;
    const after = await q(`SELECT id, state, decided_at::text AS d FROM broker_verifications WHERE id = ANY($1::uuid[]) ORDER BY id`, [ver]);
    const [al] = await q(`SELECT count(*)::int AS n FROM ops_alerts WHERE alert_code = 'BROKER_RECHECK_MISMATCH' AND raised_at >= $1::timestamptz`, [t0]);
    const [p2] = await q(`SELECT count(*)::int AS n FROM v_broker_recheck_pending WHERE id = ANY($1::uuid[])`, [ver]);
    ok('② 재대조 → 일치 1 · 다름 1 · 없음 1 · 실패 1 · 승인 · 승인 시각 그대로 · 알림 1 · 남은 대상 3',
       by('MATCH') === 1 && by('MISMATCH') === 1 && by('NOT_FOUND') === 1 && by('FAILED') === 1
       && JSON.stringify(before) === JSON.stringify(after) && al.n === 1 && p2.n === 3 && r.checked >= 4,
       `${JSON.stringify({ m: by('MATCH'), x: by('MISMATCH'), n: by('NOT_FOUND'), f: by('FAILED') })} · same=${JSON.stringify(before) === JSON.stringify(after)} · alert ${al.n} · left ${p2.n}`);

    /* ③ */
    const id = async (res: string) => String((await q(`SELECT r.id FROM broker_rechecks r WHERE r.verification_id = ANY($1::uuid[]) AND r.result = $2`, [ver, res]))[0].id);
    const eMatch = await code(on.ack(staff.id, await id('MATCH'), '확인함'));
    const eShort = await code(on.ack(staff.id, await id('MISMATCH'), 'x'));
    const done = await on.ack(staff.id, await id('MISMATCH'), '서류 다시 받음 · 이상 없음');
    const eTwice = await code(on.ack(staff.id, await id('MISMATCH'), '두 번째'));
    await c.query('SAVEPOINT s1');
    const eDel = await code(c.query(`DELETE FROM broker_rechecks WHERE id = $1`, [await id('NOT_FOUND')]));
    await c.query('ROLLBACK TO SAVEPOINT s1');
    const eUpd = await code(c.query(`UPDATE broker_rechecks SET result = 'MATCH' WHERE id = $1`, [await id('NOT_FOUND')]));
    await c.query('ROLLBACK TO SAVEPOINT s1');
    ok('③ 확인 — 일치 409 · 짧은 사유 422 · 다름 확인 · 두 번째 409 · 지우기 · 결과 고치기 DB 가 막음',
       /RECHECK_NOT_FLAGGED|다름 · 없음 결과만/.test(eMatch) && /NOTE_REQUIRED|2 ~ 200자/.test(eShort) && !!done?.ackAt
       && /RECHECK_ACKED|이미 확인/.test(eTwice) && /BROKER_RECHECK_APPEND_ONLY/.test(eDel) && /BROKER_RECHECK_APPEND_ONLY/.test(eUpd),
       `${eMatch} · ${eShort} · ${eTwice} · ${eDel.slice(0, 30)} · ${eUpd.slice(0, 30)}`);

    /* ④ */
    const ov = await on.overview();
    const mine = ov.broker.items.filter((x: any) => ver.includes(x.id));
    ok('④ 개요 — 시험 기록 종류 4 · 판매자 목록 · 이 시험 중개사 4줄(일치 1 matched · 확인 1)',
       ov.stubs.length === STUB_KINDS.length && STUB_KINDS.length === 4 && Array.isArray(ov.sellers) && ov.broker.configured
       && mine.length === 4 && mine.filter((x: any) => x.matched).length === 1 && mine.filter((x: any) => x.ackAt).length === 1,
       `stubs ${ov.stubs.length} · mine ${mine.length}`);
  } finally {
    await c.query('ROLLBACK'); await c.end();
  }
  console.log(fail === 0 ? `간주 끈 뒤 처리 시험 — 전체 통과 (${pass})` : `간주 끈 뒤 처리 시험 — 실패 ${fail} / ${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.log('간주 끈 뒤 처리 시험 — 오류 ' + String(e?.message ?? e).slice(0, 200)); process.exit(1); });
