import { DatabaseService } from '../../db/database.service';

/* ---------------------------------------------------------------------
 * v10.553 ~ 555 (D287 · docs/691 ~ 693) (57) 소개몰 3 — 공통 조각
 *   설정 키 · 입력 무늬(DB CHECK 와 같은 정규식 — 규칙 2) · 설정 읽기
 * ------------------------------------------------------------------- */

export const SMX_KEYS = { bundle: 'smx.bundle', remote: 'smx.remote_ship', reply: 'smx.review_reply' } as const;

/** 묶음 코드 — DB CHECK ck_hlt_bundle_code 와 같음 */
export const BUNDLE_CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,29}$/;
/** 우편번호 5자리 — DB CHECK ck_smx_rz_from · ck_smx_rz_to 와 같음 */
export const ZIP_RE = /^[0-9]{5}$/;
/** 구역 종류 — DB CHECK ck_smx_rz_kind 와 같음 */
export const ZONE_KINDS = ['JEJU', 'ISLAND', 'MOUNTAIN', 'OTHER'] as const;
/** 묶음 상태 — DB CHECK ck_hlt_bundle_state 와 같음 */
export const BUNDLE_STATES = ['DRAFT', 'ON_SALE', 'STOPPED'] as const;

/** 스위치 하나(on 이면 true · 없거나 다른 값이면 false) */
export async function smxOn(db: DatabaseService, key: string): Promise<boolean> {
  const [r] = await db.query<{ v: string | null }>(`SELECT value AS v FROM site_settings WHERE key = $1`, [key]);
  return (r?.v ?? '').trim().toLowerCase() === 'on';
}

/** 세 스위치 한 번에 */
export async function smxSwitches(db: DatabaseService): Promise<{ bundle: boolean; remote: boolean; reply: boolean }> {
  const rows = await db.query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key = ANY($1::text[])`, [Object.values(SMX_KEYS)]);
  const on = (k: string) => (rows.find((r) => r.key === k)?.value ?? '').trim().toLowerCase() === 'on';
  return { bundle: on(SMX_KEYS.bundle), remote: on(SMX_KEYS.remote), reply: on(SMX_KEYS.reply) };
}

/** 금액 글자(원) — 안내 문장용 */
export const smxWon = (v: number) => Number(v || 0).toLocaleString('ko-KR');

/** 숫자 칸(bigint 는 글자로 옴) */
export const smxNum = (v: unknown) => Number(v ?? 0);
