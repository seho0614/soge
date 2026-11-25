/* e3 (docs/010) 소개뱅크 src/modules/acct/acct.controller.ts 를 tools/port-from-core.py 로 옮김 — 규칙 R1 · R2 만 적용 · 바꾼 줄은 docs/e3-port-*.tsv */
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ErrorDto } from '../../common/dto/common.dto';
import { Roles } from '../../core/auth';
import { Audit } from '../../core/audit.interceptor';
import { AppError, NotFound, PolicyViolation } from '../../core/errors';
import { RequestCtx } from '../../core/request-context';
import { DatabaseService } from '../../db/database.service';
import { sgb, sgbOk } from '../../core/sgb-client';   // e3.5 손 고침(상품 과세)
import { ExportGate } from '../admin/export-approval';
import { runJournal } from './journal';
import { ALL_SOURCES } from './sources';
import { EVIDENCES, addAccount, ruleSheet, rulesView, setRule } from './rules';
import { acctReport, cancelTaxInvoiceRequest, requestTaxInvoice, taxInvoices, vatSummary, withholdingSummary } from './acct-reports';
import { BANK_MAX_CHARS, bankAutoMatch, bankMatch, bankMonth, uploadBank } from './bank';
import { DATE_STYLES, FIELDS, checkFormat, listFormats, pickFormat, renderRows } from './formats';
import { deadlines, monthSummary } from './month';
import { PAY_ROLES, PURCHASE_KINDS, PURCHASE_MAX_FILES, addPurchase, cancelPurchase, listPurchases, purchaseVat } from './purchase';
import { bookCard, cancelExpense, cardMonth, createExpense, decideExpense, listExpenses, payExpense, uploadCard } from './expense';
import { addCashBalance, addCashPlan, cancelCashPlan, cashflow, listCashPlans } from './cashflow';
import { stockAdjust, stockIn, stockList, stockMoves } from './stock';
import { EXPORT_STATES, addExport, addPo, advanceExport, cancelExport, cancelPo, listExports, listPos, receivePo } from './trade';
import { bizCheckParty } from './bizcheck';
import { PARTY_KINDS, addParty, importParties, listParties, partyDetail, updateParty } from './parties';
import { CONTRACT_KINDS, CONTRACT_MAX_FILES, addContract, endContract, listContracts, renewContract } from './contracts';
import { addRequisition, cancelRequisition, decideRequisition, listRequisitions, useRequisition } from './requisitions';
import { IMPORT_STATES, addImport, advanceImport, cancelImport, importDetail, listImports } from './imports';
import { bookInbox, fetchInbox, ignoreInbox, listInbox } from './taxinbox';   // v10.432 (D255) 매입 세금계산서 가져오기
import { PG_MAX_CHARS, pgAutoMatch, pgMatch, pgMonth, uploadPg } from './pgsettle';
import { MANUAL_EVIDENCES, addManual, cancelManual, decideManual, listManual } from './manual';
import { leaveBook, leaveGrant, leaveUse, severanceEstimate, severanceRun } from './severance';
import { corpTaxPreview } from './corptax';
import { PG_SOURCES } from './pgsettle';
import { vatForm, vatFormRows } from './vatform';
import { agingView } from './aging';
import { closeYear, reopenYear, yearClosings } from './yearclose';
import { addEmployee, createRun, fixRun, listEmployees, paidRun, payrollMonth, ratesOf, RATE_KEYS, setRate, updateEmployee, updateLine, uploadWhtTable } from './payroll';
import { balanceSheet, incomeStatement, openingCreate, openingFix, openingList, openingSetLines, trialBalance, kstToday, yearStart } from './statements';
import { accountLedger, bookCsv, ledgerCsv, salesPurchaseBook } from './ledger';
import { addAsset, assetDetail, depreciationJob, disposeAsset, listAssets } from './assets';
import { budgetView, setBudget } from './budget';
import { StrictBoolean } from '../../common/strict-boolean';

/* ---------------------------------------------------------------------
 * v10.381 ~ 384 (D242 · docs/517 ~ 520) 회계 · 세무 1단계 — 운영 화면 「회계」 메뉴
 *   보기 SUPER · PAYOUT(지급 담당) · 고치기 · 마감 SUPER
 *   v10.381  GET   /admin/acct/accounts                    계정(역할 · 회계 프로그램 코드) · 전표 규칙(돈 흐름별 줄 모양) · 설정
 *            PATCH /admin/acct/accounts/{role}             회계 프로그램 코드 · 이름(SUPER · 사유 · 감사 ACCT_ACCOUNT_SET)
 *            GET   /admin/acct/products                    직판 상품 과세 · 면세
 *            PATCH /admin/acct/products/{code}/tax-type    과세 · 면세 고르기(ADMIN · SUPER · 사유 · 감사 PRODUCT_TAX_TYPE)
 *   v10.382  GET   /admin/acct/journal?ym=                 그 달 전표 · 계정별 합 · 마감
 *            POST  /admin/acct/journal/run                 지금 전표 만들기(SUPER · 정기 작업과 같음)
 *            GET   /admin/acct/journal/export?ym=          전표 CSV(회계 프로그램 올리기용 일반 양식 · 내려받기 승인 ACCT_JOURNAL)
 *            GET   /admin/acct/closings · POST /admin/acct/closings   월 마감(SUPER · 지난 달만 · 한 번 · 감사 ACCT_CLOSE)
 *   v10.383  GET   /admin/acct/tax/vat?q=YYYY-Qn · /tax/withholding?ym= · /tax/invoices?ym=
 *            GET   /admin/acct/tax/export?kind=VAT|WHT_YEAR&period=   신고 자료 CSV(내려받기 승인 ACCT_TAX)
 *   v10.384  GET   /admin/acct/report?months=              월별 손익 · 매출 구성 · 현금 들고 남
 *   ── ⑪ (D244 · docs/525 ~ 528) ──
 *   v10.388  POST  /admin/acct/bank/upload                 통장 거래 내역 CSV(같은 줄 한 번 · 감사 ACCT_BANK_UPLOAD)
 *            GET   /admin/acct/bank?ym=                    그 달 통장 줄 · 후보 전표 · 장부에만 있음 · 마지막 잔액
 *            POST  /admin/acct/bank/{id}/match             맞춤(전표) · 맞출 것 없음(사유) · 풀기(사유) · 감사 ACCT_BANK_MATCH
 *            POST  /admin/acct/bank/auto-match             후보 하나 + 이름 같음만 자동
 *   v10.389  GET   /admin/acct/formats · POST /admin/acct/formats · PATCH /admin/acct/formats/{id}   전표 CSV 양식(SUPER)
 *            POST  /admin/acct/formats/preview             양식 미리보기(보기 줄 3개 · 실제 전표 아님)
 *            GET   /admin/acct/journal/export?ym=&format=  고른 양식(비우면 기본)
 *   v10.390  GET   /admin/acct/month?ym=                   월 결산 요약 · 할 일 · 신고 기한
 *            GET   /admin/acct/deadlines                   다가오는 신고 기한(원천세 10일 · 부가세 25일)
 *   v10.391  POST  /admin/acct/tax/invoices/request        광고 청구 · 입점 수수료 세금계산서 발행 요청 → /admin/etax/{ad|commission}/{id}/send
 *            POST  /admin/acct/tax/invoices/{id}/cancel    보내지 않은 요청 취소
 *   ── ⑫ (D245 · docs/529 ~ 532) ──
 *   v10.392  PATCH /admin/acct/rules/{source}              규칙 고치기 — 계정 자리(같은 종류) · 증빙(SUPER · 사유 · 다음 전표부터 · 감사 ACCT_RULE_SET)
 *            POST  /admin/acct/accounts                    계정 더하기(U_ · SUPER · 감사 ACCT_ACCOUNT_ADD)
 *            GET   /admin/acct/rules/sheet?csv=1           규칙 확인표(예시 전표 · 계정 코드 · 초안 · CSV)
 *            GET   /admin/acct/purchases?ym=               그 달 매입 · 합계 · 고를 계정
 *            POST  /admin/acct/purchases                   매입 넣기(SUPER · PAYOUT · 같은 건 409 · 감사 ACCT_PURCHASE_ADD)
 *            POST  /admin/acct/purchases/{id}/cancel       취소(사유 · 반대 전표 · 감사 ACCT_PURCHASE_CANCEL)
 *            GET   /admin/acct/tax/vat-purchase?q=YYYY-n   신고 자료 매입 쪽(공제 · 불공제 · 종류별 · 공급자별)
 *   v10.393  GET   /admin/acct/expenses?state=&ym=         경비 청구(SUPER · PAYOUT 모두 · 나머지 자기 것)
 *            POST  /admin/acct/expenses                    경비 청구 올리기(운영자 누구나 · 증빙 3개 · 감사 ACCT_EXPENSE_CREATE)
 *            POST  /admin/acct/expenses/{id}/decide        승인 · 반려(SUPER · 본인 불가 · 감사 ACCT_EXPENSE_DECIDE)
 *            POST  /admin/acct/expenses/{id}/paid          지급 처리(PAYOUT · 본인 불가 · 감사 ACCT_EXPENSE_PAID)
 *            POST  /admin/acct/expenses/{id}/cancel        본인 청구 취소(감사 ACCT_EXPENSE_CANCEL)
 *            POST  /admin/acct/cards/upload · GET /admin/acct/cards?ym= · POST /admin/acct/cards/{id}/book   법인카드 CSV · 장부에 넣기
 *   v10.394  GET   /admin/acct/cashflow?days=90            날마다 예상 잔액 · 가장 낮은 날(확정된 것만)
 *            POST  /admin/acct/cashflow/balance            잔액 직접 넣기(SUPER · 감사 ACCT_CASH_BALANCE)
 *            GET · POST /admin/acct/cashflow/plans · POST /admin/acct/cashflow/plans/{id}/cancel   예정 들고 남
 *   v10.395  GET   /admin/acct/stock · GET /admin/acct/stock/{code}/moves?ym=   직판 재고 · 수불
 *            POST  /admin/acct/stock/in · POST /admin/acct/stock/adjust        입고 · 실사 조정(감사 ACCT_STOCK_*)
 * ------------------------------------------------------------------- */

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const VIEW = ['SUPER', 'PAYOUT'] as const;

