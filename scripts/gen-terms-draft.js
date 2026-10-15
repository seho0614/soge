#!/usr/bin/env node
/**
 * 약관 6종 초안 생성.
 *
 * 요금제·불변식·연동 현황을 실제 DB 에서 읽어 씁니다 —
 * 약관에 "월 49,000원" 을 손으로 쓰면 요금이 바뀔 때 약관이 거짓말이 됩니다.
 *
 * ⚠ 초안입니다. **법무 검토 없이 발행하지 마십시오.**
 *   발행하면 이용자와의 계약 조건이 됩니다.
 */
const { Client } = require('pg');
require('./load-env');
const fs = require('fs');
/* v10.28 (G-217) — 약관 본문 한 벌. 판매 약관 · 위치기반 말고는 여기서 가져옵니다 */
const TEXT = require('./terms-text');

const won = (n) => Number(n).toLocaleString('ko-KR');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const plans = (await c.query(
    `SELECT code, name, monthly_price, included_codes, extra_code_price,
            request_views_per_month, listing_slots
       FROM subscription_plans WHERE is_active ORDER BY monthly_price`)).rows;
  const inv = (await c.query(`SELECT * FROM v_privacy_inventory`)).rows;
  const integrations = (await c.query(
    `SELECT name, purpose, provider, status FROM integrations ORDER BY sort_order`)).rows;
  const set = Object.fromEntries(
    (await c.query(`SELECT key, value FROM site_settings`)).rows.map(r => [r.key, r.value || '']));

  const V = (k, ph) => set[k] || `〔${ph}〕`;
  const CO = V('footer.ceo_name', '회사명');
  const T = {};

  /* ── 1. 맞춤형 광고 · 이용약관 — 글은 terms-text.js(한 벌) ── */
  T.ADPERSONAL = TEXT.ADPERSONAL;

  T.SERVICE = TEXT.SERVICE;

  /* ── 2. 개인정보처리방침 — v10.28 부터 한 벌(terms-text.js). 19번 문서(gen-privacy-policy.js)는 스키마에서 뽑은 참고 자료로 남고 약관 본문이 아닙니다 ── */
  T.PRIVACY = TEXT.PRIVACY;

  /* ── 3. 위치기반 ── */
  T.LOCATION = `# 위치기반서비스 이용약관

> **〔법무 확인 필요〕** 이 서비스는 이용자의 단말기 위치정보를 수집하지 않습니다.
> 등록물에 **지역을 선택 입력**받아 검색 필터로 사용할 뿐입니다.
> 이것이 위치정보의 보호 및 이용 등에 관한 법률상 "위치기반서비스"에 해당하는지
> 확인이 필요하며, **해당하지 않는다면 이 약관은 불필요합니다.**

## 제1조 (목적)
이 약관은 ${CO}(이하 "회사")가 제공하는 위치정보 관련 서비스의 이용에 관한 사항을
규정함을 목적으로 합니다.

## 제2조 (수집하는 정보)
① 회사는 **단말기의 실시간 위치정보를 수집하지 않습니다.**
② 회원이 등록물에 직접 입력한 **지역 정보**(시·도, 시·군·구 단위)를 수집합니다.

## 제3조 (이용 목적)
수집한 지역 정보는 다음 목적으로만 사용합니다.
1. 등록물의 지역별 검색 및 필터
2. 지역 기준 통계

## 제4조 (제3자 제공)
회사는 지역 정보를 제3자에게 제공하지 않습니다.
다만 등록물이 공개 노출되는 경우 해당 등록물의 지역 정보는 함께 표시됩니다.

## 제5조 (보유 기간)
등록물의 보유 기간과 동일합니다. 등록물이 삭제되면 함께 삭제됩니다.

## 제6조 (이용자의 권리)
회원은 언제든지 등록물의 지역 정보를 수정하거나 삭제할 수 있습니다.

부칙 — 이 약관은 〔시행일〕부터 시행합니다.`;

  /* ── 4. 마케팅 ── */
  T.MARKETING = TEXT.MARKETING;
  T.MARKETING_NIGHT = TEXT.MARKETING_NIGHT;   /* v10.28 — 전에는 생성기에 없었음(DB 에만) */

  /* ── 5. 제3자 제공 ── */
  /* v10.27 (10/8 답 「운영 첫 발행은 DB 의 글」) — 판매 약관은 DB 의 글(C880 · D024 · D028 — 시안 · 개발 DB 에 실린 확정 문안)과 같게 둡니다.
   *   전에는 장 번호 · 문장이 다른 글이라, 처음 발행할 때 publish-terms.sh 가 초안 본문을 이 글로 덮으면 확정 문안이 아닌 글이 발행됐습니다(G-209 · G-210).
   *   다른 점은 맨 끝 「시행일 〔시행일〕」 하나 — 발행할 때 채워집니다(DB 의 초안에는 기준선 때의 날짜가 박혀 있어 D031 이 자리표시자로 되돌립니다).
   *   문안을 고칠 때는 새 마이그레이션(DB 의 글)과 이 글을 함께 고치십시오 — 시험(fix_1027 T-1)이 둘이 같은지 봅니다. */
  T.HLT_SALE = `# 건강상품 판매 약관 (직판)

## ★ 다른 관과 다릅니다

\`\`\`
소개장터 · 안심소개 · 소개창업 회사는 중개만 하고 당사자가 아닙니다
소개몰                        ★ 회사가 직접 팝니다
\`\`\`

**하자 · 배송 · 반품 · 환불 책임이 회사에 있습니다.**

## 제1조 (판매자)
\`\`\`
(주)한국바이오헬스케어 소개뱅크 사업부
대표 노명석 · 사업자등록번호 429-88-01533
\`\`\`

## 제2조 (청약철회)
① 받으신 날부터 **7일 안**이면 이유를 묻지 않습니다
   (전자상거래법 17조).
② 다만 다음은 철회할 수 없습니다.

\`\`\`
개봉하신 식품 · 건강기능식품
회원의 요청으로 따로 만든 것
시간이 지나 다시 팔기 어려운 것
\`\`\`

③ **개봉 여부의 판단은 회사가 합니다.** 다투실 경우 사진 등
   근거를 함께 보내 주십시오.

## 제3조 (반품 · 교환 비용)
| 사유 | 누가 냅니까 |
|---|---|
| 단순 변심 · 잘못 주문 | 회원 |
| 상품 하자 · 오배송 · 표시·광고와 다름 · 배송 지연 | **회사** |

① **회원 사정(단순 변심 · 잘못 주문)으로 반품**하시면 **왕복 배송비 6,000원**
(보내 드린 배송비 3,000원 + 돌려받는 배송비 3,000원)을 **환불 금액에서 뺍니다**
(전자상거래법 18조 9항 — 반환에 드는 비용은 소비자 부담). 위약금이나 손해배상은 받지 않습니다.

| 경우 | 환불 금액 |
|---|---|
| 회원 사정 반품(단순 변심 · 잘못 주문) | 결제 금액 − 6,000원 |
| 발송 전 취소 | 전액 |
| 상품 하자 · 오배송 · 표시·광고와 다름 · 배송 지연 | 전액 (배송비를 받지 않습니다) |
| 회원 사정 교환(단순 변심 · 잘못 주문) | 환불 없음 · 교환 배송비 6,000원 신청 때 결제 |
| 회사 사정 교환 · 반려된 교환 | 교환 배송비를 받지 않거나 전액 돌려드림 |

② **교환**은 환불 없이 같은 상품을 다시 보내 드립니다. 회원 사정(단순 변심 · 잘못 주문)으로 교환하시면
   **왕복 배송비 6,000원을 교환을 신청하실 때 결제**하십니다. 회사가 교환을 받지 않거나(반려)
   회사 사정(상품 하자 · 오배송 · 표시·광고와 다름 · 배송 지연)으로 판정되면 결제하신 금액을 **전액 돌려드립니다**.
③ **교환할 상품이 없을 때**에는 입고를 **14일까지** 기다린 뒤 반품으로 바꿔 드립니다. 원하시면 기다리지 않고
   바로 반품으로 바꿔 드립니다. 이때는 **반품 배송비를 빼지 않고 전액 환불**하며, 결제하신 교환 배송비도 돌려드립니다.

## 제4조 (환불)
① 반품 상품을 받은 날부터 **영업일 3일 안**에 환불합니다.
② 카드 결제는 카드사 사정으로 더 걸릴 수 있습니다.

## 제5조 (배송)
① 결제 확인 후 **영업일 2일 안**에 보냅니다.
② 품절이나 지연이 생기면 **바로 알려 드리고**, 원하시면 취소해
   드립니다.
③ **배송비는 받지 않습니다**(전 상품 무료).

## 제6조 (건강기능식품 표시)
① 건강기능식품은 **질병의 예방이나 치료를 위한 의약품이 아닙니다.**
② 상품 설명에 적힌 기능성은 식품의약품안전처가 인정한 범위입니다.
③ 복용 중인 약이 있으시면 **의사나 약사와 상의**하십시오.

## 제7조 (표시·광고)
회사는 다음을 하지 않습니다.

\`\`\`
질병 치료 효과를 말하는 것
소비자를 속이거나 오인시키는 표현
근거 없는 비교
\`\`\`

## 제8조 (책임)
① 상품의 하자로 손해가 생기면 회사가 배상합니다.
② 다만 회원이 **표시된 용법을 지키지 않아** 생긴 손해는 제외합니다.

## 제9조 (분쟁)
소비자분쟁해결기준(공정거래위원회 고시)에 따릅니다.

\`\`\`
한국소비자원   kca.go.kr · 1372
\`\`\`

---

시행일 〔시행일〕
`;

  T.OUTSOURCE = TEXT.OUTSOURCE;

  T.THIRDPARTY = TEXT.THIRDPARTY;

  /* ── 6. 환불 ── */
  T.REFUND = TEXT.REFUND;

  /* ── 7. 파트너 이용약관 (v10.31 · D076 — 리드 이용료 선불 충전 · 법무 검토 전) ── */
  T.PARTNER = TEXT.PARTNER;

  // 파일로 저장
  fs.mkdirSync('docs/terms', { recursive: true });
  const rows = [];
  for (const [code, body] of Object.entries(T)) {
    fs.writeFileSync(`docs/terms/${code}.md`, body + '\n');
    rows.push([code, body]);
  }

  /* 약관 행이 없으면 만듭니다.
   *
   * 전에는 기준선이 행과 본문을 함께 담았는데, 그러면 재구축할 때
   * 옛 초안이 생성물을 덮고 발행 상태까지 지웠습니다.
   * 이제 기준선은 뼈대만 담고, 행이 비어 있으면 여기서 채웁니다. */
  const TITLE = {
    SERVICE: '이용약관', PRIVACY: '개인정보처리방침', REFUND: '구독 환불 정책',
    LOCATION: '위치기반서비스 약관',
    THIRDPARTY: '제3자 제공 동의 (회원 간)',
    OUTSOURCE: '개인정보 처리업무 위탁 안내',      // v10.28 (G-218) — 알림(동의 받지 않음 · D042)
    HLT_SALE: '건강상품 판매 약관 (직판)',
    MARKETING: '마케팅 수신 동의',
    MARKETING_NIGHT: '야간 광고 수신 동의',
    PARTNER: '파트너 이용약관',
  };
  /* ★ 제3자 제공은 **필수 동의**입니다 — 회원 간 전달이라
   *   위탁이 아닙니다(2026-09-16 결정).
   *   위탁(OUTSOURCE)은 고지 사항이라 필수에 넣지 않습니다 — v10.28 (G-218) 동의 항목도 아닌 「알림」(terms.is_notice · D042). */
  /* ★ 건강상품관은 직판이라 판매 약관이 필수입니다(C580). */
  const REQUIRED = ['SERVICE', 'PRIVACY', 'REFUND', 'THIRDPARTY', 'HLT_SALE'];
  const NOTICE = ['OUTSOURCE'];      // v10.28 (G-218 · D042) — 알림(동의를 받지 않음)
  for (const [code] of rows) {
    await c.query(
      `INSERT INTO terms(code, version, title, body, is_required, status, effective_from, is_notice)
       VALUES ($1,'1.0',$2,'(생성 대기)',$3,'LEGAL_REVIEW','infinity',$4)
       ON CONFLICT (code, version) DO NOTHING`,
      [code, TITLE[code] ?? code, REQUIRED.includes(code), NOTICE.includes(code)]);
  }

  // DB 에 초안 적재 — status 는 LEGAL_REVIEW 유지 (발행 아님)
  for (const [code, body] of rows) {
    await c.query(
      /* 발행된 약관은 건드리지 않습니다.
       *
       * 발행하면 이용자와의 계약 조건이 됩니다. 그 뒤에 생성기가 본문을
       * 덮으면 **이용자가 동의한 내용과 달라집니다.**
       *
       * 실제로 이번에 발행 직후 npm run docs 가 돌면서 status 는 남고
       * 본문만 초안으로 되돌아갔습니다. 그 상태로는 "무엇에 동의했는가"를
       * 증명할 수 없습니다.
       *
       * 고치려면 새 버전을 만들어 다시 발행하십시오. */
      /* 10/2 — **보관(ARCHIVED)된 판도 건드리지 않습니다.**
       *   전에는 `status <> 'PUBLISHED'` 라, 새 판(1.1)을 발행해 1.0 이 보관으로 넘어가면
       *   npm run docs 가 보관된 1.0 본문을 초안으로 덮었습니다 — 이용자가 동의했던 글이 바뀌는 것입니다. */
      `UPDATE terms SET body = $2
        WHERE code = $1 AND version = '1.0' AND status IN ('DRAFT','LEGAL_REVIEW')`,
      [code, body]);
  }
  await c.end();

  const holes = rows.reduce((n, [, b]) => n + (b.match(/〔[^〕]+〕/g) ?? []).length, 0);
  console.log(`약관 초안 ${rows.length}종 · docs/terms/ · 미확정 ${holes}곳`);
})().catch(e => { console.error(e.message); process.exit(1); });
