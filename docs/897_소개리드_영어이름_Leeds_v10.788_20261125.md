# 897. 소개리드 영어 이름 「Leeds」 — v10.788 (2026-11-25)

## 1. 결론

- 대표 결정(11/25 목록 ⑲): 소개리드(리드관 · LED)의 영어 이름을 **「Leeds」**로 바꿉니다(전: Consult Leads · v10.338 docs/471). 「Leads(리드)」가 아닌 고유 이름 「Leeds」임을 알려 드린 뒤 대표가 고른 이름입니다.
- 한국어 이름 「소개리드」 · 관 코드 LED · 주소 `/lead` 는 그대로입니다. 영어로 볼 때만 바뀝니다.

## 2. 바뀐 것

| 곳 | 전 → 뒤 |
|---|---|
| 사용자 웹 영어 머리줄 관 이름(`site/src/i18n/messages/en.json` header.gwan.LED) | Consult Leads → **Leeds** |
| 사용자 웹 `/lead` 영어 제목(`en/consult.json` lead.title) | Consult Leads → **Leeds** |
| 서버 영어 문장(`server-text.en.ts`) 3줄 — 리드관 켜기 법무 확인 · 법무 설정 SUPER · 허브 · 소개리드 업종 | 「The Consult Leads section …」 → 「The Leeds section …」 등 |
| 운영 화면 파트너사 › 파트너 › 리드 현황 머리 칸 | 리드관(소개리드 · Leeds) |
| spec/screens.json 메모 · keys.ts 주석 | 이름 바꿈 기록 |
| 시험 | test_v1338(판에 따라 기대 이름) · test_v1788 |

- 마이그레이션 없음 · 설정 없음 · DB 의 관 이름(한국어)은 그대로.

## 3. 운영 적용

- 코드만. 적용 뒤 확인(보기만): 사용자 웹 🌐 English › 머리줄 관 이름 「Leeds」(소개리드를 켠 뒤 보임) · `/lead` 제목 「Leeds」.
