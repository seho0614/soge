/**
 * v10.523 (D278 · docs/661) 일본어 · 중국어(간체) — 기계 번역 초안 표시
 *
 *   사전: messages/ja.json · messages/zh.json(바탕 묶음만 · 머리줄 · 바닥줄 · 로그인 · 오류 화면 86문장) — 맨 위 "_draft" 칸이 초안 표시(화면에는 내려가지 않음)
 *   빠진 문장은 영어 → 한국어 순(messages/index.ts messagesFor) — 영어 사전을 바탕으로 덮음
 *   언어 단추에 나오는 때: 다국어(i18n.enabled) on + 그 언어 켜짐(i18n_langs.is_active) — 켜기는 검수 기록(사이트 · 서버 문장 승인)이 있어야 DB 가 받음
 *   검수가 끝나면 state 를 REVIEWED 로 · 서버 src/modules/i18n/lang-drafts.ts 의 같은 줄도 함께(test_v1523 이 둘을 견줌)
 */
export const DRAFT_LANGS = {
  ja: { state: 'MACHINE_DRAFT', keys: 86, version: 'v10.523' },
  zh: { state: 'MACHINE_DRAFT', keys: 86, version: 'v10.523' },
} as const;

/** 초안 언어의 빠진 문장을 채울 언어 */
export const LANG_FALLBACK: Record<string, string> = { ja: 'en', zh: 'en' };
