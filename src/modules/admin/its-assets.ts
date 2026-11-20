import { DatabaseService } from '../../db/database.service';
import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';
import { alertDays, dayOk, stageOf, switchOn } from './its-keys';

/* ---------------------------------------------------------------------
 * v10.491 (D270 · docs/629) IT 자산 · SaaS 구독 — 대표 11/20 「㊵ 사무 · 보안」
 *   프로그램 · 라이선스 수 · 쓰는 수 · 담당 · 결제 주기 · 한 번 금액(원 · 부가세 포함) · 다음 갱신일 · 자동 갱신
 *   달 비용 → 자금 계획: cash_plan 이면 ⑬ 자금 흐름 예정(acct_cash_plans · OUT)을 하나 이어 둠
 *     MONTHLY = 매달 예정(갱신일의 날짜) · YEARLY = 갱신일에 한 번 · ONCE = 갱신일(지급일)이 오늘 뒤면 한 번 · FREE · 0원 · 해지 = 예정 없음
 *     금액 · 주기 · 날이 바뀌면 옛 예정은 취소(사유 「IT 자산 바뀜」)하고 새로 넣음 — acct_cash_plans 는 고치지 않는 표(D245)라서
 *   정기 작업 its_office_daily(매일 08:55): 자동 갱신 자산의 지난 갱신일을 다음 주기로 옮김 · 갱신일 N일 전 ITS_ASSET_RENEW
 *   지우지 않음 — 해지(사유)만
 * ------------------------------------------------------------------- */

