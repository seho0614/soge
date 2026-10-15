# 소개뱅크 — API 스키마 리스트 v1

**자동 생성** `node scripts/gen-api-list.js` · 원본 `docs/06_openapi.json`
**640 오퍼레이션** · 스키마 정의 640 / 미정의 0

`✔` 스키마 정의됨 · `·` 미정의 — 컨트롤러에 `@nestjs/swagger` 데코레이터를 부착하면 자동으로 바뀝니다

## 요약

| 그룹 | API | P0 | 스키마 정의 |
|---|---:|---:|---:|
| HOM · 공통 | 98 | 71 | 98 |
| MNY · 소개장터 | 23 | 13 | 23 |
| MAL · 안심소개 | 21 | 10 | 21 |
| BIZ · 소개창업 | 16 | 11 | 16 |
| MYP · 마이페이지 | 64 | 39 | 64 |
| ADM · 백오피스 | 297 | 52 | 297 |
| **합계** | **640** | **196** | **640** |

## HOM · 공통

| | 우선 | Method | 경로 | 용도 | 화면 | 역할 | 게이트 |
|:-:|:-:|---|---|---|---|---|---|
| ✔ | P0 | `POST` | `/ads/{id}/click` | 클릭 기록 | `SB-HOM-MAIN-011` `SB-HOM-MAIN-010`… | GUEST |  |
| ✔ | P0 | `POST` | `/ads/{id}/impression` | 노출 기록 | `SB-HOM-MAIN-011` `SB-HOM-MAIN-010`… | GUEST |  |
| ✔ | P0 | `GET` | `/ads/infeed` | 목록 인피드 광고 | `SB-HOM-MAIN-010` | MEMBER/B_OWNER/B_STAFF |  |
| ✔ | P0 | `GET` | `/ads/serve` | 슬롯 소재 조회 | `SB-HOM-MAIN-011` `SB-HOM-MAIN-010`… | GUEST |  |
| ✔ | P0 | `GET` | `/ai/recommend/request` | 내 요청의 추천 후보 | `SB-HOM-REQ-030` `SB-AIS-REC-010` | MEMBER | IDENTITY |
| ✔ | P0 | `POST` | `/auth/login` | 로그인 | `SB-HOM-AUT-010` | GUEST |  |
| ✔ | P0 | `POST` | `/auth/refresh` | 토큰 재발급 | `SB-HOM-AUT-010` | GUEST |  |
| ✔ | P0 | `POST` | `/auth/signup` | 회원가입 | `SB-HOM-AUT-020` | GUEST |  |
| ✔ | P0 | `POST` | `/businesses` | 사업자 신청 | `SB-HOM-AUT-030` `SB-MYP-BIZ-020` | MEMBER |  |
| ✔ | P0 | `GET` | `/categories` | 업종 목록 | `SB-HOM-REG-010` `SB-MAL-MAIN-010` | B_OWNER/B_STAFF | IDENTITY |
| ✔ | P0 | `GET` | `/codes` | 코드 라벨 번들 | `SB-HOM-REG-010` `SB-HOM-CSB-010`… | B_OWNER/B_STAFF | IDENTITY |
| ✔ | 홈 | `GET` | `/community/board` | 글 목록 — 쪽 번호 · 게시글 검색 | `SB-HOM-CMU-010` | GUEST/MEMBER |  |
| ✔ | 홈 | `POST` | `/community/classify` | 본문으로 게시판 추천 | `SB-HOM-CMU-030` | MEMBER |  |
| ✔ | P0 | `GET` | `/community/polls` | 투표 목록 | `SB-HOM-MAIN-011` `SB-HOM-MAIN-010`… | GUEST |  |
| ✔ | 홈 | `GET` | `/community/polls/{id}` | 투표 1건 · 결과 | `SB-HOM-CMU-040` | GUEST/MEMBER |  |
| ✔ | P0 | `POST` | `/community/polls/{id}/vote` | 투표하기 | `SB-HOM-MAIN-011` `SB-HOM-MAIN-010`… | GUEST |  |
| ✔ | P0 | `GET` | `/community/posts` | 글 목록 | `SB-HOM-MAIN-011` `SB-HOM-MAIN-010`… | GUEST |  |
| ✔ | 홈 | `GET` | `/community/posts/{id}` | 글 상세 · 댓글 | `SB-HOM-CMU-020` | GUEST/MEMBER |  |
| ✔ | P0 | `POST` | `/conversations` | 1:1 문의 시작 | `SB-HOM-MCH-010` | B_OWNER/B_STAFF | IDENTITY BUSINESS |
| ✔ | P0 | `POST` | `/conversations/{id}/deal` | Deal 생성 | `SB-HOM-MCH-010` | B_OWNER/B_STAFF | IDENTITY BUSINESS |
| ✔ | P0 | `GET` | `/conversations/{id}/messages` | 메시지 목록 | `SB-HOM-MCH-010` | B_OWNER/B_STAFF | IDENTITY BUSINESS |
| ✔ | P0 | `POST` | `/conversations/{id}/messages` | 메시지 보내기 | `SB-HOM-MCH-010` | B_OWNER/B_STAFF | IDENTITY BUSINESS |
| ✔ | P0 | `GET` | `/conversations/{id}/summary` | 1:1 문의 요약 (시안 scAsk 머리 · 오른쪽 칸) | `SB-HOM-MCH-010` | B_OWNER/B_STAFF | IDENTITY BUSINESS |
| ✔ | P0 | `POST` | `/conversations/check` | 보내기 전 확인 | `SB-HOM-MCH-010` | B_OWNER/B_STAFF | IDENTITY BUSINESS |
| ✔ | P0 | `POST` | `/deals/{id}/confirm` | 성사 확정 (수동) | `SB-HOM-DEL-030` | B_OWNER/B_STAFF/MEMBER | IDENTITY |
| ✔ | P0 | `POST` | `/deals/{id}/contract` | 계약서 발급 | `SB-HOM-DEL-010` | B_OWNER/B_STAFF/MEMBER | IDENTITY |
| ✔ | P0 | `POST` | `/deals/{id}/contract/sign` | 계약서 서명 | `SB-HOM-DEL-010` `SB-MYP-CTR-020` | B_OWNER/B_STAFF/MEMBER | IDENTITY |
| ✔ | P0 | `POST` | `/deals/{id}/fee` | 소개비 제안 | `SB-HOM-DEL-010` | B_OWNER/B_STAFF/MEMBER | IDENTITY |
| ✔ | P0 | `POST` | `/deals/{id}/fee/{version}/agree` | 소개비 동의 | `SB-HOM-DEL-010` | B_OWNER/B_STAFF/MEMBER | IDENTITY |
| ✔ | P0 | `POST` | `/deals/{id}/payment-report` | 대금 지급 신고 | `SB-HOM-DEL-020` | B_OWNER/B_STAFF/MEMBER | IDENTITY |
| ✔ | P0 | `GET` | `/deals/{id}/safe-trade` | 이 거래의 안전거래 상태(당사자) | `SB-HOM-DEL-010` `SB-MNY-SAF-020` | B_OWNER/B_STAFF/MEMBER | IDENTITY |
| ✔ | P0 | `POST` | `/deals/{id}/safe-trade` | 안전거래 합의(당사자 한쪽) | `SB-HOM-DEL-010` `SB-MNY-SAF-020` | B_OWNER/B_STAFF/MEMBER | IDENTITY |
| ✔ | P0 | `GET` | `/deals/{id}/summary` | 거래 정보(시안 거래 구간 머리) | `SB-HOM-MCH-010` `SB-HOM-DEL-010` | B_OWNER/B_STAFF | IDENTITY BUSINESS |
| ✔ | P0 | `GET` | `/footer-links` | 푸터 링크 | `SB-HOM-MAIN-011` `SB-HOM-MAIN-010`… | GUEST |  |
| ✔ | P0 | `GET` | `/gwans` | 관 목록 | `SB-HOM-MAIN-011` `SB-HOM-MAIN-010`… | GUEST |  |
| ✔ | P0 | `GET` | `/gwans/{code}/form-copy` | 관별 등록 폼 문구 | `SB-HOM-REG-010` `SB-BIZ-REG-010` | B_OWNER/B_STAFF | IDENTITY |
| ✔ | P0 | `GET` | `/health/products` | 상품 목록 | `SB-HOM-MAIN-011` `SB-HOM-MAIN-010`… | GUEST |  |
| ✔ | P0 | `GET` | `/invites/{token}` | 초대 확인 (비회원) | `SB-HOM-INV-010` | GUEST |  |
| ✔ | P0 | `POST` | `/invites/{token}/consent` | 동의 · 거절 | `SB-HOM-INV-010` | GUEST |  |
| ✔ | P0 | `GET` | `/listings` | 매물 목록 | `SB-HOM-MAIN-011` `SB-HOM-MAIN-010`… | GUEST |  |
| ✔ | P0 | `POST` | `/listings` | 매물 등록 | `SB-HOM-REG-010` `SB-BIZ-REG-010`… | B_OWNER/B_STAFF | IDENTITY |
| ✔ | P0 | `POST` | `/listings/{id}/photos` | 매물 사진 붙이기 (주인) | `SB-HOM-REG-020` `SB-MYP-LST-010` | B_OWNER/B_STAFF | IDENTITY |
| ✔ | P0 | `DELETE` | `/listings/{id}/photos/{mediaId}` | 매물 사진 떼기 (주인) | `SB-HOM-REG-020` `SB-MYP-LST-010` | B_OWNER/B_STAFF | IDENTITY |
| ✔ | P0 | `GET` | `/listings/{id}/questions` | 공개 문의 목록 | `SB-HOM-MCH-020` `SB-MNY-DTL-010`… | GUEST |  |
| ✔ | P0 | `GET` | `/market/requests` | 지금 올라온 소개 요청 — 종류 · 지역 · 사진 | `SB-HOM-REQ-020` `SB-MNY-MAIN-010` | GUEST |  |
| ✔ | P0 | `PATCH` | `/market/requests/{id}` | 내 요청의 종류 · 지역 · 사진 | `SB-HOM-REQ-010` `SB-HOM-REQ-030` | B_OWNER/B_STAFF | IDENTITY |
| ✔ | P0 | `GET` | `/market/requests/{id}/photo` | 요청 사진 (공개) | `SB-HOM-REQ-010` `SB-HOM-REQ-030` | B_OWNER/B_STAFF | IDENTITY |
| ✔ | 홈 | `DELETE` | `/me/community/posts/{id}` | 글 삭제 | `SB-HOM-CMU-030` | MEMBER |  |
| ✔ | 홈 | `PATCH` | `/me/community/posts/{id}` | 글 수정 | `SB-HOM-CMU-030` | MEMBER |  |
| ✔ | P0 | `GET` | `/me/summary` | 내 요약 | `SB-HOM-MAIN-010` `SB-MYP-DSH-010` | MEMBER/B_OWNER/B_STAFF |  |
| ✔ | P0 | `GET` | `/notices` | 공지 | `SB-HOM-MAIN-010` `SB-AFC-NTC-010` | MEMBER/B_OWNER/B_STAFF |  |
| ✔ | P0 | `GET` | `/requests` | 소개받기 목록 | `SB-HOM-MAIN-011` `SB-HOM-MAIN-010`… | GUEST |  |
| ✔ | P0 | `POST` | `/requests` | 소개받기 등록 | `SB-HOM-REQ-010` | B_OWNER/B_STAFF | IDENTITY |
| ✔ | P0 | `GET` | `/requests/{id}` | 요청 상세 | `SB-HOM-REQ-030` | MEMBER | IDENTITY |
| ✔ | P0 | `GET` | `/requests/{id}/images/{n}` | 요청 이미지 | `SB-HOM-REQ-030` | MEMBER | IDENTITY |
| ✔ | P0 | `GET` | `/requests/{id}/proposals` | 제안 목록 | `SB-HOM-REQ-030` | MEMBER | IDENTITY |
| ✔ | P0 | `POST` | `/requests/{id}/proposals` | 소개 제안 | `SB-HOM-REQ-030` | MEMBER | IDENTITY |
| ✔ | P0 | `POST` | `/requests/{id}/proposals/{pid}/decision` | 제안 수락 · 거절 | `SB-HOM-REQ-030` | MEMBER | IDENTITY |
| ✔ | P0 | `GET` | `/restrictions` | 제한업종 목록 | `SB-HOM-REG-010` `SB-HOM-REQ-010` | B_OWNER/B_STAFF | IDENTITY |
| ✔ | P0 | `POST` | `/restrictions/check` | 제한업종 검사 | `SB-HOM-REG-010` `SB-HOM-REQ-010` | B_OWNER/B_STAFF | IDENTITY |
| ✔ | P0 | `GET` | `/search` | 통합 검색 | `SB-HOM-SRC-010` | GUEST |  |
| ✔ | P0 | `GET` | `/search/keywords` | 많이 찾는 키워드 | `SB-HOM-SRC-010` `SB-MNY-MAIN-010` | GUEST |  |
| ✔ | P0 | `POST` | `/search/log` | 검색어 집계 | `SB-HOM-SRC-010` | GUEST |  |
| ✔ | P0 | `POST` | `/signup/biz-check` | 사업자등록번호 조회 (가입 전) | `SB-HOM-AUT-020` | GUEST |  |
| ✔ | P0 | `POST` | `/signup/profile-analyze` | 성향 진단 (가입 화면용 · 저장 안 함) | `SB-HOM-AUT-020` | GUEST |  |
| ✔ | P0 | `GET` | `/signup/profile-questions` | 성향 문항 (가입 화면용 · 공개) | `SB-HOM-AUT-020` | GUEST |  |
| ✔ | P0 | `GET` | `/signup/types` | 가입 유형 | `SB-HOM-AUT-020` | GUEST |  |
| ✔ | P0 | `GET` | `/site-settings/public` | 공개 설정 | `SB-HOM-MAIN-011` `SB-HOM-MAIN-010`… | GUEST |  |
| ✔ | P0 | `GET` | `/site/landing` | 로그인 후 랜딩 | `SB-HOM-MAIN-010` | MEMBER/B_OWNER/B_STAFF |  |
| ✔ | P0 | `GET` | `/terms` | 약관 목록 | `SB-HOM-AUT-020` `SB-HOM-ETC-020`… | GUEST |  |
| ✔ | P0 | `POST` | `/terms/agree` | 약관 동의 | `SB-HOM-ETC-020` `SB-HOM-ETC-022` | GUEST |  |
| ✔ | P0 | `GET` | `/terms/agreements` | 내 동의 이력 | `SB-HOM-ETC-020` | GUEST |  |
| ✔ | P0 | `GET` | `/terms/doc/{code}` | 약관 한 건 (전문) | `SB-HOM-ETC-020` `SB-HOM-ETC-021` | GUEST |  |
| ✔ | P0 | `GET` | `/terms/index` | 약관 전체 목록 | `SB-HOM-ETC-020` `SB-HOM-ETC-021` | GUEST |  |
| ✔ | P0 | `GET` | `/terms/required` | 동의해야 하는 약관 | `SB-HOM-ETC-020` `SB-HOM-ETC-022` | GUEST |  |
| ✔ | P0 | `GET` | `/ui-messages` | 화면 고정 문구 | `SB-HOM-REG-010` `SB-HOM-CSB-010`… | B_OWNER/B_STAFF | IDENTITY |
| ✔ | P0 | `POST` | `/verifications/identity` | 본인인증 | `SB-HOM-AUT-030` | MEMBER |  |
| ✔ | P1 | `POST` | `/deals/{id}/reviews` | 후기 작성 | `SB-HOM-RVW-010` | B_OWNER | BUSINESS |
| ✔ | P1 | `POST` | `/disputes` | 분쟁 접수 | `SB-HOM-ETC-010` | MEMBER |  |
| ✔ | P1 | `GET` | `/faq` | 자주 묻는 질문 | `SB-HOM-CSB-010` | GUEST |  |
| ✔ | P1 | `POST` | `/files` | 파일 올릴 자리 만들기 | `SB-HOM-ETC-010` `SB-ADM-HPR-010`… | MEMBER |  |
| ✔ | P1 | `POST` | `/files/{id}/complete` | 올리기 확인 | `SB-HOM-ETC-010` `SB-ADM-HPR-010`… | MEMBER |  |
| ✔ | P1 | `POST` | `/inquiries` | 고객센터 문의 | `SB-HOM-CSB-010` `SB-HOM-ETC-030` | GUEST |  |
| ✔ | P1 | `PATCH` | `/listings/{id}` | 매물 수정 (재검수) | `SB-HOM-REG-020` | B_OWNER/B_STAFF | IDENTITY |
| ✔ | P1 | `POST` | `/listings/{id}/questions` | 공개 문의 등록 | `SB-HOM-MCH-020` | GUEST |  |
| ✔ | P1 | `PATCH` | `/listings/questions/{qid}/answer` | 공개 문의 답변 | `SB-HOM-MCH-020` | GUEST |  |
| ✔ | 홈 | `POST` | `/me/community/posts` | 글쓰기 | `SB-HOM-CMU-030` | MEMBER |  |
| ✔ | 홈 | `POST` | `/me/community/posts/{id}/comments` | 댓글 | `SB-HOM-CMU-020` | GUEST/MEMBER |  |
| ✔ | P1 | `GET` | `/me/disputes` | 내 분쟁 | `SB-HOM-ETC-010` | MEMBER |  |
| ✔ | P1 | `GET` | `/me/inquiries` | 내 문의 내역 | `SB-HOM-CSB-020` | MEMBER |  |
| ✔ | P1 | `DELETE` | `/me/listings/{id}/draft` | 수정 초안 버리기 | `SB-HOM-REG-020` | B_OWNER/B_STAFF | IDENTITY |
| ✔ | P1 | `GET` | `/me/listings/{id}/draft` | 수정 초안 보기 | `SB-HOM-REG-020` | B_OWNER/B_STAFF | IDENTITY |
| ✔ | P1 | `PUT` | `/me/listings/{id}/draft` | 수정 초안 저장 | `SB-HOM-REG-020` | B_OWNER/B_STAFF | IDENTITY |
| ✔ | P1 | `GET` | `/me/listings/{id}/review` | 내 매물 검수 결과 · 이력 | `SB-HOM-REG-020` | B_OWNER/B_STAFF | IDENTITY |
| ✔ | P2 | `GET` | `/report-reasons` | 신고 사유 목록 | `SB-HOM-RPT-010` | MEMBER/B_OWNER | IDENTITY |
| ✔ | P2 | `POST` | `/reports` | 신고 접수 | `SB-HOM-RPT-010` | MEMBER/B_OWNER | IDENTITY |
| ✔ | 홈 | `POST` | `/search/prompt` | 프롬프트 검색 | `SB-HOM-SCH-020` | GUEST/MEMBER/B_OWNER |  |
| ✔ | 홈 | `GET` | `/search/suggest` | 검색 팝업 재료 | `SB-HOM-SCH-020` | GUEST/MEMBER/B_OWNER |  |