export class AcctAccountDto {
  @ApiPropertyOptional({ example: '404', description: '회계 프로그램 계정 코드(비우면 없음)' }) @IsOptional() @IsString() @Matches(/^([0-9A-Za-z._-]{1,20})?$/) extCode?: string;
  @ApiPropertyOptional({ example: '용역매출', description: '회계 프로그램 계정 이름' }) @IsOptional() @IsString() @Length(0, 60) extName?: string;
  @ApiProperty({ example: '세무사 확인 — 계정 코드표 맞춤', description: '사유(2 ~ 200자)' }) @IsString() @Length(1, 400) reason!: string;
}
export class TaxTypeDto {
  @ApiProperty({ enum: ['TAXABLE', 'EXEMPT'] }) @IsIn(['TAXABLE', 'EXEMPT']) taxType!: string;
  @ApiProperty({ example: '면세 품목(세무사 확인)', description: '사유(2 ~ 200자)' }) @IsString() @Length(1, 400) reason!: string;
}
export class AcctCloseDto {
  @ApiProperty({ example: '2026-11', description: '마감할 달(이번 달 전)' }) @Matches(YM) ym!: string;
  @ApiPropertyOptional({ example: '회계 프로그램에 올림', description: '메모(200자까지)' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
}

export class BankUploadDto {
  @ApiProperty({ description: `통장 거래 내역 CSV 글자(엑셀 저장 · ${BANK_MAX_CHARS.toLocaleString('ko-KR')}자까지)` }) @IsString() @Length(1, BANK_MAX_CHARS) csv!: string;
  @ApiPropertyOptional({ example: '거래내역_202611.csv' }) @IsOptional() @IsString() @Length(0, 200) filename?: string;
  @ApiPropertyOptional({ example: '국민은행' }) @IsOptional() @IsString() @Length(0, 40) bank?: string;
}
export class BankMatchDto {
  @ApiPropertyOptional({ example: '123', description: '맞출 전표 번호' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) entryId?: string;
  @ApiPropertyOptional({ description: '맞출 것 없음(이자 · 수수료 등 — 사유 필요)' }) @IsOptional() @StrictBoolean() ignore?: boolean;
  @ApiPropertyOptional({ description: '맞춤 풀기(사유 필요)' }) @IsOptional() @StrictBoolean() clear?: boolean;
  @ApiPropertyOptional({ example: '예금 이자' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
}
export class YmDto {
  @ApiProperty({ example: '2026-11' }) @Matches(YM) ym!: string;
}
export class FormatColDto {
  @ApiProperty({ enum: Object.keys(FIELDS) }) @IsIn(Object.keys(FIELDS)) field!: string;
  @ApiPropertyOptional({ example: '일자' }) @IsOptional() @IsString() @Length(0, 30) title?: string;
}
export class AcctFormatDto {
  @ApiProperty({ example: '세무사랑' }) @IsString() @Length(1, 40) name!: string;
  @ApiProperty({ type: [FormatColDto] }) @IsArray() columns!: FormatColDto[];
  @ApiPropertyOptional({ enum: DATE_STYLES }) @IsOptional() @IsIn(DATE_STYLES as unknown as string[]) dateStyle?: string;
  @ApiPropertyOptional({ enum: ['SPLIT', 'SIGN'] }) @IsOptional() @IsIn(['SPLIT', 'SIGN']) dcStyle?: string;
  @ApiPropertyOptional({ example: '차변' }) @IsOptional() @IsString() @Length(0, 10) dcDebit?: string;
  @ApiPropertyOptional({ example: '대변' }) @IsOptional() @IsString() @Length(0, 10) dcCredit?: string;
  @ApiPropertyOptional({ description: '머리줄 넣기(처음 예)' }) @IsOptional() @StrictBoolean() header?: boolean;
  @ApiPropertyOptional({ description: '기본 양식으로' }) @IsOptional() @StrictBoolean() isDefault?: boolean;
}
export class TaxInvoiceRequestDto {
  @ApiProperty({ enum: ['AD', 'COMMISSION'] }) @IsIn(['AD', 'COMMISSION']) kind!: 'AD' | 'COMMISSION';
  @ApiProperty({ format: 'uuid', description: '광고 청구서 · 입점 정산 번호' }) @IsString() @Length(36, 36) sourceId!: string;
}
export class TaxInvoiceCancelDto {
  @ApiProperty({ example: '금액 다시 확인' }) @IsString() @Length(1, 400) reason!: string;
}
export class RuleMapDto {
  @ApiProperty({ example: 'REV_SUB', description: '원래 계정 자리(역할)' }) @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,39}$/) from!: string;
  @ApiProperty({ example: 'U_REV_SUB2', description: '쓸 계정(같은 종류)' }) @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,39}$/) to!: string;
}
export class AcctRuleDto {
  @ApiPropertyOptional({ type: [RuleMapDto], description: '계정 자리 바꾸기(원래 역할로 두면 바꾼 것 지움)' }) @IsOptional() @IsArray() maps?: RuleMapDto[];
  @ApiPropertyOptional({ enum: EVIDENCES, description: '증빙 바꾸기' }) @IsOptional() @IsIn(EVIDENCES as string[]) evidence?: string;
  @ApiProperty({ example: '세무사 확인 — 구독 매출 계정 따로' }) @IsString() @Length(1, 400) reason!: string;
}
export class AcctAccountAddDto {
  @ApiProperty({ example: 'U_REV_SUB2', description: '역할(U_ 로 시작 · 대문자)' }) @IsString() @Matches(/^U_[A-Z][A-Z_]{1,30}$/) role!: string;
  @ApiProperty({ example: '구독 매출(연간)' }) @IsString() @Length(1, 60) name!: string;
  @ApiProperty({ enum: ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] }) @IsIn(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']) kind!: string;   // v10.396 (D246) 자본
  @ApiPropertyOptional({ example: '405' }) @IsOptional() @IsString() @Matches(/^([0-9A-Za-z._-]{1,20})?$/) extCode?: string;
  @ApiPropertyOptional({ example: '용역매출' }) @IsOptional() @IsString() @Length(0, 60) extName?: string;
  @ApiProperty({ example: '세무사 계정 코드표' }) @IsString() @Length(1, 400) reason!: string;
}

export class PurchaseAddDto {
  @ApiProperty({ enum: PURCHASE_KINDS, description: 'TAX_INVOICE 매입 세금계산서 · CARD 카드 · CASH 현금영수증 · SIMPLE 간이영수증(공제 안 됨)' }) @IsIn(PURCHASE_KINDS as unknown as string[]) kind!: string;
  @ApiProperty({ example: '2026-11-18', description: '발행일(앞날 안 됨)' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) issuedOn!: string;
  @ApiProperty({ example: '(주)사무용품' }) @IsString() @Length(1, 120) supplierName!: string;
  @ApiPropertyOptional({ example: '1234567890', description: '공급자 사업자등록번호(세금계산서는 필수 · - 빼도 됨)' }) @IsOptional() @IsString() @Length(0, 14) supplierBizNo?: string;
  @ApiProperty({ example: '복사용지' }) @IsString() @Length(1, 120) item!: string;
  @ApiProperty({ example: 100000, description: '공급가(간이영수증은 합계)' }) @IsInt() @Min(1) @Max(10_000_000_000) supply!: number;
  @ApiPropertyOptional({ example: 10000, description: '부가세(간이영수증은 0)' }) @IsOptional() @IsInt() @Min(0) @Max(10_000_000_000) vat?: number;
  @ApiPropertyOptional({ description: '부가세 공제(처음 예 · 간이영수증 · 기업업무추진비는 언제나 아니오)' }) @IsOptional() @StrictBoolean() deductible?: boolean;
  @ApiProperty({ example: 'EXP_SUPPLIES', description: '비용 · 자산 계정 역할' }) @IsString() @Matches(/^[A-Z][A-Z_]{1,39}$/) accountRole!: string;
  @ApiProperty({ enum: PAY_ROLES, description: 'CASH 보통예금 · AP 미지급금 · CARD_AP 법인카드' }) @IsIn(PAY_ROLES as unknown as string[]) payRole!: string;
  @ApiPropertyOptional({ example: '11월 사무용품' }) @IsOptional() @IsString() @Length(0, 400) memo?: string;
  @ApiPropertyOptional({ type: [String], description: `증빙 파일 id — POST /files(ACCT_EVIDENCE)로 올린 것 · ${PURCHASE_MAX_FILES}개까지` }) @IsOptional() @IsArray() @ArrayMaxSize(PURCHASE_MAX_FILES) @IsString({ each: true }) attachments?: string[];
  @ApiPropertyOptional({ description: '같은 공급자 · 날짜 · 합계가 있어도 넣기' }) @IsOptional() @StrictBoolean() force?: boolean;
  @ApiPropertyOptional({ example: '12', description: 'v10.417 붙일 품의 번호(승인 · 쓰는 중) — 합계가 품의 금액 × (1 + 허용 %) 넘으면 422 REQ_OVER' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) requisitionId?: string;
}
export class PurchaseCancelDto {
  @ApiProperty({ example: '금액 잘못 넣음' }) @IsString() @Length(1, 400) reason!: string;
}

const STAFF = ['ADMIN', 'PAYOUT', 'REVIEWER', 'PARTNER_MAL', 'PARTNER_AFF'] as const;   // SUPER 는 늘 통과

export class ExpenseCreateDto {
  @ApiProperty({ example: '2026-11-18', description: '쓴 날(오늘까지)' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) spentOn!: string;
  @ApiProperty({ example: 'EXP_TRAVEL', description: '비용 계정 역할' }) @IsString() @Matches(/^[A-Z][A-Z_]{1,39}$/) accountRole!: string;
  @ApiProperty({ example: 33000, description: '쓴 금액(부가세 포함 · 1 ~ 1억 원)' }) @IsInt() @Min(1) @Max(100000000) amount!: number;
  @ApiPropertyOptional({ example: 3000, description: '공제받을 부가세(간이영수증은 0)' }) @IsOptional() @IsInt() @Min(0) vat?: number;
  @ApiProperty({ enum: ['CARD', 'CASH', 'SIMPLE', 'TAX_INVOICE'] }) @IsIn(['CARD', 'CASH', 'SIMPLE', 'TAX_INVOICE']) evidence!: string;
  @ApiProperty({ example: '거래처 방문 택시비' }) @IsString() @Length(2, 100) item!: string;
  @ApiPropertyOptional({ example: '강남 → 판교' }) @IsOptional() @IsString() @Length(0, 400) memo?: string;
  @ApiPropertyOptional({ type: [String], description: 'POST /files(ACCT_EVIDENCE)로 올린 파일 id · 3개까지' }) @IsOptional() @IsArray() @IsString({ each: true }) attachments?: string[];
  @ApiPropertyOptional({ example: '12', description: 'v10.417 붙일 품의 번호 — 합계가 한도를 넘으면 422 REQ_OVER' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) requisitionId?: string;
}
export class ExpenseDecideDto {
  @ApiProperty({ enum: ['approve', 'reject'] }) @IsIn(['approve', 'reject']) decision!: 'approve' | 'reject';
  @ApiPropertyOptional({ example: '증빙이 흐림 — 다시 올려 주십시오', description: '반려 사유(2 ~ 200자)' }) @IsOptional() @IsString() @Length(0, 400) reason?: string;
}
export class CardUploadDto {
  @ApiProperty({ description: '법인카드 이용 내역 CSV 글자(95,000자까지)' }) @IsString() @Length(1, 95000) csv!: string;
  @ApiPropertyOptional({ example: '이용내역_202611.csv' }) @IsOptional() @IsString() @Length(0, 200) filename?: string;
  @ApiPropertyOptional({ example: '신한 법인카드' }) @IsOptional() @IsString() @Length(0, 40) card?: string;
}
export class CardBookDto {
  @ApiPropertyOptional({ example: 'EXP_WELFARE', description: '비용 · 자산 계정 역할' }) @IsOptional() @IsString() @Matches(/^[A-Z][A-Z_]{1,39}$/) accountRole?: string;
  @ApiPropertyOptional({ description: '매입세액 공제(÷ 11) — 간이과세 · 면세 가맹점 · 접대비는 아니오' }) @IsOptional() @StrictBoolean() deductible?: boolean;
  @ApiPropertyOptional({ description: '장부에 넣지 않음(사유 필요)' }) @IsOptional() @StrictBoolean() ignore?: boolean;
  @ApiPropertyOptional({ example: '개인 사용 — 본인 부담 처리' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
}

/* ── DTO(클래스 이름 src 전체 고유 확인함: CashBalanceDto · CashPlanDto · CashPlanCancelDto 없음) ── */
const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export class CashBalanceDto {
  @ApiProperty({ example: '2026-11-19', description: '잔액 날짜(오늘부터 1년 전까지)' }) @Matches(YMD) asOf!: string;
  @ApiProperty({ example: 25000000, description: '그날 끝 통장 잔액(원 · 여러 통장이면 합)' }) @IsInt() amount!: number;
  @ApiPropertyOptional({ example: '국민 · 기업 통장 합' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
}
export class CashPlanDto {
  @ApiProperty({ example: '2026-11-25', description: '날짜(매달이면 첫 날)' }) @Matches(YMD) dueOn!: string;
  @ApiProperty({ enum: ['IN', 'OUT'] }) @IsIn(['IN', 'OUT']) direction!: 'IN' | 'OUT';
  @ApiProperty({ example: 1500000 }) @IsInt() amount!: number;
  @ApiProperty({ example: '사무실 임대료' }) @IsString() @Length(1, 200) memo!: string;
  @ApiPropertyOptional({ enum: ['NONE', 'MONTHLY'] }) @IsOptional() @IsIn(['NONE', 'MONTHLY']) repeat?: 'NONE' | 'MONTHLY';
  @ApiPropertyOptional({ example: '2027-10-25', description: '매달 반복 끝 날짜(비우면 계속)' }) @IsOptional() @Matches(YMD) untilOn?: string;
}
export class CashPlanCancelDto {
  @ApiProperty({ example: '계약 해지' }) @IsString() @Length(1, 400) reason!: string;
}

/* ── DTO (클래스 위치: 다른 DTO 옆 · 컨트롤러 클래스 앞) ── */
export class StockInDto {
  @ApiProperty({ format: 'uuid', description: '직판 상품 옵션 번호' }) @IsString() @Length(36, 36) optionId!: string;
  @ApiProperty({ example: 100, description: '들어온 수량(1 ~ 1,000,000)' }) @IsInt() @Min(1) @Max(1000000) qty!: number;
  @ApiProperty({ example: 12000, description: '한 개 매입 단가(원 · 부가세 뺀 공급가)' }) @IsNumber() @Min(0.01) @Max(1000000000) unitCost!: number;
  @ApiPropertyOptional({ example: '2026-11-19', description: '입고 날짜(비우면 오늘 · 오늘까지)' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) movedOn?: string;
  @ApiPropertyOptional({ example: '12', description: '⑫ 매입 번호(있으면 입고 전표 없음 — 매입 전표가 상품으로 잡음)' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) purchaseId?: string;
  @ApiPropertyOptional({ example: '11월 2차 입고' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class StockAdjustDto {
  @ApiProperty({ format: 'uuid', description: '직판 상품 옵션 번호' }) @IsString() @Length(36, 36) optionId!: string;
  @ApiProperty({ example: -2, description: '늘림 + · 줄임 − (0 아님 · 줄임은 0 아래로 못 감)' }) @IsInt() @Min(-1000000) @Max(1000000) qty!: number;
  @ApiPropertyOptional({ example: 12000, description: '재고가 없을 때 늘리면 단가 필요(있으면 지금 평균 단가)' }) @IsOptional() @IsNumber() @Min(0) @Max(1000000000) unitCost?: number;
  @ApiProperty({ example: '11월 실사 — 파손 2개', description: '사유(2 ~ 200자)' }) @IsString() @Length(1, 400) reason!: string;
}

/* ── ⑬ statements.ctrl.ts ── */
export class AcctOpeningCreateDto {
  @ApiProperty({ example: '2026-11-01', description: '기준일(그날 0시 잔액)' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) asOf!: string;
  @ApiPropertyOptional({ example: '시작일 기초 잔액(세무사 결산표)' }) @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class AcctOpeningLineDto {
  @ApiProperty({ example: 'CASH' }) @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,39}$/) role!: string;
  @ApiPropertyOptional({ example: 12000000 }) @IsOptional() @IsInt() @Min(0) @Max(1e13) debit?: number;
  @ApiPropertyOptional({ example: 0 }) @IsOptional() @IsInt() @Min(0) @Max(1e13) credit?: number;
  @ApiPropertyOptional({ example: '국민은행 통장' }) @IsOptional() @IsString() @Length(0, 120) memo?: string;
}
export class AcctOpeningLinesDto {
  @ApiProperty({ type: [AcctOpeningLineDto] }) @IsArray() lines!: AcctOpeningLineDto[];
}
export class AcctOpeningFixDto {
  @ApiProperty({ example: '세무사 결산표와 맞춤' }) @IsString() @Length(1, 400) reason!: string;
}

/* ── ⑬ ledger.ctrl.ts ── */


/* ── ⑬ assets.ctrl.ts ── */
export class AcctAssetAddDto {
  @ApiPropertyOptional({ example: '노트북(개발용)', description: '이름(매입에서 넘기면 비워도 매입 품목)' }) @IsOptional() @IsString() @Length(0, 120) name?: string;
  @ApiPropertyOptional({ example: '전산장비' }) @IsOptional() @IsString() @Length(0, 40) category?: string;
  @ApiPropertyOptional({ example: '2026-11-05', description: '취득일(매입에서 넘기면 매입 날짜)' }) @IsOptional() @IsString() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) acquiredOn?: string;
  @ApiPropertyOptional({ example: 2400000, description: '취득가(매입에서 넘기면 공급가 · 불공제면 합계)' }) @IsOptional() @IsInt() @Min(0) @Max(1e12) cost?: number;
  @ApiPropertyOptional({ example: 0, description: '잔존가치' }) @IsOptional() @IsInt() @Min(0) @Max(1e12) residual?: number;
  @ApiProperty({ example: 60, description: '내용연수(달 · 초안 · 세무사 확인)' }) @IsInt() @Min(1) @Max(600) lifeMonths!: number;
  @ApiProperty({ enum: ['STRAIGHT', 'DECLINING'] }) @IsIn(['STRAIGHT', 'DECLINING']) method!: string;
  @ApiPropertyOptional({ example: 'FIXED_ASSET', description: '자산 계정(처음 비품)' }) @IsOptional() @IsString() @Matches(/^([A-Z][A-Z0-9_]{1,39})?$/) accountRole?: string;
  @ApiPropertyOptional({ enum: ['CASH', 'AP', 'NONE'], description: '낸 방법(직접 넣을 때 · NONE = 기초 잔액에 이미 있음)' }) @IsOptional() @IsIn(['CASH', 'AP', 'NONE']) payRole?: string;
  @ApiPropertyOptional({ example: '12', description: '⑫ 매입 번호(매입에서 넘기기)' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) purchaseId?: string;
  @ApiPropertyOptional({ example: 0, description: '시스템 전 상각액' }) @IsOptional() @IsInt() @Min(0) @Max(1e12) priorDepr?: number;
  @ApiPropertyOptional({ example: 0, description: '시스템 전 상각 달수' }) @IsOptional() @IsInt() @Min(0) @Max(600) priorMonths?: number;
  @ApiPropertyOptional({ example: '' }) @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class AcctAssetDisposeDto {
  @ApiProperty({ example: '2027-03-31' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) disposedOn!: string;
  @ApiProperty({ example: 300000, description: '받은 돈(폐기는 0)' }) @IsInt() @Min(0) @Max(1e12) amount!: number;
  @ApiPropertyOptional({ enum: ['CASH', 'AR'], description: '받은 곳(처음 보통예금)' }) @IsOptional() @IsIn(['CASH', 'AR']) receiveRole?: string;
  @ApiProperty({ example: '고장으로 중고 매각' }) @IsString() @Length(1, 400) reason!: string;
}

/* ── ⑬ budget.ctrl.ts ── */
export class AcctBudgetItemDto {
  @ApiProperty({ example: 'EXP_RENT' }) @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,39}$/) role!: string;
  @ApiProperty({ example: 3300000, description: '예산(0 이면 지움)' }) @IsInt() @Min(0) @Max(1e13) amount!: number;
}
export class AcctBudgetSetDto {
  @ApiProperty({ example: '2026-12' }) @Matches(YM) ym!: string;
  @ApiPropertyOptional({ type: [AcctBudgetItemDto] }) @IsOptional() @IsArray() items?: AcctBudgetItemDto[];
  @ApiPropertyOptional({ example: '2026-11', description: '이 달 예산을 그대로 옮김(이미 넣은 계정은 그대로)' }) @IsOptional() @Matches(YM) copyFrom?: string;
  @ApiProperty({ example: '12월 예산(대표 승인)' }) @IsString() @Length(1, 400) reason!: string;
}

/* ── ⑭ d247.ctrl.ts ── */
/* ── DTO(클래스 이름: src · ⑫ 조각과 겹치지 않음 확인 — AcctYear* · AcctEmp* · AcctPay* · AcctWht*) ── */
const YMD7 = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export class AcctYearCloseDto {
  @ApiProperty({ example: 2026, description: '마감할 해(끝난 해)' }) @IsInt() @Min(2000) @Max(2100) year!: number;
  @ApiPropertyOptional({ example: '세무사 결산 확인' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
}
export class AcctYearReopenDto {
  @ApiProperty({ example: '결산 수정 — 세무사 요청' }) @IsString() @Length(1, 400) reason!: string;
}
export class AcctEmpDto {
  @ApiProperty({ example: '홍길동' }) @IsString() @Length(1, 40) name!: string;
  @ApiProperty({ example: '2026-11-01' }) @Matches(YMD7) joinedOn!: string;
  @ApiPropertyOptional({ example: '' , description: '퇴사일(비우면 재직)' }) @IsOptional() @IsString() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) leftOn?: string;
  @ApiProperty({ example: 3000000, description: '월 기본급(원)' }) @IsInt() @Min(0) @Max(100000000) monthlyBase!: number;
  @ApiPropertyOptional({ example: 200000, description: '비과세(식대 등 · 원)' }) @IsOptional() @IsInt() @Min(0) @Max(10000000) nontax?: number;
  @ApiPropertyOptional({ example: 1, description: '부양가족 수(본인 포함 1 ~ 11)' }) @IsOptional() @IsInt() @Min(1) @Max(11) dependents?: number;
  @ApiPropertyOptional({ example: '' }) @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class AcctEmpPatchDto {
  @ApiPropertyOptional({ example: '홍길동' }) @IsOptional() @IsString() @Length(1, 40) name?: string;
  @ApiPropertyOptional({ example: '2026-11-01' }) @IsOptional() @Matches(YMD7) joinedOn?: string;
  @ApiPropertyOptional({ example: '2027-03-31', description: '퇴사일(빈 글자면 지움)' }) @IsOptional() @IsString() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) leftOn?: string;
  @ApiPropertyOptional({ example: 3200000 }) @IsOptional() @IsInt() @Min(0) @Max(100000000) monthlyBase?: number;
  @ApiPropertyOptional({ example: 200000 }) @IsOptional() @IsInt() @Min(0) @Max(10000000) nontax?: number;
  @ApiPropertyOptional({ example: 2 }) @IsOptional() @IsInt() @Min(1) @Max(11) dependents?: number;
  @ApiPropertyOptional({ example: '' }) @IsOptional() @IsString() @Length(0, 200) memo?: string;
}
export class AcctPayRunDto {
  @ApiProperty({ example: '2026-11' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) ym!: string;
  @ApiPropertyOptional({ example: '2026-11-25', description: '지급일(비우면 acct.pay_day)' }) @IsOptional() @Matches(YMD7) payDay?: string;
}
export class AcctPayLineDto {
  @ApiPropertyOptional({ example: 3000000, description: '지급액(원)' }) @IsOptional() @IsInt() @Min(0) @Max(100000000) gross?: number;
  @ApiPropertyOptional({ example: 200000, description: '비과세(원)' }) @IsOptional() @IsInt() @Min(0) @Max(100000000) nontax?: number;
}
export class AcctPayRateDto {
  @ApiProperty({ example: 2026 }) @IsInt() @Min(2000) @Max(2100) year!: number;
  @ApiProperty({ enum: RATE_KEYS }) @IsIn(RATE_KEYS as unknown as string[]) key!: string;
  @ApiProperty({ example: 4.75, description: '% 또는 원(기준소득 하한 · 상한)' }) @IsNumber() @Min(0) value!: number;
  @ApiProperty({ example: '국민연금공단 2026 고시' }) @IsString() @Length(1, 400) reason!: string;
}
export class AcctWhtTableDto {
  @ApiProperty({ example: 2026 }) @IsInt() @Min(2000) @Max(2100) year!: number;
  @ApiProperty({ description: '국세청 근로소득 간이세액표 CSV(머리줄 이상 · 미만 · 1 ~ 11 · 95,000자까지 — 넘으면 나눠 올리고 둘째부터 append)' }) @IsString() @Length(1, 95000) csv!: string;
  @ApiPropertyOptional({ description: '이어 올리기(처음 false = 그 해 전체 바꿈)' }) @IsOptional() @StrictBoolean() append?: boolean;
  @ApiPropertyOptional({ enum: ['THOUSAND', 'WON'], description: '이상 · 미만 칸 단위(처음 천원)' }) @IsOptional() @IsIn(['THOUSAND', 'WON']) unit?: 'THOUSAND' | 'WON';
  @ApiProperty({ example: '국세청 2026 간이세액표' }) @IsString() @Length(1, 400) reason!: string;
}

/* ── ⑮ d248.ctrl.ts ── */
export class AcctPgUploadDto {
  @ApiProperty({ description: `PG 정산 내역 CSV 글자(${PG_MAX_CHARS.toLocaleString('ko-KR')}자까지)` }) @IsString() @Length(1, PG_MAX_CHARS) csv!: string;
  @ApiPropertyOptional({ example: '정산내역_202611.csv' }) @IsOptional() @IsString() @Length(0, 200) filename?: string;
  @ApiPropertyOptional({ example: '토스페이먼츠' }) @IsOptional() @IsString() @Length(0, 40) pgName?: string;
}
export class AcctPgMatchDto {
  @ApiPropertyOptional({ example: '123', description: '맞출 전표 번호(PG 정산 받을 돈 줄이 있는 전표)' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) entryId?: string;
  @ApiPropertyOptional({ description: '맞출 것 없음(회계 시작일 전 결제 · 시험 결제 등 — 사유 필요 · 전표 만들지 않음)' }) @IsOptional() @StrictBoolean() ignore?: boolean;
  @ApiPropertyOptional({ description: '맞춤 풀기(사유 · PG 정산 전표가 만들어지기 전만)' }) @IsOptional() @StrictBoolean() clear?: boolean;
  @ApiPropertyOptional({ example: '회계 시작일 전 결제' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
}
export class AcctManualLineDto {
  @ApiProperty({ example: 'EXP_RENT', description: '계정 역할' }) @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,39}$/) role!: string;
  @ApiPropertyOptional({ example: 1000000 }) @IsOptional() @IsInt() @Min(0) debit?: number;
  @ApiPropertyOptional({ example: 0 }) @IsOptional() @IsInt() @Min(0) credit?: number;
  @ApiPropertyOptional({ example: '11월 임대료' }) @IsOptional() @IsString() @Length(0, 100) memo?: string;
}
export class AcctManualDto {
  @ApiProperty({ example: '2026-11-25' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) entryDate!: string;
  @ApiProperty({ example: '11월 사무실 임대료' }) @IsString() @Length(1, 400) memo!: string;
  @ApiPropertyOptional({ example: '(주)건물주' }) @IsOptional() @IsString() @Length(0, 120) party?: string;
  @ApiPropertyOptional({ enum: MANUAL_EVIDENCES }) @IsOptional() @IsIn(MANUAL_EVIDENCES as unknown as string[]) evidence?: string;
  @ApiProperty({ type: [AcctManualLineDto], description: '줄 2 ~ 30 · 차변 합 = 대변 합' }) @IsArray() lines!: AcctManualLineDto[];
}
export class AcctManualDecideDto {
  @ApiProperty({ description: 'true 승인(전표 넣기) · false 반려(사유)' }) @StrictBoolean() approve!: boolean;
  @ApiPropertyOptional({ example: '계약서 확인' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
}
export class AcctSeveranceRunDto {
  @ApiProperty({ example: '2026-11', description: '추계할 달(지난 달까지 · 마감 전)' }) @Matches(YM) ym!: string;
}
export class AcctLeaveGrantDto {
  @ApiProperty({ example: '1', description: '직원 번호(⑭ acct_employees)' }) @IsString() @Matches(/^\d{1,18}$/) employeeId!: string;
  @ApiProperty({ example: 2026 }) @IsInt() @Min(2000) @Max(2100) year!: number;
  @ApiProperty({ example: 15, description: '일수(0.5 단위 · 바로잡기는 음수)' }) @IsNumber() @Min(-40) @Max(40) days!: number;
  @ApiProperty({ example: '2026년 연차(입사 1년)' }) @IsString() @Length(1, 400) note!: string;
}
export class AcctLeaveUseDto {
  @ApiProperty({ example: '1' }) @IsString() @Matches(/^\d{1,18}$/) employeeId!: string;
  @ApiProperty({ example: '2026-11-20' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) usedOn!: string;
  @ApiProperty({ example: 1, description: '일수(0.5 단위 · 취소는 음수 + 사유)' }) @IsNumber() @Min(-30) @Max(30) days!: number;
  @ApiPropertyOptional({ example: '개인 사정' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
}

/* ── ⑯ parties.ctrl.ts ── */
export class PartyDto {
  @ApiProperty({ enum: PARTY_KINDS, description: 'SUPPLIER 매입처 · CUSTOMER 매출처 · BOTH 둘 다' }) @IsIn(PARTY_KINDS as unknown as string[]) kind!: string;
  @ApiProperty({ example: '(주)사무용품' }) @IsString() @Length(1, 120) name!: string;
  @ApiPropertyOptional({ example: '1234567890', description: '사업자등록번호(- 빼도 됨)' }) @IsOptional() @IsString() @Length(0, 14) bizNo?: string;
  @ApiPropertyOptional({ example: '김담당' }) @IsOptional() @IsString() @Length(0, 40) contactName?: string;
  @ApiPropertyOptional({ example: '02-123-4567' }) @IsOptional() @IsString() @Length(0, 20) contactPhone?: string;
  @ApiPropertyOptional({ example: 'tax@example.com' }) @IsOptional() @IsString() @Length(0, 120) contactEmail?: string;
  @ApiPropertyOptional({ example: '국민은행' }) @IsOptional() @IsString() @Length(0, 20) bankName?: string;
  @ApiPropertyOptional({ example: '1234', description: '계좌 끝 4자리만' }) @IsOptional() @IsString() @Length(0, 4) accountLast4?: string;
  @ApiPropertyOptional({ format: 'uuid', description: '광고주 연결' }) @IsOptional() @IsString() @Length(0, 36) advertiserId?: string;
  @ApiPropertyOptional({ format: 'uuid', description: '입점 판매자 연결' }) @IsOptional() @IsString() @Length(0, 36) sellerId?: string;
  @ApiPropertyOptional({ example: '월말 정산' }) @IsOptional() @IsString() @Length(0, 400) memo?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'CLOSED'], description: '고칠 때만 — CLOSED 닫기' }) @IsOptional() @IsIn(['ACTIVE', 'CLOSED']) state?: string;
}

/* ── ⑯ contracts.ctrl.ts ── */
export class AcctContractDto {
  @ApiPropertyOptional({ example: '1', description: '거래처 번호(v10.408)' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) partyId?: string;
  @ApiProperty({ example: '사무실 임대' }) @IsString() @Length(2, 100) title!: string;
  @ApiProperty({ enum: CONTRACT_KINDS }) @IsIn(CONTRACT_KINDS as unknown as string[]) kind!: string;
  @ApiProperty({ example: '2026-11-01' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) startOn!: string;
  @ApiPropertyOptional({ example: '2027-10-31', description: '비우면 기한 없음' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) endOn?: string;
  @ApiPropertyOptional({ description: '자동 갱신' }) @IsOptional() @StrictBoolean() autoRenew?: boolean;
  @ApiPropertyOptional({ example: 30, description: '만기 며칠 전부터 알림(1 ~ 180)' }) @IsOptional() @IsInt() @Min(1) @Max(180) noticeDays?: number;
  @ApiPropertyOptional({ example: 1100000, description: '달 금액(부가세 포함 · 0 이면 예정 없음)' }) @IsOptional() @IsInt() @Min(0) @Max(10_000_000_000) monthlyAmount?: number;
  @ApiPropertyOptional({ example: 25, description: '낼 날(1 ~ 28 · 달 금액이 있으면 필수)' }) @IsOptional() @IsInt() @Min(1) @Max(28) payDay?: number;
  @ApiPropertyOptional({ type: [String], description: `계약서 파일 id(ACCT_EVIDENCE · ${CONTRACT_MAX_FILES}개까지)` }) @IsOptional() @IsArray() @ArrayMaxSize(CONTRACT_MAX_FILES) @IsString({ each: true }) attachments?: string[];
  @ApiPropertyOptional({ example: '보증금 1천만 원' }) @IsOptional() @IsString() @Length(0, 400) memo?: string;
}
export class AcctContractRenewDto {
  @ApiProperty({ example: '2028-10-31' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) endOn!: string;
  @ApiProperty({ example: '1년 연장 합의' }) @IsString() @Length(1, 400) reason!: string;
}
export class AcctContractEndDto {
  @ApiProperty({ example: '해지 통보' }) @IsString() @Length(1, 400) reason!: string;
}

/* ── ⑯ requisitions.ctrl.ts ── */
export class ReqAddDto {
  @ApiProperty({ example: '노트북 구입' }) @IsString() @Length(2, 100) title!: string;
  @ApiProperty({ example: 1650000 }) @IsInt() @Min(1) @Max(10_000_000_000) amount!: number;
  @ApiProperty({ example: 'EXP_SUPPLIES', description: '비용 · 자산 계정' }) @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,39}$/) accountRole!: string;
  @ApiProperty({ example: '신입 운영자 업무용' }) @IsString() @Length(2, 400) reason!: string;
  @ApiPropertyOptional({ example: '2026-11-25' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) neededOn?: string;
}
export class ReqDecideDto {
  @ApiProperty({ description: 'true 승인 · false 반려' }) @StrictBoolean() approve!: boolean;
  @ApiPropertyOptional({ example: '예산 안', description: '반려면 사유(2 ~ 200자) 필수' }) @IsOptional() @IsString() @Length(0, 400) note?: string;
}
export class ReqUseDto {
  @ApiProperty({ enum: ['PURCHASE', 'EXPENSE'] }) @IsIn(['PURCHASE', 'EXPENSE']) kind!: string;
  @ApiProperty({ example: '12', description: '매입 · 경비 청구 번호' }) @IsString() @Matches(/^\d{1,18}$/) refId!: string;
}

/* ── ⑯ imports.ctrl.ts ── */
export class ImportLineDto {
  @ApiProperty({ format: 'uuid', description: '직판 상품 옵션' }) @IsString() @Length(36, 36) optionId!: string;
  @ApiProperty({ example: 100 }) @IsInt() @Min(1) @Max(1_000_000) qty!: number;
  @ApiProperty({ example: 1250.5, description: '외화 금액(줄 합계)' }) @IsNumber() @Min(0) @Max(1_000_000_000) foreignAmount!: number;
}
export class ImportAddDto {
  @ApiPropertyOptional({ example: '1', description: '거래처(v10.408)' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) partyId?: string;
  @ApiProperty({ example: '11월 콜라겐 원료 수입' }) @IsString() @Length(2, 100) title!: string;
  @ApiPropertyOptional({ example: 'USD' }) @IsOptional() @IsString() @Matches(/^[A-Za-z]{3}$/) currency?: string;
  @ApiProperty({ example: '2026-11-19' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) orderedOn!: string;
  @ApiPropertyOptional({ example: 'FOB 부산' }) @IsOptional() @IsString() @Length(0, 400) memo?: string;
  @ApiProperty({ type: [ImportLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ImportLineDto) lines!: ImportLineDto[];
}
export class ImportAdvanceDto {
  @ApiProperty({ enum: IMPORT_STATES, description: 'SHIPPED 선적 · CUSTOMS 통관 · RECEIVED 입고' }) @IsIn(IMPORT_STATES as unknown as string[]) to!: string;
  @ApiProperty({ example: '2026-11-25', description: '그 단계 날짜(오늘까지)' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @ApiPropertyOptional({ example: 'BL123456' }) @IsOptional() @IsString() @Length(0, 40) blNo?: string;
  @ApiPropertyOptional({ example: 1385.2, description: '통관 — 과세 환율' }) @IsOptional() @IsNumber() @Min(0) @Max(100000) fxRate?: number;
  @ApiPropertyOptional({ example: 120000, description: '통관 — 관세' }) @IsOptional() @IsInt() @Min(0) @Max(10_000_000_000) duty?: number;
  @ApiPropertyOptional({ example: 185000, description: '통관 — 수입 부가세' }) @IsOptional() @IsInt() @Min(0) @Max(10_000_000_000) importVat?: number;
  @ApiPropertyOptional({ example: '○○관세사무소' }) @IsOptional() @IsString() @Length(0, 60) brokerName?: string;
  @ApiPropertyOptional({ example: '12345-26-123456M', description: '수입신고번호' }) @IsOptional() @IsString() @Length(0, 40) declNo?: string;
  @ApiPropertyOptional({ example: 300000, description: '입고 — 운임' }) @IsOptional() @IsInt() @Min(0) @Max(10_000_000_000) freight?: number;
  @ApiPropertyOptional({ example: 50000, description: '입고 — 기타 비용(보험 · 창고 · 통관 수수료)' }) @IsOptional() @IsInt() @Min(0) @Max(10_000_000_000) otherCost?: number;
  @ApiPropertyOptional({ type: [ImportLineDto], description: '선적 — 실제 수량 · 금액으로 품목 바꾸기' }) @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ImportLineDto) lines?: ImportLineDto[];
}
export class ImportCancelDto {
  @ApiProperty({ example: '발주 취소' }) @IsString() @Length(1, 400) reason!: string;
}
/* ── v10.432 (D255) 매입 세금계산서 가져오기 ── */
export class TaxInboxFetchDto {
  @ApiPropertyOptional({ example: '2026-11-13', description: '시작일(비우면 끝일 6일 전)' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @ApiPropertyOptional({ example: '2026-11-19', description: '끝일(비우면 오늘 · 31일까지)' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}
export class TaxInboxBookDto {
  @ApiProperty({ example: 'EXP_SUPPLIES', description: '비용 · 자산 계정 역할' }) @IsString() @Matches(/^[A-Z][A-Z_]{1,39}$/) accountRole!: string;
  @ApiProperty({ enum: ['CASH', 'AP', 'CARD_AP'], description: '낸 방법' }) @IsIn(['CASH', 'AP', 'CARD_AP']) payRole!: string;
  @ApiPropertyOptional({ example: '11월 사무용품' }) @IsOptional() @IsString() @Length(0, 400) memo?: string;
  @ApiPropertyOptional({ description: '같은 공급자 · 날짜 · 합계 매입이 있어도 넘기기' }) @IsOptional() @StrictBoolean() force?: boolean;
  @ApiPropertyOptional({ example: '12', description: '붙일 품의 번호(v10.417)' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) requisitionId?: string;
}
export class TaxInboxIgnoreDto {
  @ApiProperty({ example: '대표 개인 카드 매입' }) @IsString() @Length(1, 400) note!: string;
}

/* ── ㉑ d254.ctrl.ts ── */
export class ExportLineDto {
  @ApiPropertyOptional({ format: 'uuid', description: '직판 상품 옵션(있으면 선적 때 재고 출고)' }) @IsOptional() @IsString() @Length(36, 36) optionId?: string;
  @ApiPropertyOptional({ example: '건강음료 세트', description: '옵션이 없으면 품목 이름(2 ~ 100자)' }) @IsOptional() @IsString() @Length(0, 100) item?: string;
  @ApiProperty({ example: 10 }) @IsInt() @Min(1) @Max(1000000) qty!: number;
  @ApiProperty({ example: 1500.5, description: '외화 금액(소수 둘째 자리)' }) @IsNumber() @Min(0) @Max(1000000000) foreignAmount!: number;
}
export class ExportAddDto {
  @ApiPropertyOptional({ example: '12' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) partyId?: string;
  @ApiProperty({ example: '미국 A사 11월 주문' }) @IsString() @Length(2, 100) title!: string;
  @ApiPropertyOptional({ example: 'USD' }) @IsOptional() @IsString() @Matches(/^[A-Za-z]{3}$/) currency?: string;
  @ApiPropertyOptional({ example: 'FOB' }) @IsOptional() @IsString() @Matches(/^([A-Za-z]{3})?$/) incoterms?: string;
  @ApiProperty({ example: '2026-11-20' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) orderedOn!: string;
  @ApiPropertyOptional({ example: '부산항 · 30일 후 송금' }) @IsOptional() @IsString() @Length(0, 200) memo?: string;
  @ApiProperty({ type: [ExportLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ExportLineDto) lines!: ExportLineDto[];
}
export class ExportAdvanceDto {
  @ApiProperty({ enum: EXPORT_STATES.slice(1) }) @IsIn(EXPORT_STATES.slice(1) as unknown as string[]) to!: string;
  @ApiProperty({ example: '2026-11-25' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @ApiPropertyOptional({ example: 1385.2, description: '선적일 환율(원 · 외화 1단위) — 선적 때 꼭' }) @IsOptional() @IsNumber() @Min(0) @Max(100000) fxRate?: number;
  @ApiPropertyOptional({ example: 'BL123456' }) @IsOptional() @IsString() @Length(0, 40) blNo?: string;
  @ApiPropertyOptional({ example: '12345-26-123456X', description: '수출신고번호 — 수출신고 수리 때 꼭(영세율 근거)' }) @IsOptional() @IsString() @Length(0, 40) declNo?: string;
  @ApiPropertyOptional({ example: 13852000, description: '통장에 들어온 원화 — 대금 회수 때 꼭' }) @IsOptional() @IsInt() @Min(1) @Max(100000000000) paidKrw?: number;
}
export class TradeCancelDto {
  @ApiProperty({ example: '주문 취소' }) @IsString() @Length(1, 400) reason!: string;
}
export class PoLineDto {
  @ApiPropertyOptional({ format: 'uuid', description: '직판 상품 옵션(있으면 입고 때 재고 입고)' }) @IsOptional() @IsString() @Length(36, 36) optionId?: string;
  @ApiPropertyOptional({ example: '포장 상자', description: '옵션이 없으면 품목 이름(2 ~ 100자)' }) @IsOptional() @IsString() @Length(0, 100) item?: string;
  @ApiProperty({ example: 100 }) @IsInt() @Min(1) @Max(1000000) qty!: number;
  @ApiProperty({ example: 1200, description: '단가(공급가 · 원)' }) @IsInt() @Min(0) @Max(10000000000) unitPrice!: number;
}
export class PoAddDto {
  @ApiProperty({ example: '3', description: '매입처(거래처 대장)' }) @IsString() @Matches(/^\d{1,18}$/) partyId!: string;
  @ApiProperty({ example: '11월 포장재' }) @IsString() @Length(2, 100) title!: string;
  @ApiProperty({ example: '2026-11-20' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) orderedOn!: string;
  @ApiPropertyOptional({ example: '납기 11/27' }) @IsOptional() @IsString() @Length(0, 200) memo?: string;
  @ApiPropertyOptional({ example: '5', description: '붙일 품의(승인)' }) @IsOptional() @IsString() @Matches(/^\d{1,18}$/) requisitionId?: string;
  @ApiProperty({ type: [PoLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => PoLineDto) lines!: PoLineDto[];
}
export class PoReceiveDto {
  @ApiProperty({ example: '2026-11-27' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @ApiPropertyOptional({ enum: ['TAX_INVOICE', 'CARD', 'CASH', 'SIMPLE'] }) @IsOptional() @IsIn(['TAX_INVOICE', 'CARD', 'CASH', 'SIMPLE']) kind?: string;
  @ApiPropertyOptional({ example: 12000, description: '부가세(비우면 공급가의 10% · 간이영수증 0)' }) @IsOptional() @IsInt() @Min(0) @Max(10000000000) vat?: number;
  @ApiPropertyOptional({ description: '부가세 공제(처음 예)' }) @IsOptional() @StrictBoolean() deductible?: boolean;
  @ApiPropertyOptional({ example: 'INVENTORY', description: '계정(비우면 모두 직판 옵션이면 상품 · 아니면 소모품비)' }) @IsOptional() @IsString() @Matches(/^[A-Z][A-Z_]{1,39}$/) accountRole?: string;
  @ApiPropertyOptional({ enum: ['CASH', 'AP', 'CARD_AP'] }) @IsOptional() @IsIn(['CASH', 'AP', 'CARD_AP']) payRole?: string;
  @ApiPropertyOptional({ type: [String], description: '증빙 파일(ACCT_EVIDENCE)' }) @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) attachments?: string[];
}

const reasonOk = (r: string, code: string) => {
  const t = (r ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 200) throw new PolicyViolation(code, '사유는 2 ~ 200자입니다.');
  return t;
};
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
};
export const toCsv = (head: string[], rows: unknown[][]) => '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const kstYm = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 7);
const EV_KO: Record<string, string> = { TAX_INVOICE: '세금계산서', CARD_PG: '카드 · PG', CASH: '현금영수증', NONE: '', CARD: '법인카드', SIMPLE: '간이영수증' };

@ApiTags('ADM')
@ApiBearerAuth()
@Controller('api/v1/admin/acct')
@ApiResponse({ status: 403, description: '권한 없음', type: ErrorDto })
export class AcctController {
  constructor(private readonly db: DatabaseService) {}

  /* ── v10.381 계정 · 규칙 ── */
  @Get('accounts')
  @Roles(...VIEW)
  @ApiOperation({ summary: '회계 계정 · 전표 규칙 (v10.381)', description: '계정(역할 · 이름 · 회계 프로그램 코드) · 돈 흐름별 전표 줄 모양(11,000원 예) · 설정(acct.*) · 고칠 수 있는가(SUPER). 규칙은 초안(세무사 확인).' })
  @ApiOkResponse({ type: Object })
  async accounts() {
    const settings = await this.db.query<{ key: string; value: string }>(`SELECT key, value FROM erp_site_settings WHERE key LIKE 'acct.%' ORDER BY key`);
    const v = await rulesView(this.db, ALL_SOURCES);   // v10.392 — 바꾼 규칙 · 계정 자리 · 바꾼 기록 · 계정 초안 표시
    return { ...v, settings, canEdit: (RequestCtx.get()?.actorRole ?? '') === 'SUPER',
             note: '전표 규칙 · 계정 코드는 초안입니다 — 세무사 확인 뒤 계정 코드 · 계정 자리 · 증빙을 고치십시오(금액 계산은 고정 · 바꾼 다음 전표부터).' };
  }

  @Post('accounts')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_ACCOUNT_ADD', 'SETTING')
  @ApiOperation({ summary: '회계 계정 더하기 (v10.392 · SUPER)', description: '역할 U_ 로 시작 · 종류(자산 · 부채 · 매출 · 비용) · 회계 프로그램 코드 · 이름. 규칙의 같은 종류 계정 자리에 고를 수 있습니다. 지우지 않습니다.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_ACCOUNT · ACCT_ACCOUNT_DUP · ACCT_REASON' })
  addAccount(@Body() dto: AcctAccountAddDto) { return addAccount(this.db, dto); }

  @Patch('rules/:source')
  @Roles('SUPER')
  @Audit('ACCT_RULE_SET', 'SETTING')
  @ApiParam({ name: 'source', example: 'SUB_PAID' })
  @ApiOperation({ summary: '전표 규칙 고치기 (v10.392 · SUPER)', description: '돈 흐름의 계정 자리를 같은 종류 다른 계정으로 · 증빙 바꾸기. 금액 계산은 고정. 바꾼 다음 전표부터(지난 전표는 그대로) · 바꾼 기록(acct_rule_changes).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_RULE · ACCT_RULE_KIND · ACCT_REASON' })
  setRule(@Param('source') source: string, @Body() dto: AcctRuleDto) { return setRule(this.db, ALL_SOURCES, source, dto, RequestCtx.actorId() ?? null); }

  @Get('rules/sheet')
  @Roles(...VIEW)
  @ApiQuery({ name: 'csv', required: false, example: '1' })
  @ApiOperation({ summary: '전표 규칙 확인표 (v10.392)', description: '모든 규칙을 예시 금액(11,000원) 전표 · 계정 코드 · 초안 여부로 한 장. csv=1 이면 CSV 글자(세무사 확인용 · 개인정보 없음).' })
  @ApiOkResponse({ type: Object })
  async ruleSheet(@Query('csv') csv?: string) {
    const r = await ruleSheet(this.db, ALL_SOURCES);
    return csv === '1' ? { ...r, csv: toCsv(r.head, r.rows), filename: `전표규칙_확인표_${kstYm()}.csv` } : r;
  }

  @Patch('accounts/:role')
  @Roles('SUPER')
  @Audit('ACCT_ACCOUNT_SET', 'SETTING')
  @ApiParam({ name: 'role', example: 'REV_SUB' })
  @ApiOperation({ summary: '회계 계정 코드 고치기 (v10.381 · SUPER)', description: '회계 프로그램 계정 코드 · 이름만. 이미 만든 전표의 줄은 역할로 남아 있어 내려받을 때 새 코드로 나갑니다.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_REASON' })
  async setAccount(@Param('role') role: string, @Body() dto: AcctAccountDto) {
    reasonOk(dto.reason, 'ACCT_REASON');
    const r = await this.db.query(
      `UPDATE acct_accounts SET ext_code = nullif($2, ''), ext_name = nullif($3, ''), updated_by = $4, updated_at = now() WHERE role = $1 RETURNING role`,
      [role, (dto.extCode ?? '').trim(), (dto.extName ?? '').trim(), RequestCtx.actorId() ?? null]);
    if (!r.length) throw new NotFound('없는 계정입니다.');
    return { ok: true, role, note: '계정 코드를 고쳤습니다 — 다음 내려받기부터 새 코드로 나갑니다.' };
  }

  @Get('products')
  @Roles('ADMIN', 'SUPER', 'PAYOUT')
  @ApiOperation({ summary: '직판 상품 과세 · 면세 (v10.383)', description: '소개몰 직판(DIRECT) 상품 — 코드 · 이름 · 상태 · 과세 · 면세. 입점 상품은 판매자 매출이라 빠짐.' })
  @ApiOkResponse({ type: Object })
  async products() {
    const items = await this.db.query(
      `SELECT p.code, p.name, p.status, p.tax_type AS "taxType" FROM svc.hlt_products p JOIN svc.hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT'
        ORDER BY (p.tax_type = 'EXEMPT') DESC, p.status, p.name LIMIT 300`);
    return { items, exempt: items.filter((x: any) => x.taxType === 'EXEMPT').length };
  }

  @Patch('products/:code/tax-type')
  @Roles('ADMIN', 'SUPER')
  @Audit('PRODUCT_TAX_TYPE', 'SETTING')
  @ApiParam({ name: 'code', example: 'P-0001' })
  @ApiOperation({ summary: '상품 과세 · 면세 고르기 (v10.383)', description: '직판 상품만 · 다음 주문부터(지난 주문 줄은 주문 때 값 그대로) · 사유 · 감사 PRODUCT_TAX_TYPE.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 없거나 직판 상품이 아님' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_REASON' })
  async setTaxType(@Param('code') code: string, @Body() dto: TaxTypeDto) {
    reasonOk(dto.reason, 'ACCT_REASON');
    /* e3.5 손 고침(docs/011 4절 예외 목록 1) — ERP 는 소개뱅크 표에 쓰지 않음 → 소개뱅크 내부 API(같은 SQL · 감사 · 404 그대로) */
    sgbOk(await sgb.post('/internal/erp/products/tax-type', { code, taxType: dto.taxType, reason: dto.reason, actorId: RequestCtx.actorId() }));
    return { ok: true, code, taxType: dto.taxType, note: dto.taxType === 'EXEMPT' ? '면세로 바꿨습니다 — 다음 주문부터 부가세를 나누지 않습니다.' : '과세로 바꿨습니다 — 다음 주문부터 부가세를 나눕니다.' };
  }

  /* ── v10.382 전표 · 마감 ── */
  @Get('journal')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '그 달 전표 (v10.382)', description: '전표(최근 300장 · 줄 포함) · 계정별 차변 · 대변 합 · 돈 흐름별 장 수 · 마감 여부 · 늦게 들어온 전표 수. 비우면 이번 달(한국).' })
  @ApiOkResponse({ type: Object })
  async journal(@Query('ym') ymQ?: string) {
    const ym = ymQ && YM.test(ymQ) ? ymQ : kstYm();
    const entries = await this.db.query(
      `SELECT e.id::text AS id, e.entry_date::text AS date, e.source, e.source_key AS "sourceKey", e.memo, e.party, e.evidence, e.late,
              (SELECT json_agg(json_build_object('role', l.role, 'debit', l.debit, 'credit', l.credit) ORDER BY l.id) FROM acct_lines l WHERE l.entry_id = e.id) AS lines
         FROM acct_entries e WHERE e.ym = $1 ORDER BY e.entry_date DESC, e.id DESC LIMIT 300`, [ym]);
    const byRole = await this.db.query(
      `SELECT l.role, a.name, a.ext_code AS "extCode", sum(l.debit)::bigint AS debit, sum(l.credit)::bigint AS credit
         FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id JOIN acct_accounts a ON a.role = l.role
        WHERE e.ym = $1 GROUP BY l.role, a.name, a.ext_code, a.sort ORDER BY a.sort`, [ym]);
    const [t] = await this.db.query<{ n: number; late: number; d: string; c: string }>(
      `SELECT count(DISTINCT e.id)::int AS n, count(DISTINCT e.id) FILTER (WHERE e.late)::int AS late, coalesce(sum(l.debit), 0)::text AS d, coalesce(sum(l.credit), 0)::text AS c
         FROM acct_entries e LEFT JOIN acct_lines l ON l.entry_id = e.id WHERE e.ym = $1`, [ym]);
    const bySource = await this.db.query(`SELECT source, count(*)::int AS n FROM acct_entries WHERE ym = $1 GROUP BY source ORDER BY source`, [ym]);
    const [cl] = await this.db.query(`SELECT ym, entries, debit_sum::text AS "debitSum", note, closed_at AS "closedAt" FROM acct_closings WHERE ym = $1`, [ym]);
    return { ym, entries, byRole, bySource, total: { entries: Number(t?.n ?? 0), late: Number(t?.late ?? 0), debit: Number(t?.d ?? 0), credit: Number(t?.c ?? 0) }, closing: cl ?? null };
  }

  @Post('journal/run')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '지금 전표 만들기 (v10.382 · SUPER)', description: '정기 작업 acct_journal 과 같음 — 아직 전표가 없는 돈 흐름만(같은 근거는 한 번).' })
  @ApiOkResponse({ type: Object })
  run() { return runJournal(this.db, ALL_SOURCES); }

  @Get('journal/export')
  @Roles(...VIEW)
  @ExportGate('ACCT_JOURNAL')
  @ApiQuery({ name: 'ym', required: true, example: '2026-11' })
  @ApiQuery({ name: 'format', required: false, example: '1', description: 'v10.389 양식 번호(비우면 기본 양식)' })
  @ApiOperation({ summary: '전표 CSV (v10.382 · 내려받기 승인)', description: '회계 프로그램 올리기용 일반 양식 — 일자 · 전표번호 · 줄 · 계정코드 · 계정명 · 차변 · 대변 · 거래처 · 적요 · 증빙 · 근거. 엑셀에서 열림(UTF-8 BOM). 대표 회계 프로그램 양식은 양식 파일을 받은 뒤 맞춤.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL · ACCT_YM' })
  async export(@Query('ym') ym: string, @Query('format') format?: string) {
    if (!YM.test(ym ?? '')) throw new PolicyViolation('ACCT_YM', '달은 YYYY-MM 으로 적어 주십시오.');
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT e.entry_date::text AS date, e.id::text AS no, row_number() OVER (PARTITION BY e.id ORDER BY l.id)::int AS line,
              coalesce(a.ext_code, '') AS code, coalesce(a.ext_name, a.name) AS name, l.debit, l.credit, coalesce(e.party, '') AS party, coalesce(e.memo, '') AS memo,
              e.evidence, e.source || ':' || e.source_key AS src
         FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id JOIN acct_accounts a ON a.role = l.role
        WHERE e.ym = $1 ORDER BY e.entry_date, e.id, l.id`, [ym]);
    /* v10.389 (D244 · docs/526) — 고른 양식(비우면 기본 · 처음 기본은 「일반 양식」 = 전과 같은 칸) */
    const f = await pickFormat(this.db, format && /^\d{1,9}$/.test(format) ? format : undefined);
    const { head, body } = renderRows(f, rows, EV_KO);
    const csv = f.header ? toCsv(head, body) : toCsv((body[0] ?? []).map(String), body.slice(1));
    return { filename: `journal-${ym}.csv`, csv, rows: rows.length, format: { id: f.id, name: f.name }, note: `${ym} 전표 ${rows.length}줄을 「${f.name}」 양식으로 내려받았습니다.` };
  }

  @Get('closings')
  @Roles(...VIEW)
  @ApiOperation({ summary: '월 마감 목록 (v10.382)', description: '마감한 달(전표 수 · 차변 합 · 메모 · 때) 최근 24.' })
  @ApiOkResponse({ type: Object })
  async closings() {
    const items = await this.db.query(`SELECT ym, entries, debit_sum::text AS "debitSum", note, closed_at AS "closedAt" FROM acct_closings ORDER BY ym DESC LIMIT 24`);
    return { items, current: kstYm() };
  }

  @Post('closings')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('ACCT_CLOSE', 'SETTING')
  @ApiOperation({ summary: '월 마감 (v10.382 · SUPER)', description: '이번 달 전 · 한 번 · 마감 전에 전표를 한 번 더 만듦. 마감한 달에는 전표가 들어가지 않고, 늦게 온 돈 흐름은 오늘 날짜(late)로 들어갑니다.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_CLOSED — 이미 마감' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_CLOSE_FUTURE — 이번 달 · 다음 달' })
  async close(@Body() dto: AcctCloseDto) {
    if (dto.ym >= kstYm()) throw new PolicyViolation('ACCT_CLOSE_FUTURE', '이번 달과 앞으로의 달은 마감할 수 없습니다(달이 끝난 뒤).');
    const [had] = await this.db.query(`SELECT 1 FROM acct_closings WHERE ym = $1`, [dto.ym]);
    if (had) throw new AppError(409, { code: 'ACCT_CLOSED', message: '이미 마감한 달입니다.' });
    const made = await runJournal(this.db, ALL_SOURCES);
    const [r] = await this.db.query<{ n: number; d: string }>(
      `INSERT INTO acct_closings (ym, entries, debit_sum, note, closed_by)
       SELECT $1, count(DISTINCT e.id)::int, coalesce(sum(l.debit), 0), nullif($2, ''), $3
         FROM acct_entries e LEFT JOIN acct_lines l ON l.entry_id = e.id WHERE e.ym = $1
       RETURNING entries AS n, debit_sum::text AS d`, [dto.ym, (dto.note ?? '').trim().slice(0, 200), RequestCtx.actorId() ?? null]);
    return { ok: true, ym: dto.ym, entries: Number(r?.n ?? 0), debitSum: Number(r?.d ?? 0), madeNow: made.total, note: `${dto.ym} 을 마감했습니다 — 전표 ${Number(r?.n ?? 0)}장.` };
  }

  /* ── v10.383 신고 자료 ── */
  @Get('tax/vat')
  @Roles(...VIEW)
  @ApiQuery({ name: 'q', required: false, example: '2026-4', description: '해 · 분기(YYYY-1 ~ 4) · 비우면 이번 분기' })
  @ApiOperation({ summary: '부가세 신고 자료 (v10.383)', description: '분기 전표에서 — 증빙(세금계산서 · 카드 · PG · 증빙 없음)별 과세 공급가 · 세액 · 면세 매출 · 돈 흐름별. 신고서 칸 이름은 세무사 확인.' })
  @ApiOkResponse({ type: Object })
  vat(@Query('q') q?: string) { return vatSummary(this.db, q); }

  @Get('tax/withholding')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '원천세 신고 자료 (v10.383)', description: '그 달 지급한 포인트 출금(사업소득) — 사람 수 · 지급액 · 소득세 · 지방소득세 · 실지급 · 올해 누계. 사람별 자료(주민등록번호)는 지급 › 「신고 자료」 CSV.' })
  @ApiOkResponse({ type: Object })
  withholding(@Query('ym') ym?: string) { return withholdingSummary(this.db, ym && YM.test(ym) ? ym : kstYm()); }

  @Get('tax/invoices')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '세금계산서 발행 대상 (v10.383)', description: '그 달 발행해야 할 것 — 정액 노출 · 리드 캐시(지금은 사용 월 합 — 충전 때 발행은 ⑩) · 광고 청구 · 입점 수수료 · 발행함 / 아직 · 간주(간주 모드) · 번호. 발행은 각 화면(정액 노출 · 리드 캐시는 전자세금계산서 · 간주).' })
  @ApiOkResponse({ type: Object })
  invoices(@Query('ym') ym?: string) { return taxInvoices(this.db, ym && YM.test(ym) ? ym : kstYm()); }

  @Get('tax/export')
  @Roles(...VIEW)
  @ExportGate('ACCT_TAX')
  @ApiQuery({ name: 'kind', required: true, enum: ['VAT', 'WHT_YEAR'] })
  @ApiQuery({ name: 'period', required: true, example: '2026-4', description: 'VAT 는 YYYY-분기 · WHT_YEAR 는 YYYY' })
  @ApiOperation({ summary: '신고 자료 CSV (v10.383 · 내려받기 승인)', description: 'VAT — 분기 전표 줄(증빙 · 공급가 · 세액 · 면세) / WHT_YEAR — 올해 사람별 포인트 출금 합(이름 · 가린 이메일 · 건수 · 지급액 · 소득세 · 지방소득세 · 실지급 · 지급명세서 자료). 주민등록번호는 지급 › 「신고 자료」.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL · ACCT_PERIOD' })
  async taxExport(@Query('kind') kind: string, @Query('period') period: string) {
    if (kind === 'VAT') {
      const v = await vatSummary(this.db, period);
      if (!v.ok) throw new PolicyViolation('ACCT_PERIOD', '분기는 YYYY-1 ~ YYYY-4 로 적어 주십시오.');
      const csv = toCsv(['분기', '증빙', '돈 흐름', '과세 공급가', '세액', '면세 매출', '전표 수'],
        v.rows.map((r) => [v.q, r.evidenceKo, r.label, r.supply, r.vat, r.exempt, r.entries]));
      return { filename: `vat-${v.q}.csv`, csv, rows: v.rows.length, note: `${v.q} 분기 부가세 자료를 내려받았습니다.` };
    }
    if (kind === 'WHT_YEAR' && /^\d{4}$/.test(period ?? '')) {
      const rows = await this.db.query<Record<string, unknown>>(
        `SELECT coalesce(c.holder_name, a.name) AS name, a.email::text AS email, count(*)::int AS n, sum(c.points)::bigint AS gross,
                sum(c.income_tax)::bigint AS it, sum(c.local_tax)::bigint AS lt, sum(c.net_amount)::bigint AS net
           FROM svc.point_cashouts c JOIN svc.accounts a ON a.id = c.account_id
          WHERE c.status = 'PAID' AND to_char(c.paid_at AT TIME ZONE 'Asia/Seoul', 'YYYY') = $1
          GROUP BY coalesce(c.holder_name, a.name), a.email ORDER BY gross DESC`, [period]);
      const mask = (e: unknown) => String(e ?? '').replace(/^(.{2}).*(@.*)$/, '$1***$2');
      const csv = toCsv(['해', '이름', '이메일(가림)', '건수', '지급액', '소득세', '지방소득세', '실지급'],
        rows.map((r) => [period, r.name, mask(r.email), r.n, r.gross, r.it, r.lt, r.net]));
      return { filename: `withholding-${period}.csv`, csv, rows: rows.length, note: `${period} 원천세(사람별 합) 자료를 내려받았습니다.` };
    }
    throw new PolicyViolation('ACCT_PERIOD', '종류(VAT · WHT_YEAR)와 기간을 확인해 주십시오.');
  }

  /* ── v10.384 경영 보고서 ── */
  @Get('report')
  @Roles(...VIEW)
  @ApiQuery({ name: 'months', required: false, example: 12 })
  @ApiOperation({ summary: '경영 보고서 (v10.384)', description: '전표에서 — 달마다 매출(공급가 · 돈 흐름별) · 비용 · 이익 · 부가세 · 현금 들어옴(PG · 계좌) · 나감 · 지난달 대비. 전표 시작일(acct.start_on) 뒤만.' })
  @ApiOkResponse({ type: Object })
  report(@Query('months') m?: string) { return acctReport(this.db, Math.min(24, Math.max(1, Number(m) || 12))); }

  /* ── v10.388 은행 거래 내역 맞추기 ── */
  @Post('bank/upload')
  @HttpCode(200)
  @Roles(...VIEW)
  @Audit('ACCT_BANK_UPLOAD', 'SETTING')
  @ApiOperation({ summary: '통장 거래 내역 올리기 (v10.388)', description: '인터넷뱅킹 거래내역 CSV(엑셀 저장) 글자 — 머리줄 이름으로 거래일 · 입금 · 출금 · 잔액 · 내용 · 메모 칸을 찾음 · 같은 줄은 한 번 · 못 읽은 줄 수. 크면 기간을 나눠 올림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BANK_CSV_HEAD · BANK_CSV_EMPTY · BANK_CSV_SIZE · BANK_CSV_TOO_MANY' })
  bankUpload(@Body() dto: BankUploadDto) { return uploadBank(this.db, dto.csv, dto.filename ?? null, dto.bank ?? null, RequestCtx.actorId() ?? null); }

  @Get('bank')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '은행 맞추기 (v10.388)', description: '그 달 통장 줄(맞춤 · 맞출 것 없음 · 남음) · 남은 줄의 후보 전표(같은 방향 · 같은 금액 · 날짜 ±acct.bank_match_days · 이름 비슷하면 위) · 장부에만 있는 보통예금 줄 · 마지막 잔액 · 올린 기록.' })
  @ApiOkResponse({ type: Object })
  bank(@Query('ym') ym?: string) { return bankMonth(this.db, ym && YM.test(ym) ? ym : kstYm()); }

  @Post('bank/auto-match')
  @HttpCode(200)
  @Roles(...VIEW)
  @Audit('ACCT_BANK_MATCH', 'SETTING')
  @ApiOperation({ summary: '자동 맞춤 (v10.388)', description: '그 달 남은 줄 중 후보가 하나뿐이고 이름도 같은 줄만 맞춤.' })
  @ApiOkResponse({ type: Object })
  bankAuto(@Body() dto: YmDto) { return bankAutoMatch(this.db, dto.ym, RequestCtx.actorId() ?? null); }

  @Post('bank/:id/match')
  @HttpCode(200)
  @Roles(...VIEW)
  @Audit('ACCT_BANK_MATCH', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '통장 줄 맞춤 (v10.388)', description: 'entryId = 그 전표와 맞춤(같은 금액의 보통예금 줄이 있어야 · 전표당 한 줄) · ignore = 맞출 것 없음(사유) · clear = 풀기(사유).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'BANK_MATCHED · BANK_ENTRY_USED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BANK_REASON · BANK_ENTRY · ACCT_BANK_MISMATCH' })
  bankMatch(@Param('id') id: string, @Body() dto: BankMatchDto) { return bankMatch(this.db, id, dto, RequestCtx.actorId() ?? null); }

  /* ── v10.389 전표 양식 ── */
  @Get('formats')
  @Roles('SUPER', 'PAYOUT', 'ADMIN')
  @ApiOperation({ summary: '전표 CSV 양식 (v10.389)', description: '양식(칸 순서 · 칸 이름 · 날짜 모양 · 차변/대변 표시 · 기본) · 고를 수 있는 칸 · 고칠 수 있는가(SUPER).' })
  @ApiOkResponse({ type: Object })
  async formats() {
    return { items: await listFormats(this.db), fields: FIELDS, dateStyles: DATE_STYLES, canEdit: (RequestCtx.get()?.actorRole ?? '') === 'SUPER',
             note: '회계 프로그램의 올리기 양식 파일을 받으면 칸 순서 · 이름을 그대로 맞춰 기본으로 두십시오.' };
  }

  @Post('formats/preview')
  @HttpCode(200)
  @Roles(...VIEW)
  @ApiOperation({ summary: '양식 미리보기 (v10.389)', description: '보기 전표 1장(3줄 · 실제 전표 아님)을 그 양식으로 — 저장하지 않음.' })
  @ApiOkResponse({ type: Object })
  preview(@Body() dto: AcctFormatDto) {
    const c = checkFormat(dto);
    const f = { id: '0', isDefault: false, header: dto.header !== false, ...c } as never;
    const sample = [
      { date: '2026-11-05', no: '101', line: 1, code: '108', name: '외상매출금', debit: 110000, credit: 0, party: '보기 광고주', memo: '광고 청구', evidence: 'TAX_INVOICE', src: 'AD_INVOICE:보기' },
      { date: '2026-11-05', no: '101', line: 2, code: '404', name: '용역매출', debit: 0, credit: 100000, party: '보기 광고주', memo: '광고 청구', evidence: 'TAX_INVOICE', src: 'AD_INVOICE:보기' },
      { date: '2026-11-05', no: '101', line: 3, code: '255', name: '부가세예수금', debit: 0, credit: 10000, party: '보기 광고주', memo: '광고 청구', evidence: 'TAX_INVOICE', src: 'AD_INVOICE:보기' },
    ];
    const { head, body } = renderRows(f, sample, EV_KO);
    return { head, rows: body, csv: dto.header !== false ? toCsv(head, body) : toCsv((body[0] ?? []).map(String), body.slice(1)) };
  }

  @Post('formats')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('ACCT_FORMAT_SET', 'SETTING')
  @ApiOperation({ summary: '전표 양식 만들기 (v10.389 · SUPER)', description: '이름 · 칸 · 날짜 모양 · 차변/대변 표시 · 기본으로(하나만).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_FORMAT_NAME — 같은 이름' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_FORMAT' })
  async addFormat(@Body() dto: AcctFormatDto) { return this.saveFormat(null, dto); }

  @Patch('formats/:id')
  @Roles('SUPER')
  @Audit('ACCT_FORMAT_SET', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '전표 양식 고치기 (v10.389 · SUPER)', description: '칸 · 이름 · 날짜 모양 · 차변/대변 표시 · 기본으로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_FORMAT' })
  async setFormat(@Param('id') id: string, @Body() dto: AcctFormatDto) {
    if (!/^\d{1,9}$/.test(id ?? '')) throw new NotFound('없는 양식입니다.');
    return this.saveFormat(id, dto);
  }

  private async saveFormat(id: string | null, dto: AcctFormatDto) {
    const c = checkFormat(dto);
    const actor = RequestCtx.actorId() ?? null;
    return this.db.transaction(async () => {
      const [dup] = await this.db.query(`SELECT 1 FROM acct_export_formats WHERE name = $1 AND ($2::bigint IS NULL OR id <> $2::bigint)`, [c.name, id]);
      if (dup) throw new AppError(409, { code: 'ACCT_FORMAT_NAME', message: '같은 이름의 양식이 있습니다.' });
      if (dto.isDefault) await this.db.query(`UPDATE acct_export_formats SET is_default = false WHERE is_default AND ($1::bigint IS NULL OR id <> $1::bigint)`, [id]);
      const args = [c.name, JSON.stringify(c.columns), c.dateStyle, c.dcStyle, c.dcDebit, c.dcCredit, dto.header !== false, actor];
      const [r] = id
        ? await this.db.query<{ id: string }>(
            `UPDATE acct_export_formats SET name = $1, columns = $2::jsonb, date_style = $3, dc_style = $4, dc_debit = $5, dc_credit = $6, header = $7, updated_by = $8, updated_at = now(),
                    is_default = CASE WHEN $10::boolean THEN true ELSE is_default END
              WHERE id = $9::bigint RETURNING id::text AS id`, [...args, id, !!dto.isDefault])
        : await this.db.query<{ id: string }>(
            `INSERT INTO acct_export_formats (name, columns, date_style, dc_style, dc_debit, dc_credit, header, updated_by, is_default)
             VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text AS id`, [...args, !!dto.isDefault]);
      if (!r) throw new NotFound('없는 양식입니다.');
      return { ok: true, id: r.id, note: `양식 「${c.name}」을 저장했습니다${dto.isDefault ? ' — 기본 양식입니다' : ''}.` };
    });
  }

  /* ── v10.390 월 결산 · 신고 기한 ── */
  @Get('month')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '월 결산 요약 (v10.390)', description: '그 달 전표 수 · 매출 · 비용 · 이익 · 부가세 · 원천세 · 현금 · 통장 맞춤 · 세금계산서 남음 · 할 일(전표 실패 · 통장 · 세금계산서 · 마감) · 다가오는 신고 기한.' })
  @ApiOkResponse({ type: Object })
  month(@Query('ym') ym?: string) { return monthSummary(this.db, ym && YM.test(ym) ? ym : kstYm()); }

  @Get('deadlines')
  @Roles(...VIEW)
  @ApiOperation({ summary: '신고 기한 (v10.390)', description: '이번 달 · 다음 달 원천세(10일) · 부가세(acct.vat_months 의 25일) — 주말 · 공휴일이면 다음 영업일 · 남은 날 · 알림 설정.' })
  @ApiOkResponse({ type: Object })
  deadlines() { return deadlines(this.db); }

  /* ── v10.391 세금계산서(광고 청구 · 입점 수수료) ── */
  @Post('tax/invoices/request')
  @HttpCode(200)
  @Roles(...VIEW)
  @Audit('TAXINV_REQUEST', 'INVOICE')
  @ApiOperation({ summary: '세금계산서 발행 요청 (v10.391)', description: '광고 청구(AD · 공급가 · 부가세 그대로) · 입점 수수료(COMMISSION · 수수료 + 수수료 부가세) — 금액 · 공급받는 자를 지금 값으로 고정. 발행은 POST /admin/etax/{ad|commission}/{id}/send(ADMIN · SUPER · 지금은 간주).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TAXINV_REQUESTED · TAXINV_HAS_NO' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TAXINV_NOT_ELIGIBLE' })
  taxInvoiceRequest(@Body() dto: TaxInvoiceRequestDto) { return requestTaxInvoice(this.db, dto.kind, dto.sourceId, RequestCtx.actorId() ?? null); }

  @Post('tax/invoices/:id/cancel')
  @HttpCode(200)
  @Roles(...VIEW)
  @Audit('TAXINV_REQUEST_CANCEL', 'INVOICE')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: '발행 요청 취소 (v10.391)', description: '아직 보내지 않은 요청만(보낸 것은 전자세금계산서 「취소 · 수정 발행」) · 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TAXINV_NOT_CANCELABLE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TAXINV_REASON' })
  taxInvoiceCancel(@Param('id') id: string, @Body() dto: TaxInvoiceCancelDto) { return cancelTaxInvoiceRequest(this.db, id, dto.reason); }

  /* ── ⑫ purchase ── */

  /* ── v10.392 매입 관리 ── */
  @Get('purchases')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '매입 목록 (v10.392)', description: '그 달(발행일) 매입 · 종류 · 공급자 · 공급가 · 부가세 · 공제 · 계정 · 낸 방법 · 증빙 파일 · 전표 번호 · 합계(취소 뺌) · 고를 계정(비용 · 자산).' })
  @ApiOkResponse({ type: Object })
  async purchases(@Query('ym') ym?: string) {
    const m = ym && YM.test(ym) ? ym : kstYm();
    return listPurchases(this.db, m);
  }

  @Post('purchases')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_PURCHASE_ADD', 'SETTING')
  @ApiOperation({ summary: '매입 넣기 (v10.392 · SUPER · PAYOUT)', description: '매입 세금계산서 · 카드 · 현금영수증 · 간이영수증. 금액 · 날짜는 나중에 못 고침(취소 뒤 다시). 전표는 정기 작업이 만듦(차변 비용 · 부가세대급금 / 대변 낸 방법).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PURCHASE_DUP — 같은 공급자 · 날짜 · 합계(force 로 넣음)' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PURCHASE_KIND · PURCHASE_DATE · PURCHASE_SUPPLIER · PURCHASE_BIZNO · PURCHASE_ITEM · PURCHASE_AMOUNT · PURCHASE_SIMPLE_VAT · PURCHASE_ACCOUNT · PURCHASE_PAY · PURCHASE_FILES' })
  async addPurchase(@Body() dto: PurchaseAddDto) {
    return addPurchase(this.db, dto, RequestCtx.actorId() ?? null);
  }

  @Post('purchases/:id/cancel')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_PURCHASE_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '12' })
  @ApiOperation({ summary: '매입 취소 (v10.392 · SUPER · PAYOUT)', description: '사유(2 ~ 200자). 전표가 있었으면 다음 전표 만들기 때 반대 전표(PURCHASE_CANCEL). 취소한 것은 다시 못 고침.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PURCHASE_STATE — 이미 취소함' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PURCHASE_REASON' })
  async cancelPurchase(@Param('id') id: string, @Body() dto: PurchaseCancelDto) {
    return cancelPurchase(this.db, id, dto.reason, RequestCtx.actorId() ?? null);
  }

  @Get('tax/vat-purchase')
  @Roles(...VIEW)
  @ApiQuery({ name: 'q', required: false, example: '2026-4', description: '분기 YYYY-n(비우면 이번 분기)' })
  @ApiOperation({ summary: '부가세 신고 자료 — 매입 쪽 (v10.392)', description: '분기 매입 — 종류별 · 공제 · 불공제 합계 · 매입 세금계산서 공급자(사업자번호)별 합계. 신고서 칸 맞춤은 세무사 확인.' })
  @ApiOkResponse({ type: Object })
  vatPurchase(@Query('q') q?: string) { return purchaseVat(this.db, q); }   // 잘못된 분기는 ok:false(tax/vat 와 같음)

  /* ── ⑫ expense ── */

  /* ── ⑫ v10.393 경비 청구 · 법인카드 ── */
  @Get('expenses')
  @Roles(...STAFF)
  @ApiQuery({ name: 'state', required: false, enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'PAID', 'CANCELED'] })
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '경비 청구 목록 (v10.393)', description: 'SUPER · PAYOUT 은 모두, 나머지 운영자는 자기 청구만 · 비용 계정 · 증빙 종류 · 청구 · 승인(지급 전) 셈 · 승인할 수 있는가(SUPER) · 지급 처리할 수 있는가(PAYOUT).' })
  @ApiOkResponse({ type: Object })
  expenses(@Query('state') state?: string, @Query('ym') ym?: string) {
    return listExpenses(this.db, RequestCtx.actorId() ?? '00000000-0000-0000-0000-000000000000', { state, ym });
  }

  @Post('expenses')
  @Roles(...STAFF)
  @Audit('ACCT_EXPENSE_CREATE', 'SETTING')
  @ApiOperation({ summary: '경비 청구 올리기 (v10.393)', description: '개인 돈으로 쓴 경비 — 쓴 날(오늘까지) · 비용 계정 · 금액(부가세 포함) · 공제 부가세(간이영수증 0) · 증빙 종류 · 내용 · 증빙 파일(ACCT_EVIDENCE · 본인이 올린 것 · 3개).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_EXPENSE_INPUT · ACCT_EXPENSE_ROLE · TOO_MANY_FILES · FILE_INVALID' })
  createExpense(@Body() dto: ExpenseCreateDto) { return createExpense(this.db, dto, RequestCtx.actorId()!); }

  @Post('expenses/:id/decide')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('ACCT_EXPENSE_DECIDE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '경비 승인 · 반려 (v10.393 · SUPER)', description: '청구 상태만 · 본인 청구는 불가(DB 도 막음 EXPENSE_SELF) · 반려는 사유. 승인하면 다음 전표 작업에서 EXPENSE_APPROVED 전표(비용 · 부가세대급금 / 미지급금).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_EXPENSE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPENSE_SELF · ACCT_REASON' })
  decideExpense(@Param('id') id: string, @Body() dto: ExpenseDecideDto) { return decideExpense(this.db, id, dto.decision, dto.reason, RequestCtx.actorId()!); }

  @Post('expenses/:id/paid')
  @HttpCode(200)
  @Roles('PAYOUT')
  @Audit('ACCT_EXPENSE_PAID', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '경비 지급 처리 (v10.393 · PAYOUT)', description: '승인된 것만 · 본인 경비는 불가 · 다음 전표 작업에서 EXPENSE_PAID 전표(미지급금 / 보통예금) — 통장 출금은 은행 맞추기에서 이 전표와 맞춤.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_EXPENSE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPENSE_SELF' })
  payExpense(@Param('id') id: string) { return payExpense(this.db, id, RequestCtx.actorId()!); }

  @Post('expenses/:id/cancel')
  @HttpCode(200)
  @Roles(...STAFF)
  @Audit('ACCT_EXPENSE_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '경비 청구 취소 (v10.393)', description: '본인 청구 · 청구 상태만(승인 · 반려 뒤에는 못 함).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_EXPENSE_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_EXPENSE_OWNER' })
  cancelExpense(@Param('id') id: string) { return cancelExpense(this.db, id, RequestCtx.actorId()!); }

  @Post('cards/upload')
  @HttpCode(200)
  @Roles(...VIEW)
  @Audit('ACCT_CARD_UPLOAD', 'SETTING')
  @ApiOperation({ summary: '법인카드 이용 내역 올리기 (v10.393)', description: '카드사 이용 내역 CSV(엑셀 저장) 글자 — 머리줄 이름으로 이용일 · 가맹점 · 이용 금액 · 승인번호 · 카드번호 · 취소 칸을 찾음 · 같은 줄은 한 번 · 취소는 음수.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'CARD_CSV_HEAD · CARD_CSV_EMPTY · CARD_CSV_SIZE · CARD_CSV_TOO_MANY' })
  cardUpload(@Body() dto: CardUploadDto) { return uploadCard(this.db, dto.csv, dto.filename ?? null, dto.card ?? null, RequestCtx.actorId() ?? null); }

  @Get('cards')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '법인카드 이용 내역 (v10.393)', description: '그 달 카드 이용 줄(남음 · 장부에 넣음 · 넣지 않음) · 셈 · 올린 기록 10 · 미지급금(법인카드) 잔액 · 고를 계정(비용 · 자산).' })
  @ApiOkResponse({ type: Object })
  cards(@Query('ym') ym?: string) { return cardMonth(this.db, ym && YM.test(ym) ? ym : kstYm()); }

  @Post('cards/:id/book')
  @HttpCode(200)
  @Roles(...VIEW)
  @Audit('ACCT_CARD_BOOK', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '카드 이용 장부에 넣기 (v10.393)', description: '계정(비용 · 자산) · 공제 여부(÷ 11) → 다음 전표 작업에서 CARD_TXN 전표(계정 · 부가세대급금 / 미지급금(법인카드)) · 되돌리지 않음. 넣지 않음(ignore)은 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_CARD_BOOKED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_CARD_ROLE · ACCT_REASON' })
  cardBook(@Param('id') id: string, @Body() dto: CardBookDto) { return bookCard(this.db, id, dto, RequestCtx.actorId() ?? null); }

  /* ── ⑫ cashflow ── */
  /* ── v10.394 자금 흐름 ── */
  @Get('cashflow')
  @Roles(...VIEW)
  @ApiQuery({ name: 'days', required: false, example: 90 })
  @ApiOperation({ summary: '자금 흐름 90일 (v10.394)', description: '시작 잔액(직접 넣은 것 · 통장 CSV 마지막 잔액 중 최근) + 확정된 들어올 돈(광고 청구 · PG 정산 · 예정) · 나갈 돈(미지급금 · 법인카드 · 부가세 · 원천세 · 포인트 출금 · 입점 정산 · 예정) · 날마다 잔액 · 가장 낮은 날. 7 ~ 180일.' })
  @ApiOkResponse({ type: Object })
  cashFlowView(@Query('days') days?: string) { return cashflow(this.db, Number(days ?? 90) || 90); }

  @Post('cashflow/balance')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('ACCT_CASH_BALANCE', 'SETTING')
  @ApiOperation({ summary: '잔액 직접 넣기 (v10.394 · SUPER)', description: '그날 끝 통장 잔액(여러 통장이면 합). 쌓기만 — 틀리면 새로 넣음(가장 최근 날짜를 씀).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'CASH_BALANCE' })
  cashBalance(@Body() dto: CashBalanceDto) { return addCashBalance(this.db, dto, RequestCtx.actorId() ?? null); }

  @Get('cashflow/plans')
  @Roles(...VIEW)
  @ApiOperation({ summary: '자금 흐름 예정 · 넣은 잔액 (v10.394)', description: '예정 들고 남(진행 중 먼저 · 취소 포함 300줄) · 직접 넣은 잔액 최근 20줄.' })
  @ApiOkResponse({ type: Object })
  cashPlans() { return listCashPlans(this.db); }

  @Post('cashflow/plans')
  @HttpCode(200)
  @Roles(...VIEW)
  @Audit('ACCT_CASH_PLAN', 'SETTING')
  @ApiOperation({ summary: '예정 들고 남 넣기 (v10.394)', description: '임대료 · 대출 상환 · 투자금처럼 장부에 아직 없는 확정 예정(한 번 · 매달 · 1년 안).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'CASH_PLAN' })
  cashPlanAdd(@Body() dto: CashPlanDto) { return addCashPlan(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('cashflow/plans/:id/cancel')
  @HttpCode(200)
  @Roles(...VIEW)
  @Audit('ACCT_CASH_PLAN_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '예정 취소 (v10.394)', description: '지우지 않고 취소(사유 2 ~ 200자).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'CASH_PLAN' })
  cashPlanCancel(@Param('id') id: string, @Body() dto: CashPlanCancelDto) { return cancelCashPlan(this.db, id, dto.reason, RequestCtx.actorId() ?? null); }

  /* ── ⑫ stock ── */
  /* ── v10.395 직판 재고 수불부 ── */
  @Get('stock')
  @Roles(...VIEW)
  @ApiOperation({ summary: '직판 재고 수불부 (v10.395)', description: '직판 상품 옵션마다 회계용 수량 · 이동평균 단가 · 재고 금액 · 판매용 재고(쇼핑몰)와 차이 · 원가 0 으로 나간 줄 수.' })
  @ApiOkResponse({ type: Object })
  async stock() {
    return stockList(this.db);
  }

  @Get('stock/:code/moves')
  @Roles(...VIEW)
  @ApiParam({ name: 'code', example: 'HB-0001' })
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '직판 상품 수불 (v10.395)', description: '그 상품(옵션 모두)의 그 달 들어옴 · 나감 · 남은 수량 · 금액 · 평균(비우면 이번 달).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  async stockMovesGet(@Param('code') code: string, @Query('ym') ym?: string) {
    const m = ym && YM.test(ym) ? ym : kstYm();
    return stockMoves(this.db, code, m);
  }

  @Post('stock/in')
  @HttpCode(200)
  @Roles('SUPER', 'PAYOUT')
  @Audit('ACCT_STOCK_IN', 'SETTING')
  @ApiOperation({ summary: '직판 재고 입고 (v10.395 · SUPER · PAYOUT)', description: '옵션 · 수량 · 단가(공급가). 평균 단가를 다시 셈. 매입 번호가 있으면 입고 전표 없음(매입 전표가 상품으로), 없으면 전표 「상품 / 미지급금」.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_STOCK' })
  async stockInPost(@Body() dto: StockInDto) {
    return stockIn(this.db, dto, RequestCtx.actorId() ?? null);
  }

  @Post('stock/adjust')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('ACCT_STOCK_ADJUST', 'SETTING')
  @ApiOperation({ summary: '직판 재고 실사 조정 (v10.395 · SUPER)', description: '늘림 + · 줄임 − · 사유. 늘림은 지금 평균 단가(재고가 없으면 단가 입력) · 줄임은 0 아래로 못 감. 전표 「매출원가 ↔ 상품」.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_STOCK · ACCT_REASON' })
  async stockAdjustPost(@Body() dto: StockAdjustDto) {
    const reason = reasonOk(dto.reason, 'ACCT_REASON');
    if (!dto.qty) throw new PolicyViolation('ACCT_STOCK', '조정 수량은 0이 아니어야 합니다.');
    return stockAdjust(this.db, { ...dto, reason }, RequestCtx.actorId() ?? null);
  }

  /* ── ⑬ statements ── */
  @Get('statements/trial')
  @Roles(...VIEW)
  @ApiQuery({ name: 'from', required: false, example: '2026-11-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-11-30' })
  @ApiOperation({ summary: '시산표 (v10.396)', description: '계정마다 기초(시작일 0시) · 기간 차변 · 대변 · 기말 — 확정한 기초 잔액 + 그 뒤 전표. 비우면 올해 1월 1일 ~ 오늘. 차변 합 = 대변 합이면 balanced.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_DATE' })
  trial(@Query('from') from?: string, @Query('to') to?: string) {
    const t = to || kstToday();
    return trialBalance(this.db, from || yearStart(t), t);
  }

  @Get('statements/income')
  @Roles(...VIEW)
  @ApiQuery({ name: 'from', required: false, example: '2026-11-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-11-30' })
  @ApiOperation({ summary: '손익계산서 (v10.396)', description: '기간 매출 · 매출원가 · 매출총이익 · 비용 · 순이익(전표 · 공급가 기준 · 법인세 · 결산 조정 없음). 비우면 올해 1월 1일 ~ 오늘.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_DATE' })
  income(@Query('from') from?: string, @Query('to') to?: string) {
    const t = to || kstToday();
    return incomeStatement(this.db, from || yearStart(t), t);
  }

  @Get('statements/balance')
  @Roles(...VIEW)
  @ApiQuery({ name: 'asOf', required: false, example: '2026-11-30' })
  @ApiOperation({ summary: '재무상태표 (v10.396)', description: '그날 끝 자산 · 부채 · 자본 · 마감 전 손익 · 맞음(balanced) · 기초 잔액이 없으면 경고.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_DATE' })
  balance(@Query('asOf') asOf?: string) { return balanceSheet(this.db, asOf || kstToday()); }

  @Get('opening')
  @Roles(...VIEW)
  @ApiOperation({ summary: '기초 잔액 판 (v10.396)', description: '판(기준일 · DRAFT/FIXED · 차변 · 대변 합) · 줄 · 시작일(acct.start_on).' })
  @ApiOkResponse({ type: Object })
  opening() { return openingList(this.db); }

  @Post('opening')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('ACCT_OPENING_SET', 'SETTING')
  @ApiOperation({ summary: '기초 잔액 판 만들기 (v10.396 · SUPER)', description: '기준일 하나에 판 하나(DRAFT). 줄을 넣고 확정합니다.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_DATE · ACCT_OPENING_DUP' })
  openingNew(@Body() dto: AcctOpeningCreateDto) { return openingCreate(this.db, dto.asOf, dto.note, RequestCtx.actorId() ?? null); }

  @Put('opening/:id/lines')
  @Roles('SUPER')
  @Audit('ACCT_OPENING_SET', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '기초 잔액 줄 저장 (v10.396 · SUPER)', description: 'DRAFT 판의 줄을 통째로 바꿈(계정마다 차변 또는 대변). 차변 ≠ 대변이어도 저장은 되고 확정만 막힙니다.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_OPENING · ACCT_OPENING_FIXED' })
  openingLines(@Param('id') id: string, @Body() dto: AcctOpeningLinesDto) {
    if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 기초 잔액 판입니다.');
    return openingSetLines(this.db, id, dto.lines);
  }

  @Post('opening/:id/fix')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('ACCT_OPENING_FIX', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '기초 잔액 확정 (v10.396 · SUPER)', description: '차변 = 대변이고 줄이 있어야 함(DB 가 확인). 확정 뒤로는 고칠 수 없습니다 — 잘못되면 다른 기준일의 새 판.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_OPENING_FIXED · ACCT_OPENING_UNBALANCED · ACCT_REASON' })
  openingFix(@Param('id') id: string, @Body() dto: AcctOpeningFixDto) {
    reasonOk(dto.reason, 'ACCT_REASON');
    if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 기초 잔액 판입니다.');
    return openingFix(this.db, id, RequestCtx.actorId() ?? null);
  }

  /* ── ⑬ ledger ── */
  @Get('ledger')
  @Roles(...VIEW)
  @ApiQuery({ name: 'role', required: true, example: 'CASH' })
  @ApiQuery({ name: 'from', required: true, example: '2026-11-01' })
  @ApiQuery({ name: 'to', required: true, example: '2026-11-30' })
  @ApiOperation({ summary: '계정별 원장 (v10.397)', description: '계정 하나의 기간 줄(날짜 · 전표 · 근거 · 적요 · 거래처 · 증빙 · 차변 · 대변 · 잔액) · 기초 · 기말 · 1년까지 · 5,000줄까지.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_DATE' })
  ledger(@Query('role') role: string, @Query('from') from?: string, @Query('to') to?: string) { return accountLedger(this.db, String(role ?? ''), from, to); }

  @Get('ledger/export')
  @Roles(...VIEW)
  @ExportGate('ACCT_LEDGER')
  @ApiQuery({ name: 'role', required: true, example: 'CASH' })
  @ApiQuery({ name: 'from', required: true, example: '2026-11-01' })
  @ApiQuery({ name: 'to', required: true, example: '2026-11-30' })
  @ApiOperation({ summary: '계정별 원장 CSV (v10.397 · 내려받기 승인)', description: '원장 줄 + 기초 · 기말 줄 · 거래처 이름이 들어가 승인 필요(ACCT_LEDGER).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL · ACCT_DATE' })
  async ledgerExport(@Query('role') role: string, @Query('from') from?: string, @Query('to') to?: string) {
    const r = await accountLedger(this.db, String(role ?? ''), from, to);
    const { head, body } = ledgerCsv(r);
    return { filename: `ledger-${r.account.role}-${r.from}-${r.to}.csv`, csv: toCsv(head, body), rows: r.rows.length, note: `${r.account.name} 원장 ${r.rows.length}줄을 내려받았습니다.` };
  }

  @Get('books')
  @Roles(...VIEW)
  @ApiQuery({ name: 'kind', required: true, enum: ['SALES', 'PURCHASE'] })
  @ApiQuery({ name: 'from', required: true, example: '2026-11-01' })
  @ApiQuery({ name: 'to', required: true, example: '2026-11-30' })
  @ApiOperation({ summary: '매출장 · 매입장 (v10.397)', description: 'SALES — 매출 · 부가세예수금 줄이 있는 전표(공급가 · 세액 · 면세) / PURCHASE — 부가세대급금 줄 또는 매입 · 경비 · 법인카드 전표(공제 · 불공제). 거래처별 합 · 전표별 줄.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_BOOK · ACCT_DATE' })
  books(@Query('kind') kind: string, @Query('from') from?: string, @Query('to') to?: string) { return salesPurchaseBook(this.db, String(kind ?? ''), from, to); }

  @Get('books/export')
  @Roles(...VIEW)
  @ExportGate('ACCT_LEDGER')
  @ApiQuery({ name: 'kind', required: true, enum: ['SALES', 'PURCHASE'] })
  @ApiQuery({ name: 'from', required: true, example: '2026-11-01' })
  @ApiQuery({ name: 'to', required: true, example: '2026-11-30' })
  @ApiOperation({ summary: '매출장 · 매입장 CSV (v10.397 · 내려받기 승인)', description: '전표별 줄(거래처 이름 포함 · ACCT_LEDGER 승인).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL · ACCT_BOOK · ACCT_DATE' })
  async booksExport(@Query('kind') kind: string, @Query('from') from?: string, @Query('to') to?: string) {
    const r = await salesPurchaseBook(this.db, String(kind ?? ''), from, to);
    const { head, body } = bookCsv(r);
    return { filename: `${r.kind === 'SALES' ? 'sales' : 'purchase'}-book-${r.from}-${r.to}.csv`, csv: toCsv(head, body), rows: r.items.length,
             note: r.kind === 'SALES' ? `매출장 ${r.items.length}줄을 내려받았습니다.` : `매입장 ${r.items.length}줄을 내려받았습니다.` };   // v10.419 사전 틀과 같은 문장
  }

  /* ── ⑬ assets ── */
  @Get('assets')
  @Roles(...VIEW)
  @ApiQuery({ name: 'state', required: false, enum: ['ACTIVE', 'DISPOSED'] })
  @ApiOperation({ summary: '고정자산 대장 (v10.398)', description: '자산마다 취득가 · 잔존 · 내용연수 · 방법 · 누계액(시스템 전 + 시스템) · 장부가 · 다음 달 상각 · 전표 시작 달 전 빠진 상각 경고. 상각 규칙은 초안(세무사 확인).' })
  @ApiOkResponse({ type: Object })
  assets(@Query('state') state?: string) { return listAssets(this.db, state); }

  @Post('assets/depreciate')
  @HttpCode(200)
  @Roles('SUPER')
  @ApiOperation({ summary: '지금 상각 (v10.398 · SUPER)', description: '정기 작업 acct_depreciation 과 같음 — 끝난 달(이번 달 전)까지 자산마다 한 번 · 전표는 다음 전표 작업에서.' })
  @ApiOkResponse({ type: Object })
  depreciate() { return depreciationJob(this.db); }

  @Get('assets/:id')
  @Roles(...VIEW)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '고정자산 상각 계획 (v10.398)', description: '달마다 상각액 · 장부가 · 한 달 표시.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  asset(@Param('id') id: string) {
    if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 고정자산입니다.');
    return assetDetail(this.db, id);
  }

  @Post('assets')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('ACCT_ASSET_ADD', 'SETTING')
  @ApiOperation({ summary: '고정자산 넣기 (v10.398 · SUPER)', description: '직접(취득일 · 취득가 · 낸 방법 CASH/AP/NONE) 또는 ⑫ 매입에서(purchaseId · 비용으로 잡은 매입이면 자산으로 옮기는 전표). 상각을 시작하면 취득가 · 내용연수 · 방법은 못 고침.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND — 매입' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_ASSET · ACCT_ASSET_DUP · ACCT_DATE' })
  assetAdd(@Body() dto: AcctAssetAddDto) { return addAsset(this.db, { ...dto, name: dto.name ?? '' }, RequestCtx.actorId() ?? null); }

  @Post('assets/:id/dispose')
  @HttpCode(200)
  @Roles('SUPER')
  @Audit('ACCT_ASSET_DISPOSE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '고정자산 처분 (v10.398 · SUPER)', description: '처분 달 전까지 상각 → 처분(받은 돈 · 사유) · 처분 이익 · 손실 전표 · 되돌리지 않음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_ASSET · ACCT_ASSET_DISPOSED · ACCT_DATE · ACCT_REASON' })
  assetDispose(@Param('id') id: string, @Body() dto: AcctAssetDisposeDto) {
    if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 고정자산입니다.');
    return disposeAsset(this.db, id, dto);
  }

  /* ── ⑬ budget ── */
  @Get('budget')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiOperation({ summary: '예산 대비 실적 (v10.399)', description: '그 달 비용 · 매출 계정마다 예산 · 실적(전표 · 공급가) · 차이 · 쓴 비율 · 넘음 · 바꾼 기록.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_YM' })
  budget(@Query('ym') ym?: string) { return budgetView(this.db, ym || undefined); }

  @Put('budget')
  @Roles('SUPER')
  @Audit('ACCT_BUDGET_SET', 'SETTING')
  @ApiOperation({ summary: '예산 넣기 (v10.399 · SUPER)', description: '계정마다 금액(0 이면 지움) · 지난달 옮기기(copyFrom) · 사유 · 바꾼 기록. 넣은 뒤 넘음 알림을 다시 셈(올리면 풀림).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_BUDGET · ACCT_YM · ACCT_REASON' })
  budgetSet(@Body() dto: AcctBudgetSetDto) { return setBudget(this.db, dto, RequestCtx.actorId() ?? null); }

  /* ── ⑭ d247 ── */
  @Get('tax/vat-form')
  @Roles(...VIEW)
  @ApiQuery({ name: 'q', required: false, example: '2026-4' })
  @ApiOperation({ summary: '부가세 신고서 미리보기 (v10.400)', description: '일반과세자 신고서 칸(매출 1 · 3 · 4 · 매입 10 · 11 · 14 · 불공제 16 · 납부세액 · 전자신고 세액공제)을 전표 · 매입 관리로 채움. 미리보기 — 세무사 확인.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_PERIOD' })
  vatForm(@Query('q') q?: string) { return vatForm(this.db, q); }

  @Get('tax/vat-form/export')
  @Roles(...VIEW)
  @ExportGate('ACCT_TAX')
  @ApiQuery({ name: 'q', required: false, example: '2026-4' })
  @ApiOperation({ summary: '부가세 신고서 미리보기 CSV (v10.400)', description: '칸 · 나눔 · 항목 · 공급가 · 세액(내려받기 승인 ACCT_TAX).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_NEED_APPROVAL · ACCT_PERIOD' })
  async vatFormExport(@Query('q') q?: string) {
    const f = await vatForm(this.db, q);
    const { head, rows } = vatFormRows(f);
    return { csv: toCsv(head, rows), filename: `부가세신고서_미리보기_${f.q}.csv`, rows: rows.length };
  }

  /* ── ⑭ v10.401 기간 분석 ── */
  @Get('aging')
  @Roles(...VIEW)
  @ApiQuery({ name: 'asOf', required: false, example: '2026-11-30' })
  @ApiOperation({ summary: '받을 돈 · 갚을 돈 기간 분석 (v10.401)', description: '외상매출금 · 미지급금 · 법인카드 미지급금을 거래처별 30 · 60 · 90일 · 넘음으로(먼저 생긴 몫부터 갚았다고 봄). 넘은 몫은 매일 09:25 운영 알림 ACCT_AGING_OVER.' })
  @ApiOkResponse({ type: Object })
  aging(@Query('asOf') asOf?: string) { return agingView(this.db, asOf); }

  /* ── ⑭ v10.402 해 마감 ── */
  @Get('year-closings')
  @Roles(...VIEW)
  @ApiOperation({ summary: '해 마감 상태 (v10.402)', description: '해마다 월 마감 남은 달 · 손익 · 마감 여부 · 기록.' })
  @ApiOkResponse({ type: Object })
  async yearClosings() { return { ...(await yearClosings(this.db)), canEdit: (RequestCtx.get()?.actorRole ?? '') === 'SUPER' }; }

  @Post('year-closings')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_YEAR_CLOSE', 'SETTING')
  @ApiOperation({ summary: '해 마감 (v10.402 · SUPER)', description: '수익 · 비용 → 이월이익잉여금 전표 YEAR_CLOSE(12-31) · 그 해 전표 넣기 막힘 · 다음 해 기초 잔액 초안. 조건: 해가 끝남 · 모든 달 월 마감.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_YEAR · ACCT_YEAR_FUTURE · ACCT_YEAR_OPEN_MONTHS · ACCT_YEAR_CLOSED' })
  closeYear(@Body() dto: AcctYearCloseDto) { return closeYear(this.db, dto.year, dto.note, RequestCtx.actorId() ?? null); }

  @Post('year-closings/:year/reopen')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_YEAR_REOPEN', 'SETTING')
  @ApiParam({ name: 'year', example: '2026' })
  @ApiOperation({ summary: '해 마감 풀기 (v10.402 · SUPER)', description: '마감 전표의 반대 전표 YEAR_REOPEN · 사유 필수. 월 마감은 그대로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_YEAR_NOT_CLOSED · ACCT_REASON' })
  reopenYear(@Param('year') year: string, @Body() dto: AcctYearReopenDto) { return reopenYear(this.db, Number(year), dto.reason, RequestCtx.actorId() ?? null); }

  /* ── ⑭ v10.403 급여 대장 ── */
  @Get('employees')
  @Roles(...VIEW)
  @ApiOperation({ summary: '급여 직원 (v10.403)', description: '이름 · 입사 · 퇴사 · 월 기본급 · 비과세 · 부양가족 수(주민등록번호 · 계좌 없음).' })
  @ApiOkResponse({ type: Object })
  async employees() { return { ...(await listEmployees(this.db)), canEdit: (RequestCtx.get()?.actorRole ?? '') === 'SUPER' }; }

  @Post('employees')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_EMPLOYEE_ADD', 'SETTING')
  @ApiOperation({ summary: '급여 직원 넣기 (v10.403 · SUPER)' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_EMPLOYEE' })
  addEmployee(@Body() dto: AcctEmpDto) { return addEmployee(this.db, dto, RequestCtx.actorId() ?? null); }

  @Patch('employees/:id')
  @Roles('SUPER')
  @Audit('ACCT_EMPLOYEE_SET', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '급여 직원 고치기 (v10.403 · SUPER)', description: '퇴사는 퇴사일(지우지 않음). 확정한 급여는 그대로.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  updateEmployee(@Param('id') id: string, @Body() dto: AcctEmpPatchDto) {
    if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 직원입니다.');
    return updateEmployee(this.db, id, dto);
  }

  @Get('payroll')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: true, example: '2026-11' })
  @ApiOperation({ summary: '그 달 급여 대장 (v10.403)', description: '줄(지급액 · 소득세 · 지방소득세 · 4대보험 본인 · 회사 · 실지급) · 합계 · 요율(초안 표시).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_PERIOD' })
  payroll(@Query('ym') ym: string) { return payrollMonth(this.db, ym); }

  @Post('payroll/runs')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_PAYROLL_CREATE', 'SETTING')
  @ApiOperation({ summary: '급여 대장 만들기 (v10.403 · SUPER)', description: '그 달 재직자 줄(월 기본급 · 비과세)로 초안 · 달마다 하나.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_PAYROLL_EXISTS' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_PERIOD · ACCT_PAYROLL' })
  createRun(@Body() dto: AcctPayRunDto) { return createRun(this.db, dto.ym, dto.payDay, RequestCtx.actorId() ?? null); }

  @Patch('payroll/lines/:id')
  @Roles('SUPER')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '급여 줄 고치기 (v10.403 · SUPER · 초안만)', description: '지급액 · 비과세 → 4대보험 · 소득세 다시 셈.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_PAYROLL_FIXED' })
  updatePayLine(@Param('id') id: string, @Body() dto: AcctPayLineDto) {
    if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 급여 줄입니다.');
    return updateLine(this.db, id, dto);
  }

  @Post('payroll/runs/:id/fix')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_PAYROLL_FIX', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '급여 확정 (v10.403 · SUPER)', description: '줄 고치기 막힘 · 다음 자동 전표에서 PAYROLL(직원급여 · 보험료 / 예수금 · 미지급금).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_PAYROLL_FIXED' })
  fixRun(@Param('id') id: string) {
    if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 급여 대장입니다.');
    return fixRun(this.db, id, RequestCtx.actorId() ?? null);
  }

  @Post('payroll/runs/:id/paid')
  @Roles('SUPER', 'PAYOUT')
  @HttpCode(200)
  @Audit('ACCT_PAYROLL_PAID', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '급여 지급 처리 (v10.403 · SUPER · PAYOUT)', description: '확정한 급여만 · 전표 PAYROLL_PAID(미지급금 / 보통예금).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_PAYROLL_STATE' })
  paidRun(@Param('id') id: string) {
    if (!/^\d{1,18}$/.test(id)) throw new NotFound('없는 급여 대장입니다.');
    return paidRun(this.db, id, RequestCtx.actorId() ?? null);
  }

  @Get('payroll/rates')
  @Roles(...VIEW)
  @ApiQuery({ name: 'year', required: false, example: '2026' })
  @ApiOperation({ summary: '4대보험 요율 · 간이세액표 (v10.403)', description: '그 해(없으면 가장 가까운 앞 해) 요율 · 초안 여부 · 간이세액표 줄 수.' })
  @ApiOkResponse({ type: Object })
  async payRates(@Query('year') year?: string) {
    const y = /^\d{4}$/.test(year ?? '') ? Number(year) : Number(new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 4));
    return { ...(await ratesOf(this.db, y)), canEdit: (RequestCtx.get()?.actorRole ?? '') === 'SUPER' };
  }

  @Post('payroll/rates')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_PAYROLL_RATE', 'SETTING')
  @ApiOperation({ summary: '4대보험 요율 고치기 (v10.403 · SUPER)', description: '해 · 요율 키 · 값 · 사유 — 고치면 초안 표시가 사라짐 · 기록 acct_payroll_rate_log.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_PAYROLL_RATE · ACCT_REASON' })
  setPayRate(@Body() dto: AcctPayRateDto) { return setRate(this.db, dto.year, dto.key, dto.value, dto.reason, RequestCtx.actorId() ?? null); }

  @Post('payroll/wht-table')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_WHT_TABLE', 'SETTING')
  @ApiOperation({ summary: '근로소득 간이세액표 올리기 (v10.403 · SUPER)', description: '국세청 표 CSV(머리줄 이상 · 미만 · 부양가족 1 ~ 11) · 처음은 그 해 전체를 바꿈 · 크면 나눠 append · 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_WHT_TABLE · ACCT_REASON' })
  uploadWht(@Body() dto: AcctWhtTableDto) { return uploadWhtTable(this.db, dto.year, dto.csv, dto.unit ?? 'THOUSAND', dto.reason, RequestCtx.actorId() ?? null, dto.append === true); }

  /* ── ⑮ d248 ── */
  @Post('pg/upload')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_PG_UPLOAD', 'SETTING')
  @ApiOperation({ summary: 'PG 정산 내역 올리기 (v10.404)', description: 'PG 사 정산 내역 CSV — 머리줄 이름으로 결제일 · 정산일 · 결제 금액 · 수수료 · 수수료 부가세 · 입금액 · 거래 번호 칸을 찾고 같은 줄은 한 번만. 올린 뒤 후보 하나뿐인 줄은 자동 맞춤.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PG_CSV_HEAD · PG_CSV_EMPTY · PG_CSV_SIZE · PG_CSV_TOO_MANY' })
  pgUpload(@Body() dto: AcctPgUploadDto) { return uploadPg(this.db, dto.csv, dto.filename ?? null, dto.pgName ?? null, RequestCtx.actorId() ?? null); }

  @Get('pg')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', example: '2026-11' })
  @ApiOperation({ summary: 'PG 정산 맞추기 (v10.404)', description: '정산일 기준 그 달 PG 정산 줄 · 후보 전표(PG 정산 받을 돈 · 같은 금액 · 결제일 ±acct.pg_match_days) · 합계(결제 · 수수료 · 입금) · 안 들어온 결제(acct.pg_unsettled_days 지남).' })
  @ApiOkResponse({ type: Object })
  pgGet(@Query('ym') ym: string) {
    if (!YM.test(ym ?? '')) throw new PolicyViolation('ACCT_YM', '달(YYYY-MM)이 바르지 않습니다.');
    return pgMonth(this.db, ym);
  }

  @Post('pg/auto-match')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_PG_MATCH', 'SETTING')
  @ApiOperation({ summary: 'PG 정산 자동 맞춤 (v10.404)', description: '후보 전표가 하나뿐인 줄만 맞춥니다.' })
  @ApiOkResponse({ type: Object })
  pgAuto() { return pgAutoMatch(this.db, RequestCtx.actorId() ?? null); }

  @Post('pg/:id/match')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_PG_MATCH', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: 'PG 정산 줄 맞추기 (v10.404)', description: '전표와 맞춤(DB 가 PG 정산 받을 돈 금액 · 방향을 다시 확인) · 맞출 것 없음(사유 · 전표 만들지 않음) · 풀기(사유 · PG 정산 전표 전만).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PG_MATCHED · PG_ENTRY_USED · PG_BOOKED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PG_REASON · PG_ENTRY · ACCT_PG_MISMATCH' })
  pgMatchPost(@Param('id') id: string, @Body() dto: AcctPgMatchDto) { return pgMatch(this.db, id, dto, RequestCtx.actorId() ?? null); }

  /* ── v10.405 수동 전표 ── */
  @Get('manual')
  @Roles(...VIEW)
  @ApiQuery({ name: 'state', required: false, enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELED'] })
  @ApiOperation({ summary: '수동 전표 요청 목록 (v10.405)', description: '요청 · 승인 · 반려 · 취소 · 기다리는 수. 승인은 쓴 사람이 아닌 SUPER.' })
  @ApiOkResponse({ type: Object })
  manualList(@Query('state') state?: string) { return listManual(this.db, state); }

  @Post('manual')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_MANUAL_ADD', 'SETTING')
  @ApiOperation({ summary: '수동 전표 요청 (v10.405)', description: '날짜 · 적요 · 줄(계정 · 차변 · 대변) — 줄 2 ~ 30 · 차변 합 = 대변 합 · 마감한 달 · 해는 안 됨. SUPER 승인 뒤 장부에 들어감.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_MANUAL · ACCT_MANUAL_BALANCE · ACCT_MANUAL_CLOSED' })
  manualAdd(@Body() dto: AcctManualDto) { return addManual(this.db, dto, RequestCtx.actorId()!); }

  @Post('manual/:id/decide')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_MANUAL_DECIDE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '수동 전표 승인 · 반려 (v10.405 · SUPER)', description: '쓴 사람은 못 함(DB 도 막음). 승인하면 acct_entries(source MANUAL)로 들어가고, 반려는 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_MANUAL_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_MANUAL_SELF · ACCT_MANUAL_CLOSED · ACCT_MANUAL' })
  manualDecide(@Param('id') id: string, @Body() dto: AcctManualDecideDto) {
    return decideManual(this.db, id, dto, RequestCtx.actorId()!, (RequestCtx.get()?.actorRole ?? '') === 'SUPER');
  }

  @Post('manual/:id/cancel')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_MANUAL_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '수동 전표 요청 취소 (v10.405)', description: '요청 상태일 때 쓴 사람 · SUPER 만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_MANUAL_STATE' })
  manualCancel(@Param('id') id: string) { return cancelManual(this.db, id, RequestCtx.actorId()!, (RequestCtx.get()?.actorRole ?? '') === 'SUPER'); }

  /* ── v10.406 퇴직금 · 연차 ── */
  @Get('severance')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', example: '2026-11' })
  @ApiOperation({ summary: '퇴직금 추계 (v10.406)', description: '그 달 말 기준 직원별 재직일수 · 1일 평균임금(최근 3개월 급여) · 추계액 · 법정 대상(1년 이상) · 장부 잔액 · 차이. 초안 — 노무사 · 세무사 확인.' })
  @ApiOkResponse({ type: Object })
  severanceGet(@Query('ym') ym: string) { return severanceEstimate(this.db, ym); }

  @Post('severance/run')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_SEVERANCE_RUN', 'SETTING')
  @ApiOperation({ summary: '퇴직금 추계 전표 (v10.406 · SUPER)', description: '그 달 한 번 · 추계액 − 장부 잔액 차이만 전표(SEVERANCE_ACCRUE · 그 달 말 날짜) · 마감한 달 · 이번 달은 안 됨.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'ACCT_SEVERANCE_DONE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_SEVERANCE' })
  severanceRunPost(@Body() dto: AcctSeveranceRunDto) { return severanceRun(this.db, dto.ym, RequestCtx.actorId() ?? null); }

  @Get('leave')
  @Roles(...VIEW)
  @ApiQuery({ name: 'year', example: '2026' })
  @ApiOperation({ summary: '연차 대장 (v10.406)', description: '직원별 그 해 생긴 날 · 쓴 날 · 남은 날 · 제안 일수(설정 acct.leave_* · 초안) · 최근 기록.' })
  @ApiOkResponse({ type: Object })
  leaveGet(@Query('year') year: string) { return leaveBook(this.db, Number(year)); }

  @Post('leave/grant')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_LEAVE_GRANT', 'SETTING')
  @ApiOperation({ summary: '연차 생긴 날 넣기 (v10.406 · SUPER)', description: '쌓기만 · 바로잡기는 음수 줄 · 사유 필수.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_LEAVE' })
  leaveGrantPost(@Body() dto: AcctLeaveGrantDto) { return leaveGrant(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('leave/use')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_LEAVE_USE', 'SETTING')
  @ApiOperation({ summary: '연차 쓴 날 (v10.406)', description: '쌓기만 · 취소는 음수 + 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_LEAVE' })
  leaveUsePost(@Body() dto: AcctLeaveUseDto) { return leaveUse(this.db, dto, RequestCtx.actorId() ?? null); }

  /* ── v10.407 법인세 추정 ── */
  @Get('corptax')
  @Roles(...VIEW)
  @ApiOperation({ summary: '법인세 추정 미리보기 (v10.407)', description: '올해(사업연도) 회계 이익 기준 법인세 · 지방소득세 추정(지금까지 · 1년으로 늘린 값 · 중간예납 가결산) · 세율 구간(acct.corp_tax_brackets) · 중간예납 · 확정 신고 기한. 세무조정 없음 — 세무사 확인.' })
  @ApiOkResponse({ type: Object })
  corpTaxGet() { return corpTaxPreview(this.db); }

  /* ── ⑯ parties ── */
  @Get('parties')
  @Roles(...VIEW)
  @ApiQuery({ name: 'q', required: false }) @ApiQuery({ name: 'kind', required: false, enum: PARTY_KINDS }) @ApiQuery({ name: 'state', required: false, enum: ['ACTIVE', 'CLOSED'] })
  @ApiOperation({ summary: '거래처 목록 (v10.408)', description: '매입처 · 매출처 · 사업자번호 · 담당 · 계좌 끝 4자리 · 광고주 · 입점 판매자 연결 · 매입 합계 · 광고 청구 합계.' })
  @ApiOkResponse({ type: Object })
  parties(@Query('q') q?: string, @Query('kind') kind?: string, @Query('state') state?: string) { return listParties(this.db, q, kind, state); }

  @Post('parties/import')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_PARTY_IMPORT', 'SETTING')
  @ApiOperation({ summary: '거래처 가져오기 (v10.408 · SUPER)', description: '광고주 · 입점 판매자(직판 뺌) · 매입 공급자(사업자번호) 중 아직 없는 것을 넣음. 다시 눌러도 같음.' })
  @ApiOkResponse({ type: Object })
  importParties() { return importParties(this.db, RequestCtx.actorId() ?? null); }

  @Get('parties/:id')
  @Roles(...VIEW)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '거래처 한 곳 (v10.408)', description: '매입(⑫) · 광고 청구 · 입금 · 입점 정산 수수료 · 계약(v10.409) · 수입(v10.411) 최근 50건씩 · 합계.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  party(@Param('id') id: string) { return partyDetail(this.db, id); }

  @Post('parties')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_PARTY_ADD', 'SETTING')
  @ApiOperation({ summary: '거래처 넣기 (v10.408 · SUPER · PAYOUT)', description: '사업자번호 · 광고주 · 입점 판매자 연결은 하나에 한 거래처(409). 계좌는 끝 4자리만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PARTY_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PARTY_KIND · PARTY_NAME · PARTY_BIZNO · PARTY_ACCOUNT · PARTY_PHONE · PARTY_EMAIL · PARTY_LINK' })
  addParty(@Body() dto: PartyDto) { return addParty(this.db, dto, RequestCtx.actorId() ?? null); }

  @Patch('parties/:id')
  @Roles(...VIEW)
  @Audit('ACCT_PARTY_SET', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '거래처 고치기 · 닫기 (v10.408 · SUPER · PAYOUT)', description: '모든 칸을 다시 보냄 · state CLOSED 면 닫기(지우지 않음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PARTY_DUP' })
  updateParty(@Param('id') id: string, @Body() dto: PartyDto) { return updateParty(this.db, id, dto, RequestCtx.actorId() ?? null); }

  /* ── ⑯ contracts ── */
  @Get('contracts')
  @Roles(...VIEW)
  @ApiQuery({ name: 'state', required: false, enum: ['ACTIVE', 'ENDED'] })
  @ApiOperation({ summary: '계약 목록 (v10.409)', description: '거래처 · 종류 · 기간 · 자동 갱신 · 알림 일수 · 달 금액 · 낼 날 · 계약서 파일 · 만기 남은 날 · 알림 대상 · 달 고정비 합.' })
  @ApiOkResponse({ type: Object })
  contracts(@Query('state') state?: string) { return listContracts(this.db, state); }

  @Post('contracts')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_CONTRACT_ADD', 'SETTING')
  @ApiOperation({ summary: '계약 넣기 (v10.409 · SUPER · PAYOUT)', description: '달 금액이 있으면 자금 흐름 예정(나갈 돈 · 매달 · 만기까지)을 함께 넣음. 시작일 · 달 금액 · 종류는 나중에 못 고침.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'CONTRACT_TITLE · CONTRACT_KIND · CONTRACT_DATE · CONTRACT_NOTICE · CONTRACT_AMOUNT · CONTRACT_PAYDAY · CONTRACT_PARTY · CONTRACT_FILES' })
  addContract(@Body() dto: AcctContractDto) { return addContract(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('contracts/:id/renew')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_CONTRACT_RENEW', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '계약 연장 (v10.409)', description: '새 만기일(지금 만기 뒤) · 사유 · 자금 흐름 예정을 새 만기까지로 다시 · 만기 알림 풀림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONTRACT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'CONTRACT_DATE · ACCT_REASON' })
  renewContract(@Param('id') id: string, @Body() dto: AcctContractRenewDto) { return renewContract(this.db, id, dto.endOn, dto.reason, RequestCtx.actorId() ?? null); }

  @Post('contracts/:id/end')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_CONTRACT_END', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '계약 끝내기 (v10.409)', description: '사유 · 자금 흐름 예정 취소 · 만기 알림 풀림 · 기록은 남음.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'CONTRACT_STATE' })
  endContract(@Param('id') id: string, @Body() dto: AcctContractEndDto) { return endContract(this.db, id, dto.reason, RequestCtx.actorId() ?? null); }

  /* ── ⑯ requisitions ── */
  @Get('requisitions')
  @Roles(...STAFF)
  @ApiQuery({ name: 'state', required: false, enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'USED', 'CANCELED'] })
  @ApiOperation({ summary: '품의 목록 (v10.410)', description: 'SUPER · PAYOUT 은 모두, 나머지 운영자는 자기 품의만. 결재 기다림 먼저 · 고를 계정 · 허용 %.' })
  @ApiOkResponse({ type: Object })
  requisitions(@Query('state') state?: string) { return listRequisitions(this.db, RequestCtx.actorId() ?? null, state); }

  @Post('requisitions')
  @Roles(...STAFF)
  @HttpCode(200)
  @Audit('ACCT_REQ_ADD', 'SETTING')
  @ApiOperation({ summary: '품의 올리기 (v10.410 · 운영자 누구나)', description: '제목 · 금액 · 계정 · 사유 · 쓸 날. SUPER 결재를 기다림. 내용은 나중에 못 고침(취소하고 새로).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'REQ_TITLE · REQ_AMOUNT · REQ_REASON · REQ_DATE · REQ_ACCOUNT' })
  addRequisition(@Body() dto: ReqAddDto) { return addRequisition(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('requisitions/:id/decide')
  @Roles('SUPER')
  @HttpCode(200)
  @Audit('ACCT_REQ_DECIDE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '품의 결재 (v10.410 · SUPER)', description: '승인 · 반려(사유). 본인 품의는 결재할 수 없음(DB 도 막음).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'REQ_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'REQ_SELF · REQ_REASON' })
  decideRequisition(@Param('id') id: string, @Body() dto: ReqDecideDto) { return decideRequisition(this.db, id, dto.approve, dto.note, RequestCtx.actorId() ?? null); }

  @Post('requisitions/:id/use')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_REQ_USE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '품의를 매입 · 경비 청구에 연결 (v10.410 · SUPER · PAYOUT)', description: '승인된 품의 하나에 매입 · 경비 청구 하나. 금액이 품의 × (1 + acct.req_tolerance_pct%) 를 넘으면 422(다시 품의).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'REQ_STATE · REQ_USED' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'REQ_USE · REQ_OVER' })
  useRequisition(@Param('id') id: string, @Body() dto: ReqUseDto) { return useRequisition(this.db, id, dto.kind, dto.refId, RequestCtx.actorId() ?? null); }

  @Post('requisitions/:id/cancel')
  @Roles(...STAFF)
  @HttpCode(200)
  @Audit('ACCT_REQ_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '품의 취소 (v10.410)', description: '올린 사람(결재 전 · 승인 뒤 쓰기 전) 또는 SUPER.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 403, type: ErrorDto, description: 'REQ_OWNER' })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'REQ_STATE' })
  cancelRequisition(@Param('id') id: string) { return cancelRequisition(this.db, id, RequestCtx.actorId() ?? null); }

  /* ── ⑯ imports ── */
  @Get('imports')
  @Roles(...VIEW)
  @ApiQuery({ name: 'state', required: false, enum: ['ORDERED', 'SHIPPED', 'CUSTOMS', 'RECEIVED', 'CANCELED'] })
  @ApiOperation({ summary: '수입 건 목록 (v10.411)', description: '거래처 · 상태 · 통화 · 환율 · 관세 · 수입 부가세 · 운임 · B/L · 관세사 · 신고번호 · 외화 합계 · 수입 부가세 전표 · 고를 직판 상품 옵션.' })
  @ApiOkResponse({ type: Object })
  imports(@Query('state') state?: string) { return listImports(this.db, state); }

  @Get('imports/:id')
  @Roles(...VIEW)
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '수입 건 한 건 (v10.411)', description: '품목 · 외화 금액 · 입고 원가 · 재고 수불 줄 번호.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  importOne(@Param('id') id: string) { return importDetail(this.db, id); }

  @Post('imports')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_IMPORT_ADD', 'SETTING')
  @ApiOperation({ summary: '수입 건 발주 넣기 (v10.411 · SUPER · PAYOUT)', description: '거래처 · 제목 · 통화 · 발주일 · 품목(직판 상품 옵션 · 수량 · 외화 금액 1 ~ 50줄).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'IMPORT_TITLE · IMPORT_CURRENCY · IMPORT_DATE · IMPORT_PARTY · IMPORT_LINES' })
  addImport(@Body() dto: ImportAddDto) { return addImport(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('imports/:id/advance')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_IMPORT_ADVANCE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '수입 건 다음 단계 (v10.411)', description: '선적(B/L · 품목 바꾸기) → 통관(환율 · 관세 · 수입 부가세 → 전표 IMPORT_VAT) → 입고(운임 · 기타 → 재고 수불부 IN 원가 → 전표 STOCK_IN). 뒤로 안 됨.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'IMPORT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'IMPORT_STATE · IMPORT_DATE · IMPORT_FX · IMPORT_COST · IMPORT_LINES' })
  advanceImport(@Param('id') id: string, @Body() dto: ImportAdvanceDto) { return advanceImport(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Post('imports/:id/cancel')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_IMPORT_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '수입 건 취소 (v10.411)', description: '통관 전(발주 · 선적)만 · 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'IMPORT_STATE' })
  cancelImport(@Param('id') id: string, @Body() dto: ImportCancelDto) { return cancelImport(this.db, id, dto.reason); }

  /* ── ㉑ d254 ── */
  @Get('exports')
  @Roles(...VIEW)
  @ApiQuery({ name: 'state', required: false, enum: ['ORDERED', 'SHIPPED', 'CLEARED', 'PAID', 'CANCELED'] })
  @ApiOperation({ summary: '수출 건 (v10.428)', description: '수주 → 선적 → 수출신고 수리 → 대금 회수 · 받을 돈(원화) · 직판 옵션 목록.' })
  @ApiOkResponse({ type: Object })
  exports(@Query('state') state?: string) { return listExports(this.db, state); }

  @Post('exports')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_EXPORT_ADD', 'SETTING')
  @ApiOperation({ summary: '수주 넣기 (v10.428)', description: '거래처 · 통화 · 인코텀즈 · 품목(직판 옵션 또는 이름) · 외화 금액.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_TITLE · EXPORT_CURRENCY · EXPORT_DATE · EXPORT_LINES · TRADE_PARTY' })
  addExport(@Body() dto: ExportAddDto) { return addExport(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('exports/:id/advance')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_EXPORT_ADVANCE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '수출 다음 단계 (v10.428)', description: '선적(환율 · 매출 · 재고 출고) · 수출신고 수리(번호) · 대금 회수(원화 · 환율 차이). 앞으로만.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'EXPORT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'EXPORT_STATE · EXPORT_DATE · EXPORT_FX · EXPORT_DECL · EXPORT_PAID' })
  advanceExport(@Param('id') id: string, @Body() dto: ExportAdvanceDto) { return advanceExport(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Post('exports/:id/cancel')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_EXPORT_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '수출 건 취소 (v10.428)', description: '선적 전에만 · 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'EXPORT_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_REASON' })
  cancelExport(@Param('id') id: string, @Body() dto: TradeCancelDto) { return cancelExport(this.db, id, dto.reason); }

  /* ── v10.428 국내 구매 발주 ── */
  @Get('pos')
  @Roles(...VIEW)
  @ApiQuery({ name: 'state', required: false, enum: ['ORDERED', 'RECEIVED', 'CANCELED'] })
  @ApiOperation({ summary: '국내 구매 발주 (v10.428)', description: '발주 → 입고(매입 한 건 · 직판 옵션 재고 입고).' })
  @ApiOkResponse({ type: Object })
  pos(@Query('state') state?: string) { return listPos(this.db, state); }

  @Post('pos')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_PO_ADD', 'SETTING')
  @ApiOperation({ summary: '발주 넣기 (v10.428)', description: '매입처 · 품목(직판 옵션 또는 이름) · 수량 · 단가 · 품의(선택).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PO_TITLE · PO_DATE · PO_LINES · PO_REQ · TRADE_PARTY' })
  addPo(@Body() dto: PoAddDto) { return addPo(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('pos/:id/receive')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_PO_RECEIVE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '발주 입고 (v10.428)', description: '⑫ 매입 한 건(같은 건 막기 건너뜀 · 품의 한도는 DB) · 직판 옵션 품목은 재고 수불부 입고(purchase_id).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PO_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PO_DATE · PO_LINES · PURCHASE_* · REQ_OVER' })
  receivePo(@Param('id') id: string, @Body() dto: PoReceiveDto) { return receivePo(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Post('pos/:id/cancel')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_PO_CANCEL', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '발주 취소 (v10.428)', description: '입고 전에만 · 사유.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'PO_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_REASON' })
  cancelPo(@Param('id') id: string, @Body() dto: TradeCancelDto) { return cancelPo(this.db, id, dto.reason); }

  /* ── v10.431 거래처 휴폐업 조회 ── */
  @Post('parties/:id/biz-check')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_PARTY_BIZ_CHECK', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '거래처 휴폐업 조회 (v10.431)', description: '국세청 사업자 상태(키 없으면 간주) · acct.biz_status_check on 일 때만 · 휴업 · 폐업이면 운영 알림.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'BIZ_CHECK_OFF · ACCT_PARTY_BIZNO' })
  bizCheckParty(@Param('id') id: string) { return bizCheckParty(this.db, id); }

  /* ── v10.432 (D255 · docs/569) 매입 세금계산서 가져오기 ── */
  @Get('tax-inbox')
  @Roles(...VIEW)
  @ApiQuery({ name: 'ym', required: false, example: '2026-11' })
  @ApiQuery({ name: 'state', required: false, enum: ['NEW', 'BOOKED', 'IGNORED'] })
  @ApiOperation({ summary: '가져온 매입 세금계산서 (v10.432)', description: '그 달 가져온 줄 · 상태(새로 · 매입으로 넘김 · 넘기지 않음) · 같은 매입이 이미 있는지 · 켜짐 · 방식(간주 · 업체) · 마지막 가져오기.' })
  @ApiOkResponse({ type: Object })
  taxInbox(@Query('ym') ym?: string, @Query('state') state?: string) { return listInbox(this.db, { ym, state }); }

  @Post('tax-inbox/fetch')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_TAXINBOX_FETCH', 'SETTING')
  @ApiOperation({ summary: '매입 세금계산서 가져오기 (v10.432)', description: '연동 업체(또는 간주)에서 기간(31일까지)의 매입 세금계산서를 가져옴 · 같은 승인번호는 한 번. 꺼져 있으면 422 TAXINBOX_OFF · 업체 키 없으면 422 TAXINBOX_NOT_READY.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'TAXINBOX_OFF · TAXINBOX_NOT_READY · TAXINBOX_PERIOD' })
  taxInboxFetch(@Body() dto: TaxInboxFetchDto) { return fetchInbox(this.db, dto, RequestCtx.actorId() ?? null); }

  @Post('tax-inbox/:id/book')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_TAXINBOX_BOOK', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '매입으로 넘기기 (v10.432)', description: '계정 · 낸 방법을 골라 매입 관리(매입 세금계산서)로 · 면세 계산서는 불공제 · 같은 공급자 · 날짜 · 합계 매입이 있으면 409(force).' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TAXINBOX_STATE · TAXINBOX_DUP' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'PURCHASE_ACCOUNT · PURCHASE_PAY · PURCHASE_BIZNO · REQ_OVER' })
  taxInboxBook(@Param('id') id: string, @Body() dto: TaxInboxBookDto) { return bookInbox(this.db, id, dto, RequestCtx.actorId() ?? null); }

  @Post('tax-inbox/:id/ignore')
  @Roles(...VIEW)
  @HttpCode(200)
  @Audit('ACCT_TAXINBOX_IGNORE', 'SETTING')
  @ApiParam({ name: 'id', example: '1' })
  @ApiOperation({ summary: '매입으로 넘기지 않음 (v10.432)', description: '사유(2 ~ 200자) — 개인 지출 · 다른 회사 것 등.' })
  @ApiOkResponse({ type: Object })
  @ApiResponse({ status: 404, type: ErrorDto, description: 'NOT_FOUND' })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'TAXINBOX_STATE' })
  @ApiResponse({ status: 422, type: ErrorDto, description: 'ACCT_REASON' })
  taxInboxIgnore(@Param('id') id: string, @Body() dto: TaxInboxIgnoreDto) { return ignoreInbox(this.db, id, dto.note, RequestCtx.actorId() ?? null); }
}
