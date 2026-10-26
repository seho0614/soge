import { AssumeName } from './switches';

/* ---------------------------------------------------------------------
 * v10.44 (2026-10-15 · 외부 연동 틀 통일) — 외부 연동 목록표
 *
 * 연동 하나를 「어디서 · 무엇으로 · 어떻게 켜고 끄는지」 한 줄로 적습니다.
 * **실행 중에는 읽지 않습니다**(동작에 영향 없음). 읽는 곳은 둘입니다.
 *   - 사람: 새 연동을 붙일 때 이 표부터 봅니다(docs/93 「새 연동 붙이는 법」).
 *   - 점검: scripts/check-integrations.ts 가 이 표 ↔ DB integrations 표 ↔ deploy/aws/env.production.example 을 대조합니다
 *           (통합 검정 verify-all.sh). 셋 중 하나만 바꾸면 검정이 알려 줍니다.
 *
 * 칸
 *   code         integrations.code (DB 줄이 없는 연동은 dbRow: false — 메일은 notify.* 설정으로 켭니다)
 *   secretEnv    키 환경 변수 — integrations.secret_key_name 과 같아야 합니다(값은 .env 에만)
 *   otherEnv     그 밖의 환경 변수(주소 · 경로 · 제한 시간). 업체를 정할 때 채우는 것들
 *   assume       간주 스위치 assume.<이름> (없으면 null)
 *   adapter      REAL = 실제로 부르는 구현 있음 · STUB = 스텁만(업체 형식 미정) · NONE = 아직 없음
 *   files        구현 파일 (sgb 기준)
 *   doc          절차 문서
 * ------------------------------------------------------------------- */

export interface IntegrationEntry {
  code: string;
  name: string;
  dbRow: boolean;
  secretEnv: string;
  otherEnv: string[];
  assume: AssumeName | null;
  adapter: 'REAL' | 'STUB' | 'NONE';
  files: string[];
  doc: string;
}