## MNY · 소개장터

| | 우선 | Method | 경로 | 용도 | 화면 | 역할 | 게이트 |
|:-:|:-:|---|---|---|---|---|---|
| ✔ | P0 | `GET` | `/gwans/{code}` | 관 단건 | `SB-MNY-MAIN-010` `SB-MAL-MAIN-010`… | GUEST |  |
| ✔ | P0 | `POST` | `/listings/{id}/badges` | 급구 · 급매 표시 신청 | `SB-MNY-URG-010` `SB-MYP-LST-010` | GUEST |  |
| ✔ | P0 | `GET` | `/listings/{id}/images/{n}` | 매물 이미지 | `SB-MNY-DTL-010` `SB-MAL-DTL-010`… | GUEST |  |
| ✔ | P0 | `GET` | `/listings/{id}/photos/{n}` | 매물 사진 (공개) | `SB-MNY-DTL-010` `SB-MAL-DTL-010`… | GUEST |  |
| ✔ | P0 | `GET` | `/listings/{id}/reviews` | 등록자(소개자) 후기 | `SB-MNY-DTL-010` `SB-MAL-DTL-010`… | GUEST |  |
| ✔ | P0 | `GET` | `/market/regions` | 지역으로 찾기 — 시 · 도와 게시 매물 수 | `SB-MNY-MAIN-010` `SB-MAL-MAIN-010`… | GUEST |  |
| ✔ | P0 | `GET` | `/market/success` | 성공현황 | `SB-MNY-MAIN-010` `SB-MNY-BST-010` | GUEST |  |
| ✔ | P0 | `GET` | `/market/success/recent` | 최근 실제 연결 사례 | `SB-MNY-MAIN-010` `SB-MNY-BST-010` | GUEST |  |
| ✔ | P0 | `GET` | `/market/suppliers` | 서비스 업체 추천 — 업체 단위 목록 | `SB-MNY-MAIN-010` `SB-MAL-MAIN-010`… | GUEST |  |
| ✔ | P0 | `GET` | `/market/suppliers/{id}` | 업체 프로필 | `SB-MNY-MAIN-010` `SB-MAL-MAIN-010`… | GUEST |  |
| ✔ | P0 | `GET` | `/market/suppliers/recommended` | AI 추천 맞춤 공급자 | `SB-MNY-MAIN-010` `SB-MAL-MAIN-010`… | GUEST |  |
| ✔ | P0 | `DELETE` | `/me/favorites/{targetId}` | 관심 해제 | `SB-MNY-DTL-010` `SB-MAL-DTL-010`… | GUEST |  |
| ✔ | P0 | `POST` | `/me/favorites/{targetId}` | 관심 등록 | `SB-MNY-DTL-010` `SB-MAL-DTL-010`… | GUEST |  |
| ✔ | P2 | `GET` | `/events` | 진행 중인 이벤트 | `SB-MNY-EVT-010` | GUEST |  |
| ✔ | P2 | `GET` | `/events/{code}` | 이벤트 상세 | `SB-MNY-EVT-010` | GUEST |  |
| ✔ | P2 | `POST` | `/events/{code}/join` | 이벤트 참여 | `SB-MNY-EVT-010` | GUEST |  |
| ✔ | P2 | `GET` | `/market/best` | 베스트매칭 사례 | `SB-MNY-BST-010` | GUEST |  |
| ✔ | P2 | `POST` | `/market/success-stories/{id}/consent` | 베스트매칭 사례 공개 동의 · 철회 | `SB-MNY-BST-010` | GUEST |  |
| ✔ | P2 | `GET` | `/me/success-stories` | 내가 당사자인 베스트매칭 사례(공개 동의) | `SB-MNY-BST-010` | GUEST |  |
| ✔ | P2 | `GET` | `/safety/cases` | 피해 사례 게시판 | `SB-MNY-SAF-010` `SB-MNY-SAF-020` | GUEST |  |
| ✔ | P2 | `POST` | `/safety/cases` | 피해 사례 작성 | `SB-MNY-SAF-010` `SB-MNY-SAF-020` | GUEST |  |
| ✔ | P2 | `GET` | `/safety/cases/{no}` | 피해 사례 보기(조회 수 +1) | `SB-MNY-SAF-010` `SB-MNY-SAF-020` | GUEST |  |
| ✔ | P2 | `GET` | `/safety/safe-trade` | 안전거래 이용 안내(B-04) | `SB-MNY-SAF-010` `SB-MNY-SAF-020` | GUEST |  |

