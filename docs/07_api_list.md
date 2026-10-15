# 소개뱅크 — API 전체 목록

`npm run docs` 가 다시 만듭니다. **손으로 고치지 마십시오.**

총 **640 오퍼레이션** · 경로 574개

## 공개 (46)

| 엔드포인트 | 설명 |
|---|---|
| `POST /auth/login` | 로그인 |
| `POST /auth/refresh` | 토큰 재발급 |
| `POST /auth/signup` | 회원가입 |
| `GET /categories` | 업종 목록 |
| `GET /gwans` | 관 목록 |
| `GET /gwans/{code}` | 관 단건 |
| `GET /gwans/{code}/form-copy` | 관별 등록 폼 문구 |
| `GET /listings` | 매물 목록 |
| `POST /listings` | 매물 등록 |
| `PATCH /listings/questions/{qid}/answer` | 공개 문의 답변 |
| `PATCH /listings/{id}` | 매물 수정 (재검수) |
| `GET /listings/{id}` | 매물 상세 |
| `POST /listings/{id}/archive` | 매물 내리기 |
| `POST /listings/{id}/badges` | 급구 · 급매 표시 신청 |
| `GET /listings/{id}/images/{n}` | 매물 이미지 |
| `POST /listings/{id}/photos` | 매물 사진 붙이기 (주인) |
| `DELETE /listings/{id}/photos/{mediaId}` | 매물 사진 떼기 (주인) |
| `GET /listings/{id}/photos/{n}` | 매물 사진 (공개) |
| `GET /listings/{id}/questions` | 공개 문의 목록 |
| `POST /listings/{id}/questions` | 공개 문의 등록 |
| `GET /listings/{id}/reviews` | 등록자(소개자) 후기 |
| `GET /requests` | 소개받기 목록 |
| `POST /requests` | 소개받기 등록 |
| `GET /requests/{id}` | 요청 상세 |
| `GET /requests/{id}/images/{n}` | 요청 이미지 |
| `POST /requests/{id}/proposals` | 소개 제안 |
| `GET /requests/{id}/proposals` | 제안 목록 |
| `POST /requests/{id}/proposals/{pid}/decision` | 제안 수락 · 거절 |
| `GET /search` | 통합 검색 |
| `GET /search/keywords` | 많이 찾는 키워드 |
| `POST /search/log` | 검색어 집계 |
| `POST /search/prompt` | 프롬프트 검색 |
| `GET /search/suggest` | 검색 팝업 재료 |
| `POST /signup/biz-check` | 사업자등록번호 조회 (가입 전) |
| `POST /signup/profile-analyze` | 성향 진단 (가입 화면용 · 저장 안 함) |
| `GET /signup/profile-questions` | 성향 문항 (가입 화면용 · 공개) |
| `GET /signup/types` | 가입 유형 |
| `GET /site-settings/public` | 공개 설정 |
| `GET /site/gwan-axes` | 관 축(노출 중) |
| `GET /site/landing` | 로그인 후 랜딩 |
| `GET /terms` | 약관 목록 |
| `POST /terms/agree` | 약관 동의 |
| `GET /terms/agreements` | 내 동의 이력 |
| `GET /terms/doc/{code}` | 약관 한 건 (전문) |
| `GET /terms/index` | 약관 전체 목록 |
| `GET /terms/required` | 동의해야 하는 약관 |

## 나의공간 (94)