export const ASSET_KINDS = ['SAAS', 'LICENSE', 'CLOUD', 'DOMAIN', 'DEVICE', 'OTHER'] as const;
export const ASSET_KIND_KO: Record<string, string> = { SAAS: '구독(SaaS)', LICENSE: '라이선스', CLOUD: '클라우드', DOMAIN: '도메인', DEVICE: '기기', OTHER: '그 밖' };
export const ASSET_CYCLES = ['MONTHLY', 'YEARLY', 'ONCE', 'FREE'] as const;
export const ASSET_CYCLE_KO: Record<string, string> = { MONTHLY: '매달', YEARLY: '매년', ONCE: '한 번', FREE: '무료' };
export const ASSET_TAG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;   // DB CHECK its_assets.asset_tag 와 같음
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const STAFF_ROLES = ['SUPER', 'ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'];
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400e3);
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** 날짜 d 에서 k 달 뒤(그달에 없는 날이면 말일) */
function addMonths(d: string, k: number, dayOfMonth?: number) {
  const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
  const t = y * 12 + (m - 1) + k, yy = Math.floor(t / 12), mm = (t % 12) + 1;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(dayOfMonth ?? dd, lastDay(yy, mm))).padStart(2, '0')}`;
}
/** 주기대로 다음 날(오늘이나 그 뒤) */
function nextOnOrAfter(d: string, cycle: string, today: string) {
  const dom = Number(d.slice(8, 10));
  let x = d;
  for (let i = 0; i < 600 && x < today; i++) x = addMonths(x, cycle === 'YEARLY' ? 12 : 1, dom);
  return x;
}
const monthlyOf = (cycle: string, amount: number) => (cycle === 'MONTHLY' ? amount : cycle === 'YEARLY' ? Math.round(amount / 12) : 0);

export interface AssetRow {
  id: string; kind: string; name: string; vendor: string | null; asset_tag: string | null; seats: number; seats_used: number; owner_id: string | null; owner: string | null;
  billing_cycle: string; cost_amount: string; renew_on: string | null; auto_renew: boolean; cash_plan: boolean; cash_plan_id: string | null; cash_plan_sig: string | null;
  plan_state: string | null; memo: string | null; state: string; canceled_on: string | null; cancel_reason: string | null; created_at: string; updated_at: string;
}
const SELECT = `SELECT a.id::text AS id, a.kind, a.name, a.vendor, a.asset_tag, a.seats, a.seats_used, a.owner_id::text AS owner_id, coalesce(o.name, o.email) AS owner,
                       a.billing_cycle, a.cost_amount::text AS cost_amount, a.renew_on::text AS renew_on, a.auto_renew, a.cash_plan, a.cash_plan_id::text AS cash_plan_id, a.cash_plan_sig,
                       p.state AS plan_state, a.memo, a.state, a.canceled_on::text AS canceled_on, a.cancel_reason, a.created_at, a.updated_at
                  FROM its_assets a LEFT JOIN accounts o ON o.id = a.owner_id LEFT JOIN acct_cash_plans p ON p.id = a.cash_plan_id`;

function shape(r: AssetRow, today: string) {
  const amount = Number(r.cost_amount);
  const left = r.renew_on && r.state === 'ACTIVE' ? diffDays(r.renew_on, today) : null;
  return {
    id: r.id, kind: r.kind, kindKo: ASSET_KIND_KO[r.kind] ?? r.kind, name: r.name, vendor: r.vendor, assetTag: r.asset_tag,
    seats: r.seats, seatsUsed: r.seats_used, seatsFree: Math.max(0, r.seats - r.seats_used), ownerId: r.owner_id, owner: r.owner,
    billingCycle: r.billing_cycle, cycleKo: ASSET_CYCLE_KO[r.billing_cycle] ?? r.billing_cycle, costAmount: amount, monthly: r.state === 'ACTIVE' ? monthlyOf(r.billing_cycle, amount) : 0,
    renewOn: r.renew_on, renewLeft: left, autoRenew: r.auto_renew, cashPlan: r.cash_plan, cashPlanId: r.plan_state === 'ACTIVE' ? r.cash_plan_id : null,
    memo: r.memo, state: r.state, canceledOn: r.canceled_on, cancelReason: r.cancel_reason, updatedAt: r.updated_at,
  };
}

/** GET /admin/its/assets — 목록 · 달 비용 합 · 갱신 30일 안 · 담당 고를 사람 */
export async function listAssets(db: DatabaseService, stateIn?: string) {
  const state = stateIn === 'CANCELED' ? 'CANCELED' : stateIn === 'ALL' ? 'ALL' : 'ACTIVE';
  const today = kstToday();
  const rows = await db.query<AssetRow>(SELECT + ` WHERE ($1 = 'ALL' OR a.state = $1) ORDER BY (a.state = 'ACTIVE') DESC, a.renew_on NULLS LAST, a.id DESC LIMIT 500`, [state]);
  const items = rows.map((r) => shape(r, today));
  const active = items.filter((x) => x.state === 'ACTIVE');
  const byKind = Object.fromEntries(ASSET_KINDS.map((k) => [k, active.filter((x) => x.kind === k).reduce((a, x) => a + x.monthly, 0)]));
  const staff = await db.query<{ id: string; name: string }>(
    `SELECT DISTINCT a.id::text AS id, coalesce(a.name, a.email) AS name FROM accounts a JOIN account_roles r ON r.account_id = a.id
      WHERE r.role = ANY($1::text[]) AND a.status = 'ACTIVE' ORDER BY 2 LIMIT 300`, [STAFF_ROLES]);
  return {
    state, today, items, kinds: ASSET_KIND_KO, cycles: ASSET_CYCLE_KO, staff,
    totals: { monthly: active.reduce((a, x) => a + x.monthly, 0), yearly: active.reduce((a, x) => a + x.monthly, 0) * 12 + active.filter((x) => x.billingCycle === 'ONCE' && x.renewOn && x.renewOn >= today).reduce((a, x) => a + x.costAmount, 0),
              byKind, seats: active.reduce((a, x) => a + x.seats, 0), seatsFree: active.reduce((a, x) => a + x.seatsFree, 0) },
    soon: active.filter((x) => x.renewLeft != null && x.renewLeft <= 30).length,
    note: '달 비용(매년 결제는 12로 나눔)을 「자금 계획에 넣기」로 회계 › 자금 흐름 예정에 이어 둡니다 — 금액 · 주기 · 갱신일을 바꾸면 옛 예정은 취소되고 새로 들어갑니다. 갱신일 30 · 7일 전에 운영 알림이 갑니다.',
  };
}

export interface AssetInput {
  kind?: string; name?: string; vendor?: string | null; assetTag?: string | null; seats?: number; seatsUsed?: number; ownerId?: string | null;
  billingCycle?: string; costAmount?: number; renewOn?: string | null; autoRenew?: boolean; cashPlan?: boolean; memo?: string | null;
}
export interface AssetVals { kind: string; name: string; vendor: string | null; asset_tag: string | null; seats: number; seats_used: number; owner_id: string | null;
  billing_cycle: string; cost_amount: number; renew_on: string | null; auto_renew: boolean; cash_plan: boolean; memo: string | null }

async function check(db: DatabaseService, v: AssetVals) {
  if (!(ASSET_KINDS as readonly string[]).includes(v.kind)) throw new PolicyViolation('ITS_ASSET_KIND', '종류를 고르십시오.');
  if (v.name.length < 2 || v.name.length > 80) throw new PolicyViolation('ITS_ASSET_NAME', '이름은 2 ~ 80자입니다.');
  if (v.vendor && v.vendor.length > 80) throw new PolicyViolation('ITS_ASSET_NAME', '공급사는 80자까지입니다.');
  if (v.asset_tag && !ASSET_TAG_RE.test(v.asset_tag)) throw new PolicyViolation('ITS_ASSET_TAG', '자산 번호는 영문 · 숫자 · - · _ 40자까지입니다.');
  for (const [n, x] of [['라이선스 수', v.seats], ['쓰는 수', v.seats_used]] as const) {
    if (!Number.isInteger(x) || x < 0 || x > 100000) throw new PolicyViolation('ITS_ASSET_SEATS', `${n}는 0 ~ 100,000입니다.`);
  }
  if (!(ASSET_CYCLES as readonly string[]).includes(v.billing_cycle)) throw new PolicyViolation('ITS_ASSET_CYCLE', '결제 주기를 고르십시오.');
  if (!Number.isInteger(v.cost_amount) || v.cost_amount < 0 || v.cost_amount > 1_000_000_000) throw new PolicyViolation('ITS_ASSET_COST', '금액은 0 ~ 10억 원 정수입니다.');
  if (v.billing_cycle === 'FREE' && v.cost_amount !== 0) throw new PolicyViolation('ITS_ASSET_COST', '무료는 금액이 0원입니다.');
  if (v.renew_on && !dayOk(v.renew_on)) throw new PolicyViolation('ITS_ASSET_DATE', '갱신일(YYYY-MM-DD)이 맞지 않습니다.');
  if ((v.billing_cycle === 'MONTHLY' || v.billing_cycle === 'YEARLY') && !v.renew_on) throw new PolicyViolation('ITS_ASSET_DATE', '매달 · 매년 결제는 다음 갱신(결제)일이 있어야 합니다.');
  if (v.memo && v.memo.length > 400) throw new PolicyViolation('ITS_ASSET_MEMO', '메모는 400자까지입니다.');
  if (v.owner_id) {
    if (!UUID.test(v.owner_id)) throw new PolicyViolation('ITS_ASSET_OWNER', '담당자를 고르십시오.');
    const [a] = await db.query(`SELECT 1 FROM accounts a WHERE a.id = $1::uuid AND EXISTS (SELECT 1 FROM account_roles r WHERE r.account_id = a.id AND r.role = ANY($2::text[]))`, [v.owner_id, STAFF_ROLES]);
    if (!a) throw new PolicyViolation('ITS_ASSET_OWNER', '담당자는 운영 계정이어야 합니다.');
  }
}

/** 이 자산이 지금 가져야 할 자금 흐름 예정(없으면 null) */
function wantPlan(v: { state: string; cash_plan: boolean; cost_amount: number; billing_cycle: string; renew_on: string | null; name: string }, today: string) {
  if (v.state !== 'ACTIVE' || !v.cash_plan || v.cost_amount <= 0 || !v.renew_on) return null;
  const memo = `IT 구독 · ${v.name}`.slice(0, 100);
  if (v.billing_cycle === 'MONTHLY') return { sig: `M|${v.cost_amount}|${v.renew_on.slice(8, 10)}`, due: nextOnOrAfter(v.renew_on, 'MONTHLY', today), repeat: 'MONTHLY', amount: v.cost_amount, memo };
  if (v.billing_cycle === 'YEARLY') return { sig: `Y|${v.cost_amount}|${v.renew_on}`, due: v.renew_on < today ? nextOnOrAfter(v.renew_on, 'YEARLY', today) : v.renew_on, repeat: 'NONE', amount: v.cost_amount, memo };
  if (v.billing_cycle === 'ONCE' && v.renew_on >= today) return { sig: `O|${v.cost_amount}|${v.renew_on}`, due: v.renew_on, repeat: 'NONE', amount: v.cost_amount, memo };
  return null;
}

/** 자금 흐름 예정 맞추기 — 같은 모양이면 그대로 · 다르면 옛 예정 취소 + 새로 넣기(트랜잭션 안에서 부름) */
export async function syncCashPlan(db: DatabaseService, id: string, actor: string | null) {
  const [r] = await db.query<AssetRow>(SELECT + ` WHERE a.id = $1::bigint`, [id]);
  if (!r) return { changed: false };
  const today = kstToday();
  const want = wantPlan({ ...r, cost_amount: Number(r.cost_amount) }, today);
  const live = r.cash_plan_id && r.plan_state === 'ACTIVE';
  if (want && live && r.cash_plan_sig === want.sig) return { changed: false };
  if (!want && !live) {
    if (r.cash_plan_id || r.cash_plan_sig) await db.query(`UPDATE its_assets SET cash_plan_id = NULL, cash_plan_sig = NULL WHERE id = $1::bigint`, [id]);
    return { changed: false };
  }
  if (live) {
    await db.query(`UPDATE acct_cash_plans SET state = 'CANCELED', cancel_note = $2, canceled_at = now(), canceled_by = $3::uuid WHERE id = $1::bigint AND state = 'ACTIVE'`,
      [r.cash_plan_id, want ? 'IT 자산 바뀜 — 새 예정으로' : 'IT 자산 해지 · 자금 계획 뺌', actor]);
  }
  let planId: string | null = null;
  if (want) {
    const [p] = await db.query<{ id: string }>(
      `INSERT INTO acct_cash_plans (due_on, direction, amount, memo, repeat, created_by) VALUES ($1::date, 'OUT', $2, $3, $4, $5::uuid) RETURNING id::text AS id`,
      [want.due, want.amount, want.memo, want.repeat, actor]);
    planId = p!.id;
  }
  await db.query(`UPDATE its_assets SET cash_plan_id = $2::bigint, cash_plan_sig = $3 WHERE id = $1::bigint`, [id, planId, want?.sig ?? null]);
  return { changed: true, planId };
}

function valsOf(b: AssetInput, base?: AssetVals): AssetVals {
  /* 안 보낸 칸(undefined)은 옛 값 그대로 — `{ ...옛값, ...dto }` 를 쓰지 않음(규칙 11) */
  const pick = <T>(x: T | undefined, d: T) => (x === undefined ? d : x);
  const s = (x: string | null | undefined, d: string | null) => (x === undefined ? d : (x == null ? null : clean(x) || null));
  return {
    kind: base ? base.kind : String(b.kind ?? ''),
    name: b.name === undefined && base ? base.name : clean(b.name),
    vendor: s(b.vendor, base?.vendor ?? null), asset_tag: s(b.assetTag, base?.asset_tag ?? null),
    seats: Number(pick(b.seats, base?.seats ?? 0)), seats_used: Number(pick(b.seatsUsed, base?.seats_used ?? 0)),
    owner_id: s(b.ownerId, base?.owner_id ?? null),
    billing_cycle: String(pick(b.billingCycle, base?.billing_cycle ?? 'MONTHLY')), cost_amount: Number(pick(b.costAmount, base?.cost_amount ?? 0)),
    renew_on: s(b.renewOn, base?.renew_on ?? null), auto_renew: Boolean(pick(b.autoRenew, base?.auto_renew ?? true)),
    cash_plan: Boolean(pick(b.cashPlan, base?.cash_plan ?? true)), memo: s(b.memo, base?.memo ?? null),
  };
}

/** POST /admin/its/assets */
export async function createAsset(db: DatabaseService, b: AssetInput, actor: string | null) {
  const v = valsOf(b);
  await check(db, v);
  return db.transaction(async () => {
    const [r] = await db.query<{ id: string }>(
      `INSERT INTO its_assets (kind, name, vendor, asset_tag, seats, seats_used, owner_id, billing_cycle, cost_amount, renew_on, auto_renew, cash_plan, memo, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5::int, $6::int, $7::uuid, $8, $9::bigint, $10::date, $11, $12, $13, $14::uuid, $14::uuid) RETURNING id::text AS id`,
      [v.kind, v.name, v.vendor, v.asset_tag, v.seats, v.seats_used, v.owner_id, v.billing_cycle, v.cost_amount, v.renew_on, v.auto_renew, v.cash_plan, v.memo, actor]);
    const p = await syncCashPlan(db, r!.id, actor);
    return { ok: true, id: r!.id, cashPlanId: p.planId ?? null,
             note: p.planId ? '넣었습니다 — 자금 흐름 예정에도 들어갔습니다.' : '넣었습니다.' };
  });
}

async function loadVals(db: DatabaseService, id: string) {
  if (!/^\d{1,18}$/.test(String(id ?? ''))) throw new NotFound('IT 자산이 없습니다.');
  const [r] = await db.query<AssetRow>(SELECT + ` WHERE a.id = $1::bigint FOR UPDATE OF a`, [id]);
  if (!r) throw new NotFound('IT 자산이 없습니다.');
  return r;
}

/** PUT /admin/its/assets/{id} — 보낸 칸만 · 해지한 것은 409 */
export async function updateAsset(db: DatabaseService, id: string, b: AssetInput, actor: string | null) {
  return db.transaction(async () => {
    const r = await loadVals(db, id);
    if (r.state !== 'ACTIVE') throw new StateConflict('ITS_ASSET_STATE', '해지한 자산은 고치지 않습니다(새로 넣으십시오).');
    if (b.kind !== undefined && b.kind !== r.kind) throw new PolicyViolation('ITS_ASSET_KIND', '종류는 바꾸지 않습니다(새로 넣으십시오).');
    const v = valsOf(b, { ...r, cost_amount: Number(r.cost_amount) });
    await check(db, v);
    await db.query(
      `UPDATE its_assets SET name = $2, vendor = $3, asset_tag = $4, seats = $5::int, seats_used = $6::int, owner_id = $7::uuid, billing_cycle = $8, cost_amount = $9::bigint,
              renew_on = $10::date, auto_renew = $11, cash_plan = $12, memo = $13, updated_by = $14::uuid WHERE id = $1::bigint`,
      [id, v.name, v.vendor, v.asset_tag, v.seats, v.seats_used, v.owner_id, v.billing_cycle, v.cost_amount, v.renew_on, v.auto_renew, v.cash_plan, v.memo, actor]);
    const p = await syncCashPlan(db, id, actor);
    return { ok: true, id, cashPlanChanged: p.changed, note: p.changed ? '고쳤습니다 — 자금 흐름 예정도 새로 맞췄습니다.' : '고쳤습니다.' };
  });
}

/** POST /admin/its/assets/{id}/cancel — 해지(사유) · 이은 예정도 취소 */
export async function cancelAsset(db: DatabaseService, id: string, reasonIn: string, actor: string | null) {
  const reason = clean(reasonIn);
  if (reason.length < 2 || reason.length > 200) throw new PolicyViolation('ITS_ASSET_REASON', '해지 사유는 2 ~ 200자입니다.');
  return db.transaction(async () => {
    const r = await loadVals(db, id);
    if (r.state !== 'ACTIVE') throw new StateConflict('ITS_ASSET_STATE', '이미 해지한 자산입니다.');
    await db.query(`UPDATE its_assets SET state = 'CANCELED', canceled_on = (now() AT TIME ZONE 'Asia/Seoul')::date, cancel_reason = $2, updated_by = $3::uuid WHERE id = $1::bigint`, [id, reason, actor]);
    await syncCashPlan(db, id, actor);
    return { ok: true, id, note: '해지했습니다 — 자금 흐름 예정도 취소했습니다.' };
  });
}

/** 정기 작업(its_office_daily) 한 몫 — 자동 갱신 날 옮김 · 예정 맞춤 · 갱신 N일 전 ITS_ASSET_RENEW(자산 · 갱신일 · 단계마다 한 번) */
export async function itsAssetRenewJob(db: DatabaseService) {
  const today = kstToday();
  const due = await db.query<{ id: string; renew_on: string; billing_cycle: string }>(
    `SELECT id::text AS id, renew_on::text AS renew_on, billing_cycle FROM its_assets
      WHERE state = 'ACTIVE' AND auto_renew AND billing_cycle IN ('MONTHLY', 'YEARLY') AND renew_on < $1::date`, [today]);
  let advanced = 0;
  for (const a of due) {
    const nx = nextOnOrAfter(a.renew_on, a.billing_cycle, today);
    await db.transaction(async () => {
      await db.query(`UPDATE its_assets SET renew_on = $2::date WHERE id = $1::bigint AND state = 'ACTIVE'`, [a.id, nx]);
      await syncCashPlan(db, a.id, null);
    });
    advanced++;
  }
  const on = await switchOn(db, 'its.asset_alert');
  const days = await alertDays(db, 'its.asset_alert_days');
  const rows = on ? await db.query<{ id: string; name: string; renew_on: string; auto_renew: boolean; cost_amount: string; billing_cycle: string }>(
    `SELECT id::text AS id, name, renew_on::text AS renew_on, auto_renew, cost_amount::text AS cost_amount, billing_cycle FROM its_assets
      WHERE state = 'ACTIVE' AND renew_on IS NOT NULL AND billing_cycle <> 'FREE'`) : [];
  const want: Array<{ key: string; sev: string; title: string; detail: Record<string, unknown> }> = [];
  for (const r of rows) {
    const left = diffDays(r.renew_on, today);
    const st = stageOf(left, days);
    if (!st) continue;
    const key = `${r.id}|${r.renew_on}|${st}`;
    const how = r.auto_renew ? '자동 갱신 — 쓰지 않으면 그 전에 해지' : '직접 갱신';
    want.push({
      key, sev: st === 'OVER' ? 'CRITICAL' : 'WARN',
      title: st === 'OVER' ? `IT 자산 「${r.name}」 갱신일 지남(${r.renew_on}) — 사무 › IT 자산 · 구독에서 갱신일을 고치거나 해지하십시오`
                           : `IT 자산 「${r.name}」 갱신 ${r.renew_on}(${left}일 남음 · ${how}) — 사무 › IT 자산 · 구독`,
      detail: { key, assetId: r.id, renewOn: r.renew_on, stage: st, left, amount: Number(r.cost_amount), cycle: r.billing_cycle },
    });
  }
  const resolved = await db.query(
    `UPDATE ops_alerts SET resolved_at = now(), resolve_note = '갱신일 바뀜 · 해지 · 알림 꺼짐'
      WHERE alert_code = 'ITS_ASSET_RENEW' AND resolved_at IS NULL AND NOT (coalesce(detail->>'key', '') = ANY($1::text[])) RETURNING id`, [want.map((w) => w.key)]);
  let made = 0;
  for (const w of want) {
    const r = await db.query(
      `INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at)
       SELECT 'ITS_ASSET_RENEW', $1, $2, $3::jsonb, clock_timestamp()
        WHERE NOT EXISTS (SELECT 1 FROM ops_alerts WHERE alert_code = 'ITS_ASSET_RENEW' AND detail->>'key' = $4)
       ON CONFLICT DO NOTHING RETURNING id`, [w.sev, w.title, JSON.stringify(w.detail), w.key]);
    made += r.length;
  }
  return { advanced, on, made, resolved: resolved.length };
}