## MAL · 안심소개

| | 우선 | Method | 경로 | 용도 | 화면 | 역할 | 게이트 |
|:-:|:-:|---|---|---|---|---|---|
| ✔ | P0 | `POST` | `/attribution/touch` | 소개코드 유입 기록 | `SB-MAL-DTL-010` | GUEST |  |
| ✔ | P0 | `GET` | `/consult/categories` | 상담 업종 목록 | `SB-MAL-MAIN-010` `SB-MAL-CSL-010`… | GUEST |  |
| ✔ | P1 | `GET` | `/consult/categories/{code}` | 상담 업종 상세 | `SB-MAL-CSL-025` | GUEST/MEMBER/B_OWNER |  |
| ✔ | P1 | `GET` | `/consult/directory/{code}` | 정액 노출 업체 목록 | `SB-MAL-CSL-025` | GUEST/MEMBER/B_OWNER |  |
| ✔ | P1 | `POST` | `/consult/requests` | 상담 신청 | `SB-MAL-CSL-010` `SB-MAL-CSL-030` | GUEST/MEMBER/B_OWNER |  |
| ✔ | P1 | `POST` | `/consult/requests/{id}/verify` | 휴대폰 확인 → 업체 1곳 전달 | `SB-MAL-CSL-010` `SB-MAL-CSL-030` | GUEST/MEMBER/B_OWNER |  |
| ✔ | 안심소개 | `DELETE` | `/files/{id}` | 내 파일 지우기 | `SB-MAL-BRK-010` `SB-AFF-MTR-010` | MEMBER/B_OWNER |  |
| ✔ | 안심소개 | `GET` | `/files/{id}` | 파일 열기 (짧게 유효한 주소) | `SB-MAL-BRK-010` `SB-ADM-OWN-010`… | MEMBER/B_OWNER |  |
| ✔ | 안심소개 | `GET` | `/files/{id}/content` | (개발 · 로컬 저장소) 바이트 내려받기 | `SB-MAL-BRK-010` `SB-ADM-OWN-010`… | MEMBER/B_OWNER |  |
| ✔ | 안심소개 | `PUT` | `/files/{id}/content` | (개발 · 로컬 저장소) 바이트 올리기 | `SB-MAL-BRK-010` `SB-AFF-MTR-010` | MEMBER/B_OWNER |  |
| ✔ | P0 | `GET` | `/listings/{id}` | 매물 상세 | `SB-MAL-GIV-010` `SB-MNY-DTL-010`… | GUEST/MEMBER/B_OWNER |  |
| ✔ | P1 | `GET` | `/me/consult-requests` | 내 상담 신청 | `SB-MAL-CSL-010` | GUEST/MEMBER/B_OWNER |  |
| ✔ | 안심소개 | `GET` | `/me/listings/{id}/ownership` | 내 소유 확인 상태 | `SB-MAL-BRK-010` | MEMBER/B_OWNER |  |
| ✔ | 안심소개 | `POST` | `/me/listings/{id}/ownership` | 등기사항증명서 제출 | `SB-MAL-BRK-010` | MEMBER/B_OWNER |  |
| ✔ | P0 | `GET` | `/me/referral-codes` | 내 소개코드 | `SB-MAL-GIV-010` `SB-MYP-SUB-010` | GUEST/MEMBER/B_OWNER |  |
| ✔ | P0 | `GET` | `/me/referral-codes/quota` | 이번 달 소개코드 현황 | `SB-MAL-GIV-010` `SB-MAL-DTL-010` | GUEST/MEMBER/B_OWNER |  |
| ✔ | P0 | `GET` | `/me/subscription` | 구독 현황 | `SB-MAL-MAIN-010` `SB-MYP-SUB-010` | GUEST |  |
| ✔ | P0 | `GET` | `/partner/dashboard` | 파트너 홈 | `SB-MAL-MAIN-010` `SB-PTC-DSH-010`… | GUEST |  |
| ✔ | P0 | `POST` | `/referral-codes` | 소개코드 발급 | `SB-MAL-GIV-010` `SB-MAL-DTL-010`… | GUEST/MEMBER/B_OWNER |  |
| ✔ | P0 | `GET` | `/site/gwan-axes` | 관 축(노출 중) | `SB-MAL-MAIN-010` `SB-BIZ-MAIN-010` | GUEST |  |
| ✔ | P0 | `GET` | `/subscription-plans` | 요금제 | `SB-MAL-MAIN-010` `SB-MAL-GIV-010`… | GUEST |  |

## BIZ · 소개창업

| | 우선 | Method | 경로 | 용도 | 화면 | 역할 | 게이트 |
|:-:|:-:|---|---|---|---|---|---|
| ✔ | P0 | `POST` | `/biz/axis` | 축 항목 올리기 | `SB-BIZ-MAIN-010` `SB-BIZ-REG-010` | GUEST |  |
| ✔ | P0 | `POST` | `/biz/axis-requests/{id}/answer` | 받은 요청에 회신 | `SB-BIZ-MAIN-010` `SB-BIZ-LST-010` | GUEST |  |
| ✔ | P0 | `GET` | `/biz/axis-requests/{no}` | 내 항목이 받은 요청(올린 사람) | `SB-BIZ-MAIN-010` `SB-BIZ-LST-010` | GUEST |  |
| ✔ | P0 | `GET` | `/biz/axis/{kind}` | 축 목록 | `SB-BIZ-MAIN-010` `SB-BIZ-LST-010` | GUEST |  |
| ✔ | P0 | `GET` | `/biz/axis/{kind}/{no}` | 축 항목 상세(공고 · 자문 서비스 · 정책 · 교육) | `SB-BIZ-MAIN-010` `SB-BIZ-LST-010` | GUEST |  |
| ✔ | P0 | `POST` | `/biz/axis/{no}/requests` | 업체 소개 요청(공고) · 견적 요청(자문) | `SB-BIZ-MAIN-010` `SB-BIZ-LST-010` | GUEST |  |
| ✔ | P0 | `PATCH` | `/biz/axis/{no}/status` | 축 항목 마감 · 다시 열기 · 숨김(운영) | `SB-BIZ-MAIN-010` `SB-BIZ-REG-010` | GUEST |  |
| ✔ | P3 | `GET` | `/biz/policies/{no}/source` | 지원사업 공고 원문(SB-BIZ-POL-030) | `SB-BIZ-POL-030` | GUEST |  |
| ✔ | P0 | `GET` | `/biz/quick` | 빠른 매칭 — 열린 요청(14일) | `SB-BIZ-MAIN-010` `SB-BIZ-LST-010` | GUEST |  |
| ✔ | P0 | `POST` | `/biz/quick` | 빠른 매칭 요청 올리기 | `SB-BIZ-MAIN-010` `SB-BIZ-LST-010` | GUEST |  |
| ✔ | P0 | `POST` | `/biz/quick/{id}/close` | 내 빠른 매칭 요청 닫기 | `SB-BIZ-MAIN-010` `SB-BIZ-LST-010` | GUEST |  |
| ✔ | P0 | `POST` | `/biz/quick/{id}/offer` | 빠른 매칭에 회신(본인인증 회원) | `SB-BIZ-MAIN-010` `SB-BIZ-LST-010` | GUEST |  |
| ✔ | P2 | `GET` | `/me/broker/extra` | 내 중개사 인증 — 보증(공제) · 제출 서류 | `SB-BIZ-BRK-010` `SB-BIZ-BRK-011` | MEMBER/B_OWNER | IDENTITY |
| ✔ | P2 | `PUT` | `/me/broker/extra` | 내 중개사 인증 — 보증(공제) · 제출 서류 저장 | `SB-BIZ-BRK-010` `SB-BIZ-BRK-011` | MEMBER/B_OWNER | IDENTITY |
| ✔ | P2 | `GET` | `/partner/broker` | 내 중개사 인증 상태 | `SB-BIZ-BRK-010` `SB-BIZ-BRK-011` | MEMBER/B_OWNER | IDENTITY |
| ✔ | P2 | `POST` | `/partner/broker` | 중개사 인증 신청 | `SB-BIZ-BRK-010` | MEMBER/B_OWNER | IDENTITY |

## MYP · 마이페이지

