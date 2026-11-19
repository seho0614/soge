import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation } from '../../core/errors';
import { Ctx, Evidence, Line, Source, applyRule, ruleOverrides } from './journal';

/* ---------------------------------------------------------------------
 * v10.392 (D245 · docs/529) 자동 전표 규칙 고치기 · 확인표
 *   대표 11/19 「자동전표양식 및 규칙 만들어서 적용」.
 *   규칙 = 돈 흐름(source)마다 전표 줄 모양. 금액 계산(공급가 · 부가세 · 원천세)은 코드 고정이고,
 *   SUPER 는 「계정 자리」(같은 종류 다른 계정으로)와 증빙만 바꿉니다 — 바꾼 다음 전표부터(지난 전표는 그대로).
 *   확인표 = 모든 규칙을 예시 금액(11,000원) 전표와 계정 코드로 한 장 — 세무사에게 그대로 보내 확인받는 용도.
 * ------------------------------------------------------------------- */

export const EVIDENCES: Evidence[] = ['TAX_INVOICE', 'CARD_PG', 'CASH', 'NONE', 'CARD', 'SIMPLE'];
export const EV_LABEL: Record<string, string> = { TAX_INVOICE: '세금계산서', CARD_PG: '카드 · PG', CASH: '현금영수증', NONE: '없음', CARD: '법인카드', SIMPLE: '간이영수증' };

const SAMPLE: Record<string, unknown> = { key: 'x', at: '', party: null, amt: 11000, supply: 10000, vat: 1000, total: 11000, paid: 11000, exempt: 0, gross: 11000, wht: 363, net: 10637,
  kind: 'USE', no: '', method: 'TRANSFER', period: '', deductible: true, qty: 1, unit_cost: 10000, amount: 11000, pay_role: 'AP', account_role: 'EXP_SUPPLIES', fee: 330, fee_vat: 30 };   // v10.404 PG 수수료 자리
/** 돈 흐름마다 예시 값 바로잡기 — PG 정산은 입금액 = 결제 금액 − 수수료(부가세 포함)라 공통 예시의 net(원천세 예시 10,637)과 다름 */
const SAMPLE_FIX: Record<string, Record<string, unknown>> = { PG_SETTLE: { net: 11000 - 330 } };
const sampleOf = (name: string) => ({ ...SAMPLE, ...(SAMPLE_FIX[name] ?? {}) });
/** 계정 자리 찾기용 — 면세 몫 · 부가세 없는 경우까지 돌려 보고 나온 역할을 모두 모음 */
const VARIANTS: Array<Record<string, unknown>> = [SAMPLE, { ...SAMPLE, exempt: 3000 }, { ...SAMPLE, vat: null }, { ...SAMPLE, vat: 0, deductible: false }];

export interface Acc { role: string; name: string; kind: string; extCode: string | null; extName: string | null; note: string | null; draft: boolean; custom: boolean }

const safeBuild = (s: Source, r: Record<string, unknown>, c: Ctx) => { try { return s.build(r as never, c); } catch { return null; } };

export function slotsOf(s: Source, c: Ctx): string[] {
  const set = new Set<string>();
  for (const v of VARIANTS) for (const l of safeBuild(s, { ...v, ...(SAMPLE_FIX[s.name] ?? {}) }, c)?.lines ?? []) set.add(l.role);
  return [...set];
}

async function ctxOf(db: DatabaseService): Promise<Ctx> {
  const st = await db.query<{ key: string; value: string }>(`SELECT key, value FROM site_settings WHERE key IN ('acct.sub_vat_included', 'acct.commission_vat_included')`);
  return { subVat: st.find((x) => x.key === 'acct.sub_vat_included')?.value !== 'off', commissionVat: st.find((x) => x.key === 'acct.commission_vat_included')?.value !== 'off' };
}

async function accounts(db: DatabaseService): Promise<Acc[]> {
  return db.query<Acc>(
    `SELECT role, name, kind, ext_code AS "extCode", ext_name AS "extName", note, coalesce(draft, true) AS draft, coalesce(custom, false) AS custom FROM acct_accounts ORDER BY sort, role`);
}

