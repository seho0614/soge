import { dtKst, ymdKst } from '@/lib/format';
/* 파트너센터 화면 공용 표기. 금액은 bigint 라 문자열로 올 수 있어 Number 로 한 번 거릅니다. */

export const krw = (n: number | string | null | undefined) =>
  n == null || n === '' ? '—' : Number(n).toLocaleString('ko-KR') + '원';

export const ymd = (iso: string | null | undefined) =>
  iso ? ymdKst(iso) : '—';

export const ymdhm = (iso: string | null | undefined) =>
  iso ? dtKst(iso) : '—';

/* 상태 → 표시 등급. 서버 코드를 그대로 보이지 않습니다.
 * v10.100 (다국어 2-5a) — 글자는 사전 affiliate.<묶음>.<코드>(orderState · settleState · inqState · track · materialKind).
 *   codeText(t, 'orderState', code) — 사전에 없는 코드는 코드 그대로. t 는 useTranslations('affiliate') / getTranslations('affiliate'). */
export const ORDER_STATE: Record<string, { c: string }> = {
  PENDING:   { c: 'state-in_review' },
  CONFIRMED: { c: 'state-published' },
  SETTLED:   { c: 'state-published' },
  CANCELED:  { c: 'state-rejected' },
};

export const SETTLE_STATE: Record<string, { c: string }> = {
  DRAFT:     { c: 'state-in_review' },
  CONFIRMED: { c: 'state-in_review' },
  PAID:      { c: 'state-published' },
  CARRIED:   { c: 'state-suspended' },
};

export const INQ_STATE: Record<string, { c: string }> = {
  OPEN:     { c: 'state-in_review' },
  ANSWERED: { c: 'state-published' },
  CLOSED:   { c: 'state-suspended' },
};

type CodeT = { (key: never): string; has: (key: never) => boolean };
/** 코드 → 사전 글자(affiliate.<group>.<code>) · 없으면 코드 그대로 */
export const codeText = (t: CodeT, group: 'orderState' | 'settleState' | 'inqState' | 'track' | 'materialKind' | 'dash.grade', code: string) => {
  const k = `${group}.${code}` as never;
  return t.has(k) ? t(k) : code;
};