| 엔드포인트 | 설명 |
|---|---|
| `GET /me/account` | 내 프로필 |
| `PATCH /me/account` | 프로필 수정 |
| `GET /me/billing-key` | 등록된 결제 수단 |
| `POST /me/billing-key` | 결제 수단 등록 |
| `DELETE /me/billing-key` | 결제 수단 삭제 |
| `GET /me/broker/extra` | 내 중개사 인증 — 보증(공제) · 제출 서류 |
| `PUT /me/broker/extra` | 내 중개사 인증 — 보증(공제) · 제출 서류 저장 |
| `PATCH /me/business` | 사업자 정보 수정 |
| `POST /me/community/posts` | 글쓰기 |
| `PATCH /me/community/posts/{id}` | 글 수정 |
| `DELETE /me/community/posts/{id}` | 글 삭제 |
| `POST /me/community/posts/{id}/comments` | 댓글 |
| `GET /me/consult-requests` | 내 상담 신청 |
| `GET /me/contracts` | 내 계약 목록 |
| `GET /me/conversations` | 받은 문의 · 보낸 문의 (1:1 대화) |
| `GET /me/deals` | 내 거래 |
| `GET /me/disputes` | 내 분쟁 |
| `GET /me/events` | 내가 참여한 이벤트 |
| `GET /me/favorites` | 관심 목록 |
| `POST /me/favorites/{targetId}` | 관심 등록 |
| `DELETE /me/favorites/{targetId}` | 관심 해제 |
| `GET /me/fulfillment-reports` | 내 상담에 온 이행 보고 |
| `POST /me/fulfillment-reports/{id}/confirm` | 이행 확인 · 이의 |
| `GET /me/health/addresses` | 배송지 목록 |
| `POST /me/health/addresses` | 배송지 추가 |
| `DELETE /me/health/addresses/{id}` | 배송지 지우기 |
| `PATCH /me/health/addresses/{id}/default` | 기본 배송지로 |
| `GET /me/health/cart` | 장바구니 |
| `POST /me/health/cart` | 장바구니에 담기 |
| `POST /me/health/cart/ack-prices` | 바뀐 값 확인(「확인했습니다」) |
| `PATCH /me/health/cart/lines/{optionId}` | 장바구니 줄(옵션) 수량 바꾸기 |
| `PATCH /me/health/cart/{code}` | 수량 바꾸기 |
| `GET /me/health/orders` | 내 주문 |
| `GET /me/health/orders/{no}` | 주문 상세 · 배송 조회 |
| `POST /me/health/orders/{no}/confirm` | 구매확정 |
| `GET /me/health/orders/{no}/reviews` | 이 주문에서 내가 쓴 리뷰 |
| `GET /me/health/orders/{no}/shipments` | 배송 조회 |
| `GET /me/health/returns` | 취소 · 반품 내역 |
| `POST /me/health/returns` | 취소 · 반품 신청 |
| `POST /me/health/returns/{id}/fee/confirm` | 교환 배송비 결제 승인 |
| `POST /me/health/returns/{id}/fee/pay` | 교환 배송비 결제 준비 |
| `POST /me/health/reviews` | 리뷰 쓰기 — 구매확정한 주문의 상품마다 1건 |
| `PATCH /me/health/reviews/{id}` | 리뷰 고치기(본인 · 가려진 리뷰는 못 고침) |
| `DELETE /me/health/reviews/{id}` | 리뷰 지우기(본인) |
| `GET /me/home` | 나의공간 첫 화면 |
| `GET /me/inquiries` | 내 문의 내역 |
| `GET /me/introducer/activity` | 활동 · 등급 |
| `GET /me/introducer/channels` | 초대 전달 방법 |
| `GET /me/introducer/grades` | 소개자 등급 기준표 (v10.31 · 시안 「등급」 표) |
| `POST /me/introducer/invite` | 초대 보내기 |
| `GET /me/introducer/invites` | 보낸 초대 |
| `GET /me/introducer/matched` | 내게 맞는 요청 |
| `GET /me/introducer/profile` | 내 소개 분야 · 지역 (v10.31 · 시안 칩) |
| `PATCH /me/introducer/profile` | 소개 분야 · 지역 바꾸기 (v10.31 · 「분야 추가 · 지역 추가」) |
| `GET /me/introducer/profile/options` | 분야 · 지역 고르기 목록 |
| `POST /me/introducer/respond` | 요청에 응답 |
| `GET /me/ledger` | 원장 |
| `GET /me/listings` | 내 리스팅 |
| `GET /me/listings/{id}/draft` | 수정 초안 보기 |
| `PUT /me/listings/{id}/draft` | 수정 초안 저장 |
| `DELETE /me/listings/{id}/draft` | 수정 초안 버리기 |
| `POST /me/listings/{id}/ownership` | 등기사항증명서 제출 |
| `GET /me/listings/{id}/ownership` | 내 소유 확인 상태 |
| `GET /me/listings/{id}/review` | 내 매물 검수 결과 · 이력 |
| `GET /me/notification-prefs` | 알림 수신 설정 (v10.31 · 시안 「수신 설정」 표) |
| `PATCH /me/notification-prefs` | 알림 수신 설정 바꾸기 |
| `GET /me/notifications` | 알림 |
| `PATCH /me/notifications/read` | 알림 전체 읽음 |
| `GET /me/payout-accounts` | 정산 계좌 |
| `POST /me/payout-accounts` | 정산 계좌 등록 · 1원 보내기 |
| `POST /me/payout-accounts/{id}/verify` | 1원 인증 확인 |
| `GET /me/persona` | 내 성향 세그먼트 |
| `GET /me/points` | 포인트 |
| `POST /me/profile` | 성향 등록 |
| `GET /me/profile` | 내 성향 |
| `DELETE /me/profile` | 성향 등록 해지 |
| `GET /me/referral-codes` | 내 소개코드 |
| `GET /me/referral-codes/quota` | 이번 달 소개코드 현황 |
| `GET /me/reports` | 내가 한 신고 |
| `GET /me/settlements` | 정산 목록 |
| `GET /me/settlements/due` | 받을 소개비 — 아직 정산 줄이 없는 성사 거래 |
| `GET /me/settlements/history` | 지급 내역 |
| `POST /me/settlements/{id}/paid` | 받았음 표시 (v10.31 · 정산 승인 단계) |
| `POST /me/settlements/{id}/tax-invoice` | 세금계산서 발행 표시 (v10.31 · 시안 지급 내역 「미발행」) |
| `GET /me/subscription` | 구독 현황 |
| `POST /me/subscription/cancel` | 구독 해지 |
| `GET /me/subscription/detail` | 내 구독 상세 |
| `GET /me/subscription/invoices` | 청구 내역 |
| `POST /me/subscription/refund` | 구독 환불 |
| `GET /me/subscription/refund-eligible` | 환불 가능 여부 |
| `POST /me/subscription/resume` | 해지 철회 |
| `GET /me/success-fees` | 내 성사 수수료 |
| `GET /me/success-stories` | 내가 당사자인 베스트매칭 사례(공개 동의) |
| `GET /me/summary` | 내 요약 |

## 거래·계약 (20)

| 엔드포인트 | 설명 |
|---|---|
| `POST /deals/{id}/confirm` | 성사 확정 (수동) |
| `POST /deals/{id}/contract` | 계약서 발급 |
| `POST /deals/{id}/contract/agree` | 조건 합의 |
| `POST /deals/{id}/contract/cancel` | 계약 파기 |
| `POST /deals/{id}/contract/counter` | 수정 요청 |
| `POST /deals/{id}/contract/draft` | 계약 조건 임시 저장 (v10.31 · 시안 「임시 저장」) |
| `POST /deals/{id}/contract/esign` | 전자계약 서명 요청 |
| `GET /deals/{id}/contract/esign` | 전자계약 서명 상태 |
| `POST /deals/{id}/contract/fulfil` | 이행 확인 |
| `GET /deals/{id}/contract/history` | 계약 이력 |
| `POST /deals/{id}/contract/nudge` | 계약 확인 요청 (v10.31 · 시안 계약 진행 「확인 요청」) |
| `POST /deals/{id}/contract/sign` | 계약서 서명 |
| `GET /deals/{id}/contract/state` | 계약 진행 상태 |
| `POST /deals/{id}/fee` | 소개비 제안 |
| `POST /deals/{id}/fee/{version}/agree` | 소개비 동의 |
| `POST /deals/{id}/payment-report` | 대금 지급 신고 |
| `POST /deals/{id}/reviews` | 후기 작성 |
| `GET /deals/{id}/safe-trade` | 이 거래의 안전거래 상태(당사자) |
| `POST /deals/{id}/safe-trade` | 안전거래 합의(당사자 한쪽) |
| `GET /deals/{id}/summary` | 거래 정보(시안 거래 구간 머리) |

## 운영(ADM) (292)