/** 규칙 목록 — 기본 줄 · 지금 쓰는 줄(바꾼 것 반영) · 계정 자리 · 증빙 */
export async function rulesView(db: DatabaseService, sources: Source[]) {
  const c = await ctxOf(db), ov = await ruleOverrides(db), accs = await accounts(db);
  const acc = new Map(accs.map((a) => [a.role, a]));
  const show = (l: Line) => ({ ...l, name: acc.get(l.role)?.name ?? l.role, code: acc.get(l.role)?.extCode ?? null, draft: acc.get(l.role)?.draft ?? true });
  const rules = sources.map((s) => {
    const base = safeBuild(s, sampleOf(s.name), c);
    const now = base ? applyRule(s.name, base, ov) : null;
    const slots = slotsOf(s, c).map((role) => {
      const to = ov.maps.get(`${s.name}:${role}`) ?? role;
      return { role, kind: acc.get(role)?.kind ?? '', to, toName: acc.get(to)?.name ?? to, changed: to !== role };
    });
    return { source: s.name, label: s.label, evidence: now?.evidence ?? 'NONE', baseEvidence: base?.evidence ?? 'NONE',
             lines: (now?.lines ?? []).map(show), slots, changed: slots.some((x) => x.changed) || (now?.evidence ?? '') !== (base?.evidence ?? '') };
  });
  const changes = await db.query(
    `SELECT c.id::text AS id, c.source, c.slot, c.before, c.after, c.reason, c.created_at AS "createdAt", a.email AS actor
       FROM acct_rule_changes c LEFT JOIN accounts a ON a.id = c.actor_id ORDER BY c.id DESC LIMIT 30`);
  return { rules, accounts: accs, changes, evidences: EVIDENCES.map((e) => ({ code: e, label: EV_LABEL[e] })) };
}

