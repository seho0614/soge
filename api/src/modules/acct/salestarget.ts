/* e3 (docs/010) 소개뱅크 src/modules/acct/salestarget.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { DatabaseService } from '../../db/database.service';
import { PolicyViolation } from '../../core/errors';
import { deptPnl } from './depts';

/* ---------------------------------------------------------------------
 * v10.455 (D261 · docs/592) 매출 목표 대비 실적
 *   목표: 달(YYYY-MM)마다 회사 전체(TOTAL) · 부서(DEPT · ㉓ acct_depts) · 담당자(OWNER · 운영자) — SUPER 가 정함 · 사유 · 바꾼 기록(acct_target_changes)
 *   실적:
 *     전체 · 부서 = ㉓ 부서 손익(deptPnl — 매출 계정 REVENUE · 전표 꼬리표 > 근거 꼬리표 > 돈 흐름 기본 부서 · 해 마감 전표 뺌)
 *     담당자     = 그 사람이 만든 거래명세서(㉓ acct_sales_docs STATEMENT · 마지막 판) 중 그 달(한국 날짜) 확정한 공급가 합
 *                  (취소한 것 뺌 · 소개몰 · 구독 같은 자동 매출은 사람에게 붙지 않음 — 문서 592 주의)
 *   달성률 = 실적 ÷ 목표 · 지난달 같은 날까지와 비교는 하지 않음(달 전체만).
 * ------------------------------------------------------------------- */

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;   // DB CHECK acct_sales_targets.ym 과 같음
export const TARGET_AXES = ['TOTAL', 'DEPT', 'OWNER'] as const;
export const TARGET_AXIS_KO: Record<string, string> = { TOTAL: '회사 전체', DEPT: '부서', OWNER: '담당자' };
const kstYm = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
const rate = (actual: number, target: number | null) => (target && target > 0 ? Math.round((actual / target) * 1000) / 10 : null);

/** GET /admin/acct/sales-targets?ym= — 목표 · 실적 · 달성률(전체 · 부서 · 담당자) */
export async function targetsView(db: DatabaseService, ymIn?: string) {
  const ym = ymIn && YM.test(ymIn) ? ymIn : kstYm();
  const from = `${ym}-01`, to = lastDay(ym);
  const targets = await db.query<{ axis: string; dept_id: string | null; owner_id: string | null; amount: string; memo: string | null }>(
    `SELECT axis, dept_id::text AS dept_id, owner_id::text AS owner_id, amount::text AS amount, memo FROM acct_sales_targets WHERE ym = $1`, [ym]);
  const tOf = (axis: string, key: string | null) => {
    const t = targets.find((x) => x.axis === axis && (axis === 'DEPT' ? x.dept_id === key : axis === 'OWNER' ? x.owner_id === key : true));
    return t ? { amount: Number(t.amount), memo: t.memo } : null;
  };
  const pnl = await deptPnl(db, from, to, 'dept');
  const depts = await db.query<{ id: string; label: string }>(`SELECT id::text AS id, code || ' ' || name AS label FROM acct_depts WHERE active ORDER BY sort, code`);
  const dRows = depts.map((d) => {
    const actual = pnl.items.find((x) => x.key === d.id)?.revenue ?? 0;
    const t = tOf('DEPT', d.id);
    return { key: d.id, label: d.label, target: t?.amount ?? null, memo: t?.memo ?? null, actual, rate: rate(actual, t?.amount ?? null) };
  });
  const untagged = pnl.items.find((x) => x.key === null)?.revenue ?? 0;
  const owners = await db.query<{ id: string; name: string; actual: string; docs: number }>(
    `SELECT a.id::text AS id, a.name, coalesce(sum(d.supply), 0)::text AS actual, count(d.id)::int AS docs
       FROM svc.accounts a
       LEFT JOIN acct_sales_docs d ON d.created_by = a.id AND d.kind = 'STATEMENT' AND d.state = 'ACCEPTED' AND d.superseded_by IS NULL
                                  AND (d.accepted_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date
      WHERE a.id IN (SELECT owner_id FROM acct_sales_targets WHERE ym = $3 AND axis = 'OWNER')
         OR a.id IN (SELECT created_by FROM acct_sales_docs WHERE kind = 'STATEMENT' AND state = 'ACCEPTED' AND superseded_by IS NULL
                                                             AND (accepted_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date)
      GROUP BY a.id, a.name ORDER BY 3 DESC`, [from, to, ym]);
  const oRows = owners.map((o) => {
    const t = tOf('OWNER', o.id), actual = Number(o.actual);
    return { key: o.id, label: o.name, docs: o.docs, target: t?.amount ?? null, memo: t?.memo ?? null, actual, rate: rate(actual, t?.amount ?? null) };
  });
  const tt = tOf('TOTAL', null);
  const total = { target: tt?.amount ?? null, memo: tt?.memo ?? null, actual: pnl.total.revenue, rate: rate(pnl.total.revenue, tt?.amount ?? null) };
  const staff = await db.query(
    `SELECT DISTINCT a.id::text AS id, a.name FROM svc.account_roles r JOIN svc.accounts a ON a.id = r.account_id
      WHERE r.role IN ('SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF') AND a.status = 'ACTIVE' ORDER BY a.name LIMIT 300`);
  const changes = await db.query(
    `SELECT c.id::text AS id, c.ym, c.axis, c.target_key AS "targetKey", c.before::bigint AS before, c.after::bigint AS after, c.reason, b.name AS "changedBy", c.changed_at AS "changedAt"
       FROM acct_target_changes c LEFT JOIN svc.accounts b ON b.id = c.changed_by WHERE c.ym = $1 ORDER BY c.id DESC LIMIT 30`, [ym]);
  return { ym, from, to, total, depts: dRows, untagged, owners: oRows, staff, changes, axes: TARGET_AXIS_KO,
    note: '전체 · 부서 실적은 「부서 손익」과 같은 셈(매출 계정 · 꼬리표)입니다. 담당자 실적은 그 사람이 만든 거래명세서 중 그 달 확정한 공급가입니다(자동 매출은 사람에게 붙지 않음).' };
}