| 엔드포인트 | 설명 |
|---|---|
| `GET /admin/accounts` | 회원 목록 |
| `GET /admin/accounts-counts` | 회원 수(정상 · 정지) |
| `GET /admin/accounts/{id}` | 회원 상세 |
| `PATCH /admin/accounts/{id}/posting-suspension/lift` | 등록 일시 정지 풀기 |
| `PATCH /admin/accounts/{id}/status` | 회원 상태 변경(정상 ↔ 정지) |
| `GET /admin/acl` | 권한 계층 |
| `GET /admin/ad-creatives` | 소재 목록 |
| `GET /admin/ad-creatives/slots` | 광고 슬롯 |
| `GET /admin/ad-creatives/stats` | 광고 실적 |
| `POST /admin/ad-creatives/{code}/assign` | 슬롯 · 세그먼트 지정 |
| `PATCH /admin/ad-creatives/{code}/attribution` | 광고 귀속 켜기 · 끄기 (INV-AD12) |
| `POST /admin/ad-creatives/{code}/review-confirm` | 의료 심의필 확인 (T-03) |
| `POST /admin/ad-creatives/{code}/review-reject` | 의료 심의 반려 (T-03) |
| `PATCH /admin/ad-creatives/{code}/status` | 소재 중지 · 다시 노출 |
| `GET /admin/ad-invoices` | 청구 목록 |
| `POST /admin/ad-invoices` | 청구 발행 |
| `POST /admin/ad-invoices/{id}/payments` | 입금 기록 |
| `GET /admin/ad-receivables` | 미수금 |
| `GET /admin/ad-settlement` | 광고 정산 요약 |
| `GET /admin/ads` | 광고 게재 목록 |
| `POST /admin/ads` | 광고 등록 |
| `GET /admin/advertisers` | 광고주 목록 |
| `POST /admin/advertisers` | 광고주 등록 |
| `PATCH /admin/advertisers/{id}/status` | 광고주 상태 변경 |
| `POST /admin/adx/close-month` | 월 마감 → 명세서 |
| `POST /admin/adx/confirm` | 보류 지난 클릭 확정 |
| `GET /admin/adx/overview` | 외부 송출 현황 |
| `POST /admin/adx/publishers` | 퍼블리셔 등록 |
| `PATCH /admin/adx/publishers/{id}` | 퍼블리셔 도메인 확인 · 보류 · 본인 IP |
| `PATCH /admin/adx/statements/{id}` | 명세서 신청 · 승인 · 집행 |
| `GET /admin/affiliates/applications` | 파트너 입점 심사 |
| `POST /admin/affiliates/applications/{id}/decide` | 입점 승인 · 반려 |
| `GET /admin/affiliates/goals` | 목표 현황 |
| `POST /admin/affiliates/goals` | 목표 설정 |
| `GET /admin/affiliates/guides` | 파트너가이드 전체 |
| `POST /admin/affiliates/guides` | 파트너가이드 등록 |
| `PATCH /admin/affiliates/guides/{id}` | 파트너가이드 고치기 · 끄기 |
| `POST /admin/affiliates/materials` | 마케팅자료 등록 |
| `GET /admin/affiliates/materials/queue` | 마케팅자료 심의 큐 |
| `POST /admin/affiliates/materials/{id}/review` | 자료 심의 |
| `GET /admin/affiliates/products` | 제휴상품 목록 |
| `POST /admin/affiliates/products` | 제휴상품 등록 |
| `PATCH /admin/affiliates/products/{id}` | 단가 · 상태 변경 |
| `GET /admin/affiliates/settlements` | 정산 현황 |
| `POST /admin/affiliates/settlements/run` | 정산 배치 실행 |
| `GET /admin/ai/learn-settings` | AI 학습 지표 |
| `GET /admin/audit/logs` | 감사 기록 |
| `GET /admin/audit/policy` | 감사 보관 · 임계 (v10.32 · 읽기 전용) |
| `GET /admin/audit/reviews` | 확인 기록 |
| `POST /admin/audit/reviews` | 징후 확인 |
| `GET /admin/audit/signals` | 감사 징후 |
| `GET /admin/auto-review/rate` | 일별 자동화율 (최근 30일, 최신 먼저) |
| `GET /admin/auto-review/reasons` | 수동 검수 사유별 건수 (최근 30일) |
| `GET /admin/auto-review/samples` | 표본 감사 대기 |
| `POST /admin/auto-review/samples/resample` | 표본 다시 뽑기 |
| `GET /admin/auto-review/samples/summary` | 표본 감사 요약 |
| `POST /admin/auto-review/samples/{id}` | 감사 결과 기록 |
| `GET /admin/badges` | 배지 신청 검수 |
| `GET /admin/badges/history` | 배지 발급 이력 |
| `GET /admin/banned-words` | 금칙어 목록 |
| `POST /admin/banned-words` | 금칙어 추가 |
| `PATCH /admin/banned-words/{id}` | 금칙어 사용 여부 |
| `GET /admin/billing/attempts-today` | 오늘 청구 시도 현황 |
| `POST /admin/billing/charge-due` | 자동 청구 즉시 실행 |
| `GET /admin/billing/notice-missing` | 안내 미도달 구독 |
| `GET /admin/billing/overdue` | 청구 실패 구독 |
| `GET /admin/billing/policy` | 청구 정책 |
| `PATCH /admin/billing/policy/{key}` | 청구 정책 변경 |
| `POST /admin/billing/reconcile` | 지금 대조(새 청구 없음) |
| `GET /admin/billing/review` | 확인이 필요한 청구 · 환불 · 요청 |
| `GET /admin/brokers` | 중개사 인증 신청 목록 |
| `GET /admin/brokers/{id}` | 중개사 인증 신청 상세 |
| `POST /admin/brokers/{id}/decide` | 중개사 인증 승인 · 반려 |
| `GET /admin/brokers/{id}/evidence` | 중개사 인증 — 보증 · 서류 (v10.32 · 읽기 전용) |
| `POST /admin/brokers/{id}/lookup` | 국토부 다시 조회 (D008) |
| `GET /admin/businesses` | 사업자 신청 목록 |
| `PATCH /admin/businesses/{id}/reject` | 사업자 신청 반려 |
| `PATCH /admin/businesses/{id}/verify` | 사업자 승인 |
| `GET /admin/categories` | 업종 관리 목록 |
| `PATCH /admin/categories/{id}` | 업종 승인 · 반려 |
| `POST /admin/classify/correct` | 분류 교정 |
| `POST /admin/classify/learn` | 학습 실행 |
| `GET /admin/classify/learn/log` | 학습 이력 |
| `POST /admin/classify/learn/revert` | 학습 되돌리기 |
| `GET /admin/code-labels` | 코드 라벨 |
| `PATCH /admin/code-labels/{domain}/{code}` | 라벨 수정 |
| `GET /admin/collect/fetches` | 수집 실행 기록 |
| `GET /admin/collect/health` | 수집 상태 요약 |
| `GET /admin/collect/sources` | 수집 대상 |
| `POST /admin/collect/sources` | 수집 대상 등록 |
| `PATCH /admin/collect/sources/{code}/gate` | 게이트 통과 기록 |
| `POST /admin/collect/sources/{code}/run` | 수집 실행 |
| `PATCH /admin/collect/sources/{code}/state` | 수집 켜고 끄기 |
| `GET /admin/community/polls` | 투표 관리 목록 |
| `POST /admin/community/polls` | 투표 만들기 |
| `PATCH /admin/community/polls/{id}` | 투표 수정 · 열기 · 마감 · 감추기 |
| `POST /admin/community/posts/{id}/approve` | 글 승인 |
| `POST /admin/community/posts/{id}/hide` | 글 감추기 |
| `GET /admin/community/queue` | 검수 큐 |
| `GET /admin/deals` | 거래 모니터링 |
| `GET /admin/directory` | 정액 노출 신청 · 노출 목록 |
| `GET /admin/directory/invoices` | 정액 노출료 세금계산서 발행 요청 |
| `POST /admin/directory/invoices/{id}/issue` | 세금계산서 발행 표시(손으로 번호 · 연동 전 임시) |
| `POST /admin/directory/{id}/activate` | 입금 확인 → 노출 기간 켜기(처음) |
| `POST /admin/directory/{id}/end` | 정액 노출 종료 |
| `GET /admin/directory/{id}/history` | 회차 이력 · 연장 신청 이력 · 세금계산서 줄 |
| `POST /admin/directory/{id}/reject` | 정액 노출 신청 반려 |
| `POST /admin/directory/{id}/renew/confirm` | 연장 입금 확인 |
| `POST /admin/directory/{id}/renew/reject` | 연장 신청 반려 |
| `GET /admin/disputes` | 분쟁 목록 |
| `GET /admin/disputes/summary` | 분쟁 요약 |
| `PATCH /admin/disputes/{id}` | 분쟁 처리 |
| `GET /admin/etax/status` | 전자세금계산서 연동 상태 |
| `POST /admin/etax/{kind}/{id}/cancel` | 취소 · 수정 발행 |
| `POST /admin/etax/{kind}/{id}/refresh` | 상태 조회 |
| `POST /admin/etax/{kind}/{id}/resend` | 다시 보내기 |
| `POST /admin/etax/{kind}/{id}/send` | 발행(국세청 전송) |
| `PATCH /admin/event-joins/{id}/grant` | 지급 처리 |
| `GET /admin/events` | 이벤트 전체 (초안 · 종료 포함) |
| `POST /admin/events` | 이벤트 만들기 |
| `GET /admin/events/ungranted` | 지급 대기 |
| `PATCH /admin/events/{code}/status` | 발행 · 중단 |
| `GET /admin/finance/costs` | 월 비용 목록 |
| `PUT /admin/finance/costs` | 월 비용 넣기 · 고치기 |
| `GET /admin/finance/runway` | 활주로(손익분기 · 필요 유료회원 · 최저 현금 · 누적 최대 적자) |
| `GET /admin/gwan-axes` | 관 축 · UI 유형 |
| `PATCH /admin/gwan-axes/{gwan}/{axis}` | 축 노출 · UI 유형 바꾸기 |
| `GET /admin/gwans` | 관 목록 · 현황 |
| `POST /admin/gwans` | 새 관 만들기 |
| `PATCH /admin/gwans/landing` | 로그인 후 랜딩 지정 |
| `GET /admin/gwans/manage` | 관 관리 목록 |
| `PATCH /admin/gwans/order` | 관 노출 순서 변경 |
| `GET /admin/gwans/{code}` | 관 상세 |
| `PATCH /admin/gwans/{code}` | 관 설정 |
| `POST /admin/gwans/{code}/open` | 운영중으로 전환 |
| `GET /admin/gwans/{code}/open-check` | 관 오픈 체크리스트 |
| `PATCH /admin/gwans/{code}/visibility` | 관 노출 전환 |
| `GET /admin/health/commission-rates` | 판매수수료율 |
| `GET /admin/health/ingredients` | 성분 목록(군 · 많이 찾는 · 판매 중 상품 수) |
| `POST /admin/health/ingredients` | 성분 더하기 |
| `PATCH /admin/health/ingredients/{code}` | 성분 고치기(이름 · 다른 이름 · 많이 찾는 · 군) |
| `GET /admin/health/orders` | 소개몰 주문 — 발송할 것 · 배송중 · 배송 완료 · 구매확정 |
| `POST /admin/health/orders/{no}/advance` | 배송 단계 — 간선 이동 · 배송 완료(구매확정 · 반품 기한의 기준) |
| `POST /admin/health/orders/{no}/ship` | 발송 처리 — 택배사 · 송장번호 → 「배송중」 |
| `POST /admin/health/orders/{no}/tracking` | 송장 고치기 — 배송중일 때만(전 기록은 남음) |
| `GET /admin/health/products` | 소개몰 상품 목록(모든 상태 · 옵션 · 재고) |
| `POST /admin/health/products` | 상품 등록(초안) |
| `GET /admin/health/products/{code}` | 상품 하나(수정 화면) |
| `PATCH /admin/health/products/{code}` | 상품 고치기 |
| `GET /admin/health/products/{code}/history` | 상품 변경 기록 |
| `POST /admin/health/products/{code}/options` | 옵션 더하기 |
| `PATCH /admin/health/products/{code}/options/{optionId}` | 옵션 고치기(결제 금액 · 재고 · 꼬리 글자 · 켬/끔) |
| `POST /admin/health/products/{code}/status` | 판매 시작 · 판매 중지 · 초안으로 |
| `GET /admin/health/promos` | 특가 배너 목록(전부) |
| `POST /admin/health/promos` | 특가 배너 더하기 |
| `PATCH /admin/health/promos/{id}` | 특가 배너 고치기 · 켬/끔 |
| `GET /admin/health/qna` | 상품 문의 — 답할 것(open=true) · 답한 것(open=false) · 전체 |
| `POST /admin/health/qna/{id}/answer` | 문의에 답하기(쓴 사람에게 알림) |
| `POST /admin/health/qna/{id}/hide` | 문의 가림(사유 필수) |
| `GET /admin/health/returns` | 취소 · 반품 신청 목록 |
| `POST /admin/health/returns/{id}/convert` | 교환 → 반품으로 바꾸기 |
| `POST /admin/health/returns/{id}/decide` | 취소 · 반품 승인 · 반려 |
| `POST /admin/health/returns/{id}/fee-refund` | 교환 배송비 환불 (다시 시도) |
| `POST /admin/health/returns/{id}/refund` | 환불 (다시 시도) |
| `GET /admin/health/reviews` | 리뷰 — 운영 확인 대기(PENDING) · 보이는 것 · 가린 것 |
| `POST /admin/health/reviews/{id}/decide` | 리뷰 보이기 · 가림(지우지 않음 · 가리면 쓴 사람에게 알림) |
| `GET /admin/health/sale-categories` | 갈래 · 판매 범위(읽기) |
| `GET /admin/health/sellers` | 소개몰 판매자 |
| `GET /admin/health/settlements` | 주별 정산 |
| `POST /admin/health/settlements/close` | 주 정산 마감 |
| `GET /admin/hub` | 통합 메인 · 허브 |
| `GET /admin/integration-status` | 통합 현황 |
| `GET /admin/integrations` | 외부 연동 현황 |
| `PATCH /admin/integrations/egress-ip` | 발신 IP 일괄 등록 |
| `PATCH /admin/integrations/{code}` | 연동 상태 변경 |
| `GET /admin/invariants` | 불변식 현황 |
| `POST /admin/jobs` | 정기 작업 실행 (사람) |
| `POST /admin/jobs/run` | 정기 작업 실행 (EventBridge 전용) |
| `POST /admin/jobs/tick` | 지금 돌아야 할 배치 실행 (스케줄러 전용) |
| `GET /admin/layout` | 메인 화면 구성 |
| `PATCH /admin/layout` | 메인 구성 변경 |
| `GET /admin/leads` | 리드 배정 대기열 |
| `POST /admin/leads/run` | 지금 배정 돌리기 |
| `GET /admin/leads/{id}` | 리드 배정 상세 · 후보 |
| `POST /admin/leads/{id}/assign` | 수동 배정 |
| `POST /admin/leads/{id}/close` | 상담 신청 종료 |
| `POST /admin/leads/{id}/reassign` | 재배정 (거두고 다시 보냄) |
| `GET /admin/main/copy` | 메인 문구 |
| `PATCH /admin/main/copy/{slot}` | 문구 수정 |
| `GET /admin/main/notices` | 공지 |
| `GET /admin/main/sections` | 메인 구역 |
| `PATCH /admin/main/sections/{code}` | 구역 노출 · 순서 |
| `GET /admin/notices` | 공지 목록 (미발행 포함) |
| `POST /admin/notices` | 공지 등록 |
| `GET /admin/open-blockers` | 오픈 차단 항목 |
| `GET /admin/ownership-queue` | 소유 확인 대기 |
| `POST /admin/ownership/{id}/decide` | 소유 확인 판정 |
| `GET /admin/partner-axes` | 축별 입점 신청 목록 |
| `POST /admin/partner-axes/{id}/decide` | 축별 입점 승인 · 반려 |
| `GET /admin/partner-center/cash` | 리드 이용료 선불 잔액 — 파트너별 · 합계 · 원장 불변식 |
| `POST /admin/partner-center/cash/auto-run` | 자동 청구 한 번 돌리기 |
| `GET /admin/partner-center/cash/{partnerId}` | 파트너 한 곳의 원장 · 충전 · 환불 |
| `POST /admin/partner-center/cash/{partnerId}/adjust` | 잔액 조정(반대 기입) |
| `GET /admin/partner-center/change-requests` | 사업자 정보 변경 요청 |
| `POST /admin/partner-center/change-requests/{id}/decide` | 변경 요청 승인 · 반려 |
| `GET /admin/partner-center/lead-cash-invoices` | 리드 이용료 세금계산서 발행 요청 |
| `POST /admin/partner-center/lead-cash-invoices/run` | 한 달 치 발행 요청 만들기 |
| `POST /admin/partner-center/lead-cash-invoices/{id}/issue` | 발행 표시(손으로 번호 · 연동 전 임시) |
| `POST /admin/partner-center/leads/{leadId}/grade` | 리드 등급 · 알림톡 결과 |
| `GET /admin/partner-center/rules` | 등급 할인 비율 · 파트너 등급 기준 · 신뢰 배지 규칙 |
| `PUT /admin/partner-center/rules/bonus-rates/{grade}` | 등급 할인(보너스) 비율 |
| `PUT /admin/partner-center/rules/grades/{grade}` | 파트너 등급 기준(이번 달 확정 제휴수수료) |
| `GET /admin/partners` | 파트너 목록 |
| `GET /admin/partners/cards` | 파트너사 카드 칸 (v10.32 · 읽기 전용) |
| `GET /admin/partners/fees` | 이용료 현황 |
| `GET /admin/partners/fees/void-requests` | 리드 반려 신청 목록 (SB-ADM-PTN-050) |
| `POST /admin/partners/fees/void-requests/{id}/accept` | 리드 반려 인정 |
| `POST /admin/partners/fees/void-requests/{id}/dismiss` | 리드 반려 기각 |
| `POST /admin/partners/fees/{id}/void` | 이용료 무효 |
| `GET /admin/partners/services/pending` | 검수 대기 서비스 (SB-ADM-PTN-030) |
| `POST /admin/partners/services/{id}/review` | 서비스 검수 |
| `GET /admin/partners/{id}` | 파트너 상세 |
| `POST /admin/partners/{id}/approve` | 입점 승인 |
| `GET /admin/partners/{id}/docs` | 파트너사 계약 · 서류 (v10.32 · 읽기 전용) |
| `POST /admin/partners/{id}/reject` | 입점 반려 (SB-ADM-PTN-020) |
| `GET /admin/payouts` | 지급 데스크 |
| `POST /admin/payouts/{kind}/{id}/confirm` | 정산 확정 (운영) |
| `POST /admin/payouts/{kind}/{id}/pay` | 지급 기록 (지급 담당) |
| `GET /admin/policies` | 정책 조회 |
| `PATCH /admin/policies/auto-review/{key}` | 자동검수 규칙 변경 |
| `PATCH /admin/policies/restrictions/{code}` | 제한업종 지정 · 해제 |
| `GET /admin/policy-items` | 정책 원본 표 |
| `PATCH /admin/policy-items/{code}` | 정책 원본 고치기(최고 관리자) |
| `GET /admin/qualifications` | 심사 대기 |
| `GET /admin/qualifications/category-master` | 카테고리 마스터 (T-05 · T-06) — 읽기 전용 |
| `GET /admin/qualifications/medical` | 의료 심의 대기 |
| `GET /admin/qualifications/properties` | 매물 심사 대기 (안심소개) |
| `POST /admin/qualifications/properties/{id}/decide` | 매물 공개 · 반려 |
| `GET /admin/qualifications/rules` | 규제 분야 기준 |
| `POST /admin/qualifications/{id}/decide` | 자격 승인 · 반려 |
| `POST /admin/qualifications/{id}/lookup` | 발급처 조회 완료 |
| `GET /admin/report-queue` | 신고 처리 큐 |
| `GET /admin/reports/daily` | 일자별 지표 (30일) |
| `GET /admin/reports/not-agreed` | 약관 미동의 회원 |
| `GET /admin/reports/pending` | 결정 대기 항목 |
| `GET /admin/reports/revenue` | 매출 요약 |
| `GET /admin/reports/roles` | 권한 보유자 |
| `POST /admin/reports/roles` | 권한 부여 · 회수 |
| `GET /admin/reports/roles/changes` | 권한 변경 이력 |
| `GET /admin/reports/signals` | 어긋남 신호 |
| `PATCH /admin/reports/{id}/resolve` | 신고 처리 |
| `GET /admin/review-reasons` | 반려 사유 코드 |
| `GET /admin/reviews` | 검수 큐 |
| `GET /admin/reviews/counts` | 검수 큐 탭 숫자 |
| `GET /admin/reviews/throughput` | 검수 처리량 |
| `GET /admin/reviews/{id}` | 검수 건 상세 |
| `PATCH /admin/reviews/{id}` | 검수 승인 · 반려 |
| `GET /admin/risk/alerts` | 경보 목록 |
| `POST /admin/risk/alerts` | 경보 기록 |
| `POST /admin/risk/alerts/{id}/close` | 경보 처리 |
| `GET /admin/risk/classify-health` | 분류기 상태 |
| `GET /admin/risk/exemptions` | 예외 목록 |
| `POST /admin/risk/exemptions` | 예외 직접 추가 |
| `DELETE /admin/risk/exemptions/{id}` | 예외 해제 |
| `POST /admin/risk/learn` | 오탐 학습 |
| `GET /admin/risk/rule-health` | 규칙별 오탐률 |
| `GET /admin/risk/rules` | 위험 규칙 |
| `GET /admin/safety/cases` | 피해 사례 목록(운영 · 숨긴 것 포함) |
| `POST /admin/safety/cases/{no}/hide` | 피해 사례 숨기기(사유 필수) |
| `GET /admin/scope` | 공유 경계 · 영향 범위 |
| `GET /admin/search/parser` | 파서 상태 |
| `POST /admin/search/synonyms` | 동의어 추가 |
| `DELETE /admin/search/synonyms/{id}` | 동의어 삭제 |
| `GET /admin/search/terms` | 검색 사전 · 검색어 통계 |
| `GET /admin/segments/candidates` | 성향 학습 후보 |
| `POST /admin/segments/learn` | 성향 학습 실행 |
| `GET /admin/segments/log` | 옮긴 기록 |
| `GET /admin/segments/preview` | 옮길 대상 미리보기 |
| `GET /admin/settlement-ledger` | 정산 목록 |
| `GET /admin/settlement-ledger/reconcile` | 원장 대조 |
| `POST /admin/settlement-ledger/{id}/paid` | 지급 완료 표시 |
| `GET /admin/settlements` | 정산 목록 |
| `PATCH /admin/settlements/{id}` | 정산 승인 · 반려 |
| `GET /admin/site-settings` | 사이트 설정 |
| `PATCH /admin/site-settings` | 설정 변경 |
| `GET /admin/success-stories` | 베스트매칭 사례 목록(운영) |
| `POST /admin/success-stories` | 베스트매칭 사례 만들기 |
| `PATCH /admin/success-stories/{id}` | 베스트매칭 사례 고치기 · 공개 · 숨김 |
| `GET /admin/summary` | 대시보드 요약 |
| `GET /admin/terms` | 약관 전체 (미발행 포함) |
| `PUT /admin/terms/{code}` | 약관 초안 저장 |
| `PATCH /admin/terms/{code}/publish` | 약관 발행 |

