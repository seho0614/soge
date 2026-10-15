/**
 * 국세청 실연동 후 재조회 (D005 · 2026-10-01).
 *
 * 안심소개 기존 회원 일괄 이관(fn_mal_partner_bulk_migrate)은 국세청 **실연동(LIVE)**
 * 결과만 근거로 씁니다. 연동 시험 중에 찍힌 모의(STUB) · 시험(TEST) 기록은
 * 실연동이 열린 뒤 이 스크립트로 한 번 더 조회해야 일괄 승인 대상이 됩니다.
 *
 *   npm run nts:recheck            # 대상만 보여 줍니다 (아무것도 바꾸지 않음)
 *   npm run nts:recheck -- --apply # 조회 결과를 기록합니다
 *
 * 안전장치
 *   · integrations.NTS 가 LIVE 가 아니면 --apply 를 거부합니다 — 시험 결과로 LIVE 를 찍지 않습니다.
 *   · 조회 실패(UNKNOWN)는 결격이 아닙니다. nts_env 를 LIVE 로 올리지 않고 그대로 둡니다.
 */
import { Client } from 'pg';
import { NTS_API_BASE_DEFAULT, resolveBizStatusProvider } from '../src/modules/identity/verification.provider';

(async () => {
  const apply = process.argv.includes('--apply');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows: [nts] } = await db.query(`SELECT status FROM integrations WHERE code = 'NTS'`);
    const live = nts?.status === 'LIVE';
    const { rows } = await db.query<{ id: string; biz_reg_no: string; nts_env: string | null; nts_status: string | null }>(
      `SELECT id, biz_reg_no, nts_env, nts_status FROM businesses
        WHERE nts_env IS DISTINCT FROM 'LIVE' ORDER BY created_at`);
    /* ★ D008 — 기준 주소를 NTS_API_BASE 로 바꿀 수 있습니다(가짜 서버 · 프록시).
     *   공식 주소가 아니면 결과를 기록하되 **LIVE 가 아니라 TEST 로** 찍습니다 —
     *   시험 응답이 일괄 승인(fn_mal_partner_bulk_migrate) 근거가 되지 않게. */
    const base = (process.env.NTS_API_BASE || NTS_API_BASE_DEFAULT).replace(/\/+$/, '');
    const official = base === NTS_API_BASE_DEFAULT;
    const env = official ? 'LIVE' : 'TEST';
    console.log(`재조회 대상 ${rows.length}건 · 국세청 연동 ${nts?.status ?? '없음'} · 기준 주소 ${official ? '공식' : base + ' (공식 아님 → TEST 로 기록)'}`);
    if (!apply) { rows.slice(0, 20).forEach((r) => console.log(`  ${r.biz_reg_no}  ${r.nts_env ?? '-'}  ${r.nts_status ?? '-'}`)); return; }
    if (!live) { console.error('!! 국세청 연동이 LIVE 가 아닙니다 — 시험 결과로 LIVE 를 기록하지 않습니다.'); process.exitCode = 1; return; }

    const provider = resolveBizStatusProvider();
    let ok = 0, unknown = 0;
    for (const r of rows) {
      const res = await provider.check(r.biz_reg_no);
      if (res.stub || res.status === 'UNKNOWN') { unknown++; continue; }
      await db.query(
        `UPDATE businesses SET nts_status = $2, nts_detail = $3, nts_checked_at = now(), nts_env = $4 WHERE id = $1`,
        [r.id, res.status, res.detail ?? null, env]);
      ok++;
    }
    console.log(`기록 ${ok}건(${env}) · 조회 실패(그대로 둠) ${unknown}건`);
  } finally { await db.end(); }
})().catch((e) => { console.error(e); process.exit(1); });