| | 우선 | Method | 경로 | 용도 | 화면 | 역할 | 게이트 |
|:-:|:-:|---|---|---|---|---|---|
| ✔ | P0 | `GET` | `/features` | 기능 스위치 | `SB-MYP-SUB-010` `SB-MYP-STL-010` | B_OWNER | SUBSCRIPTION |
| ✔ | P0 | `POST` | `/listings/{id}/archive` | 매물 내리기 | `SB-MYP-LST-010` | B_OWNER/B_STAFF |  |
| ✔ | P0 | `DELETE` | `/me/billing-key` | 결제 수단 삭제 | `SB-MYP-PAY-010` | MEMBER |  |
| ✔ | P0 | `GET` | `/me/billing-key` | 등록된 결제 수단 | `SB-MYP-PAY-010` | MEMBER |  |
| ✔ | P0 | `POST` | `/me/billing-key` | 결제 수단 등록 | `SB-MYP-PAY-010` | MEMBER |  |
| ✔ | P0 | `GET` | `/me/conversations` | 받은 문의 · 보낸 문의 (1:1 대화) | `SB-MYP-LST-010` | B_OWNER/B_STAFF |  |
| ✔ | P0 | `GET` | `/me/deals` | 내 거래 | `SB-MYP-DEA-010` | B_OWNER |  |
| ✔ | P0 | `GET` | `/me/fulfillment-reports` | 내 상담에 온 이행 보고 | `SB-MYP-DEA-010` `SB-MYP-NTF-010` | B_OWNER |  |
| ✔ | P0 | `POST` | `/me/fulfillment-reports/{id}/confirm` | 이행 확인 · 이의 | `SB-MYP-DEA-010` `SB-MYP-NTF-010` | B_OWNER |  |
| ✔ | P0 | `GET` | `/me/home` | 나의공간 첫 화면 | `SB-MYP-DSH-010` | MEMBER |  |
| ✔ | P0 | `GET` | `/me/introducer/activity` | 활동 · 등급 | `SB-MYP-INT-010` `SB-MYP-INT-030` | MEMBER |  |
| ✔ | P0 | `GET` | `/me/introducer/channels` | 초대 전달 방법 | `SB-MYP-INT-020` | MEMBER |  |
| ✔ | P0 | `GET` | `/me/introducer/grades` | 소개자 등급 기준표 (v10.31 · 시안 「등급」 표) | `SB-MYP-INT-010` | MEMBER |  |
| ✔ | P0 | `POST` | `/me/introducer/invite` | 초대 보내기 | `SB-MYP-INT-020` | MEMBER |  |
| ✔ | P0 | `GET` | `/me/introducer/invites` | 보낸 초대 | `SB-MYP-INT-020` | MEMBER |  |
| ✔ | P0 | `GET` | `/me/introducer/matched` | 내게 맞는 요청 | `SB-MYP-INT-010` | MEMBER |  |
| ✔ | P0 | `GET` | `/me/introducer/profile` | 내 소개 분야 · 지역 (v10.31 · 시안 칩) | `SB-MYP-INT-010` | MEMBER |  |
| ✔ | P0 | `PATCH` | `/me/introducer/profile` | 소개 분야 · 지역 바꾸기 (v10.31 · 「분야 추가 · 지역 추가」) | `SB-MYP-INT-010` | MEMBER |  |
| ✔ | P0 | `GET` | `/me/introducer/profile/options` | 분야 · 지역 고르기 목록 | `SB-MYP-INT-010` | MEMBER |  |
| ✔ | P0 | `POST` | `/me/introducer/respond` | 요청에 응답 | `SB-MYP-INT-010` | MEMBER |  |
| ✔ | P0 | `GET` | `/me/ledger` | 원장 | `SB-MYP-SUB-010` | B_OWNER | SUBSCRIPTION |
| ✔ | P0 | `GET` | `/me/listings` | 내 리스팅 | `SB-MYP-LST-010` | B_OWNER/B_STAFF |  |
| ✔ | P0 | `GET` | `/me/notifications` | 알림 | `SB-MYP-DSH-010` `SB-MYP-NTF-010` | MEMBER |  |
| ✔ | P0 | `GET` | `/me/payout-accounts` | 정산 계좌 | `SB-MYP-STL-010` | MEMBER/B_OWNER/B_STAFF | IDENTITY |
| ✔ | P0 | `POST` | `/me/payout-accounts` | 정산 계좌 등록 · 1원 보내기 | `SB-MYP-STL-010` | MEMBER/B_OWNER/B_STAFF | IDENTITY |
| ✔ | P0 | `POST` | `/me/payout-accounts/{id}/verify` | 1원 인증 확인 | `SB-MYP-STL-010` | MEMBER/B_OWNER/B_STAFF | IDENTITY |
| ✔ | P0 | `GET` | `/me/settlements` | 정산 목록 | `SB-MYP-STL-010` | MEMBER/B_OWNER/B_STAFF | IDENTITY |
| ✔ | P0 | `POST` | `/me/settlements/{id}/paid` | 받았음 표시 (v10.31 · 정산 승인 단계) | `SB-MYP-STL-010` | MEMBER/B_OWNER/B_STAFF | IDENTITY |
| ✔ | P0 | `GET` | `/me/settlements/due` | 받을 소개비 — 아직 정산 줄이 없는 성사 거래 | `SB-MYP-STL-010` | MEMBER/B_OWNER/B_STAFF | IDENTITY |
| ✔ | P0 | `POST` | `/me/subscription/cancel` | 구독 해지 | `SB-MYP-SUB-010` | B_OWNER | SUBSCRIPTION |
| ✔ | P0 | `GET` | `/me/subscription/detail` | 내 구독 상세 | `SB-MYP-SUB-010` | B_OWNER | SUBSCRIPTION |
| ✔ | P0 | `GET` | `/me/subscription/invoices` | 청구 내역 | `SB-MYP-SUB-010` | B_OWNER | SUBSCRIPTION |
| ✔ | P0 | `POST` | `/me/subscription/refund` | 구독 환불 | `SB-MYP-SUB-010` | B_OWNER | SUBSCRIPTION |
| ✔ | P0 | `GET` | `/me/subscription/refund-eligible` | 환불 가능 여부 | `SB-MYP-SUB-010` | B_OWNER | SUBSCRIPTION |
| ✔ | P0 | `POST` | `/me/subscription/resume` | 해지 철회 | `SB-MYP-SUB-010` | B_OWNER | SUBSCRIPTION |
| ✔ | P0 | `GET` | `/me/success-fees` | 내 성사 수수료 | `SB-MYP-SUB-010` | B_OWNER | SUBSCRIPTION |
| ✔ | P0 | `POST` | `/settlements` | 정산 신청 — 소개비 받기 | `SB-MYP-STL-010` | MEMBER/B_OWNER/B_STAFF | IDENTITY |
| ✔ | P0 | `POST` | `/subscriptions` | 구독 시작 · 변경 | `SB-MYP-SUB-010` `SB-MYP-SUB-020` | B_OWNER | SUBSCRIPTION |
| ✔ | P0 | `DELETE` | `/subscriptions/reservation` | 요금제 예약 거두기 | `SB-MYP-SUB-010` | B_OWNER | SUBSCRIPTION |
| ✔ | P1 | `GET` | `/contract-templates` | 표준계약서 양식 | `SB-MYP-CTR-020` | MEMBER/B_OWNER/B_STAFF |  |
| ✔ | P1 | `GET` | `/contract-templates/{code}` | 양식 본문 | `SB-MYP-CTR-020` `SB-MYP-CTR-030` | MEMBER/B_OWNER/B_STAFF |  |
| ✔ | P1 | `POST` | `/deals/{id}/contract/agree` | 조건 합의 | `SB-MYP-CTR-020` | MEMBER/B_OWNER/B_STAFF |  |
| ✔ | P1 | `POST` | `/deals/{id}/contract/cancel` | 계약 파기 | `SB-MYP-CTR-010` | MEMBER/B_OWNER/B_STAFF |  |
| ✔ | P1 | `POST` | `/deals/{id}/contract/counter` | 수정 요청 | `SB-MYP-CTR-020` | MEMBER/B_OWNER/B_STAFF |  |
| ✔ | P1 | `POST` | `/deals/{id}/contract/draft` | 계약 조건 임시 저장 (v10.31 · 시안 「임시 저장」) | `SB-MYP-CTR-010` `SB-MYP-CTR-020` | MEMBER/B_OWNER/B_STAFF |  |
| ✔ | P1 | `GET` | `/deals/{id}/contract/esign` | 전자계약 서명 상태 | `SB-MYP-CTR-020` | MEMBER/B_OWNER/B_STAFF |  |
| ✔ | P1 | `POST` | `/deals/{id}/contract/esign` | 전자계약 서명 요청 | `SB-MYP-CTR-020` | MEMBER/B_OWNER/B_STAFF |  |
| ✔ | P1 | `POST` | `/deals/{id}/contract/fulfil` | 이행 확인 | `SB-MYP-CTR-020` | MEMBER/B_OWNER/B_STAFF |  |
| ✔ | P1 | `GET` | `/deals/{id}/contract/history` | 계약 이력 | `SB-MYP-CTR-020` | MEMBER/B_OWNER/B_STAFF |  |
| ✔ | P1 | `POST` | `/deals/{id}/contract/nudge` | 계약 확인 요청 (v10.31 · 시안 계약 진행 「확인 요청」) | `SB-MYP-CTR-010` `SB-MYP-CTR-020` | MEMBER/B_OWNER/B_STAFF |  |
| ✔ | P1 | `GET` | `/deals/{id}/contract/state` | 계약 진행 상태 | `SB-MYP-CTR-020` | MEMBER/B_OWNER/B_STAFF |  |
| ✔ | 마이페이지 | `GET` | `/me/account` | 내 프로필 | `SB-MYP-ACC-010` | MEMBER |  |
| ✔ | 마이페이지 | `PATCH` | `/me/account` | 프로필 수정 | `SB-MYP-ACC-010` | MEMBER |  |
| ✔ | 마이페이지 | `PATCH` | `/me/business` | 사업자 정보 수정 | `SB-MYP-ACC-010` | MEMBER |  |
| ✔ | P1 | `GET` | `/me/contracts` | 내 계약 목록 | `SB-MYP-CTR-010` | MEMBER/B_OWNER/B_STAFF |  |
| ✔ | P1 | `GET` | `/me/favorites` | 관심 목록 | `SB-MYP-LIK-010` | MEMBER |  |
| ✔ | P1 | `GET` | `/me/notification-prefs` | 알림 수신 설정 (v10.31 · 시안 「수신 설정」 표) | `SB-MYP-NTF-010` | MEMBER |  |
| ✔ | P1 | `PATCH` | `/me/notification-prefs` | 알림 수신 설정 바꾸기 | `SB-MYP-NTF-010` | MEMBER |  |
| ✔ | P1 | `PATCH` | `/me/notifications/read` | 알림 전체 읽음 | `SB-MYP-NTF-010` | MEMBER |  |
| ✔ | P1 | `GET` | `/me/points` | 포인트 | `SB-MYP-INT-030` | MEMBER |  |
| ✔ | P1 | `POST` | `/me/settlements/{id}/tax-invoice` | 세금계산서 발행 표시 (v10.31 · 시안 지급 내역 「미발행」) | `SB-MYP-STL-020` | MEMBER/B_OWNER/B_STAFF | IDENTITY |
| ✔ | P1 | `GET` | `/me/settlements/history` | 지급 내역 | `SB-MYP-STL-020` | MEMBER/B_OWNER/B_STAFF | IDENTITY |
| ✔ | P2 | `GET` | `/me/events` | 내가 참여한 이벤트 | `SB-MYP-EVT-010` | MEMBER/B_OWNER |  |
| ✔ | P2 | `GET` | `/me/reports` | 내가 한 신고 | `SB-MYP-RPT-010` | MEMBER/B_OWNER |  |

