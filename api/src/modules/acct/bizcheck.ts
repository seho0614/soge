/* e3 (docs/010) 소개뱅크 src/modules/acct/bizcheck.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { resolveBizStatusProvider } from '../identity/verification.provider';

/* ---------------------------------------------------------------------
 * v10.431 (D254 · docs/568) 거래처 휴폐업 조회 — 국세청 사업자 상태(공공데이터포털 odcloud nts-businessman/v1/status)
 *   새 어댑터를 만들지 않고 회원 사업자 인증이 쓰는 것을 그대로 씀(identity/verification.provider · resolveBizStatusProvider):
 *     키(NTS_SERVICE_KEY · 외부 연동 키 화면 「NTS」)가 있으면 실제 조회, 없으면 간주(VALID · stub) — 간주 결과는 판단 근거로 쓰지 않음(화면 「간주」).
 *   스위치 acct.biz_status_check(처음 off) — off 면 조회하지 않음(NOT_READY). 켜는 것은 SUPER.
 *   결과: acct_parties.biz_status(VALID · SUSPENDED 휴업 · CLOSED 폐업 · UNKNOWN) · biz_checked_at · biz_detail · biz_stub.
 *   휴업 · 폐업(간주 아님)이면 운영 알림 ACCT_PARTY_CLOSED(거래처마다 한 번 · 다시 VALID 면 풀림) · ⑫ 매입 넣을 때 경고(막지 않음).
 *   정기 작업 acct_biz_check(매일 06:10) — 켜져 있으면 조회한 지 30일 지난 거래처를 하루 50곳까지 다시 조회.
 * ------------------------------------------------------------------- */

export const BIZ_STATUS_KO: Record<string, string> = { VALID: '계속사업자', SUSPENDED: '휴업', CLOSED: '폐업', UNKNOWN: '확인 안 됨' };

async function enabled(db: DatabaseService) {
  const [s] = await db.query<{ v: string | null }>(`SELECT value AS v FROM erp_site_settings WHERE key = 'acct.biz_status_check'`);
  return (s?.v ?? 'off') === 'on';
}

async function checkOne(db: DatabaseService, id: string, bizNo: string, name: string) {
  const r = await resolveBizStatusProvider().check(bizNo);
  const [prev] = await db.query<{ s: string | null }>(`SELECT biz_status AS s FROM acct_parties WHERE id = $1::bigint`, [id]);
  await db.query(
    `UPDATE acct_parties SET biz_status = $2, biz_checked_at = now(), biz_detail = $3, biz_stub = $4 WHERE id = $1::bigint`,
    [id, r.status, (r.detail ?? '').slice(0, 200) || null, r.stub]);
  const bad = !r.stub && (r.status === 'CLOSED' || r.status === 'SUSPENDED');
  if (bad) {
    await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'ACCT_PARTY_CLOSED', 'WARN', $1, $2::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ACCT_PARTY_CLOSED' AND resolved_at IS NULL AND detail->>'partyId' = $3)
       ON CONFLICT DO NOTHING`,
      [`거래처 「${name}」 이(가) 국세청 기준 ${BIZ_STATUS_KO[r.status]}입니다 — 회계 › 거래처`, JSON.stringify({ partyId: id, status: r.status, detail: r.detail ?? null }), id]);
  } else if (r.status === 'VALID' && !r.stub) {
    await db.query(
      `UPDATE ops_alerts SET resolved_at = now(), resolve_note = '계속사업자로 다시 확인'
        WHERE alert_code = 'ACCT_PARTY_CLOSED' AND resolved_at IS NULL AND detail->>'partyId' = $1`, [id]);
  }
  return { id, status: r.status, statusKo: BIZ_STATUS_KO[r.status], stub: r.stub, detail: r.detail ?? null, changed: (prev?.s ?? null) !== r.status, alert: bad };
}

/** POST /admin/acct/parties/{id}/biz-check — 한 곳 지금 조회(SUPER · PAYOUT) */
export async function bizCheckParty(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 거래처입니다.');
  if (!(await enabled(db))) throw new PolicyViolation('BIZ_CHECK_OFF', '휴폐업 조회가 꺼져 있습니다 — 정책 › 전체 설정 acct.biz_status_check 를 켜십시오(SUPER).');
  const [p] = await db.query<{ biz_no: string | null; name: string }>(`SELECT biz_no, name FROM acct_parties WHERE id = $1::bigint`, [id]);
  if (!p) throw new NotFound('없는 거래처입니다.');
  if (!p.biz_no) throw new PolicyViolation('ACCT_PARTY_BIZNO', '사업자등록번호가 없는 거래처는 조회할 수 없습니다.');
  const r = await checkOne(db, id, p.biz_no, p.name);
  return { ok: true, ...r, note: r.stub ? '간주 결과입니다(국세청 키 없음) — 판단 근거로 쓰지 마십시오.' : `국세청 조회: ${r.statusKo}` };
}

/** 정기 작업 acct_biz_check — 켜져 있으면 30일 지난 거래처 50곳까지 */
export async function acctBizCheckJob(db: DatabaseService) {
  if (!(await enabled(db))) return { on: false, checked: 0, alerts: 0 };
  const rows = await db.query<{ id: string; biz_no: string; name: string }>(
    `SELECT id::text AS id, biz_no, name FROM acct_parties
      WHERE state = 'ACTIVE' AND biz_no IS NOT NULL AND (biz_checked_at IS NULL OR biz_checked_at < now() - interval '30 days')
      ORDER BY biz_checked_at NULLS FIRST, id LIMIT 50`);
  let alerts = 0; const failed: string[] = [];
  for (const r of rows) {
    try { const x = await checkOne(db, r.id, r.biz_no, r.name); if (x.alert) alerts++; }
    catch (e) { failed.push(`${r.id}: ${String((e as Error)?.message ?? e).slice(0, 80)}`); }
  }
  return { on: true, checked: rows.length - failed.length, alerts, failed: failed.slice(0, 10) };
}

/** ⑫ 매입 넣을 때 경고 — 공급자 사업자번호가 휴업 · 폐업(간주 아님) 거래처이면 글 한 줄 */
export async function supplierWarning(db: DatabaseService, bizNo?: string | null) {
  const b = (bizNo ?? '').replace(/\D/g, '');
  if (b.length !== 10) return null;
  const [p] = await db.query<{ name: string; s: string | null; stub: boolean | null; at: string | null }>(
    `SELECT name, biz_status AS s, biz_stub AS stub, biz_checked_at::date::text AS at FROM acct_parties WHERE biz_no = $1`, [b]).catch(() => []);
  if (!p || p.stub || !(p.s === 'CLOSED' || p.s === 'SUSPENDED')) return null;
  return `주의 — 공급자 「${p.name}」 은(는) 국세청 기준 ${BIZ_STATUS_KO[p.s]}입니다(${p.at} 조회) · 세금계산서 공제 여부를 확인하십시오.`;
}
