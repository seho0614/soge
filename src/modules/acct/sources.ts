import { SOURCES, Source } from './journal';
import { PURCHASE_SOURCES } from './purchase';
import { EXPENSE_SOURCES } from './expense';
import { STOCK_SOURCES } from './stock';
import { PAYROLL_SOURCES } from './payroll';   // v10.403 (D247)
import { ASSET_SOURCES } from './assets';
import { PG_SOURCES } from './pgsettle';   // v10.404 (D248)
import { SALES_DOC_SOURCES } from './salesdocs';   // v10.433 (D256) 거래명세서 매출 · 취소
import { IMPORT_SOURCES } from './imports';   // v10.411 (D249)   // v10.398 (D246) — 매입 뒤(같은 전표 작업에서 매입 → 자산 넘기기)
import { EXPORT_SOURCES } from './trade';   // v10.428 (D254) 수출 매출 · 대금 회수
import { ACCRUAL_SOURCES } from './accrual';   // v10.439 (D257) 고정비 미지급 · 되돌림
import { TRANSFER_SOURCES } from './transfer';   // v10.454 (D261) 대량 이체 지급(LIVE · OK 줄만)
import { COUPON_SOURCES } from '../health/health-coupon';   // v10.469 (D264) 소개몰 쿠폰 할인(매출할인) · 되돌림

/* v10.392 (D245) — 자동 전표 돈 흐름 전체(⑨ 13가지 + ⑫ 매입 · 경비 청구 · 법인카드 · 재고)
 *   journal.ts 와 각 모듈이 서로 부르지 않게 여기서 모음 · 정기 작업 · 규칙 · 확인표 · 전표 화면 이름이 이 목록을 씀 */
export const ALL_SOURCES: Source[] = [...SOURCES, ...PURCHASE_SOURCES, ...ASSET_SOURCES, ...EXPENSE_SOURCES, ...STOCK_SOURCES, ...PAYROLL_SOURCES, ...PG_SOURCES, ...IMPORT_SOURCES, ...EXPORT_SOURCES, ...SALES_DOC_SOURCES, ...ACCRUAL_SOURCES];

/* v10.454 (D261) — 대량 이체 지급(LIVE · OK 줄만) · 목록 줄을 고치지 않고 덧붙임(다른 묶음과 겹침 없게) */
ALL_SOURCES.push(...TRANSFER_SOURCES);

/* v10.469 (D264) — 소개몰 쿠폰 할인(매출할인) · 되돌림 · 직판 결제 · 환불 전표 뒤에 돌아야 해서 끝에 덧붙임 */
ALL_SOURCES.push(...COUPON_SOURCES);
