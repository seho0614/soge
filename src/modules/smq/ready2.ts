import { DatabaseService } from '../../db/database.service';
import { assumeOn } from '../../common/integration/switches';

/* ---------------------------------------------------------------------
 * v10.578 (docs/720) ② 입점 열기 2차 점검 — 읽기만 · 스위치를 막지 않음(막는 규칙은 1차 그대로 — 입점 약관 먼저)
 *   1차(v10.229 · 「입점 열기 준비」 HealthTenantReady · GET /admin/health/tenant/readiness)는 신청 받기 · 판매 열기(약관 · 결제 · 하위가맹점 · 주문 받기 · 승인 판매자 · 업종 신고)
 *   2차는 판매를 연 뒤 돌아가야 할 운영 준비를 한 장으로 — 약관 · 정산 · 반품 · 세금계산서 · 판매자 교육 · 연락처
 *   줄 모양은 1차와 같음(key · group · label · state ok | todo | info · now) — 화면 · 시험이 같은 방식으로 읽음
 *   막힘(todo)은 대표 · 법무 · 세무 · 운영 차례라 오픈 전에는 정상
 * ------------------------------------------------------------------- */

export type Ready2Group = 'terms' | 'settle' | 'return' | 'tax' | 'edu' | 'contact';
export interface Ready2Row { key: string; group: Ready2Group; label: string; state: 'ok' | 'todo' | 'info'; now: string }

export const READY2_GROUPS: Array<{ g: Ready2Group; title: string }> = [
  { g: 'terms', title: '약관' }, { g: 'settle', title: '정산' }, { g: 'return', title: '반품' },
  { g: 'tax', title: '세금계산서' }, { g: 'edu', title: '판매자 교육' }, { g: 'contact', title: '연락처' },
];