export const INTEGRATIONS: IntegrationEntry[] = [
  { code: 'PASS', name: '본인인증', dbRow: true, secretEnv: 'PASS_API_KEY', otherEnv: [], assume: null, adapter: 'STUB',
    files: ['src/modules/identity/verification.provider.ts'], doc: 'docs/93 3절 · NICE 묶음 안(decisions/open-blockers #4)' },
  { code: 'BANK', name: '1원 계좌인증', dbRow: true, secretEnv: 'BANK_VERIFY_KEY',
    otherEnv: ['BANK_VERIFY_URL', 'BANK_VERIFY_SEND_PATH', 'BANK_VERIFY_CONFIRM_PATH', 'BANK_VERIFY_AUTH_HEADER', 'BANK_VERIFY_AUTH_PREFIX', 'BANK_VERIFY_CODE_MODE'],
    assume: 'bank', adapter: 'REAL', files: ['src/modules/billing/bank-verify.provider.ts'], doc: 'bank-verify.provider.ts 머리말' },
  { code: 'NTS', name: '국세청 사업자 진위', dbRow: true, secretEnv: 'NTS_SERVICE_KEY', otherEnv: ['NTS_API_BASE', 'NTS_TIMEOUT_MS'], assume: null, adapter: 'REAL',
    files: ['src/modules/identity/verification.provider.ts'], doc: 'verification.provider.ts 머리말' },
  { code: 'PG', name: '전자결제(토스페이먼츠)', dbRow: true, secretEnv: 'TOSS_SECRET_KEY', otherEnv: ['TOSS_API_BASE', 'NEXT_PUBLIC_TOSS_CLIENT_KEY'], assume: 'payment', adapter: 'REAL',
    files: ['src/modules/billing/payment.provider.ts'], doc: 'docs/62 9절' },
  { code: 'ALIMTALK', name: '알림톡 · SMS', dbRow: true, secretEnv: 'ALIMTALK_KEY', otherEnv: [], assume: null, adapter: 'NONE',
    files: ['src/modules/partner/consult.service.ts'], doc: 'docs/93 3절(새 연동 붙이는 법의 예)' },
  { code: 'SAFENUM', name: '050 안심번호', dbRow: true, secretEnv: 'SAFENUM_KEY', otherEnv: [], assume: null, adapter: 'NONE',
    files: [], doc: '업체 미정' },
  { code: 'ESIGN', name: '전자계약', dbRow: true, secretEnv: 'ESIGN_API_KEY', otherEnv: [], assume: null, adapter: 'STUB',
    files: ['src/modules/deal/esign.provider.ts'], doc: 'esign.provider.ts 머리말' },
  { code: 'BROKER', name: '국토부 중개사 자격 대조', dbRow: true, secretEnv: 'BROKER_LOOKUP_KEY',
    otherEnv: ['BROKER_LOOKUP_URL', 'BROKER_LOOKUP_METHOD', 'BROKER_LOOKUP_KEY_PARAM', 'BROKER_LOOKUP_AUTH_HEADER', 'BROKER_LOOKUP_RESULT_PATH', 'BROKER_LOOKUP_RESULT_OK', 'BROKER_LOOKUP_ITEMS_PATH', 'BROKER_LOOKUP_ACTIVE'],
    assume: 'broker', adapter: 'REAL', files: ['src/modules/partner/broker-lookup.provider.ts'], doc: 'broker-lookup.provider.ts 머리말' },
  { code: 'ETAX', name: '전자세금계산서', dbRow: true, secretEnv: 'ETAX_KEY', otherEnv: ['ETAX_URL', 'ETAX_TIMEOUT_MS'], assume: 'etax', adapter: 'REAL',
    files: ['src/modules/etax/etax.adapter.ts', 'src/modules/etax/etax.http.ts', 'src/modules/etax/etax.assume.ts'], doc: 'docs/전자세금계산서_연동절차.md' },
  { code: 'MAIL', name: '메일(Amazon SES SMTP)', dbRow: false, secretEnv: 'SMTP_PASS',
    otherEnv: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'MAIL_FROM', 'MAIL_FROM_NAME', 'SMTP_TIMEOUT_MS'], assume: null, adapter: 'REAL',
    files: ['src/common/mail/smtp.ts', 'src/common/mail/mail.service.ts'], doc: 'docs/92 5 ~ 8절' },
  /* v10.46 (D099) — 키는 운영 화면(외부 연동 › 카카오맵 키)에서 넣어 암호화 저장이 먼저, 없으면 .env. 간주 스위치 대신 map.enabled(처음 off) */
  { code: 'MAP', name: '지도 · 주소 좌표(카카오맵)', dbRow: true, secretEnv: 'KAKAO_REST_KEY',
    otherEnv: ['NEXT_PUBLIC_KAKAO_JS_KEY', 'KAKAO_LOCAL_BASE', 'KAKAO_LOCAL_TIMEOUT_MS'], assume: null, adapter: 'REAL',
    files: ['src/common/geo/kakao-local.provider.ts', 'src/common/geo/geo.service.ts', 'src/modules/geo/geo.controller.ts', 'site/src/components/map/KakaoMap.tsx'],
    doc: 'docs/96' },
  /* v10.49 (D103) — 메인 「오늘의 날씨」. 키는 카카오맵과 같이 운영 화면(외부 연동 › 날씨 키)에서 넣어 암호화 저장이 먼저, 없으면 .env. 스위치 weather.enabled(처음 off) */
  { code: 'WEATHER', name: '날씨(기상청 단기예보)', dbRow: true, secretEnv: 'KMA_SERVICE_KEY',
    otherEnv: ['KMA_API_BASE', 'KMA_TIMEOUT_MS'], assume: null, adapter: 'REAL',
    files: ['src/modules/weather/weather.provider.ts', 'src/modules/weather/weather.service.ts', 'src/modules/weather/weather.controller.ts', 'site/src/components/home/Weather.tsx'],
    doc: 'docs/101' },
  /* v10.111 (D122) — AI(Anthropic Claude). 키는 운영 화면(AI 운영 › AI 에이전트 › 「AI 키」 · SUPER)에서 넣어 암호화 저장이 먼저, 없으면 .env.
   * 부를지 말지는 agent.enabled · 통로 스위치 · 월 상한(fn_agent_allowed). AGENT_PROVIDER=MOCK 은 점검판 시험 엔진 */
  { code: 'AGENT', name: 'AI(Anthropic Claude)', dbRow: true, secretEnv: 'ANTHROPIC_API_KEY',
    otherEnv: ['AGENT_PROVIDER'], assume: null, adapter: 'REAL',
    files: ['src/modules/agent/agent.provider.ts', 'src/modules/agent/agent.service.ts', 'src/modules/agent/agent.controller.ts', 'web/src/app/admin/ailearn/AgentKey.tsx'],
    doc: 'docs/173' },
];