const reasonOk = (r: string | undefined) => {
  const t = (r ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation('ACCT_REASON', '사유는 2 ~ 200자입니다.');
  return t;
};

/** 규칙 바꾸기 — 계정 자리(maps) · 증빙(evidence). to = 원래 역할이면 바꾼 것 지움 */
export async function setRule(db: DatabaseService, sources: Source[], source: string, b: { maps?: Array<{ from: string; to: string }>; evidence?: string; reason?: string }, actor: string | null) {
  const src = sources.find((s) => s.name === source);
  if (!src) throw new NotFound('없는 돈 흐름입니다.');
  const reason = reasonOk(b.reason);
  const c = await ctxOf(db);
  const slots = new Set(slotsOf(src, c));
  const maps = Array.isArray(b.maps) ? b.maps : [];
  if (!maps.length && !b.evidence) throw new PolicyViolation('ACCT_RULE', '바꿀 계정 자리나 증빙이 없습니다.');
  for (const m of maps) if (!slots.has(m.from)) throw new PolicyViolation('ACCT_RULE', `이 돈 흐름에 없는 계정 자리입니다: ${m.from}`);
  if (b.evidence && !(EVIDENCES as string[]).includes(b.evidence)) throw new PolicyViolation('ACCT_RULE', '모르는 증빙입니다.');
  let n = 0;
  await db.transaction(async () => {
    for (const m of maps) {
      const [before] = await db.query<{ to_role: string }>(`SELECT to_role FROM acct_rule_maps WHERE source = $1 AND from_role = $2`, [source, m.from]);
      const prev = before?.to_role ?? m.from;
      if (prev === m.to) continue;
      const [ex] = await db.query(`SELECT 1 FROM acct_accounts WHERE role = $1`, [m.to]);
      if (!ex) throw new PolicyViolation('ACCT_RULE', `없는 계정입니다: ${m.to}`);
      if (m.to === m.from) await db.query(`DELETE FROM acct_rule_maps WHERE source = $1 AND from_role = $2`, [source, m.from]);
      else await db.query(
        `INSERT INTO acct_rule_maps (source, from_role, to_role, updated_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (source, from_role) DO UPDATE SET to_role = EXCLUDED.to_role, updated_by = EXCLUDED.updated_by, updated_at = now()`, [source, m.from, m.to, actor]);
      await db.query(`INSERT INTO acct_rule_changes (source, slot, before, after, reason, actor_id) VALUES ($1, $2, $3, $4, $5, $6)`, [source, m.from, prev, m.to, reason, actor]);
      n++;
    }
    if (b.evidence) {
      const base = safeBuild(src, sampleOf(src.name), c)?.evidence ?? 'NONE';
      const [cur] = await db.query<{ evidence: string }>(`SELECT evidence FROM acct_rule_evidence WHERE source = $1`, [source]);
      const prev = cur?.evidence ?? base;
      if (prev !== b.evidence) {
        if (b.evidence === base) await db.query(`DELETE FROM acct_rule_evidence WHERE source = $1`, [source]);
        else await db.query(
          `INSERT INTO acct_rule_evidence (source, evidence, updated_by) VALUES ($1, $2, $3)
           ON CONFLICT (source) DO UPDATE SET evidence = EXCLUDED.evidence, updated_by = EXCLUDED.updated_by, updated_at = now()`, [source, b.evidence, actor]);
        await db.query(`INSERT INTO acct_rule_changes (source, slot, before, after, reason, actor_id) VALUES ($1, '@evidence', $2, $3, $4, $5)`, [source, prev, b.evidence, reason, actor]);
        n++;
      }
    }
  });
  return { ok: true, source, changed: n, note: n ? '규칙을 바꿨습니다 — 다음 전표부터 씁니다(지난 전표는 그대로).' : '바뀐 것이 없습니다.' };
}

/** 계정 더하기(SUPER) — 역할 U_ 로 시작 · 종류 4가지 · 코드 · 이름 */
export async function addAccount(db: DatabaseService, b: { role: string; name: string; kind: string; extCode?: string; extName?: string; reason?: string }) {
  reasonOk(b.reason);
  const role = (b.role ?? '').trim().toUpperCase();
  if (!/^U_[A-Z][A-Z_]{1,30}$/.test(role)) throw new PolicyViolation('ACCT_ACCOUNT', '더하는 계정 역할은 U_ 로 시작하는 대문자입니다.');
  const [dup] = await db.query(`SELECT 1 FROM acct_accounts WHERE role = $1`, [role]);
  if (dup) throw new PolicyViolation('ACCT_ACCOUNT_DUP', '이미 있는 계정 역할입니다.');
  const [mx] = await db.query<{ s: number }>(`SELECT coalesce(max(sort), 0)::int + 1 AS s FROM acct_accounts`);
  await db.query(
    `INSERT INTO acct_accounts (role, name, kind, ext_code, ext_name, sort, note, custom, draft) VALUES ($1, $2, $3, nullif($4, ''), nullif($5, ''), $6, 'SUPER 가 더함', true, false)`,
    [role, b.name.trim(), b.kind, (b.extCode ?? '').trim(), (b.extName ?? '').trim(), Number(mx?.s ?? 999)]);
  return { ok: true, role, note: '계정을 더했습니다 — 규칙에서 같은 종류 계정 자리에 고를 수 있습니다.' };
}

/** 확인표 — 규칙마다 줄 · 계정 코드 · 예시 금액(11,000원) · 초안 여부 */
export async function ruleSheet(db: DatabaseService, sources: Source[]) {
  const v = await rulesView(db, sources);
  const head = ['돈 흐름', '근거 코드', '증빙', '줄', '차변/대변', '계정 역할', '계정 이름', '회계 코드', '계정과목', '예시 금액', '코드 초안', '바꾼 규칙'];
  const acc = new Map(v.accounts.map((a) => [a.role, a]));
  const rows: unknown[][] = [];
  for (const r of v.rules) r.lines.forEach((l, i) => {
    const a = acc.get(l.role);
    rows.push([r.label, r.source, EV_LABEL[r.evidence] ?? r.evidence, i + 1, l.debit > 0 ? '차변' : '대변', l.role, a?.name ?? l.role, a?.extCode ?? '', a?.extName ?? '',
      l.debit > 0 ? l.debit : l.credit, a?.draft === false ? '' : '초안', r.changed ? '바꿈' : '']);
  });
  return { head, rows, count: v.rules.length,
    note: '예시 금액은 결제 11,000원(공급가 10,000 · 부가세 1,000) 기준입니다. 「초안」 줄의 계정 코드와 규칙은 세무사 확인이 필요합니다. 금액 계산(공급가 · 부가세 · 원천세)은 고정이고 계정 자리 · 증빙만 바꿀 수 있습니다.' };
}
