import { SOURCES, Source } from './journal';
import { PURCHASE_SOURCES } from './purchase';
import { EXPENSE_SOURCES } from './expense';
import { STOCK_SOURCES } from './stock';

/* v10.392 (D245) — 자동 전표 돈 흐름 전체(⑨ 13가지 + ⑫ 매입 · 경비 청구 · 법인카드 · 재고)
 *   journal.ts 와 각 모듈이 서로 부르지 않게 여기서 모음 · 정기 작업 · 규칙 · 확인표 · 전표 화면 이름이 이 목록을 씀 */
export const ALL_SOURCES: Source[] = [...SOURCES, ...PURCHASE_SOURCES, ...EXPENSE_SOURCES, ...STOCK_SOURCES];
