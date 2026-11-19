import { SOURCES, Source } from './journal';
import { PURCHASE_SOURCES } from './purchase';
import { EXPENSE_SOURCES } from './expense';
import { STOCK_SOURCES } from './stock';
import { PAYROLL_SOURCES } from './payroll';   // v10.403 (D247)
import { ASSET_SOURCES } from './assets';
import { PG_SOURCES } from './pgsettle';   // v10.404 (D248)   // v10.398 (D246) — 매입 뒤(같은 전표 작업에서 매입 → 자산 넘기기)

/* v10.392 (D245) — 자동 전표 돈 흐름 전체(⑨ 13가지 + ⑫ 매입 · 경비 청구 · 법인카드 · 재고)
 *   journal.ts 와 각 모듈이 서로 부르지 않게 여기서 모음 · 정기 작업 · 규칙 · 확인표 · 전표 화면 이름이 이 목록을 씀 */
export const ALL_SOURCES: Source[] = [...SOURCES, ...PURCHASE_SOURCES, ...ASSET_SOURCES, ...EXPENSE_SOURCES, ...STOCK_SOURCES, ...PAYROLL_SOURCES, ...PG_SOURCES];
