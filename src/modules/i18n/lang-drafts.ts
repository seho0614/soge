/**
 * v10.523 (D278 · docs/661) 일본어 · 중국어(간체) 사전 현황 — 운영 화면 › 관 관리 › 일본어 · 중국어 검수(SB-ADM-OAPI-030)가 읽음
 *
 *   서버는 사용자 웹 파일(site/)을 읽지 않으므로 사용자 웹 사전 문장 수를 여기에 적어 둠 — site/src/i18n/drafts.ts 와 같은 값(test_v1523 이 견줌)
 *   koBase = 사용자 웹 한국어 바탕 사전(ko.json) 문장 수(이 판 기준 · 늘면 바꿈 — 다른 묶음이 ko.json 에 upt · 간편 로그인 등을 더해 354 → 456) · 묶음(ko/*.json)은 아직 번역하지 않음(영어로 나감)
 */
export const DRAFT_LANG_CODES = ['ja', 'zh'] as const;
export type DraftLang = (typeof DRAFT_LANG_CODES)[number];

export const SITE_DRAFTS: Record<DraftLang, { state: 'MACHINE_DRAFT' | 'REVIEWED'; keys: number; koBase: number; namespaces: number; version: string }> = {
  ja: { state: 'MACHINE_DRAFT', keys: 86, koBase: 456, namespaces: 0, version: 'v10.523' },
  zh: { state: 'MACHINE_DRAFT', keys: 86, koBase: 456, namespaces: 0, version: 'v10.523' },
};