## 기타 (188)

| 엔드포인트 | 설명 |
|---|---|
| `POST /ads/external/click` | 외부 송출 — 클릭 |
| `GET /ads/external/serve` | 외부 송출 — 소재 하나 |
| `GET /ads/infeed` | 목록 인피드 광고 |
| `GET /ads/serve` | 슬롯 소재 조회 |
| `GET /ads/{id}` | 광고 소재 한 건(랜딩 미리보기) |
| `POST /ads/{id}/click` | 클릭 기록 |
| `POST /ads/{id}/impression` | 노출 기록 |
| `POST /ai/classify` | 자동 분류 |
| `POST /ai/classify/feedback` | 분류 선택 기록 |
| `GET /ai/match/{leadId}` | AI 추천 결과 (서버 계산) |
| `POST /ai/recommend` | 추천 점수 계산 |
| `GET /ai/recommend/request` | 내 요청의 추천 후보 |
| `GET /ai/recommend/weights` | 추천 가중치 |
| `POST /attribution/touch` | 소개코드 유입 기록 |
| `POST /biz/axis` | 축 항목 올리기 |
| `POST /biz/axis-requests/{id}/answer` | 받은 요청에 회신 |
| `GET /biz/axis-requests/{no}` | 내 항목이 받은 요청(올린 사람) |
| `GET /biz/axis/{kind}` | 축 목록 |
| `GET /biz/axis/{kind}/{no}` | 축 항목 상세(공고 · 자문 서비스 · 정책 · 교육) |
| `POST /biz/axis/{no}/requests` | 업체 소개 요청(공고) · 견적 요청(자문) |
| `PATCH /biz/axis/{no}/status` | 축 항목 마감 · 다시 열기 · 숨김(운영) |
| `GET /biz/policies/{no}/source` | 지원사업 공고 원문(SB-BIZ-POL-030) |
| `GET /biz/quick` | 빠른 매칭 — 열린 요청(14일) |
| `POST /biz/quick` | 빠른 매칭 요청 올리기 |
| `POST /biz/quick/{id}/close` | 내 빠른 매칭 요청 닫기 |
| `POST /biz/quick/{id}/offer` | 빠른 매칭에 회신(인증 사업자) |
| `POST /businesses` | 사업자 신청 |
| `GET /codes` | 코드 라벨 번들 |
| `GET /community/board` | 글 목록 — 쪽 번호 · 게시글 검색 |
| `POST /community/classify` | 본문으로 게시판 추천 |
| `GET /community/polls` | 투표 목록 |
| `GET /community/polls/{id}` | 투표 1건 · 결과 |
| `POST /community/polls/{id}/vote` | 투표하기 |
| `GET /community/posts` | 글 목록 |
| `GET /community/posts/{id}` | 글 상세 · 댓글 |
| `GET /consult/categories` | 상담 업종 목록 |
| `GET /consult/categories/{code}` | 상담 업종 상세 |
| `GET /consult/directory/{code}` | 정액 노출 업체 목록 |
| `POST /consult/requests` | 상담 신청 |
| `POST /consult/requests/{id}/verify` | 휴대폰 확인 → 업체 1곳 전달 |
| `GET /contract-templates` | 표준계약서 양식 |
| `GET /contract-templates/{code}` | 양식 본문 |
| `POST /conversations` | 1:1 문의 시작 |
| `POST /conversations/check` | 보내기 전 확인 |
| `POST /conversations/{id}/deal` | Deal 생성 |
| `GET /conversations/{id}/messages` | 메시지 목록 |
| `POST /conversations/{id}/messages` | 메시지 보내기 |
| `GET /conversations/{id}/summary` | 1:1 문의 요약 (시안 scAsk 머리 · 오른쪽 칸) |
| `POST /disputes` | 분쟁 접수 |
| `GET /events` | 진행 중인 이벤트 |
| `GET /events/{code}` | 이벤트 상세 |
| `POST /events/{code}/join` | 이벤트 참여 |
| `GET /faq` | 자주 묻는 질문 |
| `GET /features` | 기능 스위치 |
| `POST /files` | 파일 올릴 자리 만들기 |
| `GET /files/{id}` | 파일 열기 (짧게 유효한 주소) |
| `DELETE /files/{id}` | 내 파일 지우기 |
| `POST /files/{id}/complete` | 올리기 확인 |
| `PUT /files/{id}/content` | (개발 · 로컬 저장소) 바이트 올리기 |
| `GET /files/{id}/content` | (개발 · 로컬 저장소) 바이트 내려받기 |
| `GET /footer-links` | 푸터 링크 |
| `GET /health` | 헬스체크 |
| `GET /health/categories` | 취급 갈래 |
| `GET /health/concerns` | 고민별 인덱스 |
| `GET /health/concerns/{code}` | 고민 상세 |
| `GET /health/ingredients` | 성분별 인덱스 |
| `GET /health/ingredients/{code}` | 성분 상세 |
| `POST /health/orders` | 주문 |
| `POST /health/orders/{no}/pay` | 결제 |
| `POST /health/orders/{no}/pay/confirm` | 결제 승인 (토스 결제창 성공 뒤) |
| `GET /health/products` | 상품 목록 |
| `GET /health/products/{code}` | 상품 상세 |
| `GET /health/products/{code}/image` | 상품 사진 |
| `GET /health/products/{code}/qna` | 상품 문의 목록 |
| `POST /health/products/{code}/qna` | 상품 문의 쓰기(본인인증 회원) |
| `GET /health/products/{code}/reviews` | 상품 리뷰 — 별점 평균 · 분포 · 목록(보이는 것만) |
| `GET /health/promos` | 소개몰 메인 특가 배너 (v10.31 · 시안 「오늘의 건강상품」) |
| `GET /health/rankings` | 소개몰 순위 — 오늘의 건강상품(최근 7일 판매 수량) · 많이 찾는 상품(최근 7일 주문 건수) |
| `GET /health/suggest` | 검색 제안(자동완성) |
| `POST /inquiries` | 고객센터 문의 |
| `GET /internal/accounts/{id}/ad-profile` | 성향 조회 (내부) |
| `GET /internal/businesses/{id}` | 사업자 실재 확인 (내부) |
| `GET /invites/{token}` | 초대 확인 (비회원) |
| `POST /invites/{token}/consent` | 동의 · 거절 |
| `GET /market/best` | 베스트매칭 사례 |
| `GET /market/regions` | 지역으로 찾기 — 시 · 도와 게시 매물 수 |
| `GET /market/requests` | 지금 올라온 소개 요청 — 종류 · 지역 · 사진 |
| `PATCH /market/requests/{id}` | 내 요청의 종류 · 지역 · 사진 |
| `GET /market/requests/{id}/photo` | 요청 사진 (공개) |
| `GET /market/success` | 성공현황 |
| `POST /market/success-stories/{id}/consent` | 베스트매칭 사례 공개 동의 · 철회 |
| `GET /market/success/recent` | 최근 실제 연결 사례 |
| `GET /market/suppliers` | 서비스 업체 추천 — 업체 단위 목록 |
| `GET /market/suppliers/recommended` | AI 추천 맞춤 공급자 |
| `GET /market/suppliers/{id}` | 업체 프로필 |
| `GET /notices` | 공지 |
| `GET /partner/affiliate/dashboard` | 대시보드 |
| `GET /partner/affiliate/guides` | 파트너가이드 |
| `GET /partner/affiliate/inquiries` | 내 문의 |
| `POST /partner/affiliate/inquiries` | 1:1 문의 |
| `GET /partner/affiliate/links` | 내 소개링크 |
| `POST /partner/affiliate/links` | 링크 발급 |
| `GET /partner/affiliate/materials` | 마케팅자료실 |
| `GET /partner/affiliate/orders` | 주문 현황 |
| `GET /partner/affiliate/products` | 추천상품 |
| `GET /partner/affiliate/revenues` | 수익관리 |
| `POST /partner/affiliate/settlement-account` | 정산 계좌 등록 |
| `POST /partner/affiliate/settlement-account/verify` | 정산 계좌 1원 인증 확인 |
| `POST /partner/affiliate/settlement-account/verify/request` | 정산 계좌 1원 받기 |
| `GET /partner/affiliate/settlements` | 정산내역 |
| `POST /partner/apply` | 입점 신청 |
| `GET /partner/axes` | 내 축별 입점 상태 |
| `POST /partner/axes` | 축별 입점 신청 |
| `GET /partner/broker` | 내 중개사 인증 상태 |
| `POST /partner/broker` | 중개사 인증 신청 |
| `GET /partner/cash` | 리드 이용료 잔액 (SB-PTC-CTR-400) |
| `PUT /partner/cash/auto` | 자동 청구 설정 |
| `POST /partner/cash/charges` | 충전 주문 만들기 |
| `POST /partner/cash/charges/confirm` | 충전 승인 확인 |
| `POST /partner/cash/refunds` | 유상 잔액 환불 |
| `GET /partner/company` | 회사 · 계정 (SB-PTC-CTR-610) |
| `PUT /partner/company/brand` | 회사 관리 — 브랜드명 · 소개 · 로고 |
| `POST /partner/company/change-requests` | 사업자 정보 변경 요청 |
| `POST /partner/company/sites` | 회사 관리 — 소재 추가(시 · 군 · 구까지) |
| `DELETE /partner/company/sites/{id}` | 회사 관리 — 소재 빼기 |
| `POST /partner/company/staff` | 직원 초대 |
| `DELETE /partner/company/staff/{accountId}` | 직원 빼기 |
| `GET /partner/dashboard` | 파트너 홈 |
| `GET /partner/directory` | 내 정액 노출 항목 |
| `POST /partner/directory` | 정액 노출 신청 · 정보 수정 |
| `GET /partner/directory/invoices` | 내 정액 노출료 세금계산서 |
| `POST /partner/directory/{id}/renew` | 기간 연장 신청(A안) |
| `GET /partner/fees` | 리드 이용료 차감 내역 |
| `GET /partner/fees/disputes` | 내 리드 반려 신청 |
| `POST /partner/fees/{id}/dispute` | 리드 반려 신청 (SB-PTC-CTR-330) |
| `GET /partner/leads` | 받은 리드 |
| `GET /partner/leads/{id}/contact` | 열람한 리드의 연락처 (D008) |
| `POST /partner/leads/{id}/memo` | 메모 남기기 |
| `GET /partner/leads/{id}/memos` | 배정 건 메모 내역 |
| `POST /partner/leads/{id}/view` | 리드 열람 (과금) |
| `GET /partner/notices` | 공지 · 알림 |
| `POST /partner/notices/read-all` | 알림 모두 읽음 (SB-PTC-CTR-700 · v10.31) |
| `POST /partner/notices/{id}/read` | 알림 한 건 읽음 |
| `GET /partner/performance` | 성과 관리 — 이행 보고 (SB-PTC-CTR-450) |
| `POST /partner/performance` | 이행 보고 |
| `GET /partner/pricing` | 내 단가표 |
| `GET /partner/pricing/rewards` | 소개비 보상표 (SB-PTC-CTR-900 · v10.31) |
| `GET /partner/regions` | 활동 지역 |
| `POST /partner/regions` | 활동 지역 설정 |
| `GET /partner/rejects` | 반려 · 이의신청 (SB-PTC-CTR-330) |
| `GET /partner/reviews` | 승인 · 반려 이력 |
| `GET /partner/service-forms` | 서비스 등록 위자드 정의 (SB-PTC-CTR-210) |
| `GET /partner/services` | 내 서비스 |
| `POST /partner/services` | 서비스 등록 |
| `GET /partner/services/{id}` | 서비스 상세 (SB-PTC-CTR-201) |
| `PATCH /partner/services/{id}` | 서비스 수정 |
| `PUT /partner/services/{id}/blocks/{kind}` | 상세페이지 블록 저장 |
| `PUT /partner/services/{id}/matrix` | 견적 매트릭스 저장 |
| `POST /partner/services/{id}/resume` | 노출 재개 |
| `POST /partner/services/{id}/suspend` | 노출 중단 |
| `GET /partner/settlement` | 정산 (성사 정산 · 수령 계좌 · 세금계산서) |
| `GET /partner/staff/invitations` | 내가 받은 직원 초대 |
| `POST /partner/staff/invitations/{businessId}/accept` | 직원 초대 받아들이기 |
| `GET /partner/stats` | 실적 · 등급 |
| `GET /partner/tracks` | 전용 트랙 (SB-PTC-CTR-950) |
| `POST /partner/tracks/catalog` | 카탈로그 품목 추가 |
| `PATCH /partner/tracks/catalog/{id}` | 카탈로그 품목 노출 · 숨김 |
| `POST /partner/tracks/repair/{deliveryId}/quote` | 견적 보내기(저장) |
| `GET /partner/trust` | 신뢰지표 |
| `POST /profile/analyze` | 성향 진단 (저장 안 함) |
| `GET /profile/questions` | 성향 문항 |
| `GET /r/{code}` | 제휴 링크 열기 (클릭 기록) |
| `POST /referral-codes` | 소개코드 발급 |
| `GET /report-reasons` | 신고 사유 목록 |
| `POST /reports` | 신고 접수 |
| `GET /restrictions` | 제한업종 목록 |
| `POST /restrictions/check` | 제한업종 검사 |
| `GET /safety/cases` | 피해 사례 게시판 |
| `POST /safety/cases` | 피해 사례 작성 |
| `GET /safety/cases/{no}` | 피해 사례 보기(조회 수 +1) |
| `GET /safety/safe-trade` | 안전거래 이용 안내(B-04) |
| `POST /settlements` | 정산 신청 — 소개비 받기 |
| `GET /subscription-plans` | 요금제 |
| `POST /subscriptions` | 구독 시작 · 변경 |
| `DELETE /subscriptions/reservation` | 요금제 예약 거두기 |
| `GET /ui-messages` | 화면 고정 문구 |
| `POST /verifications/identity` | 본인인증 |
| `POST /webhooks/toss` | 토스페이먼츠 웹훅 (PAYMENT_STATUS_CHANGED · DEPOSIT_CALLBACK) |
