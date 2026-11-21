import { DatabaseService } from '../../db/database.service';
import { Forbidden } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';

/* ---------------------------------------------------------------------
 * v10.577 ~ 580 (docs/719 ~ 722) 12차 소개몰 · 파트너 — 공통 조각
 *   설정 키 · 기준 값 무늬(DB site_settings.value_pattern 과 같은 정규식 — 규칙 2) · 설정 읽기 · 한국 달 · 판매자 본인 찾기
 * ------------------------------------------------------------------- */

export const SMQ_KEYS = {
  qna: 'smq.qna', qnaDueHours: 'smq.qna_due_hours',
  penalty: 'smq.penalty', exposure: 'smq.penalty_exposure',
  latePct: 'smq.penalty_late_pct', cancelPct: 'smq.penalty_cancel_pct', qnaPct: 'smq.penalty_qna_pct',
  minOrders: 'smq.penalty_min_orders', shipDays: 'smq.penalty_ship_days', limitMonths: 'smq.penalty_limit_months', limitDays: 'smq.penalty_limit_days',
} as const;

/** 기준 값 무늬 — sql/smq.sql 의 site_settings.value_pattern 과 글자까지 같음(규칙 2) · 일반 초안 처음 값 */
export const SMQ_RULE_PATTERNS: Record<string, { re: RegExp; def: number }> = {
  'smq.penalty_late_pct':     { re: /^([1-9]|[1-9][0-9]|100)$/, def: 10 },
  'smq.penalty_cancel_pct':   { re: /^([1-9]|[1-9][0-9]|100)$/, def: 5 },
  'smq.penalty_qna_pct':      { re: /^([1-9]|[1-9][0-9]|100)$/, def: 20 },
  'smq.penalty_min_orders':   { re: /^([1-9]|[1-9][0-9]{1,2}|1000)$/, def: 10 },
  'smq.penalty_ship_days':    { re: /^([1-9]|1[0-4])$/, def: 3 },
  'smq.penalty_limit_months': { re: /^[2-6]$/, def: 2 },
  'smq.penalty_limit_days':   { re: /^([1-9]|[1-8][0-9]|90)$/, def: 30 },
  'smq.qna_due_hours':        { re: /^([1-9]|[1-9][0-9]|1[0-5][0-9]|16[0-8])$/, def: 48 },
};
/** 문의 판정 표본(그달 문의가 이만큼 안 되면 문의 기준은 판정하지 않음) — 고정 값(초안 · 문서 721) */
export const SMQ_MIN_QNA = 5;
/** 판매자 사정 사유 — 회원 사정(CHANGE_MIND · WRONG_ORDER)은 뺌(fn_smq_grade_calc 와 같음) */
export const SMQ_SELLER_REASONS = ['DEFECT', 'WRONG_ITEM', 'MISMATCH', 'DELAY'] as const;

export interface SmqRules { latePct: number; cancelPct: number; qnaPct: number; minOrders: number; shipDays: number; limitMonths: number; limitDays: number; qnaDueHours: number }
export interface SmqSwitches { qna: boolean; penalty: boolean; exposure: boolean }

/** 스위치 하나(on 이면 true) */
export async function smqOn(db: DatabaseService, key: string): Promise<boolean> {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = $1`, [key]);
  return (r?.v ?? '').trim().toLowerCase() === 'on';
}

/** 스위치 셋 · 기준 값 한 번에(빈 값 · 무늬 밖이면 초안 값) */
export async function smqSettings(db: DatabaseService): Promise<{ sw: SmqSwitches; rules: SmqRules }> {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key LIKE 'smq.%'`);
  const raw = (k: string) => (rows.find((r) => r.key === k)?.value ?? '').trim();
  const on = (k: string) => raw(k).toLowerCase() === 'on';
  const num = (k: string) => { const p = SMQ_RULE_PATTERNS[k]!; const v = raw(k); return p.re.test(v) ? Number(v) : p.def; };
  return {
    sw: { qna: on(SMQ_KEYS.qna), penalty: on(SMQ_KEYS.penalty), exposure: on(SMQ_KEYS.exposure) },
    rules: {
      latePct: num(SMQ_KEYS.latePct), cancelPct: num(SMQ_KEYS.cancelPct), qnaPct: num(SMQ_KEYS.qnaPct), minOrders: num(SMQ_KEYS.minOrders),
      shipDays: num(SMQ_KEYS.shipDays), limitMonths: num(SMQ_KEYS.limitMonths), limitDays: num(SMQ_KEYS.limitDays), qnaDueHours: num(SMQ_KEYS.qnaDueHours),
    },
  };
}

/** 한국 날짜 · 달 */
export const smqToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
export const smqYm = (offsetMonths = 0) => {
  const k = new Date(Date.now() + 9 * 3600e3);
  const d = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + offsetMonths, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
/** 달 하나 앞(YYYY-MM) */
export const smqPrevYm = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
export const SMQ_YM_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/** 숫자 칸(bigint 는 글자로 옴) */
export const smqNum = (v: unknown) => Number(v ?? 0);

/** 판매자센터 — 로그인한 사람의 입점 판매자(판매 중 · 정지) · 없으면 403 NOT_SELLER(smx/replies 와 같은 규칙) */
export async function smqMySeller(db: DatabaseService): Promise<{ id: string; code: string; name: string; status: string }> {
  const [s] = await db.query<{ id: string; code: string; name: string; status: string }>(
    `SELECT id, code, name, status FROM hlt_sellers WHERE account_id = $1 AND type IN ('TENANT', 'BRAND') AND status IN ('ACTIVE', 'PAUSED')`, [RequestCtx.actorId()]);
  if (!s) throw new Forbidden('NOT_SELLER', '입점 승인된 판매자만 판매자센터를 쓸 수 있습니다.');
  return s;
}