## ADM · 백오피스

| | 우선 | Method | 경로 | 용도 | 화면 | 역할 | 게이트 |
|:-:|:-:|---|---|---|---|---|---|
| ✔ | 운영 | `GET` | `/admin/accounts` | 회원 목록 | `SB-ADM-MBR-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/accounts-counts` | 회원 수(정상 · 정지) | `SB-ADM-USR-010` `SB-ADM-MBR-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `GET` | `/admin/accounts/{id}` | 회원 상세 | `SB-ADM-MBR-020` | ADMIN/SUPER |  |
| ✔ | 운영 | `PATCH` | `/admin/accounts/{id}/posting-suspension/lift` | 등록 일시 정지 풀기 | `SB-ADM-MBR-010` `SB-ADM-MBR-020` | ADMIN/SUPER |  |
| ✔ | 운영 | `PATCH` | `/admin/accounts/{id}/status` | 회원 상태 변경(정상 ↔ 정지) | `SB-ADM-MBR-010` `SB-ADM-MBR-020` | ADMIN/SUPER |  |
| ✔ | 운영 | `GET` | `/admin/acl` | 권한 계층 | `SB-ADM-ACL-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/ad-invoices` | 청구 목록 | `SB-ADM-ADB-010` `SB-ADS-PAY-010` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/ad-invoices` | 청구 발행 | `SB-ADM-ADB-010` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/ad-invoices/{id}/payments` | 입금 기록 | `SB-ADM-ADB-010` `SB-ADM-PAY-010` | ADMIN |  |
| ✔ | P1 | `GET` | `/admin/ad-receivables` | 미수금 | `SB-ADM-ADB-010` `SB-ADS-PAY-010`… | ADMIN |  |
| ✔ | P1 | `GET` | `/admin/ad-settlement` | 광고 정산 요약 | `SB-ADM-ADB-010` `SB-ADS-PAY-010` | ADMIN |  |
| ✔ | P1 | `GET` | `/admin/advertisers` | 광고주 목록 | `SB-ADM-ADB-010` `SB-ADS-PLT-010` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/advertisers` | 광고주 등록 | `SB-ADM-ADB-010` `SB-ADS-PLT-010` | ADMIN |  |
| ✔ | P1 | `PATCH` | `/admin/advertisers/{id}/status` | 광고주 상태 변경 | `SB-ADM-ADB-010` `SB-ADS-PLT-010` | ADMIN |  |
| ✔ | 운영 | `POST` | `/admin/adx/close-month` | 월 마감 → 명세서 | `SB-ADS-PAY-010` `SB-ADS-PLT-010` | ADMIN/SUPER | BUSINESS |
| ✔ | 운영 | `POST` | `/admin/adx/confirm` | 보류 지난 클릭 확정 | `SB-ADS-PAY-010` `SB-ADS-PLT-010` | ADMIN/SUPER | BUSINESS |
| ✔ | 운영 | `GET` | `/admin/adx/overview` | 외부 송출 현황 | `SB-ADS-PAY-010` `SB-ADS-PLT-010` | ADMIN/SUPER | BUSINESS |
| ✔ | 운영 | `POST` | `/admin/adx/publishers` | 퍼블리셔 등록 | `SB-ADS-PAY-010` `SB-ADS-PLT-010` | ADMIN/SUPER | BUSINESS |
| ✔ | 운영 | `PATCH` | `/admin/adx/publishers/{id}` | 퍼블리셔 도메인 확인 · 보류 · 본인 IP | `SB-ADS-PAY-010` `SB-ADS-PLT-010` | ADMIN/SUPER | BUSINESS |
| ✔ | 운영 | `PATCH` | `/admin/adx/statements/{id}` | 명세서 신청 · 승인 · 집행 | `SB-ADS-PAY-010` | ADMIN/SUPER | BUSINESS |
| ✔ | 운영 | `GET` | `/admin/affiliates/applications` | 파트너 입점 심사 | `SB-AFF-APL-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/affiliates/applications/{id}/decide` | 입점 승인 · 반려 | `SB-AFF-APL-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `GET` | `/admin/affiliates/goals` | 목표 현황 | `SB-AFF-GOL-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/affiliates/goals` | 목표 설정 | `SB-AFF-GOL-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `GET` | `/admin/affiliates/guides` | 파트너가이드 전체 | `SB-AFF-MTR-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/affiliates/guides` | 파트너가이드 등록 | `SB-AFF-MTR-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `PATCH` | `/admin/affiliates/guides/{id}` | 파트너가이드 고치기 · 끄기 | `SB-AFF-MTR-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/affiliates/materials` | 마케팅자료 등록 | `SB-AFF-MTR-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/affiliates/materials/{id}/review` | 자료 심의 | `SB-AFF-MTR-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `GET` | `/admin/affiliates/materials/queue` | 마케팅자료 심의 큐 | `SB-AFF-MTR-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `GET` | `/admin/affiliates/products` | 제휴상품 목록 | `SB-AFF-PRD-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/affiliates/products` | 제휴상품 등록 | `SB-AFF-PRD-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `PATCH` | `/admin/affiliates/products/{id}` | 단가 · 상태 변경 | `SB-AFF-PRD-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `GET` | `/admin/affiliates/settlements` | 정산 현황 | `SB-AFF-STL-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/affiliates/settlements/run` | 정산 배치 실행 | `SB-AFF-STL-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/audit/logs` | 감사 기록 | `SB-ADM-AUD-010` `SB-ADM-AUD-020` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/audit/policy` | 감사 보관 · 임계 (v10.32 · 읽기 전용) | `SB-ADM-AUD-010` `SB-ADM-AUD-020` | ADMIN/SUPER |  |
| ✔ | 운영 | `GET` | `/admin/audit/reviews` | 확인 기록 | `SB-ADM-AUD-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/audit/reviews` | 징후 확인 | `SB-ADM-AUD-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `GET` | `/admin/audit/signals` | 감사 징후 | `SB-ADM-AUD-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/auto-review/rate` | 일별 자동화율 (최근 30일, 최신 먼저) | `SB-ADM-REV-030` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/auto-review/reasons` | 수동 검수 사유별 건수 (최근 30일) | `SB-ADM-REV-030` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/businesses` | 사업자 신청 목록 | `SB-ADM-USR-010` | ADMIN/SUPER |  |
| ✔ | P0 | `PATCH` | `/admin/businesses/{id}/reject` | 사업자 신청 반려 | `SB-ADM-USR-010` `SB-ADM-MBR-010` | ADMIN/SUPER |  |
| ✔ | P0 | `PATCH` | `/admin/businesses/{id}/verify` | 사업자 승인 | `SB-ADM-USR-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/categories` | 업종 관리 목록 | `SB-ADM-CAT-010` | ADMIN/SUPER |  |
| ✔ | P0 | `PATCH` | `/admin/categories/{id}` | 업종 승인 · 반려 | `SB-ADM-CAT-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/deals` | 거래 모니터링 | `SB-ADM-DEL-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/finance/costs` | 월 비용 목록 | `SB-ADM-DSH-010` | ADMIN/SUPER |  |
| ✔ | P0 | `PUT` | `/admin/finance/costs` | 월 비용 넣기 · 고치기 | `SB-ADM-DSH-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/finance/runway` | 활주로(손익분기 · 필요 유료회원 · 최저 현금 · 누적 최대 적자) | `SB-ADM-DSH-010` | ADMIN/SUPER |  |
| ✔ | P0 | `POST` | `/admin/gwans/{code}/open` | 운영중으로 전환 | `SB-ADM-SIT-010` `SB-ADM-SIT-040` | SUPER |  |
| ✔ | P0 | `GET` | `/admin/gwans/{code}/open-check` | 관 오픈 체크리스트 | `SB-ADM-SIT-010` `SB-ADM-SIT-040` | SUPER |  |
| ✔ | P0 | `GET` | `/admin/integrations` | 외부 연동 현황 | `SB-ADM-SIT-080` `SB-ADM-ITG-010` | SUPER |  |
| ✔ | P0 | `PATCH` | `/admin/integrations/{code}` | 연동 상태 변경 | `SB-ADM-SIT-080` `SB-ADM-ITG-010` | SUPER |  |
| ✔ | P0 | `PATCH` | `/admin/integrations/egress-ip` | 발신 IP 일괄 등록 | `SB-ADM-SIT-080` `SB-ADM-ITG-010` | SUPER |  |
| ✔ | P0 | `POST` | `/admin/jobs` | 정기 작업 실행 (사람) | `SB-ADM-DSH-010` | ADMIN/SUPER |  |
| ✔ | P0 | `POST` | `/admin/jobs/run` | 정기 작업 실행 (EventBridge 전용) | `SB-ADM-DSH-010` | ADMIN/SUPER |  |
| ✔ | P0 | `POST` | `/admin/jobs/tick` | 지금 돌아야 할 배치 실행 (스케줄러 전용) | `SB-ADM-DSH-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/open-blockers` | 오픈 차단 항목 | `SB-ADM-SIT-040` | SUPER |  |
| ✔ | P0 | `GET` | `/admin/policies` | 정책 조회 | `SB-ADM-REV-030` `SB-ADM-POL-010` | ADMIN/SUPER |  |
| ✔ | P0 | `PATCH` | `/admin/policies/auto-review/{key}` | 자동검수 규칙 변경 | `SB-ADM-REV-030` `SB-ADM-POL-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/reports/daily` | 일자별 지표 (30일) | `SB-ADM-DSH-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/reports/not-agreed` | 약관 미동의 회원 | `SB-ADM-DSH-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/reports/pending` | 결정 대기 항목 | `SB-ADM-DSH-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/reports/revenue` | 매출 요약 | `SB-ADM-DSH-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/reports/roles` | 권한 보유자 | `SB-ADM-USR-010` | ADMIN/SUPER |  |
| ✔ | P0 | `POST` | `/admin/reports/roles` | 권한 부여 · 회수 | `SB-ADM-USR-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/reports/roles/changes` | 권한 변경 이력 | `SB-ADM-USR-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/reports/signals` | 어긋남 신호 | `SB-ADM-DSH-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/review-reasons` | 반려 사유 코드 | `SB-ADM-REV-020` | REVIEWER/ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/reviews` | 검수 큐 | `SB-ADM-REV-010` | REVIEWER/ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/reviews/{id}` | 검수 건 상세 | `SB-ADM-REV-020` | REVIEWER/ADMIN/SUPER |  |
| ✔ | P0 | `PATCH` | `/admin/reviews/{id}` | 검수 승인 · 반려 | `SB-ADM-REV-020` `SB-ADM-BDG-010` | REVIEWER/ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/reviews/counts` | 검수 큐 탭 숫자 | `SB-ADM-REV-010` | REVIEWER/ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/reviews/throughput` | 검수 처리량 | `SB-ADM-REV-010` | REVIEWER/ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/settlement-ledger` | 정산 목록 | `SB-ADM-STL-010` | ADMIN/SUPER |  |
| ✔ | P0 | `POST` | `/admin/settlement-ledger/{id}/paid` | 지급 완료 표시 | `SB-ADM-STL-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/settlement-ledger/reconcile` | 원장 대조 | `SB-ADM-STL-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/settlements` | 정산 목록 | `SB-ADM-STL-010` | ADMIN/SUPER |  |
| ✔ | P0 | `PATCH` | `/admin/settlements/{id}` | 정산 승인 · 반려 | `SB-ADM-STL-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/site-settings` | 사이트 설정 | `SB-ADM-SIT-070` `SB-ADM-PTN-080` | SUPER |  |
| ✔ | P0 | `PATCH` | `/admin/site-settings` | 설정 변경 | `SB-ADM-SIT-070` `SB-ADM-PTN-080`… | SUPER |  |
| ✔ | P0 | `GET` | `/admin/success-stories` | 베스트매칭 사례 목록(운영) | `SB-ADM-DEL-010` | ADMIN/SUPER |  |
| ✔ | P0 | `POST` | `/admin/success-stories` | 베스트매칭 사례 만들기 | `SB-ADM-DEL-010` | ADMIN/SUPER |  |
| ✔ | P0 | `PATCH` | `/admin/success-stories/{id}` | 베스트매칭 사례 고치기 · 공개 · 숨김 | `SB-ADM-DEL-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/summary` | 대시보드 요약 | `SB-ADM-DSH-010` | ADMIN/SUPER |  |
| ✔ | P0 | `GET` | `/admin/terms` | 약관 전체 (미발행 포함) | `SB-ADM-SIT-070` | SUPER |  |
| ✔ | P0 | `PUT` | `/admin/terms/{code}` | 약관 초안 저장 | `SB-ADM-SIT-070` | SUPER |  |
| ✔ | P0 | `PATCH` | `/admin/terms/{code}/publish` | 약관 발행 | `SB-ADM-SIT-070` | SUPER |  |
| ✔ | P0 | `GET` | `/health` | 헬스체크 | `SB-ADM-DSH-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/ad-creatives` | 소재 목록 | `SB-ADM-ADS-010` `SB-ADS-PLT-010` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/ad-creatives/{code}/assign` | 슬롯 · 세그먼트 지정 | `SB-ADM-ADS-010` `SB-ADS-PLT-010` | ADMIN/SUPER |  |
| ✔ | P1 | `PATCH` | `/admin/ad-creatives/{code}/attribution` | 광고 귀속 켜기 · 끄기 (INV-AD12) | `SB-ADM-ADS-010` `SB-ADS-PLT-010` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/ad-creatives/{code}/review-confirm` | 의료 심의필 확인 (T-03) | `SB-ADM-ADS-010` `SB-ADS-PLT-010` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/ad-creatives/{code}/review-reject` | 의료 심의 반려 (T-03) | `SB-ADM-PTN-040` | ADMIN/SUPER |  |
| ✔ | P1 | `PATCH` | `/admin/ad-creatives/{code}/status` | 소재 중지 · 다시 노출 | `SB-ADM-ADS-010` `SB-ADS-PLT-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/ad-creatives/slots` | 광고 슬롯 | `SB-ADM-ADS-010` `SB-ADS-PLT-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/ad-creatives/stats` | 광고 실적 | `SB-ADM-ADS-010` `SB-ADS-PLT-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/ads` | 광고 게재 목록 | `SB-ADM-MAIN-010` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/ads` | 광고 등록 | `SB-ADM-MAIN-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/auto-review/samples` | 표본 감사 대기 | `SB-ADM-REV-040` | REVIEWER/ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/auto-review/samples/{id}` | 감사 결과 기록 | `SB-ADM-REV-040` | REVIEWER/ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/auto-review/samples/resample` | 표본 다시 뽑기 | `SB-ADM-REV-040` | REVIEWER/ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/auto-review/samples/summary` | 표본 감사 요약 | `SB-ADM-REV-040` | REVIEWER/ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/badges` | 배지 신청 검수 | `SB-ADM-BDG-010` | REVIEWER/ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/badges/history` | 배지 발급 이력 | `SB-ADM-BDG-010` | REVIEWER/ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/banned-words` | 금칙어 목록 | `SB-ADM-POL-010` | SUPER |  |
| ✔ | P1 | `POST` | `/admin/banned-words` | 금칙어 추가 | `SB-ADM-POL-010` | SUPER |  |
| ✔ | P1 | `PATCH` | `/admin/banned-words/{id}` | 금칙어 사용 여부 | `SB-ADM-POL-010` | SUPER |  |
| ✔ | P1 | `GET` | `/admin/billing/attempts-today` | 오늘 청구 시도 현황 | `SB-ADM-BIL-010` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/billing/charge-due` | 자동 청구 즉시 실행 | `SB-ADM-BIL-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/billing/notice-missing` | 안내 미도달 구독 | `SB-ADM-BIL-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/billing/overdue` | 청구 실패 구독 | `SB-ADM-BIL-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/billing/policy` | 청구 정책 | `SB-ADM-BIL-010` | ADMIN/SUPER |  |
| ✔ | P1 | `PATCH` | `/admin/billing/policy/{key}` | 청구 정책 변경 | `SB-ADM-BIL-010` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/billing/reconcile` | 지금 대조(새 청구 없음) | `SB-ADM-BIL-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/billing/review` | 확인이 필요한 청구 · 환불 · 요청 | `SB-ADM-BIL-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/code-labels` | 코드 라벨 | `SB-ADM-COD-010` | SUPER |  |
| ✔ | P1 | `PATCH` | `/admin/code-labels/{domain}/{code}` | 라벨 수정 | `SB-ADM-COD-010` | SUPER |  |
| ✔ | 운영 | `GET` | `/admin/community/polls` | 투표 관리 목록 | `SB-ADM-CMU-020` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/community/polls` | 투표 만들기 | `SB-ADM-CMU-020` | ADMIN/SUPER |  |
| ✔ | 운영 | `PATCH` | `/admin/community/polls/{id}` | 투표 수정 · 열기 · 마감 · 감추기 | `SB-ADM-CMU-020` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/community/posts/{id}/approve` | 글 승인 | `SB-ADM-CMU-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/community/posts/{id}/hide` | 글 감추기 | `SB-ADM-CMU-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `GET` | `/admin/community/queue` | 검수 큐 | `SB-ADM-CMU-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/directory` | 정액 노출 신청 · 노출 목록 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/directory/{id}/activate` | 입금 확인 → 노출 기간 켜기(처음) | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/directory/{id}/end` | 정액 노출 종료 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/directory/{id}/history` | 회차 이력 · 연장 신청 이력 · 세금계산서 줄 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/directory/{id}/reject` | 정액 노출 신청 반려 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/directory/{id}/renew/confirm` | 연장 입금 확인 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/directory/{id}/renew/reject` | 연장 신청 반려 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/directory/invoices` | 정액 노출료 세금계산서 발행 요청 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/directory/invoices/{id}/issue` | 세금계산서 발행 표시(손으로 번호 · 연동 전 임시) | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/disputes` | 분쟁 목록 | `SB-ADM-DSP-010` | ADMIN/SUPER |  |
| ✔ | P1 | `PATCH` | `/admin/disputes/{id}` | 분쟁 처리 | `SB-ADM-DSP-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/disputes/summary` | 분쟁 요약 | `SB-ADM-DSP-010` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/etax/{kind}/{id}/cancel` | 취소 · 수정 발행 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/etax/{kind}/{id}/refresh` | 상태 조회 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/etax/{kind}/{id}/resend` | 다시 보내기 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/etax/{kind}/{id}/send` | 발행(국세청 전송) | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/etax/status` | 전자세금계산서 연동 상태 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/gwans` | 관 목록 · 현황 | `SB-ADM-SIT-010` `SB-ADM-SIT-060`… | SUPER |  |
| ✔ | P1 | `GET` | `/admin/gwans/{code}` | 관 상세 | `SB-ADM-SIT-010` `SB-ADM-SIT-030`… | SUPER |  |
| ✔ | P1 | `PATCH` | `/admin/gwans/{code}` | 관 설정 | `SB-ADM-SIT-030` `SB-ADM-GWN-010` | SUPER |  |
| ✔ | P1 | `PATCH` | `/admin/gwans/landing` | 로그인 후 랜딩 지정 | `SB-ADM-SIT-030` `SB-ADM-GWN-010` | SUPER |  |
| ✔ | P1 | `GET` | `/admin/gwans/manage` | 관 관리 목록 | `SB-ADM-SIT-030` `SB-ADM-GWN-010` | SUPER |  |
| ✔ | P1 | `PATCH` | `/admin/gwans/order` | 관 노출 순서 변경 | `SB-ADM-SIT-030` `SB-ADM-GWN-010` | SUPER |  |
| ✔ | P1 | `GET` | `/admin/health/products` | 소개몰 상품 목록(모든 상태 · 옵션 · 재고) | `SB-ADM-HPR-010` | ADMIN |  |
| ✔ | P1 | `PUT` | `/admin/partner-center/rules/bonus-rates/{grade}` | 등급 할인(보너스) 비율 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `PUT` | `/admin/partner-center/rules/grades/{grade}` | 파트너 등급 기준(이번 달 확정 제휴수수료) | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P2 | `GET` | `/admin/ai/learn-settings` | AI 학습 지표 | `SB-ADM-AIS-010` `SB-ADM-SEG-010` | ADMIN |  |
| ✔ | P2 | `GET` | `/admin/brokers` | 중개사 인증 신청 목록 | `SB-ADM-BRK-010` | ADMIN |  |
| ✔ | P2 | `GET` | `/admin/brokers/{id}` | 중개사 인증 신청 상세 | `SB-ADM-BRK-011` | ADMIN |  |
| ✔ | P2 | `POST` | `/admin/brokers/{id}/decide` | 중개사 인증 승인 · 반려 | `SB-ADM-BRK-010` `SB-ADM-BRK-011` | ADMIN |  |
| ✔ | P2 | `GET` | `/admin/brokers/{id}/evidence` | 중개사 인증 — 보증 · 서류 (v10.32 · 읽기 전용) | `SB-ADM-BRK-011` | ADMIN |  |
| ✔ | P2 | `POST` | `/admin/brokers/{id}/lookup` | 국토부 다시 조회 (D008) | `SB-ADM-BRK-011` | ADMIN |  |
| ✔ | 운영 | `POST` | `/admin/classify/correct` | 분류 교정 | `SB-ADM-CLS-020` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/classify/learn` | 학습 실행 | `SB-ADM-CLS-020` | ADMIN/SUPER |  |
| ✔ | 운영 | `GET` | `/admin/classify/learn/log` | 학습 이력 | `SB-ADM-CLS-020` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/classify/learn/revert` | 학습 되돌리기 | `SB-ADM-CLS-020` | ADMIN/SUPER |  |
| ✔ | P2 | `GET` | `/admin/collect/fetches` | 수집 실행 기록 | `SB-ADM-COL-010` | ADMIN |  |
| ✔ | P2 | `GET` | `/admin/collect/health` | 수집 상태 요약 | `SB-ADM-COL-010` | ADMIN |  |
| ✔ | P2 | `GET` | `/admin/collect/sources` | 수집 대상 | `SB-ADM-COL-010` | ADMIN |  |
| ✔ | P2 | `POST` | `/admin/collect/sources` | 수집 대상 등록 | `SB-ADM-COL-010` | ADMIN |  |
| ✔ | P2 | `PATCH` | `/admin/collect/sources/{code}/gate` | 게이트 통과 기록 | `SB-ADM-COL-010` | ADMIN |  |
| ✔ | P2 | `POST` | `/admin/collect/sources/{code}/run` | 수집 실행 | `SB-ADM-COL-010` | ADMIN |  |
| ✔ | P2 | `PATCH` | `/admin/collect/sources/{code}/state` | 수집 켜고 끄기 | `SB-ADM-COL-010` | ADMIN |  |
| ✔ | P2 | `PATCH` | `/admin/event-joins/{id}/grant` | 지급 처리 | `SB-ADM-EVT-010` | ADMIN |  |
| ✔ | P2 | `GET` | `/admin/events` | 이벤트 전체 (초안 · 종료 포함) | `SB-ADM-EVT-010` | ADMIN |  |
| ✔ | P2 | `POST` | `/admin/events` | 이벤트 만들기 | `SB-ADM-EVT-010` | ADMIN |  |
| ✔ | P2 | `PATCH` | `/admin/events/{code}/status` | 발행 · 중단 | `SB-ADM-EVT-010` | ADMIN |  |
| ✔ | P2 | `GET` | `/admin/events/ungranted` | 지급 대기 | `SB-ADM-EVT-010` | ADMIN |  |
| ✔ | 운영 | `GET` | `/admin/gwan-axes` | 관 축 · UI 유형 | `SB-ADM-GWN-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `PATCH` | `/admin/gwan-axes/{gwan}/{axis}` | 축 노출 · UI 유형 바꾸기 | `SB-ADM-GWN-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/health/commission-rates` | 판매수수료율 | `SB-ADM-HST-010` | ADMIN |  |
| ✔ | P1 | `GET` | `/admin/health/ingredients` | 성분 목록(군 · 많이 찾는 · 판매 중 상품 수) | `SB-ADM-HPR-020` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/health/ingredients` | 성분 더하기 | `SB-ADM-HPR-020` | ADMIN |  |
| ✔ | P1 | `PATCH` | `/admin/health/ingredients/{code}` | 성분 고치기(이름 · 다른 이름 · 많이 찾는 · 군) | `SB-ADM-HPR-020` | ADMIN |  |
| ✔ | P1 | `GET` | `/admin/health/orders` | 소개몰 주문 — 발송할 것 · 배송중 · 배송 완료 · 구매확정 | `SB-ADM-HOR-010` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/health/orders/{no}/advance` | 배송 단계 — 간선 이동 · 배송 완료(구매확정 · 반품 기한의 기준) | `SB-ADM-HOR-010` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/health/orders/{no}/ship` | 발송 처리 — 택배사 · 송장번호 → 「배송중」 | `SB-ADM-HOR-010` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/health/orders/{no}/tracking` | 송장 고치기 — 배송중일 때만(전 기록은 남음) | `SB-ADM-HOR-010` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/health/products` | 상품 등록(초안) | `SB-ADM-HPR-010` | ADMIN |  |
| ✔ | P1 | `GET` | `/admin/health/products/{code}` | 상품 하나(수정 화면) | `SB-ADM-HPR-011` | ADMIN |  |
| ✔ | P1 | `PATCH` | `/admin/health/products/{code}` | 상품 고치기 | `SB-ADM-HPR-011` | ADMIN |  |
| ✔ | P1 | `GET` | `/admin/health/products/{code}/history` | 상품 변경 기록 | `SB-ADM-HPR-011` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/health/products/{code}/options` | 옵션 더하기 | `SB-ADM-HPR-011` | ADMIN |  |
| ✔ | P1 | `PATCH` | `/admin/health/products/{code}/options/{optionId}` | 옵션 고치기(결제 금액 · 재고 · 꼬리 글자 · 켬/끔) | `SB-ADM-HPR-011` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/health/products/{code}/status` | 판매 시작 · 판매 중지 · 초안으로 | `SB-ADM-HPR-011` | ADMIN |  |
| ✔ | P1 | `GET` | `/admin/health/promos` | 특가 배너 목록(전부) | `SB-ADM-HPR-010` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/health/promos` | 특가 배너 더하기 | `SB-ADM-HPR-010` | ADMIN |  |
| ✔ | P1 | `PATCH` | `/admin/health/promos/{id}` | 특가 배너 고치기 · 켬/끔 | `SB-ADM-HPR-010` | ADMIN |  |
| ✔ | P1 | `GET` | `/admin/health/qna` | 상품 문의 — 답할 것(open=true) · 답한 것(open=false) · 전체 | `SB-ADM-HRV-010` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/health/qna/{id}/answer` | 문의에 답하기(쓴 사람에게 알림) | `SB-ADM-HRV-010` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/health/qna/{id}/hide` | 문의 가림(사유 필수) | `SB-ADM-HRV-010` | ADMIN |  |
| ✔ | P1 | `GET` | `/admin/health/returns` | 취소 · 반품 신청 목록 | `SB-ADM-HST-010` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/health/returns/{id}/convert` | 교환 → 반품으로 바꾸기 | `SB-ADM-HST-010` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/health/returns/{id}/decide` | 취소 · 반품 승인 · 반려 | `SB-ADM-HST-010` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/health/returns/{id}/fee-refund` | 교환 배송비 환불 (다시 시도) | `SB-ADM-HST-010` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/health/returns/{id}/refund` | 환불 (다시 시도) | `SB-ADM-HST-010` | ADMIN |  |
| ✔ | P1 | `GET` | `/admin/health/reviews` | 리뷰 — 운영 확인 대기(PENDING) · 보이는 것 · 가린 것 | `SB-ADM-HRV-010` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/health/reviews/{id}/decide` | 리뷰 보이기 · 가림(지우지 않음 · 가리면 쓴 사람에게 알림) | `SB-ADM-HRV-010` | ADMIN |  |
| ✔ | P1 | `GET` | `/admin/health/sale-categories` | 갈래 · 판매 범위(읽기) | `SB-ADM-HPR-030` | ADMIN |  |
| ✔ | P1 | `GET` | `/admin/health/sellers` | 소개몰 판매자 | `SB-ADM-HST-010` | ADMIN |  |
| ✔ | P1 | `GET` | `/admin/health/settlements` | 주별 정산 | `SB-ADM-HST-010` | ADMIN |  |
| ✔ | P1 | `POST` | `/admin/health/settlements/close` | 주 정산 마감 | `SB-ADM-HST-010` | ADMIN |  |
| ✔ | 운영 | `GET` | `/admin/integration-status` | 통합 현황 | `SB-ADM-ITG-010` | SUPER |  |
| ✔ | 운영 | `GET` | `/admin/invariants` | 불변식 현황 | `SB-ADM-INV-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/leads` | 리드 배정 대기열 | `SB-ADM-PTN-090` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/leads/{id}` | 리드 배정 상세 · 후보 | `SB-ADM-PTN-090` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/leads/{id}/assign` | 수동 배정 | `SB-ADM-PTN-090` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/leads/{id}/close` | 상담 신청 종료 | `SB-ADM-PTN-090` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/leads/{id}/reassign` | 재배정 (거두고 다시 보냄) | `SB-ADM-PTN-090` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/leads/run` | 지금 배정 돌리기 | `SB-ADM-PTN-090` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/main/notices` | 공지 | `SB-ADM-MAIN-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `GET` | `/admin/ownership-queue` | 소유 확인 대기 | `SB-ADM-OWN-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/ownership/{id}/decide` | 소유 확인 판정 | `SB-ADM-OWN-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/partner-axes` | 축별 입점 신청 목록 | `SB-ADM-PTN-020` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/partner-axes/{id}/decide` | 축별 입점 승인 · 반려 | `SB-ADM-PTN-020` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/partner-center/cash` | 리드 이용료 선불 잔액 — 파트너별 · 합계 · 원장 불변식 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/partner-center/cash/{partnerId}` | 파트너 한 곳의 원장 · 충전 · 환불 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/partner-center/cash/{partnerId}/adjust` | 잔액 조정(반대 기입) | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/partner-center/cash/auto-run` | 자동 청구 한 번 돌리기 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/partner-center/change-requests` | 사업자 정보 변경 요청 | `SB-ADM-PTN-020` `SB-ADM-PTN-011` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/partner-center/change-requests/{id}/decide` | 변경 요청 승인 · 반려 | `SB-ADM-PTN-020` `SB-ADM-PTN-011` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/partner-center/lead-cash-invoices` | 리드 이용료 세금계산서 발행 요청 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/partner-center/lead-cash-invoices/{id}/issue` | 발행 표시(손으로 번호 · 연동 전 임시) | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/partner-center/lead-cash-invoices/run` | 한 달 치 발행 요청 만들기 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/partner-center/leads/{leadId}/grade` | 리드 등급 · 알림톡 결과 | `SB-ADM-PTN-090` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/partner-center/rules` | 등급 할인 비율 · 파트너 등급 기준 · 신뢰 배지 규칙 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/partners` | 파트너 목록 | `SB-ADM-PTN-010` `SB-ADM-PTN-020` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/partners/{id}` | 파트너 상세 | `SB-ADM-PTN-011` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/partners/{id}/approve` | 입점 승인 | `SB-ADM-PTN-020` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/partners/{id}/docs` | 파트너사 계약 · 서류 (v10.32 · 읽기 전용) | `SB-ADM-PTN-011` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/partners/{id}/reject` | 입점 반려 (SB-ADM-PTN-020) | `SB-ADM-PTN-020` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/partners/cards` | 파트너사 카드 칸 (v10.32 · 읽기 전용) | `SB-ADM-PTN-010` `SB-ADM-PTN-011` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/partners/fees` | 이용료 현황 | `SB-ADM-PTN-080` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/partners/fees/{id}/void` | 이용료 무효 | `SB-ADM-PTN-050` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/partners/fees/void-requests` | 리드 반려 신청 목록 (SB-ADM-PTN-050) | `SB-ADM-PTN-050` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/partners/fees/void-requests/{id}/accept` | 리드 반려 인정 | `SB-ADM-PTN-050` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/partners/fees/void-requests/{id}/dismiss` | 리드 반려 기각 | `SB-ADM-PTN-050` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/partners/services/{id}/review` | 서비스 검수 | `SB-ADM-PTN-030` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/partners/services/pending` | 검수 대기 서비스 (SB-ADM-PTN-030) | `SB-ADM-PTN-030` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/payouts` | 지급 데스크 | `SB-ADM-PAY-010` | ADMIN/SUPER/PAYOUT |  |
| ✔ | P1 | `POST` | `/admin/payouts/{kind}/{id}/confirm` | 정산 확정 (운영) | `SB-ADM-PAY-010` | ADMIN/SUPER/PAYOUT |  |
| ✔ | P1 | `POST` | `/admin/payouts/{kind}/{id}/pay` | 지급 기록 (지급 담당) | `SB-ADM-PAY-010` | ADMIN/SUPER/PAYOUT |  |
| ✔ | P1 | `PATCH` | `/admin/policies/restrictions/{code}` | 제한업종 지정 · 해제 | `SB-ADM-POL-010` | SUPER |  |
| ✔ | P1 | `GET` | `/admin/policy-items` | 정책 원본 표 | `SB-ADM-POL-010` | SUPER |  |
| ✔ | P1 | `PATCH` | `/admin/policy-items/{code}` | 정책 원본 고치기(최고 관리자) | `SB-ADM-POL-010` | SUPER |  |
| ✔ | P1 | `GET` | `/admin/qualifications` | 심사 대기 | `SB-ADM-PTN-070` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/qualifications/{id}/decide` | 자격 승인 · 반려 | `SB-ADM-PTN-070` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/qualifications/{id}/lookup` | 발급처 조회 완료 | `SB-ADM-PTN-070` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/qualifications/category-master` | 카테고리 마스터 (T-05 · T-06) — 읽기 전용 | `SB-ADM-PTN-060` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/qualifications/medical` | 의료 심의 대기 | `SB-ADM-PTN-040` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/qualifications/properties` | 매물 심사 대기 (안심소개) | `SB-ADM-PTN-060` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/qualifications/properties/{id}/decide` | 매물 공개 · 반려 | `SB-ADM-PTN-060` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/qualifications/rules` | 규제 분야 기준 | `SB-ADM-PTN-060` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/risk/alerts` | 경보 목록 | `SB-ADM-RSK-010` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/risk/alerts` | 경보 기록 | `SB-ADM-RSK-010` | ADMIN/SUPER |  |
| ✔ | P1 | `POST` | `/admin/risk/alerts/{id}/close` | 경보 처리 | `SB-ADM-RSK-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/risk/classify-health` | 분류기 상태 | `SB-ADM-RSK-010` `SB-ADM-AIS-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/risk/rule-health` | 규칙별 오탐률 | `SB-ADM-RSK-010` | ADMIN/SUPER |  |
| ✔ | P1 | `GET` | `/admin/risk/rules` | 위험 규칙 | `SB-ADM-RSK-010` | ADMIN/SUPER |  |
| ✔ | P2 | `POST` | `/admin/gwans` | 새 관 만들기 | `SB-ADM-SIT-020` `SB-ADM-GWN-010` | SUPER |  |
| ✔ | P2 | `PATCH` | `/admin/gwans/{code}/visibility` | 관 노출 전환 | `SB-ADM-MAIN-020` `SB-ADM-GWN-010` | SUPER |  |
| ✔ | P2 | `GET` | `/admin/hub` | 통합 메인 · 허브 | `SB-ADM-SIT-050` | SUPER |  |
| ✔ | P2 | `GET` | `/admin/layout` | 메인 화면 구성 | `SB-ADM-MAIN-030` | SUPER |  |
| ✔ | P2 | `PATCH` | `/admin/layout` | 메인 구성 변경 | `SB-ADM-MAIN-030` | SUPER |  |
| ✔ | P2 | `GET` | `/admin/main/copy` | 메인 문구 | `SB-ADM-MAIN-040` | SUPER |  |
| ✔ | P2 | `PATCH` | `/admin/main/copy/{slot}` | 문구 수정 | `SB-ADM-MAIN-040` | SUPER |  |
| ✔ | P2 | `GET` | `/admin/main/sections` | 메인 구역 | `SB-ADM-SIT-050` `SB-ADM-MAIN-030` | SUPER |  |
| ✔ | P2 | `PATCH` | `/admin/main/sections/{code}` | 구역 노출 · 순서 | `SB-ADM-MAIN-030` | SUPER |  |
| ✔ | P2 | `GET` | `/admin/notices` | 공지 목록 (미발행 포함) | `SB-ADM-MAIN-040` | SUPER |  |
| ✔ | P2 | `POST` | `/admin/notices` | 공지 등록 | `SB-ADM-MAIN-040` | SUPER |  |
| ✔ | P2 | `GET` | `/admin/report-queue` | 신고 처리 큐 | `SB-ADM-RPT-010` | ADMIN |  |
| ✔ | P2 | `PATCH` | `/admin/reports/{id}/resolve` | 신고 처리 | `SB-ADM-RPT-010` | ADMIN |  |
| ✔ | 운영 | `GET` | `/admin/risk/exemptions` | 예외 목록 | `SB-ADM-RSK-020` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/risk/exemptions` | 예외 직접 추가 | `SB-ADM-RSK-020` | ADMIN/SUPER |  |
| ✔ | 운영 | `DELETE` | `/admin/risk/exemptions/{id}` | 예외 해제 | `SB-ADM-RSK-020` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/risk/learn` | 오탐 학습 | `SB-ADM-RSK-020` | ADMIN/SUPER |  |
| ✔ | 운영 | `GET` | `/admin/safety/cases` | 피해 사례 목록(운영 · 숨긴 것 포함) | `SB-ADM-CMU-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/safety/cases/{no}/hide` | 피해 사례 숨기기(사유 필수) | `SB-ADM-CMU-010` | ADMIN/SUPER |  |
| ✔ | P2 | `GET` | `/admin/scope` | 공유 경계 · 영향 범위 | `SB-ADM-SIT-060` | SUPER |  |
| ✔ | 운영 | `GET` | `/admin/search/parser` | 파서 상태 | `SB-ADM-SCH-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/search/synonyms` | 동의어 추가 | `SB-ADM-DIC-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `DELETE` | `/admin/search/synonyms/{id}` | 동의어 삭제 | `SB-ADM-DIC-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `GET` | `/admin/search/terms` | 검색 사전 · 검색어 통계 | `SB-ADM-DIC-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `GET` | `/admin/segments/candidates` | 성향 학습 후보 | `SB-ADM-SEG-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/admin/segments/learn` | 성향 학습 실행 | `SB-ADM-SEG-010` | ADMIN/SUPER |  |
| ✔ | P3 | `GET` | `/admin/segments/log` | 옮긴 기록 | `SB-ADM-SEG-010` `SB-ADM-SEG-020` | ADMIN/SUPER |  |
| ✔ | P3 | `GET` | `/admin/segments/preview` | 옮길 대상 미리보기 | `SB-ADM-SEG-020` | ADMIN/SUPER |  |
| ✔ | 운영 | `POST` | `/ads/external/click` | 외부 송출 — 클릭 | `SB-ADS-PLT-010` | ADMIN/SUPER |  |
| ✔ | 운영 | `GET` | `/ads/external/serve` | 외부 송출 — 소재 하나 | `SB-ADS-PLT-010` | ADMIN/SUPER |  |
| ✔ | P3 | `GET` | `/internal/accounts/{id}/ad-profile` | 성향 조회 (내부) | `SB-ADM-ADS-020` | ADMIN |  |
| ✔ | P3 | `GET` | `/internal/businesses/{id}` | 사업자 실재 확인 (내부) | `SB-ADM-ADS-020` | ADMIN |  |

## 스키마 정의 순서

개발 트랙에 맞춰 붙입니다. 이 표의 우측이 0에서 채워지는 것이 API 개발 진척도입니다.

| 트랙 | API | 스키마 정의 |
|---|---:|---:|
| B3 검수 (W4~W7) | 13 | 13 |
| B2 카테고리·정책 (W4~W6) | 11 | 11 |
| B1b 인증·계정 (W4~W7) | 19 | 19 |
| B4 리스팅·요청 (W6~W9) | 36 | 36 |
| B5 문의·Deal (W7~W10) | 28 | 28 |
| B6 구독·원장 (W8~W11) | 11 | 11 |
| B7 정산·분쟁 (W12~W15) | 13 | 13 |
| 기타 (W12~W15) | 509 | 509 |

## 공통 규약

| 항목 | 규칙 |
|---|---|
| 인증 | `Authorization: Bearer` · access 15분 · refresh 쿠키 14일 |
| 오류 | `{ code, message, field?, details? }` — `code` 는 분기용 상수 |
| 400 | 형식 오류 |
| 403 | 권한 없음 · 게이트 미충족 |
| **409** | 상태 충돌 — **재시도해도 같은 결과** |
| **422** | 정책 위반 — 형식은 맞으나 규칙이 막음 |
| 목록 | 커서 페이지네이션 `?cursor=&limit=` · offset 금지 |
| 멱등성 | 결제·정산·코드 발급은 `Idempotency-Key` 헤더 필수 |
| 귀속 | 모든 요청에 `X-Ref-Code` 전달 가능 · 서버가 즉시 기록 |

## 게이트

| 게이트 | 막는 것 | 근거 |
|---|---|---|
| `IDENTITY` | 본인인증 전 거래 진입 | INV-7 |
| `BUSINESS` | 거래 만들기 · 소개비 제시 · 계약서 발급 (소개비 수령은 본인인증 — v10.28 INV-10R) | INV-10 |
| `SUBSCRIPTION` | 구독 없는 코드 발급 | INV-8 |