/** GET /admin/smq/tenant-ready2 */
export async function tenantReady2(db: DatabaseService) {
  const [r] = await db.query<Record<string, unknown>>(
    `SELECT (SELECT version FROM v_terms_current WHERE code = 'HLT_SELLER' LIMIT 1) AS "sellerTerms",
            (SELECT version FROM v_terms_current WHERE code = 'HLT_SALE' LIMIT 1) AS "saleTerms",
            coalesce((SELECT is_active FROM job_schedules WHERE job = 'hlt_settle_weekly'), false) AS "settleJob",
            coalesce((SELECT is_active FROM job_schedules WHERE job = 'mall_statement'), false) AS "statementJob",
            coalesce((SELECT value FROM site_settings WHERE key = 'mall.statement_mail'), 'off') AS "statementMail",
            (SELECT count(*)::int FROM v_hlt_settle_ready) AS "settleReady",
            (SELECT count(*)::int FROM v_hlt_return_ship_ready) AS "returnShipReady",
            (SELECT count(*)::int FROM hlt_sellers WHERE type IN ('TENANT', 'BRAND') AND status = 'ACTIVE') AS active,
            (SELECT count(*)::int FROM hlt_sellers WHERE type IN ('TENANT', 'BRAND') AND status = 'ACTIVE' AND coalesce(btrim(return_addr), '') = '') AS "noReturnAddr",
            (SELECT count(*)::int FROM hlt_sellers WHERE type IN ('TENANT', 'BRAND') AND status = 'ACTIVE' AND (return_ship_fee IS NULL OR return_ship_fee <= 0 OR return_ship_fee > 6000)) AS "badReturnFee",
            (SELECT count(*)::int FROM hlt_returns x JOIN hlt_orders o ON o.id = x.order_id JOIN hlt_sellers s ON s.id = o.seller_id
              WHERE s.type IN ('TENANT', 'BRAND') AND x.state IN ('REQUESTED', 'APPROVED') AND x.created_at < now() - interval '3 days') AS "staleReturns",
            coalesce((SELECT value FROM site_settings WHERE key = 'mall.invoice_direction'), 'COMPANY_TO_SELLER') AS "invoiceDir",
            (SELECT count(*)::int FROM hlt_settlements WHERE invoice_state = 'REQUESTED') AS "invoiceWait",
            EXISTS (SELECT 1 FROM v_guide_flow_current WHERE code = 'seller' AND is_active) AS "sellerGuide",
            coalesce((SELECT value FROM site_settings WHERE key = 'smq.qna'), 'off') AS "qnaSwitch",
            coalesce((SELECT value FROM site_settings WHERE key = 'smq.penalty'), 'off') AS "penaltySwitch",
            coalesce((SELECT btrim(value) FROM site_settings WHERE key = 'footer.phone'), '') AS phone,
            coalesce((SELECT btrim(value) FROM site_settings WHERE key = 'footer.mail_order_no'), '') AS "mailOrderNo",
            coalesce((SELECT btrim(value) FROM site_settings WHERE key = 'support.hours'), '') AS hours,
            (SELECT count(*)::int FROM hlt_sellers WHERE type IN ('TENANT', 'BRAND') AND status = 'ACTIVE' AND coalesce(btrim(cs_tel), '') = '') AS "noCsTel",
            (SELECT count(*)::int FROM hlt_sellers WHERE type IN ('TENANT', 'BRAND') AND status = 'ACTIVE' AND NOT personal AND coalesce(btrim(ecom_reg_no), '') = '') AS "noEcomNo"`);
  const etaxAssume = await assumeOn(db, 'etax', false);   // 간주 스위치는 공통 함수로(test_v1044)
  const n = (k: string) => Number(r?.[k] ?? 0);
  const s = (k: string) => String(r?.[k] ?? '');
  const rows: Ready2Row[] = [
    { key: 'terms-seller', group: 'terms', label: '입점 약관(HLT_SELLER)', state: s('sellerTerms') ? 'ok' : 'todo',
      now: s('sellerTerms') ? `${s('sellerTerms')} 지금 판` : '지금 판 없음 — 법무 확인 뒤 약관 화면에서 게시(1차 점검과 같음)' },
    { key: 'terms-sale', group: 'terms', label: '소개몰 판매 약관(HLT_SALE · 반품 · 청약철회)', state: s('saleTerms') ? 'ok' : 'todo',
      now: s('saleTerms') ? `${s('saleTerms')} 지금 판` : '지금 판 없음 — 구매자 반품 · 청약철회 기준이 화면에 없음' },
    { key: 'terms-penalty', group: 'terms', label: '판매자 평가 · 노출 제한 기준을 입점 약관에', state: 'info',
      now: `평가 ${s('penaltySwitch') === 'on' ? '켜짐' : '꺼짐'} — 노출 제한을 켜기 전에 기준(배송 지연 · 취소 · 문의 답)을 약관에 적고 법무 확인(docs/721)` },
    { key: 'settle-job', group: 'settle', label: '주 정산 마감(월요일 03:20)', state: r?.settleJob ? 'ok' : 'todo',
      now: `${r?.settleJob ? '정기 작업 켜짐' : '정기 작업 꺼짐 — 정산서가 만들어지지 않음'} · 다음 마감 대기 ${n('settleReady')}건 · 반품 배송비 대기 ${n('returnShipReady')}건` },
    { key: 'statement', group: 'settle', label: '월 정산서(판매자)', state: r?.statementJob ? 'ok' : 'todo',
      now: `${r?.statementJob ? '정기 작업 켜짐' : '정기 작업 꺼짐'} · 메일 ${s('statementMail') === 'on' ? '켜짐' : '꺼짐(인쇄 · PDF 는 됨)'}` },
    { key: 'return-addr', group: 'return', label: '반품 받을 주소', state: n('noReturnAddr') === 0 ? 'ok' : 'todo',
      now: `승인 판매자 ${n('active')}명 · 주소 없음 ${n('noReturnAddr')}명` },
    { key: 'return-fee', group: 'return', label: '왕복 반품 배송비(6,000원 상한)', state: n('badReturnFee') === 0 ? 'ok' : 'todo',
      now: `범위 밖 ${n('badReturnFee')}명 · 회원 사정 반품의 뺀 배송비는 판매자 정산(v10.560)` },
    { key: 'return-stale', group: 'return', label: '3일 넘게 처리 안 한 입점 취소 · 반품', state: n('staleReturns') === 0 ? 'ok' : 'todo',
      now: `${n('staleReturns')}건 — 소개몰 › 주문에서 처리` },
    { key: 'invoice-dir', group: 'tax', label: '판매수수료 세금계산서 방향', state: 'info',
      now: `${s('invoiceDir') === 'SELLER_TO_COMPANY' ? '판매자 → 회사' : '회사 → 판매자'} — 세무사 확인 뒤 정함(mall.invoice_direction)` },
    { key: 'etax', group: 'tax', label: '전자세금계산서 전송', state: etaxAssume ? 'todo' : 'ok',
      now: etaxAssume ? '간주 모드 — 국세청 전송 없이 번호만 적음(외부 연동 뒤 끔)' : '간주 모드 꺼짐' },
    { key: 'invoice-wait', group: 'tax', label: '발행할 수수료 세금계산서', state: 'info', now: `${n('invoiceWait')}건(소개몰 › 정산)` },
    { key: 'seller-guide', group: 'edu', label: '판매자 안내 흐름(이용 흐름 seller)', state: r?.sellerGuide ? 'ok' : 'todo',
      now: r?.sellerGuide ? '사용자 웹 /guide/flows 에 보임' : '없음 — 운영 › 이용 흐름에서 code seller 로 만들기(SUPER · 초안 docs/720 4절)' },
    { key: 'qna-switch', group: 'edu', label: '판매자 상품 문의 답(v10.577)', state: 'info',
      now: `${s('qnaSwitch') === 'on' ? '켜짐' : '꺼짐'} — 켜면 입점 상품 문의는 판매자가 답 · 기한 알림` },
    { key: 'cs-phone', group: 'contact', label: '고객센터 전화(법정 고지)', state: s('phone') ? 'ok' : 'todo', now: s('phone') || '비어 있음 — 운영 › 법정 고지' },
    { key: 'mail-order', group: 'contact', label: '통신판매업 신고번호(회사)', state: s('mailOrderNo') ? 'ok' : 'todo', now: s('mailOrderNo') || '비어 있음 — 운영 › 법정 고지' },
    { key: 'support-hours', group: 'contact', label: '고객센터 운영 시간', state: s('hours') ? 'ok' : 'todo', now: s('hours') || '비어 있음' },
    { key: 'seller-tel', group: 'contact', label: '판매자 고객 응대 전화', state: n('noCsTel') === 0 ? 'ok' : 'todo', now: `없음 ${n('noCsTel')}명` },
    { key: 'seller-ecom', group: 'contact', label: '사업자 판매자 통신판매업 신고번호', state: n('noEcomNo') === 0 ? 'ok' : 'todo',
      now: `없음 ${n('noEcomNo')}명(개인 판매자 뺌 · 신고 대상인지는 판매자 사정)` },
  ];
  const todo = rows.filter((x) => x.state === 'todo').length;
  return { ready: todo === 0, todo, groups: READY2_GROUPS, rows,
    note: '판매를 연 뒤 돌아가야 할 준비입니다(읽기만). 막힘은 대표 · 법무 · 세무 · 운영 차례라 오픈 전에는 정상이고, 스위치를 막지 않습니다.' };
}