/** PUT /admin/acct/sales-targets — 목표 넣기 · 고치기(SUPER · 사유) · 0 원이면 목표 없음과 같게 보임 */
export async function setTarget(db: DatabaseService, b: { ym: string; axis: string; deptId?: string | null; ownerId?: string | null; amount: number; memo?: string; reason: string }, actor: string | null) {
  if (!YM.test(String(b.ym ?? ''))) throw new PolicyViolation('TARGET_YM', '달(YYYY-MM)이 바르지 않습니다.');
  if (!(TARGET_AXES as readonly string[]).includes(b.axis)) throw new PolicyViolation('TARGET_AXIS', '전체 · 부서 · 담당자 가운데 고르십시오.');
  const amount = Number(b.amount);
  if (!Number.isInteger(amount) || amount < 0 || amount > 1_000_000_000_000) throw new PolicyViolation('TARGET_AMOUNT', '목표는 0원 이상 정수입니다.');
  const reason = (b.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  const deptId = b.axis === 'DEPT' ? String(b.deptId ?? '') : null;
  const ownerId = b.axis === 'OWNER' ? String(b.ownerId ?? '') : null;
  if (b.axis === 'DEPT' && !/^\d{1,18}$/.test(deptId!)) throw new PolicyViolation('TARGET_DEPT', '부서를 고르십시오.');
  if (b.axis === 'OWNER' && !/^[0-9a-f-]{36}$/i.test(ownerId!)) throw new PolicyViolation('TARGET_OWNER', '담당자를 고르십시오.');
  return db.transaction(async () => {
    if (deptId) { const [d] = await db.query(`SELECT 1 FROM acct_depts WHERE id = $1::bigint`, [deptId]); if (!d) throw new PolicyViolation('TARGET_DEPT', '없는 부서입니다.'); }
    if (ownerId) { const [o] = await db.query(`SELECT 1 FROM svc.accounts WHERE id = $1::uuid`, [ownerId]); if (!o) throw new PolicyViolation('TARGET_OWNER', '없는 사람입니다.'); }
    const [cur] = await db.query<{ id: string; amount: string }>(
      `SELECT id::text AS id, amount::text AS amount FROM acct_sales_targets
        WHERE ym = $1 AND axis = $2 AND dept_id IS NOT DISTINCT FROM $3::bigint AND owner_id IS NOT DISTINCT FROM $4::uuid FOR UPDATE`, [b.ym, b.axis, deptId, ownerId]);
    const memo = (b.memo ?? '').trim().slice(0, 200) || null;
    if (cur) await db.query(`UPDATE acct_sales_targets SET amount = $2::bigint, memo = $3, updated_by = $4::uuid, updated_at = now() WHERE id = $1::bigint`, [cur.id, amount, memo, actor]);
    else await db.query(`INSERT INTO acct_sales_targets (ym, axis, dept_id, owner_id, amount, memo, updated_by) VALUES ($1, $2, $3::bigint, $4::uuid, $5::bigint, $6, $7::uuid)`,
      [b.ym, b.axis, deptId, ownerId, amount, memo, actor]);
    await db.query(`INSERT INTO acct_target_changes (ym, axis, target_key, before, after, reason, changed_by) VALUES ($1, $2, $3, $4::bigint, $5::bigint, $6, $7::uuid)`,
      [b.ym, b.axis, deptId ?? ownerId ?? 'TOTAL', cur ? Number(cur.amount) : null, amount, reason, actor]);
    return { ok: true, ym: b.ym, axis: b.axis, amount, note: cur ? `${b.ym} ${b.axis} 목표를 ${amount.toLocaleString('ko-KR')}원으로 고쳤습니다.` : `${b.ym} ${b.axis} 목표를 ${amount.toLocaleString('ko-KR')}원으로 넣었습니다.` };
  });
}
